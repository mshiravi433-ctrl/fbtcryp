/**
 * SOLANA CLIENT PROBE — client half of «در سولنا اصلا قیمت نشان داده نمیشه»
 * ---------------------------------------------------------------------------
 * The server half (test/solana-price-probe.mjs) proves the routes; this one
 * runs the REAL client modules — src/lib/solanaOcean.js and
 * src/lib/solana.js — against stubbed responses shaped EXACTLY like what
 * those routes answer, and locks the error semantics the SolanaSwap page
 * depends on:
 *
 *   • every gateway-level failure of our backend (401/403/404/429/5xx,
 *     timeout, DNS) is tagged err.network = true — which the quote effect
 *     renders as QUOTE_NETWORK and, more importantly, treats as "try the
 *     other provider", never as "this pair is untradeable";
 *   • a genuine answer (400 BAD_AMOUNT, a Jupiter errorCode) is NOT a
 *     network problem, and does not fall back to the public endpoint;
 *   • the keyless public Jupiter fallback is the last resort, and it sends
 *     no fee fields the caller could forge.
 *
 * Bundled with Vite (test/vite.solana-client.mjs) because these modules use
 * extensionless specifiers and import.meta.env, which plain Node does not
 * resolve. Standalone:
 *   npx vite build -c test/vite.solana-client.mjs --logLevel error \
 *     && node test/.out/solana-client/solana-client-probe.js
 */

import { pathToFileURL } from 'node:url';
import { getOceanQuote } from '../src/lib/solanaOcean.js';
import { getSolanaOrder, executeSolanaOrder, executeSucceeded } from '../src/lib/solana.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AMOUNT = '1000000000';

const realFetch = globalThis.fetch;
const calls = [];

/**
 * `route` answers our own /api/... paths; `upstream` answers api.jup.ag.
 * Each is (url, init) => Response | never (throw to simulate a stall).
 */
let route = async () => new Response('unstubbed', { status: 500 });
let upstream = async () => new Response('unstubbed', { status: 500 });

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push(u);
  if (u.startsWith('/api/')) return route(u, init);
  if (u.startsWith('https://api.jup.ag/swap/v2')) return upstream(u, init);
  return realFetch(url, init);
};

const last = (prefix) => [...calls].reverse().find((u) => u.startsWith(prefix)) ?? null;

async function throws(fn) {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { err: e };
  }
}

