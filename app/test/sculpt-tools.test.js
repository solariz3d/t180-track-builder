// sculpt-tools.test.js: node --test app/test/sculpt-tools.test.js   (under the heavy-run lock)
// D421 Part 2, the shell's half of Sculpt as its own mode (the user's GO 2026-10-20 14:53 on P's design, exo_memory/loop/design_d421_sculpt_P_2026-10-20.md §3-§5; the plan
// exo_memory/loop/plan_d421_sculpt_build_2026-10-20.md Part 2). app/core/coreshell.js: beginBrush({ tool }) resolves a tool to (mode, channel, family); the FAMILY sets the guard (shape:
// the D244b centreline guard; local and route: none); Smooth takes the channel of the tool used last; a ROUTE tool on a CLOSED lap is never closed per step, and on release the
// close runs as a job (the window first, then the whole lap with the window protected, then the drag is dropped by name); the window may be a selected RUN; a radius change
// mid-drag re-runs from the same base; Esc drops a drag. Rows:
//   1  every tool resolves to its mode, channel and family; an unknown tool is refused by name and opens nothing
//   2  the family sets the guard: a shape tool keeps the D244b refusal; a local and a route tool are not guarded, and a route tool does move the road after it
//   3  Smooth's channel is the last tool's; a channel given wins; with none it is refused by name
//   4  a route tool on a CLOSED lap is never closed per step: the lap is open during the drag
//   5  its release: endBrush only starts the job (nothing committed yet); the job lands the re-closed lap as ONE undo step; every piece outside the window is the very same object
//   6  the order: the window close first; refused, the window with the lap's last road piece, then with the last and the first (the seam's two pieces: D421c, the librarian's ruling, which replaced P's item 8
//      widening by a piece each side); refused, the whole-lap close with the window protected; refused again, the drag is dropped whole, named
//  16-20  P's review section 2: Stretch takes the piece under s0 (1); a stale re-close clears its brush (2); a no-change release runs no close (4); D335 per window (5); the tries before the whole lap (20)
//  21  with the real close: a Bend away from the seam, whose window alone is refused, closes with the window and the lap's last piece, and only those pieces and the joints after them change
//   7  the window is the selected RUN: sculptInfo gives from/to and the handles' piece is the run's middle road piece; beginSculpt brushes the run, and nothing outside it changes
//   8  a radius change mid-drag sets the radius and takes no step itself (B's page drives the re-run, P's review item 8); the page's next brushTo re-runs from the same base: the result is a drag at the new radius and that delta, with no accumulation
//   9  Esc (cancelBrush) drops an open drag: the very same document, no undo step
//  10  Stretch hands the core the whole run in ONE call (C's seam, 5b1c49a: stretch(doc, { from, to }, L1, { keepRate }), L1 the run's new road length), keepRate when asked; refused by name with no stretch
//  14  with C's real core: Stretch lengthens the run by exactly the drag's metres, the document stays valid (C1 joints, checkDoc), one undo step
//  15  with C's real core: Smooth after a Bend relaxes the turn channel under the window, one undo step
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell, SCULPT_TOOLS } = require('../core/coreshell.js');
const CL = require('../core/centreline.js');
const SC = require('../../src/core/sculpt.js');

const R = 180, Q = (Math.PI * R) / 2;
/** An open track: a 300 m straight, four quarter turns, a 60 m straight; E's brush unless given. */
async function lap(opts = {}) {
  const s = await createCoreShell({ autosaveMs: 0, ...opts });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  assert.equal(s.getState().message, null, s.getState().message);
  return s;
}
async function closedLap(opts = {}) { const s = await lap(opts); s.close(); assert.equal(s.getState().history.present.closed, true, s.getState().message); return s; }
/** A close runner the test drives: each start() is recorded and answered by `answer(args, n)` ({ out } or { refused }). */
function fakeRunner(answer) {
  const calls = [];
  return { calls, start(args) { calls.push(args); const n = calls.length; return { promise: Promise.resolve(answer(args, n)), cancel() {} }; } };
}
const CJ = require('../core/closejob.js');
/** The real close, answered as the close worker answers (closeworker.js): a refusal is { refused }, never a throw out of start(). */
const realClose = (args) => { try { return { out: CJ.runClose(args), ms: 0 }; } catch (e) { if (e && e.name === 'CoreError') return { refused: { code: e.code || null, message: e.message } }; throw e; } };

