// browser-cap.test.js: node --test app/test/browser-cap.test.js
// D504: A TEST RUN OPENS AT MOST N HEADLESS BROWSERS ON THE MACHINE. Every page test opened its own Chrome (5 to 9 processes each), 4 test files ran at once
// and harnesses ran inner suites at 4 more, so one run held 11 browsers and 97 chrome.exe (7.2 GB) at 18:57 on 2026-10-27. soundrender.js takeSlot is the
// cap: a slot is a file in a folder every process on the machine shares, taken before a Chrome is spawned and given back when it exits. Rows:
//   1  N slots are taken at once; the next waits, and takes the slot the moment one is given back
//   2  a slot whose holder process is gone is taken over at once (a test killed hard never gives its slot back)
//   3  a wait is said once after waitLogMs, naming the holders; after maxWaitMs it is an error naming them, and the waiter holds no slot
//   4  N is T180_BROWSERS, 4 when unset; anything but a whole number 2 or more is refused (menubar-page holds one browser while it opens a second)
//   5  giving a slot back twice is harmless, and never removes a slot someone else has taken since
//   6  launchChrome holds a slot while its Chrome lives and gives it back when that Chrome exits. Skipped where there is no Chrome
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const { chromePath, launchChrome, connect, takeSlot, slotCount, SLOT_DIR } = require('./soundrender.js');
const CHROME = chromePath();

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 't180-cap-test-'));
const slots = (dir) => fs.readdirSync(dir).filter((f) => /^slot-\d+\.json$/.test(f)).sort();
const quiet = { log: () => {} };
/** a pid that is surely gone: a node that has already exited */
const deadPid = () => { const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }); return Number(r.stdout); };

test('row 1: N slots are taken at once; the next waits, and takes the slot the moment one is given back', async () => {
  const dir = tmp();
  try {
    const held = []; for (let i = 0; i < 3; i++) held.push(await takeSlot({ dir, n: 3, poll: 20, ...quiet }));
    assert.deepEqual(slots(dir), ['slot-1.json', 'slot-2.json', 'slot-3.json'], 'three slots are files');
    let got = null; const waiting = takeSlot({ dir, n: 3, poll: 20, ...quiet }).then((r) => { got = r; });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(got, null, 'a fourth waits while three are held');
    held[1]();
    await waiting;
    assert.equal(typeof got, 'function', 'it took the slot that was given back');
    assert.equal(slots(dir).length, 3, 'still three slots, no more');
    got(); held[0](); held[2]();
    assert.deepEqual(slots(dir), [], 'every slot given back');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('row 2: a slot whose holder process is gone is taken over at once', async () => {
  const dir = tmp();
  try {
    const gone = deadPid();
    for (let k = 1; k <= 2; k++) fs.writeFileSync(path.join(dir, `slot-${k}.json`), JSON.stringify({ pid: gone, started: new Date().toISOString(), token: 'old' }));
    const t0 = Date.now(), release = await takeSlot({ dir, n: 2, poll: 20, waitLogMs: 60000, maxWaitMs: 5000, ...quiet });
    assert.ok(Date.now() - t0 < 2000, `taken at once (${Date.now() - t0} ms)`);
    const mine = slots(dir).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((h) => h.pid === process.pid);
    assert.equal(mine.length, 1, 'the slot now names this process');
    release();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('row 3: a wait is said once after waitLogMs, naming the holders; after maxWaitMs it is an error naming them, and the waiter holds no slot', async () => {
  const dir = tmp();
  try {
    const held = await takeSlot({ dir, n: 2, poll: 20, ...quiet }), held2 = await takeSlot({ dir, n: 2, poll: 20, ...quiet });
    const lines = [];
    await assert.rejects(takeSlot({ dir, n: 2, poll: 20, waitLogMs: 100, maxWaitMs: 500, log: (s) => lines.push(s) }),
      (e) => { assert.match(e.message, /no headless browser slot after 0\.5 s/); assert.match(e.message, new RegExp(`pid ${process.pid}`)); return true; });
    assert.equal(lines.length, 1, `one line while waiting: ${JSON.stringify(lines)}`);
    assert.match(lines[0], /waiting for a headless browser slot \(2 of 2 held/);
    assert.match(lines[0], new RegExp(`pid ${process.pid}`));
    assert.equal(slots(dir).length, 2, 'the waiter took nothing');
    held(); held2();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('row 4: N is T180_BROWSERS, 4 when unset; anything but a whole number 2 or more is refused', () => {
  assert.equal(slotCount({}), 4);
  assert.equal(slotCount({ T180_BROWSERS: '' }), 4);
  assert.equal(slotCount({ T180_BROWSERS: '6' }), 6);
  for (const v of ['0', '1', '-3', '2.5', 'four', ' ']) assert.throws(() => slotCount({ T180_BROWSERS: v }), /T180_BROWSERS/, `refused: ${JSON.stringify(v)}`);
});

test('row 5: giving a slot back twice is harmless, and never removes a slot someone else has taken since', async () => {
  const dir = tmp();
  try {
    const release = await takeSlot({ dir, n: 2, poll: 20, ...quiet });
    release();
    const other = { pid: process.pid, started: new Date().toISOString(), token: 'someone-else' };
    fs.writeFileSync(path.join(dir, 'slot-1.json'), JSON.stringify(other));
    release();
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'slot-1.json'), 'utf8')), other, 'the other holder keeps its slot');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('row 6: launchChrome holds a slot while its Chrome lives and gives it back when that Chrome exits', { skip: CHROME ? false : 'no Chrome here (set CHROME_PATH)' }, async () => {
  const mineNow = () => { try { return slots(SLOT_DIR).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(SLOT_DIR, f), 'utf8')); } catch (e) { return {}; } }).filter((h) => h.pid === process.pid && h.chrome !== undefined); } catch (e) { return []; } };
  const before = mineNow().length;
  const { ch, dir, tgt } = await launchChrome(CHROME, [], 't180cap-');
  let exited = false;
  try {
    const p = await connect(tgt.webSocketDebuggerUrl); try { await p.send('Runtime.evaluate', { expression: "document.title = 'zz-headless-test'; true" }); } finally { p.ws.close(); }   // D484: a headless page is always titled so
    const held = mineNow();
    assert.equal(held.length, before + 1, 'one more slot names this process while the Chrome lives');
    assert.ok(held.some((h) => h.chrome === ch.pid), `the slot names the Chrome's pid ${ch.pid}: ${JSON.stringify(held)}`);
    const gone = new Promise((r) => ch.once('exit', r)); ch.kill(); await gone; exited = true;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(mineNow().length, before, 'given back when the Chrome exited');
  } finally {
    if (!exited) ch.kill();
    await new Promise((r) => setTimeout(r, 300)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may hold it */ }
  }
});
