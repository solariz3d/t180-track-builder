// core-readouts-carry.test.js: node --test app/test/core-readouts-carry.test.js
// D421c part 3 (seat A; plan_d421c_cuts_2026-10-20.md :49-54; the profile p-d421c-profile-A_2026-10-20.md §2): EVERY PIECE'S READOUT AT ONCE (src/core/readout.js pieceReadouts),
// for the labels (app/core/coreshell.js pieceReadouts). Row 3's longest frame was 406-443 ms, 85-91 of it the labels reading every piece again after the re-close: each piece's
// readout checked the whole document and summed the pose from the start, so a 50-piece lap paid 50 checks and 1,225 pose sums. The batch checks once and carries the pose on.
//   1  bit for bit: each readout is pieceReadout(doc, i)'s, on a closed lap, a lap with a jump, a tube, offsets (Grab's hill and swerve), and an empty track
//   2  the carry: a road piece whose object, entering pose and corner are the very ones it had keeps its readout (the same object); everything else is read again
//   3  a heading change reads again a piece WITH offsets (its lifted turn reads the heading) and a piece whose corner reaches the change; not one without either
//   4  a re-close that rewrites every piece reads every piece again; a start pitch change reads every piece again
//   5  refused as pieceReadout refuses: a bad document throws BAD_DOC, by name, when there is a piece to read; an empty track has no readouts
//   6  the shell's pieceReadouts: one answer per document, carried across a Grab, equal to the fresh readouts
//   7  a flight is always read again (its readout reads the road before it and the whole track)
//   8  a corner reads the id, the knots and the channel of each of its pieces: a new id or moved knots read it again, though the pitch is the same
//   9  a frozen piece keeps its whole-piece reads (its whole integral, where it was last straight): the same numbers as reading it afresh; an unfrozen piece is read afresh
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const RD = require('../../src/core/readout.js');
const D = require('../../src/core/document.js');
const CJ = require('../core/closejob.js');

const R = 180, Q = (Math.PI * R) / 2;
// the tracks, made by the shell as a person's Extend, Close, Jump and Grab make them
async function shellOf(make, opts = {}) { const s = await createCoreShell({ autosaveMs: 0, ...opts }); make(s); assert.equal(s.getState().message === null || !/^[A-Z_]+:/.test(s.getState().message), true, s.getState().message); return s; }
const closed10 = (s) => { s.extend({ length: 200, family: 'bowl' }); for (let k = 0; k < 2; k++) { for (let i = 0; i < (k ? 20 : 19); i++) s.extend({ length: 200, transition: 40, targets: { kh: 0 } }); for (let i = 0; i < 5; i++) s.extend({ length: 200, transition: 40, targets: { kh: Math.PI / 1000 } }); } s.close(); };
const open12 = (s) => { s.extend({ length: 100, family: 'bowl' }); for (let i = 1; i < 12; i++) s.extend({ length: 100, transition: 40, targets: { kh: ((i % 4 < 2 ? 1 : -1) * 12 * Math.PI / 180) / 100, kv: (i % 3 ? 0.002 : -0.002) } }); };
const jumped = (s) => { open12(s); s.jump({ length: 60 }); s.extend({ length: 120, transition: 40, targets: { kh: 0.004 } }); s.extend({ length: 120, transition: 40, targets: { kh: 0 } }); };
const tube = (s) => { s.extend({ length: 300, first: { w: 31, t: 360 } }); for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 60, transition: 40, targets: { kh: 0 } }); s.close(); };
/** Grab: the hill and the swerve (the offsets h and l) on piece `at` of a track, as the brush leaves them */
const grabbed = (s, s0, r, up, side) => { s.sculptOnce({ mode: 'local', channel: 'height', s0, r, delta: up }); if (side) s.sculptOnce({ mode: 'local', channel: 'lateral', s0, r, delta: side }); };
const fresh = (d) => d.pieces.map((_, i) => RD.pieceReadout(d, i));
const docOf = (s) => s.getState().history.present;

