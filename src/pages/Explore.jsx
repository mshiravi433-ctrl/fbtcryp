import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { EVM_CHAINS, explorerAddr, explorerTx } from '../lib/chains';
import { exploreApi, intelErrorCode } from '../lib/intelApi';
import { fmtCompact, fmtPct, fmtUsd, timeAgo } from '../lib/format';
import { openUrl } from '../lib/browser';
import {
  IconActivity, IconBuilding, IconChevronLeft, IconCoins, IconExternal,
  IconGlobe, IconRefresh, IconSearch, IconShield, IconWallet
} from '../components/Icons';
import {
  ChainDot, CopyRow, EmptyState, ErrorState, LoadingState, MetaLine,
  Notices, SectionTabs, ShortAddr, StatTile
} from '../components/Intel';
import QrScanner, { parseScanned, scannerSupported } from '../components/QrScanner';
import '../styles/docs-modern.css';
import '../styles/intel.css';

/**
 * EXPLORE — FBT Blockchain Intelligence & Discovery.
 * ---------------------------------------------------------------------------
 * Upgraded from the paste-and-link lookup into a real explorer surface:
 * wallet scanning across every network in the FBT registry, transaction
 * exploration with deterministic decoding, contract and token profiles, and
 * protocol discovery with a trending engine — all read through the backend's
 * blockchain data layer (RPC first, explorer APIs where a key exists, curated
 * registry, DefiLlama for protocol economics).
 *
 * Three invariants this file keeps, on purpose and by construction:
 *
 *  1. NO FABRICATION. A field with no source renders `N/A`. The old page's
 *     reasoning stands and still applies: a half-populated explorer is worse
 *     than none, so "we could not read it" is a first-class UI state here,
 *     styled honestly, never papered over with zeros.
 *  2. NO EXECUTION. There is not one transaction built, signed or sent from
 *     this page. It reads chains and links to explorers. Explore is a client
 *     of the data layer; it shares nothing with the intent/execution stack and
 *     works with that layer deleted.
 *  3. EXTERNAL EXPLORERS STAY. The original behavior — identify the input,
 *     then open the canonical Etherscan/BscScan/… for it — was right and is
 *     preserved as the "open on external explorer" step of every result. The
 *     native views are additive.
 */

/** What kind of thing did the user paste? Kept exported and unchanged in behavior. */
export function classifyQuery(raw) {
  const q = String(raw || '').trim();
  if (!q) return { kind: 'empty' };
  if (/^0x[a-fA-F0-9]{64}$/.test(q)) return { kind: 'tx', value: q };
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) return { kind: 'address', value: q };
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(q)) return { kind: 'tron', value: q };
  if (/^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(q)) return { kind: 'solana', value: q };
  if (/^\d{1,12}$/.test(q)) return { kind: 'block', value: q };
  return { kind: 'unknown', value: q };
}

const NON_EVM = {
  tron: { name: 'Tron', url: (v) => `https://tronscan.org/#/address/${v}` },
  solana: { name: 'Solana', url: (v) => `https://solscan.io/account/${v}` }
};

const CHAIN_OPTIONS = [
  { value: 'auto', label: 'auto' },
  ...Object.keys(EVM_CHAINS).map((id) => ({ value: id, label: EVM_CHAINS[id].short || EVM_CHAINS[id].name }))
];

/* Small shared hook: load → data | error, with refresh and visibility-aware
 * polling. Everything on this page is a GET, so "poll" is honest. */
