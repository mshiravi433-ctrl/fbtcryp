/**
 * AI CHAT — THE TRANSPORT CONTRACT AROUND A TURN.
 * ---------------------------------------------------------------------------
 * Reported on production (fbtswap.ir): asking the assistant anything the local
 * OS handed to the server, or requesting an intent that needed a confirmation
 * card, answered «فعلاً پاسخ‌گویی هوش مصنوعی در دسترس نیست…» at once, while every
 * provider health probe was green.
 *
 * ─── WHAT WAS ACTUALLY WRONG ───────────────────────────────────────────────
 * Nothing inside the turn. The turn never started:
 *
 *   1. SIZE. The browser posted its whole context object, including a 250-row
 *      market feed with sparklines kept for the in-browser portfolio card
 *      (~300 KB+). `express.json` stops at 256 KB, so `/api/v1/ai/chat`,
 *      `/execute` and `/confirm` answered 413 — as Express' HTML error page,
 *      which the client could only read as INVALID_RESPONSE.
 *      This is the failure that was reproduced, end to end, in a real
 *      browser. The three below were found while looking for it; each one
 *      ends in the same sentence on the screen, so each one is closed here.
 *   2. BUDGET. Every chat message also posts one telemetry record
 *      (`/learning/record`). Both counted against ONE budget of 10 writes a
 *      minute, so the sixth server turn of a minute — or the second person
 *      behind a shared address — would be refused with 429.
 *   3. NO JSON ON FAILURE. The API had no error middleware. A thrown error, an
 *      oversized or malformed body, a failed durable write — each became an
 *      HTML page, and none of them could be told apart or retried sensibly.
 *   4. NO EVIDENCE. Nothing recorded how a production turn ended, so a failure
 *      that only real browsers could trigger was invisible from the outside.
 *
 * This module owns the four answers. It is transport only: it never reads a
 * message, never chooses a model and never touches execution authority.
 */

import { storeGetFresh, storeSet } from './store.js';

/* -------------------------------------------------------------------------- */
/* 1. request size                                                             */
/* -------------------------------------------------------------------------- */

/**
 * JSON limit for the AI routes. The global parser keeps 256 KB; these routes
 * take more because clients that are ALREADY installed (the Android build, a
 * cached PWA shell) keep posting the heavy context until they update, and a
 * fix that only works for refreshed browsers is not a fix.
 */
export const AI_JSON_BODY_LIMIT = process.env.AI_JSON_BODY_LIMIT || '2mb';

/** Paths whose POST bodies carry the client context object. */
export const AI_CONTEXT_BODY_PATHS = Object.freeze(['/api/v1/ai', '/api/system/state', '/api/intent']);

/*
 * THE ONE KEY THAT IS REMOVED — AND WHY ONLY ONE.
 *
 * `marketRows` is the feed installed clients are known to post, and no route on
 * this server reads a property of that name from a request. Nothing else is
 * touched, on purpose: other routes under the same prefixes take series as
 * their INPUT (`POST /api/v1/ai/neuromorphic/infer` reads `candles` and
 * `markets` from its body), and a slimmer that guessed by name — "anything
 * called history / candles / markets is a chart" — would hand those routes an
 * empty request and call it an optimisation.
 */
const CLIENT_ONLY_FEED = 'marketRows';
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function dropClientFeed(target) {
  if (!isObject(target) || !Array.isArray(target[CLIENT_ONLY_FEED])) return 0;
  delete target[CLIENT_ONLY_FEED];
  return 1;
}

/**
 * Remove the client-only market feed from a parsed AI request body, in place.
 *
 * The context object travels either under `context` (chat, execute, confirm,
 * suggestions) or as the body itself (`/context`, `/resume`, `/system/state`),
 * and the feed sits in its `portfolio`; all four positions are checked.
 *
 * The server never read it (its sanitizers take at most 80 balances, 80
 * holdings and a few portfolio scalars), so removing it changes no answer.
 * What it does change: a 300 KB feed no longer travels into logs, memory
 * writes, prompt builders, the per-session state the central OS keeps, or the
 * `context` echoed back in the reply.
 */
