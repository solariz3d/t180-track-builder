// index.js: the validation panel, mounted by app/index.html as mount(root, shell) (app/README.md, "The seam").
//
// What it shows, in #validation:
//   · a summary: red and amber counts, the lap (open while building), the jumps;
//   · the design-speed picker (speed.js): loads for every word without its own speed, default 460 km/h (FINDINGS.md:476);
//   · a CSP toggle: off validates for vanilla AC, where surfaces above 50° are red (ARCHITECTURE.md:87);
//   · the load graph (graph.js): the hardest line's load along the track, the 20 g and 90 g limits, red and amber
//     stretches shaded. HIDDEN while there is no load (no speed model). It replaced, in D170, a colour ribbon that
//     painted an all-grey bar while there were no loads (the librarian's item 5);
//   · every red and amber range with its reason and FINDINGS/ARCHITECTURE source; every jump with both landings.
//
// WHAT IT GIVES THE PREVIEW (a seam proposed here, not yet agreed with C): after every update, root dispatches a
// bubbling CustomEvent 't180:validation' with detail { path, result, map, levelAt(s, u), rgbaAt(s, u), arcs }. The
// shell shares nothing derived (app/README.md), so the preview listens on document for it instead of re-validating.
// It is mesh-free: colours are looked up per vertex by (s, u), and the arcs are short polylines.
// Validation is batched to one run per animation frame (the controller's `schedule`), so a drag does not validate more
// often than the screen draws.
//
// WHAT IT ASKS THE PREVIEW (D177, one shared path): before each update it dispatches C's 't180:track-request' on the
// document; the preview replies { path, segments, … }, its path and the segments it was built from. The controller
// validates a 2 m view of that path (pathview.js; the identity while the preview's step is 2 m too) when `segments` is
// the very array of the document being validated, and otherwise grows its own path, so an unanswered event costs
// speed, never correctness.
'use strict';
const { createValidationController, summary } = require('./panel.js');
const { levelAt, rgbaAt, PALETTE, LEVEL } = require('./colour.js');
const { createSpeedPicker, mountSpeedPicker } = require('./speed.js');
const { graphModel, drawGraph } = require('./graph.js');
const { lapText, lapWhereText, findingLine } = require('./labels.js');

const css = (rgba) => `rgb(${Math.round(rgba[0] * 255)}, ${Math.round(rgba[1] * 255)}, ${Math.round(rgba[2] * 255)})`;
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

function mount(root, shell) {
  const head = el('div', { className: 'v-summary' });
  const csp = el('input', { type: 'checkbox', checked: true });
  const graph = el('canvas', { width: 480, height: 96, className: 'v-graph', style: 'width: 100%; height: 96px;' });
  const list = el('ul', { className: 'v-list' });
  const speedRow = el('div', { className: 'v-speed-row' });
  root.append(speedRow, el('label', {}, [csp, ' CSP (wall raycasting)']), head, graph, list);

  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
  function render(state) {
    const s = summary(state);
    head.textContent = state.error ? `not validated: ${state.error}`
      : `${s.red} red · ${s.amber} amber · ${lapText(s.lap)} · ${s.jumps} jump${s.jumps === 1 ? '' : 's'}${s.jumpsPending ? ` (${s.jumpsPending} waiting for ${s.jumpsPending === 1 ? 'its landing' : 'their landings'})` : ''}${s.pendingFrom != null ? ` · checked to ${Math.round(s.pendingFrom)} m, the rest when the drag ends` : ''}`;
    head.style.color = state.error ? css(PALETTE[LEVEL.RED]) : '';
    const gm = graphModel(state);
    graph.style.display = gm ? '' : 'none';   // hidden while there is no load to draw
    // the canvas's backing store follows its SHOWN size (D177 window pass: drawn at 480 px and shown at ~265, its labels
    // were too small to read); DPR-aware, so the 10 px labels are 10 css px on any screen
    const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1, cw = graph.clientWidth;
    if (cw > 0 && graph.width !== Math.round(cw * dpr)) { graph.width = Math.round(cw * dpr); graph.height = Math.round(96 * dpr); }
    drawGraph(graph, gm);
    list.replaceChildren();
    const r = state.result;
    if (r) {
      for (const [kind, items, lvl] of [['red', r.red, LEVEL.RED], ['amber', r.amber, LEVEL.AMBER]]) {
        for (const x of items) { const f = findingLine(kind, x); list.append(el('li', { textContent: f.text, title: f.title, style: `color: ${css(PALETTE[lvl])}` })); }   // the rule and its source in the tooltip
      }
      if (r.lap && r.lap.ok === false) for (const w of r.lap.where) list.append(el('li', { textContent: `lap: ${lapWhereText(w)}, at ${w.s.toFixed(0)} m`, title: w.reason, style: `color: ${css(PALETTE[LEVEL.RED])}` }));
    }
    for (const j of state.arcs) {
      const legs = j.arcs.map((a) => `${a.g} g ${a.caught ? `lands at ${a.touchdown.x.toFixed(1)} m` : a.clear ? 'clears, no touchdown found' : `falls short (needs ${(a.minSpeed * 3.6).toFixed(0)} km/h)`}`);
      list.append(el('li', { textContent: `jump at s ${j.s.toFixed(0)} m${j.speed ? `, ${(j.speed * 3.6).toFixed(0)} km/h` : ', drawn at each landing\'s minimum speed'}: ${legs.join('; ')}` }));
    }
    const map = state.map;
    root.dispatchEvent(new CustomEvent('t180:validation', { bubbles: true, detail: {
      path: state.path, result: state.result, map, arcs: state.arcs, speedPicker: picker,
      levelAt: (s, u) => (map ? levelAt(map, s, u) : LEVEL.CLEAR), rgbaAt: (s, u) => (map ? rgbaAt(map, s, u) : PALETTE[LEVEL.CLEAR]),
    } }));
  }
  let ctl = null;
  // D179: the slider's speed also sizes the open track's jump ramps (A's shell setDesignSpeed re-resolves; derived, no
  // undo step), so a jump is never checked at a speed its ramp was not built for. The shell first, then validation at it
  const picker = createSpeedPicker({ onChange: (kmh) => {
    if (typeof shell.setDesignSpeed === 'function') shell.setDesignSpeed(kmh);
    if (ctl) ctl.setDesignSpeed(kmh);
  } });
  // ONE PATH (D177): the preview's path, asked for through C's seam ('t180:track-request', { reply(track) }, answered
  // with { path, segments, closed, how, g, fromS }: app/preview/index.js); with no answer, or a path for another
  // document, the controller grows its own
  const sharedPath = () => { let got = null; document.dispatchEvent(new CustomEvent('t180:track-request', { detail: { reply: (x) => { got = x; } } })); return got; };
  ctl = createValidationController(shell, { designSpeedKmh: picker.kmh, onUpdate: render, schedule: raf, sharedPath });
  mountSpeedPicker(speedRow, picker);
  csp.onchange = () => ctl.setCsp(csp.checked);
  return { dispose: () => ctl.dispose() };
}

module.exports = { mount };
