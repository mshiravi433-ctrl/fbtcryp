/**
 * FBT INTENT OS — LONG-TERM MEMORY BRIDGE (Walrus Memory / MemWal)
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 * A server-side, opt-in bridge to a Walrus Memory relayer. It gives the Intent
 * OS assistant a *semantic long-term* memory — preferences, goals, decisions
 * and facts the user stated — stored encrypted on Walrus and recalled by
 * meaning instead of by recency. The existing per-account memory in
 * `ai:memory:v1:{owner}` (a 600-char summary + recent intents) stays exactly as
 * it is and remains the source of truth for *this turn*; this bridge is a
 * second, semantic tier that can be switched off without touching anything.
 *
 * WHAT THIS IS NOT
 *   · It never stores balances, orders, positions or any financial state. The
 *     relayer's own docs are explicit that semantic recall is not a reliable
 *     way to fetch one authoritative structured record, and a model inventing
 *     a balance is the worst possible output of this app. Money truth comes
 *     from chain reads, always.
 *   · It is not on the critical path. Every call has a deadline; a missing or
 *     slow relayer degrades to "no long-term memory this turn" and the chat
 *     answers exactly as it did before.
 *   · It never throws. Every entry point returns `{ ok:false, reason }`.
 *
 * SAFETY (the part that matters)
 *   · OFF BY DEFAULT. With no `MEMWAL_ACCOUNT_ID` + `MEMWAL_PRIVATE_KEY` every
 *     function here is a no-op and reports `NOT_CONFIGURED`.
 *   · The delegate key lives in server env only. It is never sent to the
 *     browser, never logged, and never echoed in a response.
 *   · Nothing leaves this process before passing `redactForThirdParty()`, which
 *     runs the project's own `sanitize()` (key/seed detection, from
 *     `src/lib/central/memory.js`) and then strips e-mails, phone numbers and
 *     long hex/base58 strings. The relayer operator and its embedding provider
 *     see text that has been through that filter, and a per-turn budget.
 *   · Rate limits are enforced locally as well as remotely: a sliding window
 *     for `remember` (points are expensive: 5 each) and for `recall`, plus a
 *     per-owner write cooldown and a content hash de-duplicator so the same
 *     sentence is not paid for twice.
 *
 * DELIVERY MODEL
 *   Writer: fire-and-forget queue (a chat turn must never wait for Walrus).
 *   Reader: awaited only inside the caller's existing 8s context deadline, so
 *   it costs zero extra wall-clock when the relayer is slow.
 *
 * See `docs/INTENT-AI-EFFICIENCY-UPGRADE-FA.md` for the deployment checklist
 * and the go/no-go gates before switching it on.
 */

import { createHash, createPrivateKey, createPublicKey, randomUUID, sign as cryptoSign } from 'node:crypto';
import { sanitize } from '../src/lib/central/memory.js';

export const WALRUS_MEMORY_SCHEMA = 'fbt.walrus-memory-bridge.v1';
export const NOT_CONFIGURED = 'NOT_CONFIGURED';

const DEFAULT_RELAYER = 'https://relayer.memory.walrus.xyz';
const PKCS8_ED25519_PREFIX = '302e020100300506032b657004220420';
const SPKI_ED25519_PREFIX = '302a300506032b6570032100';

/* -------------------------------------------------------------------------- */
/*  CONFIG — read lazily so a test can set env after import                    */
/* -------------------------------------------------------------------------- */

