/**
 * Leaderboard — virtual ranking among Lab users.
 * The numbers here are all fake. There is no server, no real user table, no payout.
 */

import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LabBack, Panel, Notice } from './Shared';
import { useLabStore } from '../../store/useLabStore';

const XP_ROWS = [
  { emoji: '✅', key: 'correctPrediction', xp: 25 },
  { emoji: '📈', key: 'winningTrade', xp: 50 },
  { emoji: '🎯', key: 'challengeWin', xp: 40 },
  { emoji: '🧠', key: 'lesson', xp: 25 },
  { emoji: '🧪', key: 'strategyBacktest', xp: 60 },
  { emoji: '🏦', key: 'defiSim', xp: 20 },
  { emoji: '🧩', key: 'whatIf', xp: 15 }
];

export default function Leaderboard({ onBack }) {
  const { t } = useTranslation();
  const syncLeaderboard = useLabStore((s) => s.syncLeaderboard);
  const leaderboard = useLabStore((s) => s.leaderboard);

  // Keep the user's row up to date with their current XP.
  useEffect(() => {
    syncLeaderboard();
  }, [syncLeaderboard]);

  const sorted = useMemo(
    () => [...leaderboard].sort((a, b) => b.xp - a.xp),
    [leaderboard]
  );

  const myRank = sorted.findIndex((r) => r.isYou) + 1;
  const topXP = sorted[0]?.xp ?? 1;

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title={`🏆 ${t('lab2.screens.leaderboard.title')}`} sub={t('lab2.leaderboard.youAre', { rank: myRank, total: sorted.length })} />

      <Panel title={t('lab2.leaderboard.topThisWeek')}>
        {sorted.slice(0, 20).map((r, idx) => {
          const rank = idx + 1;
          const isYou = r.isYou;
          const barWidth = Math.round((r.xp / topXP) * 100);
          return (
            <div
              key={r.id}
              className={`lab2-lb-row ${isYou ? 'you' : ''}`}
              style={{ position: 'relative' }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${barWidth}%`,
                  background: isYou
                    ? 'linear-gradient(90deg, rgba(0, 229, 255, 0.20), transparent)'
                    : 'rgba(255, 255, 255, 0.02)',
                  borderRadius: 12,
                  zIndex: 0
                }}
              />
              <div className="lab2-lb-rank" style={{ position: 'relative' }}>
                {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `#${rank}`}
              </div>
              <div className="lab2-lb-name" style={{ position: 'relative' }}>
                {isYou ? t('lab2.you') : r.name} {isYou && '⭐'}
              </div>
              <div className="lab2-lb-xp" style={{ position: 'relative' }}>{t('lab2.xpValue', { n: r.xp.toLocaleString() })}</div>
            </div>
          );
        })}
      </Panel>

      <Panel title={t('lab2.leaderboard.howXpEarned')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-2)' }}>
          {XP_ROWS.map((row) => (
            <div key={row.key}>
              {row.emoji} {t(`lab2.leaderboard.${row.key}`)}: <strong style={{ color: 'var(--text-1)' }} className="lab2-num">{t('lab2.leaderboard.xpAmount', { n: row.xp })}</strong>
            </div>
          ))}
        </div>
      </Panel>

      <Notice icon="🎮">
        {t('lab2.leaderboard.notice')}
      </Notice>
    </div>
  );
}
