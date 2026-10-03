// geom_mutation.test.js: node --test test/geom_mutation.test.js
// Each mutation copies src/geom to a temp folder, applies ONE source patch, and runs the geometry tests against the
// mutant (GEOM_DIR). "Applied" means the patch text was found and changed. "Caught" means the named test FAILED on the
// mutant. The original src/geom is never touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const SRC = path.join(__dirname, '..', 'src', 'geom');

const MUTATIONS = [
  // D177 option 2 (the gravity frame): the old M1 (the RMF replaced by a level frame) and M2 (the closing twist not
  // spread) mutated code that is gone with the RMF: the double reflection no longer grows the frame, and there is no
  // closing twist to spread. Their replacements mutate the new rule:
  { id: 'M1 the unrolled left from up × T (the level left): undefined at a vertical tangent', file: 'path.js',
    from: 'const R = [Math.cos(theta), 0, -Math.sin(theta)];', to: 'const R = unit(cross([0, 1, 0], T));', caughtBy: 'gravity frame at EXACTLY ±90° pitch' },
  { id: "M2 the unrolled left does not follow the heading (it stays the start's)", file: 'path.js',
    from: 'const R = [Math.cos(theta), 0, -Math.sin(theta)];', to: 'const R = [1, 0, 0];', caughtBy: 'gravity frame: on an open non-planar curve' },
  { id: 'M3 fold check disabled (margin ≤ 0 never fires)', file: 'mesh.js',
    from: 'if (margin <= 0) folds.push', to: 'if (margin < -1e9) folds.push', caughtBy: 'fold check: a crafted fold fires' },
  { id: 'M4 chord-error limit removed from the adaptive step', file: 'mesh.js',
    from: 'if (len(sub(w, mul(d, t))) > o.chordErr) return false;', to: '', caughtBy: 'chord error:' },
  { id: 'M5 normals clamped at 90° (ψ past vertical treated as vertical)', file: 'profile.js',
    from: 'function normalAt(P, u) { const p = psiAt(P, u)', to: 'function normalAt(P, u) { const p = Math.min(Math.PI / 2, psiAt(P, u))', caughtBy: 'ψ past 90°' },
  { id: 'M6 zero-length word accepted', file: 'path.js',
    from: 'g.length <= 0', to: 'g.length < 0', caughtBy: 'edge: a zero-length word is refused' },
  { id: 'M7 cell vertex cap removed', file: 'mesh.js',
    from: 'const tooMany = cur && (cur.rows.length + 1) * K > MAXV;', to: 'const tooMany = false;', caughtBy: 'cells: no cell at or over 65,536' },
  // growing from the open end (the D166 addendum)
  { id: 'M8 extendPath keeps the old open end (the seam sample is not re-emitted)', file: 'path.js',
    from: 'path.samples.pop();', to: '', caughtBy: 'match: extending by one word' },
  // M9 and M10 were retargeted for the per-piece mesh (addendum 2): the old anchors named a last-cell rebuild that no
  // longer exists, because a piece is now closed when it is made
  { id: 'M9 extendMesh makes no seam onto the first new piece', file: 'mesh.js',
    from: 'seamsAround(st, segments.map((_, g) => g).slice(from));', to: 'seamsAround(st, segments.map((_, g) => g).slice(from + 1));', caughtBy: 'match: growing word by word' },
  // (not by 'extending by one word': there the last base word and TAIL share a font, so the join needs no seam)
  { id: 'M10 extendMesh remeshes every piece (right answer, cost grows with the track)', file: 'mesh.js',
    from: 'meshRange(st, path, segments, from, segments.length);', to: 'meshRange(st, path, segments, 0, segments.length);', caughtBy: 'cost: a one-word extension' },
  // sculpting a piece (the D166 addendum 2)
  { id: 'M11 sculptMesh never reuses a downstream piece (right answer, cost grows with the track)', file: 'mesh.js',
    from: 'const sameShape = old && j !== g &&', to: 'const sameShape = false && old && j !== g &&', caughtBy: 'sculpt cost:' },
  { id: 'M12 sculpt reuse ignores the start pitch', file: 'mesh.js',
    from: 'Math.abs(old.p0 - pitchOf(f0)) < 1e-12 && ', to: '', caughtBy: 'sculpt: a start-pitch change with NO bank change' },
  { id: "M13 a moved piece's seam keeps its old placement", file: 'mesh.js',
    from: 'if (st.seams[j]) st.seams[j].F = old.F;', to: '', caughtBy: "sculpt: editing one piece's length" },
  { id: "M14 a moved piece's boundary rows are not recomputed for the seam beside the sculpted piece", file: 'mesh.js',
    from: 'old.stale = { first: true, last: true };', to: 'old.stale = null;', caughtBy: "sculpt: editing one piece's length" },
  { id: 'M15 rebuildPathFrom regrows from the path start instead of segment g (right answer, path cost grows)', file: 'path.js',
    from: 'const oldN = path._nseg, newN = segments.length, work = { n: 0 };', to: 'if (g > 0) return rebuildPathFrom(path, segments, 0); const oldN = path._nseg, newN = segments.length, work = { n: 0 };', caughtBy: 'sculpt: path re-placement' },
  // D167: self-intersection, stacked surfaces, font ramps
  { id: 'M16 coplanar triangles never meet (the 2D branch disabled)', file: 'bvh.js',
    from: 'if (dist2.every((x) => Math.abs(x) <= EPS_PLANE) && dist1.every((x) => Math.abs(x) <= EPS_PLANE)) {', to: 'if (false) {', caughtBy: 'figure-8, same height' },
  { id: 'M17 the same-pass rule dropped (neighbouring cells tested against each other)', file: 'bvh.js',
    from: 'if (o <= t || gapS(B.s0[t], B.s1[t], B.s0[o], B.s1[o], closed, L) < sep) return;', to: 'if (o <= t) return;', caughtBy: 'figure-8, 6 m separation' },
  { id: 'M18 the BVH skips the last triangle of every leaf', file: 'bvh.js',
    from: 'if (n.left < 0) { for (let k = n.from; k < n.to; k++) visit(B.order[k]); }', to: 'if (n.left < 0) { for (let k = n.from; k < n.to - 1; k++) visit(B.order[k]); }', caughtBy: 'BVH = brute force' },
  { id: 'M19 the stacked reach is misread (gap scaled ×4)', file: 'bvh.js',
    from: 'const gap = Math.abs(t * 2 - 1) * reach;', to: 'const gap = Math.abs(t * 2 - 1) * reach * 4;', caughtBy: 'figure-8, 1.5 m separation' },
  { id: 'M20 ramps ignored in the mesh (a font jumps at the seam)', file: 'mesh.js',
    from: 'const A = ramp ? normalize(ramp.from) : null;', to: 'const A = null;', caughtBy: 'no step at the seam, flat → half-pipe' },
  { id: 'M21 the width does not ramp (the blend jumps to the new width)', file: 'profile.js',
    from: 'E = [EA[0] + (EB[0] - EA[0]) * w, EA[1] + (EB[1] - EA[1]) * w];', to: 'E = EB.slice();', caughtBy: 'no step at the seam, flat 26 m → flat 36 m' },
  { id: 'M22 a piece never inherits the previous font', file: 'mesh.js',
    from: "if (!(rampM > 0) || !prev || prev.kind === 'gap' || sameProfile(prev.profile, seg.profile)) return seg;", to: 'return seg;', caughtBy: 'no step at the seam, half-pipe → flat' },
  { id: 'M23 the ramp ends early (w reaches 1 at half the ramp)', file: 'mesh.js',
    from: 'const w = smoothstep((ramp.s0 + sm.s - S[0].s) / ramp.length);', to: 'const w = smoothstep(2 * (ramp.s0 + sm.s - S[0].s) / ramp.length);', caughtBy: 'the ramp ends on the entering font' },
  // D170 addendum: the self-check pairs scene nodes with cell records by position, and groups by cell, never by name
  { id: 'M26 the self-check finds cell records by NAME again', file: 'bvh.js',
    from: 'rec = mesh.cells[k];', to: 'rec = mesh.cells.slice().reverse().find((c) => c.name === m.name);', caughtBy: 'names repeat (two adjacent pieces' },
  { id: 'M27 the self-check groups findings by cell NAME', file: 'bvh.js',
    from: "const kx = S.s[ia] <= S.s[io] ? `${S.triCell[t]}|${S.triCell[o]}` : `${S.triCell[o]}|${S.triCell[t]}`;", to: 'const kx = `${x[0]}|${y[0]}`;', caughtBy: 'names repeat: a real same-height crossing' },
  { id: 'M24 the document blend offset s0 ignored (a transition split across segments restarts)', file: 'mesh.js',
    from: 'const w = smoothstep((ramp.s0 + sm.s - S[0].s) / ramp.length);', to: 'const w = smoothstep((sm.s - S[0].s) / ramp.length);', caughtBy: 'document blend: a transition split across two segments' },
  { id: "M25 blend: null overridden by the geometry's own inheritance", file: 'mesh.js',
    from: "if (!seg || seg.kind === 'gap' || seg.profileIn !== undefined || seg.blend !== undefined) return seg;", to: "if (!seg || seg.kind === 'gap' || seg.profileIn !== undefined || seg.blend) return seg;", caughtBy: 'document blend: null means no ramp' },
  // D177: rigid downstream edits (path.js: blocks, one placement chain, the unchanged tail re-placed; exact)
  { id: 'R1 the tail is always regrown (nothing is ever re-placed)', file: 'path.js',
    from: 'const same = (t) => t.p0 === inp.p0 && same3(t.R0, inp.R0);', to: 'const same = () => false;', caughtBy: "rigid: a straight's length edit on a 1° climb re-places" },
  { id: 'R2 a re-placed block keeps its old placement (its views never move)', file: 'path.js',
    from: 'if (!(same3(P.x, Q.x) && P.th === Q.th && P.s0 === Q.s0 && P.seg === Q.seg)) blk.pl = Q;', to: '', caughtBy: 'rigid: the re-placed path equals a full rebuild' },
  { id: 'R3 the tail test ignores the start pitch', file: 'path.js',
    from: 'const same = (t) => t.p0 === inp.p0 && same3(t.R0, inp.R0);', to: 'const same = (t) => same3(t.R0, inp.R0);', caughtBy: 'sculpt: a start-pitch change with NO bank change' },
  { id: "R4 the tail's first-sample indices are not advanced", file: 'path.js',
    from: 'path.segFirst[j] = at; at += blk.n;', to: 'path.segFirst[j] = at;', caughtBy: 'rigid: every downstream cell keeps its local arrays' },
  { id: 'R5 the tail stops regrowing after one block (the rest is re-placed although its inputs differ)', file: 'path.js',
    from: 'while (k < tailBlocks.length && !same(tailBlocks[k]))', to: 'if (k < tailBlocks.length && !same(tailBlocks[k]))', caughtBy: 'rigid: a pitch edit upstream is NOT rigid' },
  // R6 (the tail test ignores the frame) is EQUIVALENT under option 2: every block's R0 is exactly (1, 0, 0). Removed.
  { id: "R7 an append does not drop the old open end from its block's count", file: 'path.js',
    from: 'const last = path.blocks[from - 1]; last.n--;', to: 'const last = path.blocks[from - 1];', caughtBy: 'rigid: an append, then a sculpt upstream' },
  { id: "R8 a segment's roll is not part of its path handles (a roll edit downstream is taken as unchanged tail)", file: 'path.js',
    from: 'const blockKey = (g) => [g.length, g.k0, g.k1, g.kp0, g.kp1, g.roll0, g.roll1, g.heartline, g.heartline1, g.rollRate0, g.rollRate1]', to: 'const blockKey = (g) => [g.length, g.k0, g.k1, g.kp0, g.kp1, g.heartline, g.heartline1, g.rollRate0, g.rollRate1]', caughtBy: 'rigid: a later segment whose ROLL changed' },
  { id: 'R9 a placed sample turns its y component too (the bank against gravity drifts)', file: 'path.js',
    from: 'const ry = (v, c, sn) => [c * v[0] + sn * v[2], v[1], c * v[2] - sn * v[0]];', to: 'const ry = (v, c, sn) => [c * v[0] + sn * v[2], v[1] * (1 + (1 - c) * 1e-3 + 1e-15), c * v[2] - sn * v[0]];', caughtBy: 'rigid: the displayed bank after the move' },
];

