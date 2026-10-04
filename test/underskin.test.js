// underskin.test.js: node --test test/underskin.test.js   (under the heavy-run lock, --max-old-space-size=4096; about two minutes)
// D230 (as amended at the keeper's word): the underside of an equation-core track is an object that casts shadows, and the inside of a closed tube is dark.
// The keeper: "during day light leaks into the tube it should be inclosed and pitch black", then "the bottom side of the track is an object that casts shadows". Rows:
//   1  every core road cell, a closed tube's included, has an UNDERSIDE SKIN: the road's own normal, 0.5 m on the side away from the driver, normals out, castShadows, its own dark material
//   2  on an OPEN road the skin is BELOW it (and the road keeps its light material)
//   3  the DARK interior (ksAmbient 0.02) only on closed-ring cells, the textured ones too, and the set's shared material is untouched; the slot zone steps over one cell
//   4  the ROAD nodes are the ones mesh.js made (the same objects), only skin nodes and the materials are added; a word document comes back as the very same scene
//   5  the skin is not a physics surface: no leading digit, no 1ROAD, no "seam", no surfaces.ini MESHES pattern matches it, and the 1ROAD meshes are as many as before
//   6  the skin is light: about SKIN_COLUMNS across, a fraction of the road's vertices
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const G = require('../src/geom/index.js');
const FW = require('../src/export/fromwords.js');
const TF = require('../src/export/trackfiles.js');
const S = require('../src/export/underskin.js');
const Dw = require('../src/doc/index.js');
const { closedRing } = require('../src/texture/flow.js');
const { startLayout } = require('../app/core/coreshell.js');
const { createCoreTextures } = require('../app/core/textures.js');

const Rr = 180, Q = (Math.PI * Rr) / 2;
function lap(opts, cup) {
  let d = extend(D.createDoc('skin lap'), { length: 300, ...opts });
  const edge = cup ? D.legacyEdgeDeg(opts.family, D.channelAt(d.pieces[0], 'w', 300).v, D.channelAt(d.pieces[0], 'r', 300).v) : 0;
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, ...(cup ? { c: i === 3 ? edge : cup } : {}) } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0, ...(cup ? { c: edge } : {}) } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
const tubeOval = (w) => lap({ first: { w, t: 360 } });
const plainOval = (w) => lap({ family: 'bowl', first: { w } });
function exportDoc(doc, textures) {
  const segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  return FW.buildFromSegments(segs, { name: 'skin', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start), ...(textures !== undefined ? { textures } : {}) });
}
/** A track that CLOSES along the road: a plain start, a closing tube (the slot zone), then closed: open and closed cells in one scene. */
const closingTrack = (w = 31) => extend(extend(extend(D.createDoc('x'), { length: 100, first: { w } }), { length: 100, transition: 100, targets: { t: 360 } }), { length: 120 });
const meshOf = (doc) => { const segs = A.toSegments(doc), { path } = A.toPath(doc), mesh = G.buildMesh(path, segs); return { segs, mesh }; };
const kids = (scene) => scene.root.children;
const prop = (m, n) => m.props.find((p) => p.name === n).value[0];
const isSkin = (c) => /^(SKIN|JOIN)_/.test(c.name);
/** The road dummies of an export's scene (the first cells.length children) and its skin dummies, in the same cell order. */
const parts = (scene, n) => ({ road: kids(scene).slice(0, n), skins: kids(scene).filter(isSkin) });
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const sub = (a, b) => a.map((x, i) => x - b[i]);

