import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const COPY = {
  fa: {
    label: 'بازار جهانی',
    title: 'نبض بازارهای جهان',
    subtitle: 'کریپتو، سهام و اقتصاد کلان؛ همه در یک نگاه.',
    action: 'نمای جهانی بازار'
  },
  ar: {
    label: 'الأسواق العالمية',
    title: 'نبض الأسواق حول العالم',
    subtitle: 'العملات المشفرة والأسهم والاقتصاد الكلي، في نظرة واحدة.',
    action: 'استكشف الأسواق'
  },
  en: {
    label: 'GLOBAL MARKETS',
    title: 'Markets move as one.',
    subtitle: 'Crypto, equities and macro trends — all in one view.',
    action: 'Explore global markets'
  }
};

function MarketStackedHero() {
  const { i18n } = useTranslation();
  const lang = String(i18n.resolvedLanguage || i18n.language || 'fa').split('-')[0];
  const locale = lang === 'fa' || lang === 'ar' ? lang : 'en';
  const copy = COPY[locale];

  return (
    <section className="mx-global-hero" aria-label={copy.label}>
      <Link className="mx-global-hero-link" to="/global" aria-label={`${copy.title}. ${copy.action}`}>
        <span className="mx-global-hero-copy">
          <span className="mx-global-hero-label"><i aria-hidden="true" />{copy.label}</span>
          <span className="mx-global-hero-title">{copy.title}</span>
          <span className="mx-global-hero-subtitle">{copy.subtitle}</span>
          <span className="mx-global-hero-action">
            {copy.action}
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M4 10h11M10 5l5 5-5 5" />
            </svg>
          </span>
        </span>
        <span className="mx-global-hero-art" aria-hidden="true">
          <img
            src="/images/market-stack/global-market-art.webp"
            alt=""
            fetchpriority="high"
            decoding="async"
          />
        </span>
      </Link>
    </section>
  );
}

export default memo(MarketStackedHero);
