#!/usr/bin/env node
// release.cjs: build the release installer (NSIS), with nothing of the builder's machine inside it, and check that.
//
//   node src-tauri/release.cjs            -> src-tauri/target/release/bundle/nsis/T-180 Track Builder_<version>_x64-setup.exe
//   (CARGO_TARGET_DIR moves the target dir, as for any cargo build)
//
// WHY THIS AND NOT A BARE `cargo tauri build`. A Rust release binary keeps the absolute source path of every dependency
// for its panic messages, and on Windows those are <home>\.cargo\registry\src\…, with the user's name in them: measured
// on the first 0.2.0 build, 98 occurrences in the exe. So this script remaps them at build time
// (rustc --remap-path-prefix): cargo's home → /cargo, this repository → /t180. The prefixes are computed from the
// environment when it runs, so no personal path is written into the repository. After the build it SCANS the finished exe
// and the installer for the user's name and home folder, and fails (exit 2) if either is still there.
// Build output (target/, dist/, gen/) is gitignored (src-tauri/.gitignore); no installer is ever committed.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');

/** The rustc flags that take this machine's paths out of the binary. */
function remapFlags({ env = process.env, home = os.homedir(), repo = REPO } = {}) {
  const cargoHome = env.CARGO_HOME || path.join(home, '.cargo');
  return [`--remap-path-prefix=${cargoHome}=/cargo`, `--remap-path-prefix=${repo}=/t180`];
}

/** Every needle found in `buf` (bytes, as latin1), with its count. Case-insensitive. */
function scanForPrivate(buf, needles) {
  const hay = Buffer.from(buf).toString('latin1').toLowerCase();
  return needles.filter(Boolean).map((n) => ({ needle: n, count: hay.split(n.toLowerCase()).length - 1 })).filter((x) => x.count > 0);
}

/** What must not be in a release: the user's name as a path part, and the home folder in both slash forms. */
function privateNeedles({ home = os.homedir(), user = os.userInfo().username } = {}) {
  return [`\\${user}\\`, `/${user}/`, home, home.replace(/\\/g, '/')];
}

function main() {
  const conf = JSON.parse(fs.readFileSync(path.join(__dirname, 'tauri.conf.json'), 'utf8'));
  const cargo = process.platform === 'win32' ? path.join(os.homedir(), '.cargo', 'bin', 'cargo.exe') : 'cargo';
  const rustflags = [process.env.RUSTFLAGS || '', ...remapFlags()].filter(Boolean).join(' ');
  const r = spawnSync(cargo, ['tauri', 'build', '--ci'], { cwd: REPO, stdio: 'inherit', env: { ...process.env, RUSTFLAGS: rustflags } });
  if (r.status !== 0) { console.error(`release: cargo tauri build failed (${r.status})`); process.exit(r.status || 1); }
  const target = process.env.CARGO_TARGET_DIR || path.join(__dirname, 'target');
  const exe = path.join(target, 'release', 't180-track-builder.exe');
  const setup = path.join(target, 'release', 'bundle', 'nsis', `${conf.productName}_${conf.version}_x64-setup.exe`);
  let bad = false;
  for (const f of [exe, setup]) {
    const found = scanForPrivate(fs.readFileSync(f), privateNeedles());
    console.log(`${path.basename(f)}: ${fs.statSync(f).size} bytes, ${found.length ? 'PRIVATE PATHS: ' + found.map((x) => `${x.count}×`).join(', ') : 'no private paths'}`);
    if (found.length) bad = true;
  }
  if (bad) { console.error('release: the build carries this machine\'s paths; it must not be shipped'); process.exit(2); }
  console.log(`release: ${setup}`);
}

if (require.main === module) main();
module.exports = { remapFlags, scanForPrivate, privateNeedles };
