// app/test/sound.test.js: the builder's sounds, made live (app/sound.js). node --test app/test/sound.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSound, createEngine, soundFor, tickPlan, stepOf, STEPS, MEL128, KEYS } = require('../sound.js');

const H = (past, present, future = []) => ({ past, present, future });
const doc = (n, closed = false) => ({ pieces: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })), closed });
const S = (h) => ({ history: h });

test('soundFor: a placed piece, an undo and a closed loop each name their sound; nothing else does', () => {
  const d1 = doc(1), d2 = doc(2), d2c = doc(2, true), d2s = doc(2);
  const placed = S(H([d1], d2));
  assert.equal(soundFor(S(H([], d1)), placed), 'place');
  assert.equal(soundFor(placed, S(H([], d1, [d2]))), 'undo');
  assert.equal(soundFor(placed, S(H([d1, d2], d2c))), 'loopClosed', 'closing wins over the pieces count');
  assert.equal(soundFor(placed, S(H([d1, d2], d2s))), null, 'a step that adds no piece (a sculpt, a field) has no sound');
  assert.equal(soundFor(placed, S(H([], doc(5)))), null, 'opening a track: no sound');
  assert.equal(soundFor(placed, placed), null); assert.equal(soundFor(null, placed), null); assert.equal(soundFor(placed, S(null)), null);
});

test('stepOf: the melody step follows the piece count, one step per piece at any pace, round the 16', () => {
  assert.deepEqual([1, 2, 16, 17, 33].map(stepOf), [0, 1, 15, 0, 0]);
  assert.equal(STEPS.length, 16); assert.ok(STEPS.every(([b, chord, mel]) => b < 48 && chord.length >= 3 && mel > Math.max(...chord)), 'a bass, a chord, a melody note on top');
});

test('the tick melody is 128 steps (16 notes × 8 chords), in a playable range, and moves', () => {
  assert.equal(MEL128.length, 128);
  assert.ok(MEL128.every((m) => m >= 71 && m <= 100), `range ${Math.min(...MEL128)}–${Math.max(...MEL128)}`);
  let still = 0; for (let i = 1; i < 128; i++) if (MEL128[i] === MEL128[i - 1]) still++;
  assert.ok(still <= 2, `the melody keeps moving (${still} repeated neighbours)`);
});

test('tickPlan: a tick when a whole number is crossed or landed on, never for a move inside one, never twice on the same mark', () => {
  assert.equal(tickPlan('length', 100.2, 100.7), null, 'inside one metre: no tick');
  assert.ok(tickPlan('length', 100.7, 101.2), 'crossing 101: a tick');
  assert.ok(tickPlan('length', 100.7, 101), 'landing on 101: a tick');
  assert.equal(tickPlan('length', 101, 101.4), null, 'leaving the mark it sat on: no second tick');
  assert.ok(tickPlan('length', 101, 99.6), 'crossing 100 going down: a tick');
  assert.equal(tickPlan('length', 101, NaN), null, 'a value that is not a number: nothing');
  assert.equal(tickPlan('length', undefined, 100.5), null, 'a first value between marks: nothing');
  assert.ok(tickPlan('length', undefined, 100), 'a first value on a mark: a tick');
});

test('tickPlan: length, cup, width and turn walk the melody forward as the value rises and back as it falls', () => {
  const a = tickPlan('length', 0.5, 1.5, 0), b = tickPlan('length', 1.5, 2.5, a.melAt), back = tickPlan('length', 2.5, 1.5, b.melAt);
  assert.deepEqual([a.melAt, b.melAt, back.melAt], [1, 2, 1]);
  assert.equal(a.midi, MEL128[1]); assert.equal(b.midi, MEL128[2]); assert.equal(back.midi, MEL128[1], 'back down plays the same note again');
  assert.equal(tickPlan('cup', 0.5, 1.5, 127).midi, MEL128[0], 'past the end it goes round');
  assert.equal(tickPlan('cup', 1.5, 0.5, 0).midi, MEL128[127], 'and before the start, round the other way');
});

test('tickPlan: climb rises in pitch with its value, bank arpeggiates and wraps, neither moves the melody', () => {
  const c = [-3, 0, 3, 8].map((v) => tickPlan('climb', v - 0.5, v, 7));
  assert.ok(c[0].midi < c[1].midi && c[1].midi < c[2].midi && c[2].midi < c[3].midi, 'higher climb, higher tick');
  assert.ok(c.every((p) => p.melAt === 7), 'the melody stays where it was');
  assert.equal(tickPlan('climb', 99.5, 100).midi, tickPlan('climb', 13.5, 14).midi, 'a steep climb stops rising at the top of the range');
  const b = [0, 1, 2, 15].map((v) => tickPlan('bank', v - 0.5, v).midi);
  assert.ok(b[0] < b[1] && b[1] < b[2], 'banking further climbs the arpeggio'); assert.equal(b[3], b[0], 'after 15 steps it starts over');
});

