// apron_mutation.test.js: node --test test/apron_mutation.test.js   (under the heavy-run lock: each mutant runs the apron's tests on a copy of the tree)
// D572: src/export/apron.js's mutation harness, in the frame of acready_mutation.test.js. Each mutation copies src/, app/ (without sounds/ and test/), tools/ and
// test/export_apron.test.js to a temp folder, applies ONE source patch to the copy's src/export/apron.js, and runs the named row against the mutant. "Applied" means the
// patch text was found and changed; "caught" means the named row FAILED, judged by its own line, run alone. The CONTROL runs the whole file on an unmutated copy, so a copy
// missing a file cannot make every mutant look caught. The original tree is never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const IR = require('./inner_run.js');   // D352: a crashed inner run reads NOT TESTED
const ROOT = path.join(__dirname, '..');

const MUTATIONS = [
  // the plan's three (plan_wheel_under_the_road_2026-10-30.md, Part A)
  { id: 'P1 the slope sign flipped (the apron rises from the edge)', from: 'mul(q.N, -drop))', to: 'mul(q.N, drop))', caughtBy: 'row 1:' },
  // AMENDED (D593, what is seen): P2 dropped the flat join (`return { top, side: join };` → side null), which is no longer written at width > 0 (the visual underside closes
  // the section instead), so it would now be a mutant that changes nothing. The same fault where it now lives: the underside is left out.
  // AMENDED (D593, the chair's 21:58 and 23:23: the drawn surface is the physics, 0.4.34's plank and join, in the road's asphalt at LIP_SHADE): this mutant's anchor
  // was the lip's, then the side face's; the fault it stands for now is the drawn plank's.
  // AMENDED (D604 redo, the user 10:32): the join is no longer a node of its own; its run under the plank goes into the cell's skin (withRuns). The fault is the same:
  // the run never handed over, the wedge left open under the plank
  { id: 'P2 the join dropped (the wedge is left open under the plank)', from: 'if (ap.top) { if (!runs.has(k)) runs.set(k, []); runs.get(k).push(', to: 'if (false) { if (!runs.has(k)) runs.set(k, []); runs.get(k).push(', caughtBy: 'row 2:' },
  // D604 redo: the run's inner row put on the skin's OTHER edge (the bottom torn across the road)
  { id: 'P18 the run meeting the skin\'s far edge, not its own', from: 'idx.push(j === Jn ? r * C + c : base + r * Jn + j)', to: 'idx.push(j === Jn ? r * C + (C - 1 - c) : base + r * Jn + j)', caughtBy: 'row 2:' },
  // D604 hull: the run leaving the tip shallower than its chord (it must turn the other way: an S), and meeting the skin along the road, not the skin (a corner)
  { id: 'P19 the run leaving the tip shallower than its chord', from: 'chord + (TIP_LEAD_DEG * Math.PI) / 180', to: 'chord - (TIP_LEAD_DEG * Math.PI) / 180', caughtBy: 'row 25:' },
  { id: 'P20 the run meeting the skin along the road\'s slope, not the skin\'s (a corner under the edge)', from: '(2 * (depthS - UNDERSKIN_OFFSET_M) / HULL_EDGE_SPAN_M)', to: '(0)', caughtBy: 'row 25:' },
  // (D604 redo) no mutant for the outline row at an infill join (`q.atJoin`): hung by the section rule instead, it lands on the same point on every fixture, the road
  // frame's up there being the row's centre normal to the float, so it changes no result; the branch stays because pitSkins hangs those skin vertices along the join's normal
  // RE-ANCHORED BY NAME (2026-11-02): the wall test is now its own line (a wall side gets its hull's side alone, apronOf closeWall); the fault is the same
  { id: 'P3 the wall test dropped (a 90° cup gets an apron)', from: 'const wall = rows.some((q) => q.rim >= WALL_DEG);', to: 'const wall = false;', caughtBy: 'row 4:' },
  // the two the build added: the pit lane's span and the piece's own surface
  // AMENDED (D593, the pit lane's outline): the span's cells were skipped by `if (lane && lane.side === tag && inLaneSpan(mesh.cells[k], lane)) continue;`; that test now
  // opens the block that hands their rows to the outline, so the old line would read NOT APPLIED. The same fault: the span keeps the main road's own apron.
  { id: 'P4 the pit lane\'s side keeps its apron over the lane\'s span', from: 'if (lane && lane.side === tag && inLaneSpan(mesh.cells[k], lane)) {', to: 'if (false) {', caughtBy: 'row 10:' },
  { id: 'P5 every apron is 1ROAD_ (a gripped piece\'s loses its grip)', from: 'top: `${prefix}${APRON_TAG}_${rest}_${tag}`', to: 'top: `1ROAD_${APRON_TAG}_${rest}_${tag}`', caughtBy: 'row 11:' },
  // D593 (plan_apron_reads_as_part_of_the_road_2026-10-31.md, item 5 and its 17:1x and 17:2x amendments): what is seen, the pit lane's outline, and that the physics stays as it was
  // AMENDED (D593, the chair's 21:58 and 23:23: the drawn surface is the physics, 0.4.34's plank and join, in the road's asphalt at LIP_SHADE): this mutant's anchor
  // was the lip's, then the side face's; the fault it stands for now is the drawn plank's.
  { id: 'P6 the plank hidden again (what is drawn is not the physics)', from: 'const { physics, ...node } = mm; void physics; node.material = matIndex;', to: 'const { physics, ...node } = mm; void physics; node.material = matIndex; node.visible = false; node.renderable = false; node.castShadows = false;', caughtBy: 'row 13:' },
  { id: 'P7 the pit lane\'s outline dropped (its edges bare, the main apron stopping square at the span)', from: 'if (lane && lane.mesh && widthM > 0) {', to: 'if (false) {', caughtBy: 'row 14:' },
  // AMENDED (D593, the chair's 21:58 and 23:23: the drawn surface is the physics, 0.4.34's plank and join, in the road's asphalt at LIP_SHADE): this mutant's anchor
  // was the lip's, then the side face's; the fault it stands for now is the drawn plank's.
  // AMENDED (D604 hull, the user's red line 10:44): the join's own normals are gone with it (the run is the hull's, hullRun); the fault is the run's normals turned into the hull
  { id: 'P8 the run\'s normals into the hull (it is lit from inside)', from: 'if (dot(n, sub(p, G)) < 0) n = mul(n, -1);', to: 'if (dot(n, sub(p, G)) > 0) n = mul(n, -1);', caughtBy: 'row 2:' },
  // AMENDED (D593, the user 18:0x): P9 put the skin's material on the lip (its anchor `children: [{ ...vis.lip, material: m.material }]` is gone: the lip now wears the
  // road's darker shade). The fault that matters now: the lip in the road's material at full light, not the shade.
  // AMENDED (D593, the chair's 21:58 and 23:23: the drawn surface is the physics, 0.4.34's plank and join, in the road's asphalt at LIP_SHADE): this mutant's anchor
  // was the lip's, then the side face's; the fault it stands for now is the drawn plank's.
  { id: 'P9 the apron\'s material the plain dark one again (not the road\'s asphalt)', from: 'materials.push(apronMaterial(roadMat === null ? null : materials[roadMat]));', to: 'materials.push(apronMaterial(null));', caughtBy: 'row 15:' },
  // AMENDED (D593, the chair's 21:58 and 23:23: the drawn surface is the physics, 0.4.34's plank and join, in the road's asphalt at LIP_SHADE): this mutant's anchor
  // was the lip's, then the side face's; the fault it stands for now is the drawn plank's.
  { id: 'P10 the pit lane\'s outline plank hidden (round the lane, what is drawn is not the physics)', from: 'children: [{ ...out.physics, material: matIndex }] });', to: 'children: [{ ...out.physics, material: matIndex, visible: false, renderable: false, castShadows: false }] });', caughtBy: 'row 14:' },
  { id: 'P12 the road skin beside the lane hung along its own cupped normal again (it swings under the lane skin and clips through it)', from: 'if (r) return r.up;', to: 'if (r) return r.n;', caughtBy: 'row 18:' },
  { id: 'P11 the physics re-aimed along the edge\'s own segment (the step the user kept out)', from: ': add(add(q.E, mul(q.X, widthM)), mul(q.N, -drop))));', to: ': add(add(q.E, mul(q.D, widthM)), mul(q.Dn, drop))));', caughtBy: 'row 17:' },   // RE-ANCHORED BY NAME (2026-11-02): the full plank's O is now the branch past a taper
  // AMENDED (D593, the chair's 21:58 and 23:23: the drawn surface is the physics, 0.4.34's plank and join, in the road's asphalt at LIP_SHADE): this mutant's anchor
  // was the lip's, then the side face's; the fault it stands for now is the drawn plank's.
  { id: 'P13 the apron\'s asphalt at full light (not a little darker)', from: 'const LIP_SHADE = 0.88;', to: 'const LIP_SHADE = 1;', caughtBy: 'row 15:' },
  // AMENDED (D593, the chair's 21:58 and 23:23: the drawn surface is the physics, 0.4.34's plank and join, in the road's asphalt at LIP_SHADE): this mutant's anchor
  // was the lip's, then the side face's; the fault it stands for now is the drawn plank's.
  { id: 'P14 the pit lane\'s outline drawn with no join (the wedge open along the lane)', from: 'add.push({ type: \'dummy\', name: name(\'APRONSIDE\'), matrix: IDENTITY.slice(), children: [{ ...out.side, material: matIndex }] });', to: '', caughtBy: 'row 14:' },
  { id: 'P15 outline rows a few micrometres apart kept as two (a lip cell of no width)', from: 'const SAME_M = 1e-4;', to: 'const SAME_M = 1e-6;', caughtBy: 'row 18:' },
  // DROPPED (2026-11-02, the notch at the pit's rejoin): P16 (the across runs not fanned from the lane row's outer point) and P17 (the caps left to the outline's own
  // normal rules). Neither the plank nor the join walks an across run now (apron.js outlineMeshes: both go from the road row outside it straight to the lane row, fans
  // cover the end row), so the outer points and the cap normals they changed were read by nothing; the cap code went with them. The fault they stood for, a cap
  // across the lane's end, is P21's
  { id: 'P21 the plank walking across the lane\'s end again (a cap: the notch the user marked)', from: 'if (i !== k) notJoin[i] = notPlank[i] = true;', to: 'if (i !== k) notJoin[i] = true;', caughtBy: 'row 22:' },
  { id: 'P22 the hull not eased out beside the lane (a step in the bottom at the leave)', from: 'return x * x * (3 - 2 * x);', to: 'return 1;', caughtBy: 'row 26:' },
  // the tube's openings (D604 follow-up), caught by the tube test (test/tube_cases.test.js, its rows by their own titles)
  { id: 'P23 a wall side left open (no side face: the road\'s and the skin\'s edges free at a tube\'s slot)', from: 'closeWall: widthM > 0, scale:', to: 'closeWall: false, scale:', file: 'tube_cases.test.js', caughtBy: 'the drawn hull has no open edge' },
  { id: 'P24 a strip\'s triangles of no area kept (a tapered plank\'s first row)', from: 'if (len(cross(sub(V[y], V[x]), sub(V[z], V[x]))) > 1e-12) idx.push(x, y, z);', to: 'idx.push(x, y, z);', file: 'tube_cases.test.js', caughtBy: 'the drawn hull has no sliver' },
];

