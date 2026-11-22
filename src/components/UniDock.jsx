import { useState } from 'react';
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
 *  3. «دکمه محافظت را با بیمه جایگزین کن … هر کدوم فعال بود یک بریدگی
 *     خاصی داشته باشد» — the four group screens back INSIDE the pill, the
 *     AI still standing apart.
 *  4. «اون نباشه بریدگی نمی‌خواهیم» — the notch is GONE. The bar's outline
 *     is uninterrupted; the current screen is shown by a soft window inside
 *     it and by ink strength, nothing else.
 *
 * So the current arrangement is:
 *
 *   [ فارم │[وام]│ بیمه │ سفارش ]      ( AI )
 *            ↑ window inside the bar, no cut anywhere
 *
 * · FOUR buttons, one per screen of the group, in the order the group reads
 *   (Farm → Loan → Insurance → Orders), INSIDE the pill.
 * · The ACTIVE one — the section you are standing on — is shown by a soft
 *   raised window INSIDE the bar behind its glyph, and by the brighter ink.
 *   There is NO notch, in any form: the owner asked three times for a
 *   selection mark and then, seeing the result, «اون نباشه بریدگی نمی‌خواهیم»
 *   — no cut, no tab, no lobe poking out of the top edge. The pill's
 *   silhouette is now completely uninterrupted; selection lives entirely
 *   within it. (Which is also why this component no longer renders a mark
 *   element at all — nothing to restyle, nothing to bring back by accident.)
 * · The AI is a separate round glass button outside the pill, floating at
 *   the end of the track — the reference's detached circle. It is glass
 *   like the rest of the bar now («رنگش مثل بقیه») with only a quiet RGB
 *   hairline to say what it is.
 * · «محافظت» is gone from this bar: the third slot is «بیمه» (nav.insurance),
 *   the word the owner uses for that screen.
 *
 * MOTION: the owner asked for the bar to be «خیلی مدرن‌تر و انیمیشن حذف» —
 * so there is no float, no perpetual sheen, no pulsing, no press bounce on
 * the bar itself. What remains is one 180ms transition on the active mark
 * and on the button colours: state feedback, not animation. Nothing in this
 * component animates on its own, so there is no reduced-motion branch to
 * get wrong either.
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
              <span className="uni-dock__icon" aria-hidden="true">
                <item.Icon
                  key={`${item.to}-${pulsed === item.to ? pulse : 'rest'}`}
                  width={21}
                  height={21}
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
          <AnimatedAgent active={false} still={still} width={21} height={21} strokeWidth={1.7} />
        </span>
        <span className="uni-dock__sr">{t('nav.intentOS')}</span>
      </button>
    </div>
  );
}