const str = (name, fallback = '') => {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
};
const pos = (name, fallback) => {
  const n = Number(str(name, ''));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** Like `pos` but accepts an explicit 0 — a cooldown of 0 is a real choice. */
const nonNeg = (name, fallback) => {
  const raw = str(name, '');
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function bridgeConfig() {
  const keyHex = str('MEMWAL_PRIVATE_KEY') || str('MEMWAL_KEY');
  const accountId = str('MEMWAL_ACCOUNT_ID');
  const seed = parseSeed(keyHex);
  const configured = Boolean(seed && accountId);
  const enabledRaw = str('MEMWAL_ENABLED', '').toLowerCase();
  const enabled = configured && !['0', 'false', 'no', 'off'].includes(enabledRaw);
  return {
    configured,
    enabled,
    accountId,
    seed,
    serverUrl: str('MEMWAL_SERVER_URL', DEFAULT_RELAYER).replace(/\/+$/, ''),
    namespacePrefix: str('MEMWAL_NAMESPACE_PREFIX', 'fbt').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'fbt',
    recallLimit: Math.min(10, Math.max(1, Math.round(pos('MEMWAL_RECALL_LIMIT', 5)))),
    recallDeadlineMs: Math.round(pos('MEMWAL_RECALL_DEADLINE_MS', 1200)),
    requestTimeoutMs: Math.round(pos('MEMWAL_TIMEOUT_MS', 8000)),
    maxText: Math.round(pos('MEMWAL_MAX_TEXT', 700)),
    persistTtlMs: Math.round(pos('MEMWAL_PERSIST_TTL_MS', 90 * 24 * 3600_000)),
    maxRememberPerHour: Math.round(pos('MEMWAL_MAX_REMEMBER_PER_HOUR', 40)),
    maxRecallPerMinute: Math.round(pos('MEMWAL_MAX_RECALL_PER_MINUTE', 20)),
    writeCooldownMs: Math.round(nonNeg('MEMWAL_WRITE_COOLDOWN_MS', 15_000)),
    queueMax: Math.round(pos('MEMWAL_QUEUE_MAX', 25))
  };
}

/* -------------------------------------------------------------------------- */
/*  KEY HANDLING (node:crypto only — no new dependency)                        */
/* -------------------------------------------------------------------------- */

/** A MemWal delegate key is a 32-byte Ed25519 seed in hex (64 chars); a full
    64-byte key (128 hex) is accepted by taking its seed half. */
function parseSeed(hex) {
  const clean = String(hex || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(clean) && !/^[0-9a-fA-F]{128}$/.test(clean)) return null;
  try { return Buffer.from(clean.slice(0, 64), 'hex'); } catch { return null; }
}

let keyCache = null;
function keyPair(seed) {
  if (keyCache && keyCache.seed.equals(seed)) return keyCache;
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from(PKCS8_ED25519_PREFIX, 'hex'), seed]),
    format: 'der',
    type: 'pkcs8'
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  keyCache = {
    seed,
    privateKey,
    publicKeyHex: Buffer.from(spki).subarray(-32).toString('hex')
  };
  return keyCache;
}

const sha256Hex = (v) => createHash('sha256').update(v).digest('hex');

/**
 * The exact string the relayer signs (relayer/api-reference):
 *   {timestamp}.{method}.{path_and_query}.{body_sha256}.{nonce}.{account_id}
 * For GET, body_sha256 is the hash of the EMPTY byte string.
 */
export function canonicalMessage({ timestamp, method, pathAndQuery, body, nonce, accountId }) {
  const bodyHash = sha256Hex(method === 'GET' ? '' : String(body ?? ''));
  return `${timestamp}.${method}.${pathAndQuery}.${bodyHash}.${nonce}.${accountId}`;
}

export function signedHeaders({ method, pathAndQuery, body }) {
  const cfg = bridgeConfig();
  if (!cfg.configured) return null;
  const { privateKey, publicKeyHex } = keyPair(cfg.seed);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const message = canonicalMessage({ timestamp, method, pathAndQuery, body, nonce, accountId: cfg.accountId });
  const signature = cryptoSign(null, Buffer.from(message, 'utf8'), privateKey).toString('hex');
  return {
    'content-type': 'application/json',
    'x-public-key': publicKeyHex,
    'x-signature': signature,
    'x-timestamp': String(timestamp),
    'x-nonce': nonce,
    'x-account-id': cfg.accountId
  };
}

/* -------------------------------------------------------------------------- */
/*  REDACTION — nothing leaves the process unfiltered                          */
/* -------------------------------------------------------------------------- */

