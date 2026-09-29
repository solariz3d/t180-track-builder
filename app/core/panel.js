// panel.js: the EQUATION CORE's controls (D186, pane C), in the left column where the piece builder's palette is. DOM only; every
// action is the core shell's (app/core/coreshell.js), every number it shows is the shell's state.
//
//   EXTEND at the build head: keep going (no handle), or turn / climb / bank / width targets over a length. Hovering the button
//          shows the ghost (the preview's 't180-ghost' candidate), so what a click adds is seen before it is added.
//   BRUSH on the preview: arm it, then drag on the track. The pick is the preview's ('t180-pick'); the drag's vertical distance is
//          the change at the brush's centre; one drag is one undo step. The local height/lateral brush (E) is the default when
//          it is in the build; the rate brush (one channel) is the explicit second mode.
//   CLOSE as one click. WATER, drawn LIVE: while it is on, every change to the track pours again (the preview's 't180:track'
//          event), and the streams and reds are drawn over the track ('t180:overlay'). Every red is listed in plain words.
//   THE READOUT (L130): beside Extend's fields, the piece they describe, BEFORE it is placed: its length and the change it makes
//          in turn, climb and bank (A's src/core/readout.js, candidateReadout), redrawn inside every field's input handler; and on
//          the track, a label at every placed piece with the same numbers (app/core/labels.js). The strings are the same function's
//          (labels.js formatReadout), so what the ghost promised is what the placed piece's label says.
//   OPEN A LOCAL EXAMPLE: a real track's D184 fit and its read, picked from the user's own reads/ folder (never in the program).
'use strict';

const LB = require('./labels.js');

// the change per pixel of vertical drag, in each brush channel's unit (up = more)
const PER_PX = Object.freeze({ kh: 2e-5, kv: 2e-5, phi: 0.002, w: 0.05, r: 0.02, height: 0.03, lateral: 0.03 });
const CHANNEL_NAMES = Object.freeze({ kh: 'turn rate', kv: 'climb rate', phi: 'bank', w: 'width', r: 'wall rise', height: 'height', lateral: 'sideways' });
const COLOURS = Object.freeze({ water: [0.35, 0.72, 1.0], red: [1.0, 0.25, 0.25] });
const DEG = Math.PI / 180;

/** The overlay for a pour: each stream as line pairs, and each red as a 6 m cross (pure: tested headless). */
function overlayOf(water) {
  if (!water) return null;
  const blue = [], red = [];
  for (const pts of water.streams) for (let i = 1; i < pts.length; i++) blue.push(...pts[i - 1], ...pts[i]);
  for (const x of water.reds) { const [a, b, c] = x.pos, k = 3; red.push(a - k, b, c, a + k, b, c, a, b - k, c, a, b + k, c, a, b, c - k, a, b, c + k); }
  const out = [];
  if (blue.length) out.push({ positions: new Float32Array(blue), colour: COLOURS.water, alpha: 0.9 });
  if (red.length) out.push({ positions: new Float32Array(red), colour: COLOURS.red, alpha: 1 });
  return out;
}

/** The extend options the controls describe (pure: tested headless). Empty fields continue the channel. */
function extendOptions({ length, turn, climb, bank, width }) {
  const targets = {}, num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const t = num(turn), c = num(climb), b = num(bank), w = num(width);
  if (t !== null) targets.kh = t * DEG / 100;          // degrees of heading per 100 m
  if (c !== null) targets.kv = c * DEG / 100;          // degrees of pitch per 100 m
  if (b !== null) targets.phi = b * DEG;                // degrees of bank, + = left side up
  if (w !== null) targets.w = w;                        // m
  return { length: Number(length), targets };
}

