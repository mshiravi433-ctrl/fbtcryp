/**
 * FBT AI — INTELLIGENCE MODES (the "smartest mode" contract)
 * ---------------------------------------------------------------------------
 * The gateway already had failover, health memory and model fallbacks. What it
 * did NOT have was a single, named answer to the question the operator kept
 * asking: «هوش مصنوعی را باهوش‌ترین حالت کن» — put the assistant in its
 * smartest mode.
 *
 * Before this file, "smartest" was an accident of three unrelated defaults:
 *
 *   · every provider's FIRST model was its cheapest one (gpt-4o-mini,
 *     claude-haiku-4-5, gemini-2.5-flash, grok-4-fast, llama-3.1-8b);
 *   · the collaboration engine stopped at the level the question analyzer
 *     guessed, usually 2 (one model, no verification);
 *   · every call was capped at 400-800 output tokens, which is enough for a
 *     paragraph and not enough for a reasoning trace plus an answer.
 *
 * A user who wanted depth had no switch, no endpoint and nothing on screen
 * that said which brain was answering. This module is that switch, made
 * explicit and inspectable.
 *
 * THREE MODES, ONE MEANING EACH
 * ---------------------------------------------------------------------------
 *   swift     — cheapest/fastest seat that can answer (classification, social
 *               turns, tight latency budgets). Depth is deliberately capped.
 *   balanced  — the historical behaviour, unchanged: provider defaults, the
 *               analyzer's own collaboration level, 800-token answers.
 *   max       — THE DEFAULT: flagship model ids first, reasoning parameters
 *               where the vendor actually supports them, collaboration raised
 *               to multi-model + verification on substantive turns, and room
 *               for a long, careful answer.
 *
 * HONESTY RULES BAKED IN
 * ---------------------------------------------------------------------------
 * 1. A mode changes ORDER and BUDGET, never truth. Grounding, tool-truth,
 *    approval gates and `canExecute = false` are untouched. No mode can make a
 *    model supply a balance or sign a transaction.
 * 2. "Smartest" never means "invent a model id". Every id below is either
 *    already present in `PROVIDER_CONFIGS` (direct or fallback) or the
 *    well-known gateway spelling of one. If a provider's account does not serve
 *    it, the gateway's existing model-level walk steps down to the next id on
 *    the SAME key — a stale flagship costs one round-trip, not an outage.
 * 3. Reasoning parameters are only attached where the vendor documents them
 *    (OpenAI reasoning ids, OpenRouter reasoning models, Groq gpt-oss, Gemini
 *    2.5 Pro/Flash thinking, Anthropic 4.x extended thinking). Sending
 *    `reasoning_effort` to a model that does not accept it is how a "smarter"
 *    switch becomes a 400 on every request, so the matchers are narrow.
 * 4. The operator can always override: `FBT_AI_INTELLIGENCE=balanced` restores
 *    the old behaviour exactly, and `FBT_AI_EXTENDED_THINKING=0` disables the
 *    Anthropic thinking budget without touching anything else.
 */

export const INTELLIGENCE_SCHEMA = 'fbt.ai-intelligence.v1';
export const INTELLIGENCE_VERSION = '1.0.0';

/**
 * Flagship-first ladders. The gateway appends the provider's own default and
 * fallback list behind these, so the ladder is an ORDERING, not a whitelist:
 * nothing that answered before can stop answering because of this table.
 */
