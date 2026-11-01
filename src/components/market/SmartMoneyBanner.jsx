import { memo, useId } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GlyphChevron, GlyphGlobe, GlyphWave, GlyphGrid } from './MarketGlyphs.jsx';

/**
 * «هوش جهانی» — THE MARKET SCREEN'S ONE ADVERTISEMENT.
 * ---------------------------------------------------------------------------
 * Requested (2026-11-01):
 *
 *   «در بازار تب مرور، باکس تبلیغاتی «ببین پول هوشمند کجا می‌رود» را به
 *    تبلیغات در مورد هوش جهانی تبدیل کن با انیمیشن و عکس و ایکون و جمله درست،
 *    بدون اینکه باگ بخوره.»
 *
 * ─── WHAT IT IS NOW ────────────────────────────────────────────────────────
 * An advertisement for FBT Global Intelligence (`/global`): an animated world
 * on the left, a sentence that is true about that page on the right, three
 * drawn capability chips, and one way in. The Smart Money headline is gone from
 * this surface — Smart Money still has its own page, its own route and its own
 * entry in the menu; it simply is not what this box is selling any more.
 *
 * ─── THE FOUR RULES IT KEEPS, BECAUSE THEY ARE WHY IT CANNOT BUG ───────────
 *
 * 1. IT INVENTS NO NUMBER. The banner is decoration plus copy. There is no
 *    percentage, no count and no price on it, so it cannot disagree with the
 *    feed behind it and it cannot go stale.
 *
 * 2. IT ANIMATES ONLY `transform` AND `opacity`, IN CSS, WITHOUT
 *    `backdrop-filter`. The screenshot this screen was measured on is what
 *    pays for a blur that moves; every loop here is compositor work on an
 *    already-rasterised layer, and every one of them stops for
 *    `prefers-reduced-motion`, `data-motion`, `data-native` and `data-lite`.
 *
 * 3. IT USES ARTWORK THAT ALREADY SHIPS. `/images/market-banner/globe.webp` is
 *    the same local asset the hero banner uses — no new network request, no
 *    third-party host, and `loading="lazy"`/`decoding="async"` so it never
 *    competes with the market feed for bandwidth.
 *
 * 4. IT IS A LINK, NOT A BUTTON. One destination (`/global`), a real `href`,
 *    and the whole card is not clickable — the footer has the CTA and the
 *    artwork is `aria-hidden`, so a screen reader reads one sentence and one
 *    way in.
 *
 * The copy comes from `marketGlobalAd.*` in the locale files (fa / en / ar are
 * complete; any missing key falls back to English through i18next), never from
 * a literal in this file.
 */
function SmartMoneyBanner() {
  const { t } = useTranslation();
  const gradientId = `mx-route-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const pools = [
    ['analysis', GlyphWave],
    ['world', GlyphGlobe],
    ['agents', GlyphGrid]
  ];

  return (
    <section
      className="mx-smart-banner mx-global-banner"
      aria-labelledby="mx-smart-title"
      data-testid="market-smart-money-banner"
    >
      {/* Ambient light only. Two blooms, one sheen and the travelling rim are
          painted, not blurred, and none of them carries a reading. */}
      <span className="mx-smart-veil" aria-hidden="true" />
      <span className="mx-smart-sheen" aria-hidden="true" />

      <div className="mx-smart-main">
        <span className="mx-smart-mark" aria-hidden="true">
          <GlyphGlobe width={24} height={24} />
          <i className="mx-smart-ring" />
          <i className="mx-smart-ring is-2" />
          <i className="mx-smart-radar" />
        </span>
        <div className="mx-smart-copy">
          <span className="mx-smart-eyebrow">{t('marketGlobalAd.eyebrow')}</span>
          <h2 id="mx-smart-title">{t('marketGlobalAd.title')}</h2>
          <p>{t('marketGlobalAd.desc')}</p>
        </div>
      </div>

      {/* The world. One local drawing, one slow float, two orbit rings and
          three satellites — all transform/opacity, all inside aria-hidden. */}
      <div className="mx-global-art" aria-hidden="true">
        <img
          src="/images/market-banner/globe.webp"
          alt=""
          width={240}
          height={240}
          loading="lazy"
          decoding="async"
        />
        <span className="mx-global-orbit" />
        <span className="mx-global-orbit is-2" />
        <span className="mx-global-sat is-1" />
        <span className="mx-global-sat is-2" />
        <span className="mx-global-sat is-3" />
      </div>

      {/* A route through the intelligence: data in, the world model thinking,
          insight out. Same geometry the screen's own trend chart speaks, so it
          reads as part of this app rather than as clip art. */}
      <div className="mx-smart-route" aria-hidden="true">
        <div className="mx-route-drawing">
          <svg viewBox="0 0 400 88" preserveAspectRatio="none">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--mx-cyan)" />
                <stop offset="100%" stopColor="var(--mx-violet)" />
              </linearGradient>
            </defs>
            <path className="mx-route-line is-dim" d="M18 44h50c40 0 52-30 92-30h80c40 0 52 30 92 30h50M18 44h50c40 0 52 30 92 30h80c40 0 52-30 92-30h50" />
            <path className="mx-route-flow" d="M18 44h364" stroke={`url(#${gradientId})`} />
            <circle className="mx-route-node" cx="18" cy="44" r="5" />
            <circle className="mx-route-halo" cx="200" cy="44" r="23" />
            <circle className="mx-route-node is-hub" cx="200" cy="44" r="14" />
            <path className="mx-route-hub-mark" d="m194 44 6-5 6 5-6 5z" />
            <circle className="mx-route-node is-end" cx="382" cy="44" r="5" />
          </svg>
          <span className="mx-route-traveller" />
          <span className="mx-route-traveller is-2" />
          <span className="mx-route-traveller is-3" />
        </div>
        <span className="mx-route-labels">
          <span>{t('marketGlobalAd.input')}</span>
          <span>{t('marketGlobalAd.brain')}</span>
          <span>{t('marketGlobalAd.insight')}</span>
        </span>
      </div>

      <div className="mx-smart-pools">
        {pools.map(([pool, Glyph]) => (
          <span className="mx-pool" key={pool} data-pool={pool}>
            <Glyph width={14} height={14} aria-hidden="true" />
            <span>{t(`marketGlobalAd.features.${pool}`)}</span>
          </span>
        ))}
      </div>

      <div className="mx-smart-foot">
        <span className="mx-smart-note">{t('marketGlobalAd.note')}</span>
        <Link className="mx-smart-cta" to="/global">
          <span>{t('marketGlobalAd.cta')}</span>
          <GlyphChevron width={15} height={15} />
        </Link>
      </div>
    </section>
  );
}

export default memo(SmartMoneyBanner);
