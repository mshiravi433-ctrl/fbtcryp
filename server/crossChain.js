/**
 * CROSS-CHAIN SERVICE — the server half of the shared engine.
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 * `/api/intents/v1/bridge-quote` used to answer with this:
 *
 *     estimatedOutput: amount || '999000', fee: '1000', estimatedTime: 120
 *
 * — a literal, written in a file whose own comment said "in production this
 * would call LiFi/DeBridge". The Intent OS «نرخ پل» button rendered it as a
 * live rate. That endpoint now calls THIS module, which calls LI.FI, or
 * returns an error. There is no third outcome and no default number.
 *
 * ─── ONE ENGINE, TWO CALLERS ────────────────────────────────────────────────
 * /bridge (the page) and Intent OS (the cross-chain desk) both reach LI.FI
 * through here, and both normalise through src/services/cross-chain/core.js.
 * The ranking that picks a "best route", the fee itemisation, the quote expiry
 * and the status mapping are therefore identical on both surfaces — they are
 * literally the same functions.
 *
 * ─── WHAT THIS MODULE WILL NOT DO ───────────────────────────────────────────
 * It never signs, never holds a key, never submits a transaction. It returns a
 * transactionRequest that the user's own wallet signs, exactly like the swap
 * path. It also never reports COMPLETED — only `statusFromProvider()` can, and
 * only with a destination transaction hash.
 */

import { randomUUID } from 'node:crypto';
import {
  bridgeFee,
  integratorId,
  integratorStatus,
  lifiChains,
  lifiFetch,
  lifiTokens,
  lifiTools
} from './lifi.js';
import {
  isSolanaChain,
  normalizeLifiRoute,
  normalizeLifiStep,
  rankRoutes,
  statusFromProvider,
  toProviderChainId,
  validateQuoteParams
} from '../src/services/cross-chain/core.js';
import { recordQuote, recordRoutes, crossChainStoreHealth } from './crossChainStore.js';

/**
 * Chains the WALLET layer can actually sign for.
 *
 * Kept in step with src/lib/chains.js `EVM_CHAIN_ORDER` plus Solana via
 * src/lib/solanaWallet.js. Offering a chain LI.FI serves but our wallet cannot
 * sign on produces a quote the user can look at and never execute — the exact
 * "wired to nothing" failure this repo keeps having to fix. The cross-chain
 * probe asserts these two lists stay in sync.
 */
export const WALLET_SUPPORTED_CHAIN_IDS = Object.freeze([
  1,        /* Ethereum */
  10,       /* Optimism */
  56,       /* BNB Chain */
  137,      /* Polygon */
  146,      /* Sonic */
  8453,     /* Base */
  42161,    /* Arbitrum */
  43114,    /* Avalanche */
  59144,    /* Linea */
  1151111081099710 /* Solana (SVM — signed through the Solana wallet adapter) */
]);

const supportedSet = new Set(WALLET_SUPPORTED_CHAIN_IDS.map(String));

export const isWalletSupportedChain = (chainId) => supportedSet.has(String(toProviderChainId(chainId)));

/* ── chains ──────────────────────────────────────────────────────────────── */

/**
 * The chain selector's source of truth: LI.FI's own list, intersected with the
 * chains our wallet can sign for. Dynamic on both sides — a chain LI.FI drops
 * disappears from the picker without a deploy.
 */
export async function supportedChains() {
  const registry = await lifiChains();
  if (!registry.ok) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: registry.error ?? null, chains: [] };
  }
  const chains = registry.chains
    .filter((c) => supportedSet.has(String(c.id)))
    .map((c) => ({
      ...c,
      family: c.chainType === 'SVM' || isSolanaChain(c.id) ? 'SVM' : 'EVM',
      walletSupported: true
    }));
  return { ok: true, chains, provider: 'lifi' };
}