const MAX_MODEL_LADDERS = Object.freeze({
  openrouter: Object.freeze([
    'google/gemini-2.5-pro',
    'openai/gpt-4.1',
    'anthropic/claude-sonnet-4-6',
    'x-ai/grok-4'
  ]),
  openai: Object.freeze(['gpt-4.1', 'gpt-4o']),
  xai: Object.freeze(['grok-4', 'grok-4-fast']),
  gemini: Object.freeze(['gemini-2.5-pro', 'gemini-2.5-flash']),
  anthropic: Object.freeze(['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5']),
  deepseek: Object.freeze(['deepseek-reasoner', 'deepseek-chat']),
  groq: Object.freeze(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']),
  mistral: Object.freeze(['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest']),
  workersai: Object.freeze([
    '@cf/qwen/qwen3.8-27b',
    '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/meta/llama-3.1-8b-instruct'
  ]),
  aimlapi: Object.freeze(['gpt-4o', 'meta-llama/Llama-3.3-70B-Instruct', 'gpt-4o-mini']),
  /*
   * ─── THE FREE SEAT'S LADDER ────────────────────────────────────────────────
   * `openrouterfree` is a SEPARATE seat from `openrouter` because it serves a
   * different catalogue: the `:free` ids. The paid ladder's flagships
   * (`gemini-2.5-pro`, `gpt-4.1`, `claude-sonnet-4-6`, `grok-4`) are all paid
   * ids, and a free key calling one answers 402 — an account-level failure
   * that stops the model walk. So the free seat gets its own ladder, drawn
   * only from ids that were verified to answer on the free tier:
   *
   *   · nvidia/nemotron-3.5-super-vl:free — the default: 1M context, the
   *     only free id that answered JSON extraction, a tool call and a coding
   *     task on every attempt across a 10-day benchmark;
   *   · nvidia/nemotron-3-ultra-550b-a55b:free — the deepest free answer
   *     (a 550B MoE built for reasoning and orchestration);
   *   · nvidia/nemotron-3.5-lightning:free — fast, high-volume.
   *
   * The remaining free ids (the nano reasoning one, North Mini Code, Gemma 4
   * and OpenRouter's own free router) stay behind them in the provider's
   * fallback list, so a withdrawn flagship costs one round-trip rather than
   * an outage — the ladder is an ORDERING, never a whitelist.
   */
  openrouterfree: Object.freeze([
    'nvidia/nemotron-3.5-super-vl:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3.5-lightning:free'
  ])
});

/**
 * Provider preference when the mode is `max` and the task is not latency
 * bound. This is only consulted when a caller explicitly asks for a mode —
 * `getPreferredProvidersForTask()` without one keeps its historical order, so
 * nothing that pinned a route silently moves.
 */
const MAX_PROVIDER_ORDER = Object.freeze({
  general: ['openai', 'anthropic', 'openrouter', 'openrouterfree', 'xai', 'gemini', 'deepseek', 'groq', 'aimlapi', 'mistral', 'workersai', 'internal'],
  market: ['xai', 'openrouter', 'openrouterfree', 'openai', 'gemini', 'anthropic', 'deepseek', 'groq', 'aimlapi', 'workersai', 'internal'],
  research: ['xai', 'openrouter', 'openrouterfree', 'openai', 'gemini', 'anthropic', 'deepseek', 'groq', 'aimlapi', 'workersai', 'internal'],
  reasoning: ['openai', 'anthropic', 'openrouter', 'openrouterfree', 'deepseek', 'gemini', 'xai', 'aimlapi', 'groq', 'workersai', 'internal'],
  risk: ['anthropic', 'openai', 'deepseek', 'openrouter', 'openrouterfree', 'gemini', 'xai', 'aimlapi', 'groq', 'workersai', 'internal']
});

const TASK_ALIASES = Object.freeze({
  market_intelligence: 'market',
  crypto_trend: 'market',
  news: 'research',
  web_research: 'research',
  'crypto-analysis': 'research',
  complex_plan: 'reasoning',
  portfolio_optimization: 'reasoning',
  guardian: 'risk',
  verification: 'risk'
});

export const INTELLIGENCE_MODES = Object.freeze({
  swift: Object.freeze({
    id: 'swift',
    label: { fa: 'سریع', en: 'Swift' },
    description: {
      fa: 'ارزان‌ترین و سریع‌ترین مدل کافی؛ برای پرسش‌های ساده و پاسخ فوری. عمق عمداً محدود است.',
      en: 'The cheapest seat that can answer, for simple questions and fast replies. Depth is deliberately capped.'
    },
    /* The analyzer's own level is capped, never raised. */
    collaborationFloor: 0,
    collaborationCeiling: 2,
    tokenScale: 0.8,
    tokenFloor: 0,
    tokenCeiling: 1200,
    temperature: 0.3,
    reasoning: false,
    maxModels: 2,
    /* Deep reasoning is off in the cheap mode: extra passes buy latency, not
       accuracy, when the seat itself is small. */
    analysesCount: 2,
    selfCritique: false,
    knowledgeTopK: 3,
    modelLadders: Object.freeze({}),
    /* Wall-clock room for one collaborative turn, in ms. A mode that asks a
       flagship for a 1200-token reasoned answer cannot fit in the window tuned
       for a 400-token cheap-model reply — see `intelligenceDeadlineMs`. */
    turnDeadlineMs: 8000
  }),
  balanced: Object.freeze({
    id: 'balanced',
    label: { fa: 'متعادل', en: 'Balanced' },
    description: {
      fa: 'رفتار تاریخی: مدل پیش‌فرض هر ارائه‌دهنده، سطح همکاری همان‌که تحلیل‌گر تشخیص می‌دهد، بودجهٔ ۸۰۰ توکن.',
      en: 'Historical behaviour: each provider’s default model, the analyzer’s own collaboration level, 800-token answers.'
    },
    collaborationFloor: 0,
    collaborationCeiling: 5,
    tokenScale: 1,
    tokenFloor: 0,
    tokenCeiling: 1600,
    temperature: null,
    reasoning: false,
    maxModels: 4,
    /* Historical behaviour: level 4 runs two analyses, level 5 runs three. */
    analysesCount: 2,
    selfCritique: false,
    knowledgeTopK: 4,
    modelLadders: Object.freeze({}),
    /* Exactly the pre-mode `AI_COLLAB_DEADLINE_MS` default, so `balanced`
       keeps the latency contract it always had — bit for bit, as its tests
       pin for the request body and the prompt. */
    turnDeadlineMs: 20000
  }),
  max: Object.freeze({
    id: 'max',
    /*
     * `label.fa` is what the operator reads on a button. It used to say
     * «باهوش‌ترین» while the request that created the mode said «هوش عمیق» —
     * and a control whose label does not match the words the user searches for
     * is a control that gets reported as missing. Both spellings resolve to
     * this mode (`MODE_ALIASES` below and in src/lib/aiIntelligenceMode.js),
     * so nothing stored or requested under the old name breaks.
     */
    label: { fa: 'هوش عمیق', en: 'Smartest' },
    description: {
      fa: 'پیش‌فرض: مدل‌های پرچم‌دار اول، استدلال عمیق، سه تحلیل مستقل، بازبینی خصمانهٔ پیش‌نویس و بودجهٔ پاسخ بلند.',
      en: 'Default: flagship models first, deep reasoning, three independent analyses, an adversarial review of the draft, and a long-answer budget.'
    },
    collaborationFloor: 4,
    collaborationCeiling: 5,
    tokenScale: 1.6,
    tokenFloor: 1200,
    tokenCeiling: 3200,
    temperature: 0.25,
    reasoning: true,
    maxModels: 5,
    /*
     * ─── THE THREE THINGS THAT MAKE "SMARTER" MEAN MORE THAN "BIGGER MODEL" ─
     * A stronger model alone still answers once. Depth comes from comparing
     * independent analyses, forcing the draft through an adversarial review,
     * and giving that review more verified context to check against:
     *   · analysesCount 3 — three independent reads instead of two;
     *   · selfCritique true — one bounded critique/repair pass after the draft,
     *     which can only replace it when the repaired text is substantial;
     *   · knowledgeTopK 6 — more verified product facts in the evidence block.
     */
    analysesCount: 3,
    selfCritique: true,
    knowledgeTopK: 6,
    modelLadders: MAX_MODEL_LADDERS,
    /*
     * ─── WHY THE DEADLINE IS PART OF THE MODE ───────────────────────────────
     * The smartest mode buys depth with TIME as much as with tokens: a flagship
     * with a thinking budget, three independent analyses, a verifier and an
     * adversarial repair pass do not fit inside the 20 s window that was tuned
     * for one 600-token gpt-4o-mini reply. When the window is too small, every
     * stage after the first races against an expired budget, `withDeadline`
     * hands back its fallback, and the deployment answers exactly as it did
     * before the upgrade — a mode that is silently self-defeating. `max`
     * therefore asks for a bigger budget and the server clamps the whole turn
     * under the platform's own wall clock (see `AI_TURN_CEILING_MS`).
     */
    turnDeadlineMs: 45000
  })
});

/** Spellings people (and older clients) actually use for each mode. */
const MODE_ALIASES = Object.freeze({
  swift: 'swift',
  fast: 'swift',
  eco: 'swift',
  quick: 'swift',
  'سریع': 'swift',
  balanced: 'balanced',
  balance: 'balanced',
  normal: 'balanced',
  default: 'balanced',
  'متعادل': 'balanced',
  max: 'max',
  maximum: 'max',
  smart: 'max',
  smartest: 'max',
  deep: 'max',
  best: 'max',
  high: 'max',
  ultra: 'max',
  'باهوش': 'max',
  'باهوش‌ترین': 'max',
  'باهوش‌تر': 'max',
  'حداکثر': 'max',
  'عمیق': 'max',
  /* The words the mode is now labelled with, in the UI and in the request that
     created it. Kept as an alias so «هوش عمیق» typed anywhere — a payload, a
     query string, a saved preference — resolves here rather than to `rejected`. */
  'هوش عمیق': 'max'
});

export function isIntelligenceMode(value) {
  const id = String(value || '').trim().toLowerCase();
  return Boolean(MODE_ALIASES[id]);
}

/**
 * Turn anything a caller can send (a query string, a JSON body, a Persian
 * word, an env var) into a real mode id. Unknown values resolve to `null`
 * instead of silently pretending to be `max` — the resolver below decides
 * what an unknown request means.
 */
export function normalizeIntelligenceMode(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!id) return null;
  return MODE_ALIASES[id] || null;
}

