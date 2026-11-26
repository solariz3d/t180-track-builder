// reference_ribbon.test.js (L243): another track's AI line read into a road ribbon at true scale (src/reference/ribbon.js).
// A known file gives a known length and width. The files are built here with the builder's own encodeAiLine, so nothing of another author's
// track is in the repository; a grid is appended by hand, as every installed line on L carries one.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encodeAiLine, readAiLine, EXTRA } = require('../src/export/ailine.js');
const { readAiShape, ribbonOf, placeAt, moveOf, apply, RefTrackError } = require('../src/reference/ribbon.js');

/** A circle of radius R (m) in the ground plane, n points, run in the +phi direction: closed. side: { sideLeft, sideRight, camber, flatNormals }. */
function circleLine(R, n, side = {}) {
  const points = [], extra = [];
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const ph = (2 * Math.PI * k) / n, pos = [R * Math.cos(ph), 0, R * Math.sin(ph)];
    if (k > 0) { const q = points[k - 1].pos; acc += Math.hypot(pos[0] - q[0], pos[2] - q[2]); }
    points.push({ pos, length: acc, id: k });
    const e = {}; for (const f of EXTRA) e[f] = 0;
    Object.assign(e, { sideLeft: side.sideLeft ?? 4, sideRight: side.sideRight ?? 6, camber: side.camber ?? 0, ny: side.zeroNormals ? 0 : 1 });
    if (side.normalLean) Object.assign(e, { nx: Math.sin(side.normalLean) * Math.cos(ph), ny: Math.cos(side.normalLean), nz: Math.sin(side.normalLean) * Math.sin(ph) });   // leaned toward the left (outward)
    extra.push(e);
  }
  return { version: 7, points, extra };
}
/** The same line with a grid after it: hasGrid = 1 and some bytes, as AC writes. */
function withGrid(buf, gridBytes = 4096) {
  const g = Buffer.concat([buf.subarray(0, buf.length - 4), Buffer.alloc(4), Buffer.alloc(gridBytes, 7)]);
  g.writeInt32LE(1, buf.length - 4);
  return g;
}
const chordLoop = (R, n) => n * 2 * R * Math.sin(Math.PI / n);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);
const radiusAt = (arr, i) => Math.hypot(arr[i * 3], arr[i * 3 + 2]);

test('a line with a grid is refused by readAiLine and read by readAiShape', () => {
  const buf = withGrid(encodeAiLine(circleLine(200, 400)));
  assert.throws(() => readAiLine(buf), /HAS_GRID/);
  const s = readAiShape(buf);
  assert.strictEqual(s.n, 400); assert.strictEqual(s.hasGrid, 1); assert.strictEqual(s.gridBytes, 4096);
});

test('a known circle gives its length and its width', () => {
  const r = ribbonOf(readAiShape(withGrid(encodeAiLine(circleLine(200, 400)))));
  assert.strictEqual(r.closed, true);
  near(r.lengthM, chordLoop(200, 400), 0.01, 'the loop length, m');
  near(r.width.median, 10, 1e-4, 'the width, m'); near(r.width.min, 10, 1e-4, 'the least width'); near(r.width.max, 10, 1e-4, 'the most width');
});

test('sideLeft goes to the left of the way the line runs, sideRight to the right', () => {
  // run in +phi, left (up x forward) points away from the centre: the left edge is at R + sideLeft, the right at R - sideRight
  const r = ribbonOf(readAiShape(encodeAiLine(circleLine(200, 400, { sideLeft: 4, sideRight: 6 }))));
  const P = r.batches[0].positions;
  for (const j of [0, 57, 399]) { near(radiusAt(P, j * 2), 204, 0.01, `left edge radius at ${j}`); near(radiusAt(P, j * 2 + 1), 194, 0.01, `right edge radius at ${j}`); }
});

test('with no stored normal the camber leans the road: a + camber rises to the right', () => {
  const r = ribbonOf(readAiShape(encodeAiLine(circleLine(200, 400, { camber: 0.3, zeroNormals: true }))));
  const P = r.batches[0].positions;
  assert.ok(P[1] < -0.5, `the left edge is below the line (y ${P[1]})`);
  assert.ok(P[4] > 0.5, `the right edge is above it (y ${P[4]})`);
  near(Math.hypot(P[0] - 200, P[1], P[2]), 4, 1e-3, 'the left side is still 4 m along the surface');
});

