// sound-bands.test.js: node --test app/test/sound-bands.test.js. The builder's sounds as they come out of the real engine (app/sound.js), rendered in
// HEADLESS Chrome (app/test/soundrender.js: an OfflineAudioContext, never a window), each clip's loudness (ITU-R BS.1770-4 integrated, LUFS) and sample
// peak held inside its band. The bands come from the D334 listening pass (2026-10-16): there a drag on any handle measured -30.0 to -30.7 LUFS,
// a place -28.3, an undo -30.4 and the loop close -20.2; the old tick, which read as "bubbles underwater", measured -45.7 alone. The engine's
// reverbs are random noise, so a clip moves a few tenths of a LU between renders: the bands allow for that.
// Skipped, with the reason, where no Chrome can be found (set CHROME_PATH).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const S = require('./soundrender.js');

// [lowest LUFS, highest LUFS, highest peak dBFS]
const BANDS = Object.freeze({
  tick_single: [-45, -40, -24],
  ticks_length_drag: [-33, -28, -15], ticks_climb_drag: [-33, -28, -15], ticks_bank_drag: [-33, -28, -15], ticks_width_drag: [-33, -28, -15],
  place_step1: [-30.5, -26, -6], place_steps_1to4: [-27, -22.5, -5],
  undo_steps_4to1: [-33, -28, -12],
  loop_closed: [-22.5, -18, -1],
});
const SRC = process.env.SOUND_SRC || path.join(__dirname, '..', 'sound.js');   // SOUND_SRC: measure another copy of the engine (the red run)
const chrome = S.chromePath();

test('every sound sits inside its loudness and peak band, the ticks under a place, a place under the loop close', { skip: chrome ? false : 'no Chrome found (set CHROME_PATH): the engine needs a real Web Audio to render' }, async () => {
  const clips = await S.renderClips(fs.readFileSync(SRC, 'utf8'));
  const got = Object.fromEntries(Object.entries(clips).map(([k, c]) => [k, { lufs: Math.round(S.lufs(c) * 10) / 10, peak: Math.round(S.peakDb(c) * 10) / 10 }]));
  const out = Object.entries(BANDS).filter(([k, [lo, hi, pk]]) => !(got[k].lufs >= lo && got[k].lufs <= hi && got[k].peak <= pk)).map(([k, b]) => `${k} ${got[k].lufs} LUFS, peak ${got[k].peak} dBFS (band ${b[0]}..${b[1]} LUFS, peak <= ${b[2]})`);
  assert.deepEqual(out, [], 'outside the band');
  for (const k of Object.keys(BANDS).filter((x) => x.startsWith('ticks_'))) assert.ok(got[k].lufs < got.place_step1.lufs, `${k} (${got[k].lufs}) is under a place (${got.place_step1.lufs})`);
  assert.ok(got.place_step1.lufs < got.loop_closed.lufs, `a place (${got.place_step1.lufs}) is under the loop close (${got.loop_closed.lufs})`);
});

test('the loudness meter reads the standard\'s reference: a 1 kHz sine at -20 dBFS on both channels is -20.0 LUFS (within 0.1); silence is below every gate', () => {
  // EBU Tech 3341's first case: a stereo 1 kHz sine at -23 dBFS reads -23.0 LUFS; the same at -20 dBFS reads -20.0 (997 Hz keeps it off the sample grid)
  const sr = 48000, n = sr * 3, L = new Float32Array(n), A = Math.pow(10, -20 / 20);
  for (let i = 0; i < n; i++) L[i] = A * Math.sin(2 * Math.PI * 997 * i / sr);
  const v = S.lufs({ L, R: L, sampleRate: sr });
  assert.ok(Math.abs(v - (-20)) < 0.1, `got ${v.toFixed(3)} LUFS`);
  assert.equal(S.lufs({ L: new Float32Array(n), R: new Float32Array(n), sampleRate: sr }), -Infinity, 'silence is below every gate');
  assert.throws(() => S.lufs({ L, R: L, sampleRate: 44100 }), /48 kHz/);
});