// D181 (a load-flaky catch made deterministic, p-d181-flaky-C): a mutant is judged by its NAMED test, run ALONE
// (--test-name-pattern, anchored and escaped), from that test's own line: ✖ = caught, ✔ = NOT CAUGHT. Before, every geometry
// test ran with the mutant and a crash of ANY of them under load (a file-level failure of geom_sculpt.test.js, seen with M15
// by B in the D178 read and by me in D179) hid the named test's failing line, so the catch depended on the machine's load.
// A run in which the named test gives NO verdict (its file ended before reporting it) is not counted either way: it is
// repeated, at most twice, and every attempt is reported. Nothing here waits on time.
const TEST_FILES = ['geom_path', 'geom_mesh', 'geom_grow', 'geom_sculpt', 'geom_bvh', 'geom_ramp', 'geom_loop'].map((n) => path.join(__dirname, `${n}.test.js`));
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function runOnce(geom, pattern) {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...(pattern ? [`--test-name-pattern=${pattern}`] : []), ...TEST_FILES],
    // NODE_TEST_CONTEXT is set by the parent runner and would switch the child to the parent's protocol: clear it
    { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), GEOM_DIR: geom }, encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 });
  if (r.error) throw r.error;
  return (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
}
/** The named test's verdict in one run's output: 'fail', 'pass', or null (it never reported). */
function verdictOf(out, name) {
  let v = null;
  for (const l of out.split('\n')) if (/^[✔✖] /.test(l) && l.slice(2).startsWith(name)) { if (l[0] === '✖') return 'fail'; v = 'pass'; }
  return v;
}
function runMutant(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-geom-mut-')), geom = path.join(dir, 'geom');
  try {
    fs.cpSync(SRC, geom, { recursive: true });
    const f = path.join(geom, m.file), src = fs.readFileSync(f, 'utf8');
    const applied = src.includes(m.from);
    if (applied) fs.writeFileSync(f, src.replace(m.from, m.to));
    const attempts = [];
    for (let k = 0; k < 3; k++) {
      const out = runOnce(geom, `^${escapeRe(m.caughtBy)}`), v = verdictOf(out, m.caughtBy);
      attempts.push({ verdict: v, tail: v ? '' : out.slice(-1500) });
      if (v) break;
    }
    const last = attempts[attempts.length - 1];
    return { applied, caught: last.verdict === 'fail', verdict: last.verdict, attempts };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// the judge itself (D181): a named test's line decides; a file-level failure alone decides nothing
test('harness: the verdict is the own line of the named test (✖ caught, ✔ not caught), and a file-level failure alone is NO verdict', () => {
  const name = 'sculpt: path re-placement costs';
  assert.deepEqual([
    verdictOf('✔ other test (1ms)\n✖ sculpt: path re-placement costs the edited piece (12ms)\n', name),
    verdictOf('✔ sculpt: path re-placement costs the edited piece (12ms)\n', name),
    verdictOf('✖ C:\\repo\\test\\geom_sculpt.test.js (6718.3ms)\n✖ failing tests:\n', name),
    verdictOf('✖ sculpt: path re-placement costs more (3ms)\n', 'sculpt: path re-placement costs the edited'),
  ], ['fail', 'pass', null, null]);
});
// THE CONTROL: the unmutated copy passes EVERY geometry test (the whole files, not one name), so a catch means something
test('control: the unmutated copy passes every geometry test', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-geom-mut-')), geom = path.join(dir, 'geom');
  try {
    fs.cpSync(SRC, geom, { recursive: true });
    const out = runOnce(geom, null), failed = out.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l) && !/# TODO/.test(l));
    assert.ok(/ℹ tests \d+/.test(out), 'the control printed no summary');
    assert.deepEqual(failed, [], `the unmutated copy fails: ${failed.join(' | ')}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTATIONS) {
  test(`mutation ${m.id}: applied, and caught by "${m.caughtBy}…"`, () => {
    const r = runMutant(m);
    assert.ok(r.applied, `NOT APPLIED: "${m.from}" is not in src/geom/${m.file}`);
    assert.notEqual(r.verdict, null, `NO VERDICT in ${r.attempts.length} runs: the named test never reported. Last output:\n${r.attempts[r.attempts.length - 1].tail}`);
    assert.ok(r.caught, `NOT CAUGHT: "${m.caughtBy}…" passed on the mutant (${r.attempts.length} run(s))`);
  });
}
module.exports = { MUTATIONS, runMutant };
