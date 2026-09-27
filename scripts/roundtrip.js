// roundtrip.js: ARCHITECTURE §10.3's round-trip, first half. Read the exported platform test back with
// tools/read_track.cjs (which reads meshes only) and compare what it returns with the words scripts/platform_test.js
// was built from. Every tolerance below was stated BEFORE the first run, in the lighthouse hand-back
// p-d166-roundtrip-C_2026-09-27.md §1, and is not tuned to the result.
//
//   node scripts/roundtrip.js                      build the scene, write a kn5 to a temp folder, read it, compare
//   node scripts/roundtrip.js <track folder>       read an exported folder instead (e.g. out/t180b_platform_test)
//   node scripts/roundtrip.js --json               the rows as JSON
//
// It never writes anywhere but a fresh folder under the OS temp directory (removed afterwards), and never into the AC
// install.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PT = require('./platform_test.js');
const { readKn5 } = require('../tools/kn5.cjs');

const DEG = Math.PI / 180;
// THE WRITTEN SIDE is the canonical words, snapshotted when this module loads: a perturbed build (a test's mutation)
// is compared against what the platform test is SUPPOSED to be, never against its own perturbed fonts.
const WRITTEN_FONTS = JSON.parse(JSON.stringify(PT.CONST.FONTS));
const TOL = {                       // hand-back §1, verbatim in numbers
  width: [24, 28],
  edge: (psi) => [Math.max(0, psi - psi / 8 - 2), psi + 2],
  kStraight: 0.002,
  turnDeg: [165, 195],
  kPeak: [0.90, 1.30],
  gradeFlat: 0.5,
  gradeAmax: [2.0, 7.5], gradeAmin: [-4.0, -0.5],
  lap: [490, 510], lapReturn: 5,
  interior: 45, wordMin: 20, marker: 0.05,
  // AMENDMENT A1, written AFTER the first run (hand-back §1b): the stated 45 m interior rule leaves no station on the
  // 90 m turns, so tilt run and width were never evaluated there. Tilt and width are read per cross-section (no
  // smoothing along the road), so only the 10 m font blend and one 4 m reader step apply: 14 m. Used ONLY for the turn
  // rows the stated rule could not evaluate, and labelled as post-run wherever it is used.
  interiorLocal: 14,
};

/** Write the scene as a minimal readable track folder: the kn5 and data/surfaces.ini. */
function exportTo(scene, dir) {
  const { writeKn5 } = require('../src/export/kn5write.js'), { surfacesIni } = require('../src/export/trackfiles.js');
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'roundtrip.kn5'), Buffer.from(writeKn5(scene)));
  fs.writeFileSync(path.join(dir, 'data', 'surfaces.ini'), surfacesIni({ softCollision: true }));
}
/** Run the reader as a child process, exactly as a user would: node tools/read_track.cjs <dir> 500. */
function runReader(dir, lengthHint = 500) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'read_track.cjs'), dir, String(lengthHint)], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000 });
  if (r.status !== 0) throw new Error(`read_track.cjs failed (${r.status}): ${r.stderr}`);
  return { read: JSON.parse(r.stdout), log: r.stderr.trim() };
}

/** The written-to-read world map, found from the markers (identity, X-mirror or Z-mirror), never assumed. */
function markerMap(scene, dir) {
  const kn5 = fs.readdirSync(dir).filter((f) => /\.kn5$/i.test(f)).map((f) => readKn5(path.join(dir, f)));
  const readM = Object.fromEntries(kn5.flatMap((k) => k.dummies).map((d) => [d.name, d.pos]));
  const wroteM = Object.fromEntries(scene.root.children.filter((c) => c.type === 'dummy' && /^AC_/.test(c.name)).map((d) => [d.name, d.matrix.slice(12, 15)]));
  const maps = { identity: (p) => p, mirrorX: (p) => [-p[0], p[1], p[2]], mirrorZ: (p) => [p[0], p[1], -p[2]] };
  for (const [name, f] of Object.entries(maps)) {
    const errs = Object.keys(wroteM).map((k) => (readM[k] ? Math.hypot(...f(wroteM[k]).map((v, i) => v - readM[k][i])) : Infinity));
    if (Math.max(...errs) <= TOL.marker) return { name, f, worst: Math.max(...errs), n: errs.length };
  }
  throw new Error('no marker map (identity / mirrorX / mirrorZ) puts every marker within ' + TOL.marker + ' m');
}

