// export_gltf.test.js: node --test test/export_gltf.test.js   (under the heavy-run lock: it exports tracks and, where Blender is on the machine, runs it headless)
// EXPORT FOR BLENDER (src/export/gltf.js, src/export/blender.js): the export's own scene, after acready's merge (the very scene the kn5 is written from), as a glTF 2.0
// binary Blender opens: every kn5 mesh a node of the same name and the same Float32 positions, grouped one node per piece per kind (p07_road, p07_underskin, …),
// the AC_ markers as empty nodes at the same transforms, the AI line as a polyline, one material per surface with its texture embedded as PNG. Read back here by
// our own strict reader (test/glb_read.js) and, where Blender is installed, by Blender itself (headless: --background --factory-startup, no window).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const GL = require('../src/export/gltf.js');
const BL = require('../src/export/blender.js');
const { readKn5 } = require('../tools/kn5.cjs');
const { readAiLine } = require('../src/export/ailine.js');
const { startLayout } = require('../app/core/coreshell.js');
const { createCoreTextures } = require('../app/core/textures.js');
const { readGlb } = require('./glb_read.js');

const Rr = 180, Q = (Math.PI * Rr) / 2;
function lap(first) { let d = extend(D.createDoc('gltf lap'), { length: 300, ...(first ? { first } : { family: 'bowl' }) }); for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } }); d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } }); const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc; }
/** The export route the app uses (as test/texture_flow.test.js does): closed tracks as built, open ones as the test export; `textured` adds the made asphalt. */
function exportDoc(doc, { textured = false } = {}) {
  const segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  const textures = textured ? createCoreTextures({ segments: () => segs, kind: 'asphalt' }).current() : undefined;
  return FW.buildFromSegments(segs, { name: doc.name || 'track', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start, { open: !doc.closed }), test: !doc.closed, ...(textures ? { textures } : {}) });
}
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 't180b-gltf-'));
const kn5Of = (ex) => { const d = tmpdir(), f = path.join(d, 'x.kn5'); try { fs.writeFileSync(f, ex.kn5); return readKn5(f); } finally { fs.rmSync(d, { recursive: true, force: true }); } };
/** Every glTF node with a mesh: its name, its positions (the one primitive's), its parent's name. */
function meshNodes(g) {
  return g.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.mesh !== undefined).map(({ n, i }) => {
    const prims = g.meshes[n.mesh].primitives, tri = prims.filter((p) => p.mode === undefined || p.mode === 4);
    return { name: n.name, parent: g.parent[i] >= 0 ? g.nodes[g.parent[i]].name : null, prims: tri.map((p) => ({ pos: g.accessor(p.attributes.POSITION), nrm: g.accessor(p.attributes.NORMAL), uv: p.attributes.TEXCOORD_0 !== undefined ? g.accessor(p.attributes.TEXCOORD_0) : null, idx: g.accessor(p.indices), material: p.material })), lines: prims.filter((p) => p.mode === 3 || p.mode === 2 || p.mode === 1) };
  });
}

test('gltf: the file our exporter writes passes the strict reader (chunks, alignment, accessor bounds, POSITION min/max equal to the data, indices in range, PNG images)', () => {
  const ex = exportDoc(lap({ w: 31 }), { textured: true }), { glb } = GL.toGlb(ex.acScene, { name: 'gltf lap', ai: readAiLine(ex.ai).points.map((p) => p.pos), closed: true });
  const g = readGlb(glb);
  assert.ok(g.json.images && g.json.images.length >= 1, 'the made asphalt is embedded');
  assert.equal(g.json.asset.generator.startsWith('t180-track-builder'), true);
});

test('gltf: the strict reader on a scene that NEEDS padding: one triangle (6 bytes of indices last in the BIN chunk) under four names (every JSON length mod 4)', () => {
  const mesh = { type: 'mesh', name: '1ROAD_p1_one', material: 0, positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: Float32Array.from([0, 0, 1, 0, 0, 1]), indices: Uint16Array.from([0, 1, 2]), castShadows: true, visible: true, transparent: false, renderable: true };
  const scene = { textures: [], materials: [{ name: 'm', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0, props: [], samplers: [] }], root: { type: 'dummy', name: 'root', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [mesh] } };
  const pads = new Set();
  for (const name of ['a', 'ab', 'abc', 'abcd']) { const { glb } = GL.toGlb(scene, { name }); const g = readGlb(glb); pads.add(Buffer.from(glb).readUInt32LE(12) - JSON.stringify(g.json).length); assert.equal(g.accessor(g.meshes[0].primitives[0].indices).length, 3); }
  assert.ok(pads.size > 1, 'the four names give the JSON chunk different paddings');
});

