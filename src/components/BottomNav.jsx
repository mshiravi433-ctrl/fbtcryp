import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';

const ITEMS = [
  { to: '/', key: 'nav.market', icon: '📊' },
  { to: '/swap', key: 'nav.swap', icon: '🔄' },
  { to: '/irt', key: 'nav.irt', icon: '🇮🇷' },
  { to: '/play', key: 'nav.play', icon: '🎮' },
  { to: '/earn', key: 'nav.earn', icon: '🎁' },
  { to: '/wallet', key: 'nav.wallet', icon: '👛' }
];

export default function BottomNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { haptic } = useTelegram();

  return (
    <nav className="bottom-nav">
      {ITEMS.map((item) => {
        const active = pathname === item.to;
        return (
          <button
            key={item.to}
            className={`nav-item ${active ? 'active' : ''}`}
            onClick={() => {
              haptic?.('light');
              navigate(item.to);
            }}
          >
            {active && (
              <motion.span
                layoutId="nav-glow"
                className="nav-glow"
                transition={{ type: 'spring', stiffness: 460, damping: 34 }}
              />
            )}
            <motion.span
              className="nav-icon"
              animate={active ? { scale: 1.16, y: -1 } : { scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 20 }}
            >
              {item.icon}
            </motion.span>
            <span>{t(item.key)}</span>
          </button>
        );
      })}
    </nav>
  );
}
