/**
 * FBT INTENT OS — UPGRADE 7 · Agent Mesh
 * ---------------------------------------------------------------------------
 * Spec §12 (parallel/sequential multi-agent brain), §13 (debate / cross-check /
 * synthesis with LOW CONFIDENCE on divergence), §40 (timeout, retry, fallback,
 * health), §41 (pre-flight availability), §39 (request de-duplication).
 *
 * This wraps the agents that `createIntentOS()` already builds. It never
 * constructs an agent and never changes one; a missing agent is simply reported
 * as unavailable, exactly as `orchestrator` does today.
 */

export const AGENT_MESH_SCHEMA = 'fbt.agent-mesh.v7';

export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_RETRIES = 1;

export const HEALTH = Object.freeze({
  HEALTHY: 'healthy', DEGRADED: 'degraded', UNAVAILABLE: 'unavailable', UNKNOWN: 'unknown'
});

/* -------------------------------------------------------------------------- */
/*  HEALTH REGISTRY (§41)                                                       */
/* -------------------------------------------------------------------------- */

const healthState = new Map();

function record(agentId, ok, ms, error = null) {
  const prev = healthState.get(agentId) || { calls: 0, failures: 0, totalMs: 0, consecutiveFailures: 0 };
  const next = {
    calls: prev.calls + 1,
    failures: prev.failures + (ok ? 0 : 1),
    totalMs: prev.totalMs + ms,
    consecutiveFailures: ok ? 0 : prev.consecutiveFailures + 1,
    lastMs: ms,
    lastError: ok ? prev.lastError || null : (error?.message || String(error || 'FAILED')),
    lastCallAt: Date.now()
  };
  healthState.set(agentId, next);
  return next;
}

export function getAgentHealth(agentId) {
  const s = healthState.get(agentId);
  if (!s) return { agentId, status: HEALTH.UNKNOWN, calls: 0, failureRate: 0, avgMs: null };
  const failureRate = s.calls ? s.failures / s.calls : 0;
  let status = HEALTH.HEALTHY;
  if (s.consecutiveFailures >= 3) status = HEALTH.UNAVAILABLE;
  else if (failureRate > 0.34 || s.consecutiveFailures >= 1) status = HEALTH.DEGRADED;
  return {
    agentId, status, calls: s.calls, failures: s.failures,
    failureRate: Math.round(failureRate * 100) / 100,
    avgMs: Math.round(s.totalMs / Math.max(1, s.calls)),
    lastMs: s.lastMs, lastError: s.lastError, lastCallAt: s.lastCallAt
  };
}

export function getMeshHealth() {
  return [...healthState.keys()].map(getAgentHealth);
}

export function resetAgentHealth() { healthState.clear(); }

/** §41 pre-flight — is this agent worth calling at all? */
export function checkAvailability(agents, agentId) {
  const agent = agents?.[agentId];
  const health = getAgentHealth(agentId);
  const callable = Boolean(agent && (typeof agent.handleIntent === 'function' || typeof agent.execute === 'function' || typeof agent === 'function'));
  return {
    agentId,
    exists: Boolean(agent),
    callable,
    health: health.status,
    available: callable && health.status !== HEALTH.UNAVAILABLE,
    reason: !agent ? 'AGENT_NOT_REGISTERED' : (!callable ? 'AGENT_NOT_CALLABLE' : (health.status === HEALTH.UNAVAILABLE ? 'AGENT_UNHEALTHY' : null))
  };
}

/* -------------------------------------------------------------------------- */
/*  TIMEOUT + RETRY + FALLBACK (§40)                                            */
/* -------------------------------------------------------------------------- */

function withTimeout(promise, ms, agentId) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`AGENT_TIMEOUT:${agentId}`), { code: 'AGENT_TIMEOUT', agentId })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

async function invoke(agent, intent, context) {
  if (typeof agent?.handleIntent === 'function') return agent.handleIntent(intent, context);
  if (typeof agent?.execute === 'function') return agent.execute(intent, context);
  if (typeof agent === 'function') return agent(intent, context);
  throw Object.assign(new Error('AGENT_NOT_CALLABLE'), { code: 'AGENT_NOT_CALLABLE' });
}

/**
 * Call one agent with the full §40 contract.
 * Never throws — a failure is a result with `ok:false`, so one bad agent can
 * never blank a whole turn (the same rule `os/index.js` already follows).
 */