test('row 1: every tool resolves to its mode, channel and family; an unknown tool is refused by name and opens nothing', async () => {
  const want = {
    'grab-up': ['local', 'height', 'local'], 'grab-side': ['local', 'lateral', 'local'], stretch: ['stretch', null, 'route'], bend: ['rate', 'kh', 'route'], climb: ['rate', 'kv', 'route'],
    twist: ['rate', 'phi', 'shape'], width: ['rate', 'w', 'shape'], cup: ['rate', 'c', 'shape'], edge: ['rate', 'e', 'shape'], 'edge-right': ['rate', 'er', 'shape'], 'edge-start': ['rate', 's', 'shape'],
    wall: ['rate', 'r', 'shape'], sweep: ['rate', 't', 'shape'], smooth: ['smooth', null, null],
  };
  assert.deepEqual(Object.keys(SCULPT_TOOLS).sort(), Object.keys(want).sort(), 'the 14 tools of the plan');
  for (const [t, [mode, channel, family]] of Object.entries(want)) assert.deepEqual([SCULPT_TOOLS[t].mode, SCULPT_TOOLS[t].channel, SCULPT_TOOLS[t].family], [mode, channel, family], t);
  const s = await lap(), before = s.getState().history.present;
  s.beginBrush({ tool: 'snake-hook', s0: 400, r: 60 });
  assert.equal(s.getState().brush, null); assert.match(s.getState().message, /^BAD_TOOL: "snake-hook" is not a Sculpt tool/); assert.equal(s.getState().history.present, before);
  s.beginBrush({ tool: 'bend', s0: 400, r: 60 });
  assert.deepEqual([s.getState().brush.mode, s.getState().brush.channel, s.getState().brush.family, s.getState().brush.tool], ['rate', 'kh', 'route', 'bend']);
});

test('row 2: the family sets the guard: shape keeps the D244b refusal, local and route are not guarded, and a route tool moves the road after it', async () => {
  // shape: a closed tube's width feeds the route (its heartline is width / 2π), so the guard refuses it by name, as D244b does
  const t = await createCoreShell({ autosaveMs: 0 });
  t.extend({ length: 300, first: { w: 40, t: 360 } }); for (let i = 0; i < 3; i++) t.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); t.extend({ length: 100, transition: 40, targets: { kh: 0 } });
  t.setSculpt(true); t.selectPiece(2); t.beginSculpt({ tool: 'width' }); assert.ok(t.getState().brush, t.getState().message); t.sculptTo(5);
  assert.match(t.getState().message, /^SCULPT_MOVES_CENTRELINE: Sculpt can't do that/, 'the shape family keeps the centreline guard');
  // local: Grab in Sculpt mode is not refused, and the road after the window stays where it was
  const s = await lap(); s.setSculpt(true); const snap = CL.snapshot(s.getState().resolved);
  s.beginBrush({ tool: 'grab-up', s0: 450, r: 80 }); assert.ok(s.getState().brush, s.getState().message); s.brushTo(3); s.endBrush();
  assert.equal(s.getState().brush, null); assert.ok(!/SCULPT/.test(s.getState().message || ''), s.getState().message); assert.notEqual(s.getState().history.present, (await lap()).getState().history.present);
  // route: Bend in Sculpt mode is not refused, and the centreline after the window moves
  const b = await lap(); b.setSculpt(true); const snapB = CL.snapshot(b.getState().resolved);
  b.beginBrush({ tool: 'bend', s0: 450, r: 80 }); assert.ok(b.getState().brush, b.getState().message); b.brushTo(1e-3); b.endBrush();
  assert.ok(!/SCULPT/.test(b.getState().message || ''), b.getState().message); assert.notEqual(CL.pathMoved(snapB, b.getState().resolved), null, 'a route tool moves the road after the window');
  assert.ok(snap.length > 0);
});

