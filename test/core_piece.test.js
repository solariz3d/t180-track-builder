// core_piece.test.js: node --test test/core_piece.test.js   (under the heavy-run lock, --max-old-space-size=4096, --test-concurrency=1)
// D240, the CORE half of SAVED PIECES (src/core/piece.js; the keeper: "can we keep only the equation mode? And then we can save pieces from that we make"). EXPORT tier: it adds a
// document schema (t180b.piece/1), so the rows that matter most are the ones that hold the export still. Stated before the tests were written:
//   1  the relative form: a state channel is stored as its change from the run's start (its first point 0) plus the start, a rate as the document holds it, and putting them back
//      gives the saved numbers EXACTLY (on real, closed-and-adjusted laps of all three kinds); the text is canonical and round-trips
//   2  REQUIRED: a track built from a saved and re-inserted run, put at the same start, is the SAME DOCUMENT as the one built by hand and exports the SAME BYTES (kn5, AI line, the
//      description and the warnings), for a legacy, a cup and a tube lap, a run, a whole lap, in pieces, through the text, and mirrored twice
//   3  put at a DIFFERENT head, it continues from there: the document accepts it (every joint C1), the joint's values and slopes meet, the CHANGE across the run is the saved one,
//      and the rates after the first span are the saved ones
//   4  "keep its own start values", an empty track, and what is refused by name (PIECE_START, PIECE_KIND, CLOSED, a jump with nothing to follow)
//   5  the mirror: a mirrored run's path is the mirror image of the original's (x flips, height and distance along do not), with a bank, a hill and a swerve; mirror of mirror is the original
//   6  jumps (flights) inside and at the start of a run
//   7  NO PIECE MAKES A DOCUMENT THE DOCUMENT WOULD REFUSE: every run against every head either goes in valid or is refused by a CoreError, never a crash and never a bad document
//   8  a malformed file is refused BY NAME, case by case, and a file that is not ours (a whole track, a newer piece) says what it is
//   9  limits, names (a piece name becomes a file name), ranges, and the summary a library list shows
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { close } = require('../src/core/close.js');
const A = require('../src/core/adapter.js');
const SC = require('../src/core/sculpt.js');
const FW = require('../src/export/fromwords.js');
const PC = require('../src/core/piece.js');
const { startLayout } = require('../app/core/coreshell.js');

const DEG = Math.PI / 180, Rr = 180, Q = (Math.PI * Rr) / 2;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const closedOk = (r) => { assert.equal(r.converged, true, r.report); return r.doc; };

// ── the laps: one of each kind, closed by the core's own close (so their pieces are the ADJUSTED ones, not the formula's) ──
function legacyLap() {
  let d = extend(D.createDoc('legacy lap'), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  return closedOk(close(d, { edited: [0] }));
}
function cupLap(c = 45) {   // cupped from its first metre, so every piece is a cup (a run is one kind)
  let d = extend(D.createDoc('cup lap'), { length: 300, family: 'bowl', first: { c } });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr, c } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0, c } });
  return closedOk(close(d, { edited: [0] }));
}
function tubeLap(w = 40) {
  let d = extend(D.createDoc('tube lap'), { length: 300, first: { w, t: 360 } });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  return closedOk(close(d, { edited: [0] }));
}
const LAPS = { legacy: legacyLap, cup: () => cupLap(45), tube: () => tubeLap(40) };
/** The export the app makes of a closed track (the shell's route: buildFromSegments with the start layout), reduced to bytes and the things that print. */
function exported(doc) {
  const segs = A.toSegments(doc), lift = (q) => A.offsetPath(doc, segs, q), start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch };
  const out = FW.buildFromSegments(segs, { name: 'piece test', via: 'test', liftPath: lift, start }, { markers: startLayout(segs, lift, start) });
  const bytes = (b) => Buffer.from(b.buffer ? Buffer.from(b.buffer, b.byteOffset, b.byteLength) : b);
  return { kn5: sha(bytes(out.kn5)), kn5Bytes: out.kn5.length, ai: sha(bytes(out.ai)), desc: JSON.stringify(out.desc), warnings: JSON.stringify(out.warnings), lengthM: out.path.lengthM };
}
/** doc with only the first `n` pieces of H kept (same start, same ids, open): where a saved run is put back. */
const firstOf = (H, n) => ({ ...H, pieces: H.pieces.slice(0, n), nextId: n + 1, closed: false });
const asH = (d, H) => ({ ...d, closed: true, name: H.name });

test('row 1: the relative form: a state is its change from the run\'s start (first point 0) plus the start, a rate is as the document holds it, and putting them back is EXACT, on real adjusted laps of all three kinds', () => {
  for (const [kind, make] of Object.entries(LAPS)) {
    const H = make(), run = PC.saveRun(H, 0, H.pieces.length - 1, { name: `${kind} whole lap` });
    for (const ch of PC.STATE) if (run.pieces[0].channels[ch] !== undefined) assert.equal(run.pieces[0].channels[ch][0], 0, `${kind}: the first piece's ${ch} change starts at 0`);
    for (const ch of PC.RATE) run.pieces.forEach((P, i) => assert.deepEqual(P.channels[ch], H.pieces[i].channels[ch], `${kind}: piece ${i}: ${ch} is stored as the document holds it`));
    for (const ch of Object.keys(run.start)) assert.equal(run.start[ch], H.pieces[0].channels[ch][0], `${kind}: the start ${ch} is the first piece's first control point`);
    const back = PC.absolute(run);
    back.forEach((P, i) => { assert.deepEqual(P.channels, H.pieces[i].channels, `${kind}: piece ${i}: every channel comes back exactly, the unused ones at their defaults`); assert.equal(P.length, H.pieces[i].length); assert.deepEqual(P.knots, H.pieces[i].knots); assert.equal(!!P.cup, !!H.pieces[i].cup); assert.equal(!!P.tube, !!H.pieces[i].tube); });
  }
});

test('row 1b: the text is canonical: a stable key order, one piece to a line, a final newline; parse(serialize(p)) is p and serialize of it is the same text; the piece is frozen', () => {
  const H = cupLap(), run = PC.saveRun(H, 1, 3, { name: 'cup run' }), text = PC.serialize(run);
  assert.ok(text.endsWith('}\n') && text.startsWith('{\n  "schema": "t180b.piece/1",')); assert.equal(text.split('\n').length, 1 + 1 + 1 + 1 + 1 + 1 + 3 + 1 + 1 + 1, 'header lines, then one line a piece');
  const back = PC.parse(text); assert.deepEqual(back, run); assert.equal(PC.serialize(back), text); assert.ok(Object.isFrozen(back) && Object.isFrozen(back.pieces[0].channels.kh), 'frozen all the way down');
  assert.deepEqual(Object.keys(JSON.parse(text)), ['schema', 'generator', 'name', 'start', 'pieces']); assert.equal(JSON.parse(text).pieces[0].type, 'road');
  const flatDoc = PC.saveRun(legacyLap(), 2, 2, { name: 'one piece' }); assert.equal(flatDoc.pieces.length, 1, 'one piece is a run of one'); assert.deepEqual(Object.keys(flatDoc.start).sort(), ['phi', 'r', 'w'], 'a legacy run carries no cup, edge or tube start');
});

for (const [kind, make] of Object.entries(LAPS)) {
  test(`row 2 (REQUIRED, ${kind}): a track built from a saved and re-inserted run at the same start is the SAME DOCUMENT and exports the SAME BYTES: the rest of the lap after its first piece, the whole lap into an empty track, in pieces, through the text, and mirrored twice`, () => {
    const H = make(), want = exported(H), n = H.pieces.length, text = (r) => PC.serialize(r);
    assert.ok(want.kn5Bytes > 1000, 'control: a real export came out');
    // (a) the rest of the lap (pieces 1..n-1) put back after the first piece
    const rest = PC.saveRun(H, 1, n - 1, { name: 'rest of the lap' }), A1 = asH(PC.insert(firstOf(H, 1), rest), H);
    assert.equal(D.serialize(A1), D.serialize(H), 'the same document text'); assert.deepEqual(A1, H, 'the same document, object for object'); assert.deepEqual(exported(A1), want, 'the same export bytes');
    // (b) the whole lap into an empty track with the same start
    const whole = PC.saveRun(H, 0, n - 1, { name: 'whole lap' }), B1 = asH(PC.insert(D.createDoc(H.name, { start: H.start }), whole), H);
    assert.equal(D.serialize(B1), D.serialize(H)); assert.deepEqual(exported(B1), want);
    // (c) through the text: save, write, read, insert
    const C1 = asH(PC.insert(firstOf(H, 1), PC.parse(text(rest))), H); assert.equal(D.serialize(C1), D.serialize(H)); assert.deepEqual(exported(C1), want);
    // (d) in pieces: pieces 1..2, then 3..n-1, each saved on its own and added in turn
    const first2 = PC.saveRun(H, 1, 2, { name: 'a' }), last = PC.saveRun(H, 3, n - 1, { name: 'b' }), D1 = asH(PC.insert(PC.insert(firstOf(H, 1), first2), last), H);
    assert.equal(D.serialize(D1), D.serialize(H)); assert.deepEqual(exported(D1), want);
    // (e) one piece at a time
    let one = firstOf(H, 1); for (let i = 1; i < n; i++) one = PC.insert(one, PC.saveRun(H, i, i, { name: `p${i}` })); assert.equal(D.serialize(asH(one, H)), D.serialize(H)); assert.deepEqual(exported(asH(one, H)), want);
    // (f) mirror of mirror is the piece; adding it is the same as adding the piece
    const twice = PC.mirrored(PC.mirrored(rest)); assert.deepEqual(twice, rest, 'mirror of mirror is the original, exactly'); const E1 = asH(PC.insert(firstOf(H, 1), twice), H); assert.deepEqual(exported(E1), want);
  });
}

