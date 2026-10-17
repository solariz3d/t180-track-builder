// T-180 Track Builder, native side (Tauri 2). The whole program — document model, geometry, validation, preview —
// runs in the webview (ARCHITECTURE §9: no mesh data over IPC). What only native code can do is keep the user's files,
// so this side is a handful of commands and nothing else:
//   list_tracks · save_track(name, text, stamp) · open_track(name) · save_library(text) · open_library
//   backup_track(name, text, stamp) · list_track_backups(name) · open_track_backup(file): SAVE KEEPS THE PREVIOUS VERSION (backups.rs)
// A launch-time T180_TEST_APP_DATA (an existing absolute folder) moves every kept file there, for test runs (test_app_data).
// A launch-time T180_TEST_STEAM_PATH (an existing absolute folder) is the Steam folder a test run looks in (ac.rs test_steam_path, D252).
//   save_autosave(text) · open_autosave · clear_autosave: the unsaved track, for crash recovery
//   write_export(dir, folder, files): an exported track into the folder the user picked (never an AC install's other tracks)
//   get_ac_root · set_ac_root(path) · install_track(folder, files): INSTALL TO AC, into the remembered AC folder's
//   content/tracks (ac.rs); with none remembered, get_ac_root finds AC through Steam and remembers it (D250, ac.rs root_or_find);
//   find_ac_root: the startup card's question, { remembered, found } (D252, ac.rs root_status), which remembers nothing; get_see_it_setting · set_see_it_setting(on) · see_it_in_assetto(track, layout): the launch,
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
mod backups;

const TRACK_EXT: &str = "t180track";
const LIBRARY_FILE: &str = "library.t180lib";
const PIECE_EXT: &str = "t180piece";
const UNDO_EXT: &str = "t180undo";

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
    names_with_ext(dir, TRACK_EXT)
}

/// The names of the files in `dir` that end `.<ext>` and have a valid name, sorted (a track list and a piece list are read the same way).
pub fn names_with_ext(dir: &Path, ext: &str) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("could not list {}: {e}", dir.display()))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|x| x.to_str()) != Some(ext) {
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

/// THE TEST APP-DATA SEAM (B's D239 look, F2; the real fix for C's 09:06 incident, when a window test run shared the keeper's folder while his
/// app started): when and ONLY when the app was LAUNCHED with T180_TEST_APP_DATA set to an existing absolute folder, every file the app keeps
/// (tracks, backups, the autosave, the AC folder and the launch setting) lives there instead. Like T180_TEST_EXPORT_FOLDER, a page cannot set a
/// process's environment and nothing in normal use sets this one, so normal use always gets the real app data folder.
pub fn test_app_data(var: Option<String>) -> Option<PathBuf> {
    let p = PathBuf::from(var?);
    if p.is_absolute() && p.is_dir() { Some(p) } else { None }
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = test_app_data(std::env::var("T180_TEST_APP_DATA").ok()) {
        return Ok(dir);
    }
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

// D240, SAVED PIECES: runs of pieces the user kept from their tracks, one `<name>.t180piece` each in the app's `pieces` folder (the text is the page's, schema
// t180b.piece/1, checked there by src/core/piece.js; this side only keeps and returns it). A name is a track's name (no path can ride in it). Saving never
// overwrites unless `replace` is set (the page never sets it: a piece is deleted first, on purpose), so two pieces can never be lost to one name.
pub fn piece_file(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!("{name:?} is not a piece name: 1 to 64 letters, digits, spaces, _ or -"));
    }
    Ok(dir.join(format!("{name}.{PIECE_EXT}")))
}
pub fn save_piece_file(dir: &Path, name: &str, text: &str, replace: bool) -> Result<(), String> {
    let path = piece_file(dir, name)?;
    if path.exists() && !replace {
        return Err(format!("a piece named {name:?} already exists; delete it first or use another name"));
    }
    write_atomic(&path, text)
}
pub fn open_piece_file(dir: &Path, name: &str) -> Result<String, String> {
    let path = piece_file(dir, name)?;
    fs::read_to_string(&path).map_err(|e| format!("could not read the piece {name:?}: {e}"))
}
pub fn delete_piece_file(dir: &Path, name: &str) -> Result<(), String> {
    let path = piece_file(dir, name)?;
    fs::remove_file(&path).map_err(|e| format!("could not delete the piece {name:?}: {e}"))
}
fn pieces_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("pieces");
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}
#[tauri::command]
fn list_pieces(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    names_with_ext(&pieces_dir(&app)?, PIECE_EXT)
}
#[tauri::command]
fn open_piece(app: tauri::AppHandle, name: String) -> Result<String, String> {
    open_piece_file(&pieces_dir(&app)?, &name)
}
#[tauri::command]
fn save_piece(app: tauri::AppHandle, name: String, text: String, replace: Option<bool>) -> Result<(), String> {
    save_piece_file(&pieces_dir(&app)?, &name, &text, replace.unwrap_or(false))
}
#[tauri::command]
fn delete_piece(app: tauri::AppHandle, name: String) -> Result<(), String> {
    delete_piece_file(&pieces_dir(&app)?, &name)
}

fn backups_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(backups::DIR))
}

