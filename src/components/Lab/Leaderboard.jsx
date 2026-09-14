/**
 * Leaderboard — virtual ranking among Lab users.
 * The numbers here are all fake. There is no server, no real user table, no payout.
 *
 * VISUAL PASS: the top three get a podium (2 · 1 · 3, gold in the middle) and
 * everyone else gets a row whose XP bar is painted behind the text, so the
 * shape of the ranking is visible at a glance. The "how XP is earned" list is
 * icon tiles rather than a paragraph of emoji.
 */

import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { AnimatedNumber, LAB_EASE, LabBack, Notice, Panel } from './Shared';
import { IconCrown, IconMedal, IconStar, LabIcon } from './LabIcons';
import { useLabStore } from '../../store/useLabStore';
import { useStill } from '../AnimatedIcon';

const XP_ROWS = [
  { icon: 'checkCircle', accent: 'mint', key: 'correctPrediction', xp: 25 },
  { icon: 'trend', accent: 'cyan', key: 'winningTrade', xp: 50 },
  { icon: 'target', accent: 'magenta', key: 'challengeWin', xp: 40 },
  { icon: 'brain', accent: 'amber', key: 'lesson', xp: 25 },
  { icon: 'atom', accent: 'violet', key: 'strategyBacktest', xp: 60 },
  { icon: 'bank', accent: 'mint', key: 'defiSim', xp: 20 },
  { icon: 'puzzle', accent: 'rose', key: 'whatIf', xp: 15 }
];

const PODIUM_ACCENT = {
  1: { acc: '#ffd76a', acc2: '#ff9d2e' },
  2: { acc: '#e8eef7', acc2: '#a9b6c9' },
  3: { acc: '#e8a06a', acc2: '#b96a35' }
};

export default function Leaderboard({ onBack }) {
  const { t } = useTranslation();
  const still = useStill();
  const syncLeaderboard = useLabStore((s) => s.syncLeaderboard);
  const leaderboard = useLabStore((s) => s.leaderboard);

  // Keep the user's row up to date with their current XP.
  useEffect(() => {
    syncLeaderboard();
  }, [syncLeaderboard]);

  const sorted = useMemo(() => [...leaderboard].sort((a, b) => b.xp - a.xp), [leaderboard]);

  const myRank = sorted.findIndex((r) => r.isYou) + 1;
  const topXP = sorted[0]?.xp ?? 1;
  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3, 20);

  /* Podium reads 2 · 1 · 3 — the winner is in the middle and one step up. */
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        icon="medal"
        accent="magenta"
        title={t('lab2.screens.leaderboard.title')}
        sub={t('lab2.leaderboard.youAre', { rank: myRank || sorted.length + 1, total: sorted.length })}
      />

      {podiumOrder.length > 0 && (
        <Panel title={t('lab2.leaderboard.topThisWeek')} icon="crown" accent="amber">
          <div className="lab2-podium">
            {podiumOrder.map((r, i) => {
              const rank = sorted.indexOf(r) + 1;
              const accent = PODIUM_ACCENT[rank] ?? PODIUM_ACCENT[3];
              return (
                <motion.div
                  key={r.id}
                  className={`lab2-podium-col place-${rank}`}
                  style={{ '--acc': accent.acc, '--acc-2': accent.acc2 }}
                  initial={still ? false : { opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: LAB_EASE, delay: still ? 0 : i * 0.09 }}
                >
                  <span className="lab2-podium-medal" aria-hidden="true">
                    {rank === 1 ? <IconCrown width={18} height={18} /> : <IconMedal width={17} height={17} />}
                  </span>
                  <span className="lab2-podium-name">
                    {r.isYou ? t('lab2.you') : r.name}
                    {r.isYou && <IconStar width={11} height={11} className="lab2-lb-you" />}
                  </span>
                  <span className="lab2-podium-xp lab2-num">
                    <AnimatedNumber value={r.xp} />
                  </span>
                  <span className="lab2-podium-block" aria-hidden="true">
                    <span className="lab2-podium-rank">{rank}</span>
                  </span>
                </motion.div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel title={t('lab2.leaderboard.topThisWeek')} icon="layers" accent="cyan">
        <div className="lab2-stack" style={{ gap: 7 }}>
          {rest.map((r, idx) => {
            const rank = idx + 4;
            const isYou = r.isYou;
            const barWidth = Math.round((r.xp / topXP) * 100);
            return (
              <motion.div
                key={r.id}
                className={`lab2-lb-row ${isYou ? 'you' : ''}`}
                initial={still ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.34, ease: LAB_EASE, delay: still ? 0 : Math.min(idx * 0.035, 0.3) }}
              >
                <motion.span
                  className="lab2-lb-bar"
                  initial={still ? false : { width: 0 }}
                  animate={{ width: `${barWidth}%` }}
                  transition={{ duration: 0.8, ease: LAB_EASE, delay: still ? 0 : 0.1 + idx * 0.03 }}
                />
                <div className="lab2-lb-rank">#{rank}</div>
                <div className="lab2-lb-name">
                  {isYou ? t('lab2.you') : r.name}
                  {isYou && <IconStar width={12} height={12} className="lab2-lb-you" />}
                </div>
                <div className="lab2-lb-xp">{t('lab2.xpValue', { n: r.xp.toLocaleString() })}</div>
              </motion.div>
            );
          })}
        </div>
      </Panel>

      <Panel title={t('lab2.leaderboard.howXpEarned')} icon="sparkles" accent="violet">
        <div className="lab2-xp-list">
          {XP_ROWS.map((row, i) => (
            <motion.div
              key={row.key}
              className={`lab2-xp-item acc-${row.accent}`}
              initial={still ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: LAB_EASE, delay: still ? 0 : i * 0.04 }}
            >
              <span className="lab2-xp-icon" aria-hidden="true">
                <LabIcon name={row.icon} width={15} height={15} />
              </span>
              <span>{t(`lab2.leaderboard.${row.key}`)}</span>
              <span className="lab2-xp-val lab2-num">{t('lab2.leaderboard.xpAmount', { n: row.xp })}</span>
            </motion.div>
          ))}
        </div>
      </Panel>

      <Notice variant="info" icon="info">
        {t('lab2.leaderboard.notice')}
      </Notice>
    </div>
  );
}
