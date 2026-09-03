/**
 * FBT AI GATEWAY CLIENT
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade — Client-side Gateway API Bridge
 */

import { apiBase } from './apiBase.js';

const base = () => {
  try { return (typeof apiBase === 'function' ? apiBase() : '') || '/api'; } catch { return '/api'; }
};

const TIMEOUT_MS = 15000;

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

export async function fetchGatewaySelfTest() {
  return request('/v1/ai/gateway/selftest');
}

export async function executeAiGatewayChat({ taskType = 'general', system, user, preferredProvider, model, temperature, maxTokens, json = true } = {}) {
  return request('/v1/ai/gateway/chat', {
    method: 'POST',
    body: { taskType, system, user, preferredProvider, model, temperature, maxTokens, json }
  });
}

export async function runAiConsensus({ message, context = {}, locale = 'fa', preferredProviders = [] } = {}) {
  return request('/v1/ai/gateway/consensus', {
    method: 'POST',
    body: { message, context, locale, preferredProviders }
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
