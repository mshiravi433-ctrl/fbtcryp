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
 * Everything they render comes from the module layer
 * (src/lib/intent-ai/chat/*), which the node probe covers.
 */
import { memo } from 'react';

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

/**
 * The bar above the composer. It exists because a question the assistant asked
 * must stay visible until it is answered — including across reloads, because
 * the ledger that feeds it is persisted.
 */
export const PendingQuestionBar = memo(function PendingQuestionBar({ question, ack, locale = 'fa', onAnswer, onSkip, onDismiss }) {
  const fa = String(locale || 'fa').startsWith('fa');
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
