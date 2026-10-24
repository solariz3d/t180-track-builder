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

const SAMPLES_DIR = process.env.SOUND_SAMPLES || path.join(__dirname, '..', 'sounds');
const noChrome = { skip: chrome ? false : 'no Chrome found (set CHROME_PATH): the engine needs a real Web Audio to render' };

// AMENDED (D349): the sounds as shipped are now the four samples (app/sounds), so this row renders the engine with them; its bands and its order are
// unchanged. The synth voices, which play until the samples are in, keep the same bands in the row after it
test('every sound sits inside its loudness and peak band, the ticks under a place, a place under the loop close', noChrome, async () => {
  inBands(await S.renderClips(fs.readFileSync(SRC, 'utf8'), S.CLIPS, { samples: SAMPLES_DIR }));
});
// D375: a launch plays one of four melodies, each on its own place and undo files (batch 10, the drop-in), so each one's place and undo, with the samples,
// sits in the same bands as the row above measures for the first. One row per melody, so a red names the melody
// AMENDED (D377): the keeper's four for 0.4.2, batch 11's three and batch 12's Aurora, in place of batch 10's
// AMENDED (D402): and SIGIL's own, Obsidian, on PL Phantoms (batch 13), fifth
for (const [melody, instrument] of [['aqua', 'Big Bells'], ['skyline', 'Runtheharm'], ['glass', 'VeloHarm'], ['aurora', 'Linear Arithmetic'], ['sigil', 'Phantoms']]) {
  test(`${melody} (${instrument}): its place and undo, with the samples, sit inside their bands`, noChrome, async () => {
    const keys = ['place_step1', 'place_steps_1to4', 'undo_steps_4to1'], out = [];
    const clips = await S.renderClips(fs.readFileSync(SRC, 'utf8'), Object.fromEntries(keys.map((k) => [k, S.CLIPS[k]])), { samples: SAMPLES_DIR, melody });
    for (const k of keys) {
      const [lo, hi, pk] = BANDS[k], l = Math.round(S.lufs(clips[k]) * 10) / 10, p = Math.round(S.peakDb(clips[k]) * 10) / 10;
      if (!(l >= lo && l <= hi && p <= pk)) out.push(`${k} ${l} LUFS, peak ${p} dBFS (band ${lo}..${hi} LUFS, peak <= ${pk})`);
    }
    assert.deepEqual(out, [], 'outside the band');
  });
  // D377: the place swell. A walk of all 64 places (0.7 s apart, as E's arcmeasure on batch 11) cut into its eight phrases of 8: before the swell every
  // phrase sat within 1.8 LU of the others, the loudest often the first (phrases 6-7 over 1 and 8 by 0.55 LU at most, Glass's -0.5). Now phrases 6 and 7
  // (steps 41 to 56, the lift and the peak) are at least 0.7 LU over phrases 1 and 8, on the mean of each pair (the bands leave room for about 0.8 in
  // Glass); and every one of the 64 places, alone, still sits inside the one-place band
  test(`${melody} (${instrument}): its walk swells to phrases 6 and 7, and every one of its 64 places sits inside the one-place band`, noChrome, async () => {
    const clips = { walk64: [0.05 + 63 * 0.7 + 6, 'for (let i = 0; i < 64; i++) at(0.05 + i * 0.7, () => E.step(i, false));'] };
    for (let i = 0; i < 64; i++) clips[`p${i}`] = [6.0, `at(0.05, () => E.step(${i}, false));`];
    const c = await S.renderClips(fs.readFileSync(SRC, 'utf8'), clips, { samples: SAMPLES_DIR, melody }), sr = 48000, w = c.walk64;
    const ph = [...Array(8)].map((_, p) => { const a = Math.floor((0.05 + p * 5.6) * sr), b = Math.floor((0.05 + (p + 1) * 5.6) * sr); return S.lufs({ L: w.L.slice(a, b), R: w.R.slice(a, b), sampleRate: sr }); });
    const peakPair = (ph[5] + ph[6]) / 2, ends = (ph[0] + ph[7]) / 2;
    assert.ok(peakPair - ends >= 0.7,`phrases 6-7 ${peakPair.toFixed(1)} LUFS against phrases 1 and 8 ${ends.toFixed(1)} (phrases ${ph.map((x) => x.toFixed(1)).join(' ')})`);
    const [lo, hi, pk] = BANDS.place_step1, out = [];
    for (let i = 0; i < 64; i++) { const l = Math.round(S.lufs(c[`p${i}`]) * 10) / 10, p = Math.round(S.peakDb(c[`p${i}`]) * 10) / 10; if (!(l >= lo && l <= hi && p <= pk)) out.push(`step ${i + 1}: ${l} LUFS, peak ${p}`); }
    assert.deepEqual(out, [], `outside the one-place band (${lo}..${hi} LUFS, peak <= ${pk})`);
  });
}
test('the synth voices (before the samples are in, or if they fail to load) sit inside the same bands, in the same order', noChrome, async () => {
  inBands(await S.renderClips(fs.readFileSync(SRC, 'utf8')));
});
// D349 addition: soundrender seeds the engine's noise, so the same clip renders to the same samples every time and the bands above are measured on one
// fixed sound, not on a new draw of reverb noise each run (which put a clip over its line in about 1 run of 4)
// Not bit for bit: Chrome's convolver sums in an order that moves the last float bits between runs (measured: two seeded renders differ by at most 1.1e-6,
// under -110 dB, and read the same LUFS and peak to 0.01). So the same seed must agree within 1e-4 (-80 dBFS); unseeded, the reverb noise differs by ~1e-1
const maxDiff = (a, b) => { let m = 0; for (const ch of ['L', 'R']) for (let i = 0; i < a[ch].length; i++) m = Math.max(m, Math.abs(a[ch][i] - b[ch][i])); return m; };
test('the same seed renders the same clip (within -80 dBFS); another seed renders another', noChrome, async () => {
  const src = fs.readFileSync(SRC, 'utf8'), one = { tick_single: S.CLIPS.tick_single, place_step1: S.CLIPS.place_step1 };
  const [a, b, c] = [await S.renderClips(src, one), await S.renderClips(src, one), await S.renderClips(src, one, { seed: 12345 })];
  for (const k of Object.keys(one)) {
    assert.ok(maxDiff(a[k], b[k]) < 1e-4, `${k}: two renders with the same seed agree (max difference ${maxDiff(a[k], b[k]).toExponential(2)})`);
    assert.ok(maxDiff(a[k], c[k]) > 1e-3, `${k}: another seed differs (max difference ${maxDiff(a[k], c[k]).toExponential(2)})`);
  }
});
function inBands(clips) {
  const got = Object.fromEntries(Object.entries(clips).map(([k, c]) => [k, { lufs: Math.round(S.lufs(c) * 10) / 10, peak: Math.round(S.peakDb(c) * 10) / 10 }]));
  const out = Object.entries(BANDS).filter(([k, [lo, hi, pk]]) => !(got[k].lufs >= lo && got[k].lufs <= hi && got[k].peak <= pk)).map(([k, b]) => `${k} ${got[k].lufs} LUFS, peak ${got[k].peak} dBFS (band ${b[0]}..${b[1]} LUFS, peak <= ${b[2]})`);
  assert.deepEqual(out, [], 'outside the band');
  for (const k of Object.keys(BANDS).filter((x) => x.startsWith('ticks_'))) assert.ok(got[k].lufs < got.place_step1.lufs, `${k} (${got[k].lufs}) is under a place (${got.place_step1.lufs})`);
  assert.ok(got.place_step1.lufs < got.loop_closed.lufs, `a place (${got.place_step1.lufs}) is under the loop close (${got.loop_closed.lufs})`);
}

test('the loudness meter reads the standard\'s reference: a 1 kHz sine at -20 dBFS on both channels is -20.0 LUFS (within 0.1); silence is below every gate', () => {
  // EBU Tech 3341's first case: a stereo 1 kHz sine at -23 dBFS reads -23.0 LUFS; the same at -20 dBFS reads -20.0 (997 Hz keeps it off the sample grid)
  const sr = 48000, n = sr * 3, L = new Float32Array(n), A = Math.pow(10, -20 / 20);
  for (let i = 0; i < n; i++) L[i] = A * Math.sin(2 * Math.PI * 997 * i / sr);
  const v = S.lufs({ L, R: L, sampleRate: sr });
  assert.ok(Math.abs(v - (-20)) < 0.1, `got ${v.toFixed(3)} LUFS`);
  assert.equal(S.lufs({ L: new Float32Array(n), R: new Float32Array(n), sampleRate: sr }), -Infinity, 'silence is below every gate');
  assert.throws(() => S.lufs({ L, R: L, sampleRate: 44100 }), /48 kHz/);
});
