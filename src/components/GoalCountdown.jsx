/**
 * FBT INTENT AI — GOAL COUNTDOWN
 * ---------------------------------------------------------------------------
 * Live countdown for a timed, user-confirmed goal (e.g. "30 days" or
 * "4 hours"). Ticks once a second and shows the remaining days, hours and
 * minutes in glass boxes; collapses into a single "expired" state when the
 * deadline passes so the panel never shows a stale, meaningless timer.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

function splitRemaining(ms) {
  const total = Math.max(0, ms);
  const totalMinutes = Math.floor(total / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const seconds = Math.floor((total % 60_000) / 1000);
  return { days, hours, minutes, seconds };
}

const pad = (n) => String(n).padStart(2, '0');

export default function GoalCountdown({ deadline, goalPct = null, capitalUsd = null, compact = false }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadline) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;
  const remaining = deadline - now;
  const expired = remaining <= 0;
  const { days, hours, minutes, seconds } = splitRemaining(remaining);

  if (compact) {
    return (
      <div className="ia-countdown is-compact" role="timer" aria-live="off">
        <span className="ia-cd-title">{t('intentAI.countdown.title')}</span>
        <span className="ia-cd-compact-value">
          {expired
            ? t('intentAI.countdown.expired')
            : `${days}${t('intentAI.countdown.d')} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`}
        </span>
      </div>
    );
  }

  return (
    <div className={`ia-countdown${expired ? ' is-expired' : ''}`} role="timer" aria-live="off" data-testid="goal-countdown">
      <div className="ia-cd-head">
        <span className="ia-cd-dot" aria-hidden="true" />
        <span className="ia-cd-title">{t('intentAI.countdown.title')}</span>
        {goalPct != null && <span className="ia-cd-goal">{t('intentAI.countdown.goal', { pct: goalPct })}</span>}
      </div>
      {expired ? (
        <p className="ia-cd-expired">{t('intentAI.countdown.expiredNote')}</p>
      ) : (
        <div className="ia-cd-boxes">
          <div className="ia-cd-box">
            <b>{days}</b>
            <small>{t('intentAI.countdown.days')}</small>
          </div>
          <div className="ia-cd-box">
            <b>{pad(hours)}</b>
            <small>{t('intentAI.countdown.hours')}</small>
          </div>
          <div className="ia-cd-box">
            <b>{pad(minutes)}</b>
            <small>{t('intentAI.countdown.minutes')}</small>
          </div>
          <div className="ia-cd-box is-sec">
            <b>{pad(seconds)}</b>
            <small>{t('intentAI.countdown.seconds')}</small>
          </div>
        </div>
      )}
      {capitalUsd != null && !expired && (
        <p className="ia-cd-note">{t('intentAI.countdown.capital', { amount: capitalUsd.toLocaleString() })}</p>
      )}
      <p className="ia-cd-note faint">{t('intentAI.countdown.note')}</p>
    </div>
  );
}
