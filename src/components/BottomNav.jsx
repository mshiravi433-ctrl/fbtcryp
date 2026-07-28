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
          <motion.button
            key={item.to}
            className={`nav-item ${active ? 'active' : ''}`}
            whileTap={{ scale: 0.88 }}
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
              animate={
                active
                  ? { scale: [1, 1.28, 1.14], y: [-1, -5, -2], rotate: [0, -7, 0] }
                  : { scale: 1, y: 0, rotate: 0 }
              }
              transition={
                active
                  ? { duration: 0.5, times: [0, 0.55, 1], ease: [0.34, 1.56, 0.64, 1] }
                  : { type: 'spring', stiffness: 420, damping: 22 }
              }
            >
              <item.Icon width={21} height={21} strokeWidth={active ? 2.1 : 1.7} />
            </motion.span>
            <motion.span
              animate={active ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0.75, y: 1, scale: 0.94 }}
              transition={{ duration: 0.22 }}
            >
              {t(item.key)}
            </motion.span>
          </motion.button>
        );
      })}
      <motion.button
        className={`nav-item ${moreOpen ? 'active' : ''}`}
        data-more="true"
        data-open={moreOpen}
        whileTap={{ scale: 0.88 }}
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
          animate={moreOpen ? { scale: 1.16, rotate: 135 } : { scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 17 }}
        >
          <IconPlus width={21} height={21} strokeWidth={moreOpen ? 2.1 : 1.7} />
        </motion.span>
        <span>{t('nav.more')}</span>
      </motion.button>
    </nav>

    <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
