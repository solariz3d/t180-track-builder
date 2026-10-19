// core_edgeneg.test.js: node --test test/core_edgeneg.test.js
// D406, negative edge angles (the keeper, 2026-10-18: "the left and right edge value, it should be able to go into the negatives, meaning the track curves
// down tweaking the banking on one side to be closer to flat or even past it"). e and er may go below 0: the outer zone turns DOWN by that angle against the
// profile. Each side's TOTAL edge angle (the profile's own at the rim plus e or er) has a floor of -30° (src/core/document.js EDGE_FLOOR). Rows:
//   1  a negative left edge on a banked turn turns the left rim down by that angle, and the right rim stays the profile's
//   2  the floor: a total of -30° is accepted and -30.01° refused by name, on a flat cup (c 0) and on a cup of 10° (e -40 and -40.01); a hand-built
//      document past it is refused by checkDoc too
//   3  a symmetric negative edge: both rims turn down alike, the text carries no er, and it round-trips
//   4  core/6 is written exactly when a negative edge appears (a positive split stays core/5, a plain edge core/4); the builder of 0.4.7 refuses a core/6
//      file by name, and this one refuses the next (core/7)
//   5  every file made before reads and saves byte for byte: the fixtures and core/4 and core/5 documents (edge, split, cup, tube) written by this builder
//      equal what the 0.4.7 builder writes; a fit between two positive edges never rings below 0 (so it stays core/4)
//   5b a fit down to an edge of 0 never rings below 0, though the raw fit ends a hair under it (the shape of core_piece.test.js row 8b)
//   5c a side brought back from below 0 to 0 by a numeric transition lands at 0 with slope 0 (E's review §4)
//   5d a negative side that only carries on while the floor rises under it is lifted to the floor, not refused (E's short read §3)
//   6  the edge is sampled by the steeper side counted by its size: an edge of -60° gets as many samples as one of +60° (on a cup of 60°)
//   7  the piece after a negative edge continues each side from it with no step at the joint, and stays an edge piece
//   8  the panel: a typed negative edge reaches the core as that target, on its side only
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), Module = require('module'), { execFileSync } = require('child_process');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const AD = require('../src/core/adapter.js');
const PR = require('../src/geom/profile.js');
const { extendOptions } = require('../app/core/panel.js');

