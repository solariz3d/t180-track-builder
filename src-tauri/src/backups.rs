// backups.rs: SAVE KEEPS THE PREVIOUS VERSION (D239 amendment; the keeper lost TEST 1 to one Close, with no copy from before it).
//   move_aside(file, backups, name, stamp)   the file a Save is about to overwrite is MOVED (renamed, never copied and deleted) to
//                                            <backups>/<name>.<yyyy-mm-dd_hhmmss>.t180track before the new text is written
//   write_copy(backups, name, stamp, text)   a copy of the document as it is now (the shell's backupNow, before a Close)
//   prune(backups, name, keep)               the newest `keep` (20) of THIS track's backups stay; older ones are removed, oldest first.
//                                            ONLY files in exactly that form are counted or removed: a backup made by hand
//                                            ("eq-TEST 1.2339-closed.t180track") is never touched. Nothing else here deletes.
//   list(backups, name)                      this track's backups, newest first: every <name>.<…>.t180track, hand-made ones included
//   read(backups, file)                      one of them, by its bare file name (no path can ride in on it)
// The stamp is the page's LOCAL time (the keeper reads it), checked here to be exactly yyyy-mm-dd_hhmmss; without one, UTC is used.
// Two backups in the same second get _2, _3 … after the stamp, which sorts after the plain one, so the order is still by time.
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DIR: &str = "track-backups";
pub const KEEP: usize = 20;
const EXT: &str = "t180track";

/// Exactly yyyy-mm-dd_hhmmss.
pub fn stamp_ok(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 17
        && b.iter().enumerate().all(|(i, c)| match i { 4 | 7 => *c == b'-', 10 => *c == b'_', _ => c.is_ascii_digit() })
}

/// The stamp to use: the page's, if it is well formed, else the UTC time now.
pub fn stamp_or_now(stamp: Option<&str>) -> String {
    match stamp {
        Some(s) if stamp_ok(s) => s.to_string(),
        _ => utc_stamp(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)),
    }
}

/// yyyy-mm-dd_hhmmss for seconds since 1970 (UTC), by the civil-from-days rule (H. Hinnant), with no date crate.
pub fn utc_stamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}_{:02}{:02}{:02}", rem / 3_600, (rem % 3_600) / 60, rem % 60)
}

/// Is `file` one of THIS track's stamped backups (the only kind the prune counts or removes)?
fn is_stamped(file: &str, name: &str) -> bool {
    let Some(rest) = file.strip_prefix(name).and_then(|r| r.strip_prefix('.')) else { return false };
    let Some(mid) = rest.strip_suffix(&format!(".{EXT}")) else { return false };
    let (stamp, n) = if mid.len() == 17 {
        (mid, "")
    } else if mid.len() > 18 && mid.as_bytes()[17] == b'_' {
        (&mid[..17], &mid[18..])
    } else {
        return false;
    };
    stamp_ok(stamp) && (n.is_empty() || (n.len() <= 3 && n.bytes().all(|c| c.is_ascii_digit())))
}

/// A free backup path for this name and stamp: <name>.<stamp>.t180track, else _2, _3 …
fn free_path(backups: &Path, name: &str, stamp: &str) -> Result<PathBuf, String> {
    let first = backups.join(format!("{name}.{stamp}.{EXT}"));
    if !first.exists() {
        return Ok(first);
    }
    for n in 2..1000 {
        let p = backups.join(format!("{name}.{stamp}_{n}.{EXT}"));
        if !p.exists() {
            return Ok(p);
        }
    }
    Err(format!("no free backup name for {name} at {stamp}"))
}

fn ensure(backups: &Path) -> Result<(), String> {
    fs::create_dir_all(backups).map_err(|e| format!("could not create {}: {e}", backups.display()))
}

/// Move the file a Save is about to overwrite into the backups. Ok(None) when there is no such file (a first save).
pub fn move_aside(file: &Path, backups: &Path, name: &str, stamp: &str) -> Result<Option<PathBuf>, String> {
    if !file.exists() {
        return Ok(None);
    }
    ensure(backups)?;
    let to = free_path(backups, name, stamp)?;
    fs::rename(file, &to).map_err(|e| format!("could not keep the previous version of {name} ({} → {}): {e}; nothing was saved", file.display(), to.display()))?;
    Ok(Some(to))
}

/// Write a copy of `text` as a new backup of `name`.
pub fn write_copy(backups: &Path, name: &str, stamp: &str, text: &str) -> Result<PathBuf, String> {
    ensure(backups)?;
    let to = free_path(backups, name, stamp)?;
    super::write_atomic(&to, text)?;
    Ok(to)
}