export function getIntelligenceProfile(mode) {
  return INTELLIGENCE_MODES[normalizeIntelligenceMode(mode)] || INTELLIGENCE_MODES.max;
}

/**
 * Resolve the mode for one request.
 *
 * Order, and why:
 *   1. the request — a user who picked "swift" in the UI gets swift;
 *   2. `FBT_AI_INTELLIGENCE` — the deployment-wide default;
 *   3. `max` — because this deployment's explicit product decision is that the
 *      assistant answers with its strongest available brain unless told
 *      otherwise.
 *
 * An UNKNOWN request value never overrides anything: a typo in a URL should
 * not quietly downgrade the assistant, so it is reported in `rejected` and the
 * deployment default applies.
 */
export function resolveIntelligenceMode(requested = null, { env = process.env, defaultMode = 'max' } = {}) {
  const envMode = normalizeIntelligenceMode(env?.FBT_AI_INTELLIGENCE);
  const fallback = envMode || normalizeIntelligenceMode(defaultMode) || 'max';
  if (requested == null || String(requested).trim() === '') {
    return { mode: fallback, requested: null, source: envMode ? 'env' : 'default', rejected: null };
  }
  const wanted = normalizeIntelligenceMode(requested);
  if (!wanted) {
    return {
      mode: fallback,
      requested: String(requested).slice(0, 32),
      source: envMode ? 'env' : 'default',
      rejected: 'UNKNOWN_MODE'
    };
  }
  return {
    mode: wanted,
    requested: wanted,
    source: 'request',
    rejected: envMode && envMode !== wanted ? 'ENV_OVERRIDDEN' : null
  };
}