/** Tokens for one chain, straight from the provider registry. */
export async function chainTokens(chainId, { search = '', limit = 60 } = {}) {
  const id = toProviderChainId(chainId);
  if (id == null || !supportedSet.has(String(id))) return { ok: false, code: 'UNSUPPORTED_CHAIN', tokens: [] };
  const res = await lifiTokens(id);
  if (!res.ok) return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: res.error ?? null, tokens: [] };
  const needle = String(search || '').trim().toLowerCase();
  const rows = res.tokens
    .filter((t) => !needle
      || String(t.symbol || '').toLowerCase().includes(needle)
      || String(t.name || '').toLowerCase().includes(needle)
      || String(t.address || '').toLowerCase() === needle)
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 60)))
    .map((t) => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      chainId: t.chainId,
      logoURI: t.logoURI ?? null,
      priceUSD: t.priceUSD ?? null
    }));
  return { ok: true, tokens: rows, provider: 'lifi' };
}

/* ── quote ───────────────────────────────────────────────────────────────── */

function baseParams(v, { preferTool = null, order = 'RECOMMENDED' } = {}) {
  const params = new URLSearchParams();
  params.set('fromChain', String(v.fromChain));
  params.set('toChain', String(v.toChain));
  params.set('fromToken', v.fromToken);
  params.set('toToken', v.toToken);
  params.set('fromAmount', v.fromAmount);
  params.set('fromAddress', v.fromAddress);
  if (v.toAddress) params.set('toAddress', v.toAddress);
  if (v.slippage != null) params.set('slippage', String(v.slippage));
  if (preferTool) params.set('preferBridges', String(preferTool));
  params.set('order', order);
  params.set('integrator', integratorId());
  return params;
}

/**
 * One executable quote, normalised.
 *
 * ─── THE FEE RETRY, KEPT ────────────────────────────────────────────────────
 * LI.FI rejects the WHOLE request with error 1011 when the integrator is not
 * configured for fees. Showing that to a user would be blaming them for our
 * portal setup, so a failed fee-bearing quote is retried clean. The retry
 * earns nothing and `/api/health/cross-chain` reports `feeRegistered` so the
 * silence is visible to us instead of only to the accountant.
 */
export async function getQuote(input = {}, { now = Date.now(), record = true } = {}) {
  const checked = validateQuoteParams(input);
  if (!checked.ok) return { ok: false, code: checked.code };
  const v = checked.value;

  if (!isWalletSupportedChain(v.fromChain) || !isWalletSupportedChain(v.toChain)) {
    return { ok: false, code: 'UNSUPPORTED_CHAIN' };
  }

  const params = baseParams(v, { preferTool: input.preferTool, order: input.order });

  const fee = bridgeFee();
  let res = null;
  if (fee > 0) {
    const withFee = new URLSearchParams(params);
    withFee.set('fee', String(fee));
    res = await lifiFetch(`/quote?${withFee}`);
    if (!res.ok && res.body?.code === 1011) res = null; /* integrator not configured for fees */
  }
  if (!res) res = await lifiFetch(`/quote?${params}`);

  if (!res.ok) {
    return {
      ok: false,
      code: providerErrorCode(res),
      status: res.status,
      detail: String(res.body?.message || res.body?.error || '').slice(0, 200) || null
    };
  }

  const quote = normalizeLifiStep(res.body, { now });
  if (!quote) return { ok: false, code: 'PROVIDER_BAD_RESPONSE' };
  if (record) await recordQuote(quote);
  return { ok: true, quote, latencyMs: res.latencyMs ?? null };
}

/**
 * Every route the provider offers, ranked by the shared scorer.
 *
 * Deliberately NOT "take routes[0]". LI.FI's own ordering optimises for what
 * we asked (`order`), not for the user's total cost including gas, the fees
 * payable on top, the time in flight and how many hops can fail. The ranking
 * lives in the shared engine so the browser can re-rank the same way.
 */
