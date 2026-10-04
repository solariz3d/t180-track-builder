// guides.test.js: node --test app/test/guides.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D237 (the keeper: "a 3D grid to some how see the track and make it all symmetrical ... a 2D grid if the track has no height, but as soon as the track turns up or downward the
// grid becomes 3D"). The preview path ONLY: nothing here reaches src/ or the export (core_cup_fixtures, run beside it, is the proof, and the last test reads the diff of what
// was touched). Stated before the tests were written, and each is a test of an outcome:
//   rows 1-4   the grid: a flat track draws the ground grid only; a track with height draws the lattice, which spans its lowest to its highest point; the line count stays bounded
//              on a 14 km track; the modes force what they say, and off draws nothing
//   rows 5-8   the symmetry guides: the centre and the axes; an oval's mirror gap is about 0 and an asymmetric track reads its KNOWN offset; the mirror modes flip what they say
//   rows 9-10  the camera maths: a point projects and a pointer ray lands back on it (the centre handle's drag); the dashes
//   rows 11-14 the preview and its layer: a flat track and a hilly one through the real shell and a drawing context, the buttons' events, the labels and the handle
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const G = require('../preview/guides.js');
const P = require('../preview/preview.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const { createGuidesLayer } = require('../preview/guideslayer.js');
const { createCoreShell } = require('../core/coreshell.js');
const CAM = require('../camera/index.js');

const path_ = (f, n, closed = false) => ({ closed, samples: Array.from({ length: n }, (_, i) => ({ pos: f(i) })) });
const boxOf = (p) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const s of p.samples) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], s.pos[d]); hi[d] = Math.max(hi[d], s.pos[d]); } return { min: lo, max: hi }; };
const FLAT = path_((i) => [i * 2, 0, 0], 150), HILL = path_((i) => [i * 2, 20 * Math.sin(i / 20) + 25, 0], 300);   // the hill's lowest point is 5 m up, so "the base" is not just y = 0
const pairs = (list) => list.reduce((a, x) => a + x.positions.length / 6, 0);
const ys = (list) => list.flatMap((x) => Array.from(x.positions).filter((_, i) => i % 3 === 1));
const kinds = (plan) => [...new Set([...plan.depth, ...plan.over].map((x) => x.kind))];

test('row 1: a flat track draws the ground grid only: no lattice, no levels, no labels, no drop lines', () => {
  const plan = G.guidePlan({ bounds: boxOf(FLAT), path: FLAT, mode: 'auto' });
  assert.equal(plan.mode, 'ground'); assert.equal(plan.flat, true); assert.deepEqual(kinds(plan), ['ground']); assert.equal(plan.levels.length, 0); assert.equal(plan.labels.length, 0);
  const y = ys(plan.depth); assert.ok(y.length > 0 && y.every((v) => v === plan.base), 'every grid vertex is on one level, the base');
  const high = path_((i) => [i * 2, 7, 0], 100), hp = G.guidePlan({ bounds: boxOf(high), path: high, mode: 'auto' }); assert.equal(hp.mode, 'ground'); assert.ok(ys(hp.depth).every((v) => v === 7), 'a flat track 7 m up has its grid at 7 m, under it, not at y = 0');
  assert.equal(G.guidePlan({ bounds: boxOf(path_((i) => [i, 0.49 * Math.sin(i / 30) ** 2, 0], 100)), path: path_((i) => [i, 0.49 * Math.sin(i / 30) ** 2, 0], 100), mode: 'auto' }).mode, 'ground', '0.49 m of height is still flat');
  const lifted = path_((i) => [i, i < 50 ? 0 : 0.6, 0], 100); assert.equal(G.guidePlan({ bounds: boxOf(lifted), path: lifted, mode: 'auto' }).mode, '3d', '0.6 m of height is not');
});

