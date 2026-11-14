/**
 * FBT CENTRAL INTELLIGENCE OS — the browser half of `/api/brain`.
 * ---------------------------------------------------------------------------
 * There is ONE gateway here on purpose (§37: "Frontend calls ONE gateway").
 * No screen is allowed to fetch a venue, a price, or a quote on its own and ask
 * the AI to talk about it: that is how the old per-page assistants ended up
 * showing a balance one screen had read five minutes earlier while another had
 * just spent it. Every sentence a user types goes through `sendIntent`, and every
 * number that comes back is the number the server read for THIS turn.
 *
 * Fail-closed, like `aiIntentClient.js` before it: a non-2xx, an abort, or a
 * network error is returned as data (`{ok:false, code}`) and shown as a gap. This
 * module never manufactures an empty-but-happy object, and it never retries a
 * financial call by itself — replay protection lives on the server, where a
 * retry can be deduplicated against the action record instead of being trusted.
 */
import { apiBase } from '../apiBase.js';
/*
 * The published transfer, read from the DEPENDENCY-FREE store.
 *
 * This import used to point at `../intentCrossChainClient.js`, which
 * imports `@noble/ed25519`, `@noble/hashes` and `server/ethersLite.js`.
 * This file is on the entry path, so that import put a signing library
 * and an ethers implementation into the FIRST-PAINT bundle — 26 KB, for
 * three numbers and three strings — and pushed the first paint over its
 * byte budget. The store now lives in a module with no imports at all.
 */
import { readPublishedRouteRequest } from '../routeRequestStore.js';
import { readActiveAgent } from '../intent-ai/agentHub/activeAgent.js';

/* `NATIVE_PROVIDER_ID` in `server/agentHub/native/index.js`, restated here
   because the browser must not import a server module. */
const NATIVE_PROVIDER_ID = 'fbt-native';

const TIMEOUTS = { intent: 20000, read: 8000, action: 12000 };
const DEVICE_KEY = 'fbt.central.device.v1';
const REQUEST_NS = 'fbt.central.request.v1';

/**
 * A per-install id is what the server keys the shared state and conversation
 * memory on (§7) before a wallet exists, so a signed-out user still gets
 * continuity across turns instead of a fresh amnesiac thread per message.
 */
