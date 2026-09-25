/**
 * FBT AI GATEWAY — Central Multi-Model AI Intelligence Layer
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade
 *
 * Connects and orchestrates multiple AI providers:
 *   1. OpenRouter           — Multi-model router (Claude, GPT-4o, DeepSeek, Llama-3)
 *   2. Groq                 — Ultra-low latency open-weight inference
 *   3. Google Gemini        — Multi-modal analysis, fast structured generation
 *   4. Anthropic            — Claude 3.5 Sonnet, Claude 3 Haiku safety & analysis
 *   5. DeepSeek             — DeepSeek-V3, DeepSeek-R1 reasoning & math
 *   6. Mistral              — Mistral Large, Mistral Small
 *   7. Cloudflare Workers AI — Free serverless open models (Llama/Mistral/DeepSeek)
 *   8. AIMLAPI              — Unified multi-model gateway behind one key
 *   9. Internal AI Engine   — Zero-dependency deterministic offline-ready fallback
 *
 * ─── REMOVED PROVIDERS (no API key on this deployment) ─────────────────────
 * Grok (xAI), OpenAI and Perplexity were registered here but never had a key
 * configured, so every call routed to them failed over anyway. They are gone
 * from the registry, and the jobs they were listed for are now carried by the
 * providers that do have keys:
 *
 *   · Grok (market intelligence / macro synthesis)  → OpenRouter (it routes to
 *     market-grade models incl. online variants), then Gemini, Groq, DeepSeek.
 *   · Perplexity (live web search & sourced notes)  → OpenRouter `:online`
 *     capable models, then Gemini; the research task has its own route.
 *   · OpenAI (high-precision finance logic)         → Anthropic, DeepSeek and
 *     AIMLAPI (which serves the same GPT class behind its own key).
 *
 * Security Absolutes:
 *   - NEVER leaks private keys, mnemonics, seed phrases or API secrets to external models.
 *   - External AI is NEVER the source of truth for wallet balances or tx receipts.
 *   - External AI CANNOT directly sign or execute transactions.
 * - All responses pass through schema verification and sanitization.
 */

// ---------------------------------------------------------------------------
// Provider Configurations & Endpoints
// ---------------------------------------------------------------------------

/*
 * ─── MODEL CURRENCY: THE FAILURE THIS TABLE FIXES ───────────────────────────
 * Verified 2026-09-25 against a LIVE production self-test
 * (GET /api/v1/ai/gateway/selftest on the deployed app). All nine keys were
 * present in the environment — `configured: true` for every provider — and
 * eight of the nine still failed on the first real call:
 *
 *   groq      HTTP 404  "The model `llama-3.3-70b-versatile` does not exist"
 *                       → retired for Free/Developer tiers on 2026-08-16
 *                         (Groq deprecation history; replacements:
 *                         openai/gpt-oss-120b, qwen/qwen3.6-27b).
 *   gemini    HTTP 404  "models/gemini-2.0-flash is no longer available"
 *                       → shut down by Google (Gemini deprecations page).
 *   anthropic HTTP 400  "Your credit balance is too low"  (account billing)
 *                       + the pinned claude-3-5-sonnet-20241022 was retired
 *                         on 2025-10-28, so it would 404 even with credit.
 *   deepseek  HTTP 402  "Insufficient Balance"             (account billing)
 *   mistral   HTTP 403  "not available in your subscription tier"
 *                       → mistral-large-latest is a paid model; the free
 *                         "Experiment" tier only serves small/nemo/labs.
 *   workersai HTTP 400  code 7000 "No route for that URI"
 *                       → OUR bug: the model id was encodeURIComponent()'d,
 *                         so `@cf/meta/llama-3.1-8b-instruct` became
 *                         `%40cf%2Fmeta%2Fllama-3.1-8b-instruct` and the
 *                         Cloudflare route no longer matched.
 *   aimlapi   HTTP 403  "You've run out of funds"          (account billing)
 *   openrouter HEALTHY  (the only provider that actually answered)
 *
 * So the honest diagnosis was never "no keys". It was: keys present, models
 * stale, one malformed URL, no per-model failover (`fallbackModels` below was
 * declared and never read by anything), and no memory of which providers are
 * broken — so every request re-paid for the same five failures before reaching
 * the one provider that works. All four of those are fixed here.
 *
 * Billing rows (anthropic / deepseek / aimlapi / mistral-tier) can only be
 * fixed by the account owner; the gateway now names them precisely instead of
 * silently answering from the rule engine.
 */
