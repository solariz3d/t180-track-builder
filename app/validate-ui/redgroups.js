// redgroups.js: EVERY red, in plain words, grouped, with where (D242, the librarian's item 4; the keeper, TEST 1: his refusal showed only the
// first red, under the name "downforce-ray-gap", when 29 reds said one thing: the road runs into itself).
//
//   groupReds(reds, segments)  -> [{ key, title, count, items: [{ s, s0, s1, piece, km, what, reason, detail }], places: [...] }]
//                                 the reds of a validation or a refused export (src/validate: { reason, s0, s1 } or { reason, s }), grouped by
//                                 what they MEAN, the overlap first; `segments` (the adapter's, the lap's order) names the piece at each s.
//   groupsText(groups)         -> one line per group, for a status line or a dialog: "the road overlaps itself (12 places): at 1.40 km (p3), …"
//   placesText(g)              -> "12 places": how many PLACES the group's reds make (g.count stays the number of reds)
//   pieceAt(segments, s)       -> the id of the piece the lap is on at s
//   kmText(s)                  -> "5.82 km"
//
// THE OVERLAP GROUP. self-intersection (the mesh passes through itself), stacked-within-2m (one road less than 2 m over another) and a
// downforce-ray-gap that sits where one of those is (within OVERLAP_NEAR_M) all say the same thing: the road runs into itself. E's
// diagnosis of TEST 1 (loop/test1_raygap_diagnosis_2026-10-04.md): every ray red was the edge of one road lying on ANOTHER road, never a
// hole. A ray red with no overlap near it keeps its own words (a real gap in the road under the car).
//
// PLACES (D248, E's note B on the D242 look: "1.47–1.51 km (p3), 1.48–1.51 km (p3)" were two lines for one place). Each group also carries
// g.places: its reds merged where they overlap, or touch (a gap of at most TOUCH_M, one station of validation's 2 m step) on the piece the
// place ends on, so they always share a piece, and the keeper reads one line per place. A place keeps where it starts (s, s0: a click goes there), where it ends, the pieces it
// spans, every reason and plain description it merged, and how many reds it covers. The group is the kind the keeper reads ("the road
// overlaps itself" is one kind, whether the mesh, the stacking or the ray found it), so a self-intersection and a stacked red at one place are
// ONE place. g.items (every red, unmerged) and g.count (the number of reds) are unchanged.
'use strict';
const { reasonText } = require('./labels.js');

const OVERLAP_NEAR_M = 30, TOUCH_M = 2;
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
/** The piece a range ENDS on: read just inside s1, so a range ending exactly on a boundary is on its own piece, not the next one (F1, C's look
 *  at 05f0c2c: pieceAt puts a boundary s on the NEXT piece). A point (or sub-0.5 m) range is on the piece it starts on. */
const endPiece = (segments, s0, s1) => pieceAt(segments, s1 > s0 + 0.5 ? s1 - 1e-6 : s0);
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
    const g = byKey.get(key), piece = pieceAt(segments, r.s0), end = endPiece(segments, r.s0, r.s1);
    g.items.push({ s: r.s0, s0: r.s0, s1: r.s1, piece, pieceEnd: end, km: kmRange(r.s0, r.s1), what: overlap ? WHAT[reason] : reasonText(reason), reason, detail: r.x.detail || null, worst: r.x.worst });
    g.count++;
  }
  const order = (k) => { const i = GROUPS.findIndex((q) => q.key === k); return i < 0 ? GROUPS.length : i; };
  for (const g of byKey.values()) { g.items.sort((a, b) => a.s - b.s || a.s1 - b.s1); g.places = mergePlaces(g.items, segments); }
  return [...byKey.values()].sort((a, b) => order(a.key) - order(b.key) || a.key.localeCompare(b.key));
}
/** A group's items (sorted by s) merged into PLACES: overlapping by more than a point (so on a piece the place spans), or touching (a gap of at
 *  most TOUCH_M, meeting included) on the piece the place ends on. F1: two reds that only MEET at a piece boundary are on different pieces. A red inside a place that spans two pieces is that place (the D248 real-window check: "at 1.08–1.16 km (p4–p5),
 *  at 1.15 km (p5)"); reds on different pieces that only touch stay two places. */
function mergePlaces(items, segments) {
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && (it.s0 < last.s1 || (it.s0 <= last.s1 + TOUCH_M && it.piece === endPiece(segments, last.s0, last.s1)))) {
      if (it.s1 > last.s1) last.s1 = it.s1;
      for (const [k, v] of [['reasons', it.reason], ['whats', it.what], ['details', it.detail]]) if (v != null && !last[k].includes(v)) last[k].push(v);
      if (it.worst != null && (last.worst == null || it.worst > last.worst)) last.worst = it.worst;
      last.reds++;
    } else out.push({ s: it.s0, s0: it.s0, s1: it.s1, piece: it.piece, reasons: [it.reason], whats: [it.what], details: it.detail != null ? [it.detail] : [], worst: it.worst, reds: 1 });
  }
  for (const p of out) {
    p.km = kmRange(p.s0, p.s1); p.pieceEnd = endPiece(segments, p.s0, p.s1);
    p.what = p.whats.join('; '); p.reason = p.reasons.join(', '); p.detail = p.details.length ? p.details.join('; ') : null;
  }
  return out;
}
/** How many places a group's reds make, for a person: "1 place", "12 places". */
const placesText = (g) => { const n = (g.places || []).length; return `${n} place${n === 1 ? '' : 's'}`; };
/** The place of an item, for a person: "at 5.82 km (p20)", or "at 5.82–5.86 km (p20–p21)". */
const placeText = (it) => `at ${it.km} (${it.pieceEnd && it.pieceEnd !== it.piece ? `${it.piece}–${it.pieceEnd}` : it.piece || '?'})`;
function groupsText(groups) {
  // each PLACE once per group (D248: overlapping or touching reds on one piece are one place to look at), and the count is of places
  return groups.map((g) => `${g.title} (${placesText(g)}): ${g.places.map(placeText).join(', ')}`).join('; ');
}

module.exports = { groupReds, groupsText, placeText, placesText, mergePlaces, pieceAt, kmText, kmRange, OVERLAP_NEAR_M, TOUCH_M };
