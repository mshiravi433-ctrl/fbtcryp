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
 * HOW LONG A HUMAN GETS TO APPROVE — the ceiling once a pairing URI exists.
 * ---------------------------------------------------------------------------
 * One flat timeout cannot serve both halves of a pairing, and conflating them
 * is what produced this app's worst misdiagnosis:
 *
 *   • BEFORE a pairing URI exists, every millisecond is the RELAY's: a
 *     proposal that has not been published within WC_CONNECT_TIMEOUT_MS is
 *     not coming, and saying so fast is the entire point of the bound.
 *   • AFTER the URI exists the relay has already proven itself — it issued the
 *     topic and the symmetric key and published the proposal. What is left is
 *     a person picking up a phone, opening Trust, and tapping approve; on the
 *     QR path they may be walking to a second device. Cutting that off at 20s
 *     aborts a perfectly healthy pairing and reports it as "relay
 *     unreachable", which sends the user off to fix a network that was never
 *     broken.
 *
 * Five minutes is not an arbitrary grace period: it is the lifetime of a
 * WalletConnect v2 pairing, so the ceiling can never outlive the thing it is
 * waiting for. Expiry is reported as WC_PAIRING_EXPIRED, which the connect
 * catch-block maps to the honest "the request expired before the wallet
 * approved it" — never to the relay error.
 */
export const WC_PAIRING_TTL_MS = 300_000;

/**
 * RELAY ENDPOINTS, IN TRY ORDER.
 * ---------------------------------------------------------------------------
 * `EthereumProvider.init()` was called without a `relayUrl`, so every
 * pairing went to ONE hardcoded hostname. That hostname was
 * `wss://relay.walletconnect.com` — which is neither the SDK's default nor
 * the hostname Reown documents for exactly this situation. Measured in the
 * installed SDK: `@walletconnect/core@2.25.0`,
 * `dist/types/constants/relayer.d.ts` declares
 * `RELAYER_DEFAULT_RELAY_URL = "wss://relay.walletconnect.org"` — it is the
 * only `wss://` literal in that bundle, and `Core` falls back to it whenever
 * it is given no `relayUrl`. docs.reown.com/advanced/faq answers
 * "the default relay endpoint is blocked" with
 * `relayUrl: 'wss://relay.walletconnect.org'`.
 *
 * So the ORDER below is the SDK's own default first. The app was overriding
 * it with the historical hostname and paying an 8s fuse on that override
 * before reaching the host the SDK would have picked by itself — on a network
 * where only the historical hostname is filtered, that fuse is the whole
 * difference between "connected" and "the relay is unreachable".
 *
 * The connect/restore flows walk this list with `initWcProvider()` in
 * WalletContext.jsx: the first entry gets a short fuse
 * (`WC_PRIMARY_RELAY_TIMEOUT_MS`, below), the last the full
 * WC_CONNECT_TIMEOUT_MS. Filtering that blocks one hostname (SNI/DNS based —
 * the common shape) is answered in ~8s with a working socket instead of a
 * ~28s failure; a network that blocks BOTH still gets the same named error,
 * just sooner than the SDK's own multi-retry stall (60-90s+) ever answered.
 *
 * Both hostnames front the same WalletConnect relay pool — pairing state is
 * not partitioned by which hostname carried it, and the pairing URI itself
 * carries no relay hostname at all (`relay:{protocol:"irn"}`), so the wallet
 * on the other side is free to use whichever hostname IT can reach.
 *
 * The health panel probes EVERY hostname in this list (lib/walletHealth.js):
 * one blocked hostname is not "the relay is blocked".
 */
export const WC_RELAY_URLS = [
  'wss://relay.walletconnect.org',
  'wss://relay.walletconnect.com'
];

/**
 * How long the PRIMARY relay gets to open before the fallback is tried.
 * Short on purpose: a blocked socket is discovered by this timer, not by
 * the SDK's own 5-attempt backoff loop. Long enough for a slow-but-working
 * primary on a mobile network.
 */
export const WC_PRIMARY_RELAY_TIMEOUT_MS = 8_000;

/**
 * Is this error one of the relay-unreachable class?
 *
 * The SAME sentence the connect catch-block in WalletContext.jsx already
 * uses to name WC_RELAY_UNREACHABLE decides here whether trying the next
 * relay hostname in WC_RELAY_URLS is worth doing at all. It deliberately
 * does NOT match:
 *
 *  - \"User rejected\" / 4001 / \"connection request reset\" — the user
 *    cancelled; retrying on another relay would re-open a modal they just
 *    dismissed.
 *  - \"origin not allowed\" / project-id errors — the fallback relay would
 *    reject the same origin the same way, costing 20s for nothing.
 */
export function isRelayClassError(error) {
  const msg = String(error?.message || '');
  return (
    msg === 'WC_CONNECT_TIMEOUT'
    || msg === 'WC_RESTORE_TIMEOUT'
    || msg === 'WC_INIT_TIMEOUT'
    || /websocket|socket stalled|network|failed to publish|relay|timeout|no internet connection/i.test(msg)
  );
}

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
