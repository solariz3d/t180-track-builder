// overwrite.js: THE OVERWRITE QUESTION, with no DOM (tested headless: app/test/overwrite.test.js).
//
// (the user, 2026-10-31 16:55: "if saving a second track with the same name, there should be a warning saying you will overwrite it"; his ELYSIUM save
// was replaced on 10-22, and an edge-test export came from the wrong version.) Save asks before it writes over a saved track that is not the open one
// (the shell decides that: app/core/coreshell.js save), and Export to Assetto Corsa asks before it replaces a t180b folder holding a different road
// (app/install/install.js). Both questions are asked in the themed dialog (app/askdialog.js askChoice), and Cancel is the default, so Enter never replaces.
//
//   installNeedsAsk(state, geometry)   does replacing the installed folder `state` ({ exists, marker, geometry }, native installed_state) with an export
//                                      whose road hash is `geometry` need a question? No folder, or one the builder did not make (the native install
//                                      refuses that one and touches nothing), or the same road: no. A different road, or a side that records none: yes
//   markerGeometry(files)              the road hash in an export's own marker file, or null
//   saveQuestion({ name, savedAt })    the question for a save over another saved track: { title, message, buttons, cancelValue }, askChoice's options
//   installQuestion({ folder, written })   the same for Export to Assetto Corsa
'use strict';

const MARKER_FILE = '.t180b-builder.json';   // the builder's own marker in every folder it writes (src/export/fromwords.js)

function installNeedsAsk(state, geometry) {
  if (!state || !state.exists || !state.marker) return false;
  return !(state.geometry && geometry && state.geometry === geometry);
}

function markerGeometry(files) {
  const f = (files || []).find((x) => x && x.path === MARKER_FILE);
  if (!f) return null;
  try {
    const text = typeof f.bytes === 'string' ? f.bytes : new TextDecoder().decode(f.bytes);
    const g = JSON.parse(text).geometry;
    return typeof g === 'string' && g ? g : null;
  } catch (e) { return null; }   // a marker that cannot be read records no road: the caller asks
}

const two = (n) => String(n).padStart(2, '0');
/** A local date and time the user reads, yyyy-mm-dd hh:mm, or null for none. */
function when(t) {
  const d = t === null || t === undefined ? null : new Date(t);
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

const BUTTONS = [{ label: 'Cancel', value: 'cancel', default: true }, { label: 'Replace', value: 'replace', kind: 'main' }];

function saveQuestion({ name, savedAt }) {
  const at = when(savedAt);
  return {
    title: `Replace the saved track "${name}"?`,
    message: `A different track is already saved as "${name}"${at ? `, last saved ${at}` : ''}. Replace writes the track you have open over it; the one it replaces is kept in Previous versions. Cancel saves nothing.`,
    buttons: BUTTONS.map((b) => ({ ...b })),
    cancelValue: 'cancel',
  };
}

function installQuestion({ folder, written }) {
  const at = when(written);
  return {
    title: `Replace ${folder} in Assetto Corsa?`,
    message: `Assetto Corsa already has ${folder} with a different road${at ? `, exported ${at}` : ''}. Replace writes this track over it. Cancel leaves it as it is and exports nothing.`,
    buttons: BUTTONS.map((b) => ({ ...b })),
    cancelValue: 'cancel',
  };
}

module.exports = { installNeedsAsk, markerGeometry, saveQuestion, installQuestion, when, MARKER_FILE };
