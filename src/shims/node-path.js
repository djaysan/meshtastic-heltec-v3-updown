// Browser stand-in for the parts of node:path that tslog touches.

/** tslog only normalises a "file:line" string for its log prefix. */
export function normalize(value) {
  return String(value ?? '');
}

export default { normalize, };
