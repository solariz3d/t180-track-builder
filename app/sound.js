// app/sound.js: the builder's sounds, made live (2026-10-15). node --test app/test/sound.test.js
//
// FOUR RECORDED SAMPLES, AND THE SYNTH BEHIND THEM (D349, 2026-10-16). The tick, place, undo and the loop close play the four files in app/sounds/,
// rendered from Serum's factory presets on the sketch page (batch 8): each note is its slot's one sample pitched by playback rate (SAMPLES). They are
// fetched once, when audio starts; until they are decoded, and for good if they fail to load (logged), the synth voices below play instead, made live
// by the window's own audio engine (Web Audio, in WebView2 and every browser). The synth is the first draft chosen on the sketch page (batch 7,
// 2026-10-15): a Rhodes palette, in C. What plays when, below, is the same for both.
//
// WHAT PLAYS WHEN
//   a dragged handle's value crosses a whole number   a tick (the tine: a tiny electric-piano "tik"), DRY. What it plays depends on the handle:
//                                                      length, cup, width and the landing walk a 128-step melody (forward as the value rises,
//                                                      back as it falls); climb rises and falls in pitch with its value; turn pans the melody into
//                                                      the ear of the turn; bank plays an arpeggio; width also sets the tick's stereo WIDTH, mono at
//                                                      1 m to full stereo at 50 m. One tick a frame at most, each choking the last (tickPlan).
//   a piece is placed                                  the next of 64 steps of this launch's melody: a chord with a melody note on top. Four melodies
//                                                      (MELODIES, D375), one picked at random each time the builder starts, never saved. The step
//                                                      is the piece count, so the tune moves one step per piece at any pace (stepOf).
//   a step is undone                                   the step being taken back, softer and darker: undo walks the same melody backwards.
//   the loop is closed                                 one gesture: a Rhodes roll, a synth lead answering, a landing chord and crash, one high note ringing.
// Which of the three history sounds plays is read off the shell's state (soundFor), so every way of placing, undoing or closing makes its sound and
// nothing else does (opening a track, a sculpt, a typed field: no sound). The ticks come from app/core/handles.js (`t180:handle-step`).
//
// THE SPACE: everything sits in a dark, empty, wide space: a mid/side widener with short early reflections, and a long "void" reverb (a far
// pre-delay, a ~11 s tail whose highs die first). Place, undo and the loop close's lead also ECHO, faintly (420 ms, alternating ears, each repeat half
// the last); the ticks and the loop close's chords stay dry.
//
// MUTE AND VOLUME are remembered in localStorage (t180.sound.muted, t180.sound.volume). Audio starts on the first press or key in the window
// (Chromium's rule: no sound before the user acts).
'use strict';

