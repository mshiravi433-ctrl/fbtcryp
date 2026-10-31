import { createHmac } from 'node:crypto';
import { containsSensitiveKeyOrPhrase, redactSecrets } from '../../src/lib/intent-ai/orchestrator/redact.js';
import { MissionError, hash } from './store.js';

export const AGENTS = Object.freeze({
  smart_money: { label: 'Smart Money', tools: ['world.smart_money'], scope: 'read:smart-money' },
  market_analyst: { label: 'Market Analyst', tools: ['world.market'], scope: 'read:market' },
  onchain_analyst: { label: 'On-chain Analyst', tools: ['world.smart_money'], scope: 'read:smart-money' },
  technical_analyst: { label: 'Technical Analyst', tools: ['world.technical'], scope: 'read:market' },
  news_analyst: { label: 'News Analyst', tools: ['world.news'], scope: 'read:news' },
  risk_manager: { label: 'Risk Manager', tools: ['analysis.risk'], scope: 'read:market' },
  research_agent: { label: 'Research Agent', tools: ['analysis.research'], scope: 'read:memory' },
  final_judge: { label: 'Final Judge', tools: ['analysis.judge'], scope: 'read:evidence' },
  execution_guard: { label: 'Execution Guard', tools: ['execution.handoff'], scope: 'request:approval' }
});
export const KINDS = Object.freeze(['smart_money_scan', 'market_analysis', 'research', 'trade_request', 'daily_report']);
const cleanText = (v, max = 1200) => String(v ?? '').trim().slice(0, max);
export function planMission({ goal, kind, input = {}, requestedAgents = [], learningPolicy = {} }) {
  const text = `${goal} ${JSON.stringify(input)}`.toLowerCase();
  let selected;
  if (kind === 'trade_request') selected = ['market_analyst', 'technical_analyst', 'risk_manager'];
  else if (kind === 'smart_money_scan') selected = ['smart_money', 'market_analyst', 'risk_manager'];
  else if (kind === 'market_analysis') selected = ['market_analyst', 'technical_analyst', 'risk_manager'];
  else if (kind === 'daily_report') selected = ['market_analyst', 'smart_money', 'news_analyst', 'risk_manager'];
  else selected = ['research_agent'];
  if (/نهنگ|آنچین|on.?chain|whale/.test(text) && !selected.includes('onchain_analyst')) selected.push('onchain_analyst');
  if (/اخبار|news|خبر/.test(text) && !selected.includes('news_analyst')) selected.push('news_analyst');
  if (/تکنیکال|technical|rsi/.test(text) && !selected.includes('technical_analyst')) selected.push('technical_analyst');
  if (/پژوهش|research|تحقیق/.test(text) && !selected.includes('research_agent')) selected.push('research_agent');
  // Caller may narrow a plan, never add arbitrary tools or remove the judge.
  if (learningPolicy.optionalResearch === false && kind !== 'research' && !requestedAgents.includes('research_agent')) selected = selected.filter((id) => id !== 'research_agent');
  if (requestedAgents.length) selected = selected.filter((id) => requestedAgents.includes(id));
  if (kind === 'trade_request') selected.push('execution_guard');
  selected.push('final_judge');
  return selected.map((id) => ({
    id, label: AGENTS[id].label, toolId: AGENTS[id].tools[0],
    dependsOn: id === 'final_judge' ? selected.filter((x) => x !== 'final_judge')
      : ['risk_manager', 'research_agent', 'execution_guard'].includes(id) ? selected.filter((x) => !['final_judge', 'risk_manager', 'research_agent', 'execution_guard'].includes(x)) : [],
    required: true, timeoutMs: id === 'final_judge' ? 45000 : 30000, maxAttempts: 3
  }));
}
export function normalizeMission(body = {}, owner, learningPolicy = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MissionError('INVALID_BODY');
  const goal = cleanText(body.goal);
  if (goal.length < 5) throw new MissionError('GOAL_REQUIRED');
  if (containsSensitiveKeyOrPhrase(goal)) throw new MissionError('SECRET_INPUT_REFUSED');
  const kind = body.kind || (/معامله|بخر|بفروش|\btrade\b|\bbuy\b|\bsell\b/i.test(goal) ? 'trade_request' : /نهنگ|smart money|سرمایه هوشمند/i.test(goal) ? 'smart_money_scan' : 'market_analysis');
  if (!KINDS.includes(kind)) throw new MissionError('UNKNOWN_MISSION_KIND');
  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {};
  if (containsSensitiveKeyOrPhrase(JSON.stringify(input))) throw new MissionError('SECRET_INPUT_REFUSED');
  const symbol = cleanText(input.symbol || goal.match(/\b(BTC|ETH|SOL|BNB|XRP|AVAX|LINK|ARB|OP|SUI|DOGE)\b/i)?.[1] || 'BTC', 12).toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) throw new MissionError('INVALID_SYMBOL');
  const requestedAgents = Array.isArray(body.agents) ? body.agents.map(String).slice(0, 8) : [];
  if (requestedAgents.some((id) => !AGENTS[id] || id === 'execution_guard')) throw new MissionError('UNKNOWN_AGENT');
  const requestedScopes = Array.isArray(body.permissions?.scopes) ? body.permissions.scopes.map(String) : null;
  const effectivePolicy = { ...learningPolicy, optionalResearch: input.optionalResearch === false ? false : learningPolicy.optionalResearch !== false };
  const plan = planMission({ goal, kind, input: { symbol }, requestedAgents, learningPolicy: effectivePolicy });
  const scopes = [...new Set(plan.map((p) => AGENTS[p.id].scope))];
  if (requestedScopes && scopes.some((s) => !requestedScopes.includes(s))) throw new MissionError('PLAN_SCOPE_NOT_GRANTED', 403);
  const maxModelUsd = Number(body.permissions?.maxModelUsd ?? 0);
  if (!Number.isFinite(maxModelUsd) || maxModelUsd < 0 || maxModelUsd > 10) throw new MissionError('INVALID_MODEL_BUDGET');
  const priority = Number(body.priority ?? 5);
  if (!Number.isInteger(priority) || priority < 1 || priority > 10) throw new MissionError('INVALID_PRIORITY');
  const rawStart = body.schedule?.startAt;
  const startAt = rawStart == null ? Date.now() : typeof rawStart === 'number' ? rawStart : Date.parse(rawStart);
  if (!Number.isFinite(startAt) || startAt > Date.now() + 366 * 86400000) throw new MissionError('INVALID_SCHEDULE');
  const intervalMs = body.schedule?.intervalMs == null ? null : Number(body.schedule.intervalMs);
  if (intervalMs !== null && (!Number.isFinite(intervalMs) || intervalMs < 60000 || intervalMs > 366 * 86400000)) throw new MissionError('INVALID_INTERVAL');
  if (kind === 'trade_request' && intervalMs) throw new MissionError('RECURRING_EXECUTION_FORBIDDEN');
  const normalizedInput = { symbol, locale: (input.locale || body.locale) === 'en' ? 'en' : 'fa', horizonHours: Math.max(1, Math.min(168, Number(input.horizonHours) || 24)), optionalResearch: effectivePolicy.optionalResearch, modelEnabled: learningPolicy.modelEnabled !== false, modelProvider: learningPolicy.modelProvider || null, minOpportunityConfidence: Math.max(0, Math.min(1, Number(learningPolicy.minOpportunityConfidence ?? 0.6))) };
  const fingerprint = hash({ goal, kind, input: normalizedInput, plan, priority, scopes, maxModelUsd, intervalMs, startAt: intervalMs || body.schedule?.startAt ? startAt : null });
  const key = cleanText(body.idempotencyKey, 100);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new MissionError('IDEMPOTENCY_KEY_REQUIRED');
  return {
    owner, goal, kind, input: normalizedInput, plan, priority,
    permissions: { scopes, maxModelUsd, canSign: false, canMoveFunds: false, financialLimitUsd: 0 },
    schedule: intervalMs || startAt > Date.now() ? { intervalMs, startAt, nextAt: startAt + (intervalMs || 0), parentId: null } : null,
    dueAt: startAt, fingerprint, idempotencyKey: key
  };
}

