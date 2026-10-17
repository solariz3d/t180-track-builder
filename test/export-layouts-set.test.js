// export-layouts-set.test.js: node --test test/export-layouts-set.test.js. D361 part 2: several tracks as ONE AC track folder,
// laid out the way track N lays out its layouts (exo_memory/handback/p-d360-acside-E_2026-10-17.md §1), read back the
// way Content Manager finds layouts (cmLayouts below: AcTools TrackObject.cs, master e5e5c94b), the main layout by "priority",
// and a re-export that removes a dropped layout's own files and touches nothing it did not write. Temp folders only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/doc/index.js');
const { buildExport } = require('../src/export/fromwords.js');
const L = require('../src/export/layouts.js');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-layoutset-')); made.push(d); return d; };
const kmh = (v) => v / 3.6;
const TIGHT90 = { turn: Math.PI / 2, length: (Math.PI / 2) * 120 / 0.7 };
function stadium(name, straightM) {
  let d = D.createDoc(name);
  const S = { font: 'flat', handles: { length: straightM, width: 20 } }, T = { font: 'flat', handles: { ...TIGHT90, width: 20 } };
  for (const [w, o] of [['straight', S], ['tight', T], ['tight', T], ['straight', S], ['tight', T], ['tight', T]]) d = D.appendWord(d, w, { ...o, speed: kmh(200) });
  return D.checkDoc({ ...d, closed: true });
}
// three built tracks, built once (each is a whole export's work)
const B = { long: buildExport(stadium('Elysium', 600)), gp: buildExport(stadium('Elysium Alt', 450)), short: buildExport(stadium('Elysium Short', 300)) };
const entry = (layout, name, main = false) => ({ layout, name, main, b: B[layout] });

const { cmLayouts } = require('./cm_layouts.js');
const has = (dir, rel) => fs.existsSync(path.join(dir, ...rel.split('/')));
const SET = (folder, Lid) => [`${folder}_${Lid}.kn5`, `models_${Lid}.ini`, `${Lid}/data/surfaces.ini`, `${Lid}/data/map.ini`, `${Lid}/map.png`, `${Lid}/ai/fast_lane.ai`, `ui/${Lid}/ui_track.json`, `ui/${Lid}/preview.png`, `ui/${Lid}/outline.png`];

test('two tracks export to Aurora\'s folder shape: a whole kn5, a models file, data, ai, map and ui per layout, nothing at the root', () => {
  const out = tmp(), r = L.exportBuilt([entry('long', 'Elysium Long', true), entry('short', 'Elysium Short')], { outDir: out, name: 'Elysium' });
  assert.equal(r.folder, 't180b_elysium');
  for (const Lid of ['long', 'short']) for (const rel of SET(r.folder, Lid)) assert.ok(has(r.dir, rel), `${rel} written`);
  for (const Lid of ['long', 'short']) assert.equal(fs.readFileSync(path.join(r.dir, `models_${Lid}.ini`), 'utf8'), `[MODEL_0]\nFILE=t180b_elysium_${Lid}.kn5\nPOSITION=0,0,0\nROTATION=0,0,0\n`);
  assert.ok(fs.readFileSync(path.join(r.dir, 't180b_elysium_long.kn5')).equals(B.long.kn5), 'the long layout\'s kn5 is that track\'s whole kn5, byte for byte');
  assert.ok(fs.readFileSync(path.join(r.dir, 't180b_elysium_short.kn5')).equals(B.short.kn5));
  for (const rel of ['models.ini', 'data', 'ai', 'map.png', 'ui/ui_track.json', 'long/extension', 'short/extension', 'ui/long/extension']) assert.ok(!has(r.dir, rel), `no ${rel}`);
  const root = fs.readdirSync(r.dir).sort();
  assert.deepEqual(root, ['.t180b-builder.json', 'long', 'models_long.ini', 'models_short.ini', 'short', 't180b_elysium_long.kn5', 't180b_elysium_short.kn5', 'ui'], 'the root holds the models files, the kn5s, the layout folders, ui/ and the marker only');
});

