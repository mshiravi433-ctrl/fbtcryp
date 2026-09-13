/**
 * FBT LAUNCH — public REST client (the in-app half of the API/SDK story).
 *
 * The launch module is OFFLINE-FIRST on purpose (spec §20): every byte it
 * signs is prepared locally, the wallet signs locally, and the chain
 * verifies locally. The API is for what a local device cannot do alone —
 * the public factory registry, a second opinion on plan bytes (SDK
 * consumers), and the optional public launch record. When the API is
 * unreachable, the app degrades to "local truth" and says so in the UI
 * (the factory registry then comes from the built-in defaults).
 *
 * The SDK (docs/LAUNCH-SDK.md) calls the same endpoints from any app;
 * neither path ever sends keys — the contract of every endpoint is
 * "in: public parameters, out: public data / calldata".
 */
import { apiBase } from '../apiBase.js';

async function call(path, { method = 'GET', body = null, timeoutMs = 10_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, reason: String(e?.name === 'AbortError' ? 'TIMEOUT' : e?.message || 'NETWORK') };
  } finally {
    clearTimeout(timer);
  }
}

/** GET /api/launch/config — networks, DEX registry, fees, factory registry. */
export function fetchLaunchConfig() {
  return call('/launch/config');
}

/**
 * GET /api/launch/prepare — server-side plan preparation (same calldata
 * builder as the app). Params:
 *   chainId, factoryAddress, name, symbol, decimals, supply, capabilities,
 *   quote (json: {symbol, address, decimals, native}), tokenAmount,
 *   quoteAmount, slippageBps, creator, tokenAddress? (phase two)
 */
export function fetchLaunchPlan(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return call(`/launch/prepare?${q.toString()}`, { timeoutMs: 15_000 });
}

/** GET /api/launch/verify — server-side read-only on-chain verification. */
export function fetchLaunchVerify(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return call(`/launch/verify?${q.toString()}`, { timeoutMs: 15_000 });
}

/** POST /api/launch/record — optional public record (non-sensitive only). */
export function postLaunchRecord(record) {
  return call('/launch/record', { method: 'POST', body: record, timeoutMs: 8_000 });
}

/** GET /api/launch/records/:chainId — public records on a chain, if stored. */
export function fetchLaunchRecords(chainId) {
  return call(`/launch/records/${Number(chainId)}`);
}