const DEG = Math.PI / 180, REPO = path.join(__dirname, '..');
const cup = (c) => extend(D.createDoc('t'), { length: 200, family: 'bowl', first: { c } });
const lastProfile = (d) => AD.toSegments(d).slice(-1)[0].profile;
const rims = (d) => { const p = lastProfile(d); return { right: p.psi[0] / DEG, left: p.psi[p.psi.length - 1] / DEG }; };
const schemaOf = (d) => JSON.parse(D.serialize(d)).schema;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a}, not ${b}`);

// the document module of the 0.4.7 builder, compiled from git at its own path (so its requires resolve), never written to disk; null where git or the tag is missing
const OLD = (() => {
  let text; try { text = execFileSync('git', ['show', 'v0.4.7:src/core/document.js'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; }
  const file = path.join(REPO, 'src', 'core', 'document.js'), m = new Module(file, module);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(text, file);
  return m.exports;
})();
const needOld = OLD ? false : 'the 0.4.7 builder is not readable here (git show v0.4.7:src/core/document.js failed)';

test('row 1: a negative left edge on a banked turn turns the left rim down by that angle, and the right rim stays the profile\'s', () => {
  const d = extend(cup(10), { length: 200, targets: { e: -20, er: 0, kh: 1 / 300, phi: 20 * DEG } }), r = rims(d);
  near(r.left, 10 - 20, 1e-6, 'the left rim at the cup\'s 10° turned down 20°');
  near(r.right, 10, 1e-6, 'the right rim at the cup\'s own 10°');
  // the section itself: the left outer zone drops below where the plain profile puts it, and the right side is the plain profile's, point for point
  const plain = lastProfile(extend(cup(10), { length: 200, targets: { e: 0, er: 0, kh: 1 / 300, phi: 20 * DEG } })), neg = lastProfile(d);
  const rimUp = (p) => PR.offsetAt(p, p.u[p.u.length - 1])[1];   // the left rim's height in the station frame (src/geom/profile.js: Y = ∫ sin ψ du)
  assert.ok(rimUp(neg) < rimUp(plain) - 0.1, `the left rim is lower than the plain one (${rimUp(neg)} m against ${rimUp(plain)} m)`);
  const right = (p) => p.u.map((u, i) => [u, p.psi[i]]).filter(([u]) => u <= 0);
  assert.deepEqual(right(neg).map(([, v]) => +v.toFixed(12)), right(plain).map(([, v]) => +v.toFixed(12)), 'the right half is the plain profile');
});

test('row 2: the floor is a total of -30°: -30 accepted and -30.01 refused by name, on a flat cup and on a cup of 10°; checkDoc refuses a hand-built one', () => {
  for (const [c, ok, bad] of [[0, -30, -30.01], [10, -40, -40.01]]) {
    const d = extend(cup(c), { length: 200, targets: { e: ok, er: 0 } });
    near(rims(d).left, -30, 1e-6, `cup ${c}°, e ${ok}: the left rim at the floor`);
    assert.throws(() => extend(cup(c), { length: 200, targets: { e: bad, er: 0 } }), (e) => e.code === 'BAD_EDGE' && /floor/.test(e.message) && /-30/.test(e.message), `cup ${c}°, e ${bad}`);
    assert.throws(() => extend(cup(c), { length: 200, targets: { e: 0, er: bad } }), (e) => e.code === 'BAD_EDGE' && /right edge/.test(e.message) && /floor/.test(e.message), `cup ${c}°, er ${bad}`);
  }
  // by hand: a document at the floor passes checkDoc; the same document with its last two control points a hundredth past it (the joint at the start untouched) is refused
  const d = extend(cup(0), { length: 200, targets: { e: -30, er: 0 } }), P = d.pieces[1], n = P.channels.e.length;
  D.checkDoc(d);
  const hand = { ...d, pieces: d.pieces.map((x, i) => (i === 1 ? { ...x, channels: { ...x.channels, e: P.channels.e.map((v, j) => (j >= n - 2 ? -30.01 : v)) } } : x)) };
  assert.throws(() => D.checkDoc(hand), (e) => e.code === 'BAD_EDGE' && /floor/.test(e.message));
});

test('row 3: a symmetric negative edge turns both rims down alike, writes no er, and round-trips', () => {
  const d = extend(cup(10), { length: 200, targets: { e: -15 } }), r = rims(d), text = D.serialize(d);
  near(r.left, -5, 1e-6, 'left rim'); near(r.right, -5, 1e-6, 'right rim');
  assert.equal(D.isSplit(d.pieces[1]), false); assert.ok(!text.includes('"er"'), 'no er in the text');
  assert.equal(JSON.parse(text).schema, 't180b.core/6');
  assert.equal(D.serialize(D.parse(text)), text);
});

test('row 4: core/6 exactly when a negative edge appears; the 0.4.7 builder refuses it by name, and this one the next', { skip: needOld }, () => {
  assert.equal(schemaOf(extend(cup(10), { length: 200, targets: { e: 20 } })), 't180b.core/4', 'a plain edge');
  assert.equal(schemaOf(extend(cup(10), { length: 200, targets: { e: 20, er: 0 } })), 't180b.core/5', 'a positive split');
  const neg = extend(extend(cup(10), { length: 200, targets: { e: 0, er: -5 } }), { length: 200, targets: { e: 0, er: 0 } }), text = D.serialize(neg);
  assert.equal(JSON.parse(text).schema, 't180b.core/6', 'one negative piece anywhere makes the file core/6');
  assert.throws(() => OLD.parse(text), (e) => e.code === 'BAD_DOC' && /a newer file needs a newer builder/.test(e.message) && /core\/6/.test(e.message), 'the 0.4.7 builder refuses it by name');
  assert.throws(() => D.parse(text.replace('t180b.core/6', 't180b.core/7')), (e) => e.code === 'BAD_DOC' && /a newer file needs a newer builder/.test(e.message));
  assert.equal(D.serialize(D.parse(text)), text, 'and it round-trips');
});

test('row 5: every file made before reads and saves byte for byte, as the 0.4.7 builder writes it; a fit between positive edges never rings below 0', { skip: needOld }, () => {
  const fx = path.join(REPO, 'test', 'fixtures'), texts = fs.readdirSync(fx).filter((f) => /\.core\d\.json$/.test(f)).map((f) => [f, fs.readFileSync(path.join(fx, f), 'utf8')]);
  assert.ok(texts.length >= 10, `the fixtures (${texts.length})`);
  let d = extend(cup(10), { length: 200, targets: { e: 30, s: 0.7 } });
  d = extend(d, { length: 150, targets: { e: 30, er: 4 } }); d = extend(d, { length: 120, targets: { e: 0, er: 0 } });
  const tube = extend(extend(D.createDoc('tb'), { length: 120 }), { length: 150, targets: { t: 200, e: 10 } });
  const made = [['edge, split and back', D.serialize(d)], ['a tube with an edge', D.serialize(tube)], ['a plain cup', D.serialize(cup(25))]];
  assert.deepEqual(made.map(([, t]) => JSON.parse(t).schema), ['t180b.core/5', 't180b.core/4', 't180b.core/4']);
  for (const [name, t] of [...texts, ...made]) {
    const now = D.serialize(D.parse(t)), then = OLD.serialize(OLD.parse(t));
    assert.equal(now, then, `${name}: this builder writes what the 0.4.7 builder writes`);
    assert.equal(D.serialize(D.parse(now)), now, `${name}: and reads it back to the same text`);
  }
  for (const P of d.pieces.filter((x) => x.edge)) for (const ch of ['e', 'er']) assert.ok(P.channels[ch].every((v) => v >= 0), `piece ${P.id} ${ch}: ${P.channels[ch]}`);
});

test('row 5b: a fit down to an edge of 0 never rings below it, though the fit itself ends a hair under 0, so the piece after it is no edge piece', () => {
  // the shape core_piece.test.js row 8b builds: a bowl's edge of 10 brought to 0 over a short transition (the raw fit ends at -0.0069 there)
  let d = extend(D.createDoc('z'), { length: 200, family: 'bowl', first: { e: 10 } }); d = extend(d, { length: 150, transition: 60, targets: { e: 0 } });
  for (const ch of ['e', 'er']) assert.ok(d.pieces[1].channels[ch].every((v) => v >= 0), `${ch}: ${d.pieces[1].channels[ch]}`);
  assert.equal(schemaOf(d), 't180b.core/4');
  assert.ok(!extend(d, { length: 100 }).pieces[2].edge, 'the next piece is no edge piece');
});

test('row 5c: a side brought back from below 0 to 0 by a numeric transition shorter than the piece lands at 0 with slope 0, never ringing above it', () => {
  // E's D406 review §4 (exo_memory/handback/p-d406-review-E_2026-10-19.md, probe5): -45.5 -> 0 over a 40 m transition on a 60 m piece rang to +8.277 and ended at +0.670
  let d = extend(D.createDoc('t'), { length: 200, family: 'bowl', first: { c: 15.5 } });
  d = extend(d, { length: 100, transition: { e: 40, er: 40 }, targets: { e: -45.5, er: -45.5 } });
  d = extend(d, { length: 60, transition: 40, targets: { e: 0, er: 0 } });
  const P = d.pieces[d.pieces.length - 1], end = D.pieceEnd(P);
  for (const ch of ['e', 'er']) {
    assert.ok(P.channels[ch].every((v) => v <= 0), `${ch} never above 0: ${P.channels[ch]}`);
    assert.equal(end[ch].v, 0, `${ch} ends at 0`); assert.equal(end[ch].m, 0, `${ch} ends with slope 0`);
  }
  assert.ok(!extend(d, { length: 100 }).pieces[3].edge, 'the next piece is no edge piece');
});

test('row 5d: a negative side that only carries on while the floor rises under it (a cup narrowing to 0) is lifted to the floor, not refused', () => {
  // E's D406 short read §3 (exo_memory/handback/p-d406-shortread-E_2026-10-19.md, probe6): c1ddce4's ceiling (the higher asked value) sat under the rising floor
  let d = extend(D.createDoc('t'), { length: 200, family: 'bowl', first: { c: 15.5 } });
  d = extend(d, { length: 100, transition: { e: 40, er: 40 }, targets: { e: -45, er: -45 } });
  d = extend(d, { length: 100, transition: { c: 60 }, targets: { c: 0 } });
  const P = d.pieces[d.pieces.length - 1];
  for (const ch of ['e', 'er']) {
    const totals = P.channels[ch].map((v, i) => P.channels.c[i] + v);
    assert.ok(totals.every((t) => t >= D.EDGE_FLOOR - 1e-9), `${ch}: every total at or above the floor: ${totals}`);
    near(P.channels[ch][P.channels[ch].length - 1], D.EDGE_FLOOR, 1e-9, `${ch} ends lifted to the floor over a flat cup`);
  }
});

test('row 6: the edge is sampled by the steeper side counted by its size: -60° gets as many samples as +60°', () => {
  // the sampling grows only above 43° (adapter.js EDGE_MIN_N), so on a cup of 60°, where -60 takes the rim to 0, inside the floor
  const n = (e) => lastProfile(extend(cup(60), { length: 200, targets: { e: 0, er: e } })).u.length;
  assert.equal(n(-60), n(60), `samples at -60 (${n(-60)}) and at +60 (${n(60)})`);
  assert.ok(n(-60) > n(-2), 'and more than a shallow edge gets');
});

test('row 7: the piece after a negative edge continues each side from it with no step, and stays an edge piece', () => {
  let d = extend(cup(10), { length: 200, targets: { e: -20, er: 0 } });
  d = extend(d, { length: 150 });
  assert.ok(d.pieces[2].edge, 'still an edge piece: a negative side is a live edge');
  const a = D.pieceEnd(d.pieces[1]), b = D.valuesAt(d.pieces[2], 0);
  near(b.e, a.e.v, 1e-6, 'left edge across the joint'); near(b.er, a.er.v, 1e-6, 'right edge across the joint');
});

test('row 8: the panel sends a typed negative edge to the core on its side only', () => {
  const o = extendOptions({ length: '100', edge: '-12', edgeR: '' });
  assert.equal(o.targets.e, -12);
  const r = extendOptions({ length: '100', edge: '3', edgeR: '-7.5' });
  assert.equal(r.targets.e, 3); assert.equal(r.targets.er, -7.5);
});
