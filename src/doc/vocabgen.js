// vocabgen.js: the built-in words' defaults, GENERATED from the measured library (src/doc/corpus.json, schema
// t180b.corpus/1: tools/corpus.cjs over the track reader's words of every installed T-180 layout, FINDINGS §7f). The
// keeper, 2026-09-27 23:36, on the hand-set vocabulary: "the pieces are nowhere near what I want them to be, they arent
// good for t-180s". So nothing here is chosen: every default is a MEDIAN (p50), every tempo a percentile BAND, and every
// default font the cross-section the library uses most in that class.
//
// A PIECE'S SIZE is a whole CORNER for sweep, turn and tight (corpus.corners: consecutive curved words turning the same
// way, keyed by the tightest class reached; the chair's correction, D182, after the runs proved to be one word each):
// the TOTAL TURN is the median corner's, and a tempo picks the corner's p10, p50 or p90. The straight and the wall-ride
// are not part of a corner, so their size is their RUN's (corpus.runs). A piece's SHAPE comes from the WORDS
// (corpus.classes): its radius, width, bank and font shares are the per-word figures. So a curved piece's length
// follows from its turn and radius (document.js), and it is checked against the corner's length band
// (test/vocab-corpus.test.js). The font is placed in the class's measured SHARES, not always the most-used (vocab.js).
//
//   generate(corpus) -> { words, bands, grammar, source }      pure and deterministic: the same corpus, the same result
//
// THE CLASSES are the reader's own (tools/read_track.cjs word()), and they are the builder's word names: straight
// (radius above 1,500 m), sweep (500–1,500), turn (180–500), tight (below 180), wall-ride (the road's up more than 60°
// off vertical), inversion (more than 110°), jump. Each quantity is { p10, p50, p90 }; in classes one reader word is one
// sample, and a reader word is a FRAGMENT (a new one starts at every change of shape, slope or roll), which is why the
// size of a piece is taken from the runs instead.
//
// THE FONT. The reader names a cross-section flat, bowl, bowl+, pipe or pipe+ (+ = a wall past 70 m of edge); the corpus
// gives each class's shares. The builder has one font per family: bowl and bowl+ are the bowl, pipe and pipe+ the
// half-pipe, flat is flat. A class's default font is the family with the largest share; a tie goes to the earlier of
// FONT_ORDER, so the result never depends on key order.
//
// THE BANK. The reader's bank is the road's tilt at its centre, unsigned. The builder's is the word's roll at its end,
// leaning INTO the turn (document.js). A straight has no inside, so its bank is not a default (it keeps the head's).
//
// THE GRAMMAR. corpus.transitions, when present, counts how often each class is followed by each class over every read,
// as transitions[from] = { n, counts: { to: count }, p } (numbers, not sequences: no track's layout is kept,
// ARCHITECTURE §11.6); the counts are the master, and the shares are recomputed from them. grammar[from] lists the classes seen after
// `from`, most seen first, with counts and shares. It is only ever a SUGGESTION (src/doc/grammar.js). A corpus without
// transitions gives grammar null, and the palette suggests nothing rather than guessing.
'use strict';

const DEG = Math.PI / 180;
const BANDS = ['p10', 'p50', 'p90'];
const CURVED = ['sweep', 'turn', 'tight', 'wall-ride'], CORNER_CLASSES = ['sweep', 'turn', 'tight'];
const FONT_OF_SHAPE = { flat: 'flat', bowl: 'bowl', 'bowl+': 'bowl', pipe: 'half-pipe', 'pipe+': 'half-pipe' };
const FONT_ORDER = ['bowl', 'half-pipe', 'flat'];
const CLASSES = ['straight', 'sweep', 'turn', 'tight', 'wall-ride', 'inversion', 'jump'];

class CorpusError extends Error {
  constructor(message) { super(`corpus: ${message}`); this.name = 'CorpusError'; this.code = 'BAD_CORPUS'; }
}

/** One quantity's bands, checked: every band a finite number, and p10 <= p50 <= p90. `from` is the section: classes (the
 *  reader's words) or runs (consecutive words of one class, joined). */
function bandsOf(corpus, cls, key, from = 'classes') {
  const c = corpus[from] && corpus[from][cls];
  if (!c) throw new CorpusError(`no ${from} class "${cls}"`);
  const s = c[key];
  if (!s || typeof s !== 'object') throw new CorpusError(`${from === 'classes' ? '' : from + '.'}${cls}.${key} is missing`);
  const out = {};
  for (const b of BANDS) {
    if (!Number.isFinite(s[b])) throw new CorpusError(`${cls}.${key}.${b} is not a number (${JSON.stringify(s[b])})`);
    out[b] = s[b];
  }
  for (let i = 1; i < BANDS.length; i++) if (out[BANDS[i]] < out[BANDS[i - 1]]) throw new CorpusError(`${cls}.${key}: ${BANDS[i - 1]} ${out[BANDS[i - 1]]} > ${BANDS[i]} ${out[BANDS[i]]}`);
  return out;
}

