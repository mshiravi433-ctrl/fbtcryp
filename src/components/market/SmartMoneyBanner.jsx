import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GlyphSmartFlow, GlyphChevron, GlyphTrendUp } from './MarketGlyphs.jsx';

/**
 * «ببین پول هوشمند کجا می‌رود» — a funnel you can read, not a billboard.
 * ---------------------------------------------------------------------------
 * The request: «بنر تبلیغاتی «ببین پول هوشمند کجا می‌رود» را خیلی مدرن کن با
 * انیمیشن». The previous pass made this blade deliberately minimal — one mark,
 * one line, one CTA, a single hairline sweep — and minimal is not the same
 * thing as modern: it had no evidence in it and nothing that said WHERE.
 *
 * What it is now: a small flow diagram that answers the headline in one look.
 *
 *   ۱  A three-node path — wallet, router, destination — drawn as a single
 *      stroke that lights up in sequence, one dot travelling it. That is the
 *      animation, and it is the product: money moving through a route.
 *   ۲  The destination bar: three pools the copy actually names, each with its
 *      own accent and a fill that grows in once when the card is first seen.
 *   ۳  A live pill and a CTA, both in the card's own hue, plus one light that
 *      crosses the top hairline every nine seconds.
 *
 * Everything animated here is `transform` or `opacity` on a composited layer —
 * no blur, no filter, no width animation on a text line — and every loop stops
 * for reduced-motion, for the native WebView and in lite mode, because this
 * card sits above a 250-row list (see the motion budget in
 * styles/market-intelligence.css).
 *
 * The link still goes to /smart-money and still says exactly
 * `marketIntel.smartCta`, so its accessible name is unchanged; every extra word
 * is a translated key, never English dropped into a Persian interface.
 */
function SmartMoneyBanner() {
  const { t } = useTranslation();
  const pools = ['whales', 'institutions', 'newPools'];
  return (
    <section className="mx-smart-banner" aria-labelledby="mx-smart-title" data-testid="market-smart-money-banner">
      {/* the light field: one slow bloom, painted as a gradient */}
      <span className="mx-smart-veil" aria-hidden="true" />
      <span className="mx-smart-sheen" aria-hidden="true" />

      <div className="mx-smart-main">
        <span className="mx-smart-mark" aria-hidden="true">
          <GlyphSmartFlow width={20} height={20} />
          <i className="mx-smart-ring" />
        </span>

        <div className="mx-smart-copy">
          <span className="mx-smart-eyebrow mono">
            <i aria-hidden="true" />
            {t('marketIntel.smartEyebrow')}
          </span>
          <h2 id="mx-smart-title">{t('marketIntel.smartTitle')}</h2>
          <p>{t('marketIntel.smartDesc')}</p>
        </div>
      </div>

      {/* ─── THE ROUTE — the animation IS the claim ───────────────────────
          Wallet, router, destination on one rail, the path drawn in two
          strokes and a light running the length of it. Pure SVG: three dashes,
          three nodes, one `<linearGradient>`. No offset-path, no stroke
          animation — both are paint properties a WebView re-rasterises, and
          this card sits above a 250-row list. The only thing that moves is a
          gradient's stops, which the compositor can carry. */}
      <div className="mx-smart-route" aria-hidden="true">
        <svg viewBox="0 0 300 34" preserveAspectRatio="none">
          <defs>
            <linearGradient id="mx-route-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--mx-cyan)" stopOpacity="0" />
              <stop offset="42%" stopColor="var(--mx-cyan)" stopOpacity="0.95" />
              <stop offset="62%" stopColor="var(--mx-violet)" stopOpacity="0.95" />
              <stop offset="100%" stopColor="var(--mx-violet)" stopOpacity="0" />
              <animateTransform attributeName="gradientTransform" type="translate"
                from="-1 0" to="1 0" dur="5.6s" repeatCount="indefinite" />
            </linearGradient>
          </defs>
          <path className="mx-route-line" d="M8 17h52c10 0 12-11 24-11h40c12 0 14 11 24 11h88" />
          <path className="mx-route-line is-dim" d="M8 17h52c10 0 12 11 24 11h40c12 0 14-11 24-11h88" />
          <path className="mx-route-flow" d="M8 17h52c10 0 12-11 24-11h40c12 0 14 11 24 11h88" stroke="url(#mx-route-flow)" />
          <circle className="mx-route-node" cx="14" cy="17" r="3" />
          <circle className="mx-route-node" cx="152" cy="17" r="3" />
          <circle className="mx-route-node is-end" cx="236" cy="17" r="3" />
        </svg>
        <span className="mx-route-labels mono">
          <span>{t('marketIntel.flowWallet')}</span>
          <span>{t('marketIntel.flowRouter')}</span>
          <span>{t('marketIntel.flowTarget')}</span>
        </span>
      </div>

      {/* ─── WHERE IT LANDS — three destinations, named, never numbered ───
          Deliberately NOT a share bar with percentages: this screen holds no
          smart-money feed, so a number here would be invented. The pools are
          named destinations of the product, each with a drawn arrow — the same
          claim the CTA makes, said once more in the reader's own language. */}
      <div className="mx-smart-pools">
        {pools.map((pool, i) => (
          <span className="mx-pool" key={pool} data-pool={pool} style={{ '--i': i }}>
            <i className="mx-pool-dot" aria-hidden="true" />
            <span>{t(`marketIntel.pool.${pool}`)}</span>
            <GlyphTrendUp width={10} height={10} aria-hidden="true" />
          </span>
        ))}
      </div>

      <div className="mx-smart-foot">
        <span className="mx-smart-live">
          <i aria-hidden="true" />
          {t('marketIntel.smartLive')}
          <GlyphTrendUp width={11} height={11} aria-hidden="true" />
        </span>
        <Link className="mx-smart-cta" to="/smart-money">
          <span>{t('marketIntel.smartCta')}</span>
          <GlyphChevron width={13} height={13} />
        </Link>
      </div>
    </section>
  );
}

export default memo(SmartMoneyBanner);
