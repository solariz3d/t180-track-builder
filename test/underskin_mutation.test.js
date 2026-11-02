// underskin_mutation.test.js: node --test test/underskin_mutation.test.js   (under the heavy-run lock: each mutant runs a row on a copy of the tree)
// D604: src/export/underskin.js's mutation harness, in the frame of apron_mutation.test.js. The skin is the solid slab's underside since D604, so its faults are the
// slab's. Each mutation copies src/, app/ (without sounds/ and test/), tools/ and the two test files that read the skin (test/underskin.test.js and
// test/export_apron.test.js) to a temp folder, applies ONE source patch to the copy's src/export/underskin.js, and runs the named row of the named file against the
// mutant. "Applied" means the patch text was found and changed; "caught" means the named row FAILED, judged by its own line, run alone. The CONTROL runs both files
// whole on an unmutated copy, so a copy missing a file cannot make every mutant look caught. The original tree is never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const ROOT = path.join(__dirname, '..');
const FILES = ['underskin.test.js', 'export_apron.test.js', 'tube_cases.test.js'];

const MUTATIONS = [
  // AMENDED (D604 hull, the user's red line 10:44): the skin is the hull's bottom, 1.5 m under the road; U1 is the redo's plank-drop skin again (0.93 m), its fault the same (not the hull)
  { id: 'U1 the skin at the plank\'s drop again (0.93 m: a slab, not the hull)', from: 'const UNDERSKIN_OFFSET_M = 1.5;', to: 'const UNDERSKIN_OFFSET_M = 2.0 * Math.tan((25 * Math.PI) / 180);', file: 'export_apron.test.js', caughtBy: 'row 23:' },
  // AMENDED (D604 redo): U2's and U4's line hangs the vertex along skinDir's direction now (its row's section up), not its own normal; the faults are the same
  // AMENDED (D604 hull, the user's red line 10:44): the line hangs each vertex at its own depth (rowDepths) now; the fault is the same
  { id: 'U2 the skin\'s normals not reversed (it faces the road, not away from it)', from: 'positions[d * 3 + a] = P[s + a] - rowDep[r][k] * dir[a]; normals[d * 3 + a] = -dir[a];', to: 'positions[d * 3 + a] = P[s + a] - rowDep[r][k] * dir[a]; normals[d * 3 + a] = dir[a];', file: 'underskin.test.js', caughtBy: 'row 1:' },   // RE-ANCHORED BY NAME (2026-11-02): skinOf hangs a vertex in its hang()
  { id: 'U3 a seam\'s skin keeps the road\'s winding (it faces into the slab)', from: 'indices[t] = m.indices[t]; indices[t + 1] = m.indices[t + 2]; indices[t + 2] = m.indices[t + 1];', to: 'indices[t] = m.indices[t]; indices[t + 1] = m.indices[t + 1]; indices[t + 2] = m.indices[t + 2];', file: 'underskin.test.js', caughtBy: 'row 8:' },
  { id: 'U4 the skin offset toward the driver (above the road, not under it)', from: 'positions[d * 3 + a] = P[s + a] - rowDep[r][k] * dir[a];', to: 'positions[d * 3 + a] = P[s + a] + rowDep[r][k] * dir[a];', file: 'underskin.test.js', caughtBy: 'row 2:' },   // RE-ANCHORED BY NAME (2026-11-02): as U2
  // D604 redo: the skin hung along each vertex's OWN normal again (the second, inverted apron under a curved edge)
  { id: 'U10 the skin hung along its own normal, not its section\'s up (the run under a plank folds back up to it)', from: 'if (a <= SECTION_UP_DEG) return c;', to: 'if (a <= SECTION_UP_DEG) return v;', file: 'export_apron.test.js', caughtBy: 'row 25:' },
  // D604 hull: the edge never deepened (a run from the tip must make an S under a rising edge: the shoulder of the first hull), and the ease made linear (a crease 4 m in)
  { id: 'U11 the hull not deepened under a rising edge (the run from the tip makes an S)', from: '    if (!(dMax > UNDERSKIN_OFFSET_M)) continue;', to: '    continue;', file: 'export_apron.test.js', caughtBy: 'row 25:' },
  { id: 'U12 the hull\'s depth eased back linearly (a crease where it reaches 1.5 m)', from: 'out[k] += (dE - UNDERSKIN_OFFSET_M) * x * x;', to: 'out[k] += (dE - UNDERSKIN_OFFSET_M) * x;', file: 'underskin.test.js', caughtBy: 'row 9:' },
  { id: 'U5 a closed ring\'s interior left light', from: 'return rings.has(k) ?', to: 'return false ?', file: 'underskin.test.js', caughtBy: 'row 3:' },
  { id: 'U6 a cell left without a skin (a hole in the slab\'s underside)', from: 'if (!skinned.has(k)) return c;', to: 'if (!skinned.has(k) || (!mesh.cells[k].seam && (globalThis.__U6 = (globalThis.__U6 || 0) + 1) === 1)) return c;', file: 'underskin.test.js', caughtBy: 'row 1:' },   // RE-AIMED BY NAME (2026-11-02): the first GRID cell (a seam may now have no skin: underskin.js skinOf)
  { id: 'U7 the skin named as road (a physics surface under the road)', from: "replace(/^1ROAD/, 'UNDERSKIN')", to: "replace(/^1ROAD/, '1ROAD_UNDERSKIN')", file: 'underskin.test.js', caughtBy: 'row 5:' },
  // AMENDED (D604 redo): the fold U9 stood for (a skin hung along a turned-down edge's own normals, deeper than its radius) cannot happen once the skin hangs along its
  // row's section up (underskin.js skinDir: a row moves, it does not fold); a 5 m skin now shows as the run under the plank not lying level, row 23's check
  // AMENDED (D604 hull, the user's red line 10:44): the anchor is the hull's depth now; a 5 m skin is still not the hull
  { id: 'U9 the skin far deeper than the hull (5 m)', from: 'const UNDERSKIN_OFFSET_M = 1.5;', to: 'const UNDERSKIN_OFFSET_M = 5;', file: 'export_apron.test.js', caughtBy: 'row 23:' },
  { id: 'U8 the skin keeps every column (a full copy of the road under it)', from: 'step = Math.max(1, Math.ceil((K - 1) / (SKIN_COLUMNS - 1)))', to: 'step = 1', file: 'underskin.test.js', caughtBy: 'row 6:' },
  // the tube's joints and openings (D604 follow-up), caught by the tube test (test/tube_cases.test.js, its rows by their own titles)
  { id: 'U13 a seam\'s zipper kept where it is a sliver', from: 'if (longest > 0 && Math.hypot(...x) / longest >= SLIVER) keepT.push(', to: 'if (longest > 0) keepT.push(', file: 'tube_cases.test.js', caughtBy: 'the drawn hull has no sliver' },
  // RE-AIMED BY NAME (the section's middle read at the centre line, centreColumn): every skin and plank now hangs by the same sectionUp, so a section's up off the middle
  // no longer cracks a seam against its grid; underskin row 10 reads the up against the normals themselves
  { id: 'U14 the section\'s up off the middle again when K is even (a crack at a 401 | 402 seam)', from: 'if (K % 2) return at((K - 1) / 2);', to: 'return at(Math.floor(K / 2));', caughtBy: 'row 10:' },
  { id: 'U15 the rows on a seam decimated (its chords off the seam\'s every-vertex row)', from: "if (lastOf.has(ia)) mark(lastOf.get(ia), 'last'); if (firstOf.has(c.piece)) mark(firstOf.get(c.piece), 'first');", to: '', file: 'tube_cases.test.js', caughtBy: 'the drawn hull has no open edge' },
  { id: 'U16 no twisted zone (the skin decimated under an abrupt opening)', from: 'const zone = twisted.slice();', to: 'twisted.fill(false); const zone = twisted.slice();', file: 'tube_cases.test.js', caughtBy: 'THE JAG' },   // the twisted cells cleared before the zone is widened from them (clearing the zone alone left the widening to mark it again)
  { id: 'U17 the hull not thinned in the twisted zone', from: 'const HULL_TWIST_DEPTH = 1 / 3,', to: 'const HULL_TWIST_DEPTH = 1,', file: 'tube_cases.test.js', caughtBy: 'THE JAG' },
  { id: 'U18 no floor under a plank (its tip below a thinned hull: the run folds back)', from: 'return Math.max(t, Math.min(1, (drop + HULL_TWIST_CLEAR_M) / UNDERSKIN_OFFSET_M));', to: 'return t;', file: 'tube_cases.test.js', caughtBy: 'THE JAG' },
  // the centre line column (centreColumn): where the section's u is 0, between two columns when none is (an even K)
  { id: 'U19 the centre line taken by count again', from: 'if (!U || U.length !== K) return Math.floor(K / 2);', to: 'return Math.floor(K / 2);', file: 'export_apron.test.js', caughtBy: 'row 28:' },
  { id: 'U20 between two columns the nearer taken (half a column off with an even K)', from: 'return i + (U[i] === -U[i + 1] ? 0.5 : -U[i] / (U[i + 1] - U[i]));', to: 'return i + (-U[i] < U[i + 1] ? 0 : 1);', file: 'export_apron.test.js', caughtBy: 'row 28:' },
  // the skin's edge read from the plank's tip where the re-lean moved the plank (edgeDepth), and only there
  { id: 'U21 the edge of the skin never read from the tip of the plank', from: 'Math.abs(mid - (K - 1) / 2) > 0.5 ? edgeDepth(', to: 'Math.abs(mid - (K - 1) / 2) > 1e9 ? edgeDepth(', file: 'export_apron.test.js', caughtBy: 'row 29:' },
  { id: 'U22 the edge of the skin read from the tip on a symmetric section too', from: 'Math.abs(mid - (K - 1) / 2) > 0.5 ? edgeDepth(', to: 'Math.abs(mid - (K - 1) / 2) >= 0 ? edgeDepth(', file: 'tube_cases.test.js', caughtBy: 'THE JAG' },
];

