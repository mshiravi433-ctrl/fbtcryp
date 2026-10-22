/**
 * FBT EXTERNAL AGENT HUB — protocol normalization (§13, §17).
 * ---------------------------------------------------------------------------
 * The Hub speaks ONE state machine to the rest of FBT, whatever a provider
 * calls its own states. Everything a provider says is untrusted: text is
 * capped and stripped of control characters, structured values are validated
 * against a shape before they are stored, and every error is translated into
 * a code FBT owns — a provider's raw error string never becomes a user-facing
 * message, because a provider can put anything in it (a fake API key, a
 * phishing URL, a prompt-injection payload).
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *   · It never invents a result. A task with no artifacts has `result: null`.
 *   · It never upgrades a provider state. `unknown` maps to `reconciling`,
 *     not to `completed` — an unknown answer is an unknown answer.
 *   · It never marks a task paid or authorized; those live in the broker.
 */

export const AGENT_HUB_SCHEMA = 'fbt.agent-hub.v1';
export const AGENT_HUB_TASK_SCHEMA = 'fbt.agent-hub.task.v1';
export const AGENT_HUB_EVENT_SCHEMA = 'fbt.agent-hub.event.v1';
export const AGENT_HUB_CONNECTION_SCHEMA = 'fbt.agent-hub.connection.v1';

/** The lifecycle the UI renders (§13). Not every task visits every state. */
export const TASK_STATES = Object.freeze([
  'draft', 'consent_required', 'auth_required', 'payment_required', 'queued',
  'running', 'input_required', 'reconciling', 'completed', 'failed',
  'canceled', 'expired'
]);

/** States after which nothing more happens remotely. */
export const TERMINAL_STATES = Object.freeze(['completed', 'failed', 'canceled', 'expired']);
/** States that are still moving and therefore worth polling. */
export const ACTIVE_STATES = Object.freeze(['queued', 'running', 'input_required', 'reconciling']);

export const isTerminal = (state) => TERMINAL_STATES.includes(String(state));
export const isActive = (state) => ACTIVE_STATES.includes(String(state));

/**
 * A2A TaskState → FBT state.
 *
 * The A2A vocabulary is the reference here because it is the protocol this
 * repository's first adapter implements, but the mapping is the Hub's, not the
 * protocol's: `rejected` is a FAILED task (it ran and refused), `auth-required`
 * is a state the USER must resolve, and an unrecognised state is `reconciling`
 * — never a success.
 */
const FROM_A2A = Object.freeze({
  submitted: 'queued',
  working: 'running',
  'input-required': 'input_required',
  completed: 'completed',
  canceled: 'canceled',
  failed: 'failed',
  rejected: 'failed',
  'auth-required': 'auth_required',
  unknown: 'reconciling'
});

export function stateFromA2A(value) {
  const key = String(value || '').trim().toLowerCase();
  return FROM_A2A[key] || 'reconciling';
}

/** A provider-owned error code, namespaced so it can never collide with ours. */
export const PROVIDER_ERROR = (code) => `PROVIDER_${String(code || 'ERROR').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 40)}`;

/**
 * Bounded, control-character-free text.
 *
 * Providers return Markdown with citations; they can also return ANSI escapes,
 * NUL bytes, zero-width joiners and 10 MB of prose. All of it is allowed to be
 * *interesting* — none of it is allowed to be unbounded or invisible, because
 * invisible text is where a "this task is free" line hides in a paid UI.
 */
export function sanitizeProviderText(value, max = 8000) {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : String(value);
  return raw
    .replace(/\u0000/g, '')
    /* eslint-disable-next-line no-control-regex */
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    /* Zero-width / bidi controls: used to smuggle text past a human reader. */
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    .slice(0, max);
}