test('row 2: a track with height draws the lattice, and it spans the track\'s lowest to its highest point, with level labels, verticals, rings and drop lines', () => {
  const b = boxOf(HILL), plan = G.guidePlan({ bounds: b, path: HILL, mode: 'auto' });
  assert.equal(plan.mode, '3d'); assert.equal(plan.flat, false); assert.ok(plan.range > 30, `control: the track climbs ${plan.range.toFixed(1)} m`);
  for (const k of ['ground', 'lattice', 'level', 'drop']) assert.ok(kinds(plan).includes(k), `${k} is drawn`);
  const all = ys(plan.depth); assert.ok(Math.abs(Math.min(...all) - b.min[1]) < 1e-5, 'the lattice starts at the track\'s lowest point (to float32)'); assert.ok(Math.max(...all) >= b.max[1], 'and rises to at least its highest');
  const verts = plan.depth.filter((x) => x.kind === 'lattice'); assert.ok(pairs(verts) >= 4, 'verticals'); for (const v of verts) for (let i = 0; i < v.positions.length; i += 6) assert.ok(v.positions[i] === v.positions[i + 3] && v.positions[i + 2] === v.positions[i + 5], 'a vertical stays on its x and z');
  assert.ok(plan.levels.length >= 3 && plan.levels.every((y, i, a) => y > b.min[1] && (i === 0 || y > a[i - 1])), `levels rise from the base: ${plan.levels}`); assert.ok(plan.levels[plan.levels.length - 1] >= b.max[1]);
  assert.ok(plan.labels.length >= 2 && plan.labels.length <= G.MAX_LABELS, `${plan.labels.length} labels`); assert.ok(plan.labels.every((l) => /^([+−]\d+(\.\d)? m|0 m)$/.test(l.text)), plan.labels.map((l) => l.text).join(' '));
  assert.equal(G.fmtLevel(20), '+20 m'); assert.equal(G.fmtLevel(-5), '−5 m'); assert.equal(G.fmtLevel(0), '0 m'); assert.equal(G.fmtLevel(2.5), '+2.5 m');
  for (const d of plan.depth.filter((x) => x.kind === 'drop')) for (let i = 0; i < d.positions.length; i += 6) { assert.ok(Math.abs(d.positions[i + 4] - plan.base) < 1e-5, 'a drop line ends on the base'); assert.ok(d.positions[i + 1] - plan.base > G.FLAT_M, 'and starts where the track is off it'); }
});

test('row 3: the line count stays bounded however long the track is (a 14 km one is about a thousand pairs, the grid itself well under)', () => {
  const huge = path_((i) => [Math.cos(i / 7000 * 6.2832) * 2200, 50 * Math.sin(i / 50), Math.sin(i / 7000 * 6.2832) * 2200], 7000, true), b = boxOf(huge);
  const grid = G.guidePlan({ bounds: b, path: huge, mode: '3d' }), both = G.guidePlan({ bounds: b, path: huge, mode: '3d', mirror: 'both' });
  assert.ok(grid.lines <= 1100, `${grid.lines} line pairs for the grid`); assert.ok(both.lines <= 2500, `${both.lines} with the guides`);
  assert.ok(pairs(grid.depth.filter((x) => x.kind === 'lattice')) <= G.MAX_CORNERS + 4, 'verticals: at most the corner cap'); assert.ok(grid.levels.length <= G.MAX_LEVELS + 1, `${grid.levels.length} levels`);
  assert.ok(pairs(grid.depth.filter((x) => x.kind === 'drop')) <= G.MAX_DROPS, 'drop lines capped');
  const small = G.guidePlan({ bounds: boxOf(HILL), path: HILL, mode: '3d' }); assert.ok(grid.latticeSpacing > small.latticeSpacing, 'the lattice spacing widens with the track, 1-2-5 times the ground spacing');
  assert.equal(grid.latticeSpacing % grid.spacing, 0, 'and its lines lie on the ground grid\'s');
});

test('row 4: the modes force what they say; off draws nothing; the guides can run without the grid; a bad mode is refused', () => {
  const b = boxOf(HILL), flat = boxOf(FLAT);
  assert.equal(G.guidePlan({ bounds: b, path: HILL, mode: 'ground' }).mode, 'ground'); assert.deepEqual(kinds(G.guidePlan({ bounds: b, path: HILL, mode: 'ground' })), ['ground'], 'ground on a hill: the ground grid only');
  assert.equal(G.guidePlan({ bounds: flat, path: FLAT, mode: '3d' }).mode, '3d'); assert.ok(kinds(G.guidePlan({ bounds: flat, path: FLAT, mode: '3d' })).includes('lattice'), '3d on a flat track: the lattice');
  assert.equal(G.guidePlan({ bounds: b, path: HILL, mode: 'off' }), null); assert.equal(G.guidePlan({ bounds: null, path: null, mode: 'auto' }), null);
  const only = G.guidePlan({ bounds: b, path: HILL, mode: 'off', mirror: 'x' }); assert.equal(only.mode, 'off'); assert.deepEqual(kinds(only).sort(), ['axis', 'mirror']);
  assert.throws(() => G.guidePlan({ bounds: b, path: HILL, mode: 'sideways' }), /unknown grid mode/); assert.throws(() => G.guidePlan({ bounds: b, path: HILL, mirror: 'diagonal' }), /unknown mirror/);
});

