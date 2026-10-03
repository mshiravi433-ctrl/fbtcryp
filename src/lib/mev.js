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
 * Supported chains with MEV protection RPC endpoints:
 * - Ethereum: Flashbots Protect (official) + MEV Blocker (alternative)
 * - BNB Chain: dRPC MEV-protected endpoint
 * - Polygon: Polygon Private Mempool (requires registration)
 * - Arbitrum: dRPC MEV-protected endpoint
 * - Base: dRPC MEV-protected endpoint + GetBlock MEV-protected
 * - Optimism: dRPC MEV-protected endpoint
 * - Avalanche: dRPC MEV-protected endpoint
 * - Linea: dRPC MEV-protected endpoint
 *
 * ─── CORRECTED 2026-10-03 — READ THIS BEFORE COPYING A ROW ─────────────────
 * The list above used to continue "…Sonic, Mantle, Berachain, Unichain, Monad,
 * Scroll, zkSync Era: dRPC MEV-protected; Robinhood Chain: PublicNode
 * MEV-protected". Every one of those eight rows was invented by pattern.
 * dRPC's own documentation states MEV protection is a PREMIUM add-on covering
 * exactly five chains (Ethereum · Base · BNB Smart Chain · Arbitrum · Solana),
 * and there is no such host as robinhood-rpc.publicnode.com.
 *
 * A relay label is a promise about where the user's signed transaction goes.
 * Promising a private mempool on an endpoint that forwards to the public one
 * is the one failure this module exists to prevent, so those rows now say what
 * they really are — several of them are the chain's own sequencer, which has
 * no public mempool at all — and the three L1s with a genuinely public mempool
 * and no documented private relay (Sonic, Berachain, Monad) carry no row.
 *
 * For chains without a native private relay we do NOT invent one. Where the
 * transaction cannot be observed before inclusion (single sequencer / encrypted
 * mempool / TEE builder) that is stated as the reason; where it can, we say so
 * and fall back to the only defence that actually works everywhere: tight
 * slippage.
 *
 * Note: Some endpoints require API keys or paid tiers. Free public endpoints
 * are used where available. Chains with no verified public relay honour a
 * per-chain operator override — see relayOverride() below.
 */
