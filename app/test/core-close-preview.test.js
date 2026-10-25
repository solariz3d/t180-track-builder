// core-close-preview.test.js: node --test app/test/core-close-preview.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D242 made the app's Close PROPOSE before it committed; D339 (the ruling: "one single press and the algo runs it") made it ONE press again, with the lap proof as
// the guard the preview's Apply was (app/core/closejob.js runCloseBest picks the way of closing). The file keeps its name, which the mutation harness reads. Rows:
//   (rows 1 and 7 on a NEAR lap, 8.87 m from closing; row 2 on a coil no way of closing proves)
//   1  one press closes it AT ONCE: one undo step, the line says what it did, and Undo gives the open lap back
//   2  when no way proves, nothing changes: the same document, a line that says why, and no copy written
//   6  a refused export names EVERY red in plain words, grouped, with where
//   7  the press writes the copy from BEFORE the close first (backupNow('pre-close'), the D239 amendment); a copy that fails refuses it by name; an edit while
//      the copy is written is never closed over
//   (D339 removed: row 3, a window refused by name, and row 4, the preview's overlap check, which test/core_close_best.test.js and core_close_local.test.js cover
//   as routes; row 5, the preview's ghost; and "finish", the preview of new road)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createCoreShell } = require('../core/coreshell.js');

const R = 180, Q = (Math.PI * R) / 2;
/** An OPEN lap that ends near its start: 300 m, `turns` quarter turns, then `lastLen` m. */
async function openLap({ turns = 4, lastLen = 200 } = {}) {
  const s = await createCoreShell({ brushFn: null });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < turns; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: lastLen, transition: Math.min(40, lastLen), targets: { kh: 0 } });
  assert.equal(s.getState().message, null, s.getState().message); assert.equal(s.getState().history.present.closed, false); return s;
}
/** A NEAR lap in front of the user (adopted, as opening one does): openLap's lap closed whole, opened, one turn's inner control points nudged 1e-4
 *  rad/m; it ends 8.87 m from its start (B's lprobe2), as a lap the user is about to close does. openLap's own lap ends ~300 m past its start. */
async function nearLap() {
  const D = require('../../src/core/document.js'), C = require('../../src/core/close.js'), far = (await openLap()).getState().history.present;
  const open = D.checkDoc({ ...C.close(far, { edited: [0] }).doc, closed: false });
  const near = D.checkDoc({ ...open, pieces: open.pieces.map((P, k) => (k === 2 ? { ...P, channels: { ...P.channels, kh: P.channels.kh.map((v, i, a) => (i >= 3 && i <= a.length - 4 ? v + 1e-4 : v)) } } : P)) });
  const s = await createCoreShell({ brushFn: null }); s.adopt(near);
  assert.equal(s.getState().history.present.closed, false); return s;
}

test('row 1: one press closes a near lap AT ONCE: one undo step, the line says what it did, and Undo gives the open lap back', async () => {
  const s = await nearLap(), base = s.getState().history.present;
  await s.closeBest();
  const st = s.getState();
  assert.equal(st.history.present.closed, true, st.message); assert.equal(st.history.past[st.history.past.length - 1], base, 'one undo step');
  assert.match(st.message, /^closed: (bent|laid)/); assert.equal(st.messageKind, 'ok'); assert.equal(st.dirty, true);
  s.undo(); assert.equal(s.getState().history.present, base, 'Undo gives the open lap back');
});

test('row 2: when no way of closing proves, nothing changes: the same document, a line that says why, and no copy written', async () => {
  const s = await openLap({ turns: 8, lastLen: 60 }), base = s.getState().history.present, calls = [];
  s.backupNow = async (reason) => { calls.push(reason); return { file: 'x', reason }; };
  await s.closeBest();
  assert.equal(s.getState().history.present, base, 'nothing changed');
  assert.match(s.getState().message, /^not closed, nothing changed: no way of closing the loop proves the lap; the closest, /); assert.equal(s.getState().messageKind, 'error');
  assert.deepEqual(calls, [], 'no copy is written for a close that does not happen');
});

test('row 6: a refused export names EVERY red in plain words, grouped, with where (not the export\'s first id)', async () => {
  const { makeExporter } = require('../export/export.js'), ROOT = path.resolve(__dirname, '..', '..');
  const ex = await makeExporter(async (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const reds = [{ reason: 'downforce-ray-gap', s0: 210, s1: 212 }, { reason: 'self-intersection', s0: 200, s1: 230 }, { reason: 'stacked-within-2m', s0: 205, s1: 228 }, { reason: 'roll-rate', s0: 600, s1: 610, worst: 1.3 }];
  const red = { ...ex, runSegments() { throw new ex.ExportError('RED', 'validation is red, nothing written: downforce-ray-gap at s 210.0–212.0 m; …', { red: reds }); } };
  const s = await createCoreShell({ brushFn: null, exporter: red, storage: { writeExport: async () => {}, folderIsEmpty: async () => false, removeEmptyFolder: async () => {} } });
  s.extend({ length: 300, family: 'bowl' }); for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 200, transition: 40, targets: { kh: 0 } }); s.close();
  assert.equal(s.getState().history.present.closed, true, s.getState().message);
  await s.exportTo(require('os').tmpdir());
  const msg = s.getState().message;
  // D248 amended BY NAME: the three overlap reds (200–230, 205–228, 210–212, one piece) are ONE place now, and the count is of places (was "(3)", "(1)")
  assert.match(msg, /^not exported: the road overlaps itself \(1 place\): at 0\.20–0\.23 km \(p\d+\); /); assert.match(msg, /the road rolls too fast \(1 place\): at 0\.60–0\.61 km \(p\d+\)/);
  assert.ok(!/downforce-ray-gap/.test(msg), 'no validator id in the words'); assert.equal(s.getState().exportReds.length, 4, 'every red is kept for the red box');
});

test('row 7: the press writes the copy from BEFORE the close first (backupNow(\'pre-close\'), the D239 amendment); a copy that fails refuses it by name; an edit while the copy is written is never closed over', async () => {
  const s = await nearLap(), base = s.getState().history.present, calls = [];
  s.backupNow = async (reason) => { calls.push({ reason, present: s.getState().history.present }); return { file: 'x', reason }; };   // the shell's backupNow stood in for: what it is handed, and when
  await s.closeBest(); assert.equal(s.getState().history.present.closed, true, s.getState().message);
  assert.deepEqual(calls.map((c) => c.reason), ['pre-close']); assert.equal(calls[0].present, base, 'the backup is of the OPEN lap, taken before the close is committed');
  for (const fail of [async () => { throw new Error('disk full'); }, () => { throw new Error('disk full'); }]) {   // the real one REJECTS; a sync throw is refused the same
    const t = await nearLap(), tb = t.getState().history.present; t.backupNow = fail;
    await t.closeBest();
    assert.equal(t.getState().history.present, tb, 'a failed copy: nothing changed'); assert.match(t.getState().message, /not closed: the copy from before the close could not be written \(disk full\)/);
  }
  // an edit while the copy is being written: the close of the track that is no longer there is never committed over it
  const u = await nearLap(); let release, asked; const copying = new Promise((r) => { asked = r; }); u.backupNow = () => { asked(); return new Promise((r) => { release = r; }); };
  const pending = u.closeBest(); await copying; u.extend({ length: 20 }); const ub = u.getState().history.present; release(null); await pending;
  assert.equal(u.getState().history.present, ub, 'the edit stands; no close was committed over it'); assert.equal(ub.closed, false);
  assert.match(u.getState().message, /changed while the close was being worked out/);
});
