// release.test.js: node --test test/release.test.js. The release script's two checks (src-tauri/release.cjs): the path
// remapping it gives rustc, and the private-path scan it runs on the finished exe and installer. The build itself is not
// run here (it takes minutes and belongs to the release lap); these are its pure parts. Paths below are made up.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src-tauri/release.cjs');

test('the remap covers cargo\'s home (CARGO_HOME, else <home>/.cargo) and the repository, each to a neutral name', () => {
  assert.deepEqual(R.remapFlags({ env: {}, home: 'C:\\Users\\someone', repo: 'D:\\work\\t180' }),
    ['--remap-path-prefix=C:\\Users\\someone\\.cargo=/cargo', '--remap-path-prefix=D:\\work\\t180=/t180']);
  assert.equal(R.remapFlags({ env: { CARGO_HOME: 'E:\\cargo' }, home: 'C:\\Users\\someone', repo: 'D:\\r' })[0], '--remap-path-prefix=E:\\cargo=/cargo');
});

test('the scan finds the user\'s name as a path part and the home folder, in either slash form, any case', () => {
  const needles = R.privateNeedles({ home: 'C:\\Users\\someone', user: 'someone' });
  const buf = Buffer.from('x panicked at C:\\Users\\someone\\.cargo\\registry\\src\\a.rs y c:/users/SOMEONE/.cargo z');
  const found = R.scanForPrivate(buf, needles);
  assert.deepEqual(found.map((f) => f.needle).sort(), ['/someone/', 'C:/Users/someone', 'C:\\Users\\someone', '\\someone\\'].sort());
  assert.equal(found.find((f) => f.needle === 'C:\\Users\\someone').count, 1);
});

test('a clean binary scans clean: a remapped path and an unrelated word that contains the name do not count', () => {
  const needles = R.privateNeedles({ home: 'C:\\Users\\someone', user: 'someone' });
  assert.deepEqual(R.scanForPrivate(Buffer.from('/cargo/registry/src/a.rs  someonething  isSomeoneElse'), needles), []);
});
