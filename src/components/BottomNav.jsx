import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const TABS = [
  { to: '/', icon: '🏠', key: 'home' },
  { to: '/analysis', icon: '📊', key: 'analysis' },
  { to: '/trade', icon: '💹', key: 'trade' },
  { to: '/portfolio', icon: '📈', key: 'portfolio' }
];

export default function BottomNav() {
  const { t } = useTranslation();
  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">{tab.icon}</span>
          <span>{t(`nav.${tab.key}`)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
