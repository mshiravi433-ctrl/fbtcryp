import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import { AnimatedAgent, useStill } from './AnimatedIcon';
import { UniFarmIcon, UniLoanIcon, UniShieldIcon, UniOrdersIcon } from './UniDockIcons';
import '../styles/uni-dock.css';

/**
 * THE DOCK FOR THE FOUR-SCREEN GROUP: Farm · Loan · Insurance · Auto Orders.
 * ---------------------------------------------------------------------------
 * The owner's instructions, in order, and the shape each one produced:
 *
 *  1. «فوتر شبیه والت یونی‌سواپ … چهار ایکون کنار هم … یک ایکون برای هوش
 *     مصنوعی» — a Uniswap-Wallet-style bar.
 *  2. «سه تا دکمه از این صفحات … و دکمه هوش مصنوعی از این‌ها جدا باشد» —
 *     three section buttons in the pill, the AI as its own separate disc.
 *  3. «دکمه محافظت را با بیمه جایگزین کن … و اینکه هر کدوم فعال بود یک
 *     بریدگی خاصی داشته باشد» — the four group screens back INSIDE the pill,
 *     the current one marked with a notch, the AI still standing apart.
 *
 * So the current arrangement is:
 *
 *   [ فارم │ وام │(بیمه)│ سفارش ]      ( AI )
 *                     ↑ notch on the active button
 *
 * · FOUR buttons, one per screen of the group, in the order the group reads
 *   (Farm → Loan → Insurance → Orders), INSIDE the pill.
 * · The ACTIVE one — the section you are standing on — carries the notch:
 *   a cut-out wedge over its top edge plus a soft window of light behind the
 *   glyph. That is the «بریدگی خاص»: state is a SHAPE, not a colour, so it
 *   survives both themes and reduced motion.
 * · The AI is a separate round glass button outside the pill, floating at
 *   the end of the track — the reference's detached circle. It is glass
 *   like the rest of the bar now («رنگش مثل بقیه») with only a quiet RGB
 *   hairline to say what it is.
 * · «محافظت» is gone from this bar: the third slot is «بیمه» (nav.insurance),
 *   the word the owner uses for that screen.
 *
 * MOTION: the owner asked for the bar to be «خیلی مدرن‌تر و انیمیشن حذف» —
 * so there is no float, no perpetual sheen, no pulsing, no press bounce on
 * the bar itself. What remains is one 180ms transition on the notch and on
 * the button colours, which is state feedback, not animation. The glyphs
 * still honour `useStill` and draw nothing when the user asked for still.
 */
const SECTIONS = [
  { id: 'farm', to: '/farm', key: 'nav.farm', Icon: UniFarmIcon },
  { id: 'loan', to: '/loan', key: 'nav.loan', Icon: UniLoanIcon },
  { id: 'insurance', to: '/insurance', key: 'nav.insurance', Icon: UniShieldIcon },
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

  /* Re-tapping the tab you are already on replays its glyph draw — a tap
     that produces nothing at all reads as a dropped input. */
  const [pulse, setPulse] = useState(0);
  const [pulsed, setPulsed] = useState(null);

  const here = sectionIdOf(pathname);
  const aiActive = String(pathname || '').split('/')[1] === 'intent';

  const go = (to, hapticKind) => {
    haptic?.(hapticKind);
    setPulse((n) => n + 1);
    setPulsed(to);
    navigate(to);
  };

  return (
    <div className="uni-dock" data-hidden={hidden ? 'true' : 'false'}>
      <nav className="uni-dock__pill" aria-label={t('nav.mainNav')}>
        {SECTIONS.map((item) => {
          const active = here === item.id;
          return (
            <button
              key={item.to}
              type="button"
              className={`uni-dock__item${active ? ' is-active' : ''}`}
              data-section={item.id}
              aria-label={t(item.key)}
              aria-current={active ? 'page' : undefined}
              title={t(item.key)}
              onClick={() => go(item.to, 'light')}
            >
              {/* The notch: a wedge cut out of the pill's top edge. Rendered
                  by the ACTIVE button only — one notch in the DOM, so the
                  mark cannot be duplicated by a styling change later.
                  aria-hidden: the state is already in aria-current. */}
              {active && <span className="uni-dock__notch" aria-hidden="true" />}
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
            </button>
          );
        })}
      </nav>

      {/* The AI, deliberately OUTSIDE the pill — its own glass surface. */}
      <button
        type="button"
        className={`uni-dock__ai${aiActive ? ' is-active' : ''}`}
        aria-label={t('nav.intentOS')}
        aria-current={aiActive ? 'page' : undefined}
        title={t('nav.intentOS')}
        onClick={() => go('/intent', 'medium')}
      >
        <span className="uni-dock__icon" aria-hidden="true">
          <AnimatedAgent active={false} still={still} width={22} height={22} strokeWidth={1.75} />
        </span>
        <span className="uni-dock__sr">{t('nav.intentOS')}</span>
      </button>
    </div>
  );
}
