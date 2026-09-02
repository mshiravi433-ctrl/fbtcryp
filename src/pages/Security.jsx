import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useWallet } from '../context/WalletContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { securityScore } from '../lib/walletRisk';
import { EVM_CHAINS, explorerAddr, explorerTx } from '../lib/chains';
import { FEE_BPS, FEE_RECIPIENT } from '../lib/chains';
import { payoutTable } from '../lib/payout';
import { securityApi, intelErrorCode } from '../lib/intelApi';
import { revokeApproval, revokeEligibility } from '../lib/securityRevoke';
import { fmtCompact, timeAgo } from '../lib/format';
import { openUrl } from '../lib/browser';
import {
  IconActivity, IconBell, IconChevronLeft, IconClock, IconDoc, IconExternal,
  IconGlobe, IconKey, IconLock, IconRefresh, IconSearch, IconShield
} from '../components/Icons';
import {
  EmptyState, ErrorState, LevelPill, LoadingState, MetaLine, Notices,
  ScoreBar, SectionTabs, ShortAddr, StatTile, StatusChip
} from '../components/Intel';
import '../styles/docs-modern.css';
import '../styles/intel.css';

/**
 * SECURITY CENTER — امنیت.
 * ---------------------------------------------------------------------------
 * What used to be a static disclosure page is now an operational intelligence
 * screen — and the one rule the old page already kept, in prose, is now the
 * rule the whole module keeps in code:
 *
 *   DETECT · ANALYZE · SCORE · WARN · EXPLAIN · RECOMMEND CAUTION
 *
 * It must never BLOCK · REJECT · CANCEL · DISABLE · PREVENT. Concretely:
 *   · Every route used here is a read-only GET on the Security backend; there
 *     is no API surface this page could use to gate a swap, bridge, lend or
 *     sign. The execution stack never imports from this page or its routes.
 *   · A "Medium Risk" contract still shows every swap button FBT has. Warning
 *     and permission are different things, and only the user holds the second.
 *   · Nothing renders "SAFE" / "100% Secure" / "Risk Free". The vocabulary is
 *     LOW / MEDIUM / HIGH / UNKNOWN, plus confidence, because an
 *     overconfident security page converts cautious users into careless ones.
 *   · UNKNOWN is drawn as UNKNOWN. Missing evidence reads as missing
 *     evidence — never as a green check by default, and audit status is kept
 *     as its own row so "audited" is never silently read as "safe".
 *
 * The policy content from the old Audit page (protections and their limits,
 * threats, third-party audits, fee transparency) is preserved verbatim under
 * the Policy tab, because it answers "what does FBT itself do", which no
 * amount of chain telemetry replaces.
 *
 * Independent of the Intent OS by construction — see the probe in
 * test/explore-security-probe.mjs that greps this module's import graph.
 */

const TABS = [
  { id: 'dashboard', labelKey: 'secCenter.tab.dashboard', Icon: IconShield },
  { id: 'contracts', labelKey: 'secCenter.tab.contracts', Icon: IconSearch },
  { id: 'tokens', labelKey: 'secCenter.tab.tokens', Icon: IconActivity },
  { id: 'approvals', labelKey: 'secCenter.tab.approvals', Icon: IconKey },
  { id: 'protocols', labelKey: 'secCenter.tab.protocols', Icon: IconGlobe },
  { id: 'alerts', labelKey: 'secCenter.tab.alerts', Icon: IconBell },
  { id: 'activity', labelKey: 'secCenter.tab.activity', Icon: IconClock },
  { id: 'policy', labelKey: 'secCenter.tab.policy', Icon: IconDoc }
];

export default function Security({ embedded = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromUrl = params.get('tab');
  const valid = TABS.some((x) => x.id === fromUrl);
  const [tab, setTab] = useState(valid ? fromUrl : 'dashboard');

  useEffect(() => {
    const next = params.get('tab');
    if (next && TABS.some((x) => x.id === next) && next !== tab) setTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  const deep = {
    chain: params.get('chain'),
    addr: params.get('addr'),
    protocol: params.get('protocol')
  };

  return (
    <PageTransition embedded={embedded}>
      {!embedded && (
        <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 19 }}>{t('secCenter.title')}</h1>
        </motion.div>
      )}

      <p className="muted">{t('secCenter.subtitle')}</p>

      <SectionTabs
        ariaLabelKey="secCenter.sectionsAria"
        active={tab}
        onChange={setTab}
        tabs={TABS}
      />

      {tab === 'dashboard' && <DashboardSection />}
      {tab === 'contracts' && <ContractAnalyzer initial={deep} />}
      {tab === 'tokens' && <TokenAnalyzer initial={deep} />}
      {tab === 'approvals' && <ApprovalsSection initialChain={deep.chain} />}
      {tab === 'alerts' && <AlertsSection />}
      {tab === 'activity' && <ActivitySection />}
      {tab === 'protocols' && <ProtocolSecurity slug={deep.protocol} />}
      {tab === 'policy' && <PolicySection />}
    </PageTransition>
  );
}

/* -------------------------------------------------------------------------- */
/* Small shared hook (same contract as Explore's, kept local & identical)      */
/* -------------------------------------------------------------------------- */

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
    if (intervalMs > 0) timer = setInterval(() => { if (document.visibilityState === 'visible') run(); }, intervalMs);
    return () => { alive.current = false; if (timer) clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, error, reload: run };
}

