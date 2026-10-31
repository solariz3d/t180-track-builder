// export_blender_fbx.test.js: node --test test/export_blender_fbx.test.js   (under the heavy-run lock: it exports a lap and runs Blender headless where it is installed)
// THE EXPORT FOR BLENDER, the round trip (src/export/blender.js, src/export/blender_fbx.py): the files appear in a folder; the track is NOT MIRRORED in Blender
// (a right-hand corner turns right seen from above, the left timing gate lies on the left); and the FBX the bundled script writes holds every kn5 mesh by name
// with the kn5's own vertices in the kn5's own frame (Y up, right-handed), the markers as empties at the kn5's places, in metres, and Blender reads that FBX
// back still turning right. Rows that need Blender skip with a reason where it is absent (T180_BLENDER points at another).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const A = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const BL = require('../src/export/blender.js');
const { readKn5 } = require('../tools/kn5.cjs');
const { startLayout } = require('../app/core/coreshell.js');
const { readGlb } = require('./glb_read.js');
const { readFbx } = require('./fbx_read.js');

const BLENDER = process.env.T180_BLENDER || 'C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe';
const SCRIPT = path.join(__dirname, '..', 'src', 'export', 'blender_fbx.py');
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 't180b-fbx-'));
/** A straight, then a RIGHT-hand 90° corner (the document's turn: + is left), then a straight: open, as the test export writes it. */
function rightTurn() {
  let d = extend(D.createDoc('right turn'), { length: 300, family: 'bowl' });
  d = extend(d, { length: (Math.PI * 100) / 2, transition: 30, targets: { kh: -1 / 100 } });
  d = extend(d, { length: 300, transition: 30, targets: { kh: 0 } });
  const segs = A.toSegments(d), lift = (q) => A.offsetPath(d, segs, q), start = { pos: d.start.pos.slice(), theta: d.start.heading, p: d.start.pitch };
  return FW.buildFromSegments(segs, { name: 'right turn', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start, { open: true }), test: true });
}
function blender(args) {
  const r = spawnSync(BLENDER, args, { encoding: 'utf8', windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 1 << 26 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const HAND = `
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
(bpy.ops.import_scene.gltf(filepath=a[0], merge_vertices=False) if a[0].endswith('.glb') else bpy.ops.import_scene.fbx(filepath=a[0]))
ai = [o for o in bpy.data.objects if o.name.startswith('ai_fast_lane')][0]
v = [ai.matrix_world @ p.co for p in ai.data.vertices]; n = len(v)
gate = lambda n: bpy.data.objects[n].matrix_world.translation
L, R = gate('AC_TIME_0_L'), gate('AC_TIME_0_R')
print('T180HAND %f %f %f %f %f %f %f %f' % (v[40].x - v[5].x, v[40].y - v[5].y, v[n - 5].x - v[n - 40].x, v[n - 5].y - v[n - 40].y, L.x - R.x, L.y - R.y, 0, n))
`;
/** In Blender's own frame (Z up), seen from above, with the race direction taken from the AI line's own first metres (not from the gates, so a mirror shows):
 *  whether the line turns right (its heading turns clockwise) and whether the left timing gate lies to the left of the race direction. */
function readHand(file) {
  const r = blender(['--background', '--factory-startup', '--python-expr', HAND, '--', file]);
  const line = r.out.split(/\r?\n/).find((l) => l.startsWith('T180HAND')); if (!line) throw new Error(`Blender printed no result (exit ${r.status}): ${r.out.slice(-1200)}`);
  const [ax, ay, bx, by, gx, gy] = line.split(' ').slice(1).map(Number);
  return { gateLeft: ax * gy - ay * gx > 0, turnRight: ax * by - ay * bx < 0 };
}

test('blenderFiles: <name>.glb and README.txt as bytes, the glb what writeForBlender writes; writeForBlender puts both in the folder', () => {
  const ex = rightTurn(), b = BL.blenderFiles(ex), dir = tmpdir();
  try {
    assert.deepEqual(b.files.map((f) => f.path), ['right turn _test_ unfinished_.glb', 'README.txt']);
    readGlb(b.files[0].bytes);
    const w = BL.writeForBlender(ex, { dir });
    assert.ok(Buffer.from(fs.readFileSync(w.glb)).equals(Buffer.from(b.files[0].bytes)), 'the same glb bytes');
    assert.match(fs.readFileSync(w.readme, 'utf8'), /FBX/);
    assert.deepEqual(BL.fbxArgs('s.py', 'a.glb', 'b.fbx'), ['--background', '--factory-startup', '--python', 's.py', '--', 'a.glb', 'b.fbx']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('handedness: in Blender a right-hand corner turns right seen from above, and the left timing gate is on the left (the glb is not mirrored)', (t) => {
  if (!fs.existsSync(BLENDER)) { t.skip(`Blender is not at ${BLENDER}`); return; }
  const dir = tmpdir();
  try { const w = BL.writeForBlender(rightTurn(), { dir }), h = readHand(w.glb); assert.deepEqual(h, { gateLeft: true, turnRight: true }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('handedness CONTROL: the same lap MIRRORED (x negated in every position, normal and marker matrix) reads as a left turn with the gate on the right', (t) => {
  if (!fs.existsSync(BLENDER)) { t.skip(`Blender is not at ${BLENDER}`); return; }
  const ex = rightTurn(), flip = (n) => {
    if (n.type === 'mesh') { const p = Float32Array.from(n.positions), q = Float32Array.from(n.normals); for (let i = 0; i < p.length; i += 3) { p[i] = -p[i]; q[i] = -q[i]; } return { ...n, positions: p, normals: q }; }
    const m = n.matrix.slice(); for (const i of [1, 2, 3, 4, 8, 12]) m[i] = -m[i];   // S·M·S with S = diag(-1, 1, 1, 1): the entries with exactly one x index
    return { ...n, matrix: m, children: (n.children || []).map(flip) };
  };
  const { readAiLine } = require('../src/export/ailine.js'), mirrored = { ...ex, acScene: { ...ex.acScene, root: flip(ex.acScene.root) }, ai: null };
  const pts = readAiLine(ex.ai).points.map((p) => [-p.pos[0], p.pos[1], p.pos[2]]), GL = require('../src/export/gltf.js'), dir = tmpdir();
  try { const f = path.join(dir, 'm.glb'); fs.writeFileSync(f, GL.toGlb(mirrored.acScene, { name: 'm', ai: pts }).glb); assert.deepEqual(readHand(f), { gateLeft: false, turnRight: false }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the FBX round trip: the bundled script writes a binary FBX holding every kn5 mesh by name with the kn5\'s vertices, the markers at the kn5\'s places, in metres, and Blender reads it back still turning right', (t) => {
  if (!fs.existsSync(BLENDER)) { t.skip(`Blender is not at ${BLENDER}`); return; }
  const ex = rightTurn(), dir = tmpdir();
  try {
    const w = BL.writeForBlender(ex, { dir }), fbx = path.join(dir, 'right turn.fbx'), r = blender(BL.fbxArgs(SCRIPT, w.glb, fbx));
    assert.match(r.out, /T180FBX ok \d+/, r.out.slice(-1200)); assert.ok(fs.existsSync(fbx));
    const f = readFbx(fs.readFileSync(fbx)), kf = path.join(dir, 'x.kn5'); fs.writeFileSync(kf, ex.kn5); const k = readKn5(kf);
    assert.ok(f.version >= 7400); assert.equal(f.unitScale, 100, 'FBX counts in centimetres: 100 says the vertices are metres');
    const models = new Map(f.models.map((m) => [m.name, m])), geomOf = new Map(); for (const [g, p] of f.parentOf) if (f.geometries.has(g)) geomOf.set(p, f.geometries.get(g));
    for (const m of k.meshes) {
      const mo = models.get(m.name); assert.ok(mo && mo.kind === 'Mesh', `no FBX mesh ${m.name}`);
      assert.deepEqual([...mo.translation, ...mo.rotation, ...mo.scaling].map((x) => +x.toFixed(6)), [0, 0, 0, 0, 0, 0, 1, 1, 1], `${m.name} has an identity transform`);
      const v = geomOf.get(mo.id).vertices; assert.equal(v.length, m.pos.length, `${m.name} vertex count`);
      for (let i = 0; i < v.length; i++) if (Math.fround(v[i]) !== m.pos[i]) assert.fail(`${m.name} vertex ${i}: FBX ${v[i]}, kn5 ${m.pos[i]}`);
    }
    for (const d of k.dummies) { const mo = models.get(d.name); assert.ok(mo && mo.kind === 'Null', `no FBX empty ${d.name}`); for (let a = 0; a < 3; a++) assert.ok(Math.abs(mo.translation[a] - d.pos[a]) < 1e-3, `${d.name} at ${mo.translation} vs ${d.pos}`); }
    t.diagnostic(`FBX ${f.version}: ${k.meshes.length} meshes and ${k.dummies.length} markers equal the kn5's`);
    assert.deepEqual(readHand(fbx), { gateLeft: true, turnRight: true }, 'Blender reads the FBX back unmirrored');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
