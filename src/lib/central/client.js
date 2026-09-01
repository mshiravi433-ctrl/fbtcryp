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
  const body = {
    message: String(message || '').slice(0, 2000),
    page,
    locale: locale === 'en' ? 'en' : 'fa',
    confirm,
    ...(actionId ? { actionId } : {}),
    ...(planDigest ? { planDigest } : {}),
    ...(txHash ? { txHash } : {}),
    ...(hints ? { hints } : {})
  };
  /* An explicit key (a retry of the same turn) wins; otherwise it is derived, so
     the caller cannot accidentally turn a retry into a fresh request. */
  const key = requestId || requestKey(body.message, page);
  const out = await call('/intent', { method: 'POST', body, timeout: TIMEOUTS.intent, idempotencyKey: key });
  return { ...out, requestId: key };
}

export const intentStatus = (id) => call(`/intent/${encodeURIComponent(String(id || ''))}`);

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
  const seen = new Set();

  const deliver = (evt) => {
    if (closed || !evt || !evt.id || seen.has(evt.id)) return false;
    seen.add(evt.id);
    if (seen.size > 400) seen.clear();
    onEvent?.(evt);
    return true;
  };

  const startPolling = (why) => {
    if (closed || poll) return;
    onTransport?.({ transport: 'polling', reason: why || null });
    let last = 0;
    poll = setInterval(async () => {
      const out = await recentEvents(20);
      if (!out.ok) return;
      for (const evt of out.events || []) {
        if ((evt.at || 0) > last) last = evt.at || 0;
        if (!evt.id) {
          /* The ring buffer only ids events for the stream; a polled event still
             has to be deduplicated or a refresh would fire once per interval. */
          deliver({ ...evt, id: `${evt.type}:${evt.at}:${evt.owner || ''}` });
        } else deliver(evt);
      }
    }, 15000);
  };

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

  return {
    get transport() {
      return source ? 'sse' : 'polling';
    },
    close() {
      closed = true;
      try {
        source?.close();
      } catch {
        /* ignore */
      }
      if (poll) clearInterval(poll);
    }
  };
}

export const __test = { requestKey, deviceScope };