/** The class's font families' shares (normalised, in FONT_ORDER) by the reader's shape shares, and the most-used one. */
function fontsOf(corpus, cls) {
  const shapes = corpus.classes[cls].shape;
  if (!shapes || typeof shapes !== 'object') throw new CorpusError(`${cls}.shape is missing`);
  const byFont = Object.fromEntries(FONT_ORDER.map((f) => [f, 0]));
  for (const [shape, n] of Object.entries(shapes)) {
    if (!Object.prototype.hasOwnProperty.call(FONT_OF_SHAPE, shape)) throw new CorpusError(`${cls}.shape: "${shape}" is not a reader shape (${Object.keys(FONT_OF_SHAPE).join(', ')})`);
    if (!(Number.isFinite(n) && n >= 0)) throw new CorpusError(`${cls}.shape.${shape} is not a share`);
    byFont[FONT_OF_SHAPE[shape]] += n;
  }
  let best = null;
  for (const f of FONT_ORDER) if (best === null || byFont[f] > byFont[best]) best = f;
  if (!(byFont[best] > 0)) throw new CorpusError(`${cls}.shape counts nothing`);
  const total = FONT_ORDER.reduce((a, f) => a + byFont[f], 0);
  return { font: best, shares: Object.fromEntries(FONT_ORDER.map((f) => [f, byFont[f] / total])) };
}

/** The grammar: for each class, the classes seen next, most seen first (ties by CLASSES order); null without transitions. */
function grammarOf(corpus) {
  const t = corpus.transitions;
  if (t === undefined) return null;
  if (!t || typeof t !== 'object') throw new CorpusError('transitions is not an object');
  const out = {};
  for (const from of CLASSES) {
    if (t[from] !== undefined && (!t[from] || typeof t[from].counts !== 'object' || !t[from].counts)) throw new CorpusError(`transitions.${from} has no counts`);
    const row = t[from] ? t[from].counts : {};
    for (const [to, n] of Object.entries(row)) {
      if (!CLASSES.includes(to)) throw new CorpusError(`transitions.${from}: "${to}" is not a class (${CLASSES.join(', ')})`);
      if (!(Number.isInteger(n) && n >= 0)) throw new CorpusError(`transitions.${from}.counts.${to} is not a count`);
    }
    const total = Object.values(row).reduce((a, n) => a + n, 0);
    out[from] = CLASSES.filter((to) => row[to] > 0)
      .map((to) => ({ to, n: row[to], share: row[to] / total }))
      .sort((a, b) => b.n - a.n || CLASSES.indexOf(a.to) - CLASSES.indexOf(b.to));
  }
  return out;
}

/**
 * The vocabulary's numbers from the corpus. words[w] is the MEDIAN piece (SI: m, rad); bands[w][band] the piece's SIZE at
 * each percentile band, which a tempo picks: a curved word's total turn and the straight's length (runs), and the jump's
 * gap (vocab.js chooses its default gap from them).
 */
function generate(corpus) {
  if (!corpus || typeof corpus !== 'object' || !corpus.classes) throw new CorpusError('not a corpus (no classes)');
  const words = {}, bands = {};
  const road = (cls) => { const F = fontsOf(corpus, cls); return { width: bandsOf(corpus, cls, 'width_m').p50, font: F.font, fontShares: F.shares }; };

  const sl = bandsOf(corpus, 'straight', 'length_m', 'runs');
  words.straight = { length: sl.p50, turn: 0, ...road('straight') };
  bands.straight = Object.fromEntries(BANDS.map((b) => [b, { length: sl[b] }]));
  for (const w of CURVED) {
    // a CORNER's size for the three corner classes (E's corners: consecutive same-way sweep/turn/tight words, by the
    // tightest class reached); the wall-ride is not part of a corner, so its size is its run's
    const turn = bandsOf(corpus, w, 'heading_deg', CORNER_CLASSES.includes(w) ? 'corners' : 'runs');
    words[w] = { R: bandsOf(corpus, w, 'radius_m').p50, turn: turn.p50 * DEG, bank: bandsOf(corpus, w, 'bank_deg').p50 * DEG, ...road(w) };
    bands[w] = Object.fromEntries(BANDS.map((b) => [b, { turn: turn[b] * DEG }]));
  }
  words.inversion = { ...road('inversion') };   // its length and full roll stay the builder's (vocab.js says why)
  const gap = bandsOf(corpus, 'jump', 'gap_m');
  words.jump = { gap: gap.p50, drop: bandsOf(corpus, 'jump', 'drop_m').p50 };
  bands.jump = Object.fromEntries(BANDS.map((b) => [b, { gap: gap[b] }]));   // vocab.js takes its default from these, and says why

  return { words, bands, grammar: grammarOf(corpus), source: typeof corpus.what === 'string' ? corpus.what : null };
}

module.exports = { generate, CorpusError, BANDS, FONT_OF_SHAPE, FONT_ORDER, CLASSES, CORNER_CLASSES };
