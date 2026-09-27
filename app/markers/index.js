// index.js: the markers panel (ARCHITECTURE §5c), mounted as mount(root, shell) like every panel (app/README.md, "The
// seam"). PROPOSED MOUNT POINT FOR A (app/index.html is A's): an element `<section id="markers">` in the side panel, and
// ['markers', 'markers'] added to the page's list of panels loaded through app/lib/cjs.js.
//
// What it shows: the grid (pattern, count, pole distance, row and column gaps), each slot (nudge along or across), the
// pit boxes (count, spacing), the hotlap's target speed (default the design speed, 460 km/h, FINDINGS.md:476) and the
// run-up it gives, optional sectors 1 and 2 (placed a third and two thirds of the way round), the marker height, and
// §5c's checks, red and amber, with every problem named.
// WHAT IT GIVES THE PREVIEW AND THE EXPORT: after every update, root dispatches a bubbling CustomEvent 't180:markers'
// with detail { layout, placed, paint, check }. The preview can draw `paint.meshes` (scene-node arrays, on the surface)
// and a gizmo at each `placed[i].pos`; the export should pass `layout` as exportTrack's opts.markers (A's
// app/export/export.js). Neither is wired yet: both are A's and C's files this lap.
'use strict';
const { createMarkersController } = require('./panel.js');
const { PATTERNS, runUpM } = require('../../src/markers/index.js');
const { MACH6 } = require('../../src/validate/limits.js');

const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const num = (value, step, onchange) => { const i = el('input', { type: 'number', value, step }); i.onchange = () => onchange(Number(i.value)); return i; };

function mount(root, shell) {
  const form = el('div', { className: 'm-form' }), slots = el('ul', { className: 'm-slots' }), checks = el('ul', { className: 'm-checks' });
  const head = el('div', { className: 'm-head' });
  root.append(head, form, slots, checks);
  let ctl = null;

  function render(st) {
    form.replaceChildren(); slots.replaceChildren(); checks.replaceChildren();
    if (st.error) { head.textContent = `markers: ${st.error}`; return; }
    if (!st.layout) { head.textContent = 'markers: place a straight to drop the grid on'; return; }
    const L = st.layout, red = st.check ? st.check.checks.filter((c) => !c.ok) : [];
    head.textContent = `${red.length ? `${red.length} red` : 'ready'}${st.custom ? '' : ' · default layout'} · ${st.placed.filter((m) => m.kind === 'grid').length} grid slots · ${st.placed.filter((m) => m.kind === 'pit').length} pit boxes`;
    const pat = el('select', {}, Object.keys(PATTERNS).map((p) => el('option', { value: p, textContent: p, selected: p === L.grid.pattern })));
    pat.onchange = () => ctl.edit((l) => { l.grid.pattern = pat.value; return l; });
    const hot = L.hotlap.speedKmh != null ? L.hotlap.speedKmh : MACH6.designSpeedKmh;
    form.append(
      el('label', {}, ['grid ', pat]),
      el('label', {}, [' slots ', num(L.grid.count, 1, (v) => ctl.edit((l) => { l.grid.count = v; return l; }))]),
      el('label', {}, [' pole back m ', num(L.grid.poleBackM, 1, (v) => ctl.edit((l) => { l.grid.poleBackM = v; return l; }))]),
      el('label', {}, [' row gap m ', num(L.grid.rowGapM, 1, (v) => ctl.edit((l) => { l.grid.rowGapM = v; return l; }))]),
      el('label', {}, [' column gap m ', num(L.grid.colGapM, 0.5, (v) => ctl.edit((l) => { l.grid.colGapM = v; return l; }))]),
      el('label', {}, [' pit boxes ', num(L.pits.count, 1, (v) => ctl.edit((l) => { l.pits.count = v; return l; }))]),
      el('label', {}, [' pit spacing m ', num(L.pits.spacingM, 1, (v) => ctl.edit((l) => { l.pits.spacingM = v; return l; }))]),
      el('label', {}, [` hotlap km/h (run-up ${runUpM(hot / 3.6).toFixed(0)} m) `, num(hot, 10, (v) => ctl.edit((l) => { l.hotlap.speedKmh = v; return l; }))]),
      el('label', {}, [' height m ', num(L.height, 0.1, (v) => ctl.edit((l) => { l.height = v; return l; }))]),
      Object.assign(el('button', { textContent: L.sectors.length ? 'remove sectors' : 'add sectors 1 and 2' }), { onclick: () => ctl.edit((l) => { l.sectors = l.sectors.length ? [] : thirds(st); return l; }) }),
      Object.assign(el('button', { textContent: 'default layout' }), { onclick: () => ctl.reset() }));
    for (const m of st.placed.filter((x) => x.kind === 'grid')) {
      const nudge = (d) => Object.assign(el('button', { textContent: d.label }), { onclick: () => ctl.editSlot(m.n, d.patch(m)) });
      slots.append(el('li', {}, [`${m.name} ${m.backM.toFixed(1)} m back, u ${m.u.toFixed(1)} m `,
        nudge({ label: '↑', patch: (x) => ({ backM: x.backM - 1 }) }), nudge({ label: '↓', patch: (x) => ({ backM: x.backM + 1 }) }),
        nudge({ label: '←', patch: (x) => ({ u: x.u + 0.5 }) }), nudge({ label: '→', patch: (x) => ({ u: x.u - 0.5 }) })]));
    }
    if (st.check) {
      for (const c of st.check.checks) for (const p of c.problems) checks.append(el('li', { className: 'm-red', textContent: `red · ${c.id}: ${p}` }));
      for (const a of st.check.amber) checks.append(el('li', { className: 'm-amber', textContent: `amber · ${a.id}: ${a.text}` }));
    }
    root.dispatchEvent(new CustomEvent('t180:markers', { bubbles: true, detail: { layout: st.layout, placed: st.placed, paint: st.paint, check: st.check } }));
  }

  /** Sector anchors a third and two thirds of the way round: the words there, and the distance into them. */
  function thirds(st) {
    const segs = shell.getState().resolved.segments, total = segs.reduce((a, g) => a + g.length, 0);
    return [1 / 3, 2 / 3].map((f) => {
      let s = 0; for (const g of segs) { if (s + g.length >= f * total && g.kind === 'road') { const first = segs.findIndex((x) => x.id === g.id); const start = segs.slice(0, first).reduce((a, x) => a + x.length, 0); return { word: g.id, along: f * total - start }; } s += g.length; }
      return { word: segs[segs.length - 1].id, along: 0 };
    });
  }

  ctl = createMarkersController(shell, { onUpdate: render });
  render(ctl.state);
  return { dispose: () => ctl.dispose() };
}

module.exports = { mount };
