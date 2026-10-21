// coarse.js: a COARSER PREVIEW of the equation core's track, for the moments the track is being dragged (D235 part 2, the keeper: "make the changes render
// faster while you change it from one to the next? Sometimes it lags and is so slow").
//
//   coarsen(segments, factor = FACTOR) -> segments      the same segments with their ROW GRID thinned: every `factor`-th fraction across the width, and always the first
//                                                        and last (the road's two edges). `factor` < 2 returns the very same array.
//
// WHY THERE. A core track's segments carry `fractions`, the row grid the adapter chose for the piece (src/core/adapter.js: one grid shared by every chord segment of a
// piece, fine enough that the section never turns more than a degree between two columns). buildMesh follows it, so a closed tube's 360° section is 392 vertices across
// and the tube oval is 3,001 cells, 2.4 million vertices and 87 MB, rebuilt in full on every brush step: 2,670 ms in node (edit_speed_profile_2026-10-04.md). The mesh
// options (maxSeamDeg, chordErr) do not reach that grid, so the preview thins the grid itself: every sixth fraction, a section step of about 6° where it was 1°: the
// step costs about 850 ms, 3.1×, measured by the same probe.
// THE EXPORT NEVER SEES THIS. It is applied to the segments the preview's track model meshes, never to `state.resolved`, which the shell, the validation and the export
// read; the model returns the real segments. Full detail comes back by itself shortly after the drag ends (app/preview/preview.js).
// Rows that share one array (the chord segments of a piece) keep sharing one: the thinned array is memoised per input array, and a segment per input segment, so
// neighbouring segments still have the same row grid (no seam zipper appears) and an unchanged segment is the same object from one update to the next.
'use strict';

const { normalize, blendSamples, commonFractions } = require('../../src/geom/profile.js');

const DEG = Math.PI / 180;
const FACTOR = 6;
const CHEAP_FACTOR = 12;   // D266 item 2: the ghost while a handle is dragged: a section step of about 12 degrees where the full ghost has 1
const planMemo = new Map();   // factor -> WeakMap(from profile -> WeakMap(profile -> fractions))
const gridMemo = new Map();   // factor -> WeakMap(fractions array -> thinned array)
const segMemo = new Map();    // factor -> WeakMap(segment -> coarse segment)

function thin(fr, factor) {
  let m = gridMemo.get(factor); if (!m) gridMemo.set(factor, (m = new WeakMap()));
  let out = m.get(fr);
  if (!out) {
    out = []; for (let i = 0; i < fr.length; i += factor) out.push(fr[i]);
    if (out[out.length - 1] !== fr[fr.length - 1]) out.push(fr[fr.length - 1]);
    m.set(fr, out);
  }
  return out;
}

/**
 * A coarse row grid for a segment that has none (a cup, a legacy road): the fractions blendSamples picks for its two profiles with BOTH limits scaled by `factor` (a
 * column at most `factor` m apart, and at most `factor` degrees of turning), where the full mesh uses 1 m and 1°. Memoised per (from, profile) pair of profile OBJECTS, so
 * the segments of a held cup, which share them, share one grid (no seam zipper) and the 4,000-step grid search runs once, not once per 2 m segment.
 */
function gridOf(from, profile, factor) {
  let a = planMemo.get(factor); if (!a) planMemo.set(factor, (a = new WeakMap()));
  let b = a.get(from); if (!b) a.set(from, (b = new WeakMap()));
  let fr = b.get(profile);
  if (!fr) { fr = blendSamples(normalize(from), normalize(profile), { maxAcross: factor, maxSeam: factor * DEG }); b.set(profile, fr); }
  return fr;
}

/** One segment with a grid, thinned (as coarsen does), memoised by its (canonical) grid. */
const thinSeg = (g, factor) => (g.fractions.length <= 2 ? g : { ...g, fractions: thin(g.fractions, factor) });

