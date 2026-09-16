/**
 * RELAY PREFLIGHT — measure the socket BEFORE promising a pairing.
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS (measured, not assumed)
 *
 * A support report from https://fbtswap.ir (2026-09-16) arrived with a health
 * report AND the app's own boot trace in the same JSON. Read side by side, the
 * two contradict each other:
 *
 *   trace:  relay_try(0) → relay_ok(0)      202ms after the try
 *   health: relay.walletconnect.org        socket SOCKET_ERROR after 1423ms
 *           relay.walletconnect.com        socket SOCKET_ERROR after 2031ms
 *           both hosts                     HTTPS answered (199ms / 132ms)
 *           relayVerdict                   WS_REFUSED
 *
 * `relay_ok` is emitted the moment `EthereumProvider.init()` resolves. The
 * SDK says what that is worth — `@walletconnect/core@2.25.0`,
 * `dist/index.js`, `Relayer.init()`:
 *
 *     async init(){ …, this.initialized=!0,
 *       this.transportOpen().catch(t=>this.logger.warn(t,t?.message)) }
 *
 * `transportOpen()` is NOT awaited. And its own first line is:
 *
 *     async transportOpen(t){
 *       if(!this.subscriber.hasAnyTopics){
 *         this.logger.info("Starting WS connection skipped because the client
 *                           has no topics to work with.");
 *         return } … }
 *
 * So on a clean slate — which is exactly what `connectWalletConnect()` forces
 * by purging storage immediately before init — init() does not even ATTEMPT a
 * socket, and on any slate it never waits for one. Two consequences, both
 * verified in that report:
 *
 *   1. `relay_ok` never measured the relay. It measured "a provider object was
 *      constructed", in 202ms, on a network where the relay socket takes
 *      1423ms to fail and never opens. A diagnostic that reports success on
 *      the hop that is dead is worse than no diagnostic: every fix aimed at
 *      it (relay failover, init timeouts, retry budgets) was aimed upstream
 *      of the first real contact with the relay.
 *   2. The relay failover loop was dead code for the exact case it was written
 *      for. `initWcProvider()` only tries the next hostname when init()
 *      REJECTS, and a blocked relay does not make init() reject — the first
 *      contact with the socket happens later, inside `wc.connect()`, at
 *      `Relayer.toEstablishConnection()` (called from `publish`). On a network
 *      that blocks `.org` but allows `.com`, the fallback was never reached.
 *
 * THE FIX THIS MODULE PROVIDES
 *
 * One instrument, used by BOTH surfaces, so the panel and the connect flow can
 * never tell the user two different stories:
 *
 *   • `probeRelay()` — a real WebSocket to the relay, exactly the URL shape the
 *     SDK uses (`?projectId=…`), with the timing and the close code kept.
 *   • `probeRelaySet()` — every hostname at once, plus the verdict rule and a
 *     MEASURED TRY ORDER (the host whose socket opened goes first), which is
 *     what finally makes failover real.
 *   • `getRelayState()` — the cached, single-flighted preflight the connect
 *     and restore flows call before they spend anything on the SDK.
 *   • `readRelaySocket()` — the SDK's OWN answer (`relayer.connected` is
 *     `socket.readyState === 1` in the installed core), for the moments after
 *     init where the truth is one property read away instead of an inference.
 *
 * Everything is injectable (WebSocket / fetch / clock) so the probe suite can
 * hold every edge still and assert the reporting, not the internet.
 */

import { WC_RELAY_URLS } from './wcTimeout.js';

/**
 * How long one relay hostname gets to open a socket during the preflight.
 *
 * Short on purpose: this runs in front of a user's tap, and its job is to
 * replace a ~2s SDK failure (fast-refuse networks) or a 20s bound (packet-
 * swallowing networks) with a measured answer. Measured against the report
 * above: a refusal answers in 1.4-2.0s, an open socket in ~0.2s, so 5s leaves
 * room for a slow-but-working mobile network without becoming the wait itself.
 */
export const RELAY_PREFLIGHT_TIMEOUT_MS = 5_000;

/**
 * How long a measurement is trusted. A blocked relay can unblock (the user
 * switches network, the VPN reconnects) and a working one can break, so the
 * cache exists to stop a double-tap from probing twice — not to make a verdict
 * permanent. 90s is one "the user tried again" cycle.
 */
export const RELAY_STATE_TTL_MS = 90_000;

/**
 * Verdicts that mean "pairing cannot work on this network right now".
 * Deliberately EXCLUDES the two verdicts that are not measurements of a block:
 * NO_WEBSOCKET (this host has no WebSocket at all — nothing was measured) and
 * NO_MEASUREMENT (no relay address configured). Refusing to try on those would
 * turn a missing instrument into a broken feature.
 */
