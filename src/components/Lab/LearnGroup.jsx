/**
 * LEARN group — Challenges · Lessons · Risk Trainer.
 * The "think" tier. Bite-sized, scenario-driven, no charts to read.
 */
import { useTranslation } from 'react-i18next';
import Challenges from './Challenges';
import Lesson from './Lesson';
import RiskTrainer from './RiskTrainer';

const CARDS = [
  {
    id: 'challenges',
    icon: '🎯',
    title: 'Challenges',
    sub: 'Market scenarios',
    glow: 'magenta',
    Component: Challenges
  },
  {
    id: 'lessons',
    icon: '🧠',
    title: 'Lessons',
    sub: 'Learn by doing',
    glow: 'amber',
    Component: Lesson
  },
  {
    id: 'risk',
    icon: '🛡️',
    title: 'Risk Trainer',
    sub: 'Size, stop, R:R',
    glow: 'cyan',
    Component: RiskTrainer
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
        {t('lab2.learn', 'Learn')}
      </div>
      <div className="lab2-grid">
        {CARDS.map((card) => (
          <button
            key={card.id}
            className="lab2-card"
            onClick={() => onSelectChild(card.id)}
            aria-label={card.title}
          >
            <div className={`lab2-card-glow ${card.glow}`} />
            <div className="lab2-card-icon">{card.icon}</div>
            <div className="lab2-card-title">{card.title}</div>
            <div className="lab2-card-sub">{card.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
