// export_grip.test.js: node --test test/export_grip.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D261, the export half: a road piece's grip (src/core/document.js, 50 to 150, 100 when absent) reaches AC as its own surface. Rows:
//   1  the keys: GRIPnnn in three digits, none the start of another key, none at 100
//   2  surfaces.ini: no grip, the file as it was; with grips, one GRIPnnn surface each (AC's ROAD line for line but KEY and FRICTION) and `MESHES=1ROAD?, 1GRIP?`
//   3  the merge: a chunk is one surface, so a 1GRIPnnn_ run is its own chunk and never joins 1ROAD_ or another grip
//   4  an exported closed lap with one low (70) and one high (125) piece: their road meshes are 1GRIP070_/1GRIP125_ and no other piece's; the triangle set is
//      the all-100 export's apart from the names; two surfaces with the right FRICTION; the AI line unchanged; back at 100, the kn5 is the all-100 one byte for byte
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { gripKey, gripSurface, gripsOf } = require('../src/export/gripkeys.js');
const TF = require('../src/export/trackfiles.js');
const { mergeForAc } = require('../src/export/acready.js');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const AD = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const { startLayout } = require('../app/core/coreshell.js');
const { readKn5 } = require('../tools/kn5.cjs');

// AC's own ROAD surface, system/data/surfaces.ini [SURFACE_0] (read on D, 2026-10-06), every line after KEY and FRICTION
const AC_ROAD_REST = ['DAMPING=0', 'WAV=', 'WAV_PITCH=0', 'FF_EFFECT=NULL', 'DIRT_ADDITIVE=0', 'BLACK_FLAG_TIME=0', 'IS_VALID_TRACK=1', 'SIN_HEIGHT=0', 'SIN_LENGTH=0', 'IS_PITLANE=0', 'VIBRATION_GAIN=0', 'VIBRATION_LENGTH=0'];
const sections = (ini) => ini.split(/\r?\n(?=\[)/).map((s) => s.split(/\r?\n/).filter((l) => l && !l.startsWith(';')));

test('row 1: a grip key is GRIP and three digits, none at 100, and no key is the start of another (nor of ROAD or PIT)', () => {
  assert.equal(gripKey(100), null);
  assert.equal(gripKey(50), 'GRIP050'); assert.equal(gripKey(70), 'GRIP070'); assert.equal(gripKey(150), 'GRIP150');
  const keys = ['ROAD', 'PIT']; for (let g = D.GRIP_MIN; g <= D.GRIP_MAX; g++) if (g !== 100) keys.push(gripKey(g));
  for (const a of keys) for (const b of keys) if (a !== b) assert.ok(!b.startsWith(a), `${a} starts ${b}`);
  for (const bad of [49, 151, 70.5, '70']) assert.throws(() => gripKey(bad), { code: 'BAD_GRIP' });
  const K = require('../src/export/gripkeys.js');
  assert.deepEqual([K.GRIP_MIN, K.GRIP_MAX, K.GRIP_DEFAULT], [D.GRIP_MIN, D.GRIP_MAX, D.GRIP_DEFAULT], 'the export\'s range is the core\'s');
});

test('row 2: surfaces.ini is the file it was without grips; with grips, a GRIPnnn surface each, AC\'s ROAD but KEY and FRICTION, and the MESHES line names 1GRIP?', () => {
  // the file as it was written before grip existed (t180 main 49f3dff, trackfiles.js surfacesIni)
  const old = (x, s) => (`; data/surfaces.ini, written by t180-track-builder.\n; The road and walls use AC's own surfaces (system/data/surfaces.ini: ROAD, GRASS, KERB, SAND); none are redefined.\n; A T-180 track also defines PIT, which no mesh here uses, to carry CSP's extended-physics flag.\n` + (x ? '\n' + TF.EXTENDED_PHYSICS_SURFACE : '') + (s ? '\n' + TF.SOFT_COLLISION_BLOCK : ''));
  for (const x of [true, false]) for (const s of [true, false]) {
    assert.equal(TF.surfacesIni({ extendedPhysics: x, softCollision: s, grips: [] }), old(x, s), `no grips, extended ${x}, soft ${s}: as before`);
    assert.equal(TF.surfacesIni({ extendedPhysics: x, softCollision: s }), old(x, s));
  }
  const ini = TF.surfacesIni({ grips: [70, 125] }), secs = sections(ini);
  const surf = secs.filter((l) => /^\[SURFACE_\d+\]$/.test(l[0]));
  assert.deepEqual(surf.map((l) => [l[0], l[1], l[2]]), [['[SURFACE_0]', 'KEY=PIT', 'FRICTION=1'], ['[SURFACE_1]', 'KEY=GRIP070', 'FRICTION=0.7'], ['[SURFACE_2]', 'KEY=GRIP125', 'FRICTION=1.25']]);
  for (const l of surf.slice(1)) assert.deepEqual(l.slice(3), AC_ROAD_REST, `${l[1]}: every other line is AC's ROAD's`);
  assert.match(ini, /^MESHES=1ROAD\?, 1GRIP\?$/m); assert.equal((ini.match(/^MESHES=/gm) || []).length, 1);
  const plain = sections(TF.surfacesIni({ extendedPhysics: false, softCollision: false, grips: [50, 150] })).filter((l) => /^\[SURFACE_/.test(l[0]));
  assert.deepEqual(plain.map((l) => [l[0], l[1], l[2]]), [['[SURFACE_0]', 'KEY=GRIP050', 'FRICTION=0.5'], ['[SURFACE_1]', 'KEY=GRIP150', 'FRICTION=1.5']], 'plain AC (no PIT switch): numbered from 0, still written');
  assert.throws(() => gripSurface(100, 0), /100% is AC's own ROAD/);
});

const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function strip(name, x0, material = 0) {
  const cols = 4, rows = 3, nv = rows * cols, positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), idx = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const v = r * cols + c; positions.set([x0 + r * 2, 0, c * 1.5], v * 3); normals.set([0, 1, 0], v * 3); uvs.set([c / 10, r / 10], v * 2); }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) { const a = r * cols + c; idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1); }
  return { type: 'mesh', name, material, positions, normals, uvs, indices: Uint16Array.from(idx), castShadows: true, visible: true, transparent: false, renderable: true };
}

