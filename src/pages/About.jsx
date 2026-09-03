import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import {
  IconActivity,
  IconArrowDown,
  IconBuilding,
  IconCheck,
  IconChevronLeft,
  IconClock,
  IconExternal,
  IconGlobe,
  IconInfo,
  IconKey,
  IconLock,
  IconMapPin,
  IconSearch,
  IconShield,
  IconSmartMoney,
  IconSparkle,
  IconTrend,
  IconWallet,
  IconBell,
  IconRefresh,
  IconLink,
} from '../components/Icons';
import { EVM_CHAINS, EVM_CHAIN_ORDER } from '../lib/chains';
import { setLanguage } from '../i18n';
import '../styles/about-premium.css';

/* ==========================================================================
   ABOUT PREMIUM — FBT Swap
   Single page, premium FinTech + Web3 + AI + DeFi + Financial OS.
   One H1, semantic H2/H3 hierarchy, RTL-aware, reduced-motion aware.
   No fake stats, no invented volume/TVL, no market fabrication.
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

// --- Small helpers ---------------------------------------------------------
function MicroLabel({ children }) {
  return <span className="about-eyebrow" style={{ fontSize: 10, padding: '4px 10px' }}>{children}</span>;
}

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
    if (reduceMotion) return;
    const root = revealRef.current;
    if (!root) return;
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

  const chains = useMemo(() => {
    return EVM_CHAIN_ORDER.map((id) => EVM_CHAINS[id]).filter(Boolean);
  }, []);

  // Ecosystem cards — only features that actually exist, labeled Live / Coming Soon honestly
  const ecosystemCards = [
    { key: 'swap', icon: IconRefresh, hue: '#00e5ff', to: '/swap', live: true },
    { key: 'wallet', icon: IconWallet, hue: '#7c4dff', to: '/wallet', live: true },
    { key: 'intent', icon: IconSparkle, hue: '#a78bfa', to: '/intent', live: true },
    { key: 'signals', icon: IconActivity, hue: '#00ff9d', to: '/signals', live: true },
    { key: 'solana', icon: IconGlobe, hue: '#9945ff', to: '/solana', live: true },
    { key: 'smartMoney', icon: IconSmartMoney, hue: '#ff2d95', to: '/smart-money', live: true },
    { key: 'defi', icon: IconTrend, hue: '#f0b90b', to: '/explore', live: true },
    { key: 'farms', icon: IconBuilding, hue: '#00e5ff', to: '/farm', live: true },
    { key: 'marketIntel', icon: IconSearch, hue: '#ffb300', to: '/signals', live: true },
    { key: 'explore', icon: IconGlobe, hue: '#5b647f', to: '/explore', live: true },
  ];

  const handleLang = async (code) => {
    if (code === lang) return;
    await setLanguage(code);
  };

  return (
    <PageTransition>
      <div className="about-premium" ref={revealRef} dir={isFA ? 'rtl' : 'ltr'} lang={lang}>
        <div className="about-container">
          {/* Top bar: back + language switcher */}
          <div className="about-topbar" role="navigation" aria-label={isFA ? 'ناوبری' : 'Navigation'}>
            <div className="about-topbar-left">
              <button
                type="button"
                className="icon-btn"
                onClick={() => navigate(-1)}
                aria-label={t('common.back')}
                style={{ width: 36, height: 36, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer' }}
              >
                <IconChevronLeft width={16} height={16} />
              </button>
              <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.02, color: 'var(--text-2)' }}>{t('about.title')}</span>
            </div>
            <div className="about-lang-switch" role="group" aria-label={isFA ? 'انتخاب زبان' : 'Language'}>
              <button
                type="button"
                className={`about-lang-btn ${!isFA ? 'is-active' : ''}`}
                onClick={() => handleLang('en')}
                aria-pressed={!isFA}
                aria-label="English"
              >
                EN
              </button>
              <button
                type="button"
                className={`about-lang-btn ${isFA ? 'is-active' : ''}`}
                onClick={() => handleLang('fa')}
                aria-pressed={isFA}
                aria-label="فارسی"
              >
                فارسی
              </button>
            </div>
          </div>

          {/* ================= HERO ================= */}
          <section className="about-hero" aria-labelledby="about-hero-title">
            <div className="about-hero-grid">
              <div>
                <div className="about-eyebrow" aria-hidden="true">
                  <span className="about-eyebrow-dot" />
                  {t('about.heroEyebrow')}
                </div>
                <h1 id="about-hero-title">{t('about.heroTitle')}</h1>
                <p className="about-hero-subtitle">{t('about.heroSubtitle')}</p>
                <div className="about-hero-ctas">
                  <button type="button" className="about-btn-primary" onClick={() => navigate('/swap')}>
                    {t('about.heroPrimary')} <span aria-hidden="true">↗</span>
                  </button>
                  <button type="button" className="about-btn-secondary" onClick={() => navigate('/intent')}>
                    {t('about.heroSecondary')}
                  </button>
                </div>
              </div>

              <div className="about-hero-visual" aria-label={isFA ? 'جریان هوش مالی' : 'Financial intelligence flow'}>
                <div className="about-flow" role="list">
                  {[
                    'visualFlow.intent',
                    'visualFlow.ai',
                    'visualFlow.market',
                    'visualFlow.risk',
                    'visualFlow.strategy',
                    'visualFlow.execution',
                    'visualFlow.verification',
                    'visualFlow.monitoring',
                  ].map((k, idx) => (
                    <div className="about-flow-step" key={k} role="listitem">
                      <span className="about-flow-icon" aria-hidden="true">
                        {idx === 0 && <IconInfo width={16} height={16} />}
                        {idx === 1 && <IconSparkle width={16} height={16} />}
                        {idx === 2 && <IconTrend width={16} height={16} />}
                        {idx === 3 && <IconShield width={16} height={16} />}
                        {idx === 4 && <IconActivity width={16} height={16} />}
                        {idx === 5 && <IconRefresh width={16} height={16} />}
                        {idx === 6 && <IconCheck width={16} height={16} />}
                        {idx === 7 && <IconBell width={16} height={16} />}
                      </span>
                      <span className="about-flow-label">
                        {t(`about.${k}`)}
                        {idx === 1 && <small>AI</small>}
                        {idx === 5 && <small>{isFA ? 'کاربر' : 'USER'}</small>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Trust strip */}
          <div className="about-trust-strip" role="list" aria-label={isFA ? 'قابلیت‌ها' : 'Capabilities'}>
            {[
              { key: 'trust.ai', color: '#a78bfa' },
              { key: 'trust.multiChain', color: '#00e5ff' },
              { key: 'trust.nonCustodial', color: '#00ff9d' },
              { key: 'trust.intentBased', color: '#ff2d95' },
              { key: 'trust.dataDriven', color: '#ffb300' },
            ].map((item) => (
              <span key={item.key} className="about-trust-pill" role="listitem" style={{ '--pill-color': item.color }}>
                {t(`about.${item.key}`)}
              </span>
            ))}
          </div>

          {/* ================= OUR STORY ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-story-title">
            <div className="about-section-label">{t('about.story.title')}</div>
            <div className="about-story-grid">
              <div>
                <h2 id="about-story-title" style={{ fontSize: 'clamp(22px, 3.5vw, 30px)', marginBottom: 10 }}>{t('about.story.headline')}</h2>
                <div className="about-body">
                  <p>{t('about.story.p1')}</p>
                  <p><strong>{t('about.story.p2')}</strong></p>
                  <p>{t('about.story.p3')}</p>
                </div>
              </div>
              <div className="about-story-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <span style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #00e5ff, #7c4dff)', color: '#000', fontWeight: 900, fontFamily: 'var(--font-mono)' }}>FBT</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{t('about.companyFull')}</div>
                    <div style={{ fontSize: 12, color: 'var(--about-text-3)' }}>{t('about.tagline')}</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 10, fontSize: 12.5, color: 'var(--about-text-3)', lineHeight: 1.6 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <IconMapPin width={14} height={14} /> {t('about.addressValue')}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <IconShield width={14} height={14} /> {t('about.custodyBody')}
                  </div>
                </div>
                <p className="about-muted" style={{ marginTop: 14, fontSize: 11.5, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
                  {t('about.riskDisclosure')}
                </p>
              </div>
            </div>
          </section>

          {/* ================= WHY FBT EXISTS ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-why-title">
            <div className="about-section-label">{isFA ? 'چرا' : 'WHY'}</div>
            <h2 id="about-why-title">{t('about.why.title')}</h2>
            <div className="about-why-grid">
              {[
                { t: 'why.complexityTitle', b: 'why.complexityBody', accent: 'rgba(0,229,255,0.12)', border: 'rgba(0,229,255,0.18)', color: '#00e5ff', Icon: IconGlobe },
                { t: 'why.intelligenceTitle', b: 'why.intelligenceBody', accent: 'rgba(124,77,255,0.12)', border: 'rgba(124,77,255,0.18)', color: '#a78bfa', Icon: IconSparkle },
                { t: 'why.controlTitle', b: 'why.controlBody', accent: 'rgba(0,255,157,0.10)', border: 'rgba(0,255,157,0.16)', color: '#00ff9d', Icon: IconLock },
                { t: 'why.simplicityTitle', b: 'why.simplicityBody', accent: 'rgba(255,45,149,0.10)', border: 'rgba(255,45,149,0.16)', color: '#ff2d95', Icon: IconInfo },
              ].map((card) => (
                <div
                  key={card.t}
                  className="about-why-card"
                  style={{ '--card-accent': card.accent, '--card-accent-border': card.border, '--card-accent-strong': card.accent, '--card-accent-color': card.color }}
                >
                  <div className="about-why-icon" style={{ background: card.accent, borderColor: card.border, color: card.color }}>
                    <card.Icon width={18} height={18} />
                  </div>
                  <h3>{t(`about.${card.t}`)}</h3>
                  <p>{t(`about.${card.b}`)}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ================= VISION ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-vision-title">
            <div className="about-section-label">{t('about.vision.title')}</div>
            <h2 id="about-vision-title">{t('about.vision.headline')}</h2>
            <p className="about-lead">{t('about.vision.body')}</p>
            <div className="about-vision">
              <div className="about-vision-grid">
                <div className="about-vision-card">
                  <div className="about-vision-card-label">{t('about.vision.traditionalTitle')}</div>
                  <div className="about-vision-flow">
                    {(t('about.vision.traditionalFlow') || '').split('→').map((s, i, arr) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span>{s.trim()}</span>
                        {i < arr.length - 1 && <span className="about-vision-arrow" aria-hidden="true">→</span>}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="about-vision-card about-vision-card--fbt">
                  <div className="about-vision-card-label" style={{ color: '#d6ccff' }}>{t('about.vision.fbtTitle')}</div>
                  <div className="about-vision-flow">
                    {(t('about.vision.fbtFlow') || '').split('→').map((s, i, arr) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span>{s.trim()}</span>
                        {i < arr.length - 1 && <span className="about-vision-arrow" aria-hidden="true">→</span>}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="about-muted" style={{ marginTop: 14, fontSize: 12 }}>{isFA ? 'این بخش یکی از قوی‌ترین بخش‌های بصری صفحه است.' : 'This is one of the strongest visual sections on the page.'}</p>
            </div>
          </section>

          {/* ================= INTENT OS ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-intentos-title">
            <div className="about-section-label">INTENT OS</div>
            <div className="about-intent">
              <div>
                <h2 id="about-intentos-title">{t('about.intentOS.title')}</h2>
                <p className="about-lead" style={{ marginBottom: 14 }}>{t('about.intentOS.description')}</p>
                <div className="about-badges" role="list" aria-label="AI qualities">
                  {(() => {
                    const v = t('about.intentOS.badges', { returnObjects: true });
                    const list = Array.isArray(v) ? v : ['AI-assisted', 'Risk-aware', 'Data-driven', 'User-controlled'];
                    return list.map((b) => (
                      <span key={b} className="about-badge" role="listitem">{b}</span>
                    ));
                  })()}
                </div>
                <p className="about-disclaimer" style={{ marginTop: 16 }}>{t('about.intentOS.disclaimer')}</p>
              </div>

              <div className="about-intent-example" role="region" aria-label="Intent OS example">
                <div className="about-intent-example-head">
                  <span className="about-dot r" aria-hidden="true" />
                  <span className="about-dot y" aria-hidden="true" />
                  <span className="about-dot g" aria-hidden="true" />
                  <span style={{ marginInlineStart: 8, fontSize: 12, fontWeight: 700, color: 'var(--about-text-3)' }}>Intent OS</span>
                  <span style={{ marginInlineStart: 'auto', fontSize: 10, fontWeight: 800, letterSpacing: 0.08, color: 'var(--about-text-dim)', background: 'rgba(255,255,255,0.06)', padding: '3px 8px', borderRadius: 999 }}>AI • {isFA ? 'فعال' : 'LIVE'}</span>
                </div>
                <div className="about-intent-example-body">
                  <div className="about-chat-bubble" role="note">
                    <strong style={{ color: '#fff' }}>{isFA ? 'کاربر:' : 'User:'}</strong> {t('about.intentOS.exampleUser')}
                  </div>
                  <div className="about-intent-steps" role="list" aria-label={isFA ? 'مراحل Intent OS' : 'Intent OS steps'}>
                    {(t('about.intentOS.steps', { returnObjects: true })).map((step, i) => (
                      <div key={step} className="about-intent-step" role="listitem">
                        <span className="about-intent-step-num" aria-hidden="true">
                          {i + 1}
                        </span>
                        <span>{step}</span>
                        {i === 7 && <span className="about-intent-step-badge">{isFA ? 'کاربر' : 'USER'}</span>}
                        {i === 10 && <span className="about-intent-step-badge">∞</span>}
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--about-text-dim)', marginTop: 10, lineHeight: 1.6 }}>
                    {isFA ? 'هرگز تضمین سود ارائه نمی‌شود. از عبارت‌های «AI-assisted» و «ریسک‌آگاه» استفاده می‌شود.' : 'Never described as guaranteeing profit. Uses AI-assisted, risk-aware, data-driven, user-controlled.'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ================= HUMAN + AI ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-human-title">
            <div className="about-section-label">{isFA ? 'انسان + AI' : 'HUMAN + AI'}</div>
            <h2 id="about-human-title">{t('about.humanAI.title')}</h2>
            <p className="about-lead">
              <strong>{t('about.humanAI.headline')}</strong>
            </p>
            <div className="about-human">
              <div className="about-human-flow" role="list" aria-label={isFA ? 'جریان انسان و هوش مصنوعی' : 'Human and AI flow'}>
                {(t('about.humanAI.flow', { returnObjects: true })).map((label, i, arr) => (
                  <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span
                      className={`about-human-node ${i === 0 ? 'about-human-node--human' : i === arr.length - 1 ? 'about-human-node--approval' : ''}`}
                      role="listitem"
                    >
                      {label}
                    </span>
                    {i < arr.length - 1 && <span className="about-human-arrow" aria-hidden="true">→</span>}
                  </span>
                ))}
              </div>
              <p className="about-disclaimer" style={{ marginTop: 14 }}>{t('about.humanAI.note')}</p>
            </div>
          </section>

          {/* ================= AI INTELLIGENCE LAYER ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-ai-layer-title">
            <div className="about-section-label">{isFA ? 'لایه هوشمندی' : 'INTELLIGENCE'}</div>
            <h2 id="about-ai-layer-title">{t('about.aiLayer.title')}</h2>
            <p className="about-lead">{t('about.aiLayer.description')}</p>

            <div className="about-ai-gateway" role="list" aria-label="AI Gateway">
              {[
                { key: 'gateway', Icon: IconGlobe },
                { key: 'orchestrator', Icon: IconSparkle },
                { key: 'providers', Icon: IconRefresh, variant: 'providers' },
                { key: 'reasoning', Icon: IconActivity },
                { key: 'confidence', Icon: IconTrend },
                { key: 'risk', Icon: IconShield },
                { key: 'decision', Icon: IconCheck },
              ].map((item) => (
                <div
                  key={item.key}
                  className={`about-gateway-card ${item.variant === 'providers' ? 'about-gateway-card--providers' : ''}`}
                  role="listitem"
                >
                  <span className="about-gateway-icon" aria-hidden="true">
                    <item.Icon width={18} height={18} />
                  </span>
                  <span>
                    <strong style={{ fontSize: 13, color: '#fff' }}>{t(`about.aiLayer.${item.key}`)}</strong>
                    {item.key === 'providers' && (
                      <div>
                        <div className="about-provider-pills" style={{ marginTop: 8 }}>
                          {['Grok', 'OpenRouter', 'Internal'].map((p) => (
                            <span key={p} className="about-provider-pill">
                              {p}
                            </span>
                          ))}
                        </div>
                        <p style={{ fontSize: 11.5, color: 'var(--about-text-dim)', marginTop: 8, lineHeight: 1.5 }}>
                          {t('about.aiLayer.note')}
                        </p>
                      </div>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ================= WHAT FBT IS BUILDING ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-eco-title">
            <div className="about-section-label">{isFA ? 'اکوسیستم' : 'ECOSYSTEM'}</div>
            <h2 id="about-eco-title">{t('about.ecosystem.title')}</h2>
            <p className="about-muted" style={{ maxWidth: 640 }}>{t('about.ecosystem.subtitle')}</p>
            <div className="about-eco-grid">
              {ecosystemCards.map((card) => {
                const title = t(`about.ecosystem.${card.key}Title`);
                const desc = t(`about.ecosystem.${card.key}Desc`);
                return (
                  <div
                    key={card.key}
                    className="about-eco-card"
                    style={
                      {
                        '--eco-hue': card.hue,
                        '--eco-hue-bg': `${card.hue}18`,
                        '--eco-hue-border': `${card.hue}28`,
                      }
                    }
                  >
                    <div className="about-eco-top">
                      <span className="about-eco-icon" aria-hidden="true">
                        <card.icon width={18} height={18} />
                      </span>
                      <span className={`about-eco-badge ${card.live ? 'about-eco-badge--live' : 'about-eco-badge--soon'}`}>
                        {card.live ? t('about.ecosystem.live') : t('about.ecosystem.comingSoon')}
                      </span>
                    </div>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                    <Link to={card.to} className="about-eco-link">
                      {isFA ? 'مشاهده' : 'Open'} <span aria-hidden="true">↗</span>
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ================= MULTI-CHAIN ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-multi-title">
            <div className="about-section-label">MULTI-CHAIN</div>
            <h2 id="about-multi-title">{t('about.multichain.title')}</h2>
            <p className="about-lead">{t('about.multichain.subtitle')}</p>
            <p className="about-muted" style={{ marginBottom: 10 }}>
              {t('about.multichain.supported')} • <em>{t('about.multichain.dynamicNote')}</em>
            </p>
            <div className="about-chains" role="list" aria-label={isFA ? 'شبکه‌های پشتیبانی‌شده' : 'Supported networks'}>
              {chains.map((c) => (
                <span key={c.id} className="about-chain-pill" role="listitem" style={{ borderColor: `${c.color}28` }}>
                  <span className="about-chain-dot" style={{ background: c.color, color: c.color }} aria-hidden="true" />
                  <span className="about-chain-name">{c.name}</span>
                  <span className="about-chain-short">{c.short}</span>
                </span>
              ))}
              <span className="about-chain-pill" role="listitem" style={{ borderColor: 'rgba(153,69,255,0.28)' }}>
                <span className="about-chain-dot" style={{ background: '#9945ff', color: '#9945ff' }} aria-hidden="true" />
                <span className="about-chain-name">Solana</span>
                <span className="about-chain-short">SOL</span>
              </span>
            </div>
          </section>

          {/* ================= NON-CUSTODIAL + SECURITY ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-custody-title">
            <div className="about-split">
              <div className="about-feature-card about-feature-card--accent">
                <div className="about-section-label" style={{ marginBottom: 8 }}>{isFA ? 'غیرامانی' : 'NON-CUSTODIAL'}</div>
                <h2 id="about-custody-title" style={{ fontSize: 'clamp(20px, 3vw, 26px)', marginBottom: 8 }}>{t('about.nonCustodial.title')}</h2>
                <p className="about-body" style={{ fontSize: 13.5 }}>{t('about.nonCustodial.body')}</p>
                <ul className="about-bullet-list" role="list">
                  {(t('about.nonCustodial.bullets', { returnObjects: true })).map((b) => (
                    <li key={b} role="listitem">
                      {b}
                    </li>
                  ))}
                </ul>
                <p className="about-disclaimer">{t('about.nonCustodial.note')}</p>
              </div>

              <div className="about-feature-card">
                <div className="about-section-label" style={{ marginBottom: 8 }}>{isFA ? 'امنیت' : 'SECURITY'}</div>
                <h2 style={{ fontSize: 'clamp(20px, 3vw, 26px)', marginBottom: 8 }}>{t('about.security.title')}</h2>
                <div className="about-security-grid" style={{ gridTemplateColumns: '1fr', gap: 10, marginTop: 12 }}>
                  {[
                    { t: 'security.signingTitle', b: 'security.signingBody', Icon: IconKey },
                    { t: 'security.permissionTitle', b: 'security.permissionBody', Icon: IconLock },
                    { t: 'security.riskTitle', b: 'security.riskBody', Icon: IconShield },
                    { t: 'security.verificationTitle', b: 'security.verificationBody', Icon: IconCheck },
                    { t: 'security.transparencyTitle', b: 'security.transparencyBody', Icon: IconInfo },
                  ].map((x) => (
                    <div key={x.t} className="about-sec-card" style={{ padding: '12px 14px' }}>
                      <span className="about-sec-icon" aria-hidden="true">
                        <x.Icon width={16} height={16} />
                      </span>
                      <span>
                        <h4>{t(`about.${x.t}`)}</h4>
                        <p>{t(`about.${x.b}`)}</p>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="about-muted" style={{ marginTop: 10, fontSize: 11.5 }}>
                  {isFA ? 'اگر ویژگی امنیتی هنوز پیاده‌سازی نشده باشد، برچسب «در حال توسعه» می‌خورد.' : 'If a security feature is not yet implemented, it is labeled In Development.'}
                </p>
              </div>
            </div>
          </section>

          {/* ================= SMART MONEY ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-smart-title">
            <div className="about-section-label">{isFA ? 'اسمارت مانی' : 'SMART MONEY'}</div>
            <h2 id="about-smart-title">{t('about.smartMoney.title')}</h2>
            <p className="about-lead">{t('about.smartMoney.subtitle')}</p>
            <div className="about-smart-grid" role="list">
              {(t('about.smartMoney.features', { returnObjects: true })).map((f) => (
                <span key={f} className="about-smart-feature" role="listitem">
                  {f}
                </span>
              ))}
            </div>
            <p className="about-disclaimer">{t('about.smartMoney.disclaimer')}</p>
          </section>

          {/* ================= AI SIGNALS ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-signals-title">
            <div className="about-section-label">{isFA ? 'سیگنال‌های AI' : 'AI SIGNALS'}</div>
            <h2 id="about-signals-title">{t('about.signalsSection.title')}</h2>
            <div className="about-signal-flow" role="list" aria-label={isFA ? 'جریان سیگنال' : 'Signal flow'}>
              {(t('about.signalsSection.flow', { returnObjects: true })).map((s, i, arr) => (
                <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className={`about-signal-step ${i === arr.length - 1 ? 'about-signal-step--signal' : ''}`} role="listitem">
                    {s}
                  </span>
                  {i < arr.length - 1 && <span aria-hidden="true" style={{ color: 'var(--about-text-dim)' }}>→</span>}
                </span>
              ))}
            </div>
            <div className="about-signal-cats" role="list" aria-label={isFA ? 'دسته‌بندی سیگنال' : 'Signal categories'}>
              {(t('about.signalsSection.categories', { returnObjects: true })).map((c) => {
                const lower = c.toLowerCase();
                let cls = 'about-signal-cat--watch';
                if (lower.includes('strong buy') || lower.includes('خرید قوی')) cls = 'about-signal-cat--buy';
                else if (lower.includes('buy') || lower.includes('خرید')) cls = 'about-signal-cat--buy';
                else if (lower.includes('sell') || lower.includes('فروش')) cls = 'about-signal-cat--sell';
                else if (lower.includes('high risk') || lower.includes('پرریسک')) cls = 'about-signal-cat--risk';
                return (
                  <span key={c} className={`about-signal-cat ${cls}`} role="listitem">
                    {c}
                  </span>
                );
              })}
            </div>
            <p className="about-disclaimer">
              <strong>{t('about.signalsSection.disclaimer')}</strong>
            </p>
          </section>

          {/* ================= SOLANA INTELLIGENCE ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-solana-title">
            <div className="about-solana">
              <div>
                <div className="about-section-label">SOLANA</div>
                <h2 id="about-solana-title">{t('about.solanaSection.title')}</h2>
                <p className="about-lead">{t('about.solanaSection.subtitle')}</p>
                <button
                  type="button"
                  className="about-btn-primary"
                  style={{ marginTop: 14, background: 'linear-gradient(135deg, #9945ff, #14f195)' }}
                  onClick={() => navigate('/solana')}
                >
                  {t('about.solanaSection.cta')} <span aria-hidden="true">↗</span>
                </button>
              </div>
              <div className="about-solana-features" role="list" aria-label={isFA ? 'قابلیت‌های سولانا' : 'Solana capabilities'}>
                {(t('about.solanaSection.features', { returnObjects: true })).map((f) => (
                  <span key={f} className="about-smart-feature" role="listitem">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* ================= DEFI & YIELD ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-defi-title">
            <div className="about-section-label">DEFI &amp; YIELD</div>
            <h2 id="about-defi-title">{t('about.defiSection.title')}</h2>
            <p className="about-lead">{t('about.defiSection.subtitle')}</p>
            <div className="about-smart-grid" role="list" style={{ marginBottom: 14 }}>
              {(t('about.defiSection.features', { returnObjects: true })).map((f) => (
                <span key={f} className="about-smart-feature" role="listitem">
                  {f}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {(t('about.defiSection.labels', { returnObjects: true })).map((l) => (
                <span key={l} className="about-badge" style={{ background: 'rgba(124,77,255,0.10)', borderColor: 'rgba(124,77,255,0.16)', color: '#a78bfa' }}>
                  {l}
                </span>
              ))}
            </div>
            <div className="about-defi-note" role="note">
              <strong style={{ color: '#ffd77a' }}>{t('about.defiSection.noData')}</strong> — {t('about.defiSection.note')}
            </div>
          </section>

          {/* ================= BEYOND CRYPTO ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-beyond-title">
            <div className="about-section-label">{isFA ? 'چشم‌انداز جهانی' : 'GLOBAL VISION'}</div>
            <h2 id="about-beyond-title">{t('about.globalVision.title')}</h2>
            <p className="about-muted" style={{ maxWidth: 640 }}>{t('about.globalVision.subtitle')}</p>
            <div className="about-global-grid" role="list">
              {(t('about.globalVision.markets', { returnObjects: true })).map((mkt, idx) => {
                const liveMarkets = ['Crypto', 'DeFi', 'Stablecoins', 'کریپتو', 'دیفای', 'استیبل‌کوین'];
                const isLive = liveMarkets.includes(mkt);
                const isFuture = !isLive;
                return (
                  <div
                    key={mkt}
                    className={`about-global-card ${isLive ? 'about-global-card--live' : 'about-global-card--future'}`}
                    role="listitem"
                  >
                    <h4>{mkt}</h4>
                    <span className={`about-eco-badge ${isLive ? 'about-eco-badge--live' : 'about-eco-badge--future'}`}>
                      {isLive ? t('about.globalVision.live') : t('about.globalVision.future')}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="about-muted" style={{ marginTop: 10, fontSize: 12, fontStyle: 'italic' }}>
              {isFA ? 'هر آنچه Goldilocks نیست و هنوز پشتیبانی نمی‌شود باید با «Future» یا «به‌زودی» برچسب‌گذاری شود.' : 'Anything not currently supported is labeled Future / Coming Soon — never implied as live.'}
            </p>
          </section>

          {/* ================= PRINCIPLES ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-principles-title">
            <div className="about-section-label">{isFA ? 'اصول' : 'PRINCIPLES'}</div>
            <h2 id="about-principles-title">{t('about.principles.title')}</h2>
            <div className="about-principles">
              {[
                { t: 'principles.userControlTitle', b: 'principles.userControlBody' },
                { t: 'principles.automationTitle', b: 'principles.automationBody' },
                { t: 'principles.transparencyTitle', b: 'principles.transparencyBody' },
                { t: 'principles.openTitle', b: 'principles.openBody' },
                { t: 'principles.dataTitle', b: 'principles.dataBody' },
                { t: 'principles.improvementTitle', b: 'principles.improvementBody' },
              ].map((p) => (
                <div key={p.t} className="about-principle">
                  <h3>{t(`about.${p.t}`)}</h3>
                  <p>{t(`about.${p.b}`)}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ================= TECHNOLOGY STACK ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-stack-title">
            <div className="about-section-label">{isFA ? 'فناوری' : 'TECHNOLOGY'}</div>
            <h2 id="about-stack-title">{t('about.techStack.title')}</h2>
            <p className="about-muted">{t('about.techStack.subtitle')}</p>
            <div className="about-stack" role="list">
              {[
                { k: 'experience', n: '01' },
                { k: 'intent', n: '02' },
                { k: 'intelligence', n: '03' },
                { k: 'data', n: '04' },
                { k: 'decision', n: '05' },
                { k: 'execution', n: '06' },
                { k: 'verification', n: '07' },
              ].map((layer, i, arr) => (
                <span key={layer.k} style={{ display: 'contents' }}>
                  <div
                    className={`about-stack-layer about-stack-layer--${layer.k}`}
                    role="listitem"
                  >
                    <span className="about-stack-num" aria-hidden="true">
                      {layer.n}
                    </span>
                    <span>
                      <h4>{t(`about.techStack.${layer.k}`)}</h4>
                      <p>{t(`about.techStack.${layer.k}Desc`)}</p>
                    </span>
                  </div>
                  {i < arr.length - 1 && (
                    <span className="about-stack-arrow" aria-hidden="true">
                      ↓
                    </span>
                  )}
                </span>
              ))}
            </div>
            <p className="about-muted" style={{ marginTop: 12, fontSize: 12.5, fontStyle: 'italic' }}>
              {isFA ? 'این بخش باعث می‌شود FBT مانند یک شرکت فناوری به نظر برسد نه صرفاً یک وب‌سایت معاملاتی.' : 'This section makes FBT feel like a technology company rather than just a trading website.'}
            </p>
          </section>

          {/* ================= ROADMAP ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-roadmap-title">
            <div className="about-section-label">{isFA ? 'نقشه راه' : 'ROADMAP'}</div>
            <h2 id="about-roadmap-title">{t('about.roadmap.title')}</h2>
            <p className="about-muted">{t('about.roadmap.subtitle')}</p>
            <div className="about-roadmap" role="list">
              {[
                { k: 'phase1', n: '01', active: false },
                { k: 'phase2', n: '02', active: false },
                { k: 'phase3', n: '03', active: false },
                { k: 'phase4', n: '04', active: true },
                { k: 'phase5', n: '05', active: true },
                { k: 'phase6', n: '06', future: true },
                { k: 'future', n: '∞', future: true },
              ].map((ph) => (
                <div
                  key={ph.k}
                  className={`about-roadmap-step ${ph.active ? 'about-roadmap-step--active' : ''} ${ph.future ? 'about-roadmap-step--future' : ''}`}
                  role="listitem"
                >
                  <span className="about-roadmap-dot" aria-hidden="true">
                    {ph.n}
                  </span>
                  <span>
                    <h4>{t(`about.roadmap.${ph.k}Title`)}</h4>
                    <p>{t(`about.roadmap.${ph.k}Desc`)}</p>
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ================= PERSONAL FINANCIAL OS ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-personal-title">
            <div className="about-section-label">{isFA ? 'سیستم‌عامل مالی' : 'PERSONAL OS'}</div>
            <h2 id="about-personal-title">{t('about.personalOS.title')}</h2>
            <p className="about-lead">{t('about.personalOS.subtitle')}</p>
            <div className="about-personal-flow" role="list" aria-label={isFA ? 'جریان سیستم‌عامل مالی' : 'Personal OS flow'}>
              {(t('about.personalOS.flow', { returnObjects: true })).map((s, i, arr) => (
                <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="about-personal-step" role="listitem">
                    {s}
                  </span>
                  {i < arr.length - 1 && <span aria-hidden="true" style={{ color: 'var(--about-text-dim)' }}>→</span>}
                </span>
              ))}
            </div>
            <p className="about-disclaimer">{t('about.personalOS.note')}</p>
          </section>

          {/* ================= GLOBAL ACCESS ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-access-title">
            <div className="about-global-access">
              <div>
                <div className="about-section-label">{isFA ? 'دسترسی جهانی' : 'GLOBAL ACCESS'}</div>
                <h2 id="about-access-title">{t('about.globalAccess.title')}</h2>
                <p className="about-lead">{t('about.globalAccess.subtitle')}</p>
                <ul className="about-bullet-list" role="list">
                  {(t('about.globalAccess.bullets', { returnObjects: true })).map((b) => (
                    <li key={b} role="listitem">
                      {b}
                    </li>
                  ))}
                </ul>
                <p className="about-muted" style={{ marginTop: 12, fontSize: 12.5, fontStyle: 'italic' }}>
                  {t('about.globalAccess.note')}
                </p>
              </div>
              <div className="about-globe" aria-hidden="true">
                <div className="about-globe-grid" />
                <div className="about-globe-nodes">
                  {(t('about.globalAccess.bullets', { returnObjects: true })).map((b) => (
                    <span key={b} className="about-globe-node">
                      {b}
                    </span>
                  ))}
                  <span className="about-globe-node" style={{ background: 'linear-gradient(135deg, rgba(124,77,255,0.16), rgba(0,229,255,0.10))', color: '#d6ccff', borderColor: 'rgba(124,77,255,0.18)' }}>
                    FBT
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* ================= WHAT WE ARE — AND WHAT WE ARE NOT ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-trans-title">
            <div className="about-section-label">{isFA ? 'شفافیت' : 'TRANSPARENCY'}</div>
            <h2 id="about-trans-title">{t('about.transparency.title')}</h2>
            <p className="about-muted">{t('about.transparency.subtitle')}</p>
            <div className="about-transparency" style={{ marginTop: 16 }}>
              <div className="about-trans-card about-trans-card--are" role="region" aria-labelledby="about-are-title">
                <h3 id="about-are-title" style={{ color: '#00ff9d' }}>
                  ✓ {t('about.transparency.weAreTitle')}
                </h3>
                <ul className="about-trans-list" role="list">
                  {(t('about.transparency.weAre', { returnObjects: true })).map((x) => (
                    <li key={x} role="listitem">
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="about-trans-card about-trans-card--not" role="region" aria-labelledby="about-not-title">
                <h3 id="about-not-title" style={{ color: '#ff3b6b' }}>
                  ✕ {t('about.transparency.weAreNotTitle')}
                </h3>
                <ul className="about-trans-list" role="list">
                  {(t('about.transparency.weAreNot', { returnObjects: true })).map((x) => (
                    <li key={x} role="listitem">
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* ================= FAQ ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-faq-title">
            <div className="about-section-label">FAQ</div>
            <h2 id="about-faq-title">{t('about.faq.title')}</h2>
            <div className="about-faq" role="list">
              {Array.from({ length: 10 }, (_, i) => {
                const n = i + 1;
                const q = t(`about.faq.q${n}`);
                const a = t(`about.faq.a${n}`);
                return (
                  <details key={n} className="about-faq-item" role="listitem">
                    <summary>
                      <span>{q}</span>
                      <span className="about-faq-chevron" aria-hidden="true">
                        <IconArrowDown width={12} height={12} />
                      </span>
                    </summary>
                    <div className="about-faq-answer">{a}</div>
                  </details>
                );
              })}
            </div>
            <div className="about-disclaimer" style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: '#ffb300', flexShrink: 0, marginTop: 1 }}>
                <IconInfo width={16} height={16} />
              </span>
              <span>
                <strong>{t('about.faq.q6')}</strong> {t('about.faq.noProfit')}
              </span>
            </div>
          </section>

          {/* ================= INTERNAL SEO LINKS ================= */}
          <section className="about-section about-reveal" aria-labelledby="about-links-title">
            <div className="about-section-label">{isFA ? 'کاوش بیشتر' : 'EXPLORE'}</div>
            <h2 id="about-links-title" style={{ fontSize: 'clamp(20px, 3vw, 26px)' }}>
              {isFA ? 'بیشتر کاوش کنید' : 'Explore FBT Swap'}
            </h2>
            <nav className="about-seo-links" aria-label={isFA ? 'لینک‌های داخلی' : 'Internal links'}>
              <Link to="/swap" className="about-seo-link">
                {t('about.internalLinks.swap')} ↗
              </Link>
              <Link to="/wallet" className="about-seo-link">
                {t('about.internalLinks.wallet')} ↗
              </Link>
              <Link to="/signals" className="about-seo-link">
                {t('about.internalLinks.signals')} ↗
              </Link>
              <Link to="/solana" className="about-seo-link">
                {t('about.internalLinks.solana')} ↗
              </Link>
              <Link to="/intent" className="about-seo-link">
                {t('about.internalLinks.intentOS')} ↗
              </Link>
              <Link to="/orders" className="about-seo-link">
                {t('about.internalLinks.orders')} ↗
              </Link>
              <Link to="/farm" className="about-seo-link">
                {t('about.internalLinks.farms')} ↗
              </Link>
              <Link to="/explore" className="about-seo-link">
                {t('about.internalLinks.explore')} ↗
              </Link>
              <Link to="/ecosystem" className="about-seo-link">
                {t('about.internalLinks.ecosystem')} ↗
              </Link>
            </nav>
          </section>

          {/* ================= FOOTER ================= */}
          <footer className="about-footer" aria-label={isFA ? 'پاورقی' : 'Footer'}>
            <div className="about-footer-brand">
              <h4>FBT Swap</h4>
              <p>{t('about.heroSubtitle')}</p>
            </div>
            <div className="about-footer-col">
              <h5>{t('about.footer.product')}</h5>
              <ul>
                <li>
                  <Link to="/swap">{t('about.footer.swap')}</Link>
                </li>
                <li>
                  <Link to="/wallet">{t('about.footer.wallet')}</Link>
                </li>
                <li>
                  <Link to="/signals">{t('about.footer.signals')}</Link>
                </li>
                <li>
                  <Link to="/intent">{t('about.footer.intentOS')}</Link>
                </li>
                <li>
                  <Link to="/solana">{t('about.footer.solana')}</Link>
                </li>
                <li>
                  <Link to="/farm">{t('about.footer.farms')}</Link>
                </li>
                <li>
                  <Link to="/explore">{t('about.footer.explore')}</Link>
                </li>
              </ul>
            </div>
            <div className="about-footer-col">
              <h5>{t('about.footer.resources')}</h5>
              <ul>
                <li>
                  <Link to="/ecosystem">{t('about.footer.ecosystem')}</Link>
                </li>
                <li>
                  <Link to="/about">{t('about.footer.about')}</Link>
                </li>
                <li>
                  <a
                    href="#about-faq-title"
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById('about-faq-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    {t('about.footer.faq')}
                  </a>
                </li>
                <li>
                  <Link to="/audit">{t('about.footer.security')}</Link>
                </li>
              </ul>
            </div>
            <div className="about-footer-col">
              <h5>{t('about.footer.legal')}</h5>
              <ul>
                <li>
                  <Link to="/legal/terms">{t('about.footer.terms')}</Link>
                </li>
                <li>
                  <Link to="/legal/privacy">{t('about.footer.privacy')}</Link>
                </li>
                <li>
                  <Link to="/legal/terms">{t('about.footer.riskDisclosure')}</Link>
                </li>
              </ul>
            </div>
            <div className="about-footer-bottom">
              <span>© {new Date().getFullYear()} FBT Swap — {t('about.companyFull')}</span>
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <IconGlobe width={12} height={12} /> {isFA ? '۱۲ زبان' : '12 languages'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{chains.length + 1} {isFA ? 'شبکه' : 'networks'}</span>
              </span>
            </div>
          </footer>

          {/* ================= FINAL CTA ================= */}
          <section className="about-final about-reveal" aria-labelledby="about-final-title">
            <div className="about-eyebrow" style={{ margin: '0 auto 14px', background: 'rgba(124,77,255,0.12)', borderColor: 'rgba(124,77,255,0.18)', color: '#a78bfa' }}>
              {isFA ? 'آینده مالی' : 'INTENT FIRST'}
            </div>
            <h2 id="about-final-title">{t('about.finalCTA.title')}</h2>
            <p>{t('about.finalCTA.subtitle')}</p>
            <div className="about-final-ctas">
              <button type="button" className="about-btn-primary" onClick={() => navigate('/swap')}>
                {t('about.finalCTA.primary')} <span aria-hidden="true">↗</span>
              </button>
              <button type="button" className="about-btn-secondary" onClick={() => navigate('/intent')}>
                {t('about.finalCTA.secondary')}
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--about-text-dim)', marginTop: 16, maxWidth: 520, marginInline: 'auto' }}>
              {isFA
                ? 'داده‌های بازار اطلاع‌رسانی هستند و توصیه مالی نیستند. کریپتو پرنوسان است — فقط به اندازه توان از دست دادن معامله کنید.'
                : 'Market data is informational, not financial advice. Crypto is volatile — only trade what you can afford to lose.'}
            </p>
          </section>

          <div style={{ height: 24 }} aria-hidden="true" />
        </div>
      </div>
    </PageTransition>
  );
}
