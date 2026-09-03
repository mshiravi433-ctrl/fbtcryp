import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import { openUrl } from '../lib/browser';
import { IconChevronLeft, IconExternal, IconSearch } from '../components/Icons';
import {
  fetchProviderStatus,
  probeProviderStatuses,
  buildEcosystemData,
  NETWORK_REGISTRY,
  monogram
} from '../lib/ecosystemData';

/* ============================================================================
 * ECOSYSTEM — FBT Swap Infrastructure Map
 * ===========================================================================
 * This page displays the REAL infrastructure FBT Swap is built on.
 * No fake protocols. No fake status. No fake health scores.
 * All data derives from /api/providers/status and existing registries.
 * =========================================================================== */

/** Status dot colors */
const STATUS_COLORS = {
  OPERATIONAL: '#00ff9d',
  DEGRADED: '#ffb300',
  OFFLINE: '#ff3b6b',
  UNKNOWN: '#5b647f'
};

const STATUS_LABELS = {
  OPERATIONAL: 'eco.status.operational',
  DEGRADED: 'eco.status.degraded',
  OFFLINE: 'eco.status.offline',
  UNKNOWN: 'eco.status.unknown'
};

/** Filter categories */
const FILTER_CATEGORIES = [
  { id: 'all', label: 'eco.filter.all' },
  { id: 'networks', label: 'eco.filter.networks' },
  { id: 'dex', label: 'eco.filter.dex' },
  { id: 'bridge', label: 'eco.filter.bridge' },
  { id: 'defi', label: 'eco.filter.defi' },
  { id: 'data', label: 'eco.filter.data' },
  { id: 'ai', label: 'eco.filter.ai' }
];

const STATUS_FILTERS = [
  { id: 'all', label: 'eco.statusFilter.all' },
  { id: 'operational', label: 'eco.status.operational' },
  { id: 'degraded', label: 'eco.status.degraded' },
  { id: 'offline', label: 'eco.status.offline' }
];

