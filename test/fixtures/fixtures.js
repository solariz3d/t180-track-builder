// D190 row 5 (pane E): the /2 MIGRATION FIXTURES and their RENDER DIGESTS, made at t180 c964c2d (the last code that writes /2).
//   node fixtures.js <t180 tree> <out dir>          writes <name>.core2.json per fixture and manifest.json
//   node fixtures.js <t180 tree> <out dir> --check  re-renders every fixture FILE in <out dir> with <t180 tree>'s code (after
//                                                   parse, i.e. after the /2 → /3 migration) and compares every digest
// A digest is sha256 over canonical BYTES, never over a float printed short:
//   segs  JSON of every segment the adapter emits (toSegments), keys sorted; JSON prints a double so it reads back bit-equal
//   path  Float64 little-endian bytes of every path sample's s, pos, T, L, U, kvec, roll, bankG, grade (toPath, lifted)
//   mesh  every mesh of buildMesh's scene, in walk order: its name, then the raw bytes of each typed array it carries
//   kn5   the exported kn5's bytes (closed fixtures only; buildFromSegments with its defaults)
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [, , TREE, OUT, flag] = process.argv;
const T = path.resolve(TREE) + '/';
const D = require(T + 'src/core/document.js'), { extend } = require(T + 'src/core/extend.js'), { close } = require(T + 'src/core/close.js');
const AD = require(T + 'src/core/adapter.js'), SC = require(T + 'src/core/sculpt.js'), { buildMesh } = require(T + 'src/geom/mesh.js');
const { walkScene } = require(T + 'src/export/markers.js'), FW = require(T + 'src/export/fromwords.js'), { startLayout } = require(T + 'app/core/coreshell.js');
const DEG = Math.PI / 180, sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])])) : x);
function digests(doc) {
  if (!doc.pieces.length) return { segs: refusal(() => AD.toSegments(doc)) };   // an empty track: the adapter's refusal is the render
  const segs = AD.toSegments(doc), { path: p } = AD.toPath(doc);
  const f = []; for (const m of p.samples) f.push(m.s, ...m.pos, ...m.T, ...m.L, ...m.U, ...m.kvec, m.roll, m.bankG, m.grade);
  const mesh = buildMesh(p, segs), parts = [];
  for (const m of walkScene(mesh.scene).meshes) { parts.push(Buffer.from(String(m.name))); for (const k of Object.keys(m).sort()) { const v = m[k]; if (ArrayBuffer.isView(v)) parts.push(Buffer.from(k), Buffer.from(v.buffer, v.byteOffset, v.byteLength)); } }
  const out = { segs: sha(JSON.stringify(sortKeys(segs))), path: sha(Buffer.from(Float64Array.from(f).buffer)), mesh: sha(Buffer.concat(parts)), meshParts: parts.length };
  if (doc.closed) {
    const start = { pos: doc.start.pos.slice(), theta: doc.start.heading, p: doc.start.pitch }, lift = (q) => AD.offsetPath(doc, segs, q);
    const ex = FW.buildFromSegments(segs, { name: 'fixture', via: 'fixture', liftPath: lift, start }, { markers: startLayout(segs, lift, start) });
    out.kn5 = sha(Buffer.from(ex.kn5.buffer ? Buffer.from(ex.kn5.buffer, ex.kn5.byteOffset, ex.kn5.byteLength) : ex.kn5));
  }
  return out;
}
function refusal(fn) { try { fn(); return 'NOT_REFUSED'; } catch (e) { return `refused ${e.code}`; } }

