// blender.rs: File ▸ Export for Blender, the native half. The page builds the folder's files in memory (src/export/blender.js
// blenderFiles: <name>.glb and README.txt); this side writes them into the folder the user picked, and, when asked and when Blender
// is found, runs the user's own Blender headless with the bundled script (src/export/blender_fbx.py) to add <name>.fbx beside them.
//
// FINDING BLENDER, as ac.rs finds Assetto Corsa: a path the user set in Settings (blender_path.txt in the app data folder) wins;
// else Steam's own folder and every library in libraryfolders.vdf (ac.rs library_paths_from_vdf), the first
// <library>\steamapps\common\Blender\blender.exe. Not found: the FBX tick is not offered, and the glb is still written.
//
// THE WRITE goes into <picked>\<name> for Blender. It never goes into a game: a picked folder inside any content\tracks is refused,
// whatever it is called. An existing folder the builder did not write (no .t180b-blender.json) is refused untouched; one it did write
// is written over, file by file, through a temporary file each.
//
// THE RUN: blender.exe --background --factory-startup --python <script> -- <glb> <fbx> (src/export/blender.js fbxArgs), with no window
// and at below-normal priority, so it neither shows nor slows the app. The script is the bundled copy, written to the app data folder
// before each run. Its last line says what happened: "T180FBX ok <n>" or "T180FBX error <why>".
use std::fs;
use std::path::{Path, PathBuf};

pub const BLENDER_FILE: &str = "blender_path.txt";
pub const BLENDER_STEAM_DIR: &str = "Blender";
pub const MARKER: &str = ".t180b-blender.json";
pub const SCRIPT: &str = include_str!("../../src/export/blender_fbx.py");

/// A file that is a Blender to run: an existing file named blender.exe (any case).
pub fn is_blender_exe(p: &Path) -> bool {
    p.is_file() && p.file_name().map_or(false, |n| n.to_string_lossy().eq_ignore_ascii_case("blender.exe"))
}

/// Blender in a Steam install: Steam's own folder first, then every library libraryfolders.vdf names.
pub fn find_blender_in_steam(steam: &Path) -> Option<PathBuf> {
    let mut libs = vec![steam.to_path_buf()];
    if let Ok(t) = fs::read_to_string(steam.join("steamapps").join("libraryfolders.vdf")) {
        for p in super::ac::library_paths_from_vdf(&t) { if !libs.contains(&p) { libs.push(p); } }
    }
    libs.into_iter().map(|l| l.join("steamapps").join("common").join(BLENDER_STEAM_DIR).join("blender.exe")).find(|b| is_blender_exe(b))
}

/// Remember the Blender the user picked in Settings. Refused unless it is a blender.exe.
pub fn remember_blender(data: &Path, exe: &Path) -> Result<PathBuf, String> {
    if !is_blender_exe(exe) {
        return Err(format!("{} is not blender.exe", exe.display()));
    }
    let abs = super::ac::plain_path(fs::canonicalize(exe).map_err(|e| format!("could not resolve {}: {e}", exe.display()))?);
    super::write_atomic(&data.join(BLENDER_FILE), &abs.to_string_lossy())?;
    Ok(abs)
}

/// The remembered Blender, or None when none was set (or it is gone).
pub fn recall_blender(data: &Path) -> Result<Option<PathBuf>, String> {
    let f = data.join(BLENDER_FILE);
    match fs::read_to_string(&f) {
        Ok(s) => { let p = PathBuf::from(s.trim()); Ok(if is_blender_exe(&p) { Some(p) } else { None }) }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("could not read {}: {e}", f.display())),
    }
}

/// The Blender to run: the one set in Settings, else the one Steam has; None when neither. Nothing is remembered here.
pub fn blender_or_find(data: &Path, steam_path: &dyn Fn() -> Option<PathBuf>) -> Result<Option<PathBuf>, String> {
    if let Some(p) = recall_blender(data)? { return Ok(Some(p)); }
    Ok(steam_path().and_then(|s| find_blender_in_steam(&s)))
}

/// A folder or file name the export for Blender writes: letters, digits, space, '.', '_' or '-'; not empty, at most 80, not starting
/// with '.' or a space, not ending with '.' or a space (Windows drops those), and never '.' or '..'.
pub fn valid_plain_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= 80 && !n.starts_with(['.', ' ']) && !n.ends_with(['.', ' '])
        && n.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b' ' | b'.' | b'_' | b'-'))
}

/// True when `dir` is inside a game's track folder: any `content\tracks` in its path.
pub fn inside_game_tracks(dir: &str) -> bool {
    let parts: Vec<&str> = dir.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    parts.windows(2).any(|w| w[0].eq_ignore_ascii_case("content") && w[1].eq_ignore_ascii_case("tracks"))
}

