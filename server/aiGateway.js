/**
 * FBT AI GATEWAY — Central Multi-Model AI Intelligence Layer
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade
 *
 * Connects and orchestrates multiple AI providers:
 *   1. OpenRouter           — Multi-model router (Claude, GPT-4o, DeepSeek, Llama-3)
 *   2. OpenAI               — GPT direct (reasoning, finance logic)
 *   3. Anthropic            — Claude direct (risk, policy, long documents)
 *   4. Google Gemini        — Multi-modal analysis, fast structured generation
 *   5. xAI Grok             — Real-time news and social-signal analysis
 *   6. DeepSeek             — DeepSeek-V3/R1 reasoning & math
 *   7. Groq                 — Ultra-low latency open-weight inference
 *   8. Mistral              — Mistral Large, Mistral Small
 *   9. Cloudflare Workers AI — Free serverless open models (Llama/Mistral/DeepSeek)
 *  10. AIMLAPI              — Unified multi-model gateway behind one key
 *  11. Internal AI Engine   — Zero-dependency deterministic offline-ready fallback
 *
 * ─── DIRECT vs GATEWAY, AND WHY BOTH ARE TESTED SEPARATELY ─────────────────
 * OpenRouter is a GATEWAY, not a model: one OpenRouter key can answer with a
 * GPT, a Claude, a Gemini or a DeepSeek model. That is useful and it is NOT
 * proof that xAI or OpenAI is reachable — which is exactly the confusion the
 * benchmark suite has to avoid.
 *
 * So OpenAI (GPT) and xAI (Grok) are registered DIRECTLY again, deliberately.
 * They were removed on 2026-09-25 because no key was present on that
 * deployment and every route to them burned a failover hop; the panel now has
 * a `NEEDS_KEY` state that names the env var, so a registered-but-unconfigured
 * provider is honest instead of invisible. `routedChat` filters on
 * `isProviderConfigured`, so an absent key costs nothing at request time.
 * `providerLab` tests the direct endpoint AND the OpenRouter gateway route
 * separately, so "OpenRouter works" can never be reported as "Grok is
 * connected".
 *
 * Perplexity stays out: its sourced-web-search job is carried by OpenRouter's
 * online-capable models plus the app's own research path, and no Perplexity
 * key exists anywhere in this deployment.
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
import {
  getIntelligenceProfile,
  normalizeIntelligenceMode,
  intelligenceModelLadder,
  intelligenceProviderOrder,
  intelligenceGeneration,
  intelligenceReasoningFields,
  intelligenceGeminiThinking,
  intelligenceAnthropicThinking,
  intelligenceDeadlineMs,
  turnCeilingMs,
  resolveIntelligenceMode,
  describeIntelligence
} from './aiIntelligence.js';
import {
  isProviderInFleet,
  providerFleetExclusion,
  describeProviderFleet,
  resolveProviderFleet,
  DEFAULT_PROVIDER_FLEET
} from './aiProviderFleet.js';
import { spendQuota } from './aiQuotaBudget.js';
/* The deployment's own durable store. Imported for the same reason
   `aiAnswerCache` imports it: a memory that lives only in this process dies with
   the instance, and on a serverless platform that is every few minutes. */
import { blobConfigured as durableStoreConfigured } from './blobCache.js';
import { aiAnswerCacheStats } from './aiAnswerCache.js';
import { lastReasoningLedger } from './aiReasoningLedger.js';
import { cortexBridgeStatus } from './aiCortexBridge.js';

/* Re-exported so every consumer of the gateway can describe the mode it used
   without importing a second module. */
export { describeIntelligence };
/* …and so can describe the fleet it is allowed to call. */
export { describeProviderFleet, DEFAULT_PROVIDER_FLEET };
/* The central brain needs the resolved mode and the flagship ladders to name
   the ids its seats will actually call; both live in aiIntelligence. */
export { resolveIntelligenceMode, intelligenceModelLadder };
/* …and so does the latency budget that mode is allowed, clamped to the wall
   clock the platform will actually give us. */
export { intelligenceDeadlineMs, turnCeilingMs };

