/**
 * FBT AI ORCHESTRATOR — API surface (Upgrade 14)
 * ---------------------------------------------------------------------------
 * Mounted at /api/v1/ai (same family and the same rate budget as the rest of
 * the AI surface). Nothing here removes or renames an existing route; these are
 * new, additive endpoints:
 *
 *   GET  /orchestrator/graph        the reasoning graph + catalogue + laws
 *   GET  /orchestrator/health       providers, tools, RAG and ledger state
 *   POST /orchestrator/plan         what THIS question needs (no model calls)
 *   POST /orchestrator/run          run the graph: tools → N models → judge
 *   POST /orchestrator/judge        judge a panel you already have (pure)
 *   GET  /orchestrator/decisions    recent decisions for this owner
 *   GET  /orchestrator/learning     priors: which tools/providers actually work
 *   POST /memory/recall             hybrid retrieval with citations
 *   POST /memory/remember           store one turn in owner-scoped memory
 *   POST /memory/index              index the verified corpus (idempotent)
 *   GET  /memory/stats              collections + counters
 *
 * Owner derivation is IDENTICAL to the V1 AI OS and the central brain
 * (`x-fbt-device` → salted sha256 → `dev:…`), so one device is one user across
 * every brain. `test/intent-ai/orchestrator-wiring-probe.mjs` asserts the three
 * derivations still agree at the source level.
 */

import { Router } from 'express';
import { createHash } from 'node:crypto';
import {
  createOrchestrator,
  getOrchestratorRag,
  getOrchestratorLedger,
  orchestratorEnabled,
  ORCHESTRATOR_SCHEMA,
  ORCHESTRATOR_VERSION,
  listTools
} from './aiOrchestrator.js';
import { clipDeep, containsSensitiveKeyOrPhrase } from '../src/lib/intent-ai/orchestrator/redact.js';

export const ORCHESTRATOR_ROUTES_SCHEMA = 'fbt.ai-orchestrator.routes.v1';

const DEVICE_HEADER = 'x-fbt-device';
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;
/* Same salt chain as server/aiIntentOS.js and server/central/router.js. */
const SALT = process.env.FINANCIAL_GOALS_SALT || process.env.CRON_SECRET || 'fbt-ai-intent-os';
const MAX_MESSAGE = 1200;

const ownerFor = (req) => {
  if (req?.tgUser?.id) return `tg:${req.tgUser.id}`;
  const device = String(req?.get?.(DEVICE_HEADER) || '').trim();
  if (DEVICE_RE.test(device)) return `dev:${createHash('sha256').update(`${device}|${SALT}`).digest('hex').slice(0, 32)}`;
  return `ip:${String(req?.ip || 'anon').slice(0, 64)}`;
};

/** Only wallet/portfolio-shaped client data is accepted, and only bounded. */
export function sanitizeClientData(input = {}) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  if (input.wallet && typeof input.wallet === 'object') {
    out.wallet = clipDeep({
      attached: input.wallet.attached === true,
      chains: Array.isArray(input.wallet.chains) ? input.wallet.chains.slice(0, 12) : [],
      evmAddresses: Array.isArray(input.wallet.evmAddresses) ? input.wallet.evmAddresses.slice(0, 4) : [],
      solanaAddresses: Array.isArray(input.wallet.solanaAddresses) ? input.wallet.solanaAddresses.slice(0, 4) : []
    }, 120);
  }
  if (input.portfolio && typeof input.portfolio === 'object') {
    out.portfolio = clipDeep({
      totalValueUsd: Number(input.portfolio.totalValueUsd) || 0,
      partial: input.portfolio.partial === true,
      holdings: Array.isArray(input.portfolio.holdings) ? input.portfolio.holdings.slice(0, 40) : []
    }, 160);
  }
  return Object.keys(out).length ? out : null;
}

/** A single shared orchestrator; tests inject deps via `createOrchestrator`. */
let singleton = null;
export function getOrchestrator() {
  if (!singleton) singleton = createOrchestrator();
  return singleton;
}
export function _setOrchestrator(o) { singleton = o; }

