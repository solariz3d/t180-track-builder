// ac.rs: the app's two Assetto Corsa actions, INSTALL and SEE IT, kept apart from the rest of the native side.
//
// INSTALL TO AC. The user picks the AC folder once (the one holding content/tracks); it is remembered in the app's data
// folder (ac_root.txt). An install writes the exported track straight into <AC>/content/tracks/<folder> through
// write_export_to, so every guard of the export applies: the folder must be t180b_… (the builder names every track so,
// and says so in the UI), and an existing folder the builder did not write is refused untouched (the marker file).
//
// FOUND THROUGH STEAM (D250; the keeper: "when the track is saved and exported, it should automatically create the folder in the
// assetto track folder in steam"). With no folder remembered, root_or_find looks AC up before anyone is asked: Steam's folder from
// the registry (HKCU\Software\Valve\Steam, SteamPath, read with Windows' own reg.exe, no new crate), then every library in
// <Steam>\steamapps\libraryfolders.vdf, then <library>\steamapps\common\assettocorsa holding content\tracks. Found, it is
// remembered exactly as a picked folder is (remember_ac_root), so every install guard below applies unchanged; not found, the app
// asks with the picker as before. A picked or remembered folder always wins. Tests pass a fake registry and a fake Steam tree.
//
// SEE IT IN ASSETTO. BUILT, NEVER RUN. The overnight plan's rules: a cfg file AC reads (Documents\Assetto Corsa\cfg\
// race.ini) is copied to race.ini.bak-t180b-<stamp> BEFORE anything is written, and put back byte-exact in a
// `finally`, whatever happens; a run has a hard 10-minute timeout, after which the acs.exe it started, and only that one,
// is killed. And the keeper, 2026-09-27 12:17: "You need to just do the plan, not open assetto ... No in game testing
// needed." So the launch sits behind a setting, OFF by default and labelled as launching the game; no test and no automated run
// turns it on. The process boundary is the Spawner trait: tests pass a mock that records what WOULD run; RealSpawner is
// compiled and reachable only from the see_it_in_assetto command, behind that setting.
// What it changes in race.ini: [RACE] TRACK and CONFIG_TRACK only (every other line kept byte-exact), so the user's
// own car and session settings are used. The backup is kept after a byte-exact restore, as the only record of the run.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const ROOT_FILE: &str = "ac_root.txt";
pub const LAUNCH_SETTING: &str = "see_it_in_assetto.enabled";
pub const HARD_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// `<root>/content/tracks`, if `root` is an Assetto Corsa folder.
pub fn tracks_of(root: &Path) -> Result<PathBuf, String> {
    let t = root.join("content").join("tracks");
    if !t.is_dir() {
        return Err(format!("{} has no content\\tracks: it is not an Assetto Corsa folder (pick the folder that holds content\\tracks)", root.display()));
    }
    Ok(t)
}

/// Remember the AC folder in `data`. Refused unless it is one (it has content/tracks).
pub fn remember_ac_root(data: &Path, root: &Path) -> Result<PathBuf, String> {
    tracks_of(root)?;
    let abs = plain_path(fs::canonicalize(root).map_err(|e| format!("could not resolve {}: {e}", root.display()))?);
    super::write_atomic(&data.join(ROOT_FILE), &abs.to_string_lossy())?;
    Ok(abs)
}

/// The path as a user would type it: Windows' canonicalize returns the verbatim form (`\\?\C:\…`, `\\?\UNC\server\…`),
/// which the install message showed as it is.
pub fn plain_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().into_owned();
    if let Some(r) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{r}"))
    } else if let Some(r) = s.strip_prefix(r"\\?\") {
        PathBuf::from(r)
    } else {
        p
    }
}

/// The remembered AC folder, or None when none was picked yet (or the remembered one is gone).
pub fn recall_ac_root(data: &Path) -> Result<Option<PathBuf>, String> {
    let f = data.join(ROOT_FILE);
    match fs::read_to_string(&f) {
        Ok(s) => {
            let p = plain_path(PathBuf::from(s.trim()));   // a folder remembered before the fix carries \\?\
            Ok(if tracks_of(&p).is_ok() { Some(p) } else { None })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("could not read {}: {e}", f.display())),
    }
}

// ---- found through Steam (D250: see the header) ----
pub const AC_STEAM_DIR: &str = "assettocorsa";

/// Steam's folder from the output of `reg query HKCU\Software\Valve\Steam /v SteamPath`, or None (no such value, or empty).
pub fn steam_path_from_reg_output(out: &str) -> Option<PathBuf> {
    for line in out.lines() {
        let t = line.trim_start();
        if t.split_whitespace().next() != Some("SteamPath") { continue; }
        for ty in ["REG_EXPAND_SZ", "REG_SZ"] {
            if let Some(i) = t.find(ty) {
                let v = t[i + ty.len()..].trim();
                return if v.is_empty() { None } else { Some(PathBuf::from(v)) };
            }
        }
    }
    None
}