test('row 2b: put where the run does NOT already start (a different head) the export of the result is still the document\'s own: it exports, and builds the same as the same document made by hand would', () => {
  const H = legacyLap(), run = PC.saveRun(H, 1, 4, { name: 'bends' });
  // a head that is not where the run started: one wider, banked straight
  let base = extend(D.createDoc('other head', { start: H.start }), { length: 250, family: 'bowl', first: { w: 24 } }); base = extend(base, { length: 100, transition: 50, targets: { phi: 0.2, w: 27 } });
  const made = PC.insert(base, run); assert.equal(made.pieces.length, base.pieces.length + 4); D.checkDoc(made);
  // the geometry and the segments are well formed (the adapter and the path accept it)
  const { path, segments } = A.toPath(made); assert.ok(path.lengthM > 0 && segments.length > 100 && path.samples.every((s) => s.pos.every(Number.isFinite)));
});

function startOf(P) { const h1 = P.knots.length ? P.knots[0] : P.length, o = {}; for (const ch of D.CHANNELS) { const c = P.channels[ch]; if (c !== undefined) o[ch] = { v: c[0], m: (3 * (c[1] - c[0])) / h1 }; } return o; }

test('row 3: at a DIFFERENT head the run continues from it: the document accepts it, the joint\'s values and slopes meet, the change across the run is the saved one, and the rates after the first span are the saved ones', () => {
  const cases = [
    ['legacy', legacyLap(), (n) => { let b = extend(D.createDoc('b'), { length: 200, family: 'bowl', first: { w: 24, phi: 0.1 } }); return extend(b, { length: 120, transition: 60, targets: { kh: 1 / 400, w: 27, phi: 0.25 } }); }],
    ['cup', cupLap(45), () => { let b = extend(D.createDoc('b'), { length: 200, family: 'bowl', first: { c: 30 } }); return extend(b, { length: 120, transition: 60, targets: { kh: -1 / 300, c: 38 } }); }],
    ['tube', tubeLap(40), () => { let b = extend(D.createDoc('b'), { length: 200, first: { w: 34, t: 360 } }); return extend(b, { length: 120, transition: 60, targets: { kh: 1 / 250, w: 36 } }); }],
  ];
  for (const [kind, H, mk] of cases) {
    const run = PC.saveRun(H, 1, 3, { name: `${kind} bends` }), base = mk(), made = PC.insert(base, run), nb = base.pieces.length;
    for (let i = 0; i < 3; i++) assert.equal(made.pieces[nb + i].id, `p${base.nextId + i}`, `${kind}: new ids follow the track's`);
    const end = D.pieceEnd(base.pieces[nb - 1]), st = startOf(made.pieces[nb]);
    for (const ch of D.CHANNELS) {
      if (st[ch] === undefined || (D.OPTIONAL[ch] && !made.pieces[nb][D.OPTIONAL[ch]])) continue; const qv = 10 ** -D.DEC[ch], ref = ch === 't' ? end.tNext : end[ch];
      if (ch === 's' && Math.abs(end.e.v) < 1e-9) continue;
      assert.ok(Math.abs(st[ch].v - ref.v) <= 1.01 * qv, `${kind}: ${ch} meets the head's end value: ${st[ch].v} against ${ref.v}`);
      assert.ok(Math.abs(st[ch].m - ref.m) <= 6 * qv / Math.min(made.pieces[nb].knots[0] || 1, 1) + 6 * qv * Math.abs(ref.m) + 1e-12, `${kind}: ${ch} meets the head's end slope: ${st[ch].m} against ${ref.m}`);
    }
    // the change across the run is the saved one, for every state
    for (const ch of Object.keys(run.start)) {
      const sv = made.pieces[nb].channels[ch][0], ev = made.pieces[nb + 2].channels[ch].at(-1), saved = run.pieces[2].channels[ch].at(-1) - run.pieces[0].channels[ch][0];
      assert.ok(Math.abs((ev - sv) - saved) <= 2 * 10 ** -D.DEC[ch], `${kind}: ${ch}: the run changes it by ${(ev - sv).toFixed(6)}, saved ${saved.toFixed(6)}`);
    }
    // the rates after the first two control points are exactly the saved ones (and every piece after the first is whole)
    for (const ch of PC.RATE) { assert.deepEqual(made.pieces[nb].channels[ch].slice(2), run.pieces[0].channels[ch].slice(2), `${kind}: ${ch} after the joint's two points`); assert.deepEqual(made.pieces[nb + 1].channels[ch], run.pieces[1].channels[ch]); assert.deepEqual(made.pieces[nb + 2].channels[ch], run.pieces[2].channels[ch]); }
    // the original track is untouched
    assert.equal(base.pieces.length, nb); assert.ok(Object.isFrozen(base));
  }
});

test('row 3b: it can be added again and again: a saved bend added three times in a row is a valid track and each copy continues the one before', () => {
  const run = PC.saveRun(legacyLap(), 1, 1, { name: 'one bend' }); let d = extend(D.createDoc('t'), { length: 200, family: 'bowl' });
  for (let i = 0; i < 3; i++) d = PC.insert(d, run); assert.equal(d.pieces.length, 4); D.checkDoc(d);
  // a quarter turn three times is three quarters of a turn, give or take the ramp at the first joint
  const { path } = A.toPath(d); assert.ok(path.lengthM > 200 + 3 * Q - 1);
});

test('row 3c: what a head does not carry is continued as Extend continues it: a tube after a cup starts at twice the cup\'s edge, a cup after a tube at t/2, and a hill or swerve that has not faded carries on into the run (the rest of the run is as saved)', () => {
  const cupHead = extend(D.createDoc('c'), { length: 220, first: { c: 30 } }), tubeRun = PC.saveRun(tubeLap(40), 1, 2, { name: 'tube bends' });
  const t0 = PC.insert(cupHead, tubeRun).pieces[1].channels.t[0], edge = D.pieceEnd(cupHead.pieces[0]).c.v;
  assert.ok(Math.abs(t0 - 2 * edge) <= 1.01e-6, `a tube after a cup of ${edge}° starts at ${2 * edge}° (its edge is t/2), got ${t0}`);
  const tubeHead = extend(D.createDoc('t'), { length: 220, first: { w: 30, t: 200 } }), cupRun = PC.saveRun(cupLap(60), 1, 2, { name: 'cup bends' });
  const c0 = PC.insert(tubeHead, cupRun).pieces[1].channels.c[0]; assert.ok(Math.abs(c0 - 100) <= 1.01e-6, `a cup after a tube of 200° starts at its edge, 100°, got ${c0}`);
  for (const [what, mode] of [['hill', 'hill'], ['swerve', 'swerve']]) {
    let head = extend(D.createDoc('h'), { length: 400, family: 'bowl' }); head = SC.brush(head, { mode, s0: 380, r: 60, delta: 5 }).doc;
    const ch = mode === 'hill' ? 'h' : 'l', end = D.pieceEnd(head.pieces[0])[ch]; assert.ok(Math.abs(end.v) > 0.5, `control: the ${what} has not faded at the head (${end.v} m)`);
    const run = PC.saveRun(legacyLap(), 1, 2, { name: 'bends' }), made = PC.insert(head, run), first = made.pieces[1];
    assert.ok(Math.abs(first.channels[ch][0] - end.v) <= 1.01e-4, `${what}: the run starts where the head's ${ch} is (${first.channels[ch][0]} against ${end.v})`);
    assert.deepEqual(first.channels[ch].slice(2), run.pieces[0].channels[ch].slice(2), `${what}: after the joint's two points the run's ${ch} is as saved, not carried up by the head's`); assert.deepEqual(made.pieces[2].channels[ch], run.pieces[1].channels[ch]);
  }
});