/* -------------------------------------------------------------------------- */
/* Dashboard — monitoring components, computed from real health                */
/* -------------------------------------------------------------------------- */

function componentTone(status) {
  if (!status) return 'status-starting';
  if (status.startsWith('OPERATIONAL') && !status.includes('GAPS')) return 'status-operational';
  if (status.includes('PARTIAL')) return 'status-degraded';
  if (status === 'IMPAIRED') return 'status-impaired';
  return 'status-degraded';
}

function DashboardSection() {
  const { t, i18n } = useTranslation();
  const overview = useIntel(() => securityApi.overview(), [], { intervalMs: 60_000 });
  const d = overview.data?.data;

  /* Wallet-local posture: computed on this device from the real settings the
   * user actually toggled (same function the wallet card uses). It never
   * leaves the device and the server never gets a vote about it. */
  const biometricEnabled = useSettingsStore((s) => s.biometricEnabled);
  const twoFactorEnabled = useSettingsStore((s) => s.twoFactorEnabled);
  const autoLockMinutes = useSettingsStore((s) => s.autoLockMinutes);
  const wallet = useWallet();
  const local = securityScore({
    biometricEnabled,
    twoFactorEnabled,
    autoLockMinutes,
    lockedNow: Boolean(wallet.locked)
  });

  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section
        className="docs-card"
        data-open="true"
        variants={riseIn}
        style={{ padding: 16, '--card-hue': 'var(--rgb-1)', background: 'linear-gradient(145deg, rgba(0,229,255,0.07), rgba(255,255,255,0.03))', borderColor: 'rgba(0,229,255,0.13)' }}
      >
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <span className="intel-avatar" style={{ width: 40, height: 40, borderRadius: 13, background: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))' }}>
            <IconShield width={19} height={19} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 900, fontSize: 14, letterSpacing: 0.2 }}>{t('secCenter.systemTitle')}</span>
            <span className={`faint ${componentTone(d?.system?.status)}`} style={{ fontSize: 11.5, fontWeight: 700 }}>
              {d?.system ? t(`secCenter.system.${String(d.system.status).split(' ')[0]}`, d.system.status) : overview.loading ? t('common.loading') : t('intel.noData')}
            </span>
          </span>
          <button className="icon-btn" style={{ padding: 7 }} aria-label={t('common.refresh')} onClick={overview.reload}>
            <IconRefresh width={14} height={14} className={overview.loading ? 'intel-spin' : undefined} />
          </button>
        </div>
        {d?.system?.note && <p className="faint" style={{ fontSize: 10.8, margin: '10px 2px 0', lineHeight: 1.65 }}>{d.system.note}</p>}
        <MetaLine meta={overview.data?.meta} />
        {overview.error && <ErrorState code={intelErrorCode(overview.error)} onRetry={overview.reload} t={t} />}
      </motion.section>

      {d && (
        <motion.section className="stack" style={{ gap: 8 }} variants={riseIn} initial="hidden" animate="show">
          {(d.components || []).map((c) => (
            <div key={c.key} className="intel-component">
              <div className="intel-component-head">
                <span style={{ fontWeight: 700, fontSize: 12.6 }}>{t(`secCenter.comp.${c.key}`)}</span>
                <span className="row" style={{ gap: 8 }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: c.score == null ? 'var(--text-3)' : c.score >= 90 ? 'var(--up)' : c.score >= 60 ? 'var(--rgb-5)' : 'var(--down)' }}>
                    {c.score == null ? <span className="faint">—</span> : c.score}
                    {c.score != null && <span className="faint" style={{ fontSize: 10 }}> /100</span>}
                  </span>
                  <span className={`pill pill-neutral ${componentTone(c.status)}`} style={{ fontSize: 9.5 }}>
                    {t(`secCenter.status.${String(c.status).split(' ')[0]}`, c.status)}
                  </span>
                </span>
              </div>
              <div className="intel-pct-track" role="presentation">
                <span
                  style={{
                    width: `${c.score == null ? 0 : c.score}%`,
                    background: c.score == null ? 'var(--text-3)' : c.score >= 90 ? 'var(--up)' : c.score >= 60 ? 'var(--rgb-5)' : 'var(--down)'
                  }}
                />
              </div>
              <p className="faint" style={{ fontSize: 10.8, margin: '7px 0 0', lineHeight: 1.6 }}>{c.basis}</p>
            </div>
          ))}
          <Notices notices={overview.data?.notices} />
        </motion.section>
      )}

      <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 14 }}>
        <div className="row-between" style={{ marginBottom: 6 }}>
          <p className="section-label" style={{ margin: 0 }}>{t('secCenter.deviceTitle')}</p>
          <span className="mono" style={{ fontWeight: 800, fontSize: 13 }}>
            {local.score != null ? `${local.score}/95` : <span className="faint">—</span>}
          </span>
        </div>
        <p className="faint" style={{ fontSize: 10.8, margin: '0 0 8px', lineHeight: 1.6 }}>{t('secCenter.deviceNote')}</p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className={`pill ${twoFactorEnabled ? 'pill-up' : 'pill-neutral'}`} style={{ fontSize: 10 }}>{t('secCenter.twoFactor')}: {twoFactorEnabled ? t('common.on') : t('common.off')}</span>
          <span className={`pill ${biometricEnabled ? 'pill-up' : 'pill-neutral'}`} style={{ fontSize: 10 }}>{t('secCenter.biometric')}: {biometricEnabled ? t('common.on') : t('common.off')}</span>
          <span className={`pill ${Number(autoLockMinutes) > 0 && Number(autoLockMinutes) <= 5 ? 'pill-up' : 'pill-neutral'}`} style={{ fontSize: 10 }}>
            <IconLock width={11} height={11} /> {Number(autoLockMinutes) > 0 ? `${autoLockMinutes} ${t('wallet.security.minutes')}` : t('common.off')}
          </span>
          {local.signals?.length === 0 && <span className="faint" style={{ fontSize: 10.5 }}>{t('secCenter.deviceNothing')}</span>}
        </div>
      </motion.section>

      <p className="faint" style={{ fontSize: 10.5, margin: '2px 4px', lineHeight: 1.7 }}>{t('secCenter.notGuarantee')}</p>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Analyzers (contracts + tokens share one view, different endpoints)          */
