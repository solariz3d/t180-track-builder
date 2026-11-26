// panel.js (L243, a first look; L250, finished): View ▸ Reference track…, a small panel over the preview that lists the tracks installed in
// Assetto Corsa (content/tracks, each layout) and shows the picked one's road under the user's, see-through, at true scale (src/reference/ribbon.js).
// The user's words, 2026-11-26: "it can be accessed through the other saved tracks that already exist in the assetto track folder, it doesnt create it
// through our system, just renders the total shape of the track to see within the preview"; and 04:49, "Yes finish the rest."
//
//   createReferencePanel({ doc, root, call, clock? }) -> { open(), close(), toggle(), isOpen(), list(), pick(track, layout), setMode(m), show(on),
//                                                          clear(), setNudge(n), state() }
//     call(cmd, args): the page's native call. list_reference_tracks -> [{ track, layout, hasAi, uiLength }]; read_reference_line { track, layout }
//     -> the AI line's bytes up to its grid; read_reference_road { track, layout } -> the road from its kn5 (src/reference/road.js decodeRoad).
//     Nothing is ever written: the panel only reads, and the preview only draws.
//   LINE OR ROAD (L250): "Line" draws the AI line's ribbon (the width the AI may use); "Road" draws the meshes the kn5 counts as valid track (the whole
//   paved area: pit lane, run-off and other layouts' roads too). Both are placed by the layout's AI line, so they lie on each other and share the nudge.
//   The road goes to the preview as 't180:reference' (app/preview/index.js); a layout with no AI line is listed, greyed, saying so.
//   PICK, SHOW OR HIDE, CLEAR: Show off takes the road off the screen and keeps the pick and the nudge; Clear drops both.
//   A LINE OR ROAD THAT DOES NOT READ is refused in words (ribbon.js refusalWords), its entry marked "(cannot be read)", and whatever was shown
//   before it is taken down: never drawn wrong, never drawn in part. A LAYOUT THAT CARRIES ANOTHER LAYOUT'S LINE (the same points as another layout of
//   the same track, read and compared when it is picked) or a line far off its stated length is said so (ribbon.js lineNotes).
//   The nudge moves it by hand: across (x), along (z), up, and turn (degrees about its start). No scale, on purpose.
//   READ ONLY: the panel is given no shell. Nothing of the reference enters the document, a save, an undo step or an export
//   (app/test/reference-panel.test.js proves each of the four through the real core shell and preview, for Line and for Road).
'use strict';

const { readAiShape, ribbonOf, refusalWords, sameLine, uiLengthM, lineNotes } = require('../../src/reference/ribbon.js');
const { decodeRoad, roadReference } = require('../../src/reference/road.js');

const NUDGES = [['dx', 'x', 'm', 5], ['dz', 'z', 'm', 5], ['dy', 'up', 'm', 1], ['yawDeg', 'turn', '°', 5]];
const ZERO = Object.freeze({ dx: 0, dz: 0, dy: 0, yawDeg: 0 });
const MODES = Object.freeze([['line', 'Line (its AI line)'], ['road', 'Road (its kn5)']]);
const NOTE = Object.freeze({
  line: 'Line: drawn from its AI line, the width the AI may use along the line it drives (a racing line, not the centre; no pit lane).',
  road: 'Road: drawn from its kn5, every surface the track counts as track: its pit lane, run-off and other layouts\' roads show too.',
  both: ' Its start sits on your start, at your start\'s height, placed by its AI line; your road is drawn over it. Read only: nothing is saved, undone or exported.',
});

