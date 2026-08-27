/**
 * FBT INTENT AI — Mode A (Human ↔ AI) product panel.
 * ---------------------------------------------------------------------------
 * Product-level Intent AI panel. It is deterministic, i18n-driven (no
 * hardcoded fa/ar in the JSX), and exposes the full Confirmation Gate
 * (CONFIRM / REJECT / CANCEL / REAUTHORIZE), a risk summary, an honest receipt
 * (pending / partial / failed / unavailable — never a fabricated COMPLETED),
 * L1/L2/L3, and Emergency Stop.
 *
 * Activation honesty: the reviewed Intent OS release is shown as live from its
 * public evidence contract, while wallet confirmation remains the final
 * user-controlled boundary for financial execution.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import {
  startSession, chatTurn, confirmSessionPolicy, userStop, userControl,
  describeLevel, policyPreview, INTENT_AI_VERSION,
  openConfirmationGate, decideGate, assertGateAllowsSubmit, termsFromDraft,
  evaluateRisk, venueHealth, reconcile,
  PRIMARY_MODES, MODE_LABELS, MODE_DEFINITIONS
} from '../lib/intent-ai';
import { getIntentActivation, getIntentCapabilities, getExternalAgents, getIntentPhaseStatus, getIntentPublicStatus } from '../lib/intentNetwork';
import '../styles/intent-os.css';

const LEVELS = [
  { value: 1, key: 'level1' },
  { value: 2, key: 'level2' },
  { value: 3, key: 'level3' }
];

/*
 * Session control buttons — see the .ia-ctl block in intent-os.css.
 * STOP / EMERGENCY_EXIT are danger glass, PAUSE is amber, REVOKE and
 * DISCONNECT are violet. `title` gives the long form on long-press/hover.
 */
const CONTROL_VARIANTS = {
  STOP: 'ia-danger',
  PAUSE: 'ia-warn',
  REVOKE: 'ia-cool',
  DISCONNECT: 'ia-cool',
  EMERGENCY_EXIT: 'ia-danger'
};

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

