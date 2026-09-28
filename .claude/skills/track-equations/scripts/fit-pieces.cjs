#!/usr/bin/env node
// fit-pieces.cjs (the track-equations skill, SKILL.md steps 2-6, 8 and 9; NOT step 7: the pieces are curves in space,
// checked against the mesh centreline directly, not rebuilt through buildPath): the PIECEWISE equation of a track, fitted to its MESH (tools/piecewise.cjs;
// references/01, 03, 04, 05): the centreline by cross-rays, split at jumps and long straights, adaptive cubic B-splines
// with G2 joints and exact closure, the flight checked at every jump. Prints numbers only; --write <name> saves the
// pieces to reads/<name>.pieces.json (gitignored, never committed). --curve adds control points against 10/5/2/1 m.
//   node .claude/skills/track-equations/scripts/fit-pieces.cjs <track folder> <read.json> [--layout L] [--tol 5] [--curve] [--write <name>]
'use strict';
const path = require('path'), { spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'piecewise.cjs'), ...process.argv.slice(2)], { stdio: 'inherit', cwd: REPO });
process.exit(r.status || 0);
