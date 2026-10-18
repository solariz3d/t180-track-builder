// tokens.js: THE PAGE'S COLOURS FOR WHAT CSS CANNOT REACH (D381, pane B). The canvas layers (handles, selection, flights, grip, spawns, labels) and the
// WebGL view draw with colours of their own; a skin (app/themes/<name>.css) changes the page's tokens, and this reader hands those tokens to the code
// that draws. It reads getComputedStyle(<html>) once per token, keeps the answer, and reads again when <html data-theme> changes (a MutationObserver).
// Every read names today's colour as its fallback, which is what a page without the token draws (the preview's smoke page, a test's stand-in window):
// SIGIL's :root (app/index.html) holds exactly those literals, so SIGIL draws as it did before D381.
//
//   tokensOf(win)                  -> the window's one reader (kept on the window: each loadCjs builds a fresh module graph, as the settings store does)
//   createTokens(win, { log })     -> { css, rgba, floats, alpha, solid, word, refresh, onChange, version }
//     css(name, fallback)          -> '#rrggbb' for an opaque colour, 'rgba(r, g, b, a)' otherwise (a canvas or a style takes either)
//     rgba(name, fallback)         -> [r, g, b, a], r g b 0..255, a 0..1
//     floats(name, fallback)       -> [r, g, b] 0..1 for WebGL (a token written color(srgb r g b) gives its floats exactly); fallback is the float array
//     alpha(name, a, fallback)     -> 'rgba(r, g, b, a)': the token at a site's own alpha (a translucent backing)
//     solid(name, fallback)        -> '#rrggbb' with any alpha the skin gave dropped (a box that must stay opaque)
//     word(name, fallback)         -> a token that is a word (D384: --sky-style), unquoted; the fallback word when the page has none
// A token the reader cannot understand is reported once (console.error) and today's colour is drawn; a missing token is today's colour, silently.
'use strict';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0');
const num = (s) => { const t = String(s).trim(); if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%?$/i.test(t)) return NaN; return t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t); };
const fromInts = (r, g, b, a) => ({ rgba: [r, g, b, a], floats: [r / 255, g / 255, b / 255] });

/** A colour written as #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (commas or spaces, / alpha) or color(srgb r g b [/ a]); null for anything else. */
function parse(text) {
  const s = String(text).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) { const v = [...h].map((c) => parseInt(c + c, 16)); return fromInts(v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1); }
    if (h.length === 6 || h.length === 8) { const v = [0, 2, 4, 6].slice(0, h.length / 2).map((i) => parseInt(h.slice(i, i + 2), 16)); return fromInts(v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1); }
    return null;
  }
  m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const [body, al] = m[1].includes('/') ? m[1].split('/') : [m[1], null], parts = body.split(/[\s,]+/).filter(Boolean), extra = al === null && parts.length === 4 ? parts.pop() : al;
    if (parts.length !== 3) return null;
    const c = parts.map((p) => (p.trim().endsWith('%') ? num(p) * 255 : num(p))), a = extra === null ? 1 : num(extra);
    if (c.some((v) => !Number.isFinite(v) || v < 0 || v > 255) || !Number.isFinite(a) || a < 0 || a > 1) return null;
    return fromInts(c[0], c[1], c[2], a);
  }
  m = /^color\(srgb\s+([^)]*)\)$/.exec(s);
  if (m) {
    const [body, al] = m[1].split('/'), f = body.trim().split(/\s+/).map(num), a = al === undefined ? 1 : num(al);
    if (f.length !== 3 || f.some((v) => !Number.isFinite(v)) || !Number.isFinite(a)) return null;
    const fl = f.map(clamp01);
    return { rgba: [...fl.map((v) => Math.round(v * 255)), clamp01(a)], floats: fl };
  }
  return null;
}

