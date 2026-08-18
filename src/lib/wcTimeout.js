/**
 * BOUND A WALLETCONNECT AWAIT — the "spins forever" fix.
 * ---------------------------------------------------------------------------
 * `EthereumProvider.init()` / `wc.connect()` have no outer timeout of their
 * own. Inside the SDK, `Relayer.connect()` retries the relay socket up to 5
 * times with an increasing backoff BEFORE it ever rejects — on a network
 * that blocks `relay.walletconnect.com` outright (the Iranian case), that is
 * several stalled socket attempts, each waiting out its own internal
 * "Socket stalled" timeout, before the promise this app awaits ever settles.
 * That is 60-90+ seconds of a spinner with zero feedback, which reads
 * exactly like "it just spins" or "fail connection" with no explanation.
 *
 * This is a standalone module (not inlined in WalletContext.jsx) so it can
 * be unit-tested in a bare Node process without mounting React or a real
 * WalletConnect client — see test/wc-timeout-probe.mjs.
 */

/** How long we wait for a WalletConnect operation before giving up on it. */
export const WC_CONNECT_TIMEOUT_MS = 20_000;

/**
 * Race `promise` against a timer. On timeout, rejects with an Error whose
 * `.message` is `code` — the caller's classifier (WalletContext's
 * connect/restore catch blocks) already recognises `WC_CONNECT_TIMEOUT` /
 * `WC_RESTORE_TIMEOUT` and maps them to the actionable `WC_RELAY_UNREACHABLE`
 * user-facing error.
 *
 * The abandoned `promise` is NOT cancelled — WalletConnect's SDK exposes no
 * cancellation token for `connect()` — so callers must additionally call
 * `wc.disconnect()` on the instance once this rejects, to stop the zombie
 * socket/modal from outliving the attempt. That cleanup lives in
 * WalletContext.jsx, right next to the classification that needs it.
 */
export function withTimeout(promise, ms = WC_CONNECT_TIMEOUT_MS, code = 'TIMEOUT') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
