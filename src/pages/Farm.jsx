import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { TOKENS } from '../lib/chains';
import {
  farmScore, impermanentLoss, investRoute, pairSwapRoute, pairTokens,
  projectEarnings, rateIsUnusual, realShare
} from '../lib/yields';
import { getSolanaAssets, projectStake, yieldForLst } from '../lib/solanaAssetsClient';
import { LST_ASSETS } from '../lib/solanaAssets';
import {
  AUTOCOMPOUND_PROJECTS, buildYieldStrategies, chainIconKey, emitFarmEvent, fbtFeeEngine, FARM_PROTOCOL,
  farmPoolResearch, farmProtocolSummary, normalizeFarmOpportunity, projectDisplayName, VAULT_PROJECTS
} from '../lib/farmDeFi';
/*
 * Supported execution positions live in a feed-independent hub. DefiLlama is
 * discovery/data only: a feed failure must never remove withdraw/claim/revoke.
 *
 * `farmExecutionAdapterFor` is the SAME table the hub renders from, so a pool
 * row and the hub can never disagree about which pools this app can transact.
 */
import FarmPositionHub, { FARM_EXECUTION_ADAPTERS, farmExecutionAdapterFor } from '../components/Farm/FarmPositionHub';
import { feedErrorLabel } from '../lib/defi/farmErrors';
import TrendChart from '../components/TrendChart';

/*
 * Rail order, as pinned by the wiring audit («Farm opens on curated investable
 * discovery, not the raw pool dump»): in-app first, then the curated
 * recommended list — which is also the DEFAULT tab — then market, strategies,
 * and the raw pool dump last. Keeping the selected tab near the start matters
 * more now that the bar is a horizontal rail: the tab you land on should not
 * be the one you have to flick to find.
 */
const FARM_TABS = ['inapp', 'recommended', 'market', 'strategies', 'pools'];

/*
 * Is ANY adapter open to every visitor in this build?
 *
 * The status card at the top of this page used to carry a permanent
 * «🔒 حالت فقط‌خواندنی · تحلیل فقط‌خواندنی» badge, compiled in regardless of
 * the rollout — so a public-open build, whose five adapters sign real
 * transactions, still introduced itself to every visitor as read-only. That
 * badge is now derived from the same adapter table the rest of the screen
 * reads, and a capital-off build still says exactly what it said before.
 */
const EXECUTION_LIVE = FARM_EXECUTION_ADAPTERS.some((adapter) => adapter.openToPublic);
const FILTERS = ['all', 'stable', 'blueChip', 'highYield', 'lowRisk', 'autoCompound', 'lp', 'staking', 'vault'];
const AMOUNTS = [100, 1000, 10000];
const HORIZONS = ['day', 'week', 'month', 'year'];

/*
 * ETH staking tokens buyable through our own swap, read from the token table
 * rather than retyped: the `stake: 'eth'` flag in lib/chains.js is the single
 * source of truth, so a token delisted there vanishes here instead of leaving
 * a dead button. Buying stETH or rETH IS the stake: no deposit step, no
 * lock-up, swapping back out is the unstake. The join map below only attaches
 * the live APY from the pools this screen already fetches (same join shape as
 * yieldForLst for Solana) — when the feed has no matching row the APY renders
 * as nothing, never a typed-in number.
 */
const ETH_STAKE_JOIN = {
  stETH: { project: 'lido', feedSymbol: 'STETH' },
  rETH: { project: 'rocket-pool', feedSymbol: 'RETH' }
};
const ethStakeTokens = (TOKENS[1] ?? []).filter((tk) => tk.stake === 'eth');

const GOLD_TOKENS = ['PAXG', 'XAUt'];

/*
 * Localised labels for feed rows. The feed sends slugs and English names
 * (`aave-v3`, `Ethereum`); humans read the locale. `farm.chainLabels.*` and
 * `farm.projectLabels.*` live in the locale files, and anything absent falls
 * back to a readable English form — never a raw slug or a machine code.
 */
const chainLabel = (name, t) => t(`farm.chainLabels.${name}`, { defaultValue: name });
const projectLabel = (slug, t) => t(`farm.projectLabels.${slug}`, { defaultValue: projectDisplayName(slug) });

