import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import {
  IconActivity,
  IconArrowDown,
  IconChevronRight,
  IconMail,
  IconPools,
  IconRefresh,
  IconShield,
  IconSmartMoney,
  IconSparkle,
  IconWallet,
} from '../components/Icons';
import { EVM_CHAINS, EVM_CHAIN_ORDER } from '../lib/chains';
import { LANGUAGES, isRtl } from '../i18n/languages';
import '../styles/about-premium.css';

/* ==========================================================================
   ABOUT — FBT Swap
   --------------------------------------------------------------------------
   Written for the column it is actually rendered in (`.app-shell` is
   520px wide), in every one of the twelve languages, and with nothing on it
   that is not true of the shipped app.

   Reading order — the order a first-time visitor actually wants:
     brand + one-line promise → who we are → three honest figures →
     the networks (from the registry, not a list) → how it works in three
     steps → what you can do here → questions → where to go next

   THE FIGURES ARE DERIVED, NOT TYPED. The network count comes from the chain
   registry plus Solana, the language count from the language registry, and
   the third figure — funds we hold — is zero because the exchange is
   non-custodial. No volume, no TVL, no user counts: a number nobody can
   verify does not go on this page.

   EVERY STRING IS A `t()` KEY. The previous version fell back to English in
   nine of the twelve languages, which on a "who are these people" screen
   reads as "these people did not bother". The keys now exist in all twelve
   locale files (`scripts/locales/about.mjs` feeds the nine generated ones).

   RTL IS A PROPERTY OF THE LANGUAGE, NOT OF PERSIAN. `dir` used to be
   `isFA ? 'rtl' : 'ltr'`, which rendered Arabic and Urdu left-to-right on
   this one screen while the rest of the app was mirrored. It now asks the
   language registry.
   ========================================================================== */