/** The checks a skin owes its road cell: every kept vertex is the road's moved `off` against its normal, normals reversed, castShadows, every triangle faces its own normal. */
function checkSkin(sk, rd, K, label) {
  const P = rd.positions, N = rd.normals, nv = sk.positions.length / 3;
  let worstOff = 0, worstN = 0;
  if (K === null) { for (let i = 0; i < P.length; i++) { worstOff = Math.max(worstOff, Math.abs(sk.positions[i] - (P[i] - S.UNDERSKIN_OFFSET_M * N[i]))); worstN = Math.max(worstN, Math.abs(sk.normals[i] + N[i])); } }
  else {
    const R = P.length / 3 / K, C = nv / R, step = Math.max(1, Math.ceil((K - 1) / (S.SKIN_COLUMNS - 1)));
    assert.ok(C <= S.SKIN_COLUMNS + 1 && C >= 2, `${label}: ${C} columns across`);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const k = c === C - 1 ? K - 1 : Math.min(c * step, K - 1), s = (r * K + k) * 3, d = (r * C + c) * 3;
      for (let a = 0; a < 3; a++) { worstOff = Math.max(worstOff, Math.abs(sk.positions[d + a] - (P[s + a] - S.UNDERSKIN_OFFSET_M * N[s + a]))); worstN = Math.max(worstN, Math.abs(sk.normals[d + a] + N[s + a])); }
    }
  }
  // a sliver (a seam zipper between two coincident rows: weldSeams' own doc puts its area near 1e-4 m²) has no side that means anything, so only triangles over 1e-3 count
  const facing = (m, limit) => { let ok = 0, n = 0; for (let t = 0; t < Math.min(m.indices.length, limit); t += 3) { const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]], p = (i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]], cr = cross(sub(p(b), p(a)), sub(p(c), p(a))); if (Math.hypot(...cr) < 1e-3) continue; n++; if (cr[0] * m.normals[a * 3] + cr[1] * m.normals[a * 3 + 1] + cr[2] * m.normals[a * 3 + 2] > 0) ok++; } return [ok, n]; };
  const [so, sn] = facing(sk, 1e9), [ro, rn] = facing(rd, 60);
  if (K !== null) assert.ok(sn > 0 && rn > 0, `${label}: control: the triangles have area, so the facing test can fail`);
  assert.equal(sk.castShadows, true, label); assert.ok(worstOff < 1e-5, `${label}: a skin vertex is the road's moved ${S.UNDERSKIN_OFFSET_M} m against its normal (worst ${worstOff})`); assert.ok(worstN < 1e-6, `${label}: normals are the road's reversed (worst ${worstN})`);
  assert.equal(so, sn, `${label}: every skin triangle faces its own normal (${so} of ${sn})`); assert.equal(ro, rn, `${label}: control: the road's triangles pass the same test`);
}

test('row 1: a closed tube export has an underside skin on every cell: the road\'s own normal, 0.5 m away from the driver (outward), normals out, castShadows, its own dark material', () => {
  const doc = tubeOval(40), { segs, mesh } = meshOf(doc), out = exportDoc(doc), { road, skins } = parts(out.scene, mesh.cells.length);
  assert.equal(S.UNDERSKIN_OFFSET_M, 0.5); assert.equal(S.skinCells(mesh, segs).size, mesh.cells.length, 'every cell of a core track is skinned'); assert.equal(skins.length, mesh.cells.length);
  const skinMat = out.scene.materials.findIndex((m) => m.name === 't180b_underskin'); assert.ok(skinMat >= 0); let joins = 0;
  skins.forEach((sd, k) => {
    const cell = mesh.cells[k], sk = sd.children[0], rd = road[k].children[0];
    assert.equal(sk.material, skinMat, 'its own material'); assert.deepEqual(sd.matrix, road[k].matrix, 'in the road cell\'s own frame');
    checkSkin(sk, rd, cell.seam ? null : mesh._state.pieces[cell.piece].K, `cell ${k}`); if (cell.seam) { joins++; assert.match(sk.name, /^UNDERSKIN_join_/); }
  });
  assert.ok(joins >= 1, `control: ${joins} seam row(s) were skinned too`);
});

