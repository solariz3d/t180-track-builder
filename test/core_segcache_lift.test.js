// core_segcache_lift.test.js: node --test test/core_segcache_lift.test.js
// D421c part 4 (O): a piece that differs from the one cached for its id ONLY in the lift channels h (height) and l (lateral) reuses that piece's segments
// (src/core/adapter.js toSegments `cache`). The segments never read h or l: the lift (offsetPath) does. A Grab drag makes new piece objects that change only h
// (sideways, only l), and before this the cache keyed a piece by its object alone, so every step converted the brushed pieces again into the same segments
// (measured on sculpt-frame row 2: 3 pieces, about 1.5 ms a step, every segment identical). GEOMETRY tier: the cached segments must equal a fresh conversion,
// number for number (isDeepStrictEqual), as test/core_segcache.test.js holds for every other edit. Rows:
//   1  a Grab and a sideways Grab, step after step, on an open lap, a closed lap and a closed tube lap: equal to a fresh conversion at every step, and the
//      brushed pieces' segments are the SAME objects as before the step (reused, not rebuilt); the lift itself follows the new heights
//   2  a piece whose other channels change too (h with w, h with kh, h with phi, h with kv) is rebuilt, and equals a fresh conversion
//   3  a piece that changes only in h, but whose incoming state changed (the piece before it changed its width, so the cross-section handed on is another), is
//      rebuilt: the inputs are compared on this path exactly as on the other
//   4  a piece that changes only in h and in a field outside its channels (its length, its family) is rebuilt
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('util');
const D = require('../src/core/document.js');
const AD = require('../src/core/adapter.js');
const G = require('../src/geom/index.js');
const { createCoreShell } = require('../app/core/coreshell.js');
const { PER_PX } = require('../app/core/panel.js');

const R = 180, Q = (Math.PI * R) / 2;
const doc = (s) => s.getState().history.present;
const sameAsFresh = (segs, d, what) => {
  const want = AD.toSegments(d);
  assert.equal(segs.length, want.length, `${what}: segment count`);
  const bad = segs.findIndex((g, i) => !isDeepStrictEqual(g, want[i]));
  assert.equal(bad, -1, `${what}: segment ${bad} differs from a fresh conversion`);
};
const TRACKS = {
  open: (s) => { s.extend({ length: 200, family: 'bowl' }); for (let i = 1; i < 12; i++) s.extend({ length: 200, transition: 40, targets: { kh: (Math.floor(i / 3) % 2 ? 1 : -1) / 2000 } }); return 1100; },
  closed: (s) => { s.extend({ length: 200, family: 'bowl' }); for (let k = 0; k < 2; k++) { for (let i = 0; i < 4; i++) s.extend({ length: 200, transition: 40, targets: { kh: 0 } }); for (let i = 0; i < 5; i++) s.extend({ length: 200, transition: 40, targets: { kh: Math.PI / 1000 } }); } s.close(); return 700; },
  tube: (s) => { s.extend({ length: 300, first: { w: 31, t: 360 } }); for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 60, transition: 40, targets: { kh: 0 } }); s.close(); return 150; },
};
/** A copy of `d` with piece i's channels changed by f (its interior control points), frozen as the core's documents are: a new piece object, the same id. */
function withChannels(d, i, changes, more = {}) {
  const P = d.pieces[i], channels = { ...P.channels };
  for (const [ch, f] of Object.entries(changes)) channels[ch] = P.channels[ch].map((v, k, all) => (k >= 2 && k < all.length - 2 ? f(v) : v));   // interior points only: a joint stays C1
  const pieces = d.pieces.slice(); pieces[i] = { ...P, channels, ...more };
  return D.freeze ? D.freeze({ ...d, pieces }) : Object.freeze({ ...d, pieces: Object.freeze(pieces) });
}
const segsOf = (segs, id) => segs.filter((g) => g.id === id);

