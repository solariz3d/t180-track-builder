// T-180 Track Builder, native side (Tauri 2). The whole program — document model, geometry, validation, preview —
// runs in the webview (ARCHITECTURE §9: no mesh data over IPC). What only native code can do is keep the user's files,
// so this side is a handful of commands and nothing else:
//   list_tracks · save_track(name, text) · open_track(name) · save_library(text) · open_library
//   save_autosave(text) · open_autosave · clear_autosave: the unsaved track, for crash recovery
//   write_export(dir, folder, files): an exported track into the folder the user picked (never an AC install's other tracks)
//   get_ac_root · set_ac_root(path) · install_track(folder, files): INSTALL TO AC, into the remembered AC folder's
//   content/tracks (ac.rs); get_see_it_setting · set_see_it_setting(on) · see_it_in_assetto(track, layout): the launch,
//   OFF by default and never run by the builder's own tests (ac.rs header)
// plus the dialog plugin for picking that folder.
// Tracks live in <app data>/tracks/<name>.t180track and the user's pieces in <app data>/library.t180lib, as the
// canonical text the document model writes (src/doc/serial.js). A name is checked here as well as in app/shell.js,
// so no path can ride in on a name. Writes go to a temporary file first and are renamed into place, so a crash
// mid-write never leaves half a track.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

mod ac;

const TRACK_EXT: &str = "t180track";
const LIBRARY_FILE: &str = "library.t180lib";

/// 1 to 64 characters: ASCII letters, digits, space, '_' or '-', starting with a letter or digit.
pub fn valid_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(|b| b.is_ascii_alphanumeric() || matches!(b, b' ' | b'_' | b'-'))
}

/// Write `text` to `path` through a temporary file beside it, then rename it into place.
pub fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp-write");
    fs::write(&tmp, text).map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("could not move {} into place: {e}", path.display())
    })
}

/// The names of the tracks in `dir`: every `<name>.t180track` whose name is valid, sorted.
pub fn track_names(dir: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("could not list {}: {e}", dir.display()))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|x| x.to_str()) != Some(TRACK_EXT) {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            if valid_name(stem) {
                names.push(stem.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("no app data folder: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}
fn tracks_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("tracks");
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}
fn track_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!("{name:?} is not a track name: 1 to 64 letters, digits, spaces, _ or -"));
    }
    Ok(tracks_dir(app)?.join(format!("{name}.{TRACK_EXT}")))
}

#[tauri::command]
fn list_tracks(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    track_names(&tracks_dir(&app)?)
}

#[tauri::command]
fn save_track(app: tauri::AppHandle, name: String, text: String) -> Result<(), String> {
    write_atomic(&track_path(&app, &name)?, &text)
}

#[tauri::command]
fn open_track(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let path = track_path(&app, &name)?;
    fs::read_to_string(&path).map_err(|e| format!("could not open {}: {e}", path.display()))
}

#[tauri::command]
fn save_library(app: tauri::AppHandle, text: String) -> Result<(), String> {
    write_atomic(&data_dir(&app)?.join(LIBRARY_FILE), &text)
}

#[tauri::command]
fn open_library(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = data_dir(&app)?.join(LIBRARY_FILE);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| format!("could not open {}: {e}", path.display()))
}

// ---- D181 test seam (C, for the installed app's Export check): the folder the Export dialog would return, when and ONLY
// when the app was LAUNCHED with T180_TEST_EXPORT_FOLDER set to an existing absolute folder. A page cannot set a process's
// environment and nothing in normal use sets this one, so normal use always gets the native dialog (app/index.html
// falls back to it on None). It returns a path and does nothing else: the export is the unchanged write_export.
#[tauri::command]
fn test_export_folder() -> Option<String> {
    let p = std::env::var("T180_TEST_EXPORT_FOLDER").ok()?;
    let path = std::path::Path::new(&p);
    if path.is_absolute() && path.is_dir() { Some(p) } else { None }
}

// ---- the autosave: one file in the app data folder, written while a track has unsaved changes (app/shell.js)
const AUTOSAVE_FILE: &str = "autosave.t180auto";

#[tauri::command]
fn save_autosave(app: tauri::AppHandle, text: String) -> Result<(), String> {
    write_atomic(&data_dir(&app)?.join(AUTOSAVE_FILE), &text)
}

#[tauri::command]
fn open_autosave(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = data_dir(&app)?.join(AUTOSAVE_FILE);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| format!("could not open {}: {e}", path.display()))
}

