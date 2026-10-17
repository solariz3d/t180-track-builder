// core_close_best.test.js: node --test test/core_close_best.test.js
// D339: CLOSE IS ONE PRESS (app/core/closejob.js runCloseBest; the ruling: "one single press and the algo runs it"). Every route is run on the open track and
// one is picked by a fixed order: the closed lap must prove and add no new red; then no new road; then the least movement (the most-moved piece). Rows:
//   1  an end already at the start: the near-closed bend, no new road, nothing moved; Finish is not even tried
//   2  the band past D337's 1 m gate: ends 2, 5 and 10 m past the start, and 5 m short of it, close by a bend, never by a loop of new road
//   3  new road only when no bend proves: a far end gets Finish, and every other route was refused or failed; a near one does not, though Finish closed it
//   4  none proves: no document, and one line that says nothing changed and why, with the closest way's reason
//   5  a bend that would reshape the track (move it further than the gap plus 10 m) is not eligible, and new road is laid instead
//   6  the reported save (fixtures-d337, uncommitted: a private track; skipped with the reason when absent): one press bends its last 2 pieces by up to 4.0 m
//   7  the pick is the least-moving way that proves (every way that moves the track less was refused or shown to fail)
//   8  the order itself (closejob.js byOrder): no new road first, even against no movement at all; then the least movement; within a millimetre, the route order
//   9  (D343) the near bend first: when it proves, no other route runs
//  10  (D343) the fast pick is the exhaustive order's on every track (route, words, closed track)
//  11  (D343) given the open track's reds, the open track is not checked again, and the pick is the same
//  12  (D343) the reported save (fixture): one press with the live checker's reds, under 30 s, and the same pick as a press that checks the open track itself
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { extendTurnBy } = require('../src/core/turnby.js');
const F = require('../src/core/finish.js');
const { residual } = require('../src/core/close.js');
const CJ = require('../app/core/closejob.js');

const DEG = Math.PI / 180;
/** Three quarter turns: its end is 795.6 m from its start, a quarter turn short. */
function quarterTrack() {
  let d = D.createDoc('quarter');
  d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: 300 }, 90 * DEG); d = extend(d, { length: 600 }); d = extendTurnBy(d, { length: 300 }, 90 * DEG); d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: 300 }, 90 * DEG);
  return d;
}
/** quarterTrack finished and opened again: its end is exactly on its start (its last two pieces are a 600 m straight and a 300 m quarter turn). */
const onStart = () => ({ ...F.finishToStart(quarterTrack()).doc, closed: false });
/** onStart with its end `g` m past the start (a straight of g m on). */
const past = (g) => extend(onStart(), { length: g, targets: { kh: 0, kv: 0 } });
/** onStart with its last straight `g` m shorter, so the end is g m short of the start, off to the side. */
function short(g) {
  const o = onStart(), n = o.pieces.length;
  let d = { ...o, pieces: o.pieces.slice(0, n - 2) };
  d = extend(d, { length: o.pieces[n - 2].length - g, targets: { kh: 0, kv: 0 } });
  return extendTurnBy(d, { length: o.pieces[n - 1].length, targets: { kv: 0 } }, 90 * DEG);
}
const routeOf = (r, name) => r.tried.find((t) => t.route === name);

test('row 1: an end already at the start: one press is the near-closed bend, with no new road and nothing moved; Finish is not even tried', () => {
  const open = onStart(), r = CJ.runCloseBest({ doc: open });
  assert.equal(r.converged, true, r.report); assert.equal(r.route, 'near', r.report);
  assert.equal(r.doc.closed, true); assert.equal(r.doc.pieces.length, open.pieces.length, 'no new road');
  assert.ok(r.displacement.every((x) => x.maxM <= 1e-3), 'nothing moved more than 1 mm');
  assert.match(r.report, /^closed: /);
  assert.equal(routeOf(r, 'finish'), undefined, 'Finish is not tried when the end is already at the start');
  assert.equal(routeOf(CJ.runCloseBest({ doc: open, exhaustive: true }), 'finish'), undefined, 'not even when every route is run (D343: the fast path stops at the bend)');
});

