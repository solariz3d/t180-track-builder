// texture_ring_width.test.js: node --test test/texture_ring_width.test.js   (a few seconds; the rows on the user's own tracks read his saved files and skip without them)
// A TUBE WHOSE WIDTH CHANGES (src/texture/flow.js): the road texture flows through it with no step. mesh.js lays the across arc once per 2 m segment, the
// segment's END section, and both rows of the segment wore it, so where the section changed every coincident pair of rows at a segment boundary carried two
// different u (the user's screenshot, 2026-10-29: the stripe cut into short slanted pieces up the walls of a tube narrowing 60 -> 32 m). Now each row takes
// the arc of its own section (the first row the segment before's end, the last its own end), and a closed ring keeps ONE whole number of repeats round for
// its whole run of ring segments (from the run's median circumference), so the seam at the roof closes exactly at every row.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const crypto = require('crypto');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const { buildPath } = require('../src/geom/index.js');
const { buildMesh } = require('../src/geom/mesh.js');
const { flowUvs, closedRing } = require('../src/texture/flow.js');
const { createCoreTextures } = require('../app/core/textures.js');

const TRACKS = process.env.APPDATA ? `${process.env.APPDATA}/com.solariz3d.t180-track-builder/tracks/` : null;
const his = (name) => { const f = TRACKS && `${TRACKS}eq-${name}.t180track`; return f && fs.existsSync(f) ? D.parse(fs.readFileSync(f, 'utf8')) : null; };
function flowOf(doc) {
  const segs = A.toSegments(doc); let p = buildPath(segs, { step: 2, closed: !!doc.closed, start: { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch } });
  p = A.offsetPath(doc, segs, p);
  const mesh = buildMesh(p, segs, { selfCheck: false }), set = createCoreTextures({ segments: () => segs, kind: 'asphalt' }).current(), flow = flowUvs(mesh, segs, set);
  const kids = mesh.scene.root.children, cells = [];
  mesh.cells.forEach((c, k) => { const node = kids[k] && kids[k].children[0], u = node && flow.get(node); if (u) cells.push({ seg: c.piece, seam: !!c.seam, K: mesh._state.pieces[c.piece].K, u }); });
  return { segs, mesh, cells };
}
/** The u of row r at column k of a cell. */
const uAt = (c, r, k) => c.u[(r * c.K + k) * 2];
const rowsOf = (c) => c.u.length / 2 / c.K;
/** Over consecutive cells of the same K in segments [a, b]: the largest |u| difference between the coincident rows at a boundary (the last row of one cell,
 *  the first of the next) at the floor, a wall and the roof; the largest change within a cell at the roof. */
function boundaries(cells, a, b) {
  let jump = 0, within = 0, n = 0;
  const run = cells.filter((c) => !c.seam && c.seg >= a && c.seg <= b);
  for (let i = 0; i < run.length; i++) {
    const c = run[i], K = c.K, cols = [Math.round((K - 1) / 2), Math.round((K - 1) / 4), 1];
    within = Math.max(within, Math.abs(uAt(c, rowsOf(c) - 1, 1) - uAt(c, 0, 1)));
    const d = run[i + 1]; if (!d || d.seg !== c.seg + 1 || d.K !== K) continue;
    n++; for (const k of cols) jump = Math.max(jump, Math.abs(uAt(d, 0, k) - uAt(c, rowsOf(c) - 1, k)));
  }
  return { jump, within, n };
}
/** A tube at 360 easing 60 m -> 32 m over a 100 m piece (50 segments), between two held pieces. */
const easing = () => extend(extend(extend(D.createDoc('easing ring'), { length: 200, first: { w: 60, t: 360 } }), { length: 100, targets: { w: 32 } }), { length: 200 });

test('ring width: on a ring easing 60 -> 32 m over 50 cells the coincident rows at every cell boundary carry the same u at the floor, a wall and the roof', () => {
  const { segs, cells } = flowOf(easing()), mid = segs.map((g, i) => i).filter((i) => segs[i].id === 'p2');
  assert.ok(mid.every((i) => closedRing(segs[i])), 'the easing piece is a closed ring all along');
  const b = boundaries(cells, mid[0] - 1, mid[mid.length - 1] + 1);
  assert.ok(b.n >= 45, `${b.n} boundaries compared`);
  assert.ok(b.jump < 1e-6, `largest u jump at a boundary ${b.jump} of a tile`);
  // on a ring u at a column is n times that column's share of the circumference: with one n and one K for the run it is the same number in every row
  assert.ok(b.within < 1e-6, `u at the roof moves ${b.within} within a cell`);
});

test('ring width: every row of a closed ring run spans the same whole number of repeats round (the seam at the roof closes at every row)', () => {
  const { segs, cells } = flowOf(easing()), spans = new Set();
  for (const c of cells) if (!c.seam && closedRing(segs[c.seg])) for (let r = 0; r < rowsOf(c); r++) { const s = uAt(c, r, c.K - 1) - uAt(c, r, 0); spans.add(Math.abs(s).toFixed(9)); }
  assert.deepEqual([...spans].map(Number).map(Math.round), [...spans].map(Number), `spans ${[...spans].join(', ')}`);
  assert.equal(spans.size, 1, `one n for the run: spans ${[...spans].slice(0, 6).join(', ')}`);
});

