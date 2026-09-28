// read_track_hints.test.js: node --test --test-concurrency=4 test/read_track_hints.test.js. The reader's two hints (length and
// width, tools/read_track.cjs line 9-12). D182: the builder's ui_track.json had "width": "", a caller passed parseFloat('') as
// "NaN", and the reader turned it into a NaN width that silently disarmed its narrowest-cut search (two builder laps lost at
// 640 m and 348 m, p-d182-reader-C §1). Stated before the test: a hint that is empty, not a number, negative or infinite is
// REFUSED by name, with a non-zero exit, before the reader touches the track folder; it is never turned into a width. An
// absent hint and "0" still mean "no hint", and a number is still taken.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const READER = path.join(__dirname, '..', 'tools', 'read_track.cjs');
const NOWHERE = path.join(__dirname, 'no-such-track-folder');   // the refusal must come before the folder is read

const run = (...args) => spawnSync(process.execPath, [READER, NOWHERE, ...args], { encoding: 'utf8', timeout: 30000 });

for (const [what, args] of [['width', ['500', 'NaN']], ['width', ['500', '']], ['width', ['500', ' ']], ['width', ['500', 'abc']],
  ['width', ['500', '-3']], ['width', ['500', 'Infinity']], ['length', ['NaN', '0']], ['length', ['', '0']]]) {
  test(`read_track: a ${what} hint of ${JSON.stringify(args[what === 'width' ? 1 : 0])} is refused by name, before the folder is read`, () => {
    const r = run(...args);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(`read_track: the ${what} hint must be a number ≥ 0 \\(0 = no hint\\)`));
    assert.doesNotMatch(r.stderr, /ENOENT/);
  });
}

for (const args of [[], ['500'], ['500', '0'], ['500', '28.7'], ['0', '0']]) {
  test(`read_track: hints ${JSON.stringify(args)} are taken, so the reader goes on to the folder (and fails there, on the missing folder)`, () => {
    const r = run(...args);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stderr, /hint must be/);
    assert.match(r.stderr, /ENOENT/);
  });
}
