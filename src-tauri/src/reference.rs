// reference.rs (L243, a first look): the installed tracks the user may show as a REFERENCE, a shadow layer under their own road
// (src/reference/ribbon.js draws it). READ ONLY: nothing here writes, moves or creates anything in Assetto Corsa's folder.
//
//   list_layouts(tracks) -> every track folder under content/tracks and each of its layouts, with whether it has ai/fast_lane.ai and the
//                           length its ui_track.json gives (as written: "5793", "10.3km"), so a layout with no AI line is LISTED, saying so
//   read_shape(tracks, track, layout) -> the first bytes of <track>/<layout>/ai/fast_lane.ai, up to and including hasGrid: the road's shape.
//                           The grid after it (AC's lookup for the AI, up to 21 MB on L) is never read or sent.
//
// A LAYOUT is found three ways, as on L (61 layouts in 34 folders, 2026-11-26): the folder's own (ai/ or ui/ui_track.json at its top), each
// ui/<layout>/ui_track.json, and each sub-folder holding ai/. A name from the page is one plain folder name (no separator, no "..", no ":")
// and the file it names must lie inside content/tracks once its links are followed.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct RefLayout {
    pub track: String,
    pub layout: String,
    #[serde(rename = "hasAi")]
    pub has_ai: bool,
    #[serde(rename = "uiLength")]
    pub ui_length: Option<String>,
}

const HEADER: u64 = 16;
const POINT: u64 = 20;
const EXTRA: u64 = 18 * 4;
const MOST_POINTS: i32 = 1_000_000;   // 16,401 is the most on L; a header past this is not an AI line

fn plain_name(s: &str, may_be_empty: bool) -> Result<(), String> {
    if s.is_empty() { return if may_be_empty { Ok(()) } else { Err("a track's folder name is empty".into()) }; }
    if s == "." || s == ".." || s.contains(['/', '\\', ':']) { return Err(format!("{s:?} is not one plain folder name")); }
    Ok(())
}

fn ui_length(p: &Path) -> Option<String> {
    let t = fs::read_to_string(p).ok()?;
    let v: serde_json::Value = serde_json::from_str(t.trim_start_matches('\u{feff}')).ok()?;
    match v.get("length")? { serde_json::Value::String(s) => Some(s.clone()), serde_json::Value::Number(n) => Some(n.to_string()), _ => None }
}

pub fn list_layouts(tracks: &Path) -> Result<Vec<RefLayout>, String> {
    let mut names: Vec<String> = fs::read_dir(tracks).map_err(|e| format!("{}: {e}", tracks.display()))?
        .filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).filter_map(|e| e.file_name().into_string().ok()).collect();
    names.sort_by_key(|n| n.to_lowercase());
    let mut out = Vec::new();
    for t in names {
        let td = tracks.join(&t);
        let mut layouts: Vec<String> = Vec::new();
        if td.join("ai").is_dir() || td.join("ui").join("ui_track.json").is_file() { layouts.push(String::new()); }
        if let Ok(rd) = fs::read_dir(td.join("ui")) {
            let mut ls: Vec<String> = rd.filter_map(|e| e.ok()).filter(|e| e.path().join("ui_track.json").is_file()).filter_map(|e| e.file_name().into_string().ok()).collect();
            ls.sort(); layouts.extend(ls);
        }
        if let Ok(rd) = fs::read_dir(&td) {
            let mut ls: Vec<String> = rd.filter_map(|e| e.ok()).filter(|e| e.path().join("ai").is_dir()).filter_map(|e| e.file_name().into_string().ok()).filter(|l| l != "ai" && !layouts.contains(l)).collect();
            ls.sort(); layouts.extend(ls);
        }
        if layouts.is_empty() { layouts.push(String::new()); }
        for l in layouts {
            let ai = td.join(&l).join("ai").join("fast_lane.ai");
            let ui = if l.is_empty() { td.join("ui").join("ui_track.json") } else { td.join("ui").join(&l).join("ui_track.json") };
            out.push(RefLayout { track: t.clone(), has_ai: ai.is_file(), ui_length: ui_length(&ui), layout: l });
        }
    }
    Ok(out)
}

fn inside(tracks: &Path, p: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(tracks).map_err(|e| format!("{}: {e}", tracks.display()))?;
    let real = fs::canonicalize(p).map_err(|e| format!("no AI line there ({e})"))?;
    if !real.starts_with(&root) { return Err("that AI line lies outside content\\tracks once its links are followed".into()); }
    Ok(real)
}

