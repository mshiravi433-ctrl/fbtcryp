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
import {
  NEGOTIATION_CHAT_SCHEMA,
  runChatNegotiation,
  negotiationToChatMessage,
  negotiationQuestion,
  collaborationActionChips
} from './negotiationChat.js';
import {
  consentToCollaboration,
  recordCounterpartyReport,
  recordLocalCollaborationResult,
  recordPlanDraftRequest,
  reviewCollaboration
} from './collaborationLifecycle.js';
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

function collaborationMessage(payload, session, locale, text = null) {
  const fa = faOf(locale);
  const outcome = session.review?.status === 'REJECTED' ? 'CONFLICT'
    : session.review?.status === 'NEEDS_REVISION' ? 'ESCALATION'
      : session.mode === 'human-human' ? 'AWAITING_COUNTERPARTY' : 'AWAITING_USER';
  const defaultText = session.review?.status === 'REVIEWED'
    ? (session.consent?.local?.status === 'LOCAL_ACCEPTANCE_ONLY'
      ? (fa ? 'بازبینی و پذیرشِ سمت تو ثبت شد؛ طرف مقابل هنوز مستقل تأیید نشده و تماسی هم انجام نشد.' : 'Your review and local-only acceptance are recorded; the counterparty is still unverified and nobody was contacted.')
      : session.consent?.local?.status === 'RECORDED_LOCAL'
        ? (fa ? 'بازبینی و رضایتِ محدود به برنامه‌ریزی ثبت شد؛ هیچ اجرا یا تماس خارجی مجاز نیست.' : 'Review and planning-only consent are recorded; no execution or external contact is authorized.')
        : (fa ? 'بازبینی ثبت شد؛ برای ادامه باید رضایتِ جداگانه و محدود به همین دامنه را ثبت کنی.' : 'Review is recorded; a separate consent scoped to this action is required to continue.'))
    : session.review?.status === 'NEEDS_REVISION'
      ? (fa ? 'بازبین اصلاح خواست؛ این پیش‌نویس هنوز تأیید یا اجرا نشده است.' : 'The reviewer requested changes; this draft is not approved or executed.')
      : session.review?.status === 'REJECTED'
        ? (fa ? 'پیش‌نویس رد شد و ادامهٔ آن بسته است.' : 'The draft was rejected and this workflow is closed.')
        : (fa ? 'شرکت‌کنندگان، وظایف و نتایج ثبت شدند؛ حالا پیش‌نویس را بازبینی کن.' : 'Participants, assignments and results are recorded; review the draft before continuing.');
  return negotiationToChatMessage({
    mode: session.mode,
    outcome,
    subject: payload.subject,
    proposal: payload.proposal,
    goal: payload.goal,
    terms: payload.terms,
    collaboration: session,
    chips: collaborationActionChips(session, locale),
    transcript: [{ from: 'fbt-ai', text: text || defaultText }],
    notes: [],
    at: Date.now()
  }, { locale });
}

