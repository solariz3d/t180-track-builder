// core-close-preview.test.js: node --test app/test/core-close-preview.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D242: the app's Close PROPOSES before it commits (the keeper, TEST 1: the one-click close moved every piece and the lap ran into itself). Rows:
//   (rows 1, 2 and 5 on a NEAR lap, 8.87 m from closing; rows 3 and 4 on laps only a wider window can close)
//   1  propose: nothing committed; only the window moves (every earlier piece 0 m); Apply is ONE undo step, and Undo gives the open lap back
//   2  Cancel drops the preview; an edit drops a stale one; Apply with nothing to apply says so
//   3  a window that cannot close the loop: refused BY NAME in the message, no preview
//   4  the preview's OVERLAP CHECK: a coil (two circles on one another, TEST 1's stacking) is reported as the road overlapping itself
//   5  the preview shows the proposal as a GHOST, and a click on a place moves the camera there (free mode, looking at the station)
//   6  a refused export names EVERY red in plain words, grouped, with where
//   7  Apply writes the copy from BEFORE the close first (backupNow('pre-close'), the D239 amendment), and a copy that fails refuses the Apply by name
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createCoreShell } = require('../core/coreshell.js');
const P = require('../preview/preview.js');

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
 *  rad/m; it ends 8.87 m from its start (B's lprobe2), as a lap the keeper is about to close does. openLap's own lap ends ~300 m past its start. */
async function nearLap() {
  const D = require('../../src/core/document.js'), C = require('../../src/core/close.js'), far = (await openLap()).getState().history.present;
  const open = D.checkDoc({ ...C.close(far, { edited: [0] }).doc, closed: false });
  const near = D.checkDoc({ ...open, pieces: open.pieces.map((P, k) => (k === 2 ? { ...P, channels: { ...P.channels, kh: P.channels.kh.map((v, i, a) => (i >= 3 && i <= a.length - 4 ? v + 1e-4 : v)) } } : P)) });
  const s = await createCoreShell({ brushFn: null }); s.adopt(near);
  assert.equal(s.getState().history.present.closed, false); return s;
}

test('row 1: Close PROPOSES: nothing is committed, only the window moves (every earlier piece 0 m); Apply is one undo step, and Undo gives the open lap back', async () => {
  const s = await nearLap(), base = s.getState().history.present, n = base.pieces.length;
  s.proposeClose({ last: true });
  const st = s.getState(), p = st.closeProposal;
  assert.ok(p, st.message); assert.equal(st.history.present, base, 'nothing committed'); assert.equal(p.base, base); assert.equal(p.doc.closed, true);
  assert.deepEqual(p.window.ids, [base.pieces[n - 1].id]);
  for (const x of p.displacement) if (x.piece < n - 1) assert.equal(x.maxM, 0, `${x.id} is outside the window: it does not move at all`);
  assert.ok(p.displacement.find((x) => x.piece === n - 1).maxM > 1e-3, 'control: the last piece is what moves');
  assert.match(st.message, /close preview: .*Apply or cancel/);
  await s.applyClose(); assert.equal(s.getState().history.present.closed, true); assert.equal(s.getState().closeProposal, null); assert.match(s.getState().message, /loop closed/);
  s.undo(); assert.equal(s.getState().history.present, base, 'Undo after Apply: the open lap, the very same document');
});

test('row 2: Cancel drops the preview; an edit drops a stale preview; Apply with nothing to apply says so', async () => {
  const s = await nearLap(), base = s.getState().history.present;
  s.proposeClose({ last: true }); assert.ok(s.getState().closeProposal); s.cancelClose(); assert.equal(s.getState().closeProposal, null); assert.equal(s.getState().history.present, base);
  await s.applyClose(); assert.match(s.getState().message, /nothing to apply/); assert.equal(s.getState().history.present, base);
  s.proposeClose({ last: true }); assert.ok(s.getState().closeProposal);
  s.extend({ length: 20 }); assert.equal(s.getState().closeProposal, null, 'an edit drops the preview made for the old track');
});

test('row 3: a window that cannot close the loop is refused BY NAME in the message, and there is no preview', async () => {
  const s = await openLap({ lastLen: 30 });
  s.proposeClose({ last: true });
  assert.equal(s.getState().closeProposal || null, null); assert.match(s.getState().message, /can't close using only the last 30 m \(p\d+\).*widen the window/i);
});

test('row 4: the preview\'s OVERLAP CHECK: a coil (two circles on one another, as TEST 1 stacked) is reported as the road overlapping itself, with where', async () => {
  const s = await openLap({ turns: 8, lastLen: 60 });
  s.proposeClose();
  const p = s.getState().closeProposal; assert.ok(p, s.getState().message);
  assert.ok(p.check.overlaps.length > 0, 'the closed coil overlaps itself');
  // the MESH-only reds, which the live panel cannot see (it validates without the mesh): self-intersection from the mesh's own check, and a downforce ray that meets another road
  for (const r of ['self-intersection', 'downforce-ray-gap', 'stacked-within-2m']) assert.ok(p.check.overlaps.some((x) => x.reason === r), `the check finds ${r} (B's lprobe: 2 self-intersection, 15 ray, 2 stacked)`);
  assert.match(s.getState().message, /OVERLAPS ITSELF in \d+ place/);
  const RG = require('../validate-ui/redgroups.js'), g = RG.groupReds(p.check.overlaps, p.resolved.segments);
  assert.equal(g[0].key, 'overlap'); assert.ok(g[0].items.every((it) => /^p\d+$/.test(it.piece) && / km$/.test(it.km)), 'each place names its km and its piece');
});

function headlessPreview(s) {
  let q = [], now = 0;   // frames run only when step() is called: the pose a view reports is the one the last frame drew
  const win = { devicePixelRatio: 1, document: { hidden: false, activeElement: null, body: {}, addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (fn) => { q.push(fn); return q.length; }, cancelAnimationFrame() {}, setTimeout: () => 0, clearTimeout() {} };
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const canvas = { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  const pv = P.createPreview({ canvas, shell: s, win });
  pv.step = () => { const f = q; q = []; now += 16; for (const g of f) g(now); };
  return pv;
}
test('row 5: the preview shows the proposal as a GHOST (dropped on Cancel), and focus(s) puts the camera in free mode looking at the station', async () => {
  const s = await nearLap(), pv = headlessPreview(s);
  assert.equal(pv.view().ghost, 0, 'no ghost before'); s.proposeClose({ last: true }); assert.ok(pv.view().ghost > 0, 'the proposal is drawn as a ghost');
  s.cancelClose(); assert.equal(pv.view().ghost, 0, 'Cancel drops the ghost');
  assert.equal(pv.focus(150), true); pv.step(); assert.equal(pv.view().mode, 'free');
  const v = pv.view(), m = require('../camera/cameras.js').sampleAt(v.track.path, 150), d = [0, 1, 2].map((k) => v.pose.target[k] - v.pose.eye[k]), toM = [0, 1, 2].map((k) => m.pos[k] - v.pose.eye[k]);
  const cos = (d[0] * toM[0] + d[1] * toM[1] + d[2] * toM[2]) / (Math.hypot(...d) * Math.hypot(...toM)); assert.ok(cos > 0.999, `the camera looks at the station at 150 m (cos ${cos})`);
  pv.dispose();
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

test('row 7: Apply writes the copy from BEFORE the close first (backupNow(\'pre-close\'), the D239 amendment), and a copy that fails (rejects or throws) refuses the Apply by name', async () => {
  const s = await nearLap(), base = s.getState().history.present, calls = [];
  s.backupNow = async (reason) => { calls.push({ reason, present: s.getState().history.present }); return { file: 'x', reason }; };   // the shell's backupNow stood in for: what it is handed, and when
  s.proposeClose({ last: true }); assert.ok(s.getState().closeProposal, s.getState().message); assert.equal(calls.length, 0, 'a preview writes nothing');
  await s.applyClose(); assert.equal(s.getState().history.present.closed, true, s.getState().message);
  assert.deepEqual(calls.map((c) => c.reason), ['pre-close']); assert.equal(calls[0].present, base, 'the backup is of the OPEN lap, taken before the close is committed');
  for (const fail of [async () => { throw new Error('disk full'); }, () => { throw new Error('disk full'); }]) {   // the real one REJECTS; a sync throw is refused the same
    const t = await nearLap(), tb = t.getState().history.present; t.backupNow = fail;
    t.proposeClose({ last: true }); assert.ok(t.getState().closeProposal, t.getState().message); await t.applyClose();
    assert.equal(t.getState().history.present, tb, 'a failed copy: nothing changed'); assert.match(t.getState().message, /not closed: the copy from before the close could not be written \(disk full\)/);
  }
  // an edit while the copy is being written drops the preview: the stale close is never committed over it
  const u = await nearLap(); let release; u.backupNow = () => new Promise((r) => { release = r; });
  u.proposeClose({ last: true }); const pending = u.applyClose(); u.extend({ length: 20 }); const ub = u.getState().history.present; release(null); await pending;
  assert.equal(u.getState().history.present, ub, 'the edit stands; no close was committed over it'); assert.equal(ub.closed, false);
  assert.match(u.getState().message, /changed while its copy was being written/);
});
