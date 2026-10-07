# Release: T-180 Track Builder 0.3.2

The installer: a Windows NSIS setup built with Tauri 2, as ARCHITECTURE §9 says ("A Tauri v2 desktop app
(standalone, installed with NSIS, no browser)"), the way blackbox ships (its `src-tauri/tauri.conf.json`:
`"targets": ["nsis"]`, `installMode: "currentUser"`).

## Building it

```
node src-tauri/release.cjs
```

It runs `cargo tauri build --ci` with the machine's own paths remapped out of the binary, then scans the exe and the
installer for the user's name and home folder, and refuses (exit 2) if either is left. The installer lands at
`src-tauri/target/release/bundle/nsis/T-180 Track Builder_0.3.2_x64-setup.exe`, or under `$CARGO_TARGET_DIR` if that is
set. Needs Rust with `tauri-cli` 2 (`cargo install tauri-cli`); Node is only for the build script and the tests, since
the app has no frontend build step (`src-tauri/build.rs` copies `app/`, `src/` and `tools/` into `dist/`).

Build a release from a COMMITTED tree. `build.rs` copies the working copy as it is, so whatever is uncommitted goes into
the installer.

## What is in it

- **Installed files:** `t180-track-builder.exe` and `uninstall.exe`, into the folder the installer is given
  (per-user, no administrator rights), with a Start Menu and a Desktop shortcut, and an uninstall entry under the
  current user.
- **Embedded in the exe:** the `dist/` tree, which is `app/` (without `app/test/`), `src/` and `tools/`. That is
  JavaScript, one HTML page plus a preview smoke page, `app/README.md`, and the AcTools licence text that
  `app/preview` carries.
- **Not in it:** no replays, no sample or reference tracks, no other author's kn5, textures or AI lines, no saved
  tracks, no autosave, no remembered Assetto Corsa folder, and no settings. Those live in the user's own app-data
  folder (`%APPDATA%\com.solariz3d.t180-track-builder`), are made on the user's machine, and are left in place by the
  uninstaller.

## What it does not do

- It does not launch Assetto Corsa unless the user turns on "See it in Assetto (launches the game)", which is off by
  default. "Export to Assetto Corsa" writes only `content\tracks\t180b_*` folders, and never one it did not make.
- It is not code-signed, so Windows SmartScreen will warn about an unknown publisher on first run.
- It does not update itself.
