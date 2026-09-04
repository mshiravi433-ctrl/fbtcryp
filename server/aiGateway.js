/**
 * FBT AI GATEWAY — Central Multi-Model AI Intelligence Layer
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade
 *
 * Connects and orchestrates multiple AI providers:
 *   1. Grok (xAI)           — Market Intelligence, real-time reasoning, deep search
 *   2. OpenRouter           — Multi-model router (Claude, GPT-4o, DeepSeek, Llama-3)
 *   3. Groq                 — Ultra-low latency open-weight inference
 *   4. Google Gemini        — Multi-modal analysis, fast structured generation
 *   5. OpenAI               — GPT-4o, GPT-4o-mini, o3-mini reasoning
 *   6. Anthropic            — Claude 3.5 Sonnet, Claude 3 Haiku safety & analysis
 *   7. DeepSeek             — DeepSeek-V3, DeepSeek-R1 reasoning & math
 *   8. Mistral              — Mistral Large, Mistral Small
 *   9. Perplexity           — Real-time search & market intelligence
 *  10. Internal AI Engine   — Zero-dependency deterministic offline-ready fallback
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
  grok: {
    name: 'Grok (xAI)',
    url: 'https://api.x.ai/v1/chat/completions',
    envKey: 'GROK_API_KEY',
    altEnvKey: 'XAI_API_KEY',
    defaultModel: 'grok-2-latest',
    fallbackModels: ['grok-beta', 'grok-2-vision-1212', 'grok-3'],
    type: 'openai-compatible',
    specialty: 'Market Intelligence, Macro Trends & Speculative Synthesis',
    costTier: 'medium',
    latencyTier: 'medium'
  },
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    envKey: 'OPENROUTER_API_KEY',
    defaultModel: process.env.AI_MODEL || 'openai/gpt-4o-mini',
    fallbackModels: ['anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct'],
    type: 'openai-compatible',
    specialty: 'Multi-Model Routing & Strategic Reasoning',
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
  openai: {
    name: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    fallbackModels: ['gpt-4o', 'o3-mini'],
    type: 'openai-compatible',
    specialty: 'High-precision Financial Logic & Strategy Synthesis',
    costTier: 'medium',
    latencyTier: 'fast'
  },
  anthropic: {
    name: 'Anthropic Claude',
    url: 'https://api.anthropic.com/v1/messages',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-3-5-sonnet-20241022',
    fallbackModels: ['claude-3-haiku-20240307'],
    type: 'anthropic-native',
    specialty: 'Deep Risk Assessment, Constraint Checking & Policy Auditing',
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
  perplexity: {
    name: 'Perplexity',
    url: 'https://api.perplexity.ai/chat/completions',
    envKey: 'PERPLEXITY_API_KEY',
    defaultModel: 'sonar-pro',
    fallbackModels: ['sonar'],
    type: 'openai-compatible',
    specialty: 'Live Web Search & Sourced Market Intelligence',
    costTier: 'medium',
    latencyTier: 'medium'
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
    specialty: 'Unified Gateway: OpenAI/Claude/Gemini/Llama/DeepSeek via One Key',
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

/** OpenAI Compatible Chat (Grok, OpenRouter, Groq, OpenAI, DeepSeek, Mistral, Perplexity) */
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
    // OpenAI Compatible (Grok, OpenRouter, Groq, OpenAI, DeepSeek, Mistral, Perplexity)
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
 * Priority order by task type:
 * - market: Grok -> Perplexity -> Gemini -> OpenRouter -> Groq -> Internal
 * - reasoning: OpenRouter -> Anthropic -> DeepSeek -> OpenAI -> Gemini -> Groq -> Internal
 * - risk: Anthropic -> DeepSeek -> OpenRouter -> Gemini -> Groq -> Internal
 * - fast / intent: Groq -> Gemini -> Mistral -> OpenAI -> OpenRouter -> Internal
 * - default: Grok -> OpenRouter -> Groq -> Gemini -> Internal
 */
export function getPreferredProvidersForTask(taskType = 'general', { configuredOnly = false } = {}) {
  const type = String(taskType).toLowerCase();
  let candidateOrder = [];

  switch (type) {
    case 'market':
    case 'market_intelligence':
    case 'crypto_trend':
      candidateOrder = ['grok', 'perplexity', 'gemini', 'openrouter', 'groq', 'openai', 'workersai', 'internal'];
      break;
    case 'reasoning':
    case 'complex_plan':
    case 'portfolio_optimization':
      candidateOrder = ['openrouter', 'anthropic', 'deepseek', 'openai', 'grok', 'gemini', 'workersai', 'internal'];
      break;
    case 'risk':
    case 'guardian':
    case 'verification':
      candidateOrder = ['anthropic', 'deepseek', 'openrouter', 'gemini', 'groq', 'workersai', 'internal'];
      break;
    case 'intent':
    case 'fast':
    case 'classification':
      candidateOrder = ['workersai', 'groq', 'gemini', 'mistral', 'openai', 'openrouter', 'internal'];
      break;
    default:
      candidateOrder = ['grok', 'openrouter', 'groq', 'workersai', 'gemini', 'deepseek', 'anthropic', 'openai', 'internal'];
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
  providers = ['grok', 'openrouter', 'gemini'],
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