/*
 * `baseModel` on every seat is that provider's historical default with NO env
 * pin. `max` uses it to tell a deliberate operator choice apart from a stale
 * copy of the cheap model — see `getModelCandidates` and `describeModelPin`.
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
    baseModel: 'openai/gpt-4o-mini',
    defaultModel: process.env.AI_MODEL || 'openai/gpt-4o-mini',
    fallbackModels: [
      'google/gemini-2.5-flash',
      'deepseek/deepseek-chat',
      'anthropic/claude-3.5-haiku',
      'meta-llama/llama-3.3-70b-instruct',
      /* The flagship spellings used by the smartest-mode ladder live here too,
         so the fleet panel lists them and the retired-model guard checks them.
         They sit at the END: the historical failover order is unchanged. */
      'google/gemini-2.5-pro',
      'openai/gpt-4.1',
      'anthropic/claude-sonnet-4-6',
      'x-ai/grok-4'
    ],
    type: 'openai-compatible',
    // Also carries the market-intelligence and live-search duties that used to
    // sit on Grok and Perplexity: OpenRouter can route to online-capable
    // models, so it is the honest home for both once those keys are absent.
    specialty: 'Multi-Model Routing, Market Intelligence & Live Search-Grounded Synthesis',
    costTier: 'medium',
    latencyTier: 'medium'
  },
  /*
   * ═══ THE FREE SEAT OF OPENROUTER ═════════════════════════════════════════
   *
   * WHY THIS IS A SEPARATE PROVIDER AND NOT A FLAG ON `openrouter`
   * ---------------------------------------------------------------------
   * The deployment's OpenRouter key is on the FREE tier. Every model id the
   * `openrouter` seat knows — `openai/gpt-4o-mini`, `google/gemini-2.5-pro`,
   * `anthropic/claude-sonnet-4-6`, `x-ai/grok-4` — is a PAID id. A free key
   * calling a paid id answers HTTP 402 "Insufficient Balance", which the
   * gateway classifies as BILLING: an ACCOUNT-level failure that stops the
   * model walk immediately instead of stepping to the next id. So the paid
   * seat spent a round-trip on every request, burned CPU, and produced
   * nothing — the free capacity the key actually has was never reachable,
   * because the registry contained no `:free` id at all.
   *
   * Making it a flag on `openrouter` would have been worse: the same key
   * would then have to be trusted to serve a PAID id, so a key that was
   * topped up would silently change which model answered. Two seats, one
   * key, two honest model lists: the operator chooses by declaring the
   * fleet (`FBT_AI_PROVIDERS`), not by hoping a request lands on the right
   * id.
   *
   * WHY THESE SPECIFIC IDS
   * ---------------------------------------------------------------------
   * The free catalog churns — ids appear and disappear, and a withdrawn id
   * answers 404 forever. So this list is deliberately short, and every id
   * in it was verified to answer on the free tier in November 2026:
   *
   *   · nvidia/nemotron-3.5-super-vl:free — the strongest all-rounder in the
   *     free catalog: 1M context, and the only one that passed JSON
   *     extraction, a tool call and a small coding task on every attempt
   *     across a 10-day benchmark. It is the default because "it answered
   *     correctly" beats "it is the biggest".
   *   · nvidia/nemotron-3-ultra-550b-a55b:free — the flagship: a 550B MoE
   *     built for reasoning and orchestration, also 1M context. Slower
   *     (29 tok/s) but the deepest answer available for free.
   *   · nvidia/nemotron-3.5-lightning:free — the fast, high-volume seat.
   *   · nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free — a
   *     reasoning-labelled id; the one whose uptime is least reliable, so it
   *     is tried and skipped rather than trusted first.
   *   · cohere/north-mini-code:free — the code specialist.
   *   · google/gemma-4-31b-it:free — the only free id that does NOT train
   *     on prompts, which is why it is here at all.
   *   · openrouter/free — OpenRouter's own router over the free catalog.
   *     The safety net: when a named id is withdrawn, this still answers.
   *
   * The free tier allows 20 requests/minute and 50/day (1,000/day once
   * $10 has been bought on the account). The daily cap is why the answer
   * cache exists and why this seat is not the one a busy screen polls.
   */
  openrouterfree: {
    name: 'OpenRouter Free',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    envKey: 'OPENROUTER_API_KEY',
    /* The SAME key as the paid seat. This is a second model list, not a
       second account — no new key, no new secret to store. */
    envKeys: ['OPENROUTER_API_KEY', 'OPENROUTER_KEY', 'OPEN_ROUTER_API_KEY'],
    modelEnv: 'OPENROUTER_FREE_MODEL',
    baseModel: 'nvidia/nemotron-3.5-super-vl:free',
    defaultModel: process.env.OPENROUTER_FREE_MODEL || 'nvidia/nemotron-3.5-super-vl:free',
    fallbackModels: [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'nvidia/nemotron-3.5-lightning:free',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'cohere/north-mini-code:free',
      'google/gemma-4-31b-it:free',
      /* OpenRouter's own free router: it picks a live free model for us, so
         a withdrawn id above costs one round-trip, not an outage. */
      'openrouter/free'
    ],
    retiredModels: [
      /* Ids that were in the free catalog and are gone now. They answer 404,
         so they must never be chosen automatically — but an explicit request
         for one is still honoured (a paid account may own the paid id). */
      'poolside/laguna-s-2.1:free',
      'poolside/laguna-xs-2.1:free',
      'poolside/laguna-m.1:free',
      'poolside/laguna-xs.2:free',
      'nvidia/nemotron-3.5-content-safety:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-nano-12b-v2-vl:free',
      'nvidia/nemotron-nano-9b-v2:free',
      'openai/gpt-oss-120b:free',
      'qwen/qwen3-coder:free',
      'deepseek/deepseek-r1:free',
      'mistralai/mistral-7b-instruct:free',
      'nousresearch/hermes-3-llama-3.1-405b:free',
      'arcee-ai/trinity-large-thinking:free',
      'google/gemma-3-27b-it:free',
      'z-ai/glm-4.5-air:free',
      'deepseek/deepseek-chat-v3-0324:free'
    ],
    type: 'openai-compatible',
    specialty: 'Free Tier Reasoning & Orchestration — 1M-Context Nemotron/Gemma Seats at Zero Cost',
    costTier: 'free',
    latencyTier: 'medium'
  },
  openai: {
    name: 'OpenAI GPT',
    url: 'https://api.openai.com/v1/chat/completions',
    envKey: 'OPENAI_API_KEY',
    envKeys: ['OPENAI_API_KEY', 'OPENAI_KEY'],
    modelEnv: 'OPENAI_MODEL',
    /* gpt-4o-mini is the cheap, currently-listed default. The reasoning seats
       sit behind it so a richer account gets them without a code change. */
    baseModel: 'gpt-4o-mini',
    defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    fallbackModels: ['gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    retiredModels: ['gpt-4-turbo', 'gpt-4-32k', 'gpt-3.5-turbo'],
    type: 'openai-compatible',
    specialty: 'High-precision reasoning, financial logic & decision support',
    costTier: 'medium',
    latencyTier: 'fast'
  },
  xai: {
    name: 'xAI Grok',
    url: 'https://api.x.ai/v1/chat/completions',
    envKey: 'XAI_API_KEY',
    /* GROK_API_KEY is accepted because that is the name most operators reach
       for first; the diagnostics report WHICH name supplied the key. */
    envKeys: ['XAI_API_KEY', 'GROK_API_KEY', 'XAI_KEY'],
    modelEnv: 'XAI_MODEL',
    baseModel: 'grok-4-fast',
    defaultModel: process.env.XAI_MODEL || 'grok-4-fast',
    fallbackModels: ['grok-4', 'grok-3-mini'],
    retiredModels: ['grok-beta', 'grok-2-1212', 'grok-2-vision-1212'],
    type: 'openai-compatible',
    specialty: 'Real-time news, social signal & market-narrative analysis',
    costTier: 'medium',
    latencyTier: 'fast'
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
    baseModel: 'openai/gpt-oss-20b',
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
    baseModel: 'gemini-2.5-flash',
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
    baseModel: 'claude-haiku-4-5',
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
    baseModel: 'deepseek-chat',
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
    baseModel: 'mistral-small-latest',
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
    /*
     * ─── TWO SEATS IN ONE PROVIDER: FAST AND DEEP ──────────────────────────
     * The old default was `@cf/meta/llama-3.1-8b-instruct` — an 8B model.
     * It answers quickly and says almost nothing useful. The free tier of
     * Workers AI also serves a genuine reasoning model:
     * `@cf/qwen/qwen3.8-27b` (27B, reasoning low|medium|xhigh, 262K context)
     * and `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` (R1 distilled into a
     * 32B Qwen). Putting the deep ones first costs latency, so the mode
     * decides:
     *
     *   · `swift`      — the 8B model: it exists to classify and greet;
     *   · `balanced`   — the 70B fp8 model;
     *   · `max`        — Qwen 3.8 27B, because "smartest" should mean the
     *                    model that actually reasons.
     *
     * ─── TWO IDS THAT WERE WRONG ─────────────────────────────────────────────
     * The R1 distill was configured as `@cf/deepseek/deepseek-r1-distill-qwen-32b`
     * but Cloudflare's catalogue spells the publisher `deepseek-ai`:
     * `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`. The wrong id 404s, and
     * because the gateway walks the model ladder on a 404, EVERY Cloudflare
     * seat burned its whole ladder before the router moved on — which is what
     * made one `max` turn cost 13-16 provider calls.
     *
     * The same model is also scheduled for deprecation on 2026-11-20, so it
     * cannot be the flagship. `@cf/qwen/qwen3.8-27b` is the live replacement:
     * it reasons, it takes `reasoning_effort`, and it is not going away.
     *
     * `intelligenceModelLadder` (aiIntelligence.js) carries that order, and
     * `getModelCandidates` puts the ladder in front of the default in `max`
     * while leaving `balanced`/`swift` exactly as they were. The default
     * stays the fast model so an unconfigured mode never inherits the
     * slowest seat on the fleet.
     */
    baseModel: '@cf/meta/llama-3.1-8b-instruct',
    defaultModel: process.env.WORKERSAI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    fallbackModels: [
      '@cf/qwen/qwen3.8-27b',
      '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/mistral/mistral-7b-instruct-v0.2',
      '@cf/meta/llama-3.2-3b-instruct'
    ],
    retiredModels: [],
    type: 'workersai-native',
    specialty: 'Free Serverless Open Models (Llama/DeepSeek-R1/Mistral) — Private Edge Inference',
    costTier: 'free',
    latencyTier: 'fast'
  },
  aimlapi: {
    name: 'AIMLAPI (Unified Multi-Model)',
    url: 'https://api.aimlapi.com/v1/chat/completions',
    envKey: 'AIMLAPI_KEY',
    envKeys: ['AIMLAPI_KEY', 'AIMLAPI_API_KEY'],
    modelEnv: 'AIMLAPI_MODEL',
    baseModel: 'gpt-4o-mini',
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

/**
 * Is this provider usable RIGHT NOW: declared in the fleet, and carrying a key.
 *
 * The fleet check comes first on purpose. On this deployment three keys work
 * (OpenRouter, Groq, Workers AI) and the other seven are absent or expired;
 * a present-but-expired key used to make `isProviderConfigured` return true,
 * so every request paid for a round-trip that could only fail. A provider
 * outside `FBT_AI_PROVIDERS` is indistinguishable from one without a key —
 * which is the point: nothing downstream (ordering, collaboration seats,
 * escalation, debate, diagnostics) has to learn a second rule.
 */
export function isProviderConfigured(providerId) {
  if (providerId === 'internal') return true;
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg) return false;
  if (!isProviderInFleet(providerId)) return false;
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
    st = {
      calls: [], lastSuccess: null, lastError: null, consecutiveFailures: 0, openUntil: 0, openReason: null,
      /* Token telemetry. Adding this here (rather than in a parallel store)
         means the dashboard and the benchmark read the SAME counters the
         gateway already maintains — there is no second, drifting truth. */
      tokensIn: 0, tokensOut: 0, usageCalls: 0
    };
    healthState.set(providerId, st);
  }
  return st;
}

export function recordProviderCall(providerId, { ok = true, durationMs = 0, model = null, error = null, reasonCode = null, fix = null, qualityScore = null, usage = null } = {}) {
  if (!providerId || providerId === 'internal') return;
  const st = healthEntry(providerId);
  const tIn = Number(usage?.promptTokens ?? usage?.inputTokens ?? 0) || 0;
  const tOut = Number(usage?.completionTokens ?? usage?.outputTokens ?? 0) || 0;
  if (ok && (tIn || tOut)) {
    st.tokensIn += tIn;
    st.tokensOut += tOut;
    st.usageCalls += 1;
  }
  /*
   * WHICH MODEL FAILED, KEPT WITH THE FAILURE (2026-11-13).
   *
   * `model` and `reasonCode` arrive as arguments and were being thrown away:
   * the record kept only ok/duration/tokens, so the window could say "this
   * provider answered badly" but never "this MODEL does not exist". The
   * consequence was measured, not imagined — after `google/gemini-2.5-pro`
   * returned HTTP 404 five turns running, the ladder it leads was byte-for-byte
   * unchanged and the next turn paid for the same dead call again. On the `:free`
   * tier a failed request counts against the daily allowance exactly like a
   * successful one, so this was not a latency quirk: it was a recurring tax on
   * every deep turn.
   */
  st.calls.push({ ok: Boolean(ok), durationMs: Number(durationMs) || 0, qualityScore: qualityScore == null ? null : Number(qualityScore), tokensIn: tIn, tokensOut: tOut, model: model || null, reasonCode: reasonCode || null, at: Date.now() });
  if (st.calls.length > HEALTH_WINDOW) st.calls.shift();
  if (ok) {
    st.consecutiveFailures = 0;
    st.openUntil = 0;
    st.openReason = null;
    st.lastError = null;
    st.lastSuccess = { at: Date.now(), model: model || null, durationMs: Number(durationMs) || 0 };
    /* A recovery is evidence too, and it has to travel: another instance holding
       a tombstone for this id would keep the recovered model out of its ladder
       for the rest of the cooldown. Cheap because it only fires for a model that
       was actually marked. */
    if (model) forgetDeadModel(providerId, normalizeSecretValue(model));
    return;
  }
  st.consecutiveFailures += 1;
  /*
   * Mark the MODEL, at the scope the fault actually has. Written through to the
   * durable tier when one is configured, fire-and-forget when it is not, and a
   * no-op for any fault that is not deterministic — a timeout is evidence about
   * the network and must not follow this id to the next instance.
   */
  if (model && MODEL_SCOPED_FAULTS.has(reasonCode)) {
    const id = normalizeSecretValue(model);
    const at = Date.now();
    rememberDeadModel(providerId, id, at, at + (CIRCUIT_OPEN_MS[reasonCode] ?? CIRCUIT_OPEN_MS.UNKNOWN));
  }
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
  /*
   * …UNLESS THE FAULT'S SCOPE IS ONE MODEL (2026-11-13).
   *
   * The justification above is that a deterministic fault would be retried on
   * the next request. That is no longer true for a model-scoped one:
   * `deadModelsFor` now demotes the offending id, so the next request does not
   * retry it at all. Parking the provider as well punished every live id behind
   * it — measured, one retired OpenRouter flagship pushed a gateway fronting a
   * hundred models to LAST in the fleet order, behind two providers nobody had
   * asked anything of.
   *
   * The account-wide case is still covered, and by the same rule that always
   * covered it: two consecutive failures park the provider whichever models they
   * happened to be on. So a key that has lost tier access — every id answering
   * 403 — is parked on the second failure exactly as before, while one dead id
   * costs one call instead of ten minutes of the whole seat.
   */
  const modelScoped = MODEL_SCOPED_FAULTS.has(reasonCode) && Boolean(model);
  if (st.consecutiveFailures >= 2 || (!modelScoped && ['AUTH', 'BILLING', 'PERMISSION', 'MODEL_UNAVAILABLE', 'CF_ACCOUNT'].includes(reasonCode))) {
    st.openUntil = Date.now() + park;
    st.openReason = reasonCode;
  }
}

