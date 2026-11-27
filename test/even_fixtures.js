// even_fixtures.js: shared by Even's tests (test/core_even.test.js, app/test/sculpt-even*.test.js, test/core_even_mutation.test.js). Not a test file.
// The fixtures and measures of the registration in lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md, section 1, built as the probes built them
// (D678 probes 2 and 3, L265): the core's own extend (turnby.js extendCorner through the panel's extendOptions), the starts made through the shell as a person makes
// them (the zone grab's follow; the Sculpt Width tool on the road), and every measure read back from the built track (the cross-section the builder makes, the bank
// the builder lays, the track checker), never from Even's own code.
'use strict';
const D = require('../src/core/document.js');
const SC = require('../src/core/sculpt.js');
const TB = require('../src/core/turnby.js');
const AD = require('../src/core/adapter.js');
const G = require('../src/geom/index.js');
const ZG = require('../app/core/zonegrab.js');
const { createCoreShell } = require('../app/core/coreshell.js');
const { extendOptions } = require('../app/core/panel.js');
const { createCheckJob } = require('../app/validate-ui/checkjob.js');
const { jointSteps } = require('../src/core/continuity.js');

// ── the fixtures ──
/** His example (L265): a 200 m lead, a left turn of four 60 m × 30° pieces (s 200 to 440, pieces 1 to 4), a 150 m exit; 12 m wide, flat. */
const FLAT = [{ length: 200, turn: 0, bank: 0 }, ...[1, 2, 3, 4].map(() => ({ length: 60, turn: 30, bank: 0 })), { length: 150, turn: 0, bank: 0 }];
/** Probe 3's banked layouts (even678c.js LAYOUT): 'plan' banks the turn's four pieces; 'hold' holds the bank from 80 m before the turn to 60 m after it. */
const LAYOUT = {
  plan: (b) => [{ length: 100, turn: 0, bank: 0 }, { length: 100, turn: 0, bank: 0 }, ...[1, 2, 3, 4].map(() => ({ length: 60, turn: 30, bank: b })), { length: 150, turn: 0, bank: 0 }],
  hold: (b) => [{ length: 80, turn: 0, bank: 0 }, { length: 60, turn: 0, bank: b }, { length: 60, turn: 0, bank: b }, ...[1, 2, 3, 4].map(() => ({ length: 60, turn: 30, bank: b })), { length: 60, turn: 0, bank: b }, { length: 90, turn: 0, bank: 0 }],
};
function build(list, cup) {
  let d = D.createDoc('even');
  for (const p of list) d = TB.extendCorner(d, extendOptions({ length: p.length, turn: p.turn, climb: 0, bank: p.bank, width: 12, turnAs: 'corner', ...(cup === undefined ? {} : { cup }) }));
  return Object.freeze(d);
}
/** The banked fixtures: [layout, bank in degrees, cup (undefined: the default)]. B- banks into the turn, B+ away from it. */
const BANKED = Object.freeze({ 'B-': ['plan', -20, undefined], 'B-0': ['plan', -20, 0], Bhold: ['hold', -20, undefined], 'B+': ['plan', 20, undefined], 'B+0': ['plan', 20, 0] });
const memo = new Map();
const fixture = (name) => { if (!memo.has(name)) memo.set(name, name === 'flat' ? build(FLAT) : build(LAYOUT[BANKED[name][0]](BANKED[name][1]), BANKED[name][2])); return memo.get(name); };
/** The run every fixture levels: the turn, s 200 to 440, and its pieces in that fixture. */
const RUN = Object.freeze({ lo: 200, hi: 440, mid: 320 });
const runPieces = (doc) => { const off = SC.pieceOffsets(doc), idx = doc.pieces.map((P, p) => p).filter((p) => off[p] >= RUN.lo - 1e-6 && off[p] + doc.pieces[p].length <= RUN.hi + 1e-6); return { from: idx[0], to: idx[idx.length - 1] }; };
/** The window the registration names: the run, 20 m at the value and a 30 m ramp beyond each end. */
const WIN = Object.freeze({ lo: RUN.lo - 20, hi: RUN.hi + 20, ramp: 30, w0: RUN.lo - 50, w1: RUN.hi + 50 });

