// geom_sculpt.test.js: node --test test/geom_sculpt.test.js. Sculpting pieces and saving the user's own (the keeper,
// 12:22: "you can also sculp pieces, and then even create and save your own unqiue pieces"). Stated before these tests
// were written:
//   · A piece regenerates from its handle values alone. The same handles at two placements give the same vertex
//     arrays in the piece's own frame, within 1e-5 m (float32 of coordinates re-derived from different world placements;
//     a float32 step at 50 m is about 4e-6 m). The placement lives in the node matrices. THE PLACEMENTS TESTED are
//     translation plus rotation about world up, at the same start pitch and bank: that is the invariance of the current
//     world-up curve model, and the limit is checked too.
//   · A handle edit changes only that piece's cells and the seams beside it. Every other cell's vertex arrays are
//     byte-identical. The matrices of the pieces downstream move, which is re-placement and not a rebuild. The sculpted
//     result equals a full rebuild of the edited track.
//   · Cost: the mesh work of a sculpt (vertex evaluations + chord checks) is the same for a short and a long downstream.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GDIR = process.env.GEOM_DIR || require('path').join(__dirname, '..', 'src', 'geom');
const G = require(GDIR);
const PATH = require(require('path').join(GDIR, 'path.js'));
const F = require('./geom_fixtures.js');

const D = Math.PI / 180;
const children = (m) => m.scene.root.children;
const cellsOf = (m, id) => children(m).filter((c) => c.name.startsWith(`CELL_${id}_`)).map((c) => c.children[0]);
const maxDiff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };

/** A user's saved piece: a banked, clothoid wall-ride turn. Handles only. */
const SAVED = { id: 'mine', word: 'user:banked-wall', kind: 'road', length: 60, k0: 0.005, k1: 0.03, roll0: 0, roll1: 20 * D, profile: F.WALLRIDE };

test('saved piece: the same handles give the same mesh at two placements (compared in the piece\'s own frame)', () => {
  const place1 = [{ id: 'a', kind: 'road', length: 50, profile: F.FLAT }, SAVED];
  const place2 = [{ id: 'a', kind: 'road', length: 20, profile: F.FLAT }, { id: 'b', kind: 'road', length: 40, k0: 1 / 40, k1: 1 / 40, profile: F.FLAT },
    { id: 'c', kind: 'road', length: 33, profile: F.FLAT }, SAVED];
  const m1 = G.buildMesh(G.buildPath(place1), place1), m2 = G.buildMesh(G.buildPath(place2, { start: { pos: [120, 0, -40], theta: 0.7, p: 0 } }), place2);
  const A = cellsOf(m1, 'mine'), B = cellsOf(m2, 'mine');
  assert.ok(A.length >= 1 && A.length === B.length);
  for (let c = 0; c < A.length; c++) {
    for (const f of ['positions', 'normals', 'uvs']) assert.ok(maxDiff(A[c][f], B[c][f]) <= 1e-5, `cell ${c} ${f} differ by ${maxDiff(A[c][f], B[c][f])}`);
    assert.deepStrictEqual(Array.from(A[c].indices), Array.from(B[c].indices));
  }
  const M1 = children(m1).find((c) => c.name === 'CELL_mine_0').matrix, M2 = children(m2).find((c) => c.name === 'CELL_mine_0').matrix;
  assert.ok(maxDiff(M1, M2) > 1, 'the placements must really differ (it is the matrix that carries them)');
});
test('saved piece, the stated limit: with the world-up curve model, a different START PITCH bends the same handles differently', () => {
  const flat = [{ id: 'a', kind: 'road', length: 30, profile: F.FLAT }, SAVED];
  const up = [{ id: 'a', kind: 'road', length: 30, kp0: 0.004, kp1: 0.004, profile: F.FLAT }, SAVED];   // arrives pitched ~6.9° up
  const A = cellsOf(G.buildMesh(G.buildPath(flat), flat), 'mine'), B = cellsOf(G.buildMesh(G.buildPath(up), up), 'mine');
  assert.ok(maxDiff(A[0].positions, B[0].positions) > 1e-3, 'expected the shape in its own frame to change with start pitch');
});

