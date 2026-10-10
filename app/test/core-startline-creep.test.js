// core-startline-creep.test.js: node --test app/test/core-startline-creep.test.js
// D284 (the keeper, 2026-10-10: "every piece i put down, the start line moves up again and again"). On an OPEN track the automatic start went 15 m
// before the far end of the longest straight run (src/markers/layout.js defaultLayout), and appending a Straight to that straight lengthens the run, so
// the line followed the head. Now an open track's automatic line stays on the run's FIRST piece (its end, less the margin), and a hand-placed line never
// moves. Through the app's core shell: spawnsInfo is what the panel and the preview draw, startLayout what the export uses.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell, startLayout, PREFIX } = require('../core/coreshell.js');
const PANEL = require('../core/panel.js');
const D = require('../../src/core/document.js');
const { PACK } = require('../../src/markers/layout.js');

const TOL = 0.01;
const PIT = (id) => ({ side: 'R', leave: { word: id, along: 20 }, rejoin: { word: id, along: 300 }, offsetM: 7.5, width: 10, divergeM: 79, mergeM: 79, speedKmh: 80, boxes: 4, boxSpacingM: 10 });
const APPENDS = [
  ['Straight', (s) => s.extend(PANEL.extendOptions({ length: 200, turn: 0 }))],
  ['broad turn', (s) => s.extend(PANEL.extendOptions({ length: 200, turn: 30 }))],
  ['Turn by', (s) => s.extendTurnBy(PANEL.extendOptions({ length: 200 }), 60)],
  ['Sharp', (s) => s.extendSharp(PANEL.extendOptions({ length: 100 }), { deg: -90, R: 40, ramp: 4 })],
];
async function first400() { const s = await createCoreShell({ storage: null, autosaveMs: 0, brushFn: null }); s.extend(PANEL.extendOptions({ length: 400, turn: 0, width: 24, empty: true })); return s; }
/** The start line's world midpoint as the panel and preview draw it (spawnsInfo's AC_TIME_0 gates). */
function shownLine(s) {
  const info = s.spawnsInfo(); assert.ok(info && Array.isArray(info.placed), `spawnsInfo placed nothing: ${JSON.stringify(info && info.error)}`);
  const L = info.placed.find((m) => m.name === 'AC_TIME_0_L'), R = info.placed.find((m) => m.name === 'AC_TIME_0_R');
  return { mid: L.pos.map((v, k) => (v + R.pos[k]) / 2), line: info.layout.line };
}
/** The export's automatic line (no spawns): its world position on the shell's own path. */
function exportLine(s) {
  const st = s.getState(), d = st.history.present, sr = st.resolved;
  const lay = startLayout(sr.segments, sr.lift, sr.start, { open: !d.closed });
  return lay.line;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const memStore = () => { const docs = new Map(), undo = new Map(); return { saveDoc: async (n, t) => { docs.set(n, t); }, openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()],
  saveUndo: async (n, t) => { undo.set(n, t); }, openUndo: async (n) => undo.get(n), backupDoc: async (n) => n + '.bak' }; };

test('a hand-placed line (along 100 on a 400 m first piece) does not move when a Straight, a broad turn, Turn by and Sharp are added', async () => {
  const s = await first400();
  s.setSpawns({ line: { along: 100 }, grid: { count: PACK.count, rowGapM: PACK.rowGapM, colGapM: PACK.colGapM } });
  const at0 = shownLine(s).mid;
  for (const [name, f] of APPENDS) {
    const n = s.getState().history.present.pieces.length; f(s); assert.ok(s.getState().history.present.pieces.length > n, `${name} was not added: ${s.getState().message}`);
    const now = shownLine(s); assert.ok(dist(now.mid, at0) <= TOL, `after ${name} the line moved ${dist(now.mid, at0).toFixed(3)} m`);
    assert.deepEqual(now.line, { word: 'p1', along: 100 });
  }
});