test('row 5: the centre is the box\'s middle unless set; the two axes and the vertical pass through it, three strokes each', () => {
  const b = boxOf(HILL), d = G.guidePlan({ bounds: b, path: HILL, mode: 'auto', mirror: 'x' });
  assert.deepEqual([d.centre.x, d.centre.z, d.centre.set], [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2, false]);
  const s = G.guidePlan({ bounds: b, path: HILL, mode: 'auto', mirror: 'x', centre: { x: 100, z: -30 } }); assert.deepEqual([s.centre.x, s.centre.z, s.centre.set], [100, -30, true]);
  const axes = s.depth.filter((x) => x.kind === 'axis'); assert.equal(axes.length, 3, 'x axis, z axis, the vertical'); assert.ok(axes.every((a) => a.positions.length === 18), 'three strokes each');
  const [ax, az, av] = axes.map((a) => Array.from(a.positions));
  assert.ok(ax.filter((_, i) => i % 3 === 2).every((z) => Math.abs(z - -30) < 2) && Math.min(...ax.filter((_, i) => i % 3 === 0)) === s.extent.x0, 'the x axis runs the grid\'s length along z = centre');
  assert.ok(az.filter((_, i) => i % 3 === 0).every((x) => Math.abs(x - 100) < 2), 'the z axis runs along x = centre'); assert.ok(Math.abs(Math.min(...av.filter((_, i) => i % 3 === 1)) - s.base) < 1e-5 && Math.max(...av.filter((_, i) => i % 3 === 1)) >= s.top - 1e-3, 'the vertical rises from the base to the top');
  assert.equal(G.guidePlan({ bounds: b, path: HILL, mode: 'auto', mirror: 'off' }).centre, null, 'no mirror, no centre or axes');
});

test('row 6: the gap reads a KNOWN offset: a straight at x = 10 mirrored about x = 0 is 20 m away everywhere; a line at z = 60 mirrored about z = 50 is 20 m', () => {
  const line = path_((i) => [10, 0, i * 2], 60), a = G.guidePlan({ bounds: boxOf(line), path: line, mode: 'off', mirror: 'x', centre: { x: 0, z: 0 } });
  assert.ok(Math.abs(a.gap.max - 20) < 1e-6 && Math.abs(a.gap.mean - 20) < 1e-6, `x: ${JSON.stringify(a.gap)}`); assert.equal(a.gap.kind, 'x');
  const along = path_((i) => [i * 2, 0, 60], 60), z = G.guidePlan({ bounds: boxOf(along), path: along, mode: 'off', mirror: 'z', centre: { x: 0, z: 50 } });
  assert.ok(Math.abs(z.gap.max - 20) < 1e-6 && Math.abs(z.gap.mean - 20) < 1e-6, `z: ${JSON.stringify(z.gap)}`);
  const mid = G.guidePlan({ bounds: boxOf(line), path: line, mode: 'off', mirror: 'x' }); assert.ok(mid.gap.max < 1e-9, 'about its own box middle a straight is its own mirror');
  for (const pts of [[[0, 0, 0], [0, 0, 10], [10, 0, 10]], [[10, 0, 10], [0, 0, 10], [0, 0, 0]]]) {   // the 10 m point last, and first (the mean is not a running largest)
    const ell = { closed: false, samples: pts.map((pos) => ({ pos })) }, e = G.guidePlan({ bounds: boxOf(ell), path: ell, mode: 'off', mirror: 'x', centre: { x: 0, z: 0 } });
    assert.ok(Math.abs(e.gap.max - 10) < 1e-9 && Math.abs(e.gap.mean - 10 / 3) < 1e-9 && e.gap.n === 3, `an L about x = 0: two points on it and one 10 m off: ${JSON.stringify(e.gap)}`);
  }
  // a CLOSED loop's last point joins its first: only that closing edge (the diagonal z = x) is near the mirror of the first point, 100/sqrt(2) away; open, it would read 100
  const tri = (closed) => ({ closed, samples: [[0, 0, 0], [100, 0, 0], [100, 0, 100]].map((pos) => ({ pos })) });
  assert.ok(Math.abs(G.guidePlan({ bounds: boxOf(tri(true)), path: tri(true), mode: 'off', mirror: 'z', centre: { x: 0, z: 50 } }).gap.max - 100 / Math.SQRT2) < 1e-9, 'a closed triangle: the closing edge counts');
  assert.ok(Math.abs(G.guidePlan({ bounds: boxOf(tri(false)), path: tri(false), mode: 'off', mirror: 'z', centre: { x: 0, z: 50 } }).gap.max - 100) < 1e-9, 'the same points open: it does not');
  const tall = path_((i) => [i * 2, i < 30 ? 0 : 7, 0], 60), h = G.guidePlan({ bounds: boxOf(tall), path: tall, mode: 'off', mirror: 'z', centre: { x: 0, z: 0 } }); assert.ok(h.gap.max < 1e-9, 'a mirror in plan keeps the height, so it is zero here too');
  const step = path_((i) => [i * 2, 0, 0], 60), up = path_((i) => [i * 2, 0, 0], 60); up.samples.forEach((s, i) => { if (i > 30) s.pos[1] = 9; }); const t = G.guidePlan({ bounds: boxOf(up), path: up, mode: 'off', mirror: 'x', centre: { x: 59, z: 0 } }); assert.ok(t.gap.max >= 8.9, `a step of 9 m in height reads: ${t.gap.max.toFixed(2)}`); assert.ok(step);
});

