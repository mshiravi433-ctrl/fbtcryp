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
import { readFileSync } from 'node:fs';

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
  clearDerivedFeeAccounts,
  deriveFeeAta,
  derivedFeeAccounts,
  jupFeeAccountFor,
  jupFeeAccounts,
  jupFeeQuote,
  jupFeeStatus,
  jupFeeStatusAsync,
  jupFeeSwapQuote,
  refreshDerivedFeeAccount,
  refreshJupFeeCoverage
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
  'FEE_BPS',
  /* Derived-fee-account tests pin the RPC to one stubbed host. */
  'SOLANA_RPC_URL',
  'SOLANA_FEE_RECIPIENT'
];
const savedEnv = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  /* The derived-fee cache is module state: a leak between tests would be a
     lie about what is configured. */
  clearDerivedFeeAccounts();
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

/* ══════════════════════════════════════════════════════════════════════════ */
/**
 * DERIVED FEE ACCOUNTS — the paid route without the env chore.
 * ==========================================================================
 * Reported 2026-10-10 as «الان اومده روی ژوپیتر که کارمزد صفره»: the fee-earning
 * route sat unconfigured because naming token accounts in env is a manual,
 * per-mint operation and configuration debt was winning. The server can now
 * discover what the payout wallet already holds on-chain — an INITIALIZED
 * token account of the pair's mint is Jupiter's whole requirement — and use it.
 * What is pinned here: known-answer derivation, discovery through real RPC
 * shapes, the fail-safes (never invent an account that is not on-chain), the
 * preference order (input first, env always wins), and the sync-reader
 * contract the rest of this suite depends on.
 */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
/* Known answers, cross-checked against @solana/spl-token's own
   getAssociatedTokenAddressSync for owner FEE_ACCOUNT: these pin the SEED
   ORDER of the derivation, which is the part a mistake would silently break. */
const USDC_ATA = 'FeKVWLQzBz8ifbEMCoZsxx8nD6sHbPsdTrJmsR4NfacX';
const SOL_ATA = 'NCmP1GnE5U8kQzrVBgLjoeoRgQn8wWUYSTdtHmyjGYh';

const liveTokenAccount = (mint, owner, program) => ({
  data: {
    program: program === TOKEN_2022_PROGRAM ? 'spl-token-2022' : 'spl-token',
    parsed: {
      type: 'account',
      info: { mint, owner, tokenAmount: { amount: '5000000', decimals: 6, uiAmount: 5 } }
    },
    space: 165
  },
  executable: false,
  lamports: 2039280,
  owner: program,
  space: 165
});

/**
 * RPC getAccountInfo + Jupiter in one stub, the way the HTTP layer sees them.
 * `accountFor(address)` answers what the chain "holds"; `rpcDown` makes every
 * node fail instead.
 */
function stubRpcThenJup(accountFor, { rpcDown = false } = {}) {
  process.env.SOLANA_RPC_URL = 'https://rpc.test.invalid';
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const sent = init?.body ? JSON.parse(init.body) : null;
    if (sent?.method === 'getAccountInfo') {
      if (rpcDown) return new Response('rpc down', { status: 500 });
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: sent.id ?? 1,
        result: { context: { slot: 1 }, value: accountFor(sent.params[0]) }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const isSwap = /\/swap$/.test(String(url));
    const body = isSwap ? jupSwapBody : jupQuoteBody;
    if (!body) return new Response(JSON.stringify({ error: 'no stub' }), { status: 500 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }));
}

const rpcCalls = () => calls.filter((c) => /rpc\.test\.invalid/.test(c.url));
const jupCalls = () => calls.filter((c) => /jup\.ag/.test(c.url));

