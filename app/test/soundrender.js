// soundrender.js: renders the builder's real sound engine (app/sound.js createEngine) in HEADLESS Chrome (never a window) and measures what comes out.
// Used by app/test/sound-bands.test.js and by hand: node app/test/soundrender.js OUTDIR writes each clip as a 16-bit stereo 48 kHz WAV.
//
//   chromePath()                    the Chrome to use (CHROME_PATH, else the usual Windows place), or null when there is none
//   launchChrome(exe, args, prefix) -> { ch, dir, port, tgt }   (D400) headless Chrome on a free port, attached only if that port's browser is the one it started
//   connect(url, onEvent)           -> { ws, send }   (D400) a DevTools socket whose waiting sends are rejected when it closes, so a lost browser fails fast
//   renderClips(src, clips, o)     -> { name: { L, R, sampleRate } }    src = app/sound.js's text; clips = { name: [seconds, body] }; o.samples = a folder; o.seed (default SEED)
//                                   of the four slot WAVs (app/sounds): the engine is handed them (useSamples) before each clip, as the app does once they load;
//                                   o.melody (D375) = which of the engine's melodies place and undo play (the engine's first when none is given)
//   readWav(file)                   a 16-bit PCM WAV as { L, R, sampleRate } (mono is copied to both sides)
//   peakDb(clip)                    the sample peak in dBFS
//   lufs(clip)                      integrated loudness, ITU-R BS.1770-4 (K-weighting, 400 ms blocks with 75% overlap, gates at -70 LUFS and -10 LU)
//   CLIPS                           the nine sounds as one hears them: a single tick, a drag on each handle, a place, four places, four undos, the loop close
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os'), net = require('net');

const CLIPS = Object.freeze({
  tick_single: [1.0, 'at(0.05, () => E.tick({ midi: M.MEL128[0] }));'],
  ticks_length_drag: [2.0, 'let p = 10, mel = 0; for (let k = 0; k < 16; k++) at(0.05 + k * 0.09, () => { const pl = M.tickPlan("length", p, p + 1, mel); p += 1; if (pl) { mel = pl.melAt; E.tick(pl); } });'],
  ticks_climb_drag: [1.8, 'let p = -4; for (let k = 0; k < 12; k++) at(0.05 + k * 0.1, () => { const pl = M.tickPlan("climb", p, p + 1); p += 1; if (pl) E.tick(pl); });'],
  ticks_bank_drag: [1.8, 'let p = 0; for (let k = 0; k < 12; k++) at(0.05 + k * 0.1, () => { const pl = M.tickPlan("bank", p, p + 1); p += 1; if (pl) E.tick(pl); });'],
  ticks_width_drag: [2.4, 'let p = 2, mel = 0; for (let k = 0; k < 14; k++) at(0.05 + k * 0.12, () => { const pl = M.tickPlan("width", p, p + 3.5, mel); p += 3.5; if (pl) { mel = pl.melAt; E.tick(pl); } });'],
  place_step1: [6.0, 'at(0.05, () => E.step(0, false));'],
  place_steps_1to4: [12.0, 'for (let i = 0; i < 4; i++) at(0.05 + i * 1.8, () => E.step(i, false));'],
  undo_steps_4to1: [10.0, 'for (let i = 3; i >= 0; i--) at(0.05 + (3 - i) * 1.4, () => E.step(i, true));'],
  loop_closed: [16.0, 'at(0.05, () => E.loopClosed());'],
});

function chromePath() {
  const c = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].filter(Boolean);
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || null;
}
// the engine's noise (its reverbs, the crash) is drawn from a PRNG started at this seed for every clip, so a clip renders to the same samples every run: the bands
// (sound-bands.test.js) are measured on one fixed sound. Math.random, which the app uses, drew new reverb noise each render and moved a clip ~1 dB
const SEED = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// D400: THE CHROME A TEST TALKS TO IS THE ONE IT STARTED. A port drawn at random from 600 could be one another test's Chrome already held: the new Chrome
// could not bind it, the test drove the OTHER browser, and when that test closed its Chrome the socket went with it and a reply never came, so a row hung
// until a time limit cancelled it (sky-dither's 1-of-2 failure, reproduced with every port forced to one and the second copy 300 ms late: A's D398 review).
/** A port the OS says is free now (listen on 0, read it, close), as scripts/prove_render.js takes one. */
function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
/**
 * A socket to a DevTools target: send(method, params) -> the reply by id; any other message goes to onEvent. When the socket closes, every send still
 * waiting is rejected, and a later send is rejected at once, so a lost browser fails the row instead of hanging it.
 */