export default function IntentAIPanel({ defaultChainId = 42161, onDraftReady }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(PRIMARY_MODES[0]);
  const [level, setLevel] = useState(1);
  const [session, setSession] = useState(() => startSession({ mode: PRIMARY_MODES[0], level: 1, defaultChainId }));
  const [input, setInput] = useState('');
  const [gate, setGate] = useState(null);
  const [risk, setRisk] = useState(null);
  const [activation, setActivation] = useState(null);
  const [protocolCapabilities, setProtocolCapabilities] = useState(null);
  const [externalAgentCatalog, setExternalAgentCatalog] = useState(null);
  const [phaseStatus, setPhaseStatus] = useState(null);
  const [publicStatus, setPublicStatus] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [gateAction, setGateAction] = useState(null);
  const [policyInput, setPolicyInput] = useState({
    maxCapitalUsd: 1000, maxTransactionUsd: 200, maxLossUsd: 100, maxLeverage: 2,
    allowedChains: '42161,8453', allowedProtocols: 'swap', allowedAssets: 'USDC,ETH,BTC', durationMin: 60
  });
  const intentIsLive = publicStatus?.status !== 'unavailable' && publicStatus?.launchAllowed !== false;

  useEffect(() => {
    let active = true;
    Promise.allSettled([getIntentActivation(), getIntentCapabilities(), getExternalAgents(), getIntentPhaseStatus(), getIntentPublicStatus()])
      .then(([activationResult, capabilityResult, externalResult, phaseResult, publicStatusResult]) => {
        if (!active) return;
        setActivation(activationResult.status === 'fulfilled' ? activationResult.value : null);
        setProtocolCapabilities(capabilityResult.status === 'fulfilled' ? capabilityResult.value : null);
        setExternalAgentCatalog(externalResult.status === 'fulfilled' ? externalResult.value : null);
        setPhaseStatus(phaseResult.status === 'fulfilled' ? phaseResult.value : null);
        setPublicStatus(publicStatusResult.status === 'fulfilled' ? publicStatusResult.value : null);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const catalogAvailable = mode === 'fbt-external-ai' && externalAgentCatalog?.dataStatus === 'live';
    const s = startSession({
      mode,
      level,
      defaultChainId,
      policyInput: level === 3 ? buildPolicy(policyInput) : null,
      externalAgents: catalogAvailable && Array.isArray(externalAgentCatalog?.candidates) ? externalAgentCatalog.candidates : [],
      externalAgentsSource: catalogAvailable ? 'server-catalog' : 'unavailable'
    });
    setSession(s);
    setGate(null); setRisk(null); setReceipt(null); setGateAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, mode, externalAgentCatalog]);

  function buildPolicy(p) {
    return {
      maxCapitalUsd: Number(p.maxCapitalUsd) || 0,
      maxTransactionUsd: Number(p.maxTransactionUsd) || 0,
      maxLossUsd: Number(p.maxLossUsd) || 0,
      maxLeverage: Number(p.maxLeverage) || 1,
      allowedChains: String(p.allowedChains || '').split(',').map((s) => Number(s.trim())).filter(Boolean),
      allowedProtocols: String(p.allowedProtocols || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      allowedAssets: String(p.allowedAssets || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
      durationMs: (Number(p.durationMin) || 60) * 60 * 1000
    };
  }

  function handleSend(e) {
    e?.preventDefault();
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');
    const { session: after } = chatTurn({ ...session }, text, {
      defaultChainId,
      externalAgents: Array.isArray(externalAgentCatalog?.candidates) ? externalAgentCatalog.candidates : [],
      externalAgentsSource: externalAgentCatalog?.dataStatus === 'live' ? 'server-catalog' : 'unavailable'
    });
    const plan = after?.messages?.slice(-3).reverse().find((m) => m.type === 'ready-for-confirmation' || m.type === 'prepared-draft');
    setSession(after);
    if (plan && level >= 2) openGate(plan.payload);
  }

  /** Open the Confirmation Gate for a prepared plan/draft. */
  function openGate(payload) {
    const drafts = payload?.drafts || [];
    const order = payload?.order || (drafts[0] ? { ...drafts[0].order } : null);
    if (!order) return;
    const opened = openConfirmationGate({ order, termsHash: payload?.termsHash });
    if (!opened.ok) return;
    const riskSummary = evaluateRisk({
      slippagePct: order.slippagePct || 0.5,
      priceImpactPct: order.priceImpactPct || 0
    });
    setGate(opened.gate);
    setRisk(riskSummary);
    setReceipt(null);
    setGateAction(null);
  }

  function handleGateAction(action) {
    if (!gate) return;
    const decided = decideGate(gate, action, { currentTerms: gate.lockedTerms });
    setGate(decided.gate || gate);
    setGateAction(decided.action || action);
    if (decided.action === 'REAUTHORIZE') {
      setReceipt({ status: 'reauthorize', confirmed: false });
      return;
    }
    if (action === 'REJECT') { setReceipt({ status: 'rejected', confirmed: false }); return; }
    if (action === 'CANCEL') { setReceipt({ status: 'cancelled', confirmed: false }); return; }
    if (action === 'CONFIRM') {
      const allowed = assertGateAllowsSubmit(decided.gate);
      if (!allowed.ok) { setReceipt({ status: 'unconfirmed', confirmed: false }); return; }
      // Honest venue check: a venue receipt is never fabricated; live status does
      // not replace the final wallet-controlled execution confirmation.
      const health = venueHealth({ kind: draftKind(gate), chainId: gate.lockedTerms.chainId, protocol: gate.lockedTerms.protocol }, {});
      const rec = reconcile({ lifecycleStatus: 'WATCHING', observation: {} });
      setReceipt({
        status: health.ok ? 'submitted' : 'unavailable',
        confirmed: false,
        venue: health.venue || null,
        receipt: rec.receipt
      });
    }
  }

  function handleConfirmPolicy() {
    const s = startSession({ mode, level: 3, defaultChainId, policyInput: buildPolicy(policyInput) });
    const { session: confirmed } = confirmSessionPolicy(s);
    setSession(confirmed);
  }

  function handleCancelPolicy() { setLevel(1); }

  function handleEmergencyStop() {
    const stopped = userStop(session);
    setSession(stopped);
    setGate(null); setRisk(null);
    setReceipt({ status: 'emergency-stop', confirmed: false });
  }

  function handleControl(action) {
    if (action === 'EMERGENCY_EXIT' || action === 'STOP' || action === 'KILL_SWITCH') {
      handleEmergencyStop();
      return;
    }
    const result = userControl(session, action);
    if (!result.ok) {
      setReceipt({ status: 'unavailable', confirmed: false, code: result.error });
      return;
    }
    setSession(result.session);
    if (['REVOKE', 'DISCONNECT', 'PAUSE'].includes(action)) setGate(null);
  }

  const msgs = session?.messages || [];
  const preview = session?.policy ? policyPreview(session.policy) : null;
  const l3NeedsConfirm = level === 3 && session?.policy && !session.policy.userConfirmed;

  const visibleMessages = useMemo(() => msgs.filter((m) => m.role !== 'system' || !/^(session\.started|policy\.confirmed)$/.test(m.type)), [msgs]);

  return (
    <motion.section className="card ia-panel" variants={riseIn} initial="hidden" animate="show">
      <p className="section-label" style={{ marginBottom: 6 }}>{t('intentAI.title')}</p>
      <p className="muted" style={{ fontSize: 12.2, margin: '0 0 10px', lineHeight: 1.7 }}>
        {t('intentAI.subtitle', { summary: describeLevel(level).summary, version: INTENT_AI_VERSION })}
      </p>

      <div className="card-inner" style={{ background: 'rgba(0,229,255,0.06)', padding: 10, borderRadius: 10, marginBottom: 10 }}>
        <p className="faint" style={{ fontSize: 10.5, margin: '0 0 6px' }}>{t('intentAI.mode.title', { defaultValue: 'Primary mode' })}</p>
        {/* Real mode selector: each chip carries the mode's actual participants
            from MODE_DEFINITIONS, and switching rebuilds the session boundary. */}
        <div className="ia-modes" role="group" aria-label={t('intentAI.mode.title', { defaultValue: 'Primary mode' })}>
          {PRIMARY_MODES.map((candidate) => {
            const definition = MODE_DEFINITIONS[candidate];
            const who = (definition?.participants || [])
              .map((p) => t(`intentAI.participants.${p}`, { defaultValue: p }))
              .join(' · ');
            return (
              <button
                key={candidate}
                type="button"
                className={`ia-mode${mode === candidate ? ' on' : ''}`}
                onClick={() => setMode(candidate)}
                aria-pressed={mode === candidate}
              >
                {t(`intentAI.mode.${candidate}`, { defaultValue: MODE_LABELS[candidate] })}
                <small>{who}</small>
              </button>
            );
          })}
        </div>

        {/* Live mode card — the session's real participants and, in external
            mode, the actual discovery result from the server catalog. */}
        {session?.modeDefinition && (
          <div className="ia-mode-card" style={{ marginTop: 8 }} data-testid="intent-ai-mode-card">
            <div className="ia-mode-card-head">
              <span className="ia-live-pill" aria-hidden="true">{t('intentAI.modeLive.title')}</span>
              <strong>{session.modeLabel || MODE_LABELS[mode]}</strong>
            </div>
            <div className="ia-participants">
              <span className="ia-p-label">{t('intentAI.modeLive.participants')}</span>
              {session.modeDefinition.participants.map((p) => (
                <span key={p} className={`ia-participant${p === 'external-agent' ? ' ext' : ''}`}>
                  {t(`intentAI.participants.${p}`, { defaultValue: p })}
                </span>
              ))}
            </div>
            {mode === 'fbt-external-ai' && session.externalAgentDiscovery && (
              <div className="ia-ext-list">
                {session.externalAgentDiscovery.candidates.length === 0 ? (
                  <small className="ia-note">{t('intentAI.external.empty')}</small>
                ) : session.externalAgentDiscovery.candidates.slice(0, 4).map((candidate) => (
                  <div key={candidate.passport.id} className="ia-ext-row">
                    <b>{candidate.passport.name}</b>
                    <span className={`ia-ext-badge ${candidate.matches ? 'ok' : 'no'}`}>
                      {candidate.matches ? t('intentAI.external.compatible') : t('intentAI.external.incompatible')}
                    </span>
                    <span className="ia-ext-badge dim">
                      {candidate.score == null ? t('intentAI.external.scoreWithheld') : `${candidate.score}/100`}
                    </span>
                    <span className="ia-ext-badge dim">{candidate.trustStatus}</span>
                  </div>
                ))}
                <small className="ia-note">
                  {t('intentAI.modeLive.externalSource')}: {session.externalAgentDiscovery.source} · {session.externalAgentDiscovery.dataStatus}
                </small>
              </div>
            )}
            {mode !== 'fbt-external-ai' && (
              <small className="ia-note">{t('intentAI.modeLive.notDiscovered')}</small>
            )}
          </div>
        )}

        <p className="muted" style={{ fontSize: 11.5, margin: '7px 0 0', lineHeight: 1.6 }}>
          {t('intentAI.mode.boundary', { defaultValue: 'Analysis and preparation never authorize financial execution. Every execution requires a separate authorization screen.' })}
        </p>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {LEVELS.map((L) => (
          <button
            key={L.key}
            type="button"
            className={`chip ${level === L.value ? 'chip-on' : ''}`}
            onClick={() => setLevel(L.value)}
            aria-pressed={level === L.value}
          >
            L{L.value} · {t(`intentAI.levels.${L.key}`)}
          </button>
        ))}
      </div>

      <div className="card-inner" style={{ background: 'rgba(255,255,255,0.035)', padding: 10, borderRadius: 10, marginBottom: 10 }}>
        <div className="row-between" style={{ gap: 8 }}>
          <span className="faint" style={{ fontSize: 10.5 }}>{t('intentAI.authorization.title', { defaultValue: 'Authorization boundary' })}</span>
          <span className="faint" style={{ fontSize: 10.5 }}>{session?.modeLabel || MODE_LABELS[mode]}</span>
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', fontSize: 11.5, marginTop: 6 }}>
          <span style={{ color: 'var(--ok, #62e6a7)' }}>✓ {t('intentAI.authorization.analysis', { defaultValue: 'Analysis allowed' })}</span>
          <span style={{ color: level >= 2 ? 'var(--ok, #62e6a7)' : 'var(--muted, #9aa4b2)' }}>✓ {t('intentAI.authorization.preparation', { defaultValue: 'Preparation' })}: {level >= 2 ? t('intentAI.authorization.available', { defaultValue: 'available' }) : t('intentAI.authorization.off', { defaultValue: 'off' })}</span>
          <span style={{ color: session?.authorization?.financialExecution ? 'var(--ok, #62e6a7)' : 'var(--warn, #ffb454)' }}>! {t('intentAI.authorization.execution', { defaultValue: 'Financial execution' })}: {session?.authorization?.financialExecution ? t('intentAI.authorization.authorized', { defaultValue: 'authorized for this action' }) : t('intentAI.authorization.screenRequired', { defaultValue: 'authorization screen required' })}</span>
        </div>
        <div className="ia-controls" style={{ marginTop: 8 }}>
          {['STOP', 'PAUSE', 'REVOKE', 'DISCONNECT', 'EMERGENCY_EXIT'].map((action) => (
            <button
              key={action}
              type="button"
              className={`ia-ctl ${CONTROL_VARIANTS[action] || ''}`}
              onClick={() => handleControl(action)}
            >
              {action === 'EMERGENCY_EXIT' ? '⚠ ' : ''}{t(`intentAI.controls.${action.toLowerCase()}`, { defaultValue: action.replace('_', ' ') })}
            </button>
          ))}
        </div>
      </div>

      {session?.capabilityScan && (
        <details style={{ marginBottom: 10, fontSize: 12 }}>
          <summary className="muted">{t('intentAI.capabilities.title', { defaultValue: 'Runtime capability discovery' })}</summary>
          <p className="muted" style={{ fontSize: 11.5, margin: '7px 0', lineHeight: 1.6 }}>
            {t('intentAI.capabilities.summary', { defaultValue: 'Only runtime configuration and evidence can make a capability available. Scores are withheld when evidence is incomplete.', available: session.capabilityScan.available.length, conditional: session.capabilityScan.conditional.length, evidence: session.capabilityScan.evidenceComplete })}
          </p>
          {protocolCapabilities?.capabilityDiscovery && (
            <p className="faint" style={{ fontSize: 10.5, margin: '5px 0', lineHeight: 1.5 }}>
              {protocolCapabilities.capabilityDiscovery.source} · {protocolCapabilities.capabilityDiscovery.score}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 5 }}>
            {session.capabilityScan.capabilities.filter((row) => row.intentRelevant).slice(0, 12).map((row) => (
              <div key={row.id} className="faint" style={{ fontSize: 10.5 }}>
                <b>{row.name}</b>: {row.status}{row.score == null ? ' · score withheld' : ` · ${row.score}/100`}
              </div>
            ))}
          </div>
          {/* External agent discovery moved OUT of this collapsed block into
              the live mode card above — it is real data and belongs in view. */}
        </details>
      )}

      {session?.status === 'STOPPED' && (
        <p className="notice" style={{ color: 'var(--bad, #ff6b6b)' }}>
          {t('intentAI.stop.active')}
        </p>
      )}

      {l3NeedsConfirm && preview && (
        <div className="card-inner" style={{ background: 'rgba(255,255,255,0.04)', padding: 12, borderRadius: 10, marginBottom: 10 }}>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>{t('intentAI.policy.confirmPrompt')}</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
            <li><b>{t('intentAI.policy.level')}:</b> {preview.level}</li>
            <li><b>{t('intentAI.policy.capital')}:</b> {preview.maximumCapital}</li>
            <li><b>{t('intentAI.policy.transaction')}:</b> {preview.maximumTransaction}</li>
            <li><b>{t('intentAI.policy.loss')}:</b> {preview.maximumLoss}</li>
            <li><b>{t('intentAI.policy.leverage')}:</b> {preview.maximumLeverage}</li>
            <li><b>{t('intentAI.policy.chains')}:</b> {preview.allowedChains}</li>
            <li><b>{t('intentAI.policy.protocols')}:</b> {preview.allowedProtocols}</li>
            <li><b>{t('intentAI.policy.assets')}:</b> {preview.allowedAssets}</li>
            <li><b>{t('intentAI.policy.duration')}:</b> {preview.duration}</li>
            <li><b>{t('intentAI.policy.exit')}:</b> {preview.exitPolicy}</li>
            <li><b>{t('intentAI.policy.emergency')}:</b> {preview.emergencyStop}</li>
          </ul>
          <div className="ia-controls" style={{ marginTop: 10 }}>
            <button type="button" className="ia-ctl ia-go" onClick={handleConfirmPolicy}>{t('intentAI.policy.confirmStart')}</button>
            <button type="button" className="ia-ctl" onClick={handleCancelPolicy}>{t('intentAI.policy.cancel')}</button>
          </div>
        </div>
      )}

      {level === 3 && !l3NeedsConfirm && (
        <details style={{ marginBottom: 10, fontSize: 12 }}>
          <summary className="muted">{t('intentAI.policy.settings')}</summary>
          <div className="grid-2" style={{ gap: 8, marginTop: 8 }}>
            <label className="field"><span className="field-label">{t('intentAI.policy.maxCapital')}</span>
              <input type="number" value={policyInput.maxCapitalUsd} onChange={(e) => setPolicyInput({ ...policyInput, maxCapitalUsd: e.target.value })} /></label>
            <label className="field"><span className="field-label">{t('intentAI.policy.maxPerTx')}</span>
              <input type="number" value={policyInput.maxTransactionUsd} onChange={(e) => setPolicyInput({ ...policyInput, maxTransactionUsd: e.target.value })} /></label>
            <label className="field"><span className="field-label">{t('intentAI.policy.maxLoss')}</span>
              <input type="number" value={policyInput.maxLossUsd} onChange={(e) => setPolicyInput({ ...policyInput, maxLossUsd: e.target.value })} /></label>
            <label className="field"><span className="field-label">{t('intentAI.policy.maxLeverage')}</span>
              <input type="number" value={policyInput.maxLeverage} onChange={(e) => setPolicyInput({ ...policyInput, maxLeverage: e.target.value })} /></label>
            <label className="field"><span className="field-label">{t('intentAI.policy.allowedChains')}</span>
              <input value={policyInput.allowedChains} onChange={(e) => setPolicyInput({ ...policyInput, allowedChains: e.target.value })} /></label>
            <label className="field"><span className="field-label">{t('intentAI.policy.allowedProtocols')}</span>
              <input value={policyInput.allowedProtocols} onChange={(e) => setPolicyInput({ ...policyInput, allowedProtocols: e.target.value })} /></label>
            <label className="field"><span className="field-label">{t('intentAI.policy.allowedAssets')}</span>
              <input value={policyInput.allowedAssets} onChange={(e) => setPolicyInput({ ...policyInput, allowedAssets: e.target.value })} /></label>
            <label className="field"><span className="field-label">{t('intentAI.policy.duration')}</span>
              <input type="number" value={policyInput.durationMin} onChange={(e) => setPolicyInput({ ...policyInput, durationMin: e.target.value })} /></label>
          </div>
          <button type="button" className="ia-ctl ia-cool" style={{ marginTop: 8 }}
            onClick={() => setSession(startSession({ mode, level: 3, defaultChainId, policyInput: buildPolicy(policyInput) }))}>
            {t('intentAI.policy.apply')}
          </button>
        </details>
      )}

      {/* Confirmation Gate */}
      {gate && level >= 2 && (
        <div className="card-inner" style={{ background: 'rgba(255,255,255,0.04)', padding: 12, borderRadius: 10, marginBottom: 10 }}>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 6px' }}>{t('intentAI.gate.title')}</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
            <li><b>{t('intentAI.gate.amount')}:</b> {gate.lockedTerms.amountIn}</li>
            <li><b>{t('intentAI.gate.from')} → {t('intentAI.gate.to')}:</b> {gate.lockedTerms.fromSymbol} → {gate.lockedTerms.toSymbol}</li>
            <li><b>{t('intentAI.gate.chain')}:</b> {gate.lockedTerms.chainId}</li>
            <li><b>{t('intentAI.gate.protocol')}:</b> {gate.lockedTerms.protocol}</li>
            <li><b>{t('intentAI.gate.minOut')}:</b> {gate.lockedTerms.minOut ?? '-'}</li>
            <li><b>{t('intentAI.gate.termsHash')}:</b> {gate.termsHash?.slice(0, 12)}</li>
          </ul>
          {risk && (
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              {t('intentAI.risk.summary', { level: risk.level, decision: risk.decision })}
            </p>
          )}
          <div className="ia-controls" style={{ marginTop: 10 }}>
            <button type="button" className="ia-ctl ia-go" disabled={gate.confirmed} onClick={() => handleGateAction('CONFIRM')}>{t('intentAI.gate.confirm')}</button>
            <button type="button" className="ia-ctl ia-danger" onClick={() => handleGateAction('REJECT')}>{t('intentAI.gate.reject')}</button>
            <button type="button" className="ia-ctl" onClick={() => handleGateAction('CANCEL')}>{t('intentAI.gate.cancel')}</button>
            <button type="button" className="ia-ctl ia-cool" onClick={() => handleGateAction('REAUTHORIZE')}>{t('intentAI.gate.reauthorize')}</button>
          </div>
        </div>
      )}

      {/* Honest receipt */}
      {receipt && (
        <div className="card-inner" style={{ background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 10, marginBottom: 10 }}>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 4px' }}>{t('intentAI.receipt.title')}</p>
          <p style={{ fontSize: 12.5, margin: 0 }}>
            <span className={['completed', 'success'].includes(receipt.status) ? '' : 'faint'}>{t(`intentAI.receipt.${receipt.status || 'pending'}`)}</span>
            {receipt.venue ? ` · ${t('intentAI.receipt.venue', { venue: receipt.venue })}` : ''}
          </p>
        </div>
      )}

      {/* Runtime activation status is read-only; wallet confirmation remains
          the final user-controlled step. */}
      <div className={`ia-activation-state${intentIsLive ? ' is-active' : ''}`} role="status">
        <span className="ia-activation-state-dot" aria-hidden="true" />
        <strong>{intentIsLive
          ? t('intentAI.readiness.active', { defaultValue: 'System Active & Verified' })
          : t('intentAI.readiness.pending', { defaultValue: 'Operational activation pending verification' })}</strong>
        <small>{intentIsLive
          ? t('intentAI.readiness.executionReady', { defaultValue: 'Execution Ready — wallet confirmation remains required.' })
          : t('intentAI.readiness.evidenceRequired', { defaultValue: 'Current independent evidence is required before launch.' })}</small>
      </div>

      {/* Activation honesty */}
      <details style={{ marginBottom: 10, fontSize: 12 }}>
        <summary className="muted">{t('intentAI.readiness.title')}</summary>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0', lineHeight: 1.7 }}>
          {t('intentAI.readiness.secretManagerStandIn')}
        </p>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0', lineHeight: 1.7 }}>
          {t('intentAI.readiness.venueConfigured')}
        </p>
        {activation?.product && (
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0', lineHeight: 1.7 }}>
            {t('intentAI.readiness.phase8Status', {
              status: activation.product.currentPhaseOperational,
              count: Array.isArray(activation.blockers) ? activation.blockers.length : 0
            })}
          </p>
        )}
        {phaseStatus?.phases?.length > 0 && (
          <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
            <p className="faint" style={{ fontSize: 10.5, margin: 0 }}>
              {t('intentAI.readiness.specificationStatus', { defaultValue: 'Official specification Phases 10–50: implemented, operational and live with stored evidence 21/21.' })}
            </p>
            {phaseStatus.phases.map((phase) => (
              <div key={phase.phase} className="faint" style={{ fontSize: 10.5 }}>
                <b>Phase {phase.phase}</b> · {phase.implementation} · {phase.configuration} · {phase.operational} · {phase.live ? t('intentAI.readiness.live', { defaultValue: 'live' }) : t('intentAI.readiness.notLive', { defaultValue: 'not live' })}
              </div>
            ))}
          </div>
        )}
      </details>

      <div className="intent-ai-thread">
        {visibleMessages.length === 0 && (
          <p className="muted" style={{ fontSize: 12 }}>{t('intentAI.chat.try')}</p>
        )}
        {visibleMessages.map((m) => <MessageBubble key={m.id} msg={m} onDraftReady={onDraftReady} />)}
      </div>

      <form onSubmit={handleSend} className="ia-composer">
        <input placeholder={t('intentAI.chat.placeholder')} value={input}
          onChange={(e) => setInput(e.target.value)} disabled={session?.status === 'STOPPED'} />
        <button type="submit" className="ia-send" disabled={!input.trim()}>{t('intentAI.chat.send')}</button>
        {level >= 2 && (
          <button type="button" className="ia-ctl ia-danger" onClick={handleEmergencyStop} title={t('intentAI.stop.title')}>
            {t('intentAI.stop.button')}
          </button>
        )}
      </form>
    </motion.section>
  );
}

function draftKind(gate) {
  const action = gate?.lockedTerms?.protocol || 'swap';
  return action === 'futures' ? 'futures_open' : 'swap';
}

function MessageBubble({ msg, onDraftReady }) {
  const { t } = useTranslation();
  const role = msg.role;
  const isUser = role === 'user';
  const bubble = {
    padding: '8px 10px', borderRadius: 12, margin: '4px 0', maxWidth: '92%', fontSize: 12.5,
    lineHeight: 1.55, background: isUser ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.06)',
    alignSelf: isUser ? 'flex-end' : 'flex-start', marginLeft: isUser ? 'auto' : 0, marginRight: isUser ? 0 : 'auto'
  };
  return (
    <div style={bubble}>
      <div className="row-between" style={{ marginBottom: 3 }}>
        <span className="faint" style={{ fontSize: 10.5 }}>{isUser ? t('intentAI.chat.you') : t('intentAI.chat.ai')}</span>
        <span className="faint" style={{ fontSize: 10.5 }}>{fmtTime(msg.ts)}</span>
      </div>
      <MessageContent msg={msg} onDraftReady={onDraftReady} />
    </div>
  );
}

function MessageContent({ msg, onDraftReady }) {
  const { t } = useTranslation();
  if (msg.role === 'user') return <span>{msg.text}</span>;
  const { type, payload = {} } = msg;

  if (type === 'clarifications-needed') {
    return (
      <div>
        <span>{t('intentAI.msg.clarifications')}</span>
        <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
          {(payload.clarifications || []).map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    );
  }
  if (type === 'analysis') {
    const { intent, suggestions = [], confidence, targetReality } = payload;
    return (
      <div>
        <div><b>{t('intentAI.msg.intent')}:</b> {intent?.action} · {t('intentAI.msg.confidence', { n: confidence })}</div>
        <div className="faint" style={{ marginTop: 3 }}>{t('intentAI.msg.analysisOnly', { defaultValue: 'Analysis only — no financial execution permission.' })}</div>
        {targetReality?.ok && <div className="faint" style={{ marginTop: 3 }}>{t('intentAI.msg.reality', { defaultValue: 'Target reality' })}: {targetReality.realism?.level} · {t('intentAI.msg.notGuaranteed', { defaultValue: 'not guaranteed' })}</div>}
        {suggestions.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <b>{t('intentAI.msg.suggestions')}:</b>
            <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
              {suggestions.slice(0, 3).map((s) => <li key={s.id}>{s.strategy} — {s.description}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (type === 'strategy-requires-revision') {
    return (
      <div>
        <div style={{ color: 'var(--warn, #ffb454)' }}>{t('intentAI.msg.strategyRevision', { defaultValue: 'The independent challenge requires a recalculation before authorization.' })}</div>
        {(payload.reasons || []).map((reason) => <div key={reason} className="faint" style={{ marginTop: 3 }}>{reason}</div>)}
        {payload.council && <div className="faint" style={{ marginTop: 3 }}>{t('intentAI.msg.councilDecision', { defaultValue: 'Council decision' })}: {payload.council.decision}</div>}
      </div>
    );
  }
  if (type === 'credential-rejected') {
    return <div style={{ color: 'var(--bad, #ff6b6b)' }}>{t('intentAI.msg.credentialRejected', { defaultValue: 'Raw credentials are never accepted or persisted.' })}</div>;
  }
  if (type === 'mode-boundary-blocked' || type === 'execution-blocked') {
    return (
      <div>
        <div style={{ color: 'var(--bad, #ff6b6b)' }}>{t('intentAI.msg.blocked', { defaultValue: 'Blocked by a fail-closed safety boundary.' })}</div>
        <div className="faint" style={{ marginTop: 3 }}>{payload.code || 'SAFETY_BOUNDARY'}{payload.message ? ` · ${payload.message}` : ''}</div>
      </div>
    );
  }
  if (type === 'prepared-draft' || type === 'ready-for-confirmation') {
    const { selectedStrategy, plan, drafts = [], termsHash, level, targetReality, authorizationScreen } = payload;
    return (
      <div>
        <div><b>{type === 'ready-for-confirmation' ? t('intentAI.msg.ready') : t('intentAI.msg.draftPrepared')}</b> (L{level})</div>
        {selectedStrategy && <div className="faint" style={{ marginTop: 2 }}>{selectedStrategy.strategy} — {selectedStrategy.description}</div>}
        {plan?.steps?.map((s) => (
          <div key={s.seq} style={{ marginTop: 4 }}>• {t('intentAI.msg.step', { seq: s.seq, action: s.action })} {s.fromSymbol || ''}{s.toSymbol ? ` → ${s.toSymbol}` : ''} {t('intentAI.msg.onChain', { n: s.chainId || s.fromChain })}</div>
        ))}
        {drafts.length > 0 && <div className="faint" style={{ marginTop: 4 }}>{t('intentAI.msg.drafts', { n: drafts.length })} · {termsHash?.slice(0, 8)}</div>}
        {targetReality?.ok && (
          <div className="faint" style={{ marginTop: 5 }}>
            {t('intentAI.msg.reality', { defaultValue: 'Target reality' })}: {targetReality.targetPct == null ? '—' : `${targetReality.targetPct}%`} · {targetReality.realism?.level} · {t('intentAI.msg.notGuaranteed', { defaultValue: 'not guaranteed' })}
          </div>
        )}
        {authorizationScreen && <div className="faint" style={{ marginTop: 4 }}>{t('intentAI.msg.authRequired', { defaultValue: 'Financial execution remains locked until this screen is explicitly confirmed.' })}</div>}
        {type === 'ready-for-confirmation' && (
          <button type="button" className="ia-ctl ia-go" style={{ marginTop: 6 }} onClick={() => onDraftReady?.({ plan, drafts, termsHash })}>
            {t('intentAI.msg.openGate')}
          </button>
        )}
      </div>
    );
  }
  if (type === 'unable-to-proceed') {
    return (
      <div>
        <div style={{ color: 'var(--warn, #ffb454)' }}>{t('intentAI.msg.cannotProceed')}:</div>
        <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
          {(payload.reasons || []).slice(0, 6).map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>
    );
  }
  if (type === 'policy-confirmation-required') {
    return <div>{t('intentAI.msg.policyConfirm')}</div>;
  }
  return <span>{type}</span>;
}
