import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import AdBanner from '../components/AdBanner';
import SegIndicator from '../components/SegIndicator';
import TokenIcon from '../lib/tokenIcon';
import { fmtCompact, fmtUsd } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { IconLock, IconPools, IconShield, IconSwap } from '../components/Icons';
import { useHideBalances } from '../hooks/useHideBalances';
import { TOKENS } from '../lib/chains';
import {
  farmScore, getYields, impermanentLoss, investRoute, pairSwapRoute, pairTokens,
  projectEarnings, rateIsUnusual, realShare
} from '../lib/yields';
import { getSolanaAssets, projectStake, yieldForLst } from '../lib/solanaAssetsClient';
import { LST_ASSETS } from '../lib/solanaAssets';
import {
  AUTOCOMPOUND_PROJECTS, buildYieldStrategies, emitFarmEvent, fbtFeeEngine, FARM_PROTOCOL,
  farmPoolResearch, farmProtocolSummary, normalizeFarmOpportunity, VAULT_PROJECTS
} from '../lib/farmDeFi';
/*
 * The one in-app DeFi execution surface: Aave v3 on Base, USDC only. It renders
 * itself only for that exact pool and returns null for everything else, so the
 * "buy the token on the protocol site" guidance below is untouched for every
 * other pool — and still available for this one, since the grid underneath is
 * unchanged. Gated by AAVE_BASE_SUPPLY_ENABLED; see docs/defi/aave-v3-base.md.
 */
import AaveBaseUsdcPanel from '../components/Farm/AaveBaseUsdcPanel';
import TrendChart from '../components/TrendChart';

const FARM_TABS = ['inapp', 'market', 'pools', 'recommended', 'strategies'];
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
    : status === 'UNAVAILABLE' ? t('farm.protocolUnavailable') : t('farm.protocolConnecting');
  const updated = protocol?.updatedAt
    ? new Date(protocol.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

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
        <span className="pill pill-neutral"><IconLock width={12} height={12} /> {t('farm.readOnly')}</span>
        <span className="farm-protocol-live" aria-hidden="true">
          <i />
          <span className="faint">{t('farm.protocolMode')}</span>
        </span>
      </div>

      <div className="farm-protocol-meta">
        <div className="farm-protocol-meta-cell">
          <span className="faint">{t('farm.protocolSource')}</span>
          <span className="mono" dir="ltr">{protocol?.source || FARM_PROTOCOL.source}</span>
        </div>
        <div className="farm-protocol-meta-cell">
          <span className="faint">{t('farm.protocolPools')}</span>
          <span className="mono">{protocol?.poolCount ?? 0}</span>
        </div>
        <div className="farm-protocol-meta-cell">
          <span className="faint">{t('farm.protocolLastSync')}</span>
          <span className="mono">{updated}</span>
        </div>
        <div className="farm-protocol-meta-cell farm-protocol-meta-cell--wide">
          <span className="faint">{t('farm.protocolCapabilities')}</span>
          <span className="mono" dir="ltr">{(protocol?.capabilities || FARM_PROTOCOL.capabilities).join(' · ')}</span>
        </div>
      </div>
      {protocol?.error && <p className="faint" style={{ margin: '7px 0 0' }}>{protocol.error}</p>}
    </motion.section>
  );
}

