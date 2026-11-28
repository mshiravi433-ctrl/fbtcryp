import { memo, useId } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GlyphChevron, GlyphGlobe } from './MarketGlyphs.jsx';

/** Compact invitation into the cross-asset global markets view. */
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
          <span className="mx-global-eyebrow">{t('marketGlobalAd.eyebrow')}</span>
          <h2 id={titleId}>{t('marketGlobalAd.title')}</h2>
          <p>{t('marketGlobalAd.desc')}</p>
        </div>
      </div>

      <div className="mx-global-preview" aria-hidden="true">
        <span className="mx-global-preview-label">WORLD MARKETS</span>
        <svg viewBox="0 0 170 48" fill="none" focusable="false">
          <defs>
            <linearGradient id="mx-global-preview-fill" x1="85" y1="6" x2="85" y2="47" gradientUnits="userSpaceOnUse">
              <stop stopColor="#40d9d2" stopOpacity=".2" />
              <stop offset="1" stopColor="#40d9d2" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="mx-global-preview-grid" d="M1 12.5h168M1 25h168M1 37.5h168" />
          <path className="mx-global-preview-area" d="M2 39 20 32 34 35 49 23 64 28 81 17 96 23 112 10 129 16 145 6 168 10v37H2z" />
          <path className="mx-global-preview-line" d="m2 39 18-7 14 3 15-12 15 5 17-11 15 6 16-13 18 6 16-10 23 4" />
          <circle cx="145" cy="6" r="3" className="mx-global-preview-dot" />
        </svg>
        <span className="mx-global-preview-foot"><i aria-hidden="true" />{t('marketGlobalAd.previewLabel')}</span>
      </div>

      <Link className="mx-smart-cta" to="/global" aria-label={cta} title={cta}>
        <span>{cta}</span>
        <GlyphChevron width={14} height={14} />
      </Link>
    </section>
  );
}

export default memo(SmartMoneyBanner);
