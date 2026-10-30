# T-180 Track Builder

A desktop app (Tauri 2) that builds Assetto Corsa tracks. The program is plain CommonJS that runs both in the webview and
under node; there is no bundler and no npm dependency.

- **The map:** `MAP.md` says what lives in each directory and module, and where to look for the document, geometry and mesh,
  the checker, the export, the panel, the ghost, and saving and loading. Most files open with a header that explains how and
  why they are built that way; read it before changing the file.
- **What changed:** `CHANGELOG.md`.

## Tests

Node's own test runner; nothing to install (`package.json` has no dependencies).

- Everything: `npm test`, which runs `node --test --test-concurrency=4 "test/*.test.js" "app/test/*.test.js"`.
  The full run includes the mutation harnesses (`*_mutation.test.js`) and takes tens of minutes.
- One file: `node --test test/<name>.test.js` or `node --test app/test/<name>.test.js`.
- Some app tests drive the real page in headless Chrome. They use `CHROME_PATH`, else Chrome's usual Windows install, and
  skip with the reason when there is no Chrome.
- The frame-timing tests measure milliseconds per frame and are sensitive to other work on the machine; run them alone
  when one is red before reading anything into it.

## Build

Needs Rust (with `cargo` in `~/.cargo/bin` on Windows) and the Tauri CLI (`cargo tauri`).

- The installer: `node src-tauri/release.cjs`. It runs `cargo tauri build`, then checks the finished exe and installer for
  anything from the building machine, and writes
  `src-tauri/target/release/bundle/nsis/T-180 Track Builder_<version>_x64-setup.exe`.
- `src-tauri/build.rs` copies `app/`, `src/` and `tools/` into `src-tauri/dist` during the build. If the Tauri CLI stops
  with "Unable to find your web assets", create the empty folder `src-tauri/dist` and build again; the build fills it.
- The version lives in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`.
