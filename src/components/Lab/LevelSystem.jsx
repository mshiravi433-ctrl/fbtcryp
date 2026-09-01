/**
 * Level / Progress — the user-facing summary of their training.
 */

import { useTranslation } from 'react-i18next';
import { LabBack, Panel, Row, Notice } from './Shared';
import { levelFromXp, useLabStore } from '../../store/useLabStore';

const BADGES = [
  { id: 'predictor', icon: '🔮' },
  { id: 'trader', icon: '📈' },
  { id: 'graduate', icon: '🎓' },
  { id: 'strategist', icon: '🧪' },
  { id: 'riskpro', icon: '🛡️' },
  { id: 'defi', icon: '🏦' },
  { id: 'master', icon: '👑' }
];

export default function LevelSystem({ onBack }) {
  const { t } = useTranslation();
  const xp = useLabStore((s) => s.xp);
  const lessonsDone = useLabStore((s) => s.lessonsDone);
  const predictionsCount = useLabStore((s) => s.predictionsCount);
  const correctPredictions = useLabStore((s) => s.correctPredictions);
  const tradesCount = useLabStore((s) => s.tradesCount);
  const winningTrades = useLabStore((s) => s.winningTrades);
  const strategies = useLabStore((s) => s.strategies);
  const paperTrades = useLabStore((s) => s.paperTrades);
  const defi = useLabStore((s) => s.defi);
  const challenges = useLabStore((s) => s.challengeWins);

  const lvl = levelFromXp(xp);
  const accuracy = predictionsCount > 0 ? Math.round((correctPredictions / predictionsCount) * 100) : 0;
  const winRate = tradesCount > 0 ? Math.round((winningTrades / tradesCount) * 100) : 0;
  const highRiskTrades = paperTrades.filter((t) => t.riskScore >= 90).length;
  const defiKinds = new Set(defi.map((d) => d.kind)).size;
  const masteredLevel = lvl.lvl >= 10;

  const earned = {
    predictor: predictionsCount >= 10,
    trader: tradesCount >= 5,
    graduate: lessonsDone >= 5,
    strategist: strategies.length >= 3,
    riskpro: highRiskTrades >= 3,
    defi: defiKinds >= 5,
    master: masteredLevel
  };

  const earnedCount = Object.values(earned).filter(Boolean).length;

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title={`🏆 ${t('lab2.screens.level.title')}`} sub={t('lab2.level.badgesEarned', { earned: earnedCount, total: BADGES.length })} />

      <Panel title={t('lab2.level.level')}>
        <Row label={t('lab2.level.currentLevel')} value={`${lvl.lvl} · ${t(`lab2.levelNames.${lvl.nameKey}`, lvl.name)}`} />
        <Row label={t('lab2.level.xp')} value={<span className="lab2-num">{xp.toLocaleString()} / {lvl.nextXp.toLocaleString()}</span>} />
        <Row label={t('lab2.level.progressToNext')} value={<span className="lab2-num">{lvl.pct}%</span>} />
      </Panel>

      <Panel title={t('lab2.level.disciplineScores')}>
        <Row label={t('lab2.level.predictionAccuracy')} value={<span className="lab2-num">{accuracy}%</span>} valueClass={accuracy >= 60 ? 'pos' : ''} />
        <Row label={t('lab2.level.tradeWinRate')} value={<span className="lab2-num">{winRate}%</span>} valueClass={winRate >= 55 ? 'pos' : ''} />
        <Row label={t('lab2.level.strategiesBacktested')} value={<span className="lab2-num">{strategies.length}</span>} />
        <Row label={t('lab2.level.challengeWins')} value={<span className="lab2-num">{challenges}</span>} />
        <Row label={t('lab2.level.lessonsCompleted')} value={<span className="lab2-num">{lessonsDone}</span>} />
      </Panel>

      <Panel title={t('lab2.level.badges')}>
        {BADGES.map((b) => (
          <div key={b.id} className="lab2-row">
            <span style={{ opacity: earned[b.id] ? 1 : 0.4 }}>
              {b.icon} <strong style={{ color: earned[b.id] ? 'var(--text-1)' : 'var(--text-3)' }}>{t(`lab2.level.badgesList.${b.id}.name`)}</strong>
              <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 6 }}>{t(`lab2.level.badgesList.${b.id}.desc`)}</span>
            </span>
            <strong style={{ color: earned[b.id] ? 'var(--up)' : 'var(--text-3)' }}>
              {earned[b.id] ? '✓' : '🔒'}
            </strong>
          </div>
        ))}
      </Panel>

      <Notice icon="⭐">
        {t('lab2.level.notice')}
      </Notice>
    </div>
  );
}