/// SAVE with the previous version kept: the file at `path` is moved aside, the new text written (if that fails, the old file is moved
/// back and the error returned: a failed save never loses the track), then this track's backups are pruned. A prune that fails AFTER a
/// good save is LOGGED and the save still succeeds (B's D239 look, F3b: the page must not report a save that worked as failed; an old
/// backup left over is harmless). Returns the backup's path, or None on a first save.
pub fn save(path: &Path, backups: &Path, name: &str, stamp: &str, text: &str) -> Result<Option<PathBuf>, String> {
    let kept = move_aside(path, backups, name, stamp)?;
    if let Err(e) = super::write_atomic(path, text) {
        if let Some(k) = &kept {
            let _ = fs::rename(k, path);
        }
        return Err(e);
    }
    if let Err(e) = prune(backups, name, KEEP) {
        eprintln!("t180: saved {name}, but pruning its old backups failed (they are left as they are): {e}");
    }
    Ok(kept)
}

/// A copy of `text` as a new backup of `name`, then the prune, whose failure is logged as in `save`.
pub fn copy(backups: &Path, name: &str, stamp: &str, text: &str) -> Result<PathBuf, String> {
    let to = write_copy(backups, name, stamp, text)?;
    if let Err(e) = prune(backups, name, KEEP) {
        eprintln!("t180: backed up {name}, but pruning its old backups failed (they are left as they are): {e}");
    }
    Ok(to)
}

