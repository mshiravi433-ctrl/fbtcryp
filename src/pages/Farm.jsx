import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import AdBanner from '../components/AdBanner';
import SegIndicator from '../components/SegIndicator';
import { fmtCompact, fmtUsd } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { IconPools, IconShield, IconSwap } from '../components/Icons';
import { useHideBalances } from '../hooks/useHideBalances';
import { getYields, pairSwapRoute, pairTokens } from '../lib/yields';
import {
  buildYieldStrategies, emitFarmEvent, fbtFeeEngine, FARM_PROTOCOL,
  farmPoolResearch, farmProtocolSummary, normalizeFarmOpportunity
} from '../lib/farmDeFi';

const FARM_TABS = ['recommended', 'market', 'strategies', 'pools'];
const FILTERS = ['all', 'stable', 'blueChip', 'highYield', 'lowRisk', 'autoCompound', 'lp', 'staking', 'vault'];
const AMOUNTS = [100, 1000, 10000];

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
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', minWidth: 0 }}>
          <span style={{ color: 'var(--rgb-1)', flexShrink: 0 }}><IconShield width={22} height={22} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t('farm.protocolConnected')}</div>
            <div className="muted" style={{ fontSize: 11.5, margin: '2px 0 0' }}>
              {FARM_PROTOCOL.name} · {t('farm.protocolMode')}
            </div>
          </div>
        </div>
        <span className={`pill ${status === 'ACTIVE' ? 'pill-neutral' : status === 'UNAVAILABLE' ? 'pill-down' : 'pill-rgb'}`}>{statusLabel}</span>
      </div>

      <div className="farm-protocol-meta">
        <div><span className="faint">{t('farm.protocolSource')}</span><span className="mono" dir="ltr">{protocol?.source || FARM_PROTOCOL.source}</span></div>
        <div><span className="faint">{t('farm.protocolPools')}</span><span className="mono">{protocol?.poolCount ?? 0}</span></div>
        <div><span className="faint">{t('farm.protocolLastSync')}</span><span className="mono">{updated}</span></div>
        <div><span className="faint">{t('farm.protocolCapabilities')}</span><span className="mono" dir="ltr">{(protocol?.capabilities || FARM_PROTOCOL.capabilities).join(' · ')}</span></div>
      </div>
      {protocol?.error && <p className="faint" style={{ margin: '7px 0 0' }}>{protocol.error}</p>}
    </motion.section>
  );
}

function PoolCard({ pool, amount, selected, onSelect, onGetTokens, t }) {
  const route = pairSwapRoute(pool);
  const pair = pairTokens(pool);
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
        {pool.stablecoin && <span className="pill pill-neutral">{t('farm.stableShort')}</span>}
        {pool.ilRisk && <span className="pill pill-down">{t('farm.ilShort')}</span>}
        <FreshnessPill freshness={pool.freshness} t={t} />
      </div>

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

      <div className="farm-actions">
        <button className="btn btn-ghost farm-btn" onClick={() => onSelect(pool)}>{t('farm.viewAnalytics')}</button>
        {route ? (
          <button className="btn btn-ghost farm-btn" onClick={() => onGetTokens(route)}>
            <IconSwap width={15} height={15} /> {t('farm.getPair')}
          </button>
        ) : <span className="farm-unavailable-action">{t('farm.getPair')}: {t('farm.statusUnavailable')}</span>}
      </div>
      {pair.length > 1 && <p className="faint farm-pair-note">{t('farm.poolExecutionUnavailable')}</p>}
    </motion.article>
  );
}