function deviceScope() {
  try {
    if (typeof window === 'undefined') return '';
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/**
 * A client-generated requestId makes a double-submit idempotent on the FIRST
 * send rather than on a second round-trip: the double click and the retry after a
 * timeout carry the same key, so the server answers with the original action
 * record instead of asking a venue twice. It is derived from the message + the
 * page, so the same words typed deliberately later are a different request.
 */
function requestKey(message, page) {
  const raw = `${REQUEST_NS}:${String(message || '').trim().toLowerCase()}:${page?.route || ''}:${page?.tab || ''}`;
  let h1 = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h1 ^= raw.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return `req_${h1.toString(36)}${raw.length.toString(36)}`;
}

const base = () => {
  try {
    return (typeof apiBase === 'function' ? apiBase() : '') || '/api';
  } catch {
    return '/api';
  }
};

async function call(path, { method = 'GET', body = null, timeout = TIMEOUTS.read, idempotencyKey = null } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  const device = deviceScope();
  try {
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (device) headers['x-fbt-device'] = device;
    if (idempotencyKey) headers['x-fbt-request-id'] = idempotencyKey;
    const res = await fetch(`${base()}/brain${path}`, {
      method,
      ...(ctrl ? { signal: ctrl.signal } : {}),
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const json = text
      ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return { raw: text.slice(0, 240) };
        }
      })()
      : {};
    /* The status is kept on the object because the UI behaves differently per
       code: 428 means "the user has not confirmed yet" (show the card), 409 means
       "the card you are holding is stale" (re-ask), 429 means back off. Swallowing
       the status would flatten all three into an error toast. */
    if (!res.ok) return { ok: false, status: res.status, code: json.code || json.error || `HTTP_${res.status}`, ...json };
    return { ok: true, status: res.status, ...json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      code: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_UNAVAILABLE',
      detail: String(err?.message || '').slice(0, 160),
      /* Surfaced so the chat can say "the brain did not answer" instead of
         silently rendering an empty assistant bubble, which reads as "no data". */
      transport: true
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ── the only path into the brain ───────────────────────────────────────── */

export async function sendIntent(message, { page = null, locale = 'fa', confirm = false, actionId = null, planDigest = null, txHash = null, requestId = null, hints = null } = {}) {
  /*
   * THE TRANSFER THE TURN IS ABOUT.
   *
   * A route question — «which bridge is best for this transfer?» — can
   * only be answered about a transfer somebody described, and the
   * cross-chain panel is what knows it. The panel publishes it; this
   * carries it.
   *
   * It travels INSIDE the page claim rather than beside it, because that
   * is what it is: a fact about what the user is looking at right now,
   * in the same shape as the route, the tab and the selected asset. And
   * it is read HERE rather than at the call site, so every caller of the
   * brain carries it without having to know that route questions need
   * it.
   *
   * The server drops a partial transfer on the floor, so a half-written
   * request can never make the engine quote for a transfer nobody asked
   * for.
   */
  const routeRequest = readPublishedRouteRequest();
  const pageWithRoute = routeRequest ? { ...(page || {}), routeRequest } : page;
  /*
   * THE AGENT THE USER IS TALKING TO.
   *
   * The hub stores one active agent per browser, and until now that choice only
   * re-ordered the suggestion chips: the person picked the token risk scanner,
   * typed in the main chat, and the generic brain answered. It travels the same
   * way the published transfer does — read HERE, not at the call site, so every
   * caller of the brain carries it without having to know that plugins exist.
   *
   * Only a FIRST-PARTY id is sent: the server accepts nothing else, and sending
   * a third-party id would only produce a field the turn has to drop.
   */
  const active = readActiveAgent();
  const agentId = active && (active.providerId === NATIVE_PROVIDER_ID || active.native === true)
    ? String(active.id || '').slice(0, 64)
    : null;
  const body = {
    message: String(message || '').slice(0, 2000),
    page: pageWithRoute,
    locale: locale === 'en' ? 'en' : 'fa',
    confirm,
    ...(actionId ? { actionId } : {}),
    ...(planDigest ? { planDigest } : {}),
    ...(txHash ? { txHash } : {}),
    ...(hints ? { hints } : {}),
    ...(agentId ? { agentId } : {})
  };
  /* An explicit key (a retry of the same turn) wins; otherwise it is derived, so
     the caller cannot accidentally turn a retry into a fresh request. */
  const key = requestId || requestKey(body.message, page);
  const out = await call('/intent', { method: 'POST', body, timeout: TIMEOUTS.intent, idempotencyKey: key });
  return { ...out, requestId: key };
}

export const intentStatus = (id) => call(`/intent/${encodeURIComponent(String(id || ''))}`);

/* ── the plugins a person attaches to themselves ──────────────────────────────────────────────────
 *
 * `sendIntent` carries the browser's choice; these make it the OWNER's, so a
 * turn that starts somewhere else (Telegram, a cron, another device) still
 * knows which plugin this person is talking to. The catalog comes back with the
 * registry's own verdicts beside each card — passport verified, trust score,
 * `canExecute: false` — which is what makes the list a list of plugins we run
 * rather than a listing of agents somebody else does.
 */
export const listPlugins = () => call('/plugins', { timeout: TIMEOUTS.read });

export const attachPlugin = (agentId) => call('/plugins/attach', {
  method: 'POST',
  body: { agentId: String(agentId || '') },
  timeout: TIMEOUTS.action
});

export const detachPlugin = () => call('/plugins/detach', { method: 'POST', body: {}, timeout: TIMEOUTS.action });

/* ── the plugin that speaks first ──────────────────────────────────────────────
 *
 * Arming a watch needs a push identity, because the whole point is that the
 * plugin talks when the app is closed. `pushIdentity()` lives in the
 * notification layer and is imported LAZILY: it drags in service-worker
 * registration and the push subscription, and none of that belongs in the
 * first-paint graph just because a chat client can ask a plugin to keep watch.
 *
 * A browser with no notification permission has no identity, and that is
 * reported instead of papered over: the server would answer BAD_IDENTITY anyway,
 * so the caller learns which half failed and can say so, rather than showing a
 * watch that can never arrive.
 */
export async function armPluginWatch(subject, { agentId = null, lang = 'fa', thresholdPct = null } = {}) {
  const { pushIdentity } = await import('../notify.js');
  const identity = await pushIdentity().catch(() => null);
  if (!identity?.endpoint) return { ok: false, code: 'NO_PUSH_IDENTITY' };
  return call('/plugins/watch', {
    method: 'POST',
    body: { agentId, subject, endpoint: String(identity.endpoint), lang, thresholdPct },
    timeout: TIMEOUTS.action
  });
}

export const listPluginWatches = () => call('/plugins/watches', { timeout: TIMEOUTS.read });

/* Idempotent, like detaching: stopping a watch that is not armed is the same
   state, so the toggle in the UI never has to lie about what happened. */
export const stopPluginWatch = (id = null) => call('/plugins/watch/stop', {
  method: 'POST',
  body: { id },
  timeout: TIMEOUTS.action
});

/**
 * `method` is what the user actually did (§33's "explicit confirmation"): the
 * server refuses a confirm that arrives without it, so a stray 200 from a
 * pre-flight cannot be mistaken for consent.
 */
export const confirmAction = (actionId, { planDigest = null, method = 'button', execute = true, locale = 'fa' } = {}) =>
  call(`/intent/${encodeURIComponent(String(actionId || ''))}/confirm`, {
    method: 'POST',
    timeout: TIMEOUTS.action,
    body: { actionId, planDigest, method, execute, locale }
  });

export const cancelAction = (actionId, reason = 'cancelled from the client') =>
  call(`/intent/${encodeURIComponent(String(actionId || ''))}/cancel`, { method: 'POST', timeout: TIMEOUTS.action, body: { actionId, reason } });

/** What the wallet signed, handed to the brain so it can verify and refresh. */
export const reportReceipt = (actionId, { txHash = null, chainId = null, status = 'BROADCAST' } = {}) =>
  call(`/intent/${encodeURIComponent(String(actionId || ''))}/receipt`, {
    method: 'POST',
    timeout: TIMEOUTS.action,
    body: { actionId, txHash, chainId, status }
  });

export const transactionStatus = (id) => call(`/transactions/${encodeURIComponent(String(id || ''))}`);

/* ── shared state / health / capability surfaces ────────────────────────── */

export const systemState = ({ includeData = false } = {}) => call(`/system/state${includeData ? '?includeData=1' : ''}`);
export const systemHealth = () => call('/system/health');
export const systemCapabilities = () => call('/system/capabilities');
export const recentEvents = (limit = 30) => call(`/system/events?limit=${Math.max(1, Math.min(120, Number(limit) || 30))}`);

/** Push the page/tab/wallet facts the brain cannot see by itself (§7). */
export const syncPageContext = (page) => call('/system/context', { method: 'POST', body: { page }, timeout: TIMEOUTS.read });

/** Direct tool calls exist for diagnostics and for screens that already know
    which read they need; a financial EXECUTE through them still needs a
    confirmed actionId, which the server enforces a second time. */
export const toolCall = (operation, module, input = {}, actionId = null) =>
  call(`/tools/${operation}`, { method: 'POST', timeout: TIMEOUTS.action, body: { module, input, ...(actionId ? { actionId } : {}) } });

/* ── §17: SSE first, polling fallback ──────────────────────────────────── */

/**
 * Subscribes to the brain's event stream for this device. If EventSource is
 * missing or the stream errors (a proxy that buffers, a phone that slept), it
 * degrades to polling `/system/events` — the same data, slower, and the caller is
 * told which transport is live so the UI can say "delayed" instead of pretending.
 */
export function openEventStream({ onEvent, onTransport } = {}) {
  let closed = false;
  let poll = null;
  let source = null;
  let paused = false;
  let last = 0;
  const seen = new Set();

  const deliver = (evt) => {
    if (closed || !evt || !evt.id || seen.has(evt.id)) return false;
    seen.add(evt.id);
    if (seen.size > 400) seen.clear();
    onEvent?.(evt);
    return true;
  };

  const readOnce = async () => {
    if (closed) return;
    const out = await recentEvents(20).catch(() => null);
    if (!out?.ok) return;
    for (const evt of out.events || []) {
      if ((evt.at || 0) > last) last = evt.at || 0;
      if (!evt.id) {
        /* The ring buffer only ids events for the stream; a polled event still
           has to be deduplicated or a refresh would fire once per interval. */
        deliver({ ...evt, id: `${evt.type}:${evt.at}:${evt.owner || ''}` });
      } else deliver(evt);
    }
  };

  const stopTransports = () => {
    try {
      source?.close();
    } catch {
      /* already down */
    }
    source = null;
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
  };

  const startPolling = (why) => {
    if (closed || paused || poll) return;
    onTransport?.({ transport: 'polling', reason: why || null });
    /* The fallback transport for hosts without EventSource. 15 s was chosen
       when this was the only path; it is now a last resort, and on a serverless
       host each tick is a billed invocation. 60 s with hidden tabs skipped. */
    poll = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void readOnce();
    }, 60000);
  };

  const connect = () => {
    if (closed || paused) return;
    stopTransports();
    try {
      if (typeof EventSource === 'undefined') {
        startPolling('NO_EVENTSOURCE');
      } else {
        source = new EventSource(`${base()}/brain/system/stream`, { withCredentials: false });
        source.onopen = () => onTransport?.({ transport: 'sse', reason: null });
        source.onerror = () => {
          try {
            source?.close();
          } catch {
            /* already down */
          }
          source = null;
          startPolling('SSE_ERROR');
        };
        source.onmessage = (msg) => {
          try {
            deliver(JSON.parse(msg.data));
          } catch {
            /* a heartbeat frame carries no JSON; it is proof the pipe is alive */
          }
        };
      }
    } catch {
      startPolling('SSE_UNSUPPORTED');
    }
  };

  /*
   * ─── NO EVENT TRAFFIC FROM A HIDDEN TAB ─────────────────────────────────
   * This subscription is mounted ABOVE the router (CentralBrainContext), so it
   * exists on every screen of the app, for the whole session. On the deployed
   * host the SSE stream is cut at the function's max duration and the client
   * degrades to `/system/events` every 15 s — 5,760 requests per day per open
   * tab, each one waking the brain, for a banner nobody could see. Measured
   * across the app's other pollers this was the single largest request source
   * in the whole client, and none of it was being read.
   *
   * So the transports are torn down while the tab is hidden (the last reported
   * transport is deliberately NOT overwritten — "hidden" is not "offline", and
   * a panel that flashed «قطع» every time the user switched tabs would be
   * lying). Becoming visible reconnects and catches up immediately through one
   * `readOnce()`, so no event published while the tab slept is missed and the
   * screen is never stale on return.
   */
  const doc = typeof document === 'undefined' ? null : document;
  const onVisibilityChange = () => {
    if (closed || !doc) return;
    if (doc.visibilityState === 'hidden') {
      paused = true;
      stopTransports();
      return;
    }
    if (!paused) return;
    paused = false;
    connect();
    void readOnce();
  };
  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', onVisibilityChange);
    if (doc.visibilityState === 'hidden') paused = true;
  }

  if (!paused) connect();

  return {
    get transport() {
      return source ? 'sse' : 'polling';
    },
    close() {
      closed = true;
      if (doc && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('visibilitychange', onVisibilityChange);
      }
      stopTransports();
    }
  };
}

export const __test = { requestKey, deviceScope };
