// share.js: COPY CODE and PASTE CODE (ARCHITECTURE §1.1: "That makes tracks shareable (PolyTrack-style codes)"), with no
// DOM (tested headless against the real shell); index.js mounts it.
//
//   const share = createShare(shell, { clipboard, onPack })
//   await share.copyTrack()          -> the track's code, written to the clipboard (src/doc/code.js docToCode)
//   await share.copyPiece(name)      -> a saved piece's or phrase's code
//   await share.paste(text)          -> { kind, message } after importing the pasted code, WHATEVER kind it is:
//                                       a track REPLACES the open one as one undo step (the old one is one Ctrl+Z away),
//                                       a piece joins the library, a pack goes to onPack(text) (the textures panel)
// A code that does not decode is refused WHOLE (src/doc/code.js: CODE_CORRUPT, CODE_MALFORMED, …) and nothing changes:
// the refusal is the returned message, and the shell's state is untouched.
'use strict';
const C = require('../../src/doc/code.js');

function createShare(shell, { clipboard = null, onPack = null } = {}) {
  const write = async (code) => { if (clipboard) await clipboard.writeText(code); return code; };
  return {
    async copyTrack() { return write(C.docToCode(shell.getState().history.present)); },
    async copyPiece(name) { return write(C.pieceToCode(shell.getState().lib, name)); },
    async paste(text) {
      let kind;
      try { kind = C.decode(text).kind; } catch (e) { if (e.name !== 'DocError') throw e; return { kind: null, message: e.message }; }
      try {
        if (kind === 'd') {
          const d = C.docFromCode(text);
          shell.commitDoc(d);
          return { kind, message: shell.getState().message || `opened "${d.name}" from its code (Ctrl+Z goes back)` };
        }
        if (kind === 'p') {
          const before = shell.getState().lib.pieces.length;
          await shell.importPieceText(C.decode(text, 'p').text);
          const st = shell.getState();
          return { kind, message: st.lib.pieces.length > before ? `added "${st.lib.pieces[st.lib.pieces.length - 1].name}" to the palette` : st.message };
        }
        const packText = C.packFromCode(text);
        if (!onPack) return { kind, message: 'a texture pack code: open the textures panel to import it' };
        const r = onPack(packText);
        return { kind, message: (r && r.error) || 'texture pack imported' };
      } catch (e) {
        if (e.name !== 'DocError') throw e;
        return { kind, message: e.message };
      }
    },
  };
}

module.exports = { createShare };