export const PRIVATE_RELAYS = {
  // Ethereum - Official Flashbots Protect
  1: {
    id: 'flashbots',
    name: 'Flashbots Protect',
    rpc: 'https://rpc.flashbots.net',
    alt: { id: 'mevblocker', name: 'MEV Blocker', rpc: 'https://rpc.mevblocker.io' }
  },
  // BNB Smart Chain - dRPC MEV-protected
  56: {
    id: 'drpc',
    name: 'dRPC MEV-Protected',
    rpc: 'https://bsc.drpc.org',
    alt: { id: 'getblock', name: 'GetBlock MEV-Protected', rpc: 'https://bsc.getblock.io/mainnet/' }
  },
  // Polygon - Private Mempool (requires project registration)
  137: {
    id: 'polygon-private',
    name: 'Polygon Private Mempool',
    rpc: 'https://polygon-rpc.com', // Placeholder - actual endpoint from Polygon dashboard
    alt: { id: 'drpc', name: 'dRPC MEV-Protected', rpc: 'https://polygon.drpc.org' }
  },
  // Arbitrum One - dRPC MEV-protected
  42161: {
    id: 'drpc',
    name: 'dRPC MEV-Protected',
    rpc: 'https://arbitrum.drpc.org',
    alt: { id: 'publicnode', name: 'PublicNode', rpc: 'https://arbitrum-rpc.publicnode.com' }
  },
  // Base - dRPC MEV-protected + GetBlock
  8453: {
    id: 'drpc',
    name: 'dRPC MEV-Protected',
    rpc: 'https://base.drpc.org',
    alt: { id: 'getblock', name: 'GetBlock MEV-Protected', rpc: 'https://base.getblock.io/mainnet/' }
  },
  // Optimism - dRPC MEV-protected
  10: {
    id: 'drpc',
    name: 'dRPC MEV-Protected',
    rpc: 'https://optimism.drpc.org',
    alt: { id: 'publicnode', name: 'PublicNode', rpc: 'https://optimism-rpc.publicnode.com' }
  },
  // Avalanche - dRPC MEV-protected
  43114: {
    id: 'drpc',
    name: 'dRPC MEV-Protected',
    rpc: 'https://avalanche.drpc.org',
    alt: { id: 'publicnode', name: 'PublicNode', rpc: 'https://avalanche-c-chain-rpc.publicnode.com' }
  },
  // Linea - dRPC MEV-protected
  59144: {
    id: 'drpc',
    name: 'dRPC MEV-Protected',
    rpc: 'https://linea.drpc.org',
    alt: { id: 'publicnode', name: 'PublicNode', rpc: 'https://linea-rpc.publicnode.com' }
  },
  /*
   * ─── THE EIGHT NEWER NETWORKS (corrected 2026-10-03) ─────────────────────
   * Reported: «رله خصوصی و ریسک mev و محافظت» was absent on S / MINT / BREA /
   * UNI / Mon / Scr / Zk / Rabinhood. These entries existed but were copied
   * from the Linea row with the same label — «dRPC MEV-Protected» — on every
   * one of them, including `https://robinhood-rpc.publicnode.com`, a host
   * PublicNode does not operate. dRPC's own documentation is explicit that MEV
   * protection is a PREMIUM add-on and lists exactly five chains for it
   * (Ethereum · Base · BNB Smart Chain · Arbitrum · Solana). A label claiming
   * protection that the endpoint does not provide is worse than no label: the
   * card renders a confident green toggle over a public mempool.
   *
   * So each row below now names what the endpoint ACTUALLY is, and `kind`
   * tells the UI which sentence to print:
   *
   *   kind: 'relay'      a third-party service that keeps the transaction out
   *                      of a public mempool (Flashbots, MEV Blocker, …).
   *   kind: 'sequencer'  the chain has NO public mempool. A single sequencer
   *                      is the only entry point for transactions, so nothing
   *                      a searcher can read is ever broadcast — submitting
   *                      to the chain's own RPC IS the private path.
   *   kind: 'encrypted'  transactions land in an encrypted mempool and blocks
   *                      are built inside a TEE (Unichain + Flashbots
   *                      Rollup-Boost), so ordering is by priority fee and
   *                      pre-trade contents are not observable.
   *
   * Sonic (146), Berachain (80094) and Monad (143) are L1s WITH a public
   * mempool and no publicly documented private relay, so they are NOT listed
   * here. `privateRelayFor()` returning null for them is the honest answer,
   * and MevGuard says so out loud (mev.noRelay) instead of offering a toggle
   * that would only change which public node hears the transaction. An
   * operator who buys a private endpoint for one of them sets
   * VITE_MEV_RELAY_<chainId> and it is used verbatim — see relayOverride().
   */
  // Sonic — L1 with a public mempool and no documented public private relay
  146: null,
  // Mantle — single sequencer, no public mempool (Eco "What is a sequencer?", 2026)
  5000: {
    id: 'mantle-sequencer',
    kind: 'sequencer',
    name: 'Mantle sequencer',
    rpc: 'https://rpc.mantle.xyz',
    alt: { id: 'publicnode', kind: 'sequencer', name: 'PublicNode (Mantle)', rpc: 'https://mantle-rpc.publicnode.com' }
  },
  // Berachain — L1, geth mempool, no verified public private relay
  80094: null,
  // Unichain — TEE block builder, encrypted mempool (Uniswap Labs × Flashbots)
  130: {
    id: 'unichain-tee',
    kind: 'encrypted',
    name: 'Unichain TEE builder (encrypted mempool)',
    rpc: 'https://mainnet.unichain.org',
    alt: { id: 'drpc', kind: 'encrypted', name: 'dRPC (Unichain)', rpc: 'https://unichain.drpc.org' }
  },
  // Monad — L1 with a public mempool, no verified public private relay
  143: null,
  // Scroll — zk-rollup, private mempool, FCFS sequencer
  534352: {
    id: 'scroll-sequencer',
    kind: 'sequencer',
    name: 'Scroll sequencer (private mempool)',
    rpc: 'https://rpc.scroll.io',
    alt: { id: 'publicnode', kind: 'sequencer', name: 'PublicNode (Scroll)', rpc: 'https://scroll-rpc.publicnode.com' }
  },
  // zkSync Era — sequencer-only mempool (Chainstack: "zkSync Era · Sequencer only")
  324: {
    id: 'zksync-sequencer',
    kind: 'sequencer',
    name: 'zkSync Era sequencer',
    rpc: 'https://mainnet.era.zksync.io',
    alt: { id: 'drpc', kind: 'sequencer', name: 'dRPC (zkSync Era)', rpc: 'https://zksync.drpc.org' }
  },
  // Robinhood Chain — Arbitrum Orbit L2, single sequencer
  4663: {
    id: 'robinhood-sequencer',
    kind: 'sequencer',
    name: 'Robinhood Chain sequencer',
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    alt: { id: 'hypersync', kind: 'sequencer', name: 'Envio HyperRPC', rpc: 'https://robinhood.rpc.hypersync.xyz' }
  }
};

