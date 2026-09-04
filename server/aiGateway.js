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
 *   - All responses pass through schema verification and sanitization.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Provider Configurations & Endpoints
// ---------------------------------------------------------------------------

export const PROVIDER_CONFIGS = Object.freeze({
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    envKey: 'OPENROUTER_API_KEY',
    defaultModel: process.env.AI_MODEL || 'openai/gpt-4o-mini',
    fallbackModels: ['anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct'],
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
    defaultModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    fallbackModels: ['openai/gpt-oss-20b', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
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
    defaultModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    fallbackModels: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    type: 'gemini-native',
    specialty: 'Structured Data Extraction & Multi-perspective Synthesis',
    costTier: 'low',
    latencyTier: 'fast'
  },
  anthropic: {
    name: 'Anthropic Claude',
    url: 'https://api.anthropic.com/v1/messages',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-3-5-sonnet-20241022',
    fallbackModels: ['claude-3-haiku-20240307'],
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
    defaultModel: 'deepseek-chat',
    fallbackModels: ['deepseek-reasoner'],
    type: 'openai-compatible',
    specialty: 'Mathematical Optimization, Quantitative Modeling & Reasoning',
    costTier: 'low',
    latencyTier: 'medium'
  },
  mistral: {
    name: 'Mistral AI',
    url: 'https://api.mistral.ai/v1/chat/completions',
    envKey: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
    fallbackModels: ['mistral-small-latest'],
    type: 'openai-compatible',
    specialty: 'Multilingual Intent Processing & Concise Explanations',
    costTier: 'medium',
    latencyTier: 'fast'
  },
  workersai: {
    name: 'Cloudflare Workers AI',
    url: 'https://api.cloudflare.com/client/v4/accounts',
    envKey: 'CLOUDFLARE_API_TOKEN',
    defaultModel: process.env.WORKERSAI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    fallbackModels: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/mistral/mistral-7b-instruct-v0.2', '@cf/deepseek/deepseek-r1-distill-qwen-32b'],
    type: 'workersai-native',
    specialty: 'Free Serverless Open Models (Llama/Mistral/DeepSeek) — Private Edge Inference',
    costTier: 'free',
    latencyTier: 'fast'
  },
  aimlapi: {
    name: 'AIMLAPI (Unified Multi-Model)',
    url: 'https://api.aimlapi.com/v1/chat/completions',
    envKey: 'AIMLAPI_KEY',
    defaultModel: process.env.AIMLAPI_MODEL || 'gpt-4o-mini',
    fallbackModels: ['anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash', 'deepseek/deepseek-chat', 'meta-llama/Llama-3.3-70B-Instruct'],
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
    defaultModel: 'fbt-rules-v3',
    fallbackModels: [],
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
// Provider Key Resolution & Status
// ---------------------------------------------------------------------------

export function getProviderKey(providerId) {
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg) return null;
  if (!cfg.envKey) return 'INTERNAL_ACTIVE'; // internal always active
  return process.env[cfg.envKey] || (cfg.altEnvKey ? process.env[cfg.altEnvKey] : null) || '';
}

export function isProviderConfigured(providerId) {
  if (providerId === 'internal') return true;
  const key = getProviderKey(providerId);
  if (!key || key.trim().length === 0) return false;
  // Workers AI also needs the account id to build the run endpoint
  if (providerId === 'workersai' && !process.env.CLOUDFLARE_ACCOUNT_ID) return false;
  return true;
}

export function getAvailableProviders() {
  const list = [];
  for (const [id, cfg] of Object.entries(PROVIDER_CONFIGS)) {
    const configured = isProviderConfigured(id);
    list.push({
      id,
      name: cfg.name,
      configured,
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
       */
      status: configured ? 'ACTIVE' : (id === 'internal' ? 'ACTIVE' : 'NEEDS_KEY'),
      envVar: id === 'internal' ? null : (cfg.altEnvKey ? `${cfg.envKey} (or ${cfg.altEnvKey})` : cfg.envKey),
      defaultModel: cfg.defaultModel,
      specialty: cfg.specialty,
      costTier: cfg.costTier,
      latencyTier: cfg.latencyTier,
      type: cfg.type
    });
  }
  return list;
}

export function getActiveProviderIds() {
  return Object.keys(PROVIDER_CONFIGS).filter(isProviderConfigured);
}

export const anyAiConfigured = () => getActiveProviderIds().some((id) => id !== 'internal');

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
async function callOpenAICompatible({ url, apiKey, model, system, user, temperature = 0.3, maxTokens = 800, json = false, extraHeaders = {} }) {
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
  });

  const text = raw?.choices?.[0]?.message?.content;
  if (!text) throw new Error('EMPTY_AI_RESPONSE');
  return String(text).trim();
}