function mount(root, shell) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const el = (tag, attrs = {}, ...kids) => { const e = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); } e.append(...kids); return e; };
  const field = (label, input) => el('label', { class: 'picker' }, el('span', { text: label }), input);
  const num = (value, step, title) => el('input', { type: 'number', value: String(value), step: String(step), title: title || '' });
  const send = (name, detail) => doc.dispatchEvent(new win.CustomEvent(name, { detail }));

  // EXTEND
  const len = num(100, 10, 'metres added'), turn = num('', 1, 'degrees of heading per 100 m, + = left; empty keeps turning as now'),
    climb = num('', 1, 'degrees of pitch per 100 m, + = up; empty keeps climbing as now'), bank = num('', 1, 'degrees of bank, + = left side up; empty keeps it'),
    width = num('', 1, 'road width in m; empty keeps it');
  const opts = () => extendOptions({ length: len.value, turn: turn.value, climb: climb.value, bank: bank.value, width: width.value });
  // the ghost: a candidate the shell cannot build, or the preview cannot draw, says why (it used to vanish without a word)
  // THE READOUT of the piece the fields describe: 16 px bold rows, so its ink is at least 11 device px tall (E's M5 (d))
  const RO = ['length', 'turn', 'climb', 'bank'], roCells = Object.fromEntries(RO.map((k) => [k, el('span', { 'data-readout': k })]));
  const roBox = el('div', { class: 'readout', 'aria-label': 'the piece Extend would add', style: 'display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:8px 0;font:bold 16px/1.3 system-ui,"Segoe UI",sans-serif;color:#eef1f6' },
    ...RO.flatMap((k) => [el('span', { text: k === 'length' ? 'length' : `${k} change`, style: 'color:#aab2c0;font-weight:600' }), roCells[k]]));
  const readout = () => {
    let f = null, why = '';
    try { if (shell.getState().history.present.closed) why = 'the loop is closed'; else f = LB.formatReadout(shell.candidateReadout(opts())); } catch (e) { why = e.message; }
    for (const k of RO) roCells[k].textContent = f ? f[k] : '—';
    roBox.title = why;
  };
  const ghost = () => {
    readout();   // first, and synchronously: the numbers follow the fields with no timer and no frame wait
    let why = null;
    try { send('t180-ghost', { candidate: shell.candidate(opts()), reply: (r) => { if (r && r.error) why = r.error; } }); } catch (e) { why = e.message; }
    if (why) { send('t180-ghost-clear'); msg.textContent = `no preview of this piece: ${why}`; msg.className = 'message'; }
  };
  // the ghost follows the fields as they change, not only a fresh hover (a pointer resting on the button fires no new mouseenter,
  // so the ghost showed the piece before the last edit, or none: found in the window proof, D186)
  for (const f of [len, turn, climb, bank, width]) f.oninput = f.onchange = ghost;
  const extendBtn = el('button', { text: 'Extend', title: 'add a piece at the open end; empty fields keep going the way the track goes',
    onclick: () => { send('t180-ghost-clear'); shell.extend(opts()); }, onmouseenter: ghost, onmouseleave: () => send('t180-ghost-clear') });

  // BRUSH
  const mode = el('select', { 'aria-label': 'brush mode' }), channel = el('select', { 'aria-label': 'brush channel' }), radius = num(60, 10, 'brush radius, m');
  const armed = el('input', { type: 'checkbox', 'aria-label': 'brush on' });
  // SHARP (E's opt-in, the chair's ruling 2): its spill is declared right here, in the words of E's own SHARP_NOTE
  const sharp = el('input', { type: 'checkbox', 'aria-label': 'sharp brush', title: 'Sharp brush: acts at exactly the size you set by adding finer control points first. It can nudge the track just outside the brush by up to 0.1 mm. Leave it off for an exactly local edit.' });
  const channelsFor = (m) => (m === 'local' ? ['height', 'lateral'] : ['kv', 'kh', 'phi', 'w', 'r']);
  const fillChannels = () => { channel.replaceChildren(...channelsFor(mode.value).map((c) => new win.Option(CHANNEL_NAMES[c], c))); };
  mode.replaceChildren(...shell.brushModes().map((m) => new win.Option(m === 'local' ? 'height / sideways (local)' : 'rate (one channel)', m)));
  mode.onchange = fillChannels; fillChannels();
  const stage = doc.getElementById('preview');
  let drag = null;
  const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e) => {
    if (!armed.checked || e.button !== 0) return;
    const [x, y] = rel(e); let hit = null; send('t180-pick', { x, y, reply: (h) => { hit = h; } });
    if (!hit) return;
    shell.beginBrush({ mode: mode.value, channel: channel.value, s0: hit.s, r: Number(radius.value), sharp: sharp.checked });
    if (!shell.getState().brush) return;
    drag = { y, per: PER_PX[channel.value] }; e.preventDefault();
    if (stage.setPointerCapture && e.pointerId !== undefined) stage.setPointerCapture(e.pointerId);
  };
  const move = (e) => { if (!drag) return; const [, y] = rel(e); shell.brushTo((drag.y - y) * drag.per); };
  const up = () => { if (!drag) return; drag = null; shell.endBrush(); };
  if (stage) { stage.addEventListener('pointerdown', down); stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); }

  // CLOSE, WATER, EXAMPLE
  const closeBtn = el('button', { text: 'Close the loop', title: 'one click: the track closes exactly, the fix spread over what you did not just touch', onclick: () => shell.close() });
  const speed = num(250, 10, 'design speed, km/h'), streams = num(7, 1, 'streams across the width'), waterOn = el('input', { type: 'checkbox', 'aria-label': 'water on' });
  let latest = null, pending = 0;
  const pour = () => { if (!latest) { send('t180:track-request', { reply: (t) => { latest = t; } }); } if (latest) shell.pour(latest, { speedKmh: Number(speed.value), count: Number(streams.value) }); };
  const onTrack = (e) => { latest = e.detail; if (waterOn.checked) { win.clearTimeout(pending); pending = win.setTimeout(pour, 120); } };
  doc.addEventListener('t180:track', onTrack);
  waterOn.onchange = () => { if (waterOn.checked) pour(); else shell.clearWater(); };
  speed.onchange = streams.onchange = () => { if (waterOn.checked) pour(); };
  // held to the column's width (a file input is wider than the 280 px column by default, and the column scrolled sideways)
  const fitIn = el('input', { type: 'file', accept: '.json', 'aria-label': 'the fit, *.pieces.json', style: 'max-width: 100%; min-width: 0' }), readIn = el('input', { type: 'file', accept: '.json', 'aria-label': 'the read, *.read.json', style: 'max-width: 100%; min-width: 0' });
  const readText = (inp) => (inp.files && inp.files[0] ? inp.files[0].text() : Promise.reject(new Error('pick both files')));
  const openEx = el('button', { text: 'Open example', onclick: async () => {
    try { const [f, r] = await Promise.all([readText(fitIn), readText(readIn)]); shell.openExample(f, r, fitIn.files[0].name.replace(/\.pieces\.json$/i, '') + ' (local)'); } catch (e) { msg.textContent = e.message; msg.className = 'message'; }
  } });

  const msg = el('p', { class: 'message', role: 'status' }), reds = el('ul', { class: 'reds' }), info = el('p', { class: 'head' });
  root.replaceChildren(
    el('h3', { text: 'Equation track' }), info,
    el('div', { class: 'actions' }, el('button', { text: 'Undo', onclick: () => shell.undo() }), el('button', { text: 'Redo', onclick: () => shell.redo() })),
    el('h3', { text: 'Extend at the head' }), el('div', { class: 'pickers' }, field('length m', len), field('turn °/100m', turn), field('climb °/100m', climb), field('bank °', bank), field('width m', width)),
    roBox,
    el('div', { class: 'actions' }, extendBtn),
    el('h3', { text: 'Brush (drag on the track)' }), el('div', { class: 'pickers' }, field('on', armed), field('mode', mode), field('what', channel), field('radius m', radius), field('sharp (may nudge ≤ 0.1 mm outside)', sharp)),
    el('h3', { text: 'Close' }), el('div', { class: 'actions' }, closeBtn),
    el('h3', { text: 'Water' }), el('div', { class: 'pickers' }, field('on', waterOn), field('km/h', speed), field('streams', streams)), reds,
    el('h3', { text: 'Local example' }), el('div', { class: 'pickers' }, field('fit', fitIn), field('read', readIn)), el('div', { class: 'actions' }, openEx),
    msg,
  );
  const draw = (st) => {
    const d = st.history.present, L = st.resolved.segments.reduce((a, g) => a + g.length, 0);
    info.textContent = `${d.pieces.length} piece${d.pieces.length === 1 ? '' : 's'} · ${Math.round(L).toLocaleString('en-US')} m · ${d.closed ? 'closed loop' : 'open'}${st.lastStep ? ` · last ${st.lastStep.op} ${st.lastStep.ms.toFixed(0)} ms` : ''}`;
    extendBtn.disabled = !!d.closed; closeBtn.disabled = !!d.closed || !d.pieces.length;
    msg.textContent = st.message || ''; msg.className = st.messageKind === 'ok' ? 'message ok' : 'message';
    const w = st.water;
    if (!w) reds.replaceChildren(); else if (!w.reds.length) reds.replaceChildren(el('li', { text: `The water rides clean from ${Math.round(w.fromS)} to ${Math.round(w.toS)} m at ${w.speedKmh} km/h.` }));
    else reds.replaceChildren(...w.reds.map((x) => el('li', { text: x.text, style: 'color: var(--bad)' })));
    if (w && w.cutAt !== null) reds.append(el('li', { text: `The water stops at ${Math.round(w.cutAt)} m: a jump's flight is not modelled.`, class: 'src' }));
    send('t180:overlay', { lines: overlayOf(w) });
    readout();   // the track changed, so the piece the fields would add changed
  };
  // the labels on the track: a DOM layer over the preview (app/core/labels.js); none when there is no preview to lay them on
  const labels = stage ? LB.mount(stage, shell, win) : null;
  const unsub = shell.subscribe(draw); draw(shell.getState());
  return { labels, unmount() { unsub(); if (labels) labels.unmount(); doc.removeEventListener('t180:track', onTrack); if (stage) { stage.removeEventListener('pointerdown', down); stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); } root.replaceChildren(); } };
}

module.exports = { mount, overlayOf, extendOptions, PER_PX };
