/**
 * On-chain swap engine (PancakeSwap V2 router on BSC).
 *
 * Every function here builds a transaction that the USER signs from THEIR
 * wallet — non-custodial throughout. A 0.5% platform fee is collected on-chain
 * in the same transaction and paid to FBT's wallet; it is always disclosed in
 * the UI before the user signs.
 *
 * Safety properties worth keeping if you edit this file:
 *   • `amountOutMin` is always enforced from a fresh on-chain quote, so a
 *     sandwich attack can't drain more than the slippage the user accepted.
 *   • Approvals default to the exact amount, not the common `MaxUint256`
 *     "infinite approve" — a compromised router then can't move the rest of
 *     the user's balance later.
 *   • Deadlines are short (default 20 min) so a stuck tx can't execute hours
 *     later at a wildly different price.
 */

import {
  EVM_CHAINS,
  ERC20_ABI,
  ROUTER_ABI,
  FEE_ROUTER_ABI,
  FEE_ROUTER_ADDRESS,
  FEE_BPS,
  feeRecipientFor,
  feeEnabled,
  aggregatorFeeEnabled,
  buildPath
} from './chains';
import {
  aggregatorSupports,
  executeAggregatorSwap,
  getAggregatorQuote
} from './aggregator';
import { getOpenOceanQuote, openOceanSupports, executeOpenOceanSwap } from './openocean';
import { getVeloraQuote, veloraSupports } from './velora';
import { quoteAllSources } from './bestQuote';

const loadEthers = () => import('ethers');

export const DEFAULT_SLIPPAGE = 0.5; // percent
export const DEFAULT_DEADLINE_MIN = 20;

/**
 * Suggest a slippage tolerance for the pair actually being swapped.
 *
 * ─── WHY A SINGLE NUMBER IS WRONG IN BOTH DIRECTIONS ────────────────────────
 * The screen shipped with a fixed 0.5%. On a stablecoin pair that is already
 * three times more than needed, and every basis point of it is headroom a
 * sandwich bot is free to take. On a thin token it fails outright, so the user
 * raises it to 3% — and 3% then STAYS SET for their next USDT swap, where it
 * is an open invitation.
 *
 * That is the real failure: not that the default is wrong for some pair, but
 * that the correction persists into pairs where it is dangerous. Deriving it
 * per quote is what removes the incentive to set a blanket-high value.
 *
 * ─── WHY IT KEYS OFF PRICE IMPACT AND NOT A TOKEN LIST ──────────────────────
 * A hardcoded list of "safe" tokens goes stale, and it cannot see that a pair
 * is thin ON THIS CHAIN today. Price impact is the live measurement of exactly
 * the thing slippage protects against: how far this trade moves the pool. It
 * comes back in the quote we already have, so this costs no extra request.
 *
 * Returns a REASON as well as a number, because a UI that says "1.2%" teaches
 * nothing while one that says "1.2% — this pair is thin" teaches the user why
 * their next trade might differ.
 *
 * @param {object} opts
 * @param {number|null} opts.priceImpact  percent, from the quote
 * @param {boolean} opts.bothStable       both sides are stablecoins
 * @returns {{ slippage: number, reason: string }}
 */
export function suggestSlippage({ priceImpact = null, bothStable = false } = {}) {
  /*
   * Stablecoin pairs first, and deliberately BEFORE the null check below: a
   * USDC/USDT swap should get the tight value even on the first render when no
   * quote has arrived yet, because that is the common case and widening it
   * later would only ever be a downgrade.
   */
  if (bothStable) return { slippage: 0.1, reason: 'stable' };

  /*
   * `Number(null)` is 0 and 0 is finite — so the null test has to come FIRST
   * and separately, or a missing impact reads as a perfect zero-impact trade
   * and returns the tightest tolerance for a pair we know nothing about.
   */
  if (priceImpact == null) return { slippage: DEFAULT_SLIPPAGE, reason: 'default' };
  const impact = Number(priceImpact);
  if (!Number.isFinite(impact)) return { slippage: DEFAULT_SLIPPAGE, reason: 'default' };

  const abs = Math.abs(impact);

  /*
   * Headroom above the measured impact, not a replacement for it. The trade
   * already moves the price by `abs`; slippage must cover that PLUS whatever
   * moves between quoting and mining. Below 0.3% impact the pair is deep and
   * the default is generous enough.
   */
  if (abs < 0.3) return { slippage: DEFAULT_SLIPPAGE, reason: 'deep' };

  /*
   * Capped at 5%. Above that the honest answer is "this trade is too big for
   * this pool", and quietly widening tolerance to let it through would hand
   * the difference to a sandwich bot while looking like a convenience.
   */
  const suggested = Math.min(5, Math.round((abs + 0.5) * 10) / 10);
  return { slippage: suggested, reason: abs >= 2 ? 'thin' : 'moderate' };
}