test('a stored normal leans the road even with no camber', () => {
  const P = ribbonOf(readAiShape(encodeAiLine(circleLine(200, 400, { normalLean: 0.3 })))).batches[0].positions;
  assert.ok(P[1] < -0.5, `the left edge is below the line (y ${P[1]})`);
  assert.ok(P[4] > 0.5, `the right edge is above it (y ${P[4]})`);
});

test('with no normal and no camber the road is flat', () => {
  const P = ribbonOf(readAiShape(encodeAiLine(circleLine(200, 400, { zeroNormals: true })))).batches[0].positions;
  near(P[1], 0, 1e-6, 'left edge height'); near(P[4], 0, 1e-6, 'right edge height');
});

test('an open line is not closed, and its length has no closing span', () => {
  const line = circleLine(200, 400); line.points = line.points.slice(0, 200); line.extra = line.extra.slice(0, 200); line.open = true;
  const r = ribbonOf(readAiShape(encodeAiLine(line)));
  assert.strictEqual(r.closed, false);
  near(r.lengthM, (199 / 400) * chordLoop(200, 400), 0.01, 'the open length');
  assert.strictEqual(r.batches[0].indices.length, 199 * 6);
});

test('a long line is split into batches whose indices fit Uint16, covering every span once', () => {
  const r = ribbonOf(readAiShape(encodeAiLine(circleLine(2000, 1000))), { batchPoints: 300 });
  assert.strictEqual(r.batches.length, 4);
  let tris = 0;
  for (const b of r.batches) {
    assert.ok(b.positions.length / 3 <= 65535); assert.ok(Math.max(...b.indices) < b.positions.length / 3);
    for (let i = 0; i < b.indices.length; i += 3) { const [x, y, z] = [b.indices[i], b.indices[i + 1], b.indices[i + 2]]; if (x !== y && y !== z && x !== z) tris++; }   // real triangles, not empty slots
  }
  assert.strictEqual(tris, 1000 * 2, 'two triangles a span, the closing span too');
});

test('placed, the reference starts at the anchor, faces its way, and keeps its scale', () => {
  const r = ribbonOf(readAiShape(encodeAiLine(circleLine(200, 400))));
  const anchor = { pos: [10, 5, -30], T: [1, 0, 0] };
  const M = placeAt(r, anchor), m = moveOf(r, M);
  for (let i = 0; i < 3; i++) near(m.pos[i], anchor.pos[i], 1e-9, `start ${i}`);
  near(m.T[0], 1, 1e-9, 'forward x'); near(m.T[2], 0, 1e-9, 'forward z');
  const P = r.batches[0].positions, a = apply(M, [P[0], P[1], P[2]]), b = apply(M, [P[3], P[4], P[5]]);
  near(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), 10, 1e-4, 'the width after placing');
});

test('a nudge moves and turns it, and never scales it', () => {
  const r = ribbonOf(readAiShape(encodeAiLine(circleLine(200, 400))));
  const anchor = { pos: [0, 0, 0], T: [0, 0, 1] }, left = [1, 0, 0];   // up x (0, 0, 1)
  const m = moveOf(r, placeAt(r, anchor, { dx: 3, dz: -2, yawDeg: 90 }));
  near(m.pos[0], 3, 1e-9, 'moved x'); near(m.pos[2], -2, 1e-9, 'moved z');
  near(m.T[0], left[0], 1e-9, 'a +90 yaw turns the forward to the left (x)'); near(m.T[2], left[2], 1e-9, 'a +90 yaw turns the forward to the left (z)');
  const M = placeAt(r, anchor, { yawDeg: 37 });
  near(Math.hypot(M[0], M[1], M[2]), 1, 1e-12, 'no scale on x'); near(Math.hypot(M[8], M[9], M[10]), 1, 1e-12, 'no scale on z');
});

test('refuses what it cannot read, by name', () => {
  const good = encodeAiLine(circleLine(200, 50));
  const code = (b) => { try { readAiShape(b); return 'read'; } catch (e) { assert.ok(e instanceof RefTrackError, e.message); return e.code; } };
  assert.strictEqual(code(Buffer.alloc(12)), 'TRUNCATED');
  assert.strictEqual(code(good.subarray(0, good.length - 10)), 'TRUNCATED');
  const v = Buffer.from(good); v.writeInt32LE(6, 0); assert.strictEqual(code(v), 'BAD_VERSION');
  const x = Buffer.from(good); x.writeInt32LE(49, 16 + 50 * 20); assert.strictEqual(code(x), 'BAD_EXTRA');
  assert.strictEqual(code(Buffer.concat([good, Buffer.alloc(8)])), 'TRAILING');
  assert.strictEqual(code(good), 'read');
});