#[tauri::command]
fn clear_autosave(app: tauri::AppHandle) -> Result<(), String> {
    let path = data_dir(&app)?.join(AUTOSAVE_FILE);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("could not clear {}: {e}", path.display())),
    }
}

// ---- the export: files the webview's exporter produced (src/export/fromwords.js, run in memory), written into the
// folder the user picked. The same guards as app/export/export.js, again here, because this is the side that writes.
const MARKER_FILE: &str = ".t180b-builder.json";

/// If `dir` is inside `…/content/tracks/<name>/…` with a <name> that does not start with t180b_, that name.
/// The builder writes only t180b_* folders into an Assetto Corsa install (never anything of anyone else's).
pub fn other_ac_track(dir: &str) -> Option<String> {
    let parts: Vec<&str> = dir.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    for i in 0..parts.len().saturating_sub(1) {
        if parts[i].eq_ignore_ascii_case("content") && parts[i + 1].eq_ignore_ascii_case("tracks") {
            if let Some(inside) = parts.get(i + 2) {
                if !inside.to_ascii_lowercase().starts_with("t180b_") {
                    return Some(inside.to_string());
                }
            }
        }
    }
    None
}

/// A folder name the exporter makes: t180b_ then lower-case letters, digits and underscores.
pub fn valid_folder(name: &str) -> bool {
    name.len() > 6 && name.len() <= 64 && name.starts_with("t180b_") && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// A relative file path inside the export folder: '/'-separated parts of letters, digits, '.', '_' or '-', and no part
/// that is '.' or '..' or starts with nothing.
pub fn valid_rel_path(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 200
        && p.split('/').all(|part| !part.is_empty() && part != "." && part != ".." && part.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')))
}

/// Standard base64 (with padding) to bytes. The export's files cross the bridge as base64 text.
pub fn decode_base64(s: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let b = s.as_bytes();
    if b.len() % 4 != 0 {
        return Err("base64 length is not a multiple of 4".into());
    }
    let mut out = Vec::with_capacity(b.len() / 4 * 3);
    for (ci, chunk) in b.chunks(4).enumerate() {
        let last = ci == b.len() / 4 - 1;
        let pad = chunk.iter().rev().take_while(|&&c| c == b'=').count();
        if pad > 2 || (pad > 0 && !last) {
            return Err("base64 padding is misplaced".into());
        }
        let mut n: u32 = 0;
        for (i, &c) in chunk.iter().enumerate() {
            let v = if i >= 4 - pad { 0 } else { val(c).ok_or_else(|| format!("{:?} is not a base64 character", c as char))? };
            n = (n << 6) | v;
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Ok(out)
}

#[derive(serde::Deserialize)]
struct ExportFile {
    path: String,
    data: String,
}

/// Write one exported folder under `dir`. Refuses a picked folder inside another track in an AC install, a folder name
/// the exporter would not make, a path that could leave the folder, and an existing folder the builder did not write.
pub fn write_export_to(dir: &Path, folder: &str, files: &[(String, Vec<u8>)]) -> Result<usize, String> {
    let shown = dir.to_string_lossy();
    if let Some(other) = other_ac_track(&shown) {
        return Err(format!("{shown} is inside another track's folder ({other}) in an Assetto Corsa install: the builder writes only t180b_* folders there"));
    }
    if !dir.is_dir() {
        return Err(format!("{shown} is not a folder"));
    }
    if !valid_folder(folder) {
        return Err(format!("{folder:?} is not a folder name the builder makes (t180b_…)"));
    }
    let target = dir.join(folder);
    if target.exists() && !target.join(MARKER_FILE).exists() {
        return Err(format!("{} exists and was not written by the builder (no {MARKER_FILE}); nothing touched", target.display()));
    }
    for (p, _) in files {
        if !valid_rel_path(p) {
            return Err(format!("{p:?} is not a file path inside the track folder"));
        }
    }
    for (p, bytes) in files {
        let dst = p.split('/').fold(target.clone(), |acc, part| acc.join(part));
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        let tmp = dst.with_extension("tmp-write");
        fs::write(&tmp, bytes).map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, &dst).map_err(|e| format!("could not move {} into place: {e}", dst.display()))?;
    }
    Ok(files.len())
}

#[tauri::command]
fn write_export(dir: String, folder: String, files: Vec<ExportFile>) -> Result<usize, String> {
    let decoded: Result<Vec<(String, Vec<u8>)>, String> = files.into_iter().map(|f| decode_base64(&f.data).map(|b| (f.path, b))).collect();
    write_export_to(Path::new(&dir), &folder, &decoded?)
}

/// `dir` is exactly `…/content/tracks/<name>` (nothing deeper) with a <name> that does not start with t180b_: the folder someone made by hand
/// for a track (D226). Content Manager reads such a folder, when it is empty, as a broken track.
pub fn direct_foreign_track(dir: &str) -> bool {
    let parts: Vec<&str> = dir.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    (0..parts.len().saturating_sub(2)).any(|i| {
        parts[i].eq_ignore_ascii_case("content") && parts[i + 1].eq_ignore_ascii_case("tracks") && parts.len() == i + 3 && !parts[i + 2].to_ascii_lowercase().starts_with("t180b_")
    })
}

/// The picked path ends in "." or "..": not a folder name (`…/content/tracks/.` is content/tracks itself).
pub fn ends_in_dot_name(dir: &str) -> bool {
    matches!(dir.split(['/', '\\']).filter(|p| !p.is_empty()).last(), Some(".") | Some(".."))
}

/// True only for a real (not linked) EMPTY folder that `direct_foreign_track` names.
pub fn is_empty_foreign_folder(dir: &Path) -> bool {
    !ends_in_dot_name(&dir.to_string_lossy())
        && direct_foreign_track(&dir.to_string_lossy())
        && fs::symlink_metadata(dir).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false)
        && fs::read_dir(dir).map(|mut r| r.next().is_none()).unwrap_or(false)
}

/// Remove that empty folder and nothing else: the checks again, then rmdir, which the OS refuses on a folder with anything in it.
pub fn remove_empty_foreign_folder(dir: &Path) -> Result<(), String> {
    if ends_in_dot_name(&dir.to_string_lossy()) {
        return Err(format!("{} ends in \".\" or \"..\", which is not a folder name: nothing removed", dir.display()));
    }
    if !is_empty_foreign_folder(dir) {
        return Err(format!("{} is not an empty folder directly in content\\tracks: nothing removed", dir.display()));
    }
    fs::remove_dir(dir).map_err(|e| format!("could not remove {}: {e}", dir.display()))
}

#[tauri::command]
fn folder_is_empty(dir: String) -> bool {
    is_empty_foreign_folder(Path::new(&dir))
}

#[tauri::command]
fn remove_empty_folder(dir: String) -> Result<(), String> {
    remove_empty_foreign_folder(Path::new(&dir))
}

// ---- Assetto Corsa: install, and the launch that is off by default (ac.rs) ----
fn decode_files(files: Vec<ExportFile>) -> Result<Vec<(String, Vec<u8>)>, String> {
    files.into_iter().map(|f| decode_base64(&f.data).map(|b| (f.path, b))).collect()
}

#[tauri::command]
fn get_ac_root(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(ac::recall_ac_root(&data_dir(&app)?)?.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn set_ac_root(app: tauri::AppHandle, path: String) -> Result<String, String> {
    Ok(ac::remember_ac_root(&data_dir(&app)?, Path::new(&path))?.to_string_lossy().into_owned())
}

#[tauri::command]
fn install_track(app: tauri::AppHandle, folder: String, files: Vec<ExportFile>) -> Result<usize, String> {
    let root = ac::recall_ac_root(&data_dir(&app)?)?.ok_or("no Assetto Corsa folder picked yet")?;
    ac::install_to(&root, &folder, &decode_files(files)?)
}

#[tauri::command]
fn get_see_it_setting(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(ac::launch_enabled(&data_dir(&app)?))
}

#[tauri::command]
fn set_see_it_setting(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    write_atomic(&data_dir(&app)?.join(ac::LAUNCH_SETTING), if on { "yes" } else { "no" })
}

/// Launches the game. Refused unless the user turned the setting on; the builder's own tests never call this.
// async: it waits for the game (up to the hard timeout), so it must not hold the window's thread.
#[tauri::command(async)]
fn see_it_in_assetto(app: tauri::AppHandle, track: String, layout: String) -> Result<i32, String> {
    let data = data_dir(&app)?;
    if !ac::launch_enabled(&data) {
        return Err("\"See it in Assetto\" is off. It launches the game; turn it on in the settings first.".into());
    }
    let root = ac::recall_ac_root(&data)?.ok_or("no Assetto Corsa folder picked yet")?;
    let docs = app.path().document_dir().map_err(|e| format!("no Documents folder: {e}"))?.join("Assetto Corsa");
    let plan = ac::launch_plan(&root, &docs, &track, &layout)?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs().to_string();
    ac::launch_with(&plan, &ac::RealSpawner, &stamp)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_tracks, save_track, open_track, save_library, open_library,
            save_autosave, open_autosave, clear_autosave, write_export, folder_is_empty, remove_empty_folder,
            get_ac_root, set_ac_root, install_track, get_see_it_setting, set_see_it_setting, see_it_in_assetto,
            test_export_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running the T-180 Track Builder");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_letters_digits_space_underscore_or_dash_and_never_a_path() {
        for good in ["a", "my track", "Track_2", "x-1", &"a".repeat(64)] {
            assert!(valid_name(good), "{good:?} should be a name");
        }
        for bad in ["", " lead", "-lead", "../evil", "a/b", "a\\b", "a.b", "a:b", &"a".repeat(65), "é"] {
            assert!(!valid_name(bad), "{bad:?} must not be a name");
        }
    }

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("t180tb-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_write_lands_whole_and_leaves_no_temporary_file() {
        let d = scratch("write");
        let p = d.join("t.t180track");
        write_atomic(&p, "first").unwrap();
        write_atomic(&p, "second, longer").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "second, longer");
        assert!(!p.with_extension("tmp-write").exists());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn the_ac_guard_allows_only_t180b_folders_inside_content_tracks() {
        let ac = r"G:\SteamLibrary\steamapps\common\assettocorsa\content\tracks";
        assert_eq!(other_ac_track(ac), None, "content\\tracks itself is fine: the builder writes a t180b_ folder there");
        assert_eq!(other_ac_track(&format!(r"{ac}\t180b_mine")), None);
        assert_eq!(other_ac_track(&format!(r"{ac}\somebody_elses")), Some("somebody_elses".to_string()));
        assert_eq!(other_ac_track(&format!(r"{ac}\somebody_elses\ui")), Some("somebody_elses".to_string()));
        assert_eq!(other_ac_track(r"C:\Users\x\Content\Tracks\Other"), Some("Other".to_string()), "case does not hide it");
        assert_eq!(other_ac_track(r"C:\Users\x\exports"), None);
    }

    #[test]
    fn export_paths_and_folder_names_cannot_leave_the_track_folder() {
        for good in ["t180b_x.kn5", "ai/fast_lane.ai", "ui/ui_track.json", ".t180b-builder.json"] {
            assert!(valid_rel_path(good), "{good}");
        }
        for bad in ["", "../x", "ai/../../x", "/abs", "a//b", "a\\b", "ai/./x", "c:x"] {
            assert!(!valid_rel_path(bad), "{bad}");
        }
        assert!(valid_folder("t180b_app_loop"));
        for bad in ["t180b_", "other", "t180b_Upper", "t180b_../x", "T180B_x"] {
            assert!(!valid_folder(bad), "{bad}");
        }
    }

    #[test]
    fn base64_decodes_as_the_webview_encodes() {
        assert_eq!(decode_base64("").unwrap(), b"");
        assert_eq!(decode_base64("Zg==").unwrap(), b"f");
        assert_eq!(decode_base64("Zm8=").unwrap(), b"fo");
        assert_eq!(decode_base64("Zm9v").unwrap(), b"foo");
        assert_eq!(decode_base64("AP8A/w==").unwrap(), vec![0, 255, 0, 255]);
        assert!(decode_base64("Zm9").is_err());
        assert!(decode_base64("Z=9v").is_err());
        assert!(decode_base64("Zm9*").is_err());
    }

    #[test]
    fn an_export_writes_its_files_and_refuses_a_folder_it_did_not_write() {
        let d = scratch("export");
        let files = vec![(".t180b-builder.json".to_string(), b"{}".to_vec()), ("ai/fast_lane.ai".to_string(), vec![7, 0, 0, 0])];
        assert_eq!(write_export_to(&d, "t180b_one", &files).unwrap(), 2);
        assert_eq!(fs::read(d.join("t180b_one").join("ai").join("fast_lane.ai")).unwrap(), vec![7, 0, 0, 0]);
        assert_eq!(write_export_to(&d, "t180b_one", &files).unwrap(), 2, "our own folder may be written again");
        fs::create_dir_all(d.join("t180b_theirs")).unwrap();
        fs::write(d.join("t180b_theirs").join("keep.txt"), "mine").unwrap();
        let err = write_export_to(&d, "t180b_theirs", &files).unwrap_err();
        assert!(err.contains("was not written by the builder"), "{err}");
        assert_eq!(fs::read_to_string(d.join("t180b_theirs").join("keep.txt")).unwrap(), "mine");
        assert!(write_export_to(&d, "t180b_two", &[("../escape".to_string(), vec![1])]).is_err());
        assert!(!d.join("escape").exists());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn only_an_empty_folder_made_directly_in_content_tracks_is_removed() {
        let root = scratch("emptyfolder");
        let tracks = root.join("content").join("tracks");
        let mine = tracks.join("T-180 TUBE OVAL");
        fs::create_dir_all(&mine).unwrap();
        assert!(direct_foreign_track(&mine.to_string_lossy()) && is_empty_foreign_folder(&mine));
        // anything in it, even a nested empty folder: never removed
        fs::create_dir_all(mine.join("sub")).unwrap();
        assert!(!is_empty_foreign_folder(&mine));
        assert!(remove_empty_foreign_folder(&mine).is_err() && mine.join("sub").is_dir());
        fs::remove_dir(mine.join("sub")).unwrap();
        fs::write(mine.join("keep.txt"), "mine").unwrap();
        assert!(remove_empty_foreign_folder(&mine).is_err());
        assert_eq!(fs::read_to_string(mine.join("keep.txt")).unwrap(), "mine");
        fs::remove_file(mine.join("keep.txt")).unwrap();
        // not direct (deeper), not content/tracks itself, not a t180b_ folder, not a file, not outside content/tracks
        let deeper = mine.join("deeper");
        fs::create_dir_all(&deeper).unwrap();
        assert!(!is_empty_foreign_folder(&deeper) && remove_empty_foreign_folder(&deeper).is_err() && deeper.is_dir());
        fs::remove_dir(&deeper).unwrap();
        assert!(!direct_foreign_track(&tracks.to_string_lossy()) && !is_empty_foreign_folder(&tracks));
        let ours = tracks.join("t180b_mine");
        fs::create_dir_all(&ours).unwrap();
        assert!(!is_empty_foreign_folder(&ours) && ours.is_dir());
        let elsewhere = root.join("exports");
        fs::create_dir_all(&elsewhere).unwrap();
        assert!(!is_empty_foreign_folder(&elsewhere) && elsewhere.is_dir());
        fs::write(tracks.join("a_file"), "x").unwrap();
        assert!(!is_empty_foreign_folder(&tracks.join("a_file")));
        // the empty one goes, and only it
        assert!(remove_empty_foreign_folder(&mine).is_ok() && !mine.exists());
        assert!(tracks.is_dir() && ours.is_dir() && tracks.join("a_file").is_file());
        assert!(remove_empty_foreign_folder(&mine).is_err(), "already gone");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_dot_or_dot_dot_name_is_never_a_folder_to_remove() {
        let root = scratch("dotnames");
        let tracks = root.join("content").join("tracks");
        fs::create_dir_all(&tracks).unwrap(); // EMPTY content/tracks: `tracks/.` would otherwise read as an empty folder directly in it
        for name in [".", ".."] {
            let p = PathBuf::from(format!("{}{}{}", tracks.display(), std::path::MAIN_SEPARATOR, name));
            assert!(ends_in_dot_name(&p.to_string_lossy()), "{name}");
            assert!(!is_empty_foreign_folder(&p), "{name} reads as an empty foreign folder");
            let err = remove_empty_foreign_folder(&p).unwrap_err();
            assert!(err.contains("not a folder name"), "{name}: {err}");
            assert!(tracks.is_dir(), "content/tracks survived {name}");
        }
        assert!(!ends_in_dot_name(&tracks.join("T-180 OVAL").to_string_lossy()));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_track_list_holds_only_valid_names_of_track_files_sorted() {
        let d = scratch("list");
        for f in ["b.t180track", "a track.t180track", "notes.txt", "..odd.t180track", "c.t180track.bak"] {
            fs::write(d.join(f), "x").unwrap();
        }
        assert_eq!(track_names(&d).unwrap(), vec!["a track".to_string(), "b".to_string()]);
        fs::remove_dir_all(&d).unwrap();
    }
}
