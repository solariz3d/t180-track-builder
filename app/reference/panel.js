// panel.js (L243, a first look): View ▸ Reference track…, a small panel over the preview that lists the tracks installed in Assetto Corsa
// (content/tracks, each layout) and shows the picked one's road under the user's, see-through, at true scale (src/reference/ribbon.js). The user's
// words, 2026-11-26: "it can be accessed through the other saved tracks that already exist in the assetto track folder, it doesnt create it
// through our system, just renders the total shape of the track to see within the preview".
//
//   createReferencePanel({ doc, root, call, clock? }) -> { open(), close(), toggle(), isOpen(), list(), pick(track, layout), setNudge(n), state() }
//     call(cmd, args): the page's native call. list_reference_tracks -> [{ track, layout, hasAi, uiLength }]; read_reference_line { track, layout }
//     -> the AI line's bytes up to its grid (an ArrayBuffer). Nothing is ever written: the panel only reads, and the preview only draws.
//   The road goes to the preview as 't180:reference' (app/preview/index.js); a layout with no AI line is listed, greyed, saying so.
//   The nudge moves it by hand: across (x), along (z), up, and turn (degrees about its start). No scale, on purpose.
'use strict';

const { readAiShape, ribbonOf } = require('../../src/reference/ribbon.js');

const NUDGES = [['dx', 'x', 'm', 5], ['dz', 'z', 'm', 5], ['dy', 'up', 'm', 1], ['yawDeg', 'turn', '°', 5]];

function createReferencePanel({ doc, root, call, clock = () => (doc.defaultView && doc.defaultView.performance ? doc.defaultView.performance.now() : Date.now()) }) {
  const win = doc.defaultView, el = (tag, css, text) => { const e = doc.createElement(tag); if (css) e.style.cssText = css; if (text !== undefined) e.textContent = text; return e; };
  const box = el('div', 'position:absolute;top:10px;right:10px;z-index:6;width:300px;display:none;padding:8px 10px;border-radius:6px;font:12px/1.4 var(--body, system-ui);color:var(--fg, #e8e6e3);background:color-mix(in srgb, var(--veil, rgb(10,12,16)) 88%, transparent);border:1px solid color-mix(in srgb, var(--fg, #e8e6e3) 18%, transparent)');
  box.className = 'reference-panel'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'reference track');
  const head = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-weight:600'), title = el('span', '', 'Reference track');
  const shut = el('button', 'background:none;border:0;color:inherit;cursor:pointer;font:inherit', '✕'); shut.title = 'close the panel (the reference stays shown; pick None to hide it)';
  head.append(title, shut);
  const pickEl = el('select', 'width:100%;margin-bottom:6px'); pickEl.setAttribute('aria-label', 'the installed track to show');
  const rows = el('div', 'display:grid;grid-template-columns:auto 1fr;gap:3px 8px;align-items:center;margin-bottom:6px'), inputs = {};
  for (const [k, label, unit, step] of NUDGES) {
    const i = el('input', 'width:90px'); i.type = 'number'; i.step = String(step); i.value = '0'; i.setAttribute('aria-label', `move the reference: ${label} (${unit})`);
    i.onchange = () => { nudge[k] = Number(i.value) || 0; send(); };
    inputs[k] = i; rows.append(el('span', '', `${label} (${unit})`), i);
  }
  const readout = el('div', 'color:var(--dim, #9a9a9a);min-height:2.8em'), note = el('div', 'color:var(--dim, #9a9a9a);font-size:11px;margin-top:4px',
    'Drawn from its AI line: the width the AI may use, along the line it drives (a racing line, not the centre). Read only: nothing is saved or exported.');
  box.append(head, pickEl, rows, readout, note); root.append(box);

  let layouts = null, ribbon = null, nudge = { dx: 0, dz: 0, dy: 0, yawDeg: 0 }, shownKey = null, timing = null, error = null;
  const keyOf = (l) => `${l.track}\u0000${l.layout}`;
  const say = () => {
    if (error) { readout.textContent = error; return; }
    if (!ribbon) { readout.textContent = layouts ? `${layouts.filter((l) => l.hasAi).length} of ${layouts.length} layouts have an AI line to show.` : 'Reading the tracks…'; return; }
    const w = ribbon.width, f = (x) => x.toLocaleString('en-US', { maximumFractionDigits: 1 });
    readout.textContent = `${f(Math.round(ribbon.lengthM))} m along its line${ribbon.closed ? '' : ' (open: point to point)'} · ${f(w.median)} m wide (${f(w.min)} to ${f(w.max)}) · read ${timing.readMs.toFixed(0)} ms, built ${timing.buildMs.toFixed(0)} ms`;
  };
  const send = () => new Promise((resolve) => { doc.dispatchEvent(new win.CustomEvent('t180:reference', { detail: { ribbon, nudge: { ...nudge }, reply: resolve } })); });

  async function list() {
    error = null;
    try { layouts = await call('list_reference_tracks'); } catch (e) { layouts = []; error = `The installed tracks could not be listed: ${(e && e.message) || e}`; }
    pickEl.replaceChildren(el('option', '', 'None'));
    pickEl.firstChild.value = '';
    for (const l of layouts) {
      const o = el('option', '', `${l.track}${l.layout ? ` · ${l.layout}` : ''}${l.hasAi ? '' : ' (no AI line)'}`);
      o.value = keyOf(l); o.disabled = !l.hasAi; pickEl.append(o);
    }
    if (shownKey) pickEl.value = shownKey;
    say(); return layouts;
  }
  async function pick(track, layout) {
    error = null;
    if (track === null || track === undefined) { ribbon = null; shownKey = null; timing = null; pickEl.value = ''; await send(); say(); return null; }
    try {
      const t0 = clock(), bytes = await call('read_reference_line', { track, layout: layout || '' }), t1 = clock();
      const r = ribbonOf(readAiShape(bytes)), t2 = clock();
      ribbon = r; shownKey = keyOf({ track, layout: layout || '' }); timing = { readMs: t1 - t0, buildMs: t2 - t1 };
      pickEl.value = shownKey;
    } catch (e) { error = `That track's road could not be read: ${(e && e.message) || e}`; say(); return null; }
    const info = await send(); say(); return info;
  }
  pickEl.onchange = () => { const l = layouts && layouts.find((x) => keyOf(x) === pickEl.value); pick(l ? l.track : null, l ? l.layout : ''); };
  shut.onclick = () => { box.style.display = 'none'; };

  return {
    open() { box.style.display = 'block'; if (!layouts) return list(); return Promise.resolve(layouts); },
    close() { box.style.display = 'none'; },
    toggle() { return box.style.display === 'none' ? this.open() : (this.close(), Promise.resolve(layouts)); },
    isOpen: () => box.style.display !== 'none',
    list, pick,
    setNudge(n) { for (const [k] of NUDGES) if (n && n[k] !== undefined) { nudge[k] = Number(n[k]) || 0; inputs[k].value = String(nudge[k]); } return send(); },
    state: () => ({ open: box.style.display !== 'none', layouts: layouts ? layouts.length : null, shown: shownKey, nudge: { ...nudge }, timing: timing ? { ...timing } : null, error, readout: readout.textContent }),
  };
}

module.exports = { createReferencePanel, NUDGES };