export function slimAiRequestBody(body) {
  if (!isObject(body)) return { dropped: 0 };
  let dropped = 0;
  for (const holder of [body, body.context]) {
    if (!isObject(holder)) continue;
    dropped += dropClientFeed(holder);
    dropped += dropClientFeed(holder.portfolio);
  }
  return { dropped };
}

/** Express middleware form of `slimAiRequestBody`. */
export function slimAiRequestMiddleware(req, _res, next) {
  try {
    if (req.method !== 'GET' && req.body) slimAiRequestBody(req.body);
  } catch { /* slimming is an optimisation; it must never fail a request */ }
  next();
}

/* -------------------------------------------------------------------------- */
/* 2. write budgets                                                            */
/* -------------------------------------------------------------------------- */

/** Fixed-window counter. `take` answers whether this hit is inside the budget. */
export function createWindowLimiter({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map();
  const limit = Math.max(1, Number(max) || 1);
  return {
    max: limit,
    windowMs,
    take(key, at = Date.now()) {
      const rec = hits.get(key);
      if (!rec || at > rec.reset) {
        hits.set(key, { count: 1, reset: at + windowMs });
        return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
      }
      rec.count += 1;
      if (rec.count > limit) {
        return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((rec.reset - at) / 1000)) };
      }
      return { allowed: true, remaining: limit - rec.count, retryAfterSec: 0 };
    },
    /** Give a hit back (used when a later check in the same request refuses). */
    refund(key) {
      const rec = hits.get(key);
      if (rec && rec.count > 0) rec.count -= 1;
    },
    sweep(at = Date.now()) {
      for (const [key, rec] of hits) if (at > rec.reset) hits.delete(key);
    },
    get size() { return hits.size; }
  };
}

/*
 * Three kinds of write live under `/api/v1/ai`, and they cost three different
 * things. Sharing one budget is how telemetry starved the conversation.
 *
 *   bookkeeping  a store write, no model call: outcome telemetry, feedback, an
 *                execution result. The UI sends one per message by design.
 *   turn         the human's own turn: the chat message and the confirm /
 *                execute / resume steps that complete it.
 *   model        everything else — explicit gateway, debate, research,
 *                orchestrator and benchmark calls that spend provider quota
 *                and that the chat UI does not make on its own.
 */
const BOOKKEEPING_PATHS = [
  /^\/learning\/record\/?$/,
  /^\/feedback\/?$/,
  /^\/execution-result\/?$/,
  /^\/automations\/[^/]+\/result\/?$/
];
const TURN_PATHS = [
  /^\/chat\/?$/,
  /^\/execute\/?$/,
  /^\/confirm\/?$/,
  /^\/resume\/?$/,
  /^\/context\/?$/,
  /^\/suggestions\/?$/
];

/** Classify a non-GET path relative to `/api/v1/ai`. */
export function aiWriteClass(path) {
  const p = String(path || '').split('?')[0];
  if (BOOKKEEPING_PATHS.some((re) => re.test(p))) return 'bookkeeping';
  if (TURN_PATHS.some((re) => re.test(p))) return 'turn';
  return 'model';
}

const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Who is asking. A Telegram identity wins; otherwise the device id the AI
 * client already sends; otherwise the address. The address is ALSO returned on
 * its own, because a per-device budget alone can be walked around by rotating
 * the header — the address ceiling below is what bounds that.
 */
export function aiCallerIdentity(req, { useDevice = true } = {}) {
  const ip = String(req?.ip || 'anon').slice(0, 64);
  if (req?.tgUser?.id) return { identity: `tg:${req.tgUser.id}`, ip };
  const device = useDevice
    ? String(req?.get?.('x-fbt-device') || req?.headers?.['x-fbt-device'] || '').trim()
    : '';
  if (DEVICE_RE.test(device)) return { identity: `dev:${ip}:${device}`, ip };
  return { identity: `ip:${ip}`, ip };
}

/* Leading number of an env value. Deployments and probes also write this
   variable as `max,windowMs`; the first field is the budget. */
