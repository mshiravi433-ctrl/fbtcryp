import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import Switch from '../components/Switch';
import SegIndicator from '../components/SegIndicator';
import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS } from '../lib/chains';
import {
  SOLVER_CAPABILITIES,
  WORKFLOW_ACTIONS,
  WORKFLOW_REVERT_POLICIES,
  compileIntent,
  isSingleChainWorkflowSteps,
  loadIntentMemory,
  loadIntents,
  removeIntent,
  saveCompiledIntent,
  saveIntentMemory
} from '../lib/intentOS';
import { addOrder, createOrder } from '../lib/orders';
import {
  downloadExecutionProof,
  loadExecutionProofs,
  verifyExecutionProof
} from '../lib/executionProof';
import { getIntentCapabilities, getIntentPublicStatus } from '../lib/intentNetwork';
import { INTENT_AI_VERSION, mayExecute, verifyWalletChain, multichainCoverage, walletSecurityPosture } from '../lib/intent-ai/index.js';
import IntentRail from '../components/IntentRail';
import ProfitPlanner from '../components/ProfitPlanner';
import IntentCrossChainPanel from '../components/IntentCrossChainPanel';
import IntentTxHistory from '../components/IntentTxHistory';
import { useWallet } from '../context/WalletContext';
import {
  ensureLifecycle,
  expireIfDue,
  getLifecycle,
  saveLifecycle,
  transition
} from '../lib/intentLifecycle';
import { IntentTimeline } from '../components/IntentTimeline';
import { confidentialSwapReadiness } from '../lib/confidentialIntent';
import { fetchCatalog, fetchCertifications, localizedValue } from '../lib/ecosystemCatalog';
import '../styles/intent-os.css';

const TABS = ['compose', 'plan', 'crosschain', 'memory', 'proofs', 'history', 'agents', 'strategies', 'network'];
/* Which registry each tab reads. Only these two tabs fetch a catalog. */
const TAB_CATALOG = { agents: 'agent', strategies: 'strategy' };
const TEMPLATES = [
  { id: 'swap', icon: '↗', kind: 'swap' },
  { id: 'outcome', icon: '◎', kind: 'outcome' },
  { id: 'automation', icon: '⌁', kind: 'automation' },
  { id: 'workflow', icon: '⛓', kind: 'workflow' }
];

const defaultWorkflowStep = (id, action, asset, target, chainId) => ({
  id,
  action,
  asset,
  target,
  chainId,
  minOutput: '',
  maxInput: '',
  revertPolicy: 'abort-all'
});

const DEFAULT_WORKFLOW = [
  defaultWorkflowStep('swap', 'swap', 'USDC', 'Swap USDC to ETH', 42161),
  defaultWorkflowStep('deposit', 'deposit', 'ETH', 'Deposit into lending', 42161)
];

function StageRail({ t }) {
  const stages = ['intent', 'risk', 'solvers', 'simulation', 'execution', 'verification'];
  return (
    <div className="ios-stage-rail" aria-label={t('intentOS.pipelineTitle')}>
      {stages.map((stage, index) => (
        <div className="ios-stage" key={stage}>
          <span>{index + 1}</span>
          <small>{t(`intentOS.stage.${stage}`)}</small>
        </div>
      ))}
    </div>
  );
}

/**
 * ─── THIS BANNER USED TO LIE, AND THE FIX IS THE WHOLE POINT ───────────────
 * Reported as "why is this here?" — a strip reading "System Active &
 * Verified ... Current operational evidence is attested", while the settings
 * screen was simultaneously reporting "activation status unavailable" and 80
 * unmet operational notes.
 *
 * The cause is one line: `const banner = ACTIVE_BANNER`. The three "everything
 * is verified" sentences were a module-level constant rendered unconditionally,
 * while `active` — the flag that actually knows better — only ever tinted the
 * border. So a deployment with 12 of 21 evidence kinds, 0 live phases and
 * `launchAllowed: false` greeted the user with "System Active & Verified."
 *
 * On a wallet screen that is not a cosmetic bug. The strip is the first thing
 * above the compose form, and it is the sentence a person reads to decide how
 * much they trust what follows.
 *
 * The copy now comes from the same server state that drives settings:
 *   · `launchAllowed` false → the honest "activation pending" lines, in the
 *     user's language, with the evidence count that explains why
 *   · the server's own `banner` array is kept as the fallback for a status we
 *     have not translated yet — an untranslated English sentence that is TRUE
 *     beats a translated one that is not
 * The internal spec id stays on screen, but as a build identifier, not as part
 * of the claim.
 */
const ACTIVE_BANNER_KEYS = ['intentOS.launchBanner.b1', 'intentOS.launchBanner.b2', 'intentOS.launchBanner.b3'];
const PENDING_BANNER_KEYS = ['intentOS.launchBanner.p1', 'intentOS.launchBanner.p2', 'intentOS.launchBanner.p3'];

const ACTIVE_BANNER_FALLBACK = [
  'System Active & Verified.',
  'Execution Ready — wallet confirmation remains required.',
  'Current operational evidence is attested and within its validity window.'
];

function LaunchStatusStrip({ t, publicStatus }) {
  const active = publicStatus?.status !== 'unavailable' && publicStatus?.launchAllowed !== false;
  const evidence = publicStatus?.evidence?.status || publicStatus?.evidence || null;
  const storedEvidence = Number(publicStatus?.evidence?.stored ?? 0);
  const reviewReady = !active && storedEvidence > 0;

  /* The server's own lines, used when we have no translation for this state —
     see the note above on why an untranslated truth wins. */
  const serverBanner = publicStatus?.operationalActivation?.banner;
  const lines = active
    ? ACTIVE_BANNER_KEYS.map((key, i) => t(key, { defaultValue: ACTIVE_BANNER_FALLBACK[i] }))
    : reviewReady
      ? ['r1', 'r2', 'r3'].map((id) => t(`intentOS.launchBanner.${id}`)).filter(Boolean)
      : PENDING_BANNER_KEYS.map((key, i) => t(key, { defaultValue: serverBanner?.[i] || '' })).filter(Boolean);

  return (
    <section
      className={`ios-launch-status${active ? ' is-active' : ' is-pending'}`}
      aria-live="polite"
      data-testid="intent-os-launch-status"
      data-active={active ? 'true' : 'false'}
    >
      <div className="ios-launch-status-head">
        <span className="ios-launch-dot" aria-hidden="true" />
        <strong>
          {active
            ? t('intentOS.launchBanner.active', { defaultValue: 'System Active & Verified' })
            : reviewReady
              ? t('intentOS.launchBanner.reviewReady', { defaultValue: 'Intent OS review and signing mode is ready' })
              : t('intentOS.launchBanner.pending', { defaultValue: 'Activation pending verification' })}
        </strong>
        <code className="ios-build-id" title={t('intentOS.launchBanner.buildId', { defaultValue: 'Intent AI build identifier' })}>
          {t('intentOS.launchBanner.build', { defaultValue: 'build' })} {INTENT_AI_VERSION}
        </code>
      </div>
      <ul>
        {(lines.length ? lines : (serverBanner || ACTIVE_BANNER_FALLBACK)).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <small>
        {active
          ? t('intentOS.launchBanner.activeNote', { defaultValue: 'Operational evidence is current. Review the final transaction in your wallet before signing.' })
          : reviewReady
            ? t('intentOS.launchBanner.reviewNote', { defaultValue: 'The usable Intent OS surfaces are online in wallet-confirmed mode; full operator evidence is still tracked separately.' })
            : t('intentOS.launchBanner.pendingNote', { defaultValue: 'This deployment has not earned operational activation yet. Nothing here executes on its own — and any execution would still need your wallet.' })}
        {evidence ? ` (${t('intentOS.launchBanner.evidence', { defaultValue: 'evidence' })} ${evidence})` : ''}
      </small>
    </section>
  );
}

function CheckRow({ row, t }) {
  const icon = row.level === 'pass' ? '✓' : row.level === 'block' ? '×' : '!';
  return (
    <div className={`ios-check ios-${row.level}`}>
      <span className="ios-check-icon" aria-hidden="true">{icon}</span>
      <span>
        <strong>{t(`intentOS.check.${row.id}.title`)}</strong>
        <small>{t(`intentOS.check.${row.id}.body`, row.detail || {})}</small>
      </span>
    </div>
  );
}

function SolverRow({ solver, t }) {
  return (
    <div className="ios-solver-row">
      <span className={`ios-solver-dot ${solver.status}`} />
      <span className="ios-solver-copy">
        <strong>{t(`intentOS.solver.${solver.id}.title`, { defaultValue: solver.id })}</strong>
        <small>{t(`intentOS.solver.${solver.id}.body`, { defaultValue: solver.detail })}</small>
      </span>
      <span className={`ios-status ${solver.status}`}>{t(`intentOS.solverStatus.${solver.status}`)}</span>
    </div>
  );
}

function ProofRow({ proof, t, onVerify }) {
  const payload = proof.payload || {};
  const selected = payload.decision?.selected;
  const pair = payload.constraints
    ? `${payload.constraints.from?.symbol || '—'} → ${payload.constraints.to?.symbol || '—'}`
    : payload.workflow
      ? `${payload.workflow.nodeCount || '—'} · ${payload.claim?.code || 'workflow'}`
      : '—';
  return (
    <div className="ios-proof-card">
      <div className="row-between">
        <span className="ios-proof-seal">✓</span>
        <span className="ios-status eligible">{t('intentOS.proof.confirmed')}</span>
      </div>
      <strong className="mono ios-proof-id">{proof.id}</strong>
      <div className="ios-proof-pair">
        <span>{pair}</span>
        <span className="mono">{selected?.solver || payload.claim?.code || '—'}</span>
      </div>
      <p>{payload.claim?.scope || t('intentOS.proof.scope')}</p>
      <div className="ios-proof-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => onVerify(proof)}>{t('intentOS.proof.verify')}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => downloadExecutionProof(proof)}>{t('intentOS.proof.download')}</button>
      </div>
    </div>
  );
}

/* ---------------------- ecosystem catalog (read-only) --------------------- */
/*
 * These cards are DISPLAY ONLY, and that is a product decision rather than an
 * unfinished screen. The registry stores self-reported metadata that nobody
 * reviewed; the moment a card grows a "run", "install" or "enable" button, the
 * "no automatic execution, no signer" promise printed on the same screen stops
 * being true. Every listing therefore renders as unverified, with its bounds
 * spelled out, and nothing else.
 */
const chainLabel = (id) => EVM_CHAINS[id]?.short || EVM_CHAINS[id]?.name || `#${id}`;
const chainSummary = (ids, t) => (Array.isArray(ids) && ids.length ? ids.slice(0, 4).map(chainLabel).join(' · ') : t('intentOS.catalog.notStated'));

function CatalogFact({ label, value }) {
  return <span className="ios-catalog-fact"><b>{value}</b><small>{label}</small></span>;
}

/*
 * The badge has exactly two states and they mean different things:
 * `certified` — a named reviewer issued a certification the server checked
 * this request, for this content; anything else — self-reported. The client
 * never upgrades a listing on its own, and the issuer is always shown, because
 * "verified" without "by whom" is just a colour.
 */
/**
 * The evidence drawer.
 *
 * A badge the user cannot check is a logo, so tapping "evidence" fetches the
 * public certification records for this subject and shows who issued them,
 * when they expire, and the artefact behind each one. Links are rendered only
 * when the client-side reader has already proved they are https.
 */
function EvidenceDrawer({ subjectId, t }) {
  const [state, setState] = useState({ status: 'loading', items: [] });
  useEffect(() => {
    let active = true;
    fetchCertifications(subjectId).then((result) => { if (active) setState(result); });
    return () => { active = false; };
  }, [subjectId]);

  if (state.status === 'loading') return <p className="ios-catalog-trust ios-catalog-muted">{t('intentOS.catalog.evidenceLoading')}</p>;
  if (state.status !== 'live' || !state.items.length) return <p className="ios-catalog-trust ios-catalog-muted">{t('intentOS.catalog.evidenceNone')}</p>;

  return (
    <div className="ios-catalog-evidence">
      {state.items.map((row) => (
        <div key={row.id} className="ios-catalog-evidence-row">
          <span className="row-between">
            <b>{row.type ? t(`intentOS.catalog.certificationType.${row.type}`) : row.id}</b>
            <span className={`ios-status ${row.status === 'active' ? 'eligible' : 'unavailable'}`}>{t(`intentOS.catalog.certStatus.${row.status}`)}</span>
          </span>
          <small>{t('intentOS.catalog.issuedBy', { issuer: row.issuer || '—', date: row.issuedAt ? new Date(row.issuedAt).toISOString().slice(0, 10) : '—' })}</small>
          {row.expiresAt ? <small>{t('intentOS.catalog.expires', { date: new Date(row.expiresAt).toISOString().slice(0, 10) })}</small> : null}
          {row.evidence.map((item, index) => (
            <small key={`${row.id}-${index}`}>
              {t(`dev.review.evidence.${item.type}`)}{': '}
              {item.uri
                ? <a href={item.uri} target="_blank" rel="noreferrer noopener">{t('intentOS.catalog.openEvidence')}</a>
                : <span className="mono">{item.sha256.slice(0, 16)}…</span>}
            </small>
          ))}
        </div>
      ))}
    </div>
  );
}

function CatalogCard({ ns, entry, lang, t, facts }) {
  const description = localizedValue(entry.description, lang, null);
  const cert = entry.certification;
  const rep = entry.reputation;
  const [showEvidence, setShowEvidence] = useState(false);
  return (
    <article className="ios-catalog-card">
      <div className="row-between">
        <strong>{localizedValue(entry.name, lang, entry.id)}</strong>
        <span className={`ios-status ${cert ? 'eligible' : 'unavailable'}`}>
          {cert ? t('intentOS.catalog.certified') : t(`intentOS.${ns}.unverified`)}
        </span>
      </div>
      <span className="mono ios-catalog-id">{entry.id}</span>
      {description ? <p>{description}</p> : null}
      {cert ? (
        <p className="ios-catalog-trust">
          {t('intentOS.catalog.certifiedBy', { issuer: cert.issuers.join(' · ') })}
          {' · '}
          {cert.types.map((type) => t(`intentOS.catalog.certificationType.${type}`)).join(' · ')}
        </p>
      ) : null}
      {rep ? (
        <p className="ios-catalog-trust">
          {t('intentOS.catalog.observed', {
            rate: Math.round(rep.successRate * 100),
            samples: rep.sampleSize,
            days: rep.windowDays || 30
          })}
        </p>
      ) : (
        <p className="ios-catalog-trust ios-catalog-muted">{t('intentOS.catalog.noReputation')}</p>
      )}
      <div className="ios-catalog-facts">
        {facts.map((fact) => <CatalogFact key={fact.label} label={fact.label} value={fact.value} />)}
      </div>
      {/* Read-only, and the only button a listing card will ever have. */}
      <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowEvidence((open) => !open)}>
        {showEvidence ? t('intentOS.catalog.hideEvidence') : t('intentOS.catalog.showEvidence')}
      </button>
      {showEvidence ? <EvidenceDrawer subjectId={entry.id} t={t} /> : null}
    </article>
  );
}

