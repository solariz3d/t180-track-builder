// core_valuesat.test.js: node --test test/core_valuesat.test.js
// D236: D.valuesAt(P, s) is every channel's value from ONE basis evaluation; the adapter reads all eleven at every segment end of every piece, on every brush step, and channelAt
// rebuilt the same basis for each of them (1.0 s of a 2.7 s edit on the closed tube, 66 ms of the cup oval's step). It must give EXACTLY channelAt's value, bit for bit, or the
// export's segments change (core_cup_fixtures row 5a is the other guard: the nine fixtures' roads stay byte for byte).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const AD = require('../src/core/adapter.js');
const { createCoreShell } = require('../app/core/coreshell.js');

async function pieces() {
  const s = await createCoreShell({ brushFn: null }), R = 180;
  s.extend({ length: 300, first: { c: 60 } });                                   // a cup
  s.extend({ length: 200, transition: 40, targets: { kh: 1 / R, w: 40, phi: 0.3 } });
  s.extend({ length: 200, first: undefined, targets: { t: 360 } });             // a tube after a cup
  assert.equal(s.getState().message, null, s.getState().message);
  const bowl = await createCoreShell({ brushFn: null }); bowl.extend({ length: 150, family: 'bowl' });   // a legacy piece: no cup, edge or tube channel arrays
  return [...s.getState().history.present.pieces, ...bowl.getState().history.present.pieces].filter((p) => p.type === 'road');
}

test('valuesAt equals channelAt(...).v for every channel, bit for bit, along cup, tube and legacy pieces, at the ends and outside them', async () => {
  const ps = await pieces(); assert.ok(ps.some((p) => p.cup) && ps.some((p) => p.tube) && ps.some((p) => !p.cup && !p.tube && !p.edge), 'control: a cup, a tube and a legacy piece');
  let n = 0;
  for (const P of ps) for (const s of [-5, 0, 1e-9, 0.3, P.length / 7, P.length / 2, P.length * 0.999, P.length, P.length + 5]) {
    const got = D.valuesAt(P, s); assert.deepEqual(Object.keys(got), [...D.CHANNELS], 'the channels, in their order');
    for (const ch of D.CHANNELS) { assert.ok(Object.is(got[ch], D.channelAt(P, ch, s).v), `${P.id} ${ch} at ${s}: ${got[ch]} vs ${D.channelAt(P, ch, s).v}`); n++; }
  }
  assert.ok(n > 300, `${n} values compared`);
});

test('valuesAt does not read an optional channel the piece does not have: a legacy piece gives the defaults, as channelAt does', async () => {
  const full = (await pieces()).find((p) => !p.cup && !p.tube && !p.edge);
  const P = { ...full, channels: Object.fromEntries(Object.entries(full.channels).filter(([ch]) => !D.OPTIONAL[ch])) };   // a hand-built piece: no c, e, s or t array at all
  const got = D.valuesAt(P, 40);
  assert.equal(got.c, D.OPT_DEFAULT.c); assert.equal(got.t, D.OPT_DEFAULT.t); assert.equal(got.e, D.OPT_DEFAULT.e); assert.equal(got.s, D.OPT_DEFAULT.s);
  for (const ch of D.CHANNELS) assert.ok(Object.is(got[ch], D.channelAt(P, ch, 40).v), ch);
});

test('the adapter\'s segments of a closed cup lap are unchanged by reading the channels together (the segments equal the ones made with channelAt)', async () => {
  const s = await createCoreShell({ brushFn: null }); s.extend({ length: 300, first: { c: 60 } }); s.extend({ length: 90, transition: 40, targets: { kh: 1 / 180, c: 90 } });
  const doc = s.getState().history.present, orig = D.valuesAt;
  const viaChannelAt = (P, s0) => Object.fromEntries(D.CHANNELS.map((ch) => [ch, D.channelAt(P, ch, s0).v]));
  const a = JSON.stringify(AD.toSegments(doc)); D.valuesAt = viaChannelAt; let b; try { b = JSON.stringify(AD.toSegments(doc)); } finally { D.valuesAt = orig; }
  assert.equal(a, b);
});
