// nativefiles.test.js: node --test app/test/nativefiles.test.js
// The export's files go to the native side as bytes (app/lib/nativefiles.js), not as base64 text in JSON: Export to Assetto Corsa on ELYSIUM killed the
// page on 2026-10-31 in that text (the crash report's stack: stringify, the IPC, installTrack). Rows:
//   1  the body is the header length, the header (the command's arguments and each file's path and length) and the files' bytes, in order, and reads back
//   2  what is not files, or not bytes, is refused by name
//   3  UNDER A FIXED HEAP BUDGET (a child node, 160 MB of JavaScript heap), 150 MB of files: the page's old way (index.html's b64, then the JSON the IPC
//      sends) runs out of heap, the control that the budget bites; sendFiles hands over the same bytes and finishes
//   4  index.html sends every command that writes files (write_export, write_layouts_export, write_blender_export, install_track) through sendFiles, and
//      makes no base64 of a file
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { packFiles, sendFiles } = require('../lib/nativefiles.js');

/** The body read back, as src-tauri/src/lib.rs files_from_body reads it. */
function unpack(body) {
  const n = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + n)));
  let at = 4 + n; const files = head.files.map((f) => { const b = body.subarray(at, at + f.len); at += f.len; return { path: f.path, bytes: b }; });
  return { head, files, rest: body.length - at };
}

test('row 1: the body is the header length, the header and the files\' bytes in order, and reads back to the same arguments and bytes', () => {
  const files = [{ path: 't180b_x/t180b_x.kn5', bytes: new Uint8Array([1, 2, 3, 255]) }, { path: 't180b_x/empty.ini', bytes: new Uint8Array(0) }, { path: 't180b_x/ui/ü.json', bytes: Buffer.from('{"a":1}') }];
  const body = packFiles({ dir: 'C:\\Tracks\\folder é', folder: 't180b_x' }, files), back = unpack(body);
  assert.deepEqual(back.head, { dir: 'C:\\Tracks\\folder é', folder: 't180b_x', files: files.map((f) => ({ path: f.path, len: f.bytes.length })) });
  assert.deepEqual(back.files.map((f) => [f.path, Array.from(f.bytes)]), files.map((f) => [f.path, Array.from(f.bytes)]));
  assert.equal(back.rest, 0, 'nothing after the last file');
  const none = unpack(packFiles({ folder: 't180b_x' }, []));
  assert.deepEqual(none.head, { folder: 't180b_x', files: [] }); assert.equal(none.rest, 0, 'no files: the header alone');
  const sent = []; sendFiles((cmd, body2) => { sent.push([cmd, body2]); return 'answer'; }, 'install_track', { folder: 't180b_x' }, files);
  assert.equal(sent.length, 1); assert.equal(sent[0][0], 'install_track'); assert.ok(sent[0][1] instanceof Uint8Array, 'the body is bytes');
  assert.deepEqual(unpack(sent[0][1]).head.folder, 't180b_x');
});

test('row 2: a head that carries files, a file without bytes or a path, files that are not a list, and no native side are refused by name', () => {
  const ok = [{ path: 'a', bytes: new Uint8Array(1) }];
  assert.throws(() => packFiles({ folder: 'x', files: [] }, ok), /must not carry files/);
  assert.throws(() => packFiles(null, ok), /head must be an object/);
  assert.throws(() => packFiles({ folder: 'x' }, 'a'), /must be an array/);
  assert.throws(() => packFiles({ folder: 'x' }, [{ path: 'a', bytes: 'text' }]), /a has no bytes/);
  assert.throws(() => packFiles({ folder: 'x' }, [{ bytes: new Uint8Array(1) }]), /file 0 has no path/);
  assert.throws(() => sendFiles(null, 'write_export', { folder: 'x' }, ok), /no native side/);
});

// the child: 140 MB and 10 MB of file bytes (outside the JavaScript heap, as the export's transferred buffers are), then one way of handing them over
const CHILD = (way) => `
const files = [{ path: 't180b_x/t180b_x.kn5', bytes: new Uint8Array(140 * 1048576).fill(7) }, { path: 't180b_x/map.png', bytes: new Uint8Array(10 * 1048576).fill(9) }];
let out;
if (${JSON.stringify(way)} === 'old') {
  // index.html's b64 as it was up to 0.4.32, then the JSON text the IPC makes of the arguments
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  out = JSON.stringify({ folder: 't180b_x', files: files.map((f) => ({ path: f.path, data: b64(f.bytes) })) }).length;
} else {
  const { sendFiles } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'nativefiles.js'))});
  const body = sendFiles((cmd, b) => b, 'install_track', { folder: 't180b_x' }, files);
  const n = new DataView(body.buffer).getUint32(0, true); let same = body.length === 4 + n + 150 * 1048576;
  for (let i = 4 + n; same && i < body.length; i += 4093) same = body[i] === (i - 4 - n < 140 * 1048576 ? 7 : 9);
  out = same ? 'SAME' : 'DIFFERENT';
}
console.log('DONE ' + out);`;
const run = (way) => spawnSync(process.execPath, ['--max-old-space-size=160', '-e', CHILD(way)], { encoding: 'utf8', timeout: 120000 });

test('row 3: under a 160 MB heap, 150 MB of files: the old base64-in-JSON hand-over runs out of heap, sendFiles hands over the same bytes', () => {
  const old = run('old');
  assert.notEqual(old.status, 0, `control: the old way must not finish under the budget (it printed ${String(old.stdout).trim()})`);
  assert.match(String(old.stderr), /heap out of memory|Invalid string length|Allocation failed/i, 'control: it ran out of heap');
  const now = run('new');
  assert.equal(now.status, 0, `sendFiles finished under the budget (stderr: ${String(now.stderr).slice(0, 300)})`);
  assert.equal(String(now.stdout).trim(), 'DONE SAME', 'every byte handed over, in order');
});

test('row 4: index.html sends every command that writes files through sendFiles and makes no base64 of a file', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const cmd of ['write_export', 'write_layouts_export', 'write_blender_export', 'install_track']) {
    assert.match(html, new RegExp(`sendFiles\\('${cmd}'`), `${cmd} goes through sendFiles`);
    assert.doesNotMatch(html, new RegExp(`call\\('${cmd}'`), `${cmd} is not called with JSON arguments`);
  }
  assert.doesNotMatch(html, /\bb64\(|btoa\(/, 'no file is turned into base64 text');
});