/** The flagship-first model ids for one provider in one mode (may be empty). */
export function intelligenceModelLadder(providerId, mode) {
  const profile = getIntelligenceProfile(mode);
  const ladder = profile.modelLadders?.[providerId];
  return Array.isArray(ladder) ? ladder.slice() : [];
}

/**
 * Provider order for a task under an explicit mode.
 * Returns `null` when the mode does not re-order anything (swift/balanced), so
 * the caller can keep its historical route untouched.
 */
export function intelligenceProviderOrder(taskType, mode) {
  /* No mode means "historical": a caller that did not ask for one must get the
     untouched route, not the default mode's route. */
  if (normalizeIntelligenceMode(mode) !== 'max') return null;
  const task = String(taskType || 'general').toLowerCase();
  /* Latency-bound jobs stay latency-bound even in the smartest mode: spending
     two seconds choosing which model should classify "hi" is not intelligence. */
  if (['fast', 'intent', 'classification'].includes(task)) return null;
  const key = MAX_PROVIDER_ORDER[task] ? task : (TASK_ALIASES[task] || null);
  return key ? MAX_PROVIDER_ORDER[key].slice() : MAX_PROVIDER_ORDER.general.slice();
}

/**
 * Sampling + budget for one call.
 *
 * `max` lowers temperature slightly (stable, auditable reasoning), gives a
 * long answer room, and never shrinks a budget a caller explicitly asked for.
 * `swift` is the only mode allowed to shrink one.
 */
