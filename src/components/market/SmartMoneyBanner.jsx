import { memo, useId } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GlyphSmartFlow, GlyphChevron, GlyphGlobe, GlyphWave, GlyphGrid } from './MarketGlyphs.jsx';

/** A decorative capital-flow diagram, not a fabricated live-data feed.
 * Motion is CSS-only so reduced-motion, native and lite mode can stop it.
 */
function SmartMoneyBanner() {
  const { t } = useTranslation();
  const gradientId = `mx-route-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const pools = [
    ['whales', GlyphWave],
    ['institutions', GlyphGlobe],
    ['newPools', GlyphGrid]
  ];

  return (
    <section className="mx-smart-banner" aria-labelledby="mx-smart-title" data-testid="market-smart-money-banner">
      <span className="mx-smart-veil" aria-hidden="true" />
      <span className="mx-smart-sheen" aria-hidden="true" />

      <div className="mx-smart-main">
        <span className="mx-smart-mark" aria-hidden="true">
          <GlyphSmartFlow width={24} height={24} />
          <i className="mx-smart-ring" />
        </span>
        <div className="mx-smart-copy">
          <span className="mx-smart-eyebrow">{t('marketIntel.smartEyebrow')}</span>
          <h2 id="mx-smart-title">{t('marketIntel.smartTitle')}</h2>
          <p>{t('marketIntel.smartDesc')}</p>
        </div>
      </div>

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
        </div>
        <span className="mx-route-labels">
          <span>{t('marketIntel.flowWallet')}</span>
          <span>{t('marketIntel.flowRouter')}</span>
          <span>{t('marketIntel.flowTarget')}</span>
        </span>
      </div>

      <div className="mx-smart-pools">
        {pools.map(([pool, Glyph]) => (
          <span className="mx-pool" key={pool} data-pool={pool}>
            <Glyph width={14} height={14} aria-hidden="true" />
            <span>{t(`marketIntel.pool.${pool}`)}</span>
          </span>
        ))}
      </div>

      <div className="mx-smart-foot">
        <span className="mx-smart-note">{t('marketIntel.smartNote')}</span>
        <Link className="mx-smart-cta" to="/smart-money">
          <span>{t('marketIntel.smartCta')}</span>
          <GlyphChevron width={15} height={15} />
        </Link>
      </div>
    </section>
  );
}

export default memo(SmartMoneyBanner);
