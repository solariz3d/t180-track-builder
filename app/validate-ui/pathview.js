// pathview.js: validation's stations as a VIEW of the preview's path (D177: ONE shared path; C's hardening §1 item 2:
// "The validation controller also grows its OWN path next to the preview's").
//
//   viewOf(src, step, prev, g) -> view | null
//     src    a buildPath result (C's src/geom/path.js) at a FINER step that divides `step` exactly (the preview's 0.5 m
//            into validation's 2 m), with its segFirst[] (the index of each segment's first sample)
//     prev   the previous view of the SAME src (grown in place since), or null; g the first segment that may have changed
//     view   { lengthM, closed, twist, step, samples, head, src, first }   first[j]: the view index of segment j's first
//            station. null when src cannot be viewed at `step` (the steps do not divide, or no segFirst): the caller
//            then builds its own path
//
// WHY IT IS EXACT. buildPath places a segment's stations on the segment's OWN grid: u = k·step from its start (every k
// with k·step < L − 1e-9), then, on the path's last segment only, its end u = L (src/geom/path.js grow). A station's
// values depend on u alone, never on the step: the position and frame are integrated on fixed substeps of at most 0.25 m
// (n = ceil(L / 0.25)), and sampleAt interpolates at u. With R = step / src.step an integer and u = (R·k)·src.step
// equal to k·step in floating point (true for 0.5 and 2, powers of two; checked per station, and a view that would
// differ is refused), every R-th sample of each segment, plus the path's
// final sample, IS the station buildPath(segments, { step }) would make: the same object values, bit for bit
// (app/test/validate-ui-pathview.test.js compares them). The closing twist is applied per sample by its s, so a closed
// path's view is exact too.
'use strict';

function viewOf(src, step, prev = null, g = 0) {
  if (!src || !Array.isArray(src.samples) || !Array.isArray(src.segFirst) || !(src.step > 0)) return null;
  const R = step / src.step;
  if (!(Number.isInteger(R) && R >= 1 && R * src.step === step)) return null;
  const S = src.samples, nseg = src.segFirst.length, lastIdx = S.length - 1;
  // re-read from the segment BEFORE g: an append pops the old open end (the old last segment's u = L station) and
  // re-emits it as the new segment's start, so the old last segment's stations are re-taken too
  const from = prev && prev.src === src && !src.closed && !prev.closed && g >= 1 && g - 1 < prev.first.length ? g - 1 : 0;
  const samples = from ? prev.samples.slice(0, prev.first[from]) : [], first = from ? prev.first.slice(0, from) : [];
  for (let j = from; j < nseg; j++) {
    const a = src.segFirst[j], b = j + 1 < nseg ? src.segFirst[j + 1] : S.length;
    first[j] = samples.length;
    for (let i = a; i < b; i++) {
      const k = i - a;
      if (k % R === 0) { if (k * src.step !== (k / R) * step) return null; samples.push(S[i]); }   // the same u, exactly
      else if (i === lastIdx) samples.push(S[i]);
    }
  }
  return { lengthM: src.lengthM, closed: src.closed, twist: src.twist, step, samples, head: src.head, src, first };
}

module.exports = { viewOf };