function PoolCard({ pool, amount, selected, onSelect, onGetTokens, onOpenPool, onShowDetails, t }) {
  const route = investRoute(pool);
  const economics = fbtFeeEngine.estimateNetYield({
    grossApy: pool.apy,
    protocolCostApy: 0, // the feed's depositor APY is already net of protocol-retained yield
    gasUsd: null,
    amountUsd: amount
  });
  const beforeGas = Math.max(-100, Number(pool.apy || 0) - economics.fbtFeeApy);

  return (
    <motion.article className={`farm-pool ${selected ? 'farm-pool-selected' : ''}`} variants={riseIn} id={`farm-pool-${pool.id}`}>
      <div className="row-between farm-pool-head">
        <div style={{ minWidth: 0 }}>
          <div className="farm-pool-sym" dir="ltr">{pool.symbol}</div>
          <div className="set-row-sub">{pool.project} · {pool.chain}</div>
        </div>
        <div className="farm-apy-wrap">
          <div className="farm-apy mono" dir="ltr">{pool.apy}%</div>
          <div className="faint farm-apy-label">{t('farm.estimatedApy')}</div>
        </div>
      </div>

      <div className="farm-card-badges">
        <RiskPill risk={pool.risk} t={t} />
        <span className="pill pill-neutral">{pool.chain}</span>
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

  return (
    <motion.section className="card card-rgb farm-details" variants={riseIn} initial="hidden" animate="show" aria-live="polite">
      <div className="row-between" style={{ gap: 10 }}>
        <div>
          <p className="section-label" style={{ margin: 0 }}>{t('farm.poolAnalytics')}</p>
          <div className="farm-pool-sym" dir="ltr">{pool.symbol}</div>
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
        <Metric label={t('farm.protocol')} value={pool.project} />
        <Metric label={t('farm.network')} value={pool.chain} />
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
        <Metric label={t('farm.estimatedNetApy')} value={netAnalysisApy == null ? null : `${netAnalysisApy.toFixed(2)}%`} unavailable={netAnalysisApy == null} strong />
        <Metric label={t('farm.realYieldShare')} value={realPct == null ? null : `${realPct}%`} unavailable={realPct == null} />
        <Metric label={t('farm.rewardYieldShare')} value={rewardPct == null ? null : `${rewardPct}%`} unavailable={rewardPct == null} />
        <Metric label={t('farm.rateVs30d')} value={mean30 == null ? null : `${pool.apy}% / ${mean30}%`} unavailable={mean30 == null} />
      </div>

      <HorizonEarningsChart pool={pool} amount={amount} t={t} />
      <FeeEngineCard pool={pool} amount={amount} t={t} />

      <p className="notice">{t('farm.analysisActivated')}</p>
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

      <div className="card card-soft" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{t('farm.howToInvestTitle')}</div>
        <p className="faint" style={{ margin: '0 0 6px', fontSize: 12, lineHeight: 1.8 }}>{t('farm.howToInvest1')}</p>
        <p className="faint" style={{ margin: 0, fontSize: 12, lineHeight: 1.8 }}>{t('farm.howToInvest2')}</p>
      </div>

      <div className="farm-source-line faint">
        {t('farm.sourceLine', { source: research.source, time: updateTime })}
        {research.freshness && <> · {research.freshness}</>}
      </div>

      {/* In-app supply / withdraw, only for Aave v3 · Base · USDC. Null
          everywhere else, so this cannot move a CTA on any other pool. */}
      <AaveBaseUsdcPanel pool={pool} />

      <div className="farm-action-grid">
        {route && <button className="btn btn-primary farm-btn" onClick={() => onGetTokens(route)}>{pairSwapRoute(pool) ? t('farm.getTokens', { a: route.from, b: route.to }) : t('farm.stakeNow', { sym: route.to })}</button>}
        {pool.url && <button className="btn btn-ghost farm-btn" onClick={() => onOpenPool(pool.url)} title={t('farm.openPoolHint')}>{t('farm.openPool')}</button>}
        {['addLiquidity', 'removeLiquidity', 'stakeLp', 'unstakeLp', 'claim', 'compound'].map((action) => (
          <button key={action} className="btn btn-ghost farm-btn" disabled title={t('farm.statusUnavailable')}>
            {t(`farm.action.${action}`)} · {t('farm.statusUnavailable')}
          </button>
        ))}
      </div>
      {!wallet.isConnected && <p className="faint">{t('farm.readOnly')}</p>}
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
      <p className="notice">{wallet.isConnected ? t('farm.positionsUnavailable') : t('farm.connectForPositions')}</p>
      {!wallet.isConnected && <button className="btn btn-ghost" onClick={() => navigate('/wallet')}>{t('wallet.connect')}</button>}
    </section>
  );
}

function HotStrip({ rows, onSelect, t }) {
  const hot = useMemo(() => [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 3), [rows]);
  if (hot.length === 0) return null;
  return (
    <div className="farm-hot">
      <p className="farm-market-label">{t('farm.hot')}</p>
      <div className="farm-hot-grid">
        {hot.map((pool) => (
          <button key={pool.id} type="button" className="farm-hot-card" onClick={() => onSelect(pool)}>
            <span className="farm-hot-sym" dir="ltr">{pool.symbol}</span>
            <span className="farm-hot-apy mono" dir="ltr">{pool.apy}%</span>
            {pool.score != null && <span className="farm-hot-score">{t('farm.score', { score: pool.score })}</span>}
          </button>
        ))}
      </div>
    </div>
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
  const [data, setData] = useState(null);
  const [solAssets, setSolAssets] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [amount, setAmount] = useState(1000);
  const [customAmount, setCustomAmount] = useState('');
  const [selected, setSelected] = useState(null);
  const [yieldCenterOpen, setYieldCenterOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getYields()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setError(null);
        emitFarmEvent('FARM_DISCOVERED', { count: result.pools.length, source: result.source });
      })
      .catch(setError)
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

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
    const metadata = { source: data?.source || 'defillama', updatedAt: data?.at || null };
    return (data?.pools || []).map((pool) => normalizeFarmOpportunity(pool, metadata));
  }, [data]);

  const filtered = useMemo(() => {
    let rows = opportunities;
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
    return rows;
  }, [opportunities, filter, q]);

  const recommended = useMemo(() => [...filtered].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 8), [filtered]);
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
    error: error || null
  }), [data, error]);

  const selectTab = (id) => { haptic?.('select'); setSelected(null); setParams({ tab: id }, { replace: true }); };
  const selectPool = (pool) => {
    haptic?.('light'); setSelected(pool);
    const context = { page: 'farm', tab, selectedPool: pool.id, network: pool.chain, walletState: wallet.isConnected ? 'connected' : 'read-only', previousIntent: null, pendingAction: null };
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
          <PoolCard pool={pool} amount={deposit} selected={selected?.id === pool.id} onSelect={selectPool} onShowDetails={selectPool} onGetTokens={getTokens} onOpenPool={openPool} t={t} />
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

      <div className="segmented seg-lg farm-tabs" role="tablist">
        {FARM_TABS.map((id) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => selectTab(id)} style={{ isolation: 'isolate' }}>{tab === id && <SegIndicator id="farmtab" />}{t(`farm.tab.${id}`)}</button>)}
      </div>

      <motion.section className={`card card-rgb card-glow-cyan farm-yield-center ${yieldCenterOpen ? 'is-open' : ''}`} variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <button type="button" className="farm-yield-center-toggle" onClick={() => setYieldCenterOpen((v) => !v)} aria-expanded={yieldCenterOpen}>
          <span className="row" style={{ gap: 11, alignItems: 'flex-start' }}><span style={{ color: 'var(--rgb-1)', flexShrink: 0 }}><IconPools width={22} height={22} /></span><span><span style={{ display: 'block', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('farm.yieldCenterTitle')}</span><span className="muted" style={{ display: 'block', fontSize: 12.3 }}>{t('farm.whatBody')}</span></span></span>
          <span className="farm-yield-chevron" aria-hidden="true">{yieldCenterOpen ? '⌃' : '⌄'}</span>
        </button>
        {yieldCenterOpen && <div className="farm-yield-center-body"><p className="muted">{t('farm.scoreExplanation')}</p><div className="farm-yield-center-stats"><span>Live APY</span><span>TVL</span><span>Risk</span><span>Freshness</span></div></div>}
      </motion.section>

      <div className="farm-secondary-filters" role="group" aria-label={t('farm.filters')}>
        {FILTERS.map((id) => <button key={id} className={`tag ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{t(`farm.category.${id}`)}</button>)}
      </div>
      <div className="farm-controls">
        <input className="farm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('farm.search')} aria-label={t('farm.search')} />
        <div className="farm-amounts"><span className="faint">{t('farm.ifIDeposit')}</span><div className="row farm-amount-row">{AMOUNTS.map((n) => <button key={n} className={`tag ${amount === n && !customAmount ? 'active' : ''}`} onClick={() => { setAmount(n); setCustomAmount(''); }}>{fmtUsd(n)}</button>)}<input className="farm-amt-input" inputMode="decimal" value={customAmount} onChange={(e) => setCustomAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder={t('farm.customAmt')} /></div></div>
      </div>

      {loading && <div className="stack">{[0, 1, 2].map((i) => <div className="skel" key={i} style={{ height: 150, borderRadius: 14 }} />)}</div>}
      {!loading && error && <p className="notice notice-danger">{t('farm.unavailable')}</p>}
      {!loading && !error && tab !== 'inapp' && filtered.length === 0 && <p className="notice">{t('farm.noneForFilter')}</p>}
      {!loading && !error && data && tab !== 'inapp' && filtered.length > 0 && (
        <p className="farm-filtered faint">{t('farm.filteredNote', { shown: filtered.length, considered: data.considered ?? data.pools.length })}</p>
      )}

      {/*
        The in-app tab renders even when the yield feed is down: staking
        tokens and gold are bought, not joined — only their live APY labels
        need the feed, and those degrade to nothing (never to a stale number).
      */}
      {!loading && tab === 'inapp' && (
        <InAppTab pools={opportunities} deposit={deposit} liveByMint={liveByMint} onStakeLst={stakeLst} onBuyEth={buyEthStake} onBuyGold={buyGold} t={t} />
      )}
      {!loading && !error && tab === 'recommended' && <section><p className="section-label">{t('farm.recommendedFarms')}</p><p className="farm-filtered faint">{t('farm.scoreExplanation')}</p><HotStrip rows={filtered} onSelect={selectPool} t={t} />{renderCards(recommended)}</section>}
      {!loading && !error && tab === 'market' && <section><p className="section-label">{t('farm.defiMarket')}</p><div className="farm-market-grid">{marketRows.map(([category, pool]) => <div key={category}><p className="farm-market-label">{t(`farm.market.${category}`)}</p><PoolCard pool={pool} amount={deposit} selected={selected?.id === pool.id} onSelect={selectPool} onShowDetails={selectPool} onGetTokens={getTokens} onOpenPool={openPool} t={t} /></div>)}</div></section>}
      {!loading && !error && tab === 'strategies' && <section><p className="section-label">{t('farm.yieldStrategies')}</p><p className="farm-filtered faint">{t('farm.strategyDisclaimer')}</p><div className="farm-strategy-grid">{strategies.map(({ category, pool }) => <div key={category}><p className="farm-market-label">{t(`farm.strategy.${category}`)}</p><PoolCard pool={pool} amount={deposit} selected={selected?.id === pool.id} onSelect={selectPool} onShowDetails={selectPool} onGetTokens={getTokens} onOpenPool={openPool} t={t} /></div>)}</div></section>}
      {!loading && !error && tab === 'pools' && <section><div className="row-between"><p className="section-label">{t('farm.pools')}</p><span className="faint">{t('farm.poolCount', { count: filtered.length })}</span></div>{renderCards(filtered)}</section>}

      <PositionPanel wallet={wallet} t={t} navigate={navigate} />

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