/** Symbols we treat as dollar-pegged for the pairing rule above. */
const STABLES = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDD', 'USDP', 'USD₮0']);

export const isStableSymbol = (s) => STABLES.has(String(s ?? '').toUpperCase());

/**
 * Decide what to tell the user when no aggregator produced a usable quote.
 *
 * ─── WHY THE DISTINCTION MATTERS ────────────────────────────────────────────
 * "No route between these two tokens" and "couldn't reach the routing
 * service" demand opposite actions: the first is a fact about the pair, the
 * second is a network problem (geo-blocked aggregator, ISP filtering — the
 * exact failure Iranian customers hit) where retrying or switching networks
 * genuinely helps. Reporting the network case as "no route" sends a user with
 * a perfectly good pair into the wrong troubleshooting entirely.
 *
 * The classification is deliberately strict: we only claim a NETWORK problem
 * when NO source answered at all and every single failure was a
 * network-level one. If any source replied — even with "no route" — the
 * pair verdict stands.
 *
 * @param {Array<Error>} opts.failures  rejection reasons from quoteAllSources
 * @param {number}       opts.answered  how many sources returned any response
 */
export function classifyQuoteFailure({ failures = [], answered = 0 } = {}) {
  if (answered === 0 && failures.length > 0 && failures.every((f) => f?.network === true)) {
    return 'QUOTE_NETWORK';
  }
  return 'NO_ROUTE';
}

/**
 * Minimum native coin to leave behind for gas, per chain, when a user taps MAX.
 *
 * These are floors, not estimates — the live estimate is used when it is
 * larger. They differ per chain because a flat constant is wrong in both
 * directions: 0.002 ETH is about $7 and needlessly strands value, while on a
 * congested L1 it can still be too little to cover the transaction at all.
 *
 * Erring high is the cheaper mistake. Leaving a few cents unswapped is an
 * annoyance; leaving too little means the swap reverts and the user pays gas
 * for nothing.
 */
export const NATIVE_GAS_FLOOR = {
  56: 0.0015,   // BNB — cheap and predictable
  1: 0.0035,    // ETH — mainnet gas is the expensive case
  137: 0.05,    // POL — very cheap per unit, so a larger count is still tiny
  42161: 0.0004, // ETH on Arbitrum
  8453: 0.0003,  // ETH on Base
  10: 0.0003,    // ETH on Optimism
  43114: 0.01,   // AVAX
  59144: 0.0003, // ETH on Linea
  146: 0.05      // S on Sonic
};

/**
 * BigInt -> decimal string with NO rounding.
 *
 * `Number(x).toFixed(n)` rounds, and rounding a balance upward produces an
 * amount the wallet does not have, which reverts on transfer. It also flushes
 * anything below 1e-8 to zero, which silently empties MAX for holders of
 * small amounts of an 18-decimal token. Doing it on the integer avoids both.
 */