const positive = (value, fallback) => {
  const n = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/**
 * Budgets per minute. `AI_RATE_LIMIT` keeps its old meaning for the model
 * class (it was written to protect provider quota from a looping script) and
 * no longer decides whether a person can send their sixth message.
 *
 * An operator who RAISES `AI_RATE_LIMIT` raises every class with it, exactly
 * as before: no class is ever tighter than the single budget it replaces, so
 * nothing that used to pass is refused now.
 */
export function aiWriteBudgets(env = process.env) {
  const model = positive(env.AI_RATE_LIMIT, 10);
  /* A person finishes well under ten server turns a minute (each one waits for
     an answer); 20 leaves room for a retry and the confirm/execute steps. */
  const turn = positive(env.AI_TURN_RATE_LIMIT, Math.max(20, model));
  const bookkeeping = positive(env.AI_BOOKKEEPING_RATE_LIMIT, Math.max(40, model));
  /* Many people legitimately share one address (carrier NAT, a VPN exit, an
     office). The address ceiling is a multiple of the personal budget so a
     shared address is not one person, yet a header-rotating loop is bounded. */
  const shared = positive(env.AI_SHARED_ADDRESS_FACTOR, 3);
  return { model, turn, bookkeeping, sharedFactor: shared };
}

const rejections = { turn: 0, model: 0, bookkeeping: 0, lastAt: null };

/** Per-instance counters, exposed by the chat health endpoint. */
export const aiLimiterStats = () => ({ ...rejections });

/**
 * The `/api/v1/ai` write limiter. GETs are never throttled: the client polls
 * status to decide whether to show the feature, and a 429 there reads as an
 * outage.
 */
export function createAiWriteLimiter({ env = process.env, windowMs = 60_000, onReject = null } = {}) {
  const budgets = aiWriteBudgets(env);
  const personal = {
    bookkeeping: createWindowLimiter({ windowMs, max: budgets.bookkeeping }),
    turn: createWindowLimiter({ windowMs, max: budgets.turn }),
    model: createWindowLimiter({ windowMs, max: budgets.model })
  };
  /* The model class keeps exactly its old shape — one budget per Telegram
     identity or address, no device split — because nothing a person does in
     the chat UI lands there, and it is the class a script would loop. */
  const shared = {
    bookkeeping: createWindowLimiter({ windowMs, max: budgets.bookkeeping * budgets.sharedFactor }),
    turn: createWindowLimiter({ windowMs, max: budgets.turn * budgets.sharedFactor }),
    model: null
  };

  const middleware = (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const cls = aiWriteClass(req.path);
    const { identity, ip } = aiCallerIdentity(req, { useDevice: cls !== 'model' });
    const now = Date.now();
    const own = personal[cls].take(identity, now);
    const address = own.allowed && shared[cls] ? shared[cls].take(ip, now) : { allowed: true, retryAfterSec: 0 };
    if (own.allowed && address.allowed) return next();
    /* A hit refused by the address ceiling must not also burn the person's own
       budget — they did nothing to earn it. */
    if (own.allowed && !address.allowed) personal[cls].refund(identity);
    const retryAfterSec = Math.max(own.retryAfterSec || 0, address.retryAfterSec || 0, 1);
    rejections[cls] += 1;
    rejections.lastAt = now;
    try { onReject?.({ cls, retryAfterSec, scope: own.allowed ? 'address' : 'caller' }); } catch { /* telemetry only */ }
    res.set('retry-after', String(retryAfterSec));
    return res.status(429).json({
      ok: false,
      error: 'AI_RATE_LIMITED',
      scope: cls,
      retryAfterSec,
      retryable: true
    });
  };

  middleware.sweep = (at = Date.now()) => {
    for (const group of [personal, shared]) for (const limiter of Object.values(group)) limiter?.sweep(at);
  };
  middleware.budgets = budgets;
  return middleware;
}

/* -------------------------------------------------------------------------- */
/* 3. JSON errors                                                              */
/* -------------------------------------------------------------------------- */

const STATUS_NAMES = Object.freeze({
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED'
});
const CODE_LIKE = /^[A-Z][A-Z0-9_]{2,47}$/;

/** Map an error raised under `/api` to the status and code a client can act on. */
export function describeApiError(err) {
  const type = String(err?.type || '');
  const status = Number(err?.status || err?.statusCode || 0);
  if (type === 'entity.too.large' || status === 413) {
    return { status: 413, error: 'PAYLOAD_TOO_LARGE', retryable: false };
  }
  if (type === 'entity.parse.failed' || (err instanceof SyntaxError && status === 400)) {
    return { status: 400, error: 'INVALID_JSON', retryable: false };
  }
  if (type === 'request.aborted' || err?.code === 'ECONNABORTED') {
    return { status: 400, error: 'REQUEST_ABORTED', retryable: true };
  }
  if (status >= 400 && status < 500) {
    /* The status the error names is kept; the name is the error's own code
       when it has a code-shaped one, else the plain name of the status. An
       error MESSAGE is never sent: it is written for a log, not for a caller. */
    const named = typeof err?.code === 'string' && CODE_LIKE.test(err.code) ? err.code : (STATUS_NAMES[status] || 'BAD_REQUEST');
    return { status, error: named, retryable: status === 408 || status === 429 };
  }
  /* The status stays what Express' default handler would have sent (500, or
     the 5xx the error names): only the BODY changes, from an HTML page to
     JSON. Callers that already branch on the status keep working. */
  return { status: status >= 500 && status < 600 ? status : 500, error: 'INTERNAL_ERROR', retryable: true };
}

/**
 * Final error middleware for the API. Before it existed, every failure below
 * was Express' default HTML page: unreadable by `fetch().json()`, so the chat
 * could only say «در دسترس نیست» for an oversized body, a malformed one and a
 * genuine crash alike. Non-API paths keep the default behaviour.
 */
export function createApiErrorHandler({ onError = null, log = console.error } = {}) {
  // eslint-disable-next-line no-unused-vars -- Express identifies error middleware by its four arguments.
  return function apiErrorHandler(err, req, res, next) {
    const path = String(req?.originalUrl || req?.url || '').split('?')[0];
    if (res.headersSent || !path.startsWith('/api')) return next(err);
    const described = describeApiError(err);
    try { onError?.({ path, status: described.status, error: described.error, err }); } catch { /* telemetry only */ }
    if (described.status >= 500) {
      try { log(`[api] ${req.method} ${path} failed:`, err?.stack || err?.message || err); } catch { /* logging must not throw */ }
    }
    /* Headers an error carries for its status (`Allow`, `Retry-After`) are
       part of the answer, as they are in Express' own handler. */
    try {
      if (err?.headers && typeof err.headers === 'object') {
        for (const [key, value] of Object.entries(err.headers)) {
          if (typeof value === 'string' || typeof value === 'number') res.set(key, String(value));
        }
      }
    } catch { /* a bad header must not replace the answer */ }
    res.status(described.status);
    return res.json({ ok: false, error: described.error, retryable: described.retryable, status: described.status });
  };
}

/* -------------------------------------------------------------------------- */
/* 4. evidence: how production turns actually end                              */
/* -------------------------------------------------------------------------- */

const TURN_LOG_KEY = 'ai:chat-turn-log:v1';
const TURN_LOG_MAX = 60;
const TURN_LOG_TTL_MS = 7 * 24 * 3600_000;
const INSTANCE_STARTED_AT = Date.now();
const local = [];
let persistQueue = Promise.resolve();
let lastSampledAt = 0;
let rowSeq = 0;

const short = (value, max = 140) => String(value ?? '').replace(/\s+/g, ' ').slice(0, max);

/** What a reply was, without what it said: no text, no wallet, no address. */
export function summarizeChatReply(payload, statusCode = 200) {
  const reply = payload?.reply && typeof payload.reply === 'object' ? payload.reply : null;
  const intel = reply?.intelligence && typeof reply.intelligence === 'object' ? reply.intelligence : null;
  return {
    ok: payload?.ok === true && statusCode < 400,
    status: statusCode,
    error: payload?.ok === true ? null : short(payload?.error || payload?.code || '', 48) || null,
    ui: short(reply?.ui?.type || '', 24) || null,
    intent: short(reply?.intent?.type || '', 32) || null,
    mode: short(intel?.mode?.id || '', 12) || null,
    models: Array.isArray(intel?.modelsConsulted) ? intel.modelsConsulted.length : 0,
    providers: Array.isArray(intel?.providersUsed) ? intel.providersUsed.slice(0, 6).map((p) => short(p, 24)) : [],
    degraded: intel ? intel.degraded === true : null,
    collabMs: Number.isFinite(Number(intel?.latencyMs)) ? Number(intel.latencyMs) : null,
    chars: typeof reply?.text === 'string' ? reply.text.length : null
  };
}

function keepAlive(promise) {
  /* The platform's own `waitUntil`, when this runs on Vercel: the write may
     finish after the response without holding the response for it. */
  try {
    const ctx = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
    if (typeof ctx?.waitUntil === 'function') {
      ctx.waitUntil(promise);
      return true;
    }
  } catch { /* not on that platform */ }
  return false;
}

function persist(entry) {
  persistQueue = persistQueue
    .catch(() => {})
    .then(async () => {
      const stored = await storeGetFresh(TURN_LOG_KEY, []);
      const rows = Array.isArray(stored) ? stored : [];
      if (rows.some((row) => row?.id === entry.id)) return;
      rows.push(entry);
      rows.sort((a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0));
      await storeSet(TURN_LOG_KEY, rows.slice(-TURN_LOG_MAX), TURN_LOG_TTL_MS);
    })
    .catch(() => { /* the log is evidence, never a dependency */ });
  return persistQueue;
}

/**
 * Record how one turn ended. Returns a promise that settles when the durable
 * write did (or after `waitMs`, whichever is first) — callers may await it
 * before answering so the record survives a frozen function.
 */
export function recordChatTurn(entry = {}, { waitMs = 200 } = {}) {
  const row = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    instance: INSTANCE_STARTED_AT,
    /* Orders rows written in the same millisecond by this instance. */
    seq: (rowSeq += 1),
    ...entry
  };
  local.push(row);
  if (local.length > TURN_LOG_MAX) local.splice(0, local.length - TURN_LOG_MAX);
  const write = persist(row);
  if (keepAlive(write)) return Promise.resolve(row);
  return Promise.race([
    write.then(() => row),
    new Promise((resolve) => { const t = setTimeout(() => resolve(row), Math.max(0, waitMs)); t.unref?.(); })
  ]);
}