test('row 3: Smooth takes the channel of the tool used last; a channel given wins; with none it is refused by name', async () => {
  const smoothFn = (doc, channel, s0, r, lambda) => ({ doc, changed: [], note: `smoothed ${channel}` });
  const s = await lap({ smoothFn });
  s.beginBrush({ tool: 'smooth', s0: 450, r: 80 }); assert.equal(s.getState().brush, null); assert.match(s.getState().message, /^SMOOTH_CHANNEL: /);
  s.beginBrush({ tool: 'bend', s0: 450, r: 80 }); s.brushTo(1e-4); s.endBrush();
  s.beginBrush({ tool: 'smooth', s0: 450, r: 80 }); assert.deepEqual([s.getState().brush.channel, s.getState().brush.family], ['kh', 'route'], 'after Bend: the turn, a route channel'); s.cancelBrush();
  s.beginBrush({ tool: 'twist', s0: 450, r: 80 }); s.brushTo(0.05); s.endBrush();
  s.beginBrush({ tool: 'smooth', s0: 450, r: 80 }); assert.deepEqual([s.getState().brush.channel, s.getState().brush.family], ['phi', 'shape'], 'after Twist: the bank, guarded'); s.cancelBrush();
  s.beginBrush({ tool: 'smooth', channel: 'h', s0: 450, r: 80 }); assert.deepEqual([s.getState().brush.channel, s.getState().brush.family], ['h', 'local'], 'a channel given wins');
});

test('row 4: a route tool on a CLOSED lap is never closed per step: the lap is open during the drag', async () => {
  const s = await closedLap();
  s.beginBrush({ tool: 'bend', s0: 450, r: 80 }); assert.ok(s.getState().brush, s.getState().message);
  for (const d of [2e-4, 5e-4, 1e-3]) { s.brushTo(d); assert.equal(s.getState().history.present.closed, false, `step ${d}: the lap is open while the hand is on it`); assert.equal(s.getState().brush.closing, undefined); }
});

test('row 5: the release only STARTS the job; the job lands the re-closed lap as ONE undo step, every piece outside the window the very same object', async () => {
  const closeRunner = fakeRunner(realClose);
  const s = await closedLap({ closeRunner }), before = s.getState().history.present, n0 = s.getState().history.past.length;
  // a window wide enough to close the lap on its own (pieces 1-5 here; a narrower one is refused and falls back, row 6), so this row is the WINDOW close's
  s.beginBrush({ tool: 'bend', s0: 1100, r: 700 }); s.brushTo(5e-4); const open = s.getState().history.present;
  const at = s.endBrush();
  assert.equal(at.history.present, open, 'the pointer-up handler committed nothing: the open lap is still on show');
  assert.equal(at.brush.closing, true, 'the job is running'); assert.equal(closeRunner.calls.length, 1, 'the handler started the job');
  const done = await s.brushRelease();
  const d = done.history.present;
  assert.equal(done.brush, null, done.message); assert.equal(d.closed, true, done.message); assert.equal(done.history.past.length, n0 + 1, 'ONE undo step for the whole drag and its re-close');
  const win = closeRunner.calls[0].window; assert.ok(Array.isArray(win) && win.length, 'the window close was asked first'); assert.equal(closeRunner.calls.length, 1, 'the window close itself closed it');
  d.pieces.forEach((P, i) => { if (!win.includes(i)) assert.equal(P, open.pieces[i], `piece ${i} is outside the window: the very same object`); });
  s.undo(); assert.equal(s.getState().history.present, before, 'Undo: the lap as it was before the drag');
});

test('row 6: the window close first; refused, the whole-lap close with the window protected; refused again, the drag is dropped whole and named', async () => {
  // refused, then converged: the second job is the whole lap with the window protected
  // AMENDED (D421c, the librarian's ruling on O's window measure): four tries now, the window, + the last piece, + the last and the first, then the whole lap (was three: P's item 8's widening)
  const r1 = fakeRunner((args, n) => (n < 4 ? { refused: { code: 'CLOSE_WINDOW', message: 'close: can\'t close using only the window' } } : realClose(args)));
  const s = await closedLap({ closeRunner: r1 });
  s.beginBrush({ tool: 'bend', s0: 450, r: 80 }); s.brushTo(5e-4); s.endBrush(); const a = await s.brushRelease();
  assert.equal(r1.calls.length, 4); assert.ok(Array.isArray(r1.calls[0].window)); assert.ok(Array.isArray(r1.calls[1].window)); assert.ok(Array.isArray(r1.calls[2].window)); assert.equal(r1.calls[3].whole, true); assert.deepEqual(r1.calls[3].edited, r1.calls[0].window, 'the window is protected');
  assert.equal(a.history.present.closed, true, a.message);
  // refused twice: the drag is dropped whole, by name, and the track is the very one from before the drag
  const r2 = fakeRunner(() => ({ refused: { code: 'CLOSE_WINDOW', message: 'no' } }));
  const t = await closedLap({ closeRunner: r2 }), before = t.getState().history.present, n0 = t.getState().history.past.length;
  t.beginBrush({ tool: 'bend', s0: 450, r: 80 }); t.brushTo(5e-4); t.endBrush(); const b = await t.brushRelease();
  assert.equal(b.history.present, before, 'the track is as it was'); assert.equal(b.history.past.length, n0, 'no undo step'); assert.equal(b.brush, null);
  assert.match(b.message, /^ROUTE_NO_CLOSE: /);
});

