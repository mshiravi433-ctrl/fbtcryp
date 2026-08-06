/**
 * INCOMING TRANSFER WATCHER — the receiver's half of tap-to-pay.
 * ---------------------------------------------------------------------------
 * ─── WHAT WAS ASKED ─────────────────────────────────────────────────────────
 *   «در گوشی دریافت کننده پاپ اپی نشان بدهد که چه مقدار و چه نوع دریافت شده
 *    با تم درست و وسط صفحه باشد»
 *
 * The receiving phone should pop up what arrived — how much, and of what.
 *
 * ─── WHY POLLING AND NOT AN EVENT SUBSCRIPTION ──────────────────────────────
 * The obvious implementation is `provider.on('block')` plus a Transfer filter.
 * It is the wrong one here for two concrete reasons:
 *
 *   1. A log filter needs an RPC that serves `eth_getLogs` reliably. The
 *      public endpoints this app falls back to rate-limit or silently
 *      truncate them, so the feature would work on a good connection and fail
 *      invisibly on a bad one — the worst possible behaviour for something
 *      whose entire job is to say "your money arrived".
 *   2. A WebSocket subscription dies when a phone sleeps, and reconnect logic
 *      that has to survive backgrounding is a large amount of machinery for a
 *      window that is open for roughly a minute.
 *
 * Balance polling needs only `eth_getBalance` / `balanceOf`, which every RPC
 * serves, and a missed poll self-heals on the next tick because we compare
 * against a baseline rather than accumulating events.
 *
 * ─── WHY IT ONLY RUNS WHILE THE SHEET IS OPEN ───────────────────────────────
 * This is deliberately NOT a background service. It starts when the user says
 * "I am receiving" and stops when they leave, which keeps it to a handful of
 * requests and means it can never quietly drain a battery. A user who wants
 * durable arrival alerts wants push notifications, which is a different
 * feature with a server behind it.
 *
 * ─── THE BASELINE IS TAKEN BEFORE WATCHING, NOT AFTER ───────────────────────
 * The first read establishes "what I already had". Every later read is
 * compared against it. Getting this backwards — treating the first non-zero
 * balance as an arrival — would fire immediately for anyone who already holds
 * the token, which is most people.
 */

import { formatUnitsExact } from './swap';

/** How often to look. Fast enough to feel immediate, slow enough to be polite. */
const POLL_MS = 4000;

/**
 * ERC-20 `balanceOf(address)`. Hand-encoded rather than pulling in an ABI
 * coder: it is one selector and one padded argument, and this file should not
 * add a dependency to the wallet screen's critical path.
 */
const BALANCE_OF = '0x70a08231';

const pad32 = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

async function rpc(provider, method, params) {
  /*
   * ethers v6 exposes `send`; a raw EIP-1193 provider exposes `request`.
   * Supporting both means this works with the injected wallet directly as
   * well as with our own provider wrapper, and neither is worth a branch at
   * every call site.
   */
  if (typeof provider?.send === 'function') return provider.send(method, params);
  if (typeof provider?.request === 'function') return provider.request({ method, params });
  throw new Error('NO_PROVIDER');
}

/**
 * Read one balance, native or ERC-20, as a BigInt.
 *
 * Returns null rather than throwing on failure: a single missed poll is not
 * an error worth surfacing, and the next tick will simply try again.
 */
export async function readBalance({ provider, address, token }) {
  try {
    if (!provider || !address) return null;
    if (!token || token.native || !token.address) {
      const hex = await rpc(provider, 'eth_getBalance', [address, 'latest']);
      return BigInt(hex);
    }
    const data = `${BALANCE_OF}${pad32(address)}`;
    const hex = await rpc(provider, 'eth_call', [{ to: token.address, data }, 'latest']);
    /* An empty return means the call reverted — treat as unknown, not zero. */
    if (!hex || hex === '0x') return null;
    return BigInt(hex);
  } catch {
    return null;
  }
}

/**
 * Watch one address for an increase in one token's balance.
 *
 * @param {object} p
 * @param {any}    p.provider
 * @param {string} p.address        who is receiving
 * @param {object} p.token          `{ symbol, decimals, address?, native? }`
 * @param {(info: {amount: string, symbol: string}) => void} p.onArrive
 * @param {number} [p.intervalMs]
 * @param {() => Promise<any>} [p.poll]  injected for tests — a timer-driven
 *        network loop is otherwise unverifiable, and this one decides whether
 *        a user is told their money arrived.
 * @returns {() => void} stop
 */
export function watchIncoming({
  provider,
  address,
  token,
  onArrive,
  intervalMs = POLL_MS,
  poll
}) {
  let stopped = false;
  let baseline = null;
  let timer = null;

  const read = poll ?? (() => readBalance({ provider, address, token }));

  const tick = async () => {
    if (stopped) return;
    const now = await read();

    if (now == null) return; // a failed read is not an event

    if (baseline == null) {
      /* First successful read is the reference point, never an arrival. */
      baseline = now;
      return;
    }

    if (now > baseline) {
      const delta = now - baseline;
      /*
       * Re-baseline BEFORE notifying. If the callback throws, or the user
       * receives a second payment while the popup is up, we must not report
       * the first amount twice.
       */
      baseline = now;
      if (!stopped) {
        onArrive?.({
          amount: formatUnitsExact(delta, token?.decimals ?? 18),
          symbol: token?.symbol ?? '',
          raw: delta
        });
      }
    } else if (now < baseline) {
      /*
       * The balance went DOWN — the user spent something from another app.
       * Re-baseline silently, or the next incoming payment would be measured
       * against a stale, higher figure and under-report.
       */
      baseline = now;
    }
  };

  /* Establish the baseline immediately so a payment arriving two seconds
     later is still caught, rather than waiting a full interval first. */
  tick();
  timer = setInterval(tick, intervalMs);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