/// SAVE KEEPS THE PREVIOUS VERSION (D239 amendment, backups.rs): the file this save overwrites is first MOVED to track-backups as
/// <name>.<stamp>.t180track; if the new text then cannot be written, it is moved back, so a failed save never loses the track. Then
/// this track's stamped backups are pruned to the newest 20. Returns the backup's file name, or null on a first save.
#[tauri::command]
fn save_track(app: tauri::AppHandle, name: String, text: String, stamp: Option<String>) -> Result<Option<String>, String> {
    let path = track_path(&app, &name)?;
    let kept = backups::save(&path, &backups_dir(&app)?, &name, &backups::stamp_or_now(stamp.as_deref()), &text)?;   // F3b: a failed prune is logged, not a failed save
    Ok(kept.and_then(|k| k.file_name().and_then(|f| f.to_str()).map(String::from)))
}

/// A copy of the track AS IT IS NOW in track-backups (the shell's backupNow: before a Close, so a Close can be undone after the app
/// is closed). Pruned like a save's. Returns the backup's file name.
#[tauri::command]
fn backup_track(app: tauri::AppHandle, name: String, text: String, stamp: Option<String>) -> Result<String, String> {
    if !valid_name(&name) {
        return Err(format!("{name:?} is not a track name: 1 to 64 letters, digits, spaces, _ or -"));
    }
    let to = backups::copy(&backups_dir(&app)?, &name, &backups::stamp_or_now(stamp.as_deref()), &text)?;   // as save: a failed prune is logged
    Ok(to.file_name().and_then(|f| f.to_str()).unwrap_or_default().to_string())
}

/// The previous versions of one track, newest first.
#[tauri::command]
fn list_track_backups(app: tauri::AppHandle, name: String) -> Result<Vec<backups::Backup>, String> {
    if !valid_name(&name) {
        return Err(format!("{name:?} is not a track name"));
    }
    backups::list(&backups_dir(&app)?, &name)
}

/// One previous version's text, by its bare file name.
#[tauri::command]
fn open_track_backup(app: tauri::AppHandle, file: String) -> Result<String, String> {
    backups::read(&backups_dir(&app)?, &file)
}

#[tauri::command]
fn open_track(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let path = track_path(&app, &name)?;
    fs::read_to_string(&path).map_err(|e| format!("could not open {}: {e}", path.display()))
}

