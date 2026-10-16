// closejob.js: THE CLOSE'S WORK, as one pure job (2026-10-15: Close's "new road from the end to the start" held the window 4.1 s on a 24 km track; it now runs in
// app/core/closeworker.js, as the track checker went in 7512f84). The shell runs it on the page when it has no worker, so both ways compute the same thing:
//
//   runClose({ doc, fraction, last, whole, finish, edited })  -> { converged, report, doc, window, displacement }   (plain data, survives a postMessage)
//     doc        the open track as the shell holds it
//     edited     whole: true only: the pieces the whole-lap close goes round (the shell knows the stretch edited last)
//   A core refusal (CoreError) is thrown, as close() and finishToStart() throw it.
//
//   runCloseBest({ doc, edited })  -> { converged, report, doc, window, displacement, route, tried }   (D339: Close is ONE press)
//     Runs every route there is on the open track: the near-closed bend (an end already at the start, src/core/finish.js isNear), the last piece, the last
//     ~20% and ~40% of the lap, the whole lap (round `edited`), and new road from the end to the start (Finish; not tried when the end is already at the start:
//     its answer there IS the bend). It then picks ONE by a fixed order: (1) the closed lap must PROVE (the checker's lap proof) and add no red the open track
//     did not have; then (2) the one that adds no new road; then (3) the one whose most-moved piece moves least. New road is chosen only when no bend proves.
//     `report` is the one line the user reads ("closed: bent the last 2 pieces (508 m) by up to 4.0 m"). When none proves: converged false, nothing to apply,
//     and `report` says so with the best near-miss's reason. `tried` is every route's outcome, for the tests and the hand-back.
//     The cost is in the checker: the routes are all closed first, ranked, and only then validated in rank order until one proves (most presses validate one).
//
//   relink(base, doc)  the answer's document after a postMessage, with every piece that is the same as the open track's taken back as THAT object (the shell's
//                      segment cache and the tests know a piece by its object: Finish to start leaves the user's pieces as the very same ones), and frozen as the core's are
'use strict';

const AD = require('../../src/core/adapter.js');
const { toSegments } = AD;
const { close, closeWindow, residual } = require('../../src/core/close.js');
const { finishToStart, isNear } = require('../../src/core/finish.js');
const { validate } = require('../../src/validate/index.js');

function runClose({ doc, fraction = 0.2, last = false, whole = false, finish = false, edited = null, best = false } = {}) {
  if (best) return runCloseBest({ doc, edited });
  const fin = finish ? finishToStart(doc) : null;
  const res = fin ? { converged: true, doc: fin.doc, report: `Finish to start: ${fin.plan.report}`, window: { pieces: fin.window, text: fin.plan.windowText || `the new road (${fin.window.length} piece${fin.window.length === 1 ? '' : 's'}, ${fin.plan.lengthM} m)` } }
    : whole ? close(doc, { edited }) : close(doc, { window: closeWindow(doc, { fraction, last }) });
  if (!res.converged) return { converged: false, report: res.report, doc: null, window: null, displacement: null };
  return { converged: true, report: res.report, doc: res.doc, window: res.window, displacement: displacementOf(doc, res.doc) };
}