const EMAIL = /\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/g;
/* Phone shapes, not bare digits: a goal of «۱۰۰۰۰۰۰ دلار» is content, not PII. */
const PHONE_IR = /(?:\+98|0098|0)9\d{9}\b/g;
const PHONE_INTL = /\+\d{1,3}[\s-]?\d{6,14}\b/g;
const LONG_HEX = /\b(?:0x)?[0-9a-fA-F]{40,}\b/g;
const LONG_BASE58 = /\b[1-9A-HJ-NP-Za-km-z]{40,}\b/g;
/* Users type Persian and Arabic-Indic digits; a phone number must be caught in
   either form, so normalize before matching (and keep the normalized text: it
   reads the same and embeds more consistently). */
const NON_ASCII_DIGITS = /[\u06F0-\u06F9\u0660-\u0669]/g;
const toAsciiDigits = (s) => s.replace(NON_ASCII_DIGITS, (d) => {
  const c = d.codePointAt(0);
  return String(c >= 0x06F0 ? c - 0x06F0 : c - 0x0660);
});

/** Redact before anything reaches a third party (relayer + its embeddings). */
export function redactForThirdParty(value) {
  const clean = sanitize(typeof value === 'string' ? value : String(value ?? ''));
  if (typeof clean !== 'string') return '';
  if (clean === '[REDACTED]') return '';
  return toAsciiDigits(clean)
    .replace(EMAIL, '[ایمیل]')
    .replace(LONG_HEX, '[شناسه]')
    .replace(LONG_BASE58, '[شناسه]')
    .replace(PHONE_IR, '[تلفن]')
    .replace(PHONE_INTL, '[تلفن]')
    .replace(/\s+/g, ' ')
    .trim();
}

/* -------------------------------------------------------------------------- */
/*  WHAT DESERVES LONG-TERM STORAGE (pure, conservative)                       */
/* -------------------------------------------------------------------------- */