/// The quoted tokens of one vdf line, with its backslash escapes undone: `"path"  "C:\\Steam"` -> ["path", "C:\Steam"].
fn vdf_tokens(line: &str) -> Vec<String> {
    let (mut toks, mut cur, mut esc) = (Vec::new(), None::<String>, false);
    for c in line.chars() {
        match cur.as_mut() {
            Some(s) if esc => { s.push(c); esc = false; }
            Some(_) if c == '\\' => esc = true,
            Some(_) if c == '"' => toks.push(cur.take().unwrap_or_default()),
            Some(s) => s.push(c),
            None if c == '"' => cur = Some(String::new()),
            None => {}
        }
    }
    toks
}

/// Every library folder in a libraryfolders.vdf: the "path" values (the current format) and the numbered values that are
/// paths (the old one, `"1"  "D:\\SteamLibrary"`). An app id and its size (`"244210"  "38123"`) is not a library.
pub fn library_paths_from_vdf(text: &str) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for line in text.lines() {
        let t = vdf_tokens(line);
        if t.len() != 2 { continue; }
        let looks_like_path = t[1].contains(":\\") || t[1].contains(":/") || t[1].starts_with("\\\\");
        if t[0].eq_ignore_ascii_case("path") || (t[0].bytes().all(|b| b.is_ascii_digit()) && looks_like_path) {
            let p = PathBuf::from(&t[1]);
            if !out.contains(&p) { out.push(p); }
        }
    }
    out
}

/// AC in a Steam install: Steam's own folder first, then every library libraryfolders.vdf names; the first
/// <library>/steamapps/common/assettocorsa that holds content/tracks.
pub fn find_ac_in_steam(steam: &Path) -> Option<PathBuf> {
    let mut libs = vec![steam.to_path_buf()];
    if let Ok(t) = fs::read_to_string(steam.join("steamapps").join("libraryfolders.vdf")) {
        for p in library_paths_from_vdf(&t) { if !libs.contains(&p) { libs.push(p); } }
    }
    libs.into_iter().map(|l| l.join("steamapps").join("common").join(AC_STEAM_DIR)).find(|ac| tracks_of(ac).is_ok())
}

/// The AC folder to install into: the remembered one; else the one found through Steam (`steam_path` reads the registry),
/// which is then remembered as a picked folder is; else None, and the app asks with the picker.
pub fn root_or_find(data: &Path, steam_path: &dyn Fn() -> Option<PathBuf>) -> Result<Option<PathBuf>, String> {
    if let Some(p) = recall_ac_root(data)? { return Ok(Some(p)); }
    match steam_path().and_then(|s| find_ac_in_steam(&s)) {
        Some(ac) => Ok(Some(remember_ac_root(data, &ac)?)),
        None => Ok(None),
    }
}

/// What the STARTUP CARD needs (D252 second item; the keeper: "in the EXE startup, the user can choose where the track folder is"): the remembered
/// AC folder, or, only when none is, the one found through Steam. NOTHING is remembered here: the user answers the card (Use it / Choose another…).
pub fn root_status(data: &Path, steam_path: &dyn Fn() -> Option<PathBuf>) -> Result<(Option<PathBuf>, Option<PathBuf>), String> {
    if let Some(p) = recall_ac_root(data)? { return Ok((Some(p), None)); }
    Ok((None, steam_path().and_then(|s| find_ac_in_steam(&s)).map(|p| plain_path(fs::canonicalize(&p).unwrap_or(p)))))
}

/// The Steam folder a TEST run looks in (D252: the startup card is tested on a FAKE Steam tree): when and ONLY when the app was LAUNCHED with
/// T180_TEST_STEAM_PATH set to an existing absolute folder, that folder stands in for the registry's SteamPath (like T180_TEST_APP_DATA in lib.rs:
/// a page cannot set a process's environment, and nothing in normal use sets this one).
pub fn test_steam_path(var: Option<String>) -> Option<PathBuf> {
    let p = PathBuf::from(var?);
    if p.is_absolute() && p.is_dir() { Some(p) } else { None }
}

/// Steam's folder: the test seam when the app was launched with one (and, set but not a folder, NOTHING: a test run never falls through to the
/// real registry), else the registry.
pub fn steam_path() -> Option<PathBuf> {
    steam_path_from(std::env::var_os("T180_TEST_STEAM_PATH"), &steam_path_from_registry)
}

/// steam_path with its inputs given (tested): `var` is the raw T180_TEST_STEAM_PATH. SET, it is the seam whatever it holds: a usable folder, or
/// nothing (a value that is not Unicode included: C's finding 3, env::var's Err used to fall through to the registry). Only UNSET reads `registry`.
pub fn steam_path_from(var: Option<std::ffi::OsString>, registry: &dyn Fn() -> Option<PathBuf>) -> Option<PathBuf> {
    match var {
        Some(v) => test_steam_path(v.into_string().ok()),
        None => registry(),
    }
}

