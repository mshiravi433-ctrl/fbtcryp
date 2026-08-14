import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fetchWhales } from '../lib/whales';
import { EVM_CHAINS, EVM_CHAIN_ORDER } from '../lib/chains';
import { useSettingsStore } from '../store/useSettingsStore';
import { vsOf, currencyOf } from '../lib/currency';
import { fmtPrice } from '../lib/format';
import { IconExternal, IconSearch } from './Icons';

const IconRefresh = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>
  </svg>
);

const CHAIN_OPTIONS = [{ id: 'all', short: 'ALL' }, ...EVM_CHAIN_ORDER.map((id) => ({ id, short: EVM_CHAINS[id].short, color: EVM_CHAINS[id].color }))];

const THRESHOLD_PRESETS = [
  { id: '10k', value: 10_000, labelKey: 'whales.threshold.10k' },
  { id: '100k', value: 100_000, labelKey: 'whales.threshold.100k' },
  { id: '1m', value: 1_000_000, labelKey: 'whales.threshold.1m' },
  { id: '10m', value: 10_000_000, labelKey: 'whales.threshold.10m' }
];

const TIME_PRESETS = [
  { id: '1h', ms: 60 * 60 * 1000, labelKey: 'whales.time.1h' },
  { id: '6h', ms: 6 * 60 * 60 * 1000, labelKey: 'whales.time.6h' },
  { id: '24h', ms: 24 * 60 * 60 * 1000, labelKey: 'whales.time.24h' },
  { id: 'all', ms: 0, labelKey: 'whales.time.all' }
];

function currencyValue(v, currency) {
  if (v == null || !Number.isFinite(v)) return null;
  const sym = currency.symbol;
  return `${sym}${fmtPrice(v)}`;
}

function formatAmount(amount, symbol) {
  if (!Number.isFinite(amount)) return '—';
  const abs = Math.abs(amount);
  let str;
  if (abs >= 1_000_000) str = (amount / 1_000_000).toFixed(2) + 'M';
  else if (abs >= 1000) str = (amount / 1000).toFixed(2) + 'K';
  else if (abs < 0.0001) str = amount.toExponential(2);
  else if (abs < 1) str = amount.toFixed(4);
  else str = amount.toFixed(2);
  return `${str} ${symbol}`;
}

function short(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgoLocal(ts, locale) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale || 'en', { numeric: 'auto' });
  if (diff < 60) return rtf.format(-diff, 'second');
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour');
  return rtf.format(-Math.floor(diff / 86400), 'day');
}

