#!/usr/bin/env node
// fit-fourier.cjs (the track-equations skill, SKILL.md "The baseline that already works", and its steps 7-9 for that
// baseline: rebuild through buildPath, CHECK, report N): M4's whole-lap equation, a Fourier series per function, rebuilt through
// the builder's geometry and closed (tools/fourier.cjs; references/07). Prints numbers only; --write saves the
// coefficients to reads/<name>.equation.json (gitignored, never committed).
//   node .claude/skills/track-equations/scripts/fit-fourier.cjs <read.json> [--write]
//   node .claude/skills/track-equations/scripts/fit-fourier.cjs --sweep <reads dir> [--write]
'use strict';
const path = require('path'), { spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..', '..'), a = process.argv.slice(2);
const args = a[0] === '--sweep' ? ['sweep', a[1], ...a.slice(2)] : ['one', ...a];
const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'fourier.cjs'), ...args], { stdio: 'inherit', cwd: REPO });
process.exit(r.status || 0);
