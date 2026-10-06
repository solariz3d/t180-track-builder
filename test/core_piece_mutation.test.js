// core_piece_mutation.test.js: node --test test/core_piece_mutation.test.js   (under the heavy-run lock, --max-old-space-size=4096, --test-concurrency=1; several minutes)
// D240: each mutant changes src/core/piece.js in ONE way (one exact string replacement, in a temporary copy of src/, tools/ and app/), and test/core_piece.test.js runs against the copy.
// "Applied" means the replaced string occurs EXACTLY once; "caught" means at least one test FAILED on the mutant. The CONTROL runs the whole file on an unmutated copy first, so a copy
// that is missing a file cannot make every mutant look caught (the lesson of D236: a mutant caught over a red control is no result).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const X = 'core/piece.js';

const MUTANTS = [
  // save
  { id: 'P1 a run of one piece is a run of two (to defaults to from + 1)', pattern: 'row 9|row 1b', edits: [[X, 'function saveRun(doc, from, to = from, { name } = {}) {', 'function saveRun(doc, from, to = from + 1, { name } = {}) {']] },
  { id: 'P2 a run that ends before it starts is accepted', pattern: 'row 9', edits: [[X, 'from < 0 || to >= doc.pieces.length || to < from)', 'from < 0 || to >= doc.pieces.length)']] },
  { id: 'P3 a run past the end of the track is accepted', pattern: 'row 9', edits: [[X, 'from < 0 || to >= doc.pieces.length || to < from)', 'from < 0 || to < from)']] },
  { id: 'P4 a run of flights alone is saved', pattern: 'row 6', edits: [[X, "if (!roads.length) throw err('NO_ROAD', 'a run of flights alone", "if (false) throw err('NO_ROAD', 'a run of flights alone"]] },
  { id: 'P5 a mixed run is saved', pattern: 'row 8b', edits: [[X, 'if (roads.some((P) => signature(P) !== sig)) throw err(\'MIXED_RUN\', `the run mixes', 'if (false) throw err(\'MIXED_RUN\', `the run mixes']] },
  { id: 'P6 the start is taken from the last road, not the first', pattern: 'row 1', edits: [[X, 'const first = roads[0], start = {};', 'const first = roads[roads.length - 1], start = {};']] },
  { id: 'P7 a state is stored absolute, not as its change', pattern: 'row 1|row 2 ', edits: [[X, 'channels[ch] = STATE.includes(ch) ? P.channels[ch].map((v) => q(v - start[ch], D.DEC[ch])) : P.channels[ch].slice(); }', 'channels[ch] = P.channels[ch].slice(); }']] },
  { id: 'P8 a rate is stored as a change too (relative to its first point)', pattern: 'row 1', edits: [[X, 'channels[ch] = STATE.includes(ch) ? P.channels[ch].map((v) => q(v - start[ch], D.DEC[ch])) : P.channels[ch].slice(); }', 'channels[ch] = P.channels[ch].map((v) => q(v - P.channels[ch][0], D.DEC[ch])); }']] },
  // (P9, "the saved change is not rounded to its channel step", is EQUIVALENT and is not run: saveRun returns checkPiece's OUTPUT, which quantises every
  //  channel by D.DEC as it enters, so the dropped q is applied there anyway; q of a value already on its grid is that value. A and C, D240 core.)
  // absolute
  { id: 'P10 a state is put back without rounding (float noise comes back)', pattern: 'row 1|row 2 ', edits: [[X, 'c.map((v) => q(v + base, D.DEC[ch])) : c.slice();', 'c.map((v) => v + base) : c.slice();']] },
  { id: 'P11 a shifted run still uses its own start (the shift is ignored)', pattern: 'row 3', edits: [[X, 'const base = STATE.includes(ch) ? (shifts ? shifts[ch] : piece.start[ch]) : 0;', 'const base = STATE.includes(ch) ? piece.start[ch] : 0;']] },
  { id: 'P12 the unused optional channels are not given their defaults', pattern: 'row 1|row 2 ', edits: [[X, 'for (const ch of Object.keys(D.OPTIONAL)) if (!P[D.OPTIONAL[ch]]) channels[ch] = new Array(P.knots.length + 4).fill(D.OPT_DEFAULT[ch]);', '']] },
  // (P13, "a state is also shifted for a rate", is EQUIVALENT and is not run: continued() builds `shifts` from STATE channels only, so a rate's base is
  //  always 0, and q(v + 0) of a checked, already-quantised rate is v; mirrored() writes 0, never -0, so even Object.is cannot tell. A and C, D240 core.)
  // checkPiece
  { id: 'P14 any schema is accepted', pattern: 'row 8', edits: [[X, 'if (piece.schema !== SCHEMA) bad(', 'if (false) bad(']] },
  { id: 'P15 an unknown top-level field is dropped, not refused', pattern: 'row 8', edits: [[X, 'for (const k of Object.keys(piece)) if (!TOP_KEYS.includes(k)) bad(', 'for (const k of []) if (!TOP_KEYS.includes(k)) bad(']] },
  { id: 'P16 a name with a path in it is accepted', pattern: 'row 8|row 9', edits: [[X, 'const checkName = (name) => { if (typeof name !== \'string\' || !NAME_RE.test(name)) throw', 'const checkName = (name) => { if (typeof name !== \'string\') throw']] },
  { id: 'P17 a run of any length is accepted', pattern: 'row 9', edits: [[X, '|| piece.pieces.length > MAX_PIECES) bad(', ') bad(']] },
  { id: 'P18 a missing start is accepted', pattern: 'row 8', edits: [[X, "if (!piece.start || typeof piece.start !== 'object' || Array.isArray(piece.start)) bad('BAD_PIECE_START'", "if (false) bad('BAD_PIECE_START'"]] },
  { id: 'P19 a first piece whose change does not start at 0 is accepted', pattern: 'row 8', edits: [[X, 'if (STATE.includes(ch) && channels[ch][0] !== 0 && roads[0] === P)', 'if (false)']] },
  { id: 'P20 knots out of order are accepted', pattern: 'row 8', edits: [[X, '|| (k && !(t > knots[k - 1])))) bad(', ')) bad(']] },
  { id: 'P21 knots outside the piece are accepted', pattern: 'row 8', edits: [[X, 'if (knots.some((t, k) => !(t > 0 && t < length) ||', 'if (knots.some((t, k) => false ||']] },
  { id: 'P22 a channel of the wrong length is accepted', pattern: 'row 8', edits: [[X, 'if (!Array.isArray(c) || c.length !== knots.length + 4) bad(', 'if (!Array.isArray(c)) bad(']] },
  { id: 'P23 a control point that is not a number is accepted', pattern: 'row 8', edits: [[X, 'if (!c.every(isNum)) bad(', 'if (false) bad(']] },
  { id: 'P24 a piece that is a cup and a tube is accepted', pattern: 'row 8', edits: [[X, 'if (f.cup && f.tube) bad(', 'if (false) bad(']] },
  { id: 'P25 an edge piece may carry e without s', pattern: 'row 8', edits: [[X, 'if ((P.channels.e === undefined) !== (P.channels.s === undefined)) bad(', 'if (false) bad(']] },
  { id: 'P26 a mixed run in a file is accepted', pattern: 'row 8', edits: [[X, "if (out.pieces.filter(isRoad).some((P) => signature(P) !== sig)) bad('MIXED_RUN'", "if (false) bad('MIXED_RUN'"]] },
  { id: 'P27 a start key the run does not carry is accepted', pattern: 'row 8', edits: [[X, 'for (const k of Object.keys(piece.start)) if (!want.includes(k)) bad(', 'for (const k of []) if (!want.includes(k)) bad(']] },
  { id: 'P28 the document\'s own check of the run is skipped (a broken joint, a cup past its limit)', pattern: 'row 8', edits: [[X, "D.checkDoc({ ...D.createDoc('piece check'), nextId: run.length + 1, pieces: run });", '']] },   // re-anchored: C's D240 F1 (c775694) made the per-piece appendPiece loop one checkDoc
  { id: 'P29 a flight with no gap is accepted', pattern: 'row 8', edits: [[X, 'if (!(P.gap > 0)) bad(', 'if (false) bad(']] },
  { id: 'P30 a run with no road is accepted', pattern: 'row 8', edits: [[X, "if (!roads.length) bad('NO_ROAD', 'a run needs at least one road piece');", '']] },
  { id: 'P31 numbers are not quantised as they enter', pattern: 'row 8c', edits: [[X, 'channels[ch] = c.map((v) => q(v, D.DEC[ch]));', 'channels[ch] = c.slice();']] },
  // text
  { id: 'P32 a file of any size is read', pattern: 'row 8', edits: [[X, 'if (text.length > MAX_CHARS) throw', 'if (false) throw']] },
  { id: 'P33 a text that is not JSON throws something else', pattern: 'row 8', edits: [[X, "try { o = JSON.parse(text); } catch (e) { throw err('BAD_PIECE_JSON', e.message); }", "try { o = JSON.parse(text); } catch (e) { throw e; }"]] },
  { id: 'P34 the canonical text lists the pieces before the start', pattern: 'row 1b', edits: [[X, "const head = [`  \"schema\": ${JSON.stringify(SCHEMA)}`, `  \"generator\": ${JSON.stringify(GENERATOR)}`, `  \"name\": ${JSON.stringify(p.name)}`, `  \"start\": ${JSON.stringify(start)}`];", "const head = [`  \"schema\": ${JSON.stringify(SCHEMA)}`, `  \"name\": ${JSON.stringify(p.name)}`, `  \"generator\": ${JSON.stringify(GENERATOR)}`, `  \"start\": ${JSON.stringify(start)}`];"]] },
  { id: 'P35 a parsed piece is not frozen', pattern: 'row 1b', edits: [[X, 'return freeze(checkPiece(o));\n}', 'return checkPiece(o);\n}']] },
  // mirror
  { id: 'P36 a mirror does not turn the other way (kh)', pattern: 'row 5|row 9', edits: [[X, "const NEGATED = Object.freeze(['kh', 'phi', 'l']);", "const NEGATED = Object.freeze(['phi', 'l']);"]] },
  { id: 'P37 a mirror does not flip the bank', pattern: 'row 5', edits: [[X, "const NEGATED = Object.freeze(['kh', 'phi', 'l']);", "const NEGATED = Object.freeze(['kh', 'l']);"]] },
  { id: 'P38 a mirror does not flip the swerve', pattern: 'row 5', edits: [[X, "const NEGATED = Object.freeze(['kh', 'phi', 'l']);", "const NEGATED = Object.freeze(['kh', 'phi']);"]] },
  { id: 'P39 a mirror flips the climb too', pattern: 'row 5', edits: [[X, "const NEGATED = Object.freeze(['kh', 'phi', 'l']);", "const NEGATED = Object.freeze(['kh', 'kv', 'phi', 'l']);"]] },
  { id: 'P40 a mirror flips the hill too', pattern: 'row 5', edits: [[X, "const NEGATED = Object.freeze(['kh', 'phi', 'l']);", "const NEGATED = Object.freeze(['kh', 'phi', 'l', 'h']);"]] },
  { id: 'P41 a mirror leaves the start bank as it was', pattern: 'row 5|row 2 ', edits: [[X, 'if (start.phi !== undefined) start.phi = start.phi === 0 ? 0 : -start.phi;', '']] },
  // insert
  { id: 'P42 a run that already joins the head is recomputed, not added as saved', pattern: 'row 2 ', edits: [[X, 'try { return add(absolute(p)); } catch (e) { if (e.code !== \'JOINT\') throw e; }   // already joins the head', 'try { throw err(\'JOINT\', \'x\'); } catch (e) { if (e.code !== \'JOINT\') throw e; }   // already joins the head']] },
  { id: 'P43 every failure of the as-saved try falls through to the continuation, not only a joint', pattern: 'row 4b|row 4c|row 7', edits: [[X, "catch (e) { if (e.code !== 'JOINT') throw e; }   // already joins the head", "catch (e) { /* any failure */ }   // already joins the head"]] },
  { id: 'P44 a legacy run after a cup or a tube is not refused by name', pattern: 'row 4b', edits: [[X, "if (D.kindOf(first) === 'legacy' && D.endKind(doc) !== 'legacy') throw err('PIECE_KIND'", "if (false) throw err('PIECE_KIND'"]] },
  { id: 'P45 keepStart on a head it does not meet says something else', pattern: 'row 4', edits: [[X, "throw err('PIECE_START',", "throw err('JOINT',"]] },
  { id: 'P46 keepStart is ignored (the run continues from the head anyway)', pattern: 'row 4', edits: [[X, 'if (keepStart) { try {', 'if (false) { try {']] },
  { id: 'P47 the slope of the joint is the head\'s over a half span, not a third', pattern: 'row 3', edits: [[X, 'const { v, m } = at(ch), c = first.channels[ch]; c[0] = q(v, D.DEC[ch]); c[1] = q(v + (m * h1) / 3, D.DEC[ch]);', 'const { v, m } = at(ch), c = first.channels[ch]; c[0] = q(v, D.DEC[ch]); c[1] = q(v + (m * h1) / 2, D.DEC[ch]);']] },
  { id: 'P48 the joint takes the head\'s value only (no slope)', pattern: 'row 3', edits: [[X, 'const { v, m } = at(ch), c = first.channels[ch]; c[0] = q(v, D.DEC[ch]); c[1] = q(v + (m * h1) / 3, D.DEC[ch]);', 'const { v, m } = at(ch), c = first.channels[ch]; c[0] = q(v, D.DEC[ch]); c[1] = q(v + c[1] - c[0] + 0 * m * h1, D.DEC[ch]);']] },
  { id: 'P49 a jump before the road does not zero the turn, climb and offsets', pattern: 'row 6', edits: [[X, 'const want = after ? { ...head, kh: { v: 0, m: 0 }, kv: { v: 0, m: 0 }, h: { v: 0, m: 0 }, l: { v: 0, m: 0 } } : head;', 'const want = head;']] },
  { id: 'P50 a tube after another kind starts from the head\'s t (0), not tNext', pattern: 'row 3c', edits: [[X, "const at = (ch) => (ch === 't' ? want.tNext : want[ch]);", 'const at = (ch) => want[ch];']] },
  { id: 'P51 the road after a leading jump is not what carries the head on', pattern: 'row 6', edits: [[X, 'const i0 = p.pieces.findIndex(isRoad), after = i0 > 0;', 'const i0 = 0, after = false;']] },
  { id: 'P52 the joint values are taken from the saved start, not the head', pattern: 'row 3', edits: [[X, 'const { v, m } = at(ch), c = first.channels[ch]; c[0] = q(v, D.DEC[ch]);', 'const { v, m } = at(ch), c = first.channels[ch]; c[0] = q(c[0], D.DEC[ch]);']] },
  // delete
  { id: "D1 a closed track can be deleted from", pattern: "row 10", edits: [[X, "if (doc.closed) throw err('CLOSED', 'a closed track has no open end; open it first');\n  const n = doc.pieces.length;", "const n = doc.pieces.length;"]] },
  { id: "D2 a range one past the end is accepted", pattern: "row 10", edits: [[X, 'from < 0 || to < from || to >= n) throw err(\'BAD_RANGE\'', 'from < 0 || to < from || to > n) throw err(\'BAD_RANGE\'']] },
  { id: "D3 a negative start is accepted", pattern: "row 10", edits: [[X, 'from < 0 || to < from || to >= n) throw err(\'BAD_RANGE\'', 'to < from || to >= n) throw err(\'BAD_RANGE\'']] },
  { id: "D4 a fractional start is accepted", pattern: "row 10", edits: [[X, 'if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= n)', 'if (!Number.isInteger(to) || from < 0 || to < from || to >= n)']] },
  { id: "D5 the near side keeps one piece too many", pattern: "row 10", edits: [[X, 'const near = doc.pieces.slice(0, from), far', 'const near = doc.pieces.slice(0, from + 1), far']] },
  { id: "D6 the far side keeps one piece too many", pattern: "row 10", edits: [[X, 'far = doc.pieces.slice(to + 1), make', 'far = doc.pieces.slice(to), make']] },
  { id: "D7 the sides are never tried as they are", pattern: "row 10", edits: [[X, 'try { return make([...near, ...far]); } catch', 'try { throw new D.CoreError(\'X\', \'x\'); } catch']] },
  { id: "D8 the re-join carries no slope", pattern: "row 10", edits: [[X, 'c[0] = q(v, D.DEC[ch]); c[1] = q(v + (m * h1) / 3, D.DEC[ch]);\n    }\n    try { return make([...near, first', 'c[0] = q(v, D.DEC[ch]); c[1] = q(v, D.DEC[ch]);\n    }\n    try { return make([...near, first']] },
  { id: "D9 a tube after another kind is joined at the head's own sweep, not tNext", pattern: "row 10", edits: [[X, "ch === 't' ? head.tNext : head[ch], c = first.channels[ch];", "head[ch], c = first.channels[ch];"]] },
  { id: "D10 the id counter is wound back", pattern: "row 10", edits: [[X, 'make = (pieces) => freeze(D.checkDoc({ ...doc, pieces }))', 'make = (pieces) => freeze(D.checkDoc({ ...doc, nextId: pieces.length + 1, pieces }))']] },
  { id: "D11 a jump first is tried for a re-join", pattern: "row 10", edits: [[X, 'if (isRoad(far[0]) && head) {', 'if (head) {']] },
  { id: "D12 the re-join also resets the second-from-last control point (reshapes the far piece)", pattern: "row 10", edits: [[X, 'c[0] = q(v, D.DEC[ch]); c[1] = q(v + (m * h1) / 3, D.DEC[ch]);\n    }\n    try { return make([...near, first', 'c[0] = q(v, D.DEC[ch]); c[1] = q(v + (m * h1) / 3, D.DEC[ch]); c[2] = q(v + (m * h1) / 3, D.DEC[ch]);\n    }\n    try { return make([...near, first']] },
  { id: "D13 a refusal does not say nothing was deleted", pattern: "row 10", edits: [[X, 'so nothing was deleted: ', '']] },
  { id: "D14 the result is not frozen", pattern: "row 10", edits: [[X, 'make = (pieces) => freeze(D.checkDoc({ ...doc, pieces }))', 'make = (pieces) => D.checkDoc({ ...doc, pieces })']] },
  // summary
  { id: 'P53 the turn is the integral of the climb', pattern: 'row 9', edits: [[X, "turnDeg: RAD * roads.reduce((a, P) => a + integral(P, 'kh'), 0)", "turnDeg: RAD * roads.reduce((a, P) => a + integral(P, 'kv'), 0)"]] },
  { id: 'P54 the integral\'s weights are wrong', pattern: 'row 9', edits: [[X, '[[-Math.sqrt(0.6), 5 / 9], [0, 8 / 9], [Math.sqrt(0.6), 5 / 9]]', '[[-Math.sqrt(0.6), 1 / 3], [0, 1 / 3], [Math.sqrt(0.6), 1 / 3]]']] },
];

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180-piece-mut-'));
  for (const d of ['src', 'tools', 'app']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true, filter: (s) => !/[\\/]node_modules[\\/]|[\\/]target[\\/]/.test(s) });
  fs.mkdirSync(path.join(dir, 'test')); fs.copyFileSync(path.join(__dirname, 'core_piece.test.js'), path.join(dir, 'test', 'core_piece.test.js'));
  return dir;
}
function runTests(dir, pattern) {
  const args = ['--max-old-space-size=4096', '--test', '--test-concurrency=1', ...(pattern ? ['--test-name-pattern', pattern] : []), path.join(dir, 'test', 'core_piece.test.js')];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), out };
}
test('CONTROL: the whole of core_piece.test.js passes on an unmutated copy of src/, tools/ and app/', () => {
  const dir = tree();
  try { const r = runTests(dir); assert.ok(r.tests > 15 && r.fail === 0, `tests ${r.tests}, fail ${r.fail}\n${r.out.slice(-1500)}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const m of MUTANTS.filter((x) => !process.env.PM_ONLY || new RegExp(process.env.PM_ONLY).test(x.id.split(' ')[0]))) {
  test(`mutant ${m.id}: applied, and caught by "${m.pattern}"`, () => {
    const dir = tree();
    try {
      for (const [file, from, to] of m.edits) {
        const f = path.join(dir, 'src', file), src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), n = src.split(from).length - 1;
        assert.equal(n, 1, `NOT APPLIED: the string occurs ${n} times in src/${file}: ${from.slice(0, 90)}`);
        fs.writeFileSync(f, src.replace(from, () => to));
      }
      const r = runTests(dir, m.pattern);
      assert.ok(r.tests > 0, `the pattern "${m.pattern}" ran no test`);
      assert.ok(r.fail > 0, `NOT CAUGHT: ${r.tests} tests ran under "${m.pattern}" on the mutant and all passed`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