/* The picker glyphs: small, offline, theme-neutral inline SVGs. */
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

function Metric({ label, value, unavailable, strong }) {
  return (
    <div className="farm-metric">
      <span className="faint">{label}</span>
      <span className={`mono ${strong ? 'farm-metric-strong' : ''}`}>{unavailable ? '—' : value}</span>
    </div>
  );
}

/*
 * Horizon earnings chart — day → week → month → year at today's rate.
 * Uses the same projectEarnings() maths the metric tiles already show, so
 * the line can never disagree with the numbers beside it. No invented
 * history: the curve is the cumulative projection across the four horizons.
 */
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

/* Fee engine summary — same fbtFeeEngine the cards already use, just readable. */
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

/*
 * The real-vs-emissions split bar. `apyBase` is interest and fees actually
 * paid; `apyReward` is freshly-minted governance tokens. A "24% APY" that is
 * 22% emissions is a countdown, not an income — this bar sits directly under
 * the headline so the two can never be confused. Renders nothing when the
 * feed did not send the split: an unknown split must not render as "all real".
 */
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

/*
 * Today vs the pool's own 30-day mean. A pool at 40% today with a 6% mean is
 * not a 40% pool — the spike is usually an incentive burst that vanishes
 * within days. Renders nothing at a normal rate or without a mean.
 */
function UnusualNote({ pool, t }) {
  const unusual = rateIsUnusual(pool);
  if (!unusual) return null;
  return (
    <p className={`farm-unusual ${unusual.direction === 'above' ? 'farm-unusual-above' : ''}`}>
      {t(`farm.unusual.${unusual.direction}`, { ratio: unusual.ratio, mean: unusual.mean })}
    </p>
  );
}

/*
 * What the selected deposit would earn in a year at today's rate. Simple
 * interest on the APY figure (APY is already compounded — compounding it
 * again would overstate), always qualified by "if the rate never changed"
 * and, when the split is known, by how much of it is real revenue.
 */
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

/*
 * The tiny price-move impermanent-loss toy, pairs only. Classic 50/50 IL for
 * a leg-move multiple the user types in. Price-move IL only — the pool's own
 * swap-fee income is unknown unless the feed sent it, and inventing it would
 * be the flattering guess this screen refuses to make.
 */
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

/*
 * The invest action for one pool. A PAIR pool needs both legs bought first;
 * a SINGLE-asset pool needs exactly one token (the Aave USDC depositor buys
 * USDC, nothing else). investRoute() resolves either against our own swap
 * registries, or null — and null renders an honest hint plus the pool-page
 * link, never a button that leads nowhere.
 */
