/**
 * THE SECOND HAND-OFF: a signing request inside the Android app.
 * ---------------------------------------------------------------------------
 * A WalletConnect session has two deep links, not one. The first carries the
 * pairing (`wc:…`) and is owned by handoff.js. The second is the one the SDK
 * fires for EVERY signing request on a phone:
 *
 *     <wallet-scheme>://wc?requestId=<id>&sessionTopic=<topic>
 *
 * The wallet opens it, looks the request up ON THE RELAY by id, and shows the
 * approval screen. So the link is only useful once the request EXISTS on the
 * relay — and that is exactly what the SDK does not wait for: in
 * `Engine.request` the redirect runs in `Promise.all` next to `sendRequest`,
 * i.e. BEFORE the relay has acknowledged the publish.
 *
 * ─── WHY THIS ONLY BREAKS INSIDE THE APK ───────────────────────────────────
 * «تو سایت درست کار میکنه، فقط تو اپ اندروید موقع امضا میگه اتصال برقرار
 * نیست». Two things are different inside a Capacitor WebView:
 *
 *   1. THE SOCKET IS HALF-DEAD AFTER BACKGROUNDING. Android freezes the app's
 *      network while the wallet has the screen; the relay socket that comes
 *      back is often open in name only (`readyState === 1`) with no peer
 *      behind it. The SDK has no browser-side ping, so `relayer.connected`
 *      stays `true`, `transportOpen()` is a no-op, and the publish sits in
 *      the socket buffer for ~10s until the SDK's own stall detector restarts
 *      the transport. The wallet, meanwhile, has already been opened with a
 *      requestId that names nothing → «اتصال برقرار نیست».
 *   2. THE LINK IS OPENED BY THE WEBVIEW, NOT A BROWSER. `window.open(link,
 *      '_self')` becomes a Capacitor navigation, then an implicit
 *      `ACTION_VIEW` with no package — and the same instant our own
 *      «bring the wallet back» nudge fires a second, bare-scheme intent. Two
 *      launches racing, neither scoped to the wallet that owns the session.
 *
 * On the website the tab is a real browser: the socket is closed cleanly and
 * reopened by the SDK, and Chrome resolves the scheme itself. Nothing here
 * runs outside the native channel unless asked to.
 *
 * ─── WHAT THIS MODULE DOES ─────────────────────────────────────────────────
 *   • verifyRelayLive(): PROVES the relay socket is alive with one real RPC
 *     (`irn_batchFetchMessages` on the session's topics, bounded) — and, as a
 *     side effect, DELIVERS any response the wallet already published while
 *     we were away. A socket that does not answer is restarted through the
 *     SDK's own `restartTransport()`, which resubscribes and fetches history.
 *     Run before every signing request and on every return from the wallet.
 *   • installSessionRequestGate(): holds the SDK's requestId link until the
 *     `session_request_sent` event says the relay HAS the request, then opens
 *     it — package-scoped through the Java bridge when it exists. If the SDK
 *     never handed us a link (the WebView reported no focus, the choice key
 *     was missing), the link is built from the registry instead. One launch,
 *     at the right moment, to the right app.
 *
 * Everything here is fail-open: a probe that cannot run, a gate that cannot
 * be installed, an event that never fires — each falls back to what the SDK
 * would have done on its own.
 */

import { withTimeout } from './timing.js';
import { linkBase, urlScheme, walletForUrl, rememberedMobileWallet } from './wallets.js';

/** How long a captured request link may wait for `session_request_sent`. */
export const REQUEST_LINK_HOLD_MS = 45_000;
/**
 * If the client's event bus is not observable (an SDK build we did not
 * expect), a held link is released after this — later than the SDK would have
 * opened it, and past the point where a healthy publish has been acked.
 */
export const REQUEST_LINK_RELEASE_MS = 1_500;
/** One RPC round-trip on a live socket is ~100-400ms on mobile data. */
export const RELAY_PROBE_MS = 3_000;
/** A full restart (close, reconnect, resubscribe, fetch history). */
export const RELAY_RESTART_MS = 9_000;

const DIGITS = /^\d{1,32}$/;
const HEX_TOPIC = /^[0-9a-f]{64}$/i;

/**
 * Read one URL as a WalletConnect session-request link.
 *
 * Accepts the SDK's native form (`trust://wc?requestId=…&sessionTopic=…`,
 * with one or three slashes) and the link-mode form
 * (`https://link.trustwallet.com/wc?requestId=…`). Anything without BOTH a
 * numeric requestId and a 32-byte hex topic is not a request link.
 *
 * @returns {{url:string, scheme:string, requestId:string, topic:string, https:boolean}|null}
 */
