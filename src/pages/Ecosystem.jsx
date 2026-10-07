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
  probeProvidersFromBrowser,
  mergeProbeEvidence,
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
  PARTIAL: '#7dd3fc',
  DEGRADED: '#ffb300',
  OFFLINE: '#ff3b6b',
  UNKNOWN: '#5b647f'
};

const STATUS_LABELS = {
  OPERATIONAL: 'eco.status.operational',
  PARTIAL: 'eco.status.partial',
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
      {(status === 'OPERATIONAL' || status === 'PARTIAL') && <span className="eco-status-pulse" style={{ borderColor: color }} />}
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

/* ─── Data-backed swap flow ─────────────────────────────────────────────────── */
function HowFbtWorks({ t, providers = [], networks = [] }) {
  const steps = [
    { id: 'wallet', label: t('eco.flow.wallet'), desc: t('eco.flow.walletDesc') },
    { id: 'fbt', label: t('eco.flow.fbt'), desc: t('eco.flow.fbtDesc') },
    { id: 'intelligence', label: t('eco.flow.intelligence'), desc: t('eco.flow.intelligenceDesc') },
    { id: 'liquidity', label: t('eco.flow.liquidity'), desc: t('eco.flow.liquidityDesc') },
    { id: 'blockchain', label: t('eco.flow.blockchain'), desc: t('eco.flow.blockchainDesc') },
    { id: 'verification', label: t('eco.flow.verification'), desc: t('eco.flow.verificationDesc') }
  ];
  const sources = providers
    .filter((provider) => provider.capabilities?.includes('quote'))
    .sort((a, b) => Number(b.status === 'OPERATIONAL') - Number(a.status === 'OPERATIONAL') || a.name.localeCompare(b.name));

  return (
    <div className="eco-flow-container">
      <div className="eco-flow-timeline">
        {steps.map((step, index) => (
          <motion.article
            key={step.id}
            className="eco-flow-step"
            variants={riseIn}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-20px' }}
            transition={{ delay: index * 0.06 }}
          >
            <div className="eco-flow-step-header">
              <span className="eco-flow-step-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="eco-flow-step-label">{step.label}</span>
            </div>
            <p className="eco-flow-step-desc">{step.desc}</p>
          </motion.article>
        ))}
      </div>

      <section className="eco-route-evidence" aria-label={t('eco.sectionRouting', 'Live routing sources')}>
        <div className="eco-route-section-head">
          <div>
            <strong>{t('eco.sectionRouting', 'Live routing sources')}</strong>
            <span>{t('eco.flow.providerCount', { count: sources.length })}</span>
          </div>
          <span className="eco-route-count">{t('eco.flow.registryNetworkCount', { count: networks.length, total: NETWORK_REGISTRY.length })}</span>
        </div>

        {sources.length ? (
          <div className="eco-route-provider-grid">
            {sources.map((provider) => {
              const statusKey = STATUS_LABELS[provider.status] || STATUS_LABELS.UNKNOWN;
              const canExecute = provider.capabilities?.includes('execute');
              const mode = canExecute
                ? (provider.feeReady ? t('eco.flow.executorReady') : t('eco.flow.executorSetup'))
                : t('eco.flow.quoteOnly');
              const probedNames = (provider.probeNetworks || []).map((network) => network.name).join(', ');
              return (
                <div className="eco-route-provider" key={provider.id}>
                  <span className="eco-route-provider-dot" style={{ background: STATUS_COLORS[provider.status] || STATUS_COLORS.UNKNOWN }} />
                  <span className="eco-route-provider-copy">
                    <strong>{provider.name}</strong>
                    <small>{mode} · {t(statusKey)}</small>
                    <small className="eco-route-provider-probe">
                      {probedNames
                        ? t('eco.flow.providerProbeChains', { networks: probedNames })
                        : t('eco.flow.noRecentProbe')}
                    </small>
                  </span>
                  <span className="eco-route-provider-chains">{t('eco.flow.providerChains', { count: provider.networks?.length || 0 })}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="eco-route-empty">{t('eco.flow.noProviderData')}</p>
        )}

        {networks.length > 0 && (
          <div className="eco-route-network-area">
            <strong>{t('eco.flow.networkCoverage', { count: networks.length })}</strong>
            <div className="eco-route-network-list">
              {networks.map((network) => {
                const probeCounts = {
                  ready: network.reachableProviderCount || 0,
                  supported: network.supportedProviderCount || 0
                };
                return (
                  <span
                    className="eco-route-network-chip"
                    key={network.id}
                    title={`${network.name}${network.chainId ? ` · ${network.chainId}` : ''} · ${t('eco.flow.networkProbeEvidence', probeCounts)}`}
                  >
                    <StatusDot status={network.status || 'UNKNOWN'} size={6} />
                    <span>{network.name}</span>
                    <small>{probeCounts.ready}/{probeCounts.supported}</small>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <p className="eco-route-disclaimer">{t('eco.flow.routeNote')}</p>
      </section>
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
  const probeCacheRef = useRef(null);

  /** Fetch real provider status */
  const loadData = useCallback(async (force = false, probeEvidence = null) => {
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
      const data = buildEcosystemData(result, probeEvidence || probeCacheRef.current);
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
    // then re-read the standard status once the probe has recorded it. Without
    // carrying the probe body into the next build, a serverless instance that
    // didn't record the health event (or an edge cache) would keep showing 0/5
    // on every visit even though the providers answered.
    // Two independent evidence sources, merged: the server probe (datacenter
    // egress) and a browser probe through the same endpoints the swap/bridge
    // screens use. Either one answering with a real quote flips a provider to
    // OPERATIONAL, so the card no longer sits on 0/N when only one path is
    // blocked (serverless instance mismatch, or filtered upstream egress).
    let merged = null;
    const apply = (body) => {
      if (cancelled || !body) return;
      merged = mergeProbeEvidence(merged, body);
      probeCacheRef.current = merged;
      loadData(true, merged);
    };
    probeProvidersFromBrowser().then(apply);
    probeProviderStatuses().then((body) => {
      if (cancelled) return;
      setTimeout(() => apply(body), 450);
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
              status={summaryStatus(summary.networks)}
              t={t}
            />
            <StatusRow
              label={t('eco.dexSources', 'DEX Sources')}
              value={`${summary.dex.operational}/${summary.dex.total}`}
              status={summaryStatus(summary.dex)}
              t={t}
            />
            <StatusRow
              label={t('eco.bridges', 'Bridges')}
              value={`${summary.bridges.operational}/${summary.bridges.total}`}
              status={summaryStatus(summary.bridges)}
              t={t}
            />
            <StatusRow
              label={t('eco.dataInfra', 'Data Infra')}
              value={`${summary.dataInfra.operational}/${summary.dataInfra.total}`}
              status={summaryStatus(summary.dataInfra)}
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
          <HowFbtWorks
            t={t}
            providers={[...(sections?.dex || []), ...(sections?.bridges || [])]}
            networks={sections?.networks || []}
          />
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

/** UNKNOWN before probes, OPERATIONAL only on full evidence, PARTIAL on mixed coverage. */
function summaryStatus(group) {
  const total = Number(group?.total || 0);
  const ok = Number(group?.operational || 0);
  const observed = group?.observed == null ? total : Number(group.observed || 0);
  if (total <= 0 || observed <= 0) return 'UNKNOWN';
  if (ok >= total) return 'OPERATIONAL';
  if (ok > 0 || observed < total) return 'PARTIAL';
  return 'DEGRADED';
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
