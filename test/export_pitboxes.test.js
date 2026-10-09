// export_pitboxes.test.js: node --test test/export_pitboxes.test.js (under the heavy-run lock). D279 follow-up: the PAINTED PIT BOXES wear the
// track's road surface (the keeper, 2026-10-09, asked which pits: "The painted pit boxes"). An equation-core track has no pit lane; its pits
// sit on the main road, marked only by the pit-box outlines, which were near-white paint (src/markers/paint.js, t180b_paint). Now each
// PAINT_PIT_n wears the floor material of the road under it, with the road's own texture coordinates at each vertex, so it blends in.
// Rows, on a core lap exported the way the app exports it (texture_flow.test.js's route), under the three road settings:
//   1  asphalt: every PAINT_PIT_n wears the road's floor material and the same diffuse texture, in the scene and in the kn5
//   2  the user's picture: the same
//   3  solid colour: every PAINT_PIT_n wears the road's own t180b_road, the same flat colour, so the boxes no longer show (named, as asked)
//   4  the start line and the grid paint are unchanged (material, positions, coordinates), the AC_PIT_n spawn markers are the same, and the
//      export's own kn5 read-back passes
//   5  a box's texture coordinates are the road's at that point: v = (s + offset) / tileLength along the path, u = u / tileWidth across
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const T = require('../src/texture/index.js');
const { startLayout } = require('../app/core/coreshell.js');
const { createCoreTextures } = require('../app/core/textures.js');
const { readKn5 } = require('../tools/kn5.cjs');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const Rr = 180, Q = (Math.PI * Rr) / 2;
function lap() {
  let d = extend(D.createDoc('pit lap'), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
const image = (w, h, f) => { const rgba = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(f(x, y), (y * w + x) * 4); return { width: w, height: h, rgba }; };
const PICTURE = T.png.encodePng(image(32, 32, (x, y) => ((x ^ y) & 8 ? [90, 90, 95, 255] : [60, 60, 64, 255])), zlib.deflateSync);
function setFor(doc, kind) {
  const ctl = createCoreTextures({ segments: () => A.toSegments(doc), kind: kind === 'image' ? 'asphalt' : kind });
  if (kind === 'image') { ctl.addImage('pic', PICTURE); ctl.setKind('image'); }
  return ctl.current();
}
/** The app's export route (coreshell.js buildExport): the start layout, then buildFromSegments. */
function exported(kind) {
  const doc = lap(), segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  const set = setFor(doc, kind);
  const b = FW.buildFromSegments(segs, { name: 'pits', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start), textures: set });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-pitbox-')); made.push(dir);
  const f = path.join(dir, 'x.kn5'); fs.writeFileSync(f, b.kn5);
  const nodes = []; (function walk(n) { if (n.type === 'mesh') nodes.push(n); for (const c of n.children || []) walk(c); })(b.scene.root);
  const mat = (n) => b.scene.materials[n.material], diffuse = (m) => { const x = (m.samplers || []).find((q) => q.name === 'txDiffuse'); return x ? x.texture : null; };
  return { b, set, kn5: readKn5(f), nodes, mat, diffuse,
    pits: nodes.filter((n) => /^PAINT_PIT_/.test(n.name)), other: nodes.filter((n) => /^PAINT_/.test(n.name) && !/^PAINT_PIT_/.test(n.name)),
    road: nodes.filter((n) => /^1ROAD_/.test(n.name)) };
}
const one = (a) => [...new Set(a)];

for (const [row, kind] of [[1, 'asphalt'], [2, 'image']]) {
  test(`row ${row}: ${kind}: every pit box wears the road's floor material and the same diffuse texture, in the scene and in the kn5`, () => {
    const e = exported(kind);
    assert.ok(e.set, 'a texture set');
    assert.ok(e.pits.length > 0, 'the start layout placed pit boxes');
    const roadMats = one(e.road.map((n) => e.mat(n).name));
    assert.equal(roadMats.length, 1, `one road floor: ${roadMats}`);
    assert.match(roadMats[0], /^t180b_floor_/);
    assert.deepEqual(one(e.pits.map((n) => e.mat(n).name)), roadMats);
    assert.deepEqual(one(e.pits.map((n) => e.diffuse(e.mat(n)))), one(e.road.map((n) => e.diffuse(e.mat(n)))));
    const k = e.kn5.meshes.filter((m) => /^PAINT_PIT_/.test(m.name));
    assert.equal(k.length, e.pits.length);
    assert.deepEqual(one(k.map((m) => m.material)), roadMats);
  });
}

test('row 3: solid colour: the pit boxes wear the road\'s own t180b_road, so they no longer show (what was asked, and named here)', () => {
  const e = exported('solid');
  assert.equal(e.set, null);
  assert.ok(e.pits.length > 0);
  assert.deepEqual(one(e.pits.map((n) => e.mat(n).name)), ['t180b_road']);
  assert.deepEqual(one(e.road.map((n) => e.mat(n).name)), ['t180b_road']);
});

test('row 4: the start line and grid paint, the AC_PIT_n spawn markers and the read-back are unchanged', () => {
  const s = exported('solid'), a = exported('asphalt');
  assert.ok(a.other.length > 1, 'the start line and the grid boxes');
  for (const e of [s, a]) assert.deepEqual(one(e.other.map((n) => e.mat(n).name)), ['t180b_paint']);
  a.other.forEach((n, i) => {
    assert.equal(n.name, s.other[i].name);
    assert.deepEqual(Array.from(n.positions), Array.from(s.other[i].positions), n.name);
    assert.deepEqual(Array.from(n.uvs), Array.from(s.other[i].uvs), n.name);
  });
  a.pits.forEach((n, i) => assert.deepEqual(Array.from(n.positions), Array.from(s.pits[i].positions), `${n.name}: the box itself does not move`));
  const spawns = (e) => e.kn5.dummies.filter((d) => /^AC_PIT_\d+$/.test(d.name)).map((d) => d.name);
  assert.deepEqual(spawns(a), spawns(s));
  assert.ok(spawns(a).length === a.pits.length);
  for (const e of [s, a]) assert.ok(e.b.readback && e.b.readback.meshes > 0, 'the export read its own kn5 back');
});

test('row 5: a box\'s texture coordinates are the road\'s there: v = (s + offset) / tileLength, within the box\'s own stretch of road', () => {
  const e = exported('asphalt');
  const f = e.set.bySegment(e.b.segments.find((g) => g.kind === 'road').id).floor.settings;
  for (const n of e.pits) {
    const m = e.b.markers.placed.find((x) => x.name === n.name.replace('PAINT_PIT_', 'AC_PIT_'));
    assert.ok(m, `${n.name}'s spawn marker`);
    for (let i = 1; i < n.uvs.length; i += 2) {
      const s = n.uvs[i] * f.tileLength - f.offset;
      assert.ok(Math.abs(s - m.s) <= 2.5 + 1e-3, `${n.name}: v gives s ${s.toFixed(2)}, the box is at ${m.s.toFixed(2)}`);
    }
  }
});
