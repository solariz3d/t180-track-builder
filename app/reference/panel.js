// panel.js (L243, a first look; L250, finished): View ▸ Reference track…, a small panel over the preview that lists the tracks installed in
// Assetto Corsa (content/tracks, each layout) and shows the picked one's road under the user's, see-through, at true scale (src/reference/ribbon.js).
// The user's words, 2026-11-26: "it can be accessed through the other saved tracks that already exist in the assetto track folder, it doesnt create it
// through our system, just renders the total shape of the track to see within the preview"; and 04:49, "Yes finish the rest."
//
//   createReferencePanel({ doc, root, call, clock? }) -> { open(), close(), toggle(), isOpen(), list(), pick(track, layout), show(on), clear(),
//                                                          setNudge(n), state() }
//     call(cmd, args): the page's native call. list_reference_tracks -> [{ track, layout, hasAi, uiLength }]; read_reference_line { track, layout }
//     -> the AI line's bytes up to its grid (an ArrayBuffer). Nothing is ever written: the panel only reads, and the preview only draws.
//   The road goes to the preview as 't180:reference' (app/preview/index.js); a layout with no AI line is listed, greyed, saying so.
//   PICK, SHOW OR HIDE, CLEAR: Show off takes the road off the screen and keeps the pick and the nudge; Clear drops both.
//   A LINE THAT DOES NOT READ is refused in words (ribbon.js refusalWords), its entry marked "(cannot be read)", and whatever was shown before it is
//   taken down: never drawn wrong, never drawn in part. A LAYOUT THAT CARRIES ANOTHER LAYOUT'S LINE (the same points as another layout of the same
//   track, read and compared when it is picked) or a line far off its stated length is said so (ribbon.js lineNotes).
//   The nudge moves it by hand: across (x), along (z), up, and turn (degrees about its start). No scale, on purpose.
//   READ ONLY: the panel is given no shell. Nothing of the reference enters the document, a save, an undo step or an export
//   (app/test/reference-panel.test.js proves each of the four through the real core shell and preview).
'use strict';

const { readAiShape, ribbonOf, refusalWords, sameLine, uiLengthM, lineNotes } = require('../../src/reference/ribbon.js');

const NUDGES = [['dx', 'x', 'm', 5], ['dz', 'z', 'm', 5], ['dy', 'up', 'm', 1], ['yawDeg', 'turn', '°', 5]];
const ZERO = Object.freeze({ dx: 0, dz: 0, dy: 0, yawDeg: 0 });

