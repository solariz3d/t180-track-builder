// index.js: the validation panel, mounted by app/index.html as mount(root, shell) (app/README.md, "The seam").
//
// What it shows, in #validation:
//   · a summary: red and amber counts, the lap (open while building), the jumps;
//   · a CSP toggle: off validates for vanilla AC, where surfaces above 50° are red (ARCHITECTURE.md:87);
//   · the colour ribbon: the whole track unrolled, s left to right and u (right edge at the bottom, left edge at the
//     top) up the strip, one pixel column per station, from the same colour map the preview should paint;
//   · every red and amber range with its reason and FINDINGS/ARCHITECTURE source; every jump with both landings.
//
// WHAT IT GIVES THE PREVIEW (a seam proposed here, not yet agreed with C): after every update, root dispatches a
// bubbling CustomEvent 't180:validation' with detail { path, result, map, levelAt(s, u), rgbaAt(s, u), arcs }. The
// shell shares nothing derived (app/README.md), so the preview listens on document for it instead of re-validating.
// It is mesh-free: colours are looked up per vertex by (s, u), and the arcs are short polylines.
// Validation is batched to one run per animation frame (the controller's `schedule`), so a drag does not validate more
// often than the screen draws.
'use strict';
const { createValidationController, summary } = require('./panel.js');
const { levelAt, rgbaAt, PALETTE, LEVEL } = require('./colour.js');

const css = (rgba) => `rgb(${Math.round(rgba[0] * 255)}, ${Math.round(rgba[1] * 255)}, ${Math.round(rgba[2] * 255)})`;
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

function drawRibbon(canvas, state) {
  const g = canvas.getContext('2d'), W = canvas.width, Hh = canvas.height;
  g.clearRect(0, 0, W, Hh);
  const st = state.map ? state.map.stations : [];
  if (!st.length) return;
  let uMin = Infinity, uMax = -Infinity;
  for (const e of st) for (const u of e.u) { uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); }
  if (uMin === uMax) { uMin -= 1; uMax += 1; }
  const L = st[st.length - 1].s || 1;
  for (let k = 0; k < st.length; k++) {
    const e = st[k], x0 = Math.floor((e.s / L) * (W - 1)), x1 = k + 1 < st.length ? Math.floor((st[k + 1].s / L) * (W - 1)) : W;
    for (let j = 0; j < e.u.length; j++) {
      const lo = j ? (e.u[j - 1] + e.u[j]) / 2 : uMin, hi = j + 1 < e.u.length ? (e.u[j] + e.u[j + 1]) / 2 : uMax;
      const y0 = Hh - ((hi - uMin) / (uMax - uMin)) * Hh, y1 = Hh - ((lo - uMin) / (uMax - uMin)) * Hh;
      g.fillStyle = css(PALETTE[e.levels[j]]);
      g.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }
  }
}

function mount(root, shell) {
  const head = el('div', { className: 'v-summary' });
  const csp = el('input', { type: 'checkbox', checked: true });
  const ribbon = el('canvas', { width: 480, height: 48, className: 'v-ribbon' });
  const list = el('ul', { className: 'v-list' });
  root.append(el('label', {}, [csp, ' CSP (wall raycasting)']), head, ribbon, list);

  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
  function render(state) {
    const s = summary(state);
    head.textContent = state.error ? `not validated: ${state.error}`
      : `${s.red} red · ${s.amber} amber · lap ${s.lap ? (s.lap.ok === null ? `not run (${s.lap.reason})` : s.lap.ok ? 'proved' : 'FAILS') : '—'} · ${s.jumps} jump${s.jumps === 1 ? '' : 's'}`;
    head.style.color = state.error ? css(PALETTE[LEVEL.RED]) : '';
    drawRibbon(ribbon, state);
    list.replaceChildren();
    const r = state.result;
    if (r) {
      for (const [kind, items, lvl] of [['red', r.red, LEVEL.RED], ['amber', r.amber, LEVEL.AMBER]]) {
        for (const x of items) list.append(el('li', { textContent: `${kind}: ${x.reason}, s ${x.s0.toFixed(0)}–${x.s1.toFixed(0)} m${x.source ? ` (${x.source})` : ''}`, style: `color: ${css(PALETTE[lvl])}` }));
      }
      if (r.lap && r.lap.ok === false) for (const w of r.lap.where) list.append(el('li', { textContent: `lap: ${w.reason} at s ${w.s.toFixed(0)} m`, style: `color: ${css(PALETTE[LEVEL.RED])}` }));
    }
    for (const j of state.arcs) {
      const legs = j.arcs.map((a) => `${a.g} g ${a.caught ? `lands at ${a.touchdown.x.toFixed(1)} m` : a.clear ? 'clears, no touchdown found' : `falls short (needs ${(a.minSpeed * 3.6).toFixed(0)} km/h)`}`);
      list.append(el('li', { textContent: `jump at s ${j.s.toFixed(0)} m${j.speed ? `, ${(j.speed * 3.6).toFixed(0)} km/h` : ', drawn at each landing\'s minimum speed'}: ${legs.join('; ')}` }));
    }
    const map = state.map;
    root.dispatchEvent(new CustomEvent('t180:validation', { bubbles: true, detail: {
      path: state.path, result: state.result, map, arcs: state.arcs,
      levelAt: (s, u) => (map ? levelAt(map, s, u) : LEVEL.CLEAR), rgbaAt: (s, u) => (map ? rgbaAt(map, s, u) : PALETTE[LEVEL.CLEAR]),
    } }));
  }
  const ctl = createValidationController(shell, { onUpdate: render, schedule: raf });
  csp.onchange = () => ctl.setCsp(csp.checked);
  return { dispose: () => ctl.dispose() };
}

module.exports = { mount };
