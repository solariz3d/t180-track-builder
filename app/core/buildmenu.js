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

// D421 part 3 (design §5, the user's call 4): SCULPT MODE is the first item, a tick, since a Build | Sculpt switch in the top bar does not fit (app/test/menubar-page.test.js
// rows 8 and 17 measured it: 87 px over at 900 px, 16 px at 1400; the plan's fallback). It sets the shell's st.sculpt and nothing else (mid-drag the shell refuses: "finish
// the brush drag first"); Tab does the same. It replaced the "Brush" toggle that stood before Close the loop. IN SCULPT every command that places or closes is disabled,
// its reason "in Sculpt" in the tooltip.
const IN_SCULPT = 'in Sculpt';
function items(ctx) {
  const b = ask(ctx);
  if (!b) return [];
  const s = !!b.sculpt, off = s ? { disabled: true, title: IN_SCULPT } : {};
  return [
    { label: 'Sculpt mode', checked: s, toggle: (on) => b.setSculpt(on), title: 'Sculpt: reshape the road you have placed, with the tools in the strip under the bar (Tab switches too)' },
    { separator: true },
    { label: 'Straight', run: b.straight, ...off },
    { label: 'Level', run: b.level, ...off },
    { label: 'To floor', run: b.toFloor, ...off },
    { separator: true },
    { label: 'Turn by…', panel: (box) => b.lend('turnBy', box), ...off },
    { label: 'Turn to grid…', panel: (box) => b.lend('grid', box), ...off },
    { label: 'Sharp corner…', panel: (box) => b.lend('sharp', box), ...off },
    { separator: true },
    { label: 'Jump', run: b.jump, disabled: b.closed, ...off },
    { separator: true },
    { label: 'Close the loop', run: b.close, disabled: !b.canClose, ...off },
  ];
}

module.exports = { items };
