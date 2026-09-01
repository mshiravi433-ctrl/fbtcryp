/**
 * Leaderboard — virtual ranking among Lab users.
 *
 * The numbers here are all fake. There is no server, no real user table,
 * no payout. The list is a "these are the kinds of scores people hit"
 * calibration, with the user's row injected at the position their XP
 * would land them in.
 *
 * Why include it at all: the spec asks for it, and a static list with the
 * user's row interleaved does motivate people to keep practising — it is
 * the same reason Duolingo shows you ahead of the people you "should" be
 * ahead of.
 */

import { useEffect, useMemo } from 'react';
import { LabBack, Panel, Notice } from './Shared';
import { useLabStore } from '../../store/useLabStore';

export default function Leaderboard({ onBack }) {
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
      <LabBack onBack={onBack} title="🏆 Lab Leaderboard" sub={`You are #${myRank} of ${sorted.length} · virtual only`} />

      <Panel title="Top this week">
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
                {r.name} {isYou && '⭐'}
              </div>
              <div className="lab2-lb-xp" style={{ position: 'relative' }}>{r.xp.toLocaleString()} XP</div>
            </div>
          );
        })}
      </Panel>

      <Panel title="How XP is earned">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-2)' }}>
          <div>✅ Correct prediction: <strong style={{ color: 'var(--text-1)' }}>+25 XP</strong></div>
          <div>📈 Winning trade: <strong style={{ color: 'var(--text-1)' }}>+50 XP</strong></div>
          <div>🎯 Challenge win: <strong style={{ color: 'var(--text-1)' }}>+40 XP</strong></div>
          <div>🧠 Lesson: <strong style={{ color: 'var(--text-1)' }}>+25 XP</strong></div>
          <div>🧪 Strategy backtest: <strong style={{ color: 'var(--text-1)' }}>+60 XP</strong></div>
          <div>🏦 DeFi sim: <strong style={{ color: 'var(--text-1)' }}>+20 XP</strong></div>
          <div>🧩 What-if: <strong style={{ color: 'var(--text-1)' }}>+15 XP</strong></div>
        </div>
      </Panel>

      <Notice icon="🎮">
        The leaderboard is a virtual score. There is no prize, no payout, no
        ranking that affects anything outside Lab. The XP is meant to track
        practice, not to gamify trading.
      </Notice>
    </div>
  );
}