/// Keep the newest `keep` stamped backups of `name`; remove the older ones, oldest first. Returns what was removed.
pub fn prune(backups: &Path, name: &str, keep: usize) -> Result<Vec<String>, String> {
    let mut mine: Vec<String> = match fs::read_dir(backups) {
        Ok(rd) => rd.filter_map(|e| e.ok()).filter_map(|e| e.file_name().into_string().ok()).filter(|f| is_stamped(f, name)).collect(),
        Err(_) => return Ok(Vec::new()),
    };
    mine.sort();
    let extra = mine.len().saturating_sub(keep);
    let mut removed = Vec::new();
    for f in mine.into_iter().take(extra) {
        fs::remove_file(backups.join(&f)).map_err(|e| format!("could not prune the old backup {f}: {e}"))?;
        removed.push(f);
    }
    Ok(removed)
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Backup {
    pub file: String,
    pub bytes: u64,
}

/// This track's backups: the stamped ones newest first, then the hand-made ones.
pub fn list(backups: &Path, name: &str) -> Result<Vec<Backup>, String> {
    let prefix = format!("{name}.");
    let mut out: Vec<Backup> = match fs::read_dir(backups) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let f = e.file_name().into_string().ok()?;
                if !f.starts_with(&prefix) || !f.ends_with(&format!(".{EXT}")) || f.len() <= prefix.len() + EXT.len() + 1 {
                    return None;
                }
                Some(Backup { bytes: e.metadata().map(|m| m.len()).unwrap_or(0), file: f })
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    // the stamped ones first, newest first (the stamp sorts by time); then any made by hand, whose names carry no time
    out.sort_by(|a, b| is_stamped(&b.file, name).cmp(&is_stamped(&a.file, name)).then(b.file.cmp(&a.file)));
    Ok(out)
}

/// One backup's text, by its bare file name.
pub fn read(backups: &Path, file: &str) -> Result<String, String> {
    if file.is_empty() || file.contains(['/', '\\', ':']) || file.contains("..") || !file.ends_with(&format!(".{EXT}")) {
        return Err(format!("{file:?} is not a backup's file name"));
    }
    let p = backups.join(file);
    fs::read_to_string(&p).map_err(|e| format!("could not open {}: {e}", p.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("t180tb-bk-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn stamp(i: u32) -> String { format!("2026-10-05_10{:02}{:02}", i / 60, i % 60) }

    #[test]
    fn a_save_over_an_existing_file_leaves_its_previous_bytes_in_backups() {
        let d = scratch("move");
        let (tracks, bk) = (d.join("tracks"), d.join(DIR));
        fs::create_dir_all(&tracks).unwrap();
        let file = tracks.join("eq-T.t180track");
        fs::write(&file, "OLD BYTES").unwrap();
        let to = move_aside(&file, &bk, "eq-T", &stamp(0)).unwrap().unwrap();
        assert_eq!(fs::read_to_string(&to).unwrap(), "OLD BYTES");
        assert_eq!(to.file_name().unwrap().to_str().unwrap(), "eq-T.2026-10-05_100000.t180track");
        assert!(!file.exists(), "moved, not copied");
        assert_eq!(move_aside(&file, &bk, "eq-T", &stamp(1)).unwrap(), None, "a first save has nothing to keep");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn the_21st_backup_prunes_the_oldest_and_only_this_tracks_stamped_files() {
        let d = scratch("prune");
        fs::write(d.join("eq-T.2339-closed.t180track"), "hand-made").unwrap();
        fs::write(d.join("eq-Other.2026-10-05_090000.t180track"), "another track").unwrap();
        fs::write(d.join("eq-T 2.2026-10-05_090000.t180track"), "a track whose name starts the same").unwrap();
        for i in 0..21 {
            write_copy(&d, "eq-T", &stamp(i), &format!("v{i}")).unwrap();
            prune(&d, "eq-T", KEEP).unwrap();
        }
        let stamped: Vec<String> = list(&d, "eq-T").unwrap().into_iter().map(|b| b.file).filter(|f| is_stamped(f, "eq-T")).collect();
        assert_eq!(stamped.len(), 20);
        assert!(!d.join(format!("eq-T.{}.t180track", stamp(0))).exists(), "the oldest went");
        assert!(d.join(format!("eq-T.{}.t180track", stamp(1))).exists(), "the next oldest stayed");
        for f in ["eq-T.2339-closed.t180track", "eq-Other.2026-10-05_090000.t180track", "eq-T 2.2026-10-05_090000.t180track"] {
            assert!(d.join(f).exists(), "{f} is never pruned");
        }
        let l = list(&d, "eq-T").unwrap();
        assert_eq!(l.len(), 21, "this track's 20 and the hand-made one; not the other tracks'");
        assert_eq!(l[0].file, format!("eq-T.{}.t180track", stamp(20)), "the newest first");
        assert_eq!(l[20].file, "eq-T.2339-closed.t180track", "the hand-made one after the stamped ones");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_copy_is_written_and_two_in_one_second_both_stay() {
        let d = scratch("copy");
        let a = write_copy(&d, "eq-T", &stamp(5), "first").unwrap();
        let b = write_copy(&d, "eq-T", &stamp(5), "second").unwrap();
        assert_ne!(a, b);
        assert_eq!(fs::read_to_string(&a).unwrap(), "first");
        assert_eq!(fs::read_to_string(&b).unwrap(), "second");
        assert!(is_stamped(b.file_name().unwrap().to_str().unwrap(), "eq-T"));
        let l = list(&d, "eq-T").unwrap();
        assert_eq!(l[0].file, b.file_name().unwrap().to_str().unwrap(), "newest first: _2 sorts after the plain stamp");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_save_whose_prune_fails_afterwards_still_succeeds_and_the_new_text_is_written() {
        // the OLDEST stamped name is a directory, which remove_file cannot remove on any platform, so the prune after the 21st fails.
        // (A read-only file was tried first and is NOT enough: Rust's remove_file deleted it on Windows; this test's own control caught that.)
        let d = scratch("prunefail");
        let (tracks, bk) = (d.join("tracks"), d.join(DIR));
        fs::create_dir_all(&tracks).unwrap();
        let oldest = bk.join(format!("eq-T.{}.t180track", stamp(0)));
        fs::create_dir_all(oldest.join("inside")).unwrap();
        for i in 1..20 {
            write_copy(&bk, "eq-T", &stamp(i), &format!("v{i}")).unwrap();
        }
        assert!(prune(&bk, "eq-T", 19).is_err(), "control: a prune that must remove the oldest (a directory) fails");
        let file = tracks.join("eq-T.t180track");
        fs::write(&file, "OLD").unwrap();
        let r = save(&file, &bk, "eq-T", &stamp(30), "NEW");
        assert!(r.is_ok(), "the save worked, so it reports success: {r:?}");
        assert_eq!(fs::read_to_string(&file).unwrap(), "NEW");
        assert_eq!(fs::read_to_string(r.unwrap().unwrap()).unwrap(), "OLD", "and the previous version was kept");
        assert!(copy(&bk, "eq-T", &stamp(31), "COPY").is_ok(), "a backup copy whose prune fails also succeeds");
        assert!(oldest.is_dir(), "and the prune removed nothing it could not");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_backup_is_read_by_its_bare_name_only() {
        let d = scratch("read");
        fs::write(d.join("eq-T.2026-10-05_100000.t180track"), "text").unwrap();
        assert_eq!(read(&d, "eq-T.2026-10-05_100000.t180track").unwrap(), "text");
        for bad in ["", "../tracks/eq-T.t180track", "a/b.t180track", "a\\b.t180track", "C:x.t180track", "eq-T.txt"] {
            assert!(read(&d, bad).is_err(), "{bad:?} must be refused");
        }
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn stamps_are_checked_and_the_utc_fallback_is_a_valid_stamp() {
        assert!(stamp_ok("2026-10-05_101500"));
        for bad in ["2026-10-05 101500", "2026-10-5_101500", "../../x", "2026-10-05_1015000"] {
            assert!(!stamp_ok(bad), "{bad:?}");
        }
        assert_eq!(utc_stamp(0), "1970-01-01_000000");
        assert_eq!(utc_stamp(1_759_658_400), "2025-10-05_100000");
        assert!(stamp_ok(&stamp_or_now(Some("not a stamp"))));
    }
}