export function parseSessionRequestLink(raw) {
  const url = String(raw ?? '').trim();
  if (!url || url.length > 2048) return null;
  const scheme = urlScheme(url);
  if (!scheme || scheme === 'wc' || ['about', 'blob', 'data', 'javascript'].includes(scheme)) return null;
  const q = url.indexOf('?');
  if (q < 0) return null;
  const head = url.slice(0, q);
  if (!/\/wc$/i.test(head)) return null;
  const params = new URLSearchParams(url.slice(q + 1));
  const requestId = String(params.get('requestId') ?? '').trim();
  const topic = String(params.get('sessionTopic') ?? '').trim().toLowerCase();
  if (!DIGITS.test(requestId) || !HEX_TOPIC.test(topic)) return null;
  return { url, scheme, requestId, topic, https: scheme === 'http' || scheme === 'https' };
}

/** The link the SDK would have built for this wallet and request. */
export function sessionRequestLink(wallet, { requestId, topic } = {}) {
  const base = linkBase(wallet?.native);
  const id = String(requestId ?? '').trim();
  const t = String(topic ?? '').trim().toLowerCase();
  if (!base || !DIGITS.test(id) || !HEX_TOPIC.test(t)) return '';
  return `${base}wc?requestId=${id}&sessionTopic=${t}`;
}

/** The sign client behind an EthereumProvider / UniversalProvider, or null. */
export function signClientOf(eip) {
  return eip?.signer?.client ?? eip?.client ?? null;
}

/** The relayer behind a provider or a sign client, or null. */
export function relayerOf(source) {
  return (
    source?.signer?.client?.core?.relayer
    ?? source?.client?.core?.relayer
    ?? source?.core?.relayer
    ?? (typeof source?.restartTransport === 'function' ? source : null)
    ?? null
  );
}

/** The topics this relayer is (or should be) subscribed to. */
function relayTopics(relayer, extra = []) {
  const out = new Set();
  try {
    for (const t of relayer?.subscriber?.topics ?? []) if (HEX_TOPIC.test(t)) out.add(String(t).toLowerCase());
  } catch { /* an SDK without the getter still has the session topic below */ }
  for (const t of extra) if (t && HEX_TOPIC.test(t)) out.add(String(t).toLowerCase());
  return [...out];
}

/* One probe at a time per relayer: two callers (pre-sign and app-resume in the
   same second) must not trigger two restarts. */
const inflight = new WeakMap();

/**
 * Prove the relay socket is alive — and pull whatever is waiting on it.
 *
 * @param {object} relayer  the SDK relayer (or anything relayerOf() resolves)
 * @param {object} [options]
 * @param {string[]} [options.topics]     topics to fetch (defaults to subscribed)
 * @param {number}   [options.timeoutMs]  bound for the probe RPC
 * @param {number}   [options.restartMs]  bound for the restart when the probe fails
 * @param {boolean}  [options.restart]    restart a dead socket (default true)
 * @returns {Promise<{ok:boolean, live:boolean, restarted:boolean, delivered:number, ms:number, error?:string}>}
 *   `ok` — the relay is usable now (alive, or restarted successfully);
 *   `live` — the probe itself answered (no restart was needed).
 */
