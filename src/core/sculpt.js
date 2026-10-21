// sculpt.js: the core's BRUSH (D185, pane E; the spec's GO §3). Add Δ·f(|s − s₀|/r) to ONE channel over the brush window,
// f the quintic smootherstep falloff (ref 10 §1), applied to the B-spline control points the window covers (ref 10 §2).
//
// Local by construction: a control point changes only when its WHOLE support [tᵢ, tᵢ₊₄] lies inside the window, so every
// evaluation outside the window reads the same doubles and gives the same number, bit for bit. Each changed control point gets
// Δ·f at its knot average: the variation-diminishing approximation of the bump (ref 10 §2, LYCHE-MORKEN (5.30)).
// The document's joints are C1 in every channel (src/core/README.md; ref 09 §1). The brush keeps them so: at a road-road joint
// inside the window the next piece's first coefficient is the previous one's last, and its second is set from the previous
// piece's end slope, exactly as the document builds a piece. A joint the window only half covers is left untouched.
'use strict';
const D = require('./document.js');
const { toSegments } = require('./adapter.js');

/** ref 10 §1: Perlin's smootherstep S₂(x) = 6x⁵ − 15x⁴ + 10x³, clamped to [0, 1] (WIKI-SMOOTHSTEP §"Variations"). */
function smootherstep(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * x * (x * (6 * x - 15) + 10);
}
/** ref 10 §1: the brush weight at distance d from the centre, radius r: 1 at the centre, 0 at and beyond the edge, C2. */
const falloff = (d, r) => 1 - smootherstep(Math.abs(d) / r);
/** ref 10 §2: the knot average τ*ᵢ = (tᵢ₊₁ + tᵢ₊₂ + tᵢ₊₃)/3 of a cubic's control point i (LYCHE-MORKEN (5.30), d = 3). */
const knotAverage = (t, i) => (t[i + 1] + t[i + 2] + t[i + 3]) / 3;
/** The document's quantisation (src/core/README.md "numbers are quantised"; document.js q): the same rule, on the same DEC. */
const q = (x, dec) => { const v = Number(x.toFixed(dec)); return Object.is(v, -0) ? 0 : v; };

/**
 * Brush one channel's control points `c` (clamped cubic on knot vector `t`, local s). The window is [s0 − r, s0 + r] in the same
 * s. Returns { ctrl: a new array, changed: the indices changed }. Pure.
 */
function brushControls(c, t, { s0, r, delta }) {
  const ctrl = c.slice(), changed = [];
  for (let i = 0; i < c.length; i++) {
    if (t[i] < s0 - r || t[i + 4] > s0 + r) continue;           // its support reaches outside the window: untouched
    ctrl[i] = c[i] + delta * falloff(knotAverage(t, i) - s0, r);
    changed.push(i);
  }
  return { ctrl, changed };
}

// D421: the adapter's per-piece segment cache (toSegments `cache`, exact: test/core_segcache.test.js), so offsets cost only the pieces that changed. A drag reruns the
// brush on the SAME base document at every step, and the brushed document shares every untouched piece with it. The cache keys a piece by its identity, so it
// is used only on a document whose pieces are frozen (every document the core returns, frozen all the way down); an unfrozen one, read from a file say, could
// be written in place, and is converted afresh.
const SEG_CACHE = new WeakMap();
// D421 (O's shell cut): a hill's or swerve's peak ratio (below, in brush) is a pure function of the document, the channel, s0 and r, and a drag asks it of the SAME
// base at every step (on a 10 km Grab, about half the step: the window read was 217 of 419 ms over 40 steps, profiled). Kept per document, under the rule SEG_CACHE keeps: only a
// document frozen with every piece frozen, which cannot be written in place. Exact (test/core_stepcache.test.js); a refusal is never kept.
const RATIO_CACHE = new WeakMap(), RATIO_MAX = 16;
const keyNum = (x) => (Object.is(x, -0) ? '-0' : String(x));   // String(x) is a double's shortest exact text; only -0 shares it
/** Where each piece starts along the adapter's path (the s a user picks on the preview): the sum of its segments' lengths. */
function pieceOffsets(doc) {
  const cache = doc.pieces.every(Object.isFrozen) ? SEG_CACHE : null;
  const len = new Map(); for (const g of toSegments(doc, { cache })) len.set(g.id, (len.get(g.id) || 0) + g.length);
  let off = 0; return doc.pieces.map((P) => { const o = off; off += len.get(P.id) || 0; return o; });
}

