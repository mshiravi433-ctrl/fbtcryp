/**
 * Shared building blocks for the Lab v2 screens.
 *
 * Why a barrel: nine screens and every one of them needs a back button, a
 * result card, a coach box, a percentage stat row. Without this file the
 * `import` block at the top of each screen would be 8 lines long and the
 * markup would be visually identical — but inlined, with one screen's
 * `.lab2-back` having a 2px padding and another's a 4px, which is how
 * visual drift creeps in.
 */

import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLabStore } from '../../store/useLabStore';

/**
 * Level name with a real fallback.
 *
 * The Lab store stores a `nameKey` (beginner/trader/…). If a locale does not
 * contain that key yet, react-i18next would otherwise paint the raw key (for
 * example `lab2.levelNames.level2`) next to a Persian sentence. This helper
 * prefers the translated string, then the store's display name, then a plain
 * human string — never a key.
 */
export function labLevelName(t, level) {
  const key = `lab2.levelNames.${level?.nameKey || 'beginner'}`;
  const translated = t(key, { defaultValue: '' });
  if (translated && translated !== '' && !translated.startsWith('lab2.')) return translated;
  return level?.name || t('lab2.levelNames.beginner', 'Beginner');
}

export function LabHeader() {
  const { t } = useTranslation();
  const balance = useLabStore((s) => s.balance);
  const xp = useLabStore((s) => s.xp);
  const levelFn = useLabStore((s) => s.level);
  const predictionsCount = useLabStore((s) => s.predictionsCount);
  const correctPredictions = useLabStore((s) => s.correctPredictions);
  const accuracy = predictionsCount > 0 ? Math.round((correctPredictions / predictionsCount) * 100) : 0;
  const rank = useLabStore((s) => {
    const lb = [...s.leaderboard].sort((a, b) => b.xp - a.xp);
    const idx = lb.findIndex((r) => r.isYou);
    return idx >= 0 ? idx + 1 : lb.length + 1;
  });
  const lvl = levelFn();
  const totalXp = xp;

  return (
    <div className="lab2-header">
      <div className="lab2-balance-row">
        <div>
          <div className="lab2-balance-label">{t('lab2.virtualBalance', 'Virtual Balance')}</div>
          <div className="lab2-balance">${balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
          <div className="lab2-balance-sub">{t('lab2.practiceOnly', 'Practice only — not real money')}</div>
        </div>
        <div className="lab2-stats">
          <div className="lab2-stat">
            <div className="lab2-stat-val">{lvl.lvl}</div>
            <div>{t('lab2.level', 'Level')}</div>
          </div>
          <div className="lab2-stat">
            <div className="lab2-stat-val">{accuracy}%</div>
            <div>{t('lab2.accuracy', 'Accuracy')}</div>
          </div>
          <div className="lab2-stat">
            <div className="lab2-stat-val">#{rank}</div>
            <div>{t('lab2.rank', 'Rank')}</div>
          </div>
        </div>
      </div>
      <div className="lab2-level">
        <div className="lab2-level-badge">{lvl.lvl}</div>
        <div className="lab2-level-info">
          <div className="lab2-level-name">
            <strong>{labLevelName(t, lvl)}</strong>
            <span>{t('lab2.xpRange', { cur: totalXp.toLocaleString(), next: lvl.nextXp.toLocaleString() })}</span>
          </div>
          <div className="lab2-bar">
            <motion.div
              className="lab2-bar-fill"
              initial={{ width: 0 }}
              animate={{ width: `${lvl.pct}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function LabBack({ onBack, title, sub }) {
  const { t } = useTranslation();
  return (
    <div className="lab2-screen-head">
      <button className="lab2-back" onClick={onBack} aria-label={t('common.back', 'Back')}>←</button>
      <div>
        <div className="lab2-screen-title">{title}</div>
        {sub && <div className="lab2-screen-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function AICoach({ name, message, emoji = '🤖' }) {
  const { t } = useTranslation();
  if (!message) return null;
  const coachName = name ?? t('lab2.aiCoach');
  return (
    <div className="lab2-coach">
      <div className="lab2-coach-avatar">{emoji}</div>
      <div className="lab2-coach-body">
        <div className="lab2-coach-name">{coachName}</div>
        <div className="lab2-coach-msg">{message}</div>
      </div>
    </div>
  );
}

export function ResultCard({ kind = 'neutral', emoji, title, sub, children }) {
  return (
    <div className={`lab2-result ${kind}`}>
      {emoji && <div className="lab2-result-emoji">{emoji}</div>}
      {title && <div className="lab2-result-title">{title}</div>}
      {sub && <div className="lab2-result-sub">{sub}</div>}
      {children}
    </div>
  );
}

export function Panel({ title, children, action }) {
  return (
    <div className="lab2-panel">
      {title && (
        <div className="lab2-panel-title">
          <span>{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Row({ label, value, valueClass }) {
  return (
    <div className="lab2-row">
      <span>{label}</span>
      <strong className={valueClass || ''}>{value}</strong>
    </div>
  );
}

export function Notice({ children, icon = '💡' }) {
  return (
    <div className="lab2-notice">
      <span className="lab2-notice-icon">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="lab2-empty">{children}</div>;
}

export function Sparkline({ data, color = 'var(--rgb-1)' }) {
  if (!data || data.length < 2) return <div className="lab2-spark" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 60;
  const step = w / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <div className="lab2-spark">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? 'var(--up)' : 'var(--down)'} stopOpacity="0.4" />
            <stop offset="100%" stopColor={up ? 'var(--up)' : 'var(--down)'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${points} ${w},${h}`} fill="url(#sparkGrad)" />
        <polyline points={points} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.5" />
      </svg>
    </div>
  );
}
