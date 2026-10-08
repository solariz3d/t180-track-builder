// core_cup_mutation.test.js: node --test test/core_cup_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096; a few minutes)
// D190: each mutant changes the core in ONE way (one or two exact string replacements, in a temporary copy of src/ and tools/), and the
// rows of test/core_cup.test.js that should notice run against the copy. "Applied" means every replaced string occurs EXACTLY once;
// "caught" means at least one of those tests FAILED on the mutant. The CONTROL runs the whole file on an unmutated copy, so a copy that
// is missing a file cannot make every mutant look caught. The mutants are the D190 seal's planted controls (K1a-1 ... K7-2) where the
// code has a place to plant them, and the rest of the rules this build added.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const C = 'core/';

const R = '';   // src/ files outside core/ are given relative to src/
const MUTANTS = [
  // row 1a: the edge is c
  { id: 'M1 (K1a-1) a cup piece renders the legacy profile (the r cap applies)', pattern: 'row 1a', edits: [[C + 'adapter.js', 'profile = cup ? cup[j].profile : L.profile;', 'profile = profileAt(P.family, mid.w, mid.r);']] },
  { id: 'M2 (K1a-2) only the left edge is cupped', pattern: 'row 1a', edits: [[C + 'adapter.js', "    psi: [...side.slice().reverse().map(([, p]) => p), 0, ...side.map(([, p]) => p)],\n    material: 'ROAD',\n  };\n}\n\nconst smooth", "    psi: [...side.slice().reverse().map(([, p]) => 0), 0, ...side.map(([, p]) => p)],\n    material: 'ROAD',\n  };\n}\n\nconst smooth"]] },
  { id: 'M3 (K1a-3) c is taken as radians', pattern: 'row 1a', edits: [[C + 'adapter.js', '((c * F[i]) / F[F.length - 1]) * DEG]', '((c * F[i]) / F[F.length - 1])]']] },
  { id: 'M4 (K2-3) a non-cumulative shape: each quarter\'s own rise, not the running total', pattern: 'row 1a', edits: [[C + 'adapter.js', '((c * F[i]) / F[F.length - 1]) * DEG]', '((c * (F[i] - (i ? F[i - 1] : 0))) / F[F.length - 1]) * DEG]']] },
  // row 2: MAX binds the document
  { id: 'M5 (K2-1) MAX raised to 165', pattern: 'row 2', edits: [[C + 'document.js', 'const CUP_MAX = 150,', 'const CUP_MAX = 165,']] },
  { id: 'M6 (K2-2) no guard on the document', pattern: 'row 2', edits: [[C + 'document.js', 'if (P.cup && P.channels.c.some((v) => v < -CUP_EPS || v > CUP_MAX + CUP_EPS))', 'if (false)']] },
  { id: 'M7 the fit\'s ringing is not clamped after the Extend fit', pattern: 'row 2', edits: [[C + 'extend.js', 'const c = piece.channels.c = piece.channels.c.map((x) => Math.min(D.CUP_MAX, Math.max(0, x))), n = c.length;', 'const c = piece.channels.c, n = c.length;']] },
  { id: 'M8 Extend does not refuse a typed cup past 150', pattern: 'row 2 \\(iii\\)', edits: [[C + 'extend.js', 'targets.c >= 0 && targets.c <= D.CUP_MAX)) throw', 'targets.c >= 0 && targets.c <= 1e9)) throw']] },
  { id: 'M9 Extend does not refuse a first-piece cup past 150', pattern: 'row 2 PLANTED', edits: [[C + 'extend.js', 'first.c >= 0 && first.c <= D.CUP_MAX)) throw', 'first.c >= 0 && first.c <= 1e9)) throw']] },
  { id: 'M10 the brush has no cup channel', pattern: 'row 2 \\(iii\\)', edits: [[C + 'sculpt.js', "'l', 'c', 'e', 's', 't'], what:", "'l', 'e', 's', 't'], what:"]] },
  { id: 'M10b a cup that ends at a limit is not made flat (the next piece would need a control point past it)', pattern: 'ends flat', edits: [[C + 'extend.js', 'if (c[n - 1] <= 1e-3 || c[n - 1] >= D.CUP_MAX - 1e-3) c[n - 2] = c[n - 1];', 'if (false) c[n - 2] = c[n - 1];']] },
  { id: 'M10c the document guard has no tolerance for a solver\'s float noise at the limit', pattern: 'ends flat', edits: [[C + 'document.js', 'CUP_EPS = 1e-9;', 'CUP_EPS = 0;']] },
  // R2: the morph out of a legacy cross-section
  { id: 'M29 (R2) no morph: a cup after a legacy piece starts on the cup shape, not the legacy one', pattern: 'R2', edits: [[C + 'adapter.js', 'if (join) j = morphZone(P, n, E, s, join, out);', 'if (false) j = morphZone(P, n, E, s, join, out);']] },
  { id: 'M30 (R2) the morph carries no difference (the legacy shape is dropped inside the road)', pattern: 'R2', edits: [[C + 'adapter.js', 'u: cw.u, psi: cw.psi.map((x, i) => x + m * dpsi[i])', 'u: cw.u, psi: cw.psi.map((x, i) => x)']] },
  { id: 'M31 (R2) the morph never fades (the legacy difference stays for the whole piece)', pattern: 'R2', edits: [[C + 'adapter.js', 'mu = (x) => 1 - smooth(x / Lm);', 'mu = (x) => 1;']] },
  // row 3: joints
  { id: 'M11 (K3-1) c is left out of the joint test between two cup pieces', pattern: 'row 3', edits: [[C + 'document.js', "if (prevKind === 'cup' && kind === 'cup') { /* falls through to the general test */ }", "if (prevKind === 'cup' && kind === 'cup') { continue; }"]] },
  // re-anchored (the anchor sweep on 6a799cb): its old anchor left document.js with D258's free jump (1e76d35); the state after a flight is now afterFlight,
  // which resets the heading and climb rates and the offsets and carries the rest, c included. The same mutant (as KE4-2 in core_xsec_mutation, 0014555)
  { id: 'M12 (K3-2) c is reset after a flight, like the heading rate', pattern: 'row 3', edits: [[C + 'document.js', "h: { v: 0, m: 0 }, l: { v: 0, m: 0 }, phi: { v: F.bank, m: 0 } });", "h: { v: 0, m: 0 }, l: { v: 0, m: 0 }, c: { v: 0, m: 0 }, phi: { v: F.bank, m: 0 } });"]] },
  { id: 'M13 (K3-3) c is left out of the closure rows', pattern: 'row 3 \\(iii\\)', edits: [[C + 'close.js', 'cupBoth: !!(F.cup && L.cup), edgeBoth', 'cupBoth: false, edgeBoth'], [C + 'close.js', 'const cupBoth = !!(doc.pieces[roadIdx[0]].cup && doc.pieces[roadIdx[roadIdx.length - 1]].cup);', 'const cupBoth = false;']] },
  { id: 'M14 (K3-4) a legacy piece hands over the family\'s nominal edge, not the one it renders', pattern: 'row 3|row 7', edits: [[C + 'document.js', 'if (!P.cup) out.c = { v: legacyEdgeDeg(P.family, out.w.v, out.r.v), m: 0 };', 'if (!P.cup) out.c = { v: FLOORS[P.family][3], m: 0 };']] },
  { id: 'M15 the legacy ↔ cup joint is not checked', pattern: 'row 3 \\(iv\\)', edits: [[C + 'document.js', 'if (Math.abs(here - prevEnd.c.v) > CUP_JOINT_DEG) return', 'if (false) return']] },
  { id: 'M16 a piece extended after a cup piece is a legacy piece', pattern: 'row 3', edits: [[C + 'document.js', "if (doc.pieces[i].type === 'road') return kindOf(doc.pieces[i]); return 'legacy'; }", "if (doc.pieces[i].type === 'road') return kindOf(doc.pieces[i]) === 'cup' ? 'legacy' : kindOf(doc.pieces[i]); return 'legacy'; }"]] },
  // row 1b: on the road
  { id: 'M17 (K1b-1) the blend is dropped: each segment steps to its own profile', pattern: 'row 1b', edits: [[C + 'adapter.js', 'blend: cup ? cup[j].blend : L.blend', 'blend: null']] },
  { id: 'M18 the weight inversion is wrong (z = y, no Newton polish)', pattern: 'row 1b', edits: [[C + 'adapter.js', 'let z = 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3);', 'let z = y;'], [C + 'adapter.js', 'for (let k = 0; k < 2; k++) { const d = 6 * z', 'for (let k = 0; k < 0; k++) { const d = 6 * z']] },
  { id: 'M19 a segment where c falls does not swap the pair', pattern: 'row 1b', edits: [[C + 'adapter.js', 'const from = up ? A : B, own = up ? B : A,', 'const from = A, own = B,']] },
  { id: 'M20 a width change is not a chord: the run keeps the start width', pattern: 'row 1b', edits: [[C + 'adapter.js', 'chord = Math.abs(E[j + 1].w - wRun) > wTol(wRun);', 'chord = false;']] },
  // the readers of segment.profile (D190 R1): each must evaluate the blend
  { id: 'M33 (R1) atSegment ignores the distance into the segment', file: 'readers', pattern: 'atSegment', edits: [[R + 'geom/profile.js', 'smoothstep((seg.blend.s0 + d) / seg.blend.length);\n  return w >= 1', 'smoothstep((seg.blend.s0) / seg.blend.length);\n  return w >= 1']] },
  { id: 'M34 (R1) the marker layout reads segment.profile', file: 'readers', pattern: 'marker layout', edits: [[R + 'markers/layout.js', 'const floorOf = (x) => Math.min(floorHalf(Prof.readAt(x, 0)), floorHalf(Prof.readAt(x, x.length / 2)), floorHalf(Prof.readAt(x, x.length)));', 'const floorOf = (x) => floorHalf(Prof.normalize(x.profile));']] },
  { id: 'M35 (R1) validation reads segment.profile', file: 'readers', pattern: 'validation', edits: [[R + 'validate/index.js', 'return P.readsBlend(g) && g.blend ? constOf(P.atSegment(g, p.s - segS0[p.seg])) : segConst(p.seg); };', 'return segConst(p.seg); };']] },
  { id: 'M36 (R1) the export sections read segment.profile', file: 'readers', pattern: 'export sections', edits: [[R + 'export/fromwords.js', 'const P = Prof.readAt(g, sm.s - segS0[sm.seg]), r = P.u[0]', 'const P = Prof.normalize(g.profile), r = P.u[0]']] },
  { id: 'M37 (R1) the water reads segment.profile', file: 'readers', pattern: 'water', app: 'core/coreshell.js', edits: [['app/core/coreshell.js', 'return (m) => { const g = segments[m.seg]; return Prof.readsBlend(g) && g.blend ? Prof.atSegment(g, m.s - starts[m.seg]) : g.profile; };', 'return (m) => segments[m.seg].profile;']] },
  { id: 'M38 (R1) the camera\'s span reads segment.profile', file: 'readers', pattern: 'camera', app: 'preview/preview.js', edits: [['app/preview/preview.js', 'return spanOf(readAt(segments[i], segments[i].length));', 'return spanOf(normalize(segments[i].profile));']] },
  { id: 'M39 (R1) the readers evaluate a word document font-transition blend too (its validation and layout change)', file: 'readers', pattern: 'font-transition', edits: [['geom/profile.js', 'return readsBlend(seg) ? atSegment(seg, d) : normalize(seg.profile);', 'return atSegment(seg, d);']] },
  { id: 'M40 (R1) the adapter does not mark a cup segment (the readers then take its target for the whole segment)', file: 'readers', pattern: 'validation', edits: [['core/adapter.js', ': { cup: true }) : L.chord ? { chord: true } : {})', ': {}) : L.chord ? { chord: true } : {})']] },
  // R3: the cup -> legacy lap seam (round 3)
  { id: 'M41 (R3) no reverse morph: a cup that closes onto a legacy start is drawn to its own shape', file: 'seam', pattern: 'R3', edits: [[C + 'adapter.js', 'const nr = tail ? tailZone(P, n, E, s, tail, out, j) : n;', 'const nr = n;']] },
  { id: 'M42 (R3) the reverse morph never fades in (the tail keeps the cup shape)', file: 'seam', pattern: 'R3', edits: [[C + 'adapter.js', 'mu = (x) => smooth((x - a0) / Lz);', 'mu = (x) => 0;']] },
  { id: 'M43 (R3) the reverse morph carries no difference (the legacy shape is dropped)', file: 'seam', pattern: 'R3', edits: [[C + 'adapter.js', 'u: cw.u.map((x, i) => x + m * du[i]), psi: cw.psi.map((x, i) => x + m * dpsi[i])', 'u: cw.u, psi: cw.psi']] },
  { id: 'M44 (R3) close() does not hold the cup at the legacy start edge', file: 'seam', pattern: 'R3', edits: [[C + 'close.js', 'if (!!F.cup === !!L.cup) return null;', 'return null;']] },
  { id: 'M45 (R3) close() never refuses a seam it cannot fade', file: 'seam', pattern: 'R3', edits: [[C + 'close.js', 'if (lap && lap.m > SEAM_MAX_M) throw', 'if (false) throw']] },
  { id: 'M47 (R3) the mirror: a cup START does not fade out of the legacy END', file: 'seam', pattern: 'R3', edits: [[C + 'adapter.js', 'if (seam && pi === firstRoad && P.cup) join =', 'if (false) join =']] },
  { id: 'M50 (R3) a cup followed by a legacy piece inside the track is not faded (only the lap seam is)', file: 'seam', pattern: 'R3', edits: [[C + 'adapter.js', "nextP && nextP.type === 'road' && !nextP.cup ? legacyFirst(nextP) : seam", 'false ? 0 : seam']] },
  { id: 'M48 (R3) validation does not red a joint step', file: 'seam', pattern: 'R3', edits: [['validate/index.js', "if (jointStep.has(j)) raw.segReds.push", "if (false) raw.segReds.push"]] },
  { id: 'M49 (R3) jointSteps ignores the lap seam', file: 'seam', pattern: 'R3', edits: [['geom/profile.js', 'if (closed && segments.length > 1 && road(a)', 'if (false && segments.length > 1 && road(a)']] },
  // row 5: legacy stays legacy
  { id: 'M21 a legacy piece is rendered as a cup piece at c = 0', pattern: 'row 5', edits: [[C + 'adapter.js', 'cup[j].profile : L.profile;   // a legacy piece', 'cup[j].profile : cupProfile(P.family, mid.w, mid.c);   // a legacy piece']] },
  { id: 'M22 a /2 piece is read as a cup piece', pattern: 'row 5', edits: [[C + 'document.js', "...(has('c') ? { cup: true } : {}),", 'cup: true,']] },
  { id: 'M23 a legacy piece\'s text carries a c array', pattern: 'row 5', edits: [[C + 'document.js', 'CHANNELS.filter((ch) => !OPTIONAL[ch] || P[OPTIONAL[ch]]).map(', 'CHANNELS.map(']] },
  { id: 'M24 (K5-2) the schema is still core/2', pattern: 'row 5', edits: [[C + 'document.js', "const SCHEMA = 't180b.core/4',", "const SCHEMA = 't180b.core/2',"]] },
  { id: 'M25 a cup brush is allowed to reach a legacy piece', pattern: 'row 5e', edits: [[C + 'sculpt.js', "if (channel === 'c' && !P.cup) throw new D.CoreError('NOT_CUP'", "if (false) throw new D.CoreError('NOT_CUP'"]] },
  // row 6: cup then roll
  { id: 'M26 (K6-3) the cup feeds the roll', pattern: 'row 6', edits: [[C + 'adapter.js', 'roll0: a.phi, roll1: b.phi, heartline: 0, profile, blend: cup', 'roll0: a.phi + a.c * 1e-3, roll1: b.phi + b.c * 1e-3, heartline: 0, profile, blend: cup']] },
  // row 7: the readout
  { id: 'M27 (K7-1) cupToDeg reads the wrong station of the document', pattern: 'row 7', edits: [[C + 'readout.js', "cupToDeg: P.tube ? D.channelAt(P, 't', P.length).v / 2 : P.cup ? D.channelAt(P, 'c', P.length).v", "cupToDeg: P.tube ? D.channelAt(P, 't', P.length).v / 2 : P.cup ? D.channelAt(P, 'c', P.length * 0.5).v"]] },
  { id: 'M28 (K7-2) a legacy piece reads the nominal edge (w and r ignored)', pattern: 'row 7', edits: [[C + 'readout.js', "D.legacyEdgeDeg(P.family, D.channelAt(P, 'w', 0).v, D.channelAt(P, 'r', 0).v)", 'D.legacyEdgeDeg(P.family, 1e9, 1e9)']] },
];

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-cup-mut-'));
  for (const d of ['src', 'tools', 'app']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true, filter: (p) => !/[\\/]app[\\/]test([\\/]|$)/.test(p) });
  fs.mkdirSync(path.join(dir, 'test')); for (const t of ['core_cup.test.js', 'core_cup_readers.test.js', 'core_cup_seam.test.js']) fs.copyFileSync(path.join(__dirname, t), path.join(dir, 'test', t));
  return dir;
}
function runTests(dir, pattern, file = 'core_cup.test.js') {
  const args = ['--max-old-space-size=4096', '--test', ...(pattern ? ['--test-name-pattern', pattern] : []), path.join(dir, 'test', file)];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the whole of core_cup.test.js and core_cup_readers.test.js pass on an unmutated copy of src/, tools/ and app/', () => {
  const dir = tree();
  try { for (const f of ['core_cup.test.js', 'core_cup_readers.test.js', 'core_cup_seam.test.js']) { const r = runTests(dir, undefined, f); assert.ok(r.tests > 5 && r.fail === 0, `${f}: tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
      const r = runTests(dir, m.pattern, m.file === 'readers' ? 'core_cup_readers.test.js' : m.file === 'seam' ? 'core_cup_seam.test.js' : 'core_cup.test.js');
      t.diagnostic(`${m.id}: ${r.fail} of ${r.tests - r.skipped} run tests failed`);
      assert.ok(r.tests - r.skipped > 0, `the pattern "${m.pattern}" ran no test`);
      assert.ok(r.fail > 0, `NOT CAUGHT: ${r.pass} pass, 0 fail with the pattern "${m.pattern}"`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
module.exports = { MUTANTS };
