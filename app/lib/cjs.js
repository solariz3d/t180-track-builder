// cjs.js: run the program's own CommonJS files (src/, app/) in the webview, with no bundler and no dependency.
//
// The document model, geometry and validation are CommonJS so that node --test runs them as they are. The webview has
// no require(), so this gives it one: fetch the entry file, find its require('./…') calls, fetch those, and so on;
// then evaluate each file once, in the order it is required, with module/exports/require of its own. Only RELATIVE
// requires are served. A node built-in ('fs', 'path', …) fails loudly, naming the module and the file that asked:
// the code the app runs in the UI process must not need one (ARCHITECTURE §9: the geometry core runs in the UI process).
// A require() that appears only in a comment is fetched speculatively; if the file is not there, nothing fails
// unless the code really calls it.
//
//   const shell = await loadCjs('app/shell.js', (p) => fetch(p).then((r) => { if (!r.ok) throw …; return r.text(); }));
// Paths are relative to the served root, which mirrors the repository: app/… and src/… side by side.
'use strict';

function norm(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!out.length) throw new Error(`cjs: ${p} climbs above the served root`); out.pop(); } else out.push(part);
  }
  return out.join('/');
}
const dirOf = (p) => p.split('/').slice(0, -1).join('/');
const resolveFrom = (from, spec) => norm(`${dirOf(from)}/${spec}`);
const REQ = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * opts.builtins maps a bare module name ('fs', 'zlib', …) to what require() returns for it, and opts.globals names
 * values each file sees as free variables (e.g. Buffer). Both are how the exporter runs here (app/export/node-shim.js).
 * A bare name NOT in builtins is still refused loudly.
 */
async function loadCjs(entry, fetchText, { builtins = {}, globals = {} } = {}) {
  const gNames = Object.keys(globals), gValues = gNames.map((k) => globals[k]);
  const src = new Map(), missing = new Map();
  async function fetchAll(p) {
    if (src.has(p) || missing.has(p)) return;
    let text;
    try { text = await fetchText(p); } catch (e) { missing.set(p, e); return; }
    src.set(p, text);
    for (const m of text.matchAll(REQ)) if (m[1].startsWith('.')) await fetchAll(resolveFrom(p, m[1]));
  }
  const start = norm(entry);
  await fetchAll(start);
  if (!src.has(start)) throw new Error(`cjs: could not load ${start}: ${missing.get(start) && missing.get(start).message}`);
  const done = new Map();
  function req(from, spec) {
    if (!spec.startsWith('.')) {
      if (Object.prototype.hasOwnProperty.call(builtins, spec)) return builtins[spec];
      throw new Error(`cjs: "${spec}" (required by ${from}) is not available in the app: only the program's own files are`);
    }
    const p = resolveFrom(from, spec);
    if (done.has(p)) return done.get(p).exports;
    if (!src.has(p)) throw new Error(`cjs: ${p} (required by ${from}) could not be loaded${missing.has(p) ? `: ${missing.get(p).message}` : ''}`);
    const module = { exports: {} };
    done.set(p, module);   // set before running, so a require cycle sees the partial exports, as node's does
    // The file runs in an inner function of its own, so a top-level declaration in it (say, the shim's own
    // `class Buffer`) shadows an injected global of the same name instead of clashing with the parameter.
    new Function('require', 'module', 'exports', ...gNames, `return (function () {\n${src.get(p)}\n}).call(module.exports);\n//# sourceURL=${p}`)((s) => req(p, s), module, module.exports, ...gValues);
    return module.exports;
  }
  return req('', `./${start}`);
}

if (typeof module !== 'undefined') module.exports = { loadCjs, norm, resolveFrom };
if (typeof window !== 'undefined') window.loadCjs = loadCjs;
