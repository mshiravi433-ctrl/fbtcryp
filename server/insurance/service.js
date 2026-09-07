/**
 * FBT Insurance OS — Aggregation Engine (§4, §40, §9, §3).
 *
 * Cross-provider orchestration: discovery, eligibility, quoting with provider
 * health gating and fallback, purchase-intent + prepared tx, provider health
 * probing. Never recommends an unhealthy provider for a new purchase (§28).
 * Never invents a quote: if no eligible provider answers, it returns a
 * structured "no eligible protection currently available" — it does not make
 * one up (§40).
 */
import {
  getProvider, listProviders, quotingProviders, healthOf, noteHealth,
  providerAdapter
} from './provider-registry.js';
import { toMicro, fromMicro, PROVIDER_STATUS } from './constants.js';
import { productEligible, buildQuote, isQuoteValid } from './quote-engine.js';
import * as store from './store.js';
import { emit } from './events.js';

export { getProvider, listProviders };

/* ------------------------------ health probe ------------------------------ */
export async function probeProviderHealth(id) {
  const p = getProvider(id);
  if (!p) return null;
  try {
    const h = await p.adapter.health();
    const change = noteHealth(id, {
      status: h?.ok ? (h?.status || PROVIDER_STATUS.HEALTHY) : PROVIDER_STATUS.DEGRADED,
      quoteSuccessRate: h?.ok ? 1 : 0,
      detail: h?.note || h?.reason || null
    });
    if (change && change.from !== change.to) {
      await emit({ type: 'ProviderHealthChanged', providerId: id, payload: change });
    }
    return healthOf(id);
  } catch (err) {
    noteHealth(id, { status: PROVIDER_STATUS.UNAVAILABLE, quoteSuccessRate: 0, detail: String(err?.message || 'health probe failed').slice(0, 120) });
    return healthOf(id);
  }
}

export async function probeAllProviders() {
  const ids = listProviders({ includeDisabled: false }).map((p) => p.providerId);
  const out = [];
  for (const id of ids) out.push({ providerId: id, health: await probeProviderHealth(id) });
  return out;
}

/* ------------------------------ discovery -------------------------------- */
export async function discoverProducts({ chainId } = {}) {
  const rows = [];
  for (const p of quotingProviders()) {
    if (chainId && !p.supportedChains.includes(Number(chainId))) continue;
    if (healthOf(p.providerId).status === PROVIDER_STATUS.UNAVAILABLE) continue;
    let products;
    try { products = await p.adapter.getProducts(); } catch { products = []; }
    for (const prod of products || []) {
      if (chainId && !prod.supportedChains.includes(Number(chainId))) continue;
      rows.push({ ...prod, providerId: p.providerId, providerName: p.name, health: healthOf(p.providerId) });
    }
  }
  return rows;
}

/* ------------------------------ eligibility ------------------------------ */
export async function checkEligibility(input) {
  const params = normalizeQuoteInput(input);
  const answers = [];
  for (const p of quotingProviders()) {
    if (!p.supportedChains.includes(Number(params.chainId))) continue;
    if (healthOf(p.providerId).status === PROVIDER_STATUS.UNAVAILABLE) continue;
    const products = await p.adapter.getProducts().catch(() => []);
    const e = productEligible(products, params);
    let provider = { eligible: e.eligible, reason: e.reason };
    if (e.eligible) {
      const pe = await p.adapter.checkEligibility(params).catch(() => ({ eligible: false, reason: 'ADAPTER_ERROR' }));
      provider = pe;
    }
    answers.push({ providerId: p.providerId, providerName: p.name, ...provider });
  }
  return answers;
}

/* ------------------------------ normalisation ---------------------------- */
export function normalizeQuoteInput(body) {
  const amount = body.coverageAmountMicro ?? body.coverageAmount;
  return {
    walletAddress: String(body.walletAddress || '').toLowerCase(),
    chainId: Number(body.chainId ?? body.network),
    protocol: body.protocol || null,
    asset: body.asset || null,
    protectionType: String(body.protectionType || body.coverageType || body.kind || 'smart-contract'),
    productId: body.productId || null,
    coverageAmountMicro: typeof amount === 'bigint' ? amount : toMicro(amount),
    durationDays: Number(body.durationDays ?? body.duration ?? 30),
    deductibleMicro: body.deductibleMicro != null ? toMicro(body.deductibleMicro) : null,
    providerId: body.providerId || null,
    currency: body.currency || 'usdc',
    termsAccepted: body.termsAccepted === true,
    networkFeeMicro: body.networkFeeMicro != null ? toMicro(body.networkFeeMicro) : undefined
  };
}