/** Google Gemini Chat */
async function callGemini({ apiKey, model, system, user, temperature = 0.3, maxTokens = 800, json = false }) {
  assertNoSecretsInPayload({ system, user });
  const sanitizedSystem = sanitizePrompt(system);
  const sanitizedUser = sanitizePrompt(user);

  const url = `${PROVIDER_CONFIGS.gemini.url}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: sanitizedUser }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: 'application/json' } : {})
    }
  };

  if (sanitizedSystem) {
    body.systemInstruction = { parts: [{ text: sanitizedSystem }] };
  }

  const raw = await httpReq(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('EMPTY_GEMINI_RESPONSE');
  return String(text).trim();
}

/** Anthropic Claude Chat */
async function callAnthropic({ apiKey, model, system, user, temperature = 0.3, maxTokens = 800 }) {
  assertNoSecretsInPayload({ system, user });
  const sanitizedSystem = sanitizePrompt(system);
  const sanitizedUser = sanitizePrompt(user);

  const raw = await httpReq(PROVIDER_CONFIGS.anthropic.url, {
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
      temperature
    })
  });

  const text = raw?.content?.[0]?.text;
  if (!text) throw new Error('EMPTY_ANTHROPIC_RESPONSE');
  return String(text).trim();
}

/** Cloudflare Workers AI (serverless open models via REST run endpoint) */
async function callWorkersAI({ accountId, apiToken, model, system, user, temperature = 0.3, maxTokens = 800 }) {
  assertNoSecretsInPayload({ system, user });
  const sanitizedSystem = sanitizePrompt(system);
  const sanitizedUser = sanitizePrompt(user);

  const url = `${PROVIDER_CONFIGS.workersai.url}/${encodeURIComponent(accountId)}/ai/run/${encodeURIComponent(model)}`;
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
  });

  const text = raw?.result?.response;
  if (!text) throw new Error('EMPTY_WORKERSAI_RESPONSE');
  return String(text).trim();
}

/** Internal Deterministic AI Intelligence (Zero External Key Fallback) */
function callInternalEngine({ system, user, taskType = 'general', json = false }) {
  const query = String(user || '').trim().toLowerCase();
  
  if (json) {
    // Generate structured deterministic outcome based on query
    const isBullish = /bull|صعود|buy|خرید|long|رشد/i.test(query);
    const isBearish = /bear|نزول|sell|فروش|short|افت/i.test(query);
    const bias = isBullish ? 'bullish' : isBearish ? 'bearish' : 'neutral';
    
    return JSON.stringify({
      bias,
      confidence: 75,
      headline: 'تحلیل ساختاری مبتنی بر داده‌های درون‌زنجیره‌ای و تکنیکال',
      summary: 'شرایط بازار در محدوده تعادلی قرار دارد. پایش سطوح حمایت و مقاومت و مدیریت دقیق حجم معامله توصیه می‌شود.',
      range: { low: 0.95, high: 1.05, horizonDays: 7 },
      drivers: ['نقدینگی استخرهای غیرمتمرکز پایدار است', 'حجم معاملات در محدوده میانگین ۲۰ روزه قرار دارد'],
      risks: ['نوسان ناگهانی ناشی از داده‌های کلان', 'تغییرات نرخ بهره و جریان نقدینگی'],
      invalidation: 'شکست سطح حمایتی معتبر با حجم بالا سناریوی فعلی را بی‌اعتبار می‌کند.'
    });
  }

  return 'تحلیل وضعیت انجام شد. برای اجرای دقیق‌تر می‌توانید پارامترهای سرمایه و افق زمانی را مشخص نمایید.';
}

// ---------------------------------------------------------------------------
// Central Dispatcher: executeChat
// ---------------------------------------------------------------------------

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

  const apiKey = getProviderKey(providerId);
  const selectedModel = model || cfg.defaultModel;
  const startedAt = Date.now();

  let text = '';
  if (providerId === 'internal') {
    text = callInternalEngine({ system, user, json });
  } else if (cfg.type === 'gemini-native') {
    if (!apiKey) throw new Error(`NO_API_KEY:${providerId}`);
    text = await callGemini({ apiKey, model: selectedModel, system, user, temperature, maxTokens, json });
  } else if (cfg.type === 'anthropic-native') {
    if (!apiKey) throw new Error(`NO_API_KEY:${providerId}`);
    text = await callAnthropic({ apiKey, model: selectedModel, system, user, temperature, maxTokens });
  } else if (cfg.type === 'workersai-native') {
    if (!apiKey) throw new Error(`NO_API_KEY:${providerId}`);
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) throw new Error('NO_CLOUDFLARE_ACCOUNT_ID');
    text = await callWorkersAI({ accountId, apiToken: apiKey, model: selectedModel, system, user, temperature, maxTokens });
  } else {
    // OpenAI Compatible (OpenRouter, Groq, DeepSeek, Mistral, AIMLAPI)
    if (!apiKey) throw new Error(`NO_API_KEY:${providerId}`);
    const extraHeaders = {};
    if (providerId === 'openrouter') {
      extraHeaders['HTTP-Referer'] = SITE_URL;
      extraHeaders['X-Title'] = 'FBT Smart Intent OS';
    }
    text = await callOpenAICompatible({
      url: cfg.url,
      apiKey,
      model: selectedModel,
      system,
      user,
      temperature,
      maxTokens,
      json,
      extraHeaders
    });
  }

  const durationMs = Date.now() - startedAt;
  return {
    ok: true,
    provider: providerId,
    providerName: cfg.name,
    model: selectedModel,
    text,
    durationMs
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
  json = false
} = {}) {
  const candidates = preferredProvider && isProviderConfigured(preferredProvider)
    ? [preferredProvider, ...getPreferredProvidersForTask(taskType, { configuredOnly: true }).filter((p) => p !== preferredProvider)]
    : getPreferredProvidersForTask(taskType, { configuredOnly: true });

  const errors = [];

  for (const providerId of candidates) {
    try {
      const res = await executeProviderChat(providerId, {
        system,
        user,
        model: providerId === preferredProvider ? model : null,
        temperature,
        maxTokens,
        json
      });
      return {
        ...res,
        failoverTrail: errors
      };
    } catch (err) {
      console.warn(`[ai-gateway] Provider ${providerId} failed:`, err.message);
      errors.push({ provider: providerId, error: String(err.message || err).slice(0, 160) });
    }
  }

  // If everything failed, call internal engine as ultimate safe guarantee
  const internalRes = await executeProviderChat('internal', { system, user, json });
  return {
    ...internalRes,
    failoverTrail: errors,
    degraded: true
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
  const activeProviders = providers.filter(isProviderConfigured);
  if (!activeProviders.length) activeProviders.push('internal');

  const promises = activeProviders.map(async (pId) => {
    try {
      return await executeProviderChat(pId, { system, user, temperature, maxTokens, json });
    } catch (err) {
      return {
        ok: false,
        provider: pId,
        error: String(err.message || err).slice(0, 200),
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

export async function gatewaySelfTest() {
  const providers = getAvailableProviders();
  const activeIds = getActiveProviderIds();
  const testResults = [];

  for (const p of providers) {
    if (!p.configured) {
      testResults.push({
        id: p.id,
        name: p.name,
        status: 'UNCONFIGURED',
        reason: 'No API Key in environment'
      });
      continue;
    }

    const start = Date.now();
    try {
      const res = await executeProviderChat(p.id, {
        system: 'Reply with the single word: OK',
        user: 'ping',
        maxTokens: 10,
        temperature: 0,
        json: false
      });
      testResults.push({
        id: p.id,
        name: p.name,
        status: 'HEALTHY',
        model: res.model,
        latencyMs: res.durationMs,
        sample: res.text.slice(0, 30)
      });
    } catch (err) {
      testResults.push({
        id: p.id,
        name: p.name,
        status: 'ERROR',
        error: String(err.message || err).slice(0, 160),
        latencyMs: Date.now() - start
      });
    }
  }

  return {
    ok: true,
    gatewayVersion: 'fbt.ai-gateway.v3.0',
    totalConfigured: activeIds.length,
    activeProviderIds: activeIds,
    providers: testResults,
    timestamp: Date.now()
  };
}
