/**
 * SOLANA PRICE PROBE — server half of «در سولنا اصلا قیمت نشان داده نمیشه»
 * ---------------------------------------------------------------------------
 * The Solana route now talks to De¹ Exchange (the rebranded OpenOcean) on the
 * enterprise gateway, because the old public host began answering our
 * datacenter egress with a Cloudflare interstitial instead of a quote — see
 * the header of server/solanaOcean.js for the live evidence. The v4 contract
 * itself is unchanged, so is the 70 bps fee (80% net to the fee wallet) that
 * De¹ splits inside the swap transaction.
 *
 * This probe (server side, real HTTP through server/app.js with the upstream
 * stubbed) proves:
 *
 *   1. Keyless status reports feeReady: true, solanaKeyRequired: false, and
 *      keyConfigured: false.
 *   2. Keyless quotes and swaps earn 70 bps out of the box with referrer and
 *      referrerFee=0.7 attached server-side (unforgeable from the browser).
 *   3. Upstream amount errors (e.g. too-small amounts) are cleanly distinguished
 *      as 400 BAD_AMOUNT rather than generic network/connectivity failures.
 *   4. Upstream whitelist/auth refusals (403/401) are passed through for
 *      the client's Jupiter fallback.
 *   5. OPENOCEAN_API_KEY is attached server-side — both as the x-api-key
 *      header and as the `apikey` query parameter the enterprise gateway
 *      authenticates on — and is never echoed back to a caller.
 *   5b. Every outgoing call goes to the enterprise host, so a silent revert
 *      to the challenged public domain fails the suite instead of the user.
 *   5c. THE ROOT LADDER (2026-10-22): no single host survives both outage
 *      kinds this route has seen (Cloudflare vs auth). When the enterprise
 *      root refuses for auth reasons ("No API key found", "Unauthorized",
 *      whitelist) or answers a Cloudflare interstitial, the quote falls
 *      through to the public root — keyed when a key exists, with exactly one
 *      keyless pass when a keyed attempt was auth-refused — and BAD_AMOUNT
 *      stops the ladder dead. OPENOCEAN_BASE_URL overrides the first root.
 *   6. /api/revenue/readiness reports swap-solana as live: true keylessly.
 *   7. The Jupiter proxy (insurance fallback) answers keyless and keyed.
 *
 * Standalone:
 *   node test/solana-price-probe.mjs
 * The shared runner (test/run.mjs) imports the default export of rows.
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
 *   'ok'         — a real quote/swap answer
 *   'bad-amount' — upstream amount-too-small error
 *   'reject-403' — HTTP 403 refusal
 *   'reject-401' — HTTP 401 refusal
 * `jup` decides what Jupiter answers: 'ok' (with taker → transaction).
 */
const OO_HOST = 'https://open-api-enterprise.de1.exchange/v4/solana';
const OO_PUBLIC_HOST = 'https://open-api.openocean.finance/v4/solana';
const OO_OVERRIDE_HOST = 'https://oo-proxy.example.test/v4/solana';

/**
 * The upstream weather. `ocean` decides what the enterprise gateway answers:
 *   'ok'         — a real quote/swap answer
 *   'bad-amount' — upstream amount-too-small error
 *   'reject-403' — HTTP 403 refusal (whitelist)
 *   'reject-401' — HTTP 401 refusal
 *   'auth-nokey' — "No API key found in request." (keyless gateway refusal)
 *   'auth-unauth'— "Unauthorized." (bad key)
 *   'cloudflare' — the Just-a-moment interstitial the public domain served
 * `publicOcean` decides the public root's answer; null means "mirror `ocean`",
 * which is how the single-host cases above stay honest in a two-host world.
 * `publicKeylessOk` makes the public root answer 'ok' whenever the request
 * carries NO key — the historical keyless-pays-referrer behaviour the ladder's
 * last-resort pass is built on. `jup` decides what Jupiter answers: 'ok'
 * (with taker → transaction).
 */
const weather = {
  ocean: 'ok',
  publicOcean: null,
  publicKeylessOk: false,
  expectedKey: null,
  jup: 'ok',
  oceanKeys: [],
  jupKeys: [],
  oceanUrls: [],
  oceanQueryKeys: []
};

