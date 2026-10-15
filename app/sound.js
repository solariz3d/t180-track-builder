// app/sound.js: the builder's sounds, made live (2026-10-15). node --test app/test/sound.test.js
//
// MADE, NOT PLAYED FROM FILES. Every sound is synthesized by the window's own audio engine (Web Audio, in WebView2 and every browser), from the
// code below: nothing to install, no samples, nothing for a user to have. The design is the first draft chosen on the sketch page (batch 7,
// 2026-10-15): a Rhodes palette, in C.
//
// WHAT PLAYS WHEN
//   a dragged handle's value crosses a whole number   a tick (the tine: a tiny electric-piano "tik"), DRY. What it plays depends on the handle:
//                                                      length, cup, width and the landing walk a 128-step melody (forward as the value rises,
//                                                      back as it falls); climb rises and falls in pitch with its value; turn pans the melody into
//                                                      the ear of the turn; bank plays an arpeggio; width also sets the tick's stereo WIDTH, mono at
//                                                      1 m to full stereo at 50 m. One tick a frame at most, each choking the last (tickPlan).
//   a piece is placed                                  the next of 16 steps of one melody: a Rhodes chord with a melody note on top. The step is the
//                                                      piece count, so the tune moves one step per piece at any pace (stepOf).
//   a step is undone                                   the step being taken back, softer and darker: undo walks the same melody backwards.
//   the loop is closed                                 one gesture: a Rhodes roll, a synth lead answering, a landing chord and crash, one high note ringing.
// Which of the three history sounds plays is read off the shell's state (soundFor), so every way of placing, undoing or closing makes its sound and
// nothing else does (opening a track, a sculpt, a typed field: no sound). The ticks come from app/core/handles.js (`t180:handle-step`).
//
// THE SPACE: everything sits in a dark, empty, wide space: a mid/side widener with short early reflections, and a long "void" reverb (a far
// pre-delay, a ~7 s tail whose highs die first). Place, undo and the loop close's lead also ECHO (420 ms, alternating ears, each repeat 0.62 of the
// last); the ticks and the loop close's chords stay dry.
//
// MUTE AND VOLUME are remembered in localStorage (t180.sound.muted, t180.sound.volume). Audio starts on the first press or key in the window
// (Chromium's rule: no sound before the user acts).
'use strict';

const KEYS = Object.freeze({ muted: 't180.sound.muted', volume: 't180.sound.volume' });
const TICK_MS = 4;            // two ticks in one instant are one
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

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

// ── the music ──
// THE 16 STEPS of place and undo: [bass, chord, melody note]. C major with the borrowed chords that ache (Fm6, Abmaj7, Bbmaj7), rising to a high C
const STEPS = Object.freeze([
  [36, [52, 55, 59, 62], 67], [33, [48, 52, 55, 59], 71], [29, [52, 57, 59, 64], 69], [29, [51, 56, 60, 62], 72],   // Cmaj9 Am9 Fmaj7#11 Fm6
  [28, [50, 55, 59, 62], 71], [33, [50, 55, 57, 62], 74], [26, [53, 57, 60, 64], 76], [31, [53, 57, 59, 64], 74],   // Em7 A7sus Dm9 G13sus
  [36, [52, 55, 59, 62], 79], [32, [55, 60, 63, 67], 79], [34, [50, 53, 57, 62], 77], [33, [48, 52, 55, 59], 76],   // Cmaj9 Abmaj7 Bbmaj7 Am9
  [29, [51, 56, 60, 62], 77], [31, [53, 57, 59, 64], 74], [28, [50, 55, 59, 62], 79], [36, [52, 55, 59, 64], 84],   // Fm6 G13sus Em7 Cmaj9
].map((s) => Object.freeze(s)));
/** The melody step a track with `pieces` pieces has just played on its last placement (0..15); the first piece is step 0. */
const stepOf = (pieces) => (((pieces - 1) % 16) + 16) % 16;