test('row 7: the window is the selected RUN: sculptInfo gives from/to and the middle piece; beginSculpt brushes the run, and nothing outside it changes', async () => {
  const s = await lap(); s.setSculpt(true); s.selectPiece(1); s.selectPiece(3, { extend: true });
  const info = s.sculptInfo(); assert.ok(info, 'a run has handles'); assert.deepEqual([info.from, info.to, info.index], [1, 3, 2]);
  const before = s.getState().history.present;
  s.beginSculpt({ tool: 'twist' }); const b = s.getState().brush; assert.ok(b, s.getState().message);
  const off = SC.pieceOffsets(before), lo = off[1], hi = off[3] + before.pieces[3].length;
  assert.ok(Math.abs(b.s0 - (lo + hi) / 2) < 1e-9 && Math.abs(b.r - (hi - lo) / 2) < 1e-9, 'the window is the run');
  s.sculptTo(0.1); s.endSculpt();
  const d = s.getState().history.present; assert.equal(s.getState().message, null, s.getState().message); assert.notEqual(d, before);
  for (const i of [0, 4, 5]) assert.equal(d.pieces[i], before.pieces[i], `piece ${i} is outside the run: the very same object`);
});

test('row 8: a radius change mid-drag takes no step itself, and the next brushTo of the page re-runs from the same base at the new radius, with no accumulation', async () => {
  const s = await lap();
  s.beginBrush({ tool: 'twist', s0: 450, r: 60 }); s.brushTo(0.1); s.brushTo(0.2); const was = s.getState().history.present;
  s.brushRadius(140); assert.equal(s.getState().history.present, was, 'brushRadius alone takes no step (the page drives the re-run)');
  s.brushTo(0.2); const got = s.getState().history.present;
  assert.equal(s.getState().brush.r, 140);
  const t = await lap(); t.beginBrush({ tool: 'twist', s0: 450, r: 140 }); t.brushTo(0.2); const want = t.getState().history.present;
  assert.deepEqual(JSON.parse(JSON.stringify(got.pieces)), JSON.parse(JSON.stringify(want.pieces)), 'the same document as a fresh drag at r = 140');
  s.brushRadius(0); assert.match(s.getState().message, /radius/, 'a radius that is not > 0 is refused by name'); assert.equal(s.getState().brush.r, 140, 'and the drag keeps its radius');
});

test('row 9: Esc (cancelBrush) drops an open drag: the very same document, and no undo step', async () => {
  const s = await lap(), before = s.getState().history.present, n0 = s.getState().history.past.length;
  s.beginBrush({ tool: 'bend', s0: 450, r: 80 }); s.brushTo(1e-3); assert.notEqual(s.getState().history.present, before);
  s.cancelBrush();
  assert.equal(s.getState().brush, null); assert.equal(s.getState().history.present, before); assert.equal(s.getState().history.past.length, n0);
  s.cancelBrush(); assert.equal(s.getState().history.present, before, 'with no drag open it changes nothing');
});

