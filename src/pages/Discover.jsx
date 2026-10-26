import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import Sheet from '../components/Sheet';
import InfoBox from '../components/InfoBox';
import AssetIcon from '../components/AssetIcon';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { useAppStore } from '../store/useAppStore';
import { openUrl } from '../lib/browser';
import {
  IconChevronLeft, IconChevronRight, IconCopy, IconExternal, IconSearch, IconShield,
  IconStar, IconTrend, IconClock, IconX, IconGlobe, IconSparkle, IconCheck, IconAlertTriangle
} from '../components/Icons';
import { exploreApi, intelErrorCode } from '../lib/intelApi';
import { fmtCompact, fmtUsd, timeAgo } from '../lib/format';
import {
  DISCOVERY_CATEGORIES, DISCOVERY_PROTOCOLS, NETWORK_FILTERS, CHAIN_ALIASES, hostOf
} from '../lib/discoveryRegistry';
import { discoveryProtocolSvg } from '../lib/discoveryLogos';
import { parseAiQuery, aiExamplesFor } from '../lib/discoveryAi';
import { buildSuggestions, rankProtocols, smartSummary } from '../lib/discoverySearch';
import { descriptionFor, chainLabel } from '../lib/discoveryLocalized';
import { validateDiscoveryUrl, chainSupportWarnings, auditNotice, isRegistryDomain } from '../lib/discoverySecurity';
import '../styles/discovery-center.css';

// ── Storage ─────────────────────────────────────────────────────────────
const FAV_KEY = 'fbt.discovery.favs.v1';
const RECENT_KEY = 'fbt.discovery.recent.v2';
const QUERY_KEY = 'fbt.discovery.queries.v1';
const LEGACY_RECENT = 'fbt.discover.recent.v1';
const RECENT_MAX = 12;
const FAV_MAX = 40;
const PAGE_SIZE = 12;

const SORT_IDS = ['trending', 'tvl', 'volume', 'name', 'favorites', 'new'];

/** Map filter ids & human chain names to `AssetIcon` `NETWORK_SVG` keys. */
const CHAIN_TO_ASSET_KEY = Object.freeze({
  eth: 1,
  ethereum: 1,
  bsc: 56,
  'bnb smart chain': 56,
  'bnb chain': 56,
  arbitrum: 42161,
  'arbitrum one': 42161,
  base: 8453,
  polygon: 137,
  optimism: 10,
  avalanche: 43114,
  sonic: 146,
  linea: 59144,
  solana: 'solana',
  bitcoin: 'bitcoin'
});

function resolveChainAssetKey(chainOrFilter) {
  if (chainOrFilter == null || chainOrFilter === 'all') return null;
  if (typeof chainOrFilter === 'object') {
    if (chainOrFilter.id === 'all') return null;
    if (chainOrFilter.chainId != null) return chainOrFilter.chainId;
    return CHAIN_TO_ASSET_KEY[String(chainOrFilter.id || '').toLowerCase()] || null;
  }
  if (typeof chainOrFilter === 'number') return chainOrFilter;
  const k = String(chainOrFilter).trim().toLowerCase();
  return CHAIN_TO_ASSET_KEY[k] || k;
}

function loadArray(key, validator) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(raw)) return [];
    return validator ? raw.filter(validator) : raw;
  } catch { return []; }
}
const loadFavs = () => loadArray(FAV_KEY, (x) => typeof x === 'string');
const loadQueries = () => loadArray(QUERY_KEY, (x) => typeof x === 'string' && x.trim().length > 0).slice(0, 5);
function loadRecents() {
  try {
    const cur = localStorage.getItem(RECENT_KEY);
    if (!cur) {
      const leg = localStorage.getItem(LEGACY_RECENT);
      if (leg) localStorage.setItem(RECENT_KEY, leg);
    }
  } catch { /* private mode */ }
  const allowed = new Set(DISCOVERY_PROTOCOLS.map((p) => p.id));
  return loadArray(RECENT_KEY, (x) => allowed.has(x)).slice(0, RECENT_MAX);
}
function rememberQuery(raw) {
  const q = String(raw || '').trim();
  if (!q) return loadQueries();
  try {
    const next = [q, ...loadQueries().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 5);
    localStorage.setItem(QUERY_KEY, JSON.stringify(next));
    return next;
  } catch { return loadQueries(); }
}

/** Crisp category vector glyphs (no <title> tag so tab textContent stays pure). */
function CategoryIcon({ id }) {
  switch (id) {
    case 'all':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="2.2" y="2.2" width="5.6" height="5.6" rx="1.7" stroke="currentColor" strokeWidth="1.6" />
          <rect x="10.2" y="2.2" width="5.6" height="5.6" rx="1.7" stroke="currentColor" strokeWidth="1.6" />
          <rect x="2.2" y="10.2" width="5.6" height="5.6" rx="1.7" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="13" cy="13" r="2.8" fill="currentColor" fillOpacity="0.24" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case 'defi':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M9 2.1 14.8 5.4v6.6L9 15.3 3.2 12V5.4L9 2.1Z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
          <circle cx="9" cy="8.7" r="2.1" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 2.1v4.5M14.8 12l-3.9-2.2M3.2 12l3.9-2.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
      );
    case 'dex':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M3 6.2h11.5L11.7 3.4M15 11.8H3.5l2.8 2.8" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'lending':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M9 2.3 15.6 5.6v1.5H2.4V5.6L9 2.3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M4.5 7.2v5.6M9 7.2v5.6M13.5 7.2v5.6M2.4 15.2h13.2" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
        </svg>
      );
    case 'yield':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M2.6 13.2 7 8.8l3 2.8 5.4-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11.6 5.6h3.8v3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'bridges':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M2.2 13.2c1.8-4.5 4.4-6.8 6.8-6.8s5 2.3 6.8 6.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M1.8 13.2h14.4M5.6 9v4.2M9 6.6v6.6M12.4 9v4.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
        </svg>
      );
    case 'analytics':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M3.5 14.5V9.8M7.2 14.5V5.6M10.8 14.5V8.2M14.5 14.5V3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'rwa':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="6.4" stroke="currentColor" strokeWidth="1.55" />
          <ellipse cx="9" cy="9" rx="2.9" ry="6.4" stroke="currentColor" strokeWidth="1.35" />
          <path d="M2.8 9h12.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
      );
    case 'nft':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M5.4 3.2h7.2l3.1 3.8L9 15.2 2.3 7l3.1-3.8Z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
          <path d="M2.5 7h13M9 15V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case 'dev':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M6.2 5.5 2.6 9l3.6 3.5M11.8 5.5 15.4 9l-3.6 3.5M10.2 3.8 7.8 14.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return <IconSparkle width={14} height={14} />;
  }
}