export async function callAgent(agents, agentId, intent, context, {
  timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, fallbackAgentId = null
} = {}) {
  const pre = checkAvailability(agents, agentId);
  if (!pre.available) {
    if (fallbackAgentId && fallbackAgentId !== agentId) {
      const fb = await callAgent(agents, fallbackAgentId, intent, context, { timeoutMs, retries: 0 });
      return { ...fb, agentId, viaFallback: fallbackAgentId, degraded: true };
    }
    return { ok: false, agentId, skipped: true, error: pre.reason, health: pre.health };
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const start = Date.now();
    try {
      const data = await withTimeout(Promise.resolve(invoke(agents[agentId], intent, context)), timeoutMs, agentId);
      const ms = Date.now() - start;
      record(agentId, true, ms);
      return { ok: true, agentId, data, ms, attempts: attempt + 1 };
    } catch (err) {
      const ms = Date.now() - start;
      record(agentId, false, ms, err);
      lastError = err;
      // A timeout is worth exactly one more shot; a code error is not.
      if (err?.code !== 'AGENT_TIMEOUT' && attempt >= 1) break;
    }
  }

  if (fallbackAgentId && fallbackAgentId !== agentId) {
    const fb = await callAgent(agents, fallbackAgentId, intent, context, { timeoutMs, retries: 0 });
    return { ...fb, agentId, viaFallback: fallbackAgentId, degraded: true, error: lastError?.message };
  }
  return { ok: false, agentId, error: lastError?.code || lastError?.message || 'AGENT_FAILED', ms: null };
}

/* -------------------------------------------------------------------------- */
/*  §12 PARALLEL / SEQUENTIAL EXECUTION                                         */
/* -------------------------------------------------------------------------- */

const FALLBACKS = Object.freeze({
  'risk-agent': 'portfolio-agent',
  'strategy-agent': 'portfolio-agent',
  'research-agent': 'market-agent',
  'scenario-agent': 'strategy-agent'
});

/** Read-only agents have no ordering constraint — run them at once. */
export async function runAgentsParallel(agents, agentIds, intent, context, opts = {}) {
  const unique = [...new Set(agentIds.filter(Boolean))];
  const settled = await Promise.all(unique.map((id) =>
    callAgent(agents, id, intent, context, { ...opts, fallbackAgentId: opts.fallbacks?.[id] ?? FALLBACKS[id] ?? null })
  ));
  const results = {};
  const failures = [];
  for (const r of settled) {
    if (r.ok) results[r.agentId] = r.data;
    else failures.push({ agentId: r.agentId, error: r.error, skipped: Boolean(r.skipped) });
  }
  return { results, failures, agentsUsed: Object.keys(results), calls: settled };
}

/** Ordered pipeline where each agent sees what the previous produced. */
export async function runAgentsSequential(agents, agentIds, intent, context, opts = {}) {
  const results = {};
  const failures = [];
  const calls = [];
  let ctx = { ...context };
  for (const id of [...new Set(agentIds.filter(Boolean))]) {
    const r = await callAgent(agents, id, intent, ctx, { ...opts, fallbackAgentId: opts.fallbacks?.[id] ?? FALLBACKS[id] ?? null });
    calls.push(r);
    if (r.ok) {
      results[id] = r.data;
      ctx = { ...ctx, previousResults: { ...results } };
    } else {
      failures.push({ agentId: id, error: r.error, skipped: Boolean(r.skipped) });
    }
  }
  return { results, failures, agentsUsed: Object.keys(results), calls };
}

/* -------------------------------------------------------------------------- */
/*  §13 CROSS-CHECK / DEBATE + SYNTHESIS                                        */
/* -------------------------------------------------------------------------- */

const BULLISH = /(صعودی|رشد|مثبت|خرید|bullish|uptrend|buy|accumulate|positive|up)/i;
const BEARISH = /(نزولی|ریزش|منفی|فروش|bearish|downtrend|sell|reduce|negative|down)/i;

/** Reduce any agent payload to a directional stance so two of them can disagree. */
export function extractStance(payload) {
  if (payload == null) return { stance: 'unknown', confidence: 0 };
  if (typeof payload === 'object') {
    const explicit = payload.stance || payload.direction || payload.bias || payload.recommendation || payload.signal;
    if (typeof explicit === 'string') {
      if (BULLISH.test(explicit)) return { stance: 'bullish', confidence: Number(payload.confidence) || 0.7 };
      if (BEARISH.test(explicit)) return { stance: 'bearish', confidence: Number(payload.confidence) || 0.7 };
      return { stance: 'neutral', confidence: Number(payload.confidence) || 0.5 };
    }
    const chg = Number(payload.change24hPct ?? payload.changePct ?? payload.trendPct);
    if (Number.isFinite(chg)) {
      if (chg > 2) return { stance: 'bullish', confidence: Math.min(0.9, 0.5 + Math.abs(chg) / 40) };
      if (chg < -2) return { stance: 'bearish', confidence: Math.min(0.9, 0.5 + Math.abs(chg) / 40) };
      return { stance: 'neutral', confidence: 0.6 };
    }
    const risk = String(payload.riskLevel || payload.risk || '');
    if (/high|بالا/i.test(risk)) return { stance: 'bearish', confidence: 0.6 };
    if (/low|کم|پایین/i.test(risk)) return { stance: 'bullish', confidence: 0.55 };
  }
  const s = String(payload);
  if (BULLISH.test(s) && !BEARISH.test(s)) return { stance: 'bullish', confidence: 0.6 };
  if (BEARISH.test(s) && !BULLISH.test(s)) return { stance: 'bearish', confidence: 0.6 };
  return { stance: 'unknown', confidence: 0.3 };
}

