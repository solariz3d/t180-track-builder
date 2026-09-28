// phrasebook.js: the STARTER PHRASEBOOK, built-in phrases for the first ten minutes (ARCHITECTURE §2: "Phrase: a saved
// word sequence … spiral climb, bowl hairpin, S"; §11.7: "Onboarding: the first ten minutes (a guided first track,
// defaults, a starter phrasebook)").
//
//   PHRASES                          [{ name, words: [{ word, dir, font, tempo, handles? }], source: [quoted lines], note }]
//   phrasebookPieces()               the phrases as built-in library pieces (src/doc/library.js piece shape), for the palette
//   placePhrase(doc, name) -> doc    append a phrase at the head: ONE document entry, so one undo step (history.js)
//
// EVERY WORD KEEPS ITS OWN RADIUS AND EASE. A handle is changed only where the phrase names it: the spiral's climb, and
// Sakura's angles (see its note), where the length follows the angle so the radius stays the word's own. Every phrase
// resolves, builds and validates with no red at its default tempo (test/phrasebook.test.js).
//
// WHERE EACH COMES FROM, quoted in `source`. Only Sakura's grammar is stated in FINDINGS as a sequence; the other three
// are named by ARCHITECTURE §2, and their words, fonts and tempos come from what FINDINGS measured. Where a value is a
// choice, `note` says so.
'use strict';

const { appendPhrase, defaultWord } = require('./document.js');
const { TEMPOS, radiusOf } = require('./vocab.js');
const { DocError } = require('./serial.js');

const DEG = Math.PI / 180;

/** A curved word turned `deg` degrees LEFT at its OWN radius and tempo: the length defaultWord gives for that angle. */
function angled(word, deg, tempo) {
  const T = TEMPOS[tempo];
  return { turn: deg * DEG, length: (deg * DEG * radiusOf(word, tempo)) / (1 - T.ease) };
}

