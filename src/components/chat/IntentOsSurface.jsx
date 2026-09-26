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

export const OsEventCard = memo(function OsEventCard({ event, locale = 'fa', onChip, onOpenRoute }) {
  if (!event) return null;
  const fa = String(locale || 'fa').startsWith('fa');
  const tone = TONE_CLASS[event.tone] || '';
  const lines = Array.isArray(event.lines) ? event.lines : [];
  const chips = Array.isArray(event.chips) ? event.chips : [];
  const payload = event.payload || {};
  return (
    <div className={`iaos-os-card ${tone}`} data-testid="intent-os-card" data-kind={event.kind || 'NOTICE'}>
      {event.title ? (
        <div className="iaos-os-head">
          <span className="iaos-os-kind">{String(event.kind || '').toLowerCase()}</span>
          <b>{event.title}</b>
          {event.badge ? <span className="iaos-os-badge">{event.badge}</span> : null}
        </div>
      ) : event.badge ? (
        <div className="iaos-os-head"><span className="iaos-os-badge">{event.badge}</span></div>
      ) : null}
      {lines.length ? <div className="iaos-os-lines">{lines.map(renderLine)}</div> : null}
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
              onClick={() => (onChip ? onChip(chip.prompt || chip.label) : (onOpenRoute && chip.route ? onOpenRoute(chip.route) : null))}
            >
              {chip.label}
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
