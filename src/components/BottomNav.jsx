import { Fragment, useState } from 'react';
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
/**
 * FOUR tabs, two either side of the raised centre button.
 *
 * The centre action is NOT in this list. It is a separate element rendered
 * between index 1 and 2 so it can break out of the bar's own height — a
 * button that sits inside the row cannot overlap its top edge, which is the
 * whole visual point.
 */
const ITEMS = [
  { to: '/swap', key: 'nav.swap', Icon: AnimatedSwap },
  { to: '/signals', key: 'nav.signals', Icon: AnimatedActivity },
  { to: '/wallet', key: 'nav.wallet', Icon: AnimatedWallet }
];

/**
 * The centre action. Buy is the single thing we most want a new user to do,
 * and it is the one route that earns nothing until they reach it — so it gets
 * the most prominent control on the screen.
 */
const CENTRE = { to: '/buy', key: 'nav.buy' };

/**
 * The droplet.
 *
 * ─── WHY THE SHAPE IS A BORDER-RADIUS AND NOT AN SVG ────────────────────────
 * A teardrop is three round corners and one sharp-ish one, which
 * `border-radius: 50% 50% 50% 12px` expresses exactly. Doing it in CSS means
 * it inherits the gradient, the glow and the press animation for free, and
 * costs zero bytes of SVG. An `<svg>` path would need its own fill, its own
 * filter for the glow, and would not round the tap target.
 *
 * ─── WHY IT DOES NOT LOOP ───────────────────────────────────────────────────
 * The bar already has a 12s float. A second permanent animation on the most
 * saturated element on screen is what makes an interface feel busy rather
 * than alive — and it competes with the live prices, which are the thing that
 * should be pulling the eye. It animates on PRESS only.
 */
function CentreAction({ active, still, label, onClick }) {
  return (
    <motion.button
      className={`nav-centre ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-label={label}
      whileTap={still ? undefined : { scale: 0.88 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
    >
      <span className="nav-centre-drop" aria-hidden="true" />
      <span className="nav-centre-glyph" aria-hidden="true">
        {/*
          A FILLED glyph, not a stroked one.

          The reference the owner sent uses solid icons inside the indicator,
          and there is a reason beyond taste: on a 44px circle of flat colour,
          a 2px stroke is a thin light line on a saturated field and reads as
          faint. A filled shape holds its weight at that size.

          Also 18px rather than 20: the smaller the glyph relative to the
          circle, the more the circle reads as a deliberate accent rather
          than a button that happens to have an icon in it.
        */}
        {/*
          The glyph must match the DESTINATION. This button goes to Buy &
          sell, so it is a filled plus — the universal "add funds" mark. A
          home icon here (my first attempt) would have been a control whose
          picture and behaviour disagreed, which is the same class of bug as
          a mislabelled button.
        */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M13.4 3.6a1.4 1.4 0 0 0-2.8 0v7h-7a1.4 1.4 0 0 0 0 2.8h7v7a1.4 1.4 0 0 0 2.8 0v-7h7a1.4 1.4 0 0 0 0-2.8h-7Z" />
        </svg>
      </span>
    </motion.button>
  );
}

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
        {ITEMS.map((item, idx) => {
          const active = pathname === item.to;
          const tab = (
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

          /*
           * ─── THE GAP THE DROPLET SITS IN ───────────────────────────────
           * A zero-content spacer, not the button. The button itself is a
           * SIBLING of the bar (rendered below), because the bar is masked
           * to cut a notch out of itself — and a mask clips every descendant,
           * so a button inside the bar would be sliced in half by the very
           * notch meant to frame it.
           *
           * This spacer reserves the horizontal room so the four tabs space
           * themselves evenly around the hole instead of sliding under it.
           */
          if (idx !== 1) return tab;
          return (
            <Fragment key={item.to}>
              {tab}
              <span className="nav-notch-gap" aria-hidden="true" />
            </Fragment>
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

      {/*
        OUTSIDE the <nav>, deliberately.

        The bar carries a `mask` that punches a circular notch out of its own
        top edge. A mask clips the element AND everything inside it, so a
        button rendered as a child would be cut by the notch it is supposed
        to sit in. As a sibling it floats free, casts its own shadow into the
        hollow, and reads as a separate droplet — which is the whole point.
      */}
      <CentreAction
        active={pathname === CENTRE.to}
        still={still}
        label={t(CENTRE.key)}
        onClick={() => {
          haptic?.('medium');
          setPulse((n) => n + 1);
          navigate(CENTRE.to);
        }}
      />

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
