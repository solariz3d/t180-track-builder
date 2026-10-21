// core_segcache.test.js: node --test test/core_segcache.test.js
// The segment cache (the keeper, 2026-10-12: "there is a solid lag when putting the pieces down still"). The window's shell keeps a
// cache so a placement converts only the pieces that changed (src/core/adapter.js toSegments `cache`). The cache is only worth having
// if it is INVISIBLE: after every kind of edit the shell's segments must equal a fresh, uncached conversion of the same document,
// number for number (isDeepStrictEqual: -0 and 0 differ, NaN equals NaN). Rows:
//   1  after every edit the window makes (each family and option of Extend, a jump, a brush, undo, redo, a removal, a close),
//      the cached segments equal the uncached ones, and an unchanged piece's segments are reused, not rebuilt
//   2  every saved fixture (F1-F8: closed laps, families, a brushed r, a jump, mixed families), opened and then extended: equal
//   3  a cached segment is frozen all the way down, so a reader that writes to a shared one throws instead of changing another document's
//   4  without a cache (the export, close and level callers) nothing changes: fresh, unfrozen segments every call
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const D = require('../src/core/document.js');
const AD = require('../src/core/adapter.js');
const { createCoreShell } = require('../app/core/coreshell.js');

const R = 180, Q = (Math.PI * R) / 2;
const doc = (s) => s.getState().history.present;

/** The shell's segments equal a fresh uncached conversion of the document it holds. */
function same(s, what) {
  const d = doc(s), got = s.getState().resolved.segments, want = d.pieces.length ? AD.toSegments(d) : [];
  assert.equal(got.length, want.length, `${what}: segment count`);
  const bad = got.findIndex((g, i) => !isDeepStrictEqual(g, want[i]));
  assert.equal(bad, -1, `${what}: segment ${bad} differs from a fresh conversion`);
}

test('row 1: after every kind of edit the cached segments equal a fresh conversion, and unchanged pieces are reused', async () => {
  const s = await createCoreShell({});
  const step = (what, fn) => { fn(); const m = s.getState().message; assert.ok(m === null || /^(undid|redid): /.test(m), `${what}: ${m}`); same(s, what); };   // undo and redo name their step (2026-10-13)
  step('bowl', () => s.extend({ length: 300, family: 'bowl' }));
  step('turn', () => s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }));
  step('straighten', () => s.extend({ length: 60, transition: 40, targets: { kh: 0 } }));
  step('tube', () => s.extend({ length: 300, first: { w: 40, t: 360 } }));
  step('cup out of a tube', () => s.extend({ length: 300, first: { c: 60 } }));
  step('cup turn', () => s.extend({ length: Q, transition: 40, targets: { kh: 1 / R, c: 45 } }));
  step('plain', () => s.extend({ length: 200 }));
  step('jump', () => s.commitDoc(D.appendPiece(doc(s), D.flightPiece({ forward: 30, left: 0, up: 0, heading: 0, pitch: 0, bank: 0 }))));
  step('landing road', () => s.extend({ length: 150 }));
  // reuse: placing one more piece keeps every earlier piece's segment objects
  const before = s.getState().resolved.segments;
  step('one more', () => s.extend({ length: 120 }));
  const after = s.getState().resolved.segments, reused = before.filter((g, i) => after[i] === g).length;
  assert.ok(reused >= before.length - 200, `the earlier pieces were reused (${reused} of ${before.length} kept; only the last piece may change)`);
  step('brush', () => { s.beginBrush({ channel: 'height', s0: 150, r: 60 }); s.brushTo(4); s.endBrush(); });
  step('undo', () => s.undo());
  step('undo again', () => s.undo());
  step('redo', () => s.redo());
  step('remove the last piece', () => s.commitDoc({ ...doc(s), pieces: doc(s).pieces.slice(0, -1) }));
  // a real closed lap through the shell's own close (it may decline this track; the segments must match either way)
  const lap = await createCoreShell({});
  lap.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) lap.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  lap.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  same(lap, 'the lap before closing');
  lap.close(); assert.equal(doc(lap).closed, true, `the lap closed: ${lap.getState().message}`); same(lap, 'closed lap');
  lap.undo(); same(lap, 'close undone');
});

