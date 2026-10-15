/**
 * SOLANA SPOT — the adapter that lets the spot tab trade Solana alongside the
 * EVM networks, through the SAME quote → review → confirm discipline.
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * The spot tab (components/spot) speaks EVM: ethers providers, ERC-20
 * approvals, lib/swap.js. Solana is a different address format, a different
 * aggregator stack and a different signing scheme. Reported request:
 * «امکان اسپات سولنا در همین صفحه به لیست شبکه ها اضافه بشه» — Solana spot
 * inside THIS page, in the network list — not a link to another screen.
 *
 * So the tab keeps one form and one safety contract, and this module answers
 * the four chain questions for Solana:
 *
 *   1. which tokens  → SOLANA_SPOT_TOKENS (SOL, USDC, USDT — the curated set
 *      lib/solanaUniverse.js starts from; a mint list never guesses)
 *   2. balances      → lib/solanaWallet's hardened two-door reader, mapped to
 *      the same { raw, formatted } shape the EVM side uses
 *   3. the quote     → the SAME provider race the Solana swap screen runs
 *      (paid routes in parallel, free Jupiter as the fallback), normalised to
 *      the spot quote shape (amountOutWei / minOutWei / feeBps)
 *   4. the order     → runSolanaSpotOrder, the only place a Solana signature
 *      can happen. It enforces the exact rules test/spot-trade-flow.test.mjs
 *      counts on the EVM side: `confirmed` must be exactly true, a stale
 *      quote is never executed, the reviewed minimum is protected, and a
 *      wallet rejection ends the order as `cancelled` with nothing retried.
 *
 * The money paths this file calls are the EXISTING ones — solanaOcean,
 * solanaLifi, solanaJupFee, lib/solana (Jupiter V2) and solanaWallet's
 * signAndSendSolana / signSolanaTransaction — unchanged. The route order and
 * the "which route pays us" policy live in lib/solana/routeOrder.js, exactly
 * as on the Solana swap screen. Nothing here re-implements a transaction.
 *
 * Every heavy module is imported LAZILY inside the functions: the EVM-only
 * user (and the jsdom tests) never load the Solana stack, and a module that
 * fails to import can only fail the one call that needed it.
 */

import {
  executeSignature,
  executeSolanaOrder,
  executeSucceeded,
  getSolanaOrder,
  jupiterEchoedFeeBps,
  orderErrorKey,
  orderQuote
} from '../solana.js';
import { solanaBuildOrder, solanaQuoteProviders } from '../solana/routeOrder.js';
import { SPOT_STATUS, classifySpotError, isUserRejection } from './spotFlow.js';
import { SPOT_QUOTE_MAX_AGE_MS, floorMinOutWei, isQuoteStale, verifyQuoteProtection } from './spotMath.js';

/** The network id used in the spot tab's chain picker and state. */
export const SOLANA_SPOT_ID = 'solana';

/** What the tab's `cfg` variable needs from a network: a name and a gas coin. */
export const SOLANA_SPOT_CHAIN = Object.freeze({
  name: 'Solana',
  native: Object.freeze({ symbol: 'SOL' })
});

/** SOL kept back on a max-send so the fee still fits (the EVM gas floor rule). */
export const SOLANA_GAS_FLOOR = '0.002';

/** What a Solana transfer costs, roughly — shown as an estimate, like EVM gas. */
export const SOLANA_GAS_ESTIMATE = 0.00001;

/** Explorer link for a signature. */
export function solanaTxLink(hash) {
  return hash ? `https://solscan.io/tx/${hash}` : null;
}

/**
 * The curated spot tokens, in the SAME shape the EVM TOKENS lists use
 * (`symbol`, `name`, `address`, `decimals`, `native`, `coingeckoId`) plus the
 * Solana `mint`. `address` carries the mint so `directedPair` and the history
 * record keep working unchanged. Prices come from the market feed through the
 * same CoinGecko ids the rest of the app already stores.
 */
export const SOLANA_SPOT_TOKENS = Object.freeze([
  Object.freeze({
    symbol: 'SOL',
    name: 'Solana',
    address: 'So11111111111111111111111111111111111111112',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    native: true,
    coingeckoId: 'solana'
  }),
  Object.freeze({
    symbol: 'USDC',
    name: 'USD Coin',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    coingeckoId: 'usd-coin'
  }),
  Object.freeze({
    symbol: 'USDT',
    name: 'Tether USD',
    address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
    coingeckoId: 'tether'
  })
]);

