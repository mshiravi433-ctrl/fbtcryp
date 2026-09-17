/**
 * RELAY MEASUREMENT
 * ---------------------------------------------------------------------------
 * `EthereumProvider.init()` does NOT open a relay socket: `Relayer.init()` calls
 * `transportOpen()` un-awaited, and it returns immediately while the client has
 * no topics to subscribe to. So "init() resolved" says nothing about whether
 * the relay is reachable — which is why a network that filters
 * relay.walletconnect.org used to read as healthy until a pairing stalled for
 * 60+ seconds with no explanation.
 *
 * This module measures the socket for real, before the UI offers a pairing, and
 * hands back the try order that measurement justifies. It is shared by the
 * connect flow and the health panel, so the two can never tell the user
 * different stories about the same network.
 *
 * ADVISORY ONLY. A verdict here never skips the actual SDK attempt — a browser
 * socket error cannot distinguish "blocked" from "wrong project", and refusing
 * to try on a false negative would be worse than trying.
 */

import { RELAY_URLS, TIMEOUT } from './config.js';
import { withTimeout } from './timing.js';

/** Verdicts that mean "pairing is unlikely to work on this network". */
const BLOCKED_VERDICTS = Object.freeze(['WS_REFUSED', 'UNREACHABLE', 'TIMEOUT']);

export function isRelayBlocked(verdict) {
  return BLOCKED_VERDICTS.includes(String(verdict ?? ''));
}

/** One fetch with a hard bound. Never throws, never leaks the URL's body. */
export async function probeReachable(url, { fetchImpl, timeoutMs = TIMEOUT.healthProbe } = {}) {
  const call = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!call) return { ok: false, error: 'NO_FETCH', ms: 0 };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    try {
      controller?.abort();
    } catch {
      /* best effort */
    }
  }, timeoutMs);
  const started = Date.now();
  try {
    await call(url, { signal: controller?.signal, mode: 'no-cors', cache: 'no-store' });
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.message || error)
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Open one authenticated relay socket and report whether it answered.
 *
 * The handshake is signed with `@walletconnect/relay-auth` — the relay's own
 * client-auth — rather than a bare `?projectId=`, because a socket that is
 * merely accepted by a TCP-shaped middlebox is not a relay, and reporting it as
 * one is how a diagnostic "says OPEN" about a network where pairing cannot work.
 *
 * Never returns the URL it built: it contains the signed JWT.
 */
export async function probeRelay(url, {
  WebSocketImpl,
  projectId = '',
  timeoutMs = TIMEOUT.relayProbe,
  graceMs = 250
} = {}) {
  const WS = WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
  if (!WS) return { url, ok: false, error: 'NO_WEBSOCKET', ms: 0 };

  let target;
  try {
    target = await withTimeout(
      (async () => {
        const { generateKeyPair, signJWT } = await import('@walletconnect/relay-auth');
        const auth = await signJWT('fbt-relay-diagnostic', url, 300, generateKeyPair());
        const u = new URL(url);
        u.searchParams.set('projectId', String(projectId || ''));
        u.searchParams.set('auth', auth);
        u.searchParams.set('ua', 'wc-2/js-2.25.0');
        return u;
      })(),
      timeoutMs,
      'PROBE_AUTH_TIMEOUT'
    );
  } catch {
    return { url, ok: false, error: 'PROBE_AUTH_FAILED', ms: 0 };
  }

  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let socket = null;
    let graceTimer = null;
    const timer = setTimeout(() => finish({ ok: false, error: 'TIMEOUT' }), timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      if (socket) socket.onopen = socket.onerror = socket.onclose = null;
      try {
        socket?.close?.();
      } catch {
        /* best effort */
      }
      resolve({ url, ms: Date.now() - started, ...result });
    };

    try {
      socket = new WS(target.toString());
    } catch {
      /* Constructor errors can contain the authenticated URL. Never surface it. */
      finish({ ok: false, error: 'SOCKET_CONSTRUCTION_FAILED' });
      return;
    }
    socket.onopen = () => finish({ ok: true });
    socket.onerror = () => {
      if (settled) return;
      /* A lone `error` is often followed by a `close` carrying the real code. */
      graceTimer = setTimeout(() => finish({ ok: false, error: 'SOCKET_ERROR' }), graceMs);
    };
    socket.onclose = (event) => {
      const code = Number.isFinite(event?.code) ? Number(event.code) : null;
      if (code != null && code !== 1006) finish({ ok: false, error: `CLOSED_${code}`, closeCode: code });
      else finish({ ok: false, error: 'SOCKET_ERROR', closeCode: code });
    };
  });
}

