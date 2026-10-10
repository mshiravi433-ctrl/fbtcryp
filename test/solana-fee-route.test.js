// @vitest-environment node
/**
 * «قبلا با OpenOcean بود که کارمزد داشتیم… الان اومده روی ژوپیتر که کارمزد
 * صفره» — THE ROUTE DECISION, PINNED.
 * ==========================================================================
 * Reported 2026-10-10. The Solana screen had four ways to move tokens and only
 * two of them could pay us, so the moment the paid ones were unavailable the
 * screen priced AND executed every swap through the free Jupiter route — while
 * looking completely healthy.
 *
 * Nothing here touches a wallet, a browser or an upstream. The route order is a
 * pure function, the fee paths take an injected `fetch`, and the fee a Jupiter
 * order carries is read from Jupiter's own echo. That is the only way a
 * money-path decision can be asserted at all.
 *
 *   1. routeOrder — which routes are asked, and which one builds.
 *   2. server/solanaJupFee.js — Jupiter's own Swap API WITH our platform fee:
 *      the fee account comes from server env (never from the caller), the fee
 *      echo is verified before anything is returned, and an unconfigured pair
 *      refuses rather than pretending.
 *   3. server/solanaLifi.js — the LI.FI `distributionFees` echo gate.
 *   4. lib/solana.js — the fee a Jupiter /order actually carries, from its echo
 *      rather than from a build-time flag.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FREE_SOLANA_PROVIDER,
  PAID_SOLANA_PROVIDERS,
  ROUTER_LABEL,
  SOLANA_ROUTE_PROVIDERS,
  isPaidSolanaProvider,
  solanaBuildOrder,
  solanaQuoteProviders,
  solanaRouteLabel,
  solanaSkippedReasons
} from '../src/lib/solana/routeOrder.js';

import {
  jupFeeAccountFor,
  jupFeeAccounts,
  jupFeeQuote,
  jupFeeStatus,
  jupFeeSwapQuote
} from '../server/solanaJupFee.js';

import { verifySolanaFeeEcho } from '../server/solanaLifi.js';
import { jupiterEchoedFeeBps } from '../src/lib/solana.js';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MEME = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
/* Our fee token account (a wrapped-SOL account we own). */
const FEE_ACCOUNT = 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4';
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

/** What Jupiter's Metis API answers, per test. */
let jupQuoteBody = null;
let jupSwapBody = null;
/** Every upstream call, so a test can assert what we actually sent. */
let calls = [];

function stubJupiter({ quote = null, swap = null } = {}) {
  jupQuoteBody = quote;
  jupSwapBody = swap;
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const isSwap = /\/swap$/.test(String(url));
    const body = isSwap ? jupSwapBody : jupQuoteBody;
    if (!body) return new Response(JSON.stringify({ error: 'no stub' }), { status: 500 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }));
}

/** A quote answer that carries the fee we asked for. */
const paidQuote = (feeBps = 70) => ({
  inputMint: SOL,
  outputMint: USDC,
  inAmount: '1000000000',
  outAmount: '113842444',
  otherAmountThreshold: '112703020',
  priceImpactPct: '0.01',
  slippageBps: 50,
  platformFee: { amount: '7000000', feeBps }
});

