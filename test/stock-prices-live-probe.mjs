#!/usr/bin/env node
/**
 * LIVE ROBINHOOD STOCK-PRICE + TOKEN-LIST HEALTH PROBE
 * ---------------------------------------------------------------------------
 * Read-only end-to-end check against the public API and the live token universe.
 * It never writes to the chain and never invents or substitutes a price.
 *
 *   1. The live /api/stock-prices route answers named bad-input errors.
 *   2. The actual loadStockTokenUniverse() result is large enough and contains
 *      only Robinhood-chain rows, unique contract addresses and HTTPS artwork.
 *   3. The familiar, liquid NVDA and TSLA contracts selected FROM THAT RESULT
 *      have positive numeric prices; a genuinely unlisted address is null.
 *
 * A missing API server or an unreachable token-list network is SKIP (exit 77),
 * never PASS. A reachable server/list with a broken contract or missing price
 * is FAIL (exit 1). This distinction makes an offline developer machine honest
 * without turning upstream/data regressions into silent green checks.
 *
 * Run: node test/stock-prices-live-probe.mjs
 * Override the API origin with STOCK_PRICES_LIVE_BASE_URL.
 */

const BASE_URL = (process.env.STOCK_PRICES_LIVE_BASE_URL || process.env.BASE_URL || 'https://fbtswap.ir')
  .replace(/\/+$/, '');
const API_PATH = '/api/stock-prices';
const TIMEOUT_MS = 15_000;
const KNOWN_SYMBOLS = ['NVDA', 'TSLA'];
const PROBE_ADDRESS = `0x${'1'.repeat(40)}`;
const MIN_UNIVERSE_ROWS = 150;
const results = [];

class ProbeSkip extends Error {}

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
}

function endpoint(params) {
  const url = new URL(API_PATH, BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' }
      });
    } catch (error) {
      throw new ProbeSkip(`network/server unavailable at ${new URL(url).origin}: ${error?.message || error}`);
    }
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body, contentType: response.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

