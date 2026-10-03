// core_cup_export.test.js: node --test test/core_cup_export.test.js   (under the heavy-run lock, --max-old-space-size=4096; about a minute)
// D190 seal, row 4: a closed lap whose turns carry a cup of 90° and of 150° (the start straight left uncupped, the last turn's first 40 m
// returning the cup to the edge the start renders) goes through the app's export route (src/export/fromwords.js buildFromSegments, csp on, the
// default) with no red for every family at w = 31 m; with csp off validation reds steep-without-raycast, which is the right refusal; and a
// start straight that is itself cupped to 150° exports with a single-column grid (D226; it was refused at the grid before). A cup of 150° on a bowl narrower than the
// downforce ray's 1 m gap is refused at the DOCUMENT (BAD_CUP), never reaching the export's incidental red (D190 seal, row 2).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const FW = require('../src/export/fromwords.js');
const { startLayout } = require('../app/core/coreshell.js');

const Rr = 180, Q = (Math.PI * Rr) / 2, FAMILIES = ['bowl', 'half-pipe', 'flat'];
/** The seal's lap: an uncupped start straight, four turns at cup c (the last turn's first 40 m return the cup to the edge the start renders, so the grid's straight is uncupped), a closing straight. */
function cupLap(family, c, { cupStart = false } = {}) {
  let d = extend(D.createDoc('cup lap'), { length: 300, family, ...(cupStart ? { first: { c } } : {}) });
  const edge = D.legacyEdgeDeg(family, D.channelAt(d.pieces[0], 'w', 300).v, D.channelAt(d.pieces[0], 'r', 300).v);
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, c: i === 3 && !cupStart ? edge : c } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0, c: cupStart ? c : edge } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
function exportDoc(doc, opts = {}) {
  const segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  return FW.buildFromSegments(segs, { name: 'cup', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start), ...opts });
}
for (const family of FAMILIES) for (const c of [90, 150]) {
  test(`row 4 (i): a closed ${family} lap with its four turns at ${c}° exports with csp on: mesh, markers, kn5 (read back) and AI line, no red`, () => {
    const out = exportDoc(cupLap(family, c));
    assert.ok(out.kn5 && out.kn5.length > 1000, 'a kn5 came out'); assert.ok(out.ai, 'an AI line came out'); assert.ok(out.scene, 'a scene');
    for (const m of require('../src/export/markers.js').walkScene(out.scene).meshes) for (const k of ['positions']) assert.ok(m[k] && Array.from(m[k]).every(Number.isFinite), `NaN in ${m.name}`);
  });
}
for (const family of FAMILIES) {
  test(`row 4 (ii): the same ${family} lap at 90° with csp OFF is refused, by steep-without-raycast (the walls are past 50°, which vanilla AC tyres ignore)`, () => {
    assert.throws(() => exportDoc(cupLap(family, 90), { csp: false }), (e) => e.name === 'ExportError' && e.code === 'RED' && /steep/i.test(e.message + JSON.stringify(e.red)), `${family}: csp false`);
  });
}
// D226 (ruling b): this row used to expect a REFUSAL here. The 150° cup's floor is 4.45 m wide: too narrow for two columns, wide enough for one
// slot, so the grid now falls back to a single column on the centreline (src/markers/layout.js) and says so; the refusal by name is kept for a
// floor that fits no slot (test/export_tube_grid.test.js row 2, a tube 20 m wide at 1.67 m), and it is still never a crash.
test('row 4 (iii): a start straight cupped to 150° (a 4.45 m floor: not two columns, one slot) exports with a single-column grid and says so, not a crash', () => {
  const doc = cupLap('bowl', 150, { cupStart: true }), out = exportDoc(doc);
  assert.equal(out.markers.layout.grid.pattern, '1-column'); assert.ok(out.markers.check.checks.every((c) => c.ok), JSON.stringify(out.markers.check.checks.filter((c) => !c.ok)));
  assert.ok(out.warnings.some((w) => /single column on the centreline/.test(w)), 'the warning names it'); assert.ok(out.kn5.length > 1000);
});
test('row 4 / row 2: a bowl cup of 165° (walls crossed) is refused at the DOCUMENT by name, so the export\'s incidental raygap red is never what stops it', () => {
  assert.throws(() => cupLap('bowl', 165), (e) => e.code === 'BAD_CUP');
});
