/**
 * Level / Progress — the user-facing summary of their training.
 *
 * VISUAL PASS: badges are tiles, not list rows. An earned badge carries its
 * accent gradient, a check medallion and a slow diagonal shine; a locked one is
 * dimmed with a padlock. Scanning the grid tells you what is left to do without
 * reading a single description.
 */

import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { AnimatedNumber, LAB_EASE, LabBack, Meter, Notice, Panel, Row, labLevelName } from './Shared';
import { IconCheck, IconLock, LabIcon } from './LabIcons';
import { levelFromXp, useLabStore } from '../../store/useLabStore';
import { useStill } from '../AnimatedIcon';

const BADGES = [
  { id: 'predictor', icon: 'flask', accent: 'violet' },
  { id: 'trader', icon: 'trend', accent: 'cyan' },
  { id: 'graduate', icon: 'cap', accent: 'amber' },
  { id: 'strategist', icon: 'atom', accent: 'magenta' },
  { id: 'riskpro', icon: 'shield', accent: 'mint' },
  { id: 'defi', icon: 'bank', accent: 'cyan' },
  { id: 'master', icon: 'crown', accent: 'amber' }
];

export default function LevelSystem({ onBack }) {
  const { t } = useTranslation();
  const still = useStill();
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
  const highRiskTrades = paperTrades.filter((x) => x.riskScore >= 90).length;
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
      <LabBack
        onBack={onBack}
        icon="trophy"
        accent="amber"
        title={t('lab2.screens.level.title')}
        sub={t('lab2.level.badgesEarned', { earned: earnedCount, total: BADGES.length })}
      />

      <Panel title={t('lab2.level.level')} icon="sparkles" accent="violet">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            className="lab2-level-badge"
            style={{ background: 'linear-gradient(140deg, var(--rgb-1), var(--rgb-2) 55%, var(--rgb-3))' }}
          >
            {lvl.lvl}
          </div>
          <div className="lab2-level-info" style={{ flex: 1 }}>
            <div className="lab2-level-name">
              <strong>{labLevelName(t, lvl)}</strong>
              <span className="lab2-num">
                <AnimatedNumber value={xp} /> / {lvl.nextXp.toLocaleString()}
              </span>
            </div>
            <div className="lab2-bar">
              <motion.div
                className="lab2-bar-fill"
                initial={still ? false : { width: 0 }}
                animate={{ width: `${lvl.pct}%` }}
                transition={{ duration: 0.9, ease: LAB_EASE }}
              />
            </div>
          </div>
        </div>
        <Row label={t('lab2.level.currentLevel')} value={`${lvl.lvl} · ${labLevelName(t, lvl)}`} />
        <Row label={t('lab2.level.progressToNext')} value={<span className="lab2-num">{lvl.pct}%</span>} />
      </Panel>

      <Panel title={t('lab2.level.disciplineScores')} icon="gauge" accent="mint">
        <div className="lab2-stack" style={{ gap: 12 }}>
          <div className="lab2-stack" style={{ gap: 6 }}>
            <Row
              label={t('lab2.level.predictionAccuracy')}
              value={<span className="lab2-num">{accuracy}%</span>}
              valueClass={accuracy >= 60 ? 'pos' : ''}
            />
            <Meter value={accuracy} accent={accuracy >= 60 ? 'mint' : 'amber'} />
          </div>
          <div className="lab2-stack" style={{ gap: 6 }}>
            <Row
              label={t('lab2.level.tradeWinRate')}
              value={<span className="lab2-num">{winRate}%</span>}
              valueClass={winRate >= 55 ? 'pos' : ''}
            />
            <Meter value={winRate} accent={winRate >= 55 ? 'mint' : 'amber'} />
          </div>
          <div className="lab2-stack" style={{ gap: 6 }}>
            <Row
              label={t('lab2.level.badges')}
              value={<span className="lab2-num">{earnedCount} / {BADGES.length}</span>}
            />
            <Meter value={(earnedCount / BADGES.length) * 100} accent="violet" />
          </div>
        </div>
        <Row label={t('lab2.level.strategiesBacktested')} value={<span className="lab2-num">{strategies.length}</span>} />
        <Row label={t('lab2.level.challengeWins')} value={<span className="lab2-num">{challenges}</span>} />
        <Row label={t('lab2.level.lessonsCompleted')} value={<span className="lab2-num">{lessonsDone}</span>} />
      </Panel>

      <Panel title={t('lab2.level.badges')} icon="medal" accent="amber">
        <div className="lab2-badge-grid">
          {BADGES.map((b, i) => {
            const got = Boolean(earned[b.id]);
            return (
              <motion.div
                key={b.id}
                className={`lab2-badge acc-${b.accent} ${got ? 'earned' : ''}`}
                initial={still ? false : { opacity: 0, y: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.42, ease: LAB_EASE, delay: still ? 0 : i * 0.05 }}
              >
                <span className="lab2-badge-state" aria-hidden="true">
                  {got ? <IconCheck width={13} height={13} /> : <IconLock width={12} height={12} />}
                </span>
                <span className="lab2-badge-icon" aria-hidden="true">
                  <LabIcon name={b.icon} width={21} height={21} />
                </span>
                <span className="lab2-badge-name">{t(`lab2.level.badgesList.${b.id}.name`)}</span>
                <span className="lab2-badge-desc">{t(`lab2.level.badgesList.${b.id}.desc`)}</span>
              </motion.div>
            );
          })}
        </div>
      </Panel>

      <Notice variant="tip" icon="star">
        {t('lab2.level.notice')}
      </Notice>
    </div>
  );
}