/* -------------------------------------------------------------------------- */

function AnalyzerShell({ kind, initial, api }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [addr, setAddr] = useState(initial?.addr || '');
  const [chain, setChain] = useState(initial?.chain && /^\d+$/.test(initial.chain) ? initial.chain : String(Object.keys(EVM_CHAINS)[0]));
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const reqRef = useRef(0);

  const run = useCallback(async (a = addr, c = chain) => {
    const value = String(a || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
      setState({ status: 'error', data: null, error: 'badInput' });
      return;
    }
    const my = ++reqRef.current;
    setState({ status: 'loading', data: null, error: null });
    try {
      const res = await api(value, { chain: c });
      if (my !== reqRef.current) return;
      setState({ status: 'ok', data: res, error: null });
    } catch (e) {
      if (my !== reqRef.current) return;
      setState({ status: 'error', data: null, error: intelErrorCode(e) });
    }
  }, [addr, chain, api]);

  /* deep-link from Explore arrives prefilled — run once automatically. */
  useEffect(() => {
    if (initial?.addr && /^0x[a-fA-F0-9]{40}$/.test(initial.addr)) run(initial.addr, initial.chain || chain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.addr]);

  const d = state.data?.data;
  const verdict = kind === 'contract'
    ? (d?.verdict === 'NOT_A_CONTRACT' ? 'notContract' : null)
    : null;
  const score = d?.score;
  const checks = (d?.checks || []).filter((f) => f.key !== 'holders');

  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
        <p className="section-label" style={{ marginBottom: 8 }}>{t(`secCenter.analyze.${kind}`)}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            dir="ltr"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder={t('secCenter.addrPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            aria-label={t(`secCenter.${kind}Aria`)}
            className="intel-input"
            style={{ flex: 2, minWidth: 150 }}
          />
          <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label={t('explore.chain')} style={{ flex: 1, minWidth: 92 }}>
            {Object.values(EVM_CHAINS).map((c) => <option key={c.id} value={c.id}>{c.short || c.name}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => run()} disabled={state.status === 'loading'}>
            <IconSearch width={14} height={14} /> {state.status === 'loading' ? t('secCenter.analyzing') : t('secCenter.analyzeBtn')}
          </button>
        </div>
        <p className="faint" style={{ fontSize: 10.5, margin: '8px 2px 0', lineHeight: 1.6 }}>{t('secCenter.advisoryLine')}</p>
      </motion.section>

      {state.status === 'loading' && <LoadingState label={t('secCenter.analyzing')} />}
      {state.status === 'error' && <ErrorState code={state.error} onRetry={() => run()} t={t} />}
      {state.status === 'idle' && <EmptyState icon="🛡" title={t('secCenter.idleTitle')} note={t('secCenter.idleNote')} />}

      {state.status === 'ok' && d && (
        <>
          <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
            <div className="row-between" style={{ gap: 8, flexWrap: 'wrap', marginBottom: verdict === 'notContract' ? 4 : 8 }}>
              <span className="row" style={{ gap: 8, minWidth: 0 }}>
                <span className="intel-avatar intel-avatar-sm" aria-hidden="true">{kind === 'token' ? '◎' : '⌗'}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 800, fontSize: 13 }}>
                    {d.subject?.symbol ? `${d.subject.symbol} · ` : ''}{d.subject?.name && d.subject.name !== d.subject.symbol ? `${d.subject.name} · ` : ''}
                    <ShortAddr value={d.subject?.address} size={6} />
                  </span>
                  <span className="faint" style={{ fontSize: 10.5 }}>{d.subject?.chainName}</span>
                </span>
              </span>
              {verdict === 'notContract' ? <span className="pill pill-neutral" style={{ fontSize: 10 }}>{t('secCenter.notContract')}</span> : null}
            </div>

            {verdict === 'notContract' ? (
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{t('secCenter.notContractBody')}</p>
            ) : (
              <>
                <ScoreBar score={score?.score} level={score?.level} confidence={score?.confidence} dataQuality={score?.dataQuality} />
                <p className="faint" style={{ fontSize: 10.8, margin: '10px 0 0', lineHeight: 1.65 }}>{score?.disclaimer}</p>
                <div className="stack" style={{ marginTop: 8 }}>
                  {checks.map((f, i) => (
                    <div key={`${f.key}-${i}`} className="intel-check-row">
                      <StatusChip status={f.status} t={t} />
                      <span className="intel-check-body">
                        <span className="intel-check-label">{t(`secCenter.factor.${f.key}`, f.label || f.key)}</span>
                        <p className="intel-check-detail">{f.detail}</p>
                      </span>
                    </div>
                  ))}
                </div>
                {d.notices?.length > 0 && <Notices notices={d.notices} />}
                <MetaLine meta={state.data?.meta} />
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => window.open(`${EVM_CHAINS[Number(d.subject?.chainId)]?.explorer || ''}/address/${d.subject?.address}`, '_blank', 'noopener,noreferrer')}>
                    <IconExternal width={13} height={13} /> {t('secCenter.viewDetails')}
                  </button>
                </div>
              </>
            )}
          </motion.section>

          {kind === 'contract' && d.profile && (
            <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 14 }}>
              <p className="section-label" style={{ marginBottom: 6 }}>{t('secCenter.onchain')}</p>
              <div className="intel-stat-grid">
                <StatTile label={t('secCenter.codeSize')} value={d.profile.hasCode ? `${d.profile.codeSize} B` : null} />
                <StatTile label={t('secCenter.proxy')} value={d.profile.isProxy ? d.profile.proxyKind : t('intel.no')} />
                <StatTile label={t('secCenter.implementation')} value={d.profile.implementation ? `${String(d.profile.implementation).slice(0, 10)}…` : null} />
                <StatTile label={t('secCenter.owner')} value={d.profile.owner ? `${d.profile.owner.slice(0, 10)}…` : null} />
                <StatTile label={t('explore.pausedState')} value={d.profile.paused === true ? t('intel.yes') : d.profile.paused === false ? t('intel.no') : null} />
                <StatTile label={t('secCenter.verification')} value={d.profile.verified === true ? t('common.done') : d.profile.verified === false ? t('secCenter.unverified') : null} sub={d.profile.verified == null ? t('secCenter.verificationSub') : undefined} />
              </div>
              {Array.isArray(d.watch) && d.watch.filter((n) => n.kind === 'watch-change').length > 0 && (
                <p className="intel-notice" style={{ fontSize: 11, margin: '8px 0 0', lineHeight: 1.6 }}>
                  {t('secCenter.watchChanged', { fields: d.watch.filter((n) => n.kind === 'watch-change').map((n) => n.field).join(', ') })}
                </p>
              )}
            </motion.section>
          )}
        </>
      )}
    </motion.div>
  );
}

