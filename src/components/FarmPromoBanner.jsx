import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import { useStill } from './AnimatedIcon';
import '../styles/farm-promo.css';

/**
 * FARM AD — the compact banner at the foot of the bridge screen.
 * ---------------------------------------------------------------------------
 * HISTORY, IN TWO SENTENCES. The tron/solana carousel that used to sit at the
 * TOP of this page advertised two of the four tabs drawn directly below it, so
 * it was removed and its slot was given to a Farm banner at the FOOT — where
 * it sells something this screen cannot do to a user who has just finished
 * doing what it can. The first version of that banner was a 200px-tall card
 * with a headline, a paragraph, three chips and a full-width button: the ad
 * for the next screen ate the bottom of the one the user was still using.
 *
 * THE RULES THAT KEEP IT SMALL THIS TIME:
 *
 *   • ONE sentence in the headline, and it is shorter than the old one:
 *     «دارایی‌ات را بی‌کار نگذار». The previous headline was a full clause with
 *     a comma in the middle and wrapped to three lines on a 360px phone.
 *   • The three claims (live yields, non-custodial, exit any time) are one
 *     meta line with dot separators, not three bordered chips. Same facts,
 *     two-thirds of the height.
 *   • The artwork is a 44px square mark, not a 96px illustration: at this
 *     size the banner reads as a strip, not as a second product card.
 *   • The CTA is a compact pill (a circle on very narrow screens) at the
 *     trailing edge of the copy, so the card is ONE row of content high.
 *
 * ─── HOW IT STAYS CHEAP ────────────────────────────────────────────────────
 * The performance rules in this repo are not decoration — «انیمیشن که سرعت
 * سایت را پایین نیاورد». A promo banner is exactly where apps quietly buy
 * forty animations and pay for them on every scroll, so:
 *
 *   • NOT ONE FRAMER-MOTION LOOP. The two continuous motions here are CSS
 *     animations on `transform`/`opacity` only, i.e. composited off the main
 *     thread. The JS side of this component runs once, on mount.
 *   • NO `filter: blur()` and NO `backdrop-filter`. The glow is a
 *     radial-gradient, which is a soft edge for free.
 *   • Both animations stop under `prefers-reduced-motion` and under the app's
 *     own reduce-motion switch via `useStill()`.
 *
 * ─── WHAT IT SAYS ──────────────────────────────────────────────────────────
 * No invented APY. The Farm screen reads live yields from the protocols; a
 * number printed here would be a number nobody measured. The banner sells the
 * FEATURES, and every one of them is repeated at greater length on /farm.
 *
 * `memo` with no props: WalletContext polls balances every 30s and the bridge
 * screen re-renders on each tick. This is static copy — it should never be
 * part of that reconciliation.
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
      <span className="farm-promo-glow" aria-hidden="true" />
      <span className="farm-promo-sheen" aria-hidden="true" />

      {/*
        THE MARK — a rising curve in a rounded tile. Inline SVG (~0.7 KB), no
        request and no emoji: the only piece of this banner that would look
        wrong if an icon CDN were unreachable (which, for a large part of this
        app's audience, it is).
      */}
      <span className="farm-promo-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none" focusable="false">
          <defs>
            <linearGradient id="fbtFarmBar" x1="10" y1="34" x2="38" y2="12" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#00ff9d" />
              <stop offset="100%" stopColor="#35e0ff" />
            </linearGradient>
          </defs>
          <g fill="url(#fbtFarmBar)">
            <rect className="farm-promo-bar" x="11" y="26" width="5.4" height="12" rx="2.7" />
            <rect className="farm-promo-bar" x="20" y="21" width="5.4" height="17" rx="2.7" />
            <rect className="farm-promo-bar" x="29" y="15" width="5.4" height="23" rx="2.7" />
          </g>
          <path
            d="M9 37h30"
            stroke="currentColor"
            strokeOpacity="0.28"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="m30 12 3-3 3 3"
            stroke="#00ff9d"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.9"
          />
        </svg>
      </span>

      <div className="farm-promo-copy">
        <div className="farm-promo-line">
          <span className="farm-promo-badge">{t('bridge.farmPromo.badge')}</span>
          <h2 className="farm-promo-title">{t('bridge.farmPromo.title')}</h2>
        </div>

        {/*
          ONE meta line, not three chips. `.farm-promo-meta i` is the dot
          separator — an element rather than a text bullet so RTL does not put
          the punctuation on the wrong side of the words.
        */}
        <div className="farm-promo-meta">
          <span>{t('bridge.farmPromo.chipLive')}</span>
          <i aria-hidden="true" />
          <span>{t('bridge.farmPromo.chipSelf')}</span>
          <i aria-hidden="true" />
          <span>{t('bridge.farmPromo.chipExit')}</span>
        </div>
      </div>

      <button type="button" className="farm-promo-cta" onClick={go}>
        <span className="farm-promo-cta-text">{t('bridge.farmPromo.cta')}</span>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {/* points with the reading direction, like every arrow in the app */}
          <path d="M5 12h13" />
          <path d="m12.5 5.5 6.5 6.5-6.5 6.5" />
        </svg>
      </button>
    </section>
  );
});

export default FarmPromoBanner;