// ── reading a track ──
const at = (doc, ch, s) => { const off = SC.pieceOffsets(doc); for (let i = 0; i < doc.pieces.length; i++) { const P = doc.pieces[i]; if (P.type === 'road' && s >= off[i] - 1e-9 && s <= off[i] + P.length + 1e-9) return D.channelAt(P, ch, Math.min(P.length, Math.max(0, s - off[i]))).v; } return NaN; };
const endOf = (d) => { const o = SC.pieceOffsets(d); return o[o.length - 1] + d.pieces[d.pieces.length - 1].length; };
const stations = (a, b, step = 1) => { const out = []; for (let s = a; s <= b + 1e-9; s += step) out.push(s); return out; };
const spread = (xs) => Math.max(...xs) - Math.min(...xs);
/** The built route and its frames, as the shell resolves it (one path every 1 m; the zone grab reads the same). */
const geomMemo = new WeakMap();
function geomOf(doc) {
  let g = geomMemo.get(doc);
  if (!g) { const segments = AD.toSegments(doc), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch }; g = { segments, path: G.buildPath(segments, { step: 1, closed: !!doc.closed, start }) }; geomMemo.set(doc, g); }
  return g;
}
const rotb = (a, c, ang) => [a * Math.cos(ang) - c * Math.sin(ang), a * Math.sin(ang) + c * Math.cos(ang)];
/** A rim's place across the road at s (m, + to the left of the route): the lateral offset plus the rim the cross-section puts there, turned by the bank the path is
 *  built with (app/core/zonegrab.js frameAt: a press at one rim reads the far one). side 'left' | 'right'. */
function rimAcross(doc, s, side) {
  const g = geomOf(doc), f = ZG.frameAt(g.path, g.segments, s, side === 'left' ? -1 : 1);
  if (!f) throw new Error(`no frame at ${s}`);
  return at(doc, 'l', s) + rotb(f.oF[0], f.oF[1], Math.atan2(f.sin, f.cos))[0];
}
/** The bank the builder lays at s (adapter.js bankPlan's roll where it re-laid the bank, the channel elsewhere). */
const plans = new WeakMap();
function builtBank(doc, s) {
  let pl = plans.get(doc); if (!pl) plans.set(doc, (pl = AD.bankPlan(doc)));
  const off = SC.pieceOffsets(doc);
  for (let i = 0; i < doc.pieces.length; i++) { const P = doc.pieces[i]; if (P.type === 'road' && s >= off[i] - 1e-9 && s <= off[i] + P.length + 1e-9) { const sl = Math.min(P.length, Math.max(0, s - off[i])); return pl[i].fn ? pl[i].fn(sl) : D.channelAt(P, 'phi', sl).v; } }
  return NaN;
}
const smootherstep = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
const weight = (s) => (s >= WIN.lo && s <= WIN.hi ? 1 : ((d) => (d >= WIN.ramp ? 0 : 1 - smootherstep(d / WIN.ramp)))(s < WIN.lo ? WIN.lo - s : s - WIN.hi));
/** K3: the most the centre's height is off its target in the plane of the road as built, over the window, every 1 m: the start's height, eased between the window's
 *  ends on the run, plus the bank's tangent times the sideways move (from the start outside the run's weight, from the eased offset on it). */
function centreOff(after, start) {
  const ease = (ch) => { const a = at(start, ch, WIN.w0), b = at(start, ch, WIN.w1); return (s) => a + (b - a) * smootherstep((s - WIN.w0) / (WIN.w1 - WIN.w0)); };
  const fh = ease('h'), fl = ease('l');
  let m = 0, where = null;
  for (const s of stations(WIN.w0, WIN.w1)) {
    const g = weight(s), l = at(after, 'l', s), hs = at(start, 'h', s), ls = at(start, 'l', s);
    const target = hs + g * (fh(s) - hs) + Math.tan(builtBank(start, s)) * ((1 - g) * (l - ls) + g * (l - fl(s)));
    const e = Math.abs(at(after, 'h', s) - target); if (e > m) { m = e; where = s; }
  }
  return { off: m, at: where };
}
/** The track checker's reds, as the app's checker job reads them (app/validate-ui/checkjob.js, CSP on). */
function reds(doc) { const r = createCheckJob().run({ doc, csp: true }); if (!r.result) throw new Error(`the checker gave no result: ${r.error}`); return r.result.red.map((x) => ({ reason: x.reason, s0: x.s0, s1: x.s1 })); }
/** The reds of `after` in [a, b] that `before` lacks: a red is lacked unless it lies inside a red of the same reason on `before`, widened by 2 m at each end. */
function redsLacked(after, before, a = WIN.w0, b = WIN.w1) {
  const B = reds(before);
  return reds(after).filter((x) => x.s1 >= a && x.s0 <= b).filter((x) => !B.some((y) => y.reason === x.reason && x.s0 >= y.s0 - 2 && x.s1 <= y.s1 + 2));
}
/** F4/K4: outside the window nothing moved: the pieces wholly outside are the same objects, and w, l, h and the bank channel read the same bits every 1 m outside. */
function outsideChanges(after, before) {
  const off = SC.pieceOffsets(before), out = [];
  before.pieces.forEach((P, p) => { const e = p + 1 < before.pieces.length ? off[p + 1] : off[p] + (P.length || 0); if ((e < WIN.w0 || off[p] > WIN.w1) && after.pieces[p] !== P) out.push(`piece ${p} is a new object`); });
  for (const s of stations(0, endOf(before))) { if (s >= WIN.w0 && s <= WIN.w1) continue; for (const ch of ['w', 'l', 'h', 'phi']) { const a = at(after, ch, s), b = at(before, ch, s); if (!Object.is(a, b)) out.push(`${ch} at ${s}: ${b} -> ${a}`); } }
  return out;
}
/** F5: the joints the window touches, where w, l or h steps (value more than one stored step, 1e-4 m; slope more than 1e-3 per metre). */
function jointBreaks(doc) {
  return jointSteps(doc, { channels: ['w', 'l', 'h'] }).filter((j) => j.s >= WIN.w0 - 1e-9 && j.s <= WIN.w1 + 1e-9 && (Math.abs(j.dv) > 1e-4 || Math.abs(j.dm) > 1e-3));
}