/**
 * Record a transport-level refusal (429, 413) — sampled, so a looping script
 * cannot turn its own refusals into store writes.
 */
export function recordTransportEvent(entry = {}, { everyMs = 15_000 } = {}) {
  const now = Date.now();
  if (now - lastSampledAt < everyMs) return null;
  lastSampledAt = now;
  return recordChatTurn({ ok: false, ...entry }, { waitMs: 0 });
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);

/** Summary + recent rows for the public health endpoint. */
export async function chatTurnSnapshot({ limit = 30 } = {}) {
  let durable = [];
  let durableOk = true;
  try {
    const stored = await storeGetFresh(TURN_LOG_KEY, []);
    durable = Array.isArray(stored) ? stored : [];
  } catch {
    durableOk = false;
  }
  const byId = new Map();
  for (const row of [...durable, ...local]) if (row?.id) byId.set(row.id, row);
  const rows = [...byId.values()].sort((a, b) => ((Number(b?.at) || 0) - (Number(a?.at) || 0))
    || (a?.instance === b?.instance ? (Number(b?.seq) || 0) - (Number(a?.seq) || 0) : 0));
  const turns = rows.filter((row) => row.kind === 'turn');
  const okTurns = turns.filter((row) => row.ok === true);
  const durations = okTurns.map((row) => Number(row.ms)).filter(Number.isFinite).sort((a, b) => a - b);
  const failures = rows.filter((row) => row.ok !== true);
  return {
    durableOk,
    instanceStartedAt: INSTANCE_STARTED_AT,
    summary: {
      recorded: rows.length,
      turns: turns.length,
      ok: okTurns.length,
      failed: turns.length - okTurns.length,
      transportRefusals: rows.filter((row) => row.kind !== 'turn').length,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: durations.length ? durations[durations.length - 1] : null,
      lastOkAt: okTurns[0]?.at || null,
      lastFailureAt: failures[0]?.at || null,
      lastFailure: failures[0] ? { kind: failures[0].kind, status: failures[0].status ?? null, error: failures[0].error ?? null } : null
    },
    recent: rows.slice(0, Math.max(1, Math.min(60, Number(limit) || 30)))
  };
}

