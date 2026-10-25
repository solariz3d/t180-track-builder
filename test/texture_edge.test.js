// texture_edge.test.js: node --test test/texture_edge.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D371 (the user's idea, 2026-10-17): a texture built once the track is closed, from its whole width range, so one texture works at every width.
// The EDGE fit (src/texture/edge.js): the edge bands keep their size in METRES, the centre is a whole number of repeats. Rows:
//   1  the layout: N is a whole number, chosen so that the worst stretch of a cell over the width range is the smallest there is
//   2  the built image: the source's two edge bands, and its centre repeated N whole times between them (nothing half cut)
//   3  on the road: at 35 m and at 60 m the edge band is the same number of metres (u runs 0..fb over it on every row)
//   4  the whole row: u runs 0..1 across every row, the seam rows included
//   5  the set: it needs the width range (named refusal without), names its texture for the layout, and keeps the image's size
//   6  'tile' and 'fit' are what they were: the coordinates and the set pinned by digest (taken at 2e0a98d, before D371)
//   7  the narrow road and the closed ring take the plain fit; the settings refuse an edge band that leaves no centre
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const G = require('../src/geom/index.js');
const T = require('../src/texture/index.js');
const EDGE = require('../src/texture/edge.js');
const TX = require('../src/doc/textures.js');
const { flowUvs, closedRing } = require('../src/texture/flow.js');
const { ASPHALT } = require('../app/core/textures.js');