const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-skin-mut-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'app'), path.join(dir, 'app'), { recursive: true, filter: (p) => !/[\\/]app[\\/](sounds|test)([\\/]|$)/.test(p) });
  fs.mkdirSync(path.join(dir, 'test'));
  for (const f of [...FILES, 'inner_run.js']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'test', f));
  fs.mkdirSync(path.join(dir, 'test', 'fixtures')); fs.copyFileSync(path.join(__dirname, 'fixtures', 'tube-cases-2026-11-02.t180track'), path.join(dir, 'test', 'fixtures', 'tube-cases-2026-11-02.t180track'));   // the tube test reads it
  return { dir, file: path.join(dir, 'src', 'export', 'underskin.js'), test: (f) => path.join(dir, 'test', f) };
}
function runOnce(t, pattern) {
  const tap = path.join(path.dirname(path.dirname(t)), '.inner-run.tap');
  const r = spawnSync(process.execPath, ['--max-old-space-size=4096', '--test', ...IR.reporterArgs(tap), ...(pattern ? [`--test-name-pattern=${pattern}`] : []), t],
    { env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), encoding: 'utf8', timeout: 600000, maxBuffer: 1 << 26 });
  if (r.error) throw r.error;
  return { out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), crashed: IR.crashesIn(tap) };
}
function verdictOf(out, name) {
  let v = null;
  for (const l of out.split('\n')) if (/^[✔✖] /.test(l) && l.slice(2).startsWith(name)) { if (l[0] === '✖') return 'fail'; v = 'pass'; }
  return v;
}