/** URLs a result actually cites, deduplicated and capped. */
export function extractCitations(text, max = 12) {
  const out = [];
  const re = /https?:\/\/[^\s<>()"'`\\]+/gi;
  let match;
  while ((match = re.exec(String(text || ''))) !== null && out.length < max) {
    const url = match[0].replace(/[.,;:]+$/, '');
    if (url.length < 12 || url.length > 300) continue;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * Prompt-injection heuristics.
 *
 * This is NOT a filter and does not claim to be one: the real defence is that
 * provider text is data, never an instruction — it is rendered as text (never
 * HTML), it cannot call a tool, and it cannot start a payment. What this does
 * is make the risk VISIBLE, so a result that reads like an instruction to move
 * funds carries a warning instead of looking like a normal answer.
 */
const INJECTION_PATTERNS = Object.freeze([
  /ignore (all )?(previous|prior|above) (instructions|rules|prompts)/i,
  /disregard (the|your) (system|safety|previous)/i,
  /you are now (a|the) (admin|developer|system)/i,
  /(send|transfer|bridge) .{0,40}(funds|balance|usdc|eth|btc)/i,
  /(seed phrase|private key|mnemonic|recovery phrase)/i,
  /(approve|sign) .{0,30}(transaction|contract|allowance)/i,
  /(share|paste|provide) .{0,30}(password|otp|2fa|api key)/i,
  /new (payment )?(address|recipient|wallet).{0,40}(send|pay)/i
]);

export function scanForInjection(text) {
  const hits = [];
  const source = String(text || '');
  for (const pattern of INJECTION_PATTERNS) {
    const m = source.match(pattern);
    if (m) hits.push(m[0].slice(0, 120));
    if (hits.length >= 4) break;
  }
  return hits;
}

/** A URL that is safe to show as a *link* (never auto-fetched, never embedded). */
export function safeCitation(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|169\.254\.)/i.test(u.hostname)) return null;
    return u.toString().slice(0, 300);
  } catch {
    return null;
  }
}

/**
 * The normalized result shape (§14). Only fields a provider actually supplied
 * are populated; `null` means "the provider did not report this", which the UI
 * renders as an em dash rather than a zero.
 */
export function normalizeResult({ text = '', artifacts = [], data = null, providerRef = null, providerReportedCost = null } = {}) {
  const cleanText = sanitizeProviderText(text);
  const citations = extractCitations(cleanText).map(safeCitation).filter(Boolean);
  const warnings = scanForInjection(cleanText);
  return {
    text: cleanText,
    artifacts: (Array.isArray(artifacts) ? artifacts : []).slice(0, 12).map((a) => ({
      id: sanitizeProviderText(a?.id, 80) || null,
      name: sanitizeProviderText(a?.name, 120) || null,
      mediaType: sanitizeProviderText(a?.mediaType, 60) || null,
      text: sanitizeProviderText(a?.text, 20000)
    })),
    data: data && typeof data === 'object' ? data : null,
    citations,
    warnings,
    providerRef: providerRef ? sanitizeProviderText(providerRef, 200) : null,
    providerReportedCost: providerReportedCost && typeof providerReportedCost === 'object' ? providerReportedCost : null
  };
}

/**
 * A2A `Task` (or a bare `Message`) → the Hub's normalized task payload.
 *
 * Both shapes are legal A2A answers to `message/send`: a provider that finishes
 * synchronously may return the completed Task, and one that only acknowledges
 * may return a Message. A Message has no task id, so it is reported as
 * `reconciling` with the text preserved — FBT will not pretend a chat reply is
 * a completed job.
 */
export function normalizeA2AResult(result) {
  if (!result || typeof result !== 'object') {
    return { remoteTaskId: null, state: 'reconciling', result: null, providerStatus: null, errorCode: null, canceled: false };
  }
  if (result.kind === 'message' || (Array.isArray(result.parts) && !result.status)) {
    const text = (result.parts || []).map((p) => (p?.kind === 'text' ? p.text : '')).join('\n');
    return {
      remoteTaskId: result.taskId || null,
      state: 'reconciling',
      providerStatus: 'message',
      errorCode: null,
      canceled: false,
      result: normalizeResult({ text, providerRef: result.messageId || null })
    };
  }
  const status = result.status || {};
  const state = stateFromA2A(status.state);
  const artifactParts = [];
  for (const artifact of Array.isArray(result.artifacts) ? result.artifacts : []) {
    const text = (Array.isArray(artifact?.parts) ? artifact.parts : [])
      .map((p) => (p?.kind === 'text' ? p.text : p?.kind === 'data' ? JSON.stringify(p.data) : ''))
      .filter(Boolean)
      .join('\n');
    artifactParts.push({ id: artifact?.artifactId, name: artifact?.name, mediaType: artifact?.parts?.[0]?.mimeType || null, text });
  }
  const statusText = (Array.isArray(status?.message?.parts) ? status.message.parts : [])
    .map((p) => (p?.kind === 'text' ? p.text : ''))
    .filter(Boolean)
    .join('\n');
  const body = [statusText, ...artifactParts.map((a) => a.text)].filter(Boolean).join('\n\n');
  const errorCode = state === 'failed' ? PROVIDER_ERROR(result?.metadata?.errorCode || status?.state || 'FAILED') : null;
  return {
    remoteTaskId: result.id || null,
    state,
    providerStatus: sanitizeProviderText(status.state, 40) || null,
    errorCode,
    canceled: state === 'canceled',
    contextId: result.contextId || null,
    result: body ? normalizeResult({ text: body, artifacts: artifactParts, providerRef: result.id || null }) : null
  };
}