export function intelligenceGeneration(mode, { temperature = 0.3, maxTokens = 800, taskType = 'general' } = {}) {
  const profile = getIntelligenceProfile(mode);
  const requestedTokens = Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0 ? Number(maxTokens) : 800;
  const requestedTemp = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.3;

  if (profile.id === 'balanced') {
    return { mode: profile.id, temperature: requestedTemp, maxTokens: requestedTokens, reasoning: false };
  }

  const scaled = Math.round(requestedTokens * profile.tokenScale);
  const withFloor = profile.tokenFloor > 0 ? Math.max(scaled, profile.tokenFloor) : scaled;
  const capped = Math.min(withFloor, profile.tokenCeiling);
  /* A fast/intent classification must not be turned into an essay. */
  const latencyBound = ['fast', 'intent', 'classification'].includes(String(taskType || '').toLowerCase());
  const tokens = latencyBound ? Math.min(capped, requestedTokens) : capped;

  return {
    mode: profile.id,
    temperature: profile.temperature == null ? requestedTemp : Math.min(requestedTemp, profile.temperature),
    maxTokens: Math.max(1, tokens),
    reasoning: Boolean(profile.reasoning) && !latencyBound
  };
}

/** Does this model id expose a reasoning knob the provider documents? */
function isOpenAIReasoningModel(model) {
  return /^(gpt-5|o[1-9])([.-]|$)/i.test(String(model || ''));
}

function isGatewayReasoningModel(model) {
  return /(gpt-5|(^|[/-])o[1-9]([.-]|$)|deepseek-r1|deepseek-reasoner|qwq|thinking)/i.test(String(model || ''));
}

function isGroqReasoningModel(model) {
  return /gpt-oss/i.test(String(model || ''));
}

/**
 * ─── THE FREE-TIER REASONING MODELS ────────────────────────────────────────
 *
 * The original matcher (`isGatewayReasoningModel`) only recognised ids that
 * literally spell a reasoning family: `gpt-5`, `o1`..`o9`, `deepseek-r1`,
 * `deepseek-reasoner`, `qwq`, `thinking`. That regex was written when the
 * gateway only ever spoke to paid catalogues.
 *
 * The free catalogues are different, and they were silently losing their
 * reasoning knob:
 *
 *   · OpenRouter's free tier serves NVIDIA's Nemotron family. The flagship
 *     `nvidia/nemotron-3-ultra-550b-a55b:free` is a reasoning AND
 *     orchestration model — it thinks by default — but no substring of its id
 *     matched, so the gateway sent it a plain request with no reasoning
 *     budget. The model still reasoned (it reasons by default), but the
 *     gateway could not ask for MORE of it, which is the whole point of the
 *     smartest mode. `nemotron-3.5-lightning` and
 *     `nemotron-3-nano-omni-...-reasoning` are the same story.
 *
 *   · Cloudflare's free tier serves `@cf/deepseek/deepseek-r1-distill-qwen-32b`
 *     — an R1 distill, i.e. a reasoning model — under a `@cf/` prefix that
 *     the matcher never saw, because `workersai` had no reasoning branch at
 *     all.
 *
 * So this matcher names the free reasoning families explicitly. It is
 * deliberately narrow: a false positive would send a `reasoning` field to a
 * model that does not accept it, and that is how a "smarter" switch becomes a
 * 400 on every request — the exact failure the original comment warns about.
 */
function isFreeTierReasoningModel(model) {
  /*
   * ONLY the Nemotron family, and only the members that were verified to
   * expose a reasoning knob on the free tier in November 2026:
   *
   *   · nvidia/nemotron-3-ultra-550b-a55b:free — reasoning + orchestration;
   *   · nvidia/nemotron-3.5-super-vl:free — tools + reasoning;
   *   · nvidia/nemotron-3.5-lightning:free — tools + reasoning;
   *   · nvidia/nemotron-3-nano-omni-...-reasoning:free — reasoning.
   *
   * `google/gemma-4-*` is deliberately NOT here: Gemma 4's thinking is
   * optional rather than a documented effort knob, and `cohere/north-mini-code`
   * has none at all. A false positive sends a field the model rejects, and
   * that is how a "smarter" switch becomes a 400 on every request — so the
   * matcher names only what was actually verified.
   */
  return /nemotron-3(\.5)?-(ultra|super-vl|lightning|nano)|nemotron-3.*reasoning/i.test(String(model || ''));
}

