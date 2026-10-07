// gripvals.js: THE GRIP NUMBERS THE APP'S UI NEEDS, with no requires at all (D263). The grip's range and default and a piece's grip live in src/core/document.js (GRIP_MIN, GRIP_MAX, GRIP_DEFAULT, gripOf: E's
// core, D261), but that file pulls tools/piecewise.cjs, which needs node's `fs`, and the UI modules (panel, piecesui, griplayer, griplike) must load in the webview loader with NO node built-in
// (app/lib/cjs.js; app/test/core-xsec.test.js, "the panel loads in the webview loader with no node built-in (D186)"). So the three numbers and the one-line reader are repeated here, and a row
// (app/test/core-pieces-ui.test.js, row 17) fails if they ever differ from the core's.
'use strict';

const GRIP_MIN = 50, GRIP_MAX = 150, GRIP_DEFAULT = 100;
/** A road piece's grip, percent (100 when it carries none), as src/core/document.js gripOf. */
const gripOf = (P) => (P && P.grip !== undefined ? P.grip : GRIP_DEFAULT);

module.exports = { GRIP_MIN, GRIP_MAX, GRIP_DEFAULT, gripOf };
