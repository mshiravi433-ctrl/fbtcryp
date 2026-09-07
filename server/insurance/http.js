/**
 * FBT Insurance OS — provider HTTP client.
 *
 * Small, dependency-free fetch wrapper with hard timeouts. Every remote call
 * returns a typed result — a network failure is data (UNAVAILABLE), never a
 * crash and never an excuse to fabricate a number.
 */

export const TIMEOUT_MS_DEFAULT = 8_000;

export class ProviderHttpError extends Error {
  constructor(kind, message, { status = 0, url = '', body = null } = {}) {
    super(message);
    this.name = 'ProviderHttpError';
    this.kind = kind; // 'network' | 'timeout' | 'status' | 'parse'
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/**
 * httpJson(method, url, { timeoutMs, headers, body, query })
 * -> { ok, status, data, error?, latencyMs, at }
 */
export async function httpJson(method, url, opts = {}) {
  const timeoutMs = opts.timeoutMs || TIMEOUT_MS_DEFAULT;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs);
  try {
    let fullUrl = url;
    if (opts.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
      }
      const q = qs.toString();
      if (q) fullUrl = `${url}${url.includes('?') ? '&' : '?'}${q}`;
    }
    const res = await fetch(fullUrl, {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.headers || {})
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      let errBody = null;
      try { errBody = await res.text(); } catch { /* ignore */ }
      return {
        ok: false, status: res.status, data: null, latencyMs, at: Date.now(),
        error: new ProviderHttpError('status', `HTTP ${res.status} from ${new URL(url).host}`, { status: res.status, url: fullUrl, body: errBody?.slice(0, 400) })
      };
    }
    const data = await res.json();
    return { ok: true, status: res.status, data, latencyMs, at: Date.now(), error: null };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const timedOut = err?.name === 'AbortError' || String(err?.message || '').includes('TIMEOUT');
    return {
      ok: false, status: 0, data: null, latencyMs, at: Date.now(),
      error: new ProviderHttpError(timedOut ? 'timeout' : 'network', timedOut ? `timeout after ${timeoutMs}ms` : String(err?.message || 'network failure'), { url })
    };
  } finally {
    clearTimeout(timer);
  }
}

export const httpGet = (url, opts = {}) => httpJson('GET', url, opts);
export const httpPost = (url, body, opts = {}) => httpJson('POST', url, { ...opts, body });