function logResults() {
  console.log(`\nRobinhood stock live probe — ${BASE_URL}`);
  for (const result of results) {
    const icon = result.ok ? '✓' : '✗';
    console.log(`  ${icon} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
  }
}

async function run() {
  /* Probe the route first. An unreachable host is a SKIP; a reachable host
     that serves a missing/broken route is a real failure. */
  let unsupported;
  try {
    unsupported = await getJson(endpoint({ chainId: '999999', addresses: PROBE_ADDRESS }));
  } catch (error) {
    if (error instanceof ProbeSkip) throw error;
    throw error;
  }
  const unsupportedOk = unsupported.status === 400 && unsupported.body?.error === 'UNSUPPORTED_CHAIN';
  check('live route returns named UNSUPPORTED_CHAIN for an unsupported chain', unsupportedOk,
    `HTTP ${unsupported.status}, error=${unsupported.body?.error ?? 'unreadable response'}`);
  if (!unsupportedOk) return;

  /* Node has no browser localStorage. Install a tiny private shim, then call
     the same loader the Stocks screen uses with refresh=true so this is fresh
     upstream evidence rather than a stale local cache. */
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    }
  });

  const realFetch = globalThis.fetch;
  let listStatus = null;
  let listFetchError = null;
  globalThis.fetch = async (input, init) => {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input?.url || String(input)); }
    catch { url = null; }
    if (url?.hostname === 'tokens.uniswap.org') {
      try {
        const response = await realFetch(input, init);
        listStatus = response.status;
        return response;
      } catch (error) {
        listFetchError = error;
        throw error;
      }
    }
    return realFetch(input, init);
  };

  let universe;
  try {
    const { loadStockTokenUniverse, ROBINHOOD_CHAIN_ID } = await import('../src/lib/stockTokens.js');
    universe = await loadStockTokenUniverse({ refresh: true, chainId: ROBINHOOD_CHAIN_ID });
  } finally {
    globalThis.fetch = realFetch;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  }

  if (listFetchError) {
    throw new ProbeSkip(`tokens.uniswap.org could not be reached: ${listFetchError?.message || listFetchError}`);
  }
  if (listStatus == null) {
    check('loadStockTokenUniverse made a fresh request to tokens.uniswap.org', false, 'no upstream response was observed');
    return;
  }
  if (listStatus >= 500 || listStatus === 429) {
    throw new ProbeSkip(`tokens.uniswap.org is temporarily unavailable (HTTP ${listStatus})`);
  }
  check('tokens.uniswap.org answered successfully', listStatus >= 200 && listStatus < 300, `HTTP ${listStatus}`);
  if (listStatus < 200 || listStatus >= 300) return;

  const rows = Array.isArray(universe) ? universe : [];
  check(`loaded universe has at least ${MIN_UNIVERSE_ROWS} rows`, rows.length >= MIN_UNIVERSE_ROWS,
    `${rows.length} rows`);
  check('every loaded universe row belongs to chainId 4663', rows.length > 0 && rows.every((row) => Number(row.chainId) === 4663),
    `${rows.filter((row) => Number(row.chainId) !== 4663).length} wrong-chain rows`);
  const addresses = rows.map((row) => String(row.address || '').toLowerCase());
  check('loaded universe has no duplicate contract addresses', addresses.length === new Set(addresses).size,
    `${addresses.length - new Set(addresses).size} duplicate(s)`);
  const badLogos = rows.filter((row) => row.logoURI != null && !/^https:\/\//i.test(String(row.logoURI)));
  check('loaded universe logos are HTTPS-only', badLogos.length === 0,
    `${badLogos.length} non-HTTPS logo(s)`);

  const equitiesBySymbol = new Map();
  for (const row of rows) {
    if (!row.equity) continue;
    const symbol = String(row.symbol || '').trim().toUpperCase();
    if (KNOWN_SYMBOLS.includes(symbol) && !equitiesBySymbol.has(symbol)) equitiesBySymbol.set(symbol, row);
  }
  const known = KNOWN_SYMBOLS.map((symbol) => equitiesBySymbol.get(symbol)).filter(Boolean);
  check('known liquid NVDA and TSLA contracts are present in the loaded universe', known.length === KNOWN_SYMBOLS.length,
    KNOWN_SYMBOLS.map((symbol) => `${symbol}:${equitiesBySymbol.has(symbol) ? 'found' : 'missing'}`).join(', '));
  if (known.length !== KNOWN_SYMBOLS.length) return;

  const listed = new Set(addresses);
  let unlistedAddress = null;
  for (let n = 1n; n < 10_000n; n += 1n) {
    const candidate = `0x${n.toString(16).padStart(40, '0')}`;
    if (!listed.has(candidate)) {
      unlistedAddress = candidate;
      break;
    }
  }
  check('a valid unlisted-address fixture was selected', Boolean(unlistedAddress));
  if (!unlistedAddress) return;

  const requestedAddresses = [...known.map((row) => row.address.toLowerCase()), unlistedAddress];
  let pricesResponse;
  try {
    pricesResponse = await getJson(endpoint({ chainId: '4663', addresses: requestedAddresses.join(',') }));
  } catch (error) {
    if (error instanceof ProbeSkip) throw error;
    throw error;
  }
  check('live price route returns HTTP 200 for chainId=4663', pricesResponse.status === 200,
    `HTTP ${pricesResponse.status}`);
  const prices = pricesResponse.body?.prices;
  check('live price response contains a prices object', Boolean(prices) && typeof prices === 'object' && !Array.isArray(prices));
  if (pricesResponse.status !== 200 || !prices || typeof prices !== 'object' || Array.isArray(prices)) return;
  check('live response identifies chainId 4663', Number(pricesResponse.body?.chainId) === 4663,
    `chainId=${pricesResponse.body?.chainId ?? 'missing'}`);

  for (const token of known) {
    const price = prices[String(token.address).toLowerCase()];
    const positive = typeof price?.price === 'number' && Number.isFinite(price.price) && price.price > 0;
    check(`${token.symbol} (${token.address}) has a positive numeric contract price`, positive,
      price == null ? 'null/unpriced' : `price=${String(price.price)}`);
  }
  check('an address absent from the loaded universe is explicitly null, never zero',
    Object.prototype.hasOwnProperty.call(prices, unlistedAddress) && prices[unlistedAddress] === null,
    `address=${unlistedAddress}, value=${JSON.stringify(prices[unlistedAddress])}`);

  let noAddresses;
  try {
    noAddresses = await getJson(endpoint({ chainId: '4663', addresses: 'not-an-address' }));
  } catch (error) {
    if (error instanceof ProbeSkip) throw error;
    throw error;
  }
  check('live route returns named NO_ADDRESSES for malformed addresses',
    noAddresses.status === 400 && noAddresses.body?.error === 'NO_ADDRESSES',
    `HTTP ${noAddresses.status}, error=${noAddresses.body?.error ?? 'unreadable response'}`);
}

try {
  await run();
} catch (error) {
  if (error instanceof ProbeSkip) {
    logResults();
    console.log(`  ⏭ SKIP — ${error.message}. This probe did not PASS.`);
    process.exitCode = 77;
  } else {
    check('probe completed without an unexpected exception', false, error?.stack || error?.message || String(error));
  }
}

if (process.exitCode !== 77) {
  logResults();
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    console.error(`  FAIL — ${failures.length}/${results.length} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS — all ${results.length} live checks passed.`);
    process.exitCode = 0;
  }
}
