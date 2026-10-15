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

module.exports = { coarsen, coarsenRun, FACTOR, CHEAP_FACTOR };