test('row 1: every piece\'s readout at once is pieceReadout\'s, bit for bit: a closed lap, a lap with a jump, a closed tube, offsets, an empty track', async () => {
  const cases = { closed10: await shellOf(closed10), jumped: await shellOf(jumped), tube: await shellOf(tube), offsets: await shellOf((s) => { open12(s); grabbed(s, 450, 120, 6, 4); grabbed(s, 900, 80, -3, 0); }) };
  assert.ok(docOf(cases.jumped).pieces.some((P) => P.type === 'flight'), 'the jumped lap has a flight');
  assert.ok(docOf(cases.offsets).pieces.some((P) => D.OFFSETS.some((ch) => P.channels[ch].some((v) => v !== 0))), 'the grabbed lap has offsets');
  for (const [name, s] of Object.entries(cases)) {
    const d = docOf(s), got = RD.pieceReadouts(d);
    assert.equal(got.doc, d, `${name}: the answer says which document it reads`);
    assert.deepStrictEqual(got.reads, fresh(d), `${name}: the readouts are pieceReadout's`);
  }
  assert.deepStrictEqual(RD.pieceReadouts(D.createDoc('e')).reads, [], 'an empty track has no readouts (pieceReadout refuses its piece 0 as EMPTY; there is none to ask for)');
});

test('row 2: the carry: after a Grab on piece 6 of 12, the pieces before and after the window keep their readouts (the same objects), and every readout is still pieceReadout\'s', async () => {
  const s = await shellOf(open12), before = docOf(s), was = RD.pieceReadouts(before);
  grabbed(s, 650, 40, 5, 0);
  const d = docOf(s), now = RD.pieceReadouts(d, was), changed = d.pieces.map((P, i) => P !== before.pieces[i]);
  assert.ok(changed.some(Boolean) && changed.filter(Boolean).length < 4, `the Grab changed a few pieces: ${changed.map((c) => (c ? 'X' : '.')).join('')}`);
  assert.deepStrictEqual(now.reads, fresh(d), 'every readout is the fresh one');
  d.pieces.forEach((P, i) => { if (!changed[i] && P.type === 'road') assert.equal(now.reads[i], was.reads[i], `piece ${i}, unchanged, its pose and corner unchanged: carried`); else assert.notEqual(now.reads[i], was.reads[i], `piece ${i}, changed: read again`); });
});

test('row 3: a heading change reads again a piece WITH offsets and a piece whose corner reaches the change, and carries one with neither', async () => {
  // a lap with a hill on piece 9 (offsets) and a corner of pieces 4-5; the change: piece 2's turn (Bend on piece 2, its window inside it)
  const s = await shellOf((x) => { x.extend({ length: 200, family: 'bowl' }); for (let i = 1; i < 12; i++) x.extend({ length: 200, transition: 40, targets: { kh: i === 4 || i === 5 ? 0.004 : 0 } }); grabbed(x, 9 * 200 + 100, 60, 4, 0); });
  const before = docOf(s), was = RD.pieceReadouts(before);
  assert.ok(D.OFFSETS.some((ch) => before.pieces[9].channels[ch].some((v) => v !== 0)), 'piece 9 has offsets');
  s.setSculpt(true); s.beginBrush({ tool: 'bend', s0: 2 * 200 + 100, r: 60 }); assert.ok(s.getState().brush, s.getState().message); s.brushTo(4e-4); s.endBrush();
  const d = docOf(s), now = RD.pieceReadouts(d, was), changed = d.pieces.map((P, i) => P !== before.pieces[i]);
  assert.deepStrictEqual(now.reads, fresh(d), 'every readout is the fresh one');
  assert.ok(changed[2] && !changed[7] && !changed[9], `the Bend changed piece 2 and not 7 or 9: ${changed.map((c) => (c ? 'X' : '.')).join('')}`);
  assert.notEqual(now.reads[9], was.reads[9], 'piece 9 (offsets: its lifted turn reads the heading, which changed): read again');
  assert.equal(now.reads[7], was.reads[7], 'piece 7 (no offsets, straight, no corner): carried across the new heading');
  assert.ok(was.reads[5].corner && was.reads[5].corner.fromId === before.pieces[4].id, 'piece 5\'s corner begins at piece 4');
  // a corner that reaches the change: pieces 2-4 turn, so piece 4's corner begins on piece 2, and the Bend changes piece 2's turn
  const t = await shellOf((x) => { x.extend({ length: 200, family: 'bowl' }); for (let i = 1; i < 8; i++) x.extend({ length: 200, transition: 40, targets: { kh: i >= 2 && i <= 4 ? 0.004 : 0 } }); });
  const b2 = docOf(t), w2 = RD.pieceReadouts(b2);
  assert.equal(w2.reads[4].corner.fromId, b2.pieces[2].id, 'piece 4\'s corner begins on piece 2');
  t.setSculpt(true); t.beginBrush({ tool: 'bend', s0: 2 * 200 + 100, r: 50 }); t.brushTo(3e-4); t.endBrush();
  const d2 = docOf(t), n2 = RD.pieceReadouts(d2, w2);
  assert.deepStrictEqual(n2.reads, fresh(d2), 'every readout is the fresh one');
  assert.ok(d2.pieces[4] === b2.pieces[4] && d2.pieces[2] !== b2.pieces[2], 'piece 4 is the same object, piece 2 is new');
  assert.notEqual(n2.reads[4], w2.reads[4], 'piece 4, the same object, but its corner reaches the changed piece 2: read again');
});