function ContractAnalyzer({ initial }) {
  return <AnalyzerShell kind="contract" initial={initial} api={(a, p) => securityApi.contract(a, p)} />;
}
function TokenAnalyzer({ initial }) {
  return <AnalyzerShell kind="token" initial={initial} api={(a, p) => securityApi.token(a, p)} />;
}

/* -------------------------------------------------------------------------- */
/* Protocol security (arrives via deep link from Explore protocol cards)        */
/* -------------------------------------------------------------------------- */

function ProtocolSecurity({ slug }) {
  const { t } = useTranslation();
  const [localSlug, setLocalSlug] = useState(slug || '');
  const [state, setState] = useState({ status: 'idle', data: null, error: null });

  const run = useCallback(async (s) => {
    if (!s) return;
    setState({ status: 'loading', data: null, error: null });
    try {
      const res = await securityApi.protocol(s);
      setState({ status: 'ok', data: res, error: null });
    } catch (e) {
      setState({ status: 'error', data: null, error: intelErrorCode(e) });
    }
  }, []);

  useEffect(() => {
    if (slug) { setLocalSlug(slug); run(slug); }
  }, [slug, run]);

  const d = state.data?.data;
  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
        <p className="section-label" style={{ marginBottom: 8 }}>{t('secCenter.protocolLookup')}</p>
        <div className="row" style={{ gap: 8 }}>
          <input
            dir="ltr" value={localSlug} onChange={(e) => setLocalSlug(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(localSlug.trim()); }}
            placeholder={t('secCenter.protocolPlaceholder')} spellCheck={false} aria-label={t('secCenter.protocolAria')}
            className="intel-input" style={{ flex: 1, minWidth: 140 }}
          />
          <button className="btn btn-primary btn-sm" onClick={() => run(localSlug.trim())} disabled={state.status === 'loading' || !localSlug.trim()}>{t('secCenter.search')}</button>
        </div>
      </motion.section>
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState code={state.error} onRetry={() => run(localSlug.trim())} t={t} />}
      {state.status === 'ok' && d && (
        <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
          <div className="row" style={{ gap: 10, marginBottom: 10 }}>
            <span className="intel-avatar" style={{ background: 'linear-gradient(135deg, var(--rgb-2), var(--rgb-4))' }}>
              {d.subject?.icon ? <img src={d.subject.icon} alt="" loading="lazy" /> : (d.subject?.name || d.subject?.slug || '?').slice(0, 2).toUpperCase()}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 800, fontSize: 13.5 }}>{d.subject?.name || d.subject?.slug}</span>
              <span className="faint" style={{ fontSize: 10.5 }}>{d.subject?.category} · {(d.subject?.chains || []).slice(0, 4).join(' · ')}</span>
            </span>
          </div>
          <ScoreBar score={d.score?.score} level={d.score?.level} confidence={d.score?.confidence} dataQuality={d.score?.dataQuality} />
          <div className="stack" style={{ marginTop: 10 }}>
            {(d.checks || []).map((f, i) => (
              <div key={`${f.key}-${i}`} className="intel-check-row">
                <StatusChip status={f.status} t={t} />
                <span className="intel-check-body">
                  <span className="intel-check-label">{t(`secCenter.factor.${f.key}`, f.label || f.key)}</span>
                  <p className="intel-check-detail">{f.detail}</p>
                </span>
              </div>
            ))}
          </div>
          <div className="row-between" style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <span className="faint" style={{ fontSize: 11.5 }}>{t('secCenter.incidentsRow')}</span>
            {d.incidents?.length ? (
              <span className="pill pill-down" style={{ fontSize: 10 }}>{t('secCenter.incidentsFound', { n: d.incidents.length })}</span>
            ) : (
              <span className={`pill ${(d.checks || []).some((f) => f.key === 'incidentHistory' && f.status === 'UNKNOWN') ? 'pill-neutral' : 'pill-up'}`} style={{ fontSize: 10 }}>
                {(d.checks || []).some((f) => f.key === 'incidentHistory' && f.status === 'UNKNOWN')
                  ? t('secCenter.incidentsUnavailable')
                  : t('secCenter.incidentsNone')}
              </span>
            )}
          </div>
          {d.policy?.note && <p className="faint" style={{ fontSize: 10.5, margin: '8px 0 0', lineHeight: 1.65 }}>{d.policy.note}</p>}
          <Notices notices={d.notices} />
          <MetaLine meta={state.data?.meta} />
        </motion.section>
      )}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Approvals — real allowance data + wallet-signed revoke                      */