const KEYS = Object.freeze({ muted: 't180.sound.muted', volume: 't180.sound.volume' });
const TICK_MS = 4;            // two ticks in one instant are one
// the tick's tine (D345: 3a26bc5's voice, restored): its peak, 0.16 there, lifted 3 dB to D334's loudness, so a drag sits at about -31 LUFS, under a place at -28
const TINE = Object.freeze({ peak: 0.226 });
// D349: the recorded voices. The four files in app/sounds/ (16-bit stereo 48 kHz), each rendered on one note: `ref`. A note n plays its slot's sample at rate
// 2^((n - ref) / 12); the loop close is one whole gesture and plays as rendered. `gain` sets each slot in its loudness band in this engine's space
// (app/test/sound-bands.test.js, measured in headless Chrome). A sample pitched up is also shorter, so a high tick carried less than a low one: unevened,
// the climb and bank drags sat 2.6 dB under length and width 2.8 dB over it, 5.1 dB apart against a band 5 dB wide; `tickEven` lifts a tick by
// rate^0.5, the same energy whatever its note, which brings the four drags within 2.4 dB. `tickFade` is the tick's attack fade (4 ms): one tick's peak
// sits near -27 dBFS with or without it, but the climb and bank drags' peaks go over their -15 with less, at the gain that keeps one tick in its band (3 ms
// put the climb drag at -14.7 on the bands' seeded render; 4 ms passes there and on 11 of 12 seeds, the twelfth one tick 0.3 dB under its floor)
// D375: `slots` are the FILES the player fetches (ref and gain are each file's); `file` maps every slot a voice plays to its file. Each melody plays on its
// own place_<name> and undo_<name> slots, each its own file (one line per melody below, so one pair can change alone). A melody file's gain is today's place or undo gain: E levelled each file to it. The tick is batch 9's Eiano
// tik (the keeper's pick), measured through this engine at the old tick's gain, its file levelled to match (G:\Consonance-tools\b9\level_ticks.js)
// D377: the keeper's four for 0.4.2: Aqua, Skyline and Glass of batch 11 (G:\Consonance-tools\b9\mel11.js, their files from page11\batch11) and Aurora of
// batch 12 (mel12.js, page12\batch12), in place of batch 10's four, whose files are gone from app/sounds with batch 8's place.wav and undo.wav
const MELODY_NAMES = Object.freeze(['aqua', 'skyline', 'glass', 'aurora']);
const SAMPLES = Object.freeze({
  slots: Object.freeze(['drag_tick', 'loop_closed', ...MELODY_NAMES.flatMap((m) => [`place_${m}`, `undo_${m}`])]),
  file: Object.freeze({
    drag_tick: 'drag_tick', loop_closed: 'loop_closed',
    place_aqua: 'place_aqua', undo_aqua: 'undo_aqua',                       // PL Big Bells [AS]
    place_skyline: 'place_skyline', undo_skyline: 'undo_skyline',           // SY Runtheharm [GS]
    place_glass: 'place_glass', undo_glass: 'undo_glass',                   // SY VeloHarm [GS]
    place_aurora: 'place_aurora', undo_aurora: 'undo_aurora',               // SY Linear Arithmetic [FP]
  }),
  ref: Object.freeze({ drag_tick: 84, ...Object.fromEntries(MELODY_NAMES.flatMap((m) => [[`place_${m}`, 60], [`undo_${m}`, 60]])) }),
  gain: Object.freeze({ drag_tick: 1.852, loop_closed: 0.668, ...Object.fromEntries(MELODY_NAMES.flatMap((m) => [[`place_${m}`, 0.645], [`undo_${m}`, 0.596]])) }),
  tickFade: 0.004,
  tickEven: 0.5,
});
const rateOf = (file, midi) => (file in SAMPLES.ref ? Math.pow(2, (midi - SAMPLES.ref[file]) / 12) : 1);
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
// THE FOUR MELODIES of place and undo (D375, the keeper's pick of batch 9, composed for this builder in G:Consonance-tools9mel9.js and copied here
// as data): 64 steps each of [bass, chord of four, melody note on top], two steps a chord. One is picked at each launch (createSound); place walks it
// forward, undo back
const melody = (title, steps) => Object.freeze({ title, steps: Object.freeze(steps.map((s) => Object.freeze([s[0], Object.freeze(s[1]), s[2]]))) });
const MELODIES = Object.freeze({
  aqua: melody("Aqua", [
    [38, [50, 52, 54, 57], 66], [38, [50, 52, 54, 57], 69], [31, [49, 50, 54, 59], 71], [31, [49, 50, 54, 59], 73], [38, [50, 52, 54, 57], 69], [38, [50, 52, 54, 57], 66], [31, [50, 57, 59, 66], 67], [31, [50, 57, 59, 66], 69],
    [35, [50, 57, 59, 66], 74], [35, [50, 57, 59, 66], 73], [31, [50, 54, 57, 59], 71], [31, [50, 54, 57, 59], 74], [38, [50, 52, 54, 57], 76], [38, [50, 52, 54, 57], 78], [33, [50, 52, 55, 59], 76], [33, [50, 52, 55, 59], 74],
    [31, [49, 50, 54, 59], 78], [31, [49, 50, 54, 59], 73], [30, [52, 54, 57, 59], 81], [30, [52, 54, 57, 59], 76], [28, [50, 52, 55, 59], 79], [28, [50, 52, 55, 59], 78], [33, [50, 54, 55, 59], 76], [33, [50, 54, 55, 59], 78],
    [38, [52, 54, 57, 61], 81], [38, [52, 54, 57, 61], 85], [28, [50, 52, 55, 59], 83], [28, [50, 52, 55, 59], 79], [33, [50, 52, 55, 59], 79], [33, [50, 52, 55, 59], 76], [35, [50, 54, 57, 61], 78], [35, [50, 54, 57, 61], 85],
    [31, [50, 57, 59, 67], 79], [31, [50, 57, 59, 67], 83], [33, [49, 57, 59, 64], 81], [33, [49, 57, 59, 64], 85], [35, [49, 57, 62, 66], 83], [35, [49, 57, 62, 66], 78], [28, [49, 57, 62, 66], 78], [28, [49, 57, 62, 66], 83],
    [31, [50, 57, 59, 66], 83], [31, [50, 57, 59, 66], 86], [35, [52, 57, 61, 66], 88], [35, [52, 57, 61, 66], 85], [28, [52, 56, 59, 66], 88], [28, [52, 56, 59, 66], 87], [33, [51, 56, 61, 64], 85], [33, [51, 56, 61, 64], 87],
    [28, [52, 56, 59, 66], 83], [28, [52, 56, 59, 66], 88], [37, [51, 56, 59, 64], 87], [37, [51, 56, 59, 64], 83], [31, [50, 59, 61, 66], 83], [31, [50, 59, 61, 66], 81], [33, [50, 59, 64, 67], 79], [33, [50, 59, 64, 67], 76],
    [35, [50, 57, 59, 66], 78], [35, [50, 57, 59, 66], 74], [28, [50, 55, 59, 64], 76], [28, [50, 55, 59, 64], 79], [33, [49, 55, 59, 64], 73], [33, [49, 55, 59, 64], 76], [38, [50, 54, 57, 64], 78], [38, [50, 54, 57, 64], 74],
  ]),
  skyline: melody("Skyline", [
    [29, [48, 53, 55, 57], 72], [29, [48, 53, 55, 57], 69], [34, [50, 52, 53, 57], 74], [34, [50, 52, 53, 57], 76], [29, [48, 53, 55, 57], 72], [29, [48, 53, 55, 57], 67], [38, [48, 52, 53, 57], 69], [38, [48, 52, 53, 57], 76],
    [34, [48, 50, 53, 57], 77], [34, [48, 50, 53, 57], 74], [33, [48, 52, 55, 57], 76], [33, [48, 52, 55, 57], 72], [31, [50, 53, 57, 58], 74], [31, [50, 53, 57, 58], 77], [36, [50, 53, 55, 58], 79], [36, [50, 53, 55, 58], 77],
    [38, [52, 53, 57, 60], 81], [38, [52, 53, 57, 60], 76], [34, [52, 53, 57, 62], 74], [34, [52, 53, 57, 62], 81], [31, [48, 53, 55, 58], 82], [31, [48, 53, 55, 58], 77], [36, [50, 53, 57, 58], 79], [36, [50, 53, 57, 58], 81],
    [29, [52, 55, 57, 60], 84], [29, [52, 55, 57, 60], 81], [31, [50, 53, 55, 58], 82], [31, [50, 53, 55, 58], 81], [36, [50, 52, 55, 58], 79], [36, [50, 52, 55, 58], 76], [38, [50, 53, 57, 60], 77], [38, [50, 53, 57, 60], 81],
    [34, [50, 53, 57, 60], 81], [34, [50, 53, 57, 60], 77], [36, [50, 55, 60, 64], 79], [36, [50, 55, 60, 64], 86], [33, [48, 55, 57, 64], 84], [33, [48, 55, 57, 64], 83], [33, [50, 55, 59, 64], 83], [33, [50, 55, 59, 64], 81],
    [34, [50, 57, 60, 65], 84], [34, [50, 57, 60, 65], 86], [38, [52, 57, 60, 67], 84], [38, [52, 57, 60, 67], 88], [31, [50, 57, 59, 66], 88], [31, [50, 57, 59, 66], 86], [36, [52, 55, 59, 66], 83], [36, [52, 55, 59, 66], 88],
    [31, [50, 57, 59, 66], 86], [31, [50, 57, 59, 66], 83], [28, [50, 55, 59, 66], 83], [28, [50, 55, 59, 66], 78], [33, [52, 57, 60, 67], 76], [33, [52, 57, 60, 67], 84], [36, [50, 57, 58, 65], 81], [36, [50, 57, 58, 65], 79],
    [38, [48, 53, 57, 62], 77], [38, [48, 53, 57, 62], 76], [31, [50, 53, 57, 58], 74], [31, [50, 53, 57, 58], 77], [36, [50, 52, 55, 58], 79], [36, [50, 52, 55, 58], 76], [29, [48, 53, 55, 57], 81], [29, [48, 53, 55, 57], 77],
  ]),
  glass: melody("Glass", [
    [33, [49, 51, 52, 56], 73], [33, [49, 51, 52, 56], 71], [33, [49, 51, 54, 59], 75], [33, [49, 51, 54, 59], 78], [33, [49, 52, 56, 57], 76], [33, [49, 52, 56, 57], 73], [30, [49, 52, 54, 57], 69], [30, [49, 52, 54, 57], 68],
    [38, [49, 52, 54, 57], 78], [38, [49, 52, 54, 57], 81], [37, [49, 52, 56, 59], 80], [37, [49, 52, 56, 59], 76], [35, [50, 54, 57, 59], 78], [35, [50, 54, 57, 59], 74], [28, [50, 54, 57, 59], 81], [28, [50, 54, 57, 59], 83],
    [30, [52, 56, 57, 59], 85], [30, [52, 56, 57, 59], 83], [38, [49, 50, 54, 57], 81], [38, [49, 50, 54, 57], 80], [35, [49, 50, 57, 64], 78], [35, [49, 50, 57, 64], 81], [28, [49, 50, 57, 66], 85], [28, [49, 50, 57, 66], 83],
    [33, [49, 56, 59, 64], 83], [33, [49, 56, 59, 64], 85], [38, [49, 56, 57, 66], 80], [38, [49, 56, 57, 66], 76], [28, [50, 56, 59, 66], 86], [28, [50, 56, 59, 66], 83], [30, [49, 54, 57, 64], 85], [30, [49, 54, 57, 64], 81],
    [38, [49, 54, 57, 64], 81], [38, [49, 54, 57, 64], 85], [28, [52, 56, 59, 66], 83], [28, [52, 56, 59, 66], 78], [37, [49, 56, 59, 64], 76], [37, [49, 56, 59, 64], 80], [37, [51, 56, 59, 66], 78], [37, [51, 56, 59, 66], 83],
    [38, [52, 57, 61, 66], 85], [38, [52, 57, 61, 66], 88], [30, [56, 59, 61, 64], 88], [30, [56, 59, 61, 64], 85], [35, [54, 58, 61, 63], 87], [35, [54, 58, 61, 63], 85], [28, [56, 58, 59, 64], 87], [28, [56, 58, 59, 64], 88],
    [35, [54, 58, 61, 63], 87], [35, [54, 58, 61, 63], 85], [32, [54, 56, 59, 63], 83], [32, [54, 56, 59, 63], 82], [28, [54, 56, 59, 64], 80], [28, [54, 56, 59, 64], 83], [28, [54, 57, 61, 62], 85], [28, [54, 57, 61, 62], 81],
    [30, [52, 54, 57, 61], 81], [30, [52, 54, 57, 61], 80], [35, [50, 54, 57, 59], 78], [35, [50, 54, 57, 59], 74], [28, [50, 54, 56, 59], 83], [28, [50, 54, 56, 59], 86], [33, [49, 52, 57, 59], 85], [33, [49, 52, 57, 59], 81],
  ]),
  aurora: melody("Aurora", [
    [32, [48, 51, 56, 58], 75], [32, [48, 51, 56, 58], 75], [37, [48, 53, 55, 56], 70], [37, [48, 53, 55, 56], 72], [32, [48, 51, 56, 58], 80], [32, [48, 51, 56, 58], 80], [29, [48, 51, 55, 56], 72], [29, [48, 51, 55, 56], 75],
    [37, [48, 51, 53, 56], 77], [37, [48, 51, 53, 56], 77], [36, [50, 51, 55, 58], 72], [36, [50, 51, 55, 58], 74], [34, [48, 49, 53, 56], 82], [34, [48, 49, 53, 56], 80], [39, [49, 53, 56, 58], 80], [39, [49, 53, 56, 58], 82],
    [29, [51, 55, 56, 58], 84], [29, [51, 55, 56, 58], 84], [37, [49, 53, 56, 60], 80], [37, [49, 53, 56, 60], 79], [34, [49, 51, 56, 58], 77], [34, [49, 51, 56, 58], 85], [39, [49, 53, 56, 60], 84], [39, [49, 53, 56, 60], 82],
    [32, [51, 55, 58, 60], 84], [32, [51, 55, 58, 60], 84], [34, [49, 53, 56, 60], 80], [34, [49, 53, 56, 60], 77], [39, [49, 53, 55, 58], 79], [39, [49, 53, 55, 58], 82], [29, [51, 53, 56, 60], 84], [29, [51, 53, 56, 60], 80],
    [37, [51, 53, 56, 60], 80], [37, [51, 53, 56, 60], 80], [39, [51, 55, 58, 65], 75], [39, [51, 55, 58, 65], 77], [36, [48, 55, 58, 63], 79], [36, [48, 55, 58, 63], 87], [36, [50, 55, 58, 65], 86], [36, [50, 55, 58, 65], 84],
    [37, [51, 56, 60, 65], 84], [37, [51, 56, 60, 65], 87], [29, [51, 58, 60, 67], 87], [29, [51, 58, 60, 67], 84], [34, [52, 57, 62, 65], 86], [34, [52, 57, 62, 65], 88], [39, [51, 58, 62, 67], 86], [39, [51, 58, 62, 67], 82],
    [34, [48, 57, 62, 65], 77], [34, [48, 57, 62, 65], 77], [31, [50, 57, 58, 65], 72], [31, [50, 57, 58, 65], 74], [39, [51, 55, 58, 65], 82], [39, [51, 55, 58, 65], 82], [39, [49, 56, 60, 65], 84], [39, [49, 56, 60, 65], 80],
    [29, [48, 51, 53, 56], 80], [29, [48, 51, 53, 56], 79], [34, [48, 49, 53, 56], 75], [34, [48, 49, 53, 56], 75], [39, [49, 53, 55, 58], 70], [39, [49, 53, 55, 58], 72], [32, [48, 51, 56, 58], 80], [32, [48, 51, 56, 58], 80],
  ]),
});
if (Object.keys(MELODIES).join() !== MELODY_NAMES.join() || MELODY_NAMES.some((k) => MELODIES[k].steps.length !== 64)) throw new Error('sound: the melodies are not the four of 64 steps MELODY_NAMES names');
/** The melody step a track with `pieces` pieces has just played on its last placement (0..63); the first piece is step 0. */
const stepOf = (pieces) => (((pieces - 1) % 64) + 64) % 64;
// THE PLACE SWELL (D377, the librarian's ruling on E's batch 11, the keeper can veto). The steps carry pitch only, so every place played at one level and a
// walk's phrases sat within 1.8 LU of each other. A place is now lifted by its step's swell: from `floor` dB at step 1, rising on a half cosine to `peak` over
// steps 45 to 52 (indices rise..fall: the lift and the register's top), then easing back on a half cosine to the floor at step 64, so the next round
// starts where this one did. Undo is not swelled. The two levels are as wide as the bands allow: every one of the 64 places of each melody, alone, stays in
// the one-place band with 0.2 dB to spare (Glass's loud steps 43-44 set the peak), and the first place stays 0.3 dB over the loudest drag (the width
// drag, which sets the floor; app/test/sound-bands.test.js)
const SWELL = Object.freeze({ floor: -1.0, peak: 0.7, rise: 44, fall: 51 });
/** The place swell, in dB, of melody step i (0..63, wrapped round the 64). */
function swellDb(i) {
  if (!Number.isInteger(i)) throw new Error(`sound: a melody step is a whole number, got ${i}`);
  const k = ((i % 64) + 64) % 64, { floor, peak, rise, fall } = SWELL;
  const s = k <= rise ? 0.5 - 0.5 * Math.cos(Math.PI * k / rise) : k <= fall ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (k - fall) / (63 - fall));
  return floor + (peak - floor) * s;
}

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
  return notePlan(kind, value, value > prev, melAt);
}
/** The note a tick plays for a handle's value, moving `up` or down (tickPlan's choice, once it has decided to tick): { midi, pan, spread, melAt }. */
// D374: with the fields read as corners (the panel's default) the climb and turn handles are climbDeg and turnDeg (app/core/handles.js), and they sound as
// climb and turn do; unnamed here, a corner climb walked the length melody ("it doesnt do the climb effect")
const SOUNDS_AS = Object.freeze({ climbDeg: 'climb', turnDeg: 'turn' });
function notePlan(kind, value, up, melAt = 0) {
  kind = SOUNDS_AS[kind] || kind;
  const n = Math.round(value);
  if (kind === 'climb') return { midi: scaleMidi(clamp(n, -20, 14)), pan: 0, spread: null, melAt };
  if (kind === 'bank') return { midi: arpMidi(((n % 15) + 15) % 15), pan: 0, spread: null, melAt };
  const at = melAt + (up ? 1 : -1), midi = MEL128[((at % 128) + 128) % 128];
  if (kind === 'turn') return { midi, pan: clamp(-value / 20, -1, 1), spread: null, melAt: at };   // the turn handle's + is a LEFT turn: the left ear
  if (kind === 'width') return { midi, pan: 0, spread: clamp((value - 1) / 49, 0, 1), melAt: at };
  return { midi, pan: 0, spread: null, melAt: at };
}

