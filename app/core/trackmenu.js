// trackmenu.js: THE TRACK MENU's items (D355, the user: the controls that were on the left move into drop-down menus along the top right, "the same
// aesthetic as we have it now"). The menu bar (app/menubar/) renders what a menu module's items(ctx) returns (contract M: { label, run }, { label, checked,
// toggle }, { label, panel: mountFn }, { section }, { separator }); this module is the Track side of it.
//
//   items(ctx)           the Track menu: Start & grid…, Pit lane…, Road surface ▸ (each a panel holding the same controls the left column held), then
//                        Smooth ramps (D465: a command, the shell's smoothRamps, which says what it did in the status line), and Bank the lap (D473: a
//                        command, the shell's bankLap, enabled on a closed lap only)
//   developerItems(ctx)  File ▸ Developer: Open example… (the "Local example" section, a real track's fit and read from the user's own reads folder)
//   ctx = { shell, document, window }   (el is optional: the bar may pass its own element maker; else the page's own is used)
//
// A PANEL's mount function is mountFn(host) -> { unmount() }: it puts the controls into `host` and returns a handle; unmount() takes them out again.
// Start & grid and Pit lane are made fresh each time they open (their own section code, app/core/spawnsui.js and pitui.js, unchanged) and stop
// following the shell when they close. Road surface is different: the controller (app/core/textures.js) must be ALIVE from the start, because the preview draws
// the asphalt and the export writes it from what it announces ('t180:textures') whether or not anyone opened the panel. So it is made once per shell, on the
// first items() call, inside a hidden holder in the page (the event leaves from an element in the page), and opening the panel moves its controls into the
// host; closing moves them back. Nothing here edits a document: every action is the shell's.
'use strict';
const SU = require('./spawnsui.js');
const PIT = require('./pitui.js');
const TX = require('./textures.js');

/** What every entry needs from the context, or a loud refusal that says what is missing. */
function page(ctx, who) {
  if (!ctx || !ctx.shell) throw new Error(`trackmenu ${who}: the context has no shell`);
  const doc = ctx.document || (ctx.window && ctx.window.document);
  if (!doc || typeof doc.createElement !== 'function') throw new Error(`trackmenu ${who}: the context has no page (document)`);
  const win = ctx.window || doc.defaultView;
  const el = ctx.el || ((tag, attrs = {}, ...kids) => { const e = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); } e.append(...kids); return e; });
  return { shell: ctx.shell, doc, win, el };
}

/** A panel made of a section module's nodes: made when it opens, following the shell until it closes. */
const sectionPanel = (mod, c) => (host) => {
  const m = mod.mount({ shell: c.shell, el: c.el, win: c.win });
  host.append(...m.nodes);
  return { unmount() { m.unmount(); for (const n of m.nodes) n.remove(); } };
};

const surfaces = new WeakMap();   // shell -> { holder, root }: one road-surface controller for a shell, however often the menu is built
function surfaceOf(c) {
  let s = surfaces.get(c.shell);
  if (s) return s;
  if (!c.doc.body) throw new Error('trackmenu: the page has no body to hold the road surface controller');
  const holder = c.doc.createElement('div'); holder.setAttribute('hidden', ''); c.doc.body.append(holder);
  const root = c.doc.createElement('section'); holder.append(root);
  TX.mount(root, c.shell);
  s = { holder, root }; surfaces.set(c.shell, s);
  return s;
}
const surfacePanel = (c) => (host) => {
  const { holder, root } = surfaceOf(c);
  host.append(root);
  return { unmount() { holder.append(root); } };
};

/** The Track menu. */
function items(ctx) {
  const c = page(ctx, 'items');
  surfaceOf(c);   // alive from the first call, panel opened or not
  const closed = !!c.shell.getState().history.present.closed;   // read each time the menu opens (the bar calls items(ctx) then)
  return [
    { label: 'Start & grid…', panel: sectionPanel(SU, c) },
    { label: 'Pit lane…', panel: sectionPanel(PIT, c) },
    { label: 'Road surface ▸', panel: surfacePanel(c) },
    { separator: true },
    { label: 'Smooth ramps', title: 'make every bank, cup and edge change on this track start and end without a jolt, as new pieces do; the route stays where it is (the track is copied to its backups first; one undo step)', run: () => { void c.shell.smoothRamps(); } },
    { label: 'Bank the lap', title: closed ? 'bank every upright curve of this closed lap into its turn, as closing a loop does; the route stays where it is (one undo step)' : 'close the loop first: only a closed lap can be banked', disabled: !closed, run: () => { void c.shell.bankLap(); } },
  ];
}

/** File ▸ Developer: the local example (a real track's D184 fit and its read; never in the program). */
function developerItems(ctx) {
  const c = page(ctx, 'developerItems'), { shell, el } = c;
  const field = (label, input) => el('label', { class: 'picker' }, el('span', { text: label }), input);
  const readText = (inp) => (inp.files && inp.files[0] ? inp.files[0].text() : Promise.reject(new Error('pick both files')));
  return [{
    label: 'Open example…',
    panel(host) {
      const fitIn = el('input', { type: 'file', accept: '.json', 'aria-label': 'the fit, *.pieces.json', style: 'max-width: 100%; min-width: 0' });
      const readIn = el('input', { type: 'file', accept: '.json', 'aria-label': 'the read, *.read.json', style: 'max-width: 100%; min-width: 0' });
      const msg = el('p', { class: 'message', role: 'status' });
      const openEx = el('button', { text: 'Open example', onclick: async () => {
        try { const [f, r] = await Promise.all([readText(fitIn), readText(readIn)]); shell.openExample(f, r, fitIn.files[0].name.replace(/\.pieces\.json$/i, '') + ' (local)'); }
        catch (e) { msg.textContent = e.message; msg.className = 'message'; }
      } });
      const nodes = [el('h3', { text: 'Local example' }), el('div', { class: 'pickers' }, field('fit', fitIn), field('read', readIn)), el('div', { class: 'actions' }, openEx), msg];
      host.append(...nodes);
      return { unmount() { for (const n of nodes) n.remove(); } };
    },
  }];
}

module.exports = { items, developerItems };
