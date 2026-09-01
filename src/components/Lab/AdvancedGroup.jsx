/**
 * ADVANCED group — Strategy Lab · DeFi Sim · What-If.
 * The "build" tier. Strategy Lab is the flagship; it has a backtest
 * engine and is the screen people will remember.
 */
import { useTranslation } from 'react-i18next';
import StrategyLab from './StrategyLab';
import DeFiSim from './DeFiSim';
import WhatIf from './WhatIf';

const CARDS = [
  {
    id: 'strategy',
    icon: '🧪',
    title: 'Strategy Lab',
    sub: 'Build & backtest',
    glow: 'violet',
    Component: StrategyLab
  },
  {
    id: 'defi',
    icon: '🏦',
    title: 'DeFi Lab',
    sub: 'LP, stake, borrow',
    glow: 'mint',
    Component: DeFiSim
  },
  {
    id: 'whatif',
    icon: '🧩',
    title: 'What-If?',
    sub: 'Scenario explorer',
    glow: 'magenta',
    Component: WhatIf
  }
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
      <div className="lab2-group-title">
        <span className="lab2-group-emoji">🚀</span>
        {t('lab2.advanced', 'Advanced')}
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
