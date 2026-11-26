// reference_ribbon.test.js (L243; L250 rows at the end): another track's AI line read into a road ribbon at true scale (src/reference/ribbon.js).
// A known file gives a known length and width. The files are built here with the builder's own encodeAiLine, so nothing of another author's
// track is in the repository; a grid is appended by hand, as every installed line on L carries one.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encodeAiLine, readAiLine, EXTRA } = require('../src/export/ailine.js');
const { readAiShape, ribbonOf, placeAt, moveOf, apply, RefTrackError, refusalWords, sameLine, uiLengthM, lineNotes } = require('../src/reference/ribbon.js');

/** A circle of radius R (m) in the ground plane, n points, run in the +phi direction: closed. side: { sideLeft, sideRight, camber, flatNormals, y (its height) }. */
function circleLine(R, n, side = {}) {
  const points = [], extra = [];
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const ph = (2 * Math.PI * k) / n, pos = [R * Math.cos(ph), side.y ?? 0, R * Math.sin(ph)];
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

// ── L250: the panel's words, borrowed lines, open lines ──

test('L250: the two kinds of line that do not read on L are refused in words, never drawn in part', () => {
  const stub = Buffer.alloc(12); stub.writeInt32LE(3, 0);   // a 12-byte stub: version 3, 0 points
  const good = encodeAiLine(circleLine(200, 50)), short = good.subarray(0, good.length - 8);   // 8 bytes short of its points
  for (const [b, why] of [[stub, /cut short \(12 bytes/], [short, /cut short \(50 points need/]]) {
    let err = null; try { readAiShape(b); } catch (e) { err = e; }
    assert.ok(err, 'refused');
    const w = refusalWords(err);
    assert.match(w, /^Not drawn: its AI line is cut short/); assert.match(w, why); assert.match(w, /never drawn in part\.$/);
    assert.doesNotMatch(w, /TRUNCATED/, 'the code is not shown, its words are');
  }
  assert.strictEqual(refusalWords('the AI line says it has 0 points'), 'Not drawn: the AI line says it has 0 points. What does not read whole is never drawn in part.', 'the native side\'s own words pass through');
});

test('L250: an open line draws open: no span and no edge joins its last point to its first; a lap whose ends are 2 spacings apart is closed', () => {
  const line = circleLine(200, 400); line.points = line.points.slice(0, 300); line.extra = line.extra.slice(0, 300); line.open = true;
  const r = ribbonOf(readAiShape(encodeAiLine(line)));
  assert.strictEqual(r.closed, false);
  const E = r.edges, first = [r.batches[0].positions[0], r.batches[0].positions[2]];
  assert.strictEqual(E.length, 299 * 12, 'one edge pair a span, 299 spans');
  for (let i = 0; i < E.length; i += 6) assert.ok(!(Math.hypot(E[i + 3] - first[0], E[i + 5] - first[1]) < 1e-3), `edge ${i / 6} does not run back to the start`);
  // closed lines on L close within 0.5 to 1.1 point spacings, open ones are 1,536 or more apart (L250 survey)
  const lap = circleLine(200, 400); lap.points.pop(); lap.extra.pop();   // the last point is 2 spacings from the first: closed
  assert.strictEqual(ribbonOf(readAiShape(encodeAiLine(lap))).closed, true);
});

test('L250: sameLine tells the same line, the same points with other widths, and another line apart', () => {
  const shape = (o) => readAiShape(encodeAiLine(circleLine(200, 120, o)));
  const a = shape({}), b = shape({}), wider = shape({ sideLeft: 5 }), moved = shape({});
  moved.points[60].pos[0] += 0.02;
  assert.deepStrictEqual(sameLine(a, b), { samePoints: true, sameSides: true });
  assert.deepStrictEqual(sameLine(a, wider), { samePoints: true, sameSides: false });
  assert.deepStrictEqual(sameLine(a, moved), { samePoints: false, sameSides: false }, 'one point 2 cm off is another line');
  assert.deepStrictEqual(sameLine(a, readAiShape(encodeAiLine(circleLine(200, 121)))), { samePoints: false, sameSides: false }, 'another point count');
});

test('L250: a layout\'s stated length is read in metres, and a line more than 5 % off it is said so', () => {
  for (const [s, m] of [['5793', 5793], ['5793m', 5793], ['10.3km', 10300], ['3.602', 3602], ['2,469 m', 2469], ['', null], ['long', null], [null, null]]) assert.strictEqual(uiLengthM(s), m, String(s));
  assert.deepStrictEqual(lineNotes({ lengthM: 5755, uiM: 5793 }), [], 'within 5 %: nothing to say');
  const off = lineNotes({ lengthM: 2944, uiM: 3619 });
  assert.strictEqual(off.length, 1); assert.match(off[0], /2,944 m; the layout says 3,619 m \(−18\.7 %\)/);
  const n = lineNotes({ lengthM: 2469, uiM: 200, same: ['“a”', '“b”', '“c”'], samePath: ['“d”'] });
  assert.strictEqual(n.length, 3);
  assert.match(n[0], /the same AI line as “a”, “b” and “c”/); assert.match(n[1], /the same points as “d”, with widths of its own/); assert.match(n[2], /\+1134\.5 %/);
});

// ── L250: the road from the kn5, as the native side sends it (src/reference/road.js) ──
const { decodeRoad, encodeRoad, roadReference } = require('../src/reference/road.js');
/** A ring of road of radius r, w wide, n quads, as one batch (the winding left mixed on purpose: a kn5's is not ours to trust). */
function ringRoad(r, w, n, phase = 0) {   // phase: its quads turned by that many, so angle 0 is inside one and not on a seam
  const pos = [], idx = [];
  for (let k = 0; k <= n; k++) { const ph = (2 * Math.PI * (k + phase)) / n; pos.push((r + w / 2) * Math.cos(ph), 0, (r + w / 2) * Math.sin(ph), (r - w / 2) * Math.cos(ph), 0, (r - w / 2) * Math.sin(ph)); }
  for (let k = 0; k < n; k++) { const a = 2 * k; if (k % 2) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  return { positions: new Float32Array(pos), indices: new Uint16Array(idx) };
}

test('L250: a road from the kn5 reads back exactly, its normals face up, and its triangles are counted', () => {
  const a = ringRoad(200, 10, 300), b = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: new Uint16Array([0, 1, 2]) };   // an odd index count: padded
  const road = decodeRoad(encodeRoad([a, b], { files: 3, missing: 1, surfaces: 'layout' }).buffer);
  assert.strictEqual(road.batches.length, 2); assert.strictEqual(road.triangles, 601); assert.strictEqual(road.vertices, 605);
  assert.deepStrictEqual([road.meta.files, road.meta.missing, road.meta.surfaces, road.meta.triangles], [3, 1, 'layout', 601], 'the header (kn5road.rs encode) reads back');
  assert.deepStrictEqual(Array.from(road.batches[0].positions), Array.from(a.positions)); assert.deepStrictEqual(Array.from(road.batches[1].indices), [0, 1, 2]);
  for (const bt of road.batches) for (let k = 1; k < bt.normals.length; k += 3) near(bt.normals[k], 1, 1e-6, 'a flat road\'s normal is straight up, whatever its winding');
});

test('L250: road bytes that do not read whole are refused by name, in words, and never drawn in part', () => {
  const good = Buffer.from(encodeRoad([ringRoad(200, 10, 30)]));
  const code = (b) => { try { decodeRoad(b); return 'read'; } catch (e) { assert.ok(e instanceof RefTrackError, e.message); return `${e.code}: ${refusalWords(e)}`; } };
  assert.strictEqual(code(good), 'read');
  assert.match(code(good.subarray(0, good.length - 1)), /^BAD_ROAD: Not drawn: its road from the kn5 did not come back whole \(it ends at \d+ bytes; batch 0 needs \d+\)\. What does not read whole is never drawn in part\.$/);
  assert.match(code(Buffer.concat([good, Buffer.alloc(4)])), /^BAD_ROAD: .*\(4 bytes after the last batch\)/);
  const past = Buffer.from(good); past.writeUInt16LE(62, past.length - 2); assert.match(code(past), /^BAD_ROAD: .*index \d+ is 62, past its 62 vertices/, 'an index past its vertices');
  const h = 20 + good.readUInt32LE(12);   // batch 0 starts after "T180ROAD", the format, J, the JSON and the batch count
  const odd = Buffer.from(good); odd.writeUInt32LE(179, h + 4); assert.match(code(odd), /^BAD_ROAD: .*179 indices/, 'an index count that is not three a triangle');
  const nan = Buffer.from(good); nan.writeFloatLE(NaN, h + 8); assert.match(code(nan), /^BAD_ROAD: .*not a number/);
  const foreign = Buffer.from(good); foreign.write('sc6969', 0, 'latin1'); assert.match(code(foreign), /^BAD_ROAD: .*does not start with T180ROAD/, 'a kn5 itself, or anything else');
  const fmt = Buffer.from(good); fmt.writeUInt32LE(2, 8); assert.match(code(fmt), /^BAD_ROAD: .*format 2, not 1/);
  assert.match(code(Buffer.from(encodeRoad([ringRoad(200, 10, 30)], { triangles: 61 }))), /^BAD_ROAD: .*header says 61 triangles, its batches hold 60/);
  assert.doesNotMatch(code(good.subarray(0, 10)), /AI line/, 'a road is never called an AI line');
  // (L250 repair) with no line, the road is placed by the start its kn5 names; a header with none (as kn5road.rs writes it: start null and noStart) is
  // refused with the native side's reason. Was: refused as "placed by its AI line, and it has none", before the native side sent a start.
  const none = decodeRoad(encodeRoad([ringRoad(200, 10, 30)], { start: null, noStart: 'no AC_START_0, and no AC_TIME_0_L with AC_TIME_0_R, in the layout\'s kn5 files: the start is not guessed' }));
  // (second repair) an absent start did not fail to read whole, so its words end there: was "… guessed). What does not read whole is never drawn in part."
  assert.throws(() => roadReference(none, null), (e) => e.code === 'NO_START' && /^Not drawn: it has no AI line, and its kn5 names no start to place its road by \(no AC_START_0, .*the start is not guessed\)\.$/.test(refusalWords(e)));
});

test('L250 repair: a road with no AI line is placed by the start its kn5 names, set down on the road under it; a start that is not one is refused', () => {
  const { groundUnder } = require('../src/reference/road.js');
  const withStart = (start) => decodeRoad(encodeRoad([ringRoad(200, 10, 300)], { start }));
  // AC_START_0 0.8 m above the ring 1 m round from angle 0, facing round it (+z): the road under it, (200, 0, 1), is what goes on his start
  const road = roadReference(withStart({ pos: [200, 0.8, 1], T: [0, 0, 1], from: 'AC_START_0' }), null);
  assert.deepStrictEqual([road.kind, road.placedBy, road.lengthM, road.edges.length], ['road', 'its kn5\'s start (its first grid slot)', null, 0]);   // was "(AC_START_0)" (second repair: his words)
  assert.deepStrictEqual(road.start.pos.map((v) => +v.toFixed(6)), [200, 0, 1], 'set down on its road'); assert.ok(Math.abs(road.startAbove - 0.8) < 1e-6, 'it was 0.8 m above it');
  const anchor = { pos: [5, 2, -9], T: [0.6, 0, 0.8] }, M = placeAt(road, anchor, {});
  const at = [200 * M[0] + M[8] + M[12], 200 * M[1] + M[9] + M[13], 200 * M[2] + M[10] + M[14]];
  assert.deepStrictEqual(at.map((v) => +v.toFixed(6)), anchor.pos, 'the road under its start lands on his start, at his start\'s height');
  assert.strictEqual(roadReference(withStart({ pos: [200, 0.8, 0], T: [0, 0, 1], from: 'AC_TIME_0' }), null).placedBy, 'its kn5\'s start (the middle of its time line)');
  // no road under it (off the ring): its own height, as named
  assert.deepStrictEqual(roadReference(withStart({ pos: [0, 3, 0], T: [1, 0, 0], from: 'AC_START_0' }), null).start.pos, [0, 3, 0]);
  // a line, where there is one, still places it (Line and Road lie on each other across; was: the very same start, before the second repair set it down)
  const line = ribbonOf(readAiShape(encodeAiLine(circleLine(200, 400)))), byLine = roadReference(withStart({ pos: [0, 3, 0], T: [1, 0, 0], from: 'AC_START_0' }), line);
  assert.deepStrictEqual([byLine.start.pos[0], byLine.start.pos[2], byLine.start.T, byLine.placedBy], [line.start.pos[0], line.start.pos[2], line.start.T, 'its AI line']);
  for (const [bad, why] of [[{ pos: [0, 0], T: [1, 0, 0] }, /not a position and a way/], [{ pos: [0, 0, 0], T: [0, 1, 0] }, /does not face along the ground/], [{ pos: [0, NaN, 0], T: [1, 0, 0] }, /not a position and a way/]]) {
    assert.throws(() => roadReference(withStart(bad), null), (e) => e.code === 'BAD_ROAD' && why.test(e.message));
  }
  // groundUnder: the highest road at or below a point (second repair; it was "within 2 m above it", so a start 1.5 m under its road found it); null over nothing
  const deck = { positions: new Float32Array([-10, 9, -10, 10, 9, -10, 0, 9, 10]), indices: new Uint16Array([0, 1, 2]) }, floor = { positions: new Float32Array([-10, 0, -10, 10, 0, -10, 0, 0, 10]), indices: new Uint16Array([0, 2, 1]) };
  assert.strictEqual(groundUnder([deck, floor], [0, 0.5, 0]), 0); assert.strictEqual(groundUnder([deck, floor], [0, 9.5, 0]), 9); assert.strictEqual(groundUnder([deck, floor], [0, -1.5, 0]), null, 'a point under every road finds none');
  assert.strictEqual(groundUnder([deck, floor], [50, 0, 0]), null);
});

// Amended by name in the second repair (the librarian's call, on pane E's weighing): was "the same start and way, so Line and Road lie on each other under
// one nudge", the very same start, which left Road as far below his road as the line rides above its own (0.276 to 0.573 m on L, pane E's start_survey).
test('L250: the road is placed by its layout\'s AI line: the same way and the same place across, set down on its road under the line\'s first point, so Line and Road lie on each other across under one nudge', () => {
  // the line 0.3 m above its road, as on L; the road's quads turned half a quad, so the line's first point (200, 0.3, 0) is inside one
  const line = ribbonOf(readAiShape(encodeAiLine(circleLine(200, 400, { y: 0.3 })))), road = roadReference(decodeRoad(encodeRoad([ringRoad(200, 10, 300, 0.5)])), line);
  assert.strictEqual(road.kind, 'road'); assert.strictEqual(road.edges.length, 0); assert.strictEqual(road.placedBy, 'its AI line');
  assert.deepStrictEqual([road.start.pos[0], road.start.pos[2], road.start.T], [line.start.pos[0], line.start.pos[2], line.start.T], 'its start across, and its way, are the line\'s');
  near(road.start.pos[1], 0, 1e-6, 'its start is on its road'); near(road.startAbove, 0.3, 1e-6, 'the line rode 0.3 m above it');
  const anchor = { pos: [5, 2, -9], T: [0.6, 0, 0.8] }, nudge = { dx: 4, yawDeg: 25 }, MR = placeAt(road, anchor, nudge), ML = placeAt(line, anchor, nudge);
  assert.deepStrictEqual(MR.filter((v, i) => i !== 13), ML.filter((v, i) => i !== 13), 'across and in its way, Road lies exactly on Line');
  near(MR[13] - ML[13], 0.3, 1e-6, 'and is raised by the line\'s height over its road, so its road is on his start\'s height');
  // no road under the line's first point: the line's own height, as before
  assert.deepStrictEqual(roadReference(decodeRoad(encodeRoad([ringRoad(50, 10, 300)])), line).start.pos, line.start.pos);
});

test('L250 second repair: groundUnder takes the highest road AT OR BELOW the start: a deck overhead, however near, is never the ground (pane E\'s bridge_check)', () => {
  const { groundUnder } = require('../src/reference/road.js');
  const sq = (y) => ({ positions: new Float32Array([-10, y, -10, 10, y, -10, 10, y, 10, -10, y, 10]), indices: new Uint16Array([0, 2, 1, 0, 3, 2]) });
  // L's highest start is 3.562 m above its road and its lowest 1.112 m (pane B's nostart.json; pane E's start_survey): E found decks at 5.0, 5.5 and 3.0 m taken
  for (const [above, deckAt] of [[3.562, 5.0], [3.562, 5.5], [1.112, 3.0], [1.112, 1.2], [2.0, 4.5]]) {
    assert.strictEqual(groundUnder([sq(deckAt), sq(0)], [0.5, above, 1.5]), 0, `a start ${above} m above its road, a deck ${deckAt} m above that road: the road, not the deck`);
  }
  near(groundUnder([sq(2), sq(0)], [0.5, 2, 1.5]), 2, 1e-9, 'a surface at the start\'s own height is at or below it (its height comes back as 1.9999999999999998)');
  assert.strictEqual(groundUnder([sq(5)], [0.5, 3.562, 1.5]), null, 'only a deck overhead: no road under it');
  // through roadReference: the start under a deck is set down on the road below it
  const under = roadReference(decodeRoad(encodeRoad([sq(5), sq(0)], { start: { pos: [0.5, 3.562, 1.5], T: [0, 0, 1], from: 'AC_START_0' } })), null);
  assert.deepStrictEqual(under.start.pos.map((v) => +v.toFixed(6)), [0.5, 0, 1.5]); near(under.startAbove, 3.562, 1e-6, 'it was 3.562 m above its road');
});
