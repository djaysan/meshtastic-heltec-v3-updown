/**
 * Minimal `process` for the browser bundle.
 *
 * @meshtastic/core pulls in the Node build of tslog, which reads
 * process.cwd() while formatting a log line and checks process.env in a few
 * feature tests. A browser has no process at all, so loading the bundle threw
 * ReferenceError before a single line of our own code ran. esbuild --inject
 * swaps references to the global for this object.
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

export { process };
