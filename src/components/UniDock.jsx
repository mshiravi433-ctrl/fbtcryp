import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import {
  AnimatedAgent,
  AnimatedMarket,
  AnimatedSwap,
  AnimatedWallet,
  useStill
} from './AnimatedIcon';
import '../styles/uni-dock.css';

/**
 * THE UNISWAP-STYLE DOCK — Farm / Loan / Protection / Auto Orders only.
 * ---------------------------------------------------------------------------
 * Reference the owner sent: the Uniswap Wallet bottom bar — one white glass
 * pill, icons side by side with generous spacing, the active one filled
 * solid, and a saturated round button for the primary action.
 *
 *   «فوتر شبیه والت یونی‌سواپ یعنی چهار آیکون کنار هم با فاصله، یک آیکون
 *    برای هوش مصنوعی»
 *
 * Four icons, evenly spaced, one of them the AI:
 *
 *   · Market  (/)        — the home of the app
 *   · Swap    (/swap)    — the primary action
 *   · Wallet  (/wallet)  — the assets
 *   · AI      (/intent)  — Intent OS, in the saturated RGB circle
 *
 * The AI circle is the pink circle in the reference, re-tinted to the app's
 * own RGB palette (the same two-stop calm gradient the centre droplet uses
 * in BottomNav — a busy ramp on a 40px disc is noise). It is always filled,
 * active or not, so the eye finds the brain without reading labels.
 *
 * ICON-ONLY, like the reference. No text under the glyphs: at 22px in a
 * 64px pill a label is either illegible or forces the pill taller, and the
 * four destinations are the four the user already knows. Every button still
 * carries its full name for screen readers (`aria-label` + visually hidden
 * text) and as a `title`.
 *
 * This component is route-scoped by AppChrome: it replaces BottomNav on
 * exactly four sections and is never mounted anywhere else, so the global
 * nav's shape (and its tests) are untouched.
 */
const ITEMS = [
  { to: '/', key: 'nav.market', Icon: AnimatedMarket },
  { to: '/swap', key: 'nav.swap', Icon: AnimatedSwap },
  { to: '/wallet', key: 'nav.wallet', Icon: AnimatedWallet },
  { to: '/intent', key: 'nav.intentOS', Icon: AnimatedAgent, ai: true }
];

export default function UniDock({ hidden = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { haptic } = useTelegram();
  const still = useStill();

  /* Bumped on every tap so re-tapping the tab you are already on replays the
     icon animation — same contract as BottomNav, for the same reason: a
     second tap that does nothing visible reads as a dropped input. */
  const [pulse, setPulse] = useState(0);

  return (
    <nav
      className="uni-dock"
      data-hidden={hidden ? 'true' : 'false'}
      aria-label={t('nav.mainNav')}
    >
      {ITEMS.map((item) => {
        const active = pathname === item.to;
        return (
          <motion.button
            key={item.to}
            type="button"
            className={`uni-dock__item${active ? ' is-active' : ''}${item.ai ? ' uni-dock__item--ai' : ''}`}
            whileTap={{ scale: 0.9 }}
            aria-label={t(item.key)}
            aria-current={active ? 'page' : undefined}
            title={t(item.key)}
            onClick={() => {
              haptic?.(item.ai ? 'medium' : 'light');
              setPulse((n) => n + 1);
              navigate(item.to);
            }}
          >
            <span className="uni-dock__icon" aria-hidden="true">
              <item.Icon
                key={`${item.to}-${active ? pulse : 'off'}`}
                active={active}
                still={still}
                width={22}
                height={22}
                strokeWidth={active ? 2.05 : 1.7}
              />
            </span>
            <span className="uni-dock__sr">{t(item.key)}</span>
          </motion.button>
        );
      })}
    </nav>
  );
}
