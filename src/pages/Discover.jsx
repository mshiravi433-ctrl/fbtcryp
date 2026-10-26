import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import Sheet from '../components/Sheet';
import InfoBox from '../components/InfoBox';
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
  DISCOVERY_CATEGORIES, DISCOVERY_PROTOCOLS, NETWORK_FILTERS, CHAIN_ALIASES, faviconFor, hostOf
} from '../lib/discoveryRegistry';
import { parseAiQuery, aiExamplesFor } from '../lib/discoveryAi';
import { buildSuggestions, rankProtocols, smartSummary } from '../lib/discoverySearch';
import { descriptionFor, chainLabel } from '../lib/discoveryLocalized';
import { validateDiscoveryUrl, chainSupportWarnings, auditNotice, isRegistryDomain } from '../lib/discoverySecurity';
import '../styles/discovery-center.css';

/**
 * DISCOVER — Explore › کشف
 * ===========================================================================
 * Redesigned as ONE calm surface instead of nine stacked strips.
 *
 *  · Every visible string goes through i18n (fa + en complete). The old screen
 *    hardcoded English, so a Persian user met "Open in FBT Browser" and an
 *    English hero. The button now says «باز کردن در مرورگر» — only «مرورگر»,
 *    never a branded browser name.
 *  · One omnibox, not two search inputs. It ranks the registry, suggests
 *    protocols / categories / networks, understands Persian intent
 *    («وامدهی روی آربیتروم») and remembers recent queries. Full keyboard nav.
 *  · Favorites, recents and trending share one compact "quick access" card.
 *    The results grid is paginated, so the first screen is not 60 cards long.
 *  · Cards are information-dense but quiet; the detail sheet is a modern
 *    bottom sheet with a sticky action bar and one collapsible security block.
 *
 * Data honesty: TVL/volume/change come only from DefiLlama via exploreApi.
 * No source → «ناموجود» / N/A, never zero. Every dApp still opens through
 * openUrl (system Custom Tabs), with the same anti-phishing checks.
 */

// ── Storage ─────────────────────────────────────────────────────────────
const FAV_KEY = 'fbt.discovery.favs.v1';
const RECENT_KEY = 'fbt.discovery.recent.v2';
const QUERY_KEY = 'fbt.discovery.queries.v1';
const LEGACY_RECENT = 'fbt.discover.recent.v1';
const RECENT_MAX = 12;
const FAV_MAX = 40;
const PAGE_SIZE = 12;

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

// ── Small primitives ────────────────────────────────────────────────────
function ProtoLogo({ protocol, size = 42 }) {
  const [failed, setFailed] = useState(false);
  const hue = protocol?.hue || '#7c4dff';
  const domain = protocol?.domain || hostOf(protocol?.url || '');
  const src = domain ? faviconFor(domain, 64) : null;
  const box = {
    '--dcx-hue': hue, width: size, height: size,
    borderRadius: Math.round(size * 0.3), fontSize: Math.round(size * 0.3)
  };
  if (failed || !src) {
    return (
      <span className="dcx-logo" style={box} aria-hidden="true">
        <span className="dcx-logo-fallback">{String(protocol?.name || '?').slice(0, 2).toUpperCase()}</span>
      </span>
    );
  }
  return (
    <span className="dcx-logo" style={box} aria-hidden="true">
      <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    </span>
  );
}

