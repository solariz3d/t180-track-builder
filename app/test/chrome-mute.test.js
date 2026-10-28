// chrome-mute.test.js: node --test app/test/chrome-mute.test.js
// D409: EVERY BROWSER A TEST OR A SCRIPT LAUNCHES IS MUTED. A timing run played the builder's sounds aloud on the speakers (2026-10-19), because the
// headless Chrome the tests start, like any Chrome, plays what the page plays. --mute-audio silences the browser's output; an OfflineAudioContext
// (soundrender.js renderClips) renders into a buffer and is not affected. Rows:
//   1  every launch site in app/, scripts/ and test/ (a line that hands a browser --remote-debugging-port: a spawned Chrome, or WebView2's
//      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS) passes --mute-audio on that same line; the scan must find the known sites (the shared launchChrome
//      and prove_render's two app launches), so a scan that finds nothing cannot pass. AMENDED (D504): texture-page's own spawn is gone, it uses launchChrome
//   2  (the librarian, 07:05) the shared launcher itself: a Chrome started by soundrender.js launchChrome, with the caller's own arguments, was spawned
//      with --mute-audio (its ChildProcess spawnargs, the command line it was started with). Skipped where there is no Chrome
//   3  (D498 item 4, A's review of 8472e7d) every test file that starts a browser page itself (a launch site, or a call to the shared launchChrome) titles it
//      zz-headless-test, so a window a run leaves behind is told from the user's at a glance; a file that only renders sound through soundrender.js
//      renderClips is covered by soundrender.js, which sets it. This file's own row 2 opens no page and is left out
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { chromePath, launchChrome } = require('./soundrender.js');
const CHROME = chromePath();

const REPO = path.join(__dirname, '..', '..');
const DIRS = ['app', 'scripts', 'test'];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(c|m)?js$/.test(e.name)) out.push(p);
  }
  return out;
}

/** each code line (not a // comment line) that hands a browser a DevTools port: { file, line, text } */
function launchSites() {
  const sites = [];
  for (const d of DIRS) for (const f of walk(path.join(REPO, d), [])) {
    if (f === __filename) continue;
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((text, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(text)) return;
      if (/--remote-debugging-port=/.test(text)) sites.push({ file: path.relative(REPO, f).replace(/\\/g, '/'), line: i + 1, text });
    });
  }
  return sites;
}

test('row 1: every browser launch site in app/, scripts/ and test/ passes --mute-audio', () => {
  const sites = launchSites();
  const files = [...new Set(sites.map((s) => s.file))].sort();
  // AMENDED (D504): texture-page.test.js left the known sites when its Chrome moved onto launchChrome (the browser cap); it must now have none of its own
  for (const f of ['app/test/soundrender.js', 'scripts/prove_render.js']) assert.ok(files.includes(f), `the scan finds the launch site in ${f} (found: ${files.join(', ') || 'none'})`);
  assert.ok(!files.includes('app/test/texture-page.test.js'), 'texture-page.test.js starts no Chrome of its own (D504: it uses launchChrome)');
  assert.ok(sites.length >= 3, `the scan finds at least the three known launch sites (${sites.length})`);
  const loud = sites.filter((s) => !/--mute-audio/.test(s.text)).map((s) => `${s.file}:${s.line}`);
  assert.deepEqual(loud, [], 'launch sites without --mute-audio');
});

test('row 2: a Chrome started by the shared launchChrome is spawned with --mute-audio, beside the caller\'s own arguments', { skip: CHROME ? false : 'no Chrome here (set CHROME_PATH)' }, async () => {
  const { ch, dir } = await launchChrome(CHROME, ['--window-size=800,600'], 't180mute-');
  try {
    assert.ok(ch.spawnargs.includes('--window-size=800,600'), `the caller's argument is passed: ${ch.spawnargs.join(' ')}`);
    assert.ok(ch.spawnargs.includes('--mute-audio'), `spawned without --mute-audio: ${ch.spawnargs.join(' ')}`);
  } finally {
    ch.kill(); await new Promise((r) => setTimeout(r, 300)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ }
  }
});

test('row 3: every test file that starts a browser page itself sets the zz-headless-test title', () => {
  const code = (t) => t.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const starters = [];
  for (const d of ['app/test', 'test']) for (const f of walk(path.join(REPO, d), [])) {
    if (f === __filename) continue;
    const t = fs.readFileSync(f, 'utf8');
    if (/--remote-debugging-port=|\blaunchChrome\(/.test(code(t))) starters.push({ file: path.relative(REPO, f).replace(/\\/g, '/'), titled: /zz-headless-test/.test(code(t)) });
  }
  const files = starters.map((x) => x.file);
  for (const k of ['app/test/soundrender.js', 'app/test/drag-frame.test.js', 'app/test/texture-page.test.js']) assert.ok(files.includes(k), `the scan finds ${k} (found: ${files.join(', ') || 'none'})`);
  // nine, not ten (D503): 0.4.25's Aurora revert (70f7c63) took out sky-aurora-look.test.js, one of the ten this row was written against at fd4c8ea
  assert.ok(starters.length >= 9, `the scan finds at least the nine known starters (${starters.length})`);
  assert.deepEqual(starters.filter((x) => !x.titled).map((x) => x.file), [], 'test files that start a page and never title it zz-headless-test');
});
