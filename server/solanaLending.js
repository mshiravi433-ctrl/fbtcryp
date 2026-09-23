/**
 * SOLANA LENDING, SERVER SIDE — the second door for the Kamino market.
 * ============================================================================
 *
 * WHY THIS EXISTS (report 2026-09-23, third round: «در وام تب سولنا بهم خورده
 * دوباره» — the loan page's Solana tab is broken again)
 * ---------------------------------------------------------------------------
 * The Solana half of the loan page had ONE way to see the market: the vendored
 * Kamino SDK, in the browser, against a public Solana node, over the user's own
 * network path. The reported path refused everything —
 *
 *   solana.leorpc.com          → could not connect
 *   solana-rpc.publicnode.com  → HTTP 403
 *   rpc.magicblock.app         → HTTP 403
 *   api.mainnet(-beta).solana.com → HTTP 403
 *   rpc.solanatracker.io, solana.drpc.org → 200 with a body the SDK could not use
 *   solana.api.onfinality.io   → HTTP 429
 *   our own read-only relay    → answered, and its answer was «no node behind me
 *                                served this call»
 *
 * A 403 is a decision about the CALLER — IP, provider, region — so no ordering,
 * retry or cooldown inside a browser changes it. What changes it is WHO ASKS.
 * This module asks from a datacentre that those nodes do serve, and it is not a
 * new idea in this repo: server/solana.js already prices Solana swaps for the
 * same devices, and server/solanaChainReads.js already reads balances for
 * wallets whose own phones cannot («the quote arrived through this server, so a
 * device that can price a swap can also read a balance through us»).
 *
 * WHAT IT SERVES
 * --------------
 *   GET  /api/lending/solana/market?wallet=…  the market snapshot, serialized by
 *                                             the SAME function the browser door
 *                                             uses (serializeKaminoMarket in
 *                                             src/lib/solanaLending.js) — two
 *                                             doors, one shape, no drift.
 *   POST /api/lending/solana/transaction      UNSIGNED transactions, base64.
 *   GET  /api/lending/solana/transaction/:sig did it land?
 *   GET  /api/lending/solana/status           diagnostics, no credentials.
 *
 * WHAT IT IS NOT
 * --------------
 *   · NOT a custodian, NOT a signer, NOT a broadcaster. §30 is the whole reason
 *     the POST returns bytes: the user's wallet signs them and the wallet's own
 *     node sends them. No key is read here, no transaction leaves this server,
 *     and `sendTransaction` is not called anywhere in this file.
 *   · NOT an open proxy. There is no `url` parameter; the upstream list lives
 *     here (shared with server/solanaRpcRelay.js) and in the environment.
 *   · NOT a stale cache presented as live. Answers are cached for seconds and
 *     every response says where it came from and when it was read.
 *
 * ─── THE ONE CALL FREE NODES REFUSE, AND HOW THIS ROUTES AROUND IT ──────────
 * `KaminoMarket.load()` enumerates the market's reserves with
 * `getProgramAccounts(KLend, [dataSize 8624, memcmp market])` — ~130 accounts of
 * 8 624 bytes, i.e. a ~1.6 MB base64 answer. That is the single most-refused
 * call on every free tier (blocked outright, or answered with a size error), and
 * it is why the browser door's relay candidate came back with «no node answered
 * this relay»: the cheap calls were served and the expensive one was not.
 *
 * So the fallback here does not need that call at all:
 *
 *   1. `getProgramAccounts` WITH `dataSlice { offset: 0, length: 0 }` — the same
 *      filters, zero bytes of account data, so the answer is ~130 pubkeys
 *      instead of 1.6 MB. Nodes that refuse the big response serve this one.
 *   2. the account data itself in chunks of 25 through `getMultipleAccounts`
 *      (~290 KB per chunk) — the method every free tier allows.
 *   3. the pubkeys are remembered (memory, then a best-effort file under the
 *      OS temp dir) for hours, because a reserve list changes when Kamino lists
 *      an asset, not every minute. After the first success the enumeration never
 *      needs `getProgramAccounts` again, in either shape.
 *
 * Everything downstream is the SDK's own code — `Reserve.decode`,
 * `getTokenOracleData`, `KaminoReserve.initialize`, `KaminoMarket.loadWithReserves`
 * — copied from what `getReservesForMarket()` does internally, so the numbers are
 * the numbers Kamino's own SDK produces, not a parallel implementation of them.
 * A reserve whose oracle cannot be read is SKIPPED and counted (§28: a partial
 * read is labelled, never dressed as a complete one).
 */

import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Connection, PublicKey } from '@solana/web3.js';
import { relayUpstreams, redactUpstream } from './solanaRpcRelay.js';
import {
  KAMINO_MAIN_MARKET,
  KAMINO_LENDING_PROGRAM,
  SOLANA_LENDING_CHAIN_ID,
  WSOL_MINT,
  serializeKaminoMarket,
  buildKaminoActionTransactions,
  collectKaminoTransactions,
  isVersionedTransaction,
  preflightSolanaAction,
  toSolanaUnits
} from '../src/lib/solanaLending.js';

/* ── configuration ────────────────────────────────────────────────────────── */

/** Every tunable is read AT CALL TIME (the convention server/solana.js set): a
    value frozen at import cannot be changed by an operator or exercised by a
    test without re-importing the world. */
const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const SOLANA_LENDING_SCHEMA = 'fbt.solana-kamino.v1';

/** The door is open unless it is explicitly closed. */
export const lendingServerEnabled = () =>
  String(process.env.SOLANA_LENDING_SERVER_ENABLED ?? 'true').toLowerCase() !== 'false';