/** The largest knot span of any road piece that overlaps [lo, hi] (lap distance), counting only the spans that overlap it. */
function spanUnder(doc, off, lo, hi) {
  let m = 0;
  doc.pieces.forEach((P, p) => {
    if (P.type !== 'road' || off[p] + P.length < lo || off[p] > hi) return;
    const t = [0, ...P.knots, P.length];
    for (let k = 0; k + 1 < t.length; k++) if (off[p] + t[k + 1] >= lo && off[p] + t[k] <= hi) m = Math.max(m, t[k + 1] - t[k]);
  });
  return m;
}

/** A channel's value at lap distance s (the road piece holding s; ref 03 §1 through document.js channelAt). `off`: the document's pieceOffsets, when the caller has them. */
function valueAt(doc, ch, s, off = pieceOffsets(doc)) {
  let p = -1;
  doc.pieces.forEach((P, i) => { if (P.type === 'road' && s >= off[i] && s <= off[i] + P.length) p = i; });
  if (p < 0) throw new D.CoreError('BAD_BRUSH', `brush: no road at ${s} m`);
  return D.channelAt(doc.pieces[p], ch, s - off[p]).v;
}

const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k]); } return o; };

/**
 * Brush a document. `channel` is one of the document's channels (kh, kv, phi, w, r); `s0` is the path distance of the brush's
 * centre (the adapter's s); `r` its radius in m; `delta` the change at the centre, in the channel's own unit. Returns
 * { doc: a new, checked, frozen document (untouched pieces are the SAME objects), changed: [{ piece, indices }], note }.
 * A window narrower than any whole control-point support changes nothing, and `note` says so.
 */
function sculpt(doc, { channel, s0, r, delta }) {
  if (!D.CHANNELS.includes(channel)) throw new D.CoreError('BAD_CHANNEL', `sculpt: channel "${channel}" (known: ${D.CHANNELS.join(', ')})`);
  if (!(r > 0) || !Number.isFinite(s0) || !Number.isFinite(delta)) throw new D.CoreError('BAD_BRUSH', `sculpt: needs r > 0 and finite s0, delta (got r ${r}, s0 ${s0}, delta ${delta})`);
  // THE SMALLEST BRUSH: a control point's support is 4 knot spans, so a window narrower than that holds none and would change
  // nothing. A brush narrower than 3 spans is widened to 3 (E's rule; the hand-back's declared deviation): then 2–3 control points
  // carry the bump, and the change stays inside the asked window widened by 2 spans on each side whenever r ≥ one span.
  // The span is the largest knot span UNDER THE WINDOW, not in the whole piece, so the rule narrows after a local refinement
  // (A's catch, D186: document.js refineKnots).
  const off = pieceOffsets(doc), rUsed = widened(doc, off, s0, r, 3);
  const res = doc.pieces.map((P, p) => {
    if (P.type !== 'road' || off[p] + P.length < s0 - rUsed || off[p] > s0 + rUsed) return null;
    checkReach(P, channel);
    return brushControls(P.channels[channel], D.knotVector(P), { s0: s0 - off[p], r: rUsed, delta });
  });
  const { pieces, changed } = settle(doc, channel, res);
  const out = changed.length ? freeze(D.checkDoc({ ...doc, pieces })) : doc;
  return { doc: out, changed, radiusUsed: rUsed, note: changed.length ? (rUsed > r ? `the brush was widened from ${r} m to ${+rUsed.toFixed(3)} m, 3 knot spans, the smallest that moves whole control points` : null) : 'the brush window holds no whole control-point support: nothing changed' };
}
/** The brush window's radius: r, widened to `spans` times the largest knot span under it (a widened window can reach coarser spans, so widen until it holds: at most as many rounds as there are pieces). */
function widened(doc, off, s0, r, spans) {
  let rUsed = r;
  for (let k = 0; k <= doc.pieces.length; k++) { const w = Math.max(r, spans * spanUnder(doc, off, s0 - rUsed, s0 + rUsed)); if (w === rUsed) break; rUsed = w; }
  return rUsed;
}
/** A brush on an optional channel reaches only the pieces that carry it (D225). */
function checkReach(P, channel) {
  if (D.OPTIONAL[channel] && channel !== 'c' && !P[D.OPTIONAL[channel]]) throw new D.CoreError('NOT_' + D.OPTIONAL[channel].toUpperCase(), 'a ' + channel + ' brush reaches piece ' + P.id + ', which has no ' + D.OPTIONAL[channel] + ': extend with a ' + (channel === 't' ? 't' : 'e or s') + ' target first, or brush only ' + D.OPTIONAL[channel] + ' pieces (D225)');
  if (channel === 'c' && !P.cup) throw new D.CoreError('NOT_CUP', 'a cup brush reaches piece ' + P.id + ', which has no cup (a legacy piece renders the old profile): extend with a cup target first, or brush only cup pieces');
}
/** Road pieces a and b (a before b) are C1-linked in `channel`: no flight between them (D258: the landing starts at the user's pose), and an optional channel on both. */
const isLinked = (doc, a, b, channel) => a >= 0 && !doc.pieces.slice(a + 1, b).some((P) => P.type === 'flight') && (!D.OPTIONAL[channel] || !!(doc.pieces[a][D.OPTIONAL[channel]] && doc.pieces[b][D.OPTIONAL[channel]]));
/**
 * The joints of a brushed channel, then the pieces. `res[p]`: { ctrl, changed } for a piece the brush reached (null otherwise). A road-road joint whose four control
 * points all changed moves as the document builds it (value, then slope); one the window covers only in part is left alone. Returns { pieces, changed } (untouched
 * pieces the same objects; changed values quantised).
 */
