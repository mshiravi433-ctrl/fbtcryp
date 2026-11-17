/**
 * FBT INTENT OS — PHASE 213: THE SURFACE, RENDERED IN CHAT
 * ---------------------------------------------------------------------------
 * Two presentational pieces, and no logic worth testing in a browser:
 *
 *   OsEventCard      — an Intent OS event that happened outside the chat
 *                      (execution, monitor, agent, negotiation, agreement,
 *                      conflict, escalation) shown as a real bubble with its
 *                      transcript, its badge and its next-step chips.
 *   PendingQuestionBar — the visible form of the open question ledger: the
 *                      question stays in front of the user until it is answered
 *                      or explicitly dropped, so "the AI forgot my question"
 *                      cannot happen silently.
 *
 * Multi-Slot (پاسخ به هوش مصنوعی intent os):
 *   When a multi-step goal form is active (e.g. collecting capital → profit →
 *   horizon → risk for an investment plan), the bar shows a DEDICATED answer
 *   box with the current slot label, placeholder, a progress indicator, a
 *   summary of already-collected slots, and a submit button. This keeps the
 *   user from typing into the generic composer and having the answer eaten
 *   by the normal message pipeline.
 */
import { memo, useState, useEffect, useRef } from 'react';

const TONE_CLASS = {
  ok: 'iaos-os-ok',
  warn: 'iaos-os-warn',
  bad: 'iaos-os-bad',
  info: 'iaos-os-info'
};

/** «کاربر: …» → speaker in bold, the sentence in the body. */
function renderLine(line, index) {
  const text = String(line ?? '');
  const m = text.match(/^([^:：]{2,40})[:：]\s*(.+)$/);
  if (!m) return <div key={index} className="iaos-os-line">{text}</div>;
  return (
    <div key={index} className="iaos-os-line">
      <b className="iaos-os-speaker">{m[1]}</b>
      <span>{m[2]}</span>
    </div>
  );
}

const COLLAB_STATUS_EN = {
  AWAITING_REVIEW: 'Awaiting review', IN_PROGRESS: 'In progress', PLAN_REQUESTED: 'Plan requested', CONSENT_RECORDED: 'Planning consent recorded',
  AWAITING_CONSENT: 'Awaiting consent', AWAITING_COUNTERPARTY: 'Awaiting counterparty',
  PARTIAL_REVIEW: 'Partial review', REVISION_REQUIRED: 'Revision required', REJECTED: 'Rejected',
  OFFERED: 'Offered', AWAITING_USER: 'Awaiting your input', AWAITING_USER_SEND: 'Awaiting your send',
  AWAITING_PROVIDER: 'Awaiting provider', AWAITING_INPUT: 'Needs input', AWAITING_PARTICIPANT: 'Awaiting participant',
  COMPLETED: 'Completed', REPORTED_UNVERIFIED: 'Reported — unverified', BLOCKED: 'Blocked', UNAVAILABLE: 'Unavailable',
  PENDING: 'Pending', REVIEWED: 'Reviewed', NEEDS_REVISION: 'Needs revision',
  NOT_RECORDED: 'Not recorded', RECORDED_LOCAL: 'Planning only', LOCAL_ACCEPTANCE_ONLY: 'Local acceptance only',
  NOT_VERIFIED: 'Not verified', NOT_REQUIRED: 'Not required'
};
const COLLAB_STATUS_FA = {
  AWAITING_REVIEW: 'در انتظار بازبینی', IN_PROGRESS: 'در حال انجام', PLAN_REQUESTED: 'درخواست پلن ثبت شد', CONSENT_RECORDED: 'رضایت برنامه‌ریزی ثبت شد',
  AWAITING_CONSENT: 'در انتظار رضایت', AWAITING_COUNTERPARTY: 'در انتظار طرف مقابل',
  PARTIAL_REVIEW: 'بازبینی ناقص', REVISION_REQUIRED: 'نیاز به اصلاح', REJECTED: 'ردشده',
  OFFERED: 'پیشنهادشده', AWAITING_USER: 'در انتظار پاسخ تو', AWAITING_USER_SEND: 'در انتظار ارسال تو',
  AWAITING_PROVIDER: 'در انتظار ارائه‌دهنده', AWAITING_INPUT: 'نیازمند ورودی', AWAITING_PARTICIPANT: 'در انتظار شرکت‌کننده',
  COMPLETED: 'تکمیل‌شده', REPORTED_UNVERIFIED: 'گزارش‌شده — تأییدنشده', BLOCKED: 'مسدود', UNAVAILABLE: 'در دسترس نیست',
  PENDING: 'در انتظار', REVIEWED: 'بازبینی‌شده', NEEDS_REVISION: 'نیاز به اصلاح',
  NOT_RECORDED: 'ثبت‌نشده', RECORDED_LOCAL: 'فقط برنامه‌ریزی', LOCAL_ACCEPTANCE_ONLY: 'پذیرش محلیِ سمت تو',
  NOT_VERIFIED: 'تأییدنشده', NOT_REQUIRED: 'لازم نیست'
};
const collabStatus = (value, fa) => (fa ? COLLAB_STATUS_FA : COLLAB_STATUS_EN)[String(value || '')] || String(value || '—').slice(0, 40);
const short = (value, max = 240) => String(value ?? '').slice(0, max);