function SectionHead({ title, right }) {
  return (
    <div className="dcx-section-head">
      <h3>{title}</h3>
      {right && <div className="dcx-section-right">{right}</div>}
    </div>
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
  const chains = protocol.chains?.slice(0, 3) || [];
  return (
    <motion.article
      className="dcx-card"
      variants={riseIn}
      whileTap={{ scale: 0.99 }}
      style={{ '--dcx-hue': protocol.hue }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // Do not steal Enter/Space from the nested favorite button.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(protocol); }
      }}
      onClick={() => onOpen(protocol)}
      aria-label={`${protocol.name} — ${t('discover.ui.card.details')}`}
      data-testid={`dc-card-${protocol.id}`}
      data-legacy-id={`disc-card-${protocol.id}`}
    >
      <div className="dcx-card-top">
        <ProtoLogo protocol={protocol} />
        <div className="dcx-card-id">
          <div className="dcx-card-name">
            <span dir="ltr">{protocol.name}</span>
            {protocol.verified && <span className="dcx-verified" title={t('discover.ui.card.verified')} aria-label={t('discover.ui.card.verified')}><IconCheck width={9} height={9} /></span>}
          </div>
          <span className="dcx-card-domain" dir="ltr">{hostOf(protocol.url)}</span>
        </div>
        <button
          type="button"
          className={`dcx-fav ${fav ? 'active' : ''}`}
          aria-label={fav ? t('discover.ui.card.unfavorite') : t('discover.ui.card.favorite')}
          aria-pressed={fav}
          onClick={(e) => { e.stopPropagation(); onFav(protocol.id); }}
        ><IconStar width={14} height={14} /></button>
      </div>

      <p className="dcx-card-desc">{descriptionFor(protocol, lang)}</p>

      <div className="dcx-card-tags">
        {isFeatured && <span className="dcx-tag dcx-tag-featured">✦ {t('discover.ui.card.featured')}</span>}
        <span className="dcx-tag">{catLabel(protocol.category)}</span>
        <span className="dcx-chains" dir="ltr">
          {chains.map((c) => <span key={c} className="dcx-chain" title={chainLabel(c, lang)}>{String(c).slice(0, 3).toUpperCase()}</span>)}
          {(protocol.chains?.length || 0) > 3 && <span className="dcx-chain more">+{protocol.chains.length - 3}</span>}
        </span>
      </div>

      <div className="dcx-card-foot">
        <span className="dcx-card-tvl">
          <span>{t('discover.ui.card.tvl')}</span>
          {live?.tvl != null
            ? <strong dir="ltr">{fmtCompact(live.tvl)}</strong>
            : <span className="dcx-faint" dir="ltr">{t('discover.ui.card.na')}</span>}
        </span>
        <span className="dcx-card-go" aria-hidden="true">
          {t('discover.ui.card.details')}<IconChevronRight width={13} height={13} />
        </span>
      </div>
    </motion.article>
  );
}