async function connect(url, onEvent = null) {
  const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('the DevTools socket failed')); });
  let id = 0, closed = false; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id).res(d); pend.delete(d.id); } else if (onEvent) onEvent(d); };
  ws.onclose = () => { closed = true; for (const [i, p] of pend) p.rej(new Error(`the DevTools socket closed with no reply to ${p.method} (#${i})`)); pend.clear(); };
  const send = (method, params = {}) => new Promise((res, rej) => {
    if (closed) { rej(new Error(`the DevTools socket is closed: ${method} not sent`)); return; }
    const i = ++id; pend.set(i, { res, rej, method }); ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ws, send };
}
/**
 * Start headless Chrome on a free port with its own profile folder, and attach only if that port's browser is this Chrome: the browser names its own pid
 * (SystemInfo.getProcessInfo, type "browser"), and it must be the pid spawned here, as prove_render.js's checkOwner refuses a port another process holds.
 * -> { ch, dir, port, tgt } (tgt = its first page target). On any failure this Chrome is killed and the error thrown.
 */
async function launchChrome(exe, args, prefix) {
  const port = await freePort(), dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  // --mute-audio (D410, the standing rule of 2026-10-19): a headless page test must never play the builder's sounds on the user's speakers; the clips
  // here render in an OfflineAudioContext, which muting does not touch
  const ch = spawn(exe, ['--headless=new', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', ...args, 'about:blank'], { stdio: 'ignore' });
  try {
    let ver; for (let i = 0; i < 100 && !ver; i++) { await sleep(200); try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch (e) { /* not up yet */ } }
    if (!ver) throw new Error(`headless Chrome did not answer on port ${port}`);
    const b = await connect(ver.webSocketDebuggerUrl);
    let owner; try { owner = ((await b.send('SystemInfo.getProcessInfo')).result.processInfo.find((p) => p.type === 'browser') || {}).id; } finally { b.ws.close(); }
    if (owner !== ch.pid) throw new Error(`the DevTools port ${port} answers for pid ${owner}, not the Chrome this test started (pid ${ch.pid}): refusing to attach`);
    let tgt; for (let i = 0; i < 50 && !tgt; i++) { try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not listed yet */ } if (!tgt) await sleep(200); }
    if (!tgt) throw new Error(`headless Chrome on port ${port} has no page target`);
    return { ch, dir, port, tgt };
  } catch (e) {
    ch.kill(); await sleep(300); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (x) { /* Chrome may still hold it */ }
    throw e;
  }
}

/** Render each clip in an OfflineAudioContext (48 kHz stereo) in headless Chrome; the engine runs at level 1, as the sketch page and render-builder.js ran it. */
async function renderClips(src, clips = CLIPS, { samples = null, seed = SEED, melody = null } = {}) {
  if (melody !== null && typeof melody !== 'string') throw new Error(`soundrender: a melody is one of the engine's MELODY_NAMES, got ${melody}`);
  if (!Number.isInteger(seed) || seed < 0) throw new Error(`soundrender: a seed is a whole number 0 or more, got ${seed}`);
  const exe = chromePath(); if (!exe) throw new Error('soundrender: no Chrome found (set CHROME_PATH)');
  let ch, dir, tgt; try { ({ ch, dir, tgt } = await launchChrome(exe, ['--autoplay-policy=no-user-gesture-required'], 't180snd-test-')); } catch (e) { throw new Error(`soundrender: ${e.message}`); }
  let ws;
  try {
    let send; try { ({ ws, send } = await connect(tgt.webSocketDebuggerUrl)); } catch (e) { throw new Error(`soundrender: ${e.message}`); }
    const ev = async (e) => { const d = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`soundrender: page error ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 400)}`); return d.result.result.value; };
    await ev(`window.__M = (() => { const module = { exports: {} }; ${src}\n; return module.exports; })(); window.__SAMP = null; true`);
    if (samples) {   // each slot's two channels go over in pieces, into one AudioBuffer per slot that every clip's context can play
      await ev('window.__SAMP = {}; true');
      for (const slot of await ev('window.__M.SAMPLES.slots.slice()')) {   // D375: the files the engine itself loads (its SAMPLES.slots)
        const w = readWav(path.join(samples, `${slot}.wav`)), CHN = 1 << 17;
        await ev(`window.__SAMP.${slot} = new AudioBuffer({ numberOfChannels: 2, length: ${w.L.length}, sampleRate: ${w.sampleRate} }); true`);
        for (const [c, x] of [[0, w.L], [1, w.R]]) for (let i = 0; i < x.length; i += CHN) {
          const b64 = Buffer.from(x.buffer, x.byteOffset + i * 4, Math.min(CHN, x.length - i) * 4).toString('base64');
          await ev(`(() => { const s = atob('${b64}'), u = new Uint8Array(s.length); for (let k = 0; k < s.length; k++) u[k] = s.charCodeAt(k); window.__SAMP.${slot}.copyToChannel(new Float32Array(u.buffer), ${c}, ${i}); return true; })()`);
        }
      }
    }
    const out = {};
    for (const [name, [secs, body]] of Object.entries(clips)) {
      // the render stays in the page and its samples come back in pieces: one message of a 16 s clip's two float channels (~8 MB of base64) never arrived
      const n = await ev(`(async () => {
        const SR = 48000, ctx = new OfflineAudioContext(2, Math.ceil(SR * ${secs}), SR), M = window.__M;
        let s = ${seed} >>> 0; const random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };   // mulberry32, fresh from the seed for every clip
        const E = M.createEngine(ctx, { random${melody ? `, melody: ${JSON.stringify(melody)}` : ''} }); E.setLevel(1); if (window.__SAMP) E.useSamples(window.__SAMP);
        const at = (t, fn) => { ctx.suspend(t).then(() => { fn(); ctx.resume(); }); };
        ${body}
        const buf = await ctx.startRendering(); window.__buf = [buf.getChannelData(0), buf.getChannelData(1)]; return buf.length;
      })()`);
      const CH = 1 << 17, part = async (c, i) => { const s = await ev(`(() => { const a = window.__buf[${c}].subarray(${i}, ${i + CH}), u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000)); return btoa(s); })()`); const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
      const chan = async (c) => { const x = new Float32Array(n); for (let i = 0; i < n; i += CH) x.set(await part(c, i), i); return x; };
      out[name] = { L: await chan(0), R: await chan(1), sampleRate: 48000 };
    }
    return out;
  } finally {
    try { ws && ws.close(); } catch (e) { /* closing */ }
    ch.kill();
    await sleep(300); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome may still hold it for a moment: the temp folder is left */ }
  }
}

