#!/usr/bin/env node
/**
 * SOLANA ASSETS — THE BATCHED UPSTREAM FETCH.
 * ---------------------------------------------------------------------------
 * `fetchSolanaAssets()` used to issue ONE HTTP REQUEST PER CURATED MINT. The
 * curated list is the whole tradeable xStock set, so that fan-out is the thing
 * standing between a growing list and a fast screen.
 *
 * Jupiter's search endpoint accepts a comma-separated list of MINT ADDRESSES —
 * "Comma-separate to ONLY search for multiple mint addresses / limit to 100
 * mint addresses in query" (Tokens API reference, get /search) — so every
 * curated asset is now resolved in ONE request (chunked only past 100).
 *
 * This probe stubs `globalThis.fetch` (which is why it runs as its own process,
 * never imported into the shared runner's process) and pins:
 *
 *   1. the whole curated list travels in ONE upstream call;
 *   2. that call names MINT ADDRESSES, never a symbol — the property that makes
 *      impersonation impossible at the fetch step;
 *   3. the issuer authority is still compared per asset, so a mismatched record
 *      is dropped AND named in `rejected` (fails closed, not silently);
 *   4. a failed batch degrades to `fetchFailed` for exactly those mints rather
 *      than throwing away the response;
 *   5. a list longer than Jupiter's 100-mint ceiling is chunked, not truncated.
 *
 * Standalone: node test/solana-assets-batch-probe.mjs
 */

import { COMMODITY_ASSETS, EQUITY_ASSETS, LST_ASSETS } from '../src/lib/solanaAssets.js';
import { fetchSolanaAssets, mintBatches } from '../server/solanaAssets.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const CURATED = [...LST_ASSETS.map((a) => ({ a, kind: 'lst' })),
  ...EQUITY_ASSETS.map((a) => ({ a, kind: 'equity' })),
  ...COMMODITY_ASSETS.map((a) => ({ a, kind: 'commodity' }))];

/** A live-looking record for a curated asset, with a controllable authority. */
const recordFor = ({ a, kind }, { clampAuthority = false } = {}) => ({
  id: a.mint,
  name: `${a.symbol} live`,
  symbol: a.symbol,
  decimals: a.decimals,
  usdPrice: 100,
  liquidity: 500_000,
  holderCount: 1_000,
  isVerified: true,
  mintAuthority: clampAuthority ? 'CLONE000000000000000000000000000000000000' : (kind === 'commodity' ? a.mintAuthority : '7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj'),
  freezeAuthority: clampAuthority ? 'CLONE000000000000000000000000000000000000' : (kind === 'commodity' ? a.freezeAuthority : 'JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs'),
  stats24h: { priceChange: 1 }
});

const originalFetch = globalThis.fetch;

/* ---- 1 · the whole list in one request, by mint address ---------------- */
{
  const calls = [];
  /* An EQUITY, deliberately: an LST is accepted on `isVerified` alone (it has
     no Backed-style issuer to compare), so clamping its authority would prove
     nothing about the check under test. */
  const mismatched = CURATED.find((c) => c.kind === 'equity');
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const mints = decodeURIComponent(String(url).split('query=')[1] ?? '').split(',');
    const body = mints
      .map((mint) => CURATED.find((c) => c.a.mint === mint))
      .filter(Boolean)
      .map((c) => recordFor(c, { clampAuthority: c.a.mint === mismatched.a.mint }));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const payload = await fetchSolanaAssets();
  globalThis.fetch = originalFetch;

  t('the curated list resolves in ONE upstream request', calls.length === 1);
  t('...and the mints travel as a mint list, never as a symbol', (() => {
    const query = decodeURIComponent(calls[0]?.split('query=')[1] ?? '');
    const parts = query.split(',');
    return parts.length === CURATED.length && parts.every((p) => p.length >= 32);
  })());
  t('every curated symbol comes back',
    payload.equities.length + payload.lst.length + payload.commodities.length === CURATED.length - 1);
  t('a record whose issuer authority does not match is dropped',
    !payload.equities.some((e) => e.id === mismatched.a.mint));
  t('...and the drop is named, not silent',
    payload.rejected.some((r) => r.symbol === mismatched.a.symbol && r.why === 'issuerMismatch'));
}

/* ---- 2 · an upstream failure costs the batch, not the response --------- */
{
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    /* Both the first attempt and the retry fail. */
    throw new Error('ECONNRESET');
  };
  const payload = await fetchSolanaAssets();
  globalThis.fetch = originalFetch;

  t('a dead upstream does not throw out of the fetcher', Boolean(payload && payload.at));
  t('...every affected mint is reported as fetchFailed',
    payload.rejected.length === CURATED.length && payload.rejected.every((r) => r.why === 'fetchFailed'));
  t('...and the batch was retried once before giving up', call === 2);
}

/* ---- 3 · a list longer than Jupiter's ceiling is chunked --------------- */
{
  const many = Array.from({ length: 250 }, (_, i) => `Mint${String(i).padStart(30, '0')}`.replace(/[^1-9A-HJ-NP-Za-km-z]/g, 'A'));
  const batches = mintBatches(many);
  t('250 mints are split into requests of at most 100', batches.length === 3 && batches.every((b) => b.length <= 100));
  t('chunking does not duplicate a mint', batches.flat().length === new Set(batches.flat()).size);
  t('duplicates are collapsed before a request is built', mintBatches([many[0], many[0], many[1]]).flat().length === 2);
}

const failed = rows.filter(([, ok]) => !ok);
for (const [name, ok] of rows) console.log(`${ok ? '✓' : '✗'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} of ${rows.length} assertions failed`);
  process.exit(1);
}
console.log(`\n✓ solana assets (batched upstream) — ${rows.length} assertions passed`);