export async function getRoutes(input = {}, { now = Date.now(), record = true } = {}) {
  /* A route list is a COMPARISON, and LI.FI's /advanced/routes does not need a
     sender — so a user who has not connected a wallet still sees real rates
     instead of a locked screen. Those routes are marked `indicative` and can
     never be signed: execution always re-quotes with a real address. */
  const requireAddress = Boolean(input.fromAddress);
  const checked = validateQuoteParams(input, { requireAddress });
  if (!checked.ok) return { ok: false, code: checked.code };
  const v = checked.value;

  if (!isWalletSupportedChain(v.fromChain) || !isWalletSupportedChain(v.toChain)) {
    return { ok: false, code: 'UNSUPPORTED_CHAIN' };
  }

  const body = {
    fromChainId: v.fromChain,
    fromAmount: v.fromAmount,
    fromTokenAddress: v.fromToken,
    ...(v.fromAddress ? { fromAddress: v.fromAddress } : {}),
    toChainId: v.toChain,
    toTokenAddress: v.toToken,
    ...(v.toAddress ? { toAddress: v.toAddress } : {}),
    options: {
      integrator: integratorId(),
      order: input.order || 'RECOMMENDED',
      ...(v.slippage != null ? { slippage: v.slippage } : {}),
      ...(bridgeFee() > 0 ? { fee: bridgeFee() } : {})
    }
  };

  let res = await lifiFetch('/advanced/routes', { method: 'POST', body });
  if (!res.ok && res.body?.code === 1011) {
    delete body.options.fee;
    res = await lifiFetch('/advanced/routes', { method: 'POST', body });
  }
  if (!res.ok) {
    return {
      ok: false,
      code: providerErrorCode(res),
      status: res.status,
      detail: String(res.body?.message || res.body?.error || '').slice(0, 200) || null
    };
  }

  const normalized = (res.body?.routes || [])
    .map((r) => normalizeLifiRoute(r, { now }))
    .filter(Boolean)
    .map((r) => ({ ...r, indicative: !v.fromAddress }));

  if (normalized.length === 0) return { ok: false, code: 'NO_ROUTE' };

  const ranked = rankRoutes(normalized);
  const requestId = randomUUID();
  if (record) await recordRoutes(requestId, ranked, { selectedQuoteId: ranked[0]?.quoteId ?? null });

  return {
    ok: true,
    requestId,
    routes: ranked,
    best: ranked[0] ?? null,
    provider: 'lifi',
    latencyMs: res.latencyMs ?? null
  };
}

function providerErrorCode(res) {
  const message = String(res?.body?.message || res?.body?.error || '');
  if (res?.status === 504) return 'UPSTREAM_TIMEOUT';
  if (/no available quotes|no routes|not found/i.test(message)) return 'NO_ROUTE';
  if (/amount|too (low|small)/i.test(message)) return 'AMOUNT_TOO_LOW';
  if (res?.status === 429) return 'PROVIDER_RATE_LIMITED';
  if (res?.status >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'QUOTE_FAILED';
}

/* ── token resolution ────────────────────────────────────────────────────── */

/**
 * Turn a SYMBOL into the real contract on that chain, using the provider's own
 * token registry.
 *
 * ─── WHY NOT A HARD-CODED TABLE ─────────────────────────────────────────────
 * src/lib/bridge.js carries a small curated stablecoin table, and that is
 * appropriate there — a wrong address sends funds nowhere recoverable, so the
 * curated list is checked by hand. But a symbol table cannot cover the token
 * the user actually holds, and a cross-chain desk that only knows USDC/USDT is
 * why people leave. The registry is the provider's, cached, and every entry
 * carries the decimals the amount conversion needs.
 *
 * If the symbol does not exist on the destination chain we return NOT_FOUND
 * and the caller must refuse — never invent a route to a token that is not
 * there (spec §10).
 */
export async function resolveToken(chainId, symbolOrAddress) {
  const id = toProviderChainId(chainId);
  if (id == null) return { ok: false, code: 'UNSUPPORTED_CHAIN' };
  const needle = String(symbolOrAddress || '').trim();
  if (!needle) return { ok: false, code: 'TOKEN_REQUIRED' };

  const registry = await lifiTokens(id);
  if (!registry.ok) return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: registry.error ?? null };

  const lower = needle.toLowerCase();
  const byAddress = registry.tokens.find((t) => String(t.address || '').toLowerCase() === lower);
  if (byAddress) return { ok: true, token: byAddress };

  const bySymbol = registry.tokens.filter((t) => String(t.symbol || '').toLowerCase() === lower);
  if (bySymbol.length === 0) return { ok: false, code: 'TOKEN_NOT_ON_CHAIN', chainId: id, symbol: needle };

  /* Several contracts can share a symbol (bridged wrappers). The one the
     provider prices is the one with real liquidity behind it. */
  const priced = bySymbol.find((t) => Number(t.priceUSD) > 0) || bySymbol[0];
  return { ok: true, token: priced };
}

