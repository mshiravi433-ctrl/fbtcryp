/**
 * SIGNAL INTELLIGENCE — client API.
 * ---------------------------------------------------------------------------
 * Talks to the server endpoints added in server/signalEngine.js:
 *
 *   GET  /api/signals/pulse          market-wide AI pulse
 *   POST /api/signals/why            multi-AI explanation (evidence only)
 *   GET  /api/signals/solana/radar   Solana early-token radar
 *
 * Every function fails CLOSED: when the server is unreachable it resolves to
 * null / an empty radar rather than inventing a value. The Signals screen
 * then degrades to the deterministic local engine (src/lib/signalEngine.js),
 * which never pretends the server data it does not have.
 */

import { apiBase } from './apiBase';

async function getJson(path, timeout = 15_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${apiBase()}${path}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(path, body, timeout = 60_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Market-wide pulse. Resolves null when unavailable (fail-closed). */
export async function getSignalPulse() {
  try {
    return await getJson('/signals/pulse', 12_000);
  } catch {
    return null;
  }
}

/**
 * Multi-AI "Why this signal?" explanation.
 * The payload is the SANITIZED evidence bundle — no wallet data may ever be
 * included here. `includePortfolio` is accepted but deliberately ignored by
 * this client when the user has not explicitly opted in (the page owns that
 * gate; see src/lib/signalStore.js).
 *
 * @param {object} p { symbol, name, lang, evidence, classification, confidence, riskLabel, timeframe }
 */
export async function getSignalWhy(p = {}) {
  try {
    return await postJson('/signals/why', {
      symbol: String(p.symbol || '').slice(0, 20),
      name: String(p.name || '').slice(0, 60),
      lang: p.lang || 'en',
      evidence: p.evidence || {},
      classification: p.classification || 'WATCH',
      confidence: Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : null,
      riskLabel: p.riskLabel || null,
      timeframe: Number.isFinite(Number(p.timeframe)) ? Number(p.timeframe) : 7
    }, 60_000);
  } catch {
    return null;
  }
}

/** Solana early-token radar. Resolves `{ dataStatus:'unavailable', tokens:[] }` on failure. */
export async function getSolanaRadar(limit = 10) {
  try {
    const out = await getJson(`/signals/solana/radar?limit=${limit}`, 25_000);
    return out && typeof out === 'object' ? out : { dataStatus: 'unavailable', tokens: [] };
  } catch {
    return { dataStatus: 'unavailable', tokens: [], at: Date.now(), schema: 'fbt.solana-radar.v1' };
  }
}