test('tickPlan: turn pans into the ear of the turn (the handle\'s + is left); width spreads the tick from mono at 1 m to full stereo at 50 m', () => {
  assert.ok(tickPlan('turn', 9.5, 10).pan < 0, 'a left turn: the left ear'); assert.ok(tickPlan('turn', -9.5, -10).pan > 0, 'a right turn: the right ear');
  assert.equal(tickPlan('turn', 39.5, 40).pan, -1, 'clamped at full');
  assert.deepEqual([0.5, 1, 25, 50, 80].map((v) => { const p = tickPlan('width', v - 0.5, v); return p ? Math.round(p.spread * 100) / 100 : 'none'; }), ['none', 0, 0.49, 1, 1]);
  assert.equal(tickPlan('length', 9.5, 10).spread, null, 'only width spreads');
});

// a recording engine for the player
function fakeWindow({ stored = {}, audio = true } = {}) {
  const listeners = {}, store = { ...stored }, calls = [];
  class Ctx { constructor() { this.currentTime = 0; } }
  const win = {
    ...(audio ? { AudioContext: Ctx } : {}),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: { addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter((g) => g !== f); } },
  };
  let ctx = null;
  const engineFor = (c) => { ctx = c; return { tick: (p) => calls.push(['tick', p.midi, p.pan, p.spread]), step: (i, soft) => calls.push([soft ? 'undo' : 'place', i]), loopClosed: () => calls.push(['loopClosed']), setLevel: (v) => calls.push(['level', v]) }; };
  const fire = (t, detail) => (listeners[t] || []).slice().forEach((f) => f({ type: t, detail }));
  return { win, store, calls, fire, engineFor, listeners, ctx: () => ctx };
}

test('the player: nothing before the first press; after it, place, undo and the loop close play their parts, at the piece count\'s step', () => {
  const F = fakeWindow(), s = createSound(F.win, { engineFor: F.engineFor, log: () => {} });
  const d1 = doc(1), d2 = doc(2), d3 = doc(3);
  assert.equal(s.handle(S(H([d1], d2)), S(H([d1, d2], d3))), null, 'before any press: silent'); assert.equal(s.started, false);
  F.fire('pointerdown'); assert.equal(s.started, true); assert.deepEqual(F.calls[0], ['level', 0.6]);
  assert.equal(s.handle(S(H([d1], d2)), S(H([d1, d2], d3))), 'place');
  assert.equal(s.handle(S(H([d1, d2], d3)), S(H([d1], d2, [d3]))), 'undo');
  assert.equal(s.handle(S(H([d1, d2], d3)), S(H([d1, d2, d3], doc(3, true)))), 'loopClosed');
  assert.deepEqual(F.calls.slice(1), [['place', 2], ['undo', 2], ['loopClosed']], 'the third piece is step 2; undoing it takes step 2 back');
});

test('the player: handle steps tick on whole numbers with the handle\'s own plan, and each handle keeps its own place in the melody', () => {
  const F = fakeWindow(), s = createSound(F.win, { engineFor: F.engineFor, log: () => {} }); F.fire('pointerdown');
  const step = (kind, value) => { F.ctx().currentTime += 0.016; F.fire('t180:handle-step', { kind, value }); };
  step('length', 100.4); step('length', 100.8); step('length', 101.2); step('length', 102.1);
  step('width', 30.2); step('width', 31.1);
  step('turn', 0.4); step('turn', 1.3);
  const ticks = F.calls.filter((c) => c[0] === 'tick');
  assert.equal(ticks.length, 4, 'length crossed 101 and 102; width 31; turn 1');
  assert.deepEqual(ticks.slice(0, 2).map((t) => t[1]), [MEL128[1], MEL128[2]], 'length walked the melody');
  assert.equal(ticks[2][1], MEL128[1], 'width has its own place in it'); assert.ok(ticks[2][3] > 0.5 && ticks[2][3] < 0.7, 'and its spread');
  assert.ok(ticks[3][2] < 0, 'turn panned left');
  F.fire('t180:handle-step', null); F.fire('t180:handle-step', { value: 3 }); assert.equal(F.calls.filter((c) => c[0] === 'tick').length, 4, 'a malformed event is ignored');
  s.unmount(); step('length', 104); assert.equal(F.calls.filter((c) => c[0] === 'tick').length, 4, 'unmounted: no more ticks');
});

