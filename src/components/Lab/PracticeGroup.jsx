/**
 * PRACTICE group — Prediction · Paper Trading · Investment Simulator.
 * The "do" tier. Users spend the most time here, so the cards are
 * large and tappable.
 *
 * The card table is pure data (id, icon name, accent, component). `LabCard`
 * does the markup and the motion, which is why all three group files are now
 * the same twelve lines of JSX apart from this table.
 */
import { useTranslation } from 'react-i18next';
import { LabCard } from './Shared';
import { LabIcon } from './LabIcons';
import PredictionCard from './PredictionCard';
import PaperTrade from './PaperTrade';
import InvestmentSim from './InvestmentSim';
import AppGuide from './AppGuide';

/**
 * The registry for this tab: which simulator each card opens.
 *
 * Exported (not just module-local) because `test/lab-screens.test.jsx` walks it
 * to mount every child route. Deriving the test's list from the same array the
 * UI renders from is what stops a new simulator from shipping un-routed — a
 * hardcoded list in the test would silently skip it.
 */
export const CARDS = [
  { id: 'predict', icon: 'flask', accent: 'violet', Component: PredictionCard },
  { id: 'paper', icon: 'trend', accent: 'cyan', Component: PaperTrade },
  { id: 'invest', icon: 'wallet', accent: 'mint', Component: InvestmentSim },
  /* «راهنمای برنامه»: every area of the app, wallet-connect to finish, one
     illustrated step at a time. It sits in Practice because it is the
     "do" tier's map — the thing you read right before you try it. */
  { id: 'guide', icon: 'book', accent: 'amber', Component: AppGuide }
];

export default function PracticeGroup({ activeChild, onSelectChild }) {
  const { t } = useTranslation();

  if (activeChild) {
    const card = CARDS.find((c) => c.id === activeChild);
    if (!card) return null;
    const Child = card.Component;
    return <Child onBack={() => onSelectChild(null)} />;
  }

  return (
    <div className="lab2-group">
      <div className="lab2-group-title acc-cyan">
        <span className="lab2-group-icon" aria-hidden="true">
          <LabIcon name="bolt" width={15} height={15} />
        </span>
        {t('lab2.practice')}
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
