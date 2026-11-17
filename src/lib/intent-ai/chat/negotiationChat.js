/**
 * FBT INTENT OS — PHASE 213: NEGOTIATION, AGREEMENT, CONFLICT IN THE CHAT
 * ---------------------------------------------------------------------------
 * The complaint this module exists to answer:
 *
 *   «وقتی اپشنی هست باید هماهنگ شود — مثلاً انسان‌به‌انسان، انسان‌به‌ایجنت یا
 *    ایجنت‌به‌ایجنت را می‌تواند داخل چت بپرسد؛ یا توافق، یا اضطرار»
 *
 * The engines existed (council, handshake, goal negotiation, dispute, escrow)
 * but a user could not ASK for any of them in a sentence. This module is the
 * chat door to those engines. It is deterministic, offline and honest:
 *
 *   sentence ──▶ parseNegotiationRequest ──▶ runChatNegotiation ──▶ transcript
 *                       (which mode?)            (real engines)        (chat card)
 *
 * Laws — enforced here and asserted by test/intent-ai/phase213-chat-surface-probe:
 *   1. A transcript is a RECORD of deterministic checks, not a story. Every
 *      line comes from a real engine (challengeStrategy, runAgentCouncil,
 *      detectPlanConflicts) or from a real constant of this app (policy caps,
 *      escrow caps, appeal window).
 *   2. Nothing is executed and nothing is sent to anybody. `executed` is always
 *      false, `requiresUserAuthorization` is always true, and the human-human
 *      mode says plainly that FBT has not contacted the counterparty.
 *   3. No verified external agent, no external opinion. The mode refuses with
 *      the reason instead of inventing a second opinion.
 *   4. Emergency is a PLAN. It lists exactly what stopping means and waits for
 *      an explicit confirmation; it never stops anything by itself.
 */

import { runAgentCouncil, challengeStrategy, COUNCIL_ROLES } from '../agentCouncil.js';
import { detectPlanConflicts } from '../os/upgrade7/planner.js';
import { DEFAULT_POLICY_CAPS } from '../permissions.js';
import { MAX_ESCROW_USD } from '../agentEscrow.js';
import { APPEAL_WINDOW_MS } from '../agentDispute.js';
import { RISK_PROFILES } from '../../strategyBrain/strategyEngine.js';
import {
  COLLABORATION_LOCAL_USER_ID,
  createCollaborationSession
} from './collaborationLifecycle.js';
import { createExternalAgentRuntime } from '../externalAgentRuntime.js';

export const NEGOTIATION_CHAT_SCHEMA = 'fbt.chat-negotiation.v1';

export const NEGOTIATION_MODES = Object.freeze({
  HUMAN_HUMAN: 'human-human',
  HUMAN_AGENT: 'human-agent',
  AGENT_AGENT: 'agent-agent',
  EXTERNAL_AGENT: 'fbt-external-agent',
  EMERGENCY: 'emergency'
});

export const NEGOTIATION_OUTCOMES = Object.freeze({
  AGREEMENT: 'AGREEMENT',
  CONFLICT: 'CONFLICT',
  ESCALATION: 'ESCALATION',
  AWAITING_USER: 'AWAITING_USER',
  AWAITING_COUNTERPARTY: 'AWAITING_COUNTERPARTY',
  NEEDS_SUBJECT: 'NEEDS_SUBJECT',
  UNAVAILABLE: 'UNAVAILABLE'
});

export const NEGOTIATION_LAWS = Object.freeze({
  executesNothing: true,
  sendsNothingOnYourBehalf: true,
  requiresUserAuthorization: true,
  messagesAreNonExecutable: true,
  externalMustBeVerified: true
});

const MODES = Object.values(NEGOTIATION_MODES);

const isFa = (locale) => String(locale || 'fa').toLowerCase().startsWith('fa');
const fold = (v) => String(v || '').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/* -------------------------------------------------------------------------- */
/*  WHAT DID THE USER ASK FOR?                                                 */
/* -------------------------------------------------------------------------- */

const EMERGENCY_RE = /(اضطرار|اضطراری|وضعیت\s*اضطراری|توقف\s*کامل|همه\s*چیز\s*را\s*متوقف|فریز\s*کن|emergency|stop\s*everything|kill\s*switch|freeze\s*everything)/i;
const CONFLICT_RE = /(تضاد|تضادی|اختلاف|تناقض|ناسازگار|conflict|contradict|disagree)/i;
const AGREEMENT_RE = /(توافق|سازش|قرارداد|قرار\s*بگذار|به\s*توافق\s*رسید|agreement|make\s*a\s*deal|deal\s*closed|consensus)/i;
const EXTERNAL_RE = /(ایجنت\s*خارجی|ایجنتِ\s*خارجی|external\s*agent|نظر\s*دوم|second\s*opinion|نظر\s*مستقل)/i;
const AGENT_AGENT_RE = /(ایجنت\s*(?:به|با|و|↔)\s*ایجنت|ایجنت\s*ها?\s*(?:با\s*هم|باهم|مذاکره)|شورای\s*ایجنت|رأی\s*شورا|agent\s*(?:to|2|↔)\s*agent|agent\s*council)/i;
const HUMAN_HUMAN_RE = /(انسان\s*(?:به|تا|با|↔)\s*انسان|دو\s*طرف|طرفین|طرف\s*دیگر|دو\s*نفر|قرارداد\s*بین|توافق\s*دو\s*طرفه|human\s*(?:to|2|↔)\s*human|two\s*parties|both\s*sides|counterparty)/i;
const HUMAN_AGENT_RE = /(مذاکره\s*با\s*(?:هوش|ایجنت|fbt)|با\s*ایجنت|با\s*هوش\s*مصنوعی\s*مذاکره|انسان\s*(?:به|با|↔)\s*ایجنت|ایجنت\s*(?:به|با|↔)\s*انسان|negotiat\w*\s*with\s*(?:the\s*)?(?:agent|ai)|human[\s-]*(?:to|2|↔)[\s-]*agent|agent[\s-]*(?:to|2|↔)[\s-]*human)/i;
const NEGOTIATE_RE = /(مذاکره|چانه|negotiat|bargain)/i;