test('row 2: on an OPEN road the skin is BELOW it: the road keeps its light material, the skin is under every cell, and on the flat start straight it is 0.5 m down', () => {
  const doc = plainOval(31), { segs, mesh } = meshOf(doc), out = exportDoc(doc), { road, skins } = parts(out.scene, mesh.cells.length);
  assert.equal(skins.length, mesh.cells.length); assert.equal(S.ringCells(mesh, segs).size, 0, 'no ring on an open road');
  for (const [k, sd] of skins.entries()) { const cell = mesh.cells[k]; checkSkin(sd.children[0], road[k].children[0], cell.seam ? null : mesh._state.pieces[cell.piece].K, `cell ${k}`); }
  const mats = out.scene.materials; for (const rd of road.filter((c) => c.name.startsWith('CELL_'))) { const m = mats[rd.children[0].material]; assert.doesNotMatch(m.name, /_dark$/); assert.equal(prop(m, 'ksAmbient'), 0.45); }
  const rd = road[3].children[0], sk = skins[3].children[0], n = [rd.normals[0], rd.normals[1], rd.normals[2]], dv = [sk.positions[0] - rd.positions[0], sk.positions[1] - rd.positions[1], sk.positions[2] - rd.positions[2]];
  assert.ok(Math.abs(n[1]) > 0.9, `control: the start straight's surface faces up (n = ${n.map((x) => x.toFixed(2))})`); assert.ok(dv[1] < -0.45 && Math.abs(Math.hypot(...dv) - 0.5) < 1e-5 && dv.every((x, i) => Math.abs(x + 0.5 * n[i]) < 1e-5), `the skin is 0.5 m BELOW the road, along its own normal (the road's edge is tilted a little): ${dv.map((x) => x.toFixed(3))}`);
});

test('row 3: the DARK interior (ksAmbient 0.02) is on closed-ring cells only, the textured ones too; the set\'s shared material is untouched; the skin runs under the slot zone, the dark does not', () => {
  const doc = tubeOval(40), segs = A.toSegments(doc), set = createCoreTextures({ segments: () => segs }).current();
  for (const textures of [undefined, set]) {
    const out = exportDoc(doc, textures), mats = out.scene.materials, n = out.scene.root.children.filter((c) => !isSkin(c)).length;
    for (const rd of kids(out.scene).slice(0, n).filter((c) => c.name.startsWith('CELL_'))) { const m = mats[rd.children[0].material]; assert.match(m.name, /_dark$/, `${rd.name}: ${m.name}`); assert.equal(prop(m, 'ksAmbient'), S.TUBE_RING_AMBIENT); assert.equal(prop(m, 'ksDiffuse'), 0.55); }
    const base = mats.find((m) => m.name === mats[kids(out.scene)[0].children[0].material].name.replace(/_dark$/, '')); assert.ok(base && prop(base, 'ksAmbient') === 0.45, 'the original material is as it was');
    if (textures) assert.equal(mats[kids(out.scene)[0].children[0].material].samplers[0].texture, set.textures[0].file, 'the dark copy samples the same asphalt');
  }
  assert.equal(S.TUBE_RING_AMBIENT, 0.02); assert.equal(prop(set.materials.find((m) => m.slot === 'floor').material, 'ksAmbient'), 0.45, 'the set\'s own material was not edited');
  const c = closingTrack(), { segs: s2, mesh } = meshOf(c), rings = S.ringCells(mesh, s2), scene = S.withUnderskin(mesh.scene, mesh, s2), n = mesh.cells.length;
  const open = mesh.cells.map((x, k) => k).filter((k) => !rings.has(k)), closed = [...rings];
  assert.ok(open.length > 20 && closed.length > 20, `control: ${open.length} open cells and ${closed.length} closed ones in one scene`);
  assert.equal(parts(scene, n).skins.length, n, 'the skin is under the open cells and the slot zone as well');
  for (const k of closed) { assert.ok(closedRing(s2[mesh.cells[k].piece])); assert.match(scene.materials[kids(scene)[k].children[0].material].name, /_dark$/); }
  for (const k of open) assert.doesNotMatch(scene.materials[kids(scene)[k].children[0].material].name, /_dark$/, `open cell ${k} keeps its light material`);
  assert.ok(Math.min(...open) < Math.min(...closed) && !rings.has(Math.min(...closed) - 1), 'the cell just before the first closed one is open: the interior steps from light to dark over one 2 m cell');
});