const ENV_KEYS = [
  'JUP_FEE_ACCOUNT',
  'JUP_FEE_MINT',
  'JUP_FEE_ACCOUNTS',
  'JUPITER_API_KEY',
  'SOLANA_FEE_BPS',
  'FEE_BPS'
];
const savedEnv = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe('solana route order — which route runs, and which one pays', () => {
  it('knows four routes, three of which pay us', () => {
    expect(SOLANA_ROUTE_PROVIDERS).toEqual(['openocean', 'lifi', 'jupfee', 'jupiter']);
    expect(PAID_SOLANA_PROVIDERS).toEqual(['openocean', 'lifi', 'jupfee']);
    expect(FREE_SOLANA_PROVIDER).toBe('jupiter');
    expect(isPaidSolanaProvider('jupfee')).toBe(true);
    /* The distinction the whole report is about: two Jupiter routes, one paid. */
    expect(isPaidSolanaProvider('jupiter')).toBe(false);
  });

  it('builds with the provider that PRICED the screen first', () => {
    /* The user consented to that provider's number, so it builds first. */
    expect(solanaBuildOrder('lifi')).toEqual(['lifi', 'openocean', 'jupfee', 'jupiter']);
    expect(solanaBuildOrder('jupfee')).toEqual(['jupfee', 'openocean', 'lifi', 'jupiter']);
    expect(solanaBuildOrder('openocean')).toEqual(['openocean', 'lifi', 'jupfee', 'jupiter']);
  });

  it('keeps every remaining PAID route ahead of the free one', () => {
    /* A free route priced the screen; a paid fallback still wins the ladder,
       because "still alive" beats "earns nothing". */
    expect(solanaBuildOrder('jupiter')).toEqual(['jupiter', 'openocean', 'lifi', 'jupfee']);
    for (const priced of SOLANA_ROUTE_PROVIDERS) {
      const order = solanaBuildOrder(priced);
      const rest = order.slice(1);
      const firstFree = rest.indexOf(FREE_SOLANA_PROVIDER);
      if (firstFree === -1) {
        /* The free route WAS the priced one, so everything left must be paid. */
        expect(priced).toBe(FREE_SOLANA_PROVIDER);
        expect(rest.every(isPaidSolanaProvider)).toBe(true);
        continue;
      }
      const lastPaid = Math.max(...rest.map((p, i) => (isPaidSolanaProvider(p) ? i : -1)));
      expect(firstFree).toBeGreaterThan(lastPaid);
    }
  });

  it('falls back to the canonical ladder for an id it has never seen', () => {
    /* A typo must degrade to the safe order, not drop the free fallback. */
    expect(solanaBuildOrder('jupiterr')).toEqual(SOLANA_ROUTE_PROVIDERS);
    expect(solanaBuildOrder(undefined)).toEqual(SOLANA_ROUTE_PROVIDERS);
  });

  it('asks all three paid routes when nothing is known about them', () => {
    /* UNKNOWN is not "unconfigured": refusing to ask because we could not
       confirm is how a working paid route gets skipped. */
    expect(solanaQuoteProviders({})).toEqual(['openocean', 'jupfee']);
    expect(solanaQuoteProviders({ address: WALLET })).toEqual(['openocean', 'lifi', 'jupfee']);
    /* LI.FI cannot price without a wallet address — its quote carries the
       transaction — so it is the only one that waits for a connection. */
    expect(solanaQuoteProviders({ address: null, routes: {} })).not.toContain('lifi');
  });

  it('stops asking routes our own server says cannot pay', () => {
    const routes = {
      de1: { keyConfigured: false },
      lifi: { feeReady: true },
      jupfee: { configured: false }
    };
    /* This is the exact configuration behind the report: no De¹ key, no
       Jupiter fee account ⇒ the only paid route left is LI.FI. */
    expect(solanaQuoteProviders({ address: WALLET, routes })).toEqual(['lifi']);
    expect(solanaSkippedReasons({ address: WALLET, routes })).toEqual({
      openocean: 'NO_API_KEY',
      jupfee: 'FEE_ACCOUNT_NOT_CONFIGURED'
    });
  });

  it('names the wallet, not the configuration, when LI.FI is skipped for want of one', () => {
    expect(solanaSkippedReasons({ address: null, routes: { lifi: { feeReady: true } } }))
      .toEqual({ lifi: 'NEEDS_WALLET' });
    expect(solanaSkippedReasons({ address: WALLET, routes: { lifi: { feeReady: false } } }))
      .toEqual({ lifi: 'FEE_NOT_CONFIGURED' });
  });

  it('never puts the free route in the quote race', () => {
    /* Racing it would let the fastest answer win on latency alone — exactly how
       the screen came to show zero fees while paid routes were alive. */
    for (const address of [null, WALLET]) {
      for (const routes of [null, {}, { de1: { keyConfigured: true } }]) {
        expect(solanaQuoteProviders({ address, routes })).not.toContain(FREE_SOLANA_PROVIDER);
      }
    }
  });

  it('labels both Jupiter routes Jupiter, because both are Jupiter', () => {
    expect(ROUTER_LABEL.jupfee).toBe('Jupiter');
    expect(ROUTER_LABEL.jupiter).toBe('Jupiter');
    expect(solanaRouteLabel('lifi')).toBe('LI.FI');
    /* …and an unknown id cannot ship wearing no name at all. */
    expect(solanaRouteLabel('mystery')).toBe(ROUTER_LABEL.openocean);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe('jupiter metis fee route — server/solanaJupFee.js', () => {
  it('refuses, without calling upstream, when no fee account is configured', async () => {
    stubJupiter({ quote: paidQuote() });
    const r = await jupFeeQuote({ inputMint: SOL, outputMint: USDC, amount: '1000000000' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('JUP_FEE_NOT_CONFIGURED');
    /* A route that cannot pay must not spend a request pretending to try. */
    expect(calls).toHaveLength(0);
    expect(jupFeeStatus().configured).toBe(false);
  });

  it('takes the fee account from server env, and only for a mint in the pair', async () => {
    process.env.JUP_FEE_ACCOUNT = FEE_ACCOUNT; // mint defaults to wrapped SOL
    expect(jupFeeAccounts()).toEqual({ [SOL]: FEE_ACCOUNT });
    /* SOL is on the input side here … */
    expect(jupFeeAccountFor(SOL, USDC)).toEqual({ mint: SOL, account: FEE_ACCOUNT });
    /* … and on the output side here. Jupiter only accepts a fee account whose
       mint is one of the two, so the pair decides. */
    expect(jupFeeAccountFor(USDC, SOL)).toEqual({ mint: SOL, account: FEE_ACCOUNT });
    /* A pair with neither side matching has no fee path at all. */
    expect(jupFeeAccountFor(USDC, MEME)).toBeNull();
  });

  it('asks Jupiter for our rate and verifies the echo before returning a price', async () => {
    process.env.JUP_FEE_ACCOUNT = FEE_ACCOUNT;
    stubJupiter({ quote: paidQuote(70) });

    const r = await jupFeeQuote({ inputMint: SOL, outputMint: USDC, amount: '1000000000', slippageBps: 50 });
    expect(r.ok).toBe(true);
    expect(r.body.provider).toBe('jupfee');
    expect(r.body.outAmount).toBe('113842444');
    expect(r.body.feeBps).toBe(70);
    expect(r.body.feeApplied).toBe(true);
    expect(r.body.feeAccount).toBe(FEE_ACCOUNT);

    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe('https://api.jup.ag/swap/v1/quote');
    expect(url.searchParams.get('platformFeeBps')).toBe('70');
    expect(url.searchParams.get('inputMint')).toBe(SOL);
    expect(url.searchParams.get('slippageBps')).toBe('50');
    /* The quote response is never handed to the browser: it is what /swap
       consumes, and a caller-editable copy of it is a fee-editable copy. */
    expect(JSON.stringify(r.body)).not.toContain('routePlan');
    expect(r.body.quoteResponse).toBeUndefined();
  });

  it('rejects a quote whose fee echo is missing or different', async () => {
    process.env.JUP_FEE_ACCOUNT = FEE_ACCOUNT;

    stubJupiter({ quote: { ...paidQuote(70), platformFee: undefined } });
    let r = await jupFeeQuote({ inputMint: SOL, outputMint: USDC, amount: '1000000000' });
    expect(r.ok).toBe(false);
    expect(r.body.error).toBe('FEE_NOT_APPLIED');

    /* Jupiter's own platform fee is not ours to claim. */
    stubJupiter({ quote: paidQuote(20) });
    r = await jupFeeQuote({ inputMint: SOL, outputMint: USDC, amount: '1000000000' });
    expect(r.ok).toBe(false);
    expect(r.body.error).toBe('FEE_NOT_APPLIED');
  });

  it('builds with OUR fee account, whatever the caller sent', async () => {
    process.env.JUP_FEE_ACCOUNT = FEE_ACCOUNT;
    stubJupiter({
      quote: paidQuote(70),
      swap: { swapTransaction: 'SlVQVEVSVjFUWENPTVBPTkVOVA==', lastValidBlockHeight: 12345 }
    });

    const r = await jupFeeSwapQuote({
      inputMint: SOL,
      outputMint: USDC,
      amount: '1000000000',
      account: WALLET,
      slippageBps: 50,
      /* Hostile fields: none of these may reach upstream. */
      feeAccount: '11111111111111111111111111111112',
      platformFeeBps: 5000,
      userPublicKey: '11111111111111111111111111111112'
    });

    expect(r.ok).toBe(true);
    expect(r.body.transaction).toBe('SlVQVEVSVjFUWENPTVBPTkVOVA==');
    expect(r.body.versioned).toBe(true);
    expect(r.body.feeBps).toBe(70);

    const sent = JSON.parse(calls[1].init.body);
    expect(sent.feeAccount).toBe(FEE_ACCOUNT);
    expect(sent.userPublicKey).toBe(WALLET);
    expect(sent.platformFeeBps).toBeUndefined();
    /* The quote /swap consumes is the one Jupiter just gave US. */
    expect(sent.quoteResponse.platformFee.feeBps).toBe(70);
  });

  it('validates the caller before spending anything upstream', async () => {
    process.env.JUP_FEE_ACCOUNT = FEE_ACCOUNT;
    stubJupiter({ quote: paidQuote(70), swap: { swapTransaction: 'WA==' } });

    expect((await jupFeeSwapQuote({ inputMint: SOL, outputMint: USDC, amount: '1', account: 'nope' })).body.error)
      .toBe('BAD_TAKER');
    expect((await jupFeeQuote({ inputMint: 'nope', outputMint: USDC, amount: '1' })).body.error)
      .toBe('BAD_MINT');
    expect((await jupFeeQuote({ inputMint: SOL, outputMint: SOL, amount: '1' })).body.error)
      .toBe('SAME_TOKEN');
    expect((await jupFeeQuote({ inputMint: SOL, outputMint: USDC, amount: '0' })).body.error)
      .toBe('BAD_AMOUNT');
    /* A decimal amount would reach Jupiter as an opaque failure. */
    expect((await jupFeeQuote({ inputMint: SOL, outputMint: USDC, amount: '1.5' })).body.error)
      .toBe('BAD_AMOUNT');
    expect(calls).toHaveLength(0);
  });

  it('drops a malformed fee-account blob instead of breaking swaps', () => {
    process.env.JUP_FEE_ACCOUNTS = '{not json';
    expect(jupFeeAccounts()).toEqual({});
    process.env.JUP_FEE_ACCOUNTS = JSON.stringify({ [SOL]: 'not-base58-0OIl', [USDC]: FEE_ACCOUNT });
    /* The invalid entry is dropped silently; the valid one still works. */
    expect(jupFeeAccounts()).toEqual({ [USDC]: FEE_ACCOUNT });
    expect(jupFeeAccountFor(SOL, USDC)).toEqual({ mint: USDC, account: FEE_ACCOUNT });
  });

  it('attaches the key server-side and never echoes it', async () => {
    process.env.JUP_FEE_ACCOUNT = FEE_ACCOUNT;
    process.env.JUPITER_API_KEY = 'jup-secret-key';
    stubJupiter({ quote: paidQuote(70) });

    const r = await jupFeeQuote({ inputMint: SOL, outputMint: USDC, amount: '1000000000' });
    expect(r.ok).toBe(true);
    expect(calls[0].init.headers['x-api-key']).toBe('jup-secret-key');
    expect(JSON.stringify(r.body)).not.toContain('jup-secret-key');
    expect(jupFeeStatus().keyConfigured).toBe(true);
    expect(JSON.stringify(jupFeeStatus())).not.toContain('jup-secret-key');
  });

  it('answers fee readiness per pair, because one wSOL account does not cover every pair', async () => {
    process.env.JUP_FEE_ACCOUNT = FEE_ACCOUNT;
    expect(jupFeeStatus({ inputMint: SOL, outputMint: USDC }).feeReady).toBe(true);
    expect(jupFeeStatus({ inputMint: USDC, outputMint: MEME }).feeReady).toBe(false);
    /* Without a pair the honest answer is "unknown", not "no". */
    expect(jupFeeStatus().feeReady).toBeNull();
    expect(jupFeeStatus().feeMints).toEqual([SOL]);
  });

  it('keeps one house rate across the Solana routes', async () => {
    process.env.JUP_FEE_ACCOUNT = FEE_ACCOUNT;
    process.env.SOLANA_FEE_BPS = '55';
    stubJupiter({ quote: paidQuote(55) });
    const r = await jupFeeQuote({ inputMint: SOL, outputMint: USDC, amount: '1000000000' });
    /* The same reader the De¹ and LI.FI routes use — three routes, one rate. */
    expect(r.body.feeBps).toBe(55);
    expect(new URL(calls[0].url).searchParams.get('platformFeeBps')).toBe('55');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe('lifi solana fee echo gate — server/solanaLifi.js', () => {
  /* The documented response shape, from docs.li.fi's FeeForwarder page. */
  const lifiQuote = (overrides = {}) => ({
    tool: 'okx',
    integrator: 'fbt-swap',
    estimate: {
      fromAmount: '1000000000',
      toAmount: '113842444',
      feeCosts: [
        { name: 'LIFI Fixed Fee', amount: '2500000', percentage: '0.0025' },
        {
          name: 'Distributions',
          percentage: '0.0070',
          amount: '7000000',
          feeSplit: {
            integratorFee: '0',
            lifiFee: '0',
            recipients: [
              { name: FEE_ACCOUNT, fee: '7000000', type: 'DISTRIBUTION', walletAddress: FEE_ACCOUNT }
            ]
          }
        }
      ]
    },
    transactionRequest: { data: 'TElGSVNYTlRY' },
    ...overrides
  });

  it('accepts a distribution that pays our wallet our exact rate', () => {
    const echo = verifySolanaFeeEcho(lifiQuote(), { bps: 70, receiver: FEE_ACCOUNT });
    expect(echo.ok).toBe(true);
    expect(echo.paid).toBe(7000000n); // 0.70000% of 1 SOL, to the lamport
  });

  it('accepts the round-down on amounts that do not divide cleanly', () => {
    const body = lifiQuote();
    body.estimate.fromAmount = '123456789';
    body.estimate.feeCosts[1].feeSplit.recipients[0].fee = '864197'; // floor of 864197.523
    expect(verifySolanaFeeEcho(body, { bps: 70, receiver: FEE_ACCOUNT }).ok).toBe(true);
  });

  it('refuses a quote with no Distributions entry at all', () => {
    const body = lifiQuote();
    body.estimate.feeCosts = [body.estimate.feeCosts[0]];
    expect(verifySolanaFeeEcho(body, { bps: 70, receiver: FEE_ACCOUNT }).code).toBe('FEE_NOT_APPLIED');
  });

  it('refuses a fee paid to somebody else', () => {
    const body = lifiQuote();
    body.estimate.feeCosts[1].feeSplit.recipients[0].walletAddress = WALLET;
    body.estimate.feeCosts[1].feeSplit.recipients[0].name = WALLET;
    expect(verifySolanaFeeEcho(body, { bps: 70, receiver: FEE_ACCOUNT }).code)
      .toBe('FEE_RECIPIENT_MISMATCH');
  });

  it('refuses a different rate, and never accepts more than we asked for', () => {
    const low = lifiQuote();
    low.estimate.feeCosts[1].percentage = '0.0050';
    low.estimate.feeCosts[1].feeSplit.recipients[0].fee = '5000000';
    expect(verifySolanaFeeEcho(low, { bps: 70, receiver: FEE_ACCOUNT }).code).toBe('FEE_AMOUNT_MISMATCH');

    /* More than requested is money out of the user's swap they never
       consented to — the upper bound is exact, with no slack. */
    const high = lifiQuote();
    high.estimate.feeCosts[1].feeSplit.recipients[0].fee = '7000001';
    expect(verifySolanaFeeEcho(high, { bps: 70, receiver: FEE_ACCOUNT }).code)
      .toBe('FEE_AMOUNT_MISMATCH');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe('the fee a jupiter /order actually carries', () => {
  it('reads the echo, not a build-time flag', () => {
    /* No referral account in the answer ⇒ no fee was requested, whatever the
       bundle was built with. This is the exact case that used to print 0.70%
       on screen while nothing collected it. */
    expect(jupiterEchoedFeeBps({ outAmount: '1', feeBps: 70 })).toBeNull();
    expect(jupiterEchoedFeeBps({ referralAccount: WALLET, feeBps: 70 })).toBe(70);
    /* feeBps alone can be Jupiter's own platform fee, which is not ours. */
    expect(jupiterEchoedFeeBps({ referralAccount: WALLET })).toBeNull();
    expect(jupiterEchoedFeeBps({ referralAccount: WALLET, feeBps: 0 })).toBeNull();
    expect(jupiterEchoedFeeBps(null)).toBeNull();
    expect(jupiterEchoedFeeBps({ referralAccount: 'not an address', feeBps: 70 })).toBeNull();
  });
});