/** Compare. Returns { rows: [{ quantity, written, read, delta, tolerance, ok, note }], ... }. */
function compare(dsn, scene, read, map) {
  const st = dsn.stations, words = dsn.words, L = dsn.length;
  const starts = []; st.forEach((s, i) => { if (i === 0 || s.word !== st[i - 1].word) starts.push(s.s); });
  const wordEnd = (w) => (w + 1 < starts.length ? starts[w + 1] : L);
  // each read row with a centre → the written station nearest its centre (the map's inverse is itself for all three).
  // FIRST LAP ONLY: the reader does not stop at 500 m (it runs on to 575 m, prediction 2), so rows past the point where
  // the walk returns to its start would count turn 1 twice.
  const all = read.stations.filter((r) => r.c), c00 = all[0].c;
  const ret = all.find((r) => r.d > 400 && Math.hypot(r.c[0] - c00[0], r.c[1] - c00[1], r.c[2] - c00[2]) <= TOL.lapReturn);
  const rows = ret ? all.filter((r) => r.d < ret.d) : all;
  const tagged = rows.map((r) => {
    const c = map.f(r.c); let bi = 0, bd = Infinity;
    for (let i = 0; i < st.length; i++) { const p = st[i].pos, d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = i; } }
    const w = st[bi].word, s = st[bi].s, edge = Math.min(s - starts[w], wordEnd(w) - s);
    return { r, w, s, edge, off: Math.sqrt(bd) };
  });
  const out = [];
  const row = (quantity, written, readv, delta, tolerance, ok, note = '') => out.push({ quantity, written, read: readv, delta, tolerance, ok, note });
  const fmt = (x, d = 2) => (typeof x === 'number' ? x.toFixed(d) : String(x));
  const interior = (w) => tagged.filter((t) => t.w === w && t.edge >= TOL.interior);

  words.forEach((wd, w) => {
    const I = interior(w), font = WRITTEN_FONTS[wd.font], name = wd.name;
    // width
    if (I.length) {
      const ws = I.map((t) => t.r.width), lo = Math.min(...ws), hi = Math.max(...ws);
      row(`width · ${name}`, '26 m arc', `${lo}–${hi} (n ${I.length})`, `${lo - 26}…${hi - 26}`, `[${TOL.width.join(', ')}]`, lo >= TOL.width[0] && hi <= TOL.width[1]);
    } else {
      row(`width · ${name}`, '26 m arc', 'no interior station', '', `[${TOL.width.join(', ')}]`, null, 'stated rule: the word is shorter than 2×45 m, no station qualifies');
      const J = tagged.filter((t) => t.w === w && t.edge >= TOL.interiorLocal);
      if (J.length) {
        const ws = J.map((t) => t.r.width), lo = Math.min(...ws), hi = Math.max(...ws);
        row(`width · ${name} [A1, post-run]`, '26 m arc', `${lo}–${hi} (n ${J.length})`, `${lo - 26}…${hi - 26}`, `[${TOL.width.join(', ')}]`, lo >= TOL.width[0] && hi <= TOL.width[1], 'amendment A1: interior ≥ 14 m');
        const [wmin, wmax] = font.slice().sort((a, b) => a - b), bmin = TOL.edge(wmin), bmax = TOL.edge(wmax);
        const mins = J.map((t) => Math.min(t.r.edgeL, t.r.edgeR)), maxs = J.map((t) => Math.max(t.r.edgeL, t.r.edgeR));
        const ok = mins.every((v) => v >= bmin[0] && v <= bmin[1]) && maxs.every((v) => v >= bmax[0] && v <= bmax[1]);
        row(`tilt run · ${name} [A1, post-run]`, `${wmin}° / ${wmax}°`, `${fmt(Math.min(...mins), 1)}–${fmt(Math.max(...mins), 1)} / ${fmt(Math.min(...maxs), 1)}–${fmt(Math.max(...maxs), 1)}`, '', `[${bmin.map((v) => fmt(v))}] / [${bmax.map((v) => fmt(v))}]`, ok, 'amendment A1: interior ≥ 14 m');
      }
    }
    // tilt run, as an unordered pair
    if (I.length) {
      const [wmin, wmax] = font.slice().sort((a, b) => a - b), bmin = TOL.edge(wmin), bmax = TOL.edge(wmax);
      const mins = I.map((t) => Math.min(t.r.edgeL, t.r.edgeR)), maxs = I.map((t) => Math.max(t.r.edgeL, t.r.edgeR));
      const ok = mins.every((v) => v >= bmin[0] && v <= bmin[1]) && maxs.every((v) => v >= bmax[0] && v <= bmax[1]);
      row(`tilt run · ${name}`, `${wmin}° / ${wmax}°`, `${fmt(Math.min(...mins), 1)}–${fmt(Math.max(...mins), 1)} / ${fmt(Math.min(...maxs), 1)}–${fmt(Math.max(...maxs), 1)}`, '', `[${bmin.map((v) => fmt(v))}] / [${bmax.map((v) => fmt(v))}]`, ok);
    }
    if (wd.kind === 'straight' || wd.kind === 'program') {
      const ks = I.filter((t) => t.r.k != null).map((t) => Math.abs(t.r.k));
      if (ks.length) { const m = Math.max(...ks); row(`curvature · ${name}`, '0', `max |k| ${m.toFixed(5)}`, m.toFixed(5), `< ${TOL.kStraight}`, m < TOL.kStraight); }
    }
    if (wd.kind === 'arc') {
      const kap = 1 / wd.R, span = tagged.filter((t) => (t.w === w) || (t.w !== w && Math.min(Math.abs(t.s - starts[w]), Math.abs(t.s - wordEnd(w))) <= 25));
      let integ = 0; for (let i = 0; i < rows.length - 1; i++) { const t = tagged[i]; if (!span.includes(t) || t.r.k == null) continue; integ += t.r.k * (rows[i + 1].d - rows[i].d); }
      const deg = Math.abs(integ) / DEG;
      row(`turn angle · ${name}`, '180°', `${deg.toFixed(1)}°`, (deg - 180).toFixed(1), `[${TOL.turnDeg.join(', ')}]`, deg >= TOL.turnDeg[0] && deg <= TOL.turnDeg[1]);
      const ks = tagged.filter((t) => t.w === w && t.r.k != null).map((t) => t.r.k), peak = Math.max(...ks.map(Math.abs)), ratio = peak / kap;
      row(`peak curvature · ${name}`, kap.toFixed(5), peak.toFixed(5), `×${ratio.toFixed(3)}`, `×[${TOL.kPeak.join(', ')}]`, ratio >= TOL.kPeak[0] && ratio <= TOL.kPeak[1]);
    }
    // grade
    if (wd.kind === 'program') {
      const g = tagged.filter((t) => t.w === w && t.r.grade != null).map((t) => t.r.grade), gmax = Math.max(...g), gmin = Math.min(...g);
      row(`grade max · ${name}`, '7.0 % (kicker)', `${gmax} %`, (gmax - 7).toFixed(1), `[${TOL.gradeAmax.join(', ')}]`, gmax >= TOL.gradeAmax[0] && gmax <= TOL.gradeAmax[1]);
      row(`grade min · ${name}`, '−3.5 % (landing)', `${gmin} %`, (gmin + 3.5).toFixed(1), `[${TOL.gradeAmin.join(', ')}]`, gmin >= TOL.gradeAmin[0] && gmin <= TOL.gradeAmin[1]);
    } else if (I.length) {
      const g = I.filter((t) => t.r.grade != null).map((t) => Math.abs(t.r.grade)), m = g.length ? Math.max(...g) : 0;
      row(`grade · ${name}`, '0 %', `max |grade| ${m} %`, m.toFixed(1), `≤ ${TOL.gradeFlat}`, m <= TOL.gradeFlat);
    }
  });
  // turn direction: the same letter on both turns
  const letters = words.map((wd, w) => (wd.kind === 'arc' ? Math.sign(tagged.filter((t) => t.w === w && t.r.k != null).reduce((a, t) => a + t.r.k, 0)) : null)).filter((x) => x !== null);
  row('turn direction', 'both left', letters.map((s) => (s > 0 ? 'L' : 'R')).join(' / '), '', 'same letter on both', letters.every((s) => s === letters[0]), 'which letter depends on the writer\'s handedness; reported, not scored');
  // lap length: where the walk returns within 5 m of its first station, after 400 m
  const back = ret;
  const lapD = back ? back.d : NaN;
  row('lap length', `${L.toFixed(3)} m`, back ? `${lapD} m (walk returns ≤ ${TOL.lapReturn} m from its start)` : 'never returns', back ? (lapD - L).toFixed(1) : '', `[${TOL.lap.join(', ')}]`, back ? lapD >= TOL.lap[0] && lapD <= TOL.lap[1] : false, `reader end: "${read.end}" at ${read.walked_m} m`);
  // word sequence: words ≥ 20 m, as (shape class, turn class), consecutive duplicates merged, compared cyclically
  const cls = (w) => { const m = w.match(/^(\w+\+?)-(straight|sweep|turn|tight)/); return m ? { shape: m[1], turn: m[2] } : { shape: w, turn: '' }; };
  const kept = read.text.filter((t) => (!ret || t.from < ret.d) && (t.to - t.from) + 4 >= TOL.wordMin).map((t) => cls(t.w));
  const seq = []; for (const k of kept) { const key = `${k.shape}·${k.turn}`; if (seq[seq.length - 1] !== key) seq.push(key); }
  while (seq.length > 1 && seq[0] === seq[seq.length - 1]) seq.pop();
  const expect = ['flat·straight', 'pipe·tight', 'flat·straight', 'WALL·tight'];
  const matchAt = (off) => seq.length === expect.length && expect.every((e, i) => { const got = seq[(i + off) % seq.length]; return e === 'WALL·tight' ? /^(pipe\+|bowl\+)·tight$/.test(got) : got === e; });
  const seqOk = expect.some((_, off) => matchAt(off));
  row('word sequence', 'flat·straight → pipe·tight → flat·straight → (pipe+|bowl+)·tight', seq.join(' → '), '', 'cyclic order, words ≥ 20 m', seqOk);
  const jumps = read.stations.filter((r) => r.jump);
  row('prediction 1: no JUMP word (12 m gap read as a seam)', 'JUMP(12 m, 0.70 m drop)', jumps.length ? jumps.map((j) => `JUMP ${j.gap_m} m`).join(', ') : 'no JUMP word', '', 'registered: none', jumps.length === 0, 'a reader limit, predicted before the run');
  row('prediction 2: the reader does not report "closed" under 800 m', '500 m lap', `end "${read.end}"`, '', 'registered: "limit"', read.end === 'limit', 'a reader limit, predicted before the run');
  return { rows: out, tagged, map: map.name, markerWorst: map.worst };
}

