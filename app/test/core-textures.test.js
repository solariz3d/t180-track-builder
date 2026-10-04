// core-textures.test.js: node --test app/test/core-textures.test.js   (under the heavy-run lock, --max-old-space-size=4096)
// D228: the road surface of an equation-core track (app/core/textures.js): asphalt by default, the solid colour one click away, a picture of the
// user's own, and the set it announces is the one the core page's Export writes (app/core/coreshell.js exportTo -> exporter.runSegments).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { createCoreShell } = require('../core/coreshell.js');
const { createCoreTextures, roadIds, ASPHALT } = require('../core/textures.js');
const { makeExporter } = require('../export/export.js');
const T = require('../../src/texture/index.js');

const REPO = path.resolve(__dirname, '..', '..');
const fromDisk = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const R = 180, Q = Math.PI * R / 2;
async function lap(opts = {}) {
  const s = await createCoreShell({ brushFn: null, ...opts });
  s.extend({ length: 300, family: 'bowl' });
  for (let i = 0; i < 4; i++) s.extend({ length: Q, transition: 40, targets: { kh: 1 / R } });
  s.extend({ length: 60, transition: 40, targets: { kh: 0 } });
  assert.equal(s.getState().message, null); return s;
}
const memStorage = () => { const s = { writes: [] }; return Object.assign(s, { saveDoc: async () => {}, openDoc: async () => null, listDocs: async () => [], writeExport: async (dir, folder, files) => { s.writes.push({ dir, folder, n: files.length }); for (const f of files) { const p = path.join(dir, folder, ...f.path.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); } } }); };
const segsOf = (s) => s.getState().resolved.segments;
const png = () => T.png.encodePng({ width: 32, height: 8, rgba: Uint8Array.from({ length: 32 * 8 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i >> 4) & 1 ? 230 : 40)) }, zlib.deflateSync);