/** Fail-closed authorization at EVERY dispatch, not only at mission creation. */
export function createPolicyEngine(store) {
  function authorize({ mission, task, agent }) {
    const stop = store.getState('emergency-stop', false);
    const ownerStop = store.getState(`emergency-stop:${mission.owner}`, false);
    const agentStop = store.getState(`agent-stop:${task.agent_id}`, false) || store.getState(`agent-stop:${mission.owner}:${task.agent_id}`, false);
    if (stop || ownerStop || agentStop) return { ok: false, code: 'EMERGENCY_STOP', retryable: false };
    if (!AGENTS[task.agent_id] || AGENTS[task.agent_id].tools[0] !== task.tool_id || agent?.id !== task.agent_id) return { ok: false, code: 'TOOL_NOT_ALLOWED', retryable: false };
    if (!mission.permissions.scopes.includes(agent.scope) || agent.scope !== task.input.scope) return { ok: false, code: 'SCOPE_NOT_GRANTED', retryable: false };
    if (task.tool_id.startsWith('execution.') && mission.permissions.financialLimitUsd !== 0) return { ok: false, code: 'FINANCIAL_AUTHORITY_FORBIDDEN', retryable: false };
    return { ok: true, code: 'ALLOW_READ_ONLY', policyVersion: 1 };
  }
  return { authorize };
}
export function ownerIdentity({ device, telegramId, secret }) {
  if (!secret || secret.length < 32) throw new MissionError('MISSION_SECRET_NOT_CONFIGURED', 503);
  const identity = telegramId ? `telegram:${telegramId}` : /^[A-Za-z0-9_-]{40,64}$/.test(String(device || '')) ? `device:${device}` : null;
  if (!identity) throw new MissionError('STRONG_IDENTITY_REQUIRED', 401);
  return `mc_${createHmac('sha256', secret).update('fbt-owner-v1').update(identity).digest('hex')}`;
}