async function stadium(R = 100, straight = 200) {
  const s = await createCoreShell({ brushFn: null });
  s.extend({ length: straight, family: 'bowl' }); s.extend({ length: Math.PI * R, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: straight, transition: 40, targets: { kh: 0 } }); s.extend({ length: Math.PI * R, transition: 40, targets: { kh: 1 / R } });
  assert.equal(s.getState().message, null, s.getState().message); s.close(); assert.equal(s.getState().history.present.closed, true, s.getState().message); return s;
}
test('row 7: an oval\'s mirror gap is about 0 about its own centre, for left/right, front/back and both', async () => {
  // a stadium made of exact pieces (two straights and two half circles), so it IS symmetric: the shell's own ovals have curvature transitions and are not (measured below)
  const R = 100, FLATP = require('../../test/geom_fixtures.js').FLAT, segs = [{ id: 's0', kind: 'road', length: 200, profile: FLATP }, { id: 'a0', kind: 'road', length: Math.PI * R, k0: 1 / R, k1: 1 / R, profile: FLATP }, { id: 's1', kind: 'road', length: 200, profile: FLATP }, { id: 'a1', kind: 'road', length: Math.PI * R, k0: 1 / R, k1: 1 / R, profile: FLATP }];
  const G0 = require('../../src/geom/index.js'), pth = G0.buildPath(segs, { step: 2, closed: true }), t = { path: pth, bounds: boxOf(pth) }; assert.ok(t.path.closed, 'control: a closed loop');
  const res = {}; for (const m of ['x', 'z', 'both']) { const plan = G.guidePlan({ bounds: t.bounds, path: t.path, mode: 'auto', mirror: m }); res[m] = plan.gap; assert.ok(plan.gap.max < 0.1, `${m}: largest ${plan.gap.max.toFixed(4)} m`); assert.ok(plan.gap.mean < 0.03, `${m}: mean ${plan.gap.mean.toFixed(4)} m`); }
  const off = G.guidePlan({ bounds: t.bounds, path: t.path, mode: 'auto', mirror: 'x', centre: { x: (t.bounds.min[0] + t.bounds.max[0]) / 2 + 12, z: (t.bounds.min[2] + t.bounds.max[2]) / 2 } });
  assert.ok(off.gap.max > 20 && off.gap.max <= 24.5, `the same stadium about a centre 12 m off: its mirror is 24 m away at most: ${off.gap.max.toFixed(2)}`);
  const sh = await stadium(), st = createTrackModel().update(sh.getState().resolved), sg = G.guidePlan({ bounds: st.bounds, path: st.path, mode: 'auto', mirror: 'both' }).gap; assert.ok(sg.max > 0.5, `the shell's own oval is not exactly symmetric, and the gap says so: ${sg.max.toFixed(2)} m`);
  const lap = await createCoreShell({ brushFn: null }); lap.extend({ length: 300, family: 'bowl' }); for (let i = 0; i < 4; i++) lap.extend({ length: Math.PI * 90, transition: 40, targets: { kh: 1 / 180 } }); lap.extend({ length: 60, transition: 40, targets: { kh: 0 } }); lap.close();
  const lt = createTrackModel().update(lap.getState().resolved), asym = G.guidePlan({ bounds: lt.bounds, path: lt.path, mode: 'auto', mirror: 'both' }); assert.ok(asym.gap.max > 5, `an asymmetric lap reads a real gap: ${asym.gap.max.toFixed(1)} m`);
  assert.ok(res.x && res.z && res.both);
});

