import { useTranslation } from 'react-i18next';
import { IconShield } from './Icons';
import { feePercentString } from '../lib/feeBps';
import '../styles/rwa-banners.css';

/*
 * RwaSectionBanner — the RWA tab's header, as a banner.
 *
 * Request, verbatim: the plain-text card on top of the RWA page («دارایی‌های
 * دنیای واقعی روی زنجیره» + the body) should be «مثل بنر با ایکون svg و
 * انیمیشن و مینیمال و مدرن» — a banner with an SVG icon and animation,
 * minimal and modern.
 *
 * The copy is UNCHANGED (it is the i18n the page already had: stocks.rwaTitle,
 * stocks.rwaBody, stocks.rwaFeeNotice); what changed is the frame around it:
 * one animated icon, the two lines, and the fee line under a hairline — the
 * same height budget a card had, none of the old dead space.
 */

/**
 * A real-world asset on a chain, in one stroke picture: a vaulted building
 * with a token orbiting it. Drawn rather than borrowed — it is 25px, it has
 * to read in the accent colour on both themes, and an icon-set glyph would
 * import a second visual language.
 */
function RwaBankGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* pediment */}
      <path d="M4.6 9.4 12 4.8l7.4 4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {/* columns */}
      <path d="M6.4 11.2v5.2M10.4 11.2v5.2M14.4 11.2v5.2M18.4 11.2v5.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {/* base */}
      <path d="M4.6 19.4h15.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {/* the token, on its own slow orbit */}
      <g className="rwb-coin">
        <circle cx="12" cy="1.9" r="1.35" fill="currentColor" />
      </g>
    </svg>
  );
}

export default function RwaSectionBanner() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'fa' || i18n.language === 'ar';

  return (
    <section className="rwb" dir={isRTL ? 'rtl' : 'ltr'} aria-label={t('stocks.rwaTitle')}>
      <div className="rwb-main">
        <span className="rwb-icon" aria-hidden="true"><RwaBankGlyph /></span>
        <div className="rwb-text">
          <div className="rwb-title">{t('stocks.rwaTitle')}</div>
          <p className="rwb-body">{t('stocks.rwaBody')}</p>
        </div>
      </div>
      <p className="rwb-fee">
        <IconShield width={13} height={13} />
        <span>{t('stocks.rwaFeeNotice', { fee: feePercentString() })}</span>
      </p>
    </section>
  );
}
