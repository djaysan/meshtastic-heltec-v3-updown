// Browser stand-in for the parts of node:os that tslog touches.
// @meshtastic/core ships tslog's Node build inlined, so the bundle imports
// these even though nothing in the page needs them.

/** tslog stamps the host name onto log meta. There is none in a browser. */
export function hostname() {
  return '';
}

export default { hostname, };
