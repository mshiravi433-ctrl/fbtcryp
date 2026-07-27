import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import MoreSheet from './MoreSheet';
import { IconSwap, IconActivity, IconWallet, IconPlus } from './Icons';

const ITEMS = [
  { to: '/swap', key: 'nav.swap', Icon: IconSwap },
  { to: '/signals', key: 'nav.signals', Icon: IconActivity },
  { to: '/wallet', key: 'nav.wallet', Icon: IconWallet }
];

export default function BottomNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { haptic } = useTelegram();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
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
      <button
        className={`nav-item ${moreOpen ? 'active' : ''}`}
        data-more="true"
        data-open={moreOpen}
        onClick={() => {
          haptic?.('light');
          setMoreOpen(true);
        }}
      >
        {moreOpen && (
          <motion.span
            layoutId="nav-glow"
            className="nav-glow"
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
          />
        )}
        <motion.span
          className="nav-icon"
          style={{ display: 'grid', placeItems: 'center' }}
          animate={moreOpen ? { scale: 1.12, rotate: 45 } : { scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 20 }}
        >
          <IconPlus width={21} height={21} strokeWidth={moreOpen ? 2 : 1.7} />
        </motion.span>
        <span>{t('nav.more')}</span>
      </button>
    </nav>

    <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
