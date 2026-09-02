/**
 * WALLET DELTA WATCH — the honest half of the no-registration Buy / Sell.
 * ---------------------------------------------------------------------------
 * ─── WHAT WAS ASKED ─────────────────────────────────────────────────────────
 *   «پایین هر دو تب یک گزارش واقعی باشد که بلاکچین را چک کند و تایید کند
 *    پول به کیف پول کاربر رسیده (خرید) یا برداشت شده (فروش) — بدون نیاز
 *    به API هیچ ارائه‌دهنده‌ای.»
 *
 * After a guided handoff (lib/guidedCheckout.js) we have no webhook and no
 * provider order id — deliberately, that is what "no registration" means.
 * The ONE thing that can still be verified is the public blockchain: did
 * the watched wallet's balance of the exact token the user named go UP
 * (buy) or DOWN (sell)?
 *
 * ─── THE WORDING RULE THIS MODULE ENFORCES BY ITS SHAPE ─────────────────────
 * A balance delta proves a TRANSFER, not a PAYMENT. Without the provider's
 * signed webhook there is no binding between "card charged" and "tokens
 * moved", so every event this module emits is a {direction, amount} fact —
 * "a deposit matching your order was detected" — and the UI must never
 * translate it into "your payment was confirmed". That distinction is the
 * difference between a report and a lie.
 *
 * ─── WHY BALANCE POLLING, NOT LOG FILTERS ───────────────────────────────────
 * Same reasoning as lib/incomingWatch.js (whose readBalance this reuses):
 * `eth_getBalance` / `balanceOf` are served reliably by every public RPC
 * this app falls back to, while `eth_getLogs` is rate-limited or silently
 * truncated on exactly the bad connections where a money report matters
 * most. A missed poll self-heals — the next tick compares against the same
 * baseline. The cost is that a delta has no tx hash; the report links to
 * the address page on the chain explorer instead, where the user sees the
 * actual transaction with their own eyes. Public data, honestly labelled.
 *
 * The delta core is a pure function factory so the unit suite can prove the
 * baseline / re-baseline behaviour without timers or a network.
 */

import { readBalance } from './incomingWatch';
import { formatUnitsExact } from './swap';

export const WATCH_POLL_MS = 12_000;

/**
 * Pure state machine: feed it successive BigInt balances, get back either
 * null (nothing new) or a {direction:'in'|'out', raw, amount} event.
 *
 *   • first successful read is the baseline, NEVER an event — otherwise
 *     everyone who already holds the token would get an instant false
 *     "deposit detected";
 *   • re-baselines BEFORE reporting, so one delta is never reported twice;
 *   • null reads (RPC hiccup) change nothing.
 */
export function createDeltaTracker(decimals = 18) {
  let baseline = null;
  return (now) => {
    if (now == null || typeof now !== 'bigint') return null;
    if (baseline == null) { baseline = now; return null; }
    if (now === baseline) return null;
    const direction = now > baseline ? 'in' : 'out';
    const raw = direction === 'in' ? now - baseline : baseline - now;
    baseline = now;
    return { direction, raw, amount: formatUnitsExact(raw, decimals) };
  };
}

/**
 * Watch one wallet's balance of one token and report every change, in both
 * directions, until stopped.
 *
 * @param {object} p
 * @param {any}    p.provider    read provider (ethers `send` or EIP-1193 `request`)
 * @param {string} p.address     the wallet being watched
 * @param {object} p.token       `{ symbol, decimals, address?, native? }`
 * @param {(e: {direction:'in'|'out', raw:bigint, amount:string, symbol:string, at:number}) => void} p.onDelta
 * @param {(s: {raw:bigint, amount:string, at:number}) => void} [p.onTick]  every successful read (drives "last checked")
 * @param {number} [p.intervalMs]
 * @param {() => Promise<bigint|null>} [p.poll]  injected for tests
 * @returns {() => void} stop
 */
export function watchWalletDelta({ provider, address, token, onDelta, onTick, intervalMs = WATCH_POLL_MS, poll }) {
  let stopped = false;
  const track = createDeltaTracker(token?.decimals ?? 18);
  const read = poll ?? (() => readBalance({ provider, address, token }));

  const tick = async () => {
    if (stopped) return;
    const now = await read();
    if (stopped || now == null) return;
    onTick?.({ raw: now, amount: formatUnitsExact(now, token?.decimals ?? 18), at: Date.now() });
    const event = track(now);
    if (event && !stopped) onDelta?.({ ...event, symbol: token?.symbol ?? '', at: Date.now() });
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}