// THE ONE PRESS (D339). A red the closed lap has is NEW when the open track had no red of the same reason within RED_NEAR_M of it along the road (the pieces before
// a close keep their lengths, so their stations keep their s; a bend may shift where a red is counted by a few metres).
// A BEND MAY NOT RESHAPE THE TRACK (D242: a close that moved every piece by hundreds of metres wrecked the track the user built, which is why the windowed
// closes came in). A route that adds no road is eligible only when its most-moved piece moves no further than the end's gap to the start plus MOVE_FLOOR_M:
// closing a gap of g slides the end g (a window that closes moves its last station by just that, to a hair over it), and the 10 m covers turning out a few
// degrees of heading or pitch on the way (on ELYSIUM, 2.7° of pitch over the last 508 m moves them 4 m). Measured on a test lap 3 quarter turns round (its end
// 795.6 m from the start), the whole-lap close proves but moves pieces 883 m: past this, so new road is laid instead. MOVE_TIE_M: movements within a millimetre are equal, and the route order breaks the tie (the bend, the last piece, the wider windows).
// CLOSE_ITER: a route that will close does so in a few steps (2 for every route that closed on ELYSIUM and on the test laps); one that will not would run
// Close's 30, about 40 s on a 25 km track, for nothing. 8 is four times what a closing route took.
const RED_NEAR_M = 10, CHECK = Object.freeze({ fullSpeed: true, csp: true }), MOVE_FLOOR_M = 10, MOVE_TIE_M = 1e-3, CLOSE_ITER = 8;
const redsOf = (d) => { const { path } = AD.toPath(d), v = validate(path, toSegments(d), CHECK); return { lap: v.lap, reds: (v.red || []).map((x) => ({ reason: x.reason, s: x.s ?? x.s0 ?? 0 })) }; };
const fmtM = (m) => (m >= 100 ? `${Math.round(m)} m` : `${(Math.round(m * 10) / 10).toFixed(1)} m`);
function runCloseBest({ doc, edited = null } = {}) {
  const road = doc.pieces.filter((P) => P.type === 'road'), near = road.length ? isNear(doc) : false, tried = [], gapM = road.length ? residual(doc).gapM : 0, moveCap = gapM + MOVE_FLOOR_M;
  const routes = [];
  if (near) routes.push({ route: 'near', run: () => { const f = finishToStart(doc); return { converged: true, doc: f.doc, report: f.plan.report, window: f.window, plan: f.plan }; } });
  routes.push({ route: 'last', run: () => close(doc, { window: closeWindow(doc, { last: true }), maxIter: CLOSE_ITER }) });
  routes.push({ route: 'fraction 0.2', run: () => close(doc, { window: closeWindow(doc, { fraction: 0.2 }), maxIter: CLOSE_ITER }) });
  routes.push({ route: 'fraction 0.4', run: () => close(doc, { window: closeWindow(doc, { fraction: 0.4 }), maxIter: CLOSE_ITER }) });
  routes.push({ route: 'whole', run: () => close(doc, { edited: edited || [doc.pieces.length - 1], maxIter: CLOSE_ITER }) });
  if (!near) routes.push({ route: 'finish', run: () => { const f = finishToStart(doc); return { converged: true, doc: f.doc, report: f.plan.report, window: f.window, plan: f.plan }; } });
  for (const R of routes) {
    let res; const t0 = Date.now();
    try { res = R.run(); } catch (e) { if (!e || e.name !== 'CoreError') throw e; tried.push({ route: R.route, refused: e.message, ms: Date.now() - t0 }); continue; }
    if (!res || !res.converged) { tried.push({ route: R.route, refused: (res && res.report) || 'it did not close', ms: Date.now() - t0 }); continue; }
    const displacement = displacementOf(doc, res.doc), maxMoveM = displacement.reduce((m, x) => Math.max(m, x.maxM), 0);
    const newRoadM = res.doc.pieces.slice(doc.pieces.length).reduce((a, P) => a + (P.length || 0), 0);
    const newPieces = res.doc.pieces.length - doc.pieces.length;
    if (newPieces === 0 && maxMoveM > moveCap) { tried.push({ route: R.route, refused: `it would move the track up to ${fmtM(maxMoveM)}, past the ${fmtM(moveCap)} a close may move it`, maxMoveM, ms: Date.now() - t0 }); continue; }
    tried.push({ route: R.route, doc: res.doc, report: res.report, window: res.window, plan: res.plan, displacement, maxMoveM, newRoadM, newPieces, rank: tried.length, ms: Date.now() - t0 });
  }
  // THE ORDER: no new road first, then the least movement by the most-moved piece; the route order breaks a tie (the bend, then the shorter windows)
  const closed = tried.filter((t) => t.doc).sort(byOrder);
  let open = null, firstMiss = null;
  for (const t of closed) {
    const t2 = Date.now(), c = redsOf(t.doc); t.checkMs = Date.now() - t2;
    t.lap = c.lap && { ok: c.lap.ok, reason: c.lap.reason, where: (c.lap.where || []).slice(0, 3) };
    // the open track is checked only when it can matter (once, and only if a closed lap that proves has any red at all): the checker is most of a press's cost
    if (c.lap && c.lap.ok === true && c.reds.length && !open) { const t1 = Date.now(); open = redsOf({ ...doc, closed: false }); open.ms = Date.now() - t1; }
    t.newReds = !c.reds.length ? [] : open ? c.reds.filter((x) => !open.reds.some((o) => o.reason === x.reason && Math.abs(o.s - x.s) <= RED_NEAR_M)) : c.reds;
    if (c.lap && c.lap.ok === true && !t.newReds.length) {
      const report = wordsOf(doc, t);
      return { converged: true, report, doc: t.doc, window: windowOf(doc, t), displacement: t.displacement, route: t.route, tried: summary(tried), openCheckMs: open ? open.ms : null };
    }
    t.miss = c.lap && c.lap.ok !== true ? `the lap does not prove${c.lap.where && c.lap.where.length ? ` (${c.lap.where[0].reason || 'it fails'} at ${((c.lap.where[0].s || 0) / 1000).toFixed(2)} km)` : c.lap.reason ? ` (${c.lap.reason})` : ''}`
      : `it adds ${t.newReds.length} red${t.newReds.length === 1 ? '' : 's'} (${t.newReds[0].reason} at ${(t.newReds[0].s / 1000).toFixed(2)} km)`;
    if (!firstMiss) firstMiss = t;
  }
  const why = firstMiss ? `${routeWords(doc, firstMiss)}: ${firstMiss.miss}` : (tried.find((t) => t.route === 'near') || tried.find((t) => t.route === 'finish') || tried[0] || { refused: 'there is nothing to close' }).refused;
  return { converged: false, report: `not closed, nothing changed: no way of closing the loop proves the lap; the closest, ${why}`, doc: null, window: null, displacement: null, route: null, tried: summary(tried), openCheckMs: open ? open.ms : null };
}
/** THE ORDER, as a comparator over the routes that closed ({ newPieces, maxMoveM, rank }): no new road first; then the least movement of the most-moved piece; within
 *  MOVE_TIE_M, the route order (rank). Whether a route proves is not in it: the routes are checked in this order, and the first that proves is the pick. */
