/**
 * SOLANA SWAP VIA JUPITER'S OWN SWAP API — the fee path that needs no key
 * ---------------------------------------------------------------------------
 * ─── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * Reported 2026-10-10: «در قسمت سواپ سولانا قبلا با OpenOcean بود که کارمزد
 * داشتیم برای هر سواپ، الان اومده روی ژوپیتر که کارمزد صفره».
 *
 * The Solana screen has had three routes and only two of them could pay us:
 *
 *   1. De¹/OpenOcean  — pays 70 bps, but its enterprise gateway answers
 *                       «No API key found in request.» without
 *                       OPENOCEAN_API_KEY. No key ⇒ every quote dies.
 *   2. LI.FI          — pays our wallet per request via `distributionFees`,
 *                       keyless. Its Solana coverage is whatever its own
 *                       aggregator can route; a pasted memecoin often has no
 *                       LI.FI route at all.
 *   3. Jupiter        — the widest Solana routing there is, and the route the
 *                       screen fell back to. It paid nothing.
 *
 * Route 3 paid nothing because of HOW it was wired, not because Jupiter cannot
 * pay. This screen used Jupiter's Swap API **V2 `/order`**, whose integrator
 * fee is the Referral Program: it needs a `referralAccount` plus a
 * `referralTokenAccount` per fee mint, all created by on-chain transactions,
 * and the payout wallet holds 0 SOL — so the accounts could never be created
 * and Jupiter's own docs describe the failure as silent («the order still
 * returns but executes WITHOUT your fees»).
 *
 * Jupiter's OTHER API — the Metis Swap API, `/swap/v1/quote` + `/swap/v1/swap`
 * — collects a platform fee with no referral program at all. Their docs, under
 * "Add Fees To Swap":
 *
 *   "As of January 2025, when integrating the Metis Swap API, you no longer
 *    need to use the Referral Program to set up a referralAccount and
 *    referralTokenAccount to collect fees from the swaps you provide to the
 *    end users. Simply, just pass in any valid token account as the feeAccount
 *    parameter in the Metis Swap API."
 *
 *   https://developers.jup.ag/docs/swap/v1/add-fees-to-swap
 *
 * So: `platformFeeBps` on the quote, `feeAccount` on the swap. The
 * `feeAccount` is any INITIALIZED token account whose mint is one of the two
 * mints in the pair — ours, so the fee lands in our wallet.
 *
 * ─── WHAT THAT COSTS, STATED PLAINLY ───────────────────────────────────────
 * One initialized token account per fee mint, which is a one-time on-chain
 * creation (rent ≈ 0.002 SOL) — the same order of one-time cost as opening an
 * upstream account, and it is the only Solana fee path that then works for
 * EVERY pair Jupiter can route, memecoins included. It is configured, not
 * assumed: with no `JUP_FEE_ACCOUNT` this module reports itself unconfigured,
 * quotes nothing, and the screen keeps behaving exactly as it does today.
 * Nothing here ever pretends to collect a fee it did not verify.
 *
 * ─── THE ECHO GATE, SAME DISCIPLINE AS EVERY OTHER FEE PATH ────────────────
 * A parameter we sent proves nothing about what came back — this repo's
 * KyberSwap history is exactly a fee that was requested, echoed and silently
 * not applied. So the quote is rejected unless `platformFee.feeBps` is the
 * rate we asked for. A rejected quote costs the user nothing (another route
 * answers, or the free Jupiter one does) but it can never be presented as a
 * fee-earning route.
 *
 * ─── WHY QUOTE AND SWAP HAPPEN IN ONE REQUEST ──────────────────────────────
 * Jupiter's `/swap` needs the whole `quoteResponse` object from `/quote`. Two
 * options were rejected:
 *   • shipping that object to the browser and back — a few KB of upstream JSON
 *     per swap that a caller could edit; and
 *   • caching it in this process — Vercel serverless answers the build on a
 *     different instance than the quote, so the cache would miss.
 * So the build endpoint re-quotes and builds in the same call. That is also
 * the freshness rule the rest of this screen already follows: the transaction
 * a user signs is priced seconds before they sign it, never at quote time.
 *
 * ─── WHAT THIS MODULE DOES NOT DO ──────────────────────────────────────────
 * It does not sign and it does not broadcast. It returns a base64 versioned
 * transaction; the user's wallet signs it and the CLIENT sends it — the same
 * shape as the De¹ and LI.FI routes, which is why all three land on
 * `signAndSendSolana` and only the Jupiter **V2** route signs-only.
 */