// THE 128-STEP TICK MELODY (16 notes × 8 chords): each chord's notes in a wave, a little higher each phrase
const PROG8 = [[60, 64, 67, 71, 74], [57, 60, 64, 67, 71], [53, 57, 60, 64, 66], [53, 56, 60, 62, 65], [52, 55, 59, 62, 64], [57, 62, 64, 67, 69], [50, 53, 57, 60, 64], [55, 60, 62, 65, 69]];
const WAVE = [0, 1, 2, 3, 2, 3, 4, 5, 4, 3, 2, 3, 2, 1, 0, 1];
const MEL128 = Object.freeze(PROG8.flatMap((chord, p) => {
  const pool = [...new Set(chord.flatMap((m) => [m, m + 12, m + 24, m + 36]))].sort((a, b) => a - b).filter((m) => m >= 71).slice(0, 10);
  return WAVE.map((i) => pool[Math.min(pool.length - 1, i + (p % 4))]);
}));
const MAJ = [0, 2, 4, 5, 7, 9, 11], ARP = [0, 4, 7, 11, 14];
const scaleMidi = (k) => 84 + 12 * Math.floor(k / 7) + MAJ[((k % 7) + 7) % 7];
const arpMidi = (k) => 72 + 12 * Math.floor(k / 5) + ARP[((k % 5) + 5) % 5];
const MELODY_KINDS = new Set(['length', 'cup', 'width', 'turn', 'landfwd', 'landleft', 'landup', 'landturn']);

/**
 * The tick a handle's value change makes, or null. `prev` and `value` are the handle's value before and after (its own units); a tick sounds when a
 * whole number is crossed or landed on, other than the one `prev` sat on. `melAt` is that handle's place in the melody (the caller keeps it).
 * Returns { midi, pan, spread, melAt } (spread null except for width: 0 mono .. 1 full stereo).
 */
function tickPlan(kind, prev, value, melAt = 0) {
  if (!Number.isFinite(value)) return null;
  if (!Number.isFinite(prev)) prev = value - Math.sign(value || 1) * 1e-9;   // a first value: it ticks only when it sits on a whole number
  const lo = Math.min(prev, value), hi = Math.max(prev, value), eps = 1e-9;
  let crossed = false;
  for (let m = Math.ceil(lo - eps); m <= hi + eps; m++) if (Math.abs(m - prev) > eps) { crossed = true; break; }
  if (!crossed) return null;
  const up = value > prev, n = Math.round(value);
  if (kind === 'climb') return { midi: scaleMidi(clamp(n, -20, 14)), pan: 0, spread: null, melAt };
  if (kind === 'bank') return { midi: arpMidi(((n % 15) + 15) % 15), pan: 0, spread: null, melAt };
  const at = melAt + (up ? 1 : -1), midi = MEL128[((at % 128) + 128) % 128];
  if (kind === 'turn') return { midi, pan: clamp(-value / 20, -1, 1), spread: null, melAt: at };   // the turn handle's + is a LEFT turn: the left ear
  if (kind === 'width') return { midi, pan: 0, spread: clamp((value - 1) / 49, 0, 1), melAt: at };
  return { midi, pan: 0, spread: null, melAt: at };
}