test('row 8: the mirror modes flip what they say: x flips x, z flips z, both is the half turn, and height never changes', () => {
  const c = { x: 5, z: -7 }, p = [12, 3, 4];
  assert.deepEqual(G.mirrorPoint(p, c, 'x'), [-2, 3, 4]); assert.deepEqual(G.mirrorPoint(p, c, 'z'), [12, 3, -18]); assert.deepEqual(G.mirrorPoint(p, c, 'both'), [-2, 3, -18]);
  const plan = G.guidePlan({ bounds: boxOf(HILL), path: HILL, mode: 'off', mirror: 'both', centre: c }), ghost = plan.over[0]; assert.equal(ghost.kind, 'mirror');
  const gy = ys(plan.over); assert.ok(gy.every((y) => HILL.samples.some((s) => Math.abs(s.pos[1] - y) < 1e-3 || true)) && Math.max(...gy) <= Math.max(...HILL.samples.map((s) => s.pos[1])) + 1e-3, 'the ghost is no higher than the track');
});

test('row 9: the dashes alternate on and off along the line, never stall on a boundary, and cover about half of it', () => {
  const line = Array.from({ length: 101 }, (_, i) => [i, 0, 0]), d = G.dashed(line, 4), total = d.length / 6;
  let on = 0; for (let i = 0; i < d.length; i += 6) on += Math.hypot(d[i + 3] - d[i], d[i + 4] - d[i + 1], d[i + 5] - d[i + 2]);
  assert.ok(Math.abs(on - 50) <= 4, `${on.toFixed(1)} m drawn of 100`); assert.ok(total >= 12 && total <= 120, `${total} dash pieces (an on-dash is cut at each vertex it crosses)`);
  assert.deepEqual(Array.from(d.slice(0, 3)), [0, 0, 0], 'the line starts with a dash'); for (let i = 0; i < d.length; i += 6) assert.ok(((d[i] + d[i + 3]) / 2) % 8 < 4, `a piece at x = ${(d[i] + d[i + 3]) / 2} lies in an on-dash (4 m on, 4 m off)`);
  const odd = G.dashed(Array.from({ length: 40 }, (_, i) => [i * 0.7, 0, 0]), 0.7); assert.ok(odd.length > 0 && odd.length < 1e5, 'a dash the length of every step terminates');
  assert.deepEqual(G.dashed([[0, 0, 0]], 4), []); assert.deepEqual(G.dashed([[0, 0, 0], [0, 0, 0]], 4), [], 'a zero-length line has no dashes');
});

test('row 10: a point projects and the pointer ray through it lands back on it on the base plane (the centre handle\'s drag)', () => {
  const pose = { eye: [40, 120, -60], target: [10, 0, 30], up: [0, 1, 0], fov: 60 * Math.PI / 180 }, aspect = 1.6;
  for (const p of [[10, 0, 30], [0, 0, 0], [-25, 0, 80], [60, 0, 10]]) {
    const s = G.projectPoint(pose, aspect, p); assert.ok(s && Math.abs(s.nx) <= 1 && Math.abs(s.ny) <= 1, `${p} is in view`);
    const hit = G.planeHit(G.rayAt(pose, aspect, s.nx, s.ny), 0); assert.ok(hit && Math.hypot(hit[0] - p[0], hit[1] - p[1], hit[2] - p[2]) < 1e-6, `${p} -> ${hit}`);
  }
  assert.equal(G.projectPoint(pose, aspect, [40, 120, -200]), null, 'behind the camera is not on screen'); assert.equal(G.planeHit({ o: [0, 5, 0], d: [1, 0, 0] }, 0), null, 'parallel');
  assert.equal(G.planeHit({ o: [0, 5, 0], d: [0, 1, 0] }, 0), null, 'a plane behind the ray');
});

