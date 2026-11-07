# T-180 Track Builder

A desktop app (Tauri 2) that builds Assetto Corsa tracks. The program is plain CommonJS that runs both in the webview and
under node; there is no bundler and no npm dependency.

- **The map:** `MAP.md` says what lives in each directory and module, and where to look for the document, geometry and mesh,
  the checker, the export, the panel, the ghost, and saving and loading. Most files open with a header that explains how and
  why they are built that way; read it before changing the file.
- **What changed:** `CHANGELOG.md`.

## Tests

Node's own test runner; nothing to install (`package.json` has no dependencies).

Three tiers, by when you run them:

- **While you work: `node scripts/test-touched.cjs`.** The test files that load what you changed since the merge base with
  main, through require() and through the page (index.html's loadCjs), each printed with its reason (`--list` prints and runs
  nothing; `--base <ref>`, or name files). A file it cannot read (a stylesheet, the Rust side) or that no test loads falls back
  to test-fast. It leaves out the mutation harnesses (`--mutation` adds the changed module's) and the frame-timing files.
  It **cannot see coupling through data and behaviour** (the panel asking for something other than what the core lays, a
  fixture, a source grep): a green here is not a green for the base.
- **Before you hand back, push or land: `node scripts/test-fast.cjs`, the whole base, once.** What CI runs on every push:
  everything but the mutation harnesses and the five timing files (drag-frame, release-frame, sculpt-frame,
  core-extra-bank-drag-cost, preview-lod-frame); `--list` prints it, `--mutation` runs only the harnesses. The workflow is
  `.github/workflows/ci.yml`.
- **Weekly, on CI: the mutation harnesses** (`*mutation.test.js`), tens of minutes. `npm test` is everything at once,
  `node --test --test-concurrency=4 "test/*.test.js" "app/test/*.test.js"`, harnesses and timing files included.
- **The timing files: `node scripts/test-fast.cjs --timing`,** one at a time, alone, and only on a machine whose profile says
  `timing: true` (the one the bars are set for). Anywhere else it prints the skip and runs nothing.
- **Each machine's profile** is the `heavy` object in its own `~/.consonance.json` (never synced), e.g.
  `"heavy": { "concurrency": 2, "timing": false }`. `concurrency` sets both scripts' `--test-concurrency`;
  `T180_TEST_CONCURRENCY` overrides it for one run, and with neither it is 4. No file or no `heavy` is the old behaviour;
  a value the scripts cannot read is refused by name. Each number is measured on its machine. `npm test` keeps its fixed 4.
- One file: `node --test test/<name>.test.js` or `node --test app/test/<name>.test.js`.
- Some app tests drive the real page in headless Chrome. They use `CHROME_PATH`, else Chrome's usual Windows install, and
  skip with the reason when there is no Chrome.
- The timing tests measure milliseconds per frame or per drag against a bar set for the user's machine, and are sensitive
  to other work on it; a red on another machine, or beside another suite, says nothing about the code.

## Build

Needs Rust (with `cargo` in `~/.cargo/bin` on Windows) and the Tauri CLI (`cargo tauri`).

- The installer: `node src-tauri/release.cjs`. It runs `cargo tauri build`, then checks the finished exe and installer for
  anything from the building machine, and writes
  `src-tauri/target/release/bundle/nsis/T-180 Track Builder_<version>_x64-setup.exe`.
- `src-tauri/build.rs` copies `app/`, `src/` and `tools/` into `src-tauri/dist` during the build. If the Tauri CLI stops
  with "Unable to find your web assets", create the empty folder `src-tauri/dist` and build again; the build fills it.
- The version lives in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`.
