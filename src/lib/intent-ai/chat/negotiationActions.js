/**
 * Stateful continuations for Intent OS cards. A choice is bound to the card
 * that offered it, not classified again as an unrelated chat sentence.
 *
 * This module has no wallet or execution authority. It only returns plans,
 * intake forms, local acknowledgements or a request to pause control loops.
 * All I/O for that last operation is injected and requires explicit consent.
 */
import { parseGoalSpec, readHorizonDays } from '../../strategyBrain/goalSpec.js';
import { resolveMonitorAsset } from '../os/monitorClient.js';
import { NEGOTIATION_CHAT_SCHEMA, runChatNegotiation, negotiationToChatMessage, negotiationQuestion } from './negotiationChat.js';
import { parseValueForSlot } from './multiSlotCollector.js';
import { foldText } from './questionLedger.js';

export const NEGOTIATION_ACTION_TTL_MS = 30 * 60 * 1000;
const PROFILES = ['conservative', 'balanced', 'aggressive'];
const faOf = (locale) => String(locale || 'fa').toLowerCase().startsWith('fa');
const riskFa = { conservative: 'محافظه‌کار', balanced: 'متعادل', aggressive: 'تهاجمی' };
const plainMessage = (content) => ({
  id: `continuation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  role: 'ai', kind: 'assistant', content, ui: { type: 'TEXT' }, actions: []
});

/** The most recent negotiation only; never revive an older, superseded offer. */
export function latestNegotiationEvent(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const event = messages[i]?.osEvent;
    if (event?.schema === NEGOTIATION_CHAT_SCHEMA) return event;
  }
  return null;
}

/** Canonical request preserves the numbers and the selected risk, in either language. */
export function goalRequestText(goal = {}, locale = 'fa') {
  const fa = faOf(locale);
  const risk = PROFILES.includes(goal.riskProfile) ? goal.riskProfile : 'balanced';
  const floor = goal.floorPct != null;
  return fa
    ? `برای ${goal.capitalUsd} دلار سرمایه، ${floor ? 'حداقل ' : ''}${goal.targetPct}٪ سود در ${goal.horizonDays} روز یک استراتژی پرتفوی با ریسک ${riskFa[risk]} بساز.`
    : `Build a portfolio strategy for ${goal.capitalUsd} dollars with ${floor ? 'at least ' : ''}${goal.targetPct}% return in ${goal.horizonDays} days and ${risk} risk.`;
}

function goalFrom(payload = {}, context = {}) {
  const known = payload.goal || context.goal || {};
  const proposal = payload.proposal || context.proposal || {};
  return {
    ...known,
    capitalUsd: known.capitalUsd > 0 ? known.capitalUsd : (proposal.amountUsd > 0 ? proposal.amountUsd : null),
    riskProfile: PROFILES.includes(known.riskProfile) ? known.riskProfile : 'balanced'
  };
}

function strategyContinuation(goal, locale, label) {
  const fa = faOf(locale);
  const ready = goal.capitalUsd > 0 && goal.targetPct != null && goal.horizonDays > 0;
  const message = plainMessage(fa
    ? `${label} ثبت شد. ${ready ? 'پلن را با همین سرمایه، هدف، بازه و سطح ریسک از داده‌های تازه می‌سازم.' : 'فقط اطلاعاتِ باقی‌مانده را در باکس پاسخ تکمیل کن؛ انتخاب ریسک حفظ می‌شود.'} هیچ تراکنشی اجرا یا امضا نشده است.`
    : `${label} recorded. ${ready ? 'Building the plan from fresh data with this capital, target, horizon and risk.' : 'Fill only the missing fields in the answer box; your risk choice is kept.'} No transaction was executed or signed.`);
  if (ready) {
    message.ui = { type: 'STRATEGY_PLAN_CARD' };
    message.strategyRequest = { text: goalRequestText(goal, locale), goal, knownCapital: true, forceFresh: true };
    return { message, selectedGoal: goal };
  }
  const initialValues = Object.fromEntries(['capitalUsd', 'targetPct', 'horizonDays', 'riskProfile', 'floorPct']
    .filter((key) => goal[key] != null && (key === 'riskProfile' || goal[key] > 0))
    .map((key) => [key, goal[key]]));
  return { message, intake: { formId: 'STRATEGY_GOAL', initialValues }, selectedGoal: goal };
}

function matchingChip(text, event, chipId) {
  const chips = Array.isArray(event?.chips) ? event.chips : [];
  if (chipId) return chips.find((c) => c.id === chipId) || null;
  const folded = foldText(text);
  const exact = chips.find((c) => [c.id, c.label, c.prompt].some((v) => v && foldText(v) === folded));
  if (exact) return exact;
  // Short typed choices and numbered replies use the same path as a click.
  if (event?.payload?.mode === 'human-agent' && folded.length <= 45) {
    const index = folded.match(/^(?:(?:گزینه|option)\s*)?([1-3])$/);
    if (index) return chips[Number(index[1]) - 1] || null;
    const profile = parseValueForSlot(text, { expectedType: 'choice', options: PROFILES.map((id) => ({ id })) });
    if (profile) return chips.find((c) => c.id === `pick_${profile}`) || null;
  }
  return null;
}

/** Returns null for a new topic; a resolved/expired clicked card fails explicitly. */
export function resolveNegotiationAction({ text = '', event = null, chipId = null, context = {}, locale = 'fa', now = Date.now() } = {}) {
  if (event?.schema !== NEGOTIATION_CHAT_SCHEMA) return null;
  const fa = faOf(locale);
  const payload = event.payload || {};
  const chip = matchingChip(text, event, chipId);
  const stale = payload.resolved === true || now - Number(event.at || 0) > NEGOTIATION_ACTION_TTL_MS;
  if (stale) return chip ? { handled: true, message: plainMessage(fa
    ? 'این پیشنهاد قبلاً پاسخ داده شده یا منقضی است. برای انتخاب تازه، دوباره مذاکره را باز کن.'
    : 'This offer was already answered or expired. Open a new negotiation for a fresh choice.') } : null;
  if (chipId && !chip) return { handled: true, message: plainMessage(fa ? 'این دکمه به پیشنهاد فعلی تعلق ندارد.' : 'This button does not belong to the current offer.') };

  const selection = chip ? { eventAt: event.at, eventId: event.id || null, chipId: chip.id } : null;
  const goal = goalFrom(payload, context);
  const profile = chip?.id?.startsWith('pick_') ? chip.id.slice(5) : null;
  if (PROFILES.includes(profile)) {
    return { handled: true, command: 'NEGOTIATION_CHOICE', selection,
      ...strategyContinuation({ ...goal, riskProfile: profile, riskSource: 'user-choice' }, locale,
        fa ? `ریسک ${riskFa[profile]}` : `${profile} risk`) };
  }

  if (['a2a-plan', 'a2a-revise', 'a2a-risk', 'a2a-subject-goal'].includes(chip?.id)) {
    const current = PROFILES.indexOf(goal.riskProfile);
    const riskProfile = chip.id === 'a2a-risk' ? PROFILES[Math.max(0, current - 1)] : goal.riskProfile;
    return { handled: true, command: 'NEGOTIATION_PLAN', selection,
      ...strategyContinuation({ ...goal, riskProfile }, locale,
        fa ? (chip.id === 'a2a-risk' ? `ریسک ${riskFa[riskProfile]}` : 'درخواست بازبینی پلن') : 'Plan review request') };
  }
  if (chip?.id === 'external-setup') {
    return { handled: true, command: 'NEGOTIATION_GUIDE', selection, panel: 'agents',
      message: plainMessage(fa
        ? 'فهرست ایجنت‌ها را باز می‌کنم. نظر خارجی فقط بعد از ثبت هویت و بررسی پیام امضاشده قابل استفاده است؛ افزودن ایجنت یا دیدن راهنما اجازهٔ اجرای مالی نمی‌دهد.'
        : 'Opening the agent catalog. External opinions require a registered identity and verified signed messages; setup never grants financial execution authority.') };
  }
  if (chip?.id === 'h2h-confirm') {
    const message = negotiationToChatMessage({
      mode: 'human-human', outcome: 'AWAITING_COUNTERPARTY', terms: payload.terms,
      proposal: payload.proposal, subject: payload.subject,
      transcript: [{ from: 'fbt-ai', text: fa
        ? 'پذیرشِ طرف شما فقط روی این دستگاه ثبت شد؛ این ثبت، امضای قرارداد نیست. هنوز تأیید طرف مقابل نداریم و هیچ پیامی برای او ارسال نشده است.'
        : 'Your side’s acceptance was recorded on this device only; it is not a contract signature. The other party has not confirmed and no message was sent to them.' }],
      notes: [], chips: []
    }, { locale });
    message.osEvent.payload.localAcceptance = true;
    message.osEvent.payload.counterpartyConfirmed = false;
    return { handled: true, command: 'NEGOTIATION_ACCEPT', selection, message };
  }
  if (chip?.id === 'h2h-edit') {
    const question = fa
      ? 'تغییر بندها را بنویس: موضوع، مبلغ، دارایی یا مهلت جدید. تأیید قبلی با اصلاح شرایط معتبر نمی‌ماند.'
      : 'Write the changed subject, amount, asset or deadline. Editing terms resets the previous acceptance.';
    const message = negotiationToChatMessage({
      mode: 'human-human', outcome: 'NEEDS_SUBJECT', terms: payload.terms, proposal: payload.proposal,
      subject: payload.subject, transcript: [], notes: [], chips: [], question
    }, { locale });
    message.osEvent.payload.editingTerms = true;
    return { handled: true, command: 'NEGOTIATION_EDIT', selection, message,
      question: { text: question, slot: 'negotiation-terms', expectedType: 'text', options: [], source: 'negotiation' } };
  }
  if (chip?.id === 'emergency-confirm') {
    return { handled: true, command: 'NEGOTIATION_STOP', selection, stopRequested: true };
  }
  if (chip?.id === 'emergency-cancel') {
    return { handled: true, command: 'NEGOTIATION_CANCEL', selection,
      message: plainMessage(fa ? 'پلن توقف لغو شد؛ هیچ پایش یا خودکارسازی تغییر نکرد.' : 'Stop plan cancelled; no monitor or automation changed.') };
  }

  // A missing subject or a terms edit is a continuation, not a GENERAL turn.
  if (payload.outcome === 'NEEDS_SUBJECT' && !chip && text.trim() && context.answerToNegotiation === true) {
    const spec = parseGoalSpec({ text });
    const proposal = { ...(payload.proposal || {}),
      action: payload.editingTerms ? (payload.proposal?.action || 'agreement') : 'review',
      asset: resolveMonitorAsset(text) || payload.proposal?.asset || null,
      amountUsd: spec.capitalUsd > 0 ? spec.capitalUsd : (payload.proposal?.amountUsd ?? null),
      evidenceComplete: false };
    const horizon = readHorizonDays({ text });
    const result = runChatNegotiation({ mode: payload.mode, subject: text, locale,
      context: { ...context, proposal: proposal.asset || proposal.amountUsd > 0 ? proposal : null,
        goal: spec.ok ? spec : context.goal,
        deadlineDays: horizon.days || context.deadlineDays,
        additionalTerm: payload.editingTerms ? text : null } });
    const question = negotiationQuestion(result, locale);
    return { handled: true, command: 'NEGOTIATION_SUBJECT',
      selection: { eventAt: event.at, eventId: event.id || null, chipId: null }, message: negotiationToChatMessage(result, { locale }), question };
  }
  if (chip?.id === 'a2a-subject-risk') {
    const amountUsd = context.portfolioValueUsd > 0 ? context.portfolioValueUsd : null;
    const result = runChatNegotiation({ mode: 'agent-agent', subject: text, locale,
      context: { ...context, proposal: amountUsd ? { action: 'risk-review', asset: 'PORTFOLIO', amountUsd, evidenceComplete: false } : null } });
    return { handled: true, command: 'NEGOTIATION_SUBJECT', selection,
      message: negotiationToChatMessage(result, { locale }), question: negotiationQuestion(result, locale) };
  }
  return null;
}

/** Pause only the consenting user's real control jobs. Never close trades or sign. */
export async function executeStopPlan({ confirmed = false, services = {} } = {}) {
  if (confirmed !== true) return { ok: false, code: 'CONFIRMATION_REQUIRED', fundsMoved: false };
  const results = [];
  try {
    const local = await services.stopLocal?.();
    results.push({ kind: 'local', id: 'autonomy', ok: local?.ok === true, code: local ? null : 'LOCAL_UNAVAILABLE' });
  } catch { results.push({ kind: 'local', id: 'autonomy', ok: false }); }
  for (const [kind, list, pause, field] of [
    ['automation', services.listAutomations, services.pauseAutomation, 'automations'],
    ['monitor', services.listMonitors, services.pauseMonitor, 'monitors']
  ]) {
    try {
      const read = await list?.();
      if (read?.ok !== true || !Array.isArray(read[field])) {
        results.push({ kind, id: null, ok: false, code: 'READ_UNAVAILABLE' });
        continue;
      }
      const active = read[field].filter((r) => r?.id && (r.status ? String(r.status).toUpperCase() === 'ACTIVE' : r.active === true)
        && (!services.owner || !r.owner || r.owner === services.owner));
      // Sequential, bounded by the real registries: never flood the server on a stop.
      for (const row of active) {
        try {
          const out = await pause?.(row.id);
          results.push({ kind, id: row.id, ok: out?.ok === true });
        } catch { results.push({ kind, id: row.id, ok: false }); }
      }
    } catch { results.push({ kind, id: null, ok: false, code: 'READ_UNAVAILABLE' }); }
  }
  return { ok: results.every((r) => r.ok), results,
    paused: results.filter((r) => r.ok && r.kind !== 'local').length,
    failures: results.filter((r) => !r.ok).length,
    fundsMoved: false, tradesClosed: false, signed: false };
}