function InvestButton({ pool, route, onGetTokens, t }) {
  /*
   * The LABEL follows the pair route, not the symbol shape: a pair pool whose
   * legs our swap cannot buy is not a "get the pair" button, it is the honest
   * hint below. investRoute() already resolved pair-first, so a present route
   * with no pair route is always a single-token purchase.
   */
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
  const statusLabel = status === 'ACTIVE'
    ? t('farm.protocolActive')
    : status === 'UNAVAILABLE' ? t('farm.protocolUnavailable') : status === 'STALE' ? t('farm.freshness.STALE') : t('farm.protocolConnecting');
  const updated = protocol?.updatedAt
    ? new Date(protocol.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';
  const source = protocol?.source || FARM_PROTOCOL.source;
  const capabilities = (protocol?.capabilities || FARM_PROTOCOL.capabilities).join(' · ');

  return (
    <motion.section className="card card-rgb card-glow-cyan farm-protocol-card" variants={riseIn} initial="hidden" animate="show">
      <div className="farm-protocol-head">
        <span className="farm-protocol-icon" aria-hidden="true">
          <IconShield width={20} height={20} />
        </span>
        <span className="farm-protocol-id" style={{ minWidth: 0 }}>
          <span className="farm-protocol-title">{t('farm.protocolConnected')}</span>
          <span className="farm-protocol-sub">{FARM_PROTOCOL.name}</span>
        </span>
        <span className={`pill ${status === 'ACTIVE' ? 'pill-neutral' : status === 'UNAVAILABLE' ? 'pill-down' : 'pill-rgb'}`}>{statusLabel}</span>
      </div>

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

      {/*
        A strict 2 × 2 readout: two columns, two rows, every cell the same box.
        «قابلیت‌های پروتکل» used to carry a `--wide` modifier and span both
        columns, which made that tile visibly larger than «آخرین همگام‌سازی»
        next to it. It is now one ordinary cell like the other three, and a
        value too long for the cell is clipped with an ellipsis instead of
        stretching the tile — the full string stays reachable through `title`.
      */}
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
      {protocol?.error && <p className="faint" style={{ margin: '7px 0 0' }}>{feedErrorLabel(protocol.error, t)}</p>}
    </motion.section>
  );
}

function PoolCard({ pool, amount, expanded, selected, onToggle, onShowDetails, onGetTokens, onOpenPool, t }) {
  const route = investRoute(pool);
  /*
   * «این استخر در برنامه اجرا می‌شود» — but only in a build that may actually
   * offer it to whoever is looking. In a canary build the panel renders for the
   * allowlisted wallet alone, so the badge stays off rather than promising the
   * same thing to everybody.
   */
  const executable = Boolean(farmExecutionAdapterFor(pool)?.openToPublic);
  const economics = fbtFeeEngine.estimateNetYield({
    grossApy: pool.apy,
    protocolCostApy: 0, // the feed's depositor APY is already net of protocol-retained yield
    gasUsd: null,
    amountUsd: amount
  });
  const beforeGas = Math.max(-100, Number(pool.apy || 0) - economics.fbtFeeApy);
  const iconKey = chainIconKey(pool.chain);

  /*
   * COLLAPSED BY DEFAULT.
   * The page used to stack every metric, every bar and every badge of every
   * pool in one tall column. Now the card is one tappable header — icon,
   * symbol, project · chain, APY, chevron — and the body only renders when the
   * user opens it, so the screen reads as a list instead of a wall.
   */
  return (
    <motion.article className={`farm-pool ${selected ? 'farm-pool-selected' : ''} ${expanded ? 'is-open' : ''}`} variants={riseIn} id={`farm-pool-${pool.id}`}>
      <button
        type="button"
        className="farm-pool-toggle"
        aria-expanded={expanded}
        onClick={() => onToggle(pool)}
        title={`${pool.symbol} · ${projectLabel(pool.project, t)} · ${chainLabel(pool.chain, t)}`}
      >
        {/* THE PROTOCOL, NOT THE CHAIN. Both branches used to be an AssetIcon of
            the network, so Aave, Lido and Pendle all showed the same ETH disc
            and the row's only picture carried no information. The chain now
            rides on the corner of the tile as a badge; the tile itself belongs
            to the protocol. */}
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
            <button className="btn btn-ghost farm-btn" onClick={() => onShowDetails(pool)} aria-expanded={selected}>{selected ? t('farm.hideAnalytics') : t('farm.viewAnalytics')}</button>
          </div>
          {pool.url && (
            <div className="farm-actions">
              <button className="btn btn-ghost farm-btn farm-btn-minor" onClick={() => onOpenPool(pool.url)} title={t('farm.openPoolHint')}>
                {t('farm.openPool')}
              </button>
            </div>
          )}
        </div>
      )}
    </motion.article>
  );
}

