// settings.js: THE BUILDER'S SAVED SETTINGS (D355, contract S). Six choices that used to reset at every start are kept across starts here, each in the
// webview's localStorage as `t180.settings.<key>` (JSON). Tauri gives WebView2 a user-data folder of its own, so they survive a restart of the app
// (app/onboarding/firstrun.js says where). The sound's mute and volume (app/sound.js, t180.sound.*) and the road surface (app/core/textures.js,
// t180.coreLook) keep their own keys, as they were, so nothing already saved is lost.
//
//   get(key, fallback)   the saved value, or `fallback` when none is saved (or the saved text is not JSON)
//   set(key, value)      saves it (a boolean, a finite number or a string) and tells every on(key) listener when it changed
//   on(key, fn)          fn(value, key) after each change of `key`; returns the function that stops it
//   createSettings(store) a settings object over `store` ({ getItem, setItem }, or null): the tests' way in; the exports above are one shared instance
//   KEYS, PREFIX, CHOICES  CHOICES (D394): the keys that take one of a fixed set of names (theme: app/lib/theme.js CHOICES, held equal by app/test/theme.test.js)
//
// A STORE THAT FAILS (a private window, a blocked or full storage): every read and write is caught, the value is kept for the session in memory, and
// nothing throws. AN UNKNOWN KEY OR VALUE throws at once, by name: a misspelt key would otherwise save a value nothing reads. A key in CHOICES takes only its
// names; a saved name it does not know reads as the fallback.
// ONE INSTANCE FOR THE PAGE: app/lib/cjs.js builds a fresh module graph on every loadCjs call, so the page, the core panel and the menus each get their own
// copy of this file. The shared instance therefore lives on globalThis, and every copy's get/set/on reach the same values and the same listeners.
'use strict';

const KEYS = Object.freeze(['turnClimbAs', 'dragHandles', 'colourByGrip', 'gridStep', 'mirrorOnInsert', 'csp', 'author', 'theme']);   // D365: author, the name an export writes (app/menubar/items.js authorName); D394: theme, Settings ▸ Theme
const CHOICES = Object.freeze({ theme: Object.freeze(['music', 'aqua', 'skyline', 'skyline-night', 'glass', 'aurora', 'sigil']) });   // D405: skyline-night, Skyline Night
const PREFIX = 't180.settings.';
const SHARED = '__t180Settings';

function createSettings(store) {
  const mem = new Map(), listeners = new Map();
  const known = (key) => { if (!KEYS.includes(key)) throw new Error(`SETTINGS_KEY: "${key}" is not a setting; the settings are ${KEYS.join(', ')}`); };
  const read = (key) => { try { return store ? store.getItem(PREFIX + key) : null; } catch (e) { return null; } };
  const write = (key, text) => { try { if (store) store.setItem(PREFIX + key, text); } catch (e) { /* a blocked store: the session keeps it (mem) */ } };
  function get(key, fallback) {
    known(key);
    if (mem.has(key)) return mem.get(key);
    const raw = read(key);
    if (raw === null || raw === undefined) return fallback;
    let v; try { v = JSON.parse(raw); } catch (e) { return fallback; }
    return CHOICES[key] && !CHOICES[key].includes(v) ? fallback : v;
  }
  function set(key, value) {
    known(key);
    const ok = typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
    if (!ok) throw new Error(`SETTINGS_VALUE: "${key}" takes a boolean, a finite number or a string, got ${value === null ? 'null' : typeof value}`);
    if (CHOICES[key] && !CHOICES[key].includes(value)) throw new Error(`SETTINGS_VALUE: "${key}" is one of ${CHOICES[key].join(', ')}, got ${JSON.stringify(value)}`);
    const before = get(key, undefined);
    mem.set(key, value); write(key, JSON.stringify(value));
    if (before !== value) for (const fn of [...(listeners.get(key) || [])]) fn(value, key);
  }
  function on(key, fn) {
    known(key);
    if (typeof fn !== 'function') throw new Error(`SETTINGS_LISTENER: on("${key}") needs a function`);
    const list = listeners.get(key) || new Set(); list.add(fn); listeners.set(key, list);
    return () => list.delete(fn);
  }
  return { get, set, on };
}

/** The page's one instance (see ONE INSTANCE above), over the webview's localStorage when it has one. */
function shared() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  if (!g[SHARED]) {
    let store = null;
    try { store = g.localStorage || null; } catch (e) { store = null; }   // reading localStorage itself can throw where storage is blocked
    g[SHARED] = createSettings(store);
  }
  return g[SHARED];
}

module.exports = {
  get: (key, fallback) => shared().get(key, fallback),
  set: (key, value) => shared().set(key, value),
  on: (key, fn) => shared().on(key, fn),
  createSettings, KEYS, PREFIX, CHOICES,
};
