/**
 * FBT Insurance OS — HTTP router (production). Mounted at /api/insurance.
 *
 * Every response uses the STANDARD ENVELOPE (requestId / timestamp / version /
 * data / warnings / errors / source / freshness) so the UI can always show
 * where a number came from and how old it is.
 *
 * Non-custodial by construction: money paths end at a PREPARED, UNSIGNED
 * payload the user's wallet signs (§54). Claims/payouts are decided and
 * verified through the engines — never from the frontend, never auto-approved.
 *
 * ADMIN: /admin/* routes are NOT public in production. They exist only when
 * INSURANCE_ADMIN_KEY is configured (and must be multisig-operated); otherwise
 * they answer 404 so no admin surface is even discoverable.
 */
import express from 'express';
import { setupProviders, listConfiguredProviderIds } from './adapters/index.js';
import {
  listProviders, getProvider, healthOf, noteHealth, providerAdapter, quotingProviders
} from './provider-registry.js';
import { probeAllProviders } from './service.js';
import * as store from './store.js';
import * as service from './service.js';
import * as coverageApi from './coverage.js';
import * as claimsApi from './claims.js';
import * as monitoring from './monitoring.js';
import { protectPortfolio } from './protect-portfolio.js';
import { analysePortfolioRisk, coverageGap } from './risk-engine.js';
import { recentEvents, auditLog } from './store.js';
import { rankQuotes, recommendable } from './recommendation.js';
import { verifyEvmReceipt, verificationMode } from './verification.js';
import { respondOk, respondError, SOURCES } from './envelope.js';
import {
  isProduction, INSURANCE_ADMIN_KEY, productionSafetySnapshot,
  FBT_PROTECTION_POOL_ENABLED, INSURANCE_AUTO_PURCHASE, INSURANCE_CUSTODY_ENABLED,
  OPENCOVER_REGISTRY_ENABLED
} from './env.js';
import { REGISTRY_META, listVaultRows } from './adapters/opencover.js';

setupProviders();

/** JSON-safe serialiser: BigInt money values are returned as strings (§46). */
function safe(obj) {
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(safe);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = safe(obj[k]);
    return out;
  }
  return obj;
}

const ADMIN_KEY = INSURANCE_ADMIN_KEY;

function adminAuth(req, res, next) {
  // Production: without a configured key the admin surface does not exist.
  if (!ADMIN_KEY) {
    return respondError(res, isProduction ? 404 : 403, isProduction ? 'NOT_FOUND' : 'ADMIN_DISABLED',
      isProduction
        ? 'Admin routes are disabled in production. Operations require INSURANCE_ADMIN_KEY (multisig-operated).'
        : 'Set INSURANCE_ADMIN_KEY to enable admin routes. Production admin actions must be multisig-gated.');
  }
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (token !== ADMIN_KEY) return respondError(res, 401, 'UNAUTHORIZED', 'invalid admin key');
  req.admin = { actor: 'insurance-admin' };
  next();
}

async function paused(req, res, next) {
  const state = (await store.get('admin', 'global')) || {};
  if (state.paused) return respondError(res, 503, 'INSURANCE_PAUSED', 'Insurance is in emergency pause. No new purchases.');
  next();
}

/** Provider meta map for ranking (health, latency, audit, status). */
function providerMetaMap() {
  const map = {};
  for (const p of listProviders()) {
    const h = healthOf(p.providerId);
    map[p.providerId] = { ...h, auditStatus: p.auditStatus, riskScore: p.riskScore, status: p.status };
  }
  return map;
}