/**
 * Cloudflare Workers AI reasoning models. The `@cf/` prefix hides the family
 * name from the shared matcher, so it gets its own branch.
 *
 * Two families qualify:
 *   · `qwen3.8-27b`   — Cloudflare documents Reasoning: low | medium | xhigh
 *   · `deepseek-r1-*` — the R1 distill, which reasons by construction
 *
 * The matcher is deliberately narrow. A false positive sends a `reasoning`
 * field to a model that does not accept it, and that is how a "smarter"
 * switch becomes a 400 on every request.
 */
function isWorkersAIReasoningModel(model) {
  const id = String(model || '');
  return /deepseek-r1/i.test(id) || /qwen3\.8-27b/i.test(id);
}

function isAnthropicThinkingModel(model) {
  /* Claude 4.x and later run extended thinking; the 3.x family does not. */
  return /claude-(sonnet|opus|haiku)-(?:[4-9]|\d{2,})/i.test(String(model || '')) && !/claude-3/i.test(String(model || ''));
}

function isGeminiThinkingModel(model) {
  return /^gemini-2\.5-(pro|flash)$/i.test(String(model || '').trim());
}

/**
 * Extra JSON body fields for the OpenAI-compatible adapter.
 * Only the vendors that document the field get it:
 *   · OpenAI direct — `reasoning_effort` on o-series / gpt-5 only;
 *   · OpenRouter   — `reasoning: { effort }` on reasoning-capable ids;
 *   · Groq         — `reasoning_effort` on gpt-oss.
 * Everything else returns `{}` and the request body is byte-identical to
 * before this module existed.
 *
 * ─── AND THE FREE SEATS ────────────────────────────────────────────────────
 * Two additions, both about models the gateway was calling WITHOUT their
 * reasoning knob:
 *
 *   · `openrouterfree` — the free `:free` Nemotron ids reason by default,
 *     but the gateway never sent a reasoning budget, so the smartest mode
 *     could not ask for more depth from the deepest free model there is.
 *     OpenRouter documents `reasoning: { effort }` for reasoning-capable ids
 *     on both the paid and the free catalogue, so the same field applies.
 *   · `workersai` — Cloudflare's `@cf/deepseek/deepseek-r1-distill-qwen-32b`
 *     is an R1 distill and had NO branch at all. Workers AI accepts
 *     `reasoning_effort` on its reasoning models.
 *
 * `isFreeTierReasoningModel` is narrow on purpose: a false positive sends a
 * field the model rejects, and that is how a "smarter" switch becomes a 400
 * on every request.
 */
export function intelligenceReasoningFields(providerId, mode, model) {
  if (!getIntelligenceProfile(mode).reasoning) return {};
  const id = String(providerId || '');
  const m = String(model || '');
  if (id === 'openai' && isOpenAIReasoningModel(m)) return { reasoning_effort: 'high' };
  if (id === 'groq' && isGroqReasoningModel(m)) return { reasoning_effort: 'high' };
  if (id === 'openrouter' && isGatewayReasoningModel(m)) return { reasoning: { effort: 'high' } };
  if (id === 'aimlapi' && isGatewayReasoningModel(m)) return { reasoning_effort: 'high' };
  if (id === 'openrouterfree' && (isGatewayReasoningModel(m) || isFreeTierReasoningModel(m))) {
    return { reasoning: { effort: 'high' } };
  }
  if (id === 'workersai' && isWorkersAIReasoningModel(m)) return { reasoning_effort: 'high' };
  return {};
}

/**
 * Gemini native `generationConfig` additions. `thinkingBudget` is accepted on
 * the 2.5 Pro/Flash family; -1 is the vendor's "let the model decide".
 */
export function intelligenceGeminiThinking(mode, model) {
  if (!getIntelligenceProfile(mode).reasoning) return {};
  if (!isGeminiThinkingModel(model)) return {};
  return { thinkingConfig: { includeThoughts: false, thinkingBudget: /pro/i.test(String(model)) ? -1 : 4096 } };
}