/** A 12-piece open track with fonts that change, so seams exist. */
function track() {
  const out = [];
  for (let i = 0; i < 12; i++) out.push(i % 3 === 0 ? { id: `t${i}`, kind: 'road', length: 35, k0: 0.01, k1: 0.02, profile: F.HALFPIPE }
    : i % 3 === 1 ? { id: `s${i}`, kind: 'road', length: 45, profile: F.FLAT } : { id: `w${i}`, kind: 'road', length: 30, k0: 0.02, k1: 0, profile: F.WALLRIDE });
  return out;
}
function sculpt(segs, g, edit) {
  const p = G.buildPath(segs), m = G.buildMesh(p, segs);
  const before = children(m).map((c) => ({ name: c.name, M: c.matrix.slice(), arr: ['positions', 'normals', 'uvs', 'indices'].map((f) => Array.from(c.children[0][f])) }));
  const edited = segs.slice(); edited[g] = { ...segs[g], ...edit };
  PATH.rebuildPathFrom(p, edited, g); const sm = G.sculptMesh(m, p, edited, g);
  const after = children(sm).map((c) => ({ name: c.name, M: c.matrix.slice(), arr: ['positions', 'normals', 'uvs', 'indices'].map((f) => Array.from(c.children[0][f])) }));
  const full = G.buildMesh(G.buildPath(edited), edited);
  return { before, after, sm, full, edited };
}
function sameAsFull(sm, full) {
  const A = children(sm), B = children(full);
  assert.deepStrictEqual(A.map((c) => c.name), B.map((c) => c.name), 'cell names');
  for (let i = 0; i < A.length; i++) {
    assert.ok(maxDiff(A[i].matrix, B[i].matrix) <= 1e-9, `${A[i].name} matrix`);
    for (const f of ['positions', 'normals', 'uvs']) assert.ok(maxDiff(A[i].children[0][f], B[i].children[0][f]) <= 1e-5, `${A[i].name}.${f}`);
    assert.deepStrictEqual(Array.from(A[i].children[0].indices), Array.from(B[i].children[0].indices));
  }
  assert.deepStrictEqual(sm.folds, full.folds);
}
const touches = (name, ids) => ids.some((id) => name.includes(`_${id}_`) || name.endsWith(`_${id}`));