/// Write the export for Blender into `dir/folder`: the guards in the header, then each file through a temporary file, then the marker.
pub fn write_blender_folder(dir: &Path, folder: &str, files: &[(String, Vec<u8>)]) -> Result<PathBuf, String> {
    let shown = dir.to_string_lossy();
    if inside_game_tracks(&shown) {
        return Err(format!("{shown} is inside a game's track folder (content\\tracks): the export for Blender goes into a folder of its own, never into the game"));
    }
    if !dir.is_dir() {
        return Err(format!("{shown} is not a folder"));
    }
    if !valid_plain_name(folder) {
        return Err(format!("{folder:?} is not a folder name the export for Blender makes"));
    }
    for (p, _) in files {
        if !valid_plain_name(p) || p.eq_ignore_ascii_case(MARKER) {
            return Err(format!("{p:?} is not a file name the export for Blender writes"));
        }
    }
    let target = dir.join(folder);
    if target.exists() && !target.join(MARKER).is_file() {
        return Err(format!("{} exists and was not written by the builder (no {MARKER}); nothing touched", target.display()));
    }
    fs::create_dir_all(&target).map_err(|e| format!("could not create {}: {e}", target.display()))?;
    for (p, bytes) in files {
        let dst = target.join(p);
        let tmp = target.join(format!("{p}.tmp-write"));
        fs::write(&tmp, bytes).map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, &dst).map_err(|e| format!("could not move {} into place: {e}", dst.display()))?;
    }
    let names: Vec<String> = files.iter().map(|(p, _)| format!("{p:?}")).collect();
    super::write_atomic(&target.join(MARKER), &format!("{{\"by\":\"t180-track-builder\",\"files\":[{}]}}", names.join(",")))?;
    Ok(target)
}

/// What the script's output says: Ok(objects) from its "T180FBX ok <n>" line, else Err with its "T180FBX error" words, else Err with
/// the output's last line (Blender ended before the script could say anything).
pub fn fbx_outcome(out: &str) -> Result<usize, String> {
    for l in out.lines().rev() {
        if let Some(n) = l.trim().strip_prefix("T180FBX ok ") { return n.trim().parse().map_err(|_| format!("Blender said {l:?}")); }
        if let Some(e) = l.trim().strip_prefix("T180FBX error ") { return Err(e.trim().to_string()); }
    }
    Err(format!("Blender ended without a result: {}", out.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("no output").trim()))
}

/// Blender's command line (the same as src/export/blender.js fbxArgs).
pub fn fbx_args(script: &Path, glb: &Path, fbx: &Path) -> Vec<String> {
    ["--background", "--factory-startup", "--python"].iter().map(|s| s.to_string())
        .chain([script, Path::new("--"), glb, fbx].iter().map(|p| p.to_string_lossy().into_owned()))
        .collect()
}

