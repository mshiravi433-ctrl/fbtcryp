/**
 * FBT Insurance OS — HTTP router (§5). Mounted at /api/insurance.
 *
 * Every read/quote/prepare path is server-authoritative. Money moves end at a
 * PREPARED, unsigned payload handed to the user's wallet (§54). Claims/payouts
 * are decided and verified through the engines — never from the frontend.
 */
import express from 'express';
import { setupProviders } from './adapters/index.js';
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
import { fromMicro } from './constants.js';

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

const ADMIN_KEY = process.env.INSURANCE_ADMIN_KEY || '';

function adminAuth(req, res, next) {
  if (!ADMIN_KEY) return res.status(403).json({ ok: false, error: 'ADMIN_DISABLED', detail: 'Set INSURANCE_ADMIN_KEY to enable admin routes. Production admin actions must be multisig-gated.' });
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (token !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  req.admin = { actor: 'insurance-admin' };
  next();
}

async function paused(req, res, next) {
  const state = (await store.get('admin', 'global')) || {};
  if (state.paused) return res.status(503).json({ ok: false, error: 'INSURANCE_PAUSED', detail: 'Insurance is in emergency pause. No new purchases.' });
  next();
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
    res.json({
      ok: true,
      module: 'insurance',
      capabilities: [
        'providers', 'products', 'quote', 'eligibility', 'purchase-intent',
        'coverage', 'claims', 'renew', 'cancel', 'risk', 'portfolio-exposure',
        'protect-portfolio', 'events', 'admin'
      ],
      autoExecuteAllowed: false,
      sandboxOnly: true,
      settlement: 'non-custodial / direct-to-provider'
    });
  });

  /* ------------------------------ discovery ------------------------------ */
  r.get('/providers', async (_req, res) => {
    res.json({ ok: true, providers: listProviders() });
  });
  r.get('/providers/:provider/health', async (req, res) => {
    const p = getProvider(req.params.provider);
    if (!p) return res.status(404).json({ ok: false, error: 'PROVIDER_NOT_FOUND' });
    const health = await service.probeProviderHealth(p.providerId);
    res.json({ ok: true, providerId: p.providerId, health });
  });

  r.get('/products', async (req, res) => {
    const chainId = req.query.chainId ? Number(req.query.chainId) : null;
    const products = await service.discoverProducts({ chainId });
    res.json({ ok: true, products, providers: quotingProviders().map((p) => ({ providerId: p.providerId, name: p.name })) });
  });

  r.get('/products/:id', async (req, res) => {
    const chainId = req.query.chainId ? Number(req.query.chainId) : null;
    const products = await service.discoverProducts({ chainId });
    const product = products.find((p) => p.id === req.params.id || p.providerProductId === req.params.id);
    if (!product) return res.status(404).json({ ok: false, error: 'PRODUCT_NOT_FOUND' });
    res.json({ ok: true, product });
  });

  /* ------------------------- eligibility + quoting ------------------------ */
  r.post('/eligibility', paused, async (req, res) => {
    const answers = await service.checkEligibility(req.body || {});
    res.json({ ok: true, answers, wallet: String(req.body?.walletAddress || '').toLowerCase() });
  });

  r.post('/quote', paused, async (req, res) => {
    const result = await service.aggregateQuotes(req.body || {});
    if (!result.ok) return res.json(result); // structured "no eligible protection"
    res.json(result);
  });

  r.get('/quotes/:id', async (req, res) => {
    const q = await service.getQuote(req.params.id);
    res.status(q.ok ? 200 : 410).json(q);
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
      res.json({ ok: true, ...out });
    } catch (err) {
      const code = err?.code || 'PURCHASE_INTENT_FAILED';
      res.status(code === 'QUOTE_NOT_FOUND' || code === 'QUOTE_EXPIRED' ? 410 : 400).json({ ok: false, error: code, detail: err?.message });
    }
  });

  /** Verify the signed/settled transaction and activate coverage. */
  r.post('/transaction/activate', paused, async (req, res) => {
    try {
      const out = await coverageApi.activateCoverage({
        coverageId: req.body?.coverageId,
        owner: req.body?.owner || req.body?.walletAddress,
        txHash: req.body?.txHash,
        chainId: req.body?.chainId,
        idempotencyKey: req.body?.idempotencyKey
      });
      res.json({ ok: true, ...out });
    } catch (err) {
      const code = err?.code || 'ACTIVATION_FAILED';
      res.status(400).json({ ok: false, error: code, detail: err?.message });
    }
  });

  /* ------------------------------ coverage ------------------------------- */
  r.get('/coverage', async (req, res) => {
    const owner = String(req.query?.wallet || req.query?.owner || req.body?.walletAddress || '').toLowerCase();
    if (!owner) return res.status(400).json({ ok: false, error: 'WALLET_REQUIRED' });
    const rows = await coverageApi.listCoverages(owner);
    const summary = await coverageApi.dashboard(owner);
    res.json({ ok: true, owner, summary, coverages: rows });
  });

  r.get('/coverage/:id', async (req, res) => {
    const owner = String(req.query?.wallet || req.query?.owner || '').toLowerCase();
    const cov = await coverageApi.getCoverage(req.params.id, owner || undefined);
    if (!cov) return res.status(404).json({ ok: false, error: 'COVERAGE_NOT_FOUND' });
    res.json({ ok: true, coverage: cov });
  });

  r.post('/renew', paused, async (req, res) => {
    try {
      const out = await coverageApi.renewCoverage({
        coverageId: req.body?.coverageId, owner: req.body?.walletAddress,
        durationDays: req.body?.durationDays || req.body?.duration, idempotencyKey: req.body?.idempotencyKey
      });
      res.json({ ok: true, ...out });
    } catch (err) { res.status(400).json({ ok: false, error: err?.code || 'RENEW_FAILED', detail: err?.message }); }
  });

  r.post('/cancel', paused, async (req, res) => {
    try {
      const out = await coverageApi.cancelCoverage({ coverageId: req.body?.coverageId, owner: req.body?.walletAddress });
      res.json({ ok: true, coverage: out });
    } catch (err) { res.status(400).json({ ok: false, error: err?.code || 'CANCEL_FAILED', detail: err?.message }); }
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
      res.json({ ok: true, claim });
    } catch (err) { res.status(400).json({ ok: false, error: err?.code || 'CLAIM_CREATE_FAILED', detail: err?.message }); }
  });
  r.post('/claim/:id/submit', paused, async (req, res) => {
    try {
      const claim = await claimsApi.submitClaim({ claimId: req.params.id, owner: req.body?.walletAddress, evidenceHash: req.body?.evidenceHash, incidentTimestamp: req.body?.incidentTimestamp });
      res.json({ ok: true, claim });
    } catch (err) { res.status(400).json({ ok: false, error: err?.code || 'CLAIM_SUBMIT_FAILED', detail: err?.message }); }
  });
  r.get('/claims', async (req, res) => {
    const owner = String(req.query?.wallet || '').toLowerCase();
    if (!owner) return res.status(400).json({ ok: false, error: 'WALLET_REQUIRED' });
    res.json({ ok: true, owner, claims: await claimsApi.listClaims(owner) });
  });
  r.get('/claims/:id', async (req, res) => {
    const owner = String(req.query?.wallet || '').toLowerCase();
    const claim = await claimsApi.getClaim(req.params.id, owner || undefined);
    if (!claim) return res.status(404).json({ ok: false, error: 'CLAIM_NOT_FOUND' });
    res.json({ ok: true, claim });
  });

  /* -------------------------------- risk -------------------------------- */
  r.post('/risk', async (req, res) => {
    const exposures = Array.isArray(req.body?.exposures) ? req.body.exposures : [];
    const coverage = Array.isArray(req.body?.activeCoverage) ? req.body.activeCoverage : [];
    const risk = analysePortfolioRisk({ exposures, activeCoverage: coverage });
    res.json({ ok: true, ...risk, gap: coverageGap(risk) });
  });
  r.get('/portfolio-exposure', async (req, res) => {
    const owner = String(req.query?.wallet || '').toLowerCase();
    if (!owner) return res.status(400).json({ ok: false, error: 'WALLET_REQUIRED' });
    const rows = await coverageApi.listCoverages(owner);
    res.json({
      ok: true, owner,
      note: 'Eligible exposure requires client-supplied balances (server never invents balances). Provide exposures via POST /risk or the protect-portfolio intent.',
      coverages: rows
    });
  });

  /* ---------------------------- intent / brain --------------------------- */
  r.post('/intent/protect-portfolio', paused, async (req, res) => {
    try {
      const out = await protectPortfolio(req.body || {});
      res.json({ ok: true, ...out });
    } catch (err) { res.status(400).json({ ok: false, error: err?.code || 'INTENT_FAILED', detail: err?.message }); }
  });

  /* ------------------------------ incidents ------------------------------ */
  r.get('/incidents', async (_req, res) => {
    res.json({ ok: true, incidents: await monitoring.listIncidents() });
  });

  /* -------------------------------- events ------------------------------- */
  r.get('/events', async (req, res) => {
    const n = Number(req.query?.limit || 50);
    res.json({ ok: true, events: await recentEvents(Math.min(n, 300)) });
  });

  /* ------------------------------- admin --------------------------------- */
  r.post('/admin/incidents', adminAuth, async (req, res) => {
    const out = await monitoring.registerIncident(req.body || {});
    await auditLog({ actor: 'insurance-admin', action: 'INCIDENT_REGISTERED', resource: out.incident.incidentId, newValue: { protectionType: out.incident.protectionType } });
    res.json({ ok: true, ...out });
  });

  r.post('/admin/claims/:id/decide', adminAuth, async (req, res) => {
    try {
      const claim = await claimsApi.decideClaim({
        claimId: req.params.id, decision: req.body?.decision,
        payoutAmountMicro: req.body?.payoutAmountMicro, note: req.body?.note, actor: req.admin.actor
      });
      await auditLog({ actor: req.admin.actor, action: 'CLAIM_DECIDED', resource: claim.claimId, newValue: { status: claim.status } });
      res.json({ ok: true, claim });
    } catch (err) { res.status(400).json({ ok: false, error: err?.code || 'DECIDE_FAILED', detail: err?.message }); }
  });

  r.post('/admin/claims/:id/record-payout', adminAuth, async (req, res) => {
    try {
      const out = await claimsApi.recordPayout({
        claimId: req.params.id, txHash: req.body?.txHash, amountMicro: req.body?.amountMicro,
        recipient: req.body?.recipient, chainId: req.body?.chainId, idempotencyKey: req.body?.idempotencyKey
      });
      await auditLog({ actor: req.admin.actor, action: 'PAYOUT_RECORDED', resource: req.params.id, newValue: { txHash: req.body?.txHash } });
      res.json({ ok: true, ...out });
    } catch (err) { res.status(400).json({ ok: false, error: err?.code || 'PAYOUT_RECORD_FAILED', detail: err?.message }); }
  });

  r.post('/admin/providers/:id/enable', adminAuth, async (req, res) => {
    const p = getProvider(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'PROVIDER_NOT_FOUND' });
    const enabled = req.body?.enabled !== false;
    p.enabled = enabled && p.configured;
    await auditLog({ actor: req.admin.actor, action: 'PROVIDER_ENABLED_CHANGED', resource: p.providerId, newValue: { enabled: p.enabled } });
    res.json({ ok: true, providerId: p.providerId, enabled: p.enabled });
  });

  r.post('/admin/pause', adminAuth, async (req, res) => {
    const pausedNow = req.body?.paused === true;
    const state = (await store.get('admin', 'global')) || {};
    state.paused = pausedNow;
    state.updatedAt = Date.now();
    await store.set('admin', 'global', state);
    await auditLog({ actor: req.admin.actor, action: pausedNow ? 'EMERGENCY_PAUSE_ON' : 'EMERGENCY_PAUSE_OFF', resource: 'global' });
    res.json({ ok: true, paused: pausedNow });
  });

  r.get('/admin/dashboard', adminAuth, async (req, res) => {
    res.json({
      ok: true,
      providers: listProviders(),
      events: (await recentEvents(100)),
      note: 'Aggregate analytics (premium volume, loss ratio, provider concentration) are computed from durable records once live providers are integrated.'
    });
  });

  return r;
}

export default insuranceRouter;
