/**
 * FBT INTENT OS — Universal AI Operating Agent — Unified Chat Surface V6
 * ---------------------------------------------------------------------------
 * UPGRADE 6 — Conversational Intelligence + Persistent Context + Agent Reliability + Chat UX
 * 
 * Implements all 45 specs:
 * - §1 ConversationState persistent across route changes
 * - §2 Navigation context-preserving (Navigation != New Conversation)
 * - §3 NavigationIntentManager prevents loops
 * - §4 Intent Lifecycle real (CREATED → UNDERSTAND → COLLECT → READY → NAVIGATE/EXECUTE → VERIFY → COMPLETED)
 * - §5 FBT Agent Orchestrator V2
 * - §6 Shared AI Context
 * - §7 "4 months" bug fix via SlotFillingEngine + lastQuestionId
 * - §8 Slot Filling Engine central
 * - §9 Contextual Answer Resolver
 * - §10 Short Answer Understanding
 * - §11 Pronoun / Reference Understanding via ReferenceResolver
 * - §12 Three-level memory L1/L2/L3
 * - §13 Don't ask for info system already knows
 * - §14 Wallet-Aware Intelligence global
 * - §15 Wallet Context Snapshot
 * - §16 Verify before execution
 * - §17 Tool Registry central
 * - §18 Tool Capability Check
 * - §19 Multi-Agent Collaboration
 * - §20 Goal understanding
 * - §21 Progressive Clarification
 * - §22 Conversation State Machine
 * - §23 Chat Scroll redesign
 * - §24 Intelligent Auto Scroll
 * - §25 Streaming without breaking scroll (throttled + RAF + proximity)
 * - §26 Mobile optimization
 * - §27 Thinking Orb replaces text
 * - §28 Thinking State smart
 * - §29 AI Activity Timeline
 * - §30 Error Recovery
 * - §31 Retry Intelligence
 * - §32 Confidence Layer
 * - §33 No Repetition Policy
 * - §34 Response Memory Check
 * - §35 Self-Check
 * - §39 Observability
 * - §40 Quality Metrics
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useMultiChainPortfolio } from '../hooks/useMultiChainPortfolio';
import { solanaAddress, solanaWalletAvailable, connectSolana, getSolanaBalance } from '../lib/solanaWallet';
import {
  aiChat,
  aiExecute,
  aiAutomations,
  aiCreateAutomation,
  aiCreateGoal,
  aiMemory,
  aiPauseAutomation,
  aiDeleteAutomation,
  aiRunAutomation,
  aiExecutionResult,
  aiConfirm,
  aiFeedback
} from '../lib/aiIntentClient';
import { centralIngest } from '../lib/centralClient.js';
import WalletConnectSheet from './WalletConnectSheet';
import {
  createPendingIntent,
  savePendingIntent,
  loadPendingIntent,
  clearPendingIntent,
  resumePendingIntent
} from '../lib/intent-ai/pendingIntent.js';
import {
  formatConnectThanks,
  formatExecutionProgress,
  formatExecutionResult as formatExecResult,
  stripInternalLeaks
} from '../lib/intent-ai/humanResponse.js';
import { humanizeError } from '../lib/intent-ai/errorHumanizer.js';
import { runExecutionPlan, runRebalance } from '../lib/intent-ai/executionRuntime.js';
import { buildBrowserHooks } from '../lib/intent-ai/browserExecution.js';
import '../styles/intent-ai-os.css';

// Existing OS
import { getIntentOS, upgrade7 as upgrade7ns } from '../lib/intent-ai/os/index.js';
import { getCurrentPageContext, clearContextCache } from '../lib/intent-ai/os/contextEngine.js';
import { createRealServices } from '../lib/intent-ai/os/serviceAdapters.js';
import { setCentralWalletState, snapshotFromAppWallet, getCentralWalletState } from '../lib/intent-ai/os/centralWalletState.js';
import { patchSharedState } from '../lib/intent-ai/os/sharedState.js';
import { getSuggestionsForIntent, getSuggestionsForMessage } from '../lib/intent-ai/os/suggestionEngine.js';
import { opsCardPrompt } from '../lib/intent-ai/os/opsCardPrompts.js';
import { useRadioStore } from '../store/useRadioStore.js';
import { getLastActiveTask, getActiveTasks, updateTaskStatus } from '../lib/intent-ai/os/taskContinuity.js';
import { getAllMemory } from '../lib/intent-ai/os/memoryEngine.js';
import { getLogs as getObsLogs, getStats as getObsStats } from '../lib/intent-ai/os/observability.js';
import { getDebugLogs, enableDebug } from '../lib/intent-ai/os/debugDashboard.js';
import { setupGlobalBus, emitEvent, onEvent } from '../lib/intent-ai/os/eventBus.js';
import {
  listMonitors,
  createMonitor as apiCreateMonitor,
  pauseMonitor as apiPauseMonitor,
  resumeMonitor as apiResumeMonitor,
  cancelMonitor as apiCancelMonitor,
  evaluateMonitorNow as apiEvaluateMonitor,
  monitorEngineStatus as apiMonitorEngineStatus,
  parseMonitorRequest
} from '../lib/intent-ai/os/monitorClient.js';
import {
  parseConditionalBuy,
  createConditionalOrder,
  syncOrderWatches,
  orderPreview
} from '../lib/intent-ai/os/conditionalOrder.js';
import { runOpportunityEngine } from '../lib/intent-ai/os/opportunityEngine.js';
import {
  appendConversation,
  appendOperation,
  readHistory
} from '../lib/intent-ai/os/historyStore.js';
import { cardAvailability } from '../lib/intent-ai/os/opsCatalog.js';
import { loadOrders } from '../lib/orders.js';
import { fetchAiProviders, fetchLearningStats } from '../lib/aiGatewayClient.js';
import {
  OperationsPanel,
  HistoryPanel,
  StatusPanel,
  IntelligencePanel,
  MonitorDraftForm,
  OrderDraftForm,
  MonitorCard,
  OpportunityList,
  OrderCard
} from './IntentOpsPanels.jsx';
import { EcosystemPanel } from './IntentEcosystemPanel.jsx';
import { opsText } from '../lib/intent-ai/os/opsPanelStrings.js';

// UPGRADE 6 — New modules
import {
  createConversationState,
  loadConversationState,
  saveConversationState,
  updateRoute,
  setIntent as setConvIntent,
  updateIntentStatus,
  setLastQuestion as setConvQuestion,
  setLastAnswer as setConvAnswer,
  setCollectedSlot,
  setMissingSlots,
  setPendingAction as setConvPending,
  setPendingOffer as setConvOffer,
  setWalletContext as setConvWallet,
  appendMessage as appendConvMessage,
  hasAskedQuestion,
  getSlotValue,
  INTENT_STATUS,
  STATE_MACHINE
} from '../lib/intent-ai/os/upgrade6/conversationState.js';
import { getNavigationManager } from '../lib/intent-ai/os/upgrade6/navigationManager.js';
import { getSlotFillingEngine, parseShortAnswer } from '../lib/intent-ai/os/upgrade6/slotFillingEngine.js';
import { isBareFollowUp, isPageOpenUtterance, PAGE_OPEN_INTENTS } from '../lib/intent-ai/os/upgrade6/followUpResolver.js';
import { getReferenceResolver, getContextualResolver, calculateConfidence, shouldExecute } from '../lib/intent-ai/os/upgrade6/referenceResolver.js';
import { createSharedContext, getOrchestratorV2 } from '../lib/intent-ai/os/upgrade6/sharedContext.js';
import { getWalletContextManager, createWalletSnapshot } from '../lib/intent-ai/os/upgrade6/walletContextManager.js';
import { getToolChecker } from '../lib/intent-ai/os/upgrade6/toolCapabilityChecker.js';
import { getIntentLifecycleManager, INTENT_LIFECYCLE } from '../lib/intent-ai/os/upgrade6/intentLifecycle.js';
import { getStateMachine, getNoRepetitionPolicy, getResponseMemoryCheck, getSelfCheck, STATES } from '../lib/intent-ai/os/upgrade6/stateMachine.js';
import { getObservabilityV2, getQualityMetrics } from '../lib/intent-ai/os/upgrade6/observability.js';
import { getChatScrollManager } from '../lib/intent-ai/os/upgrade6/chatScrollManager.js';
import { busV6, EVENTS_V6 } from '../lib/intent-ai/os/upgrade6/eventBusV2.js';
import { getL1Messages, addL1Message, getL2Tasks, addL2Task, getL3Preferences, addL3Preference, extractL3FromMessage, getAllMemoryV2 } from '../lib/intent-ai/os/upgrade6/memoryV2.js';
import { ThinkingOrb, ThinkingOrbLarge, AIActivityTimeline } from './ai/ThinkingOrb.jsx';
import {
  loadLocalIntentOSState,
  saveLocalIntentOSState,
  hydrateLegacyStateFromIntentOS,
  deriveIntentOSStateFromLegacy,
  shouldSyncToServer,
  bootstrapIntentOSSession,
  persistIntentOSSession,
  ingestUserTurn,
  orchestrateIntent,
  prepareExecution,
  activateMonitoring,
  resumeConversationState,
  parseAnswerValue
} from '../lib/intent-ai/os/upgrade8/index.js';

const CONVERSATION_KEY = 'fbt.ai.os.conversation.v2';
const MAX_SUGGESTIONS = 4;
const DEFAULT_CHAIN = 42161;

function makeId() {
  try { return crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  catch { return `m-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function visibleText(reply, fallback) {
  const raw = reply?.message || reply?.text || fallback || '';
  return stripInternalLeaks(raw) || fallback || '';
}

function isRebalanceKind(type) {
  const t = String(type || '').toUpperCase();
  return t === 'REBALANCE' || t === 'REBALANCE_PORTFOLIO';
}

/* Phase 2 surface — pure mappers for the intelligence block the OS already
 * attaches to every turn. No network, no state, safe to call during render. */
function mapPlanStepsForTimeline(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((s, i) => ({
    id: s?.id || `p7-step-${i}`,
    // Only the public label travels with the step; internal reasoning never
    // leaves the planner (the status view strips it at the source).
    label: s?.label || '',
    status: s?.status === 'running' ? 'active' : (s?.status || 'pending')
  }));
}

function pickSingleQuestion(u7) {
  if (!u7 || u7.ok === false) return null;
  const needy = (u7.contradictions || []).find((c) => c?.contradiction && c?.needsConfirmation && c?.question);
  if (needy) return { text: needy.question, slot: needy.slot || 'confirmation', expectedType: 'confirmation' };
  if (u7.clarification?.shouldAsk === true && u7.clarification?.question?.text) {
    return { text: u7.clarification.question.text, slot: u7.clarification.question.slot || 'text', expectedType: u7.clarification.question.expectedType || 'text' };
  }
  return null;
}

function trimUpgrade7ForMessage(u7) {
  if (!u7 || u7.ok === false) return null;
  // Render slices only: the bubble shows progress, confidence and consensus.
  // Deep intent, graphs and raw agent payloads stay out of React state.
  return {
    plan: u7.plan || null,
    confidence: u7.confidence || null,
    synthesis: u7.synthesis || null,
    agentHealth: u7.agentHealth || null
  };
}