import { feeBps as houseFeeBps, SOL_MINT } from './solanaOcean.js';

/** Jupiter's Metis Swap API. Overridable for a staging key/host, never secret. */
const JUP_BASE = String(process.env.JUP_FEE_BASE_URL || 'https://api.jup.ag/swap/v1')
  .trim()
  .replace(/\/+$/, '');

const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export { SOL_MINT };

/** The upstream we talk to, for /status. Never carries a key. */
export const upstreamBase = () => JUP_BASE;

/** Optional. Jupiter serves the free tier without one; a key only raises limits. */
const apiKey = () => String(process.env.JUPITER_API_KEY || '').trim();

/** True when JUPITER_API_KEY is present. Never reveals the value. */
export const keyConfigured = () => Boolean(apiKey());

/**
 * Our house rate, read from the SAME reader the De¹ and LI.FI routes use.
 *
 * Three Solana routes charging three different rates for what the user
 * experiences as one button is drift nobody notices until an audit. One
 * reader, one rate — see the identical note in server/solanaLifi.js.
 */
export const jupFeeBps = () => houseFeeBps();

/**
 * The fee token accounts we own, as { mint -> token account }.
 *
 * Two shapes are accepted because the useful cases differ:
 *   JUP_FEE_ACCOUNT + JUP_FEE_MINT — one account, one mint (the common case:
 *     a wrapped-SOL account, which then collects the fee on every pair that
 *     has SOL on either side);
 *   JUP_FEE_ACCOUNTS — a JSON object for several mints at once, e.g.
 *     {"So111…112":"<wSOL ata>","EPjF…Dt1v":"<USDC ata>"}.
 *
 * Every value is validated as base58 and dropped silently when it is not: an
 * invalid fee account would make Jupiter reject the whole swap, and a fee we
 * cannot collect must degrade to "no fee path", never to "broken swap".
 */
export function jupFeeAccounts() {
  const map = {};
  const raw = String(process.env.JUP_FEE_ACCOUNTS || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [mint, account] of Object.entries(parsed)) {
          const m = String(mint || '').trim();
          const a = String(account || '').trim();
          if (BASE58.test(m) && BASE58.test(a)) map[m] = a;
        }
      }
    } catch {
      /* A malformed JSON blob disables the map rather than throwing at quote
         time — a config typo must not take Solana swaps down. */
    }
  }
  const single = String(process.env.JUP_FEE_ACCOUNT || '').trim();
  /* Wrapped SOL by default: it is the mint most Solana pairs have on one side. */
  const mint = String(process.env.JUP_FEE_MINT || SOL_MINT).trim();
  if (single && BASE58.test(single) && BASE58.test(mint) && !map[mint]) map[mint] = single;
  return map;
}

/**
 * The fee account usable for THIS pair.
 *
 * Jupiter's rule, from their own swap-instructions reference: "The mint of the
 * token account can only be either the input or output mint of the swap." An
 * account for a third mint makes the whole swap fail, so the pair decides —
 * the input mint first, because that is the side the fee is taken from on an
 * exact-in swap and therefore the one the account is guaranteed to match.
 */
export function jupFeeAccountFor(inputMint, outputMint) {
  const map = jupFeeAccounts();
  const from = String(inputMint || '');
  const to = String(outputMint || '');
  if (map[from]) return { mint: from, account: map[from] };
  if (map[to]) return { mint: to, account: map[to] };
  return null;
}

/**
 * Is a fee collectable on this pair? Answered per pair, not globally: with a
 * single wrapped-SOL fee account, SOL→USDC is paid and MEME→OTHER is not.
 * The screen asks this before promising a rate.
 */
export const jupFeeReady = (inputMint, outputMint) =>
  Boolean(jupFeeAccountFor(inputMint, outputMint)) && jupFeeBps() > 0;

function headers() {
  const h = { accept: 'application/json' };
  const k = apiKey();
  if (k) h['x-api-key'] = k;
  return h;
}

