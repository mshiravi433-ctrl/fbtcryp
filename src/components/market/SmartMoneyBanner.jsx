import { memo, useId } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GlyphChevron, GlyphGlobe, GlyphWave, GlyphGrid } from './MarketGlyphs.jsx';

/** A decorative global intelligence diagram, not a fabricated live-data feed.
 * Motion is CSS-only so reduced-motion, native and lite mode can stop it.
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
    <section className="mx-smart-banner mx-global-banner" aria-labelledby="mx-smart-title" data-testid="market-smart-money-banner">
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

      <div className="mx-global-art" aria-hidden="true"><img src="/images/market-banner/globe.webp" alt="" width="240" height="240" loading="lazy" decoding="async" /><span className="mx-global-orbit" /></div>
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