test('row 4: a re-close that rewrites every piece reads every piece again; so does a start pitch change', async () => {
  const realClose = (args) => { try { return { out: CJ.runClose(args), ms: 0 }; } catch (e) { if (e && e.name === 'CoreError') return { refused: { code: e.code || null, message: e.message } }; throw e; } };
  const jobs = [], closeRunner = { start(args) { const p = Promise.resolve(realClose(args)); jobs.push(p); return { promise: p, cancel() {} }; } };
  const s = await shellOf(closed10, { closeRunner }), before = docOf(s), was = RD.pieceReadouts(before);
  s.setSculpt(true); s.beginBrush({ tool: 'bend', s0: 2100, r: 200 }); s.brushTo(3e-4); s.endBrush(); await Promise.all(jobs); await new Promise((r) => setTimeout(r, 20));
  const d = docOf(s); assert.equal(d.closed, true, s.getState().message);
  const now = RD.pieceReadouts(d, was);
  assert.deepStrictEqual(now.reads, fresh(d), 'every readout is the fresh one');
  d.pieces.forEach((P, i) => { if (P !== before.pieces[i]) assert.notEqual(now.reads[i], was.reads[i], `piece ${i}, rewritten by the close: read again`); });
  // the start's pitch moves every pose: nothing carries, though every piece is the very same object
  const lifted = { ...before, start: { ...before.start, pitch: before.start.pitch + 0.01 } };
  const n2 = RD.pieceReadouts(lifted, was);
  assert.deepStrictEqual(n2.reads, fresh(lifted), 'with the start pitched: the fresh readouts');
  lifted.pieces.forEach((P, i) => assert.notEqual(n2.reads[i], was.reads[i], `piece ${i}: its entering pitch moved, read again`));
  // the start's position moves no readout: every piece carries
  const moved = { ...before, start: { ...before.start, pos: [before.start.pos[0] + 5, before.start.pos[1], before.start.pos[2]] } }, n3 = RD.pieceReadouts(moved, was);
  moved.pieces.forEach((P, i) => assert.equal(n3.reads[i], was.reads[i], `piece ${i}: the start moved, not turned: carried`));
  assert.deepStrictEqual(n3.reads, fresh(moved));
});

test('row 5: refused as pieceReadout refuses: a bad document throws BAD_DOC by name when a piece is read; a carry from a document of other pieces reads them all', async () => {
  const s = await shellOf(open12), d = docOf(s), was = RD.pieceReadouts(d);
  const bad = { ...d, pieces: [...d.pieces.slice(0, 5), { ...d.pieces[5], id: d.pieces[4].id }, ...d.pieces.slice(6)] };   // two pieces with one id
  assert.throws(() => RD.pieceReadout(bad, 5), (e) => e.code === 'BAD_DOC', 'pieceReadout refuses it');
  assert.throws(() => RD.pieceReadouts(bad, was), (e) => e.code === 'BAD_DOC', 'and so does every readout at once');
  assert.throws(() => RD.pieceReadouts(bad), (e) => e.code === 'BAD_DOC', 'with nothing to carry too');
  const other = docOf(await shellOf(jumped)), n = RD.pieceReadouts(other, was);
  assert.deepStrictEqual(n.reads, fresh(other));
  other.pieces.forEach((P, i) => { if (P !== d.pieces[i]) assert.notEqual(n.reads[i], was.reads[i], `piece ${i}: another track's piece, read`); });
});