/** How long one whole market load may take across every upstream. Vercel's
    function ceiling is 60 s (`functions.api/index.js.maxDuration`), and a load
    that eats all of it leaves nothing for the response. */
const loadBudgetMs = () => num('SOLANA_LENDING_LOAD_BUDGET_MS', 40_000);
/** One upstream's chance at the direct `KaminoMarket.load`. */
const directTimeoutMs = () => num('SOLANA_LENDING_DIRECT_TIMEOUT_MS', 14_000);
/** One upstream's chance at the sliced-reserve fallback. */
const slicedTimeoutMs = () => num('SOLANA_LENDING_SLICED_TIMEOUT_MS', 20_000);
/** A single cheap read (getSlot, getSignatureStatuses, getBalance). */
const readTimeoutMs = () => num('SOLANA_LENDING_READ_TIMEOUT_MS', 9_000);

/** How long a serialized snapshot is shared between callers. The loan page
    polls every 30 s, so 20 s collapses a busy minute into a few loads without
    ever showing a rate the chain has already moved past. */
const snapshotTtlMs = () => num('SOLANA_LENDING_SNAPSHOT_TTL_MS', 20_000);
/** How long the LOADED MARKET OBJECT may be reused to build a transaction. A
    build uses the market's own prices and limits, so this is deliberately
    shorter than a display cache: money is being signed. */
const marketObjectTtlMs = () => num('SOLANA_LENDING_MARKET_TTL_MS', 12_000);
/** How long the reserve pubkey list is trusted. Kamino lists an asset rarely;
    a stale list costs a missing row, and a stale row costs nothing (an account
    that no longer exists reads back null and is skipped). */
const reserveListTtlMs = () => num('SOLANA_LENDING_RESERVE_LIST_TTL_MS', 12 * 60 * 60 * 1000);
/** Accounts per `getMultipleAccounts` chunk. 25 × 8 624 B ≈ 290 KB of base64 —
    comfortably inside every free tier's response limit. */
const chunkSize = () => Math.min(100, num('SOLANA_LENDING_CHUNK', 25));
/** Transaction builds per caller per minute: each one spends real upstream
    budget and real CPU, and a page cannot honestly need more. */
const buildsPerMinute = () => num('SOLANA_LENDING_BUILD_BUDGET', 12);

/** The SPL Token program — owner of every non-native Kamino reserve account.
    Kept as a literal here because src/lib/solanaLending.js does not export its
    own copy, and a server module importing a private constant is a module that
    breaks when somebody tidies that file. */
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const named = (code, detail = null) => {
  const error = new Error(code);
  error.code = code;
  if (detail) error.detail = String(detail).slice(0, 200);
  return error;
};

/** A hard deadline around one upstream call. @solana/web3.js has no per-request
    timeout of its own, and a node that accepts the socket and never answers
    would otherwise hold a serverless function until the platform kills it. */
function withTimeout(promise, ms, label = 'read') {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => { if (timer) clearTimeout(timer); }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(named('UPSTREAM_TIMEOUT', `${label} exceeded ${ms}ms`)), ms);
      timer.unref?.();
    })
  ]);
}

/* ── the SDK, loaded the way the SDK wants to be loaded ───────────────────── */

/**
 * klend-sdk's dist graph is CJS with circular requires, and a DEEP import first
 * (`dist/classes/market.js`) dies at module init with
 * `TypeError: Cannot read properties of undefined (reading 'MAX_F_BN')` — the
 * same crash scripts/vendor-kamino.mjs documents for the browser bundle.
 * Importing the package INDEX first replays Node's own require order, which
 * initialises cleanly, and every symbol this module needs is on it.
 *
 * Loaded lazily and memoised: the SDK (with Pyth, Switchboard, Scope and the
 * farms graph behind it) is megabytes, and a deployment that never serves a
 * Solana loan should never pay for it. A failed load is NOT memoised, so the
 * next request tries again instead of caching a cold-start accident.
 */
let sdkPromise = null;

export function loadKlendSdk() {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      const index = await import('@kamino-finance/klend-sdk');
      const { default: BN } = await import('bn.js');
      const required = ['KaminoMarket', 'KaminoAction', 'VanillaObligation', 'PROGRAM_ID',
        'DEFAULT_RECENT_SLOT_DURATION_MS', 'KaminoReserve', 'LendingMarket', 'Reserve',
        'getTokenOracleData', 'PubkeyHashMap'];
      const missing = required.filter((key) => index[key] == null);
      if (missing.length) throw named('KAMINO_SDK_INCOMPLETE', `missing: ${missing.join(', ')}`);
      return { ...index, BN };
    })().catch((cause) => {
      sdkPromise = null;
      throw named('KAMINO_SDK_FAILED', String(cause?.message || cause || '').slice(0, 200));
    });
  }
  return sdkPromise;
}

/* ── upstreams, and which one answered last ───────────────────────────────── */

/**
 * The nodes this server may ask, in order.
 *
 * Shared with the read-only JSON-RPC relay (server/solanaRpcRelay.js) so the two
 * doors can never disagree about what the app's own upstreams are:
 * `SOLANA_RPC_URL` first when an operator set one (a node we pay for is the one
 * that should answer), then `SOLANA_RELAY_UPSTREAMS`, then the measured public
 * list.
 */
export function lendingUpstreams(cluster = 'mainnet-beta') {
  return relayUpstreams(cluster);
}

/** The last upstream that answered, tried first next time. A datacentre's view
    of these hosts changes slowly, and re-discovering it on every request is a
    dozen wasted round trips. */
