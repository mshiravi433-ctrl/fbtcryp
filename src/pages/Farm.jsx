import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import '../styles/farm-venue.css';
import '../styles/farm-modern.css';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import AdBanner from '../components/AdBanner';
import SegIndicator from '../components/SegIndicator';
import ModernSelect from '../components/ModernSelect';
import AssetIcon from '../components/AssetIcon';
import TokenIcon from '../lib/tokenIcon';
import { fmtCompact, fmtUsd } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { IconLock, IconPools, IconShield, IconSwap } from '../components/Icons';
import { useHideBalances } from '../hooks/useHideBalances';
import { useFarmYields } from '../hooks/useFarmYields';
import PoolHistory from '../components/Farm/PoolHistory';
import PoolGlyph from '../components/Farm/PoolGlyph';
import FullScreenSheet from '../components/FullScreenSheet';
import { TOKENS } from '../lib/chains';
import {
  farmScore, impermanentLoss, investRoute, pairSwapRoute, pairTokens,
  projectEarnings, rateIsUnusual, realShare
} from '../lib/yields';
import { getSolanaAssets, MIN_EQUITY_LIQUIDITY, projectStake, yieldForLst } from '../lib/solanaAssetsClient';
import { LST_ASSETS } from '../lib/solanaAssets';
import {
  AUTOCOMPOUND_PROJECTS, buildYieldStrategies, chainIconKey, emitFarmEvent, fbtFeeEngine, FARM_PROTOCOL,
  farmPoolResearch, farmProtocolSummary, normalizeFarmOpportunity, projectDisplayName, VAULT_PROJECTS
} from '../lib/farmDeFi';
import FarmPositionHub, { FARM_EXECUTION_ADAPTERS, farmExecutionAdapterFor } from '../components/Farm/FarmPositionHub';
import VenueRail from '../components/Farm/VenueRail';
import { feedErrorLabel } from '../lib/defi/farmErrors';
import TrendChart from '../components/TrendChart';
import FarmOrbMark from '../components/farm/FarmOrbMark';

const FARM_TABS = ['inapp', 'recommended', 'market', 'strategies', 'pools'];
const EXECUTION_LIVE = FARM_EXECUTION_ADAPTERS.some((adapter) => adapter.openToPublic);
const FILTERS = ['all', 'stable', 'blueChip', 'highYield', 'lowRisk', 'autoCompound', 'lp', 'staking', 'vault'];
const AMOUNTS = [100, 1000, 10000];
const HORIZONS = ['day', 'week', 'month', 'year'];

const ETH_STAKE_JOIN = {
  stETH: { project: 'lido', feedSymbol: 'STETH' },
  rETH: { project: 'rocket-pool', feedSymbol: 'RETH' },
  wstETH: { project: 'lido', feedSymbol: 'WSTETH' },
  weETH: { project: 'ether.fi-stake', feedSymbol: 'WEETH' }
};
const ethStakeTokens = (TOKENS[1] ?? []).filter((tk) => tk.stake === 'eth');
const GOLD_TOKENS = ['PAXG', 'XAUt'];

const chainLabel = (name, t) => t(`farm.chainLabels.${name}`, { defaultValue: name });
const projectLabel = (slug, t) => t(`farm.projectLabels.${slug}`, { defaultValue: projectDisplayName(slug) });

const GLOBE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.6 2.6 3.9 5.6 3.9 9S14.6 18.4 12 21c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z" />
  </svg>
);
const SCORE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8-5.3-2.9-5.3 2.9 1.1-5.8L3.5 9.7l5.9-.8z" />
  </svg>
);
const APY_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 17l5-5 4 4 7-7" />
    <path d="M15 9h5v5" />
  </svg>
);
const TVL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2z" />
    <path d="M4 7.2l8 4.4 8-4.4" />
    <path d="M12 11.6v9.6" />
  </svg>
);
const SORT_ICONS = { score: SCORE_ICON, apy: APY_ICON, tvlUsd: TVL_ICON };

/* modern tab icons */
const TAB_ICONS = {
  inapp: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 4l9 5.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-8z" />
      <path d="M9 19.5V12h6v7.5" />
    </svg>
  ),
  recommended: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8-5.3-2.9-5.3 2.9 1.1-5.8L3.5 9.7l5.9-.8z" />
    </svg>
  ),
  market: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 19v-6" /><path d="M12.5 19V8.5" /><path d="M17 19v-4" />
    </svg>
  ),
  strategies: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.8 5.6L21 10l-4.5 4.3L17.6 21 12 18.1 6.4 21l1.1-6.7L3 10l6.2-2.4z" />
    </svg>
  ),
  pools: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
};

const FILTER_ICONS = {
  all: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
  stable: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" /></svg>
  ),
  blueChip: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l4 6-10 12L2 9z" /><path d="M11 3L8 9l4 12" /><path d="M13 3l3 6-4 12" /></svg>
  ),
  highYield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l5-5 4 4 7-7" /><path d="M15 9h5v5" /></svg>
  ),
  lowRisk: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.2 20 6v6.2c0 4.2-3.2 7-8 8.6-4.8-1.6-8-4.4-8-8.6V6z" /></svg>
  ),
  autoCompound: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /><path d="M8 12a4 4 0 1 0 4-4" /></svg>
  ),
  lp: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /><path d="M16 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /><path d="M11.5 10.5l1 1" /></svg>
  ),
  staking: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l7 4v6c0 5-3.2 8.5-7 10-3.8-1.5-7-5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
  ),
  vault: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M7 8V6a5 5 0 0 1 10 0v2" /><circle cx="12" cy="14" r="2" /></svg>
  )
};

const SEARCH_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="6" /><path d="M20 20l-3.5-3.5" />
  </svg>
);

const REFRESH_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" />
  </svg>
);

const STATS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 19v-6" /><path d="M12.5 19V8.5" /><path d="M17 19v-4" />
  </svg>
);
const RISK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3.2 20 6v6.2c0 4.2-3.2 7-8 8.6-4.8-1.6-8-4.4-8-8.6V6z" /><path d="M12 9v4.4" /><path d="M12 16.4h.01" />
  </svg>
);
const ACTIONS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12h6l1.8-4 2.4 8L16 12h4" />
  </svg>
);

function AnaSection({ icon, title, children }) {
  return (
    <section className="farm-ana-section">
      <div className="farm-ana-section-head">
        <span className="farm-ana-section-icon" aria-hidden="true">{icon}</span>
        <p className="farm-ana-section-title">{title}</p>
      </div>
      {children}
    </section>
  );
}

function RiskPill({ risk, t }) {
  const normalized = ['low', 'medium', 'high'].includes(risk) ? risk : 'high';
  const cls = normalized === 'low' ? 'pill-neutral' : normalized === 'medium' ? 'pill-rgb' : 'pill-down';
  return <span className={`pill ${cls}`}>{t(`farm.risk.${normalized}`)}</span>;
}

function FreshnessPill({ freshness, t }) {
  const status = freshness || 'UNAVAILABLE';
  const cls = status === 'FRESH' ? 'pill-neutral' : status === 'STALE' ? 'pill-rgb' : 'pill-down';
  return <span className={`pill ${cls}`}>{t(`farm.freshness.${status}`, { defaultValue: status })}</span>;
}

function Metric({ label, value, unavailable, strong, tone }) {
  return (
    <div className={`farm-metric${tone ? ` farm-metric-${tone}` : ''}`}>
      <span className="faint">{label}</span>
      <span className={`mono ${strong ? 'farm-metric-strong' : ''}`}>{unavailable ? '—' : value}</span>
    </div>
  );
}