/*
 * A FAULT WHOSE SCOPE IS THE MODEL, NOT THE KEY.
 *
 * `classifyAiError` already draws this line and names it `retryNextModel`:
 * "this MODEL is wrong (404 model_not_found, 403 tier_not_allowed — try the
 * next model on the same provider, no reason to give up on a working key)"
 * versus "this ACCOUNT/KEY is wrong (no model will help)". The distinction was
 * correct and nothing downstream used it: `recordProviderCall` parked the whole
 * provider for a model-scoped fault, so one retired flagship id took a gateway
 * fronting a hundred models out of the fleet order — measured, OpenRouter went
 * to LAST behind two providers that had not been asked anything.
 *
 * These faults are deterministic, which is why one occurrence is enough to act
 * on: a 404 for a model id does not heal by itself the way a timeout does.
 */
const MODEL_SCOPED_FAULTS = Object.freeze(new Set(['MODEL_UNAVAILABLE']));

/**
 * Model ids this provider has PROVEN dead, and for how much longer.
 *
 * Bounded by the health window, and cooled by the same duration the provider
 * circuit uses for this fault class, so a model and its provider are never
 * punished on two different clocks. Demotion, never deletion: the id stays in
 * the chain behind the live ones, exactly as a stale pin does, because a
 * vendor's 404 can be a bad morning rather than a retired model — and a list
 * that only ever shrinks eventually has nothing left to try.
 */
/*
 * ─── A MEMORY THAT OUTLIVES THE INSTANCE (2026-11-13) ────────────────────────
 *
 * Demoting a proven-dead model saves a full-price call on a tier where failed
 * requests count against the daily allowance. But `healthState` is a Map in this
 * process, and a serverless instance is recycled every few minutes — so every
 * new instance re-learned the same 404 by paying for it again. The saving was
 * real and it was per-instance, which on the platform this deploys to means it
 * was mostly theoretical.
 *
 * The durable tier is opt-in by configuration, exactly like the answer cache's,
 * and for the same reason: a memory that silently does not persist has no value
 * here, and pretending otherwise would be the second lie of the same shape. With
 * no durable store configured this whole block is inert and the gateway behaves
 * byte-for-byte as it did before.
 *
 * ONE RECORD PER PROVIDER, not one per model. The store has no scan and no
 * delete, so per-model keys could never be hydrated without already knowing the
 * ids — and knowing the ids is what the ladder is for. Clearing a mark is a
 * read-modify-write, which can race another instance; the race is bounded and
 * self-healing, because a mark expires in ten minutes and the worst outcome is
 * one dead call that would have happened anyway.
 *
 * NOTHING HERE MAY BLOCK OR THROW. `deadModelsFor` is called from the
 * synchronous candidate builder on the way to every provider call, so hydration
 * and persistence are fire-and-forget, and every durable helper swallows its own
 * errors. A store that is down must cost the gateway nothing but the memory.
 */
const MODEL_MEMORY_PREFIX = 'ai-model-memory/v1/';
const durableMarks = new Map(); // providerId -> Map(model -> { at, until })
let durableHydrated = false;
let durableHydrating = null;

function modelMemoryEnabled(env = process.env) {
  const raw = String(env?.AI_MODEL_MEMORY_DURABLE ?? 'auto').trim().toLowerCase();
  if (['0', 'off', 'false', 'no'].includes(raw)) return false;
  if (['1', 'on', 'true', 'yes'].includes(raw)) return true;
  return durableStoreConfigured();
}

/**
 * Merge two sources of evidence about dead models into one map.
 *
 * Pure, and exported for that reason: the interesting rules live here and a rule
 * that can only be tested through I/O is a rule that will not be tested.
 *
 *   · a mark that has expired is not a mark;
 *   · a mark from ANOTHER instance yields to a success THIS instance has seen
 *     since the mark was written — otherwise a stale tombstone would keep a
 *     recovered model out of the ladder for ten minutes on every instance but
 *     the one that witnessed the recovery;
 *   · a non-deterministic fault is not evidence about the id, so it neither
 *     marks nor clears.
 */
export function mergeModelMarks({ calls = [], durable = null, now = Date.now(), cooldown = 600_000 } = {}) {
  const out = new Map();
  for (const c of calls || []) {
    if (!c?.model) continue;
    if (now - (c.at || 0) > cooldown) { out.delete(c.model); continue; }
    if (c.ok) { out.delete(c.model); continue; }
    if (!MODEL_SCOPED_FAULTS.has(c.reasonCode)) continue;
    out.set(c.model, (c.at || 0) + cooldown);
  }
  for (const [model, mark] of durable || new Map()) {
    const until = Number(mark?.until) || 0;
    if (until <= now) continue;
    const writtenAt = Number(mark?.at) || (until - cooldown);
    /* This instance's own newer success outranks another instance's tombstone. */
    const recoveredSince = (calls || []).some((c) => c?.model === model && c.ok && (c.at || 0) > writtenAt);
    if (recoveredSince) continue;
    if (!out.has(model) || until > out.get(model)) out.set(model, until);
  }
  return out;
}

async function durableMarksRead(providerId) {
  try {
    const { storeGet } = await import('./store.js');
    const row = await storeGet(`${MODEL_MEMORY_PREFIX}${providerId}`, null);
    const marks = row && typeof row === 'object' ? row.marks : null;
    if (!marks || typeof marks !== 'object') return new Map();
    return new Map(Object.entries(marks).map(([model, m]) => [model, { at: Number(m?.at) || 0, until: Number(m?.until) || 0 }]));
  } catch {
    return new Map();
  }
}

