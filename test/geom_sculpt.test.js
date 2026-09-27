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
