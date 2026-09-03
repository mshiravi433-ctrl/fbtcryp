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
  IconRefresh,
  IconShield,
  IconSparkle,
  IconWallet,
} from '../components/Icons';
import '../styles/about-premium.css';

/* ==========================================================================
   ABOUT — FBT Swap
   --------------------------------------------------------------------------
   Deliberately lean. The previous version of this screen stacked ~20
   sections inside the app's 520px shell, which is why it read as crowded:
   every two-column grid in the old stylesheet had a `min-width: 900px`
   breakpoint that can never fire here, so all of them rendered as one long
   single column.

   What is left is the four things a visitor actually came for:
     brand → who we are → what the product does → questions → where to go next

   No invented numbers: no volume, no TVL, no user counts. Copy is honest
   about what is live and what is not, and that rule is not negotiable —
   a claim that is not true of the shipped app does not go on this page.
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
 * The four things the product actually does.
 *
 * Only screens that exist and are routable. `hue` drives the icon tile's
 * gradient through a CSS custom property, so the palette lives here and the
 * stylesheet stays generic.
 */
const FEATURES = [
  { key: 'swap', icon: IconRefresh, hue: '#00e5ff', to: '/swap' },
  { key: 'wallet', icon: IconWallet, hue: '#7c4dff', to: '/wallet' },
  { key: 'intent', icon: IconSparkle, hue: '#a78bfa', to: '/intent' },
  { key: 'signals', icon: IconActivity, hue: '#00ff9d', to: '/signals' },
];

/* Three facts a first-time visitor needs before anything else. All three are
   already true of the shipped app — no aspirational copy here. */
const FACTS = ['trust.nonCustodial', 'trust.multiChain', 'value.access.title'];

// ---------------------------------------------------------------------------
export default function About() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'en';
  const isFA = lang.startsWith('fa');
  const reduceMotion = useReducedMotion();

  useAboutSEO(lang);

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
      <div className="about-page" ref={revealRef} dir={isFA ? 'rtl' : 'ltr'} lang={lang}>
        <div className="about-aurora" aria-hidden="true" />

        <div className="about-shell">
          {/* ================= BRAND + WHO WE ARE ================= */}
          <header className="about-hero about-reveal">
            <AboutBrandMark />

            <div className="about-hero-brand">
              <span className="about-hero-name">FBT Swap</span>
              <span className="about-hero-tag">{t('about.tagline')}</span>
            </div>

            <h1 className="about-hero-title">{t('about.who')}</h1>
            <p className="about-hero-summary">{t('about.summary')}</p>

            <ul className="about-facts" role="list">
              {FACTS.map((key) => (
                <li key={key} className="about-fact">
                  <span className="about-fact-dot" aria-hidden="true" />
                  {t(`about.${key}`)}
                </li>
              ))}
            </ul>
          </header>

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