function coarsen(segments, factor = FACTOR) {
  if (!(factor >= 2) || !Array.isArray(segments)) return segments;
  let m = segMemo.get(factor); if (!m) segMemo.set(factor, (m = new WeakMap()));
  return segments.map((g) => {
    if (!g) return g;
    let c = m.get(g);
    if (c) return c;
    if (Array.isArray(g.fractions)) { if (g.fractions.length <= 2) return g; c = { ...g, fractions: thin(g.fractions, factor) }; }
    else if (g.kind === 'road' && g.profile) {
      // blend null (a held cross-section) becomes "weight 1 all along": the segment is its own profile, drawn from the shared grid; a blend keeps its own
      const blend = g.blend || { from: g.profile, s0: 1, length: 1 };
      c = { ...g, blend, fractions: gridOf(blend.from, g.profile, factor) };
    } else return g;
    if (Object.isFrozen(g)) Object.freeze(c);   // D421 (A's §1.3): a coarse copy of a frozen segment is frozen too, so trackmodel.js keys it once (its key memo holds frozen segments only)
    m.set(g, c); return c;
  });
}

/**
 * coarsen() for a RUN of new segments rebuilt on every pointer move (the cheap ghost, app/preview/trackmodel.js ghostFor). 2026-10-14, reported: stretching a
 * piece past about 500 m dropped the frames massively. A plain piece's segments carry no row grid, the candidate is a new set of objects on every move, so
 * gridOf's memo (keyed on profile OBJECTS) never hit and each 2 m segment ran its own 4,000-step search: 802 searches at 1600 m, ~90 ms a move. Here the
 * segments that need a grid get ONE, from commonFractions over all their profiles (the same measure as blendSamples, bounding every profile in the run, the
 * list subsampled to `cap`), so the search runs once a move and neighbouring segments share their rows (no seam zipper). Segments that have a grid are thinned
 * as coarsen() does. The preview only, as coarsen: the release builds the full ghost, and nothing here reaches the export.
 */
const runMemo = new Map();   // the key of a run's distinct profiles -> its grid; the newest 16
// a 64-bit hash of numbers rounded to 1e-9 (two 32-bit lanes): a text key of a 100-knot edge profile cost ~12 ms a drag move at 1300 m
function hashRounded(lists, salt = '') {
  let a = 0x9e3779b9 ^ salt.length, b = 0x85ebca6b;
  for (let i = 0; i < salt.length; i++) { a = Math.imul(a ^ salt.charCodeAt(i), 0x01000193); b = Math.imul(b + salt.charCodeAt(i), 0x5bd1e995); }
  for (const L of lists) {
    a = Math.imul(a ^ L.length, 0x27d4eb2d); b = Math.imul(b ^ (L.length + 0x165667b1), 0xc2b2ae35);
    for (let i = 0; i < L.length; i++) {
      const r = Math.round(L[i] * 1e9), lo = r % 4294967296 | 0, hi = Math.floor(r / 4294967296) | 0;
      a = Math.imul(a ^ lo, 0x85ebca6b) ^ (a >>> 13); a = Math.imul(a ^ hi, 0xc2b2ae35) ^ (a >>> 16);
      b = Math.imul(b ^ hi, 0x27d4eb2d) ^ (b >>> 15); b = Math.imul(b ^ lo, 0x165667b1) ^ (b >>> 13);
    }
  }
  return (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36);
}
const keyMemo = new WeakMap();   // a profile object -> its rounded key (a frozen profile cannot change; any other is keyed afresh)
const profileKey = (P) => {
  let k = Object.isFrozen(P) ? keyMemo.get(P) : undefined;
  if (k === undefined) { k = hashRounded([P.u, P.psi], `${P.font}|${P.material}`); if (Object.isFrozen(P)) keyMemo.set(P, k); }
  return k;
};
// ONE profile object per rounded value, kept across calls (the newest 4,096): a segment rebuilt with its profile off by round-off (a width read off a spline
// at a knot vector that moved with the length) gets the same object back, so its key is the same and its mesh is reused. Moves a vertex by under 1e-9 m, in the
// drag preview only.
const canonMemo = new Map();
function canon(P) {
  const k = profileKey(P); let c = canonMemo.get(k);
  if (!c) { c = P; canonMemo.set(k, c); if (canonMemo.size > 4096) canonMemo.delete(canonMemo.keys().next().value); }
  return c;
}
// the same for a segment's own row grid (a piece with an edge carries one, src/core/adapter.js), and for every profile it carries, before it is thinned
const gridCanon = new Map();
function canonGrid(fr) {
  const k = hashRounded([fr]); let c = gridCanon.get(k);
  if (!c) { c = fr; gridCanon.set(k, c); if (gridCanon.size > 256) gridCanon.delete(gridCanon.keys().next().value); }
  return c;
}
const canonSeg = (g) => (!g || g.kind !== 'road' || !g.profile ? g : { ...g, profile: canon(g.profile), ...(g.blend ? { blend: { ...g.blend, from: canon(g.blend.from) } } : {}),
  ...(g.profileIn ? { profileIn: canon(g.profileIn) } : {}), ...(Array.isArray(g.fractions) ? { fractions: canonGrid(g.fractions) } : {}) });