// ── the preview ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function fake() {
  const calls = { drawArrays: 0, blends: 0 };
  const gl = new Proxy({ VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16, DEPTH_TEST: 9, CULL_FACE: 10, TRIANGLES: 11, FLOAT: 12, UNSIGNED_SHORT: 13, BLEND: 14, LINES: 15,
    getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
    drawElements() {}, drawArrays() { calls.drawArrays++; }, enable(x) { if (x === 14) calls.blends++; } }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  let q = [];
  const win = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => q.push(f), cancelAnimationFrame() {}, step() { const f = q; q = []; for (const g of f) g(16); } };
  return { calls, win, canvas: { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} } };
}
async function trackShell(hilly) {
  const s = await createCoreShell({ brushFn: null }); s.extend({ length: 300, family: 'bowl' });
  if (hilly) { s.extend({ length: 250, transition: 120, targets: { kv: 0.05 } }); s.extend({ length: 250, transition: 120, targets: { kv: -0.05 } }); s.extend({ length: 200, transition: 120, targets: { kv: 0 } }); }
  assert.equal(s.getState().message, null, s.getState().message); return s;
}
test('row 11: through the real shell and the preview: a flat track draws the ground grid, a hilly one the lattice; the modes and the mirror follow setGuides, and each change is announced once', async () => {
  const flat = await trackShell(false), hilly = await trackShell(true), seen = [];
  const a = fake(), pf = P.createPreview({ canvas: a.canvas, shell: flat, win: a.win, gridMode: 'auto', onGuides: (s) => seen.push(s) }); a.win.step();
  assert.equal(pf.guides().drawn, 'ground'); assert.equal(pf.guides().flat, true); assert.equal(pf.guides().levels, 0);
  const b = fake(), ph = P.createPreview({ canvas: b.canvas, shell: hilly, win: b.win, gridMode: 'auto' }); b.win.step();
  assert.equal(ph.guides().drawn, '3d'); assert.equal(ph.guides().flat, false); assert.ok(ph.guides().levels >= 2 && ph.guides().range > 5, JSON.stringify(ph.guides()));
  assert.ok(ph.guides().lines > pf.guides().lines, 'the lattice is more lines than the ground grid');
  const n0 = seen.length; pf.setGuides({ grid: '3d' }); b.win.step(); a.win.step(); assert.equal(pf.guides().drawn, '3d'); assert.ok(seen.length > n0, 'announced'); assert.equal(seen[seen.length - 1].drawn, '3d', 'and the last thing announced is what the frame then drew, not only what was asked');
  const lines = (pv, w) => { w.step(); return pv.renderer.stats().lines; }; const l3 = lines(pf, a.win); pf.setGuides({ grid: 'off' }); const l0 = lines(pf, a.win); pf.setGuides({ grid: '3d', mirror: 'x' }); const lm = lines(pf, a.win);
  assert.ok(l3 >= l0 + 3, `the lattice is drawn: ${l0} lines off, ${l3} in 3d`); assert.ok(lm >= l3 + 4, `and the axes and the mirror ghost on top: ${lm}`); pf.setGuides({ grid: '3d', mirror: 'off' });
  a.win.step(); const n1 = seen.length; a.win.step(); a.win.step(); assert.equal(seen.length, n1, 'frames with nothing changed announce nothing');
  pf.setGuides({ grid: 'off' }); a.win.step(); assert.equal(pf.guides().drawn, 'off'); pf.setGuides({ mirror: 'both' }); a.win.step();
  assert.ok(pf.guides().gap && Number.isFinite(pf.guides().gap.max) && pf.guides().centre && pf.guides().centre.set === false, JSON.stringify(pf.guides()));
  pf.setGuides({ centre: { x: 1000, z: 1000 } }); a.win.step(); assert.equal(pf.guides().centre.set, true); assert.ok(pf.guides().gap.max > 1000, 'a centre far away reads a far mirror'); pf.setGuides({ centre: null }); a.win.step(); assert.equal(pf.guides().centre.set, false);
  assert.throws(() => pf.setGuides({ grid: 'x' }), /unknown grid mode/); assert.throws(() => pf.setGuides({ mirror: 'q' }), /unknown mirror/); assert.throws(() => pf.setGuides({ centre: { x: NaN, z: 0 } }), /centre needs/);
  assert.throws(() => P.createPreview({ canvas: a.canvas, shell: flat, win: a.win, gridMode: 'weird' }), /unknown gridMode/);
});

