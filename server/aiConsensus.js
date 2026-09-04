/**
 * FBT AI CONSENSUS & DEBATE ENGINE
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade — AI Debate / Consensus
 *
 * For high-stakes, strategic, or complex financial intent:
 *   - Never relies on a single model.
 *   - Orchestrates multi-model reasoning & debate across diverse AI models
 *     (e.g., Grok for market intelligence, OpenRouter / Claude for risk/logic,
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

// Specialized multi-model routing via OpenRouter and Groq
const ROLE_MODELS = {
  openrouter: {
    market_intelligence: 'x-ai/grok-2',
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
    const priority = ['groq', 'openrouter', 'grok', 'gemini', 'deepseek', 'anthropic', 'openai'];
    debateProviders = priority.filter((p) => active.includes(p)).slice(0, 3);
  }

  // If only OpenRouter is configured, we run multi-model debate across diverse models on OpenRouter (Grok, Claude, DeepSeek)
  let executionPlan = [];
  if (debateProviders.includes('openrouter') && debateProviders.length === 1) {
    executionPlan = [
      { provider: 'openrouter', role: 'market_intelligence', model: 'x-ai/grok-2' },
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
