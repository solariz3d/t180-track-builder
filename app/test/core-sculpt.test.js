// core-sculpt.test.js: node --test app/test/core-sculpt.test.js   (under the heavy-run lock)
// D244b, SCULPT (the keeper, 09:17: "a separate mode to sculpt pieces once they are already put down, so they don't change the structure of the rest of the track, it's mostly just banking and
// cupping tweaks"). The shell's Sculpt mode (app/core/coreshell.js setSculpt, beginSculpt, sculptTo, endSculpt) and its guard (app/core/centreline.js). GEOMETRY tier for the guard: the claim
// is that the CENTRELINE is bit-identical, so the rows compare every sample's position and tangent with Object.is, at the preview's step (2 m) and a finer one (1 m). Rows:
//   1  every shape channel, on every kind of piece it applies to, leaves every centreline sample bit-identical (and the document did change)
//   2  one drag is ONE undo step, and Undo gives back the very same document
//   3  the joints stay C1: the sculpted piece's value and slope at both ends are what they were, and every other piece is the very same object
//   4  turn and climb cannot be chosen in Sculpt (nor the height and sideways brush): refused BY NAME, no drag opens, nothing changes; Sculpt off, no selection, a flight, a run: refused
//   5  the runtime guard refuses by name when a change WOULD move the centreline: a closed tube's width and bank (its heartline is its width / 2π), and a brush that steers; the drag stays at its last good step
//   6  the guard itself: routeMoved names each thing that moved, pathMoved finds a sample that moved, and both say null for the same track
//   7  the selection survives a Sculpt drag (the handles stay on the piece), and a Sculpt step is a state change like any other (one lastStep, dirty)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell, SCULPT_CHANNELS } = require('../core/coreshell.js');
const CL = require('../core/centreline.js');
const XS = require('../core/xsec.js');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');

const R = 180, Q = (Math.PI * R) / 2;
const EDGE = XS.CHANNEL.edge;

/** An open track of five pieces (a straight, three turns, a straight) of one kind: legacy, cup, edge or tube. Piece 2 is a turn. */
async function mk(kind, opts = {}) {
  const s = await createCoreShell({ autosaveMs: 0, ...opts });
  if (kind === 'cup') { s.extend({ length: 300, family: 'bowl', first: { c: 45 } }); for (let i = 0; i < 3; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R, c: 45 } }); s.extend({ length: 100, transition: 40, targets: { kh: 0, c: 45 } }); }
  else if (kind === 'opentube') { s.extend({ length: 300, first: { w: 40, t: 200 } }); for (let i = 0; i < 3; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 100, transition: 40, targets: { kh: 0 } }); }
  else if (kind === 'tube') { s.extend({ length: 300, first: { w: 40, t: 360 } }); for (let i = 0; i < 3; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 100, transition: 40, targets: { kh: 0 } }); }
  else if (kind === 'edge') { s.extend({ length: 300, family: 'bowl', first: { [EDGE]: 20 } }); for (let i = 0; i < 3; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R, [EDGE]: 20 } }); s.extend({ length: 100, transition: 40, targets: { kh: 0 } }); }
  else { s.extend({ length: 300, family: 'bowl' }); for (let i = 0; i < 3; i++) s.extend({ length: Q, transition: 40, targets: { kh: (i % 2 ? -1 : 1) / R } }); s.extend({ length: 100, transition: 40, targets: { kh: 0 } }); }
  assert.equal(s.getState().message, null, s.getState().message); assert.equal(s.getState().history.present.pieces.length, 5);
  return s;
}
const DELTA = { phi: 0.2, w: 5, r: 1, c: 10, e: 10, s: 0.05, t: -30 };
/** The channel -> the kinds of piece it applies to (a cup brush needs a cup piece, an edge brush an edge piece, a tube brush a tube). */
// A CLOSED tube (sweep 300 to 360) is not here for bank, width or sweep: its roll axis is its own heartline (adapter.js heartlineOf, width / 2π, growing from sweep 300 to 360),
// so those DO feed the route and the guard refuses them (row 5); an open tube's heartline is 0.
const APPLIES = { phi: ['legacy', 'cup', 'edge', 'opentube'], w: ['legacy', 'cup', 'edge', 'opentube'], r: ['legacy', 'cup', 'edge', 'opentube', 'tube'], c: ['cup'], e: ['edge'], s: ['edge'], t: ['opentube'] };
const sculptOnce = (s, ch, piece = 2, delta = DELTA[ch]) => { s.setSculpt(true); s.selectPiece(piece); s.beginSculpt({ channel: ch }); const opened = !!s.getState().brush; s.sculptTo(delta); s.endSculpt(); return opened; };

