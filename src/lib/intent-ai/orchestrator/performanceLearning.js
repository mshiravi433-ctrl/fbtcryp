/**
 * FBT AI — REAL PERFORMANCE LEARNING ENGINE (Section 3B)
 * ---------------------------------------------------------------------------
 * Learns from real, verified outcomes WITHOUT uncontrolled mutation of base
 * models (`baseModelsModified: false` at all times):
 *
 *   1. Compares past predictions against actual outcomes (`recordPrediction`, `evaluateOutcome`, `resolvePendingPredictions`)
 *   2. Measures per-model error rates: Accuracy, MAE%, RMSE%, Brier calibration score, Overconfidence rate
 *   3. Evaluates per-agent performance: Reliability score, Accuracy, Veto-saved-loss count, False-alarm count
 *   4. Diagnoses and logs root causes of wrong decisions (`mistakePostmortems`)
 *   5. Adjusts model & agent trust weights via bounded Bayesian policy updates (`[0.35, 1.65]`)
 *   6. Stores immutable versioned policy snapshots with 1-click reversible `rollbackPolicy(versionId)` and `setFrozen(bool)`
 *   7. Feeds learned trust weights, mistake warnings, and confidence calibration back into future Central Brain & Council decisions (`buildDecisionGuidance`)
 */

import { clipDeep, containsSensitiveKeyOrPhrase, redactSecrets } from './redact.js';

export const PERFORMANCE_LEARNING_SCHEMA = 'fbt.performance-learning.v1';

export const TRUST_BOUNDS = Object.freeze({
  MIN: 0.35,
  DEFAULT: 1.0,
  MAX: 1.65,
  MAX_STEP: 0.12
});

const DIRECTION_ALIASES = Object.freeze({
  bullish: 'BULLISH',
  buy: 'BULLISH',
  long: 'BULLISH',
  up: 'BULLISH',
  favorable: 'BULLISH',
  favorable_staged: 'BULLISH',
  bearish: 'BEARISH',
  sell: 'BEARISH',
  short: 'BEARISH',
  down: 'BEARISH',
  avoid: 'BEARISH',
  avoid_reject: 'BEARISH',
  cautious_reduce: 'BEARISH',
  reject: 'BEARISH',
  neutral: 'NEUTRAL',
  hold: 'NEUTRAL',
  hold_wait: 'NEUTRAL',
  wait: 'NEUTRAL',
  cautious: 'CAUTIOUS'
});

