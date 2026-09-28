#!/usr/bin/env node
// read.cjs (the track-equations skill, step 1): READ a track into reads/<name>.read.json with the repo's tested reader
// (tools/read_track.cjs), with READ_PROFILE=1 so the read carries the cross-section fields the fits use. The file goes to
// reads/, which git ignores (a read of another author's track is theirs, never committed), through fourier.cjs's
// writeLocal, which refuses any place git does not ignore.
//   node .claude/skills/track-equations/scripts/read.cjs <track folder> <name> [length m] [width m] [layout]
// The length and width are hints (0 = none), in read_track.cjs's order. Prints one summary line.
'use strict';
const path = require('path'), { spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const [dir, name, lengthM = '0', widthM = '0', layout] = process.argv.slice(2);
if (!dir || !name) { console.error('usage: read.cjs <track folder> <name> [length m] [width m] [layout]'); process.exit(1); }
if (!/^[A-Za-z0-9_-]+$/.test(name)) { console.error('the name is letters, digits, _ and - only'); process.exit(1); }
const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'read_track.cjs'), dir, lengthM, widthM, ...(layout ? [layout] : [])], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, READ_PROFILE: '1' } });
if (r.status !== 0) { process.stderr.write(r.stderr || `read_track exited ${r.status}\n`); process.exit(r.status || 1); }
const j = JSON.parse(r.stdout);
require(path.join(REPO, 'tools', 'fourier.cjs')).writeLocal(path.join(REPO, 'reads', `${name}.read.json`), r.stdout);
console.log(`${name}: ${j.end}, ${j.stations.length} stations → reads/${name}.read.json (gitignored)`);
