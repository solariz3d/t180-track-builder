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
  // AMENDED (D593, the keeper 21:54-21:55 on 0.4.35: the drawn lip read as a blade, and is gone; apron.js sideFace draws the road's own edge, filled): this mutant's
  // anchor was the lip's; the fault it stands for now is the filled face's.
  { id: 'P2 the drawn face dropped (the section is left open under the edge)', from: 'add.push({ type: \'dummy\', name: c.name.replace(/^CELL_/, `APRONSIDE${tag}_`), matrix: c.matrix, children: [{ ...sideFace(sideRows(m, K, side), `${SIDE_PREFIX}_${rest}_${tag}`), material: shadeIndex(m.material) }] });', to: '', caughtBy: 'row 2:' },
  { id: 'P3 the wall test dropped (a 90° cup gets an apron)', from: 'if (rows.some((q) => q.rim >= WALL_DEG)) return null;', to: '', caughtBy: 'row 4:' },
  // the two the build added: the pit lane's span and the piece's own surface
  // AMENDED (D593, the pit lane's outline): the span's cells were skipped by `if (lane && lane.side === tag && inLaneSpan(mesh.cells[k], lane)) continue;`; that test now
  // opens the block that hands their rows to the outline, so the old line would read NOT APPLIED. The same fault: the span keeps the main road's own apron.
  { id: 'P4 the pit lane\'s side keeps its apron over the lane\'s span', from: 'if (lane && lane.side === tag && inLaneSpan(mesh.cells[k], lane)) {', to: 'if (false) {', caughtBy: 'row 10:' },
  { id: 'P5 every apron is 1ROAD_ (a gripped piece\'s loses its grip)', from: 'top: `${prefix}${APRON_TAG}_${rest}_${tag}`', to: 'top: `1ROAD_${APRON_TAG}_${rest}_${tag}`', caughtBy: 'row 11:' },
  // D593 (plan_apron_reads_as_part_of_the_road_2026-10-31.md, item 5 and its 17:1x and 17:2x amendments): what is seen, the pit lane's outline, and that the physics stays as it was
  // AMENDED (D593, the keeper 21:54-21:55 on 0.4.35: the drawn lip read as a blade, and is gone; apron.js sideFace draws the road's own edge, filled): this mutant's
  // anchor was the lip's; the fault it stands for now is the filled face's.
  { id: 'P6 the drawn edge reaches 2 m past the road\'s edge again (a blade)', from: 'const S = rows.map((q) => sub(q.E, mul(q.NE, UNDERSKIN_OFFSET_M))), G = rows.map', to: 'const S = rows.map((q) => add(sub(q.E, mul(q.NE, UNDERSKIN_OFFSET_M)), mul(q.X, 2))), G = rows.map', caughtBy: 'row 13:' },
  { id: 'P7 the pit lane\'s outline dropped (its edges bare, the main apron stopping square at the span)', from: 'if (lane && lane.mesh && widthM > 0) {', to: 'if (false) {', caughtBy: 'row 14:' },
  // AMENDED (D593, the keeper 21:54-21:55 on 0.4.35: the drawn lip read as a blade, and is gone; apron.js sideFace draws the road's own edge, filled): this mutant's
  // anchor was the lip's; the fault it stands for now is the filled face's.
  { id: 'P8 the face lit from inside (its normals into the road)', from: 'return dot(x, q.X) < 0 ? mul(x, -1) : x;', to: 'return dot(x, q.X) < 0 ? x : mul(x, -1);', caughtBy: 'row 15:' },
  // AMENDED (D593, the user 18:0x): P9 put the skin's material on the lip (its anchor `children: [{ ...vis.lip, material: m.material }]` is gone: the lip now wears the
  // road's darker shade). The fault that matters now: the lip in the road's material at full light, not the shade.
  // AMENDED (D593, the keeper 21:54-21:55 on 0.4.35: the drawn lip read as a blade, and is gone; apron.js sideFace draws the road's own edge, filled): this mutant's
  // anchor was the lip's; the fault it stands for now is the filled face's.
  { id: 'P9 the face in the road\'s material unshaded (not the darker shade)', from: '`${SIDE_PREFIX}_${rest}_${tag}`), material: shadeIndex(m.material) }]', to: '`${SIDE_PREFIX}_${rest}_${tag}`), material: m.material }]', caughtBy: 'row 16:' },
  { id: 'P10 the physics apron drawn again (the plank shows under the lip)', from: 'node.visible = false; node.renderable = false; node.castShadows = false;', to: '', caughtBy: 'row 16:' },
  { id: 'P12 the road skin beside the lane hung along its own cupped normal again (it swings under the lane skin and clips through it)', from: 'if (r) return r.up;', to: 'if (r) return r.n;', caughtBy: 'row 18:' },
  { id: 'P11 the physics re-aimed along the edge\'s own segment (the step the keeper kept out)', from: 'const O = rows.map((q) => add(add(q.E, mul(q.X, widthM)), mul(q.N, -drop)))', to: 'const O = rows.map((q) => add(add(q.E, mul(q.D, widthM)), mul(q.Dn, drop)))', caughtBy: 'row 17:' },
  // AMENDED (D593, the keeper 21:54-21:55 on 0.4.35: the drawn lip read as a blade, and is gone; apron.js sideFace draws the road's own edge, filled): this mutant's
  // anchor was the lip's; the fault it stands for now is the filled face's.
  { id: 'P13 the face\'s uvs not the road\'s carried on (a plain tile: the asphalt does not run down it)', from: '(q.uv ? [q.uv[0], q.uv[1]] : [0, vAt[r]])', to: '[0, vAt[r]]', caughtBy: 'row 16:' },
  // AMENDED (D593, the keeper 21:54-21:55 on 0.4.35: the drawn lip read as a blade, and is gone; apron.js sideFace draws the road's own edge, filled): this mutant's
  // anchor was the lip's; the fault it stands for now is the filled face's.
  { id: 'P14 the pit lane\'s outline drawn with no face (its edge a bare slice again)', from: 'add.push({ type: \'dummy\', name: name(\'APRONSIDE\'), matrix: IDENTITY.slice(), children: [{ ...out.side, material: outlineMat === null ? matIndex : shadeIndex(outlineMat) }] });', to: '', caughtBy: 'row 14:' },
  { id: 'P15 outline rows a few micrometres apart kept as two (a lip cell of no width)', from: 'const SAME_M = 1e-4;', to: 'const SAME_M = 1e-6;', caughtBy: 'row 18:' },
  // AMENDED (D593, the keeper 21:54-21:55 on 0.4.35: the drawn lip read as a blade, and is gone; apron.js sideFace draws the road's own edge, filled): this mutant's
  // anchor was the lip's; the fault it stands for now is the filled face's.
  { id: 'P16 the lane\'s face in each part\'s own uv space again (the texture squeezed into one row at every switch)', from: 'side: sideFace(continuousUv(rows.filter((q) => !q.end)), names.side)', to: 'side: sideFace(rows.filter((q) => !q.end), names.side)', caughtBy: 'row 19:' },
];

const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-apron-mut-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'app'), path.join(dir, 'app'), { recursive: true, filter: (p) => !/[\\/]app[\\/](sounds|test)([\\/]|$)/.test(p) });
  fs.mkdirSync(path.join(dir, 'test')); fs.copyFileSync(path.join(__dirname, 'export_apron.test.js'), path.join(dir, 'test', 'export_apron.test.js'));
  return { dir, file: path.join(dir, 'src', 'export', 'apron.js'), test: path.join(dir, 'test', 'export_apron.test.js') };
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
      const { out, crashed } = runOnce(c.test, `^${escapeRe(m.caughtBy)}`), v = verdictOf(out, m.caughtBy);
      if (v === null && crashed.length) throw new Error(IR.notTested(crashed));
      assert.equal(v, 'fail', `NOT CAUGHT: "${m.caughtBy}" ${v === null ? 'never reported' : 'passed'} on the mutant\n${out.slice(-1200)}`);
    } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
  });
}