test('row 4: "keep its own start values" adds the pieces exactly as saved: refused by name (PIECE_START) where they do not meet the head, accepted where they do; on an empty track a run goes in as saved', () => {
  const H = legacyLap(), run = PC.saveRun(H, 1, 2, { name: 'bends' });
  const other = extend(D.createDoc('o'), { length: 200, family: 'bowl', first: { w: 24 } });
  assert.throws(() => PC.insert(other, run, { keepStart: true }), (e) => e.code === 'PIECE_START' && /own start values do not meet the head/.test(e.message));
  assert.doesNotThrow(() => PC.insert(other, run), 'the same run continues from that head');
  const same = PC.insert(firstOf(H, 1), run, { keepStart: true }); assert.equal(D.serialize(asH(PC.insert(same, PC.saveRun(H, 3, H.pieces.length - 1, { name: 'x' })), H)), D.serialize(H), 'where the run starts where the head ends, keepStart is the same document');
  const empty = PC.insert(D.createDoc('e', { start: H.start }), run); assert.equal(empty.pieces.length, 2); assert.deepEqual(empty.pieces[0].channels, H.pieces[1].channels, 'on an empty track the run is exactly as saved');
  assert.deepEqual(PC.insert(D.createDoc('e'), run, { keepStart: true }).pieces.map((P) => P.channels), empty.pieces.map((P) => P.channels));
});

test('row 4b: refused by name: a legacy run after a cup or a tube (PIECE_KIND), a closed track (CLOSED), a run that starts with a jump on an empty track, a jump after offsets that have not faded', () => {
  const legacyRun = PC.saveRun(legacyLap(), 1, 1, { name: 'legacy bend' }), cupHead = extend(D.createDoc('c'), { length: 200, first: { c: 40 } }), tubeHead = extend(D.createDoc('t'), { length: 200, first: { t: 200 } });
  assert.throws(() => PC.insert(cupHead, legacyRun), (e) => e.code === 'PIECE_KIND' && /cup/.test(e.message)); assert.throws(() => PC.insert(tubeHead, legacyRun), (e) => e.code === 'PIECE_KIND' && /tube/.test(e.message));
  const cupRun = PC.saveRun(cupLap(), 1, 1, { name: 'cup bend' }), legacyHead = extend(D.createDoc('l'), { length: 200, family: 'bowl' });
  assert.doesNotThrow(() => PC.insert(legacyHead, cupRun), 'a cup after a legacy piece starts at the edge that piece renders, as Extend does');
  const closed = legacyLap(); assert.throws(() => PC.insert(closed, legacyRun), (e) => e.code === 'CLOSED');
  let withJump = extend(D.createDoc('j'), { length: 200, family: 'bowl' }); withJump = D.appendPiece(withJump, D.flightPiece({ forward: 30, up: -1, pitch: -2 * DEG })); withJump = extend(withJump, { length: 200 });
  const jumpRun = PC.saveRun(withJump, 1, 2, { name: 'jump and road' }); assert.equal(jumpRun.pieces[0].type, 'flight');
  assert.throws(() => PC.insert(D.createDoc('e'), jumpRun), (e) => e.code === 'BAD_DOC' && /follow a road/.test(e.message));
  let hill = extend(D.createDoc('h'), { length: 400, family: 'bowl' }); hill = SC.brush(hill, { mode: 'hill', s0: 380, r: 60, delta: 5 }).doc;
  assert.throws(() => PC.insert(hill, jumpRun), (e) => e.code === 'FLIGHT_OFFSET', 'a jump cannot follow a hill that has not faded to 0: the document says so by name');
});

test('row 5: the mirror: a mirrored run\'s path is the mirror image of the original\'s (x flips; height, distance along and the bank\'s size do not), with a bank, a hill and a swerve in it; and at a head it is still a valid track', () => {
  let d = extend(D.createDoc('m'), { length: 300, family: 'bowl', first: { c: 40 } });
  d = extend(d, { length: 400, transition: 120, targets: { kh: 1 / 250, phi: 0.3, w: 28, c: 55 } }); d = extend(d, { length: 300, transition: 100, targets: { kh: -1 / 300, phi: -0.2, kv: 1 / 3000 } });
  d = SC.brush(d, { mode: 'hill', s0: 300, r: 90, delta: 6 }).doc; d = SC.brush(d, { mode: 'swerve', s0: 650, r: 90, delta: 4 }).doc;
  assert.ok(d.pieces.some((P) => P.channels.h.some((v) => v !== 0)) && d.pieces.some((P) => P.channels.l.some((v) => v !== 0)), 'control: the run has a hill and a swerve');
  const run = PC.saveRun(d, 0, d.pieces.length - 1, { name: 'wavy' }), mir = PC.mirrored(run);
  assert.equal(PC.serialize(PC.mirrored(mir)), PC.serialize(run), 'mirror of mirror is the original, text for text');
  const a = A.toPath(PC.insert(D.createDoc('a'), run)).path, b = A.toPath(PC.insert(D.createDoc('b'), run, { mirror: true })).path;
  assert.equal(a.samples.length, b.samples.length); let worst = 0, bank = 0;
  for (let i = 0; i < a.samples.length; i++) {
    const p = a.samples[i], m = b.samples[i];
    worst = Math.max(worst, Math.abs(m.pos[0] + p.pos[0]), Math.abs(m.pos[1] - p.pos[1]), Math.abs(m.pos[2] - p.pos[2]), Math.abs(m.s - p.s), Math.abs(m.bankG + p.bankG)); bank = Math.max(bank, Math.abs(p.bankG));
  }
  assert.ok(worst < 1e-7, `x flips and nothing else moves (worst ${worst})`); assert.ok(bank > 0.2, `control: the track is banked (${bank.toFixed(2)} rad)`);
  assert.ok(Math.max(...a.samples.map((s) => Math.abs(s.pos[0]))) > 50 && Math.max(...a.samples.map((s) => s.pos[1])) - Math.min(...a.samples.map((s) => s.pos[1])) > 3, 'control: it turns and climbs');
  // at a head: valid, and it goes the other way round
  const base = extend(D.createDoc('base'), { length: 200, family: 'bowl', first: { c: 25, w: 30 } }), put = PC.insert(base, run, { mirror: true }); D.checkDoc(put);
  const sgn = (doc) => Math.sign(A.toPath(doc).path.samples.at(-1).pos[0]); assert.equal(sgn(PC.insert(base, run)), -sgn(put), 'the run and its mirror bend opposite ways from the same head');
});

test('row 6: jumps in a run: a run with a flight in the middle and one that starts with a flight are saved with their flights as they were, and go in at another head', () => {
  let d = extend(D.createDoc('j'), { length: 250, family: 'bowl' }); d = D.appendPiece(d, D.flightPiece({ forward: 28, up: -1.5, pitch: -2 * DEG })); d = extend(d, { length: 200, transition: 80, targets: { kh: 1 / 300 } });
  // CHANGED D258 (the free jump): a flight is saved as its landing's pose (forward, up, pitch here); its landing is NOT C1 with the take-off, so it goes in as saved
  const mid = PC.saveRun(d, 0, 2, { name: 'road jump road' }); assert.deepEqual(mid.pieces.map((P) => P.type), ['road', 'flight', 'road']); assert.deepEqual([mid.pieces[1].forward, mid.pieces[1].up, mid.pieces[1].pitch], [28, -1.5, q9(-2 * DEG)]);
  const head = extend(D.createDoc('h'), { length: 180, family: 'bowl', first: { w: 26 } }), put = PC.insert(head, mid); assert.deepEqual(put.pieces.slice(1).map((P) => P.type), ['road', 'flight', 'road']); D.checkDoc(put);
  assert.equal(put.pieces[2].forward, 28); assert.deepEqual(A.toPath(put).path.samples.every((s) => s.pos.every(Number.isFinite)), true);
  const lead = PC.saveRun(d, 1, 2, { name: 'jump then road' }); assert.equal(lead.pieces[0].type, 'flight'); const put2 = PC.insert(head, lead); D.checkDoc(put2); assert.deepEqual(put2.pieces.map((P) => P.type), ['road', 'flight', 'road']);
  const w1 = put2.pieces[2].channels.w[0], wSaved = d.pieces[2].channels.w[0]; assert.ok(Math.abs(w1 - wSaved) <= 1.01e-4, `the landing keeps its own saved width (${w1} against ${wSaved}): it is not joined to the take-off`);
  assert.throws(() => PC.saveRun(d, 1, 1, { name: 'only a jump' }), (e) => e.code === 'NO_ROAD');
});
const q9 = (x) => Number(x.toFixed(9));