const publicTries = () => weather.oceanUrls.filter((u) => u.startsWith(OO_PUBLIC_HOST)).length;
const keylessPublicTries = () =>
  weather.oceanUrls.filter((u, i) => u.startsWith(OO_PUBLIC_HOST) && weather.oceanKeys[i] == null).length;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

function ooAnswer(u, key, mode) {
  if (mode === 'ok') {
    if (weather.expectedKey && key !== weather.expectedKey) return json(403, { code: 403, message: 'bad key' });
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
  if (mode === 'bad-amount') {
    return json(200, { code: 500, message: 'amount is too small (minimum 10000 lamports)' });
  }
  if (mode === 'auth-nokey') return json(200, { error: 'No API key found in request.' });
  if (mode === 'auth-unauth') return json(401, { error: 'Unauthorized.' });
  if (mode === 'cloudflare') {
    return new Response('<!DOCTYPE html><html><title>Just a moment...</title></html>', {
      status: 503,
      headers: { 'content-type': 'text/html' }
    });
  }
  /* Upstream refusal pass-through */
  const code = mode === 'reject-401' ? 401 : 403;
  return json(code, { code, message: 'Solana is available only to whitelisted users' });
}

function installUpstreamStub() {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const h = init?.headers || {};
    const key = h['x-api-key'] ?? h['X-Api-Key'] ?? (h instanceof Headers ? h.get('x-api-key') : null);

    const isEnterprise = u.startsWith(OO_HOST);
    const isPublic = u.startsWith(OO_PUBLIC_HOST);
    const isOverride = u.startsWith(OO_OVERRIDE_HOST);
    if (isEnterprise || isPublic || isOverride) {
      weather.oceanKeys.push(key ?? null);
      weather.oceanUrls.push(u);
      weather.oceanQueryKeys.push(new URL(u).searchParams.get('apikey'));
      if (isOverride) return ooAnswer(u, key, weather.overrideOcean || 'ok');
      if (isPublic) {
        if (weather.publicKeylessOk && key == null) return ooAnswer(u, key, 'ok');
        return ooAnswer(u, key, weather.publicOcean ?? weather.ocean);
      }
      return ooAnswer(u, key, weather.ocean);
    }

    if (u.startsWith('https://api.jup.ag/swap/v2')) {
      weather.jupKeys.push(key ?? null);
      if (weather.jup !== 'ok') throw new Error('jupiter down');
      if (u.includes('/order')) {
        const hasTaker = u.includes('taker=');
        return json(200, {
          swapMode: 'ExactIn',
          inputMint: SOL,
          outputMint: USDC,
          inAmount: AMOUNT,
          outAmount: '264000000',
          otherAmountThreshold: '262500000',
          slippageBps: 50,
          priceImpactPct: '0.02%',
          router: 'metis',
          mode: 'manual',
          feeBps: 0,
          feeMint: SOL,
          transaction: hasTaker ? JUP_TX : null,
          taker: hasTaker ? WIFER : null,
          requestId: 'probe-request-123'
        });
      }
      if (u.includes('/execute')) {
        return json(200, { status: 'Success', code: 0, signature: '5probeSignature' });
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
  weather.oceanQueryKeys.length = 0;
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
    t('feeReady is true without a key (keyless fee supported)', body.feeReady === true);
    t('solanaKeyRequired is false (key is optional)', body.solanaKeyRequired === false);
    t('...and still reports the house rate', body.feeBps === 70);
  }

  /* ------------------ 2. keyless quote & swap (earns out of the box) ------------------ */
  weather.ocean = 'ok';
  weather.expectedKey = null;
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50`);
    const body = await res.json();
    t('a keyless quote answers 200', res.status === 200);
    t('the quote carries the price', body.outAmount === '265000000');
    t('...and the fee the route will take', body.feeBps === 70);
    t('the outgoing call carried no x-api-key', weather.oceanKeys.every((k) => k === null));
    t('...and no apikey query parameter either', weather.oceanQueryKeys.every((k) => k === null));
    t('the upstream is the De¹ enterprise gateway, not the challenged public host',
      weather.oceanUrls.length > 0 && weather.oceanUrls.every((u) => u.startsWith(OO_HOST)));
    t('and the fee fields our server owns (unforgeable from the browser)',
      weather.oceanUrls.some((u) => u.includes(`referrer=${WIFER}`) && u.includes('referrerFee=0.7')));
  }
  {
    const res = await fetch(`${base}/api/solana/oo/swap?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&account=${WIFER}&slippageBps=50`);
    const body = await res.json();
    t('a keyless swap builds the unsigned transaction', res.status === 200 && body.transaction === OCEAN_TX);
    t('...and the echo check confirms the fee was honoured', body.feeApplied === true);
    t('versioned is passed through for the right deserialiser', body.versioned === true);
  }

  /* ------------------ 3. amount error discrimination ------------------ */
  weather.ocean = 'bad-amount';
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}`);
    const body = await res.json();
    t('an upstream amount error returns 400 BAD_AMOUNT, not a connection failure', res.status === 400 && body.error === 'BAD_AMOUNT');
  }

  /* ------------------ 4. fallback resilience: whitelist refusal pass-through ------------------ */
  weather.ocean = 'reject-403';
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}`);
    const body = await res.json();
    t('a whitelist 403 refusal passes through as 403 for client fallback', res.status === 403);
    t('...with the upstream reason visible for debugging', /whitelisted/i.test(String(body.detail || body.message || '')));
  }
  {
    weather.ocean = 'reject-401';
    clearWeather();
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}`);
    t('...and the 401 refusal is passed through too', res.status === 401);
  }

  /* ------------------ 5. WITH OPTIONAL KEY: key is attached ------------------ */
  weather.ocean = 'ok';
  weather.expectedKey = 'probe-ocean-key';
  process.env.OPENOCEAN_API_KEY = 'probe-ocean-key';
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/status`);
    const body = await res.json();
    t('keyConfigured flips true the moment the key is set', body.keyConfigured === true);
    t('status names the upstream so a rollback is visible', body.endpoint === OO_HOST);
    t('feeReady stays true (key + receiver + rate)', body.feeReady === true);
  }
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50`);
    const body = await res.json();
    t('a keyed quote answers 200', res.status === 200);
    t('the quote carries the price', body.outAmount === '265000000');
    t('...and the fee the route will take', body.feeBps === 70);
    t('the outgoing call carried x-api-key', weather.oceanKeys.includes('probe-ocean-key'));
    t('...and the apikey query parameter the enterprise gateway reads',
      weather.oceanQueryKeys.includes('probe-ocean-key'));
    t('...still to the enterprise gateway', weather.oceanUrls.every((u) => u.startsWith(OO_HOST)));
    t('the quote body never echoes the key', !JSON.stringify(body).includes('probe-ocean-key'));
  }
  {
    const res = await fetch(`${base}/api/solana/oo/swap?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&account=${WIFER}&slippageBps=50`);
    const body = await res.json();
    t('a keyed swap builds the unsigned transaction', res.status === 200 && body.transaction === OCEAN_TX);
    t('...and the echo check confirms the fee was honoured', body.feeApplied === true);
  }
  {
    const res = await fetch(`${base}/api/solana/oo/status`);
    const raw = await res.text();
    t('no route echoes the key value', !raw.includes('probe-ocean-key'));
  }

  /* ---------------- 5c. THE ROOT LADDER ---------------- */
  /* A. Keyless: enterprise auth-refuses ("No API key found"), public answers
     keylessly — the documented historical behaviour the ladder restores. */
  delete process.env.OPENOCEAN_API_KEY;
  weather.expectedKey = null;
  weather.ocean = 'auth-nokey';
  weather.publicOcean = 'ok';
  weather.publicKeylessOk = false;
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50`);
    const body = await res.json();
    t('a keyless quote survives the enterprise "No API key found" refusal', res.status === 200 && body.outAmount === '265000000');
    t('...by falling through to the public root', publicTries() === 1);
    t('the public attempt carried no key at all', weather.oceanKeys.every((k) => k === null) && weather.oceanQueryKeys.every((k) => k === null));
    t('the fee fields ride in the path on every attempt', weather.oceanUrls.every((u) => u.includes(`referrer=${WIFER}`) && u.includes('referrerFee=0.7')));
  }

  /* B. Keyed: an "Unauthorized." on the enterprise root falls through to the
     public root WITH the key — every root is tried authenticated first. */
  process.env.OPENOCEAN_API_KEY = 'probe-ocean-key';
  weather.ocean = 'auth-unauth';
  weather.publicOcean = 'ok';
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50`);
    const body = await res.json();
    t('a keyed quote survives "Unauthorized." the same way', res.status === 200 && body.outAmount === '265000000');
    t('...and the public attempt still carries the key (header)', weather.oceanKeys.includes('probe-ocean-key'));
    t('...and the apikey query parameter', weather.oceanQueryKeys.includes('probe-ocean-key'));
  }

  /* C. Both keyed roots auth-refuse: exactly ONE keyless pass on public. */
  weather.ocean = 'auth-unauth';
  weather.publicOcean = 'auth-unauth';
  weather.publicKeylessOk = true;
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50`);
    const body = await res.json();
    t('with both keyed roots auth-refusing, the keyless public pass saves the quote', res.status === 200 && body.outAmount === '265000000');
    t('...and it is exactly one keyless pass, not a storm', publicTries() === 2 && keylessPublicTries() === 1);
  }

  /* D. BAD_AMOUNT is authoritative: the ladder stops dead. */
  weather.ocean = 'bad-amount';
  weather.publicOcean = 'ok';
  weather.publicKeylessOk = false;
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}`);
    const body = await res.json();
    t('BAD_AMOUNT stops the ladder: 400 with zero public attempts', res.status === 400 && body.error === 'BAD_AMOUNT' && publicTries() === 0);
  }

  /* E. The historical failure itself: a Cloudflare interstitial on one root
     falls through to the other instead of killing every Solana price. */
  weather.ocean = 'cloudflare';
  weather.publicOcean = 'ok';
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50`);
    const body = await res.json();
    t('a Cloudflare interstitial on the enterprise root falls through to public', res.status === 200 && body.outAmount === '265000000' && publicTries() === 1);
  }

  /* F. Status names the whole ladder in try-order. */
  {
    const res = await fetch(`${base}/api/solana/oo/status`);
    const body = await res.json();
    t('status lists both roots in try-order (enterprise first)', Array.isArray(body.roots) && body.roots[0] === OO_HOST && body.roots[1] === OO_PUBLIC_HOST);
  }

  /* G. OPENOCEAN_BASE_URL overrides the first root. */
  process.env.OPENOCEAN_BASE_URL = 'https://oo-proxy.example.test/v4';
  weather.overrideOcean = 'ok';
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/oo/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50`);
    const body = await res.json();
    t('OPENOCEAN_BASE_URL becomes the first root tried', res.status === 200 && body.outAmount === '265000000' && weather.oceanUrls.every((u) => u.startsWith(OO_OVERRIDE_HOST)));
    const st = await (await fetch(`${base}/api/solana/oo/status`)).json();
    t('...and status reports it first, ladder intact behind it', st.endpoint === OO_OVERRIDE_HOST && st.roots[0] === OO_OVERRIDE_HOST && st.roots[1] === OO_HOST && st.roots[2] === OO_PUBLIC_HOST);
  }
  delete process.env.OPENOCEAN_BASE_URL;
  delete process.env.OPENOCEAN_API_KEY;
  weather.publicOcean = null;
  weather.publicKeylessOk = false;

  /* ---------------- 6. the Jupiter fallback, keyless ---------------- */
  delete process.env.OPENOCEAN_API_KEY;
  clearWeather();
  {
    const res = await fetch(`${base}/api/solana/order?inputMint=${SOL}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50`);
    const body = await res.json();
    t('the Jupiter proxy still prices without a key', res.status === 200 && body.outAmount === '264000000');
    t('...price-only when no taker (nothing signable)', body.transaction === null && typeof body.requestId === 'string');
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

  /* ---------------- 7. revenue readiness ---------------- */
  {
    const res = await fetch(`${base}/api/revenue/readiness`);
    const body = await res.json();
    const row = body.lines?.find((l) => l.id === 'swap-solana');
    t('revenue readiness reports the swap-solana line', Boolean(row));
    t('...and it is earning (live: true) keylessly', row && row.live === true);
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
