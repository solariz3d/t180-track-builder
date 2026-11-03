// finalscene_mutation.test.js: node --test test/finalscene_mutation.test.js   (each mutant runs export_finalscene.test.js once or more: about 10 minutes)
// The final-scene check (src/export/finalscene.js) and its wiring in the export (src/export/fromwords.js). Each mutation copies ONE of the two files to a
// temp folder with its relative requires made absolute (so the copy loads the real modules beside the original), applies ONE source patch, and runs the
// named row of test/export_finalscene.test.js against the copy (FINALSCENE_FILE or FROMWORDS_FILE). "Applied" means the patch text was found once and
// changed. "Caught" means the named row FAILED on the mutant, judged by its own line, run alone (acready_mutation.test.js's judge). The original src is
// never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('./inner_run.js');   // a crashed inner run reads NOT TESTED
const SRC = path.join(__dirname, '..', 'src');
const FILES = { finalscene: { file: path.join(SRC, 'export', 'finalscene.js'), env: 'FINALSCENE_FILE' }, fromwords: { file: path.join(SRC, 'export', 'fromwords.js'), env: 'FROMWORDS_FILE' } };

const MUTATIONS = [
  // a face standing across the road (the notch's cap)
  // AMENDED (the check's memory, 2026-11-02): the triangles are rows of typed arrays now, not objects, so the face's unit normal is the local `nu`, not `tri.n`; the fault is the same
  { id: 'F1 a drivable face never stands across the road', in: 'finalscene', from: 'Math.abs(dot(nu, q.T)) >= cosAcross', to: 'false', caughtBy: 'row 5: each defect made by hand' },
  { id: 'F2 a seam\'s zip fan is read as a face across the road', in: 'finalscene', from: 'DRIVABLE.has(f) && !zip && Math.abs', to: 'DRIVABLE.has(f) && Math.abs', caughtBy: 'row 6: under the bars' },
  // the lane's ends (the notch's cause)
  { id: 'F3 the lane may be 1 m wide at its ends', in: 'finalscene', from: 'const LANE_END_M = 0.1;', to: 'const LANE_END_M = 1;', caughtBy: 'row 5: each defect made by hand' },
  { id: 'F4 the lane is never read', in: 'finalscene', from: "if (lane && lane.joins && typeof lane.widthAt === 'function') for", to: 'if (false) for', caughtBy: 'row 5: each defect made by hand' },
  // open edges (the slot tips, the ring cracks)
  { id: 'F5 every boundary edge counts as covered', in: 'finalscene', from: 'if (atEnd(t.q) || pts.every((p) => covered(p, i))) return;', to: 'return;', caughtBy: 'row 5: each defect made by hand' },
  { id: 'F6 a crack in the road must be 5 cm to count', in: 'finalscene', from: 'const DRIVE_CRACK_M = 5e-3;', to: 'const DRIVE_CRACK_M = 0.05;', caughtBy: 'row 6: under the bars' },
  { id: 'F7 a crack of 1 mm in the road counts', in: 'finalscene', from: 'const DRIVE_CRACK_M = 5e-3;', to: 'const DRIVE_CRACK_M = 1e-3;', caughtBy: 'row 6: under the bars' },
  { id: 'F8 a hole in the skin refuses like one in the road', in: 'finalscene', from: 'refuse.push(...grouped(opens.filter((o) => o.drivable)', to: 'refuse.push(...grouped(opens.filter((o) => true)', caughtBy: 'row 5: each defect made by hand' },
  { id: 'F9 an open track\'s two ends are read as open edges', in: 'finalscene', from: '(open && (q.s < S[0].s + END_M', to: '(false && (q.s < S[0].s + END_M', caughtBy: 'row 4: tubes opened and closed' },
  // the fold (the jag)
  { id: 'F10 the skin never folds', in: 'finalscene', from: 'if (o.ang > ra + FOLD_SLACK_DEG) warn.push', to: 'if (false) warn.push', caughtBy: 'row 5: each defect made by hand' },
  { id: 'F11 a seam\'s zipper is read in the fold', in: 'finalscene', from: "(t.f !== 'road' && t.f !== 'skin') || t.zip || g.zip ||", to: "(t.f !== 'road' && t.f !== 'skin') ||", caughtBy: 'row 6: under the bars' },
  { id: 'F16 the lip and landing of a jump are read as open edges', in: 'finalscene', from: 'lips.some((x) => Math.abs(q.s - x) < END_M)', to: 'false', caughtBy: 'row 10: a closed lap with a free jump' },
  // the bottom (the step under the leave)
  { id: 'F12 the bottom never steps', in: 'finalscene', from: 'if (off > BOTTOM_STEP_M) steps.push', to: 'if (false) steps.push', caughtBy: 'row 5: each defect made by hand' },
  { id: 'F13 the bottom is compared only 1.5 m apart (stations 2 m apart never are)', in: 'finalscene', from: 'if (prev && ds <= 2.01) {', to: 'if (prev && ds <= 1.51) {', caughtBy: 'row 3: beside the pit lane' },
  { id: 'F15 the bottom\'s own slope is ignored (a hull deepening evenly reads as a step)', in: 'finalscene', from: 'const off = a * b > 0 ? Math.min(Math.abs(a), Math.abs(b)) : 0;', to: 'const off = Math.abs(x.rate);', caughtBy: 'row 6: under the bars' },
  // slivers (the zipper)
  { id: 'F14 no triangle is a sliver', in: 'finalscene', from: "if (thick < SLIVER) { thin.push(", to: "if (false) { thin.push(", caughtBy: 'row 5: each defect made by hand' },
  // the triangles' tables (rows of typed arrays, and the welded vertices and the edges in open-addressed tables, in place of objects and Maps)
  { id: 'F17 an edge two triangles share reads as open (its count never passes 1)', in: 'finalscene', from: 'if (out.count[g] < 3) out.count[g]++;', to: '', caughtBy: 'row 1: a clean lap with a pit lane' },
  { id: 'F18 the second triangle at an edge is not filed (the fold reads the first against nothing)', in: 'finalscene', from: 'if (out.count[g] === 1) out.second[g] = s;', to: '', caughtBy: 'row 5: each defect made by hand' },
  { id: 'F19 the weld table loses its vertices when it grows', in: 'finalscene', from: 'K2[3 * g + 2] = K[3 * h + 2]; V2[g] = V[h]; }', to: 'K2[3 * g + 2] = K[3 * h + 2]; }', caughtBy: "row 11: the triangles' tables keep every vertex" },
  { id: 'F20 the edge table loses its edges when it grows', in: 'finalscene', from: 'A2[g] = KA[h]; B2[g] = KB[h]; G2[g] = G[h]; }', to: 'A2[g] = KA[h]; B2[g] = KB[h]; }', caughtBy: "row 11: the triangles' tables keep every vertex" },
  // a drawn face through another pass's road or apron (the hull hung through a pass running under it: ELYSIUM's p38)
  { id: 'F21 a drawn face through another pass is never said', in: 'finalscene', from: 'if (phys) through.push(', to: 'if (false) through.push(', caughtBy: 'row 12: a drawn surface that passes through' },
  { id: "F22 a drawn face is another pass's by its centre's station alone", in: 'finalscene', from: 'if (!sv.every((x) => apart(x, g.q.s))) continue;', to: 'if (!apart(t.q.s, g.q.s)) continue;', caughtBy: 'row 15: a drawn face is another pass' },
  { id: 'F23 a drawn face must stand 2 m out to count', in: 'finalscene', from: 'const THROUGH_MIN_M = 0.01;', to: 'const THROUGH_MIN_M = 2;', caughtBy: 'row 13: ELYSIUM' },
  { id: 'F24 another pass is any surface over a metre along the road', in: 'finalscene', from: 'const PASS_M = 25;', to: 'const PASS_M = 1;', caughtBy: 'row 15: a drawn face is another pass' },
  { id: 'F25 a face that only grazes another pass is said', in: 'finalscene', from: 'const THROUGH_MIN_M = 0.01;', to: 'const THROUGH_MIN_M = 0;', caughtBy: 'row 12: a drawn surface that passes through' },
  { id: "F26 a drawn face stands out by its corners over the other face's whole plane", in: 'finalscene', from: 'const out = standOut(v, w, g.n);', to: 'const out = Math.max(...v.map((p) => dot(sub(p, w[0]), g.n)));', caughtBy: 'row 15: a drawn face is another pass' },
  // the export's warning by the builder's pass-clearance rule (src/validate/passclear.js), a stretch at a time
  { id: 'F27 the export never warns by the pass-clearance rule', in: 'fromwords', from: 'for (const c of clearance) warnings.push(', to: 'for (const c of []) warnings.push(', caughtBy: 'row 14: the export warns by the builder' },
  { id: 'F28 each station is its own stretch', in: 'fromwords', from: 'if (r && f.s - r.last.s <= DS_CLEAR_M', to: 'if (false && f.s - r.last.s <= DS_CLEAR_M', caughtBy: 'row 14: the export warns by the builder' },
  // the wiring in the export
  { id: 'W1 a drivable fault never refuses the export', in: 'fromwords', from: "if (!test) throw new ExportError('SCENE'", to: "if (false) throw new ExportError('SCENE'", caughtBy: 'row 7: the export gives the check' },
  { id: 'W2 a drawn fault is never passed on as a warning', in: 'fromwords', from: 'for (const w of sceneCheck.warn) warnings.push(', to: 'for (const w of []) warnings.push(', caughtBy: 'row 7: the export gives the check' },
  { id: 'W3 the check is not given the pit lane', in: 'fromwords', from: 'lane: pit ? pit.lane : null, open: !p.closed });', to: 'lane: null, open: !p.closed });', caughtBy: 'row 7: the export gives the check' },
  { id: 'W4 the export does not return what the check found', in: 'fromwords', from: 'pitLane: pit ? pit.lane : null, sceneCheck,', to: 'pitLane: pit ? pit.lane : null,', caughtBy: 'row 1: a clean lap with a pit lane' },
];