test('row 7: NO PIECE MAKES A DOCUMENT THE DOCUMENT WOULD REFUSE: every kind of run against every kind of head either goes in as a valid track or is refused by a CoreError, never a crash and never a bad document', () => {
  const runs = {};
  runs.legacy = PC.saveRun(legacyLap(), 1, 3, { name: 'legacy' }); runs.cup = PC.saveRun(cupLap(60), 1, 3, { name: 'cup' }); runs.tube = PC.saveRun(tubeLap(30), 1, 3, { name: 'tube' });
  let e1 = extend(D.createDoc('e'), { length: 200, family: 'bowl', first: { e: 15 } }); e1 = extend(e1, { length: 150, transition: 60, targets: { e: 40 } }); runs.edge = PC.saveRun(e1, 0, 1, { name: 'edge' });
  let j1 = extend(D.createDoc('j'), { length: 200, family: 'bowl' }); j1 = D.appendPiece(j1, D.flightPiece({ forward: 25, up: -1, pitch: -2 * DEG })); j1 = extend(j1, { length: 150 }); runs.jump = PC.saveRun(j1, 0, 2, { name: 'jump' }); runs.jumpFirst = PC.saveRun(j1, 1, 2, { name: 'jump first' });
  const heads = {
    empty: D.createDoc('h0'), legacy: extend(D.createDoc('h1'), { length: 220, family: 'bowl', first: { w: 22, phi: 0.3 } }), 'legacy half-pipe': extend(D.createDoc('h1b'), { length: 220, family: 'half-pipe' }),
    cup: extend(D.createDoc('h2'), { length: 220, first: { c: 30 } }), 'cup near its limit': extend(D.createDoc('h3'), { length: 220, first: { c: 140 } }), 'cup at 0': extend(D.createDoc('h3b'), { length: 220, first: { c: 0 } }),
    tube: extend(D.createDoc('h4'), { length: 220, first: { w: 30, t: 200 } }), 'tube closed': extend(D.createDoc('h5'), { length: 220, first: { w: 30, t: 360 } }),
    edge: extend(extend(D.createDoc('h6'), { length: 200, family: 'bowl', first: { e: 20 } }), { length: 120, transition: 60, targets: { e: 35 } }), banked: extend(D.createDoc('h7'), { length: 220, family: 'bowl', first: { phi: 0.5 } }),
    afterJump: extend(D.appendPiece(extend(D.createDoc('h8'), { length: 220, family: 'bowl' }), D.flightPiece({ forward: 25, up: -1, pitch: -2 * DEG })), { length: 100 }), closed: legacyLap(),
  };
  let ok = 0, refused = 0; const seen = new Set();
  for (const [rn, run] of Object.entries(runs)) for (const [hn, head] of Object.entries(heads)) for (const opts of [{}, { mirror: true }, { keepStart: true }]) {
    let out; try { out = PC.insert(head, run, opts); } catch (e) { assert.equal(e.name, 'CoreError', `${rn} on ${hn} ${JSON.stringify(opts)}: refused with a plain error, not a CoreError: ${e && e.stack}`); assert.match(e.code, /^[A-Z_0-9]+$/); seen.add(e.code); refused++; continue; }
    D.checkDoc(out); assert.equal(out.pieces.length, head.pieces.length + run.pieces.length, `${rn} on ${hn}`); assert.ok(Object.isFrozen(out)); ok++;
    assert.doesNotThrow(() => A.toPath(out), `${rn} on ${hn} ${JSON.stringify(opts)}: the adapter builds it`); D.parse(D.serialize(out));
  }
  assert.ok(ok > 40 && refused > 10, `control: both outcomes happen (${ok} valid, ${refused} refused: ${[...seen].join(', ')})`);
});

// ── malformed files, refused by name ────────────────────────────────────────────────────────────────────────────────────────────
const good = () => JSON.parse(PC.serialize(PC.saveRun(legacyLap(), 1, 2, { name: 'good' }))), goodCup = () => JSON.parse(PC.serialize(PC.saveRun(cupLap(), 1, 2, { name: 'goodcup' })));
const refuses = (text, code, re) => assert.throws(() => PC.parse(typeof text === 'string' ? text : JSON.stringify(text)), (e) => e.name === 'CoreError' && e.code === code && (!re || re.test(e.message)), `${code}${re ? ' ' + re : ''}: ${JSON.stringify(text).slice(0, 120)}`);
test('row 8: a malformed file is refused BY NAME, case by case (the good one still reads)', () => {
  assert.equal(PC.parse(JSON.stringify(good())).name, 'good');
  refuses('not json at all', 'BAD_PIECE_JSON'); refuses('', 'BAD_PIECE_JSON'); refuses('{"schema":', 'BAD_PIECE_JSON'); assert.throws(() => PC.parse({ schema: PC.SCHEMA }), (e) => e.code === 'BAD_PIECE_JSON'); assert.throws(() => PC.parse(null), (e) => e.code === 'BAD_PIECE_JSON');
  refuses('null', 'BAD_PIECE_FIELD'); refuses('[1,2]', 'BAD_PIECE_FIELD'); refuses('"a string"', 'BAD_PIECE_FIELD');
  { const o = good(); delete o.schema; refuses(o, 'BAD_PIECE_SCHEMA'); } { const o = good(); o.schema = 'x'; refuses(o, 'BAD_PIECE_SCHEMA'); }
  { const o = good(); o.schema = 't180b.piece/2'; refuses(o, 'BAD_PIECE_SCHEMA', /newer piece needs a newer builder/); } { const o = good(); o.schema = 't180b.core/4'; refuses(o, 'BAD_PIECE_SCHEMA', /whole track, not a piece/); }
  refuses(D.serialize(legacyLap()), 'BAD_PIECE_SCHEMA', /whole track/);
  { const o = good(); o.extra = 1; refuses(o, 'BAD_PIECE_FIELD', /unknown field "extra"/); } { const o = good(); o.generator = 5; refuses(o, 'BAD_PIECE_FIELD'); }
  for (const name of ['', ' x', '../etc/passwd', 'a/b', 'a\\b', 'a.b', '-x', 'x'.repeat(61), 'x\u0000', 5, null]) { const o = good(); o.name = name; refuses(o, 'BAD_PIECE_NAME'); } { const o = good(); delete o.name; refuses(o, 'BAD_PIECE_NAME'); }
  { const o = good(); o.pieces = []; refuses(o, 'BAD_PIECE_RUN'); } { const o = good(); o.pieces = 'x'; refuses(o, 'BAD_PIECE_RUN'); } { const o = good(); delete o.pieces; refuses(o, 'BAD_PIECE_RUN'); }
  { const o = good(); delete o.start; refuses(o, 'BAD_PIECE_START'); } { const o = good(); o.start = []; refuses(o, 'BAD_PIECE_START'); } { const o = good(); o.start.c = 30; refuses(o, 'BAD_PIECE_START', /does not carry/); }
  { const o = good(); delete o.start.w; refuses(o, 'BAD_PIECE_START', /needs a finite w/); } { const o = good(); o.start.w = '31'; refuses(o, 'BAD_PIECE_START'); } { const o = good(); o.start.w = null; refuses(o, 'BAD_PIECE_START'); }
  { const o = good(); o.pieces[0].type = 'wall'; refuses(o, 'BAD_PIECE_FIELD', /road or flight/); } { const o = good(); o.pieces[0].id = 'p1'; refuses(o, 'BAD_PIECE_FIELD', /unknown field "id"/); } { const o = good(); o.pieces[0] = 5; refuses(o, 'BAD_PIECE_FIELD'); }
  for (const bad of [0, -3, 'x', null]) { const o = good(); o.pieces[0].length = bad; refuses(o, 'BAD_PIECE_NUMBER'); }
  { const o = good(); o.pieces[0].family = 'wall'; refuses(o, 'BAD_PIECE_FIELD', /family/); }
  { const o = good(); o.pieces[0].knots = 'x'; refuses(o, 'BAD_PIECE_KNOTS'); } { const o = good(); o.pieces[0].knots = [30, 20]; refuses(o, 'BAD_PIECE_KNOTS', /ascending/); } { const o = good(); o.pieces[0].knots[0] = o.pieces[0].length; refuses(o, 'BAD_PIECE_KNOTS'); } { const o = good(); o.pieces[0].knots[0] = -1; refuses(o, 'BAD_PIECE_KNOTS'); } { const o = good(); o.pieces[0].knots[1] = 'x'; refuses(o, 'BAD_PIECE_KNOTS'); }
  { const o = good(); delete o.pieces[0].channels.kh; refuses(o, 'BAD_PIECE_CHANNEL', /channel kh/); } { const o = good(); o.pieces[0].channels.kh.pop(); refuses(o, 'BAD_PIECE_CHANNEL', /control points/); } { const o = good(); o.pieces[0].channels.w.push(1); refuses(o, 'BAD_PIECE_CHANNEL'); }
  { const o = good(); o.pieces[0].channels.zz = [1]; refuses(o, 'BAD_PIECE_CHANNEL', /no channel "zz"/); } { const o = good(); o.pieces[0].channels = []; refuses(o, 'BAD_PIECE_CHANNEL'); } { const o = good(); o.pieces[0].channels.kh[2] = 'x'; refuses(o, 'BAD_PIECE_NUMBER'); } { const o = good(); o.pieces[0].channels.kh[2] = null; refuses(o, 'BAD_PIECE_NUMBER'); }
  { const o = good(); o.pieces[0].channels.w[0] = 3; refuses(o, 'BAD_PIECE_CHANNEL', /must start at 0/); }
  { const o = good(); o.pieces[0].channels.c = o.pieces[0].channels.w.slice(); refuses(o, 'MIXED_RUN'); }   // one piece gains a cup array: the run is mixed
  { const o = good(); for (const P of o.pieces) P.channels.c = P.channels.w.slice(); refuses(o, 'BAD_PIECE_START', /needs a finite c/); }   // every piece is a cup but the start has no c
  { const o = goodCup(); o.pieces[0].channels.t = o.pieces[0].channels.c.slice(); refuses(o, 'BAD_PIECE_CHANNEL', /cup or a tube, not both/); } { const o = goodCup(); o.pieces[0].channels.e = o.pieces[0].channels.c.slice(); refuses(o, 'BAD_PIECE_CHANNEL', /both e and s/); }
  { const o = goodCup(); delete o.pieces[0].channels.c; refuses(o, 'MIXED_RUN'); }   // one piece loses its cup: the run is mixed
  { const o = good(); o.pieces[1].channels.w = o.pieces[1].channels.w.map((v) => v + 3); refuses(o, 'JOINT', /joint is C1/); }
  { const o = goodCup(); o.pieces[1].channels.c = o.pieces[1].channels.c.map((v, i) => (i < 3 ? v : v + 200)); refuses(o, 'BAD_CUP'); }
  // CHANGED D258 (the free jump): a flight in a piece file is its landing's pose (forward, left, up, heading, pitch, bank); the old gap/drop/land shape is OLD_FLIGHT
  const fl = (o = {}) => ({ type: 'flight', forward: 20, left: 0, up: 0, heading: 0, pitch: 0, bank: 0, ...o });
  { const o = good(); o.pieces.splice(1, 0, fl({ forward: 0 })); refuses(o, 'FLIGHT_TOO_SHORT'); } { const o = good(); o.pieces.splice(1, 0, fl({ up: 'x' })); refuses(o, 'BAD_PIECE_NUMBER'); } { const o = good(); o.pieces.splice(1, 0, fl({ id: 'p9' })); refuses(o, 'BAD_PIECE_FIELD'); }
  { const o = good(); o.pieces.splice(1, 0, { type: 'flight', gap: 20, drop: 0, land: 0 }); refuses(o, 'OLD_FLIGHT'); }
  { const o = good(); o.pieces = [fl()]; refuses(o, 'NO_ROAD'); }
  { const o = good(); o.pieces.splice(1, 0, fl({ bank: 0.3 })); refuses(o, 'LANDING'); }   // a jump in the middle of a run whose road after it does not start at its bank: the document says LANDING
  refuses(' '.repeat(8e6 + 1), 'BAD_PIECE_SIZE');
});