// THE ORDER is the palette's, and a user who clicks the starter phrases in turn chains them in it. Chained as
// sakura flow → bowl hairpin → S → spiral climb (the order until D180), the spiral's flat first turn crossed the sakura
// flow's road 0.4 m above it (stacked-within-2m at 476–521 and 2513–2559 m, A's D180 check of the installed app). Of the
// 24 orders of the four, 22 chain clean; this one keeps sakura flow first (the guide's suggested first piece) and is
// clean (test/phrasebook.test.js). Every phrase after every other is clean too, but for bowl hairpin → bowl hairpin: two
// flat 180° hairpins the same way come back over their own start, which no default can avoid.
const PHRASES = Object.freeze([
  {
    name: 'sakura flow',
    // the words at their own radii, turning 10°, 20°, 30°, 20°, 10°: one 90° corner that opens and closes in steps
    words: [['sweep', 10], ['turn', 20], ['tight', 30], ['turn', 20], ['sweep', 10]].map(([word, deg]) => ({ word, dir: 'L', font: 'half-pipe', tempo: 'standard', handles: angled(word, deg, 'standard') })),
    source: [
      'FINDINGS.md:180-181 "**First grammar.** Sakura\'s corners open and close in steps: `sweep → turn → tight → turn → sweep`, never straight into tight. That is the flow, as a sentence pattern."',
      'FINDINGS.md:139 "the highest half-pipe share of the eleven tracks (26% of its profiles)"',
      'FINDINGS.md:172 "cross-section | half-pipe, 32 m wide"',
    ],
    note: 'Sakura\'s grammar word for word, in Sakura\'s font, each word at its class\'s median radius in the measured library at the standard tempo (vocab.js, D182). The ANGLES are chosen: one 90° corner shared 10° / 20° / 30° / 20° / 10° (with the hand-set words before D182, the default angles turned 270° and crossed their own lead-in: red, measured). The half-pipe\'s shape is the vocabulary\'s font; each word\'s width is its class\'s measured median.',
  },
  {
    name: 'S',
    // the angles NAMED (they were the hand-set default, 60°): at the measured median turn an S would be a wiggle
    words: [{ word: 'turn', dir: 'L', font: 'bowl', tempo: 'serpents', handles: angled('turn', 60, 'serpents') }, { word: 'turn', dir: 'R', font: 'bowl', tempo: 'serpents', handles: { ...angled('turn', 60, 'serpents'), turn: -60 * DEG } }],
    source: [
      'ARCHITECTURE.md:36 "… spiral climb, bowl hairpin, S."',
      'ARCHITECTURE.md:44 "Measured: Aurora sweeps at ~1.2 km radius, Serpents and the Test Track at 100–170 m." (the serpents tempo, src/doc/vocab.js: 0.45 × the turn class\'s median radius; before D182, 135 m)',
      'FINDINGS.md:199 "| Serpents Spiral | 2.0 km | 35 | 0 | – |" (the track the tempo is named for; FINDINGS gives its lap, not its radii)',
    ],
    note: 'A left turn into a right turn at the serpents tempo, in the bowl font (its outside wall changes side with the turn). The 100–170 m radius is quoted by ARCHITECTURE §2, not by a FINDINGS line.',
  },
  {
    name: 'bowl hairpin',
    // the angles NAMED (they were the hand-set defaults, 60° and 90°): at the measured median angles it would not be a hairpin
    words: [['turn', 60], ['tight', 90], ['turn', 60]].map(([word, deg]) => ({ word, dir: 'L', font: 'bowl', tempo: 'standard', handles: angled(word, deg, 'standard') })),
    source: [
      'ARCHITECTURE.md:36 "**Phrase:** a saved word sequence with some parameters exposed (a macro): spiral climb, bowl hairpin, S."',
      'FINDINGS.md:14 "The dominant form is a **bowl**, a flatter floor curving up the outside. It is 50–88% of profiles on most tracks."',
      'FINDINGS.md:180-181 "Sakura\'s corners open and close in steps … never straight into tight."',
    ],
    note: 'A hairpin in the dominant font, opened and closed through a turn on each side of the tight, never straight into tight: 60° + 90° + 60° = 210°. The name is ARCHITECTURE\'s; the sequence is chosen by the grammar, not measured.',
  },
  {
    name: 'spiral climb',
    words: [
      // the angles NAMED (they were the hand-set defaults, 60° and 90°): the 390° is what makes it pass over its own start
      { word: 'turn', dir: 'L', font: 'bowl', tempo: 'standard', handles: { ...angled('turn', 60, 'standard'), climb: 6 * DEG } },
      { word: 'tight', dir: 'L', font: 'bowl', tempo: 'standard', handles: angled('tight', 90, 'standard') },
      { word: 'tight', dir: 'L', font: 'bowl', tempo: 'standard', handles: angled('tight', 90, 'standard') },
      { word: 'tight', dir: 'L', font: 'bowl', tempo: 'standard', handles: angled('tight', 90, 'standard') },
      { word: 'turn', dir: 'L', font: 'bowl', tempo: 'standard', handles: { ...angled('turn', 60, 'standard'), climb: -6 * DEG } },
    ],
    source: [
      'ARCHITECTURE.md:36 "… spiral climb, bowl hairpin, S."',
      'FINDINGS.md:174 "| climbing / dropping | 21% / 19% | 31% / 24% |" (Sakura and Rainbow climb on a fifth to a third of their length)',
      'FINDINGS.md:180-181 "Sakura\'s corners open and close in steps … never straight into tight."',
      'FINDINGS.md:199 "| Serpents Spiral | 2.0 km | 35 | 0 | – |"',
    ],
    note: 'Opened and closed through a turn (never straight into tight), three tights between: 390° to the left, pitching up 6° in the first turn and back to level in the last, so the road passes over its own start. 6° is CHOSEN (inferred): enough that the lap above clears the road below by more than the 2 m stacked limit (ARCHITECTURE.md:85) and the bowl\'s walls (with no climb it is red, self-intersection and stacked: tested). FINDINGS measures how much tracks climb, not a spiral\'s pitch.',
  },
].map((p) => Object.freeze({ ...p, words: Object.freeze(p.words.map((w) => Object.freeze(w))) })));

const find = (name) => {
  const p = PHRASES.find((x) => x.name === name);
  if (!p) throw new DocError('NO_SUCH_PHRASE', `no starter phrase called "${name}" (known: ${PHRASES.map((x) => x.name).join(', ')})`);
  return p;
};
const items = (p) => p.words.map((w) => ({ word: w.word, opts: { dir: w.dir, tempo: w.tempo, font: w.font, ...(w.handles ? { handles: w.handles } : {}) } }));

/** Append starter phrase `name` at the head of doc: one document entry, so one undo step. */
function placePhrase(doc, name) { return appendPhrase(doc, name, items(find(name))); }

/** The phrases as built-in library pieces (src/doc/library.js: { id, name, author, builtin, kind, words }). */
function phrasebookPieces() {
  return PHRASES.map((p) => ({ id: `b-phrase-${p.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, name: p.name, author: 't180-track-builder', builtin: true, kind: 'phrase',
    words: p.words.map((w) => { const d = defaultWord(w.word, { dir: w.dir, tempo: w.tempo, font: w.font }); return { word: d.word, font: d.font, tempo: d.tempo, speed: d.speed, handles: { ...d.handles, ...(w.handles || {}) }, textures: d.textures }; }) }));
}

module.exports = { PHRASES, placePhrase, phrasebookPieces };
