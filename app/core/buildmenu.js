// buildmenu.js: the BUILD menu's items (D355 part 2, pane C), for the top-right bar (pane B's app/menubar/), in contract M's shapes:
//   { label, run }   { label, checked, toggle }   { label, panel: mountFn }   { section }   { separator }
// The commands are the core panel's own (app/core/panel.js): the bar asks the mounted panel for them with the 't180:build-request' event, the way the panel already
// asks the preview ('t180:ghost-request', 't180:track-request'), because the bar and the panel are loaded apart (app/lib/cjs.js gives each load its own modules).
// No panel mounted: no items (an empty menu, never a dead command).
//   items(ctx): ctx.doc (or ctx.document) is the page's document; without one, the global document.
// A popover item's mountFn(container) moves today's fields and button into the container and returns the function that puts them back in the panel.
// `disabled: true` on an entry (Close the loop on a closed loop, or with no road yet) is extra to contract M: a bar that ignores it still gets a run that does nothing.
'use strict';

/** The mounted panel's Build commands, or null. */
function ask(ctx = {}) {
  const doc = ctx.doc || ctx.document || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.dispatchEvent !== 'function') return null;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  const Ev = win && win.CustomEvent ? win.CustomEvent : (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
  if (!Ev) return null;
  let got = null;
  doc.dispatchEvent(new Ev('t180:build-request', { detail: { reply: (b) => { got = b; } } }));
  return got;
}

function items(ctx) {
  const b = ask(ctx);
  if (!b) return [];
  return [
    { label: 'Straight', run: b.straight },
    { label: 'Level', run: b.level },
    { label: 'To floor', run: b.toFloor },
    { separator: true },
    { label: 'Turn by…', panel: (box) => b.lend('turnBy', box) },
    { label: 'Turn to grid…', panel: (box) => b.lend('grid', box) },
    { label: 'Sharp corner…', panel: (box) => b.lend('sharp', box) },
    { separator: true },
    { label: 'Jump', run: b.jump, disabled: b.closed },
    { label: 'Brush', checked: b.brushOn, toggle: b.toggleBrush },
    { separator: true },
    { label: 'Close the loop', run: b.close, disabled: !b.canClose },
  ];
}

module.exports = { items };