function lifecycleFailure(locale, code) {
  const fa = faOf(locale);
  return plainMessage(fa
    ? `این گام ثبت نشد (${code}). پیش‌نویس یا نشست همکاری منقضی/نامعتبر است؛ مذاکره را دوباره باز کن.`
    : `This step was not recorded (${code}). The collaboration draft is invalid or expired; open a fresh negotiation.`);
}

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
    const collaboration = payload.collaboration;
    if (!collaboration) return { handled: true, message: lifecycleFailure(locale, 'COLLABORATION_SESSION_REQUIRED') };
    const recorded = recordLocalCollaborationResult(collaboration, {
      taskId: 'risk-choice', text: profile, now
    });
    if (!recorded.ok) return { handled: true, message: lifecycleFailure(locale, recorded.code) };
    const selectedGoal = { ...goal, riskProfile: profile, riskSource: 'user-choice' };
    const message = collaborationMessage({ ...payload, goal: selectedGoal }, recorded.session, locale,
      fa ? `انتخاب ریسک «${riskFa[profile]}» به‌عنوان نتیجهٔ وظیفهٔ تو ثبت شد. پیش از ساخت پلن، پیش‌نویس را بازبینی کن.`
        : `${profile} risk was recorded as your task result. Review the collaboration draft before building a plan.`);
    return { handled: true, command: 'NEGOTIATION_CHOICE', selection, message, selectedGoal };
  }

  if (chip?.id === 'collab-build-plan') {
    const session = payload.collaboration;
    const requested = recordPlanDraftRequest(session, { now });
    if (!requested.ok) return { handled: true, message: lifecycleFailure(locale, requested.code) };
    const selectedRisk = requested.session.tasks?.find((task) => task.id === 'risk-choice')?.result?.text;
    const riskProfile = PROFILES.includes(selectedRisk) ? selectedRisk : goal.riskProfile;
    const continuation = strategyContinuation({ ...goal, riskProfile, riskSource: selectedRisk ? 'user-choice' : goal.riskSource }, locale,
      fa ? 'بازبینی و رضایت محدود به برنامه‌ریزی ثبت شد' : 'Reviewed, planning-only collaboration');
    const status = collaborationMessage(payload, requested.session, locale,
      fa ? 'درخواست ساخت پیش‌نویس پلن به موتور استراتژی تحویل شد؛ نتیجهٔ پلن جداگانه نمایش داده می‌شود. اجرا یا امضا انجام نمی‌شود.'
        : 'The strategy engine received a plan-draft request; its result is shown separately. Nothing is executed or signed.');
    return { handled: true, command: 'NEGOTIATION_PLAN', selection, ...continuation, additionalMessages: [status] };
  }
  if (['a2a-plan', 'a2a-revise', 'a2a-risk'].includes(chip?.id)) {
    const requested = recordPlanDraftRequest(payload.collaboration, { now });
    if (!requested.ok) return { handled: true, message: lifecycleFailure(locale, requested.code) };
    const current = PROFILES.indexOf(goal.riskProfile);
    const riskProfile = chip.id === 'a2a-risk' ? PROFILES[Math.max(0, current - 1)] : goal.riskProfile;
    const continuation = strategyContinuation({ ...goal, riskProfile }, locale,
      fa ? (chip.id === 'a2a-risk' ? `ریسک ${riskFa[riskProfile]}` : 'درخواست بازبینی پلن') : 'Plan review request');
    const status = collaborationMessage(payload, requested.session, locale,
      fa ? 'درخواست پیش‌نویس پلن ثبت شد؛ هیچ اجرا یا امضایی انجام نمی‌شود.' : 'Plan-draft request recorded; nothing is executed or signed.');
    return { handled: true, command: 'NEGOTIATION_PLAN', selection, ...continuation, additionalMessages: [status] };
  }
  if (chip?.id === 'a2a-subject-goal') {
    return { handled: true, command: 'NEGOTIATION_PLAN', selection,
      ...strategyContinuation(goal, locale, fa ? 'درخواست پلن برای هدف مالی' : 'Plan request for financial goal') };
  }
  if (chip?.id === 'external-setup') {
    return { handled: true, command: 'NEGOTIATION_GUIDE', selection, panel: 'agents',
      message: plainMessage(fa
        ? 'فهرست ایجنت‌ها را باز می‌کنم. نظر خارجی فقط بعد از ثبت هویت و بررسی پیام امضاشده قابل استفاده است؛ افزودن ایجنت یا دیدن راهنما اجازهٔ اجرای مالی نمی‌دهد.'
        : 'Opening the agent catalog. External opinions require a registered identity and verified signed messages; setup never grants financial execution authority.') };
  }
  if (['collab-review-accept', 'collab-review-changes', 'collab-review-reject'].includes(chip?.id)) {
    const session = payload.collaboration;
    const decision = chip.id === 'collab-review-accept' ? 'ACCEPT_DRAFT'
      : chip.id === 'collab-review-changes' ? 'REQUEST_CHANGES' : 'REJECT_DRAFT';
    const reviewed = reviewCollaboration(session, { decision, now });
    if (!reviewed.ok) return { handled: true, message: lifecycleFailure(locale, reviewed.code) };
    const textForReview = decision === 'ACCEPT_DRAFT'
      ? (fa ? 'بازبینی پیش‌نویس ثبت شد؛ این تأیید، رضایت جداگانه یا اجازهٔ اجرا نیست.' : 'Draft review is recorded; this is not separate consent or execution authority.')
      : decision === 'REQUEST_CHANGES'
        ? (fa ? 'درخواست اصلاح ثبت شد؛ تا ایجاد پیش‌نویس تازه، رضایت و اجرا غیرفعال‌اند.' : 'A change request is recorded; consent and execution stay off until a fresh draft is reviewed.')
        : (fa ? 'رد پیش‌نویس ثبت شد؛ ادامهٔ این همکاری بسته است.' : 'The draft was rejected; this collaboration is closed.');
    return { handled: true, command: 'COLLABORATION_REVIEW', selection,
      message: collaborationMessage(payload, reviewed.session, locale, textForReview) };
  }
  if (chip?.id === 'collab-consent' || chip?.id === 'h2h-confirm') {
    const session = payload.collaboration;
    const consent = consentToCollaboration(session, { now });
    if (!consent.ok) return { handled: true, message: lifecycleFailure(locale, consent.code) };
    const textForConsent = consent.session.mode === 'human-human'
      ? (fa ? 'پذیرشِ سمت تو فقط به‌صورت محلی ثبت شد؛ این قرارداد یا امضای معتبر نیست و طرف مقابل هنوز تأیید نشده است.' : 'Your side-only acceptance is stored locally; this is not a contract or signature, and the counterparty is not verified.')
      : (fa ? 'رضایت تو فقط برای برنامه‌ریزی همین کار ثبت شد؛ اجرای مالی، تماس خارجی و اختیار اجرایی وجود ندارد.' : 'Your consent is limited to planning this task; there is no financial execution, external contact or execution authority.');
    return { handled: true, command: 'COLLABORATION_CONSENT', selection,
      message: collaborationMessage(payload, consent.session, locale, textForConsent) };
  }
  if (chip?.id === 'collab-counterparty-report') {
    const session = payload.collaboration;
    if (session?.mode !== 'human-human' || session.review?.status !== 'REVIEWED'
      || session.consent?.local?.status !== 'LOCAL_ACCEPTANCE_ONLY') {
      return { handled: true, message: lifecycleFailure(locale, 'LOCAL_ACCEPTANCE_REQUIRED') };
    }
    const question = fa
      ? 'پاسخی را که از طرف مقابل دریافت کردی بنویس. این فقط گزارش توست؛ هویت یا رضایت او تأیید نخواهد شد.'
      : 'Enter the reply you received from the counterparty. This is only your report; their identity or consent will not be verified.';
    const message = negotiationToChatMessage({
      mode: session.mode, outcome: 'NEEDS_SUBJECT', question,
      collaboration: session, collaborationStep: 'counterparty-report',
      proposal: payload.proposal, subject: payload.subject, terms: payload.terms,
      transcript: [{ from: 'fbt-ai', text: fa ? 'ثبت پاسخ گزارش‌شده، تماس با طرف مقابل انجام نمی‌دهد.' : 'Recording a reported reply does not contact the counterparty.' }],
      notes: [], chips: [], at: now
    }, { locale });
    return { handled: true, command: 'COLLABORATION_COUNTERPARTY_REPORT', selection, message,
      question: { text: question, slot: 'counterparty-report', expectedType: 'text', options: [], source: 'negotiation' } };
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

  if (payload.collaborationStep === 'counterparty-report' && !chip && text.trim() && context.answerToNegotiation === true) {
    const reported = recordCounterpartyReport(payload.collaboration, { text, now });
    if (!reported.ok) return { handled: true, message: lifecycleFailure(locale, reported.code) };
    const message = collaborationMessage(payload, reported.session, locale,
      fa ? 'گزارش ثبت شد، اما پاسخ، هویت و رضایتِ طرف مقابل تأییدنشده باقی می‌مانند؛ بازبینی پیش‌نویس از نو لازم است.'
        : 'The report is recorded, but the reply, identity and consent remain unverified; review the draft again.');
    return { handled: true, command: 'COLLABORATION_COUNTERPARTY_REPORT',
      selection: { eventAt: event.at, eventId: event.id || null, chipId: null }, message };
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