// ── the engine ──
/** The audio graph and the voices, on one AudioContext. Everything is scheduled from ctx.currentTime. */
function createEngine(ctx) {
  const master = ctx.createGain(), dryBus = ctx.createGain(), preBus = ctx.createGain(), out = ctx.createGain();
  master.connect(preBus); dryBus.connect(preBus);   // MASTER also feeds the echo; DRYBUS does not
  // the widener: L' = ½(1+W)L + ½(1−W)R and its mirror
  const W = 1.7, sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  const ll = ctx.createGain(), lr = ctx.createGain(), rl = ctx.createGain(), rr = ctx.createGain();
  ll.gain.value = rr.gain.value = 0.5 * (1 + W); lr.gain.value = rl.gain.value = 0.5 * (1 - W);
  out.connect(sp); sp.connect(ll, 0); sp.connect(lr, 1); sp.connect(rl, 0); sp.connect(rr, 1);
  ll.connect(mg, 0, 0); lr.connect(mg, 0, 0); rl.connect(mg, 0, 1); rr.connect(mg, 0, 1); mg.connect(comp); comp.connect(ctx.destination);
  preBus.connect(out);
  for (const [ms, gain, chan] of [[11, 0.16, 0], [17, 0.16, 1], [29, 0.09, 1], [37, 0.09, 0]]) {   // early reflections, different each side
    const d = ctx.createDelay(0.1), g = ctx.createGain(), m = ctx.createChannelMerger(2); d.delayTime.value = ms / 1000; g.gain.value = gain;
    preBus.connect(d); d.connect(g); g.connect(m, 0, chan); m.connect(out);
  }
  const noiseIR = (seconds, pre, decay, shape) => {   // independent noise each side, a pre-delay, an exponential decay, a lowpass that closes as it decays
    const sr = ctx.sampleRate, p = Math.floor(sr * pre), n = Math.floor(sr * seconds), b = ctx.createBuffer(2, p + n, sr);
    for (let c = 0; c < 2; c++) { const x = b.getChannelData(c); let lp = 0; for (let i = 0; i < n; i++) { const t = i / sr, k = shape(t); lp += k * ((Math.random() * 2 - 1) - lp); x[p + i] = lp * Math.exp(-t * decay); } }
    return b;
  };
  // the VOID: vast and dark
  const voidSend = ctx.createGain(), vhp = ctx.createBiquadFilter(), voidVerb = ctx.createConvolver(), vg = ctx.createGain();
  voidSend.gain.value = 0.55; vhp.type = 'highpass'; vhp.frequency.value = 220; voidVerb.buffer = noiseIR(7.5, 0.085, 0.95, (t) => 0.85 * Math.exp(-t / 1.4) + 0.03); vg.gain.value = 0.9;
  preBus.connect(voidSend); voidSend.connect(vhp); vhp.connect(voidVerb); voidVerb.connect(vg); vg.connect(out);
  // a short bright room, for the voices' own air (joins after the echo send, so a dry voice's room stays dry)
  const room = ctx.createConvolver(), roomG = ctx.createGain(); room.buffer = noiseIR(1.6, 0, 3.2, () => 1); roomG.gain.value = 0.32; room.connect(roomG); roomG.connect(preBus);
  // the ECHO: 420 ms, alternating ears, each repeat 0.62 of the last, a little darker, a slow tape warble
  const dIn = ctx.createGain(), dl = ctx.createDelay(1.5), dr = ctx.createDelay(1.5), fbl = ctx.createGain(), fbr = ctx.createGain();
  const lpd = ctx.createBiquadFilter(), hpd = ctx.createBiquadFilter(), dm = ctx.createChannelMerger(2), dOut = ctx.createGain();
  dIn.gain.value = 1; dl.delayTime.value = 0.42; dr.delayTime.value = 0.42; fbl.gain.value = 0.62; fbr.gain.value = 0.62;
  lpd.type = 'lowpass'; lpd.frequency.value = 5200; hpd.type = 'highpass'; hpd.frequency.value = 150;
  const wow = ctx.createOscillator(), wowL = ctx.createGain(), wowR = ctx.createGain(); wow.frequency.value = 0.27; wowL.gain.value = 0.0035; wowR.gain.value = -0.0028;
  wow.connect(wowL); wowL.connect(dl.delayTime); wow.connect(wowR); wowR.connect(dr.delayTime); wow.start();
  master.connect(dIn); dIn.connect(hpd); hpd.connect(lpd); lpd.connect(dl);
  dl.connect(dm, 0, 0); dl.connect(fbl); fbl.connect(dr); dr.connect(dm, 0, 1); dr.connect(fbr); fbr.connect(hpd);
  dm.connect(dOut); dOut.gain.value = 1.25; dOut.connect(out);

  // ── voices ── (each connects to `bus`, which a caller can set to dryBus for a call)
  let bus = master;
  const at = (t) => ctx.currentTime + t;
  const env = (g, t0, a, peak, d) => { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); };
  function tone({ f, type = 'sine', t = 0, a = 0.002, d = 0.15, peak = 0.3, f2 = null, wet = 0, pan = 0, lp = null }) {
    const t0 = at(t), o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
    o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + a + d); env(g, t0, a, peak, d);
    p.pan.value = pan; let node = o; if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); node = fl; }
    node.connect(g); g.connect(p); p.connect(bus); if (wet) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(room); }
    o.start(t0); o.stop(t0 + a + d + 0.05);
  }
  function ep(midi, { t = 0, vel = 0.7, d = 1.2, pan = 0, wet = 0.3 } = {}) {   // the electric piano: FM 1:1 plus a 14:1 tine, a little auto-pan
    const t0 = at(t), f = mtof(midi), g = ctx.createGain(), p = ctx.createStereoPanner(), trem = ctx.createOscillator(), tg = ctx.createGain();
    const op = (ratio, index, idec, amp) => { const car = ctx.createOscillator(), mod = ctx.createOscillator(), mgn = ctx.createGain(), ag = ctx.createGain(); car.frequency.value = f; mod.frequency.value = f * ratio; mgn.gain.setValueAtTime(f * index * vel, t0); mgn.gain.exponentialRampToValueAtTime(f * 0.01, t0 + idec); ag.gain.value = amp; mod.connect(mgn); mgn.connect(car.frequency); car.connect(ag); ag.connect(g); car.start(t0); mod.start(t0); car.stop(t0 + d + 0.05); mod.stop(t0 + d + 0.05); };
    op(1, 1.8, 0.5, 1); op(14, 0.9, 0.05, 0.25);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.13 * vel, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    trem.frequency.value = 4.5; tg.gain.value = 0.25; trem.connect(tg); tg.connect(p.pan); trem.start(t0); trem.stop(t0 + d + 0.05);
    g.connect(p); p.pan.value = pan; p.connect(bus); const w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(room);
  }
  const rhodes = (midi, o = {}) => { ep(midi, { d: 1.6, wet: 0.45, ...o }); ep(midi, { d: 1.6, wet: 0.45, ...o, vel: (o.vel || 0.6) * 0.35, pan: -(o.pan || 0) * 0.8, t: (o.t || 0) + 0.008 }); };
  const bass = (midi, t = 0, d = 0.45, peak = 0.3) => { const f = mtof(midi); tone({ f, t, a: 0.005, d, peak }); tone({ f: f * 2, type: 'triangle', t, a: 0.003, d: d * 0.4, peak: peak * 0.25, lp: 900 }); };
  function lead({ midi, t = 0, len = 0.2, from = null, peak = 0.06 }) {
    const t0 = at(t), f = mtof(midi), lpf = ctx.createBiquadFilter(), g = ctx.createGain(); lpf.type = 'lowpass'; lpf.frequency.value = 4200; lpf.Q.value = 2;
    for (const dt of [-8, 8]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = dt; o.frequency.setValueAtTime(from ? mtof(from) : f, t0); o.frequency.exponentialRampToValueAtTime(f, t0 + 0.04); o.connect(lpf); o.start(t0); o.stop(t0 + len + 0.2); }
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01); g.gain.setValueAtTime(peak, t0 + len); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.15);
    lpf.connect(g); g.connect(bus); const w = ctx.createGain(); w.gain.value = 0.35; g.connect(w); w.connect(room);
  }
  function crash({ t = 0, d = 2.2, peak = 0.12 }) {
    const t0 = at(t), n = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * (d + 0.05)), ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const x = n.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = n; hp.type = 'highpass'; hp.frequency.value = 5200;
    g.gain.setValueAtTime(peak, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d); s.connect(hp); hp.connect(g); g.connect(bus); s.start(t0); s.stop(t0 + d + 0.05);
  }
  const dry = (fn) => { const b = bus; bus = dryBus; try { fn(); } finally { bus = b; } };

  // the tick: the tine, through its own gain that the next tick chokes; `spread` plays two copies apart (the width handle)
  let tickBus = null;
  function tineVoice(f, t0, into, d = 0.09) {
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mgn = ctx.createGain(), g = ctx.createGain();
    car.frequency.value = f; mod.frequency.value = f * 14; mgn.gain.setValueAtTime(f * 0.9, t0); mgn.gain.exponentialRampToValueAtTime(f * 0.01, t0 + 0.03);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    mod.connect(mgn); mgn.connect(car.frequency); car.connect(g); g.connect(into); car.start(t0); mod.start(t0); car.stop(t0 + d + 0.02); mod.stop(t0 + d + 0.02);
  }
  function tick({ midi, pan = 0, spread = null }) {
    const now = ctx.currentTime;
    if (tickBus) { const g = tickBus.gain; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.004); }
    const tb = ctx.createGain(); tb.gain.value = 0.6; tb.connect(dryBus); tickBus = tb;   // ticks are DRY: no echo
    const w = ctx.createGain(); w.gain.value = 0.2; tb.connect(w); w.connect(room);
    if (spread !== null && spread > 0) {
      [-1, 1].forEach((side, i) => { const g = ctx.createGain(), pn = ctx.createStereoPanner(); g.gain.value = 1 - 0.4 * spread; pn.pan.value = side * spread; g.connect(pn); pn.connect(tb); tineVoice(mtof(midi + (i ? spread * 0.12 : 0)), now + (i ? spread * 0.011 : 0), g); });
    } else { const pn = ctx.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1); pn.connect(tb); tineVoice(mtof(midi), now, pn); }
  }
  function step(i, soft) {   // a place (soft = false) or an undo (soft = true) of melody step i
    const [b, chord, mel] = STEPS[((i % 16) + 16) % 16], vel = soft ? 0.32 : 0.55;
    chord.forEach((m, k) => rhodes(m, { t: (soft ? 0.03 : 0.012) * k, vel: vel * 0.85, pan: -0.3 + k * 0.2, d: soft ? 1.0 : 1.6 }));
    rhodes(mel, { t: soft ? 0.12 : 0.06, vel: soft ? 0.38 : 0.7, d: soft ? 1.1 : 1.8 });
    bass(b, 0, soft ? 0.6 : 0.9, soft ? 0.16 : 0.24);
  }
  function loopClosed() {   // one gesture: the roll (dry), the lead answering (echoed), the landing (dry), a high note ringing (echoed)
    dry(() => {
      [41, 48, 53, 56, 60, 62, 65].forEach((m, i) => ep(m, { t: i * 0.06, vel: 0.5, d: 1.1, pan: -0.5 + i / 7 }));
      [53, 57, 60, 64, 67, 69, 72, 76].forEach((m, i) => ep(m, { t: 0.5 + i * 0.055, vel: 0.55, d: 1.4, pan: -0.5 + i / 8 }));
      bass(29, 0, 1.0, 0.26); bass(29, 0.5, 1.2, 0.26);
    });
    for (const [m, t, len, from] of [[76, 1.05, 0.14, 74], [79, 1.21, 0.14], [81, 1.37, 0.24], [84, 1.66, 0.12, 83], [83, 1.8, 0.12], [86, 1.96, 0.75, 84]]) lead({ midi: m, t, len, from: from || null, peak: 0.05 });
    const land = 2.0;
    dry(() => {
      for (const [m, pan] of [[48, -0.3], [55, 0.3], [59, -0.1], [62, 0.2], [64, 0], [71, -0.2], [74, 0.3], [76, 0]]) ep(m, { t: land + Math.abs(pan) * 0.03, vel: 0.68, d: 3.4, pan, wet: 0.5 });
      bass(24, land, 2.8, 0.36); crash({ t: land, d: 2.6, peak: 0.09 });
    });
    ep(88, { t: land + 1.6, vel: 0.45, d: 2.4, wet: 0.6 }); ep(91, { t: land + 2.1, vel: 0.32, d: 2.2, wet: 0.7 });
  }
  return { master, dryBus, tick, step, loopClosed, setLevel(v) { master.gain.value = v; dryBus.gain.value = v; } };
}