test('row 1: a sculpt of each shape channel, on each kind of piece it applies to, leaves every centreline sample bit-identical', async () => {
  let rows = 0;
  for (const [ch, kinds] of Object.entries(APPLIES)) for (const kind of kinds) {
    const s = await mk(kind), before = s.getState().history.present, snap2 = CL.snapshot(s.getState().resolved, 2), snap1 = CL.snapshot(s.getState().resolved, 1);
    assert.ok(snap2.length > 300, 'control: a real centreline');
    assert.equal(sculptOnce(s, ch), true, `${ch} on ${kind}: the drag opened (${s.getState().message})`);
    const st = s.getState(); assert.equal(st.message, null, `${ch} on ${kind}: ${st.message}`); assert.notEqual(st.history.present, before, `${ch} on ${kind}: the document did change`);
    assert.equal(CL.pathMoved(snap2, st.resolved, 2), null, `${ch} on ${kind}: centreline at 2 m`); assert.equal(CL.pathMoved(snap1, st.resolved, 1), null, `${ch} on ${kind}: centreline at 1 m`);
    assert.deepEqual(Array.from(CL.snapshot(st.resolved, 2)), Array.from(snap2), `${ch} on ${kind}: every number the same`); rows++;
  }
  assert.equal(rows, 17,'every channel and kind that applies was run');
});

test('row 2: one drag is ONE undo step (three moves, one step), and Undo gives back the very same document', async () => {
  const s = await mk('cup'), before = s.getState().history.present; s.setSculpt(true); s.selectPiece(2);
  const n0 = s.getState().history.past.length;
  s.beginSculpt({ channel: 'phi' }); for (const d of [0.05, 0.1, 0.2]) { s.sculptTo(d); assert.equal(s.getState().history.past.length, n0, 'a step inside a drag is not a history entry'); } s.endSculpt();
  const after = s.getState().history.present; assert.notEqual(after, before); assert.equal(s.getState().history.past.length, n0 + 1, 'ONE undo step');
  s.undo(); assert.equal(s.getState().history.present, before, 'Undo: the very same document'); s.redo(); assert.equal(s.getState().history.present, after, 'Redo: the same one again');
  assert.equal(s.getState().message, null);
});

test('row 3: the joints stay C1: the sculpted piece\'s value and slope at both ends are what they were, and every other piece is the very same object', async () => {
  for (const [kind, ch] of [['legacy', 'phi'], ['cup', 'c'], ['cup', 'w'], ['edge', 'e']]) {
    const s = await mk(kind), d0 = s.getState().history.present; assert.equal(sculptOnce(s, ch), true); const d1 = s.getState().history.present;
    d1.pieces.forEach((P, i) => { if (i !== 2) assert.equal(P, d0.pieces[i], `${kind} ${ch}: piece ${i} is the same object`); });
    for (const u of [0, d0.pieces[2].length]) for (const c of D.CHANNELS) {
      if (d0.pieces[2].channels[c] === undefined) continue;
      const a = D.channelAt(d0.pieces[2], c, u), b = D.channelAt(d1.pieces[2], c, u);
      assert.equal(b.v, a.v, `${kind} ${ch}: ${c} at ${u} m: the value`); assert.equal(b.d1, a.d1, `${kind} ${ch}: ${c} at ${u} m: the slope`);
    }
    assert.notDeepEqual(d1.pieces[2].channels[ch], d0.pieces[2].channels[ch], `${kind} ${ch}: control: the piece itself did change`);
  }
});

