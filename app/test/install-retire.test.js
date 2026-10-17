// install-retire.test.js: node --test app/test/install-retire.test.js
// D372 amendment: when Export to Assetto Corsa moved a track's stale ghost and HUD laps aside (the shape changed; src-tauri/src/lib.rs install_with_retire
// hands back `retired`, the new paths, and `retire_error`), the install message says so, and where; a move that failed is said plainly too. Rows:
//   1  retired holds a ghost folder and a lap file: the message names both new paths, says the shape changed and that moving them back restores them
//   2  retired empty: today's message, byte for byte (the same as a native side that hands back only a count, or nothing)
//   3  retire_error set: the message says the laps could not be moved, with the reason; the install is still ok
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstaller } = require('../install/install.js');

const GHOST = 'C:\\Users\\u\\Documents\\Assetto Corsa\\GhostCar\\t180b_x.retired-2026-10-17_180000Z';
const LAP = 'C:\\Users\\u\\Documents\\Assetto Corsa\\CMRT-Essential-HUD\\t180b_x.retired-2026-10-17_180000Z\\t180b_x[#]T-180 Mach 6[v1]fast.lap';
/** an installer whose native install_track answers `answer` (as the native command does since D372), over a closed track named X */
function installer(answer) {
  const native = { getAcRoot: async () => 'G:\\assettocorsa', installTrack: async () => answer };
  const build = () => ({ folders: [{ folder: 't180b_x', files: [{ path: 't180b_x.kn5', bytes: new Uint8Array(1) }] }], result: { warnings: [] } });
  return createInstaller({ build, native, getDoc: () => ({ name: 'X' }) });
}

test('row 1: retired holds a ghost folder and a lap file: the message names both new paths, why, and that moving them back restores them', async () => {
  const r = await installer({ files: 2, retired: [GHOST, LAP], retire_error: null }).install();
  assert.equal(r.ok, true);
  assert.ok(r.message.includes(GHOST), `the ghost's new place: ${r.message}`);
  assert.ok(r.message.includes(LAP), `the lap file's new place: ${r.message}`);
  assert.match(r.message, /shape changed/);
  assert.match(r.message, /move them back to restore them/);
});

test('row 2: retired empty gives today\'s message, byte for byte, the same as a count or nothing from the native side', async () => {
  const today = (await installer(undefined).install()).message;
  assert.equal(today, 'exported "X" into Assetto Corsa as t180b_x in G:\\assettocorsa\\content\\tracks\\t180b_x; exporting this track again updates that folder (the builder names every track t180b_…, so it can never overwrite a track it did not make)', 'control: the message as it was');
  assert.equal((await installer({ files: 2, retired: [], retire_error: null }).install()).message, today);
  assert.equal((await installer(2).install()).message, today);
});

test('row 3: retire_error set: the message says the old ghost and laps could not be moved, with the reason; the install still stands', async () => {
  const r = await installer({ files: 2, retired: [], retire_error: 'could not move X to Y: access denied' }).install();
  assert.equal(r.ok, true);
  assert.match(r.message, /could not be moved aside/);
  assert.ok(r.message.includes('could not move X to Y: access denied'), r.message);
});
