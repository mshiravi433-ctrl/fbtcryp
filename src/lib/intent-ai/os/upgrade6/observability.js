/**
 * FBT AI / Intent OS — UPGRADE 6
 * Observability V2 + Quality Metrics Dashboard
 * Spec §39, §40
 */

function now() { return Date.now(); }
function makeId(prefix = 'obs') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  } catch {}
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const STORAGE_KEY_OBS = 'fbt.observability.v6';
const STORAGE_KEY_METRICS = 'fbt.quality.metrics.v6';

/**
 * Observability per §39
 * For each Intent log: intentId, sessionId, userRequest, detectedIntent, agentsUsed, toolsUsed, questionsAsked, answersReceived, navigationEvents, executionEvents, errors, retries, fallbacks, completion, duration
 */
export class ObservabilityV2 {
  constructor() {
    this.intents = this.load();
  }

  load() {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(STORAGE_KEY_OBS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(-200) : [];
    } catch {
      return [];
    }
  }

  save() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY_OBS, JSON.stringify(this.intents.slice(-200)));
    } catch {}
  }

  logIntentStart({ intentId, sessionId, userRequest, detectedIntent, currentRoute } = {}) {
    const record = {
      id: makeId('log'),
      intentId,
      sessionId,
      userRequest: String(userRequest || '').slice(0, 1000),
      detectedIntent: detectedIntent?.type || detectedIntent || null,
      detectedDetail: detectedIntent || null,
      currentRoute: currentRoute || null,
      agentsUsed: [],
      toolsUsed: [],
      questionsAsked: [],
      answersReceived: [],
      navigationEvents: [],
      executionEvents: [],
      errors: [],
      retries: [],
      fallbacks: [],
      completion: null,
      duration: null,
      createdAt: now(),
      updatedAt: now()
    };
    this.intents.push(record);
    this.save();
    return record;
  }

  log({ intentId, type, payload = {} } = {}) {
    const rec = this.intents.find((r) => r.intentId === intentId);
    if (!rec) return null;
    rec.updatedAt = now();
    rec.duration = rec.updatedAt - rec.createdAt;

    switch (type) {
      case 'AGENT_USED':
        if (!rec.agentsUsed.includes(payload.agentId)) rec.agentsUsed.push(payload.agentId);
        break;
      case 'TOOL_USED':
        if (!rec.toolsUsed.includes(payload.toolId)) rec.toolsUsed.push(payload.toolId);
        break;
      case 'QUESTION_ASKED':
        rec.questionsAsked.push({ question: payload.question, questionId: payload.questionId, at: now() });
        break;
      case 'ANSWER_RECEIVED':
        rec.answersReceived.push({ answer: String(payload.answer).slice(0, 500), questionId: payload.questionId, at: now() });
        break;
      case 'NAVIGATION':
        rec.navigationEvents.push({ ...payload, at: now() });
        break;
      case 'EXECUTION':
        rec.executionEvents.push({ ...payload, at: now() });
        break;
      case 'ERROR':
        rec.errors.push({ error: payload.error, code: payload.code, at: now() });
        break;
      case 'RETRY':
        rec.retries.push({ ...payload, at: now() });
        break;
      case 'FALLBACK':
        rec.fallbacks.push({ ...payload, at: now() });
        break;
      case 'INTENT_DETECTED':
        rec.detectedIntent = payload.detectedIntent || payload.type || rec.detectedIntent;
        rec.detectedDetail = payload.detail || payload.detectedDetail || rec.detectedDetail;
        break;
      case 'COMPLETION':
        rec.completion = { status: payload.status, at: now(), ...payload };
        rec.duration = rec.updatedAt - rec.createdAt;
        break;
      default:
        if (!rec.events) rec.events = [];
        rec.events.push({ type, payload, at: now() });
    }
    this.save();
    return rec;
  }

  getIntent(intentId) {
    return this.intents.find((r) => r.intentId === intentId) || null;
  }

  getRecent(limit = 50) {
    return [...this.intents].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  getStats() {
    const total = this.intents.length;
    if (!total) return { total: 0 };
    const completed = this.intents.filter((r) => r.completion?.status === 'COMPLETED' || r.completion?.status === 'completed').length;
    const failed = this.intents.filter((r) => r.completion?.failed || r.errors.length > 0).length;
    const avgDuration = this.intents.reduce((s, r) => s + (r.duration || 0), 0) / total;
    return {
      total,
      completed,
      failed,
      successRate: total ? completed / total : 0,
      avgDuration,
      totalQuestions: this.intents.reduce((s, r) => s + r.questionsAsked.length, 0),
      totalAnswers: this.intents.reduce((s, r) => s + r.answersReceived.length, 0),
      totalNavigations: this.intents.reduce((s, r) => s + r.navigationEvents.length, 0),
      totalErrors: this.intents.reduce((s, r) => s + r.errors.length, 0)
    };
  }

  clear() {
    this.intents = [];
    this.save();
  }
}

