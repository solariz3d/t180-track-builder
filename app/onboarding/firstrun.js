// firstrun.js: whether this user has met the guide yet, remembered in the APP'S DATA DIR, never the repo.
//
//   const fr = firstRun(store)      store: { get(key) -> string | null, set(key, value) } (localStorage has this shape)
//   fr.isFirst()                     true until the guide was finished or skipped once
//   fr.remember(how)                 how: 'finished' | 'skipped'; stored as JSON with the time
//   fr.forget()                      show the guide again next time ("Show the guide")
//   webStore(win)                    the page's localStorage as a store, or null if the webview has none
//
// WHERE IT LIVES. In the app the store is the webview's localStorage. Tauri gives WebView2 a user-data folder inside the
// app's own data directory (%LOCALAPPDATA%\<identifier>\EBWebView), so the flag is in the app's data dir and nowhere
// near the repository. If A adds native commands for it (the D177 hand-back proposes them), a store over those commands
// has the same two methods and drops in here.
// A store that throws (storage switched off) is treated as "not remembered": the guide shows, and the app is not broken.
'use strict';

const KEY = 't180b.onboarding';

function firstRun(store) {
  const read = () => { try { const v = store && store.get(KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  return {
    isFirst: () => !read(),
    read,
    remember(how) {
      if (how !== 'finished' && how !== 'skipped') throw new Error(`firstRun.remember: "${how}" is not finished or skipped`);
      try { store.set(KEY, JSON.stringify({ how, at: new Date().toISOString() })); return true; } catch (e) { return false; }
    },
    forget() { try { store.set(KEY, ''); return true; } catch (e) { return false; } },
  };
}

function webStore(win) {
  try {
    const ls = win && win.localStorage;
    if (!ls) return null;
    return { get: (k) => ls.getItem(k), set: (k, v) => (v === '' ? ls.removeItem(k) : ls.setItem(k, v)) };
  } catch (e) { return null; }
}

module.exports = { firstRun, webStore, KEY };
