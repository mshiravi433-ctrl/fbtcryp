import { afterEach, describe, expect, it, vi } from 'vitest';
import { runChatNegotiation, negotiationToChatMessage, parseNegotiationRequest } from '../src/lib/intent-ai/chat/negotiationChat.js';
import { resolveNegotiationAction, goalRequestText, executeStopPlan, NEGOTIATION_ACTION_TTL_MS } from '../src/lib/intent-ai/chat/negotiationActions.js';
import { buildNegotiationContext, runSurfaceCommand } from '../src/lib/intent-ai/chat/surfaceCommands.js';
import { startForm, getCurrentSlot, submitAnswer, clearForm, isFormInterruption } from '../src/lib/intent-ai/chat/multiSlotCollector.js';
import { parseGoalSpec } from '../src/lib/strategyBrain/goalSpec.js';
import { runAgentCouncil, challengeStrategy } from '../src/lib/intent-ai/agentCouncil.js';
import { createAutonomyEngine, AUTONOMY_MODES } from '../src/lib/intent-ai/autonomy/botLoop.js';
import { OPERATIONS } from '../src/lib/intent-ai/os/opsCatalog.js';
import { localizeOpsCard } from '../src/lib/intent-ai/os/opsCatalogI18n.js';
import { resolveOpsAction } from '../src/lib/intent-ai/os/opsDispatch.js';
import { readOpsRewards } from '../src/lib/intent-ai/os/opsRewards.js';
import { resolveChatRoute } from '../src/lib/intent-ai/autonomy/chatRoutes.js';
import { createEcosystemReader } from '../src/lib/strategyBrain/ecosystemState.js';
import { buildPortfolioStrategy, splitTransactionAction, estimateCost } from '../src/lib/strategyBrain/strategyEngine.js';
import { createStrategyRuntime } from '../src/lib/strategyBrain/strategyRuntime.js';
import { localizeStrategy } from '../src/lib/strategyBrain/strategyLocales.js';

const cid = 'intent-os-regression';
const goal = parseGoalSpec({ text: '۱۰۰۰ دلار سرمایه، حداقل ۲۰٪ سود در ۲۰ روز، ریسک متعادل' });
const context = () => buildNegotiationContext({ text: goalRequestText(goal) });
const offer = (mode = 'human-agent', ctx = context()) => negotiationToChatMessage(runChatNegotiation({ mode, context: ctx, locale: 'fa' }), { locale: 'fa' }).osEvent;
afterEach(() => clearForm({ conversationId: cid }));

async function ecosystem() {
  const data = { wallet: { chainId: 8453, address: '0xabc', connected: true }, portfolio: { totalValueUsd: 1000 },
    crypto: [{ id: 'bitcoin', symbol: 'BTC', price: 100000, priceChange24hPct: 1, risk: 'medium' }],
    lending: [{ id: 'aave-usdc', symbol: 'USDC', project: 'aave-v3', apy: 6, tvlUsd: 9e8, risk: 'low', chainId: 8453 }],
    gas: { gasUsd: 0.5 }, fees: { feeBps: 70 } };
  return createEcosystemReader({ readers: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, async () => v])) }).read({ only: Object.keys(data) });
}