test('the default road is the asphalt preset: every road piece\'s floor wears the made asphalt, announced once at the start', async () => {
  const s = await lap(), seen = [], ctl = createCoreTextures({ segments: () => segsOf(s), onChange: (set) => seen.push(set) });
  assert.equal(ctl.kind, 'asphalt'); assert.equal(seen.length, 1); const set = ctl.current(); assert.ok(set && seen[0] === set);
  assert.deepEqual(roadIds(segsOf(s)), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  for (const id of roadIds(segsOf(s))) { const f = set.bySegment(id).floor; assert.equal(f.settings.make, ASPHALT); assert.ok(/^t180b_floor_made-/.test(f.material)); }
  assert.equal(set.textures.length, 1); assert.ok(set.textures[0].made && /^t180b_made-.*\.dds$/.test(set.textures[0].file)); assert.equal(set.bySegment('nope'), null);
  assert.ok(!set.textures.some((t) => /solid/.test(t.name)), 'nothing is bundled or copied: the one texture is the maker\'s own render of our preset');
});

test('the solid colour is one click away and back: no set at all (the export is what it was), then the asphalt again', async () => {
  const s = await lap(), seen = [], ctl = createCoreTextures({ segments: () => segsOf(s), onChange: (set) => seen.push(set) });
  ctl.setKind('solid'); assert.equal(ctl.current(), null); assert.equal(seen[seen.length - 1], null); assert.equal(ctl.kind, 'solid');
  ctl.setKind('asphalt'); assert.ok(ctl.current() && ctl.current().textures.length === 1);
  assert.throws(() => ctl.setKind('marble'), /asphalt, solid or image/);
  assert.equal(createCoreTextures({ segments: () => segsOf(s), kind: 'solid' }).current(), null, 'a remembered solid choice starts solid');
});

test('bring-your-own stays: a PNG becomes the road surface under its name; a refused file or name changes nothing and says why', async () => {
  const s = await lap(), ctl = createCoreTextures({ segments: () => segsOf(s) });
  ctl.addImage('my-road', png()); const set = ctl.current();
  assert.equal(ctl.kind, 'image'); assert.equal(ctl.state.image, 'my-road'); assert.equal(set.bySegment('p3').floor.settings.texture, 'my-road'); assert.ok(set.textures.some((t) => t.name === 'my-road' && !t.made));
  const before = ctl.current(); ctl.addImage('Bad Name', png());
  assert.match(ctl.state.error, /lower-case letters/); assert.equal(ctl.current(), before, 'a bad name leaves the road as it was');
  ctl.addImage('junk', new Uint8Array([1, 2, 3, 4])); assert.ok(ctl.state.error, `a file that is not an image is refused: ${ctl.state.error}`); assert.equal(ctl.state.image, 'my-road'); assert.equal(ctl.current(), before);
  ctl.setKind('asphalt'); ctl.setKind('image'); assert.equal(ctl.kind, 'image', 'the picture added last is one click away');
  const none = createCoreTextures({ segments: () => segsOf(s) }); none.setKind('image'); assert.match(none.state.error, /add a picture first/); assert.equal(none.kind, 'asphalt');
});

test('a new piece is a new segment id the set must know: refresh() covers it, and the set is reused while the pieces are the same', async () => {
  const s = await lap(), ctl = createCoreTextures({ segments: () => segsOf(s) }), a = ctl.current();
  assert.equal(ctl.refresh(), a, 'same pieces: the very same set');
  const t = await createCoreShell({ brushFn: null }); t.extend({ length: 100 }); const c2 = createCoreTextures({ segments: () => segsOf(t) }), s1 = c2.current(); assert.equal(s1.bySegment('p2'), null);
  t.extend({ length: 100 }); assert.equal(c2.current().bySegment('p2'), null, 'not rebuilt by itself'); const s2 = c2.refresh(); assert.ok(s2.bySegment('p2') && s2.bySegment('p1'));
});

test('the Export on the core page writes the set: with it the folder has the DDS and the kn5 wears the material; without it, the solid road as before', async () => {
  const st = memStorage(), ex = await makeExporter(fromDisk), s = await lap({ storage: st, exporter: ex }); s.close();
  const ctl = createCoreTextures({ segments: () => segsOf(s) }), set = ctl.current(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-coretex-')); made.push(dir);
  await s.exportTo(dir, { textures: set });
  assert.equal(s.getState().messageKind, 'ok', s.getState().message);
  const folder = path.join(dir, st.writes[0].folder), files = fs.readdirSync(folder);
  const kn5 = fs.readFileSync(path.join(folder, files.find((f) => /\.kn5$/.test(f))));
  assert.ok(kn5.includes(Buffer.from(set.textures[0].file)), 'the kn5 names the DDS file');
  assert.ok(kn5.includes(Buffer.from(set.textures[0].dds)), 'the kn5 embeds the set\'s DDS, byte for byte (the DDS lives inside the kn5, as AC reads it)');
  assert.ok(kn5.includes(Buffer.from(set.materials.find((m) => m.slot === 'floor').material.name)), 'and its material');
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-coretex-')); made.push(dir2); const st2 = memStorage();
  const s2 = await lap({ storage: st2, exporter: ex }); s2.close(); await s2.exportTo(dir2);
  const kn5b = fs.readFileSync(path.join(dir2, st2.writes[0].folder, fs.readdirSync(path.join(dir2, st2.writes[0].folder)).find((f) => /\.kn5$/.test(f))));
  assert.ok(!kn5b.includes(Buffer.from(set.textures[0].file)), 'without a set the kn5 has no made texture');
});

test('the panel mounts (headless DOM): it announces the asphalt at once, follows the choice, the picture and the track\'s new pieces, and the page gets the set through t180:textures', async () => {
  const fake = require('./palette-fakedom.js'), restore = fake.install(), prevCE = global.CustomEvent;
  global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
  Object.defineProperty(fake.Element.prototype, 'classList', { configurable: true, get() { return { toggle: () => {} }; } });
  fake.Element.prototype.dispatchEvent = function (e) { (this.events = this.events || []).push(e); return true; };
  try {
    const { mount } = require('../core/textures.js'), shell = await createCoreShell({ brushFn: null }); shell.extend({ length: 100 });
    const root = document.createElement('section'), ctl = await mount(root, shell);
    const row = root.children[0], pick = row.children[1], file = row.children[2], head = root.children[1], sets = () => root.events.map((e) => e.detail.set);
    assert.ok(sets().length >= 1 && sets().every((s) => s && s.bySegment('p1').floor.settings.make), 'the asphalt is announced at the start, before any click');
    assert.match(head.textContent, /road surface: asphalt/); assert.equal(pick.value, 'asphalt');
    pick.value = 'solid'; pick.onchange(); assert.equal(sets().pop(), null); assert.match(head.textContent, /solid colour/);
    pick.value = 'asphalt'; pick.onchange(); assert.ok(sets().pop()); const n = root.events.length;
    assert.equal(sets().pop().bySegment('p2'), null, 'control: the track has one piece so far'); shell.extend({ length: 100 });
    assert.ok(root.events.length > n && sets().pop().bySegment('p2'), 'a new piece is announced with its own segment id: the panel follows the track');
    file.files = [{ name: 'My Road.PNG', arrayBuffer: async () => png().buffer.slice(png().byteOffset, png().byteOffset + png().byteLength) }]; await file.onchange();
    assert.equal(ctl.kind, 'image'); assert.match(head.textContent, /your picture "my-road"/); assert.ok(sets().pop().textures.some((t) => t.name === 'my-road'));
  } finally { restore(); global.CustomEvent = prevCE; delete fake.Element.prototype.dispatchEvent; delete fake.Element.prototype.classList; }
});