/** Test seam: forget this process's rows. */
export function __resetChatTurnLog() {
  local.length = 0;
  lastSampledAt = 0;
  rowSeq = 0;
  persistQueue = Promise.resolve();
}

/*
 * What a thrown turn may say about itself on a PUBLIC endpoint: a code-shaped
 * name as it is; any other message with URLs, long hex strings and token-like
 * runs removed; and the file and line that threw — never a path, never a value.
 * The full stack goes to the function log, where it belongs.
 */
function publicCause(err) {
  const bare = [err?.code, err?.message].find((v) => typeof v === 'string' && CODE_LIKE.test(v));
  if (bare) return bare;
  const text = short(err?.message || '', 200)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b0x[0-9a-fA-F]{12,}\b/g, '[hex]')
    .replace(/[A-Za-z0-9_\-+/=]{24,}/g, '[token]');
  return `${short(err?.name || 'Error', 24)}${text ? `: ${text}` : ''}`.slice(0, 100);
}

function publicFrame(err) {
  for (const line of String(err?.stack || '').split('\n').slice(1, 6)) {
    const m = line.match(/([A-Za-z0-9_.-]+\.[cm]?js):(\d+):\d+\)?\s*$/);
    if (m && !line.includes('node:') && !line.includes('node_modules')) return `${m[1]}:${m[2]}`;
  }
  return null;
}

