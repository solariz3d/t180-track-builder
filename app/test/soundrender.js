// soundrender.js: renders the builder's real sound engine (app/sound.js createEngine) in HEADLESS Chrome (never a window) and measures what comes out.
// Used by app/test/sound-bands.test.js and by hand: node app/test/soundrender.js OUTDIR writes each clip as a 16-bit stereo 48 kHz WAV.
//
//   chromePath()                    the Chrome to use (CHROME_PATH, else the usual Windows place), or null when there is none
//   renderClips(src, clips, o)     -> { name: { L, R, sampleRate } }    src = app/sound.js's text; clips = { name: [seconds, body] }; o.samples = a folder
//                                   of the four slot WAVs (app/sounds): the engine is handed them (useSamples) before each clip, as the app does once they load
//   readWav(file)                   a 16-bit PCM WAV as { L, R, sampleRate } (mono is copied to both sides)
//   peakDb(clip)                    the sample peak in dBFS
//   lufs(clip)                      integrated loudness, ITU-R BS.1770-4 (K-weighting, 400 ms blocks with 75% overlap, gates at -70 LUFS and -10 LU)
//   CLIPS                           the nine sounds as one hears them: a single tick, a drag on each handle, a place, four places, four undos, the loop close
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Render each clip in an OfflineAudioContext (48 kHz stereo) in headless Chrome; the engine runs at level 1, as the sketch page and render-builder.js ran it. */
async function renderClips(src, clips = CLIPS, { port = 9300 + Math.floor(Math.random() * 600), samples = null } = {}) {
  const exe = chromePath(); if (!exe) throw new Error('soundrender: no Chrome found (set CHROME_PATH)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180snd-test-'));
  const ch = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let tgt; for (let i = 0; i < 100 && !tgt; i++) { await sleep(200); try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not up yet */ } }
    if (!tgt) throw new Error(`soundrender: headless Chrome did not answer on port ${port}`);
    ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('soundrender: the DevTools socket failed')); });
    let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => { const d = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (!d.result || d.result.exceptionDetails) throw new Error(`soundrender: page error ${JSON.stringify(d.result ? d.result.exceptionDetails : d).slice(0, 400)}`); return d.result.result.value; };
    await ev(`window.__M = (() => { const module = { exports: {} }; ${src}\n; return module.exports; })(); window.__SAMP = null; true`);
    if (samples) {   // each slot's two channels go over in pieces, into one AudioBuffer per slot that every clip's context can play
      await ev('window.__SAMP = {}; true');
      for (const slot of ['drag_tick', 'place', 'undo', 'loop_closed']) {
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
        const SR = 48000, ctx = new OfflineAudioContext(2, Math.ceil(SR * ${secs}), SR), M = window.__M, E = M.createEngine(ctx); E.setLevel(1); if (window.__SAMP) E.useSamples(window.__SAMP);
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

module.exports = { CLIPS, chromePath, renderClips, readWav, peakDb, lufs, kWeight, wav };

if (require.main === module) {
  const out = process.argv[2]; if (!out) { console.error('usage: node app/test/soundrender.js OUTDIR [--synth]'); process.exit(1); }
  (async () => {
    fs.mkdirSync(out, { recursive: true });
    const synth = process.argv[3] === '--synth';   // the synth voices (what plays until the samples are in); without it, the samples as shipped
    const clips = await renderClips(fs.readFileSync(path.join(__dirname, '..', 'sound.js'), 'utf8'), CLIPS, { samples: synth ? null : path.join(__dirname, '..', 'sounds') });
    for (const [name, c] of Object.entries(clips)) { fs.writeFileSync(path.join(out, `${name}.wav`), wav(c)); console.log(`${name}.wav  peak ${peakDb(c).toFixed(1)} dBFS  ${lufs(c).toFixed(1)} LUFS`); }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
