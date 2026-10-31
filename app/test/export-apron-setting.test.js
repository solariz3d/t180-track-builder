// export-apron-setting.test.js: node --test app/test/export-apron-setting.test.js. D572 Part B: File ▸ Edge apron, the width of the apron the export lays outside every
// open road edge (src/export/apron.js), saved with the track (src/core/document.js edgeApronM). The shell sets it as one undo step; every export the page makes reads it,
// on the page and in the export's own process (app/export/exportjob.js); a track that never set it exports at the exporter's default, 2.0 m.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const MI = require('../menubar/items.js');
const C = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const EJ = require('../export/exportjob.js');
const { extend } = require('../../src/core/extend.js');
const { close } = require('../../src/core/close.js');
const { makeExporter } = require('../export/export.js');
const { loadCjs } = require('../lib/cjs.js');

const REPO = path.resolve(__dirname, '..', '..'), get = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const R = 180, Q = (Math.PI * R) / 2, TURN = 1 / R;
function lap(name) {
  let d = extend(D.createDoc(name), { length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: TURN } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); assert.equal(r.converged, true, r.report); return r.doc;
}
const LAP = lap('Apron Lap');
const kn5Of = (out) => Buffer.from(out.folders[0].files.find((f) => f.path.endsWith('.kn5')).bytes);
let exporter;
const shellWith = async (d) => { exporter = exporter || await makeExporter(get); const sh = await C.createCoreShell({ exporter, autosaveMs: 0 }); sh.adopt(d); return sh; };

test('the shell sets the width as one undo step; a width the exporter would refuse is refused in words and nothing changes', async () => {
  const sh = await shellWith(LAP);
  assert.equal(sh.edgeApron(), 2.0, 'a track that never set it reads the default');
  sh.setEdgeApron(1.5);
  assert.equal(sh.getState().history.present.edgeApronM, 1.5); assert.equal(sh.edgeApron(), 1.5);
  sh.undo();
  assert.equal(sh.getState().history.present.edgeApronM, undefined, 'one Ctrl+Z takes it back');
  const before = sh.getState().history.present, st = sh.setEdgeApron(12);
  assert.match(st.message, /from 0 to 10 m/); assert.equal(sh.getState().history.present, before);
});

test('the export reads it: a track that never set it is byte for byte a track set to 2.0, and 0 lays no apron, only the side face', async () => {
  const old = await shellWith(LAP), two = await shellWith(D.setEdgeApron(LAP, 2)), none = await shellWith(D.setEdgeApron(LAP, 0));
  assert.equal(old.exportArgs({})[2].edgeApronM, undefined, 'no field: the exporter\'s own default');
  assert.equal(none.exportArgs({})[2].edgeApronM, 0);
  const a = kn5Of(old.buildExport({})), b = kn5Of(two.buildExport({})), z = kn5Of(none.buildExport({}));
  assert.ok(a.includes('1ROAD_APRON_'), 'the default lays the apron');
  assert.ok(a.equals(b), 'no field and 2.0 are the same kn5');
  assert.ok(!z.includes('1ROAD_APRON_') && z.includes('APRONSIDE_'), 'at 0: the side face, no apron');
});

test('the export\'s own process gets it too: the job carries the width and its export lays no apron at 0', async () => {
  const none = await shellWith(D.setEdgeApron(LAP, 0)), [segments, meta, opts] = none.exportArgs({});
  const job = JSON.parse(JSON.stringify(EJ.packJob(segments, { ...meta, liftDoc: none.getState().history.present }, opts)));   // as buildExportAsync packs it; what crosses is plain data
  assert.equal(job.opts.edgeApronM, 0);
  const env = await EJ.loadEnv(loadCjs, get), z = kn5Of(EJ.runJob(env, job));
  assert.ok(!z.includes('1ROAD_APRON_') && z.includes('APRONSIDE_'));
});

test('File ▸ Edge apron: the field shows the track\'s width, sets what is typed, says what 0 does, and shows the kept width when one is refused', async () => {
  const sh = await shellWith(LAP), made = [];
  const doc = { createElement: (tag) => { const e = { tag, children: [], attrs: {}, value: '', textContent: '', appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; } }; made.push(e); return e; } };
  const node = MI.apronField(doc, sh), input = made.find((e) => e.tag === 'input');
  assert.equal(input.value, '2'); assert.equal(input.type, 'number'); assert.equal(input.min, '0'); assert.equal(input.max, '10');
  assert.ok(made.some((e) => e.textContent === '0 closes the gap visually only; a wheel can still drop under.'), 'the help line, exactly');
  assert.ok(node.children.length >= 2);
  input.value = '1.5'; input.onchange(); assert.equal(sh.edgeApron(), 1.5);
  input.value = '0'; input.onchange(); assert.equal(sh.edgeApron(), 0);
  input.value = '11'; input.onchange(); assert.equal(sh.edgeApron(), 0, 'refused'); assert.equal(input.value, '0', 'the field shows the width kept');
  input.value = ''; input.onchange(); assert.equal(sh.edgeApron(), 0, 'a blank is no width'); assert.equal(input.value, '0');
});