/// Steam's folder from the registry, read with Windows' own reg.exe (no window); None when Steam is not installed or the
/// query fails, and then the app asks with the picker. Only the registry is read. Never called by a test.
pub fn steam_path_from_registry() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("reg").args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"]).creation_flags(CREATE_NO_WINDOW).output().ok()?;
        if !out.status.success() { return None; }
        steam_path_from_reg_output(&String::from_utf8_lossy(&out.stdout))
    }
    #[cfg(not(windows))]
    { None }
}

/// Install an exported folder into `<root>/content/tracks`: the export's own writer, so its guards all hold.
pub fn install_to(root: &Path, folder: &str, files: &[(String, Vec<u8>)]) -> Result<usize, String> {
    let tracks = tracks_of(root)?;
    if !super::valid_folder(folder) {
        return Err(format!("{folder:?} is not a folder the builder makes (t180b_…); nothing is installed outside the builder's own folders"));
    }
    super::write_export_to(&tracks, folder, files)
}

// ---- see it in Assetto (never run: see the header) ----
pub trait Spawner {
    /// Run `exe` with `args` in `cwd`, wait for it, kill it at `timeout`; the exit code, or why it could not run.
    fn run(&self, exe: &Path, args: &[String], cwd: &Path, timeout: Duration) -> Result<i32, String>;
}

/// The real process. Reachable only from `see_it_in_assetto`, behind the setting that is off by default.
pub struct RealSpawner;
impl Spawner for RealSpawner {
    fn run(&self, exe: &Path, args: &[String], cwd: &Path, timeout: Duration) -> Result<i32, String> {
        let mut child = std::process::Command::new(exe).args(args).current_dir(cwd).spawn().map_err(|e| format!("could not start {}: {e}", exe.display()))?;
        let start = Instant::now();
        loop {
            if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
                return Ok(st.code().unwrap_or(-1));
            }
            if start.elapsed() >= timeout {
                let _ = child.kill();   // this child only
                let _ = child.wait();
                return Err(format!("{} passed the {} s hard timeout and was killed", exe.display(), timeout.as_secs()));
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    }
}

pub fn launch_enabled(data: &Path) -> bool {
    fs::read_to_string(data.join(LAUNCH_SETTING)).map(|s| s.trim() == "yes").unwrap_or(false)
}

/// race.ini with [RACE] TRACK and CONFIG_TRACK set, every other line unchanged. The section and keys are added when absent.
pub fn race_ini_for(original: &str, track: &str, layout: &str) -> String {
    let eol = if original.contains("\r\n") { "\r\n" } else { "\n" };
    let mut out: Vec<String> = Vec::new();
    let (mut in_race, mut saw_race, mut done_track, mut done_cfg) = (false, false, false, false);
    let flush = |out: &mut Vec<String>, t: &mut bool, c: &mut bool| {
        if !*t { out.push(format!("TRACK={track}")); *t = true; }
        if !*c { out.push(format!("CONFIG_TRACK={layout}")); *c = true; }
    };
    for line in original.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if in_race { flush(&mut out, &mut done_track, &mut done_cfg); }
            in_race = trimmed.eq_ignore_ascii_case("[RACE]");
            saw_race |= in_race;
        } else if in_race {
            let key = trimmed.split('=').next().unwrap_or("").trim();
            if key.eq_ignore_ascii_case("TRACK") { out.push(format!("TRACK={track}")); done_track = true; continue; }
            if key.eq_ignore_ascii_case("CONFIG_TRACK") { out.push(format!("CONFIG_TRACK={layout}")); done_cfg = true; continue; }
        }
        out.push(line.to_string());
    }
    if in_race { flush(&mut out, &mut done_track, &mut done_cfg); }
    if !saw_race { out.push("[RACE]".into()); flush(&mut out, &mut done_track, &mut done_cfg); }
    let mut s = out.join(eol);
    if original.ends_with('\n') || original.is_empty() { s.push_str(eol); }
    s
}

#[derive(Debug)]
pub struct Plan { pub exe: PathBuf, pub args: Vec<String>, pub cwd: PathBuf, pub race_ini: PathBuf, pub track: String, pub layout: String }

/// What a launch WOULD do: acs.exe in the AC folder, no arguments, reading <docs>/cfg/race.ini. Only our own tracks.
pub fn launch_plan(root: &Path, docs: &Path, track: &str, layout: &str) -> Result<Plan, String> {
    if !super::valid_folder(track) {
        return Err(format!("{track:?}: only t180b_ tracks the builder made are launched"));
    }
    if !layout.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
        return Err(format!("{layout:?} is not a layout name"));
    }
    let tracks = tracks_of(root)?;
    if !tracks.join(track).join(super::MARKER_FILE).exists() {
        return Err(format!("{track} is not installed (no builder folder in {})", tracks.display()));
    }
    Ok(Plan { exe: root.join("acs.exe"), args: Vec::new(), cwd: root.to_path_buf(), race_ini: docs.join("cfg").join("race.ini"), track: track.into(), layout: layout.into() })
}

