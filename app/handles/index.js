// index.js: the sculpt handles panel, mounted by app/index.html as mount(root, shell) (app/README.md, "The seam").
//
// Select one placed word (shell.select) and its handles appear, one slider each, grouped as the plan names them. On
// pointer-down a handle's physics bounds are computed (about a second or two: see handles.js COST) and ONE shell drag
// opens; each move is clamped at the red bound, amber passes and shows amber, and pointer-up ends the drag as one undo
// entry. Hold Alt while dragging to go past red and see it (handles.js pastRed). "Show bounds" computes every handle's
// range at once. Angles show in degrees; the document stores radians.
// No key is bound here: Alt is read from the pointer event, not claimed (app/README.md: keys are asked for there first).
'use strict';
const { createHandlesController } = require('./panel.js');
const { stopLine, refusalText } = require('../validate-ui/labels.js');

const DEG = 180 / Math.PI;
const COLOUR = { clean: '', amber: 'rgb(255, 173, 26)', red: 'rgb(230, 41, 31)', refused: 'rgb(230, 41, 31)' };
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const shown = (unit, v) => (unit === 'rad' ? `${(v * DEG).toFixed(2)}°` : unit === 'm' ? `${v.toFixed(3)} m` : v.toFixed(4));

function mount(root, shell) {
  const ctl = createHandlesController(shell);
  const title = el('div', { className: 'h-title' }), rows = el('div', { className: 'h-rows' });
  const csp = el('input', { type: 'checkbox', checked: true });
  const all = el('button', { textContent: 'Show bounds' });
  const note = el('div', { className: 'h-note' });
  root.append(title, el('label', {}, [csp, ' CSP']), all, rows, note);
  let shownFor = null;

  function build() {
    const t = ctl.target();
    if (ctl.dragging) return;                                        // never rebuild under the pointer
    if (t && shownFor && shownFor.id === t.id) { refresh(t); return; }
    shownFor = t; rows.replaceChildren(); note.textContent = '';
    if (!t) { title.textContent = ctl.why(); return; }
    title.textContent = `${t.id}: ${t.word}${t.font ? ` (${t.font})` : ''}`;
    for (const r of t.rows) {
      const input = el('input', { type: 'range', min: r.range[0], max: r.range[1], step: 'any', value: r.value });
      const val = el('span', { className: 'h-val', textContent: shown(r.unit, r.value) });
      // the reason on its own line under the slider (D177 window pass: inline, it read "23.800 mred past …")
      const why = el('div', { className: 'h-why', style: 'font-size: 11px; opacity: 0.9;' });
      input.dataset.handle = r.handle;
      input.addEventListener('pointerdown', (e) => {
        try {
          const { bounds } = ctl.begin(r.handle, { pastRed: e.altKey });
          why.textContent = bounds.min == null ? 'already red: no clean range' : `clean ${shown(r.unit, bounds.min)} … ${shown(r.unit, bounds.max)}`;
        } catch (err) { why.textContent = err.message; }
      });
      input.addEventListener('input', () => {
        if (!ctl.dragging) return;
        const m = ctl.move(Number(input.value));
        input.value = m.value; val.textContent = shown(r.unit, m.value);
        // plain words shown, the rule ids and sources in the tooltip (A's D180 check: no rule id or .md line in the panel)
        val.style.color = COLOUR[m.level] || '';
        const shownWhy = m.stop ? stopLine(m.stop, r.unit === 'm' ? ' m' : '').text : m.level === 'refused' ? `the document refuses it: ${refusalText(m.why)}` : (m.why || '');
        why.textContent = shownWhy; why.title = m.why || '';
      });
      input.addEventListener('pointerup', () => { ctl.end(); build(); });
      input.addEventListener('pointercancel', () => { ctl.cancel(); build(); });
      rows.append(el('div', { className: `h-row h-${r.group}` }, [el('span', { className: 'h-name', textContent: r.handle }), input, val, why]));
    }
  }
  function refresh(t) {
    for (const r of t.rows) {
      const input = rows.querySelector(`input[data-handle="${r.handle}"]`);
      if (input) { input.value = r.value; input.nextSibling.textContent = shown(r.unit, r.value); }
    }
  }
  all.onclick = () => {
    note.textContent = 'computing…';
    setTimeout(() => {
      try {
        const b = ctl.bounds();
        if (!b) { note.textContent = ''; return; }
        const t = ctl.target(), u = Object.fromEntries(t.rows.map((r) => [r.handle, r.unit]));
        note.textContent = Object.entries(b.handles).map(([h, x]) => (x.min == null ? `${h}: red now` : `${h}: ${shown(u[h], x.min)} … ${shown(u[h], x.max)}${x.amberMax != null && x.amberMax < x.max ? ` (amber past ${shown(u[h], x.amberMax)})` : ''}`)).join(' · ');
      } catch (err) { note.textContent = err.message; }
    }, 0);
  };
  csp.onchange = () => ctl.setCsp(csp.checked);
  const unsubscribe = shell.subscribe(build);
  build();
  return { dispose: unsubscribe };
}

module.exports = { mount };