test('row 4: turn and climb cannot be chosen in Sculpt (nor height or sideways): refused BY NAME, no drag opens, nothing changes; and the other refusals', async () => {
  assert.deepEqual(SCULPT_CHANNELS.slice().sort(), ['c', 'e', 'phi', 'r', 's', 't', 'w'], 'bank, cup, width, edge angle, edge start, wall rise, tube sweep');
  for (const ch of ['kh', 'kv', 'h', 'l']) assert.ok(!SCULPT_CHANNELS.includes(ch), `${ch} is not offered`);
  const s = await mk('legacy'), before = s.getState().history.present; s.setSculpt(true); s.selectPiece(2);
  for (const ch of ['kh', 'kv']) { s.beginSculpt({ channel: ch }); assert.equal(s.getState().brush, null, `${ch}: no drag opened`); assert.match(s.getState().message, /^SCULPT_CHANNEL: Sculpt offers only the shape channels/); assert.match(s.getState().message, new RegExp(`"${ch}"`)); }
  s.beginBrush({ mode: 'local', channel: 'height', s0: 400, r: 50 }); assert.equal(s.getState().brush, null); assert.match(s.getState().message, /^SCULPT_CHANNEL: .*the height brush/);
  s.beginBrush({ mode: 'rate', channel: 'kh', s0: 400, r: 50 }); assert.equal(s.getState().brush, null, 'the brush itself, with Sculpt on, refuses a turn brush too');
  assert.equal(s.getState().history.present, before, 'nothing changed');
  // Sculpt off: the brush is as it was, and a turn brush DOES steer (the control: the same call moves the centreline)
  const snapPre = CL.snapshot(s.getState().resolved);
  s.setSculpt(false); s.beginBrush({ mode: 'rate', channel: 'kh', s0: 400, r: 50 }); assert.ok(s.getState().brush, 'Sculpt off: the turn brush opens'); s.brushTo(1e-3); s.endBrush();
  assert.notEqual(CL.pathMoved(snapPre, s.getState().resolved), null, 'control: with Sculpt off a turn brush moves the centreline');
  // beginSculpt's own refusals
  const t = await mk('legacy'); t.beginSculpt({ channel: 'phi' }); assert.match(t.getState().message, /^SCULPT_OFF/);
  t.setSculpt(true); t.beginSculpt({ channel: 'phi' }); assert.match(t.getState().message, /select ONE piece/); t.selectPiece(1); t.selectPiece(3, { extend: true }); t.beginSculpt({ channel: 'phi' }); assert.match(t.getState().message, /select ONE piece/, 'a run is not one piece');
  const flight = D.appendPiece(t.getState().history.present, D.flightPiece({ forward: 20, up: -1, pitch: 0 })); t.commitDoc(flight); t.beginSculpt({ channel: 'phi', piece: flight.pieces.length - 1 }); assert.match(t.getState().message, /^SCULPT_PIECE/);
  t.beginSculpt({ channel: 'phi', piece: 99 }); assert.match(t.getState().message, /^SCULPT_PIECE/, 'a piece that does not exist');
});