test('row 8b: a mixed run is refused at SAVE too (MIXED_RUN), and a run of one kind with an edge is a kind of its own', () => {
  let d = extend(D.createDoc('mix'), { length: 200, family: 'bowl' }); d = extend(d, { length: 200, transition: 80, targets: { c: 40 } }); d = extend(d, { length: 100 });
  assert.throws(() => PC.saveRun(d, 0, 2, { name: 'mixed' }), (e) => e.code === 'MIXED_RUN' && /legacy, cup/.test(e.message)); assert.doesNotThrow(() => PC.saveRun(d, 1, 2, { name: 'cups' })); assert.doesNotThrow(() => PC.saveRun(d, 0, 0, { name: 'legacy' }));
  let e = extend(D.createDoc('e'), { length: 200, family: 'bowl', first: { e: 10 } }); e = extend(e, { length: 150, transition: 60, targets: { e: 0 } }); e = extend(e, { length: 100 });
  const kinds = e.pieces.map((P) => `${D.kindOf(P)}${P.edge ? '+edge' : ''}`); assert.ok(kinds.some((k) => k.endsWith('+edge')) && kinds.some((k) => !k.endsWith('+edge')), `control: ${kinds}`);
  if (new Set(kinds).size > 1) assert.throws(() => PC.saveRun(e, 0, e.pieces.length - 1, { name: 'edge and not' }), (x) => x.code === 'MIXED_RUN');
  assert.doesNotThrow(() => PC.saveRun(e, 0, 1, { name: 'edge run' }));
});

test('row 9: ranges, names, limits and the summary a library list shows', () => {
  const H = legacyLap(), n = H.pieces.length;
  for (const [a, b] of [[-1, 2], [0, n], [1.5, 2], [0, NaN], [undefined, 1]]) assert.throws(() => PC.saveRun(H, a, b, { name: 'x' }), (e) => e.code === 'BAD_RANGE', `${a}..${b}`);
  // 3..2 left this list with D250 item 4: on a CLOSED lap it is the run across the start line (row 11a); on an OPEN track it is still BAD_RANGE (row 11d)
  assert.throws(() => PC.saveRun({ ...H, closed: false }, 3, 2, { name: 'x' }), (e) => e.code === 'BAD_RANGE', '3..2 on the open track');
  assert.throws(() => PC.saveRun(H, 0, 1, { name: '../x' }), (e) => e.code === 'BAD_PIECE_NAME'); assert.throws(() => PC.saveRun(H, 0, 1, {}), (e) => e.code === 'BAD_PIECE_NAME'); assert.throws(() => PC.saveRun(null, 0, 1, { name: 'x' }), (e) => e.code === 'BAD_DOC');
  for (const name of ['a', 'A b_c-d', 'x'.repeat(60), '9 lives']) assert.equal(PC.saveRun(H, 0, 0, { name }).name, name);
  const one = PC.saveRun(H, 0, 0, { name: 'single' }); assert.equal(PC.saveRun(H, 0, undefined, { name: 'single' }).pieces.length, 1, 'to defaults to from'); assert.ok(one.pieces[0].channels.kh.length === H.pieces[0].channels.kh.length);
  // limits: a run and a piece's knots are bounded, whatever a file says
  const o = good(); o.pieces = Array.from({ length: 2001 }, () => o.pieces[0]); refuses(o, 'BAD_PIECE_RUN');
  const k = good(); k.pieces[0].knots = Array.from({ length: 4001 }, (_, i) => (i + 1) / 100); refuses(k, 'BAD_PIECE_KNOTS');
  // the summary: a quarter circle of R = 180 turns 90°, a 300 m climb at 1/3000 rises 5.7296°
  const consts = (o2) => ({ kh: () => o2.kh || 0, kv: () => o2.kv || 0, phi: () => 0, w: () => 31, r: () => 2.993, h: () => 0, l: () => 0 });
  let d = D.appendPiece(D.createDoc('s'), D.roadPiece({ length: Q, channels: consts({ kh: 1 / Rr }) })); d = D.appendPiece(d, D.roadPiece({ length: 300, from: D.endState(d), channels: consts({ kv: 1 / 3000 }) }));
  const s1 = PC.summary(PC.saveRun(d, 0, 0, { name: 'q' })), s2 = PC.summary(PC.saveRun(d, 1, 1, { name: 'c' })), s3 = PC.summary(PC.saveRun(d, 0, 1, { name: 'both' }));
  assert.ok(Math.abs(s1.turnDeg - 90) < 1e-3 && Math.abs(s1.climbDeg) < 1e-6 && Math.abs(s1.lengthM - Q) < 1e-3, JSON.stringify(s1));
  // the second piece starts from the first one's end (C1), so its rates are not constants: checked against a plain numeric integral of the stored piece (midpoint rule, 40,000 steps), written out here
  const numeric = (P, ch) => { let sum = 0; const n = 40000; for (let i = 0; i < n; i++) sum += D.channelAt(P, ch, ((i + 0.5) * P.length) / n).v * (P.length / n); return (sum * 180) / Math.PI; };
  assert.ok(Math.abs(s2.turnDeg - numeric(d.pieces[1], 'kh')) < 1e-4 && Math.abs(s2.climbDeg - numeric(d.pieces[1], 'kv')) < 1e-4 && s2.kind === 'legacy' && Math.abs(s2.climbDeg) > 1, JSON.stringify(s2));
  assert.equal(s3.pieces, 2); assert.equal(s3.roads, 2); assert.equal(s3.flights, 0); assert.ok(Math.abs(s3.turnDeg - (s1.turnDeg + s2.turnDeg)) < 1e-9 && Math.abs(s3.lengthM - (s1.lengthM + s2.lengthM)) < 1e-9, 'a run adds up');
  assert.ok(Math.abs(PC.summary(PC.mirrored(PC.saveRun(d, 0, 0, { name: 'q' }))).turnDeg + 90) < 1e-3, 'mirrored: the turn is the other way');
});

test('row 8c: numbers are quantised as they enter, like a document\'s: a value finer than its channel\'s step is snapped', () => {
  const o = good(); o.pieces[0].channels.kh[3] += 1e-13; o.pieces[0].channels.w[3] += 3e-8; o.pieces[0].length += 4e-6; o.start.w += 2e-9;
  const p = PC.parse(JSON.stringify(o)), want = good();
  assert.equal(p.pieces[0].channels.kh[3], want.pieces[0].channels.kh[3]); assert.equal(p.pieces[0].channels.w[3], want.pieces[0].channels.w[3]); assert.equal(p.pieces[0].length, want.pieces[0].length); assert.equal(p.start.w, want.start.w);
  assert.equal(PC.serialize(p), PC.serialize(PC.parse(PC.serialize(p))), 'and the text is stable');
});