/* ------------------------------ quoting ---------------------------------- */
/**
 * aggregateQuotes(input) -> { ok, quotes:[], none:boolean, reason? }
 * If a specific provider is requested and it fails, it is skipped; only healthy
 * eligible providers are quoted. Returns sandbox + future providers together.
 */
export async function aggregateQuotes(body) {
  const params = normalizeQuoteInput(body);
  const providers = params.providerId
    ? quotingProviders().filter((p) => p.providerId === params.providerId)
    : quotingProviders();

  const quotes = [];
  const failures = [];
  for (const p of providers) {
    if (!p.supportedChains.includes(Number(params.chainId))) continue;
    if (healthOf(p.providerId).status === PROVIDER_STATUS.UNAVAILABLE) {
      failures.push({ providerId: p.providerId, reason: 'PROVIDER_UNAVAILABLE' });
      continue;
    }
    const products = await p.adapter.getProducts().catch(() => []);
    const e = productEligible(products, params);
    if (!e.eligible) { failures.push({ providerId: p.providerId, reason: e.reason }); continue; }
    try {
      const raw = await p.adapter.getQuote(params);
      if (!raw?.ok) { failures.push({ providerId: p.providerId, reason: raw?.error || 'QUOTE_FAILED' }); continue; }
      const quote = buildQuote({
        provider: { ...publicBrief(p), adapter: undefined, healthStatus: healthOf(p.providerId).status },
        product: e.product,
        params: { ...params, coverageAmountMicro: raw.cover?.amountMicro ?? params.coverageAmountMicro },
        premiumMicro: raw.premiumMicro,
        network: Number(params.chainId),
        currency: params.currency,
        productTerms: e.product,
        raw: raw.raw || null
      });
      quote.providerStatus = p.status;
      quote.termsUrl = e.product?.termsUrl || p.termsUrl || null;
      quote.annexUrl = e.product?.annexUrl || null;
      quote.sandbox = p.status === 'SANDBOX';
      quote.estimatedGas = raw.estimatedGas || null;
      await store.set('quotes', quote.quoteId, quote);
      await emit({ type: 'InsuranceQuoteCreated', wallet: params.walletAddress, providerId: p.providerId, quoteId: quote.quoteId, payload: { quoteId: quote.quoteId, provider: p.providerId } });
      quotes.push(quote);
    } catch (err) {
      failures.push({ providerId: p.providerId, reason: String(err?.message || 'QUOTE_ERROR').slice(0, 120) });
    }
  }
  if (quotes.length === 0) {
    return {
      ok: false,
      none: true,
      reason: 'No eligible protection is currently available.',
      detail: failures
    };
  }
  return { ok: true, none: false, quotes, failures, wallet: params.walletAddress, chainId: params.chainId, at: Date.now() };
}

function publicBrief(p) {
  return {
    providerId: p.providerId,
    name: p.name,
    displayName: p.displayName,
    settlementModel: p.settlementModel,
    commissionModel: p.commissionModel,
    contractAddresses: p.contractAddresses,
    riskScore: p.riskScore,
    healthStatus: healthOf(p.providerId).status
  };
}

export async function getQuote(quoteId) {
  const q = await store.get('quotes', quoteId);
  if (!q) return { ok: false, error: 'QUOTE_NOT_FOUND' };
  if (!isQuoteValid(q)) {
    await emit({ type: 'InsuranceQuoteExpired', quoteId });
    return { ok: false, error: 'QUOTE_EXPIRED', quoteId };
  }
  return { ok: true, quote: q };
}

/* ---------------------------- fee display -------------------------------- */
export function usd(micro) { try { return fromMicro(micro); } catch { return String(micro); } }