let warmUpstream = null;

function orderedUpstreams(cluster = 'mainnet-beta') {
  const all = lendingUpstreams(cluster);
  if (!warmUpstream || !all.includes(warmUpstream)) return all;
  return [warmUpstream, ...all.filter((url) => url !== warmUpstream)];
}

/* ── the reserve list: the call free nodes refuse, routed around ──────────── */

const reserveListCache = new Map(); // `${cluster}|${market}` → { at, pubkeys }

/** Best-effort persistence. On a serverless platform the filesystem is
    per-instance and /tmp is the only writable place; anywhere else this simply
    fails and the memory cache carries on. A list we cannot save is a list we
    re-enumerate — slower, never wrong. */
function reserveListFile(cluster, market) {
  try {
    return path.join(os.tmpdir(), `fbt-kamino-reserves-${cluster}-${market}.json`);
  } catch { return null; }
}

function readPersistedReserveList(cluster, market) {
  try {
    const file = reserveListFile(cluster, market);
    if (!file || !fs.existsSync(file)) return null;
    const row = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pubkeys = Array.isArray(row?.pubkeys) ? row.pubkeys.map(String).filter(Boolean) : [];
    if (!pubkeys.length) return null;
    /* A list older than the TTL is still usable as a LAST RESORT — the caller
       decides — so the age travels with it. */
    return { pubkeys, at: Number(row?.at) || 0 };
  } catch { return null; }
}

function persistReserveList(cluster, market, pubkeys) {
  try {
    const file = reserveListFile(cluster, market);
    if (!file) return false;
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), market, pubkeys }), 'utf8');
    return true;
  } catch { return false; }
}

/**
 * The reserve pubkeys of one market.
 *
 * `dataSlice { offset: 0, length: 0 }` is the whole trick: the node applies the
 * same filters and returns the same pubkeys with NO account data, so a request
 * whose full answer is 1.6 MB becomes one of ~20 KB. Free tiers that refuse
 * `getProgramAccounts` on a size policy serve this shape, and the data itself
 * arrives in chunks through `getMultipleAccounts` — the method nothing refuses.
 *
 * @returns {Promise<string[]>} base58 pubkeys
 */
export async function reservePubkeys({ sdk, connection, programId, marketPk, cluster = 'mainnet-beta', now = Date.now() }) {
  const key = `${cluster}|${marketPk.toBase58()}`;
  const cached = reserveListCache.get(key);
  if (cached && now - cached.at < reserveListTtlMs()) return cached.pubkeys;

  const filters = [
    { dataSize: sdk.Reserve.layout.span + 8 },
    { memcmp: { offset: 32, bytes: marketPk.toBase58() } }
  ];

  let rows = null;
  let sliceError = null;
  try {
    rows = await withTimeout(
      connection.getProgramAccounts(programId, { filters, dataSlice: { offset: 0, length: 0 } }),
      readTimeoutMs(),
      'reserve pubkeys'
    );
  } catch (cause) {
    sliceError = String(cause?.message || cause || '').slice(0, 160);
  }

  /* Some nodes ignore `dataSlice` on a refused method and refuse the whole
     call; others serve the full response. Try the plain shape once before
     giving up — it is the same filters, and a success here saves a chunked
     read of 130 accounts. */
  if (!Array.isArray(rows) || !rows.length) {
    try {
      const full = await withTimeout(connection.getProgramAccounts(programId, { filters }), slicedTimeoutMs(), 'reserve accounts');
      if (Array.isArray(full) && full.length) rows = full;
    } catch { /* the sliced answer (or its absence) stands */ }
  }

  if (Array.isArray(rows) && rows.length) {
    const pubkeys = rows.map((row) => String(row?.pubkey?.toBase58?.() || row?.pubkey || '')).filter(Boolean);
    reserveListCache.set(key, { at: now, pubkeys });
    persistReserveList(cluster, marketPk.toBase58(), pubkeys);
    return pubkeys;
  }

  /* Nothing enumerated them. A remembered list — even an old one — is better
     than no market at all: reserves that disappeared read back null and are
     skipped, and the alternative is a screen that says «unavailable» on a
     network where the app's own server was the only door. */
  const persisted = readPersistedReserveList(cluster, marketPk.toBase58());
  if (persisted?.pubkeys?.length) {
    reserveListCache.set(key, { at: persisted.at || now, pubkeys: persisted.pubkeys });
    return persisted.pubkeys;
  }
  throw named('KAMINO_RESERVE_LIST_UNAVAILABLE', sliceError || 'no upstream enumerated the market reserves');
}

/**
 * Chunked `getMultipleAccounts`, in the order the pubkeys were given.
 *
 * A pubkey that will not parse is skipped rather than thrown over: the list may
 * have come from a persisted file written by an older build, and one bad line in
 * it must not cost the user the whole market. `null` in the output means "no
 * account here", which the caller already treats as a closed reserve.
 */
async function fetchAccountsInChunks(connection, pubkeys, { size = chunkSize(), timeoutMs = slicedTimeoutMs() } = {}) {
  const out = new Array(pubkeys.length).fill(null);
  const keys = pubkeys.map((value) => {
    try { return new PublicKey(String(value)); } catch { return null; }
  });
  for (let i = 0; i < keys.length; i += size) {
    const slice = keys.slice(i, i + size).filter(Boolean);
    if (!slice.length) continue;
    const accounts = await withTimeout(connection.getMultipleAccountsInfo(slice, 'processed'), timeoutMs, 'reserve accounts');
    /* The node answers in the order it was asked, so the offsets line up with
       the filtered slice — map back through it rather than by raw index. */
    const asked = keys.slice(i, i + size);
    let cursor = 0;
    asked.forEach((key, offset) => {
      if (!key) return;
      out[i + offset] = (accounts || [])[cursor] ?? null;
      cursor += 1;
    });
  }
  return out;
}

