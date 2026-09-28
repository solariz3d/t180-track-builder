// grammar.js: what usually comes NEXT, from the measured library (FINDINGS §7 "Sakura's corners open and close in steps:
// `sweep → turn → tight → turn → sweep`, never straight into tight … The builder's transitions should obey it").
//
//   suggestNext(doc, grammar, k = 3) -> { after, suggestions: [{ word, n, share }] }
//
// `grammar` is vocabgen's: per class, the classes seen next over every read, most seen first. The reader's classes are
// the builder's word names, so the head's class is its WORD. An empty document, or a grammar the corpus did not give
// (null), gets no suggestion rather than a guess. A suggestion is only ever that: nothing here refuses a word, and
// appendWord takes any word after any other (test/grammar.test.js).
'use strict';

/** The last placed word (a phrase's last word), or null. */
function headWord(doc) {
  const e = doc.words[doc.words.length - 1];
  if (!e) return null;
  return e.phrase !== undefined ? e.words[e.words.length - 1].word : e.word;
}

function suggestNext(doc, grammar, k = 3) {
  const after = headWord(doc);
  if (after === null || !grammar || !grammar[after]) return { after, suggestions: [] };
  return { after, suggestions: grammar[after].slice(0, k).map((s) => ({ word: s.to, n: s.n, share: s.share })) };
}

module.exports = { suggestNext, headWord };