test('row 1b: a climb brushed on a piece BEFORE a jump changes the jump that follows it, though the jump piece itself is untouched (the cache keys the pitch carried in)', async () => {
  const s = await createCoreShell({});
  s.extend({ length: 300, family: 'bowl' });
  s.commitDoc(D.appendPiece(doc(s), D.flightPiece({ forward: 30, left: 0, up: 0, heading: 0, pitch: 0, bank: 0 })));
  s.extend({ length: 150 });
  same(s, 'road, jump, landing road');
  const flight = doc(s).pieces[1], gapBefore = s.getState().resolved.segments.find((g) => g.kind === 'gap');
  s.beginBrush({ mode: 'rate', channel: 'kv', s0: 150, r: 60 }); s.brushTo(0.002); s.endBrush();
  assert.equal(doc(s).pieces[1], flight, 'the brush left the jump piece itself as it was (the case a cache keyed on the piece alone gets wrong)');
  same(s, 'after a climb brush on the first piece');
  assert.notEqual(s.getState().resolved.segments.find((g) => g.kind === 'gap').length, gapBefore.length, 'and the jump did change: its flight starts at a new pitch');
});

test('row 2: every saved fixture, opened and extended, gives the same segments as a fresh conversion', async () => {
  const dir = path.join(__dirname, 'fixtures'), files = fs.readdirSync(dir).filter((f) => /^F\d.*\.core2\.json$/.test(f));
  assert.ok(files.length >= 8, `the fixtures are there (${files.length})`);
  for (const f of files) {
    const d = D.parse(fs.readFileSync(path.join(dir, f), 'utf8')), s = await createCoreShell({});
    s.commitDoc(d); same(s, `${f} opened`);
    if (!d.closed && d.pieces.length) { s.extend({ length: 100 }); same(s, `${f} extended`); }
  }
});

test('row 2b: each fixture grown piece by piece through ONE cache, then shrunk back, equals a fresh conversion at every length (a cup followed by a legacy piece, which Extend never makes, is in a file)', () => {
  const dir = path.join(__dirname, 'fixtures');
  for (const f of fs.readdirSync(dir).filter((x) => /^F\d.*\.core2\.json$/.test(x))) {
    const d = D.parse(fs.readFileSync(path.join(dir, f), 'utf8')), cache = new WeakMap(), n = d.pieces.length;
    const lengths = [...Array(n).keys()].map((k) => k + 1).concat([...Array(Math.max(0, n - 1)).keys()].map((k) => n - 1 - k));
    for (const k of lengths) {
      let prefix; try { prefix = { ...d, closed: k === n ? d.closed : false, pieces: d.pieces.slice(0, k) }; D.checkDoc(prefix); } catch (e) { continue; }   // a prefix the core refuses is not a document
      assert.ok(isDeepStrictEqual(AD.toSegments(prefix, { cache }), AD.toSegments(prefix)), `${f}: ${k} of ${n} pieces`);
    }
  }
});

