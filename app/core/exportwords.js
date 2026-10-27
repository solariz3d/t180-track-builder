// exportwords.js: the export's warnings in the user's words, for the message the app shows (D464; D463 part 2 item 6, E's D461 report §2 item 6).
//
//   exportWarningWords(w)     -> the warning as a person can act on it, or null when it is the builders' note only
//   exportWarningsWords(ws)   -> the list as shown: each in words, the builders' notes left out
//
// The export core (src/export) words its warnings for the builders: a source file, a design-doc section, a seat's letter. That text stays in the core (the
// export folder and its pinned bytes do not change); only what reaches the screen is reworded here. The CSP need stays, in plain words. The mesh-node-name note
// goes: the kn5 already gets unique names, and there is nothing for the user to do. Any other warning keeps its words, with its references taken off.
'use strict';

// a bracketed reference for the builders: a doc section, a doc or source file, a design doc by name
const REF = /\s*\((?=[^()]*(?:§|\.md\b|\.js\b|ARCHITECTURE|INTERFACES|FINDINGS|docs\/))[^()]*\)/g;
const plain = (w) => String(w).replace(REF, '').replace(/\s+/g, ' ').trim();

function exportWarningWords(w) {
  const s = String(w || '');
  if (!s) return null;
  if (/^csp-only:/.test(s)) return 'needs Custom Shaders Patch (CSP): Assetto Corsa without CSP can crash loading this track';
  if (/mesh-node names repeat/.test(s)) return null;
  if (/^self-intersection NOT checked/.test(s)) return 'the road was not checked for running into itself';
  if (/^noblock:/.test(s)) return 'this folder has no soft-collision road: it was written only because it was asked for';
  if (/^amber: /.test(s)) return `past what any measured track has proven: ${plain(s.slice(7))}`;
  return plain(s);
}

function exportWarningsWords(ws) {
  return (Array.isArray(ws) ? ws : []).map(exportWarningWords).filter((w) => w);
}

module.exports = { exportWarningWords, exportWarningsWords };
