// core_xsec_mutation.test.js: node --test test/core_xsec_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096, --test-concurrency=1; about twenty minutes)
// D225 (the cross-section lap): each mutant changes the core in ONE way (one or two exact string replacements, in a temporary copy of src/, tools/ and app/), and the rows of
// test/core_xsec.test.js, core_xsec_math.test.js or validate_xsec.test.js that should notice run against the copy. "Applied" means every replaced string occurs EXACTLY once
// (else NOT APPLIED, counted as such and never as a catch); "caught" means at least one of the tests selected by the pattern FAILED on the mutant. The CONTROL runs the three files
// whole on an unmutated copy, so a copy missing a file cannot make every mutant look caught. The mutants are the seal's planted controls (KE*, KT*, KS*, KX*) where the core has a
// place to plant them (the seal's own rows for the fields, the camera and the labels are C's; KS3-3 needs the climbing-turn case B builds), and the guards this build added.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const C = 'core/', G = 'geom/', V = 'validate/';
const FILES = { core: 'core_xsec.test.js', math: 'core_xsec_math.test.js', val: 'validate_xsec.test.js' };

const MUTANTS = [
  // ── E1: the edge profile (KE1-*) ──
  { id: 'KE1-1 G = t (the slice is a kink)', file: 'math', pattern: 'slice is no kink|analytic', edits: [[C + 'adapter.js', 'e * DEG * smooth((r - s) / (1 - s))', 'e * DEG * Math.max(0, Math.min(1, (r - s) / (1 - s)))']] },
  { id: 'KE1-2 the edge term is signed by the side (right side −e)', file: 'core', pattern: 'E1 \\(i\\)', edits: [[C + 'adapter.js', 'e * DEG * smooth((r - s) / (1 - s))', '(x < 0 ? -1 : 1) * e * DEG * smooth((r - s) / (1 - s))']] },
  { id: 'KE1-3 e is taken as radians', file: 'core', pattern: 'E1 \\(i\\)', edits: [[C + 'adapter.js', 'e * DEG * smooth((r - s) / (1 - s))', 'e * smooth((r - s) / (1 - s))']] },
  { id: 'KE1-4 four intervals for the outer zone', file: 'core', pattern: 'E4 \\(v\\)', edits: [[C + 'adapter.js', 'const nE = edge ? Math.max(EDGE_MIN_N, Math.ceil(1.5 * Math.max(...E.map((x) => x.e)))) : 0;', 'const nE = edge ? 4 : 0;']] },
  { id: 'KE1-5 the slice is placed at the full width, not the half-width (the edge is never reached)', file: 'core', pattern: 'E1 \\(i\\)', edits: [[C + 'adapter.js', 'r = h > 0 ? Math.abs(x) / h : 0;', 'r = h > 0 ? Math.abs(x) / (2 * h) : 0;']] },
  // ── E2: the domain (KE2-*) ──
  { id: 'KE2-1 the cap is applied to e alone, not the total', file: 'core', pattern: 'DOMAIN', edits: [[C + 'document.js', 'if (v + e[i] > CUP_MAX + EDGE_EPS) throw', 'if (e[i] > CUP_MAX + EDGE_EPS) throw']] },
  { id: 'KE2-2 no guard on the edge in the document', file: 'core', pattern: 'DOMAIN', edits: [[C + 'document.js', 'if (P.edge) checkEdge(P, at);', 'if (false) checkEdge(P, at);']] },
  { id: 'KE2-3 s has no lower bound', file: 'core', pattern: 'DOMAIN', edits: [[C + 'document.js', 'if (s.some((v) => v < S_MIN - EDGE_EPS || v > S_MAX + EDGE_EPS))', 'if (s.some((v) => v > S_MAX + EDGE_EPS))']] },
  { id: 'KE2-4 e may be negative (a lip)', file: 'core', pattern: 'DOMAIN', edits: [[C + 'document.js', 'if (e.some((v) => v < -EDGE_EPS)) throw', 'if (false) throw']] },
  { id: 'KE2-5 extend does not refuse a target the cap cannot hold', file: 'core', pattern: 'EXTEND: e, s and t targets', edits: [[C + 'extend.js', 'if (given(targets.e) && targets.e > cap(C.e.length - 1) + 1e-6) throw', 'if (false) throw']] },
  { id: 'KE2-6 the fit\'s ringing is not clamped (e)', file: 'core', pattern: 'ringing', edits: [[C + 'extend.js', 'C.e = C.e.map((x, i) => Math.min(Math.max(0, cap(i)), Math.max(0, x)));', 'C.e = C.e;']] },
  { id: 'KE2-7 a legacy piece\'s total cap ignores its own edge angle (e alone against 150)', file: 'core', pattern: 'DOMAIN', edits: [[C + 'document.js', 'const mid = legacyEdgeDeg(P.family, Math.max(...P.channels.w), Math.max(...P.channels.r)) + Math.max(...e);', 'const mid = Math.max(...e);']] },
  // ── E3: the schema and the identity ──
  { id: 'KE3-3 the schema is still /3', file: 'core', pattern: 'SCHEMA', edits: [[C + 'document.js', "const SCHEMA = 't180b.core/4',", "const SCHEMA = 't180b.core/3',"]] },
  { id: 'KE3-4 every piece\'s text carries e, s and t', file: 'core', pattern: 'SCHEMA: new documents', edits: [[C + 'document.js', 'CHANNELS.filter((ch) => !OPTIONAL[ch] || P[OPTIONAL[ch]]).map(', 'CHANNELS.map(']] },
  { id: 'KE3-5 a /3 file is not read', file: 'core', pattern: 'SCHEMA: new documents', edits: [[C + 'document.js', "OLD_SCHEMAS = Object.freeze(['t180b.core/1', 't180b.core/2', 't180b.core/3'])", "OLD_SCHEMAS = Object.freeze(['t180b.core/1', 't180b.core/2'])"]] },
  { id: 'KE3-6 a text with an edge array is not read as an edge piece', file: 'core', pattern: 'SCHEMA: an edge piece', edits: [[C + 'document.js', "...(has('e', 's') ? { edge: true } : {})", '']] },
  // ── E4: along the road (KE4-*) ──
  { id: 'KE4-1 e is left out of the joint test', file: 'core', pattern: 'JOINT \\(E4 i', edits: [[C + 'document.js', 'const c = P.channels[ch] || [OPT_DEFAULT[ch], OPT_DEFAULT[ch]], v = c[0],', "if (ch === 'e') continue; const c = P.channels[ch] || [OPT_DEFAULT[ch], OPT_DEFAULT[ch]], v = c[0],"]] },
  { id: 'KE4-2 e is reset after a flight, like the heading rate', file: 'core', pattern: 'E4 \\(ii\\)', edits: [[C + 'document.js', "h: { v: 0, m: 0 }, l: { v: 0, m: 0 } } : e;\n  }\n  return null;", "h: { v: 0, m: 0 }, l: { v: 0, m: 0 }, e: { v: 0, m: 0 } } : e;\n  }\n  return null;"]] },
  { id: 'KE4-3 one blend start for the whole piece (the cup\'s run trick on a moving slice)', file: 'core', pattern: 'E4 \\(v\\)|E4 \\(vi', edits: [[C + 'adapter.js', 'blend: { from: prof[j], s0: 0, length: s(j + 1) - s(j) }, start: prof[j]', 'blend: { from: prof[0], s0: 0, length: s(j + 1) - s(j) }, start: prof[j]']] },
  { id: 'KE4-4 no blend: one profile per segment (the stair-step)', file: 'core', pattern: 'E4 \\(vi', edits: [[C + 'adapter.js', 'out[j] = { profile: prof[j + 1], blend: { from: prof[j], s0: 0, length: s(j + 1) - s(j) }, start: prof[j], end: prof[j + 1], chord: true, fractions,', 'out[j] = { profile: prof[j + 1], blend: null, start: prof[j], end: prof[j + 1], chord: true, fractions,']] },
  { id: 'KE4-5 the mesh ignores the piece\'s shared row grid (each segment samples its own rows: a zip inside the piece)', file: 'core', pattern: 'E4 \\(vi', edits: [[G + 'mesh.js', 'Array.isArray(seg.fractions) && seg.fractions.length >= 2 ?', 'false ?']] },
  { id: 'KE4-6 the chords do not share one fraction array', file: 'core', pattern: 'E4 \\(vi', edits: [[C + 'adapter.js', 'const fractions = commonFractions(prof),', 'const fractions = null, fractionsFor = (p) => commonFractions([p]),']] },
  // ── E5, E6, E7 ──
  { id: 'KE5-1 the csp-off steep check is dropped', file: 'val', pattern: 'E5 ', edits: [[V + 'index.js', 'if (opts.csp === false) { const up', 'if (false) { const up']] },
  { id: 'KE6-2 e is fed into the roll', file: 'core', pattern: 'E6', edits: [[C + 'adapter.js', 'roll0: a.phi, roll1: b.phi, heartline: 0, profile, blend: cup', 'roll0: a.phi + a.e * 1e-3, roll1: b.phi + b.e * 1e-3, heartline: 0, profile, blend: cup']] },
  { id: 'KE7-1 edgeToDeg reads the start of the piece', file: 'core', pattern: 'READOUT', edits: [[C + 'readout.js', "edgeToDeg: P.edge ? D.channelAt(P, 'e', P.length).v : 0", "edgeToDeg: P.edge ? D.channelAt(P, 'e', 0).v : 0"]] },
  { id: 'KE7-3 a plain piece reads the wrong default slice', file: 'core', pattern: 'READOUT', edits: [[C + 'readout.js', 'sliceFrom: P.edge ? D.channelAt(P, \'s\', 0).v : D.S_DEFAULT', 'sliceFrom: P.edge ? D.channelAt(P, \'s\', 0).v : 0.7']] },
  // ── the tube (KT*) ──
  { id: 'KT1-1 the tube\'s edge angle is t, not t/2', file: 'math', pattern: 'TUBE', edits: [[C + 'adapter.js', '((t / 2) * (k + 1) / TUBE_N) * DEG]', '((t) * (k + 1) / TUBE_N) * DEG]']] },
  { id: 'KT1-2 a tube HELD in the slot is not refused', file: 'core', pattern: 'DOMAIN', edits: [[C + 'document.js', 'if (t.every((v, i) => v > tubeSlotMinDeg(w[i]) + 1e-6 && v < TUBE_MAX - 1e-6)) throw', 'if (false) throw']] },
  { id: 'KT1-3 the closure is 20 mm short of closing', file: 'core', pattern: 'T1 \\(ii', edits: [[C + 'adapter.js', '((t / 2) * (k + 1) / TUBE_N) * DEG]', '((Math.min(t, 359) / 2) * (k + 1) / TUBE_N) * DEG]']] },
  { id: 'KT1-4 the slot formula has no factor 2', file: 'math', pattern: 'tube slot', edits: [[C + 'document.js', 'const g = (t) => (2 * w / t) * Math.sin(t / 2) - gap;', 'const g = (t) => (w / t) * Math.sin(t / 2) - gap;']] },
  { id: 'KT1-5 a sweep past 360 is accepted', file: 'core', pattern: 'DOMAIN', edits: [[C + 'document.js', 'if (t.some((v) => v < -EDGE_EPS || v > TUBE_MAX + EDGE_EPS)) throw', 'if (false) throw']] },
  { id: 'KT2-1 no morph into a tube from another kind (a zip with no fade)', file: 'core', pattern: 'T1 \\(ii', edits: [[C + 'adapter.js', 'return J && s(j) < Lm - 1e-9 ? blend(', 'return false ? blend(']] },
  { id: 'KT3-1 CUP_MAX is applied to an open tube\'s t/2 + e', file: 'core', pattern: 'DOMAIN', edits: [[C + 'document.js', 'if (v / 2 + e[i] > TUBE_EDGE_MAX + EDGE_EPS) throw', 'if (v / 2 + e[i] > CUP_MAX + EDGE_EPS) throw']] },
  { id: 'KT3-2 a closed tube takes an edge', file: 'core', pattern: 'DOMAIN', edits: [[C + 'document.js', 'if (t.some((v) => v >= TUBE_MAX - 1e-9) && e.some((v) => v > EDGE_EPS)) throw', 'if (false) throw']] },
  { id: 'KT4-1 a cup and a tube are allowed together (extend)', file: 'core', pattern: 'CUP OR A TUBE', edits: [[C + 'extend.js', 'if (given(o.c) && given(o.t)) throw', 'if (false) throw']] },
  { id: 'KT4-2 a tube starts at the wrong edge after another kind (t = edge, not 2·edge)', file: 'core', pattern: 'A TUBE JOINT', edits: [[C + 'document.js', 'if (!P.tube) out.t = { v: 2 * out.c.v, m: 0 };', 'if (!P.tube) out.t = { v: out.c.v, m: 0 };']] },
  { id: 'KT4-3 a cup after a closed tube is not refused by name', file: 'val', pattern: 'X1 and T2', edits: [[C + 'extend.js', 'if (cup && from && from.c.v > D.CUP_MAX + 1e-6) throw', 'if (false) throw']] },
  // ── the spiral (KS*) ──
  { id: 'KS2-1 the roll stays the per-segment smoothstep under a heartline', file: 'val', pattern: 'S2 \\(iii\\)', edits: [[G + 'path.js', 'if (g.rollRate0 === undefined || g.rollRate1 === undefined) phi =', 'if (true) phi =']] },
  { id: 'KS2-2 the heartline is a constant per segment (a step between segments)', file: 'val', pattern: 'S2 \\(i, ii\\)', edits: [[G + 'path.js', 'const hl = g.heartline1 === undefined ? num(g.heartline) : num(g.heartline) + (g.heartline1 - num(g.heartline)) * u / L;', 'const hl = num(g.heartline1 === undefined ? g.heartline : g.heartline1);']] },
  { id: 'KS2-3 a closed tube carries heartline 0', file: 'val', pattern: 'S2 \\(i, ii\\)', edits: [[C + 'adapter.js', 'const heartlineOf = (P, x) => (P.tube ? (x.w / (2 * Math.PI)) *', 'const heartlineOf = (P, x) => (P.tube ? 0 * (x.w / (2 * Math.PI)) *']] },
  { id: 'KS2-4 the heartline ramp starts at 180 (a step where a tube hands over to a cup)', file: 'val', pattern: 'X1 and T2', edits: [[C + 'adapter.js', 'const HEARTLINE_FROM = 300;', 'const HEARTLINE_FROM = 180;']] },
  { id: 'KS2-5 water over a heartline is an anonymous throw', file: 'val', pattern: 'S2 \\(iv\\)', edits: [[C + 'water.js', "e.code = 'WATER_HEARTLINE'; throw e; }", "e.code = undefined; throw e; }"]] },
  { id: 'KS3-1 the roll rate is read over a 0.5 m chord', file: 'val', pattern: 'S3: a full 360', edits: [[V + 'index.js', 'ROLL_CHORD_M = 20;', 'ROLL_CHORD_M = 0.5;']] },
  { id: 'KS3-2 the bar is raised to 2.0', file: 'val', pattern: 'S3: a full 360', edits: [[V + 'index.js', 'ROLL_RED_DEG_M = 1.2144,', 'ROLL_RED_DEG_M = 2.0,']] },
  { id: 'KS3-4 the amber bar is dropped', file: 'val', pattern: 'S3: a full 360', edits: [[V + 'index.js', 'ROLL_AMBER_DEG_M = 0.9338,', 'ROLL_AMBER_DEG_M = 9,']] },
  { id: 'KS3-5 the roll rate is never checked', file: 'val', pattern: 'S3: a full 360', edits: [[V + 'index.js', 'if (q.rate > ROLL_RED_DEG_M) red.push(', 'if (false) red.push(']] },
  { id: 'KS4-1 the spiral\'s curvature is not given to the validator (kvec of the integrated curve)', file: 'val', pattern: 'S4', edits: [[C + 'adapter.js', 'if (!segments.some((g) => g.heartline || g.heartline1)) return path;', 'return path;']] },
  { id: 'KS4-2 a lifted sample keeps only its own fields (spread of a view)', file: 'val', pattern: 'S4|S2 \\(i, ii\\)', edits: [[C + 'adapter.js', 'return { s: x.s, seg: x.seg, pos: x.pos, T: x.T, L: x.L, U: x.U, kvec:', 'return { ...x, kvec:']] },
  // ── the validator rows ──
  { id: 'KV1 tube-too-narrow is never raised', file: 'val', pattern: 'T1 iv', edits: [[V + 'index.js', 'w < TUBE_MIN_W) raw.segReds.push', 'w < 0) raw.segReds.push']] },
  { id: 'KV2 the narrowest tube bar is 5 m', file: 'val', pattern: 'T1 iv', edits: [[V + 'index.js', 'TUBE_MIN_W = 9.43;', 'TUBE_MIN_W = 5;']] },
  { id: 'KV3 edge-past-cap is never raised', file: 'val', pattern: 'E2: the validator', edits: [[V + 'index.js', 'if (cap !== null && edgeDeg > cap + 1e-3) raw.segReds.push', 'if (false) raw.segReds.push']] },
  // ── close ──
  { id: 'KC1 close does not refuse a seam that joins a tube to another kind', file: 'core', pattern: 'CLOSE \\(E4 iii', edits: [[C + 'close.js', "if (!!F.tube !== !!L.tube) throw new D.CoreError('TUBE_SEAM'", "if (false) throw new D.CoreError('TUBE_SEAM'"]] },
  { id: 'KC2 close does not refuse an edge active at one end only', file: 'core', pattern: 'CLOSE \\(E4 iii', edits: [[C + 'close.js', 'if (Math.abs(E[0]) > EDGE_SEAM_TOL || Math.abs(E[1]) > EDGE_SEAM_TOL) throw', 'if (false) throw']] },
  { id: 'KC3 close moves e (it joins e at a seam where only one end has it)', file: 'core', pattern: 'CLOSE: a lap whose edge ends', edits: [[C + 'close.js', "const valueChannels = (sm) => ['kh', 'kv', 'w', 'r', ...(sm.cupBoth ? ['c'] : []), ...(sm.edgeBoth ? ['e', 's'] : []),", "const valueChannels = (sm) => ['kh', 'kv', 'w', 'r', ...(sm.cupBoth ? ['c'] : []), ...(true ? ['e', 's'] : []),"]] },
  // ── the brush ──
  { id: 'KB1 an e brush may reach a piece without an edge', file: 'core', pattern: 'BRUSH', edits: [[C + 'sculpt.js', "if (D.OPTIONAL[channel] && channel !== 'c' && !P[D.OPTIONAL[channel]]) throw", 'if (false) throw']] },
];

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-xsec-mut-'));
  for (const d of ['src', 'tools', 'app']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true, filter: (p) => !/[\\/]app[\\/]test([\\/]|$)/.test(p) });
  fs.mkdirSync(path.join(dir, 'test')); for (const t of Object.values(FILES)) fs.copyFileSync(path.join(__dirname, t), path.join(dir, 'test', t));
  return dir;
}
function runTests(dir, pattern, file) {
  const args = ['--max-old-space-size=4096', '--test', '--test-concurrency=1', ...(pattern ? ['--test-name-pattern', pattern] : []), path.join(dir, 'test', file)];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: core_xsec, core_xsec_math and validate_xsec pass whole on an unmutated copy of src/, tools/ and app/', () => {
  const dir = tree();
  try { for (const f of Object.values(FILES)) { const r = runTests(dir, undefined, f); assert.ok(r.tests > 5 && r.fail === 0, `${f}: tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTANTS) {
  test(`mutant ${m.id}: applied, and caught by "${m.pattern}"`, (t) => {
    const dir = tree();
    try {
      for (const [file, from, to] of m.edits) {
        const f = file.startsWith('app/') ? path.join(dir, file) : path.join(dir, 'src', file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
        assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in src/${file}: ${from.slice(0, 80)}`);
        fs.writeFileSync(f, src.replace(from, () => to));
      }
      const r = runTests(dir, m.pattern, FILES[m.file]);
      t.diagnostic(`${m.id}: ${r.fail} of ${r.tests - r.skipped} run tests failed`);
      assert.ok(r.tests - r.skipped > 0, `the pattern "${m.pattern}" ran no test`);
      assert.ok(r.fail > 0 || /SyntaxError|Error: Cannot find|ReferenceError/.test(r.out) && r.tests === 0, `NOT CAUGHT: ${r.pass} pass, 0 fail with the pattern "${m.pattern}"`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
module.exports = { MUTANTS };
