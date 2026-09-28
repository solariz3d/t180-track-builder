// project.js: a PROJECT of layouts (ARCHITECTURE §11.1: "layouts as separate documents (Aurora's two layouts are separate
// model files, not shared road)"). A project is a name and N layouts, each a full, independent document; nothing is
// shared between them, so each is edited, undone and exported exactly as a lone document is.
//
//   createProject(name) · addLayout(project, layout, doc) · setLayout(project, layout, doc) · removeLayout(project, layout)
//   serializeProject(project) -> text      parseProject(text) -> project      (every doc migrates as parse does)
//
// A LAYOUT NAME is the name AC reads it by (models_<layout>.ini, <layout>/, ui/<layout>/): lower-case letters, digits
// and _, 1 to 32 characters, unique in the project.
// CANONICAL TEXT: the project's two fields, then one layout per entry, each carrying its document's own canonical text
// (src/doc/serial.js serialize) verbatim, so the same project always gives the same bytes and a layout's document text
// inside it is byte for byte the text it would have alone.
'use strict';
const { serialize, parse, DocError, deepFreeze } = require('./serial.js');

const PROJECT = 1;
const LAYOUT_RE = /^[a-z0-9_]{1,32}$/;

function checkProject(p) {
  if (!p || typeof p !== 'object') throw new DocError('BAD_PROJECT', 'not an object');
  if (p.project !== PROJECT) throw new DocError(Number.isInteger(p.project) && p.project > PROJECT ? 'SCHEMA_TOO_NEW' : 'SCHEMA_UNKNOWN', `project format ${p.project}: this builder reads ${PROJECT}`);
  if (typeof p.name !== 'string') throw new DocError('BAD_PROJECT', 'name must be a string');
  if (!Array.isArray(p.layouts)) throw new DocError('BAD_PROJECT', 'layouts must be an array');
  const seen = new Set();
  p.layouts.forEach((l, i) => {
    if (!l || typeof l.layout !== 'string' || !LAYOUT_RE.test(l.layout)) throw new DocError('BAD_LAYOUT_NAME', `layouts[${i}]: ${JSON.stringify(l && l.layout)} is not a layout name (a–z, 0–9, _; 1 to 32)`);
    if (seen.has(l.layout)) throw new DocError('DUPLICATE_LAYOUT', `layouts[${i}]: ${l.layout} appears twice`);
    seen.add(l.layout);
    serialize(l.doc);                        // checks the document
  });
  return p;
}

const createProject = (name = '') => deepFreeze(checkProject({ project: PROJECT, name, layouts: [] }));
function addLayout(p, layout, doc) { return deepFreeze(checkProject({ ...p, layouts: [...p.layouts, { layout, doc }] })); }
function setLayout(p, layout, doc) {
  if (!p.layouts.some((l) => l.layout === layout)) throw new DocError('NO_SUCH_LAYOUT', `no layout ${layout}`);
  return deepFreeze(checkProject({ ...p, layouts: p.layouts.map((l) => (l.layout === layout ? { layout, doc } : l)) }));
}
function removeLayout(p, layout) {
  if (!p.layouts.some((l) => l.layout === layout)) throw new DocError('NO_SUCH_LAYOUT', `no layout ${layout}`);
  return deepFreeze(checkProject({ ...p, layouts: p.layouts.filter((l) => l.layout !== layout) }));
}

function serializeProject(p) {
  checkProject(p);
  const s = JSON.stringify;
  const body = p.layouts.map((l) => `  {${s('layout')}:${s(l.layout)},${s('doc')}:\n${serialize(l.doc).trimEnd()}}`).join(',\n');
  return `{\n  ${s('project')}: ${p.project},\n  ${s('name')}: ${s(p.name)},\n  ${s('layouts')}: [${p.layouts.length ? `\n${body}\n  ` : ''}]\n}\n`;
}
function parseProject(text) {
  let o; try { o = JSON.parse(text); } catch (e) { throw new DocError('BAD_JSON', e.message); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new DocError('BAD_PROJECT', 'not an object');
  const extra = Object.keys(o).filter((k) => !['project', 'name', 'layouts'].includes(k));
  if (extra.length) throw new DocError('UNKNOWN_KEY', `project: ${extra.join(', ')} not part of a project`);
  if (!Array.isArray(o.layouts)) throw new DocError('BAD_PROJECT', 'layouts must be an array');
  const layouts = o.layouts.map((l, i) => {
    if (!l || typeof l !== 'object' || Object.keys(l).sort().join() !== 'doc,layout') throw new DocError('BAD_PROJECT', `layouts[${i}] must be { layout, doc }`);
    return { layout: l.layout, doc: parse(JSON.stringify(l.doc)) };
  });
  return deepFreeze(checkProject({ project: o.project, name: o.name, layouts }));
}

module.exports = { PROJECT, LAYOUT_RE, checkProject, createProject, addLayout, setLayout, removeLayout, serializeProject, parseProject };
