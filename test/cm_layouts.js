// cm_layouts.js: Content Manager's layout discovery, ported for the tests that read an exported folder back as CM would (D361).
// Source: gro-ove/actools master e5e5c94b, AcManager.Tools/Objects/TrackObject.cs. Not a test file: required by test/export-layouts-set.test.js
// and app/test/layoutsexport.test.js.
'use strict';
const fs = require('fs');
const path = require('path');

/** Content Manager's layout discovery, ported for a NON-Kunos track (TrackObject.cs GetLayouts :129-153, GetPreferredMainLayout :193-221, GetWeight :185-189). */
function cmLayouts(trackDir) {
  const ui = path.join(trackDir, 'ui');
  const subs = fs.readdirSync(ui).map((n) => path.join(ui, n)).filter((d) => fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'ui_track.json')));
  if (!subs.length) return null;
  const data = (d) => JSON.parse(fs.readFileSync(path.join(d, 'ui_track.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (fs.existsSync(path.join(ui, 'ui_track.json'))) return { simple: true, main: null, layouts: subs.map((d) => path.basename(d)) };
  const NON = new RegExp('downhill|drift|fall|freeroam|grid|mini|no ?chicane|osrw|oval|pursuit|rev(?:\b|erse)?', 'g');
  const PREF = new RegExp('circuit|international|full|gp|grand?|hill ?climb|normal|standar[dt]?|uphill', 'g');
  const weight = (m) => (['full', 'drift', 'normal', 'pursuit'].includes(m) ? 10 : ['international', 'circuit'].includes(m) ? 2 : m.length);
  const sum = (re, s) => (s.match(re) || []).reduce((a, m) => a + weight(m), 0);
  const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const id = path.basename(trackDir).toLowerCase();
  let best = null, bestP = -Infinity;
  for (const d of subs) {
    const lid = path.basename(d).toLowerCase(), j = data(d), name = String(j.name || lid).toLowerCase();
    let p = Math.min(100, Math.max(0, 100 - lev(name, id) * 10)) - name.length;
    p += -sum(NON, lid) * 10 + sum(PREF, lid) * 10 - sum(NON, name) * 100 + sum(PREF, name) * 100;
    p += (typeof j.priority === 'number' ? j.priority : 0) * 1e8;
    if (bestP < p) { bestP = p; best = d; }
  }
  return { simple: false, main: path.basename(best), layouts: subs.map((d) => path.basename(d)).sort(), names: Object.fromEntries(subs.map((d) => [path.basename(d), data(d).name])) };
}

module.exports = { cmLayouts };
