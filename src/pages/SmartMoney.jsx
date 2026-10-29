import { useEffect, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import SegIndicator from '../components/SegIndicator';
import {
  IconChevronLeft, IconSearch, IconRefresh, IconX, IconArrowUpRight, IconClock
} from '../components/Icons';
import {
  SmSignalGlyph, SmOverviewGlyph, SmVerifiedGlyph, SmWhaleGlyph, SmWalletGlyph,
  SmCoinGlyph, SmFlowGlyph, SmBellGlyph, SmWavesGlyph, SmAccumulateGlyph,
  SmDistributeGlyph, SmBankGlyph, SmDropletGlyph, SmFreshGlyph, SmSparkGlyph,
  SmPulseGlyph, SmRiskGlyph
} from '../components/smart-money/SmGlyphs';
import {
  fetchOverview, fetchWhales, fetchFlows, fetchLiquidity,
  fetchEarlyTokens, fetchFreshWallets, fetchExchanges,
  fmtUsd, fmtPct, timeAgo, classifyQuery, chainIdForSlug
} from '../lib/smartMoneyClient';
import { openUrl } from '../lib/browser';
import { useTelegram } from '../context/TelegramContext';
import SmartMoneyIntelligence, { IntelligenceTeaser, VerifiedWallets } from '../components/SmartMoneyIntelligence';
import CopyTradeButton from '../components/smart-money/CopyTradeButton';
import TokenIcon from '../lib/tokenIcon';

/* import styles via side-effect */
import '../styles/smart-money.css';
import '../styles/smart-money-intelligence.css';

const TABS = ['overview', 'intelligence', 'whales', 'wallets', 'tokens', 'flows', 'alerts'];

/* One glyph per tab, so the dock is readable before it is read. */
const TAB_GLYPHS = {
  overview: SmOverviewGlyph,
  intelligence: SmVerifiedGlyph,
  whales: SmWhaleGlyph,
  wallets: SmWalletGlyph,
  tokens: SmCoinGlyph,
  flows: SmFlowGlyph,
  alerts: SmBellGlyph
};

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

/* ═══════════════════════════════════════════════════════════════════════════
   THE NEW SURFACE LANGUAGE
   ───────────────────────────────────────────────────────────────────────────
   A "signal desk": deep navy glass, one hairline, a single mint→cyan accent,
   tabular numbers and glyph tiles. Everything below is presentational and
   takes its content from the same fetches as before — this rebuild changes
   how the page reads, never what it claims.
   ═══════════════════════════════════════════════════════════════════════════ */

function SectionHead({ icon, title, meta, children }) {
  return (
    <div className="smx-head">
      {icon ? <span className="smx-head-ico" aria-hidden="true">{icon}</span> : null}
      <h3>{title}</h3>
      <span className="smx-head-spacer" />
      {meta ? <span className="smx-head-meta">{meta}</span> : null}
      {children}
    </div>
  );
}

/*
 * The two window rails are deliberately separate components rather than one
 * parameterised rail. They are mounted on different screens (the overview
 * toolbar and the flows tab), they carry different test ids, and a Framer
 * `layoutId` may only exist once among mounted elements — sharing one rail
 * made that uniqueness a thing a future caller had to remember.
 *
 * `winKey` — never `window` — is the state name; see the note on load().
 */
function WindowRail({ t, winKey, onChange }) {
  return (
    <div className="sm-seg-window smx-windowrail" role="tablist" aria-label={t('sm.windowAria')} data-testid="sm-window-tabs">
      {WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          role="tab"
          aria-selected={winKey === w}
          className={`sm-seg-window-item ${winKey === w ? 'active' : ''}`}
          data-testid={`sm-window-${w}`}
          onClick={() => onChange(w)}
        >
          {winKey === w && <SegIndicator id="sm-window-pill" />}
          {t(`sm.windows.${w}`)}
        </button>
      ))}
    </div>
  );
}

function FlowsWindowRail({ t, win, onWindow }) {
  return (
    <div className="sm-seg-window smx-windowrail" role="tablist" aria-label={t('sm.windowAria')} data-testid="sm-flows-window-tabs">
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
          {win === w && <SegIndicator id="sm-flows-window-pill" />}
          {t(`sm.windows.${w}`)}
        </button>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <div className="smx-skeleton" aria-hidden="true">
      <span className="smx-skel smx-skel--lg" />
      <span className="smx-skel" style={{ width: '88%' }} />
      <span className="smx-skel" style={{ width: '72%' }} />
      <span className="smx-skel" style={{ width: '80%' }} />
    </div>
  );
}

function EmptyArt({ icon, title, body }) {
  return (
    <div className="smx-empty">
      <span className="smx-empty-ico" aria-hidden="true">{icon || <SmSparkGlyph width={22} height={22} />}</span>
      {title ? <strong>{title}</strong> : null}
      {body ? <span className="smx-empty-body">{body}</span> : null}
    </div>
  );
}

function DeltaPill({ value, up }) {
  if (value == null) return null;
  return (
    <span className={`smx-delta ${up ? 'is-up' : 'is-down'}`}>
      <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true">
        <path d={up ? 'M5 1.4 9 8.3H1Z' : 'M5 8.6 1 1.7h8Z'} fill="currentColor" />
      </svg>
      {fmtPct(value)}
    </span>
  );
}

function SignalPill({ signal, t }) {
  const neutral = signal === 'NEUTRAL' || !signal;
  const up = signal === 'ACCUMULATION';
  return (
    <span className={`smx-pill ${neutral ? 'is-neutral' : up ? 'is-up' : 'is-down'}`}>
      {neutral ? null : up
        ? <SmAccumulateGlyph width={11} height={11} />
        : <SmDistributeGlyph width={11} height={11} />}
      {t(`sm.signal.${neutral ? 'NEUTRAL' : signal}`)}
    </span>
  );
}

function RiskPill({ band, t }) {
  const safe = ['LOW', 'MEDIUM', 'HIGH'].includes(band) ? band : 'MEDIUM';
  return (
    <span className={`smx-pill smx-risk is-${safe.toLowerCase()}`}>
      <SmRiskGlyph width={11} height={11} />
      {t(`sm.riskBand.${safe}`)}
    </span>
  );
}