function PoolDetails({ pool, amount, wallet, onGetTokens, t }) {
  const route = pairSwapRoute(pool);
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

  return (
    <motion.section className="card card-rgb farm-details" variants={riseIn} initial="hidden" animate="show" aria-live="polite">
      <div className="row-between" style={{ gap: 10 }}>
        <div>
          <p className="section-label" style={{ margin: 0 }}>{t('farm.poolAnalytics')}</p>
          <div className="farm-pool-sym" dir="ltr">{pool.symbol}</div>
        </div>
        <div className="farm-details-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="pill pill-neutral">{FARM_PROTOCOL.name}</span>
          <span className="pill pill-neutral">{t('farm.protocolActive')}</span>
          <RiskPill risk={pool.risk} t={t} />
        </div>
      </div>

      <div className="farm-economics">
        <Metric label={t('farm.amount')} value={fmtUsd(amount)} />
        <Metric label={t('farm.protocol')} value={pool.project} />
        <Metric label={t('farm.network')} value={pool.chain} />
        <Metric label={t('farm.grossApy')} value={`${pool.apy}%`} />
        <Metric label={t('farm.protocolFees')} value={t('farm.includedInApy')} />
        <Metric label={t('farm.gasEstimate')} unavailable />
        <Metric label={t('farm.fbtFee')} value={`${fmtUsd(fee.fbtFeeUsd)} (${(fee.fbtFeeBps / 100).toFixed(2)}%)`} />
        <Metric label={t('farm.estimatedNetApy')} value={netAnalysisApy == null ? null : `${netAnalysisApy.toFixed(2)}%`} unavailable={netAnalysisApy == null} strong />
        <Metric label={t('farm.realYieldShare')} value={realPct == null ? null : `${realPct}%`} unavailable={realPct == null} />
        <Metric label={t('farm.rewardYieldShare')} value={rewardPct == null ? null : `${rewardPct}%`} unavailable={rewardPct == null} />
        <Metric label={t('farm.rateVs30d')} value={mean30 == null ? null : `${pool.apy}% / ${mean30}%`} unavailable={mean30 == null} />
      </div>

      <p className="notice">{t('farm.analysisActivated')}</p>
      <p className="faint">{t('farm.netIsAnalysis')}</p>

      <div className="farm-risk-grid">
        {Object.entries(factors).map(([key, value]) => (
          <div key={key} className="farm-risk-row"><span>{t(`farm.riskFactor.${key}`)}</span><span className="mono">{t(`farm.risk.${value}`, { defaultValue: value })}</span></div>
        ))}
      </div>

      <div className="farm-source-line faint">
        {t('farm.sourceLine', { source: research.source, time: updateTime })}
        {research.freshness && <> · {research.freshness}</>}
      </div>

      <div className="farm-action-grid">
        {route && <button className="btn btn-primary farm-btn" onClick={() => onGetTokens(route)}>{t('farm.getPair')}</button>}
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

export default function Farm() {
  useHideBalances();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { haptic } = useTelegram();
  const wallet = useWallet();
  const legacyTab = params.get('tab');
  const tab = FARM_TABS.includes(legacyTab) ? legacyTab : legacyTab === 'market' ? 'market' : 'recommended';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [amount, setAmount] = useState(1000);
  const [customAmount, setCustomAmount] = useState('');
  const [selected, setSelected] = useState(null);

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
    if (['autoCompound', 'vault'].includes(filter)) rows = [];
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

  const renderCards = (rows) => (
    <motion.div className="farm-pool-grid" variants={stagger} initial="hidden" animate="show">
      {rows.map((pool) => <PoolCard key={pool.id} pool={pool} amount={deposit} selected={selected?.id === pool.id} onSelect={selectPool} onGetTokens={getTokens} t={t} />)}
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

      <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" /><div className="row" style={{ gap: 11, alignItems: 'flex-start' }}><span style={{ color: 'var(--rgb-1)', flexShrink: 0 }}><IconPools width={22} height={22} /></span><div><div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('farm.yieldCenterTitle')}</div><p className="muted" style={{ fontSize: 12.3, margin: 0 }}>{t('farm.whatBody')}</p></div></div>
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
      {!loading && !error && filtered.length === 0 && <p className="notice">{t('farm.noneForFilter')}</p>}

      {!loading && !error && tab === 'recommended' && <section><p className="section-label">{t('farm.recommendedFarms')}</p><p className="farm-filtered faint">{t('farm.scoreExplanation')}</p>{renderCards(recommended)}</section>}
      {!loading && !error && tab === 'market' && <section><p className="section-label">{t('farm.defiMarket')}</p><div className="farm-market-grid">{marketRows.map(([category, pool]) => <div key={category}><p className="farm-market-label">{t(`farm.market.${category}`)}</p><PoolCard pool={pool} amount={deposit} selected={selected?.id === pool.id} onSelect={selectPool} onGetTokens={getTokens} t={t} /></div>)}</div></section>}
      {!loading && !error && tab === 'strategies' && <section><p className="section-label">{t('farm.yieldStrategies')}</p><p className="farm-filtered faint">{t('farm.strategyDisclaimer')}</p><div className="farm-strategy-grid">{strategies.map(({ category, pool }) => <div key={category}><p className="farm-market-label">{t(`farm.strategy.${category}`)}</p><PoolCard pool={pool} amount={deposit} selected={selected?.id === pool.id} onSelect={selectPool} onGetTokens={getTokens} t={t} /></div>)}</div></section>}
      {!loading && !error && tab === 'pools' && <section><div className="row-between"><p className="section-label">{t('farm.pools')}</p><span className="faint">{t('farm.poolCount', { count: filtered.length })}</span></div>{renderCards(filtered)}</section>}

      {selected && <PoolDetails pool={selected} amount={deposit} wallet={wallet} onGetTokens={getTokens} t={t} />}
      <PositionPanel wallet={wallet} t={t} navigate={navigate} />

      <InfoBox title={t('farm.custodyTitle')} tone="info" id="farm-custody"><p>{t('farm.nativeCustodyNotice')}</p></InfoBox>
      <InfoBox title={t('farm.riskDisclosureTitle')} tone="warning"><p>{t('farm.riskDisclosure')}</p></InfoBox>
      <AdBanner slot="stocks" />
    </PageTransition>
  );
}