test('row 5: the guard refuses BY NAME when a change would move the centreline: a closed tube\'s width and bank, and a brush that steers; the drag stays at its last good step', async () => {
  // a closed tube's roll axis leaves the road centre (the heartline is width / 2π), so its width and bank DO feed the route: Sculpt refuses them, and the track is as it was
  for (const ch of ['w', 'phi', 't']) {
    const s = await mk('tube'), before = s.getState().history.present, snap = CL.snapshot(s.getState().resolved);
    s.setSculpt(true); s.selectPiece(2); s.beginSculpt({ channel: ch }); assert.ok(s.getState().brush, `${ch}: the drag opens`); s.sculptTo(ch === 'w' ? 5 : ch === 't' ? -30 : 0.2);
    assert.match(s.getState().message, /^SCULPT_MOVES_CENTRELINE: Sculpt can't do that: p3 is a tube past 300° of sweep, where it turns about its own centre, so changing its sweep, width or bank would move the road after it\./, `${ch}: ${s.getState().message}`);   // (D243 F3: the reason in plain words)
    assert.doesNotMatch(s.getState().message, /heartline|roll[01]|segment \d|undefined/, `${ch}: no internal field names`);
    s.endSculpt(); assert.equal(CL.pathMoved(snap, s.getState().resolved), null, `${ch}: the centreline is where it was`);
    assert.equal(s.getState().history.present.pieces[2].channels[ch], before.pieces[2].channels[ch], `${ch}: the piece is as it was (the refused step was never applied)`);
  }
  // a brush that steers, smuggled in as the shell's brush function (the guard does not trust the channel list): refused by name, at the step
  // (one interior control point of the turn rate: the joints stay C1, so the core accepts the document and only the guard can refuse it)
  const steer = (doc, o) => { const P = doc.pieces[2], kh = P.channels.kh.map((x, i, a) => (i === Math.floor(a.length / 2) ? x + 1e-4 : x)); return { doc: Object.freeze(D.checkDoc({ ...doc, pieces: Object.freeze(doc.pieces.map((p, i) => (i === 2 ? Object.freeze({ ...P, channels: Object.freeze({ ...P.channels, kh: Object.freeze(kh) }) }) : p))) })), changed: [], note: null }; };
  const s = await mk('legacy', { brushFn: steer }); const before = s.getState().history.present, snap = CL.snapshot(s.getState().resolved);
  s.setSculpt(true); s.selectPiece(2); s.beginSculpt({ channel: 'phi' }); s.sculptTo(0.1); assert.match(s.getState().message, /^SCULPT_MOVES_CENTRELINE: Sculpt can't do that: it would change the turn or climb of p3, and that steers everything after it./, s.getState().message);
  s.endSculpt(); assert.equal(CL.pathMoved(snap, s.getState().resolved), null, 'the steering step was never applied'); assert.equal(s.getState().history.present, before);
  // a good step, then a bad one: the drag stays at the good one
  let calls = 0; const half = (doc, o) => (++calls === 1 ? require('../../src/core/sculpt.js').brush(doc, { mode: 'value', channel: o.channel, s0: o.s0, r: o.r, delta: o.delta }) : steer(doc, o));
  const g = await mk('legacy', { brushFn: half }); g.setSculpt(true); g.selectPiece(2); g.beginSculpt({ channel: 'phi' }); g.sculptTo(0.1); const good = g.getState().history.present; assert.equal(g.getState().message, null); g.sculptTo(0.2);
  assert.match(g.getState().message, /^SCULPT_MOVES_CENTRELINE/); assert.equal(g.getState().history.present, good, 'the drag stays at its last good step'); g.endSculpt();
  assert.equal(g.getState().history.past.length, 6, 'and ends as one step: the five extends, then the good sculpt');
});

test('row 6: the guard itself: routeMoved names each thing that moved, pathMoved finds a sample, and both say null for the same track', async () => {
  const s = await mk('cup'), st = s.getState(), d = st.history.present, segs = st.resolved.segments, start = st.resolved.start;
  assert.equal(CL.routeMoved(d, segs, d, segs, start, start), null, 'the same track'); assert.equal(CL.pathMoved(st.resolved, st.resolved), null);
  const mut = (f) => segs.map((g, i) => (i === 40 ? f({ ...g }) : g));
  for (const [name, f] of [['k0', (g) => ({ ...g, k0: g.k0 + 1e-9 })], ['k1', (g) => ({ ...g, k1: g.k1 + 1e-9 })], ['kp0', (g) => ({ ...g, kp0: g.kp0 + 1e-9 })], ['kp1', (g) => ({ ...g, kp1: g.kp1 + 1e-9 })], ['length', (g) => ({ ...g, length: g.length + 1e-9 })], ['heartline', (g) => ({ ...g, heartline: 1 })]])
    assert.match(CL.routeMoved(d, segs, d, mut(f), start, start), new RegExp(`segment 40\\): ${name} moved`), `${name} is named`);
  assert.match(CL.routeMoved(d, segs, d, segs.slice(1), start, start), /the number of segments changed/);
  assert.match(CL.routeMoved(d, segs, d, mut((g) => ({ ...g, id: 'x' })), start, start), /not the same piece/);
  assert.match(CL.routeMoved(d, segs, d, segs, start, { ...start, theta: start.theta + 1e-12 }), /the start theta moved/); assert.match(CL.routeMoved(d, segs, d, segs, start, { ...start, pos: [1, 0, 0] }), /the start position moved/);
  // roll moves the centre only where a heartline is in play: a roll change on a plain segment is NOT a route change, on a heartline segment it is
  assert.equal(CL.routeMoved(d, segs, d, mut((g) => ({ ...g, roll1: g.roll1 + 0.3 })), start, start), null, 'bank alone does not steer');
  const hl = segs.map((g, i) => (i === 40 ? { ...g, heartline: 2, heartline1: 2, rollRate0: 0, rollRate1: 0 } : g)), hl2 = hl.map((g, i) => (i === 40 ? { ...g, roll1: g.roll1 + 0.3 } : g));
  assert.match(CL.routeMoved(d, hl, d, hl2, start, start), /roll1 moved/, 'with a heartline, roll does');
  const offsets = { ...d, pieces: d.pieces.map((P, i) => (i === 2 ? { ...P, channels: { ...P.channels, h: [0, 1, 0, 0, 0] } } : P)) }; assert.match(CL.routeMoved(d, segs, offsets, segs, start, start), /height or sideways offset/);
  // the direct check: a path built from segments that differ in one sample's worth finds the sample
  const moved = { ...st.resolved, segments: mut((g) => ({ ...g, k1: g.k1 + 1e-6 })) };
  assert.match(CL.pathMoved(st.resolved, moved), /^sample \d+: (position|tangent) [xyz] moved from/); assert.match(CL.pathMoved(st.resolved, { ...st.resolved, segments: segs.slice(0, 30) }), /the centreline has \d+ samples, it had \d+/);
});

test('row 7: the selection survives a Sculpt drag (the handles stay on the piece); a Sculpt step is a state change like any other', async () => {
  const s = await mk('cup'); s.setSculpt(true); s.selectPiece(2); const info0 = s.sculptInfo(); assert.equal(info0.index, 2); assert.equal(info0.id, s.getState().history.present.pieces[2].id); assert.equal(info0.hasCup, true);
  const P2 = s.getState().history.present.pieces[2]; close(info0.values.c, 45, 1e-6); close(info0.values.w, D.channelAt(P2, 'w', P2.length / 2).v, 1e-12); close(info0.halfAt(0.5), info0.values.w / 2, 1e-12);
  const phi0 = info0.values.phi;
  let notes = 0; s.subscribe(() => { notes++; });
  s.beginSculpt({ channel: 'phi' }); s.sculptTo(0.1); assert.equal(s.sculptInfo().index, 2, 'still selected mid-drag'); assert.ok(s.getState().dirty); assert.equal(s.getState().lastStep.op, 'brush:rate'); s.sculptTo(0.2); s.endSculpt();
  assert.equal(s.sculptInfo().index, 2, 'and after it'); assert.ok(s.sculptInfo().values.phi > phi0 + 1, `bank rose at the middle: ${phi0} to ${s.sculptInfo().values.phi} degrees`);
  assert.ok(notes >= 3, 'each step told the subscribers');
  s.setSculpt(false); assert.equal(s.sculptInfo(), null, 'Sculpt off: no handles'); s.setSculpt(true); s.selectPiece(0); assert.equal(s.sculptInfo().index, 0);
  s.beginSculpt({ channel: 'phi' }); s.setSculpt(false); assert.match(s.getState().message, /finish the brush drag first/, 'the switch waits for the drag'); s.endSculpt(); s.setSculpt(false); assert.equal(s.getState().sculpt, false);
  const cl = await mk('legacy'); cl.setSculpt(true); assert.equal(cl.sculptInfo(), null, 'nothing selected: no info');
});
test('row 8: a SHORT piece (under the brush\'s smallest window, 120 m) is sculpted inside itself: the neighbours are the very same objects, the centreline is bit-identical, and the "widened" note is not said; a change that DID reach a neighbour is said', async () => {
  const D2 = require('../../src/core/document.js'), SCm = require('../../src/core/sculpt.js');
  for (const L of [60, 100, 119, 120, 200]) {
    const s = await createCoreShell({ autosaveMs: 0 }); for (let i = 0; i < 5; i++) s.extend({ length: L, transition: 20, targets: { kh: (i % 2 ? -1 : 1) * 0.002 } });
    s.setSculpt(true); s.selectPiece(2); const d0 = s.getState().history.present, snap = CL.snapshot(s.getState().resolved);
    s.beginSculpt({ channel: 'phi' }); s.sculptTo(0.2); assert.equal(s.getState().message, null, `${L} m: no widened note: ${s.getState().message}`); s.endSculpt();
    const d1 = s.getState().history.present; d1.pieces.forEach((p, i) => { if (i !== 2) assert.equal(p, d0.pieces[i], `${L} m: piece ${i} is the very same object`); });
    assert.equal(CL.pathMoved(snap, s.getState().resolved), null, `${L} m: the centreline`); const peak = D2.channelAt(d1.pieces[2], 'phi', L / 2).v - D2.channelAt(d0.pieces[2], 'phi', L / 2).v;
    assert.ok(peak > 0.15 && peak <= 0.2 + 1e-9, `${L} m: the middle rose by ${peak} of the asked 0.2 rad`);
  }
  // the note when a neighbour really changed: a brush function that reports a second piece as changed
  const spill = (doc, o) => { const r = SCm.brush(doc, o); return { ...r, changed: [...r.changed, { piece: 1, indices: [0] }] }; };
  const t = await mk('legacy', { brushFn: spill }); t.setSculpt(true); t.selectPiece(2); t.beginSculpt({ channel: 'phi' }); t.sculptTo(0.1);
  assert.match(t.getState().message, /Sculpt also changed p2 at the joint/, t.getState().message); t.endSculpt();
});
test('row 9 (D243 F3): the refusal says the REAL reason in plain words, never an internal field: an OPEN tube whose sweep would cross 300°, a closed tube, a steering change, and every other kind', async () => {
  // C's case: an OPEN tube at 290° and a sweep drag of +20: the segments gain a heartline field, the sweep passes 300°
  const s = await createCoreShell({ autosaveMs: 0 }); s.extend({ length: 300, first: { w: 40, t: 290 } }); for (let i = 0; i < 3; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } }); s.extend({ length: 100, transition: 40, targets: { kh: 0 } });
  s.setSculpt(true); s.selectPiece(2); s.beginSculpt({ channel: 't' }); s.sculptTo(20); const m = s.getState().message;
  assert.match(m, /^SCULPT_MOVES_CENTRELINE: Sculpt can't do that: the sweep of p3 would pass 300°, where a tube starts to turn about its own centre, and that would move the road after it\./, m);
  assert.doesNotMatch(m, /heartline|roll[01]|segment \d|undefined|moved from/, 'no internal field name, no "undefined"'); s.endSculpt();
  // the technical sentence is still there for whoever reads the log (routeMoved), and the structure behind the words
  const T = (kind, extra = {}) => CL.plainWhy({ kind, ...extra });
  assert.match(T('field', { id: 'p3', field: 'heartline1', from: undefined, to: 0 }), /would pass 300°/); assert.match(T('field', { id: 'p3', field: 'heartline', from: 6.37, to: 6.5 }), /p3 is a tube past 300° of sweep/); assert.match(T('field', { id: 'p3', field: 'roll1', from: 0, to: 0.1 }), /past 300° of sweep/);
  assert.match(T('field', { id: 'p2', field: 'k0', from: 0, to: 1 }), /turn or climb of p2/); assert.match(T('field', { id: 'p2', field: 'kp1', from: 0, to: 1 }), /turn or climb of p2/); assert.match(T('field', { id: 'p2', field: 'length', from: 1, to: 2 }), /length of p2/);
  assert.match(T('start'), /where the track starts/); assert.match(T('offsets'), /height or sideways offset/); assert.match(T('segments'), /how the track is built/); assert.match(T('piece', { id: 'p4' }), /how the track is built/); assert.equal(CL.plainWhy(null), '');
  for (const k of ['field', 'start', 'offsets', 'segments', 'piece']) assert.doesNotMatch(T(k, { id: 'p1', field: 'k1', from: undefined, to: 0 }), /undefined|\b(?:k0|k1|kp0|kp1|heartline|roll)\w*\b/, `${k}: plain`);
  // routeMovedDetail agrees with routeMoved on what moved
  const st = (await mk('cup')).getState(), segs = st.resolved.segments, mut = segs.map((g, i) => (i === 40 ? { ...g, k1: g.k1 + 1e-9 } : g)), det = CL.routeMovedDetail(st.history.present, segs, st.history.present, mut, st.resolved.start, st.resolved.start);
  assert.equal(det.text, CL.routeMoved(st.history.present, segs, st.history.present, mut, st.resolved.start, st.resolved.start)); assert.deepEqual([det.kind, det.field, det.seg], ['field', 'k1', 40]);
});

function close(a, b, eps) { assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`); return true; }

// D259, the keeper (18:21-18:24): the bank "continues after 360 forever instead of resetting back to 0 ... same for -360 if it banks the other way". The bank keeps within
// ONE turn and keeps its SIGN, shown and applied (370 -> 10, -370 -> -10, 300 stays 300, 400 -> 40), in the Extend field and ghost handle, Sculpt's bank handle and the bank
// brush; no nearest-equivalent rewrite; the stored winding of existing tracks and the core are untouched.
const DEGR = Math.PI / 180;
const midBank = (s) => s.sculptInfo().values.phi;
const sculptBank = (s, deg) => { s.beginSculpt({ channel: 'phi' }); s.sculptTo(deg * DEGR); s.endSculpt(); };
// the brush fits its change into the piece's control points, so its centre does not land EXACTLY on the asked value: its gain there is measured 0.985 (brush,
// piece 0) to 0.995 (Sculpt, piece 2), with or without D259. So each check is the RULE, within 3% of the change sent: within one turn, its sign kept, at
// wrapTurn(b0 + delta), where b0 is the bank as it really is under the drag
const turn = (x) => x % 360;
const near = (got, want, b0, what) => assert.ok(Math.abs(got) < 360 && Math.abs(got - want) <= 0.03 * Math.abs(want - b0) + 1e-6, `${what}: got ${got}, want ${want} (from ${b0})`);
test('D259: a Sculpt bank drag from 350 by +20 gives about 10, from -350 by -20 about -10, and 300 stays about 300; the handle\'s label agrees', async () => {
  const HD = require('../core/handles.js');
  for (const [first, then] of [[350, 20], [-350, -20], [300, 0]]) {
    const s = await mk('legacy'); s.setSculpt(true); s.selectPiece(2); assert.ok(Math.abs(midBank(s)) < 1e-6, 'control: the piece starts upright');
    sculptBank(s, first); const b0 = midBank(s); near(b0, first, 0, `first to ${first}`);
    if (then) { sculptBank(s, then); near(midBank(s), turn(b0 + then), b0, `${b0.toFixed(2)} by ${then}`); assert.equal(Math.sign(midBank(s)), Math.sign(first), 'its sign kept'); }
  }
  assert.equal(HD.format('bank', 370), 'bank 10.0°'); assert.equal(HD.format('bank', -370), 'bank -10.0°'); assert.equal(HD.format('bank', 300), 'bank 300.0°'); assert.equal(HD.format('bank', 360), 'bank 0.0°');
});
test('D259: a value brush on bank that would take the bank past one turn wraps it back from 0 (by +370 gives about 10), and within a turn it is applied as given (+300)', async () => {
  const at = (s) => D.channelAt(s.getState().history.present.pieces[0], 'phi', 150).v / DEGR;
  for (const by of [370, 300, -370]) {
    const s = await mk('legacy'); const b0 = at(s); assert.ok(Math.abs(b0) < 1e-6, 'control: upright under the brush');
    s.beginBrush({ mode: 'rate', channel: 'phi', s0: 150, r: 100 }); s.brushTo(by * DEGR); s.endBrush();
    near(at(s), turn(b0 + by), b0, `a brush by ${by} at its centre`);
  }
});
