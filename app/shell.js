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
// STORAGE is injected: { saveDoc(name, text), openDoc(name), listDocs(), saveLibrary(text), openLibrary() }, each
// returning a promise. In the app it is Tauri commands (src-tauri/src/lib.rs); in the tests, a Map.
// A FAILED ACTION changes nothing and says why: state.message holds the model's own error text (DocError,
// ResolveError), and the document and history stay as they were.
'use strict';

const D = require('../src/doc/index.js');
const L = require('../src/doc/library.js');

const PICKERS = { font: ['auto', ...Object.keys(D.FONTS)], tempo: Object.keys(D.TEMPOS), dir: ['L', 'R'] };
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

async function createShell({ storage } = {}) {
  if (!storage) throw new Error('createShell: a storage is needed');
  let lib = L.builtinLibrary();
  const saved = await storage.openLibrary();
  if (saved) lib = L.parseLibrary(saved);
  let st = {
    history: D.createHistory(D.createDoc('untitled')), lib, resolved: null, resolveError: null,
    pickers: { font: 'auto', tempo: 'standard', dir: 'L' }, selection: null, name: null, dirty: false, message: null,
  };
  st.resolved = D.resolve(st.history.present);
  const subs = new Set();
  const emit = () => { for (const f of subs) f(st); };
  const set = (patch) => { st = Object.freeze({ ...st, ...patch }); emit(); return st; };

  /** Commit a new document (one undo entry) and re-resolve from the first changed word. */
  const commit = (doc, extra = {}) => set({ history: D.commit(st.history, doc), ...resolved(doc), dirty: true, message: null, ...extra });
  function resolved(doc) {
    try { return { resolved: st.resolved ? D.resolveFrom(st.resolved, doc) : D.resolve(doc), resolveError: null }; }
    catch (e) { if (e.name === 'ResolveError') return { resolved: null, resolveError: e.message }; throw e; }
  }
  /** Run an edit; a model error becomes the message, and nothing else changes. */
  const attempt = (fn) => {
    try { return fn(); } catch (e) {
      if (['DocError', 'ResolveError', 'HistoryError'].includes(e.name)) { set({ message: e.message }); return null; }
      throw e;
    }
  };
  const doc = () => st.history.present;

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
    place(name) {
      return attempt(() => {
        const p = st.lib.pieces.find((x) => x.name === name);
        if (!p) throw new D.DocError('NO_SUCH_PIECE', `no piece called "${name}" in the palette`);
        let next;
        if (p.builtin) {
          const word = p.words[0].word, { font, tempo, dir } = st.pickers;
          next = D.appendWord(doc(), word, { tempo, dir, font: font === 'auto' || word === 'jump' ? undefined : font });
        } else next = L.placePiece(doc(), st.lib, name);
        return commit(next, { selection: null });
      });
    },
    removeHead: () => attempt(() => commit(D.removeHead(doc()), { selection: null })),
    undo: () => attempt(() => { const h = D.undo(st.history); return set({ history: h, ...resolved(h.present), dirty: true, message: null, selection: null }); }),
    redo: () => attempt(() => { const h = D.redo(st.history); return set({ history: h, ...resolved(h.present), dirty: true, message: null, selection: null }); }),

    /** Sculpt one word (handles, font, speed): one undo entry. For a drag, use beginDrag / dragTo / endDrag. */
    sculpt: (id, patch) => attempt(() => commit(D.editWord(doc(), id, patch))),
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

    newDoc(name = 'untitled') {
      const d = D.createDoc(name);
      return set({ history: D.createHistory(d), resolved: D.resolve(d), resolveError: null, selection: null, name: null, dirty: false, message: null });
    },
    async save(name) {
      if (!NAME_RE.test(name || '')) return set({ message: `a track name is 1 to 64 letters, digits, spaces, _ or -, starting with a letter or digit; got ${JSON.stringify(name)}` });
      await storage.saveDoc(name, D.serialize(doc()));
      return set({ name, dirty: false, message: null });
    },
    /** Open a saved track. Opening starts a fresh history: undo does not reach back into the previous track. */
    async open(name) {
      const text = await storage.openDoc(name);
      const d = attempt(() => D.parse(text));
      if (!d) return st;
      return set({ history: D.createHistory(d), ...resolved(d), selection: null, name, dirty: false, message: null });
    },
    list: () => storage.listDocs(),
    text: () => D.serialize(doc()),
  };
  return api;
}

module.exports = { createShell, PICKERS, NAME_RE };