export const PROVIDER_CONFIGS = Object.freeze({
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    envKey: 'OPENROUTER_API_KEY',
    /* Accepted spellings. A key saved under a near-miss name in the host's
       environment used to be invisible; the first non-empty one wins and the
       diagnostics report WHICH name supplied it. */
    envKeys: ['OPENROUTER_API_KEY', 'OPENROUTER_KEY', 'OPEN_ROUTER_API_KEY'],
    modelEnv: 'AI_MODEL',
    defaultModel: process.env.AI_MODEL || 'openai/gpt-4o-mini',
    fallbackModels: [
      'google/gemini-2.5-flash',
      'deepseek/deepseek-chat',
      'anthropic/claude-3.5-haiku',
      'meta-llama/llama-3.3-70b-instruct'
    ],
    type: 'openai-compatible',
    // Also carries the market-intelligence and live-search duties that used to
    // sit on Grok and Perplexity: OpenRouter can route to online-capable
    // models, so it is the honest home for both once those keys are absent.
    specialty: 'Multi-Model Routing, Market Intelligence & Live Search-Grounded Synthesis',
    costTier: 'medium',
    latencyTier: 'medium'
  },
  groq: {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    envKey: 'GROQ_API_KEY',
    envKeys: ['GROQ_API_KEY', 'GROQ_KEY'],
    modelEnv: 'GROQ_MODEL',
    /* Was `llama-3.3-70b-versatile`, which Groq shut down for Free/Developer
       tiers on 2026-08-16 → HTTP 404 on every call. gpt-oss-20b is the cheap,
       fast, currently-listed Production model (~1000 t/s). */
    defaultModel: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
    fallbackModels: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
    retiredModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
      'llama3-70b-8192',
      'llama3-8b-8192',
      'llama-3.3-70b-specdec',
      'llama-3.1-70b-versatile'
    ],
    type: 'openai-compatible',
    specialty: 'Ultra-fast Intent Understanding & Fast Parsing',
    costTier: 'free',
    latencyTier: 'ultra-fast'
  },
  gemini: {
    name: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    envKey: 'GEMINI_API_KEY',
    altEnvKey: 'VITE_GEMINI_API_KEY',
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_KEY', 'VITE_GEMINI_API_KEY'],
    modelEnv: 'GEMINI_MODEL',
    /* Was `gemini-2.0-flash`, which Google has shut down ("This model … is no
       longer available") → HTTP 404 on every call. 2.5-flash is the current
       stable workhorse; `gemini-flash-latest` is Google's own always-current
       alias and sits right behind it. */
    defaultModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    fallbackModels: ['gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-pro'],
    retiredModels: [
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b',
      'gemini-pro',
      'gemini-3-pro-preview',
      'gemini-3.1-flash-lite-preview'
    ],
    type: 'gemini-native',
    specialty: 'Structured Data Extraction & Multi-perspective Synthesis',
    costTier: 'low',
    latencyTier: 'fast'
  },
  anthropic: {
    name: 'Anthropic Claude',
    url: 'https://api.anthropic.com/v1/messages',
    envKey: 'ANTHROPIC_API_KEY',
    envKeys: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
    modelEnv: 'ANTHROPIC_MODEL',
    /* Was `claude-3-5-sonnet-20241022`, retired by Anthropic on 2025-10-28.
       Haiku 4.5 is the current cheap seat for policy/risk checks; Sonnet 4.6
       is the escalation. NOTE: the deployed account also answers
       "Your credit balance is too low" — that part is billing, not code. */
    defaultModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
    fallbackModels: ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-3-5-haiku-latest'],
    retiredModels: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-20240620',
      'claude-3-5-sonnet-latest',
      'claude-3-7-sonnet-20250219',
      'claude-3-7-sonnet-latest',
      'claude-3-5-haiku-20241022',
      'claude-3-haiku-20240307',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-opus-4-1-20250805'
    ],
    type: 'anthropic-native',
    // Carries the high-precision financial-logic duty that used to sit on
    // OpenAI, alongside its own risk/policy specialisation.
    specialty: 'Deep Risk Assessment, Constraint Checking, Policy Auditing & High-precision Financial Logic',
    costTier: 'high',
    latencyTier: 'medium'
  },
  deepseek: {
    name: 'DeepSeek',
    url: 'https://api.deepseek.com/v1/chat/completions',
    envKey: 'DEEPSEEK_API_KEY',
    envKeys: ['DEEPSEEK_API_KEY', 'DEEPSEEK_KEY'],
    modelEnv: 'DEEPSEEK_MODEL',
    defaultModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    fallbackModels: ['deepseek-reasoner'],
    retiredModels: [],
    type: 'openai-compatible',
    specialty: 'Mathematical Optimization, Quantitative Modeling & Reasoning',
    costTier: 'low',
    latencyTier: 'medium'
  },
  mistral: {
    name: 'Mistral AI',
    url: 'https://api.mistral.ai/v1/chat/completions',
    envKey: 'MISTRAL_API_KEY',
    envKeys: ['MISTRAL_API_KEY', 'MISTRAL_KEY'],
    modelEnv: 'MISTRAL_MODEL',
    /* Was `mistral-large-latest`, which the free "Experiment" tier refuses with
       HTTP 403 tier_not_allowed. Small is the free-tier model; the paid ones
       stay at the END of the list so a funded account still gets them if the
       free ids ever move. */
    defaultModel: process.env.MISTRAL_MODEL || 'mistral-small-latest',
    fallbackModels: ['mistral-small-2506', 'open-mistral-nemo', 'mistral-medium-latest', 'mistral-large-latest'],
    retiredModels: ['open-mixtral-8x7b', 'mistral-tiny', 'mistral-small-2312'],
    type: 'openai-compatible',
    specialty: 'Multilingual Intent Processing & Concise Explanations',
    costTier: 'medium',
    latencyTier: 'fast'
  },
  workersai: {
    name: 'Cloudflare Workers AI',
    url: 'https://api.cloudflare.com/client/v4/accounts',
    envKey: 'CLOUDFLARE_API_TOKEN',
    envKeys: ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_AI_TOKEN'],
    accountEnvKeys: ['CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID'],
    modelEnv: 'WORKERSAI_MODEL',
    defaultModel: process.env.WORKERSAI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    fallbackModels: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/mistral/mistral-7b-instruct-v0.2', '@cf/deepseek/deepseek-r1-distill-qwen-32b', '@cf/meta/llama-3.2-3b-instruct'],
    retiredModels: [],
    type: 'workersai-native',
    specialty: 'Free Serverless Open Models (Llama/Mistral/DeepSeek) — Private Edge Inference',
    costTier: 'free',
    latencyTier: 'fast'
  },
  aimlapi: {
    name: 'AIMLAPI (Unified Multi-Model)',
    url: 'https://api.aimlapi.com/v1/chat/completions',
    envKey: 'AIMLAPI_KEY',
    envKeys: ['AIMLAPI_KEY', 'AIMLAPI_API_KEY'],
    modelEnv: 'AIMLAPI_MODEL',
    defaultModel: process.env.AIMLAPI_MODEL || 'gpt-4o-mini',
    /* `anthropic/claude-3.5-sonnet` and `google/gemini-2.0-flash` were here;
       both are retired upstream, so a funded account would still have failed. */
    fallbackModels: ['gpt-4o', 'meta-llama/Llama-3.3-70B-Instruct', 'deepseek/deepseek-chat', 'google/gemini-2.5-flash'],
    retiredModels: ['anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash', 'google/gemini-1.5-pro'],
    type: 'openai-compatible',
    // The OpenAI-shaped slot of the fleet is served from here: AIMLAPI fronts
    // the same GPT class (and Claude/Gemini/Llama) behind its own key.
    specialty: 'Unified Gateway: GPT / Claude / Gemini / Llama / DeepSeek via One Key — carries the OpenAI-class slot',
    costTier: 'low',
    latencyTier: 'fast'
  },
  internal: {
    name: 'FBT Internal Reasoning Engine',
    url: 'internal://heuristic',
    envKey: null,
    envKeys: [],
    modelEnv: null,
    defaultModel: 'fbt-rules-v3',
    fallbackModels: [],
    retiredModels: [],
    type: 'internal-engine',
    specialty: 'Deterministic Financial Policy, Safety Checks & Zero-Dependency Fallback',
    costTier: 'zero',
    latencyTier: 'instant'
  }
});

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 35000);
const SITE_URL = process.env.WEBAPP_URL || 'https://fbt-swap.app';

// ---------------------------------------------------------------------------
// Security: Prompt Sanitization & Secret Stripping
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /0x[a-fA-F0-9]{64}/g, // Private key hex
  /\b(?:private[_-]?key|secret[_-]?key|mnemonic|seed[_-]?phrase|master[_-]?password)\b\s*[:=]\s*["']?[^"'\s]+["']?/gi,
  /\b(?:xprv|xpub|prv|seed)\w{30,}\b/gi,
  /\b[a-z]{3,12}(?:\s+[a-z]{3,12}){11,23}\b/g // 12-24 word seed phrase candidates
];

export function sanitizePrompt(text) {
  if (typeof text !== 'string') return '';
  let sanitized = text;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_SECRET]');
  }
  return sanitized;
}

export function assertNoSecretsInPayload(payload) {
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (/private[\s_-]?key/i.test(str) && /0x[a-fA-F0-9]{64}/.test(str)) {
    throw new Error('SECURITY_VIOLATION: Attempted to pass raw private key to AI');
  }
  return true;
}

// ---------------------------------------------------------------------------
// Secret Normalization — a key that is present but dirty is still a dead key
// ---------------------------------------------------------------------------

/*
 * Environment stores smuggle junk into secrets: a trailing newline from a
 * terminal paste, wrapping quotes from a `.env` written by hand, a `Bearer `
 * prefix copied out of a curl example, and zero-width/Bidi characters that are
 * invisible in the Vercel dashboard. The provider then answers 401 and the
 * dashboard still shows the variable as "set", which reads as «کلید را گذاشتم
 * ولی وصل نمی‌شود».
 *
 * The Telegram token already had this normalization (server/telegramAuth.js);
 * the AI fleet did not. Every key and account id now goes through it.
 */
export function normalizeSecretValue(value) {
  if (value == null) return '';
  let s = String(value);
  // Zero-width, BOM and Bidi marks — invisible in every dashboard.
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
  s = s.trim();
  // `Bearer sk-...` pasted from a curl example.
  s = s.replace(/^bearer\s+/i, '');
  // One layer of wrapping quotes ("sk-..." or 'sk-...').
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }
  // An account id / key must never contain internal whitespace.
  s = s.replace(/\s+/g, '');
  return s;
}

/** First non-empty (normalized) value among `names`, plus which name supplied it. */
function readEnvAny(names) {
  for (const name of names) {
    if (!name) continue;
    const v = normalizeSecretValue(process.env[name]);
    if (v) return { value: v, sourceEnv: name };
  }
  return { value: '', sourceEnv: null };
}

const envNamesFor = (cfg) => (Array.isArray(cfg?.envKeys) && cfg.envKeys.length ? cfg.envKeys : [cfg?.envKey, cfg?.altEnvKey].filter(Boolean));

// ---------------------------------------------------------------------------
// Provider Key Resolution & Status
// ---------------------------------------------------------------------------

export function getProviderKey(providerId) {
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg) return null;
  if (!cfg.envKey) return 'INTERNAL_ACTIVE'; // internal always active
  return readEnvAny(envNamesFor(cfg)).value;
}

/**
 * Same lookup, but reporting WHICH environment variable supplied the key.
 * Diagnostics use it so an operator who saved `GROQ_KEY` instead of
 * `GROQ_API_KEY` sees that it was accepted — and under what name.
 * Never returns the key value itself in `present` form; callers must not log it.
 */
