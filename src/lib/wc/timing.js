/**
 * BOUNDS
 * ---------------------------------------------------------------------------
 * Every wait in the wallet flow is bounded here, for one reason: the SDK's own
 * internal retry loop is longer than any user will wait.
 *
 * Inside `Relayer.connect()` the SDK retries the relay socket up to five times
 * with an increasing backoff BEFORE it ever rejects, and each attempt waits out
 * its own internal "socket stalled" timeout. On a network that filters the
 * relay outright that is 60–90+ seconds of a spinner with zero feedback — which
 * reads exactly like "it just spins".
 *
 * `withTimeout` does not cancel the SDK's socket (it keeps retrying on its own
 * schedule and is simply abandoned); it returns the user's screen to them with
 * an actionable answer instead.
 */

import { TIMEOUT } from './config.js';

/**
 * Is this failure the RELAY, rather than the user or the dashboard?
 *
 * Only a relay-class error justifies spending another 8s on the second
 * hostname. A user who cancelled, or an origin the dashboard refused, must fail
 * immediately — retrying those on another host is how one dismissal turned into
 * a 20-second freeze.
 */
export function isRelayError(error) {
  const msg = String(error?.message ?? error ?? '').toLowerCase();
  if (!msg) return false;
  return /websocket|socket stalled|socket error|closed_|network|failed to publish|relay|timeout|no internet/i.test(
    msg
  );
}

/**
 * Is this the AppKit MODAL failing to load, rather than the connection?
 *
 * `EthereumProvider.init()` wraps the whole AppKit bootstrap — the dynamic
 * `import('@reown/appkit/core')` and the `createAppKit()` call — in one
 * try/catch and rethrows `'To use QR modal, please install @reown/appkit
 * package'`. That single string covers every way the surface can fail to
 * appear: a blocked CDN chunk, a `createAppKit` throw, a renamed bundler entry.
 * None of them say anything about the relay or the project id, so classifying
 * them as a connection failure would report "the relay is unreachable" for a
 * modal that never rendered.
 */
export function isModalError(error) {
  const msg = String(error?.message ?? '');
  return /QR modal/i.test(msg) || /@reown\/appkit/i.test(msg);
}

/**
 * Classify a connect failure into the one code the UI can act on.
 *
 * The old stack collapsed every WalletConnect breakage into one generic
 * CONNECT_FAILED, which is why "Trust bounces back" and "MetaMask says invalid
 * URL" arrived with zero context and every investigation started from scratch.
 */
export function classifyConnectError(error) {
  const msg = String(error?.message ?? '');
  if (
    /user rejected/i.test(msg) ||
    error?.code === 4001 ||
    /connection request reset/i.test(msg) ||
    msg === 'WC_USER_CANCELLED'
  ) {
    return 'USER_REJECTED';
  }
  if (/origin not allowed|unauthorized|project id/i.test(msg)) return 'WC_ORIGIN_BLOCKED';
  /* Matched BEFORE the relay branch: the relay demonstrably worked — it issued
     the URI this attempt was showing — so the honest answer is "try again",
     not "your network is blocking the relay". */
  if (msg === 'WC_PAIRING_EXPIRED' || /proposal expired|expired/i.test(msg)) return 'WC_EXPIRED';
  if (
    msg === 'WC_CONNECT_TIMEOUT' ||
    msg === 'WC_INIT_TIMEOUT' ||
    isRelayError(msg) ||
    /no internet/i.test(msg)
  ) {
    return 'WC_RELAY_UNREACHABLE';
  }
  if (msg === 'WC_BUSY') return 'WC_BUSY';
  return 'CONNECT_FAILED';
}

/**
 * Race a promise against a bound.
 *
 * @returns {Promise<any>} rejects with `new Error(code)` when the bound fires.
 */
export function withTimeout(promise, ms = TIMEOUT.connect, code = 'TIMEOUT') {
  return new Promise((resolve, reject) => {
    let timer = null;
    const clear = () => {
      if (timer) clearTimeout(timer);
    };
    timer = setTimeout(() => reject(new Error(code)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clear();
        resolve(value);
      },
      (error) => {
        clear();
        reject(error);
      }
    );
  });
}

/**
 * A promise that stays pending until `cancel()` is called.
 *
 * Used as the switch that settles a connect() the user dismissed — the SDK's
 * `abortPairingAttempt()` is a deprecated no-op, so this is the only way to give
 * the user's Cancel effect immediately instead of after the 20s bound.
 */
export function cancelSwitch(code = 'WC_USER_CANCELLED') {
  let cancel = null;
  const promise = new Promise((_, reject) => {
    cancel = () => reject(new Error(code));
  });
  /* A late cancel must never surface as an unhandled rejection. */
  promise.catch(() => {});
  return { promise, cancel };
}

/** Sleep, for bounded retries. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
