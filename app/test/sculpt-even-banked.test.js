// sculpt-even-banked.test.js: node --test app/test/sculpt-even-banked.test.js
// Sculpt's EVEN on a BANKED turn through the shell (D678): the registration's rows K1 to K6 on Bhold, B- and B-0 from the untouched road and from one and eight
// strokes of the Width tool (U, W1, W8), and the release's sentence on B+ and B+0 (P1 to P4), where the bank rolls along the run and the new middle's line leaves
// the road (lighthouse exo_memory/handback/p-d678-even-build-A_2026-11-27.md, section 1.3; probe 3's fixtures, test/even_fixtures.js). The level is the drag of
// the run's right-edge width handle, the left edge held, to 16 m.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
const AD = require('../../src/core/adapter.js');
const V = require('../../src/validate/index.js');
const F = require('../../test/even_fixtures.js');

function evenDrag(sh, { from, to }, hold, value) {
  sh.selectPiece(from); if (to !== from) sh.selectPiece(to, { extend: true });
  sh.beginSculpt({ tool: 'even', hold });
  const b = sh.getState().brush; assert.ok(b && b.mode === 'even', `the drag opened: ${sh.getState().message}`);
  sh.sculptTo(value - b.value0); sh.endSculpt();
}
const msg = (sh) => sh.getState().message || '';
const LEAVES = /leaves the road on the new middle/;

for (const fx of ['Bhold', 'B-', 'B-0']) {
  for (const start of ['U', 'W1', 'W8']) {
    test(`K1-K6: ${fx} from ${start}: Even levels the banked turn to 16 m, the left edge held, the centre in the plane of the road as built, the bank as found`, async () => {
      const base = F.fixture(fx), sh = await F.startOf(base, start), st0 = F.present(sh), run = F.runPieces(st0);
      evenDrag(sh, run, 'left', 16);
      await sh.whenEvenChecked();   // AMENDED BY NAME (D678 repair, item 1): the sentence lands after the release, so P4 reads it once the check is done
      const d = F.present(sh), S = F.stations(F.RUN.lo, F.RUN.hi);
      assert.notEqual(d, st0, msg(sh));
      assert.deepEqual(F.redsLacked(d, base), [], 'K1: no red the untouched road lacks');
      const held = Math.max(...S.map((s) => Math.abs(F.rimAcross(d, s, 'left') - F.rimAcross(base, s, 'left'))));
      assert.ok(held <= 0.01, `K2: the held edge is ${held} m from the untouched road's`);
      const c = F.centreOff(d, st0);
      assert.ok(c.off <= 0.01, `K3: the centre is ${c.off} m off its target at ${c.at}`);
      assert.deepEqual(F.outsideChanges(d, st0), [], 'K4: nothing outside the window');
      d.pieces.forEach((P, i) => { if (P.type === 'road') assert.deepEqual(P.channels.phi, st0.pieces[i].channels.phi, `K5: piece ${i}'s bank`); });
      for (const s of F.stations(0, F.endOf(st0))) assert.ok(Object.is(F.builtBank(d, s), F.builtBank(st0, s)), `K5: the bank as built at ${s}`);
      const w = F.spread(S.map((s) => F.at(d, 'w', s)));
      assert.ok(w <= 0.01, `K6: width spread ${w}`);
      if (start === 'U') assert.doesNotMatch(msg(sh), LEAVES, 'P4: no sentence where the road holds');
    });
  }
}

// P2's figures, from the checker run here (src/validate, the centre line's load with the downforce, open track at the lap sim's cap), not from the shell's words
const km = (s) => `${(s / 1000).toFixed(2)} km`, g = (x) => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(1)} g`;
function centreLoads(doc) {
  const tp = AD.toPath(doc, { step: 2 }), r = V.validate(tp.path, tp.segments, { passClearance: true, csp: true, fullSpeed: true }), m = new Map();
  for (const ln of r.lines) if (ln.u === 0) m.set(ln.s, ln.fHold_g); return m;
}
for (const fx of ['B+', 'B+0']) {
  test(`P1-P3: ${fx}: Even is laid, and where the new middle's line leaves the road the release says so in plain words with the place and three figures`, async () => {
    const base = F.fixture(fx), sh = await F.shellOn(base), run = F.runPieces(base);
    evenDrag(sh, run, 'left', 16);
    await sh.whenEvenChecked();   // AMENDED BY NAME (D678 repair, item 1): the sentence lands after the release, off the page; P2 and P3 read it once it has
    const d = F.present(sh), m = msg(sh);
    assert.notEqual(d, base, 'P1: laid');
    sh.undo(); assert.equal(D.serialize(F.present(sh)), D.serialize(base), 'P1: one undo step'); sh.redo();
    // the checker's own reading: stations in the window where the new middle leaves the road and the old held
    const a = centreLoads(base), b = centreLoads(d), hit = [...b].filter(([s, v]) => s >= F.WIN.w0 && s <= F.WIN.w1 && v < 0 && a.get(s) >= 0);
    assert.ok(hit.length > 0, 'the fixture has a red the untouched road lacks (probe 3)');
    const [at] = hit.reduce((x, y) => (y[1] < x[1] ? y : x));
    const middle = { ...base, pieces: base.pieces.map((P, i) => (d.pieces[i] === P || P.type !== 'road' ? P : { ...P, channels: { ...P.channels, l: d.pieces[i].channels.l, h: d.pieces[i].channels.h } })) };
    const line = centreLoads(middle).get(at), old = a.get(at), shift = Math.abs(F.at(d, 'l', at) - F.at(base, 'l', at)) / Math.cos(F.builtBank(base, at));
    assert.match(m, LEAVES, `P2: the sentence: ${m}`);
    for (const fig of [km(at), `${shift.toFixed(1)} m`, g(line), g(old)]) assert.ok(m.includes(fig), `P2: "${fig}" in: ${m}`);
    assert.doesNotMatch(m, /phi|fHold|leaves-surface|channel|\bkh\b|(^|\s)[lh]\s/, 'P3: no jargon');
  });
}
