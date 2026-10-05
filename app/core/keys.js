// keys.js: the app's keys, MOVED here from app/shell.js as they were (D239 note, the keeper's undo request: removing the Pieces mode
// must not remove its keys). The equation page binds them to the core shell (app/index.html); app/shell.js re-exports keyAction so its
// own tests and drivers are unchanged. Making the keys work inside a field, and the History list, are a separate follow-up after
// D239 and D242 land (plan_t180_safe_close_reds_2026-10-04.md item 8), so the inField guard stays as it was.
'use strict';

/**
 * The app's keys, from a key event to an action name (or null). Pure, so it is tested headless; app/index.html calls it.
 * REMOVING THE HEAD TAKES Ctrl+Backspace (or Cmd+Backspace). A bare Backspace does nothing: it is the key most often hit
 * by accident, and a confirm step would interrupt every deliberate removal, which is one undo step anyway. So the guard
 * is a modifier, not a dialog. While a field has focus, no key reaches the track. Letters without Ctrl belong to the
 * panels (the cameras use them).
 */
function keyAction({ key, ctrlKey, metaKey, shiftKey, inField }) {
  if (inField) return null;
  const ctrl = ctrlKey || metaKey, k = String(key || '').toLowerCase();
  if (!ctrl) return null;
  if (k === 'z') return shiftKey ? 'redo' : 'undo';
  if (k === 'y') return 'redo';
  if (k === 's') return 'save';
  if (k === 'backspace') return 'removeHead';
  return null;
}

/**
 * Bind the keys on the equation page: `doc` is the page's document, `shell` the core shell (app/core/coreshell.js), `save` the Save
 * button's own path (the name field is the page's). Undo, redo and Ctrl+Backspace (removeHead) go to the shell. Returns the unbind.
 */
function bindKeys(doc, shell, { save }) {
  const onKey = (e) => {
    const act = keyAction({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, inField: !!e.target && typeof e.target.matches === 'function' && e.target.matches('input, select, textarea') });
    if (!act) return;
    e.preventDefault();
    if (act === 'save') save(); else shell[act]();
  };
  doc.addEventListener('keydown', onKey);
  return () => doc.removeEventListener('keydown', onKey);
}

module.exports = { keyAction, bindKeys };