function createReferencePanel({ doc, root, call, clock = () => (doc.defaultView && doc.defaultView.performance ? doc.defaultView.performance.now() : Date.now()) }) {
  const win = doc.defaultView, el = (tag, css, text) => { const e = doc.createElement(tag); if (css) e.style.cssText = css; if (text !== undefined) e.textContent = text; return e; };
  const box = el('div', 'position:absolute;top:44px;right:10px;z-index:6;width:300px;display:none;padding:8px 10px;border-radius:6px;font:12px/1.4 var(--body, system-ui);color:var(--on-ink, #eef1f6);background:color-mix(in srgb, var(--veil, #0b0d11) 88%, transparent);border:1px solid var(--veil-rule, rgba(255, 255, 255, .14))');
  box.className = 'reference-panel'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'reference track');
  const head = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-weight:600'), title = el('span', '', 'Reference track');
  const shut = el('button', 'background:none;border:0;color:inherit;cursor:pointer;font:inherit', '✕'); shut.title = 'close the panel (the reference stays as it is: Show hides it, Clear takes it away)';
  head.append(title, shut);
  const pickEl = el('select', 'width:100%;margin-bottom:6px'); pickEl.setAttribute('aria-label', 'the installed track to show');
  const ctl = el('div', 'display:flex;gap:12px;align-items:center;margin-bottom:6px');
  const showBox = el('input'); showBox.type = 'checkbox'; showBox.checked = true; showBox.setAttribute('aria-label', 'show the reference');
  const showLabel = el('label', 'display:flex;gap:4px;align-items:center;cursor:pointer'); showLabel.append(showBox, 'Show');
  const clearBtn = el('button', '', 'Clear'); clearBtn.title = 'take the reference away: the pick and the nudge';
  ctl.append(showLabel, clearBtn);
  const rows = el('div', 'display:grid;grid-template-columns:auto 1fr;gap:3px 8px;align-items:center;margin-bottom:6px'), inputs = {};
  for (const [k, label, unit, step] of NUDGES) {
    const i = el('input', 'width:90px'); i.type = 'number'; i.step = String(step); i.value = '0'; i.setAttribute('aria-label', `move the reference: ${label} (${unit})`);
    i.onchange = () => { nudge[k] = Number(i.value) || 0; send(); };
    inputs[k] = i; rows.append(el('span', '', `${label} (${unit})`), i);
  }
  // (L250) on the veil, so the words are the page's on-ink colour in every skin (--dim and --text are for the page's own ground: dark on dark in Skyline)
  const dim = 'color-mix(in srgb, var(--on-ink, #eef1f6) 72%, transparent)';
  const readout = el('div', `color:${dim};min-height:2.8em`), notesEl = el('div', 'color:var(--on-ink, #eef1f6);font-size:11px;margin-top:4px');
  notesEl.setAttribute('role', 'status');
  const note = el('div', `color:${dim};font-size:11px;margin-top:4px`,
    'Drawn from its AI line: the width the AI may use, along the line it drives (a racing line, not the centre). Its start sits on your start, at your start\'s height; your road is drawn over it. Read only: nothing is saved, undone or exported.');
  box.append(head, pickEl, ctl, rows, readout, notesEl, note); root.append(box);

  let layouts = null, ribbon = null, nudge = { ...ZERO }, shownKey = null, timing = null, error = null, notes = [], shown = true, seq = 0;
  const refused = new Map(), borrowed = new Set();   // key -> the words it was refused with; keys of layouts found carrying another layout's line
  const keyOf = (l) => `${l.track}\u0000${l.layout}`;
  const nameOf = (l) => `${l.track}${l.layout ? ` · ${l.layout}` : ''}`;
  const layoutName = (l) => (l.layout ? `“${l.layout}”` : 'the main layout');
  const say = () => {
    notesEl.textContent = notes.join(' ');
    if (error) { readout.textContent = error; return; }
    if (!ribbon) {
      if (!layouts) { readout.textContent = 'Reading the tracks…'; return; }
      const can = layouts.filter((l) => l.hasAi && !refused.has(keyOf(l))).length;
      readout.textContent = `${can} of ${layouts.length} layouts have an AI line to show${refused.size ? ` (${refused.size} cannot be read)` : ''}.`; return;
    }
    const w = ribbon.width, f = (x) => x.toLocaleString('en-US', { maximumFractionDigits: 1 });
    readout.textContent = `${shown ? '' : 'Hidden (Show draws it again) · '}${f(Math.round(ribbon.lengthM))} m along its line${ribbon.closed ? '' : ' (open: point to point)'} · ${f(w.median)} m wide (${f(w.min)} to ${f(w.max)}) · read ${timing.readMs.toFixed(0)} ms, built ${timing.buildMs.toFixed(0)} ms`;
  };
  const relabel = () => {
    pickEl.replaceChildren(el('option', '', 'None'));
    pickEl.firstChild.value = '';
    for (const l of layouts || []) {
      const k = keyOf(l), bad = refused.has(k);
      const o = el('option', '', `${nameOf(l)}${!l.hasAi ? ' (no AI line)' : bad ? ' (cannot be read)' : borrowed.has(k) ? ' (another layout\'s line)' : ''}`);
      o.value = k; o.disabled = !l.hasAi || bad; if (bad) o.title = refused.get(k); pickEl.append(o);
    }
    pickEl.value = shownKey || '';
  };
  const send = () => new Promise((resolve) => { doc.dispatchEvent(new win.CustomEvent('t180:reference', { detail: { ribbon: shown ? ribbon : null, nudge: { ...nudge }, reply: resolve } })); });

  // the other layouts of the same track whose line drives the same points as this one's (read and compared now; a sibling that does not read is marked so)
  async function notesFor(l, shape, r, my) {
    const same = [], samePath = [];
    for (const s of (layouts || []).filter((x) => x.track === l.track && x.layout !== l.layout && x.hasAi && !refused.has(keyOf(x)))) {
      let other;
      try { other = readAiShape(await call('read_reference_line', { track: s.track, layout: s.layout })); } catch (e) { refused.set(keyOf(s), refusalWords(e)); continue; }
      if (my !== seq) return null;
      const m = sameLine(shape, other);
      if (m.sameSides) same.push(layoutName(s)); else if (m.samePoints) samePath.push(layoutName(s));
    }
    if (same.length || samePath.length) borrowed.add(keyOf(l));
    return lineNotes({ lengthM: r.lengthM, uiM: uiLengthM(l.uiLength), same, samePath });
  }

  async function list() {
    error = null;
    try { layouts = await call('list_reference_tracks'); } catch (e) { layouts = []; error = `The installed tracks could not be listed: ${(e && e.message) || e}`; }
    relabel(); say(); return layouts;
  }
  async function clear() {
    seq++;   // a pick still reading is dropped when it lands
    ribbon = null; shownKey = null; timing = null; error = null; notes = []; nudge = { ...ZERO };
    for (const [k] of NUDGES) inputs[k].value = '0';
    pickEl.value = ''; await send(); say(); return null;
  }
  async function pick(track, layout) {
    if (track === null || track === undefined) return clear();
    const my = ++seq, l = (layouts || []).find((x) => x.track === track && x.layout === (layout || '')) || { track, layout: layout || '', hasAi: true, uiLength: null };
    const key = keyOf(l);
    error = null; notes = [];
    let shape, r, t0, t1, t2;
    try {
      t0 = clock(); const bytes = await call('read_reference_line', { track, layout: l.layout }); t1 = clock();
      shape = readAiShape(bytes); r = ribbonOf(shape); t2 = clock();
    } catch (e) {
      if (my !== seq) return null;   // a later pick (or Clear) won: this one says nothing
      refused.set(key, refusalWords(e));
      ribbon = null; shownKey = null; timing = null; error = `${nameOf(l)}: ${refused.get(key)}`;
      relabel(); await send(); say(); return null;   // what was shown before is taken down: the select no longer names it
    }
    if (my !== seq) return null;
    ribbon = r; shownKey = key; timing = { readMs: t1 - t0, buildMs: t2 - t1 };
    pickEl.value = key;
    const info = await send(); say();
    const n = await notesFor(l, shape, r, my);
    if (my !== seq || n === null) return info;
    notes = n; relabel(); say();
    return info;
  }
  pickEl.onchange = () => { const l = layouts && layouts.find((x) => keyOf(x) === pickEl.value); pick(l ? l.track : null, l ? l.layout : ''); };
  showBox.onchange = () => { shown = !!showBox.checked; send(); say(); };
  clearBtn.onclick = () => { clear(); };
  shut.onclick = () => { box.style.display = 'none'; };

  return {
    open() { box.style.display = 'block'; if (!layouts) return list(); return Promise.resolve(layouts); },
    close() { box.style.display = 'none'; },
    toggle() { return box.style.display === 'none' ? this.open() : (this.close(), Promise.resolve(layouts)); },
    isOpen: () => box.style.display !== 'none',
    list, pick, clear,
    /** Show (true) or hide (false) the picked reference; the pick and the nudge stay. */
    show(on) { shown = !!on; showBox.checked = shown; const p = send(); say(); return p; },
    setNudge(n) { for (const [k] of NUDGES) if (n && n[k] !== undefined) { nudge[k] = Number(n[k]) || 0; inputs[k].value = String(nudge[k]); } return send(); },
    state: () => ({ open: box.style.display !== 'none', layouts: layouts ? layouts.length : null, picked: shownKey, shown: shown && !!ribbon, showOn: shown, nudge: { ...nudge },
      timing: timing ? { ...timing } : null, error, notes: notes.slice(), refused: refused.size, readout: readout.textContent }),
  };
}

module.exports = { createReferencePanel, NUDGES };
