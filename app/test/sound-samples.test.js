// app/test/sound-samples.test.js: node --test app/test/sound-samples.test.js
// D349: the builder plays four recorded samples (app/sounds/*.wav, rendered from Serum's factory presets on the sketch page's batch 8) in place of its
// synth voices: the tick, place, undo and the loop close. WHEN and WHICH note are unchanged (tickPlan, notePlan, stepPlan, MEL128, the 16 steps, pan,
// spread); only the voice that plays the note changes. Each note is the slot's one sample pitched by playback rate from the note it was rendered on
// (the tick 84, place and undo 60): rate 2^((n - ref) / 12). The samples load once, at the first press or key; until they are decoded the synth plays,
// so a first press is never silent, and a failed load is logged and leaves the synth in place. Rows:
//   1  the engine plays the synth before it has samples, and a sample for each of the four events once it has them (no oscillator for those events)
//   2  the pitch: a tick for note n plays at 2^((n-84)/12); a place's and an undo's notes at 2^((m-60)/12); the loop close at 1
//   3  width keeps its two copies; each tick chokes the last; a tick's attack is faded in
//   4  the player fetches and decodes the four files once, at the first gesture, from `base`; the synth plays until they are in
//   5  a failed fetch, a refused file or a failed decode is logged and the synth keeps playing; no fetch at all is logged the same way
//   6  the files are the four batch-8 WAVs, byte for byte (sha256), and useSamples refuses a set with one missing
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SND = require('../sound.js');
const { createSound, createEngine, SAMPLES, MELODIES, MELODY_NAMES } = SND;
// AMENDED (D375): the 16 steps became four melodies of 64; an engine given no melody plays the first, so rows 2 and 3b read its steps where they read the 16
const STEPS = MELODIES[MELODY_NAMES[0]].steps;