test('row 1: a Grab and a sideways Grab reuse the brushed pieces\' segments, step after step, and still equal a fresh conversion; the lift follows the heights', async () => {
  for (const [name, build] of Object.entries(TRACKS)) {
    for (const [tool, channel] of [['grab-up', 'height'], ['grab-side', 'lateral']]) {
      const s = await createCoreShell({ autosaveMs: 0 }), s0 = build(s);
      s.setSculpt(true); s.beginBrush({ tool, mode: 'local', channel, s0, r: 60 });
      assert.ok(s.getState().brush, `${name} ${tool}: refused: ${s.getState().message}`);
      const before = s.getState().resolved.segments;
      let reused = 0;
      for (const px of [10, 25, -15, 40]) {
        const prev = s.getState().resolved.segments, prevDoc = doc(s);
        s.brushTo(px * PER_PX[channel]);
        const d = doc(s), segs = s.getState().resolved.segments;
        sameAsFresh(segs, d, `${name} ${tool} at ${px} px`);
        const changed = d.pieces.filter((P, i) => P !== prevDoc.pieces[i]);
        assert.ok(changed.length > 0, `${name} ${tool} at ${px} px: the step changed a piece`);
        for (const P of changed) { const a = segsOf(segs, P.id), b = segsOf(prev, P.id); assert.ok(a.length === b.length && a.every((g, k) => g === b[k]), `${name} ${tool}: piece ${P.id}'s segments are the same objects`); reused++; }
      }
      assert.ok(reused > 0);
      // the lift reads the new heights: the lifted path after the drag is not the one before it, and equals the lift of a fresh conversion
      const d = doc(s), segs = s.getState().resolved.segments, res = s.getState().resolved;
      const pathOf = (sg) => G.buildPath(sg, { step: 2, closed: res.closed, start: res.start });
      const lifted = res.lift(pathOf(segs)), fresh = AD.offsetPath(d, AD.toSegments(d), pathOf(AD.toSegments(d)));
      assert.ok(lifted.samples.every((x, k) => isDeepStrictEqual(x.pos, fresh.samples[k].pos)), `${name} ${tool}: the lift equals a fresh one`);
      assert.ok(segs.length === before.length);
    }
  }
});

test('row 2: a piece whose other channels change with h (w, kh, phi or kv) is rebuilt, and equals a fresh conversion', async () => {
  const s = await createCoreShell({ autosaveMs: 0 }); TRACKS.open(s);
  const d0 = doc(s), id = d0.pieces[5].id;
  // control: h alone IS reused through a fresh cache (so each case below reaches the by-id path, and only the other channel can make it rebuild)
  { const cache = new WeakMap(), first = AD.toSegments(d0, { cache }), segs = AD.toSegments(withChannels(d0, 5, { h: (v) => v + 2 }), { cache }); assert.ok(segsOf(segs, id).every((g, k) => g === segsOf(first, id)[k]), 'control: h alone is reused'); }
  for (const [ch, f] of [['w', (v) => v + 1], ['kh', (v) => v + 1e-4], ['phi', (v) => v + 0.01], ['kv', (v) => v + 1e-4]]) {
    const cache = new WeakMap(), first = AD.toSegments(d0, { cache });   // a fresh cache each time: the last piece for the id is d0's
    const d1 = withChannels(d0, 5, { h: (v) => v + 2, [ch]: f });
    const segs = AD.toSegments(d1, { cache });
    sameAsFresh(segs, d1, `h with ${ch}`);
    assert.ok(segsOf(segs, id).some((g, k) => g !== segsOf(first, id)[k]), `h with ${ch}: rebuilt`);
  }
});

test('row 3: a piece that changes only in h, after a piece whose width changed (so what it is handed changed), is rebuilt', async () => {
  // C's construction (core_segcache row 2c): a tube made by Extend's targets straight after a legacy lead morphs out of the lead's last row, so a lead one
  // width quantum wider at its end (the joint allows it) hands the tube another cross-section; here the tube ALSO changes in h, so it is a new object that
  // differs from the last one cached for its id only in a lift channel, and only the inputs can tell it must be rebuilt
  const t = await createCoreShell({}); t.extend({ length: 300, family: 'bowl' }); t.extend({ length: 300, transition: 40, targets: { t: 120 } });
  const e = doc(t), lead = e.pieces[0], w = lead.channels.w;
  assert.equal(D.kindOf(e.pieces[1]), 'tube', 'control: the follower is a tube entering from a legacy piece');
  const wider = { ...e, pieces: [{ ...lead, channels: { ...lead.channels, w: [...w.slice(0, -1), +(w.at(-1) + 10 ** -D.DEC.w).toFixed(D.DEC.w)] } }, e.pieces[1]] };
  const d1 = withChannels(wider, 1, { h: (v) => v + 1 }); D.checkDoc(d1);
  assert.ok(!isDeepStrictEqual(AD.toSegments(d1).filter((g) => g.id === e.pieces[1].id), AD.toSegments(e).filter((g) => g.id === e.pieces[1].id)), 'control: the wider lead changes the tube');
  const cache = new WeakMap(); AD.toSegments(e, { cache });
  sameAsFresh(AD.toSegments(d1, { cache }), d1, 'h after the lead widened');
});

test('row 4: a piece that changes in h and in a field outside its channels (length, family) is rebuilt', async () => {
  const s = await createCoreShell({ autosaveMs: 0 }); TRACKS.open(s);
  const d0 = doc(s);
  for (const more of [{ length: d0.pieces[5].length + 10 }, { family: d0.pieces[5].family === 'bowl' ? 'flat' : 'bowl' }]) {
    const cache = new WeakMap(); AD.toSegments(d0, { cache });
    const d1 = withChannels(d0, 5, { h: (v) => v + 2 }, more);
    sameAsFresh(AD.toSegments(d1, { cache }), d1, `h with ${Object.keys(more)[0]}`);
  }
});
