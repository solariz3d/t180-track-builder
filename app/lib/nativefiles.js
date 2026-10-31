// nativefiles.js: the files an export hands to the native side (File ▸ Export, Export layouts, Export for Blender, Export to Assetto Corsa), as BYTES.
// They went as base64 text inside the command's JSON: a 219 MB kn5 became a 292 MB string, then a 323 MB JSON text, all on the page's own heap, which
// the page shares with its workers in one 4 GB budget. That is where the page died on 2026-10-31 (Export to Assetto Corsa on ELYSIUM, the crash
// report's stack: stringify, the IPC, installTrack), and on a 50 km track the text is longer than the longest string JavaScript can hold, so
// those tracks could not be written at all. Now the files go as one block of bytes, the command's raw body (Tauri's invoke with a Uint8Array):
//
//   packFiles(head, files) -> Uint8Array   [header length: 4 bytes, little-endian][header: UTF-8 JSON, head plus files: [{ path, len }]][each file's bytes, in order]
//                                          head is the command's other arguments ({ dir, folder }, { folder }, { dir, folder, fbx }); files are { path, bytes: Uint8Array }
//   sendFiles(invoke, cmd, head, files)    sends that body: in one call, invoke(cmd, body), when it is at most PIECE bytes; else in pieces (below)
//   pieces(head, files, size)              packFiles' body as consecutive pieces of at most `size` bytes, made one at a time from the files (never the whole body at once)
//
// A BODY IN PIECES. One call's body crosses the webview's own message pipe, and a body of 566 MB (a 50 km track's export) killed the page there
// (measured 2026-10-31: the page's renderer died sending write_export; ELYSIUM's 242 MB went through), so a body larger than PIECE goes as pieces:
// invoke('stage_files', [4-byte length][JSON { id, at, total }][the piece's bytes]) for each piece in order, then invoke(cmd, an empty body, with the
// header T180-Staged: id), and src-tauri/src/lib.rs files_of takes the staged body whole. Nothing here makes a string of a file's bytes.
'use strict';

const PIECE = 32 * 1048576;

/** The body's header: its length (4 bytes, little-endian) and the JSON text; and the files' lengths. */
function headerOf(head, files) {
  if (!head || typeof head !== 'object' || Array.isArray(head)) throw new Error('packFiles: head must be an object of the command\'s arguments');
  if ('files' in head) throw new Error('packFiles: head must not carry files; they go as the second argument');
  if (!Array.isArray(files)) throw new Error('packFiles: files must be an array of { path, bytes }');
  const list = files.map((f, i) => {
    if (!f || typeof f.path !== 'string' || !f.path) throw new Error(`packFiles: file ${i} has no path`);
    if (!(f.bytes instanceof Uint8Array)) throw new Error(`packFiles: ${f.path} has no bytes (a Uint8Array)`);
    return { path: f.path, len: f.bytes.length };
  });
  const text = new TextEncoder().encode(JSON.stringify({ ...head, files: list }));
  const prefix = new Uint8Array(4 + text.length);
  new DataView(prefix.buffer).setUint32(0, text.length, true);
  prefix.set(text, 4);
  return { prefix, list };
}

function packFiles(head, files) {
  const { prefix, list } = headerOf(head, files);
  const out = new Uint8Array(prefix.length + list.reduce((a, f) => a + f.len, 0));
  out.set(prefix, 0);
  let at = prefix.length;
  for (const f of files) { out.set(f.bytes, at); at += f.bytes.length; }
  return out;
}

function* pieces(head, files, size = PIECE) {
  if (!(size >= 1)) throw new Error('pieces: the piece size must be at least 1 byte');
  const parts = [headerOf(head, files).prefix, ...files.map((f) => f.bytes)];
  let piece = new Uint8Array(size), fill = 0;
  for (const p of parts) {
    for (let at = 0; at < p.length;) {
      const n = Math.min(size - fill, p.length - at);
      piece.set(p.subarray(at, at + n), fill); fill += n; at += n;
      if (fill === size) { yield piece; piece = new Uint8Array(size); fill = 0; }
    }
  }
  if (fill) yield piece.subarray(0, fill);
}

/** One stage_files body: [4-byte length][JSON { id, at, total }][the piece]. */
function stageBody(id, at, total, piece) {
  const text = new TextEncoder().encode(JSON.stringify({ id, at, total }));
  const out = new Uint8Array(4 + text.length + piece.length);
  new DataView(out.buffer).setUint32(0, text.length, true);
  out.set(text, 4); out.set(piece, 4 + text.length);
  return out;
}

function sendFiles(invoke, cmd, head, files, { piece = PIECE } = {}) {
  if (typeof invoke !== 'function') throw new Error('sendFiles: no native side to send to');
  const headLen = headerOf(head, files).prefix.length, total = files.reduce((a, f) => a + f.bytes.length, headLen);   // headerOf checked the files
  if (total <= piece) return invoke(cmd, packFiles(head, files));
  return sendStaged(invoke, cmd, head, files, piece, total);
}

async function sendStaged(invoke, cmd, head, files, piece, total) {
  const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  let at = 0;
  for (const p of pieces(head, files, piece)) { await invoke('stage_files', stageBody(id, at, total, p)); at += p.length; }
  return invoke(cmd, new Uint8Array(0), { headers: { 'T180-Staged': id } });
}

module.exports = { packFiles, pieces, sendFiles, PIECE };