test('row 4: the ROAD nodes are the ones mesh.js made (the same objects): only skin nodes and materials are added; a word document comes back as the very same scene', () => {
  const docs = [plainOval(31), lap({ family: 'bowl' }, 150), lap({ family: 'flat' }, 90)];
  let d = extend(D.createDoc('open'), { length: 120, first: { w: 31 } }); d = extend(d, { length: 100, transition: 100, targets: { t: 200 } }); docs.push(d);
  for (const doc of docs) {
    const { segs, mesh } = meshOf(doc), scene = S.withUnderskin(mesh.scene, mesh, segs), n = mesh.cells.length, orig = kids(mesh.scene);
    assert.equal(S.ringCells(mesh, segs).size, 0); assert.equal(kids(scene).length, 2 * n, 'the road nodes and one skin each');
    for (let k = 0; k < n; k++) assert.equal(kids(scene)[k], orig[k], `road node ${k} is the very same object`);
    assert.deepEqual(scene.materials.slice(0, mesh.scene.materials.length), mesh.scene.materials, 'the road\'s materials are as they were'); assert.equal(scene.materials.length, mesh.scene.materials.length + 1, 'one material added: the skin\'s');
  }
  const tube = meshOf(tubeOval(40)), ts = S.withUnderskin(tube.mesh.scene, tube.mesh, tube.segs);
  for (let k = 0; k < tube.mesh.cells.length; k++) { const a = kids(ts)[k].children[0], b = kids(tube.mesh.scene)[k].children[0]; assert.ok(a.positions === b.positions && a.normals === b.normals && a.uvs === b.uvs && a.indices === b.indices && a.name === b.name, `the closed tube's road mesh ${k}: the same arrays and name (only its material is the dark copy)`); }
  let w = Dw.createDoc('w'); for (const x of ['straight', 'straight']) w = Dw.appendWord(w, x, { speed: 200 / 3.6 });
  const wsegs = Dw.resolve(w).segments, wm = G.buildMesh(G.buildPath(wsegs), wsegs);
  assert.equal(S.withUnderskin(wm.scene, wm, wsegs), wm.scene, 'a word document is not a core track: the same scene object');
});