function HorizonEarningsChart({ pool, amount, t }) {
  const proj = useMemo(() => projectEarnings(pool, amount), [pool, amount]);
  const points = useMemo(() => {
    if (!proj) return [];
    return HORIZONS.map((h, i) => ({ x: i, y: Math.max(0, Number(proj[h]) || 0) }));
  }, [proj]);
  if (!proj || points.length < 2) return null;
  const yearUp = Number(proj.year) >= 0;
  return (
    <section className="farm-horizon-chart" aria-label={t('farm.horizonChartTitle')}>
      <div className="farm-horizon-chart-head">
        <p className="farm-horizon-chart-title">{t('farm.horizonChartTitle')}</p>
        <p className="farm-horizon-chart-sub">{t('farm.horizonChartSub', { amount: fmtUsd(amount) })}</p>
      </div>
      <TrendChart
        points={points}
        height={96}
        up={yearUp}
        emptyLabel={t('farm.horizonChartEmpty')}
        formatValue={(v) => fmtUsd(v)}
        testId={`farm-horizon-${pool.id}`}
      />
      <div className="farm-horizon-rail">
        {HORIZONS.map((h) => (
          <div key={h} className={`farm-horizon-cell${h === 'year' ? ' is-year' : ''}`}>
            <span>{t(`farm.${h}`)}</span>
            <span className="mono" dir="ltr">{fmtUsd(proj[h])}</span>
          </div>
        ))}
      </div>
      <p className="faint farm-calc-cond" style={{ marginTop: 8 }}>
        {t('farm.rateConditional')}
        {proj.fromRealYield != null && (
          <> · {t('farm.realShareMoney', { amount: fmtUsd(proj.fromRealYield) })}</>
        )}
      </p>
    </section>
  );
}

function FeeEngineCard({ pool, amount, t }) {
  const fee = fbtFeeEngine.quoteOperation({ amountUsd: amount, protocolFeeUsd: null, gasUsd: null });
  const yieldEst = fbtFeeEngine.estimateNetYield({
    grossApy: Number(pool.apy),
    protocolCostApy: 0,
    gasUsd: null,
    amountUsd: amount
  });
  if (fee?.status === 'UNAVAILABLE' && yieldEst?.status === 'UNAVAILABLE') return null;
  const beforeGas = Number.isFinite(Number(pool.apy))
    ? Math.max(-100, Number(pool.apy) - (yieldEst?.fbtFeeApy || 0))
    : null;
  return (
    <section className="farm-engine-card" aria-label={t('farm.engineTitle')}>
      <div className="farm-engine-card-head">
        <p className="farm-engine-card-title">{t('farm.engineTitle')}</p>
        <span className="pill pill-neutral">{t('farm.engineMode')}</span>
      </div>
      <div className="farm-engine-grid">
        <Metric label={t('farm.amount')} value={fmtUsd(amount)} />
        <Metric
          label={t('farm.fbtFee')}
          value={fee?.status === 'AVAILABLE'
            ? `${fmtUsd(fee.fbtFeeUsd)} (${(fee.fbtFeeBps / 100).toFixed(2)}%)`
            : null}
          unavailable={fee?.status !== 'AVAILABLE'}
        />
        <Metric
          label={t('farm.grossApy')}
          value={Number.isFinite(Number(pool.apy)) ? `${pool.apy}%` : null}
          unavailable={!Number.isFinite(Number(pool.apy))}
        />
        <Metric
          label={t('farm.netBeforeGas')}
          value={beforeGas == null ? null : `${beforeGas.toFixed(2)}%`}
          unavailable={beforeGas == null}
          strong
        />
      </div>
      <p className="faint" style={{ margin: '8px 1px 0', fontSize: 10.8, lineHeight: 1.6 }}>
        {t('farm.engineNote')}
      </p>
    </section>
  );
}

function SplitBar({ pool, t }) {
  const share = realShare(pool);
  if (share == null) return null;
  const real = Math.round(share * 100);
  return (
    <div style={{ marginTop: 9 }}>
      <div className="farm-split" role="img" aria-label={t('farm.splitLine', { real, emissions: 100 - real })}>
        <div className="farm-split-real" style={{ width: `${real}%` }} />
      </div>
      <p className="faint farm-split-legend">{t('farm.splitLine', { real, emissions: 100 - real })}</p>
    </div>
  );
}

function UnusualNote({ pool, t }) {
  const unusual = rateIsUnusual(pool);
  if (!unusual) return null;
  return (
    <p className={`farm-unusual ${unusual.direction === 'above' ? 'farm-unusual-above' : ''}`}>
      {t(`farm.unusual.${unusual.direction}`, { ratio: unusual.ratio, mean: unusual.mean })}
    </p>
  );
}

function EarningsLine({ pool, amount, t }) {
  const proj = projectEarnings(pool, amount);
  if (!proj) return null;
  return (
    <div>
      <div className="farm-calc">
        <span className="faint">{t('farm.wouldEarn', { amount: fmtUsd(amount) })}</span>
        <span className="farm-calc-num mono" dir="ltr">{fmtUsd(proj.year)}</span>
      </div>
      <p className="faint farm-calc-cond">
        {t('farm.rateConditional')}
        {proj.fromRealYield != null && (
          <> · {t('farm.realShareMoney', { amount: fmtUsd(proj.fromRealYield) })}</>
        )}
      </p>
    </div>
  );
}

function ILToy({ pool, t }) {
  const [open, setOpen] = useState(false);
  const [move, setMove] = useState('1.5');
  const isPair = pairTokens(pool).length > 1 || pool.ilRisk;
  if (!isPair) return <span className="pill pill-neutral">{t('farm.noIl')}</span>;
  const il = impermanentLoss(Number(move));
  return (
    <div className="farm-il">
      <button type="button" className="farm-il-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {t('farm.ilToyTitle')}
      </button>
      {open && (
        <div className="farm-il-body">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="faint">{t('farm.ilMultiple')}</span>
            <input
              className="farm-il-input"
              inputMode="decimal"
              value={move}
              onChange={(e) => setMove(e.target.value.replace(/[^\d.]/g, ''))}
              aria-label={t('farm.ilMultiple')}
            />
            <span className="mono" aria-hidden="true">×</span>
          </div>
          <div className="farm-il-out mono" dir="ltr">{il == null ? '—' : `${(il * 100).toFixed(1)}%`}</div>
          <p className="faint farm-il-note">{t('farm.ilFeeNote')}</p>
        </div>
      )}
    </div>
  );
}

function InvestButton({ pool, route, onGetTokens, t }) {
  const pairRoute = pairSwapRoute(pool);
  if (!route) return <span className="farm-unavailable-action faint">{t('farm.noRouteHint')}</span>;
  const label = pairRoute
    ? t('farm.getTokens', { a: route.from, b: route.to })
    : t('farm.stakeNow', { sym: route.to });
  return (
    <button className="btn btn-ghost farm-btn" onClick={() => onGetTokens(route)}>
      <IconSwap width={15} height={15} /> {label}
    </button>
  );
}