test('row 2c: the SAME later piece after a changed earlier one is rebuilt, because what it morphs from changed (the cache keys the incoming cross-section, not only the piece)', async () => {
  // D421 (C): this row was WRONG and never tested what it names. Its leads were 'halfpipe' (not a family: the name is 'half-pipe', so making the lead threw
  // and was skipped), 'flat' (a fresh lead of flat's own width, refused at the joint, skipped) and 'bowl' (the lead the document already had). So the cache was
  // only ever asked about the lead it already held, and a key that compared the carried cross-section by its keys alone passed (C's mutant A3). Now:
  // (a) every family, as the SAME lead piece with only its family changed (so the joint holds), each one counted as run; and (b) the case where the carried
  // numbers reach the follower: a tube made by Extend's targets straight after a legacy lead (it morphs out of the lead's last row, u and ψ), the lead's end
  // width one quantum apart, which the joint allows (a family change at that joint is refused, and within one kind a follower does not read the numbers).
  const s = await createCoreShell({}); s.extend({ length: 300, family: 'bowl' }); s.extend({ length: 300, first: { w: 40, t: 360 } });
  const d = doc(s), tube = d.pieces[1], cache = new WeakMap();
  assert.ok(isDeepStrictEqual(AD.toSegments(d, { cache }), AD.toSegments(d)), 'bowl, then the tube');
  let ran = 0;
  for (const family of D.FAMILIES) {
    const other = { ...d, pieces: [{ ...d.pieces[0], family }, tube] }; D.checkDoc(other);
    assert.ok(isDeepStrictEqual(AD.toSegments(other, { cache }), AD.toSegments(other)), `${family}, then the very same later piece`);
    ran++;
  }
  assert.equal(ran, 3, 'every family reached the cache');
  const t = await createCoreShell({}); t.extend({ length: 300, family: 'bowl' }); t.extend({ length: 300, transition: 40, targets: { t: 120 } });
  const e = doc(t), lead = e.pieces[0], into = e.pieces[1], w = lead.channels.w, ofInto = (segs) => segs.filter((g) => g.id === into.id);
  assert.equal(D.kindOf(into), 'tube', 'control: the follower is a tube entering from a legacy piece');
  const wider = { ...e, pieces: [{ ...lead, channels: { ...lead.channels, w: [...w.slice(0, -1), +(w.at(-1) + 10 ** -D.DEC.w).toFixed(D.DEC.w)] } }, into] };
  D.checkDoc(wider);
  const fresh = AD.toSegments(wider), tcache = new WeakMap();
  assert.ok(!isDeepStrictEqual(ofInto(fresh), ofInto(AD.toSegments(e))), 'control: a lead one width-quantum wider changes the tube that morphs out of it');
  assert.ok(isDeepStrictEqual(AD.toSegments(e, { cache: tcache }), AD.toSegments(e)), 'the bowl, then the tube');
  assert.ok(isDeepStrictEqual(AD.toSegments(wider, { cache: tcache }), fresh), 'the wider lead, then the very same tube object');
});

test('row 2d: a brush step inside the FIRST piece of a closed tube lap rebuilds that piece only: every later piece, handed the same cross-section by value (a new object), is reused (D421: they were rebuilt at every step)', async () => {
  const s = await createCoreShell({});   // A's 360° tube oval (E's probe3 row 4a)
  s.extend({ length: 300, first: { w: 31, t: 360 } });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  s.close(); assert.equal(doc(s).closed, true, s.getState().message);
  const first = doc(s).pieces[0].id;
  s.beginBrush({ channel: 'height', s0: 150, r: 60 });   // a height brush (the Sculpt mode's Grab is the same brush, on its own branch)
  assert.ok(s.getState().brush, `the brush opened: ${s.getState().message}`);
  for (const dy of [0.5, 1, 1.5]) {
    const before = s.getState().resolved.segments;
    s.brushTo(dy);
    assert.ok(s.getState().brush, `the step at ${dy}: ${s.getState().message}`);
    const after = s.getState().resolved.segments, later = after.map((g, i) => [g, i]).filter(([g]) => g.id !== first);
    assert.ok(later.length > 300, `control: the later pieces have ${later.length} segments`);
    const rebuilt = later.filter(([g, i]) => before[i] !== g).length;
    assert.equal(rebuilt, 0, `step ${dy}: ${rebuilt} of ${later.length} segments of the untouched pieces were rebuilt`);
    same(s, `the step at ${dy}`);
  }
  s.endBrush(); same(s, 'released');
});

test('row 3: a cached segment is frozen all the way down, so writing to a shared one throws', async () => {
  const s = await createCoreShell({});
  s.extend({ length: 300, family: 'bowl', first: { c: 45 } });
  const g = s.getState().resolved.segments[0];
  assert.ok(Object.isFrozen(g) && Object.isFrozen(g.profile) && Object.isFrozen(g.profile.u), 'the segment, its profile and the profile\'s arrays');
  assert.throws(() => { g.length = 1; }, TypeError);
  assert.throws(() => { g.profile.u[0] = 1; }, TypeError);
});

test('row 4: without a cache nothing changes: every call builds fresh, unfrozen segments', async () => {
  const s = await createCoreShell({});
  s.extend({ length: 200, family: 'bowl' });
  const d = doc(s), a = AD.toSegments(d), b = AD.toSegments(d);
  assert.notEqual(a[0], b[0], 'a new object each call');
  assert.ok(!Object.isFrozen(a[0]), 'not frozen');
  assert.ok(isDeepStrictEqual(a, b));
});
