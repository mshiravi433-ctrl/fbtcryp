/**
 * FBT INTENT OS — PHASE 213: ONE DOOR FOR CHAT COMMANDS
 * ---------------------------------------------------------------------------
 * `IntentAIUnified.sendMessage` is already 900 lines of pipeline. Adding four
 * more branches inline would make it un-reviewable, so the four commands this
 * phase introduces live here as pure functions with injected I/O:
 *
 *   «چه کارهایی می‌تونی؟»            → the whole Intent OS catalog
 *   «جستجو کن …» / «search for …»    → a real, cited web search
 *   «با ایجنت مذاکره کن» / «توافق»…  → negotiation / agreement / conflict
 *   anything else                    → null (the normal pipeline owns it)
 *
 * Everything is injected (`research`, `context`) so the node probe can run all
 * of it with no network and no React.
 */

import { catalogMessage, parseCatalogRequest, SURFACE_KINDS, surfaceMessage } from './osSurface.js';
import { negotiationToChatMessage, negotiationQuestion, parseNegotiationRequest, runChatNegotiation } from './negotiationChat.js';
import { parseSearchRequest, runChatSearch, searchToMessage } from './searchChat.js';
import { latestNegotiationEvent, resolveNegotiationAction } from './negotiationActions.js';
import { foldText } from './questionLedger.js';
import { parseGoalSpec } from '../../strategyBrain/goalSpec.js';

export const SURFACE_COMMAND_SCHEMA = 'fbt.chat-surface-command.v1';

/** Context the negotiation engines need, read from what the app already has. */
export function buildNegotiationContext({ wallet = null, portfolio = null, conversationState = null, messages = [], text = '', services = null, extra = {} } = {}) {
  const slots = conversationState?.collectedSlots || {};
  const latestPlan = [...messages].reverse().find((m) => m?.strategyPlan?.ok === true)?.strategyPlan || null;
  const parsed = parseGoalSpec({ text });
  const priorGoal = extra.goal || latestPlan?.goal || {};
  const goal = {
    ...priorGoal,
    ...(parsed.capitalUsd > 0 ? { capitalUsd: parsed.capitalUsd, capitalSource: 'user' } : {}),
    ...(parsed.targetPct != null ? { targetPct: parsed.targetPct, floorPct: parsed.floorPct } : {}),
    ...(parsed.horizonDays > 0 ? { horizonDays: parsed.horizonDays } : {}),
    ...(parsed.riskSource !== 'default' ? { riskProfile: parsed.riskProfile } : {})
  };
  const amountUsd = Number(goal.capitalUsd ?? slots.amountUsd ?? slots.amount ?? NaN);
  const asset = slots.token || slots.asset || null;
  const hasProposal = asset || Number.isFinite(amountUsd);
  // A number in a sentence is NOT evidence of liquidity, fees, or a safe trade.
  const evidenceComplete = extra.evidenceComplete === true;
  return {
    ...extra,
    goal: Object.keys(goal).length ? goal : null,
    previousNegotiation: latestNegotiationEvent(messages),
    proposal: extra.proposal || (hasProposal
      ? {
          id: `ctx_${Date.now().toString(36)}`,
          action: slots.action || extra.action || 'rebalance',
          asset,
          amountUsd: Number.isFinite(amountUsd) ? amountUsd : null,
          chainId: slots.chainId ?? null,
          risk: goal.riskProfile || slots.riskProfile || extra.risk || null,
          evidenceComplete
        }
      : null),
    riskDecision: extra.riskDecision || (latestPlan?.risk?.breaches?.some((b) => b.code === 'RISK_BAND_BREACH' || b.code === 'DRAWDOWN_ABOVE_BUDGET') ? 'block' : null),
    guardianApproved: extra.guardianApproved !== false,
    costComplete: extra.costComplete ?? latestPlan?.cost?.complete,
    estimatedDrawdownPct: extra.estimatedDrawdownPct ?? latestPlan?.risk?.estimatedDrawdownPct ?? null,
    drawdownBudgetPct: extra.drawdownBudgetPct ?? latestPlan?.risk?.drawdownBudgetPct ?? null,
    plans: Array.isArray(extra.plans) ? extra.plans : [],
    votes: extra.votes || {},
    automations: services?.automations || extra.automations || null,
    monitors: services?.monitors || extra.monitors || null,
    counterparty: extra.counterparty || null,
    deadlineDays: extra.deadlineDays ?? null,
    externalAgent: extra.externalAgent || null,
    externalVerified: extra.externalVerified === true,
    externalView: extra.externalView || null,
    options: extra.options || null,
    walletConnected: Boolean(wallet?.address || wallet?.connected),
    portfolioValueUsd: Number(portfolio?.totalValueUsd ?? NaN)
  };
}

/**
 * Try the phase-213 commands. Returns:
 *   { handled:false }                        → normal pipeline
 *   { handled:true, message, question? }     → append the message; if a
 *                                              `question` is present it must be
 *                                              registered in the ledger
 */