/**
 * Anthropic extended thinking for one call.
 *
 * Returns `null` when the mode/model/operator switch does not allow it, so the
 * caller sends the old body unchanged. When enabled:
 *   · `budget_tokens` must be smaller than `max_tokens`, so the output budget
 *     is raised to fit the reasoning plus the answer;
 *   · the API rejects sampling parameters while thinking is on, so temperature
 *     must be omitted (the adapter already knows how to retry without it).
 */
export function intelligenceAnthropicThinking(mode, model, maxTokens = 800, { env = process.env } = {}) {
  if (!getIntelligenceProfile(mode).reasoning) return null;
  if (String(env?.FBT_AI_EXTENDED_THINKING ?? '').trim() === '0') return null;
  if (!isAnthropicThinkingModel(model)) return null;
  /*
   * The budget scales with the answer we asked for: an 800-token role call
   * does not need Claude to think for 4096 tokens (that is 4096 tokens of
   * latency inside an 8–20s turn deadline). Minimum is the vendor's 1024;
   * maximum is 4096.
   */
  const requested = Math.max(0, Number(maxTokens) || 0);
  const budget = Math.min(4096, Math.max(1024, Math.round(requested)));
  const total = Math.min(12000, Math.max(requested, budget + 1024));
  return {
    thinking: { type: 'enabled', budget_tokens: budget },
    maxTokens: total,
    omitTemperature: true
  };
}

/**
 * Hard wall-clock ceiling for ONE AI turn, whatever the mode asked for.
 *
 * Vercel runs `api/index.js` with `maxDuration: 60`; a function killed mid-await
 * returns nothing at all, so an over-long budget is worse than a short one — it
 * turns "the deep answer arrived late" into "the request errored and the client
 * kept its deterministic reply". 52 s leaves the response time to flush.
 */
export function turnCeilingMs(env = process.env) {
  const configured = Number(env?.AI_TURN_CEILING_MS);
  return Number.isFinite(configured) && configured >= 5000
    ? Math.min(configured, 58000)
    : 52000;
}

/**
 * ─── THE CEILING THE ROUTE ACTUALLY USES: PLATFORM-SAFE, NOT MODEL-FRIENDLY ──
 * `turnCeilingMs()` answers «how long may a turn think?». This answers «how long
 * may it think before the host kills the request?», and the answer is smaller:
 * the serverless function has 60 s (`functions.api/index.js .maxDuration` in
 * vercel.json), and the cold start, the context reads, the pending-intent write
 * and the JSON serialisation all happen inside the same 60 s.
 *
 * The gap was visible as a dead deep mode: a turn that spent a 52 s ceiling was
 * aborted by the platform with nothing to show, while the browser waited its own
 * 58 s for an answer that no longer existed — the orb spun, and «Service
 * temporarily unavailable» was the only output of the smartest mode.
 *
 * The reserve is 18 s by default (`AI_TURN_HEADROOM_MS` overrides it, never below
 * 5 s), and the result can only ever be SMALLER than `turnCeilingMs()`: this is a
 * safety clamp, not a second opinion about depth. The mode's published deadline
 * is untouched, so the contract the panel shows stays honest.
 */
export function turnSafeCeilingMs(env = process.env) {
  const PLATFORM_FUNCTION_LIMIT_MS = 60000;
  const configured = Number(env?.AI_TURN_HEADROOM_MS);
  const reserve = Number.isFinite(configured) && configured >= 5000 ? configured : 18000;
  return Math.max(5000, Math.min(turnCeilingMs(env), PLATFORM_FUNCTION_LIMIT_MS - reserve));
}

/**
 * Latency budget for one collaborative turn under a mode.
 *
 *   1. an explicit `requested` budget — a caller that knows better (the
 *      `/analyze` route forwards an operator-supplied `deadlineMs`);
 *   2. `AI_COLLAB_DEADLINE_MS` — the deployment's own word, which predates the
 *      modes and is still obeyed to the letter;
 *   3. the mode's budget — 8 s swift, 20 s balanced (the historical value),
 *      45 s smartest.
 *
 * Then the result is clamped into [MIN_TURN_MS, `AI_TURN_CEILING_MS`], so a
 * typo in any of the three cannot produce either a turn that never returns or
 * a 500 ms budget that guarantees every stage degrades.
 */