function coarsenRun(segments, factor = CHEAP_FACTOR, { cap = 24 } = {}) {
  if (!(factor >= 2) || !Array.isArray(segments)) return segments;
  const plain = (g) => g && !Array.isArray(g.fractions) && g.kind === 'road' && g.profile;
  const need = segments.filter(plain);
  if (need.length < 2) return need.length ? coarsen(segments, factor) : segments.map((g) => (Array.isArray(g && g.fractions) ? thinSeg(canonSeg(g), factor) : g));
  // the grid is a function of the DISTINCT profiles (commonFractions bounds the largest step of any of them, so a repeat changes nothing), keyed by value rounded
  // to 1e-9: a run rebuilt with the same profiles, up to round-off, gets the very same array, so its segments keep their keys and the ghost can reuse their mesh
  const distinct = new Map();
  for (const g of need) for (const P of g.blend ? [g.blend.from, g.profile] : [g.profile]) { const c = canon(P), k = profileKey(c); if (!distinct.has(k)) distinct.set(k, c); }
  const key = `${factor}|${cap}|${[...distinct.keys()].sort().join('#')}`;
  let fr = runMemo.get(key);
  if (!fr) { fr = commonFractions([...distinct.values()], { maxAcross: factor, maxSeam: factor * DEG, cap }); runMemo.set(key, fr); if (runMemo.size > 16) runMemo.delete(runMemo.keys().next().value); }
  return segments.map((g) => {
    if (!plain(g)) return Array.isArray(g && g.fractions) ? thinSeg(canonSeg(g), factor) : coarsen([g], factor)[0];
    const P = canon(g.profile);
    return { ...g, profile: P, blend: g.blend ? { ...g.blend, from: canon(g.blend.from) } : { from: P, s0: 1, length: 1 }, fractions: fr };
  });
}

/**
 * D421 part 4, the SCULPT drag's chord ghost (design §4.3 step 1, D404's method on a placed stretch): the window's 2 m chords MERGED into a few dozen longer ones, so its
 * ghost is meshed from about the same number of chords however long the window is. Consecutive road chords of one piece merge while the merged one turns the heading by
 * at most `maxTurn` rad, the pitch by at most `maxTurn`, rolls by at most `maxRoll` and is at most `maxLen` m long; its heading and pitch rates run linearly from the
 * first chord's start to the last one's end, and its roll from the first's to the last's, as one geometry segment does. The cross-section merges EXACTLY when the chords
 * share one profile with no blend, or one blend run (the same `from`, profile and length, each chord's s0 where the last one ended: the weight is a function of the run's
 * own distance); a chain of per-chord blends (a width or rise being brushed, each chord blending from the one before) merges into one blend from the first's start to the
 * last's end, an approximation of the shape between the chord ends. Anything else (a gap, another piece, a ramp's entry) starts a new chord. The preview only: the
 * release builds the exact road from the shell's own segments, and nothing here reaches the export.
 */