export function createOrchestratorRouter({ orchestrator = null, rag = null, ledger = null, log = () => {} } = {}) {
  const router = Router();
  const O = () => orchestrator || getOrchestrator();
  const R = () => rag || getOrchestratorRag();
  const L = () => ledger || getOrchestratorLedger();

  const wrap = (handler) => async (req, res) => {
    try {
      const out = await handler(req, res);
      if (!res.headersSent && out !== undefined) res.json(out);
    } catch (error) {
      log('orchestrator-route-error', String(error?.message || error).slice(0, 160));
      if (!res.headersSent) {
        res.status(500).json({ ok: false, code: 'ORCHESTRATOR_ERROR', schema: ORCHESTRATOR_SCHEMA, detail: String(error?.message || error).slice(0, 160) });
      }
    }
  };

  /* ── topology & health ────────────────────────────────────────────────── */

  router.get('/orchestrator/graph', wrap(() => ({
    ok: true,
    schema: ORCHESTRATOR_ROUTES_SCHEMA,
    orchestrator: ORCHESTRATOR_SCHEMA,
    version: ORCHESTRATOR_VERSION,
    enabled: orchestratorEnabled(),
    graph: O().describe(),
    tools: listTools(),
    laws: {
      readOnly: true,
      canExecute: false,
      numbersFromToolsOnly: true,
      aiConsensusIsNotProof: true,
      judgeEvidenceFirst: true,
      secretsNeverStoredOrSent: true
    },
    pipeline: ['plan (data needs)', 'gather (tools)', 'analyze (N models)', 'judge (disagreement)', 'decide', 'learn'],
    at: Date.now()
  })));

  router.get('/orchestrator/health', wrap(async () => {
    const health = await O().health();
    return {
      ok: health?.ok !== false,
      schema: ORCHESTRATOR_ROUTES_SCHEMA,
      ...health,
      /* Stated here as well as in the graph endpoint: an operator reading the
         health line must not have to trust that the injected engine kept its
         own laws. */
      laws: { ...(health?.laws || {}), readOnly: true, canExecute: false, canSign: false, numbersFromToolsOnly: true },
      enabled: orchestratorEnabled(),
      at: Date.now()
    };
  }));

  /* ── planning (free: no model calls, no network) ──────────────────────── */

  router.post('/orchestrator/plan', wrap(async (req) => {
    const message = String(req.body?.message || '').slice(0, MAX_MESSAGE);
    if (!message.trim()) return { ok: false, code: 'MESSAGE_REQUIRED' };
    const plan = await O().planOnly({
      message,
      intentType: req.body?.intentType || null,
      entities: req.body?.entities || {},
      context: req.body?.context || {},
      locale: req.body?.locale || 'fa'
    });
    return {
      ok: true,
      schema: ORCHESTRATOR_ROUTES_SCHEMA,
      plan,
      owner: ownerFor(req),
      at: Date.now()
    };
  }));

  /* ── the full turn ────────────────────────────────────────────────────── */

  router.post('/orchestrator/run', wrap(async (req) => {
    const message = String(req.body?.message || '').slice(0, MAX_MESSAGE);
    if (!message.trim()) return { ok: false, code: 'MESSAGE_REQUIRED' };
    if (containsSensitiveKeyOrPhrase(message)) {
      return { ok: false, code: 'SENSITIVE_CONTENT_REFUSED', detail: 'The message looks like it carries a credential; it is neither stored nor sent to a model.' };
    }
    if (!orchestratorEnabled()) return { ok: false, code: 'ORCHESTRATOR_DISABLED', at: Date.now() };

    const owner = ownerFor(req);
    const result = await O().run({
      message,
      context: req.body?.context || {},
      entities: req.body?.entities || {},
      intentType: req.body?.intentType || null,
      owner,
      clientData: sanitizeClientData(req.body?.clientData || {}),
      locale: req.body?.locale || 'fa',
      deadlineMs: Number(req.body?.deadlineMs) || undefined
    });
    return { schema: ORCHESTRATOR_ROUTES_SCHEMA, owner, ...result };
  }));

  router.post('/orchestrator/judge', wrap((req) => {
    const question = String(req.body?.question || '').slice(0, MAX_MESSAGE);
    if (!question.trim()) return { ok: false, code: 'QUESTION_REQUIRED' };
    const analyses = Array.isArray(req.body?.analyses) ? req.body.analyses.slice(0, 6).map((a) => ({
      provider: String(a?.provider || 'unknown').slice(0, 40),
      model: a?.model ? String(a.model).slice(0, 60) : null,
      ok: a?.ok !== false,
      answer: String(a?.answer || '').slice(0, 2000),
      stance: a?.stance ? String(a.stance).slice(0, 16) : null,
      confidence: Number.isFinite(Number(a?.confidence)) ? Number(a.confidence) : null
    })) : [];
    const judgment = O().judgeOnly({
      question,
      analyses,
      evidence: Array.isArray(req.body?.evidence) ? req.body.evidence.slice(0, 12).map((e) => ({
        facetId: String(e?.facetId || '').slice(0, 40),
        tool: String(e?.tool || 'caller').slice(0, 60),
        status: ['observed', 'degraded', 'unavailable'].includes(e?.status) ? e.status : 'degraded',
        summary: e?.summary ?? null,
        at: Number(e?.at) || Date.now()
      })) : [],
      intentType: req.body?.intentType || null,
      locale: req.body?.locale || 'fa'
    });
    return { ok: true, schema: ORCHESTRATOR_ROUTES_SCHEMA, judgment, at: Date.now() };
  }));

  /* ── learning surface ─────────────────────────────────────────────────── */

  router.get('/orchestrator/decisions', wrap(async (req) => {
    const rows = await L().recent({ owner: ownerFor(req), limit: Number(req.query.limit) || 10 });
    return { ok: true, schema: ORCHESTRATOR_ROUTES_SCHEMA, decisions: rows, at: Date.now() };
  }));

  router.get('/orchestrator/learning', wrap(async (req) => {
    const owner = req.query.scope === 'aggregate' ? null : ownerFor(req);
    const intentType = req.query.intentType ? String(req.query.intentType).slice(0, 40) : null;
    const [priors, stats] = await Promise.all([
      L().priors({ owner, intentType }),
      L().stats()
    ]);
    return { ok: true, schema: ORCHESTRATOR_ROUTES_SCHEMA, priors, stats, at: Date.now() };
  }));

  /* ── memory / RAG surface ─────────────────────────────────────────────── */

  router.post('/memory/recall', wrap(async (req) => {
    const query = String(req.body?.query || req.body?.message || '').slice(0, MAX_MESSAGE);
    if (!query.trim()) return { ok: false, code: 'QUERY_REQUIRED' };
    const recall = await R().recall({
      query,
      owner: req.body?.scope === 'knowledge' ? null : ownerFor(req),
      locale: req.body?.locale || 'fa',
      limit: Math.min(10, Number(req.body?.limit) || 5),
      kinds: Array.isArray(req.body?.kinds) ? req.body.kinds.slice(0, 4).map((k) => String(k).slice(0, 20)) : null
    });
    return { ok: recall.ok !== false, schema: ORCHESTRATOR_ROUTES_SCHEMA, ...recall, at: Date.now() };
  }));

  router.post('/memory/remember', wrap(async (req) => {
    const question = String(req.body?.question || '').slice(0, MAX_MESSAGE);
    const answer = String(req.body?.answer || '').slice(0, 2000);
    if (!question.trim() && !answer.trim()) return { ok: false, code: 'NOTHING_TO_REMEMBER' };
    const out = await R().remember({
      owner: ownerFor(req),
      question,
      answer,
      intentType: req.body?.intentType || null,
      lang: String(req.body?.locale || 'fa').slice(0, 2)
    });
    return { ok: out.ok !== false, schema: ORCHESTRATOR_ROUTES_SCHEMA, ...out, at: Date.now() };
  }));

  router.post('/memory/index', wrap(async (req) => ({
    ok: true,
    schema: ORCHESTRATOR_ROUTES_SCHEMA,
    ...(await R().indexKnowledge({ force: req.body?.force === true })),
    at: Date.now()
  })));

  router.get('/memory/stats', wrap(async () => ({
    ok: true, schema: ORCHESTRATOR_ROUTES_SCHEMA, stats: await R().stats(), at: Date.now()
  })));

  return router;
}

export default createOrchestratorRouter;
