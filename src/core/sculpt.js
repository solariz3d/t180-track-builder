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

/** Where each piece starts along the adapter's path (the s a user picks on the preview): the sum of its segments' lengths. */
function pieceOffsets(doc) {
  const len = new Map(); for (const g of toSegments(doc)) len.set(g.id, (len.get(g.id) || 0) + g.length);
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

/** A channel's value at lap distance s (the road piece holding s; ref 03 §1 through document.js channelAt). */
function valueAt(doc, ch, s) {
  const off = pieceOffsets(doc); let p = -1;
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
  const off = pieceOffsets(doc);
  // (a widened window can reach coarser spans, so widen until it holds: at most as many rounds as there are pieces)
  let rUsed = r;
  for (let k = 0; k <= doc.pieces.length; k++) { const w = Math.max(r, 3 * spanUnder(doc, off, s0 - rUsed, s0 + rUsed)); if (w === rUsed) break; rUsed = w; }
  const res = doc.pieces.map((P, p) => {
    if (P.type !== 'road' || off[p] + P.length < s0 - rUsed || off[p] > s0 + rUsed) return null;
    if (D.OPTIONAL[channel] && channel !== 'c' && !P[D.OPTIONAL[channel]]) throw new D.CoreError('NOT_' + D.OPTIONAL[channel].toUpperCase(), 'a ' + channel + ' brush reaches piece ' + P.id + ', which has no ' + D.OPTIONAL[channel] + ': extend with a ' + (channel === 't' ? 't' : 'e or s') + ' target first, or brush only ' + D.OPTIONAL[channel] + ' pieces (D225)');
    if (channel === 'c' && !P.cup) throw new D.CoreError('NOT_CUP', 'a cup brush reaches piece ' + P.id + ', which has no cup (a legacy piece renders the old profile): extend with a cup target first, or brush only cup pieces');
    return brushControls(P.channels[channel], D.knotVector(P), { s0: s0 - off[p], r: rUsed, delta });
  });
  // the joints: road piece a, then road piece b (a flight between them breaks the C1 link for kh and kv only: README)
  let a = -1;
  for (let b = 0; b < doc.pieces.length; b++) {
    if (doc.pieces[b].type !== 'road') continue;
    const Pb = doc.pieces[b], rb = res[b];
    const linked = a >= 0 && !(doc.pieces.slice(a + 1, b).some((P) => P.type === 'flight') && (channel === 'kh' || channel === 'kv')) && (!D.OPTIONAL[channel] || (doc.pieces[a][D.OPTIONAL[channel]] && Pb[D.OPTIONAL[channel]]));
    if (!linked) {                                             // an unlinked start (the lap's first piece, or level after a flight)
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
  const out = changed.length ? freeze(D.checkDoc({ ...doc, pieces })) : doc;
  return { doc: out, changed, radiusUsed: rUsed, note: changed.length ? (rUsed > r ? `the brush was widened from ${r} m to ${+rUsed.toFixed(3)} m, 3 knot spans, the smallest that moves whole control points` : null) : 'the brush window holds no whole control-point support: nothing changed' };
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
  value: { channels: ['phi', 'w', 'r', 'h', 'l', 'c', 'e', 's', 't'], what: 'a value channel: bank, width, rise, height, lateral offset, cup (cup pieces only), edge angle or edge start (edge pieces only), tube sweep (tube pieces only); a brush that takes one outside its range is refused by name' },
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
    doc.pieces.forEach((P, p) => { if (P.type !== 'road' || off[p] + P.length < lo || off[p] > hi) return; doc = D.refineKnots(doc, P.id, Math.max(0, lo - off[p]), Math.min(P.length, hi - off[p]), h).doc; });
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
    const unit = sculpt(doc, { channel: ch, s0, r, delta: 1 }), ru = unit.radiusUsed;
    let got = 0; for (let s = Math.max(0, s0 - ru); s <= s0 + ru; s += 0.25) { let v; try { v = valueAt(unit.doc, ch, s) - valueAt(doc, ch, s); } catch (e) { continue; } if (Math.abs(v) > Math.abs(got)) got = v; }
    if (!(Math.abs(got) > 1e-6)) throw new D.CoreError('BAD_BRUSH', `brush: a ${mode} at ${s0} m moves no control point (${unit.note || 'a joint the window only half covers'})`);
    d = delta / got;
  }
  const res0 = sculpt(doc, { channel: ch, s0, r, delta: d }), res = sharp ? { ...res0, note: SHARP_NOTE, sharp: SHARP_BOUND } : res0;
  if (mode !== 'rate' || !doc.closed || !res.changed.length) return { ...res, mode };
  const { close } = require('./close.js');
  const c = close({ ...res.doc, closed: false }, { edited: res.changed.map((x) => x.piece) });
  return { ...res, mode, doc: c.doc, close: { converged: c.converged, iterations: c.iterations, gapM: c.gapM, report: c.report } };
}

module.exports = { smootherstep, falloff, knotAverage, brushControls, sculpt, pieceOffsets, brush, MODES, SHARP_BOUND, SHARP_NOTE };
