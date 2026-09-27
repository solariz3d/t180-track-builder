// palette-fakedom.js: just enough of the DOM for the palette's and panels' DOM halves to run under node, for the tests.
// It follows the DOM where the bugs live: append / replaceChildren turn every non-Node argument into a text node of
// String(argument), so a stray null becomes the text "null" here exactly as it does in the WebView (B's "nullnull").
'use strict';

class Node {}
class Text extends Node {
  constructor(data) { super(); this.data = data; }
  get textContent() { return this.data; }
}
class Element extends Node {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.listeners = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  dispatch(ev, e = {}) { for (const fn of this.listeners[ev] || []) fn({ target: this, ...e }); }
  static wrap(x) { return x instanceof Node ? x : new Text(String(x)); }
  append(...xs) { for (const x of xs) this.children.push(Element.wrap(x)); }
  replaceChildren(...xs) { this.children = xs.map(Element.wrap); }
  set textContent(v) { this.children = [new Text(String(v))]; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = v; }
  get value() { return this.attrs.value || ''; }
  set value(v) { this.attrs.value = v; }
  /** Depth-first walk over elements. */
  *walk() { for (const c of this.children) if (c instanceof Element) { yield c; yield* c.walk(); } }
  querySelector(sel) {
    for (const e of this.walk()) {
      if (sel.startsWith('#') && e.id === sel.slice(1)) return e;
      if (sel.startsWith('.') && e.className.split(/\s+/).includes(sel.slice(1))) return e;
      if (/^[a-z]+$/i.test(sel) && e.tagName === sel.toUpperCase()) return e;
    }
    return null;
  }
  querySelectorAll(sel) { const out = []; for (const e of this.walk()) if (sel.startsWith('.') ? e.className.split(/\s+/).includes(sel.slice(1)) : e.tagName === sel.toUpperCase()) out.push(e); return out; }
  /** Every text node's data under this element, in order. */
  texts() { const out = []; (function go(n) { for (const c of n.children) c instanceof Text ? out.push(c.data) : go(c); })(this); return out; }
}

function install() {
  const prev = global.document;
  global.document = { createElement: (t) => new Element(t) };
  return () => { global.document = prev; };
}

module.exports = { install, Element, Text, Node };
