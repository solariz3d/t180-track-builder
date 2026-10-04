// widths.cjs: the WIDTH REFERENCE (D232): how wide the known T-180 tracks are, for the "width like…" drop-down in Extend. NUMBERS ONLY: a track's name
// (the names docs/FINDINGS.md already uses, ARCHITECTURE §11.6) and three numbers, never a station, a read or a shape.
//   node tools/widths.cjs <reads dir> > src/doc/widths.json
// <reads dir> holds the READ_PROFILE reads (tools/read_track.cjs, FINDINGS §7f has the commands) of the layouts listed below; reads/ is not in the repo.
// This is the corpus.json pattern (tools/corpus.cjs, D182): the JSON is committed, and test/widths.test.js rebuilds it from the reads when they are all here.
//
// THE NUMBER: over each read's stations, every `width` that is a finite number (the reader's width: ray hits left to right across the road, whole
// metres, 1 m steps; FINDINGS §7f lists the reader's known biases), the median and the 10th and 90th percentiles (linear between order statistics, the
// corpus's own `pct`). Jump stations carry no width and are not counted. On a track whose width swings (Rainbow Road, Nordic) the band is wide: say so
// in the label, never hide it behind the median.
// WHAT IS NOT HERE: a read that did not close is still a width read (Miandros: the walk stopped at its limit, FINDINGS §7f), and is listed with
// `read_closes: false` (so is Aurora Long: the walk stopped at its limit). Aurora Cryopticon is outside the learning library (FINDINGS §7c), so it is here for its
// width only: tools/corpus.cjs does not take it.
'use strict';
const fs = require('fs'), path = require('path');

// [read file (without .read.json), the name FINDINGS uses], the corpus's learning library (tools/corpus.cjs LAYOUTS) plus Miandros
const LAYOUTS = [
  ['rainbow_rd', 'Rainbow Road'], ['centrifuge', 'Centrifuge'], ['hazenloop', 'Hazen Loop'],
  ['Chases_Onuris__layout_long', 'Onuris Long'], ['Chases_Onuris__layout_medium', 'Onuris Medium'], ['Chases_Onuris__layout_short', 'Onuris Short'],
  ['sakura_speedway', 'Sakura Speedway'], ['coast', 'Coast'], ['ohyeah2389_nordic', 'Nordic'], ['thunderhead_raceway__normal', 'Thunderhead'],
  ['eagleton__eagleton', 'Eagleton'], ['eagleton__eagleton_short', 'Eagleton (short)'], ['ohyeah2389_t180testtrack', 'T-180 Test Track'],
  ['bowltrack_2', 'The Bowltrack'], ['t180_bowltrack', 'T-180 Bowl Track'], ['serpents_spiral', 'Serpents Spiral'], ['Miandros', 'Miandros'],
  ['cash_auroracryopticon__aurora_medium', 'Aurora Medium'], ['cash_auroracryopticon__aurora_long', 'Aurora Long'],   // Cash's Aurora Cryopticon, read 2026-10-04 (outside the learning library, FINDINGS §7c)
];

function pct(xs, q) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const h = (s.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
  return +(s[lo] + (s[hi] - s[lo]) * (h - lo)).toFixed(2);
}

/** The reads this script needs that are missing from `dir` (names of files). */
function missing(dir) { return LAYOUTS.map(([f]) => `${f}.read.json`).filter((f) => !fs.existsSync(path.join(dir, f))); }

function build(dir) {
  const tracks = LAYOUTS.map(([file, name]) => {
    const r = JSON.parse(fs.readFileSync(path.join(dir, `${file}.read.json`), 'utf8'));
    const w = r.stations.map((s) => s.width).filter(Number.isFinite);
    if (!w.length) throw new Error(`${file}: no station carries a width`);
    return { name, median_m: pct(w, 0.5), p10_m: pct(w, 0.1), p90_m: pct(w, 0.9), stations: w.length, read_closes: r.end === 'closed' };
  });
  tracks.sort((a, b) => a.median_m - b.median_m || a.name.localeCompare(b.name));
  return {
    schema: 't180b.widths/1',
    method: 'tools/widths.cjs: over each read\'s stations, the median and the 10th to 90th percentile of the reader\'s width (metres, whole metres, ray hits left to right). Numbers only.',
    tracks,
  };
}

module.exports = { LAYOUTS, build, missing, pct };
if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/widths.cjs <reads dir> > src/doc/widths.json'); process.exit(2); }
  const gone = missing(dir);
  if (gone.length) { console.error(`widths.cjs: these reads are not in ${dir}: ${gone.join(', ')}`); process.exit(1); }
  process.stdout.write(JSON.stringify(build(dir), null, 1) + '\n');
}
