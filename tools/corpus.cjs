// corpus.cjs: the MEASURED CORPUS (D182). Per word class of the reader (read_track.cjs), the distribution of what the
// learning library's tracks actually build: length, radius, heading change, width, the cross-section's tilt profile ψ,
// bank and climb; for jumps, gap and drop. NUMBERS ONLY: no mesh, no texture, no word sequence of any track, and the
// only names are the ones docs/FINDINGS.md already uses (ARCHITECTURE §11.6).
//   node tools/corpus.cjs <reads dir> > src/doc/corpus.json
// <reads dir> holds READ_PROFILE=1 reads of the layouts listed in LAYOUTS below (FINDINGS §7f has the read commands).
//
// THE UNIT is one WORD of the reader's text (a run of stations with the same name; runs under 12 m are merged into a
// neighbour by the reader itself). Each word is one sample. Per word: its length; its median radius (1/|k|); its heading
// change |Σ k·ds|; its median width; its median ψ at ¼, ½, ¾ and the edge on the INSIDE and the OUTSIDE of its turn (for
// a straight, the lower and the higher side); its median bank (the centre's tilt from level, `up`); its median grade as
// an angle, and its climb in metres (the centre's height from its first station to its last). Per class, the 10th, 50th
// and 90th percentiles over the words, by linear interpolation between order statistics.
// THE CLASSES are the reader's: a word ending ^inv is an inversion, ^wall a wall-ride, JUMP a jump; the rest by the
// reader's turn class (straight R > 1500 m, sweep > 500, turn > 180, tight below). Shapes and slopes are shares.
// SHARED ROAD counts once: layouts are taken longest first, and a word of a later layout counts only if fewer than half
// its stations lie within 5 m of a station of a layout already taken (Onuris Medium is 79% Onuris Long's road).
'use strict';
const fs = require('fs'), path = require('path');

// the learning library (FINDINGS §7c: ohyeah2389's tracks, Dogeish's tracks and Chase's Onuris), longest layout first
// within a track. [read file, the name FINDINGS uses]
const LAYOUTS = [
  ['rainbow_rd', 'Rainbow Road'], ['centrifuge', 'Centrifuge'], ['hazenloop', 'Hazen Loop'],
  ['Chases_Onuris__layout_long', 'Onuris Long'], ['Chases_Onuris__layout_medium', 'Onuris Medium'], ['Chases_Onuris__layout_short', 'Onuris Short'],
  ['sakura_speedway', 'Sakura Speedway'], ['coast', 'Coast'], ['ohyeah2389_nordic', 'Nordic'], ['thunderhead_raceway__normal', 'Thunderhead'],
  ['eagleton__eagleton', 'Eagleton'], ['eagleton__eagleton_short', 'Eagleton (short)'], ['ohyeah2389_t180testtrack', 'T-180 Test Track'],
  ['bowltrack_2', 'The Bowltrack'], ['t180_bowltrack', 'T-180 Bowl Track'], ['serpents_spiral', 'Serpents Spiral'],
];
const STEP = 4, DEG = 180 / Math.PI;
const WORD = /^(flat|bowl\+?|pipe\+?)-(straight|sweep[LR]|turn[LR]|tight[LR])(\/up|\/down)?(\^wall|\^inv)?$/;

function pct(xs, q) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const h = (s.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
  return +(s[lo] + (s[hi] - s[lo]) * (h - lo)).toFixed(3);
}
const band = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? { p10: pct(v, 0.1), p50: pct(v, 0.5), p90: pct(v, 0.9), n: v.length } : null; };
const med = (xs) => pct(xs, 0.5);

