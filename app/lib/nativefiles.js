// nativefiles.js: the files an export hands to the native side (File ▸ Export, Export layouts, Export for Blender, Export to Assetto Corsa), as BYTES.
// They went as base64 text inside the command's JSON: a 219 MB kn5 became a 292 MB string, then a 323 MB JSON text, all on the page's own heap, which
// the page shares with its workers in one 4 GB budget. That is where the page died on 2026-10-31 (Export to Assetto Corsa on ELYSIUM, the crash
// report's stack: stringify, the IPC, installTrack), and on a 50 km track the text is longer than the longest string JavaScript can hold, so
// those tracks could not be written at all. Now the files go as one block of bytes, the command's raw body (Tauri's invoke with a Uint8Array):
//
//   packFiles(head, files) -> Uint8Array   [header length: 4 bytes, little-endian][header: UTF-8 JSON, head plus files: [{ path, len }]][each file's bytes, in order]
//                                          head is the command's other arguments ({ dir, folder }, { folder }, { dir, folder, fbx }); files are { path, bytes: Uint8Array }
//   sendFiles(invoke, cmd, head, files)    invoke(cmd, packFiles(head, files)): src-tauri/src/lib.rs files_from_body reads it back
// Nothing here makes a string of a file's bytes.
'use strict';

function packFiles(head, files) {
  if (!head || typeof head !== 'object' || Array.isArray(head)) throw new Error('packFiles: head must be an object of the command\'s arguments');
  if ('files' in head) throw new Error('packFiles: head must not carry files; they go as the second argument');
  if (!Array.isArray(files)) throw new Error('packFiles: files must be an array of { path, bytes }');
  const list = files.map((f, i) => {
    if (!f || typeof f.path !== 'string' || !f.path) throw new Error(`packFiles: file ${i} has no path`);
    if (!(f.bytes instanceof Uint8Array)) throw new Error(`packFiles: ${f.path} has no bytes (a Uint8Array)`);
    return { path: f.path, len: f.bytes.length };
  });
  const text = new TextEncoder().encode(JSON.stringify({ ...head, files: list }));
  const out = new Uint8Array(4 + text.length + list.reduce((a, f) => a + f.len, 0));
  new DataView(out.buffer).setUint32(0, text.length, true);
  out.set(text, 4);
  let at = 4 + text.length;
  for (const f of files) { out.set(f.bytes, at); at += f.bytes.length; }
  return out;
}

function sendFiles(invoke, cmd, head, files) {
  if (typeof invoke !== 'function') throw new Error('sendFiles: no native side to send to');
  return invoke(cmd, packFiles(head, files));
}

module.exports = { packFiles, sendFiles };