// ══════════════════════════════════════════════════════════════════════════
export default function Discover({ embedded = false }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const wallet = useWallet();
  const lang = i18n.language?.slice(0, 2) || 'en';
  const isFa = lang === 'fa';

  // ── Filters & search ──────────────────────────────────────────────────
  const [cat, setCat] = useState('all');
  const [net, setNet] = useState('all');
  const [sort, setSort] = useState('trending');
  const [q, setQ] = useState('');
  const [queries, setQueries] = useState(loadQueries);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [quickTab, setQuickTab] = useState('trending');
  const searchWrapRef = useRef(null);
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
    return NETWORK_FILTERS.find((n) => n.id === id)?.short || id;
  }, [t]);
  const sortLabel = useCallback((id) => {
    if (id === 'security') return t('discover.ui.smart.security');
    if (id === 'new') return t('discover.ui.smart.new');
    if (id === 'compare') return t('discover.ui.smart.compare');
    return t(`discover.ui.sort.${id}`, id);
  }, [t]);
  const ui = useCallback((path, fallback, opts) => t(`discover.ui.${path}`, { defaultValue: fallback, ...(opts || {}) }), [t]);
  const examples = useMemo(() => aiExamplesFor(lang), [lang]);

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
    const allowed = ['trending', 'tvl', 'volume', 'name', 'favorites', 'new'];
    setSort(allowed.includes(parsed?.sort) ? parsed.sort : 'trending');
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
        id: `cat:${c.id}`, type: 'category', label: catLabel(c.id), sub: ui('search.categories', 'Categories'),
        onSelect: () => { setCat(c.id); setQ(''); setSuggestOpen(false); setVisible(PAGE_SIZE); scrollToResults(); }
      });
    }
    for (const n of s.networks) {
      items.push({
        id: `net:${n.id}`, type: 'network', label: n.short, sub: ui('search.networks', 'Networks'),
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
    if (!suggestOpen) return undefined;
    const onDown = (e) => {
      if (!searchWrapRef.current?.contains(e.target)) setSuggestOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [suggestOpen]);

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
    setVisible(PAGE_SIZE); setSuggestOpen(false);
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

    // A relevance-ranked search keeps its order until the user picks a sort.
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
      {!embedded && (
        <div className="row" style={{ gap: 10, marginBottom: 2 }}>
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 19, margin: 0 }}>{t('discover.title', 'Discover')}</h1>
        </div>
      )}

      {/* ── HERO + OMNIBOX ─────────────────────────────────────────────── */}
      <motion.section className="dcx-hero" variants={riseIn} initial="hidden" animate="show">
        {/* Decorative layers live in their own clipped box: the hero itself
            must NOT clip, or the search suggestions popover gets cut off. */}
        <div className="dcx-hero-decor" aria-hidden="true">
          <div className="dcx-hero-aurora" />
          <div className="dcx-hero-grid" />
        </div>
        <div className="dcx-hero-inner">
          <div className="dcx-hero-top">
            <span className="dcx-kicker"><IconGlobe width={12} height={12} /> {t('discover.ui.hero.kicker')}</span>
            <span className={`dcx-live ${trendingErr ? 'offline' : ''}`}>
              <i aria-hidden="true" /> {trendingErr ? t('discover.ui.hero.offline') : t('discover.ui.hero.live')}
            </span>
          </div>

          <h2 className="dcx-hero-title">
            {t('discover.ui.hero.title')}<span>{t('discover.ui.hero.titleAccent')}</span>
          </h2>
          <p className="dcx-hero-sub">{t('discover.ui.hero.subtitle')}</p>

          <div className="dcx-search-wrap" ref={searchWrapRef}>
            <div className={`dcx-search ${suggestOpen ? 'focused' : ''}`}>
              <IconSearch className="dcx-search-icon" width={17} height={17} aria-hidden="true" />
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
                <button type="button" className="dcx-search-clear" onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label={t('discover.ui.search.clear')}>
                  <IconX width={14} height={14} />
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
                      className={`dcx-suggest-item ${highlight === i ? 'active' : ''} ${item.type === 'smart' ? 'smart' : ''}`}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => item.onSelect()}
                    >
                      <span className="dcx-suggest-icon" aria-hidden="true">
                        {item.type === 'protocol' ? <ProtoLogo protocol={item.protocol} size={26} />
                          : item.type === 'smart' ? <IconSparkle width={14} height={14} />
                            : item.type === 'category' ? <IconGlobe width={14} height={14} />
                              : item.type === 'network' ? <IconTrend width={14} height={14} />
                                : item.type === 'recent' || item.type === 'example' ? <IconClock width={14} height={14} />
                                  : <IconSearch width={14} height={14} />}
                      </span>
                      <span className="dcx-suggest-text">
                        <span className="dcx-suggest-label" dir={item.type === 'protocol' ? 'ltr' : 'auto'}>{item.label}</span>
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
            <span><strong dir="ltr">{DISCOVERY_PROTOCOLS.length}</strong> {t('discover.ui.hero.statProtocols')}</span>
            <span><strong dir="ltr">{NETWORK_FILTERS.length - 1}</strong> {t('discover.ui.hero.statNetworks')}</span>
            <span className="dcx-stat-source">{t('discover.ui.hero.statSource')}</span>
          </div>
        </div>
      </motion.section>

      {/* ── QUICK ACCESS (trending / favorites / recents in ONE card) ───── */}
      {(trendingStrip.length > 0 || favItems.length > 0 || recentItems.length > 0) && (
        <motion.section className="dcx-quick" variants={riseIn} initial="hidden" animate="show">
          <SectionHead
            title={t('discover.ui.quick.title')}
            right={<span className="dcx-ondevice"><IconSparkle width={11} height={11} /> {t('discover.ui.smart.onDevice')}</span>}
          />
          <div className="dcx-segmented" role="tablist" aria-label={t('discover.ui.quick.title')}>
            {[
              { id: 'trending', label: t('discover.ui.quick.trending'), Icon: IconTrend, count: trendingStrip.length },
              { id: 'favorites', label: t('discover.ui.quick.favorites'), Icon: IconStar, count: favItems.length },
              { id: 'recent', label: t('discover.ui.quick.recent'), Icon: IconClock, count: recentItems.length }
            ].map(({ id, label, Icon, count }) => (
              <button key={id} type="button" role="tab" aria-selected={quickTab === id}
                className={quickTab === id ? 'active' : ''}
                onClick={() => { haptic?.('light'); setQuickTab(id); }}>
                <Icon width={13} height={13} aria-hidden="true" /> {label}
                {count > 0 && <span className="dcx-seg-count">{count}</span>}
              </button>
            ))}
          </div>
          {quickItems.length > 0 ? (
            <div className="dcx-quick-row">
              {quickItems.map(({ protocol, change }) => (
                <button key={`${quickTab}-${protocol.id}`} type="button" className="dcx-quick-item"
                  style={{ '--dcx-hue': protocol.hue }} onClick={() => pick(protocol)}>
                  <ProtoLogo protocol={protocol} size={28} />
                  <span dir="ltr">{protocol.name}</span>
                  {change != null && <span className="dcx-change" dir="ltr" style={{ color: change >= 0 ? 'var(--up)' : 'var(--down)' }}>
                    {change >= 0 ? '+' : ''}{Number(change).toFixed(1)}%
                  </span>}
                </button>
              ))}
            </div>
          ) : <p className="dcx-quick-empty">{quickEmpty}</p>}
        </motion.section>
      )}

      {/* ── FILTER TOOLBAR ──────────────────────────────────────────────── */}
      <div className="dcx-toolbar" ref={resultsRef}>
        <div className="dcx-chips" role="tablist" aria-label={t('discover.ui.filters.category')}>
          {DISCOVERY_CATEGORIES.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={cat === c.id}
              className={`dcx-chip ${cat === c.id ? 'active' : ''}`}
              onClick={() => { haptic?.('light'); setCat(c.id); setVisible(PAGE_SIZE); }}>
              {catLabel(c.id)}
            </button>
          ))}
        </div>
        <div className="dcx-toolbar-row">
          <label className="dcx-select">
            <IconGlobe width={14} height={14} aria-hidden="true" />
            <select value={net} onChange={(e) => { setNet(e.target.value); setVisible(PAGE_SIZE); }} aria-label={t('discover.ui.filters.network')}>
              {NETWORK_FILTERS.map((n) => <option key={n.id} value={n.id}>{n.id === 'all' ? t('discover.ui.filters.allNetworks') : n.short}</option>)}
            </select>
            <IconChevronRight width={12} height={12} aria-hidden="true" />
          </label>
          <label className="dcx-select">
            <IconTrend width={14} height={14} aria-hidden="true" />
            <select value={sort} onChange={(e) => { setSort(e.target.value); setVisible(PAGE_SIZE); }} aria-label={t('discover.ui.filters.sort')}>
              {['trending', 'tvl', 'volume', 'name', 'favorites', 'new'].map((id) => (
                <option key={id} value={id}>{sortLabel(id)}</option>
              ))}
            </select>
            <IconChevronRight width={12} height={12} aria-hidden="true" />
          </label>
          {activeFilters && (
            <button type="button" className="dcx-reset" onClick={clearAll}>
              <IconX width={12} height={12} /> {t('discover.ui.filters.reset')}
            </button>
          )}
        </div>
      </div>

      {/* ── RESULTS ─────────────────────────────────────────────────────── */}
      <SectionHead
        title={q.trim() ? t('discover.ui.filters.resultsFor', { q: q.trim() }) : t('discover.ui.filters.results')}
        right={<>
          <span className="dcx-count" dir="ltr">{t('discover.ui.filters.count', { count: filtered.length })}</span>
          {trendingErr && <span className="dcx-live-bad">{t('discover.ui.filters.liveOffShort')}</span>}
        </>}
      />

      {trendingLoading && !shown.length && (
        <div className="dcx-grid">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="dcx-skel" />)}</div>
      )}

      {filtered.length > 0 ? (
        <>
          <motion.div className="dcx-grid" variants={stagger} initial="hidden" animate="show">
            {shown.map((p) => (
              <ProtocolCard key={p.id} protocol={p} live={liveFor(p)} lang={lang}
                fav={favs.includes(p.id)} onFav={toggleFav} onOpen={pick}
                isFeatured={Boolean(p.featured)} t={t} catLabel={catLabel} />
            ))}
          </motion.div>
          {visible < filtered.length && (
            <button type="button" className="dcx-more" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
              {t('discover.ui.filters.showMore', { count: filtered.length - visible })}
              <IconChevronRight width={14} height={14} />
            </button>
          )}
          {visible >= filtered.length && filtered.length > PAGE_SIZE && (
            <p className="dcx-all-shown">{t('discover.ui.filters.showAll')}</p>
          )}
        </>
      ) : !trendingLoading && (
        <div className="dcx-empty">
          <span className="dcx-empty-icon"><IconSearch width={20} height={20} /></span>
          <h3>{t('discover.ui.empty.title')}</h3>
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

      {/* ── MODERN DETAIL SHEET ────────────────────────────────────────── */}
      <Sheet open={Boolean(pickedProto)} onClose={closeSheet} anchor="bottom" size="lg" className="dcx-sheet disc-sheet" testId="disc-sheet">
        {pickedProto && (
          <div className="dcx-sheet-body" style={{ '--dcx-hue': pickedProto.hue }}>
            <header className="dcx-sheet-hero">
              <div className="dcx-sheet-glow" aria-hidden="true" />
              <button type="button" className="dcx-sheet-close" onClick={closeSheet} aria-label={t('discover.ui.sheet.close')}>
                <IconX width={15} height={15} />
              </button>
              <div className="dcx-sheet-head">
                <ProtoLogo protocol={pickedProto} size={56} />
                <div className="dcx-sheet-id">
                  <div className="dcx-sheet-name" dir="ltr">{pickedProto.name}</div>
                  <div className="dcx-sheet-tags">
                    {pickedProto.verified && <span className="dcx-sheet-pill good"><IconCheck width={10} height={10} /> {t('discover.ui.sheet.verifiedDomain')}</span>}
                    <span className="dcx-sheet-pill">{catLabel(pickedProto.category)}</span>
                  </div>
                </div>
                <button type="button" className={`dcx-fav ${favs.includes(pickedProto.id) ? 'active' : ''}`}
                  aria-label={favs.includes(pickedProto.id) ? t('discover.ui.card.unfavorite') : t('discover.ui.card.favorite')}
                  aria-pressed={favs.includes(pickedProto.id)}
                  onClick={() => toggleFav(pickedProto.id)}>
                  <IconStar width={15} height={15} />
                </button>
              </div>
              <div className="dcx-domain" dir="ltr">
                <IconShield width={14} height={14} aria-hidden="true" />
                <span className="dcx-domain-label">{t('discover.ui.sheet.officialDomain')}</span>
                <span className="dcx-domain-host">{hostOf(pickedProto.url)}</span>
                <span className="dcx-https">https</span>
              </div>
            </header>

            <div className="dcx-sheet-content">
              <p className="dcx-sheet-desc">{descriptionFor(pickedProto, lang)}</p>

              <div className="dcx-metrics">
                {[
                  { label: t('discover.ui.sheet.tvl'), value: detailTvl != null ? fmtUsd(detailTvl) : null },
                  { label: t('discover.ui.sheet.volume'), value: detailVol != null ? fmtUsd(detailVol) : null },
                  { label: t('discover.ui.sheet.change7d'), value: detailChange7d != null ? `${detailChange7d >= 0 ? '+' : ''}${Number(detailChange7d).toFixed(1)}%` : null, color: detailChange7d != null ? (detailChange7d >= 0 ? 'var(--up)' : 'var(--down)') : undefined },
                  { label: t('discover.ui.sheet.audits'), value: pickedProto.audits != null ? String(pickedProto.audits) : null }
                ].map((m) => (
                  <div className="dcx-metric" key={m.label}>
                    <span className="dcx-metric-label">{m.label}</span>
                    <span className="dcx-metric-value" dir="ltr" style={m.color ? { color: m.color } : undefined}>
                      {detailLoading ? '…' : (m.value ?? <span className="dcx-faint">{t('discover.ui.sheet.na')}</span>)}
                    </span>
                  </div>
                ))}
              </div>
              {!detailLoading && detailTvl == null && (
                <p className="dcx-note">{t('discover.ui.sheet.tvlUnavailable')}</p>
              )}

              <section className="dcx-sheet-block">
                <h4>{t('discover.ui.sheet.networks')}</h4>
                <div className="dcx-chain-list">
                  {(pickedProto.chains || []).map((ch) => (
                    <span key={ch} className="dcx-chain-chip">{chainLabel(ch, lang)}</span>
                  ))}
                </div>
              </section>

              {pickedProto.docs && (
                <button type="button" className="dcx-docs" onClick={() => openUrl(pickedProto.docs)}>
                  <IconExternal width={13} height={13} /> {t('discover.ui.sheet.docs')}
                  <span dir="ltr">{hostOf(pickedProto.docs)}</span>
                </button>
              )}

              <details className="dcx-security">
                <summary>
                  <IconShield width={15} height={15} aria-hidden="true" />
                  <span className="dcx-security-title">{t('discover.ui.sheet.security')}</span>
                  <span className="dcx-security-sub">{t('discover.ui.sheet.securitySummary')}</span>
                  <IconChevronRight className="dcx-security-chev" width={14} height={14} aria-hidden="true" />
                </summary>
                <div className="dcx-security-body">
                  {!sheetIsRegistry && <p className="dcx-warn error"><IconAlertTriangle width={13} height={13} /> {t('discover.ui.warn.unverifiedDomain')}</p>}
                  {sheetValidation?.warnings?.map((w, i) => (
                    <p key={`v-${i}`} className={`dcx-warn ${w.level === 'error' ? 'error' : ''}`} role="alert">
                      <IconAlertTriangle width={13} height={13} /> {warnText(w, t)}
                    </p>
                  ))}
                  {sheetChainWarns.map((w, i) => (
                    <p key={`c-${i}`} className="dcx-warn"><IconAlertTriangle width={13} height={13} /> {warnText(w, t)}</p>
                  ))}
                  {sheetAuditNote && <p className="dcx-warn"><IconAlertTriangle width={13} height={13} /> {warnText({ ...sheetAuditNote, message: sheetAuditNote.text }, t)}</p>}
                  {auditLinks.length > 0 && (
                    <div className="dcx-audits">
                      <span className="dcx-audits-title">{t('discover.ui.sheet.auditReports')}</span>
                      {auditLinks.slice(0, 4).map((link) => (
                        <button key={link} type="button" className="dcx-audit-link" dir="ltr" onClick={() => openUrl(link)}>
                          {String(link).replace(/^https?:\/\//, '').slice(0, 52)}
                        </button>
                      ))}
                      <p className="dcx-note">{t('discover.ui.sheet.auditedNotSafe')}</p>
                    </div>
                  )}
                  <p className="dcx-warn neutral"><IconShield width={13} height={13} /> {t('discover.ui.sheet.browserNotSafe')}</p>
                  {!sheetValidation?.warnings?.length && !sheetChainWarns.length && !sheetAuditNote && (
                    <p className="dcx-note">{t('discover.ui.sheet.noWarnings')}</p>
                  )}
                </div>
              </details>

              <div className="dcx-source">
                <span className="dcx-source-pill">{t('discover.ui.sheet.source')}: {pickedProto.dataSource === 'defillama' ? t('discover.ui.sheet.sourceDefillama') : t('discover.ui.sheet.sourceCurated')}</span>
                {metaInfo?.updatedAt && <span>{t('discover.ui.sheet.updated', { time: timeAgo(metaInfo.updatedAt, lang) })}</span>}
              </div>
            </div>

            <footer className="dcx-sheet-actions">
              <div className="dcx-sheet-buttons">
                <button type="button" className="dcx-primary" onClick={doOpen}
                  data-testid="discovery-open" data-legacy-testid="disc-sheet-open">
                  <IconExternal width={15} height={15} /> {t('discover.ui.sheet.open')}
                </button>
                <button type="button" className="dcx-icon-btn" onClick={copyLink} aria-label={t('discover.ui.sheet.copy')} title={t('discover.ui.sheet.copy')}>
                  <IconCopy width={15} height={15} />
                </button>
              </div>
              <p className="dcx-sheet-hint">{t('discover.ui.sheet.hint')}</p>
            </footer>
          </div>
        )}
      </Sheet>
    </PageTransition>
  );
}
