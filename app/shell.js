// shell.js: the app's state and actions, with no DOM and no Tauri in it, so it runs headless under node --test and
// unchanged in the webview (loaded there by app/lib/cjs.js).
//
// The keeper, 2026-09-27: "youre not the one who builds the track, the user does". So the shell holds what the user
// is doing: the document and its undo history, the piece library, the pickers at the open end (font, tempo,
// direction), and a selection of placed words. Every action goes through the document model (src/doc); the shell
// never edits a document itself.
//
//   const shell = await createShell({ storage });
//   shell.place('turn')   shell.undo()   shell.redo()   shell.removeHead()
//   shell.setPicker('tempo', 'aurora')   shell.select('w2', 'w3')   await shell.saveSelectionAsPiece('my-bend')
//   await shell.save('my-track')   await shell.open('my-track')   shell.subscribe((state) => …)
//
// STORAGE is injected: { saveDoc(name, text), openDoc(name), listDocs(), saveLibrary(text), openLibrary(), and optionally
// saveAutosave(text), openAutosave(), clearAutosave() }, each returning a promise. In the app it is Tauri commands
// (src-tauri/src/lib.rs); in the tests, a Map.
// AUTOSAVE AND RECOVERY. While the track has unsaved changes, it is written (debounced by `autosaveMs`) through
// saveAutosave as { schema, name, doc } with the document's canonical text. Saving under a name, or cleanExit(), clears
// it. On the next start an autosave left behind is OFFERED as state.recovery, never applied behind the user's back:
// restore() takes it, discardRecovery() clears it. A damaged autosave is left on disk and the app starts anyway, saying
// so. A storage without the autosave calls simply has no autosave.
// A FAILED ACTION changes nothing and says why: state.message holds the model's own error text (DocError,
// ResolveError), and the document and history stay as they were.
'use strict';

const D = require('../src/doc/index.js');
const L = require('../src/doc/library.js');

const PICKERS = { font: ['auto', ...Object.keys(D.FONTS)], tempo: Object.keys(D.TEMPOS), dir: ['L', 'R'] };
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