// ── the engine ──
/** The audio graph and the voices, on one AudioContext. Everything is scheduled from ctx.currentTime. */
/**
 * D345 addition 2 (a default the keeper can veto): a DELIBERATE single step (`single`: a wheel notch, an arrow nudge, a reset) always ticks and moves the melody one
 * place, whatever its size; anything else is tickPlan's (a drag: a tick only on a whole number). Its direction is the value's against `prev` (up when there is none).
 */
function stepPlan(kind, prev, value, melAt = 0, single = false) {
  if (!single) return tickPlan(kind, prev, value, melAt);
  if (!Number.isFinite(value)) return null;
  return notePlan(kind, value, Number.isFinite(prev) ? value > prev : true, melAt);
}

// `melody` (D375): which of MELODIES place and undo play, the first if none is given; the player passes the one its launch picked
function createEngine(ctx, { random = Math.random, melody = MELODY_NAMES[0] } = {}) {   // `random`: where the noise of the reverbs and the crash comes from; a seeded one makes a render repeatable (app/test/soundrender.js)
  if (!MELODY_NAMES.includes(melody)) throw new Error(`sound: no melody named ${melody} (the four: ${MELODY_NAMES.join(', ')})`);
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
    for (let c = 0; c < 2; c++) { const x = b.getChannelData(c); let lp = 0; for (let i = 0; i < n; i++) { const t = i / sr, k = shape(t); lp += k * ((random() * 2 - 1) - lp); x[p + i] = lp * Math.exp(-t * decay); } }
    return b;
  };
  // the VOID: vast and dark
  const voidSend = ctx.createGain(), vhp = ctx.createBiquadFilter(), voidVerb = ctx.createConvolver(), vg = ctx.createGain();
  // 2026-10-15, asked for on hearing it: a bigger room, the echo quieter. Walls further off (a 140 ms pre-delay, was 85), a ~11 s tail (decay 0.6, was 0.95 over 7.5 s), a little more sent in
  voidSend.gain.value = 0.65; vhp.type = 'highpass'; vhp.frequency.value = 220; voidVerb.buffer = noiseIR(11, 0.14, 0.6, (t) => 0.85 * Math.exp(-t / 2.1) + 0.03); vg.gain.value = 0.9;
  preBus.connect(voidSend); voidSend.connect(vhp); vhp.connect(voidVerb); voidVerb.connect(vg); vg.connect(out);
  // a short bright room, for the voices' own air (joins after the echo send, so a dry voice's room stays dry)
  const room = ctx.createConvolver(), roomG = ctx.createGain(); room.buffer = noiseIR(1.6, 0, 3.2, () => 1); roomG.gain.value = 0.32; room.connect(roomG); roomG.connect(preBus);
  // the ECHO: 420 ms, alternating ears, each repeat 0.62 of the last, a little darker, a slow tape warble
  const dIn = ctx.createGain(), dl = ctx.createDelay(1.5), dr = ctx.createDelay(1.5), fbl = ctx.createGain(), fbr = ctx.createGain();
  const lpd = ctx.createBiquadFilter(), hpd = ctx.createBiquadFilter(), dm = ctx.createChannelMerger(2), dOut = ctx.createGain();
  dIn.gain.value = 1; dl.delayTime.value = 0.42; dr.delayTime.value = 0.42; fbl.gain.value = 0.5; fbr.gain.value = 0.5;   // each repeat half the last (was 0.62)
  lpd.type = 'lowpass'; lpd.frequency.value = 5200; hpd.type = 'highpass'; hpd.frequency.value = 150;
  const wow = ctx.createOscillator(), wowL = ctx.createGain(), wowR = ctx.createGain(); wow.frequency.value = 0.27; wowL.gain.value = 0.0035; wowR.gain.value = -0.0028;
  wow.connect(wowL); wowL.connect(dl.delayTime); wow.connect(wowR); wowR.connect(dr.delayTime); wow.start();
  master.connect(dIn); dIn.connect(hpd); hpd.connect(lpd); lpd.connect(dl);
  dl.connect(dm, 0, 0); dl.connect(fbl); fbl.connect(dr); dr.connect(dm, 0, 1); dr.connect(fbr); fbr.connect(hpd);
  dm.connect(dOut); dOut.gain.value = 0.5; dOut.connect(out);   // a faint trail behind the sound, about 8 dB down on the first draft (1.25)

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
    for (let c = 0; c < 2; c++) { const x = n.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] = random() * 2 - 1; }
    const s = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = n; hp.type = 'highpass'; hp.frequency.value = 5200;
    g.gain.setValueAtTime(peak, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d); s.connect(hp); hp.connect(g); g.connect(bus); s.start(t0); s.stop(t0 + d + 0.05);
  }
  const dry = (fn) => { const b = bus; bus = dryBus; try { fn(); } finally { bus = b; } };

  // D349: the recorded voices (SAMPLES), once useSamples has them; until then `samples` is null and the synth below plays. One sample per slot, each
  // note pitched by playback rate from the note it was rendered on, played into `into` with its gain, pan and (for the tick) its attack fade
  let samples = null;
  function sampleVoice(slot, midi, { t = 0, gain = 1, pan = 0, into, fade = 0 }) {
    const file = SAMPLES.file[slot]; if (!file) throw new Error(`sound: no sample slot ${slot}`);
    const t0 = at(t), s = ctx.createBufferSource(), g = ctx.createGain(), p = ctx.createStereoPanner(), level = gain * SAMPLES.gain[file] * (slot === 'drag_tick' ? Math.pow(rateOf(file, midi), SAMPLES.tickEven) : 1);
    s.buffer = samples[file]; s.playbackRate.value = rateOf(file, midi); p.pan.value = clamp(pan, -1, 1);
    if (fade > 0) { g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(level, t0 + fade); } else g.gain.value = level;
    s.connect(g); g.connect(p); p.connect(into); s.start(t0); return s;
  }
  const roomSend = (from, wet) => { const w = ctx.createGain(); w.gain.value = wet; from.connect(w); w.connect(room); };

  // the tick: the tine, through its own gain that the next tick chokes; `spread` plays two copies apart (the width handle)
  let tickBus = null;
  // D345: the tine of 3a26bc5 back (a 14:1 FM pluck in a 90 ms envelope), at D334's loudness: TINE.peak lifts it 3 dB, so a drag measures about -31 LUFS as
  // D334's did. D334's voice (a 1:1 FM body, a 7.1x bell, a high-passed click, a 0.34 s ring) is in git at 4ccf5b7 for the side-by-side; the ticks' notes,
  // tickPlan, are unchanged
  function tineVoice(f, t0, into, d = 0.09) {
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mgn = ctx.createGain(), g = ctx.createGain();
    car.frequency.value = f; mod.frequency.value = f * 14; mgn.gain.setValueAtTime(f * 0.9, t0); mgn.gain.exponentialRampToValueAtTime(f * 0.01, t0 + 0.03);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(TINE.peak, t0 + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    mod.connect(mgn); mgn.connect(car.frequency); car.connect(g); g.connect(into); car.start(t0); mod.start(t0); car.stop(t0 + d + 0.02); mod.stop(t0 + d + 0.02);
  }
  function tick({ midi, pan = 0, spread = null }) {
    const now = ctx.currentTime;
    if (tickBus) { const g = tickBus.gain; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.004); }
    const tb = ctx.createGain(); tb.gain.value = 0.6; tb.connect(dryBus); tickBus = tb;   // ticks are DRY: no echo
    const w = ctx.createGain(); w.gain.value = 0.2; tb.connect(w); w.connect(room);
    if (samples) {   // the same two copies for width, the same choke and the same dry bus as the tine; the sample in its place
      if (spread !== null && spread > 0) [-1, 1].forEach((side, i) => sampleVoice('drag_tick', midi + (i ? spread * 0.12 : 0), { t: i ? spread * 0.011 : 0, gain: 1 - 0.4 * spread, pan: side * spread, into: tb, fade: SAMPLES.tickFade }));
      else sampleVoice('drag_tick', midi, { pan, into: tb, fade: SAMPLES.tickFade });
      return;
    }
    if (spread !== null && spread > 0) {
      [-1, 1].forEach((side, i) => { const g = ctx.createGain(), pn = ctx.createStereoPanner(); g.gain.value = 1 - 0.4 * spread; pn.pan.value = side * spread; g.connect(pn); pn.connect(tb); tineVoice(mtof(midi + (i ? spread * 0.12 : 0)), now + (i ? spread * 0.011 : 0), g); });
    } else { const pn = ctx.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1); pn.connect(tb); tineVoice(mtof(midi), now, pn); }
  }
  function step(i, soft) {   // a place (soft = false) or an undo (soft = true) of melody step i, of this engine's melody
    const steps = MELODIES[melody].steps, [b, chord, mel] = steps[((i % steps.length) + steps.length) % steps.length], vel = soft ? 0.32 : 0.55;
    const lift = soft ? 1 : Math.pow(10, swellDb(i) / 20);   // D377: a place swells with its step; an undo does not
    if (samples) {   // the synth's six notes, timings and levels (as the sketch page's playStep8), each the slot's sample; echoed and roomed as the Rhodes is
      const slot = `${soft ? 'undo' : 'place'}_${melody}`, sb = ctx.createGain(); sb.connect(bus); roomSend(sb, 0.45);
      chord.forEach((m, k) => sampleVoice(slot, m, { t: (soft ? 0.03 : 0.012) * k, gain: lift * vel * 0.85 / 0.55, pan: -0.3 + k * 0.2, into: sb }));
      sampleVoice(slot, mel, { t: soft ? 0.12 : 0.06, gain: lift * (soft ? 0.38 : 0.7) / 0.55, into: sb });
      sampleVoice(slot, b, { gain: lift * (soft ? 0.16 : 0.24) / 0.24 * 0.7, into: sb });
      return;
    }
    chord.forEach((m, k) => rhodes(m, { t: (soft ? 0.03 : 0.012) * k, vel: lift * vel * 0.85, pan: -0.3 + k * 0.2, d: soft ? 1.0 : 1.6 }));
    rhodes(mel, { t: soft ? 0.12 : 0.06, vel: lift * (soft ? 0.38 : 0.7), d: soft ? 1.1 : 1.8 });
    bass(b, 0, soft ? 0.6 : 0.9, lift * (soft ? 0.16 : 0.24));
  }
  function loopClosed() {   // one gesture: the roll (dry), the lead answering (echoed), the landing (dry), a high note ringing (echoed)
    if (samples) { const lb = ctx.createGain(); lb.connect(dryBus); roomSend(lb, 0.5); sampleVoice('loop_closed', null, { into: lb }); return; }   // the whole gesture is one recording: dry, with the landing's room
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
  /** Hand the engine its decoded sample files, keyed by file (SAMPLES.slots: { drag_tick, place, undo, loop_closed }); from then on they play in place of the synth. A set with one missing is refused. */
  function useSamples(buffers) {
    if (!buffers || typeof buffers !== 'object') throw new Error('sound: useSamples needs the samples, got ' + buffers);
    const missing = SAMPLES.slots.filter((s) => !buffers[s]); if (missing.length) throw new Error(`sound: the samples are missing ${missing.join(', ')}`);
    samples = Object.fromEntries(SAMPLES.slots.map((s) => [s, buffers[s]]));
  }
  return { master, dryBus, melody, tick, step, loopClosed, useSamples, setLevel(v) { master.gain.value = v; dryBus.gain.value = v; } };
}