const Rr = 180, Q = (Math.PI * Rr) / 2;
function lap(first) {
  let d = extend(D.createDoc('flow lap'), { length: 300, ...(first ? { first } : { family: 'bowl' }) });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
const ramp = () => { let d = extend(D.createDoc('ramp'), { length: 300, first: { w: 35 } }); d = extend(d, { length: 200, transition: 200, targets: { w: 60 } }); return extend(d, { length: 100 }); };
const idsOf = (doc) => [...new Set(A.toSegments(doc).filter((g) => g.kind === 'road').map((g) => g.id))];
const setOf = (doc, floor, opts) => T.buildTextureSet({ words: idsOf(doc).map((id) => ({ id, word: 'straight', font: 'flat', textures: { floor } })) }, {}, opts);
const rangeOf = (doc) => EDGE.widthRange(A.toSegments(doc));
const kidOf = (mesh, cell) => mesh.scene.root.children[mesh.cells.indexOf(cell)].children[0];
const FLOOR = { make: ASPHALT, fit: 'edge', tileWidth: 35, edgeBand: 1.5, tileLength: 20 };
function onRoad(doc, floor, widths) {
  const segs = A.toSegments(doc), { path: p } = A.toPath(doc), mesh = G.buildMesh(p, segs), set = setOf(doc, floor, { widths: widths || rangeOf(doc) });
  return { mesh, segs, set, flow: flowUvs(mesh, segs, set) };
}
/** Each row of a cell: the metres from its first vertex (the mesh's own u is arc / 10) and the new u. */
function rows(mesh, flow, cell) {
  const node = kidOf(mesh, cell), nu = flow.get(node), ou = node.uvs, v = new Map();
  for (let i = 0; i < nu.length; i += 2) { const key = nu[i + 1].toFixed(4); if (!v.has(key)) v.set(key, []); v.get(key).push({ a: ou[i] * 10, u: nu[i] }); }
  return [...v.values()].map((r) => { const a0 = r[0].a; return r.map((q) => ({ a: q.a - a0, u: q.u })); });
}

test('row 1: the layout takes a whole number of centre repeats, the one that keeps a cell\'s stretch smallest over the width range', () => {
  const s = { tileWidth: 20, edgeBand: 2 };
  for (const [min, max] of [[20, 30], [20, 60], [35, 60], [35, 35], [24, 200]]) {
    const lay = EDGE.layout({ min, max }, s), worst = (n) => Math.max((max - 4) / (n * 16), (n * 16) / (min - 4));
    assert.ok(Number.isInteger(lay.N) && lay.N >= 1, `${min}..${max}: N ${lay.N}`);
    for (let n = 1; n <= 64; n++) assert.ok(worst(lay.N) <= worst(n) + 1e-9, `${min}..${max}: N ${lay.N} is worse than ${n}`);
    assert.ok(Math.abs(lay.stretch.max - (max - 4) / (lay.N * 16)) < 1e-12 && Math.abs(lay.stretch.min - (min - 4) / (lay.N * 16)) < 1e-12, 'the stretch range is the cell at the widest and the narrowest');
  }
  const l2 = EDGE.layout({ min: 20, max: 60 }, s); assert.ok(Math.abs(l2.eb - 2 / 20) < 1e-12, 'the band is edgeBand/tileWidth of the drawing'); assert.ok(Math.abs(l2.fb - 2 / (4 + l2.N * 16)) < 1e-12, 'and edgeBand of the built width, so the cells are not stretched at the drawing own scale');
  assert.equal(EDGE.layout({ min: 20, max: 60 }, s).N, 2, 'control: 20..60 m with a 16 m cell wants 2 repeats');
  assert.equal(EDGE.layout({ min: 20, max: 20 }, s).N, 1, 'a road of one width wants one');
});

test('row 2: the built image is the source\'s edge bands with its centre repeated N whole times between them', () => {
  const lay = EDGE.layout({ min: 20, max: 60 }, { tileWidth: 20, edgeBand: 2 });
  // srcU: the bands run straight, the centre wraps N - 1 times and each cell is one whole centre of the drawing
  assert.ok(Math.abs(EDGE.srcU(lay.fb, lay) - lay.eb) < 1e-12 && Math.abs(EDGE.srcU(1 - lay.fb, lay) - (1 - lay.eb)) < 1e-12, 'a band ends exactly where the centre of the drawing begins');
  const period = (1 - 2 * lay.fb) / lay.N; let wraps = 0, prev = -1;
  for (let i = 0; i <= 20000; i++) { const uo = lay.fb + (i / 20000) * (1 - 2 * lay.fb) * 0.99999999; const s = EDGE.srcU(uo, lay); if (s < prev - 0.5) wraps++; prev = s; if (uo + period < 1 - lay.fb) assert.ok(Math.abs(EDGE.srcU(uo + period, lay) - s) < 1e-9, `one cell on, the same drawing (${uo})`); }
  assert.equal(wraps, lay.N - 1, 'a centre of N cells wraps N-1 times');
  // the pixels: a synthetic image whose red channel is the column
  const W = 1000, H = 2, rgba = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; rgba[o] = x & 255; rgba[o + 1] = x >> 8; rgba[o + 3] = 255; }
  const img = EDGE.compose({ width: W, height: H, rgba }, lay), col = (x) => img.rgba[x * 4] + 256 * img.rgba[x * 4 + 1], bandPx = Math.round(lay.fb * W);
  assert.equal(img.width, W); assert.equal(img.height, H);
  assert.ok(Math.abs(col(0) - W / 2) <= 2 && Math.abs(col(W - 1) - W / 2) <= 2, 'the road\'s two edges are the drawing\'s middle (the fit rule puts a glow drawn down the middle at the edges)');
  assert.ok(Math.abs(col(bandPx - 1) - (lay.eb + 0.5) * W) < 0.02 * W && Math.abs(col(bandPx + 1) - (lay.eb + 0.5) * W) < 0.02 * W, 'the band hands over to the centre where the drawing\'s band ends');
  let drops = 0; for (let x = bandPx + 4; x < W - bandPx - 4; x++) if (col(x) < col(x - 1) - 100) drops++;
  assert.equal(drops, lay.N, 'each of the N cells of the centre holds the drawing\'s own end once (its centre, turned half a turn, is the cell\'s middle)');
});

test('row 3: at 35 m and at 60 m the edge band is the same number of metres, on every row of a road that goes from one to the other', () => {
  const doc = ramp(), { mesh, flow, set } = onRoad(doc, FLOOR), lay = set.bySegment(idsOf(doc)[0]).floor.edge, seen = new Set();
  assert.ok(lay && lay.b === 1.5, 'control: the set carries the layout');
  for (const cell of mesh.cells.filter((c) => !c.seam)) for (const r of rows(mesh, flow, cell)) {
    const w = r[r.length - 1].a; seen.add(Math.round(w));
    for (const q of r) {
      if (q.a <= lay.b + 1e-9) assert.ok(Math.abs(q.u - (q.a / lay.b) * lay.fb) < 1e-5, `a ${q.a.toFixed(3)} m from the left edge of a ${w.toFixed(1)} m row: u ${q.u}`);
      if (w - q.a <= lay.b + 1e-9) assert.ok(Math.abs(q.u - (1 - ((w - q.a) / lay.b) * lay.fb)) < 1e-5, `${(w - q.a).toFixed(3)} m from the right edge of a ${w.toFixed(1)} m row: u ${q.u}`);
    }
  }
  assert.ok(seen.has(35) && seen.has(60), `control: the rows are 35 m and 60 m wide and in between (${[...seen].join(',')})`);
});

