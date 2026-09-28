// fontshape.cjs: the MEASURED FONTS (D182, pane C). tools/corpus.cjs gives the cross-section ψ per word CLASS; a font is a
// cross-section SHAPE, so this gives ψ per shape FAMILY, from the same words.
//   node tools/fontshape.cjs <reads dir>              (JSON to stdout; FINDINGS-style numbers only)
// THE UNIT, THE LAYOUTS, THE SHARED-ROAD RULE AND THE SIDES are corpus.cjs's, exactly (its LAYOUTS and its tests are
// reused; the per-word sampling below is the same code path, restated because corpus.cjs exports only its aggregates):
// one reader word is one sample; ψ is the word's median tilt from the centre normal at ¼, ½, ¾ and the edge of each
// side; inside/outside of the turn on a curved word, the lower/higher side on a straight. `check` recomputes corpus.cjs's
// per-CLASS ψ bands from these samples, so a divergence from corpus.json shows before any font is read from them.
// THE FAMILIES are vocabgen.js's FONT_OF_SHAPE: bowl and bowl+ are the bowl, pipe and pipe+ the half-pipe, flat is flat.
// THE HALF-PIPE IS TWO SHAPES (measured, D182): its words' ψ at ¾ (the mean of the two sides) peak at 12-16° and at
// 28-32°, with few between. Their median is a profile no track has (it rises more gently than every real half-pipe), so the
// pipe words are split at ψ¾ = 20°: `half-pipe` is the gentle floor with a steep last quarter (349 words: 289 of Sakura's 291
// pipe words, 53 of Thunderhead's 71), `half-pipe-deep` the progressive rise that flattens at the rim (499: all 396 of
// Centrifuge's, both bowl tracks', Nordic's). The bowl and flat are one mode each.
const PIPE_SPLIT = 20, psi34 = (w) => (w.psiIn[2] + w.psiOut[2]) / 2;
// Only the road classes (straight, sweep, turn, tight) make a font; wall-ride and inversion wear one.
// THE TILT RATE (the no-lip measure, D182: the keeper saw rims "flip up too much"): per station and side, the rise of ψ
// over each quarter of that side's width, in degrees per metre (a side's width is its count of 1 m points, and the
// reader samples ψ at the ¼, ½, ¾ and last point, so each quarter is width/4 m; ψ at the centre is 0). A station's rate
// is the largest rise over both sides; a word's is the median over its stations, as every other per-word quantity.
'use strict';
const fs = require('fs'), path = require('path');
const { LAYOUTS, pct } = require('./corpus.cjs');

const STEP = 4;
const WORD = /^(flat|bowl\+?|pipe\+?)-(straight|sweep[LR]|turn[LR]|tight[LR])(\/up|\/down)?(\^wall|\^inv)?$/;
const FAMILY = { flat: 'flat', bowl: 'bowl', 'bowl+': 'bowl', pipe: 'half-pipe', 'pipe+': 'half-pipe' };
const ROAD = ['straight', 'sweep', 'turn', 'tight'];
const band = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? { p10: pct(v, 0.1), p25: pct(v, 0.25), p50: pct(v, 0.5), p75: pct(v, 0.75), p90: pct(v, 0.9), n: v.length } : null; };
const med = (xs) => pct(xs, 0.5);