/* -------------------------------------------------------------------------- */

function ApprovalsSection({ initialChain }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [chain, setChain] = useState(initialChain && /^\d+$/.test(initialChain) ? initialChain : String(wallet.chainId || Object.keys(EVM_CHAINS)[0]));
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const [revoking, setRevoking] = useState(null); // { key, status, hash, error }

  const run = useCallback(async (c = chain, address = wallet.address) => {
    if (!address) return;
    setState({ status: 'loading', data: null, error: null });
    try {
      const res = await securityApi.approvals(address, { chain: c });
      setState({ status: 'ok', data: res, error: null });
    } catch (e) {
      setState({ status: 'error', data: null, error: intelErrorCode(e) });
    }
  }, [chain, wallet.address]);

  useEffect(() => {
    if (wallet.address && !wallet.locked) run(chain, wallet.address);
    else setState({ status: 'idle', data: null, error: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address, wallet.locked, chain]);

  const doRevoke = useCallback(async (row, ap) => {
    const key = `${row.token}:${ap.spender}`;
    setRevoking({ key, status: 'confirm', hash: null, error: null });
    try {
      const out = await revokeApproval({
        wallet,
        token: row.token,
        spender: ap.spender,
        onStatus: (st, hash) => setRevoking({ key, status: st, hash: hash || null, error: null })
      });
      if (out.status === 'already-zero') {
        setRevoking({ key, status: 'zero', hash: null, error: null });
      } else {
        setRevoking({ key, status: 'submitted', hash: out.hash, error: null });
        out.wait?.().then(() => run(chain)).catch(() => { /* refresh failure keeps hash */ });
      }
    } catch (e) {
      setRevoking({ key, status: 'error', hash: null, error: e.code || 'FAILED' });
    }
  }, [wallet, run, chain]);

  if (!wallet.address || wallet.locked) {
    return (
      <EmptyState
        icon="🔌"
        title={t('secCenter.approvalsWalletTitle')}
        note={t('secCenter.approvalsWalletNote')}
        action={<button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => navigate('/wallet')}>{t('explore.connectWallet')}</button>}
      />
    );
  }

  const d = state.data?.data;
  const rows = d?.approvals || [];
  const eligibility = revokeEligibility({ wallet, approvalChainId: Number(chain) });
  const checkerUrl = d ? `${EVM_CHAINS[Number(d.chainId)]?.explorer}/tokenapprovalchecker` : null;

  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 800, fontSize: 13 }}>{t('secCenter.myApprovals')}</span>
            <span className="faint"><ShortAddr value={wallet.address} size={5} /></span>
          </span>
          <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label={t('explore.chain')} style={{ minWidth: 100 }}>
            {Object.values(EVM_CHAINS).map((c) => <option key={c.id} value={c.id}>{c.short || c.name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => run()} disabled={state.status === 'loading'} aria-label={t('common.refresh')}>
            <IconRefresh width={13} height={13} className={state.status === 'loading' ? 'intel-spin' : undefined} />
          </button>
        </div>
        {d?.coverage === 'known-spenders' && (
          <p className="faint" style={{ fontSize: 10.5, margin: '8px 2px 0', lineHeight: 1.6 }}>{t('secCenter.coverageKnown')}</p>
        )}
        {d?.coverage === 'indexed-feed' && (
          <p className="faint" style={{ fontSize: 10.5, margin: '8px 2px 0', lineHeight: 1.6 }}>{t('secCenter.coverageIndexed')}</p>
        )}
      </motion.section>

      {state.status === 'loading' && <LoadingState label={t('secCenter.scanningApprovals')} />}
      {state.status === 'error' && <ErrorState code={state.error} onRetry={() => run()} t={t} />}

      {state.status === 'ok' && (
        <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 15 }}>
          {rows.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.7 }}>
              {t(d?.coverage === 'known-spenders' ? 'secCenter.noneKnown' : 'secCenter.none')}
            </p>
          ) : (
            <div className="stack" style={{ gap: 2 }}>
              {rows.map((row) => row.approvals.map((ap) => {
                const key = `${row.token}:${ap.spender}`;
                const rev = revoking && revoking.key === key ? revoking : null;
                return (
                  <div key={key} className="intel-row" style={{ alignItems: 'flex-start' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 800, fontSize: 12.8 }}>
                        {row.symbol || row.name || <ShortAddr value={row.token} size={4} />}
                        <span className="faint" style={{ fontWeight: 500 }}> · {d.chainName}</span>
                      </span>
                      <span className="faint" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                        {t('secCenter.spender')}: <ShortAddr value={ap.spenderLabel || ap.spender} onClick={() => window.open(explorerAddr(Number(chain), ap.spender), '_blank', 'noopener,noreferrer')} />
                      </span>
                      <span className="faint" style={{ fontSize: 11, display: 'block' }}>
                        {t('secCenter.allowance')}: <span className="mono">{ap.unlimited ? t('explore.unlimited') : fmtCompact(Number(ap.allowanceRaw || 0) / 10 ** (row.decimals ?? 18))}</span>
                        {' · '}{t('secCenter.lastUsed')}: {ap.lastUsedAt ? timeAgo(ap.lastUsedAt, i18n.language) : t('intel.noData')}
                      </span>
                      {ap.riskWhy && <p className="faint" style={{ fontSize: 10.5, margin: '3px 0 0', lineHeight: 1.55 }}>{ap.riskWhy}</p>}
                      {rev && (
                        <p className="faint" style={{ fontSize: 10.5, margin: '4px 0 0' }}>
                          {rev.status === 'confirm' && t('secCenter.revokeConfirm')}
                          {rev.status === 'submitted' && <> {t('secCenter.revokeSent')} <button className="intel-link" onClick={() => window.open(explorerTx(Number(chain), rev.hash), '_blank', 'noopener,noreferrer')}>{rev.hash.slice(0, 10)}…</button></>}
                          {rev.status === 'zero' && t('secCenter.revokeZero')}
                          {rev.status === 'error' && t(`secCenter.revokeErr.${rev.error}`, { defaultValue: t('secCenter.revokeErr.FAILED') })}
                        </p>
                      )}
                    </span>
                    <span className="row" style={{ gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <LevelPill level={ap.risk} size="sm" />
                      <button type="button" className="icon-btn" style={{ padding: 6 }} aria-label={t('secCenter.view')} onClick={() => window.open(explorerAddr(Number(chain), row.token), '_blank', 'noopener,noreferrer')}>
                        <IconExternal width={13} height={13} />
                      </button>
                      {eligibility.ok && !rev?.hash && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={rev?.status === 'confirm' || rev?.status === 'submitted'}
                          onClick={() => doRevoke(row, ap)}
                        >
                          {t('secCenter.revoke')}
                        </button>
                      )}
                    </span>
                  </div>
                );
              }))}
            </div>
          )}
          <Notices notices={state.data?.notices} />
          <MetaLine meta={state.data?.meta} />
          {!eligibility.ok && (
            <p className="faint" style={{ fontSize: 10.5, margin: '8px 0 0', lineHeight: 1.6 }}>
              {eligibility.code === 'WRONG_NETWORK'
                ? t('secCenter.revokeWrongNetwork', { chain: EVM_CHAINS[eligibility.chainId]?.short || eligibility.chainId })
                : t('secCenter.revokeUnavailable')}
            </p>
          )}
          {checkerUrl && (
            <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={() => openUrl(checkerUrl)}>
              <IconExternal width={13} height={13} /> {t('secCenter.openExplorerChecker')}
            </button>
          )}
          <p className="faint" style={{ fontSize: 10.5, margin: '8px 0 0', lineHeight: 1.6 }}>{t('secCenter.revokeHonesty')}</p>
        </motion.section>
      )}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                       */