async function durableMarksWrite(providerId) {
  if (!modelMemoryEnabled()) return false;
  const marks = durableMarks.get(providerId);
  const now = Date.now();
  /* Only unexpired marks are written, so a record never carries its own rot. */
  const live = {};
  let longest = 0;
  for (const [model, m] of marks || new Map()) {
    if ((m?.until || 0) <= now) continue;
    live[model] = { at: m.at || 0, until: m.until || 0 };
    longest = Math.max(longest, m.until - now);
  }
  try {
    const { storeSet } = await import('./store.js');
    /* TTL is the longest remaining cooldown, with a floor so a write is never
       born expired. */
    await storeSet(`${MODEL_MEMORY_PREFIX}${providerId}`, { marks: live, at: now }, Math.max(longest, 60_000));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the durable marks. Idempotent, never throws, never awaited by a caller
 * that needs an answer now: `deadModelsFor` kicks it off and returns what this
 * process already knows, so the FIRST candidate list after a cold start can be
 * built on local evidence alone and every one after it is better informed.
 */
export async function hydrateModelMemory({ env = process.env } = {}) {
  if (!modelMemoryEnabled(env)) return { ok: false, reason: 'DURABLE_NOT_CONFIGURED', providers: 0 };
  if (durableHydrated) return { ok: true, reason: 'ALREADY_HYDRATED', providers: durableMarks.size };
  if (durableHydrating) return durableHydrating;
  durableHydrating = (async () => {
    const ids = Object.keys(PROVIDER_CONFIGS).filter((id) => PROVIDER_CONFIGS[id]?.type !== 'internal-engine');
    /*
     * IN PARALLEL, BECAUSE THESE READS SHARE NOTHING. One key per provider, no
     * ordering between them, and a durable backend is a network round trip: read
     * sequentially and a cold instance waits for eleven of them before it knows
     * anything. It is fire-and-forget either way, so nothing blocks — but a
     * memory that arrives late is a memory the first few turns do not have, and
     * the first few turns are exactly the ones that would re-buy a dead call.
     */
    const results = await Promise.all(ids.map(async (id) => [id, await durableMarksRead(id)]));
    let loaded = 0;
    for (const [id, marks] of results) {
      if (marks.size) { durableMarks.set(id, marks); loaded++; }
    }
    durableHydrated = true;
    durableHydrating = null;
    return { ok: true, reason: 'HYDRATED', providers: loaded, at: Date.now() };
  })();
  return durableHydrating;
}

export function deadModelsFor(providerId, { now = Date.now() } = {}) {
  const st = healthState.get(providerId);
  const cooldown = CIRCUIT_OPEN_MS.MODEL_UNAVAILABLE ?? CIRCUIT_OPEN_MS.UNKNOWN;
  /* Fire-and-forget: the sync caller must never wait on the store. */
  if (!durableHydrated && !durableHydrating && modelMemoryEnabled()) void hydrateModelMemory();
  return mergeModelMarks({
    calls: st?.calls || [],
    durable: durableMarks.get(providerId) || null,
    now,
    cooldown
  });
}

/* Marked/cleared by `recordProviderCall`; both are rare (a mark costs one failed
   call, a clear costs one read-modify-write) so neither is on a hot path. */
function rememberDeadModel(providerId, model, at, until) {
  let marks = durableMarks.get(providerId);
  if (!marks) { marks = new Map(); durableMarks.set(providerId, marks); }
  marks.set(model, { at, until });
  if (modelMemoryEnabled()) void durableMarksWrite(providerId);
}

function forgetDeadModel(providerId, model) {
  const marks = durableMarks.get(providerId);
  if (!marks?.has(model)) return;
  marks.delete(model);
  if (modelMemoryEnabled()) void durableMarksWrite(providerId);
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
      /* Reported by the provider when it reports usage; zero is honest and
         means "this provider did not say", not "this call was free". */
      tokensIn: st.tokensIn || 0,
      tokensOut: st.tokensOut || 0,
      totalTokens: (st.tokensIn || 0) + (st.tokensOut || 0),
      usageCalls: st.usageCalls || 0,
      availability: (circuitOpen || failed) ? 'DEGRADED' : (st.lastSuccess ? 'AVAILABLE' : (total ? 'AVAILABLE' : 'UNKNOWN'))
    };
  }
  return out;
}

export function resetProviderHealth() {
  healthState.clear();
  /* The durable overlay and its hydration flag are process state too. Leaving
     them behind would let one test's tombstones decide the next test's ladder,
     which is how a gate starts passing for the wrong reason. */
  durableMarks.clear();
  durableHydrated = false;
  durableHydrating = null;
}

/** What the durable model-memory tier is doing, for the fleet panel. */
export function modelMemoryStatus({ env = process.env } = {}) {
  const enabled = modelMemoryEnabled(env);
  let marks = 0;
  const now = Date.now();
  for (const m of durableMarks.values()) for (const [, v] of m) if ((v?.until || 0) > now) marks++;
  return {
    schema: 'fbt.ai-model-memory.v1',
    enabled,
    backend: enabled ? (durableStoreConfigured() ? 'configured' : 'forced-on') : 'off',
    hydrated: durableHydrated,
    hydrating: Boolean(durableHydrating),
    providers: durableMarks.size,
    liveMarks: marks
  };
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

/*
 * ─── THE TURN BUDGET (§7) ──────────────────────────────────────────────────
 * The gateway had TWO retry loops and they multiplied:
 *
 *   runRole tries up to 3 PROVIDERS
 *     └─ each provider call walks up to 4 MODEL candidates
 *
 * One `max` turn could therefore spend 3 × 4 = 12 provider calls for ONE
 * role, and a turn runs five roles — measured at 13-16 calls per question.
 * On the free tier that is the whole daily quota: OpenRouter's `:free`
 * seat allows 50 requests a day, so a single deep question could consume a
 * quarter of the budget, and a bad provider id could consume it entirely.
 *
 * The fix is not "retry less" — failover is what makes a free tier usable
 * at all. The fix is that a MODEL id is tried ONCE per turn. Walking the
 * same ladder again for the next provider is pure waste: the ladder is a
 * property of the provider, not of the attempt, and every id in it has
 * already proved itself dead or alive in this very turn.
 *
 * So the budget is a per-turn ledger:
 *   · a model id that already FAILED in this turn is not tried again;
 *   · a provider that already failed on every candidate is not re-walked.
 *
 * The ledger is request-scoped, so two concurrent turns never see each
 * other's failures, and it expires with the request.
 */
/** Start a fresh turn ledger. Returns the token that scopes this turn. */
export function beginAiTurnBudget() {
  return {
    failedModels: new Map(),
    exhaustedProviders: new Set(),
    /* The CALL CAP — the third half of the budget, and the one that
       protects the DAILY allowance rather than the turn.
       ·
       · `calls` counts the provider requests this turn has actually
       ·   spent. `maxCalls` is the ceiling.
       ·
       · The ceiling is not "be lazy". It is the answer to a question the
       ·   old budget could not ask: WHEN should a turn stop asking? The
       ·   time budget answers "when the turn is late"; the model ledger
       ·   answers "when this model is known dead". Neither knows that
       ·   the daily allowance is nearly spent, and on the `:free` tier
       ·   that allowance IS the product.
       ·
       · The cap is deliberately a CAP ON SPEND, not a cap on quality:
       ·   the stages that carry the answer (the analyses, the
       ·   synthesiser) run first, and the stages that refine it (the
       ·   verifier, the critic) are the ones that get dropped. A turn
       ·   that hits the cap answers with what it has, and says so.
       */
    calls: 0,
    maxCalls: maxProviderCallsPerTurn(),
    capHits: 0
  };
}

/**
 * How many provider requests ONE turn may spend.
 *
 * The default is 6 — the measured cost of a full `max` turn (three
 * analyses, a verifier, a final answer and a critic). Lowering it does
 * not make the turn cheaper in tokens; it makes it cheaper in QUOTA,
 * which on the free tier is the scarce thing.
 *
 * `0` means "no cap", which is the pre-budget behaviour and is safe
 * only on a paid tier.
 */
export function maxProviderCallsPerTurn(env = process.env) {
  /*
   * The default is SIX, and the ceiling is on the TURN — the whole
   * collaboration, not one request.
   *
   * A deep turn spends five provider calls on the free tier: the two
   * analyses, the crypto research, the verification and the final
   * answer. The sixth is the critic's REPAIR PASS — the stage that
   * sends a draft back to the reviewer when it invents a number or
   * drops a part of the question.
   *
   * So the sixth call is not a luxury: the existing suites pin the
   * repair behaviour, and a ceiling that silently removes it would
   * make the product's «max» mode quietly weaker than it claims to be.
   * That is the same failure this repo keeps fixing — a capability
   * that is present in the code and absent in the answer.
   *
   * The QUOTA is handled where the quota is known, not here:
   *
   *   · the day's headroom lowers this cap (server/aiQuotaBudget.js),
   *     so the last requests of the day are spread over several
   *     questions rather than spent on the first one;
   *   · the durable answer cache means a repeated question costs one
   *     collaboration rather than two;
   *   · and a deployment that WANTS the shallower shape can set
   *     `AI_MAX_PROVIDER_CALLS=5` — ten questions a day instead of
   *     eight, with the repair pass dropped.
   *
   * The trade is measurable and it is the operator's to make:
   *
   *   cap 6 → 6 calls, nothing dropped → 8 turns a day
   *   cap 5 → 5 calls, the critic dropped → 10 turns a day
   *   cap 4 → 4 calls, verifier and critic dropped → 12 turns a day
   */
  const raw = env?.AI_MAX_PROVIDER_CALLS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 6;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 6;
  return Math.floor(n);
}

/** Spend one unit of the turn's call cap. Returns false when it is spent. */
export function spendProviderCall(budget) {
  if (!budget || typeof budget !== 'object') return true;
  const cap = Number(budget.maxCalls);
  if (!Number.isFinite(cap) || cap <= 0) {
    budget.calls = (budget.calls || 0) + 1;
    return true;
  }
  if ((budget.calls || 0) >= cap) {
    budget.capHits = (budget.capHits || 0) + 1;
    return false;
  }
  budget.calls = (budget.calls || 0) + 1;
  return true;
}

/** How much of the turn's call cap is left. */
export function providerCallBudgetLeft(budget) {
  if (!budget || typeof budget !== 'object') return Infinity;
  const cap = Number(budget.maxCalls);
  if (!Number.isFinite(cap) || cap <= 0) return Infinity;
  return Math.max(0, cap - (budget.calls || 0));
}

/**
 * A budget is an object with the ledger's shape, or null for "no budget"
 * (the legacy behaviour, used by single direct calls).
 */
function normalizeBudget(budget) {
  if (!budget || typeof budget !== 'object') return null;
  if (!budget.failedModels || typeof budget.failedModels.set !== 'function') return null;
  if (!budget.exhaustedProviders || typeof budget.exhaustedProviders.add !== 'function') return null;
  return budget;
}

/** Models of this provider that already failed in this turn. */
function failedModelsFor(budget, providerId) {
  if (!budget) return new Set();
  let set = budget.failedModels.get(providerId);
  if (!set) {
    set = new Set();
    budget.failedModels.set(providerId, set);
  }
  return set;
}

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
export function getModelCandidates(providerId, requestedModel = null, { mode = null } = {}) {
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg || cfg.type === 'internal-engine') return [cfg?.defaultModel || 'fbt-rules-v3'];
  const retired = new Set(cfg.retiredModels || []);
  const envModel = cfg.modelEnv ? normalizeSecretValue(process.env[cfg.modelEnv]) : '';
  const ordered = [];
  const push = (m, { explicit = false } = {}) => {
    const id = normalizeSecretValue(m);
    if (!id || ordered.includes(id)) return;
    /* An explicitly requested id is never refused here: a paying Enterprise
       account may still serve an id its vendor retired for new customers. Only
       AUTOMATIC choices are filtered. */
    if (!explicit && retired.has(id)) return;
    ordered.push(id);
  };
  /*
   * An explicit request still wins — that contract predates this mode and the
   * wiring probe pins it (an Enterprise account may own a retired id).
   * Behind it, `max` puts the provider's flagship ids FIRST so the flagship is
   * what actually reaches the wire; every historical candidate stays in the
   * list behind them, so a stale flagship degrades to the old behaviour
   * instead of taking the provider down.
   */
  const maxMode = normalizeIntelligenceMode(mode) === 'max';
  push(requestedModel, { explicit: true });
  /*
   * An explicitly requested model keeps the pre-mode behaviour exactly: that
   * id, then the operator/default chain. Injecting a flagship ABOVE a caller's
   * explicit choice would be the gateway second-guessing a deliberate
   * instruction — and the wiring probe pins that contract with an exact
   * attempt count.
   */
  /*
   * ─── A PIN THAT REPEATS THE OLD CHEAP DEFAULT IS NOT AN INTENT ───────────
   * The deployment this runs on carries `AI_MODEL=openai/gpt-4o-mini` and
   * `WORKERSAI_MODEL=@cf/meta/llama-3.1-8b-instruct` — values copied from the
   * pre-mode README years before any mode existed. Treating every modelEnv as
   * an instruction put those two ids ABOVE the flagship ladder, so `max`
   * resolved, reported `mode: max`, and then called exactly the model it always
   * called. The 14 000 lines were live and inert at the same time.
   *
   * So the pin is read for MEANING, not for existence:
   *   · a pin naming anything but the provider's historical default is a
   *     deliberate choice (an Enterprise id, a self-hosted gateway, a fine-tune)
   *     and still outranks the ladder, exactly as before;
   *   · a pin that merely repeats the old cheap default is stale, and in `max`
   *     it steps behind the flagships — it is still in the list, still tried the
   *     moment a flagship fails, and still the whole story in `balanced`/`swift`.
   * Nothing is removed from the chain either way; only the order changes.
   */
  const stalePin = Boolean(envModel) && envModel === normalizeSecretValue(cfg.baseModel);
  if (maxMode && !requestedModel) {
    if (!stalePin) push(envModel);
    /* Two flagships, then the historical default — not the whole ladder. The
       attempt cap is finite on purpose; letting a four-id ladder eat every
       attempt would mean a provider's own known-good default never got a
       turn. */
    for (const m of intelligenceModelLadder(providerId, mode).slice(0, Math.max(1, MODEL_ATTEMPTS - 1))) push(m);
    /* A stale pin needs no explicit push: `cfg.defaultModel` below IS that id,
       so it lands in the chain right after the flagships and is tried the
       moment a flagship fails. */
  } else {
    push(envModel);
  }
  push(cfg.defaultModel);
  for (const m of cfg.fallbackModels || []) {
    if (retired.has(m)) continue; // a retired id must never be an automatic choice
    push(m);
  }
  /* `max` is allowed one extra attempt: the first is the flagship, and paying
     for a stronger model is the point of the mode. It is still bounded. */
  const attempts = maxMode && !requestedModel ? MODEL_ATTEMPTS + 1 : MODEL_ATTEMPTS;
  /*
   * ─── DEMOTE WHAT THIS PROVIDER HAS ALREADY PROVEN DEAD ────────────────────
   * Within one turn the walk already drops models it has just seen fail, so this
   * is the half that was missing: memory ACROSS turns. Without it every new turn
   * re-discovered the same 404 at full price, and the discovery re-parked a
   * provider that had three other live ids behind the dead one.
   *
   * Three properties hold it down. An explicitly requested model still leads,
   * because that contract is pinned by the wiring probe and a caller who named an
   * id is entitled to have it tried. Nothing is deleted, only ordered — the same
   * philosophy the stale-pin rule above already follows. And if EVERY candidate
   * is dead the order is left alone, because an empty chain would turn a bad
   * morning into a provider that can never be asked again.
   */
  const dead = deadModelsFor(providerId);
  let ranked = ordered;
  if (dead.size > 0 && !requestedModel && ordered.length > 1) {
    const live = ordered.filter((m) => !dead.has(m));
    const gone = ordered.filter((m) => dead.has(m));
    if (live.length > 0) ranked = [...live, ...gone];
  }
  return ranked.slice(0, Math.max(ranked.length > 1 ? attempts : 1, 1));
}

