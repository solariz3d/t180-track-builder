// kn5-move-gate.test.js: node --test test/kn5-move-gate.test.js
// tools/kn5-move-gate.cjs moves a sector gate (AC_TIME_n_L/_R) in an existing kn5 to the nearest flat station, by rewriting
// the two dummies' matrices in place (D567). The scene here: a road 32.87 m wide along +z, banked 85° (a wall) for its
// first 100 m and flat for the next 100 m, with the gate standing on the wall at s 50.
const test = require('node:test');
const assert = require('node:assert/strict');
const { writeKn5 } = require('../src/export/kn5write.js');
const { readKn5 } = require('../tools/kn5.cjs');
const { moveGate, locateDummies } = require('../tools/kn5-move-gate.cjs');
const fs = require('fs'), os = require('os'), path = require('path');

const I16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const HALF = 16.435, BANK = 85 * Math.PI / 180;
const at = (z, u) => (z < 100 ? [u * Math.cos(BANK), u * Math.sin(BANK), z] : [u, 0, z]);   // +u is left (+x) with the race along +z
const nrm = (z) => (z < 100 ? [-Math.sin(BANK), Math.cos(BANK), 0] : [0, 1, 0]);

function strip(name, z0, z1, A = at, Nf = nrm, step = 2) {
  const P = [], N = [], UV = [], idx = [];
  const cols = [-HALF, -HALF / 2, 0, HALF / 2, HALF];
  for (let z = z0; z <= z1 + 1e-9; z += step) for (const u of cols) { P.push(...A(z, u)); N.push(...Nf(z)); UV.push(0, 0); }
  const rows = P.length / 3 / cols.length;
  for (let r = 0; r + 1 < rows; r++) for (let c = 0; c + 1 < cols.length; c++) {
    const a = r * cols.length + c, b = a + 1, d = a + cols.length, e = d + 1;
    idx.push(a, d, b, b, d, e);   // CCW seen from the road's up side
  }
  return { type: 'mesh', name, material: 0, positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(UV), indices: new Uint16Array(idx), castShadows: true, visible: true, transparent: false, renderable: true };
}
const dummy = (name, pos, left, up, fwd) => ({ type: 'dummy', name, matrix: [...left, 0, ...up, 0, ...fwd, 0, ...pos, 1], children: [] });

function scene({ allWall = false, withGate = true } = {}) {
  const wallUp = nrm(0), wallLeft = [Math.cos(BANK), Math.sin(BANK), 0];
  const gate = withGate ? [dummy('AC_TIME_2_L', [...at(50, HALF - 0.5)].map((x, k) => x + wallUp[k] * 1.5), wallLeft, wallUp, [0, 0, 1]),
    dummy('AC_TIME_2_R', [...at(50, -HALF + 0.5)].map((x, k) => x + wallUp[k] * 1.5), wallLeft, wallUp, [0, 0, 1])] : [];
  return {
    textures: [], materials: [{ name: 'road', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0, props: [], samplers: [] }],
    root: { type: 'dummy', name: 'root', matrix: I16.slice(), children: [
      strip('1ROAD_wall', 0, 100), ...(allWall ? [] : [strip('1ROAD_flat', 100, 200)]),
      dummy('AC_TIME_0_L', [15.9, 1.5, 150], [1, 0, 0], [0, 1, 0], [0, 0, 1]), dummy('AC_TIME_0_R', [-15.9, 1.5, 150], [1, 0, 0], [0, 1, 0], [0, 0, 1]),
      ...gate,
    ] },
  };
}
// A road banked meshDeg all along, its gate at s 50, and an AI line whose normal is lineN everywhere: the two disagree on purpose.
const tilt = (d) => { const b = d * Math.PI / 180; return { at: (z, u) => [u * Math.cos(b), u * Math.sin(b), z], n: [-Math.sin(b), Math.cos(b), 0], left: [Math.cos(b), Math.sin(b), 0] }; };
function disagree(meshDeg, lineN) {
  const g = tilt(meshDeg), st = [];
  const end = (u) => g.at(50, u).map((x, k) => x + g.n[k] * 1.5);
  const sc = { textures: [], materials: [{ name: 'road', shader: 'ksPerPixel', alphaBlend: 0, alphaTested: false, depthMode: 0, props: [], samplers: [] }],
    root: { type: 'dummy', name: 'root', matrix: I16.slice(), children: [strip('1ROAD', 0, 200, g.at, () => g.n),
      dummy('AC_TIME_2_L', end(HALF - 0.5), g.left, g.n, [0, 0, 1]), dummy('AC_TIME_2_R', end(-HALF + 0.5), g.left, g.n, [0, 0, 1])] } };
  for (let z = 0; z <= 200; z += 2) st.push({ s: z, pos: [0, 0, z], fwd: [0, 0, 1], n: lineN });
  return { kn5: writeKn5(sc), stations: st };
}
// the AI line's stations, every 2 m: position on the centreline, forward along +z, the road's normal there
const stations = (zEnd = 200) => { const out = []; for (let z = 0; z <= zEnd; z += 2) out.push({ s: z, pos: at(z, 0), fwd: [0, 0, 1], n: nrm(z) }); return out; };
const tmp = (buf) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mg-')), 't.kn5'); fs.writeFileSync(f, buf); return f; };

