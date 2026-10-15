// app/test/sound.test.js: the builder's sounds (app/sound.js). node --test app/test/sound.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSound, soundFor, TICK_MS, KEYS } = require('../sound.js');

// a history as the shell keeps it: past, present, future
const H = (past, present, future = []) => ({ past, present, future });
const doc = (n, closed = false) => ({ pieces: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })), closed });
const S = (h) => ({ history: h });

test('soundFor: a placed piece, an undo and a closed loop each name their sound; nothing else does', () => {
  const d1 = doc(1), d2 = doc(2), d2c = doc(2, true), d2s = doc(2);
  const a = S(H([], d1)), placed = S(H([d1], d2));
  assert.equal(soundFor(a, placed), 'place');
  assert.equal(soundFor(placed, S(H([], d1, [d2]))), 'undo');
  assert.equal(soundFor(placed, S(H([d1, d2], d2c))), 'loopClosed', 'closing wins over the pieces count');
  assert.equal(soundFor(placed, S(H([d1, d2], d2s))), null, 'a step that adds no piece (a sculpt, a field) has no sound');
  assert.equal(soundFor(placed, S(H([], doc(5)))), null, 'opening a track: no sound');
  assert.equal(soundFor(placed, placed), null, 'the same state');
  assert.equal(soundFor(null, placed), null); assert.equal(soundFor(placed, S(null)), null, 'a state with no history');
});

function fakeWindow({ files = {}, stored = {} } = {}) {
  const played = [], listeners = {}, store = { ...stored }, ctxs = [];
  class Ctx {
    constructor() { this.currentTime = 0; this.destination = {}; ctxs.push(this); }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    decodeAudioData(buf) { if (buf === 'bad') return Promise.reject(new Error('not audio')); return Promise.resolve({ buf }); }
    createBufferSource() { const ctx = this; return { connect() {}, start() { played.push([this.buffer.buf, ctx.currentTime]); } }; }
  }
  const win = {
    AudioContext: Ctx,
    fetch: async (url) => { const name = url.split('/').pop(); return name in files ? { ok: true, arrayBuffer: async () => files[name] } : { ok: false, status: 404 }; },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: { addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter((g) => g !== f); } },
  };
  const fire = (t) => (listeners[t] || []).slice().forEach((f) => f({ type: t }));
  return { win, played, store, fire, listeners, ctxs };
}
const ALL = { 'drag_tick.wav': 'tick', 'place.wav': 'place', 'undo.wav': 'undo', 'loop_closed.wav': 'closed' };

test('nothing plays before the first press (no sound before the user acts); after it, each slot plays its own file', async () => {
  const F = fakeWindow({ files: ALL }), s = createSound(F.win, { log: () => {} });
  assert.equal(s.play('place'), false, 'before any press');
  F.fire('pointerdown'); await s.ready();
  for (const [slot, buf] of [['place', 'place'], ['undo', 'undo'], ['loopClosed', 'closed'], ['tick', 'tick']]) assert.equal(s.play(slot), true, slot);
  assert.deepEqual(F.played.map((p) => p[0]), ['place', 'undo', 'closed', 'tick']);
  assert.throws(() => s.play('honk'), /no slot "honk"/);
});

test('a slot with no file, or a file that is not audio, is silent and says so once; the others still play', async () => {
  const logs = [], F = fakeWindow({ files: { 'place.wav': 'place', 'undo.wav': 'bad' } }), s = createSound(F.win, { log: (m) => logs.push(m) });
  F.fire('keydown'); await s.ready();
  assert.equal(s.play('place'), true); assert.equal(s.play('undo'), false); assert.equal(s.play('loopClosed'), false);
  assert.deepEqual(s.loaded(), ['place']); assert.deepEqual(s.missing().sort(), ['loopClosed', 'tick', 'undo']);
  assert.equal(logs.length, 3, logs.join(' | ')); assert.ok(logs.some((m) => /no loop_closed\.wav yet/.test(m)));
});

test('the drag tick follows the handle event: one tick per value change, only two in the same instant are one', async () => {
  const F = fakeWindow({ files: ALL }), s = createSound(F.win, { log: () => {} });
  F.fire('pointerdown'); await s.ready();
  F.fire('t180:handle-step'); F.fire('t180:handle-step'); assert.equal(F.played.length, 1, 'two steps in the same instant: one tick');
  F.ctxs[0].currentTime = (TICK_MS + 1) / 1000; F.fire('t180:handle-step'); assert.equal(F.played.length, 2, 'a step after TICK_MS ticks again');
  s.unmount(); F.ctxs[0].currentTime = 1; F.fire('t180:handle-step'); assert.equal(F.played.length, 2, 'unmounted: no more ticks');
  assert.ok(TICK_MS > 0 && TICK_MS <= 8, `the guard is only for two ticks in one instant, never a rate limit: ${TICK_MS} ms`);
});

test('mute and volume: remembered, clamped, and a bad volume is refused', async () => {
  const F = fakeWindow({ files: ALL }), s = createSound(F.win, { log: () => {} });
  assert.equal(s.muted, false); assert.equal(s.volume, 0.6, 'the default volume');
  s.setMuted(true); s.setVolume(1.7); assert.equal(F.store[KEYS.muted], '1'); assert.equal(s.volume, 1); assert.equal(F.store[KEYS.volume], '1');
  F.fire('pointerdown'); await s.ready(); assert.equal(s.play('place'), false, 'muted: nothing plays');
  assert.throws(() => s.setVolume('loud'), /a volume is 0 to 1/);
  const again = createSound(fakeWindow({ files: ALL, stored: { ...F.store } }).win, { log: () => {} }); assert.equal(again.muted, true); assert.equal(again.volume, 1, 'the next session reads them back');
  const bad = createSound(fakeWindow({ stored: { [KEYS.volume]: 'abc' } }).win, { log: () => {} }); assert.equal(bad.volume, 0.6, 'an unreadable stored volume falls back to the default');
});

test('a window with no audio and no storage still mounts and simply stays silent', async () => {
  const s = createSound({ document: null, fetch: async () => ({ ok: false }) }, { log: () => {} });
  assert.equal(s.play('place'), false); s.setMuted(true); s.setVolume(0.2); assert.equal(s.volume, 0.2);
});

test('handle(prev, next) plays what soundFor names', async () => {
  const F = fakeWindow({ files: ALL }), s = createSound(F.win, { log: () => {} });
  F.fire('pointerdown'); await s.ready();
  const d1 = doc(1), d2 = doc(2);
  assert.equal(s.handle(S(H([], d1)), S(H([d1], d2))), true); assert.deepEqual(F.played.map((p) => p[0]), ['place']);
  assert.equal(s.handle(S(H([d1], d2)), S(H([d1], d2))), false);
});