test('the automatic line on an open track stays put when a Straight is added to the straight it is on (the keeper\'s case: it followed the head)', async () => {
  const s = await first400(); s.setPitLane(PIT('p1'));
  const at0 = shownLine(s);
  assert.deepEqual(exportLine(s), at0.line, 'the panel shows the line the export writes');
  s.extend(PANEL.extendOptions({ length: 200, turn: 0 }));
  const now = shownLine(s);
  assert.ok(dist(now.mid, at0.mid) <= TOL, `after a Straight the automatic line moved ${dist(now.mid, at0.mid).toFixed(3)} m (from ${JSON.stringify(at0.line)} to ${JSON.stringify(now.line)})`);
  assert.deepEqual(exportLine(s), now.line);
});

test('the automatic line stays put through a broad turn, Turn by and Sharp: none of them makes a longer straight', async () => {
  const s = await first400(); s.setPitLane(PIT('p1'));
  const at0 = shownLine(s).mid;
  for (const [name, f] of APPENDS) {
    f(s); const now = shownLine(s);
    assert.ok(dist(now.mid, at0) <= TOL, `after ${name} the automatic line moved ${dist(now.mid, at0).toFixed(3)} m (now ${JSON.stringify(now.line)})`);
    assert.deepEqual(exportLine(s), now.line, `after ${name} the export's line is the one shown`);
  }
});

test('the automatic line moves when a genuinely longer straight is added, and the panel still says the start is automatic', async () => {
  const s = await first400(); s.setPitLane(PIT('p1'));
  const at0 = shownLine(s);
  s.extendTurnBy(PANEL.extendOptions({ length: 200 }), 90);
  s.extend(PANEL.extendOptions({ length: 900, turn: 0 }));
  const now = shownLine(s), d = s.getState().history.present;
  assert.notEqual(now.line.word, at0.line.word, 'the line goes to the new, longer straight');
  assert.equal(now.line.word, d.pieces[d.pieces.length - 1].id);
  assert.equal(d.spawns, undefined, 'still automatic: no spawns field was written');
});

test('save, reopen, append: neither the hand-placed nor the automatic line moves', async () => {
  for (const hand of [true, false]) {
    const store = memStore(), s = await createCoreShell({ storage: store, autosaveMs: 0, brushFn: null });
    s.extend(PANEL.extendOptions({ length: 400, turn: 0, width: 24, empty: true }));
    if (hand) s.setSpawns({ line: { along: 100 }, grid: { count: PACK.count, rowGapM: PACK.rowGapM, colGapM: PACK.colGapM } }); else s.setPitLane(PIT('p1'));
    const at0 = shownLine(s).mid;
    await s.save('creep');
    assert.ok(store.openDoc && await store.openDoc(PREFIX + 'creep'), 'saved');
    const s2 = await createCoreShell({ storage: store, autosaveMs: 0, brushFn: null }); await s2.open('creep');
    assert.ok(dist(shownLine(s2).mid, at0) <= TOL, `${hand ? 'hand-placed' : 'automatic'}: the reopened line moved`);
    s2.extend(PANEL.extendOptions({ length: 200, turn: 0 }));
    const now = shownLine(s2).mid;
    assert.ok(dist(now, at0) <= TOL, `${hand ? 'hand-placed' : 'automatic'}: after reopen and a Straight the line moved ${dist(now, at0).toFixed(3)} m`);
  }
});

test('a CLOSED lap keeps its automatic start where it was: 15 m before the end of the longest straight run (the export of a finished track is unchanged)', async () => {
  const R = 180, Q = Math.PI * R / 2, s = await createCoreShell({ storage: null, autosaveMs: 0, brushFn: null });
  s.extend({ length: 300, family: 'bowl' }); s.extend({ length: 200, family: 'bowl' });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  s.close(); assert.equal(s.getState().history.present.closed, true);
  const sr = s.getState().resolved, lay = startLayout(sr.segments, sr.lift, sr.start);
  assert.equal(lay.line.word, 'p2', 'the run spans p1 and p2; the closed rule keeps the line at its far end');
  const p2 = sr.segments.filter((g) => g.id === 'p2').reduce((a, g) => a + g.length, 0);
  // at the run's far end (the run may reach a metre or two into the first corner's ease, whose curvature is under the straight threshold), not on p1
  assert.ok(lay.line.along > p2 - 20 && lay.line.along <= p2, `along ${lay.line.along}, p2 is ${p2} m`);
  assert.ok(D.serialize(s.getState().history.present).length > 0);
});