export function insuranceRouter() {
  const r = express.Router();
  // Serialise BigInt money fields as strings for the client (§46).
  r.use((req, res, next) => {
    const orig = res.json.bind(res);
    res.json = (body) => orig(safe(body));
    next();
  });

  r.get('/capabilities', (_req, res) => {
    const providers = listProviders();
    const live = providers.filter((p) => p.status === 'LIVE' && p.enabled);
    respondOk(res, {
      module: 'insurance',
      capabilities: [
        'providers', 'products', 'quote', 'compare', 'recommend', 'eligibility',
        'purchase-intent', 'coverage', 'claims', 'risk', 'coverage-gap',
        'vault-registry', 'protect-portfolio', 'events'
      ],
      liveProviders: live.map((p) => p.providerId),
      sandboxProviders: providers.filter((p) => p.status === 'SANDBOX').map((p) => p.providerId),
      production: productionSafetySnapshot(),
      autoExecuteAllowed: false, // hard: AI/automation can never purchase (§ INSURANCE_AUTO_PURCHASE)
      custodyEnabled: INSURANCE_CUSTODY_ENABLED ? true : false,
      protectionPoolEnabled: FBT_PROTECTION_POOL_ENABLED,
      settlement: 'non-custodial / direct-to-provider / user-signed'
    }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  /* ------------------------------ discovery ------------------------------ */

  r.get('/providers', async (_req, res) => {
    respondOk(res, { providers: listProviders() }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  r.get('/provider-health', async (_req, res) => {
    const health = await probeAllProviders();
    respondOk(res, {
      verificationMode: 'per-chain (LIVE when an RPC endpoint answers)',
      production: productionSafetySnapshot(),
      providers: health
    }, { source: SOURCES.PROVIDER_API, fetchedAt: Date.now(), ttlMs: 60_000 });
  });

  r.get('/providers/:provider/health', async (req, res) => {
    const p = getProvider(req.params.provider);
    if (!p) return respondError(res, 404, 'PROVIDER_NOT_FOUND', req.params.provider);
    const health = await service.probeProviderHealth(p.providerId);
    respondOk(res, { providerId: p.providerId, health }, { source: SOURCES.PROVIDER_API, fetchedAt: Date.now(), ttlMs: 60_000 });
  });

  r.get('/products', async (req, res) => {
    const chainId = req.query.chainId ? Number(req.query.chainId) : null;
    let products = [];
    const failures = [];
    for (const p of quotingProviders()) {
      if (chainId && !p.supportedChains.includes(chainId)) continue;
      const h = healthOf(p.providerId);
      if (h.status === 'UNAVAILABLE') { failures.push({ providerId: p.providerId, code: 'PROVIDER_UNAVAILABLE' }); continue; }
      try {
        const rows = await p.adapter.getProducts();
        for (const prod of rows) {
          if (chainId && !(prod.supportedChains || []).includes(chainId)) continue;
          products.push({
            ...prod,
            providerId: p.providerId,
            providerName: p.name,
            providerStatus: p.status,
            health: h,
            source: SOURCES.PROVIDER_API,
            fetchedAt: Date.now()
          });
        }
      } catch (err) {
        failures.push({ providerId: p.providerId, code: err?.code || 'PRODUCTS_FETCH_FAILED', detail: String(err?.message || '').slice(0, 160) });
      }
    }
    respondOk(res, {
      products,
      providers: quotingProviders().map((p) => ({ providerId: p.providerId, name: p.name, status: p.status })),
      failures
    }, {
      source: products.length ? SOURCES.PROVIDER_API : SOURCES.NONE,
      warnings: products.length === 0 && failures.length ? ['PROVIDER_TEMPORARILY_UNAVAILABLE'] : []
    });
  });

  r.get('/products/:id', async (req, res) => {
    const chainId = req.query.chainId ? Number(req.query.chainId) : null;
    const products = await service.discoverProducts({ chainId });
    const product = products.find((p) => p.id === req.params.id || p.providerProductId === req.params.id);
    if (!product) return respondError(res, 404, 'PRODUCT_NOT_FOUND', req.params.id);
    respondOk(res, { product }, { source: SOURCES.PROVIDER_API, fetchedAt: Date.now() });
  });

  /* ------------------------- eligibility + quoting ------------------------ */

  r.post('/eligibility', paused, async (req, res) => {
    const answers = await service.checkEligibility(req.body || {});
    respondOk(res, { answers, wallet: String(req.body?.walletAddress || '').toLowerCase() }, { source: SOURCES.PROVIDER_API, fetchedAt: Date.now() });
  });

  r.post('/quote', paused, async (req, res) => {
    const result = await service.aggregateQuotes(req.body || {});
    if (!result.ok) {
      return respondError(res, 200, 'NO_ELIGIBLE_PROTECTION', result.reason || 'No eligible protection is currently available.', {
        data: { detail: result.detail || [], providerTemporarilyUnavailable: true },
        warnings: ['LIVE_QUOTE_NOT_AVAILABLE']
      });
    }
    respondOk(res, { ...result, providerMeta: providerMetaMap() }, { source: SOURCES.PROVIDER_API, fetchedAt: Date.now() });
  });

  /** Compare providers — ranked by the multi-factor ProviderScoreEngine. */
  r.post('/compare', paused, async (req, res) => {
    const result = await service.aggregateQuotes(req.body || {});
    if (!result.ok) {
      return respondError(res, 200, 'NO_ELIGIBLE_PROTECTION', result.reason || 'No eligible protection is currently available.', {
        data: { detail: result.detail || [] },
        warnings: ['LIVE_QUOTE_NOT_AVAILABLE']
      });
    }
    const ranked = rankQuotes(result.quotes, { preferences: req.body?.preferences || {}, providerMeta: providerMetaMap() });
    respondOk(res, { quotes: ranked, wallet: result.wallet, chainId: result.chainId }, { source: SOURCES.PROVIDER_API, fetchedAt: Date.now() });
  });

  /** Recommend — coverage-gap aware ranking; NEVER executes a purchase. */
  r.post('/recommend', paused, async (req, res) => {
    const exposures = Array.isArray(req.body?.exposures) ? req.body.exposures : [];
    const coverage = Array.isArray(req.body?.activeCoverage) ? req.body.activeCoverage : [];
    const risk = analysePortfolioRisk({ exposures, activeCoverage: coverage });
    const gap = coverageGap(risk);
    const result = await service.aggregateQuotes({ ...(req.body || {}), providerId: null });
    const providers = listProviders();
    const providerMeta = providerMetaMap();
    const purchasable = (result.quotes || []).filter((q) => {
      const p = providers.find((x) => x.providerId === q.provider);
      return recommendable(p?.status, q.providerHealth) && recommendable(p?.status, p?.healthStatus);
    });
    const ranked = rankQuotes(purchasable, { preferences: req.body?.preferences || {}, providerMeta });
    respondOk(res, {
      portfolioRisk: risk.overallRiskBand,
      coverageGap: gap.coverageGapUsd,
      coverageGapDetail: gap,
      recommendedCoverage: ranked.slice(0, 3),
      protectionPriority: risk.kinds.filter((k) => k.gapMicro !== '0' && k.gapMicro !== 0).map((k) => ({ kind: k.kind, gapUsd: k.gapUsd, riskBand: k.riskBand })),
      sources: [{ name: 'provider-quotes', source: SOURCES.PROVIDER_API }, { name: 'portfolio-risk', source: SOURCES.DATABASE_CACHE }]
    }, { source: SOURCES.PROVIDER_API, fetchedAt: Date.now(), warnings: ranked.length === 0 ? ['NO_ELIGIBLE_PROVIDER_FOR_RECOMMENDATION'] : [] });
  });

  r.get('/quotes/:id', async (req, res) => {
    const q = await service.getQuote(req.params.id);
    if (!q.ok) {
      return respondError(res, 410, q.error || 'QUOTE_UNAVAILABLE', q.error === 'QUOTE_EXPIRED' ? 'Quote expired — request a fresh one.' : 'Quote not found.', { warnings: ['QUOTE_EXPIRED'] });
    }
    respondOk(res, q, { source: SOURCES.DATABASE_CACHE, fetchedAt: q.quote?.quoteUpdatedAt || Date.now() });
  });

  /* ----------------------------- purchase -------------------------------- */

  r.post('/purchase-intent', paused, async (req, res) => {
    try {
      const out = await coverageApi.createPurchaseIntent({
        quoteId: req.body?.quoteId,
        walletAddress: req.body?.walletAddress,
        idempotencyKey: req.body?.idempotencyKey || req.headers?.['idempotency-key'],
        recipient: req.body?.recipient
      });
      respondOk(res, out, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
    } catch (err) {
      const code = err?.code || 'PURCHASE_INTENT_FAILED';
      const status = code === 'QUOTE_NOT_FOUND' || code === 'QUOTE_EXPIRED' ? 410 : 400;
      respondError(res, status, code, err?.message, { warnings: code === 'SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION' ? ['SANDBOX_DISABLED_IN_PRODUCTION'] : [] });
    }
  });

  /** Verify the signed transaction against the chain, then activate coverage. */
  r.post('/transaction/activate', paused, async (req, res) => {
    try {
      const out = await coverageApi.activateCoverage({
        coverageId: req.body?.coverageId,
        owner: req.body?.owner || req.body?.walletAddress,
        txHash: req.body?.txHash,
        chainId: req.body?.chainId,
        idempotencyKey: req.body?.idempotencyKey
      });
      respondOk(res, out, { source: SOURCES.BLOCKCHAIN, fetchedAt: Date.now(), ttlMs: 0 });
    } catch (err) {
      respondError(res, 400, err?.code || 'ACTIVATION_FAILED', err?.message, {
        data: { reason: err?.reason || null },
        warnings: err?.code === 'COVERAGE_NOT_VERIFIED' ? ['RECEIPT_NOT_VERIFIED_NO_ACTIVATION'] : []
      });
    }
  });

  /** Independent receipt verification without activating (transparency tool). */
  r.post('/transaction/verify', async (req, res) => {
    const { chainId, txHash, expectTo, expectNftContract, expectOwner } = req.body || {};
    if (!chainId || !txHash) return respondError(res, 400, 'CHAIN_AND_TXHASH_REQUIRED');
    const out = await verifyEvmReceipt({
      chainId: Number(chainId), txHash,
      expect: { to: expectTo || null, nftContract: expectNftContract || null, nftRecipient: expectOwner || null }
    });
    respondOk(res, { verification: out, mode: verificationMode(chainId) }, { source: SOURCES.BLOCKCHAIN, fetchedAt: Date.now(), ttlMs: 0 });
  });

  /* ------------------------------ coverage ------------------------------- */

  r.get('/coverage', async (req, res) => {
    const owner = String(req.query?.wallet || req.query?.owner || '').toLowerCase();
    if (!owner) return respondError(res, 400, 'WALLET_REQUIRED', 'wallet query parameter required');
    const rows = await coverageApi.listCoverages(owner);
    const summary = await coverageApi.dashboard(owner);
    respondOk(res, { owner, summary, coverages: rows }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  r.get('/coverage/:id', async (req, res) => {
    const owner = String(req.query?.wallet || req.query?.owner || '').toLowerCase();
    const cov = await coverageApi.getCoverage(req.params.id, owner || undefined);
    if (!cov) return respondError(res, 404, 'COVERAGE_NOT_FOUND', req.params.id);
    respondOk(res, { coverage: cov }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  r.post('/renew', paused, async (req, res) => {
    try {
      const out = await coverageApi.renewCoverage({
        coverageId: req.body?.coverageId, owner: req.body?.walletAddress,
        durationDays: req.body?.durationDays || req.body?.duration, idempotencyKey: req.body?.idempotencyKey
      });
      respondOk(res, out, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
    } catch (err) { respondError(res, 400, err?.code || 'RENEW_FAILED', err?.message); }
  });

  r.post('/cancel', paused, async (req, res) => {
    try {
      const out = await coverageApi.cancelCoverage({ coverageId: req.body?.coverageId, owner: req.body?.walletAddress });
      respondOk(res, { coverage: out }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
    } catch (err) { respondError(res, 400, err?.code || 'CANCEL_FAILED', err?.message); }
  });

  /* ------------------------------- claims -------------------------------- */

  r.post('/claim', paused, async (req, res) => {
    try {
      const claim = await claimsApi.createClaim({
        coverageId: req.body?.coverageId, owner: req.body?.walletAddress,
        incidentType: req.body?.incidentType, description: req.body?.description,
        affectedAmountMicro: req.body?.affectedAmountMicro ?? req.body?.amountMicro,
        evidence: req.body?.evidence, evidenceHash: req.body?.evidenceHash
      });
      respondOk(res, { claim }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
    } catch (err) { respondError(res, 400, err?.code || 'CLAIM_CREATE_FAILED', err?.message); }
  });
  r.post('/claim/:id/submit', paused, async (req, res) => {
    try {
      const claim = await claimsApi.submitClaim({ claimId: req.params.id, owner: req.body?.walletAddress, evidenceHash: req.body?.evidenceHash, incidentTimestamp: req.body?.incidentTimestamp });
      respondOk(res, { claim }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
    } catch (err) { respondError(res, 400, err?.code || 'CLAIM_SUBMIT_FAILED', err?.message); }
  });
  r.get('/claims', async (req, res) => {
    const owner = String(req.query?.wallet || '').toLowerCase();
    if (!owner) return respondError(res, 400, 'WALLET_REQUIRED', 'wallet query parameter required');
    respondOk(res, { owner, claims: await claimsApi.listClaims(owner) }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });
  r.get('/claims/:id', async (req, res) => {
    const owner = String(req.query?.wallet || '').toLowerCase();
    const claim = await claimsApi.getClaim(req.params.id, owner || undefined);
    if (!claim) return respondError(res, 404, 'CLAIM_NOT_FOUND', req.params.id);
    respondOk(res, { claim }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  /* -------------------------------- risk --------------------------------- */

  r.post('/risk', async (req, res) => {
    const exposures = Array.isArray(req.body?.exposures) ? req.body.exposures : [];
    const coverage = Array.isArray(req.body?.activeCoverage) ? req.body.activeCoverage : [];
    const risk = analysePortfolioRisk({ exposures, activeCoverage: coverage });
    respondOk(res, {
      ...risk,
      gap: coverageGap(risk),
      portfolioRisk: risk.overallRiskBand,
      sources: [{ name: 'user-reported-exposures', source: SOURCES.DATABASE_CACHE }]
    }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  r.get('/coverage-gap', async (req, res) => {
    const owner = String(req.query?.wallet || '').toLowerCase();
    const coverage = owner ? await coverageApi.listCoverages(owner) : [];
    const exposures = Array.isArray(req.query?.exposuresJson) ? JSON.parse(String(req.query.exposuresJson)) : (Array.isArray(req.body?.exposures) ? req.body.exposures : []);
    const risk = analysePortfolioRisk({ exposures, activeCoverage: coverage.filter((c) => c.status === 'ACTIVE').map((c) => ({ kind: c.protectionType, amountMicro: c.coverageAmountMicro })) });
    respondOk(res, {
      portfolioRisk: risk.overallRiskBand,
      gap: coverageGap(risk),
      kinds: risk.kinds,
      note: 'Coverage Gap = Eligible Exposure − Existing Coverage. Balances are client-supplied; the server never invents exposure.'
    }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  r.get('/portfolio-exposure', async (req, res) => {
    const owner = String(req.query?.wallet || '').toLowerCase();
    if (!owner) return respondError(res, 400, 'WALLET_REQUIRED', 'wallet query parameter required');
    const rows = await coverageApi.listCoverages(owner);
    respondOk(res, {
      owner,
      note: 'Eligible exposure requires client-supplied balances (server never invents balances). Provide exposures via POST /risk or the protect-portfolio intent.',
      coverages: rows
    }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  /* ---------------------------- intent / brain --------------------------- */

  r.post('/intent/protect-portfolio', paused, async (req, res) => {
    try {
      const out = await protectPortfolio(req.body || {});
      respondOk(res, out, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now(), warnings: out.autoExecute === false ? ['AUTO_PURCHASE_DISABLED'] : [] });
    } catch (err) { respondError(res, 400, err?.code || 'INTENT_FAILED', err?.message); }
  });

  /* ------------------------- vault coverage registry --------------------- */

  r.get('/vaults', async (req, res) => {
    if (!OPENCOVER_REGISTRY_ENABLED) {
      return respondError(res, 404, 'REGISTRY_DISABLED', 'OpenCover registry disabled by configuration');
    }
    const nexus = getProvider('nexus-mutual');
    const nexusAdapter = nexus?.adapter;
    const chainId = req.query.chainId ? Number(req.query.chainId) : null;
    const rows = await listVaultRows({
      chainId,
      nexusCapacity: nexusAdapter ? async (pid) => nexusAdapter.capacity(pid) : null
    });
    const liveLookups = rows.filter((x) => !x.stale).length;
    respondOk(res, {
      registry: REGISTRY_META,
      note: 'OpenCover is a Verified Vault Coverage Registry (reference links), not a quoting provider. Capacity is fetched live from the Nexus Mutual capacity API; rows without a live lookup report UNKNOWN.',
      vaults: rows
    }, {
      source: SOURCES.REGISTRY,
      fetchedAt: Date.now(),
      ttlMs: 120_000,
      warnings: liveLookups === 0 ? ['CAPACITY_UNAVAILABLE', 'STALE_DATA_REFRESH_REQUIRED'] : []
    });
  });

  /* --------------------------- internal FBT pool -------------------------- */

  r.get('/pool', async (_req, res) => {
    respondOk(res, {
      enabled: FBT_PROTECTION_POOL_ENABLED,
      status: FBT_PROTECTION_POOL_ENABLED ? 'UNKNOWN' : 'DISABLED',
      detail: FBT_PROTECTION_POOL_ENABLED
        ? 'Pool feature flag is on but the pool remains uncapitalised and unaudited — no deposits, no APY claims.'
        : 'The FBT internal protection pool is disabled. FBT is a marketplace, not an insurer; coverage comes from external providers.',
      blockedFunctions: ['depositCapital', 'withdrawCapital', 'allocateReserve', 'approveClaim', 'payClaim'],
      prerequisites: ['Legal Review', 'Independent Audit', 'Capitalization', 'Reserve Design', 'Claims Governance', 'Solvency Model', 'Jurisdiction Configuration']
    }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  r.get('/pool/solvency', async (_req, res) => {
    respondOk(res, {
      enabled: FBT_PROTECTION_POOL_ENABLED,
      solvencyModel: 'NOT_CONFIGURED',
      reserves: 'UNKNOWN',
      coverageRatio: 'UNKNOWN',
      detail: 'No solvency figures exist or are claimed while the internal pool is disabled. Coverage obligations sit with external providers, not with FBT.'
    }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  /* ------------------------------ incidents ------------------------------ */

  r.get('/incidents', async (_req, res) => {
    respondOk(res, { incidents: await monitoring.listIncidents() }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  r.get('/events', async (req, res) => {
    const n = Number(req.query?.limit || 50);
    respondOk(res, { events: await recentEvents(Math.min(n, 300)) }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  /* ------------------------------- admin --------------------------------- */
  /* Not part of the user UI. Not public in production without a key. */

  r.post('/admin/incidents', adminAuth, async (req, res) => {
    const out = await monitoring.registerIncident(req.body || {});
    await auditLog({ actor: 'insurance-admin', action: 'INCIDENT_REGISTERED', resource: out.incident.incidentId, newValue: { protectionType: out.incident.protectionType } });
    respondOk(res, out, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  r.post('/admin/claims/:id/decide', adminAuth, async (req, res) => {
    try {
      const claim = await claimsApi.decideClaim({
        claimId: req.params.id, decision: req.body?.decision,
        payoutAmountMicro: req.body?.payoutAmountMicro, note: req.body?.note, actor: req.admin.actor
      });
      await auditLog({ actor: req.admin.actor, action: 'CLAIM_DECIDED', resource: claim.claimId, newValue: { status: claim.status } });
      respondOk(res, { claim }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
    } catch (err) { respondError(res, 400, err?.code || 'DECIDE_FAILED', err?.message); }
  });

  r.post('/admin/claims/:id/record-payout', adminAuth, async (req, res) => {
    try {
      const out = await claimsApi.recordPayout({
        claimId: req.params.id, txHash: req.body?.txHash, amountMicro: req.body?.amountMicro,
        recipient: req.body?.recipient, chainId: req.body?.chainId, idempotencyKey: req.body?.idempotencyKey
      });
      await auditLog({ actor: req.admin.actor, action: 'PAYOUT_RECORDED', resource: req.params.id, newValue: { txHash: req.body?.txHash } });
      respondOk(res, out, { source: SOURCES.BLOCKCHAIN, fetchedAt: Date.now(), ttlMs: 0 });
    } catch (err) { respondError(res, 400, err?.code || 'PAYOUT_RECORD_FAILED', err?.message); }
  });

  r.post('/admin/providers/:id/enable', adminAuth, async (req, res) => {
    const p = getProvider(req.params.id);
    if (!p) return respondError(res, 404, 'PROVIDER_NOT_FOUND', req.params.id);
    const enabled = req.body?.enabled !== false;
    p.enabled = enabled && p.configured;
    await auditLog({ actor: req.admin.actor, action: 'PROVIDER_ENABLED_CHANGED', resource: p.providerId, newValue: { enabled: p.enabled } });
    respondOk(res, { providerId: p.providerId, enabled: p.enabled }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  r.post('/admin/pause', adminAuth, async (req, res) => {
    const pausedNow = req.body?.paused === true;
    const state = (await store.get('admin', 'global')) || {};
    state.paused = pausedNow;
    state.updatedAt = Date.now();
    await store.set('admin', 'global', state);
    await auditLog({ actor: req.admin.actor, action: pausedNow ? 'EMERGENCY_PAUSE_ON' : 'EMERGENCY_PAUSE_OFF', resource: 'global' });
    respondOk(res, { paused: pausedNow }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  r.get('/admin/dashboard', adminAuth, async (_req, res) => {
    respondOk(res, {
      providers: listProviders(),
      events: (await recentEvents(100)),
      production: productionSafetySnapshot(),
      note: 'Aggregate analytics (premium volume, loss ratio, provider concentration) are computed from durable records once live providers are integrated.'
    }, { source: SOURCES.DATABASE_CACHE, fetchedAt: Date.now() });
  });

  return r;
}

export default insuranceRouter;