// THE LOOK (L250 repair, pane E's read): one class, on the page's own pane tokens (index.html :root, each look's [data-theme] block): the ground is
// --panel, the words --text and --dim (the pair every look checks for 4.5:1 on its own panel), the edge --line, the corner the radius scale's r3 (a
// popover's, as the guide card's; 4 px, SIGIL's r3, until that scale is on the page). Nothing is inline, so a look's own rule reaches every part of it
// ([data-theme="<look>"] .reference-panel …). Its fallbacks are SIGIL's own values.
const CSS = `
.reference-panel { position: absolute; top: 44px; right: 10px; z-index: 6; width: 300px; padding: 8px 10px; font: 12px/1.4 var(--body, system-ui);
  background: var(--panel, #0b0b0a); color: var(--text, #ebe6dc); border: 1px solid var(--line, #24221f); border-radius: var(--r3, 4px); }
.reference-panel .rp-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-weight: 600; }
.reference-panel .rp-shut { background: none; border: 0; color: inherit; cursor: pointer; font: inherit; }
.reference-panel .rp-pick { width: 100%; margin-bottom: 6px; }
.reference-panel .rp-ctl { display: flex; gap: 12px; align-items: center; margin-bottom: 6px; }
.reference-panel .rp-show { display: flex; gap: 4px; align-items: center; cursor: pointer; }
.reference-panel .rp-nudge { display: grid; grid-template-columns: auto 1fr; gap: 3px 8px; align-items: center; margin-bottom: 6px; }
.reference-panel .rp-nudge input { width: 90px; }
.reference-panel .rp-readout { color: var(--dim, #8a847a); min-height: 2.8em; }
.reference-panel .rp-notes { font-size: 11px; margin-top: 4px; }
.reference-panel .rp-note { color: var(--dim, #8a847a); font-size: 11px; margin-top: 4px; }`;

/** A nudge value: a finite number, or a string that is one (a number box's value); anything else is NaN, and the nudge keeps the value it had. */
const numberOf = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN);

