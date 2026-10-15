// app/titlebar.js: the window's own title bar (2026-10-14, the Sigil look). node --test app/test/titlebar.test.js
//
// The Windows frame is off (tauri.conf.json "decorations": false), so the page's header IS the title bar: the header and the
// empty parts of it carry data-tauri-drag-region (Tauri's own drag script moves the window, and a double-click maximizes),
// and three buttons at its right end minimize, maximize/restore and close.
//
// CLOSE GOES THROUGH app/closer.js. The X calls win.close(), which emits the close-requested event exactly as the Windows X
// did, so the one close handler still asks about unsaved work. Nothing here destroys the window.
//
// Outside Tauri (the browser, tests with no window) the buttons are hidden and nothing is wired: a page with no window to
// move must not show controls that do nothing.
'use strict';

function wireTitlebar(doc, win, { log = (m) => { try { console.error(m); } catch (e) { /* nowhere to log */ } } } = {}) {
  const box = doc.getElementById('winctl');
  if (!box) return null;
  if (!win || typeof win.close !== 'function') { box.hidden = true; return null; }
  box.hidden = false;
  const call = (name) => async () => {
    try { await win[name](); } catch (e) { log(`title bar: ${name} failed: ${e && e.message ? e.message : e}`); }
  };
  const max = doc.getElementById('win-max');
  const showMax = async () => {
    let m = false;
    try { m = !!(win.isMaximized && await win.isMaximized()); } catch (e) { m = false; }
    if (max) { max.classList.toggle('restore', m); max.title = m ? 'Restore' : 'Maximize'; max.setAttribute('aria-label', max.title); }
    return m;
  };
  doc.getElementById('win-min').onclick = call('minimize');
  max.onclick = async () => { await call('toggleMaximize')(); await showMax(); };
  doc.getElementById('win-close').onclick = call('close');
  if (typeof win.onResized === 'function') {
    try { const p = win.onResized(() => { showMax(); }); if (p && p.catch) p.catch((e) => log(`title bar: resize listener failed: ${e && e.message}`)); } catch (e) { log(`title bar: resize listener failed: ${e && e.message}`); }
  }
  return showMax();
}

if (typeof module !== 'undefined') module.exports = { wireTitlebar };