/**
 * The player. `win` is the window (AudioContext, localStorage, document). Returns
 * { handle(prev, next), setMuted(b), setVolume(v), muted, volume, started, melody, unmount() }.
 * `pick` (D375) draws the launch's melody, once, as the player is made (one launch of the builder): a number from 0 up to 1, Math.random in the app;
 * the melody is not saved, so the next launch draws again.
 */
function createSound(win, { log = (m) => { try { console.warn(m); } catch (e) { /* nowhere to log */ } }, engineFor = createEngine, base = 'sounds/', pick = Math.random } = {}) {
  const r = typeof pick === 'function' ? pick() : NaN;
  if (typeof r !== 'number' || !(r >= 0 && r < 1)) throw new Error(`sound: a melody pick is a number from 0 up to 1, got ${r}`);
  const melody = MELODY_NAMES[Math.floor(r * MELODY_NAMES.length)];
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
    try { ctx = new Ctx(); engine = engineFor(ctx, { melody }); engine.setLevel(level()); } catch (e) { ctx = null; engine = null; log(`sound: no audio here (${e && e.message})`); return; }
    loadSamples();
  };
  // D349: the four samples, fetched from `base` and decoded once, as audio starts; the engine plays its synth until they are in, and keeps it if they fail
  const loadSamples = () => {
    const c = ctx, e = engine, fail = (why) => log(`sound: the samples did not load (${why}); the synth voices play instead`);
    const get = typeof win.fetch === 'function' ? win.fetch.bind(win) : null;
    if (!get) { fail('no fetch in this window'); return; }
    Promise.all(SAMPLES.slots.map((s) => get(`${base}${s}.wav`)
      .then((r) => { if (!r || !r.ok) throw new Error(`${s}.wav answered ${r ? r.status : 'nothing'}`); return r.arrayBuffer(); })
      .then((a) => c.decodeAudioData(a))
      .then((b) => [s, b])))
      .then((pairs) => { if (engine === e) e.useSamples(Object.fromEntries(pairs)); })
      .catch((err) => fail(err && err.message));
  };
  const live = () => !!engine && !muted;
  const guard = (what, fn) => { try { fn(); return true; } catch (e) { log(`sound: ${what} could not play (${e && e.message})`); return false; } };
  // the ticks: each handle's last value and its place in the melody, kept here
  const lastValue = {}, melAt = {};
  const onStep = (e) => {
    const d = e && e.detail; if (!d || typeof d.kind !== 'string') return;
    const plan = stepPlan(d.kind, lastValue[d.kind], Number(d.value), melAt[d.kind] || 0, d.single === true);
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
    get melody() { return melody; },
    unmount() { if (doc && doc.removeEventListener) { doc.removeEventListener('pointerdown', onGesture, true); doc.removeEventListener('keydown', onGesture, true); doc.removeEventListener('t180:handle-step', onStep); } },
  };
}

if (typeof module !== 'undefined') module.exports = { createSound, createEngine, SAMPLES, soundFor, tickPlan, stepPlan, notePlan, stepOf, swellDb, SWELL, MELODIES, MELODY_NAMES, MEL128, TICK_MS, KEYS };