/** A 16-bit PCM WAV file as { L, R, sampleRate }, its chunks walked (so a LIST or fact chunk before the data is skipped); anything else is refused. */
function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`readWav: ${file} is not a WAV`);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) { const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4); if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }; else if (id === 'data') data = b.subarray(o + 8, o + 8 + n); o += 8 + n + (n & 1); }
  if (!fmt || !data || fmt.tag !== 1 || fmt.bits !== 16 || (fmt.ch !== 1 && fmt.ch !== 2)) throw new Error(`readWav: ${file} is not 16-bit PCM mono or stereo (${JSON.stringify(fmt)})`);
  const n = Math.floor(data.length / (2 * fmt.ch)), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768; R[i] = fmt.ch === 2 ? data.readInt16LE(i * 4 + 2) / 32768 : L[i]; }
  return { L, R, sampleRate: fmt.sr };
}

const peakDb =({ L, R }) => { let p = 0; for (let i = 0; i < L.length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); return 20 * Math.log10(p || 1e-12); };

/** BS.1770-4 K-weighting at 48 kHz (the standard's own coefficients): a high shelf, then a high-pass. */
function kWeight(x) {
  const run = (y, b0, b1, b2, a1, a2) => { const o = new Float64Array(y.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < y.length; i++) { const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; o[i] = v; } return o; };
  const s = run(x, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585);
  return run(s, 1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621);
}
function lufs({ L, R, sampleRate }) {
  if (sampleRate !== 48000) throw new Error(`lufs: the K-weighting here is for 48 kHz, got ${sampleRate}`);
  const l = kWeight(L), r = kWeight(R), n = Math.floor(0.4 * sampleRate), hop = Math.floor(0.1 * sampleRate), blocks = [];
  for (let s = 0; s + n <= l.length; s += hop) { let z = 0; for (let i = s; i < s + n; i++) z += l[i] * l[i] + r[i] * r[i]; blocks.push(z / n); }
  const L_ = (z) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => z > 0 && L_(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = L_(abs.reduce((a, b) => a + b, 0) / abs.length) - 10, kept = abs.filter((z) => L_(z) > rel);
  return L_(kept.reduce((a, b) => a + b, 0) / kept.length);
}

function wav({ L, R, sampleRate }) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  const q = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  for (let i = 0; i < n; i++) { b.writeInt16LE(q(L[i]), 44 + i * 4); b.writeInt16LE(q(R[i]), 46 + i * 4); }
  return b;
}

module.exports = { CLIPS, SEED, chromePath, freePort, connect, launchChrome, renderClips, readWav, peakDb, lufs, kWeight, wav };

if (require.main === module) {
  const out = process.argv[2]; if (!out) { console.error('usage: node app/test/soundrender.js OUTDIR [--synth]'); process.exit(1); }
  (async () => {
    fs.mkdirSync(out, { recursive: true });
    const synth = process.argv[3] === '--synth';   // the synth voices (what plays until the samples are in); without it, the samples as shipped
    const clips = await renderClips(fs.readFileSync(path.join(__dirname, '..', 'sound.js'), 'utf8'), CLIPS, { samples: synth ? null : path.join(__dirname, '..', 'sounds') });
    for (const [name, c] of Object.entries(clips)) { fs.writeFileSync(path.join(out, `${name}.wav`), wav(c)); console.log(`${name}.wav  peak ${peakDb(c).toFixed(1)} dBFS  ${lufs(c).toFixed(1)} LUFS`); }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
