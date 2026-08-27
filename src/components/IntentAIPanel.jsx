/**
 * FBT INTENT AI — Mode A (Human ↔ AI) product panel.
 * ---------------------------------------------------------------------------
 * Product-level Intent AI panel. It is deterministic, i18n-driven (no
 * hardcoded fa/ar in the JSX), and exposes:
 *
 *   · a guided step-by-step chat flow (one question at a time, with
 *     quick-reply chips: task, amount confirmations, network, tool perms)
 *   · the friendly financial/time limits (400k total, 5k per tx, 60% goal,
 *     30-day goals) enforced in the parser, the flow and this UI
 *   · an INTERACTIVE confirmation screen: editable amount / duration / goal
 *     (each with its max-allowed caption) + tool permission checkboxes
 *     ("which of these am I allowed to use?") before the final confirm
 *   · multi-agent routing made visible: two AI agents analyse together, the
 *     best route is announced in chat, and a chat "yes" runs the real
 *     executeConfirmed path (same Confirmation Gate as the buttons)
 *   · a live countdown timer for timed, confirmed goals
 *   · an accordion of practical prompt examples per route
 *   · an info modal explaining the external-agent mode, its security
 *     boundaries and how interaction works
 *   · a dvh-based chat layout: the message list scrolls while the composer
 *     stays above the mobile keyboard
 *
 * Activation honesty: wallet confirmation remains the final user-controlled
 * boundary for financial execution; the receipt is always honest
 * (pending / partial / failed / unavailable — never a fabricated COMPLETED).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import {
  startSession, chatTurn, confirmSessionPolicy, userStop, userControl,
  describeLevel, policyPreview, INTENT_AI_VERSION,
  openConfirmationGate, decideGate, assertGateAllowsSubmit, termsFromDraft,
  evaluateRisk, venueHealth, reconcile, executeConfirmed,
  describeWalletRuntime, signIntentWithWallet,
  sessionPolicyCaps, checkSessionPolicy, explainExecutionFailure,
  goalProgress,
  PRIMARY_MODES, MODE_LABELS, MODE_DEFINITIONS,
  INTENT_LIMITS, MAX_GOAL_DURATION_HRS,
  FLOW_CHAIN_SUGGESTIONS, FLOW_TASK_SUGGESTIONS, FLOW_TOOL_SUGGESTIONS,
  /* Phase 90 — the fee is on the preview and on the receipt, or nothing runs. */
  computeFee, attachFeeToReceipt,
  /* Phase 94 — offline is a waiting room, never an outbox. */
  enqueueIntent, offlineStatus,
  /* Phase 88 — a swap is not a ramp; say so before anything is drafted. */
  detectFiatIntent, fiatBoundaryResponse,
  /* Draft to transaction: broadcasting stays off unless the build enables it. */
  broadcastEnabled, assertBroadcastAllowed
} from '../lib/intent-ai';
import { getIntentActivation, getIntentCapabilities, getExternalAgents, getIntentPhaseStatus, getIntentPublicStatus } from '../lib/intentNetwork';
import GoalCountdown from './GoalCountdown';
import TokenApprovals from './TokenApprovals';
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

/** The four Confirmation Gate actions the panel submits. */
const GATE_ACTIONS = ['CONFIRM', 'REJECT', 'CANCEL', 'REAUTHORIZE'];

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

/* ------------------------------------------------------------------ */
/* Interactive confirmation screen helpers                              */
/* ------------------------------------------------------------------ */

/** Build the editable screen state from a prepared plan / next-step payload. */
function screenFromPayload(payload, session) {
  const draftRow = payload?.drafts?.[0] || null;
  const draft = draftRow?.order || payload?.draft || null;
  const intent = payload?.intent || {};
  const goalMeta = payload?.goalMeta || session?.goalMeta || {};
  const amountFromDraft = Number(draft?.amountIn ?? draft?.amountUsd);
  const durationHrs = Number(intent.durationHrs ?? goalMeta.durationHrs ?? 0) || null;
  const goalPct = Number(intent.goalPct ?? goalMeta.pct ?? 0) || null;
  const screen = {
    draftId: draft?.id || draftRow?.id || payload?.draft?.id || null,
    termsHash: payload?.termsHash || null,
    planId: payload?.plan?.planId || payload?.planId || null,
    amountUsd: Number.isFinite(amountFromDraft) && amountFromDraft > 0 ? amountFromDraft : 0,
    durationHrs,
    goalPct,
    fromSymbol: draft?.fromSymbol || intent.fromSymbol || '',
    toSymbol: draft?.toSymbol || intent.toSymbol || '',
    chainId: draft?.chainId || intent.chainId || null,
    protocol: draft?.protocol || payload?.draft?.kind || 'swap',
    tools: { swap: true, bridge: true, dca: true },
    errors: {},
    modified: false
  };
  screen.errors = validateScreen(screen);
  return screen;
}

/** Limit validation for the editable fields — the same caps as the parser. */
function validateScreen(screen) {
  const errors = {};
  const amount = Number(screen.amountUsd);
  if (Number.isFinite(amount) && amount > INTENT_LIMITS.maxTotalInputUsd) errors.amountUsd = 'TOTAL_INPUT_OVER_LIMIT';
  else if (Number.isFinite(amount) && amount > INTENT_LIMITS.maxPerTransactionUsd) errors.amountUsd = 'PER_TX_OVER_LIMIT';
  else if (Number.isFinite(amount) && amount <= 0) errors.amountUsd = 'AMOUNT_INVALID';
  const goal = Number(screen.goalPct);
  if (screen.goalPct != null && screen.goalPct !== '' && Number.isFinite(goal) && goal > INTENT_LIMITS.maxGoalPct) errors.goalPct = 'GOAL_PCT_OVER_LIMIT';
  const duration = Number(screen.durationHrs);
  if (screen.durationHrs != null && screen.durationHrs !== '' && Number.isFinite(duration) && duration > MAX_GOAL_DURATION_HRS) errors.durationHrs = 'GOAL_DURATION_OVER_LIMIT';
  return errors;
}

/** Apply the user's edits to the target draft (immutably, within limits). */
function applyScreenEdits(session, screen) {
  if (!screen?.modified || !screen.draftId) return session;
  const has = (v) => v !== null && v !== undefined && v !== '';
  const drafts = (session.drafts || []).map((d) => {
    if (d.id !== screen.draftId) return d;
    return {
      ...d,
      amountIn: has(screen.amountUsd) ? Number(screen.amountUsd) : d.amountIn,
      amountUsd: has(screen.amountUsd) ? Number(screen.amountUsd) : d.amountUsd,
      fromSymbol: has(screen.fromSymbol) ? String(screen.fromSymbol).toUpperCase() : d.fromSymbol,
      toSymbol: has(screen.toSymbol) ? String(screen.toSymbol).toUpperCase() : d.toSymbol,
      chainId: has(screen.chainId) ? Number(screen.chainId) : d.chainId,
      deadlineAt: has(screen.durationHrs) ? Date.now() + Number(screen.durationHrs) * 3_600_000 : d.deadlineAt,
      takeProfitPct: has(screen.goalPct) ? Number(screen.goalPct) : d.takeProfitPct
    };
  });
  return { ...session, drafts };
}

