/**
 * PRACTICE group — Prediction · Paper Trading · Investment Simulator.
 * The "do" tier. Users spend the most time here, so the cards are
 * large and tappable.
 */
import { useTranslation } from 'react-i18next';
import PredictionCard from './PredictionCard';
import PaperTrade from './PaperTrade';
import InvestmentSim from './InvestmentSim';

const CARDS = [
  {
    id: 'predict',
    icon: '🔮',
    title: 'Prediction',
    sub: 'Call the next move',
    glow: 'violet',
    Component: PredictionCard
  },
  {
    id: 'paper',
    icon: '📈',
    title: 'Paper Trading',
    sub: 'Trade with virtual money',
    glow: 'cyan',
    Component: PaperTrade
  },
  {
    id: 'invest',
    icon: '💰',
    title: 'Investment Sim',
    sub: 'Build a portfolio',
    glow: 'mint',
    Component: InvestmentSim
  }
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
      <div className="lab2-group-title">
        <span className="lab2-group-emoji">🧪</span>
        {t('lab2.practice', 'Practice')}
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