export function getProviderKeyInfo(providerId) {
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg || !cfg.envKey) return { providerId, present: providerId === 'internal', sourceEnv: null, accepted: envNamesFor(cfg) };
  const { value, sourceEnv } = readEnvAny(envNamesFor(cfg));
  return {
    providerId,
    present: Boolean(value),
    length: value.length,
    sourceEnv,
    accepted: envNamesFor(cfg),
    /* A raw value that differs from its normalized form means the stored
       secret carries whitespace/quotes. We cleaned it, but the operator should
       know the stored copy is dirty. */
    dirtyInEnv: Boolean(value) && Boolean(sourceEnv) && String(process.env[sourceEnv] ?? '') !== value
  };
}

/** Cloudflare needs an account id in the URL as well as a token. */
function getCloudflareAccountId() {
  return readEnvAny(PROVIDER_CONFIGS.workersai.accountEnvKeys || ['CLOUDFLARE_ACCOUNT_ID']).value;
}

export function isProviderConfigured(providerId) {
  if (providerId === 'internal') return true;
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg) return false;
  const key = getProviderKey(providerId);
  if (!key || key.trim().length === 0) return false;
  // Workers AI also needs the account id to build the run endpoint
  if (providerId === 'workersai' && !getCloudflareAccountId()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Provider Health, Circuit Breaker & Error Classification
// ---------------------------------------------------------------------------

/*
 * WHY THE GATEWAY OWNS HEALTH (it used to live one layer up, in
 * server/aiCollaboration.js): the collaboration engine could avoid a dying
 * provider, but `routedChat` — the path /api/ai/ask, /brief and /outlook
 * actually take — could not. So a "fast" task paid for workersai, groq,
 * gemini, mistral and aimlapi failures on EVERY request before reaching
 * openrouter, the one provider that answered. Health now lives here, where
 * every caller shares it.
 */
const healthState = new Map(); // providerId -> { calls: [], lastSuccess, lastError, consecutiveFailures, openUntil }
const HEALTH_WINDOW = 50;

/* How long a failure class keeps the circuit open. A billing or auth failure
   does not heal by itself, so it is parked long; a timeout may heal in
   seconds, so it is parked briefly. */
const CIRCUIT_OPEN_MS = {
  AUTH: 30 * 60_000,
  BILLING: 30 * 60_000,
  PERMISSION: 30 * 60_000,
  CF_ACCOUNT: 30 * 60_000,
  MODEL_UNAVAILABLE: 10 * 60_000,
  QUOTA: 60_000,
  TIMEOUT: 45_000,
  NETWORK: 45_000,
  EMPTY: 30_000,
  UNKNOWN: 60_000
};

function healthEntry(providerId) {
  let st = healthState.get(providerId);
  if (!st) {
    st = { calls: [], lastSuccess: null, lastError: null, consecutiveFailures: 0, openUntil: 0, openReason: null };
    healthState.set(providerId, st);
  }
  return st;
}

export function recordProviderCall(providerId, { ok = true, durationMs = 0, model = null, error = null, reasonCode = null, fix = null, qualityScore = null } = {}) {
  if (!providerId || providerId === 'internal') return;
  const st = healthEntry(providerId);
  st.calls.push({ ok: Boolean(ok), durationMs: Number(durationMs) || 0, qualityScore: qualityScore == null ? null : Number(qualityScore), at: Date.now() });
  if (st.calls.length > HEALTH_WINDOW) st.calls.shift();
  if (ok) {
    st.consecutiveFailures = 0;
    st.openUntil = 0;
    st.openReason = null;
    st.lastError = null;
    st.lastSuccess = { at: Date.now(), model: model || null, durationMs: Number(durationMs) || 0 };
    return;
  }
  st.consecutiveFailures += 1;
  st.lastError = {
    at: Date.now(),
    model: model || null,
    reasonCode: reasonCode || 'UNKNOWN',
    message: String(error || '').slice(0, 240),
    fix: fix || null
  };
  /* One classified failure is enough to park a provider: unlike a flaky
     network, AUTH/BILLING/MODEL_UNAVAILABLE are deterministic — retrying them
     on the next request only buys latency. */
  const park = CIRCUIT_OPEN_MS[reasonCode] ?? CIRCUIT_OPEN_MS.UNKNOWN;
  if (st.consecutiveFailures >= 2 || ['AUTH', 'BILLING', 'PERMISSION', 'MODEL_UNAVAILABLE', 'CF_ACCOUNT'].includes(reasonCode)) {
    st.openUntil = Date.now() + park;
    st.openReason = reasonCode;
  }
}

export function isProviderHealthy(providerId) {
  const st = healthState.get(providerId);
  if (!st) return true;
  return Date.now() >= st.openUntil;
}

/*
 * "Its last real call failed" is a separate fact from "its circuit is open".
 * A single NETWORK or TIMEOUT failure does not park a provider (it may heal in
 * seconds), so without this predicate the fleet reported such a provider as
 * UNTESTED / AVAILABLE — the panel said «هنوز آزموده نشده» about a model that
 * had just refused a call in front of us, and the summary counted 8 untested and
 * 0 failing after a round in which all 8 failed. That is the same class of lie
 * this whole rewrite exists to remove: the verdict follows the evidence, not the
 * circuit.
 */
function lastCallFailed(st) {
  if (!st?.lastError) return false;
  if (!st.lastSuccess) return true;
  return (st.lastError.at || 0) > (st.lastSuccess.at || 0);
}


export function getProviderHealth() {
  const out = {};
  for (const [providerId, st] of healthState.entries()) {
    const total = st.calls.length;
    const okCount = st.calls.filter((c) => c.ok).length;
    const circuitOpen = Date.now() < st.openUntil;
    const failed = lastCallFailed(st);
    const quality = st.calls.filter((c) => c.qualityScore != null);
    out[providerId] = {
      calls: total,
      successRate: total ? Number((okCount / total).toFixed(2)) : 1,
      errorRate: total ? Number(((total - okCount) / total).toFixed(2)) : 0,
      avgLatencyMs: total ? Math.round(st.calls.reduce((a, c) => a + c.durationMs, 0) / total) : 0,
      qualityScore: quality.length ? Math.round(quality.reduce((a, c) => a + c.qualityScore, 0) / quality.length) : null,
      consecutiveFailures: st.consecutiveFailures,
      circuitOpen,
      /* Distinct from circuitOpen on purpose: a single transient failure does
         not park a provider, but it is still the truth about its last call. */
      failedLastCall: failed,
      openReason: circuitOpen ? st.openReason : null,
      retryAfterMs: circuitOpen ? Math.max(0, st.openUntil - Date.now()) : 0,
      lastSuccess: st.lastSuccess,
      lastError: st.lastError,
      availability: (circuitOpen || failed) ? 'DEGRADED' : (st.lastSuccess ? 'AVAILABLE' : (total ? 'AVAILABLE' : 'UNKNOWN'))
    };
  }
  return out;
}

export function resetProviderHealth() {
  healthState.clear();
}

/**
 * Health-aware ordering: proven-good providers first, never-tried next,
 * circuit-open last. Stable inside each group, so the task preference order
 * still decides ties. A parked provider is never dropped — if it is the only
 * one left it still gets the call.
 */
export function orderByHealth(providerIds) {
  const rank = (id) => {
    const st = healthState.get(id);
    if (!st) return 1; // unknown: worth trying
    if (Date.now() < st.openUntil) return 3; // circuit open: last resort
    if (lastCallFailed(st)) return 2; // answered badly last time: try after the untried
    return st.lastSuccess ? 0 : 1;
  };
  return providerIds
    .map((id, i) => ({ id, i, r: rank(id) }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map((x) => x.id);
}

/**
 * Turn a provider error into a class the router can act on.
 *
 * `retryNextModel` is the important bit: it separates "this MODEL is wrong"
 * (404 model_not_found, 403 tier_not_allowed — try the next model on the same
 * provider, no reason to give up on a working key) from "this ACCOUNT/KEY is
 * wrong" (401/402/403-permission — no model will help, move to the next
 * provider immediately instead of burning four more calls).
 */
export function classifyAiError(err, providerId = null) {
  const raw = String(err?.message || err || '');
  const msg = raw.toLowerCase();
  const status = Number(err?.status) || Number((raw.match(/HTTP\s+(\d{3})/i) || [])[1]) || 0;

  const out = (kind, retryNextModel, fix) => ({ kind, retryNextModel, status, message: raw.slice(0, 300), fix });

  // Billing first: Anthropic reports an empty credit balance as HTTP 400, and
  // DeepSeek/AIMLAPI as 402/403 — status alone would misclassify all three.
  if (/credit balance is too low|insufficient balance|insufficient_balance|out of funds|run out of funds|exceeded your current credits|billing|payment required|arrears|top up your balance|no remaining credits/i.test(raw) || status === 402) {
    return out('BILLING', false, 'This provider account has no credit. Top it up in the provider console, or leave it parked — the gateway routes around it.');
  }
  if (/tier_not_allowed|not available in your subscription|subscription tier|upgrade your (plan|tier)|requires a paid (plan|tier)|free tier (does not|limit)/i.test(raw)) {
    return out('MODEL_TIER', true, 'The model is above this account\'s tier. The gateway retries with a cheaper model on the same key.');
  }
  if (status === 401 || /invalid api key|api key not valid|incorrect api key|invalid_api_key|unauthorized|authentication_error|invalid authentication|invalid token/i.test(raw)) {
    return out('AUTH', false, 'The key was rejected. Regenerate it and paste it with no quotes, spaces or newlines.');
  }
  if (/7000|no route for that uri/i.test(raw) && providerId === 'workersai') {
    return out('CF_ACCOUNT', false, 'Cloudflare could not match the run URL — CLOUDFLARE_ACCOUNT_ID is wrong, empty or carries hidden characters. Copy the 32-hex account id again.');
  }
  if (/7003|9109|authentication error \[code: 10000\]|not authorized|token (is )?invalid|invalid api token/i.test(raw) && providerId === 'workersai') {
    return out('AUTH', false, 'The Cloudflare token is invalid or lacks the "Workers AI: Edit" permission for this account.');
  }
  if (status === 403 || /permission_denied|service_disabled|access denied|forbidden|ip restriction|referer/i.test(raw)) {
    return out('PERMISSION', false, 'The key is valid but not allowed to make this call — check permissions, enabled APIs and IP/referrer restrictions in the provider console.');
  }
  if (status === 404 || /model_not_found|does not exist|no longer available|is not available|not found|unknown model|unsupported model|decommissioned|shut ?down|10000/i.test(raw)) {
    return out('MODEL_UNAVAILABLE', true, 'The model id is retired or not on this account. The gateway retries with the next current model for this provider.');
  }
  if (status === 429 || /rate limit|resource_exhausted|too many requests|quota|tpm|rpm/i.test(raw)) {
    return out('QUOTA', false, 'Rate limit or free-tier quota exhausted. Wait for the window to reset or enable billing.');
  }
  if (/temperature|thinking|sampling|budget_tokens|unsupported parameter|invalid_request_error/i.test(raw) && providerId === 'anthropic') {
    return out('ANTHROPIC_SAMPLING', true, 'This Claude model rejects the sampling parameters; the gateway retries without them.');
  }
  if (/abort|timeout|timed out|deadline/i.test(msg)) {
    return out('TIMEOUT', false, 'The provider did not answer in time.');
  }
  if (/fetch failed|enotfound|econnreset|eai_again|network|socket hang up|getaddrinfo/i.test(msg)) {
    return out('NETWORK', false, 'Network path to the provider failed (DNS/TLS/egress).');
  }
  if (/^EMPTY_|empty_ai_response|no content|blocked|promptfeedback|safety/i.test(raw)) {
    return out('EMPTY', true, 'The provider returned no usable text (safety block or empty completion).');
  }
  return out('UNKNOWN', false, 'Unclassified provider error — see message.');
}

// ---------------------------------------------------------------------------
// Model Resolution — `fallbackModels` is finally read by something
// ---------------------------------------------------------------------------

const MODEL_ATTEMPTS = Math.max(1, Number(process.env.AI_MODEL_ATTEMPTS || 3));

/**
 * Ordered model candidates for one call.
 *
 * 1. the model the caller asked for (an explicit choice is always respected,
 *    even if it is on the retired list — an Enterprise account may still have it)
 * 2. the environment override for this provider
 * 3. the provider default
 * 4. the provider's fallback models, minus anything on its retired list
 *
 * Deduped, capped at AI_MODEL_ATTEMPTS (default 3) so one broken provider
 * cannot spend four round-trips before the router moves on.
 */
export function getModelCandidates(providerId, requestedModel = null) {
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg || cfg.type === 'internal-engine') return [cfg?.defaultModel || 'fbt-rules-v3'];
  const retired = new Set(cfg.retiredModels || []);
  const envModel = cfg.modelEnv ? normalizeSecretValue(process.env[cfg.modelEnv]) : '';
  const ordered = [];
  const push = (m) => {
    const id = normalizeSecretValue(m);
    if (!id || ordered.includes(id)) return;
    ordered.push(id);
  };
  push(requestedModel);
  push(envModel);
  push(cfg.defaultModel);
  for (const m of cfg.fallbackModels || []) {
    if (retired.has(m)) continue; // a retired id must never be an automatic choice
    push(m);
  }
  return ordered.slice(0, Math.max(ordered.length > 1 ? MODEL_ATTEMPTS : 1, 1));
}

/** True when a model id is on any provider's retired list. Used by the probe. */
export function isRetiredModel(model) {
  const id = normalizeSecretValue(model);
  return Object.values(PROVIDER_CONFIGS).some((cfg) => (cfg.retiredModels || []).includes(id));
}

export function getAvailableProviders() {
  const health = getProviderHealth();
  const list = [];
  for (const [id, cfg] of Object.entries(PROVIDER_CONFIGS)) {
    const configured = isProviderConfigured(id);
    const keyInfo = getProviderKeyInfo(id);
    const h = health[id] || null;
    /*
     * ─── WHY STATUS AND THE ENV VAR NAME ARE PART OF THE PAYLOAD ─────────
     * The intelligence panel used to render ONLY `configured: true` rows and
     * hide the rest. On a deployment with no keys that produced a tab titled
     * «مدل‌های فعال (۰)» over an empty grid: eight real, registered models
     * were invisible, and nothing on screen said what was missing or how to
     * switch them on. That reads as «مدل‌ها دیگه نیستن، زده صفر».
     *
     * They are not gone — they are unconfigured. `status` says which, and
     * `envVar` names the exact variable that flips each one on, so the panel
     * is both honest about the fleet and actionable. `internal` needs no
     * key: it is the deterministic engine, so the fleet is never really 0.
     *
     * ─── AND WHY "CONFIGURED" ALONE WAS STILL NOT ENOUGH ─────────────────
     * On the live deployment every provider WAS configured, and eight of them
     * still could not answer a single call (retired model ids, a paid model on
     * a free tier, an empty credit balance, a malformed Cloudflare URL). The
     * panel therefore showed nine green "Configured" pills over a fleet where
     * exactly one model worked — the precise thing the operator reported as
     * «کلیدها را گذاشتیم ولی هوش مصنوعی به هیچکدام وصل نیست».
     *
     * `health` is the missing half: what happened the last time we actually
     * called this provider, classified, with the fix. `ACTIVE` still means
     * "a key is present" (that contract is unchanged); `health.availability`
     * and `health.lastError` say whether it works.
     */
    list.push({
      id,
      name: cfg.name,
      configured,
      status: configured ? 'ACTIVE' : (id === 'internal' ? 'ACTIVE' : 'NEEDS_KEY'),
      envVar: id === 'internal' ? null : (cfg.altEnvKey ? `${cfg.envKey} (or ${cfg.altEnvKey})` : cfg.envKey),
      acceptedEnvVars: id === 'internal' ? [] : envNamesFor(cfg),
      keySourceEnv: keyInfo.sourceEnv,
      keyDirtyInEnv: Boolean(keyInfo.dirtyInEnv),
      defaultModel: getModelCandidates(id)[0] || cfg.defaultModel,
      modelCandidates: getModelCandidates(id),
      modelEnv: cfg.modelEnv || null,
      specialty: cfg.specialty,
      costTier: cfg.costTier,
      latencyTier: cfg.latencyTier,
      type: cfg.type,
      health: id === 'internal'
        ? { availability: 'AVAILABLE', calls: 0, circuitOpen: false, lastError: null, lastSuccess: null }
        : (h || { availability: configured ? 'UNKNOWN' : 'NEEDS_KEY', calls: 0, circuitOpen: false, lastError: null, lastSuccess: null }),
      /*
       * One-line, operator-facing verdict so no panel has to re-derive it.
       * ERROR covers BOTH failure states — an open circuit and a provider whose
       * last real call failed without tripping the breaker — because to the
       * operator they are the same fact: it did not answer. UNTESTED now means
       * what it says (we have never called it), never "it failed a moment ago".
       */
      verdict: !configured
        ? 'NEEDS_KEY'
        : (h?.circuitOpen || h?.lastError
            ? `ERROR:${h.openReason || h.lastError.reasonCode || 'UNKNOWN'}`
            : (h?.lastSuccess ? 'HEALTHY' : 'UNTESTED'))
    });
  }
  return list;
}

export function getActiveProviderIds() {
  return Object.keys(PROVIDER_CONFIGS).filter(isProviderConfigured);
}

export const anyAiConfigured = () => getActiveProviderIds().some((id) => id !== 'internal');

/**
 * The fleet as an operator needs to see it in one glance: how many keys are
 * present, how many of those actually answered the last time we called, and
 * what is wrong with the rest. Cheap — reads memory, makes no call.
 */
export function getFleetSummary() {
  const providers = getAvailableProviders();
  const external = providers.filter((p) => p.id !== 'internal');
  const configured = external.filter((p) => p.configured);
  const healthy = configured.filter((p) => p.verdict === 'HEALTHY');
  const failing = configured.filter((p) => String(p.verdict).startsWith('ERROR'));
  return {
    total: providers.length,
    configured: configured.length,
    healthy: healthy.length,
    failing: failing.length,
    untested: configured.filter((p) => p.verdict === 'UNTESTED').length,
    needsKey: external.filter((p) => !p.configured).map((p) => p.envVar),
    healthyIds: healthy.map((p) => p.id),
    failingIds: failing.map((p) => ({ id: p.id, verdict: p.verdict, reason: p.health?.lastError?.reasonCode || null, fix: p.health?.lastError?.fix || null })),
    /* The answer to «چرا هوش مصنوعی کار نمی‌کند؟» in one field: which brain is
       serving traffic right now. Three cases, and the wording matters:
         · a model answered              → its provider id(s)
         · a model was tried and refused → 'degraded:internal-rules'
         · nothing has been tried yet    → 'internal-rules' (boot, a cold instance)
       Calling the third case «degraded» would report an outage that has not
       happened — on a fresh Vercel instance every provider is UNTESTED, and the
       boot log said «serving from degraded:internal-rules» before a single call
       had been made. */
    servingFrom: healthy.length
      ? healthy.map((p) => p.id)
      : (failing.length ? ['degraded:internal-rules'] : ['internal-rules'])
  };
}


// ---------------------------------------------------------------------------
// HTTP Request Helper
// ---------------------------------------------------------------------------

async function httpReq(url, options, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Provider Specific Chat Implementations
// ---------------------------------------------------------------------------

/** OpenAI Compatible Chat (OpenRouter, Groq, DeepSeek, Mistral, AIMLAPI) */
async function callOpenAICompatible({ url, apiKey, model, system, user, temperature = 0.3, maxTokens = 800, json = false, extraHeaders = {}, timeout = TIMEOUT_MS }) {
  assertNoSecretsInPayload({ system, user });
  const sanitizedSystem = sanitizePrompt(system);
  const sanitizedUser = sanitizePrompt(user);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...extraHeaders
  };

  const body = {
    model,
    messages: [
      ...(sanitizedSystem ? [{ role: 'system', content: sanitizedSystem }] : []),
      { role: 'user', content: sanitizedUser }
    ],
    temperature,
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: 'json_object' } } : {})
  };

  const raw = await httpReq(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }, timeout);

  const text = raw?.choices?.[0]?.message?.content;
  if (!text) throw new Error('EMPTY_AI_RESPONSE');
  return String(text).trim();
}

