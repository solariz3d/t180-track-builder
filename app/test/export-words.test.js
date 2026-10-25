// export-words.test.js: node --test app/test/export-words.test.js
// D464 (D463 part 2 item 6, E's D461 report §2 item 6): THE EXPORT'S WARNINGS IN THE USER'S WORDS. The export core (src/export) writes its warnings for the
// builders: source files, design-doc sections, a seat's letter. app/core/exportwords.js turns each into what a person can act on before the app shows it:
// the CSP need stays (in plain words), the internal mesh-name note goes (the kn5 already gets unique names; nothing for the user to do), and no line keeps
// a file name, a doc section or a seat. The core's own strings are not changed (the export folder and its pinned bytes stay as they are). Rows:
//   1  the CSP-only warning says the track needs Custom Shaders Patch and that plain AC can crash, with no doc, section or ini key
//   2  the mesh-node-name note is dropped
//   3  the other warnings keep their meaning with their references taken off; plain ones pass unchanged
//   4  a whole list: what is shown names no source file, doc section or seat, and the count is of what is shown
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { exportWarningWords, exportWarningsWords } = require('../core/exportwords.js');
const { CSP_ONLY_WARNING } = require('../../src/export/trackfiles.js');

const INTERNAL = /§|\.md\b|\.js\b|\.ini\b|ARCHITECTURE|INTERFACES|FINDINGS|docs\/|\bC's\b|WAV_PITCH|safeId/;
const MESH = "36 mesh-node names repeat in the builder's scene (e.g. CELL_p1_body_0 ×100); the kn5 gets unique names (acready.js), INTERFACES §2, C's mesh.js safeId";

test('row 1: the CSP-only warning says the track needs Custom Shaders Patch and that plain AC can crash, with no doc, section or ini key', () => {
  const w = exportWarningWords(CSP_ONLY_WARNING);
  assert.match(w, /needs Custom Shaders Patch \(CSP\)/);
  assert.match(w, /can crash/);
  assert.doesNotMatch(w, INTERNAL, w);
});

test('row 2: the mesh-node-name note is dropped', () => {
  assert.equal(exportWarningWords(MESH), null);
});

test('row 3: the other warnings keep their meaning with their references taken off; plain ones pass unchanged', () => {
  assert.equal(exportWarningWords('self-intersection NOT checked: selfCheck is false (ARCHITECTURE.md:58, :84)'), 'the road was not checked for running into itself');
  const amber = exportWarningWords('amber: roll-rate [12.0 deg/s] at s 10.0–20.0 m (FINDINGS §3)');
  assert.match(amber, /^past what any measured track has proven: roll-rate \[12\.0 deg\/s\] at s 10\.0–20\.0 m$/, amber);
  const noblock = exportWarningWords('noblock: the folder WITHOUT the soft-collision block is RED by ARCHITECTURE §4 (a missing soft-collision block); written only as the §10.1 soft-road control, on request');
  assert.doesNotMatch(noblock, INTERNAL, noblock); assert.match(noblock, /soft-collision/);
  const jump = "jump: this jump may fly past its landing at the lap's speed, at s 120–180 m (the 3.2 g fall misses); tune it by driving it in AC";
  assert.equal(exportWarningWords(jump), jump);
  const near = 'near-touch: two parts of the road come within 0.80 m of each other edge to edge, at 1.20 km (information: it does not stop the export)';
  assert.equal(exportWarningWords(near), near);
});

test('row 4: a whole list: what is shown names no source file, doc section or seat, and the count is of what is shown', () => {
  const shown = exportWarningsWords([MESH, CSP_ONLY_WARNING]);
  assert.equal(shown.length, 1, JSON.stringify(shown));
  for (const w of shown) assert.doesNotMatch(w, INTERNAL, w);
  assert.deepEqual(exportWarningsWords([]), []);
  assert.deepEqual(exportWarningsWords(undefined), []);
});
