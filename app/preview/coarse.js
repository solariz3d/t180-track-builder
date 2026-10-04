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

const FACTOR = 6;
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

function coarsen(segments, factor = FACTOR) {
  if (!(factor >= 2) || !Array.isArray(segments)) return segments;
  let m = segMemo.get(factor); if (!m) segMemo.set(factor, (m = new WeakMap()));
  return segments.map((g) => {
    if (!g || !Array.isArray(g.fractions) || g.fractions.length <= 2) return g;
    let c = m.get(g); if (!c) { c = { ...g, fractions: thin(g.fractions, factor) }; m.set(g, c); }
    return c;
  });
}

module.exports = { coarsen, FACTOR };