export async function runSurfaceCommand(text, {
  locale = 'fa',
  context = {},
  research = null,
  conversationId = null,
  action = null
} = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { handled: false };

  if (action?.event && context.previousNegotiation && action.event.schema === context.previousNegotiation.schema
    && (action.event.id && context.previousNegotiation.id ? action.event.id !== context.previousNegotiation.id : action.event.at !== context.previousNegotiation.at)) {
    return { handled: true, message: surfaceMessage({ kind: 'NOTICE', title: String(locale).startsWith('fa') ? 'پیشنهاد جایگزین شده' : 'Offer superseded',
      lines: [String(locale).startsWith('fa') ? 'مذاکرهٔ جدیدتری باز شده است؛ از گزینه‌های آخرین پیشنهاد استفاده کن.' : 'A newer negotiation is open; use the choices on the latest offer.'], chips: [], payload: { executed: false } }) };
  }

  const continuation = resolveNegotiationAction({
    text: raw, locale, context,
    event: action?.event || context.previousNegotiation,
    chipId: action?.chipId || null
  });
  if (continuation) return continuation;

  // In-page tools have deterministic destinations. Opening a panel must not
  // depend on a network provider recognizing a generic navigation sentence.
  const folded = foldText(raw);
  const panelPatterns = [
    ['operations', /^(?:لطفا\s+)?(?:مرکز\s*عملیات|مرکز\s*عملیاتی)(?:\s*(?:را|رو))?(?:\s*(?:باز\s*کن|نشان\s*بده|نمایش\s*بده))?$|^(?:open|show)?\s*(?:the\s*)?(?:operations?\s*cent(?:er|re)|ops\s*cent(?:er|re)|operations)$/i],
    ['history', /^(?:سوابق|تاریخچه)(?:\s*(?:را|رو))?(?:\s*(?:باز\s*کن|نشان\s*بده|نمایش\s*بده))?$|^(?:open|show)\s*(?:the\s*)?(?:history|operation history)$/i],
    ['status', /^(?:وضعیت\s*(?:سیستم|اینتنت))(?:\s*(?:را|رو))?(?:\s*(?:باز\s*کن|نشان\s*بده|نمایش\s*بده))?$|^(?:open|show)\s*(?:the\s*)?(?:system status|intent status)$/i]
  ];
  const panel = panelPatterns.find(([, re]) => re.test(folded))?.[0];
  if (panel) return { handled: true, command: 'OPEN_PANEL', panel,
    message: surfaceMessage({ kind: 'NOTICE', title: String(locale).startsWith('fa') ? 'ابزار عملیاتی' : 'Operations tool',
      lines: [String(locale).startsWith('fa') ? 'بخش درخواستی همین‌جا باز می‌شود؛ این کار هیچ تراکنشی اجرا نمی‌کند.' : 'Opening the requested section here; no transaction is executed.'], chips: [], payload: { readOnly: true, executed: false } }) };

  /* 1. The catalog — "what can you do". */
  if (parseCatalogRequest(raw)) {
    const catalog = catalogMessage({ locale });
    return {
      handled: true,
      command: 'CATALOG',
      message: surfaceMessage({
        kind: SURFACE_KINDS.CATALOG,
        title: catalog.title,
        lines: catalog.lines,
        chips: catalog.chips,
        payload: { entries: catalog.entries.map((e) => ({ id: e.id, kind: e.kind, title: e.title })) }
      }),
      chips: catalog.chips,
      question: null
    };
  }

  /* 2. Web search — an explicit door to the same engine the server uses. */
  const search = parseSearchRequest(raw, { locale });
  if (search) {
    const result = await runChatSearch({ query: search.query, locale, research });
    return {
      handled: true,
      command: 'SEARCH',
      message: searchToMessage(result, { query: search.query, locale }),
      search: result,
      question: null
    };
  }

  /* 3. Coordination — the human↔human / human↔agent / agent↔agent doors. */
  const negotiation = parseNegotiationRequest(raw, { locale });
  if (negotiation) {
    const result = runChatNegotiation({
      mode: negotiation.mode,
      intent: negotiation.intent,
      subject: negotiation.subject,
      context,
      locale
    });
    const question = negotiationQuestion(result, locale);
    return {
      handled: true,
      command: 'NEGOTIATION',
      message: negotiationToChatMessage(result, { locale }),
      negotiation: result,
      question: question ? { ...question, conversationId } : null
    };
  }

  return { handled: false };
}

export const SURFACE_COMMANDS_INFO = Object.freeze({
  schema: SURFACE_COMMAND_SCHEMA,
  commands: ['CATALOG', 'SEARCH', 'NEGOTIATION'],
  coordinationModes: ['human-human', 'human-agent', 'agent-agent', 'fbt-external-agent', 'emergency']
});
