/**
 * FBT FINANCIAL INTELLIGENCE OS — Research Engine (§11).
 * ---------------------------------------------------------------------------
 * Combines the providers this repository already talks to — news, security
 * intel, token risk, yields, smart money, market data, and (when a key is
 * configured) the web-research model — into ONE structured object:
 *
 *   { summary, evidence, signals, risks, sources, timestamp, confidence }
 *
 * §11's hard rule, implemented as code: when a provider is unreachable the
 * section is reported UNAVAILABLE with its reason and is NAMED in `missing[]`.
 * Nothing is filled in from the model's imagination, and the model's own prose
 * is kept in `narrative` marked `untrusted: true` — it can never become a
 * number, and it can never become an instruction (§49).
 */
import { randomUUID } from 'node:crypto';
import { confidenceFromEvidence } from './evidence.js';
import { round } from '../../src/lib/central/schema.js';

export const RESEARCH_SCHEMA = 'fbt.fi.research.v1';

export const RESEARCH_KINDS = Object.freeze([
  'token', 'protocol', 'defi', 'rwa', 'stock', 'market', 'macro',
  'news', 'smart_money', 'security', 'liquidity', 'yield'
]);

const TIMEOUT_MS = 6000;

function withTimeout(promise, ms = TIMEOUT_MS, label = 'provider') {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms).unref?.())
  ]);
}

/** Lazy provider loading: a provider whose module cannot even be imported is
 *  UNAVAILABLE, not a crash that takes the whole research turn down. */
async function load(name) {
  try {
    switch (name) {
      case 'news': return await import('../news.js');
      case 'security': return await import('../securityIntel.js');
      case 'tokenRisk': return await import('../tokenRisk.js');
      case 'smartMoney': return await import('../smartMoney/index.js');
      case 'yields': return await import('../yields.js');
      case 'web': return await import('../aiWebResearch.js');
      default: return null;
    }
  } catch (err) {
    return { __importError: String(err?.message || err).slice(0, 120) };
  }
}