test('moving the gate changes only the two gate matrices: same length, same meshes, every other dummy identical', () => {
  const src = writeKn5(scene()), before = Buffer.from(src);
  const r = moveGate(src, stations(), { gate: 2, nearS: 50, closed: false, reachM: 150 });
  assert.ok(src.equals(before), 'the input buffer is not modified');
  assert.equal(r.buf.length, src.length);
  const offs = locateDummies(src).filter((d) => /^AC_TIME_2_[LR]$/.test(d.name)).map((d) => d.offset);
  for (let k = 0; k < src.length; k++) if (src[k] !== r.buf[k]) assert.ok(offs.some((o) => k >= o && k < o + 64), `byte ${k} changed outside the two gate matrices`);
  const a = readKn5(tmp(src)), b = readKn5(tmp(r.buf));
  assert.deepEqual(b.meshes.map((m) => [m.name, [...m.pos], [...m.idx]]), a.meshes.map((m) => [m.name, [...m.pos], [...m.idx]]));
  assert.deepEqual(b.dummies.filter((d) => !/^AC_TIME_2_/.test(d.name)), a.dummies.filter((d) => !/^AC_TIME_2_/.test(d.name)));
  assert.deepEqual(b.dummies.map((d) => d.name), a.dummies.map((d) => d.name));
});

test('the moved gate stands on the nearest flat road, the full road width apart seen from above, L left of R', () => {
  const r = moveGate(writeKn5(scene()), stations(), { gate: 2, nearS: 50, closed: false, reachM: 150 });
  assert.ok(r.station.s >= 100, `moved onto the flat road (s ${r.station.s})`);
  assert.ok(r.station.s <= 104, `the NEAREST flat station (s ${r.station.s})`);
  const d = readKn5(tmp(r.buf)).dummies, L = d.find((x) => x.name === 'AC_TIME_2_L'), R = d.find((x) => x.name === 'AC_TIME_2_R');
  assert.ok(Math.abs(Math.hypot(L.pos[0] - R.pos[0], L.pos[2] - R.pos[2]) - 2 * (HALF - 0.5)) < 0.1, `top-down width ${Math.hypot(L.pos[0] - R.pos[0], L.pos[2] - R.pos[2])}`);
  assert.ok(L.pos[0] > R.pos[0], 'L is on the left (+x) of the race direction (+z)');
  assert.ok(Math.abs(L.pos[1] - R.pos[1]) < 0.01, 'level across');
  for (const g of [L, R]) assert.deepEqual(g.fwd.map((x) => Math.round(x * 1e6) / 1e6), [0, 0, 1]);
});

test('the moved gate passes the markers checks (src/markers/checks.js) for its orientation, height, heading and footing', () => {
  const r = moveGate(writeKn5(scene()), stations(), { gate: 2, nearS: 50, closed: false, reachM: 150 });
  assert.deepEqual(r.checks.problems, []);
  assert.deepEqual(r.checks.ids, ['gate-orientation', 'height-and-heading', 'slots']);
  for (const m of r.placed) { assert.ok(m.h >= 1 && m.h <= 2, `${m.name} h ${m.h}`); }
});

test('no flat station within reach: refused with NO_FLAT_STATION, nothing written', () => {
  assert.throws(() => moveGate(writeKn5(scene({ allWall: true })), stations(100), { gate: 2, nearS: 50, closed: false, reachM: 150 }), (e) => e.code === 'NO_FLAT_STATION');
});

test('a kn5 without the gate: refused with NO_GATE', () => {
  assert.throws(() => moveGate(writeKn5(scene({ withGate: false })), stations(), { gate: 2, nearS: 50, closed: false, reachM: 150 }), (e) => e.code === 'NO_GATE');
});

test('a gate under a non-identity parent is refused rather than written in the wrong frame', () => {
  const sc = scene(), g = sc.root.children.filter((n) => /^AC_TIME_2_/.test(n.name));
  sc.root.children = sc.root.children.filter((n) => !/^AC_TIME_2_/.test(n.name));
  sc.root.children.push({ type: 'dummy', name: 'holder', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1], children: g });
  assert.throws(() => moveGate(writeKn5(sc), stations(), { gate: 2, nearS: 50, closed: false, reachM: 150 }), (e) => e.code === 'PARENT_NOT_IDENTITY');
});

test('the AI line\'s camber is honoured: a line whose normal is 25° from vertical is refused even where the mesh under the gate is level', () => {
  const p = 25 * Math.PI / 180, d = disagree(0, [0, Math.cos(p), -Math.sin(p)]);   // tilted about the lateral axis: the edges and the gate stay clean
  assert.throws(() => moveGate(d.kn5, d.stations, { gate: 2, nearS: 50, closed: false, reachM: 150 }), (e) => e.code === 'NO_FLAT_STATION');
});

test('the gate itself must lie level: a mesh banked 18° under a line that says flat is refused', () => {
  const d = disagree(18, [0, 1, 0]);
  assert.throws(() => moveGate(d.kn5, d.stations, { gate: 2, nearS: 50, closed: false, reachM: 150 }), (e) => e.code === 'NO_FLAT_STATION');
});