/*
 * ─── PER-CHAIN MEMPOOL MODEL (added 2026-10-03) ─────────────────────────────
 * `PRIVATE_RELAYS` answers "where can I send this privately?". It cannot
 * answer "how exposed am I in the first place?", and on a chain with no public
 * mempool the correct risk sentence is completely different from the one for
 * Ethereum — telling a Scroll user to fear sandwiches the way an Ethereum user
 * must is its own kind of wrong number.
 *
 * `mempool`   'public'   — pending transactions are gossiped and readable, so
 *                          sandwiching is atomic and cheap for a bot.
 *             'private'  — a single sequencer is the only entry point; there is
 *                          nothing public to read.
 *             'encrypted'— pooled transactions are encrypted until the block is
 *                          built inside a TEE.
 * `ordering`  how the block producer orders what it accepts (FCFS, priority
 *             fee, or builder discretion).
 *
 * The empirical backing for the L2 rows: the 2026 sandwich-measurement study
 * at arxiv.org/pdf/2601.19570 finds L2 sandwiching "inherently probabilistic
 * rather than atomic" precisely because centralised sequencing and private
 * mempools remove the co-inclusion guarantees an attacker needs — which is why
 * `riskBias` discounts the measured score on those chains rather than
 * presenting it as the same number it would be on Ethereum.
 */
export const MEV_CHAIN_MODEL = {
  1:      { mempool: 'public',    ordering: 'builder',  riskBias: 1,    source: 'Ethereum — public mempool, builder discretion' },
  56:     { mempool: 'public',    ordering: 'builder',  riskBias: 1,    source: 'BNB Smart Chain — public mempool' },
  137:    { mempool: 'public',    ordering: 'builder',  riskBias: 1,    source: 'Polygon PoS — public mempool' },
  42161:  { mempool: 'private',   ordering: 'fcfs',     riskBias: 0.6,  source: 'Arbitrum One — sequencer, FCFS (Timeboost aside)' },
  8453:   { mempool: 'private',   ordering: 'fcfs',     riskBias: 0.6,  source: 'Base — sequencer, FCFS' },
  10:     { mempool: 'private',   ordering: 'fcfs',     riskBias: 0.6,  source: 'OP Mainnet — sequencer, FCFS' },
  43114:  { mempool: 'public',    ordering: 'builder',  riskBias: 1,    source: 'Avalanche C-Chain — public mempool' },
  59144:  { mempool: 'private',   ordering: 'fcfs',     riskBias: 0.6,  source: 'Linea — sequencer, FCFS' },
  146:    { mempool: 'public',    ordering: 'builder',  riskBias: 1,    source: 'Sonic — L1, public mempool, instant finality' },
  5000:   { mempool: 'private',   ordering: 'fcfs',     riskBias: 0.6,  source: 'Mantle — single sequencer' },
  80094:  { mempool: 'public',    ordering: 'builder',  riskBias: 1,    source: 'Berachain — L1, mempool in the execution client' },
  130:    { mempool: 'encrypted', ordering: 'priority', riskBias: 0.4,  source: 'Unichain — TEE builder + encrypted mempool (Rollup-Boost)' },
  143:    { mempool: 'public',    ordering: 'builder',  riskBias: 0.85, source: 'Monad — L1, public mempool, ~400-500ms blocks' },
  534352: { mempool: 'private',   ordering: 'fcfs',     riskBias: 0.6,  source: 'Scroll — zk-rollup, private mempool, FCFS' },
  324:    { mempool: 'private',   ordering: 'fcfs',     riskBias: 0.6,  source: 'zkSync Era — sequencer-only mempool (Chainstack)' },
  4663:   { mempool: 'private',   ordering: 'fcfs',     riskBias: 0.6,  source: 'Robinhood Chain — Arbitrum Orbit, single sequencer' }
};