pub fn read_shape(tracks: &Path, track: &str, layout: &str) -> Result<Vec<u8>, String> {
    plain_name(track, false)?; plain_name(layout, true)?;
    let p = inside(tracks, &tracks.join(track).join(layout).join("ai").join("fast_lane.ai"))?;
    let mut f = fs::File::open(&p).map_err(|e| format!("the AI line could not be opened: {e}"))?;
    let mut head = [0u8; 16];
    f.read_exact(&mut head).map_err(|_| "the AI line is shorter than its 16-byte header".to_string())?;
    let n = i32::from_le_bytes([head[4], head[5], head[6], head[7]]);
    if !(3..=MOST_POINTS).contains(&n) { return Err(format!("the AI line says it has {n} points")); }
    let end = HEADER + n as u64 * POINT + 4 + n as u64 * EXTRA + 4;
    let mut out = head.to_vec();
    f.take(end - HEADER).read_to_end(&mut out).map_err(|e| format!("the AI line could not be read: {e}"))?;
    if (out.len() as u64) < end { return Err(format!("the AI line ends at {} bytes; its {n} points need {end}", out.len())); }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    fn scratch() -> PathBuf {
        let d = std::env::temp_dir().join(format!("t180-ref-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = fs::remove_dir_all(&d); fs::create_dir_all(&d).unwrap(); d
    }
    /// A version-7 line of n points (all zero) with hasGrid = 1 and `grid` bytes after it.
    fn line(n: i32, grid: usize) -> Vec<u8> {
        let mut b = Vec::new();
        for v in [7i32, n, 0, 0] { b.extend_from_slice(&v.to_le_bytes()); }
        b.extend(std::iter::repeat(0u8).take(n as usize * 20));
        b.extend_from_slice(&n.to_le_bytes());
        b.extend(std::iter::repeat(0u8).take(n as usize * 72));
        b.extend_from_slice(&1i32.to_le_bytes());
        b.extend(std::iter::repeat(9u8).take(grid));
        b
    }
    fn put(p: &Path, bytes: &[u8]) { fs::create_dir_all(p.parent().unwrap()).unwrap(); fs::write(p, bytes).unwrap(); }

    #[test]
    fn every_layout_is_listed_and_one_with_no_ai_line_says_so() {
        let t = scratch();
        put(&t.join("one").join("ai").join("fast_lane.ai"), &line(5, 0));
        put(&t.join("one").join("ui").join("ui_track.json"), br#"{"length":"1200"}"#);
        put(&t.join("two").join("short").join("ai").join("fast_lane.ai"), &line(5, 0));
        put(&t.join("two").join("ui").join("short").join("ui_track.json"), "\u{feff}{\"length\": \"2.4km\"}".as_bytes());
        put(&t.join("two").join("ui").join("long").join("ui_track.json"), br#"{"length":3600}"#);
        fs::create_dir_all(t.join("three").join("data")).unwrap();
        let got = list_layouts(&t).unwrap();
        let row = |tr: &str, l: &str, ai: bool, len: Option<&str>| RefLayout { track: tr.into(), layout: l.into(), has_ai: ai, ui_length: len.map(String::from) };
        assert_eq!(got, vec![row("one", "", true, Some("1200")), row("three", "", false, None), row("two", "long", false, Some("3600")), row("two", "short", true, Some("2.4km"))]);
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn the_shape_is_read_up_to_has_grid_and_the_grid_is_not() {
        let t = scratch();
        let full = line(10, 5000);
        put(&t.join("one").join("ai").join("fast_lane.ai"), &full);
        let got = read_shape(&t, "one", "").unwrap();
        assert_eq!(got.len(), 16 + 10 * 20 + 4 + 10 * 72 + 4);
        assert_eq!(&got[..], &full[..got.len()]);
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn a_name_that_is_not_one_plain_folder_is_refused_before_anything_is_opened() {
        let t = scratch();
        for (tr, l) in [("..", ""), ("one/..", ""), ("one", ".."), ("one", "a\\b"), ("", ""), ("c:", "")] {
            assert!(read_shape(&t, tr, l).is_err(), "{tr:?} {l:?} was not refused");
        }
        fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn a_short_or_nonsense_line_is_refused() {
        let t = scratch();
        let mut cut = line(10, 0); cut.truncate(100);
        put(&t.join("cut").join("ai").join("fast_lane.ai"), &cut);
        let mut huge = line(3, 0); huge[4..8].copy_from_slice(&2_000_000i32.to_le_bytes());
        put(&t.join("huge").join("ai").join("fast_lane.ai"), &huge);
        put(&t.join("stub").join("ai").join("fast_lane.ai"), &[7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        for name in ["cut", "huge", "stub", "none"] { assert!(read_shape(&t, name, "").is_err(), "{name} was not refused"); }
        fs::remove_dir_all(&t).ok();
    }
}