/** Google Gemini Chat */
async function callGemini({ apiKey, model, system, user, temperature = 0.3, maxTokens = 800, json = false, timeout = TIMEOUT_MS }) {
  assertNoSecretsInPayload({ system, user });
  const sanitizedSystem = sanitizePrompt(system);
  const sanitizedUser = sanitizePrompt(user);

  /*
   * The key moves in a header now, not in the query string. `?key=…` puts a
   * billable secret into every access log, every proxy log and every error
   * message that quotes a URL; `x-goog-api-key` is the same credential on the
   * channel Google documents for REST callers.
   */
  const url = `${PROVIDER_CONFIGS.gemini.url}/${model}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: sanitizedUser }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: 'application/json' } : {})
    }
  };

  if (sanitizedSystem) {
    body.systemInstruction = { parts: [{ text: sanitizedSystem }] }
  }

  const raw = await httpReq(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  }, timeout);

  const blocked = raw?.promptFeedback?.blockReason;
  if (blocked) throw new Error(`EMPTY_GEMINI_RESPONSE: blocked (${blocked})`);

  /* A long answer arrives as SEVERAL parts; reading only parts[0] silently
     truncated every structured JSON reply that Google split. */
  const parts = raw?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p?.text ?? '').join('').trim();
  if (!text) throw new Error('EMPTY_GEMINI_RESPONSE');
  return text;
}

/** Anthropic Claude Chat */
async function callAnthropic({ apiKey, model, system, user, temperature = 0.3, maxTokens = 800, timeout = TIMEOUT_MS }) {
  assertNoSecretsInPayload({ system, user });
  const sanitizedSystem = sanitizePrompt(system);
  const sanitizedUser = sanitizePrompt(user);

  const call = (withTemperature) => httpReq(PROVIDER_CONFIGS.anthropic.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      system: sanitizedSystem || undefined,
      messages: [{ role: 'user', content: sanitizedUser }],
      max_tokens: maxTokens,
      ...(withTemperature ? { temperature } : {})
    })
  }, timeout);

  let raw;
  try {
    raw = await call(true);
  } catch (err) {
    /*
     * Current Claude models (Sonnet 5 and the thinking family) run adaptive
     * thinking by default and REJECT non-default sampling parameters: sending
     * `temperature` at all is a 400 invalid_request_error. That is not a dead
     * key — it is one parameter. Retry once without it instead of failing the
     * whole provider over a knob the model does not accept.
     */
    if (classifyAiError(err, 'anthropic').kind === 'ANTHROPIC_SAMPLING') {
      raw = await call(false);
    } else {
      throw err;
    }
  }

  const text = (raw?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text || '').join('').trim();
  if (!text) throw new Error('EMPTY_ANTHROPIC_RESPONSE');
  return text;
}

/** Cloudflare Workers AI (serverless open models via REST run endpoint) */
async function callWorkersAI({ accountId, apiToken, model, system, user, temperature = 0.3, maxTokens = 800, timeout = TIMEOUT_MS }) {
  assertNoSecretsInPayload({ system, user });
  const sanitizedSystem = sanitizePrompt(system);
  const sanitizedUser = sanitizePrompt(user);

  /*
   * ─── THE BUG THAT MADE WORKERS AI ANSWER "No route for that URI" ─────────
   * The model id IS the URL path: the documented endpoint is
   *   /client/v4/accounts/{account_id}/ai/run/@cf/meta/llama-3.1-8b-instruct
   * `encodeURIComponent(model)` turned that into
   *   …/ai/run/%40cf%2Fmeta%2Fllama-3.1-8b-instruct
   * — one opaque path segment, which matches no Cloudflare route, so the API
   * answered HTTP 400 code 7000 for a perfectly valid account, token and
   * model. Only the account id is encoded now; the model keeps its slashes.
   */
  /* The model id keeps its literal `@cf/...` shape (percent-encoding the `@`
     or the slashes is what broke the route), but it is character-whitelisted
     and `..`-free so a hostile model string cannot walk the URL path. */
  const safeModel = String(model || '').trim();
  if (!/^[@A-Za-z0-9][A-Za-z0-9@/._:-]*$/.test(safeModel) || safeModel.includes('..')) {
    throw new Error(`BAD_WORKERSAI_MODEL:${safeModel.slice(0, 60)}`);
  }
  const url = `${PROVIDER_CONFIGS.workersai.url}/${encodeURIComponent(accountId)}/ai/run/${safeModel}`;
  const body = {
    messages: [
      ...(sanitizedSystem ? [{ role: 'system', content: sanitizedSystem }] : []),
      { role: 'user', content: sanitizedUser }
    ],
    temperature,
    max_tokens: maxTokens
  };

  const raw = await httpReq(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`
    },
    body: JSON.stringify(body)
  }, timeout);

  const text = raw?.result?.response;
  if (!text) throw new Error('EMPTY_WORKERSAI_RESPONSE');
  return String(text).trim();
}

