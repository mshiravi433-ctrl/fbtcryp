/**
 * FBT AI GATEWAY CLIENT
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade — Client-side Gateway API Bridge
 */

import { apiBase } from './apiBase.js';
/* The server selects the mode per request. The browser only uses the deepest
   supported window because it cannot know the decision before sending text. */
import { intelligenceTurnBudgetMs } from './aiIntelligenceMode.js';

const base = () => {
  try { return (typeof apiBase === 'function' ? apiBase() : '') || '/api'; } catch { return '/api'; }
};

/* The floor for a call that is not an AI turn: a health read, a tool list. */
const TIMEOUT_MS = 15000;

/*
 * The Gateway selects a response depth after reading the request, which the
 * browser cannot predict. Wait for the maximum server-side turn budget so an
 * automatically deep request is not discarded by a stale local preference.
 */
const modeWindow = (floor = 15000) => Math.max(floor, intelligenceTurnBudgetMs('max'));

async function request(path, { method = 'GET', body = null, timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(`${base()}${path}`, {
      method,
      signal: ctrl.signal,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text.slice(0, 240) }; } })() : {};
    if (!res.ok) return { ok: false, status: res.status, ...json };
    return { ok: true, status: res.status, ...json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_UNAVAILABLE',
      detail: String(err?.message || '').slice(0, 160)
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAiProviders() {
  return request('/v1/ai/gateway/providers');
}

/**
 * What the gateway already knows about the fleet, for free: no provider is
 * called, so a panel can poll this. `configured` says a key exists; `verdict`
 * says whether that key could actually answer the last time it was used — the
 * distinction the whole «کلیدها را گذاشتیم ولی وصل نیست» report was about.
 */
export async function fetchAiGatewayHealth() {
  return request('/v1/ai/gateway/health');
}

/** The server-side tool registry — the wiring list of what the AI can reach. */
export async function fetchAiTools() {
  return request('/v1/ai/tools');
}

/*
 * The self-test really calls every configured provider, in parallel, under a
 * server-side deadline (AI_SELFTEST_DEADLINE_MS, 45s default). A 15s client
 * timeout therefore aborted the one request whose whole job is to answer
 * «چرا هوش مصنوعی وصل نمی‌شود؟» — the panel showed TIMEOUT while the server was
 * still collecting the per-provider reasons. It gets the longer leash.
 */
export const SELFTEST_TIMEOUT_MS = 60000;

export async function fetchGatewaySelfTest() {
  return request('/v1/ai/gateway/selftest', { timeout: SELFTEST_TIMEOUT_MS });
}

export async function executeAiGatewayChat({ taskType = 'general', system, user, preferredProvider, model, temperature, maxTokens, json = true } = {}) {
  return request('/v1/ai/gateway/chat', {
    method: 'POST',
    body: { taskType, system, user, preferredProvider, model, temperature, maxTokens, json },
    timeout: modeWindow()
  });
}

export async function runAiConsensus({ message, context = {}, locale = 'fa', preferredProviders = [] } = {}) {
  return request('/v1/ai/gateway/consensus', {
    method: 'POST',
    body: { message, context, locale, preferredProviders },
    timeout: modeWindow()
  });
}

export async function evaluateConfidence({ intent = {}, consensus = null, context = {}, toolsUsed = [], dataStatus = 'live' } = {}) {
  return request('/v1/ai/gateway/confidence', {
    method: 'POST',
    body: { intent, consensus, context, toolsUsed, dataStatus }
  });
}

export async function recordOutcome(outcomeData = {}) {
  return request('/v1/ai/learning/record', {
    method: 'POST',
    body: outcomeData
  });
}

export async function fetchLearningStats() {
  return request('/v1/ai/learning/stats');
}
