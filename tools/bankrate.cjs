#!/usr/bin/env node
'use strict';
// bankrate.cjs: how fast real T-180 roads change their BANK along the road, in °/m, over the corpus's own layouts
// (tools/corpus.cjs LAYOUTS). src/doc/vocab.js BANK_RATE is its p90 at the steps where the bank is changing.
//
//   node tools/bankrate.cjs <reads dir>          → a summary, and `--json` for the numbers
//
// The roll at a station is the road normal n against the frame of the forward f and world up Y: L = unit(Y × f),
// U = f × L, roll = atan2(n·L, n·U), unwrapped along the road. A step is two consecutive stations at most 8 m apart;
// stations with no normal, or heading within 18° of vertical (a loop's top, where the frame is undefined), break the chain.
const fs = require('fs'), path = require('path');
const { LAYOUTS } = require('./corpus.cjs');

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const MOVING = 0.1; // °/m: a step whose bank changes slower than this is not "changing the bank"

/** Every step's |Δroll| / Δd (°/m) for one read. */
function ratesOf(read) {
  const out = []; let prev = null;
  for (const s of read.stations) {
    if (!s.f || !s.n) { prev = null; continue; }
    const f = unit(s.f); if (Math.abs(f[1]) > 0.95) { prev = null; continue; }
    const L = unit(cross([0, 1, 0], f)), U = cross(f, L);
    let roll = Math.atan2(dot(s.n, L), dot(s.n, U)) * 180 / Math.PI;
    if (prev) {
      const dd = s.d - prev.d;
      while (roll - prev.roll > 180) roll -= 360;
      while (roll - prev.roll < -180) roll += 360;
      if (dd > 0 && dd <= 8) out.push(Math.abs(roll - prev.roll) / dd);
    }
    prev = { d: s.d, roll };
  }
  return out;
}

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const band = (a) => ({ n: a.length, p50: q(a, 0.5), p90: q(a, 0.9), p99: q(a, 0.99), max: Math.max(...a) });

function build(dir) {
  const all = [], perLayout = {};
  for (const [file, name] of LAYOUTS) {
    const r = ratesOf(JSON.parse(fs.readFileSync(path.join(dir, `${file}.read.json`), 'utf8')));
    perLayout[name] = band(r); all.push(...r);
  }
  return { all: band(all), changing: band(all.filter((r) => r > MOVING)), perLayout };
}

if (require.main === module) {
  const dir = process.argv[2]; if (!dir) { console.error('usage: node tools/bankrate.cjs <reads dir> [--json]'); process.exit(2); }
  const b = build(dir);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(b, null, 2)); process.exit(0); }
  const row = (x) => `n ${x.n}  p50 ${x.p50.toFixed(3)}  p90 ${x.p90.toFixed(3)}  p99 ${x.p99.toFixed(3)}  max ${x.max.toFixed(2)}`;
  console.log('all road steps          ', row(b.all));
  console.log(`banking > ${MOVING}°/m        `, row(b.changing));
}

module.exports = { build, ratesOf, MOVING };
