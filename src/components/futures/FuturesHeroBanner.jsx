/**
 * FUTURES HERO BANNER — the futures desk's front door.
 * ---------------------------------------------------------------------------
 * «بنر بالایی باید مربوط به فیوچرز باشد نه پرپچوال» — the banner is now
 * FUTURES in identity, vocabulary and visual language:
 *
 *   · the eyebrow is «میز معاملات فیوچرز», never the word for perpetual;
 *   · a futures curve (contango spline from spot to expiry) is the centrepiece,
 *     replacing the order-book depth wings — a curve IS the futures aesthetic;
 *   · the HUD quotes BTC/ETH as futures contracts with a mark line, and the
 *     KPI strip answers futures questions: markets, benchmark, leverage,
 *     settlement;
 *   · the accent is the futures gold/amber signature — deliberately NOT the
 *     cyan «perpetual desk» palette.
 *
 * Motion is CSS-only, paused offscreen via IntersectionObserver, and fully
 * disabled under prefers-reduced-motion.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../styles/futures-hero-banner.css';

const fmtUsd = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${v.toPrecision(4)}`;
};

const fmtPct = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
};

const MODE_KEY = {
  spot: 'futures.banner.modeSpot',
  overview: 'futures.banner.modeFutures',
  dydx: 'futures.banner.modeDydx',
  onchain: 'futures.banner.modeOnchain'
};

export default function FuturesHeroBanner({
  activeTab = 'overview',
  marketCount = 0,
  btcPrice = null,
  btcChange = null,
  ethPrice = null,
  ethChange = null,
  liveReady = false
}) {
  const { t } = useTranslation();
  const rootRef = useRef(null);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.05 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const btcDelta = fmtPct(btcChange);
  const btcDir = !Number.isFinite(Number(btcChange)) ? 'is-flat' : Number(btcChange) >= 0 ? 'is-up' : 'is-down';
  const ethDelta = fmtPct(ethChange);
  const ethDir = !Number.isFinite(Number(ethChange)) ? 'is-flat' : Number(ethChange) >= 0 ? 'is-up' : 'is-down';

  return (
    <section
      ref={rootRef}
      className="fhb"
      data-mode={activeTab}
      data-inview={inView ? '1' : '0'}
      data-testid="futures-hero-banner"
    >
      <div className="fhb-backdrop" aria-hidden="true" />
      <div className="fhb-orbit" aria-hidden="true" />

      {/* ── status row ─────────────────────────────────────────────────── */}
      <div className="fhb-topbar">
        <div className="fhb-eyebrow">
          <span className="fhb-crest" aria-hidden="true">
            {/* futures crest: an ascending contract ladder */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l5-5 4 4 6.5-6.5L21 7" />
              <path d="M15 7h6v6" />
            </svg>
          </span>
          <span className="fhb-eyebrow-text">{t('futures.banner.eyebrow')}</span>
        </div>

        <div className="fhb-badges">
          <span className="fhb-pill">
            <span className={`fhb-dot ${liveReady ? 'is-live' : 'is-sync'}`} aria-hidden="true" />
            <span>{liveReady ? t('futures.banner.liveFeed') : t('futures.banner.syncingFeed')}</span>
          </span>
          <span className="fhb-pill is-mode">{t(MODE_KEY[activeTab] || MODE_KEY.overview)}</span>
        </div>
      </div>

      {/* ── identity + futures-curve HUD ───────────────────────────────── */}
      <div className="fhb-body">
        <div className="fhb-copy">
          <h1 className="fhb-title">
            <span className="fhb-word-fa">{t('futures.banner.wordmark')}</span>
            <span className="fhb-word-en" aria-hidden="true">{t('futures.banner.wordmarkEn')}</span>
          </h1>
          <p className="fhb-tagline">{t('futures.banner.tagline')}</p>
          <p className="fhb-subtitle">{t('futures.banner.subtitle')}</p>

          <div className="fhb-chips" aria-hidden="true">
            <span className="fhb-chip"><i style={{ background: '#14f195' }} />Solana</span>
            <span className="fhb-chip"><i style={{ background: '#38bdf8' }} />Arbitrum</span>
            <span className="fhb-chip"><i style={{ background: '#c084fc' }} />dYdX Chain</span>
            <span className="fhb-chip is-gold">{t('futures.banner.selfCustody')}</span>
          </div>
        </div>

        {/* The futures curve: spot → perp mark → dated expiry. Decorative,
            labelled as such; every number beside it is live. */}
        <div className="fhb-hud">
          <div className="fhb-hud-head">
            <span className="fhb-hud-title">
              <span className="fhb-hud-sym">BTC-FUT</span>
              <span className="fhb-hud-px mono">{fmtUsd(btcPrice)}</span>
            </span>
            <span className={`fhb-hud-chg mono ${btcDir}`}>{btcDelta ?? '—'}</span>
          </div>

          <svg className="fhb-curve" viewBox="0 0 320 96" preserveAspectRatio="none" role="img" aria-label={t('futures.banner.curveLabel')}>
            <defs>
              <linearGradient id="fhbCurveLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="55%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#fde68a" />
              </linearGradient>
              <linearGradient id="fhbCurveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
              </linearGradient>
              <radialGradient id="fhbMarkDot">
                <stop offset="0%" stopColor="#fde68a" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* horizontal reticles */}
            <line x1="0" y1="26" x2="320" y2="26" stroke="rgba(148,163,184,0.14)" strokeDasharray="3 5" />
            <line x1="0" y1="58" x2="320" y2="58" stroke="rgba(148,163,184,0.14)" strokeDasharray="3 5" />

            {/* contango spline — spot low-left rising to later expiries */}
            <path className="fhb-curve-fill" d="M8,78 C62,72 96,64 140,58 C182,52 214,40 252,30 C276,24 296,20 312,18 L312,96 L8,96 Z" fill="url(#fhbCurveFill)" />
            <path className="fhb-curve-line" d="M8,78 C62,72 96,64 140,58 C182,52 214,40 252,30 C276,24 296,20 312,18" fill="none" stroke="url(#fhbCurveLine)" strokeWidth="2.6" strokeLinecap="round" />
            {/* dashed "parity" baseline (spot) */}
            <line x1="8" y1="78" x2="312" y2="78" stroke="rgba(251,191,36,0.35)" strokeWidth="1" strokeDasharray="2 4" />

            {/* markers: expiry points */}
            <circle cx="140" cy="58" r="3.1" fill="#0b1020" stroke="#fbbf24" strokeWidth="1.6" />
            <circle cx="252" cy="30" r="3.1" fill="#0b1020" stroke="#fbbf24" strokeWidth="1.6" />
            <circle cx="312" cy="18" r="9" fill="url(#fhbMarkDot)" />
            <circle cx="312" cy="18" r="3.4" fill="#fde68a" />

            {/* lane captions */}
            <text x="8" y="90" className="fhb-curve-txt">SPOT</text>
            <text x="132" y="74" className="fhb-curve-txt">PERP</text>
            <text x="288" y="34" className="fhb-curve-txt">FUT</text>
          </svg>

          <div className="fhb-hud-foot">
            <span className="fhb-hud-eq mono">
              <span className="fhb-hud-eth-sym">ETH-FUT</span>
              <span>{fmtUsd(ethPrice)}</span>
              {ethDelta && <span className={ethDir === 'is-up' ? 'is-up' : ethDir === 'is-down' ? 'is-down' : ''}>{ethDelta}</span>}
            </span>
            <span className="fhb-hud-note">{t('futures.banner.curveNote')}</span>
          </div>
        </div>
      </div>

      {/* ── KPI strip ─────────────────────────────────────────────────── */}
      <div className="fhb-kpis">
        <div className="fhb-kpi">
          <span className="fhb-kpi-label">{t('futures.banner.statMarkets')}</span>
          <span className="fhb-kpi-val is-mono">{marketCount > 0 ? marketCount : '—'}</span>
        </div>
        <div className="fhb-kpi">
          <span className="fhb-kpi-label">{t('futures.banner.statBtc')}</span>
          <span className="fhb-kpi-val is-mono">
            <span>{fmtUsd(btcPrice)}</span>
            {btcDelta && <span className={`fhb-kpi-delta ${btcDir === 'is-up' ? 'is-up' : 'is-down'}`}>{btcDelta}</span>}
          </span>
        </div>
        <div className="fhb-kpi">
          <span className="fhb-kpi-label">{t('futures.banner.statMaxLev')}</span>
          <span className="fhb-kpi-val is-gold">{t('futures.banner.statMaxLevVal')}</span>
        </div>
        <div className="fhb-kpi">
          <span className="fhb-kpi-label">{t('futures.banner.statCustody')}</span>
          <span className="fhb-kpi-val is-gold">{t('futures.banner.statCustodyVal')}</span>
        </div>
      </div>
    </section>
  );
}