/**
 * The player. `win` is the window (AudioContext, localStorage, document). Returns
 * { handle(prev, next), setMuted(b), setVolume(v), muted, volume, started, unmount() }.
 */
function createSound(win, { log = (m) => { try { console.warn(m); } catch (e) { /* nowhere to log */ } }, engineFor = createEngine } = {}) {
  const store = (() => { try { return win.localStorage || null; } catch (e) { return null; } })();
  const read = (k) => { try { return store ? store.getItem(k) : null; } catch (e) { return null; } };
  const write = (k, v) => { try { if (store) store.setItem(k, String(v)); } catch (e) { /* a private window: the session keeps it */ } };
  let muted = read(KEYS.muted) === '1';
  const v0 = Number(read(KEYS.volume)); let volume = read(KEYS.volume) !== null && Number.isFinite(v0) ? clamp(v0, 0, 1) : 0.6;
  let ctx = null, engine = null, lastTick = -Infinity;
  const Ctx = win.AudioContext || win.webkitAudioContext;
  const level = () => (muted ? 0 : volume);
  const start = () => {
    if (ctx || !Ctx) return;
    try { ctx = new Ctx(); engine = engineFor(ctx); engine.setLevel(level()); } catch (e) { ctx = null; engine = null; log(`sound: no audio here (${e && e.message})`); }
  };
  const live = () => !!engine && !muted;
  const guard = (what, fn) => { try { fn(); return true; } catch (e) { log(`sound: ${what} could not play (${e && e.message})`); return false; } };
  // the ticks: each handle's last value and its place in the melody, kept here
  const lastValue = {}, melAt = {};
  const onStep = (e) => {
    const d = e && e.detail; if (!d || typeof d.kind !== 'string') return;
    const plan = tickPlan(d.kind, lastValue[d.kind], Number(d.value), melAt[d.kind] || 0);
    lastValue[d.kind] = Number(d.value);
    if (!plan) return;
    melAt[d.kind] = plan.melAt;
    if (!live()) return;
    const now = ctx.currentTime * 1000; if (now - lastTick < TICK_MS) return; lastTick = now;
    guard('a tick', () => engine.tick(plan));
  };
  const doc = win.document;
  const onGesture = () => start();
  if (doc && doc.addEventListener) { doc.addEventListener('pointerdown', onGesture, true); doc.addEventListener('keydown', onGesture, true); doc.addEventListener('t180:handle-step', onStep); }
  return {
    /** Play what the change from one shell state to the next calls for; returns the sound's name, or null. */
    handle(prev, next) {
      const s = soundFor(prev, next); if (!s || !live()) return s && null;
      if (s === 'place') guard('place', () => engine.step(stepOf(next.history.present.pieces.length), false));
      else if (s === 'undo') guard('undo', () => engine.step(stepOf(prev.history.present.pieces.length), true));
      else guard('the loop close', () => engine.loopClosed());
      return s;
    },
    setMuted(b) { muted = !!b; write(KEYS.muted, muted ? '1' : '0'); if (engine) engine.setLevel(level()); },
    setVolume(v) { if (!Number.isFinite(Number(v))) throw new Error(`sound: a volume is 0 to 1, got ${v}`); volume = clamp(Number(v), 0, 1); write(KEYS.volume, volume); if (engine) engine.setLevel(level()); },
    get muted() { return muted; },
    get volume() { return volume; },
    get started() { return !!engine; },
    unmount() { if (doc && doc.removeEventListener) { doc.removeEventListener('pointerdown', onGesture, true); doc.removeEventListener('keydown', onGesture, true); doc.removeEventListener('t180:handle-step', onStep); } },
  };
}

if (typeof module !== 'undefined') module.exports = { createSound, createEngine, soundFor, tickPlan, stepOf, STEPS, MEL128, TICK_MS, KEYS };