const SOL_MINT = SOLANA_SPOT_TOKENS[0].mint;

/** A refusal from anywhere → one short code the spot UI already translates. */
function solanaErrorCode(err) {
  if (isUserRejection(err)) return 'USER_REJECTED';
  const msg = String(err?.message ?? '');
  // The route providers throw plain Error(code) — the code IS the message.
  if (/^NO_ROUTE$|^SAME_TOKEN$|^BAD_MINT$|^BAD_AMOUNT$/.test(msg)) return 'NO_ROUTE';
  if (msg === 'QUOTE_NETWORK' || err?.network === true) return 'QUOTE_NETWORK';
  if (msg === 'QUOTE_FAILED' || msg === 'NO_TRANSACTION' || msg === 'ORDER_FAILED') return 'QUOTE_FAILED';
  if (msg === 'SEND_FAILED') return 'TX_FAILED';
  return classifySpotError(err);
}

/* ────────────────────────────── balances ────────────────────────────────── */

/**
 * What the wallet holds, per curated token — `{ raw, formatted } | null`, the
 * exact shape the market list and the amount hint already consume. A failed
 * read throws the reader's named code and the caller shows «unavailable»;
 * it is NEVER zero (the rule the market list is tested against).
 *
 * One hardened read per non-native mint (its `sourceRaw` is that mint's
 * balance) and the SOL figure comes back inside every answer as
 * `solLamports` — two network calls cover the whole list.
 */
export async function getSolanaSpotBalances({ owner, tokens = SOLANA_SPOT_TOKENS, formatFloor }) {
  const { getSolanaSwapBalances } = await import('../solanaWallet.js');
  const mints = tokens.filter((tk) => !tk.native && tk.mint);
  const first = mints[0] ?? null;
  const read = (inputMint) => getSolanaSwapBalances({ owner, inputMint, outputMint: SOL_MINT });

  const results = await Promise.all(
    mints.map((tk) =>
      read(tk.mint).then(
        (state) => ({ tk, state }),
        (err) => {
          // The pair read answers for BOTH its mints; one refusal means the
          // whole picture is unverified, so it is reported as such.
          if (first && tk.mint === first.mint) throw err;
          return { tk, state: null, err };
        }
      )
    )
  );
  // The first read's failure is the batch's failure — same «unavailable»
  // semantics as an EVM read that throws.
  const head = results.find((r) => r.tk.mint === first?.mint);
  if (head?.err) throw head.err;

  const out = {};
  const solLamports = head?.state?.solLamports ?? null;
  for (const tk of tokens) {
    if (tk.native) {
      out[tk.symbol] = solLamports != null
        ? { raw: BigInt(solLamports), formatted: formatFloor(BigInt(solLamports), tk.decimals, 6) }
        : null;
      continue;
    }
    const hit = results.find((r) => r.tk.mint === tk.mint);
    const raw = hit?.state?.sourceRaw;
    out[tk.symbol] = raw != null
      ? { raw: BigInt(raw), formatted: formatFloor(BigInt(raw), tk.decimals, 6) }
      : null;
  }
  return out;
}

/* ─────────────────────────────── quote ──────────────────────────────────── */

/**
 * One quote for a Solana pair, normalised to the spot tab's quote shape.
 *
 * The race is the Solana swap screen's, in compact form: the fee-earning
 * routes are asked IN PARALLEL (whichever answers with the LARGER output
 * wins), and the free Jupiter /order route is only the fallback when none of
 * them can price the pair — racing it would let latency pick a zero-fee
 * route while a paid one was still alive. See lib/solana/routeOrder.js for
 * the policy this mirrors.
 *
 * @returns {Promise<{
 *   amountInWei: bigint, amountOutWei: bigint, minOutWei: bigint,
 *   feeBps: number, platformFeeWei: null, hops: number, path: string[],
 *   source: string, impactPct: number|null
 * }>}
 */
