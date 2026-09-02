import { useEffect, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import ScrollRail from '../components/ScrollRail';
import { IconChevronLeft, IconSearch, IconBell } from '../components/Icons';
import {
  fetchOverview, fetchWhales, fetchFlows, fetchLiquidity,
  fetchEarlyTokens, fetchFreshWallets, fetchExchanges,
  fmtUsd, fmtPct, shortAddr, timeAgo, classifyQuery, CHAIN_OPTIONS,
  chainIdForSlug
} from '../lib/smartMoneyClient';
import { trackWallet } from '../lib/smartMoneyWatch';
import { useTelegram } from '../context/TelegramContext';
import SmartMoneyWallet from './SmartMoneyWallet';

/* import styles via side-effect */
import '../styles/smart-money.css';

const TABS = ['overview', 'whales', 'wallets', 'tokens', 'flows', 'alerts'];

/*
 * LAST-GOOD OVERVIEW CACHE.
 * «وقتی هم میزنی اتصال مجدد هیچ داده‌ای نشان نمی‌دهد» — when a refresh
 * failed there was literally nothing on screen, even though the SAME device
 * had rendered live data a minute earlier. Real data we already showed the
 * user is strictly better than an empty error state, so the last successful
 * overview is kept in localStorage and hydrated on mount; the offline banner
 * still appears on top of it whenever the live refresh is failing.
 */
const LAST_GOOD_KEY = 'fbt.sm.overview.v1';

function readLastGood() {
  try {
    const raw = localStorage.getItem(LAST_GOOD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Stale beyond 24h is more misleading than helpful.
    if (!parsed?.at || Date.now() - parsed.at > 24 * 3600_000) return null;
    return parsed;
  } catch { return null; }
}

function writeLastGood(d) {
  try {
    if (d && d.dataStatus === 'live') localStorage.setItem(LAST_GOOD_KEY, JSON.stringify(d));
  } catch { /* storage full/blocked — cache is best-effort */ }
}

function ConfBar({ value, signal }) {
  const color = signal === 'DISTRIBUTION' ? '#ff5c7a' : '#2ee6a8';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="sm-meter"><i style={{ width: `${Math.min(100, value || 0)}%`, background: color }} /></div>
      <span style={{ fontSize: 11, fontWeight: 900, color }}>{value}%</span>
    </div>
  );
}

function Spinner() {
  return <div className="sm-section">{[...Array(5)].map((_, i) => <div key={i} className="sm-skel" style={{ width: `${90 - i * 9}%` }} />)}</div>;
}

function Empty({ children }) {
  return <div className="sm-section sm-empty">{children}</div>;
}

export default function SmartMoney() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [tab, setTab] = useState('overview');
  const [window, setWindow] = useState('24h');
  const [data, setData] = useState(() => readLastGood());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const abortRef = useRef(null);
  const tabRefs = useRef({});

  /* Keep the selected tab visible inside the rail. Only on `tab` change —
     never on the 45s data refresh, or the page would yank itself back up. */
  useEffect(() => {
    tabRefs.current[tab]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [tab]);

  const load = useCallback(async (win) => {
    abortRef.current?.abort?.();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const d = await fetchOverview(win, ctrl.signal);
      setData(d);
      writeLastGood(d);
    } catch (e) {
      if (e.message !== 'ABORTED') setError(e.message);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { load(window); const i = setInterval(() => load(window), 45_000); return () => { clearInterval(i); abortRef.current?.abort?.(); }; }, [window, load]);

  const onSearch = () => {
    haptic?.('light');
    const c = classifyQuery(query);
    if (c.kind === 'address') {
      const chain = c.chain === 'solana' ? 'solana' : 1;
      navigate(`/smart-money/wallet/${chain}/${c.address}`);
    } else if (c.kind === 'tx') {
      /*
       * NOT `window.open` — the component's `window` state (the '24h' string)
       * shadows the global here, so `window.open(...)` was a TypeError and tx
       * search silently did nothing.
       */
      globalThis.open(c.chain === 'solana'
        ? `https://solscan.io/tx/${c.address}`
        : `https://etherscan.io/tx/${c.address}`, '_blank');
    } else if (c.kind === 'symbol') {
      // Search token through early-token + token activity list
      setTab('tokens');
      setQuery(c.query);
    } else {
      setTab('tokens');
    }
  };

  const m = data?.metrics;
  /*
   * dataStatus 'unavailable' means EVERY source answered nothing — NOT that
   * on-chain activity is zero. The old render painted "0" and "$0"
   * everywhere, which read as working data. Now an unavailable stream shows
   * one honest banner + "—", with retry.
   *
   * `streamStatus` (new) tracks only the whale-transfer stream that feeds
   * the metric tiles; when it is down but other sections are live, the tiles
   * show "—" while early tokens / liquidity keep rendering real data.
   */
  const offline = data?.dataStatus === 'unavailable';
  const streamDown = offline || (data?.streamStatus ?? data?.dataStatus) === 'unavailable';

  return (
    <PageTransition>
      <div className="sm-page">
        {/* Hero */}
        <motion.section className="sm-hero" variants={riseIn} initial="hidden" animate="show">
          <div className="row-between">
            <h1>✦ {t('sm.title')}</h1>
            <span className="sm-live"><span className="dot" />{t('sm.live')}</span>
          </div>
          <p className="sm-tagline" dangerouslySetInnerHTML={{ __html: t('sm.tagline') }} />
          <div className="sm-search">
            <IconSearch width={18} height={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
              placeholder={t('sm.searchPlaceholder')}
            />
            <button onClick={onSearch}>{t('sm.search')}</button>
          </div>
        </motion.section>

        {/*
          Tabs as a RAIL.
          «تب های مختلف مثل ریل حرکت نمی‌کند که انتخاب کنیم» — six Persian
          labels (کیف‌پول‌های هوشمند، جریان نقدینگی، …) never fit one phone
          row, and the old plain div could not be scrolled reliably on the
          WebView, so the tabs past the first two were unreachable. Now the
          row uses the same ScrollRail as every other rail in the app:
          horizontal-only, snap-aligned, edge fades signal "more this way",
          and selecting a tab scrolls it into view.
        */}
        <ScrollRail className="sm-tabs" ariaLabel={t('sm.title')} role="tablist">
          {TABS.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              ref={(el) => { tabRefs.current[id] = el; }}
              className={`sm-tab ${tab === id ? 'active' : ''}`}
              onClick={() => { haptic?.('light'); setTab(id); }}
            >
              {t(`sm.tabs.${id}`)}
            </button>
          ))}
        </ScrollRail>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <>
            <div className="sm-seg" style={{ marginBottom: 12 }}>
              {['24h', '7d', '30d'].map((w) => (
                <button key={w} className={window === w ? 'active' : ''} onClick={() => setWindow(w)}>{w}</button>
              ))}
            </div>

            {loading && !data && <Spinner />}
            {error && !data && <Empty>{t('sm.errorOverview')}<br /><span className="faint">{error}</span></Empty>}

            {/* Honest offline banner — see the `streamDown` flag above. */}
            {data && streamDown && (
              <div className="sm-section sm-offline">
                <span className="msg">⚠️ {t('sm.dataSourceOffline')}</span>
                <button className="sm-btn ghost" style={{ width: 'auto', padding: '4px 10px' }} onClick={() => load(window)}>{t('sm.retry')}</button>
              </div>
            )}

            {data && (
              <>
                <div className="sm-metrics">
                  <div className="sm-metric">
                    <div className="lab">{t('sm.whaleActivity')}</div>
                    <div className="val">{streamDown ? '—' : m?.whaleActivity?.value ?? '—'}</div>
                    <div className={`chg ${(m?.whaleActivity?.changePct || 0) >= 0 ? 'sm-up' : 'sm-down'}`}>{streamDown ? '—' : fmtPct(m?.whaleActivity?.changePct)}</div>
                  </div>
                  <div className="sm-metric">
                    <div className="lab">{t('sm.accumulation')}</div>
                    <div className="val sm-up">{streamDown ? '—' : fmtUsd(m?.accumulation?.valueUsd)}</div>
                    <div className="chg sm-up">{streamDown ? '—' : fmtPct(m?.accumulation?.changePct)}</div>
                  </div>
                  <div className="sm-metric">
                    <div className="lab">{t('sm.distribution')}</div>
                    <div className="val sm-down">{streamDown ? '—' : fmtUsd(m?.distribution?.valueUsd)}</div>
                    <div className="chg sm-down">{streamDown ? '—' : fmtPct(m?.distribution?.changePct)}</div>
                  </div>
                </div>

                <div className="sm-metrics">
                  <div className="sm-metric">
                    <div className="lab">{t('sm.exchangeInflow')}</div>
                    <div className="val" style={{ fontSize: 16 }}>{streamDown ? '—' : m?.exchangeInflow?.text ? `$${m.exchangeInflow.text}` : '—'}</div>
                  </div>
                  <div className="sm-metric">
                    <div className="lab">{t('sm.exchangeOutflow')}</div>
                    <div className="val" style={{ fontSize: 16 }}>{streamDown ? '—' : m?.exchangeOutflow?.text ? `$${m.exchangeOutflow.text}` : '—'}</div>
                  </div>
                  <div className="sm-metric">
                    <div className="lab">{t('sm.netFlow')}</div>
                    <div className={`val ${(m?.netFlow?.value || 0) >= 0 ? 'sm-up' : 'sm-down'}`} style={{ fontSize: 16 }}>
                      {streamDown ? '—' : m?.netFlow?.text ? `${(m.netFlow.value || 0) < 0 ? '-' : ''}$${m.netFlow.text.replace('-', '')}` : '—'}
                    </div>
                  </div>
                </div>

                {/* Token activity */}
                <div className="sm-section">
                  <h3>🐋 {t('sm.smartMoneyActivity')}</h3>
                  {data.tokenActivity?.length === 0 && <Empty>{t('sm.noActivity')}</Empty>}
                  {data.tokenActivity?.map((r) => (
                    <div key={`${r.chainId}:${r.symbol}`} className="sm-row" onClick={() => r.address && navigate(`/smart-money/token/${r.chainId}/${r.address}`)}>
                      <div className="sym">{r.symbol.slice(0, 4)}</div>
                      <div className="mid">
                        <div className="name">{r.symbol} <span className="faint" style={{ fontSize: 10 }}>· {r.chainShort}</span></div>
                        <div className="sub">{t('sm.smartWallets', { n: r.events })}</div>
                      </div>
                      <div className="right">
                        <div className={`usd ${r.netUsd >= 0 ? 'sm-up' : 'sm-down'}`}>{fmtUsd(r.netUsd)}</div>
                        <ConfBar value={r.signal === 'ACCUMULATION' ? r.accumulation : r.distribution} signal={r.signal} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Money flow quick view — hidden while offline: a 0/0 bar
                    reads as "no flow", which is exactly what we are NOT sure of. */}
                {!streamDown && <FlowSummary flows={data.flows} onMore={() => setTab('flows')} t={t} />}

                {/* Early detection */}
                <div className="sm-section">
                  <h3>⚡ {t('sm.earlyDetection')}</h3>
                  <EarlyGrid tokens={data.earlyTokens?.tokens || []} loading={!data.earlyTokens} navigate={navigate} t={t} />
                  <div className="sm-disclaimer">{data.earlyTokens?.note}</div>
                </div>

                {/* Fresh wallets */}
                {data.freshWallets && data.freshWallets.dataStatus === 'live' && (
                  <div className="sm-section">
                    <h3>🆕 {t('sm.freshWallets')}</h3>
                    <div className="sm-metrics">
                      <div className="sm-metric"><div className="lab">{t('sm.newWallets')}</div><div className="val">{data.freshWallets.newWallets}</div></div>
                      <div className="sm-metric"><div className="lab">{t('sm.interesting')}</div><div className="val">{data.freshWallets.interestingWallets}</div></div>
                      <div className="sm-metric"><div className="lab">{t('sm.capital')}</div><div className="val" style={{ fontSize: 16 }}>{fmtUsd(data.freshWallets.capitalUsd)}</div></div>
                    </div>
                    {data.freshWallets.wallets?.slice(0, 5).map((w) => (
                      <div key={`${w.chainId}:${w.address}`} className="sm-row" onClick={() => navigate(`/smart-money/wallet/${w.chainId}/${w.address}`)}>
                        <div className="sym">{w.chainShort}</div>
                        <div className="mid"><div className="name mono">{w.short}</div><div className="sub">{w.txCount ?? '—'} tx</div></div>
                        <div className="right"><div className="usd">{fmtUsd(w.capitalUsd)}</div>{w.interesting && <div className="conf sm-risk-MEDIUM">★</div>}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Liquidity */}
                {data.liquidityEvents?.events?.length > 0 && (
                  <div className="sm-section">
                    <h3>⚠️ {t('sm.liquidityMovement')}</h3>
                    {/* NOT `window.open` — the component's `window` state (the
                        '24h' string) shadows the global here, exactly like the
                        tx-search bug above; tapping a liquidity row silently
                        did nothing. */}
                    {data.liquidityEvents.events.slice(0, 6).map((e) => (
                      <div key={e.id} className="sm-row" onClick={() => e.explorerTx && globalThis.open(e.explorerTx, '_blank')}>
                        <div className="sym">{e.kind === 'LP_ADDED' ? '+' : '−'}</div>
                        <div className="mid">
                          <div className="name">{e.symbols}</div>
                          <div className="sub">{e.kind === 'LP_ADDED' ? t('sm.lpAdded') : t('sm.lpRemoved')} · {e.chainShort}{e.dex ? ` · ${e.dex}` : ''}</div>
                        </div>
                        <div className="right">
                          <div className={`usd ${e.kind === 'LP_ADDED' ? 'sm-up' : 'sm-down'}`}>{fmtUsd(e.liquidityUsd)}</div>
                          <div className={`conf sm-risk-${e.impact === 'HIGH' ? 'HIGH' : e.impact === 'MEDIUM' ? 'MEDIUM' : 'LOW'}`}>{e.impact}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="sm-disclaimer">{t('sm.disclaimer')}</div>
              </>
            )}
          </>
        )}

        {/* WHALES */}
        {tab === 'whales' && <WhalesTab navigate={navigate} t={t} />}

        {/* SMART WALLETS (reuse whale board, emphasises track action) */}
        {tab === 'wallets' && <WhalesTab navigate={navigate} t={t} smart />}

        {/* TOKEN INTELLIGENCE */}
        {tab === 'tokens' && <TokensTab navigate={navigate} t={t} query={query} setQuery={setQuery} />}

        {/* MONEY FLOW */}
        {tab === 'flows' && <FlowsTab t={t} />}

        {/* ALERTS */}
        {tab === 'alerts' && <AlertsTab navigate={navigate} t={t} />}
      </div>
    </PageTransition>
  );
}

function FlowSummary({ flows, onMore, t }) {
  const f = flows?.windows?.['24h'];
  if (!f) return null;
  return (
    <div className="sm-section">
      <h3>💰 {t('sm.moneyFlow')}<span className="spacer" />
        <button className="sm-btn ghost" style={{ width: 'auto', padding: '4px 10px' }} onClick={onMore}>{t('sm.viewAll')}</button>
      </h3>
      <FlowBar inflow={f.inflowUsd} outflow={f.outflowUsd} />
      <div className="row-between" style={{ marginTop: 10, fontSize: 12 }}>
        <span className="sm-down">↓ {t('sm.cexInflow')}: {fmtUsd(f.inflowUsd)}</span>
        <span className="sm-up">↑ {t('sm.cexOutflow')}: {fmtUsd(f.outflowUsd)}</span>
      </div>
    </div>
  );
}

export function FlowBar({ inflow, outflow }) {
  const total = Math.max(1, (inflow || 0) + (outflow || 0));
  const outPct = Math.round(((outflow || 0) / total) * 100);
  return (
    <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,92,122,0.35)' }}>
      <div style={{ width: `${100 - outPct}%`, background: 'rgba(255,92,122,0.55)' }} />
      <div style={{ width: `${outPct}%`, background: 'linear-gradient(90deg,#2ee6a8,#00e5ff)' }} />
    </div>
  );
}

function EarlyGrid({ tokens, navigate, t }) {
  if (!tokens?.length) return <Empty>{t('sm.noEarly')}</Empty>;
  return (
    <div className="sm-card-grid">
      {tokens.map((tk) => {
        /*
         * «ارتباط با بعضی از داده‌ها وجود ندارد» — Analyze hardcoded chain 1,
         * so a Base/BSC/Arbitrum token opened an Ethereum intel page whose
         * pairs and holders could never match. The DexScreener slug is mapped
         * to the real chain id; a chain we cannot serve (e.g. solana profile
         * feed rows) opens the token's DexScreener page instead of a dead
         * in-app page that pretends the data is missing.
         */
        const chainId = chainIdForSlug(tk.chain);
        const open = () => {
          if (chainId) navigate(`/smart-money/token/${chainId}/${tk.address}`);
          else globalThis.open(`https://dexscreener.com/${tk.chain}/${tk.address}`, '_blank');
        };
        return (
          <div key={`${tk.chain}:${tk.address}`} className="sm-early-card">
            <div className="tk">{tk.symbol} <span className="faint" style={{ fontSize: 10 }}>· {tk.chain}</span></div>
            <div className="meta">
              <div><div className="k">{t('sm.age')}</div><div className="v">{tk.ageHours}h</div></div>
              <div><div className="k">{t('sm.liquidity')}</div><div className="v">{fmtUsd(tk.liquidityUsd)}</div></div>
              <div><div className="k">{t('sm.volume24')}</div><div className="v">{fmtUsd(tk.volumeH24)}</div></div>
              <div><div className="k">{t('sm.risk')}</div><div className={`v sm-risk-${tk.risk}`}>{tk.risk}</div></div>
            </div>
            <button className="sm-btn" onClick={open}>{t('sm.analyze')}</button>
          </div>
        );
      })}
    </div>
  );
}

function WhalesTab({ navigate, t, smart }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let on = true;
    fetchWhales(smart ? 1_000_000 : 250_000)
      .then((d) => on && setRows(d.wallets || []))
      .catch((e) => on && setErr(e.message));
    return () => { on = false; };
  }, [smart]);

  if (err) return <Empty>{t('sm.errorOverview')}<br /><span className="faint">{err}</span></Empty>;
  if (!rows) return <Spinner />;
  if (!rows.length) return <Empty>{t('sm.noWhales')}</Empty>;

  return (
    <div className="sm-section">
      <h3>🐋 {smart ? t('sm.smartWalletsTitle') : t('sm.whaleTracking')}</h3>
      {rows.map((w) => (
        <div key={`${w.chainId}:${w.address}`} className="sm-row" onClick={() => navigate(`/smart-money/wallet/${w.chainId}/${w.address}`)}>
          <div className="sym" style={{ background: w.chainColor ? `${w.chainColor}33` : undefined }}>{w.chainShort}</div>
          <div className="mid">
            <div className="name mono">{w.short}</div>
            <div className="sub">{w.lastAction}</div>
          </div>
          <div className="right">
            <div className="usd">{fmtUsd(w.movedUsd)}</div>
            <div className={`conf sm-risk-${w.riskBand === 'LOW' ? 'LOW' : 'MEDIUM'}`}>{t(`sm.riskBand.${w.riskBand}`)}</div>
          </div>
        </div>
      ))}
      <div className="sm-disclaimer">{t('sm.whaleDisclaimer')}</div>
    </div>
  );
}

function TokensTab({ navigate, t, query, setQuery }) {
  const [early, setEarly] = useState(null);
  const [fresh, setFresh] = useState(null);
  useEffect(() => {
    let on = true;
    fetchEarlyTokens(20).then((d) => on && setEarly(d.tokens || [])).catch(() => on && setEarly([]));
    fetchFreshWallets().then((d) => on && setFresh(d)).catch(() => setFresh(null));
    return () => { on = false; };
  }, []);

  const filtered = (early || []).filter((tk) =>
    !query || tk.symbol?.toLowerCase().includes(query.toLowerCase()) || tk.address?.includes(query.toLowerCase()));

  return (
    <>
      <div className="sm-search" style={{ marginBottom: 12 }}>
        <IconSearch width={16} height={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('sm.tokenSearch')} />
      </div>
      <div className="sm-section">
        <h3>⚡ {t('sm.earlyDetection')}</h3>
        {!early ? <Spinner /> : <EarlyGrid tokens={filtered} navigate={navigate} t={t} />}
        <div className="sm-disclaimer">{t('sm.earlyNote')}</div>
      </div>
    </>
  );
}

function FlowsTab({ t }) {
  const [flows, setFlows] = useState(null);
  const [liq, setLiq] = useState(null);
  const [exchanges, setExchanges] = useState(null);
  const [win, setWin] = useState('24h');
  useEffect(() => {
    let on = true;
    fetchFlows().then((d) => on && setFlows(d)).catch(() => on && setFlows({ windows: {} }));
    fetchLiquidity().then((d) => on && setLiq(d.events || [])).catch(() => on && setLiq([]));
    fetchExchanges().then((d) => on && setExchanges(d)).catch(() => {});
    return () => { on = false; };
  }, []);

  const f = flows?.windows?.[win];
  return (
    <>
      <div className="sm-section">
        <h3>
          🏦 {t('sm.exchangeFlow')}
          <span className="spacer" />
          <span className="sm-seg">
            {['24h', '7d', '30d'].map((w) => <button key={w} className={win === w ? 'active' : ''} onClick={() => setWin(w)}>{w}</button>)}
          </span>
        </h3>
        {!flows ? <Spinner /> : (
          <>
            <div className="sm-metrics">
              <div className="sm-metric"><div className="lab">{t('sm.cexInflow')}</div><div className="val sm-down" style={{ fontSize: 16 }}>{fmtUsd(f?.inflowUsd)}</div></div>
              <div className="sm-metric"><div className="lab">{t('sm.cexOutflow')}</div><div className="val sm-up" style={{ fontSize: 16 }}>{fmtUsd(f?.outflowUsd)}</div></div>
              <div className="sm-metric"><div className="lab">{t('sm.netFlow')}</div><div className={`val ${(f?.netUsd || 0) >= 0 ? 'sm-up' : 'sm-down'}`} style={{ fontSize: 16 }}>{fmtUsd(f?.netUsd)}</div></div>
            </div>
            {f && <FlowBar inflow={f.inflowUsd} outflow={f.outflowUsd} />}
            {f?.byExchange?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {f.byExchange.map((r) => (
                  <div key={r.exchange} className="sm-row" style={{ cursor: 'default' }}>
                    <div className="mid"><div className="name">{r.exchange}</div></div>
                    <div className="right"><div className={`usd ${r.netUsd >= 0 ? 'sm-up' : 'sm-down'}`}>{fmtUsd(r.netUsd)}</div></div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <div className="sm-disclaimer">{flows?.note}</div>
      </div>

      <div className="sm-section">
        <h3>⚠️ {t('sm.liquidityMovement')}</h3>
        {!liq ? <Spinner /> : !liq.length ? <Empty>{t('sm.noLiquidity')}</Empty> : liq.slice(0, 20).map((e) => (
          <div key={e.id} className="sm-row" onClick={() => e.explorerTx && window.open(e.explorerTx, '_blank')}>
            <div className="sym">{e.kind === 'LP_ADDED' ? '+' : '−'}</div>
            <div className="mid"><div className="name">{e.symbols}</div><div className="sub">{e.chainShort}{e.dex ? ` · ${e.dex}` : ''}</div></div>
            <div className="right">
              <div className={`usd ${e.kind === 'LP_ADDED' ? 'sm-up' : 'sm-down'}`}>{fmtUsd(e.liquidityUsd)}</div>
              <div className={`conf sm-risk-${e.impact === 'HIGH' ? 'HIGH' : e.impact === 'MEDIUM' ? 'MEDIUM' : 'LOW'}`}>{e.impact}</div>
            </div>
          </div>
        ))}
      </div>

      {exchanges && (
        <div className="sm-section">
          <h3>🏛️ {t('sm.cexRegistry')}</h3>
          <div className="sm-holdings">
            {exchanges.exchanges?.map((ex) => <span key={ex} className="sm-chip">{ex}</span>)}
          </div>
          <div className="sm-disclaimer">{exchanges.note}</div>
        </div>
      )}
    </>
  );
}

function AlertsTab({ navigate, t }) {
  const [alerts, setAlerts] = useState(null);
  useEffect(() => {
    let on = true;
    import('../lib/smartMoneyWatch').then(({ pullAlerts }) =>
      pullAlerts().then((d) => on && setAlerts(d.alerts || [])).catch(() => on && setAlerts([])));
    return () => { on = false; };
  }, []);

  return (
    <div className="sm-section">
      <h3><IconBell width={16} height={16} /> {t('sm.whaleAlerts')}</h3>
      {!alerts ? <Spinner /> : alerts.length === 0 ? (
        <Empty>{t('sm.noAlerts')}<br /><span className="faint">{t('sm.noAlertsBody')}</span></Empty>
      ) : alerts.map((a) => (
        /* An alert names a wallet (chain + address) — it now LINKS to that
           wallet's intelligence page instead of being a dead row. */
        <div
          key={a.id}
          className="sm-alert"
          style={a.chain && a.address ? { cursor: 'pointer' } : undefined}
          onClick={() => a.chain && a.address && navigate(`/smart-money/wallet/${a.chain}/${a.address}`)}
        >
          <div className="ico">🐋</div>
          <div className="body">
            <div className="t">{a.title}</div>
            <div className="m">{a.message}</div>
          </div>
          <div className="ago">{timeAgo(a.at)}</div>
        </div>
      ))}
      <div className="sm-disclaimer">{t('sm.alertHow')}</div>
    </div>
  );
}