function useIntel(loader, deps, { intervalMs = 0, auto = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(auto);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  const fn = useRef(loader);
  fn.current = loader;
  const run = useCallback(async () => {
    try {
      const d = await fn.current();
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    if (auto) run();
    let timer = null;
    if (intervalMs > 0) {
      timer = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') run();
      }, intervalMs);
    }
    return () => { alive.current = false; if (timer) clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, error, reload: run, setData };
}

export default function Explore({ embedded = false }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const { haptic } = useTelegram();
  const [params] = useSearchParams();

  const [q, setQ] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const initialSection = ['overview', 'wallet', 'tx', 'tokens', 'contracts', 'protocols'].includes(params.get('section'))
    ? params.get('section')
    : 'overview';
  const [section, setSection] = useState(initialSection);
  const [search, setSearch] = useState(null); // explore/search payload
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchErr, setSearchErr] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const debounceRef = useRef(null);

  const found = useMemo(() => classifyQuery(q), [q]);

  const tap = (kind = 'light') => { try { haptic?.(kind); } catch { /* no-op outside telegram */ } };

  /* One debounced search per keystroke batch — never per keystroke. */
  useEffect(() => {
    const value = q.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value || (found.kind !== 'tx' && found.kind !== 'address' && found.kind !== 'text' && found.kind !== 'solana')) {
      setSearch(null);
      setSearchErr(null);
      setSearchBusy(false);
      return undefined;
    }
    setSearchBusy(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await exploreApi.search(value);
        setSearch(res);
        setSearchErr(null);
      } catch (e) {
        setSearchErr(intelErrorCode(e));
      } finally {
        setSearchBusy(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, retryNonce]);

  /** Every chain that could plausibly hold this hash or address (preserved). */
  const evmTargets = useMemo(() => {
    if (found.kind !== 'tx' && found.kind !== 'address' && found.kind !== 'block') return [];
    return Object.values(EVM_CHAINS).map((c) => ({
      chain: c,
      url:
        found.kind === 'tx'
          ? explorerTx(c.id, found.value)
          : found.kind === 'address'
            ? explorerAddr(c.id, found.value)
            : `${c.explorer}/block/${found.value}`
    }));
  }, [found]);

  const jump = (next, payload) => {
    tap('light');
    setSection(next);
    if (payload) setQ(payload);
  };

  const goSecurity = (path) => navigate(path);

  const results = search?.data?.results || [];

  return (
    <PageTransition embedded={embedded}>
      {!embedded && (
        <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 19 }}>{t('explore.title')}</h1>
        </motion.div>
      )}

      <p className="muted">{t('explore.subtitle')}</p>

      {/* ------------------------------ search ------------------------------ */}
      <motion.section
        className="docs-card"
        data-open="true"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ '--card-hue': 'var(--rgb-1)', padding: 18, background: 'linear-gradient(145deg, rgba(0,229,255,0.08), rgba(255,255,255,0.03))', borderColor: 'rgba(0,229,255,0.14)' }}
      >
        <div className="row" style={{ gap: 12 }}>
          <span className="docs-icon" style={{ width: 44, height: 44, borderRadius: 13, background: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))', color: '#fff', border: 'none', boxShadow: '0 8px 20px rgba(0,229,255,0.20)' }}>
            <span style={{ fontSize: 18 }}>⌕</span>
          </span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('explore.placeholder')}
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="search"
            aria-label={t('explore.searchAria')}
            style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 12.5, direction: 'ltr', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '10px 12px' }}
          />
          {scannerSupported() && (
            <button className="btn btn-ghost btn-sm" onClick={() => { tap('light'); setScanOpen(true); }} style={{ flexShrink: 0 }} aria-label={t('explore.scan')}>
              <IconSearch width={14} height={14} />
            </button>
          )}
        </div>

        {q.trim() && (
          <p className="faint" style={{ marginTop: 9 }}>
            {searchBusy ? t('intel.searching') : t(`explore.kind.${found.kind}`)}
          </p>
        )}

        {wallet.address && !q.trim() && (
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 10, width: '100%' }} onClick={() => setQ(wallet.address)}>
            {t('explore.useMine')}
          </button>
        )}

        {/* deep results from the backend, identified against real chain data */}
        {results.length > 0 && (
          <div className="stack" style={{ gap: 7, marginTop: 12 }} role="list">
            {results.slice(0, 8).map((r, i) => (
              <button
                key={i}
                role="listitem"
                className="intel-result"
                onClick={() => {
                  if (r.type === 'transaction') { setSection('tx'); }
                  else if (r.type === 'protocol') { setSection('protocols'); }
                  else if (r.type === 'token') { setSection('tokens'); if (r.address) setQ(r.address); }
                  else if (r.type === 'block') { /* external only */ }
                  else { setSection(found.kind === 'solana' ? 'wallet' : 'wallet'); }
                }}
              >
                <span className="intel-type-tag">{t(`explore.type.${r.type}`, r.category || r.symbol || r.name || '')}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name || r.symbol || (r.hash ? `${r.hash.slice(0, 10)}…${r.hash.slice(-8)}` : '')}
                    {r.category && <span className="faint" style={{ fontWeight: 500 }}> · {r.category}</span>}
                  </span>
                  <span className="faint" style={{ fontSize: 10.5 }}>
                    {r.networks?.length
                      ? t('explore.onChains', { n: r.networks.length, list: r.networks.map((x) => x.name).slice(0, 3).join(' · ') })
                      : r.chainName || r.chainId || (r.tvl != null ? fmtUsd(r.tvl) : '')}
                  </span>
                </span>
                <IconChevronLeft width={14} height={14} style={{ transform: 'rotate(180deg)', color: 'var(--text-3)', flexShrink: 0 }} />
              </button>
            ))}
          </div>
        )}
        {searchErr && <ErrorState code={searchErr} onRetry={() => setRetryNonce((n) => n + 1)} t={t} />}
        {!searchBusy && found.kind === 'address' && results.length === 0 && q.trim().length > 20 && (
          <p className="faint" style={{ marginTop: 10, fontSize: 11, lineHeight: 1.65 }}>{t('explore.noChainFoundHint')}</p>
        )}
      </motion.section>

      {/* ------------------------------ tabs ------------------------------ */}
      <SectionTabs
        ariaLabelKey="explore.sectionsAria"
        active={section}
        onChange={(id) => { tap('light'); setSection(id); }}
        tabs={[
          { id: 'overview', labelKey: 'explore.tab.overview', Icon: IconGlobe },
          { id: 'wallet', labelKey: 'explore.tab.wallet', Icon: IconWallet },
          { id: 'tx', labelKey: 'explore.tab.tx', Icon: IconActivity },
          { id: 'tokens', labelKey: 'explore.tab.tokens', Icon: IconCoins },
          { id: 'contracts', labelKey: 'explore.tab.contracts', Icon: IconBuilding },
          { id: 'protocols', labelKey: 'explore.tab.protocols', Icon: IconShield }
        ]}
      />

      {section === 'overview' && <OverviewSection onJump={jump} />}
      {section === 'wallet' && <WalletSection goSecurity={goSecurity} />}
      {section === 'tx' && <TxSection initialHash={found.kind === 'tx' ? found.value : ''} />}
      {section === 'tokens' && <TokensSection initial={found.kind === 'address' ? found.value : ''} goSecurity={goSecurity} />}
      {section === 'contracts' && <ContractsSection initial={found.kind === 'address' ? found.value : ''} goSecurity={goSecurity} />}
      {section === 'protocols' && <ProtocolsSection initialQuery={found.kind === 'text' ? found.value : ''} goSecurity={goSecurity} />}

      {/* ----------------- external explorers (original path, kept) ----------------- */}
      {evmTargets.length > 0 && (
        <motion.section variants={stagger} initial="hidden" animate="show" style={{ marginTop: 6 }}>
          <p className="section-label" style={{ marginBottom: 4 }}>{t('explore.openOn')}</p>
          <p className="faint" style={{ margin: '0 0 9px', lineHeight: 1.7 }}>
            {t('explore.chainHint')}
          </p>
          <div className="stack" style={{ gap: 10 }}>
            {evmTargets.map(({ chain, url }) => (
              <motion.button
                key={chain.id}
                className="docs-card"
                data-open="false"
                variants={riseIn}
                whileTap={{ scale: 0.985 }}
                onClick={() => { tap('light'); openUrl(url); }}
                style={{ '--card-hue': chain.color, padding: 16, textAlign: 'start', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', gap: 14, background: `linear-gradient(145deg, color-mix(in srgb, ${chain.color} 8%, rgba(255,255,255,0.05)), rgba(255,255,255,0.03))`, borderColor: `color-mix(in srgb, ${chain.color} 16%, rgba(255,255,255,0.08))` }}
              >
                <span style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${chain.color}, ${chain.color}aa)`, color: '#fff', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{chain.name.slice(0, 2).toUpperCase()}</span>
                <span style={{ fontWeight: 700, fontSize: 13.5, flex: 1 }}>{chain.name}</span>
                <span className="exp-go">
                  <IconExternal width={13} height={13} />
                </span>
              </motion.button>
            ))}
          </div>
        </motion.section>
      )}

      {(found.kind === 'tron' || found.kind === 'solana') && (
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 9 }}>{t('explore.openOn')}</p>
          <button className="btn btn-primary" onClick={() => { tap('light'); openUrl(NON_EVM[found.kind].url(found.value)); }}>
            {NON_EVM[found.kind].name}
          </button>
          <p className="faint" style={{ marginTop: 9, lineHeight: 1.7 }}>{t('explore.nonEvmNote')}</p>
        </motion.section>
      )}

      {found.kind === 'unknown' && q.trim() && (
        <motion.p className="notice" variants={riseIn} initial="hidden" animate="show">
          {t('explore.unrecognised')}
        </motion.p>
      )}

      <motion.section className="docs-card" data-open="true" variants={riseIn} initial="hidden" animate="show" style={{ '--card-hue': 'var(--rgb-2)', padding: 16 }}>
        <p className="section-label" style={{ marginBottom: 10 }}>{t('explore.learnTitle')}</p>
        <ul className="exp-learn">
          {['hash', 'address', 'pending', 'confirm'].map((k) => (
            <li key={k}>
              <strong>{t(`explore.learn.${k}.q`)}</strong>
              <span>{t(`explore.learn.${k}.a`)}</span>
            </li>
          ))}
        </ul>
      </motion.section>

      <QrScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onResult={(parsed, rawValue) => {
          // A block explorer should accept anything scannable — a tx hash QR is
          // common on receipts. Fall back to the raw payload when no address.
          setQ(parsed?.address || rawValue || '');
        }}
      />
    </PageTransition>
  );
}

/* ========================================================================== */
/* Overview                                                                     */
/* ========================================================================== */

function OverviewSection({ onJump }) {
  const { t } = useTranslation();
  const nets = useIntel(() => exploreApi.networks(), [], { intervalMs: 60_000 });
  const trend = useIntel(() => exploreApi.trending(), [], { intervalMs: 5 * 60_000 });
  const rows = nets.data?.data?.networks || [];
  const trending = trend.data?.data?.trending || [];

  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ '--card-hue': 'var(--rgb-1)', padding: 16 }}>
        <div className="row-between" style={{ marginBottom: 4 }}>
          <p className="section-label" style={{ margin: 0 }}>{t('explore.networks')}</p>
          {rows.length > 0 && (
            <span className="pill pill-neutral" style={{ fontSize: 10 }}>
              {t('explore.networksCount', { ok: nets.data?.data?.online ?? '—', total: nets.data?.data?.total ?? rows.length })}
            </span>
          )}
        </div>
        {nets.loading && !rows.length && <LoadingState label={t('explore.pinging')} />}
        {nets.error && <ErrorState code={intelErrorCode(nets.error)} onRetry={nets.reload} t={t} />}
        {rows.length > 0 && (
          <div className="stack" style={{ gap: 2, marginTop: 6 }}>
            {rows.map((n) => (
              <div key={n.chainId} className="intel-row">
                <ChainDot color={n.color} short={n.name} />
                <span style={{ flex: 1 }} />
                {n.ok ? (
                  <span className="mono" style={{ fontSize: 11, color: 'var(--up)' }}>
                    #{n.latestBlock == null ? '—' : n.latestBlock}
                  </span>
                ) : (
                  <span className="pill pill-down" style={{ fontSize: 9.5 }}>{t('explore.networkDown')}</span>
                )}
                {n.latencyMs != null && (
                  <span className="faint mono" style={{ fontSize: 10 }}>{n.latencyMs} ms</span>
                )}
                <button type="button" className="icon-btn" aria-label={`${t('explore.openOn')} ${n.name}`} onClick={() => openUrl(n.explorer)} style={{ padding: 6 }}>
                  <IconExternal width={13} height={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <MetaLine meta={nets.data?.meta} />
      </motion.section>

      <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 16 }}>
        <p className="section-label" style={{ marginBottom: 8 }}>{t('explore.jumpTitle')}</p>
        <div className="stack" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => onJump('wallet')}>
            <IconWallet width={14} height={14} /> {t('explore.jump.wallet')}
          </button>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => onJump('tx')}>
            <IconActivity width={14} height={14} /> {t('explore.jump.tx')}
          </button>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => onJump('protocols')}>
            <IconGlobe width={14} height={14} /> {t('explore.jump.protocols')}
          </button>
        </div>
      </motion.section>

      {!trend.error && (trend.data || trend.loading) && (
        <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 16 }}>
          <p className="section-label" style={{ marginBottom: 8 }}>{t('explore.trendingStrip')}</p>
          {trend.loading && !trend.data && <LoadingState />}
          {trend.data ? (
            <div className="stack" style={{ gap: 2 }}>
              {trending.length === 0 && <p className="faint" style={{ fontSize: 11.5 }}>{t('explore.trendingEmpty')}</p>}
              {trending.slice(0, 6).map((p) => (
                <button key={p.slug} className="intel-row" data-clickable="true" onClick={() => onJump('protocols')} style={{ cursor: 'pointer' }}>
                  <span className="intel-avatar intel-avatar-sm" style={{ background: 'linear-gradient(135deg, var(--rgb-4), var(--rgb-1))' }}>{(p.name || '?').slice(0, 2).toUpperCase()}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <span className="faint" style={{ fontSize: 10.5 }}>{p.category || '—'} · TVL {p.tvl != null ? fmtCompact(p.tvl) : 'N/A'}</span>
                  </span>
                  {p.change_1d != null && (
                    <span className="mono" style={{ fontSize: 11, color: p.change_1d >= 0 ? 'var(--up)' : 'var(--down)' }}>{fmtPct(p.change_1d, 1)}</span>
                  )}
                </button>
              ))}
              <MetaLine meta={trend.data?.meta} />
            </div>
          ) : null}
          {trend.error && <p className="faint" style={{ fontSize: 11.5 }}>{t('explore.trendingUnavailable')}</p>}
        </motion.section>
      )}
    </motion.div>
  );
}

/* ========================================================================== */
/* Wallet explorer                                                              */
/* ========================================================================== */

function WalletSection({ goSecurity }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [scan, setScan] = useState({ status: 'idle', data: null, error: null });
  const [detail, setDetail] = useState({ status: 'idle', chainId: null, data: null, error: null });

  const runScan = useCallback(async () => {
    if (!wallet.address) return;
    setScan({ status: 'loading', data: null, error: null });
    try {
      const res = await exploreApi.scan(wallet.address);
      setScan({ status: 'ok', data: res, error: null });
    } catch (e) {
      setScan({ status: 'error', data: null, error: intelErrorCode(e) });
    }
  }, [wallet.address]);

  const runDetail = useCallback(async (chainId) => {
    setDetail({ status: 'loading', chainId, data: null, error: null });
    try {
      const res = await exploreApi.wallet(wallet.address, { chain: chainId });
      setDetail({ status: 'ok', chainId, data: res, error: null });
    } catch (e) {
      setDetail({ status: 'error', chainId, data: null, error: intelErrorCode(e) });
    }
  }, [wallet.address]);

  useEffect(() => {
    if (wallet.address) runScan();
    else setScan({ status: 'idle', data: null, error: null });
    setDetail({ status: 'idle', chainId: null, data: null, error: null });
  }, [wallet.address, runScan]);

  if (!wallet.address) {
    return (
      <EmptyState
        icon="🔌"
        title={t('explore.walletDisconnected')}
        note={t('explore.walletDisconnectedNote')}
        action={
          <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => navigate('/wallet')}>
            {t('explore.connectWallet')}
          </button>
        }
      />
    );
  }

  const rows = scan.data?.data?.chains || [];
  const d = detail.data?.data;

  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="pill pill-up" style={{ fontSize: 10 }}>{wallet.mode === 'local' ? t('wallet.mode.local') : wallet.mode === 'wc' ? 'WalletConnect' : t('explore.injected')}</span>
          {wallet.locked && <span className="pill" style={{ fontSize: 10 }}>🔒 {t('wallet.lock')}</span>}
          {!wallet.chainOk && <span className="pill pill-down" style={{ fontSize: 10 }}>{t('explore.wrongNetworkNote')}</span>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={runScan} disabled={scan.status === 'loading'}>
            <IconRefresh width={13} height={13} className={scan.status === 'loading' ? 'intel-spin' : undefined} /> {t('explore.rescan')}
          </button>
        </div>
        <div style={{ marginTop: 10 }}>
          <CopyRow label={t('explore.address')} value={wallet.address} copyText={wallet.address} />
          <CopyRow label={t('explore.network')} value={`${EVM_CHAINS[wallet.chainId]?.short || '—'} (${wallet.chainId})`} />
          <CopyRow label={t('explore.nativeBalance')} value={wallet.nativeBalance != null ? `${Number(wallet.nativeBalance).toFixed(4)} ${EVM_CHAINS[wallet.chainId]?.native?.symbol || ''}`.trim() : null} />
        </div>
        <Notices notices={scan.data?.notices} />
        <MetaLine meta={scan.data?.meta} />
      </motion.section>

      <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 15 }}>
        <p className="section-label" style={{ marginBottom: 8 }}>{t('explore.scanTitle')}</p>
        <p className="faint" style={{ fontSize: 11, margin: '0 0 8px', lineHeight: 1.65 }}>{t('explore.scanNote')}</p>
        {scan.status === 'loading' && <LoadingState label={t('explore.scanning')} />}
        {scan.status === 'error' && <ErrorState code={scan.error} onRetry={runScan} t={t} />}
        {scan.status === 'ok' && (
          <div className="intel-table-wrap">
            <table className="intel-table">
              <thead>
                <tr>
                  <th>{t('explore.col.network')}</th>
                  <th className="num">{t('explore.col.balance')}</th>
                  <th className="num">{t('explore.col.tokens')}</th>
                  <th className="num">{t('explore.col.txs')}</th>
                  <th>{t('explore.col.last')}</th>
                  <th aria-label={t('explore.details')} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.chainId}>
                    <td><ChainDot color={r.color} short={r.short || r.name} /></td>
                    <td className="num mono" style={{ fontSize: 11 }}>
                      {r.error ? <span className="faint">N/A</span> : `${r.balance ?? '0'} ${r.nativeSymbol || ''}`.trim()}
                    </td>
                    <td className="num mono" style={{ fontSize: 11 }}>{r.error ? 'N/A' : r.tokenCount ?? 'N/A'}</td>
                    <td className="num mono" style={{ fontSize: 11 }}>{r.error ? 'N/A' : r.txCount ?? <span className="faint">N/A</span>}</td>
                    <td className="mono" style={{ fontSize: 10.5 }}>{r.lastActivityAt ? timeAgo(r.lastActivityAt, i18n.language) : r.error ? 'N/A' : <span className="faint">{r.historyIndexed === false ? t('explore.notIndexed') : t('intel.noData')}</span>}</td>
                    <td style={{ textAlign: 'end' }}>
                      {typeof r.chainId === 'number' && (
                        <button type="button" className="icon-btn" style={{ padding: 5 }} aria-label={t('explore.details')} onClick={() => runDetail(r.chainId)}>
                          <IconChevronLeft width={13} height={13} style={{ transform: 'rotate(180deg)' }} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.section>

      {detail.status !== 'idle' && (
        <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <p className="section-label" style={{ margin: 0 }}>{t('explore.chainDetail')} · {EVM_CHAINS[detail.chainId]?.short || detail.chainId}</p>
            <button className="icon-btn" style={{ padding: 6 }} aria-label={t('common.close')} onClick={() => setDetail({ status: 'idle', chainId: null, data: null, error: null })}>
              <IconChevronLeft width={13} height={13} />
            </button>
          </div>
          {detail.status === 'loading' && <LoadingState />}
          {detail.status === 'error' && <ErrorState code={detail.error} onRetry={() => runDetail(detail.chainId)} t={t} />}
          {detail.status === 'ok' && d && (
            <>
              <div className="intel-stat-grid">
                <StatTile label={t('explore.native')} value={d.native ? `${d.native.balance} ${d.native.symbol}` : null} />
                <StatTile label={t('explore.sentCount')} value={d.sentCount != null ? d.sentCount : null} sub={d.isContract ? t('explore.contractNonce') : undefined} />
                <StatTile label={t('explore.tokensFound')} value={d.tokenCount} />
                <StatTile label={t('explore.estValue')} value={d.estimatedUsd != null ? fmtUsd(d.estimatedUsd) : null} />
              </div>
              <Notices notices={detail.data?.notices} />
              {(d.tokens || []).filter((x) => x.amount > 0 || x.unavailable).length > 0 && (
                <div className="stack" style={{ gap: 2, marginTop: 10 }}>
                  <p className="section-label" style={{ marginBottom: 2 }}>{t('explore.holdings')}</p>
                  {d.tokens.filter((x) => x.amount > 0 || x.unavailable).map((tk) => (
                    <div key={tk.symbol} className="intel-row">
                      <span className="intel-avatar intel-avatar-sm" style={{ background: 'linear-gradient(135deg, var(--rgb-5), var(--rgb-2))' }}>{(tk.symbol || '?').slice(0, 3)}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 700, fontSize: 12 }}>{tk.symbol}</span>
                        <span className="faint" style={{ fontSize: 10.5 }}>{tk.name}</span>
                      </span>
                      <span style={{ textAlign: 'end' }}>
                        <span className="mono" style={{ fontSize: 11.5 }}>{tk.unavailable ? <span className="faint">{t('explore.readFailed')}</span> : tk.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                        {tk.valueUsd != null && <span className="faint" style={{ fontSize: 10, display: 'block' }}>{fmtUsd(tk.valueUsd)}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {d.transfers && d.transfers.length > 0 && (
                <div className="stack" style={{ gap: 2, marginTop: 10 }}>
                  <p className="section-label" style={{ marginBottom: 2 }}>{t('explore.recentTransfers')}</p>
                  <p className="faint" style={{ fontSize: 10.5, margin: 0 }}>{t('explore.recentTransfersWindow')}</p>
                  {d.transfers.slice(0, 10).map((x, i) => (
                    <div key={`${x.hash}-${i}`} className="intel-row">
                      <span className="mono" style={{ fontSize: 11, width: 18, flexShrink: 0, color: x.direction === 'in' ? 'var(--up)' : 'var(--down)' }}>{x.direction === 'in' ? '↓' : '↑'}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12, fontWeight: 700 }}>
                          {x.amount != null ? x.amount.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'} {x.symbol || ''}
                        </span>
                        <span className="faint" style={{ fontSize: 10 }}>{x.at ? timeAgo(x.at, i18n.language) : ''}</span>
                      </span>
                      <button type="button" className="intel-link" onClick={() => window.open(explorerTx(detail.chainId, x.hash), '_blank', 'noopener,noreferrer')}>
                        {t('explore.openTx')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {d.explorerKeyConfigured === false && (
                <p className="faint" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.6 }}>{t('explore.indexerHint')}</p>
              )}
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => openUrl(explorerAddr(detail.chainId, wallet.address))}>
                  <IconExternal width={13} height={13} /> {t('explore.openOn')} {EVM_CHAINS[detail.chainId]?.short}
                </button>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => goSecurity(`/security?tab=approvals&chain=${detail.chainId}`)}>
                  <IconShield width={13} height={13} /> {t('explore.checkApprovals')}
                </button>
              </div>
              <MetaLine meta={detail.data?.meta} />
            </>
          )}
        </motion.section>
      )}
    </motion.div>
  );
}

/* ========================================================================== */
/* Transaction explorer + explanation                                           */
/* ========================================================================== */

function TxSection({ initialHash }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [hash, setHash] = useState(initialHash || '');
  const [chainSel, setChainSel] = useState('auto');
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const didAuto = useRef(false);

  const lookup = useCallback(async (h, chain) => {
    const value = String(h || '').trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(value)) return;
    setState({ status: 'loading', data: null, error: null });
    try {
      const res = await exploreApi.tx(value, chain && chain !== 'auto' ? { chain } : {});
      setState({ status: 'ok', data: res, error: null });
    } catch (e) {
      setState({ status: 'error', data: null, error: intelErrorCode(e) });
    }
  }, []);

  useEffect(() => {
    if (initialHash && !didAuto.current) {
      didAuto.current = true;
      lookup(initialHash, 'auto');
    }
  }, [initialHash, lookup]);

  const d = state.data?.data;
  const wh = d?.whatHappened;

  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            dir="ltr"
            value={hash}
            onChange={(e) => setHash(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') lookup(hash, chainSel); }}
            placeholder={t('explore.txPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('explore.txAria')}
            className="intel-input"
            style={{ flex: 2, minWidth: 160 }}
          />
          <select value={chainSel} onChange={(e) => setChainSel(e.target.value)} aria-label={t('explore.chain')} style={{ flex: 1, minWidth: 92 }}>
            <option value="auto">{t('explore.autoDetect')}</option>
            {Object.values(EVM_CHAINS).map((c) => (
              <option key={c.id} value={c.id}>{c.short || c.name}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => lookup(hash, chainSel)} disabled={state.status === 'loading' || !/^0x[a-fA-F0-9]{64}$/.test(hash.trim())}>
            <IconSearch width={14} height={14} /> {t('explore.searchBtn')}
          </button>
        </div>
        <p className="faint" style={{ fontSize: 10.5, margin: '8px 2px 0', lineHeight: 1.6 }}>{t('explore.txSearchNote')}</p>
      </motion.section>

      {state.status === 'loading' && <LoadingState label={t('explore.txLooking')} />}
      {state.status === 'error' && <ErrorState code={state.error} onRetry={() => lookup(hash, chainSel)} t={t} />}

      {state.status === 'ok' && d && d.found === false && (
        <EmptyState icon="⌕" title={t('explore.txNotFound')} note={t('explore.txNotFoundNote')} action={
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => lookup(hash, chainSel)}>
            <IconRefresh width={13} height={13} /> {t('common.retry')}
          </button>
        } />
      )}

      {state.status === 'ok' && d && d.found && (
        <>
          <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
            <div className="row-between" style={{ marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
              <span className="row" style={{ gap: 8 }}>
                <span className={`pill ${d.status === 'success' ? 'pill-up' : d.status === 'failed' ? 'pill-down' : 'pill-neutral'}`} style={{ fontSize: 10 }}>
                  {t(`explore.txStatus.${d.status}`)}
                </span>
                <span className="faint" style={{ fontSize: 11 }}>{d.chainName}</span>
              </span>
              <span className="faint mono" style={{ fontSize: 10.5, direction: 'ltr' }}>{d.hash.slice(0, 14)}…{d.hash.slice(-10)}</span>
            </div>
            <CopyRow label={t('explore.block')} value={d.block} />
            <CopyRow label={t('explore.time')} value={d.timestamp ? new Date(d.timestamp).toLocaleString(i18n.language === 'fa' ? 'fa-IR' : undefined) : null} />
            <CopyRow label="From" value={d.from} onOpen={() => window.open(explorerAddr(d.chainId, d.from), '_blank', 'noopener,noreferrer')} />
            <CopyRow label="To" value={d.to} onOpen={() => window.open(explorerAddr(d.chainId, d.to), '_blank', 'noopener,noreferrer')} />
            <CopyRow label={t('explore.value')} value={`${d.value} ${d.valueSymbol}`} />
            <CopyRow label={t('explore.gasUsed')} value={d.gasUsed} />
            <CopyRow label={t('explore.gasPrice')} value={d.gasPriceGwei != null ? `${d.gasPriceGwei.toFixed(2)} gwei` : null} />
            <CopyRow label={t('explore.fee')} value={d.feeNative != null ? `${d.feeNative} ${d.valueSymbol}` : null} />
            <CopyRow label={t('explore.method')} value={d.method} mono={false} />
            {d.methodSignature && <CopyRow label={t('explore.methodSig')} value={d.methodSignature} />}
            <CopyRow label={t('explore.events')} value={d.eventCount} />
            <MetaLine meta={state.data?.meta} />
            <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={() => openUrl(d.explorer)}>
              <IconExternal width={13} height={13} /> {t('explore.openOn')} {d.chainName}
            </button>
          </motion.section>

          {/* ------------------------- what happened ------------------------- */}
          <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ '--card-hue': 'var(--rgb-4)', padding: 15 }}>
            <p className="section-label" style={{ marginBottom: 8 }}>{t('explore.whatHappened')}</p>
            {!wh?.decodable || wh.decodable === 'partial' ? (
              <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, margin: 0 }}>
                {wh?.decodable === 'partial'
                  ? t('explore.explainPartial', { method: wh.method || '—' })
                  : t('explore.explainUnknown')}
              </p>
            ) : wh.kind === 'swap' ? (
              <div className="stack" style={{ gap: 8 }}>
                <p style={{ fontWeight: 800, fontSize: 13.5, margin: 0 }}>{t('explore.explain.swapTitle')}</p>
                {wh.sent?.length > 0 && (
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="faint" style={{ fontSize: 11 }}>{t('explore.assetSent')}</span>
                    {wh.sent.map((a, i) => <div key={i} className="mono" style={{ fontSize: 12.5 }}>{a.amount != null ? a.amount.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'} {a.symbol || a.token?.slice(0, 8)}</div>)}
                  </div>
                )}
                {wh.received?.length > 0 && (
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="faint" style={{ fontSize: 11 }}>{t('explore.assetReceived')}</span>
                    {wh.received.map((a, i) => <div key={i} className="mono" style={{ fontSize: 12.5, color: 'var(--up)' }}>{a.amount != null ? a.amount.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'} {a.symbol || a.token?.slice(0, 8)}</div>)}
                  </div>
                )}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="faint" style={{ fontSize: 11 }}>{t('explore.network')}:</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700 }}>{wh.chainName}</span>
                  {wh.contract && <><span className="faint" style={{ fontSize: 11 }}>{t('explore.contract')}:</span><ShortAddr value={wh.contract} /></>}
                </div>
                <p className="faint" style={{ fontSize: 10.5, margin: 0, lineHeight: 1.6 }}>{t('explore.explainFootnote')}</p>
              </div>
            ) : wh.kind === 'approval' ? (
              <div className="stack" style={{ gap: 6 }}>
                <p style={{ fontWeight: 800, fontSize: 13.5, margin: 0 }}>{t('explore.explain.approvalTitle')}</p>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
                  <span className="faint">{t('explore.spender')}:</span>
                  {wh.spender ? <ShortAddr value={wh.spender} onClick={() => window.open(explorerAddr(d.chainId, wh.spender), '_blank', 'noopener,noreferrer')} /> : 'N/A'}
                </div>
                {wh.unlimited === true && <span className="pill pill-down" style={{ fontSize: 10, alignSelf: 'flex-start' }}>{t('explore.unlimitedAllowance')}</span>}
                <p className="faint" style={{ fontSize: 10.5, margin: 0 }}>{t('explore.explainApprovalNote')}</p>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/security?tab=approvals')} style={{ alignSelf: 'flex-start' }}>{t('explore.reviewApprovals')}</button>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                {wh.kind === 'transfer' && t('explore.explain.transfer', { amount: wh.amount, asset: wh.asset || '' })}
                {wh.kind === 'receive' && t('explore.explain.receive', { amount: wh.amount, asset: wh.asset || '' })}
                {wh.kind === 'native-transfer' && t('explore.explain.native', { amount: wh.amount, asset: wh.symbol })}
                {wh.kind === 'contract-call' && t('explore.explainPartial', { method: wh.method || '—' })}
              </p>
            )}
          </motion.section>

          {(d.tokenTransfers?.length > 0 || d.approvals?.length > 0) && (
            <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 15 }}>
              <p className="section-label" style={{ marginBottom: 6 }}>{t('explore.transfersAndEvents')}</p>
              {d.tokenTransfers.slice(0, 12).map((x, i) => (
                <div key={i} className="intel-row" style={{ fontSize: 12 }}>
                  <span className="mono" style={{ fontSize: 10.5, flexShrink: 0 }}>#{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{ fontSize: 12 }}>{x.amount} {x.symbol || 'ERC-20'}</strong>
                    <span className="faint"> · <ShortAddr value={x.from} size={3} /> → <ShortAddr value={x.to} size={3} /></span>
                  </span>
                </div>
              ))}
              {d.approvals.slice(0, 6).map((a, i) => (
                <div key={`ap-${i}`} className="intel-row" style={{ fontSize: 12 }}>
                  <span className="pill pill-neutral" style={{ fontSize: 9 }}>APPROVE</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="faint" style={{ fontSize: 11 }}>
                      <ShortAddr value={a.owner} size={3} /> → <ShortAddr value={a.spender} size={3} /> {a.symbol ? `(${a.symbol})` : ''}
                    </span>
                  </span>
                  {a.unlimited && <span className="pill pill-down" style={{ fontSize: 9 }}>{t('explore.unlimited')}</span>}
                </div>
              ))}
            </motion.section>
          )}
        </>
      )}
    </motion.div>
  );
}

/* ========================================================================== */
/* Tokens                                                                       */
/* ========================================================================== */

function TokensSection({ initial, goSecurity }) {
  const { t } = useTranslation();
  const registry = useIntel(() => exploreApi.registryTokens(), [], { intervalMs: 90_000 });
  const [lookup, setLookup] = useState({ addr: initial || '', chain: String(Object.keys(EVM_CHAINS)[0]), state: { status: 'idle', data: null, error: null } });

  const runLookup = useCallback(async () => {
    const addr = lookup.addr.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setLookup((s) => ({ ...s, state: { status: 'error', data: null, error: 'badInput' } }));
      return;
    }
    setLookup((s) => ({ ...s, state: { status: 'loading', data: null, error: null } }));
    try {
      const res = await exploreApi.token(addr, { chain: lookup.chain });
      setLookup((s) => ({ ...s, state: { status: 'ok', data: res, error: null } }));
    } catch (e) {
      setLookup((s) => ({ ...s, state: { status: 'error', data: null, error: intelErrorCode(e) } }));
    }
  }, [lookup.addr, lookup.chain]);

  const tokens = registry.data?.data?.tokens || [];
  const byChain = useMemo(() => {
    const map = new Map();
    for (const r of tokens) {
      if (!map.has(r.chainId)) map.set(r.chainId, []);
      map.get(r.chainId).push(r);
    }
    return [...map.entries()];
  }, [tokens]);

  const p = lookup.state.data?.data;

  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 15 }}>
        <p className="section-label" style={{ marginBottom: 8 }}>{t('explore.tokenLookup')}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            dir="ltr" value={lookup.addr}
            onChange={(e) => setLookup((s) => ({ ...s, addr: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') runLookup(); }}
            placeholder={t('explore.tokenPlaceholder')} spellCheck={false} aria-label={t('explore.tokenAria')}
            className="intel-input" style={{ flex: 2, minWidth: 160 }}
          />
          <select value={lookup.chain} onChange={(e) => setLookup((s) => ({ ...s, chain: e.target.value }))} aria-label={t('explore.chain')} style={{ flex: 1, minWidth: 92 }}>
            {Object.values(EVM_CHAINS).map((c) => <option key={c.id} value={c.id}>{c.short || c.name}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={runLookup} disabled={lookup.state.status === 'loading'}>{t('explore.searchBtn')}</button>
        </div>
        {lookup.state.status === 'error' && <ErrorState code={lookup.state.error} onRetry={runLookup} t={t} />}
        {lookup.state.status === 'loading' && <LoadingState />}
        {lookup.state.status === 'ok' && p && (
          <div style={{ marginTop: 10 }}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 14 }}>{p.symbol || '?'}</span>
              <span className="faint" style={{ fontSize: 11.5 }}>{p.name} · {p.chainName}</span>
              {p.registry && <span className="pill pill-up" style={{ fontSize: 9 }}>{t('explore.registryListed')}</span>}
              {p.contractVerified === true ? <span className="pill pill-up" style={{ fontSize: 9 }}>{t('explore.verified')}</span> : p.contractVerified === null && <span className="pill pill-neutral" style={{ fontSize: 9 }}>{t('explore.verifyUnknown')}</span>}
            </div>
            <div className="intel-stat-grid">
              <StatTile label={t('explore.decimals')} value={p.decimals} />
              <StatTile label={t('explore.totalSupply')} value={p.totalSupply != null ? fmtCompact(Number(p.totalSupply)) : null} />
              <StatTile label={t('explore.price')} value={p.market?.priceUsd != null ? fmtUsd(p.market.priceUsd) : null} sub={p.market?.change24h != null ? fmtPct(p.market.change24h, 2) : undefined} />
              <StatTile label={t('explore.liquidity')} value={p.liquidityUsd != null ? fmtUsd(p.liquidityUsd) : null} />
              <StatTile label={t('explore.holders')} value={p.holders} />
              <StatTile label={t('explore.top10')} value={p.top10Share != null ? `${Math.round(p.top10Share * 100)}%` : null} />
              <StatTile label={t('explore.buyTax')} value={p.buyTaxPct != null ? `${p.buyTaxPct.toFixed(1)}%` : null} />
              <StatTile label={t('explore.sellTax')} value={p.sellTaxPct != null ? `${p.sellTaxPct.toFixed(1)}%` : null} />
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <span className="faint" style={{ fontSize: 11 }}>{t('explore.contract')}:</span>
              <ShortAddr value={p.address} onClick={() => window.open(explorerAddr(p.chainId, p.address), '_blank', 'noopener,noreferrer')} />
              {p.lpLocked != null && <span className={`pill ${p.lpLocked ? 'pill-up' : 'pill-down'}`} style={{ fontSize: 9 }}>{t(p.lpLocked ? 'explore.lpLocked' : 'explore.lpUnlocked')}</span>}
              {p.honeypot === true && <span className="pill pill-down" style={{ fontSize: 9 }}>{t('explore.honeypotFlag')}</span>}
            </div>
            <Notices notices={lookup.state.data?.notices} />
            <MetaLine meta={lookup.state.data?.meta} />
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => goSecurity(`/security?tab=tokens&chain=${p.chainId}&addr=${p.address}`)}>
                <IconShield width={13} height={13} /> {t('explore.analyzeSecurity')}
              </button>
            </div>
          </div>
        )}
      </motion.section>

      <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 15 }}>
        <div className="row-between">
          <p className="section-label" style={{ margin: 0 }}>{t('explore.registryTokens')}</p>
          <button className="icon-btn" style={{ padding: 6 }} aria-label={t('common.refresh')} onClick={registry.reload}><IconRefresh width={13} height={13} className={registry.loading ? 'intel-spin' : undefined} /></button>
        </div>
        {registry.loading && !registry.data && <LoadingState />}
        {registry.error && <ErrorState code={intelErrorCode(registry.error)} onRetry={registry.reload} t={t} />}
        {registry.data && (
          <>
            <p className="faint" style={{ fontSize: 10.5, margin: '4px 0 8px' }}>{t('explore.registryNote')}</p>
            {byChain.map(([chainId, list]) => (
              <div key={chainId} style={{ marginBottom: 8 }}>
                <div className="row" style={{ gap: 6, margin: '6px 0 2px' }}>
                  <ChainDot color={EVM_CHAINS[chainId]?.color} short={EVM_CHAINS[chainId]?.name || `Chain ${chainId}`} />
                </div>
                {list.map((tk) => (
                  <div key={`${chainId}-${tk.symbol}`} className="intel-row">
                    <span className="intel-avatar intel-avatar-sm" style={{ background: 'linear-gradient(135deg, var(--rgb-2), var(--rgb-1))' }}>{(tk.symbol || '?').slice(0, 3)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 700, fontSize: 12.2 }}>{tk.symbol}</span>
                      <span className="faint" style={{ fontSize: 10 }}>{tk.name}</span>
                    </span>
                    <span style={{ textAlign: 'end', flexShrink: 0 }}>
                      <span className="mono" style={{ fontSize: 11.5 }}>{tk.priceUsd != null ? fmtUsd(tk.priceUsd) : <span className="faint">N/A</span>}</span>
                      {tk.change24h != null && (
                        <span className="mono" style={{ fontSize: 10, display: 'block', color: tk.change24h >= 0 ? 'var(--up)' : 'var(--down)' }}>{fmtPct(tk.change24h, 2)}</span>
                      )}
                    </span>
                    {tk.address && (
                      <button type="button" className="icon-btn" style={{ padding: 5 }} aria-label={t('explore.details')} onClick={() => { setLookup((s) => ({ ...s, addr: tk.address, chain: String(chainId) })); }}>
                        <IconChevronLeft width={13} height={13} style={{ transform: 'rotate(180deg)' }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
            <MetaLine meta={registry.data?.meta} />
          </>
        )}
      </motion.section>
    </motion.div>
  );
}

/* ========================================================================== */
/* Contracts                                                                    */
/* ========================================================================== */

function ContractsSection({ initial, goSecurity }) {
  const { t } = useTranslation();
  const [addr, setAddr] = useState(initial || '');
  const [chain, setChain] = useState(String(Object.keys(EVM_CHAINS)[0]));
  const [state, setState] = useState({ status: 'idle', data: null, error: null });

  const run = useCallback(async () => {
    const a = addr.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(a)) { setState({ status: 'error', data: null, error: 'badInput' }); return; }
    setState({ status: 'loading', data: null, error: null });
    try {
      const res = await exploreApi.contract(a, { chain });
      setState({ status: 'ok', data: res, error: null });
    } catch (e) {
      setState({ status: 'error', data: null, error: intelErrorCode(e) });
    }
  }, [addr, chain]);

  useEffect(() => {
    if (initial && /^0x[a-fA-F0-9]{40}$/.test(initial)) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const c = state.data?.data;
  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input dir="ltr" value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }} placeholder={t('explore.contractPlaceholder')} spellCheck={false} aria-label={t('explore.contractAria')} className="intel-input" style={{ flex: 2, minWidth: 160 }} />
          <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label={t('explore.chain')} style={{ flex: 1, minWidth: 92 }}>
            {Object.values(EVM_CHAINS).map((x) => <option key={x.id} value={x.id}>{x.short || x.name}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={run} disabled={state.status === 'loading'}>{t('explore.searchBtn')}</button>
        </div>
        {state.status === 'loading' && <LoadingState />}
        {state.status === 'error' && <ErrorState code={state.error} onRetry={run} t={t} />}
        {state.status === 'ok' && c && (
          <div className="stack" style={{ gap: 4, marginTop: 10 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span className="pill pill-neutral" style={{ fontSize: 10 }}>{t('explore.contractTypeLabel')}: {c.hasCode ? t(`explore.contractType.${c.contractType}`) : t('explore.noCode')}</span>
              {c.isProxy ? <span className="pill pill-down" style={{ fontSize: 9.5 }}>{t('explore.isProxy', { kind: c.proxyKind || '' })}</span> : c.hasCode ? <span className="pill pill-up" style={{ fontSize: 9.5 }}>{t('explore.noProxySlot')}</span> : null}
              {c.verified === true && <span className="pill pill-up" style={{ fontSize: 9.5 }}>{t('explore.verified')}</span>}
              {c.verified === false && <span className="pill pill-neutral" style={{ fontSize: 9.5 }}>{t('explore.unverified')}</span>}
            </div>
            <CopyRow label={t('explore.contract')} value={c.address} onOpen={() => window.open(c.explorer, '_blank', 'noopener,noreferrer')} />
            <CopyRow label={t('explore.network')} value={c.chainName} mono={false} />
            <CopyRow label={t('explore.codeSize')} value={c.hasCode ? `${c.codeSize} B` : null} />
            <CopyRow label={t('explore.implementation')} value={c.implementation} onOpen={c.implementation ? () => window.open(explorerAddr(c.chainId, c.implementation), '_blank', 'noopener,noreferrer') : undefined} />
            <CopyRow label={t('explore.admin')} value={c.admin} onOpen={c.admin ? () => window.open(explorerAddr(c.chainId, c.admin), '_blank', 'noopener,noreferrer') : undefined} />
            <CopyRow label={t('explore.owner')} value={c.owner} onOpen={c.owner ? () => window.open(explorerAddr(c.chainId, c.owner), '_blank', 'noopener,noreferrer') : undefined} />
            <CopyRow label={t('explore.pausedState')} value={c.paused === true ? t('intel.yes') : c.paused === false ? t('intel.no') : null} mono={false} />
            <CopyRow label={t('explore.creator')} value={c.creator} onOpen={c.creator ? () => window.open(explorerAddr(c.chainId, c.creator), '_blank', 'noopener,noreferrer') : undefined} />
            <CopyRow label={t('explore.createdAt')} value={c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : null} />
            {c.activity && (
              <CopyRow label={t('explore.windowActivity')} value={`${c.activity.transfersSeen} · ${c.activity.lastAt ? timeAgo(c.activity.lastAt, 'en') : ''}`} mono={false} />
            )}
            <Notices notices={state.data?.notices} />
            <MetaLine meta={state.data?.meta} />
            {(c.verificationNote === 'no-explorer-key' || c.explorerKeyConfigured === false) && (
              <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.65, margin: '6px 0 0' }}>{t('explore.explorerKeyNote')}</p>
            )}
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => goSecurity(`/security?tab=contracts&chain=${c.chainId}&addr=${c.address}`)}>
                <IconShield width={13} height={13} /> {t('explore.analyzeSecurity')}
              </button>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => openUrl(c.explorer)}>
                <IconExternal width={13} height={13} /> {t('explore.openOn')} {EVM_CHAINS[c.chainId]?.short}
              </button>
            </div>
          </div>
        )}
        <p className="faint" style={{ fontSize: 10.5, margin: '10px 2px 0', lineHeight: 1.6 }}>{t('explore.contractNote')}</p>
      </motion.section>
    </motion.div>
  );
}

/* ========================================================================== */
/* Protocols + trending                                                         */
/* ========================================================================== */

const PROTO_BUCKETS = [
  { id: 'all', label: '⭐' },
  { id: 'trending', label: '🔥' },
  { id: 'rising', label: '🚀' },
  { id: 'highLiquidity', label: '💧' },
  { id: 'highActivity', label: '📈' },
  { id: 'fresh', label: '🆕' },
  { id: 'popular', label: '⭐' }
];

const PROTO_CATEGORIES = ['All', 'DEX', 'Lending', 'Yield', 'Liquid Staking', 'CDP', 'Bridge', 'Derivatives', 'Options', 'Restaking', 'Staking'];

function ProtocolsSection({ initialQuery, goSecurity }) {
  const { t, i18n } = useTranslation();
  const [bucket, setBucket] = useState('trending');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('tvl');
  const [q, setQ] = useState(initialQuery || '');
  const [open, setOpen] = useState(null); // expanded slug
  const trending = useIntel(() => exploreApi.trending(), [], { intervalMs: 5 * 60_000 });
  const list = useIntel(
    () => exploreApi.protocols({ q: q.trim() || undefined, category: category !== 'All' ? category : undefined, sort, limit: 48 }),
    [category, sort, q],
    { intervalMs: 0 }
  );
  const detail = useIntel(() => (open ? exploreApi.protocol(open) : Promise.resolve(null)), [open], { auto: false });

  useEffect(() => {
    if (open) detail.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const bucketRows = bucket === 'all' ? null : trending.data?.data?.[bucket] || null;
  const rows = bucketRows
    ?? (list.data?.data?.protocols || []).map((p) => ({ ...p, tvl: p.tvl }));
  const listLoading = bucket === 'all' && list.loading && !list.data;
  const listError = bucket === 'all' && list.error ? intelErrorCode(list.error) : trending.error && bucket !== 'all' ? intelErrorCode(trending.error) : null;

  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 14 }}>
        <div className="intel-chips" role="tablist" aria-label={t('explore.trendingBuckets')}>
          {PROTO_BUCKETS.map((b) => (
            <button key={b.id} role="tab" aria-pressed={bucket === b.id} className="intel-chip" onClick={() => setBucket(b.id)}>
              <span aria-hidden="true">{b.label}</span> {t(`explore.bucket.${b.id}`)}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input dir="ltr" value={q} onChange={(e) => { setQ(e.target.value); setBucket('all'); }} placeholder={t('explore.protoSearch')} aria-label={t('explore.protoSearchAria')} className="intel-input" style={{ flex: 2, minWidth: 140 }} />
          <select value={category} onChange={(e) => { setCategory(e.target.value); setBucket('all'); }} aria-label={t('explore.category')} style={{ flex: 1, minWidth: 110 }}>
            {PROTO_CATEGORIES.map((c) => <option key={c} value={c}>{c === 'All' ? t('explore.catAll') : c}</option>)}
          </select>
          {bucket === 'all' && (
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('explore.sortBy')} style={{ minWidth: 90 }}>
              <option value="tvl">TVL</option>
              <option value="volume">{t('explore.col.volume')}</option>
              <option value="change">24h</option>
            </select>
          )}
        </div>
        {bucket !== 'all' && (
          <p className="faint" style={{ fontSize: 10.5, margin: '8px 2px 0', lineHeight: 1.6 }}>
            {t('explore.trendRankingNote')}
            {trending.data?.meta ? ` · ${timeAgo(Date.parse(trending.data.meta.updatedAt), i18n.language)}` : ''}
          </p>
        )}
      </motion.section>

      {listLoading && <LoadingState label={t('explore.protoLoading')} />}
      {listError && <ErrorState code={listError} onRetry={() => (bucket === 'all' ? list.reload() : trending.reload())} t={t} />}
      {!listLoading && !listError && rows.length === 0 && (
        <EmptyState icon="◍" title={t('explore.protoEmpty')} note={t('explore.protoEmptyNote')} />
      )}

      {rows.length > 0 && (
        <div className="intel-proto-grid">
          {rows.map((p) => (
            <motion.button
              key={p.slug}
              type="button"
              className="docs-card"
              data-open={open === p.slug}
              data-clickable="true"
              variants={riseIn}
              onClick={() => setOpen(open === p.slug ? null : p.slug)}
              style={{ '--card-hue': 'var(--rgb-2)', textAlign: 'start', cursor: 'pointer', width: '100%', padding: 14, color: 'inherit' }}
            >
              <div className="row" style={{ gap: 10 }}>
                <span className="intel-avatar" style={{ background: 'linear-gradient(135deg, var(--rgb-2), var(--rgb-1))' }}>
                  {p.icon ? <img src={p.icon} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : (p.name || '?').slice(0, 2).toUpperCase()}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <span className="faint" style={{ fontSize: 10.5 }}>{p.category || '—'} · {(p.chains || []).slice(0, 3).join(' · ')}{(p.chains || []).length > 3 ? ` +${p.chains.length - 3}` : ''}</span>
                </span>
                {p.dead && <span className="pill pill-down" style={{ fontSize: 9 }}>{t('explore.protoInactive')}</span>}
                {p.integrated && <span className="pill pill-up" style={{ fontSize: 9 }}>{t('explore.protoFbt')}</span>}
              </div>
              <div className="intel-stat-grid" style={{ marginTop: 10, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                <StatTile label="TVL" value={p.tvl != null ? fmtCompact(p.tvl) : null} />
                <StatTile label={t('explore.col.volume')} value={p.volume_24h != null ? fmtCompact(p.volume_24h) : null} />
                <StatTile label="24h" value={p.change_1d != null ? fmtPct(p.change_1d, 1) : null} mono={false} />
              </div>
              {open === p.slug && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  {p.description && <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.7, margin: '0 0 8px' }}>{p.description}</p>}
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span className="faint" style={{ fontSize: 10.5 }}>{t('explore.users')}:</span>
                    <span className="faint mono" style={{ fontSize: 10.5 }}>N/A</span>
                    {p.audits != null && (
                      <>
                        <span className="faint" style={{ fontSize: 10.5 }}>{t('explore.audits')}:</span>
                        <span className="mono" style={{ fontSize: 10.5 }}>{p.audits}</span>
                      </>
                    )}
                  </div>
                  {detail.loading && open === p.slug && <LoadingState label={t('explore.protoDetail')} />}
                  {detail.data && open === p.slug && (
                    <ProtocolDetailBlock detail={detail.data} slug={p.slug} t={t} />
                  )}
                  <div className="row" style={{ gap: 8 }}>
                    {p.url && (
                      <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); openUrl(p.url); }}>
                        <IconExternal width={13} height={13} /> {t('explore.openSite')}
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); goSecurity(`/security?tab=protocols&protocol=${p.slug}`); }}>
                      <IconShield width={13} height={13} /> {t('explore.protoSecurity')}
                    </button>
                  </div>
                </div>
              )}
            </motion.button>
          ))}
        </div>
      )}
      {rows.length > 0 && <MetaLine meta={(bucket === 'all' ? list.data?.meta : trending.data?.meta)} />}
    </motion.div>
  );
}

function ProtocolDetailBlock({ detail, slug, t }) {
  const d = detail?.data;
  if (!d) return null;
  const auditCount = Number(d.audits ?? 0);
  return (
    <div className="stack" style={{ gap: 6, marginBottom: 8 }}>
      {d.tvl != null && <div className="row-between"><span className="faint" style={{ fontSize: 11 }}>TVL (feed)</span><span className="mono" style={{ fontSize: 11 }}>{fmtUsd(d.tvl)}</span></div>}
      {d.change_7d != null && <div className="row-between"><span className="faint" style={{ fontSize: 11 }}>7d TVL Δ</span><span className="mono" style={{ fontSize: 11, color: d.change_7d >= 0 ? 'var(--up)' : 'var(--down)' }}>{fmtPct(d.change_7d, 1)}</span></div>}
      <div className="row-between">
        <span className="faint" style={{ fontSize: 11 }}>{t('explore.auditStatus')}</span>
        <span className="mono" style={{ fontSize: 11 }}>{auditCount > 0 ? `✓ ${auditCount}` : '—'}</span>
      </div>
      {Array.isArray(d.auditLinks) && d.auditLinks.slice(0, 3).map((link) => (
        <button key={link} type="button" className="intel-link" style={{ textAlign: 'start' }} onClick={(e) => { e.stopPropagation(); openUrl(link); }}>
          {String(link).replace(/^https?:\/\//, '').slice(0, 44)}
        </button>
      ))}
      {d.listingDate && (
        <div className="row-between"><span className="faint" style={{ fontSize: 11 }}>{t('explore.listed')}</span><span className="mono" style={{ fontSize: 11 }}>{new Date(d.listingDate * 1000).toISOString().slice(0, 10)}</span></div>
      )}
      <p className="faint" style={{ fontSize: 10, margin: 0 }}>{t('explore.auditNotSafe', { name: d.name || slug })}</p>
    </div>
  );
}

export { parseScanned };
