// layoutsdialog.js: the question File ▸ Export layouts… asks (D361 part 2), in the builder's own look (app/askdialog.js's card).
// node --test app/test/layoutsdialog.test.js
//
//   askLayouts(doc, { tracks }) -> Promise<{ name, picks: [{ track, layout, name, main }] } | null>   (null: cancelled)
//   defaults(tracks) -> { name, rows }        check({ name, rows }) -> { ok, problem, picks }        (pure)
//
// One row per saved track: Use it, its layout name (what AC reads it by: models_<layout>.ini, <layout>/, ui/<layout>/), the name
// Content Manager shows (e.g. "Elysium Long"), and Main (the layout Content Manager opens first). Above them the track's own name,
// which names the folder (t180b_<name>) and is what Content Manager lists the layouts under. Export stays off, with the reason
// beside it, until the answer can be exported: two or more tracks, each layout name a–z, 0–9 or _ and used once, each shown
// name filled in, and the main one among the picked. Escape or Cancel answers null; nothing is written by this file.
'use strict';

const LAYOUT_RE = /^[a-z0-9_]{1,32}$/;   // src/export/layouts.js LAYOUT_RE
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'layout';

/** The words every name starts with ("Elysium" for "Elysium Long" and "Elysium Short"), else the first name. */
function commonName(names) {
  if (!names.length) return '';
  const words = names.map((n) => String(n).trim().split(/\s+/));
  const out = [];
  for (let i = 0; words.every((w) => i < w.length && w[i].toLowerCase() === words[0][i].toLowerCase()); i++) out.push(words[0][i]);
  return out.join(' ') || String(names[0]).trim();
}

function defaults(tracks) {
  const rows = tracks.map((t, i) => ({ track: t, use: false, layout: slug(t), display: t, main: i === 0 }));
  return { name: commonName(tracks), rows };
}

function check({ name, rows }) {
  const used = rows.filter((r) => r.use);
  const no = (problem) => ({ ok: false, problem, picks: [] });
  if (used.length < 2) return no(`pick at least two saved tracks (${used.length} picked)`);
  if (!/[a-z0-9]/i.test(String(name || ''))) return no('give the track a name: it names the folder and the list in Content Manager');
  const seen = new Set();
  for (const r of used) {
    if (!LAYOUT_RE.test(r.layout)) return no(`"${r.layout}" (${r.track}) is not a layout name: a–z, 0–9 and _, 1 to 32`);
    if (seen.has(r.layout)) return no(`the layout name "${r.layout}" is used twice`);
    seen.add(r.layout);
    if (!String(r.display || '').trim() || r.display.length > 100) return no(`${r.track}: the shown name must be 1 to 100 characters`);
  }
  const mains = used.filter((r) => r.main);
  if (mains.length !== 1) return no('mark one of the picked tracks as the main layout');
  return { ok: true, problem: null, picks: used.map((r) => ({ track: r.track, layout: r.layout, name: r.display.trim(), main: r.main })) };
}

function askLayouts(doc, { tracks = [] } = {}) {
  if (!doc || !doc.body) return Promise.reject(new Error('askLayouts: no document to ask in'));
  const state = defaults(tracks);
  const mk = (tag, props = {}) => { const e = doc.createElement(tag); Object.assign(e, props); return e; };
  const veil = mk('div', { className: 'ask-veil' }), card = mk('div', { className: 'ask-card ask-layouts' });
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
  const nameIn = mk('input', { type: 'text', value: state.name, className: 'lx-name' });
  nameIn.setAttribute('aria-label', 'the track\'s name');
  const table = mk('div', { className: 'lx-rows' }), problem = mk('p', { className: 'lx-problem' });
  const cancel = mk('button', { textContent: 'Cancel' }), go = mk('button', { textContent: 'Export…', className: 'ask-main' });
  const row = mk('div', { className: 'ask-row' });
  const refresh = () => { const c = check(state); go.disabled = !c.ok; problem.textContent = c.ok ? '' : c.problem; return c; };
  const head = mk('div', { className: 'lx-row lx-head' });
  for (const t of ['Use', 'Saved track', 'Layout name', 'Shown as', 'Main']) head.appendChild(mk('span', { textContent: t }));
  table.appendChild(head);
  state.rows.forEach((r, i) => {
    const use = mk('input', { type: 'checkbox', checked: r.use, className: 'lx-use' });
    const label = mk('span', { textContent: r.track, className: 'lx-track' });
    const lay = mk('input', { type: 'text', value: r.layout, className: 'lx-layout' });
    const disp = mk('input', { type: 'text', value: r.display, className: 'lx-display' });
    const main = mk('input', { type: 'radio', name: 'lx-main', checked: r.main, className: 'lx-main' });
    use.setAttribute('aria-label', `use ${r.track}`); lay.setAttribute('aria-label', `layout name for ${r.track}`);
    disp.setAttribute('aria-label', `name shown for ${r.track}`); main.setAttribute('aria-label', `${r.track} is the main layout`);
    use.onchange = () => { r.use = !!use.checked; refresh(); };
    lay.oninput = () => { r.layout = lay.value; refresh(); };
    disp.oninput = () => { r.display = disp.value; refresh(); };
    main.onchange = () => { state.rows.forEach((x, k) => { x.main = k === i; }); refresh(); };
    const line = mk('div', { className: 'lx-row' });
    for (const e of [use, label, lay, disp, main]) line.appendChild(e);
    table.appendChild(line);
  });
  nameIn.oninput = () => { state.name = nameIn.value; refresh(); };
  card.appendChild(mk('h2', { textContent: 'Export layouts' }));
  card.appendChild(mk('p', { textContent: 'One Assetto Corsa track with one layout per saved track, each a whole road, the way Aurora Cryopticon ships its layouts. Re-exporting removes the files of a layout you leave out, and nothing else.' }));
  const nameLine = mk('label', { className: 'lx-row' }); nameLine.appendChild(mk('span', { textContent: 'Track name' })); nameLine.appendChild(nameIn);
  card.appendChild(nameLine);
  card.appendChild(table); card.appendChild(problem);
  row.appendChild(cancel); row.appendChild(go); card.appendChild(row); veil.appendChild(card);
  const before = doc.activeElement;
  return new Promise((done) => {
    const finish = (v) => {
      doc.removeEventListener('keydown', onKey, true);
      try { veil.remove(); } catch (e) { /* already gone */ }
      try { if (before && before.focus) before.focus(); } catch (e) { /* the old focus is gone */ }
      done(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      else e.stopPropagation();   // the builder's own keys (WASD, Ctrl+Z) must not act behind the question
    };
    cancel.onclick = () => finish(null);
    go.onclick = () => { const c = refresh(); if (c.ok) finish({ name: state.name.trim(), picks: c.picks }); };
    doc.addEventListener('keydown', onKey, true);
    refresh();
    doc.body.appendChild(veil);
    try { nameIn.focus(); } catch (e) { /* no focus in a test document */ }
  });
}

if (typeof module !== 'undefined') module.exports = { askLayouts, defaults, check, commonName, slug };