// AMENDED (D375 drop-in): each melody plays its own two files (batch 10), so the files loaded are the tick, the loop close and those eight; place.wav and
// undo.wav stay in app/sounds (row 6 still checks them) but no slot plays them
const MEL = ['yearning', 'shoegaze', 'occult', 'afterglow'];
const SLOTS = ['drag_tick', 'loop_closed', ...MEL.flatMap((m) => [`place_${m}`, `undo_${m}`])];
/** A fake AudioContext whose nodes and param calls are kept, so a test can ask which buffer each source played, at what rate, and what each gain did. */
function fakeCtx() {
  const nodes = [];
  const param = (v = 0) => { const p = { value: v, calls: [], setValueAtTime(x, t) { p.calls.push(['set', x, t]); }, linearRampToValueAtTime(x, t) { p.calls.push(['lin', x, t]); }, exponentialRampToValueAtTime(x, t) { if (!(x > 0)) throw new Error(`exponential ramp to ${x}`); p.calls.push(['exp', x, t]); }, cancelScheduledValues(t) { p.calls.push(['cancel', t]); }, setTargetAtTime() {} }; return p; };
  const node = (kind) => { const n = new Proxy({ kind, outs: [], started: null, connect(d) { n.outs.push(d); return d; }, disconnect() {}, start(t) { n.started = t; }, stop() {} }, { get(t, k) { if (!(k in t)) t[k] = param(); return t[k]; }, set(t, k, v) { t[k] = v; return true; } }); nodes.push(n); return n; };
  const ctx = { currentTime: 1, sampleRate: 8000, destination: node('destination'), nodes,
    createBuffer: (ch, n) => { const data = Array.from({ length: ch }, () => new Float32Array(n)); return { getChannelData: (c) => data[c] }; } };
  for (const k of ['Gain', 'Oscillator', 'BiquadFilter', 'StereoPanner', 'Delay', 'Convolver', 'ChannelSplitter', 'ChannelMerger', 'DynamicsCompressor', 'BufferSource']) ctx[`create${k}`] = () => node(k);
  ctx.count = (kind) => nodes.filter((n) => n.kind === kind).length;
  return ctx;
}
const fakeBuffers = () => Object.fromEntries(SLOTS.map((s) => [s, { slot: s, duration: 1 }]));
/** What `fn` started: each buffer source made during it, as { slot, rate, started }, plus how many oscillators it made. */
function during(ctx, fn) {
  const n0 = ctx.nodes.length; fn();
  const made = ctx.nodes.slice(n0);
  return { sources: made.filter((n) => n.kind === 'BufferSource' && n.buffer && n.buffer.slot).map((n) => ({ slot: n.buffer.slot, rate: n.playbackRate.value, started: n.started, node: n })), oscillators: made.filter((n) => n.kind === 'Oscillator').length, made };
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} against ${b}`);

test('row 1: the engine plays the synth before it has samples, and a sample for each of the four events once it has them', () => {
  const ctx = fakeCtx(), e = createEngine(ctx);
  const synth = [during(ctx, () => e.tick({ midi: 84 })), during(ctx, () => e.step(0, false)), during(ctx, () => e.step(0, true)), during(ctx, () => e.loopClosed())];
  assert.deepEqual(synth.map((d) => d.sources.length), [0, 0, 0, 0], 'before the samples: no sample plays');
  assert.ok(synth.every((d) => d.oscillators > 0), 'before the samples: the synth plays every event');
  e.useSamples(fakeBuffers());
  const tick = during(ctx, () => e.tick({ midi: 84 })), place = during(ctx, () => e.step(0, false)), undo = during(ctx, () => e.step(0, true)), closed = during(ctx, () => e.loopClosed());
  assert.deepEqual(tick.sources.map((s) => s.slot), ['drag_tick'], 'a tick: the tick sample, once');
  // AMENDED (D375 drop-in): an engine given no melody plays the first, yearning, on its own place and undo files
  assert.deepEqual(place.sources.map((s) => s.slot), Array(6).fill('place_yearning'), 'a place: the place sample for the four chord notes, the melody note and the bass');
  assert.deepEqual(undo.sources.map((s) => s.slot), Array(6).fill('undo_yearning'), 'an undo: the undo sample, the same six notes');
  assert.deepEqual(closed.sources.map((s) => s.slot), ['loop_closed'], 'the loop close: its one sample, whole');
  assert.deepEqual([tick, place, undo, closed].map((d) => d.oscillators), [0, 0, 0, 0], 'with the samples, no synth voice plays');
});

test('row 2: the pitch: a tick for note n plays at 2^((n-84)/12), a place\'s and an undo\'s notes at 2^((m-60)/12), the loop close at 1', () => {
  const ctx = fakeCtx(), e = createEngine(ctx); e.useSamples(fakeBuffers());
  for (const n of [84, 96, 72, 79, 100]) near(during(ctx, () => e.tick({ midi: n })).sources[0].rate, Math.pow(2, (n - 84) / 12), `tick ${n}`);
  for (const i of [0, 3, 9, 15]) {
    const [b, chord, mel] = STEPS[i], want = [...chord, mel, b].map((m) => Math.pow(2, (m - 60) / 12)).sort();
    for (const soft of [false, true]) {
      const got = during(ctx, () => e.step(i, soft)).sources.map((s) => s.rate).sort();
      assert.equal(got.length, want.length); got.forEach((r, k) => near(r, want[k], `step ${i} ${soft ? 'undo' : 'place'} note ${k}`));
    }
  }
  assert.equal(during(ctx, () => e.loopClosed()).sources[0].rate, 1, 'the loop close plays as rendered');
  // AMENDED (D375 drop-in): the eight melody files, all rendered on MIDI 60 (E's batch 10 hand-back), in place of place and undo
  assert.deepEqual({ ...SAMPLES.ref }, { drag_tick: 84, ...Object.fromEntries(MEL.flatMap((m) => [[`place_${m}`, 60], [`undo_${m}`, 60]])) }, 'the reference notes the samples were rendered on');
});

test('row 3: width keeps its two copies, each tick chokes the last, and a tick\'s attack is faded in', () => {
  const ctx = fakeCtx(), e = createEngine(ctx); e.useSamples(fakeBuffers());
  const w = during(ctx, () => e.tick({ midi: 84, spread: 1 }));
  assert.equal(w.sources.length, 2, 'a full-width tick: two copies');
  assert.ok(w.sources[1].rate > w.sources[0].rate && w.sources[1].started > w.sources[0].started, 'the second copy a little higher and a little later');
  assert.equal(during(ctx, () => e.tick({ midi: 84, spread: 0 })).sources.length, 1, 'a mono-width tick: one copy');
  // the choke: the first tick's own gain (between its voice and the dry bus) ramps to 0 within 4 ms of the next tick
  const a = during(ctx, () => e.tick({ midi: 84 })), busA = a.made.find((n) => n.kind === 'Gain' && n.outs.includes(e.dryBus));
  assert.ok(busA, 'a tick has its own gain into the dry bus');
  assert.equal(busA.gain.calls.filter((c) => c[0] === 'lin' && c[1] === 0).length, 0, 'not choked yet');
  ctx.currentTime = 2; during(ctx, () => e.tick({ midi: 86 }));
  const choke = busA.gain.calls.find((c) => c[0] === 'lin' && c[1] === 0);
  assert.ok(choke && choke[2] > 2 && choke[2] <= 2.004 + 1e-9, `the next tick chokes it within 4 ms: ${JSON.stringify(busA.gain.calls)}`);
  // the attack fade: the tick's voice gain starts at 0 and ramps up over SAMPLES.tickFade
  const src = a.sources[0].node, vg = a.made.find((n) => src.outs.includes(n));
  const lin = vg.gain.calls.find((c) => c[0] === 'lin');
  assert.ok(SAMPLES.tickFade > 0, 'there is a fade');
  assert.deepEqual(vg.gain.calls[0].slice(0, 2), ['set', 0], 'the voice starts silent');
  assert.ok(lin && lin[1] > 0 && Math.abs(lin[2] - (a.sources[0].started + SAMPLES.tickFade)) < 1e-9, `and ramps up over the fade: ${JSON.stringify(vg.gain.calls)}`);
});

test('row 3b: a tick an octave up plays at twice the rate and sqrt 2 the level, so a shorter, higher tick carries the same energy; place and undo are not evened', () => {
  const ctx = fakeCtx(), e = createEngine(ctx); e.useSamples(fakeBuffers());
  const level = (d) => { const src = d.sources[0].node, vg = d.made.find((n) => src.outs.includes(n)), lin = vg.gain.calls.find((c) => c[0] === 'lin'); return lin ? lin[1] : vg.gain.value; };
  const lo = level(during(ctx, () => e.tick({ midi: 84 }))), hi = level(during(ctx, () => e.tick({ midi: 96 }))), down = level(during(ctx, () => e.tick({ midi: 72 })));
  near(hi / lo, Math.SQRT2, 'an octave up'); near(down / lo, Math.SQRT1_2, 'an octave down');
  near(lo, SAMPLES.gain.drag_tick, 'at the note it was rendered on: the slot\'s gain');
  const p = during(ctx, () => e.step(0, false)).sources.map((s) => level({ sources: [s], made: ctx.nodes }));
  const [, chord] = STEPS[0]; assert.equal(new Set(p.slice(0, chord.length).map((x) => x.toFixed(9))).size, 1, 'a place\'s chord notes share one level whatever their pitch');
});

// D349 addition (the librarian's ruling, option a): the engine's noise (its reverbs' impulses, the loop close's crash) comes from an optional `random`, so a
// render can be repeated exactly; without one it is Math.random, as before, so nothing a user hears changes
test('row 7: two engines given the same seeded random build the same reverbs and crash; another seed builds others; with none, Math.random as before', () => {
  const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const noise = (random) => { const ctx = fakeCtx(), e = createEngine(ctx, random ? { random } : undefined); e.loopClosed();
    return ctx.nodes.filter((n) => (n.kind === 'Convolver' || n.kind === 'BufferSource') && n.buffer && n.buffer.getChannelData).map((n) => Array.from(n.buffer.getChannelData(0)).join(',')); };
  const a = noise(seeded(7)), b = noise(seeded(7)), c = noise(seeded(8));
  assert.ok(a.length >= 3, `the void, the room and the crash carry noise (${a.length})`);
  assert.deepEqual(a, b, 'the same seed: the same noise, buffer for buffer');
  assert.notDeepEqual(a, c, 'another seed: other noise');
  const orig = Math.random; let calls = 0; Math.random = () => { calls++; return orig(); };
  try { noise(null); } finally { Math.random = orig; }
  assert.ok(calls > 0, 'with no random given, the engine draws from Math.random');
});

// the player, with a recording engine and a fake fetch
function player({ fetchImpl, decode, noFetch = false } = {}) {
  const listeners = {}, calls = [], logs = [], fetched = [];
  class Ctx { constructor() { this.currentTime = 0; } decodeAudioData(a) { return decode ? decode(a) : Promise.resolve({ decoded: a.name }); } }
  const win = { AudioContext: Ctx, localStorage: { getItem: () => null, setItem() {} },
    document: { addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener() {} } };
  if (!noFetch) win.fetch = (url) => { fetched.push(url); return fetchImpl ? fetchImpl(url) : Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve({ name: url }) }); };
  const engineFor = () => ({ tick: (p) => calls.push(['tick', p.midi]), step: (i, soft) => calls.push([soft ? 'undo' : 'place', i]), loopClosed: () => calls.push(['loopClosed']), setLevel() {}, useSamples: (b) => calls.push(['useSamples', b]) });
  const s = createSound(win, { engineFor, base: 'sounds/', log: (m) => logs.push(m) });
  const fire = (t, detail) => (listeners[t] || []).slice().forEach((f) => f({ type: t, detail }));
  return { s, calls, logs, fetched, fire };
}
const settle = () => new Promise((r) => setImmediate(r));

test('row 4: the four files are fetched and decoded once, at the first gesture, from base; the synth plays until they are in', async () => {
  const P = player();
  assert.deepEqual(P.fetched, [], 'nothing is fetched before the first press');
  P.fire('pointerdown'); P.fire('keydown'); P.fire('pointerdown');
  assert.deepEqual(P.fetched, SLOTS.map((s) => `sounds/${s}.wav`), 'the four, once, from base');
  P.fire('t180:handle-step', { kind: 'length', value: 100 });
  assert.deepEqual(P.calls.map((c) => c[0]), ['tick'], 'a tick before the samples are in: the engine plays it (its synth)');
  await settle(); await settle();
  const use = P.calls.find((c) => c[0] === 'useSamples');
  assert.ok(use, 'once decoded, the engine is handed the samples');
  assert.deepEqual(Object.fromEntries(Object.entries(use[1]).map(([k, v]) => [k, v.decoded])), Object.fromEntries(SLOTS.map((s) => [s, `sounds/${s}.wav`])), 'each slot its own decoded file');
  assert.deepEqual(P.logs, [], 'nothing to log');
});

test('row 5: a failed fetch, a refused file or a failed decode is logged and the synth keeps playing; with no fetch at all, the same', async () => {
  const cases = {
    'a fetch that throws': { fetchImpl: () => Promise.reject(new Error('offline')) },
    'a file answered 404': { fetchImpl: (url) => Promise.resolve({ ok: !url.includes('undo'), status: url.includes('undo') ? 404 : 200, arrayBuffer: () => Promise.resolve({ name: url }) }) },
    'a decode that fails': { decode: () => Promise.reject(new Error('not audio')) },
    'no fetch in this window': { noFetch: true },
  };
  for (const [name, o] of Object.entries(cases)) {
    const P = player(o); P.fire('pointerdown'); await settle(); await settle(); await settle();
    assert.equal(P.calls.filter((c) => c[0] === 'useSamples').length, 0, `${name}: the samples are not used`);
    assert.equal(P.logs.length, 1, `${name}: logged once: ${JSON.stringify(P.logs)}`);
    assert.match(P.logs[0], /samples/i, `${name}: the log says what failed`);
    P.fire('t180:handle-step', { kind: 'length', value: 100 }); P.s.handle(...placed());
    assert.deepEqual(P.calls.map((c) => c[0]), ['tick', 'place'], `${name}: the synth still plays`);
  }
  const P = player({ fetchImpl: (url) => Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.resolve({}) }) });
  P.fire('pointerdown'); await settle(); await settle();
  assert.match(P.logs[0], /404/, 'the log carries the answer');
});
const placed = () => { const d = (n) => ({ pieces: Array.from({ length: n }, (_, i) => ({ id: i })), closed: false }); return [{ history: { past: [], present: d(1), future: [] } }, { history: { past: [d(1)], present: d(2), future: [] } }]; };

test('row 6: the four files are the batch-8 WAVs byte for byte, and useSamples refuses a set with one missing', () => {
  // AMENDED (D375): the drag tick is the keeper's pick of batch 9, Eiano tik (G:\Consonance-tools\b9\page\batch9\tick_eiano_tik.wav, copied byte for byte)
  const SHA = { drag_tick: '0c63854e26167115886d2d0fc947362cdc72c82271b12e2bcb5a2cf8fe6cbfa8', place: 'feb0e8936def375353c4381a1b8eeb09cf7968a740e2c289bfb812c9daca18c2',
    undo: '7c630ede9b91662291a87f5c4ff0556d4d4cb55f6415fe0b1026bd55f33cd63f', loop_closed: '34fd8b2193a46a20add00efff7379c836b03795fb5bbd9e0531906e273852308',
    // D375 drop-in: batch 10's eight (E's table, exo_memory/handback/p-d375-batch10-E_2026-10-17.md:28-37)
    place_yearning: 'd2607f5facd0f209e916ac11e00e410cff807edbe091cc8202ac39d02f5fba81', undo_yearning: '2de01fc22e712b09d17254afbfe09de2ac9a7b77afc4ce12c93a476df15a4bd7',
    place_shoegaze: '0e56d383420db70ea9781af5f21abc7729fb16585ad8ef6b2fb0f7ad36b069c7', undo_shoegaze: 'c9eaec216cbc4092ed3de2a47a1f5f5d4d63118d7bd053784590b4454cfc950c',
    place_occult: '3661d6f774d6cb34a38abc41dc6613d73b5d56d28b5b1ec5bcf39f89651ae4e6', undo_occult: '93f810f129174232d4d3c9c89ff185959ae51ef4618d850c22cd3f6ac416330c',
    place_afterglow: '79569a9369888d0484943049a951131afcf3d2d88ad7dc9606d61b6823a47be1', undo_afterglow: 'be672b7fad2fba009fd71986d14b868a234f50d00d38e4e98df786417b894d30' };
  // AMENDED (D375 drop-in): every WAV shipped in app/sounds, loaded or not, is checked, not only the loaded ones
  const shipped = fs.readdirSync(path.join(__dirname, '..', 'sounds')).filter((x) => x.endsWith('.wav')).map((x) => x.replace(/.wav$/, '')).sort();
  assert.deepEqual(shipped, Object.keys(SHA).sort(), 'every WAV in app/sounds has its hash here');
  for (const s of shipped) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'sounds', `${s}.wav`))).digest('hex'), SHA[s], `${s}.wav`);
  assert.deepEqual([...SAMPLES.slots], SLOTS);
  const e = createEngine(fakeCtx()), b = fakeBuffers(); delete b.undo_occult;
  assert.throws(() => e.useSamples(b), /undo_occult/, 'a set with one missing is refused, naming it');
  assert.throws(() => e.useSamples(null), /samples/);
});

// D375: each melody plays on its own place and undo slots (place_<name>, undo_<name>), so batch 10's instruments can drop in one melody at a time
test('row 8: an engine plays the melody it was given, place forward and undo back, on that melody\'s own slots, round the 64; an unknown melody is refused', () => {
  for (const k of MELODY_NAMES) {
    const ctx = fakeCtx(), e = createEngine(ctx, { melody: k }); e.useSamples(fakeBuffers());
    assert.equal(e.melody, k);
    for (const i of [0, 17, 40, 63]) {
      const [b, chord, mel] = MELODIES[k].steps[i], want = [...chord, mel, b].map((m) => Math.pow(2, (m - 60) / 12)).sort();
      for (const soft of [false, true]) {
        const got = during(ctx, () => e.step(i, soft)).sources, rates = got.map((s) => s.rate).sort();
        assert.deepEqual(got.map((s) => s.slot), Array(6).fill(SAMPLES.file[`${soft ? 'undo' : 'place'}_${k}`]), `${k} step ${i}: its own ${soft ? 'undo' : 'place'} slot's file`);
        rates.forEach((r, n) => near(r, want[n], `${k} step ${i} ${soft ? 'undo' : 'place'} note ${n}`));
      }
      assert.deepEqual(during(ctx, () => e.step(i + 64, false)).sources.map((s) => s.rate), during(ctx, () => e.step(i, false)).sources.map((s) => s.rate), `${k}: step ${i + 64} is step ${i}`);
    }
  }
  assert.throws(() => createEngine(fakeCtx(), { melody: 'polka' }), /sound: no melody named polka/);
  assert.equal(createEngine(fakeCtx()).melody, MELODY_NAMES[0], 'given none, the first');
});