export function normalizeDirection(raw) {
  const key = String(raw || 'neutral').trim().toLowerCase();
  return DIRECTION_ALIASES[key] || 'NEUTRAL';
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function round4(v) {
  return Math.round(Number(v || 0) * 10000) / 10000;
}

function finiteOrNull(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Determine whether a predicted direction matched an actual % move. */
export function scoreDirectionVsMove(direction, actualMovePct, neutralBandPct = 0.6) {
  const dir = normalizeDirection(direction);
  const move = Number(actualMovePct);
  if (!Number.isFinite(move)) return { hit: null, protectiveSave: false };

  if (dir === 'BULLISH') {
    return { hit: move > neutralBandPct ? 1 : move >= -0.15 ? 0.4 : 0, protectiveSave: false };
  }
  if (dir === 'BEARISH') {
    const savedLoss = move < -neutralBandPct;
    return { hit: savedLoss ? 1 : move <= 0.15 ? 0.5 : 0, protectiveSave: savedLoss };
  }
  if (dir === 'CAUTIOUS') {
    const savedLoss = move < -neutralBandPct;
    return { hit: move <= neutralBandPct * 1.5 ? 1 : 0.35, protectiveSave: savedLoss };
  }
  // NEUTRAL / HOLD_WAIT
  return {
    hit: Math.abs(move) <= neutralBandPct * 2 ? 1 : (move < -neutralBandPct ? 0.7 : 0.3),
    protectiveSave: move < -neutralBandPct * 2
  };
}

function computeBayesianTrustWeight(stats, currentWeight = 1.0) {
  const n = stats.evaluated || 0;
  if (n === 0) return TRUST_BOUNDS.DEFAULT;
  // Bayesian smoothing: prior equivalent to 4 evaluations at 0.60 accuracy (baseline = 1.0)
  const priorN = 4;
  const priorAcc = 0.60;
  const smoothedAcc = (stats.hitSum + priorN * priorAcc) / (n + priorN);
  const avgBrier = stats.brierSum / n; // 0 is perfect, 0.25 is coin-flip, >0.35 is overconfident wrong
  const brierAdjustment = (0.24 - avgBrier) * 0.55;
  const overconfPenalty = (stats.overconfidentMisses / Math.max(1, n)) * 0.22;
  const vetoBonus = Math.min(0.15, (stats.vetoSaves || 0) * 0.03);

  const rawTarget = 1.0 + (smoothedAcc - priorAcc) * 1.35 + brierAdjustment - overconfPenalty + vetoBonus;
  const clampedTarget = clamp(rawTarget, TRUST_BOUNDS.MIN, TRUST_BOUNDS.MAX);
  // Bounded single-step movement for stability & safety
  const delta = clamp(clampedTarget - currentWeight, -TRUST_BOUNDS.MAX_STEP, TRUST_BOUNDS.MAX_STEP);
  return round4(clamp(currentWeight + delta, TRUST_BOUNDS.MIN, TRUST_BOUNDS.MAX));
}

export function createPerformanceLearning({
  smartMemory = null,
  persist = null, // optional { load, save }
  maxPredictions = 500,
  maxMistakes = 250,
  maxPolicySnapshots = 60,
  now = () => Date.now()
} = {}) {
  let seq = 0;
  let policySeq = 1;
  let frozen = false;
  let persistLoaded = false;

  const predictions = new Map(); // predictionId -> record
  const modelStats = new Map();  // modelKey -> stats
  const agentStats = new Map();  // agentId -> stats
  const modelWeights = new Map(); // modelKey -> number
  const agentWeights = new Map(); // agentId -> number
  const mistakePostmortems = []; // newest last
  const policySnapshots = [];    // versioned snapshots for instant rollback

  // Seed initial baseline snapshot pol_v1
  function snapshotPolicy(reason = 'INITIAL_BASELINE', triggerId = null) {
    const versionId = `pol_v${policySeq}`;
    policySeq += 1;
    const snap = {
      versionId,
      at: now(),
      reason,
      triggerEvaluationId: triggerId,
      frozen,
      baseModelsModified: false,
      modelWeights: Object.fromEntries(modelWeights.entries()),
      agentWeights: Object.fromEntries(agentWeights.entries())
    };
    policySnapshots.push(snap);
    while (policySnapshots.length > maxPolicySnapshots) policySnapshots.shift();
    return snap;
  }
  snapshotPolicy('INITIAL_BASELINE', null);

  function ensureModelEntry(provider, model = null) {
    const p = String(provider || 'unknown').toLowerCase();
    const m = model ? String(model) : p;
    const key = p;
    if (!modelStats.has(key)) {
      modelStats.set(key, {
        provider: p,
        lastModel: m,
        evaluated: 0,
        hits: 0,
        misses: 0,
        hitSum: 0,
        absErrorPctSum: 0,
        sqErrorPctSum: 0,
        magCount: 0,
        brierSum: 0,
        overconfidentMisses: 0,
        byTaskType: {}
      });
    } else if (model) {
      modelStats.get(key).lastModel = m;
    }
    if (!modelWeights.has(key)) modelWeights.set(key, TRUST_BOUNDS.DEFAULT);
    return { key, stats: modelStats.get(key) };
  }

  function ensureAgentEntry(agentId) {
    const id = String(agentId || 'general_agent').toLowerCase();
    if (!agentStats.has(id)) {
      agentStats.set(id, {
        agentId: id,
        evaluated: 0,
        hits: 0,
        misses: 0,
        hitSum: 0,
        brierSum: 0,
        overconfidentMisses: 0,
        vetoSaves: 0,
        falseAlarms: 0,
        evidenceQualitySum: 0
      });
    }
    if (!agentWeights.has(id)) agentWeights.set(id, TRUST_BOUNDS.DEFAULT);
    return { id, stats: agentStats.get(id) };
  }

  async function ensureLoaded() {
    if (!persist?.load || persistLoaded) return;
    persistLoaded = true;
    try {
      const snap = await persist.load();
      if (snap?.schema === PERFORMANCE_LEARNING_SCHEMA) {
        importStateSync(snap);
      }
    } catch { /* non-fatal */ }
  }

  async function flushPersist() {
    if (!persist?.save) return;
    try {
      await persist.save(exportStateSync());
    } catch { /* non-fatal */ }
  }

  function exportStateSync() {
    return {
      schema: PERFORMANCE_LEARNING_SCHEMA,
      at: now(),
      frozen,
      policySeq,
      predictions: [...predictions.values()],
      modelStats: Object.fromEntries(modelStats.entries()),
      agentStats: Object.fromEntries(agentStats.entries()),
      modelWeights: Object.fromEntries(modelWeights.entries()),
      agentWeights: Object.fromEntries(agentWeights.entries()),
      mistakePostmortems: [...mistakePostmortems],
      policySnapshots: [...policySnapshots]
    };
  }

  function importStateSync(state = {}) {
    if (state?.schema !== PERFORMANCE_LEARNING_SCHEMA) return { ok: false, error: 'SCHEMA_MISMATCH' };
    frozen = Boolean(state.frozen);
    policySeq = Math.max(1, Number(state.policySeq) || 1);
    predictions.clear();
    for (const p of state.predictions || []) if (p?.predictionId) predictions.set(p.predictionId, p);
    modelStats.clear();
    for (const [k, v] of Object.entries(state.modelStats || {})) modelStats.set(k, v);
    agentStats.clear();
    for (const [k, v] of Object.entries(state.agentStats || {})) agentStats.set(k, v);
    modelWeights.clear();
    for (const [k, v] of Object.entries(state.modelWeights || {})) modelWeights.set(k, Number(v) || 1.0);
    agentWeights.clear();
    for (const [k, v] of Object.entries(state.agentWeights || {})) agentWeights.set(k, Number(v) || 1.0);
    mistakePostmortems.length = 0;
    mistakePostmortems.push(...(state.mistakePostmortems || []).slice(-maxMistakes));
    policySnapshots.length = 0;
    policySnapshots.push(...(state.policySnapshots || []).slice(-maxPolicySnapshots));
    if (!policySnapshots.length) snapshotPolicy('RESTORED_BASELINE', null);
    return { ok: true };
  }

  return {
    schema: PERFORMANCE_LEARNING_SCHEMA,
    get frozen() { return frozen; },

    /* ── 1. Record Prediction for Future Outcome Verification ─────────── */
    async recordPrediction({
      owner = 'system',
      question = '',
      asset = null,
      taskType = 'MARKET_ANALYSIS',
      predictedDirection = 'NEUTRAL',
      predictedMovePct = null,
      confidence = 55,
      entryPrice = null,
      horizonMs = 24 * 3600 * 1000,
      evidenceQuality = 0.7,
      modelVotes = [], // [{ provider, model, direction, predictedMovePct, confidence }]
      agentVotes = []  // [{ agentId, direction, confidence, summary }]
    } = {}) {
      await ensureLoaded();
      if (containsSensitiveKeyOrPhrase(question)) {
        return { ok: false, error: 'SENSITIVE_CONTENT_REFUSED' };
      }

      const ts = now();
      seq += 1;
      const predictionId = `pred_${ts.toString(36)}_${seq}`;
      const sym = asset ? String(asset).toUpperCase().slice(0, 16) : null;

      const cleanModels = (Array.isArray(modelVotes) ? modelVotes : []).slice(0, 9).map((mv) => ({
        provider: String(mv.provider || 'unknown').toLowerCase(),
        model: mv.model ? String(mv.model) : String(mv.provider || 'unknown'),
        direction: normalizeDirection(mv.direction || mv.stance),
        predictedMovePct: finiteOrNull(mv.predictedMovePct),
        confidence: clamp(Number(mv.confidence ?? confidence) || 50, 0, 100)
      }));

      const cleanAgents = (Array.isArray(agentVotes) ? agentVotes : []).slice(0, 8).map((av) => ({
        agentId: String(av.agentId || av.memberId || 'specialist').toLowerCase(),
        direction: normalizeDirection(av.direction || av.stance || av.action),
        confidence: clamp(Number(av.confidence ?? confidence) || 50, 0, 100),
        summary: String(redactSecrets(String(av.summary || ''))).slice(0, 220)
      }));

      const parsedEntry = finiteOrNull(entryPrice);
      const record = {
        predictionId,
        owner: String(owner || 'system'),
        question: String(redactSecrets(String(question || ''))).slice(0, 320),
        asset: sym,
        taskType: String(taskType || 'MARKET_ANALYSIS'),
        predictedDirection: normalizeDirection(predictedDirection),
        predictedMovePct: finiteOrNull(predictedMovePct),
        confidence: clamp(Number(confidence) || 50, 0, 100),
        entryPrice: parsedEntry !== null && parsedEntry > 0 ? parsedEntry : null,
        horizonMs: Math.max(1000, Number(horizonMs) || 24 * 3600 * 1000),
        dueAt: ts + Math.max(1000, Number(horizonMs) || 24 * 3600 * 1000),
        evidenceQuality: clamp(Number(evidenceQuality) || 0.7, 0, 1),
        modelVotes: cleanModels,
        agentVotes: cleanAgents,
        status: 'PENDING',
        createdAt: ts,
        evaluation: null
      };

      predictions.set(predictionId, record);
      while (predictions.size > maxPredictions) {
        const oldestKey = predictions.keys().next().value;
        if (oldestKey !== undefined) predictions.delete(oldestKey);
      }
      await flushPersist();
      return { ok: true, predictionId, prediction: record };
    },

    /* ── 2. Compare Past Prediction With Real Outcome & Update Trust ──── */
    async evaluateOutcome({
      predictionId,
      actualPrice = null,
      actualMovePct = null,
      actualDirection = null,
      notes = ''
    } = {}) {
      await ensureLoaded();
      const pred = predictions.get(predictionId);
      if (!pred) return { ok: false, error: 'PREDICTION_NOT_FOUND' };
      if (pred.status === 'EVALUATED') return { ok: true, alreadyEvaluated: true, evaluation: pred.evaluation };

      let movePct = finiteOrNull(actualMovePct);
      const parsedActualPrice = finiteOrNull(actualPrice);
      if (movePct === null && parsedActualPrice !== null && parsedActualPrice > 0 && pred.entryPrice > 0) {
        movePct = ((parsedActualPrice - pred.entryPrice) / pred.entryPrice) * 100;
      }
      if (movePct === null && actualDirection) {
        const d = normalizeDirection(actualDirection);
        movePct = d === 'BULLISH' ? 2.5 : d === 'BEARISH' ? -2.5 : 0;
      }
      // Never invent outcomes when real data is absent
      if (movePct === null) {
        return { ok: false, error: 'ACTUAL_OUTCOME_REQUIRED', status: 'PENDING' };
      }

      const ts = now();
      const overallScore = scoreDirectionVsMove(pred.predictedDirection, movePct);
      const prob = clamp(pred.confidence / 100, 0.05, 0.99);
      const binaryHit = overallScore.hit >= 0.65 ? 1 : 0;
      const overallBrier = round4((prob - binaryHit) ** 2);
      const overallAbsErr = pred.predictedMovePct !== null ? round4(Math.abs(pred.predictedMovePct - movePct)) : null;

      // Evaluate each participating AI model
      const modelEvaluations = [];
      for (const mv of pred.modelVotes) {
        const { key, stats } = ensureModelEntry(mv.provider, mv.model);
        const sc = scoreDirectionVsMove(mv.direction, movePct);
        const mHit = sc.hit >= 0.65 ? 1 : 0;
        const mProb = clamp(mv.confidence / 100, 0.05, 0.99);
        const brier = (mProb - mHit) ** 2;
        const absErr = mv.predictedMovePct !== null
          ? Math.abs(mv.predictedMovePct - movePct)
          : (pred.predictedMovePct !== null ? Math.abs(pred.predictedMovePct - movePct) : Math.abs((mv.direction === 'BULLISH' ? 2 : mv.direction === 'BEARISH' ? -2 : 0) - movePct));

        stats.evaluated += 1;
        stats.hitSum += sc.hit;
        if (mHit) stats.hits += 1; else stats.misses += 1;
        if (!mHit && mv.confidence >= 75) stats.overconfidentMisses += 1;
        stats.brierSum += brier;
        stats.absErrorPctSum += absErr;
        stats.sqErrorPctSum += absErr * absErr;
        stats.magCount += 1;

        const tt = pred.taskType || 'GENERAL';
        const byTask = stats.byTaskType[tt] || { evaluated: 0, hits: 0, brierSum: 0 };
        byTask.evaluated += 1;
        byTask.hits += mHit;
        byTask.brierSum += brier;
        stats.byTaskType[tt] = byTask;

        const prevWeight = modelWeights.get(key) ?? 1.0;
        const nextWeight = frozen ? prevWeight : computeBayesianTrustWeight(stats, prevWeight);
        if (!frozen) modelWeights.set(key, nextWeight);

        modelEvaluations.push({
          provider: key,
          model: mv.model,
          predictedDirection: mv.direction,
          confidence: mv.confidence,
          hit: Boolean(mHit),
          score: round4(sc.hit),
          absErrorPct: round4(absErr),
          brierError: round4(brier),
          previousTrustWeight: prevWeight,
          newTrustWeight: nextWeight
        });
      }

      // Evaluate each participating Specialist Agent
      const agentEvaluations = [];
      let riskOrCriticWarnedCorrectly = false;
      for (const av of pred.agentVotes) {
        const { id, stats } = ensureAgentEntry(av.agentId);
        const sc = scoreDirectionVsMove(av.direction, movePct);
        const aHit = sc.hit >= 0.65 ? 1 : 0;
        const aProb = clamp(av.confidence / 100, 0.05, 0.99);
        const brier = (aProb - aHit) ** 2;

        stats.evaluated += 1;
        stats.hitSum += sc.hit;
        if (aHit) stats.hits += 1; else stats.misses += 1;
        if (!aHit && av.confidence >= 75) stats.overconfidentMisses += 1;
        stats.brierSum += brier;
        stats.evidenceQualitySum += pred.evidenceQuality;
        if (sc.protectiveSave) {
          stats.vetoSaves += 1;
          if (id.includes('risk') || id.includes('critic')) riskOrCriticWarnedCorrectly = true;
        }
        if ((av.direction === 'BEARISH' || av.direction === 'CAUTIOUS') && movePct > 3.0) {
          stats.falseAlarms += 1;
        }

        const prevWeight = agentWeights.get(id) ?? 1.0;
        const nextWeight = frozen ? prevWeight : computeBayesianTrustWeight(stats, prevWeight);
        if (!frozen) agentWeights.set(id, nextWeight);

        agentEvaluations.push({
          agentId: id,
          predictedDirection: av.direction,
          confidence: av.confidence,
          hit: Boolean(aHit),
          protectiveSave: sc.protectiveSave,
          brierError: round4(brier),
          previousTrustWeight: prevWeight,
          newTrustWeight: nextWeight
        });
      }

      // Diagnose root causes if the overall decision was wrong!
      let postmortem = null;
      if (!binaryHit) {
        const reasonCodes = [];
        if (riskOrCriticWarnedCorrectly) reasonCodes.push('IGNORED_RISK_OR_CRITIC_WARNING');
        if (pred.confidence >= 75) reasonCodes.push('OVERCONFIDENT_DECISION');
        if (pred.evidenceQuality < 0.55) reasonCodes.push('THIN_EVIDENCE_AT_DECISION_TIME');
        if (Math.abs(movePct) >= 5.0) reasonCodes.push('ADVERSE_MARKET_SHOCK');
        if (!reasonCodes.length) reasonCodes.push('DIRECTIONAL_FORECAST_MISS');

        const lessonParts = [];
        if (reasonCodes.includes('IGNORED_RISK_OR_CRITIC_WARNING')) {
          lessonParts.push('متخصص ریسک/منتقد هشدار صحیح داده بود؛ در تصمیم‌های مشابه وزن هشدار ریسک افزایش یابد (Risk/Critic dissent was right).');
        }
        if (reasonCodes.includes('OVERCONFIDENT_DECISION')) {
          lessonParts.push(`سطح اطمینان (${pred.confidence}%) نسبت به حرکت واقعی (${round4(movePct)}%) بیش‌ازحد خوش‌بینانه بود؛ سقف اطمینان تعدیل شود.`);
        }
        if (reasonCodes.includes('THIN_EVIDENCE_AT_DECISION_TIME')) {
          lessonParts.push('پوشش داده‌های ابزاری هنگام تصمیم‌گیری ناقص بود؛ بدون شواهد کامل تصمیم قاطع گرفته نشود.');
        }
        if (!lessonParts.length) {
          lessonParts.push(`جهت پیش‌بینی (${pred.predictedDirection}) با حرکت واقعی (${round4(movePct)}%) هم‌خوانی نداشت؛ ورود پله‌ای و حد ابطال رعایت شود.`);
        }

        postmortem = {
          postmortemId: `pm_${ts.toString(36)}_${seq}`,
          predictionId,
          owner: pred.owner,
          asset: pred.asset,
          taskType: pred.taskType,
          predictedDirection: pred.predictedDirection,
          actualMovePct: round4(movePct),
          confidenceAtDecision: pred.confidence,
          reasonCodes,
          explanation: lessonParts.join(' '),
          notes: String(redactSecrets(String(notes || ''))).slice(0, 220),
          modelsInvolved: pred.modelVotes.map((m) => m.provider),
          agentsInvolved: pred.agentVotes.map((a) => a.agentId),
          at: ts
        };
        mistakePostmortems.push(postmortem);
        while (mistakePostmortems.length > maxMistakes) mistakePostmortems.shift();
      }

      // Create reversible policy version snapshot if weights changed
      let policySnapshot = policySnapshots[policySnapshots.length - 1];
      if (!frozen && (modelEvaluations.length > 0 || agentEvaluations.length > 0)) {
        policySnapshot = snapshotPolicy(
          binaryHit ? `OUTCOME_HIT:${predictionId}` : `OUTCOME_MISS:${predictionId}`,
          predictionId
        );
      }

      // Store episode in Smart Semantic Long-Term Memory (so future contextual recall surfaces it!)
      if (smartMemory?.recordExperience && pred.owner) {
        await smartMemory.recordExperience({
          owner: pred.owner,
          outcome: binaryHit ? 'SUCCESS' : 'FAILURE',
          taskType: pred.taskType,
          asset: pred.asset,
          strategy: `${pred.predictedDirection} (${pred.confidence}%)`,
          summary: `Prediction ${pred.predictedDirection} on ${pred.asset || pred.taskType}; actual move ${round4(movePct)}%`,
          whatWorked: binaryHit ? `Aligned signals delivered accurate ${pred.predictedDirection} call (${round4(movePct)}%).` : '',
          whatFailed: !binaryHit ? (postmortem?.explanation || 'Directional miss') : '',
          rootCause: postmortem?.reasonCodes?.[0] || null,
          errorPct: overallAbsErr ?? Math.abs(movePct),
          lesson: binaryHit
            ? `Validated ${pred.predictedDirection} setup on ${pred.asset || pred.taskType} when evidence quality >= ${round4(pred.evidenceQuality)}.`
            : postmortem?.explanation,
          agentsInvolved: pred.agentVotes.map((a) => a.agentId),
          modelsUsed: pred.modelVotes.map((m) => m.provider)
        }).catch(() => {});
      }

      const evaluation = {
        predictionId,
        evaluatedAt: ts,
        actualPrice: parsedActualPrice,
        actualMovePct: round4(movePct),
        hit: Boolean(binaryHit),
        directionalScore: round4(overallScore.hit),
        absErrorPct: overallAbsErr,
        brierError: overallBrier,
        modelEvaluations,
        agentEvaluations,
        postmortem,
        policyVersion: policySnapshot?.versionId || null
      };

      pred.status = 'EVALUATED';
      pred.evaluation = evaluation;
      await flushPersist();

      return { ok: true, evaluation };
    },

    /** Resolve all due PENDING predictions given a map or async getter of live prices `{ BTC: 68500, ... }`. */
    async resolvePendingPredictions({ livePrices = {}, priceGetter = null, forceAll = false } = {}) {
      await ensureLoaded();
      const ts = now();
      const resolved = [];
      for (const pred of predictions.values()) {
        if (pred.status !== 'PENDING' || !pred.asset || !pred.entryPrice) continue;
        if (!forceAll && pred.dueAt > ts) continue;
        let currentPrice = livePrices?.[pred.asset];
        if (!Number.isFinite(Number(currentPrice)) && typeof priceGetter === 'function') {
          currentPrice = await priceGetter(pred.asset);
        }
        if (Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0) {
          const out = await this.evaluateOutcome({ predictionId: pred.predictionId, actualPrice: Number(currentPrice) });
          if (out.ok) resolved.push(out.evaluation);
        }
      }
      return { ok: true, resolvedCount: resolved.length, resolved };
    },

    /* ── 3. Model & Agent Metrics + Mistake Reports ───────────────────── */
    getModelMetrics() {
      const out = [];
      for (const [provider, s] of modelStats.entries()) {
        const n = Math.max(1, s.evaluated);
        const magN = Math.max(1, s.magCount);
        out.push({
          provider,
          lastModel: s.lastModel,
          evaluatedCount: s.evaluated,
          hits: s.hits,
          misses: s.misses,
          accuracyRate: s.evaluated ? round4(s.hits / n) : null,
          directionalScoreAvg: s.evaluated ? round4(s.hitSum / n) : null,
          maePct: s.magCount ? round4(s.absErrorPctSum / magN) : null,
          rmsePct: s.magCount ? round4(Math.sqrt(s.sqErrorPctSum / magN)) : null,
          brierScore: s.evaluated ? round4(s.brierSum / n) : null,
          overconfidenceRate: s.evaluated ? round4(s.overconfidentMisses / n) : 0,
          trustWeight: modelWeights.get(provider) ?? TRUST_BOUNDS.DEFAULT,
          byTaskType: clipDeep(s.byTaskType, 120)
        });
      }
      out.sort((a, b) => b.trustWeight - a.trustWeight);
      return out;
    },

    getAgentMetrics() {
      const out = [];
      for (const [agentId, s] of agentStats.entries()) {
        const n = Math.max(1, s.evaluated);
        const trust = agentWeights.get(agentId) ?? TRUST_BOUNDS.DEFAULT;
        const reliability = s.evaluated
          ? Math.round(clamp(((s.hitSum / n) * 70) + ((1 - Math.min(0.5, s.brierSum / n)) * 25) + Math.min(10, s.vetoSaves * 2.5), 0, 100))
          : 70;
        out.push({
          agentId,
          evaluatedCount: s.evaluated,
          hits: s.hits,
          misses: s.misses,
          accuracyRate: s.evaluated ? round4(s.hits / n) : null,
          brierScore: s.evaluated ? round4(s.brierSum / n) : null,
          vetoSavedLossCount: s.vetoSaves,
          falseAlarmCount: s.falseAlarms,
          reliabilityScore: reliability,
          trustWeight: trust
        });
      }
      out.sort((a, b) => b.trustWeight - a.trustWeight);
      return out;
    },

    getMistakes({ owner = null, asset = null, limit = 20 } = {}) {
      return mistakePostmortems
        .filter((m) => (!owner || m.owner === owner) && (!asset || m.asset === String(asset).toUpperCase()))
        .slice(-Math.max(1, limit))
        .reverse();
    },

    getTrustWeights() {
      return {
        frozen,
        baseModelsModified: false,
        currentPolicyVersion: policySnapshots[policySnapshots.length - 1]?.versionId || 'pol_v1',
        models: Object.fromEntries(modelWeights.entries()),
        agents: Object.fromEntries(agentWeights.entries())
      };
    },

    /* ── 4. Reversible Policy Controls (`rollbackPolicy`, `setFrozen`) ── */
    getPolicyHistory({ limit = 25 } = {}) {
      return policySnapshots.slice(-Math.max(1, limit)).reverse();
    },

    async rollbackPolicy(versionId = null) {
      await ensureLoaded();
      if (!versionId || versionId === 'baseline') {
        for (const k of modelWeights.keys()) modelWeights.set(k, TRUST_BOUNDS.DEFAULT);
        for (const k of agentWeights.keys()) agentWeights.set(k, TRUST_BOUNDS.DEFAULT);
        const snap = snapshotPolicy('ROLLBACK_TO_BASELINE', null);
        await flushPersist();
        return { ok: true, restoredVersion: 'baseline', activePolicy: snap };
      }

      const target = policySnapshots.find((s) => s.versionId === versionId);
      if (!target) return { ok: false, error: 'POLICY_VERSION_NOT_FOUND' };

      modelWeights.clear();
      for (const [k, v] of Object.entries(target.modelWeights || {})) modelWeights.set(k, Number(v) || 1.0);
      agentWeights.clear();
      for (const [k, v] of Object.entries(target.agentWeights || {})) agentWeights.set(k, Number(v) || 1.0);

      const snap = snapshotPolicy(`ROLLBACK_TO:${versionId}`, null);
      await flushPersist();
      return { ok: true, restoredVersion: versionId, activePolicy: snap };
    },

    async setFrozen(nextFrozen = true) {
      frozen = Boolean(nextFrozen);
      const snap = snapshotPolicy(frozen ? 'LEARNING_FROZEN' : 'LEARNING_UNFROZEN', null);
      await flushPersist();
      return { ok: true, frozen, policyVersion: snap.versionId };
    },

    /* ── 5. Pre-Decision Guidance to Improve Future Decisions ─────────── */
    buildDecisionGuidance({ owner = null, asset = null, taskType = null, candidateProviders = [] } = {}) {
      const sym = asset ? String(asset).toUpperCase() : null;
      const recentMistakes = this.getMistakes({ owner, asset: sym, limit: 6 });
      const allRecentMistakes = recentMistakes.length ? recentMistakes : this.getMistakes({ asset: sym, limit: 4 });

      const modelTrust = {};
      for (const p of candidateProviders) {
        const key = String(p).toLowerCase();
        modelTrust[key] = modelWeights.get(key) ?? TRUST_BOUNDS.DEFAULT;
      }
      for (const [k, w] of modelWeights.entries()) {
        if (modelTrust[k] === undefined) modelTrust[k] = w;
      }

      const agentTrust = Object.fromEntries(agentWeights.entries());

      const hadOverconfidence = allRecentMistakes.some((m) => m.reasonCodes?.includes('OVERCONFIDENT_DECISION'));
      const ignoredRiskPreviously = allRecentMistakes.some((m) => m.reasonCodes?.includes('IGNORED_RISK_OR_CRITIC_WARNING'));

      // Boost Risk Specialist & Critic weight slightly if ignoring them previously caused losses!
      if (ignoredRiskPreviously) {
        agentTrust.risk_specialist = clamp((agentTrust.risk_specialist ?? 1.0) + 0.12, TRUST_BOUNDS.MIN, TRUST_BOUNDS.MAX);
        agentTrust.decision_critic = clamp((agentTrust.decision_critic ?? 1.0) + 0.12, TRUST_BOUNDS.MIN, TRUST_BOUNDS.MAX);
      }

      const confidencePenalty = (hadOverconfidence ? 8 : 0) + Math.min(10, allRecentMistakes.length * 3);
      const rankedProviders = Object.entries(modelTrust)
        .sort((a, b) => b[1] - a[1])
        .map(([provider, trustWeight]) => ({
          provider,
          trustWeight,
          taskAccuracy: (() => {
            const st = modelStats.get(provider)?.byTaskType?.[taskType];
            return st?.evaluated ? round4(st.hits / st.evaluated) : null;
          })()
        }));

      return {
        schema: PERFORMANCE_LEARNING_SCHEMA,
        currentPolicyVersion: policySnapshots[policySnapshots.length - 1]?.versionId || 'pol_v1',
        frozen,
        baseModelsModified: false,
        modelTrustWeights: modelTrust,
        agentTrustWeights: agentTrust,
        rankedProviders,
        confidenceDampener: confidencePenalty,
        requireCritic: hadOverconfidence || ignoredRiskPreviously || allRecentMistakes.length >= 2,
        pastMistakeWarnings: allRecentMistakes.slice(0, 3).map((m) => ({
          postmortemId: m.postmortemId,
          asset: m.asset,
          reasonCodes: m.reasonCodes,
          lesson: m.explanation
        }))
      };
    },

    summary({ owner = null } = {}) {
      const preds = [...predictions.values()].filter((p) => !owner || p.owner === owner);
      const evaluated = preds.filter((p) => p.status === 'EVALUATED');
      const hits = evaluated.filter((p) => p.evaluation?.hit).length;
      return {
        ok: true,
        schema: PERFORMANCE_LEARNING_SCHEMA,
        frozen,
        baseModelsModified: false,
        currentPolicyVersion: policySnapshots[policySnapshots.length - 1]?.versionId || 'pol_v1',
        policyVersionsCount: policySnapshots.length,
        totals: {
          predictions: preds.length,
          evaluated: evaluated.length,
          pending: preds.length - evaluated.length,
          overallAccuracyRate: evaluated.length ? round4(hits / evaluated.length) : null,
          mistakesLogged: mistakePostmortems.filter((m) => !owner || m.owner === owner).length
        },
        models: this.getModelMetrics(),
        agents: this.getAgentMetrics(),
        recentMistakes: this.getMistakes({ owner, limit: 5 })
      };
    },

    exportState: exportStateSync,
    importState: importStateSync
  };
}

export default createPerformanceLearning;