function settle(doc, channel, res) {
  // the joints: road piece a, then road piece b (a flight between them breaks the C1 link in EVERY channel since D258: the landing starts at the user's pose)
  let a = -1;
  for (let b = 0; b < doc.pieces.length; b++) {
    if (doc.pieces[b].type !== 'road') continue;
    const Pb = doc.pieces[b], rb = res[b];
    const linked = isLinked(doc, a, b, channel);
    if (!linked) {                                             // an unlinked start (the lap's first piece, or a landing after a flight)
      if (channel === 'c' && a >= 0 && doc.pieces[a].cup && res[a]) { const Pa0 = doc.pieces[a], n0 = Pa0.channels.c.length; res[a].ctrl[n0 - 1] = Pa0.channels.c[n0 - 1]; res[a].ctrl[n0 - 2] = Pa0.channels.c[n0 - 2]; res[a].changed = res[a].changed.filter((i) => i < n0 - 2); }   // a cup piece before a legacy one keeps the edge it hands over
      if (a >= 0 && rb) { rb.ctrl[0] = Pb.channels[channel][0]; rb.ctrl[1] = Pb.channels[channel][1]; rb.changed = rb.changed.filter((i) => i > 1); }
      a = b; continue;
    }
    const Pa = doc.pieces[a], ra = res[a], n = Pa.channels[channel].length;
    const all = ra && rb && ra.changed.includes(n - 1) && ra.changed.includes(n - 2) && rb.changed.includes(0) && rb.changed.includes(1);
    if (all) {                                                 // the joint moves as the document builds it: value, then slope
      const h = Pa.length - (Pa.knots.length ? Pa.knots[Pa.knots.length - 1] : 0), hb = Pb.knots.length ? Pb.knots[0] : Pb.length;
      const v = q(ra.ctrl[n - 1], D.DEC[channel]), m = (3 * (v - q(ra.ctrl[n - 2], D.DEC[channel]))) / h;
      rb.ctrl[0] = v; rb.ctrl[1] = v + (m * hb) / 3;
    } else {                                                   // the window covers the joint only in part: leave all four alone
      if (ra) { ra.ctrl[n - 1] = Pa.channels[channel][n - 1]; ra.ctrl[n - 2] = Pa.channels[channel][n - 2]; ra.changed = ra.changed.filter((i) => i < n - 2); }
      if (rb) { rb.ctrl[0] = Pb.channels[channel][0]; rb.ctrl[1] = Pb.channels[channel][1]; rb.changed = rb.changed.filter((i) => i > 1); }
    }
    a = b;
  }
  const changed = [], pieces = doc.pieces.map((P, p) => {
    const x = res[p]; if (!x || !x.changed.length) return P;
    changed.push({ piece: p, indices: x.changed });
    const ctrl = P.channels[channel].map((v, i) => (x.changed.includes(i) ? q(x.ctrl[i], D.DEC[channel]) : v));
    return { ...P, channels: { ...P.channels, [channel]: ctrl } };
  });
  return { pieces, changed };
}