export function createResearchEngine({ collections, evidence, observability = null, modelRouter = null, providers = {}, log = () => {}, now = () => Date.now() } = {}) {
  const P = { load, ...providers };

  async function call(name, fn, label) {
    const mod = typeof P[name] === 'function' ? null : await P.load(name);
    if (mod?.__importError) return { ok: false, reason: `PROVIDER_IMPORT_FAILED:${mod.__importError}`, source: label };
    try {
      const impl = typeof P[name] === 'function' ? P[name] : mod?.[fn];
      if (typeof impl !== 'function') return { ok: false, reason: 'PROVIDER_FUNCTION_MISSING', source: label };
      const value = await withTimeout(impl.__bound ? impl.__bound() : impl(), TIMEOUT_MS, label);
      if (value === null || value === undefined) return { ok: false, reason: 'EMPTY_RESULT', source: label };
      return { ok: true, value, source: label };
    } catch (err) {
      return { ok: false, reason: String(err?.message || 'PROVIDER_FAILED').slice(0, 120), source: label };
    }
  }

  /**
   * @param {object} p
   * @param {string} p.owner
   * @param {string} p.subject        asset symbol, protocol slug or question
   * @param {string[]} [p.kinds]      subset of RESEARCH_KINDS
   * @param {object} [p.world]        world-model digest (prices, volatility…)
   * @param {object} [p.token]        { chainId, address } for token/security research
   */
  async function research({ owner, subject, kinds = ['market', 'news', 'security', 'yield', 'smart_money'], world = null, token = null, correlationId = null } = {}) {
    const id = `rs_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const at = now();
    const wanted = (Array.isArray(kinds) ? kinds : [kinds]).filter((k) => RESEARCH_KINDS.includes(k));
    if (!wanted.length) return { ok: false, code: 'NO_VALID_RESEARCH_KIND', allowed: RESEARCH_KINDS };
    if (observability) observability.emit({ type: 'research.started', owner, correlationId, payload: { researchId: id, subject, kinds: wanted } });

    const sym = String(subject || '').toUpperCase().slice(0, 24);
    const sources = [];
    const signals = [];
    const risks = [];
    const evidenceInput = [];
    const missing = [];

    /* ── market ────────────────────────────────────────────────────────── */
    if (wanted.includes('market') || wanted.includes('token')) {
      const prices = world?.market?.prices || null;
      const volatility = world?.market?.volatilityPct || null;
      if (prices && typeof prices === 'object') {
        const price = prices[sym] ?? prices[String(subject || '').toLowerCase()] ?? null;
        if (Number.isFinite(Number(price))) {
          evidenceInput.push({ type: 'price', source: 'world-model:markets', value: Number(price), at, ttlMs: 30_000 });
          signals.push({ name: 'PRICE', direction: 'neutral', value: Number(price), source: 'world-model:markets', confidence: 0.9 });
        } else missing.push(`price:${sym}`);
      } else missing.push('market:prices');
      if (volatility && typeof volatility === 'object') {
        const vol = volatility[sym] ?? volatility.PORTFOLIO ?? null;
        if (Number.isFinite(Number(vol))) {
          evidenceInput.push({ type: 'volatility', source: 'world-model:markets', value: Number(vol), at, ttlMs: 30_000 });
          signals.push({ name: 'VOLATILITY', direction: Number(vol) > 60 ? 'risk-up' : 'neutral', value: Number(vol), source: 'world-model:markets', confidence: 0.85 });
          if (Number(vol) > 80) risks.push({ name: 'EXTREME_VOLATILITY', severity: 'HIGH', source: 'world-model:markets', detail: `annualised-style volatility reading ${vol}` });
        }
      }
      sources.push({ name: 'world-model:markets', at, status: prices ? 'ok' : 'unavailable' });
    }

    /* ── news ──────────────────────────────────────────────────────────── */
    if (wanted.includes('news') || wanted.includes('macro')) {
      const news = world?.external?.news;
      if (Array.isArray(news) && news.length) {
        const relevant = sym ? news.filter((n) => String(n?.title || '').toUpperCase().includes(sym)).slice(0, 6) : news.slice(0, 6);
        evidenceInput.push({ type: 'news', source: 'news-feed', value: relevant.map((n) => ({ title: String(n.title || '').slice(0, 160), url: n.url || null, at: n.publishedAt || n.at || null })), at, ttlMs: 15 * 60_000, untrusted: true });
        signals.push({ name: 'NEWS_MENTIONS', direction: relevant.length > 3 ? 'elevated-attention' : 'neutral', value: relevant.length, source: 'news-feed', confidence: 0.6 });
        sources.push({ name: 'news-feed', at, status: 'ok', count: relevant.length });
      } else {
        missing.push('news');
        sources.push({ name: 'news-feed', at, status: 'unavailable' });
      }
    }

    /* ── security ──────────────────────────────────────────────────────── */
    if (wanted.includes('security') && token?.address) {
      const out = await call('security', 'analyzeToken', 'security-intel');
      if (out.ok) {
        const score = Number(out.value?.score ?? out.value?.securityScore ?? null);
        evidenceInput.push({ type: 'security', source: 'security-intel', value: { score: Number.isFinite(score) ? score : null, flags: (out.value?.flags || []).slice(0, 8) }, at, ttlMs: 60 * 60_000 });
        if (Number.isFinite(score) && score < 50) risks.push({ name: 'LOW_SECURITY_SCORE', severity: score < 25 ? 'CRITICAL' : 'HIGH', source: 'security-intel', detail: `score ${score}` });
        if (out.value?.honeypot === true) risks.push({ name: 'HONEYPOT', severity: 'CRITICAL', source: 'security-intel', detail: 'token cannot be sold' });
        sources.push({ name: 'security-intel', at, status: 'ok' });
      } else {
        missing.push(`security:${out.reason}`);
        sources.push({ name: 'security-intel', at, status: 'unavailable', reason: out.reason });
      }
    } else if (wanted.includes('security')) {
      missing.push('security:token-address-required');
    }

    /* ── yield ─────────────────────────────────────────────────────────── */
    if (wanted.includes('yield') || wanted.includes('defi')) {
      const apy = world?.market?.apy;
      if (Array.isArray(apy) && apy.length) {
        const relevant = sym ? apy.filter((p) => String(p.pool || '').toUpperCase().includes(sym)).slice(0, 5) : apy.slice(0, 5);
        if (relevant.length) {
          evidenceInput.push({ type: 'apy', source: 'yield-feed', value: relevant, at, ttlMs: 5 * 60_000 });
          const best = relevant.reduce((a, b) => ((Number(b.apyPct) || 0) > (Number(a.apyPct) || 0) ? b : a), relevant[0]);
          signals.push({ name: 'BEST_OBSERVED_APY', direction: 'opportunity', value: Number(best.apyPct) || null, source: 'yield-feed', confidence: 0.7, pool: best.pool });
          sources.push({ name: 'yield-feed', at, status: 'ok', count: relevant.length });
        } else missing.push(`yield:no-pool-for:${sym}`);
      } else {
        missing.push('yield');
        sources.push({ name: 'yield-feed', at, status: 'unavailable' });
      }
    }

    /* ── smart money ───────────────────────────────────────────────────── */
    if (wanted.includes('smart_money')) {
      const sm = world?.market?.smartMoney;
      if (sm && typeof sm === 'object') {
        evidenceInput.push({ type: 'smart_money', source: 'smart-money', value: sm, at, ttlMs: 5 * 60_000 });
        signals.push({ name: 'SMART_MONEY_FLOW', direction: sm.netFlowUsd > 0 ? 'accumulation' : sm.netFlowUsd < 0 ? 'distribution' : 'neutral', value: sm.netFlowUsd ?? null, source: 'smart-money', confidence: 0.5 });
        sources.push({ name: 'smart-money', at, status: 'ok' });
      } else {
        /* Fall back to the real service rather than declaring the signal dead. */
        const out = await call('smartMoney', 'getOverview', 'smart-money');
        if (out.ok) {
          evidenceInput.push({ type: 'smart_money', source: 'smart-money', value: out.value, at, ttlMs: 5 * 60_000 });
          sources.push({ name: 'smart-money', at, status: 'ok' });
        } else {
          missing.push(`smart_money:${out.reason}`);
          sources.push({ name: 'smart-money', at, status: 'unavailable', reason: out.reason });
        }
      }
    }

    /* ── evidence ──────────────────────────────────────────────────────── */
    const recorded = await evidence.record(owner, evidenceInput, { correlationId });
    const evidenceIds = recorded.evidence.map((e) => e.id);
    if (evidenceIds.length) await evidence.link(owner, { targetType: 'research', targetId: id, evidenceIds, correlationId });

    const confidence = confidenceFromEvidence(recorded.evidence);
    const status = recorded.evidence.length === 0 ? 'UNAVAILABLE' : missing.length > wanted.length ? 'PARTIAL' : recorded.evidence.length < wanted.length ? 'PARTIAL' : 'OK';

    /* ── summary: deterministic, built only from what we read ──────────── */
    const summary = buildSummary({ sym, signals, risks, evidence: recorded.evidence, missing });

    /* ── optional model narrative (never a number, never an instruction) ── */
    let narrative = null;
    if (modelRouter && recorded.evidence.length) {
      const out = await modelRouter.synthesize({
        task: 'research',
        subject,
        facts: summary,
        evidence: recorded.evidence.map((e) => ({ type: e.type, source: e.source, value: e.value, freshness: e.freshness })),
        correlationId
      });
      if (out?.ok) narrative = { text: String(out.text).slice(0, 1200), provider: out.provider, model: out.model || null, untrusted: true, at };
    }

    const bundle = {
      schema: RESEARCH_SCHEMA,
      id,
      owner,
      subject: String(subject || '').slice(0, 80),
      kinds: wanted,
      status,
      at,
      timestamp: at,
      summary,
      narrative,
      signals,
      risks,
      sources,
      evidence: recorded.evidence,
      evidenceIds,
      missing,
      confidence,
      /* §49 — research is DATA. The flag travels with the object. */
      untrusted: true,
      durable: collections.durable()
    };
    await collections.put('research', owner, bundle);
    if (observability) observability.emit({ type: 'research.completed', owner, correlationId, payload: { researchId: id, status, evidence: evidenceIds.length, missing: missing.length, confidence } });
    return { ok: true, research: bundle };
  }

  async function get(owner, id) { return collections.get('research', owner, id); }
  async function recent(owner, { limit = 10 } = {}) {
    const { rows } = await collections.read('research', owner);
    return rows.slice(0, Math.max(1, limit));
  }

  return { schema: RESEARCH_SCHEMA, research, get, recent, RESEARCH_KINDS };
}

function buildSummary({ sym, signals, risks, evidence, missing }) {
  const lines = [];
  const price = signals.find((s) => s.name === 'PRICE');
  const vol = signals.find((s) => s.name === 'VOLATILITY');
  const apy = signals.find((s) => s.name === 'BEST_OBSERVED_APY');
  const news = signals.find((s) => s.name === 'NEWS_MENTIONS');
  const sm = signals.find((s) => s.name === 'SMART_MONEY_FLOW');
  if (price) lines.push(`${sym || 'the asset'} last read at $${round(price.value, 4).toLocaleString('en-US')}.`);
  if (vol) lines.push(`Volatility reading ${vol.value}${vol.direction === 'risk-up' ? ' — elevated.' : '.'}`);
  if (apy && apy.value !== null) lines.push(`Best observed yield for ${sym || 'this asset'} is ${round(apy.value, 2)}% (${apy.pool || 'pool'}).`);
  if (news) lines.push(`${news.value} recent headline(s) matched.`);
  if (sm && sm.value !== null) lines.push(`Smart-money net flow ${sm.direction}: $${round(sm.value, 0).toLocaleString('en-US')}.`);
  if (risks.length) lines.push(`Risks: ${risks.map((r) => r.name).join(', ')}.`);
  if (missing.length) lines.push(`Not available: ${missing.slice(0, 6).join(', ')}.`);
  if (!lines.length) lines.push('No provider returned usable data for this subject; nothing was estimated.');
  return {
    text: lines.join(' '),
    generatedBy: 'deterministic',
    evidenceCount: evidence.length,
    missing,
    neverAGuarantee: true
  };
}
