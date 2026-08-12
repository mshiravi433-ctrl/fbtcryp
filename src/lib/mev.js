/**
 * MEV PROTECTION — sandwich risk, private relays, simulation.
 * ---------------------------------------------------------------------------
 * A modern DEX that ignores MEV is incomplete. We cannot stop every extractor,
 * and we do not pretend to: what we can do honestly is
 *
 *   1. measure how sandwichable THIS trade is (slippage × impact × size)
 *   2. offer a private relay where one exists
 *   3. simulate the expected outcome before the user signs
 *   4. suggest a priority fee that is enough without overpaying
 *
 * ─── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * It is not a Flashbots bundle builder. Building a bundle needs a searcher
 * key and would put us in the path of the user's signed transaction. We stay
 * non-custodial: the wallet still signs, and the RPC it talks to is the only
 * thing that changes.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Public private-mempool relays. These are HTTPS RPCs the wallet can use
 * instead of a public node; they do not see the tx in the public mempool
 * before inclusion.
 *
 * Ethereum is the only chain with a mature public protect RPC. Elsewhere we
 * report "no private relay" rather than inventing one — a fake protect URL
 * that still lands in the public mempool is worse than an honest "not here".
 */
export const PRIVATE_RELAYS = {
  1: {
    id: 'flashbots',
    name: 'Flashbots Protect',
    rpc: 'https://rpc.flashbots.net',
    alt: { id: 'mevblocker', name: 'MEV Blocker', rpc: 'https://rpc.mevblocker.io' }
  }
};

export function privateRelayFor(chainId) {
  return PRIVATE_RELAYS[Number(chainId)] ?? null;
}

/**
 * How exposed is this trade to a sandwich?
 *
 * Slippage is the invitation; price impact is the meal; size is how worth
 * it the attack is. A 3% slippage on a $20k thin-pool swap is free money
 * for a bot. A 0.1% slippage on two stables is not.
 *
 * Returns 0–100. Unknown inputs produce a low-confidence mid score rather
 * than zero — zero would read as "safe" when we simply could not measure.
 */
export function estimateSandwichRisk({
  slippagePct,
  priceImpact,
  amountUsd,
  bothStable = false
} = {}) {
  const slip = Number(slippagePct);
  const impact = Number(priceImpact);
  const usd = Number(amountUsd);

  if (bothStable && Number.isFinite(slip) && slip <= 0.3) {
    return { score: 4, level: 'low', reason: 'stable', confidence: 70 };
  }

  const haveSlip = Number.isFinite(slip) && slip >= 0;
  const haveImpact = Number.isFinite(impact) && impact >= 0;
  const haveUsd = Number.isFinite(usd) && usd > 0;
  if (!haveSlip && !haveImpact) {
    return { score: 28, level: 'unknown', reason: 'noData', confidence: 15 };
  }

  let score = 6;
  if (haveSlip) {
    if (slip >= 5) score += 38;
    else if (slip >= 3) score += 26;
    else if (slip >= 1.5) score += 16;
    else if (slip >= 0.8) score += 8;
    else score += 2;
  }
  if (haveImpact) {
    if (impact >= 8) score += 28;
    else if (impact >= 3) score += 16;
    else if (impact >= 1) score += 8;
    else score += 2;
  }
  if (haveUsd) {
    if (usd >= 50_000) score += 14;
    else if (usd >= 10_000) score += 8;
    else if (usd >= 2_000) score += 4;
  }

  score = clamp(Math.round(score), 0, 100);
  const level = score >= 70 ? 'critical' : score >= 45 ? 'high' : score >= 22 ? 'medium' : 'low';
  const reason =
    haveSlip && slip >= 3 && haveImpact && impact >= 3
      ? 'wideAndThin'
      : haveSlip && slip >= 3
        ? 'wideSlip'
        : haveImpact && impact >= 5
          ? 'thinPool'
          : 'ok';
  const confidence = 40 + (haveSlip ? 20 : 0) + (haveImpact ? 20 : 0) + (haveUsd ? 10 : 0);
  return { score, level, reason, confidence: clamp(confidence, 15, 90) };
}

/**
 * Priority fee suggestion, in gwei.
 *
 * We do not have a mempool view, so this is a conservative table from the
 * base fee the wallet already knows. Overpaying by 0.2 gwei is cheaper than
 * sitting pending while a sandwich lands.
 */
export function suggestPriorityFee({ baseFeeGwei, congested = false, urgent = false } = {}) {
  const base = Number(baseFeeGwei);
  if (!Number.isFinite(base) || base < 0) {
    return { gwei: congested ? 1.5 : 0.5, reason: 'default' };
  }
  let tip = base < 5 ? 0.05 : base < 20 ? 0.2 : base < 80 ? 0.8 : 2;
  if (congested) tip *= 2.2;
  if (urgent) tip *= 1.6;
  const gwei = Math.round(tip * 100) / 100;
  return { gwei, reason: urgent ? 'urgent' : congested ? 'congested' : 'normal' };
}

/**
 * Local simulation of a quoted swap. This is NOT an eth_call against the
 * router — that would need a signer and a built transaction. It is the
 * arithmetic the review sheet already has, assembled into one object so the
 * UI can show Simulation → Expected → Gas → MEV → Execute as one pipeline.
 *
 * A missing quote returns null rather than a fake receipt.
 */
export function simulateSwap({
  amountOut,
  minOut,
  gasNative,
  slippagePct,
  priceImpact,
  amountUsd,
  bothStable,
  chainId
} = {}) {
  const out = Number(amountOut);
  const min = Number(minOut);
  if (!Number.isFinite(out) || out <= 0) return null;

  const sandwich = estimateSandwichRisk({ slippagePct, priceImpact, amountUsd, bothStable });
  const relay = privateRelayFor(chainId);
  const gas = Number(gasNative);
  return {
    expectedOut: out,
    minOut: Number.isFinite(min) && min > 0 ? min : out * (1 - (Number(slippagePct) || 0.5) / 100),
    gasNative: Number.isFinite(gas) && gas > 0 ? gas : null,
    sandwich,
    privateRelay: Boolean(relay),
    relay,
    ready: true
  };
}

/**
 * Should this swap be forced through a private relay?
 *
 * Recommendation only. We cannot change the user's wallet RPC without them
 * confirming — WalletConnect and injected wallets own that setting. The UI
 * offers the URL and explains why.
 */
export function shouldPreferPrivate({ sandwich, chainId } = {}) {
  if (!privateRelayFor(chainId)) return false;
  const score = Number(sandwich?.score);
  return Number.isFinite(score) && score >= 45;
}