// ── THE BRUSH MODES (D186) ──────────────────────────────────────────────────────────────────────────────────────────────
// "Push a hill up" must be LOCAL: the track past the brush unchanged, with no re-close. A brush on the pitch RATE cannot be:
// its ∫Δκv tilts everything after it. Nor can a hill made THROUGH the rate, κv = h″: the height and pitch come back, but the road
// over the hill is longer in arc length, so the track past it moves back by ∫(1 − cos h′) ds (measured on 17c2301: 22 cm for a
// 5 m hill over r = 100 m; the D186 hand-back §1). So a hill and a swerve are brushes on the document's OFFSET channels, height
// `h` and lateral `l`: value channels like phi, w and r, which the adapter adds to the position. Zero outside the window, so the
// track past it is untouched by construction. Whether the document carries them is A's (src/core/README.md); until it does, a
// hill or a swerve is refused by name, and nothing is faked through the rate.
/**
 * THE SHARP BRUSH'S DECLARED SPILL (the chair's D186 ruling 2: opt-in, and its cost stated in the UI and the docs). Measured on the
 * 21 sharp brushes at r = 20 m of the D186 hand-back §10 (every channel, 25/50/75% of generated track 0): outside W⁺ every channel
 * changed by at most 0.355 of its quantum, and the track past W⁺ moved by at most 70 µm (6.98e-5 m). Declared with margin below.
 * SHARP_NOTE is the sentence the app shows when the user turns sharp on.
 */
const SHARP_BOUND = Object.freeze({ quantaOutside: 0.5, pathM: 1e-4 });
const SHARP_NOTE = 'Sharp brush: acts at exactly the size you set by adding finer control points first. It can nudge the track just outside the brush by up to 0.1 mm, and the road values there by less than half their stored step. Leave it off for an exactly local edit.';
const MODES = Object.freeze({
  hill: { channels: ['h'], what: 'height offset, m' },
  swerve: { channels: ['l'], what: 'lateral offset, m (+ = left)' },
  value: { channels: ['phi', 'w', 'r', 'h', 'l', 'c', 'e', 's', 't', 'er'], what: 'a value channel: bank, width, rise, height, lateral offset, cup (cup pieces only), edge angle or edge start (edge pieces only), tube sweep (tube pieces only); a brush that takes one outside its range is refused by name' },
  rate: { channels: ['kh', 'kv'], what: 'turn or climb harder from here on: a heading- or pitch-rate brush, which re-closes a closed lap' },
});

/**
 * THE brush. `mode` is 'hill' (the default), 'swerve', 'value' or 'rate'; `channel` is needed only for 'value' and 'rate'.
 * Returns what `sculpt` returns, plus `mode`, and for a rate brush on a CLOSED track `close`: the re-close's report. The lap is
 * re-closed with the brushed stretch protected (close's `edited`), and a re-close that fails leaves the track OPEN and says so.
 */
