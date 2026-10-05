// redgroups.js: EVERY red, in plain words, grouped, with where (D242, the librarian's item 4; the keeper, TEST 1: his refusal showed only the
// first red, under the name "downforce-ray-gap", when 29 reds said one thing: the road runs into itself).
//
//   groupReds(reds, segments)  -> [{ key, title, count, items: [{ s, s0, s1, piece, km, what, reason, detail }] }]
//                                 the reds of a validation or a refused export (src/validate: { reason, s0, s1 } or { reason, s }), grouped by
//                                 what they MEAN, the overlap first; `segments` (the adapter's, the lap's order) names the piece at each s.
//   groupsText(groups)         -> one line per group, for a status line or a dialog: "the road overlaps itself (19): at 1.40 km (p3), …"
//   pieceAt(segments, s)       -> the id of the piece the lap is on at s
//   kmText(s)                  -> "5.82 km"
//
// THE OVERLAP GROUP. self-intersection (the mesh passes through itself), stacked-within-2m (one road less than 2 m over another) and a
// downforce-ray-gap that sits where one of those is (within OVERLAP_NEAR_M) all say the same thing: the road runs into itself. E's
// diagnosis of TEST 1 (loop/test1_raygap_diagnosis_2026-10-04.md): every ray red was the edge of one road lying on ANOTHER road, never a
// hole. A ray red with no overlap near it keeps its own words (a real gap in the road under the car).
'use strict';
const { reasonText } = require('./labels.js');

const OVERLAP_NEAR_M = 30;
const kmText = (s) => `${(s / 1000).toFixed(2)} km`;
/** A range for a person: "5.82–5.86 km" (one unit), or "5.82 km" when both ends round alike. */
const kmRange = (s0, s1) => { const a = (s0 / 1000).toFixed(2), b = (s1 / 1000).toFixed(2); return a === b ? `${a} km` : `${a}–${b} km`; };
/** The id of the piece the lap is on at s (segments in lap order, each with its id and length); a closed lap's s past its end wraps. */
function pieceAt(segments, s) {
  if (!Array.isArray(segments) || !segments.length || !Number.isFinite(s)) return null;
  const L = segments.reduce((a, g) => a + g.length, 0); let x = L > 0 ? ((s % L) + L) % L : s, acc = 0;
  for (const g of segments) { if (x < acc + g.length - 1e-9) return g.id; acc += g.length; }
  return segments[segments.length - 1].id;
}
const WHAT = {
  'self-intersection': 'passes through itself',
  'stacked-within-2m': 'one road less than 2 m over another',
  'downforce-ray-gap': 'another road under the car\'s downforce ray',
};
const GROUPS = [
  { key: 'overlap', title: 'the road overlaps itself' },
  { key: 'roll-rate', title: 'the road rolls too fast' },
  { key: 'load-above-proven', title: 'the load is too high' },
  { key: 'lap-proof', title: 'the lap does not prove' },
];
function groupReds(reds, segments) {
  const list = (reds || []).map((x) => { const s0 = Number.isFinite(x.s0) ? x.s0 : x.s, s1 = Number.isFinite(x.s1) ? x.s1 : s0; return { x, s0, s1, s: s0 }; });
  const overlapRanges = list.filter((r) => r.x.reason === 'self-intersection' || r.x.reason === 'stacked-within-2m');
  const nearOverlap = (r) => overlapRanges.some((o) => r.s0 <= o.s1 + OVERLAP_NEAR_M && r.s1 >= o.s0 - OVERLAP_NEAR_M);
  const byKey = new Map();
  for (const r of list) {
    const reason = r.x.reason, overlap = reason === 'self-intersection' || reason === 'stacked-within-2m' || (reason === 'downforce-ray-gap' && nearOverlap(r));
    const key = overlap ? 'overlap' : reason;
    if (!byKey.has(key)) { const g = GROUPS.find((q) => q.key === key); byKey.set(key, { key, title: g ? g.title : reasonText(reason), count: 0, items: [] }); }
    const g = byKey.get(key), piece = pieceAt(segments, r.s0), end = r.s1 > r.s0 + 0.5 ? pieceAt(segments, r.s1) : piece;
    g.items.push({ s: r.s0, s0: r.s0, s1: r.s1, piece, pieceEnd: end, km: kmRange(r.s0, r.s1), what: overlap ? WHAT[reason] : reasonText(reason), reason, detail: r.x.detail || null, worst: r.x.worst });
    g.count++;
  }
  const order = (k) => { const i = GROUPS.findIndex((q) => q.key === k); return i < 0 ? GROUPS.length : i; };
  for (const g of byKey.values()) g.items.sort((a, b) => a.s - b.s);
  return [...byKey.values()].sort((a, b) => order(a.key) - order(b.key) || a.key.localeCompare(b.key));
}
/** The place of an item, for a person: "at 5.82 km (p20)", or "at 5.82–5.86 km (p20–p21)". */
const placeText = (it) => `at ${it.km} (${it.pieceEnd && it.pieceEnd !== it.piece ? `${it.piece}–${it.pieceEnd}` : it.piece || '?'})`;
function groupsText(groups) {
  // each place once per group (a self-intersection and a stacked red at one place are one place to look at); the count is every red
  return groups.map((g) => `${g.title} (${g.count}): ${[...new Set(g.items.map(placeText))].join(', ')}`).join('; ');
}

module.exports = { groupReds, groupsText, placeText, pieceAt, kmText, kmRange, OVERLAP_NEAR_M };
