import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GlyphChevron, GlyphSmartFlow } from './MarketGlyphs.jsx';

/**
 * SMART MONEY — «بنر تبلیغاتی پول هوشمند بسیار نینیمال تر».
 * ---------------------------------------------------------------------------
 * What it was: a 148px billboard with an isometric data field drawn on the
 * right, a grid mask behind it, three animated node groups and four bars. It
 * carried no numbers (the artwork was deliberately abstract) but it occupied
 * the space of a reading, and it was the second-heaviest thing on the screen.
 *
 * What it is: one blade, one line of copy, one mark, one CTA.
 *
 *   · the artwork is a single 40px glyph tile — three linked nodes with one lit
 *     — instead of a 360×180 scene;
 *   · the only motion on it is a light that travels the top hairline once every
 *     nine seconds (`transform` only, composited, no blur, no repaint of the
 *     card) and it stops for reduced-motion, native shells and lite mode;
 *   · nothing blinks: there is no pulsing dot and no opacity loop.
 *
 * The link still goes to /smart-money and still says exactly
 * `marketIntel.smartCta`, so its accessible name is unchanged.
 */
function SmartMoneyBanner() {
  const { t } = useTranslation();
  return (
    <section className="mx-smart-banner" aria-labelledby="mx-smart-title" data-testid="market-smart-money-banner">
      <span className="mx-smart-sheen" aria-hidden="true" />
      <span className="mx-smart-mark" aria-hidden="true">
        <GlyphSmartFlow width={19} height={19} />
      </span>
      <div className="mx-smart-copy">
        <span className="mx-smart-eyebrow mono">{t('marketIntel.smartEyebrow')}</span>
        <h2 id="mx-smart-title">{t('marketIntel.smartTitle')}</h2>
        <p>{t('marketIntel.smartDesc')}</p>
      </div>
      <Link className="mx-smart-cta" to="/smart-money">
        <span>{t('marketIntel.smartCta')}</span>
        <GlyphChevron width={13} height={13} />
      </Link>
    </section>
  );
}

export default memo(SmartMoneyBanner);