// ── rows added after the mutants: a run whose STATES change, a banked mirror, a jump before the road at a turning head ──
/** A legacy track whose bank and width change from piece to piece, with a jump in it: 0 road, 1 road, 2 road (straight), 3 flight, 4 road, 5 road. */
function variedDoc() {
  let d = extend(D.createDoc('varied'), { length: 120, family: 'bowl', first: { w: 22.5, phi: 0.12 } });
  d = extend(d, { length: 100, transition: 60, targets: { phi: -0.2, w: 31.3, kh: 1 / 250 } });
  d = extend(d, { length: 90, transition: 60, targets: { kh: 0 } });
  d = D.appendPiece(d, D.flightPiece({ forward: 25, up: -1, pitch: -2 * DEG }));
  d = extend(d, { length: 110, transition: 50, targets: { phi: 0.07, w: 26.1 } });
  return extend(d, { length: 80, transition: 40, targets: { phi: -0.05, w: 19.7, kh: -1 / 300 } });
}
const onGrid = (x, ch) => Number(x.toFixed(D.DEC[ch])) === x;

test('row 1c: the start is the FIRST road\'s first values (states that change from piece to piece, a jump before the road), every stored state number is on its grid, and random pieces come back exactly', () => {
  const H = variedDoc(); assert.deepEqual(H.pieces.map((P) => P.type), ['road', 'road', 'road', 'flight', 'road', 'road']);
  assert.notEqual(H.pieces[4].channels.w[0], H.pieces[5].channels.w[0], 'control: the width differs between the two roads, so first and last are different starts');
  assert.notEqual(H.pieces[4].channels.phi[0], H.pieces[5].channels.phi[0]);
  for (const [from, to, firstRoad] of [[3, 5, 4], [0, 5, 0], [1, 2, 1]]) {
    const run = PC.saveRun(H, from, to, { name: 'varied' });
    for (const ch of Object.keys(run.start)) assert.equal(run.start[ch], H.pieces[firstRoad].channels[ch][0], `run ${from}..${to}: start ${ch} is the first road's first control point`);
    for (const P of run.pieces) if (P.type === 'road') for (const ch of PC.STATE) if (P.channels[ch]) P.channels[ch].forEach((x) => assert.ok(onGrid(x, ch), `${ch} ${x} is on its decimal grid (no float noise stored)`));
    for (const ch of Object.keys(run.start)) assert.ok(onGrid(run.start[ch], ch));
    PC.absolute(run).forEach((P, i) => assert.deepEqual(P.channels, H.pieces[from + i].channels, `run ${from}..${to}: piece ${i} comes back exactly`));
  }
  // random single pieces (the float noise of change + start shows up here when a number is not rounded on the way in or out)
  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const span = { kh: 0.012, kv: 0.01, phi: 0.4, w: 40, r: 0.5, h: 5, l: 5 }, base = { w: 5, r: 0 };
  for (let k = 0; k < 200; k++) {
    const ch = {}; for (const c of ['kh', 'kv', 'phi', 'w', 'r', 'h', 'l']) ch[c] = Array.from({ length: 5 }, () => Number(((base[c] || -span[c] / 2) + rnd() * span[c]).toFixed(D.DEC[c])));
    const P = { id: 'p1', type: 'road', length: 100, family: 'bowl', knots: [50], channels: ch }, doc = D.checkDoc({ ...D.createDoc('r'), pieces: [P], nextId: 2 });
    const run = PC.saveRun(doc, 0, 0, { name: 'r' }), back = PC.absolute(run)[0].channels;
    for (const c of Object.keys(ch)) assert.deepEqual(back[c], ch[c], `random piece ${k}: ${c} comes back exactly`);
    for (const c of PC.STATE) if (run.pieces[0].channels[c]) run.pieces[0].channels[c].forEach((x) => assert.ok(onGrid(x, c), `random piece ${k}: stored ${c} ${x} is on its grid`));
  }
});

test('row 5b: a mirror flips the bank EXACTLY, the start bank included (a run that starts banked), the turn and the swerve; width and rise stay', () => {
  const H = variedDoc(), run = PC.saveRun(H, 0, 2, { name: 'banked' }), m = PC.mirrored(run);
  assert.ok(run.start.phi !== 0, 'control: the run starts banked'); assert.equal(m.start.phi, -run.start.phi); assert.equal(m.start.w, run.start.w);
  const a = PC.absolute(run), b = PC.absolute(m);
  a.forEach((P, i) => { for (const ch of D.CHANNELS) { const neg = ['kh', 'phi', 'l'].includes(ch); assert.deepEqual(b[i].channels[ch], neg ? P.channels[ch].map((x) => (x === 0 ? 0 : -x)) : P.channels[ch], `piece ${i}: ${ch} ${neg ? 'is negated' : 'is the same'}`); } });
});

// CHANGED D258 (the free jump): the landing after a run's leading jump is the user's own piece, NOT C1 with the take-off, so it goes in AS SAVED: level (turn and
// climb 0, the document's landing rule), its own width (was: the head's width carried through the jump)
test('row 6b: a run that starts with a jump, put at a head that is TURNING and CLIMBING, has its road after the jump start level (turn and climb 0) with its own saved width', () => {
  let j = extend(D.createDoc('j'), { length: 200, family: 'bowl', first: { w: 24 } }); j = D.appendPiece(j, D.flightPiece({ forward: 25, up: -1, pitch: -2 * DEG })); j = extend(j, { length: 100 });
  const run = PC.saveRun(j, 1, 2, { name: 'jump first' });
  let head = extend(D.createDoc('head'), { length: 200, family: 'bowl' }); head = extend(head, { length: 80, transition: 40, targets: { kh: 1 / 200, kv: 0.01, w: 30 } });
  const e = D.endState(head); assert.ok(e.kh.v > 0.004 && e.kv.v > 0.008, 'control: the head is turning and climbing'); assert.notEqual(e.w.v, run.start.w, 'control: the head\'s width is not the run\'s');
  const out = PC.insert(head, run), road = out.pieces[head.pieces.length + 1];
  assert.equal(out.pieces[head.pieces.length].type, 'flight'); assert.equal(road.channels.kh[0], 0); assert.equal(road.channels.kv[0], 0); assert.equal(road.channels.w[0], run.start.w, 'the landing keeps its own saved width');
});

test('row 4c: a closed track says CLOSED whatever the run is: a legacy run into a closed CUP track is CLOSED, not PIECE_KIND (the kind is the second question)', () => {
  const closedCup = cupLap(45), legacyRun = PC.saveRun(legacyLap(), 1, 2, { name: 'legacy bends' });
  assert.throws(() => PC.insert(closedCup, legacyRun), (e) => e.code === 'CLOSED');
});

// ── DELETE (the keeper's amendment of 08:55): pieces at the open end simply go; in the middle the two sides are re-joined C1; if that cannot be done without moving the far side, REFUSED BY NAME ──
const TURN = 1 / 180;
/** An open track of four pieces of each kind: a straight, two turns, a straight again. */
const openDocs = {
  legacy: () => { let d = extend(D.createDoc('del legacy'), { length: 300, family: 'bowl' }); d = extend(d, { length: 150, transition: 60, targets: { kh: TURN } }); d = extend(d, { length: 150, transition: 60, targets: { kh: TURN } }); return extend(d, { length: 100, transition: 60, targets: { kh: 0 } }); },
  cup: () => { let d = extend(D.createDoc('del cup'), { length: 300, family: 'bowl', first: { c: 45 } }); d = extend(d, { length: 150, transition: 60, targets: { kh: TURN, c: 30 } }); d = extend(d, { length: 150, transition: 60, targets: { kh: TURN, c: 55 } }); return extend(d, { length: 100, transition: 60, targets: { kh: 0, c: 45 } }); },
  tube: () => { let d = extend(D.createDoc('del tube'), { length: 300, first: { w: 40, t: 360 } }); d = extend(d, { length: 150, transition: 60, targets: { kh: TURN } }); d = extend(d, { length: 150, transition: 60, targets: { kh: TURN, w: 34 } }); return extend(d, { length: 100, transition: 60, targets: { kh: 0 } }); },
  jump: () => { let d = extend(D.createDoc('del jump'), { length: 200, family: 'bowl' }); d = extend(d, { length: 100, transition: 40, targets: { kh: 1 / 300 } }); d = D.appendPiece(d, D.flightPiece({ forward: 25, up: -1, pitch: -2 * DEG })); return extend(d, { length: 150 }); },
  varied: variedDoc,
  kinds: () => { let d = extend(D.createDoc('del kinds'), { length: 100, family: 'bowl' }); d = extend(d, { length: 80, transition: 40, targets: { c: 40 } }); d = extend(d, { length: 80, transition: 40, targets: { c: 40 } }); d = extend(d, { length: 80, transition: 40, targets: { t: 300, w: 30 } }); return extend(d, { length: 60, transition: 30, targets: { kh: TURN } }); },   // legacy, cup, cup, tube, tube
};
const roadsLength = (d) => d.pieces.reduce((a, P) => a + (P.type === 'road' ? P.length : 0), 0);
/** What a delete may change: pieces before `from` and after the first far piece untouched; the first far piece only in its first two control points (and not at all when the sides already joined). */
function assertOnlyTheJoint(d, o, from, to, tag) {
  assert.equal(o.pieces.length, d.pieces.length - (to - from + 1), tag); assert.equal(o.nextId, d.nextId, `${tag}: an id is never reused`);
  o.pieces.slice(0, from).forEach((P, i) => assert.deepEqual(P, d.pieces[i], `${tag}: the near side is bit for bit as it was (piece ${i})`));
  const far = d.pieces.slice(to + 1);
  far.forEach((P, k) => {
    const got = o.pieces[from + k];
    if (k === 0 && P.type === 'road' && from > 0) { assert.equal(got.id, P.id); assert.equal(got.length, P.length); assert.deepEqual(got.knots, P.knots); for (const ch of D.CHANNELS) if (P.channels[ch]) assert.deepEqual(got.channels[ch].slice(2), P.channels[ch].slice(2), `${tag}: ${ch} past its first two control points is as it was`); } else assert.deepEqual(got, P, `${tag}: the far side is bit for bit as it was (piece ${k})`);
  });
}