function ProtocolStatusCard({ protocol, t }) {
  const status = protocol?.status || 'CONNECTING';
  const [open, setOpen] = useState(() => status === 'UNAVAILABLE' || Boolean(protocol?.error));
  const statusLabel = status === 'ACTIVE'
    ? t('farm.protocolActive')
    : status === 'UNAVAILABLE' ? t('farm.protocolUnavailable') : status === 'STALE' ? t('farm.freshness.STALE') : t('farm.protocolConnecting');
  const updated = protocol?.updatedAt
    ? new Date(protocol.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';
  const source = protocol?.source || FARM_PROTOCOL.source;
  const capabilities = (protocol?.capabilities || FARM_PROTOCOL.capabilities).join(' · ');

  return (
    <motion.section className={`card card-rgb card-glow-cyan farm-protocol-card ${open ? 'is-open' : ''}`} variants={riseIn} initial="hidden" animate="show">
      <button
        type="button"
        className="farm-protocol-head farm-protocol-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="farm-protocol-icon" aria-hidden="true">
          <IconShield width={20} height={20} />
        </span>
        <span className="farm-protocol-id" style={{ minWidth: 0 }}>
          <span className="farm-protocol-title">{t('farm.protocolConnected')}</span>
          <span className="farm-protocol-sub">{FARM_PROTOCOL.name}</span>
        </span>
        <span className={`pill ${status === 'ACTIVE' ? 'pill-neutral' : status === 'UNAVAILABLE' ? 'pill-down' : 'pill-rgb'}`}>{statusLabel}</span>
        <span className="farm-protocol-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>

      {open && <>
      <div className="farm-protocol-readout">
        <span className="pill pill-neutral">
          {EXECUTION_LIVE
            ? <><IconShield width={12} height={12} /> {t('farm.executionLive')}</>
            : <><IconLock width={12} height={12} /> {t('farm.readOnly')}</>}
        </span>
        <span className="farm-protocol-live" aria-hidden="true">
          <i />
          <span className="faint">{EXECUTION_LIVE ? t('farm.protocolModeExec') : t('farm.protocolMode')}</span>
        </span>
      </div>
      <div className="farm-protocol-meta">
        <div className="farm-protocol-meta-cell">
          <span className="faint">{t('farm.protocolSource')}</span>
          <span className="mono" dir="ltr" title={source}>{source}</span>
        </div>
        <div className="farm-protocol-meta-cell">
          <span className="faint">{t('farm.protocolPools')}</span>
          <span className="mono">{protocol?.poolCount ?? 0}</span>
        </div>
        <div className="farm-protocol-meta-cell">
          <span className="faint">{t('farm.protocolLastSync')}</span>
          <span className="mono">{updated}</span>
        </div>
        <div className="farm-protocol-meta-cell">
          <span className="faint">{t('farm.protocolCapabilities')}</span>
          <span className="mono" dir="ltr" title={capabilities}>{capabilities}</span>
        </div>
      </div>
      {protocol?.error && <p className="faint" style={{ margin: '7px 14px 12px' }}>{feedErrorLabel(protocol.error, t)}</p>}
      </>}
    </motion.section>
  );
}

function PoolCard({ pool, amount, expanded, selected, onToggle, onShowDetails, onGetTokens, onOpenPool, t }) {
  const route = investRoute(pool);
  const executable = Boolean(farmExecutionAdapterFor(pool)?.openToPublic);
  const economics = fbtFeeEngine.estimateNetYield({
    grossApy: pool.apy,
    protocolCostApy: 0,
    gasUsd: null,
    amountUsd: amount
  });
  const beforeGas = Math.max(-100, Number(pool.apy || 0) - economics.fbtFeeApy);
  const iconKey = chainIconKey(pool.chain);

  return (
    <motion.article className={`farm-pool ${selected ? 'farm-pool-selected' : ''} ${expanded ? 'is-open' : ''}`} variants={riseIn} id={`farm-pool-${pool.id}`}>
      <button
        type="button"
        className="farm-pool-toggle"
        aria-expanded={expanded}
        onClick={() => onToggle(pool)}
        title={`${pool.symbol} · ${projectLabel(pool.project, t)} · ${chainLabel(pool.chain, t)}`}
      >
        <span className="farm-pool-icon" aria-hidden="true">
          <PoolGlyph pool={pool} size={38} chainKey={iconKey} />
        </span>
        <span className="farm-pool-id">
          <span className="farm-pool-sym" dir="ltr">{pool.symbol}</span>
          <span className="farm-pool-meta">{projectLabel(pool.project, t)} · {chainLabel(pool.chain, t)}</span>
        </span>
        <span className="farm-apy-wrap">
          <span className="farm-apy mono" dir="ltr">{pool.apy}%</span>
          <span className="faint farm-apy-label">{t('farm.estimatedApy')}</span>
        </span>
        <span className="farm-pool-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
      </button>

      {expanded && (
        <div className="farm-pool-body">
          <div className="farm-card-badges">
            {executable && <span className="pill pill-neutral farm-exec-badge" data-testid={`farm-exec-badge-${pool.id}`}>{t('farm.execBadge')}</span>}
            <RiskPill risk={pool.risk} t={t} />
            <span className="pill pill-neutral">{chainLabel(pool.chain, t)}</span>
            <span className="pill pill-neutral">{pool.type === 'staking' ? t('farm.category.staking') : t('farm.category.lp')}</span>
            {pool.stablecoin && <span className="pill pill-neutral">{t('farm.stableShort')}</span>}
            {pool.ilRisk && <span className="pill pill-down">{t('farm.ilShort')}</span>}
            {pool.score != null && <span className="pill pill-neutral">{t('farm.score', { score: pool.score })}</span>}
            <FreshnessPill freshness={pool.freshness} t={t} />
          </div>

          {pool.poolMeta && <p className="faint" style={{ margin: '7px 0 0', fontSize: 11.5 }}>{pool.poolMeta}</p>}

          <SplitBar pool={pool} t={t} />
          <UnusualNote pool={pool} t={t} />
          <EarningsLine pool={pool} amount={amount} t={t} />

          <div className="farm-metrics-grid">
            <Metric label={t('farm.tvl')} value={fmtCompact(pool.tvlUsd)} />
            <Metric label={t('farm.apr')} value={pool.apr == null ? null : `${pool.apr}%`} unavailable={pool.apr == null} />
            <Metric label={t('farm.volume24h')} value={pool.volumeUsd1d == null ? null : fmtCompact(pool.volumeUsd1d)} unavailable={pool.volumeUsd1d == null} />
            <Metric label={t('farm.rewardApr')} value={pool.rewardApr == null ? null : `${pool.rewardApr}%`} unavailable={pool.rewardApr == null} />
            <Metric label={t('farm.fbtFee')} value={`${economics.fbtFeeApy.toFixed(2)}%`} />
            <Metric label={t('farm.netBeforeGas')} value={`${beforeGas.toFixed(2)}%`} strong />
          </div>
          <p className="faint farm-source-line">
            {t('farm.sourceLine', { source: pool.source, time: pool.updatedAt ? new Date(pool.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—' })}
          </p>

          <ILToy pool={pool} t={t} />

          <div className="farm-actions">
            <InvestButton pool={pool} route={route} onGetTokens={onGetTokens} t={t} />
            <button
              className="btn btn-ghost farm-btn"
              onClick={() => onShowDetails(pool)}
              aria-expanded={selected}
              data-testid={`farm-view-analytics-${pool.id}`}
            >
              {selected ? t('farm.hideAnalytics') : t('farm.viewAnalytics')}
            </button>
          </div>
        </div>
      )}
    </motion.article>
  );
}

function PoolDetails({ pool, amount, wallet, onGetTokens, onOpenPool, onClose, t }) {
  const route = investRoute(pool);
  const fee = fbtFeeEngine.quoteOperation({ amountUsd: amount, protocolFeeUsd: null, gasUsd: null });
  const feeYield = fbtFeeEngine.estimateNetYield({ grossApy: Number(pool.apy), protocolCostApy: 0, gasUsd: null, amountUsd: amount });
  const factors = pool.riskFactors || {};
  const research = useMemo(() => farmPoolResearch(pool), [pool]);
  const gross = Number(pool.apy);
  const netAnalysisApy = Number.isFinite(gross) ? Math.max(-100, gross - (feeYield?.fbtFeeApy || 0)) : null;
  const realPct = research.realShare == null ? null : Math.round(research.realShare * 100);
  const rewardPct = research.emissionShare == null ? null : Math.round(research.emissionShare * 100);
  const mean30 = research.apyMean30d ?? research.unusual?.mean ?? null;
  const updateTime = pool.updatedAt ? new Date(pool.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
  const isPair = pairTokens(pool).length > 1 || pool.ilRisk;
  const execution = farmExecutionAdapterFor(pool);
  const ExecutionPanel = execution?.openToPublic ? execution.Panel : null;
  const hasInlineActions = Boolean(route || pool.url);
  const inlineActionsRef = useRef(null);
  const [inlineActionsVisible, setInlineActionsVisible] = useState(false);

  useEffect(() => {
    setInlineActionsVisible(false);
    const target = inlineActionsRef.current;
    const root = target?.closest('.fsh-body');
    if (!hasInlineActions || !target || !root || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setInlineActionsVisible(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.35));
    }, { root, threshold: [0, 0.35] });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasInlineActions, pool.id]);

  return (
    <FullScreenSheet
      open
      onClose={onClose}
      testId="farm-analysis-sheet"
      className="farm-ana-fs"
      kicker={t('farm.poolAnalytics')}
      title={pool.symbol}
      subtitle={`${projectLabel(pool.project, t)} · ${chainLabel(pool.chain, t)}`}
      icon={<PoolGlyph pool={pool} size={22} chainKey={chainIconKey(pool.chain)} />}
      closeLabel={t('farm.hideAnalytics')}
      footerVisible={!inlineActionsVisible}
      footer={(
        <div className={`farm-ana-foot${route && pool.url ? ' has-two-actions' : ''}`}>
          <InvestButton pool={pool} route={route} onGetTokens={onGetTokens} t={t} />
          {pool.url && (
            <button
              type="button"
              className="btn btn-ghost farm-btn farm-btn-minor"
              onClick={() => onOpenPool(pool.url)}
              title={t('farm.openPoolHint')}
            >
              {t('farm.openPool')}
            </button>
          )}
        </div>
      )}
    >
    <motion.section className="farm-details farm-details-full" variants={riseIn} initial="hidden" animate="show" aria-live="polite">
      <header className="farm-ana-hero">
        <div className="farm-ana-hero-top">
          <div className="farm-ana-rate-label">
            <span className="farm-ana-rate-icon" aria-hidden="true">{APY_ICON}</span>
            <span className="farm-ana-rate-copy">
              <span className="farm-ana-kicker">{t('farm.estimatedApy')}</span>
              <span className="farm-ana-rate-caption">{t('farm.grossApy')}</span>
            </span>
          </div>
          <div className="farm-ana-apy">
            <span className="farm-ana-apy-value mono" dir="ltr">{pool.apy}%</span>
          </div>
        </div>
        <div className="farm-ana-pills">
          <span className="pill pill-neutral">{FARM_PROTOCOL.name}</span>
          <span className="pill pill-neutral">{pool.type === 'staking' ? t('farm.category.staking') : t('farm.category.lp')}</span>
          {pool.score != null && <span className="pill pill-neutral">{t('farm.score', { score: pool.score })}</span>}
          {pool.stablecoin && <span className="pill pill-neutral">{t('farm.stableShort')}</span>}
          <FreshnessPill freshness={pool.freshness} t={t} />
          <RiskPill risk={pool.risk} t={t} />
        </div>
        {pool.poolMeta && <p className="faint farm-ana-note">{t('farm.poolMeta')}: {pool.poolMeta}</p>}
        <SplitBar pool={pool} t={t} />
        <UnusualNote pool={pool} t={t} />
      </header>

      <AnaSection icon={STATS_ICON} title={t('farm.ana.stats')}>
      <div className="farm-economics">
        <Metric label={t('farm.amount')} value={fmtUsd(amount)} />
        <Metric label={t('farm.protocol')} value={projectLabel(pool.project, t)} />
        <Metric label={t('farm.network')} value={chainLabel(pool.chain, t)} />
        <Metric label={t('farm.tvl')} value={fmtCompact(pool.tvlUsd)} />
        <Metric label={t('farm.volume24h')} value={pool.volumeUsd1d == null ? null : fmtCompact(pool.volumeUsd1d)} unavailable={pool.volumeUsd1d == null} />
        <Metric label={t('farm.volume7d')} value={research.volumeUsd7d == null ? null : fmtCompact(research.volumeUsd7d)} unavailable={research.volumeUsd7d == null} />
        <Metric label={t('farm.grossApy')} value={`${pool.apy}%`} tone="apy" />
        <Metric label={t('farm.apyBase')} value={research.apyBase == null ? null : `${research.apyBase}%`} unavailable={research.apyBase == null} tone="real" />
        <Metric label={t('farm.apyReward')} value={research.apyReward == null ? null : `${research.apyReward}%`} unavailable={research.apyReward == null} tone="emission" />
        <Metric label={t('farm.apr')} value={pool.apr == null ? null : `${pool.apr}%`} unavailable={pool.apr == null} />
        <Metric label={t('farm.rewardApr')} value={pool.rewardApr == null ? null : `${pool.rewardApr}%`} unavailable={pool.rewardApr == null} tone="emission" />
        <Metric label={t('farm.protocolFees')} value={t('farm.includedInApy')} />
        <Metric label={t('farm.gasEstimate')} unavailable />
        <Metric label={t('farm.fbtFee')} value={`${fmtUsd(fee.fbtFeeUsd)} (${(fee.fbtFeeBps / 100).toFixed(2)}%)`} tone="fee" />
        <Metric label={t('farm.netBeforeGas')} value={netAnalysisApy == null ? null : `${netAnalysisApy.toFixed(2)}%`} unavailable={netAnalysisApy == null} strong tone="net" />
        <Metric label={t('farm.realYieldShare')} value={realPct == null ? null : `${realPct}%`} unavailable={realPct == null} tone="real" />
        <Metric label={t('farm.rewardYieldShare')} value={rewardPct == null ? null : `${rewardPct}%`} unavailable={rewardPct == null} tone="emission" />
        <Metric label={t('farm.rateVs30d')} value={mean30 == null ? null : `${pool.apy}% / ${mean30}%`} unavailable={mean30 == null} />
      </div>
      <p className="faint farm-ana-note">{t('farm.ana.statsNote')}</p>
      </AnaSection>

      <PoolHistory poolId={pool.id} t={t} />
      <HorizonEarningsChart pool={pool} amount={amount} t={t} />
      <FeeEngineCard pool={pool} amount={amount} t={t} />

      {ExecutionPanel ? <p className="notice">{t('farm.executionActivated')}</p> : null}
      <p className="faint">{t('farm.netIsAnalysis')}</p>

      {isPair ? (
        <div>
          <p style={{ fontWeight: 700, fontSize: 12.8, margin: '10px 0 4px' }}>{t('farm.ilTitle')}</p>
          <p className="faint" style={{ margin: '0 0 4px', fontSize: 12 }}>{t('farm.ilBody')}</p>
          <ILToy pool={pool} t={t} />
        </div>
      ) : (
        <div style={{ marginTop: 10 }}><ILToy pool={pool} t={t} /></div>
      )}

      <AnaSection icon={RISK_ICON} title={t('farm.ana.riskTitle')}>
        <div className="farm-risk-grid">
          {Object.entries(factors).map(([key, value]) => (
            <div key={key} className={`farm-risk-row is-${['low', 'medium', 'high'].includes(value) ? value : 'high'}`}>
              <span>{t(`farm.riskFactor.${key}`)}</span>
              <span className="mono">{t(`farm.risk.${value}`, { defaultValue: value })}</span>
            </div>
          ))}
        </div>
        <p className="faint farm-ana-note">{t('farm.ana.riskNote')}</p>
      </AnaSection>

      <InfoBox title={t('farm.howToInvestTitle')} defaultOpen={false} id="farm-how-to-invest">
        <p className="faint" style={{ margin: '0 0 6px', fontSize: 12, lineHeight: 1.8 }}>{t('farm.howToInvest1')}</p>
        <p className="faint" style={{ margin: 0, fontSize: 12, lineHeight: 1.8 }}>{t('farm.howToInvest2')}</p>
      </InfoBox>

      <div className="farm-source-line faint">
        {t('farm.sourceLine', { source: research.source, time: updateTime })}
        {research.freshness && <> · {research.freshness}</>}
      </div>

      <AnaSection icon={ACTIONS_ICON} title={t('farm.ana.actionsTitle')}>
        <div
          ref={inlineActionsRef}
          className={`farm-action-grid farm-ana-inline-actions${route && pool.url ? ' has-two-actions' : ''}`}
          data-testid="farm-analysis-inline-actions"
        >
          {route && <button className="btn btn-primary farm-btn" onClick={() => onGetTokens(route)}>{pairSwapRoute(pool) ? t('farm.getTokens', { a: route.from, b: route.to }) : t('farm.stakeNow', { sym: route.to })}</button>}
          {pool.url && <button className="btn btn-ghost farm-btn" onClick={() => onOpenPool(pool.url)} title={t('farm.openPoolHint')}>{t('farm.openPool')}</button>}
        </div>
        {ExecutionPanel && (
          <div className="farm-pool-execution" data-testid={`farm-pool-execution-${execution.id}`}>
            <ExecutionPanel pool={pool} />
          </div>
        )}
        {!wallet.isConnected && <p className="faint">{t(ExecutionPanel ? 'farm.connectToExecute' : 'farm.readOnly')}</p>}
      </AnaSection>
    </motion.section>
    </FullScreenSheet>
  );
}

function PositionPanel({ wallet, t, navigate }) {
  return (
    <section className="card card-soft farm-positions">
      <div className="row-between">
        <div><p className="section-label" style={{ margin: 0 }}>{t('farm.myFarms')}</p><p className="faint" style={{ margin: '4px 0 0' }}>{t('farm.positionsIntro')}</p></div>
        {!wallet.isConnected && <span className="pill pill-neutral">{t('farm.readOnly')}</span>}
      </div>
      {wallet.isConnected ? (
        <p className="faint" style={{ margin: '10px 0', fontSize: 11.8 }}>{t('farm.positionsDirect')}</p>
      ) : (
        <>
          <p className="notice">{t('farm.connectForPositions')}</p>
          <button className="btn btn-ghost" onClick={() => navigate('/wallet')}>{t('wallet.connect')}</button>
        </>
      )}
      <FarmPositionHub />
      <p className="notice">{t('farm.positionsUnavailable')}</p>
    </section>
  );
}

function HotStrip({ rows, onSelect, t }) {
  const hot = useMemo(() => [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 3), [rows]);
  if (hot.length === 0) return null;
  return (
    <section className="farm-hot" aria-label={t('farm.hot')}>
      <div className="farm-hot-head">
        <span className="farm-hot-dot" aria-hidden="true" />
        <p className="farm-hot-title">{t('farm.hot')}</p>
      </div>
      <div className="farm-hot-grid">
        {hot.map((pool, i) => (
          <button key={pool.id} type="button" className="farm-hot-card" onClick={() => onSelect(pool)} title={`${pool.symbol} · ${projectLabel(pool.project, t)} · ${chainLabel(pool.chain, t)}`}>
            <span className="farm-hot-top">
              <span className="farm-hot-glyph"><PoolGlyph pool={pool} size={22} chainKey={chainIconKey(pool.chain)} showBadge={false} /></span>
              <span className="farm-hot-rank" aria-hidden="true">{i + 1}</span>
              <span className="farm-hot-sym" dir="ltr">{pool.symbol}</span>
            </span>
            <span className="farm-hot-meta">{projectLabel(pool.project, t)} · {chainLabel(pool.chain, t)}</span>
            <span className="farm-hot-apy mono" dir="ltr">{pool.apy}%</span>
            {pool.score != null && <span className="farm-hot-score">{t('farm.score', { score: pool.score })}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function Farm() {
  useHideBalances();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { haptic } = useTelegram();
  const wallet = useWallet();
  const legacyTab = params.get('tab');
  const tab = FARM_TABS.includes(legacyTab) ? legacyTab : 'recommended';
  const focus = params.get('focus');
  const { data, error, loading, refreshing, refresh } = useFarmYields();
  const [solAssets, setSolAssets] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [chain, setChain] = useState('all');
  const [sort, setSort] = useState('score');
  const [visibleCount, setVisibleCount] = useState(24);
  const [amount, setAmount] = useState(1000);
  const [customAmount, setCustomAmount] = useState('');
  const [selected, setSelected] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [yieldCenterOpen, setYieldCenterOpen] = useState(false);
  const tabsRef = useRef(null);

  useEffect(() => {
    tabsRef.current?.querySelector('button.active')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [tab]);

  useEffect(() => {
    let alive = true;
    getSolanaAssets()
      .then((result) => { if (alive) setSolAssets(result); })
      .catch(() => { if (alive) setSolAssets(null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (tab !== 'inapp' || !focus) return undefined;
    const timer = setTimeout(() => {
      document.getElementById(`farm-inapp-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(timer);
  }, [tab, focus]);

  const liveByMint = useMemo(() => {
    const map = new Map();
    for (const row of solAssets?.lst ?? []) {
      if (row?.mint) map.set(row.mint, row);
    }
    return map;
  }, [solAssets]);

  const equities = useMemo(() => (solAssets?.equities ?? [])
    .filter((row) => Number(row?.liquidity) >= MIN_EQUITY_LIQUIDITY)
    .sort((a, b) => (Number(b.liquidity) || 0) - (Number(a.liquidity) || 0)), [solAssets]);

  const deposit = useMemo(() => {
    const n = Number(customAmount);
    return Number.isFinite(n) && n > 0 ? n : amount;
  }, [amount, customAmount]);

  const opportunities = useMemo(() => {
    const metadata = { source: data?.source || 'defillama', updatedAt: data?.at || null, freshness: data?.freshness };
    return (data?.pools || []).map((pool) => normalizeFarmOpportunity(pool, metadata));
  }, [data]);

  const venueOpportunities = useMemo(() => {
    const metadata = { source: data?.source || 'defillama', updatedAt: data?.at || null, freshness: data?.freshness };
    const pinned = (data?.venues || []).map((pool) => normalizeFarmOpportunity(pool, metadata));
    if (!pinned.length) return opportunities;
    const ids = new Set(pinned.map((p) => p.id));
    return [...pinned, ...opportunities.filter((p) => !ids.has(p.id))];
  }, [data, opportunities]);

  const filtered = useMemo(() => {
    let rows = opportunities;
    if (chain !== 'all') rows = rows.filter((p) => p.chain === chain);
    if (filter === 'stable') rows = rows.filter((p) => p.stablecoin);
    if (filter === 'blueChip') rows = rows.filter((p) => p.tvlUsd >= 500_000_000);
    if (filter === 'highYield') rows = rows.filter((p) => p.apy >= 15);
    if (filter === 'lowRisk') rows = rows.filter((p) => p.risk === 'low');
    if (filter === 'lp') rows = rows.filter((p) => p.type === 'lp');
    if (filter === 'staking') rows = rows.filter((p) => p.type === 'staking');
    if (filter === 'autoCompound') rows = rows.filter((p) => AUTOCOMPOUND_PROJECTS.includes(p.project));
    if (filter === 'vault') rows = rows.filter((p) => VAULT_PROJECTS.includes(p.project));
    const needle = q.trim().toLowerCase();
    if (needle) rows = rows.filter((p) => `${p.symbol} ${p.project} ${p.chain}`.toLowerCase().includes(needle));
    return [...rows].sort((a, b) => (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity));
  }, [opportunities, filter, q, chain, sort]);

  useEffect(() => { setVisibleCount(24); }, [filter, q, chain, sort]);

  const poolPrefillDone = useRef(false);
  useEffect(() => {
    if (poolPrefillDone.current) return;
    const want = params.get('pool');
    if (!want || !opportunities.length) return;
    poolPrefillDone.current = true;
    const amt = Number(params.get('amount'));
    const next = new URLSearchParams(params);
    next.delete('pool');
    next.delete('amount');
    setParams(next, { replace: true });
    if (Number.isFinite(amt) && amt > 0) setCustomAmount(String(amt));
    const hit = opportunities.find((p) => String(p?.id) === String(want))
      || venueOpportunities.find((p) => String(p?.id) === String(want));
    if (hit) {
      setSelected(hit);
      setExpandedId(hit.id);
      setTimeout(() => {
        document.getElementById(`farm-pool-${hit.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    }
  }, [params, opportunities, venueOpportunities, setParams]);
  const chains = useMemo(() => [...new Set(opportunities.map((p) => p.chain))].sort(), [opportunities]);
  const selectedPool = opportunities.find((p) => p.id === selected?.id) || null;

  const networkOptions = useMemo(() => [
    { value: 'all', label: t('farm.allNetworks'), iconNode: GLOBE_ICON },
    ...chains.map((name) => ({
      value: name,
      label: chainLabel(name, t),
      chain: chainIconKey(name) ?? undefined
    }))
  ], [chains, t]);
  const sortOptions = useMemo(() => [
    { value: 'score', label: t('farm.sort.score'), iconNode: SCORE_ICON },
    { value: 'apy', label: t('farm.sort.apy'), iconNode: APY_ICON },
    { value: 'tvlUsd', label: t('farm.sort.tvlUsd'), iconNode: TVL_ICON }
  ], [t]);

  const recommended = useMemo(() => filtered.slice(0, 8), [filtered]);
  const marketRows = useMemo(() => {
    const first = (sorter) => [...filtered].sort(sorter)[0];
    return [
      ['topTvl', first((a, b) => b.tvlUsd - a.tvlUsd)],
      ['topApy', first((a, b) => b.apy - a.apy)],
      ['highestVolume', first((a, b) => (b.volumeUsd1d ?? -1) - (a.volumeUsd1d ?? -1))],
      ['mostStable', [...filtered].filter((p) => p.stablecoin).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]],
      ['lowestRisk', [...filtered].filter((p) => p.risk === 'low').sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]]
    ].filter(([, pool]) => pool);
  }, [filtered]);
  const strategies = useMemo(() => buildYieldStrategies(filtered, { source: data?.source, updatedAt: data?.at }), [filtered, data]);

  const protocol = useMemo(() => farmProtocolSummary({
    pools: data?.pools || [],
    at: data?.at || null,
    source: data?.source || null,
    error: error || null,
    freshness: data?.freshness
  }), [data, error]);

  // hero stats
  const heroStats = useMemo(() => {
    const pools = opportunities;
    const tvl = pools.reduce((s, p) => s + (Number(p.tvlUsd) || 0), 0);
    const apys = pools.map(p => Number(p.apy)).filter(n => Number.isFinite(n));
    const avg = apys.length ? apys.reduce((a,b)=>a+b,0)/apys.length : 0;
    const liveVenues = venueOpportunities.filter(p => Number.isFinite(Number(p.apy))).length;
    return {
      count: pools.length,
      tvl,
      avg: avg.toFixed(1),
      liveVenues
    };
  }, [opportunities, venueOpportunities]);

  const selectTab = (id) => { haptic?.('select'); setSelected(null); setExpandedId(null); setParams({ tab: id }, { replace: true }); };
  const togglePool = (pool) => {
    haptic?.('light');
    setExpandedId((v) => (v === pool.id ? null : pool.id));
  };
  const selectPool = (pool) => {
    haptic?.('light');
    const next = selected?.id === pool.id ? null : pool;
    setSelected(next);
    setExpandedId(next ? pool.id : null);
    const context = { page: 'farm', tab, selectedPool: next?.id || null, network: next?.chain || null, walletState: wallet.isConnected ? 'connected' : 'read-only', previousIntent: null, pendingAction: null };
    try { sessionStorage.setItem('fbt:farm-context', JSON.stringify(context)); } catch { }
    emitFarmEvent('POOL_UPDATED', context);
  };
  const getTokens = (route) => {
    haptic?.('select');
    if (route.kind === 'solana') navigate(`/solana?toMint=${encodeURIComponent(route.toMint)}`);
    else navigate(`/swap?chain=${route.chainId}&from=${encodeURIComponent(route.from)}&to=${encodeURIComponent(route.to)}`);
  };
  const openPool = (url) => {
    haptic?.('light');
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const stakeLst = (asset) => { haptic?.('select'); navigate(`/solana?to=${encodeURIComponent(asset.mint)}`); };
  const buyEthStake = (sym) => { haptic?.('select'); navigate(`/swap?chain=1&from=USDT&to=${encodeURIComponent(sym)}`); };
  const buyGold = (sym) => { haptic?.('select'); navigate(`/swap?chain=1&from=USDT&to=${encodeURIComponent(sym)}`); };
  const buyEquity = (asset) => {
    haptic?.('select');
    if (!asset?.mint) return;
    navigate(`/solana?to=${encodeURIComponent(asset.mint)}`);
  };
  const gotoVenuePositions = (venueId) => {
    haptic?.('select');
    setParams({ tab: 'inapp' }, { replace: true });
    setTimeout(() => {
      document.querySelector(`[data-testid="farm-hub-row-${venueId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 140);
  };

  const renderCards = (rows) => (
    <motion.div className="farm-pool-grid" variants={stagger} initial="hidden" animate="show">
      {rows.map((pool) => (
        <div key={pool.id} className="farm-pool-with-details">
          <PoolCard pool={pool} amount={deposit} expanded={expandedId === pool.id} selected={selected?.id === pool.id} onToggle={togglePool} onShowDetails={selectPool} onGetTokens={getTokens} onOpenPool={openPool} t={t} />
          {selected?.id === pool.id && <PoolDetails pool={pool} amount={deposit} wallet={wallet} onGetTokens={getTokens} onOpenPool={openPool} onClose={() => selectPool(pool)} t={t} />}
        </div>
      ))}
    </motion.div>
  );

  return (
    <PageTransition className="page farm-page">
      {/* ─── PREMIUM HERO — glass, mesh, orb, integrated refresh — no middle clutter */}
      <motion.section className="farm-hero-premium" variants={riseIn} initial="hidden" animate="show">
        <div className="farm-hero-bg" aria-hidden="true">
          <span className="farm-hero-orb a" />
          <span className="farm-hero-orb b" />
          <span className="farm-hero-orb c" />
          <span className="farm-hero-mesh" />
        </div>
        <div className="farm-hero-main">
          <div className="farm-hero-copy">
            <div className="farm-hero-top">
              <span className="farm-hero-kicker">
                <span className="farm-live-dot" aria-hidden="true" />
                {t('farm.protocolActive')} · {EXECUTION_LIVE ? t('farm.executionLive') : t('farm.readOnly')}
              </span>
              <button
                type="button"
                className={`farm-hero-refresh ${refreshing ? 'is-loading' : ''}`}
                onClick={refresh}
                disabled={refreshing}
                aria-label={error ? t('farm.retry') : t('farm.refresh')}
                title={error ? t('farm.retry') : t('farm.refresh')}
              >
                <span className="farm-hero-refresh-icon" aria-hidden="true">{REFRESH_ICON}</span>
                <span className="farm-hero-refresh-text">{error ? t('farm.retry') : t('farm.refresh')}</span>
              </button>
            </div>
            <h1 className="farm-hero-title">{t('farm.title')}</h1>
            <p className="farm-hero-sub">{t('farm.subtitle')}</p>
          </div>
          <div className="farm-hero-art">
            <FarmOrbMark size={104} />
          </div>
        </div>
        <div className="farm-hero-stats">
          <div className="farm-hero-stat" style={{ '--a': '#00e5ff', '--b': '#7c4dff' }}>
            <span className="farm-hero-stat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2z"/><path d="M4 7.2l8 4.4 8-4.4"/><path d="M12 11.6v9.6"/></svg>
            </span>
            <span className="farm-hero-stat-value mono">{heroStats.count || '—'}</span>
            <span className="farm-hero-stat-label">{t('farm.pools')}</span>
          </div>
          <div className="farm-hero-stat" style={{ '--a': '#00ff9d', '--b': '#00e5ff' }}>
            <span className="farm-hero-stat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l5-5 4 4 7-7"/><path d="M15 9h5v5"/></svg>
            </span>
            <span className="farm-hero-stat-value mono">{heroStats.avg}%</span>
            <span className="farm-hero-stat-label">{t('farm.estimatedApy')}</span>
          </div>
          <div className="farm-hero-stat" style={{ '--a': '#ff2d95', '--b': '#ffb300' }}>
            <span className="farm-hero-stat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 7v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/></svg>
            </span>
            <span className="farm-hero-stat-value mono">{fmtCompact(heroStats.tvl)}</span>
            <span className="farm-hero-stat-label">{t('farm.tvl')}</span>
          </div>
        </div>
        <p className="farm-hero-footnote faint" role="status">{refreshing ? t('farm.refreshing') : t('farm.feedRefreshNote')}</p>
      </motion.section>

      <VenueRail
        pools={venueOpportunities}
        t={t}
        onGoToPositions={gotoVenuePositions}
        onGetTokens={getTokens}
        onOpenPool={openPool}
      />

      <ProtocolStatusCard protocol={protocol} t={t} />
      {data?.freshness === 'STALE' && <p className="notice farm-stale-notice" role="status">{t('farm.staleNotice')}</p>}

      <div className="segmented seg-lg farm-tabs" role="tablist" aria-orientation="horizontal" ref={tabsRef}>
        {FARM_TABS.map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => selectTab(id)} style={{ isolation: 'isolate' }}>
            {tab === id && <SegIndicator id="farmtab" />}
            <span className="farm-tab-icon" aria-hidden="true">{TAB_ICONS[id]}</span>
            <span>{t(`farm.tab.${id}`)}</span>
          </button>
        ))}
      </div>

      <motion.section className={`card farm-yield-center ${yieldCenterOpen ? 'is-open' : ''}`} variants={riseIn} initial="hidden" animate="show">
        <button type="button" className="farm-yield-center-toggle" onClick={() => setYieldCenterOpen((v) => !v)} aria-expanded={yieldCenterOpen}>
          <span className="farm-yield-center-icon" aria-hidden="true"><IconPools width={20} height={20} /></span>
          <span className="farm-yield-center-text">
            <span className="farm-yield-center-title">{t('farm.yieldCenterTitle')}</span>
            <span className="farm-yield-center-sub">{t('farm.whatBody')}</span>
          </span>
          <span className="farm-yield-chevron" aria-hidden="true">{yieldCenterOpen ? '⌃' : '⌄'}</span>
        </button>
        {yieldCenterOpen && (
          <div className="farm-yield-center-body">
            <p className="muted">{t('farm.scoreExplanation')}</p>
            <div className="farm-yield-center-stats"><span>Live APY</span><span>TVL</span><span>Risk</span><span>Freshness</span></div>
          </div>
        )}
      </motion.section>

      <div className="farm-secondary-filters" role="group" aria-label={t('farm.filters')}>
        {FILTERS.map((id) => (
          <button key={id} className={`tag ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
            <span aria-hidden="true">{FILTER_ICONS[id]}</span>
            {t(`farm.category.${id}`)}
          </button>
        ))}
      </div>

      <div className="farm-select-row">
        <ModernSelect
          value={chain}
          onChange={(v) => setChain(v)}
          options={networkOptions}
          title={t('farm.network')}
          triggerSublabel={t('farm.network')}
          compact
          testId="farm-network-select"
        />
        {['recommended', 'pools'].includes(tab) ? (
          <ModernSelect
            value={sort}
            onChange={(v) => setSort(v)}
            options={sortOptions}
            title={t('farm.sortBy')}
            triggerSublabel={t('farm.sortBy')}
            compact
            searchable={false}
            testId="farm-sort-select"
          />
        ) : (
          <div className="farm-select-static" role="note">
            <span className="modern-select-icon farm-select-static-icon" aria-hidden="true">{SORT_ICONS.score}</span>
            <span className="modern-select-text">
              <span className="modern-select-label">{t('farm.sort.score')}</span>
              <span className="modern-select-sublabel">{t('farm.sortBy')}</span>
            </span>
          </div>
        )}
      </div>

      <div className="farm-unified-bar">
        <div className="farm-search-wrap">
          <span className="farm-search-icon" aria-hidden="true">{SEARCH_ICON}</span>
          <input className="farm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('farm.search')} aria-label={t('farm.search')} />
        </div>
        <span className="farm-unified-divider" aria-hidden="true" />
        <div className="farm-amounts-inline">
          <span className="farm-amounts-label faint">{t('farm.ifIDeposit')}</span>
          <div className="farm-amount-chips">
            {AMOUNTS.map((n) => (
              <button key={n} className={`farm-amount-chip ${amount === n && !customAmount ? 'active' : ''}`} onClick={() => { setAmount(n); setCustomAmount(''); }}>
                {fmtUsd(n)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <div className="stack" style={{ marginTop: 14 }}>{[0, 1, 2].map((i) => <div className="skel" key={i} style={{ height: 150, borderRadius: 16 }} />)}</div>}
      {!loading && error && <p className="notice notice-danger" style={{ marginTop: 14 }}>{t('farm.unavailable')}</p>}
      {!loading && !error && tab !== 'inapp' && filtered.length === 0 && <p className="notice" style={{ marginTop: 14 }}>{t('farm.noneForFilter')}</p>}
      {!loading && !error && data && tab !== 'inapp' && filtered.length > 0 && (
        <p className="farm-filtered faint">{t('farm.filteredNote', { shown: filtered.length, returned: data.pools.length, passed: data.passed ?? data.pools.length, considered: data.considered ?? data.pools.length })}</p>
      )}

      {data?.truncated && <p className="notice">{t('farm.feedTruncated', { count: data.pools.length })}</p>}

      {tab === 'inapp' && (
        <>
          {!loading && (
            <InAppTab
              pools={opportunities}
              deposit={deposit}
              liveByMint={liveByMint}
              equities={equities}
              onStakeLst={stakeLst}
              onBuyEth={buyEthStake}
              onBuyGold={buyGold}
              onBuyEquity={buyEquity}
              onSeeAllEquities={() => { haptic?.('select'); navigate('/stocks'); }}
              t={t}
            />
          )}
          <PositionPanel wallet={wallet} t={t} navigate={navigate} />
        </>
      )}
      {!loading && !error && tab === 'recommended' && <section><p className="section-label">{t('farm.recommendedFarms')}</p><p className="farm-filtered faint">{t('farm.scoreExplanation')}</p><HotStrip rows={filtered} onSelect={selectPool} t={t} />{renderCards(recommended)}</section>}
      {!loading && !error && tab === 'recommended' && selectedPool && !recommended.some((p) => p.id === selectedPool.id) && <PoolDetails key={selectedPool.id} pool={selectedPool} amount={deposit} wallet={wallet} onGetTokens={getTokens} onOpenPool={openPool} onClose={() => selectPool(selectedPool)} t={t} />}
      {!loading && !error && tab === 'market' && <section><p className="section-label">{t('farm.defiMarket')}</p><div className="farm-market-grid">{marketRows.map(([category, pool]) => <div key={category}><p className="farm-market-label">{t(`farm.market.${category}`)}</p><PoolCard pool={pool} amount={deposit} expanded={expandedId === pool.id} selected={selected?.id === pool.id} onToggle={togglePool} onShowDetails={selectPool} onGetTokens={getTokens} onOpenPool={openPool} t={t} /></div>)}</div></section>}
      {!loading && !error && tab === 'strategies' && <section><p className="section-label">{t('farm.yieldStrategies')}</p><p className="farm-filtered faint">{t('farm.strategyDisclaimer')}</p><div className="farm-strategy-grid">{strategies.map(({ category, pool }) => <div key={category}><p className="farm-market-label">{t(`farm.strategy.${category}`)}</p><PoolCard pool={pool} amount={deposit} expanded={expandedId === pool.id} selected={selected?.id === pool.id} onToggle={togglePool} onShowDetails={selectPool} onGetTokens={getTokens} onOpenPool={openPool} t={t} /></div>)}</div></section>}
      {!loading && !error && tab === 'pools' && <section><div className="row-between"><p className="section-label">{t('farm.pools')}</p><span className="faint">{t('farm.poolCount', { count: filtered.length })}</span></div>{renderCards(filtered.slice(0, visibleCount))}{filtered.length > visibleCount && <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setVisibleCount((n) => n + 24)}>{t('farm.showMore')}</button>}</section>}

      {!loading && !error && ['market', 'strategies'].includes(tab) && selectedPool && <PoolDetails key={selectedPool.id} pool={selectedPool} amount={deposit} wallet={wallet} onGetTokens={getTokens} onOpenPool={openPool} onClose={() => selectPool(selectedPool)} t={t} />}

      <InfoBox title={t('farm.custodyTitle')} tone="info" id="farm-custody"><p>{t('farm.nativeCustodyNotice')}</p></InfoBox>
      <InfoBox title={t('farm.riskDisclosureTitle')} tone="warning"><p>{t('farm.riskDisclosure')}</p></InfoBox>
      <div className="farm-bottom-banner"><AdBanner slot="stocks" compact /></div>
    </PageTransition>
  );
}

function LstRow({ asset, live, pools, deposit, onStake, t }) {
  const y = yieldForLst(asset, pools);
  const proj = y ? projectStake(y.apy, deposit) : null;
  return (
    <motion.div className="coin-row" variants={riseIn}>
      <TokenIcon token={live?.icon ? { ...asset, icon: live.icon } : asset} size={34} />
      <div className="coin-meta">
        <div className="coin-sym" dir="ltr">{asset.symbol}</div>
        <div className="coin-name">{asset.name}</div>
        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {y && <span className="pill pill-neutral mono" dir="ltr">{y.apy}% {t('farm.estimatedApy')}</span>}
          {asset.capturesMev && <span className="pill pill-rgb">{t('farm.mevBoost')}</span>}
          {asset.protocolFeePct != null && <span className="pill pill-neutral">{t('farm.protocolFee', { pct: asset.protocolFeePct })}</span>}
          {live?.liquidity != null && <span className="pill pill-neutral mono" dir="ltr">{fmtCompact(live.liquidity)}</span>}
        </div>
        {proj && (
          <p className="faint" style={{ margin: '6px 0 0', fontSize: 11.8 }}>
            {t('farm.wouldEarn', { amount: fmtUsd(deposit) })} <strong className="mono" dir="ltr">{fmtUsd(proj.year)}</strong> {t('farm.year')} · <span className="mono" dir="ltr">{fmtUsd(proj.month)}</span> {t('farm.month')}
          </p>
        )}
      </div>
      <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => onStake(asset)}>
        {t('farm.stakeNow', { sym: asset.symbol })}
      </button>
    </motion.div>
  );
}

function EthStakeRow({ token, pools, deposit, onBuy, t }) {
  const join = ETH_STAKE_JOIN[token.symbol];
  const match = join
    ? pools.find((p) => p.project === join.project && String(p.symbol ?? '').toUpperCase() === join.feedSymbol)
    : null;
  const proj = match ? projectStake(match.apy, deposit) : null;
  const score = match ? farmScore(match) : null;
  return (
    <motion.div className="coin-row" variants={riseIn}>
      <TokenIcon token={token} chainId={1} size={34} />
      <div className="coin-meta">
        <div className="coin-sym" dir="ltr">{token.symbol}</div>
        <div className="coin-name">{token.name}</div>
        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {match && <span className="pill pill-neutral mono" dir="ltr">{match.apy}% {t('farm.estimatedApy')}</span>}
          {score != null && <span className="pill pill-neutral">{t('farm.score', { score })}</span>}
          <span className="pill pill-neutral">Ethereum</span>
        </div>
        {proj && (
          <p className="faint" style={{ margin: '6px 0 0', fontSize: 11.8 }}>
            {t('farm.wouldEarn', { amount: fmtUsd(deposit) })} <strong className="mono" dir="ltr">{fmtUsd(proj.year)}</strong> {t('farm.year')} · <span className="mono" dir="ltr">{fmtUsd(proj.month)}</span> {t('farm.month')}
          </p>
        )}
      </div>
      <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => onBuy(token.symbol)}>
        {t('farm.buyHere', { sym: token.symbol })}
      </button>
    </motion.div>
  );
}

function EquityPoolRow({ asset, onBuy, t }) {
  const change = Number(asset?.change24h);
  return (
    <motion.div className="coin-row" variants={riseIn}>
      <TokenIcon token={{ symbol: asset.symbol, icon: asset.icon }} size={34} />
      <div className="coin-meta">
        <div className="coin-sym" dir="ltr">{asset.symbol}</div>
        <div className="coin-name">{asset.name}</div>
        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {Number.isFinite(change) && (
            <span className={`pill ${change >= 0 ? 'pill-up' : 'pill-down'} mono`} dir="ltr">
              {change >= 0 ? '+' : ''}{change.toFixed(2)}%
            </span>
          )}
          {asset.liquidity ? <span className="pill pill-neutral mono" dir="ltr">{fmtCompact(asset.liquidity)}</span> : null}
          {asset.id === 'hoodx' && <span className="pill pill-rgb">{t('farm.equityNew')}</span>}
          <span className="pill pill-down">{t('farm.equityFreeze')}</span>
        </div>
      </div>
      <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => onBuy(asset)}>
        {t('farm.buyHere', { sym: asset.symbol })}
      </button>
    </motion.div>
  );
}

function InAppTab({ pools, deposit, liveByMint, equities = [], onStakeLst, onBuyEth, onBuyGold, onBuyEquity, onSeeAllEquities, t }) {
  return (
    <div className="stack">
      <p className="faint" style={{ margin: '2px 0 0', fontSize: 12.3, lineHeight: 1.8 }}>{t('farm.inappIntro')}</p>

      <section id="farm-inapp-sol">
        <p className="section-label">{t('farm.stakingTitle')}</p>
        <p className="faint" style={{ margin: '0 0 8px', fontSize: 12.3, lineHeight: 1.8 }}>{t('farm.stakingIntro')}</p>
        <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
          {LST_ASSETS.map((asset) => (
            <LstRow key={asset.id} asset={asset} live={liveByMint.get(asset.mint)} pools={pools} deposit={deposit} onStake={onStakeLst} t={t} />
          ))}
        </motion.div>
        <p className="faint" style={{ margin: '8px 0 0', fontSize: 11.6, lineHeight: 1.8 }}>{t('farm.stakingNote')}</p>
      </section>

      <section id="farm-inapp-eth">
        <p className="section-label">{t('farm.ethStakingTitle')}</p>
        <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
          {ethStakeTokens.map((token) => (
            <EthStakeRow key={token.symbol} token={token} pools={pools} deposit={deposit} onBuy={onBuyEth} t={t} />
          ))}
        </motion.div>
        <p className="faint" style={{ margin: '8px 0 0', fontSize: 11.6, lineHeight: 1.8 }}>{t('farm.ethStakingNote')}</p>
      </section>

      {equities.length > 0 && (
        <section id="farm-inapp-equity">
          <div className="row-between" style={{ gap: 8 }}>
            <p className="section-label" style={{ margin: 0 }}>{t('farm.equityTitle')}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onSeeAllEquities}>{t('farm.equityAll')}</button>
          </div>
          <p className="faint" style={{ margin: '0 0 8px', fontSize: 12.3, lineHeight: 1.8 }}>{t('farm.equityIntro')}</p>
          <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
            {equities.slice(0, 8).map((asset) => (
              <EquityPoolRow key={asset.mint} asset={asset} onBuy={onBuyEquity} t={t} />
            ))}
          </motion.div>
          <p className="faint" style={{ margin: '8px 0 0', fontSize: 11.6, lineHeight: 1.8 }}>{t('farm.equityNote')}</p>
        </section>
      )}

      <section id="farm-inapp-gold">
        <p className="section-label">{t('farm.goldTitle')}</p>
        <p className="faint" style={{ margin: '0 0 8px', fontSize: 12.3, lineHeight: 1.8 }}>{t('farm.goldIntro')}</p>
        <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
          {GOLD_TOKENS.map((sym) => (
            <motion.div className="coin-row" key={sym} variants={riseIn}>
              <TokenIcon token={{ symbol: sym }} size={34} />
              <div className="coin-meta">
                <div className="coin-sym" dir="ltr">{sym}</div>
                <div className="coin-name">{t('earn.yield.gold.tag')}</div>
                <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <span className="pill pill-rgb">{t('farm.goldFreeze')}</span>
                  <span className="pill pill-neutral">Ethereum</span>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => onBuyGold(sym)}>
                {t('farm.buyHere', { sym })}
              </button>
            </motion.div>
          ))}
        </motion.div>
        <p className="faint" style={{ margin: '8px 0 0', fontSize: 11.6, lineHeight: 1.8 }}>{t('farm.goldWarn')}</p>
      </section>
    </div>
  );
}