test('Content Manager\'s discovery (ui/*/ui_track.json) finds both layouts, by their display names', () => {
  const out = tmp(), r = L.exportBuilt([entry('long', 'Elysium Long', true), entry('short', 'Elysium Short')], { outDir: out, name: 'Elysium' });
  const cm = cmLayouts(r.dir);
  assert.equal(cm.simple, false, 'no root ui_track.json: every layout is read from ui/<layout>/');
  assert.deepEqual(cm.layouts, ['long', 'short']);
  assert.deepEqual(cm.names, { long: 'Elysium Long', short: 'Elysium Short' });
});

test('the main layout has the highest priority, and Content Manager takes it as main even where its name rules prefer another', () => {
  // "gp" is one of CM's preferred words (+20 on the id, +200 on a name holding it): without priority CM would take it
  const out = tmp(), r = L.exportBuilt([entry('gp', 'Elysium GP'), entry('short', 'Elysium Short', true)], { outDir: out, name: 'Elysium' });
  const pr = (Lid) => JSON.parse(fs.readFileSync(path.join(r.dir, `ui/${Lid}/ui_track.json`), 'utf8')).priority;
  assert.ok(pr('short') > pr('gp'), `main ${pr('short')} > other ${pr('gp')}`);
  assert.equal(cmLayouts(r.dir).main, 'short');
  // control: the same folder without the priority field, CM's own rules pick gp
  for (const Lid of ['gp', 'short']) { const f = path.join(r.dir, `ui/${Lid}/ui_track.json`), j = JSON.parse(fs.readFileSync(f, 'utf8')); delete j.priority; fs.writeFileSync(f, JSON.stringify(j)); }
  assert.equal(cmLayouts(r.dir).main, 'gp', 'control: without priority the name rule wins');
});

test('exactly one main layout, unique layout names and a display name for each, or nothing is written', () => {
  const out = tmp();
  const code = (entries) => { try { L.exportBuilt(entries, { outDir: out, name: 'Elysium' }); return 'written'; } catch (e) { return e.code; } };
  assert.equal(code([entry('long', 'Elysium Long'), entry('short', 'Elysium Short')]), 'MAIN_LAYOUT');
  assert.equal(code([entry('long', 'Elysium Long', true), entry('short', 'Elysium Short', true)]), 'MAIN_LAYOUT');
  assert.equal(code([entry('long', 'Elysium Long', true), { ...entry('short', 'Elysium Short'), layout: 'long' }]), 'DUPLICATE_LAYOUT');
  assert.equal(code([entry('long', 'Elysium Long', true), { ...entry('short', ''), name: '  ' }]), 'BAD_LAYOUT_NAME');
  assert.equal(code([{ ...entry('long', 'Elysium Long', true), layout: 'Long Way' }, entry('short', 'Elysium Short')]), 'BAD_LAYOUT_NAME');
  assert.equal(code([]), 'EMPTY_DOC');
  assert.deepEqual(fs.readdirSync(out), [], 'nothing written for any refusal');
});

test('a re-export removes a dropped layout\'s own files and the folders they leave empty; a file somebody added is never touched', () => {
  const out = tmp(), opts = { outDir: out, name: 'Elysium' };
  const r1 = L.exportBuilt([entry('long', 'Elysium Long', true), entry('short', 'Elysium Short')], opts);
  // somebody adds their own files: a CSP config at the root, a note inside the short layout's data
  fs.mkdirSync(path.join(r1.dir, 'extension')); fs.writeFileSync(path.join(r1.dir, 'extension', 'ext_config.ini'), '[BASIC]\n');
  fs.writeFileSync(path.join(r1.dir, 'short', 'data', 'my_notes.txt'), 'mine');
  const r2 = L.exportBuilt([entry('long', 'Elysium Long', true), entry('gp', 'Elysium GP')], opts);
  assert.deepEqual(r2.removed.slice().sort(), SET('t180b_elysium', 'short').sort(), 'exactly the short layout\'s files, which the first marker listed');
  for (const rel of SET('t180b_elysium', 'short')) assert.ok(!has(r2.dir, rel), `${rel} removed`);
  for (const Lid of ['long', 'gp']) for (const rel of SET('t180b_elysium', Lid)) assert.ok(has(r2.dir, rel), `${rel} kept or written`);
  assert.ok(!has(r2.dir, 'ui/short'), 'ui/short left empty, so removed: Content Manager no longer lists the layout');
  assert.ok(!has(r2.dir, 'short/ai') && !has(r2.dir, 'short/ai/fast_lane.ai'), 'short/ai left empty, so removed');
  assert.equal(fs.readFileSync(path.join(r2.dir, 'short', 'data', 'my_notes.txt'), 'utf8'), 'mine', 'the added note is kept, and with it its folder');
  assert.equal(fs.readFileSync(path.join(r2.dir, 'extension', 'ext_config.ini'), 'utf8'), '[BASIC]\n', 'the added CSP config is kept');
  assert.deepEqual(cmLayouts(r2.dir).layouts, ['gp', 'long']);
  const marker = JSON.parse(fs.readFileSync(path.join(r2.dir, '.t180b-builder.json'), 'utf8'));
  assert.deepEqual(marker.files.slice().sort(), r2.files.slice().sort(), 'the marker lists this export\'s files');
});