/* -------------------------------------------------------------------------- */

function AlertsSection() {
  const { t, i18n } = useTranslation();
  const wallet = useWallet();
  const params = wallet.address && !wallet.locked ? { wallet: wallet.address, chain: wallet.chainId } : {};
  const feed = useIntel(() => securityApi.alerts(params), [wallet.address, wallet.chainId, wallet.locked], { intervalMs: 90_000 });
  const alerts = feed.data?.data?.alerts || [];
  const sevTone = (s) => (s === 'HIGH' ? 'var(--down)' : s === 'MEDIUM' ? 'var(--rgb-5)' : s === 'LOW' ? 'var(--rgb-1)' : 'var(--text-3)');

  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
        <div className="row-between">
          <p className="section-label" style={{ margin: 0 }}>{t('secCenter.alertsTitle')}</p>
          <button className="icon-btn" style={{ padding: 6 }} aria-label={t('common.refresh')} onClick={feed.reload}>
            <IconRefresh width={13} height={13} className={feed.loading ? 'intel-spin' : undefined} />
          </button>
        </div>
        <p className="faint" style={{ fontSize: 10.8, margin: '6px 0 0', lineHeight: 1.6 }}>{t('secCenter.alertsNature')}</p>
        {wallet.address && !wallet.locked && (
          <p className="faint" style={{ fontSize: 10.5, margin: '6px 0 0' }}>{t('secCenter.alertsWithWallet')} <ShortAddr value={wallet.address} size={4} /></p>
        )}
      </motion.section>
      {feed.loading && !alerts.length && <LoadingState />}
      {feed.error && <ErrorState code={intelErrorCode(feed.error)} onRetry={feed.reload} t={t} />}
      {!feed.error && alerts.length === 0 && !feed.loading && (
        <EmptyState icon="✓" title={t('secCenter.noAlerts')} note={t('secCenter.noAlertsNote')} />
      )}
      {alerts.length > 0 && (
        <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 6 }}>
          {alerts.map((a) => (
            <div key={a.id} className="intel-row" style={{ alignItems: 'flex-start', padding: '10px 9px' }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: sevTone(a.severity), marginTop: 5, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 12.2 }}>{t(`secCenter.alert.${a.type}`, { defaultValue: a.type.replace(/[-.]/g, ' ') })}</strong>
                  <span className="pill pill-neutral" style={{ fontSize: 9 }}>{t(`secCenter.severity.${a.severity}`, a.severity)}</span>
                  {a.chainId != null && <span className="faint" style={{ fontSize: 10 }}>{EVM_CHAINS[a.chainId]?.short || ''}</span>}
                </span>
                <p className="intel-check-detail" style={{ margin: '3px 0 0' }}>{a.detail}</p>
                {a.subject && /^0x[a-fA-F0-9]{40}$/.test(a.subject) && (
                  <ShortAddr value={a.subject} onClick={() => window.open(explorerAddr(a.chainId || wallet.chainId, a.subject), '_blank', 'noopener,noreferrer')} title={a.subject} />
                )}
                {a.subject && !/^0x[a-fA-F0-9]{40}$/.test(a.subject) && (
                  <span className="faint mono" style={{ fontSize: 10, direction: 'ltr' }}>{a.subject}</span>
                )}
                <span className="faint" style={{ fontSize: 10 }}>{a.at ? timeAgo(Date.parse(a.at), i18n.language) : ''}</span>
              </span>
              {a.link && (
                <button type="button" className="icon-btn" style={{ padding: 6 }} aria-label={t('secCenter.sourceLink')} onClick={() => openUrl(a.link)}>
                  <IconExternal width={12} height={12} />
                </button>
              )}
            </div>
          ))}
        </motion.section>
      )}
      <MetaLine meta={feed.data?.meta} />
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity timeline                                                            */
/* -------------------------------------------------------------------------- */