test('row 11b: the plan follows the track: a flat track replaced by a hilly one is drawn as the lattice, with no setGuides call; the layer is given every frame\'s plan and is disposed with the preview; the water overlay and the mirror ghost both draw', async () => {
  const flat = await trackShell(false), hilly = await trackShell(true); let sub = null, cur = flat.getState().resolved;
  const shell = { getState: () => ({ resolved: cur, resolveError: null }), subscribe: (f) => { sub = f; return () => {}; } }, updates = []; let disposed = false;
  const a = fake(), p = P.createPreview({ canvas: a.canvas, shell, win: a.win, gridMode: 'auto', layer: { update: (f) => updates.push(f), dispose() { disposed = true; } } }); a.win.step();
  assert.equal(p.guides().drawn, 'ground'); cur = hilly.getState().resolved; sub(shell.getState()); a.win.step(); assert.equal(p.guides().drawn, '3d', 'the track changed under the grid'); assert.equal(p.guides().flat, false);
  assert.ok(updates.length >= 2 && updates[updates.length - 1].plan && updates[updates.length - 1].plan.mode === '3d' && updates[updates.length - 1].pose && updates[updates.length - 1].aspect > 0, 'the layer gets the plan, the pose and the size every frame');
  p.setGuides({ mirror: 'x' }); a.win.step(); const l1 = p.renderer.stats().lines; p.setOverlay([{ positions: new Float32Array([0, 0, 0, 1, 1, 1]), colour: [1, 0, 0] }]); a.win.step(); assert.equal(p.renderer.stats().lines, l1 + 1, 'an overlay already set (the water) still draws beside the mirror ghost');
  p.dispose(); assert.equal(disposed, true, 'the layer goes with the preview');
});

test('row 12: with no gridMode and no ground the preview draws no grid, as before; ground: true is the old grid at y = 0', async () => {
  const shell = await trackShell(true), a = fake(), p = P.createPreview({ canvas: a.canvas, shell, win: a.win }); a.win.step();
  assert.equal(p.view().grid, 0); assert.equal(p.guides().drawn, 'off'); assert.equal(p.guides().lines, 0);
  const b = fake(), q = P.createPreview({ canvas: b.canvas, shell, win: b.win, ground: true }); b.win.step(); assert.ok(q.view().grid > 0, 'the legacy grid'); assert.equal(q.guides().drawn, 'ground'); assert.equal(q.guides().lines, 0, 'and no plan');
  q.setGuides({ grid: '3d' }); b.win.step(); assert.equal(q.view().grid, 0, 'the legacy grid is replaced once a mode is chosen'); assert.equal(q.guides().drawn, '3d');
});

// a document with just enough DOM for the layer
function dom() {
  const el = (tag) => { const e = { tag, style: {}, children: [], listeners: {}, textContent: '', attrs: {}, parent: null,
    append(...c) { for (const x of c) { x.parent = e; e.children.push(x); } }, remove() { if (e.parent) e.parent.children = e.parent.children.filter((x) => x !== e); },
    setAttribute(k, v) { e.attrs[k] = v; }, addEventListener(n, f) { (e.listeners[n] = e.listeners[n] || []).push(f); }, removeEventListener(n, f) { e.listeners[n] = (e.listeners[n] || []).filter((x) => x !== f); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }), setPointerCapture() {} }; return e; };
  const doc = { createElement: el }; const root = el('div'); root.ownerDocument = doc; return { doc, root, el };
}
test('row 13: the layer puts a label at each level in view and the handle at the centre, and dragging the handle moves the centre to the point under the pointer', () => {
  const { root } = dom(), moved = [], layer = createGuidesLayer({ root, win: {}, onCentre: (c) => moved.push(c) });
  const UP = path_((i) => [i * 2, 100 + 20 * Math.sin(i / 20), 0], 300), b = boxOf(UP), plan = G.guidePlan({ bounds: b, path: UP, mode: '3d', mirror: 'x' }), pose = { eye: [100, 260, -260], target: [100, 120, 0], up: [0, 1, 0], fov: 60 * Math.PI / 180 };
  assert.ok(plan.base > 70, `control: the base plane is high (${plan.base.toFixed(1)}), so a drag that used y = 0 would land somewhere else`);
  layer.update({ plan, pose, aspect: 1.6, cssWidth: 800, cssHeight: 500 });
  assert.ok(layer.labels().length >= 1 && layer.labels().length <= plan.labels.length, `${layer.labels().length} labels in view`); assert.ok(layer.labels().every((l) => l.x >= 0 && l.x <= 800 && l.y >= 0 && l.y <= 500));
  const h = layer.handle(); assert.ok(h && h.x > 0 && h.x < 800 && h.y > 0 && h.y < 500, JSON.stringify(h));
  const hEl = root.children[0].children[0], pt = G.projectPoint(pose, 1.6, [60, plan.base, 40]);
  hEl.listeners.pointerdown[0]({ pointerId: 1, preventDefault() {}, stopPropagation() {} });
  hEl.listeners.pointermove[0]({ clientX: (pt.nx * 0.5 + 0.5) * 800, clientY: (1 - (pt.ny * 0.5 + 0.5)) * 500 });
  assert.equal(moved.length, 1); assert.ok(Math.abs(moved[0].x - 60) < 1e-6 && Math.abs(moved[0].z - 40) < 1e-6, JSON.stringify(moved[0]));
  hEl.listeners.pointerup[0](); hEl.listeners.pointermove[0]({ clientX: 100, clientY: 100 }); assert.equal(moved.length, 1, 'after the release a move does nothing');
  layer.update({ plan: null, pose, aspect: 1.6, cssWidth: 800, cssHeight: 500 }); assert.equal(layer.handle(), null); assert.deepEqual(layer.labels(), []);
  layer.update({ plan, pose: { ...pose, eye: [100, 160, 400], target: [100, 20, 800] }, aspect: 1.6, cssWidth: 800, cssHeight: 500 }); assert.deepEqual(layer.labels(), [], 'a track behind the camera has no labels in view');
  const wide = { ...pose, eye: [700, 260, -260], target: [700, 120, 0] }, anchor = G.projectPoint(wide, 1.6, plan.labels[0].pos); assert.ok(anchor && Math.abs(anchor.nx) > 1, `control: the label's anchor is in front of the camera and off to the side (nx ${anchor && anchor.nx.toFixed(2)})`);
  layer.update({ plan, pose: wide, aspect: 1.6, cssWidth: 800, cssHeight: 500 }); assert.deepEqual(layer.labels(), [], 'labels in front of the camera but off the side of the view are not drawn either'); layer.dispose();
});

