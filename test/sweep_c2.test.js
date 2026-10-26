// sweep_c2.test.js: node --test test/sweep_c2.test.js          (SWEEP_SEEDS=60 for the landing's larger run; SWEEP_SEED=17 runs one seed)
// D459 3b/3c (2026-10-25, the user: "remember it isnt just about fixing the track, but understanding it so the generation system never does it again"). The C2
// part of the seeded sweep: every seed lays a track from public words (turns, climbs, banks, cups, edges, tubes, piece lengths from a seeded generator; closed
// by Close on even seeds), and on every one the cross-section channels the wheels ride on (the bank, the cup, the edges: src/core/continuity.js C2_CHANNELS)
// step their CURVATURE at no joint: not where the words laid a ramp, not at the seam, not where the close moved a joint. The generator is C's
// test/sweep_joints.test.js trackOf (d460-c 529e5c7), copied verbatim with one addition (the document from before the close is returned too), so the two
// files draw the same tracks per seed; the rows are kept apart so neither branch's file is edited by the other before the landing folds them.
//   1  (per seed) C2 at every joint the WORDS laid: RED on 0.4.19 (6·Δ/L² at every bank, cup and edge joint), GREEN with the quintic (3b)
//   2  (per seed) C2 at the seam and at the joints the close moved: RED before 3c (the closure met value and slope only: 19 of 20 closed laps stepped at the
//      seam, 0.002–0.34 °/m², and two inside the window), GREEN with the closure's curvature rows (src/core/close.js)
// The curvature step is read from the stored control points in closed form (continuity.js c2Breaks), in °/m², against TOL_K; an open lap has no row 2.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const CN = require('../src/core/continuity.js');

const SEEDS = process.env.SWEEP_SEED ? [Number(process.env.SWEEP_SEED)]
  : Array.from({ length: Number(process.env.SWEEP_SEEDS) || 6 }, (_, i) => 1 + i);   // "check it" size in the normal suite: 6 seeds
const DEG = Math.PI / 180;

/** mulberry32: a small seeded generator, the same numbers on every machine (C's) */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** one track from a seed (C's trackOf, verbatim, plus `open`): { doc, open (the document before the close), closed, words } */
function trackOf(seed) {
  const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)], between = (a, b) => a + (b - a) * r();
  const firstKind = pick(['plain', 'cup', 'edge', 'tube']);
  const first = firstKind === 'cup' ? { c: Math.round(between(5, 30)) } : firstKind === 'edge' ? { e: Math.round(between(5, 30)) } : firstKind === 'tube' ? { t: Math.round(between(60, 200)) } : {};
  let doc = extend(D.createDoc(`sweep ${seed}`), { length: 300, first }); const words = [{ length: 300, first }];
  const n = 5 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    for (let tries = 0; tries < 6; tries++) {
      const t = {};
      if (r() < 0.6) t.kh = (r() < 0.5 ? -1 : 1) / between(250, 900);   // a turn
      else if (r() < 0.5) t.kh = 0;
      if (r() < 0.3) t.kv = (r() < 0.5 ? -1 : 1) / between(2000, 6000);   // a climb or a dip
      if (r() < 0.35) t.phi = (r() < 0.5 ? -1 : 1) * between(0, 20) * DEG;   // a bank
      if (firstKind === 'cup' && r() < 0.5) t.c = Math.round(between(0, 35));
      if (firstKind === 'edge' && r() < 0.6) { if (r() < 0.5) t.e = Math.round(between(-10, 30)); else t.er = Math.round(between(0, 35)); }
      if (firstKind === 'tube' && r() < 0.5) t.t = Math.round(between(30, 240));
      const w = { length: Math.round(between(40, 260)), transition: 40, targets: t };
      try { doc = extend(doc, w); words.push(w); break; } catch (e) { /* the document refused these words: draw again */ }
    }
  }
  const open = doc; let closed = false;
  if (seed % 2 === 0) { try { const c = close(doc, { edited: [0] }); if (c.converged) { doc = c.doc; closed = true; } } catch (e) { /* stays open */ } }
  return { doc, open, closed, words };
}
/** every road joint (the seam too on a closed lap), per C2 channel, with who laid it: 'words' (both pieces as the words made them) or 'close' */
function c2Steps(doc, open) {
  const same = (A, B) => JSON.stringify(A) === JSON.stringify(B), n = doc.pieces.length;
  return CN.jointSteps(doc, { channels: CN.C2_CHANNELS }).map((e) => { const k = e.k, A = doc.pieces[k], B = doc.pieces[(k + 1) % n];
    const by = !doc.closed ? 'words' : (k === n - 1 || !same(A, open.pieces[k]) || !same(B, open.pieces[k + 1])) ? 'close' : 'words'; return { ...e, by }; });
}
const say = (e) => `${e.joint} ${e.ch} ${e.dkDeg.toFixed(4)} °/m²`;

for (const seed of SEEDS) {
  test(`seed ${seed}: C2 at every ramp joint the words laid (the bank, the cup and the edges step their curvature at no joint)`, () => {
    const { doc, open, words } = trackOf(seed), bad = c2Steps(doc, open).filter((e) => e.by === 'words' && Math.abs(e.dkDeg) > CN.TOL_K);
    assert.deepEqual(bad.map(say), [], `seed ${seed}, words ${JSON.stringify(words)}`);
  });
  test(`seed ${seed}: C2 at the seam and at the joints Close moved`, () => {
    const { doc, open, closed, words } = trackOf(seed);
    if (!closed) return;   // an open track has no seam and nothing the close moved
    const bad = c2Steps(doc, open).filter((e) => e.by === 'close' && Math.abs(e.dkDeg) > CN.TOL_K);
    assert.deepEqual(bad.map(say), [], `seed ${seed} (closed), words ${JSON.stringify(words)}`);
  });
}