function ActivitySection() {
  const { t, i18n } = useTranslation();
  const feed = useIntel(() => securityApi.activity({ limit: 50 }), [], { intervalMs: 45_000 });
  const events = feed.data?.data?.events || [];

  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="docs-card" data-open="true" variants={riseIn} style={{ padding: 15 }}>
        <div className="row-between">
          <p className="section-label" style={{ margin: 0 }}>{t('secCenter.activityTitle')}</p>
          <button className="icon-btn" style={{ padding: 6 }} aria-label={t('common.refresh')} onClick={feed.reload}>
            <IconRefresh width={13} height={13} className={feed.loading ? 'intel-spin' : undefined} />
          </button>
        </div>
        <p className="faint" style={{ fontSize: 10.5, margin: '6px 0 0', lineHeight: 1.6 }}>{t('secCenter.activityNote')}</p>
      </motion.section>
      {feed.loading && !events.length && <LoadingState />}
      {feed.error && <ErrorState code={intelErrorCode(feed.error)} onRetry={feed.reload} t={t} />}
      {!feed.error && events.length > 0 && (
        <motion.section className="docs-card" data-open="false" variants={riseIn} style={{ padding: 6 }}>
          {events.map((e, i) => {
            const dt = e.at ? new Date(e.at) : null;
            return (
              <div key={`${e.at}-${i}`} className="intel-row" style={{ padding: '9px 9px' }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, minWidth: 46, direction: 'ltr' }}>
                  {dt ? `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}` : '—'}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t(`secCenter.act.${e.type}`, { defaultValue: e.type.replace(/[.\-]/g, ' ') })}
                  </span>
                  <span className="faint" style={{ fontSize: 10.5 }}>{e.detail}</span>
                </span>
                <span className="faint mono" style={{ fontSize: 9.5, flexShrink: 0 }}>{e.at ? timeAgo(Date.parse(e.at), i18n.language) : ''}</span>
              </div>
            );
          })}
        </motion.section>
      )}
      {!feed.error && events.length === 0 && !feed.loading && (
        <EmptyState icon="◷" title={t('secCenter.noActivity')} note={t('secCenter.noActivityNote')} />
      )}
      {feed.data?.data?.meta?.note && <p className="faint" style={{ fontSize: 10.5, margin: 0, lineHeight: 1.65 }}>{feed.data.data.meta.note}</p>}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Policy — the original Audit page content, kept and kept honest              */
/* -------------------------------------------------------------------------- */

const PROTECTIONS = ['keys', 'encryption', 'server', 'lock', 'privacy', 'network'];
const THREATS = ['phrase', 'approvals', 'fakeApps', 'address', 'support'];
const AUDITED = [
  { id: 'kyber', url: 'https://docs.kyberswap.com/security/audits' },
  { id: 'pancake', url: 'https://docs.pancakeswap.finance/readme/audits' },
  { id: 'walletconnect', url: 'https://docs.reown.com' }
];

