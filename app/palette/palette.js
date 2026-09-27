// palette.js: the build palette at the open end. paletteModel(state, pickers) says what to show; renderPalette(root,
// model, on) draws it. The model is pure and tested headless (app/test/palette.test.js); the DOM half runs only in the
// webview.
//
// Like a coaster builder (the keeper, 12:20): the user picks the next piece, and a font, a tempo and a direction for it,
// at the head, and places it. The palette shows the built-in words first, then the user's own saved pieces; below it
// is the track as a list of placed words, where a click (shift-click for a run) selects words to save as a new piece.
'use strict';

const { palette } = require('../../src/doc/library.js');

function paletteModel(state, pickers) {
  const items = palette(state.lib), h = state.history, doc = h.present;
  const last = doc.words[doc.words.length - 1];
  const sel = new Set(state.selection || []);
  const pick = (k) => ({ options: pickers[k].slice(), value: state.pickers[k] });
  return {
    groups: [
      { title: 'Words', items: items.filter((p) => p.builtin) },
      { title: 'My pieces', items: items.filter((p) => !p.builtin) },
    ],
    pickers: { font: pick('font'), tempo: pick('tempo'), dir: pick('dir') },
    can: { undo: h.past.length > 0 && !h.dragBase, redo: h.future.length > 0 && !h.dragBase, saveSelection: sel.size > 0, removeHead: doc.words.length > 0 },
    head: last ? { id: last.id, word: last.phrase !== undefined ? last.phrase : last.word } : null,
    track: doc.words.map((w) => ({ id: w.id, word: w.phrase !== undefined ? w.phrase : w.word, phrase: w.phrase !== undefined, selected: sel.has(w.id) })),
    message: state.message, resolveError: state.resolveError,
  };
}

/* ---------------------------------------------------------------------------------------------- the DOM half */
const LABEL = { font: 'Font', tempo: 'Tempo', dir: 'Turn' };
const OPTION_TEXT = { dir: { L: 'left', R: 'right' }, font: { auto: 'the word’s own' } };

function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'text') e.textContent = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids) if (c) e.append(c);
  return e;
}

/**
 * Draw the palette into `root`. `on` holds the shell's actions: { place(name), setPicker(k, v), undo(), redo(),
 * removeHead(), select(from, to), saveSelection() }. The whole panel is redrawn per state change; it is small.
 */
function renderPalette(root, model, on) {
  let anchor = null;
  const pickerRow = Object.entries(model.pickers).map(([k, p]) => el('label', { class: 'picker' }, [
    el('span', { text: LABEL[k] }),
    el('select', { 'aria-label': LABEL[k], on: { change: (e) => on.setPicker(k, e.target.value) } },
      p.options.map((o) => el('option', { value: o, selected: o === p.value, text: (OPTION_TEXT[k] && OPTION_TEXT[k][o]) || o }))),
  ]));
  const groups = model.groups.map((g) => el('section', { class: 'group' }, [
    el('h3', { text: g.title }),
    g.items.length
      ? el('div', { class: 'pieces' }, g.items.map((p) => el('button', {
        class: `piece ${p.builtin ? 'builtin' : 'mine'}`, title: p.kind === 'phrase' ? p.words.join(' → ') : p.words[0],
        on: { click: () => on.place(p.name) }, text: p.name,
      })))
      : el('p', { class: 'empty', text: 'Nothing saved yet. Select placed words below and save them as your own piece.' }),
  ]));
  const actions = el('div', { class: 'actions' }, [
    el('button', { disabled: !model.can.undo, on: { click: on.undo }, text: 'Undo', title: 'Ctrl+Z' }),
    el('button', { disabled: !model.can.redo, on: { click: on.redo }, text: 'Redo', title: 'Ctrl+Y' }),
    el('button', { disabled: !model.can.removeHead, on: { click: on.removeHead }, text: 'Remove head', title: 'Backspace' }),
  ]);
  const track = el('ol', { class: 'track' }, model.track.map((t) => el('li', {
    class: `${t.selected ? 'selected' : ''} ${t.phrase ? 'phrase' : ''}`.trim(), 'data-id': t.id,
    on: { click: (e) => { if (e.shiftKey && anchor) on.select(anchor, t.id); else { anchor = t.id; on.select(t.id, t.id); } } }, text: `${t.id}  ${t.word}`,
  })));
  const save = el('div', { class: 'save-piece' }, [
    el('input', { id: 'piece-name', placeholder: 'name for the selection', 'aria-label': 'piece name' }),
    el('button', { disabled: !model.can.saveSelection, on: { click: () => on.saveSelection(root.querySelector('#piece-name').value) }, text: 'Save selection as my piece' }),
  ]);
  root.replaceChildren(
    el('div', { class: 'head', text: model.head ? `Building on from ${model.head.id} (${model.head.word})` : 'Empty track: place the first piece' }),
    el('div', { class: 'pickers' }, pickerRow), ...groups, actions,
    el('h3', { text: 'The track' }), track, save,
    model.message ? el('p', { class: 'message', role: 'alert', text: model.message }) : null,
    model.resolveError ? el('p', { class: 'message', role: 'alert', text: model.resolveError }) : null,
  );
}

module.exports = { paletteModel, renderPalette };
