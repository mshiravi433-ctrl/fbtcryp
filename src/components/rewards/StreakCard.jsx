import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/useAppStore';
import { useTelegram } from '../../context/TelegramContext';
import { dailyRewardStatus } from '../../lib/dailyRewards';

const R = 42;
const C = 2 * Math.PI * R;

/**
 * STREAK — the real check-in rule from lib/dailyRewards, with the day-7
 * milestone made visible.
 *
 * No number here is new: `claimDaily` pays `dailyCheckin + streak × 10`, capped
 * at day 7, exactly as before. The card only explains the same rule more
 * clearly, and calls the same store action the old button called.
 */
export default function StreakCard() {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const streak = useAppStore((s) => s.streak);
  const lastClaim = useAppStore((s) => s.lastClaim);
  const claimDaily = useAppStore((s) => s.claimDaily);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(id); window.removeEventListener('focus', tick); };
  }, []);

  const status = useMemo(
    () => dailyRewardStatus({ now, lastClaim, streak }),
    [now, lastClaim, streak]
  );
  const { canClaim, hoursLeft, reward, activeStreak } = status;
  const shownStreak = activeStreak;
  const progress = Math.min(1, Math.max(0, activeStreak / 7));
  const offset = C * (1 - progress);

  const claim = () => {
    if (!canClaim) return;
    const paid = claimDaily(Date.now());
    if (paid !== false) {
      setNow(Date.now());
      haptic?.('success');
    }
  };

  return (
    <section className="rwd-card rwd-streak-card" id="rwd-streak">
      <header className="rwd-sec-head">
        <div>
          <div className="rwd-kicker">{t('rewards.v2.streak.kicker')}</div>
          <h3 className="rwd-sec-title">{t('rewards.v2.streak.title')}</h3>
        </div>
        <span className="rwd-chip">{t('rewards.v2.streak.days', { n: shownStreak })}</span>
      </header>

      <div className="rwd-streak-body">
        <div className="rwd-streak-ring">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="7" />
            <motion.circle
              cx="50" cy="50" r={R} fill="none" stroke="var(--rgb-4)" strokeWidth="7" strokeLinecap="round"
              strokeDasharray={C}
              initial={{ strokeDashoffset: C }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              style={{ filter: 'drop-shadow(0 0 6px rgba(0,255,157,.55))', transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
            />
          </svg>
          <span className="rwd-streak-flame" aria-hidden="true">🔥</span>
          <span className="rwd-streak-count">{shownStreak}</span>
        </div>

        <div className="rwd-streak-main">
          <p className="rwd-prose">{t('rewards.v2.streak.sub')}</p>

          <div className="rwd-week" aria-label={t('rewards.v2.streak.week')}>
            {Array.from({ length: 7 }).map((_, index) => {
              const done = index < Math.min(shownStreak, 7);
              const isNext = !canClaim && index === Math.min(shownStreak, 6);
              const isDay7 = index === 6;
              return (
                <div
                  key={index}
                  className={`rwd-day${done ? ' done' : ''}${isNext ? ' next' : ''}${isDay7 ? ' final' : ''}`}
                  title={isDay7 ? t('rewards.v2.streak.day7') : undefined}
                >
                  <span className="rwd-day-num">{done ? '✓' : index + 1}</span>
                  {isDay7 && <span className="rwd-day-star" aria-hidden="true">✦</span>}
                </div>
              );
            })}
          </div>

          <div className="rwd-streak-foot">
            <div>
              <div className="rwd-streak-reward">+{reward}</div>
              <div className="rwd-streak-reward-key">
                {canClaim ? t('rewards.v2.streak.claimHint') : t('rewards.v2.streak.nextHint')}
              </div>
            </div>
            <button type="button" className="btn btn-primary rwd-streak-btn" disabled={!canClaim} onClick={claim}>
              {canClaim ? t('earn.claimNow') : t('earn.comeBackIn', { h: hoursLeft })}
            </button>
          </div>
          <p className="rwd-fine">{t('rewards.v2.streak.note')}</p>
        </div>
      </div>
    </section>
  );
}