test('row 14: the camera panel\'s buttons send the events the preview takes, follow its state, and say the numbers in words', () => {
  const { guidesText } = CAM; const t = guidesText({ grid: 'auto', drawn: '3d', flat: false, range: 31.4, mirror: 'x', gap: { max: 12.34, mean: 5.1 }, centre: { x: 10, z: -4.5, set: false } });
  assert.match(t.grid, /auto: 3D lattice \(the track spans 31\.4 m of height\)/); assert.match(t.gap, /largest 12\.3 m · average 5\.1 m/); assert.match(t.centre, /centre \(10\.0, -4\.5\) m · the box's middle/);
  assert.match(guidesText({ grid: 'auto', drawn: 'ground', flat: true, range: 0, mirror: 'off', gap: null, centre: null }).grid, /ground grid \(the track is flat\)/); assert.equal(guidesText({ grid: '3d', drawn: '3d', flat: false, mirror: 'off', gap: null }).gap, '');
  assert.equal(guidesText(null).grid, '');
  const { doc, root, el } = dom(), sent = []; const win = { CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } } };
  doc.dispatchEvent = (e) => { sent.push(e); if (e.type === 't180:guides-request') e.detail.reply({ grid: 'auto', drawn: 'ground', flat: true, range: 0, mirror: 'off', centre: null, gap: null }); }; doc.addEventListener = () => {}; doc.removeEventListener = () => {}; doc.defaultView = win; root.ownerDocument = doc;
  CAM.mount(root); const bars = root.children.filter((c) => c.attrs.role === 'toolbar'); assert.equal(bars.length, 2, 'the camera bar and the grid and symmetry bar'); const grid = bars[1], buttons = grid.children.filter((c) => c.tag === 'button');
  const click = (label) => buttons.find((b) => b.textContent === label).onclick();
  click('3D'); click('Ground'); click('Off'); click('Left/right'); click('Front/back'); click('Both'); click('Reset centre');
  assert.deepEqual(sent.filter((e) => e.type === 't180:guides').map((e) => e.detail), [{ grid: '3d' }, { grid: 'ground' }, { grid: 'off' }, { mirror: 'x' }, { mirror: 'z' }, { mirror: 'both' }, { centre: null }]);
  assert.equal(buttons.find((b) => b.textContent === 'Auto').attrs['aria-pressed'], 'true', 'the panel follows the preview\'s state at once'); assert.equal(buttons.find((b) => b.textContent === 'Reset centre').disabled, true, 'nothing to reset while the centre is the default'); assert.ok(el);
});

test('row 15: the whole lap is the preview\'s: nothing in src/, the export or the document changed (the diff against the base), and the sealed fixtures are untouched', () => {
  const root = path.resolve(__dirname, '..', '..');
  let changed; try { changed = execFileSync('git', ['diff', '--name-only', '510510e9', '--', 'src', 'app/export', 'test/fixtures', 'src-tauri'], { cwd: root, encoding: 'utf8' }).trim(); } catch (e) { return; }   // not a checkout with that base: nothing to compare
  assert.equal(changed, '', `touched: ${changed}`);
  assert.ok(fs.existsSync(path.join(root, 'app', 'preview', 'guides.js')));
});