test('row 5: the skin is not a physics surface: no leading digit, no 1ROAD, no "seam", no surfaces.ini MESHES pattern matches it, and the 1ROAD meshes are as many as before', () => {
  for (const doc of [tubeOval(40), plainOval(31)]) {
    const { mesh } = meshOf(doc), out = exportDoc(doc), { skins } = parts(out.scene, mesh.cells.length), names = skins.flatMap((d) => [d.name, d.children[0].name]); assert.ok(names.length > 1400);
    for (const n of names) { assert.doesNotMatch(n, /^\d/, n); assert.doesNotMatch(n, /1ROAD/i, n); assert.doesNotMatch(n, /seam/i, n); assert.doesNotMatch(n, /^AC_/, n); }
    const ini = TF.surfacesIni({ softCollision: true, extendedPhysics: true }), globs = [...ini.matchAll(/^\s*MESHES\s*=\s*(.+)$/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    assert.ok(globs.length >= 1 && globs.some((g) => g.startsWith('1ROAD')), `control: surfaces.ini names ${globs.join(', ')}`);
    for (const g of globs) { const re = new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '.').replace(/\*/g, '.*')}`); for (const n of names) assert.ok(!re.test(n), `${n} must not match MESHES=${g}`); }
    const roads = (s) => kids(s).flatMap((c) => (c.children || []).filter((m) => m.type === 'mesh' && /^1ROAD/.test(m.name))).length;
    assert.equal(roads(out.scene), roads(mesh.scene), 'the same number of 1ROAD meshes as the road alone'); assert.ok(out.markers.placed.every((m) => !/SKIN|JOIN/.test(m.name)));
  }
});

test('row 6: the skin is light: about SKIN_COLUMNS vertices across, a fraction of the road\'s (under 60% on an open road, under 15% on a tube)', () => {
  for (const [doc, limit] of [[plainOval(31), 0.6], [tubeOval(40), 0.15]]) {
    const { mesh } = meshOf(doc), out = exportDoc(doc), { road, skins } = parts(out.scene, mesh.cells.length);
    const count = (ds) => ds.reduce((a, d) => a + d.children[0].positions.length / 3, 0), r = count(road), s = count(skins);
    assert.ok(s < limit * r, `the skin has ${s} vertices against the road's ${r} (${(100 * s / r).toFixed(1)}%)`); assert.ok(s > 0.03 * r, 'control: it is not empty');
  }
});

test('row 7: the ring rule on a synthetic mesh: a seam row is a ring only when BOTH its segments are, and the lap\'s first seam joins the last piece to the first', () => {
  const ring = A.toSegments(tubeOval(40))[100], open = A.toSegments(plainOval(31))[100];
  assert.ok(closedRing(ring) && !closedRing(open), 'control: one ring segment and one open one');
  const mesh = (segs, cells) => ({ cells, scene: { root: { children: [] } }, _state: { pieces: segs.map(() => ({})) } });
  const set = (segs, cells) => [...S.ringCells(mesh(segs, cells), segs)];
  assert.deepEqual(set([ring, ring], [{ piece: 1, seam: true }]), [0], 'ring and ring: a ring seam');
  assert.deepEqual(set([ring, open], [{ piece: 1, seam: true }]), [], 'ring then open: not a ring (the later segment is open)');
  assert.deepEqual(set([open, ring], [{ piece: 1, seam: true }]), [], 'open then ring: not a ring (the earlier segment is open)');
  assert.deepEqual(set([ring, open, ring], [{ piece: 0, seam: true }]), [0], 'the first seam joins the LAST piece to the first: ring and ring');
  assert.deepEqual(set([ring, ring, open], [{ piece: 0, seam: true }]), [], 'the first seam with an open last piece is not a ring');
  assert.deepEqual(set([open, ring], [{ piece: 1 }, { piece: 0 }]), [0], 'a road cell is a ring when its own segment is');
});

test('row 8: a seam row\'s skin (every vertex kept, no grid) is the road\'s triangles reversed and its vertices moved 0.5 m against the normal, on a zipper with area', () => {
  const m = { type: 'mesh', name: '1ROAD_seam_x', material: 0, positions: Float32Array.of(0, 0, 0, 2, 0, 0, 0, 0, 3, 2, 0, 3), normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0), uvs: new Float32Array(8), indices: Uint16Array.of(0, 2, 1, 1, 2, 3), castShadows: true, visible: true, transparent: false, renderable: true };
  const sk = S.skinOf(m, 'UNDERSKIN_join_x');
  assert.deepEqual([...sk.indices], [0, 1, 2, 1, 3, 2], 'every triangle reversed');
  assert.deepEqual([...sk.positions].filter((_, i) => i % 3 === 1), [-0.5, -0.5, -0.5, -0.5], 'all four vertices 0.5 m below');
  assert.deepEqual([...sk.normals].filter((_, i) => i % 3 === 1), [-1, -1, -1, -1], 'normals face down, away from the road');
  const p = (i) => [sk.positions[i * 3], sk.positions[i * 3 + 1], sk.positions[i * 3 + 2]], cr = cross(sub(p(sk.indices[1]), p(sk.indices[0])), sub(p(sk.indices[2]), p(sk.indices[0])));
  assert.ok(cr[1] < 0, `the skin's first triangle faces down: ${cr}`); assert.equal(sk.castShadows, true); assert.equal(sk.name, 'UNDERSKIN_join_x'); assert.equal(sk.material, -1, 'the material is set by withUnderskin');
});