/* ── status ──────────────────────────────────────────────────────────────── */

/**
 * The real bridge status, read from the provider and mapped by the shared
 * engine. Nothing here can invent a completion: `statusFromProvider()` refuses
 * to return COMPLETED without a receiving transaction hash.
 */
export async function getTransferStatus({ txHash, fromChain, toChain, tool, bridge } = {}) {
  if (!/^(0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]{64,100})$/.test(String(txHash || ''))) {
    return { ok: false, code: 'BAD_TX_HASH' };
  }
  const params = new URLSearchParams({ txHash: String(txHash) });
  const from = toProviderChainId(fromChain);
  const to = toProviderChainId(toChain);
  if (from != null) params.set('fromChain', String(from));
  if (to != null) params.set('toChain', String(to));
  const toolKey = tool || bridge;
  if (toolKey) params.set('bridge', String(toolKey));

  const res = await lifiFetch(`/status?${params}`);
  if (!res.ok) {
    /* An unknown transaction is not a failure: bridges index with a delay, and
       reporting FAILED here would turn a slow indexer into a lost transfer in
       the user's history. */
    if (res.status === 404) {
      return { ok: true, status: statusFromProvider({ status: 'NOT_FOUND' }), provider: 'lifi', indexed: false };
    }
    return { ok: false, code: providerErrorCode(res), status: res.status };
  }
  return { ok: true, status: statusFromProvider(res.body), provider: 'lifi', indexed: true, raw: res.body?.status ?? null };
}

/* ── health ──────────────────────────────────────────────────────────────── */

/**
 * GET /api/health/cross-chain answers from here.
 *
 * The point of this endpoint is stated in the spec and worth repeating: if the
 * provider is down the UI must show NOTHING rather than a stale or invented
 * rate. So every component reports `ok` plus what was actually measured, and
 * `degraded` is computed rather than asserted.
 */
export async function crossChainHealth({ deep = true } = {}) {
  const startedAt = Date.now();
  const components = [];

  const chains = await supportedChains();
  components.push({
    component: 'lifi',
    ok: chains.ok,
    detail: chains.ok ? `${chains.chains.length} wallet-signable chains` : (chains.detail || chains.code),
    chains: chains.ok ? chains.chains.length : 0
  });

  if (deep) {
    const tools = await lifiTools();
    components.push({
      component: 'bridges',
      ok: tools.ok && tools.bridges.length > 0,
      detail: tools.ok ? `${tools.bridges.length} bridges, ${tools.exchanges.length} exchanges` : (tools.error || 'unavailable'),
      bridges: tools.ok ? tools.bridges.length : 0
    });

    const integrator = await integratorStatus();
    components.push({
      component: 'integrator',
      /* Fee registration is a REVENUE fact, not an availability one: bridging
         works either way, so an unregistered integrator is reported without
         marking the surface unhealthy. */
      ok: true,
      registered: integrator.registered,
      integrator: integrator.integrator,
      keySet: integrator.keySet,
      feePercent: integrator.feePercent,
      detail: integrator.registered ? 'fee collection live' : (integrator.detail || 'integrator not registered — bridging works, revenue is zero')
    });
  }

  components.push(crossChainStoreHealth());

  /* The wallet and the indexer are client-side and provider-side facts
     respectively; reported so the audit list in the spec is complete and
     nothing is silently missing. */
  components.push({
    component: 'wallet',
    ok: true,
    detail: 'signing happens in the user wallet; the server never holds a key',
    custody: false
  });
  components.push({
    component: 'indexer',
    ok: chains.ok,
    detail: 'LI.FI /status is the transfer indexer'
  });

  const ok = components.every((c) => c.ok !== false);
  return {
    schema: 'fbt.cross-chain-health.v1',
    ok,
    degraded: !ok,
    provider: 'lifi',
    checkedAt: startedAt,
    latencyMs: Date.now() - startedAt,
    components
  };
}