function brush(doc, { mode = 'hill', channel, s0, r, delta, sharp = false } = {}) {
  const M = MODES[mode];
  // SHARP (opt-in): refine the knots under the brush first (A's refineKnots, Boehm), so it acts at the asked radius instead of
  // widening. Its cost, measured (the D186 hand-back §3): the new control points are re-quantised in EVERY channel, so values up to
  // 2.7e-5 change outside the window and the track past it moves by up to 70 µm. So it is never the default.
  if (sharp) {
    if (typeof D.refineKnots !== 'function') throw new D.CoreError('NOT_YET', 'brush: a sharp brush needs document.js refineKnots (A)');
    const h = (2 * r) / 6, lo = s0 - r - 3 * h, hi = s0 + r + 3 * h, off = pieceOffsets(doc);
    // (a piece that only touches [lo, hi] at its end or its start has no span to refine: refineKnots refuses the zero-width range, BAD_RANGE [L, L], D421)
    doc.pieces.forEach((P, p) => { if (P.type !== 'road' || off[p] + P.length <= lo || off[p] >= hi) return; doc = D.refineKnots(doc, P.id, Math.max(0, lo - off[p]), Math.min(P.length, hi - off[p]), h).doc; });
  }
  if (!M) throw new D.CoreError('BAD_MODE', `brush: mode "${mode}" (known: ${Object.keys(MODES).join(', ')})`);
  const ch = channel || (M.channels.length === 1 ? M.channels[0] : null);
  if (!ch || !M.channels.includes(ch)) throw new D.CoreError('BAD_CHANNEL', `brush: mode "${mode}" takes ${M.channels.join(' or ')} (${M.what}), got ${channel}`);
  if (!D.CHANNELS.includes(ch)) throw new D.CoreError('NOT_YET', `brush: the document has no "${ch}" channel yet (${M.what}); a ${mode} brush needs it (src/core/README.md, A)`);
  // A hill or a swerve asks for its PEAK: "raise the road by Δ". The bump on the control points peaks lower than Δ when few control
  // points carry it (a narrow brush), and off s₀ when the knots are uneven under it, so the brush is run once at unit Δ, its own
  // largest change over the window used is read (every 0.25 m), and Δ is scaled by that (a ratio, E's rule; ref 10 §4).
  let d = delta;
  if (mode === 'hill' || mode === 'swerve') {
    const kept = Object.isFrozen(doc) && doc.pieces.every(Object.isFrozen) ? (RATIO_CACHE.get(doc) || RATIO_CACHE.set(doc, new Map()).get(doc)) : null;
    const key = `${ch}|${keyNum(s0)}|${keyNum(r)}`;
    if (kept && kept.has(key)) d = delta / kept.get(key);
    else {
    const unit = sculpt(doc, { channel: ch, s0, r, delta: 1 }), ru = unit.radiusUsed;
    // D421: each document's offsets once, not at every reading (each reading segmented the whole track: 3.4 s a step on 2 km, 21 s on 10 km)
    const offU = pieceOffsets(unit.doc), off0 = pieceOffsets(doc);
    let got = 0; for (let s = Math.max(0, s0 - ru); s <= s0 + ru; s += 0.25) { let v; try { v = valueAt(unit.doc, ch, s, offU) - valueAt(doc, ch, s, off0); } catch (e) { continue; } if (Math.abs(v) > Math.abs(got)) got = v; }
    if (!(Math.abs(got) > 1e-6)) throw new D.CoreError('BAD_BRUSH', `brush: a ${mode} at ${s0} m moves no control point (${unit.note || 'a joint the window only half covers'})`);
    d = delta / got;
    if (kept) { kept.set(key, got); if (kept.size > RATIO_MAX) kept.delete(kept.keys().next().value); }
    }
  }
  const res0 = sculpt(doc, { channel: ch, s0, r, delta: d }), res = sharp ? { ...res0, note: SHARP_NOTE, sharp: SHARP_BOUND } : res0;
  if (mode !== 'rate' || !doc.closed || !res.changed.length) return { ...res, mode };
  const { close } = require('./close.js');
  const c = close({ ...res.doc, closed: false }, { edited: res.changed.map((x) => x.piece) });
  return { ...res, mode, doc: c.doc, close: { converged: c.converged, iterations: c.iterations, gapM: c.gapM, report: c.report } };
}

// ── D421, THE SCULPT MODE's two new tools (P's design, exo_memory/loop/design_d421_sculpt_P_2026-10-20.md §3.2 and §3.7) ─────────────────────────────────────
const RATE_CHANNELS = Object.freeze(['kh', 'kv']);
/** The shortest piece Stretch makes (m), and the shortest knot span it leaves (m: refineKnots' own floor, so a refined piece is never squeezed past it). */
const STRETCH_MIN_M = 1, STRETCH_SPAN_MIN_M = 0.01;
/** The piece indices of `which`: one index, or a run { from, to } (inclusive; on a closed lap, from after to runs across the start line). */
function runOf(doc, which) {
  const n = doc.pieces.length, has = (i) => Number.isInteger(i) && i >= 0 && i < n;
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  if (typeof which === 'number') { if (!has(which)) throw new D.CoreError('NO_PIECE', `stretch: no piece ${which} (the track has ${n})`); return [which]; }
  if (!which || !Number.isInteger(which.from) || !Number.isInteger(which.to)) throw new D.CoreError('BAD_RUN', `stretch: a run is { from, to }, two piece indices, got ${JSON.stringify(which)}`);
  if (!has(which.from) || !has(which.to)) throw new D.CoreError('NO_PIECE', `stretch: no piece ${has(which.from) ? which.to : which.from} (the track has ${n})`);
  if (which.from <= which.to) return range(which.from, which.to);
  if (!doc.closed) throw new D.CoreError('BAD_RUN', `stretch: a run from ${which.from} back to ${which.to} needs a closed lap (it runs across the start line)`);
  return [...range(which.from, n - 1), ...range(0, which.to)];
}
/**
 * STRETCH (design §3.2): road piece `which` (an index), or every road piece of a run ({ from, to }) by ONE factor, to `L1` m in all (a run's L1 is its road length; a
 * flight inside it is left as it is). The knots scale with the length (the same count at the same fractions, so a value channel keeps its shape along the piece).
 * The default keeps the BEND: the rate channels kh and kv are scaled by L0 / L1, so a corner turns and climbs what it did over its new length; `keepRate` keeps the
 * rates instead (the piece turns more). Every road joint the stretch touches is rebuilt as the document builds a piece: the later piece's first control point is the
 * earlier one's last, its second from the earlier one's end slope (a flight breaks the link, so a landing starts where it did). Quantised, checked, frozen; untouched
 * pieces are the SAME objects. Returns { doc, pieces: [indices changed], factor, lengthChange: the road's length after minus before (m), reclose: true on a closed lap
 * (the lap is handed back with the gap the stretch opened; the shell re-closes it on release, never per step) }.
 */
