import { useEffect, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import ScrollRail from '../components/ScrollRail';
import SegIndicator from '../components/SegIndicator';
import { IconChevronLeft, IconSearch, IconBell } from '../components/Icons';
import {
  fetchOverview, fetchWhales, fetchFlows, fetchLiquidity,
  fetchEarlyTokens, fetchFreshWallets, fetchExchanges,
  fmtUsd, fmtPct, shortAddr, timeAgo, classifyQuery, CHAIN_OPTIONS,
  chainIdForSlug
} from '../lib/smartMoneyClient';
import { trackWallet } from '../lib/smartMoneyWatch';
import { openUrl } from '../lib/browser';
import { useTelegram } from '../context/TelegramContext';
import SmartMoneyWallet from './SmartMoneyWallet';

/* import styles via side-effect */
import '../styles/smart-money.css';

const TABS = ['overview', 'whales', 'wallets', 'tokens', 'flows', 'alerts'];

/*
 * THE TIME-WINDOW RAIL — «تب روز، هفته و ماه کار نمیده».
 *
 * Three separate faults made this control look decorative:
 *
 *  1. The buttons printed the raw API keys (`24h`, `7d`, `30d`) instead of the
 *     translated label, so on a Persian screen they read as machine output, and
 *     nothing about them said "these are the tabs I just tapped".
 *  2. The choice was thrown away on every navigation and on every 45-second
 *     re-render path — it lived in component state only — so the rail snapped
 *     back to «24h» and the tap looked like it had never happened.
 *  3. The overview tiles are built from what OUR scanner has actually observed
 *     (see server/smartMoney/eventStore.js). Until the buffer reaches back a
 *     full week, «7d» and «30d» aggregate the same events, so the numbers did
 *     not move — with no explanation anywhere on screen.
 *
 * So the window is now: translated, mirrored into the URL (shareable, survives
 * refresh, and a deep link can open /smart-money?window=7d), remembered in
 * localStorage, announced through `aria-selected`, and — when the selected
 * window is wider than what has been observed — labelled with its real
 * coverage instead of pretending to be a month of data.
 */
const WINDOWS = ['24h', '7d', '30d'];
const WINDOW_STORE_KEY = 'fbt.sm.window.v1';

function readStoredWindow() {
  try {
    const v = localStorage.getItem(WINDOW_STORE_KEY);
    return WINDOWS.includes(v) ? v : null;
  } catch { return null; }
}

function writeStoredWindow(win) {
  try { localStorage.setItem(WINDOW_STORE_KEY, win); } catch { /* best effort */ }
}

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
  const [params, setParams] = useSearchParams();
  const { haptic } = useTelegram();
  const [tab, setTab] = useState('overview');
  /*
   * Named `winKey`, NEVER `window`. It used to be `const [window, setWindow]`,
   * which shadows the global inside this component: every `window.open(...)`
   * in its body became `'24h'.open(...)` — a TypeError — and the rows that
   * should open an explorer silently did nothing (documented at each call
   * site). Every external link on this page now goes through `openUrl`, and a
   * state variable no longer eats a browser global.
   */
  const [winKey, setWinKey] = useState(() => {
    const fromUrl = WINDOWS.includes(String(params.get('window') || '')) ? String(params.get('window')) : null;
    return fromUrl || readStoredWindow() || '24h';
  });
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

  useEffect(() => { load(winKey); const i = setInterval(() => load(winKey), 45_000); return () => { clearInterval(i); abortRef.current?.abort?.(); }; }, [winKey, load]);

  /*
   * The rail is the single source of truth, and the URL mirrors it. `replace`
   * so a tap on «۷ روز» never piles up history entries the back button has to
   * walk through.
   */
  const selectWindow = useCallback((win) => {
    if (!WINDOWS.includes(win)) return;
    haptic?.('light');
    setWinKey(win);
    writeStoredWindow(win);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('window', win);
      return next;
    }, { replace: true });
  }, [haptic, setParams]);

  /* A back/forward or a pasted deep link changes `?window=` without this
     component re-mounting — follow it, or the rail would lie about what is
     selected. */
  useEffect(() => {
    const fromUrl = String(params.get('window') || '');
    if (WINDOWS.includes(fromUrl) && fromUrl !== winKey) setWinKey(fromUrl);
  }, [params, winKey]);

  const onSearch = () => {
    haptic?.('light');
    const c = classifyQuery(query);
    if (c.kind === 'address') {
      const chain = c.chain === 'solana' ? 'solana' : 1;
      navigate(`/smart-money/wallet/${chain}/${c.address}`);
    } else if (c.kind === 'tx') {
      /*
       * openUrl — never a raw `window.open`, for two independent reasons that
       * both produced the same «nothing happened» report:
       *
       *   · this component used to keep its selected window in a state called
       *     `window`, which shadowed the global, so `window.open(...)` here was
       *     `'24h'.open(...)` — a TypeError, thrown inside the click handler;
       *   · inside the packaged APK a `window.open` to an external host is
       *     swallowed by the WebView, so even correct code did nothing.
       *
       * lib/browser.js resolves both: Telegram's opener, then Android Custom
       * Tabs, then a real tab, then the same-tab fallback.
       */
      openUrl(c.chain === 'solana'
        ? `https://solscan.io/tx/${c.address}`
        : `https://etherscan.io/tx/${c.address}`);
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
  /* stale = the scan is slow/failed but earlier observations exist: keep the
     numbers, add a soft notice (not the red offline banner). */
  const streamStale = !streamDown && data?.streamStatus === 'stale';
  const cov = data?.coverage;
  const observedHours = cov?.observedSince ? Math.max(1, Math.round((Date.now() - cov.observedSince) / 3600_000)) : null;
  const usdOrDash = (n, events) => (events === 0 || n == null ? '—' : fmtUsd(n));

  return (
    <PageTransition>
      <div className="sm-page">
        {/* Hero */}
        <motion.section className="sm-hero" variants={riseIn} initial="hidden" animate="show">
          <div className="row-between">
            <h1>✦ {t('sm.title')}</h1>
            <span className={`sm-live ${data?.dataStatus === 'live' ? '' : 'is-off'}`}>
              <span className="dot" />
              {t(data?.dataStatus === 'live' ? 'sm.live' : data?.dataStatus === 'unavailable' ? 'sm.offlineShort' : 'sm.checking')}
            </span>
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
            {/*
              «تب روز، هفته و ماه» — translated, keyboard- and screen-reader-
              reachable, and it carries the coverage of the window it selects.
            */}
            <div className="sm-seg-window" role="tablist" aria-label={t('sm.windowAria')} data-testid="sm-window-tabs">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  role="tab"
                  aria-selected={winKey === w}
                  className={`sm-seg-window-item ${winKey === w ? 'active' : ''}`}
                  data-testid={`sm-window-${w}`}
                  onClick={() => selectWindow(w)}
                >
                  {winKey === w && <SegIndicator id="sm-window" />}
                  {t(`sm.windows.${w}`)}
                </button>
              ))}
            </div>
            {data?.coverage?.windowCoverage != null && data.coverage.windowCoverage < 0.95 && (
              <div className="sm-coverage" data-testid="sm-window-coverage">
                {t('sm.windowPartial', { window: t(`sm.windows.${winKey}`), pct: Math.round((data.coverage.windowCoverage || 0) * 100) })}
              </div>
            )}

            {loading && !data && <Spinner />}
            {error && !data && <Empty>{t('sm.errorOverview')}<br /><span className="faint">{error}</span></Empty>}

            {/* Honest offline banner — see the `streamDown` flag above. */}
            {data && streamDown && (
              <div className="sm-section sm-offline">
                <span className="msg">⚠️ {t('sm.dataSourceOffline')}</span>
                <button className="sm-btn ghost" style={{ width: 'auto', padding: '4px 10px' }} onClick={() => load(winKey)}>{t('sm.retry')}</button>
              </div>
            )}
            {data && streamStale && (
              <div className="sm-section sm-stale" data-testid="sm-stale-notice">
                <span className="msg">⏳ {t('sm.streamStale')}</span>
              </div>
            )}

            {data && (
              <>
                {/*
                  Every tile states what it is based on. A window with no
                  labelled event shows «—», never «$0»: zero labelled flow
                  is the absence of an observation, not an observed zero.
                */}
                <div className="sm-metrics">
                  <div className="sm-metric">
                    <div className="lab">{t('sm.whaleActivity')}</div>
                    <div className="val">{streamDown ? '—' : m?.whaleActivity?.value ?? '—'}</div>
                    <div className={`chg ${(m?.whaleActivity?.changePct || 0) >= 0 ? 'sm-up' : 'sm-down'}`}>{streamDown || m?.whaleActivity?.changePct == null ? '' : fmtPct(m.whaleActivity.changePct)}</div>
                  </div>
                  <div className="sm-metric">
                    <div className="lab">{t('sm.accumulation')}</div>
                    <div className="val sm-up">{streamDown ? '—' : usdOrDash(m?.accumulation?.valueUsd, m?.accumulation?.events)}</div>
                    <div className="chg sm-up">{streamDown || m?.accumulation?.changePct == null ? (m?.accumulation?.events ? t('sm.labelledEvents', { n: m.accumulation.events }) : '') : fmtPct(m.accumulation.changePct)}</div>
                  </div>
                  <div className="sm-metric">
                    <div className="lab">{t('sm.distribution')}</div>
                    <div className="val sm-down">{streamDown ? '—' : usdOrDash(m?.distribution?.valueUsd, m?.distribution?.events)}</div>
                    <div className="chg sm-down">{streamDown || m?.distribution?.changePct == null ? (m?.distribution?.events ? t('sm.labelledEvents', { n: m.distribution.events }) : '') : fmtPct(m.distribution.changePct)}</div>
                  </div>
                </div>

                <div className="sm-metrics">
                  <div className="sm-metric">
                    <div className="lab">{t('sm.exchangeInflow')}</div>
                    <div className="val" style={{ fontSize: 16 }}>{streamDown || !m?.flowEvents ? '—' : m?.exchangeInflow?.text ? `$${m.exchangeInflow.text}` : '—'}</div>
                  </div>
                  <div className="sm-metric">
                    <div className="lab">{t('sm.exchangeOutflow')}</div>
                    <div className="val" style={{ fontSize: 16 }}>{streamDown || !m?.flowEvents ? '—' : m?.exchangeOutflow?.text ? `$${m.exchangeOutflow.text}` : '—'}</div>
                  </div>
                  <div className="sm-metric">
                    <div className="lab">{t('sm.netFlow')}</div>
                    <div className={`val ${(m?.netFlow?.value || 0) >= 0 ? 'sm-up' : 'sm-down'}`} style={{ fontSize: 16 }}>
                      {streamDown || !m?.flowEvents ? '—' : m?.netFlow?.text ? `${(m.netFlow.value || 0) < 0 ? '-' : ''}$${m.netFlow.text.replace('-', '')}` : '—'}
                    </div>
                  </div>
                </div>

                {!streamDown && cov && (
                  <div className="sm-coverage" data-testid="sm-coverage">
                    {cov.observedEvents > 0 && observedHours
                      ? t('sm.observedNote', { n: cov.observedEvents, hours: observedHours })
                      : t('sm.observedNoteNew')}
                    {!m?.flowEvents && cov.inWindow > 0 ? ` ${t('sm.noLabelledFlow')}` : ''}
                  </div>
                )}

                {/* Token activity */}
                <div className="sm-section">
                  <h3>🐋 {t('sm.smartMoneyActivity')}</h3>
                  {data.tokenActivity?.length === 0 && <Empty>{t('sm.noActivity')}</Empty>}
                  {data.tokenActivity?.map((r) => (
                    <div key={`${r.chainId}:${r.address || r.symbol}`} className="sm-row" onClick={() => r.address && navigate(`/smart-money/token/${r.chainId}/${r.address}`)}>
                      <div className="sym">{r.symbol.slice(0, 4)}</div>
                      <div className="mid">
                        <div className="name">{r.symbol} <span className="faint" style={{ fontSize: 10 }}>· {r.chainShort}</span></div>
                        <div className="sub">
                          {t('sm.walletsCount', { n: r.wallets ?? r.events })}
                          {r.labelledEvents ? ` · ${t('sm.labelledEvents', { n: r.labelledEvents })}` : ''}
                        </div>
                      </div>
                      <div className="right">
                        {/* Labelled flow → signed net; unlabelled → total moved, no sign. */}
                        <div className={`usd ${r.signal === 'NEUTRAL' ? '' : r.netUsd >= 0 ? 'sm-up' : 'sm-down'}`}>
                          {r.signal === 'NEUTRAL' ? fmtUsd(r.totalUsd ?? Math.abs(r.netUsd)) : fmtUsd(r.netUsd)}
                        </div>
                        {r.signal === 'NEUTRAL'
                          ? <span className="faint" style={{ fontSize: 10, fontWeight: 800 }}>{t('sm.signal.NEUTRAL')}</span>
                          : <ConfBar value={r.signal === 'ACCUMULATION' ? r.accumulation : r.distribution} signal={r.signal} />}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Money flow quick view — hidden while offline: a 0/0 bar
                    reads as "no flow", which is exactly what we are NOT sure of. */}
                {!streamDown && <FlowSummary flows={data.flows} window={winKey} onMore={() => setTab('flows')} t={t} />}

                {/* Early detection */}
                <div className="sm-section">
                  <h3>⚡ {t('sm.earlyDetection')}</h3>
                  <EarlyGrid tokens={data.earlyTokens?.tokens || []} loading={!data.earlyTokens} navigate={navigate} t={t} />
                  <div className="sm-disclaimer">{data.earlyTokens?.note}</div>
                </div>

                {/* Fresh wallets */}
                {data.freshWallets && (data.freshWallets.dataStatus === 'live' || data.freshWallets.dataStatus === 'quiet') && (
                  <div className="sm-section">
                    <h3>🆕 {t('sm.freshWallets')}</h3>
                    {data.freshWallets.dataStatus === 'quiet' ? (
                      <Empty>{t('sm.quietFresh')}</Empty>
                    ) : (
                      <>
                        <div className="sm-metrics">
                          <div className="sm-metric"><div className="lab">{t('sm.newWallets')}</div><div className="val">{data.freshWallets.newWallets}</div></div>
                          <div className="sm-metric"><div className="lab">{t('sm.interesting')}</div><div className="val">{data.freshWallets.interestingWallets}</div></div>
                          <div className="sm-metric"><div className="lab">{t('sm.capital')}</div><div className="val" style={{ fontSize: 16 }}>{fmtUsd(data.freshWallets.capitalUsd)}</div></div>
                        </div>
                        {data.freshWallets.wallets?.slice(0, 5).map((w) => (
                          <div key={`${w.chainId}:${w.address}`} className="sm-row" onClick={() => navigate(`/smart-money/wallet/${w.chainId}/${w.address}`)}>
                            <div className="sym">{w.chainShort}</div>
                            <div className="mid"><div className="name mono">{w.short}</div><div className="sub">{w.txCount} tx</div></div>
                            <div className="right"><div className="usd">{fmtUsd(w.capitalUsd)}</div>{w.interesting && <div className="conf sm-risk-MEDIUM">★</div>}</div>
                          </div>
                        ))}
                      </>
                    )}
                    <div className="sm-disclaimer">{data.freshWallets.note}</div>
                  </div>
                )}

                {/* Liquidity */}
                {data.liquidityEvents?.events?.length > 0 && (
                  <div className="sm-section">
                    <h3>⚠️ {t('sm.liquidityMovement')}</h3>
                    {/* openUrl for the same two reasons as the tx search above:
                        the old `window` state shadowed the global here, and a
                        raw `window.open` is a no-op inside the APK — so tapping
                        a liquidity row silently did nothing. */}
                    {data.liquidityEvents.events.slice(0, 6).map((e) => (
                      <div key={e.id} className="sm-row" onClick={() => e.explorerTx && openUrl(e.explorerTx)}>
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
        {tab === 'flows' && <FlowsTab t={t} win={winKey} onWindow={selectWindow} />}

        {/* ALERTS */}
        {tab === 'alerts' && <AlertsTab navigate={navigate} t={t} />}
      </div>
    </PageTransition>
  );
}

function FlowSummary({ flows, window: win = '24h', onMore, t }) {
  const f = flows?.windows?.[win] || flows?.windows?.['24h'];
  if (!f) return null;
  const hasFlow = (f.events || 0) > 0;
  return (
    <div className="sm-section">
      <h3>💰 {t('sm.moneyFlow')}<span className="spacer" />
        <button className="sm-btn ghost" style={{ width: 'auto', padding: '4px 10px' }} onClick={onMore}>{t('sm.viewAll')}</button>
      </h3>
      {hasFlow ? (
        <>
          <FlowBar inflow={f.inflowUsd} outflow={f.outflowUsd} />
          <div className="row-between" style={{ marginTop: 10, fontSize: 12 }}>
            <span className="sm-down">↓ {t('sm.cexInflow')}: {fmtUsd(f.inflowUsd)}</span>
            <span className="sm-up">↑ {t('sm.cexOutflow')}: {fmtUsd(f.outflowUsd)}</span>
          </div>
        </>
      ) : (
        /* A 0/0 bar reads as «no flow», which is exactly what we do NOT know. */
        <div className="sm-empty" style={{ padding: '6px 0' }}>{t('sm.noLabelledFlow')}</div>
      )}
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
          else openUrl(`https://dexscreener.com/${tk.chain}/${tk.address}`);
        };
        return (
          <div key={`${tk.chain}:${tk.address}`} className="sm-early-card">
            <div className="tk">{tk.symbol} <span className="faint" style={{ fontSize: 10 }}>· {tk.chain}{tk.dex ? ` · ${tk.dex}` : ''}</span></div>
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
  const [note, setNote] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let on = true;
    fetchWhales(smart ? 1_000_000 : 250_000)
      .then((d) => { if (!on) return; setRows(d.wallets || []); setNote(d.note || null); })
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
            {w.netUsd != null && w.netUsd !== 0 && (
              <div className={`sub ${w.netUsd > 0 ? 'sm-up' : 'sm-down'}`} style={{ fontSize: 10, fontWeight: 800 }}>
                {w.netUsd > 0 ? '+' : '−'}{fmtUsd(Math.abs(w.netUsd))} {t(w.netUsd > 0 ? 'sm.netIn' : 'sm.netOut')}
              </div>
            )}
            <div className={`conf sm-risk-${['LOW', 'MEDIUM', 'HIGH'].includes(w.riskBand) ? w.riskBand : 'MEDIUM'}`}>
              {w.behaviour && w.behaviour !== 'TRANSFER' ? `${t(`sm.behaviour.${w.behaviour}`)} · ` : ''}{t(`sm.riskBand.${w.riskBand}`)}
            </div>
          </div>
        </div>
      ))}
      <div className="sm-disclaimer">{note || t('sm.whaleDisclaimer')}</div>
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

/*
 * The flow tab shows the SAME window the overview rail is showing. It used to
 * own a private `win` state that always started at '24h', so switching to «۷
 * روز» on the overview and then opening «جریان نقدینگی» reset the choice with
 * no visible cause — the second half of «تب هفته و ماه کار نمیده».
 */
function FlowsTab({ t, win = '24h', onWindow }) {
  const [flows, setFlows] = useState(null);
  const [liq, setLiq] = useState(null);
  const [exchanges, setExchanges] = useState(null);
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
          <span className="sm-seg-window" role="tablist" aria-label={t('sm.windowAria')}>
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                role="tab"
                aria-selected={win === w}
                className={`sm-seg-window-item ${win === w ? 'active' : ''}`}
                data-testid={`sm-flows-window-${w}`}
                onClick={() => (onWindow ? onWindow(w) : null)}
              >
                {win === w && <SegIndicator id="sm-window" />}
                {t(`sm.windows.${w}`)}
              </button>
            ))}
          </span>
        </h3>
        {!flows ? <Spinner /> : (
          <>
            {(() => {
              const hasFlow = (f?.events || 0) > 0;
              const dash = (n) => (hasFlow ? fmtUsd(n) : '—');
              return (
                <>
                  <div className="sm-metrics">
                    <div className="sm-metric"><div className="lab">{t('sm.cexInflow')}</div><div className="val sm-down" style={{ fontSize: 16 }}>{dash(f?.inflowUsd)}</div></div>
                    <div className="sm-metric"><div className="lab">{t('sm.cexOutflow')}</div><div className="val sm-up" style={{ fontSize: 16 }}>{dash(f?.outflowUsd)}</div></div>
                    <div className="sm-metric"><div className="lab">{t('sm.netFlow')}</div><div className={`val ${(f?.netUsd || 0) >= 0 ? 'sm-up' : 'sm-down'}`} style={{ fontSize: 16 }}>{dash(f?.netUsd)}</div></div>
                  </div>
                  {hasFlow ? <FlowBar inflow={f.inflowUsd} outflow={f.outflowUsd} /> : (
                    <div className="sm-empty" style={{ padding: '6px 0' }}>
                      {flows.dataStatus === 'unavailable' ? t('sm.dataSourceOffline') : t('sm.noLabelledFlow')}
                    </div>
                  )}
                  {f && typeof f.coverage === 'number' && f.coverage < 0.95 && (
                    <div className="sm-coverage">{t('sm.windowCoverage', { pct: Math.round(f.coverage * 100) })}</div>
                  )}
                </>
              );
            })()}
            {f?.byExchange?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {f.byExchange.map((r) => (
                  <div key={r.exchange} className="sm-row" style={{ cursor: 'default' }}>
                    <div className="mid">
                      <div className="name">{r.exchange}</div>
                      <div className="sub">↓ {fmtUsd(r.inflowUsd)} · ↑ {fmtUsd(r.outflowUsd)}</div>
                    </div>
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
          <div key={e.id} className="sm-row" onClick={() => e.explorerTx && openUrl(e.explorerTx)}>
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
          {flows?.observedExchanges?.length > 0 && (
            <div className="sm-coverage">{t('sm.observedExchanges')}: {flows.observedExchanges.join(' · ')}</div>
          )}
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