test('row 9: every melody\'s place and undo slot resolves to a file that is shipped, with its reference note and gain; the player fetches each file once', async () => {
  const shipped = new Set(fs.readdirSync(path.join(__dirname, '..', 'sounds')).filter((f) => f.endsWith('.wav')).map((f) => f.replace(/\.wav$/, '')));
  for (const k of MELODY_NAMES) for (const kind of ['place', 'undo']) {
    const slot = `${kind}_${k}`, file = SAMPLES.file[slot];
    assert.ok(SAMPLES.slots.includes(file), `${slot} -> ${file}, one of the files the player loads`);
    assert.ok(shipped.has(file), `${file}.wav is in app/sounds`);
    assert.equal(SAMPLES.ref[file], 60, `${slot}: its file rendered on MIDI 60`); assert.ok(SAMPLES.gain[file] > 0, `${slot}: its file has a gain`);
  }
  assert.deepEqual([...SAMPLES.slots].sort(), [...new Set(Object.values(SAMPLES.file))].sort(), 'the player loads exactly the files the slots name');
  assert.ok(SAMPLES.slots.every((f) => shipped.has(f)), 'every one is shipped');
  const P = player(); P.fire('pointerdown');
  assert.deepEqual(P.fetched, SAMPLES.slots.map((f) => `sounds/${f}.wav`), 'each file once');
});

