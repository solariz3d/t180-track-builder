// core_close_local.test.js: node --test test/core_close_local.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D242, THE LOCAL CLOSE (src/core/close.js, opts.window; the keeper, TEST 1: "completing the loop altered the rest of the track equation": the
// whole-lap close moved every control point, the opening 1,000 m straight's heading rate by 0.00204 rad/m, and the lap ran into itself). Rows:
//   1  a close confined to the LAST piece leaves every earlier piece bit-identical and closes the loop
//   2  the default window: the trailing pieces covering ~20% of the lap, at least the last piece; and the whole-lap close still reaches back (control)
//   3  a window that cannot close the loop REFUSES BY NAME (CLOSE_WINDOW), naming the window; nothing is handed back
//   4  a local close may not push the window past the roll-rate bar: refused by name (and its control: a smaller bank closes)
//   5  a window with no road piece is refused by name
// The laps (measured, B's lprobe2 and lprobe3): a NEAR lap ends 8.87 m from its start, as a lap the keeper is about to close does; the FAR lap
// ends some 300 m past its start, which no window short of the whole lap can close.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const C = require('../src/core/close.js');

const R = 180, Q = (Math.PI * R) / 2;
/** The FAR lap: 300 m, four quarter turns, then `lastLen` m. Open. */
function lap(lastLen = 200) {
  let d = extend(D.createDoc('local'), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  return extend(d, { length: lastLen, transition: Math.min(40, lastLen), targets: { kh: 0 } });
}
const withChannel = (d, i, ch, f) => D.checkDoc({ ...d, pieces: d.pieces.map((P, k) => (k === i ? { ...P, channels: { ...P.channels, [ch]: P.channels[ch].map(f) } } : P)) });
/** A NEAR lap: the far lap closed whole, opened again, and one turn's inner control points nudged by `eps` rad/m (its joints untouched). */
function nearLap(lastLen = 200, eps = 1e-4) {
  const open = D.checkDoc({ ...C.close(lap(lastLen), { edited: [0] }).doc, closed: false });
  return eps ? withChannel(open, 2, 'kh', (v, i, a) => (i >= 3 && i <= a.length - 4 ? v + eps : v)) : open;
}
/** The near lap (eps 0) with its START banked to `B` rad over its first control points, level by the 9th: the end is level, so only the window can roll to meet it. */
const bankedStart = (B) => withChannel(nearLap(200, 0), 0, 'phi', (v, i) => (i <= 2 ? B : i >= 8 ? 0 : (B * (8 - i)) / 6));
/** Every channel of piece a equals piece b's, value for value (Object.is: bit for bit). */
const sameChannels = (a, b) => Object.keys(a.channels).every((ch) => Array.isArray(b.channels[ch]) && a.channels[ch].length === b.channels[ch].length && a.channels[ch].every((v, i) => Object.is(v, b.channels[ch][i])));
const lastIdx = (d) => d.pieces.length - 1;

test('row 1: a close confined to the LAST piece leaves every earlier piece bit-identical, closes the loop, and moves the last piece', () => {
  const d = nearLap(), r = C.close(d, { window: C.closeWindow(d, { last: true }) });
  assert.equal(r.converged, true, r.report); assert.equal(r.doc.closed, true); assert.ok(r.gapM < 1e-3, `${r.gapM} m`);
  for (let i = 0; i < lastIdx(d); i++) assert.ok(sameChannels(d.pieces[i], r.doc.pieces[i]), `${d.pieces[i].id}: every control point bit-identical`);
  assert.ok(!sameChannels(d.pieces[lastIdx(d)], r.doc.pieces[lastIdx(d)]), 'control: the last piece is what moved');
  assert.deepEqual(r.window.ids, [d.pieces[lastIdx(d)].id]); assert.match(r.window.text, /^the last 200 m \(p\d+\)$/);
});

test('row 2: the default window covers at least ~20% of the lap from its end (at least the last piece); the whole-lap close, by contrast, moves pieces outside it', () => {
  const d = nearLap(), w = C.closeWindow(d), total = d.pieces.reduce((a, P) => a + P.length, 0), covered = w.reduce((a, i) => a + d.pieces[i].length, 0);
  assert.ok(covered >= 0.2 * total - 1e-9, `${covered} of ${total} m`); assert.equal(w[w.length - 1], lastIdx(d)); assert.ok(w.every((v, k) => k === 0 || v === w[k - 1] + 1), 'a run of pieces ending at the last');
  assert.deepEqual(C.closeWindow(d, { last: true }), [lastIdx(d)]); assert.equal(C.closeWindow(d, { fraction: 1 }).length, d.pieces.length);
  const local = C.close(d, { window: w }); assert.equal(local.converged, true, local.report);
  const outside = d.pieces.map((_, i) => i).filter((i) => !w.includes(i));
  assert.ok(outside.length > 0, 'the default window leaves pieces outside it');
  for (const i of outside) assert.ok(sameChannels(d.pieces[i], local.doc.pieces[i]), `${d.pieces[i].id} is outside the window: kept`);
  const whole = C.close(d, { edited: [lastIdx(d)] }); assert.equal(whole.converged, true, whole.report);
  assert.ok(outside.some((i) => !sameChannels(d.pieces[i], whole.doc.pieces[i])), 'control: the whole-lap close reaches back into the lap (what the keeper saw)');
});

test('row 3: a window that cannot close the loop is REFUSED BY NAME (CLOSE_WINDOW), naming the window, and nothing is handed back', () => {
  const d = lap(30);   // the far lap: its end is some 300 m from its start
  assert.throws(() => C.close(d, { window: C.closeWindow(d, { last: true }) }), (e) => e.name === 'CoreError' && e.code === 'CLOSE_WINDOW' && /can't close using only the last 30 m \(p\d+\)/.test(e.message) && /widen the window/i.test(e.message), 'refused by name');
});

test('row 4: a local close may not push the window past the roll-rate bar (1.2144°/m over 20 m): refused by name', () => {
  const d = bankedStart(1.0);   // the start banks 57°, the end is level: the last 200 m alone would roll 2.343°/m to meet it (lprobe3)
  assert.throws(() => C.close(d, { window: C.closeWindow(d, { last: true }) }), (e) => e.name === 'CoreError' && e.code === 'CLOSE_WINDOW' && /roll too fast/.test(e.message), 'refused by name');
});

test('row 4 control: the same start banked 0.5 rad closes in the last piece (its roll stays under the bar)', () => {
  const d = bankedStart(0.5), r = C.close(d, { window: C.closeWindow(d, { last: true }) });
  assert.equal(r.converged, true, r.report);
});

test('row 5: a window with no road piece is refused by name', () => {
  const d = nearLap();
  assert.throws(() => C.close(d, { window: [] }), (e) => e.code === 'CLOSE_WINDOW' && /no road piece/.test(e.message));
  assert.throws(() => C.close(d, { window: [99] }), (e) => e.code === 'CLOSE_WINDOW');
});