test('row 3: the merge splits at grip boundaries: a chunk is one surface, never 1ROAD_ with 1GRIPnnn_ or two grips', () => {
  const kids = [strip('1ROAD_a_body_0', 0), strip('1ROAD_a_body_1', 4), strip('1GRIP070_b_body_0', 8), strip('1GRIP070_b_body_1', 12), strip('1GRIP125_c_body_0', 16), strip('1GRIP125_c_body_1', 20), strip('1ROAD_d_body_0', 24), strip('1ROAD_d_body_1', 28)];
  const out = mergeForAc({ textures: [], materials: [{ name: 'a' }], root: { type: 'dummy', name: 't180b_track', matrix: ID.slice(), children: kids } }).root.children;
  assert.deepEqual(out.map((n) => n.name), ['1ROAD_a_chunk_0', '1GRIP070_b_chunk_0', '1GRIP125_c_chunk_0'], 'the ROAD chunk carries on after the grips (all within 400 m); each grip is its own chunk');
  assert.equal(out[0].positions.length / 3, 48, 'the ROAD chunk is pieces a and d, 4 strips of 12 vertices');
  assert.deepEqual(out.slice(1).map((n) => n.positions.length / 3), [24, 24]);
});

/** A closed lap (C's merge row 4): a 300 m straight, four 90 m-radius quarter turns, 60 m, closed. */
function lap() {
  let d = extend(D.createDoc('grip lap'), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Math.PI * 90, transition: 40, targets: { kh: 1 / 180 } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
function exportOf(doc, mergeMeshes) {
  const segs = AD.toSegments(doc), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch }, lift = (q) => AD.offsetPath(doc, segs, q);
  return FW.buildFromSegments(segs, { name: 'grip lap', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start), mergeMeshes });
}