// D167: fonts ramp (the librarian's ruling on D166 §5), and the ramp belongs to the ENTERING piece. So a font edit on
// piece g also changes piece g + 1, whose entry ramp starts from g's font. Stated before the change: exactly pieces g
// and g + 1 and the seams on their sides change; piece g + 2 on is byte-identical and does not move.
test('sculpt: editing one piece\'s wall angle changes that piece, the next piece\'s entry ramp, and their seams; nothing moves', () => {
  const segs = track(), g = 5, id = segs[g].id, next = segs[g + 1].id, after2 = segs[g + 2].id;
  const { before, after, sm, full } = sculpt(segs, g, { profile: F.prof('wall-ride', [-13, -5, 0, 5, 13], [30, 0, 0, 0, 95]) });
  const changed = after.filter((a) => { const b = before.find((x) => x.name === a.name); return !b || JSON.stringify(b.arr) !== JSON.stringify(a.arr) || maxDiff(b.M, a.M) > 0; }).map((a) => a.name);
  assert.ok(changed.some((n) => n.startsWith(`CELL_${id}_`)), 'the edited piece changed');
  assert.ok(changed.some((n) => n.startsWith(`CELL_${next}_`)), 'the next piece\'s entry ramp follows the new font');
  for (const n of changed) assert.ok(touches(n, [id, next]) || n === `SEAM_${after2}`, `${n} changed but belongs to neither piece ${id}, piece ${next}, nor their seams`);
  sameAsFull(sm, full);
});
test('sculpt: editing one piece\'s length changes only its cells; downstream pieces keep their arrays and only move', () => {
  const segs = track(), g = 4;                      // s4, a flat straight
  const { before, after, sm, full } = sculpt(segs, g, { length: 70 });
  for (const a of after) {
    const b = before.find((x) => x.name === a.name);
    if (touches(a.name, [segs[g].id]) || a.name === `SEAM_${segs[g + 1].id}`) continue;   // the piece, and its seams (a seam is named after its later piece)
    assert.ok(b, `${a.name} is new`);
    assert.strictEqual(JSON.stringify(a.arr), JSON.stringify(b.arr), `${a.name} was rebuilt; only its placement should move`);
  }
  assert.strictEqual(sm.stats.reused, segs.length - 1 - g, 'every downstream piece is reused, not rebuilt');
  sameAsFull(sm, full);
});
test('sculpt: editing one piece\'s curvature rotates everything after it about world up; downstream arrays are kept', () => {
  const segs = track(), g = 3;
  const { sm, full } = sculpt(segs, g, { k0: 0.03, k1: 0.03 });
  assert.strictEqual(sm.stats.reused, segs.length - 1 - g);
  sameAsFull(sm, full);
});
test('sculpt cost: the mesh work is the same with 10 or 100 pieces after the edited one (operation counts)', () => {
  const run = (after) => {
    const segs = [...track(), ...Array.from({ length: after }, (_, i) => ({ id: `x${i}`, kind: 'road', length: 40, k0: 0.004 * ((i % 3) - 1), k1: 0, profile: i % 2 ? F.FLAT : F.HALFPIPE }))];
    const p = G.buildPath(segs), m = G.buildMesh(p, segs), edited = segs.slice(); edited[5] = { ...segs[5], length: 50 };
    PATH.rebuildPathFrom(p, edited, 5); return G.sculptMesh(m, p, edited, 5).stats.work;
  };
  const a = run(10), b = run(100);
  assert.strictEqual(b, a, `mesh work ${a} vs ${b}`);
});
test('sculpt: editing a piece\'s pitch changes the start pitch of everything after it, so those pieces are remeshed, not reused', () => {
  const segs = track(), g = 3;
  const { sm, full } = sculpt(segs, g, { kp0: 0.003, kp1: 0.003 });   // leaves piece 3 about 6° steeper
  assert.strictEqual(sm.stats.reused, 0, 'a changed start pitch changes the shape in the piece\'s own frame');
  sameAsFull(sm, full);
});
test('sculpt: path re-placement costs the edited piece and what follows it, never what comes before (operation counts)', () => {
  const run = (before) => {
    const lead = Array.from({ length: before }, (_, i) => ({ id: `y${i}`, kind: 'road', length: 40, k0: 0.004 * ((i % 3) - 1), k1: 0, profile: F.FLAT }));
    const segs = [...lead, ...track()], g = before + 5, p = G.buildPath(segs), edited = segs.slice(); edited[g] = { ...segs[g], length: 50 };
    PATH.rebuildPathFrom(p, edited, g); return p.work;
  };
  const a = run(10), b = run(100);
  assert.strictEqual(b, a, `path work ${a} vs ${b}`);
});
test('sculpt: a start-pitch change with NO bank change still remeshes the curve after it (a straight ramp, then a turn)', () => {
  // on a pitched curve the frame also banks against gravity, so the bank check alone would catch the case above;
  // a STRAIGHT ramp changes the next piece's start pitch and leaves its start bank at exactly 0
  const segs = [{ id: 'a', kind: 'road', length: 30, profile: F.FLAT }, { id: 'r', kind: 'road', length: 40, profile: F.FLAT },
    { id: 'c', kind: 'road', length: 50, k0: 0.03, k1: 0.03, profile: F.WALLRIDE }];
  const { sm, full } = sculpt(segs, 1, { kp0: 0.003, kp1: 0.003 });
  sameAsFull(sm, full);
});