// D375 drop-in: batch 10, each melody's own instrument (Yearning WurlyKeys, Shoegaze Pads Pluck, Light occult Vintage Bells, Afterglow D_Pluck)
test('row 10: each melody plays its own place and undo files, place_<name>.wav and undo_<name>.wav, at the place and undo gains', () => {
  for (const m of MEL) {
    assert.equal(SAMPLES.file[`place_${m}`], `place_${m}`, `${m}: its place file`); assert.equal(SAMPLES.file[`undo_${m}`], `undo_${m}`, `${m}: its undo file`);
    assert.equal(SAMPLES.gain[`place_${m}`], 0.645, `${m}: the place gain (E levelled the file to it)`); assert.equal(SAMPLES.gain[`undo_${m}`], 0.596, `${m}: the undo gain`);
    const ctx = fakeCtx(), e = createEngine(ctx, { melody: m }); e.useSamples(fakeBuffers());
    assert.deepEqual([...new Set(during(ctx, () => e.step(5, false)).sources.map((x) => x.slot))], [`place_${m}`]);
    assert.deepEqual([...new Set(during(ctx, () => e.step(5, true)).sources.map((x) => x.slot))], [`undo_${m}`]);
  }
  assert.ok(!SAMPLES.slots.includes('place') && !SAMPLES.slots.includes('undo'), 'the batch 8 place and undo files are no longer loaded');
});