async function jupFetch(path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${JUP_BASE}${path}`, {
      ...init,
      headers: { ...headers(), ...(init.headers || {}) },
      signal: ctrl.signal
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    /* A timeout is an upstream failure, not a 500 of ours — and the caller's
       fallback ladder is what turns it into "another route answers". */
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 504 : 502,
      body: { error: 'UPSTREAM_FAILED', detail: String(err?.name || err).slice(0, 200) }
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Browser input validation, shared by the price and the build so the two can
 * never disagree about what is acceptable — a transaction built from input the
 * quote rejected is how a user signs something they were never shown.
 */
function validate({ inputMint, outputMint, amount }) {
  if (!BASE58.test(String(inputMint || '')) || !BASE58.test(String(outputMint || ''))) {
    return { error: 'BAD_MINT' };
  }
  if (String(inputMint) === String(outputMint)) return { error: 'SAME_TOKEN' };
  if (!/^\d+$/.test(String(amount || '')) || String(amount) === '0') return { error: 'BAD_AMOUNT' };
  return null;
}

/** Slippage in bps, clamped to Jupiter's documented 1..10000 window. */
function slippageBpsOf(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(10000, Math.max(1, Math.round(n)));
}

/**
 * The quote, and the fee echo gate around it.
 *
 * Returns `{ ok, status, body }` like every other provider module here, so
 * server/app.js can record health and answer with one status code.
 */
export async function jupQuoteWithFee({ inputMint, outputMint, amount, slippageBps }) {
  const bad = validate({ inputMint, outputMint, amount });
  if (bad) return { ok: false, status: 400, body: bad };

  const fee = jupFeeAccountFor(inputMint, outputMint);
  const bps = jupFeeBps();
  if (!fee || !(bps > 0)) {
    /*
     * No fee account for this pair means no fee — and a fee-less quote is not
     * this module's job. The free Jupiter route (server/solana.js) already
     * exists and is honest about earning nothing; duplicating it here would
     * give the screen two providers that look different and behave the same.
     */
    return { ok: false, status: 503, body: { error: 'JUP_FEE_NOT_CONFIGURED' } };
  }

  const params = new URLSearchParams({
    inputMint: String(inputMint),
    outputMint: String(outputMint),
    amount: String(amount),
    slippageBps: String(slippageBpsOf(slippageBps)),
    platformFeeBps: String(bps)
  });

  const res = await jupFetch(`/quote?${params.toString()}`);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      body: { error: 'UPSTREAM_FAILED', detail: res.body?.error || res.body?.message || null }
    };
  }

  const body = res.body || {};
  if (!body.outAmount || String(body.outAmount) === '0') {
    return { ok: false, status: 502, body: { error: 'NO_ROUTE' } };
  }

  /*
   * THE ECHO GATE. `platformFee.feeBps` is what Jupiter will actually charge;
   * `platformFee.amount` is what it will actually pay the fee account. Both
   * come from the response, never from our request. A missing or different
   * number means the fee is not in this quote, and the quote is refused rather
   * than passed on wearing a rate it does not carry.
   */
  const echoedBps = Number(body?.platformFee?.feeBps);
  if (!Number.isFinite(echoedBps) || echoedBps !== bps) {
    // eslint-disable-next-line no-console
    console.warn(`[solanaJupFee] fee not honoured: asked ${bps}, got ${body?.platformFee?.feeBps ?? 'none'}`);
    return { ok: false, status: 502, body: { error: 'FEE_NOT_APPLIED' } };
  }

  return {
    ok: true,
    status: 200,
    /* `quoteResponse` is kept for the caller (the build endpoint) and is never
       part of the HTTP response the browser sees — see the module header. */
    body,
    quote: {
      inAmount: body.inAmount ?? String(amount),
      outAmount: body.outAmount,
      minOutAmount: body.otherAmountThreshold ?? null,
      priceImpact: body.priceImpactPct ?? null,
      feeBps: bps,
      feeAmount: body?.platformFee?.amount ?? null,
      feeMint: fee.mint,
      feeAccount: fee.account,
      /* Jupiter's Metis platform fee is ours; unlike the Ultra/referral path
         there is no documented provider cut on it. Stated, not assumed. */
      providerCutPercent: 0,
      feeApplied: true
    }
  };
}

/**
 * GET /api/solana/jupfee/quote — the price the screen shows.
 *
 * Nothing signable leaves this call: the transaction is built by
 * jupFeeSwapQuote() after the user commits, exactly like the De¹ and LI.FI
 * routes on this screen.
 */
export async function jupFeeQuote(query = {}) {
  const r = await jupQuoteWithFee({
    inputMint: query?.inputMint,
    outputMint: query?.outputMint,
    amount: query?.amount,
    slippageBps: query?.slippageBps
  });
  if (!r.ok) return { ok: false, status: r.status, body: r.body };
  return { ok: true, status: 200, body: { provider: 'jupfee', ...r.quote } };
}

/**
 * POST /api/solana/jupfee/swap — price AND build, in one upstream round trip.
 *
 * `account` is the user's wallet: it becomes `userPublicKey`, the address that
 * signs and receives. It is validated, and it is the ONLY part of the request
 * that reaches Jupiter besides the pair and the amount — `feeAccount` and
 * `platformFeeBps` come from our own configuration, so a caller cannot point
 * our revenue at their wallet or inflate the rate in our name. That is the
 * same boundary the other two Solana routes draw, and it is the reason these
 * calls go through this server at all.
 */
export async function jupFeeSwapQuote(body = {}) {
  const account = String(body?.account || '');
  if (!BASE58.test(account)) return { ok: false, status: 400, body: { error: 'BAD_TAKER' } };

  const quoted = await jupQuoteWithFee({
    inputMint: body?.inputMint,
    outputMint: body?.outputMint,
    amount: body?.amount,
    slippageBps: body?.slippageBps
  });
  if (!quoted.ok) return { ok: false, status: quoted.status, body: quoted.body };

  const res = await jupFetch('/swap', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quoted.body,
      userPublicKey: account,
      feeAccount: quoted.quote.feeAccount,
      /* Jupiter's own recommendation for reliability on a busy chain. */
      dynamicComputeUnitLimit: true,
      wrapAndUnwrapSol: true
    })
  });

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      body: { error: 'BUILD_FAILED', detail: res.body?.error || res.body?.message || null }
    };
  }

  const built = res.body || {};
  const tx = built.swapTransaction || built.transaction;
  if (typeof tx !== 'string' || !tx) {
    return { ok: false, status: 502, body: { error: 'NO_TRANSACTION' } };
  }

  return {
    ok: true,
    status: 200,
    body: {
      provider: 'jupfee',
      transaction: tx,
      /* Jupiter's Swap API returns a v0 versioned transaction; stated rather
         than guessed, because the wrong deserialiser throws at signing time. */
      versioned: true,
      inAmount: quoted.quote.inAmount,
      outAmount: quoted.quote.outAmount,
      minOutAmount: quoted.quote.minOutAmount,
      priceImpact: quoted.quote.priceImpact,
      feeBps: quoted.quote.feeBps,
      feeAmount: quoted.quote.feeAmount,
      feeMint: quoted.quote.feeMint,
      feeReceiver: quoted.quote.feeAccount,
      feeApplied: true,
      lastValidBlockHeight: built.lastValidBlockHeight ?? null
    }
  };
}

/**
 * Honest status: per pair, because that is the only truthful granularity.
 *
 * `feeReady` without a pair means "at least one fee account exists"; with a
 * pair it means "this swap can pay us". The difference matters — a single
 * wrapped-SOL account makes SOL pairs paid and memecoin↔memecoin pairs free.
 */
export function jupFeeStatus(query = {}) {
  const accounts = jupFeeAccounts();
  const pair = query?.inputMint && query?.outputMint
    ? jupFeeAccountFor(query.inputMint, query.outputMint)
    : null;
  return {
    provider: 'jupfee',
    brand: 'jupiter-metis',
    endpoint: upstreamBase(),
    keyConfigured: keyConfigured(),
    feeBps: jupFeeBps(),
    /* Mints we can collect in, never the accounts' owners or anything secret. */
    feeMints: Object.keys(accounts),
    configured: Object.keys(accounts).length > 0,
    feeReady: query?.inputMint && query?.outputMint ? Boolean(pair) && jupFeeBps() > 0 : null,
    /* Metis platform fees are ours in full; the 20% cut belongs to the
       Ultra/referral path this module deliberately does not use. */
    providerCutPercent: 0
  };
}
