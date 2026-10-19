// install_local.test.js: node --test test/install_local.test.js. scripts/install-local.ps1 (D418 part 4), run for real against a temp install folder: the
// "installer" is a .cmd that copies a prepared exe into it, and the "built exe" is a small file holding the bundle-type marker. Windows only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync, spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'install-local.ps1');
const WIN = process.platform === 'win32';
const MARK = '__TAURI_BUNDLE_TYPE_VAR_';

// a temp world: dir/app/<name>.exe installed (the old one), dir/built.exe (marker + UNK), dir/setup.cmd copying dir/payload.exe over the installed exe
function world(name, payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180inst-'));
  const app = path.join(dir, 'app'); fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, name + '.exe'), 'the old install');
  const built = Buffer.from('head ' + MARK + 'UNK tail');
  fs.writeFileSync(path.join(dir, 'built.exe'), built);
  const stamped = Buffer.from('head ' + MARK + 'NSS tail');
  fs.writeFileSync(path.join(dir, 'payload.exe'), payload === 'unstamped' ? built : stamped);
  fs.writeFileSync(path.join(dir, 'setup.cmd'), `@copy /y "${path.join(dir, 'payload.exe')}" "${path.join(app, name + '.exe')}" >nul\r\n`);
  return { dir, app, exe: path.join(app, name + '.exe'), lock: path.join(dir, 'install.lock') };
}
function run(w, args, name = 't180-track-builder-none') {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Installer', path.join(w.dir, 'setup.cmd'),
    '-Built', path.join(w.dir, 'built.exe'), '-InstallDir', w.app, '-ProcessName', name, '-PollSec', '1', ...args],
  { encoding: 'utf8', env: { ...process.env, T180_INSTALL_LOCK: w.lock }, timeout: 60000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const done = (w) => { try { fs.rmSync(w.dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } };

test('row 1: an install backs the old exe up, installs, finds the installed exe is the built one stamped NSS, and releases the lock', { skip: !WIN }, () => {
  const w = world('t180-track-builder-none');
  try {
    const r = run(w, ['-Tag', 'row1']);
    assert.equal(r.code, 0, r.out);
    assert.equal(fs.readFileSync(w.exe + '.before-row1', 'utf8'), 'the old install', 'the backup holds the old exe');
    assert.match(r.out, /stamped compare: equal/);
    assert.ok(!fs.existsSync(w.lock), 'the lock is released');
  } finally { done(w); }
});

test('row 2: an installed exe that is not the built one stamped NSS fails the compare, exit 7, and the backup is kept', { skip: !WIN }, () => {
  const w = world('t180-track-builder-none', 'unstamped');
  try {
    const r = run(w, ['-Tag', 'row2']);
    assert.equal(r.code, 7, r.out);
    assert.ok(fs.existsSync(w.exe + '.before-row2'));
    assert.ok(!fs.existsSync(w.lock), 'the lock is released on a failure too');
  } finally { done(w); }
});

test('row 3: while the builder is open it waits, never closes it, and gives up with exit 3 with nothing changed', { skip: !WIN }, () => {
  // a process named like the builder: a copy of node.exe under that name, idling
  const w = world('t180-fake-open');
  const fake = path.join(w.dir, 't180-fake-open.exe'); fs.copyFileSync(process.execPath, fake);
  const ch = spawn(fake, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1500)']);
    const r = run(w, ['-Tag', 'row3', '-WaitSec', '3'], 't180-fake-open');
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /never closed here/);
    assert.equal(ch.exitCode, null, 'the open process is still running');
    assert.ok(!fs.existsSync(w.exe + '.before-row3'), 'no backup');
    assert.equal(fs.readFileSync(w.exe, 'utf8'), 'the old install', 'nothing installed');
  } finally { ch.kill(); spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 500)']); done(w); }
});

test('row 4: a lock held by a live process makes it wait and give up with exit 4; a lock whose holder is gone is taken over', { skip: !WIN }, () => {
  const w = world('t180-track-builder-none');
  try {
    const me = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().ToString('o')`], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(w.lock, JSON.stringify({ pid: process.pid, pidStarted: me, token: 'x', tag: 'another install', started: 'now' }));
    const held = run(w, ['-Tag', 'row4a', '-WaitSec', '2']);
    assert.equal(held.code, 4, held.out);
    assert.equal(fs.readFileSync(w.exe, 'utf8'), 'the old install', 'nothing installed under a held lock');
    fs.writeFileSync(w.lock, JSON.stringify({ pid: process.pid, pidStarted: '2000-01-01T00:00:00.0000000Z', token: 'x', tag: 'a gone holder', started: 'then' }));
    const stale = run(w, ['-Tag', 'row4b']);
    assert.equal(stale.code, 0, stale.out);
    assert.match(stale.out, /is gone; taking it over/);
    assert.ok(!fs.existsSync(w.lock), 'the taken-over lock is released after the install');
  } finally { done(w); }
});

test('row 5: -Take holds the lock for a merge; an install with its token runs under it and leaves it held; -Release frees it', { skip: !WIN }, () => {
  const w = world('t180-track-builder-none');
  try {
    const env = { ...process.env, T180_INSTALL_LOCK: w.lock };
    const take = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Take', '-Tag', 'merge5'], { encoding: 'utf8', env });
    assert.equal(take.status, 0, take.stdout + take.stderr);
    const token = take.stdout.trim().split(/\r?\n/).pop();
    assert.equal(JSON.parse(fs.readFileSync(w.lock, 'utf8')).pid, process.pid, 'the holder is the calling process');
    const other = run(w, ['-Tag', 'row5x', '-WaitSec', '2']);
    assert.equal(other.code, 4, 'an install without the token waits on the merge: ' + other.out);
    const mine = run(w, ['-Tag', 'row5', '-Token', token]);
    assert.equal(mine.code, 0, mine.out);
    assert.ok(fs.existsSync(w.lock), 'still held for the merge');
    const bad = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Release', '-Token', 'wrong'], { encoding: 'utf8', env });
    assert.equal(bad.status, 8);
    const rel = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Release', '-Token', token], { encoding: 'utf8', env });
    assert.equal(rel.status, 0, rel.stdout + rel.stderr);
    assert.ok(!fs.existsSync(w.lock));
  } finally { done(w); }
});

test('row 6: an existing backup of that name is refused, exit 5, and nothing is installed', { skip: !WIN }, () => {
  const w = world('t180-track-builder-none');
  try {
    fs.writeFileSync(w.exe + '.before-row6', 'an earlier backup');
    const r = run(w, ['-Tag', 'row6']);
    assert.equal(r.code, 5, r.out);
    assert.equal(fs.readFileSync(w.exe + '.before-row6', 'utf8'), 'an earlier backup', 'the earlier backup is untouched');
    assert.equal(fs.readFileSync(w.exe, 'utf8'), 'the old install');
  } finally { done(w); }
});
