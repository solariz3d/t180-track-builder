// items.js: what File, Edit, View and Settings hold (D355 part 1), as contract M entries (app/menubar/menubar.js). The page's own controls keep their ids and
// their wiring and are moved in as they are ({ node }); the parts' entries (C's Edit selection, A's File ▸ Developer) are passed in and placed under a heading.
//
//   fileItems(ctx, { developer })        the slot under File's own controls: Developer ▸ (A's Open example…) when there is any
//   editItems(ctx, { selection })        Undo, Redo, then the selection's entries (C's), when there are any
//   viewItems(ctx)                       Drag handles and Colour by grip (saved settings), Show the guide
//   settingsItems(ctx, { soundRow, acFolder, acAllow })   sound, how the turn and climb are read, the grid step, mirror on insert, the checker's wall
//                                        raycasting, the Assetto Corsa folder and launch permission, Reset the guide
//   acNodes(container)                   the Assetto Corsa folder button and the launch-permission tick that app/install/index.js put in `container`
//   DEFAULTS                             each saved setting's value when none is saved: today's defaults in app/core/panel.js, piecesui.js and validate-ui
'use strict';

const DEFAULTS = Object.freeze({ turnClimbAs: 'corner', dragHandles: true, colourByGrip: false, gridStep: 90, mirrorOnInsert: false, csp: true });
const val = (ctx, key) => ctx.settings.get(key, DEFAULTS[key]);
const tick = (label, key, title) => ({ label, title, checked: (ctx) => val(ctx, key) === true, toggle: (on, ctx) => ctx.settings.set(key, on) });
/** a choice of one, as ticks: picking one sets it; unticking the one that is set keeps it (the menu is rebuilt and shows it ticked again) */
const choice = (key, options) => options.map(([value, label]) => ({ label, checked: (ctx) => val(ctx, key) === value, toggle: (on, ctx) => { if (on) ctx.settings.set(key, value); } }));

function fileItems(ctx, { developer = [] } = {}) {
  return developer.length ? [{ separator: true }, { section: 'Developer' }, ...developer] : [];
}

function editItems(ctx, { selection = [] } = {}) {
  return [
    { label: 'Undo', title: 'Ctrl+Z', run: (c) => c.shell.undo() },
    { label: 'Redo', title: 'Ctrl+Y or Ctrl+Shift+Z', run: (c) => c.shell.redo() },
    ...(selection.length ? [{ separator: true }, { section: 'Selection' }, ...selection] : []),
  ];
}

function viewItems() {
  return [
    tick('Drag handles', 'dragHandles', 'marks on the ghost of the next piece (and on a sculpted piece) that you drag to change a value'),
    tick('Colour by grip', 'colourByGrip', 'the track coloured blue below 100% grip, white at 100%, orange above'),
    { separator: true },
    { label: 'Show the guide', title: 'the six-step first track', run: (c) => { const b = c.doc.querySelector('#guide .guide-open'); if (b) b.click(); } },
  ];
}

function settingsItems(ctx, { soundRow = null, acFolder = null, acAllow = null } = {}) {
  return [
    { section: 'Sound' }, ...(soundRow ? [{ node: soundRow }] : []),
    { section: 'Turn & climb read as' }, ...choice('turnClimbAs', [['corner', 'corner °, ends straight'], ['rate', 'rate °/100 m']]),
    { section: 'Grid step (Turn to grid)' }, ...choice('gridStep', [[90, '90°'], [45, '45°'], [15, '15°']]),
    { section: 'Pieces' }, tick('Mirror on insert', 'mirrorOnInsert', 'add saved pieces as their left/right mirror image'),
    { section: 'Checker' }, tick('Wall raycasting (CSP)', 'csp', 'the checker\'s wall raycasting'),
    ...(acFolder || acAllow ? [{ section: 'Assetto Corsa' }, ...(acFolder ? [{ node: acFolder }] : []), ...(acAllow ? [{ node: acAllow }] : [])] : []),
    { separator: true },
    { label: 'Reset the guide', title: 'the guide opens by itself again at the next start', run: (c) => c.resetGuide() },
  ];
}

function acNodes(container) {
  if (!container || !container.children) return { acFolder: null, acAllow: null };
  const kids = [...container.children];
  return {
    acFolder: kids.find((e) => e.tagName === 'BUTTON' && /^Assetto Corsa folder/.test(e.textContent)) || null,
    acAllow: kids.find((e) => e.tagName === 'LABEL' && e.querySelector && e.querySelector('input[type="checkbox"]')) || null,
  };
}

module.exports = { fileItems, editItems, viewItems, settingsItems, acNodes, DEFAULTS };