function build(dir) {
  const taken = [];   // station positions of the layouts already counted, for the shared-road test
  const runs = [], trans = {}, corners = []; let prev = null;   // RUNS of same-class words and the class that FOLLOWS each run
  const cellOf = (c) => c.map((v) => Math.floor(v / 8)).join(',');
  const near = (c) => { for (const g of taken) { const k = c.map((v) => Math.floor(v / 8)); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const q of g.get([k[0] + x, k[1] + y, k[2] + z].join(',')) || []) if (Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 5) return true; } return false; };
  const classes = {}, used = [], shared = {};
  const cls = (name) => (classes[name] = classes[name] || { words: [], byTrack: {} });
  for (const [file, name] of LAYOUTS) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, `${file}.read.json`), 'utf8'));
    if (r.end !== 'closed') throw new Error(`${file}: the read did not close (${r.end}); it is not in the corpus`);
    const S = r.stations.filter((s) => s.c && !s.jump && !s.junction), byD = new Map(S.map((s) => [s.d, s]));
    let counted = 0, skipped = 0;
    const seq = [];   // this layout's counted words in order, for RUNS; a skipped (shared) word is a BREAK
    for (const w of r.text) {
      if (/^JUMP/.test(w.w)) {
        const j = r.stations.find((s) => s.jump && s.d === w.from);
        if (!j) continue;
        if (near(j.from)) { skipped++; seq.push(null); continue; }
        const c = cls('jump'); c.words.push({ gap: j.gap_m, drop: j.drop_m }); c.byTrack[name] = (c.byTrack[name] || 0) + 1; counted++;
        seq.push({ klass: 'jump', dir: '', length: j.gap_m, heading: 0, climbM: -j.drop_m });
        continue;
      }
      const m = WORD.exec(w.w);
      if (!m) throw new Error(`${file}: a word the corpus does not know: ${w.w}`);
      const st = []; for (let d = w.from; d <= w.to; d += 1) { const s = byD.get(d); if (s) st.push(s); }
      if (!st.length) continue;
      if (st.filter((s) => near(s.c)).length * 2 >= st.length) { skipped++; seq.push(null); continue; }
      const klass = m[4] === '^inv' ? 'inversion' : m[4] === '^wall' ? 'wall-ride' : m[2].replace(/[LR]$/, '');
      const ks = st.filter((s) => s.k != null);
      const sgn = Math.sign(ks.reduce((a, s) => a + s.k, 0)) || 1;   // the word's turn direction: + left
      const inside = (s) => (sgn > 0 ? s.psiL : s.psiR), outside = (s) => (sgn > 0 ? s.psiR : s.psiL);
      const lowSide = (s) => ((s.psiL || [])[3] <= (s.psiR || [])[3] ? s.psiL : s.psiR), highSide = (s) => ((s.psiL || [])[3] <= (s.psiR || [])[3] ? s.psiR : s.psiL);
      const [pin, pout] = klass === 'straight' ? [lowSide, highSide] : [inside, outside];
      const col = (f, q) => med(st.map((s) => { const a = f(s); return a ? a[q] : NaN; }));
      const heading = Math.abs(ks.reduce((a, s, i) => a + s.k * (i ? s.d - ks[i - 1].d : STEP), 0)) * DEG;
      const c = cls(klass);
      c.words.push({
        length: w.to - w.from + STEP, radius: ks.length ? med(ks.map((s) => 1 / Math.max(Math.abs(s.k), 1e-9))) : NaN, heading,
        width: med(st.map((s) => s.width)), bank: med(st.map((s) => s.up)),
        climbDeg: med(st.map((s) => (s.grade == null ? NaN : Math.atan(s.grade / 100) * DEG))), climbM: st[st.length - 1].c[1] - st[0].c[1],
        psiIn: [0, 1, 2, 3].map((q) => col(pin, q)), psiOut: [0, 1, 2, 3].map((q) => col(pout, q)),
        shape: m[1], slope: m[3] === '/up' ? 'up' : m[3] === '/down' ? 'down' : 'level',
      });
      c.byTrack[name] = (c.byTrack[name] || 0) + 1; counted++;
      const last = c.words[c.words.length - 1];
      seq.push({ klass, dir: /^(sweep|turn|tight)[LR]$/.test(m[2]) ? m[2].slice(-1) : '', length: last.length, heading: last.heading, climbM: last.climbM });
    }
    const g = new Map(); for (const s of S) { const k = cellOf(s.c); if (!g.has(k)) g.set(k, []); g.get(k).push(s.c); }
    taken.push(g);
    // RUNS: consecutive counted words of exactly the same class and the same turn direction (a wall-ride or inversion word
    // carries the reader's turn under it, e.g. bowl-turnL^wall, so it splits by direction too; a straight has none) (the
    // reader already merges runs under 12 m, so no further tolerance: a one-token interruption is a real short piece).
    // A skipped (shared) word breaks a run, and no transition is counted across it. The lap is not wrapped end to start.
    let run = null;
    const close = () => { if (run) { runs.push(run); } run = null; };
    for (const w of seq) {
      if (!w) { close(); prev = null; continue; }
      if (run && run.klass === w.klass && run.dir === w.dir) { run.length += w.length; run.heading += w.heading; run.climbM += w.climbM; run.words++; continue; }
      if (run) { trans[run.klass] = trans[run.klass] || {}; trans[run.klass][w.klass] = (trans[run.klass][w.klass] || 0) + 1; }
      close(); run = { klass: w.klass, dir: w.dir, length: w.length, heading: w.heading, climbM: w.climbM, words: 1 };
    }
    close();
    // CORNERS (a whole turn, what a user's "turn" piece spans): consecutive CURVED words (sweep, turn, tight) turning the
    // SAME way, whatever the class; a straight, a wall-ride, an inversion, a jump, a change of direction or a shared word
    // ends one. Keyed by the tightest class it reaches (sweep < turn < tight).
    const RANK = { sweep: 1, turn: 2, tight: 3 };
    let cn = null;
    const shut = () => { if (cn) corners.push(cn); cn = null; };
    for (const w of seq) {
      if (!w || !RANK[w.klass]) { shut(); continue; }
      if (cn && cn.dir === w.dir) { cn.length += w.length; cn.heading += w.heading; cn.climbM += w.climbM; cn.words++; if (RANK[w.klass] > RANK[cn.peak]) cn.peak = w.klass; continue; }
      shut(); cn = { dir: w.dir, peak: w.klass, length: w.length, heading: w.heading, climbM: w.climbM, words: 1 };
    }
    shut();
    used.push({ layout: name, readM: r.walked_m, words: counted });
    if (skipped) shared[name] = skipped;
  }
  const out = {};
  for (const [k, c] of Object.entries(classes)) {
    const W = c.words, share = (f) => { const t = {}; for (const w of W) t[f(w)] = (t[f(w)] || 0) + 1; for (const x in t) t[x] = +(t[x] / W.length).toFixed(3); return t; };
    out[k] = k === 'jump'
      ? { n: W.length, byTrack: c.byTrack, gap_m: band(W.map((w) => w.gap)), drop_m: band(W.map((w) => w.drop)) }
      : {
        n: W.length, byTrack: c.byTrack,
        length_m: band(W.map((w) => w.length)), radius_m: k === 'straight' ? null : band(W.map((w) => w.radius)), heading_deg: band(W.map((w) => w.heading)),
        width_m: band(W.map((w) => w.width)), bank_deg: band(W.map((w) => w.bank)), climb_deg: band(W.map((w) => w.climbDeg)), climb_m: band(W.map((w) => w.climbM)),
        psi_deg: { at: [0.25, 0.5, 0.75, 1], [k === 'straight' ? 'low' : 'inside']: [0, 1, 2, 3].map((q) => band(W.map((w) => w.psiIn[q]))), [k === 'straight' ? 'high' : 'outside']: [0, 1, 2, 3].map((q) => band(W.map((w) => w.psiOut[q]))) },
        shape: share((w) => w.shape), slope: share((w) => w.slope),
      };
  }
  return {
    schema: 't180b.corpus/1',
    what: 'Per reader word class: 10th/50th/90th percentiles over the words of the learning library (FINDINGS §7f). Numbers only.',
    method: 'tools/corpus.cjs: one word = one sample; percentiles by linear interpolation; ψ in degrees from the centre normal at ¼, ½, ¾ and the edge of each side; shared road counted once. RUNS: consecutive words of the same class and turn direction (wall-ride and inversion included), broken by a shared word, not wrapped; TRANSITIONS: the class of the run that follows each run; CORNERS: consecutive curved words turning the same way, keyed by the tightest class reached',
    layouts: used, sharedWordsSkipped: shared, classes: out,
    runs: Object.fromEntries(Object.keys(out).map((k) => { const R = runs.filter((r) => r.klass === k); return [k, { n: R.length, words: band(R.map((r) => r.words)), length_m: band(R.map((r) => r.length)), heading_deg: band(R.map((r) => r.heading)), climb_m: band(R.map((r) => r.climbM)) }]; })),
    corners: Object.fromEntries(['sweep', 'turn', 'tight'].map((k) => { const R = corners.filter((r) => r.peak === k); return [k, { n: R.length, words: band(R.map((r) => r.words)), length_m: band(R.map((r) => r.length)), heading_deg: band(R.map((r) => r.heading)), climb_m: band(R.map((r) => r.climbM)) }]; })),
    transitions: Object.fromEntries(Object.keys(trans).sort().map((k) => { const row = trans[k], tot = Object.values(row).reduce((a, v) => a + v, 0);
      return [k, { n: tot, counts: row, p: Object.fromEntries(Object.entries(row).map(([t, c]) => [t, +(c / tot).toFixed(4)])) }]; })),
  };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/corpus.cjs <reads dir> > src/doc/corpus.json'); process.exit(1); }
  process.stdout.write(JSON.stringify(build(dir), null, 1) + '\n');
}
module.exports = { build, pct, LAYOUTS };