const TEST_FILE = path.join(__dirname, 'export_finalscene.test.js');
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function runOnce(which, file, pattern) {
  const tap = path.join(path.dirname(path.dirname(file)), '.inner-run.tap');
  const r = spawnSync(process.execPath, ['--test', ...IR.reporterArgs(tap), ...(pattern ? [`--test-name-pattern=${pattern}`] : []), TEST_FILE],
    { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), ...(file ? { [FILES[which].env]: file } : {}) }, encoding: 'utf8', timeout: 600000, maxBuffer: 1 << 26, windowsHide: true });
  if (r.error) throw r.error;
  return { out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), crashed: IR.crashesIn(tap) };
}
function verdictOf(out, name) {
  let v = null;
  for (const l of out.split('\n')) if (/^[✔✖] /.test(l) && l.slice(2).startsWith(name)) { if (l[0] === '✖') return 'fail'; v = 'pass'; }
  return v;
}
/** A copy of one source file in a temp folder, its relative requires pointed at the real modules. */
function copyOf(which) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-finalscene-mut-')), from = FILES[which].file, to = path.join(dir, 'export', path.basename(from));
  fs.mkdirSync(path.dirname(to));
  const src = fs.readFileSync(from, 'utf8').replace(/require\('(\.{1,2}\/[^']+)'\)/g, (m, rel) => `require(${JSON.stringify(path.resolve(path.dirname(from), rel))})`);
  fs.writeFileSync(to, src);
  return { dir, file: to };
}
function runMutant(m) {
  const { dir, file } = copyOf(m.in);
  try {
    const src = fs.readFileSync(file, 'utf8'), applied = src.split(m.from).length === 2;
    if (applied) fs.writeFileSync(file, src.replace(m.from, m.to));
    const attempts = [];
    for (let k = 0; k < 3; k++) {
      const { out, crashed } = runOnce(m.in, file, `^${escapeRe(m.caughtBy)}`), v = verdictOf(out, m.caughtBy);
      attempts.push({ verdict: v, crashed, tail: v ? '' : out.slice(-1500) });
      if (v) break;
    }
    const last = attempts[attempts.length - 1];
    if (last.verdict === null && last.crashed.length) throw new Error(IR.notTested(last.crashed));
    return { applied, caught: last.verdict === 'fail', verdict: last.verdict, attempts };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// THE CONTROL: unmutated copies of both files pass every row, so a catch means something
for (const which of Object.keys(FILES)) {
  test(`control: the unmutated copy of ${which}.js passes every row the mutants are judged by`, () => {
    const { dir, file } = copyOf(which);
    try {
      const { out, crashed } = runOnce(which, file, null);
      if (crashed.length) throw new Error(IR.notTested(crashed));
      const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l));
      assert.ok(/ℹ tests \d+/.test(out), 'the control printed no summary');
      assert.deepEqual(failed, [], `the unmutated copy fails: ${failed.join(' | ')}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" is not in src/export/${m.in}.js exactly once`);
    assert.notEqual(r.verdict, null, `NO VERDICT in ${r.attempts.length} runs: the named row never reported. Last output:\n${r.attempts[r.attempts.length - 1].tail}`);
    assert.ok(r.caught, `NOT CAUGHT: "${m.caughtBy}…" passed on the mutant (${r.attempts.length} run(s))`);
  });
}
module.exports = { MUTATIONS, runMutant };