/**
 * Turn per-host measurements into one verdict.
 *
 *   OPEN         — at least one socket opened;
 *   WS_REFUSED   — the host answers HTTPS but refuses the upgrade (a filtered
 *                  or proxied network: this is the shape ISP blocking takes);
 *   TIMEOUT      — every host went unanswered;
 *   UNREACHABLE  — every host refused outright;
 *   NO_WEBSOCKET — the environment has no WebSocket at all.
 */
export function relayVerdict(hosts = []) {
  const list = Array.isArray(hosts) ? hosts : [];
  const openUrls = list.filter((h) => h?.socket?.ok).map((h) => h.url);
  const httpsUrls = list.filter((h) => h?.https?.ok).map((h) => h.url);
  let verdict = 'UNREACHABLE';
  if (list.length === 0) verdict = 'NO_MEASUREMENT';
  else if (openUrls.length > 0) verdict = 'OPEN';
  else if (list.every((h) => h?.socket?.error === 'NO_WEBSOCKET')) verdict = 'NO_WEBSOCKET';
  else if (httpsUrls.length > 0) verdict = 'WS_REFUSED';
  else if (list.every((h) => h?.socket?.error === 'TIMEOUT')) verdict = 'TIMEOUT';
  return { verdict, openUrls, httpsUrls };
}

/** The measured hosts, open ones first, then the rest of the configured order. */
export function relayOrderFromHosts(hosts, fallback = RELAY_URLS) {
  const base = (Array.isArray(fallback) && fallback.length ? fallback : RELAY_URLS).map(String);
  const list = (Array.isArray(hosts) ? hosts : []).filter(Boolean);
  if (list.length === 0) return [...base];
  const seen = new Set();
  const order = [];
  for (const host of list) {
    if (host?.socket?.ok && !seen.has(host.url)) {
      seen.add(host.url);
      order.push(host.url);
    }
  }
  for (const url of base) {
    if (!seen.has(url)) {
      seen.add(url);
      order.push(url);
    }
  }
  return order;
}

let cached = null;

/** Forget the cached measurement — a live failure just contradicted it. */
export function clearRelayCache() {
  cached = null;
}

/**
 * Measure every relay host in parallel.
 *
 * Sequential probing would let a blocked primary delay the fallback's answer by
 * its own timeout, and the report would then describe the network as it looked
 * during the first socket rather than as it is.
 *
 * @returns {Promise<{verdict:string, hosts:Array, openUrls:string[], order:string[]}>}
 */
export async function measureRelay({
  projectId,
  urls = RELAY_URLS,
  timeoutMs = TIMEOUT.relayProbe,
  force = false,
  fetchImpl,
  WebSocketImpl
} = {}) {
  if (!force && cached && Date.now() - cached.at < TIMEOUT.relayCacheTtl) return cached.value;
  const hosts = await Promise.all(
    urls.map(async (url) => ({
      url,
      socket: await probeRelay(url, { projectId, timeoutMs, WebSocketImpl }),
      https: await probeReachable(String(url).replace(/^wss:/, 'https:'), { fetchImpl, timeoutMs })
    }))
  );
  const { verdict, openUrls } = relayVerdict(hosts);
  const value = { verdict, hosts, openUrls, order: relayOrderFromHosts(hosts, urls), at: Date.now() };
  cached = { at: Date.now(), value };
  return value;
}
