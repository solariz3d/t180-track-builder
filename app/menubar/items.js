// items.js: what File, Edit, View and Settings hold (D355 part 1), as contract M entries (app/menubar/menubar.js). The page's own controls keep their ids and
// their wiring and are moved in as they are ({ node }); the parts' entries (C's Edit selection, A's File ▸ Developer) are passed in and placed under a heading.
//
//   fileItems(ctx, { developer })        the slot under File's own controls: Developer ▸ (A's trackmenu.developerItems: Open example…) when there is any
//   editItems(ctx, { selection })        Undo, Redo, then the selection's entries (C's piecesui.items, which bring their own Selection heading), when there are any
//   viewItems(ctx)                       Drag handles and Colour by grip (saved settings), Show the guide
//   settingsItems(ctx, { soundRow, acFolder, acAllow })   sound, the theme (D394), how the turn and climb are read, the grid step, mirror on insert, the checker's wall
//                                        raycasting, the Assetto Corsa folder and launch permission, Reset the guide
//   authorName(settings)                 D365: the saved author name, trimmed, at most 64 characters; '' for none (then the export writes t180-track-builder)
//   authorField(doc, settings)           D365: Settings ▸ Author name, a text field that saves what is typed (trimmed, at most 64)
//   acNodes(container)                   the Assetto Corsa folder button and the launch-permission tick that app/install/index.js put in `container`
//   DEFAULTS                             each saved setting's value when none is saved: today's defaults in app/core/panel.js, piecesui.js and validate-ui
'use strict';

const DEFAULTS = Object.freeze({ turnClimbAs: 'corner', dragHandles: true, colourByGrip: false, gridStep: 90, mirrorOnInsert: false, csp: true, theme: 'music' });
const val = (ctx, key) => ctx.settings.get(key, DEFAULTS[key]);
const tick = (label, key, title) => ({ label, title, checked: (ctx) => val(ctx, key) === true, toggle: (on, ctx) => ctx.settings.set(key, on) });
/** a choice of one, as ticks: picking one sets it; unticking the one that is set keeps it (the menu is rebuilt and shows it ticked again) */
const choice = (key, options) => options.map(([value, label, title]) => ({ label, title, checked: (ctx) => val(ctx, key) === value, toggle: (on, ctx) => { if (on) ctx.settings.set(key, value); } }));

function fileItems(ctx, { developer = [] } = {}) {
  return developer.length ? [{ separator: true }, { section: 'Developer' }, ...developer] : [];
}

function editItems(ctx, { selection = [] } = {}) {
  return [
    { label: 'Undo', title: 'Ctrl+Z', run: (c) => c.shell.undo() },
    { label: 'Redo', title: 'Ctrl+Y or Ctrl+Shift+Z', run: (c) => c.shell.redo() },
    ...(selection.length ? [{ separator: true }, ...selection] : []),
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

const MAX_AUTHOR = 64;   // src/export/fromwords.js MAX_AUTHOR
function authorName(settings) {
  let v;
  try { v = settings.get('author', ''); } catch (e) { return ''; }   // a settings object that fails gives no name: the export writes today's author
  return typeof v === 'string' ? v.trim().slice(0, MAX_AUTHOR) : '';
}
function authorField(doc, settings) {
  const label = doc.createElement('label'), span = doc.createElement('span'), input = doc.createElement('input');
  label.className = 'author-row'; span.textContent = 'Author name';
  label.title = "the name written as the track's author in Assetto Corsa and Content Manager; blank writes t180-track-builder. The builder is credited either way";
  input.type = 'text'; input.maxLength = MAX_AUTHOR; input.placeholder = 't180-track-builder'; input.value = authorName(settings);
  input.setAttribute('aria-label', 'author name');
  input.onchange = () => { input.value = String(input.value || '').trim().slice(0, MAX_AUTHOR); settings.set('author', input.value); };
  label.appendChild(span); label.appendChild(input);
  return label;
}

function settingsItems(ctx, { soundRow = null, acFolder = null, acAllow = null, authorRow = null } = {}) {
  return [
    { section: 'Sound' }, ...(soundRow ? [{ node: soundRow }] : []),
    // D394: each theme is a look with its own melody; the look changes at once and the melody as soon as its two files are in (app/index.html, app/sound.js).
    // D401: the first is Random (it was called Music; it is still saved as music, so a setting saved before reads the same)
    // A click on Random while it is ticked unticks its box (toggle false) and the saved value does not change, so no listener runs: it asks for a new pick
    // itself (ctx.repickTheme, app/index.html), so the click picks a look on a fresh start too (A's read of D401, §8). Only when music was already SAVED: with nothing saved
    // (a fresh install) settings.set is a change, undefined to music, and its listener picks already; asking again picked twice, and 1 time in 3 came back to the start look
    { section: 'Theme' }, ...choice('theme', [['music', 'Random', 'a look and its own melody, picked at random each start, and picked again when you choose this'],
      ...[['aqua', 'Aqua'], ['skyline', 'Skyline'], ['glass', 'Glass'], ['aurora', 'Aurora']].map(([v, l]) => [v, l, `${l}'s look and its own melody, every start; the melody changes a moment after the look, once its files are in`])
        .flatMap((it) => (it[0] === 'skyline' ? [it, ['skyline-night', 'Skyline Night', 'Skyline at night: navy glass, a city glow on the horizon and a few stars, with Skyline\'s melody']] : [it])),   // D405
      ['sigil', 'SIGIL', 'the black-and-bone look; it has no melody of its own, so the melody is still picked at random each start']])
      .map((it, i) => (i === 0 ? { ...it, toggle: (on, c) => { const was = c.settings.get('theme', undefined); c.settings.set('theme', 'music'); if (was === 'music' && typeof c.repickTheme === 'function') c.repickTheme(); } } : it)),
    { section: 'Turn & climb read as' }, ...choice('turnClimbAs', [['corner', 'corner °, ends straight'], ['rate', 'rate °/100 m']]),
    { section: 'Grid step (Turn to grid)' }, ...choice('gridStep', [[90, '90°'], [45, '45°'], [15, '15°']]),
    { section: 'Pieces' }, tick('Mirror on insert', 'mirrorOnInsert', 'add saved pieces as their left/right mirror image'),
    { section: 'Checker' }, tick('Wall raycasting (CSP)', 'csp', 'the checker\'s wall raycasting'),
    ...(acFolder || acAllow || authorRow ? [{ section: 'Assetto Corsa' }, ...(authorRow ? [{ node: authorRow }] : []), ...(acFolder ? [{ node: acFolder }] : []), ...(acAllow ? [{ node: acAllow }] : [])] : []),
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

module.exports = { fileItems, editItems, viewItems, settingsItems, acNodes, authorName, authorField, DEFAULTS };