/**
 * What one provider's model env var is doing to the smartest mode, in words a
 * panel can render. Four states, because the operator needs four different
 * answers:
 *   · `unset`     — nothing pinned, the ladder leads in `max` as designed;
 *   · `leads`     — a deliberate pin (an id that is NOT this provider's old
 *                   cheap default): it outranks the ladder on purpose;
 *   · `shadowed`  — the pin repeats the historical default, so `max` steps it
 *                   behind the flagships and the value is a leftover, not an
 *                   instruction. Deleting the variable is the fix;
 *   · `retired`   — the pin names an id the vendor has retired, so it can never
 *                   be honoured. Say so, or the panel claims leadership a dead
 *                   reference does not have.
 */
export function describeModelPin(providerId, cfg = PROVIDER_CONFIGS[providerId]) {
  const envVar = cfg?.modelEnv || null;
  const pinned = envVar ? normalizeSecretValue(process.env[envVar]) : '';
  if (!envVar || !pinned) return { state: 'unset', envVar, value: null, leads: false, shadowed: false, retired: false };
  /*
   * ─── THE FOURTH STATE: A PIN TO A MODEL THAT NO LONGER EXISTS ─────────────
   * `GROQ_MODEL=llama-3.3-70b-versatile` is this deployment's live example.
   * Groq retired that id for Free/Developer tiers on 2026-08-16, so every call
   * made with it answers HTTP 404. The candidate builder already refuses to
   * choose it automatically — but the diagnostic still reported `leads: true`
   * with `fix: null`, i.e. «this provider is deliberately pinned and working»,
   * while the panel's own `intelligenceCandidates` listed two live ids. The
   * operator reading that could only conclude the code was lying.
   *
   * So a retired pin is named as what it is: not leadership, a dead reference.
   */
  const retired = (cfg?.retiredModels || []).includes(pinned);
  if (retired) {
    return {
      state: 'retired',
      envVar,
      value: pinned,
      leads: false,
      shadowed: false,
      retired: true,
      fix: `${envVar} names ${pinned}, a model this vendor retired — it is never chosen automatically. Point it at a live id or remove it.`
    };
  }
  const shadowed = pinned === normalizeSecretValue(cfg.baseModel);
  return {
    state: shadowed ? 'shadowed' : 'leads',
    envVar,
    value: pinned,
    leads: !shadowed,
    shadowed,
    fix: shadowed ? `Remove ${envVar} (or set it to a flagship id) — it pins this seat to the pre-mode default.` : null
  };
}

/** True when a model id is on any provider's retired list. Used by the probe. */
export function isRetiredModel(model) {
  const id = normalizeSecretValue(model);
  return Object.values(PROVIDER_CONFIGS).some((cfg) => (cfg.retiredModels || []).includes(id));
}

