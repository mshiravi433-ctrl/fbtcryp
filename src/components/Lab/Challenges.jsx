/**
 * Market Challenges — what would you do if BTC just dropped 18%?
 * Pick an answer, the system explains the consequences.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { LabBack, Panel, Notice, ResultCard } from './Shared';
import { SCENARIOS } from '../../lib/lab/scenarios';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const OUTCOME_KIND = {
  smart: 'win', win: 'win', survive: 'win', late: 'loss', loss: 'loss',
  panic: 'loss', risky: 'win', patient: 'win', disciplined: 'win',
  safe: 'win', pain: 'loss', partial: 'win'
};

export default function Challenges({ onBack }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const completeChallenge = useLabStore((s) => s.completeChallenge);
  const completed = useLabStore((s) => s.challenges);
  const [activeId, setActiveId] = useState(SCENARIOS[0].id);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [revealed, setRevealed] = useState(false);

  const active = SCENARIOS.find((s) => s.id === activeId) ?? SCENARIOS[0];
  const chosen = active.choices.find((c) => c.id === selectedChoice);

  const handleChoice = (choice) => {
    if (revealed) return;
    haptic?.('select');
    setSelectedChoice(choice.id);
    setRevealed(true);
    const outcomeRank = OUTCOME_KIND[choice.outcome] || 'neutral';
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
      <LabBack onBack={onBack} title={`🎯 ${t('lab2.screens.challenges.title')}`} sub={t('lab2.screens.challenges.sub')} />

      <Panel title={t('lab2.challenges.chooseScenario')}>
        <div className="lab2-defi-tabs">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={`lab2-defi-tab ${activeId === s.id ? 'active' : ''}`}
              onClick={() => { setActiveId(s.id); reset(); }}
            >
              {s.icon} {t(`lab2.scenarios.${s.id}.short`)}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={`${active.icon} ${t(`lab2.scenarios.${active.id}.title`)}`}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {t(`lab2.scenarios.${active.id}.teaser`)}
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
              className="lab2-num"
            >
              {s.coin} {s.pct > 0 ? '+' : ''}{s.pct}%
            </span>
          ))}
        </div>
      </Panel>

      <Panel title={t('lab2.challenges.whatDoYouDo')}>
        <div className="lab2-choices">
          {active.choices.map((c) => (
            <button
              key={c.id}
              className={`lab2-choice ${selectedChoice === c.id ? 'selected' : ''}`}
              onClick={() => handleChoice(c)}
            >
              {t(`lab2.scenarios.${active.id}.choices.${c.id}.label`)}
            </button>
          ))}
        </div>
      </Panel>

      <AnimatePresence>
        {revealed && chosen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <ResultCard
              kind={['smart', 'win', 'survive', 'disciplined', 'safe', 'partial', 'patient', 'risky'].includes(chosen.outcome) ? 'win' : 'loss'}
              emoji={chosen.outcome === 'smart' ? '🧠' : '📊'}
              title={<>{t('lab2.challenges.yourPortfolio')}: <span className="lab2-num">{chosen.impact > 0 ? '+' : ''}{chosen.impact}%</span></>}
              sub={t(`lab2.scenarios.${active.id}.choices.${chosen.id}.lesson`)}
            >
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="lab2-btn ghost" onClick={reset}>{t('lab2.tryAgain')}</button>
                <button className="lab2-btn primary" onClick={nextScenario}>{t('lab2.nextScenario')} <span className="lab2-arrow">→</span></button>
              </div>
            </ResultCard>
          </motion.div>
        )}
      </AnimatePresence>

      <Panel title={t('lab2.challenges.yourHistory')}>
        {completed.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', padding: 12 }}>
            {t('lab2.challenges.noChallengesYet')}
          </div>
        ) : (
          completed.slice(0, 5).map((c) => {
            const sc = SCENARIOS.find((s) => s.id === c.scenarioId);
            const ch = sc?.choices.find((x) => x.id === c.choiceId);
            return (
              <div key={c.id} className="lab2-row">
                <span>{sc ? `${sc.icon} ${t(`lab2.scenarios.${sc.id}.title`)}` : c.scenarioId}</span>
                <strong className={c.outcome === 'win' ? 'pos' : c.outcome === 'loss' ? 'neg' : ''}>
                  <span className="lab2-num">{ch?.impact > 0 ? '+' : ''}{ch?.impact}%</span>
                </strong>
              </div>
            );
          })
        )}
      </Panel>

      <Notice icon="💡">
        {t('lab2.challenges.notice')}
      </Notice>
    </div>
  );
}