describe('context-bound negotiation choices', () => {
  it('recognizes agent → human in both languages', () => {
    expect(parseNegotiationRequest('مذاکره ایجنت به انسان').mode).toBe('human-agent');
    expect(parseNegotiationRequest('agent-to-human negotiation').mode).toBe('human-agent');
  });
  it.each(['conservative', 'balanced', 'aggressive'])('clicking %s keeps capital, target, floor and horizon', (riskProfile) => {
    const event = offer();
    const out = resolveNegotiationAction({ event, chipId: `pick_${riskProfile}`, text: 'not a parser command' });
    expect(out.handled).toBe(true);
    expect(out.selectedGoal).toMatchObject({ capitalUsd: 1000, targetPct: 20, floorPct: 20, horizonDays: 20, riskProfile });
    expect(parseGoalSpec({ text: out.message.strategyRequest.text })).toMatchObject({ capitalUsd: 1000, targetPct: 20, floorPct: 20, horizonDays: 20, riskProfile, riskSource: 'sentence' });
    expect(out.selection.eventId).toBe(event.id);
    expect(out.message).not.toHaveProperty('executionAuthorized', true);
  });
  it.each(['متعادل', '۲', 'option 2', '🟡 متوسط / متعادل'])('a short typed %s selects balanced, never the first slash label', (text) => {
    expect(resolveNegotiationAction({ event: offer(), text }).selectedGoal.riskProfile).toBe('balanced');
  });
  it('does not turn a negated/conflicting profile or an unrelated command into a risk grant', () => {
    const event = offer();
    for (const text of ['متعادل نیست', 'کم‌ریسک یا متعادل', 'خبر بازار را نشان بده']) expect(resolveNegotiationAction({ event, text })).toBeNull();
  });
  it('collects only missing fields and preserves a picked risk/minimum', () => {
    const event = offer('human-agent', { goal: { riskProfile: 'balanced', targetPct: 20, floorPct: 20 } });
    const out = resolveNegotiationAction({ event, chipId: 'pick_balanced' });
    expect(out.intake.initialValues).toMatchObject({ riskProfile: 'balanced', targetPct: 20, floorPct: 20 });
    startForm({ ...out.intake, conversationId: cid });
    expect(getCurrentSlot({ conversationId: cid }).key).toBe('capitalUsd');
    submitAnswer({ text: '۱۰۰۰ دلار', conversationId: cid });
    expect(getCurrentSlot({ conversationId: cid }).key).toBe('horizonDays');
    expect(submitAnswer({ text: '۲۰ روز', conversationId: cid }).data).toMatchObject({ capitalUsd: 1000, targetPct: 20, floorPct: 20, horizonDays: 20, riskProfile: 'balanced', formId: 'STRATEGY_GOAL' });
  });
  it('expired, consumed, unknown and superseded clicks fail without dispatching a new plan', async () => {
    const event = offer();
    const expired = resolveNegotiationAction({ event, chipId: 'pick_balanced', now: event.at + NEGOTIATION_ACTION_TTL_MS + 1 });
    expect(expired.message.strategyRequest).toBeUndefined();
    const consumed = resolveNegotiationAction({ event: { ...event, payload: { ...event.payload, resolved: true } }, chipId: 'pick_balanced' });
    expect(consumed.message.strategyRequest).toBeUndefined();
    expect(resolveNegotiationAction({ event, chipId: 'not-in-this-card' }).message.strategyRequest).toBeUndefined();
    const next = offer();
    const stale = await runSurfaceCommand('متعادل', { context: { previousNegotiation: next }, action: { event, chipId: 'pick_balanced' } });
    expect(stale.message.osEvent.payload.executed).toBe(false);
    expect(stale.message.strategyRequest).toBeUndefined();
  });
  it.each(['a2a-plan', 'a2a-revise', 'a2a-risk'])('council button %s continues into a plan, not GENERAL', (chipId) => {
    const ctx = context();
    if (chipId === 'a2a-plan') ctx.proposal.evidenceComplete = true;
    const out = resolveNegotiationAction({ event: offer('agent-agent', ctx), chipId });
    expect(out.handled).toBe(true);
    expect(out.message.strategyRequest).toBeDefined();
    expect(out.selectedGoal.capitalUsd).toBe(1000);
    if (chipId === 'a2a-risk') expect(out.selectedGoal.riskProfile).toBe('conservative');
  });
  it('human confirmation is local only; editing terms really resumes and resets acceptance', () => {
    const event = offer('human-human');
    const accepted = resolveNegotiationAction({ event, chipId: 'h2h-confirm' });
    expect(accepted.message.osEvent.payload).toMatchObject({ localAcceptance: true, counterpartyConfirmed: false, executed: false });
    const edit = resolveNegotiationAction({ event, chipId: 'h2h-edit' });
    const updated = resolveNegotiationAction({ event: edit.message.osEvent, text: 'مهلت ۷ روز و مبلغ ۲۰۰۰ دلار', context: { answerToNegotiation: true } });
    expect(updated.message.osEvent.payload.proposal.amountUsd).toBe(2000);
    expect(updated.message.osEvent.payload.terms.find((t) => t.key === 'deadline').value).toBe('7 روز');
    expect(updated.message.osEvent.payload.terms.find((t) => t.key === 'additional').value).toContain('مهلت');
    expect(updated.message.osEvent.payload.localAcceptance).not.toBe(true);
  });
  it('opening the operations panel does not need a navigation provider', async () => {
    expect((await runSurfaceCommand('مرکز عملیات را باز کن')).panel).toBe('operations');
    expect((await runSurfaceCommand('open operations center')).panel).toBe('operations');
    expect((await runSurfaceCommand('تاریخچه را نشان بده')).panel).toBe('history');
  });
  it('external setup opens the agent catalog, never grants execution', () => {
    const out = resolveNegotiationAction({ event: offer('fbt-external-agent'), chipId: 'external-setup' });
    expect(out.panel).toBe('agents');
    expect(out.message.content).toContain('اجازهٔ اجرای مالی نمی‌دهد');
  });
});