/** The mempool/ordering model for a chain, or null when we have not modelled it. */
export function mevChainModel(chainId) {
  return MEV_CHAIN_MODEL[Number(chainId)] ?? null;
}

/*
 * ─── OPERATOR OVERRIDE ─────────────────────────────────────────────────────
 * A deployment that has bought a private submission endpoint for a chain we
 * could not verify one for (Sonic, Berachain, Monad today) should not need a
 * code change to use it. `VITE_MEV_RELAY_146=https://…` is picked up verbatim;
 * an https URL is required because a plaintext relay is worse than none (the
 * whole point is that nobody else sees the bytes).
 */
function relayOverride(chainId) {
  const map = typeof import.meta !== 'undefined' && import.meta.env;
  if (!map) return null;
  const url = map[`VITE_MEV_RELAY_${Number(chainId)}`];
  if (typeof url !== 'string' || !/^https:\/\//.test(url.trim())) return null;
  return { id: 'operator', kind: 'relay', name: 'Private relay (configured)', rpc: url.trim(), operator: true };
}

export function privateRelayFor(chainId) {
  /*
   * A row can be explicitly `null` — meaning "we looked, and there is no
   * verified private path on this chain" — which must stay distinguishable
   * from "we never looked". Both read as null here; `mevChainModel()` carries
   * the difference for the UI.
   */
  const row = relayOverride(chainId) || PRIVATE_RELAYS[Number(chainId)] || null;
  if (!row) return null;
  /*
   * Rows added before 2026-10-03 carry no `kind`. Every one of them is a
   * third-party private-mempool service (Flashbots, MEV Blocker, Polygon's
   * private mempool, dRPC / GetBlock on the chains they actually protect), so
   * defaulting them to 'relay' is a statement of fact, not a guess.
   */
  return row.kind ? row : { ...row, kind: 'relay' };
}

/** Is the offered path a third-party relay, or the chain's own sequencer? */
export function privateRelayKind(chainId) {
  return privateRelayFor(chainId)?.kind ?? null;
}

/**
 * The sandwich score, adjusted for how this chain actually orders
 * transactions.
 *
 * The raw score is built from slippage × impact × size — it knows nothing
 * about who can SEE the order before it lands. On a chain with no public
 * mempool an attacker cannot guarantee both legs of a sandwich are included,
 * so the same slippage is materially less dangerous. Reporting the Ethereum
 * number on Scroll would overstate the risk; reporting the Scroll number on
 * Ethereum would understate it. `riskBias` is the one knob, per chain, and it
 * is never applied to anything but the number we print.
 */
export function chainAdjustedRisk(chainId, sandwich) {
  if (!sandwich || !Number.isFinite(Number(sandwich.score))) return sandwich ?? null;
  const bias = mevChainModel(chainId)?.riskBias ?? 1;
  if (bias === 1) return sandwich;
  const score = clamp(Math.round(Number(sandwich.score) * bias), 0, 100);
  const level = score >= 70 ? 'critical' : score >= 45 ? 'high' : score >= 22 ? 'medium' : 'low';
  return { ...sandwich, score, level, adjusted: true, rawScore: Number(sandwich.score) };
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

  /* Chain-adjusted, not raw: the same slippage is not the same exposure on a
     chain whose mempool nobody can read. See chainAdjustedRisk(). */
  const sandwich = chainAdjustedRisk(
    chainId,
    estimateSandwichRisk({ slippagePct, priceImpact, amountUsd, bothStable })
  );
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
