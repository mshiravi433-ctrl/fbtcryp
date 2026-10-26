import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import Sheet from '../components/Sheet';
import InfoBox from '../components/InfoBox';
import CoinLogo from '../components/CoinLogo';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { useAppStore } from '../store/useAppStore';
import { openUrl } from '../lib/browser';
import {
  IconChevronLeft, IconCopy, IconExternal, IconSearch, IconShield, IconStar, IconRefresh, IconTrend, IconClock
} from '../components/Icons';
import { usePoll } from '../hooks/useMarket';
import { getTrending } from '../lib/api';
import { exploreApi, intelErrorCode } from '../lib/intelApi';
import { fmtCompact, fmtUsd, timeAgo } from '../lib/format';
import {
  DISCOVERY_CATEGORIES, DISCOVERY_PROTOCOLS, NETWORK_FILTERS, CHAIN_ALIASES, faviconFor, hostOf
} from '../lib/discoveryRegistry';
import { parseAiQuery, filterByAiQuery, aiExplanation, AI_EXAMPLES } from '../lib/discoveryAi';
import { validateDiscoveryUrl, chainSupportWarnings, auditNotice, isRegistryDomain } from '../lib/discoverySecurity';
import '../styles/discovery-center.css';

/**
 * DISCOVER — Web3 Discovery Center
 * Upgraded from a static curated list into a premium, interactive discovery
 * surface that satisfies the fbtswap.ir spec:
 *
 *  · Hero with neon glassmorphism
 *  · Smart search + AI Discovery panel (on-device rule fallback)
 *  · Horizontally scrollable categories & network filters
 *  · Featured + Trending strips
 *  · Compact protocol cards with logo, networks, favorites & "Open in FBT Browser"
 *  · Personalized recommendations (wallet chain + recents/favorites)
 *  · Favorites, recents, sorting, skeletons, empty/error states
 *  · Secure internal browser: domain validation, anti-phishing warnings, chain checks
 *  · Protocol detail drawer: TVL/volume/APY, chains, docs, audits, data source, timestamp
 *
 * Data contract: TVL / volume / audit counts shown only when a real source
 * provided them (DefiLlama via exploreApi). Otherwise N/A — never fabricated.
 * All external dApps open through openUrl (Custom Tabs = internal FBT Browser).
 */

// ── Storage keys ────────────────────────────────────────────────────────
const FAV_KEY = 'fbt.discovery.favs.v1';
const RECENT_KEY = 'fbt.discovery.recent.v2';
const LEGACY_RECENT = 'fbt.discover.recent.v1';
const RECENT_MAX = 12;
const FAV_MAX = 40;

function loadArray(key, validator) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(raw)) return [];
    return validator ? raw.filter(validator) : raw;
  } catch { return []; }
}
function loadFavs() { return loadArray(FAV_KEY, x => typeof x === 'string'); }
function loadRecents() {
  // Migrate legacy
  try {
    const cur = localStorage.getItem(RECENT_KEY);
    if (!cur) {
      const leg = localStorage.getItem(LEGACY_RECENT);
      if (leg) localStorage.setItem(RECENT_KEY, leg);
    }
  } catch {}
  const allowed = new Set(DISCOVERY_PROTOCOLS.map(p => p.id));
  return loadArray(RECENT_KEY, x => allowed.has(x)).slice(0, RECENT_MAX);
}

// ── Logo ────────────────────────────────────────────────────────────────
function ProtoLogo({ protocol, size = 44, fallbackHue }) {
  const [failed, setFailed] = useState(false);
  const hue = protocol?.hue || fallbackHue || '#7c4dff';
  const domain = protocol?.domain || hostOf(protocol?.url || '');
  const src = domain ? faviconFor(domain, 64) : null;

  if (failed || !src) {
    return (
      <span className="dc-card-logo" style={{ '--card-hue': hue, width: size, height: size, borderRadius: size <= 28 ? 8 : 13, fontSize: Math.round(size * 0.34) }} aria-hidden="true">
        <span className="dc-card-logo-fallback">{String(protocol?.name || '?').slice(0, 2).toUpperCase()}</span>
      </span>
    );
  }
  return (
    <span className="dc-card-logo" style={{ '--card-hue': hue, width: size, height: size, borderRadius: size <= 28 ? 8 : 13 }}>
      <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} style={{ width: Math.round(size*0.64), height: Math.round(size*0.64) }} />
    </span>
  );
}

// ── Skeletons ───────────────────────────────────────────────────────────
function CardSkeleton() {
  return <div className="dc-skel dc-skel-card" aria-hidden="true" />;
}
function RowSkeletons({ count = 3 }) {
  return <>{Array.from({ length: count }).map((_, i) => <div key={i} className="dc-skel dc-skel-row" />)}</>;
}

