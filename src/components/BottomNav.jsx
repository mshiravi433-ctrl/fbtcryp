import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import MoreSheet from './MoreSheet';
import {
  AnimatedActivity,
  AnimatedPlus,
  AnimatedSwap,
  AnimatedWallet,
  useStill
} from './AnimatedIcon';
import SegIndicator from './SegIndicator';

/**
 * Bottom navigation.
 *
 * The icons animate their own geometry now rather than being scaled whole by
 * the parent — arrows travel, the activity trace redraws, the wallet flap
 * opens. `AnimatedIcon` explains why that needs SVG and how it is switched off
 * for anyone who has asked for reduced motion.
 *
 * The tab keeps a short "pop" on selection because that is feedback for a tap
 * the user just made. Nothing here loops: a permanently animating nav bar
 * competes with the live prices, which are the thing that should be pulling
 * the eye.
 */
const ITEMS = [
  { to: '/swap', key: 'nav.swap', Icon: AnimatedSwap },
  { to: '/signals', key: 'nav.signals', Icon: AnimatedActivity },
  { to: '/wallet', key: 'nav.wallet', Icon: AnimatedWallet }
];

export default function BottomNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { haptic } = useTelegram();
  const [moreOpen, setMoreOpen] = useState(false);
  const still = useStill();

  // Bumped on every tap so re-tapping the tab you are already on replays the
  // icon animation. Without it, the second tap does nothing visible and feels
  // like a dropped input.
  const [pulse, setPulse] = useState(0);

  /**
   * Exactly one destination owns the highlight at a time.
   *
   * While the drawer is open it takes the highlight; otherwise the current
   * route has it. Computing it in one place is what guarantees the layoutId
   * is unique, rather than relying on two independent booleans never being
   * true together — which is precisely how the twitch happened.
   */
  const activeGlow = moreOpen ? '__more' : ITEMS.some((i) => i.to === pathname) ? pathname : null;

  return (
    <>
      <nav className="bottom-nav">
        {ITEMS.map((item) => {
          const active = pathname === item.to;
          return (
            <motion.button
              key={item.to}
              className={`nav-item ${active ? 'active' : ''}`}
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                haptic?.('light');
                setPulse((n) => n + 1);
                navigate(item.to);
              }}
            >
              {/*
                THE JITTER BUG.
                This used to share `layoutId="nav-glow"` with the More button.
                When the drawer opened, BOTH elements existed with the same
                layoutId for a frame, so Framer Motion tried to animate one
                shared element between two positions at once and the highlight
                visibly twitched. A layoutId must be unique among mounted
                elements at any instant — the highlight is now driven by
                `activeGlow`, which can only ever match one of them.
              */}
              {activeGlow === item.to && (
                <SegIndicator
                  id="nav-glow"
                  className="nav-glow"
                  transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                />
              )}

              <motion.span
                className="nav-icon"
                animate={
                  active && !still
                    ? { scale: [1, 1.22, 1.1], y: [0, -4, -2] }
                    : { scale: 1, y: 0 }
                }
                transition={
                  active
                    ? { duration: 0.46, times: [0, 0.55, 1], ease: [0.34, 1.56, 0.64, 1] }
                    : { type: 'spring', stiffness: 420, damping: 22 }
                }
              >
                {/* Remounting on `pulse` restarts the path animations, which
                    is what makes a repeat tap feel responsive. */}
                <item.Icon
                  key={`${item.to}-${active ? pulse : 'off'}`}
                  active={active}
                  still={still}
                  width={21}
                  height={21}
                  strokeWidth={active ? 2.05 : 1.7}
                />
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
          whileTap={{ scale: 0.9 }}
          onClick={() => {
            haptic?.('light');
            setMoreOpen(true);
          }}
        >
          {activeGlow === '__more' && (
            <SegIndicator
              id="nav-glow"
              className="nav-glow"
              transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            />
          )}
          <motion.span
            className="nav-icon"
            animate={moreOpen && !still ? { scale: 1.14 } : { scale: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 17 }}
          >
            <AnimatedPlus active={moreOpen} still={still} width={21} height={21} />
          </motion.span>
          <span>{t('nav.more')}</span>
        </motion.button>
      </nav>

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