export function getAvailableProviders() {
  const health = getProviderHealth();
  /* One read for the whole list: the mode is deployment-wide unless a request
     overrides it, and this endpoint describes the deployment. */
  const activeIntelligenceMode = resolveIntelligenceMode(null).mode;
  const list = [];
  for (const [id, cfg] of Object.entries(PROVIDER_CONFIGS)) {
    const configured = isProviderConfigured(id);
    const keyInfo = getProviderKeyInfo(id);
    /* Three distinct reasons a provider is not used, so the panel never says
       «کلید ندارد» about a provider whose key is present but out of the
       declared fleet. */
    const fleetExclusion = providerFleetExclusion(id);
    const keyPresent = id === 'internal' ? true : Boolean(keyInfo.present);
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
      inFleet: fleetExclusion === null,
      excludedBy: fleetExclusion,
      keyPresent,
      status: configured
        ? 'ACTIVE'
        : (id === 'internal'
            ? 'ACTIVE'
            : (fleetExclusion === 'NOT_IN_FLEET' ? 'OUT_OF_FLEET' : 'NEEDS_KEY')),
      envVar: id === 'internal' ? null : (cfg.altEnvKey ? `${cfg.envKey} (or ${cfg.altEnvKey})` : cfg.envKey),
      acceptedEnvVars: id === 'internal' ? [] : envNamesFor(cfg),
      keySourceEnv: keyInfo.sourceEnv,
      keyDirtyInEnv: Boolean(keyInfo.dirtyInEnv),
      defaultModel: getModelCandidates(id)[0] || cfg.defaultModel,
      modelCandidates: getModelCandidates(id),
      /*
       * What the smartest mode would actually try, published next to the
       * historical default so a panel can show both without guessing. On a
       * provider with no flagship ladder these are identical.
       */
      intelligenceMode: activeIntelligenceMode,
      intelligenceModel: getModelCandidates(id, null, { mode: activeIntelligenceMode })[0] || cfg.defaultModel,
      intelligenceCandidates: getModelCandidates(id, null, { mode: activeIntelligenceMode }),
      modelEnv: cfg.modelEnv || null,
      /*
       * WHY THIS IS IN THE PAYLOAD: «حالت باهوش‌ترین روشن است ولی هیچ‌چیز عوض
       * نشد» had one answer the panels could not show — an env var pinned the
       * cheap seat and the mode stepped behind it. `modelPin` names the
       * variable, what it holds, and whether it still leads, so the operator
       * reads the cause instead of guessing at it.
       */
      modelPin: describeModelPin(id, cfg),
      specialty: cfg.specialty,
      costTier: cfg.costTier,
      latencyTier: cfg.latencyTier,
      type: cfg.type,
      health: id === 'internal'
        ? { availability: 'AVAILABLE', calls: 0, circuitOpen: false, lastError: null, lastSuccess: null, tokensIn: 0, tokensOut: 0, totalTokens: 0 }
        : (h || { availability: configured ? 'UNKNOWN' : 'NEEDS_KEY', calls: 0, circuitOpen: false, lastError: null, lastSuccess: null, tokensIn: 0, tokensOut: 0, totalTokens: 0 }),
      /*
       * One-line, operator-facing verdict so no panel has to re-derive it.
       * ERROR covers BOTH failure states — an open circuit and a provider whose
       * last real call failed without tripping the breaker — because to the
       * operator they are the same fact: it did not answer. UNTESTED now means
       * what it says (we have never called it), never "it failed a moment ago".
       */
      verdict: !configured
        ? (fleetExclusion === 'NOT_IN_FLEET' ? 'OUT_OF_FLEET' : 'NEEDS_KEY')
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
  const outOfFleet = external.filter((p) => p.inFleet === false);
  const healthy = configured.filter((p) => p.verdict === 'HEALTHY');
  const failing = configured.filter((p) => String(p.verdict).startsWith('ERROR'));
  return {
    total: providers.length,
    configured: configured.length,
    healthy: healthy.length,
    failing: failing.length,
    untested: configured.filter((p) => p.verdict === 'UNTESTED').length,
    /* `needsKey` now means exactly that: in the fleet, no key. A provider the
       operator left out of `FBT_AI_PROVIDERS` is named separately instead of
       being reported as a missing key it may well have. */
    needsKey: external.filter((p) => !p.configured && p.inFleet !== false).map((p) => p.envVar),
    fleet: describeProviderFleet(),
    outOfFleet: outOfFleet.map((p) => p.id),
    outOfFleetWithKey: outOfFleet.filter((p) => p.keyPresent).map((p) => p.id),
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
      : (failing.length ? ['degraded:internal-rules'] : ['internal-rules']),
    /*
     * The answer cache's own report.
     *
     * It is here, and not on a separate endpoint, because the question it
     * answers is the same one this whole summary answers: «چرا هوش مصنوعی
     * کار نمی‌کند؟» — and on a free fleet the answer is often «the daily
     * allowance is already spent». `hitRate` is the fraction of turns the
     * fleet did not have to answer, so it is the number that says whether the
     * cache is doing its job.
     *
     * A cached answer is NOT a different answer: the stored verdict carries
     * the original providers, models, claims and uncertainty, so a client
     * cannot be misled by one. See server/aiAnswerCache.js.
     */
    answerCache: aiAnswerCacheStats(),
    /*
     * The reasoning ledger of the last turn (§8 — LEVER #4). It makes the
     * layer observable: an operator can see how many roles actually
     * produced a reasoning path, and how many conclusions did not carry
     * their own reasoning forward.
     */
    reasoningLedger: lastReasoningLedger(),
    /*
     * The cortex bridge (§8 — LEVER #5). It reports whether the cortex is
     * available, whether its readout was TRAINED (it used not to be — the
     * weights were hand-set once and never fitted, which is why the cortex
     * could not tell an uptrend from a downtrend), and the measured
     * discrimination between a rising and a falling state.
     */
    cortexBridge: cortexBridgeStatus()
  };
}


// ---------------------------------------------------------------------------
// HTTP Request Helper
// ---------------------------------------------------------------------------

async function httpReq(url, options, timeout = TIMEOUT_MS, signal = null) {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', abort, { once: true });
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
    signal?.removeEventListener('abort', abort);
  }
}

/** Additive usage contract; old callers still receive a string. Unknown is null, never zero cost. */
export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const inputTokens = Number(raw.prompt_tokens ?? raw.input_tokens ?? raw.promptTokenCount);
  const outputTokens = Number(raw.completion_tokens ?? raw.output_tokens ?? raw.candidatesTokenCount);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || inputTokens < 0 || outputTokens < 0) return null;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

// ---------------------------------------------------------------------------
// Provider Specific Chat Implementations
// ---------------------------------------------------------------------------

/** OpenAI Compatible Chat (OpenRouter, Groq, DeepSeek, Mistral, AIMLAPI) */
async function callOpenAICompatible({ url, apiKey, model, system, user, temperature = 0.3, maxTokens = 800, json = false, extraHeaders = {}, extraBody = {}, timeout = TIMEOUT_MS, withUsage = false, signal = null }) {
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
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    /* Only the smartest mode adds vendor-specific reasoning knobs, and only
       for model ids that document them — see server/aiIntelligence.js. */
    ...(extraBody && typeof extraBody === 'object' ? extraBody : {})
  };

  const raw = await httpReq(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }, timeout, signal);

  const text = raw?.choices?.[0]?.message?.content;
  if (!text) throw new Error('EMPTY_AI_RESPONSE');
  return withUsage ? { text: String(text).trim(), usage: normalizeUsage(raw?.usage || raw?.usageMetadata) } : String(text).trim();
}

/** Google Gemini Chat */
async function callGemini({ apiKey, model, system, user, temperature = 0.3, maxTokens = 800, json = false, thinkingConfig = null, timeout = TIMEOUT_MS, withUsage = false, signal = null }) {
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
      ...(json ? { responseMimeType: 'application/json' } : {}),
      ...(thinkingConfig && typeof thinkingConfig === 'object' ? thinkingConfig : {})
    }
  };

  if (sanitizedSystem) {
    body.systemInstruction = { parts: [{ text: sanitizedSystem }] }
  }

  const raw = await httpReq(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  }, timeout, signal);

  const blocked = raw?.promptFeedback?.blockReason;
  if (blocked) throw new Error(`EMPTY_GEMINI_RESPONSE: blocked (${blocked})`);

  /* A long answer arrives as SEVERAL parts; reading only parts[0] silently
     truncated every structured JSON reply that Google split. */
  const parts = raw?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p?.text ?? '').join('').trim();
  if (!text) throw new Error('EMPTY_GEMINI_RESPONSE');
  return withUsage ? { text: text, usage: normalizeUsage(raw?.usage || raw?.usageMetadata) } : text;
}

/** Anthropic Claude Chat */
async function callAnthropic({ apiKey, model, system, user, temperature = 0.3, maxTokens = 800, thinking = null, timeout = TIMEOUT_MS, withUsage = false, signal = null }) {
  assertNoSecretsInPayload({ system, user });
  const sanitizedSystem = sanitizePrompt(system);
  const sanitizedUser = sanitizePrompt(user);

  /*
   * Extended thinking is a mode decision, not a default: `thinking` is null
   * unless the caller asked for the smartest mode AND the model is a Claude
   * 4.x id. When it is on, the API rejects sampling parameters, so the
   * temperature is omitted on the FIRST attempt instead of paying for a 400
   * and a retry.
   */
  const body = {
    model,
    system: sanitizedSystem || undefined,
    messages: [{ role: 'user', content: sanitizedUser }],
    max_tokens: maxTokens,
    ...(thinking && typeof thinking === 'object' ? { thinking } : {})
  };
  const call = (withTemperature) => httpReq(PROVIDER_CONFIGS.anthropic.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      ...body,
      ...(withTemperature ? { temperature } : {})
    })
  }, timeout, signal);

  let raw;
  try {
    raw = await call(!thinking);
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
  return withUsage ? { text: text, usage: normalizeUsage(raw?.usage || raw?.usageMetadata) } : text;
}

