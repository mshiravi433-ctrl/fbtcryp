import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import { useStill } from './AnimatedIcon';
import '../styles/farm-promo.css';

/**
 * FARM AD — the banner at the foot of the bridge screen.
 * ---------------------------------------------------------------------------
 * Requested: «پایین صفحه‌ش یک بنر تبلیغاتی خیلی مدرن با انیمیشن برای تبلیغ فارم
 * بزار» — and in the same breath, the tron/solana carousel that used to sit at
 * the TOP of this page was called useless and told to go («قبلش را محو کن و
 * ببرش، به‌درد نمی‌خورد»).
 *
 * The two instructions are one idea, and it is worth writing down because it is
 * the difference between a banner that earns its height and one that does not:
 *
 *   • The carousel advertised TWO OF THE FOUR TABS that are already visible on
 *     this screen, directly above the rail that switches between them. It spent
 *     a third of the first viewport repeating a control the user was about to
 *     touch anyway — while the bridge form, the thing they came for, sat below
 *     the fold. That is why it read as useless; it was not ugly, it was
 *     redundant.
 *
 *   • This one advertises something this screen cannot do, at the point where
 *     the user has finished doing what it could: the transfer is signed, the
 *     status card is under them, and the next question is «حالا این دارایی
 *     بی‌کار نماند؟». Farm is the answer, and the banner is the door.
 *
 * ─── HOW IT STAYS CHEAP ────────────────────────────────────────────────────
 * The performance rules in this repo are not decoration — «انیمیشن که سرعت
 * سایت را پایین نیاورد یا مهتابی نشود». A promo banner is exactly where apps
 * quietly buy 45 animations and pay for them on every scroll, so:
 *
 *   • NOT ONE FRAMER-MOTION LOOP. Every continuous motion here is CSS animation
 *     on `transform`/`opacity` only, i.e. composited off the main thread. The
 *     JS side of this component runs once, on mount.
 *   • NO `filter: blur()` — a 90px gaussian every frame is what made the
 *     landing pages stutter (documented in
 *     2026-09-24-seo-landing-pages-and-motion-budget-fa.md §1.2). The glow is a
 *     radial-gradient, which is a soft edge for free.
 *   • NO `backdrop-filter`. The card is a near-opaque gradient over the app's
 *     own dark canvas, so the blur would cost a full-screen re-read per frame
 *     and show almost nothing for it.
 *   • FOUR animations in total (sheen, orbit, bars, aurora drift), all stopped
 *     under `prefers-reduced-motion` and under the in-app reduce-motion switch
 *     via `useStill()`, and additionally slowed on narrow screens.
 *
 * ─── WHAT IT SAYS ──────────────────────────────────────────────────────────
 * No invented APY. The Farm screen reads live yields from the protocols; a
 * number printed here would be a number nobody measured, and this app has been
 * burned by exactly that class of copy (see the Farm rollout notes). So the
 * banner sells the FEATURES: real yields, non-custodial, exit any time.
 *
 * `memo` with no props: WalletContext polls balances every 30s and the bridge
 * screen re-renders on each tick. This is static copy — it should never be part
 * of that reconciliation. See the note on `WhatBridge` in pages/Bridge.jsx.
 */
const FarmPromoBanner = memo(function FarmPromoBanner({ className = '' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const still = useStill();

  const go = () => {
    haptic?.('light');
    navigate('/farm');
  };

  return (
    <section
      className={`farm-promo${still ? ' is-still' : ''}${className ? ` ${className}` : ''}`}
      aria-label={t('bridge.farmPromo.badge')}
    >
      <span className="farm-promo-aurora" aria-hidden="true" />
      <span className="farm-promo-sheen" aria-hidden="true" />

      {/*
        THE ARTWORK — a rising yield curve inside a ring of protocol dots.
        Inline SVG, ~1.4 KB, no request and no emoji: the same reasoning as
        every other illustration in this app, and the only piece of this banner
        that would look wrong if an icon CDN were unreachable (which, for a
        large part of this app's audience, it is).
      */}
      <span className="farm-promo-art" aria-hidden="true">
        <svg viewBox="0 0 96 96" fill="none" focusable="false">
          <defs>
            <linearGradient id="fbtFarmPromoBar" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#00e5ff" />
              <stop offset="100%" stopColor="#00ff9d" />
            </linearGradient>
            <linearGradient id="fbtFarmPromoRing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#00ff9d" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#7c4dff" stopOpacity="0.55" />
            </linearGradient>
          </defs>

          {/* the ring: the vault, drawn as a dashed circle that turns */}
          <circle
            className="farm-promo-ring"
            cx="48"
            cy="48"
            r="42"
            stroke="url(#fbtFarmPromoRing)"
            strokeWidth="1.4"
            strokeDasharray="3 7"
            strokeLinecap="round"
          />
          {/* the soil line the bars grow out of */}
          <path d="M16 74h64" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.4" strokeLinecap="round" />

          {/* four columns. Each one rises with its own delay — a growing chart,
              not a pulsing blob, which is the whole promise of the screen. */}
          <g fill="url(#fbtFarmPromoBar)">
            <rect className="farm-promo-bar" x="24" y="52" width="9" height="22" rx="4" />
            <rect className="farm-promo-bar" x="38" y="44" width="9" height="30" rx="4" />
            <rect className="farm-promo-bar" x="52" y="34" width="9" height="40" rx="4" />
            <rect className="farm-promo-bar" x="66" y="26" width="9" height="48" rx="4" />
          </g>

          {/* the coin leaving the top of the chart, on an orbit that always
              returns — compounding, in one stroke */}
          <g className="farm-promo-orbit">
            <circle cx="48" cy="48" r="27" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1" strokeDasharray="2 6" />
            <circle cx="75" cy="48" r="4.6" fill="#00ff9d" fillOpacity="0.9" />
            <circle cx="75" cy="48" r="8" fill="#00ff9d" fillOpacity="0.16" />
          </g>
        </svg>
      </span>

      <div className="farm-promo-copy">
        <span className="farm-promo-badge">
          <span className="farm-promo-spark" aria-hidden="true">◈</span>
          <span>{t('bridge.farmPromo.badge')}</span>
        </span>
        <h2 className="farm-promo-title">{t('bridge.farmPromo.title')}</h2>
        <p className="farm-promo-body">{t('bridge.farmPromo.body')}</p>

        <div className="farm-promo-chips">
          <span className="farm-promo-chip">{t('bridge.farmPromo.chipLive')}</span>
          <span className="farm-promo-chip">{t('bridge.farmPromo.chipSelf')}</span>
          <span className="farm-promo-chip">{t('bridge.farmPromo.chipExit')}</span>
        </div>

        <button type="button" className="farm-promo-cta" onClick={go}>
          <span>{t('bridge.farmPromo.cta')}</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {/* points with the reading direction, like every arrow in the app */}
            <path d="M5 12h13" />
            <path d="m12.5 5.5 6.5 6.5-6.5 6.5" />
          </svg>
        </button>
      </div>
    </section>
  );
});

export default FarmPromoBanner;
