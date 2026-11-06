/**
 * FBT AI BENCHMARK — client bridge
 * ---------------------------------------------------------------------------
 * Thin wrapper over the additive `/v1/ai/benchmark/*`, `/v1/ai/lab/*` and
 * `/v1/ai/intelligence/status` routes. It never throws: the dashboard renders
 * an honest "could not read" state instead of an empty grid dressed as a zero.
 *
 * Long timeout on purpose: a live lab run really calls providers, and the
 * 15-test set can take half a minute. A 15s client abort would report TIMEOUT
 * for a server that was still working — the exact bug the gateway's own
 * self-test comment records.
 */

import { apiBase } from './apiBase.js';

const base = () => {
  try { return (typeof apiBase === 'function' ? apiBase() : '') || '/api'; } catch { return '/api'; }
};

const SHORT_TIMEOUT_MS = 15000;
export const LAB_TIMEOUT_MS = 75000;
export const BENCHMARK_TIMEOUT_MS = 90000;

async function request(path, { method = 'GET', body = null, timeout = SHORT_TIMEOUT_MS } = {}) {
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

/** One combined dashboard read: suite + last run + lab + provider telemetry. */
export async function fetchIntelligenceStatus() {
  return request('/v1/ai/intelligence/status');
}

export async function fetchBenchmarkStatus() {
  return request('/v1/ai/benchmark/status');
}

export async function fetchBenchmarkSuite() {
  return request('/v1/ai/benchmark/suite');
}

export async function runBenchmark({ mode = 'single', providers = [], ids = null, categories = null, limit = null, smoke = false, concurrency = 2, label = null } = {}) {
  return request('/v1/ai/benchmark/run', {
    method: 'POST',
    timeout: BENCHMARK_TIMEOUT_MS,
    body: { mode, providers, ids, categories, limit, smoke, concurrency, label }
  });
}

export async function fetchLabCatalogue() {
  return request('/v1/ai/lab/tests');
}

export async function runProviderLab({ tests = null } = {}) {
  return request('/v1/ai/lab/run', {
    method: 'POST',
    timeout: LAB_TIMEOUT_MS,
    body: { tests }
  });
}
