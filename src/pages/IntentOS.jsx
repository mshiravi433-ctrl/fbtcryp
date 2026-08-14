import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import Switch from '../components/Switch';
import SegIndicator from '../components/SegIndicator';
import { EVM_CHAINS, EVM_CHAIN_ORDER } from '../lib/chains';
import {
  SOLVER_CAPABILITIES,
  WORKFLOW_ACTIONS,
  compileIntent,
  loadIntentMemory,
  loadIntents,
  removeIntent,
  saveCompiledIntent,
  saveIntentMemory
} from '../lib/intentOS';
import {
  downloadExecutionProof,
  loadExecutionProofs,
  verifyExecutionProof
} from '../lib/executionProof';
import { getIntentCapabilities } from '../lib/intentNetwork';
import '../styles/intent-os.css';

const TABS = ['compose', 'memory', 'proofs', 'network'];
const TEMPLATES = [
  { id: 'swap', icon: '↗', kind: 'swap' },
  { id: 'outcome', icon: '◎', kind: 'outcome' },
  { id: 'automation', icon: '⌁', kind: 'automation' },
  { id: 'workflow', icon: '⛓', kind: 'workflow' }
];

const DEFAULT_WORKFLOW = [
  { id: 'swap', action: 'swap', asset: 'ETH', target: 'Buy ETH' },
  { id: 'bridge', action: 'bridge', asset: 'ETH', target: 'Bridge to Arbitrum' },
  { id: 'deposit', action: 'deposit', asset: 'ETH', target: 'Deposit into lending' }
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
  return (
    <div className="ios-proof-card">
      <div className="row-between">
        <span className="ios-proof-seal">✓</span>
        <span className="ios-status eligible">{t('intentOS.proof.confirmed')}</span>
      </div>
      <strong className="mono ios-proof-id">{proof.id}</strong>
      <div className="ios-proof-pair">
        <span>{payload.constraints?.from?.symbol || '—'} → {payload.constraints?.to?.symbol || '—'}</span>
        <span className="mono">{selected?.solver || '—'}</span>
      </div>
      <p>{t('intentOS.proof.scope')}</p>
      <div className="ios-proof-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => onVerify(proof)}>{t('intentOS.proof.verify')}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => downloadExecutionProof(proof)}>{t('intentOS.proof.download')}</button>
      </div>
    </div>
  );
}