try {
  /* ------------- 1. the whitelist refusal, as the client sees it ------------- */
  {
    route = async () => json(403, { error: 'UPSTREAM_FAILED', detail: 'Solana is available only to whitelisted users' });
    const { err } = await throws(() => getOceanQuote({ inputMint: SOL, outputMint: USDC, amount: AMOUNT, slippageBps: 50 }));
    t('a 403 whitelist refusal is a NETWORK problem (→ QUOTE_NETWORK, → fallback)', err?.network === true);
    t('...and keeps the status for diagnosis', err?.status === 403);
  }
  {
    route = async () => json(401, { error: 'UPSTREAM_FAILED', detail: 'unauthorized' });
    const { err } = await throws(() => getOceanQuote({ inputMint: SOL, outputMint: USDC, amount: AMOUNT, slippageBps: 50 }));
    t('a 401 refusal is a network problem too (added with the whitelist fix)', err?.network === true && err?.status === 401);
  }
  {
    route = async () => json(404, { error: 'NOT_FOUND' });
    const { err } = await throws(() => getOceanQuote({ inputMint: SOL, outputMint: USDC, amount: AMOUNT, slippageBps: 50 }));
    t('a missing route (stale deploy, no-API build) is a network problem', err?.network === true && err?.status === 404);
  }
  {
    route = async () => json(429, { error: 'RATE_LIMITED' });
    const { err } = await throws(() => getOceanQuote({ inputMint: SOL, outputMint: USDC, amount: AMOUNT, slippageBps: 50 }));
    t('a 429 from our own gateway is a network problem', err?.network === true);
  }
  {
    route = async () => json(502, { error: 'UPSTREAM_FAILED', detail: 'bad gateway' });
    const { err } = await throws(() => getOceanQuote({ inputMint: SOL, outputMint: USDC, amount: AMOUNT, slippageBps: 50 }));
    t('a 502 upstream failure is a network problem', err?.network === true);
  }
  {
    /* The 15-second deadline: the client aborts and tags it as network. */
    route = async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    };
    const { err } = await throws(() => getOceanQuote({ inputMint: SOL, outputMint: USDC, amount: AMOUNT, slippageBps: 50 }));
    t('a timeout (AbortError) becomes QUOTE_NETWORK, not a hang', err?.network === true && err?.message === 'QUOTE_NETWORK');
  }
  {
    route = async () => {
      throw new TypeError('fetch failed');
    };
    const { err } = await throws(() => getOceanQuote({ inputMint: SOL, outputMint: USDC, amount: AMOUNT, slippageBps: 50 }));
    t('DNS/refused (TypeError) is a network problem', err?.network === true);
  }
  {
    route = async () => json(200, {
      inAmount: AMOUNT,
      outAmount: '265000000',
      minOutAmount: '263500000',
      priceImpact: '0.01%',
      feeBps: 70,
      feeReceiver: 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4'
    });
    const { ok } = await throws(() => getOceanQuote({ inputMint: SOL, outputMint: USDC, amount: AMOUNT, slippageBps: 50 }));
    t('a good OpenOcean quote resolves with the price', ok?.outAmount === '265000000');
  }

  /* ----------------- 2. the Jupiter fallback (getSolanaOrder) ----------------- */
  {
    const jup = {
      quote: {
        inputMint: SOL, inAmount: AMOUNT, outputMint: USDC, outAmount: '264000000',
        otherAmountThreshold: '262500000', swapMode: 'ExactIn', slippageBps: 50,
        priceImpactPct: '0.02%'
      },
      transaction: '',
      userAccount: null,
      requestId: null
    };
    route = async () => json(200, jup);
    calls.length = 0;
    const { ok, err } = await throws(() => getSolanaOrder({ inputMint: SOL, outputMint: USDC, amount: AMOUNT, slippageBps: 50 }));
    t('the backend Jupiter answer is used directly (price only, nothing signable)', !err && ok?.quote?.outAmount === '264000000' && ok?.transaction === '');
    t('...via OUR api, key stays server-side', last('/api/solana/order') !== null && last('https://api.jup.ag') === null);
  }
  {
    /* The backend is down: the keyless public endpoint is the last resort. */
    route = async () => json(500, { error: 'UPSTREAM_FAILED' });
    const jup = {
      quote: {
        inputMint: SOL, inAmount: AMOUNT, outputMint: USDC, outAmount: '264000000',
        otherAmountThreshold: '262500000', swapMode: 'ExactIn', slippageBps: 50,
        priceImpactPct: '0.02%'
      },
      transaction: '',
      userAccount: null,
      requestId: null
    };
    upstream = async (u) => {
      t('the fallback sends no fee fields the caller could forge', !u.includes('referralAccount') && !u.includes('referralFee'));
      return json(200, jup);
    };
    calls.length = 0;
    const { ok, err } = await throws(() => getSolanaOrder({ inputMint: SOL, outputMint: USDC, amount: AMOUNT, slippageBps: 50 }));
    t('a 5xx backend falls back to the public Jupiter endpoint', !err && ok?.quote?.outAmount === '264000000');
    t('...and the public endpoint is the one that answered', last('https://api.jup.ag/swap/v2/order') !== null);
  }
  {
    /* A 400 is a real answer (bad input) — falling back would hide it. */
    route = async () => json(400, { error: 'BAD_AMOUNT' });
    upstream = async () => {
      t('a 400 from our backend must NOT be masked by the fallback', false);
      return json(200, {});
    };
    calls.length = 0;
    const { err } = await throws(() => getSolanaOrder({ inputMint: SOL, outputMint: USDC, amount: AMOUNT, slippageBps: 50 }));
    t('a 400 BAD_AMOUNT rethrows as the real answer', err?.message === 'BAD_AMOUNT');
    t('...without touching the public endpoint', last('https://api.jup.ag') === null);
  }
  {
    route = async () => json(200, {
      quote: {
        inputMint: SOL, inAmount: AMOUNT, outputMint: USDC, outAmount: '264000000',
        otherAmountThreshold: '262500000', swapMode: 'ExactIn', slippageBps: 50,
        priceImpactPct: '0.02%'
      },
      transaction: 'SklQRU9SREVSQVQ=',
      userAccount: 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4',
      requestId: 'probe-request-123'
    });
    const { ok, err } = await throws(() => getSolanaOrder({
      inputMint: SOL, outputMint: USDC, amount: AMOUNT,
      taker: 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4',
      slippageBps: 50
    }));
    t('with a taker the client gets the signable transaction + requestId', !err && ok?.transaction === 'SklQRU9SREVSQVQ=' && ok?.requestId === 'probe-request-123');
  }
  {
    /* The failure shape the page maps with orderErrorKey(). */
    route = async () => json(200, { transaction: '', errorCode: 2, router: 'jupiterz' });
    const { ok, err } = await throws(() => getSolanaOrder({
      inputMint: SOL, outputMint: USDC, amount: AMOUNT,
      taker: 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4',
      slippageBps: 50
    }));
    t('a failed build comes back as transaction:"" + errorCode (not a crash)', !err && ok?.transaction === '' && ok?.errorCode === 2);
  }

  /* ---------------------- 3. execution is success-checked ---------------------- */
  {
    route = async () => json(200, { status: 'Success', code: 0, transaction: '5probeSignature' });
    const exec = await executeSolanaOrder({ signedTransaction: 'U0lHTkVE', requestId: 'probe-request-123' });
    t('a successful /execute is recognized by executeSucceeded', executeSucceeded(exec) === true);
    t('...and the signature is the chain\'s, not a guess', exec?.transaction === '5probeSignature');
  }
  {
    route = async () => json(200, { status: 'Failed', code: 1, transaction: '' });
    const exec = await executeSolanaOrder({ signedTransaction: 'U0lHTkVE', requestId: 'probe-request-123' });
    t('a failed /execute is NOT treated as success (no fake signature)', executeSucceeded(exec) === false);
  }
  {
    route = async () => json(500, { error: 'UPSTREAM_FAILED' });
    upstream = async () => json(200, { status: 'Success', code: 0, transaction: '5probeSignature' });
    const exec = await executeSolanaOrder({ signedTransaction: 'U0lHTkVE', requestId: 'probe-request-123' });
    t('execution falls back to the public endpoint like quotes do', executeSucceeded(exec) === true);
  }
} finally {
  globalThis.fetch = realFetch;
}

export default rows;

/* Standalone: print the table, exit non-zero on failure. */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  for (const [name, ok] of rows) {
    if (!ok) process.exitCode = 1;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
}