export function intelligenceDeadlineMs(mode, requested = null, { env = process.env } = {}) {
  const profile = getIntelligenceProfile(mode);
  const explicit = Number(requested);
  const fromEnv = Number(env?.AI_COLLAB_DEADLINE_MS);
  const MIN = 2000;
  const base = Number.isFinite(explicit) && explicit >= MIN
    ? explicit
    : (Number.isFinite(fromEnv) && fromEnv >= MIN ? fromEnv : profile.turnDeadlineMs);
  const ceiling = turnCeilingMs(env);
  return {
    mode: profile.id,
    deadlineMs: Math.max(MIN, Math.min(base, ceiling)),
    ceilingMs: ceiling,
    source: (Number.isFinite(explicit) && explicit >= MIN)
      ? 'request'
      : (Number.isFinite(fromEnv) && fromEnv >= MIN ? 'env' : 'mode')
  };
}

/**
 * Collaboration depth for one plan.
 *   · max      raises substantive turns to at least level 4 (multi-model +
 *              verification) but NEVER turns small talk into a five-model run;
 *   · swift    caps the level so a simple question cannot become expensive;
 *   · balanced returns the analyzer's own level untouched.
 */
export function intelligenceCollaborationLevel(mode, baseLevel, { conversationKind = null, pureSmallTalk = false } = {}) {
  const profile = getIntelligenceProfile(mode);
  const level = Number.isFinite(Number(baseLevel)) ? Number(baseLevel) : 2;
  const smallTalk = pureSmallTalk
    || ['GREETING', 'THANKS', 'CASUAL', 'WHATS_UP'].includes(String(conversationKind || '').toUpperCase());
  if (smallTalk) return Math.min(level, 2);
  if (profile.id === 'max') {
    /* A high-stakes question was already 5; everything substantive becomes at
       least 4. A turn the analyzer called level 1 for a real (non-social)
       question is raised too, because a one-model answer is the behaviour the
       operator asked to stop. */
    return Math.max(level, profile.collaborationFloor);
  }
  return Math.min(level, profile.collaborationCeiling);
}

/** Human + machine description for the API and the UI. */
export function describeIntelligence({ env = process.env, requested = null } = {}) {
  const resolved = resolveIntelligenceMode(requested, { env });
  const profile = getIntelligenceProfile(resolved.mode);
  const budget = intelligenceDeadlineMs(profile.id, null, { env });
  return {
    schema: INTELLIGENCE_SCHEMA,
    version: INTELLIGENCE_VERSION,
    mode: profile.id,
    label: profile.label,
    description: profile.description,
    source: resolved.source,
    requested: resolved.requested,
    rejected: resolved.rejected,
    defaultMode: resolveIntelligenceMode(null, { env }).mode,
    envVar: 'FBT_AI_INTELLIGENCE',
    extendedThinkingEnvVar: 'FBT_AI_EXTENDED_THINKING',
    features: {
      collaborationFloor: profile.collaborationFloor,
      collaborationCeiling: profile.collaborationCeiling,
      tokenScale: profile.tokenScale,
      tokenFloor: profile.tokenFloor,
      tokenCeiling: profile.tokenCeiling,
      maxModels: profile.maxModels,
      analysesCount: profile.analysesCount,
      selfCritique: profile.selfCritique,
      knowledgeTopK: profile.knowledgeTopK,
      reasoning: profile.reasoning,
      flagshipFirst: Object.keys(profile.modelLadders || {}).length > 0,
      /* The latency budget this mode needs, and the ceiling the server clamps
         it into. Published because a mode that cannot finish is indistinguishable
         from a mode that never ran, and the panel must be able to tell them apart. */
      turnDeadlineMs: budget.deadlineMs,
      turnCeilingMs: budget.ceilingMs,
      deadlineSource: budget.source
    },
    modes: Object.values(INTELLIGENCE_MODES).map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      default: m.id === resolveIntelligenceMode(null, { env }).mode
    })),
    /* An honest boundary, stated where a client can render it. */
    authority: { canExecute: false, canSign: false, canMoveFunds: false }
  };
}
