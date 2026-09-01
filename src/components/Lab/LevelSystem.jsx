/**
 * Level / Progress — the user-facing summary of their training.
 * XP, current level, accuracy / win rate / discipline across all the
 * Lab sub-screens. It is the "stats screen" that makes the user feel
 * like their practice is going somewhere.
 */

import { LabBack, Panel, Row, Notice } from './Shared';
import { levelFromXp } from '../../store/useLabStore';
import { useLabStore } from '../../store/useLabStore';

const BADGES = [
  { id: 'predictor', name: 'Predictor', icon: '🔮', desc: 'Make 10 predictions' },
  { id: 'trader', name: 'Trader', icon: '📈', desc: 'Open 5 paper trades' },
  { id: 'graduate', name: 'Graduate', icon: '🎓', desc: 'Complete 5 lessons' },
  { id: 'strategist', name: 'Strategist', icon: '🧪', desc: 'Run 3 strategy backtests' },
  { id: 'riskpro', name: 'Risk Pro', icon: '🛡️', desc: 'Hit 90+ Risk Mgmt Score on 3 trades' },
  { id: 'defi', name: 'DeFi Curious', icon: '🏦', desc: 'Try all 5 DeFi primitives' },
  { id: 'master', name: 'Market Master', icon: '👑', desc: 'Reach Level 10' }
];

export default function LevelSystem({ onBack }) {
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
      <LabBack onBack={onBack} title="🏆 Your Lab Level" sub={`${earnedCount}/${BADGES.length} badges earned`} />

      <Panel title="Level">
        <Row label="Current level" value={`${lvl.lvl} · ${lvl.name}`} />
        <Row label="XP" value={`${xp.toLocaleString()} / ${lvl.nextXp.toLocaleString()}`} />
        <Row label="Progress to next" value={`${lvl.pct}%`} />
      </Panel>

      <Panel title="Discipline scores">
        <Row label="Prediction accuracy" value={`${accuracy}%`} valueClass={accuracy >= 60 ? 'pos' : ''} />
        <Row label="Trade win rate" value={`${winRate}%`} valueClass={winRate >= 55 ? 'pos' : ''} />
        <Row label="Strategies backtested" value={strategies.length} />
        <Row label="Challenge wins" value={challenges} />
        <Row label="Lessons completed" value={`${lessonsDone}`} />
      </Panel>

      <Panel title="Badges">
        {BADGES.map((b) => (
          <div key={b.id} className="lab2-row">
            <span style={{ opacity: earned[b.id] ? 1 : 0.4 }}>
              {b.icon} <strong style={{ color: earned[b.id] ? 'var(--text-1)' : 'var(--text-3)' }}>{b.name}</strong>
              <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 6 }}>{b.desc}</span>
            </span>
            <strong style={{ color: earned[b.id] ? 'var(--up)' : 'var(--text-3)' }}>
              {earned[b.id] ? '✓' : '🔒'}
            </strong>
          </div>
        ))}
      </Panel>

      <Notice icon="⭐">
        XP is awarded for practice, not for profit. A losing trade with a
        disciplined setup earns more XP than a winning trade with no stop
        loss — because the discipline is what compounds over a career.
      </Notice>
    </div>
  );
}
