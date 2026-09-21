/**
 * Loads the built bundle the way a browser does: a DOM, and none of Node's
 * globals. A plain Node harness cannot catch this class of bug, because Node
 * supplies process and Buffer and the browser does not. Shipping a bundle
 * that touches either one throws on load and silently kills the whole page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'configure.js');

/** A forgiving stand-in for any DOM element. */
function element() {
  const node = { options: [], children: [], value: '', checked: false, textContent: '', disabled: false };
  return new Proxy(node, {
    get(target, key) {
      if (key === 'append' || key === 'appendChild') {
        return (...kids) => { target.options.push(...kids); target.children.push(...kids); };
      }
      if (key === 'addEventListener' || key === 'removeEventListener' || key === 'setAttribute' || key === 'remove') {
        return () => {};
      }
      if (key === 'classList') return { add() {}, remove() {}, toggle() {} };
      if (key === 'style') return {};
      return key in target ? target[key] : undefined;
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

test('the built bundle loads in a browser and fills the tune picker', async () => {
  const nodes = new Map();
  globalThis.document = {
    readyState: 'complete',
    addEventListener: () => {},
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    querySelector: () => element(),
    querySelectorAll: () => [],
    createElement: () => element(),
  };
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'browser-sim' },
    configurable: true,
  });
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

  // The two globals a browser does not have. Removing them is the whole point.
  delete globalThis.process;
  delete globalThis.Buffer;

  await import(BUNDLE);

  const tune = nodes.get('cfg-tune');
  assert.ok(tune, 'the bundle never touched the tune select, so it did not run');
  assert.ok(tune.options.length >= 30, `only ${tune.options.length} tunes were added to the picker`);
});