function roundtrip(opts = {}) {
  const { scene, dsn } = opts.track || PT.buildTrack();
  let dir = opts.dir, tmp = null;
  if (!dir) { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-roundtrip-')); dir = path.join(tmp, 't180b_roundtrip'); exportTo(scene, dir); }
  try {
    const map = markerMap(scene, dir), { read, log } = runReader(dir);
    return { ...compare(dsn, scene, read, map), log, read };
  } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { roundtrip, compare, exportTo, runReader, markerMap, TOL };

if (require.main === module) {
  const args = process.argv.slice(2), json = args.includes('--json'), dir = args.find((a) => !a.startsWith('--'));
  const res = roundtrip({ dir: dir && path.resolve(dir) });
  if (json) { console.log(JSON.stringify({ map: res.map, rows: res.rows }, null, 1)); process.exit(0); }
  console.log(`round-trip: ${res.log}`);
  console.log(`markers map by ${res.map} (worst ${res.markerWorst.toExponential(2)} m)`);
  for (const r of res.rows) console.log(`${r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : ' -- '}  ${r.quantity}\n        written ${r.written} | read ${r.read}${r.delta !== '' ? ' | delta ' + r.delta : ''} | tolerance ${r.tolerance}${r.note ? ' | ' + r.note : ''}`);
  const f = res.rows.filter((r) => r.ok === false).length, p = res.rows.filter((r) => r.ok === true).length;
  console.log(`${p} within tolerance, ${f} outside`);
}
