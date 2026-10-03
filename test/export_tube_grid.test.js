// export_tube_grid.test.js: node --test test/export_tube_grid.test.js   (under the heavy-run lock, --max-old-space-size=4096; about a minute)
// D226: a closed tube's start straight has a floor of only a few metres (the surface angle grows from 0 at the bottom, whatever the width),
// so the grid was refused as "too narrow for a two-column grid" and a tube oval never reached Assetto Corsa. When the floor fits ONE slot but
// not two columns, src/markers/layout.js defaultLayout now puts the cars nose to tail on the centreline ('1-column') and the export says so;
// it still refuses, by name, when not even one slot fits. The two-column layouts are untouched (the other marker and export tests, and row 5
// here, which pins the two-column numbers).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const L = require('../src/markers/layout.js');
const { startLayout } = require('../app/core/coreshell.js');

const Rr = 180, Q = (Math.PI * Rr) / 2;
function exportDoc(doc, opts = {}) {
  const segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  return FW.buildFromSegments(segs, { name: 'tube', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start), ...opts });
}
/** A closed oval that is a tube all the way round, closed from its first metre (t = 360 on every piece), at width w. */
function tubeOval(w) {
  let d = extend(D.createDoc('tube oval'), { length: 300, first: { w, t: 360 } });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
/** The same oval with an ordinary (open) road, the two-column case. */
function plainOval(w) {
  let d = extend(D.createDoc('plain oval'), { length: 300, family: 'bowl', first: { w } });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
const slotMarkers = (out) => out.markers.placed.filter((m) => /^AC_START_\d+$/.test(m.name)).sort((a, b) => a.n - b.n);

test('row 1: a tube oval 40 m wide exports, with a single-column grid on the centreline, nose to tail, and a warning that names it', () => {
  const out = exportDoc(tubeOval(40));
  assert.ok(out.kn5 && out.kn5.length > 1000, 'a kn5 came out'); assert.ok(out.ai, 'an AI line came out');
  const g = out.markers.layout.grid; assert.equal(g.pattern, '1-column'); assert.equal(g.count, 4); assert.equal(g.colGapM, 0);
  assert.deepEqual(L.gridSlots(g).map((x) => [x.backM, x.u]), [[10, 0], [18, 0], [26, 0], [34, 0]], 'a slot every 8 m on the centreline');
  const slots = slotMarkers(out); assert.equal(slots.length, 4); for (const m of slots) assert.ok(Math.abs(m.u) < 1e-9, `${m.name} at u ${m.u}`);
  assert.ok(8 > 2 * L.SLOT_HALF_LENGTH, 'control: 8 m between slots clears a slot\'s 4.8 m length');
  assert.ok(out.warnings.some((w) => /single column on the centreline, cars nose to tail.*too narrow for two columns/.test(w)), out.warnings.join(' | '));
  assert.ok(out.markers.check.checks.every((c) => c.ok), 'every marker check holds: ' + JSON.stringify(out.markers.check.checks.filter((c) => !c.ok)));
});

test('row 1: the same at 31 m and 60 m (a wider tube has a wider floor, and still one column)', () => {
  for (const w of [31, 60]) {
    const out = exportDoc(tubeOval(w)); assert.equal(out.markers.layout.grid.pattern, '1-column', `w ${w}`); assert.ok(out.warnings.some((x) => /single column/.test(x)), `w ${w}`); assert.ok(out.kn5.length > 1000);
  }
});

test('row 2: a tube too narrow for even one slot is refused BY NAME at the grid, with the floor it measured (not a crash, not a one-slot grid)', () => {
  assert.throws(() => exportDoc(tubeOval(20)), (e) => e.code === 'NO_START_STRAIGHT' && /floor is 1\.\d\d m wide, too narrow for even one grid slot \(a slot needs more than 2\.2 m\)/.test(e.message), 'refused');
});

test('row 3: the one-slot bar is the slot\'s half width plus 0.1 m, and the two-column bar did not move', () => {
  assert.equal(L.ONE_SLOT_MARGIN_M, 0.1); assert.equal(L.SLOT_HALF_WIDTH, 1.0);
  const floors = [20, 31, 40, 60].map((w) => L.floorHalf(require('../src/geom/profile.js').readAt(A.toSegments(tubeOval(w))[0], 0)));
  assert.ok(floors[0] < 1.1 && floors[1] > 1.1 && floors[2] > floors[1] && floors[3] > floors[2], `the floors' half widths ${floors.join(', ')}: 20 m is under the bar (1.1), 31 m over`);
  assert.ok(floors.every((f) => f < 3), 'control: a tube\'s floor never reaches the two-column bar (half width 3.5 m for the default 6 m gap), so every one of these takes the single column or is refused');
});

test('row 4: gridSlots and resolveLayout: a 1-column grid is one u per slot, 8 m apart, and only it carries the amber note', () => {
  const g = { pattern: '1-column', count: 5, poleBackM: 10, rowGapM: 8, colGapM: 0, edits: {} };
  const s = L.gridSlots(g); assert.deepEqual(s.map((x) => x.u), [0, 0, 0, 0, 0]); assert.deepEqual(s.map((x) => x.backM), [10, 18, 26, 34, 42]);
  assert.deepEqual(L.gridSlots({ ...g, edits: { 2: { u: 0.5 } } }).map((x) => x.u), [0, 0, 0.5, 0, 0], 'a slot edit still overrides');
  assert.deepEqual(Object.keys(L.PATTERNS), ['2-staggered', '2-abreast', '3-abreast', '1-column']);
});

test('row 5: the two-column layout of an ordinary road is unchanged (2-staggered, a 6 m gap, a 16 m row), and no single-column note appears', () => {
  const out = exportDoc(plainOval(31)), g = out.markers.layout.grid;
  assert.deepEqual([g.pattern, g.count, g.poleBackM, g.rowGapM, g.colGapM], ['2-staggered', 4, 10, 16, 6]);
  assert.deepEqual(L.gridSlots(g).map((x) => [x.backM, x.u]), [[10, 3], [18, -3], [26, 3], [34, -3]]);
  assert.ok(!out.warnings.some((w) => /single column/.test(w)), out.warnings.join(' | '));
});

test('row 5b: the grid\'s length need is the same for the single column as for the staggered pair (the last slot is 34 m behind the line in both)', () => {
  const two = L.gridSlots({ pattern: '2-staggered', count: 4, poleBackM: 10, rowGapM: 16, colGapM: 6, edits: {} }), one = L.gridSlots({ pattern: '1-column', count: 4, poleBackM: 10, rowGapM: 8, colGapM: 0, edits: {} });
  assert.equal(Math.max(...two.map((x) => x.backM)), Math.max(...one.map((x) => x.backM)));
});
