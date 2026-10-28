// index.js: the validation panel, mounted by app/index.html as mount(root, shell) (app/README.md, "The seam").
//
// What it shows, in #validation:
//   · a summary: red and amber counts, the lap (open while building), the jumps;
//   · NO speed control (D256, the user: "it should always be maxed out"): an open track's loads at the lap sim's cap, 970 km/h
//     (MACH6.vmaxKmh), a closed one on its ghost lap, the speed the export judges it at, so the two never disagree;
//   · a CSP toggle: off validates for vanilla AC, where surfaces above 50° are red (ARCHITECTURE.md:87). D355: it is the saved setting `csp` (app/settings.js),
//     shared with Settings ▸ Checker ▸ Wall raycasting: it starts from what is saved, a click on it saves it, and a change made in the menu ticks it here and re-checks;
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
//
// OFF THE WINDOW'S THREAD (the user, 2026-10-14: on ELYSIUM, 24 km, the check froze the window ~0.7 s per placed piece and ~30 s on opening it).
// Where the page can make a Web Worker, the check runs there (checkrunner.js -> checkworker.js -> checkjob.js, the same resolve, the same
// preview path, the same controller): the panel sends the document on every change, at most once a frame, and shows the answer when it comes,
// with "checking…" while a newer document is still being checked. The worker sends back what this panel shows (findings, lap, jumps, arcs, the
// load graph), not the per-station colour map: in that mode 't180:validation' carries map null and levelAt / rgbaAt read the red and amber
// RANGES at s (colour.js rangeLevel), and its path is the preview's. With no Worker (headless tests) or one that cannot take the document,
// the check runs here as before.
'use strict';
const { createValidationController, summary } = require('./panel.js');
const { levelAt, rgbaAt, rangeLevel, PALETTE, LEVEL } = require('./colour.js');
const { createCheckRunner } = require('./checkrunner.js');
const { graphModel, drawGraph } = require('./graph.js');
const { lapText, lapWhereText, findingLine } = require('./labels.js');
const S = require('../settings.js');   // D355: the CSP box is the saved setting `csp`

const css = (rgba) => `rgb(${Math.round(rgba[0] * 255)}, ${Math.round(rgba[1] * 255)}, ${Math.round(rgba[2] * 255)})`;
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

