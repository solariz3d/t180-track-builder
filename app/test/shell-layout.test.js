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

test('the side sections never scroll sideways: they clip, the column reserves its scrollbar, and media hold to its width', () => {
  const side = page.match(/#side\s*\{[^}]*overflow-x:\s*hidden[^}]*\}/);
  assert.ok(side, 'no overflow-x: hidden on #side');
  // the side sections no longer scroll on their own (2026-10-03): the left column they sit in does, so it reserves the gutter
  assert.match(rule('#left'), /scrollbar-gutter:\s*stable/);
  assert.match(page, /#side canvas[^{]*\{[^}]*max-width:\s*100%/);
  assert.match(page, /#side > section\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test('two columns: the side sections live in the left column under the controls, and the preview takes the rest', () => {
  assert.match(rule('body'), /grid-template-columns:\s*\d+px\s+minmax\(0,\s*1fr\)\s*;/, 'exactly two columns');
  const left = page.match(/<div id="left">([\s\S]*?)<\/div>\s*<main id="stage">/);
  assert.ok(left, 'a #left column comes before the stage');
  assert.match(left[1], /<aside id="palette">[\s\S]*<aside id="side">/, 'the controls, then the side sections');
  assert.match(rule('#left'), /overflow-y:\s*auto/);
  assert.match(rule('#left'), /overflow-x:\s*hidden/);
});