/**
 * Quality Metrics per §40
 * Intent Success Rate, Question Repetition Rate, Context Loss Rate, Navigation Loop Rate, Agent Success Rate, Tool Failure Rate, Fallback Rate, Average Completion Time, User Correction Rate, Clarification Rate, Wallet Execution Success, Chat Scroll Errors
 */
export class QualityMetrics {
  constructor() {
    this.metrics = this.load();
  }

  load() {
    try {
      if (typeof localStorage === 'undefined') return this.empty();
      const raw = localStorage.getItem(STORAGE_KEY_METRICS);
      if (!raw) return this.empty();
      const parsed = JSON.parse(raw);
      return { ...this.empty(), ...parsed };
    } catch {
      return this.empty();
    }
  }

  empty() {
    return {
      intentSuccess: { total: 0, success: 0, rate: 0 },
      questionRepetition: { totalQuestions: 0, repeated: 0, rate: 0 },
      contextLoss: { total: 0, lost: 0, rate: 0 },
      navigationLoop: { total: 0, loops: 0, rate: 0 },
      agentSuccess: { total: 0, success: 0, rate: 0 },
      toolFailure: { total: 0, failures: 0, rate: 0 },
      fallback: { total: 0, fallbacks: 0, rate: 0 },
      avgCompletionTime: { totalDuration: 0, count: 0, avg: 0 },
      userCorrection: { total: 0, corrections: 0, rate: 0 },
      clarification: { total: 0, clarifications: 0, rate: 0 },
      walletExecution: { total: 0, success: 0, rate: 0 },
      chatScrollErrors: { total: 0, errors: 0, rate: 0 },
      updatedAt: now()
    };
  }

