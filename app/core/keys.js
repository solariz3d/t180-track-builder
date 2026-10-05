// keys.js: the app's keys, MOVED here from app/shell.js as they were (D239 note, the keeper's undo request: removing the Pieces mode
// must not remove its keys). The equation page binds them to the core shell (app/index.html); app/shell.js re-exports keyAction so its
// own tests and drivers are unchanged. D242 item 8a (below): undo and redo now work inside a field too; the History list (8b) waits
// for D240 (plan_t180_safe_close_reds_2026-10-04.md item 8).
'use strict';

/**
 * The app's keys, from a key event to an action name (or null). Pure, so it is tested headless; app/index.html calls it.
 * REMOVING THE HEAD TAKES Ctrl+Backspace (or Cmd+Backspace). A bare Backspace does nothing: it is the key most often hit
 * by accident, and a confirm step would interrupt every deliberate removal, which is one undo step anyway. So the guard
 * is a modifier, not a dialog. Letters without Ctrl belong to the panels (the cameras use them).
 * UNDO AND REDO WORK FROM ANYWHERE (D242 item 8a, the keeper: "make it like photoshop or video editing programs, cntrl z and what ever
 * to go forward and back"): Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z act on the TRACK with the focus in a number field, a checkbox or a select
 * too. Only a TEXT-ENTRY field (`inText`: the track's name, the share code box) keeps them for its own text, as an editor's text box
 * does. Ctrl+S and Ctrl+Backspace are unchanged: in ANY field (`inField`) they stay the field's, so Ctrl+Backspace there deletes a
 * word, never the track's head. A caller that passes no `inText` (app/shell.js's own tests) gets the old rule: any field keeps all.
 */
function keyAction({ key, ctrlKey, metaKey, shiftKey, inField, inText }) {
  const ctrl = ctrlKey || metaKey, k = String(key || '').toLowerCase();
  if (!ctrl) return null;
  const textEntry = inText === undefined ? !!inField : !!inText;
  if (k === 'z') return textEntry ? null : shiftKey ? 'redo' : 'undo';
  if (k === 'y') return textEntry ? null : 'redo';
  if (inField) return null;
  if (k === 's') return 'save';
  if (k === 'backspace') return 'removeHead';
  return null;
}

// A field whose own Ctrl+Z means "undo my typing": text-like inputs (an input with no type is a text input) and text areas.
const TEXT_ENTRY = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"]';

/**
 * D240 follow-up (B's look at ab748e5, C's open question): a half-typed number that was never Extended is thrown away by the first Ctrl+Z, which also steps the track. So Ctrl+Z first
 * ASKS THE PANEL ('t180-undo-guard', answered by app/core/panel.js): if a field holds an un-applied edit, the panel puts that field back and says it handled the key, and the track is not
 * stepped; the next Ctrl+Z (nothing un-applied now) undoes the track. A page with no panel, or a document that cannot dispatch, never handles it: Ctrl+Z undoes the track as before.
 */
function panelHandled(doc) {
  let handled = false;
  try { const win = doc.defaultView; if (win && win.CustomEvent && typeof doc.dispatchEvent === 'function') doc.dispatchEvent(new win.CustomEvent('t180-undo-guard', { detail: { handled: () => { handled = true; } } })); } catch (e) { handled = false; }
  return handled;
}

/**
 * Bind the keys on the equation page: `doc` is the page's document, `shell` the core shell (app/core/coreshell.js), `save` the Save
 * button's own path (the name field is the page's). Undo, redo and Ctrl+Backspace (removeHead) go to the shell. Returns the unbind.
 */
function bindKeys(doc, shell, { save }) {
  const onKey = (e) => {
    const t = e.target, is = (sel) => !!t && typeof t.matches === 'function' && t.matches(sel);
    const act = keyAction({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, inField: is('input, select, textarea'), inText: is(TEXT_ENTRY) || !!(t && t.isContentEditable) });
    if (!act) return;
    e.preventDefault();
    if (act === 'undo' && panelHandled(doc)) return;   // an un-applied field was put back instead; the next Ctrl+Z steps the track
    if (act === 'save') save(); else shell[act]();
  };
  doc.addEventListener('keydown', onKey);
  return () => doc.removeEventListener('keydown', onKey);
}

module.exports = { keyAction, bindKeys };