/** Internal Deterministic AI Intelligence (Zero External Key Fallback) */
function callInternalEngine({ system = '', user = '', taskType = 'general', json = false }) {
  const query = String(user || '').trim().toLowerCase();
  const sysLower = String(system || '').trim().toLowerCase();
  
  if (json) {
    const isFa = /persian|فارسی|iran/i.test(query) || /persian|فارسی/i.test(sysLower);
    const isWhy = /measured evidence|why|signal:/i.test(query) || /evidence|signal|why/i.test(sysLower);

    if (isWhy) {
      const isBullish = /strong_buy|buy|خرید|bull/i.test(query);
      const isBearish = /strong_sell|sell|فروش|bear/i.test(query);
      if (isFa) {
        return JSON.stringify({
          technical: isBullish
            ? 'شاخص‌های مومنتوم و میانگین‌های متحرک ساختار صعودی را تأیید می‌کنند. حجم معاملات در کف‌های قیمتی حمایت مؤثری نشان می‌دهد.'
            : isBearish
              ? 'میانگین‌های متحرک کوتاه‌مدت زیر سطوح کلیدی قرار گرفته و فشار عرضه در مقاومت‌ها مشاهده می‌شود.'
              : 'نوسان‌نماها در محدوده تعادلی نوسان می‌کنند و رفتار قیمت در فشردگی تثبیت شده است.',
          market: 'حجم معاملات ۲۴ ساعته و نوسان‌پذیری در مقایسه با میانگین‌های تاریخی متعادل و پایدار گزارش شده است.',
          onchain: 'جریان تراکنش‌های بزرگ و رفتار کیف‌پول‌های عمده ثبات موجودی و نبود خروج غیرعادی را تأیید می‌کند.',
          sentiment: 'احساسات عمومی بازار همگام با دامیننس کلی در فاز نظاره‌گری و ارزیابی محتاطانه قرار دارد.',
          conclusion: isBullish
            ? 'ترکیب شواهد فنی و آماری برتری نسبی خریداران را نشان می‌دهد. شکست سطوح حمایتی این ارزیابی را باطل خواهد کرد.'
            : isBearish
              ? 'شواهد ثبت‌شده غلبه نسبی عرضه در مقاومت‌های پیش‌رو را نمایان می‌سازد. رعایت انضباط مدیریت ریسک الزامی است.'
              : 'شواهد فعلی تداوم حرکت رنج را محتمل‌تر می‌داند و ورود جهت‌دار نیازمند شکست معتبر سطوح است.',
          agree: true,
          disagree: false
        });
      }
      return JSON.stringify({
        technical: isBullish
          ? 'Momentum indicators and key moving averages align with an upward bias, backed by sustained volume at local support.'
          : isBearish
            ? 'Shorter moving averages sit below resistance with selling pressure evident near local highs.'
            : 'Oscillators remain centered around neutral territory with price compressing in a defined range.',
        market: 'Reported 24-hour volume and volatility metrics reflect standard operating turnover without erratic distribution.',
        onchain: 'Tracked large transfers and holder metrics indicate steady baseline retention across primary clusters.',
        sentiment: 'Macro sentiment and benchmark dominance corroborate a disciplined, risk-managed stance across sectors.',
        conclusion: isBullish
          ? 'Measured evidence supports constructive upside continuation, conditional on defending documented support levels.'
          : isBearish
            ? 'Measured evidence suggests caution against overhead supply, invalidated by a confirmed volume-supported breakout.'
            : 'Balanced indicators indicate range continuation until confirmed breakout or breakdown evidence appears.',
        agree: true,
        disagree: false
      });
    }

    // Generate structured deterministic outcome based on query
    const isBullish = /bull|صعود|buy|خرید|long|رشد/i.test(query);
    const isBearish = /bear|نزول|sell|فروش|short|افت/i.test(query);
    const bias = isBullish ? 'bullish' : isBearish ? 'bearish' : 'neutral';
    
    return JSON.stringify({
      bias,
      confidence: 75,
      headline: isFa ? 'تحلیل ساختاری مبتنی بر داده‌های درون‌زنجیره‌ای و تکنیکال' : 'Structural analysis based on on-chain and technical data',
      summary: isFa
        ? 'شرایط بازار در محدوده تعادلی قرار دارد. پایش سطوح حمایت و مقاومت و مدیریت دقیق حجم معامله توصیه می‌شود.'
        : 'Market conditions remain balanced. Monitoring key support/resistance levels and active risk management is recommended.',
      range: { low: 0.95, high: 1.05, horizonDays: 7 },
      drivers: isFa
        ? ['نقدینگی استخرهای غیرمتمرکز پایدار است', 'حجم معاملات در محدوده میانگین ۲۰ روزه قرار دارد']
        : ['Decentralized pool liquidity remains stable', 'Trading volume sits within the 20-day average envelope'],
      risks: isFa
        ? ['نوسان ناگهانی ناشی از داده‌های کلان', 'تغییرات نرخ بهره و جریان نقدینگی']
        : ['Macro event volatility spikes', 'Liquidity shifting across neighboring yield opportunities'],
      invalidation: isFa
        ? 'شکست سطح حمایتی معتبر با حجم بالا سناریوی فعلی را بی‌اعتبار می‌کند.'
        : 'High-volume breakdown below verified support invalidates this premise.'
    });
  }

  return 'تحلیل وضعیت انجام شد. برای اجرای دقیق‌تر می‌توانید پارامترهای سرمایه و افق زمانی را مشخص نمایید.';
}