export default function WhaleTrackingPanel() {
  const { t, i18n } = useTranslation();
  const currencyCode = useSettingsStore((s) => s.currency);
  const currency = currencyOf(currencyCode);
  const vs = vsOf(currencyCode);

  const [minUsd, setMinUsd] = useState(100_000);
  const [chainFilter, setChainFilter] = useState('all');
  const [timeMs, setTimeMs] = useState(6 * 3600 * 1000);
  const [query, setQuery] = useState('');

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [stale, setStale] = useState(false);
  const [partial, setPartial] = useState(false);
  const [pricedCount, setPricedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const abortRef = useRef(null);
  const alive = useRef(true);

  const chainsParam = useMemo(
    () => (chainFilter === 'all' ? [] : [String(chainFilter)]),
    [chainFilter]
  );

  const load = useCallback(
    async ({ force = false } = {}) => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      if (force) setRefreshing(true);
      setError(null);
      setRateLimited(false);

      try {
        const since = timeMs ? Date.now() - timeMs : 0;
        const data = await fetchWhales({
          minUsd,
          chains: chainsParam,
          q: query.trim(),
          since,
          vs,
          limit: 50
        }, ctrl.signal);
        if (!alive.current) return;
        setEvents(data.events || []);
        setUpdatedAt(data.at || Date.now());
        setPartial(Boolean(data.partial));
        setPricedCount(data.pricedCount || 0);
        setTotalCount(data.total || (data.events?.length || 0));
        setStale(false);
      } catch (err) {
        if (!alive.current) return;
        if (err?.status === 429) setRateLimited(true);
        else if (err?.message !== 'ABORTED') setError(err?.message || 'WHALES_FAILED');
      } finally {
        if (alive.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [minUsd, chainsParam, query, timeMs, vs]
  );

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 120_000); // 2 min
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Stale indicator after 2.5 minutes since last successful fetch
  useEffect(() => {
    if (!updatedAt) return undefined;
    const id = setInterval(() => {
      if (Date.now() - updatedAt > 150_000) setStale(true);
    }, 30_000);
    return () => clearInterval(id);
  }, [updatedAt]);

  const openTx = (e) => {
    if (e?.explorerTx) window.open(e.explorerTx, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="whales-panel">
      {/* Filter bar */}
      <motion.div className="card card-tight whales-controls" variants={riseInCompat} initial="hidden" animate="show">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <span className="faint" style={{ fontSize: 11 }}>
            {updatedAt
              ? t('whales.updated', { ago: timeAgoLocal(updatedAt, i18n.language) })
              : t('whales.loading')}
            {stale && <span className="whales-stale"> · {t('whales.stale')}</span>}
          </span>
          <button
            className="btn btn-sm btn-ghost"
            style={{ width: 'auto' }}
            onClick={() => load({ force: true })}
            disabled={refreshing || loading}
            aria-label={t('whales.refresh')}
          >
            <IconRefresh width={13} height={13} style={{ marginInlineEnd: 4 }} />
            {refreshing ? t('common.loading') : t('whales.refresh')}
          </button>
        </div>

        {/* Token search */}
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <span className="icon-btn" style={{ pointerEvents: 'none' }}>
            <IconSearch width={14} height={14} />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('whales.searchToken')}
            style={{ flex: 1 }}
            aria-label={t('whales.searchToken')}
          />
        </div>

        {/* Chain filter */}
        <div className="tag-scroll" style={{ marginBottom: 6 }}>
          {CHAIN_OPTIONS.map((c) => (
            <button
              key={c.id}
              className={`tag ${chainFilter === c.id ? 'active' : ''}`}
              onClick={() => setChainFilter(c.id)}
              style={c.color ? { '--chip-color': c.color } : undefined}
            >
              {c.id === 'all' ? t('whales.allChains') : c.short}
            </button>
          ))}
        </div>

        {/* Threshold */}
        <div className="tag-scroll" style={{ marginBottom: 6 }}>
          {THRESHOLD_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`tag ${minUsd === p.value ? 'active' : ''}`}
              onClick={() => setMinUsd(p.value)}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>

        {/* Time range */}
        <div className="tag-scroll">
          {TIME_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`tag ${timeMs === p.ms ? 'active' : ''}`}
              onClick={() => setTimeMs(p.ms)}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>

        {partial && (
          <p className="faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            {t('whales.partial')}
          </p>
        )}
        {pricedCount < totalCount && totalCount > 0 && (
          <p className="faint" style={{ fontSize: 11, marginTop: 4, marginBottom: 0 }}>
            {t('whales.coverage', { priced: pricedCount, total: totalCount })}
          </p>
        )}
      </motion.div>

      {/* Events */}
      <AnimatePresence mode="wait">
        {loading && !events.length ? (
          <motion.div key="skel" className="stack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skel" style={{ height: 88, borderRadius: 16 }} />
            ))}
          </motion.div>
        ) : error ? (
          <motion.div key="err" className="empty whales-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <span className="empty-icon">⚠</span>
            <div>{t('whales.error')}</div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>{t('whales.errorBody')}</p>
            <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} onClick={() => load({ force: true })}>
              {t('whales.retry')}
            </button>
          </motion.div>
        ) : rateLimited ? (
          <motion.div key="rl" className="empty whales-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <span className="empty-icon">⏱</span>
            <div>{t('whales.rateLimited')}</div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>{t('whales.rateLimitedBody')}</p>
          </motion.div>
        ) : !events.length ? (
          <motion.div key="empty" className="empty whales-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <span className="empty-icon">🐋</span>
            <div>{t('whales.empty')}</div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>{t('whales.emptyBody')}</p>
          </motion.div>
        ) : (
          <motion.div
            key="list"
            className="stack whale-list"
            style={{ gap: 9 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {events.map((e) => (
              <WhaleEvent key={e.id} event={e} currency={currency} onOpen={openTx} t={t} i18n={i18n} />
            ))}
            <p className="prose-sm" style={{ textAlign: 'center', marginTop: 10, fontSize: 11 }}>
              {t('whales.disclaimer')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function WhaleEvent({ event: e, currency, onOpen, t, i18n }) {
  const kindLabel = t(`whales.kind.${e.kind}`);
  const kindClass = `whale-kind whale-kind-${e.kind}`;
  const valueStr = e.valueUsd != null ? currencyValue(e.valueUsd, currency) : null;

  return (
    <motion.article
      className="docs-card whale-card"
      whileTap={{ scale: 0.985 }}
      onClick={() => onOpen(e)}
      style={{ cursor: e.explorerTx ? 'pointer' : 'default', padding: 14 }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="row-between" style={{ marginBottom: 7 }}>
        <span className="row" style={{ gap: 6, minWidth: 0 }}>
          <span className="whale-chain-dot" style={{ background: e.chainColor || 'var(--rgb-1)' }} aria-hidden="true" />
          <span className="mono" style={{ fontSize: 10.5, fontWeight: 800 }}>{e.chainShort}</span>
          <span className={kindClass} style={{ fontSize: 10 }}>{kindLabel}</span>
          {!e.token.verified && e.token.address && (
            <span className="pill" style={{ fontSize: 9, opacity: 0.7 }}>{t('whales.unverified')}</span>
          )}
        </span>
        <span className="faint mono" style={{ fontSize: 10.5 }}>
          {timeAgoLocal(e.timestamp, i18n.language)}
        </span>
      </div>

      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: -0.2 }}>
            {formatAmount(e.amount, e.token.symbol)}
          </div>
          <div className="faint" style={{ fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {e.token.name}
          </div>
        </div>
        <div style={{ textAlign: 'end', flexShrink: 0 }}>
          <div className="mono" style={{ fontWeight: 900, fontSize: 14 }}>
            {valueStr ?? <span className="faint" style={{ fontWeight: 600 }}>{t('whales.noPrice')}</span>}
          </div>
          {valueStr && (
            <div className="faint" style={{ fontSize: 10, marginTop: 2 }}>{t('whales.estimated')}</div>
          )}
        </div>
      </div>

      <div className="whale-flow" style={{ marginTop: 9 }}>
        <AddressChip addr={e.from} explorer={e.explorerFrom} t={t} />
        <span className="whale-arrow" aria-hidden="true">→</span>
        <AddressChip addr={e.to} explorer={e.explorerTo} t={t} />
      </div>

      {e.explorerTx && (
        <div className="row" style={{ gap: 5, marginTop: 8, color: 'var(--rgb-1)', fontSize: 11 }}>
          <IconExternal width={12} height={12} />
          <span className="mono">{short(e.hash)}</span>
        </div>
      )}
    </motion.article>
  );
}

function AddressChip({ addr, explorer, t }) {
  if (!addr?.address) {
    return <span className="whale-addr"><span className="faint">—</span></span>;
  }
  const label = addr.label || t('whales.unknown');
  const isUnknown = !addr.label;
  return (
    <a
      className={`whale-addr ${isUnknown ? 'is-unknown' : ''}`}
      href={explorer || '#'}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(ev) => ev.stopPropagation()}
      title={addr.address}
    >
      {isUnknown && <span className="whale-addr-dot" aria-hidden="true" />}
      <span className="whale-addr-label">{label}</span>
      <span className="whale-addr-hash mono">{addr.short || short(addr.address)}</span>
    </a>
  );
}

// framer-motion riseIn copied lazily to avoid circular import at module load
const riseInCompat = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28 } }
};
