// theme.js: A SKIN PER MELODY (D381, pane B; the user on the skins page: "do it"). The melody the launch picked (app/sound.js createSound) names the skin:
// <html data-theme="aqua|skyline|glass|aurora">, whose tokens app/themes/<name>.css sets over SIGIL's :root (app/index.html). Any other name, or none,
// leaves SIGIL. The page's head sets it before the first paint from the same pick (window.__t180MelodyPick); the boot then sets it from sound.melody,
// so the player's melody has the last word.
//
//   THEMES                     the four skins, by the melodies' names (app/test/theme.test.js holds them equal to sound.js MELODY_NAMES)
//   applyTheme(doc, melody)    -> the skin set: the melody's name, or 'sigil' (data-theme removed)
//   CHOICES                    (D394) Settings ▸ Theme: music (the launch's random melody picks the skin, as before), each of the four (its skin and its own
//                              melody), sigil (SIGIL's look and, since D402, its own melody, Obsidian: sound.js 'sigil'). The head script reads the saved one
//   skinFor(choice, melody)    -> the skin a choice shows over the playing melody: a fixed theme its own, sigil none (null), music or anything else the melody's
//   LOOKS, melodyOf(look)      (D405) the looks: the four melodies' skins and Skyline Night, a night look on Skyline's melody (the melodies stay four). melodyOf
//                              names a look's melody (null for anything that is not a look). A look is a skin: applyTheme and skinFor take any of them, and
//                              skinFor(music, melody, look) keeps the head's look when its melody is the one playing, so a random start on the night stays night
//   PICKS                      (D402) what Random picks among: the looks and SIGIL, whose melody is 'sigil' (melodyOf('sigil') is 'sigil'; SIGIL is no skin, so
//                              applyTheme('sigil') still removes data-theme)
'use strict';
const THEMES = Object.freeze(['aqua', 'skyline', 'glass', 'aurora']);
const NIGHT = Object.freeze({ 'skyline-night': 'skyline' });   // D405: a look on another look's melody
const LOOKS = Object.freeze([...THEMES, ...Object.keys(NIGHT)]);
const SIGIL = 'sigil';   // D402: SIGIL's look (no data-theme) and its own melody, sound.js MELODY_NAMES' fifth
const melodyOf = (look) => (typeof look === 'string' ? (NIGHT[look] || (THEMES.includes(look) || look === SIGIL ? look : null)) : null);
const PICKS = Object.freeze([...LOOKS, SIGIL]);
const CHOICES = Object.freeze(['music', 'aqua', 'skyline', 'skyline-night', 'glass', 'aurora', 'sigil']);

function applyTheme(doc, melody) {
  const root = doc && doc.documentElement;
  if (!root) throw new Error('theme: applyTheme needs a document');
  if (typeof melody === 'string' && LOOKS.includes(melody)) { root.setAttribute('data-theme', melody); return melody; }
  root.removeAttribute('data-theme');
  return 'sigil';
}

function skinFor(choice, melody, look) {
  if (choice === 'sigil') return null;
  if (LOOKS.includes(choice)) return choice;
  return melodyOf(look) !== null && melodyOf(look) === melody ? look : melody;
}

module.exports = { THEMES, LOOKS, PICKS, melodyOf, CHOICES, applyTheme, skinFor };
