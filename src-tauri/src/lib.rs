// T-180 Track Builder, native side (Tauri 2). The whole program — document model, geometry, validation, preview —
// runs in the webview (ARCHITECTURE §9: no mesh data over IPC). What only native code can do is keep the user's files,
// so this side is five commands and nothing else:
//   list_tracks · save_track(name, text) · open_track(name) · save_library(text) · open_library
// Tracks live in <app data>/tracks/<name>.t180track and the user's pieces in <app data>/library.t180lib, as the
// canonical text the document model writes (src/doc/serial.js). A name is checked here as well as in app/shell.js,
// so no path can ride in on a name. Writes go to a temporary file first and are renamed into place, so a crash
// mid-write never leaves half a track.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_tracks, save_track, open_track, save_library, open_library])
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
    fn the_track_list_holds_only_valid_names_of_track_files_sorted() {
        let d = scratch("list");
        for f in ["b.t180track", "a track.t180track", "notes.txt", "..odd.t180track", "c.t180track.bak"] {
            fs::write(d.join(f), "x").unwrap();
        }
        assert_eq!(track_names(&d).unwrap(), vec!["a track".to_string(), "b".to_string()]);
        fs::remove_dir_all(&d).unwrap();
    }
}
