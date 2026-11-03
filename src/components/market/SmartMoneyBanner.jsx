import { memo, useId } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GlyphChevron, GlyphGlobe } from './MarketGlyphs.jsx';

/**
 * A compact Global Intelligence advertisement for the market's Overview tab.
 *
 * This is deliberately one slim row, not another content card: a small orbital
 * mark, one title, one explanatory sentence and one route into `/global`.
 * There is no photograph, illustration, feature grid or invented market data.
 * Motion is limited to transform/opacity and is disabled by every existing
 * reduced-motion / native / lite guard in market-request-fixes.css.
 */
function SmartMoneyBanner() {
  const { t } = useTranslation();
  const titleId = `mx-global-title-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const cta = t('marketGlobalAd.cta');

  return (
    <section
      className="mx-smart-banner mx-global-banner"
      aria-labelledby={titleId}
      data-testid="market-smart-money-banner"
    >
      <span className="mx-smart-sheen" aria-hidden="true" />
      <div className="mx-smart-main">
        <span className="mx-smart-mark" aria-hidden="true">
          <GlyphGlobe width={19} height={19} />
          <i className="mx-smart-ring" />
          <i className="mx-smart-radar" />
          <i className="mx-global-pulse" />
        </span>
        <div className="mx-smart-copy">
          <h2 id={titleId}>{t('marketGlobalAd.title')}</h2>
          <p>{t('marketGlobalAd.desc')}</p>
        </div>
      </div>
      <Link className="mx-smart-cta" to="/global" aria-label={cta} title={cta}>
        <span>{cta}</span>
        <GlyphChevron width={14} height={14} />
      </Link>
    </section>
  );
}

export default memo(SmartMoneyBanner);