test('row 2: ends 2, 5 and 10 m past the start, and 5 m short of it, close by a bend: no new road, no loop', () => {
  for (const [what, doc] of [['2 m past', past(2)], ['5 m past', past(5)], ['10 m past', past(10)], ['5 m short', short(5)]]) {
    const gap = residual(doc).gapM;
    assert.ok(gap > 1.5 && gap < 10.5, `${what}: the gap is ${gap} m`);
    const r = CJ.runCloseBest({ doc });
    assert.equal(r.converged, true, `${what}: ${r.report}`);
    assert.equal(r.doc.pieces.length, doc.pieces.length, `${what}: no new road (${r.report})`);
    assert.notEqual(r.route, 'finish', what);
    assert.ok(r.displacement.every((x) => x.maxM <= gap + 10), `${what}: nothing moved past the gap and 10 m: ${r.report}`);
  }
});

test('row 3: new road only when no bend proves: a far end gets Finish (every other route refused or failed); a near end does not, though Finish closed it', () => {
  const far = CJ.runCloseBest({ doc: quarterTrack() });
  assert.equal(far.route, 'finish', far.report);
  assert.match(far.report, /^closed: laid \d+ m of new road from the end to the start/);
  for (const t of far.tried.filter((x) => x.route !== 'finish')) assert.ok(t.refused || t.miss, `${t.route} would have been picked: ${JSON.stringify(t)}`);
  const near = CJ.runCloseBest({ doc: past(5) }), fin = routeOf(near, 'finish');
  assert.ok(fin && !fin.refused && fin.newRoadM > 0, `Finish closed the 5 m end too, with new road: ${JSON.stringify(fin)}`);
  assert.notEqual(near.route, 'finish', near.report);
});

test('row 4: when no way proves, there is no document, and one line says nothing changed and why, with the closest way\'s reason', () => {
  // a coil: 300 m and eight quarter turns of 180 m (two circles on one another), then 60 m; every way of closing it meets the road below (a stacked red)
  const R = 180, Q = (Math.PI * R) / 2;
  let d = extend(D.createDoc('coil'), { length: 300, family: 'bowl' }); for (let i = 0; i < 8; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } }); d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = CJ.runCloseBest({ doc: d });
  assert.equal(r.converged, false, r.report); assert.equal(r.doc, null);
  assert.match(r.report, /^not closed, nothing changed: no way of closing the loop proves the lap; the closest, .+: (the lap does not prove|it adds \d+ reds?)/);
});

test('row 5: a bend that would move the track further than its gap and 10 m is not eligible, and new road is laid instead', () => {
  const r = CJ.runCloseBest({ doc: quarterTrack() }), whole = routeOf(r, 'whole'), gap = residual(quarterTrack()).gapM;
  assert.ok(whole && whole.refused && /past the .* a close may move it/.test(whole.refused) && whole.maxMoveM > gap + 10, `the whole lap moves it ${whole && whole.maxMoveM} m: ${JSON.stringify(whole)}`);
  assert.equal(r.route, 'finish');
});

test('row 7: the pick is the least-moving way that proves: every way that would move the track less was refused or failed the lap proof or added a red', () => {
  for (const [what, doc] of [['2 m past', past(2)], ['5 m past', past(5)], ['10 m past', past(10)], ['5 m short', short(5)], ['on the start', onStart()]]) {
    const r = CJ.runCloseBest({ doc }), picked = r.tried.find((t) => t.route === r.route);
    assert.ok(picked, `${what}: ${r.report}`);
    for (const t of r.tried) {
      if (t.route === r.route || t.refused || t.newRoadM > 0 || !(t.maxMoveM < picked.maxMoveM - 1e-3)) continue;
      assert.ok(t.lapOk === false || t.newReds > 0, `${what}: ${t.route} moves the track less (${t.maxMoveM} m against ${picked.maxMoveM} m) and was not shown to fail: ${JSON.stringify(t)}`);
    }
  }
});