const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-apron-mut-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'app'), path.join(dir, 'app'), { recursive: true, filter: (p) => !/[\\/]app[\\/](sounds|test)([\\/]|$)/.test(p) });
  fs.mkdirSync(path.join(dir, 'test')); for (const f of ['export_apron.test.js', 'tube_cases.test.js']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'test', f));
  fs.mkdirSync(path.join(dir, 'test', 'fixtures')); fs.copyFileSync(path.join(__dirname, 'fixtures', 'tube-cases-2026-11-02.t180track'), path.join(dir, 'test', 'fixtures', 'tube-cases-2026-11-02.t180track'));   // the tube test reads it
  // `test`: export_apron.test.js, or a mutant's own `file` (the tube test for the tube's openings)
  return { dir, file: path.join(dir, 'src', 'export', 'apron.js'), test: path.join(dir, 'test', 'export_apron.test.js'), testOf: (f) => path.join(dir, 'test', f || 'export_apron.test.js') };
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

test('control: the unmutated copy passes every row of export_apron.test.js', () => {
  const c = copyTree();
  try {
    const { out, crashed } = runOnce(c.test, null);
    if (crashed.length) throw new Error(IR.notTested(crashed));
    const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l));
    assert.ok(/ℹ tests \d+/.test(out), 'the control printed no summary');
    assert.deepEqual(failed, [], `the unmutated copy fails: ${failed.join(' | ')}`);
  } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const c = copyTree();
    try {
      const src = fs.readFileSync(c.file, 'utf8'), n = src.split(m.from).length - 1;
      assert.equal(n, 1, `NOT APPLIED: the patch text occurs ${n} times`);
      fs.writeFileSync(c.file, src.replace(m.from, m.to));
      const { out, crashed } = runOnce(c.testOf(m.file), `^${escapeRe(m.caughtBy)}`), v = verdictOf(out, m.caughtBy);
      if (v === null && crashed.length) throw new Error(IR.notTested(crashed));
      assert.equal(v, 'fail', `NOT CAUGHT: "${m.caughtBy}" ${v === null ? 'never reported' : 'passed'} on the mutant\n${out.slice(-1200)}`);
    } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
  });
}
