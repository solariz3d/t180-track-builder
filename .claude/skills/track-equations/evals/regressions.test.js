// regressions.test.js: node --max-old-space-size=4096 --test .claude/skills/track-equations/evals/regressions.test.js
// The track-equations skill's REGRESSION evals on REAL tracks (D184, pane E). They need two things that are not in the repo
// and never will be: the reads in reads/ (gitignored) and the tracks themselves in Assetto Corsa's content folder (AC_ROOT,
// or the path docs/FINDINGS.md:283 already names). Where either is missing, the eval SKIPS and says which; it never passes
// on missing data. Heavy: run it alone on the machine.
//
// 1. Fourier (M4, tools/fourier.cjs): at the N M4 measured on 2026-09-28, each layout still rebuilds within 5 m and 5°
//    on ≥ 95% of its stations (SKILL.md step 8).
// 2. Piecewise (tools/piecewise.cjs), the predictions REGISTERED before any run (the D184 plan's addendum):
//    - Rainbow Road, which never converged in M4, rebuilds within 5 m and 5° on ≥ 95% once split;
//    - Sakura and Centrifuge need FEWER terms than M4's N = 2,000 and 4,000, counted in degrees of freedom (numbers
//      stored) as SKILL.md step 9 asks: M4 stores 2N + 1 per function over three functions; the piecewise fit stores four
//      channels of control points plus its knots (summarise().dof).
// Every assertion prints the measured value, so a failure says by how much.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const F = require(path.join(REPO, 'tools', 'fourier.cjs'));
const PW = require(path.join(REPO, 'tools', 'piecewise.cjs'));
const TRACKS = path.join(process.env.AC_ROOT || 'G:\\SteamLibrary\\steamapps\\common\\assettocorsa', 'content', 'tracks');
const SHARE = 0.95;

const readOf = (name) => { const f = path.join(REPO, 'reads', `${name}.read.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const trackOf = (dir) => { const d = path.join(TRACKS, dir); return fs.existsSync(d) ? d : null; };

/** M4's fit at exactly N: the same sampling, series, half-shift, closure and score as fourier.cjs fitOne, at one N. */
function fourierAt(read, N) {
  const sm = F.sampleRead(read), fit = (k) => F.halfShift(F.dft(sm.raw[k], sm.nets[k], sm.M), sm.L, sm.M);
  const c = F.closeLoop(sm, F.cut(fit('theta'), N), F.cut(fit('pitch'), N), F.cut(fit('roll'), N));
  return F.score(sm, c.path);
}

// ── 1. the M4 regressions ──
const M4 = [['serpents_spiral', 12], ['bowltrack_2', 30], ['eagleton__eagleton', 75], ['thunderhead_raceway__normal', 200], ['ohyeah2389_t180testtrack', 200]];
for (const [name, N] of M4) {
  test(`Fourier regression: ${name} rebuilds within 5 m and 5° on ≥ 95% at N = ${N}`, (t) => {
    const read = readOf(name); if (!read) { t.skip(`SKIPPED: reads/${name}.read.json is not on this machine`); return; }
    const s = fourierAt(read, N);
    assert.ok(s.lineShare >= SHARE && s.bankShare >= SHARE, `line ${(100 * s.lineShare).toFixed(2)}%, bank ${(100 * s.bankShare).toFixed(2)}%`);
  });
}

// ── 2. the piecewise evals ──
const fits = new Map();
function piecewise(name, dir, layout) {
  if (fits.has(name)) return fits.get(name);
  const read = readOf(name), d = trackOf(dir);
  const out = !read ? { skip: `reads/${name}.read.json is not on this machine` } : !d ? { skip: `the track ${dir} is not installed under ${TRACKS}` }
    : (() => { const mc = PW.meshCentreline(read, PW.rayIndex(PW.roadTris(d, layout))); return { sum: PW.summarise(PW.fitTrack(mc, { tol: 5 }), 5) }; })();
  fits.set(name, out); return out;
}
const m4Dof = (N) => 3 * (2 * N + 1);

test('piecewise (registered): Rainbow Road, which never converged in M4, rebuilds within 5 m and 5° on ≥ 95% once split', (t) => {
  const r = piecewise('rainbow_rd', 'rainbow_rd'); if (r.skip) { t.skip(`SKIPPED: ${r.skip}`); return; }
  assert.ok(r.sum.lineWithin5 >= SHARE && r.sum.bankWithin5 >= SHARE, `line ${(100 * r.sum.lineWithin5).toFixed(2)}%, bank ${(100 * r.sum.bankWithin5).toFixed(2)}%`);
});
for (const [name, N] of [['sakura_speedway', 2000], ['centrifuge', 4000]]) {
  test(`piecewise (registered): ${name} passes at fewer degrees of freedom than M4's N = ${N} (${m4Dof(N)})`, (t) => {
    const r = piecewise(name, name); if (r.skip) { t.skip(`SKIPPED: ${r.skip}`); return; }
    assert.ok(r.sum.lineWithin5 >= SHARE && r.sum.bankWithin5 >= SHARE, `it must pass first: line ${(100 * r.sum.lineWithin5).toFixed(2)}%, bank ${(100 * r.sum.bankWithin5).toFixed(2)}%`);
    assert.ok(r.sum.dof < m4Dof(N), `piecewise ${r.sum.dof} DOF (${r.sum.controlPoints} control points) against M4's ${m4Dof(N)}`);
  });
}