/**
 * JSON-RPC / HTTP error → { ok:false, code, retryable, providerStatus }.
 *
 * `retryable` answers one question only: may the broker try this READ again?
 * It is never consulted to decide whether to create a task a second time.
 */
export function normalizeProviderError(error, { stage = 'request' } = {}) {
  const httpStatus = Number(error?.httpStatus || 0);
  const rpcCode = Number(error?.rpcCode || 0);
  const providerStatus = httpStatus || rpcCode || null;

  /* The transport layer already produced a code with a known meaning. Trust it
     rather than re-deriving one from an absent HTTP status: a socket that dies
     after the provider accepted the task must read as UNKNOWN, not as a generic
     provider fault the broker might retry. */
  const TRANSPORT = {
    PROVIDER_TIMEOUT: { retryable: true },
    PROVIDER_UNREACHABLE: { retryable: true },
    PROVIDER_RATE_LIMITED: { retryable: true },
    PROVIDER_UNAVAILABLE: { retryable: true },
    PROVIDER_TASK_NOT_FOUND: { retryable: false },
    PROVIDER_AUTH_REQUIRED: { retryable: false },
    PROVIDER_RESPONSE_TOO_LARGE: { retryable: false },
    PROVIDER_RESPONSE_NOT_JSON: { retryable: false },
    PROVIDER_REDIRECT_REJECTED: { retryable: false },
    PROVIDER_REJECTED_REQUEST: { retryable: false },
    PROVIDER_UNSUPPORTED: { retryable: false },
    PROVIDER_URL_INVALID: { retryable: false },
    PROVIDER_URL_NOT_HTTPS: { retryable: false },
    PROVIDER_URL_IS_IP: { retryable: false },
    PROVIDER_URL_PRIVATE_HOST: { retryable: false },
    PROVIDER_URL_HAS_CREDENTIALS: { retryable: false },
    PROVIDER_URL_NONSTANDARD_PORT: { retryable: false },
    PROVIDER_URL_HAS_QUERY: { retryable: false },
    PROVIDER_URL_NOT_ALLOWLISTED: { retryable: false },
    PROVIDER_EMPTY_RESULT: { retryable: false }
  };
  if (error?.code && TRANSPORT[error.code]) {
    return { ok: false, code: error.code, retryable: TRANSPORT[error.code].retryable, providerStatus, stage };
  }

  if (error?.name === 'AbortError' || error?.code === 'ETIMEDOUT' || error?.timeout === true) {
    return { ok: false, code: 'PROVIDER_TIMEOUT', retryable: true, providerStatus, stage };
  }
  if (error?.code === 'NETWORK_UNAVAILABLE' || error?.name === 'TypeError') {
    return { ok: false, code: 'PROVIDER_UNREACHABLE', retryable: true, providerStatus, stage };
  }
  if (httpStatus === 401 || httpStatus === 403 || rpcCode === -32001 && /auth/i.test(String(error?.rpcMessage || ''))) {
    return { ok: false, code: 'PROVIDER_AUTH_REQUIRED', retryable: false, providerStatus, stage };
  }
  if (httpStatus === 429) {
    return { ok: false, code: 'PROVIDER_RATE_LIMITED', retryable: true, providerStatus, stage };
  }
  if (rpcCode === -32001) {
    /* JSON-RPC TaskNotFound. Not an error the user can fix; the broker treats
       it as "the remote job is gone" and reconciles rather than retrying. */
    return { ok: false, code: 'PROVIDER_TASK_NOT_FOUND', retryable: false, providerStatus, stage };
  }
  if (httpStatus === 404) {
    return { ok: false, code: 'PROVIDER_NOT_FOUND', retryable: false, providerStatus, stage };
  }
  if (httpStatus === 400 || httpStatus === 422 || (rpcCode >= -32602 && rpcCode <= -32600)) {
    return { ok: false, code: 'PROVIDER_REJECTED_REQUEST', retryable: false, providerStatus, stage };
  }
  if (httpStatus === 501 || httpStatus === 405) {
    return { ok: false, code: 'PROVIDER_UNSUPPORTED', retryable: false, providerStatus, stage };
  }
  if (httpStatus >= 500) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', retryable: true, providerStatus, stage };
  }
  return { ok: false, code: 'PROVIDER_ERROR', retryable: false, providerStatus, stage };
}

