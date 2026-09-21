/**
 * Minimal Node globals for the browser bundle.
 *
 * @meshtastic/core pulls in the Node build of tslog, which reaches for
 * process.cwd() and Buffer.isBuffer() while formatting a log line. A browser
 * has neither, so the page threw ReferenceError: process on load, and then
 * ReferenceError: Buffer on the first log call once process was shimmed.
 * esbuild --inject swaps the free references for these objects at build time.
 */
const process = {
  env: {},
  argv: [],
  platform: 'browser',
  version: '',
  versions: {},
  cwd: () => '/',
  nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
};

// tslog only ever asks whether a log argument is a Buffer. In a browser it
// never is, so answering no is the whole contract.
const Buffer = {
  isBuffer: () => false,
};

export { process, Buffer };
