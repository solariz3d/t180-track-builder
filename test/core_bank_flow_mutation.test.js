// core_bank_flow_mutation.test.js: node --test test/core_bank_flow_mutation.test.js   (under the heavy-run lock; a minute or two)
// Each mutant changes the FLOWING BANK in src/core/extend.js (flowMarks, flowSolve, flowInside, flowBank and their checks in extend) in ONE way (one exact string replacement, in a temporary
// copy of src/ and tools/), and the flowing-bank rows and the roll instrument's rows run against the copy. "Applied" means the replaced string occurs EXACTLY once;
// "caught" means at least one test FAILED on the mutant. The CONTROL runs the files whole on an unmutated copy, so a copy missing a file cannot make every mutant look
// caught. Plan: lighthouse exo_memory/loop/plan_t180_smooth_banked_turns_2026-11-24.md, Part 2.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const IR = require('./inner_run.js');   // a crashed inner run reads NOT TESTED
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const X = 'core/extend.js';

const MUTANTS = [
  // the option and its refusals
  { id: "R1 bankShape 'flow' is refused as an unknown shape", pattern: 'flow|built', edits: [[X, "bankShape !== 'swell' && bankShape !== 'flow' && !isShares(bankShape)", "bankShape !== 'swell' && !isShares(bankShape)"]] },
  { id: 'R2 through on another channel is not refused', pattern: 'flow 8', edits: [[X, "if (other) throw new D.CoreError('BAD_TARGET', `through is for the bank only", "if (false) throw new D.CoreError('BAD_TARGET', `through is for the bank only"]] },
  { id: "R3 through with a bank shape other than 'flow' is not refused", pattern: 'flow 8', edits: [[X, 'if (through.phi !== undefined && !flow) throw', 'if (false) throw']] },
  { id: 'R4 a flowing bank with no first target is not refused', pattern: 'flow 8', edits: [[X, "if (!(targets && Number.isFinite(targets.phi))) throw", "if (false) throw"]] },
  { id: "R5 through with the bank's changes is not refused", pattern: 'flow 8', edits: [[X, "if ((changes && changes.phi !== undefined && changes.phi !== null) || (second && second.phi !== undefined && second.phi !== null)) throw", "if (false) throw"]] },
  { id: 'R6 a through that is not a list is not refused', pattern: 'flow 8', edits: [[X, "if (!Array.isArray(list)) throw", "if (false) throw"]] },
  { id: 'R7 a mark that is not a number is not refused', pattern: 'flow 8', edits: [[X, "if (!Number.isFinite(at) || !Number.isFinite(target)) throw", "if (false) throw"]] },
  { id: 'R8 a mark before the one before it is not refused', pattern: 'flow 8', edits: [[X, 'if (!(at > prev.at)) throw', 'if (false) throw']] },
  { id: 'R9 a mark under 5 m after the one before is not refused', pattern: 'flow 8', edits: [[X, 'if (at - prev.at < KNOT_GAP_M - 1e-9) throw', 'if (false) throw']] },
  { id: "R10 a mark past the piece's length is not refused", pattern: 'flow 8', edits: [[X, 'if (at > length + 1e-9) throw', 'if (false) throw']] },
  // the marks
  { id: "M1 the through marks are dropped (only the first target is passed)", pattern: 'flow 1|flow 9', edits: [[X, "const marks = flowMarks(through && through.phi, { at: Lof('phi'), target: targets.phi }, length);", "const marks = flowMarks(null, { at: Lof('phi'), target: targets.phi }, length);"]] },
  { id: "M2 the first target is passed at the piece's end, not at its transition", pattern: 'flow 1', edits: [[X, "flowMarks(through && through.phi, { at: Lof('phi'), target: targets.phi }, length)", "flowMarks(through && through.phi, { at: length, target: targets.phi }, length)"]] },
  // the knots at the marks
  { id: 'K1 no knot is inserted at a mark', pattern: 'flow', edits: [[X, 'const P = D.insertKnots(piece, ins), U = D.knotVector(P)', 'const P = piece, U = D.knotVector(P)']] },
  { id: 'K2 a mark takes a knot as far as 10 m away for its own', pattern: 'flow', edits: [[X, 'const FLOW_SNAP_M = 1;', 'const FLOW_SNAP_M = 10;']] },
  // the solve
  { id: "S1 the joint's slope is not carried (the bank starts level-rated)", pattern: 'flow 4', edits: [[X, 'const fixed = new Map([[0, v0], [1, v0 + (m0 * U[4]) / 3]]);', 'const fixed = new Map([[0, v0], [1, v0]]);']] },
  { id: "S2 the head's slope is dropped at the call (held or not)", pattern: 'flow 4', edits: [[X, 'laid = flowBank(laid, marks, from.phi.v, held ? from.phi.m : 0, a0, trial);', 'laid = flowBank(laid, marks, from.phi.v, 0, a0, trial);']] },
  { id: "S3 the end is not held at rest when the last mark is at the piece's end", pattern: 'flow 4', edits: [[X, 'if (U[i + 4] > anchor + 1e-9 || i >= n - 3) fixed.set(i, last.target);', 'if (U[i + 4] > anchor + 1e-9) fixed.set(i, last.target);']] },
  { id: 'S4 the start\'s curvature is not held at 0', pattern: 'flow 4', edits: [[X, 'r[B.first + p] = B.D2[p]; rows.push({ r, d: a0, k: -1 }); }', 'r[B.first + p] = 0; rows.push({ r, d: a0, k: -1 }); }']] },
  { id: 'S5 the marks are not passed (their rows dropped)', pattern: 'flow 1', edits: [[X, 'for (let p = 0; p < 4; p++) r[B.first + p] = B.N[p]; rows.push({ r, d: m.target, k }); });', 'rows.length += 0; });']] },
  { id: 'S6 the least SLOPE, not the least bending (D1 for D2 in the Gram matrix)', pattern: 'flow', edits: [[X, '+= W * (B.D2[p] * B.D2[q] + FLOW_TENSION * B.D1[p] * B.D1[q]);', '+= W * (B.D1[p] * B.D1[q]);']] },
  { id: 'S7 the Gram matrix is read at one point per span (the middle), not three', pattern: 'flow', edits: [[X, 'const GAUSS3 = [[-Math.sqrt(0.6), 5 / 9], [0, 8 / 9], [Math.sqrt(0.6), 5 / 9]];', 'const GAUSS3 = [[0, 2]];']] },
  { id: 'S8 tension at the plan\'s first answer (λ = 0.03)', pattern: 'flow', edits: [[X, 'const FLOW_TENSION = 0;', 'const FLOW_TENSION = 0.03;']] },
  { id: 'S9 the control points are stored to 3 places, not the bank\'s 9', pattern: 'flow', edits: [[X, 'C[i] = Number((fixed.has(i) ? fixed.get(i) : y[pos.get(i)]).toFixed(dec)) + 0;', 'C[i] = Number((fixed.has(i) ? fixed.get(i) : y[pos.get(i)]).toFixed(3)) + 0;']] },
  // the joint's roll acceleration (C2 after a road that ends rolling) and the flight before it
  { id: "J1 the joint's roll acceleration is not carried (the start held at 0, as before)", pattern: 'flow 4', edits: [[X, 'rows.push({ r, d: a0, k: -1 }); }', 'rows.push({ r, d: 0, k: -1 }); }']] },
  { id: "J2 the joint's roll acceleration is not passed at the call", pattern: 'flow 4', edits: [[X, 'laid = flowBank(laid, marks, from.phi.v, held ? from.phi.m : 0, a0, trial);', 'laid = flowBank(laid, marks, from.phi.v, held ? from.phi.m : 0, undefined, trial);']] },
  { id: 'J3 after a flight the flight is read as road (its channel at its end)', pattern: 'flow 4', edits: [[X, "a0 = last && last.type !== 'flight' ? D.channelAt(last, 'phi', last.length).d2 : 0;", "a0 = last ? D.channelAt(last, 'phi', last.length).d2 : 0;"]] },
  // the peak at rest
  { id: 'P1 a turning mark is not held at rest', pattern: 'flow 5|flow 11', edits: [[X, 'const FLOW_PEAK_REST = true;', 'const FLOW_PEAK_REST = false;']] },
  { id: 'P2 every mark that does NOT turn is held at rest instead', pattern: 'flow', edits: [[X, 'if ((m.target - before) * (after - m.target) < 0) {', 'if ((m.target - before) * (after - m.target) > 0) {']] },
  // LAP 2, inside the marks (the reader's finding 1): the range, the side between two of one sign, the start counted as a mark, the plain answer kept
  { id: 'B1 the curve is not held inside the range', pattern: 'drawn 1|drawn 3|drawn 5', edits: [[X, 'const FLOW_HOLD = FLOW_ROOM - FLOW_BUILT;', 'const FLOW_HOLD = 1e9;']] },
  { id: "B2 the curve is not held on the marks' side between two of one sign", pattern: 'drawn 1|drawn 3|drawn 4|drawn 10', edits: [[X, 'const lo = same > 0 ? Math.max(bot, FLOW_SIDE) : bot, hi = same < 0 ? Math.min(top, -FLOW_SIDE) : top;', 'const lo = bot, hi = top;']] },
  { id: 'B3 the curve is held every 2 m, not every 0.25 m', pattern: 'drawn', edits: [[X, 'const FLOW_EVERY_M = 0.25;', 'const FLOW_EVERY_M = 2;']] },
  { id: 'B4 the bank the piece starts from is left out of the range', pattern: 'drawn', edits: [[X, 'const all = [{ at: 0, target: v0 }, ...marks], top =', 'const all = [{ at: 0, target: marks[0].target }, ...marks], top =']] },
  { id: 'B5 the least bending is laid even where it leaves what the marks ask', pattern: 'drawn 1|drawn 3|drawn 5', edits: [[X, 'if (ineq.some((q) => slack(q, y) < -1e-12)) {', 'if (false) {']] },
  // B6: the final read alone is not a mutant that can be caught at these constants, and is kept as the guard for them: it reads every 0.5 m, a subset of the
  // rows' 0.25 m, against FLOW_ROOM where the rows hold FLOW_HOLD, and DEC.phi = 9 rounds a point by at most 5e-10 rad against FLOW_SIDE's 1e-8 (no list of 2160
  // drawn laid differently without it). So the mutant takes it away together with the rows' fine grid, which is the change it guards against.
  { id: 'B6 the curve is held every 2 m AND not read once more (the final read)', pattern: 'drawn|flow', edits: [[X, 'const FLOW_EVERY_M = 0.25;', 'const FLOW_EVERY_M = 2;'], [X, "return w ? { fail: { kind: w.s <= U[4] + 1e-9 ? 'joint' : 'range', k: flowSteepest(all) } } : { piece: out };", 'return { piece: out };']] },
  // the solve inside them (flowInside, Goldfarb and Idnani)
  { id: 'G1 a row taken is never let go (its multiplier never read)', pattern: 'qp', edits: [[X, 'if (rj > 1e-14) { const t = u[j] / rj;', 'if (false) { const t = u[j] / rj;']] },
  { id: 'G2 the full step goes the wrong way', pattern: 'qp', edits: [[X, '? -slack(ineq[p], y) / zn : Infinity;', '? slack(ineq[p], y) / zn : Infinity;']] },
  { id: 'G3 the multipliers are not moved with a step', pattern: 'qp', edits: [[X, 'for (let j = 0; j < act.length; j++) u[j] -= t * r[ne + j];', '']] },
  { id: 'G4 rows no curve meets give the point reached, not none', pattern: 'qp', edits: [[X, 'if (t1 === Infinity && t2 === Infinity) return null;', 'if (t1 === Infinity && t2 === Infinity) return y;']] },
  { id: 'G5 the equality rows are left out of the step (the marks not kept)', pattern: 'qp|drawn 5', edits: [[X, 'const N = [...E, ...act.map((k) => ineq[k].c)], GN = [...GE, ...GA], ne = E.length;', 'const N = act.map((k) => ineq[k].c), GN = GA, ne = 0;']] },
  // what the solve cannot carry (findings 2 and 3), refused by name with its room
  { id: 'D1 a row with no free point is skipped, not checked (finding 3)', pattern: 'drawn 7', edits: [[X, "if (Math.abs(res) > 1e-9 * size + 1e-15) return { fail: { kind: row.k < 0 ? 'joint' : 'mark'", "if (false) return { fail: { kind: row.k < 0 ? 'joint' : 'mark'"]] },
  { id: 'D2 rows that outnumber their free points are not refused before the solve (finding 2)', pattern: 'drawn 2', edits: [[X, "if (dep) return { fail: { kind: dep.k < 0 ? 'joint' : 'mark'", "if (false) return { fail: { kind: dep.k < 0 ? 'joint' : 'mark'"]] },
  { id: 'N1 a refusal names no room (the search not run)', pattern: 'drawn 2|drawn 6', edits: [[X, 'const room = flowRoom(marks, L, trial, fail.k);', 'const room = null;']] },
  { id: 'N2 the room named is one metre short of what lays', pattern: 'drawn 6', edits: [[X, 'return { k, need: +(marks[k].at + dm - (k ? marks[k - 1].at : 0)).toFixed(1) };', 'return { k, need: +(marks[k].at + dm - 1 - (k ? marks[k - 1].at : 0)).toFixed(1) };']] },
  { id: "W1 a plain piece's built road is not read", pattern: 'drawn 3|drawn 4', edits: [[X, 'const w = opts.bankCheck !== false && flowBuiltWrong(doc, laid, marks, from.phi.v);', 'const w = false;']] },
  { id: "W2 a corner's built road is not read", pattern: 'drawn 9|drawn 11|built', edits: [[X, 'if (w) throw flowRefusal(w, f.marks, opts.length, trial);\n    return;', 'return;']] },
];
const FILES = ['core_bank_flow.test.js', 'roll_profile.test.js', 'core_bank_flow_drawn.test.js', 'core_bank_flow_qp.test.js'];
const HELPERS = ['roll_profile.js'];
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-flow-mut-'));
  for (const d of ['src', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  for (const f of [...FILES, ...HELPERS]) fs.copyFileSync(path.join(__dirname, f), path.join(dir, 'test', f));
  fs.mkdirSync(path.join(dir, 'test', 'fixtures'));   // flow 4b and 4c lay on fixture F5 (a road that ends rolling)
  for (const f of fs.readdirSync(path.join(__dirname, 'fixtures')).filter((n) => n.startsWith('F5-'))) fs.copyFileSync(path.join(__dirname, 'fixtures', f), path.join(dir, 'test', 'fixtures', f));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...FILES.map((f) => path.join(dir, 'test', f))];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const tap = path.join(dir, '.inner-run.tap');   // a TAP copy, the only place a dead file's exit code shows
  const r = spawnSync(process.execPath, [...IR.reporterArgs(tap), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 10 * 60 * 1000, windowsHide: true });
  const crashed = IR.crashesIn(tap);   // a file that died natively counts 1 failure and ran none of its tests: NOT TESTED, never caught
  if (crashed.length) throw new Error(IR.notTested(crashed));
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), todo: n('todo') || 0, out };
}
test('CONTROL: the flowing-bank and roll-instrument files pass whole on an unmutated copy of src/ and tools/', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests > 18 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTANTS) {
  test(`mutant ${m.id}: applied, and caught by "${m.pattern}"`, (t) => {
    const dir = tree();
    try {
      for (const [file, from, to] of m.edits) {
        const f = path.join(dir, 'src', file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
        assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in src/${file}: ${from.slice(0, 80)}`);
        fs.writeFileSync(f, src.replace(from, () => to));
      }
      const r = runTests(dir, m.pattern);
      t.diagnostic(`${m.id}: ${r.fail} of ${r.tests - r.skipped} run tests failed`);
      assert.ok(r.tests - r.skipped > 0, `the pattern "${m.pattern}" ran no test`);
      assert.ok(r.fail > 0, `NOT CAUGHT: ${r.pass} pass, 0 fail with the pattern "${m.pattern}"`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
module.exports = { MUTANTS };