/** Cloudflare Workers AI (serverless open models via REST run endpoint) */
async function callWorkersAI({ accountId, apiToken, model, system, user, temperature = 0.3, maxTokens = 800, timeout = TIMEOUT_MS, withUsage = false, signal = null, extraBody = {} }) {
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
    max_tokens: maxTokens,
    /*
     * ─── THE REASONING KNOB ON CLOUDFLARE'S FREE SEAT ───────────────────────
     * `@cf/qwen/qwen3.8-27b` and `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`
     * are reasoning models on Cloudflare's free tier. Without this field they
     * were being called like plain chat models — the reasoning existed in the
     * weights but was never asked for, so the smartest mode got the same
     * answer from them as from the 8B model it used to default to.
     *
     * `extraBody` is empty for every other Workers AI model, so their
     * request bodies stay byte-identical to before this change.
     */
    ...(extraBody && typeof extraBody === 'object' ? extraBody : {})
  };

  const raw = await httpReq(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`
    },
    body: JSON.stringify(body)
  }, timeout, signal);

  const text = raw?.result?.response;
  if (!text) throw new Error('EMPTY_WORKERSAI_RESPONSE');
  return withUsage ? { text: String(text).trim(), usage: normalizeUsage(raw?.usage || raw?.usageMetadata) } : String(text).trim();
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
async function runProviderModel(providerId, cfg, apiKey, model, { system, user, temperature, maxTokens, json, mode = null, timeout, withUsage, signal }) {
  if (providerId === 'internal') {
    return callInternalEngine({ system, user, json });
  }
  if (cfg.type === 'gemini-native') {
    const thinkingConfig = intelligenceGeminiThinking(mode, model);
    return callGemini({ apiKey, model, system, user, temperature, maxTokens, json, thinkingConfig, timeout, withUsage, signal });
  }
  if (cfg.type === 'anthropic-native') {
    const budget = intelligenceAnthropicThinking(mode, model, maxTokens);
    return callAnthropic({
      apiKey,
      model,
      system,
      user,
      temperature,
      maxTokens: budget ? budget.maxTokens : maxTokens,
      thinking: budget ? budget.thinking : null,
      timeout,
      withUsage,
      signal
    });
  }
  if (cfg.type === 'workersai-native') {
    const accountId = getCloudflareAccountId();
    if (!accountId) throw new Error('NO_CLOUDFLARE_ACCOUNT_ID');
    /* Workers AI accepts `reasoning_effort` on its reasoning models (the R1
       distill). Empty for every other model, so their bodies are unchanged. */
    const workersExtraBody = intelligenceReasoningFields(providerId, mode, model);
    return callWorkersAI({ accountId, apiToken: apiKey, model, system, user, temperature, maxTokens, timeout, withUsage, signal, extraBody: workersExtraBody });
  }
  // OpenAI Compatible (OpenRouter, Groq, DeepSeek, Mistral, AIMLAPI)
  const extraHeaders = {};
  /* Both OpenRouter seats get the attribution headers. OpenRouter uses them
     for its leaderboard and rate-limits harder on requests that omit them, so
     the free seat needs them exactly as much as the paid one. */
  if (providerId === 'openrouter' || providerId === 'openrouterfree') {
    extraHeaders['HTTP-Referer'] = SITE_URL;
    extraHeaders['X-Title'] = 'FBT Smart Intent OS';
  }
  const extraBody = intelligenceReasoningFields(providerId, mode, model);
  return callOpenAICompatible({ url: cfg.url, apiKey, model, system, user, temperature, maxTokens, json, extraHeaders, extraBody, timeout, withUsage, signal });
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
  intelligence = null,
  timeout = TIMEOUT_MS,
  withUsage = false,
  signal = null,
  /* The per-turn ledger. See "THE TURN BUDGET" above: without it the gateway
     re-walks a provider's whole model ladder every time the caller retries
     with the next provider, and one question spends 13-16 provider calls. */
  budget = null
} = {}) {
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg) throw new Error(`UNKNOWN_PROVIDER:${providerId}`);

  /*
   * A provider this turn has already PROVED dead is not asked again.
   *
   * This is the single most valuable line in the budget. On the free tier a
   * 429 means the daily cap is reached — the next request is certain to
   * fail too, so asking again spends quota to learn nothing. Before the
   * ledger, one question could ask the capped provider three times.
   */
  const turnBudget = normalizeBudget(budget);
  if (turnBudget?.exhaustedProviders?.has?.(providerId)) {
    const err = new Error(`PROVIDER_EXHAUSTED_THIS_TURN:${providerId}`);
    err.reasonCode = 'PROVIDER_EXHAUSTED';
    err.provider = providerId;
    err.attempts = [];
    err.fix = 'This provider already failed in this turn; try the next seat.';
    throw err;
  }

  /*
   * Every path that reaches a provider lands here, so this is where a mode
   * becomes real. Without an explicit mode the deployment default applies —
   * which is `max` — meaning direct callers (consensus, web research, the
   * collaboration roles) get the flagship ladder too, not just chat.
   */
  const resolved = resolveIntelligenceMode(intelligence);
  const mode = resolved.mode;
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

    const allCandidates = getModelCandidates(providerId, model, { mode });
    /*
     * ─── THE BUDGET CUT ────────────────────────────────────────────────────
     * Candidates this turn has already PROVED dead are dropped before the
     * first request goes out. That is the whole point: the ladder is a
     * property of the provider, so a second walk of it in the same turn
     * costs real requests and can only re-discover the same failures.
     */
    const alreadyFailed = failedModelsFor(turnBudget, providerId);
    const candidates = turnBudget
      ? allCandidates.filter((c) => !alreadyFailed.has(c))
      : allCandidates;
    /* Every candidate was already tried in this turn — do not spend another
       request to learn that. */
    if (turnBudget && !candidates.length && allCandidates.length) {
      const out = new Error(`ALL_MODELS_ALREADY_TRIED:${providerId}`);
      out.reasonCode = 'MODEL_UNAVAILABLE';
      out.provider = providerId;
      out.attempts = [];
      out.fix = 'Every model for this provider already failed in this turn.';
      throw out;
    }
    let lastErr = null;
    let lastClass = null;

    for (const candidate of candidates) {
      try {
        /*
         * ─── THE CALL CAP (the daily allowance's share) ───────────────────
         * Spend one unit of the turn's cap BEFORE the request goes out.
         *
         * This is the line that protects the DAILY quota, not the turn's
         * latency. On the `:free` tier the whole allowance is fifty
         * requests a day, and a `max` turn costs six of them — so a
         * handful of deep questions exhausts the day.
         *
         * When the cap is spent the turn does NOT fail: it answers with
         * what it already has, and the caller can say so. A turn that
         * refused to answer would be worse than a shallower answer.
         */
        if (!spendProviderCall(turnBudget)) {
          const out = new Error(`PROVIDER_CALL_CAP_SPENT:${providerId}`);
          out.reasonCode = 'QUOTA';
          out.provider = providerId;
          out.attempts = attempts.slice();
          out.fix = 'This turn has spent its provider-call cap; the answer is built from what it already read.';
          throw out;
        }
        /* Usage is requested on EVERY call, not only when a caller asked for
           it. The provider already returns it in the same response body, so
           the only cost is a few bytes — and without it the dashboard's token
           counter would be structurally blind. */
        const response = await runProviderModel(providerId, cfg, apiKey, candidate, { system, user, temperature, maxTokens, json, mode, timeout, withUsage: true, signal });
        const text = typeof response === 'string' ? response : response.text;
        const usage = typeof response === 'string' ? null : response.usage;
        const durationMs = Date.now() - startedAt;
        recordProviderCall(providerId, { ok: true, durationMs, model: candidate, usage });
        /*
         * Count it against the day's allowance.
         *
         * This is the project's own accounting, not the provider's: the
         * provider remains the authority on when the cap is reached, and
         * it says so with a 429. But a deployment that can COUNT its own
         * spending can decide to spend it deliberately — and can publish
         * «18 of 50 used today» instead of discovering the cap by
         * failing against it.
         *
         * It is counted on success only. A request the provider rejected
         * for an auth error did not consume the daily allowance there,
         * and counting it would make the deployment too pessimistic.
         */
        spendQuota(providerId).catch(() => {});
        return {
          ok: true,
          provider: providerId,
          providerName: cfg.name,
          model: candidate,
          text,
          durationMs,
          attempts,
          /* Which seat the answer really came from: a model, not the rules. */
          engine: 'external-model',
          usage: usage ?? null,
          usageReported: usage != null,
          /* Which intelligence mode produced this seat, so a caller can print
             it instead of guessing. */
          intelligence: { mode, source: resolved.source }
        };
      } catch (err) {
        const cls = classifyAiError(err, providerId);
        attempts.push({ model: candidate, reasonCode: cls.kind, status: cls.status || null, error: cls.message.slice(0, 200) });
        /* Mark the id dead for the rest of THIS turn. */
        if (turnBudget) alreadyFailed.add(candidate);
        /*
         * And if the failure says "another model of this provider cannot
         * help" — a 429 on the free tier, an auth error, a billing refusal —
         * then this PROVIDER is done for the turn. The caller's next
         * provider retry must not spend another request to learn the same
         * thing.
         *
         * This is the case that mattered most: OpenRouter's `:free` seat
         * answers 429 as soon as the daily cap is hit, and the gateway used
         * to ask it three times per role before giving up.
         */
        if (turnBudget && !cls.retryNextModel) turnBudget.exhaustedProviders.add(providerId);
        lastErr = err;
        lastClass = cls;
        console.warn(`[ai-gateway] ${providerId}/${candidate} failed (${cls.kind}${cls.status ? ` HTTP ${cls.status}` : ''}): ${cls.message.slice(0, 180)}`);
        if (!cls.retryNextModel) break; // account/key/network problem: another model cannot help
      }
    }

    /* The provider's ladder is done for this turn: the next provider retry
       must not walk it again. */
    if (turnBudget && !candidates.length) turnBudget.exhaustedProviders.add(providerId);
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
export function getPreferredProvidersForTask(taskType = 'general', { configuredOnly = false, intelligence = null } = {}) {
  const type = String(taskType).toLowerCase();
  let candidateOrder = [];

  /*
   * `openrouterfree` sits NEXT TO `openrouter` in every order, and that is the
   * point of it: it is the SAME KEY with a different model list. A free key
   * on the PAID seat answers 402 on every paid model, so a route that names
   * only `openrouter` is a route that fails with a free deployment — and the
   * deployment's default fleet is `['openrouterfree','groq','workersai']`.
   *
   * Before this fix the free seat was reachable ONLY in `max` mode (via
   * `MAX_PROVIDER_ORDER`), so `balanced` — the mode the central brain and
   * most direct callers use — could not see it at all. The seat existed,
   * the fleet named it, and no route ever asked it.
   *
   * Position: immediately after `openrouter`, so the PAID seat still leads a
   * deployment that has paid access, and the historical order (which the
   * mode test pins by index 0) does not move.
   */
  switch (type) {
    case 'market':
    case 'market_intelligence':
    case 'crypto_trend':
      // OpenRouter leads (its online-capable models are the general route),
      // then the DIRECT Grok seat for real-time narrative, then Gemini/Groq.
      candidateOrder = ['openrouter', 'openrouterfree', 'xai', 'gemini', 'groq', 'deepseek', 'aimlapi', 'workersai', 'internal'];
      break;
    case 'research':
    case 'news':
    case 'web_research':
    case 'crypto-analysis':
      // Perplexity's old job: sourced, web-grounded answers. OpenRouter's
      // online-capable models lead; Grok's direct real-time seat and Gemini
      // back it up.
      candidateOrder = ['openrouter', 'openrouterfree', 'xai', 'gemini', 'groq', 'deepseek', 'aimlapi', 'workersai', 'internal'];
      break;
    case 'reasoning':
    case 'complex_plan':
    case 'portfolio_optimization':
      // High-precision logic: OpenRouter's multi-model route first, then the
      // DIRECT GPT and Claude seats, then DeepSeek.
      candidateOrder = ['openrouter', 'openrouterfree', 'openai', 'anthropic', 'deepseek', 'gemini', 'aimlapi', 'workersai', 'internal'];
      break;
    case 'risk':
    case 'guardian':
    case 'verification':
      candidateOrder = ['anthropic', 'openai', 'deepseek', 'openrouter', 'openrouterfree', 'aimlapi', 'gemini', 'groq', 'workersai', 'internal'];
      break;
    case 'intent':
    case 'fast':
    case 'classification':
      candidateOrder = ['workersai', 'groq', 'gemini', 'mistral', 'aimlapi', 'openrouter', 'openrouterfree', 'internal'];
      break;
    default:
      candidateOrder = ['openrouter', 'openrouterfree', 'openai', 'groq', 'gemini', 'xai', 'workersai', 'aimlapi', 'deepseek', 'anthropic', 'mistral', 'internal'];
      break;
  }

  /*
   * `max` re-orders the substantive tasks toward the reasoning seats. This is
   * deliberately opt-in through an explicit mode argument: callers that never
   * pass one (and every historical test) keep the exact list above, so a
   * smarter default cannot silently move a pinned route. Latency-bound jobs
   * (`fast` / `intent`) are returned unchanged by `intelligenceProviderOrder`.
   */
  const smartOrder = intelligenceProviderOrder(type, intelligence);
  if (smartOrder) {
    /* The ladder is an ordering, not a licence: a flagship id on a provider
       outside the fleet would just be a name we cannot call. */
    const registered = smartOrder.filter((id) => Boolean(PROVIDER_CONFIGS[id]) && isProviderInFleet(id));
    const rest = candidateOrder.filter((id) => !registered.includes(id));
    candidateOrder = [...registered, ...rest];
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
  allowInternalFallback = true,
  withUsage = false,
  /* 'swift' | 'balanced' | 'max' | null. Null means "use the deployment
     default", which is `max`. See server/aiIntelligence.js. */
  intelligence = null,
  signal = null,
  /* Operator kill-switch / drill lever: a provider named here is skipped for
     THIS request only. The benchmark lab uses it to exercise the real failover
     loop with a seat genuinely removed, instead of pretending a healthy
     provider was down. */
  excludeProviders = []
} = {}) {
  /*
   * `AI_PRIMARY_PROVIDER` is the operator lever: one environment variable pins
   * the seat that answers first, without a code change or a redeploy of logic.
   * On the live deployment (only OpenRouter answering) setting
   * AI_PRIMARY_PROVIDER=openrouter removes every wasted failover hop.
   */
  const envPrimary = normalizeSecretValue(process.env.AI_PRIMARY_PROVIDER).toLowerCase();
  const primary = preferredProvider || (PROVIDER_CONFIGS[envPrimary] ? envPrimary : null);

  /*
   * One resolution for the whole request: the mode decides provider ORDER,
   * model ladder, temperature and token budget together. Resolving it four
   * times would let a request disagree with itself.
   */
  const resolvedIntelligence = resolveIntelligenceMode(intelligence);
  const mode = resolvedIntelligence.mode;
  const generation = intelligenceGeneration(mode, { temperature, maxTokens, taskType });

  const taskOrder = getPreferredProvidersForTask(taskType, { configuredOnly: true, intelligence: mode }).filter((p) => p !== primary && p !== 'internal');
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
  const excluded = new Set((Array.isArray(excludeProviders) ? excludeProviders : []).map(String));
  const candidates = orderByHealth(ordered).filter((id) => !excluded.has(id));

  const errors = [];

  for (const providerId of candidates) {
    try {
      const res = await executeProviderChat(providerId, {
        system,
        user,
        model: providerId === primary ? model : null,
        temperature: generation.temperature,
        maxTokens: generation.maxTokens,
        intelligence: mode,
        json,
        withUsage,
        signal
      });
      return {
        ...res,
        taskType,
        requestedProvider: primary,
        intelligence: {
          mode,
          source: resolvedIntelligence.source,
          requested: resolvedIntelligence.requested,
          rejected: resolvedIntelligence.rejected,
          apiAnswerMode: getIntelligenceProfile(mode).id
        },
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
  if (signal?.aborted) throw Object.assign(new Error('ABORTED'), { reasonCode: 'ABORTED' });
  const internalRes = await executeProviderChat('internal', { system, user, json, signal });
  return {
    ...internalRes,
    taskType,
    requestedProvider: primary,
    intelligence: {
      mode,
      source: resolvedIntelligence.source,
      requested: resolvedIntelligence.requested,
      rejected: resolvedIntelligence.rejected
    },
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
  /* Grok's debate seat is gone. The debate seats are the fleet that can
     actually answer here — OpenRouter, Groq and Workers AI — because a debate
     whose seats are keyed-out providers collapses to one voice (or none), and
     `isProviderConfigured` below would silently drop them. */
  providers = ['openrouter', 'groq', 'workersai'],
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
  /*
   * The probe runs in the deployment's ACTIVE MODE. Probing without a mode
   * asked every provider for its historical cheap default, so a panel could
   * print «HEALTHY» for a seat whose flagship the key has never served — the
   * exact blind spot that made the smartest mode look inert. `max` now pings
   * the id `max` will really call; the mode is echoed in the report so a
   * healthy row can never be read as a promise about a different one.
   */
  const probeMode = resolveIntelligenceMode(null).mode;

  const probe = async (p) => {
    if (!p.configured) {
      /* Out of the declared fleet is not the same fact as a missing key: the
         operator chose not to call this provider, and the fix is a value, not
         a secret. */
      if (p.inFleet === false) {
        return {
          id: p.id,
          name: p.name,
          status: 'OUT_OF_FLEET',
          reasonCode: 'NOT_IN_FLEET',
          reason: `Provider is outside the declared fleet (FBT_AI_PROVIDERS=${describeProviderFleet().providers})`,
          fix: 'Add it to FBT_AI_PROVIDERS (or set FBT_AI_PROVIDERS=all) and redeploy.',
          envVar: p.envVar,
          keyPresent: Boolean(p.keyPresent)
        };
      }
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
        mode: probeMode,
        timeout: Math.min(TIMEOUT_MS, Math.max(5000, SELFTEST_DEADLINE_MS - (Date.now() - started)))
      });
      return {
        id: p.id,
        name: p.name,
        status: 'HEALTHY',
        model: res.model,
        /* Which mode this row describes. A «HEALTHY» earned on the cheap seat
           is not a promise about the flagship, and the panel must not imply
           one — so the mode rides on the row that was probed under it. */
        intelligenceMode: probeMode,
        modelPin: p.modelPin || null,
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
    /* The turn budget each mode gets, published with the live probe so a slow
       result can be read as «the flagship is thinking» rather than as a hang. */
    intelligence: {
      mode: probeMode,
      ...intelligenceDeadlineMs(probeMode),
      providerCount: healthy.length + errored.length
    },
    providers: testResults,
    summary: {
      ...getFleetSummary(),
      healthyCount: healthy.length,
      errorCount: errored.length,
      unconfiguredCount: testResults.filter((r) => r.status === 'UNCONFIGURED').length,
      outOfFleetCount: testResults.filter((r) => r.status === 'OUT_OF_FLEET').length,
      /* The single number that answers the operator's question: how many of
         the keyed providers can actually serve a request right now. */
      usableExternalModels: healthy.filter((r) => r.id !== 'internal').length
    },
    durationMs: Date.now() - started,
    truncated: Date.now() - started >= SELFTEST_DEADLINE_MS,
    timestamp: Date.now()
  };
}