function createTokens(win, { log = null } = {}) {
  const say = log || ((m) => { try { ((win && win.console) || console).error(m); } catch (e) { /* nowhere to say it */ } });
  const root = () => { try { return (win && win.document && win.document.documentElement) || null; } catch (e) { return null; } };
  const cache = new Map(), said = new Set(), listeners = [];
  let version = 0;
  const raw = (name) => {
    const r = root();
    if (!r || !win || typeof win.getComputedStyle !== 'function') return '';
    try { return String(win.getComputedStyle(r).getPropertyValue(name) || '').trim(); } catch (e) { return ''; }
  };
  // a value only the browser can resolve (a named colour, color-mix(), hsl()): its computed colour through a throwaway element, when there is a document
  const probe = (v) => {
    const r = root(), d = win && win.document;
    if (!r || !d || typeof d.createElement !== 'function') return null;
    try {
      const e = d.createElement('i'); e.style.color = v; if (!e.style.color) return null;
      r.appendChild(e); const c = win.getComputedStyle(e).color; e.remove();
      return parse(c);
    } catch (e) { return null; }
  };
  const read = (name, fallback) => {
    if (fallback === undefined || fallback === null) throw new Error(`tokens: ${name} needs today's colour as its fallback`);
    if (!cache.has(name)) {
      const v = raw(name), c = v ? parse(v) || probe(v) : null;
      if (v && !c && !said.has(name)) { said.add(name); say(`tokens: ${name} is "${v}", which is not a colour this reader understands; today's colour is drawn instead`); }
      cache.set(name, c);
    }
    return cache.get(name);
  };
  const fb = (name, fallback) => { const c = parse(fallback); if (!c) throw new Error(`tokens: the fallback for ${name} is not a colour: ${fallback}`); return c; };
  const hexOf = (c) => `#${c.rgba.slice(0, 3).map(hex2).join('')}`;
  const api = {
    css(name, fallback) { const c = read(name, fallback); if (!c) return fallback; return c.rgba[3] === 1 ? hexOf(c) : `rgba(${c.rgba.slice(0, 3).map(Math.round).join(', ')}, ${c.rgba[3]})`; },
    rgba(name, fallback) { return [...(read(name, fallback) || fb(name, fallback)).rgba]; },
    floats(name, fallback) { const c = read(name, fallback); return c ? [...c.floats] : [...fallback]; },
    alpha(name, a, fallback) { const c = read(name, fallback) || fb(name, fallback); return `rgba(${c.rgba.slice(0, 3).map(Math.round).join(', ')}, ${a})`; },
    solid(name, fallback) { return hexOf(read(name, fallback) || fb(name, fallback)); },
    /** D384: a token that is a word, not a colour (--sky-style): its value without quotes or spaces, or the fallback when the page has none. */
    word(name, fallback) {
      if (typeof fallback !== 'string') throw new Error(`tokens: ${name} needs today's word as its fallback`);
      const k = 'word:' + name;
      if (!cache.has(k)) cache.set(k, raw(name).replace(/^(["'])(.*)\1$/, '$2').trim());
      return cache.get(k) || fallback;
    },
    refresh() { cache.clear(); version++; for (const f of listeners.slice()) { try { f(); } catch (e) { say(`tokens: a listener failed on a skin change (${e && e.message})`); } } },
    onChange(f) { listeners.push(f); return () => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }; },
    get version() { return version; },
  };
  const r = root();
  if (r && win && typeof win.MutationObserver === 'function') {
    try { new win.MutationObserver(() => api.refresh()).observe(r, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { say(`tokens: a skin change will not be seen until the next launch (${e && e.message})`); }
  }
  return api;
}

function tokensOf(win) {
  if (!win || (typeof win !== 'object' && typeof win !== 'function')) return createTokens(null);
  try { if (!win.__t180Tokens) win.__t180Tokens = createTokens(win); return win.__t180Tokens; } catch (e) { return createTokens(win); }
}

module.exports = { createTokens, tokensOf, parse };