const ConversationRow = memo(function ConversationRow({
  m,
  t,
  locale,
  onConnectWallet,
  onChoose,
  onMonitorAction,
  onMonitorOpportunity,
  onFeedback
}) {
  const [fbSent, setFbSent] = useState(null);
  const fa = locale.startsWith('fa');
  const intel = m.intelligence || null;
  const sources = Array.isArray(intel?.sources) ? intel.sources.filter((s) => s?.url && /^https:/i.test(String(s.url))) : [];
  const showFeedback = m.role === 'ai' && (m.kind === 'assistant' || m.kind === 'result') && m.intentId && !fbSent;
  return (
    <div className={`iaos-msg iaos-${m.role} ${m.kind ? `iaos-kind-${m.kind}` : ''}`}>
      <div className="iaos-bubble">
        <div className="iaos-msg-text">{m.content}</div>
        {m.ui?.type === 'CONNECT_WALLET' ? (
          <button
            type="button"
            className="iaos-btn iss-solid iaos-connect-btn"
            data-testid="intent-ai-connect-wallet"
            onClick={onConnectWallet}
          >
            {t('intentAIOS.connectWallet', { defaultValue: 'اتصال کیف پول' })}
          </button>
        ) : null}
        {Array.isArray(m.choices) && m.choices.length ? (
          <div className="iaos-choices" data-testid="intent-ai-choices">
            {m.choices.map((c) => (
              <button
                key={c.id}
                type="button"
                className="iaos-btn iss-ghost iaos-choice"
                onClick={() => onChoose(m, c)}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
        {m.ui?.type === 'RESULT_CARD' && m.card?.txHash ? (
          <div className="iaos-result-hash" data-testid="intent-ai-tx-hash">{m.card.txHash}</div>
        ) : null}
        {m.kind === 'monitor' && m.monitor ? (
          <MonitorCard monitor={m.monitor} onAction={onMonitorAction} locale={locale} />
        ) : null}
        {m.kind === 'order' && m.order ? (
          <OrderCard order={m.order} locale={locale} />
        ) : null}
        {Array.isArray(m.opportunities) && m.opportunities.length ? (
          <OpportunityList rows={m.opportunities} onMonitor={onMonitorOpportunity} locale={locale} />
        ) : null}
        {(m.detectedIntent || (m.intentType && m.intentType !== 'GENERAL') || m.missingInfo) ? (
          <div className="iaos-multi-ai-badge" data-testid="intent-ai-understanding-badge">
            {m.detectedIntent || (m.intentType && m.intentType !== 'GENERAL') ? (
              <span className="iaos-intent-pill">
                ✦ {locale.startsWith('fa') ? `درخواست: ${m.detectedIntent || m.intentType}` : `Intent: ${m.detectedIntent || m.intentType}`}
              </span>
            ) : null}
            {m.missingInfo ? (
              <span className="iaos-missing-pill">
                ⚠ {m.missingInfo}
              </span>
            ) : null}
          </div>
        ) : null}
        {m.multiAi ? (
          <div className="iaos-multi-ai-badge" data-testid="intent-ai-multi-model-badge">
            <span className="iaos-model-pill">✦ Multi-AI</span>
            {m.multiAi.confidenceScore != null ? (
              <span className="iaos-pill iaos-pill-ok">
                {locale.startsWith('fa') ? 'اطمینان:' : 'Confidence:'} {m.multiAi.confidenceScore}%
              </span>
            ) : null}
            {m.multiAi.riskScore ? (
              <span className={`iaos-pill ${m.multiAi.riskScore === 'HIGH' || m.multiAi.riskScore === 'EXTREME' ? 'iaos-pill-bad' : m.multiAi.riskScore === 'MEDIUM' ? 'iaos-pill-warn' : 'iaos-pill-ok'}`}>
                {locale.startsWith('fa') ? 'ریسک:' : 'Risk:'} {m.multiAi.riskScore}
              </span>
            ) : null}
            {m.multiAi.dataFreshness ? (
              <span className="iaos-pill iaos-pill-ok">
                🟢 {m.multiAi.dataFreshness}
              </span>
            ) : null}
          </div>
        ) : null}
        {m.upgrade7?.plan?.steps?.length ? (
          <AIActivityTimeline steps={mapPlanStepsForTimeline(m.upgrade7.plan.steps)} locale={locale} />
        ) : null}
        {m.upgrade7?.confidence ? (
          <div data-testid="u7-confidence" style={{ marginTop: 8 }}>
            <span className="iaos-conf-meter">
              {m.upgrade7.confidence.display || (fa ? 'اطمینان' : 'Confidence')} · {m.upgrade7.confidence.score}%
            </span>
            {Array.isArray(m.upgrade7.confidence.notices) && m.upgrade7.confidence.notices.length ? (
              <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.85)', marginTop: 4, lineHeight: 1.6 }}>
                {m.upgrade7.confidence.notices.map((n, i) => (<div key={i}>{n}</div>))}
              </div>
            ) : null}
          </div>
        ) : null}
        {m.upgrade7?.synthesis ? (
          m.upgrade7.synthesis.divergence === true ? (
            <div className="iaos-consensus-box" data-testid="u7-divergence">
              <div className="iaos-divergence-warn">⚠ {m.upgrade7.synthesis.warning || (fa ? 'تحلیل‌ها اختلاف دارند.' : 'Analyses disagree.')}</div>
            </div>
          ) : (
            <div className="iaos-consensus-box" data-testid="u7-consensus">
              <strong>{fa ? 'اجماع Agentها' : 'Agent consensus'}</strong>
              <span>
                {(m.upgrade7.synthesis.contributingAgents || []).length} agent{(m.upgrade7.synthesis.contributingAgents || []).length === 1 ? '' : 's'}
                {m.upgrade7.synthesis.agreement != null ? ` · ${Math.round(m.upgrade7.synthesis.agreement * 100)}%` : ''}
                {m.upgrade7.synthesis.stance && m.upgrade7.synthesis.stance !== 'unknown' ? ` · ${m.upgrade7.synthesis.stance}` : ''}
              </span>
              {Array.isArray(m.upgrade7.agentHealth) && m.upgrade7.agentHealth.some((a) => a?.status && a.status !== 'healthy' && a.status !== 'unknown') ? (
                <div className="iaos-divergence-warn">
                  ⚠ {m.upgrade7.agentHealth.filter((a) => a?.status && a.status !== 'healthy' && a.status !== 'unknown').length} {fa ? 'عامل نیازمند توجه' : 'agent(s) need attention'}
                </div>
              ) : null}
            </div>
          )
        ) : null}
        {intel?.uncertainty?.level === 'HIGH' ? (
          <div className="iaos-uncertainty" data-testid="intent-ai-uncertainty">
            ⚠ {fa
              ? 'اطمینان این پاسخ پایین است؛ بر اساس داده‌های فعلی است و قطعی نیست.'
              : 'Confidence in this answer is low; it reflects current data and is not certain.'}
          </div>
        ) : null}
        {sources.length ? (
          <div className="iaos-sources" data-testid="intent-ai-sources">
            <span className="iaos-sources-label">{fa ? 'منابع:' : 'Sources:'}</span>
            {sources.slice(0, 4).map((s, i) => (
              <a
                key={`${s.url}-${i}`}
                className="iaos-source-chip"
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
                title={s.title}
              >
                {s.tier >= 4 ? `☁ ${fa ? 'رسانه اجتماعی' : 'social'}` : (s.title || new URL(s.url).hostname).slice(0, 48)}
              </a>
            ))}
          </div>
        ) : null}
        {showFeedback ? (
          <div className="iaos-feedback-row" data-testid="intent-ai-feedback">
            <button
              type="button"
              className="iaos-fb-btn"
              data-testid="intent-ai-feedback-up"
              aria-label={fa ? 'مفید بود' : 'Helpful'}
              onClick={() => { setFbSent(1); onFeedback?.(m, 1); }}
            >👍</button>
            <button
              type="button"
              className="iaos-fb-btn"
              data-testid="intent-ai-feedback-down"
              aria-label={fa ? 'مفید نبود' : 'Not helpful'}
              onClick={() => { setFbSent(-1); onFeedback?.(m, -1); }}
            >👎</button>
          </div>
        ) : null}
        {fbSent ? (
          <div className="iaos-fb-thanks">{fa ? 'ممنون از بازخوردت!' : 'Thanks for the feedback!'}</div>
        ) : null}
      </div>
    </div>
  );
});

/*
 * Two snapshots describe the same wallet when the facts the assistant reasons
 * about are the same. `createWalletSnapshot` stamps a fresh `snapshotId`,
 * `timestamp` and `snapshotAt` on every call, so a naive `!==` comparison is
 * always "changed" — which is exactly what turned the ingest effect below into
 * a render loop. Only the financial facts are compared.
 */
function sameWalletFacts(a, b) {
  if (!a || !b) return a === b;
  const key = (s) => `${s.address || ''}|${s.solanaAddress || ''}|${s.chainId ?? ''}|${s.canSign ? 1 : 0}|${s.connected ? 1 : 0}|${s.nativeBalance ?? ''}|`
    + (Array.isArray(s.balances) ? s.balances.map((r) => `${r?.symbol}:${r?.amount}`).join(',') : '');
  return key(a) === key(b);
}

function choiceLabel(choice) {
  return choice?.label || choice?.title || choice?.value || choice?.id || 'option';
}

function buildTargetAllocation(optionId, portfolio = {}) {
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const total = Number(portfolio.totalValue) || 0;
  const sorted = [...positions].sort((a, b) => (Number(b?.valueUsd) || 0) - (Number(a?.valueUsd) || 0));
  const top = sorted[0]?.symbol || 'CORE';
  if (!sorted.length || total <= 0) {
    return [
      { symbol: 'BTC', fromPct: 0, toPct: optionId === 'defensive-rebalance' ? 40 : optionId === 'balanced-rotation' ? 35 : 25 },
      { symbol: 'ETH', fromPct: 0, toPct: optionId === 'defensive-rebalance' ? 25 : optionId === 'balanced-rotation' ? 30 : 25 },
      { symbol: 'STABLES', fromPct: 0, toPct: optionId === 'defensive-rebalance' ? 35 : optionId === 'balanced-rotation' ? 20 : 10 }
    ];
  }
  if (optionId === 'defensive-rebalance') {
    return [
      { symbol: top, fromPct: Number(sorted[0]?.weightPct) || 0, toPct: 30 },
      { symbol: 'BTC', fromPct: Number(sorted[1]?.weightPct) || 0, toPct: 30 },
      { symbol: 'STABLES', fromPct: Number(sorted[2]?.weightPct) || 0, toPct: 40 }
    ];
  }
  if (optionId === 'opportunistic-tilt') {
    return [
      { symbol: top, fromPct: Number(sorted[0]?.weightPct) || 0, toPct: 35 },
      { symbol: 'BTC', fromPct: Number(sorted[1]?.weightPct) || 0, toPct: 25 },
      { symbol: 'TACTICAL', fromPct: Number(sorted[2]?.weightPct) || 0, toPct: 20 },
      { symbol: 'STABLES', fromPct: Number(sorted[3]?.weightPct) || 0, toPct: 20 }
    ];
  }
  return [
    { symbol: top, fromPct: Number(sorted[0]?.weightPct) || 0, toPct: 35 },
    { symbol: 'BTC', fromPct: Number(sorted[1]?.weightPct) || 0, toPct: 30 },
    { symbol: 'ETH', fromPct: Number(sorted[2]?.weightPct) || 0, toPct: 20 },
    { symbol: 'STABLES', fromPct: Number(sorted[3]?.weightPct) || 0, toPct: 15 }
  ];
}

function buildRecommendationAction(state, portfolio = {}) {
  const selected = state?.agentState?.lastPresentedOptions?.find?.((item) => item.selected)
    || state?.agentState?.lastPresentedOptions?.[1]
    || null;
  const optionId = selected?.id || 'balanced-rotation';
  const allocation = buildTargetAllocation(optionId, portfolio);
  return {
    type: 'REBALANCE',
    asset: 'PORTFOLIO',
    strategyId: optionId,
    title: selected?.label || 'Balanced rotation',
    impactSummary: selected?.meta?.rationale || 'Reduce concentration and rotate into a more diversified mix.',
    parameters: {
      targetAllocation: allocation,
      horizonMonths: state?.collectedSlots?.timeframe || null,
      riskProfile: state?.collectedSlots?.riskProfile || null
    },
    estimatedGasUsd: 6.5
  };
}

export default function IntentAIUnified({ defaultChainId = DEFAULT_CHAIN }) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language || 'fa';
  const wallet = useWallet();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPage = location.pathname || '/intent';

  // UPGRADE 6 — Initialize all managers
  const convStateRef = useRef(null);
  const navManagerRef = useRef(null);
  const lifecycleRef = useRef(null);
  const walletMgrRef = useRef(null);
  const obsRef = useRef(null);
  const metricsRef = useRef(null);
  const scrollMgrRef = useRef(null);
  const slotEngineRef = useRef(null);
  const refResolverRef = useRef(null);
  const ctxResolverRef = useRef(null);
  const toolCheckerRef = useRef(null);
  const stateMachineRef = useRef(null);
  const noRepeatRef = useRef(null);
  const respCheckRef = useRef(null);
  const selfCheckRef = useRef(null);

  // Initialize once
  if (!convStateRef.current) {
    const bootState = os8StateRef.current || loadLocalIntentOSState('intent-unified');
    const hydrated = hydrateLegacyStateFromIntentOS(bootState);
    const loadedConv = loadConversationState();
    convStateRef.current = (!loadedConv?.messages?.length && hydrated?.messages?.length)
      ? {
          ...loadedConv,
          ...(hydrated?.convStatePatch || {}),
          messages: hydrated.messages
        }
      : loadedConv;
    navManagerRef.current = getNavigationManager();
    lifecycleRef.current = getIntentLifecycleManager();
    walletMgrRef.current = getWalletContextManager();
    obsRef.current = getObservabilityV2();
    metricsRef.current = getQualityMetrics();
    scrollMgrRef.current = getChatScrollManager();
    slotEngineRef.current = getSlotFillingEngine();
    refResolverRef.current = getReferenceResolver();
    ctxResolverRef.current = getContextualResolver();
    toolCheckerRef.current = getToolChecker();
    stateMachineRef.current = getStateMachine();
    noRepeatRef.current = getNoRepetitionPolicy();
    respCheckRef.current = getResponseMemoryCheck();
    selfCheckRef.current = getSelfCheck();
  }

  const [convState, setConvState] = useState(() => convStateRef.current);

  const canReadPortfolio = Boolean(wallet?.isConnected && wallet?.address && !wallet?.locked);
  const multi = useMultiChainPortfolio(canReadPortfolio ? wallet : null);

  // Messages now backed by persistent ConversationState (§1)
  const [messages, setMessages] = useState(() => {
    const persisted = convStateRef.current.messages || [];
    if (persisted.length) return persisted;
    return [{
      id: makeId(),
      role: 'ai',
      content: t('intentAIOS.hello', { defaultValue: 'سلام! من Intent AI هستم. درباره کیف پول، بازار یا هر هدف مالی‌ات صحبت کن.' }),
      kind: 'hello',
      ui: { type: 'TEXT' }
    }];
  });

  const [input, setInput] = useState('');
  const [thinkingState, setThinkingState] = useState('idle'); // §28 smart thinking state
  const [thinking, setThinking] = useState([]); // legacy for fallback
  const [activitySteps, setActivitySteps] = useState([]); // §29 activity timeline
  const [suggestions, setSuggestions] = useState([]);
  // Phase 2: predicted follow-ups ride beside suggestions; the pending
  // question ref binds the user's answer back to the slot that asked.
  const [predictedNext, setPredictedNext] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingExecution, setPendingExecution] = useState(null);
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [walletSheetOpen, setWalletSheetOpen] = useState(false);
  const [memorySummary, setMemorySummary] = useState('');
  const [automations, setAutomations] = useState([]);
  const [autosOpen, setAutosOpen] = useState(false);
  const [solanaTick, setSolanaTick] = useState(0);
  const [solanaRows, setSolanaRows] = useState([]);
  const [conversationId] = useState(() => {
    try {
      const saved = localStorage.getItem(CONVERSATION_KEY);
      if (saved) return saved;
      const id = makeId();
      localStorage.setItem(CONVERSATION_KEY, id);
      return id;
    } catch {
      return makeId();
    }
  });
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);
  const [panel, setPanel] = useState(null);
  const [ecoKind, setEcoKind] = useState('agent');
  const [opsBusy, setOpsBusy] = useState(false);
  const [monitors, setMonitors] = useState([]);
  const [monitorEngineStatus, setMonitorEngineStatus] = useState(null);
  const [serverReachable, setServerReachable] = useState(null);
  const [activeContext, setActiveContext] = useState(null);
  const [aiProviders, setAiProviders] = useState([]);
  /*
   * The fleet is read over the network, so "no rows yet" has two very
   * different meanings and the panel has to be able to tell them apart:
   *   idle    — never asked
   *   loading — asked, answer still on its way
   *   ready   — the gateway answered
   *   error   — the gateway did not answer (network, timeout, throttled)
   * Rendering `[]` alone made the panel announce an outage it had not
   * observed. `providersError` carries the reason so the message can name it.
   */
  const [providersStatus, setProvidersStatus] = useState('idle');
  const [providersError, setProvidersError] = useState(null);
  const [learningStats, setLearningStats] = useState(null);
  const [monitorDraftOpen, setMonitorDraftOpen] = useState(false);
  const [orderDraftOpen, setOrderDraftOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState(null);
  const [histData, setHistData] = useState({ conversations: [], operations: [] });
  const [monitorInitial, setMonitorInitial] = useState(null);
  const [orderInitial, setOrderInitial] = useState(null);
  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false);
  const contextHandlerRef = useRef(null);

  const threadRef = useRef(null);
  const busyRef = useRef(false);
  const resumeLock = useRef(false);
  const sendRef = useRef(null);
  const osRef = useRef(null);
  const pendingU7QuestionRef = useRef(null);
  const prevRouteRef = useRef(currentPage);
  const os8StateRef = useRef(loadLocalIntentOSState('intent-unified'));
  const os8SyncSigRef = useRef('');
  const os8RemoteSyncAtRef = useRef(0);
  const os8HydratedRef = useRef(false);

  // UPGRADE 6 — Persist conversation state on every change
  useEffect(() => {
    convStateRef.current = convState;
    saveConversationState(convState);
  }, [convState]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const remoteBoot = await bootstrapIntentOSSession({ ownerKey: 'intent-unified', hydrateRemote: true });
      if (cancelled || !remoteBoot) return;
      os8StateRef.current = remoteBoot;
      os8HydratedRef.current = true;
      const hydrated = hydrateLegacyStateFromIntentOS(remoteBoot);
      if (hydrated?.messages?.length && (!convStateRef.current?.messages?.length || remoteBoot.lastUpdated > Number(convStateRef.current?.updatedAt || 0))) {
        setMessages((prev) => prev.length > 1 ? prev : hydrated.messages);
        setConvState((prev) => ({
          ...prev,
          ...(hydrated.convStatePatch || {}),
          messages: hydrated.messages,
          currentRoute: remoteBoot.currentRoute || prev.currentRoute,
          previousRoute: remoteBoot.previousRoute || prev.previousRoute,
          updatedAt: Date.now()
        }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // UPGRADE 6 — Route change handling: preserve context, detect return
  useEffect(() => {
    const prev = prevRouteRef.current;
    if (prev !== currentPage) {
      // Navigation preserving context (§2)
      const navCheck = navManagerRef.current.startNavigation({
        source: prev,
        target: currentPage,
        reason: 'route_change',
        intentId: convState.intentId,
        sessionId: convState.sessionId
      });

      if (navCheck.allowed) {
        navManagerRef.current.completeNavigation(navCheck.record.navigationId);
        busV6.emit(EVENTS_V6.NAVIGATION_COMPLETED, { from: prev, to: currentPage, navigationId: navCheck.record.navigationId });

        // Update conversation state route WITHOUT resetting (§2)
        setConvState((prevState) => {
          let next = updateRoute(prevState, currentPage, { reason: 'route_change', intentId: prevState.intentId });
          // If returning to chat from portfolio, handle correctly (§36)
          if (currentPage === '/intent' && prev === '/portfolio') {
            // Check if portfolio analysis was the intent and it was completed
            const lastNav = navManagerRef.current.getHistory().find((n) => n.target === '/portfolio');
            if (lastNav) {
              // Don't repeat navigation, show analysis completed message
              const returnCheck = navManagerRef.current.shouldRepeatAfterReturn({
                previousTarget: '/portfolio',
                currentIntent: next.currentIntent,
                isNewRequest: false,
                isIncomplete: next.intentStatus !== 'completed',
                isNeededForContinuation: false
              });
              if (!returnCheck.allowed) {
                // Will be handled in render as no-repeat
                busV6.emit(EVENTS_V6.CONTEXT_PRESERVED, { reason: 'return_no_repeat', from: prev, to: currentPage });
                metricsRef.current.recordNavigation(false);
              }
            }
          }
          // Restore wallet after navigation (§15)
          walletMgrRef.current.restoreAfterNavigation();
          next = setConvWallet(next, walletMgrRef.current.getCurrent());
          return next;
        });

        obsRef.current.log({ intentId: convState.intentId, type: 'NAVIGATION', payload: { from: prev, to: currentPage } });
      } else {
        // Loop detected
        busV6.emit(EVENTS_V6.NAVIGATION_LOOP_DETECTED, { from: prev, to: currentPage, reason: navCheck.reason });
        metricsRef.current.recordNavigation(true);
      }

      try {
        os8StateRef.current = resumeConversationState(os8StateRef.current, currentPage);
        saveLocalIntentOSState(os8StateRef.current, 'intent-unified');
      } catch {}
      prevRouteRef.current = currentPage;
    }
  }, [currentPage, convState.intentId]);

  // Setup global bus + scroll manager
  useEffect(() => {
    setupGlobalBus();
    const scrollMgr = scrollMgrRef.current;
    if (threadRef.current) {
      scrollMgr.setViewportRef(threadRef);
    }

    const unsubNav = onEvent('navigation.opened', (ev) => {
      const route = ev.payload?.route;
      /*
       * No gating here either. This listener exists so an agent that emits
       * `navigation.opened` without holding a `navigate` reference still
       * moves the router; the old version ran it through the same loop
       * detector as the host handler and could silently drop the trip.
       */
      if (route && route !== currentPage) {
        try { navigate(route); } catch {}
      }
    });

    const unsubScroll = scrollMgr.on((ev) => {
      if (ev.type === 'new_message_while_reading') {
        setShowNewMessageIndicator(true);
      }
      if (ev.type === 'user_scrolled_to_bottom') {
        setShowNewMessageIndicator(false);
      }
      busV6.emit(EVENTS_V6.SCROLL_EVENT, ev);
    });

    return () => {
      try { unsubNav(); } catch {}
      try { unsubScroll(); } catch {}
    };
  }, [navigate, currentPage]);

  const liveModuleServices = useMemo(() => {
    const holdings = (multi?.rows || []).map((r) => ({
      symbol: r.symbol,
      chainId: r.chainId,
      valueUsd: Number.isFinite(Number(r.value)) ? Number(r.value) : null,
      amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
      address: r.address || null
    }));
    const balances = holdings.map((h) => ({ ...h, value: h.valueUsd }));
    const walletSnap = {
      connected: Boolean(wallet?.isConnected && wallet?.address),
      isConnected: Boolean(wallet?.isConnected && wallet?.address),
      canSign: Boolean(wallet?.address && !wallet?.locked),
      address: wallet?.address || null,
      chainId: wallet?.chainId || null,
      balances,
      evmAddresses: wallet?.address ? [wallet.address] : []
    };
    const portfolioSnap = {
      dataStatus: multi?.loading ? 'pending' : (holdings.length ? 'live' : (walletSnap.connected ? 'empty' : 'unavailable')),
      // Only a verified read (live or empty) carries a timestamp; a pending
      // or unavailable snapshot stays bare so freshness reports it missing.
      ...(!multi?.loading && walletSnap.connected ? { fetchedAt: Date.now(), source: 'portfolio' } : {}),
      freshness: multi?.loading ? 'PENDING' : 'FRESH',
      hydrating: Boolean(walletSnap.connected && multi?.loading),
      totalValueUsd: Number.isFinite(Number(multi?.totalValue)) ? Number(multi.totalValue) : null,
      holdings,
      partial: multi?.partial === true
    };
    const real = createRealServices({ wallet: walletSnap, portfolio: portfolioSnap });
    real.walletService = {
      ...real.walletService,
      getContext: async () => walletSnap,
      getBalances: async () => {
        const balStatus = multi?.loading ? 'pending' : (balances.length ? 'live' : (walletSnap.connected ? 'pending' : 'unavailable'));
        return {
          ok: true,
          balances,
          dataStatus: balStatus,
          ...(balStatus === 'live' ? { fetchedAt: Date.now(), source: 'rpc' } : {})
        };
      }
    };
    real.portfolioService = {
      ...real.portfolioService,
      getSummary: async () => portfolioSnap,
      analyze: async ({ holdings: h } = {}) => {
        const list = h || holdings;
        const priced = (list || []).filter((x) => Number.isFinite(Number(x.valueUsd)));
        const total = priced.reduce((s, x) => s + Number(x.valueUsd), 0);
        const sorted = [...(list || [])].sort((a, b) => (Number(b.valueUsd) || 0) - (Number(a.valueUsd) || 0));
        return {
          ok: true,
          totalValueUsd: priced.length ? total : null,
          holdings: list,
          largest: sorted[0] || null,
          concentration: sorted[0] && total ? (Number(sorted[0].valueUsd) / total) * 100 : null,
          dataStatus: list?.length ? 'live' : 'unavailable',
          ...(list?.length ? { fetchedAt: Date.now(), source: 'portfolio' } : {})
        };
      }
    };
    return real;
  }, [wallet, multi]);

  const intentOS = useMemo(() => {
    const os = getIntentOS({
      services: liveModuleServices,
      navigation: {
        /*
         * ─── THE HOST NAVIGATION CONTRACT ─────────────────────────────────
         * Callers in the OS pass the target in TWO shapes and both have to
         * work, because a silent mismatch here is invisible to the user:
         *
         *   · object    — `navigate({ route, params })`  (os/index.js,
         *                 mediaAgent.js, toolRegistry.js)
         *   · positional— `navigate('/signals', params, replace)`
         *                 (navigation-agent, and the plain function form any
         *                 injected host may expose)
         *
         * The old handler destructured ONLY the object shape. When the
         * navigation agent called it positionally the destructure of a string
         * produced `route === undefined`, the guard below returned
         * `{ ok: false }`, and the chat announced a page it never opened.
         * That was the reported «سیگنال نمیاد و تو همون چت می‌مونه».
         * `pickRoute` accepts every shape instead of one of them.
         */
        navigate: async (target, maybeParams, maybeReplace) => {
          const pickRoute = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
          const r = pickRoute(target)
            || pickRoute(target?.route)
            || pickRoute(target?.to)
            || pickRoute(target?.path);
          const params = (target && typeof target === 'object' ? target.params : maybeParams) || {};
          if (!r) return { ok: false, reason: 'NO_ROUTE' };

          /*
           * ─── NO NAVIGATION LIMITS ───────────────────────────────────────
           * This used to run `shouldAllowNavigation` and refuse on
           * `navigation_loop_detected` / `intent_completed`. Those were
           * version-1 guardrails: the conversation state accumulated every
           * route it had ever visited, so after two trips to the same page
           * the assistant permanently refused to open it again — the user
           * tapped «سیگنال» and nothing happened, with no message saying why.
           *
           * Navigation is now unconditional. It is a read-only, always
           * reversible action: the user can come back with one tap, and the
           * conversation state is preserved across the trip either way
           * (updateRoute below). There is nothing to protect against.
           */
          try {
            const navRec = navManagerRef.current.startNavigation({
              source: convStateRef.current.currentRoute,
              target: r,
              reason: convStateRef.current.currentIntent || 'intent_navigation',
              intentId: convStateRef.current.intentId,
              sessionId: convStateRef.current.sessionId
            });
            navigate(r);
            if (navRec?.record?.navigationId) {
              navManagerRef.current.completeNavigation(navRec.record.navigationId);
            }
            emitEvent('navigation.opened', { route: r, params, replace: maybeReplace === true }, 'intent-os');
            busV6.emit(EVENTS_V6.NAVIGATION_STARTED, { route: r, navigationId: navRec?.record?.navigationId || null });
            busV6.emit(EVENTS_V6.NAVIGATION_COMPLETED, { route: r, navigationId: navRec?.record?.navigationId || null });
            // Update conv state
            setConvState((prev) => updateRoute(prev, r, { reason: prev.currentIntent, intentId: prev.intentId }));
            obsRef.current.log({ intentId: convStateRef.current.intentId, type: 'NAVIGATION', payload: { route: r } });
            return { ok: true, route: r, navigationId: navRec?.record?.navigationId || null };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }
      },
      radio: {
        play: (track, queue) => useRadioStore.getState().play(track, queue),
        setPlaying: (v) => useRadioStore.getState().setPlaying(v),
        stop: () => useRadioStore.getState().stop()
      },
      locale
    });
    os.setServices(liveModuleServices);
    osRef.current = os;
    // Setup orchestrator V2 with shared context
    const sharedCtx = createSharedContext({
      conversationState: convStateRef.current,
      currentPage,
      wallet: wallet,
      portfolio: liveModuleServices.portfolioService,
      availableTools: []
    });
    const orchestratorV2 = getOrchestratorV2({ agents: os.agents });
    orchestratorV2.setSharedContext(sharedCtx);
    return os;
  }, [liveModuleServices, navigate, locale, currentPage]);

  const solana = useMemo(() => ({ available: solanaWalletAvailable(), address: solanaAddress() }), [solanaTick]);
  const solanaAddressLive = solana.address || solanaAddress();
  const evmConnected = Boolean(wallet?.isConnected && wallet?.address);
  const solanaConnected = Boolean(solanaAddressLive);
  const walletConnected = evmConnected || solanaConnected;
  const walletCanSign = Boolean((evmConnected && !wallet?.locked) || solanaConnected);

  const aiContext = useMemo(() => {
    const rows = Array.isArray(multi?.rows) ? multi.rows : [];
    const evmRows = rows.map((r) => ({
      symbol: r.symbol,
      chain: r.chainId ?? null,
      chainId: r.chainId ?? null,
      amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
      valueUsd: Number.isFinite(Number(r.value)) ? Number(r.value) : null,
      dataStatus: 'client'
    }));
    const solRows = (solanaRows || []).map((r) => ({
      symbol: r.symbol,
      chain: r.chainId ?? null,
      chainId: r.chainId ?? null,
      amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
      valueUsd: Number.isFinite(Number(r.valueUsd)) ? Number(r.valueUsd) : null,
      dataStatus: 'client'
    }));
    const balances = [...solRows, ...evmRows];
    const holdings = [
      ...solRows.map((r) => ({ symbol: r.symbol, chainId: r.chainId ?? null, valueUsd: r.valueUsd, amount: r.amount })),
      ...rows.map((r) => ({
        symbol: r.symbol,
        chainId: r.chainId ?? null,
        valueUsd: Number.isFinite(Number(r.value)) ? Number(r.value) : null,
        amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : null
      }))
    ];
    const evmTotal = Number.isFinite(Number(multi?.totalValue)) ? Number(multi.totalValue) : null;
    const solTotal = solRows.reduce((s, r) => s + (Number(r.valueUsd) || 0), 0);
    const hydrating = Boolean(walletConnected && Boolean(multi?.loading));
    return {
      wallet: {
        connected: walletConnected,
        isConnected: walletConnected,
        canSign: walletCanSign,
        address: wallet?.address || null,
        chainId: wallet?.chainId || null,
        hydrating,
        connectionStatus: hydrating ? 'HYDRATING' : (walletConnected ? 'CONNECTED' : 'DISCONNECTED'),
        evmAddresses: wallet?.address ? [wallet.address] : [],
        solanaAddresses: solanaAddressLive ? [solanaAddressLive] : []
      },
      portfolio: {
        dataStatus: hydrating ? 'pending' : (canReadPortfolio || solanaRows.length ? (multi?.partial ? 'partial' : 'live') : 'unavailable'),
        ...((canReadPortfolio || solanaRows.length) && !hydrating ? { fetchedAt: Date.now(), source: 'portfolio' } : {}),
        freshness: hydrating ? 'PENDING' : 'FRESH',
        hydrating,
        totalValueUsd: evmTotal != null ? evmTotal + solTotal : (solTotal || null),
        holdings,
        partial: multi?.partial === true
      },
      balances,
      openOrders: [],
      positions: [],
      activeIntents: [],
      activeAutomations: automations || [],
      recentActivity: [],
      conversationSummary: memorySummary || '',
      currentPage,
      currentRoute: currentPage,
      currentTab: getCurrentPageContext(currentPage)?.tab || 'overview',
      currentModule: getCurrentPageContext(currentPage)?.page || null
    };
  }, [wallet, multi, canReadPortfolio, solanaAddressLive, automations, memorySummary, solanaRows, walletConnected, walletCanSign, currentPage]);

  const portfolioContextForOs8 = useMemo(() => ({
    totalValue: aiContext.portfolio?.totalValueUsd ?? null,
    concentrationPct: (() => {
      const holdings = Array.isArray(aiContext.portfolio?.holdings) ? aiContext.portfolio.holdings : [];
      const total = Number(aiContext.portfolio?.totalValueUsd) || 0;
      if (!holdings.length || total <= 0) return null;
      const biggest = Math.max(...holdings.map((row) => Number(row?.valueUsd) || 0));
      return biggest > 0 ? Number(((biggest / total) * 100).toFixed(2)) : null;
    })(),
    positions: (aiContext.portfolio?.holdings || []).map((row) => ({
      symbol: row.symbol,
      valueUsd: row.valueUsd,
      amount: row.amount,
      weightPct: Number(aiContext.portfolio?.totalValueUsd) > 0 && Number.isFinite(Number(row?.valueUsd))
        ? Number((((Number(row.valueUsd) || 0) / Number(aiContext.portfolio.totalValueUsd)) * 100).toFixed(2))
        : null
    }))
  }), [aiContext]);

  /*
   * ─── A STABLE SIGNATURE, BECAUSE THIS EFFECT POSTS ──────────────────────
   * `aiContext` is rebuilt by a `useMemo` whose dependency list contains whole
   * objects (`multi`, `wallet`). Any one of them changing identity per render
   * makes `aiContext` new per render, and this effect used to key on it
   * directly. The effect also called `setConvState`, and `setWalletContext`
   * returns a brand-new state object with a fresh `snapshotId` every time —
   * so the effect re-rendered the component that fed it. Render → effect →
   * setState → render, forever, each turn firing `POST /api/system/state`.
   *
   * Measured on this page before the fix: ~1,700 requests/second, ~10,300 in
   * the first six seconds. That is what a user experiences as «کل اپ ارتباطش
   * با اینترنت خراب میشه»: the WebView's per-origin connection pool is full of
   * our own POSTs, and the server's per-IP budget trips so everything else —
   * prices, portfolio, the Multi-AI fleet read — comes back throttled for
   * minutes at a time.
   *
   * So the effect now keys on a signature of the FACTS rather than on object
   * identity, and the state write is skipped when the wallet facts have not
   * moved. Neither guard depends on an upstream hook behaving well: the loop
   * is structurally impossible even if some other dependency churns again.
   */
  const aiContextSig = useMemo(() => JSON.stringify({
    addr: wallet?.address || null,
    chain: wallet?.chainId ?? null,
    sol: solanaAddressLive || null,
    sign: walletCanSign === true,
    hydrating: aiContext.wallet?.hydrating === true,
    balances: (Array.isArray(aiContext.balances) ? aiContext.balances : [])
      .map((r) => `${r?.symbol}:${r?.amount}`).join('|'),
    total: aiContext.portfolio?.totalValueUsd ?? null,
    dataStatus: aiContext.portfolio?.dataStatus || null,
    route: aiContext.currentRoute || null,
    memory: aiContext.conversationSummary || ''
  }), [aiContext, wallet?.address, wallet?.chainId, solanaAddressLive, walletCanSign]);

  const lastIngestSigRef = useRef(null);
  useEffect(() => {
    if (lastIngestSigRef.current === aiContextSig) return; // nothing moved → nothing to push
    lastIngestSigRef.current = aiContextSig;
    try { centralIngest(aiContext); } catch {}
    try {
      setCentralWalletState(snapshotFromAppWallet(wallet, {
        solanaAddress: solanaAddressLive,
        tokenBalances: aiContext.balances,
        hydrating: aiContext.wallet?.hydrating,
        canSign: walletCanSign,
        source: 'intent-os-ui-v6'
      }));
      patchSharedState('portfolio', aiContext.portfolio, {
        source: 'intent-os-ui-v6',
        freshness: aiContext.portfolio?.freshness || 'FRESH'
      });
      // Update conversation wallet context (§14)
      setConvState((prev) => {
        const next = setConvWallet(prev, createWalletSnapshot({
          address: wallet?.address,
          chainId: wallet?.chainId,
          balances: aiContext.balances,
          canSign: walletCanSign,
          solanaAddress: solanaAddressLive
        }));
        /*
         * Return the SAME reference when only the timestamp would change.
         * React then bails out of the update instead of re-rendering, which is
         * the second half of breaking the cycle — and it also stops
         * `saveConversationState` rewriting localStorage on every frame.
         */
        return sameWalletFacts(prev?.walletSnapshot, next?.walletSnapshot) ? prev : next;
      });
    } catch {}
  }, [aiContextSig, aiContext, wallet, solanaAddressLive, walletCanSign]);

  useEffect(() => {
    const walletContextForOs8 = {
      address: aiContext.wallet?.address || aiContext.wallet?.evmAddresses?.[0] || aiContext.wallet?.solanaAddresses?.[0] || null,
      chainId: aiContext.wallet?.chainId || null,
      chainType: aiContext.wallet?.solanaAddresses?.length ? 'solana' : 'evm',
      connected: aiContext.wallet?.connected === true,
      canSign: aiContext.wallet?.canSign === true,
      lastUpdated: Date.now()
    };
    const derived = deriveIntentOSStateFromLegacy({
      existingState: os8StateRef.current,
      convState,
      messages,
      currentRoute: currentPage,
      previousRoute: convState?.previousRoute || prevRouteRef.current || null,
      walletContext: walletContextForOs8,
      portfolioContext: portfolioContextForOs8,
      pendingExecution,
      monitoring: os8StateRef.current?.monitoringState || null
    });
    const signature = JSON.stringify({
      route: derived.currentRoute,
      previousRoute: derived.previousRoute,
      pendingQuestion: derived.pendingQuestion,
      activeIntent: derived.activeIntent,
      activeGoal: derived.activeGoal,
      activeTask: derived.activeTask,
      collectedSlots: derived.collectedSlots,
      messageCount: derived.conversation?.turns?.length || 0,
      lastTurnId: derived.conversation?.turns?.[derived.conversation?.turns?.length - 1]?.id || null,
      executionStatus: derived.executionState?.status || null,
      monitoringStatus: derived.monitoringState?.status || null
    });
    if (signature === os8SyncSigRef.current) return;
    os8SyncSigRef.current = signature;
    os8StateRef.current = derived;
    saveLocalIntentOSState(derived, 'intent-unified');
    if (shouldSyncToServer(os8RemoteSyncAtRef.current) || !os8HydratedRef.current) {
      os8RemoteSyncAtRef.current = Date.now();
      os8HydratedRef.current = true;
      void persistIntentOSSession(derived, { ownerKey: 'intent-unified', remote: true }).then((saved) => {
        if (saved) os8StateRef.current = saved;
      }).catch(() => {});
    }
  }, [convState, messages, currentPage, pendingExecution, aiContext, portfolioContextForOs8]);

  useEffect(() => {
    clearContextCache();
  }, [wallet?.address, wallet?.chainId, walletConnected]);

  const rememberPending = useCallback((intentOrMessage, intentType = 'GENERAL') => {
    if (intentOrMessage && intentOrMessage.schema === 'fbt.ai-pending-intent.v1') {
      savePendingIntent(intentOrMessage);
      return;
    }
    const made = createPendingIntent({
      originalMessage: String(intentOrMessage || ''),
      intentType,
      status: 'WAITING_FOR_WALLET',
      conversationId,
      locale
    });
    if (made.ok) savePendingIntent(made.intent);
  }, [conversationId, locale]);

  // UPGRADE 6 — Enhanced sendMessage with all new intelligence
  const sendMessage = useCallback(async (rawText, opts = {}) => {
    const message = String(rawText || '').trim();
    if (!message || busyRef.current) return null;
    busyRef.current = true;

    const os8Before = os8StateRef.current || loadLocalIntentOSState('intent-unified');
    let os8Turn = null;
    try {
      os8Turn = ingestUserTurn({ state: os8Before, text: message, currentRoute: currentPage });
      if (os8Turn?.state) {
        os8StateRef.current = os8Turn.state;
        saveLocalIntentOSState(os8Turn.state, 'intent-unified');
      }
    } catch {
      os8Turn = null;
    }

    // Phase 2 (§21): an answer to our single question binds to the slot that
    // asked for it. Only a short reply to the still-open question binds — a
    // long message is a new request, not an answer. Plan resume runs inside
    // enrich; it is never called by hand from here.
    try {
      const pending = pendingU7QuestionRef.current;
      const openId = convStateRef.current?.lastQuestionId;
      if (pending && openId && openId === pending.questionId && message.length <= 120) {
        upgrade7ns.bindAnswer({ questionId: pending.questionId, intentId: pending.intentId, slot: pending.slot, expectedType: pending.expectedType, value: message, conversationId });
      }
      if (!pending || openId !== pending.questionId) pendingU7QuestionRef.current = null;
    } catch { /* binding is best-effort; the turn continues regardless */ }

    // §43 Global Event Bus
    busV6.emit(EVENTS_V6.USER_MESSAGE, { message, conversationId, currentPage });
    const obsIntentId = convStateRef.current.intentId || makeId();
    obsRef.current.logIntentStart({
      intentId: obsIntentId,
      sessionId: convStateRef.current.sessionId,
      userRequest: message,
      detectedIntent: null,
      currentRoute: currentPage
    });

    // State machine transition: IDLE → UNDERSTANDING
    stateMachineRef.current.transition(STATES.UNDERSTANDING, { reason: 'new_user_request' });
    setThinkingState('listening');
    setActivitySteps([
      { id: 'understand', label: 'درک درخواست', labelEn: 'Understanding request', status: 'active', orbState: 'listening' },
      { id: 'wallet', label: 'بررسی کیف پول', labelEn: 'Checking wallet', status: 'pending', orbState: 'searching' },
      { id: 'market', label: 'دریافت داده بازار', labelEn: 'Market data', status: 'pending', orbState: 'searching' },
      { id: 'agents', label: 'فراخوانی Agentها', labelEn: 'Calling agents', status: 'pending', orbState: 'connecting' },
      { id: 'analyze', label: 'تحلیل', labelEn: 'Analyzing', status: 'pending', orbState: 'solving' },
      { id: 'response', label: 'تولید پاسخ', labelEn: 'Generating response', status: 'pending', orbState: 'composing' }
    ]);

    if (!opts.skipUserBubble) {
      setInput('');
      const userMsg = { id: makeId(), role: 'user', content: message, kind: 'user', at: Date.now() };
      setMessages((prev) => [...prev, userMsg]);
      setConvState((prev) => {
        let next = appendConvMessage(prev, userMsg);
        next = setConvAnswer(next, message, { questionId: prev.lastQuestionId });
        if (os8Turn?.created?.intent) {
          next = setConvIntent(next, { type: os8Turn.created.intent.type, primaryIntent: os8Turn.created.intent.type }, {
            status: os8Turn.state?.pendingQuestion ? INTENT_STATUS.CLARIFYING : INTENT_STATUS.READY
          });
          next = setMissingSlots(next, os8Turn.created.intent.requiredSlots || []);
          const q = (os8Turn.state?.questions || []).find((item) => item.questionId === os8Turn.state.pendingQuestion);
          if (q?.prompt) {
            next = setConvQuestion(next, q.prompt, { questionId: q.questionId, expectedType: q.expectedType });
          }
        }
        if (os8Turn?.binding) {
          const slotKey = os8Turn.binding.slot === 'riskProfile'
            ? 'riskProfile'
            : os8Turn.binding.slot === 'durationMonths'
              ? 'timeframe'
              : os8Turn.binding.slot;
          next = setCollectedSlot(next, slotKey, os8Turn.binding.value, { confidence: os8Turn.binding.confidence });
          next = setMissingSlots(next, os8Turn.state?.missingSlots || []);
          if (!os8Turn.state?.pendingQuestion) {
            next = setConvQuestion(next, '', { questionId: null, expectedType: null });
          }
        }
        return next;
      });
      addL1Message(userMsg);
      busV6.emit(EVENTS_V6.ANSWER_RECEIVED, { answer: message, questionId: convStateRef.current.lastQuestionId });
    }

    const localizedThinking = locale.startsWith('fa')
      ? ['در حال درک درخواست شما…', 'بررسی کیف پول و بازار…', 'طراحی مسیر امن…']
      : ['Understanding your request…', 'Checking wallet & market…', 'Building safe plan…'];
    setThinking(localizedThinking);

    try {
      // §7, §8, §10 — Check if this is short answer to last question BEFORE full intent understanding
      const slotEngine = slotEngineRef.current;
      const refResolver = refResolverRef.current;
      const ctxResolver = ctxResolverRef.current;
      const conv = convStateRef.current;
      const os8Current = os8StateRef.current || os8Turn?.state || os8Before;
      const os8Intent = (os8Current?.intents || []).find((item) => item.intentId === os8Current?.activeIntent) || null;
      const os8Goal = (os8Current?.goals || []).find((item) => item.goalId === os8Current?.activeGoal) || null;
      const fa = locale.startsWith('fa');

      const selectedReference = message.length <= 120
        ? parseAnswerValue({ text: message, question: { expectedType: 'selection', options: [] }, state: os8Current })
        : null;
      if (!pendingExecution && selectedReference?.optionIndex != null && Array.isArray(os8Current?.agentState?.lastPresentedOptions) && os8Current.agentState.lastPresentedOptions.length) {
        const nextOptions = os8Current.agentState.lastPresentedOptions.map((item, index) => ({ ...item, selected: index === selectedReference.optionIndex }));
        os8StateRef.current = {
          ...os8Current,
          agentState: {
            ...(os8Current.agentState || {}),
            lastPresentedOptions: nextOptions
          },
          lastUpdated: Date.now()
        };
        saveLocalIntentOSState(os8StateRef.current, 'intent-unified');
        const picked = nextOptions[selectedReference.optionIndex];
        const pickMsg = {
          id: makeId(),
          role: 'ai',
          content: fa
            ? `متوجه شدم — ${choiceLabel(picked)} را به‌عنوان مسیر منتخب ادامه می‌دهم. اگر بخواهی می‌توانم همین حالا شبیه‌سازی و آماده‌سازی اجرای امن را انجام بدهم.`
            : `Got it — I'll continue with ${choiceLabel(picked)} as the selected path. If you want, I can simulate it now and prepare a safe execution flow.`,
          kind: 'assistant',
          ui: { type: 'TEXT' },
          intentType: os8Intent?.type || null,
          detectedIntent: os8Intent?.type || null
        };
        setMessages((prev) => [...prev, pickMsg]);
        setConvState((prev) => appendConvMessage(prev, pickMsg));
        setThinking([]);
        setThinkingState('idle');
        setActivitySteps([]);
        busyRef.current = false;
        return true;
      }

      if (os8Turn?.binding?.slot === 'riskProfile' && os8Intent?.type === 'PORTFOLIO_ANALYSIS' && !(os8Turn.state?.missingSlots || []).length) {
        const orchestrated = await orchestrateIntent({
          state: os8Turn.state,
          message,
          walletContext: aiContext.wallet,
          portfolioContext: portfolioContextForOs8
        });
        os8StateRef.current = orchestrated.state;
        saveLocalIntentOSState(orchestrated.state, 'intent-unified');
        const consensus = orchestrated.orchestration?.consensus || {};
        const options = Array.isArray(consensus.options) ? consensus.options : [];
        const optionLines = options.map((option, index) => `${index + 1}) ${option.label} — ${option.rationale}`).join('\n');
        const responseText = fa
          ? `ریسک ${os8Turn.binding.value === 'medium' ? 'متوسط' : os8Turn.binding.value === 'low' ? 'کم' : 'زیاد'} ثبت شد. برای افق ${os8Goal?.horizonMonths || os8Turn.state?.collectedSlots?.timeframe || 4} ماهه، این برنامه را می‌بینم:\n${optionLines}\n\nپیشنهاد اصلی: ${consensus.preferredOption?.label || 'Balanced rotation'}. اگر خواستی بگو «همون گزینه دوم» یا «انجام بده».`
          : `${os8Turn.binding.value} risk recorded. For a ${os8Goal?.horizonMonths || os8Turn.state?.collectedSlots?.timeframe || 4}-month horizon, here is the plan:\n${optionLines}\n\nPrimary recommendation: ${consensus.preferredOption?.label || 'Balanced rotation'}. Say “same second option” or “do it” when you want to continue.`;
        const aiMsg = {
          id: makeId(),
          role: 'ai',
          content: responseText,
          kind: 'assistant',
          ui: { type: 'TEXT' },
          intentType: os8Intent?.type || 'PORTFOLIO_ANALYSIS',
          detectedIntent: os8Intent?.type || 'PORTFOLIO_ANALYSIS',
          choices: options.map((option, index) => ({ id: option.id || `opt-${index}`, label: `${fa ? 'گزینه' : 'Option'} ${index + 1}: ${option.label}`, value: option.id || option.label })),
          choiceKind: 'STRATEGY_OPTION'
        };
        setMessages((prev) => [...prev, aiMsg]);
        setConvState((prev) => {
          let next = appendConvMessage(prev, aiMsg);
          next = setConvQuestion(next, '', { questionId: null, expectedType: null });
          next = updateIntentStatus(next, INTENT_STATUS.READY);
          return next;
        });
        setPredictedNext(options.map((option, index) => ({ id: option.id || `opt-${index}`, label: option.label, prompt: option.label })));
        setSuggestions([]);
        setThinking([]);
        setThinkingState('idle');
        setActivitySteps([]);
        busyRef.current = false;
        return true;
      }

      if (!pendingExecution && /(?:^|\s)(?:انجامش بده|انجام بده|تأیید|تایید|do it|go ahead|confirm)(?:\s|$)/i.test(message) && os8Intent?.type === 'PORTFOLIO_ANALYSIS' && os8Current?.agentState?.lastPresentedOptions?.some?.((item) => item.selected)) {
        const preparedV8 = prepareExecution({
          state: os8Current,
          action: buildRecommendationAction(os8Current, portfolioContextForOs8),
          walletContext: aiContext.wallet
        });
        os8StateRef.current = preparedV8.state;
        saveLocalIntentOSState(preparedV8.state, 'intent-unified');
        const selected = os8Current.agentState.lastPresentedOptions.find((item) => item.selected) || os8Current.agentState.lastPresentedOptions[0];
        setPendingExecution({
          action: preparedV8.execution.action,
          actions: [preparedV8.execution.action],
          message,
          card: {
            title: fa ? '✦ آماده‌سازی اجرای امن' : '✦ Safe execution prepared',
            headline: fa
              ? `استراتژی ${choiceLabel(selected)} انتخاب شد. قبل از اجرا شبیه‌سازی، مجوز و وضعیت کیف پول بررسی می‌شود.`
              : `${choiceLabel(selected)} selected. Simulation, permissions and wallet freshness will be checked before execution.`,
            rows: preparedV8.execution.action?.parameters?.targetAllocation || [],
            tradeCount: (preparedV8.execution.action?.parameters?.targetAllocation || []).length,
            estimatedFeeUsd: preparedV8.simulation?.estimatedGasUsd || preparedV8.execution.action?.estimatedGasUsd || null,
            confirmLabel: fa ? 'تأیید و اجرای امن' : 'Confirm safe execution',
            editLabel: fa ? 'ویرایش' : 'Edit'
          },
          rebalance: { target: preparedV8.execution.action?.parameters?.targetAllocation || [] },
          intentId: os8Intent?.intentId || null,
          intentType: 'REBALANCE',
          walletSnapshot: walletMgrRef.current.takeSnapshot({
            connected: walletConnected,
            canSign: walletCanSign,
            address: wallet?.address || null,
            chainId: wallet?.chainId || null,
            balances: aiContext.balances,
            tokenBalances: aiContext.balances
          })
        });
        setConvState((prev) => setConvPending(prev, { action: preparedV8.execution.action, intentId: os8Intent?.intentId || null }));
        const prepMsg = {
          id: makeId(),
          role: 'ai',
          content: fa
            ? `آماده‌ام. اول شبیه‌سازی و بررسی ایمنی را انجام می‌دهم؛ بعد از تأیید نهایی، اجرا و مانیتورینگ شروع می‌شود.${preparedV8.simulation?.warnings?.length ? ` هشدارها: ${preparedV8.simulation.warnings.join('، ')}` : ''}`
            : `Ready. I will simulate and run safety checks first; after your final confirmation, execution and monitoring will start.${preparedV8.simulation?.warnings?.length ? ` Warnings: ${preparedV8.simulation.warnings.join(', ')}` : ''}`,
          kind: 'assistant',
          ui: { type: 'TEXT' },
          intentType: 'REBALANCE',
          detectedIntent: 'REBALANCE'
        };
        setMessages((prev) => [...prev, prepMsg]);
        setConvState((prev) => appendConvMessage(prev, prepMsg));
        setThinking([]);
        setThinkingState('idle');
        setActivitySteps([]);
        busyRef.current = false;
        return true;
      }

      // Bare «اره» / «بله تایید شد» and named page-opens («افق جهانی را باز کن»)
      // must reach the OS — leftover lastQuestion must not swallow them.
      if (isBareFollowUp(message) || isPageOpenUtterance(message)) {
        /* fall through to context + OS process() */
      } else if (conv.lastQuestion && conv.lastQuestionId && message.length < 100) {
        const shortParsed = parseShortAnswer(message);
        const fillResult = slotEngine.fillFromAnswer(message, { conversationState: conv });

        if (fillResult.filled) {
          // §7 — "۴ ماه" correctly understood
          const slotKey = fillResult.slot === 'timeframe' ? 'timeframe' : fillResult.slot === 'forecastPeriod' ? 'forecastPeriod' : fillResult.slot;
          setConvState((prev) => {
            let next = setCollectedSlot(prev, slotKey, fillResult.value, { confidence: fillResult.confidence });
            next = setConvAnswer(next, message, { questionId: prev.lastQuestionId });
            return next;
          });

          busV6.emit(EVENTS_V6.SLOT_FILLED, { slot: slotKey, value: fillResult.value, confidence: fillResult.confidence });
          busV6.emit(EVENTS_V6.SHORT_ANSWER_RESOLVED, { parsed: shortParsed, fillResult });
          obsRef.current.log({ intentId: conv.intentId, type: 'SLOT_FILLED', payload: { slot: slotKey, value: fillResult.value } });
          metricsRef.current.recordQuestion(false);

          // Continue intent instead of asking again
          const fa = locale.startsWith('fa');
          let responseText = '';
          if (slotKey === 'timeframe' || slotKey === 'forecastPeriod') {
            const val = fillResult.value;
            const display = val.months ? `${val.months} ماه` : `${val.value} ${val.unit}`;
            responseText = fa
              ? `متوجه شدم؛ بازه پیش‌بینی را ${display} در نظر می‌گیرم. حالا برای تحلیل، ریسک متوسط را در نظر بگیرم؟`
              : `Got it; I'll consider the forecast period as ${display}. Should I use medium risk for the analysis?`;
            setConvState((prev) => setConvQuestion(prev, fa ? 'ریسک متوسط را در نظر بگیرم؟' : 'Should I consider medium risk?', { questionId: makeId('q'), expectedType: 'risk' }));
          } else if (slotKey === 'targetReturn') {
            responseText = fa
              ? `هدف ${fillResult.value.value}% سود ثبت شد. در چه بازه‌ای می‌خوای به این سود برسی؟`
              : `Target ${fillResult.value.value}% return recorded. In what timeframe?`;
            setConvState((prev) => setConvQuestion(prev, responseText, { questionId: makeId('q'), expectedType: 'duration' }));
          } else {
            responseText = fa ? `ممنون! "${message}" ثبت شد.` : `Thanks! "${message}" recorded.`;
          }

          const aiMsg = {
            id: makeId(),
            role: 'ai',
            content: responseText,
            kind: 'assistant',
            ui: { type: 'TEXT' },
            intentId: conv.intentId,
            slotFilled: slotKey
          };
          setMessages((prev) => [...prev, aiMsg]);
          setConvState((prev) => appendConvMessage(prev, aiMsg));
          setThinking([]);
          setThinkingState('idle');
          setActivitySteps([]);
          busyRef.current = false;
          stateMachineRef.current.transition(STATES.CLARIFYING, { reason: 'slot_filled' });
          return true;
        }

        // Try reference resolver for pronouns like "همون قبلی"
        if (shortParsed.type === 'reference' || shortParsed.type === 'selection') {
          const refResolved = refResolver.resolve(message, {
            conversationState: conv,
            messages: conv.messages,
            collectedSlots: conv.collectedSlots,
            currentPage
          });
          if (refResolved.resolved) {
            busV6.emit(EVENTS_V6.REFERENCE_RESOLVED, { original: message, resolved: refResolved });
            // If resolved to asset or capital, use it
            if (refResolved.type === 'asset') {
              setConvState((prev) => setCollectedSlot(prev, 'asset', refResolved.value, { confidence: refResolved.confidence }));
            }
            // Continue with resolved reference
          }
        }

        // Try contextual resolver before saying "مطمئن نشدم"
        const ctxInterpretation = ctxResolver.resolve(message, {
          lastQuestion: conv.lastQuestion,
          lastQuestionId: conv.lastQuestionId,
          currentIntent: conv.currentIntent,
          missingSlots: conv.missingSlots,
          previousMessages: conv.messages,
          currentPage,
          activeTask: conv.currentTask,
          collectedSlots: conv.collectedSlots,
          conversationState: conv
        });

        if (ctxInterpretation.interpretation) {
          const conf = calculateConfidence(ctxInterpretation);
          const action = shouldExecute(conf);
          busV6.emit(EVENTS_V6.CONFIDENCE_EVALUATED, { confidence: conf, action, interpretation: ctxInterpretation });

          if (action === 'execute' && ctxInterpretation.interpretation.type === 'slot_fill') {
            const slot = ctxInterpretation.interpretation.slot;
            const value = ctxInterpretation.interpretation.value;
            setConvState((prev) => setCollectedSlot(prev, slot, value, { confidence: conf }));
            const fa = locale.startsWith('fa');
            const aiMsg = {
              id: makeId(),
              role: 'ai',
              content: fa ? `بازه ${value.months || value.value} ماه ثبت شد. ادامه می‌دم...` : `Period ${value.months || value.value} recorded. Continuing...`,
              kind: 'assistant',
              ui: { type: 'TEXT' }
            };
            setMessages((prev) => [...prev, aiMsg]);
            setThinking([]);
            setThinkingState('idle');
            setActivitySteps([]);
            busyRef.current = false;
            return true;
          }
        }
      }

      // Extract L3 preferences from message
      const l3Prefs = extractL3FromMessage(message);
      for (const pref of l3Prefs) {
        addL3Preference(pref);
      }

      // Full sentence slot extraction e.g. "می‌خوام در ۴ ماه ۲۰٪ سود کنم"
      const sentenceSlots = slotEngine.extractFromSentence(message);
      if (Object.keys(sentenceSlots).length) {
        setConvState((prev) => {
          let next = prev;
          for (const [k, v] of Object.entries(sentenceSlots)) {
            next = setCollectedSlot(next, k, v, { confidence: 0.9 });
          }
          return next;
        });
      }

      // 0. Context continuation + natural-language monitor/order/opportunity
      // Page-open utterances skip this: «افق جهانی را باز کن» is not a monitor.
      if (contextHandlerRef.current && !isPageOpenUtterance(message)) {
        const ctxOut = await contextHandlerRef.current(message);
        if (ctxOut?.handled) {
          setThinking([]);
          setThinkingState('idle');
          setActivitySteps([]);
          busyRef.current = false;
          stateMachineRef.current.transition(STATES.COMPLETED, { reason: 'context_handled' });
          return true;
        }
      }

      // Update activity timeline
      setActivitySteps((prev) => prev.map((s, i) => i === 0 ? { ...s, status: 'completed' } : i === 1 ? { ...s, status: 'active' } : s));
      setThinkingState('searching');

      // 1. Try local Intent OS first
      const walletState = {
        connected: walletConnected,
        isConnected: walletConnected,
        address: wallet?.address || null,
        solanaAddress: solanaAddressLive || null,
        canSign: walletCanSign,
        balances: aiContext.balances,
        tokenBalances: aiContext.balances,
        chains: wallet?.chainId ? [wallet.chainId] : [],
        chainId: wallet?.chainId || null,
        hydrating: aiContext.wallet?.hydrating,
        connectionStatus: aiContext.wallet?.connectionStatus,
        nativeBalance: wallet?.nativeBalance ?? null
      };

      // §13 — Check what info system already knows before asking
      const knownInfoCheck = {
        hasWallet: walletConnected,
        hasPortfolio: aiContext.portfolio?.totalValueUsd != null,
        hasBalances: aiContext.balances?.length > 0,
        hasSlots: Object.keys(convStateRef.current.collectedSlots || {}).length > 0
      };

      setActivitySteps((prev) => prev.map((s) => s.id === 'wallet' ? { ...s, status: 'completed' } : s.id === 'market' ? { ...s, status: 'active' } : s));

      const osResult = await intentOS.process({
        message,
        conversationId,
        currentPage,
        walletState,
        portfolioState: aiContext.portfolio,
        conversation: messages.map(m => ({ role: m.role, content: m.content })).slice(-10),
        pendingOffer: convStateRef.current.pendingOffer || null,
        locale,
        services: liveModuleServices
      });
      // Belt: named Horizon/forex never stays in chat as an unfinished task.
      const osType = String(osResult?.intent?.type || osResult?.intent?.primaryIntent || '').toUpperCase();
      if (osResult?.ok && (osType === 'HORIZON' || osType === 'FOREX') && !osResult.navigated && !osResult.execution?.route) {
        try {
          navigate('/stocks');
          osResult.navigated = '/stocks';
          osResult.execution = { ...(osResult.execution || {}), ok: true, route: '/stocks' };
        } catch { /* router optional */ }
      }
      try {
        obsRef.current.log({
          intentId: obsIntentId,
          type: 'INTENT_DETECTED',
          payload: {
            detectedIntent: osResult?.intent?.type || osResult?.intent?.primaryIntent || null,
            detail: osResult?.intent || null
          }
        });
      } catch { /* observability is best-effort */ }

      setActivitySteps((prev) => prev.map((s) => s.id === 'market' ? { ...s, status: 'completed' } : s.id === 'agents' ? { ...s, status: 'active' } : s));
      setThinkingState('connecting');

      // §5 — Multi-Agent Collaboration for complex queries
      let orchestrationResult = null;
      if (osResult.ok && osResult.intent) {
        const sharedCtx = createSharedContext({
          userIntent: osResult.intent,
          conversation: messages,
          wallet: walletState,
          portfolio: aiContext.portfolio,
          market: osResult.execution?.market || null,
          currentPage,
          conversationState: convStateRef.current,
          availableTools: osResult.plan?.tools || []
        });

        // For complex scenarios, use orchestrator V2
        if (/اگر.*رشد|what if|scenario|پیش‌بینی.*سرمایه|سود.*سرمایه/.test(message.toLowerCase())) {
          try {
            const orchestratorV2 = getOrchestratorV2({ agents: intentOS.agents });
            orchestrationResult = await orchestratorV2.orchestrate({
              intent: osResult.intent,
              context: { ...aiContext, lastMessage: message, currentIntent: osResult.intent.type },
              sharedContext: sharedCtx
            });
            busV6.emit(EVENTS_V6.AGENT_COMPLETED, { agentsUsed: orchestrationResult.agentsUsed });
            obsRef.current.log({ intentId: convStateRef.current.intentId, type: 'AGENT_USED', payload: { agentId: orchestrationResult.agentsUsed.join(',') } });
          } catch {}
        }
      }

      setActivitySteps((prev) => prev.map((s) => s.id === 'agents' ? { ...s, status: 'completed' } : s.id === 'analyze' ? { ...s, status: 'active' } : s));
      setThinkingState('solving');

      const osIntentType = osResult.intent?.type || null;
      const needsFinancialConfirmation = Boolean(
        osResult.requiresConfirmation
        || osResult.human?.requiresConfirmation
        || osResult.execution?.requiresConfirmation
        || osResult.execution?.planReady
      );

      // §33 No Repetition Policy check
      const noRepeatCheck = noRepeatRef.current.check({
        question: osResult.intent?.minimalQuestion?.fa || osResult.intent?.minimalQuestion?.en,
        conversationState: convStateRef.current,
        intentId: convStateRef.current.intentId
      });
      if (!noRepeatCheck.shouldAsk && noRepeatCheck.reason === 'already_asked') {
        busV6.emit(EVENTS_V6.REPETITION_PREVENTED, { question: noRepeatCheck.question, reason: noRepeatCheck.reason });
        metricsRef.current.recordQuestion(true);
        // Don't ask again, use stored answer
        osResult.intent.minimalQuestion = null;
      }

      const isLocalHandled = osResult.ok && !needsFinancialConfirmation && (
        osResult.intent?.readOnly === true ||
        osResult.execution?.handoff === true ||
        Boolean(osResult.navigated) ||
        Boolean(osResult.execution?.route) ||
        Boolean(osResult.execution?.unavailable) ||
        osIntentType === 'OPEN_CALM' ||
        osIntentType === 'PLAY_MUSIC' ||
        (osResult.plan?.readOnly === true)
      );

      if (isLocalHandled) {
        setActivitySteps((prev) => prev.map((s) => s.id === 'analyze' ? { ...s, status: 'completed' } : s.id === 'response' ? { ...s, status: 'active' } : s));
        setThinkingState('composing');

        // §34 Response Memory Check
        const memCheck = respCheckRef.current.check({
          conversationState: convStateRef.current,
          currentIntent: osResult.intent,
          taskState: convStateRef.current.currentTask,
          availableData: { portfolio: aiContext.portfolio, wallet: walletState },
          lastMessage: message
        });

        // §35 Self-Check
        const selfCheck = selfCheckRef.current.check({
          response: osResult.human,
          conversationState: convStateRef.current,
          intent: osResult.intent,
          navigation: osResult.navigated ? { target: osResult.navigated } : null,
          wallet: walletState,
          tool: osResult.plan?.tools?.[0]
        });

        let finalMessage = visibleText(osResult.human || osResult, osResult.message);

        // §36 Example: Portfolio analysis navigation handling
        if (osResult.intent?.type === 'PORTFOLIO_ANALYSIS' && osResult.navigated === '/portfolio') {
          // Intent lifecycle: CREATED → NAVIGATING
          const intentRec = lifecycleRef.current.createIntent({
            userRequest: message,
            detectedIntent: osResult.intent,
            sessionId: convStateRef.current.sessionId
          });
          lifecycleRef.current.updateStatus(intentRec.intentId, INTENT_LIFECYCLE.NAVIGATING, { route: '/portfolio' });
          setConvState((prev) => {
            let next = setConvIntent(prev, osResult.intent, { status: INTENT_STATUS.NAVIGATING });
            next = setConvQuestion(next, '', { questionId: null, expectedType: null }); // No question, navigating
            return next;
          });
          obsRef.current.log({ intentId: intentRec.intentId, type: 'NAVIGATION', payload: { route: '/portfolio' } });
          // Don't show repeated message when returning — will be handled by return logic
        }

        // If self-check found high severity issues, fix response
        if (selfCheck.shouldFix) {
          // Fix: remove repeated question
          for (const issue of selfCheck.issues) {
            if (issue.type === 'context_inconsistency' && issue.severity === 'high') {
              // Don't ask for timeframe again
              finalMessage = finalMessage.replace(/مدت.*چقدر.*باشد\?|بازه.*چقدر.*باشد\?/gi, '').trim();
              if (!finalMessage) {
                finalMessage = locale.startsWith('fa')
                  ? 'پرتفوی شما بررسی شد. می‌خواهید تحلیل ریسک، سودآوری یا پیشنهاد تخصیص دارایی را انجام بدهم؟'
                  : 'Your portfolio has been analyzed. Would you like risk analysis, profitability, or allocation suggestions?';
              }
            }
          }
        }

        // If orchestration result exists, merge it
        if (orchestrationResult?.aggregated) {
          const agg = orchestrationResult.aggregated;
          if (agg.marketScenario) finalMessage += `\n\n${locale.startsWith('fa') ? 'سناریو بازار:' : 'Market scenario:'} ${JSON.stringify(agg.marketScenario)}`;
          if (agg.riskImpact) finalMessage += `\n${locale.startsWith('fa') ? 'تأثیر ریسک:' : 'Risk impact:'} ${JSON.stringify(agg.riskImpact)}`;
        }

        // Phase 2 (§19/§20): at most ONE question, and only when nothing
        // else asks. A money-sensitive contradiction outranks a clarification.
        const u7q = pickSingleQuestion(osResult?.upgrade7);
        let u7qText = (!osResult.intent?.minimalQuestion && u7q) ? u7q.text : null;
        if (u7qText && hasAskedQuestion(convStateRef.current, u7qText)) u7qText = null;
        if (u7qText) {
          finalMessage = `${finalMessage}\n\n${u7qText}`;
          pendingU7QuestionRef.current = { questionId: makeId(), intentId: convStateRef.current?.intentId || null, slot: u7q.slot, expectedType: u7q.expectedType };
        }

        const nextMessage = {
          id: makeId(),
          role: 'ai',
          content: finalMessage,
          kind: 'assistant',
          ui: osResult.human?.ui || osResult.ui || { type: 'TEXT' },
          card: osResult.human?.card || osResult.card || null,
          intentType: osResult.intent?.type || null,
          detectedIntent: osResult.intent?.primaryIntent || osResult.intent?.type || null,
          missingInfo: (osResult.intent?.minimalQuestion ? (locale.startsWith('fa') ? osResult.intent.minimalQuestion.fa : osResult.intent.minimalQuestion.en) : null) || u7qText,
          suggestions: (osResult.intent?.nextPredictedActions?.length
            ? osResult.intent.nextPredictedActions.map((a) => ({ id: a.intent, label: locale.startsWith('fa') ? a.labelFa : a.labelEn, prompt: a.prompt }))
            : (osResult.suggestions || getSuggestionsForIntent(osResult.intent?.type, aiContext, osResult.intent?.entities, locale))),
          debug: osResult.debug || null,
          intentId: convStateRef.current.intentId,
          confidence: osResult.confidence || null,
          aggregated: orchestrationResult?.aggregated || null,
          upgrade7: trimUpgrade7ForMessage(osResult?.upgrade7)
        };

        // §33 — Check if this question was already asked
        if (nextMessage.missingInfo) {
          const alreadyAsked = hasAskedQuestion(convStateRef.current, nextMessage.missingInfo);
          if (alreadyAsked) {
            nextMessage.missingInfo = null;
            metricsRef.current.recordQuestion(true);
            busV6.emit(EVENTS_V6.REPETITION_PREVENTED, { question: nextMessage.missingInfo });
          } else {
            metricsRef.current.recordQuestion(false);
          }
        }

        setMessages((prev) => [...prev, nextMessage]);
        setConvState((prev) => {
          let next = appendConvMessage(prev, nextMessage);
          const offerRoute = osResult.human?.actions?.[0]?.route || osResult.navigated || osResult.execution?.route || null;
          const offeredOpen = /باز کنم|open (the )?(market |farm |horizon )?page|Want me to open/i.test(String(finalMessage || ''));
          if (offeredOpen && offerRoute) {
            const qId = makeId('q');
            const q = locale.startsWith('fa') ? 'صفحه را باز کنم؟' : 'Open the page?';
            next = setConvQuestion(next, q, { questionId: qId, expectedType: 'confirmation' });
            next = setConvOffer(next, { route: offerRoute, intentType: osResult.intent?.type || null, selection: null });
            obsRef.current.log({ intentId: prev.intentId, type: 'QUESTION_ASKED', payload: { question: q, questionId: qId } });
          } else if (nextMessage.missingInfo) {
            const qId = makeId('q');
            next = setConvQuestion(next, nextMessage.missingInfo, { questionId: qId, expectedType: osResult.intent?.missingInformation?.[0] || 'text' });
            obsRef.current.log({ intentId: prev.intentId, type: 'QUESTION_ASKED', payload: { question: nextMessage.missingInfo, questionId: qId } });
          } else {
            // No missing info → ready or completed
            next = updateIntentStatus(next, INTENT_STATUS.COMPLETED);
            next = setConvOffer(next, null);
            lifecycleRef.current.updateStatus(next.intentId, INTENT_LIFECYCLE.COMPLETED);
            busV6.emit(EVENTS_V6.INTENT_COMPLETED, { intentId: next.intentId });
            metricsRef.current.recordIntent(true);
          }
          return next;
        });

        setSuggestions((nextMessage.suggestions || []).slice(0, MAX_SUGGESTIONS));
        setPredictedNext(osResult?.upgrade7?.predictedNext || []);
        setPendingExecution(null);
        addL1Message(nextMessage);
        busV6.emit(EVENTS_V6.AI_RESPONSE, { message: finalMessage, intentType: osResult.intent?.type });

        setActivitySteps((prev) => prev.map((s) => ({ ...s, status: 'completed' })));
        setThinkingState('idle');
        setTimeout(() => setActivitySteps([]), 2000);

        stateMachineRef.current.transition(STATES.COMPLETED, { reason: 'local_handled' });

        return true;
      }

      // 2. Server fallback with verification
      setActivitySteps((prev) => prev.map((s) => s.id === 'analyze' ? { ...s, status: 'completed' } : s.id === 'response' ? { ...s, status: 'active' } : s));
      setThinkingState('composing');

      // §16 — Verify before execution
      const verifyResult = await walletMgrRef.current.verifyBeforeExecution({
        intent: osResult.intent || { type: 'GENERAL' },
        walletState,
        portfolioState: aiContext.portfolio,
        services: liveModuleServices
      });

      if (!verifyResult.ok && verifyResult.reason === 'WALLET_NOT_CONNECTED') {
        // Need wallet
        const human = humanizeError('WALLET_REQUIRED', { locale });
        setMessages((prev) => [...prev, {
          id: makeId(),
          role: 'ai',
          content: human.message,
          kind: 'connect',
          ui: { type: 'CONNECT_WALLET' }
        }]);
        setThinking([]);
        setThinkingState('idle');
        setActivitySteps([]);
        busyRef.current = false;
        return true;
      }

      const res = await aiChat({
        message,
        conversationId,
        context: aiContext,
        resume: opts.resume === true,
        hints: opts.hints || null
      });

      if (res?.ok !== true) {
        const code = res?.status === 412 || res?.status === 'WALLET_REQUIRED' ? 'WALLET_REQUIRED' : (res?.error || res?.status || 'NETWORK_FAILED');
        const human = humanizeError(code, { locale });
        const connect = human.ui === 'CONNECT_WALLET' || res?.ui?.type === 'CONNECT_WALLET';
        if (connect) rememberPending(res?.pendingIntent || message, res?.intent?.type || 'GENERAL');

        // §30 Error Recovery
        const toolChecker = toolCheckerRef.current;
        const recoveryMsg = toolChecker.getRecoveryMessage({ message: code }, { toolId: res?.intent?.type });
        const retryStrategy = toolChecker.getRetryStrategy({ message: code }, { attempt: 0 });

        setMessages((prev) => [...prev, {
          id: makeId(),
          role: 'ai',
          content: visibleText(res, human.message) + (retryStrategy.recoverable ? `\n\n${recoveryMsg}` : ''),
          kind: connect ? 'connect' : 'error',
          ui: { type: connect ? 'CONNECT_WALLET' : 'TEXT' }
        }]);

        if (retryStrategy.action === 'RETRY' && retryStrategy.recoverable) {
          // Auto retry for transient
          setTimeout(() => {
            void sendMessage(message, { ...opts, skipUserBubble: true });
          }, retryStrategy.delayMs);
          obsRef.current.log({ intentId: convStateRef.current.intentId, type: 'RETRY', payload: retryStrategy });
          busV6.emit(EVENTS_V6.RECOVERY, { strategy: retryStrategy });
        }

        obsRef.current.log({ intentId: convStateRef.current.intentId, type: 'ERROR', payload: { error: code } });
        metricsRef.current.recordIntent(false);
        stateMachineRef.current.transition(STATES.FAILED, { reason: code });
        return true;
      }

      const reply = res.reply || {};
      const uiType = reply.ui?.type || 'TEXT';
      const thanks = opts.resume ? formatConnectThanks(locale) : '';
      const body = visibleText(reply, t('intentAIOS.noReply', { defaultValue: 'نتوانستم پاسخی آماده کنم.' }));
      const nextMessage = {
        id: makeId(),
        role: 'ai',
        content: thanks ? `${thanks}\n\n${body}` : body,
        kind: uiType === 'CONNECT_WALLET' ? 'connect' : (uiType === 'RESULT_CARD' ? 'result' : 'assistant'),
        ui: reply.ui || { type: 'TEXT' },
        card: reply.card || null,
        actions: Array.isArray(reply.actions) ? reply.actions : [],
        rebalance: reply.rebalance || null,
        choices: Array.isArray(reply.choices) ? reply.choices : [],
        choiceKind: reply.choiceKind || null,
        intentId: reply.intentId || null,
        intentType: reply.intent?.type || osResult.intent?.type || null,
        detectedIntent: reply.intent?.primaryIntent || reply.intent?.type || osResult.intent?.type || null,
        missingInfo: reply.intent?.minimalQuestion ? (locale.startsWith('fa') ? reply.intent.minimalQuestion.fa : reply.intent.minimalQuestion.en) : null,
        suggestions: Array.isArray(reply.suggestions) ? reply.suggestions : (osResult.suggestions || getSuggestionsForIntent(reply.intent?.type, aiContext, {}, locale)),
        multiAi: reply.multiAi || null,
        intelligence: reply.intelligence || null,
        debug: osResult.debug || null,
        upgrade7: trimUpgrade7ForMessage(osResult?.upgrade7)
      };

      // §33 No Repetition check for server response too
      if (nextMessage.missingInfo) {
        const repeatCheck = noRepeatRef.current.check({
          question: nextMessage.missingInfo,
          conversationState: convStateRef.current,
          intentId: reply.intentId
        });
        if (!repeatCheck.shouldAsk) {
          nextMessage.missingInfo = null;
          busV6.emit(EVENTS_V6.REPETITION_PREVENTED, { question: nextMessage.missingInfo, reason: repeatCheck.reason });
          metricsRef.current.recordQuestion(true);
        } else {
          metricsRef.current.recordQuestion(false);
        }
      }

      // §34 Response Memory Check before finalizing
      const memCheck = respCheckRef.current.check({
        conversationState: convStateRef.current,
        currentIntent: reply.intent,
        availableData: { portfolio: aiContext.portfolio, wallet: walletState },
        lastMessage: message
      });

      // §35 Self-Check
      const selfCheck = selfCheckRef.current.check({
        response: nextMessage,
        conversationState: convStateRef.current,
        intent: reply.intent,
        wallet: walletState
      });

      if (selfCheck.shouldFix) {
        // Fix high severity issues
        nextMessage.content = nextMessage.content.replace(/برای تحلیل چه مقدار سرمایه دارید\?/gi, '').trim();
        if (!nextMessage.content) {
          nextMessage.content = locale.startsWith('fa')
            ? 'اطلاعات کیف پول شما در دسترس است. ادامه می‌دهم...'
            : 'Your wallet info is available. Continuing...';
        }
      }

      setMessages((prev) => [...prev, nextMessage]);
      setConvState((prev) => {
        let next = appendConvMessage(prev, nextMessage);
        if (nextMessage.missingInfo) {
          const qId = reply.intentId || makeId('q');
          next = setConvQuestion(next, nextMessage.missingInfo, { questionId: qId, expectedType: reply.intent?.missingInformation?.[0] || 'text' });
        }
        if (reply.intent) {
          next = setConvIntent(next, reply.intent, { status: nextMessage.missingInfo ? INTENT_STATUS.CLARIFYING : INTENT_STATUS.READY });
        }
        next = setMissingSlots(next, reply.intent?.missingInformation || []);
        return next;
      });

      setSuggestions((nextMessage.suggestions || []).slice(0, MAX_SUGGESTIONS));
      setPredictedNext(osResult?.upgrade7?.predictedNext || []);
      addL1Message(nextMessage);
      busV6.emit(EVENTS_V6.AI_RESPONSE, { message: nextMessage.content, intentType: nextMessage.intentType });

      if (res.context?.conversationSummary) setMemorySummary(res.context.conversationSummary);
      if (reply.pendingIntent) rememberPending(reply.pendingIntent);
      if (uiType === 'CONNECT_WALLET') rememberPending(reply.pendingIntent || message, reply.intent?.type);

      if (uiType === 'ACTION_CARD') {
        // §15 Wallet snapshot before operation
        const snapshot = walletMgrRef.current.takeSnapshot(walletState);
        setConvState((prev) => setConvWallet(prev, snapshot));

        // §17, §18 Tool capability check
        const toolCheck = toolCheckerRef.current.check({
          toolId: reply.actions?.[0]?.type || reply.intent?.type,
          chainId: wallet?.chainId,
          context: aiContext
        });

        if (!toolCheck.ok) {
          const fallback = toolCheck.fallback;
          if (fallback) {
            busV6.emit(EVENTS_V6.RECOVERY, { from: toolCheck.toolId, to: fallback.id, reason: toolCheck.reason });
            obsRef.current.log({ intentId: reply.intentId, type: 'FALLBACK', payload: { from: toolCheck.toolId, to: fallback.id } });
            metricsRef.current.recordFallback();
          }
        }

        setPendingExecution({
          action: reply.actions?.[0] || { type: reply.intent?.type || osResult.intent?.type || 'SWAP' },
          actions: reply.actions || osResult.plan?.actions || [],
          message,
          card: reply.card || osResult.human?.card,
          rebalance: reply.rebalance,
          actionPlan: reply.actionPlan || osResult.plan || null,
          intentId: reply.intentId || null,
          intentType: reply.intent?.type || osResult.intent?.type || reply.actions?.[0]?.type,
          osPlan: osResult.plan || null,
          walletSnapshot: snapshot
        });
        setConvState((prev) => setConvPending(prev, {
          action: reply.actions?.[0],
          intentId: reply.intentId,
          snapshot
        }));
        stateMachineRef.current.transition(STATES.READY, { reason: 'action_card_ready' });
      } else {
        setPendingExecution(null);
        if (!nextMessage.missingInfo) {
          stateMachineRef.current.transition(STATES.COMPLETED, { reason: 'response_completed' });
          setConvState((prev) => updateIntentStatus(prev, INTENT_STATUS.COMPLETED));
          if (reply.intentId) lifecycleRef.current.updateStatus(reply.intentId, INTENT_LIFECYCLE.COMPLETED);
        } else {
          stateMachineRef.current.transition(STATES.CLARIFYING, { reason: 'need_more_info' });
        }
      }

    } catch (err) {
      const human = humanizeError('NETWORK_FAILED', { locale });
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: human.message,
        kind: 'error',
        ui: { type: 'TEXT' },
        error: String(err?.message || '')
      }]);
      setSuggestions([]);
      obsRef.current.log({ intentId: convStateRef.current.intentId, type: 'ERROR', payload: { error: err.message } });
      metricsRef.current.recordIntent(false);
      busV6.emit(EVENTS_V6.ERROR, { error: err.message });
      stateMachineRef.current.transition(STATES.FAILED, { reason: err.message });

      // §30 Recovery
      const checker = toolCheckerRef.current;
      const strategy = checker.getRetryStrategy(err, { attempt: 0 });
      if (strategy.recoverable && strategy.action === 'RETRY') {
        busV6.emit(EVENTS_V6.RECOVERY, { strategy });
      }
    } finally {
      setThinking([]);
      setThinkingState('idle');
      setActivitySteps((prev) => prev.map((s) => ({ ...s, status: 'completed' })));
      setTimeout(() => setActivitySteps([]), 1500);
      busyRef.current = false;
      // Scroll handling — intelligent auto scroll (§24)
      scrollMgrRef.current.onNewMessage();
    }
    return true;
  }, [aiContext, conversationId, t, locale, rememberPending, intentOS, currentPage, messages, wallet, walletConnected, walletCanSign, liveModuleServices, solanaAddressLive, navigate, pendingExecution, portfolioContextForOs8]);

  sendRef.current = sendMessage;

  const sendSuggested = useCallback((s) => {
    if (!s?.prompt) return;
    setInput(s.prompt);
    void sendMessage(s.prompt);
  }, [sendMessage]);

  // Phase 2: predicted chips merge with contextual suggestions; duplicates
  // collapse on id and the row stays capped (prediction is an offer only).
  const allChips = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const c of [...(suggestions || []), ...(predictedNext || [])]) {
      if (!c || !c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out.slice(0, 6);
  }, [suggestions, predictedNext]);

  const drawerItems = useMemo(() => {
    const ctx = { currentPage, lastIntentType: messages[messages.length - 1]?.intentType, locale };
    return getSuggestionsForMessage('', ctx, locale).map(s => ({
      id: s.id,
      label: s.label,
      prompt: s.prompt
    }));
  }, [currentPage, messages, locale]);

  const runAction = useCallback(async (item) => {
    setDrawerOpen(false);
    const prompt = item.prompt || item.label;
    setInput(prompt);
    void sendMessage(prompt);
  }, [sendMessage]);

  const openWalletSheet = useCallback((message, intentType) => {
    if (message) rememberPending(message, intentType);
    setWalletSheetOpen(true);
  }, [rememberPending]);

  const pendingExecutionRef = useRef(null);
  useEffect(() => { pendingExecutionRef.current = pendingExecution; }, [pendingExecution]);
  const connectFromBubble = useCallback(() => {
    const pending = pendingExecutionRef.current;
    openWalletSheet(
      pending?.message || loadPendingIntent()?.originalMessage,
      pending?.intentType
    );
  }, [openWalletSheet]);

  const confirmExecution = useCallback(async () => {
    if (!pendingExecution || executing) return;
    const { action, message, actions, rebalance, intentType, walletSnapshot } = pendingExecution;
    const type = String(intentType || action?.type || '').toUpperCase();
    if (!walletConnected) {
      openWalletSheet(message, type);
      return;
    }

    // §16 Verify before execution — refresh wallet, balance, quote, risk, permission
    setThinkingState('working');
    setActivitySteps([
      { id: 'wallet_refresh', label: 'بروزرسانی کیف پول', labelEn: 'Refreshing wallet', status: 'active', orbState: 'searching' },
      { id: 'balance_refresh', label: 'بروزرسانی موجودی', labelEn: 'Refreshing balance', status: 'pending', orbState: 'searching' },
      { id: 'quote_refresh', label: 'بروزرسانی قیمت', labelEn: 'Refreshing quote', status: 'pending', orbState: 'searching' },
      { id: 'risk_check', label: 'بررسی ریسک', labelEn: 'Risk check', status: 'pending', orbState: 'solving' },
      { id: 'executing', label: 'در حال اجرا', labelEn: 'Executing', status: 'pending', orbState: 'working' }
    ]);

    const verify = await walletMgrRef.current.verifyBeforeExecution({
      intent: { type },
      walletState: walletSnapshot,
      portfolioState: aiContext.portfolio,
      services: liveModuleServices
    });

    if (!verify.ok) {
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: locale.startsWith('fa')
          ? `اجرای عملیات متوقف شد: ${verify.reason}`
          : `Execution stopped: ${verify.reason}`,
        kind: 'error',
        ui: { type: 'TEXT' }
      }]);
      setExecuting(false);
      setThinkingState('idle');
      setActivitySteps([]);
      busV6.emit(EVENTS_V6.ERROR, { reason: verify.reason, steps: verify.steps });
      return;
    }

    setActivitySteps((prev) => prev.map((s) => s.id === 'wallet_refresh' ? { ...s, status: 'completed' } : s.id === 'balance_refresh' ? { ...s, status: 'active' } : s));

    try {
      os8StateRef.current = {
        ...(os8StateRef.current || {}),
        executionState: {
          ...(os8StateRef.current?.executionState || {}),
          status: 'SIGNING',
          pendingExecution: pendingExecution?.action || null,
          lastConfirmation: pendingExecution?.card || os8StateRef.current?.executionState?.lastConfirmation || null
        },
        lastUpdated: Date.now()
      };
      saveLocalIntentOSState(os8StateRef.current, 'intent-unified');
      void persistIntentOSSession(os8StateRef.current, { ownerKey: 'intent-unified', remote: true }).catch(() => {});
    } catch {}

    setExecuting(true);
    setProgress({ index: 1, total: Math.max(1, (actions || []).length), status: 'VALIDATING' });
    busV6.emit(EVENTS_V6.EXECUTION_STARTED, { intentType: type, intentId: pendingExecution.intentId });
    stateMachineRef.current.transition(STATES.EXECUTING, { reason: 'user_confirmed' });

    try {
      if (type === 'DCA' || type === 'AUTOMATION_CREATE') {
        const made = await aiCreateAutomation({
          type: 'DCA',
          asset: action.asset || 'BTC',
          amount: String(action.amount || '100'),
          frequency: String(action.cadence || 'WEEKLY').toUpperCase(),
          chainId: action.chainId || null,
          message
        });
        if (made?.ok !== true) throw new Error(made?.error || 'AUTOMATION_FAILED');
        setMessages((prev) => [...prev, {
          id: makeId(),
          role: 'ai',
          content: t('intentAIOS.automationCreated', { defaultValue: 'برنامه خودکار ثبت شد و در Scheduler فعال است. هر اجرا همچنان به امضای شما نیاز دارد.' }),
          kind: 'automation',
          ui: { type: 'RESULT_CARD' },
          automation: made.automation || null
        }]);
        const list = await aiAutomations();
        setAutomations(list?.ok ? list.automations : []);
        clearPendingIntent();
        setConvState((prev) => updateIntentStatus(prev, INTENT_STATUS.COMPLETED));
        metricsRef.current.recordWalletExecution(true);
        busV6.emit(EVENTS_V6.EXECUTION_COMPLETED, { type, success: true });
        return;
      }
      if (type === 'GOAL') {
        const made = await aiCreateGoal({ message });
        if (made?.ok !== true) throw new Error(made?.error || 'GOAL_FAILED');
        setMessages((prev) => [...prev, {
          id: makeId(),
          role: 'ai',
          content: t('intentAIOS.goalCreated', { defaultValue: 'هدف مالی ایجاد شد و به Financial OS وصل شد.' }),
          kind: 'goal',
          ui: { type: 'RESULT_CARD' },
          goal: made.goal || null
        }]);
        clearPendingIntent();
        setConvState((prev) => updateIntentStatus(prev, INTENT_STATUS.COMPLETED));
        return;
      }

      const intentId = pendingExecution.intentId || null;
      let prepared = null;
      if (intentId) {
        const continued = await aiConfirm({
          intentId,
          actionPlanId: pendingExecution.actionPlan?.intentId || null,
          intentType: type,
          conversationId,
          context: aiContext
        });
        if (continued?.ok && continued.status === 'PLAN_READY') {
          prepared = { ...continued, ok: true, status: 'PLAN_READY' };
        } else if (continued?.ok && continued.status && continued.status !== 'PLAN_READY') {
          setMessages((prev) => [...prev, {
            id: makeId(),
            role: 'ai',
            content: continued.message,
            kind: continued.ui?.type === 'CONNECT_WALLET' ? 'connect' : 'assistant',
            ui: continued.ui || { type: 'TEXT' },
            choices: continued.choices || [],
            choiceKind: continued.choiceKind || null,
            intentId,
            intentType: type
          }]);
          if (continued.ui?.type === 'CONNECT_WALLET') openWalletSheet(message, type);
          return;
        }
      }
      if (!prepared) {
        prepared = await aiExecute({
          action,
          actions,
          actionPlan: pendingExecution.actionPlan || null,
          intentId,
          message,
          intentType: type,
          rebalance,
          wallet: aiContext.wallet,
          context: aiContext
        });
      }

      setActivitySteps((prev) => prev.map((s) => s.id === 'balance_refresh' ? { ...s, status: 'completed' } : s.id === 'quote_refresh' ? { ...s, status: 'active' } : s));

      if (prepared?.ok === true && prepared?.status && prepared.status !== 'PLAN_READY' && prepared.success !== true) {
        setMessages((prev) => [...prev, {
          id: makeId(),
          role: 'ai',
          content: prepared.message,
          kind: prepared.ui?.type === 'CONNECT_WALLET' ? 'connect' : 'assistant',
          ui: prepared.ui || { type: 'TEXT' },
          choices: prepared.choices || [],
          choiceKind: prepared.choiceKind || null,
          intentId,
          intentType: type
        }]);
        return;
      }
      if (prepared?.status === 'WALLET_REQUIRED' || prepared?.ui?.type === 'CONNECT_WALLET') {
        openWalletSheet(message, type);
        const human = humanizeError('WALLET_REQUIRED', { locale });
        setMessages((prev) => [...prev, {
          id: makeId(),
          role: 'ai',
          content: prepared?.message || human.message,
          kind: 'connect',
          ui: { type: 'CONNECT_WALLET' }
        }]);
        return;
      }
      if (prepared?.ok === false && prepared?.status !== 'PLAN_READY') {
        const human = humanizeError(prepared?.execution?.error?.code || prepared?.status || 'UNKNOWN', { locale });
        setMessages((prev) => [...prev, {
          id: makeId(),
          role: 'ai',
          content: prepared?.message || human.message,
          kind: 'error',
          ui: prepared?.ui || { type: 'TEXT' }
        }]);

        // §30 Recovery
        const checker = toolCheckerRef.current;
        const strategy = checker.getRetryStrategy({ message: prepared?.status }, { attempt: 0 });
        if (strategy.action === 'REFRESH_QUOTE') {
          // Auto refresh quote
          busV6.emit(EVENTS_V6.RECOVERY, { action: 'refresh_quote' });
        }
        return;
      }

      const hooks = {
        ...buildBrowserHooks(wallet),
        onProgress: (info) => {
          setProgress({
            index: info.index || 1,
            total: info.total || 1,
            status: info.status || info.action?.status,
            from: info.action?.from,
            to: info.action?.to
          });
          // §25 Streaming optimization: throttled scroll
          scrollMgrRef.current.onStreamingToken();
        }
      };
      const walletSnap = {
        connected: walletConnected,
        canSign: walletCanSign,
        address: wallet?.address || null,
        evmAddresses: aiContext.wallet.evmAddresses,
        chainId: wallet?.chainId || defaultChainId
      };
      const plannedActions = (prepared?.actionPlan?.actions?.length
        ? prepared.actionPlan.actions
        : (prepared?.actions?.length ? prepared.actions : actions)) || [action];

      setActivitySteps((prev) => prev.map((s) => s.id === 'quote_refresh' ? { ...s, status: 'completed' } : s.id === 'risk_check' ? { ...s, status: 'active' } : s));
      await new Promise((r) => setTimeout(r, 300)); // Simulate risk check
      setActivitySteps((prev) => prev.map((s) => s.id === 'risk_check' ? { ...s, status: 'completed' } : s.id === 'executing' ? { ...s, status: 'active' } : s));

      let result;
      if (isRebalanceKind(type)) {
        result = await runRebalance({
          holdings: aiContext.portfolio?.holdings,
          balances: aiContext.balances,
          target: rebalance?.target || prepared?.rebalance?.target,
          hooks,
          wallet: walletSnap
        });
      } else {
        result = await runExecutionPlan({
          actions: plannedActions,
          hooks,
          wallet: walletSnap
        });
      }
      if (result?.success === true && result?.status === 'CONFIRMED' && !result?.noop) {
        const hashes = result.txHashes || (result.txHash ? [result.txHash] : []);
        if (!hashes.length) {
          result = {
            ...result,
            success: false,
            status: 'FAILED',
            error: { code: 'NO_RECEIPT', message: 'NO_RECEIPT' }
          };
        }
      }
      const formatted = formatExecResult({
        result,
        rebalance: result?.rebalance || rebalance || prepared?.rebalance,
        locale
      });
      try { await aiExecutionResult({ execution: formatted.execution || result, rebalance, locale }); } catch {}
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: formatted.message,
        kind: formatted.execution?.success ? 'result' : 'error',
        ui: formatted.ui,
        card: formatted.card,
        execution: formatted.execution
      }]);
      if (formatted.execution?.success) {
        try {
          const current = os8StateRef.current || loadLocalIntentOSState('intent-unified');
          const executionHistory = Array.isArray(current.executionState?.history) ? current.executionState.history.slice() : [];
          executionHistory.push({
            executionId: current.executionState?.executionId || makeId('exec'),
            intentId: current.activeIntent || pendingExecution.intentId || null,
            status: 'CONFIRMED',
            txHash: formatted.execution?.txHash || result?.txHash || null,
            verification: formatted.execution || result || null,
            updatedAt: Date.now(),
            createdAt: Date.now()
          });
          const monitored = activateMonitoring({
            state: {
              ...current,
              executionState: {
                ...(current.executionState || {}),
                status: 'CONFIRMED',
                txHash: formatted.execution?.txHash || result?.txHash || null,
                lastVerification: formatted.execution || result || null,
                history: executionHistory.slice(-24)
              }
            },
            execution: executionHistory[executionHistory.length - 1],
            recommendations: current.agentState?.lastPresentedOptions?.filter?.((item) => item.selected).map((item) => item.label) || []
          });
          os8StateRef.current = monitored;
          saveLocalIntentOSState(monitored, 'intent-unified');
          void persistIntentOSSession(monitored, { ownerKey: 'intent-unified', remote: true }).catch(() => {});
        } catch {}
        clearPendingIntent();
        try { await multi?.refresh?.(); } catch {}
        setSolanaTick((v) => v + 1);
        try {
          const list = await aiAutomations();
          if (list?.ok) setAutomations(list.automations || []);
        } catch {}
        setConvState((prev) => updateIntentStatus(prev, INTENT_STATUS.COMPLETED));
        lifecycleRef.current.updateStatus(pendingExecution.intentId, INTENT_LIFECYCLE.COMPLETED);
        metricsRef.current.recordWalletExecution(true);
        obsRef.current.log({ intentId: pendingExecution.intentId, type: 'COMPLETION', payload: { status: 'COMPLETED' } });
        busV6.emit(EVENTS_V6.EXECUTION_COMPLETED, { success: true, intentId: pendingExecution.intentId });
        stateMachineRef.current.transition(STATES.VERIFYING, { reason: 'execution_done' });
        setActivitySteps((prev) => prev.map((s) => ({ ...s, status: 'completed' })));
        setTimeout(() => {
          stateMachineRef.current.transition(STATES.COMPLETED, { reason: 'verified' });
          setActivitySteps([]);
        }, 800);
      } else {
        metricsRef.current.recordWalletExecution(false);
        busV6.emit(EVENTS_V6.EXECUTION_COMPLETED, { success: false });
        stateMachineRef.current.transition(STATES.FAILED, { reason: 'execution_failed' });
      }
    } catch (err) {
      const human = humanizeError(err?.code || err?.message || 'UNKNOWN', { locale });
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: human.message,
        kind: 'error',
        ui: { type: human.ui === 'CONNECT_WALLET' ? 'CONNECT_WALLET' : 'TEXT' }
      }]);
      obsRef.current.log({ intentId: pendingExecution.intentId, type: 'ERROR', payload: { error: err.message } });
      metricsRef.current.recordWalletExecution(false);
      busV6.emit(EVENTS_V6.ERROR, { error: err.message });

      // §31 Retry Intelligence
      const checker = toolCheckerRef.current;
      const strategy = checker.getRetryStrategy(err, { attempt: 0 });
      if (strategy.recoverable) {
        busV6.emit(EVENTS_V6.RECOVERY, { strategy });
      }
    } finally {
      setPendingExecution(null);
      setExecuting(false);
      setProgress(null);
      setThinkingState('idle');
    }
  }, [pendingExecution, executing, aiContext, wallet, walletConnected, walletCanSign, defaultChainId, locale, t, openWalletSheet, conversationId, multi]);

  const chooseOption = useCallback((msg, choice) => {
    if (!choice) return;
    if (msg?.choiceKind === 'STRATEGY_OPTION') {
      const current = os8StateRef.current || loadLocalIntentOSState('intent-unified');
      const nextOptions = (current.agentState?.lastPresentedOptions || []).map((item) => ({
        ...item,
        selected: String(item.id) === String(choice.value || choice.id)
      }));
      os8StateRef.current = {
        ...current,
        agentState: {
          ...(current.agentState || {}),
          lastPresentedOptions: nextOptions
        },
        lastUpdated: Date.now()
      };
      saveLocalIntentOSState(os8StateRef.current, 'intent-unified');
      const selected = nextOptions.find((item) => item.selected) || nextOptions[0] || choice;
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: locale.startsWith('fa')
          ? `${choiceLabel(selected)} انتخاب شد. اگر بخواهی می‌توانم با «انجام بده» اجرای امن را آماده کنم.`
          : `${choiceLabel(selected)} selected. Say “do it” when you want me to prepare safe execution.`,
        kind: 'assistant',
        ui: { type: 'TEXT' },
        intentType: 'PORTFOLIO_ANALYSIS',
        detectedIntent: 'PORTFOLIO_ANALYSIS'
      }]);
      return;
    }
    const hints = {};
    if (msg?.choiceKind === 'WALLET') hints.walletAddress = choice.value;
    else if (msg?.choiceKind === 'SOURCE_ASSET') { hints.sourceAsset = choice.value; hints.chainId = choice.chainId ?? null; }
    else if (msg?.choiceKind === 'TARGET_ASSET') hints.targetAsset = choice.value;
    else if (msg?.choiceKind === 'AMOUNT') hints.amountExpression = choice.value;
    const original = loadPendingIntent()?.originalMessage || msg?.originalMessage || '';
    const followUp = msg?.choiceKind === 'AMOUNT'
      ? `${original} ${choice.value}`.trim()
      : original || choice.label;
    void sendRef.current?.(followUp, { hints, skipUserBubble: false });
  }, [locale]);

  const sendFeedback = useCallback((msg, rating) => {
    if (!msg?.intentId) return;
    void aiFeedback({ intentId: msg.intentId, rating });
  }, []);

  const editExecution = useCallback(() => {
    if (!pendingExecution) return;
    const promptMap = {
      SWAP: `می‌خواهم ${pendingExecution.action?.amount || ''} ${pendingExecution.action?.asset || pendingExecution.action?.from || ''} را تبدیل کنم.`,
      BRIDGE: `می‌خواهم ${pendingExecution.action?.asset || ''} را Bridge کنم.`,
      SEND: `می‌خواهم ${pendingExecution.action?.asset || ''} ارسال کنم.`,
      DCA: `هر هفته ${pendingExecution.action?.amount || '100'} دلار ${pendingExecution.action?.asset || 'BTC'} بخر.`,
      AUTOMATION_CREATE: `هر هفته ${pendingExecution.action?.amount || '100'} دلار ${pendingExecution.action?.asset || 'BTC'} بخر.`,
      GOAL: 'می‌خواهم هدف مالی بسازم.',
      REBALANCE: 'پرتفوی من را متعادل کن.',
      REBALANCE_PORTFOLIO: 'پرتفوی من را متعادل کن.'
    };
    const type = String(pendingExecution.intentType || pendingExecution.action?.type || '');
    setInput(promptMap[type] || pendingExecution.message || type);
    setPendingExecution(null);
  }, [pendingExecution]);

  useEffect(() => {
    void (async () => {
      try {
        const mem = await aiMemory();
        if (mem?.ok && mem.memory?.conversationSummary) setMemorySummary(mem.memory.conversationSummary);
        const list = await aiAutomations();
        if (list?.ok) setAutomations(list.automations || []);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!solanaAddressLive) {
      setSolanaRows([]);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const sol = await getSolanaBalance(solanaAddressLive);
        if (!cancelled) setSolanaRows([{ symbol: 'SOL', chainId: 501, amount: sol, valueUsd: null, dataStatus: 'live' }]);
      } catch {
        if (!cancelled) setSolanaRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [solanaAddressLive, solanaTick]);

  // UPGRADE 6 — Scroll handling with intelligent auto scroll
  const handleThreadScroll = useCallback(() => {
    scrollMgrRef.current.handleScroll();
  }, []);

  // Persist messages to convState and handle scroll
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    // Use scroll manager for intelligent auto scroll
    const result = scrollMgrRef.current.onNewMessage();
    if (result.showIndicator) {
      setShowNewMessageIndicator(true);
    }
  }, [messages, thinking, progress, pendingExecution, activitySteps]);

  // Sync messages to persistent state
  useEffect(() => {
    setConvState((prev) => {
      // Only update messages if different
      if (prev.messages.length === messages.length) return prev;
      return { ...prev, messages: messages.slice(-200), updatedAt: Date.now() };
    });
  }, [messages]);

  useEffect(() => {
    if (!walletConnected) {
      resumeLock.current = false;
      return;
    }
    if (resumeLock.current) return;
    const existing = loadPendingIntent();
    if (!existing || existing.status === 'COMPLETED' || existing.status === 'FAILED') return;
    const resumed = resumePendingIntent();
    if (!resumed.ok || !resumed.originalMessage) return;
    resumeLock.current = true;
    void sendRef.current?.(resumed.originalMessage, { resume: true, skipUserBubble: true });
  }, [walletConnected]);

  useEffect(() => {
    try {
      const last = getLastActiveTask();
      if (!last || last.status !== 'PENDING') return;
      // Opening a page is done. Never nag “unfinished HORIZON”.
      if (PAGE_OPEN_INTENTS.includes(last.intent) || last.intent === 'HORIZON' || last.intent === 'FOREX') {
        updateTaskStatus(last.id, 'COMPLETED');
        return;
      }
      if (Date.now() - last.createdAt < 30 * 60 * 1000) {
        setMessages(prev => {
          if (prev.some(m => m.taskId === last.id)) return prev;
          return [...prev, {
            id: makeId(),
            role: 'ai',
            content: locale.startsWith('fa')
              ? `یک کار ناتمام داری: ${last.intent}. ادامه بدهم؟`
              : `You have an unfinished task: ${last.intent}. Resume?`,
            kind: 'assistant',
            ui: { type: 'TEXT' },
            taskId: last.id,
            task: last
          }];
        });
      }
    } catch {}
  }, [locale]);

  const handleSubmit = useCallback((e) => {
    e?.preventDefault?.();
    if (input.trim()) void sendMessage(input);
  }, [input, sendMessage]);

  const connectWalletIfNeeded = useCallback(async () => {
    try {
      await connectSolana();
      setSolanaTick((v) => v + 1);
    } catch {}
  }, []);

  const refreshAutomations = useCallback(async () => {
    const list = await aiAutomations();
    if (list?.ok) setAutomations(list.automations || []);
  }, []);

  const toggleAutomation = useCallback(async (row) => {
    if (!row) return;
    if (row.status === 'ACTIVE' || row.active) {
      await aiPauseAutomation(row.id);
    } else {
      const made = await aiCreateAutomation({
        type: row.kind === 'rebalance' ? 'REBALANCE' : 'DCA',
        asset: row.asset || 'BTC',
        amount: String(row.amountUsd || ''),
        frequency: String(row.cadence || row.frequency || 'WEEKLY').toUpperCase(),
        chainId: row.chainId || null
      });
      if (made?.ok !== true) return;
    }
    await refreshAutomations();
  }, [refreshAutomations]);

  const runAutomationNow = useCallback(async (row) => {
    if (!row) return;
    const run = await aiRunAutomation(row.id);
    if (run?.ok && run.action) {
      setPendingExecution({
        action: run.action,
        actions: [run.action],
        message: `${row.kind || row.type} ${row.asset || ''}`.trim(),
        intentType: run.action.type,
        card: {
          title: t('intentAIOS.readyTitle', { defaultValue: '✦ آماده اجرا' }),
          kind: run.action.type,
          confirmLabel: t('intentAIOS.confirm', { defaultValue: 'تأیید و اجرا' }),
          editLabel: t('intentAIOS.edit', { defaultValue: 'ویرایش' })
        }
      });
    }
  }, [t]);

  const deleteAutomationRow = useCallback(async (row) => {
    if (!row) return;
    await aiDeleteAutomation(row.id);
    await refreshAutomations();
  }, [refreshAutomations]);

  const progressLine = progress
    ? formatExecutionProgress({
      index: progress.index,
      total: progress.total,
      status: progress.status,
      from: progress.from,
      to: progress.to,
      locale
    })
    : null;

  const card = pendingExecution?.card || null;

  const handleDebugToggle = useCallback(() => {
    const logs = getDebugLogs({ limit: 20 });
    const stats = getObsStats();
    const mem = getAllMemory();
    const memV2 = getAllMemoryV2();
    const obsV2 = obsRef.current.getRecent(5);
    const quality = metricsRef.current.getMetrics();
    setDebugInfo({
      logs,
      stats,
      mem,
      memV2,
      obsV2,
      quality,
      currentPage,
      convState: {
        sessionId: convState.sessionId,
        intentId: convState.intentId,
        currentIntent: convState.currentIntent,
        intentStatus: convState.intentStatus,
        collectedSlots: convState.collectedSlots,
        missingSlots: convState.missingSlots,
        lastQuestion: convState.lastQuestion,
        currentRoute: convState.currentRoute,
        previousRoute: convState.previousRoute
      },
      aiContext: { hasWallet: aiContext.wallet.connected, totalValue: aiContext.portfolio.totalValueUsd }
    });
    setShowDebug(v => !v);
    enableDebug();
  }, [currentPage, aiContext, convState]);

  const pushTurn = useCallback((m) => {
    setMessages((prev) => [...prev, m]);
    return m;
  }, []);

  const persistedCountRef = useRef(0);
  useEffect(() => {
    try {
      const fresh = messages.slice(persistedCountRef.current);
      if (fresh.length) {
        for (const m of fresh) {
          appendConversation({
            conversationId,
            role: m.role,
            content: m.content,
            kind: m.kind,
            intentType: m.intentType,
            operationId: m.operationId || null
          });
        }
        persistedCountRef.current = messages.length;
      }
    } catch {}
  }, [messages, conversationId]);

  const refreshMonitors = useCallback(async () => {
    try {
      const res = await listMonitors();
      if (res?.ok) {
        setMonitors(Array.isArray(res.monitors) ? res.monitors : []);
        setServerReachable(true);
      } else {
        setServerReachable(false);
      }
    } catch {
      setServerReachable(false);
    }
  }, []);

  const [storedOrders, setOrdersFromStore] = useState(loadOrders());

  const refreshStatus = useCallback(async () => {
    try {
      const [ms, orders] = await Promise.allSettled([
        apiMonitorEngineStatus(),
        Promise.resolve(loadOrders())
      ]);
      setMonitorEngineStatus(ms.status === 'fulfilled' ? ms.value : null);
      setServerReachable(ms.status === 'fulfilled' && ms.value?.ok === true);
      if (orders.status === 'fulfilled') setOrdersFromStore(orders.value);
    } catch {}
  }, []);

  useEffect(() => {
    void refreshMonitors();
    void refreshStatus();
    const t = setInterval(() => {
      void refreshMonitors();
      void refreshStatus();
      for (const m of monitors) {
        if (m.status === 'ACTIVE' && m.intervalMinutes <= 15) void apiEvaluateMonitor(m.id).catch(() => {});
      }
    }, 60000);
    return () => clearInterval(t);
  }, [refreshMonitors, refreshStatus]);

  const openEcosystem = useCallback((kind = 'agent') => {
    setEcoKind(kind);
    setPanel('ecosystem');
  }, []);

  /*
   * Reading the fleet. `fetchAiProviders` never rejects — the client bridge
   * turns every failure into `{ ok: false, error: 'TIMEOUT' | … }` — so the
   * old `.catch(() => {})` swallowed the only signal that something was wrong
   * and left the panel sitting on an empty array forever. The failure is now
   * recorded as a state the panel can render, with the reason, and there is a
   * retry that calls this same function.
   */
  const loadAiProviders = useCallback(async () => {
    setProvidersStatus('loading');
    setProvidersError(null);
    const res = await fetchAiProviders().catch(() => null);
    if (res?.ok && Array.isArray(res.providers)) {
      setAiProviders(res.providers);
      setProvidersStatus('ready');
      setProvidersError(null);
      return;
    }
    /* A fleet already on screen survives a failed refresh; only a first read
       that failed leaves the panel with nothing to show. */
    setProvidersStatus('error');
    setProvidersError(
      res?.error === 'TIMEOUT' ? 'TIMEOUT'
        : res?.status === 429 ? 'THROTTLED'
          : res?.status ? `HTTP_${res.status}`
            : (res?.error || 'NETWORK_UNAVAILABLE')
    );
  }, []);

  const openPanel = useCallback((name) => {
    setPanel(name);
    if (name === 'history') {
      setHistData(readHistory());
      void refreshMonitors();
    }
    if (name === 'status' || name === 'operations') {
      void refreshMonitors();
      void refreshStatus();
    }
    if (name === 'intelligence') {
      void loadAiProviders();
      fetchLearningStats().then((res) => {
        if (res?.ok) setLearningStats(res);
      }).catch(() => {});
    }
  }, [refreshMonitors, refreshStatus, loadAiProviders]);

  const appendOp = useCallback((op) => {
    try {
      const row = appendOperation({ conversationId, ...op });
      setHistData(readHistory());
      return row;
    } catch {
      return null;
    }
  }, [conversationId]);

  const runOpportunity = useCallback(async (card) => {
    setOpsBusy(true);
    const result = await runOpportunityEngine({
      portfolio: aiContext.portfolio,
      services: liveModuleServices,
      goal: null
    });
    const rows = result.opportunities || [];
    const ok = result.status === 'live';
    const summary = ok
      ? (locale.startsWith('fa')
        ? `اسکن فرصت انجام شد: ${rows.length} فرصت با داده واقعی (کیفیت داده: ${result.dataQuality}). هیچ بازدهی تضمینی نیست.`
        : `Opportunity scan complete: ${rows.length} opportunities with real data (quality: ${result.dataQuality}). No return is guaranteed.`)
      : (locale.startsWith('fa')
        ? 'موتور فرصت نتوانست داده کافی جمع کند؛ وضعیت داده: ' + result.dataStatus
        : 'The opportunity engine could not collect enough data. Data status: ' + result.dataStatus);
    pushTurn({
      id: makeId(),
      role: 'ai',
      kind: 'opportunity',
      ui: { type: 'OPPORTUNITY_CARD' },
      content: summary,
      opportunities: rows,
      dataQuality: result.dataQuality,
      card: { title: locale.startsWith('fa') ? '✦ موتور فرصت' : '✦ Opportunity Engine' }
    });
    appendOp({
      kind: 'OPPORTUNITY_SCAN',
      status: ok ? 'COMPLETED' : 'FAILED',
      title: card?.title || 'Opportunity scan',
      detail: `${rows.length} found · quality ${result.dataQuality} · no guarantees`,
      ref: null,
      refKind: null
    });
    setOpsBusy(false);
  }, [aiContext.portfolio, liveModuleServices, locale, pushTurn, appendOp]);

  const handleOpsAction = useCallback(async (card) => {
    if (!card) return;
    const avail = cardAvailability(card, { walletConnected, serverReachable: serverReachable !== false });
    if (avail.reason === 'WALLET_REQUIRED' && !walletConnected) {
      openWalletSheet(null, card.title);
      return;
    }
    setPanel(null);
    /*
     * ─── A MENU ENTRY WITH A DESTINATION GOES TO THAT DESTINATION ─────────
     * The old order here was: check `action`, else look up a chat prompt, and
     * only navigate if there was NO prompt. Most cards have a prompt, so most
     * cards were turned into a sentence and fed back into the assistant —
     * which then decided, on its own, whether the page was worth opening.
     *
     * That indirection is what produced «روی منو می‌زنی، سیگنال نمیاد»: the
     * Signals card became the message «سیگنال‌ها را نشان بده», the classifier
     * read it as an analysis request, and the page never opened. The user
     * tapped a destination and got a conversation instead.
     *
     * Now the menu is deterministic: `monitor` / `order` / `opportunity` keep
     * their own surfaces (they open a form or run a scan — there is no page to
     * go to), and everything else that names a route opens it. No loop check,
     * no prompt detour, nothing that can quietly decide not to go.
     */
    if (card.action === 'monitor') {
      setMonitorDraftOpen(true);
      return;
    }
    if (card.action === 'order') {
      if (card.id === 'goals_create' || card.id === 'auto_recurring' || card.id === 'auto_scheduled') {
        const seed = opsCardPrompt(card, locale);
        if (seed) { void sendMessage(seed); return; }
      }
      setOrderDraftOpen(true);
      return;
    }
    if (card.action === 'opportunity') {
      await runOpportunity(card);
      return;
    }
    if (card.route) {
      navigate(card.route);
      appendOp({ kind: 'NAVIGATE', status: 'COMPLETED', title: card.title, detail: card.desc, ref: card.route, refKind: 'route' });
      return;
    }
    const prompt = opsCardPrompt(card, locale);
    if (prompt) await sendMessage(prompt);
  }, [walletConnected, serverReachable, openWalletSheet, navigate, appendOp, sendMessage, runOpportunity, locale]);

  const handleMonitorCreate = useCallback(async (draft) => {
    setOpsBusy(true);
    let alert = {};
    try {
      const { pushIdentity } = await import('../lib/notify.js');
      const id = await pushIdentity();
      if (id?.endpoint) alert = { endpoint: id.endpoint, lang: locale };
    } catch {}
    const made = await apiCreateMonitor({ ...draft, alert, conversationId, source: 'intent-os-v6' });
    setMonitorDraftOpen(false);
    if (!made?.ok) {
      pushTurn({
        id: makeId(),
        role: 'ai',
        kind: 'error',
        ui: { type: 'TEXT' },
        content: (locale.startsWith('fa')
          ? 'پایش ایجاد نشد: ' : 'Monitor was not created: ') + String(made?.error || 'UNAVAILABLE')
      });
      setOpsBusy(false);
      return;
    }
    setMonitors((prev) => [made.monitor, ...prev]);
    setActiveContext({ type: 'monitor', id: made.monitor.id, label: made.monitor.label });
    pushTurn({
      id: makeId(),
      role: 'ai',
      kind: 'monitor',
      ui: { type: 'MONITOR_CARD' },
      content: (locale.startsWith('fa')
        ? `پایش «${made.monitor.label}» ایجاد شد و در سرور فعال است.`
        : `Monitor "${made.monitor.label}" created and active on the server.`),
      monitor: made.monitor
    });
    appendOp({
      kind: 'MONITOR_CREATE',
      status: 'ACTIVE',
      title: made.monitor.label,
      detail: `${made.monitor.asset?.symbol || 'MARKET'} ${made.monitor.metric} ${made.monitor.operator} ${made.monitor.threshold} · every ${made.monitor.intervalMinutes}m`,
      ref: made.monitor.id,
      refKind: 'monitor'
    });
    setOpsBusy(false);
  }, [conversationId, locale, pushTurn, appendOp]);

  const handleOrderCreate = useCallback(async (parsed) => {
    setOpsBusy(true);
    const made = createConditionalOrder(parsed, { chainId: 42161 });
    setOrderDraftOpen(false);
    if (made.error) {
      pushTurn({
        id: makeId(),
        role: 'ai',
        kind: 'error',
        ui: { type: 'TEXT' },
        content: (locale.startsWith('fa')
          ? 'سفارش شرطی ثبت نشد: ' : 'Conditional order not created: ') + String(made.error)
      });
      setOpsBusy(false);
      return;
    }
    const sync = await syncOrderWatches();
    const order = made.order;
    setActiveContext({ type: 'order', id: order.id, label: `${order.toToken.symbol} @ ${order.targetRate}` });
    pushTurn({
      id: makeId(),
      role: 'ai',
      kind: 'order',
      ui: { type: 'ORDER_CARD' },
      content: (locale.startsWith('fa')
        ? `سفارش شرطی واقعی ثبت شد و در صفحه Orders و پایش سرور فعال است. پر شدن با امضای شما در صفحه سواپ انجام می‌شود (میزان همگام‌سازی پایش: ${sync}).`
        : `Real conditional order stored. It is visible on /orders and mirrored to the server watcher (watch sync: ${sync}). Filling always requires your signature on the swap screen.`),
      order
    });
    appendOp({
      kind: 'ORDER_CREATE',
      status: sync === 'synced' ? 'ACTIVE' : 'WARNING',
      title: `${order.toToken.symbol} conditional buy`,
      detail: `${order.direction === 'above' ? '≥' : '≤'} ${order.targetRate} USD · ${order.amountIn} ${order.fromToken.symbol} · ${order.id}`,
      ref: order.id,
      refKind: 'order'
    });
    await refreshStatus();
    setOpsBusy(false);
  }, [locale, pushTurn, appendOp, refreshStatus]);

  const handleMonitorAction = useCallback(async (m, action) => {
    if (!m?.id) return;
    setOpsBusy(true);
    let out = null;
    if (action === 'pause') out = await apiPauseMonitor(m.id);
    else if (action === 'resume') out = await apiResumeMonitor(m.id);
    else if (action === 'cancel') out = await apiCancelMonitor(m.id);
    else if (action === 'evaluate') out = await apiEvaluateMonitor(m.id);
    if (out?.ok) await refreshMonitors();
    const verb = action === 'pause' ? (locale.startsWith('fa') ? 'متوقف شد' : 'paused')
      : action === 'resume' ? (locale.startsWith('fa') ? 'ادامه یافت' : 'resumed')
      : action === 'cancel' ? (locale.startsWith('fa') ? 'لغو شد' : 'cancelled')
      : (locale.startsWith('fa') ? 'بررسی شد' : 'checked');
    pushTurn({
      id: makeId(),
      role: 'ai',
      kind: action === 'cancel' ? 'error' : 'assistant',
      ui: { type: 'MONITOR_CARD' },
      content: `${m.label || m.asset?.symbol} ${verb}${out?.error ? ' — ' + out.error : ''}`,
      monitor: out?.monitor || { ...m, status: action === 'pause' ? 'PAUSED' : action === 'resume' ? 'ACTIVE' : action === 'cancel' ? 'CANCELLED' : m.status }
    });
    appendOp({
      kind: 'MONITOR_' + String(action).toUpperCase(),
      status: out?.ok === false ? 'FAILED' : (action === 'cancel' ? 'CANCELLED' : 'ACTIVE'),
      title: m.label || `${m.asset?.symbol || ''} monitor`,
      detail: action,
      ref: m.id,
      refKind: 'monitor'
    });
    setOpsBusy(false);
  }, [locale, refreshMonitors, pushTurn, appendOp]);

  const monitorOpportunityRow = useCallback(async (o) => {
    if (o?.apy != null) {
      await handleMonitorCreate({
        type: 'GOAL',
        metric: 'OPPORTUNITY',
        operator: 'ABOVE',
        threshold: o.apy,
        asset: { symbol: o.symbol || 'YIELD' },
        goalText: `Monitor ${o.kind} opportunities`,
        label: `${o.kind} APY ≥ ${Number(o.apy).toFixed(1)}%`,
        intervalMinutes: 360
      });
      return;
    }
    if (o?.priceUsd != null) {
      await handleMonitorCreate({
        type: 'ASSET',
        metric: 'PRICE',
        operator: 'ABOVE',
        threshold: Math.round((Number(o.priceUsd) * 1.05) * 100) / 100,
        asset: { symbol: o.symbol },
        label: `${o.symbol} ≥ ${Number(o.priceUsd).toFixed(0)} USD`,
        intervalMinutes: 60
      });
      return;
    }
    pushTurn({
      id: makeId(),
      role: 'ai',
      kind: 'assistant',
      ui: { type: 'TEXT' },
      content: locale.startsWith('fa')
        ? 'این فرصت نه قیمت لحظه‌ای دارد و نه APY قابل پایش؛ برای آن نمی‌توان پایش واقعی ساخت (و نمونهٔ ساختگی هم نمی‌سازم).'
        : 'This opportunity has neither a live price nor a watchable APY, so no real monitor can be created for it (and none will be faked).'
    });
  }, [handleMonitorCreate, pushTurn, locale]);

  const handleContextTurn = useCallback(async (message) => {
    const text = String(message || '').trim();
    const lower = text.toLowerCase();

    // Only a bare yes confirms a leftover draft. «اره پر سوده را» / «افق جهانی»
    // are new requests and must not fire the old monitor/order.
    if (pendingDraft && isBareFollowUp(text)) {
      const d = pendingDraft;
      setPendingDraft(null);
      if (d.kind === 'monitor') await handleMonitorCreate(d.parsed);
      else if (d.kind === 'order') await handleOrderCreate(d.parsed);
      return { handled: true };
    }
    if (pendingDraft && /ویرایش|تغییر|edit|change|cancel/i.test(text)) {
      const d = pendingDraft;
      setPendingDraft(null);
      if (d.kind === 'monitor') { setMonitorInitial(d.parsed.asset || d.parsed); setMonitorDraftOpen(true); }
      else { setOrderInitial(d.parsed); setOrderDraftOpen(true); }
      return { handled: true };
    }

    if (activeContext?.type === 'monitor') {
      const m = monitors.find((x) => x.id === activeContext.id) || monitors.find((x) => x.label === activeContext.label);
      if (m) {
        if (/متوقف|توقف|بایست|stop|pause/i.test(lower)) { await handleMonitorAction(m, 'pause'); return { handled: true }; }
        if (/فعال کن|ادامه بده|resume|start/i.test(lower)) { await handleMonitorAction(m, 'resume'); return { handled: true }; }
        if (/لغو|cancel|حذف|delete/i.test(lower)) { await handleMonitorAction(m, 'cancel'); return { handled: true }; }
        if (/بررسی کن|چک کن|check|status/i.test(lower)) { await handleMonitorAction(m, 'evaluate'); return { handled: true }; }
      }
    }

    const monitorIntent = /پایش|بپای|نظارت|watch|monitor|خبر بده|اطلاع بده|alert/i.test(text)
      && !/توقف|متوقف|لغو/i.test(text);

    if (monitorIntent && /سود|بازدهی|yield|return|apy/i.test(text)) {
      const pctMatch = text.match(/([0-9۰-۹.,]+)\s*(?:درصد|%|pct|percent)/i);
      let target = null;
      if (pctMatch) {
        const fa = pctMatch[1].replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
        target = parseFloat(fa.replace(/,/g, ''));
      }
      if (target != null && Number.isFinite(target) && target > 0 && target <= 200) {
        const p = {
          type: 'GOAL',
          metric: 'OPPORTUNITY',
          operator: 'ABOVE',
          threshold: target,
          asset: { symbol: 'YIELD' },
          goalText: `Watch for ${target}% returns`,
          label: `Yield ≥ ${target}%`,
          intervalMinutes: 360
        };
        setPendingDraft({ kind: 'monitor', parsed: p, message: text });
        pushTurn({
          id: makeId(),
          role: 'ai',
          kind: 'draft',
          ui: { type: 'TEXT' },
          content: locale.startsWith('fa')
            ? `پایش فرصت آماده است: بهترین APY واقعی ≥ ${target}٪ (بررسی هر ۶ ساعت). «انجامش بده»؟`
            : `Opportunity monitor ready: best real APY ≥ ${target}% (checked every 6h). Say "do it"?`
        });
        return { handled: true };
      }
    }

    if (monitorIntent) {
      const parsed = parseMonitorRequest(text, { locale });
      if (parsed.monitor?.threshold == null && !parsed.error) {
        setMonitorInitial(parsed.monitor || null);
        setMonitorDraftOpen(true);
        pushTurn({
          id: makeId(),
          role: 'ai',
          kind: 'assistant',
          ui: { type: 'TEXT' },
          content: locale.startsWith('fa')
            ? 'برای پایش واقعی، یک دارایی و یک شرط لازم است (مثلاً «آستانه 100000» یا «تغییر ۵٪»). فرم را پر کن یا بنویس: «اگر ETH کمتر از 3000 شد خبر بده».'
            : 'A real monitor needs an asset and a condition (e.g. threshold 100000 or 5% change). Fill the form or write: "alert me if ETH goes below 3000".'
        });
        return { handled: true };
      }
      if (parsed.monitor) {
        const p = parsed.monitor;
        setPendingDraft({ kind: 'monitor', parsed: p, message: text });
        setMonitorDraftOpen(true);
        pushTurn({
          id: makeId(),
          role: 'ai',
          kind: 'draft',
          ui: { type: 'TEXT' },
          content: locale.startsWith('fa')
            ? `شرط آماده است: ${p.asset?.symbol || 'بازار'} ${p.metric} ${p.operator} ${p.threshold} (هر ${p.intervalMinutes} دقیقه بررسی). «تأیید» یا «انجامش بده»؟`
            : `Condition ready: ${p.asset?.symbol || 'market'} ${p.metric} ${p.operator} ${p.threshold} (check every ${p.intervalMinutes}m). Say "confirm" or "do it".`
        });
        return { handled: true };
      }
      if (parsed.error === 'NO_CONDITION' || parsed.error === 'NO_AMOUNT') {
        setMonitorInitial(parsed.asset ? { asset: { symbol: parsed.asset } } : null);
        setMonitorDraftOpen(true);
        pushTurn({
          id: makeId(),
          role: 'ai',
          kind: 'assistant',
          ui: { type: 'TEXT' },
          content: locale.startsWith('fa')
            ? 'دارایی مشخص است ولی شرط (آستانه/درصد) را بنویس — یا فرم را پر کن.'
            : 'Asset is clear but the condition (threshold/percent) is missing — type it or use the form.'
        });
        return { handled: true };
      }
    }

    if (/بخر|buy|خرید/i.test(text) && /اگر|وقتی|when|if|به\s/i.test(text)) {
      const parsed = parseConditionalBuy(text, { chainId: 42161 });
      if (!parsed.error) {
        const preview = orderPreview(parsed);
        setPendingDraft({ kind: 'order', parsed, preview, message: text });
        setOrderInitial(parsed);
        setOrderDraftOpen(true);
        pushTurn({
          id: makeId(),
          role: 'ai',
          kind: 'draft',
          ui: { type: 'TEXT' },
          content: locale.startsWith('fa')
            ? `پیش‌نمایش خرید شرطی: ${parsed.asset} ${parsed.operator} ${parsed.target} دلار، ${parsed.amount} دلار USDT. این یک سفارش پایش واقعی است؛ اجرا با امضای تو در سواپ. «انجامش بده»؟`
            : `Conditional buy preview: ${parsed.asset} ${parsed.operator} ${parsed.target} USD, ${parsed.amount} USD USDT. This is a real watch order; the fill needs your signature on the swap screen. Say "do it"?`
        });
        return { handled: true };
      }
      if (parsed.error === 'NO_TARGET' || parsed.error === 'NOT_BUY' || parsed.error === 'NO_ASSET') {
        setOrderInitial({ asset: parsed.asset || 'BTC' });
        setOrderDraftOpen(true);
        pushTurn({
          id: makeId(),
          role: 'ai',
          kind: 'assistant',
          ui: { type: 'TEXT' },
          content: locale.startsWith('fa')
            ? 'برای سفارش شرطی، دارایی، قیمت هدف و مبلغ لازم است (مثال: «اگر BTC به 100000 رسید 100 دلار بخر»).'
            : 'A conditional order needs an asset, a target price and an amount (e.g. "if BTC hits 100000, buy $100").'
        });
        return { handled: true };
      }
    }

    if (/فرصت|opportunit|بهترین.*درآمد|بازدهی/i.test(text) && /هدف|goal|سود/i.test(text)) {
      pushTurn({
        id: makeId(),
        role: 'ai',
        kind: 'assistant',
        ui: { type: 'TEXT' },
        content: locale.startsWith('fa')
          ? 'در حال اجرای موتور فرصت روی پرتفوی و بازار واقعی…'
          : 'Running the opportunity engine on your real portfolio and the market…'
      });
      await runOpportunity(null);
      return { handled: true };
    }

    return { handled: false };
  }, [pendingDraft, activeContext, monitors, locale, pushTurn, handleMonitorCreate, handleOrderCreate, handleMonitorAction, runOpportunity]);

  contextHandlerRef.current = handleContextTurn;

  const handleContinue = useCallback((item) => {
    if (item?.refKind === 'monitor' || item?.kind === 'MONITOR_CREATE' || item?.id?.startsWith?.('mon_')) {
      const mon = monitors.find((x) => x.id === (item.ref || item.id));
      setActiveContext({ type: 'monitor', id: item.ref || item.id, label: item.title || mon?.label || 'monitor' });
    } else if (item?.refKind === 'order' || item?.kind === 'ORDER_CREATE') {
      setActiveContext({ type: 'order', id: item.ref || item.id, label: item.title || 'order' });
    } else {
      setActiveContext({ type: 'conversation', id: item.id, label: String(item?.content || item?.title || '').slice(0, 60) });
    }
    setPanel(null);
    pushTurn({
      id: makeId(),
      role: 'ai',
      kind: 'assistant',
      ui: { type: 'TEXT' },
      content: locale.startsWith('fa')
        ? `ادامهٔ «${item?.title || item?.content || activeContext?.label || 'عملیات'}». حالا می‌توانی بگویی «متوقفش کن» یا «شرطش را تغییر بده».`
        : `Context resumed for "${item?.title || item?.content || 'item'}". Try "stop it" or "change its condition".`
    });
  }, [monitors, locale, pushTurn]);

  return (
    <div className="iaos-page iaos-page-v6">
      <div className="iaos-shell">
        <header className="iaos-header">
          <div className="iaos-title" onClick={handleDebugToggle} style={{ cursor: 'pointer' }}>
            <span className="iaos-mark" aria-hidden="true">✦</span>
            <span className="iaos-title-copy">
              <h1>AI</h1>
              <span className="iaos-title-sub">Intent OS V8</span>
            </span>
            {/* Thinking Orb in header when active */}
            {thinkingState !== 'idle' ? (
              <ThinkingOrb state={thinkingState} size={18} locale={locale} showLabel={false} />
            ) : null}
          </div>
          <div className="iaos-header-status">
            {serverReachable != null ? (
              <span className="iaos-status-pill" data-on={serverReachable ? 'true' : 'false'} data-testid="intent-ai-status-pill">
                <i aria-hidden="true" />
                {serverReachable
                  ? (locale.startsWith('fa') ? 'آنلاین' : 'Online')
                  : (locale.startsWith('fa') ? 'آفلاین' : 'Offline')}
              </span>
            ) : null}
          </div>
        </header>

        {activeContext ? (
          <div className="iaos-context-chip" data-testid="intent-ai-context">
            <span>{locale.startsWith('fa') ? 'در حال ادامه:' : 'Continuing:'}</span>
            <strong>{activeContext.label}</strong>
            <button type="button" aria-label="Clear context" onClick={() => setActiveContext(null)}>✕</button>
          </div>
        ) : null}

        {/* Conversation state debug chip */}
        {convState.currentIntent && convState.intentStatus !== 'completed' ? (
          <div className="iaos-intent-chip" style={{ display: 'flex', gap: 6, fontSize: 11, color: '#a5b4fc', padding: '4px 8px', background: 'rgba(99,102,241,0.08)', borderRadius: 999, alignItems: 'center' }}>
            <span>✦ {convState.currentIntent}</span>
            <span style={{ opacity: 0.6 }}>· {convState.intentStatus}</span>
            {Object.keys(convState.collectedSlots || {}).length ? (
              <span style={{ opacity: 0.6 }}>· {Object.keys(convState.collectedSlots).length} slots</span>
            ) : null}
          </div>
        ) : null}

        {showDebug && debugInfo ? (
          <div className="iaos-debug" style={{ background: '#111', color: '#0f0', padding: '12px', borderRadius: '8px', marginBottom: '12px', fontSize: '11px', fontFamily: 'monospace', maxHeight: '400px', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <strong>AI Dashboard V6 (Debug) — Intent OS 6</strong>
              <button onClick={() => setShowDebug(false)} style={{ background: '#333', color: '#fff', border: 'none', padding: '2px 8px', borderRadius: '4px' }}>✕</button>
            </div>
            <div>Current Page: {debugInfo.currentPage} | Prev: {debugInfo.convState?.previousRoute}</div>
            <div>Session: {debugInfo.convState?.sessionId} | Intent: {debugInfo.convState?.intentId} | Status: {debugInfo.convState?.intentStatus}</div>
            <div>Wallet: {debugInfo.aiContext.hasWallet ? 'Connected' : 'Not connected'} | Portfolio: ${debugInfo.aiContext.totalValue || 0}</div>
            <div>Slots: {JSON.stringify(debugInfo.convState?.collectedSlots)} | Missing: {JSON.stringify(debugInfo.convState?.missingSlots)}</div>
            <div>Last Q: {debugInfo.convState?.lastQuestion} | Last A: {debugInfo.convState?.lastUserAnswer}</div>
            <div>Quality: {JSON.stringify(debugInfo.quality)}</div>
            <div style={{ marginTop: '8px' }}>Observability V6 (recent 3):</div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '10px' }}>{JSON.stringify(debugInfo.obsV2?.slice(0, 3), null, 2)}</pre>
            <div style={{ marginTop: '8px' }}>Memory V2: L1 {debugInfo.memV2?.l1?.length || 0} | L2 {debugInfo.memV2?.l2?.length || 0} | L3 {debugInfo.memV2?.l3?.length || 0}</div>
          </div>
        ) : null}

        {automations.length ? (
          <div className="iaos-autos" data-testid="intent-ai-active-automations">
            <div className="iaos-autos-head">
              <span>{t('intentAIOS.autosTitle', { defaultValue: 'ACTIVE AUTOMATIONS' })}</span>
              <button type="button" className="iaos-autos-manage" onClick={() => setAutosOpen((v) => !v)}>
                {t('intentAIOS.manage', { defaultValue: 'Manage' })}
              </button>
            </div>
            <div className="iaos-autos-list">
              {(autosOpen ? automations : automations.filter((a) => a?.status === 'ACTIVE')).slice(0, autosOpen ? 24 : 4).map((a) => (
                <div key={a.id} className="iaos-auto-row" data-status={a.status || ''}>
                  <strong>{a.asset || '—'} {String(a.kind || a.type || '').toUpperCase()}</strong>
                  <span>{a.frequency || a.cadence} · {a.amountUsd != null ? `$${a.amountUsd}` : ''} · {a.status || 'ACTIVE'}</span>
                  {autosOpen ? (
                    <div className="iaos-auto-actions">
                      <button type="button" onClick={() => toggleAutomation(a)}>{a.status === 'ACTIVE' ? 'Pause' : 'Resume'}</button>
                      <button type="button" onClick={() => runAutomationNow(a)}>Run</button>
                      <button type="button" className="iaos-auto-danger" onClick={() => deleteAutomationRow(a)}>×</button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* UPGRADE 6 — Chat container redesigned per §23 */}
        <div className="iaos-chat-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', flex: '1 1 auto', minHeight: 0 }}>
          <div className="iaos-conversation iaos-conversation-v6" ref={threadRef} onScroll={handleThreadScroll} aria-live="polite">
            {messages.map((m) => (
              <ConversationRow
                key={m.id}
                m={m}
                t={t}
                locale={locale}
                onConnectWallet={connectFromBubble}
                onChoose={chooseOption}
                onMonitorAction={handleMonitorAction}
                onMonitorOpportunity={monitorOpportunityRow}
                onFeedback={sendFeedback}
              />
            ))}

            {/* §27 Thinking Orb replaces text, §29 Activity Timeline */}
            {thinkingState !== 'idle' ? (
              <div className="iaos-msg iaos-ai">
                <div className="iaos-bubble iaos-thinking-v6" style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ThinkingOrb state={thinkingState} size={28} locale={locale} showLabel={true} />
                  </div>
                  {activitySteps.length ? (
                    <AIActivityTimeline steps={activitySteps} locale={locale} />
                  ) : (
                    <div className="iaos-thinking-legacy" style={{ fontSize: 12, color: 'rgba(226,232,240,0.7)' }}>
                      {thinking.map((s) => <span key={s} className="iaos-think-row">{s}</span>)}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {progressLine ? (
              <div className="iaos-progress" data-testid="intent-ai-progress" role="status">
                {progressLine}
              </div>
            ) : null}

            {pendingExecution ? (
              <div className="iaos-exec-card" role="group" data-testid="intent-ai-action-card">
                <div className="iaos-exec-title">
                  {card?.title || t('intentAIOS.readyTitle', { defaultValue: '✦ آماده اجرا' })}
                </div>
                {card?.headline ? <div className="iaos-exec-line">{card.headline}</div> : null}
                {Array.isArray(card?.rows) && card.rows.length ? (
                  <div className="iaos-alloc" data-testid="intent-ai-allocation">
                    {card.rows.map((row) => (
                      <div key={row.symbol} className="iaos-alloc-row">
                        <strong>{row.symbol}</strong>
                        <span>{Number.isFinite(Number(row.fromPct)) ? `${row.fromPct}%` : '—'} → {Number.isFinite(Number(row.toPct)) ? `${row.toPct}%` : '—'}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {card?.tradeCount != null ? (
                  <div className="iaos-exec-meta">
                    {locale?.startsWith?.('en')
                      ? `${card.tradeCount} trade(s)${card.estimatedFeeUsd != null ? ` · fee ~ $${card.estimatedFeeUsd}` : ''}`
                      : `${card.tradeCount} معامله${card.estimatedFeeUsd != null ? ` · کارمزد حدود $${card.estimatedFeeUsd}` : ''}`}
                  </div>
                ) : null}
                {/* Wallet snapshot info */}
                {pendingExecution.walletSnapshot ? (
                  <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.7)', marginTop: 8 }}>
                    {locale.startsWith('fa') ? 'اسنپ‌شات کیف پول: ' : 'Wallet snapshot: '}
                    {pendingExecution.walletSnapshot.address?.slice(0, 6)}...{pendingExecution.walletSnapshot.address?.slice(-4)}
                    {' · '}
                    {new Date(pendingExecution.walletSnapshot.timestamp).toLocaleTimeString()}
                  </div>
                ) : null}
                <div className="iaos-exec-actions">
                  <button type="button" className="iaos-btn iss-solid" onClick={confirmExecution} disabled={executing} data-testid="intent-ai-confirm">
                    {executing ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ThinkingOrb state="working" size={16} locale={locale} />
                        {t('intentAIOS.working', { defaultValue: 'در حال اجرا…' })}
                      </span>
                    ) : (card?.confirmLabel || t('intentAIOS.confirm', { defaultValue: 'تأیید و اجرا' }))}
                  </button>
                  <button type="button" className="iaos-btn iss-ghost" onClick={editExecution}>
                    {card?.editLabel || t('intentAIOS.edit', { defaultValue: 'ویرایش' })}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* §24 Intelligent Auto Scroll — New message indicator */}
          {showNewMessageIndicator ? (
            <button
              type="button"
              className="iaos-new-msg-indicator"
              onClick={() => {
                scrollMgrRef.current.clearNewMessageIndicator();
                setShowNewMessageIndicator(false);
              }}
              style={{
                alignSelf: 'center',
                margin: '8px 0',
                padding: '6px 14px',
                borderRadius: 999,
                border: '1px solid rgba(34,211,238,0.4)',
                background: 'rgba(34,211,238,0.12)',
                color: '#a5f3fc',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
              data-testid="new-message-indicator"
            >
              ↓ {locale.startsWith('fa') ? 'پیام جدید' : 'New message'}
            </button>
          ) : null}
        </div>

        {allChips.length ? (
          <div className="iaos-suggestions">
            <div className="iaos-suggestions-title">✦ {t('intentAIOS.suggestions', { defaultValue: 'پیشنهادهای مرتبط' })}</div>
            <div className="iaos-suggestions-row">
              {allChips.map((s) => (
                <button key={s.id} type="button" className="iaos-suggestion" onClick={() => sendSuggested(s)}>
                  <span className="iaos-suggestion-label">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {solana.available && !solanaAddressLive ? (
          <button type="button" className="iaos-solana-connect" onClick={connectWalletIfNeeded}>
            {t('intentAIOS.solanaConnect', { defaultValue: 'اتصال کیف پول Solana' })}
          </button>
        ) : null}

        {/* §26 Mobile optimization — keyboard-aware, safe-area */}
        <form className="iaos-composer iaos-composer-v6" onSubmit={handleSubmit}>
          <button type="button" className="iaos-action-btn" onClick={() => setDrawerOpen(true)} aria-label={t('intentAIOS.actions', { defaultValue: 'Actions' })}>
            + {t('intentAIOS.actions', { defaultValue: 'Actions' })}
          </button>
          <input
            className="iaos-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('intentAIOS.placeholder', { defaultValue: 'Ask Intent AI…' })}
            aria-label={t('intentAIOS.placeholder', { defaultValue: 'Ask Intent AI…' })}
            enterKeyHint="send"
          />
          <button type="submit" className="iaos-send" aria-label={t('intentAIOS.send', { defaultValue: 'Send' })} disabled={!input.trim() || thinkingState !== 'idle'}>➤</button>
        </form>

        <nav className="iaos-menubar" aria-label={locale.startsWith('fa') ? 'منوی عملیات' : 'Operations menu'}>
          <button type="button" className="iaos-menubar-btn" data-testid="intent-ai-operations" onClick={() => openPanel('operations')}>
            {opsText('ops.aria', locale)}
          </button>
          <button type="button" className="iaos-menubar-btn" data-testid="intent-ai-history" onClick={() => openPanel('history')}>
            {opsText('hist.title', locale)}
          </button>
          <button type="button" className="iaos-menubar-btn" data-testid="intent-ai-intelligence" onClick={() => openPanel('intelligence')}>
            {opsText('menu.multiAi', locale)}
          </button>
          <button type="button" className="iaos-menubar-btn" data-testid="intent-ai-ecosystem" onClick={() => openEcosystem('agent')}>
            {opsText('eco.menu', locale)}
          </button>
        </nav>
      </div>

      {drawerOpen ? (
        <div className="iaos-overlay" role="dialog" aria-modal="true" aria-label={t('intentAIOS.actions', { defaultValue: 'Actions' })}>
          <div className="iaos-drawer">
            <div className="iaos-drawer-head">
              <h2>{t('intentAIOS.actions', { defaultValue: 'Actions' })}</h2>
              <button type="button" className="iaos-close" onClick={() => setDrawerOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="iaos-drawer-grid">
              {drawerItems.map((item) => (
                <button key={item.id} type="button" className="iaos-drawer-item" onClick={() => runAction(item)}>
                  <span>{item.label}</span>
                  <small>{item.prompt}</small>
                </button>
              ))}
            </div>
            <p className="iaos-drawer-note">{t('intentAIOS.drawerNote', { defaultValue: 'پیشنهادات بر اساس موقعیت فعلی شما و پرتفوی است.' })}</p>
          </div>
        </div>
      ) : null}

      <OperationsPanel
        open={panel === 'operations'}
        onClose={() => setPanel(null)}
        availability={(card) => cardAvailability(card, { walletConnected, serverReachable: serverReachable !== false })}
        onAction={handleOpsAction}
        busy={opsBusy}
        locale={locale}
      />
      <HistoryPanel
        open={panel === 'history'}
        onClose={() => setPanel(null)}
        history={histData}
        monitors={monitors}
        onContinue={handleContinue}
        onMonitorAction={handleMonitorAction}
        busy={opsBusy}
        locale={locale}
      />
      <StatusPanel
        open={panel === 'status'}
        onClose={() => setPanel(null)}
        status={{
          walletConnected,
          serverReachable,
          monitors: monitorEngineStatus || { active: monitors.filter((m) => m.status === 'ACTIVE').length, total: monitors.length },
          ordersCount: storedOrders.length,
          automationsCount: automations.length,
          engine: monitorEngineStatus || {}
        }}
        locale={locale}
      />
      <IntelligencePanel
        open={panel === 'intelligence'}
        onClose={() => setPanel(null)}
        providers={aiProviders}
        providersStatus={providersStatus}
        providersError={providersError}
        onRetryProviders={() => { void loadAiProviders(); }}
        learningStats={learningStats}
        locale={locale}
      />
      <MonitorDraftForm
        key={monitorDraftOpen ? `mon-${monitorInitial ? `${monitorInitial.asset?.symbol || ''}${monitorInitial.metric || ''}` : 'open'}` : 'mon-closed'}
        open={monitorDraftOpen}
        onClose={() => setMonitorDraftOpen(false)}
        initial={monitorInitial}
        onCreate={handleMonitorCreate}
        busy={opsBusy}
        locale={locale}
      />
      <OrderDraftForm
        key={orderDraftOpen ? `ord-${orderInitial?.asset || 'open'}` : 'ord-closed'}
        open={orderDraftOpen}
        onClose={() => setOrderDraftOpen(false)}
        initial={orderInitial}
        onCreate={handleOrderCreate}
        busy={opsBusy}
        locale={locale}
      />

      <EcosystemPanel
        key={`eco-${ecoKind}`}
        open={panel === 'ecosystem'}
        onClose={() => setPanel(null)}
        locale={locale}
        initialKind={ecoKind}
      />

      <WalletConnectSheet open={walletSheetOpen} onClose={() => setWalletSheetOpen(false)} />
    </div>
  );
}