// D272, THE UNDO SIDECAR: `<name>.t180undo` beside `<name>.t180track` in the tracks folder, the page's undo history for that track (JSON, schema core-undo; this side only keeps and returns the text, the page
// checks it against the track before using it). It has its own extension, so track_names never lists it, a track's backups never copy it, and the track file is the same bytes with or without it. A name is a
// track's name (no path can ride in it). A sidecar that is not there is Ok(None), not an error: most tracks have none.
pub fn undo_file(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!("{name:?} is not a track name: 1 to 64 letters, digits, spaces, _ or -"));
    }
    Ok(dir.join(format!("{name}.{UNDO_EXT}")))
}
pub fn save_undo_file(dir: &Path, name: &str, text: &str) -> Result<(), String> {
    write_atomic(&undo_file(dir, name)?, text)
}
pub fn open_undo_file(dir: &Path, name: &str) -> Result<Option<String>, String> {
    let path = undo_file(dir, name)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| format!("could not read {}: {e}", path.display()))
}
#[tauri::command]
fn save_undo(app: tauri::AppHandle, name: String, text: String) -> Result<(), String> {
    save_undo_file(&tracks_dir(&app)?, &name, &text)
}
#[tauri::command]
fn open_undo(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    open_undo_file(&tracks_dir(&app)?, &name)
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

// ---- D340, THE LATE-INPUT LOG: the key events the page handled late (app/preview/preview.js checkLate), one JSON line each (app/core/inputlog.js), kept in
// input-late.log in the app data folder, beside tracks\, so a coasting camera mid-drive can be read afterwards. The file is capped: an append that would take it
// past INPUT_LOG_CAP keeps only the newest whole lines, about half the cap, then appends.
const INPUT_LOG_FILE: &str = "input-late.log";
const INPUT_LOG_CAP: u64 = 256 * 1024;

/// Append `text` (whole lines) to `path`, keeping the file at most `cap` bytes: past the cap, the oldest lines go first (whole lines, newest kept).
pub fn append_capped(path: &Path, text: &str, cap: u64) -> Result<(), String> {
    use std::io::Write;
    let tail = |s: &str, budget: u64| -> String {
        if (s.len() as u64) <= budget { return s.to_string(); }
        let from = s.len() - budget as usize;
        match s.as_bytes()[from..].iter().position(|&b| b == b'\n') { Some(i) => s[from + i + 1..].to_string(), None => String::new() }
    };
    let text = tail(text, cap);
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size + text.len() as u64 <= cap {
        let mut f = fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| format!("could not open {}: {e}", path.display()))?;
        return f.write_all(text.as_bytes()).map_err(|e| format!("could not append to {}: {e}", path.display()));
    }
    let old = fs::read_to_string(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let kept = tail(&old, (cap / 2).saturating_sub(text.len() as u64));
    write_atomic(path, &format!("{kept}{text}"))
}

/// Run OFF the main thread (Tauri v2 runs a plain command on the main thread, the one that pumps the window's messages): a write here never holds a key up.
#[tauri::command(async)]
fn append_input_log(app: tauri::AppHandle, text: String) -> Result<(), String> {
    append_capped(&data_dir(&app)?.join(INPUT_LOG_FILE), &text, INPUT_LOG_CAP)
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

// ---- File ▸ Export layouts… (D361 part 2, G3): the same write, then what the folder's PREVIOUS marker listed and this export
// does not write is removed, so a layout left out of a re-export is gone from Content Manager (it lists every ui/*/ui_track.json).
// Only paths that marker listed (src/export/layouts.js staleFiles is the same rule), only plain files, never through a link or a
// junction, and then each folder they leave empty, never the track folder itself. A file somebody added is in no marker of ours
// and is never touched; a marker that cannot be read removes nothing.

/// The paths the previous marker lists that are not among `new_paths`: inside the folder, never the marker itself, each once.
pub fn stale_from_marker(marker: &str, new_paths: &[&str]) -> Vec<String> {
    let v: serde_json::Value = match serde_json::from_str(marker) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(list) = v.get("files").and_then(|f| f.as_array()) else { return Vec::new() };
    let mut out: Vec<String> = Vec::new();
    for p in list.iter().filter_map(|f| f.as_str()) {
        if valid_rel_path(p) && p != MARKER_FILE && !new_paths.contains(&p) && !out.iter().any(|x| x == p) {
            out.push(p.to_string());
        }
    }
    out
}

/// True when every folder from `target` down to `file`'s parent is a real folder (not a link or a junction) and `file` is a plain file.
fn plain_file_inside(target: &Path, rel: &str) -> bool {
    let mut at = target.to_path_buf();
    let parts: Vec<&str> = rel.split('/').collect();
    for (i, part) in parts.iter().enumerate() {
        at = at.join(part);
        let Ok(md) = fs::symlink_metadata(&at) else { return false };
        if md.file_type().is_symlink() {
            return false;
        }
        let last = i + 1 == parts.len();
        if (last && !md.is_file()) || (!last && !md.is_dir()) {
            return false;
        }
    }
    true
}

/// Write the folder as write_export_to does, then remove its previous export's stale files. Returns (files written, paths removed).
pub fn write_layouts_export_to(dir: &Path, folder: &str, files: &[(String, Vec<u8>)]) -> Result<(usize, Vec<String>), String> {
    let target = dir.join(folder);
    let previous = if valid_folder(folder) { fs::read_to_string(target.join(MARKER_FILE)).ok() } else { None };
    let written = write_export_to(dir, folder, files)?;
    let mut removed = Vec::new();
    if let Some(marker) = previous {
        let new_paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
        for rel in stale_from_marker(&marker, &new_paths) {
            if !plain_file_inside(&target, &rel) {
                continue;
            }
            let f = rel.split('/').fold(target.clone(), |acc, part| acc.join(part));
            fs::remove_file(&f).map_err(|e| format!("could not remove {}: {e}", f.display()))?;
            removed.push(rel);
            let mut d = f.parent().map(Path::to_path_buf);
            while let Some(here) = d {
                if here == target || !here.starts_with(&target) || fs::read_dir(&here).map(|mut r| r.next().is_some()).unwrap_or(true) || fs::remove_dir(&here).is_err() {
                    break;
                }
                d = here.parent().map(Path::to_path_buf);
            }
        }
    }
    Ok((written, removed))
}

#[derive(serde::Serialize)]
struct LayoutsWritten {
    written: usize,
    removed: Vec<String>,
}

#[tauri::command]
fn write_layouts_export(dir: String, folder: String, files: Vec<ExportFile>) -> Result<LayoutsWritten, String> {
    let decoded: Result<Vec<(String, Vec<u8>)>, String> = files.into_iter().map(|f| decode_base64(&f.data).map(|b| (f.path, b))).collect();
    let (written, removed) = write_layouts_export_to(Path::new(&dir), &folder, &decoded?)?;
    Ok(LayoutsWritten { written, removed })
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
    // D250: none remembered -> found through Steam (and remembered), so the first export into AC asks for nothing
    Ok(ac::root_or_find(&data_dir(&app)?, &ac::steam_path)?.map(|p| p.to_string_lossy().into_owned()))
}

/// D252: the startup card's question. The remembered AC folder, or else the one Steam finds; nothing is remembered (the card's Use it does that).
#[derive(serde::Serialize)]
struct AcRootStatus { remembered: Option<String>, found: Option<String> }

#[tauri::command]
fn find_ac_root(app: tauri::AppHandle) -> Result<AcRootStatus, String> {
    let (r, f) = ac::root_status(&data_dir(&app)?, &ac::steam_path)?;
    Ok(AcRootStatus { remembered: r.map(|p| p.to_string_lossy().into_owned()), found: f.map(|p| p.to_string_lossy().into_owned()) })
}

#[tauri::command]
fn set_ac_root(app: tauri::AppHandle, path: String) -> Result<String, String> {
    Ok(ac::remember_ac_root(&data_dir(&app)?, Path::new(&path))?.to_string_lossy().into_owned())
}

// ---- D372: A RE-EXPORT THAT CHANGES A TRACK'S SHAPE RETIRES ITS STALE GHOST AND HUD LAPS. Assetto Corsa keys a track's ghost by the FOLDER NAME
// (Documents\Assetto Corsa\GhostCar\<folder>\), and the CMRT Essential HUD its laps the same way (Documents\Assetto Corsa\CMRT-Essential-HUD\
// <folder>[#]<car>[v1]fast.lap, s1.lap), so after the road changed shape the old ghost drove through the air (ELYSIUM, 2026-10-17). The export's marker
// carries the road's geometry hash (src/export/fromwords.js geometryOf); the install reads the PREVIOUS marker before it is overwritten, and when both
// carry a hash and they differ, the ghost folder and that track's lap files are MOVED into a dated backup beside them (<folder>.retired-<UTC stamp>),
// never deleted: moving them back restores them. The same hash (a texture-only re-export), a first install (no marker), or a marker from before the hash
// (nothing proves the shape changed) moves nothing. Only names exactly the track's, only a real folder and plain files, never through a link or a
// junction (as write_layouts_export_to). A move that fails is reported and the install stands.

/// The geometry hash a marker carries, "sha256:" and 64 hex digits, or None (no marker field, another form, or a marker that is not JSON).
pub fn marker_geometry(marker: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(marker).ok()?;
    let g = v.get("geometry")?.as_str()?;
    let hex = g.strip_prefix("sha256:")?;
    (hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit())).then(|| g.to_string())
}

/// A UTC time stamp for a backup's name, yyyy-mm-dd_hhmmssZ (the Z says UTC; the native side has no time zone of its own).
pub fn utc_stamp(secs: u64) -> String {
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    // days since 1970-01-01 to a civil date (H. Hinnant's days_from_civil, inverted)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}_{:02}{:02}{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// A real folder: it exists, and it is neither a link nor a junction.
fn real_dir(p: &Path) -> bool {
    fs::symlink_metadata(p).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false)
}

/// `in_dir\name`, or name-2, name-3, … when that is taken: a backup never goes over another.
fn free_name(in_dir: &Path, name: &str) -> PathBuf {
    let first = in_dir.join(name);
    if fs::symlink_metadata(&first).is_err() { return first; }
    (2..).map(|n| in_dir.join(format!("{name}-{n}"))).find(|p| fs::symlink_metadata(p).is_err()).expect("a free name")
}

/// Move docs\GhostCar\<folder>\ (when it holds anything) and docs\CMRT-Essential-HUD\<folder>[#]* (plain files) into dated backups beside them.
/// Returns what moved, relative to docs. Only t180b_ folders; nothing through a link or a junction.
pub fn retire_stale_laps(docs: &Path, folder: &str, stamp: &str) -> Result<Vec<String>, String> {
    if !valid_folder(folder) {
        return Err(format!("{folder:?} is not a folder the builder makes (t180b_…): nothing of it is moved"));
    }
    let backup = format!("{folder}.retired-{stamp}");
    let mut moved = Vec::new();
    let ghosts = docs.join("GhostCar");
    let ghost = ghosts.join(folder);
    if real_dir(&ghosts) && real_dir(&ghost) && fs::read_dir(&ghost).map(|mut r| r.next().is_some()).unwrap_or(false) {
        let to = free_name(&ghosts, &backup);
        fs::rename(&ghost, &to).map_err(|e| format!("could not move {} to {}: {e}", ghost.display(), to.display()))?;
        moved.push(format!("GhostCar/{}", to.file_name().unwrap_or_default().to_string_lossy()));
    }
    let hud = docs.join("CMRT-Essential-HUD");
    if real_dir(&hud) {
        let prefix = format!("{folder}[#]");
        let mut laps: Vec<String> = fs::read_dir(&hud).map_err(|e| format!("could not read {}: {e}", hud.display()))?
            .filter_map(|e| e.ok())
            .filter(|e| fs::symlink_metadata(e.path()).map(|m| m.is_file() && !m.file_type().is_symlink()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(&prefix))
            .collect();
        laps.sort();
        if !laps.is_empty() {
            let to = free_name(&hud, &backup);
            fs::create_dir(&to).map_err(|e| format!("could not make {}: {e}", to.display()))?;
            let dir = to.file_name().unwrap_or_default().to_string_lossy().into_owned();
            for n in laps {
                fs::rename(hud.join(&n), to.join(&n)).map_err(|e| format!("could not move {n} into {}: {e}", to.display()))?;
                moved.push(format!("CMRT-Essential-HUD/{dir}/{n}"));
            }
        }
    }
    Ok(moved)
}

/// What install_track hands back: the files written, and what was retired (empty when the shape did not change).
#[derive(serde::Serialize, Debug)]
pub struct Installed { pub files: usize, pub retired: Vec<String>, pub retire_error: Option<String> }

/// Install as ac::install_to does; when the previous marker and this one carry different geometry hashes, retire the stale laps (retire_stale_laps).
pub fn install_with_retire(root: &Path, docs: &Path, folder: &str, files: &[(String, Vec<u8>)], stamp: &str) -> Result<Installed, String> {
    let previous = if valid_folder(folder) { ac::tracks_of(root).ok().and_then(|t| fs::read_to_string(t.join(folder).join(MARKER_FILE)).ok()) } else { None };
    let new_marker = files.iter().find(|(p, _)| p == MARKER_FILE).and_then(|(_, b)| std::str::from_utf8(b).ok());
    let changed = match (previous.as_deref().and_then(marker_geometry), new_marker.and_then(marker_geometry)) { (Some(a), Some(b)) => a != b, _ => false };
    let n = ac::install_to(root, folder, files)?;
    if !changed { return Ok(Installed { files: n, retired: Vec::new(), retire_error: None }); }
    match retire_stale_laps(docs, folder, stamp) {
        Ok(retired) => Ok(Installed { files: n, retired, retire_error: None }),
        Err(e) => Ok(Installed { files: n, retired: Vec::new(), retire_error: Some(e) }),   // the install stands; the reason is handed back
    }
}

#[tauri::command]
fn install_track(app: tauri::AppHandle, folder: String, files: Vec<ExportFile>) -> Result<Installed, String> {
    let root = ac::recall_ac_root(&data_dir(&app)?)?.ok_or("no Assetto Corsa folder picked yet")?;
    let docs = app.path().document_dir().map_err(|e| format!("no Documents folder: {e}"))?.join("Assetto Corsa");
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    install_with_retire(&root, &docs, &folder, &decode_files(files)?, &utc_stamp(secs))
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
            list_tracks, save_track, open_track, backup_track, list_track_backups, open_track_backup, save_library, open_library,
            save_autosave, open_autosave, clear_autosave, write_export, write_layouts_export, folder_is_empty, remove_empty_folder,
            get_ac_root, find_ac_root, set_ac_root, install_track, get_see_it_setting, set_see_it_setting, see_it_in_assetto,
            test_export_folder, list_pieces, open_piece, save_piece, delete_piece, save_undo, open_undo, append_input_log
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
    fn the_test_app_data_seam_is_used_only_for_an_existing_absolute_folder() {
        let d = scratch("appdata");
        assert_eq!(test_app_data(Some(d.to_string_lossy().into_owned())), Some(d.clone()));
        assert_eq!(test_app_data(None), None, "unset: the real app data folder");
        assert_eq!(test_app_data(Some("relative\\dir".into())), None, "a relative path is ignored");
        assert_eq!(test_app_data(Some(d.join("missing").to_string_lossy().into_owned())), None, "a folder that does not exist is ignored");
        assert_eq!(test_app_data(Some(String::new())), None);
        fs::remove_dir_all(&d).unwrap();
    }

    // D340: the late-input log appends whole lines and, past its cap, keeps the newest whole lines (the oldest go), so it can never grow without bound
    #[test]
    fn the_input_log_appends_and_past_its_cap_keeps_the_newest_whole_lines() {
        let d = scratch("inputlog");
        let p = d.join("input-late.log");
        append_capped(&p, "{\"n\":1}\n", 100).unwrap();
        append_capped(&p, "{\"n\":2}\n", 100).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{\"n\":1}\n{\"n\":2}\n", "appended, in order");
        for i in 3..60 { append_capped(&p, &format!("{{\"n\":{i}}}\n"), 100).unwrap(); }
        let s = fs::read_to_string(&p).unwrap();
        assert!(s.len() <= 100, "at most the cap: {} bytes", s.len());
        assert!(s.ends_with("{\"n\":59}\n"), "the newest line is kept: {s:?}");
        assert!(s.starts_with('{') && s.lines().all(|l| l.starts_with('{') && l.ends_with('}')), "whole lines only: {s:?}");
        let n: Vec<u32> = s.lines().map(|l| l[5..l.len() - 1].parse().unwrap()).collect();
        assert!(n.windows(2).all(|w| w[1] == w[0] + 1), "the newest lines, in order: {n:?}");
        append_capped(&p, &"x".repeat(300), 100).unwrap();   // one write larger than the cap, with no newline: nothing of it fits whole
        assert!(fs::read_to_string(&p).unwrap().len() <= 100);
        assert!(!p.with_extension("tmp-write").exists());
        fs::write(&p, vec![0xFFu8; 100]).unwrap();   // a log that cannot be read as text
        assert!(append_capped(&p, "{\"n\":1}\n", 100).is_err(), "an unreadable log is reported, never replaced");
        assert_eq!(fs::read(&p).unwrap(), vec![0xFFu8; 100]);
        fs::remove_dir_all(&d).unwrap();
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
    fn a_layouts_re_export_removes_only_what_its_previous_marker_listed() {
        let d = scratch("layouts");
        let marker = |files: &[&str]| serde_json::json!({ "tool": "t180-track-builder", "files": files }).to_string().into_bytes();
        let first: Vec<(String, Vec<u8>)> = vec![
            ("models_long.ini".into(), b"l".to_vec()), ("ui/long/ui_track.json".into(), b"{}".to_vec()),
            ("models_short.ini".into(), b"s".to_vec()), ("ui/short/ui_track.json".into(), b"{}".to_vec()), ("short/ai/fast_lane.ai".into(), vec![1]),
            (".t180b-builder.json".into(), marker(&["models_long.ini", "ui/long/ui_track.json", "models_short.ini", "ui/short/ui_track.json", "short/ai/fast_lane.ai", "../outside.txt"])),
        ];
        assert_eq!(write_layouts_export_to(&d, "t180b_x", &first).unwrap(), (6, vec![]), "a first export removes nothing");
        let t = d.join("t180b_x");
        fs::create_dir_all(t.join("extension")).unwrap();
        fs::write(t.join("extension").join("ext_config.ini"), "[BASIC]").unwrap();
        fs::create_dir_all(t.join("short").join("data")).unwrap();
        fs::write(t.join("short").join("data").join("mine.txt"), "mine").unwrap();
        fs::write(d.join("outside.txt"), "theirs").unwrap();
        let second: Vec<(String, Vec<u8>)> = vec![
            ("models_long.ini".into(), b"l2".to_vec()), ("ui/long/ui_track.json".into(), b"{}".to_vec()),
            ("models_gp.ini".into(), b"g".to_vec()), ("ui/gp/ui_track.json".into(), b"{}".to_vec()),
            (".t180b-builder.json".into(), marker(&["models_long.ini", "ui/long/ui_track.json", "models_gp.ini", "ui/gp/ui_track.json"])),
        ];
        let (n, mut removed) = write_layouts_export_to(&d, "t180b_x", &second).unwrap();
        removed.sort();
        assert_eq!(n, 5);
        assert_eq!(removed, vec!["models_short.ini", "short/ai/fast_lane.ai", "ui/short/ui_track.json"], "exactly the dropped layout's listed files");
        assert!(!t.join("ui").join("short").exists() && !t.join("short").join("ai").exists(), "the folders they left empty are gone");
        assert_eq!(fs::read_to_string(t.join("short").join("data").join("mine.txt")).unwrap(), "mine", "a file somebody added is kept");
        assert_eq!(fs::read_to_string(t.join("extension").join("ext_config.ini")).unwrap(), "[BASIC]");
        assert_eq!(fs::read_to_string(d.join("outside.txt")).unwrap(), "theirs", "a listed path outside the folder is never followed");
        assert_eq!(fs::read(t.join("models_long.ini")).unwrap(), b"l2");
        // a marker that cannot be read removes nothing
        fs::write(t.join(".t180b-builder.json"), "{ broken").unwrap();
        assert_eq!(write_layouts_export_to(&d, "t180b_x", &first[..2]).unwrap().1, Vec::<String>::new());
        assert!(t.join("ui").join("gp").join("ui_track.json").exists());
        // a folder the builder did not write is refused untouched, as write_export_to refuses it
        fs::create_dir_all(d.join("t180b_theirs")).unwrap();
        fs::write(d.join("t180b_theirs").join("keep.txt"), "x").unwrap();
        assert!(write_layouts_export_to(&d, "t180b_theirs", &second).is_err());
        assert_eq!(fs::read_dir(d.join("t180b_theirs")).unwrap().count(), 1);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn stale_paths_come_only_from_the_marker_and_stay_inside_the_folder() {
        let m = r#"{"files":["a.kn5","old/x.ini","old/x.ini","../up","/abs",".t180b-builder.json","b\\c"]}"#;
        assert_eq!(stale_from_marker(m, &["a.kn5"]), vec!["old/x.ini".to_string()]);
        assert!(stale_from_marker("not json", &[]).is_empty());
        assert!(stale_from_marker(r#"{"nofiles":1}"#, &[]).is_empty());
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
    fn a_piece_is_kept_listed_read_and_deleted_by_name_and_never_overwritten() {
        let d = scratch("pieces");
        for f in ["b.t180piece", "a piece.t180piece", "a track.t180track", "notes.txt", "..odd.t180piece"] {
            fs::write(d.join(f), "x").unwrap();
        }
        assert_eq!(names_with_ext(&d, PIECE_EXT).unwrap(), vec!["a piece".to_string(), "b".to_string()], "only valid piece names, sorted, no track files");
        save_piece_file(&d, "new one", "{\"schema\":\"t180b.piece/1\"}", false).unwrap();
        assert_eq!(open_piece_file(&d, "new one").unwrap(), "{\"schema\":\"t180b.piece/1\"}");
        assert!(save_piece_file(&d, "new one", "other", false).unwrap_err().contains("already exists"), "a second save of a name is refused");
        assert_eq!(open_piece_file(&d, "new one").unwrap(), "{\"schema\":\"t180b.piece/1\"}", "and the first is untouched");
        save_piece_file(&d, "new one", "replaced", true).unwrap();
        assert_eq!(open_piece_file(&d, "new one").unwrap(), "replaced");
        delete_piece_file(&d, "new one").unwrap();
        assert!(open_piece_file(&d, "new one").is_err() && delete_piece_file(&d, "new one").is_err(), "gone, and deleting it again says so");
        for bad in ["", "../x", "a/b", "a\\b", "..", ".", "x.y", "é"] {
            assert!(piece_file(&d, bad).is_err() && save_piece_file(&d, bad, "x", true).is_err(), "{bad:?} is not a piece name");
        }
        assert!(!d.join("tmp-write").exists() && fs::read_dir(&d).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp-write")), "no temporary file is left");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn an_undo_sidecar_is_kept_beside_its_track_replaced_read_back_and_never_listed_as_a_track() {
        let d = scratch("undo");
        assert_eq!(open_undo_file(&d, "eq-lap").unwrap(), None, "no sidecar is not an error");
        fs::write(d.join("eq-lap.t180track"), "the track").unwrap();
        save_undo_file(&d, "eq-lap", "{\"schema\":1}").unwrap();
        assert_eq!(open_undo_file(&d, "eq-lap").unwrap().as_deref(), Some("{\"schema\":1}"));
        save_undo_file(&d, "eq-lap", "second").unwrap();
        assert_eq!(open_undo_file(&d, "eq-lap").unwrap().as_deref(), Some("second"), "a save replaces it");
        assert_eq!(fs::read_to_string(d.join("eq-lap.t180track")).unwrap(), "the track", "the track file is untouched");
        assert_eq!(track_names(&d).unwrap(), vec!["eq-lap".to_string()], "the sidecar is not a track in the list");
        assert!(d.join("eq-lap.t180undo").is_file());
        for bad in ["", "../x", "a/b", "a\\b", "..", ".", "x.y", "é"] {
            assert!(undo_file(&d, bad).is_err() && save_undo_file(&d, bad, "x").is_err() && open_undo_file(&d, bad).is_err(), "{bad:?} is not a track name");
        }
        assert!(fs::read_dir(&d).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp-write")), "no temporary file is left");
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

    // ---- D372: a re-export that changes a track's shape retires its stale ghost and HUD laps (moved into a dated backup beside them, never deleted)
    const GEO_A: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const GEO_B: &str = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    fn geo_marker(geo: Option<&str>) -> Vec<u8> {
        match geo {
            Some(g) => format!(r#"{{"tool":"t180-track-builder","geometry":"{g}","files":["t180b_x.kn5"]}}"#).into_bytes(),
            None => br#"{"tool":"t180-track-builder","files":["t180b_x.kn5"]}"#.to_vec(),
        }
    }
    /// An AC folder with t180b_x already installed (its marker carrying `prev`, or none at all), and a Documents\Assetto Corsa with a ghost and HUD laps for
    /// t180b_x and, beside them, things that are not t180b_x's: another track's ghost and laps (t180b_x_flat), and a file with no [#] in its name.
    fn laps_rig(tag: &str, prev: Option<Option<&str>>) -> (PathBuf, PathBuf, PathBuf) {
        let d = scratch(tag);
        let root = d.join("ac");
        let track = root.join("content").join("tracks").join("t180b_x");
        fs::create_dir_all(&track).unwrap();
        if let Some(g) = prev { fs::write(track.join(MARKER_FILE), geo_marker(g)).unwrap(); fs::write(track.join("t180b_x.kn5"), b"old").unwrap(); } else { fs::remove_dir_all(&track).unwrap(); }
        let docs = d.join("docs");
        let ghost = docs.join("GhostCar").join("t180b_x");
        fs::create_dir_all(&ghost).unwrap();
        fs::write(ghost.join("GHOST_CAR_t180.ghost"), b"ghost").unwrap();
        fs::create_dir_all(docs.join("GhostCar").join("t180b_x_flat")).unwrap();
        fs::write(docs.join("GhostCar").join("t180b_x_flat").join("GHOST_CAR_t180.ghost"), b"other ghost").unwrap();
        let hud = docs.join("CMRT-Essential-HUD");
        fs::create_dir_all(&hud).unwrap();
        for n in ["t180b_x[#]T-180 Mach 6[v1]fast.lap", "t180b_x[#]T-180 Mach 6[v1]s1.lap", "t180b_x_flat[#]T-180 Mach 6[v1]fast.lap", "t180b_x.txt", "other_track[#]car[v1]fast.lap"] {
            fs::write(hud.join(n), n.as_bytes()).unwrap();
        }
        (d, root, docs)
    }
    fn new_files(geo: Option<&str>) -> Vec<(String, Vec<u8>)> { vec![("t180b_x.kn5".into(), b"new".to_vec()), (MARKER_FILE.into(), geo_marker(geo))] }
    fn untouched_others(docs: &Path) {
        assert_eq!(fs::read(docs.join("GhostCar").join("t180b_x_flat").join("GHOST_CAR_t180.ghost")).unwrap(), b"other ghost", "another track's ghost stays");
        let hud = docs.join("CMRT-Essential-HUD");
        for n in ["t180b_x_flat[#]T-180 Mach 6[v1]fast.lap", "t180b_x.txt", "other_track[#]car[v1]fast.lap"] { assert!(hud.join(n).is_file(), "{n} is not t180b_x's: it stays"); }
    }

    #[test]
    fn a_changed_shape_moves_the_ghost_and_the_hud_laps_into_a_dated_backup_beside_them() {
        let (d, root, docs) = laps_rig("retire-changed", Some(Some(GEO_A)));
        let r = install_with_retire(&root, &docs, "t180b_x", &new_files(Some(GEO_B)), "2026-10-17_180000Z").unwrap();
        assert_eq!(r.files, 2, "the install itself is unchanged");
        assert_eq!(fs::read(root.join("content").join("tracks").join("t180b_x").join("t180b_x.kn5")).unwrap(), b"new");
        let gb = docs.join("GhostCar").join("t180b_x.retired-2026-10-17_180000Z");
        assert_eq!(fs::read(gb.join("GHOST_CAR_t180.ghost")).unwrap(), b"ghost", "the ghost is in the dated backup, whole");
        assert!(!docs.join("GhostCar").join("t180b_x").exists(), "and gone from where AC looks");
        let hb = docs.join("CMRT-Essential-HUD").join("t180b_x.retired-2026-10-17_180000Z");
        for n in ["t180b_x[#]T-180 Mach 6[v1]fast.lap", "t180b_x[#]T-180 Mach 6[v1]s1.lap"] {
            assert_eq!(fs::read(hb.join(n)).unwrap(), n.as_bytes(), "{n} is in the dated backup");
            assert!(!docs.join("CMRT-Essential-HUD").join(n).exists());
        }
        assert_eq!(r.retired.len(), 3, "{:?}", r.retired);
        untouched_others(&docs);
        // moved, never deleted: moving the backups back restores it exactly
        fs::rename(&gb, docs.join("GhostCar").join("t180b_x")).unwrap();
        assert_eq!(fs::read(docs.join("GhostCar").join("t180b_x").join("GHOST_CAR_t180.ghost")).unwrap(), b"ghost");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn the_same_shape_a_first_export_and_a_marker_with_no_hash_move_nothing() {
        for (tag, prev, new) in [("retire-same", Some(Some(GEO_A)), Some(GEO_A)), ("retire-first", None, Some(GEO_B)), ("retire-oldmarker", Some(None), Some(GEO_B)), ("retire-newnohash", Some(Some(GEO_A)), None)] {
            let (d, root, docs) = laps_rig(tag, prev);
            let r = install_with_retire(&root, &docs, "t180b_x", &new_files(new), "2026-10-17_180000Z").unwrap();
            assert!(r.retired.is_empty(), "{tag}: {:?}", r.retired);
            assert_eq!(fs::read(docs.join("GhostCar").join("t180b_x").join("GHOST_CAR_t180.ghost")).unwrap(), b"ghost", "{tag}: the ghost stays");
            assert!(docs.join("CMRT-Essential-HUD").join("t180b_x[#]T-180 Mach 6[v1]fast.lap").is_file(), "{tag}: the laps stay");
            untouched_others(&docs);
            fs::remove_dir_all(&d).unwrap();
        }
    }

    #[test]
    fn a_second_retire_on_the_same_stamp_gets_its_own_backup_and_an_empty_ghost_folder_is_left() {
        let (d, _root, docs) = laps_rig("retire-twice", Some(Some(GEO_A)));
        let first = retire_stale_laps(&docs, "t180b_x", "S").unwrap();
        assert_eq!(first.len(), 3);
        fs::create_dir_all(docs.join("GhostCar").join("t180b_x")).unwrap();
        fs::write(docs.join("GhostCar").join("t180b_x").join("g2.ghost"), b"second").unwrap();
        let second = retire_stale_laps(&docs, "t180b_x", "S").unwrap();
        assert_eq!(fs::read(docs.join("GhostCar").join("t180b_x.retired-S-2").join("g2.ghost")).unwrap(), b"second", "a free name, never over the first backup: {second:?}");
        assert_eq!(fs::read(docs.join("GhostCar").join("t180b_x.retired-S").join("GHOST_CAR_t180.ghost")).unwrap(), b"ghost", "the first backup is untouched");
        fs::create_dir_all(docs.join("GhostCar").join("t180b_x")).unwrap();   // AC makes the folder again, empty
        assert!(retire_stale_laps(&docs, "t180b_x", "T").unwrap().is_empty(), "an empty ghost folder has nothing to retire, and stays");
        assert!(docs.join("GhostCar").join("t180b_x").is_dir());
        assert!(retire_stale_laps(&docs, "somebody_elses", "T").is_err(), "only t180b_ folders");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_ghost_folder_or_hud_folder_that_is_a_junction_is_never_followed_or_moved() {
        let (d, _root, docs) = laps_rig("retire-junction", Some(Some(GEO_A)));
        let elsewhere = d.join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        fs::write(elsewhere.join("precious.ghost"), b"not ours").unwrap();
        fs::write(elsewhere.join("t180b_x[#]car[v1]fast.lap"), b"not ours either").unwrap();
        let mk = |link: &Path, target: &Path| {
            let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target).output().map(|o| o.status.success()).unwrap_or(false);
            assert!(ok, "the test could not make a junction at {}", link.display());
        };
        fs::remove_dir_all(docs.join("GhostCar").join("t180b_x")).unwrap();
        mk(&docs.join("GhostCar").join("t180b_x"), &elsewhere);
        fs::remove_dir_all(docs.join("CMRT-Essential-HUD")).unwrap();
        mk(&docs.join("CMRT-Essential-HUD"), &elsewhere);
        let r = retire_stale_laps(&docs, "t180b_x", "J").unwrap();
        assert!(r.is_empty(), "nothing through a junction: {r:?}");
        assert_eq!(fs::read(elsewhere.join("precious.ghost")).unwrap(), b"not ours");
        assert_eq!(fs::read(elsewhere.join("t180b_x[#]car[v1]fast.lap")).unwrap(), b"not ours either");
        assert!(fs::symlink_metadata(docs.join("GhostCar").join("t180b_x")).unwrap().file_type().is_symlink(), "the junction itself stays where it was");
        // a lap entry that is a junction inside a real HUD folder is not moved either
        fs::remove_dir(docs.join("CMRT-Essential-HUD")).unwrap();
        fs::create_dir_all(docs.join("CMRT-Essential-HUD")).unwrap();
        mk(&docs.join("CMRT-Essential-HUD").join("t180b_x[#]linked"), &elsewhere);
        assert!(retire_stale_laps(&docs, "t180b_x", "K").unwrap().is_empty(), "a linked lap entry is left");
        fs::remove_dir(docs.join("CMRT-Essential-HUD").join("t180b_x[#]linked")).unwrap();
        fs::remove_dir(docs.join("GhostCar").join("t180b_x")).unwrap();
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn the_stamp_is_utc_with_a_z_and_the_marker_hash_is_read_only_in_its_own_form() {
        assert_eq!(utc_stamp(0), "1970-01-01_000000Z");
        assert_eq!(utc_stamp(1_792_260_005), "2026-10-17_180005Z");
        assert_eq!(marker_geometry(&String::from_utf8(geo_marker(Some(GEO_A))).unwrap()).as_deref(), Some(GEO_A));
        for bad in [r#"{"geometry":"md5:abc"}"#, r#"{"geometry":"sha256:short"}"#, r#"{"geometry":5}"#, "{ broken", "{}"] { assert_eq!(marker_geometry(bad), None, "{bad}"); }
    }
}