test('control: the unmutated copy passes every row of underskin.test.js and export_apron.test.js', () => {
  const c = copyTree();
  try {
    for (const f of FILES) {
      const { out, crashed } = runOnce(c.test(f), null);
      if (crashed.length) throw new Error(IR.notTested(crashed));
      const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l));
      assert.ok(/ℹ tests \d+/.test(out), `${f}: the control printed no summary`);
      assert.deepEqual(failed, [], `${f}: the unmutated copy fails: ${failed.join(' | ')}`);
    }
  } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…" in ${m.file}`, () => {
    const c = copyTree();
    try {
      const src = fs.readFileSync(c.file, 'utf8'), n = src.split(m.from).length - 1;
      assert.equal(n, 1, `NOT APPLIED: the patch text occurs ${n} times`);
      fs.writeFileSync(c.file, src.replace(m.from, m.to));
      const { out, crashed } = runOnce(c.test(m.file), `^${escapeRe(m.caughtBy)}`), v = verdictOf(out, m.caughtBy);
      if (v === null && crashed.length) throw new Error(IR.notTested(crashed));
      assert.equal(v, 'fail', `NOT CAUGHT: "${m.caughtBy}" ${v === null ? 'never reported' : 'passed'} on the mutant\n${out.slice(-1200)}`);
    } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
  });
}
