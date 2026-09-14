/**
 * Market Challenges — what would you do if BTC just dropped 18%?
 * Pick an answer, the system explains the consequences.
 *
 * VISUAL PASS: scenario pickers are sliding-pill chips with an SVG per
 * scenario; the market impact is a row of red/green shock pills; the reveal is
 * a `ResultCard` whose headline is the signed percentage, so the outcome is
 * legible before the explanation is read.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { LAB_EASE, LabBack, LabChips, Notice, Panel, ResultCard } from './Shared';
import { IconArrowDown, IconArrowUp, LabIcon } from './LabIcons';
import { SCENARIOS } from '../../lib/lab/scenarios';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const OUTCOME_KIND = {
  smart: 'win', win: 'win', survive: 'win', late: 'loss', loss: 'loss',
  panic: 'loss', risky: 'win', patient: 'win', disciplined: 'win',
  safe: 'win', pain: 'loss', partial: 'win'
};

/* The scenario table carries an emoji from the data file. Mapping the ids to
   the Lab icon registry keeps the data file untouched and the UI consistent —
   an unknown scenario falls back to `alert` rather than to a missing glyph. */
const SCENARIO_ICON = {
  'crash-30': 'alert',
  'bull-25': 'rocket',
  'defi-hack': 'lock',
  'rates-hike': 'bank',
  liquidation: 'flame'
};

const GOOD_OUTCOMES = ['smart', 'win', 'survive', 'disciplined', 'safe', 'partial', 'patient', 'risky'];

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
  const doneIds = new Set(completed.map((c) => c.scenarioId));

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

  const scenarioChips = SCENARIOS.map((s) => ({
    id: s.id,
    label: t(`lab2.scenarios.${s.id}.short`),
    icon: SCENARIO_ICON[s.id] ?? 'alert',
    tick: doneIds.has(s.id)
  }));

  const good = chosen ? GOOD_OUTCOMES.includes(chosen.outcome) : false;

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        icon="target"
        accent="magenta"
        title={t('lab2.screens.challenges.title')}
        sub={t('lab2.screens.challenges.sub')}
      />

      <Panel title={t('lab2.challenges.chooseScenario')} icon="layers" accent="magenta">
        <LabChips
          items={scenarioChips}
          value={activeId}
          layoutId="challenge-scenario"
          accent="magenta"
          onChange={(id) => { setActiveId(id); reset(); }}
        />
      </Panel>

      <Panel
        title={t(`lab2.scenarios.${active.id}.title`)}
        icon={SCENARIO_ICON[active.id] ?? 'alert'}
        accent="rose"
      >
        <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.75 }}>
          {t(`lab2.scenarios.${active.id}.teaser`)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 2 }}>
          {active.shocks.map((s) => (
            <motion.span
              key={s.coin}
              className={`lab2-shock ${s.pct > 0 ? 'up' : s.pct < 0 ? 'down' : 'flat'} lab2-num`}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.32, ease: LAB_EASE }}
            >
              {s.pct > 0 ? <IconArrowUp width={11} height={11} /> : s.pct < 0 ? <IconArrowDown width={11} height={11} /> : null}
              {s.coin} {s.pct > 0 ? '+' : ''}{s.pct}%
            </motion.span>
          ))}
        </div>
      </Panel>

      <Panel title={t('lab2.challenges.whatDoYouDo')} icon="brain" accent="violet">
        <div className="lab2-choices">
          {active.choices.map((c, i) => (
            <motion.button
              key={c.id}
              type="button"
              className={`lab2-choice ${selectedChoice === c.id ? 'selected' : ''}`}
              onClick={() => handleChoice(c)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.34, ease: LAB_EASE, delay: i * 0.05 }}
            >
              {t(`lab2.scenarios.${active.id}.choices.${c.id}.label`)}
            </motion.button>
          ))}
        </div>
      </Panel>

      <AnimatePresence mode="wait">
        {revealed && chosen && (
          <motion.div
            key={`reveal-${active.id}-${chosen.id}`}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: LAB_EASE }}
          >
            <ResultCard
              kind={good ? 'win' : 'loss'}
              icon={good ? 'brain' : 'alert'}
              figure={`${chosen.impact > 0 ? '+' : ''}${chosen.impact}%`}
              title={t('lab2.challenges.yourPortfolio')}
              sub={t(`lab2.scenarios.${active.id}.choices.${chosen.id}.lesson`)}
            >
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="lab2-btn ghost" type="button" onClick={reset}>
                  <LabIcon name="refresh" width={15} height={15} />
                  {t('lab2.tryAgain')}
                </button>
                <button className="lab2-btn primary" type="button" onClick={nextScenario}>
                  {t('lab2.nextScenario')}
                  <span className="lab2-arrow">
                    <LabIcon name="next" width={15} height={15} />
                  </span>
                </button>
              </div>
            </ResultCard>
          </motion.div>
        )}
      </AnimatePresence>

      <Panel title={t('lab2.challenges.yourHistory')} icon="clock" accent="cyan">
        {completed.length === 0 ? (
          <div className="lab2-muted" style={{ textAlign: 'center', padding: 10 }}>
            {t('lab2.challenges.noChallengesYet')}
          </div>
        ) : (
          completed.slice(0, 5).map((c) => {
            const sc = SCENARIOS.find((s) => s.id === c.scenarioId);
            const ch = sc?.choices.find((x) => x.id === c.choiceId);
            return (
              <div key={c.id} className="lab2-row">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <LabIcon name={SCENARIO_ICON[c.scenarioId] ?? 'alert'} width={14} height={14} />
                  {sc ? t(`lab2.scenarios.${sc.id}.title`) : c.scenarioId}
                </span>
                <strong className={c.outcome === 'win' ? 'pos' : c.outcome === 'loss' ? 'neg' : ''}>
                  <span className="lab2-num">{ch?.impact > 0 ? '+' : ''}{ch?.impact}%</span>
                </strong>
              </div>
            );
          })
        )}
      </Panel>

      <Notice variant="tip" icon="bulb">
        {t('lab2.challenges.notice')}
      </Notice>
    </div>
  );
}