export function formatUnitsExact(wei, decimals) {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  if (frac === 0n) return `${negative ? '-' : ''}${whole}`;

  // Pad to full precision, then drop trailing zeros only.
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}.${fracStr}`;
}

/* ------------------------------- balances -------------------------------- */

export async function getTokenBalance(provider, token, owner) {
  const { Contract, formatUnits } = await loadEthers();
  if (token.native) {
    const wei = await provider.getBalance(owner);
    return { raw: wei, formatted: Number(formatUnits(wei, 18)) };
  }
  const c = new Contract(token.address, ERC20_ABI, provider);
  const raw = await c.balanceOf(owner);
  return { raw, formatted: Number(formatUnits(raw, token.decimals)) };
}

/** Fetch balances for a token list in parallel; failures resolve to zero. */
export async function getBalances(provider, tokens, owner) {
  const out = {};
  await Promise.all(
    tokens.map(async (t) => {
      try {
        out[t.symbol] = await getTokenBalance(provider, t, owner);
      } catch {
        out[t.symbol] = { raw: 0n, formatted: 0 };
      }
    })
  );
  return out;
}

/* -------------------------------- quoting -------------------------------- */

/**
 * Ask the router what `amountIn` of `fromToken` is worth in `toToken`.
 * Returns null when there is no route or the pool is empty.
 */
export async function getQuote({ provider, chainId, fromToken, toToken, amountIn, slippage = DEFAULT_SLIPPAGE }) {
  if (!amountIn || Number(amountIn) <= 0) return null;
  const { Contract, parseUnits, formatUnits } = await loadEthers();

  // Preferred path: the aggregator finds a better route across every DEX AND
  // collects our fee on-chain, with no contract of our own to deploy.
  if (aggregatorFeeEnabled(chainId) && aggregatorSupports(chainId)) {
    try {
      const feeReceiver = feeRecipientFor(chainId);
      const common = {
        chainId,
        fromToken,
        toToken,
        amountIn,
        slippage,
        feeBps: FEE_BPS,
        feeReceiver,
        parseUnits,
        formatUnits
      };

      /*
       * ─── ASK EVERY AGGREGATOR AT ONCE ────────────────────────────────────
       * Not one after the other. `quoteAllSources` starts them together, so
       * the wall-clock cost is the SLOWEST source rather than the sum — and
       * OpenOcean runs on a 3s leash against KyberSwap's 15s, so in the worst
       * case this is exactly as fast as quoting KyberSwap alone.
       *
       * A source that fails or times out is simply absent from the
       * comparison; it never turns a good quote into an error. And only an
       * EXECUTABLE quote is allowed to win, so a better price we cannot
       * actually sign can never become the transaction — see lib/bestQuote.js.
       */
      const sources = [{ id: 'kyberswap', quote: () => getAggregatorQuote(common) }];
      if (openOceanSupports(chainId)) {
        sources.push({ id: 'openocean', quote: () => getOpenOceanQuote(common) });
      }
      /*
       * Velora (formerly ParaSwap) — a third opinion, added after testing
       * every aggregator on the shortlist. It is the only other one that
       * needs NO API KEY and still pays a partner fee, verified live:
       * partnerFeeBps=70 came back as partnerFee 0.7 straight to our own
       * address via isDirectFeeTransfer. Same 3s leash as OpenOcean, so it
       * cannot slow the quote down.
       */
      if (veloraSupports(chainId)) {
        sources.push({ id: 'velora', quote: () => getVeloraQuote(common) });
      }

      const { best, checked, beatenBy, failures, answered, trace } = await quoteAllSources(sources);

      // Every source failed. Fall through to the same error handling the
      // single-source path always used.
      if (!best) throw new Error(classifyQuoteFailure({ failures, answered }));

      /*
       * `routesChecked` drives the "compared N routes" line in the UI, and
       * `beatenBy` is how much a quote-only source led by. Both are reported
       * rather than hidden: claiming to have found the best price while
       * quietly knowing another venue was better is the kind of thing that
       * destroys trust the one time a user checks.
       */
      return {
        ...best,
        routesChecked: checked,
        beatenBy,
        /*
         * Compact evidence for Proof-of-Execution. It contains no calldata,
         * wallet address or routeSummary — only comparable outputs,
         * constraints, solver status and timings. The full aggregator body can
         * be huge and can disclose more routing detail than a receipt needs.
         */
        selectedSolver: best.source === 'aggregator' ? 'kyberswap' : (best.source || 'direct-router'),
        executionTrace: {
          schema: 'fbt.quote-trace.v1',
          observedAt: new Date().toISOString(),
          selectionPolicy: 'MAX_OUTPUT_EXECUTABLE_SAME_FEE_AND_SLIPPAGE',
          coverage: { requested: sources.length, answered, usable: checked },
          constraints: {
            chainId: Number(chainId),
            from: fromToken.symbol,
            to: toToken.symbol,
            amountIn: String(amountIn),
            feeBps: FEE_BPS,
            slippagePct: Number(slippage)
          },
          selectedSolver: best.source === 'aggregator' ? 'kyberswap' : (best.source || 'direct-router'),
          candidates: trace
        }
      };
    } catch (err) {
      // COMMERCIAL RULE: this product must never execute a swap that skips the
      // platform fee. If the aggregator can't quote, we surface the error
      // instead of silently routing around our own revenue.
      //
      // The only exception is an explicit FEE_MODE=contract deployment, which
      // collects the fee through our own router below.
      if (!feeEnabled()) {
        const code = err?.message === 'NO_ROUTE' || err?.message === 'QUOTE_NETWORK' ? err.message : 'QUOTE_FAILED';
        return {
          error: code,
          retriable: true
        };
      }
    }
  }
  const cfg = EVM_CHAINS[chainId];
  const router = new Contract(cfg.router, ROUTER_ABI, provider);

  const path = buildPath(chainId, fromToken, toToken);
  if (path.length < 2) return null;

  const amountInWei = parseUnits(String(amountIn), fromToken.decimals);

  // The platform fee comes off the INPUT first, so quote the DEX on the
  // post-fee amount — otherwise the displayed output would be optimistic.
  const platformFeeWei = feeEnabled() ? (amountInWei * BigInt(FEE_BPS)) / 10000n : 0n;
  const swapInWei = amountInWei - platformFeeWei;

  let amounts;
  try {
    amounts = await router.getAmountsOut(swapInWei, path);
  } catch {
    return { error: 'NO_ROUTE', path };
  }

  const outWei = amounts[amounts.length - 1];
  if (outWei === 0n) return { error: 'NO_LIQUIDITY', path };

  // amountOutMin = out * (1 - slippage). Done in basis points to stay integral.
  const bps = BigInt(Math.round((100 - slippage) * 100));
  const minOutWei = (outWei * bps) / 10000n;

  const amountOut = Number(formatUnits(outWei, toToken.decimals));
  const rate = amountOut / Number(amountIn);

  return {
    path,
    amountInWei,
    swapInWei,
    platformFeeWei,
    platformFee: Number(formatUnits(platformFeeWei, fromToken.decimals)),
    feeBps: feeEnabled() ? FEE_BPS : 0,
    amountOutWei: outWei,
    minOutWei,
    amountOut,
    minOut: Number(formatUnits(minOutWei, toToken.decimals)),
    rate,
    hops: path.length - 1,
    slippage
  };
}

/* ------------------------------- allowance ------------------------------- */

/**
 * Whoever we approve must be whoever pulls the tokens.
 * With the aggregator that's its router, which varies per quote — so callers
 * pass the quote in and we read it from there.
 */
export function spenderFor(chainId, quote = null) {
  if (quote?.source === 'openocean') return quote.spender;
  if (quote?.source === 'aggregator' && quote.routerAddress) return quote.routerAddress;
  return feeEnabled() ? FEE_ROUTER_ADDRESS : EVM_CHAINS[chainId].router;
}

export async function getAllowance({ provider, chainId, token, owner, quote = null }) {
  if (token.native) return { raw: null, unlimited: true }; // gas coin needs no approval
  const { Contract } = await loadEthers();
  const c = new Contract(token.address, ERC20_ABI, provider);
  const raw = await c.allowance(owner, spenderFor(chainId, quote));
  return { raw, unlimited: false };
}

export async function needsApproval({ provider, chainId, token, owner, amountWei, quote = null }) {
  if (token.native) return false;
  const { raw } = await getAllowance({ provider, chainId, token, owner, quote });
  return raw < amountWei;
}

/**
 * Approve exactly `amountWei` (not infinite). Returns the tx receipt.
 * Some legacy tokens (USDT-style) require resetting to 0 first; we handle that.
 */
export async function approveToken({ signer, chainId, token, amountWei, quote = null }) {
  const { Contract } = await loadEthers();
  const c = new Contract(token.address, ERC20_ABI, signer);
  const spender = spenderFor(chainId, quote);

  const current = await c.allowance(await signer.getAddress(), spender);
  if (current > 0n && current < amountWei) {
    // non-zero -> non-zero is rejected by some ERC-20s; zero it out first
    const reset = await c.approve(spender, 0n);
    await reset.wait();
  }

  const tx = await c.approve(spender, amountWei);
  return { hash: tx.hash, wait: () => tx.wait() };
}

/* --------------------------------- swap ---------------------------------- */

/**
 * Execute the swap. Picks the right router method for native-in / native-out /
 * token-to-token, and uses the fee-on-transfer-tolerant variants so tokens
 * with a transfer tax don't revert.
 */
export async function executeSwap({
  signer,
  chainId,
  fromToken,
  toToken,
  quote,
  deadlineMinutes = DEFAULT_DEADLINE_MIN,
  supportFeeOnTransfer = true
}) {
  // Aggregator quotes carry their own prebuilt route; execute that.
  if (quote.source === 'aggregator') {
    // Pass what we EXPECT to be charged so the aggregator layer can verify the
    // signed route still carries our fee. Without this the app would happily
    // sign a route that pays us nothing.
    return executeAggregatorSwap({
      signer,
      chainId,
      quote,
      slippage: quote.slippage ?? DEFAULT_SLIPPAGE,
      deadlineMinutes,
      expectFeeBps: FEE_BPS,
      expectFeeReceiver: feeRecipientFor(chainId)
    });
  }

  // OpenOcean is the second EXECUTABLE aggregator — the fallback that keeps
  // swaps working when KyberSwap's API is unreachable from the user's
  // network (see the file header in lib/openocean.js). Same fee discipline:
  // the referrer fee is verified inside the calldata before signing.
  if (quote.source === 'openocean') {
    return executeOpenOceanSwap({
      signer,
      chainId,
      fromToken,
      toToken,
      quote,
      slippage: quote.slippage ?? DEFAULT_SLIPPAGE,
      expectFeeBps: FEE_BPS,
      expectFeeReceiver: feeRecipientFor(chainId)
    });
  }

  const { Contract } = await loadEthers();
  const cfg = EVM_CHAINS[chainId];
  const to = await signer.getAddress();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60);

  const { path, amountInWei, minOutWei } = quote;

  // --- fee path: one atomic tx that pays the platform and swaps the rest ---
  if (feeEnabled()) {
    const fee = new Contract(FEE_ROUTER_ADDRESS, FEE_ROUTER_ABI, signer);
    let feeTx;
    if (fromToken.native) {
      feeTx = await fee.swapExactETHForTokens(minOutWei, path, to, deadline, { value: amountInWei });
    } else if (toToken.native) {
      feeTx = await fee.swapExactTokensForETH(amountInWei, minOutWei, path, to, deadline);
    } else {
      feeTx = await fee.swapExactTokensForTokens(amountInWei, minOutWei, path, to, deadline);
    }
    return { hash: feeTx.hash, wait: () => feeTx.wait(), viaFeeRouter: true };
  }

  // Direct PancakeSwap path. Only reachable when a FeeRouter is deployed
  // (which takes the fee on-chain) — never as a silent zero-fee fallback.
  if (!feeEnabled()) throw new Error('FEE_ROUTE_UNAVAILABLE');

  const router = new Contract(cfg.router, ROUTER_ABI, signer);
  let tx;
  if (fromToken.native) {
    tx = supportFeeOnTransfer
      ? await router.swapExactETHForTokensSupportingFeeOnTransferTokens(minOutWei, path, to, deadline, {
          value: amountInWei
        })
      : await router.swapExactETHForTokens(minOutWei, path, to, deadline, { value: amountInWei });
  } else if (toToken.native) {
    tx = supportFeeOnTransfer
      ? await router.swapExactTokensForETHSupportingFeeOnTransferTokens(amountInWei, minOutWei, path, to, deadline)
      : await router.swapExactTokensForETH(amountInWei, minOutWei, path, to, deadline);
  } else {
    tx = supportFeeOnTransfer
      ? await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(amountInWei, minOutWei, path, to, deadline)
      : await router.swapExactTokensForTokens(amountInWei, minOutWei, path, to, deadline);
  }

  return { hash: tx.hash, wait: () => tx.wait(), viaFeeRouter: false };
}

/* ------------------------------ plain send ------------------------------- */

/** Send native coin or an ERC-20 to an address the user typed in. */
export async function sendToken({ signer, token, to, amount }) {
  const { Contract, parseUnits, isAddress } = await loadEthers();
  if (!isAddress(to)) throw new Error('INVALID_ADDRESS');

  const amountWei = parseUnits(String(amount), token.decimals);

  if (token.native) {
    const tx = await signer.sendTransaction({ to, value: amountWei });
    return { hash: tx.hash, wait: () => tx.wait() };
  }
  const c = new Contract(token.address, ERC20_ABI, signer);
  const tx = await c.transfer(to, amountWei);
  return { hash: tx.hash, wait: () => tx.wait() };
}

/* -------------------------------- gas ------------------------------------ */

/** Estimate the gas cost of a swap in native coin, for the review screen. */
export async function estimateGasCost(provider) {
  try {
    const { formatEther } = await loadEthers();
    const fee = await provider.getFeeData();
    const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
    const GAS_LIMIT = 250000n; // typical V2 swap with one hop
    return Number(formatEther(gasPrice * GAS_LIMIT));
  } catch {
    return null;
  }
}

/** Price impact vs. a tiny reference trade — flags thin liquidity. */
export async function getPriceImpact({ provider, chainId, fromToken, toToken, amountIn, quote }) {
  try {
    const probe = await getQuote({
      provider,
      chainId,
      fromToken,
      toToken,
      amountIn: Math.max(Number(amountIn) / 1000, 10 ** -fromToken.decimals),
      slippage: 0
    });
    if (!probe?.rate || !quote?.rate) return null;
    const impact = ((probe.rate - quote.rate) / probe.rate) * 100;
    return Math.max(0, impact);
  } catch {
    return null;
  }
}
