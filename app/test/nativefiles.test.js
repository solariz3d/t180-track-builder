// nativefiles.test.js: node --test app/test/nativefiles.test.js
// The export's files go to the native side as bytes (app/lib/nativefiles.js), not as base64 text in JSON: Export to Assetto Corsa on ELYSIUM killed the
// page on 2026-10-31 in that text (the crash report's stack: stringify, the IPC, installTrack). Rows:
//   1  the body is the header length, the header (the command's arguments and each file's path and length) and the files' bytes, in order, and reads back
//   2  what is not files, or not bytes, is refused by name
//   3  UNDER A FIXED HEAP BUDGET (a child node, 160 MB of JavaScript heap), 150 MB of files: the page's old way (index.html's b64, then the JSON the IPC
//      sends) runs out of heap, the control that the budget bites; sendFiles hands over the same bytes and finishes
//   4  index.html sends every command that writes files (write_export, write_layouts_export, write_blender_export, install_track) through sendFiles, and
//      makes no base64 of a file
//   5  A BODY LARGER THAN ONE PIECE goes in pieces (a 566 MB body killed the page in one call, 2026-10-31): every call's body is at most the piece size, the
//      pieces are stage_files calls in order whose bytes are packFiles' body, and the command follows with an empty body and the staged id; a body that fits
//      is one call, as before
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { packFiles, pieces, sendFiles } = require('../lib/nativefiles.js');

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
  // the native side as it receives the pieces: each stage_files body is [4-byte length][JSON { id, at, total }][bytes], put back where it says
  let body = null, biggest = 0, last = null;
  const invoke = async (cmd, b, opts) => {
    biggest = Math.max(biggest, b.length);
    if (cmd !== 'stage_files') { last = { cmd, len: b.length, staged: opts && opts.headers && opts.headers['T180-Staged'] }; return 'written'; }
    const hn = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true), h = JSON.parse(new TextDecoder().decode(b.subarray(4, 4 + hn)));
    if (!body) body = new Uint8Array(h.total);
    body.set(b.subarray(4 + hn), h.at);
  };
  sendFiles(invoke, 'install_track', { folder: 't180b_x' }, files).then(() => {
    const n = new DataView(body.buffer).getUint32(0, true); let same = body.length === 4 + n + 150 * 1048576;
    for (let i = 4 + n; same && i < body.length; i += 4093) same = body[i] === (i - 4 - n < 140 * 1048576 ? 7 : 9);
    console.log('DONE ' + (same && last && last.cmd === 'install_track' && last.len === 0 && last.staged ? 'SAME' : 'DIFFERENT') + ' biggest ' + biggest);
  });
}
if (out !== undefined) console.log('DONE ' + out);`;
const run = (way) => spawnSync(process.execPath, ['--max-old-space-size=160', '-e', CHILD(way)], { encoding: 'utf8', timeout: 120000 });

test('row 3: under a 160 MB heap, 150 MB of files: the old base64-in-JSON hand-over runs out of heap, sendFiles hands over the same bytes', () => {
  const old = run('old');
  assert.notEqual(old.status, 0, `control: the old way must not finish under the budget (it printed ${String(old.stdout).trim()})`);
  assert.match(String(old.stderr), /heap out of memory|Invalid string length|Allocation failed/i, 'control: it ran out of heap');
  const now = run('new');
  assert.equal(now.status, 0, `sendFiles finished under the budget (stderr: ${String(now.stderr).slice(0, 300)})`);
  assert.match(String(now.stdout).trim(), /^DONE SAME biggest \d+$/, 'every byte handed over, in order, then the command');
  assert.ok(+String(now.stdout).trim().split(' ').pop() <= 32 * 1048576 + 1024, 'no call carried more than one piece');
});

test('row 4: index.html sends every command that writes files through sendFiles and makes no base64 of a file', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const cmd of ['write_export', 'write_layouts_export', 'write_blender_export', 'install_track']) {
    assert.match(html, new RegExp(`sendFiles\\('${cmd}'`), `${cmd} goes through sendFiles`);
    assert.doesNotMatch(html, new RegExp(`call\\('${cmd}'`), `${cmd} is not called with JSON arguments`);
  }
  assert.doesNotMatch(html, /\bb64\(|btoa\(/, 'no file is turned into base64 text');
});

test('row 5: a body larger than one piece goes as stage_files pieces of at most that size, in order, whose bytes are the body; then the command with the staged id', async () => {
  const files = [{ path: 'a.kn5', bytes: Uint8Array.from({ length: 1000 }, (_, i) => i % 251) }, { path: 'b.png', bytes: Uint8Array.from({ length: 333 }, (_, i) => 255 - (i % 13)) }, { path: 'c.ini', bytes: new Uint8Array(0) }];
  const whole = packFiles({ folder: 't180b_x' }, files), calls = [];
  const invoke = async (cmd, body, opts) => { calls.push({ cmd, body: Uint8Array.from(body), opts }); return cmd === 'install_track' ? 'installed' : body.length; };
  assert.equal(await sendFiles(invoke, 'install_track', { folder: 't180b_x' }, files, { piece: 100 }), 'installed', "the command's answer comes back");
  const stage = calls.filter((c) => c.cmd === 'stage_files'), last = calls[calls.length - 1];
  assert.equal(stage.length, Math.ceil(whole.length / 100), 'one call per piece');
  assert.ok(calls.every((c) => c.body.length <= 100 + 64), 'no call carries more than a piece and its small header');
  let at = 0; const back = new Uint8Array(whole.length), ids = new Set();
  for (const c of stage) {
    const n = new DataView(c.body.buffer).getUint32(0, true), h = JSON.parse(new TextDecoder().decode(c.body.subarray(4, 4 + n))), p = c.body.subarray(4 + n);
    assert.equal(h.at, at, 'the pieces come in order'); assert.equal(h.total, whole.length, "each piece names the whole body's length"); ids.add(h.id);
    assert.ok(p.length <= 100, 'a piece is at most the piece size'); back.set(p, at); at += p.length;
  }
  assert.equal(at, whole.length); assert.deepEqual(Array.from(back), Array.from(whole), 'the pieces are the body, byte for byte');
  assert.equal(ids.size, 1, 'one id for the whole body');
  assert.deepEqual([last.cmd, last.body.length, last.opts && last.opts.headers && last.opts.headers['T180-Staged']], ['install_track', 0, [...ids][0]], 'then the command, with no body and the staged id');
  const one = []; await sendFiles(async (cmd, body, opts) => { one.push([cmd, body.length, opts]); }, 'write_export', { dir: 'D', folder: 't180b_x' }, files, { piece: whole.length + 20 });
  assert.deepEqual(one.map((c) => c[0]), ['write_export'], 'a body that fits goes in one call');
  assert.equal(one[0][2], undefined, 'and with no staged id');
  const all = [...pieces({ folder: 't180b_x' }, files, 7)]; assert.ok(all.every((p) => p.length <= 7));
  assert.deepEqual(Array.from(Buffer.concat(all.map((p) => Buffer.from(p)))), Array.from(whole), 'pieces(), joined, is packFiles');
});