export default function IntentAIPanel({ defaultChainId = 42161, onDraftReady, walletRuntime = null, tokenApprovals = null }) {
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
  const [screen, setScreen] = useState(null);
  const [showExtInfo, setShowExtInfo] = useState(false);
  /*
   * Phase 94 — connectivity is read from the browser, never guessed. `online`
   * starts optimistic so a test harness or an SSR pass does not paint a false
   * "you are offline". The queue holds intents the user already confirmed;
   * nothing in it has been sent, and nothing sends itself.
   */
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [offlineQueue, setOfflineQueue] = useState([]);
  /* Phase 88 — the honest answer when a request is really about money. */
  const [rampNotice, setRampNotice] = useState(null);
  const [policyInput, setPolicyInput] = useState({
    maxCapitalUsd: 1000, maxTransactionUsd: 200, maxLossUsd: 100, maxLeverage: 2,
    allowedChains: '42161,8453', allowedProtocols: 'swap', allowedAssets: 'USDC,ETH,BTC', durationMin: 60
  });
  const threadRef = useRef(null);
  const inputRef = useRef(null);
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
    setGate(null); setRisk(null); setReceipt(null); setGateAction(null); setScreen(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, mode, externalAgentCatalog]);

  /* Keep the newest message in view — a chat that hides the answer is broken. */
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages?.length]);

  /*
   * Phase 94 — the panel follows the real connection state. Going offline
   * changes only what we SAY; it never flushes, retries or executes anything.
   * Coming back online does not send the queue either: the user re-confirms.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  /* The one place the offline strip reads its words from. */
  const connection = useMemo(
    () => offlineStatus({ online, queue: offlineQueue, now: Date.now() }),
    [online, offlineQueue]
  );

  /*
   * Phase 90 — the fee line for whatever is currently on the confirmation
   * screen. It is derived, not stored, so an edit to the amount moves the fee
   * in the same render: the number the user approves is the number we quote.
   * `computeFee` refuses a missing or over-maximum rate, and that refusal is
   * shown rather than swallowed.
   */
  const feeQuote = useMemo(() => {
    const notional = Number(screen?.amountUsd);
    if (!Number.isFinite(notional) || notional <= 0) return null;
    return computeFee({ notional, symbol: screen?.fromSymbol || 'USD' });
  }, [screen?.amountUsd, screen?.fromSymbol]);

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

  /** One chat turn — shared by the composer and every quick-reply chip. */
  function sendText(text) {
    const value = String(text || '').trim();
    if (!value || session?.status === 'STOPPED') return;
    const { session: after } = chatTurn({ ...session }, value, {
      defaultChainId,
      externalAgents: Array.isArray(externalAgentCatalog?.candidates) ? externalAgentCatalog.candidates : [],
      externalAgentsSource: externalAgentCatalog?.dataStatus === 'live' ? 'server-catalog' : 'unavailable'
    });
    setSession(after);
    const last = after?.messages?.at(-1);
    const drafted = Boolean(last?.payload?.drafts?.length || last?.payload?.draft || last?.payload?.plan);

    /*
     * Phase 88 — the fiat boundary, checked where it cannot cause a false
     * refusal. If the parser turned the sentence into a real crypto-to-crypto
     * draft, the request was never about money and we say nothing. If it did
     * NOT, and the sentence is about a bank, a card or a national currency,
     * the user gets the plain answer: we do not move real money, here is what
     * we can do instead. No hopeful link, no "coming soon".
     */
    if (drafted) {
      setRampNotice(null);
    } else {
      const detection = detectFiatIntent({ text: value, intent: last?.payload?.intent || null });
      const boundary = fiatBoundaryResponse({ detection });
      setRampNotice(boundary.applies ? boundary : null);
    }

    if (last && (last.type === 'ready-for-confirmation' || last.type === 'prepared-draft')) {
      openInteractiveScreen(last.payload, after);
    } else if (last && last.type === 'next-step-ready') {
      openInteractiveScreen(last.payload, after);
    }
  }

  function handleSend(e) {
    e?.preventDefault();
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');
    sendText(text);
  }

  /** Open the interactive confirmation screen for a prepared plan/draft. */
  function openInteractiveScreen(payload, sessionArg) {
    const target = sessionArg || session;
    const nextScreen = screenFromPayload(payload, target);
    if (!nextScreen.draftId && !payload?.termsHash) return;
    const drafts = payload?.drafts || [];
    const order = payload?.order || (drafts[0] ? { ...drafts[0].order } : payload?.draft ? { ...payload.draft } : null);
    if (!order && !nextScreen.draftId) return;
    if (order) {
      const opened = openConfirmationGate({ order, termsHash: payload?.termsHash });
      if (opened.ok) {
        setGate(opened.gate);
        setRisk(evaluateRisk({
          slippagePct: order.slippagePct || 0.5,
          priceImpactPct: order.priceImpactPct || 0
        }));
      }
    }
    setReceipt(null);
    setGateAction(null);
    setScreen(nextScreen);
  }

  /* ---------- interactive screen field editing ---------- */

  function updateScreen(field, value) {
    setScreen((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value, modified: true };
      next.errors = validateScreen(next);
      return next;
    });
  }

  function toggleScreenTool(toolId) {
    setScreen((prev) => {
      if (!prev) return prev;
      return { ...prev, modified: true, tools: { ...prev.tools, [toolId]: !prev.tools[toolId] } };
    });
  }

  /* ---------- Confirmation Gate actions (fixed wiring) ---------- */

  /**
   * CONFIRM runs the REAL execution path: executeConfirmed → Confirmation
   * Gate → Guardian → session key → submit → honest receipt. REJECT and
   * CANCEL record the decision; REAUTHORIZE re-opens the gate from the
   * current (possibly edited) draft so the cycle never dead-ends.
   */
  function handleGateAction(action) {
    if (!gate && !screen) return;
    const decided = gate ? decideGate(gate, action, { currentTerms: gate.lockedTerms }) : null;
    if (decided?.gate) setGate(decided.gate);
    setGateAction(decided?.action || action);

    if (action === 'REAUTHORIZE') {
      // Re-open from the current screen values (with the user's edits).
      reopenGate();
      setReceipt({ status: 'reauthorize', confirmed: false });
      return;
    }
    if (action === 'REJECT') {
      setReceipt({ status: 'rejected', confirmed: false });
      const res = executeConfirmed(session, { action: 'REJECT', draftId: screen?.draftId });
      setSession(res.session);
      return;
    }
    if (action === 'CANCEL') {
      setReceipt({ status: 'cancelled', confirmed: false });
      const res = executeConfirmed(session, { action: 'CANCEL', draftId: screen?.draftId });
      setSession(res.session);
      return;
    }
    if (action === 'CONFIRM') {
      const allowed = decided ? assertGateAllowsSubmit(decided.gate) : { ok: true };
      if (!allowed.ok) { setReceipt({ status: 'unconfirmed', confirmed: false }); return; }
      void runExecution();
    }
  }

  /** Re-open the Confirmation Gate from the current draft + screen edits. */
  function reopenGate() {
    const updated = applyScreenEdits(session, screen);
    const draft = (updated.drafts || []).find((d) => d.id === (screen?.draftId || d.id))
      || (updated.drafts || []).at(-1);
    if (!draft) return;
    const opened = openConfirmationGate({ order: draft });
    if (!opened.ok) return;
    setGate(opened.gate);
    setRisk(evaluateRisk({
      slippagePct: draft.slippagePct || 0.5,
      priceImpactPct: draft.priceImpactPct || 0
    }));
    setGateAction(null);
    setSession(updated);
  }

  /**
   * Final confirm from the interactive screen: apply the user's edits (all
   * within the limits), re-open the gate so the locked terms match what is
   * about to run, then execute through the real path.
   */
  function handleFinalConfirm() {
    if (!screen) return;
    if (Object.keys(screen.errors || {}).length) return;
    /*
     * Phase 56 — a value that clears the product ceilings can still break the
     * ACTIVE session policy (the reproduction case: $500 under the $5k product
     * cap but over the $200 L3 policy cap). Say so here, in the user's own
     * language, instead of letting the pipeline answer with "no live venue".
     */
    const violated = checkSessionPolicy({
      amountUsd: screen.amountUsd,
      chainId: screen.chainId,
      protocol: screen.protocol,
      fromSymbol: screen.fromSymbol,
      toSymbol: screen.toSymbol
    }, session?.policy || null);
    if (!violated.ok) {
      const first = violated.violations[0];
      setReceipt({
        status: 'blocked',
        confirmed: false,
        ok: false,
        reason: first.reason,
        reasonKey: first.i18nKey,
        reasonParams: first.params,
        policyViolations: violated.violations
      });
      return;
    }
    const updated = applyScreenEdits(session, screen);
    const draft = (updated.drafts || []).find((d) => d.id === screen.draftId) || (updated.drafts || []).at(-1);
    if (draft) {
      const opened = openConfirmationGate({ order: draft });
      if (opened.ok) {
        setGate(opened.gate);
        setRisk(evaluateRisk({
          slippagePct: draft.slippagePct || 0.5,
          priceImpactPct: draft.priceImpactPct || 0
        }));
      }
    }
    void runExecution(updated);
  }

  /**
   * Execute through executeConfirmed and render the honest receipt.
   *
   * Phase 51: with a wallet connected, the locked terms are signed by the REAL
   * wallet over EIP-1193 before the pipeline runs. Phase 56: whatever comes
   * back, the receipt states the actual reason.
   */
  async function runExecution(sessionArg) {
    const base = sessionArg || session;
    const draftId = screen?.draftId || null;
    const activeGate = gate;

    /*
     * Phase 94 — with no network, the honest move is to stop and say so. The
     * confirmed intent is parked in the queue with status `queued`: no tx
     * hash, no receipt, no authority. It is not sent when the connection
     * returns either — the user re-opens it and confirms again, because the
     * price they agreed to has had time to move.
     */
    if (!online) {
      const enqueued = enqueueIntent({
        queue: offlineQueue,
        intent: {
          draftId,
          terms: activeGate?.lockedTerms || null,
          termsHash: activeGate?.termsHash || null
        },
        confirmation: { userConfirmed: true, decision: 'CONFIRM', at: Date.now() }
      });
      if (enqueued.ok) setOfflineQueue(enqueued.queue);
      setReceipt({
        // Never `completed`, never `submitted` — nothing left the device.
        status: 'unavailable',
        confirmed: false,
        ok: false,
        queued: enqueued.ok,
        reasonKey: enqueued.ok ? 'intentAI.receipt.queued' : 'intentAI.offline.notQueued'
      });
      return;
    }
    const health = activeGate
      ? venueHealth(
        { kind: draftKind(activeGate), chainId: activeGate.lockedTerms?.chainId, protocol: activeGate.lockedTerms?.protocol },
        { walletRuntime }
      )
      : { ok: false, venue: null, reasons: [] };

    let walletSignature = null;
    if (wallet.canSign) {
      const asked = await signIntentWithWallet({
        runtime: walletRuntime,
        terms: { ...(activeGate?.lockedTerms || {}), termsHash: activeGate?.termsHash || null, draftId }
      });
      if (!asked.ok) {
        const explained = explainExecutionFailure({ error: asked.error, policy: base?.policy || null });
        setReceipt({
          status: explained.status,
          confirmed: false,
          ok: false,
          venue: health.venue || null,
          reason: explained.reason,
          reasonKey: explained.i18nKey,
          reasonParams: explained.params
        });
        return;
      }
      walletSignature = asked.signature;
    }

    const result = executeConfirmed(base, {
      action: 'CONFIRM',
      draftId,
      walletSignature,
      walletAccount: wallet.account
    });
    setSession(result.session);
    setGateAction('CONFIRM');
    const rec = reconcile({
      lifecycleStatus: result.receipt?.status || (result.ok ? 'WATCHING' : 'FAILED'),
      observation: {
        confirmed: result.receipt?.confirmed === true,
        filledAmount: result.receipt?.filledAmount ?? 0,
        requestedAmount: Number(activeGate?.lockedTerms?.amountIn ?? screen?.amountUsd ?? 0)
      }
    });
    if (result.ok) {
      /*
       * Phase 90 — the fee the user approved on the preview is re-checked
       * against the fee actually on the receipt. A drift beyond FEE_TOLERANCE
       * is TERMS_CHANGED: the flow halts and asks for reauthorization rather
       * than printing a success with a number nobody agreed to.
       */
      const settled = attachFeeToReceipt({
        receipt: { ...(rec.receipt || {}), feeAmount: result.receipt?.feeAmount ?? null },
        quotedFee: feeQuote
      });
      if (feeQuote?.ok && !settled.ok && settled.error?.code === 'TERMS_CHANGED') {
        setReceipt({
          status: 'reauthorize',
          confirmed: false,
          ok: false,
          venue: health.venue || null,
          receipt: rec.receipt,
          fee: feeQuote,
          feeDrift: settled.drift ?? null,
          reasonKey: settled.i18nKey,
          reasonParams: {}
        });
        return;
      }
      /*
       * The intent is signed and policy-checked, but nothing has been handed
       * to a network unless a real broadcaster produced a transaction hash.
       *
       * Calling that state "submitted" was the last dishonest label in this
       * flow: `confirmAndSubmit` only sets `txHash` when it receives a
       * `broadcastResult`, and no caller supplies one while broadcasting is
       * disabled. Saying "submitted" with `txHash === null` invited the user
       * to go looking for a transaction that does not exist.
       *
       * With a hash: submitted (or completed once the chain confirms).
       * Without one: authorized — signed, policy-checked, not yet broadcast.
       */
      const realTxHash = result.txHash || null;
      const broadcastReady = broadcastEnabled(import.meta.env || {});
      setReceipt({
        status: rec.receipt?.status === 'COMPLETED' && realTxHash
          ? 'completed'
          : realTxHash ? 'submitted' : 'authorized',
        confirmed: rec.receipt?.confirmed === true && Boolean(realTxHash),
        venue: health.venue || null,
        receipt: settled.ok ? settled.receipt : rec.receipt,
        fee: feeQuote?.ok ? feeQuote : null,
        txHash: realTxHash,
        signerKind: result.signerKind || null,
        /* Explain the stop rather than leaving a silent dead end. */
        reasonKey: realTxHash
          ? null
          : broadcastReady ? 'intentAI.receipt.awaitingBroadcast' : 'intentAI.receipt.broadcastDisabled',
        ok: true
      });
      return;
    }
    const explained = result.explain || explainExecutionFailure({
      error: result.error,
      guardianReasons: result.reasons,
      policy: base?.policy || null,
      terms: activeGate?.lockedTerms || null,
      reauthoriseRequired: result.reauthoriseRequired,
      venueReasons: health.reasons
    });
    setReceipt({
      status: result.reauthoriseRequired ? 'reauthorize' : explained.status,
      confirmed: false,
      venue: health.venue || null,
      receipt: rec.receipt,
      reason: explained.reason,
      reasonKey: explained.i18nKey,
      reasonParams: explained.params,
      guardianReasons: explained.reasons,
      ok: false
    });
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
    setGate(null); setRisk(null); setScreen(null);
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
    if (['REVOKE', 'DISCONNECT', 'PAUSE'].includes(action)) { setGate(null); setScreen(null); }
  }

  /** An example chip fills the composer so the user can adapt it before sending. */
  function useExample(text) {
    setInput(text);
    inputRef.current?.focus();
  }

  const msgs = session?.messages || [];
  const preview = session?.policy ? policyPreview(session.policy) : null;
  const l3NeedsConfirm = level === 3 && session?.policy && !session.policy.userConfirmed;

  const visibleMessages = useMemo(() => msgs.filter((m) => m.role !== 'system' || !/^(session\.started|policy\.confirmed)$/.test(m.type)), [msgs]);

  /*
   * Phase 51 — the CONNECTED wallet, described honestly. `canSign` false means
   * the final confirm will report "wallet signature required", not a stub.
   */
  const wallet = useMemo(() => describeWalletRuntime(walletRuntime || {}), [walletRuntime]);

  /*
   * Phase 56 — the ACTIVE session-policy ceilings. The product ceilings
   * ($400k / $5k / 60% / 30 days) are not the only limits that bind: an L3
   * session policy is usually much tighter, and the user must see it BEFORE
   * confirming, not discover it inside a rejected receipt.
   */
  const policyCaps = useMemo(() => sessionPolicyCaps(session?.policy || null), [session?.policy]);
  const policyCheck = useMemo(() => (screen
    ? checkSessionPolicy({
      amountUsd: screen.amountUsd,
      chainId: screen.chainId,
      protocol: screen.protocol,
      fromSymbol: screen.fromSymbol,
      toSymbol: screen.toSymbol
    }, session?.policy || null)
    : { ok: true, caps: policyCaps, violations: [] }),
  [screen, session?.policy, policyCaps]);
  const policyViolations = policyCheck.violations || [];

  /*
   * Phase 61 — goal progress is only shown when it is ATTESTED. The session
   * carries an attested balance observation only when a real provider has
   * confirmed it; without one the bar renders an explicit "unknown" instead
   * of an empty bar that would read as "0% done".
   */
  const goalProgressView = useMemo(() => {
    const attested = session?.goalMeta?.attestedBalance || null;
    const target = Number(session?.goalMeta?.capital);
    if (!attested || !Number.isFinite(target) || target <= 0) return null;
    const computed = goalProgress({
      targetCapital: target,
      currentBalance: attested,
      capitalUsd: session?.goalMeta?.initialCapital ?? null
    });
    if (computed?.progressComputable !== true) return null;
    return { progressPct: computed.progressPct, source: attested.providerId || null };
  }, [session?.goalMeta]);

  const confirmBlocked = Object.keys(screen?.errors || {}).length > 0
    || policyViolations.length > 0
    || session?.status === 'STOPPED';

  return (
    <motion.section className="card ia-panel ia-chat" variants={riseIn} initial="hidden" animate="show">
      <p className="section-label" style={{ marginBottom: 6 }}>{t('intentAI.title')}</p>
      <p className="muted" style={{ fontSize: 12.2, margin: '0 0 10px', lineHeight: 1.7 }}>
        {t('intentAI.subtitle', { summary: describeLevel(level).summary, version: INTENT_AI_VERSION })}
      </p>

      <div className="card-inner" style={{ background: 'rgba(0,229,255,0.06)', padding: 10, borderRadius: 10, marginBottom: 10 }}>
        <div className="row-between" style={{ gap: 8 }}>
          <p className="faint" style={{ fontSize: 10.5, margin: 0 }}>{t('intentAI.mode.title', { defaultValue: 'Primary mode' })}</p>
          <button
            type="button"
            className="ia-info-btn"
            onClick={() => setShowExtInfo(true)}
            aria-label={t('intentAI.externalInfo.button')}
            title={t('intentAI.externalInfo.button')}
            data-testid="external-agent-info-button"
          >
            ⓘ
          </button>
        </div>
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

      {session?.status === 'STOPPED' && (
        <p className="notice" style={{ color: 'var(--bad, #ff6b6b)' }}>
          {t('intentAI.stop.active')}
        </p>
      )}

      {/*
        Phase 83 — the token permissions the wallet has already handed out.
        Read-only plus one intent: Revoke raises a plan that still has to go
        through the same confirmation as any other transaction. Rendered only
        when an inventory was actually supplied, so the offline panel is
        unchanged.
      */}
      {Array.isArray(tokenApprovals) && (
        <TokenApprovals
          entries={tokenApprovals}
          onRevoke={(plan) => {
            if (plan?.ok === true) setInput(`revoke ${plan.symbol || ''} ${plan.spender}`.trim());
          }}
        />
      )}

      {/* Live countdown for a timed goal the user set and confirmed. */}
      {session?.goalDeadline && (
        <GoalCountdown
          deadline={session.goalDeadline}
          goalPct={session.goalMeta?.pct ?? null}
          capitalUsd={session.goalMeta?.capital ?? null}
          progressPct={goalProgressView?.progressPct ?? null}
          progressSource={goalProgressView?.source ?? null}
        />
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

      {/* Practical prompt examples — one collapsible section per route. */}
      <details className="ia-examples" style={{ marginBottom: 10, fontSize: 12 }}>
        <summary className="muted">{t('intentAI.examples.title')}</summary>
        <div className="ia-examples-grid">
          {['swap', 'bridge', 'send', 'goal', 'analyze'].map((group) => (
            <div key={group} className="ia-example-group">
              <p className="faint" style={{ fontSize: 10.5, margin: '0 0 4px' }}>{t(`intentAI.examples.${group}.title`)}</p>
              {[1, 2, 3].map((n) => {
                const text = t(`intentAI.examples.${group}.e${n}`);
                if (!text || text.startsWith('intentAI.')) return null;
                return (
                  <button key={n} type="button" className="ia-example-chip" onClick={() => useExample(text)}>
                    {text}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </details>

      <div className="intent-ai-thread" ref={threadRef}>
        {visibleMessages.length === 0 && (
          <p className="muted" style={{ fontSize: 12 }}>{t('intentAI.chat.try')}</p>
        )}
        {visibleMessages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            onDraftReady={onDraftReady}
            onQuickReply={sendText}
            onOpenGate={openInteractiveScreen}
          />
        ))}
      </div>

      {/* Interactive confirmation screen: edit values, set tool permissions,
          then confirm — or answer in chat. */}
      {screen && level >= 2 && (
        <div className="card-inner ia-confirm-screen" data-testid="interactive-confirmation-screen">
          <div className="row-between" style={{ gap: 8, marginBottom: 6 }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t('intentAI.confirm.title')}</p>
            {screen.modified && <span className="ia-badge-edit">{t('intentAI.confirm.edited')}</span>}
          </div>

          <div className="ia-confirm-grid">
            <label className="field">
              <span className="field-label">{t('intentAI.confirm.amount')}</span>
              <input
                type="number"
                min="0"
                inputMode="decimal"
                value={screen.amountUsd}
                onChange={(e) => updateScreen('amountUsd', e.target.value === '' ? '' : Number(e.target.value))}
                aria-invalid={Boolean(screen.errors.amountUsd)}
              />
              <small className="ia-hint">{t('intentAI.limits.hintAmount', { limit: INTENT_LIMITS.maxTotalInputUsd.toLocaleString() })}</small>
              <small className="ia-hint">{t('intentAI.limits.hintPerTx', { limit: INTENT_LIMITS.maxPerTransactionUsd.toLocaleString() })}</small>
              {/* Phase 56 — the ACTIVE session policy, shown next to the product ceilings. */}
              {policyCaps?.maxTransactionUsd != null && (
                <small className="ia-hint" data-testid="session-policy-per-tx">
                  {t('intentAI.policyLimits.hintPerTx', { limit: policyCaps.maxTransactionUsd.toLocaleString() })}
                </small>
              )}
              {policyCaps?.maxCapitalUsd != null && (
                <small className="ia-hint" data-testid="session-policy-capital">
                  {t('intentAI.policyLimits.hintCapital', { limit: policyCaps.maxCapitalUsd.toLocaleString() })}
                </small>
              )}
              {screen.errors.amountUsd && (
                <small className="ia-limit-warning">{t(`intentAI.limits.${screen.errors.amountUsd}`, { value: Number(screen.amountUsd).toLocaleString(), limit: INTENT_LIMITS.maxPerTransactionUsd.toLocaleString() })}</small>
              )}
            </label>

            <label className="field">
              <span className="field-label">{t('intentAI.confirm.duration')}</span>
              <input
                type="number"
                min="0"
                inputMode="decimal"
                placeholder={t('intentAI.confirm.durationPlaceholder')}
                value={screen.durationHrs ?? ''}
                onChange={(e) => updateScreen('durationHrs', e.target.value === '' ? null : Number(e.target.value))}
                aria-invalid={Boolean(screen.errors.durationHrs)}
              />
              <small className="ia-hint">{t('intentAI.limits.hintDuration', { days: INTENT_LIMITS.maxGoalDurationDays })}</small>
              {screen.errors.durationHrs && (
                <small className="ia-limit-warning">{t(`intentAI.limits.${screen.errors.durationHrs}`, { days: INTENT_LIMITS.maxGoalDurationDays })}</small>
              )}
            </label>

            <label className="field">
              <span className="field-label">{t('intentAI.confirm.goal')}</span>
              <input
                type="number"
                min="0"
                max={INTENT_LIMITS.maxGoalPct}
                inputMode="decimal"
                placeholder={t('intentAI.confirm.goalPlaceholder')}
                value={screen.goalPct ?? ''}
                onChange={(e) => updateScreen('goalPct', e.target.value === '' ? null : Number(e.target.value))}
                aria-invalid={Boolean(screen.errors.goalPct)}
              />
              <small className="ia-hint">{t('intentAI.limits.hintGoal', { pct: INTENT_LIMITS.maxGoalPct })}</small>
              {screen.errors.goalPct && (
                <small className="ia-limit-warning">{t(`intentAI.limits.${screen.errors.goalPct}`, { value: screen.goalPct, limit: INTENT_LIMITS.maxGoalPct })}</small>
              )}
            </label>

            <div className="field">
              <span className="field-label">{t('intentAI.confirm.route')}</span>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {screen.fromSymbol || '—'} → {screen.toSymbol || '—'} · {t('intentAI.confirm.chain')}: {screen.chainId || '—'}
              </p>
              {gate?.termsHash && <small className="ia-hint">{t('intentAI.gate.termsHash')}: {gate.termsHash?.slice(0, 12)}</small>}
              {risk && (
                <small className="ia-hint">{t('intentAI.risk.summary', { level: risk.level, decision: risk.decision })}</small>
              )}
            </div>
          </div>

          {/* Phase 90 — the fee, on the preview, before anything is approved:
              the percentage, the amount, and what is left afterwards. */}
          {feeQuote && (
            <div className="ia-fee-line" data-testid="preview-fee-line">
              <span className="field-label">{t('intentAI.fee.title')}</span>
              {feeQuote.ok ? (
                <>
                  <span data-testid="preview-fee-amount">
                    {t('intentAI.fee.line', {
                      percent: feeQuote.percent,
                      amount: feeQuote.feeAmount,
                      symbol: feeQuote.symbol || ''
                    })}
                  </span>
                  <small className="ia-hint" data-testid="preview-fee-net">
                    {t('intentAI.fee.net', { amount: feeQuote.netAmount, symbol: feeQuote.symbol || '' })}
                  </small>
                </>
              ) : (
                <span className="ia-limit-warning">{t(feeQuote.i18nKey)}</span>
              )}
            </div>
          )}

          {/* Tool permissions — the user decides what the agents may use. */}
          <div className="ia-tools-box">
            <p className="muted" style={{ fontSize: 11.5, margin: '0 0 6px' }}>{t('intentAI.confirm.toolsTitle')}</p>
            <div className="ia-check-row">
              {FLOW_TOOL_SUGGESTIONS.map((tool) => (
                <label key={tool.id} className="ia-check">
                  <input
                    type="checkbox"
                    checked={Boolean(screen.tools[tool.id])}
                    onChange={() => toggleScreenTool(tool.id)}
                  />
                  <span>{t(`intentAI.confirm.tool.${tool.key}`)}</span>
                </label>
              ))}
            </div>
            <small className="ia-hint">{t('intentAI.confirm.toolsNote')}</small>
          </div>

          {/* Phase 56 — a session-policy breach is named here and locks the
              final confirm, instead of surfacing later as "no live venue". */}
          {policyViolations.length > 0 && (
            <div className="ia-limit-warning" data-testid="session-policy-violation" style={{ marginTop: 8 }}>
              <strong style={{ display: 'block' }}>{t('intentAI.policyLimits.violationTitle')}</strong>
              {policyViolations.map((violation) => (
                <small key={violation.code} style={{ display: 'block' }}>
                  {t(violation.i18nKey, violation.params)}
                </small>
              ))}
            </div>
          )}

          <div className="ia-controls" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="ia-ctl ia-go"
              disabled={confirmBlocked}
              onClick={handleFinalConfirm}
              data-testid="final-confirm-button"
            >
              {t('intentAI.confirm.final')}
            </button>
            {GATE_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                className={`ia-ctl ${action === 'CONFIRM' ? 'ia-go' : action === 'REJECT' ? 'ia-danger' : action === 'REAUTHORIZE' ? 'ia-cool' : ''}`}
                disabled={action === 'CONFIRM' && gateAction === 'CONFIRM' && receipt?.ok}
                onClick={() => handleGateAction(action)}
              >
                {t(`intentAI.gate.${action.toLowerCase()}`)}
              </button>
            ))}
          </div>
          {Object.keys(screen.errors || {}).length > 0 && (
            <small className="ia-limit-warning" style={{ display: 'block', marginTop: 6 }}>
              {t('intentAI.confirm.fixLimits')}
            </small>
          )}
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
          {/* Phase 56 — the receipt says WHY, with the real reason. */}
          {receipt.reasonKey && (
            <p style={{ fontSize: 12, margin: '4px 0 0' }} data-testid="receipt-reason">
              {t(receipt.reasonKey, receipt.reasonParams || {})}
            </p>
          )}
          {/* Phase 90 — the same fee, restated on the receipt in the same
              units, so the preview and the record can be compared. */}
          {receipt.fee?.ok && (
            <p className="faint" style={{ fontSize: 11.5, margin: '4px 0 0' }} data-testid="receipt-fee-line">
              {t('intentAI.fee.onReceipt', {
                amount: receipt.fee.feeAmount,
                symbol: receipt.fee.symbol || '',
                percent: receipt.fee.percent
              })}
            </p>
          )}
          {receipt.txHash && (
            <p className="faint" style={{ fontSize: 11.5, margin: '4px 0 0' }} data-testid="receipt-tx-hash">
              {t('intentAI.receipt.txHash', { hash: receipt.txHash })}
            </p>
          )}
          {/* Phase 94 — a queued intent is a promise to ask again, not a
              promise to send. It carries no hash and no receipt. */}
          {receipt.queued && (
            <p className="faint" style={{ fontSize: 11.5, margin: '4px 0 0' }} data-testid="receipt-queued-note">
              {t('intentAI.offline.reviewNote')}
            </p>
          )}
        </div>
      )}

      {/* Phase 88 — the honest fiat boundary. Shown when the user asked us to
          move real money, which we do not do, with what we CAN do next to it. */}
      {rampNotice?.applies && (
        <div className="ia-ramp-notice" role="note" data-testid="fiat-ramp-notice">
          <p className="muted" style={{ fontSize: 12, margin: '0 0 4px' }}>{t('intentAI.ramp.title')}</p>
          <p style={{ fontSize: 12.5, margin: 0 }} data-testid="fiat-ramp-message">
            {t(rampNotice.i18nKey)}
          </p>
          <small className="ia-hint" data-testid="fiat-ramp-alternative">
            {t(rampNotice.alternativeI18nKey)}
          </small>
        </div>
      )}

      {/* Phase 94 — the connection, stated plainly. Offline says nothing was
          sent; a waiting queue says how many intents are parked, never that
          any of them ran. */}
      <div
        className={`ia-connection${connection.online ? ' is-online' : ''}`}
        role="status"
        data-testid="offline-status"
        data-online={connection.online ? 'true' : 'false'}
      >
        <span className="ia-connection-dot" aria-hidden="true" />
        <small>{t(connection.i18nKey, { count: connection.queued })}</small>
        {connection.queued > 0 && (
          <small className="ia-hint" data-testid="offline-queue-note">{t('intentAI.offline.reviewNote')}</small>
        )}
      </div>

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

      <form onSubmit={handleSend} className="ia-composer">
        <input
          ref={inputRef}
          placeholder={t('intentAI.chat.placeholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={session?.status === 'STOPPED'}
        />
        <button type="submit" className="ia-send" disabled={!input.trim()}>{t('intentAI.chat.send')}</button>
        {level >= 2 && (
          <button type="button" className="ia-ctl ia-danger" onClick={handleEmergencyStop} title={t('intentAI.stop.title')}>
            {t('intentAI.stop.button')}
          </button>
        )}
      </form>

      {/* External-agent mode explained: how it works, its security boundaries,
          and how the interaction is scoped. */}
      {showExtInfo && (
        <div
          className="ia-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t('intentAI.externalInfo.title')}
          onClick={() => setShowExtInfo(false)}
          data-testid="external-agent-info-modal"
        >
          <div className="ia-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ia-modal-head">
              <strong>{t('intentAI.externalInfo.title')}</strong>
              <button type="button" className="ia-modal-close" onClick={() => setShowExtInfo(false)} aria-label={t('intentAI.externalInfo.close')}>✕</button>
            </div>
            <div className="ia-modal-body">
              <p className="muted" style={{ fontSize: 12, margin: '0 0 6px', lineHeight: 1.7 }}>{t('intentAI.externalInfo.intro')}</p>
              <p className="faint" style={{ fontSize: 10.5, margin: '8px 0 4px' }}>{t('intentAI.externalInfo.howTitle')}</p>
              <p className="muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.7 }}>{t('intentAI.externalInfo.howBody')}</p>
              <p className="faint" style={{ fontSize: 10.5, margin: '8px 0 4px' }}>{t('intentAI.externalInfo.securityTitle')}</p>
              <ul className="muted" style={{ fontSize: 12, margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                <li>{t('intentAI.externalInfo.securityPassport')}</li>
                <li>{t('intentAI.externalInfo.securityNoCredentials')}</li>
                <li>{t('intentAI.externalInfo.securityScoped')}</li>
                <li>{t('intentAI.externalInfo.securityGuardian')}</li>
                <li>{t('intentAI.externalInfo.securityGate')}</li>
                <li>{t('intentAI.externalInfo.securityReadonly')}</li>
              </ul>
              <p className="faint" style={{ fontSize: 10.5, margin: '8px 0 4px' }}>{t('intentAI.externalInfo.interactionTitle')}</p>
              <p className="muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.7 }}>{t('intentAI.externalInfo.interactionBody')}</p>
              <p className="muted" style={{ fontSize: 11.5, margin: '10px 0 0', lineHeight: 1.7 }}>{t('intentAI.readiness.secretManagerStandIn')}</p>
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
}

function draftKind(gate) {
  const action = gate?.lockedTerms?.protocol || 'swap';
  return action === 'futures' ? 'futures_open' : 'swap';
}

function MessageBubble({ msg, onDraftReady, onQuickReply, onOpenGate }) {
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
      <MessageContent msg={msg} onDraftReady={onDraftReady} onQuickReply={onQuickReply} onOpenGate={onOpenGate} />
    </div>
  );
}

function MessageContent({ msg, onDraftReady, onQuickReply, onOpenGate }) {
  const { t } = useTranslation();
  if (msg.role === 'user') return <span>{msg.text}</span>;
  const { type, payload = {} } = msg;

  if (type === 'conversation') {
    if (payload.flowStart) {
      return (
        <div style={{ whiteSpace: 'pre-line' }}>
          <div>{t('intentAI.chat.welcome')}</div>
          <div className="ia-chips" style={{ marginTop: 6 }}>
            {FLOW_TASK_SUGGESTIONS.map((task) => (
              <button
                key={task.id}
                type="button"
                className="ia-chip"
                onClick={() => onQuickReply?.(t(`intentAI.flow.answers.task.${task.key}`))}
              >
                {t(`intentAI.flow.tasks.${task.key}`)}
              </button>
            ))}
          </div>
        </div>
      );
    }
    const fallbackText = t(`intentAI.chat.${payload.conversationType}`);
    return (
      <div style={{ whiteSpace: 'pre-line' }}>
        {fallbackText}
      </div>
    );
  }

  if (type === 'clarifications-needed') {
    // Guided-flow question (one at a time) with quick-reply chips.
    if (payload.flow?.step) {
      return <FlowQuestion flow={payload.flow} retry={payload.retry} onQuickReply={onQuickReply} />;
    }
    const isUnclear = payload.clarifications?.some(c => c === 'ACTION_UNCLEAR' || c === 'NO_INTENT' || c === 'EMPTY_INPUT');
    const hasMissingFields = payload.clarifications?.some(c => c === 'AMOUNT_MISSING' || c === 'CHAIN_UNCLEAR' || c === 'FROM_ASSET_MISSING' || c === 'TO_ASSET_MISSING');
    let msgText = '';
    if (isUnclear) {
      msgText = t('intentAI.chat.help');
    } else if (hasMissingFields) {
      msgText = t('intentAI.chat.clarifyMissing');
    } else {
      msgText = t('intentAI.chat.help');
    }
    return (
      <div style={{ whiteSpace: 'pre-line' }}>
        {msgText}
      </div>
    );
  }

  if (type === 'limits-warning') {
    return (
      <div className="ia-limit-box" data-testid="limits-warning">
        <div className="ia-limit-title">{t('intentAI.limits.warningTitle')}</div>
        {(payload.violations || []).map((v) => (
          <div key={v.code} className="ia-limit-line">
            {t(`intentAI.limits.${v.code}`, {
              value: Number(v.value).toLocaleString(),
              limit: Number(v.limit).toLocaleString(),
              days: Math.round(Number(v.limit) / 24)
            })}
          </div>
        ))}
        <div className="faint" style={{ marginTop: 4, fontSize: 11 }}>{t('intentAI.limits.friendly')}</div>
      </div>
    );
  }

  if (type === 'agents-analyzing') {
    return (
      <div className="ia-agents" data-testid="agents-analyzing">
        <div className="ia-agents-head">
          <span className="ia-agent-dot" aria-hidden="true" />
          <span className="ia-agent-dot second" aria-hidden="true" />
          <b>{t('intentAI.agents.analyzing')}</b>
        </div>
        <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.6 }}>{t('intentAI.agents.analyzingNote')}</div>
        <div className="ia-agents-roles">
          <span>{t('intentAI.participants.fbt-strategy', { defaultValue: 'fbt.strategy' })}</span>
          <span>⇄</span>
          <span>{t('intentAI.participants.fbt-execution', { defaultValue: 'fbt.execution' })}</span>
        </div>
      </div>
    );
  }

  if (type === 'next-step-ready') {
    const d = payload.draft || {};
    return (
      <div>
        <div><b>{t('intentAI.msg.nextStep', { step: payload.step, total: payload.totalSteps })}</b></div>
        <div className="faint" style={{ marginTop: 3 }}>
          {d.fromSymbol || '—'} → {d.toSymbol || '—'} · {d.amountIn} · {t('intentAI.msg.onChain', { n: d.chainId })}
        </div>
        <div className="faint" style={{ marginTop: 3 }}>{t('intentAI.msg.nextStepConfirm')}</div>
        <div className="ia-chips" style={{ marginTop: 6 }}>
          <button type="button" className="ia-chip ia-yes" onClick={() => onQuickReply?.(t('intentAI.flow.answers.yes'))}>{t('intentAI.flow.yes')}</button>
          <button type="button" className="ia-chip ia-no" onClick={() => onQuickReply?.(t('intentAI.flow.answers.no'))}>{t('intentAI.flow.no')}</button>
        </div>
      </div>
    );
  }

  if (type === 'execution-declined') {
    return <div>{t('intentAI.msg.executionDeclined')}</div>;
  }

  if (type === 'execution-requires-l3') {
    return (
      <div>
        <div>{t('intentAI.msg.executionRequiresL3')}</div>
        <div className="faint" style={{ marginTop: 3 }}>{t('intentAI.msg.executionL3Hint')}</div>
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
    const { selectedStrategy, plan, drafts = [], termsHash, level, targetReality, authorizationScreen, bestRoute, goalDeadline } = payload;
    return (
      <div>
        {bestRoute && (
          <div className="ia-best-route" data-testid="best-route">
            {t('intentAI.agents.result', {
              action: t(`intentAI.flow.tasks.${bestRoute.action === 'goal' ? 'goal' : bestRoute.action}`),
              from: bestRoute.from || '—',
              to: bestRoute.to || '—'
            })}
          </div>
        )}
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
        {goalDeadline && (
          <div className="faint" style={{ marginTop: 5 }}>{t('intentAI.countdown.attached')}</div>
        )}
        {authorizationScreen && <div className="faint" style={{ marginTop: 4 }}>{t('intentAI.msg.authRequired', { defaultValue: 'Financial execution remains locked until this screen is explicitly confirmed.' })}</div>}
        <div className="ia-chips" style={{ marginTop: 6 }}>
          <button type="button" className="ia-chip ia-yes" onClick={() => onQuickReply?.(t('intentAI.flow.answers.yes'))}>{t('intentAI.flow.confirmExecution')}</button>
          <button type="button" className="ia-chip ia-no" onClick={() => onQuickReply?.(t('intentAI.flow.answers.no'))}>{t('intentAI.flow.no')}</button>
        </div>
        {(type === 'ready-for-confirmation' || type === 'prepared-draft') && (
          <button type="button" className="ia-ctl ia-go" style={{ marginTop: 6 }} onClick={() => onOpenGate?.(payload)}>
            {t('intentAI.msg.openGate')}
          </button>
        )}
        {onDraftReady && (
          <button type="button" className="ia-ctl" style={{ marginTop: 6 }} onClick={() => onDraftReady?.({ plan, drafts, termsHash })}>
            {t('intentAI.msg.handOff')}
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

/* ------------------------------------------------------------------ */
/* Guided-flow question with quick replies                              */
/* ------------------------------------------------------------------ */

function FlowQuestion({ flow, retry, onQuickReply }) {
  const { t } = useTranslation();
  const step = flow.step;
  const collected = flow.collected || {};
  const isConfirm = String(step || '').startsWith('CONFIRM_');
  const isExecution = step === 'EXECUTION_CONFIRMATION';

  const questionText = () => {
    if (isExecution) return t('intentAI.flow.executionConfirm');
    if (step === 'CONFIRM_AMOUNT') {
      return t('intentAI.flow.questions.confirmAmount', { amount: Number(collected.amountUsd || 0).toLocaleString() });
    }
    if (step === 'CONFIRM_GOAL') {
      return t('intentAI.flow.questions.confirmGoal', { pct: collected.goalPct });
    }
    if (step === 'CONFIRM_DURATION') {
      const hrs = Number(collected.durationHrs || 0);
      return t('intentAI.flow.questions.confirmDuration', { days: Math.round(hrs / 24), hours: hrs });
    }
    return t(`intentAI.flow.questions.${String(step || 'TASK').toLowerCase()}`);
  };

  return (
    <div className="ia-flow-question" data-testid={`flow-question-${String(step || 'unknown').toLowerCase()}`}>
      {retry && <div className="faint" style={{ marginBottom: 4 }}>{t('intentAI.flow.retry')}</div>}
      <div style={{ whiteSpace: 'pre-line' }}>{questionText()}</div>

      {isConfirm || isExecution ? (
        <div className="ia-chips" style={{ marginTop: 6 }}>
          <button type="button" className="ia-chip ia-yes" onClick={() => onQuickReply?.(t('intentAI.flow.answers.yes'))}>{t('intentAI.flow.yes')}</button>
          <button type="button" className="ia-chip ia-no" onClick={() => onQuickReply?.(t('intentAI.flow.answers.no'))}>{t('intentAI.flow.no')}</button>
        </div>
      ) : null}

      {step === 'TASK' && (
        <div className="ia-chips" style={{ marginTop: 6 }}>
          {FLOW_TASK_SUGGESTIONS.map((task) => (
            <button
              key={task.id}
              type="button"
              className="ia-chip"
              onClick={() => onQuickReply?.(t(`intentAI.flow.answers.task.${task.key}`))}
            >
              {t(`intentAI.flow.tasks.${task.key}`)}
            </button>
          ))}
        </div>
      )}

      {step === 'AMOUNT' && (
        <div className="ia-chips" style={{ marginTop: 6 }}>
          {(flow.suggestions || []).map((s) => (
            <button key={s.value} type="button" className="ia-chip" onClick={() => onQuickReply?.(String(s.value))}>
              {s.value.toLocaleString()}
            </button>
          ))}
        </div>
      )}

      {step === 'GOAL' && (
        <div className="ia-chips" style={{ marginTop: 6 }}>
          {(flow.suggestions || []).map((s) => (
            <button key={s.value} type="button" className="ia-chip" onClick={() => onQuickReply?.(String(s.value))}>
              {s.value}%
            </button>
          ))}
        </div>
      )}

      {step === 'DURATION' && (
        <div className="ia-chips" style={{ marginTop: 6 }}>
          {(flow.suggestions || []).map((s) => (
            <button key={s.value} type="button" className="ia-chip" onClick={() => onQuickReply?.(durationAnswer(s.value, t))}>
              {durationLabel(s.value, t)}
            </button>
          ))}
        </div>
      )}

      {(step === 'FROM' || step === 'TO') && (
        <div className="ia-chips" style={{ marginTop: 6 }}>
          {(flow.suggestions || []).map((s) => (
            <button key={s.id} type="button" className="ia-chip" onClick={() => onQuickReply?.(s.id)}>
              {s.id}
            </button>
          ))}
        </div>
      )}

      {step === 'NETWORK' && (
        <div className="ia-chips ia-chips-wrap" style={{ marginTop: 6 }}>
          {(flow.suggestions || []).map((chain) => (
            <button key={chain.id} type="button" className="ia-chip" onClick={() => onQuickReply?.(chainKeyAnswer(chain.key, t))}>
              {t(`intentAI.flow.chains.${chain.key}`)}
            </button>
          ))}
        </div>
      )}

      {step === 'TOOLS' && (
        <div className="ia-chips ia-chips-wrap" style={{ marginTop: 6 }}>
          <button type="button" className="ia-chip ia-yes" onClick={() => onQuickReply?.(t('intentAI.flow.answers.allTools'))}>{t('intentAI.flow.allTools')}</button>
          <button type="button" className="ia-chip" onClick={() => onQuickReply?.(t('intentAI.flow.answers.swapBridge'))}>{t('intentAI.flow.swapBridge')}</button>
          <button type="button" className="ia-chip" onClick={() => onQuickReply?.(t('intentAI.flow.answers.swapOnly'))}>{t('intentAI.flow.swapOnly')}</button>
          <button type="button" className="ia-chip ia-no" onClick={() => onQuickReply?.(t('intentAI.flow.answers.noTools'))}>{t('intentAI.flow.noTools')}</button>
        </div>
      )}
    </div>
  );
}

function durationLabel(hrs, t) {
  const hours = Number(hrs);
  if (hours % 24 === 0) return t('intentAI.flow.durationDays', { n: hours / 24 });
  return t('intentAI.flow.durationHours', { n: hours });
}

function durationAnswer(hrs, t) {
  const hours = Number(hrs);
  if (hours % 24 === 0) return t('intentAI.flow.answers.durationDays', { n: hours / 24 });
  return t('intentAI.flow.answers.durationHours', { n: hours });
}

function chainKeyAnswer(key, t) {
  return t(`intentAI.flow.answers.chain.${key}`, { defaultValue: key });
}