export async function verifyRelayLive(relayer, options = {}) {
  const relay = relayerOf(relayer);
  if (!relay) return { ok: false, live: false, restarted: false, delivered: 0, ms: 0, error: 'NO_RELAY' };
  const running = inflight.get(relay);
  if (running) return running;
  const run = (async () => {
    const {
      topics: extra = [],
      timeoutMs = RELAY_PROBE_MS,
      restartMs = RELAY_RESTART_MS,
      restart = true
    } = options;
    const started = Date.now();
    const topics = relayTopics(relay, extra);
    let delivered = 0;
    let error = '';

    if (topics.length > 0 && typeof relay.provider?.request === 'function') {
      try {
        const res = await withTimeout(
          Promise.resolve(relay.provider.request({
            method: 'irn_batchFetchMessages',
            params: { topics }
          })),
          timeoutMs,
          'RELAY_PROBE_TIMEOUT'
        );
        const messages = Array.isArray(res?.messages) ? res.messages : [];
        if (messages.length > 0 && typeof relay.handleBatchMessageEvents === 'function') {
          try {
            await relay.handleBatchMessageEvents(messages);
            delivered = messages.length;
          } catch { /* duplicates are dropped by the SDK's own message store */ }
        }
        return { ok: true, live: true, restarted: false, delivered, ms: Date.now() - started };
      } catch (err) {
        error = String(err?.message || err || 'RELAY_PROBE_FAILED').slice(0, 120);
      }
    } else if (relay.connected === true && !relay.transportExplicitlyClosed) {
      /* Nothing to fetch and nothing to prove against: trust the flag, but do
         not call it "live" — a caller that wants certainty has none here. */
      return { ok: true, live: false, restarted: false, delivered: 0, ms: Date.now() - started, error: 'NO_TOPICS' };
    } else {
      error = 'NOT_CONNECTED';
    }

    if (!restart) return { ok: false, live: false, restarted: false, delivered, ms: Date.now() - started, error };

    /* The socket did not answer: it is dead whatever `connected` says. The
       SDK's own restart closes it, reconnects, resubscribes and fetches the
       messages published while it was dead — the response we may be waiting
       for arrives through that path. */
    try {
      const restartFn = typeof relay.restartTransport === 'function'
        ? () => relay.restartTransport()
        : async () => {
          await relay.transportClose?.();
          await relay.transportOpen?.();
        };
      await withTimeout(Promise.resolve(restartFn()), restartMs, 'RELAY_RESTART_TIMEOUT');
    } catch (err) {
      error = `${error};${String(err?.message || err || 'RESTART_FAILED').slice(0, 80)}`;
    }
    const ok = relay.connected === true;
    return { ok, live: false, restarted: ok, delivered, ms: Date.now() - started, error };
  })();
  inflight.set(relay, run);
  try {
    return await run;
  } finally {
    inflight.delete(relay);
  }
}

/* ── the gate ─────────────────────────────────────────────────────────────── */

/**
 * Open one request link package-scoped when the Java bridge exists, else
 * through the browser call we were given.
 *
 * @returns {{ok:boolean, route:string}}
 */
export function openSessionRequestLink(win, url, { wallet, openWindow } = {}) {
  const parsed = parseSessionRequestLink(url);
  if (!parsed) return { ok: false, route: 'none' };
  const target = wallet ?? walletForUrl(url);
  const bridge = win?.FBTWalletLink;
  if (bridge && typeof bridge.openSessionLink === 'function') {
    try {
      const res = bridge.openSessionLink(parsed.url, target?.androidPackage || '');
      if (res === true || res === 'true') return { ok: true, route: 'native-bridge' };
    } catch { /* an older APK without the method: fall through */ }
  }
  try {
    const opener = typeof openWindow === 'function' ? openWindow : win?.open?.bind(win);
    if (typeof opener === 'function') {
      opener(parsed.url, '_self', 'noreferrer noopener');
      return { ok: true, route: 'window-open' };
    }
  } catch { /* nothing else to try */ }
  return { ok: false, route: 'none' };
}

/**
 * Install the gate on `win.open` and subscribe the sign client.
 *
 * Idempotent per window and per client; returns the controller so callers can
 * attach further clients (a reconnect creates a new one) or read state in a
 * test. Never installs outside the native channel unless `force` is set.
 *
 * @param {object} [options]
 * @param {Window} [options.win]
 * @param {boolean} [options.force]       install even outside the APK (tests)
 * @param {(name:string, detail?:object) => void} [options.trace]
 * @param {() => object|null} [options.wallet]  the wallet to build a link for
 *        when none was captured (defaults to rememberedMobileWallet)
 * @param {(url:string, ctx:object) => {ok:boolean, route:string}} [options.open]
 */