// ── D177: RIGID DOWNSTREAM EDITS (the librarian's ruling: an upstream edit moves everything downstream rigidly, a
// transform of the existing cells, never a regrow or a re-mesh). Stated before these tests were run:
//   · an edit that leaves the next piece's start pitch and frame the same up to a turn about world up re-places the
//     rest of the path, one motion per segment: path.replaced counts them, and no downstream sample is regrown;
//   · every downstream cell's LOCAL arrays are byte-identical before and after; only its node matrix changes;
//   · the operation count of the edit (path.work + mesh work) does not depend on how LONG the downstream is, in metres,
//     and grows by exactly one per extra downstream segment (its re-placement);
//   · on a pitched stretch the bank against gravity (bankG) of every re-placed sample is BIT-IDENTICAL to before (a turn
//     about world up leaves every y component alone), and equals a full rebuild's to 1e-12;
//   · a re-placed path equals a full rebuild EXACTLY (amended 18:5x, the chair: the keeper's rule, exact where it is
//     achievable; a first version agreed only to 2.2e-12, and was rebuilt as one placement chain for both).
const PITCHED = 1 * D;
/** A track on a steady 1° climb (a pitched start, no pitch curvature): straights and turns, then `after` downstream. */
function pitched(after, lengthM = 40) {
  const lead = [{ id: 'a', kind: 'road', length: 60, profile: F.FLAT }, { id: 'e', kind: 'road', length: 80, profile: F.FLAT },
    { id: 'b', kind: 'road', length: 50, k0: 0.01, k1: 0.01, profile: F.FLAT }];
  return [...lead, ...Array.from({ length: after }, (_, i) => ({ id: `x${i}`, kind: 'road', length: lengthM, k0: 0.004 * ((i % 3) - 1), k1: 0.004 * ((i % 3) - 1), roll0: 0.1, roll1: 0.1, profile: i % 2 ? F.FLAT : F.HALFPIPE }))];
}
const START = { start: { pos: [0, 0, 0], theta: 0.3, p: PITCHED } };
function edit(segs, g, change, opts = START) {
  const p = G.buildPath(segs, opts), m = G.buildMesh(p, segs);
  const snap = (mm) => children(mm).map((c) => ({ name: c.name, M: c.matrix.slice(), arr: ['positions', 'normals', 'uvs', 'indices'].map((f) => Buffer.from(c.children[0][f].buffer).toString('base64')) }));
  const bank0 = p.samples.map((x) => x.bankG), before = snap(m), n0 = p.samples.length;
  const edited = segs.slice(); edited[g] = { ...segs[g], ...change };
  PATH.rebuildPathFrom(p, edited, g); const pw = p.work; const sm = G.sculptMesh(m, p, edited, g);
  return { p, pw, sm, before, after: snap(sm), bank0, n0, edited, full: G.buildPath(edited, opts) };
}
const pathDiff = (a, b) => { let d = 0; a.samples.forEach((x, i) => { const y = b.samples[i]; d = Math.max(d, Math.abs(x.s - y.s), Math.abs(x.bankG - y.bankG)); for (const f of ['pos', 'T', 'L', 'U', 'kvec']) for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(x[f][c] - y[f][c])); }); return d; };