describe('seeded/restarted wizard and interruption', () => {
  it.each(['🟡 متوسط / متعادل', 'balanced', '۲'])('completes a seeded request with %s', (text) => {
    startForm({ conversationId: cid, initialValues: { capitalUsd: 1000, targetPct: 20, horizonDays: 20, floorPct: 20 } });
    expect(getCurrentSlot({ conversationId: cid }).key).toBe('riskProfile');
    expect(submitAnswer({ conversationId: cid, text }).data).toMatchObject({ capitalUsd: 1000, targetPct: 20, horizonDays: 20, floorPct: 20, riskProfile: 'balanced' });
    expect(getCurrentSlot({ conversationId: cid })).toBeNull();
  });
  it('a typed minimum in the target slot is preserved as a floor', () => {
    startForm({ conversationId: cid, initialValues: { capitalUsd: 1000, horizonDays: 20, riskProfile: 'balanced' } });
    expect(submitAnswer({ conversationId: cid, text: 'حداقل ۲۰٪' }).data.floorPct).toBe(20);
  });
  it('validates seeds, resumes without erasing values and explicitly restarts', () => {
    startForm({ conversationId: cid, initialValues: { capitalUsd: null, targetPct: 700, riskProfile: 'invalid', horizonDays: -1 } });
    expect(getCurrentSlot({ conversationId: cid }).collectedCount).toBe(0);
    submitAnswer({ conversationId: cid, text: '1000' });
    expect(startForm({ conversationId: cid }).resumed).toBe(true);
    expect(getCurrentSlot({ conversationId: cid }).key).toBe('targetPct');
    startForm({ conversationId: cid, restart: true });
    expect(getCurrentSlot({ conversationId: cid }).key).toBe('capitalUsd');
  });
  it('rejects multiple/new-command amounts and routes stop/new topics out of the form', () => {
    startForm({ conversationId: cid });
    expect(submitAnswer({ conversationId: cid, text: '1000 یا 2000' }).ok).toBe(false);
    expect(submitAnswer({ conversationId: cid, text: '20000000' }).ok).toBe(false);
    expect(isFormInterruption('توقف کامل')).toBe(true);
    expect(isFormInterruption('اخبار بازار را نشان بده')).toBe(true);
    expect(isFormInterruption('متعادل')).toBe(false);
  });
});

describe('real stop controls with explicit consent and partial failure truth', () => {
  it('requires consent before invoking any service', async () => {
    const stopLocal = vi.fn();
    expect((await executeStopPlan({ services: { stopLocal } })).code).toBe('CONFIRMATION_REQUIRED');
    expect(stopLocal).not.toHaveBeenCalled();
    expect(resolveNegotiationAction({ event: offer('emergency'), chipId: 'emergency-confirm' }).stopRequested).toBe(true);
    expect(resolveNegotiationAction({ event: offer('emergency'), chipId: 'emergency-cancel' }).stopRequested).toBeUndefined();
  });
  it('pauses active owned jobs, skips others, and reports partial failures', async () => {
    const pauseAutomation = vi.fn(async () => ({ ok: true }));
    const pauseMonitor = vi.fn(async () => ({ ok: false }));
    const out = await executeStopPlan({ confirmed: true, services: {
      owner: 'dev:mine', stopLocal: async () => ({ ok: true }),
      listAutomations: async () => ({ ok: true, automations: [{ id: 'mine', owner: 'dev:mine', status: 'ACTIVE' }, { id: 'other', owner: 'dev:other', status: 'ACTIVE' }, { id: 'paused', status: 'PAUSED' }] }),
      listMonitors: async () => ({ ok: true, monitors: [{ id: 'mon', status: 'ACTIVE' }] }), pauseAutomation, pauseMonitor
    } });
    expect(pauseAutomation).toHaveBeenCalledExactlyOnceWith('mine');
    expect(out).toMatchObject({ ok: false, paused: 1, failures: 1, fundsMoved: false, tradesClosed: false, signed: false });
    expect((await executeStopPlan({ confirmed: true })).ok).toBe(false);
  });
  it('clears queued local proposals and disarms without closing a position', () => {
    const engine = createAutonomyEngine();
    engine.restore({ ...engine.snapshot(), mode: AUTONOMY_MODES.ARMED, running: true,
      automations: [{ id: 'a', active: true }], pendingRuns: [{ id: 'pending' }], positions: [{ id: 'open-position', stakeUsd: 100 }] });
    expect(engine.haltControls()).toMatchObject({ ok: true, cancelledPending: 1, tradesClosed: false });
    expect(engine.state.running).toBe(false);
    expect(engine.state.mode).toBe(AUTONOMY_MODES.PAPER);
    expect(engine.state.automations[0].active).toBe(false);
    expect(engine.state.positions[0].id).toBe('open-position');
    expect(engine.state.pendingRuns).toEqual([]);
  });
});