function PoolDetails({ pool, amount, wallet, onGetTokens, onOpenPool, t }) {
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
  /*
   * CAN THIS APP ACTUALLY TRANSACT THIS POOL?
   * ---------------------------------------------------------------------------
   * This card used to answer "no" for every row in the feed — six permanently
   * disabled buttons and «تا وصل‌شدن آداپتور اجرایی تأییدشده، اجرا
   * فقط‌خواندنی می‌ماند» — including the exact Aave v3 / Compound v3 / Morpho
   * Blue / Lido rows whose adapters are wired, fork-probed and shipped. The
   * notice was honest about 4 000 pools and false about the five we support,
   * and the only place a supported pool could be executed was a different
   * section at the bottom of the page.
   *
   * Both surfaces now read one table (components/Farm/FarmPositionHub.jsx), so
   * a supported row gets its real panel here — supply, withdraw, revoke, the
   * pre-sign simulation and the wallet confirmation, all in the adapter.
   *
   * `openToPublic` is required before anything is advertised: in a canary build
   * the panel renders only for the allowlisted wallet, and a card that promises
   * execution to everyone else would be the same lie in the other direction.
   * Unsupported rows keep the analysis + protocol-site guidance they had.
   */
  const execution = farmExecutionAdapterFor(pool);
  const ExecutionPanel = execution?.openToPublic ? execution.Panel : null;

  return (
    <motion.section className="card card-rgb farm-details" variants={riseIn} initial="hidden" animate="show" aria-live="polite">
      <div className="row-between" style={{ gap: 10 }}>
        {/* the drawer repeats the card's mark so the user never wonders whether
            they opened the pool they meant to open */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <PoolGlyph pool={pool} size={32} chainKey={chainIconKey(pool.chain)} />
          <div style={{ minWidth: 0 }}>
            <p className="section-label" style={{ margin: 0 }}>{t('farm.poolAnalytics')}</p>
            <div className="farm-pool-sym" dir="ltr">{pool.symbol}</div>
          </div>
        </div>
        <div className="farm-details-head" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span className="pill pill-neutral">{FARM_PROTOCOL.name}</span>
          <span className="pill pill-neutral">{pool.type === 'staking' ? t('farm.category.staking') : t('farm.category.lp')}</span>
          {pool.score != null && <span className="pill pill-neutral">{t('farm.score', { score: pool.score })}</span>}
          <RiskPill risk={pool.risk} t={t} />
        </div>
      </div>

      {pool.poolMeta && <p className="faint" style={{ margin: '6px 0 0' }}>{t('farm.poolMeta')}: {pool.poolMeta}</p>}

      <SplitBar pool={pool} t={t} />
      <UnusualNote pool={pool} t={t} />

      <div className="farm-economics">
        <Metric label={t('farm.amount')} value={fmtUsd(amount)} />
        <Metric label={t('farm.protocol')} value={projectLabel(pool.project, t)} />
        <Metric label={t('farm.network')} value={chainLabel(pool.chain, t)} />
        <Metric label={t('farm.tvl')} value={fmtCompact(pool.tvlUsd)} />
        <Metric label={t('farm.volume24h')} value={pool.volumeUsd1d == null ? null : fmtCompact(pool.volumeUsd1d)} unavailable={pool.volumeUsd1d == null} />
        <Metric label={t('farm.volume7d')} value={research.volumeUsd7d == null ? null : fmtCompact(research.volumeUsd7d)} unavailable={research.volumeUsd7d == null} />
        <Metric label={t('farm.grossApy')} value={`${pool.apy}%`} />
        <Metric label={t('farm.apyBase')} value={research.apyBase == null ? null : `${research.apyBase}%`} unavailable={research.apyBase == null} />
        <Metric label={t('farm.apyReward')} value={research.apyReward == null ? null : `${research.apyReward}%`} unavailable={research.apyReward == null} />
        <Metric label={t('farm.apr')} value={pool.apr == null ? null : `${pool.apr}%`} unavailable={pool.apr == null} />
        <Metric label={t('farm.rewardApr')} value={pool.rewardApr == null ? null : `${pool.rewardApr}%`} unavailable={pool.rewardApr == null} />
        <Metric label={t('farm.protocolFees')} value={t('farm.includedInApy')} />
        <Metric label={t('farm.gasEstimate')} unavailable />
        <Metric label={t('farm.fbtFee')} value={`${fmtUsd(fee.fbtFeeUsd)} (${(fee.fbtFeeBps / 100).toFixed(2)}%)`} />
        <Metric label={t('farm.netBeforeGas')} value={netAnalysisApy == null ? null : `${netAnalysisApy.toFixed(2)}%`} unavailable={netAnalysisApy == null} strong />
        <Metric label={t('farm.realYieldShare')} value={realPct == null ? null : `${realPct}%`} unavailable={realPct == null} />
        <Metric label={t('farm.rewardYieldShare')} value={rewardPct == null ? null : `${rewardPct}%`} unavailable={rewardPct == null} />
        <Metric label={t('farm.rateVs30d')} value={mean30 == null ? null : `${pool.apy}% / ${mean30}%`} unavailable={mean30 == null} />
      </div>

      <PoolHistory poolId={pool.id} t={t} />
      <HorizonEarningsChart pool={pool} amount={amount} t={t} />
      <FeeEngineCard pool={pool} amount={amount} t={t} />

      <p className="notice">{ExecutionPanel ? t('farm.executionActivated') : t('farm.analysisActivated')}</p>
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

      <div className="farm-risk-grid">
        {Object.entries(factors).map(([key, value]) => (
          <div key={key} className="farm-risk-row"><span>{t(`farm.riskFactor.${key}`)}</span><span className="mono">{t(`farm.risk.${value}`, { defaultValue: value })}</span></div>
        ))}
      </div>

      <InfoBox title={t('farm.howToInvestTitle')} defaultOpen={false} id="farm-how-to-invest">
        <p className="faint" style={{ margin: '0 0 6px', fontSize: 12, lineHeight: 1.8 }}>{t('farm.howToInvest1')}</p>
        <p className="faint" style={{ margin: 0, fontSize: 12, lineHeight: 1.8 }}>{t('farm.howToInvest2')}</p>
      </InfoBox>

      <div className="farm-source-line faint">
        {t('farm.sourceLine', { source: research.source, time: updateTime })}
        {research.freshness && <> · {research.freshness}</>}
      </div>

      {/*
        ACTIONS — only what this app can really do.
        The six «ناموجود» placeholder buttons (add/remove liquidity, stake/
        unstake LP, claim, compound) used to sit here for every unsupported
        pool: six permanently-disabled controls that argued with the screen.
        They are gone. What remains is what exists: the swap/stake handoff and
        the pool link. A pool an adapter CAN transact shows its own live
        panel below instead of dead buttons.
      */}
      <div className="farm-action-grid">
        {route && <button className="btn btn-primary farm-btn" onClick={() => onGetTokens(route)}>{pairSwapRoute(pool) ? t('farm.getTokens', { a: route.from, b: route.to }) : t('farm.stakeNow', { sym: route.to })}</button>}
        {pool.url && <button className="btn btn-ghost farm-btn" onClick={() => onOpenPool(pool.url)} title={t('farm.openPoolHint')}>{t('farm.openPool')}</button>}
      </div>
      {ExecutionPanel && (
        <div className="farm-pool-execution" data-testid={`farm-pool-execution-${execution.id}`}>
          <ExecutionPanel pool={pool} />
        </div>
      )}
      {!wallet.isConnected && <p className="faint">{t(ExecutionPanel ? 'farm.connectToExecute' : 'farm.readOnly')}</p>}
    </motion.section>
  );
}

function PositionPanel({ wallet, t, navigate }) {
  return (
    <section className="card card-soft farm-positions">
      <div className="row-between">
        <div><p className="section-label" style={{ margin: 0 }}>{t('farm.myFarms')}</p><p className="faint" style={{ margin: '4px 0 0' }}>{t('farm.positionsIntro')}</p></div>
        {!wallet.isConnected && <span className="pill pill-neutral">{t('farm.readOnly')}</span>}
      </div>
      {/*
       * The hub renders for EVERY visitor, not only after a wallet connects.
       * It used to sit inside the connected branch, so even a public-open build
       * — one where any wallet may supply — showed an empty section to the
       * person who had not connected yet: exactly the person the rollout exists
       * to reach («در فارم هنوز نمیاد برای همه»). This cannot resurrect a
       * closed money path: each panel decides its own visibility from the build
       * flags, the connected owner and its on-chain position, so in a
       * capital-off build all five still render nothing and the section is
       * empty the way it was.
       */}
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

/*
 * «داغ همین حالا» — a horizontal RAIL, not a 3-column grid.
 *
 * The cards sit side by side in one fixed-height strip that scrolls left/right
 * (scroll-snap + hidden scrollbar, same pattern as the tab rail above), so the
 * row keeps its shape on a narrow phone instead of collapsing into a single
 * column. Each card now carries the rank, the pair, its project · chain line
 * and the score pill, all clipped with an ellipsis rather than wrapping.
 */
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
              {/* the same mark as the card, so the rail and the list agree */}
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

  /* Keep the selected tab visible inside the horizontal rail. `block:
     'nearest'` is what stops this from nudging the page itself vertically —
     only the rail scrolls, and RTL/LTR is resolved by the browser. */
  useEffect(() => {
    tabsRef.current?.querySelector('button.active')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [tab]);

  /* The verified Solana asset list: icons + live liquidity for the staking
     rows. A failure here degrades to the curated rows without live extras —
     never to a blank section. */
  useEffect(() => {
    let alive = true;
    getSolanaAssets()
      .then((result) => { if (alive) setSolAssets(result); })
      .catch(() => { if (alive) setSolAssets(null); });
    return () => { alive = false; };
  }, []);

  /* Earn deep-links here (/farm?tab=inapp&focus=sol|eth|gold) — scroll the
     matching in-app section into view once the tab renders. */
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

  const deposit = useMemo(() => {
    const n = Number(customAmount);
    return Number.isFinite(n) && n > 0 ? n : amount;
  }, [amount, customAmount]);

  const opportunities = useMemo(() => {
    const metadata = { source: data?.source || 'defillama', updatedAt: data?.at || null, freshness: data?.freshness };
    return (data?.pools || []).map((pool) => normalizeFarmOpportunity(pool, metadata));
  }, [data]);

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
  const chains = useMemo(() => [...new Set(opportunities.map((p) => p.chain))].sort(), [opportunities]);
  const selectedPool = opportunities.find((p) => p.id === selected?.id) || null;

  /* Picker option lists: chain rows carry the network icon, sort rows carry
     a small glyph, and every label is localised. */
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

  const selectTab = (id) => { haptic?.('select'); setSelected(null); setExpandedId(null); setParams({ tab: id }, { replace: true }); };
  const togglePool = (pool) => {
    haptic?.('light');
    setExpandedId((v) => (v === pool.id ? null : pool.id));
  };
  const selectPool = (pool) => {
    haptic?.('light');
    const next = selected?.id === pool.id ? null : pool;
    setSelected(next);
    /* Opening analytics also opens the card body, so the buttons it
       references are visible; closing analytics collapses the card too. */
    setExpandedId(next ? pool.id : null);
    const context = { page: 'farm', tab, selectedPool: next?.id || null, network: next?.chain || null, walletState: wallet.isConnected ? 'connected' : 'read-only', previousIntent: null, pendingAction: null };
    try { sessionStorage.setItem('fbt:farm-context', JSON.stringify(context)); } catch { /* storage optional */ }
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
  /*
   * Staking handoff, by MINT — the symbol is what the clones copy, so it must
   * never be the thing that selects the token on arrival. `?to=` resolves
   * against the curated list only (see SolanaSwap), which these mints are on.
   */
  const stakeLst = (asset) => {
    haptic?.('select');
    navigate(`/solana?to=${encodeURIComponent(asset.mint)}`);
  };
  const buyEthStake = (sym) => {
    haptic?.('select');
    navigate(`/swap?chain=1&from=USDT&to=${encodeURIComponent(sym)}`);
  };
  const buyGold = (sym) => {
    haptic?.('select');
    navigate(`/swap?chain=1&from=USDT&to=${encodeURIComponent(sym)}`);
  };

  const renderCards = (rows) => (
    <motion.div className="farm-pool-grid" variants={stagger} initial="hidden" animate="show">
      {rows.map((pool) => (
        <div key={pool.id} className="farm-pool-with-details">
          <PoolCard pool={pool} amount={deposit} expanded={expandedId === pool.id} selected={selected?.id === pool.id} onToggle={togglePool} onShowDetails={selectPool} onGetTokens={getTokens} onOpenPool={openPool} t={t} />
          {selected?.id === pool.id && <PoolDetails pool={pool} amount={deposit} wallet={wallet} onGetTokens={getTokens} onOpenPool={openPool} t={t} />}
        </div>
      ))}
    </motion.div>
  );

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('farm.title')}</h1>
        <p className="muted">{t('farm.subtitle')}</p>
      </motion.div>

      <ProtocolStatusCard protocol={protocol} t={t} />
      <div className="row-between" style={{ marginBlock: 10 }}>
        <span className="faint" role="status">{refreshing ? t('farm.refreshing') : t('farm.feedRefreshNote')}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={refreshing}>{error ? t('farm.retry') : t('farm.refresh')}</button>
      </div>
      {data?.freshness === 'STALE' && <p className="notice" role="status">{t('farm.staleNotice')}</p>}

      {/* The five destinations as ONE horizontal rail: it scrolls left/right
          (flick or drag) instead of stacking into a column, and the selected
          tab is centred into view whenever it changes so a deep link never
          lands on a rail scrolled to the wrong end. */}
      <div className="segmented seg-lg farm-tabs" role="tablist" aria-orientation="horizontal" ref={tabsRef}>
        {FARM_TABS.map((id) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => selectTab(id)} style={{ isolation: 'isolate' }}>{tab === id && <SegIndicator id="farmtab" />}{t(`farm.tab.${id}`)}</button>)}
      </div>

      {/*
        «مرکز بازده و نقدینگی FBT» — ONE uniform surface.
        It used to stack three decorative layers on the collapsible box:
        `card-rgb` paints an animated conic ring 1px OUTSIDE the box
        (`inset: -1px`) while `.card` clips to its own rounded padding box, and
        `card-glow-cyan` throws a bright cyan halo plus a `.sheen` wash over the
        same clipped corners. Where the ring, the glow and the clip disagreed,
        the corners kept a bright sliver — the white bars in the margin that
        were reported. The decorative layers are gone; the box is a single
        border, one soft gradient and even padding all the way round.
      */}
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
        {FILTERS.map((id) => <button key={id} className={`tag ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{t(`farm.category.${id}`)}</button>)}
      </div>
      {/*
        NETWORK + SORT — two modern pickers in ONE horizontal row.
        Native selects cannot show a chain icon and their popups ignore the
        theme. Both boxes here are the shared ModernSelect: icon + label +
        chevron trigger, and the option list opens as a properly-sized sheet
        (dark and light), so the page never carries two stretched dropdowns.
        The row splits 50/50 and stays on one line — aligned, same height,
        same width.
      */}
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
          /* On tabs without a sort control the slot stays filled with the
             fixed rule, so the network box never jumps widths. */
          <div className="farm-select-static" role="note">
            <span className="modern-select-icon farm-select-static-icon" aria-hidden="true">{SORT_ICONS.score}</span>
            <span className="modern-select-text">
              <span className="modern-select-label">{t('farm.sort.score')}</span>
              <span className="modern-select-sublabel">{t('farm.sortBy')}</span>
            </span>
          </div>
        )}
      </div>
      <div className="farm-controls">
        <input className="farm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('farm.search')} aria-label={t('farm.search')} />
        <div className="farm-amounts"><span className="faint">{t('farm.ifIDeposit')}</span><div className="row farm-amount-row">{AMOUNTS.map((n) => <button key={n} className={`tag ${amount === n && !customAmount ? 'active' : ''}`} onClick={() => { setAmount(n); setCustomAmount(''); }}>{fmtUsd(n)}</button>)}<input className="farm-amt-input" inputMode="decimal" value={customAmount} onChange={(e) => setCustomAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder={t('farm.customAmt')} /></div></div>
      </div>

      {loading && <div className="stack">{[0, 1, 2].map((i) => <div className="skel" key={i} style={{ height: 150, borderRadius: 14 }} />)}</div>}
      {!loading && error && <p className="notice notice-danger">{t('farm.unavailable')}</p>}
      {!loading && !error && tab !== 'inapp' && filtered.length === 0 && <p className="notice">{t('farm.noneForFilter')}</p>}
      {!loading && !error && data && tab !== 'inapp' && filtered.length > 0 && (
        <p className="farm-filtered faint">{t('farm.filteredNote', { shown: filtered.length, returned: data.pools.length, passed: data.passed ?? data.pools.length, considered: data.considered ?? data.pools.length })}</p>
      )}

      {data?.truncated && <p className="notice">{t('farm.feedTruncated', { count: data.pools.length })}</p>}

      {/*
        The in-app tab renders even when the yield feed is down: staking
        tokens and gold are bought, not joined — only their live APY labels
        need the feed, and those degrade to nothing (never to a stale number).
      */}
      {tab === 'inapp' && (
        <>
          {!loading && (
            <InAppTab pools={opportunities} deposit={deposit} liveByMint={liveByMint} onStakeLst={stakeLst} onBuyEth={buyEthStake} onBuyGold={buyGold} t={t} />
          )}
          {/*
            «هر ۵ شبکه که زیر صفحه فارم هست را بیار داخل تب داخل اپ» — the
            five execution panels used to sit BELOW every tab, one stack after
            the lists. They now live here, inside the in-app tab, and nowhere
            else. Rendering semantics are unchanged otherwise: the hub still
            shows on this tab for every visitor, connected or not, and each
            panel still decides its own visibility from the build flags —
            nothing about any money path was touched by the move.
          */}
          <PositionPanel wallet={wallet} t={t} navigate={navigate} />
        </>
      )}
      {!loading && !error && tab === 'recommended' && <section><p className="section-label">{t('farm.recommendedFarms')}</p><p className="farm-filtered faint">{t('farm.scoreExplanation')}</p><HotStrip rows={filtered} onSelect={selectPool} t={t} />{renderCards(recommended)}</section>}
      {!loading && !error && tab === 'recommended' && selectedPool && !recommended.some((p) => p.id === selectedPool.id) && <PoolDetails key={selectedPool.id} pool={selectedPool} amount={deposit} wallet={wallet} onGetTokens={getTokens} onOpenPool={openPool} t={t} />}
      {!loading && !error && tab === 'market' && <section><p className="section-label">{t('farm.defiMarket')}</p><div className="farm-market-grid">{marketRows.map(([category, pool]) => <div key={category}><p className="farm-market-label">{t(`farm.market.${category}`)}</p><PoolCard pool={pool} amount={deposit} expanded={expandedId === pool.id} selected={selected?.id === pool.id} onToggle={togglePool} onShowDetails={selectPool} onGetTokens={getTokens} onOpenPool={openPool} t={t} /></div>)}</div></section>}
      {!loading && !error && tab === 'strategies' && <section><p className="section-label">{t('farm.yieldStrategies')}</p><p className="farm-filtered faint">{t('farm.strategyDisclaimer')}</p><div className="farm-strategy-grid">{strategies.map(({ category, pool }) => <div key={category}><p className="farm-market-label">{t(`farm.strategy.${category}`)}</p><PoolCard pool={pool} amount={deposit} expanded={expandedId === pool.id} selected={selected?.id === pool.id} onToggle={togglePool} onShowDetails={selectPool} onGetTokens={getTokens} onOpenPool={openPool} t={t} /></div>)}</div></section>}
      {!loading && !error && tab === 'pools' && <section><div className="row-between"><p className="section-label">{t('farm.pools')}</p><span className="faint">{t('farm.poolCount', { count: filtered.length })}</span></div>{renderCards(filtered.slice(0, visibleCount))}{filtered.length > visibleCount && <button type="button" className="btn btn-ghost" onClick={() => setVisibleCount((n) => n + 24)}>{t('farm.showMore')}</button>}</section>}

      {!loading && !error && ['market', 'strategies'].includes(tab) && selectedPool && <PoolDetails key={selectedPool.id} pool={selectedPool} amount={deposit} wallet={wallet} onGetTokens={getTokens} onOpenPool={openPool} t={t} />}

      <InfoBox title={t('farm.custodyTitle')} tone="info" id="farm-custody"><p>{t('farm.nativeCustodyNotice')}</p></InfoBox>
      <InfoBox title={t('farm.riskDisclosureTitle')} tone="warning"><p>{t('farm.riskDisclosure')}</p></InfoBox>
      <AdBanner slot="stocks" />
    </PageTransition>
  );
}

/*
 * One liquid-staking row. The yield is JOINED from the live pools this screen
 * already fetched (yieldForLst matches the DefiLlama project + symbol), and
 * the icon + liquidity come from the verified Solana asset list — nothing on
 * this row is typed in. Buying the token IS the stake, so the button hands
 * off to our own Solana swap by MINT, never by symbol (symbols are what the
 * clones copy).
 */
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

/*
 * Everything on this tab settles inside the app: buying the token IS the
 * position. No deposit contract to call, nothing to lock, no external site —
 * which is exactly why these rows carry working buttons while the protocol
 * pools below carry analysis plus a pool-page link.
 */
function InAppTab({ pools, deposit, liveByMint, onStakeLst, onBuyEth, onBuyGold, t }) {
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