/** Strip the command words so the subject is what is left, not the verb. */
function extractSubject(text) {
  return String(text || '')
    .replace(/\u200c/g, ' ')
    .replace(/(?:لطفا|لطفاً|please|می\s*خواهم|میخوام|می‌خواهم|میخام|i\s*want\s*to|بگو|کن|کنید|را|رو)\b/gi, ' ')
    .replace(/[.،!؟?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * Which coordination door did the sentence knock on? Returns null when the
 * sentence is not a coordination request at all (the normal pipeline owns it).
 */
export function parseNegotiationRequest(text, { locale = 'fa' } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const folded = fold(raw);
  const subject = extractSubject(raw);

  let mode = null;
  let intent = 'NEGOTIATE';
  if (EMERGENCY_RE.test(folded)) { mode = NEGOTIATION_MODES.EMERGENCY; intent = 'ESCALATION'; }
  else if (CONFLICT_RE.test(folded)) { mode = NEGOTIATION_MODES.AGENT_AGENT; intent = 'CONFLICT'; }
  else if (EXTERNAL_RE.test(folded)) { mode = NEGOTIATION_MODES.EXTERNAL_AGENT; }
  else if (AGENT_AGENT_RE.test(folded)) { mode = NEGOTIATION_MODES.AGENT_AGENT; }
  else if (HUMAN_HUMAN_RE.test(folded)) { mode = NEGOTIATION_MODES.HUMAN_HUMAN; }
  else if (HUMAN_AGENT_RE.test(folded)) { mode = NEGOTIATION_MODES.HUMAN_AGENT; }
  else if (NEGOTIATE_RE.test(folded)) { mode = NEGOTIATION_MODES.HUMAN_AGENT; }
  else if (intent !== 'CONFLICT' && AGREEMENT_RE.test(folded) && /\b(انسان|دو\s*طرف|human|party|parties)\b/i.test(folded)) { mode = NEGOTIATION_MODES.HUMAN_HUMAN; intent = 'AGREEMENT'; }
  else if (AGREEMENT_RE.test(folded) && /(ایجنت|agent|شورا|council)/i.test(folded)) { mode = NEGOTIATION_MODES.AGENT_AGENT; intent = 'AGREEMENT'; }
  if (!mode || !MODES.includes(mode)) return null;
  return { ok: true, mode, intent, subject, locale: isFa(locale) ? 'fa' : 'en', raw };
}

/* -------------------------------------------------------------------------- */
/*  THE SUBJECT — a real proposal or an honest question                        */
/* -------------------------------------------------------------------------- */

function proposalFromContext(context = {}) {
  if (context.proposal && typeof context.proposal === 'object') return context.proposal;
  const asset = context.asset || context.token || null;
  const amountUsd = Number(context.amountUsd ?? context.amount ?? NaN);
  if (!asset && !Number.isFinite(amountUsd)) return null;
  return {
    id: `proposal_${Date.now().toString(36)}`,
    action: context.action || 'rebalance',
    asset: asset || null,
    amountUsd: Number.isFinite(amountUsd) ? amountUsd : null,
    chainId: context.chainId ?? null,
    risk: context.risk || null,
    goal: context.goal || null,
    evidenceComplete: context.evidenceComplete === true
  };
}

function money(v, locale) {
  const n = v == null || v === '' ? NaN : Number(v);
  if (!Number.isFinite(n)) return '—';
  return isFa(locale) ? `${n.toLocaleString('en-US')} دلار` : `$${n.toLocaleString('en-US')}`;
}

function optionSet(context = {}, locale = 'fa') {
  const fa = isFa(locale);
  const given = Array.isArray(context.options) ? context.options.filter((o) => o && ['conservative', 'balanced', 'aggressive'].includes(o.riskProfile || o.id)) : [];
  if (given.length) {
    return given.slice(0, 3).map((o, i) => ({
      id: String(o.riskProfile || o.id),
      label: String(o.label || o.id),
      tradeoff: o.tradeoff ? String(o.tradeoff) : null
    }));
  }
  // Describe the actual strategy bands, not invented slippage or stake limits.
  return ['conservative', 'balanced', 'aggressive'].map((id) => {
    const band = RISK_PROFILES[id];
    const label = {
      conservative: { fa: 'محافظه‌کارانه — حفظ سرمایه', en: 'Conservative — capital preservation' },
      balanced: { fa: 'متعادل — رشد با ریسک میانه', en: 'Balanced — medium-risk growth' },
      aggressive: { fa: 'تهاجمی — پذیرش ریسک بالاتر', en: 'Aggressive — higher-risk exposure' }
    }[id];
    return {
      id, label: fa ? label.fa : label.en,
      riskProfile: id,
      drawdownBudgetPct: band.drawdownBudgetPct,
      allowsLeverage: band.allowsLeverage,
      tradeoff: fa
        ? `بودجه افت برآوردی ${band.drawdownBudgetPct}٪، حداکثر ${band.maxSleeves} بخش${band.allowsLeverage ? `؛ اهرم فقط پس از بررسی و تا سقف ${DEFAULT_POLICY_CAPS.maxLeverage}×` : '، بدون اهرم'}. این بودجه تضمینِ محدود شدن ضرر نیست.`
        : `Estimated drawdown budget ${band.drawdownBudgetPct}%, up to ${band.maxSleeves} sleeves${band.allowsLeverage ? `; leverage only after review, capped at ${DEFAULT_POLICY_CAPS.maxLeverage}×` : ', no leverage'}. This budget is not a guaranteed loss limit.`
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  RUN                                                                        */
/* -------------------------------------------------------------------------- */

function line(from, type, text, params = null) {
  return { from, type, text, params };
}

function baseResult({ mode, intent, locale, now }) {
  return {
    ok: true,
    schema: NEGOTIATION_CHAT_SCHEMA,
    mode,
    intent: intent || 'NEGOTIATE',
    locale: isFa(locale) ? 'fa' : 'en',
    transcript: [],
    outcome: NEGOTIATION_OUTCOMES.NEEDS_SUBJECT,
    decision: null,
    agreement: false,
    conflicts: [],
    question: null,
    chips: [],
    notes: [],
    collaboration: null,
    requiresUserAuthorization: true,
    executed: false,
    broadcast: false,
    at: Number(now)
  };
}

function localParticipant(locale) {
  return { id: COLLABORATION_LOCAL_USER_ID, kind: 'human', label: isFa(locale) ? 'تو' : 'You' };
}

function internalParticipant(id, label, status = 'available') {
  return { id: `fbt:${id}`, kind: 'internal-agent', label, status };
}

function attachCollaboration(result, { participants, tasks, now, subject = '' } = {}) {
  const opened = createCollaborationSession({
    mode: result.mode,
    subject,
    participants: [localParticipant(result.locale), ...(participants || [])],
    tasks: tasks || [],
    now
  });
  result.collaboration = opened.ok ? opened.session : null;
  return result.collaboration;
}

export function collaborationActionChips(session, locale = 'fa') {
  if (!session) return [];
  const fa = isFa(locale);
  const mode = session.mode;
  if (session.review?.status === 'PENDING') {
    const hasBlockers = (session.tasks || []).some((task) => task.status === 'BLOCKED');
    return [
      ...(!hasBlockers ? [{ id: 'collab-review-accept', label: fa ? 'پیش‌نویس را بازبینی کردم' : 'Review draft', prompt: fa ? 'پیش‌نویس همکاری را تأیید می‌کنم' : 'I reviewed the collaboration draft' }] : []),
      { id: 'collab-review-changes', label: fa ? 'اصلاح لازم است' : 'Request changes', prompt: fa ? 'این پیش‌نویس نیاز به اصلاح دارد' : 'This draft needs changes' },
      { id: 'collab-review-reject', label: fa ? 'رد پیش‌نویس' : 'Reject draft', prompt: fa ? 'این پیش‌نویس همکاری را رد می‌کنم' : 'I reject this collaboration draft' }
    ];
  }
  if (session.review?.status === 'REVIEWED' && session.consent?.local?.status === 'NOT_RECORDED') {
    return mode === NEGOTIATION_MODES.HUMAN_HUMAN
      ? [{ id: 'h2h-confirm', label: fa ? 'فقط از طرف خودم می‌پذیرم' : 'Accept for my side only', prompt: fa ? 'فقط از طرف خودم شرایط را می‌پذیرم' : 'I accept these terms for my side only' }]
      : [{ id: 'collab-consent', label: fa ? 'موافقت با برنامه‌ریزی' : 'Consent to planning', prompt: fa ? 'برای برنامه‌ریزی همکاری رضایت می‌دهم' : 'I consent to planning-only collaboration' }];
  }
  if (mode === NEGOTIATION_MODES.HUMAN_HUMAN && session.consent?.local?.status === 'LOCAL_ACCEPTANCE_ONLY'
    && session.consent?.counterparty?.status === 'NOT_VERIFIED') {
    return [{ id: 'collab-counterparty-report', label: fa ? 'ثبت پاسخ گزارش‌شدهٔ طرف مقابل' : 'Record a reported reply', prompt: fa ? 'پاسخ گزارش‌شدهٔ طرف مقابل را ثبت کن — تأییدنشده' : 'Record a reported counterparty reply — unverified' }];
  }
  if ([NEGOTIATION_MODES.HUMAN_AGENT, NEGOTIATION_MODES.AGENT_AGENT].includes(mode)
    && session.consent?.local?.status === 'RECORDED_LOCAL'
    && session.planDraftState !== 'REQUESTED') {
    return [{ id: 'collab-build-plan', label: fa ? 'ساخت پیش‌نویس پلن' : 'Build plan draft', prompt: fa ? 'پیش‌نویس پلن را بساز' : 'Build the plan draft' }];
  }
  return [];
}

/**
 * Run one negotiation in chat. Deterministic: same context → same transcript.
 */
export function runChatNegotiation({ mode, intent = 'NEGOTIATE', subject = '', context = {}, locale = 'fa', now = Date.now() } = {}) {
  const result = baseResult({ mode, intent, locale, now });
  const fa = isFa(locale);
  const proposal = proposalFromContext({ ...context, goal: subject || context.goal });
  result.subject = subject || null;
  result.proposal = proposal;
  result.goal = context.goal || null;

  /* ── emergency: a stop PLAN, never a stop ─────────────────────────────── */
  if (mode === NEGOTIATION_MODES.EMERGENCY) {
    const automations = Array.isArray(context.automations) ? context.automations.length : null;
    const monitors = Array.isArray(context.monitors) ? context.monitors.length : null;
    result.outcome = NEGOTIATION_OUTCOMES.ESCALATION;
    result.transcript = [
      line('user', 'request', fa ? 'وضعیت اضطراری اعلام شد.' : 'Emergency declared.'),
      line('fbt-ai', 'plan', fa
        ? 'این مسیر یک «پلن توقف» می‌سازد؛ خودش هیچ‌چیز را متوقف نمی‌کند.'
        : 'This path builds a stop plan; it stops nothing by itself.'),
      line('fbt-guardian', 'constraint', fa
        ? `توقف خودکارسازی‌ها${automations != null ? ` (${automations} مورد فعال)` : ''}، لغو تریگرهای پایش${monitors != null ? ` (${monitors} مورد)` : ''} و قفل اجرای خودکار تا تأیید بعدی.`
        : `Halt automations${automations != null ? ` (${automations} active)` : ''}, cancel monitoring triggers${monitors != null ? ` (${monitors})` : ''} and lock autonomous execution until you re-approve.`),
      line('fbt-execution', 'await', fa
        ? 'برای اجرای این پلن به تأیید صریح تو نیاز است؛ هیچ سفارش بازی بدون اجازه تو بسته نمی‌شود.'
        : 'Running this plan needs your explicit confirmation; no open order is closed without you.')
    ];
    result.notes.push(fa
      ? 'اضطرار اجرا نشد — فقط پلن آماده شده است. تأیید کن تا گام‌ها را پیش ببریم.'
      : 'Nothing was stopped — a plan is ready. Confirm to proceed with the steps.');
    result.chips = [
      { id: 'emergency-confirm', label: fa ? 'تأیید پلن توقف' : 'Confirm the stop plan', prompt: fa ? 'پلن توقف را تأیید می‌کنم' : 'I confirm the stop plan' },
      { id: 'emergency-cancel', label: fa ? 'فعلاً نه' : 'Not now', prompt: fa ? 'بی‌خیال' : 'cancel' }
    ];
    return result;
  }

  /* ── external agent: trusted identity, scoped consent and an attested
       runtime are all mandatory. Chat context is user-controlled, so no
       boolean, passport-shaped object, identity label, or pasted view can
       satisfy any of these gates. No trusted external transport is wired to
       this synchronous surface today; remain unavailable instead of guessing. */
  if (mode === NEGOTIATION_MODES.EXTERNAL_AGENT) {
    const runtimeStatus = createExternalAgentRuntime().status();
    result.externalGate = {
      identity: { ok: false, code: 'TRUSTED_EXTERNAL_IDENTITY_REQUIRED' },
      consent: { ok: false, code: 'EXPLICIT_PER_TASK_CONSENT_REQUIRED' },
      runtime: {
        ok: false,
        status: runtimeStatus.status,
        code: runtimeStatus.blocker || 'ATTESTED_RUNTIME_REQUIRED',
        attested: runtimeStatus.attested === true
      },
      contacted: false,
      agreementReached: false,
      executionAuthorized: false
    };
    result.outcome = NEGOTIATION_OUTCOMES.UNAVAILABLE;
    result.agreement = false;
    result.transcript = [
      line('fbt-ai', 'refuse', fa
        ? 'نظر ایجنت خارجی در دسترس نیست: هویت باید از ثبتِ مورداعتماد تأیید شود؛ پرچم یا متنِ همین پیام مدرک نیست.'
        : 'External-agent analysis is unavailable: identity must come from a trusted registry; a flag or text in this message is not evidence.'),
      line('fbt-guardian', 'constraint', fa
        ? 'رضایت صریح و محدود به همین کار لازم است؛ فعلاً مسیر گفت‌وگوی خارجی به runtime سالم و دارای attestation وصل نیست.'
        : 'Explicit consent scoped to this task is required; this chat is not connected to a healthy, attested external runtime.'),
      line('fbt-execution', 'await', fa
        ? 'هیچ پیام یا قراردادی تأیید نشد؛ تماس، توافق و اختیار اجرا همگی خاموش‌اند.'
        : 'No message or deal was confirmed; contact, agreement and execution authority all remain off.')
    ];
    result.notes.push(fa
      ? 'شناسه، رضایت یا runtime را نمی‌توان از context فرستاده‌شدهٔ کاربر نتیجه گرفت؛ تا اتصال واقعی همهٔ کنترل‌ها، این مسیر بسته می‌ماند.'
      : 'Identity, consent and runtime health cannot be inferred from caller-supplied context; this path stays blocked until real trusted gates are connected.');
    result.chips = [
      { id: 'external-setup', label: fa ? 'راهنمای ایجنت خارجی' : 'External-agent setup guide', prompt: fa ? 'راهنمای ایجنت خارجی را نشان بده' : 'show the external agent guide' }
    ];
    return result;
  }

  /* ── agent ↔ agent: the real council ─────────────────────────────────── */
  if (mode === NEGOTIATION_MODES.AGENT_AGENT) {
    if (!proposal) {
      result.outcome = NEGOTIATION_OUTCOMES.NEEDS_SUBJECT;
      result.question = fa ? 'دربارهٔ چه چیزی ایجنت‌ها مذاکره کنند؟ (دارایی، مبلغ و هدف را بگو)' : 'What should the agents negotiate about? (asset, amount, goal)';
      result.transcript = [
        line('fbt-council', 'await', fa
          ? 'شورا بدون موضوع مشخص تشکیل نمی‌شود — نمی‌خواهم چیزی از خودم بسازم.'
          : 'The council does not convene without a subject — I will not invent one.')
      ];
      result.chips = [
        { id: 'a2a-subject-risk', label: fa ? 'ریسک پرتفوی را مذاکره کن' : 'Negotiate portfolio risk', prompt: fa ? 'ایجنت‌ها دربارهٔ ریسک پرتفویم مذاکره کنند' : 'have the agents negotiate my portfolio risk' },
        { id: 'a2a-subject-goal', label: fa ? 'هدف مالی را مذاکره کن' : 'Negotiate my financial goal', prompt: fa ? 'ایجنت‌ها دربارهٔ هدف مالی من مذاکره کنند' : 'have the agents negotiate my financial goal' }
      ];
      return result;
    }
    const contextForCouncil = {
      ...context,
      riskDecision: context.riskDecision || null,
      guardianApproved: context.guardianApproved !== false,
      evidenceComplete: proposal.evidenceComplete !== false
    };
    const challenge = challengeStrategy(proposal, contextForCouncil);
    const council = runAgentCouncil({
      proposal,
      votes: context.votes || {},
      context: contextForCouncil,
      highValue: Number(proposal.amountUsd) >= 10_000,
      highRisk: ['HIGH', 'EXTREME', 'AGGRESSIVE'].includes(String(proposal.risk || '').toUpperCase())
    });
    const conflicts = detectPlanConflicts(Array.isArray(context.plans) ? context.plans : []);

    result.transcript = [
      line('fbt-strategy', 'proposal', fa
        ? `پیشنهاد: ${actionLabel(proposal.action)}${proposal.asset ? ` روی ${proposal.asset}` : ''}${proposal.amountUsd != null ? ` با ${money(proposal.amountUsd, locale)}` : ''}.`
        : `Proposal: ${proposal.action}${proposal.asset ? ` on ${proposal.asset}` : ''}${proposal.amountUsd != null ? ` with ${money(proposal.amountUsd, locale)}` : ''}.`),
      line('fbt-execution', challenge.challenged ? 'challenge' : 'agree', fa
        ? (challenge.challenged
          ? `چالش مستقل: ${challenge.disagreements.map((d) => CHALLENGE_FA[d.code] || d.code).join('، ')} — قبل از تأیید باید بازمحاسبه شود.`
          : 'چالش مستقلی پیدا نشد.')
        : (challenge.challenged
          ? `Independent challenge: ${challenge.disagreements.map((d) => d.code).join(', ')} — recalculate before authorization.`
          : 'No independent challenge was found.')),
      ...(council.ok ? council.votes.map((vote) => line(
        vote.role === 'guardian' ? 'fbt-guardian' : vote.role === 'execution' ? 'fbt-execution' : 'fbt-council',
        'vote',
        fa ? `رأی «${councilRoleLabel(vote.role)}»: ${decisionLabel(vote.decision)} — ${councilReasonFa(vote)}` : `Vote "${vote.role}": ${vote.decision} — ${vote.reason}`
      )) : []),
      line('fbt-council', 'decision', fa
        ? `تصمیم شورا: ${decisionLabel(council.decision)}. شورا اجازهٔ اجرا نمی‌دهد؛ بررسی ریسک، تأیید و امضای تو همچنان لازم است.`
        : `Council decision: ${council.decision}. Execution is not granted (canExecute=false) and needs your authorization.`)
    ];

    result.decision = council.decision;
    result.agreement = council.decision === 'APPROVE' && challenge.decision === 'APPROVE';
    result.conflicts = conflicts;
    result.outcome = council.decision === 'REJECT'
      ? NEGOTIATION_OUTCOMES.CONFLICT
      : council.decision === 'REVISE' || challenge.decision !== 'APPROVE'
        ? NEGOTIATION_OUTCOMES.ESCALATION
        : NEGOTIATION_OUTCOMES.AGREEMENT;
    if (conflicts.length) {
      result.transcript.push(line('fbt-council', 'conflict', fa
        ? `${conflicts.length} تضاد بین پلن‌ها پیدا شد؛ تا رفع نشود اجرا معنا ندارد.`
        : `${conflicts.length} plan conflict(s) found; execution is meaningless until they are resolved.`));
      result.notes.push(fa
        ? 'تضادها پنهان نشدند — تا وقتی رفع نشوند این مسیر پیش نمی‌رود. آپشن‌های اصلاح را از پایین انتخاب کن.'
        : 'The conflicts were not hidden — this path will not advance until they are resolved. Choose a repair option below.');
    }
    result.notes.push(fa ? 'این شورا بررسی قاعده‌محورِ نقش‌های داخلی است؛ ادعای تماس با مدل‌های زندهٔ مستقل نداریم.' : 'This council runs rule-based internal role checks; it does not claim calls to independent live models.');
    result.notes.push(fa
      ? 'مذاکره اجازه اجرا نمی‌دهد؛ هر اجرایی بعد از این، مسیر تأیید و امضای خودت را دارد.'
      : 'A negotiation grants no execution; anything that runs afterwards goes through your own confirmation and signature.');
    const roleSummary = council.votes.map((vote) => `${vote.role}: ${vote.decision}`).join('; ');
    const conflictSummary = conflicts.length
      ? `Detected ${conflicts.length} plan conflict(s): ${conflicts.slice(0, 4).map((item) => item.code || item.type || 'conflict').join(', ')}.`
      : 'No conflict was found in the supplied plan set.';
    const collaboration = attachCollaboration(result, {
      now,
      subject: subject || proposal.action,
      participants: [
        internalParticipant('execution', fa ? 'موتور اجرای FBT' : 'FBT execution engine'),
        internalParticipant('council', fa ? 'شورای قاعده‌محور FBT' : 'FBT rule-based council')
      ],
      tasks: [
        {
          id: 'proposal-challenge', title: 'Independent proposal challenge', assigneeId: 'fbt:execution', kind: 'internal-check',
          status: challenge.decision === 'APPROVE' ? 'COMPLETED' : 'BLOCKED', result: {
            text: challenge.disagreements.length
              ? challenge.disagreements.slice(0, 4).map((row) => `${row.code}: ${row.message}`).join(' | ')
              : 'No deterministic challenge was found.',
            source: 'internal-rule-check', dataStatus: challenge.decision, verified: false
          }, reason: challenge.decision === 'APPROVE' ? null : 'CHALLENGE_REQUIRES_REVISION'
        },
        {
          id: 'bounded-council', title: 'Bounded internal council', assigneeId: 'fbt:council', kind: 'internal-check',
          status: council.decision === 'APPROVE' ? 'COMPLETED' : 'BLOCKED', result: {
            text: `Internal deterministic roles only; ${roleSummary}. Aggregate decision: ${council.decision}.`,
            source: 'internal-rule-check', dataStatus: council.decision, verified: false
          }, reason: council.decision === 'APPROVE' ? null : 'COUNCIL_REQUIRES_REVISION'
        },
        {
          id: 'plan-conflicts', title: 'Plan conflict scan', assigneeId: 'fbt:council', kind: 'internal-check',
          status: conflicts.length ? 'BLOCKED' : 'COMPLETED', result: {
            text: conflictSummary, source: 'internal-rule-check', dataStatus: conflicts.length ? 'conflicts-found' : 'clear', verified: false
          }, reason: conflicts.length ? 'PLAN_CONFLICTS_FOUND' : null
        }
      ]
    });
    result.chips = collaborationActionChips(collaboration, locale);
    return result;
  }

  /* ── human ↔ human: a terms sheet and two confirmations ──────────────── */
  if (mode === NEGOTIATION_MODES.HUMAN_HUMAN) {
    if (!proposal) {
      result.outcome = NEGOTIATION_OUTCOMES.NEEDS_SUBJECT;
      result.question = fa
        ? 'موضوع توافق چیست؟ (با چه کسی، روی چه چیزی، چه مقدار و تا چه زمانی)'
        : 'What is the agreement about? (with whom, on what, how much, by when)';
      result.transcript = [
        line('fbt-ai', 'await', fa
          ? 'برگه شرایط بدون موضوع و مهلت ساخته نمی‌شود — این‌ها را از خودم درنمی‌آورم.'
          : 'A terms sheet is not built without a subject and a deadline — I will not invent them.')
      ];
      return result;
    }
    const deadlineDays = Number(context.deadlineDays);
    const party = context.counterparty?.label || context.counterparty?.id || null;
    const rows = [
      { key: 'parties', value: fa
        ? `تو${party ? ` و «${party}»` : ' و طرف مقابل'}`
        : `you${party ? ` and "${party}"` : ' and the counterparty'}` },
      { key: 'subject', value: `${fa ? actionLabel(proposal.action) : proposal.action}${proposal.asset ? ` · ${proposal.asset}` : ''}${proposal.amountUsd != null ? ` · ${money(proposal.amountUsd, locale)}` : ''}` },
      { key: 'custody', value: fa ? 'FBT دارایی نگه نمی‌دارد؛ کلید و امضا فقط دست صاحبان است.' : 'FBT takes no custody; keys and signatures stay with the owners.' },
      { key: 'escrow', value: fa
        ? `اگر کار از طریق ایجنت پرداخت شود: وجه در escrow می‌ماند (سقف ${MAX_ESCROW_USD.toLocaleString('en-US')} دلار) و فقط با تحویل تأییدشده آزاد می‌شود.`
        : `If agent work is paid: funds sit in escrow (cap $${MAX_ESCROW_USD.toLocaleString('en-US')}) and release only on confirmed delivery.` },
      { key: 'dispute', value: fa
        ? `هر اعتراضی تا ${Math.round(APPEAL_WINDOW_MS / 86400000)} روز قابل ثبت است.`
        : `Any appeal can be filed within ${Math.round(APPEAL_WINDOW_MS / 86400000)} days.` },
      { key: 'deadline', value: Number.isFinite(deadlineDays) && deadlineDays > 0
        ? (fa ? `${deadlineDays} روز` : `${deadlineDays} days`)
        : (fa ? 'تعیین نشده — باید توافق شود' : 'not set — must be agreed') }
    ];
    if (context.additionalTerm) rows.push({ key: 'additional', value: String(context.additionalTerm).slice(0, 400) });
    result.terms = rows;
    result.transcript = [
      line('fbt-ai', 'terms', fa
        ? `برگه شرایط ساخته شد (${rows.length} بند). هنوز هیچ‌چیز امضا نشده و هیچ پیامی برای طرف مقابل فرستاده نشده.`
        : `Terms sheet built (${rows.length} clauses). Nothing is signed and no message was sent to the counterparty.`),
      ...rows.map((row) => line('fbt-council', 'term', `${fa ? termLabel(row.key) : row.key}: ${row.value}`)),
      line('fbt-guardian', 'constraint', fa
        ? 'این توافق فقط با تأیید صریح دو طرف قابل اجراست؛ یک تأیید کافی نیست.'
        : 'This agreement only runs with the explicit confirmation of both sides; one confirmation is not enough.')
    ];
    result.outcome = NEGOTIATION_OUTCOMES.AWAITING_COUNTERPARTY;
    result.notes.push(fa
      ? 'من نه پیامی از طرف تو فرستادم و نه جای کسی را تأیید کردم. تأیید طرف مقابل باید جداگانه راستی‌آزمایی شود؛ این برگه خودش اجرای مالی نمی‌کند.'
      : 'I neither sent a message on your behalf nor confirmed for anybody else. Counterparty confirmation must be separately verified; this sheet cannot execute a financial action.');
    const collaboration = attachCollaboration(result, {
      now,
      subject: rows.find((row) => row.key === 'subject')?.value || subject,
      participants: [
        { id: 'human:counterparty', kind: 'counterparty', label: party || (fa ? 'طرف مقابل' : 'Counterparty') },
        internalParticipant('terms', fa ? 'دستیار تدوین شرایط FBT' : 'FBT terms assistant')
      ],
      tasks: [
        {
          id: 'terms-draft', title: 'Prepare terms draft', assigneeId: 'fbt:terms', kind: 'draft', status: 'COMPLETED',
          result: { text: rows.map((row) => `${row.key}: ${row.value}`).join(' | '), source: 'local-terms-draft', dataStatus: 'draft', verified: false }
        },
        {
          id: 'counterparty-review', title: 'Counterparty review', assigneeId: 'human:counterparty', kind: 'counterparty-review',
          status: 'AWAITING_PARTICIPANT'
        }
      ]
    });
    result.chips = [
      ...collaborationActionChips(collaboration, locale),
      { id: 'h2h-edit', label: fa ? 'بندها را اصلاح کن' : 'Edit the clauses', prompt: fa ? 'بندهای برگه شرایط را اصلاح کن' : 'edit the clauses of the terms sheet' }
    ];
    return result;
  }

  /* ── human ↔ agent: real options under the real caps ─────────────────── */
  const options = optionSet(context, locale);
  if (!proposal && !options.length) {
    result.outcome = NEGOTIATION_OUTCOMES.NEEDS_SUBJECT;
    result.question = fa ? 'دربارهٔ چه چیزی با ایجنت مذاکره کنم؟' : 'What should I negotiate with the agent about?';
    return result;
  }
  result.outcome = NEGOTIATION_OUTCOMES.AWAITING_USER;
  result.options = options;
  result.question = fa ? 'کدام سطح ریسک را برای پلن انتخاب می‌کنی؟' : 'Which risk band should the plan use?';
  result.transcript = [
    line('fbt-ai', 'offer', fa
      ? `سه گزینه روی میز است؛ همه با سقف‌های واقعی همین سیستم ساخته شده‌اند${proposal ? ` و موضوع «${subject || proposal.action}»` : ''}.`
      : `Three options are on the table, all constrained by this system's real caps${proposal ? ` for "${subject || proposal.action}"` : ''}.`),

    line('fbt-guardian', 'constraint', fa
      ? `سقف سخت: هر تراکنش حداکثر ${DEFAULT_POLICY_CAPS.maxTransactionUsd.toLocaleString('en-US')} دلار، اهرم حداکثر ${DEFAULT_POLICY_CAPS.maxLeverage}× — انتخاب نهایی با توست.`
      : `Hard caps: max $${DEFAULT_POLICY_CAPS.maxTransactionUsd.toLocaleString('en-US')} per trade, leverage ≤ ${DEFAULT_POLICY_CAPS.maxLeverage}× — the final choice is yours.`)
  ];
  result.notes.push(fa
    ? 'هیچ‌کدام از این گزینه‌ها اجرا نشده است؛ با انتخاب تو، فقط پلن پیشنهادی ساخته می‌شود.'
    : 'None of these options ran; your choice only builds a proposed plan.');
  attachCollaboration(result, {
    now,
    subject: subject || proposal?.action || 'risk choice',
    participants: [internalParticipant('strategy', fa ? 'موتور استراتژی FBT' : 'FBT strategy engine')],
    tasks: [
      {
        id: 'risk-options', title: 'Generate bounded risk options', assigneeId: 'fbt:strategy', kind: 'internal-options', status: 'COMPLETED',
        result: { text: options.map((option) => `${option.id}: ${option.label}`).join(' | '), source: 'local-strategy-rules', dataStatus: 'options', verified: false }
      },
      { id: 'risk-choice', title: 'Choose a risk band', assigneeId: COLLABORATION_LOCAL_USER_ID, kind: 'user-choice', status: 'AWAITING_USER' }
    ]
  });
  result.chips = options.map((o) => ({ id: `pick_${o.id}`, label: o.label, prompt: o.label, action: 'SELECT_RISK', value: o.riskProfile || o.id }));
  return result;
}

/* -------------------------------------------------------------------------- */
/*  RENDER                                                                     */
/* -------------------------------------------------------------------------- */

const ROLE_FA = { research: 'پژوهش', strategy: 'استراتژی', risk: 'ریسک', liquidity: 'نقدینگی', market: 'بازار', fee: 'کارمزد', portfolio: 'پرتفوی', hedge: 'پوشش ریسک', guardian: 'نگهبان', execution: 'اجرا', exit: 'خروج', auditor: 'حسابرسی' };
const DECISION_FA = { APPROVE: 'قابل بررسی', REVISE: 'نیازمند بازبینی', REJECT: 'رد شده' };
const TERM_FA = { parties: 'طرفین', subject: 'موضوع', custody: 'نگهداری دارایی', escrow: 'سپرده امانی', dispute: 'اعتراض', deadline: 'مهلت', additional: 'بند پیشنهادی جدید' };
const ACTION_FA = { rebalance: 'متعادل‌سازی', review: 'بازبینی', 'risk-review': 'بازبینی ریسک', agreement: 'توافق', swap: 'سواپ', buy: 'خرید', sell: 'فروش', bridge: 'بریج' };
const councilRoleLabel = (role) => ROLE_FA[role] || role;
const decisionLabel = (decision) => DECISION_FA[decision] || decision;
const termLabel = (term) => TERM_FA[term] || term;
const actionLabel = (action) => ACTION_FA[String(action).toLowerCase()] || action;
const CHALLENGE_FA = { EVIDENCE_INCOMPLETE: 'داده کافی نیست', LIQUIDITY_INSUFFICIENT: 'نقدینگی کافی نیست', SLIPPAGE_ABOVE_POLICY: 'لغزش از سقف بیشتر است', LEVERAGE_ABOVE_POLICY: 'اهرم از سقف بیشتر است', REQUIRED_CAPABILITY_UNAVAILABLE: 'ابزار لازم در دسترس نیست', EVENT_RISK_HIGH: 'ریسک رویداد بالاست', COST_INCOMPLETE: 'هزینه کامل خوانده نشده', DRAWDOWN_ABOVE_BUDGET: 'افت برآوردی بیش از بودجه است', QUOTE_STALE: 'نرخ تازه نیست' };
function councilReasonFa(vote) {
  if (vote.evidence?.length) return vote.evidence.map((code) => CHALLENGE_FA[code] || 'نیاز به بررسی مستقل').join('، ');
  if (vote.decision === 'REJECT') return 'محدودیت ایمنی مانع است';
  return vote.decision === 'REVISE' ? 'پیشنهاد باید با دادهٔ معتبر بازبینی شود' : 'در بررسی‌های موجود مانعی پیدا نشد؛ این رأی تضمین سود نیست';
}

const SPEAKER_LABELS = Object.freeze({
  user: { fa: 'کاربر', en: 'You' },
  'fbt-ai': { fa: 'هوش مصنوعی FBT', en: 'FBT AI' },
  'fbt-strategy': { fa: 'موتور استراتژی FBT', en: 'FBT strategy engine' },
  'fbt-execution': { fa: 'موتور اجرای FBT', en: 'FBT execution engine' },
  'fbt-guardian': { fa: 'نگهبان FBT', en: 'FBT guardian' },
  'fbt-council': { fa: 'شورای ایجنت‌ها', en: 'Agent council' },
  'external-agent': { fa: 'ایجنت خارجی', en: 'External agent' }
});

export function speakerLabel(from, locale = 'fa') {
  const entry = SPEAKER_LABELS[from];
  if (!entry) return String(from || '—');
  return isFa(locale) ? entry.fa : entry.en;
}

const OUTCOME_TONE = Object.freeze({
  AGREEMENT: 'ok',
  CONFLICT: 'bad',
  ESCALATION: 'warn',
  AWAITING_USER: 'info',
  AWAITING_COUNTERPARTY: 'warn',
  NEEDS_SUBJECT: 'info',
  UNAVAILABLE: 'bad'
});

const OUTCOME_LABEL = Object.freeze({
  AGREEMENT: { fa: 'توافق', en: 'Agreement', ar: 'اتفاق' },
  CONFLICT: { fa: 'تضاد', en: 'Conflict', ar: 'تعارض' },
  ESCALATION: { fa: 'اضطرار / بازمحاسبه', en: 'Escalation / recalculate', ar: 'تصعيد' },
  AWAITING_USER: { fa: 'منتظر انتخاب تو', en: 'Waiting for your choice', ar: 'بانتظار اختيارك' },
  AWAITING_COUNTERPARTY: { fa: 'منتظر تأیید دو طرف', en: 'Waiting for both sides', ar: 'بانتظار الطرفين' },
  NEEDS_SUBJECT: { fa: 'نیاز به موضوع مشخص', en: 'Needs a subject', ar: 'يحتاج موضوعاً' },
  UNAVAILABLE: { fa: 'در دسترس نیست', en: 'Unavailable', ar: 'غير متاح' }
});

const MODE_LABEL = Object.freeze({
  'human-human': { fa: 'انسان ↔ انسان', en: 'Human ↔ Human' },
  'human-agent': { fa: 'انسان ↔ ایجنت', en: 'Human ↔ Agent' },
  'agent-agent': { fa: 'ایجنت ↔ ایجنت', en: 'Agent ↔ Agent' },
  'fbt-external-agent': { fa: 'هوش FBT ↔ ایجنت خارجی', en: 'FBT AI ↔ External agent' },
  emergency: { fa: 'اضطرار', en: 'Emergency' }
});

export function renderNegotiationLines(result, locale = 'fa') {
  const fa = isFa(locale);
  const lines = [];
  for (const row of result?.transcript || []) {
    lines.push(`${speakerLabel(row.from, locale)}: ${row.text}`);
  }
  if (result?.question) lines.push(fa ? `❓ ${result.question}` : `❓ ${result.question}`);
  for (const note of result?.notes || []) lines.push(`• ${note}`);
  return lines;
}

export function negotiationToChatMessage(result, { locale = 'fa' } = {}) {
  const fa = isFa(locale);
  const kindMap = {
    AGREEMENT: 'AGREEMENT',
    CONFLICT: 'CONFLICT',
    ESCALATION: result?.mode === 'emergency' ? 'EMERGENCY' : 'ESCALATION',
    AWAITING_USER: 'NEGOTIATION',
    AWAITING_COUNTERPARTY: 'NEGOTIATION',
    NEEDS_SUBJECT: 'NEGOTIATION',
    UNAVAILABLE: 'NEGOTIATION'
  };
  const outcome = result?.outcome || 'NEGOTIATION';
  const modeLabel = MODE_LABEL[result?.mode]?.[fa ? 'fa' : 'en'] || result?.mode || '';
  const outcomeLabel = OUTCOME_LABEL[outcome]?.[fa ? 'fa' : 'en'] || outcome;
  const title = fa
    ? `${modeLabel} — ${outcomeLabel}`
    : `${modeLabel} — ${outcomeLabel}`;
  const id = `neg_${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`}`;
  return {
    id,
    role: 'ai',
    kind: 'os',
    content: [title, ...renderNegotiationLines(result, locale)].join('\n'),
    ui: { type: 'TEXT' },
    osEvent: {
      id,
      schema: NEGOTIATION_CHAT_SCHEMA,
      kind: kindMap[outcome] || 'NEGOTIATION',
      title,
      badge: outcomeLabel,
      tone: OUTCOME_TONE[outcome] || null,
      lines: renderNegotiationLines(result, locale),
      chips: result?.chips || [],
      payload: {
        mode: result?.mode || null,
        subject: result?.subject || null,
        proposal: result?.proposal || null,
        goal: result?.goal || null,
        intent: result?.intent || null,
        outcome,
        decision: result?.decision || null,
        conflicts: result?.conflicts || [],
        terms: result?.terms || null,
        options: result?.options || null,
        collaboration: result?.collaboration || null,
        collaborationStep: result?.collaborationStep || null,
        externalGate: result?.externalGate || null,
        requiresUserAuthorization: true,
        executed: false,
        laws: NEGOTIATION_LAWS
      },
      at: Number(result?.at || Date.now())
    },
    actions: []
  };
}

/** The council/negotiation is askable and answerable through the ledger: this
 *  is the question object the chat should register when a negotiation needs a
 *  subject or a choice. */
export function negotiationQuestion(result, locale = 'fa') {
  if (!result?.question) return null;
  const fa = isFa(locale);
  return {
    text: result.question,
    slot: result.outcome === NEGOTIATION_OUTCOMES.AWAITING_USER ? 'choice' : 'text',
    expectedType: result.outcome === NEGOTIATION_OUTCOMES.AWAITING_USER ? 'choice' : 'text',
    options: (result.chips || []).map((c) => ({ id: c.id, label: c.label })),
    locale: fa ? 'fa' : 'en',
    source: 'negotiation'
  };
}

export const NEGOTIATION_CHAT_INFO = Object.freeze({
  schema: NEGOTIATION_CHAT_SCHEMA,
  modes: Object.values(NEGOTIATION_MODES),
  roles: COUNCIL_ROLES,
  outcomes: Object.values(NEGOTIATION_OUTCOMES)
});