// ── the fixtures (each a pure function of c964c2d's core; names say what each one covers) ──
const R = 180, Q = Math.PI * R / 2;
const lap = (family, width) => {
  let d = D.createDoc(`F lap ${family}`);
  d = extend(d, { length: 300, family, first: width ? { w: width } : undefined });
  for (let i = 0; i < 4; i++) d = extend(d, { length: Q, transition: 40, targets: { kh: 1 / R } });
  d = extend(d, { length: 60, transition: 40, targets: { kh: 0 } });
  const r = close(d, { edited: [0] }); return r.doc || r;
};
const FIX = {
  'F1-bowl-default-lap-closed': () => lap('bowl'),
  'F2-halfpipe-default-lap-closed': () => lap('half-pipe'),
  'F3-bowl-narrow-12m-cap-binds': () => { let d = D.createDoc('F3'); d = extend(d, { length: 120, family: 'bowl', first: { w: 12 } }); d = extend(d, { length: 150, transition: 60, targets: { kh: 1 / 90, phi: 25 * DEG } }); return extend(d, { length: 150, transition: 60, targets: { kh: -1 / 120, phi: -20 * DEG } }); },
  'F4-halfpipe-width-31.5-to-12-along-s': () => { let d = D.createDoc('F4'); d = extend(d, { length: 100, family: 'half-pipe' }); return extend(d, { length: 200, transition: 200, targets: { w: 12, kv: 0.002 } }); },
  'F5-flat-20m-bank-30': () => { let d = D.createDoc('F5'); d = extend(d, { length: 80, family: 'flat', first: { w: 20 } }); return extend(d, { length: 160, transition: 80, targets: { phi: 30 * DEG, kh: 1 / 150 } }); },
  'F6-bowl-r-brushed': () => { let d = D.createDoc('F6'); d = extend(d, { length: 200, family: 'bowl' }); d = extend(d, { length: 200 }); return SC.brush(d, { mode: 'value', channel: 'r', s0: 210, r: 60, delta: -2.2 }).doc; },
  'F7-hill-then-jump': () => { let d = D.createDoc('F7'); d = extend(d, { length: 200, family: 'bowl' }); d = SC.brush(d, { mode: 'hill', s0: 90, r: 50, delta: 4 }).doc; d = D.appendPiece(d, D.flightPiece({ gap: 30, drop: 2, land: -0.05 })); return extend(d, { length: 120 }); },
  'F8-mixed-families': () => { let d = D.createDoc('F8'); d = extend(d, { length: 100, family: 'flat' }); d = extend(d, { length: 100, family: 'bowl', transition: 50, targets: { w: 31 } }); return extend(d, { length: 100, family: 'half-pipe', transition: 50, targets: { w: 31.5, r: 4.55 } }); },
  'F9-empty': () => D.createDoc('F9 empty'),
};

fs.mkdirSync(OUT, { recursive: true });
if (flag !== '--check') {
  const manifest = { made_at: 't180 c964c2d', schema: D.SCHEMA, fixtures: {} };
  for (const [name, make] of Object.entries(FIX)) {
    const doc = make(), text = D.serialize(doc), file = `${name}.core2.json`;
    fs.writeFileSync(path.join(OUT, file), text);
    const d1 = digests(D.parse(text)), d2 = digests(D.parse(fs.readFileSync(path.join(OUT, file), 'utf8')));
    if (JSON.stringify(d1) !== JSON.stringify(d2)) throw new Error(`${name}: the render is not deterministic within one process`);
    manifest.fixtures[name] = { file, text_sha256: sha(text), pieces: doc.pieces.length, closed: doc.closed, render: d1 };
    console.log(name, JSON.stringify(manifest.fixtures[name]));
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
} else {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')); let bad = 0;
  for (const [name, m] of Object.entries(manifest.fixtures)) {
    const text = fs.readFileSync(path.join(OUT, m.file), 'utf8');
    if (sha(text) !== m.text_sha256) { console.log(`${name}: FIXTURE FILE CHANGED`); bad++; continue; }
    const got = digests(D.parse(text)), diff = Object.keys(m.render).filter((k) => got[k] !== m.render[k]);
    console.log(`${name}: ${diff.length ? `DIFFERS in ${diff.join(', ')}` : 'identical'}`); if (diff.length) bad++;
  }
  console.log(`${bad} of ${Object.keys(manifest.fixtures).length} differ`); process.exitCode = bad ? 1 : 0;
}