/**
 * Load the market WITHOUT a full `getProgramAccounts` — the fallback described
 * in the header. Mirrors klend-sdk's own `getReservesForMarket()` step for step,
 * so the resulting `KaminoMarket` is the SDK's, not a lookalike.
 */
export async function loadMarketViaSlicedReserves({ sdk, connection, marketPk, programId, slotDurationMs, cluster = 'mainnet-beta', now = Date.now() }) {
  const marketState = await withTimeout(sdk.LendingMarket.fetch(connection, marketPk, programId), readTimeoutMs(), 'market account');
  if (!marketState) throw named('KAMINO_MARKET_UNAVAILABLE', 'the market account did not decode');

  const pubkeys = await reservePubkeys({ sdk, connection, programId, marketPk, cluster, now });
  const accounts = await fetchAccountsInChunks(connection, pubkeys);

  const decoded = [];
  let undecodable = 0;
  for (let i = 0; i < pubkeys.length; i += 1) {
    const info = accounts[i];
    if (!info) continue;                      // closed / never existed — skipped, not an error
    const state = sdk.Reserve.decode(info.data);
    if (!state) { undecodable += 1; continue; }
    decoded.push({ info, pubkey: new PublicKey(pubkeys[i]), state });
  }
  if (!decoded.length) throw named('KAMINO_RESERVES_EMPTY', `${pubkeys.length} pubkeys, none readable`);

  /* Oracles: the SDK's own fetcher, which already chunks `getMultipleAccounts`
     and reads the Switchboard state account — both cheap, both allowed. */
  const withOracles = await withTimeout(
    sdk.getTokenOracleData(connection, decoded.map((row) => row.state)),
    slicedTimeoutMs(),
    'oracle prices'
  );

  const reserves = new sdk.PubkeyHashMap();
  let missingOracles = 0;
  withOracles.forEach(([state, oracle], index) => {
    /* A reserve with no readable price is SKIPPED and counted. Kamino's own
       loader throws here; a screen that shows 128 of 130 reserves and says so
       is more useful than one that shows none and says «unavailable». */
    if (!oracle) { missingOracles += 1; return; }
    const row = decoded[index];
    if (!row) { missingOracles += 1; return; }
    const reserve = sdk.KaminoReserve.initialize(row.info, row.pubkey, state, oracle, connection, slotDurationMs);
    reserves.set(reserve.address, reserve);
  });
  if (!reserves.size) throw named('KAMINO_ORACLES_UNAVAILABLE', 'every reserve came back without a price');

  const market = sdk.KaminoMarket.loadWithReserves(
    connection, marketState, reserves, marketPk.toString(), slotDurationMs, programId
  );
  return { market, mode: 'sliced', reserves: reserves.size, missingOracles, undecodable };
}

/* ── the market object, cached ────────────────────────────────────────────── */

let marketHolder = null; // { at, market, connection, url, slot, mode, notes }

/**
 * A loaded market, reused while it is young.
 *
 * ONE load serves every caller: the Kamino market account is global, so two
 * users asking in the same second are asking the same question, and the free
 * upstreams behind this server are metered in single-digit requests per second.
 * @param {{ maxAgeMs?: number, now?: number, force?: boolean }} [options]
 */
export async function loadedKaminoMarket({ maxAgeMs = marketObjectTtlMs(), now = Date.now(), force = false } = {}) {
  if (!force && marketHolder && now - marketHolder.at < maxAgeMs) return marketHolder;

  const sdk = await loadKlendSdk();
  const marketPk = new PublicKey(KAMINO_MAIN_MARKET);
  const programId = new PublicKey(KAMINO_LENDING_PROGRAM);
  const slotDurationMs = Number(sdk.DEFAULT_RECENT_SLOT_DURATION_MS) > 0 ? Number(sdk.DEFAULT_RECENT_SLOT_DURATION_MS) : 450;
  const deadline = now + loadBudgetMs();
  const attempts = [];
  let lastError = null;

  for (const url of orderedUpstreams()) {
    if (Date.now() > deadline) break;
    const connection = new Connection(url, { commitment: 'confirmed' });
    const host = redactUpstream(url);

    /* 1. the SDK's own loader — one call, fastest when a node serves it. */
    try {
      const market = await withTimeout(
        sdk.KaminoMarket.load(connection, marketPk, slotDurationMs, programId),
        Math.min(directTimeoutMs(), Math.max(2000, deadline - Date.now())),
        'market load'
      );
      if (market) {
        const slot = await readSlot(connection);
        warmUpstream = url;
        marketHolder = { at: Date.now(), market, connection, url, slot, mode: 'direct', notes: null, attempts };
        return marketHolder;
      }
      attempts.push({ host, mode: 'direct', ok: false, error: 'empty market' });
    } catch (cause) {
      lastError = cause;
      attempts.push({ host, mode: 'direct', ok: false, error: String(cause?.message || cause || '').slice(0, 160) });
    }

    /* 2. the sliced fallback on the SAME connection — a node that refused the
       big enumeration may still serve the market account and a chunked read. */
    if (Date.now() > deadline) break;
    try {
      const loaded = await loadMarketViaSlicedReserves({
        sdk, connection, marketPk, programId, slotDurationMs,
        now: Date.now()
      });
      const slot = await readSlot(connection);
      warmUpstream = url;
      marketHolder = {
        at: Date.now(), market: loaded.market, connection, url, slot, mode: loaded.mode,
        notes: { reserves: loaded.reserves, missingOracles: loaded.missingOracles, undecodable: loaded.undecodable },
        attempts: [...attempts, { host, mode: 'sliced', ok: true }]
      };
      return marketHolder;
    } catch (cause) {
      lastError = cause;
      attempts.push({ host, mode: 'sliced', ok: false, error: String(cause?.message || cause || '').slice(0, 160) });
    }
  }

  /* Stale beats empty for DISPLAY only, and only when it is minutes old: a
     rate from two minutes ago is a real rate, and the response says when it was
     read. Transaction builds never take this path — see `marketForBuild`. */
  if (marketHolder && Date.now() - marketHolder.at < 5 * 60 * 1000) {
    return { ...marketHolder, stale: true, attempts };
  }

  const failure = named('KAMINO_MARKET_UNAVAILABLE', String(lastError?.detail || lastError?.message || 'every upstream refused the market load').slice(0, 200));
  failure.attempts = attempts;
  throw failure;
}

