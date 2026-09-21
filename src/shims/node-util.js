// Browser stand-in for the parts of node:util that tslog touches.

/**
 * tslog formats its log arguments through this. The browser console already
 * formats anything handed to it, so pass the arguments straight through.
 */
export function formatWithOptions(_options, ...args) {
  return args
    .map((arg) => (typeof arg === 'string' ? arg : safeStringify(arg)))
    .join(' ');
}

function safeStringify(value) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** tslog checks types.isNativeError to decide how to print a thrown value. */
export const types = {
  isNativeError: (value) => value instanceof Error,
};

export default { formatWithOptions, types, };
