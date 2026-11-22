import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import { AnimatedAgent, useStill } from './AnimatedIcon';
import { UniFarmIcon, UniLoanIcon, UniShieldIcon, UniOrdersIcon } from './UniDockIcons';
import '../styles/uni-dock.css';

/**
 * THE DOCK FOR THE FOUR-EYES GROUP: Farm · Loan · Protection · Auto Orders.
 * ---------------------------------------------------------------------------
 * The owner's latest instruction, and the reference image behind it:
 *
 *   «منو فوتر برای وام و فارم و بیمه و سفارش … باید سه تا دکمه از این صفحات
 *    باشد و دکمه هوش مصنوعی از این‌ها جدا باشد … ظلع‌ها گرد باشد و شیشه‌ای و
 *    مدرن … بغل صفحه در این صفحات هم دسترسی سریع را محو کن»
 *
 * THE SHAPE OF THE COMPONENT IS THE INSTRUCTION — the AI is *separate*:
 *
 *   [ ● ● ● ]                 ( ● )      ← two independent glass surfaces
 *   the group, 3 slots        the AI
 *
 * Not one four-slot bar. The three section buttons live in their own glass
 * pill; the AI is its own round button, sitting beside it with a real gap,
 * exactly the way the reference's pink circle stands clear of the white bar.
 *
 * WHICH THREE — the pages, not fixed links. On /farm the pill reads
 * Loan · Protection · Orders; on /loan it reads Farm · Protection · Orders;
 * and so on. The four screens are siblings, so the bar always offers the
 * three siblings you are not standing on: every one of the four is exactly
 * one tap away and no slot is ever wasted on the page you are already
 * looking at. (Chosen by the owner when asked which three of the four.)
 *
 * The current page is therefore never "active" inside the pill — nothing is
 * — which is why the pill carries no active fill at all: it is a launcher,
 * not a tab strip. The AI button *does* light up on /intent, because that
 * page is outside the group and its disc is the only stateful control here.
 *
 * The global BottomNav, its notch, its droplet and its 30-assertion probe
 * are untouched: this component is route-scoped by AppChrome and only ever
 * mounts on the four sections above (and their children).
 */
const SECTIONS = [
  { id: 'farm', to: '/farm', key: 'nav.farm', Icon: UniFarmIcon },
  { id: 'loan', to: '/loan', key: 'nav.loan', Icon: UniLoanIcon },
  { id: 'insurance', to: '/insurance', key: 'nav.protection', Icon: UniShieldIcon },
  { id: 'orders', to: '/orders', key: 'nav.orders', Icon: UniOrdersIcon }
];

/** `/orders/history` still belongs to the orders section. */
export function sectionIdOf(pathname) {
  const first = String(pathname || '').split('/')[1] || '';
  const hit = SECTIONS.find((s) => s.id === first);
  return hit ? hit.id : null;
}

export default function UniDock({ hidden = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { haptic } = useTelegram();
  const still = useStill();

  /* Bumped on every tap: the tapped glyph draws itself once, so tapping the
     button you came from replays a short confirmation instead of nothing. */
  const [pulse, setPulse] = useState(0);
  const [pulsed, setPulsed] = useState(null);

  const here = sectionIdOf(pathname);
  const siblings = SECTIONS.filter((s) => s.id !== here);
  const aiActive = String(pathname || '').split('/')[1] === 'intent';

  const go = (to, hapticKind) => {
    haptic?.(hapticKind);
    setPulse((n) => n + 1);
    setPulsed(to);
    navigate(to);
  };

  return (
    <div className="uni-dock" data-hidden={hidden ? 'true' : 'false'}>
      <nav className="uni-dock__group" aria-label={t('nav.mainNav')}>
        {siblings.map((item) => (
          <motion.button
            key={item.to}
            type="button"
            className="uni-dock__item"
            whileTap={{ scale: 0.9 }}
            aria-label={t(item.key)}
            title={t(item.key)}
            onClick={() => go(item.to, 'light')}
          >
            <span className="uni-dock__icon" aria-hidden="true">
              <item.Icon
                key={`${item.to}-${pulsed === item.to ? pulse : 'rest'}`}
                pulse={pulsed === item.to ? pulse : 0}
                still={still}
                width={22}
                height={22}
              />
            </span>
            <span className="uni-dock__sr">{t(item.key)}</span>
          </motion.button>
        ))}
      </nav>

      {/* The AI, deliberately OUTSIDE the group's pill — its own surface. */}
      <motion.button
        type="button"
        className={`uni-dock__ai${aiActive ? ' is-active' : ''}`}
        whileTap={{ scale: 0.92 }}
        aria-label={t('nav.intentOS')}
        aria-current={aiActive ? 'page' : undefined}
        title={t('nav.intentOS')}
        onClick={() => go('/intent', 'medium')}
      >
        <span className="uni-dock__icon" aria-hidden="true">
          <AnimatedAgent
            key={`intent-${aiActive ? pulse : 'off'}`}
            active={aiActive}
            still={still}
            width={22}
            height={22}
            strokeWidth={1.9}
          />
        </span>
        <span className="uni-dock__sr">{t('nav.intentOS')}</span>
      </motion.button>
    </div>
  );
}