function PolicySection() {
  const { t } = useTranslation();
  return (
    <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
      <motion.section className="card" variants={riseIn} style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08), transparent)', border: '1px solid rgba(16,185,129,0.25)' }}>
        <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
          <div style={{ width: 42, height: 42, borderRadius: 999, background: 'rgba(16,185,129,0.2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <IconShield width={22} height={22} color="#10b981" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6, color: '#10b981' }}>{t('audit.nonCustodial')}</div>
            <p className="prose-sm" style={{ lineHeight: 1.65 }}>{t('audit.nonCustodialBody')}</p>
          </div>
        </div>
      </motion.section>

      <section>
        <p className="section-label">{t('audit.howProtected')}</p>
        <motion.div className="stack" style={{ gap: 9, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
          {PROTECTIONS.map((k) => (
            <motion.div key={k} className="card card-tight" variants={riseIn}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--rgb-1)', flexShrink: 0, marginTop: 1 }}>
                  <IconLock width={16} height={16} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12.8 }}>{t(`audit.prot.${k}.title`)}</div>
                  <p className="prose-sm" style={{ marginTop: 4, fontSize: 12.2 }}>{t(`audit.prot.${k}.body`)}</p>
                  <p className="prose-sm" style={{ marginTop: 6, fontSize: 11.8, color: 'var(--rgb-5)', borderInlineStart: '2px solid var(--rgb-5)', paddingInlineStart: 9 }}>
                    {t(`audit.prot.${k}.limit`)}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section>
        <p className="section-label">{t('audit.threats')}</p>
        <p className="prose-sm" style={{ marginTop: 6, marginBottom: 9 }}>{t('audit.threatsIntro')}</p>
        <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
          {THREATS.map((k, i) => (
            <motion.div key={k} className="card card-tight" variants={riseIn}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <span className="mono" style={{ minWidth: 20, height: 20, borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, background: 'rgba(255,59,107,.16)', color: 'var(--down)' }}>
                  {i + 1}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12.6 }}>{t(`audit.threat.${k}.title`)}</div>
                  <p className="prose-sm" style={{ marginTop: 3, fontSize: 12.2 }}>{t(`audit.threat.${k}.body`)}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section>
        <p className="section-label">{t('audit.audited')}</p>
        <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
          {AUDITED.map((a) => (
            <motion.button key={a.id} className="wallet-option" variants={riseIn} whileTap={{ scale: 0.985 }} onClick={() => openUrl(a.url)}>
              <span className="wallet-badge" style={{ color: 'var(--up)' }}><IconShield width={19} height={19} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13 }}>{t(`audit.item.${a.id}.name`)}</span>
                <span className="set-row-sub">{t(`audit.item.${a.id}.desc`)}</span>
              </span>
              <IconExternal width={16} height={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            </motion.button>
          ))}
        </motion.div>
        <p className="faint" style={{ fontSize: 10.5, margin: '8px 0 0', lineHeight: 1.6 }}>{t('secCenter.auditVsSafe')}</p>
      </section>

      <section>
        <p className="section-label">{t('audit.feeTransparency')}</p>
        <motion.div className="card stack" style={{ gap: 8, marginTop: 8 }} variants={riseIn} initial="hidden" animate="show">
          <div className="row-between">
            <span className="faint">{t('audit.feeRate')}</span>
            <span className="mono">{FEE_BPS / 100}%</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('audit.feeWallet')}</span>
            <span className="mono" style={{ fontSize: 10.5 }}>{FEE_RECIPIENT.slice(0, 10)}…{FEE_RECIPIENT.slice(-6)}</span>
          </div>
          <div className="stack" style={{ gap: 6, marginTop: 4 }}>
            <span className="faint">{t('audit.network')}</span>
            {payoutTable().map((row) => (
              <div className="row-between" key={row.id} style={{ gap: 10 }}>
                <span className="row" style={{ gap: 7, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: row.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{row.label}</span>
                </span>
                <span className="mono faint" style={{ fontSize: 10, direction: 'ltr' }}>
                  {row.address.slice(0, 6)}…{row.address.slice(-4)} · {row.gas}
                </span>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => openUrl(`${EVM_CHAINS[56].explorer}/address/${FEE_RECIPIENT}`)}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
              <IconExternal width={14} height={14} /> {t('audit.viewOnChain')}
            </span>
          </button>
        </motion.div>
      </section>

      <motion.section className="card" variants={riseIn}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-2)' }}><IconKey width={19} height={19} /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t('audit.disclosure')}</div>
            <p className="prose-sm">{t('audit.bounty')}</p>
          </div>
        </div>
      </motion.section>

      {/* the one old section that only made sense on the dedicated page */}
      <motion.section className="card" variants={riseIn}>
        <p className="section-label" style={{ marginBottom: 8 }}>{t('audit.ours')}</p>
        <div className="row-between" style={{ marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>FeeRouter.sol</span>
          <span className="pill pill-down">{t('audit.notAudited')}</span>
        </div>
        <p className="prose-sm">{t('audit.ourContractBody')}</p>
        <p className="prose-sm" style={{ marginTop: 9 }}>{t('audit.sourceNote')}</p>
      </motion.section>
    </motion.div>
  );
}
