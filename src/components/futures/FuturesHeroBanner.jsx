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
  spot: 'perp.banner.modeSpot',
  overview: 'perp.banner.modePerp',
  dydx: 'perp.banner.modeDydx',
  onchain: 'perp.banner.modeOnchain'
};

export default function FuturesHeroBanner({
  activeTab = 'overview',
  title,
  subtitle,
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

  return (
    <section
      ref={rootRef}
      className="fhb"
      data-mode={activeTab}
      data-inview={inView ? '1' : '0'}
      data-testid="futures-hero-banner"
    >
      <div className="fhb-backdrop" aria-hidden="true" />

      <div className="fhb-topbar">
        <div className="fhb-eyebrow">
          <span className="fhb-crest" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L3 7v6c0 5.25 3.75 9.75 9 11 5.25-1.25 9-5.75 9-11V7l-9-5z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </span>
          <span className="fhb-eyebrow-text">
            {t('perp.banner.eyebrow', { defaultValue: 'Non-Custodial Derivatives · Direct Wallet Settlement' })}
          </span>
        </div>

        <div className="fhb-badges">
          <span className="fhb-pill">
            <span className={`fhb-dot ${liveReady ? 'is-live' : 'is-sync'}`} aria-hidden="true" />
            <span>
              {liveReady
                ? t('perp.banner.liveFeed', { defaultValue: 'Live Oracle & Venue Feed' })
                : t('perp.banner.syncingFeed', { defaultValue: 'Syncing Market Feed' })}
            </span>
          </span>
          <span className="fhb-pill is-mode">
            {t(MODE_KEY[activeTab] || MODE_KEY.overview, { defaultValue: 'Perpetual Desk' })}
          </span>
        </div>
      </div>

      <div className="fhb-body">
        <div className="fhb-copy">
          <h1 className="fhb-title">{title}</h1>
          <p className="fhb-subtitle">{subtitle}</p>
          <div className="fhb-chains" aria-hidden="true">
            <span className="fhb-chain-chip"><i style={{ background: '#14f195' }} />Solana</span>
            <span className="fhb-chain-chip"><i style={{ background: '#38bdf8' }} />Arbitrum</span>
            <span className="fhb-chain-chip"><i style={{ background: '#a855f7' }} />dYdX Chain</span>
          </div>
        </div>

        {/* Bespoke Derivatives Depth + Trajectory Vector Stage */}
        <div className="fhb-stage" aria-hidden="true">
          <div className="fhb-hud-head">
            <span className="fhb-hud-ticker">
              <span className="fhb-hud-sym">BTC-PERP</span>
              <span className="fhb-hud-px">{fmtUsd(btcPrice)}</span>
            </span>
            <span className={`fhb-hud-chg ${btcDir}`}>
              {btcDelta ?? '—'}
            </span>
          </div>

          <svg className="fhb-svg" viewBox="0 0 320 86" preserveAspectRatio="none">
            <defs>
              <linearGradient id="fhbBidGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="fhbAskGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.30" />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="fhbPulseLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="55%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
            </defs>

            {/* Horizontal reticle guides */}
            <line x1="0" y1="22" x2="320" y2="22" stroke="rgba(148,163,184,0.12)" strokeDasharray="3 4" />
            <line x1="0" y1="54" x2="320" y2="54" stroke="rgba(148,163,184,0.12)" strokeDasharray="3 4" />

            {/* Bid / Ask stylized depth wings */}
            <path
              d="M0,34 L38,34 L38,44 L76,44 L76,56 L116,56 L116,68 L154,76 L154,86 L0,86 Z"
              fill="url(#fhbBidGrad)"
            />
            <path
              d="M0,34 L38,34 L38,44 L76,44 L76,56 L116,56 L116,68 L154,76"
              fill="none"
              stroke="#10b981"
              strokeOpacity="0.55"
              strokeWidth="1.4"
            />
            <path
              d="M166,76 L202,65 L202,52 L244,52 L244,38 L284,38 L284,26 L320,26 L320,86 L166,86 Z"
              fill="url(#fhbAskGrad)"
            />
            <path
              d="M166,76 L202,65 L202,52 L244,52 L244,38 L284,38 L284,26 L320,26"
              fill="none"
              stroke="#f43f5e"
              strokeOpacity="0.52"
              strokeWidth="1.4"
            />

            {/* Midpoint vertical reticle */}
            <line x1="160" y1="8" x2="160" y2="82" stroke="rgba(148,163,184,0.28)" strokeDasharray="2 3" />

            {/* Price trajectory spline */}
            <path
              d="M6,64 C42,60 58,46 92,49 C126,52 146,34 182,37 C216,40 242,20 278,24 C294,25 304,17 314,15"
              fill="none"
              stroke="url(#fhbPulseLine)"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <circle cx="314" cy="15" r="4" fill="#34d399" />
            <circle cx="314" cy="15" r="8" fill="#34d399" fillOpacity="0.24" />
          </svg>

          <div className="fhb-hud-foot">
            <span className="fhb-hud-eth">
              <span>ETH-PERP</span>
              <span>{fmtUsd(ethPrice)}</span>
              {ethDelta && (
                <span style={{ color: Number(ethChange) >= 0 ? '#34d399' : '#fb7185' }}>
                  {ethDelta}
                </span>
              )}
            </span>
            <span>CLOB + AMM</span>
          </div>
        </div>
      </div>

      <div className="fhb-kpis">
        <div className="fhb-kpi">
          <span className="fhb-kpi-label">
            {t('perp.banner.statMarkets', { defaultValue: 'Active Markets' })}
          </span>
          <span className="fhb-kpi-val is-mono">
            {marketCount > 0 ? marketCount : '—'}
          </span>
        </div>

        <div className="fhb-kpi">
          <span className="fhb-kpi-label">
            {t('perp.banner.statBtc', { defaultValue: 'BTC Benchmark' })}
          </span>
          <span className="fhb-kpi-val is-mono">
            <span>{fmtUsd(btcPrice)}</span>
            {btcDelta && (
              <span className={`fhb-kpi-delta ${Number(btcChange) >= 0 ? 'is-up' : 'is-down'}`}>
                {btcDelta}
              </span>
            )}
          </span>
        </div>

        <div className="fhb-kpi">
          <span className="fhb-kpi-label">
            {t('perp.banner.statMaxLev', { defaultValue: 'Max Leverage' })}
          </span>
          <span className="fhb-kpi-val">
            {t('perp.banner.statMaxLevVal', { defaultValue: 'Up to 50×' })}
          </span>
        </div>

        <div className="fhb-kpi">
          <span className="fhb-kpi-label">
            {t('perp.banner.statCustody', { defaultValue: 'Custody Model' })}
          </span>
          <span className="fhb-kpi-val">
            {t('perp.banner.statCustodyVal', { defaultValue: 'Self-Custody' })}
          </span>
        </div>
      </div>
    </section>
  );
}
