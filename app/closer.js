// app/closer.js: the window's ONE close handler (D192). node --test app/test/closer.test.js
//
// WHY THERE IS EXACTLY ONE, AND IT NEVER LETS GO. Tauri prevents a window's close whenever ANY script listener is registered for it, and
// waits for that listener to call destroy() (tauri-2.12.0 src/manager/window.rs: `if window.has_js_listener(WINDOW_CLOSE_REQUESTED_EVENT)
// { api.prevent_close(); }`); the script wrapper `onCloseRequested` awaits the handler and calls destroy() only if it returned, so a handler
// that THROWS leaves the window open. And the listener registry belongs to the webview, not the page: it is cleared only when the webview
// is destroyed (src/event/listener.rs remove_webview_listeners), so a page reload (the builder-mode switch reloads the page) leaves the
// previous page's registration behind with its callback gone. Before D192 only the pieces builder registered a handler (async, awaiting
// the autosave); after pieces -> core the stale registration made every X do nothing, and a failing autosave did the same in pieces.
//
// So the page registers this handler BEFORE the mode branch, in both modes; each mode says what to clean up (or nothing); the cleanup
// is raced against a timeout and its errors are swallowed and logged; and the window is destroyed in `finally`, by us, exactly once
// (the event is default-prevented so the wrapper does not destroy a second time). A stale registration from an earlier page is harmless:
// the current page's handler is registered too, so the close reaches it and it destroys the window.
'use strict';

const CLOSE_TIMEOUT_MS = 3000;   // a cleanup that hangs (a native call that never answers) must not hold the window shut

/**
 * The handler to give `win.onCloseRequested`. `cleanup` is read at close time (a getter, so the mode can set it after registration): it
 * returns nothing or a promise. `win.destroy()` is the last thing the handler does, whatever happened before it.
 */
function makeCloseHandler(win, { cleanup = () => null, timeoutMs = CLOSE_TIMEOUT_MS, log = (m) => { try { console.error(m); } catch (e) { /* nowhere to log */ } } } = {}) {
  return async (evt) => {
    try { if (evt && typeof evt.preventDefault === 'function') evt.preventDefault(); } catch (e) { log(`close: preventDefault failed: ${e && e.message}`); }
    let timer = null;
    try {
      const fn = cleanup();
      if (fn) await Promise.race([Promise.resolve(fn), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`the close cleanup took over ${timeoutMs} ms; closing anyway`)), timeoutMs); })]);
    } catch (e) {
      log(`close: cleanup failed, closing anyway: ${e && e.message ? e.message : e}`);
    } finally {
      if (timer) clearTimeout(timer);
      try { await win.destroy(); } catch (e) { log(`close: destroy failed: ${e && e.message ? e.message : e}`); }
    }
  };
}

/**
 * Register the one handler on `win` (the Tauri window). `getCleanup()` returns the current mode's cleanup FUNCTION (or null), read at close
 * time. Returns the registration (a promise of the unlisten function), or null off Tauri.
 */
function installCloseHandler(win, getCleanup, opts = {}) {
  if (!win || typeof win.onCloseRequested !== 'function') return null;
  const cleanup = () => { const f = typeof getCleanup === 'function' ? getCleanup() : null; return typeof f === 'function' ? f() : null; };
  return win.onCloseRequested(makeCloseHandler(win, { ...opts, cleanup }));
}

if (typeof module !== 'undefined') module.exports = { makeCloseHandler, installCloseHandler, CLOSE_TIMEOUT_MS };
