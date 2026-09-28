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
  const off = pieceOffsets(doc), near = doc.pieces.filter((P, p) => P.type === 'road' && off[p] + P.length >= s0 - r && off[p] <= s0 + r);
  const span = Math.max(0, ...near.map((P) => { const t = [0, ...P.knots, P.length]; return Math.max(...t.slice(1).map((x, k) => x - t[k])); }));
  const rUsed = Math.max(r, 3 * span);
  const res = doc.pieces.map((P, p) => {
    if (P.type !== 'road' || off[p] + P.length < s0 - rUsed || off[p] > s0 + rUsed) return null;
    return brushControls(P.channels[channel], D.knotVector(P), { s0: s0 - off[p], r: rUsed, delta });
  });
  // the joints: road piece a, then road piece b (a flight between them breaks the C1 link for kh and kv only: README)
  let a = -1;
  for (let b = 0; b < doc.pieces.length; b++) {
    if (doc.pieces[b].type !== 'road') continue;
    const Pb = doc.pieces[b], rb = res[b];
    const linked = a >= 0 && !(doc.pieces.slice(a + 1, b).some((P) => P.type === 'flight') && (channel === 'kh' || channel === 'kv'));
    if (!linked) {                                             // an unlinked start (the lap's first piece, or level after a flight)
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

module.exports = { smootherstep, falloff, knotAverage, brushControls, sculpt, pieceOffsets };