async function readSlot(connection) {
  try { return await withTimeout(connection.getSlot('processed'), readTimeoutMs(), 'getSlot'); } catch { return null; }
}

/* ── the wallet's spendable balances, server side ─────────────────────────── */

/**
 * Same contract as the browser's `readSolanaLendingBalances`: `{ [assetId]:
 * baseUnitsString }`, and `{}` when the read failed — which downstream is
 * BALANCE_UNKNOWN, never zero (§37).
 *
 * Two shapes are tried because the parsed one is the convenient one and the
 * raw one is the one free nodes actually serve: `getParsedTokenAccountsByOwner`
 * asks the node to run the SPL parser, and several public tiers refuse it while
 * serving plain `getTokenAccountsByOwner`. Decoding a token account by hand is
 * four lines because its layout has not changed since 2020 — mint at 0, owner at
 * 32, amount as a little-endian u64 at 64.
 */
export async function readKaminoBalances({ connection, wallet, assets = [] }) {
  const balances = {};
  const byMint = new Map((assets || []).filter((a) => a?.address).map((a) => [String(a.address), a]));
  if (!byMint.size) return balances;
  const owner = new PublicKey(wallet);

  let nativeLamports = null;
  if (byMint.has(WSOL_MINT)) {
    try { nativeLamports = BigInt(await withTimeout(connection.getBalance(owner), readTimeoutMs(), 'getBalance')); } catch { nativeLamports = null; }
  }

  const add = (assetId, raw) => {
    const current = balances[assetId] ? BigInt(balances[assetId]) : 0n;
    balances[assetId] = (current + BigInt(raw)).toString();
  };

  let tokenReadOk = false;
  try {
    const parsed = await withTimeout(
      connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(SPL_TOKEN_PROGRAM_ID) }),
      slicedTimeoutMs(),
      'parsed token accounts'
    );
    for (const entry of parsed?.value ?? []) {
      const info = entry?.account?.data?.parsed?.info;
      const asset = byMint.get(String(info?.mint || ''));
      const raw = info?.tokenAmount?.amount;
      if (!asset || raw == null) continue;
      add(asset.id, raw);
    }
    tokenReadOk = true;
  } catch { tokenReadOk = false; }

  if (!tokenReadOk) {
    try {
      const raw = await withTimeout(
        connection.getTokenAccountsByOwner(owner, { programId: new PublicKey(SPL_TOKEN_PROGRAM_ID) }),
        slicedTimeoutMs(),
        'token accounts'
      );
      for (const entry of raw?.value ?? []) {
        const data = entry?.account?.data;
        const bytes = Array.isArray(data) && typeof data[0] === 'string'
          ? Buffer.from(data[0], data[1] === 'base64' ? 'base64' : 'hex')
          : Buffer.isBuffer(data) ? data : null;
        if (!bytes || bytes.length < 72) continue;
        const mint = new PublicKey(bytes.subarray(0, 32)).toBase58();
        const asset = byMint.get(mint);
        if (!asset) continue;
        add(asset.id, bytes.readBigUInt64LE(64).toString());
      }
      tokenReadOk = true;
    } catch { tokenReadOk = false; }
  }

  /* Native SOL is what a SOL deposit actually spends (Kamino wraps it), so the
     wSOL reserve carries native + wrapped, exactly as the browser door does. */
  if (nativeLamports != null && byMint.has(WSOL_MINT)) {
    add(byMint.get(WSOL_MINT).id, nativeLamports.toString());
  }
  if (!tokenReadOk && nativeLamports == null) return {};
  return balances;
}

/* ── snapshots ────────────────────────────────────────────────────────────── */

const snapshotCache = new Map(); // `wallet|anon` → { at, snapshot }

/**
 * The market snapshot for one wallet — the SAME serializer the browser door
 * uses, which is the whole point: one implementation of "what does this market
 * look like", two places it can run.
 *
 * @returns {Promise<object>} a JSON-safe snapshot with `via: 'server'`
 */