// ---------------------------------------------------------------------------
// Central Dispatcher: executeChat
// ---------------------------------------------------------------------------

/** One attempt against ONE model of one provider. */
async function runProviderModel(providerId, cfg, apiKey, model, { system, user, temperature, maxTokens, json, timeout }) {
  if (providerId === 'internal') {
    return callInternalEngine({ system, user, json });
  }
  if (cfg.type === 'gemini-native') {
    return callGemini({ apiKey, model, system, user, temperature, maxTokens, json, timeout });
  }
  if (cfg.type === 'anthropic-native') {
    return callAnthropic({ apiKey, model, system, user, temperature, maxTokens, timeout });
  }
  if (cfg.type === 'workersai-native') {
    const accountId = getCloudflareAccountId();
    if (!accountId) throw new Error('NO_CLOUDFLARE_ACCOUNT_ID');
    return callWorkersAI({ accountId, apiToken: apiKey, model, system, user, temperature, maxTokens, timeout });
  }
  // OpenAI Compatible (OpenRouter, Groq, DeepSeek, Mistral, AIMLAPI)
  const extraHeaders = {};
  if (providerId === 'openrouter') {
    extraHeaders['HTTP-Referer'] = SITE_URL;
    extraHeaders['X-Title'] = 'FBT Smart Intent OS';
  }
  return callOpenAICompatible({ url: cfg.url, apiKey, model, system, user, temperature, maxTokens, json, extraHeaders, timeout });
}

