// Tests for ui/ui_track.json "width" (it was "", the root of a NaN downstream: B's CORRECTION in p-d182-plike-reg-B).
// The builder now writes the road's width as AC tracks do ("32m"): the length-weighted median of the road's edge-to-edge
// width across its surface (src/export/fromwords.js roadWidthM says why that statistic).
// Run: node --test --test-concurrency=4 test/export_width.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/doc/index.js');
const { closeLoop } = require('../src/doc/connector.js');
const { exportTrack, _internal: { roadWidthM } } = require('../src/export/fromwords.js');

const REPO = path.resolve(__dirname, '..'), made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-width-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
// The ripple (p-d182-ripple-E): the sample's words are named explicitly (the pre-D182 words), because this file tests
// that a closed loop EXPORTS, not what the defaults are. Under the measured vocabulary a 50 m tight on a 31 m road folds.
const { appendOld } = require('./pre_d182_words.js');
const kmh = (v) => v / 3.6;
const uiWidth = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'ui', 'ui_track.json'), 'utf8')).width;

test('the exported width is non-empty, parses as metres, and is the road\'s width from the document within 0.5 m', () => {
  let d = D.createDoc('Width Loop');
  for (const w of ['straight', 'straight', 'tight', 'straight', 'tight']) d = appendOld(D, d, w, { speed: kmh(200) });
  d = D.editWord(d, 'w3', { handles: { length: 50 } });
  const doc = closeLoop(d).candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc;
  const r = exportTrack(doc.words.reduce((x, w) => D.editWord(x, w.id, { speed: kmh(200) }), doc), { outDir: tmp() });
  const w = uiWidth(r.folders[0].dir);
  assert.match(w, /^\d+m$/);
  const got = parseFloat(w);
  assert.ok(Number.isFinite(got));
  // INDEPENDENT of the export's profile code: from the words' own handles, floor + two walls (0 wall: the floor), the
  // length-weighted median over road words. Bound 0.5 m: the field is rounded to whole metres.
  const ws = doc.words.filter((x) => x.word !== 'jump').map((x) => ({ x: x.handles.width + 2 * x.handles.wall, L: x.handles.length })).sort((a, b) => a.x - b.x);
  const tot = ws.reduce((a, e) => a + e.L, 0); let acc = 0, want = null; for (const e of ws) { acc += e.L; if (acc >= tot / 2) { want = e.x; break; } }
  assert.ok(Math.abs(got - want) <= 0.5, `ui_track width ${w}, the words give ${want} m`);
});

test('the width is the MEDIAN by length, not the mean: one short wide stretch does not move it', () => {
  const seg = (L, half) => ({ kind: 'road', length: L, profile: { u: [-half, 0, half], psi: [0, 0, 0] } });
  assert.equal(roadWidthM([seg(900, 10), seg(100, 60)]), 20);   // the mean would be 30
  assert.equal(roadWidthM([seg(100, 10), { kind: 'gap', length: 50, profile: null }, seg(300, 16)]), 32);   // a flight has no width
  assert.equal(roadWidthM([{ kind: 'gap', length: 50, profile: null }]), null);
});

test('the platform test writes its fixed width, 26 m (2·WF + 2·LW)', () => {
  const top = tmp();
  const cp = (src, dst) => { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const a = path.join(src, e.name), b = path.join(dst, e.name); if (e.isDirectory()) cp(a, b); else fs.copyFileSync(a, b); } };
  for (const d of ['scripts', 'src', 'tools']) cp(path.join(REPO, d), path.join(top, d));
  const r = require(path.join(top, 'scripts/build_platform_test.js')).build();
  assert.deepEqual(r.built.map((b) => uiWidth(b.dir)), ['26m', '26m']);
});
