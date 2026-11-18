/**
 * OPIK TRACES WITHOUT THE SDK
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * Every question this project asked about its own AI in the last weeks had the
 * same shape: «which provider actually answered, how long did it take, and why
 * did the other four fail?». The answers existed — but only as the LAST value of
 * a counter (`/gateway/health`), so a turn that spent six provider calls was
 * observable only as «2 healthy, 1 failing», and by the time the operator looked,
 * the failing one had already healed or been parked. That is a dashboard, not a
 * record.
 *
 * Opik gives the record. The official `opik` npm package would pull in twenty
 * runtime dependencies (an AI SDK, nunjucks, mustache, node-fetch, chalk, zod as
 * a peer) into a serverless bundle that is already large — for two POST
 * requests. So this module speaks the same wire protocol directly:
 *
 *   POST {base}/v1/private/traces/batch   { traces: [ … ] }
 *   headers: authorization: <api key> · Comet-Workspace: <workspace>
 *
 * (The endpoint, the header names and the body shape were read off the packaged
 * SDK itself — `sdks/typescript` — not guessed.)
 *
 * THREE RULES THIS CODE WILL NOT BREAK
 *
 *   1. **It never breaks a turn.** Export is fire-and-forget, wrapped, with its
 *      own abort timer. A trace that cannot be sent is a trace that is lost; a
 *      turn that cannot be answered is an outage. The functions here therefore
 *      never throw and never reject to the caller.
 *   2. **It never adds latency to an answer.** `logProviderCallTrace()` returns
 *      immediately; the HTTP call is not awaited by the request path. On a
 *      serverless instance that is frozen after the response, a trace may be
 *      dropped — that is the correct trade, and it is stated here so nobody
 *      "fixes" it by awaiting.
 *   3. **It does not ship the user's words by default.** Prompts and answers are
 *      omitted unless `OPIK_CAPTURE_PROMPTS=1`. Questions to this product are
 *      financial positions and intentions; sending them to a third party has to
 *      be a decision the operator makes, not a side effect of turning tracing
 *      on. Metadata (provider, model, latency, error class, tokens) is enough
 *      for the question this file exists to answer.
 *
 * WHAT IS WRITTEN WHERE
 *
 *   · one TRACE per provider call, named `ai.provider.<provider>`;
 *   · `thread_id` = the turn id, so the (up to six) calls of one question group
 *     together as one thread in Opik instead of six unrelated rows.
 */

/* The v1 API lives under the workspace host, not a separate collector. */
const DEFAULT_BASE_URL = 'https://www.comet.com/opik/api';
const DEFAULT_PROJECT = 'Fbtswap';
const DEFAULT_TIMEOUT_MS = 2500;
/* Under load a serverless instance may answer many turns at once; this cap keeps
   a slow collector from growing an unbounded pile of open sockets. Beyond it a
   trace is SKIPPED and counted, never queued. */
const MAX_IN_FLIGHT = 8;

const ON = /^(1|true|on|yes)$/i;
const OFF = /^(0|false|off|no)$/i;

/**
 * A dashboard paste carries quotes, newlines, a `Bearer ` prefix, zero-widths.
 *
 * The order matters and it is the reason this is a function: `"Bearer abc"` has
 * the quote OUTSIDE the prefix, so stripping the prefix first leaves
 * `"abc` — a key that is valid, stored, and rejected by the collector with a 401
 * nobody can explain. Quotes are peeled before AND after the prefix.
 */