export function installSessionRequestGate(options = {}) {
  const win = options.win ?? (typeof window !== 'undefined' ? window : null);
  if (!win) return null;
  const existing = win.__fbtSessionRequestGate;
  if (existing) return existing;
  const isNative = Boolean(win.Capacitor?.isNativePlatform?.());
  if (!isNative && !options.force) return null;
  if (typeof win.open !== 'function') return null;

  const trace = (name, detail) => {
    try { options.trace?.(name, detail); } catch { /* never load-bearing */ }
  };
  const walletFor = typeof options.wallet === 'function' ? options.wallet : () => rememberedMobileWallet();
  const setTimer = (fn, ms) => (typeof win.setTimeout === 'function' ? win.setTimeout(fn, ms) : setTimeout(fn, ms));
  const clearTimer = (id) => (typeof win.clearTimeout === 'function' ? win.clearTimeout(id) : clearTimeout(id));

  const original = win.open;
  const originalBound = (...args) => original.apply(win, args);
  /** requestId → { link, wallet, release, drop, at } */
  const held = new Map();
  /** ids already opened (so a late captured link is not opened twice) */
  const opened = new Set();
  const clients = new WeakSet();
  let attachedClients = 0;

  const doOpen = (link, wallet, why) => {
    const result = typeof options.open === 'function'
      ? options.open(link.url, { wallet, openWindow: originalBound, why })
      : openSessionRequestLink(win, link.url, { wallet, openWindow: originalBound });
    trace(result.ok ? 'sign_request_link_opened' : 'sign_request_link_failed', {
      route: result.route,
      why,
      scheme: link.scheme
    });
    return result;
  };

  const release = (requestId, why) => {
    const entry = held.get(requestId);
    if (!entry) return false;
    held.delete(requestId);
    clearTimer(entry.release);
    clearTimer(entry.drop);
    if (opened.has(requestId)) return true;
    opened.add(requestId);
    doOpen(entry.link, entry.wallet, why);
    return true;
  };

  const onSent = (event) => {
    const requestId = String(event?.id ?? '');
    const topic = String(event?.topic ?? '').toLowerCase();
    if (!DIGITS.test(requestId)) return;
    trace('sign_request_sent', { held: held.has(requestId) });
    if (release(requestId, 'sent')) return;
    if (opened.has(requestId)) return;
    /* The SDK did not hand us a link (no focus, no choice key, or it opened
       nothing): build it from the registry so the wallet is still brought to
       the exact request. */
    const wallet = walletFor();
    const url = sessionRequestLink(wallet, { requestId, topic });
    const link = parseSessionRequestLink(url);
    if (!link) {
      trace('sign_request_link_unbuildable', { wallet: wallet?.key ?? '' });
      return;
    }
    opened.add(requestId);
    doOpen(link, wallet, 'built');
  };

  const gate = function sessionRequestGate(url, name, features) {
    let link = null;
    try { link = parseSessionRequestLink(url); } catch { link = null; }
    if (!link) return original.call(win, url, name, features);
    if (opened.has(link.requestId)) return null;
    const wallet = walletForUrl(link.url) ?? walletFor();
    if (held.has(link.requestId)) return null;
    const entry = {
      link,
      wallet,
      at: Date.now(),
      /* No client to listen to → release on a timer rather than never. */
      release: attachedClients > 0 ? 0 : setTimer(() => release(link.requestId, 'timer'), REQUEST_LINK_RELEASE_MS),
      drop: setTimer(() => {
        const e = held.get(link.requestId);
        if (!e) return;
        held.delete(link.requestId);
        clearTimer(e.release);
        trace('sign_request_link_dropped', { scheme: link.scheme });
      }, REQUEST_LINK_HOLD_MS)
    };
    held.set(link.requestId, entry);
    trace('sign_request_link_held', { scheme: link.scheme, listening: attachedClients > 0 });
    return null;
  };
  gate.__fbtGate = true;
  win.open = gate;

  const controller = {
    attachClient(client) {
      if (!client || typeof client.on !== 'function' || clients.has(client)) return false;
      try {
        client.on('session_request_sent', onSent);
        clients.add(client);
        attachedClients += 1;
        return true;
      } catch {
        return false;
      }
    },
    /** For a request we know was sent by other means (tests, manual). */
    notifySent: onSent,
    heldIds: () => [...held.keys()],
    openedIds: () => [...opened],
    uninstall() {
      for (const entry of held.values()) {
        clearTimer(entry.release);
        clearTimer(entry.drop);
      }
      held.clear();
      if (win.open === gate) win.open = original;
      if (win.__fbtSessionRequestGate === controller) delete win.__fbtSessionRequestGate;
    }
  };
  try {
    Object.defineProperty(win, '__fbtSessionRequestGate', { value: controller, configurable: true, enumerable: false });
  } catch {
    win.__fbtSessionRequestGate = controller;
  }
  return controller;
}

/**
 * Wire one WalletConnect provider into the native request hand-off.
 *
 * Called where the provider is adapted into the app's signer (WalletContext),
 * so a connect, a resume and an adopted session all get the same treatment.
 * Outside the APK it does nothing and returns null.
 */
export function armNativeRequestHandoff(eip, { win, trace } = {}) {
  const target = win ?? (typeof window !== 'undefined' ? window : null);
  const gate = installSessionRequestGate({ win: target, trace });
  if (!gate) return null;
  const client = signClientOf(eip);
  if (client) gate.attachClient(client);
  return gate;
}