test('row 8: the order: no new road first (even when the new road moves nothing), then the least movement, and within a millimetre the route order', () => {
  const c = (name, newPieces, maxMoveM, rank) => ({ name, newPieces, maxMoveM, rank });
  const sorted = [c('new road', 2, 0, 5), c('wide', 0, 9, 3), c('bend', 0, 4, 0), c('window', 0, 4.0004, 1), c('whole', 0, 3.9999, 4)].sort(CJ.byOrder).map((x) => x.name);
  assert.deepEqual(sorted, ['bend', 'window', 'whole', 'wide', 'new road'], 'the bend, the window and the whole lap move within 1 mm of each other, so the route order decides; new road is last although it moves nothing');
  assert.deepEqual([c('far', 0, 6, 0), c('near', 0, 2, 1)].sort(CJ.byOrder).map((x) => x.name), ['near', 'far'], 'past a millimetre, less movement wins whatever the route order');
});

const FX = path.join(__dirname, '..', 'fixtures-d337', 'pre-close.t180track');
test('row 6: the reported near-closed save: one press bends its last 2 pieces by up to 4.0 m, with no new road, and the lap proves', { skip: fs.existsSync(FX) ? false : 'fixtures-d337/pre-close.t180track is not here (a private track, kept off the repository)' }, () => {
  const base = D.parse(fs.readFileSync(FX, 'utf8')), r = CJ.runCloseBest({ doc: base });
  assert.equal(r.route, 'near', r.report);
  assert.equal(r.report, 'closed: bent the last 2 pieces (508 m) by up to 4.0 m');
  assert.equal(r.doc.pieces.length, base.pieces.length);
  assert.equal(routeOf(r, 'near').lapOk, true, 'the lap proves'); assert.equal(routeOf(r, 'near').newReds, 0, 'and adds no red');
});

// ── D343: the one press made fast. The open track's reds come from the page's live checker when it checked this very track; the near bend is closed and checked
// first, and when it proves nothing else runs. The pick must be the exhaustive order's (D339's: every route run, then ranked) on every track.
const coilDoc = () => { const R = 180, Q = (Math.PI * R) / 2; let d = extend(D.createDoc('coil'), { length: 300, family: 'bowl' }); for (let i = 0; i < 8; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } }); return extend(d, { length: 60, transition: 40, targets: { kh: 0 } }); };
const stadiumBehind = (g) => { let d = D.createDoc('stadium'); d = extend(d, { length: 400 }); d = extendTurnBy(d, { length: 1000 }, 180 * DEG); d = extend(d, { length: 400 + g }); return extendTurnBy(d, { length: 1000 }, 180 * DEG); };
/** The open track's reds as the page's live checker holds them (its own job, app/validate-ui/checkjob.js, with CSP on), as { reason, s }: what a press is handed. */
const openRedsOf = (doc) => require('../app/validate-ui/checkjob.js').createCheckJob().run({ doc: { ...doc, closed: false }, csp: true }).result.red.map((x) => ({ reason: x.reason, s: x.s ?? x.s0 ?? 0 }));

test('row 9: when the end is at the start, the near bend is closed and checked first, and once it proves no other route is run', () => {
  const r = CJ.runCloseBest({ doc: onStart() });
  assert.equal(r.route, 'near', r.report);
  assert.deepEqual(r.tried.map((t) => t.route), ['near'], 'only the near bend ran');
  const all = CJ.runCloseBest({ doc: onStart(), exhaustive: true });
  assert.ok(all.tried.length >= 5, `the exhaustive order runs every route: ${all.tried.map((t) => t.route)}`);
});

test('row 10: the pick is the exhaustive order\'s on every track: the same route, the same words, the same closed track', () => {
  for (const [what, make] of [['on the start', onStart], ['2 m past', () => past(2)], ['5 m past', () => past(5)], ['10 m past', () => past(10)], ['5 m short', () => short(5)], ['far', quarterTrack], ['a coil', coilDoc], ['20 m behind', () => stadiumBehind(20)]]) {
    const fast = CJ.runCloseBest({ doc: make() }), all = CJ.runCloseBest({ doc: make(), exhaustive: true });
    assert.equal(fast.route, all.route, `${what}: ${fast.report} / ${all.report}`); assert.equal(fast.report, all.report, what);
    assert.equal(fast.doc ? D.serialize(fast.doc) : null, all.doc ? D.serialize(all.doc) : null, `${what}: the same closed track`);
  }
});