// ── the shell, and the starts made through it ──
async function shellOn(doc) { const sh = await createCoreShell({}); sh.commitDoc(doc); sh.setSculpt(true); return sh; }
const present = (sh) => sh.getState().history.present;
/** Today's grab (L265 even265.js grab): press the OUTER (right) rim at s and pull straight out until the width there reads `want`, through the zone grab's follow. */
function grab(sh, s, want, r = 30) {
  const d = present(sh), rs = sh.getState().resolved, pathB = G.buildPath(rs.segments, { step: 1, closed: false, ...(rs.start ? { start: rs.start } : {}) });
  const fr = ZG.frameAt(pathB, rs.segments, s, -1); if (!fr) throw new Error(`no frame at ${s}`);
  const e = want - at(d, 'w', s), delta = ZG.follow(fr.R.map((k) => -k * e), fr, {}); if (!delta) throw new Error(`no follow at ${s}`);
  sh.beginFollow({ s0: fr.s, r }); if (!sh.getState().brush) throw new Error(`beginFollow at ${s}: ${sh.getState().message}`);
  sh.brushTo(delta); sh.endBrush();
}
/** One stroke of the Sculpt Width tool on the road at s (radius r), dragged until the width at s reads `want` (to 1 mm). */
function widthStroke(sh, s, want, r = 30) {
  sh.beginBrush({ tool: 'width', s0: s, r }); if (!sh.getState().brush) throw new Error(`width stroke at ${s}: ${sh.getState().message}`);
  const base = present(sh), w0 = at(base, 'w', s);
  let delta = want - w0;
  for (let k = 0; k < 12; k++) {
    sh.brushTo(delta); const w = at(present(sh), 'w', s), e = want - w;
    if (Math.abs(e) < 1e-3) break;
    const gain = (w - w0) / delta; delta += e / (gain > 0.05 ? gain : 1);
  }
  sh.endBrush();
}
/** The starts: 'U' the untouched road; 'T1' one grab at the run's middle; 'T2b' 8 grabs every 30 m from s 215; 'W1' and 'W8' the same with the width tool. */
const STARTS = Object.freeze(['U', 'T1', 'T2b', 'W1', 'W8']);
const EIGHT = [215, 245, 275, 305, 335, 365, 395, 425];
async function startOf(base, start) {
  const sh = await shellOn(base);
  if (start === 'T1') grab(sh, RUN.mid, 16);
  else if (start === 'T2b') for (const s of EIGHT) grab(sh, s, 16);
  else if (start === 'W1') widthStroke(sh, RUN.mid, 16);
  else if (start === 'W8') for (const s of EIGHT) widthStroke(sh, s, 16);
  else if (start !== 'U') throw new Error(`no start ${start}`);
  return sh;
}

module.exports = { FLAT, LAYOUT, BANKED, RUN, WIN, STARTS, EIGHT, fixture, build, runPieces, at, endOf, stations, spread, geomOf, rimAcross, builtBank, weight, centreOff, reds, redsLacked, outsideChanges, jointBreaks, shellOn, present, grab, widthStroke, startOf };