/// Back up race.ini, write the track into it, run, and ALWAYS restore it byte-exact (or remove it if there was none).
pub fn launch_with(plan: &Plan, sp: &dyn Spawner, stamp: &str) -> Result<i32, String> {
    let ini = &plan.race_ini;
    let original = match fs::read(ini) {
        Ok(b) => Some(b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("could not read {}: {e}", ini.display())),
    };
    let bak = PathBuf::from(format!("{}.bak-t180b-{stamp}", ini.display()));
    if let Some(b) = &original {
        if bak.exists() {
            return Err(format!("{} already exists; nothing touched", bak.display()));
        }
        fs::write(&bak, b).map_err(|e| format!("could not back up {}: {e}", ini.display()))?;
    }
    let run = (|| -> Result<i32, String> {
        let text = String::from_utf8_lossy(original.as_deref().unwrap_or(b"")).into_owned();
        if let Some(dir) = ini.parent() { fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
        fs::write(ini, race_ini_for(&text, &plan.track, &plan.layout)).map_err(|e| format!("could not write {}: {e}", ini.display()))?;
        sp.run(&plan.exe, &plan.args, &plan.cwd, HARD_TIMEOUT)
    })();
    // the finally: whatever happened above
    let restored = match &original {
        Some(b) => fs::write(ini, b).map_err(|e| format!("RESTORE FAILED, the backup is {}: {e}", bak.display())),
        None => match fs::remove_file(ini) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(e.to_string()) },
    };
    restored?;
    run
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("t180tb-ac-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    /// A fake AC folder: <d>/ac/content/tracks with one foreign track, and <d>/docs/cfg/race.ini.
    fn fake(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
        let d = scratch(tag);
        let ac = d.join("ac");
        fs::create_dir_all(ac.join("content").join("tracks").join("somebody_elses")).unwrap();
        fs::write(ac.join("content").join("tracks").join("somebody_elses").join("keep.kn5"), b"theirs").unwrap();
        let data = d.join("data");
        fs::create_dir_all(&data).unwrap();
        (d, ac, data)
    }
    fn files() -> Vec<(String, Vec<u8>)> { vec![("t180b_mine.kn5".into(), b"kn5".to_vec()), ("ui/ui_track.json".into(), b"{}".to_vec()), (MARKER_FILE_FOR_TESTS.into(), b"{}".to_vec())] }
    const MARKER_FILE_FOR_TESTS: &str = ".t180b-builder.json";

    #[test]
    fn the_ac_folder_is_remembered_and_read_back_and_a_folder_without_content_tracks_is_refused() {
        let (d, ac, data) = fake("root");
        assert_eq!(recall_ac_root(&data).unwrap(), None);
        let abs = remember_ac_root(&data, &ac).unwrap();
        assert_eq!(recall_ac_root(&data).unwrap(), Some(abs));
        assert!(remember_ac_root(&data, &d).unwrap_err().contains("no content\\tracks"));
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn the_remembered_ac_folder_is_the_path_a_user_would_type_with_no_verbatim_prefix() {
        let (d, ac, data) = fake("plain");
        let abs = remember_ac_root(&data, &ac).unwrap();
        let said = abs.to_string_lossy().to_string();
        assert!(!said.starts_with(r"\\?\"), "the install message would show {said}");
        assert!(abs.is_absolute() && tracks_of(&abs).is_ok(), "{said}");
        assert_eq!(fs::read_to_string(data.join(ROOT_FILE)).unwrap(), said);
        assert_eq!(plain_path(PathBuf::from(r"\\?\UNC\server\share\ac")), PathBuf::from(r"\\server\share\ac"));
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_first_install_and_a_reinstall_over_our_own_folder_land_and_a_foreign_folder_is_refused_untouched() {
        let (d, ac, _) = fake("install");
        assert_eq!(install_to(&ac, "t180b_mine", &files()).unwrap(), 3);
        let into = ac.join("content").join("tracks").join("t180b_mine");
        assert_eq!(fs::read(into.join("t180b_mine.kn5")).unwrap(), b"kn5");
        let mut again = files(); again[0].1 = b"kn5 v2".to_vec();
        assert_eq!(install_to(&ac, "t180b_mine", &again).unwrap(), 3);
        assert_eq!(fs::read(into.join("t180b_mine.kn5")).unwrap(), b"kn5 v2");
        // a t180b_ folder the builder did not write (no marker) is refused and left as it was
        fs::create_dir_all(ac.join("content").join("tracks").join("t180b_theirs")).unwrap();
        fs::write(ac.join("content").join("tracks").join("t180b_theirs").join("x"), b"x").unwrap();
        assert!(install_to(&ac, "t180b_theirs", &files()).unwrap_err().contains("was not written by the builder"));
        assert_eq!(fs::read_dir(ac.join("content").join("tracks").join("t180b_theirs")).unwrap().count(), 1);
        // and another author's folder can never be a target: the name is not ours
        assert!(install_to(&ac, "somebody_elses", &files()).unwrap_err().contains("not a folder the builder makes"));
        assert_eq!(fs::read(ac.join("content").join("tracks").join("somebody_elses").join("keep.kn5")).unwrap(), b"theirs");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn an_install_outside_content_tracks_is_refused_the_root_must_hold_it_and_a_path_cannot_leave_it() {
        let (d, ac, _) = fake("outside");
        assert!(install_to(&d, "t180b_mine", &files()).unwrap_err().contains("no content\\tracks"));
        assert!(install_to(&ac, "t180b_mine/../../x", &files()).unwrap_err().contains("not a folder the builder makes"));
        let escape = vec![("../../escape.txt".to_string(), b"x".to_vec())];
        assert!(install_to(&ac, "t180b_mine", &escape).unwrap_err().contains("not a file path inside the track folder"));
        assert!(!d.join("escape.txt").exists() && !ac.join("escape.txt").exists());
        fs::remove_dir_all(&d).unwrap();
    }

    struct Mock { seen: RefCell<Vec<(PathBuf, Vec<String>, PathBuf, Duration, String)>>, fail: bool }
    impl Spawner for Mock {
        fn run(&self, exe: &Path, args: &[String], cwd: &Path, timeout: Duration) -> Result<i32, String> {
            // what race.ini says WHILE the game would be running
            let ini = fs::read_to_string(cwd.parent().unwrap().join("docs").join("cfg").join("race.ini")).unwrap_or_default();
            self.seen.borrow_mut().push((exe.to_path_buf(), args.to_vec(), cwd.to_path_buf(), timeout, ini));
            if self.fail { Err("the mock crashed".into()) } else { Ok(0) }
        }
    }
    fn installed(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
        let (d, ac, _) = fake(tag);
        install_to(&ac, "t180b_mine", &files()).unwrap();
        let docs = d.join("docs");
        fs::create_dir_all(docs.join("cfg")).unwrap();
        (d, ac, docs)
    }

    #[test]
    fn a_launch_would_run_acs_exe_in_the_ac_folder_with_no_arguments_and_race_ini_is_backed_up_and_restored_byte_exact() {
        let (d, ac, docs) = installed("launch");
        let original = b"[HEADER]\r\nVERSION=2\r\n\r\n[RACE]\r\nTRACK=ks_monza\r\nCONFIG_TRACK=\r\nMODEL=my_car\r\n\r\n[CAR_0]\r\nMODEL=-\r\n".to_vec();
        fs::write(docs.join("cfg").join("race.ini"), &original).unwrap();
        let plan = launch_plan(&ac, &docs, "t180b_mine", "").unwrap();
        let mock = Mock { seen: RefCell::new(vec![]), fail: false };
        assert_eq!(launch_with(&plan, &mock, "20260927-000000").unwrap(), 0);
        let seen = mock.seen.borrow();
        assert_eq!(seen.len(), 1);
        assert_eq!((&seen[0].0, &seen[0].1, &seen[0].2, seen[0].3), (&ac.join("acs.exe"), &Vec::<String>::new(), &ac, HARD_TIMEOUT));
        assert!(seen[0].4.contains("TRACK=t180b_mine\r\n") && seen[0].4.contains("MODEL=my_car\r\n") && !seen[0].4.contains("ks_monza"), "while running: {}", seen[0].4);
        assert_eq!(fs::read(docs.join("cfg").join("race.ini")).unwrap(), original, "restored byte-exact");
        assert_eq!(fs::read(docs.join("cfg").join("race.ini.bak-t180b-20260927-000000")).unwrap(), original, "the backup is kept");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn race_ini_is_restored_in_the_finally_when_the_run_fails_and_removed_when_there_was_none() {
        let (d, ac, docs) = installed("finally");
        let original = b"[RACE]\nTRACK=x\n".to_vec();
        fs::write(docs.join("cfg").join("race.ini"), &original).unwrap();
        let plan = launch_plan(&ac, &docs, "t180b_mine", "").unwrap();
        let mock = Mock { seen: RefCell::new(vec![]), fail: true };
        assert!(launch_with(&plan, &mock, "a").unwrap_err().contains("crashed"));
        assert_eq!(fs::read(docs.join("cfg").join("race.ini")).unwrap(), original);
        fs::remove_file(docs.join("cfg").join("race.ini")).unwrap();
        let ok = Mock { seen: RefCell::new(vec![]), fail: false };
        launch_with(&plan, &ok, "b").unwrap();
        assert!(ok.seen.borrow()[0].4.contains("TRACK=t180b_mine"));
        assert!(!docs.join("cfg").join("race.ini").exists(), "no race.ini before, none after");
        // a backup of that stamp already there: refused before anything is written
        fs::write(docs.join("cfg").join("race.ini"), &original).unwrap();
        fs::write(docs.join("cfg").join("race.ini.bak-t180b-c"), b"older").unwrap();
        assert!(launch_with(&plan, &ok, "c").unwrap_err().contains("already exists"));
        assert_eq!(fs::read(docs.join("cfg").join("race.ini.bak-t180b-c")).unwrap(), b"older");
        fs::remove_dir_all(&d).unwrap();
    }

    // D264: Export to Assetto Corsa on an open track installs the TEST export as t180b_<name>_test: the same guards hold for that name
    #[test]
    fn a_test_export_folder_installs_under_the_same_guards() {
        let (d, ac, _) = fake("d264");
        assert_eq!(install_to(&ac, "t180b_mine_test", &files()).unwrap(), 3);
        assert_eq!(install_to(&ac, "t180b_mine_test", &files()).unwrap(), 3, "exporting again updates its own folder");
        let theirs = ac.join("content").join("tracks").join("t180b_theirs_test");
        fs::create_dir_all(&theirs).unwrap(); fs::write(theirs.join("x"), b"x").unwrap();
        assert!(install_to(&ac, "t180b_theirs_test", &files()).unwrap_err().contains("was not written by the builder"));
        assert_eq!(fs::read_dir(&theirs).unwrap().count(), 1);
        assert!(install_to(&ac, "mine_test", &files()).unwrap_err().contains("not a folder the builder makes"));
        fs::remove_dir_all(&d).unwrap();
    }
    #[test]
    fn only_an_installed_t180b_track_is_ever_planned_and_the_setting_is_off_by_default() {
        let (d, ac, docs) = installed("plan");
        assert!(launch_plan(&ac, &docs, "somebody_elses", "").is_err());
        assert!(launch_plan(&ac, &docs, "t180b_notthere", "").unwrap_err().contains("not installed"));
        assert!(launch_plan(&ac, &docs, "t180b_mine", "../x").is_err());
        assert!(!launch_enabled(&d.join("data")), "off unless the user turned it on");
        // a foreign folder carrying a copied marker file is still not ours: the name alone refuses it
        fs::write(ac.join("content").join("tracks").join("somebody_elses").join(MARKER_FILE_FOR_TESTS), b"{}").unwrap();
        assert!(launch_plan(&ac, &docs, "somebody_elses", "").unwrap_err().contains("only t180b_ tracks"));
        fs::remove_dir_all(&d).unwrap();
    }

    // ---- find AC through Steam (D250). A FAKE Steam tree and a FAKE registry (a closure); the real registry and the real
    // AC install are never read by a test.
    /// <d>/steam (Steam itself, no AC) and <d>/lib2 (a second library holding AC with content/tracks), linked by
    /// steam/steamapps/libraryfolders.vdf in the current format.
    fn fake_steam(tag: &str) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
        let d = scratch(tag);
        let (steam, lib2) = (d.join("steam"), d.join("lib2"));
        fs::create_dir_all(steam.join("steamapps").join("common")).unwrap();
        let ac = lib2.join("steamapps").join("common").join("assettocorsa");
        fs::create_dir_all(ac.join("content").join("tracks").join("somebody_elses")).unwrap();
        let esc = |p: &Path| p.to_string_lossy().replace('\\', "\\\\");
        let vdf = format!("\"libraryfolders\"\r\n{{\r\n\t\"0\"\r\n\t{{\r\n\t\t\"path\"\t\t\"{}\"\r\n\t\t\"label\"\t\t\"\"\r\n\t\t\"apps\"\r\n\t\t{{\r\n\t\t\t\"228980\"\t\t\"123\"\r\n\t\t}}\r\n\t}}\r\n\t\"1\"\r\n\t{{\r\n\t\t\"path\"\t\t\"{}\"\r\n\t\t\"apps\"\r\n\t\t{{\r\n\t\t\t\"244210\"\t\t\"456\"\r\n\t\t}}\r\n\t}}\r\n}}\r\n", esc(&steam), esc(&lib2));
        fs::write(steam.join("steamapps").join("libraryfolders.vdf"), vdf).unwrap();
        let data = d.join("data");
        fs::create_dir_all(&data).unwrap();
        (d, steam, ac, data)
    }

    #[test]
    fn steam_path_is_read_from_reg_query_output_and_anything_else_is_none() {
        let out = "\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n\r\n";
        assert_eq!(steam_path_from_reg_output(out), Some(PathBuf::from("c:/program files (x86)/steam")));
        assert_eq!(steam_path_from_reg_output("    SteamPath    REG_EXPAND_SZ    D:/Steam\r\n"), Some(PathBuf::from("D:/Steam")));
        assert_eq!(steam_path_from_reg_output("ERROR: The system was unable to find the specified registry key or value.\r\n"), None);
        assert_eq!(steam_path_from_reg_output("    SteamPathX    REG_SZ    D:/nope\r\n    SteamPath    REG_SZ    \r\n"), None, "another value, or an empty one");
    }

    #[test]
    fn libraryfolders_vdf_gives_every_library_in_both_formats_and_nothing_else() {
        let new = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t\t\"apps\"\n\t\t{\n\t\t\t\"244210\"\t\t\"38123\"\n\t\t}\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"E:\\\\SteamLibrary\"\n\t\t\"label\"\t\t\"games\"\n\t}\n}\n";
        assert_eq!(library_paths_from_vdf(new), vec![PathBuf::from(r"C:\Program Files (x86)\Steam"), PathBuf::from(r"E:\SteamLibrary")]);
        let old = "\"LibraryFolders\"\n{\n\t\"TimeNextStatsReport\"\t\t\"1600000000\"\n\t\"ContentStatsID\"\t\t\"-123\"\n\t\"1\"\t\t\"D:\\\\SteamLibrary\"\n}\n";
        assert_eq!(library_paths_from_vdf(old), vec![PathBuf::from(r"D:\SteamLibrary")]);
        assert!(library_paths_from_vdf("").is_empty() && library_paths_from_vdf("not a vdf at all").is_empty());
    }

    #[test]
    fn ac_is_found_in_any_steam_library_and_only_where_it_holds_content_tracks() {
        let (d, steam, ac, _) = fake_steam("find");
        assert_eq!(find_ac_in_steam(&steam), Some(steam.parent().unwrap().join("lib2").join("steamapps").join("common").join("assettocorsa")));
        assert!(ac.join("content").join("tracks").is_dir());
        // an assettocorsa folder with no content/tracks (a broken install) is not AC
        fs::remove_dir_all(ac.join("content")).unwrap();
        assert_eq!(find_ac_in_steam(&steam), None);
        // AC in Steam's own folder, with no libraryfolders.vdf at all
        fs::remove_file(steam.join("steamapps").join("libraryfolders.vdf")).unwrap();
        fs::create_dir_all(steam.join("steamapps").join("common").join("assettocorsa").join("content").join("tracks")).unwrap();
        assert_eq!(find_ac_in_steam(&steam), Some(steam.join("steamapps").join("common").join("assettocorsa")));
        assert_eq!(find_ac_in_steam(&d.join("no-steam-here")), None);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn with_no_folder_remembered_ac_is_found_through_steam_and_remembered_and_with_none_found_nothing_is_written() {
        let (d, steam, ac, data) = fake_steam("rootfind");
        // Steam not installed (the registry has no SteamPath): None, the app asks with the picker, nothing remembered
        assert_eq!(root_or_find(&data, &|| None).unwrap(), None);
        assert!(!data.join(ROOT_FILE).exists());
        // Steam there but AC in no library: the same
        assert_eq!(root_or_find(&data, &|| Some(d.join("elsewhere"))).unwrap(), None);
        assert!(!data.join(ROOT_FILE).exists());
        // found: remembered, so the next call reads it back without the registry
        let found = root_or_find(&data, &|| Some(steam.clone())).unwrap().unwrap();
        assert_eq!(fs::canonicalize(&found).unwrap(), fs::canonicalize(&ac).unwrap());
        assert_eq!(recall_ac_root(&data).unwrap(), Some(found.clone()));
        let asked = std::cell::Cell::new(false);
        assert_eq!(root_or_find(&data, &|| { asked.set(true); None }).unwrap(), Some(found.clone()));
        assert!(!asked.get(), "a remembered folder wins: the registry is not read");
        // and the install guards hold in the found folder: ours lands, another author's name never does
        assert_eq!(install_to(&found, "t180b_mine", &files()).unwrap(), 3);
        assert!(install_to(&found, "somebody_elses", &files()).unwrap_err().contains("not a folder the builder makes"));
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_picked_folder_still_wins_over_steam_and_a_remembered_folder_that_is_gone_is_looked_up_again() {
        let (d, steam, ac, data) = fake_steam("rootpick");
        let picked = d.join("picked");
        fs::create_dir_all(picked.join("content").join("tracks")).unwrap();
        let p = remember_ac_root(&data, &picked).unwrap();
        assert_eq!(root_or_find(&data, &|| Some(steam.clone())).unwrap(), Some(p));
        fs::remove_dir_all(&picked).unwrap();
        let again = root_or_find(&data, &|| Some(steam.clone())).unwrap().unwrap();
        assert_eq!(fs::canonicalize(&again).unwrap(), fs::canonicalize(&ac).unwrap());
        fs::remove_dir_all(&d).unwrap();
    }

    // D252 second item (the keeper, 11:39: "in the EXE startup, the user can choose where the track folder is in the beginning"): the startup card
    // asks root_status, which says what is remembered and, only when nothing is, what Steam finds, and REMEMBERS NOTHING (the user answers the card)
    #[test]
    fn root_status_says_what_is_remembered_or_what_steam_finds_and_writes_nothing() {
        let (d, steam, ac, data) = fake_steam("status");
        let (r, f) = root_status(&data, &|| Some(steam.clone())).unwrap();
        assert_eq!(r, None);
        assert_eq!(fs::canonicalize(f.unwrap()).unwrap(), fs::canonicalize(&ac).unwrap());
        assert!(!data.join(ROOT_FILE).exists(), "found, not remembered: the card asks first");
        assert_eq!(root_status(&data, &|| None).unwrap(), (None, None), "no Steam: nothing found, nothing written");
        assert!(!data.join(ROOT_FILE).exists());
        let picked = remember_ac_root(&data, &ac).unwrap();
        let asked = std::cell::Cell::new(false);
        assert_eq!(root_status(&data, &|| { asked.set(true); None }).unwrap(), (Some(picked), None), "remembered: said, Steam not asked");
        assert!(!asked.get());
        fs::remove_dir_all(&d).unwrap();
    }

    // D252 (the chair: "empty -> the card shows; remembered -> silent; gone -> the card again", on a FAKE Steam tree): the three startup states
    #[test]
    fn the_startup_card_shows_on_an_empty_folder_is_silent_once_remembered_and_shows_again_when_the_remembered_folder_is_gone() {
        let (d, steam, ac, data) = fake_steam("states");
        let steam_of = || Some(steam.clone());
        assert!(matches!(root_status(&data, &steam_of).unwrap(), (None, Some(_))), "empty: the card (Steam's find, nothing remembered)");
        let picked = d.join("picked"); fs::create_dir_all(picked.join("content").join("tracks")).unwrap();
        let r = remember_ac_root(&data, &picked).unwrap();
        assert_eq!(root_status(&data, &steam_of).unwrap(), (Some(r), None), "remembered: silent");
        fs::remove_dir_all(&picked).unwrap();
        let (gone, found) = root_status(&data, &steam_of).unwrap();
        assert_eq!(gone, None, "the remembered folder is gone: not remembered any more");
        assert_eq!(fs::canonicalize(found.unwrap()).unwrap(), fs::canonicalize(&ac).unwrap(), "and the card offers Steam's find again");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn the_test_steam_seam_takes_only_an_existing_absolute_folder() {
        let d = scratch("seam");
        assert_eq!(test_steam_path(Some(d.to_string_lossy().into_owned())), Some(d.clone()));
        assert_eq!(test_steam_path(None), None);
        assert_eq!(test_steam_path(Some("relative\\steam".into())), None, "relative: refused");
        assert_eq!(test_steam_path(Some(d.join("nope").to_string_lossy().into_owned())), None, "missing: refused");
        fs::remove_dir_all(&d).unwrap();
    }

    // C's finding 3 (p-spacefly-C_2026-10-06.md): env::var gave Err for a value that is not Unicode, and that fell through to the REAL registry. ANY set value
    // is the seam: a usable folder, or nothing; only an UNSET variable reads the registry
    #[cfg(windows)]
    #[test]
    fn a_set_but_unusable_test_steam_path_gives_nothing_even_when_it_is_not_unicode_and_only_unset_reads_the_registry() {
        use std::os::windows::ffi::OsStringExt;
        let asked = std::cell::Cell::new(0);
        let reg = || { asked.set(asked.get() + 1); Some(PathBuf::from(r"C:\would-be-the-real-steam")) };
        let bad = std::ffi::OsString::from_wide(&[0x0043, 0x003A, 0xD800]);   // "C:" then an unpaired surrogate: not valid Unicode
        assert_eq!(steam_path_from(Some(bad), &reg), None, "not Unicode: nothing");
        assert_eq!(steam_path_from(Some("relative".into()), &reg), None, "relative: nothing");
        assert_eq!(asked.get(), 0, "a set variable never reads the registry");
        let d = scratch("seamos");
        assert_eq!(steam_path_from(Some(d.clone().into_os_string()), &reg), Some(d.clone()), "an existing absolute folder: used");
        assert_eq!(steam_path_from(None, &reg), Some(PathBuf::from(r"C:\would-be-the-real-steam")), "unset: the registry");
        assert_eq!(asked.get(), 1);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn race_ini_edits_touch_only_track_and_config_track_and_add_them_when_absent() {
        assert_eq!(race_ini_for("[A]\nX=1\n[RACE]\nMODEL=c\nTRACK=old\n[B]\nY=2\n", "t180b_m", "long"), "[A]\nX=1\n[RACE]\nMODEL=c\nTRACK=t180b_m\nCONFIG_TRACK=long\n[B]\nY=2\n");
        assert_eq!(race_ini_for("", "t180b_m", ""), "[RACE]\nTRACK=t180b_m\nCONFIG_TRACK=\n");
    }
}