/* An explicit instruction to remember — always stored. */
const EXPLICIT_REMEMBER = /(یادت باشه|یادت بماند|یادت بمونه|به یاد داشته باش|حافظهات داشته باش|ذخیره کن که|ثبت کن که|remember (this|that|me)|keep (this )?in mind|don'?t forget|never forget|note that)/i;
/* A stated, durable fact about the user — stored, but only with a durable verb. */
const DURABLE_STATEMENT = /(من (همیشه|معمولاً|معمولا|ترجیح می‌دهم|ترجیح میدم|دوست دارم|قصد دارم|تصمیم گرفتم|هدفم|عادت دارم)|ترجیح می‌دهم|ترجیح میدم|هدف من|هدفم این است|عادت دارم|تصمیم گرفتم که|i (always|usually|prefer|want to|plan to|intend to|decided)|my goal is|i'?m planning to|i decided to|i prefer)/i;

/**
 * Turn a chat message into a long-term memory line — or `null` when the turn
 * carries nothing durable. Conservative on purpose: a memory tier that hoards
 * every "hi" costs points, adds noise to recall and burns the account quota.
 *
 * @returns {{text:string, kind:'note'|'goal'|'preference'}|null}
 */
export function durableMemoryLine({ message, goalDetected = false, intentType = null } = {}) {
  const raw = typeof message === 'string' ? message.trim() : '';
  if (raw.length < 12 || raw.length > 1200) return null;
  /* A question is not a memory: "معنی ترجیح چیه؟" must not become a preference. */
  const isQuestion = /[?؟]\s*$/.test(raw) && !EXPLICIT_REMEMBER.test(raw);
  if (EXPLICIT_REMEMBER.test(raw)) {
    return { text: redactForThirdParty(raw), kind: 'note' };
  }
  if (isQuestion) return null;
  const goalish = goalDetected === true || String(intentType || '').toUpperCase() === 'GOAL';
  if (goalish && raw.length <= 600) return { text: redactForThirdParty(raw), kind: 'goal' };
  if (DURABLE_STATEMENT.test(raw) && raw.length <= 600) {
    return { text: redactForThirdParty(raw), kind: 'preference' };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  STATE — rate windows, de-dupe, queue, counters                             */
/* -------------------------------------------------------------------------- */

const state = {
  recallWindow: [],
  rememberWindow: [],
  lastWriteAt: new Map(), // owner -> ts
  seen: new Map(),        // owner -> Map<hash, ts>
  queue: [],
  draining: false,
  counters: {
    recall: { ok: 0, failed: 0, timeout: 0, rateLimited: 0, skipped: 0 },
    remember: { queued: 0, sent: 0, failed: 0, dropped: 0, rateLimited: 0, duplicate: 0, cooldown: 0, redacted: 0 }
  },
  lastError: null,
  lastErrorAt: null,
  lastRecallAt: null,
  lastRememberAt: null
};

const note = (kind, key) => { state.counters[kind][key] += 1; };
function fail(kind, err) {
  note(kind, 'failed');
  state.lastError = String(err?.message || err || 'ERROR').slice(0, 200);
  state.lastErrorAt = Date.now();
}

function withinWindow(list, windowMs, now) {
  while (list.length && now - list[0] > windowMs) list.shift();
  return list.length;
}

/* -------------------------------------------------------------------------- */
/*  TRANSPORT                                                                  */
/* -------------------------------------------------------------------------- */

async function relayerFetch(pathAndQuery, { method = 'POST', payload = null, timeoutMs } = {}) {
  const cfg = bridgeConfig();
  if (!cfg.enabled) return { ok: false, reason: cfg.configured ? 'DISABLED' : NOT_CONFIGURED };
  const body = payload === null ? null : JSON.stringify(payload);
  const headers = signedHeaders({ method, pathAndQuery, body });
  if (!headers) return { ok: false, reason: NOT_CONFIGURED };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.max(500, timeoutMs || cfg.requestTimeoutMs));
  try {
    const res = await fetch(`${cfg.serverUrl}${pathAndQuery}`, {
      method,
      headers,
      ...(body === null ? {} : { body }),
      signal: controller.signal
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      return {
        ok: false,
        reason: res.status === 503 ? 'WRITES_PAUSED' : (res.status === 429 ? 'RATE_LIMITED' : `HTTP_${res.status}`),
        status: res.status,
        detail: String(json?.error || json?.message || '').slice(0, 160) || null
      };
    }
    return { ok: true, json };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, reason: aborted ? 'TIMEOUT' : 'NETWORK', detail: String(err?.message || err).slice(0, 160) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Raw, awaited relayer call — for DIAGNOSTICS ONLY (`npm run memwal:preflight`).
 *
 * The chat path never uses this: it goes through `bridgeRecall` (budgeted) and
 * `bridgeRemember` (queued). A probe, on the other hand, needs the job id and
 * the status of a write, which only exists on the synchronous path. Both routes
 * share one signing implementation, so a green preflight really does exercise
 * the same headers production sends.
 */
export async function relayerRequest(pathAndQuery, {
  method = 'POST',
  payload = null,
  timeoutMs = null,
  public: asPublic = false
} = {}) {
  const cfg = bridgeConfig();
  const body = payload === null ? null : JSON.stringify(payload);
  /* `public:true` is for the two unauthenticated routes (`/health`, `/config`)
     so an operator can prove the service is reachable BEFORE creating an
     account. Everything else needs credentials and the kill switch open. */
  if (asPublic) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), Math.max(500, timeoutMs || cfg.requestTimeoutMs));
    try {
      const res = await fetch(`${cfg.serverUrl}${pathAndQuery}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === null ? {} : { body }),
        signal: controller.signal
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!res.ok) return { ok: false, reason: `HTTP_${res.status}`, status: res.status, detail: String(json?.error || '').slice(0, 160) || null };
      return { ok: true, json };
    } catch (err) {
      return { ok: false, reason: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', detail: String(err?.message || err).slice(0, 160) };
    } finally {
      clearTimeout(t);
    }
  }
  if (!cfg.configured) return { ok: false, reason: NOT_CONFIGURED };
  if (!cfg.enabled) return { ok: false, reason: 'DISABLED_BY_ENV', detail: 'MEMWAL_ENABLED is set to a false value' };
  return relayerFetch(pathAndQuery, { method, payload, timeoutMs: timeoutMs || cfg.requestTimeoutMs });
}

/* -------------------------------------------------------------------------- */
/*  PUBLIC — status                                                            */
/* -------------------------------------------------------------------------- */

export function bridgeStatus() {
  const cfg = bridgeConfig();
  const now = Date.now();
  return {
    schema: WALRUS_MEMORY_SCHEMA,
    configured: cfg.configured,
    enabled: cfg.enabled,
    mode: !cfg.configured ? 'off' : (cfg.enabled ? 'on' : 'disabled'),
    relayer: cfg.enabled ? cfg.serverUrl : null,
    account: cfg.accountId ? `${cfg.accountId.slice(0, 6)}…${cfg.accountId.slice(-4)}` : null,
    namespacePrefix: cfg.namespacePrefix,
    limits: {
      recallLimit: cfg.recallLimit,
      rememberPerHour: cfg.maxRememberPerHour,
      recallPerMinute: cfg.maxRecallPerMinute,
      queueMax: cfg.queueMax
    },
    queued: state.queue.length,
    counters: state.counters,
    lastRecallAt: state.lastRecallAt,
    lastRememberAt: state.lastRememberAt,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt,
    secrets: false,
    at: now
  };
}

/** Deterministic, non-reversible namespace per account: `fbt-<hash16>`. */
export function namespaceFor(owner) {
  const cfg = bridgeConfig();
  const id = typeof owner === 'string' && owner.trim() ? owner.trim() : 'anon';
  return `${cfg.namespacePrefix}-${sha256Hex(id).slice(0, 16)}`;
}

/* -------------------------------------------------------------------------- */
/*  PUBLIC — recall (read path)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Semantic recall. Never throws; a caller that gets `ok:false` answers exactly
 * as it would have without this module.
 */
export async function bridgeRecall({ owner, query, limit = null, deadlineMs = null } = {}) {
  const cfg = bridgeConfig();
  if (!cfg.configured) return { ok: false, reason: NOT_CONFIGURED, items: [] };
  if (!cfg.enabled) return { ok: false, reason: 'DISABLED', items: [] };
  const q = redactForThirdParty(String(query || '').trim()).slice(0, 300);
  if (!q) return { ok: false, reason: 'EMPTY_QUERY', items: [] };

  const now = Date.now();
  if (withinWindow(state.recallWindow, 60_000, now) >= cfg.maxRecallPerMinute) {
    note('recall', 'rateLimited');
    return { ok: false, reason: 'RATE_LIMITED', items: [] };
  }
  state.recallWindow.push(now);

  const started = Date.now();
  const budget = Math.min(Math.max(500, Math.round(deadlineMs || cfg.recallDeadlineMs)), cfg.requestTimeoutMs);
  const res = await relayerFetch('/api/recall', {
    method: 'POST',
    timeoutMs: budget + 400,
    payload: {
      query: q,
      limit: Math.min(10, Math.max(1, Math.round(limit || cfg.recallLimit))),
      namespace: namespaceFor(owner),
      scoring_weights: { semantic: 1, recency: 0.3, recency_half_life_days: 45, importance: 0.2 },
      deadline_ms: budget
    }
  });
  state.lastRecallAt = Date.now();
  if (!res.ok) {
    if (res.reason === 'TIMEOUT') note('recall', 'timeout');
    fail('recall', res.reason);
    return { ok: false, reason: res.reason, detail: res.detail || null, items: [], ms: Date.now() - started };
  }
  const rows = Array.isArray(res.json?.results) ? res.json.results : [];
  const items = rows
    .map((r) => ({
      text: redactForThirdParty(String(r?.text || '')).slice(0, 280),
      blobId: r?.blob_id ? String(r.blob_id).slice(0, 120) : null,
      distance: Number.isFinite(Number(r?.distance)) ? Number(r.distance) : null,
      score: Number.isFinite(Number(r?.score)) ? Number(r.score) : null
    }))
    .filter((r) => r.text.length >= 4)
    .slice(0, 8);
  note('recall', 'ok');
  return { ok: true, items, total: Number(res.json?.total) || items.length, ms: Date.now() - started };
}

/* -------------------------------------------------------------------------- */
/*  PUBLIC — remember (write path, queued)                                     */
/* -------------------------------------------------------------------------- */

/** Is this exact sentence already in flight or recently written for this owner? */
function isDuplicate(owner, text) {
  const hash = sha256Hex(text);
  const seen = state.seen.get(owner) || new Map();
  const now = Date.now();
  for (const [h, at] of seen) if (now - at > 6 * 3600_000) seen.delete(h);
  if (seen.has(hash)) return true;
  seen.set(hash, now);
  while (seen.size > 200) seen.delete(seen.keys().next().value);
  state.seen.set(owner, seen);
  return false;
}

async function sendRemember(job) {
  const cfg = bridgeConfig();
  const res = await relayerFetch('/api/remember', {
    method: 'POST',
    timeoutMs: cfg.requestTimeoutMs,
    payload: { text: job.text, namespace: job.namespace }
  });
  state.lastRememberAt = Date.now();
  if (res.ok) note('remember', 'sent');
  else if (res.reason === 'RATE_LIMITED') note('remember', 'rateLimited');
  else { note('remember', 'dropped'); fail('remember', res.reason); }
  return res;
}

/**
 * Queue one memory write. Returns immediately — a chat turn never waits for
 * Walrus. Honest outcomes: `{queued:true}` means it will be attempted;
 * every other field explains exactly why nothing was stored.
 */
export function bridgeRemember({ owner, text, kind = 'note' } = {}) {
  const cfg = bridgeConfig();
  if (!cfg.configured) return { ok: false, reason: NOT_CONFIGURED, queued: false };
  if (!cfg.enabled) return { ok: false, reason: 'DISABLED', queued: false };
  const copy = redactForThirdParty(String(text || '').trim()).slice(0, cfg.maxText);
  if (copy.length < 8) { note('remember', 'redacted'); return { ok: false, reason: 'NOTHING_AFTER_REDACTION', queued: false }; }

  const now = Date.now();
  if (isDuplicate(owner, copy)) { note('remember', 'duplicate'); return { ok: true, queued: false, reason: 'DUPLICATE' }; }
  if (now - (state.lastWriteAt.get(owner) || 0) < cfg.writeCooldownMs) {
    note('remember', 'cooldown');
    return { ok: true, queued: false, reason: 'COOLDOWN' };
  }
  if (withinWindow(state.rememberWindow, 3600_000, now) >= cfg.maxRememberPerHour) {
    note('remember', 'rateLimited');
    return { ok: false, reason: 'RATE_LIMITED', queued: false };
  }
  if (state.queue.length >= cfg.queueMax) {
    note('remember', 'dropped');
    return { ok: false, reason: 'QUEUE_FULL', queued: false };
  }
  state.rememberWindow.push(now);
  state.lastWriteAt.set(owner, now);
  state.queue.push({ owner, text: copy, kind, namespace: namespaceFor(owner), at: now });
  note('remember', 'queued');
  drainQueue();
  return { ok: true, queued: true, kind };
}

async function drainQueue() {
  if (state.draining) return;
  state.draining = true;
  try {
    while (state.queue.length) {
      const job = state.queue.shift();
      await sendRemember(job).catch((err) => fail('remember', err));
    }
  } finally {
    state.draining = false;
  }
}

/** Wait for the queue to empty — for tests and graceful shutdown only. */
export async function __flushForTests(timeoutMs = 3000) {
  const until = Date.now() + timeoutMs;
  while ((state.queue.length || state.draining) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return state.queue.length === 0;
}

/* -------------------------------------------------------------------------- */
/*  TEST HOOKS — not used by production code paths                             */
/* -------------------------------------------------------------------------- */

export const __internals = {
  parseSeed,
  keyPair,
  sha256Hex,
  reset() {
    state.recallWindow.length = 0;
    state.rememberWindow.length = 0;
    state.lastWriteAt.clear();
    state.seen.clear();
    state.queue.length = 0;
    state.draining = false;
    state.counters = {
      recall: { ok: 0, failed: 0, timeout: 0, rateLimited: 0, skipped: 0 },
      remember: { queued: 0, sent: 0, failed: 0, dropped: 0, rateLimited: 0, duplicate: 0, cooldown: 0, redacted: 0 }
    };
    state.lastError = null;
    state.lastErrorAt = null;
    state.lastRecallAt = null;
    state.lastRememberAt = null;
    keyCache = null;
  },
  state
};
