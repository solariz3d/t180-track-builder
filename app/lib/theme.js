// theme.js: A SKIN PER MELODY (D381, pane B; the keeper on the skins page: "do it"). The melody the launch picked (app/sound.js createSound) names the skin:
// <html data-theme="aqua|skyline|glass|aurora">, whose tokens app/themes/<name>.css sets over SIGIL's :root (app/index.html). Any other name, or none,
// leaves SIGIL. The page's head sets it before the first paint from the same pick (window.__t180MelodyPick); the boot then sets it from sound.melody,
// so the player's melody has the last word.
//
//   THEMES                     the four skins, by the melodies' names (app/test/theme.test.js holds them equal to sound.js MELODY_NAMES)
//   applyTheme(doc, melody)    -> the skin set: the melody's name, or 'sigil' (data-theme removed)
//   CHOICES                    (D394) Settings ▸ Theme: music (the launch's random melody picks the skin, as before), each of the four (its skin and its own
//                              melody), sigil (SIGIL's look; it has no melody of its own, so the melody stays random). The head script reads the saved one
//   skinFor(choice, melody)    -> the skin a choice shows over the playing melody: a fixed theme its own, sigil none (null), music or anything else the melody's
'use strict';
const THEMES = Object.freeze(['aqua', 'skyline', 'glass', 'aurora']);
const CHOICES = Object.freeze(['music', ...THEMES, 'sigil']);

function applyTheme(doc, melody) {
  const root = doc && doc.documentElement;
  if (!root) throw new Error('theme: applyTheme needs a document');
  if (typeof melody === 'string' && THEMES.includes(melody)) { root.setAttribute('data-theme', melody); return melody; }
  root.removeAttribute('data-theme');
  return 'sigil';
}

function skinFor(choice, melody) {
  if (choice === 'sigil') return null;
  return THEMES.includes(choice) ? choice : melody;
}

module.exports = { THEMES, CHOICES, applyTheme, skinFor };
