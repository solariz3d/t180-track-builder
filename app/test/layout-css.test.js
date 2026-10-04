// layout-css.test.js: node --test app/test/layout-css.test.js
// D235 (the keeper's screenshot "scroll bar in the way of the click for changing values"): in the Extend column the value fields ran under the scroll bar, and the
// "width like…" select was cut off. Measured in a real Chrome at the keeper's 1818 px: every Extend field ended 65 px past the section's content edge (x = 359 against
// 294, the bar's 15 px gutter lies between 304 and 319). The cause was the shared `.picker` grid, `60px 1fr`: a `1fr` track will not shrink below its items' min-content, so a
// number input's or a select's own width pushed the row out. The fix is `minmax(0, 1fr)` and fields held to their track. This test pins the rules (the page is DOM and the
// webview, and the geometry itself was measured over CDP, in the hand-back): a revert to `1fr` or the loss of the field rule fails here.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const rule = (sel) => { const m = html.match(new RegExp(`^\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')); assert.ok(m, `the page has a rule for ${sel}`); return m[1]; };

test('the .picker grid\'s field column is minmax(0, 1fr), so a field can shrink to the column and never runs under the scroll bar', () => {
  const r = rule('.picker');
  assert.match(r, /grid-template-columns:\s*60px\s+minmax\(0,\s*1fr\)/, r); assert.doesNotMatch(r, /grid-template-columns:\s*60px\s+1fr\b/, 'not the plain 1fr that grew past the column');
});

test('every field and select in a .picker row is held to its track (min-width 0, at most the track, border-box)', () => {
  const m = html.match(/\.picker input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),\s*\.picker select\s*\{([^}]*)\}/); assert.ok(m, 'a rule for the fields and selects of a .picker');
  assert.match(m[1], /min-width:\s*0/); assert.match(m[1], /max-width:\s*100%/); assert.match(m[1], /box-sizing:\s*border-box/);
});

test('the left column still scrolls up and down only and reserves the scroll bar\'s gutter, so the fields\' usable edge is the content box', () => {
  const r = rule('#left'); assert.match(r, /overflow-y:\s*auto/); assert.match(r, /overflow-x:\s*hidden/); assert.match(r, /scrollbar-gutter:\s*stable/);
  assert.match(rule('#side > section'), /padding:\s*10px/);
});