/**
 * §13 — compare independent agent views. Disagreement is not hidden; it lowers
 * confidence and the answer must carry the warning.
 */
export function crossCheck(results = {}) {
  const views = Object.entries(results)
    .map(([agentId, payload]) => ({ agentId, ...extractStance(payload) }))
    .filter((v) => v.stance !== 'unknown');

  if (views.length < 2) {
    return { checked: views.length, agreement: 1, divergence: false, stance: views[0]?.stance || 'unknown', views, confidenceLabel: views.length ? 'MODERATE' : 'LOW' };
  }

  const tally = views.reduce((acc, v) => { acc[v.stance] = (acc[v.stance] || 0) + 1; return acc; }, {});
  const [topStance, topCount] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  const agreement = topCount / views.length;
  const opposed = Boolean(tally.bullish && tally.bearish);
  const divergence = opposed || agreement < 0.6;

  return {
    checked: views.length,
    agreement: Math.round(agreement * 100) / 100,
    divergence,
    opposed,
    stance: divergence ? 'contested' : topStance,
    tally,
    views,
    confidenceLabel: divergence ? 'LOW' : (agreement === 1 ? 'HIGH' : 'MODERATE'),
    warningFa: divergence ? 'تحلیل‌های مستقل با هم اختلاف دارند؛ این پاسخ قطعی نیست.' : null,
    warningEn: divergence ? 'Independent analyses disagree — treat this answer as low confidence.' : null
  };
}

/**
 * §12/§13 — the Synthesis Agent. It does not add a new opinion; it reconciles
 * the ones already produced and says plainly when they cannot be reconciled.
 * No agent, including this one, may decide a sensitive financial action alone.
 */
export function synthesize({ results = {}, failures = [], intent = null, deepIntent = null, locale = 'fa' } = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const check = crossCheck(results);
  const contributing = Object.keys(results);
  const coverage = contributing.length / Math.max(1, contributing.length + failures.length);

  let confidence = 0.5;
  if (check.divergence) confidence = 0.35;
  else if (check.agreement === 1 && contributing.length >= 3) confidence = 0.85;
  else if (check.agreement >= 0.6) confidence = 0.7;
  confidence *= 0.6 + 0.4 * coverage;

  return {
    schema: 'fbt.agent-synthesis.v7',
    stance: check.stance,
    agreement: check.agreement,
    divergence: check.divergence,
    confidence: Math.round(confidence * 100) / 100,
    confidenceLabel: check.divergence ? 'LOW' : (confidence >= 0.75 ? 'HIGH' : confidence >= 0.55 ? 'MODERATE' : 'LOW'),
    contributingAgents: contributing,
    failedAgents: failures.map((f) => f.agentId),
    coverage: Math.round(coverage * 100) / 100,
    // A sensitive action always needs a human, whatever the agents concluded.
    autonomousDecisionAllowed: false,
    warning: check.divergence ? (fa ? check.warningFa : check.warningEn) : null,
    createdAt: Date.now()
  };
}

/* -------------------------------------------------------------------------- */
/*  §39 REQUEST DE-DUPLICATION                                                  */
/* -------------------------------------------------------------------------- */

const inflight = new Map();
const DEDUPE_TTL_MS = 15_000;

export function requestFingerprint({ message = '', intentType = null, params = {}, conversationId = 'default' } = {}) {
  const normalized = String(message).toLowerCase().replace(/\s+/g, ' ').trim();
  let paramStr = '';
  try { paramStr = JSON.stringify(params, Object.keys(params || {}).sort()); } catch { paramStr = ''; }
  return `${conversationId}|${intentType || ''}|${normalized}|${paramStr}`;
}

/**
 * Two identical requests in flight share ONE execution. A double-tapped send
 * button must never produce two swaps (§39, and §45's "no duplicate execution").
 */
export function dedupe(key, factory) {
  const existing = inflight.get(key);
  if (existing && Date.now() - existing.startedAt < DEDUPE_TTL_MS) {
    return { deduped: true, promise: existing.promise };
  }
  const promise = Promise.resolve()
    .then(factory)
    .finally(() => {
      const cur = inflight.get(key);
      if (cur && cur.promise === promise) inflight.delete(key);
    });
  inflight.set(key, { promise, startedAt: Date.now() });
  return { deduped: false, promise };
}

export function inflightCount() { return inflight.size; }
export function clearInflight() { inflight.clear(); }
