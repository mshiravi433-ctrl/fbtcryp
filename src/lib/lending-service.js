/**
 * LENDING SERVICE — the layer between the Lending UI and the protocol adapters.
 * ────────────────────────────────────────────────────────────────────────────
 * §4 of the production spec asks for exactly this stack:
 *
 *   Lending UI  →  Lending State  →  Lending Service  →  Protocol Adapter
 *               →  Chain Adapter  →  RPC / Contracts   →  Blockchain
 *
 * Before this module the middle did not exist. `src/pages/Loan.jsx` reached
 * straight into `src/lib/lending.js` (the Aave chain client) and re-derived
 * every decision inline: it projected a health factor by passing raw TOKEN
 * amounts where the function expects USD, it never asked the protocol for a
 * price, it never simulated, it never estimated gas, and it never consulted the
 * adapter layer that `src/lib/lending-engine/adapter.js` already provides. The
 * engine's `build*Transaction` payloads — unsigned, allowlisted, wallet-only —
 * were written and tested and then not used by the only screen that needed them.
 *
 * This file is that missing layer. It owns no protocol logic of its own:
 *
 *   · every on-chain read/write delegates to src/lib/lending.js (Aave V3)
 *   · every unsigned transaction is built by the registered ADAPTER
 *     (lending-engine/adapter.js → createAaveAdapter), which is the §31
 *     allowlisted path — so the UI can never construct calldata itself
 *   · simulation reuses src/lib/preSignSimulation.js (the same eth_call +
 *     estimateGas the Farm panels use) rather than inventing a second one
 *   · pre-sign guards reuse src/lib/defi/executionGuards.js
 *   · risk maths reuses src/lib/lending-engine/health.js so the page, the
 *     alerts and the server BFF cannot drift (§12/§13)
 *
 * ─── THE HONESTY RULE THIS FILE IS BUILT AROUND (§3) ───────────────────────
 * Every number it returns carries a `status`:
 *
 *   live         read from the protocol/oracle in this pass
 *   partial      some fields read, others could not be
 *   cached       served from the TTL cache, with `ageMs`
 *   estimated    derived from live inputs by arithmetic we can show you
 *   unavailable  could not be determined — and therefore NOT SHOWN
 *
 * A function that cannot answer returns `{ ok:false, status:'unavailable',
 * reason }`. It never returns a plausible default. The single most dangerous
 * thing a lending UI can do is show a confident number it did not read, and
 * the two bugs this module exists to close were both that: a health factor
 * computed from token amounts as if they were dollars, and a borrow button
 * that stayed enabled above the user's real capacity.
 */

import {
  lendingVenue, lendingSupported, lendingAssetsFor,
  readReserves, readUserAccount, readAssetPosition, readAllowance,
  readOraclePrices, readUserConfiguration,
  buildLendingPlan, runLendingPlan, projectHealthFactor,
  unitsToBase, baseToUsdNumber, toUnits, fromUnits,
  isMaxAmount, UINT256_MAX, maxBorrowWei, assertCollateralChangeSafe,
  ORACLE_STATUS
} from './lending';
import { adapterFor, assertAllowedContract } from './lending-engine/adapter';
import { assessPosition, riskLevel } from './lending-engine/health';
import { mapRawError, LENDING_ERRORS } from './lending-engine/errors';
import { buildUnsignedTransaction, simulateUnsignedTransaction } from './preSignSimulation';
import { assertProviderChain, assertSignerContext } from './defi/executionGuards';
import { apiBase } from './apiBase';

/* ═══════════════════════════════════════════════════════════════════════════
   §3 — DATA STATUS
   ═══════════════════════════════════════════════════════════════════════════ */

export const DATA_STATUS = Object.freeze({
  LIVE: 'live',
  PARTIAL: 'partial',
  CACHED: 'cached',
  ESTIMATED: 'estimated',
  UNAVAILABLE: 'unavailable'
});

/** How long a market snapshot may be served from cache before it is stale. */
export const MARKET_CACHE_TTL_MS = 20_000;
/** After this the cache is still shown, but labelled with its age (§26). */
export const MARKET_STALE_AFTER_MS = 90_000;
/** How often the page re-reads on its own while it is visible (§26). */
export const MARKET_POLL_MS = 45_000;
/**
 * A borrow that would leave the health factor below this is blocked, not just
 * warned about. 1.0 is the protocol's own liquidation point; the margin exists
 * because the health factor moves between this read and block inclusion.
 * It is configuration, stated here, not a constant buried in a component (§14).
 */
export const MIN_HEALTH_FACTOR_AFTER_BORROW = 1.05;
/** Same floor applied to a withdrawal that removes collateral (§17). */
export const MIN_HEALTH_FACTOR_AFTER_WITHDRAW = 1.05;

/* ═══════════════════════════════════════════════════════════════════════════
   CACHE (§26) — short-lived, labelled, and never a substitute for a read
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A snapshot cache keyed by chain+wallet. Positions are re-read on every pass
 * in production; the cache exists so a re-render, a tab switch or a slow RPC
 * can show the LAST HONEST numbers with their age attached instead of either
 * blanking the screen or pretending they are fresh.
 */
export function createMarketCache({ ttlMs = MARKET_CACHE_TTL_MS } = {}) {
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      const ageMs = Date.now() - entry.at;
      if (ageMs > ttlMs) return null;
      return { ...entry.value, cached: true, ageMs };
    },
    /** Serve an expired entry as stale rather than dropping it (§26/§37). */
    getStale(key) {
      const entry = store.get(key);
      if (!entry) return null;
      return { ...entry.value, cached: true, stale: true, ageMs: Date.now() - entry.at };
    },
    set(key, value) { store.set(key, { at: Date.now(), value }); return value; },
    /** §26: a successful transaction invalidates the affected market. */
    invalidate(prefix) {
      if (!prefix) { store.clear(); return; }
      for (const key of store.keys()) if (String(key).startsWith(prefix)) store.delete(key);
    },
    size() { return store.size; }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ADAPTER RESOLUTION (§31) — the allowlist is the only way in
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The adapter that may act for a protocol on a chain. Returns null — never a
 * substitute — when the protocol is not registered, is disabled, or does not
 * declare the chain. This is what stops the UI from dialing an address that
 * arrived from anywhere other than the audited registry.
 */
export function resolveAdapter({ protocol = 'aave-v3', chainId } = {}) {
  const entry = adapterFor(protocol);
  if (!entry || entry.enabled !== true) return null;
  if (!entry.chainIds.map(Number).includes(Number(chainId))) return null;
  try { return entry.factory({}); } catch { return null; }
}

/**
 * Prove a pool/token pair against the allowlist BEFORE anything is dialed.
 * §31: "a contract address coming from a request, a URL or a token picker is
 * never used before it passes assertAllowedContract".
 */
export function assertLendingContracts({ chainId, asset }) {
  const venue = lendingVenue(chainId);
  if (!venue) return { ok: false, code: 'UNSUPPORTED_CHAIN' };
  const poolCheck = assertAllowedContract({
    chainId, address: venue.pool, kind: 'pool',
    /* The pool map IS the allowlist for Aave — same source lendingVenue used. */
    poolByChain: { [Number(chainId)]: venue.pool }
  });
  if (!poolCheck.ok) return { ok: false, code: poolCheck.code };
  if (!asset?.address) return { ok: true, pool: venue.pool, token: null };
  const registry = lendingAssetsFor(chainId);
  const tokenCheck = assertAllowedContract({
    chainId, address: asset.address, kind: 'token',
    tokenLookup: (cid, lower) => registry.find((t) => t.chain === Number(cid) && String(t.address).toLowerCase() === lower) ?? null
  });
  if (!tokenCheck.ok) return { ok: false, code: tokenCheck.code };
  return { ok: true, pool: venue.pool, token: tokenCheck.token };
}

