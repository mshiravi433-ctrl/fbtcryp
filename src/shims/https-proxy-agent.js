/**
 * Browser shim for the Node-only `https-proxy-agent` package.
 *
 * dYdX's official client imports this helper for optional proxy support. A
 * browser cannot create a Node `http.Agent` (and bundling the package pulls in
 * `net`, `tls` and other server-only modules), while the app uses same-origin
 * fetches and never configures a proxy in the browser. Keep the constructor
 * shape so an accidental proxy option fails harmlessly instead of crashing
 * module evaluation; the browser's fetch stack owns its connection routing.
 */
export class HttpsProxyAgent {
  constructor() {
    this.protocols = ['http', 'https'];
    this.isBrowserShim = true;
  }
}

export default HttpsProxyAgent;
