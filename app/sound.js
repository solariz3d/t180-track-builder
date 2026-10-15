// app/sound.js: the builder's sounds (2026-10-14). node --test app/test/sound.test.js
//
// FOUR SLOTS, each a WAV in app/sounds/ (shipped with the app, so they reach every user):
//   drag_tick.wav    a handle's value moves one step while it is dragged       (30 to 60 ms)
//   place.wav        a piece is placed (Extend, a saved piece, Sharp, ...)    (150 to 300 ms)
//   undo.wav         a step is undone                                          (150 to 300 ms)
//   loop_closed.wav  the loop is closed                                        (1.5 to 4 s)
// A slot whose file is not there is silent, and says so once in the console: the sounds are made by hand (in Serum) and arrive one at a time.
//
// WHAT PLAYS WHEN is read off the shell's state, not wired into each button: soundFor(prev, next) compares two states' histories, so every way
// of placing, undoing or closing makes its sound and nothing else does (opening a track, a sculpt, a typed field: no sound). The drag tick comes
// from app/core/handles.js, which fires `t180:handle-step` when a dragged value changes, at most one tick every TICK_MS.
//
// MUTE AND VOLUME are remembered in localStorage (t180.sound.muted, t180.sound.volume); a window that cannot store them keeps them for the session.
// Audio starts on the first press or key in the window (Chromium's rule: no sound before the user acts).
'use strict';

const SLOTS = Object.freeze({ tick: 'drag_tick.wav', place: 'place.wav', undo: 'undo.wav', loopClosed: 'loop_closed.wav' });
const TICK_MS = 35;
const KEYS = Object.freeze({ muted: 't180.sound.muted', volume: 't180.sound.volume' });

/** Which sound two consecutive shell states call for: 'place', 'undo', 'loopClosed' or null. */
function soundFor(prev, next) {
  if (!prev || !next || prev.history === next.history) return null;
  const a = prev.history, b = next.history;
  if (!a || !b || !a.present || !b.present) return null;
  if (b.past.length === a.past.length + 1 && b.present !== a.present) {          // one new step committed
    if (!a.present.closed && b.present.closed) return 'loopClosed';
    if (b.present.pieces.length > a.present.pieces.length) return 'place';
    return null;                                                               // a sculpt, a field, a deletion: no sound of its own
  }
  if (b.past.length === a.past.length - 1 && b.future.length === a.future.length + 1) return 'undo';
  return null;                                                                 // opened, new, restored, redo: no sound
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * The player. `win` is the window (AudioContext, fetch, localStorage, document); `base` is where the WAVs are, relative to the page.
 * Returns { play(slot), handle(prev, next), setMuted(b), setVolume(v), muted, volume, loaded(), unmount() }.
 */
function createSound(win, { base = 'sounds/', log = (m) => { try { console.warn(m); } catch (e) { /* nowhere to log */ } } } = {}) {
  const store = (() => { try { return win.localStorage || null; } catch (e) { return null; } })();
  const read = (k) => { try { return store ? store.getItem(k) : null; } catch (e) { return null; } };
  const write = (k, v) => { try { if (store) store.setItem(k, String(v)); } catch (e) { /* a private window: the session keeps it */ } };
  let muted = read(KEYS.muted) === '1';
  const v0 = Number(read(KEYS.volume)); let volume = read(KEYS.volume) !== null && Number.isFinite(v0) ? clamp01(v0) : 0.6;
  let ctx = null, gain = null, lastTick = -Infinity;
  const buffers = {}, missing = new Set(), loading = {};
  const Ctx = win.AudioContext || win.webkitAudioContext;
  const start = () => {
    if (ctx || !Ctx) return;
    try { ctx = new Ctx(); gain = ctx.createGain(); gain.gain.value = muted ? 0 : volume; gain.connect(ctx.destination); } catch (e) { ctx = null; log(`sound: no audio here (${e && e.message})`); return; }
    for (const slot of Object.keys(SLOTS)) load(slot);
  };
  const load = (slot) => {
    if (loading[slot]) return loading[slot];
    loading[slot] = (async () => {
      let res;
      try { res = await win.fetch(base + SLOTS[slot]); } catch (e) { missing.add(slot); log(`sound: ${SLOTS[slot]} could not be read (${e && e.message}); that sound is off`); return; }
      if (!res || !res.ok) { missing.add(slot); log(`sound: no ${SLOTS[slot]} yet in app/sounds; that sound is off`); return; }
      try { buffers[slot] = await ctx.decodeAudioData(await res.arrayBuffer()); } catch (e) { missing.add(slot); log(`sound: ${SLOTS[slot]} is not a WAV this window can play (${e && e.message}); that sound is off`); }
    })();
    return loading[slot];
  };
  const play = (slot) => {
    if (!SLOTS[slot]) throw new Error(`sound: no slot "${slot}"`);
    if (muted || !ctx || !buffers[slot]) return false;
    if (slot === 'tick') { const now = ctx.currentTime * 1000; if (now - lastTick < TICK_MS) return false; lastTick = now; }
    try { const s = ctx.createBufferSource(); s.buffer = buffers[slot]; s.connect(gain); s.start(); return true; } catch (e) { log(`sound: ${slot} could not play (${e && e.message})`); return false; }
  };
  const doc = win.document;
  const onGesture = () => start();
  const onStep = () => play('tick');
  if (doc && doc.addEventListener) { doc.addEventListener('pointerdown', onGesture, true); doc.addEventListener('keydown', onGesture, true); doc.addEventListener('t180:handle-step', onStep); }
  return {
    play,
    handle(prev, next) { const s = soundFor(prev, next); return s ? play(s) : false; },
    setMuted(b) { muted = !!b; write(KEYS.muted, muted ? '1' : '0'); if (gain) gain.gain.value = muted ? 0 : volume; },
    setVolume(v) { if (!Number.isFinite(Number(v))) throw new Error(`sound: a volume is 0 to 1, got ${v}`); volume = clamp01(Number(v)); write(KEYS.volume, volume); if (gain && !muted) gain.gain.value = volume; },
    get muted() { return muted; },
    get volume() { return volume; },
    loaded: () => Object.keys(buffers),
    missing: () => [...missing],
    ready: () => Promise.all(Object.values(loading)),
    unmount() { if (doc && doc.removeEventListener) { doc.removeEventListener('pointerdown', onGesture, true); doc.removeEventListener('keydown', onGesture, true); doc.removeEventListener('t180:handle-step', onStep); } },
  };
}

if (typeof module !== 'undefined') module.exports = { createSound, soundFor, SLOTS, TICK_MS, KEYS };
