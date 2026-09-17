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
 *
 * ─── WHY OUR OWN BOUND IS NO LONGER «THE RELAY» ─────────────────────────────
 * `isRelayError()` matches /timeout/i, so `WC_CONNECT_TIMEOUT` used to be
 * reported as «the relay is unreachable — your ISP blocks it». The relay had
 * just issued the pairing URI the wallet was opened with: it demonstrably
 * worked. What actually happened is that NOBODY APPROVED IN TIME. Naming that
 * «the network» sends the user hunting for a VPN and hides the one thing that
 * would have helped — the clock ran out while they were in the wallet.
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
  /* OUR OWN BOUNDS, named by the wait they ended — never by the network. */
  if (msg === 'WC_CONNECT_TIMEOUT' || msg === 'WC_PAIRING_EXPIRY_REACHED') return 'WC_TIMEOUT';
  /* An init that never came back really is the socket/relay: nothing else
     happens between EthereumProvider.init() and the relay handshake. */
  if (msg === 'WC_INIT_TIMEOUT') return 'WC_RELAY_UNREACHABLE';
  if (isRelayError(msg) || /no internet/i.test(msg)) {
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
 * A bound that PAUSES while this document is not on screen.
 *
 * ─── WHY ──────────────────────────────────────────────────────────────────
 * A mobile WalletConnect pairing is not a network wait, it is a HUMAN wait:
 * the user reads an approval screen in another app, unlocks a wallet, and
 * taps Connect. A flat timer measures the wrong thing. While the page is
 * hidden the user cannot be waiting for us — they are the one we are waiting
 * for — so the clock stops and resumes where it left off.
 *
 * It is also the cheapest honest fix for a whole class of reports: «the wallet
 * opened, I approved, and nothing happened» was the old 20s fuse firing while
 * the user was still standing in Trust Wallet, tearing the provider down from
 * under the approval.
 *
 * Two clocks, on purpose:
 *   • the soft clock — `remaining`, pausable, extended by `extend()`;
 *   • the hard clock — `hardCapMs` from the start, never paused, so an attempt
 *     can never hang forever in a tab the user never returns to.
 *
 * @param {number} totalMs        the visible budget
 * @param {string} [code]         the rejection message
 * @param {object} [options]
 * @param {number} [options.hardCapMs]
 * @param {string} [options.hardCode]  a different code for the hard cap (the
 *   pairing expired, which is a different sentence from «nobody answered»)
 * @param {() => number} [options.now]
 * @returns {{
 *   promise: Promise<never>,
 *   pause: () => void,
 *   resume: () => void,
 *   extend: (ms: number) => void,
 *   cancel: (code?: string) => void,
 *   stop: () => void,
 *   remaining: () => number
 * }}
 */
export function pauseBound(
  totalMs,
  code = 'WC_CONNECT_TIMEOUT',
  { hardCapMs = Number.POSITIVE_INFINITY, hardCode = 'WC_PAIRING_EXPIRY_REACHED', now = () => Date.now() } = {}
) {
  let remaining = Math.max(0, Number(totalMs) || 0);
  let armedAt = now();
  let softTimer = null;
  let hardTimer = null;
  let paused = false;
  let settled = false;
  let reject;

  const promise = new Promise((_, rej) => {
    reject = rej;
  });
  /* A late bound must never surface as an unhandled rejection. */
  promise.catch(() => {});

  const settle = (message) => {
    if (settled) return false;
    settled = true;
    if (softTimer) clearTimeout(softTimer);
    if (hardTimer) clearTimeout(hardTimer);
    softTimer = null;
    hardTimer = null;
    reject(new Error(message));
    return true;
  };

  const armSoft = () => {
    if (softTimer) clearTimeout(softTimer);
    softTimer = null;
    if (settled || paused) return;
    const cap = Number.isFinite(hardCapMs) ? Math.max(0, hardCapMs - (now() - armedAt)) : Number.POSITIVE_INFINITY;
    const wait = Math.min(remaining, cap);
    if (wait <= 0) {
      settle(cap <= 0 ? hardCode : code);
      return;
    }
    softTimer = setTimeout(() => settle(code), wait);
  };

  if (Number.isFinite(hardCapMs)) {
    hardTimer = setTimeout(() => settle(hardCode), Math.max(0, hardCapMs));
  }
  armSoft();

  return {
    promise,
    pause() {
      if (settled || paused) return false;
      paused = true;
      remaining = Math.max(0, remaining - (now() - armedAt));
      if (softTimer) clearTimeout(softTimer);
      softTimer = null;
      return true;
    },
    resume() {
      if (settled || !paused) return false;
      paused = false;
      armedAt = now();
      armSoft();
      return true;
    },
    /** Grant more budget — capped by the hard clock, which never moves. */
    extend(ms) {
      if (settled) return false;
      const want = Math.max(0, Number(ms) || 0);
      if (paused) {
        remaining = Math.max(remaining, want);
        return true;
      }
      const spent = now() - armedAt;
      if (want > remaining - spent) {
        remaining = want + spent;
        armedAt = now();
        armSoft();
      }
      return true;
    },
    /** Settle NOW with a code of the caller's choosing (Cancel, teardown…). */
    cancel(message = 'WC_USER_CANCELLED') {
      return settle(message);
    },
    stop() {
      if (settled) return false;
      settled = true;
      if (softTimer) clearTimeout(softTimer);
      if (hardTimer) clearTimeout(hardTimer);
      softTimer = null;
      hardTimer = null;
      return true;
    },
    remaining() {
      if (settled) return 0;
      return paused ? remaining : Math.max(0, remaining - (now() - armedAt));
    }
  };
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