/**
 * Wrap the chat handler so a turn ALWAYS ends in JSON and always leaves a row.
 *
 * The handler is ~1,100 lines of awaited work with no try/catch of its own.
 * Express 5 forwards a rejected handler to the error middleware, which is now
 * JSON too — but only this wrapper knows the turn's shape, so it answers with
 * a code the chat screen retries once at a lighter depth, and it writes the
 * row that says what threw.
 */
export function guardChatTurn(handler, { kind = 'turn', record = recordChatTurn, log = console.error } = {}) {
  return async function guardedChatTurn(req, res, next) {
    const startedAt = Date.now();
    const base = {
      kind,
      bytes: Number(req.headers?.['content-length']) || null,
      asked: short(req.body?.intelligence || '', 12) || null,
      wallet: req.body?.context?.wallet?.connected === true || Boolean(req.body?.context?.wallet?.address)
    };
    const sendJson = res.json.bind(res);
    let noted = false;
    res.json = (payload) => {
      if (noted) return sendJson(payload);
      noted = true;
      let pending = null;
      try {
        pending = record({ ...base, ms: Date.now() - startedAt, ...summarizeChatReply(payload, res.statusCode) });
      } catch { pending = null; }
      Promise.resolve(pending).catch(() => {}).then(() => {
        if (res.headersSent) return;
        try {
          sendJson(payload);
        } catch (err) {
          /* A reply that cannot be serialized used to reject the handler and
             reach Express. Sent from here it would be an unhandled rejection —
             so it is answered, like any other broken turn. */
          try { log('[ai-chat] reply could not be sent:', err?.stack || err?.message || err); } catch { /* logging must not throw */ }
          if (!res.headersSent) {
            res.status(503);
            sendJson({ ok: false, error: 'CHAT_TURN_FAILED', retryable: true, status: 503 });
          }
        }
      }).catch(() => { /* nothing left to answer with */ });
      return res;
    };
    try {
      await handler(req, res, next);
    } catch (err) {
      const code = publicCause(err);
      try { log('[ai-chat] turn failed:', err?.stack || err?.message || err); } catch { /* logging must not throw */ }
      if (res.headersSent || noted) return;
      noted = true;
      try {
        await record({
          ...base,
          ms: Date.now() - startedAt,
          ok: false,
          status: 503,
          error: 'CHAT_TURN_FAILED',
          cause: code,
          where: publicFrame(err)
        });
      } catch { /* evidence only */ }
      res.status(503);
      sendJson({ ok: false, error: 'CHAT_TURN_FAILED', retryable: true, status: 503 });
    }
  };
}