const byOrder = (a, b) => ((a.newPieces > 0) - (b.newPieces > 0)) || (Math.abs(a.maxMoveM - b.maxMoveM) > MOVE_TIE_M ? a.maxMoveM - b.maxMoveM : a.rank - b.rank);
/** The route's own words: what it bends, or the new road it lays. */
function routeWords(doc, t) {
  if (t.newPieces > 0) return `laid ${fmtM(t.newRoadM)} of new road`;
  const moved = t.displacement.filter((x) => x.maxM > 1e-3).map((x) => x.piece);
  if (t.route === 'whole') return `bent ${moved.length} of the lap's pieces`;
  if (!moved.length) return 'met the start (the end was already on it)';
  const from = Math.min(...moved), k = doc.pieces.length - from, lenM = doc.pieces.slice(from).reduce((a, P) => a + (P.length || 0), 0);
  return k === 1 ? `bent the last piece (${fmtM(lenM)})` : `bent the last ${k} pieces (${fmtM(lenM)})`;
}
function wordsOf(doc, t) {
  if (t.newPieces > 0) return `closed: laid ${fmtM(t.newRoadM)} of new road from the end to the start (${t.newPieces} piece${t.newPieces === 1 ? '' : 's'}); nothing already built moved`;
  return t.displacement.some((x) => x.maxM > 1e-3) ? `closed: ${routeWords(doc, t)} by up to ${fmtM(t.maxMoveM)}` : `closed: ${routeWords(doc, t)}; nothing moved more than 1 mm`;
}
function windowOf(doc, t) {
  if (t.newPieces > 0) { const pieces = []; for (let i = doc.pieces.length; i < t.doc.pieces.length; i++) pieces.push(i); return { pieces, text: `the new road (${pieces.length} piece${pieces.length === 1 ? '' : 's'}, ${Math.round(t.newRoadM)} m)` }; }
  return { pieces: t.displacement.filter((x) => x.maxM > 1e-3).map((x) => x.piece), text: routeWords(doc, t).replace(/^bent /, '') };
}
const summary = (tried) => tried.map((t) => ({ route: t.route, ms: t.ms ?? null, checkMs: t.checkMs ?? null, refused: t.refused || null, newRoadM: t.newRoadM ?? null, maxMoveM: t.maxMoveM ?? null, lapOk: t.lap ? t.lap.ok : null, newReds: t.newReds ? t.newReds.length : null, miss: t.miss || null }));

/**
 * D242: how far each road piece's CENTRELINE moves between two documents of the same pieces (a close changes control points, never lengths):
 * [{ piece, id, maxM }], the largest distance between the two paths' stations of that piece (the same stations: each segment samples on its own grid).
 */
function displacementOf(a, b) {
  const pa = AD.toPath({ ...a, closed: false }).path.samples, pb = AD.toPath({ ...b, closed: false }).path.samples, segs = toSegments({ ...a, closed: false });
  const idOf = (m) => (segs[m.seg] ? segs[m.seg].id : null), out = new Map();
  a.pieces.forEach((P, i) => { if (P.type === 'road') out.set(P.id, { piece: i, id: P.id, maxM: 0 }); });
  const n = Math.min(pa.length, pb.length);
  for (let k = 0; k < n; k++) { const e = out.get(idOf(pa[k])); if (!e) continue; const d = Math.hypot(pa[k].pos[0] - pb[k].pos[0], pa[k].pos[1] - pb[k].pos[1], pa[k].pos[2] - pb[k].pos[2]); if (d > e.maxM) e.maxM = d; }
  return [...out.values()];
}

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
function relink(base, doc) {
  const byId = new Map(base.pieces.map((P) => [P.id, P]));
  const pieces = doc.pieces.map((P) => { const b = byId.get(P.id); return b && same(b, P) ? b : P; });
  const out = { ...doc, pieces };
  for (const k of Object.keys(out)) if (k !== 'pieces' && base[k] && typeof base[k] === 'object' && same(base[k], out[k])) out[k] = base[k];
  return deepFreeze(out);
}

module.exports = { runClose, runCloseBest, byOrder, displacementOf, relink };
