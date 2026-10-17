// edge.js: the EDGE fit (D371): a floor texture whose edge bands keep their size in METRES at any road width, and whose centre is a whole number of repeats.
//
//   widthRange(segments)            -> { min, max } | null   the narrowest and widest the road's cross-section gets (m, edge to edge, over every road
//                                                            segment, its start shape included), null when there is no road
//   layout(range, settings)         -> { b, c, N, fb, eb, stretch: { min, max } }   how the texture is laid out across, from the width range
//   srcU(uo, lay)                   -> u in the SOURCE image for u in the built image (both 0..1 across)
//   compose(img, lay)               -> img   the built image: the drawing turned half a turn (below), then its two edge bands, and its centre repeated N times between them
//   rowMap(arc, w, lay)             -> u in the built image for one point `arc` metres from a row's edge, the row being w metres wide
//
// WHY. 'fit' (D364) stretches the whole texture across the road's own width, so a texture drawn for 35 m has its edge glow 0.56 m wide on a 35 m road
// and 0.96 m on a 60 m one, and 'tile' repeats it across a wider road. The keeper's idea (2026-10-17): make the texture once the track is closed, when its
// whole width range is known, and let it work at every width without inconsistency. So the texture is drawn ONCE, for `tileWidth` metres across, and
// this file lays it out:
//   * the edge band is the outer `edgeBand` metres of the drawing at each side. It keeps that many metres on the road at any width (u runs 0..fb over
//     it, fb a fixed share of the built image), so a glow or a kerb line is the same size at 35 m and at 60 m;
//   * the centre is what is left of the drawing (tileWidth - 2·edgeBand metres wide, one cell), repeated N whole times between the bands. N is one
//     number for the whole track, chosen so that the cell's stretch is as even as it can be over the range (the worst stretch or squeeze is the smallest
//     it can be); at a width W each cell is (W - 2·edgeBand)/N metres. A cell therefore never changes by more than the ratio of the widest centre to the
//     narrowest, and is never cut: an edge band and a whole cell meet, never half of one.
// WHICH PART OF THE DRAWING IS THE EDGE. The fit and tile rules lay a drawing with the road's CENTRE at u = 0 (u = arc / width, -0.5 to 0.5, and the texture wraps), so the drawing's
// own edges (u = 0 and 1) fall at the road's centre and its middle (u = 0.5) at the road's two edges: a glow drawn down the middle of the drawing is the road's edge glow, as it
// has been since D358. The edge fit keeps that: it takes the drawing turned half a turn (u' = u + 0.5), whose ends are the road's two edges, and cuts the bands from those.
// A road narrower than two bands has no centre: it takes the plain fit (u = arc / w). A closed ring takes it too (flow.js).
'use strict';
const { normalize } = require('../geom/profile.js');
const { TextureError } = require('./errors.js');

const width = (p) => { const P = normalize(p); return P.u[P.u.length - 1] - P.u[0]; };

function widthRange(segments) {
  let min = Infinity, max = -Infinity;
  for (const g of segments || []) {
    if (!g || g.kind !== 'road' || !g.profile) continue;
    for (const w of [width(g.profile), ...(g.blend && g.blend.from ? [width(g.blend.from)] : [])]) { if (w < min) min = w; if (w > max) max = w; }
  }
  return max >= min ? { min, max } : null;
}

/** The layout for a width range and a floor's settings (tileWidth: the drawing's width in m; edgeBand: the band at each side in m). */
function layout(range, settings) {
  const { tileWidth, edgeBand } = settings, b = edgeBand;
  if (!range || !(range.max >= range.min && range.min > 0)) throw new TextureError('NO_WIDTHS', 'the edge fit needs the track\'s width range, and there is none (no road)');
  const c = tileWidth - 2 * b;
  if (!(b > 0 && c > 0)) throw new TextureError('BAD_EDGE', `the edge fit: two bands of ${b} m leave nothing of a ${tileWidth} m drawing; the band must be under half the width`);
  // the centre at the narrowest road that still has one; a narrower road takes the plain fit and is not in the range of the cell's stretch
  const cmin = Math.max(range.min - 2 * b, 1e-9), cmax = Math.max(range.max - 2 * b, cmin);
  let N = 1, best = Infinity;
  for (let n = 1; n <= 64; n++) { const worst = Math.max(cmax / (n * c), (n * c) / cmin); if (worst < best - 1e-12) { best = worst; N = n; } }
  const T = 2 * b + N * c;
  return { b, c, N, fb: b / T, eb: b / tileWidth, stretch: { min: cmin / (N * c), max: cmax / (N * c) } };
}

function srcU(uo, lay) {
  const { fb, eb, N } = lay;
  if (uo <= fb) return (uo / fb) * eb;
  if (uo >= 1 - fb) return 1 - eb + ((uo - (1 - fb)) / fb) * eb;
  const t = ((uo - fb) / (1 - 2 * fb)) * N, f = t - Math.floor(t);
  return eb + f * (1 - 2 * eb);
}

function compose(img, lay) {
  const { width: W, height: H, rgba } = img, out = new Uint8Array(rgba.length);
  for (let x = 0; x < W; x++) {
    const sx = Math.min(W - 1, Math.max(0, Math.floor((((srcU((x + 0.5) / W, lay) + 0.5) % 1) * W))));   // the drawing turned half a turn: its middle is the road's edge
    for (let y = 0; y < H; y++) { const o = (y * W + x) * 4, s = (y * W + sx) * 4; out[o] = rgba[s]; out[o + 1] = rgba[s + 1]; out[o + 2] = rgba[s + 2]; out[o + 3] = rgba[s + 3]; }
  }
  return { width: W, height: H, rgba: out, emissive: null };
}

/** u in the built image of the point `arc` m from a row's start, on a row w m wide. */
function rowMap(arc, w, lay) {
  const { b, fb } = lay;
  if (!(w > 2 * b)) return arc / w;
  if (arc <= b) return (arc / b) * fb;
  if (arc >= w - b) return 1 - fb + ((arc - (w - b)) / b) * fb;
  return fb + ((arc - b) / (w - 2 * b)) * (1 - 2 * fb);
}

module.exports = { widthRange, layout, srcU, compose, rowMap };