export async function readKaminoMarketSnapshot({ wallet = null, now = Date.now(), force = false } = {}) {
  const cacheKey = wallet ? String(wallet) : 'anon';
  const cached = snapshotCache.get(cacheKey);
  if (!force && cached && now - cached.at < snapshotTtlMs()) {
    return { ...cached.snapshot, cached: true, cacheAgeMs: now - cached.at };
  }

  const holder = await loadedKaminoMarket({ now });
  const snapshot = await serializeKaminoMarket({
    market: holder.market,
    wallet: wallet || null,
    slot: holder.slot,
    rpcUrl: redactUpstream(holder.url),
    via: 'server',
    /* A JSON response cannot carry live SDK objects (circular, megabytes), and
       the panel never reads them: it renders `assets`, `positions` and
       `account`, and it builds transactions through this server. */
    withReserveObjects: false,
    dataStatus: holder.stale ? 'stale' : 'live',
    readBalances: wallet
      ? ({ wallet: owner, assets }) => readKaminoBalances({ connection: holder.connection, wallet: owner, assets })
      : null
  });

  const enriched = {
    ...snapshot,
    via: 'server',
    source: 'server-kamino',
    /* How the reserves were enumerated — diagnostics a screenshot can carry,
       and the difference between «a node served the big call» and «we routed
       around it». */
    loadMode: holder.mode,
    loadNotes: holder.notes || null,
    stale: Boolean(holder.stale),
    readAt: holder.stale ? new Date(holder.at).toISOString() : snapshot.readAt
  };
  snapshotCache.set(cacheKey, { at: now, snapshot: enriched });
  return enriched;
}

/* ── transactions ─────────────────────────────────────────────────────────── */

const BUILD_ACTIONS = new Set(['supply', 'borrow', 'withdraw', 'repay']);

/** A base58 ed25519 point, or nothing. A typo'd address must be refused here
    rather than turned into a transaction the chain would reject at the user's
    expense. */
const isWalletAddress = (value) => {
  try { return PublicKey.isOnCurve(new PublicKey(String(value)).toBytes()); } catch { return false; }
};

/** A per-caller budget for builds. Reads are cached and cheap; a build is not. */
const buildBuckets = new Map();
function takeBuildBudget(key, now) {
  let rec = buildBuckets.get(key);
  if (!rec || now > rec.reset) {
    rec = { used: 0, reset: now + 60_000 };
    buildBuckets.set(key, rec);
  }
  rec.used += 1;
  return rec.used <= buildsPerMinute();
}
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of buildBuckets) if (now > rec.reset) buildBuckets.delete(key);
  for (const [key, rec] of snapshotCache) if (now - rec.at > 10 * 60 * 1000) snapshotCache.delete(key);
}, 60_000).unref?.();

/**
 * Build UNSIGNED Kamino transactions for a wallet.
 *
 * The bytes are built by the client module's own `buildKaminoActionTransactions`
 * — imported, not reimplemented — so the argument list that
 * test/solana-lending-precision.test.js pins against the installed `.d.ts` is
 * the same list whichever door produced the transaction. Nothing here signs and
 * nothing here sends (§30): the wallet receives base64 and decides.
 */
export async function buildKaminoTransaction({ action, mint, amount, decimals, wallet, now = Date.now() } = {}) {
  if (!lendingServerEnabled()) return { ok: false, code: 'SERVER_DOOR_DISABLED' };
  const kind = String(action || '').toLowerCase();
  if (!BUILD_ACTIONS.has(kind)) return { ok: false, code: 'UNKNOWN_ACTION' };
  if (!wallet || !isWalletAddress(wallet)) return { ok: false, code: 'SOLANA_WALLET_REQUIRED' };
  if (!mint) return { ok: false, code: 'SOLANA_ASSET_REQUIRED' };

  const assetDecimals = Number.isFinite(Number(decimals)) ? Number(decimals) : 0;
  const amountWei = toSolanaUnits(amount, assetDecimals);
  if (amountWei == null || amountWei <= 0n) return { ok: false, code: 'AMOUNT_REQUIRED' };

  const sdk = await loadKlendSdk();
  /* A build reads prices and limits, so it takes a market no older than the
     build TTL — and never a stale one. */
  const holder = await loadedKaminoMarket({ maxAgeMs: Math.min(marketObjectTtlMs(), 12_000), now });
  if (holder.stale) return { ok: false, code: 'KAMINO_MARKET_UNAVAILABLE', detail: 'the cached market is too old to sign against' };

  const owner = new PublicKey(wallet);
  const mintPk = new PublicKey(mint);
  let reserve = null;
  try { reserve = holder.market.getReserveByMint(mintPk); } catch { reserve = null; }
  if (!reserve) return { ok: false, code: 'ASSET_NOT_SUPPORTED', detail: 'this mint is not a reserve of the Kamino main market' };

  let obligation = null;
  let obligationFailed = false;
  try {
    obligation = await holder.market.getUserVanillaObligation(owner);
  } catch { obligation = null; obligationFailed = true; }
  /* An obligation READ failure is a network failure, not «no position»:
     answering borrow with SOLANA_COLLATERAL_REQUIRED here would send a user
     with real collateral to deposit more of it. */
  if (!obligation && obligationFailed && kind !== 'supply') return { ok: false, code: 'RPC_ERROR', detail: 'the obligation could not be read' };
  if (kind === 'borrow' && !obligation) return { ok: false, code: 'SOLANA_COLLATERAL_REQUIRED' };
  if ((kind === 'withdraw' || kind === 'repay') && !obligation) return { ok: false, code: 'SOLANA_POSITION_REQUIRED' };

  /* §7 — the same preflight the browser runs, over the same snapshot the panel
     is looking at. Refusing here rather than in the wallet means the user is
     told why in their own language before an approval screen appears. */
  const snapshot = await readKaminoMarketSnapshot({ wallet, now });
  const asset = (snapshot.assets || []).find((row) => String(row.address) === String(mint)) || null;
  if (!asset) return { ok: false, code: 'ASSET_NOT_SUPPORTED' };
  const preflight = preflightSolanaAction({ action: kind, asset, amount, snapshot });
  if (!preflight.ok) return { ok: false, code: preflight.code, amountWei: preflight.amountWei };

  const slot = kind === 'repay' ? await readSlot(holder.connection) : undefined;
  const built = await buildKaminoActionTransactions({
    sdk,
    action: kind,
    market: holder.market,
    mint: mintPk,
    owner,
    obligationOrPda: kind === 'supply' ? (obligation || new sdk.VanillaObligation(sdk.PROGRAM_ID)) : obligation,
    amountWei,
    slot,
    BN: sdk.BN
  });
  if (!built.ok) return { ok: false, code: built.code || 'KAMINO_TX_BUILD_FAILED', detail: built.detail || null };

  const entries = await collectKaminoTransactions(built.built, kind);
  if (!entries.length) {
    return { ok: false, code: 'KAMINO_TX_BUILD_EMPTY', detail: 'the SDK returned no transaction for this action' };
  }
  const transactions = entries
    .map(({ id, tx }) => ({
      id,
      transaction: toBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })),
      versioned: isVersionedTransaction(tx)
    }))
    .filter((row) => row.transaction);
  if (!transactions.length) return { ok: false, code: 'KAMINO_TX_BUILD_EMPTY', detail: 'the built transactions could not be serialized' };

  return {
    ok: true,
    action: kind,
    amount: String(amount),
    amountWei: amountWei.toString(),
    transactions,
    protocol: 'kamino-klend',
    chainId: SOLANA_LENDING_CHAIN_ID,
    marketAddress: KAMINO_MAIN_MARKET,
    slot: holder.slot ?? null,
    via: 'server',
    source: 'server-kamino',
    builtAt: new Date().toISOString()
  };
}

