// markers_sectors.test.js: node --test test/markers_sectors.test.js
// A closed lap's sector gates (src/markers/layout.js lapSectors, 2026-10-14; ELYSIUM's export had only the start gate, and its sector gates were added by
// hand): AC_TIME_1 and AC_TIME_2 a third and two thirds of the lap past the start line; none on an open track.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../src/core/document.js'), AD = require('../src/core/adapter.js');
const Lay = require('../src/markers/layout.js'), { segStarts } = require('../src/markers/place.js');
const { startLayout } = require('../app/core/coreshell.js');   // the layout the export places (as test/fixtures/fixtures.js renders it)

const FX = path.join(__dirname, 'fixtures');
const docOf = (file) => D.parse(fs.readFileSync(path.join(FX, file), 'utf8'));
const lapOf = (doc) => {
  const segs = AD.toSegments(doc), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch }, lift = (q) => AD.offsetPath(doc, segs, q);
  const p = AD.toPath(doc, { step: 2 }).path; return { segs, p, starts: segStarts(p, segs), layout: () => startLayout(segs, lift, start) };
};

test('a closed lap: AC_TIME_1 and AC_TIME_2 a third and two thirds of the lap past the start line, on road', () => {
  const { segs, p, starts, layout } = lapOf(docOf('F1-bowl-default-lap-closed.core2.json'));
  const L = layout(), sLine = Lay.anchorS(L.line, segs, starts), len = p.lengthM, s0 = p.samples[0].s;
  assert.equal(L.sectors.length, 2);
  L.sectors.forEach((a, i) => {
    const s = Lay.anchorS(a, segs, starts), want = ((sLine + ((i + 1) * len) / 3 - s0) % len + len) % len + s0;
    assert.ok(Math.abs(s - want) < 1e-6, `sector ${i + 1} at ${s.toFixed(2)} m, a third of the lap on is ${want.toFixed(2)} m`);
    const seg = segs[starts.findLastIndex((x) => x <= s + 1e-9)]; assert.equal(seg.kind, 'road', 'on road');
  });
  const r = Lay.resolveLayout(L, p, segs);
  assert.deepEqual(r.markers.filter((m) => m.kind === 'sector').map((m) => m.name).sort(), ['AC_TIME_1_L', 'AC_TIME_1_R', 'AC_TIME_2_L', 'AC_TIME_2_R']);
});

test('an open track has no sector gates', () => {
  const { segs, p } = lapOf(docOf('F3-bowl-narrow-12m-cap-binds.core2.json'));
  assert.equal(p.closed, false);
  assert.deepEqual(Lay.lapSectors(p, segs, 10), []);
});
