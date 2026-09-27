// shell-layout.test.js: node --test app/test/*.test.js
// The page's layout rules that keep it from scrolling. The real evidence is a headless Edge measurement (the D169 and
// D170 reports give the sizes); this pins the rules themselves, so an edit that drops one fails here first.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const rule = (sel) => { const m = page.match(new RegExp(`(^|\\n)\\s*${sel.replace(/[#.*]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`)); return m ? m[2] : ''; };

test('the page itself never scrolls: the body clips, and the grid rows and columns may shrink to fit', () => {
  assert.match(page, /html,\s*body\s*\{[^}]*overflow:\s*hidden/);
  assert.match(rule('body'), /grid-template-rows:[^;]*minmax\(0,\s*1fr\)/);
});

test('the right panel never scrolls sideways: it clips, reserves its scrollbar, and holds media to its width', () => {
  const side = page.match(/#side\s*\{[^}]*overflow-x:\s*hidden[^}]*\}/);
  assert.ok(side, 'no overflow-x: hidden on #side');
  assert.match(side[0], /scrollbar-gutter:\s*stable/);
  assert.match(page, /#side canvas[^{]*\{[^}]*max-width:\s*100%/);
  assert.match(page, /#side > section\s*\{[^}]*overflow-wrap:\s*anywhere/);
});