test('row 10: Stretch hands the core ONE factor for the whole run, keepRate when asked; refused by name until the core has stretch', async () => {
  const calls = [];
  const stretchFn = (doc, which, L1, opts) => { calls.push({ which, L1, keepRate: !!(opts && opts.keepRate) }); return { doc, pieces: [], factor: 1, lengthChange: 0, reclose: false }; };
  // B's page sends Stretch as { tool: 'stretch', mode: 'rate', channel: 'length' } (P's review item 8): the tool decides
  const b0 = await lap({ stretchFn: (doc) => ({ doc }) }); b0.beginBrush({ tool: 'stretch', mode: 'rate', channel: 'length', piece: 1 });
  assert.deepEqual([b0.getState().brush.mode, b0.getState().brush.channel, b0.getState().brush.family], ['stretch', null, 'route'], b0.getState().message); b0.cancelBrush();
  const s = await lap({ stretchFn }); s.setSculpt(true); s.selectPiece(1); s.selectPiece(2, { extend: true });
  const d0 = s.getState().history.present, L = d0.pieces[1].length + d0.pieces[2].length;
  s.beginSculpt({ tool: 'stretch', keepRate: true }); assert.ok(s.getState().brush, s.getState().message); s.sculptTo(50);
  assert.equal(calls.length, 1, 'ONE call for the run'); assert.deepEqual(calls[0].which, { from: 1, to: 2 }); assert.ok(Math.abs(calls[0].L1 - (L + 50)) < 1e-9, 'L1 is the new length of the run'); assert.equal(calls[0].keepRate, true);
  s.endSculpt();
  const t = await lap({ stretchFn: null }); t.selectPiece(1); t.beginSculpt({ tool: 'stretch' }); t.setSculpt(true); t.beginSculpt({ tool: 'stretch' });
  assert.equal(t.getState().brush, null); assert.match(t.getState().message, /^NOT_YET: /);
});

test('row 11: the close runner hands the worker the window a route tool\'s release asks for', () => {
  const { createCloseRunner } = require('../core/closerunner.js');
  const posted = [];
  function FakeWorker() { this.postMessage = (m) => posted.push(m); this.terminate = () => {}; }
  const runner = createCloseRunner({ WorkerCtor: FakeWorker });
  runner.start({ doc: { pieces: [] }, window: [2, 3] }).promise.catch(() => {});
  assert.deepEqual(posted[0].window, [2, 3], 'the window rides in the message');
  runner.start({ doc: { pieces: [] } }).promise.catch(() => {});
  assert.ok(!('window' in posted[1]), 'no window asked: none sent, so the message of every other job is what it was (close-worker.test.js row 4)');
});

test('row 12: runClose closes with the window it is given, not the default trailing one', async () => {
  const s = await lap(), open = s.getState().history.present;
  const out = CJ.runClose({ doc: open, window: [1, 2, 3, 4, 5] });
  assert.equal(out.converged, true, out.report);
  assert.deepEqual(out.window.pieces, [1, 2, 3, 4, 5], 'the window given');
  assert.equal(out.doc.pieces[0], open.pieces[0], 'a piece outside it is the very same object');
});

test('row 13: B\'s page: beginSculpt({ channel, from, to }) brushes the run with the shape guard on, and with a tool the tool\'s; a bad run or a steering channel is refused by name', async () => {
  const s = await lap(); s.setSculpt(true); const before = s.getState().history.present;
  s.beginSculpt({ channel: 'phi', from: 1, to: 3 }); const b = s.getState().brush; assert.ok(b, s.getState().message); assert.equal(b.sculpt, true, 'a shape channel on a run keeps the D244b guard');
  const off = SC.pieceOffsets(before), lo = off[1], hi = off[3] + before.pieces[3].length;
  assert.ok(Math.abs(b.s0 - (lo + hi) / 2) < 1e-9 && Math.abs(b.r - (hi - lo) / 2) < 1e-9, 'the window is the run');
  s.sculptTo(0.1); s.endSculpt(); const d = s.getState().history.present; assert.equal(s.getState().message, null, s.getState().message);
  for (const i of [0, 4, 5]) assert.equal(d.pieces[i], before.pieces[i], `piece ${i} is outside the run: the very same object`);
  s.beginSculpt({ channel: 'kh', from: 1, to: 3 }); assert.equal(s.getState().brush, null); assert.match(s.getState().message, /^SCULPT_CHANNEL: /);
  s.beginSculpt({ channel: 'phi', from: 3, to: 99 }); assert.equal(s.getState().brush, null); assert.match(s.getState().message, /^SCULPT_PIECE: /);
  s.beginSculpt({ tool: 'bend', from: 1, to: 3 }); assert.deepEqual([s.getState().brush.tool, s.getState().brush.family], ['bend', 'route'], 'with a tool, the tool decides');
});

