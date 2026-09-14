/**
 * ADVANCED group — Strategy Lab · DeFi Sim · What-If.
 * The "build" tier. Strategy Lab is the flagship; it has a backtest
 * engine and is the screen people will remember.
 */
import { useTranslation } from 'react-i18next';
import { LabCard } from './Shared';
import { LabIcon } from './LabIcons';
import StrategyLab from './StrategyLab';
import DeFiSim from './DeFiSim';
import WhatIf from './WhatIf';

/**
 * The registry for this tab: which simulator each card opens.
 *
 * Exported (not just module-local) because `test/lab-screens.test.jsx` walks it
 * to mount every child route. Deriving the test's list from the same array the
 * UI renders from is what stops a new simulator from shipping un-routed — a
 * hardcoded list in the test would silently skip it.
 */
export const CARDS = [
  { id: 'strategy', icon: 'atom', accent: 'violet', Component: StrategyLab },
  { id: 'defi', icon: 'bank', accent: 'mint', Component: DeFiSim },
  { id: 'whatif', icon: 'puzzle', accent: 'magenta', Component: WhatIf }
];

export default function AdvancedGroup({ activeChild, onSelectChild }) {
  const { t } = useTranslation();

  if (activeChild) {
    const card = CARDS.find((c) => c.id === activeChild);
    if (!card) return null;
    const Child = card.Component;
    return <Child onBack={() => onSelectChild(null)} />;
  }

  return (
    <div className="lab2-group">
      <div className="lab2-group-title acc-magenta">
        <span className="lab2-group-icon" aria-hidden="true">
          <LabIcon name="rocket" width={15} height={15} />
        </span>
        {t('lab2.advanced')}
      </div>
      <div className="lab2-grid">
        {CARDS.map((card, i) => (
          <LabCard
            key={card.id}
            icon={card.icon}
            accent={card.accent}
            index={i}
            title={t(`lab2.cards.${card.id}.title`)}
            sub={t(`lab2.cards.${card.id}.sub`)}
            onClick={() => onSelectChild(card.id)}
          />
        ))}
      </div>
    </div>
  );
}