function mount(root, shell) {
  const head = el('div', { className: 'v-summary' });
  const csp = el('input', { type: 'checkbox', checked: S.get('csp', true) !== false });   // D355: the saved setting (on when nothing is saved, as before)
  const graph = el('canvas', { width: 480, height: 96, className: 'v-graph', style: 'width: 100%; height: 96px;' });
  const list = el('ul', { className: 'v-list' });
  root.append(el('label', {}, [csp, ' CSP (wall raycasting)']), head, graph, list);

  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
  function render(state) {
    const s = summary(state);
    head.textContent = state.error ? `not validated: ${state.error}`
      : state.checking && !state.result ? 'checking…'
      : `${s.red} red · ${s.amber} amber${s.lap && s.lap.reason === 'open' && s.lap.ok !== true && s.lap.ok !== false ? '' : ` · ${lapText(s.lap)}`} · ${s.jumps} jump${s.jumps === 1 ? '' : 's'}${s.jumpsPending ? ` (${s.jumpsPending} waiting for ${s.jumpsPending === 1 ? 'its landing' : 'their landings'})` : ''}${s.pendingFrom != null ? ` · checked to ${Math.round(s.pendingFrom)} m, the rest when the drag ends` : ''}${state.checking ? ' · checking…' : ''}`;
    head.style.color = state.error ? css(PALETTE[LEVEL.RED]) : '';
    const gm = 'graph' in state ? state.graph : graphModel(state);   // the worker sends its graph ready-made
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
      // D256: "holds above N km/h" (information): where the centreline faces the ground, the slowest speed that keeps the car on it
      for (const x of r.info) if (x.reason === 'holds-above') { const f = findingLine('info', x); list.append(el('li', { textContent: f.text, title: f.title, style: `color: ${css(PALETTE[LEVEL.INFO])}` })); }
      if (r.lap && r.lap.ok === false) for (const w of r.lap.where) list.append(el('li', { textContent: `lap: ${lapWhereText(w)}, at ${w.s.toFixed(0)} m`, title: w.reason, style: `color: ${css(PALETTE[LEVEL.RED])}` }));
    }
    for (const j of state.arcs) {
      const legs = j.arcs.map((a) => `${a.g} g ${a.caught ? `lands at ${a.touchdown.x.toFixed(1)} m` : a.clear ? 'clears, no touchdown found' : `falls short (needs ${(a.minSpeed * 3.6).toFixed(0)} km/h)`}`);
      list.append(el('li', { textContent: `jump at s ${j.s.toFixed(0)} m${j.speed ? `, ${(j.speed * 3.6).toFixed(0)} km/h` : ', drawn at each landing\'s minimum speed'}: ${legs.join('; ')}` }));
    }
    const map = state.map || null, res = state.result;
    const byRange = (s) => (res ? rangeLevel(res, s) : LEVEL.CLEAR);   // the worker's answer has no map: the red and amber ranges at s
    root.dispatchEvent(new CustomEvent('t180:validation', { bubbles: true, detail: {
      path: state.path, result: state.result, map, arcs: state.arcs,
      levelAt: (s, u) => (map ? levelAt(map, s, u) : byRange(s)), rgbaAt: (s, u) => (map ? rgbaAt(map, s, u) : PALETTE[byRange(s)]),
    } }));
  }
  const trackPath = () => { let got = null; document.dispatchEvent(new CustomEvent('t180:track-request', { detail: { reply: (x) => { got = x; } } })); return got && got.path ? got.path : null; };
  const worker = mountWorker();
  if (worker) return worker;
  let ctl = null;
  // D256: there is no design-speed slider any more; the controller checks at full speed (panel.js). The slider it replaced never sized the
  // equation core's jump ramps either, whatever D179 said here: src/core/adapter.js toSegments sizes them at MACH6.designSpeedKmh, 460 km/h
  // ONE PATH (D177): the preview's path, asked for through C's seam ('t180:track-request', { reply(track) }, answered
  // with { path, segments, closed, how, g, fromS }: app/preview/index.js); with no answer, or a path for another
  // document, the controller grows its own
  const sharedPath = () => { let got = null; document.dispatchEvent(new CustomEvent('t180:track-request', { detail: { reply: (x) => { got = x; } } })); return got; };
  ctl = createValidationController(shell, { csp: csp.checked, onUpdate: render, schedule: raf, sharedPath });   // D355: from the saved setting
  csp.onchange = () => ctl.setCsp(csp.checked);
  const offCsp = followCsp();
  return { dispose: () => { offCsp(); ctl.dispose(); } };

  /** D355: the box and the saved setting follow each other: a click saves it; a change in Settings ticks the box and runs its own handler (a re-check), as a click would. */
  function followCsp() {
    const save = () => S.set('csp', csp.checked);
    csp.addEventListener('change', save);
    const off = S.on('csp', (v) => { if (csp.checked === v) return; csp.checked = v; if (csp.onchange) csp.onchange(); });
    return () => { off(); if (csp.removeEventListener) csp.removeEventListener('change', save); };
  }

  /** The check in a Web Worker, or null when the page cannot make one (then the controller above runs here). */
  function mountWorker() {
    const WorkerCtor = typeof Worker === 'function' ? Worker : null;
    if (!WorkerCtor) return null;
    let last = null, runner = null, broken = false, frame = 0, sentDoc = null, sentDrag = null, unsub = null;
    const jobs = new Map();   // serial -> the document, CSP and drag it was sent with (D343)
    const show = (st) => { last = st; render(st); };
    try {
      runner = createCheckRunner({
        WorkerCtor,
        onAnswer: (out, { serial, pending }) => {
          // D343: a finished answer (no drag, nothing deferred) is the open track's reds for that document: the shell keeps them for a Close press on it
          const job = jobs.get(serial); for (const k of [...jobs.keys()]) if (k <= serial) jobs.delete(k);   // older answers are dropped by the runner: their entries go too
          if (job && !job.dragging && out && !out.error && out.result && out.result.pendingFrom == null && typeof shell.noteCheck === 'function') shell.noteCheck(job.doc, { csp: job.csp, red: out.result.red });
          show({ ...out, path: trackPath(), map: null, checking: pending });
        },
        onFail: (message) => show({ ...(last || { result: null, arcs: [], graph: null }), error: message, checking: false }),
      });
    } catch (e) { return null; }
    const send = (force) => {
      frame = 0;
      const st = shell.getState(), d = st.history.present, drag = !!st.history.dragBase;
      if (!force && d === sentDoc && drag === sentDrag) return;
      try { const serial = runner.send({ doc: d, dragging: drag, csp: csp.checked }); jobs.set(serial, { doc: d, csp: csp.checked, dragging: drag }); } catch (e) { broken = true; return fallBack(); }   // a document the worker cannot take: check here
      sentDoc = d; sentDrag = drag;
      show({ ...(last || { result: null, arcs: [], graph: null, error: null }), checking: true });
    };
    const later = () => { if (!frame && !broken) frame = raf(() => send(false)); };
    unsub = shell.subscribe(later);
    csp.onchange = () => send(true);
    const offCsp = followCsp();
    send(true);
    let fallen = null;
    function fallBack() {
      if (unsub) unsub(); runner.dispose();
      const ask = () => { let got = null; document.dispatchEvent(new CustomEvent('t180:track-request', { detail: { reply: (x) => { got = x; } } })); return got; };   // the controller's shared path, as below
      fallen = createValidationController(shell, { csp: csp.checked, onUpdate: render, schedule: raf, sharedPath: ask });
      csp.onchange = () => fallen.setCsp(csp.checked);
    }
    return { dispose: () => { offCsp(); if (unsub) unsub(); runner.dispose(); if (fallen) fallen.dispose(); } };
  }
}

module.exports = { mount };
