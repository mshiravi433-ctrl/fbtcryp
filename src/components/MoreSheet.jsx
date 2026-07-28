import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import { GAMES_ENABLED } from '../lib/features';
import {
  IconActivity,
  IconBuilding,
  IconDoc,
  IconGlobe,
  IconInfo,
  IconKey,
  IconMarket,
  IconNews,
  IconPools,
  IconSettings,
  IconShield,
  IconSwap,
  IconTrend,
  IconTrophy,
  IconX
} from './Icons';

/**
 * The "More" drawer.
 *
 * The nav can hold five items comfortably; everything else lives here in a
 * grid that staggers in. Grouped by intent rather than alphabetically, so
 * people scan by what they're trying to do.
 */
const GROUPS = [
  {
    id: 'markets',
    items: [
      { to: '/', key: 'nav.market', Icon: IconMarket, hue: 'var(--rgb-1)' },
      { to: '/perp', key: 'nav.perp', Icon: IconTrend, hue: 'var(--rgb-3)' },
      { to: '/stocks', key: 'nav.stocks', Icon: IconBuilding, hue: 'var(--rgb-5)' },
      { to: '/predict', key: 'nav.predict', Icon: IconActivity, hue: 'var(--rgb-8)' },
      { to: '/p2p', key: 'nav.p2p', Icon: IconSwap, hue: 'var(--rgb-6)' }
    ]
  },
  {
    id: 'earn',
    items: [
      { to: '/farm', key: 'nav.farm', Icon: IconPools, hue: 'var(--rgb-4)' },
      ...(GAMES_ENABLED ? [{ to: '/play', key: 'nav.play', Icon: IconActivity, hue: 'var(--rgb-2)' }] : []),
      { to: '/earn', key: 'nav.earn', Icon: IconGlobe, hue: 'var(--rgb-7)' },
      { to: '/leaderboard', key: 'nav.leaderboard', Icon: IconTrophy, hue: 'var(--rgb-5)' },
      { to: '/invest', key: 'nav.invest', Icon: IconTrend, hue: 'var(--rgb-6)' }
    ]
  },
  {
    id: 'more',
    items: [
      { to: '/news', key: 'nav.news', Icon: IconNews, hue: 'var(--rgb-1)' },
      { to: '/help', key: 'nav.help', Icon: IconInfo, hue: 'var(--rgb-9)' },
      { to: '/docs', key: 'nav.docs', Icon: IconDoc, hue: 'var(--rgb-1)' },
      { to: '/audit', key: 'nav.audit', Icon: IconShield, hue: 'var(--rgb-4)' },
      { to: '/developers', key: 'nav.developers', Icon: IconKey, hue: 'var(--rgb-2)' },
      { to: '/ecosystem', key: 'nav.ecosystem', Icon: IconGlobe, hue: 'var(--rgb-3)' },
      { to: '/business', key: 'nav.business', Icon: IconBuilding, hue: 'var(--rgb-5)' },
      { to: '/about', key: 'nav.about', Icon: IconInfo, hue: 'var(--rgb-8)' },
      { to: '/settings', key: 'nav.settings', Icon: IconSettings, hue: 'var(--rgb-6)' }
    ]
  }
];

export default function MoreSheet({ open, onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const go = (to) => {
    haptic?.('light');
    navigate(to);
    onClose?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <div className="more-layer">
            <motion.div
              className="more-panel"
              initial={{ opacity: 0, scale: 0.93, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
            <div className="row-between" style={{ marginBottom: 14 }}>
              <h2 className="h2" style={{ margin: 0 }}>{t('nav.more')}</h2>
              <button className="sheet-close" onClick={onClose} aria-label="close" type="button">
                <IconX width={15} height={15} />
              </button>
            </div>

            {GROUPS.map((g, gi) => (
              <div key={g.id} style={{ marginBottom: 16 }}>
                <p className="section-label" style={{ marginBottom: 9 }}>{t(`nav.group.${g.id}`)}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 9 }}>
                  {g.items.map((item, i) => (
                    <motion.button
                      key={item.to + item.key}
                      className="more-tile"
                      initial={{ opacity: 0, y: 16, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{
                        delay: gi * 0.05 + i * 0.035,
                        type: 'spring',
                        stiffness: 420,
                        damping: 26
                      }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => go(item.to)}
                    >
                      <motion.span
                        className="more-tile-icon"
                        style={{ color: item.hue, borderColor: `color-mix(in srgb, ${item.hue} 40%, transparent)` }}
                        whileHover={{ rotate: 6 }}
                      >
                        <item.Icon width={19} height={19} />
                      </motion.span>
                      <span className="more-tile-label">{t(item.key)}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            ))}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