describe('council evidence and non-bypassable safety', () => {
  const votes = Object.fromEntries(['research', 'strategy', 'risk', 'liquidity', 'market', 'fee', 'portfolio', 'hedge', 'guardian', 'execution', 'exit', 'auditor'].map((r) => [r, 'APPROVE']));
  it('explicit approvals cannot override guardian or risk veto', () => {
    expect(runAgentCouncil({ proposal: { id: 'p' }, votes, context: { guardianApproved: false } }).decision).toBe('REJECT');
    expect(runAgentCouncil({ proposal: { id: 'p' }, votes, context: { riskDecision: 'block' } }).decision).toBe('REJECT');
  });
  it('fees, stale quotes and excessive drawdown cause revisions even with explicit approvals', () => {
    for (const context of [{ costComplete: false }, { quoteFresh: false }, { estimatedDrawdownPct: 20, drawdownBudgetPct: 18 }]) {
      expect(runAgentCouncil({ proposal: { id: 'p' }, votes, context }).decision).toBe('REVISE');
    }
  });
  it('null evidence is not zero liquidity, zero confidence or an exception', () => {
    expect(challengeStrategy({ amountUsd: 1000, liquidityUsd: null }).disagreements.map((r) => r.code)).not.toContain('LIQUIDITY_INSUFFICIENT');
    expect(() => runAgentCouncil({ proposal: { id: 'p' }, votes: { risk: null } })).not.toThrow();
    expect(runAgentCouncil({ proposal: { id: 'p' }, votes: { risk: { decision: 'APPROVE', confidence: null } } }).votes.find((v) => v.role === 'risk').confidence).toBeNull();
  });
});

describe('Operations Center dispatch, not page-link substitution', () => {
  it('every catalog entry has a concrete canonical dispatch in every locale', () => {
    for (const card of OPERATIONS) for (const locale of ['fa-IR', 'en-US', 'ar-SA']) {
      const action = resolveOpsAction(localizeOpsCard(card, locale), locale);
      expect(action.kind, card.id).not.toBe('unavailable');
      if (action.kind === 'chat') expect(action.prompt?.length, card.id).toBeGreaterThan(5);
    }
  });
  it('read/quote actions stay in chat; goal and monitor-list buttons open actual forms/list', () => {
    for (const card of OPERATIONS.filter((c) => ['read', 'quote'].includes(c.action))) expect(resolveOpsAction(card).kind).not.toBe('venue');
    expect(resolveOpsAction({ id: 'strategy_build', route: '/fake', action: 'navigate' })).toEqual({ kind: 'intake', formId: 'STRATEGY_GOAL' });
    expect(resolveOpsAction({ id: 'goals_create' }).kind).toBe('intake');
    expect(resolveOpsAction({ id: 'monitor_list' })).toEqual({ kind: 'history', tab: 'monitoring' });
    expect(resolveChatRoute('/intent?tab=history&section=monitoring')).toEqual({ kind: 'panel', panel: 'history', section: 'monitoring' });
    expect(OPERATIONS.find((c) => c.id === 'markets_stocks').route).toBe('/stocks?tab=equity');
    expect(OPERATIONS.find((c) => c.id === 'farm_eth').route).toBe('/farm?tab=inapp&focus=eth');
  });
  it('reads real reward responses and does not invent offline/unknown points', async () => {
    const card = OPERATIONS.find((c) => c.id === 'rewards_points');
    const summary = vi.fn(async () => ({ ok: true, data: { points: 123 } }));
    const out = await readOpsRewards(card, { services: { summary } });
    expect(summary).toHaveBeenCalledOnce();
    expect(out.content).toContain('123');
    expect(out.osEvent.payload).toMatchObject({ readOnly: true, available: true, fundsMoved: false });
    const offline = await readOpsRewards(card, { services: { summary: async () => ({ ok: false }) } });
    expect(offline.content).toContain('حدس نمی‌زنم');
    expect(offline.content).not.toContain('امتیاز ثبت‌شده: 0');
    const invalidSchema = await readOpsRewards(card, { services: { summary: async () => ({ ok: true, data: null }) } });
    expect(invalidSchema.osEvent.payload.available).toBe(false);
    const unknown = await readOpsRewards(card, { services: { summary: async () => ({ ok: true, data: { points: null } }) } });
    expect(unknown.content).toContain('امتیاز ثبت‌شده: —');
  });
});