export async function getSolanaSpotQuote({ fromToken, toToken, amountWei, slippagePct, address = null }) {
  const inputMint = fromToken?.mint;
  const outputMint = toToken?.mint;
  if (!inputMint || !outputMint || inputMint === outputMint) throw new Error('NO_ROUTE');
  const base = String(amountWei);
  const slippageBps = Math.min(5000, Math.max(1, Math.round(Number(slippagePct) * 100)));

  const [{ getOceanQuote }, { getLifiSolanaQuote }, { getJupFeeQuote }] = await Promise.all([
    import('../solanaOcean.js'),
    import('../solanaLifi.js'),
    import('../solanaJupFee.js')
  ]);

  const asked = solanaQuoteProviders({ address, routes: null });
  const priced = (provider) => (r) =>
    r?.outAmount && String(r.outAmount) !== '0'
      ? { ...r, provider }
      : Promise.reject(new Error('NO_ROUTE'));
  const CALLS = {
    openocean: () => getOceanQuote({ inputMint, outputMint, amount: base, slippageBps }),
    lifi: () => getLifiSolanaQuote({ inputMint, outputMint, amount: base, account: address, slippageBps }),
    jupfee: () => getJupFeeQuote({ inputMint, outputMint, amount: base, slippageBps })
  };

  let q = null;
  let err = null;
  const GRACE_MS = 2500;
  const WINDOW_CAP_MS = 12000;
  const startedAt = Date.now();
  let firstSuccessAt = 0;
  const asBig = (v) => {
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  };
  const consider = (v) => {
    firstSuccessAt = firstSuccessAt || Date.now();
    if (!q) {
      q = v;
      return;
    }
    const candidate = asBig(v.outAmount);
    const current = asBig(q.outAmount);
    if (candidate != null && (current == null || candidate > current)) q = v;
  };
  const attempts = asked
    .filter((p) => CALLS[p])
    .map((p) => CALLS[p]().then(priced(p)).then(consider, (e) => {
      if (!err) err = e;
    }));
  await Promise.race([
    Promise.all(attempts),
    new Promise((resolve) => {
      const timer = setInterval(() => {
        const graceElapsed = firstSuccessAt && Date.now() - firstSuccessAt >= GRACE_MS;
        if (graceElapsed || Date.now() - startedAt >= WINDOW_CAP_MS) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    })
  ]);

  if (!q) {
    // The free Jupiter route: price only (no taker ⇒ nothing signable back).
    const jo = await getSolanaOrder({ inputMint, outputMint, amount: base, slippageBps });
    if (jo?.transaction === '' && jo.errorCode) throw new Error(orderErrorKey(jo) || 'NO_ROUTE');
    const cq = orderQuote(jo);
    if (!cq?.outAmount || cq.outAmount === '0') throw new Error(err?.network === true ? 'QUOTE_NETWORK' : 'NO_ROUTE');
    q = {
      inAmount: cq.inAmount ?? base,
      outAmount: cq.outAmount,
      minOutAmount: cq.otherAmountThreshold ?? null,
      priceImpact: cq.priceImpactPct ?? null,
      feeBps: jupiterEchoedFeeBps(jo),
      provider: 'jupiter'
    };
  }

  const amountOutWei = asBig(q.outAmount);
  if (amountOutWei == null || amountOutWei <= 0n) throw new Error('NO_ROUTE');
  const amountInWei = asBig(q.inAmount) ?? BigInt(base);

  // The floor the user accepted, and the route's own threshold when it is
  // TIGHTER — never looser (spotFlow rule 3 verifies exactly this).
  const slippageFloor = floorMinOutWei(amountOutWei, slippagePct);
  const routeMin = asBig(q.minOutAmount) ?? 0n;
  const minOutWei = routeMin > slippageFloor && routeMin <= amountOutWei ? routeMin : slippageFloor;

  // The route's own fee, echoed by the provider, charged in the input token —
  // the same disclosure shape as the EVM platform fee.
  const feeBps = Number(q.totalFeeBps ?? q.feeBps ?? 0) || 0;
  const platformFeeWei = feeBps > 0 ? (amountInWei * BigInt(Math.round(feeBps))) / 10000n : 0n;

  return {
    amountInWei,
    amountOutWei,
    minOutWei,
    feeBps,
    platformFeeWei,
    hops: 1,
    path: [inputMint, outputMint],
    source: q.provider ?? 'solana',
    impactPct: q.priceImpact != null && Number.isFinite(Number(q.priceImpact)) ? Number(q.priceImpact) : null
  };
}

/* ─────────────────────────────── order ──────────────────────────────────── */

/**
 * Execute ONE Solana spot order. The same six rules as runSpotOrder:
 * confirmed must be exactly true; a stale quote is refused; the reviewed
 * minimum is protected; the transaction is fetched fresh at signing time;
 * a worse fresh price stops with `stale` and NOTHING is signed; a wallet
 * rejection ends the order as `cancelled`.
 *
 * @param {object}  input
 * @param {boolean} input.confirmed     must be exactly true
 * @param {object}  input.reviewed      { quote, fetchedAt, slippage, fromToken, toToken, amountText }
 * @param {object}  input.context       { address, amountWei }
 * @param {(stage:string, extra?:object) => void} [input.onStage]
 * @param {() => number} [input.now]
 * @returns {Promise<{status, code?, hash?, stage?, detail?}>}
 */
export async function runSolanaSpotOrder({ confirmed, reviewed, context, onStage = () => {}, now = Date.now }) {
  if (confirmed !== true) return { status: SPOT_STATUS.BLOCKED, code: 'NOT_CONFIRMED' };

  const quote = reviewed?.quote;
  if (!quote || quote.error) return { status: SPOT_STATUS.BLOCKED, code: 'QUOTE_MISSING' };

  // Stale is refused, not executed — same as the EVM runner.
  if (isQuoteStale(reviewed.fetchedAt, now(), SPOT_QUOTE_MAX_AGE_MS)) {
    return { status: SPOT_STATUS.STALE, code: 'QUOTE_EXPIRED' };
  }

  const protectedQuote = verifyQuoteProtection({ quote, slippagePct: reviewed.slippage });
  if (!protectedQuote.ok) return { status: SPOT_STATUS.BLOCKED, code: protectedQuote.code };

  const { fromToken, toToken, slippage, amountText } = reviewed;
  const { address, amountWei } = context;
  if (!address) return { status: SPOT_STATUS.BLOCKED, code: 'WALLET_NOT_CONNECTED' };

  const inputMint = fromToken.mint;
  const outputMint = toToken.mint;
  const slippageBps = Math.min(5000, Math.max(1, Math.round(Number(slippage) * 100)));
  let stage = 'preparing';
  let hash = null;

  try {
    onStage(stage);

    /*
     * PRE-FLIGHT: a PROVABLY short wallet blocks before any wallet prompt;
     * an unreadable balance does not (the chain still gets the final word —
     * the exact rule lib/solana/swapPreflight.js encodes and the Solana swap
     * screen follows). Imported lazily; failure to load skips the check
     * rather than the trade.
     */
    try {
      const [{ solanaSwapPreflight }, { getSolanaSwapBalances }] = await Promise.all([
        import('../solana/swapPreflight.js'),
        import('../solanaWallet.js')
      ]);
      const balances = await getSolanaSwapBalances({
        owner: address,
        inputMint,
        outputMint,
        rawAmount: amountWei
      });
      const pre = solanaSwapPreflight({
        balances,
        balanceCode: null,
        rawAmount: amountWei,
        amountScaleVerified: fromToken.decimalsVerified !== false && balances?.sourceDecimalsVerified !== false,
        isSolInput: inputMint === SOL_MINT
      });
      if (!pre.ok) {
        const err = new Error(pre.code);
        err.preflight = pre;
        throw err;
      }
    } catch (err) {
      if (err?.preflight) {
        return {
          status: SPOT_STATUS.BLOCKED,
          code: err.preflight.code === 'INSUFFICIENT_BALANCE' ? 'INSUFFICIENT_BALANCE' : err.preflight.code,
          stage
        };
      }
      // A balance READ failure is not a verdict (swapPreflight's own rule) —
      // continue to the build; the aggregator still refuses a short wallet.
    }

    /*
     * The signable transaction is fetched HERE, seconds before the signature
     * — never reused from the reviewed quote. Build with the provider that
     * PRICED the screen first (the number the user consented to), then the
     * remaining paid routes, then the free one (lib/solana/routeOrder.js).
     */
    stage = 'quoting';
    onStage(stage);
    const [{ getOceanSwap }, { getLifiSolanaQuote }, { buildJupFeeSwap }] = await Promise.all([
      import('../solanaOcean.js'),
      import('../solanaLifi.js'),
      import('../solanaJupFee.js')
    ]);

    const BUILDERS = {
      openocean: async () => ({
        provider: 'openocean',
        ...(await getOceanSwap({ inputMint, outputMint, amount: amountWei, account: address, slippageBps }))
      }),
      lifi: async () => {
        const lq = await getLifiSolanaQuote({ inputMint, outputMint, amount: amountWei, account: address, slippageBps });
        if (!lq?.transaction) throw new Error('NO_TRANSACTION');
        return {
          provider: 'lifi',
          transaction: lq.transaction,
          versioned: lq.versioned !== false,
          outAmount: lq.outAmount ?? null,
          feeBps: lq.totalFeeBps ?? lq.feeBps ?? null
        };
      },
      jupfee: async () => ({
        provider: 'jupfee',
        ...(await buildJupFeeSwap({ inputMint, outputMint, amount: amountWei, account: address, slippageBps }))
      }),
      jupiter: async () => {
        // Jupiter V2 /order with a taker returns quote + unsigned transaction
        // + the requestId its /execute later needs. `versioned` is true by
        // construction — Jupiter V2 always returns v0 transactions.
        const jo = await getSolanaOrder({ inputMint, outputMint, amount: amountWei, taker: address, slippageBps });
        if (!jo?.transaction) throw new Error(orderErrorKey(jo) || 'ORDER_FAILED');
        return {
          provider: 'jupiter',
          transaction: jo.transaction,
          requestId: jo.requestId,
          outAmount: orderQuote(jo)?.outAmount ?? null,
          feeBps: jupiterEchoedFeeBps(jo),
          versioned: true
        };
      }
    };

    let built = null;
    let buildErr = null;
    for (const p of solanaBuildOrder(quote.source)) {
      const build = BUILDERS[p];
      if (!build) continue;
      try {
        built = await build();
        if (!built?.transaction) throw new Error('NO_TRANSACTION');
        break;
      } catch (e) {
        buildErr = e;
      }
    }
    if (!built) throw buildErr || new Error('NO_TRANSACTION');

    /*
     * A fallback build is a DIFFERENT route than the one the user reviewed.
     * When its output is known and it is WORSE than the reviewed minimum, the
     * order stops as `stale` and nothing is signed — the same rule the EVM
     * runner applies to a moved price. When the builder does not report an
     * output, the transaction's own slippage threshold (from the same
     * slippageBps) is the protection, and the swap proceeds.
     */
    const builtOut = (() => {
      try {
        return built.outAmount != null ? BigInt(built.outAmount) : null;
      } catch {
        return null;
      }
    })();
    if (builtOut != null && builtOut < quote.minOutWei) {
      return { status: SPOT_STATUS.STALE, code: 'PRICE_MOVED', stage };
    }

    // The one signature that moves the swap. Two named signing functions for
    // the two landing paths — never interchangeable (see SolanaSwap.jsx).
    stage = 'signing';
    onStage(stage);
    const { signAndSendSolana, signSolanaTransaction } = await import('../solanaWallet.js');
    if (built.provider === 'jupiter') {
      // RFQ routes need a market-maker signature after ours: sign ONLY, then
      // Jupiter's own /execute lands it.
      const signed = await signSolanaTransaction(built.transaction);
      const exec = await executeSolanaOrder({ signedTransaction: signed, requestId: built.requestId });
      if (!executeSucceeded(exec)) throw new Error('SEND_FAILED');
      hash = executeSignature(exec);
      if (!hash) throw new Error('SEND_FAILED');
    } else {
      // OpenOcean / LI.FI / Jupiter-Swap-API return an unsigned transaction
      // and do NOT broadcast: we sign AND send.
      hash = await signAndSendSolana(built.transaction, built.versioned);
      if (!hash) throw new Error('SEND_FAILED');
    }

    stage = 'pending';
    onStage(stage, { hash });
    return { status: SPOT_STATUS.CONFIRMED, hash, stage };
  } catch (err) {
    if (isUserRejection(err)) {
      return { status: SPOT_STATUS.CANCELLED, code: 'USER_REJECTED', hash, stage };
    }
    return {
      status: SPOT_STATUS.FAILED,
      code: solanaErrorCode(err),
      hash,
      stage,
      detail: String(err?.shortMessage || err?.message || '').slice(0, 160)
    };
  }
}