function AgentCard({ entry, lang, t }) {
  return (
    <CatalogCard
      ns="agents"
      entry={entry}
      lang={lang}
      t={t}
      facts={[
        { label: t('intentOS.agents.execution'), value: t(`intentOS.agents.mode.${entry.executionMode}`) },
        { label: t('intentOS.catalog.chains'), value: chainSummary(entry.supportedChains, t) },
        { label: t('intentOS.catalog.approval'), value: t('intentOS.catalog.required') },
        { label: t('intentOS.catalog.withdraw'), value: t('intentOS.catalog.never') }
      ]}
    />
  );
}

function StrategyCard({ entry, lang, t }) {
  const policy = entry.policy || {};
  return (
    <CatalogCard
      ns="strategies"
      entry={entry}
      lang={lang}
      t={t}
      facts={[
        { label: t('intentOS.strategies.trigger'), value: entry.trigger ? t(`intentOS.strategies.triggerType.${entry.trigger}`) : t('intentOS.strategies.triggerType.manual') },
        { label: t('intentOS.strategies.maxAmount'), value: policy.maxAmountUsd === null || policy.maxAmountUsd === undefined ? t('intentOS.catalog.notStated') : `$${policy.maxAmountUsd}` },
        { label: t('intentOS.strategies.maxSlippage'), value: policy.maxSlippageBps === null || policy.maxSlippageBps === undefined ? t('intentOS.catalog.notStated') : `${policy.maxSlippageBps} bps` },
        { label: t('intentOS.catalog.chains'), value: chainSummary(policy.allowedChains, t) },
        { label: t('intentOS.catalog.approval'), value: t('intentOS.catalog.required') },
        { label: t('intentOS.strategies.automatic'), value: t('intentOS.catalog.never') }
      ]}
    />
  );
}

/**
 * One honest state machine for both catalog tabs:
 *   loading      — the request is in flight
 *   error        — the request failed; we claim nothing about the registry
 *   unavailable  — no durable registry is configured (the pre-existing copy)
 *   live + empty — the registry answered and nobody has listed anything yet
 *   live + rows  — the listings, unverified
 */
function CatalogSection({ ns, catalog, lang, t, onRetry, onLoadMore }) {
  const state = catalog?.state || 'loading';
  if (state === 'loading') {
    return <section className="ios-empty-proof"><span>◇</span><h3>{t(`intentOS.${ns}.loading`)}</h3></section>;
  }
  if (state === 'error') {
    return (
      <section className="ios-empty-proof">
        <span>◇</span>
        <h3>{t(`intentOS.${ns}.errorTitle`)}</h3>
        <p>{t(`intentOS.${ns}.errorBody`)}</p>
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>{t('intentOS.catalog.retry')}</button>
      </section>
    );
  }
  if (state === 'unavailable') {
    return (
      <section className="ios-empty-proof">
        <span>◇</span>
        <h3>{t(`intentOS.${ns}.emptyTitle`)}</h3>
        <p>{t(`intentOS.${ns}.emptyBody`)}</p>
        <small>{t(`intentOS.${ns}.emptyNote`)}</small>
      </section>
    );
  }
  const items = catalog?.items || [];
  if (!items.length) {
    return (
      <section className="ios-empty-proof">
        <span>◇</span>
        <h3>{t(`intentOS.${ns}.emptyTitle`)}</h3>
        <p>{t(`intentOS.${ns}.emptyLiveBody`)}</p>
        <small>{t(`intentOS.${ns}.emptyNote`)}</small>
      </section>
    );
  }
  return (
    <>
      <div className="ios-catalog-list">
        <span className="ios-eyebrow">{t(`intentOS.${ns}.total`, { total: items.length })}</span>
        {items.map((entry) => (ns === 'agents'
          ? <AgentCard key={entry.id} entry={entry} lang={lang} t={t} />
          : <StrategyCard key={entry.id} entry={entry} lang={lang} t={t} />))}
        {catalog?.hasMore ? (
          <button className="btn btn-ghost btn-sm" disabled={catalog.loadingMore} onClick={() => onLoadMore(catalog.cursor)}>
            {catalog.loadingMore ? t(`intentOS.${ns}.loading`) : t('intentOS.catalog.loadMore')}
          </button>
        ) : null}
        {catalog?.pageError ? <p className="ios-catalog-trust ios-catalog-muted">{t('intentOS.catalog.pageError')}</p> : null}
      </div>
      <p className="ios-honesty-note">{t(`intentOS.${ns}.listNote`)}</p>
    </>
  );
}