test('ring width: on his CRAZY TEST the narrowing (p6) and the widening (p3) carry the same u across every cell boundary', (t) => {
  const doc = his('CRAZY TEST'); if (!doc) { t.skip('his saved CRAZY TEST is not on this machine'); return; }
  const { segs, cells } = flowOf(doc), seg = (id) => segs.map((g, i) => i).filter((i) => segs[i].id === id);
  for (const id of ['p3', 'p6']) { const s = seg(id), b = boundaries(cells, s[0], s[s.length - 1]); assert.ok(b.n > 20, `${id}: ${b.n} boundaries`); assert.ok(b.jump < 1e-6, `${id}: largest u jump ${b.jump}`); }
});

// sha256 of flowUvs' output, laid on t180-fresh origin/main 82db6c3 before this change: a section that does not change lays the same bytes
const GOLD = {
  'plain oval 31 m': '6f3c58fb57cb0b7dd0f27620fe4e72f2e69c33c8a12b5becba04919d876c4902',
  'closed tube oval 31 m': 'a62f81eaa5f821f9dea1438eabc00898f3eaddb9180bbde70b60f33fc59ff252',
  'open tube 31 m, sweep 270': 'd6b111305db55b14bb29e75d92f3f75aae09c33eb520ed1fbb08fd6044af565b',
  'cup road 31 m, cup 90': 'e8fe94762d107cabc8763b4dcb69dd9c9f9df7c3f21428b2d95bafa7cc255675',
  'TUBE OVAL (his)': '87b67390eafafedd3d9b910cb4de196a7f673f968bf60df175f733d980c5476e',
  'CRAZY TEST p4 and p5 (his, segments 601..1549)': 'ef5006be0afc11ba9e3a86ea1df82e6b387e1b6227f62923e8b110c535efdd0c',
};
function digest(doc, keep = () => true) {
  const { cells } = flowOf(doc), h = crypto.createHash('sha256');
  for (const c of cells) if (keep(c)) h.update(Buffer.from(c.u.buffer, c.u.byteOffset, c.u.byteLength));
  return h.digest('hex');
}
const Rr = 180, Q = (Math.PI * Rr) / 2;
function lap(first) { let d = extend(D.createDoc('flow lap'), { length: 300, ...(first ? { first } : { family: 'bowl' }) }); for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } }); d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } }); return close(d, { edited: [0] }).doc; }

test('ring width: a section that does not change lays the same bytes as before (plain road, closed tube, open tube, cup)', () => {
  assert.equal(digest(lap({ w: 31 })), GOLD['plain oval 31 m']);
  assert.equal(digest(lap({ w: 31, t: 360 })), GOLD['closed tube oval 31 m']);
  assert.equal(digest(extend(extend(D.createDoc('open tube'), { length: 200, first: { w: 31, t: 270 } }), { length: 300, targets: { kh: 1 / 200 } })), GOLD['open tube 31 m, sweep 270']);
  assert.equal(digest(extend(extend(D.createDoc('cup'), { length: 200, first: { w: 31, c: 90 } }), { length: 300, targets: { kh: 1 / 200 } })), GOLD['cup road 31 m, cup 90']);
});

test('ring width: his constant-width tubes lay the same bytes as before (TUBE OVAL whole; CRAZY TEST p4 and p5)', (t) => {
  const oval = his('T-180 TUBE OVAL'), crazy = his('CRAZY TEST'); if (!oval || !crazy) { t.skip('his saved TUBE OVAL or CRAZY TEST is not on this machine'); return; }
  assert.equal(digest(oval), GOLD['TUBE OVAL (his)']);
  assert.equal(digest(crazy, (c) => !c.seam && c.seg >= 601 && c.seg <= 1549), GOLD['CRAZY TEST p4 and p5 (his, segments 601..1549)']);
});

test('ring width: a ring that widens into a long tube keeps the long tube\'s own repeats round (n from the run\'s median, not its first ring)', () => {
  const doc = extend(extend(extend(D.createDoc('widening ring'), { length: 100, first: { w: 32, t: 360 } }), { length: 100, targets: { w: 60 } }), { length: 600 });
  const { segs, cells } = flowOf(doc), long = cells.filter((c) => !c.seam && segs[c.seg].id === 'p3');
  for (const c of long) assert.ok(Math.abs(Math.abs(uAt(c, 0, c.K - 1) - uAt(c, 0, 0)) - 6) < 1e-9, `the 60 m tube spans ${uAt(c, 0, c.K - 1) - uAt(c, 0, 0)} repeats round`);
});

test('ring width: an OPEN tube narrowing 60 -> 32 m carries the same u across every cell boundary (each row its own section, not its segment\'s end)', () => {
  const doc = extend(extend(extend(D.createDoc('narrowing open tube'), { length: 200, first: { w: 60, t: 270 } }), { length: 100, targets: { w: 32 } }), { length: 200 });
  const { segs, cells } = flowOf(doc), mid = segs.map((g, i) => i).filter((i) => segs[i].id === 'p2');
  assert.ok(mid.every((i) => !closedRing(segs[i])), 'the narrowing piece is an open tube');
  const b = boundaries(cells, mid[0] - 1, mid[mid.length - 1] + 1);
  assert.ok(b.n >= 45, `${b.n} boundaries compared`);
  assert.ok(b.jump < 1e-6, `largest u jump at a boundary ${b.jump} of a tile`);
});
