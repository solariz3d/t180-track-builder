// export-csp.test.js: node --test app/test/*.test.js
// The CSP-only warning that goes with CSP's extended-physics switch (src/export/trackfiles.js CSP_ONLY_WARNING; R1) is
// SHOWN: the app's Export (shell.exportTo, through the in-memory exporter the webview uses) puts it in the message the
// user reads, and the folder it writes carries the switch.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createShell } = require('../shell.js');
const { makeExporter } = require('../export/export.js');
const D = require('../../src/doc/index.js');
const { closeLoop } = require('../../src/doc/connector.js');
const { CSP_ONLY_WARNING } = require('../../src/export/trackfiles.js');
const { appendOld } = require('../../test/pre_d182_words.js');

const REPO = path.resolve(__dirname, '..', '..'), made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const kmh = (v) => v / 3.6;

test('Export shows the CSP-only warning in its message, and the exported surfaces.ini carries the switch', async () => {
  let d = D.createDoc('Csp App Loop');
  // named words (the ripple, p-d182-ripple-E): the pre-D182 words; under the measured ones a 50 m tight on a 31 m road folds
  for (const w of ['straight', 'straight', 'tight', 'straight', 'tight']) d = appendOld(D, d, w, { speed: kmh(200) });
  d = D.editWord(d, 'w3', { handles: { length: 50 } });
  const c = closeLoop(d); assert.ok(c.candidates.length, c.reason);
  const doc = c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-app-csp-')); made.push(out);
  const storage = {
    saveDoc: async () => {}, openDoc: async () => null, listDocs: async () => [], saveLibrary: async () => {}, openLibrary: async () => null,
    writeExport: async (dir, folder, files) => { for (const f of files) { const p = path.join(dir, folder, ...f.path.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); } },
  };
  const s = await createShell({ storage, exporter: await makeExporter(async (p) => fs.readFileSync(path.join(REPO, p), 'utf8')) });
  s.adopt(doc.words.reduce((x, w) => D.editWord(x, w.id, { speed: kmh(200) }), doc));
  await s.exportTo(out);
  const st = s.getState();
  assert.equal(st.exportReds, null, st.message);
  assert.ok(st.message.includes(CSP_ONLY_WARNING), st.message);
  assert.match(fs.readFileSync(path.join(out, st.lastExport.folders[0], 'data', 'surfaces.ini'), 'utf8'), /^WAV_PITCH=extended-0$/m);
});
