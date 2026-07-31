import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { lockBodyScroll } from '../lib/scrollLock';
import { useTelegram } from '../context/TelegramContext';
import { GAMES_ENABLED } from '../lib/features';
import { useStill } from './AnimatedIcon';
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
  IconX,
  IconSearch,
  IconSparkle,
  IconClock,
  IconWallet
} from './Icons';

/**
 * The "More" drawer.
 *
 * WHY THE ANIMATION WAS JITTERY — and what changed
 * ---------------------------------------------------------------------------
 * The first version tried to be clever and paid for it on real hardware. On
 * open it ran, all at once:
 *
 *   • the panel animating `scale` 0.93 → 1
 *   • 18 tiles each with their own spring on opacity/y/scale
 *   • 18 icon wrappers with a second spring
 *   • hand-authored SVG icons animating `pathLength` on 2-4 paths each
 *
 * That is roughly 90 simultaneous animations, most of them on SVG geometry,
 * inside a parent that was itself scaling. Two things make that specifically
 * bad rather than merely heavy:
 *
 *   1. Animating `scale` on a parent forces the browser to re-rasterise every
 *      descendant on every frame. Normally cheap; not with 18 clip-paths and
 *      dozens of animating SVG paths inside.
 *   2. `pathLength` is not a compositor property. Each step runs on the main
 *      thread, so they compete with React's own render work during the exact
 *      frames the panel is moving.
 *
 * The fix is to stop asking for so much:
 *   • The panel fades and slides (opacity + y). No scale, so children are not
 *     re-rasterised mid-flight.
 *   • Tiles fade in as ONE group via a CSS animation on the grid, not 18
 *     independent springs.
 *   • Icons are static during the open. They still animate on tap, which is
 *     the moment feedback actually means something.
 *
 * The result reads as one deliberate motion instead of a swarm, and it costs
 * a fraction of the frames. That is the better design as well as the faster
 * one — a menu that explodes into 18 separately-springing tiles is noise.
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
      { to: '/explore', key: 'nav.explore', Icon: IconSearch, hue: 'var(--rgb-4)' },
      { to: '/discover', key: 'nav.discover', Icon: IconGlobe, hue: 'var(--rgb-2)' },
      { to: '/buy', key: 'nav.buy', Icon: IconWallet, hue: 'var(--rgb-2)' },
      { to: '/orders', key: 'nav.orders', Icon: IconClock, hue: 'var(--rgb-1)' },
      { to: '/nft', key: 'nav.nft', Icon: IconSparkle, hue: 'var(--rgb-3)' },
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
  const still = useStill();
  const [pressed, setPressed] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const unlock = lockBodyScroll();
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => {
      unlock();
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Reset the tap highlight when the drawer closes, or the same tile would
  // still look pressed the next time it opens.
  useEffect(() => {
    if (!open) setPressed(null);
  }, [open]);

  const go = (to) => {
    haptic?.('light');
    setPressed(to);
    // Let the tap feedback land before the route swaps under the finger.
    // 90ms is below the ~100ms threshold where a delay becomes perceptible as
    // lag, but long enough for the press state to be seen.
    setTimeout(() => {
      navigate(to);
      onClose?.();
    }, 90);
  };

  // Portalled for the same reason as Sheet: a transformed ancestor becomes the
  // containing block for `position: fixed`, so a drawer rendered inside an
  // animated page centres itself against the page box rather than the screen.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
          />
          <div className="more-layer">
            <motion.div
              className="more-panel"
              /*
               * opacity + y only. No `scale`: scaling this parent re-rasterises
               * every tile, clip-path and icon underneath it on every frame,
               * which is what produced the stutter. A tween rather than a
               * spring so the duration is bounded and predictable.
               */
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: still ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="row-between" style={{ marginBottom: 14 }}>
                <h2 className="h2" style={{ margin: 0 }}>{t('nav.more')}</h2>
                <button className="sheet-close" onClick={onClose} aria-label="close" type="button">
                  <IconX width={15} height={15} />
                </button>
              </div>

              {GROUPS.map((g, gi) => (
                <div key={g.id} className="more-group">
                  <p className="section-label" style={{ marginBottom: 9 }}>
                    {t(`nav.group.${g.id}`)}
                  </p>

                  {/*
                    One CSS animation per GROUP (three total) instead of one
                    spring per tile (eighteen). The stagger between groups is
                    enough to read as sequenced; per-tile stagger was invisible
                    at this size and cost the most frames.
                  */}
                  <div
                    className="more-grid"
                    style={still ? undefined : { animationDelay: `${gi * 60}ms` }}
                    data-still={still ? 'true' : 'false'}
                  >
                    {g.items.map((item) => (
                      <button
                        key={item.to + item.key}
                        type="button"
                        className="more-tile"
                        data-pressed={pressed === item.to ? 'true' : 'false'}
                        onClick={() => go(item.to)}
                      >
                        <span
                          className="more-tile-icon"
                          style={{
                            color: item.hue,
                            borderColor: `color-mix(in srgb, ${item.hue} 40%, transparent)`
                          }}
                        >
                          <item.Icon width={19} height={19} />
                        </span>
                        <span className="more-tile-label">{t(item.key)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