const DEFAULT_MERGE = Object.freeze({ maxTurn: 0.03, maxRoll: 0.05, maxLen: Infinity });
const startProfile = (g) => (g.blend && g.blend.s0 === 0 && Math.abs(g.blend.length - g.length) < 1e-9 ? g.blend.from : g.profile);
// profiles and row grids are compared by VALUE (canon: one object per value rounded to 1e-9), since the shell builds a brushed piece's chords afresh each step
// first the exact numbers (the chords the brush did not reach come back bit for bit: a tube's profile is hundreds of numbers, and hashing each fresh one cost 5 ms a step on the 280° oval)
const sameList = (x, y) => { if (x === y) return true; if (!x || !y || x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
const sameP = (p, q) => p === q || (!!p && !!q && ((p.font === q.font && p.material === q.material && sameList(p.u, q.u) && sameList(p.psi, q.psi)) || canon(p) === canon(q)));
const sameGrid = (f, g) => f === g || (Array.isArray(f) && Array.isArray(g) && (sameList(f, g) || canonGrid(f) === canonGrid(g)));
function mergeable(a, b) {
  if (!a || !b || a.kind !== 'road' || b.kind !== 'road' || a.id !== b.id || a.part !== b.part || a.word !== b.word) return null;
  if ((a.heartline || 0) !== (b.heartline || 0) || b.profileIn !== undefined || a.profileIn !== undefined || !sameGrid(a.fractions, b.fractions)) return null;
  if (!a.blend && !b.blend) return sameP(a.profile, b.profile) ? 'same' : null;
  if (a.blend && b.blend && sameP(a.blend.from, b.blend.from) && sameP(a.profile, b.profile) && a.blend.length === b.blend.length && Math.abs(b.blend.s0 - (a.blend.s0 + a.length)) < 1e-9) return 'run';
  if (b.blend && b.blend.s0 === 0 && Math.abs(b.blend.length - b.length) < 1e-9 && sameP(b.blend.from, a.profile)) return 'chain';
  return null;
}
function mergeChords(segments, opts = {}) {
  if (!Array.isArray(segments)) return segments;
  const { maxTurn, maxRoll, maxLen } = { ...DEFAULT_MERGE, ...opts }, out = [];
  let cur = null, first = null, turn = 0, pitch = 0, chained = false;
  const flush = () => {
    if (!cur) return;
    if (cur.length === first.length && cur.last === first) out.push(first);
    else {
      const g = cur.last, m = { ...first, length: cur.length, k1: g.k1, kp1: g.kp1, roll1: g.roll1 };
      if (chained) m.profile = g.profile, m.blend = { from: startProfile(first), s0: 0, length: cur.length };
      out.push(m);
    }
    cur = null; first = null; chained = false;
  };
  for (const g of segments) {
    const dTurn = Math.abs(((g.k0 || 0) + (g.k1 || 0)) / 2 * g.length), dPitch = Math.abs(((g.kp0 || 0) + (g.kp1 || 0)) / 2 * g.length);
    const how = cur ? mergeable(cur.last, g) : null;   // one way of merging a chord (same, run or chain), never two: a run's start profile is not its from
    if (how && (!cur.how || cur.how === how) && cur.length + g.length <= maxLen && turn + dTurn <= maxTurn && pitch + dPitch <= maxTurn && Math.abs((g.roll1 || 0) - (first.roll0 || 0)) <= maxRoll) {
      cur.length += g.length; cur.last = g; cur.how = how; turn += dTurn; pitch += dPitch; if (how === 'chain') chained = true;
      continue;
    }
    flush();
    if (!g || g.kind !== 'road') { out.push(g); continue; }
    cur = { length: g.length, last: g }; first = g; turn = dTurn; pitch = dPitch;
  }
  flush();
  return out;
}

/**
 * D421 part 4: two segments that would build the same road (their route numbers, their cross-section by value, their row grid and blend), though they are different
 * objects: the shell converts a brushed PIECE again whole on every step, so the chords of it that the brush did not reach come back equal but new. The drag's frame
 * trims those off its window (trackmodel.js dragFrame), so the window is what the brush changed, not the whole piece.
 */
const ROUTE = ['kind', 'id', 'part', 'word', 'length', 'k0', 'k1', 'kp0', 'kp1', 'roll0', 'roll1', 'heartline', 'speed', 'rampM'];
function sameSegment(a, b) {
  if (a === b) return true;
  if (!a || !b || a.kind === 'gap' || b.kind === 'gap') return false;
  for (const k of ROUTE) if (a[k] !== b[k]) return false;
  if (!sameP(a.profile, b.profile) || !sameGrid(a.fractions, b.fractions) || (a.profileIn === undefined) !== (b.profileIn === undefined) || (a.profileIn !== undefined && !sameP(a.profileIn, b.profileIn))) return false;
  if (!a.blend || !b.blend) return !a.blend && !b.blend && (a.blend === undefined) === (b.blend === undefined);
  return sameP(a.blend.from, b.blend.from) && a.blend.s0 === b.blend.s0 && a.blend.length === b.blend.length;
}

module.exports = { coarsen, coarsenRun, mergeChords, sameSegment, FACTOR, CHEAP_FACTOR };