export default function IntentOS() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const requested = searchParams.get('tab');
    return TABS.includes(requested) ? requested : 'compose';
  });
  /*
   * ─── THE TAB MUST FOLLOW THE URL, NOT JUST THE FIRST PAINT ────────────────
   * Reported as "many tabs are broken / the wiring is wrong" — and the wiring
   * failure was real. The tab was read ONCE, inside the useState initializer,
   * and AnimatedRoutes keys the route tree by PATHNAME only. So a change from
   * /intent?tab=agents to /intent?tab=strategies never remounted this page,
   * never re-ran the initializer, and the visible tab simply ignored the URL.
   *
   * That is exactly what the AI panel's plain-anchor chips (#/intent?tab=…),
   * the Swap screen's proof link, browser back/forward and any shared link
   * produce when /intent is already open: the address bar changes, the chip
   * was pressed, and NOTHING happens on screen. Syncing here makes every one
   * of those paths land, while chooseTab (which sets both together) stays a
   * no-op through this effect.
   */
  const requestedTab = searchParams.get('tab');
  useEffect(() => {
    const fromUrl = TABS.includes(requestedTab) ? requestedTab : 'compose';
    setTab((current) => (current === fromUrl ? current : fromUrl));
  }, [requestedTab]);
  /*
   * `loadIntentMemory()` is a localStorage JSON parse. It used to run THREE
   * times during initial state setup — once for `memory`, then twice inside
   * the `draft` initializer. Read it once via useRef(loadIntentMemory()) so
   * state initializers share the same parsed object without re-parsing.
   */
  const intentMemoryAtBoot = useRef(loadIntentMemory());

  const [memory, setMemory] = useState(() => intentMemoryAtBoot.current);
  const [saved, setSaved] = useState(() => loadIntents());
  const [proofs, setProofs] = useState(() => loadExecutionProofs());
  const [verified, setVerified] = useState(null);
  const [compiled, setCompiled] = useState(null);
  /* The real lifecycle for the intent on screen (fbt.intent-lifecycle.v1).
     It is created here at compile time and continued by the swap screen, so
     the timeline is never a decorative mock. */
  const [lifecycle, setLifecycle] = useState(null);
  const [networkStatus, setNetworkStatus] = useState(null);
  const [publicStatus, setPublicStatus] = useState(null);
  /*
   * Ecosystem catalogs are fetched lazily, once, and only for the tab being
   * viewed: the compose tab is the hot path and must not pay for two extra
   * requests nobody asked for. `catalogRequested` is a ref rather than state
   * so a re-render cannot re-issue an in-flight request; a failed attempt
   * clears its flag so the Retry button can try again.
   */
  const [catalogs, setCatalogs] = useState({ agent: null, strategy: null });
  const catalogRequested = useRef({});
  /*
   * The wallet's Optimize button prefills a real draft via ?from=&to=&chain=
   * (never signs anything — this is the compose screen). Symbols are accepted
   * only if they exist in the chain registry, so an unknown token can never
   * slip into a compiled intent.
   */
  // Level 2 policy: a pre-authorized ceiling is never an execution approval.
  // Sensitive operations still require an explicit confirmation gate.
  const [executionPolicy, setExecutionPolicy] = useState({
    maxCapitalUsd: '1000',
    maxTransactionUsd: '250',
    maxLossUsd: '100',
    approvalMode: 'sensitive'
  });

  /*
   * Loan page hand-off (hint=loan-supply|loan-borrow). The Loan page used to
   * send users here with `?tab=default&hint=loan-borrow` and NOTHING consumed
   * those params — the user confirmed a borrow sheet and landed on a bare
   * swap composer under a launch banner, which looked exactly like an error.
   * Now the params pre-fill a lending workflow (approve → deposit for
   * supply, deposit collateral → borrow for borrow) so the confirm →
   * compose → compile chain stays continuous.
   */
  const [loanHandoff] = useState(() => {
    const hint = searchParams.get('hint');
    if (hint !== 'loan-supply' && hint !== 'loan-borrow') return null;
    const cleanAmount = (v) => {
      if (typeof v !== 'string' || !/^\d*\.?\d+$/.test(v.trim())) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n < 1e12 ? String(n) : null;
    };
    return {
      hint,
      amount: cleanAmount(searchParams.get('amount')),
      collateral: cleanAmount(searchParams.get('collateral'))
    };
  });

  const [draft, setDraft] = useState(() => {
    const mem = intentMemoryAtBoot.current;
    const known = (v) => {
      if (typeof v !== 'string' || !v.trim()) return null;
      const up = v.trim().toUpperCase();
      return Object.values(TOKENS).some((list) => Array.isArray(list) && list.some((tk) => tk.symbol === up))
        ? up
        : null;
    };
    const chainParam = Number(searchParams.get('chain'));
    const chainId = Number.isInteger(chainParam) && EVM_CHAINS[chainParam] ? chainParam : mem.preferredChainId;
    /*
     * A prefill that arrives as ?from=USDC (Signals) or ?to=USDC must never
     * resolve to from === to: that draft would die at compile with SAME_TOKEN
     * before the user touched anything. If both sides name the same symbol,
     * the side that was NOT supplied by the URL falls back to a different,
     * known token — the user's explicit input is never silently overwritten,
     * only the default partner is chosen sensibly.
     */
    const fromParam = known(searchParams.get('from'));
    const toParam = known(searchParams.get('to'));
    const fallbackPartner = (symbol) => (symbol === 'ETH' ? 'USDC' : 'ETH');
    let fromSymbol = fromParam ?? 'USDC';
    let toSymbol = toParam ?? 'ETH';
    if (fromSymbol === toSymbol) {
      if (toParam == null) toSymbol = fallbackPartner(fromSymbol);
      else if (fromParam == null) fromSymbol = fallbackPartner(toSymbol);
      else toSymbol = fallbackPartner(fromSymbol);
    }
    if (loanHandoff) {
      const amount = loanHandoff.amount || '';
      const collateral = loanHandoff.collateral || '';
      const steps = loanHandoff.hint === 'loan-supply'
        ? [
          { ...defaultWorkflowStep('approve', 'approve', fromSymbol, 'Approve lending pool access', chainId), maxInput: amount },
          { ...defaultWorkflowStep('deposit', 'deposit', fromSymbol, 'Deposit into lending pool', chainId), maxInput: amount }
        ]
        : [
          { ...defaultWorkflowStep('deposit', 'deposit', fromSymbol, 'Deposit collateral', chainId), maxInput: collateral },
          { ...defaultWorkflowStep('borrow', 'borrow', fromSymbol, 'Borrow against collateral', chainId), minOutput: amount }
        ];
      return {
        kind: 'workflow',
        chainId,
        fromSymbol,
        toSymbol: fromSymbol,
        amountIn: loanHandoff.hint === 'loan-supply' ? (amount || '1000') : (collateral || '1000'),
        amountUsd: loanHandoff.hint === 'loan-supply' ? (amount || '1000') : (collateral || '1000'),
        minReceive: '',
        deadlineHours: 2,
        maxSlippagePct: mem.maxSlippagePct,
        privacy: 'standard',
        conditionType: 'priceBelow',
        conditionValue: '2500',
        note: '',
        steps
      };
    }
    return {
      kind: 'swap',
      chainId,
      fromSymbol,
      toSymbol,
      amountIn: '1000',
      amountUsd: '1000',
      minReceive: '',
      deadlineHours: 2,
      maxSlippagePct: intentMemoryAtBoot.current.maxSlippagePct,
      privacy: 'standard',
      conditionType: 'priceBelow',
      conditionValue: '2500',
      note: '',
      steps: DEFAULT_WORKFLOW
    };
  });

  const activeTemplate = TEMPLATES.find((item) => item.kind === draft.kind);
  const savedDrafts = useMemo(() => saved.slice(0, 4), [saved]);
  /*
   * Derived values that only change when their inputs change. Memoizing keeps
   * the per-keystroke compose renders cheap: t() lookups and capability
   * inspection do not re-run for every character typed into a field.
   */
  const confidentialReadiness = useMemo(() => confidentialSwapReadiness(networkStatus), [networkStatus]);
  const confidentialSelectable = draft.kind === 'swap' && confidentialReadiness.available;
  const confidentialUnavailableReason = useMemo(
    () => draft.kind !== 'swap'
      ? t('intentOS.privacy.confidentialNonSwap')
      : t('intentOS.privacy.confidential.body'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.kind]
  );

  useEffect(() => {
    let active = true;
    getIntentCapabilities()
      .then((value) => { if (active) setNetworkStatus({ ok: true, ...value }); })
      .catch(() => { if (active) setNetworkStatus({ ok: false }); });
    getIntentPublicStatus()
      .then((value) => { if (active) setPublicStatus(value); })
      .catch(() => { if (active) setPublicStatus(null); });
    return () => { active = false; };
  }, []);

  /* Load the agent/strategy registry when its tab is opened. */
  const loadCatalog = useCallback((kind, { force = false, cursor = null } = {}) => {
    if (!kind || (!force && !cursor && catalogRequested.current[kind])) return;
    catalogRequested.current[kind] = true;
    setCatalogs((current) => ({
      ...current,
      /* Paging keeps what is already on screen and marks the tail as loading;
         only a fresh load clears the list. */
      [kind]: cursor
        ? { ...current[kind], state: 'live', loadingMore: true }
        : { state: 'loading', items: [], cursor: null, hasMore: false }
    }));
    fetchCatalog(kind, { cursor }).then((result) => {
      /* A failed fetch is reported as an error, never as an empty registry —
         "nobody has listed anything" and "we could not ask" are different
         claims and the user is told which one happened. */
      if (result.status === 'error') catalogRequested.current[kind] = false;
      setCatalogs((current) => {
        const previous = cursor && Array.isArray(current[kind]?.items) ? current[kind].items : [];
        /* A page that fails mid-scroll must not wipe the rows already read. */
        if (cursor && result.status === 'error') {
          return { ...current, [kind]: { ...current[kind], loadingMore: false, pageError: true } };
        }
        return {
          ...current,
          [kind]: {
            state: result.status,
            items: [...previous, ...result.items],
            cursor: result.cursor,
            hasMore: result.hasMore,
            loadingMore: false,
            pageError: false
          }
        };
      });
    });
  }, []);

  useEffect(() => { loadCatalog(TAB_CATALOG[tab]); }, [tab, loadCatalog]);

  const patchDraft = (patch) => {
    setDraft((current) => ({ ...current, ...patch }));
    setCompiled(null);
  };

  const chooseTemplate = (template) => {
    patchDraft({
      kind: template.kind,
      ...(template.kind === 'workflow' ? {
        steps: DEFAULT_WORKFLOW.map((step) => ({ ...step, chainId: draft.chainId }))
      } : {}),
      ...(template.kind === 'outcome' ? { minReceive: draft.minReceive || '0.25' } : {})
    });
  };

  const updateWorkflowStep = (index, patch) => {
    patchDraft({ steps: draft.steps.map((step, i) => i === index ? { ...step, ...patch } : step) });
  };

  const addWorkflowStep = () => {
    if (draft.steps.length >= 8) return;
    patchDraft({
      steps: [...draft.steps, defaultWorkflowStep(
        `step-${Date.now()}`,
        'send',
        draft.toSymbol,
        '',
        draft.chainId
      )]
    });
  };

  const removeWorkflowStep = (index) => {
    if (draft.steps.length <= 2) return;
    patchDraft({ steps: draft.steps.filter((_, i) => i !== index) });
  };

  const build = () => {
    const result = compileIntent({
      ...draft,
      deadlineAt: Date.now() + Number(draft.deadlineHours || 2) * 60 * 60 * 1000,
      requireExecutionProof: memory.requireExecutionProof,
      executionPolicy: {
        maxCapitalUsd: Number(executionPolicy.maxCapitalUsd),
        maxTransactionUsd: Number(executionPolicy.maxTransactionUsd),
        maxLossUsd: Number(executionPolicy.maxLossUsd),
        approvalMode: executionPolicy.approvalMode,
        // Explicitly false: this phase can prepare, but never autonomously execute.
        autonomousExecution: false,
        confirmationRequired: true
      }
    }, memory, Date.now(), { confidentialAvailable: confidentialSelectable });
    setCompiled(result);
    if (result.error) {
      setLifecycle(null);
      return;
    }
    const persisted = saveCompiledIntent(result);
    if (persisted.rows) setSaved(persisted.rows);

    /*
     * Start the lifecycle at compile time. A BLOCKED intent stays CREATED —
     * validation is something the compiler grants, not something the UI
     * assumes — and only a clean compile reaches VALIDATED.
     */
    let record = ensureLifecycle({
      intentId: result.intent.id,
      deadlineAt: result.intent.deadlineAt,
      origin: 'intent-os'
    });
    const validating = transition(record, 'VALIDATING', { reasonCode: 'COMPILED' });
    record = validating.ok ? validating.record : record;
    if (!result.blocked) {
      const validated = transition(record, 'VALIDATED', { reasonCode: 'RISK_CHECKS_PASSED' });
      record = validated.ok ? validated.record : record;
    } else {
      const failed = transition(record, 'FAILED', { reasonCode: 'RISK_CHECK_BLOCKED' });
      record = failed.ok ? failed.record : record;
    }
    setLifecycle(saveLifecycle(record));
  };

  const persistMemory = () => {
    const next = saveIntentMemory(memory);
    setMemory(next);
    setDraft((current) => ({
      ...current,
      chainId: next.preferredChainId,
      maxSlippagePct: Math.min(Number(current.maxSlippagePct) || next.maxSlippagePct, next.maxSlippagePct)
    }));
  };

  const checkProof = async (proof) => {
    const result = await verifyExecutionProof(proof);
    setVerified({ id: proof.id, ...result });
    setProofs(loadExecutionProofs());
  };

  const chooseTab = (name) => {
    setTab(name);
    const next = new URLSearchParams(searchParams);
    if (name === 'compose') next.delete('tab');
    else next.set('tab', name);
    setSearchParams(next, { replace: true });
  };

  const restoreSavedIntent = (intent) => {
    if (!intent) return;
    setDraft((current) => ({
      ...current,
      kind: intent.kind || current.kind,
      chainId: intent.chainId || current.chainId,
      fromSymbol: intent.fromSymbol || current.fromSymbol,
      toSymbol: intent.toSymbol || current.toSymbol,
      amountIn: intent.amountIn || current.amountIn,
      minReceive: intent.kind === 'outcome' ? (intent.outcome?.guaranteedMinimum || current.minReceive) : current.minReceive,
      deadlineHours: Math.max(1, Math.ceil(((intent.deadlineAt || Date.now()) - Date.now()) / 3600000)),
      maxSlippagePct: intent.maxSlippagePct || current.maxSlippagePct,
      solverId: intent.solverId || current.solverId,
      steps: Array.isArray(intent.steps) && intent.steps.length ? intent.steps : current.steps
    }));
    setCompiled(null);
    const record = expireIfDue(getLifecycle(intent.id));
    setLifecycle(record || null);
    chooseTab('compose');
  };

  const storeAutomationOrder = (intent) => {
    const tokenList = TOKENS[intent.chainId] || [];
    const fromToken = tokenList.find((tk) => tk.symbol === intent.fromSymbol);
    const toToken = tokenList.find((tk) => tk.symbol === intent.toSymbol);
    const target = Number(intent.condition?.value ?? intent.minReceive ?? 0);
    if (!fromToken || !toToken || !(Number(intent.amountIn) > 0) || !(target > 0)) {
      return { error: 'BAD_ORDER_DRAFT' };
    }
    const created = createOrder({
      type: 'limit',
      chainId: intent.chainId,
      fromToken,
      toToken,
      amountIn: intent.amountIn,
      targetRate: target,
      direction: intent.condition?.type === 'priceAbove' ? 'above' : 'below',
      priceOf: 'from'
    });
    if (created.error) return created;
    return addOrder({
      ...created.order,
      sourceIntentId: intent.id,
      source: 'intent-os'
    });
  };

  const handleCompiledAction = () => {
    if (!compiled || compiled.blocked || railBlocked) return;
    if (compiled.intent.kind === 'automation') {
      const res = storeAutomationOrder(compiled.intent);
      if (res.error) {
        setCompiled({ ...compiled, error: res.error, blocked: true });
        return;
      }
      navigate(compiled.handoff || '/orders');
      return;
    }
    if (compiled.handoff) navigate(compiled.handoff);
  };

  const crossChainVerification = useMemo(
    () => networkStatus?.crossChainVerification
      ?? networkStatus?.crossChain?.txVerification ?? null,
    [networkStatus]
  );

  const [loanHandoffDismissed, setLoanHandoffDismissed] = useState(false);

  /* ── Phases 141–150: the horizontal rail gates the compose surface. ─── */
  const [railState, setRailState] = useState(null);
  const railGate = useMemo(() => mayExecute(railState || undefined), [railState]);
  const railBlocked = railGate.allowed !== true;

  /* ── Phases 131–140: wallet & multichain verification. ────────────────── */
  const wallet = useWallet();
  const [checksumVerify, setChecksumVerify] = useState(null);
  useEffect(() => {
    let cancelled = false;
    import('ethers')
      .then(({ getAddress }) => {
        if (!cancelled) {
          setChecksumVerify(() => (a) => {
            try { getAddress(a); return true; } catch { return false; }
          });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const walletVerification = useMemo(() => {
    const providerKind = wallet.mode === 'injected' ? 'injected'
      : wallet.mode === 'wc' ? 'walletconnect'
        : wallet.mode === 'local' ? 'embedded' : 'none';
    const supportedChains = EVM_CHAIN_ORDER;
    const entry = wallet.address
      ? verifyWalletChain({
        address: wallet.address,
        chainId: wallet.chainId,
        chainName: EVM_CHAINS[wallet.chainId]?.name || null,
        providerKind,
        supportedChains,
        checksumVerify,
        rpcProbe: () => wallet.isConnected === true,
        balanceProbe: () => (wallet.nativeBalance !== undefined && wallet.nativeBalance !== null ? Number(wallet.nativeBalance) : null)
      })
      : null;
    return {
      connected: Boolean(wallet.address),
      entry,
      coverage: multichainCoverage({
        entries: entry && entry.verified ? [{ chainId: entry.chainId, verified: true }] : [],
        supportedChains
      }),
      posture: walletSecurityPosture({
        rawCredentialsToAgents: false,
        executionRequiresWalletConfirmation: true
      })
    };
  }, [wallet.address, wallet.chainId, wallet.mode, wallet.isConnected, wallet.nativeBalance, checksumVerify]);
  return (
    <PageTransition className="page ios-page">
      <motion.section className="ios-hero" variants={riseIn} initial="hidden" animate="show">
        <div className="ios-kicker"><span /> {t('intentOS.eyebrow')}</div>
        <h1>{t('intentOS.title')}</h1>
        <p>{t('intentOS.subtitle')}</p>
        <div className="ios-hero-badges">
          <span>◉ {t('intentOS.badge.nonCustodial')}</span>
          <span>⌁ {t('intentOS.badge.policyBound')}</span>
          <span>✓ {t('intentOS.badge.verifiable')}</span>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/intent-ai')}>
            {t('intentOS.aiAssistant')}
          </button>
          {/* Phase 152: Flash Liquidity lab — planner-only screen for
              collateral-free flash-loan arbitrage. Nothing here signs. */}
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/flash-liquidity')}>
            {t('intentOS.flashLiquidity', { defaultValue: 'Flash Liquidity' })}
          </button>
        </div>
      </motion.section>

      <LaunchStatusStrip t={t} publicStatus={publicStatus} />

      <StageRail t={t} />

      <IntentRail t={t} onStateChange={setRailState} />

      <div className="ios-tabs" role="tablist">
        {TABS.map((name) => (
          <button
            key={name}
            className={tab === name ? 'active' : ''}
            onClick={() => chooseTab(name)}
            role="tab"
            aria-selected={tab === name}
          >
            {tab === name && <SegIndicator id="intent-tab" className="ios-tab-glow" />}
            <span>{t(`intentOS.tab.${name}`)}</span>
            {name === 'proofs' && proofs.length > 0 && <em>{proofs.length}</em>}
          </button>
        ))}
      </div>

      {tab === 'compose' && (
        <motion.div className="ios-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {loanHandoff && !loanHandoffDismissed && (
            <section className="ios-loan-handoff" role="status" data-testid="loan-handoff">
              <div>
                <span className="ios-loan-handoff-icon" aria-hidden="true">⇄</span>
              </div>
              <div style={{ flex: 1 }}>
                <strong>
                  {loanHandoff.hint === 'loan-supply'
                    ? t('intentOS.loanHandoff.supplyTitle', { defaultValue: 'Lending draft arrived from the Loan page' })
                    : t('intentOS.loanHandoff.borrowTitle', { defaultValue: 'Borrowing draft arrived from the Loan page' })}
                </strong>
                <p>
                  {loanHandoff.hint === 'loan-supply'
                    ? t('intentOS.loanHandoff.supplyBody', {
                      amount: loanHandoff.amount || '—',
                      symbol: draft.fromSymbol,
                      chain: EVM_CHAINS[draft.chainId]?.name || draft.chainId,
                      defaultValue: '{{amount}} {{symbol}} on {{chain}} — steps ready: approve pool access, then deposit. Hit compile to review the signing path.'
                    })
                    : t('intentOS.loanHandoff.borrowBody', {
                      collateral: loanHandoff.collateral || '—',
                      amount: loanHandoff.amount || '—',
                      symbol: draft.fromSymbol,
                      chain: EVM_CHAINS[draft.chainId]?.name || draft.chainId,
                      defaultValue: 'Collateral {{collateral}} {{symbol}} + borrow {{amount}} {{symbol}} on {{chain}} — steps: deposit collateral, then borrow. Hit compile to review the signing path.'
                    })}
                </p>
                <small>{t('intentOS.loanHandoff.note', { defaultValue: 'Nothing executes on its own — the final signature is always your wallet’s.' })}</small>
              </div>
              <button
                type="button"
                className="ios-loan-handoff-close"
                aria-label={t('common.close', { defaultValue: 'Close' })}
                onClick={() => setLoanHandoffDismissed(true)}
              >
                ×
              </button>
            </section>
          )}
          {railBlocked && (
            <section className="ios-rail-blocked" role="alert">
              <strong>
                {railGate.reason === 'EMERGENCY_STOP'
                  ? t('intentOS.rail.composeBlockedStop', { defaultValue: 'Emergency stop is engaged — execution is blocked.' })
                  : t('intentOS.rail.composeBlockedPause', { defaultValue: 'The system is paused — execution is blocked.' })}
              </strong>
              <span>
                {railGate.reason === 'PAUSED' && railGate.resumesAt
                  ? t('intentOS.rail.composeResumes', { defaultValue: 'You can keep composing; sending resumes automatically at' }) + ` ${new Date(railGate.resumesAt).toLocaleTimeString()}`
                  : t('intentOS.rail.composeNote', { defaultValue: 'You can keep composing, but no intent can be sent until the rail is released.' })}
              </span>
            </section>
          )}
          <section>
            <div className="row-between ios-section-head">
              <div>
                <span className="ios-step-number">01</span>
                <strong>{t('intentOS.compose.choose')}</strong>
              </div>
              <small>{t('intentOS.compose.structured')}</small>
            </div>
            <div className="ios-template-grid">
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  className={draft.kind === template.kind ? 'active' : ''}
                  onClick={() => chooseTemplate(template)}
                >
                  <span className="ios-template-icon">{template.icon}</span>
                  <strong>{t(`intentOS.template.${template.id}.title`)}</strong>
                  <small>{t(`intentOS.template.${template.id}.body`)}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="ios-form-card">
            <div className="row-between ios-section-head">
              <div>
                <span className="ios-step-number">02</span>
                <strong>{t(`intentOS.template.${activeTemplate?.id || 'swap'}.title`)}</strong>
              </div>
              <span className="ios-live-dot">{t('intentOS.compose.localOnly')}</span>
            </div>

            <div className="ios-token-flow">
              <label>
                <span>{t('intentOS.field.pay')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={draft.amountIn}
                  onChange={(event) => patchDraft({ amountIn: event.target.value })}
                />
                <input
                  className="ios-symbol-input"
                  value={draft.fromSymbol}
                  onChange={(event) => patchDraft({ fromSymbol: event.target.value.toUpperCase() })}
                  aria-label={t('intentOS.field.fromToken')}
                />
              </label>
              <span className="ios-flow-arrow">→</span>
              <label>
                <span>{t('intentOS.field.receive')}</span>
                {draft.kind === 'outcome' ? (
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={draft.minReceive}
                    onChange={(event) => patchDraft({ minReceive: event.target.value })}
                  />
                ) : <div className="ios-auto-value">{t('intentOS.field.bestAvailable')}</div>}
                <input
                  className="ios-symbol-input"
                  value={draft.toSymbol}
                  onChange={(event) => patchDraft({ toSymbol: event.target.value.toUpperCase() })}
                  aria-label={t('intentOS.field.toToken')}
                />
              </label>
            </div>

            <div className="ios-grid-2">
              <label className="ios-field">
                <span>{t('intentOS.field.chain')}</span>
                <select value={draft.chainId} onChange={(event) => patchDraft({ chainId: Number(event.target.value) })}>
                  {EVM_CHAIN_ORDER.map((id) => (
                    <option key={id} value={id}>{EVM_CHAINS[id]?.name || id}</option>
                  ))}
                </select>
              </label>
              <label className="ios-field">
                <span>{t('intentOS.field.deadline')}</span>
                <select value={draft.deadlineHours} onChange={(event) => patchDraft({ deadlineHours: Number(event.target.value) })}>
                  {[1, 2, 6, 24, 72].map((hours) => (
                    <option key={hours} value={hours}>{t('intentOS.field.hours', { n: hours })}</option>
                  ))}
                </select>
              </label>
              <label className="ios-field">
                <span>{t('intentOS.field.usdValue')}</span>
                <input type="number" min="0" value={draft.amountUsd} onChange={(event) => patchDraft({ amountUsd: event.target.value })} />
                <small>{t('intentOS.field.usdValueHint')}</small>
              </label>
              <label className="ios-field">
                <span>{t('intentOS.field.slippage')}</span>
                <input type="number" min="0.05" max="50" step="0.05" value={draft.maxSlippagePct} onChange={(event) => patchDraft({ maxSlippagePct: event.target.value })} />
              </label>
            </div>

            <section className="ios-policy-card" aria-labelledby="intent-policy-title">
              <div className="row-between">
                <strong id="intent-policy-title">{t('intentOS.policy.title', { defaultValue: 'Execution policy' })}</strong>
                <span className="ios-status eligible">{t('intentOS.policy.level', { defaultValue: 'Pre-authorization' })}</span>
              </div>
              <p className="ios-honesty-note">{t('intentOS.policy.subtitle', { defaultValue: 'These limits define the maximum authority. Every sensitive operation still requires your confirmation and signature.' })}</p>
              <div className="ios-grid-3">
                <label className="ios-field"><span>{t('intentOS.policy.capital', { defaultValue: 'Capital ceiling (USD)' })}</span><input type="number" min="0" value={executionPolicy.maxCapitalUsd} onChange={(event) => setExecutionPolicy((p) => ({ ...p, maxCapitalUsd: event.target.value }))} /></label>
                <label className="ios-field"><span>{t('intentOS.policy.transaction', { defaultValue: 'Max transaction (USD)' })}</span><input type="number" min="0" value={executionPolicy.maxTransactionUsd} onChange={(event) => setExecutionPolicy((p) => ({ ...p, maxTransactionUsd: event.target.value }))} /></label>
                <label className="ios-field"><span>{t('intentOS.policy.loss', { defaultValue: 'Max loss (USD)' })}</span><input type="number" min="0" value={executionPolicy.maxLossUsd} onChange={(event) => setExecutionPolicy((p) => ({ ...p, maxLossUsd: event.target.value }))} /></label>
              </div>
              <label className="ios-field"><span>{t('intentOS.policy.approval', { defaultValue: 'Approval rule' })}</span><select value={executionPolicy.approvalMode} onChange={(event) => setExecutionPolicy((p) => ({ ...p, approvalMode: event.target.value }))}><option value="sensitive">{t('intentOS.policy.sensitive', { defaultValue: 'Confirm sensitive operations' })}</option><option value="every">{t('intentOS.policy.every', { defaultValue: 'Confirm every operation' })}</option></select></label>
            </section>

            {draft.kind === 'automation' && (
              <div className="ios-grid-2 ios-condition-grid">
                <label className="ios-field">
                  <span>{t('intentOS.field.condition')}</span>
                  <select value={draft.conditionType} onChange={(event) => patchDraft({ conditionType: event.target.value })}>
                    {['priceBelow', 'priceAbove', 'daily', 'weekly', 'monthly'].map((type) => (
                      <option key={type} value={type}>{t(`intentOS.condition.${type}`)}</option>
                    ))}
                  </select>
                </label>
                {(draft.conditionType === 'priceBelow' || draft.conditionType === 'priceAbove') ? (
                  <label className="ios-field">
                    <span>{t('intentOS.field.targetPrice', { symbol: draft.fromSymbol })}</span>
                    <input type="number" min="0" value={draft.conditionValue} onChange={(event) => patchDraft({ conditionValue: event.target.value })} />
                  </label>
                ) : (
                  <div className="ios-condition-note">{t('intentOS.field.scheduleSignature')}</div>
                )}
              </div>
            )}

            <div className="ios-privacy-choice">
              <span>{t('intentOS.field.privacy')}</span>
              <div>
                {['standard', 'relay', 'confidential'].map((mode) => {
                  const disabled = mode === 'confidential' && !confidentialSelectable;
                  return (
                    <button
                      key={mode}
                      className={draft.privacy === mode ? 'active' : ''}
                      disabled={disabled}
                      aria-disabled={disabled}
                      title={disabled ? confidentialUnavailableReason : undefined}
                      onClick={() => { if (!disabled) patchDraft({ privacy: mode }); }}
                    >
                      {t(`intentOS.privacy.${mode}.title`)}
                    </button>
                  );
                })}
              </div>
              <p>{t(`intentOS.privacy.${draft.privacy}.body`)}</p>
              {!confidentialSelectable && draft.privacy !== 'confidential' && (
                <p className="ios-privacy-unavailable" role="status">
                  {confidentialUnavailableReason}
                </p>
              )}
            </div>

            {draft.kind === 'workflow' && (
              <div className="ios-workflow">
                {!isSingleChainWorkflowSteps(draft.steps, draft.chainId) && (
                  <p className="ios-workflow-banner">{t('intentOS.compose.crossChainBanner')}</p>
                )}
                {draft.steps.map((step, index) => (
                  <div className="ios-workflow-step" key={step.id}>
                    <span>{index + 1}</span>
                    <select
                      value={step.action}
                      onChange={(event) => updateWorkflowStep(index, { action: event.target.value })}
                      aria-label={t('intentOS.field.workflowAction', { n: index + 1 })}
                    >
                      {WORKFLOW_ACTIONS.map((action) => (
                        <option key={action} value={action}>{t(`intentOS.action.${action}`)}</option>
                      ))}
                    </select>
                    <select
                      value={step.chainId || draft.chainId}
                      onChange={(event) => updateWorkflowStep(index, { chainId: Number(event.target.value) })}
                      aria-label={t('intentOS.field.workflowChain')}
                    >
                      {EVM_CHAIN_ORDER.map((id) => (
                        <option key={id} value={id}>{EVM_CHAINS[id]?.name || id}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeWorkflowStep(index)}
                      disabled={draft.steps.length <= 2}
                      aria-label={t('intentOS.field.removeStep')}
                    >×</button>
                    <div className="ios-workflow-meta">
                      <input
                        value={step.asset || ''}
                        onChange={(event) => updateWorkflowStep(index, { asset: event.target.value.toUpperCase() })}
                        placeholder={t('intentOS.field.workflowAsset')}
                        aria-label={t('intentOS.field.workflowAsset')}
                      />
                      <input
                        value={step.minOutput || ''}
                        onChange={(event) => updateWorkflowStep(index, { minOutput: event.target.value })}
                        placeholder={t('intentOS.field.workflowMinOut')}
                        aria-label={t('intentOS.field.workflowMinOut')}
                      />
                      <input
                        value={step.maxInput || ''}
                        onChange={(event) => updateWorkflowStep(index, { maxInput: event.target.value })}
                        placeholder={t('intentOS.field.workflowMaxIn')}
                        aria-label={t('intentOS.field.workflowMaxIn')}
                      />
                      <select
                        value={step.revertPolicy || 'abort-all'}
                        onChange={(event) => updateWorkflowStep(index, { revertPolicy: event.target.value })}
                        aria-label={t('intentOS.field.workflowRevert')}
                      >
                        {WORKFLOW_REVERT_POLICIES.map((policy) => (
                          <option key={policy} value={policy}>{t(`intentOS.revert.${policy}`)}</option>
                        ))}
                      </select>
                      <input
                        className="ios-workflow-target"
                        value={step.target}
                        onChange={(event) => updateWorkflowStep(index, { target: event.target.value })}
                        placeholder={t('intentOS.field.workflowTarget')}
                      />
                    </div>
                  </div>
                ))}
                <button type="button" className="ios-add-step" onClick={addWorkflowStep} disabled={draft.steps.length >= 8}>
                  + {t('intentOS.field.addStep')}
                </button>
              </div>
            )}

            <label className="ios-field">
              <span>{t('intentOS.field.note')}</span>
              <textarea
                value={draft.note}
                onChange={(event) => patchDraft({ note: event.target.value })}
                placeholder={t('intentOS.field.notePlaceholder')}
                rows={3}
              />
              <small>{t('intentOS.field.noteSafety')}</small>
            </label>

            <button className="btn btn-primary ios-compile" onClick={build}>
              {t('intentOS.compose.compile')}
              <span>→</span>
            </button>
          </section>

          {compiled && (
            <section className="ios-result">
              <div className="row-between ios-section-head">
                <div>
                  <span className="ios-step-number">03</span>
                  <strong>{t('intentOS.result.title')}</strong>
                </div>
                {!compiled.error && (
                  <span className={`ios-status ${compiled.blocked ? 'unavailable' : 'eligible'}`}>
                    {t(`intentOS.result.${compiled.status}`)}
                  </span>
                )}
              </div>

              {compiled.error ? (
                <p className="notice notice-danger">{t(`intentOS.error.${compiled.error}`)}</p>
              ) : (
                <>
                  {compiled.intent.kind === 'workflow' && (
                    <div className="ios-result-steps" data-testid="compiled-steps">
                      {compiled.intent.steps.map((step, index) => (
                        <div className="ios-result-step" key={`${step.id}-${index}`}>
                          <span aria-hidden="true">{index + 1}</span>
                          <strong>{t(`intentOS.action.${step.action}`)}</strong>
                          <span className="mono ios-result-step-asset">{step.asset || '—'}</span>
                          <small>{EVM_CHAINS[step.chainId]?.short || EVM_CHAINS[step.chainId]?.name || `#${step.chainId}`}</small>
                          {(step.maxInput || step.minOutput) && (
                            <small className="ios-catalog-muted">
                              {step.maxInput ? `${t('intentOS.field.workflowMaxIn')} ${step.maxInput}` : ''}
                              {step.maxInput && step.minOutput ? ' · ' : ''}
                              {step.minOutput ? `${t('intentOS.field.workflowMinOut')} ${step.minOutput}` : ''}
                            </small>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="ios-check-list">
                    {compiled.checks.map((row, index) => <CheckRow key={`${row.id}-${index}`} row={row} t={t} />)}
                  </div>

                  {lifecycle && <IntentTimeline record={lifecycle} />}

                  <h3>{t('intentOS.result.solverCandidates')}</h3>
                  <div className="ios-solver-list">
                    {compiled.solvers.map((solver) => <SolverRow key={solver.id} solver={solver} t={t} />)}
                  </div>

                  {compiled.handoff ? (
                    <div>
                      <button
                        className="btn btn-primary ios-compile"
                        onClick={handleCompiledAction}
                        disabled={railBlocked}
                      >
                        {railBlocked
                          ? t('intentOS.rail.blocked', { defaultValue: 'Rail paused/stopped — release to send' })
                          : compiled.intent.kind === 'automation'
                            ? t('intentOS.result.createWatchedOrder')
                            : t('intentOS.result.reviewHandoff')} <span>→</span>
                      </button>
                      <p className="ios-honesty-note">
                        {compiled.intent.kind === 'automation'
                          ? t('intentOS.result.automationHandoffNote')
                          : t('intentOS.result.handoffResumeNote')}
                      </p>
                    </div>
                  ) : (
                    <div className="ios-honesty-note">
                      {compiled.intent.kind === 'workflow'
                        ? (
                          <>
                            <p>{isSingleChainWorkflowSteps(compiled.intent.steps, compiled.intent.chainId)
                              ? t('intentOS.result.workflowReadyNote')
                              : t('intentOS.result.workflowCrossChainNote')}</p>
                            <div className="ios-step-actions">
                              {compiled.intent.steps.map((step) => (
                                <button
                                  key={step.id}
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => {
                                    const params = new URLSearchParams({
                                      from: compiled.intent.fromSymbol,
                                      to: compiled.intent.toSymbol,
                                      amount: compiled.intent.amountIn,
                                      chain: String(step.chainId || compiled.intent.chainId),
                                      intent: compiled.intent.id,
                                      step: step.id
                                    });
                                    navigate(step.action === 'swap' ? `/swap?${params.toString()}` : `/${step.action === 'bridge' ? 'bridge' : 'intent'}?tab=compose`);
                                  }}
                                >
                                  {t(`intentOS.action.${step.action}`, { defaultValue: step.action })}
                                </button>
                              ))}
                            </div>
                          </>
                        )
                        : <p>{t('intentOS.result.draftOnly')}</p>}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {savedDrafts.length > 0 && (
            <section className="ios-saved">
              <div className="row-between ios-section-head">
                <strong>{t('intentOS.saved.title')}</strong>
                <small>{t('intentOS.saved.local')}</small>
              </div>
              {savedDrafts.map((row) => (
                <div key={row.intent.id}>
                  <span>
                    <strong>{row.intent.fromSymbol} → {row.intent.toSymbol}</strong>
                    <small>
                      {t(`intentOS.template.${row.intent.kind}.title`, { defaultValue: row.intent.kind })}
                      {' · '}
                      {t(`exec.status.${(expireIfDue(getLifecycle(row.intent.id)) || {}).status || 'CREATED'}`)}
                    </small>
                  </span>
                  <span className="ios-saved-actions">
                    <button type="button" onClick={() => restoreSavedIntent(row.intent)}>{t('intentOS.saved.restore')}</button>
                    <button type="button" onClick={() => setSaved(removeIntent(row.intent.id))} aria-label={t('intentOS.saved.remove')}>×</button>
                  </span>
                </div>
              ))}
            </section>
          )}
        </motion.div>
      )}

      {tab === 'plan' && (
        <motion.div className="ios-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <ProfitPlanner />
        </motion.div>
      )}

      {tab === 'crosschain' && (
        <motion.div className="ios-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <IntentCrossChainPanel networkStatus={networkStatus} />
        </motion.div>
      )}

      {tab === 'memory' && (
        <motion.div className="ios-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <section className="ios-memory-hero">
            <span className="ios-memory-orbit">◌</span>
            <div>
              <h2>{t('intentOS.memory.title')}</h2>
              <p>{t('intentOS.memory.subtitle')}</p>
            </div>
          </section>

          <section className="ios-form-card">
            <div className="ios-grid-2">
              <label className="ios-field">
                <span>{t('intentOS.memory.preferredChain')}</span>
                <select value={memory.preferredChainId} onChange={(event) => setMemory({ ...memory, preferredChainId: Number(event.target.value) })}>
                  {EVM_CHAIN_ORDER.map((id) => <option key={id} value={id}>{EVM_CHAINS[id]?.name || id}</option>)}
                </select>
              </label>
              <label className="ios-field">
                <span>{t('intentOS.memory.maxSlippage')}</span>
                <input type="number" step="0.05" value={memory.maxSlippagePct} onChange={(event) => setMemory({ ...memory, maxSlippagePct: event.target.value })} />
              </label>
              <label className="ios-field">
                <span>{t('intentOS.memory.privateAbove')}</span>
                <input type="number" value={memory.privateAboveUsd} onChange={(event) => setMemory({ ...memory, privateAboveUsd: event.target.value })} />
              </label>
              <label className="ios-field">
                <span>{t('intentOS.memory.maxSpend')}</span>
                <input type="number" value={memory.maxPerIntentUsd} onChange={(event) => setMemory({ ...memory, maxPerIntentUsd: event.target.value })} />
              </label>
            </div>

            <div className="ios-memory-toggle">
              <span><strong>{t('intentOS.memory.quietHours')}</strong><small>{t('intentOS.memory.quietBody')}</small></span>
              <Switch on={memory.quietHoursEnabled} label={t('intentOS.memory.quietHours')} onChange={() => setMemory({ ...memory, quietHoursEnabled: !memory.quietHoursEnabled })} />
            </div>
            {memory.quietHoursEnabled && (
              <div className="ios-grid-2">
                <label className="ios-field"><span>{t('intentOS.memory.from')}</span><input type="number" min="0" max="23" value={memory.quietStart} onChange={(event) => setMemory({ ...memory, quietStart: event.target.value })} /></label>
                <label className="ios-field"><span>{t('intentOS.memory.to')}</span><input type="number" min="0" max="23" value={memory.quietEnd} onChange={(event) => setMemory({ ...memory, quietEnd: event.target.value })} /></label>
              </div>
            )}
            <div className="ios-memory-toggle">
              <span><strong>{t('intentOS.memory.requireProof')}</strong><small>{t('intentOS.memory.requireProofBody')}</small></span>
              <Switch on={memory.requireExecutionProof} label={t('intentOS.memory.requireProof')} onChange={() => setMemory({ ...memory, requireExecutionProof: !memory.requireExecutionProof })} />
            </div>

            <button className="btn btn-primary ios-compile" onClick={persistMemory}>{t('intentOS.memory.save')}</button>
          </section>

          <p className="ios-honesty-note">{t('intentOS.memory.localNotice')}</p>
        </motion.div>
      )}

      {tab === 'proofs' && (
        <motion.div className="ios-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <section className="ios-proof-intro">
            <span>◇</span>
            <div><h2>{t('intentOS.proof.title')}</h2><p>{t('intentOS.proof.subtitle')}</p></div>
          </section>
          {verified && (
            <p className={`notice ${verified.ok ? 'notice-success' : 'notice-danger'}`}>
              {t(`intentOS.proof.${verified.code}`)} · <span className="mono">{verified.id}</span>
            </p>
          )}
          {proofs.length ? (
            <div className="ios-proof-grid">
              {proofs.map((proof) => <ProofRow key={proof.id} proof={proof} t={t} onVerify={checkProof} />)}
            </div>
          ) : (
            <section className="ios-empty-proof">
              <span>◇</span>
              <h3>{t('intentOS.proof.empty')}</h3>
              <p>{t('intentOS.proof.emptyBody')}</p>
              <button className="btn btn-primary" onClick={() => navigate('/swap')}>{t('intentOS.proof.openSwap')}</button>
            </section>
          )}
          <p className="ios-honesty-note">{t('intentOS.proof.limit')}</p>
        </motion.div>
      )}

      {tab === 'history' && (
        <motion.div className="ios-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {/* The same local record the Intent AI panel appends to; read-only
              view plus a user-controlled wipe. */}
          <IntentTxHistory />
        </motion.div>
      )}

      {tab === 'agents' && (
        <motion.div className="ios-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <section className="ios-network-hero"><div><span className="ios-eyebrow">{t('intentOS.agents.eyebrow')}</span><h2>{t('intentOS.agents.title')}</h2><p>{t('intentOS.agents.body')}</p></div></section>
          <CatalogSection
            ns="agents"
            catalog={catalogs.agent}
            lang={i18n.language}
            t={t}
            onRetry={() => loadCatalog('agent', { force: true })}
            onLoadMore={(cursor) => loadCatalog('agent', { cursor })}
          />
        </motion.div>
      )}

      {tab === 'strategies' && (
        <motion.div className="ios-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <section className="ios-network-hero"><div><span className="ios-eyebrow">{t('intentOS.strategies.eyebrow')}</span><h2>{t('intentOS.strategies.title')}</h2><p>{t('intentOS.strategies.body')}</p></div></section>
          <CatalogSection
            ns="strategies"
            catalog={catalogs.strategy}
            lang={i18n.language}
            t={t}
            onRetry={() => loadCatalog('strategy', { force: true })}
            onLoadMore={(cursor) => loadCatalog('strategy', { cursor })}
          />
        </motion.div>
      )}

      {tab === 'network' && (
        <motion.div className="ios-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <section className="ios-network-hero">
            <div className="ios-network-glyph"><span>FBT</span><i /><i /><i /></div>
            <div><h2>{t('intentOS.network.title')}</h2><p>{t('intentOS.network.subtitle')}</p></div>
          </section>

          <section className="ios-auction-status" data-testid="intent-os-wallet-verification">
            <div className="row-between">
              <div>
                <span className="ios-eyebrow">{t('intentOS.network.walletVerification', { defaultValue: 'Wallet & multichain verification' })}</span>
                <strong>
                  {!walletVerification.connected
                    ? t('intentOS.network.walletNotConnected', { defaultValue: 'No wallet connected — verification waits for a real wallet.' })
                    : walletVerification.entry?.verified
                      ? t('intentOS.network.walletVerified', { defaultValue: 'Wallet verified on the current chain' })
                      : t('intentOS.network.walletUnverified', { defaultValue: 'Wallet connected — some checks failed' })}
                </strong>
              </div>
              <span className={`ios-status ${walletVerification.entry?.verified ? 'eligible' : 'unavailable'}`}>
                {walletVerification.entry?.verified
                  ? t('intentOS.network.verified', { defaultValue: 'verified' })
                  : t('intentOS.network.unverified', { defaultValue: 'unverified' })}
              </span>
            </div>
            <div className="ios-network-metrics">
              <span><b>{walletVerification.connected ? wallet.address.slice(0, 10) + '…' : '—'}</b>{t('intentOS.network.walletAddress', { defaultValue: 'address' })}</span>
              <span><b>{walletVerification.entry?.chainId ?? '—'}</b>{t('intentOS.network.walletChain', { defaultValue: 'chain' })}</span>
              <span><b>{walletVerification.coverage.coverage === null ? '—' : `${walletVerification.coverage.coverage}%`}</b>{t('intentOS.network.walletCoverage', { defaultValue: 'multichain coverage' })}</span>
              <span><b>{walletVerification.posture.ok ? t('intentOS.network.verified') : t('intentOS.network.unverified')}</b>{t('intentOS.network.walletBoundary', { defaultValue: 'AI credential boundary' })}</span>
            </div>
            {walletVerification.entry && walletVerification.entry.failed.length > 0 && (
              <div className="ios-rail-statusline">
                {walletVerification.entry.failed.map((id) => t(`intentOS.network.check.${id}`, { defaultValue: id })).join(' · ')}
              </div>
            )}
            <p>{t('intentOS.network.walletVerifyNote', { defaultValue: 'Verification is per-chain and fail-closed: address format, chain membership, provider, RPC answer and balance must all check out. Raw credentials never reach any AI agent.' })}</p>
          </section>

          <section className={`ios-network-status ${networkStatus?.ok ? 'is-online' : ''}`}>
            <div className="row-between">
              <div>
                <span className="ios-eyebrow">{t('intentOS.network.protocol')}</span>
                <strong>{networkStatus === null
                  ? t('intentOS.network.checking')
                  : networkStatus.ok
                    ? t('intentOS.network.reachable')
                    : t('intentOS.network.unreachable')}</strong>
              </div>
              <span className={`ios-status ${networkStatus?.transparency?.acceptingCommitments ? 'eligible' : 'unavailable'}`}>
                {networkStatus?.transparency?.acceptingCommitments ? t('intentOS.network.accepting') : t('intentOS.network.readOnly')}
              </span>
            </div>
            <div className="ios-network-metrics">
              <span><b>{networkStatus?.transparency?.registeredSolvers ?? '—'}</b>{t('intentOS.network.registered')}</span>
              <span><b>Ed25519</b>{t('intentOS.network.signing')}</span>
              <span><b>{networkStatus?.ok ? (networkStatus.transparency?.durable ? t('intentOS.network.durable') : t('intentOS.network.memory')) : '—'}</b>{t('intentOS.network.storage')}</span>
              <span><b>{networkStatus?.ok ? (networkStatus.transparency?.externallyAnchored ? t('intentOS.network.anchored') : t('intentOS.network.unanchored')) : '—'}</b>{t('intentOS.network.root')}</span>
            </div>
            <p>{t('intentOS.network.commitmentNote')}</p>
          </section>

          <section className="ios-auction-status">
            <div className="row-between">
              <div>
                <span className="ios-eyebrow">{t('intentOS.network.auctionProtocol')}</span>
                <strong>{networkStatus?.auctions?.closeConfigured
                  ? t('intentOS.network.closeReady')
                  : t('intentOS.network.closeUnavailable')}</strong>
              </div>
              <span className={`ios-status ${networkStatus?.auctions?.externalAnchorVerificationConfigured ? 'eligible' : 'unavailable'}`}>
                {networkStatus?.auctions?.externalAnchorVerificationConfigured
                  ? t('intentOS.network.anchorReady')
                  : t('intentOS.network.anchorUnavailable')}
              </span>
            </div>
            <div className="ios-network-metrics">
              <span><b>{networkStatus?.auctions?.coordinator?.id || '—'}</b>{t('intentOS.network.coordinator')}</span>
              <span><b>{networkStatus?.auctions?.configuredAnchorNetworks ?? 0}</b>{t('intentOS.network.anchorNetworks')}</span>
              <span><b>{networkStatus?.auctions?.signedCloseReceipts ? t('intentOS.network.signed') : '—'}</b>{t('intentOS.network.closeReceipt')}</span>
              <span><b>{networkStatus?.auctions?.signedAdmissionReceipts ? t('intentOS.network.signed') : networkStatus?.ok ? t('intentOS.network.unconfigured') : '—'}</b>{t('intentOS.network.admissionReceipts')}</span>
              <span><b>{networkStatus?.watchers ? networkStatus.watchers.registeredWatchers : '—'}</b>{t('intentOS.network.watchers')}</span>
              <span><b>{networkStatus?.auctions?.auctionCompletenessProof ? t('intentOS.network.proven') : t('intentOS.network.evidenceBased')}</b>{t('intentOS.network.completeness')}</span>
            </div>
            {networkStatus?.auctions?.externalAnchorVerificationConfigured === false && (
              <p className="ios-rail-statusline">
                {t('intentOS.network.anchorHint', { defaultValue: 'Signed closing already works with the coordinator key — the on-chain anchor is an optional external timestamp. To enable it set INTENT_ANCHOR_NETWORKS (chain RPC + contract).' })}
              </p>
            )}
            <p>{t('intentOS.network.auctionNote')}</p>
          </section>

          <section className="ios-auction-status">
            <div className="row-between">
              <div>
                <span className="ios-eyebrow">{t('intentOS.network.bondProtocol')}</span>
                <strong>{networkStatus?.bonds?.configured
                  ? t('intentOS.network.bondsReady')
                  : t('intentOS.network.bondsUnavailable')}</strong>
              </div>
              <span className={`ios-status ${networkStatus?.bonds?.bondedSolvers > 0 ? 'eligible' : 'unavailable'}`}>
                {networkStatus?.bonds?.bondedSolvers > 0
                  ? t('intentOS.network.bondedNetwork')
                  : t('intentOS.network.unbondedNetwork')}
              </span>
            </div>
            <div className="ios-network-metrics">
              <span><b>{networkStatus?.bonds?.configured ? networkStatus.bonds.bondedSolvers : '—'}</b>{t('intentOS.network.bonds')}</span>
              <span><b>{networkStatus?.bonds?.configured ? networkStatus.bonds.minBondUsd : '—'}</b>{t('intentOS.network.minBond')}</span>
              <span><b>{networkStatus?.execution?.registeredVerifiers ?? '—'}</b>{t('intentOS.network.verifiers')}</span>
              <span><b>{networkStatus?.bonds?.onChainEscrow === false ? t('intentOS.network.noCustody') : '—'}</b>{t('intentOS.network.bondCustody')}</span>
            </div>
            <p>{t('intentOS.network.bondNote')}</p>
          </section>

          <section className="ios-auction-status">
            <div className="row-between">
              <div>
                <span className="ios-eyebrow">{t('intentOS.network.settlementProtocol')}</span>
                <strong>{networkStatus?.settlement?.offlineVerifier
                  ? t('intentOS.network.settlementReady')
                  : t('intentOS.network.settlementUnavailable')}</strong>
              </div>
              <span className={`ios-status ${networkStatus?.settlement?.onChainTxVerification === false ? 'eligible' : 'unavailable'}`}>
                {t('intentOS.network.evidenceBased')}
              </span>
            </div>
            <div className="ios-network-metrics">
              <span><b>{networkStatus?.settlement?.reportSchema ?? '—'}</b>{t('intentOS.network.settlementSchema')}</span>
              <span><b>{networkStatus?.settlement?.serverRecomputesBeforeStorage ? t('intentOS.network.signed') : '—'}</b>{t('intentOS.network.serverRecompute')}</span>
              <span><b>{networkStatus?.settlement?.adjudicationCrossCheck ? t('intentOS.network.signed') : '—'}</b>{t('intentOS.network.adjudicationCheck')}</span>
              <span><b>{networkStatus?.settlement?.custody === false ? t('intentOS.network.noCustody') : '—'}</b>{t('intentOS.network.bondCustody')}</span>
            </div>
            <p>{t('intentOS.network.settlementNote')}</p>
          </section>

          <section className="ios-auction-status">
            <div className="row-between">
              <div>
                <span className="ios-eyebrow">{t('intentOS.network.workflowProtocol')}</span>
                <strong>{networkStatus?.workflows?.singleChainAtomic
                  ? t('intentOS.network.workflowReady')
                  : t('intentOS.network.workflowUnavailable')}</strong>
              </div>
              <span className={`ios-status ${networkStatus?.workflows?.crossChainAtomic ? 'eligible' : 'unavailable'}`}>
                {networkStatus?.workflows?.crossChainAtomic
                  ? t('intentOS.network.crossChainAtomic')
                  : t('intentOS.network.singleChain')}
              </span>
            </div>
            <div className="ios-network-metrics">
              <span><b>{networkStatus?.workflows?.schema ?? '—'}</b>{t('intentOS.network.settlementSchema')}</span>
              <span><b>{networkStatus?.workflows?.maxNodes ?? '—'}</b>{t('intentOS.network.maxNodes')}</span>
              <span><b>{networkStatus?.workflows?.crossChainEnvelopeStatus ?? 'draft-only'}</b>{t('intentOS.network.crossChainEnvelope')}</span>
              <span><b>{networkStatus?.workflows?.contract?.configured
                ? (networkStatus.workflows.contract.address || t('intentOS.network.signed'))
                : t('intentOS.network.unconfigured')}</b>{t('intentOS.network.workflowContract')}</span>
              <span><b>{networkStatus?.workflows?.custody === false ? t('intentOS.network.noCustody') : '—'}</b>{t('intentOS.network.bondCustody')}</span>
            </div>
            <p>{t('intentOS.network.workflowNote')}</p>
          </section>

          <section className="ios-auction-status">
            <div className="row-between">
              <div>
                <span className="ios-eyebrow">{t('intentOS.network.crossChainProtocol')}</span>
                <strong>{networkStatus?.crossChain?.available
                  ? t('intentOS.network.crossChainReady')
                  : t('intentOS.network.crossChainUnavailable')}</strong>
              </div>
              <span className="ios-status unavailable">
                {t('intentOS.network.nonAtomic')}
              </span>
            </div>
            <div className="ios-network-metrics">
              <span><b>{networkStatus?.crossChain?.schema ?? '—'}</b>{t('intentOS.network.settlementSchema')}</span>
              <span><b>{networkStatus?.crossChain?.receiptSchema ?? '—'}</b>{t('intentOS.network.receiptSchema')}</span>
              <span><b>{networkStatus?.crossChain?.sequentialUserSignatures ? t('intentOS.network.sequentialNonAtomic') : '—'}</b>{t('intentOS.network.sequentialSignatures')}</span>
              <span><b>{networkStatus?.crossChain?.envelopeStatus ?? networkStatus?.workflows?.crossChainEnvelopeStatus ?? '—'}</b>{t('intentOS.network.crossChainEnvelope')}</span>
              <span><b>{networkStatus?.crossChain?.custody === false ? t('intentOS.network.noCustody') : '—'}</b>{t('intentOS.network.bondCustody')}</span>
            </div>
            <p>{t('intentOS.network.crossChainNote')}</p>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 9 }}
              onClick={() => chooseTab('crosschain')}
            >
              {t('intentOS.network.openDesk', { defaultValue: 'Open the cross-chain desk — plan, sign, settle' })} →
            </button>
          </section>

          <section className="ios-auction-status">
            <div className="row-between">
              <div>
                <span className="ios-eyebrow">{t('intentOS.network.atomicSwapProtocol')}</span>
                <strong>{networkStatus?.atomicSwap?.crossChainAtomic
                  ? t('intentOS.network.atomicSwapReady')
                  : t('intentOS.network.atomicSwapUnavailable')}</strong>
              </div>
              <span className={`ios-status ${networkStatus?.atomicSwap?.crossChainAtomic ? 'eligible' : 'unavailable'}`}>
                {networkStatus?.atomicSwap?.crossChainAtomic
                  ? t('intentOS.network.atomic')
                  : t('intentOS.network.nonAtomic')}
              </span>
            </div>
            <div className="ios-network-metrics">
              <span><b>{networkStatus?.atomicSwap?.mechanism ?? '—'}</b>{t('intentOS.network.atomicSwapMechanism')}</span>
              <span><b>{networkStatus?.atomicSwap?.configuredChainCount ?? 0}</b>{t('intentOS.network.atomicSwapChains')}</span>
              <span><b>{networkStatus?.atomicSwap?.minTimelockMarginSeconds ?? '—'}</b>{t('intentOS.network.atomicSwapMargin')}</span>
              <span><b>{networkStatus?.atomicSwap?.escrowDuringSwap ? t('intentOS.network.onChainEscrow') : '—'}</b>{t('intentOS.network.bondCustody')}</span>
            </div>
            <p>{t('intentOS.network.atomicSwapNote')}</p>
          </section>

          <section className="ios-auction-status">
            <div className="row-between">
              <div>
                <span className="ios-eyebrow">{t('intentOS.network.txVerification')}</span>
                <strong>{crossChainVerification?.configured
                  ? networkStatus?.atomicSwap?.crossChainAtomic
                    ? t('intentOS.network.txVerificationConfiguredAtomic')
                    : t('intentOS.network.txVerificationConfigured')
                  : t('intentOS.network.txVerificationUnconfigured')}</strong>
              </div>
              <span className={`ios-status ${(networkStatus?.atomicSwap?.crossChainAtomic || crossChainVerification?.configured) ? 'eligible' : 'unavailable'}`}>
                {networkStatus?.atomicSwap?.crossChainAtomic
                  ? t('intentOS.network.atomicViaHtlc')
                  : crossChainVerification?.configured
                    ? t('intentOS.network.txVerificationOnly')
                    : t('intentOS.network.txVerificationOff')}
              </span>
            </div>
            <div className="ios-network-metrics">
              <span><b>{crossChainVerification?.verificationSchema ?? crossChainVerification?.schema ?? '—'}</b>{t('intentOS.network.txVerificationSchema')}</span>
              <span><b>{crossChainVerification?.bindingSchema ?? crossChainVerification?.accountBindingSchema ?? '—'}</b>{t('intentOS.network.txVerificationBindings')}</span>
              <span><b>{crossChainVerification?.walletProof ?? '—'}</b>{t('intentOS.network.txVerificationWalletProof')}</span>
              <span><b>{crossChainVerification?.configuredChains ?? crossChainVerification?.chains?.length ?? '—'}</b>{t('intentOS.network.txVerificationChains')}</span>
              <span><b>{crossChainVerification?.chains?.reduce((s, c) => s + (c.providers || 0), 0) ?? '—'}</b>{t('intentOS.network.txVerificationProviders')}</span>
              <span><b>{crossChainVerification?.minimumQuorum ?? crossChainVerification?.quorumRequired ?? '—'}</b>{t('intentOS.network.txVerificationQuorum')}</span>
              <span><b>{crossChainVerification?.providerIndependenceProven === true ? t('intentOS.network.proven') : t('intentOS.network.independenceNotProven')}</b>{t('intentOS.network.txVerificationProviderIndependence')}</span>
              <span><b>{networkStatus?.crossChain?.custody === false ? t('intentOS.network.noCustody') : '—'}</b>{t('intentOS.network.bondCustody')}</span>
            </div>
            <p>{t('intentOS.network.txVerificationNote')}</p>
          </section>

          <section className="ios-auction-status">
            <div className="row-between">
              <div>
                <span className="ios-eyebrow">{t('intentOS.network.verificationProtocol')}</span>
                <strong>{networkStatus?.independentVerification?.configured
                  ? t('intentOS.network.verificationReady')
                  : t('intentOS.network.verificationUnavailable')}</strong>
              </div>
              <span className="ios-status unavailable">
                {t('intentOS.network.independenceNotProven')}
              </span>
            </div>
            <div className="ios-network-metrics">
              <span><b>{networkStatus?.independentVerification?.registeredObserverKeys ?? '—'}</b>{t('intentOS.network.registeredObserverKeys')}</span>
              <span><b>{networkStatus?.independentVerification?.signedOperatorBindings ?? '—'}</b>{t('intentOS.network.attestedKeys')}</span>
              <span><b>{networkStatus?.independentVerification?.distinctAttestedOperators ?? '—'}</b>{t('intentOS.network.distinctOperators')}</span>
              <span><b>{networkStatus?.auctions?.coordinatorRotationConfigured ? t('intentOS.network.signed') : t('intentOS.network.unconfigured')}</b>{t('intentOS.network.coordinatorRotation')}</span>
              <span><b>{networkStatus?.merkleRootAnchors?.configured ? t('intentOS.network.anchorReady') : t('intentOS.network.unconfigured')}</b>{t('intentOS.network.rootAnchor')}</span>
              <span><b>{networkStatus?.independentVerification?.organizationalIndependenceProven ? t('intentOS.network.proven') : t('intentOS.network.unproven')}</b>{t('intentOS.network.operatorIndependence')}</span>
            </div>
            <p>{t('intentOS.network.verificationNote')}</p>
          </section>

          <section className="ios-network-api">
            <div><span>GET</span><code>/api/intents/v1/capabilities</code></div>
            <div><span>GET</span><code>/api/intents/v1/solvers</code></div>
            <div><span>POST</span><code>/api/intents/v1/commitments</code></div>
            <div><span>GET</span><code>/api/intents/v1/log/:intentHash</code></div>
            <div><span>GET</span><code>/api/intents/v1/auctions/:intentHash</code></div>
            <div><span>POST</span><code>/api/intents/v1/auctions/:intentHash/close</code></div>
            <div><span>POST</span><code>/api/intents/v1/auctions/:intentHash/anchor</code></div>
            <div><span>GET</span><code>/api/intents/v1/admissions/:intentHash/:entryHash</code></div>
            <div><span>POST</span><code>/api/intents/v1/auctions/:intentHash/watcher-reports</code></div>
            <div><span>GET</span><code>/api/intents/v1/bonds</code></div>
            <div><span>POST</span><code>/api/intents/v1/cross-chain/states</code></div>
            <div><span>POST</span><code>/api/intents/v1/cross-chain/states/:stateId/receipts</code></div>
            <div><span>POST</span><code>/api/intents/v1/cross-chain/states/:stateId/account-binding-challenge</code></div>
            <div><span>POST</span><code>/api/intents/v1/cross-chain/states/:stateId/account-bindings</code></div>
            <div><span>POST</span><code>/api/intents/v1/cross-chain/states/:stateId/receipts/:receiptId/verification-reports</code></div>
            <div><span>GET</span><code>/api/intents/v1/operators</code></div>
            <div><span>POST</span><code>/api/intents/v1/log/:intentHash/root-anchor</code></div>
            <div><span>POST</span><code>/api/intents/v1/auctions/:intentHash/execution-claims</code></div>
            <div><span>POST</span><code>/api/intents/v1/auctions/:intentHash/disputes</code></div>
            <div><span>POST</span><code>/api/intents/v1/auctions/:intentHash/adjudicate</code></div>
            <div><span>POST</span><code>/api/intents/v1/auctions/:intentHash/settlement-reports</code></div>
            <div><span>POST</span><code>/api/intents/v1/validate</code></div>
          </section>

          <div className="ios-capability-grid">
            {SOLVER_CAPABILITIES.map((solver) => (
              <section key={solver.id}>
                <div className="row-between">
                  <span className="ios-capability-icon">{solver.live ? '◉' : '○'}</span>
                  <span className={`ios-status ${solver.live ? 'eligible' : 'unavailable'}`}>
                    {t(solver.live ? 'intentOS.network.live' : 'intentOS.network.roadmap')}
                  </span>
                </div>
                <h3>{t(`intentOS.solver.${solver.id}.title`, { defaultValue: solver.id })}</h3>
                <p>{t(`intentOS.solver.${solver.id}.body`, { defaultValue: solver.detail })}</p>
                <code>{solver.settlement}</code>
              </section>
            ))}
          </div>

          <section className="ios-ai-boundary">
            <span>AI</span>
            <div><h3>{t('intentOS.network.aiTitle')}</h3><p>{t('intentOS.network.aiBody')}</p></div>
          </section>
          <p className="ios-honesty-note">{t('intentOS.network.safetyNotice')}</p>
        </motion.div>
      )}
    </PageTransition>
  );
}
