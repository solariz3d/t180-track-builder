// core_close_flip.test.js: node --test test/core_close_flip.test.js
// 2026-10-14, reported on ELYSIUM: the end met the start to 18 cm and 0.57°, and Close still refused ("the road would roll too fast there"). The lap goes over
// the top of a loop, so its frame is carried as (heading + 180°, 180° − pitch, bank + 180°): the SAME orientation written the other way. The closer compared
// the channels as written and set out to roll the end 180°. It now measures the seam in whichever form the lap is in. Finish to start had the same blind spot
// (it rolled an upright end over, reading bank −180° as upside down).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core/close.js');
const { toPath } = require('../src/core/adapter.js');
const { flippedLap } = require('./core_close_flip_lap.js');
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const ends = (d) => { const S = toPath({ ...d, closed: false }).path.samples; return { a: S[0], z: S.at(-1) }; };

test('a lap end in the flipped frame that faces the start exactly has no heading, pitch or bank left to close', () => {
  const d = flippedLap(), { a, z } = ends(d);
  assert.ok(dot(a.T, z.T) > 1 - 1e-9 && dot(a.L, z.L) > 1 - 1e-9, 'control: the end faces the way the start does, upright');
  const m = C.residual(d), at = (n) => m.r[m.names.indexOf(n)];
  for (const n of ['net heading − 2πk', 'net pitch', 'bank at the seam']) assert.ok(Math.abs(at(n)) < 1e-6, `${n}: ${at(n)} rad`);
});

test('the whole-lap close of a flipped-frame lap converges and the seam meets in position and frame', () => {
  const d = flippedLap(), res = C.close(d, { edited: [d.pieces.length - 1] });
  assert.ok(res.converged && res.doc.closed, res.report);
  const { a, z } = ends(res.doc);
  assert.ok(Math.hypot(z.pos[0] - a.pos[0], z.pos[1] - a.pos[1], z.pos[2] - a.pos[2]) < 0.01, 'position');
  assert.ok(dot(a.T, z.T) > Math.cos(1e-3) && dot(a.L, z.L) > Math.cos(1e-3), 'the frame meets: tangent and left');
});

test('Finish to start from a flipped-frame end lays no roll (the end is already upright) and closes the lap', () => {
  const { finishToStart } = require('../src/core/finish.js');
  const d = flippedLap(), fin = finishToStart(d);
  assert.doesNotMatch(fin.plan.report, /roll/, `no roll on an upright end: ${fin.plan.report}`);
  const { a, z } = ends({ ...fin.doc, closed: false });
  assert.ok(fin.doc.closed, 'closed');
  assert.ok(Math.hypot(z.pos[0] - a.pos[0], z.pos[1] - a.pos[1], z.pos[2] - a.pos[2]) < 0.01 && dot(a.T, z.T) > Math.cos(1e-3) && dot(a.L, z.L) > Math.cos(1e-3), 'the seam meets in position and frame');
  const turned = fin.plan.report.match(/turn (-?[\d.]+)°/g) || [];
  assert.ok(turned.every((t) => Math.abs(parseFloat(t.slice(5))) < 270), `no near-full-circle turn (the mirrored-turn sign): ${fin.plan.report}`);
});

// 2026-10-15, reported on ELYSIUM: Level curved the road DOWN. Level corrects the end's physical pitch through the climb channel, and in the flipped
// frame more climb pitches the road physically down, so every correction went the wrong way: ELYSIUM's −0.50° became −1.01°.
test('Level on a flipped-frame end with a slope ends level (pitch 0), as it does on an upright track', () => {
  const { extend } = require('../src/core/extend.js'), L = require('../src/core/level.js');
  const pitchOf = (d) => { const S = toPath({ ...d, closed: false }).path.samples, T = S.at(-1).T; return Math.atan2(T[1], Math.hypot(T[0], T[2])); };
  const sloped = extend(flippedLap(), { length: 300, targets: { kv: 0.0015 } });
  assert.ok(Math.abs(pitchOf(sloped)) > 0.05, `control: the end slopes (${(pitchOf(sloped) * 180 / Math.PI).toFixed(2)}°)`);
  const lv = L.extendLevel(sloped, { length: 400 });
  assert.ok(Math.abs(pitchOf(lv)) < 1e-4, `Level ends level: ${(pitchOf(lv) * 180 / Math.PI).toFixed(4)}°`);
  // To floor from the levelled end (from an end still sloping down it refuses, flipped or not: a limit of its own, not the frame)
  const fl = L.extendToFloor(lv, { length: 2500 }), endY = toPath({ ...fl, closed: false }).path.samples.at(-1).pos[1];
  assert.ok(Math.abs(pitchOf(fl)) < 1e-4 && Math.abs(endY) < 0.01, `To floor ends level on the floor: ${(pitchOf(fl) * 180 / Math.PI).toFixed(4)}°, ${endY.toFixed(3)} m`);
});