test('gltf: every kn5 mesh is a node of the same name with the same vertex count and the same Float32 positions, under its piece-and-kind group', () => {
  const ex = exportDoc(lap({ w: 31 })), k = kn5Of(ex), g = readGlb(GL.toGlb(ex.acScene, { name: 'x' }).glb), nodes = meshNodes(g), byName = new Map(nodes.map((x) => [x.name, x]));
  assert.equal(nodes.filter((x) => !x.lines.length).length, k.meshes.length, 'as many mesh nodes as the kn5 has meshes');
  for (const m of k.meshes) {
    const x = byName.get(m.name); assert.ok(x, `no node ${m.name}`);
    assert.equal(x.prims.length, 1); assert.equal(x.prims[0].pos.length, m.pos.length, `${m.name} vertex count`);
    for (let i = 0; i < m.pos.length; i++) if (x.prims[0].pos[i] !== m.pos[i]) assert.fail(`${m.name} position ${i}: ${x.prims[0].pos[i]} vs ${m.pos[i]}`);
    const piece = /_(p\d+)_/.exec(m.name);
    if (piece) assert.match(x.parent, new RegExp(`^p0*${piece[1].slice(1)}_`), `${m.name} sits under its piece's group, not ${x.parent}`);
  }
  assert.ok(g.nodes.some((n) => /^p0*1_road$/.test(n.name)) && g.nodes.some((n) => /^p0*1_underskin$/.test(n.name)), 'groups p01_road and p01_underskin');
});

test('gltf: the AC markers are empty nodes of the same names at the same transforms as in the kn5', () => {
  const ex = exportDoc(lap({ w: 31 })), k = kn5Of(ex), g = readGlb(GL.toGlb(ex.acScene, { name: 'x' }).glb), byName = new Map(g.nodes.map((n) => [n.name, n]));
  assert.ok(k.dummies.length >= 4, 'control: the kn5 carries markers');
  for (const d of k.dummies) {
    const n = byName.get(d.name); assert.ok(n, `no node ${d.name}`); assert.equal(n.mesh, undefined, `${d.name} is an empty`);
    const M = n.matrix || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let a = 0; a < 3; a++) { assert.ok(Math.abs(Math.fround(M[12 + a]) - d.pos[a]) < 1e-3, `${d.name} position`); assert.ok(Math.abs(Math.fround(M[8 + a]) - d.fwd[a]) < 1e-5, `${d.name} forward`); }
  }
});

test('gltf: the AI line is a polyline node with the AI file\'s points, and the UVs of a textured tube are the flow\'s (v as the kn5 writes it, 1 - v)', () => {
  const ex = exportDoc(lap({ w: 31, t: 360 }), { textured: true }), pts = readAiLine(ex.ai).points.map((p) => p.pos), g = readGlb(GL.toGlb(ex.acScene, { name: 'x', ai: pts, closed: true }).glb);
  const ai = meshNodes(g).find((x) => x.name === 'ai_fast_lane'); assert.ok(ai && ai.lines.length === 1, 'one line primitive');
  const lp = g.accessor(ai.lines[0].attributes.POSITION); assert.equal(lp.length, pts.length * 3);
  for (let i = 0; i < pts.length; i++) for (let a = 0; a < 3; a++) assert.equal(lp[i * 3 + a], Math.fround(pts[i][a]));
  const scene = new Map(); (function walk(n) { if (n.type === 'mesh') scene.set(n.name, n); for (const c of n.children || []) walk(c); })(ex.acScene.root);
  let checked = 0;
  for (const x of meshNodes(g)) { const s = scene.get(x.name); if (!s || !x.prims[0] || !/^1ROAD_p/.test(x.name)) continue; const uv = x.prims[0].uv; for (let i = 0; i < uv.length; i += 2) { assert.equal(uv[i], s.uvs[i]); assert.equal(uv[i + 1], Math.fround(1 - s.uvs[i + 1])); } checked++; }
  assert.ok(checked > 10, `${checked} road meshes compared`);
});