/** Every counted word of the learning library, sampled as corpus.cjs samples it. */
function words(dir) {
  const taken = [], out = [];
  const cellOf = (c) => c.map((v) => Math.floor(v / 8)).join(',');
  const near = (c) => { for (const g of taken) { const k = c.map((v) => Math.floor(v / 8)); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const q of g.get([k[0] + x, k[1] + y, k[2] + z].join(',')) || []) if (Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 5) return true; } return false; };
  for (const [file, name] of LAYOUTS) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, `${file}.read.json`), 'utf8'));
    if (r.end !== 'closed') throw new Error(`${file}: the read did not close (${r.end})`);
    const S = r.stations.filter((s) => s.c && !s.jump && !s.junction), byD = new Map(S.map((s) => [s.d, s]));
    for (const w of r.text) {
      if (/^JUMP/.test(w.w)) continue;
      const m = WORD.exec(w.w);
      if (!m) throw new Error(`${file}: a word the corpus does not know: ${w.w}`);
      const st = []; for (let d = w.from; d <= w.to; d += 1) { const s = byD.get(d); if (s) st.push(s); }
      if (!st.length) continue;
      if (st.filter((s) => near(s.c)).length * 2 >= st.length) continue;
      const klass = m[4] === '^inv' ? 'inversion' : m[4] === '^wall' ? 'wall-ride' : m[2].replace(/[LR]$/, '');
      const ks = st.filter((s) => s.k != null);
      const sgn = Math.sign(ks.reduce((a, s) => a + s.k, 0)) || 1;
      const inside = (s) => (sgn > 0 ? s.psiL : s.psiR), outside = (s) => (sgn > 0 ? s.psiR : s.psiL);
      const lowSide = (s) => ((s.psiL || [])[3] <= (s.psiR || [])[3] ? s.psiL : s.psiR), highSide = (s) => ((s.psiL || [])[3] <= (s.psiR || [])[3] ? s.psiR : s.psiL);
      const [pin, pout] = klass === 'straight' ? [lowSide, highSide] : [inside, outside];
      const col = (f, q) => med(st.map((s) => { const a = f(s); return a ? a[q] : NaN; }));
      const rateOf = (s) => { let m = 0; for (const [p, w] of [[s.psiL, s.wl], [s.psiR, s.wr]]) { if (!p || !(w >= 4)) continue; const q = w / 4; for (let i = 0; i < 4; i++) m = Math.max(m, ((p[i] - (i ? p[i - 1] : 0)) / q)); } return m; };
      const wIn = (s) => (klass === 'straight' ? (pin(s) === s.psiL ? s.wl : s.wr) : (sgn > 0 ? s.wl : s.wr));
      out.push({
        layout: name, klass, shape: m[1], family: FAMILY[m[1]],
        width: med(st.map((s) => s.width)),
        halfIn: med(st.map(wIn)), halfOut: med(st.map((s) => s.width - 1 - wIn(s))),
        psiIn: [0, 1, 2, 3].map((q) => col(pin, q)), psiOut: [0, 1, 2, 3].map((q) => col(pout, q)),
        rate: med(st.map(rateOf)),
      });
    }
    const g = new Map(); for (const s of S) { const k = cellOf(s.c); if (!g.has(k)) g.set(k, []); g.get(k).push(s.c); }
    taken.push(g);
  }
  return out;
}

/** Per-class ψ bands (p10/p50/p90), recomputed the way corpus.cjs computes them. */
function check(W) {
  const out = {};
  for (const k of [...new Set(W.map((w) => w.klass))]) {
    const C = W.filter((w) => w.klass === k), b = (xs) => { const v = xs.filter(Number.isFinite); return { p10: pct(v, 0.1), p50: pct(v, 0.5), p90: pct(v, 0.9), n: v.length }; };
    out[k] = { in: [0, 1, 2, 3].map((q) => b(C.map((w) => w.psiIn[q]))), out: [0, 1, 2, 3].map((q) => b(C.map((w) => w.psiOut[q]))) };
  }
  return out;
}

/** Per font family, over the road classes: ψ at ¼, ½, ¾, edge on each side, the width, and each side's half-width. */
function families(W) {
  const R = W.filter((w) => ROAD.includes(w.klass)), out = {};
  const pick = { bowl: (w) => w.family === 'bowl', 'half-pipe': (w) => w.family === 'half-pipe' && psi34(w) < PIPE_SPLIT,
    'half-pipe-deep': (w) => w.family === 'half-pipe' && psi34(w) >= PIPE_SPLIT, flat: (w) => w.family === 'flat' };
  for (const f of Object.keys(pick)) {
    const F = R.filter(pick[f]);
    out[f] = {
      n: F.length, share: +(F.length / R.length).toFixed(3),
      byClass: Object.fromEntries(ROAD.map((k) => [k, F.filter((w) => w.klass === k).length])),
      width_m: band(F.map((w) => w.width)),
      rate_deg_per_m: band(F.map((w) => w.rate)),
      psi_deg: { at: [0.25, 0.5, 0.75, 1], inside: [0, 1, 2, 3].map((q) => band(F.map((w) => w.psiIn[q]))), outside: [0, 1, 2, 3].map((q) => band(F.map((w) => w.psiOut[q]))) },
    };
  }
  return out;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/fontshape.cjs <reads dir>'); process.exit(1); }
  const W = words(dir);
  process.stdout.write(JSON.stringify({ schema: 't180b.fontshape/1', method: 'tools/fontshape.cjs: corpus.cjs words (one word = one sample, shared road once), road classes only, grouped by vocabgen FONT_OF_SHAPE; ψ from the centre normal at ¼, ½, ¾, edge; inside/outside of the turn (straight: low/high side); rate = the largest rise of ψ over a quarter of a side, °/m, station max then word median; percentiles by linear interpolation', families: families(W) }, null, 1) + '\n');
}
module.exports = { words, check, families, FAMILY, ROAD, PIPE_SPLIT };