export const RELAY_BLOCKED_VERDICTS = ['WS_REFUSED', 'UNREACHABLE', 'TIMEOUT'];

/** Is this verdict a measured block? (See RELAY_BLOCKED_VERDICTS.) */
export function isRelayBlocked(verdict) {
  return RELAY_BLOCKED_VERDICTS.includes(String(verdict || ''));
}

/**
 * Reachability without a readable body (neither the frame nor the relay sends
 * CORS headers): `no-cors` RESOLVES with an opaque response when the request
 * reached the server, and rejects when the network refused — which is the
 * distinction the report needs.
 */
export async function probeReachable(url, { fetchImpl, timeoutMs = 8_000 } = {}) {
  const call = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!call) return { ok: false, error: 'NO_FETCH' };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { try { controller?.abort(); } catch { /* noop */ } }, timeoutMs);
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

/**
 * One WebSocket to one relay hostname.
 *
 * The socket is the ONLY honest probe of a relay: the relay serves HTTPS on the
 * same hostname, so "the host answers" and "a pairing can happen" are two
 * different measurements — and a network that filters the WebSocket upgrade
 * (DPI on `Upgrade: websocket`, the shape Iranian filtering actually takes)
 * answers the first and refuses the second. The `?projectId=` query is the URL
 * shape the SDK itself opens, so the probe is refused for the same reasons the
 * SDK would be.
 *
 * Two facts ride along because they are the difference between the possible
 * verdicts, and neither can be reconstructed after the fact:
 *
 *   • `ms` — how long the failure took. A reset in 40ms is a refusal; a stall
 *     that ends at the timeout is a filter that swallows packets. Two very
 *     different phone calls for the user.
 *   • `closeCode` — what the socket published. Browsers report `1006` for ANY
 *     failed handshake, so 1006 is kept as `SOCKET_ERROR` + `closeCode: 1006`
 *     (never dressed up as "the host refused you"), while a real close code
 *     from the relay (e.g. 3000, project/origin rejected) is reported as
 *     `CLOSED_<code>` and IS distinguishable.
 *
 * `graceMs` lets a following `close` event land before the error is reported,
 * because in browsers `error` arrives first and the close code arrives with the
 * second event.
 */