export default function IntentOS() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const requested = searchParams.get('tab');
    return TABS.includes(requested) ? requested : 'compose';
  });
  const [memory, setMemory] = useState(() => loadIntentMemory());
  const [saved, setSaved] = useState(() => loadIntents());
  const [proofs, setProofs] = useState(() => loadExecutionProofs());
  const [verified, setVerified] = useState(null);
  const [compiled, setCompiled] = useState(null);
  const [networkStatus, setNetworkStatus] = useState(null);
  const [draft, setDraft] = useState(() => ({
    kind: 'swap',
    chainId: loadIntentMemory().preferredChainId,
    fromSymbol: 'USDC',
    toSymbol: 'ETH',
    amountIn: '1000',
    amountUsd: '1000',
    minReceive: '',
    deadlineHours: 2,
    maxSlippagePct: loadIntentMemory().maxSlippagePct,
    privacy: 'standard',
    conditionType: 'priceBelow',
    conditionValue: '2500',
    note: '',
    steps: DEFAULT_WORKFLOW
  }));

  const activeTemplate = TEMPLATES.find((item) => item.kind === draft.kind);
  const savedDrafts = useMemo(() => saved.slice(0, 4), [saved]);

  useEffect(() => {
    let active = true;
    getIntentCapabilities()
      .then((value) => { if (active) setNetworkStatus({ ok: true, ...value }); })
      .catch(() => { if (active) setNetworkStatus({ ok: false }); });
    return () => { active = false; };
  }, []);

  const patchDraft = (patch) => {
    setDraft((current) => ({ ...current, ...patch }));
    setCompiled(null);
  };

  const chooseTemplate = (template) => {
    patchDraft({
      kind: template.kind,
      ...(template.kind === 'workflow' ? { steps: DEFAULT_WORKFLOW } : {}),
      ...(template.kind === 'outcome' ? { minReceive: draft.minReceive || '0.25' } : {})
    });
  };

  const updateWorkflowStep = (index, patch) => {
    patchDraft({ steps: draft.steps.map((step, i) => i === index ? { ...step, ...patch } : step) });
  };

  const addWorkflowStep = () => {
    if (draft.steps.length >= 8) return;
    patchDraft({
      steps: [...draft.steps, {
        id: `step-${Date.now()}`,
        action: 'send',
        asset: draft.toSymbol,
        target: ''
      }]
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
      requireExecutionProof: memory.requireExecutionProof
    }, memory);
    setCompiled(result);
    if (!result.error) {
      const persisted = saveCompiledIntent(result);
      if (persisted.rows) setSaved(persisted.rows);
    }
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
      </motion.section>

      <StageRail t={t} />

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
                {['standard', 'relay', 'confidential'].map((mode) => (
                  <button key={mode} className={draft.privacy === mode ? 'active' : ''} onClick={() => patchDraft({ privacy: mode })}>
                    {t(`intentOS.privacy.${mode}.title`)}
                  </button>
                ))}
              </div>
              <p>{t(`intentOS.privacy.${draft.privacy}.body`)}</p>
            </div>

            {draft.kind === 'workflow' && (
              <div className="ios-workflow">
                {draft.steps.map((step, index) => (
                  <div key={step.id}>
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
                    <input
                      value={step.target}
                      onChange={(event) => updateWorkflowStep(index, { target: event.target.value })}
                      placeholder={t('intentOS.field.workflowTarget')}
                    />
                    <button
                      type="button"
                      onClick={() => removeWorkflowStep(index)}
                      disabled={draft.steps.length <= 2}
                      aria-label={t('intentOS.field.removeStep')}
                    >×</button>
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
                  <div className="ios-check-list">
                    {compiled.checks.map((row, index) => <CheckRow key={`${row.id}-${index}`} row={row} t={t} />)}
                  </div>

                  <h3>{t('intentOS.result.solverCandidates')}</h3>
                  <div className="ios-solver-list">
                    {compiled.solvers.map((solver) => <SolverRow key={solver.id} solver={solver} t={t} />)}
                  </div>

                  {compiled.handoff ? (
                    <button className="btn btn-primary ios-compile" onClick={() => navigate(compiled.handoff)}>
                      {t('intentOS.result.reviewHandoff')} <span>→</span>
                    </button>
                  ) : (
                    <p className="ios-honesty-note">{t('intentOS.result.draftOnly')}</p>
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
                    <small>{t(`intentOS.template.${row.intent.kind}.title`, { defaultValue: row.intent.kind })}</small>
                  </span>
                  <button onClick={() => setSaved(removeIntent(row.intent.id))} aria-label={t('intentOS.saved.remove')}>×</button>
                </div>
              ))}
            </section>
          )}
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

      {tab === 'network' && (
        <motion.div className="ios-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <section className="ios-network-hero">
            <div className="ios-network-glyph"><span>FBT</span><i /><i /><i /></div>
            <div><h2>{t('intentOS.network.title')}</h2><p>{t('intentOS.network.subtitle')}</p></div>
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
              <span><b>{networkStatus?.auctions?.configuredAnchorNetworks ?? '—'}</b>{t('intentOS.network.anchorNetworks')}</span>
              <span><b>{networkStatus?.auctions?.signedCloseReceipts ? t('intentOS.network.signed') : '—'}</b>{t('intentOS.network.closeReceipt')}</span>
              <span><b>{networkStatus?.auctions?.signedAdmissionReceipts ? t('intentOS.network.signed') : networkStatus?.ok ? t('intentOS.network.unconfigured') : '—'}</b>{t('intentOS.network.admissionReceipts')}</span>
              <span><b>{networkStatus?.watchers ? networkStatus.watchers.registeredWatchers : '—'}</b>{t('intentOS.network.watchers')}</span>
              <span><b>{networkStatus?.auctions?.auctionCompletenessProof ? t('intentOS.network.proven') : t('intentOS.network.evidenceBased')}</b>{t('intentOS.network.completeness')}</span>
            </div>
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