test('rigid: a straight\'s length edit on a 1° climb re-places every later segment, and regrows none of them', () => {
  const segs = pitched(8), { p } = edit(segs, 1, { length: 80.5 });
  assert.strictEqual(p.replaced, segs.length - 2);
});
test('rigid: every downstream cell keeps its local arrays byte for byte; only its matrix moves', () => {
  const segs = pitched(8), { before, after } = edit(segs, 1, { length: 80.5 }), down = segs.slice(2).map((s) => s.id);
  const moved = [];
  for (const a of after.filter((x) => touches(x.name, down))) {
    const b = before.find((x) => x.name === a.name);
    assert.ok(b, `${a.name} is new`);
    assert.deepStrictEqual(a.arr, b.arr, `${a.name}: local arrays changed`);
    if (maxDiff(a.M, b.M) > 0) moved.push(a.name);
  }
  assert.strictEqual(moved.length, after.filter((x) => touches(x.name, down)).length, 'every downstream cell\'s matrix moved by the 0.5 m');
});
test('rigid: the bank against gravity of every re-placed sample is bit-identical to before the edit (Δbank exactly 0)', () => {
  const segs = pitched(8), { p, bank0, n0 } = edit(segs, 1, { length: 80.5 }), first = p.segFirst[2];
  const dn = p.samples.length - n0, diffs = [];
  for (let i = first; i < p.samples.length; i++) if (p.samples[i].bankG !== bank0[i - dn]) diffs.push(i);
  assert.deepStrictEqual([p.samples.length - first > 100, diffs], [true, []]);
});
test('rigid: the displayed bank after the move is the moved frame\'s bank against gravity, and a full rebuild\'s to 1e-12', () => {
  const segs = pitched(8), { p, full } = edit(segs, 1, { length: 80.5 });
  let worst = 0; for (let i = p.segFirst[2]; i < p.samples.length; i++) { const x = p.samples[i]; worst = Math.max(worst, Math.abs(x.bankG - Math.asin(x.L[1])), Math.abs(x.bankG - full.samples[i].bankG)); }
  assert.ok(worst <= 1e-12, `worst ${worst}`);
});
test('rigid: the re-placed path equals a full rebuild of the edited track EXACTLY (the same chain, the same floats)', () => {
  const segs = pitched(8), { p, full } = edit(segs, 1, { length: 80.5 });
  assert.deepStrictEqual([p.replaced, pathDiff(p, full)], [segs.length - 2, 0]);
});
test('rigid: a turn edit (heading) re-places everything after it, turned about world up, equal to a full rebuild', () => {
  const segs = pitched(8), start = { start: { pos: [0, 0, 0], theta: 0.3, p: 0 } };
  const { p, full } = edit(segs, 2, { k0: 0.02, k1: 0.02 }, start);
  assert.deepStrictEqual([p.replaced, pathDiff(p, full)], [segs.length - 3, 0]);
});
test('rigid cost: the operation count of an edit is the same whether the downstream pieces are 40 m or 4 km long', () => {
  const ops = (lengthM) => { const r = edit(pitched(8, lengthM), 1, { length: 80.5 }); return r.pw + r.sm.stats.work; };
  assert.strictEqual(ops(4000), ops(40));
});
test('rigid cost: each extra downstream segment adds exactly one operation to the path (its re-placement)', () => {
  const ops = (after) => edit(pitched(after), 1, { length: 80.5 }).pw;
  assert.strictEqual(ops(108) - ops(8), 100);
});
test('rigid: the path grows on from a re-placed tail exactly as from a grown one (append after a sculpt)', () => {
  const segs = pitched(6), { p, edited } = edit(segs, 1, { length: 80.5 });
  const more = [...edited, { id: 'z', kind: 'road', length: 30, k0: 0.02, k1: 0.02, profile: F.FLAT }];
  PATH.extendPath(p, more);
  assert.ok(pathDiff(p, G.buildPath(more, START)) <= 1e-9);
});
test('rigid: a pitch edit upstream is NOT rigid under the world-up model: the tail is regrown and equals a full rebuild', () => {
  const segs = pitched(6), { p, full } = edit(segs, 1, { kp0: 0.002, kp1: 0.002 });
  assert.deepStrictEqual([p.replaced, pathDiff(p, full) <= 1e-9], [0, true]);
});
test('rigid: a TURN edit on a pitched stretch moves downstream rigidly (Δbank 0)', () => {
  // D177 option 2 (the gravity frame): the edit that measured Δbank 8.7e-6 under the rotation-minimising frame. Every
  // later segment is re-placed, and every re-placed sample's bank against gravity is bit-identical to before
  const segs = pitched(6), p0 = G.buildPath(segs, START), bank0 = p0.samples.map((x) => x.bankG), n0 = p0.samples.length;
  const e = segs.slice(); e[2] = { ...segs[2], length: 50.5 }; PATH.rebuildPathFrom(p0, e, 2);
  const first = p0.segFirst[3], dn = p0.samples.length - n0, moved = p0.samples.slice(first);
  assert.deepStrictEqual([p0.replaced, moved.filter((x, k) => x.bankG !== bank0[first + k - dn]).length, pathDiff(p0, G.buildPath(e, START))], [segs.length - 3, 0, 0]);
});
test('rigid: a level turn edited before a climb re-places the pitched, banked tail with L·y and bankG bit for bit, bankG = asin(L·y)', () => {
  // the edited turn is level (no frame twist, k·sin 0 = 0), so the tail is re-placed with a real turn (d ≠ 0); the tail
  // climbs and turns while pitched, so its frames have L·y ≠ 0 for a turn about y to preserve
  const segs = [{ id: 'a', kind: 'road', length: 40, profile: F.FLAT }, { id: 't', kind: 'road', length: 60, k0: 0.01, k1: 0.01, profile: F.FLAT },
    { id: 'up', kind: 'road', length: 60, kp0: 0.003, kp1: 0.003, profile: F.FLAT },
    { id: 'c1', kind: 'road', length: 80, k0: 0.02, k1: 0.02, roll0: 0.2, roll1: 0.2, profile: F.WALLRIDE }, { id: 'c2', kind: 'road', length: 70, k0: -0.015, k1: -0.015, roll0: -0.1, roll1: -0.1, profile: F.FLAT }];
  // with the gravity frame every block after the edited turn is re-placed ('up', c1, c2); under the rotation-minimising
  // frame (before option 2) the rounding noise in R0 made 'up' and c1 regrow
  const p = G.buildPath(segs), before = p.samples.map((x) => [x.L[1], x.bankG]);
  const e = segs.slice(); e[1] = { ...segs[1], k0: 0.014, k1: 0.014 }; PATH.rebuildPathFrom(p, e, 1);
  const first = p.segFirst[segs.length - p.replaced], moved = p.samples.slice(first);
  assert.deepStrictEqual([p.replaced === segs.length - 2, p.samples.length, moved.filter((x, i) => x.L[1] !== before[first + i][0] || x.bankG !== before[first + i][1] || Math.abs(x.bankG - Math.asin(x.L[1])) > 1e-12).length, moved.some((x) => Math.abs(x.L[1]) > 0.05), pathDiff(p, G.buildPath(e))],
    [true, before.length, 0, true, 0]);
});
test('rigid: two sculpts in a row compose their motions; the path still equals a full rebuild', () => {
  const segs = pitched(6), p = G.buildPath(segs, START), e1 = segs.slice(); e1[1] = { ...segs[1], length: 80.5 };
  PATH.rebuildPathFrom(p, e1, 1);
  const e2 = e1.slice(); e2[0] = { ...e1[0], length: 61.25 }; PATH.rebuildPathFrom(p, e2, 0);
  assert.deepStrictEqual([p.replaced, pathDiff(p, G.buildPath(e2, START)) <= 1e-9], [segs.length - 1, true]);
});
test('rigid: an append, then a sculpt upstream: the re-placed tail includes the appended piece, equal to a full rebuild', () => {
  const segs = pitched(4), p = G.buildPath(segs, START), more = [...segs, { id: 'z', kind: 'road', length: 30, k0: 0.02, k1: 0.02, profile: F.FLAT }];
  PATH.extendPath(p, more);
  const e = more.slice(); e[1] = { ...more[1], length: 80.5 }; PATH.rebuildPathFrom(p, e, 1);
  const f = G.buildPath(e, START);   // segFirst too: the mesh reads each piece's samples by it (mutant R7 kept the samples right and these wrong)
  assert.deepStrictEqual([p.replaced, p.samples.length, p.segFirst, pathDiff(p, f) <= 1e-9], [more.length - 2, f.samples.length, f.segFirst, true]);
});
test('rigid: a later segment whose ROLL changed is regrown, not re-placed (the unchanged tail starts after it)', () => {
  const segs = pitched(6), p = G.buildPath(segs, START), e = segs.slice();
  e[1] = { ...segs[1], length: 80.5 }; e[4] = { ...segs[4], roll1: 0.3 };
  PATH.rebuildPathFrom(p, e, 1);
  assert.deepStrictEqual([p.replaced, pathDiff(p, G.buildPath(e, START)) <= 1e-9], [segs.length - 5, true]);
});
test('exact: a turn edit on a pitched stretch re-places the whole tail and equals a full rebuild exactly', () => {
  // (before option 2, under the rotation-minimising frame, this edit regrew the whole tail: the frame's twist was real)
  const segs = pitched(6), { p, full } = edit(segs, 2, { length: 50.5 });
  assert.deepStrictEqual([p.replaced, pathDiff(p, full)], [segs.length - 3, 0]);
});
test('exact: a level turn edit equals a full rebuild exactly (the tail is regrown with the RMF frame)', () => {
  const segs = pitched(6), start = { start: { pos: [0, 0, 0], theta: 0.3, p: 0 } }, { p, full } = edit(segs, 2, { k0: 0.02, k1: 0.02 }, start);
  assert.strictEqual(pathDiff(p, full), 0);
});