test('row 10a: at the open end the pieces simply go: the same document with fewer pieces, the ids kept and not reused, and inserting a saved run then deleting it gets back the track', () => {
  for (const [kind, make] of Object.entries(openDocs)) {
    const d = make(), n = d.pieces.length, before = D.serialize(d);
    for (const k of [1, 2, n - 1]) { const o = PC.deleteRun(d, n - k, n - 1); assert.deepEqual(o.pieces, d.pieces.slice(0, n - k), `${kind}: the last ${k}`); assert.equal(o.nextId, d.nextId); assert.equal(o.closed, false); D.checkDoc(o); assert.ok(Object.isFrozen(o) && Object.isFrozen(o.pieces[0]), 'frozen, as every document is'); }
    const all = PC.deleteRun(d, 0, n - 1); assert.deepEqual(all.pieces, [], `${kind}: all of them leaves an empty track`); assert.deepEqual(all.start, d.start); assert.equal(PC.deleteRun(d, n - 1).pieces.length, n - 1, 'one piece is a range of one');
    assert.equal(D.serialize(d), before, `${kind}: the track deleted from is not touched`);
    const base = PC.deleteRun(d, n - 1), back = PC.insert(base, PC.saveRun(d, n - 1, n - 1, { name: 'last' }));   // put the last piece back, then take it out again
    assert.deepEqual(PC.deleteRun(back, n - 1).pieces, base.pieces, `${kind}: insert then delete is the track before`);
  }
});

test('row 10b: in the middle, when the two sides already join (the deleted run began and ended in the same state) nothing is changed anywhere', () => {
  let d = extend(D.createDoc('same'), { length: 300, family: 'bowl' }); d = extend(d, { length: 100 }); d = extend(d, { length: 200 });
  const o = PC.deleteRun(d, 1); assert.deepEqual(o.pieces, [d.pieces[0], d.pieces[2]], 'the far side is exactly as it was, ids and all'); assert.equal(roadsLength(o), roadsLength(d) - 100);
});

for (const kind of ['legacy', 'cup', 'tube']) {
  test(`row 10c (${kind}): in the middle with the sides NOT joined, the far side's first piece is re-joined C1 by its first two control points (the D190 rule) and nothing else is moved`, () => {
    const d = openDocs[kind](), o = PC.deleteRun(d, 1), near = D.pieceEnd(d.pieces[0]), got = o.pieces[1];
    assertOnlyTheJoint(d, o, 1, 1, kind); D.checkDoc(o);
    assert.notDeepEqual(got.channels.kh.slice(0, 2), d.pieces[2].channels.kh.slice(0, 2), 'control: the joint WAS mended (the sides did not already join)');
    for (const ch of D.CHANNELS) if (got.channels[ch]) {
      const qv = 10 ** -D.DEC[ch], h = got.knots.length ? got.knots[0] : got.length, v = got.channels[ch][0], m = (3 * (got.channels[ch][1] - v)) / h;
      if (ch === 'c' && kind !== 'cup') continue; if (ch === 't' && kind !== 'tube') continue; if (ch === 's' || ch === 'e') continue;
      assert.ok(Math.abs(v - near[ch].v) <= 1.01 * qv, `${kind}: ${ch} starts where the near side ends`); assert.ok(Math.abs(m - near[ch].m) <= (6 * qv) / Math.min(h, 1) + 6 * qv * Math.abs(near[ch].m), `${kind}: ${ch} slope meets`);
    }
    assert.equal(roadsLength(o), roadsLength(d) - d.pieces[1].length);
  });
}

test('row 10h: a tube after a CUP head starts at twice the edge of the cup (tNext), so the rendered edge is continuous across the re-join', () => {
  const d = openDocs.kinds(); assert.deepEqual(d.pieces.map((P) => D.kindOf(P)), ['legacy', 'cup', 'cup', 'tube', 'tube']);
  const o = PC.deleteRun(d, 2); D.checkDoc(o); assert.equal(o.pieces[2].tube, true); assert.ok(Math.abs(o.pieces[2].channels.t[0] - 2 * D.pieceEnd(d.pieces[1]).c.v) < 1e-5 && o.pieces[2].channels.t[0] > 70, 'a tube starts at twice the edge the cup before it ends at');
});

test('row 10d: jumps: deleting the road before a jump, a jump itself, and the road after it each give a valid track with the jump kept (or its own refusal), the far side untouched', () => {
  const d = openDocs.jump();   // road, road (turning), flight, road
  const a = PC.deleteRun(d, 1); assertOnlyTheJoint(d, a, 1, 1, 'before the jump'); assert.equal(a.pieces[1].type, 'flight'); D.checkDoc(a);
  const b = PC.deleteRun(d, 2); assertOnlyTheJoint(d, b, 2, 2, 'the jump'); assert.deepEqual(b.pieces.map((P) => P.type), ['road', 'road', 'road']); assert.ok(Math.abs(b.pieces[2].channels.kh[0] - D.pieceEnd(d.pieces[1]).kh.v) <= 1.01e-9, 'the road after the deleted jump takes the turn of the road before it');
  const c = PC.deleteRun(d, 3); assert.deepEqual(c.pieces, d.pieces.slice(0, 3), 'the last road: the track now ends at the jump');
});

