/**
 * LEARN group — Challenges · Lessons · Risk Trainer · Glossary.
 * The "think" tier. Bite-sized, scenario-driven, no charts to read.
 */
import { useTranslation } from 'react-i18next';
import { LabCard } from './Shared';
import { LabIcon } from './LabIcons';
import Challenges from './Challenges';
import Lesson from './Lesson';
import RiskTrainer from './RiskTrainer';
import Glossary from './Glossary';

/**
 * The registry for this tab: which simulator each card opens.
 *
 * Exported (not just module-local) because `test/lab-screens.test.jsx` walks it
 * to mount every child route. Deriving the test's list from the same array the
 * UI renders from is what stops a new simulator from shipping un-routed — a
 * hardcoded list in the test would silently skip it.
 */
export const CARDS = [
  { id: 'challenges', icon: 'target', accent: 'magenta', Component: Challenges },
  { id: 'lessons', icon: 'brain', accent: 'amber', Component: Lesson },
  { id: 'risk', icon: 'shield', accent: 'cyan', Component: RiskTrainer },
  { id: 'glossary', icon: 'book', accent: 'violet', Component: Glossary }
];

export default function LearnGroup({ activeChild, onSelectChild }) {
  const { t } = useTranslation();

  if (activeChild) {
    const card = CARDS.find((c) => c.id === activeChild);
    if (!card) return null;
    const Child = card.Component;
    return <Child onBack={() => onSelectChild(null)} />;
  }

  return (
    <div className="lab2-group">
      <div className="lab2-group-title acc-amber">
        <span className="lab2-group-icon" aria-hidden="true">
          <LabIcon name="cap" width={15} height={15} />
        </span>
        {t('lab2.learn')}
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
