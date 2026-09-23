/**
 * FBT AI CONSENSUS & DEBATE ENGINE
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade — AI Debate / Consensus
 *
 * For high-stakes, strategic, or complex financial intent:
 *   - Never relies on a single model.
 *   - Orchestrates multi-model reasoning & debate across diverse AI models
 *     (e.g., OpenRouter for market intelligence, Anthropic Claude for risk/logic,
 *     Gemini / Groq for speed & verification, Internal engine for ground truth).
 *   - Evaluates convergence and divergence.
 *   - Computes:
 *       • consensusReached (boolean)
 *       • confidenceScore (0-100%)
 *       • riskScore ('LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME')
 *       • aiAgreement (e.g., "3/3 agreeing", "2/3 divergent")
 *       • reasons (key supporting factors)
 *       • conflictingOpinions (divergent viewpoints)
 *       • lowConfidence (flagged if divergence is high or confidence < 60%)
 */

import { parallelMultiProviderChat, getActiveProviderIds, isProviderConfigured, executeProviderChat } from './aiGateway.js';

function parseJsonSafe(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * System prompts tailored for specific debate roles:
 */
const ROLE_PROMPTS = {
  market_intelligence: `You are the Market Intelligence Agent for FBT Smart Intent OS.
Analyze market momentum, on-chain liquidity, macro trends, and asset drivers.
Respond in STRICT JSON:
{
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": 0-100,
  "riskLevel": "low" | "medium" | "high" | "extreme",
  "keyDrivers": ["driver 1", "driver 2"],
  "mainRisks": ["risk 1", "risk 2"],
  "summary": "2 concise sentences explaining market conditions"
}`,

  risk_guardian: `You are the Risk & Safety Guardian for FBT Smart Intent OS.
Your role is to rigorously scrutinize proposed strategies for downside risks, liquidity traps, excessive slippage, volatility shocks, and liquidation danger.
Respond in STRICT JSON:
{
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": 0-100,
  "riskLevel": "low" | "medium" | "high" | "extreme",
  "keyDrivers": ["driver 1", "driver 2"],
  "mainRisks": ["downside risk 1", "downside risk 2"],
  "summary": "2 concise sentences focusing on capital preservation and safety constraints"
}`,

  strategy_architect: `You are the Strategy Architect for FBT Smart Intent OS.
Formulate optimal, actionable financial strategy (spot swap, DCA, lending, rebalance) aligned with capital efficiency and user risk tolerance.
Respond in STRICT JSON:
{
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": 0-100,
  "riskLevel": "low" | "medium" | "high" | "extreme",
  "keyDrivers": ["strategy advantage 1", "strategy advantage 2"],
  "mainRisks": ["execution risk 1", "market risk 2"],
  "summary": "2 concise sentences describing the optimal action plan"
}`
};

// Specialized multi-model routing via OpenRouter and Groq.
// The market-intelligence seat was Grok's, served through OpenRouter as
// `x-ai/grok-2`. Grok is no longer a registered provider, so the seat goes to
// the deployment's own OpenRouter default model.
const ROLE_MODELS = {
  openrouter: {
    market_intelligence: process.env.AI_MODEL || 'openai/gpt-4o-mini',
    risk_guardian: 'anthropic/claude-3.5-sonnet',
    strategy_architect: 'deepseek/deepseek-chat'
  },
  groq: {
    market_intelligence: 'llama-3.3-70b-versatile',
    risk_guardian: 'llama-3.3-70b-versatile',
    strategy_architect: 'mixtral-8x7b-32768'
  }
};

/**
 * Run Multi-AI Debate and calculate Consensus.
 *
 * @param {object} params
 * @param {string} params.message - user prompt/intent
 * @param {object} params.context - live wallet/market context
 * @param {string} [params.locale] - 'fa' | 'en'
 * @param {string[]} [params.preferredProviders] - optional list of provider IDs
 */
export function synthesizeConsensus(responses = []) {
  if (!Array.isArray(responses) || responses.length === 0) {
    return {
      intent: 'GENERAL',
      agreementScore: 100,
      confidenceScore: 80,
      divergenceDetected: false,
      reasons: []
    };
  }

  const intentCounts = {};
  let totalConfidence = 0;

  for (const r of responses) {
    const intent = r.plan?.intent || r.intent || r.type || 'GENERAL';
    intentCounts[intent] = (intentCounts[intent] || 0) + 1;
    const conf = Number(r.confidence || 0.8) > 1 ? Number(r.confidence) : Number(r.confidence || 0.8) * 100;
    totalConfidence += conf;
  }

  const dominantIntent = Object.keys(intentCounts).reduce((a, b) => (intentCounts[a] >= intentCounts[b] ? a : b));
  const dominantCount = intentCounts[dominantIntent];
  const total = responses.length;
  const agreementRatio = `${dominantCount}/${total}`;
  const agreementScore = Math.round((dominantCount / total) * 100);
  const avgConfidence = Math.round(totalConfidence / total);
  const divergenceDetected = total > 1 && (dominantCount / total) < 0.67;

  return {
    intent: dominantIntent,
    agreementRatio,
    agreementScore,
    confidenceScore: divergenceDetected ? Math.max(30, Math.round(avgConfidence * 0.75)) : avgConfidence,
    divergenceDetected,
    modelsConsulted: responses.map((r) => ({
      provider: r.provider || 'unknown',
      model: r.model || 'default',
      confidence: r.confidence
    }))
  };
}

export async function runMultiAiDebate({
  message = '',
  context = {},
  locale = 'fa',
  preferredProviders = []
} = {}) {
  const active = getActiveProviderIds();
  
  // Select active providers prioritizing Groq and OpenRouter
  let debateProviders = preferredProviders.filter(isProviderConfigured);
  if (!debateProviders.length) {
    const priority = ['groq', 'openrouter', 'gemini', 'deepseek', 'anthropic', 'aimlapi', 'mistral', 'workersai'];
    debateProviders = priority.filter((p) => active.includes(p)).slice(0, 3);
  }

  // If only OpenRouter is configured, we run multi-model debate across diverse models on OpenRouter (GPT-4o, Claude, DeepSeek)
  let executionPlan = [];
  if (debateProviders.includes('openrouter') && debateProviders.length === 1) {
    executionPlan = [
      { provider: 'openrouter', role: 'market_intelligence', model: ROLE_MODELS.openrouter.market_intelligence },
      { provider: 'openrouter', role: 'risk_guardian', model: 'anthropic/claude-3.5-sonnet' },
      { provider: 'openrouter', role: 'strategy_architect', model: 'deepseek/deepseek-chat' }
    ];
  } else if (debateProviders.includes('groq') && debateProviders.includes('openrouter')) {
    executionPlan = [
      { provider: 'groq', role: 'market_intelligence', model: 'llama-3.3-70b-versatile' },
      { provider: 'openrouter', role: 'risk_guardian', model: 'anthropic/claude-3.5-sonnet' },
      { provider: 'openrouter', role: 'strategy_architect', model: 'deepseek/deepseek-chat' }
    ];
  } else {
    const roles = ['market_intelligence', 'risk_guardian', 'strategy_architect'];
    if (debateProviders.length === 0) debateProviders = ['internal'];
    if (debateProviders.length === 1 && !debateProviders.includes('internal')) debateProviders.push('internal');
    executionPlan = debateProviders.map((p, idx) => ({
      provider: p,
      role: roles[idx % roles.length],
      model: ROLE_MODELS[p]?.[roles[idx % roles.length]] || null
    }));
  }

  const isPersian = locale.startsWith('fa') || /[آ-ی]/.test(message);

  // Build context summary for models
  const liveMarket = context.market || {};
  const livePortfolio = context.portfolio || {};
  const userPrompt = [
    `User Intent: "${message}"`,
    liveMarket.priceMap ? `Live Prices: ${JSON.stringify(liveMarket.priceMap).slice(0, 300)}` : '',
    livePortfolio.totalValueUsd ? `Portfolio Size: $${livePortfolio.totalValueUsd}` : '',
    context.preferences ? `User Risk Preference: ${JSON.stringify(context.preferences)}` : '',
    isPersian ? 'Note: Write summary and reason texts in clear Persian (فارسی). Keep JSON keys in English.' : 'Write summary and reasons in English.'
  ].filter(Boolean).join('\n');

  // Execute queries across assigned roles in parallel
  const debateTasks = executionPlan.map(async (task) => {
    const providerId = task.provider;
    const roleKey = task.role;
    const assignedModel = task.model;
    const systemPrompt = ROLE_PROMPTS[roleKey];
    const start = Date.now();

    try {
      const res = await executeProviderChat(providerId, {
        system: systemPrompt,
        user: userPrompt,
        model: assignedModel,
        temperature: 0.25,
        maxTokens: 500,
        json: true
      });

      const parsed = parseJsonSafe(res.text) || {
        bias: 'neutral',
        confidence: 65,
        riskLevel: 'medium',
        keyDrivers: ['تحلیل ساختاری روند بازار'],
        mainRisks: ['نوسانات عمومی بازار'],
        summary: res.text.slice(0, 180)
      };

      return {
        provider: providerId,
        providerName: res.providerName,
        model: res.model,
        role: roleKey,
        bias: ['bullish', 'bearish', 'neutral'].includes(parsed.bias) ? parsed.bias : 'neutral',
        confidence: Math.min(95, Math.max(10, Number(parsed.confidence) || 60)),
        riskLevel: ['low', 'medium', 'high', 'extreme'].includes(parsed.riskLevel?.toLowerCase())
          ? parsed.riskLevel.toUpperCase()
          : 'MEDIUM',
        keyDrivers: Array.isArray(parsed.keyDrivers) ? parsed.keyDrivers.slice(0, 3) : [],
        mainRisks: Array.isArray(parsed.mainRisks) ? parsed.mainRisks.slice(0, 3) : [],
        summary: String(parsed.summary || '').slice(0, 240),
        latencyMs: Date.now() - start,
        ok: true
      };
    } catch (err) {
      return {
        provider: providerId,
        providerName: providerId,
        model: 'failed',
        role: roleKey,
        bias: 'neutral',
        confidence: 40,
        riskLevel: 'MEDIUM',
        keyDrivers: [],
        mainRisks: ['عدم پاسخگویی سرویس مدل'],
        summary: 'خطا در ارتباط با مدل',
        latencyMs: Date.now() - start,
        ok: false,
        error: err.message
      };
    }
  });

  const modelEvaluations = await Promise.all(debateTasks);

  // ---------------------------------------------------------------------------
  // Consensus Synthesis
  // ---------------------------------------------------------------------------

  const validEvals = modelEvaluations.filter((e) => e.ok);
  const totalModels = validEvals.length || 1;

  // Bias count
  const biases = { bullish: 0, bearish: 0, neutral: 0 };
  let totalConf = 0;
  const riskScores = { LOW: 1, MEDIUM: 2, HIGH: 3, EXTREME: 4 };
  let weightedRisk = 0;

  for (const ev of validEvals) {
    biases[ev.bias] = (biases[ev.bias] || 0) + 1;
    totalConf += ev.confidence;
    weightedRisk += riskScores[ev.riskLevel] || 2;
  }

  const dominantBias = Object.keys(biases).reduce((a, b) => (biases[a] >= biases[b] ? a : b));
  const dominantCount = biases[dominantBias];
  const agreementRatio = `${dominantCount}/${totalModels}`;

  // Average confidence
  let avgConfidence = Math.round(totalConf / totalModels);

  // Divergence calculation
  const divergenceDetected = totalModels > 1 && (dominantCount / totalModels) < 0.67;
  if (divergenceDetected) {
    avgConfidence = Math.max(30, Math.round(avgConfidence * 0.75)); // penalize confidence when models disagree
  }

  // Consensus Risk Level
  const avgRiskVal = weightedRisk / totalModels;
  const finalRiskLevel = avgRiskVal >= 3.3 ? 'EXTREME' : avgRiskVal >= 2.4 ? 'HIGH' : avgRiskVal >= 1.6 ? 'MEDIUM' : 'LOW';

  // Extract conflicting opinions & unified drivers
  const conflictingOpinions = [];
  const allDrivers = new Set();
  const allRisks = new Set();

  for (const ev of validEvals) {
    ev.keyDrivers.forEach((d) => allDrivers.add(d));
    ev.mainRisks.forEach((r) => allRisks.add(r));
    if (ev.bias !== dominantBias && totalModels > 1) {
      conflictingOpinions.push(`${ev.providerName} دیدگاه متفاوتی (${ev.bias}) با تأکید بر: ${ev.mainRisks[0] || ev.summary} دارد.`);
    }
  }

  // Generate unified Persian/English summary
  let consensusSummary = '';
  if (isPersian) {
    if (divergenceDetected) {
      consensusSummary = `مدل‌های هوش مصنوعی در تحلیل این درخواست همگرایی کامل ندارند (${agreementRatio} توافق). به دلیل وجود دیدگاه‌های متضاد، سطح اطمینان روی ${avgConfidence}٪ تنظیم شده و رعایت احتیاط الزامی است.`;
    } else {
      consensusSummary = `اجماع هوش مصنوعی با اطمینان ${avgConfidence}٪ و توافق ${agreementRatio} بر موضع ${dominantBias === 'bullish' ? 'مثبت/رشد' : dominantBias === 'bearish' ? 'محتاطانه/نزولی' : 'خنثی/متعادل'} است. سطح ریسک ارزیابی‌شده: ${finalRiskLevel}.`;
    }
  } else {
    if (divergenceDetected) {
      consensusSummary = `AI models showed divergence on this inquiry (${agreementRatio} agreement). Confidence is calibrated to ${avgConfidence}% due to conflicting market factors. Caution is advised.`;
    } else {
      consensusSummary = `AI Consensus reached with ${avgConfidence}% confidence (${agreementRatio} agreement) on ${dominantBias.toUpperCase()} outlook. Evaluated Risk: ${finalRiskLevel}.`;
    }
  }

  return {
    consensusReached: !divergenceDetected,
    agreementRatio,
    dominantBias,
    confidenceScore: avgConfidence,
    riskScore: finalRiskLevel,
    divergenceDetected,
    lowConfidence: avgConfidence < 60 || divergenceDetected,
    consensusSummary,
    reasons: Array.from(allDrivers).slice(0, 4),
    risks: Array.from(allRisks).slice(0, 4),
    conflictingOpinions,
    modelsConsulted: modelEvaluations.map((m) => ({
      provider: m.provider,
      providerName: m.providerName,
      model: m.model,
      role: m.role,
      bias: m.bias,
      confidence: m.confidence,
      riskLevel: m.riskLevel,
      summary: m.summary
    })),
    timestamp: Date.now()
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL DEBATE — Bull vs Bear, then a Judge
 * ---------------------------------------------------------------------------
 * Pattern from TradingAgents (TauricResearch, Apache-2.0): instead of three
 * parallel opinions that are averaged, two researchers argue OPPOSITE sides
 * over the same evidence for up to N rounds, each seeing the other's last
 * argument, and a third model — the judge — rules on the transcript.
 *
 * Why this beats averaging for a trading question: averaged opinions converge
 * on "neutral, medium risk" because every model hedges. Forcing one model to
 * make the strongest honest bear case surfaces the risks a single optimistic
 * answer hides; the judge must then say which case the EVIDENCE supports.
 *
 * Honesty laws (unchanged from the rest of this file):
 *   · The judge's verdict is advice. It cannot sign, send or approve anything.
 *   · When fewer than two external models answer, the debate is reported as
 *     `degraded: true` with the internal engine's deterministic view — never
 *     dressed up as a real debate.
 *   · Confidence is capped at 85: a debate between language models is not
 *     evidence of the future.
 *   · Past losses (reflection memory) are shown to both sides so a pattern
 *     that already cost money is argued about, not repeated.
 * ─────────────────────────────────────────────────────────────────────────── */

export const ADVERSARIAL_DEBATE_SCHEMA = 'fbt.ai-debate.adversarial.v1';
const MAX_CONFIDENCE = 85;

const SIDE_PROMPT = (side) => `You are the ${side === 'bull' ? 'BULL' : 'BEAR'} researcher at FBT Smart Intent OS.
Make the strongest HONEST ${side === 'bull' ? 'case FOR' : 'case AGAINST'} the user's intent, using ONLY the evidence given.
Do not invent prices, news or numbers. If the evidence is thin, say so — a weak honest case beats a strong invented one.
If an opposing argument is provided, rebut its strongest point directly.
Respond in STRICT JSON:
{
  "thesis": "one sentence",
  "arguments": ["argument 1", "argument 2", "argument 3"],
  "rebuttal": "one sentence answering the other side, or empty on round 1",
  "conviction": 0-100
}`;

const JUDGE_PROMPT = `You are the JUDGE at FBT Smart Intent OS. Two researchers argued opposite sides of a user's intent.
Rule on which case the EVIDENCE better supports — not which was more eloquent. Unsupported claims count for nothing.
You never promise returns and you never tell the user to act; you describe the balance of evidence and the main risk.
Respond in STRICT JSON:
{
  "verdict": "bull" | "bear" | "balanced",
  "stance": "proceed" | "reduce" | "wait" | "avoid",
  "confidence": 0-100,
  "riskLevel": "low" | "medium" | "high" | "extreme",
  "decisiveArgument": "the single argument that decided it",
  "mainRisk": "the biggest risk even if the verdict is bull",
  "summary": "2 concise sentences for the user"
}`;

const clip = (s, n) => String(s || '').slice(0, n);
const arr = (a, n = 3, len = 200) => (Array.isArray(a) ? a.slice(0, n).map((x) => clip(x, len)).filter(Boolean) : []);

function pickDebateSeats(preferredProviders = []) {
  const active = getActiveProviderIds().filter((p) => p !== 'internal');
  const preferred = preferredProviders.filter((p) => isProviderConfigured(p) && p !== 'internal');
  const priority = ['anthropic', 'openrouter', 'deepseek', 'gemini', 'groq', 'aimlapi', 'mistral', 'workersai'];
  const pool = [...new Set([...preferred, ...priority.filter((p) => active.includes(p))])];
  if (!pool.length) return null;
  /* Distinct providers per seat when we have them: a model arguing with
     itself is a weaker debate. With one provider on OpenRouter we still get
     distinct MODELS behind it. */
  if (pool.length === 1 && pool[0] === 'openrouter') {
    return {
      bull: { provider: 'openrouter', model: 'deepseek/deepseek-chat' },
      bear: { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
      judge: { provider: 'openrouter', model: process.env.AI_MODEL || 'openai/gpt-4o-mini' }
    };
  }
  return {
    bull: { provider: pool[0 % pool.length], model: null },
    bear: { provider: pool[1 % pool.length], model: null },
    judge: { provider: pool[2 % pool.length], model: null }
  };
}

function evidenceBlock({ message, context, reflection, isPersian }) {
  const m = context.market || {};
  const p = context.portfolio || {};
  return [
    `User intent: "${clip(message, 400)}"`,
    m.priceMap ? `Live prices: ${clip(JSON.stringify(m.priceMap), 400)}` : '',
    m.regime ? `Market regime: ${clip(JSON.stringify(m.regime), 200)}` : '',
    context.signals ? `Signals: ${clip(JSON.stringify(context.signals), 400)}` : '',
    context.news ? `Recent news: ${clip(JSON.stringify(context.news), 500)}` : '',
    p.totalValueUsd ? `Portfolio size: $${Math.round(Number(p.totalValueUsd))}` : '',
    context.preferences ? `User risk preference: ${clip(JSON.stringify(context.preferences), 200)}` : '',
    context.pointInTime?.historical ? `ANALYSIS DATE (no information after this exists): ${context.pointInTime.asOf}` : '',
    reflection?.lines?.length ? `PAST OUTCOMES TO LEARN FROM (do not repeat a pattern that lost money):\n- ${reflection.lines.join('\n- ')}` : '',
    isPersian ? 'Write every text value in clear Persian (فارسی). Keep JSON keys in English.' : 'Write text values in English.'
  ].filter(Boolean).join('\n');
}

async function argue(seat, side, evidence, opponent, execute) {
  const user = opponent
    ? `${evidence}\n\nOPPOSING ARGUMENT TO REBUT:\n${clip(opponent, 900)}`
    : evidence;
  const started = Date.now();
  try {
    const res = await execute(seat.provider, {
      system: SIDE_PROMPT(side),
      user,
      model: seat.model,
      temperature: 0.4,
      maxTokens: 500,
      json: true
    });
    const j = parseJsonSafe(res.text);
    if (!j || !j.thesis) throw new Error('UNPARSEABLE');
    return {
      ok: true,
      side,
      provider: seat.provider,
      model: res.model,
      thesis: clip(j.thesis, 240),
      arguments: arr(j.arguments),
      rebuttal: clip(j.rebuttal, 240),
      conviction: Math.min(95, Math.max(0, Number(j.conviction) || 50)),
      latencyMs: Date.now() - started
    };
  } catch (err) {
    return { ok: false, side, provider: seat.provider, error: clip(err?.message, 120), latencyMs: Date.now() - started };
  }
}

/**
 * Run a Bull-vs-Bear debate with a judge.
 *
 * @param {object} p
 * @param {string} p.message
 * @param {object} [p.context]      live context (market, portfolio, signals, news)
 * @param {string} [p.locale]
 * @param {number} [p.rounds]       1–3, default 2
 * @param {object} [p.reflection]   output of buildReflection() (aiLearning.js)
 * @param {object} [p.deps]         { execute } — injectable for tests
 */
export async function runAdversarialDebate({
  message = '',
  context = {},
  locale = 'fa',
  rounds = 2,
  reflection = null,
  preferredProviders = [],
  deps = {}
} = {}) {
  const execute = deps.execute || executeProviderChat;
  const isPersian = String(locale || 'fa').startsWith('fa') || /[آ-ی]/.test(message);
  const nRounds = Math.min(3, Math.max(1, Math.round(Number(rounds) || 2)));
  const seats = deps.seats || pickDebateSeats(preferredProviders);
  const base = {
    schema: ADVERSARIAL_DEBATE_SCHEMA,
    rounds: 0,
    transcript: [],
    reflectionUsed: Boolean(reflection?.lines?.length),
    executionAuthorized: false,
    at: Date.now()
  };

  if (!seats) {
    return {
      ...base,
      ok: true,
      degraded: true,
      reason: 'NO_EXTERNAL_PROVIDER',
      verdict: 'balanced',
      stance: 'wait',
      confidence: 30,
      riskLevel: 'MEDIUM',
      summary: isPersian
        ? 'هیچ مدل خارجی فعال نیست، پس مناظرهٔ واقعی انجام نشد. بدون مناظره حکم قطعی نمی‌دهم.'
        : 'No external model is configured, so no real debate ran. I will not give a firm verdict without one.'
    };
  }

  const evidence = evidenceBlock({ message, context, reflection, isPersian });
  let lastBull = null;
  let lastBear = null;
  for (let r = 1; r <= nRounds; r += 1) {
    /* Bull speaks first; the Bear answers THIS round's bull argument. */
    const bull = await argue(seats.bull, 'bull', evidence, lastBear ? `${lastBear.thesis}\n${lastBear.arguments.join('\n')}` : null, execute);
    const bear = await argue(seats.bear, 'bear', evidence, bull.ok ? `${bull.thesis}\n${bull.arguments.join('\n')}` : null, execute);
    base.transcript.push({ round: r, bull, bear });
    base.rounds = r;
    if (bull.ok) lastBull = bull;
    if (bear.ok) lastBear = bear;
    if (!bull.ok && !bear.ok) break;
  }

  if (!lastBull || !lastBear) {
    const survivor = lastBull || lastBear;
    return {
      ...base,
      ok: true,
      degraded: true,
      reason: 'ONE_SIDED',
      verdict: 'balanced',
      stance: 'wait',
      confidence: 30,
      riskLevel: 'MEDIUM',
      summary: isPersian
        ? `فقط یک طرف مناظره پاسخ داد${survivor ? ` («${survivor.thesis}»)` : ''}؛ یک‌طرفه حکم نمی‌دهم.`
        : `Only one side of the debate answered${survivor ? ` ("${survivor.thesis}")` : ''}; I will not rule on a one-sided case.`
    };
  }

  const transcriptText = base.transcript.map((t) => [
    t.bull.ok ? `ROUND ${t.round} BULL: ${t.bull.thesis} | ${t.bull.arguments.join(' | ')}${t.bull.rebuttal ? ` | rebuttal: ${t.bull.rebuttal}` : ''}` : `ROUND ${t.round} BULL: (no answer)`,
    t.bear.ok ? `ROUND ${t.round} BEAR: ${t.bear.thesis} | ${t.bear.arguments.join(' | ')}${t.bear.rebuttal ? ` | rebuttal: ${t.bear.rebuttal}` : ''}` : `ROUND ${t.round} BEAR: (no answer)`
  ].join('\n')).join('\n');

  let judge = null;
  try {
    const res = await execute(seats.judge.provider, {
      system: JUDGE_PROMPT,
      user: `${evidence}\n\nDEBATE TRANSCRIPT:\n${transcriptText}`,
      model: seats.judge.model,
      temperature: 0.1,
      maxTokens: 500,
      json: true
    });
    judge = parseJsonSafe(res.text);
    if (judge) judge._provider = seats.judge.provider;
  } catch {
    judge = null;
  }

  if (!judge || !['bull', 'bear', 'balanced'].includes(judge.verdict)) {
    /* Deterministic fallback: the side with higher final conviction, but
       only if the gap is meaningful; otherwise balanced. */
    const gap = lastBull.conviction - lastBear.conviction;
    const verdict = Math.abs(gap) < 15 ? 'balanced' : (gap > 0 ? 'bull' : 'bear');
    return {
      ...base,
      ok: true,
      degraded: true,
      reason: 'JUDGE_UNAVAILABLE',
      verdict,
      stance: verdict === 'bull' ? 'reduce' : 'wait',
      confidence: Math.min(55, 35 + Math.abs(gap) / 2),
      riskLevel: 'MEDIUM',
      bull: { thesis: lastBull.thesis, arguments: lastBull.arguments },
      bear: { thesis: lastBear.thesis, arguments: lastBear.arguments },
      summary: isPersian
        ? 'داور پاسخ نداد؛ حکم از مقایسهٔ ساده‌ی قطعیت دو طرف است و اعتبار کمتری دارد.'
        : 'The judge did not answer; this verdict compares the two sides\' conviction only and is less reliable.'
    };
  }

  const risk = String(judge.riskLevel || 'medium').toUpperCase();
  const riskLevel = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'].includes(risk) ? risk : 'MEDIUM';
  let confidence = Math.min(MAX_CONFIDENCE, Math.max(0, Number(judge.confidence) || 50));
  /* A close debate cannot yield a confident verdict. */
  if (Math.abs(lastBull.conviction - lastBear.conviction) < 10) confidence = Math.min(confidence, 60);
  /* Past losses on this pattern lower confidence in a bullish verdict. */
  if (judge.verdict === 'bull' && reflection?.lossCount > 0) confidence = Math.max(20, confidence - Math.min(20, reflection.lossCount * 5));
  const stance = ['proceed', 'reduce', 'wait', 'avoid'].includes(judge.stance) ? judge.stance : 'wait';

  return {
    ...base,
    ok: true,
    degraded: false,
    verdict: judge.verdict,
    stance: riskLevel === 'EXTREME' && stance === 'proceed' ? 'reduce' : stance,
    confidence: Math.round(confidence),
    riskLevel,
    decisiveArgument: clip(judge.decisiveArgument, 240),
    mainRisk: clip(judge.mainRisk, 240),
    summary: clip(judge.summary, 400),
    bull: { thesis: lastBull.thesis, arguments: lastBull.arguments, conviction: lastBull.conviction },
    bear: { thesis: lastBear.thesis, arguments: lastBear.arguments, conviction: lastBear.conviction },
    seats: { bull: seats.bull.provider, bear: seats.bear.provider, judge: seats.judge.provider }
  };
}
