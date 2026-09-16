/** Relay diagnostics are advisory: browser errors cannot distinguish auth, origin and network failures. */
import { WC_RELAY_URLS, withTimeout } from './wcTimeout.js';

export const RELAY_PREFLIGHT_TIMEOUT_MS = 5_000;

export const RELAY_STATE_TTL_MS = 90_000;

// Legacy UI warning flag, never an authorization to skip SDK connect/restore.
export const RELAY_BLOCKED_VERDICTS = Object.freeze(['WS_REFUSED', 'UNREACHABLE', 'TIMEOUT']);

export function isRelayBlocked(verdict) {
  return RELAY_BLOCKED_VERDICTS.includes(String(verdict || ''));
}

export async function probeReachable(url, { fetchImpl, timeoutMs = 8_000 } = {}) {
  const call = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!call) return { ok: false, error: 'NO_FETCH' };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { try { controller?.abort(); } catch { /* best-effort cleanup */ } }, timeoutMs);
  const started = Date.now();
  try {
    await call(url, { signal: controller?.signal, mode: 'no-cors', cache: 'no-store' });
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: String(error?.name === 'AbortError' ? 'TIMEOUT' : (error?.message || error))
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeRelay(url, { WebSocketImpl, projectId = '', timeoutMs = 8_000, graceMs = 250 } = {}) {
  const WS = WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
  if (!WS) return Promise.resolve({ url, ok: false, error: 'NO_WEBSOCKET', ms: 0 });
  // Use the relay's signed client-auth handshake, not a projectId-only socket.
  let target;
  try {
    target = await withTimeout((async () => {
      const { generateKeyPair, signJWT } = await import('@walletconnect/relay-auth');
      const auth = await signJWT('fbt-relay-diagnostic', url, 300, generateKeyPair());
      const target = new URL(url);
      target.searchParams.set('projectId', projectId);
      target.searchParams.set('auth', auth);
      target.searchParams.set('ua', 'wc-2/js-2.25.0');
      return target;
    })(), timeoutMs, 'PROBE_AUTH_TIMEOUT');
  } catch {
    return { url, ok: false, error: 'PROBE_AUTH_FAILED', ms: 0 };
  }
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let socket = null;
    let graceTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      if (socket) socket.onopen = socket.onerror = socket.onclose = null;
      try { socket?.close?.(); } catch { /* best-effort cleanup */ }
      resolve({ url, ms: Date.now() - started, ...result });
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'TIMEOUT', state: 'timeout' }), timeoutMs);
    try {
      socket = new WS(target.toString());
    } catch (error) {
      // Constructor errors can contain the authenticated URL; never expose it.
      finish({ ok: false, error: 'SOCKET_CONSTRUCTION_FAILED' });
      return;
    }
    socket.onopen = () => finish({ ok: true, state: 'open' });
    socket.onerror = () => {

      if (settled) return;
      graceTimer = setTimeout(
        () => finish({ ok: false, error: 'SOCKET_ERROR', state: 'error' }),
        graceMs
      );
    };
    socket.onclose = (event) => {
      const code = Number.isFinite(event?.code) ? Number(event.code) : null;
      if (code !== null && code !== 1006) {
        finish({ ok: false, error: `CLOSED_${code}`, closeCode: code, state: 'closed' });
        return;
      }
      finish({ ok: false, error: 'SOCKET_ERROR', closeCode: code, state: 'error' });
    };
  });
}

export function probeRelayHttps(url, { fetchImpl, timeoutMs = 8_000 } = {}) {
  const target = String(url || '').replace(/^wss:/, 'https:');
  return probeReachable(target, { fetchImpl, timeoutMs });
}

export function relayVerdict(hosts = []) {
  const list = Array.isArray(hosts) ? hosts : [];
  const openUrls = list.filter((host) => host?.socket?.ok).map((host) => host.url);
  const httpsUrls = list.filter((host) => host?.https?.ok).map((host) => host.url);
  let verdict = 'UNREACHABLE';
  if (list.length === 0) verdict = 'NO_MEASUREMENT';
  else if (openUrls.length > 0) verdict = 'OPEN';
  else if (list.every((host) => !host?.socket || host.socket.error === 'NO_WEBSOCKET')) verdict = 'NO_WEBSOCKET';
  else if (httpsUrls.length > 0) verdict = 'WS_REFUSED';

  else if (list.every((host) => host?.socket?.error === 'TIMEOUT')) verdict = 'TIMEOUT';
  return { verdict, openUrls, httpsUrls };
}

