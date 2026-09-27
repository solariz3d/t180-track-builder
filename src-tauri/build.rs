// build.rs: before tauri-build embeds the frontend, copy the web UI (app/) and the program it runs (src/) into
// src-tauri/dist, side by side, as they sit in the repository. So a relative require('../src/doc/index.js') in
// app/shell.js means the same file in the webview (app/lib/cjs.js) as it does under node --test. app/test/ is left
// out: tests do not ship. dist/ is rebuilt from scratch every time, so nothing stale survives a deleted file.
use std::fs;
use std::io;
use std::path::Path;

fn copy_dir(from: &Path, to: &Path, skip: &[&str]) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if skip.iter().any(|s| name == *s) {
            continue;
        }
        let (src, dst) = (entry.path(), to.join(&name));
        if entry.file_type()?.is_dir() {
            copy_dir(&src, &dst, skip)?;
        } else {
            fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

fn main() {
    let root = Path::new("..");
    let dist = Path::new("dist");
    if dist.exists() {
        fs::remove_dir_all(dist).expect("build.rs: could not clear src-tauri/dist");
    }
    copy_dir(&root.join("app"), &dist.join("app"), &["test"]).expect("build.rs: could not copy app/ into dist/");
    copy_dir(&root.join("src"), &dist.join("src"), &[]).expect("build.rs: could not copy src/ into dist/");
    println!("cargo:rerun-if-changed=../app");
    println!("cargo:rerun-if-changed=../src");
    tauri_build::build()
}