async function createShell({ storage, exporter = null, autosaveMs = 1500, timers = { setTimeout, clearTimeout } } = {}) {
  if (!storage) throw new Error('createShell: a storage is needed');
  let lib = L.builtinLibrary();
  const saved = await storage.openLibrary();
  if (saved) lib = L.parseLibrary(saved);
  const canAutosave = typeof storage.saveAutosave === 'function';
  let recovery = null, startMessage = null;
  if (canAutosave && typeof storage.openAutosave === 'function') {
    const left = await storage.openAutosave();
    if (left) {
      try { const o = JSON.parse(left); recovery = { name: o.name || null, doc: D.parse(o.doc) }; }
      catch (e) { startMessage = `an autosave was found but could not be read, so it was left alone: ${e.message}`; }
    }
  }
  let st = {
    history: D.createHistory(D.createDoc('untitled')), lib, resolved: null, resolveError: null,
    pickers: { font: 'auto', tempo: 'standard', dir: 'L' }, selection: null, name: null, dirty: false, message: startMessage, recovery,
    exportReds: null,
  };
  st.resolved = D.resolve(st.history.present);
  const subs = new Set();
  const emit = () => { for (const f of subs) f(st); };
  let autoDue = false, autoTimer = null;
  const set = (patch) => {
    const before = st.history.present;
    st = Object.freeze({ ...st, ...patch });
    if (canAutosave && st.dirty && st.history.present !== before) {
      autoDue = true;
      if (autosaveMs > 0) { if (autoTimer) timers.clearTimeout(autoTimer); autoTimer = timers.setTimeout(() => { autoTimer = null; return writeAutosave(); }, autosaveMs); }
    }
    emit(); return st;
  };
  async function writeAutosave() {
    if (!autoDue) return;
    autoDue = false;
    const payload = JSON.stringify({ schema: 1, name: st.name, doc: D.serialize(st.history.present) });
    try { await storage.saveAutosave(payload); } catch (e) { set({ message: `autosave failed: ${e.message}` }); }
  }
  async function clearAutosave() {
    autoDue = false;
    if (autoTimer) { timers.clearTimeout(autoTimer); autoTimer = null; }
    if (canAutosave && typeof storage.clearAutosave === 'function') await storage.clearAutosave();
  }

  /** Commit a new document (one undo entry) and re-resolve from the first changed word. */
  const commit = (doc, extra = {}) => set({ history: D.commit(st.history, doc), ...resolved(doc), dirty: true, message: null, ...extra });
  // A CLOSED track resolves through its open twin, marked closed: resolve still refuses closed documents
  // (CLOSE_NOT_BUILT) until the model takes them, and src/export/fromwords.js takes the same route. The panels then
  // build it with buildPath(…, { closed: true }) from `resolved.closed`.
  function resolved(doc) {
    try {
      const open = doc.closed ? { ...doc, closed: false } : doc;
      const r = st.resolved && !st.resolved.closed === !doc.closed ? D.resolveFrom(st.resolved._open || st.resolved, open) : D.resolve(open);
      return { resolved: doc.closed ? Object.freeze({ ...r, closed: true, _open: r }) : r, resolveError: null };
    } catch (e) { if (e.name === 'ResolveError') return { resolved: null, resolveError: e.message }; throw e; }
  }
  /** Run an edit; a model error becomes the message, and nothing else changes. */
  const attempt = (fn) => {
    try { return fn(); } catch (e) {
      if (['DocError', 'ResolveError', 'HistoryError'].includes(e.name)) { set({ message: e.message }); return null; }
      throw e;
    }
  };
  const doc = () => st.history.present;
  /** The document with palette piece `name` appended at the head: a built-in word takes the pickers, a saved piece keeps its own. */
  function placed(name) {
    const p = st.lib.pieces.find((x) => x.name === name);
    if (!p) throw new D.DocError('NO_SUCH_PIECE', `no piece called "${name}" in the palette`);
    if (!p.builtin) return L.placePiece(doc(), st.lib, name);
    const word = p.words[0].word, { font, tempo, dir } = st.pickers;
    return D.appendWord(doc(), word, { tempo, dir, font: font === 'auto' || word === 'jump' ? undefined : font });
  }

  const api = {
    getState: () => st,
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    palette: () => L.palette(st.lib),
    pickers: () => PICKERS,

    setPicker(key, value) {
      if (!PICKERS[key] || !PICKERS[key].includes(value)) return set({ message: `${key} "${value}" is not one of ${(PICKERS[key] || []).join(', ')}` });
      return set({ pickers: { ...st.pickers, [key]: value }, message: null });
    },

    /** Append a palette piece at the head. A built-in word takes the pickers; a saved piece keeps its own. */
    place(name) { return attempt(() => commit(placed(name), { selection: null })); },

    /**
     * The GHOST of a palette piece (the D170 review: "pick the word, see it ghosted, click to place"): the resolved
     * track as it would be with `name` placed at the head. It is built by the same code as place(), so the ghost is
     * exactly what a click builds, and nothing is committed. Throws the model's error when the piece cannot be placed.
     * The page hands it to the preview as the 't180-ghost' event's `candidate` (app/preview/index.js).
     */
    candidate(name) { const next = placed(name); return resolved(next).resolved || D.resolve({ ...next, closed: false }); },
    removeHead: () => attempt(() => commit(D.removeHead(doc()), { selection: null })),
    undo: () => attempt(() => { const h = D.undo(st.history); return set({ history: h, ...resolved(h.present), dirty: true, message: null, selection: null }); }),
    redo: () => attempt(() => { const h = D.redo(st.history); return set({ history: h, ...resolved(h.present), dirty: true, message: null, selection: null }); }),

    /** Sculpt one word (handles, font, speed): one undo entry. For a drag, use beginDrag / dragTo / endDrag. */
    sculpt: (id, patch) => attempt(() => commit(D.editWord(doc(), id, patch))),
    /** One whole edit, made elsewhere from the present document (a texture pack worn by every word of a font): checked, then one undo step. */
    commitDoc: (d) => attempt(() => { D.checkDoc(d); return commit(d); }),
    beginDrag: () => attempt(() => set({ history: D.beginDrag(st.history) })),
    dragTo: (id, patch) => attempt(() => { const d = D.editWord(doc(), id, patch); return set({ history: D.dragTo(st.history, d), ...resolved(d), dirty: true }); }),
    endDrag: () => attempt(() => set({ history: D.endDrag(st.history) })),

    /** Select the placed words from id `from` to id `to` (inclusive, in track order). */
    select(from, to = from) {
      const ids = doc().words.map((w) => w.id), a = ids.indexOf(from), b = ids.indexOf(to);
      if (a < 0 || b < 0) return set({ message: `no placed word ${a < 0 ? from : to}` });
      const [i, j] = a <= b ? [a, b] : [b, a];
      return set({ selection: ids.slice(i, j + 1), message: null });
    },
    clearSelection: () => set({ selection: null }),

    /** Save the selected run as the user's own named piece; it joins the palette and the library file. */
    async saveSelectionAsPiece(name, author = '') {
      if (!st.selection || !st.selection.length) return set({ message: 'select one or more placed words first' });
      const lib = attempt(() => L.savePiece(st.lib, { name, author, doc: doc(), ids: st.selection }));
      if (!lib) return st;
      await storage.saveLibrary(L.serializeLibrary(lib));
      return set({ lib, message: null });
    },

    /** A piece or phrase from its file text (a pasted code decodes to this): it joins the palette and the library file. */
    async importPieceText(text) {
      const lib = attempt(() => L.importPiece(st.lib, text));
      if (!lib) return st;
      await storage.saveLibrary(L.serializeLibrary(lib));
      return set({ lib, message: null });
    },

    newDoc(name = 'untitled') {
      const d = D.createDoc(name);
      return set({ history: D.createHistory(d), resolved: D.resolve(d), resolveError: null, selection: null, name: null, dirty: false, message: null });
    },
    async save(name) {
      if (!NAME_RE.test(name || '')) return set({ message: `a track name is 1 to 64 letters, digits, spaces, _ or -, starting with a letter or digit; got ${JSON.stringify(name)}` });
      await storage.saveDoc(name, D.serialize(doc()));
      await clearAutosave();   // the named file holds the track now
      return set({ name, dirty: false, message: null });
    },
    /** Open a saved track. Opening starts a fresh history: undo does not reach back into the previous track. */
    async open(name) {
      const text = await storage.openDoc(name);
      const d = attempt(() => D.parse(text));
      if (!d) return st;
      return set({ history: D.createHistory(d), ...resolved(d), selection: null, name, dirty: false, message: null });
    },
    /** Write the autosave now if one is due (the debounce would have written it after the pause). */
    flushAutosave: () => writeAutosave(),
    /** Take the track the last session left unsaved. It becomes the open track, with a fresh history, still unsaved. */
    restore() {
      if (!st.recovery) return set({ message: 'there is no unsaved track to restore' });
      const { doc: d, name } = st.recovery;
      return set({ history: D.createHistory(d), ...resolved(d), selection: null, name, dirty: true, recovery: null, message: null });
    },
    async discardRecovery() { await clearAutosave(); return set({ recovery: null }); },
    /** The window is closing on purpose: nothing is left to recover. */
    async cleanExit() { await clearAutosave(); },
    /**
     * Close the loop (src/doc/connector.js): the safest connector (the first ranked, by its worst physics margin) is
     * appended as ordinary words, one undo step. An AC track must be a closed lap before it can be exported. It takes
     * seconds: every candidate is a solved, validated lap.
     */
    closeLoop() {
      return attempt(() => {
        const r = require('../src/doc/connector.js').closeLoop(doc());
        if (!r.candidates.length) return set({ message: r.reason });
        const c = r.candidates[0];
        return commit(c.doc, { message: `loop closed with ${c.words.length} words (${Math.round(c.lengthM)} m), worst load on the connector ${c.maxG.toFixed(1)} g`, selection: null });
      });
    },

    /** Put a prepared document in front of the user, as opening one does: fresh history, nothing to undo. */
    adopt(d) { D.checkDoc(d); return set({ history: D.createHistory(d), ...resolved(d), selection: null, dirty: false, message: null, exportReds: null }); },

    /**
     * EXPORT the open track as an AC track folder into `dir`, the folder the user picked (app/export/export.js). The AC
     * guard runs first; then src/export/fromwords.js exportTrack() runs in memory; only then are files written, through
     * storage.writeExport(dir, folder, files). A refusal writes nothing: a red track sets state.exportReds to every red
     * range with its reason and source. No game is launched and nothing is installed anywhere else.
     */
    async exportTo(dir, opts = {}) {
      if (!exporter) return set({ message: 'export is not available here' });
      const g = exporter.checkTarget(dir);
      if (!g.ok) return set({ message: g.reason, exportReds: null });
      let out;
      try { out = exporter.run(doc(), opts); } catch (e) {
        if (e.name !== 'ExportError') throw e;
        return set({ message: e.message, exportReds: e.code === 'RED' ? e.red : null });
      }
      for (const f of out.folders) await storage.writeExport(dir, f.folder, f.files);
      const warn = out.result.warnings && out.result.warnings.length ? ` (${out.result.warnings.length} warning${out.result.warnings.length > 1 ? 's' : ''}: ${out.result.warnings.join(' · ')})` : '';
      return set({ message: `exported ${out.folders.map((f) => f.folder).join(', ')} to ${dir}${warn}`, exportReds: null, lastExport: { dir, folders: out.folders.map((f) => f.folder) } });
    },
    list: () => storage.listDocs(),
    text: () => D.serialize(doc()),
  };
  return api;
}

/**
 * The app's keys, from a key event to an action name (or null). Pure, so it is tested headless; app/index.html calls it.
 * REMOVING THE HEAD TAKES Ctrl+Backspace (or Cmd+Backspace). A bare Backspace does nothing: it is the key most often hit
 * by accident, and a confirm step would interrupt every deliberate removal, which is one undo step anyway. So the guard
 * is a modifier, not a dialog. While a field has focus, no key reaches the track. Letters without Ctrl belong to the
 * panels (the cameras use them).
 */
function keyAction({ key, ctrlKey, metaKey, shiftKey, inField }) {
  if (inField) return null;
  const ctrl = ctrlKey || metaKey, k = String(key || '').toLowerCase();
  if (!ctrl) return null;
  if (k === 'z') return shiftKey ? 'redo' : 'undo';
  if (k === 'y') return 'redo';
  if (k === 's') return 'save';
  if (k === 'backspace') return 'removeHead';
  return null;
}

module.exports = { createShell, PICKERS, NAME_RE, keyAction };
