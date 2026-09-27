import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextTick, ref, shallowRef, watch } from 'vue';

// Boundary: actual useModalDialog implementation, real Vue scheduler, deterministic
// DOM adapter for focus/inert/keyboard. Browser layout and native accessibility tree
// must additionally be verified in the desktop UI.
function fixture() {
  const listeners = new Map(), dispose = [];
  const document = { body: { children: [] }, activeElement: null,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
  };
  class Element {
    constructor(name, children = []) {
      this.name = name; this.children = children; this.inert = false; this.tagName = 'DIV'; this.isConnected = true;
      children.forEach(child => { child.parent = this; });
    }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
    getClientRects() { return this.hidden ? [] : [{}]; }
    closest() { return this.inert ? this : this.parent?.closest() || null; }
    focus() { document.activeElement = this; listeners.get('focusin')?.({ target: this }); }
  }
  const source = readFileSync(new URL('../src/composables/useModalDialog.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const useModalDialog = new Function('nextTick', 'watch', 'onBeforeUnmount', 'document', `${source}; return useModalDialog;`)(nextTick, watch, fn => dispose.push(fn), document);
  const key = (name, shiftKey = false) => {
    const event = { key: name, shiftKey, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    listeners.get('keydown')?.(event); return event;
  };
  return { Element, document, listeners, useModalDialog, key, dispose };
}
const flush = async () => { await nextTick(); await nextTick(); };

test('modal traps keyboard focus, isolates background, handles Escape and restores opener', async () => {
  const f = fixture(), opener = new f.Element('opener'), first = new f.Element('first'), last = new f.Element('last');
  const app = new f.Element('app', [opener]), modal = new f.Element('modal', [first, last]);
  f.document.body.children = [app, modal]; opener.focus();
  const active = ref(false);
  f.useModalDialog(shallowRef(modal), active, () => { active.value = false; });
  active.value = true; await flush();
  assert.equal(app.inert, true); assert.equal(f.document.activeElement, first);
  last.focus(); assert.equal(f.key('Tab').prevented, true); assert.equal(f.document.activeElement, first);
  assert.equal(f.key('Tab', true).prevented, true); assert.equal(f.document.activeElement, last);
  opener.focus(); assert.equal(f.document.activeElement, first);
  const escape = f.key('Escape'); assert.equal(escape.prevented, true); assert.equal(escape.stopped, true);
  await flush(); assert.equal(app.inert, false); assert.equal(f.document.activeElement, opener);
  assert.equal(f.listeners.size, 0); f.dispose.forEach(fn => fn());
});

test('nested modal restores prior modal and preserves pre-existing inert state', async () => {
  const f = fixture(), opener = new f.Element('opener'), oneButton = new f.Element('one'), twoButton = new f.Element('two');
  const app = new f.Element('app', [opener]), one = new f.Element('modal-one', [oneButton]), two = new f.Element('modal-two', [twoButton]);
  const hidden = new f.Element('already-inert'); hidden.inert = true;
  f.document.body.children = [app, one, two, hidden]; opener.focus();
  const a = ref(false), b = ref(false);
  f.useModalDialog(shallowRef(one), a, () => { a.value = false; });
  f.useModalDialog(shallowRef(two), b, () => { b.value = false; });
  a.value = true; await flush(); b.value = true; await flush();
  assert.equal(one.inert, true); assert.equal(two.inert, false); assert.equal(f.document.activeElement, twoButton);
  f.key('Escape'); await flush();
  assert.equal(one.inert, false); assert.equal(app.inert, true); assert.equal(f.document.activeElement, oneButton);
  a.value = false; await flush(); assert.equal(app.inert, false); assert.equal(hidden.inert, true);
  assert.equal(f.document.activeElement, opener); f.dispose.forEach(fn => fn());
});

test('focusContainer opens on the dialog itself and Shift+Tab from it wraps to the last control', async () => {
  const f = fixture(), opener = new f.Element('opener'), first = new f.Element('first'), last = new f.Element('last');
  const app = new f.Element('app', [opener]), modal = new f.Element('modal', [first, last]);
  f.document.body.children = [app, modal]; opener.focus();
  const active = ref(true);
  f.useModalDialog(shallowRef(modal), active, () => { active.value = false; }, { focusContainer: true });
  await flush(); assert.equal(f.document.activeElement, modal);
  assert.equal(f.key('Tab', true).prevented, true); assert.equal(f.document.activeElement, last);
  opener.focus(); assert.equal(f.document.activeElement, modal);
  f.key('Escape'); await flush(); assert.equal(f.document.activeElement, opener); f.dispose.forEach(fn => fn());
});

test('closing before nextTick or unmounting cannot leave a modal registration behind', async () => {
  const f = fixture(), app = new f.Element('app'), modal = new f.Element('modal');
  f.document.body.children = [app, modal]; app.focus(); const active = ref(true);
  f.useModalDialog(shallowRef(modal), active, () => {});
  f.dispose.forEach(fn => fn()); await flush();
  assert.equal(app.inert, false); assert.equal(f.listeners.size, 0);
});
