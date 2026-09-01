/**
 * LI.FI — the low-level client, and the only place our key and fee live.
 * ---------------------------------------------------------------------------
 * Extracted from server/bridge.js so that ONE process talks to LI.FI. Before
 * this split there were two callers with two shapes: /api/bridge/quote (real)
 * and /api/intents/v1/bridge-quote (a hard-coded object pretending to be a
 * rate). server/crossChain.js is now the only consumer of this module, and
 * server/bridge.js delegates to it — see the audit note there.
 *
 * ─── WHY THE KEY AND FEE STAY HERE ──────────────────────────────────────────
 * `LIFI_API_KEY` in a VITE_ variable is compiled into the browser bundle and
 * the APK where anyone can read it. `integrator` and `fee` decide where our
 * revenue goes: accepting them from a caller would let anyone redirect our
 * commission by editing a query string. Both are attached below, server-side,
 * and the parameter allow-list is the security boundary.
 */

const LIFI_BASE = process.env.LIFI_BASE_URL || 'https://li.quest/v1';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 20000);

/**
 * Our integrator string, as registered in the LI.FI portal.
 *
 * LI.FI constrains it: max 23 characters, lower case, alphanumeric plus `_`
 * and `-`. Normalised rather than trusted, because the portal rejects a
 * capital letter without saying so and a wrong id fails SILENTLY (error 1011
 * → our fee-free retry → bridging works, revenue is zero forever).
 */
export const integratorId = () =>
  String(process.env.LIFI_INTEGRATOR || 'fbt-swap')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 23);

export const apiKey = () => process.env.LIFI_API_KEY || '';
export const lifiConfigured = () => true; /* LI.FI serves quotes without a key; the key only raises the rate limit. */

/**
 * Our cut, as a decimal fraction (0.003 = 0.3%, NOT 30).
 *
 * Clamped hard: `LIFI_FEE=30` meant as "30 bps" would otherwise be read as
 * 3000% and take somebody's entire transfer.
 */
export function bridgeFee() {
  const raw = Number(process.env.LIFI_FEE ?? 0.003);
  if (!Number.isFinite(raw) || raw < 0 || raw > 0.01) return 0.003;
  return raw;
}

export const bridgeFeeReady = () => Boolean(process.env.LIFI_FEE_READY === 'true');

function headers(useKey = true) {
  const h = { accept: 'application/json' };
  const k = apiKey();
  if (useKey && k) h['x-lifi-api-key'] = k;
  return h;
}

/**
 * One request to LI.FI, with a timeout and one key-less retry.
 *
 * A rejected key must never take bridging down: LI.FI answers without one, so
 * an "invalid api key" reply is retried clean rather than surfaced to a user
 * as a failure they cannot fix.
 */
export async function lifiFetch(path, { method = 'GET', body = null, useKey = true, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const init = {
      method,
      headers: body ? { ...headers(useKey), 'content-type': 'application/json' } : headers(useKey),
      signal: ctrl.signal,
      ...(body ? { body: JSON.stringify(body) } : {})
    };
    const res = await fetch(`${LIFI_BASE}${path}`, init);
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text.slice(0, 300) };
    }
    if (!res.ok && useKey && parsed?.message && /invalid api key/i.test(String(parsed.message))) {
      clearTimeout(timer);
      return lifiFetch(path, { method, body, useKey: false, timeoutMs });
    }
    return { ok: res.ok, status: res.status, body: parsed, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 504 : 502,
      body: { error: err?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_FAILED', message: String(err?.message || err).slice(0, 200) },
      latencyMs: Date.now() - started
    };
  }
}

/* ── chain + tool registries, cached ─────────────────────────────────────── */

const CACHE_TTL_MS = Number(process.env.LIFI_REGISTRY_TTL_MS || 10 * 60 * 1000);
const cache = new Map();

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.until) return hit.value;
  const value = await loader();
  /* A failed load is cached BRIEFLY so a provider outage does not turn into a
     request storm, but not for the full TTL — recovery must be quick. */
  cache.set(key, { value, until: Date.now() + (value?.ok ? CACHE_TTL_MS : 15_000) });
  return value;
}

/** Every chain LI.FI itself says it serves. Never a hard-coded list. */
export const lifiChains = () => cached('chains', async () => {
  const res = await lifiFetch('/chains');
  if (!res.ok || !Array.isArray(res.body?.chains)) {
    return { ok: false, chains: [], error: res.body?.error || res.body?.message || `HTTP_${res.status}` };
  }
  return {
    ok: true,
    chains: res.body.chains.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      chainType: c.chainType || 'EVM',
      coin: c.coin ?? null,
      logoURI: c.logoURI ?? null,
      nativeToken: c.nativeToken?.address ?? null,
      explorer: c.metamask?.blockExplorerUrls?.[0] ?? null,
      rpc: Array.isArray(c.metamask?.rpcUrls) ? c.metamask.rpcUrls[0] : null
    }))
  };
});

/** Bridges + exchanges LI.FI can route through, for the health report. */
export const lifiTools = () => cached('tools', async () => {
  const res = await lifiFetch('/tools');
  if (!res.ok) return { ok: false, bridges: [], exchanges: [], error: res.body?.message || `HTTP_${res.status}` };
  return {
    ok: true,
    bridges: (res.body?.bridges || []).map((b) => b.key),
    exchanges: (res.body?.exchanges || []).map((e) => e.key)
  };
});

/** Tokens LI.FI lists for one chain — the registry the token picker reads. */
export const lifiTokens = (chainId) => cached(`tokens:${chainId}`, async () => {
  const res = await lifiFetch(`/tokens?chains=${encodeURIComponent(chainId)}`);
  const list = res.body?.tokens?.[String(chainId)];
  if (!res.ok || !Array.isArray(list)) {
    return { ok: false, tokens: [], error: res.body?.message || `HTTP_${res.status}` };
  }
  return { ok: true, tokens: list };
});

/** Is fee collection actually live? Asked of the API, not of our env var. */
export async function integratorStatus() {
  const id = integratorId();
  const probe = await lifiFetch(`/integrators/${encodeURIComponent(id)}`);
  return {
    integrator: id,
    keySet: Boolean(apiKey()),
    feePercent: bridgeFee(),
    registered: probe.ok,
    detail: probe.ok ? null : probe.body?.message ?? null,
    latencyMs: probe.latencyMs ?? null
  };
}

/** Test seam: the registry caches are per-process and must be clearable. */
export function _resetLifiCache() {
  cache.clear();
}
