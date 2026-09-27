#!/usr/bin/env node
// export_words.js: a document of words, as text (src/doc serialize), becomes an AC track folder in out/.
//
//   node scripts/export_words.js <track.json>                          the folder with the soft-collision block
//   node scripts/export_words.js <track.json> --variant both           also the _noblock control (ARCHITECTURE §10.1)
//   node scripts/export_words.js <track.json> --no-csp                 validate for vanilla AC (steep surfaces are red)
//   node scripts/export_words.js <track.json> --out <dir>              somewhere other than out/
//   node scripts/export_words.js <track.json> --no-self-check          skip C's self-intersection check (said in the output)
//
// Nothing is installed and no game is launched (the keeper, 2026-09-27 12:17). The work is src/export/fromwords.js; a
// red document, an open loop or an empty one is refused with its reasons and nothing is written.
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('../src/doc/index.js');
const { exportTrack } = require('../src/export/fromwords.js');

const REPO = path.resolve(__dirname, '..');

function arg(argv, name) { const i = argv.indexOf(name); if (i < 0) return undefined; if (i + 1 >= argv.length) throw new Error(`${name} needs a value`); return argv[i + 1]; }

function main(argv) {
  const file = argv.find((a, i) => !a.startsWith('--') && !['--variant', '--out'].includes(argv[i - 1]));
  if (!file) throw new Error('usage: node scripts/export_words.js <track.json> [--variant block|noblock|both] [--no-csp] [--no-self-check] [--out <dir>]');
  const doc = D.parse(fs.readFileSync(file, 'utf8'));
  const outDir = path.resolve(arg(argv, '--out') || path.join(REPO, 'out'));
  const r = exportTrack(doc, { outDir, variant: arg(argv, '--variant') || 'block', csp: !argv.includes('--no-csp'), selfCheck: !argv.includes('--no-self-check') });
  console.log(`exported ${r.lengthM.toFixed(1)} m (${r.resolvedVia}); kn5 ${r.kn5Bytes} B sha256 ${r.kn5Sha.slice(0, 16)}…`);
  console.log(`  read back by tools/kn5.cjs: version ${r.readback.version}, ${r.readback.meshes} meshes, markers ${r.readback.dummies.filter((n) => /^AC_/.test(n)).join(' ')}`);
  console.log(`  ai/fast_lane.ai: ${r.aiLine.points} points, ${r.aiLine.lengthM.toFixed(1)} m, ${r.aiLine.speedKmh} km/h`);
  for (const f of r.folders) console.log(`  ${path.relative(REPO, f.dir) || f.dir}: ${f.files.length} files (${f.variant})`);
  for (const w of r.warnings) console.log(`  warning: ${w}`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`export_words: ${e.message}`); process.exitCode = 1; }
}
module.exports = { main };