function CollaborationPanel({ session, externalGate, fa }) {
  const participants = Array.isArray(session?.participants) ? session.participants.slice(0, 8) : [];
  const tasks = Array.isArray(session?.tasks) ? session.tasks.slice(0, 8) : [];
  const labels = fa ? {
    title: 'گردش همکاری', participants: 'شرکت‌کنندگان', tasks: 'وظایف و نتایج', review: 'بازبینی',
    localConsent: 'رضایت تو', counterparty: 'طرف مقابل', execution: 'اجرا', noExecution: 'هیچ اجرا یا تماس خارجی مجاز نیست.',
    identity: 'هویت', consent: 'رضایت کاربر', runtime: 'runtime دارای attestation',
    local: 'محلی', unverified: 'تأییدنشده', verified: 'ثبتِ سروری/مورد اعتماد', source: 'منبع'
  } : {
    title: 'Collaboration workflow', participants: 'Participants', tasks: 'Assignments and results', review: 'Review',
    localConsent: 'Your consent', counterparty: 'Counterparty', execution: 'Execution', noExecution: 'No execution or external contact is authorized.',
    identity: 'Identity', consent: 'User consent', runtime: 'Attested runtime',
    local: 'Local', unverified: 'Unverified', verified: 'Server-receipted', source: 'Source'
  };
  if (!session && !externalGate) return null;
  return (
    <section className="iaos-os-collaboration" data-testid="intent-os-collaboration" aria-label={labels.title}>
      {session ? (
        <>
          <div className="iaos-os-collab-head">
            <b>{labels.title}</b>
            <span data-testid="intent-os-collaboration-state">{collabStatus(session.state, fa)}</span>
          </div>
          <div className="iaos-os-collab-group">
            <b>{labels.participants}</b>
            <ul className="iaos-os-collab-people">
              {participants.map((person) => (
                <li key={person.id} data-identity-status={person.identityStatus || 'unverified'}>
                  <strong>{short(person.label || person.id, 80)}</strong>
                  <span>{short(person.kind, 32)}</span>
                  {person.kind === 'counterparty' || person.kind === 'external-agent'
                    ? <small>{labels.unverified}</small>
                    : null}
                </li>
              ))}
            </ul>
          </div>
          <div className="iaos-os-collab-group">
            <b>{labels.tasks}</b>
            <ul className="iaos-os-collab-tasks">
              {tasks.map((task) => {
                const assignee = participants.find((person) => person.id === task.assigneeId);
                return (
                  <li key={task.id} data-task-status={task.status}>
                    <div className="iaos-os-collab-task-head">
                      <strong>{short(task.title || task.id, 120)}</strong>
                      <span>{collabStatus(task.status, fa)}</span>
                    </div>
                    <small>{short(assignee?.label || task.assigneeId, 80)}</small>
                    {task.result?.text ? <p>{short(task.result.text, 360)}</p> : null}
                    {task.result ? (
                      <small>{labels.source}: {short(task.result.source || labels.local, 48)} · {task.result.verified === true ? labels.verified : labels.unverified}</small>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
          <dl className="iaos-os-collab-gates">
            <div><dt>{labels.review}</dt><dd>{collabStatus(session.review?.status, fa)}</dd></div>
            <div><dt>{labels.localConsent}</dt><dd>{collabStatus(session.consent?.local?.status, fa)}</dd></div>
            <div><dt>{labels.counterparty}</dt><dd>{collabStatus(session.consent?.counterparty?.status, fa)}</dd></div>
            <div><dt>{labels.execution}</dt><dd>{session.executionAuthorized === true ? (fa ? 'فعال' : 'Authorized') : (fa ? 'غیرفعال' : 'Not authorized')}</dd></div>
          </dl>
          <p className="iaos-os-collab-boundary">{labels.noExecution}</p>
        </>
      ) : null}
      {externalGate ? (
        <div className="iaos-os-collab-external" data-testid="intent-os-external-gate">
          <b>{fa ? 'دروازهٔ ایجنت خارجی' : 'External-agent gates'}</b>
          {[['identity', externalGate.identity], ['consent', externalGate.consent], ['runtime', externalGate.runtime]].map(([key, gate]) => (
            <div key={key} data-gate-status={gate?.ok === true ? 'passed' : 'blocked'}>
              <span>{labels[key]}: {gate?.ok === true ? (fa ? 'تأیید شد' : 'Passed') : (fa ? 'مسدود' : 'Blocked')}</span>
              <small>{short(gate?.code || gate?.status || 'NOT_VERIFIED', 64)}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export const OsEventCard = memo(function OsEventCard({ event, locale = 'fa', onChip, onOpenRoute, busy = false }) {
  if (!event) return null;
  const fa = String(locale || 'fa').startsWith('fa');
  const tone = TONE_CLASS[event.tone] || '';
  const lines = Array.isArray(event.lines) ? event.lines : [];
  const chips = Array.isArray(event.chips) ? event.chips : [];
  const payload = event.payload || {};
  const kindFa = { CATALOG: 'امکانات', NEGOTIATION: 'مذاکره', AGREEMENT: 'توافق', CONFLICT: 'تضاد', ESCALATION: 'بازبینی', EMERGENCY: 'اضطرار', AGENT: 'ایجنت', MONITOR: 'پایش', ORDER: 'سفارش', EXECUTION: 'اجرا', WALLET: 'کیف پول', MEMORY: 'حافظه', SEARCH: 'جستجو', QUESTION: 'پرسش', NOTICE: 'اطلاع' };
  const options = Array.isArray(payload.options) ? payload.options : [];
  return (
    <div className={`iaos-os-card ${tone}`} data-testid="intent-os-card" data-kind={event.kind || 'NOTICE'}>
      {event.title ? (
        <div className="iaos-os-head">
          <span className="iaos-os-kind">{fa ? kindFa[event.kind] || 'اطلاع' : String(event.kind || '').toLowerCase()}</span>
          <b>{event.title}</b>
          {event.badge ? <span className="iaos-os-badge">{event.badge}</span> : null}
        </div>
      ) : event.badge ? (
        <div className="iaos-os-head"><span className="iaos-os-badge">{event.badge}</span></div>
      ) : null}
      {lines.length ? <div className="iaos-os-lines">{lines.map(renderLine)}</div> : null}
      {(payload?.collaboration || payload?.externalGate) ? (
        <CollaborationPanel session={payload.collaboration || null} externalGate={payload.externalGate || null} fa={fa} />
      ) : null}
      {payload?.outcome === 'CONFLICT' && payload?.conflicts?.length ? (
        <div className="iaos-os-note iaos-os-bad-note">
          {fa ? `تضادهای پیدا‌شده: ${payload.conflicts.length}` : `Conflicts found: ${payload.conflicts.length}`}
        </div>
      ) : null}
      {chips.length ? (
        <div className="iaos-os-chips">
          {chips.map((chip) => (
            <button
              key={chip.id || chip.label}
              type="button"
              className="iaos-btn iss-ghost iaos-os-chip"
              data-testid="intent-os-chip"
              data-chip-id={chip.id}
              data-selected={payload.selectedChipId === chip.id ? 'true' : 'false'}
              disabled={busy || payload.resolved === true || (!onChip && !(onOpenRoute && chip.route))}
              onClick={() => chip.route && onOpenRoute ? onOpenRoute(chip.route) : onChip?.(chip, event)}
            >
              <span>{chip.label}</span>
              {options.find((o) => `pick_${o.id}` === chip.id)?.tradeoff ? (
                <small>{options.find((o) => `pick_${o.id}` === chip.id).tradeoff}</small>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {payload?.executed === false || payload?.requiresUserAuthorization === true ? (
        <div className="iaos-os-note">
          {fa
            ? 'هیچ‌چیز اجرا نشد — هر اجرای مالی به تأیید و امضای خودت می‌رسد.'
            : 'Nothing was executed — every financial action still needs your confirmation and signature.'}
        </div>
      ) : null}
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/*  MULTI-SLOT ANSWER BOX (باکس اختصاصی جواب)                                */
/* -------------------------------------------------------------------------- */

/**
 * باکس اختصاصی پاسخ برای فرم‌های چند‌مرحله‌ای. وقتی فعال است، کاربر دقیقاً
 * می‌بیند به کدام سوال پاسخ می‌دهد، چه اطلاعاتی قب ثبت شده، و پاسخش در
 * همین باکس نوشته و ارسال می‌شود — نه در کامپوزر عمومی که ممکن است
 * سیستم را گیج کند.
 */
export const MultiSlotAnswerBox = memo(function MultiSlotAnswerBox({
  slot,
  ack,
  locale = 'fa',
  onSubmit,
  onCancel,
  parseError = null
}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    // وقتی اسلات عوض شد باکس را خالی کن و فوکوس کن
    setValue('');
    try { inputRef.current?.focus?.(); } catch {}
  }, [slot?.slotIndex, slot?.key]);

  if (!slot) return null;

  const submit = (e) => {
    e?.preventDefault?.();
    const v = value.trim();
    if (!v) return;
    onSubmit?.(v);
    setValue('');
  };

  const chooseOption = (opt) => {
    onSubmit?.(opt.id);
  };

  const progress = slot.totalSlots > 0
    ? Math.round(((slot.collectedCount) / slot.totalSlots) * 100)
    : 0;

  return (
    <div className="iaos-multislot" data-testid="intent-ai-multislot-form" role="form" aria-label={slot.title}>
      {/* خط تأیید (ack) after previous answer */}
      {ack ? (
        <div className="iaos-multislot-ack" role="status">
          <span className="iaos-multislot-check">✓</span>
          <span>{ack}</span>
        </div>
      ) : null}

      {parseError ? (
        <div className="iaos-multislot-error" role="alert">
          <span>⚠</span>
          <span>{parseError}</span>
        </div>
      ) : null}

      {/* هدر فرم: عنوان + پیشرفت */}
      <div className="iaos-multislot-head">
        <span className="iaos-multislot-badge">✦ {slot.title}</span>
        <span className="iaos-multislot-progress-text">
          {slot.collectedCount + 1} / {slot.totalSlots}
        </span>
      </div>
      <div className="iaos-multislot-progress" aria-hidden="true">
        <div className="iaos-multislot-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* خلاصه‌ی فیلدهایی که قبلاً پر شده */}
      {Array.isArray(slot.collectedLabels) && slot.collectedLabels.length ? (
        <div className="iaos-multislot-collected">
          {slot.collectedLabels.map((c) => (
            <span key={c.key} className="iaos-multislot-chip">
              {c.label}: <b>{c.value}</b>
            </span>
          ))}
        </div>
      ) : null}

      {/* سوال فعلی */}
      <label className="iaos-multislot-question" htmlFor={`mslot-${slot.key}`}>
        <span className="iaos-multislot-qnum">{fa ? 'سؤال' : 'Q'} {slot.slotIndex + 1}:</span>
        {' '}
        {slot.questionText}
      </label>

      {/* گزینه‌های انتخاب (برای choice) */}
      {slot.expectedType === 'choice' && Array.isArray(slot.options) && slot.options.length ? (
        <div className="iaos-multislot-options">
          {slot.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="iaos-btn iss-ghost iaos-multislot-option"
              onClick={() => chooseOption(opt)}
            >
              {fa ? opt.labelFa : opt.labelEn}
            </button>
          ))}
          <button
            type="button"
            className="iaos-multislot-cancel"
            onClick={onCancel}
            aria-label={fa ? 'انصراف' : 'cancel'}
          >
            {fa ? 'انصراف' : 'Cancel'}
          </button>
        </div>
      ) : (
        <form className="iaos-multislot-form" onSubmit={submit}>
          <input
            id={`mslot-${slot.key}`}
            ref={inputRef}
            type="text"
            inputMode={slot.expectedType === 'amount' || slot.expectedType === 'percent' ? 'decimal' : 'text'}
            className="iaos-multislot-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={slot.placeholder || ''}
            aria-label={slot.questionText}
            autoComplete="off"
            autoFocus
          />
          <button
            type="submit"
            className="iaos-multislot-submit"
            disabled={!value.trim()}
            aria-label={fa ? 'ارسال پاسخ' : 'Send answer'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5" />
              <path d="m5 12 7-7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            className="iaos-multislot-cancel"
            onClick={onCancel}
            aria-label={fa ? 'انصراف' : 'cancel'}
            title={fa ? 'انصراف از این فرم' : 'Cancel this form'}
          >
            {fa ? 'انصراف' : 'Cancel'}
          </button>
        </form>
      )}
    </div>
  );
});

/**
 * The bar above the composer for a SINGLE open question (legacy, from
 * questionLedger). It exists because a question the assistant asked must stay
 * visible until it is answered — including across reloads.
 *
 * When a multi-slot form is active this bar is NOT rendered; the
 * MultiSlotAnswerBox takes over the answer surface entirely.
 */
export const PendingQuestionBar = memo(function PendingQuestionBar({
  question,
  ack,
  multiSlot,
  locale = 'fa',
  onAnswer,
  onSkip,
  onDismiss,
  onMultiSlotSubmit,
  onMultiSlotCancel,
  multiSlotParseError
}) {
  const fa = String(locale || 'fa').startsWith('fa');

  // Multi-slot form takes priority
  if (multiSlot?.slot) {
    return (
      <MultiSlotAnswerBox
        slot={multiSlot.slot}
        ack={multiSlot.ack}
        locale={locale}
        onSubmit={onMultiSlotSubmit}
        onCancel={onMultiSlotCancel}
        parseError={multiSlotParseError}
      />
    );
  }

  if (!question && !ack) return null;
  if (!question && ack) {
    return (
      <div className="iaos-qbar iaos-qbar-ack" data-testid="intent-ai-question-ack" role="status">
        <span>{ack}</span>
      </div>
    );
  }
  return (
    <div className="iaos-qbar" data-testid="intent-ai-open-question" role="status">
      <span className="iaos-qbar-label">{fa ? 'منتظر جواب تو هستم' : 'Waiting for your answer'}</span>
      <span className="iaos-qbar-text">{question.text}</span>
      <div className="iaos-qbar-actions">
        {Array.isArray(question.options) && question.options.slice(0, 3).map((option) => (
          <button key={option.id} type="button" className="iaos-btn iss-ghost" onClick={() => onAnswer(option.label)}>
            {option.label}
          </button>
        ))}
        {question.expectedType === 'confirmation' || question.expectedType === 'yes-no' ? (
          <>
            <button type="button" className="iaos-btn iss-ghost" onClick={() => onAnswer(fa ? 'بله' : 'yes')}>{fa ? 'بله' : 'Yes'}</button>
            <button type="button" className="iaos-btn iss-ghost" onClick={() => onAnswer(fa ? 'نه' : 'no')}>{fa ? 'نه' : 'No'}</button>
          </>
        ) : null}
        <button type="button" className="iaos-qbar-skip" onClick={() => onSkip()}>
          {fa ? 'بی‌خیال' : 'skip'}
        </button>
        {onDismiss ? (
          <button type="button" className="iaos-qbar-skip" aria-label="close" onClick={() => onDismiss()}>✕</button>
        ) : null}
      </div>
    </div>
  );
});