/// Run the user's Blender on `glb` to write `fbx`, with no window and at below-normal priority; the script is written to `data` first.
pub fn run_fbx(exe: &Path, data: &Path, glb: &Path, fbx: &Path) -> Result<usize, String> {
    let script = data.join("blender_fbx.py");
    fs::write(&script, SCRIPT).map_err(|e| format!("could not write {}: {e}", script.display()))?;
    let mut cmd = std::process::Command::new(exe);
    cmd.args(fbx_args(&script, glb, fbx));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        cmd.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    }
    let out = cmd.output().map_err(|e| format!("Blender could not start ({}): {e}", exe.display()))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let n = fbx_outcome(&text)?;
    if !fbx.is_file() { return Err(format!("Blender said ok but {} is not there", fbx.display())); }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("t180tb-blender-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn fake_blender(dir: &Path) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let b = dir.join("blender.exe");
        fs::write(&b, b"not really").unwrap();
        b
    }

    #[test]
    fn blender_is_found_in_a_second_steam_library() {
        let root = scratch("steam");
        let steam = root.join("Steam");
        let lib = root.join("Lib2");
        fs::create_dir_all(steam.join("steamapps")).unwrap();
        let vdf = format!("\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n\t\"1\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n}}\n",
            steam.to_string_lossy().replace('\\', "\\\\"), lib.to_string_lossy().replace('\\', "\\\\"));
        fs::write(steam.join("steamapps").join("libraryfolders.vdf"), vdf).unwrap();
        assert_eq!(find_blender_in_steam(&steam), None, "no Blender anywhere yet");
        let b = fake_blender(&lib.join("steamapps").join("common").join("Blender"));
        assert_eq!(find_blender_in_steam(&steam), Some(b));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_blender_set_in_settings_wins_over_steam_and_a_gone_one_is_forgotten() {
        let root = scratch("recall");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        let steam = root.join("Steam");
        let in_steam = fake_blender(&steam.join("steamapps").join("common").join("Blender"));
        let picked = fake_blender(&root.join("Picked"));
        let sp = { let s = steam.clone(); move || Some(s.clone()) };
        assert_eq!(blender_or_find(&data, &sp).unwrap(), Some(in_steam.clone()), "nothing set: Steam's");
        fs::write(root.join("Picked").join("notblender.exe"), b"x").unwrap();
        assert!(remember_blender(&data, &root.join("Picked").join("notblender.exe")).is_err(), "only a blender.exe is remembered");
        assert!(remember_blender(&data, &root.join("Picked").join("gone").join("blender.exe")).is_err(), "nor one that is not there");
        remember_blender(&data, &picked).unwrap();
        let got = blender_or_find(&data, &sp).unwrap().unwrap();
        assert_eq!(fs::canonicalize(got).unwrap(), fs::canonicalize(&picked).unwrap(), "the one set in Settings wins");
        fs::remove_file(&picked).unwrap();
        assert_eq!(blender_or_find(&data, &sp).unwrap(), Some(in_steam), "a set one that is gone: Steam's again");
        assert_eq!(blender_or_find(&data, &|| None).unwrap(), None);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn names_are_plain_and_never_a_path() {
        for good in ["right turn", "ELYSIUM for Blender", "a_b-c.glb", "README.txt"] { assert!(valid_plain_name(good), "{good:?}"); }
        for bad in ["", ".", "..", ".hidden", " lead", "trail ", "trail.", "a/b", "a\\b", "c:x", "é", &"a".repeat(81)] { assert!(!valid_plain_name(bad), "{bad:?}"); }
    }

    #[test]
    fn the_write_refuses_a_game_folder_a_strange_name_and_a_folder_it_did_not_write() {
        let root = scratch("refuse");
        let game = root.join("assettocorsa").join("content").join("tracks");
        fs::create_dir_all(&game).unwrap();
        let files = vec![("t.glb".to_string(), vec![1u8, 2, 3])];
        assert!(write_blender_folder(&game, "t for Blender", &files).unwrap_err().contains("never into the game"));
        assert!(write_blender_folder(&root, "../up", &files).is_err());
        assert!(write_blender_folder(&root, "ok", &[("../x".to_string(), vec![])]).is_err());
        assert!(write_blender_folder(&root, "ok", &[(MARKER.to_string(), vec![])]).is_err(), "the marker is the builder's own");
        fs::create_dir_all(root.join("theirs")).unwrap();
        fs::write(root.join("theirs").join("keep.txt"), b"mine").unwrap();
        assert!(write_blender_folder(&root, "theirs", &files).unwrap_err().contains("nothing touched"));
        assert_eq!(fs::read(root.join("theirs").join("keep.txt")).unwrap(), b"mine");
        assert!(!root.join("theirs").join("t.glb").exists());
        assert_eq!(fs::read_dir(&game).unwrap().count(), 0, "nothing in the game's folder");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_write_puts_the_files_and_its_marker_and_writes_over_its_own_folder() {
        let root = scratch("write");
        let t = write_blender_folder(&root, "lap for Blender", &[("lap.glb".to_string(), vec![7u8; 10]), ("README.txt".to_string(), b"hi".to_vec())]).unwrap();
        assert_eq!(fs::read(t.join("lap.glb")).unwrap(), vec![7u8; 10]);
        assert_eq!(fs::read(t.join("README.txt")).unwrap(), b"hi");
        assert!(fs::read_to_string(t.join(MARKER)).unwrap().contains("\"lap.glb\""));
        write_blender_folder(&root, "lap for Blender", &[("lap.glb".to_string(), vec![9u8; 4])]).unwrap();
        assert_eq!(fs::read(t.join("lap.glb")).unwrap(), vec![9u8; 4], "its own folder is written over");
        assert!(fs::read_dir(&t).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp-write")));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_script_says_what_happened_on_its_last_word() {
        assert_eq!(fbx_outcome("Blender 5.2\nT180FBX ok 142\nBlender quit\n"), Ok(142));
        assert_eq!(fbx_outcome("T180FBX error no such file\nTraceback…"), Err("no such file".to_string()));
        assert!(fbx_outcome("Error: Python not found\n\n").unwrap_err().contains("Python not found"));
        assert!(fbx_outcome("").unwrap_err().contains("no output"));
    }

    #[test]
    fn the_command_line_is_the_one_the_page_names() {
        let a = fbx_args(Path::new("s.py"), Path::new("a.glb"), Path::new("b.fbx"));
        assert_eq!(a, ["--background", "--factory-startup", "--python", "s.py", "--", "a.glb", "b.fbx"]);
        assert!(SCRIPT.contains("T180FBX ok") && SCRIPT.contains("FBX_SCALE_ALL"), "the bundled script is blender_fbx.py");
    }
}