// --- SEO hook --------------------------------------------------------------
function useAboutSEO(lang) {
  useEffect(() => {
    const isFA = lang?.startsWith('fa');
    const title = isFA
      ? 'درباره FBT Swap | پلتفرم مالی هوشمند و دیفای'
      : 'About FBT Swap | AI-Powered Financial & DeFi Platform';
    const desc = isFA
      ? 'با FBT Swap، پلتفرم مالی هوشمند مبتنی بر بلاکچین، دیفای، کیف پول غیرامانی، سیگنال‌های هوشمند و Intent OS آشنا شوید.'
      : 'Learn about FBT Swap, an AI-powered financial platform combining blockchain, DeFi, market intelligence, non-custodial wallets and Intent OS.';
    const canonical = 'https://fbtswap.ir/#/about';

    document.title = title;

    // meta description
    let md = document.querySelector('meta[name="description"]');
    if (!md) {
      md = document.createElement('meta');
      md.setAttribute('name', 'description');
      document.head.appendChild(md);
    }
    const prevDesc = md.getAttribute('content');
    md.setAttribute('content', desc);

    // canonical
    let link = document.querySelector('link[rel="canonical"]');
    const prevCanonical = link?.getAttribute('href');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', canonical);

    // og
    const ensureMeta = (prop, content) => {
      let el = document.querySelector(`meta[property="${prop}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute('property', prop);
        document.head.appendChild(el);
      }
      const prev = el.getAttribute('content');
      el.setAttribute('content', content);
      return prev;
    };
    const prevOgTitle = ensureMeta('og:title', title);
    const prevOgDesc = ensureMeta('og:description', desc);
    ensureMeta('og:url', canonical);
    ensureMeta('og:type', 'website');

    let tw = document.querySelector('meta[name="twitter:title"]');
    if (!tw) {
      tw = document.createElement('meta');
      tw.setAttribute('name', 'twitter:title');
      document.head.appendChild(tw);
    }
    const prevTwTitle = tw.getAttribute('content');
    tw.setAttribute('content', title);

    // JSON-LD structured data
    const orgId = 'https://fbtswap.ir/#organization';
    const schemas = [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        '@id': orgId,
        name: 'FBT Swap',
        alternateName: 'Fanous Bazaar Pishgam',
        url: 'https://fbtswap.ir/',
        logo: 'https://fbtswap.ir/social-card.png',
      },
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        '@id': 'https://fbtswap.ir/#website',
        name: 'FBT Swap',
        url: 'https://fbtswap.ir/',
        publisher: { '@id': orgId },
        inLanguage: isFA ? 'fa' : 'en',
      },
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'FBT Swap',
        applicationCategory: 'FinanceApplication',
        applicationSubCategory: 'Non-custodial decentralized exchange',
        operatingSystem: 'Web, Android',
        url: 'https://fbtswap.ir/',
        image: 'https://fbtswap.ir/social-card.png',
        description: desc,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        author: { '@id': orgId },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: isFA ? 'خانه' : 'Home', item: 'https://fbtswap.ir/' },
          { '@type': 'ListItem', position: 2, name: isFA ? 'درباره ما' : 'About', item: canonical },
        ],
      },
    ];

    const injected = [];
    schemas.forEach((s, i) => {
      const el = document.createElement('script');
      el.type = 'application/ld+json';
      el.setAttribute('data-about-seo', String(i));
      el.textContent = JSON.stringify(s);
      document.head.appendChild(el);
      injected.push(el);
    });

    return () => {
      if (prevDesc != null) md.setAttribute('content', prevDesc);
      if (prevCanonical != null && link) link.setAttribute('href', prevCanonical);
      if (prevOgTitle != null) {
        const el = document.querySelector('meta[property="og:title"]');
        if (el) el.setAttribute('content', prevOgTitle);
      }
      if (prevOgDesc != null) {
        const el = document.querySelector('meta[property="og:description"]');
        if (el) el.setAttribute('content', prevOgDesc);
      }
      if (prevTwTitle != null) {
        const el = document.querySelector('meta[name="twitter:title"]');
        if (el) el.setAttribute('content', prevTwTitle);
      }
      injected.forEach((el) => el.remove());
      // restore title to default — index.html default
      document.title = 'FBT Swap — Non-Custodial DEX & Crypto Swap on 10 Chains';
    };
  }, [lang]);
}

/**
 * The brand mark, drawn at landing-page scale.
 *
 * Same geometry as the header's `BrandMark`, with its own gradient ids so
 * the two never collide — an SVG gradient id is document-global, and a
 * duplicate silently repaints whichever element the browser resolved last.
 */
function AboutBrandMark() {
  return (
    <span className="about-mark" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <defs>
          <linearGradient id="aboutBrandGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00e5ff" />
            <stop offset="50%" stopColor="#7c4dff" />
            <stop offset="100%" stopColor="#ff2d95" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="9.2" stroke="url(#aboutBrandGrad)" strokeWidth="2.1" />
        <path d="M8.4 10.6a3.8 3.8 0 0 1 6.5-1.4" stroke="url(#aboutBrandGrad)" />
        <path d="M15.6 13.4a3.8 3.8 0 0 1-6.5 1.4" stroke="url(#aboutBrandGrad)" />
        <path d="M14.6 6.6v2.9h-2.9" stroke="url(#aboutBrandGrad)" />
        <path d="M9.4 17.4v-2.9h2.9" stroke="url(#aboutBrandGrad)" />
      </svg>
    </span>
  );
}

/**
 * What the product actually does — only screens that exist and are routable.
 *
 * `hue` drives the icon tile's gradient through a CSS custom property, so
 * the palette lives here and the stylesheet stays generic.
 */
const FEATURES = [
  { key: 'swap', icon: IconRefresh, hue: '#00e5ff', to: '/swap' },
  { key: 'wallet', icon: IconWallet, hue: '#7c4dff', to: '/wallet' },
  { key: 'intent', icon: IconSparkle, hue: '#a78bfa', to: '/intent' },
  { key: 'signals', icon: IconActivity, hue: '#00ff9d', to: '/signals' },
  { key: 'smartMoney', icon: IconSmartMoney, hue: '#ffb347', to: '/smart-money' },
  { key: 'farms', icon: IconPools, hue: '#ff2d95', to: '/farm' },
];

/* Three facts a first-time visitor needs before anything else. All three are
   already true of the shipped app — no aspirational copy here. */
const FACTS = ['trust.nonCustodial', 'trust.multiChain', 'value.access.title'];

/* The three-step walkthrough. Numbered in the stylesheet, so the copy keys
   are all that lives here. */
const STEPS = ['step1', 'step2', 'step3'];

/**
 * The networks, straight from the registry that the swap screen itself uses,
 * plus Solana (which lives outside `EVM_CHAINS` because it is not EVM). If a
 * chain is added or removed there, this strip follows — the page never has
 * to be told.
 */
const NETWORKS = [
  ...EVM_CHAIN_ORDER.map((id) => EVM_CHAINS[id]).filter(Boolean).map((c) => ({ key: c.short, label: c.short, color: c.color })),
  { key: 'SOL', label: 'SOL', color: '#9945ff' },
];

// ---------------------------------------------------------------------------
export default function About() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'en';
  const rtl = isRtl(lang.split('-')[0]);
  const reduceMotion = useReducedMotion();

  useAboutSEO(lang);

  /* Figures in the reader's own numerals: «۱۰» for Persian, «١٠» for Arabic,
     «10» elsewhere. `Intl` knows the numbering system per locale, and a
     malformed tag falls back to English rather than throwing. */
  const num = useMemo(() => {
    try {
      const nf = new Intl.NumberFormat(lang);
      return (n) => nf.format(n);
    } catch {
      return (n) => String(n);
    }
  }, [lang]);
  const figures = [
    { key: 'chains', value: num(NETWORKS.length) },
    { key: 'languages', value: num(LANGUAGES.length) },
    { key: 'custody', value: num(0) },
  ];

  // scroll reveal
  const revealRef = useRef(null);
  useEffect(() => {
    if (reduceMotion) return undefined;
    /*
     * The reveal is decoration, so the guard is not hypothetical: an Android
     * WebView old enough to lack IntersectionObserver would otherwise throw
     * inside the effect and take the whole screen down over an animation.
     * Degrading to "no reveal" costs nothing — the content is all static.
     */
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const root = revealRef.current;
    if (!root) return undefined;
    const els = root.querySelectorAll('.about-reveal');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [reduceMotion, lang]);

  /* Accordion: one answer open at a time. The whole list is short enough
     that collapsing the others keeps the page scannable instead of a wall of
     text, and `null` means "all closed" which is the state it opens in. */
  const [openFaq, setOpenFaq] = useState(null);

  const faqs = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => {
        const n = i + 1;
        return { n, q: t(`about.faq.q${n}`), a: t(`about.faq.a${n}`) };
      }),
    [t]
  );

  const year = new Date().getFullYear();

  return (
    <PageTransition>
      <div className="about-page" ref={revealRef} dir={rtl ? 'rtl' : 'ltr'} lang={lang}>
        <div className="about-aurora" aria-hidden="true" />
        <div className="about-grid" aria-hidden="true" />

        <div className="about-shell">
          {/* ================= BRAND + PROMISE ================= */}
          <header className="about-hero about-reveal">
            <AboutBrandMark />

            <div className="about-hero-brand">
              <span className="about-hero-name">FBT Swap</span>
              <span className="about-hero-tag">{t('about.tagline')}</span>
            </div>

            <h1 className="about-hero-title">{t('about.headline')}</h1>

            <ul className="about-facts" role="list">
              {FACTS.map((key) => (
                <li key={key} className="about-fact">
                  <span className="about-fact-dot" aria-hidden="true" />
                  {t(`about.${key}`)}
                </li>
              ))}
            </ul>
          </header>

          {/* ================= WHO WE ARE ================= */}
          <section className="about-block about-reveal" aria-labelledby="about-who-title">
            <h2 className="about-block-title" id="about-who-title">
              {t('about.who')}
            </h2>
            <p className="about-hero-summary">{t('about.summary')}</p>

            <dl className="about-figures" data-testid="about-figures">
              {figures.map((f) => (
                <div key={f.key} className={`about-figure about-figure--${f.key}`}>
                  <dd>{f.value}</dd>
                  <dt>{t(`about.stats.${f.key}`)}</dt>
                </div>
              ))}
            </dl>

            <ul className="about-networks" role="list" aria-label={t('about.stats.chains')}>
              {NETWORKS.map((n) => (
                <li key={n.key} className="about-network" style={{ '--net': n.color }}>
                  <span className="about-network-dot" aria-hidden="true" />
                  {n.label}
                </li>
              ))}
            </ul>
          </section>

          {/* ================= HOW IT WORKS ================= */}
          <section className="about-block about-reveal" aria-labelledby="about-how-title">
            <h2 className="about-block-title" id="about-how-title">
              {t('about.how.title')}
            </h2>
            <ol className="about-steps">
              {STEPS.map((step, i) => (
                <li key={step} className="about-step">
                  <span className="about-step-num" aria-hidden="true">
                    {num(i + 1)}
                  </span>
                  <div className="about-step-copy">
                    <strong>{t(`about.how.${step}Title`)}</strong>
                    <p>{t(`about.how.${step}Body`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ================= WHAT THE PRODUCT DOES ================= */}
          <section className="about-block about-reveal" aria-labelledby="about-features-title">
            <h2 className="about-block-title" id="about-features-title">
              {t('about.featuresTitle')}
            </h2>

            <div className="about-features">
              {FEATURES.map((f) => (
                <Link
                  key={f.key}
                  to={f.to}
                  className="about-feature"
                  // 8-digit hex so the same hue gives a fill and a border with
                  // no `color-mix()` and no second colour to keep in sync.
                  style={{ '--hue': f.hue, '--hue-soft': `${f.hue}1f`, '--hue-line': `${f.hue}38` }}
                >
                  <span className="about-feature-icon" aria-hidden="true">
                    <f.icon width={18} height={18} />
                  </span>
                  <span className="about-feature-copy">
                    <strong>{t(`about.ecosystem.${f.key}Title`)}</strong>
                    <small>{t(`about.ecosystem.${f.key}Desc`)}</small>
                  </span>
                  <span className="about-feature-arrow" aria-hidden="true">
                    <IconChevronRight width={14} height={14} />
                  </span>
                </Link>
              ))}
            </div>
          </section>

          {/* ================= FAQ ================= */}
          <section className="about-block about-reveal" aria-labelledby="about-faq-title">
            <h2 className="about-block-title" id="about-faq-title">
              {t('about.faq.title')}
            </h2>

            <div className="about-faq">
              {faqs.map((item) => {
                const open = openFaq === item.n;
                return (
                  <div key={item.n} className={`about-faq-item${open ? ' is-open' : ''}`}>
                    <button
                      type="button"
                      className="about-faq-q"
                      aria-expanded={open}
                      aria-controls={`about-faq-a-${item.n}`}
                      id={`about-faq-q-${item.n}`}
                      onClick={() => setOpenFaq(open ? null : item.n)}
                    >
                      <span>{item.q}</span>
                      <span className="about-faq-chevron" aria-hidden="true">
                        <IconArrowDown width={14} height={14} />
                      </span>
                    </button>
                    <div
                      className="about-faq-a"
                      id={`about-faq-a-${item.n}`}
                      role="region"
                      aria-labelledby={`about-faq-q-${item.n}`}
                    >
                      <p>{item.a}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ================= CTA ================= */}
          <section className="about-block about-reveal" aria-labelledby="about-cta-title">
            <div className="about-cta">
              <h2 className="about-cta-title" id="about-cta-title">
                {t('about.ctaTitle')}
              </h2>
              <div className="about-cta-actions">
                <button
                  type="button"
                  className="about-btn about-btn--primary"
                  onClick={() => navigate('/contact')}
                >
                  <IconMail width={16} height={16} />
                  {t('contact.title')}
                </button>
                <button
                  type="button"
                  className="about-btn about-btn--ghost"
                  onClick={() => navigate('/security')}
                >
                  <IconShield width={16} height={16} />
                  {t('nav.audit')}
                </button>
              </div>
            </div>
          </section>

          <footer className="about-foot">
            <span>
              © {year} FBT Swap · {t('about.companyFull')}
            </span>
            <span>{t('about.footNote')}</span>
          </footer>
        </div>
      </div>
    </PageTransition>
  );
}
