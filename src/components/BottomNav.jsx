import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import { IconSwap, IconTrend, IconActivity, IconPools, IconWallet } from './Icons';

const ITEMS = [
  { to: '/swap', key: 'nav.swap', Icon: IconSwap },
  { to: '/trade', key: 'nav.trade', Icon: IconTrend },
  { to: '/signals', key: 'nav.signals', Icon: IconActivity },
  { to: '/farm', key: 'nav.farm', Icon: IconPools },
  { to: '/wallet', key: 'nav.wallet', Icon: IconWallet }
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
              style={{ display: 'grid', placeItems: 'center' }}
              animate={active ? { scale: 1.12, y: -1 } : { scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 20 }}
            >
              <item.Icon width={21} height={21} strokeWidth={active ? 2 : 1.7} />
            </motion.span>
            <span>{t(item.key)}</span>
          </button>
        );
      })}
    </nav>
  );
}