test('row 6: the shell\'s pieceReadouts: one answer per document, the fresh readouts after a Grab, carrying the pieces outside the window', async () => {
  const s = await shellOf(open12), a = s.pieceReadouts();
  assert.equal(s.pieceReadouts(), a, 'asked again for the same document: the same answer');
  assert.deepStrictEqual(a, fresh(docOf(s)));
  const before = docOf(s); grabbed(s, 650, 40, 5, 0);
  const b = s.pieceReadouts(), d = docOf(s);
  assert.deepStrictEqual(b, fresh(d), 'after the Grab: the fresh readouts');
  assert.equal(b[11], a[11], 'piece 11, after the window, its pose unchanged: the very same readout object');
  assert.equal(b[0], a[0], 'piece 0, before the window: carried');
  assert.ok(d.pieces[6] !== before.pieces[6] && b[6] !== a[6], 'piece 6, Grabbed: read again');
});

test('row 7: a flight is always read again: a Twist at the end of the road before it changes the bank it takes off with, though the flight is the very same piece at the same pitch', async () => {
  const s = await shellOf((x) => { open12(x); x.jump({ length: 60 }); x.extend({ length: 120, transition: 40, targets: { kh: 0.004 } }); });
  const before = docOf(s), f = before.pieces.findIndex((P) => P.type === 'flight'), was = RD.pieceReadouts(before);
  let s0 = 0; for (let i = 0; i < f - 1; i++) s0 += before.pieces[i].length;
  s.sculptOnce({ mode: 'rate', channel: 'phi', s0: s0 + before.pieces[f - 1].length - 25, r: 20, delta: 0.2 });
  const d = docOf(s), now = RD.pieceReadouts(d, was);
  assert.ok(d.pieces[f] === before.pieces[f] && d.pieces[f - 1] !== before.pieces[f - 1], 'the flight is the same piece; the road before it is new');
  assert.equal(now.poses[f].p, was.poses[f].p, 'entering at the same pitch');
  assert.notEqual(now.reads[f].bankFromDeg, was.reads[f].bankFromDeg, 'the bank it takes off with changed');
  assert.deepStrictEqual(now.reads, fresh(d), 'every readout is the fresh one');
});

test('row 8: a corner whose pieces read differently is read again though the pitch is the same: the climb corner\'s first piece made anew (a new id), a turn corner\'s piece with its knots moved', () => {
  const { extend } = require('../../src/core/extend.js');
  // the climb: pieces 1-4 climb, 2-3 turn; piece 4's turn corner begins on piece 2, its climb corner on piece 1
  let d = extend(D.createDoc('m'), { length: 100 }); for (let i = 1; i < 6; i++) d = extend(d, { length: 100, transition: 40, targets: { kv: i < 5 ? 0.002 : 0, kh: i === 2 || i === 3 ? 0.003 : 0 } });
  const was = RD.pieceReadouts(d);
  assert.deepEqual([was.reads[4].corner.fromId, was.reads[4].climbCorner.fromId], [d.pieces[2].id, d.pieces[1].id]);
  const renamed = { ...d, nextId: d.nextId + 1, pieces: d.pieces.map((P, i) => (i === 1 ? { ...P, id: `p${d.nextId}` } : P)) }, n1 = RD.pieceReadouts(renamed, was);
  assert.equal(n1.poses[4].p, was.poses[4].p, 'the same pitch entering piece 4');
  assert.deepStrictEqual(n1.reads, fresh(renamed), 'every readout is the fresh one (piece 4\'s climb corner now begins on the new piece)');
  assert.notEqual(n1.reads[4], was.reads[4], 'piece 4: its climb corner read the old piece 1, so it is read again');
  // the turn, level throughout: pieces 2-3 turn; piece 3 with a middle knot moved (its ends and their slopes kept, so the joints stay C1) turns differently along it, and the pitch (0) cannot tell
  let t = extend(D.createDoc('k'), { length: 100 }); for (let i = 1; i < 6; i++) t = extend(t, { length: 100, transition: 40, targets: { kh: i === 2 || i === 3 ? 0.003 : 0 } });
  const w2 = RD.pieceReadouts(t); assert.equal(w2.reads[4].corner.fromId, t.pieces[2].id);
  const moved = { ...t, pieces: t.pieces.map((P, i) => (i === 3 ? { ...P, knots: [P.knots[0], P.knots[1] + 7, ...P.knots.slice(2)] } : P)) }, n2 = RD.pieceReadouts(moved, w2);
  assert.equal(n2.poses[4].p, w2.poses[4].p, 'level: the same pitch');
  assert.deepStrictEqual(n2.reads, fresh(moved), 'every readout is the fresh one');
  assert.notEqual(n2.reads[4].corner.turnDeg, w2.reads[4].corner.turnDeg, 'the moved knots turn the corner differently');
});