function stretch(doc, which, L1, { keepRate = false } = {}) {
  const idx = runOf(doc, which), road = idx.filter((p) => doc.pieces[p].type === 'road');
  if (!road.length) throw new D.CoreError('NOT_ROAD', `stretch: piece ${doc.pieces[idx[0]].id} is a ${doc.pieces[idx[0]].type}, and a stretch needs road`);
  if (!(Number.isFinite(L1) && L1 > 0)) throw new D.CoreError('BAD_LENGTH', `stretch: the new length must be a positive number of metres, got ${L1}`);
  const L0 = road.reduce((a, p) => a + doc.pieces[p].length, 0), f = L1 / L0;
  const lengthOf = (P) => q(road.length === 1 ? L1 : P.length * f, D.DEC.m);
  if (road.every((p) => lengthOf(doc.pieces[p]) === doc.pieces[p].length)) return { doc, pieces: [], factor: 1, lengthChange: 0, reclose: false };
  const out = doc.pieces.slice(), inRun = new Set(road);
  for (const p of road) {
    const P = doc.pieces[p], L = lengthOf(P);
    if (L < STRETCH_MIN_M) throw new D.CoreError('BAD_LENGTH', `stretch: piece ${P.id} would be ${L} m long; a piece is at least ${STRETCH_MIN_M} m`);
    const knots = P.knots.map((t) => q((t * L) / P.length, D.DEC.m)), tt = [0, ...knots, L];
    const minSpan = Math.min(...tt.slice(1).map((x, k) => x - tt[k]));
    if (!(minSpan >= STRETCH_SPAN_MIN_M - 1e-9)) throw new D.CoreError('BAD_LENGTH', `stretch: at ${L} m piece ${P.id}'s shortest knot span would be ${+minSpan.toFixed(4)} m, under ${STRETCH_SPAN_MIN_M} m`);
    out[p] = { ...P, length: L, knots, channels: { ...P.channels } };
  }
  // KEEP THE BEND (the default): the piece turns and climbs what it did. ∫c ds of a clamped cubic is Σ cᵢ (tᵢ₊₄ − tᵢ) / 4, so the rate's middle control points are
  // scaled by the one g that keeps that sum. Its two ends keep their value AND slope (the start as the joint before builds it, the end as it was), so the rate the
  // neighbours meet is unchanged and the piece after keeps its start. A plain L0 / L1 on every point would leave the first two at the old rate and turn short (4.6% on a
  // 200 m corner stretched to 300 m), and holding the end values alone sent the end slope to 14 rad/m² on a corner shrunk to 1 m (D421 C, both measured). Where the
  // middle carries no net turn (an S whose halves cancel) there is no such g, and it is scaled by L0 / L1; a piece of one span has no middle and keeps its rates.
  const area = (c, t, from, to) => { let x = 0; for (let i = from; i <= to; i++) x += (c[i] * (t[i + 4] - t[i])) / 4; return x; };
  const keepBend = (P0, B, ch, linked) => {
    const c0 = P0.channels[ch], n = c0.length, t0 = D.knotVector(P0), t = D.knotVector(B), dec = D.DEC[ch], x = B.channels[ch].slice();
    if (!linked) x[1] = q(x[0] + (c0[1] - c0[0]) * (t[4] / t0[4]), dec);   // an unlinked start (the lap's first piece, a landing) keeps its own start slope
    x[n - 2] = q(x[n - 1] - (c0[n - 1] - c0[n - 2]) * ((t[n + 3] - t[n - 1]) / (t0[n + 3] - t0[n - 1])), dec);   // the end keeps its slope
    if (n >= 5) {
      const want = area(c0, t0, 0, n - 1) - area(x, t, 0, 1) - area(x, t, n - 2, n - 1), mid = area(x, t, 2, n - 3);
      const g = Math.abs(mid) > 1e-6 * area(x.map(Math.abs), t, 2, n - 3) ? want / mid : P0.length / B.length;
      for (let i = 2; i <= n - 3; i++) x[i] = q(x[i] * g, dec);
    }
    B.channels[ch] = x;
  };
  // the joints the stretch touches, in the document's order: the later piece rebuilt from the earlier one's end (value, then slope), as the document builds a piece
  const lastSpan = (P) => P.length - (P.knots.length ? P.knots[P.knots.length - 1] : 0), firstSpan = (P) => (P.knots.length ? P.knots[0] : P.length);
  let a = -1;
  for (let b = 0; b < doc.pieces.length; b++) {
    if (doc.pieces[b].type !== 'road') continue;
    const joint = a >= 0 && (inRun.has(a) || inRun.has(b));
    if (joint || inRun.has(b)) {
      const A = joint ? out[a] : null, B = out[b] === doc.pieces[b] ? { ...doc.pieces[b], channels: { ...doc.pieces[b].channels } } : out[b];
      for (const ch of D.CHANNELS) {
        const linked = joint && isLinked(doc, a, b, ch);
        if (linked) {
          const c = A.channels[ch], n = c.length, v = q(c[n - 1], D.DEC[ch]), m = (3 * (v - q(c[n - 2], D.DEC[ch]))) / lastSpan(A);
          const x = B.channels[ch].slice(); x[0] = v; x[1] = q(v + (m * firstSpan(B)) / 3, D.DEC[ch]);
          B.channels[ch] = x;
        }
        if (inRun.has(b) && !keepRate && RATE_CHANNELS.includes(ch)) keepBend(doc.pieces[b], B, ch, linked);
      }
      // a piece outside the run whose start came out as it was stays the same object
      out[b] = !inRun.has(b) && D.CHANNELS.every((ch) => { const x = B.channels[ch], y = doc.pieces[b].channels[ch]; return x === y || (x && y && x.every((v, i) => v === y[i])); }) ? doc.pieces[b] : B;
    }
    a = b;
  }
  const pieces = out.map((P, p) => p).filter((p) => out[p] !== doc.pieces[p]);
  const lengthChange = q(road.reduce((s, p) => s + out[p].length - doc.pieces[p].length, 0), D.DEC.m);
  return { doc: freeze(D.checkDoc({ ...doc, pieces: out })), pieces, factor: f, lengthChange, reclose: !!doc.closed };
}