/* ─── Logo Component ────────────────────────────────────────────────────────── */
function Logo({ url, name, hue, size = 36 }) {
  const [failed, setFailed] = useState(false);
  const host = useMemo(() => {
    try { return new URL(url).hostname; } catch { return null; }
  }, [url]);

  if (failed || !host) {
    return (
      <span
        className="eco-new-logo eco-new-logo-text"
        style={{ background: hue, width: size, height: size }}
      >
        {monogram(name)}
      </span>
    );
  }

  return (
    <span
      className="eco-new-logo"
      style={{ '--eco-hue': hue, width: size, height: size }}
    >
      <img
        src={`https://www.google.com/s2/favicons?sz=64&domain=${host}`}
        alt=""
        width={size - 14}
        height={size - 14}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

/* ─── Status Dot ────────────────────────────────────────────────────────────── */
function StatusDot({ status, size = 8 }) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.UNKNOWN;
  return (
    <span className="eco-status-dot" style={{ width: size, height: size, background: color }}>
      {status === 'OPERATIONAL' && <span className="eco-status-pulse" style={{ borderColor: color }} />}
    </span>
  );
}

/* ─── Skeleton Loader ───────────────────────────────────────────────────────── */
function Skeleton({ count = 3, className = '' }) {
  return (
    <div className={`eco-skeleton-grid ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="eco-skeleton-card">
          <div className="eco-skeleton-circle" />
          <div className="eco-skeleton-line eco-skeleton-line--short" />
          <div className="eco-skeleton-line" />
          <div className="eco-skeleton-line eco-skeleton-line--medium" />
        </div>
      ))}
    </div>
  );
}

/* ─── Protocol Drawer (lazy loaded) ─────────────────────────────────────────── */
const ProtocolDrawer = lazy(() => import('../components/ecosystem/ProtocolDrawer'));

/* ─── Liquidity Visualization ───────────────────────────────────────────────── */
function LiquidityVisualization({ t }) {
  return (
    <div className="eco-viz-container" role="img" aria-label={t('eco.viz.ariaLabel')}>
      <svg className="eco-viz-svg" viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Background grid */}
        <defs>
          <linearGradient id="eco-glow-cyan" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--rgb-1)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--rgb-2)" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="eco-glow-violet" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--rgb-2)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--rgb-3)" stopOpacity="0.4" />
          </linearGradient>
          <filter id="eco-glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Node: User Wallet (top) */}
        <rect x="150" y="10" width="100" height="32" rx="16" fill="var(--bg-panel)" stroke="var(--rgb-1)" strokeWidth="1" opacity="0.8" />
        <text x="200" y="30" textAnchor="middle" fill="var(--text-2)" fontSize="10" fontFamily="var(--font-mono)">WALLET</text>

        {/* Node: FBT Swap */}
        <rect x="140" y="62" width="120" height="32" rx="16" fill="var(--bg-panel)" stroke="var(--rgb-1)" strokeWidth="1.5" filter="url(#eco-glow)" />
        <text x="200" y="82" textAnchor="middle" fill="var(--text-1)" fontSize="10" fontWeight="600" fontFamily="var(--font-mono)">FBT SWAP</text>

        {/* Connection: Wallet → FBT */}
        <line x1="200" y1="42" x2="200" y2="62" stroke="var(--rgb-1)" strokeWidth="1" strokeDasharray="3 2" opacity="0.6">
          <animate attributeName="stroke-dashoffset" values="5;0" dur="1.5s" repeatCount="indefinite" />
        </line>

        {/* Node: Router */}
        <rect x="135" y="118" width="130" height="32" rx="16" fill="var(--bg-panel)" stroke="var(--rgb-2)" strokeWidth="1" opacity="0.8" />
        <text x="200" y="138" textAnchor="middle" fill="var(--text-2)" fontSize="10" fontFamily="var(--font-mono)">ROUTER ENGINE</text>

        {/* Connection: FBT → Router */}
        <line x1="200" y1="94" x2="200" y2="118" stroke="var(--rgb-2)" strokeWidth="1" strokeDasharray="3 2" opacity="0.6">
          <animate attributeName="stroke-dashoffset" values="5;0" dur="1.2s" repeatCount="indefinite" />
        </line>

        {/* DEX nodes */}
        <rect x="30" y="175" width="80" height="28" rx="14" fill="var(--bg-panel)" stroke="var(--rgb-4)" strokeWidth="0.8" opacity="0.7" />
        <text x="70" y="193" textAnchor="middle" fill="var(--text-2)" fontSize="9" fontFamily="var(--font-mono)">DEX A</text>

        <rect x="160" y="175" width="80" height="28" rx="14" fill="var(--bg-panel)" stroke="var(--rgb-4)" strokeWidth="0.8" opacity="0.7" />
        <text x="200" y="193" textAnchor="middle" fill="var(--text-2)" fontSize="9" fontFamily="var(--font-mono)">DEX B</text>

        <rect x="290" y="175" width="80" height="28" rx="14" fill="var(--bg-panel)" stroke="var(--rgb-4)" strokeWidth="0.8" opacity="0.7" />
        <text x="330" y="193" textAnchor="middle" fill="var(--text-2)" fontSize="9" fontFamily="var(--font-mono)">DEX C</text>

        {/* Connections: Router → DEXs */}
        <line x1="175" y1="150" x2="70" y2="175" stroke="url(#eco-glow-violet)" strokeWidth="0.8" strokeDasharray="2 2">
          <animate attributeName="stroke-dashoffset" values="4;0" dur="2s" repeatCount="indefinite" />
        </line>
        <line x1="200" y1="150" x2="200" y2="175" stroke="url(#eco-glow-violet)" strokeWidth="0.8" strokeDasharray="2 2">
          <animate attributeName="stroke-dashoffset" values="4;0" dur="1.8s" repeatCount="indefinite" />
        </line>
        <line x1="225" y1="150" x2="330" y2="175" stroke="url(#eco-glow-violet)" strokeWidth="0.8" strokeDasharray="2 2">
          <animate attributeName="stroke-dashoffset" values="4;0" dur="2.2s" repeatCount="indefinite" />
        </line>

        {/* Bottom: Best Route → Blockchain */}
        <rect x="140" y="225" width="120" height="28" rx="14" fill="var(--bg-panel)" stroke="var(--rgb-3)" strokeWidth="0.8" opacity="0.7" />
        <text x="200" y="243" textAnchor="middle" fill="var(--text-2)" fontSize="9" fontFamily="var(--font-mono)">BLOCKCHAIN</text>

        {/* Connections: DEXs → Blockchain */}
        <line x1="70" y1="203" x2="165" y2="225" stroke="var(--rgb-3)" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.4">
          <animate attributeName="stroke-dashoffset" values="5;0" dur="2.5s" repeatCount="indefinite" />
        </line>
        <line x1="200" y1="203" x2="200" y2="225" stroke="var(--rgb-3)" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.4">
          <animate attributeName="stroke-dashoffset" values="5;0" dur="2s" repeatCount="indefinite" />
        </line>
        <line x1="330" y1="203" x2="235" y2="225" stroke="var(--rgb-3)" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.4">
          <animate attributeName="stroke-dashoffset" values="5;0" dur="2.3s" repeatCount="indefinite" />
        </line>

        {/* Animated dots flowing along paths */}
        <circle r="2" fill="var(--rgb-1)" opacity="0.8">
          <animateMotion dur="3s" repeatCount="indefinite" path="M200,42 L200,62 L200,94 L200,118 L200,175 L200,225" />
        </circle>
        <circle r="2" fill="var(--rgb-2)" opacity="0.6">
          <animateMotion dur="4s" repeatCount="indefinite" path="M200,118 L70,175 L165,225" />
        </circle>
        <circle r="1.5" fill="var(--rgb-3)" opacity="0.5">
          <animateMotion dur="4.5s" repeatCount="indefinite" path="M200,118 L330,175 L235,225" />
        </circle>
      </svg>
    </div>
  );
}

/* ─── How FBT Works Flow ────────────────────────────────────────────────────── */
function HowFbtWorks({ t }) {
  const steps = [
    { id: 'wallet', label: t('eco.flow.wallet'), desc: t('eco.flow.walletDesc') },
    { id: 'fbt', label: t('eco.flow.fbt'), desc: t('eco.flow.fbtDesc') },
    { id: 'intelligence', label: t('eco.flow.intelligence'), desc: t('eco.flow.intelligenceDesc') },
    { id: 'liquidity', label: t('eco.flow.liquidity'), desc: t('eco.flow.liquidityDesc') },
    { id: 'blockchain', label: t('eco.flow.blockchain'), desc: t('eco.flow.blockchainDesc') },
    { id: 'verification', label: t('eco.flow.verification'), desc: t('eco.flow.verificationDesc') }
  ];

  return (
    <div className="eco-flow-container">
      {steps.map((step, i) => (
        <motion.div
          key={step.id}
          className="eco-flow-step"
          variants={riseIn}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-20px' }}
          transition={{ delay: i * 0.08 }}
        >
          <div className="eco-flow-step-header">
            <span className="eco-flow-step-number">{String(i + 1).padStart(2, '0')}</span>
            <span className="eco-flow-step-label">{step.label}</span>
          </div>
          <p className="eco-flow-step-desc">{step.desc}</p>
          {i < steps.length - 1 && (
            <div className="eco-flow-connector">
              <svg width="2" height="24" viewBox="0 0 2 24" fill="none">
                <line x1="1" y1="0" x2="1" y2="24" stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="4 3" />
              </svg>
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

/* ─── Main Ecosystem Component ──────────────────────────────────────────────── */
export default function Ecosystem() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [ecosystemData, setEcosystemData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const lastFetch = useRef(0);
  const cacheRef = useRef(null);

  /** Fetch real provider status */
  const loadData = useCallback(async (force = false) => {
    const now = Date.now();
    // Cache for 30 seconds
    if (!force && cacheRef.current && now - lastFetch.current < 30000) {
      setEcosystemData(cacheRef.current);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const result = await fetchProviderStatus();
      const data = buildEcosystemData(result);
      cacheRef.current = data;
      lastFetch.current = now;
      setEcosystemData(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadData();
    // Ask the server for fresh liveness evidence for the DEX/liquidity sources,
    // then re-read the standard status once the probe has recorded it.
    probeProviderStatuses().finally(() => {
      if (cancelled) return;
      setTimeout(() => { if (!cancelled) loadData(true); }, 450);
    });
    return () => { cancelled = true; };
  }, [loadData]);

  /** Debounced search */
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  /** Collect all items for search/filter */
  const allItems = useMemo(() => {
    if (!ecosystemData?.sections) return [];
    const items = [];
    const { networks, dex, bridges, dataInfrastructure, wallets, ai, dataProviders } = ecosystemData.sections;

    for (const n of networks) items.push({ ...n, category: 'networks', section: 'networks' });
    for (const d of dex) items.push({ ...d, category: 'dex', section: 'dex' });
    for (const b of bridges) items.push({ ...b, category: 'bridge', section: 'bridge' });
    for (const di of dataInfrastructure) items.push({ ...di, category: 'data', section: 'data' });
    for (const dp of dataProviders) items.push({ ...dp, category: 'data', section: 'data' });
    for (const w of wallets) items.push({ ...w, category: 'wallets', section: 'wallets' });
    for (const a of ai) items.push({ ...a, category: 'ai', section: 'ai' });

    return items;
  }, [ecosystemData]);

  /** Filtered items */
  const filteredItems = useMemo(() => {
    let items = allItems;

    // Category filter
    if (categoryFilter !== 'all') {
      items = items.filter(it => it.category === categoryFilter || it.section === categoryFilter);
    }

    // Status filter
    if (statusFilter !== 'all') {
      items = items.filter(it => (it.status || '').toLowerCase() === statusFilter);
    }

    // Search
    if (debouncedQuery) {
      const q = debouncedQuery.toLowerCase();
      items = items.filter(it => {
        const name = it.name || '';
        const type = it.type || '';
        const role = it.role || '';
        const purpose = it.purpose || '';
        return name.toLowerCase().includes(q) ||
               type.toLowerCase().includes(q) ||
               role.toLowerCase().includes(q) ||
               purpose.toLowerCase().includes(q);
      });
    }

    return items;
  }, [allItems, categoryFilter, statusFilter, debouncedQuery]);

  /** Group filtered items by section */
  const groupedItems = useMemo(() => {
    const groups = {};
    for (const item of filteredItems) {
      const section = item.section || 'other';
      if (!groups[section]) groups[section] = [];
      groups[section].push(item);
    }
    return groups;
  }, [filteredItems]);

  const open = (url) => { if (url) openUrl(url); };
  const { summary, sections } = ecosystemData || {};

  /** DEX & Liquidity (plus bridges) are the integrations that actually pay the
   *  FBT house fee. The bottom notice must not tell a visitor we earn nothing
   *  from the very section where our fee is applied. */
  const isFeeEarningView = categoryFilter === 'dex' ||
    (categoryFilter === 'all' && (sections?.dex?.length > 0 || sections?.bridges?.length > 0));

  return (
    <PageTransition>
      {/* ─── Header ─── */}
      <motion.div className="eco-new-header" variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1 eco-new-title">{t('eco.newTitle', 'FBT Swap Ecosystem')}</h1>
      </motion.div>

      {/* ─── Hero ─── */}
      <motion.div className="eco-hero" variants={riseIn} initial="hidden" animate="show" transition={{ delay: 0.05 }}>
        <div className="eco-hero-bg">
          <div className="eco-hero-orb eco-hero-orb--1" />
          <div className="eco-hero-orb eco-hero-orb--2" />
          <div className="eco-hero-orb eco-hero-orb--3" />
          <div className="eco-hero-grid-lines" />
        </div>
        <div className="eco-hero-content">
          <div className="eco-hero-icon">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="18" stroke="var(--rgb-1)" strokeWidth="1" opacity="0.4" />
              <circle cx="20" cy="20" r="12" stroke="var(--rgb-2)" strokeWidth="0.8" opacity="0.3" />
              <circle cx="20" cy="20" r="4" fill="var(--rgb-1)" opacity="0.8" />
              <line x1="20" y1="2" x2="20" y2="8" stroke="var(--rgb-1)" strokeWidth="1" opacity="0.5" />
              <line x1="20" y1="32" x2="20" y2="38" stroke="var(--rgb-1)" strokeWidth="1" opacity="0.5" />
              <line x1="2" y1="20" x2="8" y2="20" stroke="var(--rgb-1)" strokeWidth="1" opacity="0.5" />
              <line x1="32" y1="20" x2="38" y2="20" stroke="var(--rgb-1)" strokeWidth="1" opacity="0.5" />
            </svg>
          </div>
          <h2 className="eco-hero-heading">{t('eco.heroTitle', 'The infrastructure powering FBT Swap')}</h2>
          <p className="eco-hero-subtitle">
            {t('eco.heroSubtitle', 'Networks, liquidity sources, DeFi protocols, data infrastructure and intelligence systems working together behind FBT Swap.')}
          </p>
        </div>
      </motion.div>

      {/* ─── Live Status Card ─── */}
      <motion.section className="eco-status-card" variants={riseIn} initial="hidden" animate="show" transition={{ delay: 0.1 }}>
        <div className="eco-status-card-header">
          <span className="eco-status-card-title">{t('eco.statusTitle', 'FBT ECOSYSTEM STATUS')}</span>
          {summary && (
            <span className="eco-status-timestamp">
              {t('eco.lastCheck', 'Last checked')} {formatTimeAgo(summary.generatedAt, t)}
            </span>
          )}
        </div>

        {loading && !ecosystemData && (
          <div className="eco-status-grid">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="eco-status-item eco-status-item--loading">
                <div className="eco-skeleton-line eco-skeleton-line--short" />
                <div className="eco-skeleton-line" />
              </div>
            ))}
          </div>
        )}

        {error && !ecosystemData && (
          <div className="eco-error-state">
            <p>{t('eco.loadError', 'Unable to load ecosystem status')}</p>
            <button className="eco-retry-btn" onClick={() => loadData(true)}>
              {t('common.retry', 'Retry')}
            </button>
          </div>
        )}

        {summary && (
          <div className="eco-status-grid">
            <StatusRow
              label={t('eco.networks', 'Networks')}
              value={`${summary.networks.operational}/${summary.networks.total}`}
              status={summary.networks.operational === summary.networks.total ? 'OPERATIONAL' : 'DEGRADED'}
              t={t}
            />
            <StatusRow
              label={t('eco.dexSources', 'DEX Sources')}
              value={`${summary.dex.operational}/${summary.dex.total}`}
              status={summary.dex.operational === summary.dex.total ? 'OPERATIONAL' : 'DEGRADED'}
              t={t}
            />
            <StatusRow
              label={t('eco.bridges', 'Bridges')}
              value={`${summary.bridges.operational}/${summary.bridges.total}`}
              status={summary.bridges.operational === summary.bridges.total ? 'OPERATIONAL' : 'DEGRADED'}
              t={t}
            />
            <StatusRow
              label={t('eco.dataInfra', 'Data Infra')}
              value={`${summary.dataInfra.operational}/${summary.dataInfra.total}`}
              status="OPERATIONAL"
              t={t}
            />
          </div>
        )}

        {ecosystemData?.status === 'unavailable' && (
          <p className="eco-status-unavailable">{t('eco.statusUnavailable', 'STATUS INFORMATION UNAVAILABLE')}</p>
        )}
      </motion.section>

      {/* ─── Search ─── */}
      <motion.label className="eco-new-search" variants={riseIn} initial="hidden" animate="show" transition={{ delay: 0.15 }}>
        <IconSearch width={15} height={15} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('eco.newSearch', 'Search ecosystem...')}
          aria-label={t('eco.newSearch', 'Search ecosystem...')}
        />
      </motion.label>

      {/* ─── Filters ─── */}
      <motion.div className="eco-filters" variants={riseIn} initial="hidden" animate="show" transition={{ delay: 0.18 }}>
        <div className="eco-filter-row">
          {FILTER_CATEGORIES.map(f => (
            <button
              key={f.id}
              className={`eco-filter-chip ${categoryFilter === f.id ? 'eco-filter-chip--active' : ''}`}
              onClick={() => setCategoryFilter(f.id)}
            >
              {t(f.label, f.id)}
            </button>
          ))}
        </div>
        <div className="eco-filter-row eco-filter-row--status">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              className={`eco-filter-chip eco-filter-chip--small ${statusFilter === f.id ? 'eco-filter-chip--active' : ''}`}
              onClick={() => setStatusFilter(f.id)}
            >
              {t(f.label, f.id)}
            </button>
          ))}
        </div>
      </motion.div>

      {/* ─── Loading State ─── */}
      {loading && !ecosystemData && (
        <div className="eco-section">
          <Skeleton count={4} />
        </div>
      )}

      {/* ─── Networks Section ─── */}
      {sections?.networks?.length > 0 && categoryFilter === 'all' && (
        <motion.section className="eco-section" variants={riseIn} initial="hidden" whileInView="show" viewport={{ once: true }}>
          <SectionHeader title={t('eco.sectionNetworks', 'Networks')} count={sections.networks.length} />
          <div className="eco-cards-grid">
            {sections.networks.map(network => (
              <motion.button
                key={network.id}
                className="eco-new-card"
                style={{ '--card-hue': network.hue }}
                variants={riseIn}
                whileTap={{ scale: 0.97 }}
                onClick={() => setSelectedItem({ ...network, category: 'network' })}
              >
                <div className="eco-new-card-top">
                  <Logo url={getNetworkUrl(network.id)} name={network.name} hue={network.hue} />
                  <StatusDot status={network.status} />
                </div>
                <span className="eco-new-card-name">{network.name}</span>
                <span className="eco-new-card-type">{network.type} • {network.chainType}</span>
                {network.capabilities?.length > 0 && (
                  <div className="eco-new-card-caps">
                    {network.capabilities.slice(0, 4).map(cap => (
                      <span key={cap} className="eco-cap-tag">{cap}</span>
                    ))}
                  </div>
                )}
              </motion.button>
            ))}
          </div>
        </motion.section>
      )}

      {/* ─── DEX & Liquidity ─── */}
      {(categoryFilter === 'all' || categoryFilter === 'dex') && sections?.dex?.length > 0 && (
        <motion.section className="eco-section" variants={riseIn} initial="hidden" whileInView="show" viewport={{ once: true }}>
          <SectionHeader title={t('eco.sectionDex', 'DEX & Liquidity')} count={sections.dex.length} />
          <div className="eco-cards-grid">
            {sections.dex.map(protocol => (
              <ProtocolCard key={protocol.id} item={protocol} onSelect={setSelectedItem} t={t} />
            ))}
          </div>
        </motion.section>
      )}

      {/* ─── Liquidity Visualization ─── */}
      {categoryFilter === 'all' && sections?.dex?.length > 0 && (
        <motion.section className="eco-section" variants={riseIn} initial="hidden" whileInView="show" viewport={{ once: true }}>
          <SectionHeader title={t('eco.sectionRouting', 'Liquidity Routing')} />
          <LiquidityVisualization t={t} />
        </motion.section>
      )}

      {/* ─── Bridge Infrastructure ─── */}
      {(categoryFilter === 'all' || categoryFilter === 'bridge') && sections?.bridges?.length > 0 && (
        <motion.section className="eco-section" variants={riseIn} initial="hidden" whileInView="show" viewport={{ once: true }}>
          <SectionHeader title={t('eco.sectionBridges', 'Bridge Infrastructure')} count={sections.bridges.length} />
          <div className="eco-cards-grid">
            {sections.bridges.map(bridge => (
              <ProtocolCard key={bridge.id} item={bridge} onSelect={setSelectedItem} t={t} />
            ))}
          </div>
        </motion.section>
      )}

      {/* ─── Market & Data Infrastructure ─── */}
      {(categoryFilter === 'all' || categoryFilter === 'data') && sections?.dataInfrastructure?.length > 0 && (
        <motion.section className="eco-section" variants={riseIn} initial="hidden" whileInView="show" viewport={{ once: true }}>
          <SectionHeader title={t('eco.sectionData', 'Market & Data Infrastructure')} count={sections.dataInfrastructure.length} />
          <div className="eco-cards-grid">
            {sections.dataInfrastructure.map(infra => (
              <motion.button
                key={infra.id}
                className="eco-new-card"
                style={{ '--card-hue': infra.hue }}
                variants={riseIn}
                whileTap={{ scale: 0.97 }}
                onClick={() => setSelectedItem({ ...infra, category: 'data', capabilities: ['read'] })}
              >
                <div className="eco-new-card-top">
                  <Logo url={getDataUrl(infra.id)} name={infra.name} hue={infra.hue} />
                  <StatusDot status={infra.status} />
                </div>
                <span className="eco-new-card-name">{infra.name}</span>
                <span className="eco-new-card-type">{infra.type}</span>
                <span className="eco-new-card-desc">{infra.purpose}</span>
              </motion.button>
            ))}
          </div>
        </motion.section>
      )}

      {/* ─── AI & Intelligence ─── */}
      {(categoryFilter === 'all' || categoryFilter === 'ai') && sections?.ai?.length > 0 && (
        <motion.section className="eco-section" variants={riseIn} initial="hidden" whileInView="show" viewport={{ once: true }}>
          <SectionHeader title={t('eco.sectionAI', 'AI & Intelligence')} count={sections.ai.length} />
          <div className="eco-cards-grid">
            {sections.ai.map(ai => (
              <motion.button
                key={ai.id}
                className="eco-new-card eco-new-card--ai"
                style={{ '--card-hue': '#7c4dff' }}
                variants={riseIn}
                whileTap={{ scale: 0.97 }}
                onClick={() => setSelectedItem({ ...ai, category: 'ai' })}
              >
                <div className="eco-new-card-top">
                  <span className="eco-ai-icon">
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <circle cx="14" cy="14" r="10" stroke="var(--rgb-2)" strokeWidth="1" opacity="0.6" />
                      <circle cx="14" cy="14" r="4" fill="var(--rgb-2)" opacity="0.5" />
                      <line x1="14" y1="2" x2="14" y2="6" stroke="var(--rgb-2)" strokeWidth="0.8" opacity="0.5" />
                      <line x1="14" y1="22" x2="14" y2="26" stroke="var(--rgb-2)" strokeWidth="0.8" opacity="0.5" />
                      <line x1="2" y1="14" x2="6" y2="14" stroke="var(--rgb-2)" strokeWidth="0.8" opacity="0.5" />
                      <line x1="22" y1="14" x2="26" y2="14" stroke="var(--rgb-2)" strokeWidth="0.8" opacity="0.5" />
                    </svg>
                  </span>
                  <StatusDot status={ai.status} />
                </div>
                <span className="eco-new-card-name">{ai.name}</span>
                <span className="eco-new-card-desc">{ai.purpose}</span>
                {ai.capabilities && (
                  <div className="eco-new-card-caps">
                    {ai.capabilities.slice(0, 4).map(cap => (
                      <span key={cap} className="eco-cap-tag eco-cap-tag--ai">{cap.toUpperCase()}</span>
                    ))}
                  </div>
                )}
              </motion.button>
            ))}
          </div>
        </motion.section>
      )}

      {/* ─── Wallets ─── */}
      {categoryFilter === 'all' && sections?.wallets?.length > 0 && (
        <motion.section className="eco-section" variants={riseIn} initial="hidden" whileInView="show" viewport={{ once: true }}>
          <SectionHeader title={t('eco.sectionWallets', 'Wallet Integrations')} count={sections.wallets.length} />
          <div className="eco-cards-grid">
            {sections.wallets.map(wallet => (
              <motion.button
                key={wallet.id}
                className="eco-new-card"
                style={{ '--card-hue': wallet.hue }}
                variants={riseIn}
                whileTap={{ scale: 0.97 }}
                onClick={() => setSelectedItem({ ...wallet, category: 'wallet', capabilities: [] })}
              >
                <div className="eco-new-card-top">
                  <Logo url={getWalletUrl(wallet.id)} name={wallet.name} hue={wallet.hue} />
                  <StatusDot status={wallet.status} />
                </div>
                <span className="eco-new-card-name">{wallet.name}</span>
                <span className="eco-new-card-type">{wallet.type}</span>
                <span className="eco-new-card-desc">{wallet.purpose}</span>
              </motion.button>
            ))}
          </div>
        </motion.section>
      )}

      {/* ─── How FBT Works ─── */}
      {categoryFilter === 'all' && (
        <motion.section className="eco-section" variants={riseIn} initial="hidden" whileInView="show" viewport={{ once: true }}>
          <SectionHeader title={t('eco.sectionHowItWorks', 'How FBT Swap Works')} />
          <HowFbtWorks t={t} />
        </motion.section>
      )}

      {/* ─── Filtered results (when filter is active) ─── */}
      {categoryFilter !== 'all' && filteredItems.length === 0 && !loading && (
        <motion.div className="eco-empty-state" variants={riseIn} initial="hidden" animate="show">
          <p>{t('eco.noResultsFilter', 'No active integrations in this category.')}</p>
        </motion.div>
      )}

      {/* ─── No search results ─── */}
      {debouncedQuery && filteredItems.length === 0 && !loading && (
        <motion.div className="eco-empty-state" variants={riseIn} initial="hidden" animate="show">
          <p>{t('eco.noResults', { q: debouncedQuery })}</p>
        </motion.div>
      )}

      {/* ─── Notice ─── */}
      <InfoBox title={t(isFeeEarningView ? 'eco.feeNoticeTitle' : 'eco.noticeTitle')} tone="info" id="eco-notice">
        <p>{t(isFeeEarningView ? 'eco.feeNotice' : 'eco.notice')}</p>
      </InfoBox>

      {/* ─── Protocol Detail Drawer ─── */}
      <Suspense fallback={null}>
        <AnimatePresence>
          {selectedItem && (
            <ProtocolDrawer
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              onOpenUrl={open}
              t={t}
            />
          )}
        </AnimatePresence>
      </Suspense>
    </PageTransition>
  );
}

/* ─── Reusable Sub-Components ───────────────────────────────────────────────── */

function SectionHeader({ title, count }) {
  return (
    <div className="eco-section-header">
      <h3 className="eco-section-title">{title}</h3>
      {count !== undefined && <span className="eco-section-count">{count}</span>}
    </div>
  );
}

function StatusRow({ label, value, status, t }) {
  return (
    <div className="eco-status-item">
      <span className="eco-status-label">{label}</span>
      <span className="eco-status-value">
        <StatusDot status={status} size={6} />
        <span className="mono">{value}</span>
        <span className="eco-status-text" style={{ color: STATUS_COLORS[status] }}>
          {t(STATUS_LABELS[status] || 'eco.status.unknown')}
        </span>
      </span>
    </div>
  );
}

function ProtocolCard({ item, onSelect, t }) {
  return (
    <motion.button
      className="eco-new-card"
      style={{ '--card-hue': item.hue }}
      variants={riseIn}
      whileTap={{ scale: 0.97 }}
      onClick={() => onSelect(item)}
    >
      <div className="eco-new-card-top">
        <Logo url={getProviderUrl(item.id)} name={item.name} hue={item.hue} />
        <StatusDot status={item.status} />
      </div>
      <span className="eco-new-card-name">{item.name}</span>
      <span className="eco-new-card-type">{item.type}</span>
      {item.fee?.active && (
        <span className="eco-fee-chip" title={item.fee.receiver || ''}>
          {t('eco.feeToFbt', 'Fee → FBT')} · {item.fee.percent}%
          {item.fee.providerCutPercent > 0 && <span className="eco-fee-chip-net"> net {item.fee.netBps} bps</span>}
        </span>
      )}
      {item.networks?.length > 0 && (
        <span className="eco-new-card-networks">
          {item.networks.slice(0, 4).map(n => (
            <span key={n.id} className="eco-network-tag">{n.short}</span>
          ))}
          {item.networks.length > 4 && (
            <span className="eco-network-tag eco-network-tag--more">+{item.networks.length - 4}</span>
          )}
        </span>
      )}
      <span className="eco-new-card-desc">{item.role}</span>
    </motion.button>
  );
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function formatTimeAgo(isoString, t) {
  if (!isoString) return '';
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 5) return t('eco.justNow', 'just now');
  if (diff < 60) return t('eco.secondsAgo', '{{n}} sec ago', { n: diff });
  if (diff < 3600) return t('eco.minutesAgo', '{{n}} min ago', { n: Math.floor(diff / 60) });
  return t('eco.hoursAgo', '{{n}}h ago', { n: Math.floor(diff / 3600) });
}

function getNetworkUrl(id) {
  const urls = {
    ethereum: 'https://ethereum.org',
    polygon: 'https://polygon.technology',
    bnb: 'https://www.bnbchain.org',
    arbitrum: 'https://arbitrum.io',
    optimism: 'https://optimism.io',
    base: 'https://base.org',
    avalanche: 'https://avax.network',
    linea: 'https://linea.build',
    sonic: 'https://sonic.finance',
    solana: 'https://solana.com'
  };
  return urls[id] || '';
}

function getProviderUrl(id) {
  const urls = {
    kyberswap: 'https://kyberswap.com',
    openocean: 'https://openocean.finance',
    velora: 'https://velora.xyz',
    '0x-gasless': 'https://0x.org',
    '0x-cross-chain': 'https://0x.org',
    lifi: 'https://li.fi',
    'debridge-dln': 'https://debridge.finance',
    thorchain: 'https://thorchain.org',
    'solana-openocean': 'https://openocean.finance',
    'goplus-token-risk': 'https://gopluslabs.io'
  };
  return urls[id] || '';
}

function getDataUrl(id) {
  const urls = {
    coingecko: 'https://coingecko.com',
    geckoterminal: 'https://geckoterminal.com',
    defillama: 'https://defillama.com',
    dexscreener: 'https://dexscreener.com',
    bscscan: 'https://bscscan.com'
  };
  return urls[id] || '';
}

function getWalletUrl(id) {
  const urls = {
    metamask: 'https://metamask.io',
    trust: 'https://trustwallet.com',
    walletconnect: 'https://reown.com',
    rabby: 'https://rabby.io',
    safe: 'https://safe.global'
  };
  return urls[id] || '';
}