describe('derived fee accounts — server/solanaJupFee.js on-chain discovery', () => {
  it('derives the payout wallet ATA — known answers pin the seed order', () => {
    expect(deriveFeeAta(USDC, FEE_ACCOUNT, TOKEN_PROGRAM)).toBe(USDC_ATA);
    expect(deriveFeeAta(SOL, FEE_ACCOUNT, TOKEN_PROGRAM)).toBe(SOL_ATA);
    /* The Token-2022 spelling is a DIFFERENT address: same wallet and mint,
       different token program. Mixing them up builds an account Jupiter
       cannot transfer the fee to, which fails the whole swap. */
    expect(deriveFeeAta(USDC, FEE_ACCOUNT, TOKEN_2022_PROGRAM)).not.toBe(USDC_ATA);
    /* Garbage never throws — it must come back unbuildable. */
    expect(deriveFeeAta('not-a-mint', FEE_ACCOUNT)).toBeNull();
  });

  it('discovers an initialized account the wallet already holds, and uses it', async () => {
    stubRpcThenJup((addr) => (addr === USDC_ATA ? liveTokenAccount(USDC, FEE_ACCOUNT, TOKEN_PROGRAM) : null));
    jupQuoteBody = paidQuote(70);

    expect(await refreshDerivedFeeAccount(USDC)).toBe(USDC_ATA);
    expect(derivedFeeAccounts()).toEqual({ [USDC]: USDC_ATA });
    /* The sync reader sees it — that is what the money path consults. */
    expect(jupFeeAccountFor(USDC, MEME)).toEqual({ mint: USDC, account: USDC_ATA });
    expect(jupFeeStatus({ inputMint: USDC, outputMint: MEME }).feeReady).toBe(true);
    expect(jupFeeStatus({ inputMint: USDC, outputMint: MEME }).configured).toBe(true);
    expect(jupFeeStatus({ inputMint: USDC, outputMint: MEME }).feeMints).toContain(USDC);

    /* One discovery, then the cache — the money path pays no RPC of its own. */
    const before = rpcCalls().length;
    const r = await jupFeeQuote({ inputMint: USDC, outputMint: MEME, amount: '1000000', slippageBps: 50 });
    expect(r.ok).toBe(true);
    expect(r.body.feeAccount).toBe(USDC_ATA);
    expect(r.body.feeApplied).toBe(true);
    expect(rpcCalls().length).toBe(before);
    expect(new URL(jupCalls()[0].url).searchParams.get('platformFeeBps')).toBe('70');
  });

  it('discovers the Token-2022 ATA when the classic one does not exist', async () => {
    const ata2022 = deriveFeeAta(USDC, FEE_ACCOUNT, TOKEN_2022_PROGRAM);
    stubRpcThenJup((addr) => (addr === ata2022 ? liveTokenAccount(USDC, FEE_ACCOUNT, TOKEN_2022_PROGRAM) : null));
    expect(await refreshDerivedFeeAccount(USDC)).toBe(ata2022);
  });

  it('never invents an account: a missing one stays unconfigured', async () => {
    stubRpcThenJup(() => null);
    expect(await refreshDerivedFeeAccount(MEME)).toBeNull();
    expect(jupFeeAccountFor(MEME, SOL)).toBeNull();
    const s = jupFeeStatus({ inputMint: MEME, outputMint: SOL });
    expect(s.feeReady).toBe(false);
    /* The pair the env map can still serve keeps serving it. */
    process.env.JUP_FEE_ACCOUNT = FEE_ACCOUNT;
    expect(jupFeeAccountFor(MEME, SOL)).toEqual({ mint: SOL, account: FEE_ACCOUNT });
  });

  it('degrades to "not configured" when every node fails — never to a broken swap', async () => {
    stubRpcThenJup(() => null, { rpcDown: true });
    expect(await refreshDerivedFeeAccount(USDC)).toBeNull();
    expect(jupFeeAccountFor(USDC, MEME)).toBeNull();
    expect(jupFeeStatus().configured).toBe(false);
  });

  it('prefers the input mint, and env always beats discovery', async () => {
    stubRpcThenJup((addr) => (addr === USDC_ATA ? liveTokenAccount(USDC, FEE_ACCOUNT, TOKEN_PROGRAM) : null));
    process.env.JUP_FEE_ACCOUNTS = JSON.stringify({ [SOL]: SOL_ATA });

    /* Input-side discovery wins over an output-side env account: the fee is
       taken from the input on an exact-in swap. */
    const pair = await refreshJupFeeCoverage({ inputMint: USDC, outputMint: SOL });
    expect(pair).toEqual({ mint: USDC, account: USDC_ATA });

    /* An input mint with nothing at all falls back to the env output account —
       and the env-covered side is never probed on-chain (discovery spends its
       round trips only where configuration is silent). */
    clearDerivedFeeAccounts();
    calls = [];
    const fallback = await refreshJupFeeCoverage({ inputMint: MEME, outputMint: SOL });
    expect(fallback).toEqual({ mint: SOL, account: SOL_ATA });
    expect(rpcCalls().some((c) => JSON.parse(c.init.body).params[0] === SOL_ATA)).toBe(false);
  });

  it('serves the pair from the cache through the async status, sync contract intact', async () => {
    stubRpcThenJup((addr) => (addr === USDC_ATA ? liveTokenAccount(USDC, FEE_ACCOUNT, TOKEN_PROGRAM) : null));
    jupQuoteBody = paidQuote(70);

    const s = await jupFeeStatusAsync({ inputMint: USDC, outputMint: MEME });
    expect(s.configured).toBe(true);
    expect(s.feeReady).toBe(true);
    expect(s.feeAccount ?? jupFeeAccountFor(USDC, MEME).account).toBe(USDC_ATA);

    /* The sync readers the rest of this suite pins still answer from a
       snapshot — no promise, no hidden fetch. */
    expect(typeof jupFeeStatus().configured).toBe('boolean');
    expect(jupFeeStatus().feeMints).toContain(USDC);
  });

  it('builds the swap with the derived account, whatever the caller sent', async () => {
    stubRpcThenJup((addr) => (addr === USDC_ATA ? liveTokenAccount(USDC, FEE_ACCOUNT, TOKEN_PROGRAM) : null));
    jupQuoteBody = paidQuote(70);
    jupSwapBody = { swapTransaction: 'SlVQVEVSVjFUWENPTVBPTkVOVA==', lastValidBlockHeight: 12345 };

    await refreshJupFeeCoverage({ inputMint: USDC, outputMint: MEME });
    const r = await jupFeeSwapQuote({
      inputMint: USDC,
      outputMint: MEME,
      amount: '1000000',
      account: WALLET,
      /* Hostile: a caller's own fee account must never reach upstream. */
      feeAccount: '11111111111111111111111111111112'
    });
    expect(r.ok).toBe(true);
    const sent = JSON.parse(jupCalls()[1].init.body);
    expect(sent.feeAccount).toBe(USDC_ATA);
  });

  it('the HTTP layer is wired to refresh before status, quote and swap', () => {
    const app = readFileSync(new URL('../server/app.js', import.meta.url), 'utf8');
    expect(app).toMatch(/jupfee\/status[\s\S]{0,120}jupFeeStatusAsync/);
    expect(app).toMatch(/refreshJupFeeCoverage\(req\.query/);
    expect(app).toMatch(/refreshJupFeeCoverage\(req\.body/);
    expect(app).toMatch(/jupfee:\s*await jupFeeStatusAsync\(pair\)/);
  });
});