/** Uint8Array/Buffer → base64 (the client's `bytesToBase64` is a browser
    implementation; `Buffer` is right here and does not build a string per byte). */
function toBase64(bytes) {
  try { return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? [])).toString('base64'); } catch { return ''; }
}

/**
 * Did a broadcast transaction land?
 *
 * The wallet broadcast through its OWN node, so the answer exists even when the
 * user's browser cannot reach a single public node — and «not found because
 * every host refused us» is the one answer this route must never give.
 */
export async function readKaminoTransactionStatus(signature, { now = Date.now() } = {}) {
  const sig = String(signature || '').trim();
  if (!sig) return { ok: false, code: 'SIGNATURE_REQUIRED' };
  const attempts = [];
  let sawNull = false;
  for (const url of orderedUpstreams()) {
    const connection = new Connection(url, { commitment: 'confirmed' });
    try {
      const result = await withTimeout(connection.getSignatureStatuses([sig]), readTimeoutMs(), 'signature status');
      const status = result?.value?.[0];
      if (!status) { sawNull = true; continue; }
      warmUpstream = url;
      if (status.err) return { ok: false, code: 'TRANSACTION_FAILED', error: status.err, via: 'server', slot: status.slot ?? null };
      return {
        ok: true,
        confirmed: status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized',
        confirmationStatus: status.confirmationStatus || null,
        slot: status.slot ?? null,
        via: 'server'
      };
    } catch (cause) {
      attempts.push({ host: redactUpstream(url), error: String(cause?.message || cause || '').slice(0, 120) });
    }
  }
  /* A node that answered «I do not have it (yet)» is a real answer: a just-sent
     transaction is invisible for a moment. Only a wall of refusals is RPC_ERROR. */
  if (sawNull) return { ok: false, code: 'TRANSACTION_NOT_FOUND', via: 'server', attempts };
  return { ok: false, code: 'RPC_ERROR', detail: 'no upstream answered the signature status', via: 'server', attempts };
}

/* ── the router ───────────────────────────────────────────────────────────── */

/** JSON that cannot throw on a circular value (a snapshot is plain, but the
    honesty is cheap and the failure it prevents is a 200 with no body). */
function sendJson(res, status, payload) {
  try {
    return res.status(status).json(payload);
  } catch {
    return res.status(500).json({ ok: false, code: 'SERIALIZATION_FAILED' });
  }
}