test("row 14: with the real core of C, Stretch lengthens the run by exactly the metres of the drag, the document stays valid, one undo step", async () => {
  const D = require('../../src/core/document.js');
  const s = await lap(); s.setSculpt(true); s.selectPiece(1); s.selectPiece(2, { extend: true });
  const before = s.getState().history.present, n0 = s.getState().history.past.length, roadLen = (d) => d.pieces.reduce((a, P) => a + (P.type === 'road' ? P.length : 0), 0);
  s.beginSculpt({ tool: 'stretch' }); assert.ok(s.getState().brush, s.getState().message); s.sculptTo(50); s.endSculpt();
  const d = s.getState().history.present; assert.notEqual(d, before, s.getState().message);
  assert.ok(Math.abs(roadLen(d) - roadLen(before) - 50) < 1e-3, `the road is 50 m longer (${roadLen(d) - roadLen(before)})`);
  assert.doesNotThrow(() => D.checkDoc(d), 'the joints are C1: checkDoc passes'); assert.equal(s.getState().history.past.length, n0 + 1, 'one undo step');
  for (const i of [0, 4, 5]) assert.equal(d.pieces[i].length, before.pieces[i].length, `piece ${i} keeps its length`);
});

test("row 15: with the real core of C, Smooth after a Bend relaxes the turn channel under the window, one undo step", async () => {
  const s = await lap();
  s.beginBrush({ tool: 'bend', s0: 450, r: 80 }); s.brushTo(2e-3); s.endBrush(); const bent = s.getState().history.present, n0 = s.getState().history.past.length;
  // a smooth WIDER than the bump: at the bump's own radius the window's held outer control points leave it one to move (C's smooth, by design)
  s.beginBrush({ tool: 'smooth', s0: 450, r: 300 }); assert.equal(s.getState().brush.channel, 'kh', s.getState().message); s.brushTo(1); s.endBrush();
  const d = s.getState().history.present; assert.notEqual(d, bent, s.getState().message); assert.equal(s.getState().history.past.length, n0 + 1, 'one undo step');
  const kh = (doc) => doc.pieces.flatMap((P) => (P.type === 'road' ? P.channels.kh : []));
  const rough = (a) => a.slice(1, -1).reduce((m, v, i) => m + Math.abs(a[i] - 2 * v + a[i + 2]), 0);
  assert.ok(rough(kh(d)) < rough(kh(bent)), `the turn is smoother: ${rough(kh(d))} < ${rough(kh(bent))}`);
});

// P's review of the shell (p-d421-review-P_2026-10-20.md section 2), items 1, 2, 4, 5 and 8
test("row 16: Stretch with no piece and no run takes the road piece under s0 (B's strip sends neither)", async () => {
  const D = require('../../src/core/document.js');
  const s = await lap(), before = s.getState().history.present, off = SC.pieceOffsets(before);
  s.beginBrush({ tool: 'stretch', mode: 'rate', channel: 'length', s0: off[2] + 30, r: 60 });
  assert.ok(s.getState().brush, s.getState().message); assert.deepEqual(s.getState().brush.span, { from: 2, to: 2 }, 'the piece under s0');
  s.brushTo(20); s.endBrush(); const d = s.getState().history.present;
  assert.ok(Math.abs(d.pieces[2].length - before.pieces[2].length - 20) < 1e-3, 'that piece is 20 m longer'); assert.doesNotThrow(() => D.checkDoc(d));
});

test('row 17: a re-close that outlives its document leaves no brush open: a new document during the release, and every tool still opens', async () => {
  const pending = [];
  const closeRunner = { start(args) { let res; const promise = new Promise((r) => { res = r; }); pending.push(() => res(realClose(args))); return { promise, cancel() {} }; } };
  const s = await closedLap({ closeRunner });
  s.beginBrush({ tool: 'bend', s0: 450, r: 80 }); s.brushTo(5e-4); s.endBrush(); assert.equal(s.getState().brush.closing, true);
  s.newDoc('fresh');   // the history replaced wholesale while the re-close works
  pending.shift()(); await s.brushRelease();
  assert.equal(s.getState().brush, null, 'the stale re-close cleared its brush'); assert.equal(s.getState().history.present.pieces.length, 0, 'the new document stands');
  s.extend({ length: 300, family: 'bowl' }); s.beginBrush({ tool: 'twist', s0: 100, r: 60 }); assert.ok(s.getState().brush, s.getState().message);
});

test('row 18: a release with no change restores the lap as it was and runs no close', async () => {
  for (const step of [null, 0]) {
    const closeRunner = fakeRunner(realClose);
    const s = await closedLap({ closeRunner }), before = s.getState().history.present, n0 = s.getState().history.past.length;
    s.beginBrush({ tool: 'bend', s0: 450, r: 80 }); if (step !== null) s.brushTo(step); s.endBrush();
    assert.equal(s.getState().brush, null, `step ${step}: no job left open`); assert.equal(closeRunner.calls.length, 0, `step ${step}: no close was run`);
    assert.equal(s.getState().history.present, before, `step ${step}: the very lap from before`); assert.equal(s.getState().history.past.length, n0, `step ${step}: no undo step`);
  }
});