/* ═══════════════════════════════════════════════════════════════════════════
   MARKET STATE (§5/§6/§19/§20/§21/§25)
   ═══════════════════════════════════════════════════════════════════════════ */

/** The markets endpoint this service falls back to; pinned by the schema id. */
export const LENDING_BFF_MARKETS_SCHEMA = 'fbt.lending-markets.v2';

/**
 * The app's own lending BFF (`GET /api/lending/markets?network=`) as a READ
 * FALLBACK for the browser's direct RPC path.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The page used to read Aave ONLY through whichever public RPC the wallet
 * context could reach from the browser. In much of this app's user base the
 * free public endpoints are throttled (HTTP 429), TLS-blocked or simply slow
 * enough to trip the stall timer — on every network at once. The symptom this
 * produced: «قیمت‌های اوراکل خوانده نشد» and empty markets for EVERY chain,
 * while the app's own backend — which has ordered multi-RPC failover, a
 * short cache and the same allowlists — was serving the same numbers to
 * other features without ever being consulted by this page.
 *
 * Honesty contract, unchanged from the direct path:
 *   · the BFF reads the SAME pool and the SAME protocol oracle — nothing here
 *     is an exchange ticker, and nothing is invented;
 *   · a payload that does not match the pinned schema is NOT data;
 *   · anything served through this path is labelled (`source: 'server-bff'`)
 *     so the UI can never present a server-cached number as a fresh chain read
 *     (§3/§26);
 *   · any failure returns `{ ok:false }` and the caller degrades exactly as it
 *     did before this path existed.
 */