function ChainPill({ color, children }) {
  return (
    <span
      className="smx-chain"
      style={color ? {
        color,
        borderColor: `${color}55`,
        background: `${color}1f`
      } : undefined}
    >
      {children}
    </span>
  );
}

function MetricCard({ tone, icon, label, value, valueTone, foot }) {
  return (
    <article className={`smx-metric is-${tone || 'cyan'}`}>
      <header className="smx-metric-top">
        <span className="smx-metric-ico" aria-hidden="true">{icon}</span>
        <span className="smx-metric-lab">{label}</span>
      </header>
      <div className={`smx-metric-val ${valueTone || ''}`}>{value}</div>
      <div className="smx-metric-foot">{foot}</div>
    </article>
  );
}

function FlowBar({ inflow, outflow }) {
  const total = Math.max(1, (inflow || 0) + (outflow || 0));
  const outPct = Math.round(((outflow || 0) / total) * 100);
  return (
    <div
      className="smx-flowbar"
      role="img"
      aria-label={`${Math.round(100 - outPct)}% / ${outPct}%`}
    >
      <i className="is-in" style={{ width: `${100 - outPct}%` }} />
      <i className="is-out" style={{ width: `${outPct}%` }} />
    </div>
  );
}

function FreshCard({ wallet, navigate, t }) {
  return (
    <button
      type="button"
      className="smx-fresh"
      onClick={() => navigate(`/smart-money/wallet/${wallet.chainId}/${wallet.address}`)}
    >
      <span className="smx-fresh-top">
        <ChainPill color={wallet.chainColor}>{wallet.chainShort}</ChainPill>
        <span className="smx-fresh-tag">FRESH &lt;48h</span>
        {wallet.interesting && (
          <span className="smx-fresh-star"><SmSparkGlyph width={11} height={11} /> Smart</span>
        )}
      </span>
      <span className="smx-fresh-addr mono">{wallet.short}</span>
      <span className="smx-fresh-meta">
        <span>
          <small>{t('sm.capital')}</small>
          <b className="sm-up">{fmtUsd(wallet.capitalUsd)}</b>
        </span>
        <span>
          <small>TX</small>
          <b>{wallet.txCount}</b>
        </span>
        <span className="smx-fresh-go" aria-hidden="true"><IconArrowUpRight width={13} height={13} /></span>
      </span>
    </button>
  );
}

function WhaleCard({ wallet, index, navigate, t }) {
  const net = wallet.netUsd;
  const moved = Math.abs(wallet.movedUsd || 0);
  const netShare = net != null && moved > 0 ? Math.min(100, Math.round((Math.abs(net) / moved) * 100)) : null;
  return (
    <button
      type="button"
      className="smx-whale"
      onClick={() => navigate(`/smart-money/wallet/${wallet.chainId}/${wallet.address}`)}
    >
      <span className="smx-whale-rank mono">{String(index + 1).padStart(2, '0')}</span>
      <span className="smx-whale-body">
        <span className="smx-whale-top">
          <span className="smx-whale-addr mono">{wallet.short}</span>
          <ChainPill color={wallet.chainColor}>{wallet.chainShort}</ChainPill>
          <RiskPill band={wallet.riskBand} t={t} />
        </span>
        <span className="smx-whale-action">{wallet.lastAction}</span>
        <span className="smx-whale-foot">
          <span>
            <small>{t('sm.volume', { defaultValue: 'حجم جابه‌جایی' })}</small>
            <b>{fmtUsd(wallet.movedUsd)}</b>
          </span>
          {net != null && net !== 0 && (
            <span className={net > 0 ? 'is-up' : 'is-down'}>
              <small>{t(net > 0 ? 'sm.netIn' : 'sm.netOut')}</small>
              <b>{net > 0 ? '+' : '−'}{fmtUsd(Math.abs(net))}</b>
            </span>
          )}
        </span>
        {netShare != null && (
          <span className={`smx-whale-meter ${net > 0 ? 'is-up' : 'is-down'}`} aria-hidden="true">
            <i style={{ width: `${netShare}%` }} />
          </span>
        )}
      </span>
    </button>
  );
}

function EarlyGrid({ tokens, navigate, t }) {
  if (!tokens?.length) {
    return <EmptyArt icon={<SmCoinGlyph width={22} height={22} />} title={t('sm.noEarly')} />;
  }
  return (
    <div className="smx-early-grid">
      {tokens.map((tk) => {
        const chainId = chainIdForSlug(tk.chain);
        const open = () => {
          if (chainId) navigate(`/smart-money/token/${chainId}/${tk.address}`);
          else openUrl(`https://dexscreener.com/${tk.chain}/${tk.address}`);
        };
        return (
          <article key={`${tk.chain}:${tk.address}`} className="smx-early">
            <header className="smx-early-top">
              <span className="smx-early-logo">
                <TokenIcon
                  token={{ symbol: tk.symbol, address: tk.address, tokenLogo: tk.logo || tk.icon }}
                  chainId={chainId || 1}
                  size={38}
                />
              </span>
              <span className="smx-early-id">
                <b>{tk.symbol}</b>
                <span>
                  <em>{tk.chain}</em>
                  {tk.dex ? <i>{tk.dex}</i> : null}
                </span>
              </span>
              <RiskPill band={tk.risk} t={t} />
            </header>

            <div className="smx-early-stats">
              <div>
                <span className="smx-early-stat-ico"><IconClock width={12} height={12} /></span>
                <b>{tk.ageHours}h</b>
                <small>{t('sm.age')}</small>
              </div>
              <div>
                <span className="smx-early-stat-ico"><SmDropletGlyph width={12} height={12} /></span>
                <b>{fmtUsd(tk.liquidityUsd)}</b>
                <small>{t('sm.liquidity')}</small>
              </div>
              <div>
                <span className="smx-early-stat-ico"><SmWavesGlyph width={12} height={12} /></span>
                <b>{fmtUsd(tk.volumeH24)}</b>
                <small>{t('sm.volume24')}</small>
              </div>
              <div>
                <span className="smx-early-stat-ico"><SmCoinGlyph width={12} height={12} /></span>
                <b>{tk.fdvUsd ? fmtUsd(tk.fdvUsd) : '—'}</b>
                <small>FDV / Cap</small>
              </div>
            </div>

            <button type="button" className="smx-cta" onClick={open}>
              {t('sm.analyze')}
              <IconArrowUpRight width={14} height={14} />
            </button>
          </article>
        );
      })}
    </div>
  );
}