test('a marker that cannot be read removes nothing and says so; a listed path outside the folder is never followed', () => {
  assert.deepEqual(L.staleFiles('{ broken', ['a.kn5']).stale, []);
  assert.match(L.staleFiles('{ broken', ['a.kn5']).warning, /could not be read/);
  assert.deepEqual(L.staleFiles(JSON.stringify({ files: ['../outside.txt', 'x/../../y', '/abs', 'C:\\w', 'ok/old.ini', '.t180b-builder.json', 'a.kn5'] }), ['a.kn5']).stale, ['ok/old.ini']);
  assert.equal(L.staleFiles(null, ['a.kn5']).stale.length, 0, 'no previous export: nothing to remove');
  const out = tmp(), opts = { outDir: out, name: 'Elysium' };
  const r1 = L.exportBuilt([entry('long', 'Elysium Long', true), entry('short', 'Elysium Short')], opts);
  const outside = path.join(out, 'outside.txt'); fs.writeFileSync(outside, 'theirs');
  const m = JSON.parse(fs.readFileSync(path.join(r1.dir, '.t180b-builder.json'), 'utf8')); m.files.push('../outside.txt'); fs.writeFileSync(path.join(r1.dir, '.t180b-builder.json'), JSON.stringify(m));
  const r2 = L.exportBuilt([entry('long', 'Elysium Long', true), entry('gp', 'Elysium GP')], opts);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'theirs', 'a file outside the track folder is never removed');
  assert.ok(r2.warnings.some((w) => /not inside the folder/.test(w)));
  fs.writeFileSync(path.join(r2.dir, '.t180b-builder.json'), '{ broken');
  const r3 = L.exportBuilt([entry('long', 'Elysium Long', true)], opts);
  assert.deepEqual(r3.removed, []); assert.ok(has(r3.dir, 'ui/gp/ui_track.json'), 'an unreadable marker removes nothing');
  assert.ok(r3.warnings.some((w) => /could not be read/.test(w)));
});

test('a stale path through a junction is never followed: what the junction points at is kept', () => {
  const out = tmp(), opts = { outDir: out, name: 'Elysium' };
  const r1 = L.exportBuilt([entry('long', 'Elysium Long', true), entry('short', 'Elysium Short')], opts);
  const elsewhere = path.join(out, 'elsewhere'); fs.mkdirSync(elsewhere); fs.writeFileSync(path.join(elsewhere, 'ui_track.json'), 'theirs');
  const ui = path.join(r1.dir, 'ui', 'short');
  fs.rmSync(ui, { recursive: true }); fs.symlinkSync(elsewhere, ui, 'junction');
  try {
    const r2 = L.exportBuilt([entry('long', 'Elysium Long', true), entry('gp', 'Elysium GP')], opts);
    assert.ok(!r2.removed.some((p) => p.startsWith('ui/short/')), 'nothing removed through the junction');
    assert.equal(fs.readFileSync(path.join(elsewhere, 'ui_track.json'), 'utf8'), 'theirs');
  } finally { fs.unlinkSync(ui); }   // the junction itself, never what it points at
});

test('a folder the builder did not write is refused untouched', () => {
  const out = tmp(); fs.mkdirSync(path.join(out, 't180b_elysium')); fs.writeFileSync(path.join(out, 't180b_elysium', 'theirs.kn5'), 'x');
  assert.throws(() => L.exportBuilt([entry('long', 'Elysium Long', true)], { outDir: out, name: 'Elysium' }), (e) => e.code === 'NOT_OURS');
  assert.deepEqual(fs.readdirSync(path.join(out, 't180b_elysium')), ['theirs.kn5']);
});