test('row 19: a handle on a two- or three-piece run lands the value asked where the handles read it, as exactly as D335 lands one piece (D335 per window)', async () => {
  // measured (d335-run.*.json): before item 5 a two-piece run landed 0.1 of 0.2 (read at its middle piece's middle); read at the run's centre it lands 0.2; without the ratio there a
  // three-piece run lands 0.199957, so the bar is D335's own exactness, 1e-5, not a looser one that would pass with no ratio at all
  for (const [from, to] of [[1, 2], [1, 3]]) {
    const s = await lap(); s.setSculpt(true); s.selectPiece(from); s.selectPiece(to, { extend: true });
    const v0 = s.sculptInfo().values.phi;
    s.beginSculpt({ channel: 'phi', from, to }); s.sculptTo(0.2); s.endSculpt();
    const got = (s.sculptInfo().values.phi - v0) * Math.PI / 180;
    assert.ok(Math.abs(got - 0.2) < 1e-5, `run ${from}-${to}: the handle asked 0.2 rad and reads ${got}`);
  }
});

test('row 20: the release tries the window, then the window with the lap\'s last road piece, then with the last and the first, then the whole lap with the window protected', async () => {
  // AMENDED (D421c, the librarian's ruling on O's window measure, exo_memory/handback/p-d421c-window-O_2026-10-20.md): a window widened by pieces either side never closed a lap
  // away from its seam (+1 to +8 all refused on row 3's lap, ~90 ms each); a window holding a piece beside the seam did. Was: the window widened by one piece each side (P's item 8).
  const r = fakeRunner((args, n) => (n < 4 ? { refused: { code: 'CLOSE_WINDOW', message: 'no' } } : realClose(args)));
  const s = await closedLap({ closeRunner: r });
  s.beginBrush({ tool: 'bend', s0: 450, r: 80 }); s.brushTo(5e-4); s.endBrush(); const a = await s.brushRelease();
  const P = a.history.present.pieces, road = P.map((x, i) => (x.type === 'road' ? i : -1)).filter((i) => i >= 0), last = road[road.length - 1], first = road[0];
  assert.equal(r.calls.length, 4); const w = r.calls[0].window, sorted = (xs) => [...new Set(xs)].sort((x, y) => x - y);
  assert.ok(!w.includes(last) && !w.includes(first), 'control: the window holds neither seam piece');
  assert.deepEqual(r.calls[1].window, sorted([...w, last]), 'then the window and the last road piece');
  assert.deepEqual(r.calls[2].window, sorted([...w, last, first]), 'then the window and both pieces beside the seam');
  assert.equal(r.calls[3].whole, true); assert.deepEqual(r.calls[3].edited, w, 'the whole lap protects the window the drag changed');
  assert.equal(a.history.present.closed, true, a.message);
  // a window that already holds the last piece is not tried twice: the window, then + the first, then the whole lap
  const r2 = fakeRunner((args, n) => (n < 3 ? { refused: { code: 'CLOSE_WINDOW', message: 'no' } } : realClose(args)));
  const t = await closedLap({ closeRunner: r2 }), n = t.getState().history.present.pieces.length;
  t.beginBrush({ tool: 'bend', s0: t.getState().history.present.pieces.slice(0, n - 1).reduce((x, p) => x + p.length, 0) + 30, r: 20 }); t.brushTo(5e-4); t.endBrush(); await t.brushRelease();
  const w2 = r2.calls[0].window; assert.ok(w2.includes(n - 1), 'control: this window holds the last piece');
  assert.equal(r2.calls.length, 3); assert.deepEqual(r2.calls[1].window, sorted([...w2, 0]), 'then + the first'); assert.equal(r2.calls[2].whole, true);
});

