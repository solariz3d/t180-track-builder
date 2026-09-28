// ac.rs: the app's two Assetto Corsa actions, INSTALL and SEE IT, kept apart from the rest of the native side.
//
// INSTALL TO AC. The user picks the AC folder once (the one holding content/tracks); it is remembered in the app's data
// folder (ac_root.txt). An install writes the exported track straight into <AC>/content/tracks/<folder> through
// write_export_to, so every guard of the export applies: the folder must be t180b_… (the builder names every track so,
// and says so in the UI), and an existing folder the builder did not write is refused untouched (the marker file).
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
    let abs = fs::canonicalize(root).map_err(|e| format!("could not resolve {}: {e}", root.display()))?;
    super::write_atomic(&data.join(ROOT_FILE), &abs.to_string_lossy())?;
    Ok(abs)
}

/// The remembered AC folder, or None when none was picked yet (or the remembered one is gone).
pub fn recall_ac_root(data: &Path) -> Result<Option<PathBuf>, String> {
    let f = data.join(ROOT_FILE);
    match fs::read_to_string(&f) {
        Ok(s) => {
            let p = PathBuf::from(s.trim());
            Ok(if tracks_of(&p).is_ok() { Some(p) } else { None })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("could not read {}: {e}", f.display())),
    }
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

    #[test]
    fn race_ini_edits_touch_only_track_and_config_track_and_add_them_when_absent() {
        assert_eq!(race_ini_for("[A]\nX=1\n[RACE]\nMODEL=c\nTRACK=old\n[B]\nY=2\n", "t180b_m", "long"), "[A]\nX=1\n[RACE]\nMODEL=c\nTRACK=t180b_m\nCONFIG_TRACK=long\n[B]\nY=2\n");
        assert_eq!(race_ini_for("", "t180b_m", ""), "[RACE]\nTRACK=t180b_m\nCONFIG_TRACK=\n");
    }
}
