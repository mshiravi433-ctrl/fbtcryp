/**
 * SOLANA PRICE PROBE — server half of «در سولنا اصلا قیمت نشان داده نمیشه»
 * ---------------------------------------------------------------------------
 * Reported 2026-08: every Solana quote failed with «اتصال به سرویس
 * قیمت‌گذاری برقرار نشد», on every user network, no matter how often the
 * screen was refreshed. The user's network was not the cause: OpenOcean's
 * Solana endpoint moved behind a whitelist, so the SERVER's keyless calls
 * were rejected and the client — correctly — read the 4xx/5xx as a
 * connectivity problem.
 *
 * This probe (server side, real HTTP through server/app.js with the upstream
 * stubbed) proves:
 *
 *   1. The whitelist refusal is passed through verbatim (403/401), never
 *      turned into a fake 200 — that pass-through is what the client turns
 *      into QUOTE_NETWORK, and the client half of the story is locked in
 *      test/solana-client-probe.mjs.
 *   2. OPENOCEAN_API_KEY is attached server-side (x-api-key) the moment it
 *      is configured, the fee fields travel unforgeable, and the key value
 *      is never echoed by any route.
 *   3. /api/solana/oo/status reports keyConfigured/feeReady honestly, and
 *      /api/revenue/readiness does not claim a fee the keyless deploy is not
 *      taking.
 *   4. The Jupiter proxy (the fallback that keeps prices alive) answers
 *      keyless and attaches JUPITER_API_KEY when configured.
 *
 * Standalone:
 *   node test/solana-price-probe.mjs
 * The shared runner (test/run.mjs) imports the default export of rows.
 *
 * The fetch stub is installed ONLY around this file's own requests and
 * always restored — other probes in the shared process keep global fetch.
 */

import { pathToFileURL } from 'node:url';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WIFER = 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4';
const AMOUNT = '1000000000'; // 1 SOL in base units
const OCEAN_TX = 'T1BFTk9DRVBNV1BBTlM=';
const JUP_TX = 'SklQRU9SREVSQVQ=';

const previousOceanKey = process.env.OPENOCEAN_API_KEY;
const previousJupKey = process.env.JUPITER_API_KEY;
const realFetch = globalThis.fetch;

/**
 * The upstream weather. `ocean` decides what OpenOcean answers for Solana:
 *   'reject-403' — the whitelist refusal, HTTP 403 (what the live service
 *                  does for a keyless caller)
 *   'reject-401' — the same refusal as an HTTP 401 variant
 *   'ok'         — a real quote/swap answer, but ONLY when the request
 *                  carries the expected x-api-key
 * `jup` decides what Jupiter answers: 'ok' (with taker → transaction).
 */
const weather = {
  ocean: 'reject-403',
  expectedKey: null,
  jup: 'ok',
  oceanKeys: [],
  jupKeys: [],
  oceanUrls: []
};

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

function installUpstreamStub() {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const h = init?.headers || {};
    const key = h['x-api-key'] ?? h['X-Api-Key'] ?? (h instanceof Headers ? h.get('x-api-key') : null);

    if (u.startsWith('https://open-api.openocean.finance/v4/solana')) {
      weather.oceanKeys.push(key ?? null);
      weather.oceanUrls.push(u);
      if (weather.ocean === 'ok') {
        if (key !== weather.expectedKey) return json(403, { code: 403, message: 'bad key' });
        if (u.includes('/swap?')) {
          return json(200, {
            code: 200,
            data: {
              data: OCEAN_TX,
              feeRatio: 0.007,
              isVersioned: true,
              inAmount: AMOUNT,
              outAmount: '265000000',
              minOutAmount: '263500000'
            }
          });
        }
        return json(200, {
          code: 200,
          data: {
            inToken: { symbol: 'SOL', decimals: 9, usd: '180.1', volume: 1 },
            outToken: { symbol: 'USDC', decimals: 6, usd: '1', volume: 1 },
            inAmount: AMOUNT,
            outAmount: '265000000',
            minOutAmount: '263500000',
            price_impact: '0.01%'
          }
        });
      }
      /* The whitelist refusal, verbatim: a 403/401 whose body carries its
         own code. The server must NOT convert this into a 200. */
      const code = weather.ocean === 'reject-401' ? 401 : 403;
      return json(code, { code, message: 'Solana is available only to whitelisted users' });
    }

    if (u.startsWith('https://api.jup.ag/swap/v2')) {
      weather.jupKeys.push(key ?? null);
      if (weather.jup !== 'ok') throw new Error('jupiter down');
      if (u.includes('/order')) {
        const hasTaker = u.includes('taker=');
        return json(200, {
          quote: {
            inputMint: SOL,
            inAmount: AMOUNT,
            outputMint: USDC,
            outAmount: '264000000',
            otherAmountThreshold: '262500000',
            swapMode: 'ExactIn',
            slippageBps: 50,
            priceImpactPct: '0.02%'
          },
          /* Without a taker: price only, nothing signable comes back. */
          transaction: hasTaker ? JUP_TX : '',
          userAccount: hasTaker ? 'taker-present' : null,
          requestId: hasTaker ? 'probe-request-123' : null
        });
      }
      if (u.includes('/execute')) {
        return json(200, { status: 'Success', code: 0, transaction: '5probeSignature' });
      }
      return json(404, { error: 'unknown jupiter path' });
    }

    return realFetch(url, init);
  };
}

