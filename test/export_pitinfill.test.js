// export_pitinfill.test.js: node --test test/export_pitinfill.test.js (under the heavy-run lock). D279, the keeper, 2026-10-09 16:27: "the pit lane arc that
// is made, i wonder if the inside could just be filled in so there is no gap between the track and pit". A pit lane leaves the road's edge on an arc
// (diverge), runs beside it offsetM away (body) and comes back (merge); between the road's edge and the lane's inner edge was nothing. Now ONE infill
// surface (1ROAD_PIT_fill_0) fills that whole span, entry and exit arcs included, joined to the road's edge and to the lane's inner edge with no seam.
// Rows, on an equation-core lap given a pit lane the way the export takes one (meta.pitLane, the route TRACK 2's lane takes):
//   1  the infill is there, drivable (a 1ROAD_ name), and wears the lane's floor (the road's: asphalt here), in the scene and in the kn5
//   2  NO GAP: the car's own downforce ray (src/validate/raygap.js, MACH6) over the road, the lane and the infill finds no gap anywhere in the lane's span
//      (without the infill it finds them at the entry and exit arcs, where the lane runs within the ray's 1 m of the road's edge)
//   3  untextured (solid): the infill wears t180b_road, as the lane and the road do
//   4  the lane's own self-check and its check against the road stay clean, and a full (non-test) export of the closed lap passes
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const { walkScene, isDrivable } = require('../src/export/markers.js');
const { rayGaps } = require('../src/validate/raygap.js');
const { MACH6 } = require('../src/validate/limits.js');
const { startLayout } = require('../app/core/coreshell.js');
const { createCoreTextures } = require('../app/core/textures.js');
const { readKn5 } = require('../tools/kn5.cjs');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const Rr = 180, Q = (Math.PI * Rr) / 2;
function lap() {
  let d = extend(D.createDoc('pit infill lap'), { length: 400, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
const LANE = (first) => ({ side: 'L', leave: { word: first, along: 40 }, rejoin: { word: first, along: 360 }, offsetM: 12, width: 8, divergeM: 80, mergeM: 80, speedKmh: 80 });
function exported(kind = 'asphalt') {
  const doc = lap(), segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  const set = kind === 'solid' ? null : createCoreTextures({ segments: () => segs, kind }).current();
  const b = FW.buildFromSegments(segs, { name: 'pit infill', via: 'test', liftPath: lift, start, pitLane: LANE(doc.pieces[0].id) }, { markers: startLayout(segs, lift, start), textures: set });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-pitfill-')); made.push(dir);
  const f = path.join(dir, 'x.kn5'); fs.writeFileSync(f, b.kn5);
  // the scene's own mesh nodes carry the material index (walkScene's world-space records do not: they are for geometry, as row 2 uses them)
  const nodes = []; (function walk(n) { if (n.type === 'mesh') nodes.push(n); for (const c of n.children || []) walk(c); })(b.scene.root);
  const meshes = walkScene(b.scene).meshes, mat = (m) => b.scene.materials[m.material].name;
  return { b, kn5: readKn5(f), meshes, mat, fill: nodes.filter((m) => /^1ROAD_PIT_fill/.test(m.name)), lane: nodes.filter((m) => /^1ROAD_PIT_(in|body|out)_/.test(m.name)) };
}
const one = (a) => [...new Set(a)];

test('row 1: the infill is there, drivable, and wears the lane\'s floor (the road\'s), in the scene and in the kn5', () => {
  const e = exported('asphalt');
  assert.ok(e.lane.length >= 3, 'the lane');
  assert.ok(e.fill.length >= 1, 'an infill mesh');
  for (const m of e.fill) assert.ok(isDrivable(m.name), `${m.name} is drivable`);
  assert.deepEqual(one(e.fill.map(e.mat)), one(e.lane.map(e.mat)));
  assert.match(one(e.fill.map(e.mat))[0], /^t180b_floor_/);
  const k = e.kn5.meshes.filter((m) => /^1ROAD_PIT_fill/.test(m.name));
  assert.equal(k.length, e.fill.length, 'in the kn5');
});

test('row 2: NO GAP: the car\'s downforce ray over the road, the lane and the infill finds no gap in the lane\'s span', () => {
  const e = exported('asphalt'), lane = e.b.pitLane, s0 = lane.joins.leave.s, s1 = lane.joins.rejoin.s;
  const drivable = e.meshes.filter((m) => isDrivable(m.name) && m.indices && m.indices.length);
  const gaps = rayGaps(drivable, e.b.path.samples, MACH6.downforceRay).filter((g) => g.s != null && g.s >= s0 - 2 && g.s <= s1 + 2);
  assert.deepEqual(gaps.map((g) => `s ${g.s.toFixed(1)} u ${g.u == null ? '?' : g.u.toFixed(1)} width ${g.widthM}`), []);
});

test('row 3: untextured (solid): the infill wears t180b_road, as the lane and the road do', () => {
  const e = exported('solid');
  assert.ok(e.fill.length >= 1);
  assert.deepEqual(one(e.fill.map(e.mat)), ['t180b_road']);
  assert.deepEqual(one(e.lane.map(e.mat)), ['t180b_road']);
});

test('row 4: the lane\'s self-check and its check against the road stay clean, and the full export of the closed lap passes', () => {
  const e = exported('asphalt');
  assert.ok(!e.b.test, 'a full export, not the test one');
  assert.ok(!e.b.warnings.some((w) => /NOT checked/.test(w)), 'self-check on');
  assert.ok(e.b.readback && e.b.readback.meshes > 0);
});