test('row 21: with the real close, a Bend away from the seam whose window alone is refused closes with the window and the lap\'s last piece; only those and the joints after them change', async () => {
  const r = fakeRunner((args) => realClose(args));
  const s = await closedLap({ closeRunner: r });
  s.beginBrush({ tool: 'bend', s0: 450, r: 80 }); s.brushTo(3e-4);
  const open = s.getState().history.present; s.endBrush(); const a = await s.brushRelease();
  assert.equal(a.history.present.closed, true, a.message);
  const w = r.calls[0].window, last = open.pieces.length - 1;
  assert.ok(r.calls[0].window && r.calls.length === 2, `the window was refused and the second try closed (${r.calls.length} tries)`);
  assert.deepEqual(r.calls[1].window, [...new Set([...w, last])].sort((x, y) => x - y), 'the second try is the window and the last piece');
  const moved = new Set([...w, last]); for (const i of [...moved]) moved.add((i + 1) % open.pieces.length);   // a moved piece rebuilds the joint of the piece after it (round the seam for the last)
  a.history.present.pieces.forEach((P, i) => { if (!moved.has(i)) assert.equal(P, open.pieces[i], `piece ${i} is outside the window, the last piece and their joints: the very same object`); });
});
// D464 (D463 part 2 item 5, E's D461 report §2 item 5): A ROUTE RELEASE THAT TAKES THE DRAG BACK SAYS SO. On a closed lap the re-close may have to move the very piece the tool
// changed: at the seam (the first road piece) only the two pieces beside the start line can close the lap, and the last alone is refused, so the close re-solves the bent piece and
// the bend is gone (E's D461 run: -11 deg/100 m shown on p1, noise of +-0.0005 rad/m after, and the message said only "the lap is closed again"). The share kept is the drag's own
// change in the window's channel that the closed lap still holds (a least-squares projection: 1 = all of it, 0 = none). Under half: the bend was undone, and the message says so
// with what to do; under 0.9: the message says how much was taken back; otherwise the message is as before.
const keptShare = (base, open, closed, idx, ch) => { let num = 0, den = 0; for (const i of idx) { const b = base.pieces[i].channels[ch], o = open.pieces[i].channels[ch], c = closed.pieces[i].channels[ch]; for (let k = 0; k < b.length; k++) { const d = o[k] - b[k]; num += (c[k] - b[k]) * d; den += d * d; } } return num / den; };

test('row 22 (D464): a Bend on the seam piece, which the re-close takes back, says plainly that it was undone and what to do', async () => {
  const s = await closedLap({ closeRunner: fakeRunner((args) => realClose(args)) });
  const base = s.getState().history.present;
  s.beginBrush({ tool: 'bend', s0: 150, r: 80 }); s.brushTo(3e-4);
  const open = s.getState().history.present, win = s.getState().brush.changedPieces;
  s.endBrush(); const a = await s.brushRelease();
  assert.equal(a.history.present.closed, true, a.message);
  assert.deepEqual(win, [0], 'the bend is on the seam piece');
  const kept = keptShare(base, open, a.history.present, win, 'kh');
  assert.ok(kept < 0.5, `the close takes the bend back (kept ${kept.toFixed(3)})`);
  assert.match(a.message, /your bend was undone to close the lap; bend further from the start, or open the lap first/, a.message);
});

test('row 23 (D464): a Bend away from the seam that the re-close partly takes back says how much', async () => {
  const s = await closedLap({ closeRunner: fakeRunner((args) => realClose(args)) });
  const base = s.getState().history.present;
  s.beginBrush({ tool: 'bend', s0: 450, r: 80 }); s.brushTo(3e-4);
  const open = s.getState().history.present, win = s.getState().brush.changedPieces;
  s.endBrush(); const a = await s.brushRelease();
  const kept = keptShare(base, open, a.history.present, win, 'kh');
  assert.ok(kept >= 0.5 && kept < 0.9, `part of the bend is taken back (kept ${kept.toFixed(3)})`);
  const pct = Math.round((1 - kept) * 100);
  assert.match(a.message, new RegExp(`closing it took back ${pct}% of your bend`), a.message);
  assert.ok(!/undone/.test(a.message), a.message);
});

test('row 24 (D464): a re-close that keeps the drag says only that the lap is closed again', async () => {
  // the runner answers with the dragged lap itself, closed: every bit of the bend is kept
  const s = await closedLap({ closeRunner: fakeRunner((args) => ({ out: { converged: true, doc: { ...args.doc, closed: true }, report: 'kept as dragged' } })) });
  s.beginBrush({ tool: 'bend', s0: 450, r: 80 }); s.brushTo(3e-4);
  s.endBrush(); const a = await s.brushRelease();
  assert.equal(a.message, 'the lap is closed again: kept as dragged');
});