function createReferencePanel({ doc, root, call, clock = () => (doc.defaultView && doc.defaultView.performance ? doc.defaultView.performance.now() : Date.now()) }) {
  const win = doc.defaultView, el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const box = el('div', 'reference-panel'); box.style.display = 'none';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'reference track');
  const head = el('div', 'rp-head'), title = el('span', '', 'Reference track');
  const shut = el('button', 'rp-shut', '✕'); shut.title = 'close the panel (the reference stays as it is: Show hides it, Clear takes it away)';
  head.append(title, shut);
  const pickEl = el('select', 'rp-pick'); pickEl.setAttribute('aria-label', 'the installed track to show');
  const ctl = el('div', 'rp-ctl');
  const modeEl = el('select', ''); modeEl.setAttribute('aria-label', 'draw it from its AI line or its kn5');
  for (const [v, t] of MODES) { const o = el('option', '', t); o.value = v; modeEl.append(o); }
  modeEl.value = 'line';
  const showBox = el('input'); showBox.type = 'checkbox'; showBox.checked = true; showBox.setAttribute('aria-label', 'show the reference');
  const showLabel = el('label', 'rp-show'); showLabel.append(showBox, 'Show');
  const clearBtn = el('button', '', 'Clear'); clearBtn.title = 'take the reference away: the pick and the nudge';
  ctl.append(modeEl, showLabel, clearBtn);
  const rows = el('div', 'rp-nudge'), inputs = {};
  for (const [k, label, unit, step] of NUDGES) {
    const i = el('input'); i.type = 'number'; i.step = String(step); i.value = '0'; i.setAttribute('aria-label', `move the reference: ${label} (${unit})`);
    // a value the box cannot hold (a browser gives '' for "1e400" or "abc", and for a box emptied) keeps the nudge it had, and the box shows it again
    i.onchange = () => { const v = numberOf(i.value); if (!Number.isFinite(v)) { i.value = String(nudge[k]); return; } nudge[k] = v; send(); };
    inputs[k] = i; rows.append(el('span', '', `${label} (${unit})`), i);
  }
  const readout = el('div', 'rp-readout'), notesEl = el('div', 'rp-notes');
  notesEl.setAttribute('role', 'status');
  const note = el('div', 'rp-note', NOTE.line + NOTE.both);
  box.append(head, pickEl, ctl, rows, readout, notesEl, note);
  root.append(box, el('style', '', CSS));   // the box first: it is the root's first child, as it was

  // reading: the layout his newest pick is still reading (null once it lands, is refused or is cleared). A mode change re-reads THAT one, so a pick
  // made while another was out is never dropped, nor drawn in the mode he left (pane E's V3e and V3f)
  let layouts = null, ref = null, nudge = { ...ZERO }, shownKey = null, timing = null, error = null, notes = [], shown = true, seq = 0, mode = 'line', reading = null;
  // refusals are kept per mode (a road that does not read leaves its line drawable); a line that does not read is refused in both, since the line places the road
  const refused = new Map(), borrowed = new Set();   // `${mode}\0${key}` -> the words it was refused with; keys of layouts found carrying another layout's line
  const keyOf = (l) => `${l.track}\u0000${l.layout}`, rk = (k, m = mode) => `${m}\u0000${k}`;
  const isRefused = (k, m = mode) => refused.has(rk(k, m)) || refused.has(rk(k, 'line'));
  const nameOf = (l) => `${l.track}${l.layout ? ` · ${l.layout}` : ''}`;
  const layoutName = (l) => (l.layout ? `“${l.layout}”` : 'the main layout');
  const f = (x) => x.toLocaleString('en-US', { maximumFractionDigits: 1 });
  const say = () => {
    notesEl.textContent = notes.join(' '); note.textContent = NOTE[mode] + NOTE.both;
    if (error) { readout.textContent = error; return; }
    if (!ref) {
      if (!layouts) { readout.textContent = 'Reading the tracks…'; return; }
      const bad = layouts.filter((l) => l.hasAi && isRefused(keyOf(l))).length, can = layouts.filter((l) => l.hasAi).length - bad;
      readout.textContent = `${can} of ${layouts.length} layouts have an AI line to show${bad ? ` (${bad} cannot be read)` : ''}.`; return;
    }
    const hidden = shown ? '' : 'Hidden (Show draws it again) · ', times = `read ${timing.readMs.toFixed(0)} ms, built ${timing.buildMs.toFixed(0)} ms`;
    if (ref.kind === 'road') { readout.textContent = `${hidden}${f(ref.triangles)} triangles of road from its kn5, placed by its ${f(Math.round(ref.lengthM))} m AI line · ${times}`; return; }
    const w = ref.width;
    readout.textContent = `${hidden}${f(Math.round(ref.lengthM))} m along its line${ref.closed ? '' : ' (open: point to point)'} · ${f(w.median)} m wide (${f(w.min)} to ${f(w.max)}) · ${times}`;
  };
  const relabel = () => {
    pickEl.replaceChildren(el('option', '', 'None'));
    pickEl.firstChild.value = '';
    for (const l of layouts || []) {
      const k = keyOf(l), bad = l.hasAi && isRefused(k);
      const o = el('option', '', `${nameOf(l)}${!l.hasAi ? ' (no AI line)' : bad ? ' (cannot be read)' : borrowed.has(k) ? ' (another layout\'s line)' : ''}`);
      o.value = k; o.disabled = !l.hasAi || bad; if (bad) o.title = refused.get(rk(k)) || refused.get(rk(k, 'line')); pickEl.append(o);
    }
    pickEl.value = shownKey || '';
  };
  const send = () => new Promise((resolve) => { doc.dispatchEvent(new win.CustomEvent('t180:reference', { detail: { ribbon: shown ? ref : null, nudge: { ...nudge }, reply: resolve } })); });

  // the other layouts of the same track whose line drives the same points as this one's (read and compared now; a sibling that does not read is marked so)
  async function notesFor(l, shape, line, my) {
    const same = [], samePath = [];
    for (const s of (layouts || []).filter((x) => x.track === l.track && x.layout !== l.layout && x.hasAi && !refused.has(rk(keyOf(x), 'line')))) {
      let other;
      try { other = readAiShape(await call('read_reference_line', { track: s.track, layout: s.layout })); } catch (e) { refused.set(rk(keyOf(s), 'line'), refusalWords(e)); continue; }
      if (my !== seq) return null;
      const m = sameLine(shape, other);
      if (m.sameSides) same.push(layoutName(s)); else if (m.samePoints) samePath.push(layoutName(s));
    }
    if (same.length || samePath.length) borrowed.add(keyOf(l));
    return lineNotes({ lengthM: line.lengthM, uiM: uiLengthM(l.uiLength), same, samePath });
  }

  async function list() {
    error = null;
    try { layouts = await call('list_reference_tracks'); } catch (e) { layouts = []; error = `The installed tracks could not be listed: ${(e && e.message) || e}`; }
    relabel(); say(); return layouts;
  }
  async function clear() {
    seq++; reading = null;   // a pick still reading is dropped when it lands
    ref = null; shownKey = null; timing = null; error = null; notes = []; nudge = { ...ZERO };
    for (const [k] of NUDGES) inputs[k].value = '0';
    pickEl.value = ''; await send(); say(); return null;
  }
  async function pick(track, layout) {
    if (track === null || track === undefined) return clear();
    const my = ++seq, m = mode, l = (layouts || []).find((x) => x.track === track && x.layout === (layout || '')) || { track, layout: layout || '', hasAi: true, uiLength: null };
    const key = keyOf(l), args = { track, layout: l.layout };
    error = null; notes = []; reading = l;
    let shape, line, next, t0, t1, t2, lineOk = false;
    try {
      t0 = clock();
      const lineBytes = await call('read_reference_line', args);
      shape = readAiShape(lineBytes); line = ribbonOf(shape); lineOk = true;   // the line places the road too
      const roadBytes = m === 'road' ? await call('read_reference_road', args) : null;
      t1 = clock();
      next = m === 'road' ? roadReference(decodeRoad(roadBytes), line) : line; t2 = clock();
    } catch (e) {
      if (my !== seq) return null;   // a later pick (or Clear) won: this one says nothing
      reading = null;
      const words = refusalWords(e);
      refused.set(rk(key, lineOk ? m : 'line'), words);
      ref = null; shownKey = null; timing = null; error = `${nameOf(l)}: ${words}`;
      relabel(); await send(); say(); return null;   // what was shown before is taken down: the select no longer names it
    }
    if (my !== seq) return null;
    reading = null; ref = next; shownKey = key; timing = { readMs: t1 - t0, buildMs: t2 - t1 };
    pickEl.value = key;
    const info = await send(); say();
    const n = await notesFor(l, shape, line, my);
    if (my !== seq || n === null) return info;
    notes = n; relabel(); say();
    return info;
  }
  /** Line (the AI line's ribbon) or Road (the kn5's valid-track meshes); the layout his newest pick is still reading, else the one shown, is read again
   *  in the new mode, with the same nudge (a re-pick: the read still out is dropped when it lands). */
  async function setMode(m) {
    if (!MODES.some(([v]) => v === m)) throw new Error(`reference panel: the mode is line or road, got ${JSON.stringify(m)}`);
    mode = m; modeEl.value = m;
    const l = reading || (shownKey && layouts && layouts.find((x) => keyOf(x) === shownKey));
    if (l) return pick(l.track, l.layout);
    relabel(); say(); return null;
  }
  pickEl.onchange = () => { const l = layouts && layouts.find((x) => keyOf(x) === pickEl.value); pick(l ? l.track : null, l ? l.layout : ''); };
  modeEl.onchange = () => { setMode(modeEl.value); };
  showBox.onchange = () => { shown = !!showBox.checked; send(); say(); };
  clearBtn.onclick = () => { clear(); };
  shut.onclick = () => { box.style.display = 'none'; };

  return {
    open() { box.style.display = 'block'; if (!layouts) return list(); return Promise.resolve(layouts); },
    close() { box.style.display = 'none'; },
    toggle() { return box.style.display === 'none' ? this.open() : (this.close(), Promise.resolve(layouts)); },
    isOpen: () => box.style.display !== 'none',
    list, pick, clear, setMode,
    /** Show (true) or hide (false) the picked reference; the pick and the nudge stay. */
    show(on) { shown = !!on; showBox.checked = shown; const p = send(); say(); return p; },
    /** Move it by hand; a value that is not a finite number keeps the nudge it had, as the boxes do. */
    setNudge(n) { for (const [k] of NUDGES) if (n && n[k] !== undefined) { const v = numberOf(n[k]); if (Number.isFinite(v)) nudge[k] = v; inputs[k].value = String(nudge[k]); } return send(); },
    state: () => ({ open: box.style.display !== 'none', layouts: layouts ? layouts.length : null, mode, picked: shownKey, kind: ref ? ref.kind || 'line' : null,
      triangles: ref && ref.kind === 'road' ? ref.triangles : null, shown: shown && !!ref, showOn: shown, nudge: { ...nudge },
      timing: timing ? { ...timing } : null, error, notes: notes.slice(), refused: [...refused.keys()].filter((k) => k.startsWith(`${mode}\u0000`)).length, readout: readout.textContent }),
  };
}

module.exports = { createReferencePanel, NUDGES, MODES };