test('row 11: given the open track\'s reds, the press does not check the open track, and picks exactly as it does without them', () => {
  const doc = coilDoc(), plain = CJ.runCloseBest({ doc }), given = CJ.runCloseBest({ doc, openReds: openRedsOf(doc) });
  assert.ok(plain.phases.openCheckMs !== null, 'without them the open track is checked (a closed lap that proves has a red)');
  assert.equal(given.phases.openCheckMs, null, 'given them, it is not'); assert.equal(given.phases.openReds, 'given');
  assert.equal(given.report, plain.report); assert.equal(given.route, plain.route);
});

const FX12 = path.join(__dirname, '..', 'fixtures-d337', 'pre-close.t180track');
test('row 12: the reported save: one press, with the reds the live checker found, closes in under 30 s, and picks as a press without them does', { skip: fs.existsSync(FX12) ? false : 'fixtures-d337/pre-close.t180track is not here (a private track, kept off the repository)' }, (t) => {
  // each in its own process, as the app runs them: the live checker in its worker, then the press in the close worker. In one process with the checker's job and
  // rows 1-11, the press read 53 s of CPU in the full suite for what takes 25 s alone (the heap they leave behind). The bound is on the press's own CPU time:
  // a wall clock in a suite that runs four files at once, on a machine other seats share, measures the machine, and so does the process's CPU time, which adds
  // the garbage collector's threads (33.5 s for 27.1 s wall in the suite): the bound is the main thread's CPU (process.threadCpuUsage), the others reported beside it
  const own = (code) => { const p = cp.spawnSync(process.execPath, ['-e', code, FX12], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 1 << 28 }); assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout); };
  const load = "const fs = require('fs'), D = require('./src/core/document.js'), base = D.parse(fs.readFileSync(process.argv[1], 'utf8'));";
  const openReds = own(load + " process.stdout.write(JSON.stringify(require('./app/validate-ui/checkjob.js').createCheckJob().run({ doc: { ...base, closed: false }, csp: true }).result.red.map((x) => ({ reason: x.reason, s: x.s ?? x.s0 ?? 0 }))));");
  const r = own(load + ` const reds = ${JSON.stringify(openReds)}, CJ = require('./app/core/closejob.js'), c0 = process.cpuUsage(), h0 = process.threadCpuUsage(), t0 = Date.now(), r = CJ.runCloseBest({ doc: base, openReds: reds }), ms = Date.now() - t0, h = process.threadCpuUsage(h0), c = process.cpuUsage(c0);`
    + " process.stdout.write(JSON.stringify({ report: r.report, routes: r.tried.map((t) => t.route), phases: r.phases, ms, cpuMs: (c.user + c.system) / 1000, mainMs: (h.user + h.system) / 1000, doc: D.serialize(r.doc) }));");
  assert.equal(r.report, 'closed: bent the last 2 pieces (508 m) by up to 4.0 m'); assert.deepEqual(r.routes, ['near']); assert.equal(r.phases.openCheckMs, null, 'the given reds: no open check');
  t.diagnostic(`main thread ${Math.round(r.mainMs)} ms CPU, process ${Math.round(r.cpuMs)} ms CPU, ${r.ms} ms wall; routes ${r.phases.routesMs}, checks ${r.phases.checksMs}`);
  assert.ok(r.mainMs < 30000, `one press used ${Math.round(r.mainMs)} ms of its main thread's CPU (${Math.round(r.cpuMs)} ms with the collector's threads, ${r.ms} ms wall; routes ${r.phases.routesMs}, checks ${r.phases.checksMs})`);
  const self = CJ.runCloseBest({ doc: D.parse(fs.readFileSync(FX12, 'utf8')) });
  assert.equal(self.report, r.report, 'a press that checks the open track itself picks the same'); assert.equal(D.serialize(self.doc), r.doc);
});