/** Crisp sort-mode vector glyphs for the custom Sort trigger & popover. */
function SortIcon({ id }) {
  switch (id) {
    case 'trending':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M9.8 2.2c.3 2.4-.9 3.8-2.1 5-.9.9-1.5 2-1.5 3.3A4.1 4.1 0 0 0 10.3 14.6a4.2 4.2 0 0 0 3.7-4.3c0-2-1-3.8-2.3-5.1-.3 1.2-1 1.9-1.8 2.3.3-1.6.4-3.3-.1-5.3Z" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'tvl':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M9 2.5 15.5 6 9 9.5 2.5 6 9 2.5Z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
          <path d="m2.5 9.6 6.5 3.4 6.5-3.4M2.5 12.8 9 16.2l6.5-3.4" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'volume':
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M2.2 10.5h3l2-5.5 3.2 8.5 2.2-5h3.2" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'favorites':
      return <IconStar width={14} height={14} />;
    case 'new':
      return <IconSparkle width={14} height={14} />;
    case 'name':
    default:
      return (
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M4.5 4v10M4.5 14l-2.2-2.3M4.5 14l2.2-2.3M10 5.2h5.2M10 9h4M10 12.8h2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

/** Network emblem using offline vendored `AssetIcon` chain SVGs + multi-chain globe for `all`. */
function ChainMark({ chain, size = 20 }) {
  const assetKey = resolveChainAssetKey(chain);
  if (assetKey == null) {
    return (
      <span className="dcx-all-net-ico" style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6" />
          <ellipse cx="10" cy="10" rx="3.4" ry="7.5" stroke="currentColor" strokeWidth="1.35" />
          <path d="M2.8 10h14.4M4.2 6.5h11.6M4.2 13.5h11.6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return <AssetIcon chain={assetKey} size={size} className="dcx-chain-asset-ico" />;
}

/**
 * Full-bleed protocol logo:
 * Renders a crisp, zero-latency vendored vector brand mark immediately at
 * frame 0 for all 53 protocols (`discoveryProtocolSvg`), filling 100% of the
 * rounded-square container, and layers a verified HTTPS DefiLlama logo if available.
 */
function ProtoLogo({ protocol, liveLogo, size = 44 }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [liveLoaded, setLiveLoaded] = useState(false);
  const [liveFailed, setLiveFailed] = useState(false);

  const remoteSrc = useMemo(() => {
    const s = typeof liveLogo === 'string' ? liveLogo.trim() : '';
    return s.startsWith('https://') ? s : '';
  }, [liveLogo]);

  useEffect(() => {
    setLiveLoaded(false);
    setLiveFailed(false);
  }, [protocol?.id, remoteSrc]);

  const svg = useMemo(() => discoveryProtocolSvg(protocol?.id, uid), [protocol?.id, uid]);
  const hue = protocol?.hue || '#22d3ee';
  const box = {
    '--dcx-logo-size': `${size}px`,
    '--dcx-hue': hue,
    borderRadius: Math.round(size * 0.3)
  };

  return (
    <span className="dcx-logo" style={box} aria-hidden="true">
      {svg ? (
        <span className="dcx-logo-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <span className="dcx-logo-fallback">{String(protocol?.name || '?').slice(0, 2).toUpperCase()}</span>
      )}
      {remoteSrc && !liveFailed && (
        <img
          src={remoteSrc}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={liveLoaded ? 'dcx-logo-img is-loaded' : 'dcx-logo-img'}
          onLoad={() => setLiveLoaded(true)}
          onError={() => setLiveFailed(true)}
        />
      )}
    </span>
  );
}

/** Translate a security warning by its stable code, keeping English as fallback. */
const WARN_KEYS = {
  'not-https': 'notHttps', 'bad-url': 'badUrl', empty: 'empty', punycode: 'punycode',
  'suspicious-tld': 'suspiciousTld', lookalike: 'lookalike', 'complex-host': 'complexHost',
  cyrillic: 'cyrillic', 'unsupported-chain': 'unsupportedChain',
  'no-audit-info': 'noAuditInfo', 'zero-audits': 'zeroAudits'
};
function warnText(w, t) {
  const key = WARN_KEYS[w?.code];
  if (!key) return w?.message || '';
  if (key === 'suspiciousTld') return t('discover.ui.warn.suspiciousTld', { tld: w.tld || '', defaultValue: w.message });
  if (key === 'unsupportedChain') return t('discover.ui.warn.unsupportedChain', { chains: w.chains || '', defaultValue: w.message });
  return t(`discover.ui.warn.${key}`, w.message);
}

// ── Protocol card ───────────────────────────────────────────────────────
function ProtocolCard({ protocol, live, lang, fav, onFav, onOpen, isFeatured, t, catLabel }) {
  const chains = protocol.chains?.slice(0, 4) || [];
  const extraChains = Math.max(0, (protocol.chains?.length || 0) - chains.length);

  return (
    <article
      className="dcx-card"
      style={{ '--dcx-card-accent': protocol.hue || '#22d3ee' }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(protocol); }
      }}
      onClick={() => onOpen(protocol)}
      aria-label={`${protocol.name} — ${t('discover.ui.card.details')}`}
      data-testid={`dc-card-${protocol.id}`}
      data-legacy-id={`disc-card-${protocol.id}`}
    >
      <div className="dcx-card-head">
        <ProtoLogo protocol={protocol} liveLogo={live?.logo} size={46} />
        <div className="dcx-card-title-wrap">
          <div className="dcx-card-title-row">
            <h4 className="dcx-card-title" dir="ltr">{protocol.name}</h4>
            {protocol.verified && (
              <span className="dcx-verified" title={t('discover.ui.card.verified')} aria-label={t('discover.ui.card.verified')}>
                <IconCheck width={10} height={10} />
              </span>
            )}
          </div>
          <span className="dcx-card-domain" dir="ltr">{hostOf(protocol.url)}</span>
        </div>
        <button
          type="button"
          className={`dcx-fav ${fav ? 'is-on' : ''}`}
          aria-label={fav ? t('discover.ui.card.unfavorite') : t('discover.ui.card.favorite')}
          aria-pressed={fav}
          onClick={(e) => { e.stopPropagation(); onFav(protocol.id); }}
        >
          <IconStar width={14} height={14} />
        </button>
      </div>

      <p className="dcx-card-desc">{descriptionFor(protocol, lang)}</p>

      <div className="dcx-card-tags">
        <div className="dcx-card-badges">
          <span className="dcx-badge" data-cat={protocol.category}>
            <CategoryIcon id={protocol.category} />
            {catLabel(protocol.category)}
          </span>
          {isFeatured && (
            <span className="dcx-badge is-soft">✦ {t('discover.ui.card.featured')}</span>
          )}
        </div>
        <span className="dcx-chains" dir="ltr">
          {chains.map((c) => (
            <span key={c} className="dcx-chain-ico-pill" title={chainLabel(c, lang)}>
              <ChainMark chain={c} size={16} />
            </span>
          ))}
          {extraChains > 0 && <span className="dcx-chain-more">+{extraChains}</span>}
        </span>
      </div>

      <div className="dcx-card-foot">
        <div className="dcx-card-metric">
          <span className="dcx-metric-lbl">{t('discover.ui.card.tvl')}</span>
          {live?.tvl != null ? (
            <span className="dcx-metric-val" dir="ltr">{fmtCompact(live.tvl)}</span>
          ) : (
            <span className="dcx-metric-val is-na" dir="ltr">{t('discover.ui.card.na')}</span>
          )}
        </div>
        <span className="dcx-card-go" aria-hidden="true">
          {t('discover.ui.card.details')}
          <IconChevronRight width={13} height={13} />
        </span>
      </div>
    </article>
  );
}

// ══════════════════════════════════════════════════════════════════════════
export default function Discover({ embedded = false }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const wallet = useWallet();
  const lang = i18n.language?.slice(0, 2) || 'en';
  const netMenuId = useId();
  const sortMenuId = useId();

  // ── Filters & search ──────────────────────────────────────────────────
  const [cat, setCat] = useState('all');
  const [net, setNet] = useState('all');
  const [sort, setSort] = useState('trending');
  const [q, setQ] = useState('');
  const [queries, setQueries] = useState(loadQueries);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null); // 'network' | 'sort' | null
  const [highlight, setHighlight] = useState(-1);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [quickTab, setQuickTab] = useState('trending');
  const searchWrapRef = useRef(null);
  const filterBarRef = useRef(null);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);

  // ── Live data ─────────────────────────────────────────────────────────
  const [trendingData, setTrendingData] = useState(null);
  const [trendingErr, setTrendingErr] = useState(null);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [protocolLiveMap, setProtocolLiveMap] = useState({});
  const [metaInfo, setMetaInfo] = useState(null);

  // ── UX state ─────────────────────────────────────────────────────────
  const [picked, setPicked] = useState(null);
  const pickedProto = useMemo(() => (picked ? DISCOVERY_PROTOCOLS.find((p) => p.id === picked) : null), [picked]);
  const [favs, setFavs] = useState(loadFavs);
  const [recents, setRecents] = useState(loadRecents);
  const [detailLive, setDetailLive] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Localized labels ──────────────────────────────────────────────────
  const catLabel = useCallback((id) => {
    const fallback = DISCOVERY_CATEGORIES.find((c) => c.id === id)?.label || id;
    return t(`discover.ui.cat.${id}`, fallback);
  }, [t]);
  const categoryLabels = useMemo(
    () => Object.fromEntries(DISCOVERY_CATEGORIES.map((c) => [c.id, catLabel(c.id)])),
    [catLabel]
  );
  const netLabel = useCallback((id) => {
    if (id === 'all') return t('discover.ui.filters.allNetworks');
    const entry = NETWORK_FILTERS.find((n) => n.id === id);
    if (!entry) return id;
    return chainLabel(entry.label, lang) || entry.short || id;
  }, [t, lang]);
  const sortLabel = useCallback((id) => {
    if (id === 'security') return t('discover.ui.smart.security');
    if (id === 'new') return t('discover.ui.sort.new');
    if (id === 'compare') return t('discover.ui.smart.compare');
    return t(`discover.ui.sort.${id}`, id);
  }, [t]);
  const ui = useCallback((path, fallback, opts) => t(`discover.ui.${path}`, { defaultValue: fallback, ...(opts || {}) }), [t]);
  const examples = useMemo(() => aiExamplesFor(lang), [lang]);

  const chainCounts = useMemo(() => {
    const counts = new Map();
    counts.set('all', DISCOVERY_PROTOCOLS.length);
    for (const nf of NETWORK_FILTERS) {
      if (nf.id === 'all') continue;
      const aliases = CHAIN_ALIASES[nf.id] || [nf.id];
      const c = DISCOVERY_PROTOCOLS.filter((p) => {
        const hay = [...(p.chains || []), ...(p.chainIds || []).map(String)].join(' ').toLowerCase();
        return aliases.some((a) => hay.includes(a.toLowerCase()));
      }).length;
      counts.set(nf.id, c);
    }
    return counts;
  }, []);

  // ── Fetch live protocol data (best-effort, never blocks the UI) ────────
  useEffect(() => {
    let alive = true;
    setTrendingLoading(true);
    exploreApi.trending().then((res) => {
      if (!alive) return;
      setTrendingData(res?.data || null);
      setMetaInfo(res?.meta || null);
      setTrendingErr(null);
      const all = [...(res?.data?.trending || []), ...(res?.data?.rising || []), ...(res?.data?.highLiquidity || [])];
      const map = {};
      for (const p of all) if (p.slug && !map[p.slug]) map[p.slug] = p;
      setProtocolLiveMap((prev) => ({ ...map, ...prev }));
    }).catch((e) => {
      if (alive) setTrendingErr(intelErrorCode(e));
    }).finally(() => { if (alive) setTrendingLoading(false); });

    exploreApi.protocols({ limit: 80, sort: 'tvl' }).then((res) => {
      if (!alive) return;
      const rows = res?.data?.protocols || [];
      setProtocolLiveMap((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          if (r.slug && !next[r.slug]) next[r.slug] = r;
          if (r.name && !next[r.name.toLowerCase()]) next[r.name.toLowerCase()] = r;
        }
        return next;
      });
    }).catch(() => {});

    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!pickedProto) { setDetailLive(null); return; }
    const slug = pickedProto.slug || pickedProto.id;
    if (!slug) return;
    let alive = true;
    setDetailLoading(true);
    exploreApi.protocol(slug).then((res) => {
      if (!alive) return;
      setDetailLive(res?.data || null);
      if (res?.meta) setMetaInfo(res.meta);
    }).catch(() => { if (alive) setDetailLive(null); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [pickedProto]);

  function liveFor(p) {
    if (!p) return null;
    return protocolLiveMap[p.slug] || protocolLiveMap[p.name?.toLowerCase()] || protocolLiveMap[p.id] || null;
  }

  // ── Favorites / recents ───────────────────────────────────────────────
  const toggleFav = useCallback((id) => {
    haptic?.('light');
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, FAV_MAX);
      try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, [haptic]);

  const rememberRecent = useCallback((id) => {
    try {
      const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setRecents(next);
    } catch { /* private mode */ }
  }, []);

  // ── Pick / open ───────────────────────────────────────────────────────
  const pick = useCallback((proto) => {
    haptic?.('light');
    setSuggestOpen(false);
    setOpenDropdown(null);
    setPicked(proto.id);
  }, [haptic]);
  const closeSheet = useCallback(() => setPicked(null), []);

  const doOpen = useCallback(async () => {
    if (!pickedProto) return;
    haptic?.('medium');
    rememberRecent(pickedProto.id);
    const check = validateDiscoveryUrl(pickedProto.url);
    if (check.blocked) {
      useAppStore.getState().notify(warnText(check.warnings[0], t), 'error');
      return;
    }
    await openUrl(pickedProto.url);
  }, [pickedProto, haptic, rememberRecent, t]);

  const copyLink = useCallback(() => {
    if (!pickedProto) return;
    navigator.clipboard?.writeText(pickedProto.url);
    haptic?.('success');
    useAppStore.getState().notify(t('discover.ui.sheet.copied'), 'success');
  }, [pickedProto, haptic, t]);

  // ── Search / suggestions ──────────────────────────────────────────────
  const suggestions = useMemo(() => buildSuggestions({
    list: DISCOVERY_PROTOCOLS, query: q, lang,
    categories: DISCOVERY_CATEGORIES, networks: NETWORK_FILTERS,
    recentQueries: queries, categoryLabels
  }), [q, lang, queries, categoryLabels]);

  const scrollToResults = useCallback(() => {
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  }, []);

  const commitQuery = useCallback((raw) => {
    const text = String(raw || '').trim();
    setQ(text);
    setQueries(rememberQuery(text));
    setSuggestOpen(false);
    setHighlight(-1);
    setVisible(PAGE_SIZE);
    inputRef.current?.blur();
    if (text) scrollToResults();
  }, [scrollToResults]);

  const applySmart = useCallback((parsed, raw) => {
    haptic?.('success');
    setCat(parsed?.category && parsed.category !== 'all' ? parsed.category : 'all');
    setNet(parsed?.chain || 'all');
    setSort(SORT_IDS.includes(parsed?.sort) ? parsed.sort : 'trending');
    setQ('');
    setQueries(rememberQuery(raw));
    setSuggestOpen(false);
    setHighlight(-1);
    setVisible(PAGE_SIZE);
    inputRef.current?.blur();
    scrollToResults();
  }, [haptic, scrollToResults]);

  const suggestionItems = useMemo(() => {
    if (!suggestOpen) return [];
    const s = suggestions;
    const items = [];
    if (s.empty) {
      for (const text of s.recents) items.push({ id: `recent:${text}`, type: 'recent', label: text, onSelect: () => commitQuery(text) });
      for (const ex of examples.slice(0, 3)) {
        items.push({ id: `example:${ex}`, type: 'example', label: ex, onSelect: () => applySmart(parseAiQuery(ex), ex) });
      }
      return items;
    }
    if (s.smart) {
      items.push({
        id: 'smart', type: 'smart', label: ui('smart.apply', 'Apply filters'),
        sub: smartSummary(s.smart, { categoryLabel: catLabel, networkLabel: netLabel, sortLabel }),
        onSelect: () => applySmart(s.smart, s.query)
      });
    }
    for (const p of s.protocols) {
      items.push({
        id: `proto:${p.id}`, type: 'protocol', label: p.name,
        sub: catLabel(p.category), protocol: p,
        onSelect: () => pick(p)
      });
    }
    for (const c of s.categories) {
      items.push({
        id: `cat:${c.id}`, catId: c.id, type: 'category', label: catLabel(c.id), sub: ui('search.categories', 'Categories'),
        onSelect: () => { setCat(c.id); setQ(''); setSuggestOpen(false); setVisible(PAGE_SIZE); scrollToResults(); }
      });
    }
    for (const n of s.networks) {
      items.push({
        id: `net:${n.id}`, netObj: n, type: 'network', label: netLabel(n.id), sub: ui('search.networks', 'Networks'),
        onSelect: () => { setNet(n.id); setQ(''); setSuggestOpen(false); setVisible(PAGE_SIZE); scrollToResults(); }
      });
    }
    items.push({
      id: 'all', type: 'all', label: ui('search.allResults', 'See all results', { q: s.query }),
      onSelect: () => commitQuery(s.query)
    });
    return items;
  }, [suggestOpen, suggestions, examples, catLabel, netLabel, sortLabel, ui, applySmart, commitQuery, pick, scrollToResults]);

  useEffect(() => { setHighlight(-1); }, [q]);
  useEffect(() => {
    if (!suggestOpen && !openDropdown) return undefined;
    const onDown = (e) => {
      if (suggestOpen && !searchWrapRef.current?.contains(e.target)) setSuggestOpen(false);
      if (openDropdown && !filterBarRef.current?.contains(e.target)) setOpenDropdown(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && openDropdown) setOpenDropdown(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [suggestOpen, openDropdown]);

  const onSearchKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { setSuggestOpen(false); inputRef.current?.blur(); return; }
    if (!suggestOpen || !suggestionItems.length) {
      if (e.key === 'Enter') { e.preventDefault(); commitQuery(q); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestOpen(true);
      setHighlight((h) => (h + 1) % suggestionItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? suggestionItems.length - 1 : h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = highlight >= 0 ? suggestionItems[highlight] : null;
      if (item) item.onSelect();
      else commitQuery(q);
    }
  }, [suggestOpen, suggestionItems, highlight, commitQuery, q]);

  const clearAll = useCallback(() => {
    setQ(''); setCat('all'); setNet('all'); setSort('trending');
    setVisible(PAGE_SIZE); setSuggestOpen(false); setOpenDropdown(null);
  }, []);

  // ── Filtering ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const needle = q.trim();
    let list = rankProtocols(DISCOVERY_PROTOCOLS, needle, { lang, categoryLabels }).items;

    if (cat !== 'all') list = list.filter((p) => p.category === cat);
    if (net !== 'all') {
      const aliases = CHAIN_ALIASES[net] || [net];
      list = list.filter((p) => {
        const hay = [...(p.chains || []), ...(p.chainIds || []).map(String)].join(' ').toLowerCase();
        return aliases.some((a) => hay.includes(a.toLowerCase()));
      });
    }

    if (needle && sort === 'trending') return list;

    const byLive = (key) => (a, b) => {
      const av = liveFor(a)?.[key] ?? -1;
      const bv = liveFor(b)?.[key] ?? -1;
      return bv - av || a.name.localeCompare(b.name);
    };
    if (sort === 'favorites') list = [...list].sort((a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0) || a.name.localeCompare(b.name));
    else if (sort === 'tvl') list = [...list].sort(byLive('tvl'));
    else if (sort === 'volume') list = [...list].sort(byLive('volume_24h'));
    else if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'new') list = [...list].sort((a, b) => (a.featured ? 1 : 0) - (b.featured ? 1 : 0));
    else list = [...list].sort((a, b) => {
      const rank = (p) => (p.featured ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return byLive('tvl')(a, b);
    });
    return list;
  }, [cat, net, q, sort, favs, lang, categoryLabels, protocolLiveMap]);

  const shown = useMemo(() => filtered.slice(0, visible), [filtered, visible]);
  const activeFilters = cat !== 'all' || net !== 'all' || q.trim() || sort !== 'trending';
  const activeNetObj = useMemo(
    () => NETWORK_FILTERS.find((n) => n.id === net) || NETWORK_FILTERS[0],
    [net]
  );

  // ── Quick access ──────────────────────────────────────────────────────
  const featured = useMemo(() => DISCOVERY_PROTOCOLS.filter((p) => p.featured).slice(0, 6), []);
  const trendingStrip = useMemo(() => {
    if (trendingData?.trending?.length) {
      return trendingData.trending.slice(0, 8)
        .map((p) => ({ protocol: DISCOVERY_PROTOCOLS.find((d) => d.slug === p.slug || d.id === p.slug), change: p.change_1d }))
        .filter((x) => x.protocol);
    }
    return featured.slice(0, 6).map((p) => ({ protocol: p, change: null }));
  }, [trendingData, featured]);
  const favItems = useMemo(() => favs.map((id) => DISCOVERY_PROTOCOLS.find((p) => p.id === id)).filter(Boolean), [favs]);
  const recentItems = useMemo(() => recents.map((id) => DISCOVERY_PROTOCOLS.find((p) => p.id === id)).filter(Boolean), [recents]);
  const quickItems = quickTab === 'favorites' ? favItems.map((protocol) => ({ protocol }))
    : quickTab === 'recent' ? recentItems.map((protocol) => ({ protocol }))
      : trendingStrip;
  const quickEmpty = quickTab === 'favorites' ? ui('quick.emptyFavorites', '')
    : quickTab === 'recent' ? ui('quick.emptyRecent', '') : ui('quick.emptyTrending', '');

  // ── Sheet derived data ────────────────────────────────────────────────
  const sheetValidation = useMemo(() => (pickedProto ? validateDiscoveryUrl(pickedProto.url) : null), [pickedProto]);
  const sheetChainWarns = useMemo(() => (pickedProto ? chainSupportWarnings(pickedProto, wallet?.chainId) : []), [pickedProto, wallet?.chainId]);
  const sheetAuditNote = useMemo(() => (pickedProto ? auditNotice(pickedProto) : null), [pickedProto]);
  const sheetIsRegistry = useMemo(
    () => (pickedProto ? isRegistryDomain(hostOf(pickedProto.url), DISCOVERY_PROTOCOLS.map((p) => p.domain)) : false),
    [pickedProto]
  );
  const detailTvl = detailLive?.tvl ?? liveFor(pickedProto)?.tvl ?? null;
  const detailVol = detailLive?.volume_24h ?? liveFor(pickedProto)?.volume_24h ?? null;
  const detailChange7d = detailLive?.change_7d ?? liveFor(pickedProto)?.change_7d ?? null;
  const auditLinks = detailLive?.auditLinks?.length ? detailLive.auditLinks : (pickedProto?.auditLinks || []);

  return (
    <PageTransition embedded={embedded}>
      <div className="dcx">
        {!embedded && (
          <div className="row" style={{ gap: 10, marginBottom: 2 }}>
            <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
              <IconChevronLeft width={18} height={18} />
            </button>
            <h1 className="h1" style={{ fontSize: 19, margin: 0 }}>{t('discover.title', 'Discover')}</h1>
          </div>
        )}

        {/* ── MODERNIZED HERO + OMNIBOX ──────────────────────────────────── */}
        <motion.section className="dcx-hero" variants={riseIn} initial="hidden" animate="show">
          <span className="dcx-hero-aurora" aria-hidden="true">
            <i className="dcx-hero-orb dcx-hero-orb--a" />
            <i className="dcx-hero-orb dcx-hero-orb--b" />
            <i className="dcx-hero-grid" />
          </span>

          <div className="dcx-hero-bar">
            <span className="dcx-kicker">
              <span className="dcx-kicker-gem" aria-hidden="true">
                <IconSparkle width={11} height={11} />
              </span>
              {t('discover.ui.hero.kicker')}
            </span>
            <span className={`dcx-live ${trendingLoading || trendingErr ? '' : 'is-on'}`}>
              <span className="dcx-live-dot" aria-hidden="true" />
              {trendingLoading
                ? t('discover.ui.hero.loading')
                : trendingErr ? t('discover.ui.hero.offline') : t('discover.ui.hero.live')}
            </span>
          </div>

          <h2 className="dcx-hero-title">
            {t('discover.ui.hero.title')}{' '}
            <span>{t('discover.ui.hero.titleAccent')}</span>
          </h2>
          <p className="dcx-hero-sub">{t('discover.ui.hero.subtitle')}</p>

          <div className="dcx-search-wrap" ref={searchWrapRef}>
            <div className={`dcx-search ${suggestOpen ? 'is-focused' : ''}`}>
              <span className="dcx-search-ico" aria-hidden="true">
                <IconSearch width={16} height={16} />
              </span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => { setQ(e.target.value); setSuggestOpen(true); }}
                onFocus={() => setSuggestOpen(true)}
                onKeyDown={onSearchKeyDown}
                placeholder={t('discover.ui.search.placeholder')}
                aria-label={t('discover.ui.search.label')}
                role="combobox"
                aria-expanded={suggestOpen && suggestionItems.length > 0}
                aria-controls="dcx-suggestions"
                aria-autocomplete="list"
                aria-activedescendant={highlight >= 0 ? `dcx-sug-${highlight}` : undefined}
                autoComplete="off"
                spellCheck={false}
                dir="auto"
              />
              {q && (
                <button
                  type="button"
                  className="dcx-search-clear"
                  onClick={() => { setQ(''); inputRef.current?.focus(); }}
                  aria-label={t('discover.ui.search.clear')}
                >
                  <IconX width={13} height={13} />
                </button>
              )}
            </div>

            <AnimatePresence>
              {suggestOpen && suggestionItems.length > 0 && (
                <motion.div
                  id="dcx-suggestions"
                  className="dcx-suggest"
                  role="listbox"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.14 }}
                >
                  {suggestions.empty && suggestionItems.length > 0 && (
                    <div className="dcx-suggest-head">
                      {suggestions.recents.length ? t('discover.ui.search.recent') : t('discover.ui.search.examples')}
                    </div>
                  )}
                  {suggestionItems.map((item, i) => (
                    <button
                      key={item.id}
                      id={`dcx-sug-${i}`}
                      type="button"
                      role="option"
                      aria-selected={highlight === i}
                      className={`dcx-suggest-item ${highlight === i ? 'is-active' : ''} ${item.type === 'smart' ? 'is-smart' : ''}`}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => item.onSelect()}
                    >
                      <span className="dcx-suggest-ico-slot" aria-hidden="true">
                        {item.type === 'protocol' ? <ProtoLogo protocol={item.protocol} liveLogo={liveFor(item.protocol)?.logo} size={30} />
                          : item.type === 'smart' ? <IconSparkle width={15} height={15} />
                            : item.type === 'category' ? <CategoryIcon id={item.catId} />
                              : item.type === 'network' ? <ChainMark chain={item.netObj} size={20} />
                                : item.type === 'recent' || item.type === 'example' ? <IconClock width={14} height={14} />
                                  : <IconSearch width={14} height={14} />}
                      </span>
                      <span className="dcx-suggest-body">
                        <span className="dcx-suggest-title" dir={item.type === 'protocol' ? 'ltr' : 'auto'}>{item.label}</span>
                        {item.sub && <span className="dcx-suggest-sub">{item.sub}</span>}
                      </span>
                      <IconChevronRight className="dcx-suggest-arrow" width={13} height={13} aria-hidden="true" />
                    </button>
                  ))}
                  <div className="dcx-suggest-foot">{t('discover.ui.search.keyboard')}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="dcx-hero-stats">
            <div className="dcx-stat-pod">
              <span className="dcx-stat-ico is-emerald" aria-hidden="true">
                <IconShield width={13} height={13} />
              </span>
              <span className="dcx-stat-txt">
                <strong dir="ltr">{DISCOVERY_PROTOCOLS.length}</strong> {t('discover.ui.hero.statProtocols')}
              </span>
            </div>
            <div className="dcx-stat-pod">
              <span className="dcx-stat-ico is-cyan" aria-hidden="true">
                <IconGlobe width={13} height={13} />
              </span>
              <span className="dcx-stat-txt">
                <strong dir="ltr">{NETWORK_FILTERS.length - 1}</strong> {t('discover.ui.hero.statNetworks')}
              </span>
            </div>
            <div className="dcx-stat-pod">
              <span className="dcx-stat-ico is-violet" aria-hidden="true">
                <IconSparkle width={13} height={13} />
              </span>
              <span className="dcx-stat-txt">{t('discover.ui.hero.statSource')}</span>
            </div>
          </div>
        </motion.section>

        {/* ── QUICK ACCESS (trending / favorites / recents in ONE card) ───── */}
        {(trendingStrip.length > 0 || favItems.length > 0 || recentItems.length > 0) && (
          <motion.section className="dcx-quick" variants={riseIn} initial="hidden" animate="show">
            <div className="dcx-quick-head">
              <span className="dcx-quick-title">
                <span className="dcx-quick-flame" aria-hidden="true">
                  <IconTrend width={13} height={13} />
                </span>
                {t('discover.ui.quick.title')}
              </span>
              <div className="dcx-quick-tabs" role="tablist" aria-label={t('discover.ui.quick.title')}>
                {[
                  { id: 'trending', label: t('discover.ui.quick.trending'), count: trendingStrip.length },
                  { id: 'favorites', label: t('discover.ui.quick.favorites'), count: favItems.length },
                  { id: 'recent', label: t('discover.ui.quick.recent'), count: recentItems.length }
                ].map(({ id, label, count }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={quickTab === id}
                    className={quickTab === id ? 'is-active' : ''}
                    onClick={() => { haptic?.('light'); setQuickTab(id); }}
                  >
                    {label}
                    {count > 0 && <span className="dcx-tab-count" aria-hidden="true">{count}</span>}
                  </button>
                ))}
              </div>
            </div>
            {quickItems.length > 0 ? (
              <div className="dcx-quick-rail">
                {quickItems.map(({ protocol, change }) => (
                  <button
                    key={`${quickTab}-${protocol.id}`}
                    type="button"
                    className="dcx-quick-pill"
                    onClick={() => pick(protocol)}
                  >
                    <ProtoLogo protocol={protocol} liveLogo={liveFor(protocol)?.logo} size={30} />
                    <span className="dcx-quick-meta">
                      <span className="dcx-quick-name" dir="ltr">{protocol.name}</span>
                      <span className="dcx-quick-cat">{catLabel(protocol.category)}</span>
                    </span>
                    {change != null && (
                      <span className={`dcx-quick-chg ${change >= 0 ? 'is-up' : 'is-down'}`} dir="ltr">
                        {change >= 0 ? '+' : ''}{Number(change).toFixed(1)}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : <p className="dcx-quick-empty">{quickEmpty}</p>}
          </motion.section>
        )}

        {/* ── NON-FLOATING FILTER TOOLBAR (Category Icons + Single-Line Popovers) ── */}
        <div className="dcx-toolbar" ref={resultsRef}>
          <div className="dcx-chips" role="tablist" aria-label={t('discover.ui.filters.category')}>
            {DISCOVERY_CATEGORIES.map((c) => {
              const active = cat === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-cat={c.id}
                  className={`dcx-chip ${active ? 'is-active' : ''}`}
                  onClick={() => { haptic?.('light'); setCat(c.id); setVisible(PAGE_SIZE); }}
                >
                  <span className="dcx-chip-ico" aria-hidden="true">
                    <CategoryIcon id={c.id} />
                  </span>
                  <span className="dcx-chip-label">{catLabel(c.id)}</span>
                </button>
              );
            })}
          </div>

          <div className="dcx-filter-bar" ref={filterBarRef}>
            {/* 1. Network Dropdown ("همهٔ شبکه‌ها") */}
            <div className="dcx-dd-wrap">
              <button
                type="button"
                className={`dcx-dd-trigger ${openDropdown === 'network' ? 'is-open' : ''} ${net !== 'all' ? 'is-filtered' : ''}`}
                aria-label={t('discover.ui.filters.network')}
                aria-haspopup="listbox"
                aria-expanded={openDropdown === 'network'}
                aria-controls={netMenuId}
                onClick={() => setOpenDropdown((cur) => (cur === 'network' ? null : 'network'))}
              >
                <span className="dcx-dd-lead">
                  <ChainMark chain={activeNetObj} size={22} />
                  <span className="dcx-dd-text">
                    <span className="dcx-dd-kicker">{t('discover.ui.filters.network')}</span>
                    <span className="dcx-dd-val">{netLabel(net)}</span>
                  </span>
                </span>
                <svg className="dcx-dd-caret" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {openDropdown === 'network' && (
                <div
                  id={netMenuId}
                  role="listbox"
                  aria-label={t('discover.ui.filters.network')}
                  className="dcx-popover dcx-popover--start"
                >
                  <div className="dcx-popover-head">{t('discover.ui.search.networks')}</div>
                  <div className="dcx-popover-list">
                    {NETWORK_FILTERS.map((nf) => {
                      const selectedNet = net === nf.id;
                      const count = chainCounts.get(nf.id) ?? 0;
                      return (
                        <button
                          key={nf.id}
                          type="button"
                          role="option"
                          aria-selected={selectedNet}
                          className={`dcx-popover-opt ${selectedNet ? 'is-selected' : ''}`}
                          onClick={() => {
                            haptic?.('light');
                            setNet(nf.id);
                            setVisible(PAGE_SIZE);
                            setOpenDropdown(null);
                          }}
                        >
                          <ChainMark chain={nf} size={24} />
                          <span className="dcx-popover-opt-main">
                            <span className="dcx-popover-opt-label">{netLabel(nf.id)}</span>
                            {nf.id !== 'all' && nf.short && (
                              <span className="dcx-popover-opt-code" aria-hidden="true">{nf.short}</span>
                            )}
                          </span>
                          <span className="dcx-popover-opt-count" aria-hidden="true">{count}</span>
                          <span className="dcx-popover-check" aria-hidden="true">
                            {selectedNet && <IconCheck width={13} height={13} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Sort Dropdown ("داغ‌ترین") */}
            <div className="dcx-dd-wrap">
              <button
                type="button"
                className={`dcx-dd-trigger ${openDropdown === 'sort' ? 'is-open' : ''}`}
                aria-label={t('discover.ui.filters.sort')}
                aria-haspopup="listbox"
                aria-expanded={openDropdown === 'sort'}
                aria-controls={sortMenuId}
                onClick={() => setOpenDropdown((cur) => (cur === 'sort' ? null : 'sort'))}
              >
                <span className="dcx-dd-lead">
                  <span className="dcx-sort-badge" data-sort={sort} aria-hidden="true">
                    <SortIcon id={sort} />
                  </span>
                  <span className="dcx-dd-text">
                    <span className="dcx-dd-kicker">{t('discover.ui.filters.sort')}</span>
                    <span className="dcx-dd-val">{sortLabel(sort)}</span>
                  </span>
                </span>
                <svg className="dcx-dd-caret" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {openDropdown === 'sort' && (
                <div
                  id={sortMenuId}
                  role="listbox"
                  aria-label={t('discover.ui.filters.sort')}
                  className="dcx-popover dcx-popover--end"
                >
                  <div className="dcx-popover-head">{t('discover.ui.filters.sort')}</div>
                  <div className="dcx-popover-list">
                    {SORT_IDS.map((id) => {
                      const selectedSort = sort === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          role="option"
                          aria-selected={selectedSort}
                          className={`dcx-popover-opt ${selectedSort ? 'is-selected' : ''}`}
                          onClick={() => {
                            haptic?.('light');
                            setSort(id);
                            setVisible(PAGE_SIZE);
                            setOpenDropdown(null);
                          }}
                        >
                          <span className="dcx-sort-badge" data-sort={id} aria-hidden="true">
                            <SortIcon id={id} />
                          </span>
                          <span className="dcx-popover-opt-main">
                            <span className="dcx-popover-opt-label">{sortLabel(id)}</span>
                          </span>
                          <span className="dcx-popover-check" aria-hidden="true">
                            {selectedSort && <IconCheck width={13} height={13} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RESULTS HEADER ──────────────────────────────────────────────── */}
        <div className="dcx-section-head">
          <div className="dcx-section-title">
            <h3>{q.trim() ? t('discover.ui.filters.resultsFor', { q: q.trim() }) : t('discover.ui.filters.results')}</h3>
            <span className="dcx-count">{t('discover.ui.filters.count', { count: filtered.length })}</span>
          </div>
          <div className="dcx-section-actions">
            {activeFilters && (
              <button type="button" className="dcx-reset" onClick={clearAll}>
                <IconX width={11} height={11} />
                {t('discover.ui.filters.reset')}
              </button>
            )}
            {trendingErr && <span className="dcx-count">{t('discover.ui.filters.liveOffShort')}</span>}
          </div>
        </div>

        {/* ── PROTOCOL GRID ───────────────────────────────────────────────── */}
        {filtered.length > 0 ? (
          <>
            <div className="dcx-grid">
              {shown.map((p) => (
                <ProtocolCard
                  key={p.id}
                  protocol={p}
                  live={liveFor(p)}
                  lang={lang}
                  fav={favs.includes(p.id)}
                  onFav={toggleFav}
                  onOpen={pick}
                  isFeatured={Boolean(p.featured)}
                  t={t}
                  catLabel={catLabel}
                />
              ))}
            </div>
            {visible < filtered.length && (
              <button type="button" className="dcx-more" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                {t('discover.ui.filters.showMore', { count: filtered.length - visible })}
              </button>
            )}
            {visible >= filtered.length && filtered.length > PAGE_SIZE && (
              <p className="dcx-all-shown">{t('discover.ui.filters.showAll')}</p>
            )}
          </>
        ) : !trendingLoading && (
          <div className="dcx-empty">
            <span className="dcx-empty-ico" aria-hidden="true"><IconSearch width={20} height={20} /></span>
            <h4>{t('discover.ui.empty.title')}</h4>
            <p>{t('discover.ui.empty.body', { q: q.trim() || catLabel(cat) })}</p>
            <button type="button" className="dcx-more" onClick={clearAll}>{t('discover.ui.empty.action')}</button>
          </div>
        )}

        <div className="dcx-safety-box" id="discover-safety-dc">
          <InfoBox
            title={t('discover.ui.safety.title')}
            tone="warn"
            id="discover-safety-dc"
            icon={<IconShield width={14} height={14} />}
          >
            <p>{t('discover.ui.safety.body')}</p>
          </InfoBox>
        </div>

        {/* ── MODERN DETAIL SHEET (No X button, compact Star, rich aurora surface) ── */}
        <Sheet
          open={Boolean(pickedProto)}
          onClose={closeSheet}
          anchor="bottom"
          size="lg"
          className="dcx-sheet disc-sheet"
          testId="disc-sheet"
        >
          {pickedProto && (
            <div className="dcx-sheet-inner" style={{ '--dcx-sheet-accent': pickedProto.hue || '#22d3ee' }}>
              <span className="dcx-sheet-ambient" aria-hidden="true">
                <i className="dcx-sheet-bloom dcx-sheet-bloom--a" />
                <i className="dcx-sheet-bloom dcx-sheet-bloom--b" />
                <i className="dcx-sheet-mesh" />
              </span>

              {/* Hero header — X button intentionally removed; compact properly-proportioned star */}
              <header className="dcx-sheet-hero">
                <div className="dcx-sheet-logo-frame">
                  <ProtoLogo protocol={pickedProto} liveLogo={liveFor(pickedProto)?.logo} size={56} />
                </div>
                <div className="dcx-sheet-id">
                  <div className="dcx-sheet-title-row">
                    <h3 dir="ltr">{pickedProto.name}</h3>
                    {pickedProto.verified && (
                      <span className="dcx-verified" title={t('discover.ui.sheet.verifiedDomain')}>
                        <IconCheck width={11} height={11} />
                      </span>
                    )}
                  </div>
                  <div className="dcx-sheet-cats">
                    <span className="dcx-badge" data-cat={pickedProto.category}>
                      <CategoryIcon id={pickedProto.category} />
                      {catLabel(pickedProto.category)}
                    </span>
                    {pickedProto.verified && (
                      <span className="dcx-badge is-soft">{t('discover.ui.sheet.verifiedDomain')}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className={`dcx-fav dcx-sheet-fav ${favs.includes(pickedProto.id) ? 'is-on' : ''}`}
                  aria-label={favs.includes(pickedProto.id) ? t('discover.ui.card.unfavorite') : t('discover.ui.card.favorite')}
                  aria-pressed={favs.includes(pickedProto.id)}
                  onClick={() => toggleFav(pickedProto.id)}
                >
                  <IconStar width={14} height={14} />
                </button>
              </header>

              {/* Official domain verification bar */}
              <div className="dcx-domain-bar">
                <span className="dcx-domain-shield" aria-hidden="true">
                  <IconShield width={15} height={15} />
                </span>
                <div className="dcx-domain-meta">
                  <span className="dcx-domain-lbl">{t('discover.ui.sheet.officialDomain')}</span>
                  <span className="dcx-domain-host" dir="ltr">{hostOf(pickedProto.url)}</span>
                </div>
                <span className="dcx-domain-ok" dir="ltr">https</span>
              </div>

              <p className="dcx-sheet-desc">{descriptionFor(pickedProto, lang)}</p>

              {/* Live metrics 2×2 bento */}
              <div className="dcx-sheet-block">
                <div className="dcx-block-head">
                  <span className="dcx-block-lbl">{t('discover.ui.sheet.metrics')}</span>
                  <span className="dcx-source-tag">
                    {pickedProto.dataSource === 'defillama'
                      ? t('discover.ui.sheet.sourceDefillama')
                      : t('discover.ui.sheet.sourceCurated')}
                  </span>
                </div>
                <div className="dcx-metrics">
                  {[
                    { label: t('discover.ui.sheet.tvl'), value: detailTvl != null ? fmtUsd(detailTvl) : null },
                    { label: t('discover.ui.sheet.volume'), value: detailVol != null ? fmtUsd(detailVol) : null },
                    {
                      label: t('discover.ui.sheet.change7d'),
                      value: detailChange7d != null ? `${detailChange7d >= 0 ? '+' : ''}${Number(detailChange7d).toFixed(1)}%` : null,
                      tone: detailChange7d != null ? (detailChange7d >= 0 ? 'is-up' : 'is-down') : ''
                    },
                    { label: t('discover.ui.sheet.audits'), value: pickedProto.audits != null ? String(pickedProto.audits) : null }
                  ].map((m) => (
                    <div className="dcx-metric-box" key={m.label}>
                      <span>{m.label}</span>
                      <strong className={m.tone || ''} dir="ltr">
                        {detailLoading ? '…' : (m.value ?? t('discover.ui.sheet.na'))}
                      </strong>
                    </div>
                  ))}
                </div>
                {!detailLoading && detailTvl == null && (
                  <p className="dcx-security-note">{t('discover.ui.sheet.tvlUnavailable')}</p>
                )}
              </div>

              {/* Supported networks with real chain SVG icons */}
              {(pickedProto.chains?.length || 0) > 0 && (
                <section className="dcx-sheet-block">
                  <span className="dcx-block-lbl">{t('discover.ui.sheet.networks')}</span>
                  <div className="dcx-sheet-nets">
                    {(pickedProto.chains || []).map((ch) => (
                      <span key={ch} className="dcx-net-pill">
                        <ChainMark chain={ch} size={15} />
                        <span>{chainLabel(ch, lang)}</span>
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {pickedProto.docs && (
                <div className="dcx-ref-links">
                  <button type="button" className="dcx-ref-link" onClick={() => openUrl(pickedProto.docs)}>
                    <IconGlobe width={13} height={13} />
                    <span>{t('discover.ui.sheet.docs')}</span>
                    <span dir="ltr">{hostOf(pickedProto.docs)}</span>
                    <IconExternal width={12} height={12} />
                  </button>
                </div>
              )}

              {/* Grouped, collapsible security section */}
              <details className="dcx-security">
                <summary>
                  <IconShield width={15} height={15} aria-hidden="true" />
                  <span>{t('discover.ui.sheet.security')}</span>
                  <span className="dcx-source-tag">{t('discover.ui.sheet.securitySummary')}</span>
                  <IconChevronRight className="dcx-safety-chev" width={14} height={14} aria-hidden="true" />
                </summary>
                <div className="dcx-security-body">
                  {!sheetIsRegistry && (
                    <div className="dcx-warn-item is-danger">
                      <IconAlertTriangle width={13} height={13} />
                      <span>{t('discover.ui.warn.unverifiedDomain')}</span>
                    </div>
                  )}
                  {sheetValidation?.warnings?.map((w, i) => (
                    <div key={`v-${i}`} className={`dcx-warn-item ${w.level === 'error' ? 'is-danger' : 'is-warn'}`} role="alert">
                      <IconAlertTriangle width={13} height={13} />
                      <span>{warnText(w, t)}</span>
                    </div>
                  ))}
                  {sheetChainWarns.map((w, i) => (
                    <div key={`c-${i}`} className="dcx-warn-item is-warn">
                      <IconAlertTriangle width={13} height={13} />
                      <span>{warnText(w, t)}</span>
                    </div>
                  ))}
                  {sheetAuditNote && (
                    <div className="dcx-warn-item">
                      <IconAlertTriangle width={13} height={13} />
                      <span>{warnText({ ...sheetAuditNote, message: sheetAuditNote.text }, t)}</span>
                    </div>
                  )}
                  {auditLinks.length > 0 && (
                    <div className="dcx-ref-links">
                      {auditLinks.slice(0, 4).map((link) => (
                        <button key={link} type="button" className="dcx-ref-link" dir="ltr" onClick={() => openUrl(link)}>
                          <span>{String(link).replace(/^https?:\/\//, '').slice(0, 44)}</span>
                          <IconExternal width={11} height={11} />
                        </button>
                      ))}
                      <p className="dcx-security-note">{t('discover.ui.sheet.auditedNotSafe')}</p>
                    </div>
                  )}
                  <p className="dcx-security-note">{t('discover.ui.sheet.browserNotSafe')}</p>
                  {!sheetValidation?.warnings?.length && !sheetChainWarns.length && !sheetAuditNote && (
                    <p className="dcx-security-note">{t('discover.ui.sheet.noWarnings')}</p>
                  )}
                </div>
              </details>

              {metaInfo?.updatedAt && (
                <p className="dcx-security-note">{t('discover.ui.sheet.updated', { time: timeAgo(metaInfo.updatedAt, lang) })}</p>
              )}

              <footer className="dcx-sheet-actions">
                <div className="dcx-sheet-btns">
                  <button
                    type="button"
                    className="dcx-btn dcx-btn-primary"
                    onClick={doOpen}
                    data-testid="discovery-open"
                    data-legacy-testid="disc-sheet-open"
                  >
                    <IconExternal width={15} height={15} />
                    <span>{t('discover.ui.sheet.open')}</span>
                  </button>
                  <button
                    type="button"
                    className="dcx-btn dcx-btn-ghost"
                    onClick={copyLink}
                    aria-label={t('discover.ui.sheet.copy')}
                    title={t('discover.ui.sheet.copy')}
                  >
                    <IconCopy width={15} height={15} />
                  </button>
                </div>
                <p className="dcx-sheet-hint">{t('discover.ui.sheet.hint')}</p>
              </footer>
            </div>
          )}
        </Sheet>
      </div>
    </PageTransition>
  );
}