test('row 4: a low and a high piece export as 1GRIP070_/1GRIP125_ meshes on two surfaces; the triangles are the all-100 export\'s; back at 100, byte for byte', () => {
  const base = lap(), roads = base.pieces.map((P, i) => (P.type === 'road' ? i : -1)).filter((i) => i >= 0);
  const lo = roads[0], hi = roads[2], gripped = D.setGrip(D.setGrip(base, [lo], 70), [hi], 125);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't180-grip-'));
  try {
    const read = (b) => { const f = path.join(tmp, `${Math.random()}.kn5`); fs.writeFileSync(f, Buffer.from(b.kn5)); return readKn5(f); };
    const tris = (k, re) => { const m = new Map(); for (const me of k.meshes) { if (re && !re.test(me.name)) continue; for (let t = 0; t < me.idx.length; t += 3) { const v = [0, 1, 2].map((j) => Array.from(me.pos.slice(3 * me.idx[t + j], 3 * me.idx[t + j] + 3)).join(',')); let r = 0; if (v[1] < v[r]) r = 1; if (v[2] < v[r]) r = 2; const key = `${v[r]}|${v[(r + 1) % 3]}|${v[(r + 2) % 3]}`; m.set(key, (m.get(key) || 0) + 1); } } return [...m].sort(); };
    const all100 = exportOf(base), g = exportOf(gripped), gUn = exportOf(gripped, false), k100 = read(all100), kg = read(g), kgUn = read(gUn);
    // the names: unmerged, each 1GRIPnnn_ cell is the gripped piece's, and every road cell of that piece is gripped
    const idOf = (i) => String(base.pieces[i].id).replace(/[^A-Za-z0-9]/g, '_');
    const cellsOf = (k, i) => k.meshes.filter((m) => /^1[A-Z]+\d*_/.test(m.name) && m.name.includes(`_${idOf(i)}_`));
    for (const [i, key] of [[lo, 'GRIP070'], [hi, 'GRIP125']]) {
      const mine = cellsOf(kgUn, i); assert.ok(mine.length > 0, `piece ${i} has road cells`);
      assert.ok(mine.every((m) => m.name.startsWith(`1${key}_`)), `every road cell of piece ${i} is 1${key}_`);
      assert.ok(kgUn.meshes.filter((m) => m.name.startsWith(`1${key}_`)).every((m) => m.name.includes(`_${idOf(i)}_`)), `no other piece is 1${key}_`);
      assert.ok(cellsOf(kgUn, roads[1]).every((m) => m.name.startsWith('1ROAD_')), 'a 100% piece stays 1ROAD_');
      assert.deepEqual(tris(kg, new RegExp(`^1${key}_`)), tris(kgUn, new RegExp(`^1${key}_`)), `merged, the ${key} triangles are exactly the piece's: no chunk mixes two grips`);
      assert.ok(kg.meshes.some((m) => new RegExp(`^1${key}_[^_]+_chunk_\\d+$`).test(m.name)), `${key} is in chunks of its own`);
    }
    assert.deepEqual(tris(kg), tris(k100), 'the triangle set is the all-100 export\'s');
    assert.deepEqual(kg.meshes.map((m) => m.name.replace(/^1GRIP\d{3}_/, '1ROAD_')).filter((n) => !/_chunk_/.test(n)).sort(), k100.meshes.map((m) => m.name).filter((n) => !/_chunk_/.test(n)).sort(), 'the meshes that are not chunks are the same, apart from the key');
    assert.deepEqual(kg.dummies.map((x) => x.name).sort(), k100.dummies.map((x) => x.name).sort(), 'the markers are the same');
    assert.equal(Buffer.compare(Buffer.from(g.ai), Buffer.from(all100.ai)), 0, 'the AI line is byte for byte the same');
    // the files: two surfaces with the right FRICTION, and the soft-collision block names their meshes
    assert.deepEqual(gripsOf(g.scene), [70, 125]); assert.deepEqual(gripsOf(all100.scene), []);
    const dir = path.join(tmp, 'g'), dir100 = path.join(tmp, 'h');
    TF.writeTrackFiles(dir, g.scene, { kn5Files: ['g.kn5'], desc: g.desc }); TF.writeTrackFiles(dir100, all100.scene, { kn5Files: ['g.kn5'], desc: all100.desc });
    const ini = fs.readFileSync(path.join(dir, 'data', 'surfaces.ini'), 'utf8');
    assert.match(ini, /^KEY=GRIP070\nFRICTION=0\.7$/m); assert.match(ini, /^KEY=GRIP125\nFRICTION=1\.25$/m); assert.match(ini, /^MESHES=1ROAD\?, 1GRIP\?$/m);
    assert.equal(fs.readFileSync(path.join(dir100, 'data', 'surfaces.ini'), 'utf8'), TF.surfacesIni(), 'all 100: the surfaces.ini of before');
    // back at 100: the very kn5 of the all-100 track
    const back = D.setGrip(gripped, [lo, hi], 100);
    assert.deepEqual(back, base, 'the document is the all-100 one');
    assert.equal(Buffer.compare(Buffer.from(exportOf(back).kn5), Buffer.from(all100.kn5)), 0, 'and so is the kn5, byte for byte');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