function clearWeather() {
  weather.oceanKeys.length = 0;
  weather.jupKeys.length = 0;
  weather.oceanUrls.length = 0;
}

let server = null;
try {
  installUpstreamStub();
  const { default: app } = await import('../server/app.js');
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  /* ------------------ 1. honest status, no key ------------------ */
  delete process.env.OPENOCEAN_API_KEY;
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/status`);
    const body = await res.json();
    t('status answers without a key', res.status === 200);
    t('keyConfigured is false without the key', body.keyConfigured === false);
    t('feeReady is false without the key (the fee cannot earn)', body.feeReady === false);
    t('the status names the Solana key requirement', body.solanaKeyRequired === true);
    t('...and still reports the house rate', body.feeBps === 70);
  }

  /*
   * 2. THE REPORTED FAILURE, REPRODUCED: keyless, upstream refuses. The
   *    route must pass the refusal through (403), not answer 200 — that
   *    pass-through is what the client turns into QUOTE_NETWORK.
   */
  weather.ocean = 'reject-403';
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}`);
    const body = await res.json();
    t('a keyless quote passes the whitelist 403 through, not a fake 200', res.status === 403);
    t('...with the upstream reason visible for debugging', /whitelisted/i.test(String(body.detail || body.message || '')));
    t('the server did not invent an x-api-key', weather.oceanKeys.every((k) => k === null));
  }
  {
    weather.ocean = 'reject-401';
    clearWeather();
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}`);
    t('...and the 401 refusal is passed through too', res.status === 401);
  }

  /* ------------- 3. WITH THE KEY: the route earns again ------------- */
  weather.ocean = 'ok';
  weather.expectedKey = 'probe-ocean-key';
  process.env.OPENOCEAN_API_KEY = 'probe-ocean-key';
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/status`);
    const body = await res.json();
    t('keyConfigured flips true the moment the key is set', body.keyConfigured === true);
    t('feeReady flips true (key + receiver + rate)', body.feeReady === true);
  }
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50`);
    const body = await res.json();
    t('a keyed quote answers 200', res.status === 200);
    t('the quote carries the price', body.outAmount === '265000000');
    t('...and the fee the route will take', body.feeBps === 70);
    t('the outgoing call carried x-api-key', weather.oceanKeys.includes('probe-ocean-key'));
    t('and the fee fields our server owns (unforgeable from the browser)',
      weather.oceanUrls.some((u) => u.includes(`referrer=${WIFER}`) && u.includes('referrerFee=0.7')));
  }
  {
    const res = await fetch(`${base}/api/solana/oo/swap?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&account=${WIFER}&slippageBps=50`);
    const body = await res.json();
    t('a keyed swap builds the unsigned transaction', res.status === 200 && body.transaction === OCEAN_TX);
    t('...and the echo check confirms the fee was honoured', body.feeApplied === true);
    t('versioned is passed through for the right deserialiser', body.versioned === true);
  }
  {
    const res = await fetch(`${base}/api/solana/oo/status`);
    const raw = await res.text();
    t('no route echoes the key value', !raw.includes('probe-ocean-key'));
  }

  /* ---------------- 4. the Jupiter fallback, keyless ---------------- */
  delete process.env.OPENOCEAN_API_KEY;
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/order?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50`);
    const body = await res.json();
    t('the Jupiter proxy still prices without a key', res.status === 200 && body.quote?.outAmount === '264000000');
    t('...price-only when no taker (nothing signable)', body.transaction === '' && body.requestId === null);
    t('and it did not send a Jupiter key we do not have', weather.jupKeys.every((k) => k === null));
  }
  {
    const res = await fetch(`${base}/api/solana/order?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&taker=${WIFER}&slippageBps=50`);
    const body = await res.json();
    t('with a taker it returns the signable transaction + requestId', res.status === 200 && body.transaction === JUP_TX && body.requestId === 'probe-request-123');
  }
  {
    process.env.JUPITER_API_KEY = 'probe-jup-key';
    clearWeather();
    const res = await fetch(`${base}/api/solana/order?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}`);
    t('a configured Jupiter key is attached server-side', res.status === 200 && weather.jupKeys.includes('probe-jup-key'));
    delete process.env.JUPITER_API_KEY;
  }

  /* The readiness line must not claim a fee it is not taking. */
  {
    const res = await fetch(`${base}/api/revenue/readiness`);
    const body = await res.json();
    const row = body.lines?.find((l) => l.id === 'swap-solana');
    t('revenue readiness reports the swap-solana line', Boolean(row));
    t('...and it is not "earning" without the key', row && row.live === false);
    t('...while naming the fallback that keeps the swap alive', row && /jupiter fallback/i.test(row.note));
  }
} finally {
  if (server) server.close();
  globalThis.fetch = realFetch;
  if (previousOceanKey === undefined) delete process.env.OPENOCEAN_API_KEY;
  else process.env.OPENOCEAN_API_KEY = previousOceanKey;
  if (previousJupKey === undefined) delete process.env.JUPITER_API_KEY;
  else process.env.JUPITER_API_KEY = previousJupKey;
}

export default rows;

/* Standalone: print the table, exit non-zero on failure. */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  for (const [name, ok] of rows) {
    if (!ok) process.exitCode = 1;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
}