/**
 * The provider's own error message, reduced to something safe to store.
 * It is kept in an INTERNAL diagnostic field and never shown verbatim.
 */
export function providerDiagnostic(error) {
  const message = sanitizeProviderText(error?.rpcMessage || error?.message || error?.detail || '', 300);
  const code = error?.rpcCode || error?.httpStatus || error?.code || null;
  return { code: code === null ? null : String(code).slice(0, 40), message };
}

/**
 * Remove anything that looks like a credential from a string before it is
 * logged or echoed. Deliberately aggressive: false positives are cheap.
 */
export function redactSecrets(value, max = 400) {
  return sanitizeProviderText(value, max)
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[redacted]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g, '[redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, '$1[redacted]')
    .replace(/\b(0x[a-fA-F0-9]{64})\b/g, '[redacted]')
    .replace(/("?(?:api[_-]?key|secret|token|password|authorization)"?\s*[:=]\s*"?)[^"\s,}]{8,}/gi, '$1[redacted]');
}

/** A user-facing message for a state the Hub produced itself. */
export const USER_MESSAGES = Object.freeze({
  PROVIDER_TIMEOUT: 'The provider did not answer in time. The task may still be running on their side — check again before starting a new one.',
  PROVIDER_UNREACHABLE: 'The provider could not be reached. Nothing was charged.',
  PROVIDER_RATE_LIMITED: 'The provider is rate-limiting requests right now. Try again shortly.',
  PROVIDER_AUTH_REQUIRED: 'The provider requires a connected account for this agent.',
  PROVIDER_TASK_NOT_FOUND: 'The provider no longer knows this task. It was not retried automatically.',
  PROVIDER_UNAVAILABLE: 'The provider is reporting a server error. Try again later.',
  PROVIDER_REJECTED_REQUEST: 'The provider rejected the task. Adjust the input and try again.',
  PROVIDER_UNSUPPORTED: 'This provider does not support that operation for this agent.',
  PROVIDER_ERROR: 'The provider returned an error.',
  AGENT_UNAVAILABLE: 'This agent is not available right now.',
  HUB_DISABLED: 'External agents are not enabled on this deployment.',
  PAID_INVOCATION_DISABLED: 'Paid agent invocation is not enabled. Nothing was charged.',
  CONSENT_REQUIRED: 'Choose what to share before starting the task.',
  IDEMPOTENCY_CONFLICT: 'That request key was already used with different content.',
  REQUEST_IN_PROGRESS: 'An identical request is already being processed.',

  /* User-supplied sources: the user typed a URL, so the message must say what
     is wrong with THAT URL rather than blame the deployment. */
  SOURCE_URL_REQUIRED: 'Enter the agent card URL of the agent you want to add.',
  SOURCE_URL_INVALID: 'That is not a valid URL. It must start with https:// and point at an agent card.',
  SOURCE_CARD_UNREACHABLE: 'Nothing answered at that URL with an agent card. Check the address and that the provider allows requests from FBT.',
  SOURCE_CARD_INVALID: 'That page answered, but it is not a valid A2A agent card (no agent name).',
  SOURCE_LIMIT_REACHED: 'You have reached the number of agents you can add here. Remove one before adding another.',
  SOURCE_RATE_LIMITED: 'Too many new agents in a short time. Try again in a few minutes.',
  SOURCE_NOT_FOUND: 'That agent source no longer exists.',
  PROVIDER_URL_NOT_HTTPS: 'Only https:// addresses are accepted.',
  PROVIDER_URL_IS_IP: 'A numeric IP address is not accepted — use the provider’s domain name.',
  PROVIDER_URL_PRIVATE_HOST: 'That host is private or internal and cannot be reached from here.',
  PROVIDER_URL_HAS_CREDENTIALS: 'Remove the username or password from the URL.',
  PROVIDER_URL_HAS_QUERY: 'Remove the query string from the URL.',
  PROVIDER_URL_NONSTANDARD_PORT: 'Only the standard https port (443) is accepted.'
});

export function userMessageFor(code, fallback = null) {
  return USER_MESSAGES[code] || fallback || 'The task could not be completed.';
}

/** ISO timestamp or null — never `new Date()` on an invalid provider value. */
export function isoAt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