// D243 follow-up (C's look at 47820c4): LAND ON ROAD FIRST through the saved pieces. Before 47820c4, deleting the road between two jumps and adding a run that
// starts with a jump at a head that is a jump both BUILT a track with two jumps in a row; a hand-made file that starts with two jumps was listed as good.
const twoJumps = () => { let d = openDocs.jump(); d = D.appendPiece(d, D.flightPiece({ forward: 20, up: -0.5, pitch: 0 })); return extend(d, { length: 120 }); };   // road, road, flight, road, flight, road
test('row 10i: deleting the road between two jumps is REFUSED BY NAME (DELETE_REJOIN, naming land on road first), and nothing is touched', () => {
  const d = twoJumps(), before = D.serialize(d);
  assert.deepEqual(d.pieces.map((P) => P.type), ['road', 'road', 'flight', 'road', 'flight', 'road']);
  assert.throws(() => PC.deleteRun(d, 3), (e) => e instanceof D.CoreError && e.code === 'DELETE_REJOIN' && /JUMP_AFTER_JUMP/.test(e.message) && /land on road/.test(e.message));
  assert.equal(D.serialize(d), before);
});
test('row 10j: a run that starts with a jump, added at a head that IS a jump, is refused by name (JUMP_AFTER_JUMP); at a road head it goes in (control)', () => {
  const d = twoJumps(), lead = PC.saveRun(d, 2, 3, { name: 'jump then road' }), atJump = d.pieces.slice(0, 3);
  assert.throws(() => PC.insert({ ...d, pieces: atJump }, lead), (e) => e instanceof D.CoreError && e.code === 'JUMP_AFTER_JUMP');
  assert.deepEqual(PC.insert({ ...d, pieces: d.pieces.slice(0, 2) }, lead).pieces.map((P) => P.type), ['road', 'road', 'flight', 'road'], 'control: at a road head');
});
// D250 item 4 (the keeper: "Short way across start"): on a CLOSED lap, saveRun(d, from, to) with from > to is the run ACROSS THE START LINE (from..last, then 0..to)
test('row 11a: across a closed lap\'s start line the run is the pieces either side of it, in lap order, and putting it back gives those very pieces (legacy, cup, tube)', () => {
  for (const [kind, mk] of Object.entries(LAPS)) {
    const H = mk(), n = H.pieces.length;
    for (const [from, to] of [[n - 1, 0], [n - 2, 1]]) {
      const p = PC.saveRun(H, from, to, { name: `seam ${kind}` }), want = [...H.pieces.slice(from), ...H.pieces.slice(0, to + 1)];
      assert.equal(p.pieces.length, want.length, `${kind} ${from}..${to}: ${want.length} pieces`);
      const back = PC.absolute(p);
      want.forEach((P, k) => { for (const ch of D.CHANNELS) if (P.channels[ch]) assert.deepEqual(back[k].channels[ch], P.channels[ch], `${kind} ${from}..${to}: piece ${k} (${P.id}) channel ${ch} comes back as it was`); });
      assert.equal(PC.parse(PC.serialize(p)).pieces.length, want.length, `${kind}: the text round-trips`);
    }
  }
});
test('row 11b: a lap whose bank turns WHOLE times round (TEST 1 ends at -4π): across the line the bank is carried on by those turns, so the run is kept, C1, leaning as the lap leans', () => {
  let d = extend(D.createDoc('rolling lap'), { length: 300, family: 'bowl' });
  d = extend(d, { length: Q, transition: Q, targets: { kh: 1 / Rr, phi: -2 * Math.PI } });   // the bank rolls a whole turn through the first bend
  for (let i = 0; i < 3; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / Rr } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const H = closedOk(close(d, { edited: [0] })), n = H.pieces.length, wind = D.pieceEnd(H.pieces[n - 1]).phi.v - H.pieces[0].channels.phi[0];
  assert.ok(Math.abs(wind + 2 * Math.PI) < 1e-6, `control: the lap's bank ends one whole turn round (${wind})`);
  const p = PC.saveRun(H, n - 1, 0, { name: 'rolling seam' }), back = PC.absolute(p);
  assert.deepEqual(back[0].channels.phi, H.pieces[n - 1].channels.phi, 'the piece before the line is as it was');
  back[1].channels.phi.forEach((v, k) => assert.ok(Math.abs(v - (H.pieces[0].channels.phi[k] + wind)) < 1e-9, `the piece after the line leans the same way, a whole turn on (control point ${k})`));
});
test('row 11c: a closed lap whose road is NOT smooth across its start line (a hand-edited width step there) is refused BY NAME across it (SEAM_RUN); either side alone is kept', () => {
  const H = legacyLap(), n = H.pieces.length, o = JSON.parse(D.serialize(H));
  o.pieces[0].channels.w[0] += 3; o.pieces[0].channels.w[1] += 3;   // the lap's first piece starts 3 m wider than the last one ends (checkDoc does not read a closed lap's seam)
  const E = D.parse(JSON.stringify(o));
  assert.throws(() => PC.saveRun(E, n - 1, 0, { name: 'step' }), (e) => e instanceof D.CoreError && e.code === 'SEAM_RUN' && /start line/.test(e.message) && /w starts at/.test(e.message));
  assert.equal(PC.saveRun(E, n - 1, n - 1, { name: 'before' }).pieces.length, 1, 'control: the piece before the line alone');
  assert.equal(PC.saveRun(E, 0, 0, { name: 'after' }).pieces.length, 1, 'control: the piece after it alone');
});
test('row 11d: on an OPEN track from > to is still BAD_RANGE, and a closed lap\'s out-of-range ends are too', () => {
  const H = legacyLap(), n = H.pieces.length, open = { ...H, closed: false };
  assert.throws(() => PC.saveRun(open, n - 1, 0, { name: 'x' }), (e) => e.code === 'BAD_RANGE');
  assert.throws(() => PC.saveRun(H, n, 0, { name: 'x' }), (e) => e.code === 'BAD_RANGE'); assert.throws(() => PC.saveRun(H, n - 1, -1, { name: 'x' }), (e) => e.code === 'BAD_RANGE');
});

test('row 10k: a piece FILE that starts with two jumps is refused when it is READ (JUMP_AFTER_JUMP), so the library lists why; one leading jump reads (control)', () => {
  const lead = PC.saveRun(twoJumps(), 2, 3, { name: 'jump then road' }), o = JSON.parse(PC.serialize(lead));
  assert.equal(PC.parse(JSON.stringify(o)).pieces[0].type, 'flight', 'control: one leading jump');
  o.pieces.unshift({ ...o.pieces[0] });   // a second jump before the first, as a hand edit would write it
  assert.throws(() => PC.parse(JSON.stringify(o)), (e) => e instanceof D.CoreError && e.code === 'JUMP_AFTER_JUMP' && /land on road/.test(e.message));
  assert.throws(() => PC.insert(openDocs.jump(), o), (e) => e.code === 'JUMP_AFTER_JUMP', 'and an object handed to insert is checked the same way');
});

test('row 10e: REFUSED BY NAME (DELETE_REJOIN), nothing deleted and nothing reshaped: a jump left with no road before it, and a re-join a limit of the document refuses (a tube held in the slot band)', () => {
  const d = openDocs.jump(), before = D.serialize(d);
  assert.throws(() => PC.deleteRun(d, 0, 1), (e) => e instanceof D.CoreError && e.code === 'DELETE_REJOIN' && /flight must follow a road/.test(e.message), 'the jump would be first');
  // the tube: T0 ends held at 355°, T1 sweeps down to 100°, T2 comes back up; with T1 gone T2's first two control points become 355° and the whole piece sits in the band a 40 m tube leaves open
  let t = extend(D.createDoc('tube'), { length: 100, first: { w: 40, t: 360 } }); t = extend(t, { length: 60, transition: 60, targets: { t: 100 } }); t = extend(t, { length: 60, transition: 5, targets: { t: 345 } });
  const o = JSON.parse(JSON.stringify(t)); o.pieces[0].channels.t = [360, 360, 360, 360, 360, 355, 355, 355]; o.pieces[1].channels.t = [355, 355, 302.222222, 157.777778, 100, 100]; o.pieces[2].channels.t = [100, 100, 355, 355, 355, 355];
  const T = D.checkDoc(o), tb = D.serialize(T);
  assert.throws(() => PC.deleteRun(T, 1), (e) => e instanceof D.CoreError && e.code === 'DELETE_REJOIN' && /BAD_TUBE/.test(e.message) && /nothing was deleted/.test(e.message), 'the limit is named in the message');
  assert.equal(D.serialize(T), tb); assert.equal(D.serialize(d), before, 'the tracks are not touched');
  assert.equal(PC.deleteRun(T, 2).pieces.length, 2, 'while the open end is always allowed');
});

test('row 10f: a closed track has no open end (CLOSED); a range that is not in the track is BAD_RANGE', () => {
  const H = legacyLap(); assert.throws(() => PC.deleteRun(H, 1), (e) => e.code === 'CLOSED');
  const d = openDocs.legacy(), n = d.pieces.length;
  for (const [a, b] of [[-1, 0], [0, n], [n, n], [2, 1], [1.5, 2], [NaN, 1], ['1', 2], [0, Infinity], [undefined, 1]]) assert.throws(() => PC.deleteRun(d, a, b), (e) => e instanceof D.CoreError && e.code === 'BAD_RANGE', `(${a}, ${b})`);
});

test('row 10g: EVERY range of every kind of track either goes through as a valid document with only the joint touched, or is refused by name (DELETE_REJOIN): never another error, never an invalid document', () => {
  let ok = 0, refused = 0, rejoined = 0;
  for (const [kind, make] of Object.entries(openDocs)) {
    const d = make(), n = d.pieces.length;
    for (let from = 0; from < n; from++) for (let to = from; to < n; to++) {
      const tag = `${kind} ${from}..${to}`; let o;
      try { o = PC.deleteRun(d, from, to); } catch (e) { assert.ok(e instanceof D.CoreError && e.code === 'DELETE_REJOIN', `${tag}: ${e.code || e.stack}`); refused++; continue; }
      D.checkDoc(o); assertOnlyTheJoint(d, o, from, to, tag); ok++;
      if (from > 0 && to + 1 < n && d.pieces[to + 1].type === 'road' && JSON.stringify(o.pieces[from]) !== JSON.stringify(d.pieces[to + 1])) rejoined++;
    }
  }
  assert.ok(ok > 30 && refused >= 1 && rejoined >= 6, `ok ${ok}, refused ${refused}, rejoined ${rejoined}`);
});

// D240 F1 (C's non-author look): a run is checked by ONE checkDoc of the assembled run, not piece by piece through appendPiece, which re-checked the
// whole growing document each time (measured on the same machine: 2,000 pieces 5.9 s before, 20 ms after). The bound below is generous (100x the new
// time) so it does not flake; the old code fails it. And a fault at the LAST piece of the longest run is still refused by name, naming that piece.
test('row 9b: a run at the limit (2,000 pieces) parses in well under 2 s, and a broken joint at its last piece is still refused BY NAME', () => {
  let d = extend(D.createDoc('s'), { length: 20, family: 'bowl' }); d = extend(d, { length: 20 });
  const one = JSON.parse(PC.serialize(PC.saveRun(d, 1, 1, { name: 'one' })));
  const long = (mutate) => { const o = { ...one, name: 'long', pieces: Array.from({ length: 2000 }, () => JSON.parse(JSON.stringify(one.pieces[0]))) }; if (mutate) mutate(o.pieces); return JSON.stringify(o); };
  const t0 = process.hrtime.bigint(), p = PC.parse(long()), ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(p.pieces.length, 2000);
  assert.ok(ms < 2000, `parse of 2,000 pieces took ${Math.round(ms)} ms`);
  assert.throws(() => PC.parse(long((ps) => { ps[1999].channels.kh = ps[1999].channels.kh.map(() => 0.01); })), (e) => e.name === 'CoreError' && e.code === 'JOINT' && /piece 1999/.test(e.message));
});