/** Smooth's cap on λ (λ above 1 runs ⌈λ⌉ passes of λ / ⌈λ⌉ each, so a longer drag smooths more and every pass stays stable), and its smallest window, in knot spans. */
const SMOOTH_MAX = 64, SMOOTH_SPANS = 4;
/**
 * SMOOTH (design §3.7): a Laplacian relax of ONE channel's control points under the window [s0 − r, s0 + r]: cᵢ ← cᵢ + λ·f(dᵢ)·((cᵢ₋₁ + cᵢ₊₁) / 2 − cᵢ), f the brush's
 * falloff at the point's knot average, every pass read from the one before (Jacobi). A control point moves only when its whole support lies in the window (so the road
 * outside it is untouched bit for bit), and the window's outer four (its first two and last two) are held. A road-road joint inside the window is one point of the
 * chain (the earlier piece's last, whose neighbour past the joint is the later piece's second) and moves value-then-slope; a joint the window covers in part, the
 * lap's first point and a landing's start are held. A window narrower than SMOOTH_SPANS knot spans is widened to it, and `note` says so. Pure; λ = 0 is the same
 * document. Returns { doc, changed: [{ piece, indices }], radiusUsed, passes, note, reclose: true for a route channel (kh, kv) on a closed lap }.
 */
function smooth(doc, channel, s0, r, lambda) {
  if (!D.CHANNELS.includes(channel)) throw new D.CoreError('BAD_CHANNEL', `smooth: channel "${channel}" (known: ${D.CHANNELS.join(', ')})`);
  if (!(r > 0) || !Number.isFinite(s0)) throw new D.CoreError('BAD_BRUSH', `smooth: needs r > 0 and a finite s0 (got r ${r}, s0 ${s0})`);
  if (!(lambda >= 0 && lambda <= SMOOTH_MAX)) throw new D.CoreError('BAD_BRUSH', `smooth: λ must be within 0 to ${SMOOTH_MAX}, got ${lambda}`);
  if (lambda === 0) return { doc, changed: [], radiusUsed: r, passes: 0, note: 'λ is 0: nothing changed', reclose: false };
  const off = pieceOffsets(doc), rUsed = widened(doc, off, s0, r, SMOOTH_SPANS);
  const cur = doc.pieces.map(() => null), wt = [], inW = [];
  doc.pieces.forEach((P, p) => {
    if (P.type !== 'road' || off[p] + P.length < s0 - rUsed || off[p] > s0 + rUsed) return;
    checkReach(P, channel);
    const t = D.knotVector(P), c = P.channels[channel], s = s0 - off[p];
    cur[p] = c.slice();
    inW[p] = c.map((v, i) => t[i] >= s - rUsed && t[i + 4] <= s + rUsed);
    wt[p] = c.map((v, i) => falloff(knotAverage(t, i) - s, rUsed));
  });
  // the chain: each window piece's next road piece when the two are linked (whole: all four joint points in the window), and the points that move
  const roads = cur.map((x, p) => p).filter((p) => cur[p]), next = [], prevLinked = [];
  for (let k = 0; k + 1 < roads.length; k++) {
    const a = roads[k], b = roads[k + 1], na = cur[a].length;
    if (doc.pieces.slice(a + 1, b).some((P) => P.type === 'road') || !isLinked(doc, a, b, channel)) continue;
    prevLinked[b] = true;
    if (inW[a][na - 1] && inW[a][na - 2] && inW[b][0] && inW[b][1]) next[a] = b;
    else { inW[a][na - 1] = inW[a][na - 2] = inW[b][0] = inW[b][1] = false; }   // a joint the window covers in part: all four held
  }
  const free = [];
  for (const p of roads) cur[p].forEach((v, i) => {
    if (!inW[p][i]) return;
    if (prevLinked[p] && i < 2) return;                          // a linked joint's later side follows the earlier one (or is held, above)
    if (i === 0 || (i === cur[p].length - 1 && next[p] === undefined)) return;   // no neighbour on one side: the lap's first point, a landing's start, the window's last piece's end
    free.push([p, i]);
  });
  const moving = free.slice(2, -2);
  const passes = Math.ceil(lambda), lam = lambda / passes;
  const lastSpan = (P) => P.length - (P.knots.length ? P.knots[P.knots.length - 1] : 0), firstSpan = (P) => (P.knots.length ? P.knots[0] : P.length);
  for (let k = 0; k < passes; k++) {
    const was = cur.map((x) => x && x.slice());
    for (const [p, i] of moving) {
      const right = i + 1 < was[p].length ? was[p][i + 1] : was[next[p]][1];
      cur[p][i] = was[p][i] + lam * wt[p][i] * ((was[p][i - 1] + right) / 2 - was[p][i]);
    }
    for (const a of roads) {
      const b = next[a]; if (b === undefined) continue;
      const c = cur[a], n = c.length;
      cur[b][0] = c[n - 1]; cur[b][1] = c[n - 1] + ((c[n - 1] - c[n - 2]) * firstSpan(doc.pieces[b])) / lastSpan(doc.pieces[a]);
    }
  }
  const res = doc.pieces.map((P, p) => {
    if (!cur[p]) return null;
    const changed = moving.filter(([x]) => x === p).map(([, i]) => i);
    if (roads.some((a) => next[a] === p)) changed.unshift(0, 1);
    return { ctrl: cur[p], changed };
  });
  const { pieces, changed } = settle(doc, channel, res);
  const out = changed.length ? freeze(D.checkDoc({ ...doc, pieces })) : doc;
  const note = changed.length ? (rUsed > r ? `the smooth was widened from ${r} m to ${+rUsed.toFixed(3)} m, ${SMOOTH_SPANS} knot spans, the smallest that moves a control point between the four it holds` : null) : 'the smooth window holds no control point it may move: nothing changed';
  return { doc: out, changed, radiusUsed: rUsed, passes, note, reclose: !!(doc.closed && RATE_CHANNELS.includes(channel) && changed.length) };
}

module.exports = { smootherstep, falloff, knotAverage, brushControls, sculpt, pieceOffsets, brush, MODES, SHARP_BOUND, SHARP_NOTE, stretch, smooth, STRETCH_MIN_M, STRETCH_SPAN_MIN_M, SMOOTH_MAX, SMOOTH_SPANS };