export function solanaLendingRouter() {
  const router = express.Router();
  router.use(express.json());

  /** Diagnostics first: what the door can do, what it last saw, no credentials. */
  router.get('/status', (req, res) => {
    res.set('cache-control', 'no-store');
    return sendJson(res, 200, {
      ok: true,
      enabled: lendingServerEnabled(),
      market: KAMINO_MAIN_MARKET,
      program: KAMINO_LENDING_PROGRAM,
      chainId: SOLANA_LENDING_CHAIN_ID,
      upstreams: lendingUpstreams('mainnet-beta').map(redactUpstream),
      ownUpstreamConfigured: /^https:\/\//i.test(String(process.env.SOLANA_RPC_URL || '').trim()),
      warmUpstream: warmUpstream ? redactUpstream(warmUpstream) : null,
      marketLoaded: Boolean(marketHolder),
      marketAgeMs: marketHolder ? Date.now() - marketHolder.at : null,
      marketLoadMode: marketHolder?.mode || null,
      marketLoadNotes: marketHolder?.notes || null,
      snapshotsCached: snapshotCache.size,
      reserveListsCached: reserveListCache.size,
      limits: {
        snapshotTtlMs: snapshotTtlMs(),
        marketObjectTtlMs: marketObjectTtlMs(),
        reserveListTtlMs: reserveListTtlMs(),
        loadBudgetMs: loadBudgetMs(),
        chunk: chunkSize(),
        buildsPerMinute: buildsPerMinute()
      },
      signs: false,
      broadcasts: false,
      meta: { schema: SOLANA_LENDING_SCHEMA, dataStatus: 'live', source: 'server-kamino', generatedAt: new Date().toISOString() }
    });
  });

  /** The market snapshot. `wallet` is optional; without it no position is read. */
  router.get('/market', async (req, res) => {
    res.set('cache-control', 'no-store');
    if (!lendingServerEnabled()) {
      return sendJson(res, 503, { ok: false, code: 'SERVER_DOOR_DISABLED', meta: { schema: SOLANA_LENDING_SCHEMA } });
    }
    const walletParam = String(req.query.wallet || '').trim();
    const wallet = walletParam ? (isWalletAddress(walletParam) ? walletParam : null) : null;
    if (walletParam && !wallet) {
      return sendJson(res, 400, { ok: false, code: 'BAD_WALLET', detail: 'wallet is not a Solana address', meta: { schema: SOLANA_LENDING_SCHEMA } });
    }
    try {
      const snapshot = await readKaminoMarketSnapshot({ wallet, force: String(req.query.refresh || '') === '1' });
      return sendJson(res, 200, {
        ok: true,
        snapshot,
        meta: {
          schema: SOLANA_LENDING_SCHEMA,
          dataStatus: snapshot.stale ? 'stale' : 'live',
          source: 'server-kamino',
          loadMode: snapshot.loadMode || null,
          generatedAt: new Date().toISOString()
        }
      });
    } catch (cause) {
      /* The refusal is forwarded with its own code and the per-upstream
         verdicts: «our server asked nine nodes and here is what each said» is
         the difference between a debuggable incident and a shrug. */
      const code = String(cause?.code || 'KAMINO_MARKET_UNAVAILABLE');
      return sendJson(res, 502, {
        ok: false,
        code,
        detail: String(cause?.detail || cause?.message || '').slice(0, 200),
        hosts: Array.isArray(cause?.attempts)
          ? cause.attempts.map((a) => ({ host: a.host, reason: a.ok ? 'OK' : String(a.error || 'refused').slice(0, 120), mode: a.mode }))
          : [],
        meta: { schema: SOLANA_LENDING_SCHEMA, dataStatus: 'unavailable', source: 'server-kamino' }
      });
    }
  });

  /** Build unsigned transactions. The wallet signs; the wallet sends. */
  router.post('/transaction', async (req, res) => {
    res.set('cache-control', 'no-store');
    if (!lendingServerEnabled()) {
      return sendJson(res, 503, { ok: false, code: 'SERVER_DOOR_DISABLED', meta: { schema: SOLANA_LENDING_SCHEMA } });
    }
    if (!takeBuildBudget(String(req.ip || 'unknown'), Date.now())) {
      res.set('retry-after', '30');
      return sendJson(res, 429, { ok: false, code: 'BUILD_THROTTLED', detail: 'too many transaction builds from this caller — retry shortly', meta: { schema: SOLANA_LENDING_SCHEMA } });
    }
    const body = req.body || {};
    try {
      const result = await buildKaminoTransaction({
        action: body.action,
        mint: body.mint,
        amount: body.amount,
        decimals: body.decimals,
        wallet: body.wallet
      });
      /* A refusal about the ACTION (no collateral, amount too large) is a 200
         with `ok:false`: it is an answer, not a server failure, and the panel
         already has a sentence for every code. Only a market that could not be
         read at all is a 502. */
      const status = result.ok ? 200 : (result.code === 'KAMINO_MARKET_UNAVAILABLE' || result.code === 'RPC_ERROR' ? 502 : 200);
      return sendJson(res, status, { ...result, meta: { schema: SOLANA_LENDING_SCHEMA, dataStatus: 'live', source: 'server-kamino', signs: false, broadcasts: false } });
    } catch (cause) {
      return sendJson(res, 502, {
        ok: false,
        code: String(cause?.code || 'KAMINO_TX_BUILD_FAILED'),
        detail: String(cause?.detail || cause?.message || '').slice(0, 200),
        hosts: Array.isArray(cause?.attempts) ? cause.attempts.map((a) => ({ host: a.host, reason: String(a.error || 'refused').slice(0, 120), mode: a.mode })) : [],
        meta: { schema: SOLANA_LENDING_SCHEMA, dataStatus: 'unavailable', source: 'server-kamino' }
      });
    }
  });

  /** Did it land? Read-only, and never a re-broadcast. */
  router.get('/transaction/:signature', async (req, res) => {
    res.set('cache-control', 'no-store');
    if (!lendingServerEnabled()) {
      return sendJson(res, 503, { ok: false, code: 'SERVER_DOOR_DISABLED', meta: { schema: SOLANA_LENDING_SCHEMA } });
    }
    const signature = String(req.params.signature || '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{40,120}$/.test(signature)) {
      return sendJson(res, 400, { ok: false, code: 'BAD_SIGNATURE', meta: { schema: SOLANA_LENDING_SCHEMA } });
    }
    const result = await readKaminoTransactionStatus(signature);
    const status = result.ok ? 200 : (result.code === 'RPC_ERROR' ? 502 : 200);
    return sendJson(res, status, { ...result, meta: { schema: SOLANA_LENDING_SCHEMA, dataStatus: 'live', source: 'server-kamino' } });
  });

  return router;
}

/** Test/diagnostic hygiene: forget every cached answer and the warm upstream. */
export function resetSolanaLendingServer() {
  marketHolder = null;
  warmUpstream = null;
  snapshotCache.clear();
  reserveListCache.clear();
  buildBuckets.clear();
}
