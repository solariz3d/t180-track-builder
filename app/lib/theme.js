// theme.js: A SKIN PER MELODY (D381, pane B; the keeper on the skins page: "do it"). The melody the launch picked (app/sound.js createSound) names the skin:
// <html data-theme="aqua|skyline|glass|aurora">, whose tokens app/themes/<name>.css sets over SIGIL's :root (app/index.html). Any other name, or none,
// leaves SIGIL. The page's head sets it before the first paint from the same pick (window.__t180MelodyPick); the boot then sets it from sound.melody,
// so the player's melody has the last word.
//
//   THEMES                     the four skins, by the melodies' names (app/test/theme.test.js holds them equal to sound.js MELODY_NAMES)
//   applyTheme(doc, melody)    -> the skin set: the melody's name, or 'sigil' (data-theme removed)
'use strict';
const THEMES = Object.freeze(['aqua', 'skyline', 'glass', 'aurora']);

function applyTheme(doc, melody) {
  const root = doc && doc.documentElement;
  if (!root) throw new Error('theme: applyTheme needs a document');
  if (typeof melody === 'string' && THEMES.includes(melody)) { root.setAttribute('data-theme', melody); return melody; }
  root.removeAttribute('data-theme');
  return 'sigil';
}

module.exports = { THEMES, applyTheme };