test('row 4: u runs 0 to 1 across every row, the seam rows too, and rises along it', () => {
  const doc = ramp(), { mesh, flow } = onRoad(doc, FLOOR);
  for (const cell of mesh.cells) { const u = flow.get(kidOf(mesh, cell)); if (!u) continue;
    if (cell.seam) { for (let i = 0; i < u.length; i += 2) assert.ok(u[i] >= -1e-6 && u[i] <= 1 + 1e-6, `${cell.name}: u ${u[i]}`); continue; }
    for (const r of rows(mesh, flow, cell)) { assert.ok(Math.abs(r[0].u) < 1e-6 && Math.abs(r[r.length - 1].u - 1) < 1e-6, `${cell.name}: ${r[0].u}..${r[r.length - 1].u}`); for (let k = 1; k < r.length; k++) assert.ok(r[k].u >= r[k - 1].u, `${cell.name}: u falls`); }
  }
});

test('row 5: the set needs the width range, names its texture for the layout, and keeps the image\'s size', () => {
  const doc = ramp();
  assert.throws(() => setOf(doc, FLOOR), (e) => e.name === 'TextureError' && e.code === 'NO_WIDTHS', 'no widths, a named refusal');
  const a = setOf(doc, FLOOR, { widths: { min: 35, max: 150 } }), b = setOf(doc, FLOOR, { widths: { min: 35, max: 200 } }), plain = setOf(doc, { ...FLOOR, fit: 'fit' });   // 35..150 m: two centre cells; 35..60 m would be one, which is the drawing itself
  assert.equal(a.textures.length, 1); assert.equal(a.textures[0].width, 1024);
  assert.ok(!Buffer.from(a.textures[0].dds).equals(Buffer.from(plain.textures[0].dds)), 'the built image is the recomposed drawing, not the drawing');
  assert.notEqual(a.textures[0].name, plain.textures[0].name, 'the composed texture is not the drawing');
  assert.notEqual(a.textures[0].name, b.textures[0].name, 'another width range is another layout, another texture');
  assert.equal(setOf(doc, FLOOR, { widths: { min: 35, max: 150 } }).textures[0].name, a.textures[0].name, 'the same range is the same texture');
});

const sha = (doc, fit) => {
  const floor = { make: ASPHALT, fit, tileWidth: 12, tileLength: 20 }, segs = A.toSegments(doc), { path: p } = A.toPath(doc), mesh = G.buildMesh(p, segs), set = setOf(doc, floor);
  const hc = crypto.createHash('sha256'), hs = crypto.createHash('sha256');
  for (const [, u] of flowUvs(mesh, segs, set)) hc.update(Buffer.from(u.buffer, u.byteOffset, u.byteLength));
  for (const t of set.textures) { hs.update(t.name); hs.update(Buffer.from(t.dds)); } hs.update(JSON.stringify(set.materials.map((m) => m.material)));
  return { coords: hc.digest('hex'), set: hs.digest('hex') };
};
test('row 6: \'tile\' and \'fit\' are what they were: the coordinates of the 31 m lap and the texture set pinned by digest (taken at 2e0a98d)', () => {
  const doc = lap({ w: 31 }), t = sha(doc, 'tile'), f = sha(doc, 'fit');
  assert.equal(t.coords, '75dbd0e2dace1363375e543a3d432065f3e025ae57e304170c0e8f4d4c14774a', 'tile coordinates');
  assert.equal(f.coords, 'd94fee10604d1d195348877a5477df76516b544c7c07e7d9fa764fdbce0ca7ac', 'fit coordinates');
  assert.equal(t.set, '4ec08640ca7b828cfb5a93b61b5568f2a372d2c5110db250c256982d5629d975', 'tile set');
  assert.equal(f.set, '4ec08640ca7b828cfb5a93b61b5568f2a372d2c5110db250c256982d5629d975', 'fit set');
});

