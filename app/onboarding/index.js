// index.js: the guided first track, mounted as mount(root, shell) like every panel (app/README.md, "The seam").
// PROPOSED MOUNT POINT FOR A (app/index.html): `<div id="guide" style="position: absolute; inset: 0; pointer-events:
// none; z-index: 5;"></div>` in <main id="stage">, and ['onboarding', 'guide'] in the page's list of panels (the D177
// hand-back has the exact diff).
//
// A small card over the stage, never a modal: the step's title, what to do and why, "2 of 6", and Back / Skip (or Next,
// on the reading step) / ✕. The part of the window a step is about is outlined. Doing the move advances the guide by
// itself (guide.js observe); the user can close it at any step, and the app is the same with it closed. On FIRST RUN
// (firstrun.js) it opens; after that it stays closed behind a "Show the guide" button. D239: the steps are the equation
// builder's, and the piece builder's first-run defaults (its font and tempo pickers, the starter phrase) went with it.
'use strict';
const { STEPS, createGuide } = require('./guide.js');
const { firstRun, webStore } = require('./firstrun.js');

// THE PLACE ON SCREEN (fixed after the D177 window pass: the first card was a 75 px column over the camera bar). The
// mount point is a layer over the stage that lets clicks through (A's page: `inset: 0; pointer-events: none`); the card
// takes its own clicks, has a fixed width, and sits TOP-RIGHT in the stage: clear of the palette on the left and of the
// camera bar and its key hints along the bottom.
const CSS = `
.guide-card { position: absolute; right: 12px; top: 12px; z-index: 5; width: 340px; max-width: calc(100% - 24px); box-sizing: border-box;
  padding: 10px 12px; border-radius: 8px; pointer-events: auto;
  background: rgba(20, 22, 28, 0.94); color: #e8eaee; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 4px 18px rgba(0,0,0,.45); }
.guide-card h3 { margin: 0 0 4px; font-size: 14px; } .guide-card p { margin: 0 0 8px; }
.guide-card .guide-count { float: right; opacity: .6; font-size: 12px; }
.guide-card .guide-row { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.guide-card button { font: inherit; padding: 3px 10px; }
.guide-open { position: absolute; right: 12px; top: 12px; z-index: 5; pointer-events: auto; }
.guide-target { outline: 2px solid #ffb31a !important; outline-offset: -2px; }`;

const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

function mount(root, shell, { store = webStore(typeof window !== 'undefined' ? window : null), doc = typeof document !== 'undefined' ? document : null } = {}) {
  const fr = firstRun(store);
  let guide = null, unsubscribe = null, outlined = null;
  root.append(el('style', { textContent: CSS }));
  const holder = el('div');
  root.append(holder);

  const outline = (sel) => {
    if (outlined) outlined.classList.remove('guide-target');
    outlined = sel && doc ? doc.querySelector(sel) : null;
    if (outlined) outlined.classList.add('guide-target');
  };
  const close = (how) => {
    fr.remember(how); outline(null);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    guide = null; render();
  };
  function render() {
    holder.replaceChildren();
    if (!guide) { holder.append(el('button', { className: 'guide-open', textContent: 'Show the guide', title: 'A six-step first track: extend, brush, close, read the colours, export, the grid and mirror', onclick: start })); return; }
    const g = guide.state;
    if (g.status === 'finished') { close(Object.keys(g.skipped).length ? 'skipped' : 'finished'); return; }
    const s = g.step, reading = !s.done;
    outline(s.target);
    holder.append(el('div', { className: 'guide-card', role: 'dialog', ariaLabel: 'first track guide' }, [
      el('span', { className: 'guide-count', textContent: `${g.index + 1} of ${STEPS.length}` }),
      el('h3', { textContent: s.title }), el('p', { textContent: s.text }),
      el('div', { className: 'guide-row' }, [
        el('button', { textContent: 'Back', disabled: g.index === 0, onclick: () => { guide.back(); render(); } }),
        reading ? el('button', { textContent: 'Next', onclick: () => { guide.next(); render(); } })
          : el('button', { textContent: 'Skip', title: 'Move on without doing this step', onclick: () => { guide.skip(); render(); } }),
        el('button', { textContent: '✕', title: 'Close the guide (it will not open by itself again)', onclick: () => close(Object.values(guide.state.done).length === STEPS.length ? 'finished' : 'skipped') }),
      ]),
    ]));
  }
  function start() {
    guide = createGuide();
    unsubscribe = shell.subscribe((st) => { const before = guide && guide.state.index; if (!guide) return; const after = guide.observe(st); if (after.index !== before || after.status !== 'active') render(); });
    guide.observe(shell.getState());
    render();
  }

  if (fr.isFirst()) start(); else render();
  return { dispose: () => { if (unsubscribe) unsubscribe(); outline(null); } };
}

module.exports = { mount };