  save() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY_METRICS, JSON.stringify({ ...this.metrics, updatedAt: now() }));
    } catch {}
  }

  recordIntent(success) {
    this.metrics.intentSuccess.total += 1;
    if (success) this.metrics.intentSuccess.success += 1;
    this.metrics.intentSuccess.rate = this.metrics.intentSuccess.total ? this.metrics.intentSuccess.success / this.metrics.intentSuccess.total : 0;
    this.save();
  }

  recordQuestion(isRepeated) {
    this.metrics.questionRepetition.totalQuestions += 1;
    if (isRepeated) this.metrics.questionRepetition.repeated += 1;
    this.metrics.questionRepetition.rate = this.metrics.questionRepetition.totalQuestions ? this.metrics.questionRepetition.repeated / this.metrics.questionRepetition.totalQuestions : 0;
    this.save();
  }

  recordContextLoss(lost) {
    this.metrics.contextLoss.total += 1;
    if (lost) this.metrics.contextLoss.lost += 1;
    this.metrics.contextLoss.rate = this.metrics.contextLoss.total ? this.metrics.contextLoss.lost / this.metrics.contextLoss.total : 0;
    this.save();
  }

  recordNavigation(isLoop) {
    this.metrics.navigationLoop.total += 1;
    if (isLoop) this.metrics.navigationLoop.loops += 1;
    this.metrics.navigationLoop.rate = this.metrics.navigationLoop.total ? this.metrics.navigationLoop.loops / this.metrics.navigationLoop.total : 0;
    this.save();
  }

  recordAgent(success) {
    this.metrics.agentSuccess.total += 1;
    if (success) this.metrics.agentSuccess.success += 1;
    this.metrics.agentSuccess.rate = this.metrics.agentSuccess.total ? this.metrics.agentSuccess.success / this.metrics.agentSuccess.total : 0;
    this.save();
  }

  recordTool(failed) {
    this.metrics.toolFailure.total += 1;
    if (failed) this.metrics.toolFailure.failures += 1;
    this.metrics.toolFailure.rate = this.metrics.toolFailure.total ? this.metrics.toolFailure.failures / this.metrics.toolFailure.total : 0;
    this.save();
  }

  recordFallback() {
    this.metrics.fallback.total += 1;
    this.metrics.fallback.fallbacks += 1;
    this.metrics.fallback.rate = this.metrics.fallback.total ? this.metrics.fallback.fallbacks / this.metrics.fallback.total : 0;
    this.save();
  }

  recordCompletionTime(durationMs) {
    this.metrics.avgCompletionTime.totalDuration += durationMs;
    this.metrics.avgCompletionTime.count += 1;
    this.metrics.avgCompletionTime.avg = this.metrics.avgCompletionTime.count ? this.metrics.avgCompletionTime.totalDuration / this.metrics.avgCompletionTime.count : 0;
    this.save();
  }

  recordCorrection(isCorrection) {
    this.metrics.userCorrection.total += 1;
    if (isCorrection) this.metrics.userCorrection.corrections += 1;
    this.metrics.userCorrection.rate = this.metrics.userCorrection.total ? this.metrics.userCorrection.corrections / this.metrics.userCorrection.total : 0;
    this.save();
  }

  recordClarification() {
    this.metrics.clarification.total += 1;
    this.metrics.clarification.clarifications += 1;
    this.metrics.clarification.rate = this.metrics.clarification.total ? this.metrics.clarification.clarifications / this.metrics.clarification.total : 0;
    this.save();
  }

  recordWalletExecution(success) {
    this.metrics.walletExecution.total += 1;
    if (success) this.metrics.walletExecution.success += 1;
    this.metrics.walletExecution.rate = this.metrics.walletExecution.total ? this.metrics.walletExecution.success / this.metrics.walletExecution.total : 0;
    this.save();
  }

  recordScrollError() {
    this.metrics.chatScrollErrors.total += 1;
    this.metrics.chatScrollErrors.errors += 1;
    this.metrics.chatScrollErrors.rate = this.metrics.chatScrollErrors.total ? this.metrics.chatScrollErrors.errors / this.metrics.chatScrollErrors.total : 0;
    this.save();
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getGoals() {
    return {
      questionRepetition: { target: 0, current: this.metrics.questionRepetition.rate, ok: this.metrics.questionRepetition.rate < 0.05 },
      contextLoss: { target: 0, current: this.metrics.contextLoss.rate, ok: this.metrics.contextLoss.rate < 0.05 },
      navigationLoop: { target: 0, current: this.metrics.navigationLoop.rate, ok: this.metrics.navigationLoop.rate === 0 },
      intentCompletion: { target: 0.9, current: this.metrics.intentSuccess.rate, ok: this.metrics.intentSuccess.rate >= 0.9 }
    };
  }

  clear() {
    this.metrics = this.empty();
    this.save();
  }
}

// Singletons
let obsInstance = null;
export function getObservabilityV2() {
  if (!obsInstance) obsInstance = new ObservabilityV2();
  return obsInstance;
}

let metricsInstance = null;
export function getQualityMetrics() {
  if (!metricsInstance) metricsInstance = new QualityMetrics();
  return metricsInstance;
}
