// core-smooth-ramps.test.js: node --test app/test/core-smooth-ramps.test.js
// D465 (pane C): Track ▸ Smooth ramps in the app. The core is src/core/smoothramps.js (test/core_smooth_ramps.test.js); this is the shell's action
// (app/core/coreshell.js smoothRamps): a copy of the track first, then ONE undo step, and plain words when there is nothing to do. Rows:
//   1  on a track laid by 0.4.19 it copies the track to its backups first, as it was, then re-lays the ramps as one undo step; the message says what it did
//   2  Ctrl+Z gives back the track's bytes exactly; Ctrl+Y the smoothed bytes
//   3  a copy that cannot be written refuses by name, and nothing changes
//   4  an empty track: it says so, no copy, no undo step
//   5  a track with no ramps: nothing changes, and it says so in plain words; no copy, no undo step
//   6  a track laid by this build: already smooth, said, nothing changes
//   7  it never runs on its own: opening a saved 0.4.19 track leaves its bytes and its ramps as they were
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const X = require('../../src/core/extend.js');
const C = require('../../src/core/continuity.js');

const DEG = Math.PI / 180, R = 180, Q = (Math.PI * R) / 2;
function store({ backupFails = false } = {}) {
  const st = { docs: new Map(), backups: [], log: [] };
  return Object.assign(st, {
    listDocs: async () => [...st.docs.keys()],
    openDoc: async (n) => { if (!st.docs.has(n)) throw new Error(`not found: ${n}`); return st.docs.get(n); },
    saveDoc: async (n, t) => { st.log.push('save'); st.docs.set(n, t); },
    backupDoc: async (name, text) => { st.log.push('backup'); if (backupFails) throw new Error('the disk is full'); st.backups.push({ name, text }); return `${name}.bak`; },
  });
}
/** The ramps as 0.4.19 laid them (as test/core_smooth_ramps.test.js): the Bloss cubic on the piece's own knots, its start held. */
function as0419(doc) {
  return D.checkDoc({ ...doc, pieces: doc.pieces.map((P) => {
    if (P.type !== 'road') return P;
    const channels = { ...P.channels };
    for (const ch of ['phi', 'c', 'e', 'er']) {
      const c = P.channels[ch]; if (!Array.isArray(c)) continue;
      const n = c.length, v0 = c[0], v1 = c[n - 1];
      if (v0 === v1 || c[1] !== v0 || c[n - 2] !== v1) continue;
      channels[ch] = D.fitChannel((s) => v0 + (v1 - v0) * X.bloss(s / P.length), P.length, P.knots.map(Number), { v: v0, m: 0 }).map((x) => Number(x.toFixed(D.DEC[ch])) + 0);
    }
    return { ...P, channels };
  }) });
}
/** A bank with an edge, a cup, an edge back to 0 and a bank the other way with a right edge, in public words. */
function laid() {
  let d = X.extend(D.createDoc(), { length: 300, family: 'bowl' });
  d = X.extend(d, { length: 100, targets: { phi: 30 * DEG, e: 30 } });
  d = X.extend(d, { length: 400, targets: { phi: 0, c: 15 } });
  d = X.extend(d, { length: 50, targets: { e: 0 } });
  d = X.extend(d, { length: 50, targets: { phi: -10 * DEG, er: 35 } });
  return X.extend(d, { length: 100, targets: { phi: 0, er: 0 } });
}
async function shellWith(d, st = store()) {
  const s = await createCoreShell({ brushFn: null, storage: st, autosaveMs: 0 });
  if (d) s.adopt(d);
  return { s, st };
}
const present = (s) => s.getState().history.present;
const text = (s) => D.serialize(present(s));

test('row 1: on a track laid by 0.4.19 it copies the track to its backups first, as it was, then re-lays the ramps as ONE undo step and says what it did', async () => {
  const before = as0419(laid()), { s, st } = await shellWith(before);
  assert.ok(C.c2Breaks(before).length >= 6, 'control: the ramps step');
  const past = s.getState().history.past.length;
  await s.smoothRamps();
  assert.deepEqual(st.backups.map((b) => [b.name, b.text]), [['eq-unsaved', D.serialize(before)]], 'one copy, of the track as it was');
  assert.equal(s.getState().history.past.length, past + 1, 'one undo step');
  assert.deepEqual(C.c2Breaks(present(s)), [], 'the ramps are C2');
  assert.match(s.getState().message, /^smoothed \d+ bank, cup and edge ramps on \d+ pieces: they now start and end without a jolt; the route did not move \(Ctrl\+Z puts them back\)$/);
  assert.equal(s.getState().dirty, true);
});

test('row 2: Ctrl+Z gives back the track\'s bytes exactly, and Ctrl+Y the smoothed bytes', async () => {
  const before = as0419(laid()), { s } = await shellWith(before), was = text(s);
  await s.smoothRamps();
  const smoothed = text(s);
  assert.notEqual(smoothed, was, 'control: it changed');
  s.undo();
  assert.equal(text(s), was, 'the bytes it had');
  assert.match(s.getState().message, /^undid: pieces .* reshaped$/);
  s.redo();
  assert.equal(text(s), smoothed);
});

test('row 3: a copy that cannot be written refuses by name, and nothing changes', async () => {
  const before = as0419(laid()), { s, st } = await shellWith(before, store({ backupFails: true })), was = text(s), past = s.getState().history.past.length;
  await s.smoothRamps();
  assert.equal(s.getState().message, 'not smoothed: the copy from before could not be written (the disk is full); nothing changed');
  assert.equal(text(s), was); assert.equal(s.getState().history.past.length, past);
  assert.deepEqual(st.log, ['backup']);
});

test('row 4: an empty track: it says so, with no copy and no undo step', async () => {
  const { s, st } = await shellWith(null);
  await s.smoothRamps();
  assert.equal(s.getState().message, 'the track is empty: there are no ramps to smooth');
  assert.deepEqual([st.log, s.getState().history.past.length], [[], 0]);
});

test('row 5: a track with no ramps: nothing changes, and it says so in plain words, with no copy and no undo step', async () => {
  let d = X.extend(D.createDoc(), { length: 300, family: 'bowl' });
  for (let i = 0; i < 2; i++) d = X.extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = X.extend(d, { length: 200, targets: { kh: 0, kv: 0.002 } });
  const { s, st } = await shellWith(d), was = text(s);
  await s.smoothRamps();
  assert.equal(s.getState().message, 'no bank, cup or edge ramps to smooth on this track: nothing changed');
  assert.equal(text(s), was);
  assert.deepEqual([st.log, s.getState().history.past.length], [[], 0]);
});

test('row 6: a track laid by this build is already smooth: it says so, and nothing changes', async () => {
  const { s, st } = await shellWith(laid()), was = text(s);
  await s.smoothRamps();
  assert.match(s.getState().message, /^the \d+ ramps on this track are already smooth: nothing changed$/);
  assert.equal(text(s), was);
  assert.deepEqual([st.log, s.getState().history.past.length], [[], 0]);
});

test('row 7: it never runs on its own: opening a saved 0.4.19 track leaves its bytes and its ramps as they were', async () => {
  const st = store(), body = D.serialize(as0419(laid()));
  st.docs.set('eq-old', body);
  const { s } = await shellWith(null, st);
  await s.open('old');
  assert.equal(text(s), body, 'the bytes it was saved with');
  assert.ok(C.c2Breaks(present(s)).length >= 6, 'its ramps as they were');
  assert.deepEqual(st.backups, []);
});