test('mute and volume: remembered, clamped, reach the engine, and a bad volume is refused; muted, nothing plays', () => {
  const F = fakeWindow(), s = createSound(F.win, { engineFor: F.engineFor, log: () => {} }); F.fire('pointerdown');
  s.setMuted(true); s.setVolume(1.7); assert.equal(F.store[KEYS.muted], '1'); assert.equal(s.volume, 1); assert.deepEqual(F.calls.at(-1), ['level', 0]);
  assert.equal(s.handle(S(H([], doc(1))), S(H([doc(1)], doc(2)))), null, 'muted: no sound');
  s.setMuted(false); assert.deepEqual(F.calls.at(-1), ['level', 1]);
  assert.throws(() => s.setVolume('loud'), /a volume is 0 to 1/);
  const again = createSound(fakeWindow({ stored: { ...F.store } }).win, { log: () => {} }); assert.equal(again.volume, 1); assert.equal(again.muted, false);
  assert.equal(createSound(fakeWindow({ stored: { [KEYS.volume]: 'abc' } }).win, { log: () => {} }).volume, 0.6, 'an unreadable stored volume: the default');
});

test('a window with no audio still mounts and stays silent; an engine that throws is logged, not thrown', () => {
  const F = fakeWindow({ audio: false }), s = createSound(F.win, { engineFor: F.engineFor, log: () => {} }); F.fire('pointerdown');
  assert.equal(s.started, false); assert.equal(s.handle(S(H([], doc(1))), S(H([doc(1)], doc(2)))), null);
  const logs = [], G = fakeWindow(), t = createSound(G.win, { engineFor: () => ({ setLevel() {}, step() { throw new Error('boom'); }, tick() {}, loopClosed() {} }), log: (m) => logs.push(m) });
  // AMENDED (D349): starting audio now also loads the samples, and this fake window has no fetch, so that failure is logged first; the rule is unchanged: the throw is logged
  G.fire('pointerdown'); t.handle(S(H([], doc(1))), S(H([doc(1)], doc(2)))); assert.match(logs.find((m) => /place/.test(m)) || '', /place could not play \(boom\)/);
});

// THE REAL ENGINE on a generic fake AudioContext: every node and parameter recorded, so the whole graph is built and every voice is scheduled
// without a throw (the sound itself is heard on the sketch page and in the app). An exponential ramp to 0 or below is an error in Web Audio: refused here too.
function fakeAudioContext() {
  const made = {};
  const param = (v = 0) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime(x) { if (!(x > 0)) throw new Error(`exponential ramp to ${x}`); }, cancelScheduledValues() {}, setTargetAtTime() {} });
  const node = (kind) => { made[kind] = (made[kind] || 0) + 1; return new Proxy({ kind, connect() {}, disconnect() {}, start() {}, stop() {} }, { get(t, k) { if (!(k in t)) t[k] = param(); return t[k]; }, set(t, k, v) { t[k] = v; return true; } }); };
  const ctx = { currentTime: 0, sampleRate: 8000, destination: node('destination'), made,
    createBuffer: (ch, n) => { const data = Array.from({ length: ch }, () => new Float32Array(n)); return { getChannelData: (c) => data[c] }; } };
  for (const k of ['Gain', 'Oscillator', 'BiquadFilter', 'StereoPanner', 'Delay', 'Convolver', 'ChannelSplitter', 'ChannelMerger', 'DynamicsCompressor', 'BufferSource']) ctx[`create${k}`] = () => node(k);
  return ctx;
}
test('the engine builds its graph and every voice runs: ticks (plain, panned, spread), place and undo of every step, the loop close', () => {
  const ctx = fakeAudioContext(), e = createEngine(ctx);
  assert.ok(ctx.made.Convolver >= 2 && ctx.made.Delay >= 6, 'the void, the room, the echo and the early reflections are built');
  const before = ctx.made.Oscillator || 0;
  e.tick({ midi: 84 }); e.tick({ midi: 79, pan: -0.7 }); e.tick({ midi: 81, spread: 1 }); e.tick({ midi: 81, spread: 0 });
  for (let i = 0; i < 16; i++) { e.step(i, false); e.step(i, true); }
  e.loopClosed(); e.setLevel(0.3);
  assert.ok(ctx.made.Oscillator - before > 300, `voices were scheduled (${ctx.made.Oscillator - before} oscillators)`);
});