function clean(value) {
  return String(value ?? '')
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .replace(/[\r\n\t]+/g, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^bearer\s+/i, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

function positiveInt(raw, fallback) {
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * What the deployment is configured to do. Pure: reads the env it is given, so
 * a probe can exercise every branch without touching the process.
 */
export function opikConfig(env = process.env) {
  const apiKey = clean(env?.OPIK_API_KEY || env?.COMET_API_KEY);
  const workspace = clean(env?.OPIK_WORKSPACE);
  const projectName = clean(env?.OPIK_PROJECT_NAME) || DEFAULT_PROJECT;
  const baseUrl = (clean(env?.OPIK_URL_OVERRIDE || env?.OPIK_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const explicitOff = OFF.test(String(env?.OPIK_ENABLED ?? '').trim());
  /* `Number('')` is 0, not NaN — an unset sample rate would silently become
     "send nothing", which is the worst possible default for a tracer. */
  const rateText = String(env?.OPIK_SAMPLE_RATE ?? '').trim();
  const rateRaw = rateText === '' ? Number.NaN : Number(rateText);
  const sampleRate = Number.isFinite(rateRaw) ? Math.min(1, Math.max(0, rateRaw)) : 1;
  return {
    enabled: Boolean(apiKey) && !explicitOff,
    /* Kept out of every status payload and every error string. */
    hasKey: Boolean(apiKey),
    apiKey,
    workspace: workspace || null,
    projectName,
    baseUrl,
    capturePrompts: ON.test(String(env?.OPIK_CAPTURE_PROMPTS ?? '').trim()),
    sampleRate,
    timeoutMs: positiveInt(env?.OPIK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    envVar: 'OPIK_API_KEY',
    projectEnvVar: 'OPIK_PROJECT_NAME',
    workspaceEnvVar: 'OPIK_WORKSPACE'
  };
}

/* One counter block, so the operator can see whether traces are actually
   leaving the building instead of assuming they are. */
const stats = {
  considered: 0,
  sampledOut: 0,
  skippedBusy: 0,
  sent: 0,
  exported: 0,
  failed: 0,
  lastStatus: null,
  lastError: null,
  lastAt: null,
  lastDurationMs: null
};
let inFlight = 0;

/** The counters, without the key. Safe to publish on a GET route. */
export function opikStatus(env = process.env) {
  const cfg = opikConfig(env);
  return {
    schema: 'fbt.ai-opik-traces.v1',
    enabled: cfg.enabled,
    reason: cfg.enabled
      ? null
      : cfg.hasKey
        ? 'OPIK_ENABLED is off'
        : `no ${cfg.envVar} in the environment — tracing is a no-op, not an error`,
    project: cfg.projectName,
    workspace: cfg.workspace,
    capturePrompts: cfg.capturePrompts,
    sampleRate: cfg.sampleRate,
    baseUrl: cfg.baseUrl,
    timeoutMs: cfg.timeoutMs,
    counters: { ...stats },
    inFlight
  };
}

/** Test seam: reset the counters so a probe can assert exact numbers. */
export function resetOpikStats() {
  stats.considered = 0;
  stats.sampledOut = 0;
  stats.skippedBusy = 0;
  stats.sent = 0;
  stats.exported = 0;
  stats.failed = 0;
  stats.lastStatus = null;
  stats.lastError = null;
  stats.lastAt = null;
  stats.lastDurationMs = null;
  inFlight = 0;
}

const iso = (at) => new Date(Number(at) || Date.now()).toISOString();

/**
 * One trace body, from the facts the gateway already holds at the moment a
 * provider answered or refused.
 *
 * Pure and exported: the shape is the contract with Opik and it must be
 * assertable without a network.
 */
export function buildProviderTrace(call = {}, cfg = opikConfig()) {
  const provider = clean(call.provider) || 'unknown';
  const model = clean(call.model) || null;
  const ok = call.ok === true;
  const startedAt = Number(call.startedAt) || Date.now();
  const durationMs = Math.max(0, Number(call.durationMs) || 0);
  const metadata = {
    schema: 'fbt.ai-opik-trace.v1',
    provider,
    model,
    ok,
    engine: call.engine || (ok ? 'external-model' : null),
    reasonCode: call.reasonCode || null,
    status: Number(call.status) || null,
    attemptsOnProvider: Number(call.attemptsOnProvider) || null,
    intelligenceMode: call.mode || null,
    locale: call.locale || null,
    tokensIn: Number(call.tokensIn) || 0,
    tokensOut: Number(call.tokensOut) || 0,
    /* Sizes, not text: enough to tell «a 40-character question» from «a 900
       character one» without shipping the question. */
    questionChars: Number(call.questionChars) || 0,
    answerChars: Number(call.answerChars) || 0,
    quotaPressure: typeof call.quotaPressure === 'number' ? call.quotaPressure : null,
    turnCalls: Number(call.turnCalls) || null,
    deploy: clean(call.deploy) || null
  };
  const trace = {
    id: call.traceId && clean(call.traceId) ? clean(call.traceId) : globalThis.crypto.randomUUID(),
    project_name: cfg.projectName,
    name: `ai.provider.${provider}`,
    start_time: iso(startedAt),
    end_time: iso(startedAt + durationMs),
    /* The turn id: six provider calls of one answer become one thread. */
    thread_id: clean(call.turnId) || undefined,
    tags: ['fbt', 'ai-gateway', provider, ok ? 'ok' : 'failed'].filter(Boolean),
    metadata
  };
  if (!ok) {
    trace.error_info = {
      exception_type: clean(call.reasonCode) || 'UNKNOWN',
      message: String(call.error || '').slice(0, 700) || 'provider call failed',
      /* The schema REQUIRES this field (a string), even when we have no stack. */
      traceback: ''
    };
  }
  if (cfg.capturePrompts) {
    if (call.question) trace.input = { question: String(call.question).slice(0, 4000) };
    if (ok && call.answer) trace.output = { answer: String(call.answer).slice(0, 4000) };
  }
  return trace;
}

/**
 * Send one trace. Best-effort by construction: every failure path is a counter
 * and a return, never a throw.
 */
async function postTrace(trace, cfg) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  /* Node keeps the process alive for a pending timer; a serverless instance that
     answered already must not be held open by a trace. */
  if (typeof timer.unref === 'function') timer.unref();
  const startedAt = Date.now();
  try {
    const headers = {
      'Content-Type': 'application/json',
      authorization: cfg.apiKey
    };
    if (cfg.workspace) headers['Comet-Workspace'] = cfg.workspace;
    const res = await fetch(`${cfg.baseUrl}/v1/private/traces/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ traces: [trace] }),
      signal: controller.signal
    });
    stats.sent += 1;
    stats.lastStatus = res.status;
    stats.lastAt = Date.now();
    stats.lastDurationMs = Date.now() - startedAt;
    if (!res.ok) {
      /* The body carries the reason (a 401 says the key, a 400 says the field).
         Kept short and never containing the key — Opik echoes no credentials. */
      let detail = '';
      try {
        detail = String(await res.text()).slice(0, 240);
      } catch {
        detail = '';
      }
      stats.failed += 1;
      stats.lastError = `HTTP ${res.status}${detail ? `: ${detail}` : ''}`;
      return { ok: false, status: res.status };
    }
    stats.exported += 1;
    stats.lastError = null;
    return { ok: true, status: res.status };
  } catch (err) {
    stats.failed += 1;
    stats.lastError = String(err?.message || err).slice(0, 240);
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
    inFlight = Math.max(0, inFlight - 1);
  }
}

/**
 * The one function the gateway calls.
 *
 * Never awaited by the request path, never throws. Returns the promise so a test
 * can await the export, which is the only caller that should.
 */
export function logProviderCallTrace(call = {}, env = process.env) {
  const cfg = opikConfig(env);
  stats.considered += 1;
  if (!cfg.enabled) return Promise.resolve({ ok: false, skipped: 'disabled' });
  if (cfg.sampleRate <= 0 || Math.random() > cfg.sampleRate) {
    stats.sampledOut += 1;
    return Promise.resolve({ ok: false, skipped: 'sampled-out' });
  }
  if (inFlight >= MAX_IN_FLIGHT) {
    stats.skippedBusy += 1;
    return Promise.resolve({ ok: false, skipped: 'busy' });
  }
  let trace;
  try {
    trace = buildProviderTrace(call, cfg);
  } catch (err) {
    stats.failed += 1;
    stats.lastError = `build: ${String(err?.message || err).slice(0, 200)}`;
    return Promise.resolve({ ok: false, skipped: 'build-failed' });
  }
  inFlight += 1;
  return postTrace(trace, cfg);
}