export async function readLendingBffMarkets({ chainId, baseUrl = null, fetchImpl = null, timeoutMs = 6500 } = {}) {
  const cid = Number(chainId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, reason: 'UNSUPPORTED_CHAIN' };
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { ok: false, reason: 'NO_FETCH' };
  let base = '/api';
  try { base = String(baseUrl || apiBase() || '/api'); } catch { base = '/api'; }
  const url = `${base.replace(/\/+$/, '')}/lending/markets?network=${cid}`;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 6500)) : null;
  try {
    const res = await doFetch(url, {
      headers: { accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!res?.ok) return { ok: false, reason: `HTTP_${res?.status ?? 0}` };
    const json = await res.json();
    /* Shape validation is mandatory: an endpoint that answered 200 with
       anything else (a captive portal, the SPA fallback, an error envelope)
       is not market data. */
    if (json?.meta?.schema !== LENDING_BFF_MARKETS_SCHEMA || !Array.isArray(json?.data?.markets)) {
      return { ok: false, reason: 'BAD_PAYLOAD' };
    }
    const marketsBySymbol = {};
    for (const market of json.data.markets) {
      if (market && typeof market.asset === 'string') marketsBySymbol[market.asset] = market;
    }
    return {
      ok: true,
      marketsBySymbol,
      meta: {
        dataStatus: json.meta.dataStatus ?? null,
        oracleStatus: json.meta.oracleStatus ?? null,
        oracleAddress: json.meta.oracleAddress ?? null,
        oracleCode: json.meta.oracleCode ?? null,
        readAt: json.meta.readAt ?? null
      }
    };
  } catch (error) {
    return { ok: false, reason: String(error?.name === 'AbortError' ? 'TIMEOUT' : 'BFF_UNAVAILABLE'), detail: String(error?.message || error).slice(0, 120) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Overlay one BFF market onto a reserve object that the direct read could not
 * produce. Rates, LTV and status may come from the server (labelled); the
 * depth fields stay null rather than becoming invented numbers — the BFF
 * markets endpoint does not serve aToken/debt totals (honest nulls there too),
 * so the depth grid degrades to its "could not be read" state instead of
 * filling with nothing.
 */
function mergeBffReserve({ current, bffMarket, asset }) {
  const capToString = (value) => (value != null && Number(value) > 0 ? String(value) : null);
  return {
    ok: true,
    listed: true,
    listingSource: 'server-bff',
    decimals: Number(current?.decimals ?? bffMarket.decimals ?? asset.decimals ?? 18),
    decimalsMatch: current?.decimalsMatch ?? null,
    supplyApyPct: current?.supplyApyPct ?? (Number.isFinite(bffMarket.supplyApy) ? bffMarket.supplyApy : null),
    borrowApyPct: current?.borrowApyPct ?? (Number.isFinite(bffMarket.borrowApy) ? bffMarket.borrowApy : null),
    ltvPct: current?.ltvPct ?? (Number.isFinite(bffMarket.ltv) ? bffMarket.ltv : null),
    liquidationThresholdPct: current?.liquidationThresholdPct ?? (Number.isFinite(bffMarket.liquidationThreshold) ? bffMarket.liquidationThreshold : null),
    liquidationBonusPct: current?.liquidationBonusPct ?? (Number.isFinite(bffMarket.liquidationBonus) ? bffMarket.liquidationBonus : null),
    borrowingEnabled: current?.borrowingEnabled ?? (typeof bffMarket.borrowingEnabled === 'boolean' ? bffMarket.borrowingEnabled : null),
    status: current?.status && current.status !== 'unknown' ? current.status
      : (['active', 'paused', 'frozen'].includes(bffMarket.status) ? bffMarket.status : 'unknown'),
    totalSupplyWei: current?.totalSupplyWei ?? null,
    totalDebtWei: current?.totalDebtWei ?? null,
    availableLiquidityWei: current?.availableLiquidityWei ?? null,
    utilizationPct: current?.utilizationPct ?? null,
    supplyCapWhole: current?.supplyCapWhole ?? capToString(bffMarket.supplyCapWhole),
    borrowCapWhole: current?.borrowCapWhole ?? capToString(bffMarket.borrowCapWhole),
    borrowCapWei: current?.borrowCapWei ?? null,
    supplyCapWei: current?.supplyCapWei ?? null,
    dataStatus: 'partial'
  };
}

/**
 * Build the protocol-oracle view from BFF oracle prices, for the assets the
 * page works with. Only a positive base price counts — a missing feed stays
 * unavailable per asset, never zero (§21).
 */
function mergeBffOracle({ bff, assets }) {
  const prices = {};
  let anyValid = false;
  for (const asset of assets) {
    const market = bff?.marketsBySymbol?.[asset.symbol];
    const base = safeBigInt(market?.oraclePriceBase);
    const usd = Number(market?.oraclePrice);
    if (base != null && base > 0n) {
      anyValid = true;
      prices[asset.id] = {
        symbol: asset.symbol,
        address: asset.address,
        priceBase: base.toString(),
        priceUsd: Number.isFinite(usd) && usd > 0 ? usd : baseToUsdNumber(base),
        valid: true, stale: false, reason: null, source: 'server-bff'
      };
    } else {
      prices[asset.id] = {
        symbol: asset.symbol, address: asset.address,
        priceBase: null, priceUsd: null, valid: false, stale: false,
        reason: 'ORACLE_PRICE_UNAVAILABLE', source: 'server-bff'
      };
    }
  }
  if (!anyValid) return null;
  const metaStatus = String(bff?.meta?.oracleStatus || '');
  return {
    ok: true,
    /* A BFF 'partial' means some prices, which here is simply 'ok': the
       per-asset entries already say which one is missing. */
    status: metaStatus === 'anomaly' ? ORACLE_STATUS.ANOMALY : ORACLE_STATUS.OK,
    oracleAddress: bff?.meta?.oracleAddress ?? null,
    prices,
    staleAssets: [],
    invalidAssets: assets.filter((a) => !prices[a.id]?.valid).map((a) => a.symbol),
    checkedAt: Date.now(),
    source: 'server-bff'
  };
}

const safeBigInt = (value) => {
  try { return value == null ? null : BigInt(value); } catch { return null; }
};

/**
 * One read pass over everything the Lending page displays.
 *
 * Reads are independent and each is individually tolerant, so a single failed
 * RPC call degrades ONE field to `unavailable` rather than taking the market
 * list, the rates or the position down with it. The aggregate `dataStatus`
 * tells the caller which of those happened, and `failures` keeps the technical
 * reason for diagnostics (§28: "keep the original technical error available").
 *
 * @param {object}   opts
 * @param {object}   opts.provider      ethers read provider for `chainId`
 * @param {number}   opts.chainId
 * @param {object[]} [opts.assets]      defaults to the chain's registry-backed list
 * @param {string}   [opts.wallet]      when present, positions are read too
 * @param {object}   [opts.referencePrices] deviation check ONLY — never a risk input (§32)
 * @param {object}   [opts.cache]       createMarketCache() instance
 * @param {boolean}  [opts.force]       bypass the cache (after a transaction)
 */
export async function readMarketState({ provider, chainId, assets = null, wallet = null, referencePrices = null, cache = null, force = false } = {}) {
  const cid = Number(chainId);
  const venue = lendingVenue(cid);
  const list = Array.isArray(assets) ? assets : lendingAssetsFor(cid);
  const cacheKey = `market:${cid}:${String(wallet || 'anon').toLowerCase()}`;

  if (!lendingSupported(cid)) {
    /* §5: an unsupported network is a STATE, not an empty list. The page can
       then say "no supported lending market here" instead of rendering a
       market with nothing in it. */
    return {
      ok: false, chainId: cid, venue: null, assets: [], reserves: {}, oracle: null,
      account: null, positions: {}, userConfiguration: null, prices: {},
      dataStatus: DATA_STATUS.UNAVAILABLE, reason: 'UNSUPPORTED_CHAIN',
      readAt: null, failures: []
    };
  }
  if (!force && cache) {
    const hit = cache.get(cacheKey);
    if (hit) return { ...hit, dataStatus: DATA_STATUS.CACHED, status: DATA_STATUS.CACHED };
  }
  const failures = [];

  /* ── (A) the direct reads, exactly as before — only when a provider exists ─ */
  let reserves = {};
  let oracle = null;
  let account = null;
  let positions = {};
  let userConfiguration = null;

  if (provider) {
    /* Reserves first: the oracle's staleness rule consumes each reserve's
       `lastUpdateTimestamp` from this same pass (see readOraclePrices'
       `reserves` parameter), so the oracle pass no longer re-reads every
       reserve behind the rate limiter's back. */
    try {
      reserves = await readReserves({ provider, chainId: cid, assets: list });
    } catch (error) {
      failures.push({ step: 'reserves', reason: String(error?.message || error).slice(0, 160) });
    }

    /* §21 — the protocol's own oracle. Never a CEX ticker for a risk number. */
    try {
      oracle = await readOraclePrices({ provider, chainId: cid, assets: list, referencePrices, reserves });
    } catch (error) {
      failures.push({ step: 'oracle', reason: String(error?.message || error).slice(0, 160) });
    }

    if (wallet) {
      try {
        account = await readUserAccount({ provider, chainId: cid, user: wallet });
        if (!account?.ok) failures.push({ step: 'account', reason: account?.reason ?? 'ACCOUNT_READ_FAILED' });
      } catch (error) {
        failures.push({ step: 'account', reason: String(error?.message || error).slice(0, 160) });
      }
      try {
        const entries = await Promise.all(list.map(async (asset) => [
          asset.id,
          await readAssetPosition({ provider, chainId: cid, asset, user: wallet, reserve: reserves[asset.id] })
        ]));
        positions = Object.fromEntries(entries);
      } catch (error) {
        failures.push({ step: 'positions', reason: String(error?.message || error).slice(0, 160) });
      }
      /* §15 — collateral usage, from the pool's per-user bitmap. */
      try {
        userConfiguration = await readUserConfiguration({ provider, chainId: cid, user: wallet, reserves });
        if (!userConfiguration?.ok) failures.push({ step: 'userConfiguration', reason: userConfiguration?.reason ?? 'READ_FAILED' });
      } catch (error) {
        failures.push({ step: 'userConfiguration', reason: String(error?.message || error).slice(0, 160) });
      }
    }
  } else {
    failures.push({ step: 'provider', reason: 'NO_PROVIDER' });
  }

  /* ── (B) what the direct path actually produced ─────────────────────────── */
  const directListed = (map) => Object.values(map).filter((r) => r?.listed === true).length;
  let listedCount = directListed(reserves);
  /* §21 A 'stale' or 'anomaly' answer from the direct oracle is INFORMATION,
     not a gap: only a flat 'unavailable' asks for the fallback read. */
  const oracleOkDirect = oracle?.status === ORACLE_STATUS.OK;
  const oracleNeedsFallback = !oracle || oracle.status === ORACLE_STATUS.UNAVAILABLE;
  const sources = {
    reserves: listedCount > 0 ? 'chain' : null,
    oracle: oracleOkDirect ? 'chain' : oracleNeedsFallback ? null : 'chain'
  };

  /* ── (C) the app's own BFF as fallback for whatever the chain read missed ──
     The numbers it returns are the SAME pool and the SAME protocol oracle,
     read server-side over its ordered RPC failover; they are labelled
     `server-bff` everywhere downstream so they can never be mistaken for a
     fresh browser-side chain read (§3). Only what is missing is filled — a
     direct fact (including "this asset is not a reserve") always wins. */
  const unknownReserves = Object.values(reserves).filter((r) => r?.listed == null).length;
  if (listedCount === 0 || unknownReserves > 0 || oracleNeedsFallback) {
    const bff = await readLendingBffMarkets({ chainId: cid });
    if (bff?.ok) {
      let mergedReserves = 0;
      for (const asset of list) {
        const current = reserves[asset.id];
        if (current?.listed != null) continue; // a direct fact always wins
        const bffMarket = bff.marketsBySymbol?.[asset.symbol];
        if (!bffMarket) continue;
        reserves = { ...reserves, [asset.id]: mergeBffReserve({ current, bffMarket, asset }) };
        mergedReserves += 1;
      }
      if (mergedReserves > 0) {
        listedCount = directListed(reserves);
        sources.reserves = sources.reserves ?? 'server-bff';
      }
      if (oracleNeedsFallback) {
        const bffOracle = mergeBffOracle({ bff, assets: list });
        if (bffOracle) { oracle = bffOracle; sources.oracle = 'server-bff'; }
      }
    } else {
      failures.push({ step: 'server-bff', reason: bff?.reason || 'BFF_UNAVAILABLE' });
    }
  }

  /* Nothing answered at all: the honest empty snapshot of before, with its
     reason intact — never a grid of dashes pretending to be data (§37). */
  if (listedCount === 0 && !account?.ok && !oracle?.ok) {
    const stale = cache?.getStale(cacheKey) ?? null;
    return {
      ok: false, chainId: cid, venue, assets: list, reserves: {}, oracle: null,
      account: null, positions: {}, userConfiguration: null, prices: {},
      dataStatus: stale ? DATA_STATUS.CACHED : DATA_STATUS.UNAVAILABLE,
      reason: provider ? 'PROTOCOL_UNAVAILABLE' : 'NO_PROVIDER',
      readAt: stale?.readAt ?? null, failures, sources,
      ...(stale ? { stale: true, ageMs: stale.ageMs } : {})
    };
  }

  /* ── (D) the price view, AFTER the oracle merge ─────────────────────────── */
  const prices = {};
  for (const asset of list) {
    const p = oracle?.prices?.[asset.id];
    prices[asset.id] = p?.valid ? { usd: p.priceUsd, base: p.priceBase, status: DATA_STATUS.LIVE, source: p.source ?? 'protocol-oracle' }
      : { usd: null, base: null, status: DATA_STATUS.UNAVAILABLE, reason: p?.reason ?? 'ORACLE_UNAVAILABLE', source: null };
  }

  /* §12/§13 — one risk assessment, from the engine, shared with the alerts and
     the BFF so the same position cannot be "watch" here and "critical" there. */
  const risk = account?.ok
    ? assessPosition({
      healthFactor: account.healthFactor,
      totalDebtUsd: account.totalDebtUsd,
      totalCollateralUsd: account.totalCollateralUsd,
      liquidationThresholdPct: account.liquidationThresholdPct
    })
    : null;

  /* §3 — the aggregate label. A snapshot assembled through the server fallback
     is PARTIAL: good enough to show and name, never dressed up as a fresh
     direct chain read. */
  const servedByServer = sources.reserves === 'server-bff' || sources.oracle === 'server-bff';
  const partialCount = Object.values(reserves).filter((r) => r?.listed === true && r?.dataStatus === 'partial').length;
  const dataStatus = listedCount === 0 && !account?.ok
    ? DATA_STATUS.UNAVAILABLE
    : (partialCount > 0 || failures.length > 0 || oracle?.status !== ORACLE_STATUS.OK || servedByServer)
      ? DATA_STATUS.PARTIAL
      : DATA_STATUS.LIVE;

  const snapshot = {
    ok: listedCount > 0 || Boolean(account?.ok),
    chainId: cid,
    venue,
    assets: list,
    reserves,
    oracle,
    oracleStatus: oracle?.status ?? DATA_STATUS.UNAVAILABLE,
    account,
    positions,
    userConfiguration,
    prices,
    risk,
    readAt: Date.now(),
    dataStatus,
    status: dataStatus,
    sources,
    failures
  };
  /* Only a snapshot that actually read something is worth caching (§26: a
     cached failure would be served as if it were data). */
  if (cache && snapshot.ok) cache.set(cacheKey, snapshot);
  return snapshot;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §12 — MAXIMUM BORROW, in the borrow asset's own units
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * What the user may actually borrow of ONE asset right now.
 *
 * Not `collateral × LTV`. The protocol's own `availableBorrowsBase` (which
 * already folds in per-reserve collateral factors, existing debt, e-mode,
 * isolation and the liquidation threshold) is converted into the borrow
 * asset's units with the PROTOCOL's oracle price, then capped by the liquidity
 * the pool actually holds and by the reserve's borrow cap (§20: "do not allow
 * borrowing above actual available liquidity").
 *
 * Without a valid oracle price this returns `ok:false`. There is no fallback
 * price and no estimate: an unpriced maximum is the number most likely to be
 * acted on, so it is the one that must never be guessed (§21).
 */
export function getMaxBorrow({ market, asset, headroomBps = 10 } = {}) {
  if (!market || !asset?.id) return { ok: false, status: DATA_STATUS.UNAVAILABLE, reason: 'NO_MARKET' };
  const account = market.account;
  const reserve = market.reserves?.[asset.id];
  const price = market.prices?.[asset.id];

  if (account == null) {
    /* No account was ever read — the wallet is not connected. That is a
       different sentence from "the pool failed to answer", and the UI ties
       each to its own action: connect, versus retry. */
    return { ok: false, status: DATA_STATUS.UNAVAILABLE, reason: 'NOT_CONNECTED' };
  }
  if (!account.ok) {
    return { ok: false, status: DATA_STATUS.UNAVAILABLE, reason: 'ACCOUNT_UNAVAILABLE', detail: 'the pool could not be read for this wallet' };
  }
  if (reserve && reserve.listed === false) {
    return { ok: false, status: DATA_STATUS.UNAVAILABLE, reason: reserve.reason ?? 'NOT_A_RESERVE' };
  }
  if (reserve?.status === 'paused' || reserve?.status === 'frozen') {
    return { ok: false, status: DATA_STATUS.UNAVAILABLE, reason: 'MARKET_PAUSED', detail: `reserve is ${reserve.status}` };
  }
  if (reserve?.borrowingEnabled === false) {
    return { ok: false, status: DATA_STATUS.UNAVAILABLE, reason: 'BORROWING_DISABLED', detail: 'the protocol has not enabled borrowing on this reserve' };
  }
  if (!price?.usd || !price?.base) {
    /* §21 — this is the "Risk data unavailable" case, and it must reach the UI
       as a reason, not as a zero the button can be enabled against. */
    return { ok: false, status: DATA_STATUS.UNAVAILABLE, reason: 'ORACLE_PRICE_UNAVAILABLE', detail: price?.reason ?? 'no valid protocol price' };
  }

  /* Decimals: the reserve's verified value wins over the registry (§18). */
  const decimals = Number(reserve?.decimals ?? asset.decimals ?? 18);
  /* `maxBorrowWei` wants the pool's base-currency figure. `readUserAccount`
     already converted it to USD, so it is converted back with the SAME 8-dec
     base — exact, and it keeps one definition of the pool's capacity. */
  const availableBorrowsBase = Number.isFinite(Number(account.availableBorrowsUsd))
    ? BigInt(Math.max(0, Math.round(Number(account.availableBorrowsUsd) * 10 ** 8)))
    : null;
  const final = maxBorrowWei({
    availableBorrowsBase,
    priceBase: price.base,
    decimals,
    availableLiquidityWei: reserve?.availableLiquidityWei ?? null,
    borrowCapWei: reserve?.borrowCapWei ?? null,
    totalDebtWei: reserve?.totalDebtWei ?? null,
    headroomBps
  });

  if (!final.ok) {
    return { ok: false, status: DATA_STATUS.UNAVAILABLE, reason: final.reason ?? 'MAX_BORROW_UNAVAILABLE' };
  }
  return {
    ok: true,
    status: DATA_STATUS.ESTIMATED,
    maxWei: final.maxWei,
    safeMaxWei: final.safeMaxWei,
    maxAmount: fromUnits(final.safeMaxWei, decimals),
    limitedBy: final.limitedBy,
    limitedBySource: final.limitedBySource,
    constraints: final.constraints,
    headroomBps: final.headroomBps,
    decimals,
    /* Everything that went into it, so the UI can show the derivation rather
       than a bare number (§14: "show the actual numerical values"). */
    inputs: {
      availableBorrowsUsd: account.availableBorrowsUsd,
      priceUsd: price.usd,
      availableLiquidity: reserve?.availableLiquidityWei ? fromUnits(reserve.availableLiquidityWei, decimals) : null,
      borrowCap: reserve?.borrowCapWei ? fromUnits(reserve.borrowCapWei, decimals) : null,
      totalDebt: reserve?.totalDebtWei ? fromUnits(reserve.totalDebtWei, decimals) : null,
      utilizationPct: reserve?.utilizationPct ?? null
    }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §13 — HEALTH FACTOR PROJECTION, priced by the protocol's oracle
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The health factor AFTER an action, in the protocol's own methodology.
 *
 * This replaces the page's previous arithmetic, which passed raw token amounts
 * into a USD-denominated function — so borrowing 0.5 WBTC was projected as if
 * the user had borrowed $0.50, and the "health factor after this borrow" shown
 * before a signature was wrong by five orders of magnitude. Every amount here
 * is converted with the protocol oracle price and integer arithmetic first.
 *
 * Returns `ok:false` (never a number) when the account, the threshold or any
 * required price is unknown. §21: if oracle data is invalid, STOP the
 * calculation.
 */
export function projectActionRisk({ market, action, amountWei, asset, collateralAmountWei = null, collateralAsset = null, maxAmountWei = null } = {}) {
  const unavailable = (reason, detail = null) => ({
    ok: false, status: DATA_STATUS.UNAVAILABLE, reason, detail,
    healthFactorBefore: null, healthFactorAfter: null
  });
  if (!market?.account?.ok) return unavailable('ACCOUNT_UNAVAILABLE');

  const account = market.account;
  const threshold = Number(account.liquidationThresholdPct ?? NaN);
  if (!Number.isFinite(threshold) || threshold <= 0) return unavailable('LIQUIDATION_THRESHOLD_UNAVAILABLE');

  const before = account.healthFactor ?? null;
  const collateralUsd = Number(account.totalCollateralUsd ?? 0);
  const debtUsd = Number(account.totalDebtUsd ?? 0);

  /** Price an integer amount with the protocol oracle; null when it cannot. */
  const usdOf = (wei, target) => {
    if (wei == null) return 0;
    if (String(wei) === '0') return 0;
    const price = market.prices?.[target?.id];
    if (!price?.base) return null;
    const decimals = Number(market.reserves?.[target?.id]?.decimals ?? target?.decimals ?? 18);
    const base = unitsToBase(wei, price.base, decimals);
    return base == null ? null : baseToUsdNumber(base);
  };

  /* A MAX amount is the whole debt / whole balance. The 2^256-1 sentinel is
     what gets SIGNED, never what gets priced: pricing it would produce an
     absurd USD figure and a health-factor projection that looks authoritative
     while meaning nothing. When the caller knows the real balance or debt it
     passes it as `maxAmountWei`, and that is the number projected instead. */
  const isMax = isMaxAmount(amountWei) || String(amountWei ?? '') === UINT256_MAX;
  const realAmountWei = isMax ? (maxAmountWei != null ? String(maxAmountWei) : null) : amountWei;

  let addDebtUsd = 0;
  let addCollateralUsd = 0;
  let removeCollateralUsd = 0;

  if (action === 'borrow') {
    if (realAmountWei == null) return unavailable('AMOUNT_REQUIRED');
    const value = usdOf(realAmountWei, asset);
    if (value == null) return unavailable('ORACLE_PRICE_UNAVAILABLE', `no protocol price for ${asset?.symbol}`);
    addDebtUsd = value;
    if (collateralAmountWei != null && String(collateralAmountWei) !== '0') {
      const collValue = usdOf(collateralAmountWei, collateralAsset ?? asset);
      if (collValue == null) return unavailable('ORACLE_PRICE_UNAVAILABLE', `no protocol price for the collateral asset`);
      addCollateralUsd = collValue;
    }
  } else if (action === 'repay') {
    /* Repaying reduces debt. A MAX repay clears it entirely — and the pool,
       not this arithmetic, decides the final cent of accrued interest, so the
       honest projection is "no debt left" rather than a decimal we cannot
       compute. That is reported as `null` with the reason stated, never as a
       number that looks precise. */
    if (isMax) {
      return {
        ok: true, status: DATA_STATUS.ESTIMATED, isMax: true,
        healthFactorBefore: before, healthFactorAfter: null,
        note: 'a full repay clears the debt; the health factor becomes undefined (no debt) once the pool confirms it',
        addDebtUsd: -debtUsd, addCollateralUsd: 0
      };
    }
    if (realAmountWei == null) return unavailable('AMOUNT_REQUIRED');
    const value = usdOf(realAmountWei, asset);
    if (value == null) return unavailable('ORACLE_PRICE_UNAVAILABLE', `no protocol price for ${asset?.symbol}`);
    addDebtUsd = -Math.min(value, debtUsd);
  } else if (action === 'withdraw') {
    if (realAmountWei == null) return unavailable('AMOUNT_REQUIRED');
    const value = usdOf(realAmountWei, asset);
    if (value == null) return unavailable('ORACLE_PRICE_UNAVAILABLE', `no protocol price for ${asset?.symbol}`);
    /* Withdrawing only reduces collateral if the asset IS collateral. §15's
       bitmap — not a non-zero balance — decides that. */
    const isCollateral = market.userConfiguration?.entries?.[asset?.id]?.usingAsCollateral !== false;
    if (isCollateral) removeCollateralUsd = value;
  } else {
    /* supply: adds collateral */
    if (realAmountWei == null) return unavailable('AMOUNT_REQUIRED');
    const value = usdOf(realAmountWei, asset);
    if (value == null) return unavailable('ORACLE_PRICE_UNAVAILABLE', `no protocol price for ${asset?.symbol}`);
    addCollateralUsd = value;
  }

  const after = projectHealthFactor({
    totalCollateralUsd: collateralUsd,
    totalDebtUsd: debtUsd,
    liquidationThresholdPct: threshold,
    addDebtUsd,
    addCollateralUsd: addCollateralUsd - removeCollateralUsd
  });

  /* `projectHealthFactor` returns null for a debt-free result, which is the
     honest answer after a full repay — not "0" and not "infinite". */
  return {
    ok: true,
    status: DATA_STATUS.ESTIMATED,
    healthFactorBefore: before,
    healthFactorAfter: after,
    riskBefore: before == null ? null : riskLevel(before).level,
    riskAfter: after == null ? null : riskLevel(after).level,
    liquidationThresholdPct: threshold,
    addDebtUsd,
    addCollateralUsd: addCollateralUsd - removeCollateralUsd,
    collateralUsdAfter: Math.max(0, collateralUsd + addCollateralUsd - removeCollateralUsd),
    debtUsdAfter: Math.max(0, debtUsd + addDebtUsd),
    assessmentAfter: after == null ? null : assessPosition({
      healthFactor: after,
      totalDebtUsd: Math.max(0, debtUsd + addDebtUsd),
      totalCollateralUsd: Math.max(0, collateralUsd + addCollateralUsd - removeCollateralUsd),
      liquidationThresholdPct: threshold
    })
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §9/§11/§17/§20 — THE PRE-FLIGHT DECISION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything that must be true BEFORE the wallet is asked to sign.
 *
 * Returns `{ blocked, warnings }`. `blocked` means the action button must be
 * disabled and the reason shown; `warnings` means it may proceed with the risk
 * stated. The distinction matters: §11 says the Borrow button "must be
 * disabled if the transaction would violate protocol constraints", and §41 says
 * uncertainty must still be communicated rather than hidden behind a disabled
 * button.
 *
 * A check whose inputs could not be read produces a WARNING naming the gap, not
 * a silent pass and not a fabricated block — the protocol enforces its own
 * limits on-chain either way, and the user is told which check we could not run.
 */
export function evaluateAction({ market, action, asset, amountWei, amount, collateralAmountWei = null, collateralAsset = null, walletBalanceWei = null, suppliedWei = null, debtWei = null, nativeBalanceWei = null, minHealthFactor = MIN_HEALTH_FACTOR_AFTER_BORROW } = {}) {
  const blocked = [];
  const warnings = [];
  const block = (code, detail = null) => blocked.push({ code, detail });
  const warn = (code, detail = null) => warnings.push({ code, detail });

  if (!lendingSupported(market?.chainId)) { block('UNSUPPORTED_CHAIN'); return { ok: false, blocked, warnings }; }
  if (!asset?.address) { block('NOT_A_RESERVE'); return { ok: false, blocked, warnings }; }

  /* §31 — the addresses must be the audited ones before anything else. */
  const contracts = assertLendingContracts({ chainId: market.chainId, asset });
  if (!contracts.ok) { block(contracts.code); return { ok: false, blocked, warnings }; }
  if (collateralAsset?.address) {
    const collContracts = assertLendingContracts({ chainId: market.chainId, asset: collateralAsset });
    if (!collContracts.ok) { block(collContracts.code, 'collateral asset'); return { ok: false, blocked, warnings }; }
  }

  const reserve = market.reserves?.[asset.id];
  if (reserve?.listed === false) { block(reserve.reason ?? 'NOT_A_RESERVE'); return { ok: false, blocked, warnings }; }
  if (reserve?.listed == null) warn('RESERVE_STATE_UNKNOWN', 'the reserve could not be read; rates and caps are unknown');

  /* §29 — never offer a market the protocol has stopped. */
  if (reserve?.status === 'paused') { block('MARKET_PAUSED', 'the protocol has paused this reserve'); return { ok: false, blocked, warnings }; }
  if (reserve?.status === 'frozen') { block('MARKET_PAUSED', 'the protocol has frozen this reserve: repay/withdraw only'); return { ok: false, blocked, warnings }; }

  const decimals = Number(reserve?.decimals ?? asset.decimals ?? 18);
  if (reserve?.decimalsMatch === false) warn('DECIMALS_MISMATCH', `the token contract reports different decimals than the registry; using the on-chain value (${decimals})`);

  const price = market.prices?.[asset.id];
  const oracleDown = market.oracleStatus === ORACLE_STATUS.UNAVAILABLE || (price && !price.usd);
  if (market.oracleStatus === ORACLE_STATUS.STALE) warn('ORACLE_STALE', `stale price feed for: ${(market.oracle?.staleAssets || []).join(', ') || 'some assets'}`);
  if (market.oracleStatus === ORACLE_STATUS.ANOMALY) warn('ORACLE_ANOMALY', 'the protocol price deviates sharply from the reference; risk figures may be unreliable');

  /* ── per-action ───────────────────────────────────────────────────────── */
  if (action === 'supply') {
    if (reserve?.status === 'active' && reserve?.supplyCapWei != null && amountWei != null) {
      const cap = BigInt(reserve.supplyCapWei);
      const suppliedTotal = reserve.totalSupplyWei != null ? BigInt(reserve.totalSupplyWei) : null;
      if (suppliedTotal != null && suppliedTotal + BigInt(amountWei) > cap) {
        block('SUPPLY_CAP_EXCEEDED', `this would take the reserve past its supply cap of ${fromUnits(cap.toString(), decimals)} ${asset.symbol}`);
      }
    }
    if (walletBalanceWei != null && amountWei != null && BigInt(walletBalanceWei) < BigInt(amountWei)) {
      block('INSUFFICIENT_BALANCE', `wallet holds ${fromUnits(walletBalanceWei, decimals)} ${asset.symbol}`);
    } else if (walletBalanceWei == null) {
      warn('BALANCE_UNKNOWN', 'the wallet balance could not be read');
    }
  }

  if (action === 'borrow') {
    if (reserve?.borrowingEnabled === false) { block('BORROWING_DISABLED', 'the protocol has not enabled borrowing on this reserve'); return { ok: false, blocked, warnings }; }

    /* §20 — never borrow more than the pool holds. */
    if (reserve?.availableLiquidityWei != null && amountWei != null && BigInt(amountWei) > BigInt(reserve.availableLiquidityWei)) {
      block('INSUFFICIENT_LIQUIDITY', `the pool holds ${fromUnits(reserve.availableLiquidityWei, decimals)} ${asset.symbol}; this asks for ${fromUnits(amountWei, decimals)}`);
    } else if (reserve?.availableLiquidityWei == null) {
      warn('LIQUIDITY_UNKNOWN', 'available liquidity could not be read; the protocol may still refuse this borrow');
    }

    /* §20 — the reserve's own borrow cap. */
    if (reserve?.borrowCapWei != null && reserve?.totalDebtWei != null && amountWei != null) {
      const headroom = BigInt(reserve.borrowCapWei) > BigInt(reserve.totalDebtWei)
        ? BigInt(reserve.borrowCapWei) - BigInt(reserve.totalDebtWei) : 0n;
      if (BigInt(amountWei) > headroom) {
        block('BORROW_CAP_EXCEEDED', `borrow-cap headroom is ${fromUnits(headroom.toString(), decimals)} ${asset.symbol}`);
      }
    }

    /* §12 — the user's own capacity, priced by the protocol oracle. */
    if (market.account?.ok && price?.base && amountWei != null) {
      const capacityBase = BigInt(Math.max(0, Math.round(Number(market.account.availableBorrowsUsd ?? 0) * 10 ** 8)));
      const amountBase = unitsToBase(amountWei, price.base, decimals);
      if (amountBase != null && amountBase > capacityBase) {
        block('BORROW_LIMIT_EXCEEDED', `borrowing power is ${market.account.availableBorrowsUsd == null ? '—' : `$${Number(market.account.availableBorrowsUsd).toFixed(2)}`}; this needs $${baseToUsdNumber(amountBase).toFixed(2)}`);
      }
    } else if (!price?.base) {
      /* §21 — the capacity check could not run. Do NOT silently pass it. */
      warn('BORROW_CAPACITY_UNVERIFIED', 'no protocol price for this asset, so borrowing power could not be checked before signing');
    }

    /* §11/§13/§14 — the resulting health factor. */
    const projection = projectActionRisk({ market, action: 'borrow', amountWei, asset, collateralAmountWei, collateralAsset });
    if (!projection.ok) {
      if (oracleDown) warn('RISK_DATA_UNAVAILABLE', `risk data unavailable — ${projection.reason}`);
      else warn('RISK_PROJECTION_UNAVAILABLE', projection.reason);
    } else if (projection.healthFactorAfter != null) {
      if (projection.healthFactorAfter < 1) {
        block('HEALTH_FACTOR_TOO_LOW', `this borrow leaves a health factor of ${projection.healthFactorAfter.toFixed(2)} — below the liquidation point of 1.00`);
      } else if (projection.healthFactorAfter < Number(minHealthFactor)) {
        block('HEALTH_FACTOR_TOO_LOW', `this borrow leaves a health factor of ${projection.healthFactorAfter.toFixed(2)}, below the ${Number(minHealthFactor).toFixed(2)} floor this app enforces`);
      } else if (projection.healthFactorAfter < 1.5) {
        warn('LIQUIDATION_RISK', `health factor after this borrow would be ${projection.healthFactorAfter.toFixed(2)} — a modest collateral drop could make the position liquidatable`);
      }
    }
    if (market.account?.ok && !(Number(market.account.totalCollateralUsd) > 0) && !(collateralAmountWei != null && BigInt(collateralAmountWei ?? 0) > 0n)) {
      block('INSUFFICIENT_COLLATERAL', 'no collateral is supplied on this market — supply collateral first');
    }
  }

  if (action === 'repay') {
    if (debtWei != null && amountWei != null && !isMaxAmount(amount) && BigInt(amountWei) > BigInt(debtWei)) {
      /* Repaying more than owed is not a protocol violation (Aave caps it) but
         it does pull more than the user expects, so it is surfaced. */
      warn('EXCEEDS_DEBT', `the debt is ${fromUnits(debtWei, decimals)} ${asset.symbol}; a MAX repay settles it exactly`);
    }
    if (walletBalanceWei != null && amountWei != null && !isMaxAmount(amount) && BigInt(walletBalanceWei) < BigInt(amountWei)) {
      block('INSUFFICIENT_BALANCE', `wallet holds ${fromUnits(walletBalanceWei, decimals)} ${asset.symbol}`);
    }
  }

  if (action === 'withdraw') {
    if (suppliedWei != null && amountWei != null && !isMaxAmount(amount) && BigInt(amountWei) > BigInt(suppliedWei)) {
      block('INSUFFICIENT_BALANCE', `the supplied balance is ${fromUnits(suppliedWei, decimals)} ${asset.symbol}`);
    }
    if (reserve?.availableLiquidityWei != null && amountWei != null && !isMaxAmount(amount) && BigInt(amountWei) > BigInt(reserve.availableLiquidityWei)) {
      block('INSUFFICIENT_LIQUIDITY', `the pool holds ${fromUnits(reserve.availableLiquidityWei, decimals)} ${asset.symbol} right now`);
    }
    /* §17 — the withdrawal must not break the collateral requirement. A MAX
       withdraw is priced at the real supplied balance, not the sentinel. */
    const projection = projectActionRisk({ market, action: 'withdraw', amountWei, asset, maxAmountWei: suppliedWei });
    if (!projection.ok) {
      warn('RISK_PROJECTION_UNAVAILABLE', projection.reason);
    } else if (projection.healthFactorAfter != null) {
      if (projection.healthFactorAfter < 1) {
        block('HEALTH_FACTOR_TOO_LOW', `withdrawing this much leaves a health factor of ${projection.healthFactorAfter.toFixed(2)} — the position would be liquidatable`);
      } else if (projection.healthFactorAfter < MIN_HEALTH_FACTOR_AFTER_WITHDRAW) {
        block('HEALTH_FACTOR_TOO_LOW', `withdrawing this much leaves a health factor of ${projection.healthFactorAfter.toFixed(2)}, below the ${MIN_HEALTH_FACTOR_AFTER_WITHDRAW.toFixed(2)} floor`);
      } else if (projection.healthFactorAfter < 1.5) {
        warn('LIQUIDATION_RISK', `health factor after this withdrawal would be ${projection.healthFactorAfter.toFixed(2)}`);
      }
    }
  }

  /* §9 — enough gas to pay for the transaction at all. */
  if (nativeBalanceWei != null && String(nativeBalanceWei) === '0') {
    block('INSUFFICIENT_GAS', 'the wallet holds no native token to pay the network fee');
  }

  return { ok: blocked.length === 0, blocked, warnings };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §22/§23 — SIMULATION AND GAS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build the UNSIGNED transactions for a plan through the registered adapter,
 * then simulate each one with a real eth_call + estimateGas.
 *
 * The adapter is used on purpose: it is the §31 allowlisted builder, so the
 * calldata that gets simulated is the calldata that would be signed, produced
 * by code that refuses an address outside the registry.
 *
 * Honesty contract (inherited from preSignSimulation):
 *   simulated-clean  — eth_call ran and would not revert at this block
 *   revert-detected  — DO NOT SIGN, with the decoded reason
 *   provider-busy    — could not simulate; NOT proven safe, and reported as
 *                      such rather than as a pass
 * A clean simulation at this block is not a guarantee at inclusion, and this
 * function never claims otherwise (§41).
 */
export async function simulateLendingPlan({ provider, chainId, plan, wallet, asset, protocol = 'aave-v3', gasUsdFor = null, realAmountWei = null } = {}) {
  const adapter = resolveAdapter({ protocol, chainId });
  if (!adapter) {
    return { ok: false, status: 'unavailable', reason: 'NO_ADAPTER', steps: [] };
  }
  if (!provider || !wallet) {
    return { ok: false, status: 'unknown', reason: 'NO_PROVIDER_OR_WALLET', steps: [] };
  }

  const steps = [];
  const planSteps = Array.isArray(plan?.steps) ? plan.steps : [];
  for (const step of planSteps) {
    /* A borrow plan's collateral leg carries its own asset (§11); every other
       step acts on the plan's asset. */
    const target = step?.asset?.address ? step.asset : asset;
    /* A MAX step signs the 2^256-1 sentinel, which eth_call cannot execute
       against a stub or a wallet whose debt differs by a wei of accrued
       interest. It is simulated with the REAL amount the pool will pull, and
       the substitution is recorded so nobody mistakes the simulated calldata
       for the signed calldata. */
    const isSentinel = String(step.amountWei) === UINT256_MAX;
    const simulateWei = isSentinel && realAmountWei != null ? String(realAmountWei) : String(step.amountWei);
    let built = null;
    try {
      if (step.id === 'approve') built = await adapter.buildApprovalTransaction({ chainId, asset: target, amountWei: simulateWei });
      else if (step.id === 'supply') built = await adapter.buildSupplyTransaction({ chainId, asset: target, amountWei: simulateWei, onBehalfOf: wallet });
      else if (step.id === 'borrow') built = await adapter.buildBorrowTransaction({ chainId, asset: target, amountWei: simulateWei, onBehalfOf: wallet });
      else if (step.id === 'repay') built = await adapter.buildRepayTransaction({ chainId, asset: target, amountWei: simulateWei, onBehalfOf: wallet });
      else if (step.id === 'withdraw') built = await adapter.buildWithdrawTransaction({ chainId, asset: target, amountWei: simulateWei, to: wallet });
      else if (step.id === 'collateral') built = await adapter.buildCollateralTransaction({ chainId, asset: target, useAsCollateral: Boolean(step.useAsCollateral) });
    } catch (error) {
      steps.push({ id: step.id, status: 'unknown', reason: `BUILD_FAILED: ${String(error?.message || error).slice(0, 120)}` });
      continue;
    }
    if (!built?.ok || !built.to || !built.data) {
      steps.push({ id: step.id, status: 'unknown', reason: built?.code || 'NO_UNSIGNED_PAYLOAD' });
      continue;
    }
    let tx;
    try {
      tx = buildUnsignedTransaction({ from: wallet, to: built.to, data: built.data, value: BigInt(built.value || 0) });
    } catch (error) {
      steps.push({ id: step.id, status: 'unknown', reason: `BAD_PAYLOAD: ${String(error?.message || error).slice(0, 120)}` });
      continue;
    }
    /* A MAX amount reverts in eth_call for a wallet with no debt/balance in the
       simulated state, so the sentinel is simulated as the real amount — which
       is what the pool will actually pull. The signed tx still uses MAX. */
    const outcome = await simulateUnsignedTransaction({ provider, tx, allowance: null, gasUsdFor });
    steps.push({
      id: step.id,
      to: built.to,
      data: built.data,
      status: outcome.status,
      provenSafe: outcome.provenSafe,
      revertReason: outcome.revertReason,
      gasLimit: outcome.gasLimit != null ? outcome.gasLimit.toString() : null,
      gasCostUsd: outcome.gasCostUsd ?? null,
      notes: outcome.notes,
      /* The signed amount when it differs from the simulated one. */
      signedAmountWei: isSentinel ? String(step.amountWei) : null,
      simulatedAmountWei: simulateWei
    });
  }

  const anyRevert = steps.some((s) => s.status === 'revert-detected');
  const allClean = steps.length > 0 && steps.every((s) => s.status === 'simulated-clean');
  const anyBusy = steps.some((s) => s.status === 'provider-busy' || s.status === 'unknown');
  const totalGas = steps.reduce((sum, s) => sum + (s.gasLimit != null ? BigInt(s.gasLimit) : 0n), 0n);

  return {
    ok: !anyRevert,
    status: anyRevert ? 'revert-detected' : allClean ? 'simulated-clean' : anyBusy ? 'provider-busy' : 'unknown',
    provenSafe: allClean,
    steps,
    totalGasLimit: steps.length ? totalGas.toString() : null,
    revertReason: steps.find((s) => s.status === 'revert-detected')?.revertReason ?? null,
    simulatedAt: Date.now()
  };
}

/**
 * §23 — the network fee, from the CURRENT provider. Nothing is hardcoded and
 * nothing is guessed: if the provider will not answer, the fee is reported as
 * unavailable and the review sheet says so instead of showing a number.
 *
 * The authoritative figure is in the chain's native token (exact, from
 * getFeeData × the simulated gas limit). A USD conversion is only attached when
 * a native price was supplied by the caller, and is labelled as an estimate —
 * it is a convenience, never a risk input (§32).
 */
export async function estimateNetworkFee({ provider, gasLimit, nativePriceUsd = null, chainId = null }) {
  if (!provider || typeof provider.getFeeData !== 'function') {
    return { ok: false, status: DATA_STATUS.UNAVAILABLE, reason: 'NO_PROVIDER' };
  }
  let fee;
  try { fee = await provider.getFeeData(); } catch (error) {
    return { ok: false, status: DATA_STATUS.UNAVAILABLE, reason: 'FEE_DATA_UNREADABLE', detail: String(error?.message || error).slice(0, 120) };
  }
  const gasPrice = fee?.gasPrice ?? fee?.maxFeePerGas ?? null;
  if (gasPrice == null) {
    return { ok: false, status: DATA_STATUS.UNAVAILABLE, reason: 'GAS_PRICE_UNREADABLE' };
  }
  const limit = gasLimit != null ? BigInt(gasLimit) : null;
  const native = limit != null ? Number(gasPrice * limit) / 1e18 : null;
  const symbol = chainNativeSymbol(chainId);
  return {
    ok: true,
    status: DATA_STATUS.LIVE,
    gasPriceWei: gasPrice.toString(),
    gasLimit: limit != null ? limit.toString() : null,
    maxFeeNative: native,
    maxFeeNativeFormatted: native == null ? null : `${native.toFixed(native < 0.001 ? 8 : 6)} ${symbol}`,
    maxFeeUsd: (native != null && Number.isFinite(Number(nativePriceUsd)) && Number(nativePriceUsd) > 0)
      ? native * Number(nativePriceUsd) : null,
    /* §23/§24: this is the NETWORK's fee. FBT adds nothing to a lending
       transaction, and the UI must not label it otherwise. */
    kind: 'network-fee',
    usdIsEstimate: native != null && Number.isFinite(Number(nativePriceUsd))
  };
}

const NATIVE_BY_CHAIN = Object.freeze({ 1: 'ETH', 10: 'ETH', 56: 'BNB', 137: 'POL', 8453: 'ETH', 42161: 'ETH', 43114: 'AVAX' });
export const chainNativeSymbol = (chainId) => NATIVE_BY_CHAIN[Number(chainId)] ?? 'ETH';

/* ═══════════════════════════════════════════════════════════════════════════
   §9/§10 — EXECUTION, guarded
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Run a reviewed plan against the user's wallet, with the pre-sign guards the
 * repo already has.
 *
 * The guards are not decoration: between the review sheet opening and the user
 * pressing Confirm, the wallet can change account or network (and on mobile it
 * routinely does, because opening the external wallet suspends the page — §35).
 * `assertProviderChain` / `assertSignerContext` re-check both immediately
 * before the signature, so a transaction can never be signed for a chain or an
 * account other than the one the user reviewed.
 *
 * FBT never signs and never broadcasts (§30): every step below is the connected
 * wallet's own signature.
 */
export async function executeLendingPlan({ signer, provider, chainId, plan, asset, account, wallet, onStep, enforceChain = true } = {}) {
  if (!signer) return { ok: false, code: 'WALLET_NOT_CONNECTED', message: 'no signer — connect a wallet first' };
  if (enforceChain) {
    try {
      if (provider) await assertProviderChain(provider, chainId);
      await assertSignerContext(signer, { owner: wallet ?? account, chainId });
    } catch (error) {
      const code = String(error?.code || '');
      const mapped = code === 'EXECUTION_WRONG_CHAIN' ? 'WRONG_NETWORK'
        : code === 'EXECUTION_ACCOUNT_CHANGED' ? 'WALLET_NOT_CONNECTED'
          : code === 'EXECUTION_NETWORK_UNREADABLE' || code === 'EXECUTION_PROVIDER_UNAVAILABLE' ? 'RPC_ERROR'
            : mapRawError(error, { fallback: 'WRONG_NETWORK' }).code;
      return { ok: false, code, message: String(error?.message || error).slice(0, 200), mappedCode: mapped };
    }
  }
  try {
    const result = await runLendingPlan({ steps: plan?.steps ?? [], signer, chainId, asset, account: wallet ?? account, onStep });
    if (!result.ok) {
      const mapped = LENDING_ERRORS[result.code] ? result.code : mapRawError({ code: result.code, message: result.message }, { fallback: 'TRANSACTION_REVERTED' }).code;
      return { ...result, code: mapped };
    }
    return result;
  } catch (error) {
    const mapped = mapRawError(error, { fallback: 'UNKNOWN' });
    return { ok: false, code: mapped.code, message: String(error?.message || error).slice(0, 200) };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §27 — TRANSACTION HISTORY
   ═══════════════════════════════════════════════════════════════════════════ */

export const TX_STATUS = Object.freeze({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  REPLACED: 'REPLACED',
  UNKNOWN: 'UNKNOWN'
});

const STORAGE_KEY = 'fbt.lending.tx.v1';
const HISTORY_LIMIT = 50;

/**
 * A local ledger of the lending transactions THIS wallet made through this
 * page. It is a convenience record, not a source of truth: every entry is
 * keyed by a real hash the wallet returned, and the on-chain position is always
 * re-read after a confirmation.
 *
 * What it must never do (§27) is invent a hash. An entry with no hash is
 * refused, and a failed signature records FAILED with a null hash — the user
 * still needs to see that they rejected it.
 */
export function createTransactionHistory({ storage = null, limit = HISTORY_LIMIT } = {}) {
  const backend = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const read = () => {
    if (!backend) return [];
    try {
      const raw = backend.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e === 'object') : [];
    } catch { return []; }
  };
  const write = (entries) => {
    if (!backend) return entries;
    try { backend.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, limit))); } catch { /* quota — history is not worth failing a transaction over */ }
    return entries;
  };
  return {
    list({ wallet = null, chainId = null } = {}) {
      let entries = read();
      if (wallet) entries = entries.filter((e) => String(e.wallet || '').toLowerCase() === String(wallet).toLowerCase());
      if (chainId != null) entries = entries.filter((e) => Number(e.chainId) === Number(chainId));
      return entries;
    },
    /** Add or update one entry. Returns the stored entry. */
    record(entry) {
      const status = TX_STATUS[entry?.status] ? entry.status : TX_STATUS.UNKNOWN;
      const id = entry?.id || entry?.hash || `${entry?.action}:${entry?.asset}:${entry?.at || Date.now()}`;
      const record_ = {
        id: String(id),
        action: String(entry?.action || 'unknown'),
        asset: entry?.asset ?? null,
        amount: entry?.amount ?? null,
        amountWei: entry?.amountWei != null ? String(entry.amountWei) : null,
        chainId: entry?.chainId != null ? Number(entry.chainId) : null,
        protocol: entry?.protocol || 'aave-v3',
        wallet: entry?.wallet ? String(entry.wallet).toLowerCase() : null,
        hash: entry?.hash || null,
        status,
        code: entry?.code ?? null,
        message: entry?.message ?? null,
        at: Number(entry?.at) || Date.now(),
        /* `updatedAt` starts at the entry's own time, not at "now": reconcile()
           uses it to age a PENDING entry out to UNKNOWN (§27), and stamping it
           with the current time on insert would make every abandoned pending
           transaction look permanently fresh. */
        updatedAt: Number(entry?.at) || Date.now()
      };
      const entries = read();
      const index = entries.findIndex((e) => e.id === record_.id);
      if (index >= 0) {
        /* An update (e.g. the hash arriving after the signature) is happening
           NOW, so it re-stamps the age clock. */
        entries[index] = { ...entries[index], ...record_, updatedAt: Date.now() };
      } else {
        entries.unshift(record_);
      }
      write(entries);
      return index >= 0 ? entries[index] : record_;
    },
    /** Move an entry to a terminal status once the chain has answered. */
    settle(id, { status, hash = null, code = null, message = null } = {}) {
      const entries = read();
      const index = entries.findIndex((e) => e.id === id);
      if (index < 0) return null;
      entries[index] = {
        ...entries[index],
        hash: hash || entries[index].hash,
        status: TX_STATUS[status] ? status : TX_STATUS.UNKNOWN,
        code: code ?? entries[index].code,
        message: message ?? entries[index].message,
        updatedAt: Date.now()
      };
      write(entries);
      return entries[index];
    },
    /** Nothing may be pending forever (§27's UNKNOWN status exists for this). */
    reconcile({ olderThanMs = 10 * 60 * 1000 } = {}) {
      const entries = read();
      const cutoff = Date.now() - Number(olderThanMs);
      let changed = false;
      for (const entry of entries) {
        if (entry.status === TX_STATUS.PENDING && Number(entry.updatedAt || entry.at || 0) < cutoff) {
          entry.status = TX_STATUS.UNKNOWN;
          entry.updatedAt = Date.now();
          entry.code = entry.code || 'TRANSACTION_PENDING';
          changed = true;
        }
      }
      if (changed) write(entries);
      return entries;
    },
    clear({ wallet = null } = {}) {
      if (!wallet) { write([]); return; }
      write(read().filter((e) => String(e.wallet || '').toLowerCase() !== String(wallet).toLowerCase()));
    }
  };
}
