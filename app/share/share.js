// share.js: COPY CODE and PASTE CODE (ARCHITECTURE §1.1: "That makes tracks shareable (PolyTrack-style codes)"), with no
// DOM (tested headless against the real core shell, app/core/coreshell.js); index.js mounts it.
//
//   const share = createShare(shell, { clipboard, onPack })
//   await share.copyTrack()          -> the open equation track's code, written to the clipboard (src/doc/code.js coreToCode: the
//                                       document's t180b.core/4 text, with the same compression and checksum every code has)
//   await share.paste(text)          -> { kind, message } after importing the pasted code:
//                                       an equation track REPLACES the open one as one undo step (the old one is one Ctrl+Z away),
//                                       a texture pack goes to onPack(text) (the textures panel)
// D239 (the keeper: "can we keep only the equation mode?"): a code from the old Pieces page, a word track (t180d…) or a piece or
// phrase (t180p…), is REFUSED BY NAME (CODE_PIECES): this builder makes equation tracks, and a word document read as one would be
// a different track, not the one that was shared.
// A code that does not decode is refused WHOLE (src/doc/code.js: CODE_CORRUPT, CODE_MALFORMED, …; a document that decodes but is
// not a valid equation track: its CoreError) and nothing changes: the refusal is the returned message, the shell's state untouched.
'use strict';
const C = require('../../src/doc/code.js');

const PIECES_KINDS = { d: 'a track', p: 'a piece or phrase' };
const refusal = (e) => e && (e.name === 'DocError' || e.name === 'CoreError');

function createShare(shell, { clipboard = null, onPack = null } = {}) {
  const write = async (code) => { if (clipboard) await clipboard.writeText(code); return code; };
  return {
    async copyTrack() { return write(C.coreToCode(shell.exportDoc())); },
    async paste(text) {
      let kind;
      try { kind = C.decode(text).kind; } catch (e) { if (e.name !== 'DocError') throw e; return { kind: null, message: e.message }; }
      if (PIECES_KINDS[kind]) {
        return { kind, refused: 'CODE_PIECES', message: `CODE_PIECES: this is ${PIECES_KINDS[kind]} code from the old Pieces builder; this builder makes equation tracks and cannot open it (nothing changed)` };
      }
      try {
        if (kind === 'e') {
          const d = C.coreFromCode(text);
          const before = shell.getState().history.present;
          shell.commitDoc(d);
          const st = shell.getState();
          return { kind, message: st.history.present === before ? st.message : `opened "${d.name}" from its code (Ctrl+Z goes back)` };
        }
        const packText = C.packFromCode(text);
        if (!onPack) return { kind, message: 'a texture pack code: the equation builder does not import texture packs (nothing changed)' };
        const r = onPack(packText);
        return { kind, message: (r && r.error) || 'texture pack imported' };
      } catch (e) {
        if (!refusal(e)) throw e;
        return { kind, message: e.message };
      }
    },
  };
}

module.exports = { createShare };
