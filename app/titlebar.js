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

// D508, NO WHITE WINDOW AT STARTUP. The window is created hidden (tauri.conf.json "visible": false; WebView2 painted a white 1400 x 860 window before
// "maximized" took over) and the page shows it here, once it has painted: two animation frames after the call (the first may run before anything is on
// screen; each is an animation frame or 100 ms, whichever is first, since a hidden page may get none), maximize, then show, then focus. Maximize comes first so the window appears at its full size; on a hidden window it only marks the state
// (tao applies it at show, without a flash). A fallback timer, set at once, shows the window even if no frame ever comes, and only one of the two shows
// it. A refused call is logged and the next still runs: a page that breaks must never leave the app invisible. lib.rs shows the window natively too, if
// the page never runs at all. -> 'frame' | 'fallback' once shown, or null outside the app (nothing scheduled).
function revealWindow(win, { raf = (f) => requestAnimationFrame(f), after = (f, ms) => setTimeout(f, ms), fallbackMs = 3000, frameMs = 100,
  log = (m) => { try { console.error(m); } catch (e) { /* nowhere to log */ } } } = {}) {
  if (!win || typeof win.show !== 'function') return Promise.resolve(null);
  let shown = null;
  return new Promise((resolve) => {
    const reveal = async (how) => {
      if (shown) return; shown = how;
      for (const name of ['maximize', 'show', 'setFocus']) {
        if (typeof win[name] !== 'function') continue;
        try { await win[name](); } catch (e) { log(`window: ${name} failed: ${e && e.message ? e.message : e}`); }
      }
      resolve(how);
    };
    // a frame is an animation frame or frameMs, whichever comes first: a page in a hidden window may get no animation frames at all
    const frame = (f) => { let ran = false; const once = () => { if (!ran) { ran = true; f(); } }; raf(once); after(once, frameMs); };
    after(() => reveal('fallback'), fallbackMs);
    frame(() => frame(() => reveal('frame')));
  });
}

if (typeof module !== 'undefined') module.exports = { wireTitlebar, revealWindow };