export function relayOrderFromHosts(hosts, fallback = WC_RELAY_URLS) {
  const list = Array.isArray(hosts) ? hosts.filter(Boolean) : [];
  const base = (Array.isArray(fallback) && fallback.length ? fallback : WC_RELAY_URLS).map(String);
  if (list.length === 0) return [...base];
  const seen = new Set();
  const order = [];
  for (const host of list) {
    if (!host?.socket?.ok || !host.url || seen.has(host.url)) continue;
    seen.add(host.url);
    order.push(host.url);
  }
  for (const url of list.map((host) => host?.url).filter(Boolean)) {
    if (seen.has(url)) continue;
    seen.add(url);
    order.push(url);
  }
  for (const url of base) {
    if (!seen.has(url)) order.push(url);
  }
  return order;
}

export async function probeRelaySet({
  urls = WC_RELAY_URLS,
  projectId = '',
  timeoutMs = RELAY_PREFLIGHT_TIMEOUT_MS,
  graceMs = 250,
  WebSocketImpl,
  fetchImpl,
  https = true
} = {}) {
  const list = (Array.isArray(urls) ? urls : WC_RELAY_URLS).map(String);
  const started = Date.now();
  const hosts = await Promise.all(list.map(async (url) => {
    const [socket, reachable] = await Promise.all([
      probeRelay(url, { WebSocketImpl, projectId, timeoutMs, graceMs }),
      https ? probeRelayHttps(url, { fetchImpl, timeoutMs }) : null
    ]);
    return { url, socket, https: reachable };
  }));
  const { verdict, openUrls, httpsUrls } = relayVerdict(hosts);
  return {
    at: Date.now(),
    ms: Date.now() - started,
    verdict,
    hosts,
    openUrls,
    httpsUrls,
    order: relayOrderFromHosts(hosts, list),
    blocked: isRelayBlocked(verdict)
  };
}

export function readRelaySocket(wc) {
  const relayer = wc?.signer?.client?.core?.relayer ?? null;
  const socket = relayer?.provider?.connection?.socket ?? null;
  const readyState = Number.isFinite(socket?.readyState) ? Number(socket.readyState) : null;
  return {
    hasRelayer: Boolean(relayer),
    connected: Boolean(relayer?.connected),
    connecting: Boolean(relayer?.connecting),
    readyState
  };
}

let cached = null;

let inflight = null;

export function readRelayStateCache() {
  return cached;
}

export function clearRelayStateCache() {
  cached = null;
}

export function resetRelayState() {
  cached = null;
  inflight = null;
}

export async function getRelayState({
  projectId = '',
  force = false,
  ttlMs = RELAY_STATE_TTL_MS,
  urls = WC_RELAY_URLS,
  timeoutMs = RELAY_PREFLIGHT_TIMEOUT_MS,
  WebSocketImpl,
  fetchImpl
} = {}) {
  if (!force && cached && Date.now() - cached.at < ttlMs) {
    return { ...cached, fromCache: true };
  }
  if (inflight && !force) return inflight;
  const run = probeRelaySet({ projectId, urls, timeoutMs, WebSocketImpl, fetchImpl })
    .then((state) => {
      cached = state;
      return { ...state, fromCache: false };
    })
    .catch((error) => {
      const fallback = {
        at: Date.now(),
        ms: 0,
        verdict: 'NO_MEASUREMENT',
        hosts: [],
        openUrls: [],
        httpsUrls: [],
        order: [...(Array.isArray(urls) && urls.length ? urls : WC_RELAY_URLS)],
        blocked: false,
        error: String(error?.message || error)
      };
      cached = null;
      return { ...fallback, fromCache: false };
    });
  inflight = run.then(
    (state) => { inflight = null; return state; },
    (error) => { inflight = null; throw error; }
  );
  return run;
}