test('blender.js: the folder gets <name>.glb and README.txt; the selected pieces write only theirs (and the markers among them)', () => {
  const ex = exportDoc(lap({ w: 31 })), dir = tmpdir();
  try {
    const all = BL.writeForBlender(ex, { dir }), g = readGlb(fs.readFileSync(all.glb));
    assert.ok(fs.existsSync(path.join(dir, 'README.txt')) && /ksEditor/.test(fs.readFileSync(path.join(dir, 'README.txt'), 'utf8')));
    assert.equal(path.basename(all.glb), `${ex.desc.name.replace(/[^A-Za-z0-9_. -]/g, '_')}.glb`);
    const sub = BL.writeForBlender(ex, { dir: path.join(dir, 'sub'), pieces: ['p2'] }), gs = readGlb(fs.readFileSync(sub.glb)), names = meshNodes(gs).map((x) => x.name);
    assert.ok(names.length > 0 && names.every((n) => /_p2_/.test(n)), `only piece p2: ${names.slice(0, 4).join(', ')}`);
    assert.ok(meshNodes(g).length > names.length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('gltf: a mesh under a moved parent is refused by name (the export scene is flat; the writer does not guess a transform)', () => {
  const ex = exportDoc(lap({ w: 31 })), root = ex.acScene.root, kid = root.children.find((c) => c.type === 'mesh');
  const bad = { ...ex.acScene, root: { ...root, children: [{ type: 'dummy', name: 'moved', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1], children: [kid] }] } };
  assert.throws(() => GL.toGlb(bad, { name: 'x' }), (e) => e.code === 'GLTF_NOT_FLAT');
});

// ── BLENDER ITSELF ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const BLENDER = process.env.T180_BLENDER || 'C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe';
const PY = `
import bpy, sys, json
from mathutils import Vector
bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index('--') + 1], merge_vertices=False)
out = []
for o in bpy.data.objects:
    if o.type == 'MESH':
        vs = [o.matrix_world @ v.co for v in o.data.vertices]
        mn = [min(v[k] for v in vs) for k in range(3)] if vs else None; mx = [max(v[k] for v in vs) for k in range(3)] if vs else None
        out.append([o.name, 'MESH', len(o.data.vertices), mn, mx])
    else:
        out.append([o.name, o.type, 0, list(o.matrix_world.translation), None])
print('T180JSON' + json.dumps(out))
`;
function blenderRead(glbFile) {
  const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python-expr', PY, '--', glbFile], { encoding: 'utf8', windowsHide: true, timeout: 15 * 60 * 1000, maxBuffer: 1 << 28 });
  const line = (r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('T180JSON'));
  if (!line) throw new Error(`Blender printed no result (exit ${r.status}): ${(r.stderr || r.stdout || '').slice(-1500)}`);
  return JSON.parse(line.slice(8));
}
/** Blender's glTF importer turns Y-up into Z-up: (x, y, z) -> (x, -z, y). */
const toBlender = (p) => [p[0], -p[2], p[1]];
function compareWithBlender(t, label, ex) {
  const k = kn5Of(ex), dir = tmpdir();
  try {
    const out = BL.writeForBlender(ex, { dir }), objs = blenderRead(out.glb), byName = new Map(objs.map((o) => [o[0], o]));   // each row is [name, type, vertices, min, max]
    let compared = 0;
    for (const m of k.meshes) {
      const o = byName.get(m.name); assert.ok(o, `${label}: Blender has no object ${m.name}`);
      assert.equal(o[2], m.pos.length / 3, `${label}: ${m.name} vertex count in Blender`);
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < m.pos.length; i += 3) { const b = toBlender([m.pos[i], m.pos[i + 1], m.pos[i + 2]]); for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], b[a]); mx[a] = Math.max(mx[a], b[a]); } }
      for (let a = 0; a < 3; a++) assert.ok(Math.abs(o[3][a] - mn[a]) < 1e-3 && Math.abs(o[4][a] - mx[a]) < 1e-3, `${label}: ${m.name} bounds ${JSON.stringify([o[3], o[4]])} vs kn5 ${JSON.stringify([mn, mx])}`);
      compared++;
    }
    for (const d of k.dummies) { const o = byName.get(d.name); assert.ok(o && o[1] === 'EMPTY', `${label}: marker ${d.name} is an empty in Blender`); const b = toBlender(d.pos); for (let a = 0; a < 3; a++) assert.ok(Math.abs(o[3][a] - b[a]) < 1e-3, `${label}: ${d.name} at ${o[3]} vs ${b}`); }
    t.diagnostic(`${label}: ${compared} meshes and ${k.dummies.length} markers agree with the kn5 in Blender`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('blender: the nine fixtures, imported by Blender headless, have the kn5\'s mesh names, vertex counts and bounds, and its markers', (t) => {
  if (!fs.existsSync(BLENDER)) { t.skip(`Blender is not at ${BLENDER} (set T180_BLENDER to point at it)`); return; }
  const F = path.join(__dirname, 'fixtures'), files = fs.readdirSync(F).filter((f) => /^F\d-.*\.core2\.json$/.test(f)).sort();
  assert.equal(files.length, 9);
  let done = 0;
  for (const f of files) {
    const doc = D.parse(fs.readFileSync(path.join(F, f), 'utf8'));
    if (!doc.pieces.length) { t.diagnostic(`${f}: an empty track, nothing to export`); continue; }
    compareWithBlender(t, f, exportDoc(doc)); done++;
  }
  assert.ok(done >= 8, `${done} fixtures compared`);
});

test('blender: his CRAZY TEST (read only), imported by Blender headless, agrees with its kn5', (t) => {
  if (!fs.existsSync(BLENDER)) { t.skip(`Blender is not at ${BLENDER}`); return; }
  const f = process.env.APPDATA && path.join(process.env.APPDATA, 'com.solariz3d.t180-track-builder/tracks/eq-CRAZY TEST.t180track');
  if (!f || !fs.existsSync(f)) { t.skip('his saved CRAZY TEST is not on this machine'); return; }
  compareWithBlender(t, 'CRAZY TEST', exportDoc(D.parse(fs.readFileSync(f, 'utf8'))));
});
