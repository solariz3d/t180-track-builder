// core-check-lean.test.js: node --test app/test/core-check-lean.test.js
// 2026-10-15, reported: Close on ELYSIUM (24 km, "new road from the end to the start") turned the window white. Measured in the page: the overlap check's two workers each
// built the check's mesh holding every piece's spare boundary rows at once (~900 MB) and kept the validator's 2.1 million load lines (~650 MB) it never read; beside the page
// (1.1 GB) and the track checker (0.8 GB) that spent the page's 4 GB and the page died. The check now builds its mesh LEAN (src/geom/mesh.js buildMesh `lean`) and asks the
// validator for the centreline's lines only (`centrelineLines`). These rows hold that the lean check holds less and answers EXACTLY what the full check answers.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const OJ = require('../core/overlapjob.js');
const G = require('../../src/geom/index.js');
const V = require('../../src/validate/index.js');
const { walkScene, isDrivable } = require('../../src/export/markers.js');
const { asFolds } = require('../../src/geom/bvh.js');

const R = 180, Q = (Math.PI * R) / 2;
/** A coil (two circles on one another) proposed closed: a track whose check finds overlaps of several kinds. */
async function coilClosed() {
  const s = await createCoreShell({ brushFn: null, autosaveMs: 0 });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 8; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  s.proposeClose(); const cp = s.getState().closeProposal; assert.ok(cp && cp.check.overlaps.length > 0, 'control: the coil overlaps itself');
  return cp;
}
const pathOf = (doc, closed) => { const r = OJ.resolveDoc(doc), p0 = G.buildPath(r.segments, { step: 2, closed, start: r.start }); return { segs: r.segments, p: r.lift ? r.lift(p0) : p0 }; };
const SPARE = ['first', 'last', 'ends', 'handles'];

test('a lean mesh is the same scene, cells and folds as the full one, and keeps no piece\'s spare rows', async () => {
  const cp = await coilClosed();
  for (const closed of [true, false]) {
    const { segs, p } = pathOf(cp.doc, closed);
    const full = G.buildMesh(p, segs, {}), lean = G.buildMesh(p, segs, { lean: true });
    const flat = (m) => walkScene(m.scene).meshes.map((x) => [x.name, Array.from(x.positions), Array.from(x.indices)]);
    assert.deepEqual(flat(lean), flat(full), `the same meshes (${closed ? 'closed' : 'open'})`);
    assert.deepEqual(lean.cells, full.cells); assert.deepEqual(lean.folds, full.folds);
    const kept = lean._state.pieces.filter(Boolean).filter((pc) => SPARE.some((k) => k in pc)).length;
    assert.equal(kept, 0, `no piece keeps first/last/ends/handles (${closed ? 'closed' : 'open'})`);
    assert.ok(full._state.pieces.filter(Boolean).every((pc) => SPARE.every((k) => k in pc)), 'control: the full mesh keeps them, for extend, sculpt and reuse');
  }
});

test('the validator with centrelineLines keeps only the centreline\'s lines, and judges the track exactly as without', async () => {
  const cp = await coilClosed(), { segs, p } = pathOf(cp.doc, true);
  const opts = { csp: true, softCollision: true, fullSpeed: true }, full = V.validate(p, segs, opts), lean = V.validate(p, segs, { ...opts, centrelineLines: true });
  for (const k of ['red', 'amber', 'info', 'lap', 'speed', 'jumps', 'notChecked']) assert.deepEqual(lean[k], full[k], k);
  assert.deepEqual(lean.lines, full.lines.filter((l) => l.u === 0), 'the centreline\'s lines, as the full result has them');
  assert.ok(lean.lines.length > 0 && lean.lines.length * 5 < full.lines.length, `far fewer lines: ${lean.lines.length} of ${full.lines.length} (the coil's bowl has ~9 lines across; ELYSIUM's road ~175)`);
});

test('the overlap check (lean) answers exactly what the full mesh and full validator answer', async () => {
  const cp = await coilClosed(), { segs, p } = pathOf(cp.doc, true);
  // the check as it was before 2026-10-15: the full mesh, its self-check, the full validator
  const mesh = G.buildMesh(p, segs, {}); mesh.selfCheck = G.selfCheck(mesh, { closed: true, lengthM: p.lengthM }); mesh.folds.push(...asFolds(mesh.selfCheck));
  const roadMesh = walkScene(mesh.scene).meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length);
  const v = V.validate(p, segs, { csp: true, softCollision: true, folds: mesh.folds, roadMesh, fullSpeed: true });
  const OV = OJ.OVERLAP, want = { overlaps: v.red.filter((x) => OV.has(x.reason)), others: v.red.filter((x) => !OV.has(x.reason)), amber: v.amber.length };
  assert.deepEqual(OJ.runJob({ doc: cp.doc, closed: true }), want, 'the one-piece check');
  assert.deepEqual(OJ.mergeParts(OJ.runJob({ doc: cp.doc, closed: true, part: 'rest' }), OJ.runJob({ doc: cp.doc, closed: true, part: 'rays' })), want, 'its two parts, put together');
});
