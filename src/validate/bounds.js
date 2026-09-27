// bounds.js: live physics bounds for the sculpt handles (the keeper, 12:22: "you can also sculp pieces, and then even
// create and save your own unqiue pieces"; ARCHITECTURE.md:46 "Handles: the continuous parameters sculpt mode drags,
// bounded live by physics"; docs/INTERFACES.md §4b).
//
//   handleBounds(doc, id, opts) -> { id, word, redNow, handles: { <h>: { value, min, max, below, above,
//                                                                         amberMin, amberMax } } }
//
// For each handle of word `id`, the range around its current value over which that word stays out of RED, and the
// range over which it also stays out of AMBER. Every bound is found by running the SAME validation (src/validate/
// index.js, so the SAME FINDINGS limits) on the document with that one handle changed, rebuilt through A's resolve and
// C's buildPath. So "just inside validates clean, just outside turns red" holds by construction, and the bound is exact to
// the handle's own quantum (src/doc/serial.js: 1 mm, 0.001°, 0.0001), the finest value a sculpt can reach.
//
// WHY THE DOCUMENT, NOT (path, segments, index). INTERFACES §4b sketches handleBounds(path, segments, index). But
// segments carry no handles (A's resolve turns one word into its ease-in, body and ease-out segments), so a changed
// handle cannot be rebuilt from them. A's own hook, src/doc/library.js handleInfo(doc, id, boundsFn), calls
// boundsFn(doc, id), and this matches it: pass (doc, id) => handleBounds(doc, id, opts).handles.
//
// `below` / `above` say what stops the bound: { kind: 'red', reasons: [...], sources: [...] } from validation, or
// { kind: 'range' } at the handle's document range (src/doc/serial.js RANGE), or { kind: 'refused', message } when the
// document or the geometry refuses the value (e.g. easeIn + easeOut over 1).
//
// SEARCH. Outward from the current value in doubling steps of one quantum, then bisection between the last clean value
// and the first failing one. Limit: a failing island narrower than the step that jumped over it is not seen (not verified
// to be impossible); the steps start at one quantum, so near the current value nothing is skipped.
'use strict';
const D = require('../doc/index.js');
const { UNIT, RANGE, quantise } = require('../doc/serial.js');
const { buildPath } = require('../geom/index.js');
const { validate } = require('./index.js');

const QUANTUM = { m: 1e-3, deg: 1e-3 * Math.PI / 180, ratio: 1e-4 };

/** Validate the document with word `id`'s handle `h` set to v. Returns { ok, amber, red, refused }. */
function probe(doc, id, h, v, opts) {
  let segs, path;
  try {
    const d2 = D.editWord(doc, id, { handles: { [h]: v } });
    segs = D.resolve(d2).segments;
    path = buildPath(segs, { step: opts.step || 2, closed: d2.closed });
  } catch (e) { return { ok: false, refused: e.message }; }
  const r = validate(path, segs, opts.validate || {});
  const idx = path.samples.map((p, i) => (segs[p.seg].id === id ? i : -1)).filter((i) => i >= 0);
  const s0 = path.samples[idx[0]].s, s1 = path.samples[idx[idx.length - 1]].s;
  // SCOPE. On an otherwise clean track, ANY new red counts: a sculpted turn can swing a later word onto earlier road, and
  // that stack marks the later stations, not this word's. On a track already red elsewhere (opts.scope 'word', set by
  // handleBounds), only findings on this word's own stretch of road count, so an unrelated red does not pin every bound.
  const here = (x) => opts.scope !== 'word' || (x.s0 <= s1 + 1e-9 && x.s1 >= s0 - 1e-9);
  const red = r.red.filter(here), amber = r.amber.filter(here);
  return { ok: red.length === 0, amber: amber.length > 0, red, amberList: amber };
}

/** Search one side (dir = +1 up, −1 down) from q0 for the last quantum where `good` holds. */
function edge(q0, dir, qLim, good) {
  let lastOk = q0, step = 1, fail = null;
  for (;;) {
    let q = q0 + dir * step;
    if (dir > 0 ? q >= qLim : q <= qLim) { q = qLim; const r = good(q); if (r.good) return { q, stop: { kind: 'range' } }; fail = { q, r }; break; }
    const r = good(q);
    if (!r.good) { fail = { q, r }; break; }
    lastOk = q; step *= 2;
  }
  let a = lastOk, b = fail.q, failR = fail.r;           // a good, b bad
  while (Math.abs(b - a) > 1) { const m = Math.round((a + b) / 2); const r = good(m); if (r.good) a = m; else { b = m; failR = r; } }
  return { q: a, stop: failR.stop };
}

function stopOf(p) {
  if (p.refused) return { kind: 'refused', message: p.refused };
  const all = [...(p.red || []), ...(p.amberList || [])];
  return { kind: p.red && p.red.length ? 'red' : 'amber', reasons: [...new Set(all.map((x) => x.reason))], sources: [...new Set(all.map((x) => x.source))] };
}

function handleBounds(doc, id, opts = {}) {
  const w = doc.words.find((x) => x.id === id);
  if (!w) throw new Error(`handleBounds: no word "${id}" in the document`);
  const names = opts.handles || Object.keys(w.handles);
  // the track as it is: red anywhere? Then bound only on this word's stretch (see probe's SCOPE)
  const whole = probe(doc, id, names[0], w.handles[names[0]], { ...opts, scope: 'track' });
  opts = { ...opts, scope: whole.ok ? 'track' : 'word' };
  const now = probe(doc, id, names[0], w.handles[names[0]], opts);   // the word as it is, in that scope
  const out = { id, word: w.word, scope: opts.scope, redNow: !now.ok, handles: {} };
  for (const h of names) {
    const unit = UNIT[h], qt = QUANTUM[unit], [lo, hi] = RANGE[h];
    const v0 = w.handles[h], q0 = Math.round(v0 / qt);
    const toV = (q) => quantise(unit, q * qt);
    const cache = new Map();
    const at = (q) => { if (!cache.has(q)) cache.set(q, probe(doc, id, h, toV(q), opts)); return cache.get(q); };
    const qLo = Math.ceil(lo / qt - 1e-9), qHi = Math.floor(hi / qt + 1e-9);
    if (now.ok === false) { out.handles[h] = { value: v0, min: null, max: null, below: { kind: 'red-now' }, above: { kind: 'red-now' }, amberMin: null, amberMax: null }; continue; }
    const noRed = (q) => { const p = at(q); return { good: p.ok, stop: stopOf(p) }; };
    // the amber search runs only inside the red-free range (its limit is up.q / down.q), so it needs no red test of its own
    const noAmber = (q) => { const p = at(q); return { good: !p.amber, stop: stopOf(p) }; };
    const up = edge(q0, +1, qHi, noRed), down = edge(q0, -1, qLo, noRed);
    const amberNow = at(q0).amber;
    const aUp = amberNow ? null : edge(q0, +1, up.q, noAmber), aDown = amberNow ? null : edge(q0, -1, down.q, noAmber);
    out.handles[h] = {
      value: v0, unit,
      min: toV(down.q), max: toV(up.q), below: down.stop, above: up.stop,
      amberMin: aDown ? toV(aDown.q) : null, amberMax: aUp ? toV(aUp.q) : null,
    };
  }
  return out;
}

module.exports = { handleBounds, probe, QUANTUM };