export function probeRelay(url, { WebSocketImpl, projectId = '', timeoutMs = 8_000, graceMs = 250 } = {}) {
  const WS = WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
  if (!WS) return Promise.resolve({ url, ok: false, error: 'NO_WEBSOCKET', ms: 0 });
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
      try { socket?.close?.(); } catch { /* noop */ }
      resolve({ url, ms: Date.now() - started, ...result });
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'TIMEOUT', state: 'timeout' }), timeoutMs);
    try {
      const target = projectId ? `${url}/?projectId=${encodeURIComponent(projectId)}` : url;
      socket = new WS(target);
    } catch (error) {
      finish({ ok: false, error: String(error?.message || error) });
      return;
    }
    socket.onopen = () => finish({ ok: true, state: 'open' });
    socket.onerror = () => {
      /* Report the error itself, but give the close event its beat first — the
         code (if the relay published one) is worth waiting 250ms for. */
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

/**
 * The relay's HTTPS door, asked separately from its WebSocket door.
 *
 * This is the measurement that separates the two shapes of "the relay does not
 * work here": an HTTPS request to the same host that RESOLVES proves DNS, TCP
 * and TLS are all fine and only the upgrade was refused (DPI on the WebSocket
 * handshake, or an edge rule) — while an HTTPS request that REJECTS too means
 * the hostname itself is filtered, poisoned or unroutable.
 */
export function probeRelayHttps(url, { fetchImpl, timeoutMs = 8_000 } = {}) {
  const target = String(url || '').replace(/^wss:/, 'https:');
  return probeReachable(target, { fetchImpl, timeoutMs });
}

/**
 * The verdict over every probed relay host, from measured facts only.
 *
 *   OPEN          at least one socket opened — pairing has a path.
 *   WS_REFUSED    no socket opened, but a relay host answered over HTTPS:
 *                 the host is alive and the WebSocket upgrade is what fails.
 *   UNREACHABLE   no socket opened and no host answered over HTTPS: the
 *                 hostname/route is filtered (DNS, SNI or a dead network).
 *   NO_WEBSOCKET  this host has no WebSocket at all (nothing was measured).
 *
 * Kept as a pure function taking the probe results, so the panel's sentence,
 * the preflight's decision and the tests all come from the same rule.
 */
export function relayVerdict(hosts = []) {
  const list = Array.isArray(hosts) ? hosts : [];
  const openUrls = list.filter((host) => host?.socket?.ok).map((host) => host.url);
  const httpsUrls = list.filter((host) => host?.https?.ok).map((host) => host.url);
  let verdict = 'UNREACHABLE';
  if (list.length === 0) verdict = 'NO_MEASUREMENT';
  else if (openUrls.length > 0) verdict = 'OPEN';
  else if (list.every((host) => !host?.socket || host.socket.error === 'NO_WEBSOCKET')) verdict = 'NO_WEBSOCKET';
  else if (httpsUrls.length > 0) verdict = 'WS_REFUSED';
  /* No host answered on either door AND every socket ended at the timer: the
     network is swallowing packets instead of refusing them — the filtered-link
     signature, and a different conversation from "your DNS is wrong". */
  else if (list.every((host) => host?.socket?.error === 'TIMEOUT')) verdict = 'TIMEOUT';
  return { verdict, openUrls, httpsUrls };
}

/**
 * The try order the SDK should be handed.
 *
 * This is what turns relay failover from a comment into a behaviour: hosts
 * whose socket OPENED come first (in the configured order), then the rest (in
 * the configured order). A permutation of the configured list, never an
 * invention — an unmeasured host still gets its turn, it just does not get to
 * be first when another one has already proven itself.
 */
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

/**
 * Probe EVERY relay hostname at once and reduce it to one state.
 *
 * Parallel on purpose: a sequential walk would make a blocked primary delay the
 * fallback's answer by its own timeout, and the state would then describe the
 * network as it looked during the first socket rather than as it is.
 *
 * `https: true` also asks each host's HTTPS door, which is what distinguishes
 * WS_REFUSED (host alive, upgrade filtered — the actionable case) from
 * UNREACHABLE (nothing answers at all). It costs ~150ms and it is the
 * difference between two different pieces of advice.
 */
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
  const hosts = await Promise.all(list.map(async (url) => ({
    url,
    socket: await probeRelay(url, { WebSocketImpl, projectId, timeoutMs, graceMs }),
    https: https ? await probeRelayHttps(url, { fetchImpl, timeoutMs }) : null
  })));
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

/**
 * THE SDK'S OWN ANSWER, NOT AN INFERENCE.
 *
 * `@walletconnect/core@2.25.0` `Relayer`:
 *     get connected(){return this.provider?.connection?.socket?.readyState===1}
 *     get connecting(){return …readyState===0||this.connectPromise!==void 0}
 * and the live relayer is `wc.signer.client.core.relayer` (the same object path
 * `repairSignClientMetadata()` already walks for the metadata). Reading it is
 * the only way to say something true about the socket AFTER init — where
 * `relay_ok` used to say something false.
 *
 * `readyState` rides along because 0 (CONNECTING) and null (never attempted)
 * are different facts, and the difference is exactly the `transportOpen()`
 * short-circuit documented at the top of this file: on a clean slate the SDK
 * has no topics yet, so it has not tried.
 */
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

/* ── the cached preflight ─────────────────────────────────────────────────── */

/** @type {null | Awaited<ReturnType<typeof probeRelaySet>>} */
let cached = null;
/** @type {null | Promise<any>} */
let inflight = null;

/** The last measurement, or null. Pure read — for the UI and the tests. */
export function readRelayStateCache() {
  return cached;
}

/**
 * Forget the measurement.
 *
 * Called after a relay-class failure: a verdict that was OPEN a minute ago and
 * a pairing that just died on the socket disagree, and the honest response is
 * to re-measure on the next attempt instead of trusting the cache.
 */
export function clearRelayStateCache() {
  cached = null;
}

/** Test hook: forget the measurement AND any in-flight probe. */
export function resetRelayState() {
  cached = null;
  inflight = null;
}

/**
 * The preflight: one measurement, shared by every caller inside the TTL.
 *
 * Single-flighted because the surfaces that ask are user-driven and can overlap
 * (a tap on Connect while a restore is still running) — two probes would open
 * four sockets to answer one question. `force` re-measures now, which is what
 * the sheet's explicit "try anyway" uses.
 *
 * Never throws: a probe that cannot run returns NO_MEASUREMENT, which
 * `isRelayBlocked()` deliberately does not treat as a block.
 */
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
      cached = null; /* a failed probe must not be served as a measurement */
      return { ...fallback, fromCache: false };
    });
  inflight = run.then(
    (state) => { inflight = null; return state; },
    (error) => { inflight = null; throw error; }
  );
  return run;
}