test('row 7: a road narrower than two bands and a closed ring take the plain fit; the settings refuse a band with no centre', () => {
  assert.ok(Math.abs(EDGE.rowMap(1, 2.5, { b: 1.5, fb: 0.1 }) - 0.4) < 1e-12, 'a 2.5 m row has no centre: u = arc / w');
  const tube = lap({ w: 31, t: 360 }), segs = A.toSegments(tube), ring = segs.findIndex((g) => closedRing(g)); assert.ok(ring >= 0, 'control: the tube lap has a ring');
  const { mesh, flow } = onRoad(tube, FLOOR, { min: 31, max: 31 }), cell = mesh.cells.find((c) => !c.seam && c.piece === ring), r = rows(mesh, flow, cell)[0];
  for (const q of r) assert.ok(Math.abs(q.u - (q.a / r[r.length - 1].a - 0.5)) < 1e-4, `a ring is one repeat round (the fit rule, -0.5..0.5), evenly (a ${q.a} u ${q.u})`);
  assert.throws(() => EDGE.layout({ min: 35, max: 60 }, { tileWidth: 10, edgeBand: 5 }), (e) => e.code === 'BAD_EDGE');
  assert.ok(TX.problem({ floor: { fit: 'edge', dir: 'across' } }, 'straight'), 'the edge fit runs across the road');
  assert.equal(TX.problem({ floor: { fit: 'edge', edgeBand: 1.5 } }, 'straight'), null);
  assert.ok(TX.problem({ floor: { edgeBand: 0 } }, 'straight'), 'a band of 0 m is refused');
});

const { createCoreTextures } = require('../app/core/textures.js');
test('row 8: the road-surface controller lays the edge fit out only once the track is closed, and picks a changed width up at export', () => {
  let segs = A.toSegments(lap({ w: 31 })), shut = false;
  const off = createCoreTextures({ segments: () => segs, closed: () => shut }), on = createCoreTextures({ segments: () => segs, closed: () => shut, edge: true });
  const id = idsOf(lap({ w: 31 }))[0], edgeOf = (c) => c.current().bySegment(id).floor.edge;
  assert.equal(edgeOf(on), undefined, 'an open track keeps the plain look');
  assert.equal(on.current().textures[0].name, off.current().textures[0].name, 'and it is the same texture as with the fit off');
  shut = true;
  assert.equal(edgeOf(off), undefined, 'the fit off: a closed track is as it was');
  const a = edgeOf(on); assert.ok(a && a.N >= 1, 'closed: the layout is there');
  const nameA = on.current().textures[0].name;
  segs = A.toSegments(lap({ w: 45 }));
  assert.ok(on.current().textures[0].name !== nameA, 'a changed width range is picked up when the export asks for the set');
  on.setEdge(false); assert.equal(edgeOf(on), undefined, 'switched off, it is plain again');
});

test('row 9: an image floor takes the edge fit too: its decoded picture is recomposed, and it is named for the layout', () => {
  const { encodePng } = require('../src/export/trackfiles.js');
  const W = 64, H = 4, px = Buffer.alloc(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; px[o] = x * 4; px[o + 1] = 255 - x * 4; px[o + 2] = 90; px[o + 3] = 255; }
  const assets = { pic: { bytes: new Uint8Array(encodePng(W, H, px)) } }, doc = ramp();
  const mk = (floor, widths) => T.buildTextureSet({ words: idsOf(doc).map((id) => ({ id, word: 'straight', font: 'flat', textures: { floor } })) }, assets, widths ? { widths } : undefined);
  const edge = mk({ texture: 'pic', fit: 'edge', tileWidth: 35, edgeBand: 1.5, tileLength: 20 }, { min: 35, max: 150 }), plain = mk({ texture: 'pic', fit: 'tile', tileWidth: 35, tileLength: 20 });
  assert.match(edge.textures[0].name, /^pic-edge-/); assert.equal(plain.textures[0].name, 'pic');
  assert.ok(!Buffer.from(edge.textures[0].dds).equals(Buffer.from(plain.textures[0].dds)), 'the picture is recomposed');
  assert.ok(edge.bySegment(idsOf(doc)[0]).floor.edge, 'and the set carries the layout');
});
