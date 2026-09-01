/**
 * Market Challenges — what would you do if BTC just dropped 18%?
 * Pick an answer, the system explains the consequences.
 *
 * Each challenge:
 *   1. Sets a fictional market scenario with price shocks per asset.
 *   2. Offers 3-4 choices.
 *   3. Reveals the impact (in % portfolio change) and a one-line lesson.
 *   4. Awards XP for engaging, more for the "smart" outcome.
 *
 * The "smart" answer is rarely the one that makes the most money in the
 * moment — it is the one that a long-term profitable trader would pick.
 * That distinction is the whole point of the screen.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LabBack, AICoach, Panel, Row, Notice, ResultCard } from './Shared';
import { SCENARIOS } from '../../lib/lab/scenarios';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

export default function Challenges({ onBack }) {
  const { haptic } = useTelegram();
  const completeChallenge = useLabStore((s) => s.completeChallenge);
  const completed = useLabStore((s) => s.challenges);
  const [activeId, setActiveId] = useState(SCENARIOS[0].id);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [revealed, setRevealed] = useState(false);

  const active = SCENARIOS.find((s) => s.id === activeId) ?? SCENARIOS[0];

  const handleChoice = (choice) => {
    if (revealed) return;
    haptic?.('select');
    setSelectedChoice(choice.id);
    setRevealed(true);
    const outcomeRank = { smart: 'win', win: 'win', survive: 'win', late: 'loss', loss: 'loss', panic: 'loss', risky: 'win', patient: 'win', disciplined: 'win', safe: 'win', pain: 'loss', partial: 'win' }[choice.outcome] || 'neutral';
    completeChallenge({
      scenarioId: active.id,
      choiceId: choice.id,
      outcome: outcomeRank,
      impactPct: choice.impact,
      xpAward: outcomeRank === 'win' ? 40 : 20
    });
    if (outcomeRank === 'win') haptic?.('success');
  };

  const reset = () => {
    setSelectedChoice(null);
    setRevealed(false);
  };

  const nextScenario = () => {
    const idx = SCENARIOS.findIndex((s) => s.id === activeId);
    const next = SCENARIOS[(idx + 1) % SCENARIOS.length];
    setActiveId(next.id);
    reset();
  };

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title="🎯 Market Challenges" sub="Decide under pressure. Learn from the consequence." />

      <Panel title="Choose a scenario">
        <div className="lab2-defi-tabs">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={`lab2-defi-tab ${activeId === s.id ? 'active' : ''}`}
              onClick={() => { setActiveId(s.id); reset(); }}
            >
              {s.icon} {s.title.replace(/^[^A-Za-z]+/, '').split(' ').slice(0, 2).join(' ')}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={active.title}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {active.teaser}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {active.shocks.map((s) => (
            <span
              key={s.coin}
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 999,
                background: s.pct > 0 ? 'rgba(0, 255, 157, 0.10)' : s.pct < 0 ? 'rgba(255, 59, 107, 0.10)' : 'rgba(255,255,255,0.05)',
                color: s.pct > 0 ? 'var(--up)' : s.pct < 0 ? 'var(--down)' : 'var(--text-2)',
                fontWeight: 600
              }}
            >
              {s.coin} {s.pct > 0 ? '+' : ''}{s.pct}%
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="What do you do?">
        <div className="lab2-choices">
          {active.choices.map((c) => (
            <button
              key={c.id}
              className={`lab2-choice ${selectedChoice === c.id ? 'selected' : ''}`}
              onClick={() => handleChoice(c)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </Panel>

      <AnimatePresence>
        {revealed && selectedChoice && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <ResultCard
              kind={
                ['smart', 'win', 'survive', 'disciplined', 'safe', 'partial', 'patient', 'risky'].includes(active.choices.find((c) => c.id === selectedChoice)?.outcome)
                  ? 'win'
                  : 'loss'
              }
              emoji={active.choices.find((c) => c.id === selectedChoice)?.outcome === 'smart' ? '🧠' : '📊'}
              title={`Your portfolio: ${active.choices.find((c) => c.id === selectedChoice)?.impact > 0 ? '+' : ''}${active.choices.find((c) => c.id === selectedChoice)?.impact}%`}
              sub={active.choices.find((c) => c.id === selectedChoice)?.lesson}
            >
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="lab2-btn ghost" onClick={reset}>Try again</button>
                <button className="lab2-btn primary" onClick={nextScenario}>Next scenario →</button>
              </div>
            </ResultCard>
          </motion.div>
        )}
      </AnimatePresence>

      <Panel title="Your history">
        {completed.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', padding: 12 }}>
            No challenges yet. Make your first call above.
          </div>
        ) : (
          completed.slice(0, 5).map((c) => {
            const sc = SCENARIOS.find((s) => s.id === c.scenarioId);
            const ch = sc?.choices.find((x) => x.id === c.choiceId);
            return (
              <div key={c.id} className="lab2-row">
                <span>{sc?.title}</span>
                <strong className={c.outcome === 'win' ? 'pos' : c.outcome === 'loss' ? 'neg' : ''}>
                  {ch?.impact > 0 ? '+' : ''}{ch?.impact}%
                </strong>
              </div>
            );
          })
        )}
      </Panel>

      <Notice icon="💡">
        There is rarely one "right" answer in a real market — there is the answer
        that fits YOUR strategy and risk tolerance. The lesson here is what to
        think about, not what to do.
      </Notice>
    </div>
  );
}