/**
 * Execute one provider call, trying the provider's CURRENT models in order.
 *
 * This is the piece that was missing. `fallbackModels` existed in the registry
 * and nothing ever read it, so a single retired model id (Groq's
 * llama-3.3-70b-versatile, Gemini's gemini-2.0-flash, Mistral's paid
 * mistral-large-latest on a free tier) took the whole provider down even
 * though the KEY WAS FINE. Now:
 *
 *   · model-level rejections (404 model_not_found, 403 tier_not_allowed,
 *     empty/blocked completion) step to the next candidate model on the SAME
 *     key — a working key is not thrown away because one id went stale;
 *   · account-level rejections (401 auth, 402/credit billing, 403 permission,
 *     429 quota, Cloudflare account/route) stop immediately — no other model
 *     fixes those, and burning three more calls only adds latency;
 *   · every outcome is recorded in the gateway's health store, so the next
 *     request does not re-pay for a failure we already classified.
 */
export async function executeProviderChat(providerId, {
  system = '',
  user = '',
  model = null,
  temperature = 0.3,
  maxTokens = 800,
  json = false,
  timeout = TIMEOUT_MS
} = {}) {
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg) throw new Error(`UNKNOWN_PROVIDER:${providerId}`);

  const startedAt = Date.now();
  const attempts = [];

  if (providerId !== 'internal') {
    const apiKey = getProviderKey(providerId);
    if (!apiKey) {
      const err = new Error(`NO_API_KEY:${providerId}`);
      err.reasonCode = 'AUTH';
      recordProviderCall(providerId, { ok: false, durationMs: 0, model: model || cfg.defaultModel, error: err.message, reasonCode: 'AUTH', fix: `Set ${envNamesFor(cfg).join(' or ')} in the environment, then redeploy.` });
      throw err;
    }

    const candidates = getModelCandidates(providerId, model);
    let lastErr = null;
    let lastClass = null;

    for (const candidate of candidates) {
      try {
        const text = await runProviderModel(providerId, cfg, apiKey, candidate, { system, user, temperature, maxTokens, json, timeout });
        const durationMs = Date.now() - startedAt;
        recordProviderCall(providerId, { ok: true, durationMs, model: candidate });
        return {
          ok: true,
          provider: providerId,
          providerName: cfg.name,
          model: candidate,
          text,
          durationMs,
          attempts,
          /* Which seat the answer really came from: a model, not the rules. */
          engine: 'external-model'
        };
      } catch (err) {
        const cls = classifyAiError(err, providerId);
        attempts.push({ model: candidate, reasonCode: cls.kind, status: cls.status || null, error: cls.message.slice(0, 200) });
        lastErr = err;
        lastClass = cls;
        console.warn(`[ai-gateway] ${providerId}/${candidate} failed (${cls.kind}${cls.status ? ` HTTP ${cls.status}` : ''}): ${cls.message.slice(0, 180)}`);
        if (!cls.retryNextModel) break; // account/key/network problem: another model cannot help
      }
    }

    const durationMs = Date.now() - startedAt;
    recordProviderCall(providerId, {
      ok: false,
      durationMs,
      model: attempts.length ? attempts[attempts.length - 1].model : (model || cfg.defaultModel),
      error: lastClass?.message || String(lastErr?.message || lastErr),
      reasonCode: lastClass?.kind || 'UNKNOWN',
      fix: lastClass?.fix || null
    });

    const out = new Error(lastClass?.message || String(lastErr?.message || lastErr));
    out.status = lastClass?.status || lastErr?.status || 0;
    out.reasonCode = lastClass?.kind || 'UNKNOWN';
    out.fix = lastClass?.fix || null;
    out.provider = providerId;
    out.attempts = attempts;
    throw out;
  }

  const text = callInternalEngine({ system, user, json });
  return {
    ok: true,
    provider: 'internal',
    providerName: cfg.name,
    model: cfg.defaultModel,
    text,
    durationMs: Date.now() - startedAt,
    attempts,
    /* Honest label: this is the deterministic rule engine, not a model. */
    engine: 'internal-rules'
  };
}

// ---------------------------------------------------------------------------
// Cost-Aware & Specialty-Aware Provider Routing
// ---------------------------------------------------------------------------

/**
 * Priority order by task type. Every route below is built ONLY from providers
 * that are still registered — Grok, OpenAI and Perplexity were removed (no key
 * on this deployment), so the jobs they used to head are reassigned:
 *
 *   market     (was Grok → Perplexity)  → OpenRouter → Gemini → Groq → DeepSeek
 *   research   (was Perplexity)         → OpenRouter → Gemini → Groq → DeepSeek
 *   reasoning  (was … → OpenAI → Grok)  → OpenRouter → Anthropic → DeepSeek → AIMLAPI
 *   fast       (was … → OpenAI)         → Workers AI → Groq → Gemini → Mistral → AIMLAPI
 *   default    (was Grok → …)           → OpenRouter → Groq → Gemini → Workers AI …
 *
 * - market: OpenRouter -> Gemini -> Groq -> DeepSeek -> AIMLAPI -> Workers AI -> Internal
 * - research: OpenRouter -> Gemini -> Groq -> DeepSeek -> AIMLAPI -> Workers AI -> Internal
 * - reasoning: OpenRouter -> Anthropic -> DeepSeek -> Gemini -> AIMLAPI -> Workers AI -> Internal
 * - risk: Anthropic -> DeepSeek -> OpenRouter -> AIMLAPI -> Gemini -> Groq -> Workers AI -> Internal
 * - fast / intent: Workers AI -> Groq -> Gemini -> Mistral -> AIMLAPI -> OpenRouter -> Internal
 * - default: OpenRouter -> Groq -> Gemini -> Workers AI -> AIMLAPI -> DeepSeek -> Anthropic -> Mistral -> Internal
 */
export function getPreferredProvidersForTask(taskType = 'general', { configuredOnly = false } = {}) {
  const type = String(taskType).toLowerCase();
  let candidateOrder = [];

  switch (type) {
    case 'market':
    case 'market_intelligence':
    case 'crypto_trend':
      // Grok's market/macro seat and Perplexity's search-grounded market notes
      // both moved to OpenRouter, with Gemini and Groq behind it.
      candidateOrder = ['openrouter', 'gemini', 'groq', 'deepseek', 'aimlapi', 'workersai', 'internal'];
      break;
    case 'research':
    case 'news':
    case 'web_research':
    case 'crypto-analysis':
      // Perplexity's old job: sourced, web-grounded answers. OpenRouter's
      // online-capable models lead; Gemini backs it up.
      candidateOrder = ['openrouter', 'gemini', 'groq', 'deepseek', 'aimlapi', 'workersai', 'internal'];
      break;
    case 'reasoning':
    case 'complex_plan':
    case 'portfolio_optimization':
      // OpenAI's high-precision logic seat is covered by Anthropic, DeepSeek
      // and AIMLAPI; Grok's slot drops out.
      candidateOrder = ['openrouter', 'anthropic', 'deepseek', 'gemini', 'aimlapi', 'workersai', 'internal'];
      break;
    case 'risk':
    case 'guardian':
    case 'verification':
      candidateOrder = ['anthropic', 'deepseek', 'openrouter', 'aimlapi', 'gemini', 'groq', 'workersai', 'internal'];
      break;
    case 'intent':
    case 'fast':
    case 'classification':
      candidateOrder = ['workersai', 'groq', 'gemini', 'mistral', 'aimlapi', 'openrouter', 'internal'];
      break;
    default:
      candidateOrder = ['openrouter', 'groq', 'gemini', 'workersai', 'aimlapi', 'deepseek', 'anthropic', 'mistral', 'internal'];
      break;
  }

  if (!configuredOnly) {
    return candidateOrder;
  }

  // Filter to only configured providers
  const active = candidateOrder.filter(isProviderConfigured);
  if (!active.includes('internal')) active.push('internal');
  return active;
}

/**
 * Execute chat with automatic failover across preferred providers.
 */
