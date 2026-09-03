/**
 * LEARN group — Challenges · Lessons · Risk Trainer.
 * The "think" tier. Bite-sized, scenario-driven, no charts to read.
 */
import { useTranslation } from 'react-i18next';
import Challenges from './Challenges';
import Lesson from './Lesson';
import RiskTrainer from './RiskTrainer';
import Glossary from './Glossary';

const CARDS = [
  {
    id: 'challenges',
    icon: '🎯',
    glow: 'magenta',
    Component: Challenges
  },
  {
    id: 'lessons',
    icon: '🧠',
    glow: 'amber',
    Component: Lesson
  },
  {
    id: 'risk',
    icon: '🛡️',
    glow: 'cyan',
    Component: RiskTrainer
  },
  {
    id: 'glossary',
    icon: '📖',
    glow: 'violet',
    Component: Glossary
  }
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
      <div className="lab2-group-title">
        <span className="lab2-group-emoji">🎓</span>
        {t('lab2.learn')}
      </div>
      <div className="lab2-grid">
        {CARDS.map((card) => (
          <button
            key={card.id}
            className="lab2-card"
            onClick={() => onSelectChild(card.id)}
            aria-label={t(`lab2.cards.${card.id}.title`)}
          >
            <div className={`lab2-card-glow ${card.glow}`} />
            <div className="lab2-card-icon">{card.icon}</div>
            <div className="lab2-card-title">{t(`lab2.cards.${card.id}.title`)}</div>
            <div className="lab2-card-sub">{t(`lab2.cards.${card.id}.sub`)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