// ── Protocol card ──────────────────────────────────────────────────────
function ProtocolCard({ protocol, live, fav, onFav, onOpen, isFeatured }) {
  const { t } = useTranslation();
  const tvl = live?.tvl ?? null;
  const vol = live?.volume_24h ?? null;
  const ch = protocol.chains?.slice(0, 4) || [];

  return (
    <motion.article
      className="dc-card disc-card"
      variants={riseIn}
      whileTap={{ scale: 0.985 }}
      style={{ '--card-hue': protocol.hue, '--disc-hue': protocol.hue }}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(protocol); }}
      onClick={() => onOpen(protocol)}
      aria-label={`${protocol.name} — ${hostOf(protocol.url)}`}
      data-testid={`dc-card-${protocol.id}`}
      data-legacy-id={`disc-card-${protocol.id}`}
    >
      <div className="dc-card-head">
        <ProtoLogo protocol={protocol} />
        <div className="dc-card-titles">
          <div className="dc-card-name">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{protocol.name}</span>
            {protocol.verified && <span className="dc-card-verified" title={t('discover.verified', 'Verified')}>✓</span>}
            {isFeatured && <span className="pill pill-up" style={{ fontSize: 9 }}>★ Featured</span>}
          </div>
          <span className="dc-card-domain">{hostOf(protocol.url)}</span>
        </div>
        <button
          type="button"
          className={`dc-fav ${fav ? 'active' : ''}`}
          aria-label={fav ? 'Remove favorite' : 'Add favorite'}
          aria-pressed={fav}
          onClick={e => { e.stopPropagation(); onFav(protocol.id); }}
        >
          <IconStar width={14} height={14} />
        </button>
      </div>

      <p className="dc-card-desc">{protocol.description}</p>

      <div className="dc-card-meta">
        <span className="dc-card-cat">{DISCOVERY_CATEGORIES.find(c=>c.id===protocol.category)?.label || protocol.category}</span>
        <span className="dc-card-chains" aria-label={`Supports ${ch.join(', ')}`}>
          {ch.map(c => (
            <span key={c} className="dc-chain-pill" title={c}>{String(c).slice(0,3).toUpperCase()}</span>
          ))}
          {(protocol.chains?.length || 0) > 4 && <span className="faint" style={{ fontSize: 10 }}>+{protocol.chains.length - 4}</span>}
        </span>
      </div>

      <div className="dc-card-stats">
        <div className="dc-stat">
          <span className="dc-stat-label">TVL</span>
          <span className="dc-stat-value">{tvl != null ? fmtCompact(tvl) : <span className="faint">N/A</span>}</span>
        </div>
        <div className="dc-stat">
          <span className="dc-stat-label">24h Vol</span>
          <span className="dc-stat-value">{vol != null ? fmtCompact(vol) : <span className="faint">N/A</span>}</span>
        </div>
        <div className="dc-stat">
          <span className="dc-stat-label">Audits</span>
          <span className="dc-stat-value">{protocol.audits != null ? `✓ ${protocol.audits}` : <span className="faint">N/A</span>}</span>
        </div>
      </div>

      <div className="dc-card-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={e => { e.stopPropagation(); onOpen(protocol); }}
          data-testid={`dc-open-${protocol.id}`}
        >
          <IconExternal width={13} height={13} /> Open in FBT Browser
        </button>
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

  // ── Filters ──────────────────────────────────────────────────────────
  const [cat, setCat] = useState('all');
  const [net, setNet] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('trending'); // trending | tvl | volume | name | favorites
  const [aiInput, setAiInput] = useState('');
  const [aiParsed, setAiParsed] = useState(null);
  const [aiResults, setAiResults] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);

  // ── Live data ────────────────────────────────────────────────────────
  const [trendingData, setTrendingData] = useState(null);
  const [trendingErr, setTrendingErr] = useState(null);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [protocolListData, setProtocolListData] = useState(null);
  const [protocolLiveMap, setProtocolLiveMap] = useState({}); // slug -> live row
  const [metaInfo, setMetaInfo] = useState(null);

  // ── UX state ─────────────────────────────────────────────────────────
  const [picked, setPicked] = useState(null); // protocol id for sheet
  const pickedProto = useMemo(() => picked ? DISCOVERY_PROTOCOLS.find(p=>p.id===picked) : null, [picked]);
  const [favs, setFavs] = useState(loadFavs);
  const [recents, setRecents] = useState(loadRecents);
  const [detailLive, setDetailLive] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const searchRef = useRef(null);

  const { data: marketTrending } = usePoll(getTrending, [], 300000);

  // ── Fetch live protocol data ─────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    setTrendingLoading(true);
    exploreApi.trending().then(res => {
      if (!alive) return;
      setTrendingData(res?.data || null);
      setMetaInfo(res?.meta || null);
      setTrendingErr(null);
      // Build slug -> live lookup for cards
      const all = [...(res?.data?.trending||[]), ...(res?.data?.rising||[]), ...(res?.data?.highLiquidity||[])];
      const map = {};
      for (const p of all) if (p.slug && !map[p.slug]) map[p.slug] = p;
      setProtocolLiveMap(map);
    }).catch(e => {
      if (!alive) return;
      setTrendingErr(intelErrorCode(e));
    }).finally(() => { if (alive) setTrendingLoading(false); });

    // Full protocol list for TVL sorting — best-effort, never blocks hero
    exploreApi.protocols({ limit: 80, sort: 'tvl' }).then(res => {
      if (!alive) return;
      setProtocolListData(res?.data?.protocols || null);
      // Merge into live map
      const rows = res?.data?.protocols || [];
      setProtocolLiveMap(prev => {
        const next = { ...prev };
        for (const r of rows) if (r.slug && !next[r.slug]) next[r.slug] = r;
        return next;
      });
    }).catch(()=>{});

    return () => { alive = false; };
  }, []);

  // ── Detail live fetch when sheet opens ────────────────────────────────
  useEffect(() => {
    if (!pickedProto) { setDetailLive(null); return; }
    const slug = pickedProto.slug || pickedProto.id;
    if (!slug) return;
    setDetailLoading(true);
    exploreApi.protocol(slug).then(res => {
      setDetailLive(res?.data || null);
      if (res?.meta) setMetaInfo(res.meta);
    }).catch(()=> setDetailLive(null))
      .finally(()=> setDetailLoading(false));
  }, [pickedProto]);

  // Also merge list data live rows by name fallback
  const liveByName = useMemo(() => {
    const m = { ...protocolLiveMap };
    if (protocolListData) for (const r of protocolListData) {
      if (r.name && !m[r.slug||r.name.toLowerCase()]) m[r.name.toLowerCase()] = r;
    }
    return m;
  }, [protocolLiveMap, protocolListData]);

  function liveFor(p) {
    if (!p) return null;
    return liveByName[p.slug] || liveByName[p.name?.toLowerCase()] || liveByName[p.id] || null;
  }

  // ── Favorites & recents ──────────────────────────────────────────────
  const toggleFav = useCallback((id) => {
    haptic?.('light');
    setFavs(prev => {
      const next = prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id].slice(0, FAV_MAX);
      try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [haptic]);

  const rememberRecent = useCallback((id) => {
    try {
      const next = [id, ...loadRecents().filter(x=>x!==id)].slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setRecents(next);
    } catch {}
  }, []);

  // ── Pick / open ───────────────────────────────────────────────────────
  const pick = useCallback((proto) => {
    haptic?.('light');
    setPicked(proto.id);
  }, [haptic]);

  const closeSheet = useCallback(() => setPicked(null), []);

  const doOpen = useCallback(async () => {
    if (!pickedProto) return;
    haptic?.('medium');
    rememberRecent(pickedProto.id);
    const check = validateDiscoveryUrl(pickedProto.url);
    if (check.blocked) {
      useAppStore.getState().notify(check.warnings[0]?.message || 'Blocked', 'error');
      return;
    }
    await openUrl(pickedProto.url);
  }, [pickedProto, haptic, rememberRecent]);

  const copyLink = useCallback(() => {
    if (!pickedProto) return;
    navigator.clipboard?.writeText(pickedProto.url);
    haptic?.('success');
    useAppStore.getState().notify(t('discover.sheet.copied', 'Link copied'), 'success');
  }, [pickedProto, haptic, t]);

  // ── AI Discovery ──────────────────────────────────────────────────────
  const runAi = useCallback(async (text) => {
    const raw = String(text||'').trim();
    if (!raw) { setAiParsed(null); setAiResults(null); return; }
    const parsed = parseAiQuery(raw);
    setAiParsed(parsed);
    setAiBusy(true);
    try {
      const filtered = filterByAiQuery(DISCOVERY_PROTOCOLS, parsed);
      setAiResults(filtered.slice(0, 18));
      // Optionally augment with live search
      if (parsed?.keywords?.length) {
        try {
          const r = await exploreApi.protocols({ q: parsed.keywords[0], limit: 12 });
          // Merge any extra slugs not in registry (e.g. fresh protocols)
        } catch {}
      }
    } finally { setAiBusy(false); }
  }, []);

  const handleAiSubmit = useCallback(() => {
    if (!aiInput.trim()) return;
    runAi(aiInput);
  }, [aiInput, runAi]);

  // ── Filtering ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...DISCOVERY_PROTOCOLS];

    // Text search
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(p => {
        const hay = `${p.name} ${p.domain} ${p.description||''} ${p.category} ${p.chains?.join(' ')}`.toLowerCase();
        return hay.includes(needle) || hostOf(p.url).includes(needle);
      });
    }

    // Category
    if (cat !== 'all') {
      list = list.filter(p => p.category === cat);
    }

    // Network filter
    if (net !== 'all') {
      const aliases = CHAIN_ALIASES[net] || [net];
      list = list.filter(p => {
        const hay = [...(p.chains||[]), ...(p.chainIds||[]).map(String)].join(' ').toLowerCase();
        return aliases.some(a => hay.includes(a.toLowerCase()));
      });
    }

    // Sort
    if (sort === 'favorites') {
      list = [...list].sort((a,b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0) || a.name.localeCompare(b.name));
    } else if (sort === 'tvl') {
      list = [...list].sort((a,b) => {
        const av = liveFor(a)?.tvl ?? -1;
        const bv = liveFor(b)?.tvl ?? -1;
        if (bv !== av) return bv - av;
        return a.name.localeCompare(b.name);
      });
    } else if (sort === 'volume') {
      list = [...list].sort((a,b) => {
        const av = liveFor(a)?.volume_24h ?? -1;
        const bv = liveFor(b)?.volume_24h ?? -1;
        return bv - av;
      });
    } else if (sort === 'name') {
      list.sort((a,b)=>a.name.localeCompare(b.name));
    } else if (sort === 'new') {
      // Fresh first (non-featured)
      list.sort((a,b)=> (a.featured?1:0) - (b.featured?1:0));
    }
    // trending default keeps featured first then name
    else if (sort === 'trending') {
      list.sort((a,b)=>{
        const af = a.featured ? 0 : 1;
        const bf = b.featured ? 0 : 1;
        if (af !== bf) return af - bf;
        const av = Math.abs(liveFor(a)?.change_1d ?? 0) * Math.log10(1 + (liveFor(a)?.tvl||1));
        const bv = Math.abs(liveFor(b)?.change_1d ?? 0) * Math.log10(1 + (liveFor(b)?.tvl||1));
        if (bv !== av) return bv - av;
        return a.name.localeCompare(b.name);
      });
    }

    return list;
  }, [cat, net, q, sort, favs, liveByName]);

  const featured = useMemo(() => DISCOVERY_PROTOCOLS.filter(p=>p.featured).slice(0, 6), []);
  const trendingStrip = useMemo(() => {
    if (trendingData?.trending?.length) return trendingData.trending.slice(0, 8);
    // Fallback to registry featured
    return featured.slice(0, 6).map(p => ({ slug: p.slug||p.id, name: p.name, category: p.category, chains: p.chains, tvl: liveFor(p)?.tvl ?? null, change_1d: liveFor(p)?.change_1d ?? null }));
  }, [trendingData, featured]);

  const favItems = useMemo(() => favs.map(id=>DISCOVERY_PROTOCOLS.find(p=>p.id===id)).filter(Boolean), [favs]);
  const recentItems = useMemo(() => recents.map(id=>DISCOVERY_PROTOCOLS.find(p=>p.id===id)).filter(Boolean), [recents]);

  // Personalized recommendations: same chain as wallet + same categories as favs/recents
  const recommended = useMemo(() => {
    const chainId = wallet?.chainId;
    const favCats = new Set(favItems.map(p=>p.category));
    const recCats = new Set(recentItems.map(p=>p.category));
    let list = DISCOVERY_PROTOCOLS.filter(p => !favs.includes(p.id) && !recents.includes(p.id));
    // Prefer wallet chain
    if (chainId) {
      list = [...list].sort((a,b)=>{
        const ac = a.chainIds?.includes(Number(chainId)) ? 0 : 1;
        const bc = b.chainIds?.includes(Number(chainId)) ? 0 : 1;
        if (ac !== bc) return ac - bc;
        const af = favCats.has(a.category) || recCats.has(a.category) ? 0 : 1;
        const bf = favCats.has(b.category) || recCats.has(b.category) ? 0 : 1;
        return af - bf;
      });
    } else if (favCats.size || recCats.size) {
      list = [...list].sort((a,b)=>{
        const af = favCats.has(a.category) || recCats.has(a.category) ? 0 : 1;
        const bf = favCats.has(b.category) || recCats.has(b.category) ? 0 : 1;
        return af - bf;
      });
    }
    return list.slice(0, 6);
  }, [wallet?.chainId, favItems, recentItems, favs, recents]);

  // ── Sheet derived warnings ────────────────────────────────────────────
  const sheetValidation = useMemo(() => pickedProto ? validateDiscoveryUrl(pickedProto.url) : null, [pickedProto]);
  const sheetChainWarns = useMemo(() => pickedProto ? chainSupportWarnings(pickedProto, wallet?.chainId) : [], [pickedProto, wallet?.chainId]);
  const sheetAuditNote = useMemo(() => pickedProto ? auditNotice(pickedProto) : null, [pickedProto]);
  const sheetIsRegistry = useMemo(() => pickedProto ? true : false, [pickedProto]);
  const detailTvl = detailLive?.tvl ?? liveFor(pickedProto)?.tvl ?? null;
  const detailVol = detailLive?.volume_24h ?? liveFor(pickedProto)?.volume_24h ?? null;

  return (
    <PageTransition embedded={embedded}>
      {/* Header (hidden when inside ExploreHub tabs) */}
      {!embedded && (
        <motion.div className="row" style={{ gap: 10, marginBottom: 2 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={()=>navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 19, margin: 0 }}>{t('discover.title', 'Discover')}</h1>
        </motion.div>
      )}

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <motion.section className="dc-hero" variants={riseIn} initial="hidden" animate="show">
        <div className="dc-hero-bg-orb a" aria-hidden="true" />
        <div className="dc-hero-bg-orb b" aria-hidden="true" />
        <div style={{ position: 'relative' }}>
          <span className="dc-hero-kicker">
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00ff9d', boxShadow: '0 0 8px #00ff9d' }} />
            Explore Web3 · FBT Discovery Center
          </span>
          <h2 className="dc-hero-title">Discover trusted<br />dApps & protocols</h2>
          <p className="dc-hero-sub">
            A curated directory of verified DeFi, bridges, analytics and developer tools — opened safely in FBT Browser with anti-phishing checks.
          </p>

          {/* Hero smart search */}
          <div className="dc-search-wrap" style={{ marginTop: 14 }}>
            <label className="dc-search" aria-label="Search protocols">
              <span className="dc-search-icon" aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                value={q}
                onChange={e=>setQ(e.target.value)}
                placeholder={t('discover.searchPlaceholder', 'Search protocols, dApps, networks… (e.g. Uniswap, lending, Arbitrum)')}
                inputMode="search"
                autoComplete="off"
                spellCheck={false}
              />
              {q && <button type="button" className="dc-search-clear" onClick={()=>setQ('')} aria-label="Clear">✕</button>}
            </label>
            <div className="dc-search-meta">
              <span className="pill pill-neutral" style={{ fontSize: 10.5 }}>{filtered.length} protocols</span>
              {wallet?.address && wallet?.chainId && (
                <span className="pill" style={{ fontSize: 10.5, background: 'rgba(124,77,255,0.14)', borderColor: 'rgba(124,77,255,0.24)' }}>
                  On {NETWORK_FILTERS.find(n=>n.chainId===Number(wallet.chainId))?.short || wallet.chainId}
                </span>
              )}
              {metaInfo?.updatedAt && (
                <span className="faint" style={{ fontSize: 10.5 }}>Updated {timeAgo(metaInfo.updatedAt, i18n.language)} · {metaInfo.source || 'defillama'}</span>
              )}
            </div>
          </div>

          <div className="dc-hero-stats">
            <span className="dc-hero-stat"><strong>{DISCOVERY_PROTOCOLS.length}</strong> curated protocols</span>
            <span className="dc-hero-stat"><strong>{NETWORK_FILTERS.length - 1}</strong> networks</span>
            <span className="dc-hero-stat"><strong>{trendingData ? 'Live' : '—'}</strong> TVL from DefiLlama</span>
          </div>
        </div>
      </motion.section>

      {/* ── AI DISCOVERY ──────────────────────────────────────────────── */}
      <motion.section className="dc-ai" variants={riseIn} initial="hidden" animate="show">
        <div className="dc-ai-head">
          <span className="dc-ai-badge" aria-hidden="true">✦</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="dc-ai-title">AI Discovery</div>
            <div className="dc-ai-sub">Ask in plain language — results stay on-device when AI is offline</div>
          </div>
          <span className="pill pill-neutral" style={{ fontSize: 10 }}>on-device</span>
        </div>

        <div className="dc-ai-input">
          <input
            value={aiInput}
            onChange={e=>setAiInput(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') handleAiSubmit(); }}
            placeholder="Find lending protocols on Arbitrum"
            aria-label="AI discovery natural language search"
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={handleAiSubmit} disabled={!aiInput.trim() || aiBusy}>
            {aiBusy ? '…' : <IconSearch width={14} height={14} />} Search
          </button>
        </div>

        <div className="dc-ai-examples">
          {AI_EXAMPLES.map(ex => (
            <button key={ex} type="button" className="dc-ai-ex" onClick={()=>{ setAiInput(ex); runAi(ex); }}>
              {ex}
            </button>
          ))}
        </div>

        {(aiParsed || aiResults) && (
          <div style={{ marginTop: 12 }}>
            {aiParsed && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <span className="faint" style={{ fontSize: 11 }}>Interpreted:</span>
                {aiParsed.category && <span className="pill pill-up" style={{ fontSize: 10.5 }}>{aiParsed.category}</span>}
                {aiParsed.chain && <span className="pill pill-neutral" style={{ fontSize: 10.5 }}>{aiParsed.chain}</span>}
                {aiParsed.wantsSecurity && <span className="pill" style={{ fontSize: 10.5, background:'rgba(124,77,255,0.12)' }}>with security</span>}
                {aiParsed.wantsNew && <span className="pill" style={{ fontSize: 10.5 }}>new</span>}
                <span className="faint mono" style={{ fontSize: 10.5 }}>{aiExplanation(aiParsed)}</span>
              </div>
            )}
            {aiResults && aiResults.length === 0 && (
              <p className="faint" style={{ fontSize: 12, margin: '6px 0 0' }}>No matches for that request. Try a broader term or a different network.</p>
            )}
            {aiResults && aiResults.length > 0 && (
              <div className="dc-grid">
                {aiResults.map(p => (
                  <ProtocolCard key={p.id} protocol={p} live={liveFor(p)} fav={favs.includes(p.id)} onFav={toggleFav} onOpen={pick} />
                ))}
              </div>
            )}
          </div>
        )}
      </motion.section>

      {/* ── Market trending strip (coins) — kept from before, internal links ─ */}
      {Array.isArray(marketTrending) && marketTrending.length > 0 && (
        <motion.section variants={riseIn} initial="hidden" animate="show">
          <div className="dc-section-label"><h3>Trending tokens</h3><span>Live</span></div>
          <div className="tag-scroll">
            {marketTrending.slice(0, 10).map(c => (
              <button key={c.id} className="tag tag-token" onClick={()=>{ haptic?.('light'); navigate(`/coin/${c.id}`); }}>
                <CoinLogo coin={c} size="thumb" px={16} className="coin-chip coin-chip-round" />
                {c.symbol}
              </button>
            ))}
          </div>
        </motion.section>
      )}

      {/* ── Trending dApps strip ───────────────────────────────────────── */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
          <div className="dc-section-label">
            <h3 style={{ display:'flex', gap:6, alignItems:'center' }}><IconTrend width={14} height={14} /> Trending dApps</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setSort('trending')}>View all</button>
          </div>
        {trendingLoading ? (
          <div className="dc-featured"><RowSkeletons count={3} /></div>
        ) : trendingStrip.length > 0 ? (
          <div className="dc-strip">
            {trendingStrip.map(p => {
              const reg = DISCOVERY_PROTOCOLS.find(d=>d.slug===p.slug || d.id===p.slug);
              if (!reg) return null;
              return (
                <button key={p.slug||reg.id} type="button" className="dc-strip-item" style={{ '--card-hue': reg.hue } } onClick={()=>pick(reg)}>
                  <ProtoLogo protocol={reg} size={26} />
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>{reg.name}</span>
                  {p.change_1d != null && <span className="mono" style={{ fontSize: 11, color: p.change_1d>=0?'var(--up)':'var(--down)' }}>{p.change_1d>=0?'+':''}{p.change_1d.toFixed(1)}%</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="faint" style={{ fontSize: 12 }}>Trending temporarily unavailable — showing featured protocols.</p>
        )}
      </motion.section>

      {/* ── Recents strip ───────────────────────────────────────────────── */}
      {recentItems.length > 0 && (
        <motion.section variants={riseIn} initial="hidden" animate="show">
          <div className="dc-section-label">
            <h3 style={{ display:'flex', gap:6, alignItems:'center' }}><IconClock width={14} height={14} /> Recently visited</h3>
            <span className="faint">{recentItems.length}</span>
          </div>
          <div className="dc-strip">
            {recentItems.map(it => (
              <button key={it.id} type="button" className="dc-strip-item" style={{ '--card-hue': it.hue }} onClick={()=>pick(it)}>
                <ProtoLogo protocol={it} size={26} />
                {it.name}
              </button>
            ))}
          </div>
        </motion.section>
      )}

      {/* ── Favorites strip ─────────────────────────────────────────────── */}
      {favItems.length > 0 && (
        <motion.section variants={riseIn} initial="hidden" animate="show">
          <div className="dc-section-label">
            <h3 style={{ display:'flex', gap:6, alignItems:'center' }}><IconStar width={14} height={14} /> Favorites</h3>
            <span className="faint">{favItems.length}</span>
          </div>
          <div className="dc-strip">
            {favItems.map(it => (
              <button key={it.id} type="button" className="dc-strip-item" style={{ '--card-hue': it.hue }} onClick={()=>pick(it)}>
                <ProtoLogo protocol={it} size={26} />
                {it.name}
              </button>
            ))}
          </div>
        </motion.section>
      )}

      {/* ── Personalized recommendations ───────────────────────────────── */}
      {recommended.length > 0 && (favs.length > 0 || recents.length > 0 || wallet?.chainId) && (
        <motion.section variants={riseIn} initial="hidden" animate="show">
          <div className="dc-section-label">
            <h3>Recommended for you</h3>
            <span className="faint">{wallet?.chainId ? `Based on ${NETWORK_FILTERS.find(n=>n.chainId===Number(wallet.chainId))?.short || 'your network'} + favorites` : 'Based on your favorites'}</span>
          </div>
          <div className="dc-strip">
            {recommended.map(p => (
              <button key={p.id} type="button" className="dc-strip-item" style={{ '--card-hue': p.hue }} onClick={()=>pick(p)}>
                <ProtoLogo protocol={p} size={26} />
                {p.name}
              </button>
            ))}
          </div>
        </motion.section>
      )}

      {/* ── Category chips ──────────────────────────────────────────────── */}
      <div className="dc-chip-row" role="tablist" aria-label="Categories">
        {DISCOVERY_CATEGORIES.map(c => (
          <button
            key={c.id}
            role="tab"
            aria-selected={cat===c.id}
            className={`dc-chip ${cat===c.id ? 'active' : ''}`}
            onClick={()=>{ haptic?.('light'); setCat(c.id); }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Network filter + sort ───────────────────────────────────────── */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="dc-chip-row" style={{ flex: 1, minWidth: 0 }} role="tablist" aria-label="Networks">
          {NETWORK_FILTERS.map(n => (
            <button
              key={n.id}
              role="tab"
              aria-selected={net===n.id}
              className={`dc-net-chip ${net===n.id ? 'active' : ''}`}
              style={{ '--net-hue': n.hue }}
              onClick={()=>{ haptic?.('light'); setNet(n.id); }}
            >
              <span className="dc-net-dot" style={{ '--net-hue': n.hue }} />
              {n.short}
            </button>
          ))}
        </div>
        <div className="dc-controls" style={{ flexShrink: 0 }}>
          <select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sort">
            <option value="trending">Trending</option>
            <option value="tvl">TVL</option>
            <option value="volume">Volume</option>
            <option value="name">Name A-Z</option>
            <option value="favorites">Favorites</option>
            <option value="new">Newest</option>
          </select>
        </div>
      </div>

      {/* ── Featured carousel ───────────────────────────────────────────── */}
      {cat==='all' && net==='all' && !q && sort==='trending' && !aiResults && (
        <motion.section variants={stagger} initial="hidden" animate="show">
          <div className="dc-section-label">
            <h3>Featured protocols</h3>
            <span className="faint">{featured.length} curated</span>
          </div>
          <div className="dc-featured">
            {featured.map(p => (
              <div key={p.id} className="dc-featured-card">
                <ProtocolCard protocol={p} live={liveFor(p)} fav={favs.includes(p.id)} onFav={toggleFav} onOpen={pick} isFeatured />
              </div>
            ))}
          </div>
        </motion.section>
      )}

      {/* ── Main grid ───────────────────────────────────────────────────── */}
      <div className="dc-section-label">
        <h3>{q ? `Results for “${q.trim()}”` : DISCOVERY_CATEGORIES.find(c=>c.id===cat)?.label || 'All protocols'} · {filtered.length}</h3>
        {trendingErr && <span className="pill pill-neutral" style={{ fontSize: 10 }}>Live data unavailable — showing registry</span>}
      </div>

      {trendingLoading && !filtered.length && (
        <div className="dc-grid">
          <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      )}

      {trendingErr && filtered.length === 0 && (
        <div className="dc-empty">
          <div className="dc-empty-title">No protocols match</div>
          <p className="dc-empty-note">Try a different category, network or keyword. Live ranking is temporarily unavailable.</p>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={()=>{ setQ(''); setCat('all'); setNet('all'); setSort('trending'); }}>
            Clear filters
          </button>
        </div>
      )}

      {filtered.length > 0 ? (
        <motion.div className="dc-grid disc-grid" variants={stagger} initial="hidden" animate="show">
          {filtered.map(p => (
            <ProtocolCard key={p.id} protocol={p} live={liveFor(p)} fav={favs.includes(p.id)} onFav={toggleFav} onOpen={pick} />
          ))}
        </motion.div>
      ) : (
        !trendingLoading && (
          <motion.div className="dc-empty" variants={riseIn} initial="hidden" animate="show">
            <div className="dc-empty-title">Nothing here matches “{q.trim() || cat}”</div>
            <p className="dc-empty-note">Try another keyword, switch category or clear the network filter to see every protocol.</p>
            <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={()=>{ setQ(''); setCat('all'); setNet('all'); }}>
              Clear filters
            </button>
          </motion.div>
        )
      )}

      <InfoBox title={t('discover.safetyTitle','How we keep you safe in FBT Browser')} tone="warn" id="discover-safety-dc">
        <p>
          Every dApp opens in FBT Browser (Custom Tabs) — the real address bar stays visible and the browser’s TLS warnings apply.
          We never ask you to type an address here; lookalike domains are the #1 phishing vector. If a message says “open this in your wallet”, treat it as suspicious.
          Unverified sites are labeled clearly, and you always approve before connecting a wallet or signing.
        </p>
      </InfoBox>

      {/* ── Protocol detail sheet ───────────────────────────────────────── */}
      <Sheet open={Boolean(pickedProto)} onClose={closeSheet} anchor="bottom" size="lg" className="disc-sheet dc-sheet" testId="disc-sheet">
        {pickedProto && (
          <div className="disc-sheet-body" style={{ '--disc-hue': pickedProto.hue }}>
            <div className="disc-sheet-head">
              <ProtoLogo protocol={pickedProto} size={52} />
              <div className="disc-sheet-title">
                <div className="disc-sheet-name" style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                  {pickedProto.name}
                  {pickedProto.verified && <span className="dc-card-verified" title="Verified">✓</span>}
                </div>
                <span className="disc-sheet-cat">{DISCOVERY_CATEGORIES.find(c=>c.id===pickedProto.category)?.label || pickedProto.category}</span>
              </div>
              <button type="button" className={`dc-fav ${favs.includes(pickedProto.id)?'active':''}`} onClick={()=>toggleFav(pickedProto.id)} aria-label="Favorite">
                <IconStar width={14} height={14} />
              </button>
            </div>

            {/* Official domain — always visible, LTR, monospace */}
            <div className="dc-domain-row" dir="ltr">
              <IconShield width={14} height={14} />
              <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis' }}>{hostOf(pickedProto.url)}</span>
              <span className="pill pill-up" style={{ fontSize: 9, flexShrink:0 }}>https</span>
            </div>
            {!sheetIsRegistry && (
              <div className="dc-warn">
                Unverified domain — not in the curated registry. Proceed only if you trust this URL.
              </div>
            )}

            <p className="disc-sheet-desc" style={{ lineHeight: 1.7 }}>{pickedProto.description}</p>

            {/* Chain support */}
            <div className="row" style={{ gap: 6, flexWrap:'wrap' }}>
              {(pickedProto.chains||[]).map(ch => (
                <span key={ch} className="pill pill-neutral" style={{ fontSize: 10.5 }}>{ch}</span>
              ))}
            </div>

            {/* Stats — live when available, N/A otherwise */}
            <div className="dc-detail-meta">
              <div className="dc-stat">
                <span className="dc-stat-label">TVL</span>
                <span className="dc-stat-value">{detailLoading ? '…' : detailTvl != null ? fmtUsd(detailTvl) : <span className="faint">N/A</span>}</span>
              </div>
              <div className="dc-stat">
                <span className="dc-stat-label">24h Volume</span>
                <span className="dc-stat-value">{detailLoading ? '…' : detailVol != null ? fmtUsd(detailVol) : <span className="faint">N/A</span>}</span>
              </div>
              <div className="dc-stat">
                <span className="dc-stat-label">7d Change</span>
                <span className="dc-stat-value" style={{ color: (detailLive?.change_7d ?? liveFor(pickedProto)?.change_7d ?? 0) >=0 ? 'var(--up)' : 'var(--down)' }}>
                  {detailLoading ? '…' : (detailLive?.change_7d ?? liveFor(pickedProto)?.change_7d) != null ? `${(detailLive?.change_7d ?? liveFor(pickedProto)?.change_7d).toFixed(1)}%` : <span className="faint">N/A</span>}
                </span>
              </div>
              <div className="dc-stat">
                <span className="dc-stat-label">Audits</span>
                <span className="dc-stat-value">{pickedProto.audits != null ? `✓ ${pickedProto.audits}` : <span className="faint">N/A</span>}</span>
              </div>
            </div>
            {!detailLoading && detailLive?.tvl == null && !liveFor(pickedProto)?.tvl && (
              <p className="faint" style={{ fontSize: 11, margin: '4px 0 0' }}>TVL unavailable — verified source did not return a value. Displayed as N/A, never as zero.</p>
            )}

            {/* Audit & security */}
            {sheetAuditNote && (
              <div className="dc-warn">
                ⚠ {sheetAuditNote.text}
              </div>
            )}
            {Array.isArray(detailLive?.auditLinks) && detailLive.auditLinks.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="faint" style={{ fontSize: 11, fontWeight:700 }}>Audit reports</span>
                {detailLive.auditLinks.slice(0,4).map(link => (
                  <button key={link} type="button" className="intel-link" style={{ textAlign:'start', fontSize: 11.5 }} onClick={e=>{ e.stopPropagation(); openUrl(link); }}>
                    {String(link).replace(/^https?:\/\//,'').slice(0,48)}
                  </button>
                ))}
                <p className="faint" style={{ fontSize: 10, margin: 0 }}>“Audited” does not mean safe. A review covers one version of one contract on one date.</p>
              </div>
            )}
            {pickedProto.auditLinks?.length > 0 && !detailLive?.auditLinks?.length && (
              <div className="stack" style={{ gap: 4 }}>
                <span className="faint" style={{ fontSize: 11, fontWeight:700 }}>Audit reports</span>
                {pickedProto.auditLinks.slice(0,2).map(link => (
                  <button key={link} type="button" className="intel-link" style={{ fontSize: 11.5 }} onClick={e=>{ e.stopPropagation(); openUrl(link); }}>
                    {String(link).replace(/^https?:\/\//,'').slice(0,44)}
                  </button>
                ))}
              </div>
            )}

            {/* Docs */}
            {pickedProto.docs && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={()=>openUrl(pickedProto.docs)} style={{ alignSelf:'flex-start' }}>
                <IconExternal width={13} height={13} /> Docs · {hostOf(pickedProto.docs)}
              </button>
            )}

            {/* Warnings */}
            {sheetValidation?.warnings?.length > 0 && sheetValidation.warnings.map((w,i)=>(
              <div key={i} className={`dc-warn ${w.level==='error'?'error':''}`} role="alert">
                {w.message}
              </div>
            ))}
            {sheetChainWarns.map((w,i)=>(
              <div key={`ch-${i}`} className="dc-warn">
                {w.message}
              </div>
            ))}
            <div className="dc-warn">
              Opening in FBT Browser does not mean the site or its contracts are safe. Always review what a site asks to sign, connect or approve — and never share your seed phrase.
            </div>

            {/* Data source & freshness */}
            <div className="dc-source">
              <span className="pill pill-neutral" style={{ fontSize: 9.5 }}>Source: {pickedProto.dataSource === 'defillama' ? 'DefiLlama' : 'Curated registry'}</span>
              {metaInfo?.updatedAt && <span className="faint">Updated {timeAgo(metaInfo.updatedAt, i18n.language)}</span>}
              {pickedProto.verified && <span className="pill pill-up" style={{ fontSize: 9.5 }}>Verified official domain</span>}
            </div>

            <div className="disc-sheet-actions" style={{ marginTop: 4 }}>
              <button type="button" className="btn btn-primary disc-sheet-open" onClick={doOpen} data-testid="discovery-open" data-legacy-testid="disc-sheet-open">
                <IconExternal width={15} height={15} />
                Open in FBT Browser
              </button>
              <button type="button" className="btn btn-ghost disc-sheet-copy" onClick={copyLink}>
                <IconCopy width={15} height={15} />
                Copy link
              </button>
            </div>
            <p className="disc-sheet-hint">
              Opens in FBT Browser (Custom Tabs) — the real address bar and its security warnings stay visible. Wallet connections, signatures and approvals require your explicit approval. Never expose your seed phrase to any site.
            </p>
          </div>
        )}
      </Sheet>
    </PageTransition>
  );
}