export async function routedChat({
  taskType = 'general',
  system = '',
  user = '',
  preferredProvider = null,
  model = null,
  temperature = 0.3,
  maxTokens = 800,
  json = false,
  allowInternalFallback = true
} = {}) {
  /*
   * `AI_PRIMARY_PROVIDER` is the operator lever: one environment variable pins
   * the seat that answers first, without a code change or a redeploy of logic.
   * On the live deployment (only OpenRouter answering) setting
   * AI_PRIMARY_PROVIDER=openrouter removes every wasted failover hop.
   */
  const envPrimary = normalizeSecretValue(process.env.AI_PRIMARY_PROVIDER).toLowerCase();
  const primary = preferredProvider || (PROVIDER_CONFIGS[envPrimary] ? envPrimary : null);

  const taskOrder = getPreferredProvidersForTask(taskType, { configuredOnly: true }).filter((p) => p !== primary && p !== 'internal');
  const ordered = primary && isProviderConfigured(primary) ? [primary, ...taskOrder] : taskOrder;
  /*
   * Health-aware, not just preference-aware. Before this, a `fast` task walked
   * workersai → groq → gemini → mistral → aimlapi → openrouter on EVERY
   * request: five classified, deterministic failures re-paid each time before
   * the one working provider answered. Providers we have already proven good
   * go first; providers we have already proven broken go last (still tried —
   * a parked provider is never deleted, because billing gets topped up and
   * rate-limit windows reset).
   */
  const candidates = orderByHealth(ordered);

  const errors = [];

  for (const providerId of candidates) {
    try {
      const res = await executeProviderChat(providerId, {
        system,
        user,
        model: providerId === primary ? model : null,
        temperature,
        maxTokens,
        json
      });
      return {
        ...res,
        taskType,
        requestedProvider: primary,
        triedBefore: errors,
        failoverTrail: errors
      };
    } catch (err) {
      console.warn(`[ai-gateway] Provider ${providerId} failed (${err?.reasonCode || 'UNKNOWN'}):`, String(err.message || err).slice(0, 180));
      errors.push({
        provider: providerId,
        reasonCode: err?.reasonCode || 'UNKNOWN',
        error: String(err.message || err).slice(0, 160),
        fix: err?.fix || null,
        attempts: err?.attempts || []
      });
    }
  }

  if (!allowInternalFallback) {
    const err = new Error('ALL_PROVIDERS_FAILED');
    err.reasonCode = 'ALL_PROVIDERS_FAILED';
    err.failoverTrail = errors;
    throw err;
  }

  // If everything failed, call internal engine as ultimate safe guarantee
  const internalRes = await executeProviderChat('internal', { system, user, json });
  return {
    ...internalRes,
    taskType,
    requestedProvider: primary,
    failoverTrail: errors,
    triedBefore: errors,
    degraded: true,
    /*
     * Never let a rule-engine answer wear a model's clothes. Every caller that
     * renders this text also gets a sentence saying which brain produced it, so
     * «هوش مصنوعی جواب داد» is only ever claimed when a model answered.
     */
    degradedReason: errors.length ? errors[0].reasonCode : 'NO_EXTERNAL_PROVIDER',
    notice: {
      fa: 'پاسخ از موتور قاعده‌محور داخلی است، نه از یک مدل زنده. هیچ‌کدام از ارائه‌دهندگان کلید‌دار پاسخ ندادند.',
      en: 'This answer came from the internal rule engine, not a live model. No keyed provider answered.'
    }
  };
}

/**
 * Parallel Multi-Provider Query (for Debate, Consensus, and Multi-Agent Reasoning).
 */
export async function parallelMultiProviderChat({
  // Grok's debate seat is gone; OpenRouter, Gemini and Anthropic are the
  // three configured providers with the widest disagreement, which is the
  // point of a debate.
  providers = ['openrouter', 'gemini', 'anthropic'],
  system = '',
  user = '',
  temperature = 0.3,
  maxTokens = 800,
  json = true
} = {}) {
  /* Health-aware here too: a debate that spends its three seats on providers
     we already know are parked is not a debate, it is a delay. */
  let activeProviders = orderByHealth(providers.filter(isProviderConfigured));
  if (!activeProviders.length) activeProviders = ['internal'];

  const promises = activeProviders.map(async (pId) => {
    try {
      return await executeProviderChat(pId, { system, user, temperature, maxTokens, json });
    } catch (err) {
      return {
        ok: false,
        provider: pId,
        error: String(err.message || err).slice(0, 200),
        reasonCode: err?.reasonCode || 'UNKNOWN',
        fix: err?.fix || null,
        durationMs: 0
      };
    }
  });

  const results = await Promise.all(promises);
  return results;
}

// ---------------------------------------------------------------------------
// Gateway Diagnostics & Self-Test
// ---------------------------------------------------------------------------

const SELFTEST_DEADLINE_MS = Number(process.env.AI_SELFTEST_DEADLINE_MS || 45000);

/**
 * Live self-test: really calls every configured provider and reports WHY each
 * one failed, classified, with the fix.
 *
 * Providers are probed in PARALLEL under one deadline. Sequentially, nine
 * providers × up to three model candidates each could not finish inside the
 * serverless function's 60s budget — which is exactly why a diagnostic that
 * exists to answer «چرا وصل نمی‌شود؟» was itself timing out.
 */
export async function gatewaySelfTest() {
  const started = Date.now();
  const providers = getAvailableProviders();
  const activeIds = getActiveProviderIds();

  const probe = async (p) => {
    if (!p.configured) {
      return {
        id: p.id,
        name: p.name,
        status: 'UNCONFIGURED',
        reasonCode: 'NEEDS_KEY',
        reason: 'No API Key in environment',
        fix: `Set ${p.envVar} in the environment, then redeploy.`,
        envVar: p.envVar
      };
    }
    const start = Date.now();
    try {
      const res = await executeProviderChat(p.id, {
        system: 'Reply with the single word: OK',
        user: 'ping',
        maxTokens: 10,
        temperature: 0,
        json: false,
        timeout: Math.min(TIMEOUT_MS, Math.max(5000, SELFTEST_DEADLINE_MS - (Date.now() - started)))
      });
      return {
        id: p.id,
        name: p.name,
        status: 'HEALTHY',
        model: res.model,
        engine: res.engine,
        latencyMs: res.durationMs,
        sample: String(res.text || '').slice(0, 30),
        modelsTried: (res.attempts || []).map((a) => a.model),
        envVar: p.envVar,
        keySourceEnv: p.keySourceEnv
      };
    } catch (err) {
      const cls = classifyAiError(err, p.id);
      return {
        id: p.id,
        name: p.name,
        status: 'ERROR',
        reasonCode: err?.reasonCode || cls.kind,
        error: String(err.message || err).slice(0, 220),
        fix: err?.fix || cls.fix,
        /* Which models were tried, so "the key is fine but every id is stale"
           is distinguishable from "the key is rejected" at a glance. */
        modelsTried: (err?.attempts || []).map((a) => ({ model: a.model, reasonCode: a.reasonCode, status: a.status })),
        latencyMs: Date.now() - start,
        envVar: p.envVar,
        keySourceEnv: p.keySourceEnv,
        keyDirtyInEnv: p.keyDirtyInEnv,
        retryableByCode: Boolean(cls.retryNextModel)
      };
    }
  };

  const testResults = await Promise.all(providers.map(probe));

  const healthy = testResults.filter((r) => r.status === 'HEALTHY');
  const errored = testResults.filter((r) => r.status === 'ERROR');
  return {
    ok: true,
    gatewayVersion: 'fbt.ai-gateway.v3.0',
    totalConfigured: activeIds.length,
    activeProviderIds: activeIds,
    providers: testResults,
    summary: {
      ...getFleetSummary(),
      healthyCount: healthy.length,
      errorCount: errored.length,
      unconfiguredCount: testResults.filter((r) => r.status === 'UNCONFIGURED').length,
      /* The single number that answers the operator's question: how many of
         the keyed providers can actually serve a request right now. */
      usableExternalModels: healthy.filter((r) => r.id !== 'internal').length
    },
    durationMs: Date.now() - started,
    truncated: Date.now() - started >= SELFTEST_DEADLINE_MS,
    timestamp: Date.now()
  };
}