/*
 * THE TOKEN-ACTIVITY ROW — one component, three surfaces.
 * The overview, the token tab and (by the same markup) the intelligence tab
 * all answer the same question, so they must not drift into three different
 * row designs. The row is a <div> that holds TWO real buttons:
 *
 *   · `.smx-row-hit`  — navigate to this token's intelligence page;
 *   · «کپی تراکنش»    — open the swap screen with this contract preselected.
 *
 * A nested button inside a button is invalid HTML and swallows one of the two
 * taps on Android, which is exactly what the old single-button row would have
 * done had the copy action been bolted onto it.
 */
function TokenActivityRows({ rows, navigate, t }) {
  if (!rows?.length) return null;
  return (
    <div className="smx-rows">
      {rows.map((r) => {
        const neutral = r.signal === 'NEUTRAL';
        const up = r.netUsd >= 0;
        const confidence = r.signal === 'ACCUMULATION' ? r.accumulation : r.distribution;
        return (
          <div key={`${r.chainId}:${r.address || r.symbol}`} className="smx-row smx-row--split">
            <button
              type="button"
              className="smx-row-hit"
              onClick={() => r.address && navigate(`/smart-money/token/${r.chainId}/${r.address}`)}
            >
              <span className="smx-row-ico">
                <TokenIcon
                  token={{ symbol: r.symbol, address: r.address }}
                  chainId={r.chainId}
                  size={34}
                />
              </span>
              <span className="smx-row-main">
                <span className="smx-row-title">
                  {r.symbol}
                  <em>{r.chainShort}</em>
                </span>
                <span className="smx-row-sub">
                  {t('sm.walletsCount', { n: r.wallets ?? r.events })}
                  {r.labelledEvents ? ` · ${t('sm.labelledEvents', { n: r.labelledEvents })}` : ''}
                </span>
              </span>
              <span className="smx-row-end">
                {/* Labelled flow → signed net; unlabelled → total moved, no sign. */}
                <b className={neutral ? '' : up ? 'sm-up' : 'sm-down'}>
                  {neutral ? fmtUsd(r.totalUsd ?? Math.abs(r.netUsd)) : fmtUsd(r.netUsd)}
                </b>
                {/* The signal is a WORD first and a bar second: colour alone is
                    unreadable in grayscale and invisible to a screen reader. */}
                <SignalPill signal={neutral ? 'NEUTRAL' : r.signal} t={t} />
                {!neutral && (
                  <span className={`smx-mini ${up ? 'is-up' : 'is-down'}`} aria-hidden="true">
                    <span className="smx-mini-track">
                      <i style={{ width: `${Math.min(100, Math.max(0, confidence || 0))}%` }} />
                    </span>
                    <em>{confidence != null ? `${confidence}%` : '—'}</em>
                  </span>
                )}
              </span>
            </button>
            <span className="smx-row-action">
              <CopyTradeButton
                chain={r.chainId}
                token={r.address}
                side={neutral ? 'BUY' : r.signal === 'DISTRIBUTION' ? 'SELL' : 'BUY'}
                className="sm-copy--tight"
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function SmartMoney() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { haptic } = useTelegram();
  const [tab, setTab] = useState(() => TABS.includes(params.get('tab')) ? params.get('tab') : 'overview');
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
  const selectTab = useCallback((id) => {
    if (!TABS.includes(id)) return;
    haptic?.('light');
    setTab(id);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', id);
      return next;
    }, { replace: true });
  }, [haptic, setParams]);

  useEffect(() => {
    const fromUrl = params.get('tab');
    if (TABS.includes(fromUrl)) setTab(fromUrl);
  }, [params]);

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
      selectTab('tokens');
      setQuery(c.query);
    } else {
      selectTab('tokens');
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

  const verified = data?.verified;
  const vCov = verified?.coverage;
  const consensusActive = (verified?.consensus || []).filter((r) => r.confidence != null).length;
  const liveLabel = t(data?.dataStatus === 'live' ? 'sm.live' : data?.dataStatus === 'unavailable' ? 'sm.offlineShort' : 'sm.checking');

  const metricFoot = (metric) => {
    if (streamDown) return null;
    if (metric?.changePct != null) return <DeltaPill value={metric.changePct} up={metric.changePct >= 0} />;
    if (metric?.events) return <span className="smx-note">{t('sm.labelledEvents', { n: metric.events })}</span>;
    return null;
  };

  return (
    <PageTransition>
      <div className="sm-page smx-deck">
        {/* ── HERO ───────────────────────────────────────────────────────── */}
        <motion.section className="smx-hero" variants={riseIn} initial="hidden" animate="show">
          {/*
            THE ATMOSPHERE LAYER — five decorative children, all compositor
            only. `mesh` drifts, `orb`s float, `radar` sweeps, `scan` slides and
            `hairline` is a static light seam. Nothing here reads layout (no
            `left`/`width` animation), nothing here is measured by JS, and the
            whole set stops under `prefers-reduced-motion` and inside the APK
            (see the motion block in smart-money.css) — so "more motion" can
            never turn into "slower page".
          */}
          <span className="smx-hero-mesh" aria-hidden="true" />
          <span className="smx-hero-orb smx-hero-orb--a" aria-hidden="true" />
          <span className="smx-hero-orb smx-hero-orb--b" aria-hidden="true" />
          <span className="smx-hero-radar" aria-hidden="true"><i /><i /><i /><b /></span>
          <span className="smx-hero-scan" aria-hidden="true" />
          <span className="smx-hero-hairline" aria-hidden="true" />

          <header className="smx-hero-top">
            <span className="smx-kicker">
              <SmSignalGlyph width={13} height={13} />
              <b>FBT</b>
              <span>SMART MONEY</span>
            </span>
            <span className={`smx-live ${data?.dataStatus === 'live' ? 'is-live' : 'is-off'}`}>
              <i aria-hidden="true" />
              {liveLabel}
            </span>
          </header>

          <h1 className="smx-hero-title">{t('sm.title')}</h1>
          <p className="smx-hero-sub" dangerouslySetInnerHTML={{ __html: t('sm.tagline') }} />

          <form
            className="smx-search"
            onSubmit={(e) => { e.preventDefault(); onSearch(); }}
            role="search"
          >
            <span className="smx-search-ico" aria-hidden="true"><IconSearch width={17} height={17} /></span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('sm.searchPlaceholder')}
              aria-label={t('sm.searchPlaceholder')}
              spellCheck="false"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                className="smx-search-clear"
                onClick={() => setQuery('')}
                aria-label={t('common.clear')}
              >
                <IconX width={13} height={13} />
              </button>
            ) : null}
            <button type="submit" className="smx-search-go" aria-label={t('sm.search')}>
              <IconArrowUpRight width={17} height={17} />
            </button>
          </form>

          <div className="smx-pods">
            <div className="smx-pod">
              <span className="smx-pod-ico is-cyan" aria-hidden="true"><SmWavesGlyph width={15} height={15} /></span>
              <b className="mono">{vCov?.analyzedWallets ?? '—'}</b>
              <small>{t('sm.engine.analysed')}</small>
            </div>
            <div className="smx-pod">
              <span className="smx-pod-ico is-mint" aria-hidden="true"><SmVerifiedGlyph width={15} height={15} /></span>
              <b className="mono">{vCov?.classifiedWallets ?? '—'}</b>
              <small>{t('sm.engine.qualified')}</small>
            </div>
            <div className="smx-pod">
              <span className="smx-pod-ico is-violet" aria-hidden="true"><SmSignalGlyph width={15} height={15} /></span>
              <b className="mono">{vCov ? consensusActive : '—'}</b>
              <small>{t('sm.engine.consensus')}</small>
            </div>
          </div>
        </motion.section>

        {/*
          THE NAVIGATION DOCK — seven tabs, ONE line.
          Reported: «تب‌ها به صورت افقی و در یک خط باشد». The previous 4+3 grid
          wrapped the last three tabs onto a second row, which on a phone read
          as two different groups of destinations and pushed the content down.
          Now it is a single seven-column rail: every tab visible at once, one
          glyph above one label, and a shared mint pill (`layoutId`) that slides
          between them instead of a hard colour snap.

          Labels are ellipsised by CSS, never truncated in the DOM: the full
          translated string stays the button's text (screen readers and the
          desk probe read it), while a 360px screen shows as much of it as fits.
        */}
        <nav className="smx-dock" role="tablist" aria-label={t('sm.title')}>
          {TABS.map((id) => {
            const Glyph = TAB_GLYPHS[id];
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`smx-dock-btn ${active ? 'is-active' : ''}`}
                onClick={() => selectTab(id)}
                data-testid={`sm-tab-${id}`}
              >
                {active && (
                  <motion.span
                    className="smx-dock-pill"
                    layoutId="sm-dock-pill"
                    transition={{ type: 'spring', stiffness: 460, damping: 36, mass: 0.55 }}
                    aria-hidden="true"
                  />
                )}
                <span className="smx-dock-ico" aria-hidden="true"><Glyph width={17} height={17} /></span>
                <span className="smx-dock-label">{t(`sm.tabs.${id}`)}</span>
              </button>
            );
          })}
        </nav>

        {/* THE PANEL — a 220ms/6px entrance on tab change. `key={tab}` makes
            Framer remount on each switch, which is what makes the transition
            run; it animates opacity + transform only, so the list below is
            laid out once and never re-measured mid-animation. */}
        <motion.div
          className="smx-panel"
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
        {/* OVERVIEW */}
        {tab === 'overview' && (
          <>
            {/* The window control + a manual refresh: the page already polls
                every 45s, but a reader who just came back to the tab wants a
                way to ask *now*. */}
            <div className="smx-toolbar">
              <span className="smx-toolbar-ico" aria-hidden="true"><IconClock width={14} height={14} /></span>
              <span className="smx-toolbar-label">{t('sm.windowAria')}</span>
              <span className="smx-toolbar-spacer" />
              <WindowRail t={t} winKey={winKey} onChange={selectWindow} />
              <button
                type="button"
                className={`smx-refresh ${loading ? 'is-busy' : ''}`}
                onClick={() => load(winKey)}
                aria-label={t('common.refresh')}
              >
                <IconRefresh width={15} height={15} />
              </button>
            </div>

            {data?.coverage?.windowCoverage != null && data.coverage.windowCoverage < 0.95 && (
              <div className="smx-hint" data-testid="sm-window-coverage">
                <SmSignalGlyph width={14} height={14} />
                {t('sm.windowPartial', { window: t(`sm.windows.${winKey}`), pct: Math.round((data.coverage.windowCoverage || 0) * 100) })}
              </div>
            )}

            {loading && !data && <Spinner />}
            {error && !data && (
              <EmptyArt
                icon={<SmRiskGlyph width={22} height={22} />}
                title={t('sm.errorOverview')}
                body={error}
              />
            )}

            {/* Honest offline banner — see the `streamDown` flag above. */}
            {data && streamDown && (
              <div className="smx-banner is-warn sm-offline" role="status">
                <span className="smx-banner-ico"><SmRiskGlyph width={16} height={16} /></span>
                <span className="smx-banner-text">{t('sm.dataSourceOffline')}</span>
                <button type="button" className="smx-banner-btn" onClick={() => load(winKey)}>
                  {t('sm.retry')}
                </button>
              </div>
            )}
            {data && streamStale && (
              <div className="smx-banner is-info sm-stale" role="status" data-testid="sm-stale-notice">
                <span className="smx-banner-ico"><SmPulseGlyph width={16} height={16} /></span>
                <span className="smx-banner-text">{t('sm.streamStale')}</span>
              </div>
            )}

            {data && (
              <>
                <IntelligenceTeaser verified={data.verified} onOpen={() => selectTab('intelligence')} />

                {/*
                  Every tile states what it is based on. A window with no
                  labelled event shows «—», never «$0»: zero labelled flow
                  is the absence of an observation, not an observed zero.
                */}
                <div className="smx-metrics">
                  <MetricCard
                    tone="cyan"
                    icon={<SmWavesGlyph width={15} height={15} />}
                    label={t('sm.whaleActivity')}
                    value={streamDown ? '—' : m?.whaleActivity?.value ?? '—'}
                    foot={metricFoot(m?.whaleActivity)}
                  />
                  <MetricCard
                    tone="mint"
                    icon={<SmAccumulateGlyph width={15} height={15} />}
                    label={t('sm.accumulation')}
                    value={streamDown ? '—' : usdOrDash(m?.accumulation?.valueUsd, m?.accumulation?.events)}
                    valueTone={streamDown ? '' : 'sm-up'}
                    foot={metricFoot(m?.accumulation)}
                  />
                  <MetricCard
                    tone="rose"
                    icon={<SmDistributeGlyph width={15} height={15} />}
                    label={t('sm.distribution')}
                    value={streamDown ? '—' : usdOrDash(m?.distribution?.valueUsd, m?.distribution?.events)}
                    valueTone={streamDown ? '' : 'sm-down'}
                    foot={metricFoot(m?.distribution)}
                  />
                </div>

                <FlowSummary flows={data.flows} window={winKey} onMore={() => selectTab('flows')} t={t} m={m} streamDown={streamDown} />

                {!streamDown && cov && (
                  <div className="smx-stamp" data-testid="sm-coverage">
                    <SmPulseGlyph width={13} height={13} />
                    <span>
                      {cov.observedEvents > 0 && observedHours
                        ? t('sm.observedNote', { n: cov.observedEvents, hours: observedHours })
                        : t('sm.observedNoteNew')}
                      {!m?.flowEvents && cov.inWindow > 0 ? ` ${t('sm.noLabelledFlow')}` : ''}
                    </span>
                  </div>
                )}

                {/* Token activity */}
                <section className="sm-section">
                  <SectionHead
                    icon={<SmWavesGlyph width={16} height={16} />}
                    title={t('sm.smartMoneyActivity')}
                    meta={data.tokenActivity?.length ? t('sm.walletsCount', { n: data.tokenActivity.reduce((s, r) => s + (r.wallets || 0), 0) }) : null}
                  />
                  {data.tokenActivity?.length === 0 && (
                    <EmptyArt icon={<SmWavesGlyph width={22} height={22} />} title={t('sm.noActivity')} />
                  )}
                  <TokenActivityRows rows={data.tokenActivity} navigate={navigate} t={t} />
                </section>

                {/* Early detection */}
                <section className="sm-section">
                  <SectionHead
                    icon={<SmSparkGlyph width={16} height={16} />}
                    title={t('sm.earlyDetection')}
                    meta={data.earlyTokens?.tokens?.length ? String(data.earlyTokens.tokens.length) : null}
                  />
                  <EarlyGrid tokens={data.earlyTokens?.tokens || []} loading={!data.earlyTokens} navigate={navigate} t={t} />
                  <p className="smx-disclaimer">{data.earlyTokens?.note}</p>
                </section>

                {/* Fresh wallets */}
                {data.freshWallets && (data.freshWallets.dataStatus === 'live' || data.freshWallets.dataStatus === 'quiet') && (
                  <section className="sm-section">
                    <SectionHead
                      icon={<SmFreshGlyph width={16} height={16} />}
                      title={t('sm.freshWallets')}
                      meta={data.freshWallets.newWallets != null ? String(data.freshWallets.newWallets) : null}
                    />
                    {data.freshWallets.dataStatus === 'quiet' ? (
                      <EmptyArt icon={<SmFreshGlyph width={22} height={22} />} title={t('sm.quietFresh')} />
                    ) : (
                      <>
                        <div className="smx-miniMetrics">
                          <div><small>{t('sm.newWallets')}</small><b>{data.freshWallets.newWallets}</b></div>
                          <div><small>{t('sm.interesting')}</small><b>{data.freshWallets.interestingWallets}</b></div>
                          <div><small>{t('sm.capital')}</small><b>{fmtUsd(data.freshWallets.capitalUsd)}</b></div>
                        </div>
                        <div className="smx-fresh-grid">
                          {data.freshWallets.wallets?.slice(0, 6).map((w) => (
                            <FreshCard key={`${w.chainId}:${w.address}`} wallet={w} navigate={navigate} t={t} />
                          ))}
                        </div>
                      </>
                    )}
                    <p className="smx-disclaimer">{data.freshWallets.note}</p>
                  </section>
                )}

                {/* Liquidity */}
                {data.liquidityEvents?.events?.length > 0 && (
                  <section className="sm-section">
                    <SectionHead
                      icon={<SmDropletGlyph width={16} height={16} />}
                      title={t('sm.liquidityMovement')}
                      meta={String(data.liquidityEvents.events.length)}
                    />
                    {/* openUrl for the same two reasons as the tx search above:
                        the old `window` state shadowed the global here, and a
                        raw `window.open` is a no-op inside the APK — so tapping
                        a liquidity row silently did nothing. */}
                    <div className="smx-rows">
                      {data.liquidityEvents.events.slice(0, 6).map((e) => {
                        const added = e.kind === 'LP_ADDED';
                        return (
                          <button
                            type="button"
                            key={e.id}
                            className="smx-row"
                            onClick={() => e.explorerTx && openUrl(e.explorerTx)}
                          >
                            <span className={`smx-row-ico is-flat ${added ? 'is-up' : 'is-down'}`} aria-hidden="true">
                              <SmDropletGlyph width={16} height={16} />
                            </span>
                            <span className="smx-row-main">
                              <span className="smx-row-title">{e.symbols}</span>
                              <span className="smx-row-sub">
                                {added ? t('sm.lpAdded') : t('sm.lpRemoved')} · {e.chainShort}{e.dex ? ` · ${e.dex}` : ''}
                              </span>
                            </span>
                            <span className="smx-row-end">
                              <b className={added ? 'sm-up' : 'sm-down'}>{fmtUsd(e.liquidityUsd)}</b>
                              <RiskPill band={e.impact} t={t} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                <p className="smx-disclaimer smx-disclaimer--foot">{t('sm.disclaimer')}</p>
              </>
            )}
          </>
        )}

        {/* WHALES */}
        {tab === 'intelligence' && <SmartMoneyIntelligence />}
        {tab === 'whales' && <WhalesTab navigate={navigate} t={t} />}

        {/* Verified, profitability-backed registry first. Keep the historical
            whale-transfer ranking as explicitly separate context below. */}
        {tab === 'wallets' && <><VerifiedWallets /><WhalesTab navigate={navigate} t={t} smart /></>}

        {/* TOKEN INTELLIGENCE */}
        {tab === 'tokens' && <TokensTab navigate={navigate} t={t} query={query} setQuery={setQuery} winKey={winKey} activity={data?.tokenActivity} />}

        {/* MONEY FLOW */}
        {tab === 'flows' && <FlowsTab t={t} win={winKey} onWindow={selectWindow} />}

        {/* ALERTS */}
        {tab === 'alerts' && <AlertsTab navigate={navigate} t={t} />}
        </motion.div>
      </div>
    </PageTransition>
  );
}

/*
 * The flow card on the overview. Inflow (into an exchange) is the red side:
 * it is supply arriving where it can be sold. Outflow is the green side.
 */
function FlowSummary({ flows, window: win = '24h', onMore, t, m, streamDown }) {
  const f = flows?.windows?.[win] || flows?.windows?.['24h'];
  if (!f) return null;
  const hasFlow = (f.events || 0) > 0;
  const total = Math.max(1, (f.inflowUsd || 0) + (f.outflowUsd || 0));
  const outPct = Math.round(((f.outflowUsd || 0) / total) * 100);
  /* No labelled event in this window is the absence of an observation, not an
     observed zero — and a dead stream is not a quiet market. Both print «—». */
  const flowUsd = (n) => (streamDown || !m?.flowEvents ? '—' : fmtUsd(n));
  return (
    <section className="sm-section smx-flowcard">
      <SectionHead icon={<SmBankGlyph width={16} height={16} />} title={t('sm.moneyFlow')}>
        <button type="button" className="smx-link" onClick={onMore}>
          {t('sm.viewAll')}
          <IconChevronLeft width={13} height={13} />
        </button>
      </SectionHead>
      {hasFlow ? (
        <>
          <div className="smx-flow-nums">
            <div className="is-in">
              <span><SmDistributeGlyph width={12} height={12} />{t('sm.cexInflow')}</span>
              <b>{flowUsd(f.inflowUsd)}</b>
            </div>
            <div className="is-out">
              <span><SmAccumulateGlyph width={12} height={12} />{t('sm.cexOutflow')}</span>
              <b>{flowUsd(f.outflowUsd)}</b>
            </div>
          </div>
          <FlowBar inflow={f.inflowUsd} outflow={f.outflowUsd} />
          <div className="smx-flow-legend">
            <span className="is-in">{100 - outPct}%</span>
            <span className="is-out">{outPct}%</span>
          </div>
        </>
      ) : (
        /* A 0/0 bar reads as «no flow», which is exactly what we do NOT know. */
        <div className="smx-inline-empty">{t('sm.noLabelledFlow')}</div>
      )}
    </section>
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

  if (err) {
    return (
      <EmptyArt
        icon={<SmRiskGlyph width={22} height={22} />}
        title={t('sm.errorOverview')}
        body={err}
      />
    );
  }
  if (!rows) return <Spinner />;
  if (!rows.length) return <EmptyArt icon={<SmWhaleGlyph width={22} height={22} />} title={t('sm.noWhales')} />;

  /*
   * All three risk bands are counted and shown, including the ones with a zero
   * — a rail that only lists the bands that happen to appear makes «no LOW
   * wallet» indistinguishable from «LOW is not a band this page tracks».
   */
  const bands = ['LOW', 'MEDIUM', 'HIGH'];
  const bandCount = bands.reduce((acc, b) => {
    acc[b] = rows.filter((w) => (['LOW', 'MEDIUM', 'HIGH'].includes(w.riskBand) ? w.riskBand : 'MEDIUM') === b).length;
    return acc;
  }, {});

  return (
    <section className="sm-section">
      <SectionHead
        icon={<SmWhaleGlyph width={16} height={16} />}
        title={smart ? t('sm.smartWalletsTitle') : t('sm.whaleTracking')}
        meta={String(rows.length)}
      />
      <div className="smx-chips">
        {bands.map((b) => (
          <span key={b} className={`smx-chip smx-risk is-${b.toLowerCase()}`}>
            <SmRiskGlyph width={11} height={11} />
            {t(`sm.riskBand.${b}`)}
            <b className="mono">{bandCount[b]}</b>
          </span>
        ))}
      </div>
      <div className="smx-whale-grid">
        {rows.map((w, i) => (
          <WhaleCard
            key={`${w.chainId}:${w.address}`}
            wallet={w}
            index={i}
            navigate={navigate}
            t={t}
          />
        ))}
      </div>
      <p className="smx-disclaimer">{note || t('sm.whaleDisclaimer')}</p>
    </section>
  );
}

/*
 * THE TOKEN TAB — «اطلاعات توکن‌ها تب در هوشمند مانی اطلاعاتی را نشان نمی‌دهد»
 * ───────────────────────────────────────────────────────────────────────────
 * The tab used to be ONE section: «تشخیص زودهنگام». When the DexScreener
 * early-token feed answered with an empty list (normal whenever no brand-new
 * pair cleared the liquidity filter in the last few hours), the whole tab was
 * a search box, an empty state and a paragraph — while the overview two taps
 * away was showing real token accumulations. Nothing was broken in the fetch;
 * the tab simply asked a narrower question than the page already had answers
 * for.
 *
 * It now leads with the same activity rows the overview renders (passed down,
 * not re-fetched), then the early-token grid and the fresh wallets. Search
 * filters all three. Every empty state is the honest one, and the window the
 * numbers belong to is printed in the header — so a quiet feed reads as
 * "nothing observed in this window", never as a broken screen.
 */
function TokensTab({ navigate, t, query, setQuery, winKey, activity }) {
  const [early, setEarly] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let on = true;
    setBusy(true);
    Promise.allSettled([fetchEarlyTokens(30), fetchFreshWallets()]).then(([a, b]) => {
      if (!on) return;
      setEarly(a.status === 'fulfilled' ? (a.value?.tokens || []) : []);
      setFresh(b.status === 'fulfilled' ? b.value : null);
      setBusy(false);
    });
    return () => { on = false; };
  }, [tick]);

  const q = String(query || '').trim().toLowerCase();
  const hits = (row) => !q
    || String(row?.symbol || '').toLowerCase().includes(q)
    || String(row?.address || row?.token || '').toLowerCase().includes(q);

  const activityRows = (activity || []).filter(hits);
  const earlyRows = (early || []).filter(hits);
  const freshRows = (fresh?.wallets || []).filter(hits);
  const nothing = early !== null && !activityRows.length && !earlyRows.length && !freshRows.length;

  return (
    <>
      {/* Search and a manual refresh live in ONE bar: the tab reads three feeds
          and the reader should be able to ask all three again with one tap. */}
      <form
        className="smx-search smx-search--inline smx-toksearch"
        onSubmit={(e) => { e.preventDefault(); setTick((n) => n + 1); }}
        role="search"
      >
        <span className="smx-search-ico" aria-hidden="true"><IconSearch width={16} height={16} /></span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('sm.tokenSearch')}
          aria-label={t('sm.tokenSearch')}
          spellCheck="false"
        />
        {query ? (
          <button type="button" className="smx-search-clear" onClick={() => setQuery('')} aria-label={t('common.clear')}>
            <IconX width={13} height={13} />
          </button>
        ) : null}
        <button
          type="submit"
          className={`smx-refresh smx-toksearch-go ${busy ? 'is-busy' : ''}`}
          aria-label={t('common.refresh')}
        >
          <IconRefresh width={15} height={15} />
        </button>
      </form>

      {/* What this tab is made of, in three numbers. */}
      <div className="smx-tokstats">
        <div>
          <span className="smx-tokstats-ico is-mint" aria-hidden="true"><SmAccumulateGlyph width={14} height={14} /></span>
          <b className="mono">{activity ? activityRows.length : '—'}</b>
          <small>{t('sm.smartMoneyActivity')}</small>
        </div>
        <div>
          <span className="smx-tokstats-ico is-cyan" aria-hidden="true"><SmSparkGlyph width={14} height={14} /></span>
          <b className="mono">{early ? earlyRows.length : '—'}</b>
          <small>{t('sm.earlyDetection')}</small>
        </div>
        <div>
          <span className="smx-tokstats-ico is-violet" aria-hidden="true"><SmFreshGlyph width={14} height={14} /></span>
          <b className="mono">{fresh ? freshRows.length : '—'}</b>
          <small>{t('sm.freshWallets')}</small>
        </div>
      </div>

      {nothing && (
        <EmptyArt
          icon={<SmCoinGlyph width={22} height={22} />}
          title={t('sm.noEarly')}
          body={t('sm.tokenTabEmpty')}
        />
      )}

      {activityRows.length > 0 && (
        <section className="sm-section" data-testid="sm-tokens-activity">
          <SectionHead
            icon={<SmWavesGlyph width={16} height={16} />}
            title={t('sm.smartMoneyActivity')}
            meta={`${t(`sm.windows.${winKey}`)} · ${t('sm.walletsCount', { n: activityRows.reduce((s, r) => s + (r.wallets || 0), 0) })}`}
          />
          <TokenActivityRows rows={activityRows} navigate={navigate} t={t} />
        </section>
      )}

      <section className="sm-section">
        <SectionHead
          icon={<SmSparkGlyph width={16} height={16} />}
          title={t('sm.earlyDetection')}
          meta={early ? String(earlyRows.length) : null}
        />
        {!early ? <Spinner /> : <EarlyGrid tokens={earlyRows} navigate={navigate} t={t} />}
        <p className="smx-disclaimer">{t('sm.earlyNote')}</p>
      </section>

      {freshRows.length > 0 && (
        <section className="sm-section">
          <SectionHead icon={<SmFreshGlyph width={16} height={16} />} title={t('sm.freshWallets')} meta={String(freshRows.length)} />
          <div className="smx-fresh-grid">
            {freshRows.slice(0, 6).map((w) => (
              <FreshCard key={`${w.chainId}:${w.address}`} wallet={w} navigate={navigate} t={t} />
            ))}
          </div>
        </section>
      )}

      <p className="smx-disclaimer">{t('sm.tokenTabNote')}</p>
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
  const hasFlow = (f?.events || 0) > 0;
  const dash = (n) => (hasFlow ? fmtUsd(n) : '—');
  const total = Math.max(1, (f?.inflowUsd || 0) + (f?.outflowUsd || 0));
  const outPct = Math.round(((f?.outflowUsd || 0) / total) * 100);

  return (
    <>
      <section className="sm-section smx-flowtab">
        <SectionHead icon={<SmBankGlyph width={16} height={16} />} title={t('sm.exchangeFlow')} />
        <FlowsWindowRail t={t} win={win} onWindow={onWindow} />

        {!flows ? <Spinner /> : (
          <>
            <div className="smx-net">
              <span className="smx-net-lab">{t('sm.netFlow')}</span>
              <b className={(f?.netUsd || 0) >= 0 ? 'sm-up' : 'sm-down'}>{dash(f?.netUsd)}</b>
              <span className="smx-net-cols">
                <span className="is-in">↓ {t('sm.cexInflow')} · {dash(f?.inflowUsd)}</span>
                <span className="is-out">↑ {t('sm.cexOutflow')} · {dash(f?.outflowUsd)}</span>
              </span>
            </div>

            {hasFlow ? (
              <>
                <FlowBar inflow={f.inflowUsd} outflow={f.outflowUsd} />
                <div className="smx-flow-legend">
                  <span className="is-in">{100 - outPct}%</span>
                  <span className="is-out">{outPct}%</span>
                </div>
              </>
            ) : (
              <div className="smx-inline-empty">
                {flows.dataStatus === 'unavailable' ? t('sm.dataSourceOffline') : t('sm.noLabelledFlow')}
              </div>
            )}

            {f && typeof f.coverage === 'number' && f.coverage < 0.95 && (
              <div className="smx-hint">{t('sm.windowCoverage', { pct: Math.round(f.coverage * 100) })}</div>
            )}

            {f?.byExchange?.length > 0 && (
              <div className="smx-ex-grid">
                {f.byExchange.map((r) => {
                  const rowTotal = Math.max(1, (r.inflowUsd || 0) + (r.outflowUsd || 0));
                  return (
                    <div key={r.exchange} className="smx-ex">
                      <div className="smx-ex-top">
                        <b>{r.exchange}</b>
                        <span className={r.netUsd >= 0 ? 'sm-up' : 'sm-down'}>{fmtUsd(r.netUsd)}</span>
                      </div>
                      <div className="smx-ex-bar" aria-hidden="true">
                        <i className="is-in" style={{ width: `${Math.round(((r.inflowUsd || 0) / rowTotal) * 100)}%` }} />
                        <i className="is-out" style={{ width: `${Math.round(((r.outflowUsd || 0) / rowTotal) * 100)}%` }} />
                      </div>
                      <div className="smx-ex-legend">
                        <span className="is-in">↓ {fmtUsd(r.inflowUsd)}</span>
                        <span className="is-out">↑ {fmtUsd(r.outflowUsd)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        <p className="smx-disclaimer">{flows?.note}</p>
      </section>

      <section className="sm-section">
        <SectionHead icon={<SmDropletGlyph width={16} height={16} />} title={t('sm.liquidityMovement')} />
        {!liq ? <Spinner /> : !liq.length ? (
          <EmptyArt icon={<SmDropletGlyph width={22} height={22} />} title={t('sm.noLiquidity')} />
        ) : (
          <div className="smx-rows">
            {liq.slice(0, 20).map((e) => {
              const added = e.kind === 'LP_ADDED';
              return (
                <button type="button" key={e.id} className="smx-row" onClick={() => e.explorerTx && openUrl(e.explorerTx)}>
                  <span className={`smx-row-ico is-flat ${added ? 'is-up' : 'is-down'}`} aria-hidden="true">
                    <SmDropletGlyph width={16} height={16} />
                  </span>
                  <span className="smx-row-main">
                    <span className="smx-row-title">{e.symbols}</span>
                    <span className="smx-row-sub">{e.chainShort}{e.dex ? ` · ${e.dex}` : ''}</span>
                  </span>
                  <span className="smx-row-end">
                    <b className={added ? 'sm-up' : 'sm-down'}>{fmtUsd(e.liquidityUsd)}</b>
                    <RiskPill band={e.impact} t={t} />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {exchanges && (
        <section className="sm-section">
          <SectionHead icon={<SmBankGlyph width={16} height={16} />} title={t('sm.cexRegistry')} />
          <div className="smx-chips">
            {exchanges.exchanges?.map((ex) => <span key={ex} className="smx-chip">{ex}</span>)}
          </div>
          {flows?.observedExchanges?.length > 0 && (
            <div className="smx-hint">{t('sm.observedExchanges')}: {flows.observedExchanges.join(' · ')}</div>
          )}
          <p className="smx-disclaimer">{exchanges.note}</p>
        </section>
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
    <section className="sm-section">
      <SectionHead
        icon={<SmBellGlyph width={16} height={16} />}
        title={t('sm.whaleAlerts')}
        meta={alerts ? String(alerts.length) : null}
      />
      {!alerts ? <Spinner /> : alerts.length === 0 ? (
        <EmptyArt
          icon={<SmBellGlyph width={22} height={22} />}
          title={t('sm.noAlerts')}
          body={t('sm.noAlertsBody')}
        />
      ) : (
        <div className="smx-alerts">
          {alerts.map((a) => {
            const consensus = a.type?.startsWith('CONSENSUS');
            const reversal = a.type === 'MOMENTUM_REVERSAL';
            /* An alert names a wallet (chain + address) — it now LINKS to that
               wallet's intelligence page instead of being a dead row. */
            const target = a.chain && a.address
              ? `/smart-money/${a.target === 'token' || a.evidence?.classification === 'verified-paired-swaps' || a.watchId?.endsWith(':token') ? 'token' : 'wallet'}/${a.chain}/${a.address}`
              : null;
            return (
              <button
                type="button"
                key={a.id}
                className="smx-alert"
                disabled={!target}
                onClick={() => target && navigate(target)}
              >
                <span className={`smx-alert-ico ${consensus ? 'is-mint' : reversal ? 'is-violet' : 'is-cyan'}`} aria-hidden="true">
                  {consensus ? <SmVerifiedGlyph width={16} height={16} />
                    : reversal ? <SmFlowGlyph width={16} height={16} />
                      : <SmWhaleGlyph width={16} height={16} />}
                </span>
                <span className="smx-alert-body">
                  <span className="smx-alert-title">{a.title}</span>
                  <span className="smx-alert-msg">{a.message}</span>
                </span>
                <span className="smx-alert-ago">{timeAgo(a.at)}</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="smx-disclaimer">{t('sm.alertHow')}</p>
    </section>
  );
}