describe('strategy selection, localization and transaction ceilings', () => {
  it('builds a genuinely selected blueprint and refuses unavailable or over-limit plans', async () => {
    const state = await ecosystem();
    const plan = buildPortfolioStrategy({ goal, state });
    expect(plan.ok).toBe(true);
    const row = plan.comparison.find((r) => r.id !== plan.chosen);
    expect(row).toBeDefined();
    const selected = buildPortfolioStrategy({ goal, state, preferredBlueprintId: row.id });
    expect(selected.ok).toBe(true);
    expect(selected.chosen).toBe(row.id);
    expect(selected.ranking[0].id).toBe(row.id);
    expect(selected.goal.selectedBlueprintId).toBe(row.id);
    expect(buildPortfolioStrategy({ goal, state, preferredBlueprintId: 'unavailable' }).code).toBe('BLUEPRINT_NOT_AVAILABLE');
    expect(buildPortfolioStrategy({ goal: { ...goal, capitalUsd: 10000001 }, state }).code).toBe('CAPITAL_OVER_LIMIT');
    expect(buildPortfolioStrategy({ goal: { ...goal, targetPct: 501 }, state }).code).toBe('TARGET_OVER_LIMIT');
  });
  it('localizes all displayed explanation fields without changing executable contracts', async () => {
    const raw = buildPortfolioStrategy({ goal, state: await ecosystem() });
    const before = JSON.stringify(raw);
    const fa = localizeStrategy(raw, 'fa-IR');
    expect(JSON.stringify(raw)).toBe(before);
    expect(fa.stages.map((s) => s.actions)).toEqual(raw.stages.map((s) => s.actions));
    expect(fa.limitations.join(' ')).not.toMatch(/Expected returns|Nothing here|Not read this turn|Gas was unread/);
    expect(fa.honesty).not.toMatch(/The target|Expected returns|Derivative exposure/);
    expect(localizeStrategy(fa, 'fa')).toEqual(fa);
    expect(localizeStrategy(raw, 'en-US')).toBe(raw);
  });
  it('splits large actions into exact separately-signed capped amounts with correctly prefilled routes', () => {
    const action = { module: 'lending', operation: 'SUPPLY', route: '/loan?tab=supply', requiresSignature: true, params: { asset: 'USDC', chainId: 8453, amountUsd: 950000.01 } };
    const chunks = splitTransactionAction(action);
    expect(chunks.map((c) => c.params.amountUsd)).toEqual([400000, 400000, 150000.01]);
    expect(chunks.every((c) => c.requiresSignature && c.params.amountUsd <= 400000)).toBe(true);
    expect(chunks[2].route).toContain('amount=150000.01');
    expect(chunks[0].route).toContain('tab=supply');
    expect(estimateCost({ sleeves: [{ family: 'lending', asset: 'USDC', weightPct: 100 }], capitalUsd: 950000.01, gas: { gasUsd: 1 } }).txCount).toBe(3);
  });
  it('large generated plans are capped; legacy oversized actions cannot advance', async () => {
    const plan = buildPortfolioStrategy({ goal: { ...goal, capitalUsd: 2000000 }, state: await ecosystem() });
    expect(plan.ok).toBe(true);
    expect(plan.stages.flatMap((s) => s.actions).filter((a) => a.requiresSignature).every((a) => a.params.amountUsd <= 400000)).toBe(true);
    const runtime = createStrategyRuntime({ strategy: { ok: true, strategyId: 'legacy', stages: [{ id: 'oversized', order: 1, movesFunds: true,
      actions: [{ requiresSignature: true, params: { amountUsd: 400001 } }] }] } });
    expect(runtime.advance().code).toBe('TRANSACTION_OVER_LIMIT');
    expect(runtime.state().stageProgress.oversized.state).not.toBe('RUNNING');
    const missing = createStrategyRuntime({ strategy: { ok: true, strategyId: 'unknown-amount', stages: [{ id: 'money', movesFunds: true, actions: [{ requiresSignature: true, params: {} }] }] } });
    expect(missing.advance().code).toBe('TRANSACTION_AMOUNT_UNVERIFIED');
  });
});