test('row 9: a frozen piece\'s kept whole-piece reads are the reads: a frozen lap reads as its unfrozen copy (read afresh), turn and climb kept apart; an unfrozen piece changed in place reads its change', async () => {
  const s = await shellOf((x) => { open12(x); x.close(); }), d = docOf(s);
  assert.ok(Object.isFrozen(d.pieces[3]) && Object.isFrozen(d.pieces[3].channels.kh), 'a document\'s pieces are frozen');
  const thaw = (v) => (Array.isArray(v) ? v.map(thaw) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, thaw(x)])) : v);
  const loose = thaw(d);
  assert.ok(!Object.isFrozen(loose.pieces[3]), 'the copy is not frozen');
  const a = RD.pieceReadouts(d).reads, b = RD.pieceReadouts(loose).reads, c = RD.pieceReadouts(d).reads;
  assert.deepStrictEqual(a, b, 'the frozen lap (its reads kept) reads as the unfrozen copy (read afresh every time)');
  assert.deepStrictEqual(c, b, 'and again, from what was kept');
  assert.ok(a.some((r) => r.corner) && a.some((r) => r.climbCorner) && a.some((r, i) => r.corner && r.climbCorner && r.corner.turnDeg !== r.climbCorner.climbDeg), 'the lap turns and climbs, by different amounts');
  // a corner that begins in the middle of a piece walked back into: a straight 300 m whose end a Bend turned, then a turning piece; its kept last-straight is the
  // middle of the 300 m (where it was last straight before its END), not its start
  const m = await shellOf((x) => { x.extend({ length: 300 }); x.extend({ length: 200, transition: 40, targets: { kh: 0.004 } }); x.extend({ length: 200, transition: 40, targets: { kh: 0 } }); x.sculptOnce({ mode: 'rate', channel: 'kh', s0: 285, r: 60, delta: 0.002 }); });
  const md = docOf(m), mr = RD.pieceReadouts(md).reads;
  assert.equal(mr[1].corner.fromId, md.pieces[0].id, 'piece 1\'s corner walks back into the 300 m');
  assert.deepStrictEqual(mr, RD.pieceReadouts(thaw(md)).reads, 'kept or read afresh, the same corners');
  assert.deepStrictEqual(RD.pieceReadouts(md).reads, RD.pieceReadouts(thaw(md)).reads, 'and from what was kept');
  // an unfrozen piece changed in place: nothing kept for it, so the change is read
  const before = RD.pieceReadouts(loose).reads[6].corner.turnDeg;
  loose.pieces[5].channels.kh = loose.pieces[5].channels.kh.map((v, j, all) => (j < 2 || j >= all.length - 2 ? v : v * 1.5));
  assert.notEqual(RD.pieceReadouts(loose).reads[6].corner.turnDeg, before, 'piece 5\'s turn changed in place: piece 6\'s corner reads it');
});
