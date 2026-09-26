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
/* Upgrade 13 — speech in, in every language the app ships. Pure helpers live in
   intent-ai/os/conversation/dictation.js so they are testable without a mic. */
import {
  speechSupport,
  speechRecognitionLangFor,
  normalizeTranscript,
  dictatedDraft
} from '../lib/intent-ai/os/conversation/dictation.js';
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
  aiResumeAutomation,
  aiDeleteAutomation,
  aiRunAutomation,
  aiExecutionResult,
  aiConfirm,
  aiFeedback,
  aiResearch
} from '../lib/aiIntentClient';
import { verifyPlanBinding } from '../lib/intent-ai/planDigest.js';
import { checkConstitution, explainConstitution } from '../lib/intent-ai/constitution.js';
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
import { resolveChatRoute } from '../lib/intent-ai/autonomy/chatRoutes.js';
import { buildAutonomyDrivers, warmAutonomyDrivers } from '../lib/intent-ai/autonomy/browserDrivers.js';
import { GoalPlanCard, AutonomyCard } from './AutonomyCards.jsx';
import { planFromIntent } from '../lib/intent-ai/autonomy/goalSources.js';
import { StrategyPlanCard } from './StrategyPlanCard.jsx';
import { buildStrategyFromChat, createChatStrategyRuntime } from '../lib/strategyBrain/chatBridge.js';
import { resolveGoalTurn } from '../lib/strategyBrain/goalTurn.js';
import { evaluateStrategyPreflight } from '../lib/strategyBrain/strategyPreflight.js';
import { reconcileStrategyReceipts, strategyActionRoute, strategyReceiptSupport } from '../lib/strategyBrain/strategyReceipts.js';
import {
  saveStrategyPlan, loadStrategyPlan, hydrateRuntimeArgs, linkRevision
} from '../lib/strategyBrain/strategyStore.js';
import { createAutonomyEngine, AUTONOMY_MODES } from '../lib/intent-ai/autonomy/botLoop.js';
import { BUILTIN_STRATEGIES, backtestStrategy } from '../lib/intent-ai/autonomy/strategyKit.js';
import { getOhlc } from '../lib/api';

/*
 * Candles for the autonomy loop and its backtester.
 *
 * The loop is only as honest as the data it trades on, so this goes through the
 * same OHLC reader the chart uses (lib/api.getOhlc) — which deliberately has no
 * offline fallback, because a candle with an invented high/low is exactly the
 * data a backtest must not be measured on. No candles means no backtest number,
 * and the card says so instead of showing a flattering zero-trade result.
 *
 * The symbol → id map is the small set this app actually trades; an unknown
 * symbol resolves through the id itself, and a miss is a thrown error the
 * caller turns into "not enough data", never a silent empty run.
 */
const COIN_IDS = Object.freeze({
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', USDC: 'usd-coin', USDT: 'tether',
  BNB: 'binancecoin', ARB: 'arbitrum', OP: 'optimism', MATIC: 'matic-network',
  AVAX: 'avalanche-2', DAI: 'dai', LINK: 'chainlink', TON: 'the-open-network'
});

async function fetchCandlesFor(asset, { days = 30 } = {}) {
  const symbol = String(asset || '').toUpperCase();
  const id = COIN_IDS[symbol] || String(asset || '').toLowerCase();
  if (!id) return [];
  const rows = await getOhlc(id, days, 'usd');
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ time: r.t ?? r.time ?? null, open: r.o, high: r.h, low: r.l, close: r.c }))
    .filter((r) => Number.isFinite(r.close) && Number.isFinite(r.high) && Number.isFinite(r.low));
}

const usdFmt = (v) => (Number.isFinite(Number(v))
  ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  : '—');

/* A monitor is "live" while it is still watching the market: ready (ACTIVE),
   deliberately held (PAUSED) or already matched (TRIGGERED). Terminal states
   (COMPLETED / CANCELLED / ERROR) are not counted as live. The Operations and
   Status surfaces must use the same definition as the History monitoring tab —
   otherwise the same set of monitors can be reported as "4 active / 8 total"
   by one panel and "8 active" by another. */
const LIVE_MONITOR_STATUSES = new Set(['ACTIVE', 'PAUSED', 'TRIGGERED']);
const isMonitorLive = (m) => LIVE_MONITOR_STATUSES.has(String(m?.status || '').toUpperCase());
const countLiveMonitors = (list) => (Array.isArray(list) ? list.filter(isMonitorLive).length : 0);
import { buildBrowserHooks } from '../lib/intent-ai/browserExecution.js';
import '../styles/intent-ai-os.css';
/*
 * Trench-agent skin: pure-black, minimal, tabbed (chat / agents / activity /
 * more) — the Trenchers-style look requested for the AI surface. Loads after
 * intent-ai-os.css on purpose: same-specificity rules there must lose.
 */
import '../styles/trench-agent.css';

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
import {
  AnimatedActivity,
  AnimatedAgent,
  AnimatedChat,
  AnimatedPlus,
  useStill
} from './AnimatedIcon';
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
  appendSeason,
  conversationsForSeason,
  loadThreadSnapshot,
  readHistory,
  saveThreadSnapshot,
  seasonsFromHistory
} from '../lib/intent-ai/os/historyStore.js';
import { cardAvailability } from '../lib/intent-ai/os/opsCatalog.js';
import {
  SUGGESTED_AGENTS,
  agentSlotQuestion,
  agentSummary,
  applyAgentChoice,
  buildAgentPayload,
  fillAgentSlot,
  fleetPrompt,
  isAgentCreateRequest,
  missingSlots,
  parseAgentRequest,
  primarySlot,
  suggestedDraft
} from '../lib/intent-ai/os/agentFactory.js';
import { getYields } from '../lib/yields.js';
import { loadOrders } from '../lib/orders.js';
import { fetchAiProviders, fetchGatewaySelfTest, fetchLearningStats, fetchAiTools } from '../lib/aiGatewayClient.js';
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
import { TokenMarketCard, PortfolioChatCard, ConditionalAllocationCard } from './IntentChatCards.jsx';

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
import { getL1Messages, addL1Message, getL2Tasks, addL2Task, getL3Preferences, addL3Preference, extractL3FromMessage } from '../lib/intent-ai/os/upgrade6/memoryV2.js';
import { ThinkingOrb, ThinkingOrbLarge, AIActivityTimeline } from './ai/ThinkingOrb.jsx';
/* ── PHASE 213 — THE CHAT **IS** THE INTENT OS SURFACE ──────────────────────
 * One durable open question (so the assistant cannot forget what it asked),
 * one bridge that mirrors real Intent OS events into the thread, the
 * coordination modes (human↔human, human↔agent, agent↔agent, agreement,
 * conflict, emergency) and an explicit web-search door — all in chat. */
import {
  askQuestion,
  bindAnswer,
  closeQuestion,
  getOpenQuestion,
  acknowledgement,
  answerBindingHint
} from '../lib/intent-ai/chat/questionLedger.js';
/* Multi-Slot Collector — پاسخ به مشکل «بعد از جواب یادش میره». وقتی کاربر
   هدف‌گذاری می‌کند (سرمایه، سود، بازه، ریسک)، یک فرم چندمرحله‌ای با باکس
   اختصاصی جواب فعال می‌شود تا هر پاسخ فقط به اسلات متناظر bind شود و
   بعد از جمع‌آوری همه اطلاعات، درخواست با «تفکر عمیق» تحلیل شود. */
import {
  startForm,
  getActiveForm,
  getCurrentSlot,
  submitAnswer as submitFormAnswer,
  cancelForm,
  clearForm,
  detectFormTrigger,
  FORMS
} from '../lib/intent-ai/chat/multiSlotCollector.js';
import { createSurfaceGate, eventToChatMessage } from '../lib/intent-ai/chat/osSurface.js';
import { buildNegotiationContext, runSurfaceCommand } from '../lib/intent-ai/chat/surfaceCommands.js';
import { offlineSocialFallback } from '../lib/intent-ai/chat/socialChat.js';
import { OsEventCard, PendingQuestionBar } from './chat/IntentOsSurface.jsx';
import {
  loadLocalIntentOSState,
  saveLocalIntentOSState,
  hydrateLegacyStateFromIntentOS,
  deriveIntentOSStateFromLegacy,
  bootstrapIntentOSSession,
  persistIntentOSSession,
  ingestUserTurn,
  activateMonitoring,
  resumeConversationState
} from '../lib/intent-ai/os/upgrade8/index.js';

const CONVERSATION_KEY = 'fbt.ai.os.conversation.v2';
const MAX_SUGGESTIONS = 4;
const DEFAULT_CHAIN = 42161;

/*
 * ─── SEASONS: THE THREAD SURVIVES UNTIL THE USER STARTS A NEW ONE ──────────
 * A «season» is one continuous chat episode. The rule is absolute: navigating
 * away (to swap, to farm, to another tab) NEVER wipes the thread, and coming
 * back NEVER starts a clean conversation. A new season begins only when the
 * user presses «+ سشن جدید» or continues an archived season from History.
 *
 * Three device-local keys make the semantics explicit (nothing here is sent
 * to any host — the thread lives in this browser's own storage):
 *
 *   SEASON_KEY       — which season the CURRENT thread belongs to.
 *   LAST_ACTIVE_KEY  — when /intent was last mounted/unmounted (analytics).
 *   HANDOFF_KEY      — an execution hand-off that is still waiting for its
 *                      outcome: the venue the user was sent to, so the return
 *                      turn can ask «انجام شد یا لغو شد؟» instead of guessing.
 */
const SEASON_KEY = 'fbt.ai.os.active-season';
const LAST_ACTIVE_KEY = 'fbt.ai.os.last-active';
const HANDOFF_KEY = 'fbt.ai.os.pending-handoff';
const HANDOFF_TTL_MS = 6 * 60 * 60 * 1000;

const ROUTE_FA_LABEL = Object.freeze({
  '/': 'بازار',
  '/swap': 'سواپ',
  '/bridge': 'بریج',
  '/farm': 'فارم',
  '/loan': 'وام',
  '/stocks': 'سهام',
  '/perp': 'فیوچرز',
  '/solana': 'سولانا',
  '/wallet': 'کیف پول',
  '/portfolio': 'پرتفوی',
  '/signals': 'سیگنال‌ها'
});

function routeFaLabel(route) {
  const path = String(route || '').split('?')[0];
  if (ROUTE_FA_LABEL[path]) return ROUTE_FA_LABEL[path];
  if (String(route || '').includes('tab=ops')) return 'مرکز عملیات';
  if (String(route || '').includes('tab=agents')) return 'ایجنت‌ها';
  return path || 'صفحه';
}

function readPendingHandoff() {
  try {
    const raw = localStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - Number(parsed.at || 0) > HANDOFF_TTL_MS) {
      try { localStorage.removeItem(HANDOFF_KEY); } catch {}
      return null;
    }
    return parsed;
  } catch { return null; }
}

function writePendingHandoff(handoff) {
  try { localStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...handoff, at: Date.now() })); } catch {}
}

function clearPendingHandoff() {
  try { localStorage.removeItem(HANDOFF_KEY); } catch {}
}

const fmtUsd = (v) => (Number.isFinite(Number(v))
  ? `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: Number(v) >= 100 ? 0 : 2 })}`
  : '—');
const fmtPct = (v, d = 2) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(d)}٪` : '—');

/*
 * «بررسی» must ANSWER, not nod. The evaluate endpoint returns the live
 * reading, the threshold and whether the condition holds — this turns that
 * into «قیمت الان X است، شرطت Y، این‌قدر فاصله داری» (or the yield version),
 * in the user's language. Pure: the same input always renders the same words.
 */
function monitorEvaluateReport(mon, out, { locale = 'fa' } = {}) {
  const fa = String(locale).startsWith('fa');
  const label = mon?.label || mon?.asset?.symbol || (fa ? 'دیده‌بان' : 'monitor');
  const ev = out?.evaluation || null;
  const triggered = out?.triggered === true;
  const metric = String(mon?.metric || 'PRICE').toUpperCase();
  const threshold = Number(mon?.threshold);
  const symbol = mon?.asset?.symbol || '';

  if (!ev || ev.ok === false) {
    const reason = ev?.reason || out?.error || 'NO_VALUE';
    return fa
      ? `«${label}» را بررسی کردم ولی خوانش زنده‌ای برنگشت (${reason}). شرطت سر جایش است و چیزی به‌اشتباه گزارش نشد — وقتی فید برگردد دوباره «بررسی» بزن.`
      : `I checked "${label}" but no live reading came back (${reason}). Your condition is untouched and nothing was misreported — hit Check again when the feed is back.`;
  }
  if (ev.armed) {
    return fa
      ? `«${label}» مسلح شد: مبنا از قیمت الان ${symbol} (${fmtUsd(ev.value)}) ثبت شد و از خوانش بعدی افت را با آن می‌سنجم.`
      : `"${label}" is armed: the baseline is the current ${symbol} price (${fmtUsd(ev.value)}); the drop is measured from the next read.`;
  }

  const verdict = triggered
    ? (fa ? 'شرط برقرار شد ✓' : 'Condition met ✓')
    : (fa ? 'فعلاً برقرار نیست.' : 'Not met right now.');
  const op = String(mon?.operator || 'ABOVE').toUpperCase();

  if (metric === 'OPPORTUNITY') {
    const best = Number(ev.display ?? ev.value);
    const gap = Number.isFinite(best) && Number.isFinite(threshold) ? threshold - best : null;
    return fa
      ? `«${label}»: بهترین سود واقعی الان ${fmtPct(best)} است و هدفت ${fmtPct(threshold)}. ${gap != null && gap > 0 ? `پس ${fmtPct(gap)} فاصله داری.` : ''} ${verdict}`
      : `"${label}": best real yield is ${fmtPct(best)}, your target ${fmtPct(threshold)}. ${verdict}`;
  }
  if (metric === 'PERCENT_CHANGE') {
    const sample = Number(ev.sample ?? ev.display);
    const base = Number(mon?.baseline);
    const need = op === 'BELOW' ? -threshold : threshold;
    return fa
      ? `«${label}»: تغییر ${symbol} از مبنا ${Number.isFinite(sample) ? `${sample.toFixed(2)}٪` : '—'} است${Number.isFinite(base) ? ` (مبنا ${fmtUsd(base)})` : ''}؛ شرط «${op === 'BELOW' ? `افت ${fmtPct(threshold)}` : `رشد ${fmtPct(threshold)}`}» ${Number.isFinite(sample) ? `(الان ${sample.toFixed(2)}٪ در برابر آستانه ${need.toFixed(0)}٪)` : ''}. ${verdict}`
      : `"${label}": ${symbol} changed ${Number.isFinite(sample) ? `${sample.toFixed(2)}%` : '—'} from baseline; trigger at ${need.toFixed(0)}%. ${verdict}`;
  }
  if (metric === 'PRICE') {
    const price = Number(ev.display ?? ev.value);
    const dirFa = op === 'BELOW' ? 'زیر' : 'بالای';
    let dist = '';
    if (Number.isFinite(price) && Number.isFinite(threshold) && price > 0 && !triggered) {
      const d = op === 'BELOW' ? ((price - threshold) / price) * 100 : ((threshold - price) / price) * 100;
      dist = d > 0 ? (fa ? `یعنی ${fmtPct(d)} فاصله داری. ` : `That's ${fmtPct(d)} away. `) : '';
    }
    return fa
      ? `«${label}»: قیمت فعلی ${symbol} ${fmtUsd(price)} است؛ شرطت «${dirFa} ${fmtUsd(threshold)}». ${dist}${verdict}`
      : `"${label}": ${symbol} is ${fmtUsd(price)}; your condition is "${op === 'BELOW' ? 'below' : 'above'} ${fmtUsd(threshold)}". ${dist}${verdict}`;
  }
  const val = ev.display ?? ev.value;
  return fa
    ? `«${label}»: خوانش فعلی ${val} در برابر آستانه ${threshold}. ${verdict}`
    : `"${label}": current reading ${val} vs threshold ${threshold}. ${verdict}`;
}

/*
 * A restored thread (snapshot or archive) must behave like a live one: stale
 * choice buttons on OLD messages would re-fire dead questions, so choices
 * survive only on the last message that carries them — the pending question.
 */
function sanitizeRestoredThread(list) {
  const msgs = Array.isArray(list) ? list : [];
  let lastChoiceIdx = -1;
  msgs.forEach((m, i) => {
    if (Array.isArray(m?.choices) && m.choices.length && !m.responded) lastChoiceIdx = i;
  });
  return msgs.map((m, i) => {
    if (!m || typeof m !== 'object') return m;
    if (i === lastChoiceIdx) return m;
    if (!Array.isArray(m.choices) || !m.choices.length) return m;
    const { choices, choiceKind, ...rest } = m;
    return rest;
  });
}

function makeId() {
  try { return crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  catch { return `m-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function makeSeasonId() { return `season_${makeId()}`; }

function readSeasonId() {
  try { return localStorage.getItem(SEASON_KEY) || ''; } catch { return ''; }
}
function writeSeasonId(id) {
  try { localStorage.setItem(SEASON_KEY, String(id || '')); } catch { /* private mode */ }
}
function readLastActive() {
  try { return Number(localStorage.getItem(LAST_ACTIVE_KEY)) || 0; } catch { return 0; }
}
function writeLastActive() {
  try { localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())); } catch { /* private mode */ }
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

/* Exported for the greeting-language suite (test/intent-ai-greeting-language.test.jsx):
   the row is where a persisted hello becomes visible, so that is where the
   "it must follow the language picker" rule has to be provable. */
export const ConversationRow = memo(function ConversationRow({
  m,
  t,
  locale,
  onConnectWallet,
  onChoose,
  onMonitorAction,
  onMonitorOpportunity,
  onFeedback,
  onOpenRoute,
  onOsChip,
  onGoalExecute,
  onStrategyExecute,
  onStrategyMonitor,
  onStrategyRevise,
  strategyLive,
  autonomyEngine,
  autonomyStrategies,
  onAutonomyArm,
  onAutonomyDisarm,
  onAutonomyMode,
  onAutonomyStart,
  onAutonomyStop,
  onAutonomyTick
}) {
  const fa = locale.startsWith('fa');
  const intel = m.intelligence || null;
  const sources = Array.isArray(intel?.sources) ? intel.sources.filter((s) => s?.url && /^https:/i.test(String(s.url))) : [];
  /* Only the actions that actually name a destination can be chips. Keeping
     the filter here (rather than trusting every payload to be uniform) is
     what stops one route-less action from hiding the whole row. */
  const actionRoutes = Array.isArray(m.actions)
    ? m.actions.filter((a) => a && typeof a.route === 'string' && a.route.trim())
    : [];
  return (
    <div className={`iaos-msg iaos-${m.role} ${m.kind ? `iaos-kind-${m.kind}` : ''}`}>
      <div className="iaos-bubble">
        {/*
          THE GREETING IS TRANSLATED AT RENDER TIME, NOT WHEN IT IS CREATED.
          «با وجود زبان انگلیسی در هوش مصنوعی باز این جمله فارسیه — سلام من AI
          هستم…» The hello used to be baked into the message as a string, so it
          froze in whatever language the app happened to be in when the thread
          started — and because the thread is persisted and restored, an English
          session resumed on a device that had once been Persian reopened with a
          Persian greeting and no way to change it short of wiping the thread.
          Every other turn is the user's own words or a real answer, so those
          keep their stored text; only `kind === 'hello'` is re-read from the
          dictionary, which means it follows the language picker instantly.
        */}
        <div className="iaos-msg-text">{m.kind === 'hello' ? t('intentAIOS.hello') : m.content}</div>
        {m.ui?.type === 'CONNECT_WALLET' ? (
          <button
            type="button"
            className="iaos-btn iss-solid iaos-connect-btn"
            data-testid="intent-ai-connect-wallet"
            onClick={onConnectWallet}
          >
            {t('intentAIOS.connectWallet')}
          </button>
        ) : null}
        {Array.isArray(m.choices) && m.choices.length && !m.responded ? (
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
        {m.responded && m.selectedChoiceLabel ? (
          <div className="iaos-choice-answered" data-testid="intent-ai-choice-answered">✓ {m.selectedChoiceLabel}</div>
        ) : null}
        {m.ui?.type === 'RESULT_CARD' && m.card?.txHash ? (
          <div className="iaos-result-hash" data-testid="intent-ai-tx-hash">{m.card.txHash}</div>
        ) : null}
        {/* Phase 213 — an Intent OS event / negotiation transcript rendered as
            a real bubble. Everything on it comes from the module layer; the
            chips ask the next real question instead of navigating blindly. */}
        {m.kind === 'os' && m.osEvent ? (
          <OsEventCard event={m.osEvent} locale={locale} onChip={onOsChip} onOpenRoute={onOpenRoute} />
        ) : null}
        {/* Rich tool-output cards: live token chart + 24h high/low, and the
            allocation view for portfolio answers. */}
        {m.card?.kind === 'TOKEN' ? (
          <TokenMarketCard card={m.card} locale={locale} onOpenRoute={onOpenRoute} />
        ) : null}
        {m.card?.kind === 'PORTFOLIO' ? (
          <PortfolioChatCard card={m.card} locale={locale} onOpenRoute={onOpenRoute} />
        ) : null}
        {/* Phase 217 — a cross-asset conditional instruction («اگر طلا ۵٪ اصلاح
            کرد و BTC بالای X بود، ۱۰٪ سرمایه را به طلا اختصاص بده»). The
            conditions, what each one read, and the allocation — so a misread
            trigger is visible and correctable before anything is armed. */}
        {m.ui?.type === 'CONDITIONAL_ALLOCATION' ? (
          <ConditionalAllocationCard ui={m.ui} locale={locale} onOpenRoute={onOpenRoute} />
        ) : null}
        {/* Route chips («فارم», «بازار», «نمودار کامل»…) built by the human
           layer from real results — one tap navigates, no re-typing.

           The gate used to be `m.actions.every(a => a.route)`: ONE action
           without a route hid the ENTIRE row, so a payload like
           [{ id:'copy-tx' }, { id:'open-ops', route:'/intent?tab=ops' }]
           rendered no buttons at all and both were dead. Filter instead of
           all-or-nothing: every action that names a destination gets its
           chip, and one that does not is dropped rather than taking its
           neighbours down with it. */}
        {actionRoutes.length ? (
          <div className="iaos-msg-actions" data-testid="intent-ai-msg-actions">
            {actionRoutes.map((a) => (
              <button
                key={a.id || a.route}
                type="button"
                className="iaos-btn iss-ghost iaos-msg-action"
                onClick={() => onOpenRoute(a.route)}
              >
                {a.label || a.route} ↗
              </button>
            ))}
          </div>
        ) : null}
        {m.goalRequest ? (
          <GoalPlanCard
            plan={m.goalPlan}
            capital={m.goalPlan?.capitalUsd}
            locale={locale}
            busy={Boolean(m.goalBusy)}
            error={m.goalError || null}
            onExecute={onGoalExecute ? (option) => onGoalExecute(m, option) : null}
            onOpenRoute={onOpenRoute}
          />
        ) : null}
        {/* The cross-module Portfolio Strategy: what the ecosystem read, the
            options compared, the allocation, the staged handoffs and the
            monitors. Everything on it comes from the plan object. */}
        {m.strategyRequest ? (
          <StrategyPlanCard
            plan={m.strategyPlan}
            spec={m.strategySpec || null}
            busy={Boolean(m.strategyBusy)}
            error={m.strategyError || null}
            locale={locale}
            onOpenRoute={onOpenRoute}
            onExecuteStage={onStrategyExecute ? (strategy) => onStrategyExecute(m, strategy) : null}
            onMonitor={onStrategyMonitor ? (strategy) => onStrategyMonitor(m, strategy) : null}
            onRevise={onStrategyRevise ? (strategy) => onStrategyRevise(m, strategy) : null}
            live={m.strategyPlan?.strategyId ? (strategyLive?.[m.strategyPlan.strategyId] || null) : null}
          />
        ) : null}
        {m.autonomyRequest ? (
          <AutonomyCard
            strategies={autonomyStrategies}
            engine={autonomyEngine}
            locale={locale}
            onArm={onAutonomyArm}
            onDisarm={onAutonomyDisarm}
            onMode={onAutonomyMode}
            onStart={onAutonomyStart}
            onStop={onAutonomyStop}
            onTick={onAutonomyTick}
            onOpenRoute={onOpenRoute}
          />
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
        {m.multiAi && (m.multiAi.riskScore || m.multiAi.dataFreshness) ? (
          <div className="iaos-multi-ai-badge" data-testid="intent-ai-multi-model-badge">
            <span className="iaos-model-pill">✦ Multi-AI</span>
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
          <AIActivityTimeline steps={mapPlanStepsForTimeline(m.upgrade7.plan.steps)} locale={locale} final />
        ) : null}
        {/*
          * The confidence meter («اطمینان: پایین · 36%»), its unverified-data
          * notices, the agent-consensus box («اجماع Agentها 4 agents · 100%»)
          * and the low-confidence warning are deliberately NOT rendered: the
          * answer carries its evidence inline (sources, numbers, receipts),
          * and the meters only added noise to the bubble. The data stays on
          * the message for probes — only the rendering is gone.
          */}
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
        {/* The 👍/👎 row is deliberately not rendered (same rationale as the
            meters above): a tap target on every answer added clutter without
            changing the next answer. `onFeedback` stays a prop so the parent
            API is unchanged. */}
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

export default function IntentAIUnified({ defaultChainId = DEFAULT_CHAIN }) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language || 'fa';
  const wallet = useWallet();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPage = location.pathname || '/intent';

  // UPGRADE 8 — OS state refs must be initialized BEFORE convState boot
  const os8StateRef = useRef(loadLocalIntentOSState('intent-unified'));
  const os8SyncSigRef = useRef('');
  const os8HydratedRef = useRef(false);

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

  /*
   * Decided exactly once per mount: is this the same visit (resume the thread)
   * or a fresh one (start a new season)? Must be declared BEFORE the
   * initialization block below, because the very first render uses it to
   * choose between the archived thread and a clean conversation.
   */
  const [visitInfo] = useState(() => {
    /*
     * The thread ALWAYS resumes. A timeout-based "fresh visit" used to wipe
     * the conversation whenever the user came back from swap/farm after 15
     * minutes — that was the chat-wipe bug. Now a new season starts only via
     * the «+» button (newSeason) or by continuing an archived season.
     */
    let seasonId = readSeasonId();
    if (!seasonId) {
      seasonId = makeSeasonId();
      writeSeasonId(seasonId);
    }
    writeLastActive();
    return { seasonId, isReturning: true };
  });
  const seasonIdRef = useRef(visitInfo.seasonId);

  // Initialize once
  if (!convStateRef.current) {
    const bootState = os8StateRef.current || loadLocalIntentOSState('intent-unified');
    const hydrated = hydrateLegacyStateFromIntentOS(bootState);
    const loadedConv = loadConversationState();
    /*
     * A fresh visit does NOT pick up the previous thread: those messages are
     * an archived season now, not the live conversation. `baseConv` is the
     * previous conversation only when the user is genuinely returning within
     * the visit window; otherwise it is a clean state that keeps the same
     * sessionId so the identity never churns.
     */
    const baseConv = visitInfo.isReturning
      ? loadedConv
      : createConversationState({ sessionId: loadedConv?.sessionId, currentRoute: loadedConv?.currentRoute || currentPage });
    convStateRef.current = (!baseConv?.messages?.length && hydrated?.messages?.length && visitInfo.isReturning)
      ? {
          ...baseConv,
          ...(hydrated?.convStatePatch || {}),
          messages: hydrated.messages
        }
      : baseConv;
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

  // Messages backed by persistent ConversationState (§1), with the device-local
  // thread snapshot as the second layer: convState expires after 24h and caps
  // at 200 turns, while the snapshot keeps the full thread (cards, choices,
  // strategy plans) until the user starts a new season. Either way the thread
  // resumes — a clean hello appears only when there is genuinely nothing.
  const [messages, setMessages] = useState(() => {
    const persisted = visitInfo.isReturning ? (convStateRef.current.messages || []) : [];
    if (persisted.length) return persisted;
    try {
      const snap = loadThreadSnapshot(visitInfo.seasonId);
      if (Array.isArray(snap) && snap.length) {
        const clean = sanitizeRestoredThread(snap);
        // Seed the SAME object the convState state already captured — a
        // replacement would be overwritten by the convState sync effect.
        try { convStateRef.current.messages = clean; } catch {}
        return clean;
      }
    } catch { /* corrupted snapshot: fall through to hello */ }
    return [{
      id: makeId(),
      role: 'ai',
      content: t('intentAIOS.hello'),
      kind: 'hello',
      ui: { type: 'TEXT' }
    }];
  });
  /* A live handle on the thread for handlers that must read it without
     re-subscribing (the hand-off outcome needs the strategy plan). */
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; });
  /*
   * The agent-creation loop lives below (it needs the monitor/automation
   * creators), but choice taps arrive at `chooseOption` above — so the loop
   * publishes itself through this ref, the same pattern as contextHandlerRef.
   * `pendingAgentDraftRef` is the slot the loop is currently waiting for.
   */
  const agentOpsRef = useRef(null);
  const pendingAgentDraftRef = useRef(null);

  const [input, setInput] = useState('');
  /*
   * Trench-style surface tabs. `chat` is the whole legacy conversation; the
   * other three are new views over state the page already owns (automations,
   * monitors, history, panels) — nothing here introduces a second brain.
   */
  const [aiTab, setAiTab] = useState('chat');
  const still = useStill();
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
  /* `autosOpen` died with the chat-view autos strip — agents now render as
     cards on the AGENTS tab, which needs no collapsed/expanded mode. */
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
  /* Phase 213 — the open question, made visible. It is restored from storage on
     mount (a question asked before a reload is still waiting after it), and the
     ack line is the proof that an answer was recorded rather than politely
     ignored. */
  const [openQuestion, setOpenQuestion] = useState(() => getOpenQuestion({ conversationId }));
  const [questionAck, setQuestionAck] = useState(null);
  /* Multi-Slot Form (فرم چندمرحله‌ای): وقتی فعال است، کامپوزر اصلی غیرفعال
     می‌شود و یک باکس اختصاصی جواب بالای آن ظاهر می‌شود تا کاربر دقیقاً
     پاسخش را به همان اسلات بدهد و سیستم بعد از گرفتن تمام اطلاعات با
     «تفکر عمیق» تحلیل کند. */
  const [multiSlot, setMultiSlot] = useState(() => {
    const slot = getCurrentSlot({ conversationId, locale: (i18n?.language || 'fa') });
    return slot ? { slot, ack: null } : { slot: null, ack: null };
  });
  const [multiSlotParseError, setMultiSlotParseError] = useState(null);
  const surfaceGateRef = useRef(null);
  const [panel, setPanel] = useState(null);
  const [ecoKind, setEcoKind] = useState('agent');
  const [opsBusy, setOpsBusy] = useState(false);
  const [monitors, setMonitors] = useState([]);
  const [monitorEngineStatus, setMonitorEngineStatus] = useState(null);
  const [serverReachable, setServerReachable] = useState(null);
  const [activeContext, setActiveContext] = useState(null);
  const [aiProviders, setAiProviders] = useState([]);
  /*
   * The fleet summary and the live self-test.
   *
   * `configured: true` on nine cards is what the panel used to show while eight
   * of those nine could not complete a single call — every key was saved, and
   * the models behind them were retired, over-tier or out of credit. The summary
   * says how many keys exist AND how many answered; the self-test is the button
   * that goes and asks each provider for real, then prints the reason and the
   * fix per model. Neither number is derived here — both arrive from the
   * gateway.
   */
  const [aiFleetSummary, setAiFleetSummary] = useState(null);
  const [aiSelfTest, setAiSelfTest] = useState(null);
  const [aiSelfTestBusy, setAiSelfTestBusy] = useState(false);
  const [aiSelfTestError, setAiSelfTestError] = useState(null);
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
  /* Server-side tool registry — the wiring report shown in the Status panel:
     how many tools the AI can actually reach through /v1/ai. */
  const [aiToolsInfo, setAiToolsInfo] = useState(null);
  const [monitorDraftOpen, setMonitorDraftOpen] = useState(false);
  const [orderDraftOpen, setOrderDraftOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState(null);
  const [histData, setHistData] = useState(() => {
    try {
      return readHistory();
    } catch {
      return { conversations: [], operations: [], seasons: [] };
    }
  });
  const seasons = useMemo(() => seasonsFromHistory({ history: histData }), [histData]);
  const [monitorInitial, setMonitorInitial] = useState(null);
  const [orderInitial, setOrderInitial] = useState(null);
  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false);
  const contextHandlerRef = useRef(null);

  /* ── PHASE 213: Intent OS events become chat rows ────────────────────────
   * Everything the OS does outside the conversation (an execution finishing, an
   * agent completing, a wallet connecting, an error, a recovery) used to be
   * invisible here: the user had to go and find it in a panel. The mirror is
   * deliberately conservative — a noise list plus a fingerprint gate keep
   * bookkeeping out and stop a retry from stacking identical rows — and it
   * appends a FACT, never an instruction. */
  useEffect(() => {
    const gate = surfaceGateRef.current || (surfaceGateRef.current = createSurfaceGate());
    const append = (event) => {
      let row = null;
      try {
        row = eventToChatMessage(event, { locale, gate });
      } catch { row = null; }
      if (!row) return null;
      setMessages((prev) => [...prev, row]);
      setConvState((prev) => appendConvMessage(prev, row));
      return row;
    };
    const unsubV6 = busV6.on('*', (event) => {
      append({ type: event?.type, payload: event?.payload || {}, timestamp: event?.timestamp });
    });
    const unsubGlobal = onEvent('*', (event) => {
      append({ type: event?.type, payload: event?.payload || {}, timestamp: event?.timestamp });
    });
    return () => {
      try { unsubV6?.(); } catch { /* already gone */ }
      try { unsubGlobal?.(); } catch { /* already gone */ }
    };
  }, [locale]);

  /* Restore / refresh the open question AND any multi-slot form whenever the
     conversation switches or the page is reloaded (durable localStorage). */
  useEffect(() => {
    setOpenQuestion(getOpenQuestion({ conversationId }));
    setQuestionAck(null);
    const activeSlot = getCurrentSlot({ conversationId, locale: i18n?.language || 'fa' });
    setMultiSlot(activeSlot ? { slot: activeSlot, ack: null } : { slot: null, ack: null });
    setMultiSlotParseError(null);
  }, [conversationId, i18n?.language]);

  useEffect(() => {
    if (!questionAck) return undefined;
    const timer = setTimeout(() => setQuestionAck(null), 8000);
    return () => clearTimeout(timer);
  }, [questionAck]);

  // Auto-refresh activity history when entering activity tab
  useEffect(() => {
    if (aiTab === 'activity') {
      try {
        setHistData(readHistory());
      } catch {}
    }
  }, [aiTab]);

  // Request Android native fullscreen on /intent to remove status/navigation bars and stretch screen
  useEffect(() => {
    try {
      window.FBTSystemUI?.setFullscreen?.(true);
    } catch {}
    return () => {
      try {
        window.FBTSystemUI?.setFullscreen?.(false);
      } catch {}
    };
  }, []);

  const userTaskCount = useMemo(() => {
    return (messages || []).filter((m) => m.sender === 'user' || m.role === 'user').length;
  }, [messages]);
  const isSessionFull = userTaskCount >= 10;

  const handleStartNewChat = useCallback(() => {
    try {
      if (messages.length > 1) {
        const firstUserMsg = messages.find((m) => m.sender === 'user' || m.role === 'user');
        recordHistoryItem({
          id: `hist-${Date.now()}`,
          timestamp: Date.now(),
          type: 'chat_session',
          title: firstUserMsg?.content?.slice(0, 45) || (locale.startsWith('fa') ? 'گفتگوی قبلی هوش مصنوعی' : 'Past AI Session'),
          status: 'completed',
          turns: messages.filter((m) => m.sender === 'user' || m.role === 'user').length
        });
      }
    } catch {}
    const freshHello = {
      id: makeId(),
      role: 'ai',
      content: t('intentAIOS.hello'),
      kind: 'hello',
      ui: { type: 'TEXT' }
    };
    setMessages([freshHello]);
    try {
      convStateRef.current = initConversationState();
      saveThreadSnapshot(visitInfo.seasonId, [freshHello]);
    } catch {}
    setInput('');
    setPendingExecution(null);
    setActivitySteps([]);
    setThinkingState('idle');
    setDrawerOpen(false);
    setAiTab('chat');
  }, [messages, locale, t, visitInfo.seasonId]);

  const threadRef = useRef(null);
  const busyRef = useRef(false);
  const resumeLock = useRef(false);
  const sendRef = useRef(null);
  const osRef = useRef(null);
  const pendingU7QuestionRef = useRef(null);
  const prevRouteRef = useRef(currentPage);

  // UPGRADE 6 — Persist conversation state on every change
  useEffect(() => {
    convStateRef.current = convState;
    saveConversationState(convState);
  }, [convState]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      /* Device-local by mandate: the conversation is never read from (or
         written to) any host. `hydrateRemote: false` boots from this
         browser's own store only. */
      const remoteBoot = await bootstrapIntentOSSession({ ownerKey: 'intent-unified', hydrateRemote: false });
      if (cancelled || !remoteBoot) return;
      os8StateRef.current = remoteBoot;
      os8HydratedRef.current = true;
      const hydrated = hydrateLegacyStateFromIntentOS(remoteBoot);
      /*
       * Local OS turns only fill an EMPTY thread (hello-only). They are this
       * device's own mirror of the same conversation — never a host read —
       * and must never overwrite or shrink a restored thread.
       */
      if (hydrated?.messages?.length && !convStateRef.current?.messages?.length) {
        setMessages((prev) => prev.length > 1 ? prev : hydrated.messages);
        setConvState((prev) => {
          if ((prev?.messages || []).length) return prev;
          return {
            ...prev,
            ...(hydrated.convStatePatch || {}),
            messages: hydrated.messages,
            currentRoute: remoteBoot.currentRoute || prev.currentRoute,
            previousRoute: remoteBoot.previousRoute || prev.previousRoute,
            updatedAt: Date.now()
          };
        });
      }
    })();
    return () => { cancelled = true; };
    // visitInfo is decided once per mount; it never changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving /intent stamps the visit, so returning within the window resumes
  // instead of starting a new season. Reload/kill also writes on next mount.
  useEffect(() => () => { writeLastActive(); }, []);

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
      dataStatus: multi?.loading ? 'pending' : multi?.partial ? 'partial'
        : (holdings.length ? 'live' : (walletSnap.connected ? 'empty' : 'unavailable')),
      // Only a priced, provider-backed read is capital evidence. The market
      // layer can show offline prices while the wallet's RPC read succeeds.
      priceDataStatus: multi?.priceDataStatus || 'unavailable',
      ...(!multi?.loading && !multi?.fromSnapshot && multi?.priceDataStatus === 'live'
        && Number(multi?.updatedAt) > 0 && walletSnap.connected
        ? { fetchedAt: Number(multi.updatedAt), source: 'portfolio' } : {}),
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

  /*
   * ── VENUE DRIVERS ──────────────────────────────────────────────────────
   * The execution runtime used to receive swap-shaped hooks for every action,
   * which is why a farm / lending / perp / equity request could only end in a
   * link to its page. The drivers bind the app's OWN primitives for each venue
   * (lib/swap.js, lib/lending.js, lib/defi/aaveV3Base.js, lib/velocityTrade.js,
   * lib/solana.js) so the chat can actually execute, and they are warmed here —
   * not at import time — so no probe or first paint pays for ethers.
   */
  const autonomyDriversRef = useRef(null);

  /*
   * ── WARM ONCE, AT IDLE ────────────────────────────────────────────────────
   * «هوش مصنوعی کنده» on iPhone.
   *
   * Ten dynamic imports — ethers, the perp engine, lending, the Solana SDK —
   * were kicked off from the effect below, which depends on `wallet` and
   * `solanaTick`. Two costs followed from that: the warm competed with the
   * chat's own first paint for the main thread, and every wallet or Solana
   * tick walked all ten import edges again. Nothing was downloaded twice (the
   * bundler caches that), but ten module-cache lookups and ten microtask
   * chains per tick is exactly the kind of invisible work that makes a screen
   * feel heavy on a phone.
   *
   * So the warm happens ONCE, deferred to the first idle moment after paint.
   * `requestIdleCallback` where it exists (Chrome/Android); a plain delayed
   * timeout where it does not (iOS Safari has never shipped it) — on the
   * device that reported the problem, the timeout IS the mechanism. The effect
   * below still awaits the warm before building drivers, which is now free:
   * warmAutonomyDrivers() is idempotent and every caller joins one promise.
   */
  useEffect(() => {
    let cancelled = false;
    const ric = typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback.bind(window) : null;
    const start = () => { if (!cancelled) void warmAutonomyDrivers().catch(() => {}); };
    const handle = ric ? ric(start, { timeout: 4000 }) : setTimeout(start, 1200);
    return () => {
      cancelled = true;
      if (ric) window.cancelIdleCallback?.(handle);
      else clearTimeout(handle);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await warmAutonomyDrivers();
        if (cancelled) return;
        autonomyDriversRef.current = buildAutonomyDrivers({
          wallet,
          solana: { connected: Boolean(solana?.address), address: solana?.address || null },
          /* A lending plan is several signatures; the chat shows which one is
             up. TOOL_COMPLETED is the existing event for "a unit of work
             finished" — no new event is invented for this. */
          onStep: (step) => busV6.emit(EVENTS_V6.TOOL_COMPLETED, { toolId: `lending.${step?.id || 'step'}`, step })
        });
      } catch {
        /* A driver set that failed to warm leaves the venue executors to report
           their own named failure — never a silent fallthrough to the swapper. */
        autonomyDriversRef.current = null;
      }
    })();
    return () => { cancelled = true; };
  }, [wallet, solana?.address, solana?.available, solanaTick]);


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
      valueUsd: r.valueUsd != null && Number.isFinite(Number(r.valueUsd)) ? Number(r.valueUsd) : null,
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
    /* Zero rows can mean «empty wallet» OR «every chain read failed» — the
       AI must be able to tell those apart, so the per-chain failure list
       travels with the portfolio snapshot (and a fully-failed read is
       reported as an ERROR, never as a fresh empty book). */
    const failedChains = Array.isArray(multi?.failedChains) ? multi.failedChains : [];
    const rowsCount = holdings.length;
    const readFailed = Boolean(
      walletConnected
      && !hydrating
      && rowsCount === 0
      && (failedChains.length > 0 || (Array.isArray(multi?.chains) && multi.chains.length > 0))
    );
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
        dataStatus: hydrating ? 'pending' : readFailed ? 'error'
          : canReadPortfolio ? (multi?.partial || solanaRows.length ? 'partial' : 'live')
            : (solanaRows.length ? 'partial' : 'unavailable'),
        // Solana's on-chain SOL amount has no independently priced USD value
        // here; a bare balance must never make the combined USD book "live".
        priceDataStatus: multi?.priceDataStatus || 'unavailable',
        ...((canReadPortfolio || solanaRows.length) && !hydrating && !multi?.fromSnapshot
          && multi?.priceDataStatus === 'live' && Number(multi?.updatedAt) > 0
          ? { fetchedAt: Number(multi.updatedAt), source: 'portfolio' } : {}),
        freshness: hydrating ? 'PENDING' : 'FRESH',
        hydrating,
        totalValueUsd: evmTotal != null ? evmTotal + solTotal : (solTotal || null),
        holdings,
        rowsCount,
        chainCount: Array.isArray(multi?.chains) ? multi.chains.length : 0,
        failedChains,
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
    /* Device-local by mandate: the OS state is persisted to this browser only
       (`remote: false`). The conversation must never be uploaded to a host. */
    if (!os8HydratedRef.current) {
      os8HydratedRef.current = true;
      void persistIntentOSSession(derived, { ownerKey: 'intent-unified', remote: false }).then((saved) => {
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

  /* ─── MULTI-SLOT FORM HANDLERS ───────────────────────────────────────────
   * وقتی فرم چندمرحله‌ای هدف‌دار فعال است، کامپوزر اصلی از این هندلر استفاده
   * می‌کند تا پاسخ را به اسلات درست bind کند و بعد از تکمیل فرم، کل اطلاعات
   * را به صورت یک درخواست کامل (نه چند پیام گیج‌کننده) برای هوش مصنوعی بفرستد.
   */
  const multiSlotSubmit = useCallback((answerText) => {
    const fa = (i18n?.language || 'fa').startsWith('fa');
    const res = submitFormAnswer({ text: answerText, conversationId, locale: i18n?.language || 'fa' });
    if (!res.ok) {
      setMultiSlotParseError(res.hint || (fa ? 'پاسخ معتبر وارد کن.' : 'Please enter a valid answer.'));
      return;
    }
    setMultiSlotParseError(null);
    if (res.cancelled) {
      setMultiSlot({ slot: null, ack: null });
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: fa ? 'فرم لغو شد. هر وقت خواستی دوباره شروع کن.' : 'Form cancelled. Start again whenever you like.',
        kind: 'assistant',
        ui: { type: 'TEXT' }
      }]);
      return;
    }
    if (res.complete) {
      // فرم کامل شد — تمام اطلاعات جمع شد. حالا یک خلاصه به چت اضافه کن
      // و درخواست اصلی را با «تفکر عمیق» بفرست
      const data = res.data || {};
      const summaryMsg = {
        id: makeId(),
        role: 'ai',
        content: `${res.ack}\n\n${res.summary}\n\n${res.nextMessage}`,
        kind: 'assistant',
        ui: { type: 'TEXT' }
      };
      setMessages((prev) => [...prev, summaryMsg]);
      setConvState((prev) => appendConvMessage(prev, summaryMsg));
      setMultiSlot({ slot: null, ack: null });

      // یک پیام کامل بساز که همه اطلاعات را داشته باشد
      const combinedMessage = fa
        ? `من ${Number(data.capitalUsd).toLocaleString('en-US')} دلار سرمایه دارم و می‌خواهم در ${data.horizonDays} روز ${data.targetPct}% سود بکنم با ریسک ${data.riskProfile === 'conservative' ? 'کم' : data.riskProfile === 'aggressive' ? 'بالا' : 'متوسط'}. لطفاً یک استراتژی کامل با تحلیل عمیق، مقایسه گزینه‌ها و مراحل اجرا بده.`
        : `I have $${Number(data.capitalUsd).toLocaleString('en-US')} in capital and I want to make ${data.targetPct}% return in ${data.horizonDays} days with ${data.riskProfile} risk. Please give me a deep analysis, compare options, and suggest a concrete plan.`;

      // فرم را پاک کن و پیام ترکیبی را بفرست
      // از sendRef استفاده می‌کنیم چون در این نقطه sendMessage ممکن است در closure نباشد
      clearForm({ conversationId });
      setTimeout(() => {
        if (sendRef.current) {
          void sendRef.current(combinedMessage, { skipUserBubble: false, deepThinking: true });
        }
      }, 500);
      return;
    }
    // هنوز کامل نشده — اسلات بعدی
    setMultiSlot({ slot: res.nextSlot, ack: res.ack });
  }, [conversationId, i18n]);

  const multiSlotCancel = useCallback(() => {
    const fa = (i18n?.language || 'fa').startsWith('fa');
    cancelForm({ conversationId });
    setMultiSlot({ slot: null, ack: null });
    setMultiSlotParseError(null);
    setMessages((prev) => [...prev, {
      id: makeId(),
      role: 'ai',
      content: fa ? 'باشه، از گرفتن اطلاعات منصرف شدیم.' : 'OK, I stopped collecting info.',
      kind: 'assistant',
      ui: { type: 'TEXT' }
    }]);
  }, [conversationId, i18n]);

  // UPGRADE 6 — Enhanced sendMessage with all new intelligence
  const sendMessage = useCallback(async (rawText, opts = {}) => {
    const message = String(rawText || '').trim();
    if (!message || busyRef.current) return null;

    // اگر فرم چندمرحله‌ای فعال است، هر پیام عادی باید به آن پاسخ حساب شود
    // (مگر اینکه skipUserBubble باشد که از submit داخلی می‌آید)
    const activeFormBefore = getActiveForm({ conversationId });
    if (activeFormBefore && !opts?.skipFormIntercept) {
      multiSlotSubmit(message);
      setInput('');
      return null;
    }

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

    /*
     * ── PHASE 213: THE OPEN QUESTION IS BOUND ON EVERY TURN ────────────────
     * The Upgrade-8 ref above only knows about questions THIS component asked
     * in this session. The ledger knows about every question the OS asked —
     * including the ones that arrived in a server reply, and the ones asked
     * before a reload — so the user's answer is read as an answer, recorded
     * where the user can see it, and never asked again. A brand-new request
     * does not eat the question: it is answered in parallel and the question
     * stays open (with a fresh reminder, not the same sentence twice).
     */
    let ledgerVerdict = null;
    try {
      const wasOpen = getOpenQuestion({ conversationId });
      if (wasOpen) {
        ledgerVerdict = bindAnswer({ text: message, conversationId });
        if (ledgerVerdict?.ok) {
          const ack = acknowledgement(ledgerVerdict, { locale });
          if (ack) setQuestionAck(ack);
          setOpenQuestion(ledgerVerdict.closed ? null : getOpenQuestion({ conversationId }));
        }
      }
    } catch { /* the ledger is an assistant, not a gate: never block the turn */ }

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

    /* ── MULTI-SLOT TRIGGER DETECTION ───────────────────────────────────────
     * اگر پیام کاربر درخواست هدف‌دار (استراتژی سرمایه‌گذاری، سود و غیره) است
     * و هنوز فرم فعالی نداریم، فرم چندمرحله‌ای را شروع کن و جریان عادی را
     * متوقف کن. اما اگر کاربر همه اطلاعات را یک‌جا داده (سرمایه+سود+بازه)،
     * فرم را باز نکن و بگذار مستقیم به تحلیل برود. پاسخ‌های بعدی توسط
     * multiSlotSubmit مدیریت می‌شوند. */
    const formType = detectFormTrigger(message);
    if (formType && !opts.skipFormIntercept) {
      // بررسی سریع: آیا پیام از قبل تمام اطلاعات را دارد؟
      let alreadyComplete = false;
      try {
        const quickSpec = (await import('../lib/strategyBrain/goalSpec.js')).parseGoalSpec({ text: message, portfolio: aiContext.portfolio, wallet, balances: aiContext.balances });
        alreadyComplete = quickSpec.ok === true;
      } catch { alreadyComplete = false; }
      if (!alreadyComplete) {
        const started = startForm({ formId: formType, conversationId, locale });
        if (started.ok) {
          const slot = getCurrentSlot({ conversationId, locale });
          if (slot) {
            const fa = locale.startsWith('fa');
            const introMsg = {
              id: makeId(),
              role: 'ai',
              content: fa
                ? 'عالی! برای ساختن یک استراتژی دقیق و عمیق، چند مورد را یکی‌یکی از تو می‌پرسم. لطفاً پاسخ هر کدام را در باکس سبز پایین بنویس.'
                : 'Great! To build a deep, accurate strategy I will ask a few questions one by one. Please answer each in the green box below.',
              kind: 'assistant',
              ui: { type: 'TEXT' }
            };
            setMessages((prev) => [...prev, introMsg]);
            setConvState((prev) => appendConvMessage(prev, introMsg));
            setMultiSlot({ slot, ack: null });
            setMultiSlotParseError(null);
            setThinking([]);
            setThinkingState('idle');
            setActivitySteps([]);
            busyRef.current = false;
            stateMachineRef.current.transition(STATES.CLARIFYING, { reason: 'multi_slot_started' });
            return null;
          }
        }
      }
    }

    const localizedThinking = locale.startsWith('fa')
      ? ['در حال درک درخواست شما…', 'بررسی کیف پول و بازار…', 'طراحی مسیر امن…', 'تفکر عمیق…']
      : ['Understanding your request…', 'Checking wallet & market…', 'Building safe plan…', 'Thinking deeply…'];
    setThinking(localizedThinking);

    try {
      /*
       * ── PHASE 213: THE FOUR COMMANDS THAT OPEN INTENT OS FROM CHAT ────────
       *   «چه کارهایی می‌تونی؟»            → the whole catalog, every option
       *   «جستجو کن …» / «search for …»    → a real cited web search
       *   «با ایجنت مذاکره کن» / «توافق»…  → negotiation/agreement/conflict
       * Anything else falls through to the pipeline untouched. A question that
       * these commands produce (a missing negotiation subject, a choice) is
       * registered in the ledger so the NEXT message binds to it. */
      try {
        const surfaceOut = await runSurfaceCommand(message, {
          locale,
          conversationId,
          research: async (args) => aiResearch(args),
          context: buildNegotiationContext({
            wallet,
            portfolio: aiContext?.portfolio,
            conversationState: convStateRef.current,
            services: {
              automations,
              monitors
            }
          })
        });
        if (surfaceOut?.handled && surfaceOut.message) {
          const row = surfaceOut.message;
          setMessages((prev) => [...prev, row]);
          setConvState((prev) => appendConvMessage(prev, row));
          addL1Message(row);
          if (surfaceOut.question) {
            const registered = askQuestion({
              text: surfaceOut.question.text,
              slot: surfaceOut.question.slot,
              expectedType: surfaceOut.question.expectedType,
              options: surfaceOut.question.options,
              locale,
              conversationId,
              source: 'negotiation'
            });
            if (registered?.ok) setOpenQuestion(registered.question);
          } else if (Array.isArray(surfaceOut.chips) && surfaceOut.chips.length) {
            setSuggestions(surfaceOut.chips.slice(0, MAX_SUGGESTIONS));
          }
          setThinking([]);
          setThinkingState('idle');
          setActivitySteps([]);
          stateMachineRef.current.transition(STATES.COMPLETED, { reason: `surface_command_${surfaceOut.command}` });
          return true;
        }
      } catch { /* the surface commands are additive: a failure falls through */ }

      /*
       * ── PHASE 213: A PLEASANTRY IS ANSWERED AS ONE ───────────────────────
       * «حالت چطوره» used to reach the local pipeline and come back as
       * «درخواست کامل شد» — a completion notice for a sentence that asked
       * nothing. Small talk is answered here, in the language it was typed,
       * from the same voice tables the server uses, with zero provider calls
       * (the same law Upgrade 13 applies on the server). «چخبر» is NOT answered
       * here: it asks for a real brief, so it falls through to the server.
       */
      try {
        const socialRow = offlineSocialFallback(message, { locale });
        if (socialRow && socialRow.social?.needsServer !== true) {
          setMessages((prev) => [...prev, socialRow]);
          setConvState((prev) => appendConvMessage(prev, socialRow));
          addL1Message(socialRow);
          setSuggestions([]);
          setThinking([]);
          setThinkingState('idle');
          setActivitySteps([]);
          stateMachineRef.current.transition(STATES.COMPLETED, { reason: 'social_turn' });
          return true;
        }
      } catch { /* a social turn never blocks the pipeline */ }

      // §7, §8, §10 — Check if this is short answer to last question BEFORE full intent understanding
      const slotEngine = slotEngineRef.current;
      const refResolver = refResolverRef.current;
      const ctxResolver = ctxResolverRef.current;
      const conv = convStateRef.current;
      const fa = locale.startsWith('fa');
      // The conversation state still remembers the user's slots, but the
      // Upgrade-8 generic 50/30/20 portfolio suggestion is NOT a financial
      // plan. Strategy Brain owns explicit return targets. In particular, do
      // not turn "1000 dollars, 30% in 30 days" into an unsourced allocation.
      const goalTurn = resolveGoalTurn({
        text: message, messages: messagesRef.current || messages,
        portfolio: aiContext.portfolio, wallet, balances: aiContext.balances
      });
      const effectiveMessage = goalTurn.objective ? goalTurn.text : message;

      // Check if user is asking to launch or create a token
      if (/(?:توکن.*(?:میخام|می‌خوام|میخوام|بسازم|لانچ)|(?:لانچ|launch|ساخت|ایجاد|create).*توکن|launch.*token|token.*launch)/i.test(message)) {
        try {
          navigate('/launch');
        } catch {}
        const launchMsg = {
          id: makeId(),
          role: 'ai',
          content: fa
            ? 'درخواست ساخت و لانچ توکن دریافت شد. شما را به پلتفرم لانچ توکن (FBT Launch) هدایت کردم. در این بخش می‌توانید توکن جدید خود را با مشخصات دلخواه (نام، نماد، عرضه کل و نقدینگی) ایجاد و مدیریت کنید.'
            : 'Token launch request recognized. Navigating you to the Token Launchpad (FBT Launch) where you can deploy your token, set supply and configure liquidity.',
          kind: 'assistant',
          ui: { type: 'TEXT' },
          actions: [
            { id: 'open-launch', label: fa ? 'ورود به صفحه لانچ' : 'Open Launch', route: '/launch' }
          ]
        };
        setMessages((prev) => [...prev, launchMsg]);
        setConvState((prev) => appendConvMessage(prev, launchMsg));
        setThinking([]);
        setThinkingState('idle');
        setActivitySteps([]);
        busyRef.current = false;
        return true;
      }

      // Bare «اره» / «بله تایید شد» and named page-opens («افق جهانی را باز کن»)
      // must reach the OS — leftover lastQuestion must not swallow them.
      if (goalTurn.objective || isBareFollowUp(message) || isPageOpenUtterance(message)) {
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
            const display = val.months ? `${val.months} ماه` : val.days ? `${val.days} روز` : `${val.value} ${val.unit || 'ماه'}`;
            responseText = fa
              ? `متوجه شدم؛ بازه زمانی را ${display} در نظر می‌گیرم. حالا برای برنامه پیشنهادی، ریسک متوسط را در نظر بگیرم یا سطح دیگری مدنظر شماست؟`
              : `Got it; I'll consider the period as ${display}. Should I use medium risk for the analysis?`;
            setConvState((prev) => setConvQuestion(prev, fa ? 'ریسک متوسط را در نظر بگیرم؟' : 'Should I consider medium risk?', { questionId: makeId('q'), expectedType: 'risk' }));
          } else if (slotKey === 'riskProfile') {
            const riskVal = fillResult.value === 'low' ? (fa ? 'کم' : 'low') : fillResult.value === 'high' ? (fa ? 'زیاد' : 'high') : (fa ? 'متوسط' : 'medium');
            // A risk answer is a preference, never permission to invent an
            // allocation or prepare a transaction. A complete objective has
            // already been resumed by resolveGoalTurn above; for a bare
            // portfolio question ask for the actual objective instead.
            responseText = fa
              ? `ریسک ${riskVal} ثبت شد. برای ساخت برنامه، سرمایه، هدف سود و بازه زمانی‌ات را بگو؛ تحلیل بدون نرخ واقعی و تأیید کیف پول اجرا نمی‌شود.`
              : `${riskVal} risk recorded. Tell me your capital, return target and horizon to build a plan from real rates; execution still needs your wallet approval.`;
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
        const ctxOut = goalTurn.objective ? null : await contextHandlerRef.current(message);
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
        message: effectiveMessage,
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
          /* Phase 213 — the question is ALSO registered in the durable ledger,
             so it survives a reload and a later turn is read as its answer. */
          try {
            const registered = askQuestion({
              text: u7qText,
              slot: u7q.slot,
              expectedType: u7q.expectedType,
              intentId: convStateRef.current?.intentId || null,
              locale,
              conversationId
            });
            if (registered?.ok) setOpenQuestion(registered.question);
          } catch { /* ledger is best-effort */ }
        }

        const nextMessage = {
          id: makeId(),
          role: 'ai',
          content: finalMessage,
          kind: 'assistant',
          ui: osResult.human?.ui || osResult.ui || { type: 'TEXT' },
          card: osResult.human?.card || osResult.card || null,
          /* Route chips, opportunity rows and holdings the human layer built
             from real tool output — the bubble renderer turns these into
             buttons/lists instead of dropping them. */
          actions: Array.isArray(osResult.human?.actions) ? osResult.human.actions : null,
          opportunities: Array.isArray(osResult.human?.opportunities) ? osResult.human.opportunities : null,
          holdings: Array.isArray(osResult.human?.holdings) ? osResult.human.holdings : null,
          statusCode: osResult.human?.code || null,
          /* A goal («سودم دو برابر شود») and an automation request travel with
             the message; the bubble compiles the real plan / arms the loop from
             them instead of the human layer guessing at live numbers it cannot
             read synchronously. */
          goalRequest: osResult.human?.goalRequest || null,
          goalIntent: osResult.human?.goalRequest ? (osResult.intent || null) : null,
          /* The tool payload travels WITH the request. The compiler reads the
             live rates off it (`results.yieldOpportunities`); without it the
             only honest verdict available is NO_LIVE_RATES, so every goal
             card would refuse even on a network that had the data. */
          goalResults: osResult.human?.goalRequest ? (osResult.data || null) : null,
          /* A whole-ecosystem objective («۱۰ هزار دلار، ۱۵٪ در ۴ ماه، ریسک
             متوسط») travels the same way: the request rides with the message
             and the strategy brain compiles the real plan from live reads
             after render, because this layer cannot await twenty-one domains
             synchronously. */
          strategyRequest: osResult.human?.strategyRequest || null,
          strategyEntities: osResult.human?.strategyRequest ? (osResult.intent?.entities || null) : null,
          autonomyRequest: osResult.human?.autonomyRequest || null,
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

        /* ─── SELF-HEALING PORTFOLIO READ ───────────────────────────────────
           The human layer asked for a refresh (failed chain read or data not
           arrived yet). Trigger the wallet re-read and re-ask ONCE when it
           settles, so the follow-up answer carries real balances instead of
           leaving the user stuck with the retry notice. */
        if ((osResult.human?.refresh || osResult.human?.pendingRefresh) && !opts.isAutoRetry) {
          try { if (typeof multi?.refresh === 'function') multi.refresh(); } catch { /* refresh is best-effort */ }
          setTimeout(() => {
            if (busyRef.current) return;
            void sendMessage(message, { ...opts, skipUserBubble: true, isAutoRetry: true });
          }, 4200);
        }

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
        /* In-place OS turns: answer here AND show here (operations panel,
           agents tab, strategies sheet…). Same contract as the server path. */
        if (osResult.human?.inPlace === true && (osResult.human.openTab || osResult.human.openPanel || osResult.human.openEcosystem)) {
          try {
            if (osResult.human.openTab) openBubbleRoute(`/intent?tab=${osResult.human.openTab}`);
            else if (osResult.human.openPanel) { setDrawerOpen(false); openPanel(osResult.human.openPanel); }
            else if (osResult.human.openEcosystem) { setDrawerOpen(false); openEcosystem(osResult.human.openEcosystem); }
          } catch { /* showing is best-effort; the message stands alone */ }
        }
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

      /* Phase 213 — built once, above the call: either the verdict of the
         question this turn just answered, or the block naming the one that is
         still open. Null when there is nothing to carry. */
      const bindingHint = answerBindingHint({ verdict: ledgerVerdict?.ok ? ledgerVerdict : null, locale });
      const res = await aiChat({
        message: effectiveMessage,
        // The server fallback uses the SAME unfinished goal as the local chat.
        // Send a bounded, plain-text history, never entire UI/plan/wallet blobs.
        messages: (messagesRef.current || []).filter((row) => row?.role === 'user' || row?.role === 'ai')
          .slice(-8).map((row) => ({
            role: row.role,
            content: String(row.content || '').slice(0, 1200),
            ...(row.strategyRequest?.text ? { strategyRequest: { text: String(row.strategyRequest.text).slice(0, 1200) } } : {}),
            ...(row.strategyDraft?.text ? { strategyDraft: { text: String(row.strategyDraft.text).slice(0, 1200) } } : {})
          })),
        surface: currentPage,
        conversationId,
        context: aiContext,
        resume: opts.resume === true,
        /* Phase 213 — the turn carries what it IS: an answer to the open
           question (with the value already parsed) or a turn that happens while
           a question stays open. The server uses this to answer the new request
           AND continue the unfinished one instead of re-deriving intent and
           forgetting the question entirely. */
        hints: {
          ...(opts.hints || {}),
          ...(bindingHint ? { answerBinding: bindingHint } : {})
        }
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
      const body = visibleText(reply, t('intentAIOS.noReply'));
      const nextMessage = {
        id: makeId(),
        role: 'ai',
        content: thanks ? `${thanks}\n\n${body}` : body,
        kind: uiType === 'CONNECT_WALLET' ? 'connect' : (uiType === 'RESULT_CARD' ? 'result' : 'assistant'),
        ui: reply.ui || { type: 'TEXT' },
        card: reply.card || null,
        actions: Array.isArray(reply.actions) ? reply.actions : [],
        rebalance: reply.rebalance || null,
        strategyRequest: reply.strategyRequest || null,
        strategyDraft: reply.strategyDraft || null,
        strategyEntities: reply.strategyRequest ? (reply.intent?.entities || null) : null,
        /* The server fallback used to swallow goal turns into a TEXT line; it
           now emits the same GOAL_PLAN_CARD + goalRequest the local OS does,
           and the bubble compiles + renders it from this payload. */
        goalRequest: reply.goalRequest || null,
        goalIntent: reply.goalRequest ? (reply.intent || null) : null,
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
      /* In-place server turns («مرکز عملیات» on /intent): the message answers
         here AND the target opens here — the user must see the thing named,
         not just read about it. */
      if (reply.inPlace === true && (reply.openTab || reply.openPanel || reply.openEcosystem)) {
        try {
          if (reply.openTab) openBubbleRoute(`/intent?tab=${reply.openTab}`);
          else if (reply.openPanel) { setDrawerOpen(false); openPanel(reply.openPanel); }
          else if (reply.openEcosystem) { setDrawerOpen(false); openEcosystem(reply.openEcosystem); }
        } catch { /* showing is best-effort; the message stands alone */ }
      }
      setConvState((prev) => {
        let next = appendConvMessage(prev, nextMessage);
        if (nextMessage.missingInfo) {
          const qId = reply.intentId || makeId('q');
          next = setConvQuestion(next, nextMessage.missingInfo, { questionId: qId, expectedType: reply.intent?.missingInformation?.[0] || 'text' });
          /* Phase 213 — a question asked in a SERVER reply is registered in the
             durable ledger too, so the next turn binds to it instead of being
             re-derived from scratch (this is where questions used to be lost). */
          const slot = reply.intent?.missingInformation?.[0] || 'text';
          try {
            const registered = askQuestion({
              text: nextMessage.missingInfo,
              slot,
              expectedType: slot === 'riskProfile' ? 'text' : slot,
              options: (nextMessage.choices || []).map((c) => ({ id: c.id, label: c.label })),
              intentId: reply.intentId || null,
              locale,
              conversationId
            });
            if (registered?.ok) setOpenQuestion(registered.question);
          } catch { /* ledger is best-effort */ }
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
      /* Phase 213 — «حالت چطوره» deserves a person, not a retry banner. When the
         turn itself was social, answer it with the same voice table the server
         uses; the error banner stays for every turn that actually needed data. */
      const socialRow = (() => {
        try { return offlineSocialFallback(message, { locale }); } catch { return null; }
      })();
      if (socialRow) {
        setMessages((prev) => [...prev, socialRow]);
        addL1Message(socialRow);
        setThinking([]);
        setThinkingState('idle');
        setActivitySteps([]);
        return true;
      }
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
  }, [aiContext, conversationId, t, locale, rememberPending, intentOS, currentPage, messages, wallet, walletConnected, walletCanSign, liveModuleServices, solanaAddressLive, navigate, pendingExecution, portfolioContextForOs8, automations, monitors]);

  sendRef.current = sendMessage;

  const sendSuggested = useCallback((s) => {
    /* Two callers: the suggestion chips hand a full chip object, the Intent OS
       card chips hand the sentence itself. Both must actually send — a chip
       that renders but does nothing is the exact "disabled option" the Phase
       213 work exists to remove. */
    const prompt = typeof s === 'string' ? s : (s?.prompt || s?.label || '');
    if (!prompt) return;
    setInput(prompt);
    void sendMessage(prompt);
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
    const fa = locale.startsWith('fa');
    /* Phase 213 — the Intent OS catalog is the first row of the “+” sheet:
       every capability the OS has (all five coordination modes included) is
       one tap away, and pressing it types the same sentence the chat command
       understands. Nothing in Intent OS is reachable only from another page. */
    const catalogRow = {
      id: 'intent-os-catalog',
      label: fa ? 'همهٔ گزینه‌های Intent OS' : 'All Intent OS options',
      prompt: fa ? 'چه کارهایی می‌تونی بکنی؟' : 'what can you do?'
    };
    return [catalogRow, ...getSuggestionsForMessage('', ctx, locale).map(s => ({
      id: s.id,
      label: s.label,
      prompt: s.prompt
    }))];
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

  /*
   * Placement matters: this block reads `walletConnected`, `walletCanSign`,
   * `aiContext` and `openWalletSheet`, and a hook's DEPENDENCY ARRAY is
   * evaluated during render — so declaring it above those consts is a TDZ
   * ReferenceError that takes the whole page down (the boot probe caught
   * exactly that: "Cannot access 'walletConnected' before initialization").
   * It sits after the last of them, before the JSX that consumes it.
   */
  /*
   * ── AUTONOMY SURFACE ───────────────────────────────────────────────────
   * The loop lives here, not in the message list: it is one engine per chat
   * session, persisted through the same local-state helpers the rest of the OS
   * uses, and every card reads the SAME instance so the numbers cannot drift.
   */
  const autonomyEngineRef = useRef(null);
  const [autonomyEngine, setAutonomyEngine] = useState(null);
  const [autonomyBusy, setAutonomyBusy] = useState(false);
  const [, forceAutonomyRender] = useState(0);
  const autonomyStrategies = useMemo(() => BUILTIN_STRATEGIES.map((strategy) => ({
    ...strategy,
    /* Every strategy is measured on real candles before it is offered. A
       strategy with no backtest is not shown as if it had an edge. */
    backtest: null
  })), []);

  useEffect(() => {
    const engine = createAutonomyEngine({
      mode: AUTONOMY_MODES.PAPER,
      execute: async (action) => runExecutionPlan({
        actions: [action],
        hooks: buildBrowserHooks(wallet),
        wallet: {
          connected: walletConnected,
          canSign: walletCanSign,
          address: wallet?.address || null,
          evmAddresses: aiContext.wallet?.evmAddresses,
          chainId: wallet?.chainId || defaultChainId
        },
        drivers: autonomyDriversRef.current
      }),
      store: {
        save: (state) => { try { localStorage.setItem('fbt.autonomy.state', JSON.stringify(state)); } catch { /* private mode */ } },
        load: () => { try { return JSON.parse(localStorage.getItem('fbt.autonomy.state') || 'null'); } catch { return null; } }
      }
    });
    let restored = null;
    try { restored = JSON.parse(localStorage.getItem('fbt.autonomy.state') || 'null'); } catch { restored = null; }
    if (restored && typeof restored === 'object') engine.restore(restored);
    autonomyEngineRef.current = engine;
    setAutonomyEngine(engine);
  }, [wallet, walletConnected, walletCanSign, defaultChainId]);

  const rerenderAutonomy = useCallback(() => forceAutonomyRender((v) => v + 1), []);

  const setAutonomyMode = useCallback((mode) => {
    autonomyEngineRef.current?.setMode(mode);
    rerenderAutonomy();
  }, [rerenderAutonomy]);

  const startAutonomy = useCallback(() => { autonomyEngineRef.current?.start(); rerenderAutonomy(); }, [rerenderAutonomy]);
  const stopAutonomy = useCallback(() => { autonomyEngineRef.current?.stop(); rerenderAutonomy(); }, [rerenderAutonomy]);

  /*
   * «اتوماسیون را متوقف کن» has to actually stop something.
   *
   * buildHumanResponse is synchronous by contract, so it cannot call the
   * engine — it can only ask. Until this effect existed it asked and nobody
   * listened: the bubble announced «اتوماسیون را متوقف کردم» in the past
   * tense while the loop kept ticking. That is the worst shape of this bug,
   * because the UI reads as done.
   *
   * Placed below startAutonomy/stopAutonomy on purpose. A dependency array is
   * evaluated during render, so this block cannot sit above them — the same
   * TDZ trap that took the whole screen down once already.
   */
  const lastStopMessageId = useRef(null);
  useEffect(() => {
    const pending = messages.find((m) => m.autonomyRequest?.wantsStop && m.id !== lastStopMessageId.current);
    if (!pending) return;
    lastStopMessageId.current = pending.id;
    stopAutonomy();
  }, [messages, stopAutonomy]);

  const armAutomation = useCallback(async ({ strategy, asset, stakeUsd }) => {
    const engine = autonomyEngineRef.current;
    if (!engine) return;
    setAutonomyBusy(true);
    try {
      /* Backtest on the same candles the page already has, so the number shown
         next to the strategy is the number the loop will trade against. */
      let backtest = null;
      try {
        const candles = await fetchCandlesFor(asset);
        if (Array.isArray(candles) && candles.length > 40) {
          backtest = backtestStrategy({ strategy, candles, initialUsd: 1000 });
        }
      } catch { backtest = null; }
      engine.arm({ strategyId: strategy.id, strategy: { ...strategy, ...(backtest ? {} : {}) }, strategyTitle: strategy.title, asset, stakeUsd, backtest: backtest?.ok ? backtest : null });
      engine.start();
      rerenderAutonomy();
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: backtest?.ok
          ? (locale.startsWith('fa')
            ? `«${strategy.titleFa || strategy.title}» مسلح شد. بک‌تست روی ${backtest.candles} کندل واقعی: ${backtest.trades} معامله، بازدهی ${Number(backtest.returnPct).toFixed(2)}٪، بیشترین افت ${Number(backtest.maxDrawdownPct).toFixed(2)}٪. گذشته پیش‌بینی آینده نیست.`
            : `"${strategy.title}" armed. Backtest on ${backtest.candles} real candles: ${backtest.trades} trades, ${Number(backtest.returnPct).toFixed(2)}% return, ${Number(backtest.maxDrawdownPct).toFixed(2)}% max drawdown. The past is not a forecast.`)
          : (locale.startsWith('fa')
            ? `«${strategy.titleFa || strategy.title}» مسلح شد، اما کندل کافی برای بک‌تست پیدا نکردم — پس عددی هم به عنوان انتظار نشان نمی‌دهم.`
            : `"${strategy.title}" armed, but I could not find enough candles to backtest it — so I am not showing you a number to expect.`),
        kind: 'assistant',
        ui: { type: 'TEXT' }
      }]);
    } finally {
      setAutonomyBusy(false);
    }
  }, [locale, rerenderAutonomy]);

  const disarmAutomation = useCallback((auto) => {
    if (auto?.id) autonomyEngineRef.current?.disarm(auto.id);
    rerenderAutonomy();
  }, [rerenderAutonomy]);

  const tickAutonomy = useCallback(async () => {
    const engine = autonomyEngineRef.current;
    if (!engine) return;
    setAutonomyBusy(true);
    try {
      const assets = [...new Set(engine.state.automations.filter((a) => a.active).map((a) => a.asset))];
      const prices = {};
      const candles = {};
      for (const asset of assets) {
        try {
          const rows = await fetchCandlesFor(asset);
          if (Array.isArray(rows) && rows.length) {
            candles[asset] = rows;
            prices[asset] = Number(rows[rows.length - 1]?.close);
          }
        } catch { /* an asset with no data simply does not trade this tick */ }
      }
      const res = await engine.tick({ prices, candles });
      rerenderAutonomy();
      const fa = locale.startsWith('fa');
      const lines = [];
      if (res.code) lines.push(fa ? `حلقه اجرا نشد: ${res.code}` : `Loop did not run: ${res.code}`);
      for (const f of res.fills || []) lines.push(fa ? `باز شد: ${f.asset} @ ${Number(f.price).toFixed(2)} — ${usdFmt(f.stakeUsd)}` : `Opened: ${f.asset} @ ${Number(f.price).toFixed(2)} — ${usdFmt(f.stakeUsd)}`);
      for (const x of res.exits || []) lines.push(fa ? `بسته شد: ${x.asset} (${x.reason}) ${Number(x.netPct).toFixed(2)}٪` : `Closed: ${x.asset} (${x.reason}) ${Number(x.netPct).toFixed(2)}%`);
      for (const p of res.pending || []) lines.push(fa ? `در انتظار تأیید تو: ${p.action?.to || p.action?.from} @ ${Number(p.price).toFixed(2)}` : `Waiting for your signature: ${p.action?.to || p.action?.from} @ ${Number(p.price).toFixed(2)}`);
      if (!lines.length) lines.push(fa ? `گام اجرا شد؛ سیگنالی نبود. ارزش حساب: ${usdFmt(res.equity)}` : `Ticked; no signal. Account value: ${usdFmt(res.equity)}`);
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: lines.join('\n'),
        kind: 'assistant',
        ui: { type: 'TEXT' }
      }]);
    } finally {
      setAutonomyBusy(false);
    }
  }, [locale, rerenderAutonomy]);

  /*
   * Compile the goal plan for a bubble that asked for one. Done in an effect
   * (not in the human layer) because the compiler is async and needs the live
   * balances and the scanner output from THIS turn.
   */
  const lastGoalMessageId = useRef(null);
  /*
   * The compile runs OUTSIDE the effect's cancel scope, guarded only by an
   * unmount flag.
   *
   * It used to be a local `let cancelled` set by the effect's cleanup. But
   * this effect depends on `messages`, and its own first action is
   * `setMessages(… goalBusy: true …)` — which changes `messages`, re-runs the
   * effect, and runs the previous run's cleanup. So `cancelled` flipped true
   * before the compiler ever resolved, the plan was dropped on the floor, and
   * because `lastGoalMessageId` was already recorded the message was never
   * picked up again. The card sat on «در حال خواندن نرخ‌های زنده…» forever.
   *
   * That is the whole feature — «سودم ۲ برابر شود» — spinning in the real
   * page while every unit probe stayed green, because the wiring is only
   * observable once the component is mounted and driven.
   */
  const goalMountedRef = useRef(true);
  useEffect(() => () => { goalMountedRef.current = false; }, []);
  useEffect(() => {
    const pending = messages.find((m) => m.goalRequest && !m.goalPlan && !m.goalError && !m.goalBusy && m.id !== lastGoalMessageId.current);
    if (!pending) return;
    lastGoalMessageId.current = pending.id;
    void (async () => {
      setMessages((prev) => prev.map((m) => (m.id === pending.id ? { ...m, goalBusy: true } : m)));
      try {
        const { plan } = await planFromIntent({
          intent: pending.goalIntent || { type: 'GOAL_PLAN', entities: { goalMultiple: pending.goalRequest.multiple, horizonDays: pending.goalRequest.horizonDays } },
          context: aiContext,
          results: pending.goalResults || {},
          locale
        });
        if (!goalMountedRef.current) return;
        setMessages((prev) => prev.map((m) => (m.id === pending.id ? { ...m, goalPlan: plan, goalBusy: false } : m)));
      } catch (err) {
        if (!goalMountedRef.current) return;
        setMessages((prev) => prev.map((m) => (m.id === pending.id
          ? { ...m, goalBusy: false, goalError: locale.startsWith('fa')
            ? `برنامه ساخته نشد: ${String(err?.message || err).slice(0, 120)}`
            : `The plan could not be built: ${String(err?.message || err).slice(0, 120)}` }
          : m)));
      }
    })();
  }, [messages, aiContext, locale]);

  /*
   * ─── STRATEGY BRAIN: compile the cross-module plan ──────────────────────
   * Same shape as the goal effect above, for the same reason: the human layer
   * is synchronous and cannot await twenty-one domain reads, so the request
   * rides with the message and the plan is built here — against the LIVE app
   * (real wallet snapshot, real market/yield/derivatives/intelligence feeds),
   * never against remembered numbers.
   *
   * `lastStrategyMessageId` is the same guard the goal effect needed: without
   * it this effect re-runs on every `messages` change, re-reads the ecosystem
   * for a message it already answered, and — because it sets state — re-runs
   * itself. That is both a stuck spinner and a needless load on a small host.
   */
  const lastStrategyMessageId = useRef(null);
  useEffect(() => {
    const pending = messages.find((m) => m.strategyRequest && !m.strategyPlan && !m.strategyError && !m.strategyBusy && m.id !== lastStrategyMessageId.current);
    if (!pending) return;
    lastStrategyMessageId.current = pending.id;
    void (async () => {
      setMessages((prev) => prev.map((m) => (m.id === pending.id ? { ...m, strategyBusy: true } : m)));
      try {
        const result = await buildStrategyFromChat({
          text: pending.strategyRequest.text || '',
          entities: pending.strategyEntities || {},
          context: aiContext,
          results: {},
          wallet: wallet || null,
          portfolio: aiContext.portfolio || null,
          locale
        });
        if (!goalMountedRef.current) return;
        const built = result.strategy || result;
        /*
         * Persist the plan before it is shown. A strategy is built for a
         * horizon measured in months, so losing it on reload would throw away
         * the stage progress that staged execution and revision both act on.
         * One localStorage write, no server round-trip: free on a small host.
         * A refusal (ok:false) is never stored — there is no plan to resume.
         */
        if (built?.ok) {
          try {
            saveStrategyPlan({ strategy: built, goal: result.spec || built.goal || null });
          } catch { /* storage full or blocked: the plan still works this session */ }
        }
        setMessages((prev) => prev.map((m) => (m.id === pending.id
          ? { ...m, strategyPlan: built, strategySpec: result.spec || null, strategyBusy: false }
          : m)));
        /* The card below carries the full comparison, allocation and stages;
           this turn is the two-line verdict the user reads first — reachable
           or not, what the sourced rates carry, what must come from price. */
        if (built?.ok) {
          const v = built.verdict || {};
          const spec = result.spec || built.goal || {};
          const covLive = built.coverage?.live;
          const covTotal = built.coverage?.total;
          const faSum = locale.startsWith('fa');
          const r1 = (n) => (Number(n) == null || Number.isNaN(Number(n)) ? '—' : String(Math.round(Number(n) * 10) / 10));
          const summary = faSum
            ? (v.reachable === true
              ? `✅ رسیدنی است: انتظار موتور ${r1(v.expectedReturnPct)}٪ در ${spec.horizonDays ?? '—'} روز روی ${Number(spec.capitalUsd || 0).toLocaleString('en-US')}$ (پوشش زنده: ${covLive ?? '—'} از ${covTotal ?? '—'} دامنه). تخصیص و مراحل اجرا در کارت بالاست — با «اجرای مرحله بعد» از همان‌جا شروع کن.`
              : `⚠️ با نرخ‌های زنده امروز، فقط ${r1(v.sourcedReturnPct)}٪ از هدف ${r1(spec.targetPct)}٪ از سود واقعی می‌آید و ${r1(v.priceGapPct)}٪ باقی‌مانده فقط از رشد قیمت — که پیش‌بینی نمی‌کنم. کارت بالا مقایسه کامل، طرح جایگزین و مراحل آماده‌به‌اجرا را دارد؛ امضا همیشه با کیف پول توست.`)
            : (v.reachable === true
              ? `✅ Reachable: the engine expects ${r1(v.expectedReturnPct)}% over ${spec.horizonDays ?? '—'} days on $${Number(spec.capitalUsd || 0).toLocaleString('en-US')} (live coverage: ${covLive ?? '—'} of ${covTotal ?? '—'} domains). Allocation and stages are in the card above — start with “Run next stage”.`
              : `⚠️ At today's live rates only ${r1(v.sourcedReturnPct)}% of the ${r1(spec.targetPct)}% target comes from real yield; the remaining ${r1(v.priceGapPct)}% can only come from price growth — which I do not forecast. The card above has the full comparison, the stretch alternative and the ready-to-run stages; signing is always your wallet's.`);
          setMessages((prev) => [...prev, {
            id: makeId(), role: 'ai', kind: 'assistant', ui: { type: 'TEXT' },
            content: summary, intentType: 'STRATEGY_PLAN'
          }]);
        }
      } catch (err) {
        if (!goalMountedRef.current) return;
        setMessages((prev) => prev.map((m) => (m.id === pending.id
          ? { ...m, strategyBusy: false, strategyError: locale.startsWith('fa')
            ? `استراتژی ساخته نشد: ${String(err?.message || err).slice(0, 140)}`
            : `The strategy could not be built: ${String(err?.message || err).slice(0, 140)}` }
          : m)));
        /* Safety net: the refusal above names the failure — this turn says
           what to do about it, so the thread never ends on a bare error. */
        setMessages((prev) => [...prev, {
          id: makeId(), role: 'ai', kind: 'assistant', ui: { type: 'TEXT' },
          content: locale.startsWith('fa')
            ? 'چون خوانش زنده ناقص بود، استراتژی حدس نمی‌زنم — یک نقشه اشتباه از هیچ نقشه‌ای بدتر است. اتصال و کیف پول را بررسی کن و همان هدف را دوباره بفرست؛ موتور از اول با داده تازه می‌سازد.'
            : 'Because the live read was incomplete, I am not guessing a strategy — a wrong plan is worse than no plan. Check your connection and wallet, then send the same goal again; the engine rebuilds from fresh data.',
          intentType: 'STRATEGY_PLAN'
        }]);
      }
    })();
  }, [messages, aiContext, wallet, locale]);

  /*
   * Run the next stage of a live strategy. The runtime decides which stage is
   * next and refuses to skip ahead after a failure; the actions it hands back
   * are handoffs to the venues that own the signature, so this opens the venue
   * prefilled rather than signing anything itself.
   */
  const strategyRuntimesRef = useRef(new Map());

  /* Persist stage progress before handing off to a wallet. If this write
     fails, the venue cannot safely attribute a later receipt to the plan;
     fail the *handoff*, not the financial transaction (none was sent yet). */
  const persistStrategyRuntime = useCallback((strategy, spec, runtime) => {
    if (!strategy?.ok || !runtime) return false;
    try {
      return Boolean(saveStrategyPlan({ strategy, goal: spec || strategy.goal || null, runtime: runtime.state() }));
    } catch { return false; }
  }, []);

  const runStrategyStage = useCallback(async (message, strategy) => {
    if (!strategy?.ok) return;
    let runtime = strategyRuntimesRef.current.get(strategy.strategyId);
    if (!runtime) {
      /* Resume from the store when there is a saved plan: a strategy built
         for a 4-month horizon that restarts at stage one on every reload
         would re-run stages the user already signed. */
      let hydrate = null;
      try {
        const saved = loadStrategyPlan(strategy.strategyId);
        hydrate = saved ? hydrateRuntimeArgs(saved)?.hydrate || null : null;
      } catch { hydrate = null; }
      runtime = createChatStrategyRuntime({
        strategy,
        spec: message.strategySpec || null,
        context: aiContext,
        wallet: wallet || null,
        portfolio: aiContext.portfolio || null,
        hydrate
      });
      strategyRuntimesRef.current.set(strategy.strategyId, runtime);
    }
    const next = runtime.nextStage();
    const fa = locale.startsWith('fa');
    if (!next.ok) {
      if (next.code === 'AWAITING_RECEIPT') {
        const read = await reconcileStrategyReceipts({
          strategy, stageId: next.stageId, owner: aiContext.wallet?.address,
          getProvider: wallet?.getReadProvider ? (chainId) => wallet.getReadProvider(chainId) : null
        });
        if (read.ok) {
          const confirmed = runtime.confirmStage(next.stageId, { receipt: read.receipt });
          if (confirmed.ok) {
            if (!persistStrategyRuntime(strategy, message.strategySpec || null, runtime)) {
              strategyRuntimesRef.current.delete(strategy.strategyId);
              setMessages((prev) => [...prev, {
                id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
                content: fa
                  ? 'تراکنش‌ها روی زنجیره تطبیق شدند، اما ثبت تأیید مرحله در این دستگاه انجام نشد. رسید را نگه دار؛ پس از رفع مشکل ذخیره‌سازی، دوباره «ادامه» را بزن تا بدون امضای مجدد بررسی شود.'
                  : 'Transactions were verified on-chain, but this device could not save the stage confirmation. Keep the receipts; fix storage and retry Continue to reconcile without signing again.'
              }]);
              return;
            }
            setMessages((prev) => [...prev, {
              id: makeId(), role: 'ai', kind: 'assistant', ui: { type: 'TEXT' },
              content: fa
                ? `رسیدهای ${read.receipt.actions.length} اقدام «${next.stageId}» روی زنجیره و با حساب تو تطبیق داده شدند. مرحله بعد فقط با تأیید تازه تو شروع می‌شود.`
                : `The ${read.receipt.actions.length} receipts for “${next.stageId}” matched on-chain transactions from your wallet. The next stage starts only with your fresh confirmation.`
            }]);
            return;
          }
        }
        // A missing local hint or an unrelated receipt is NOT evidence that
        // the transaction failed. Do not re-open the venue automatically:
        // re-signing before inspecting the wallet can send the same amount twice.
        const missing = read.missing?.map((r) => `${r.actionIndex + 1}: ${r.code}`).join('، ') || read.code;
        setMessages((prev) => [...prev, {
          id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
          content: fa
            ? `مرحله «${next.stageId}» هنوز قطعی نیست (${missing}). ${read.verifiedCount || 0} از ${read.requiredCount || (next.actions || []).filter((a) => a.requiresSignature).length} اقدام تطبیق شد. قبل از هر امضای دوباره، وضعیت تراکنش در کیف پول/صفحه مقصد را بررسی کن؛ مرحله بعد قفل است.`
            : `Stage “${next.stageId}” is not settled (${missing}). ${read.verifiedCount || 0} of ${read.requiredCount || (next.actions || []).filter((a) => a.requiresSignature).length} actions reconciled. Inspect the wallet/venue before signing again; later stages stay locked.`
        }]);
        return;
      }
      setMessages((prev) => [...prev, {
        id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
        content: fa
          ? `مرحله بعد اجرا نمی‌شود: ${next.code}${next.stageId ? ` (${next.stageId})` : ''}. چیزی به عنوان موفق گزارش نمی‌شود.`
          : `The next stage will not run: ${next.code}${next.stageId ? ` (${next.stageId})` : ''}. Nothing is reported as a success.`
      }]);
      return;
    }
    if (next.done) {
      setMessages((prev) => [...prev, {
        id: makeId(), role: 'ai', kind: 'assistant', ui: { type: 'TEXT' },
        content: fa ? 'همه‌ی مراحل اجرا شده‌اند. از این‌جا پایش ادامه دارد.' : 'Every stage has run. From here it is monitoring.'
      }]);
      return;
    }
    /* Run preflight IN chat, against a fresh, complete wallet snapshot. A
       disconnect, unknown capital, partial portfolio or out-of-band risk is a
       refusal — it cannot be recorded as a completed check. Gas, approvals and
       the final quote still belong to each venue before its wallet signature. */
    if (next.stage?.id === 'preflight') {
      const check = evaluateStrategyPreflight({
        strategy, wallet: aiContext.wallet, portfolio: aiContext.portfolio
      });
      if (!check.ok) {
        const hints = {
          WALLET_REQUIRED: fa ? 'کیف پول را وصل کن.' : 'Connect a wallet.',
          WALLET_CANNOT_SIGN: fa ? 'کیف پول را باز کن.' : 'Unlock your wallet.',
          PORTFOLIO_NOT_LIVE: fa ? 'خواندن پرتفوی را تازه کن.' : 'Refresh the portfolio read.',
          PRICE_NOT_LIVE: fa ? 'قیمت دلاری دارایی‌ها زنده نیست؛ بازار را تازه کن.' : 'Refresh the live USD market prices.',
          PORTFOLIO_STALE: fa ? 'داده کیف پول کهنه است؛ دوباره بخوان.' : 'Refresh the wallet data.',
          CAPITAL_NOT_VERIFIED: fa ? 'موجودی خوانده‌شده سرمایه هدف را پوشش نمی‌دهد.' : 'The read balance does not cover your stated capital.',
          SOURCE_CHAIN_CAPITAL_NOT_VERIFIED: fa ? 'سرمایه کافی روی زنجیره کیف پول فعلی نیست؛ من موجودی زنجیره دیگر را قابل خرج اینجا نمی‌دانم.' : 'Not enough capital on the current wallet chain; capital on another chain is not spendable here.',
          BRIDGE_USDC_NOT_VERIFIED: fa ? 'برای بریج باید روی زنجیره مبدأ USDC کافی داشته باشی؛ تبدیل دارایی نیازمند قیمت تازه و امضای جداست.' : 'The source chain needs enough USDC to bridge; conversion needs a fresh quote and a separate wallet signature.',
          WALLET_CHAIN_DIFFERS_REBUILD: fa ? 'زنجیره کیف پول با برنامه نمی‌خواند؛ با کیف پول وصل‌شده برنامه را بازسازی کن.' : 'The wallet chain differs from the plan; rebuild with the connected wallet.',
          RISK_LIMIT: fa ? 'طرح از محدودیت ریسک می‌گذرد؛ برنامه را بازسازی کن.' : 'The plan exceeds the risk limit; rebuild it.'
        };
        setMessages((prev) => [...prev, {
          id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
          content: fa
            ? `پیش‌پرواز تأیید نشد (${check.code}). ${hints[check.code] || 'طرح را دوباره بررسی کن.'} هیچ مرحله‌ای اجرا یا تأیید نشد.`
            : `Preflight did not pass (${check.code}). ${hints[check.code] || 'Review the plan.'} No stage was run or confirmed.`,
          actions: check.code === 'BRIDGE_USDC_NOT_VERIFIED'
            ? [{ id: 'prepare-usdc', label: fa ? 'تبدیل به USDC در سواپ' : 'Convert to USDC in Swap',
              route: `/swap?chain=${encodeURIComponent(String(aiContext.wallet?.chainId || ''))}&to=USDC` }]
            : []
        }]);
        return;
      }
      runtime.advance();
      const verified = runtime.confirmStage('preflight', {
        receipt: { ok: true, kind: 'local-wallet-risk-check', checkedAt: check.checkedAt,
          availableUsd: check.availableUsd, unverified: check.unverified }
      });
      if (!verified.ok) return;
      if (!persistStrategyRuntime(strategy, message.strategySpec || null, runtime)) {
        strategyRuntimesRef.current.delete(strategy.strategyId);
        setMessages((prev) => [...prev, {
          id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
          content: fa ? 'پیش‌پرواز بررسی شد ولی ذخیره نشد؛ قبل از هر مرحلهٔ مالی دوباره تلاش کن.'
            : 'Preflight was checked but could not be saved; retry before any financial stage.'
        }]);
        return;
      }
      setMessages((prev) => [...prev, {
        id: makeId(), role: 'ai', kind: 'assistant', ui: { type: 'TEXT' },
        content: fa
          ? `پیش‌پرواز محلی گذشت: موجودی خوانده‌شده $${check.availableUsd.toLocaleString('en-US')}، سقف ریسک بررسی شد. گاز، مجوز توکن و قیمت هنوز تأیید نشده‌اند؛ صفحه مقصد قبل از امضای هر تراکنش دوباره بررسی‌شان می‌کند. با دکمه مرحله بعد ادامه بده.`
          : `Local preflight passed: read balance $${check.availableUsd.toLocaleString('en-US')} and risk budget checked. Gas, token approval and live quote are NOT verified yet; review each at the venue before signing. Continue with the next stage button.`
      }]);
      return;
    }
    if (next.stage?.id === 'monitor') {
      // Observing without a real portfolio is a refusal, not a completed stage.
      const result = monitorStrategy(message, strategy);
      if (result?.ok) {
        runtime.advance();
        runtime.confirmStage('monitor', { receipt: { ok: true, kind: 'portfolio-observation', checkedAt: Date.now() } });
        if (!persistStrategyRuntime(strategy, message.strategySpec || null, runtime)) {
          strategyRuntimesRef.current.delete(strategy.strategyId);
          setMessages((prev) => [...prev, {
            id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
            content: fa ? 'پایش انجام شد اما ثبت مرحله روی دستگاه شکست خورد؛ برای ادامهٔ قابل‌اتکا دوباره تلاش کن.'
              : 'The monitoring read ran, but this device could not save its stage; retry before treating it as persistent.'
          }]);
        }
      }
      return;
    }
    if (next.movesFunds && (!walletConnected || !walletCanSign)) { openWalletSheet(message.content, 'STRATEGY_PLAN'); return; }
    const firstIndex = next.actions?.findIndex((a) => a.requiresSignature && a.route) ?? -1;
    const first = firstIndex >= 0 ? next.actions[firstIndex] : null;
    const actionRoute = (action, index) => strategyActionRoute(action, {
      strategyId: strategy.strategyId, stageId: next.stage.id, actionIndex: index
    });
    if (next.movesFunds && (!first || next.actions.some((a) => a.requiresSignature && !a.route))) {
      setMessages((prev) => [...prev, {
        id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
        content: fa ? 'یکی از اقدام‌ها صفحهٔ اجرای معتبر ندارد؛ مرحله شروع نشد. طرح را بازسازی کن.'
          : 'An action has no execution venue; this stage was not started. Rebuild the plan.'
      }]);
      return;
    }
    const unverifiable = next.movesFunds
      ? next.actions.map((a, i) => ({ action: a, index: i }))
        .filter(({ action }) => action.requiresSignature && !strategyReceiptSupport(action)) : [];
    if (unverifiable.length) {
      // The venue itself remains available, but do not send a user to sign an
      // action whose result this strategy can never attribute or reconcile.
      // The preview routes below are deliberately NOT stage-labelled.
      setMessages((prev) => [...prev, {
        id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
        content: fa
          ? `مرحله «${next.stage.title}» آغاز نشد: برای ${unverifiable.map(({ index }) => index + 1).join('، ')} رسید قابل‌تطبیق خودکار ندارم. صفحه‌های مقصد مستقلاً قابل استفاده‌اند، اما انجامشان را به این طرح منتسب یا مرحله بعد را باز نمی‌کنم. برای ادامهٔ مرحله‌ای، طرح قابل‌تأیید دیگری بساز.`
          : `Stage “${next.stage.title}” was not started: action(s) ${unverifiable.map(({ index }) => index + 1).join(', ')} lack independent receipt reconciliation. You can use their venues separately, but I cannot attribute them to this plan or unlock later stages. Rebuild a verifiable plan to continue in stages.`,
        actions: unverifiable.map(({ action, index }) => ({
          id: `standalone-${next.stage.id}-${index}`, label: `${index + 1}. ${action.operation} · ${action.route}`,
          route: action.route
        }))
      }]);
      return;
    }
    /*
     * Only now is the stage really leaving this surface, so only now is it
     * marked RUNNING and written back. Marking it earlier would record a
     * hand-off that never happened when the wallet gate turns the user away.
     *
     * RUNNING is the honest ceiling here: the signature happens at the venue.
     * On return, chat asks the provider for the transaction and protocol event;
     * only a matching proof can mark this stage CONFIRMED.
     */
    runtime.advance();
    if (!persistStrategyRuntime(strategy, message.strategySpec || null, runtime)) {
      // Do not navigate to a wallet after losing the only pending-stage key.
      // Drop the in-memory advance so retry can hydrate the last saved state.
      strategyRuntimesRef.current.delete(strategy.strategyId);
      setMessages((prev) => [...prev, {
        id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
        content: fa
          ? 'ذخیرهٔ مرحله در دستگاه ممکن نشد؛ هیچ صفحهٔ امضایی باز نکردم. فضای ذخیره‌سازی مرورگر را بررسی کن و دوباره تلاش کن.'
          : 'Could not save the pending stage on this device; no signing page was opened. Check browser storage and retry.'
      }]);
      return;
    }
    setMessages((prev) => [...prev, {
      id: makeId(), role: 'ai', kind: 'assistant', ui: { type: 'TEXT' },
      content: fa
        ? `مرحله «${next.stage.title}»: ${next.stage.objective} تأیید و امضا در همان صفحه انجام می‌شود — من در چت امضا نمی‌کنم.`
        : `Stage "${next.stage.title}": ${next.stage.objective} Confirmation and signature happen on that page — I do not sign in chat.`,
      actions: (next.actions || []).map((action, i) => ({ action, index: i }))
        .filter(({ action }) => action.route).map(({ action, index }) => ({
          id: `stage-${next.stage.id}-${index}`, route: actionRoute(action, index),
          label: `${index + 1}. ${action.operation || action.module} ${action.params?.asset || action.params?.token || ''}`.trim()
        }))
    }]);
    if (first?.route) {
      /* Identify the exact pending action for receipt lookup on return;
         the handoff itself neither confirms nor skips a money stage. */
      try {
        writePendingHandoff({
          route: actionRoute(first, firstIndex),
          label: fa ? `مرحله «${next.stage.title}» در ${routeFaLabel(first.route)}` : `Stage "${next.stage.title}" on ${first.route}`,
          kind: 'strategy-stage',
          strategyId: strategy.strategyId,
          stageId: next.stage.id,
          actionIndex: firstIndex,
          seasonId: seasonIdRef.current
        });
      } catch {}
      navigate(actionRoute(first, firstIndex));
    }
  }, [aiContext, wallet, locale, walletConnected, walletCanSign, openWalletSheet, navigate, persistStrategyRuntime]);

  /*
   * ─── STRATEGY BRAIN: monitoring and revision ────────────────────────────
   * The last two legs of the pipeline. A plan that is built and executed but
   * never measured against reality is a brochure, so this reads the REAL
   * portfolio and hands it to the runtime, which compares it against the
   * plan's own curve and the user's drawdown budget.
   *
   * No timer, no polling: the check runs when the user asks for it. A resident
   * loop would be exactly the kind of always-on load a small host cannot
   * spare, and a number nobody is looking at is not worth fetching.
   */
  const strategyLiveRef = useRef(new Map());
  /* The live verdicts live in a ref (a Map keyed by strategyId) because they
     are written from inside callbacks. The version counter is what actually
     re-renders: a ref mutation on its own would leave the card showing the
     previous verdict forever. Deriving a plain object keeps the prop stable
     enough for the row's memo to behave. */
  const [strategyLiveVersion, setStrategyLiveVersion] = useState(0);
  const strategyLive = useMemo(() => {
    void strategyLiveVersion;
    return Object.fromEntries(strategyLiveRef.current);
  }, [strategyLiveVersion]);

  /** Resolve the runtime for a plan, hydrating stage truth from the store. */
  const strategyRuntimeFor = useCallback((message, strategy) => {
    if (!strategy?.ok) return null;
    let runtime = strategyRuntimesRef.current.get(strategy.strategyId);
    if (!runtime) {
      let hydrate = null;
      try {
        const saved = loadStrategyPlan(strategy.strategyId);
        hydrate = saved ? hydrateRuntimeArgs(saved)?.hydrate || null : null;
      } catch { hydrate = null; }
      runtime = createChatStrategyRuntime({
        strategy,
        spec: message.strategySpec || null,
        context: aiContext,
        wallet: wallet || null,
        portfolio: aiContext.portfolio || null,
        hydrate
      });
      strategyRuntimesRef.current.set(strategy.strategyId, runtime);
    }
    return runtime;
  }, [aiContext, wallet]);

  const monitorStrategy = useCallback((message, strategy) => {
    const runtime = strategyRuntimeFor(message, strategy);
    const fa = locale.startsWith('fa');
    if (!runtime) return;
    const portfolio = aiContext.portfolio || null;
    const financialStages = (strategy.stages || []).filter((s) => s.movesFunds);
    const confirmed = runtime.state().stageProgress || {};
    const hasReceipts = financialStages.length > 0 && financialStages.every((s) =>
      confirmed[s.id]?.state === 'CONFIRMED' && confirmed[s.id]?.receipt?.verified === true);
    // A total wallet balance is NOT this strategy's P&L (the user can hold
    // other assets). Until venue receipts and attributable positions exist,
    // reporting CONTINUE/REVISE/HALT from the whole wallet would fabricate it.
    if (!hasReceipts || !portfolio?.strategyPositions?.[strategy.strategyId]) {
      setMessages((prev) => [...prev, {
        id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
        content: fa
          ? 'پایش سود این استراتژی هنوز قابل‌تأیید نیست: رسید معتبرِ همه مراحل مالی و موقعیت‌های منتسب به همین طرح لازم است. ارزش کل کیف پول، سود این برنامه نیست.'
          : 'Strategy P&L cannot be verified yet: every financial stage needs a checked receipt and positions attributable to this plan. Total wallet value is not this strategy’s return.'
      }]);
      return { ok: false, code: 'STRATEGY_POSITIONS_UNATTRIBUTED' };
    }
    const valueUsd = Number(portfolio.strategyPositions[strategy.strategyId]?.valueUsd);
    if (portfolio?.dataStatus !== 'live' || portfolio.partial === true
      || !Number.isFinite(Number(portfolio.fetchedAt))
      || Number(portfolio.fetchedAt) > Date.now() + 5_000
      || Date.now() - Number(portfolio.fetchedAt) > 120_000
      || !Number.isFinite(valueUsd) || valueUsd <= 0) {
      setMessages((prev) => [...prev, {
        id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
        content: fa
          ? 'برای سنجیدن برنامه باید ارزش واقعی و تازهٔ پرتفوی را ببینم — کیف پول را وصل و داده‌ها را تازه کن. حدس نمی‌زنم.'
          : 'To check the plan I need the portfolio\'s real value — connect the wallet so I can compare it. I will not guess.'
      }]);
      return;
    }
    const result = runtime.observe({ portfolioValueUsd: valueUsd });
    strategyLiveRef.current.set(strategy.strategyId, {
      decision: result.decision,
      triggers: result.triggers || [],
      last: result.observation || null,
      curve: result.curve || null,
      revisionCount: result.revisionsUsed || 0
    });
    persistStrategyRuntime(strategy, message.strategySpec || null, runtime);
    setStrategyLiveVersion((v) => v + 1);
    const label = {
      CONTINUE: fa ? 'برنامه روی مسیر است.' : 'The plan is on track.',
      REVISE: fa ? 'برنامه از مسیر خارج شده — بازسازی پیشنهاد می‌شود.' : 'The plan has drifted — a rebuild is advised.',
      HALT: fa ? 'توقف: بودجه ریسک شکسته شده است.' : 'Halted: the risk budget is breached.',
      COMPLETE: fa ? 'افق زمانی برنامه تمام شده است.' : 'The plan has reached the end of its horizon.'
    }[result.decision] || result.decision;
    setMessages((prev) => [...prev, {
      id: makeId(), role: 'ai', kind: 'assistant', ui: { type: 'TEXT' },
      content: fa
        ? `${label} ارزش واقعی ${Number(valueUsd).toLocaleString()} دلار در برابر سرمایه‌ی ${Number(strategy.goal?.capitalUsd || 0).toLocaleString()} دلار.`
        : `${label} Real value $${Number(valueUsd).toLocaleString()} against $${Number(strategy.goal?.capitalUsd || 0).toLocaleString()} of capital.`
    }]);
    return result;
  }, [aiContext, locale, persistStrategyRuntime, strategyRuntimeFor]);

  const reviseStrategy = useCallback(async (message, strategy) => {
    const runtime = strategyRuntimeFor(message, strategy);
    const fa = locale.startsWith('fa');
    if (!runtime) return;
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, strategyBusy: true } : m)));
    const result = await runtime.revise({ reason: 'USER_REQUESTED' });
    if (!result.ok) {
      setMessages((prev) => [...prev.map((m) => (m.id === message.id ? { ...m, strategyBusy: false } : m)), {
        id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
        content: fa
          ? `بازسازی انجام نشد: ${result.code}. استراتژی قبلی دست‌نخورده باقی می‌ماند.`
          : `The rebuild did not happen: ${result.code}. The previous strategy stays as it was.`
      }]);
      return;
    }
    /* The revision replaces the plan on this message, and the chain is
       persisted so a reload resumes the NEW strategy, not the old one. */
    try {
      linkRevision({ fromStrategyId: strategy.strategyId, toStrategyId: result.strategy.strategyId });
      saveStrategyPlan({ strategy: result.strategy, goal: message.strategySpec || null, runtime: runtime.state() });
    } catch { /* persistence must never block the revision */ }
    strategyLiveRef.current.set(result.strategy.strategyId, {
      decision: 'CONTINUE', triggers: [], last: null, curve: null,
      revisionCount: result.revision?.at ? 1 : 0
    });
    setMessages((prev) => prev.map((m) => (m.id === message.id
      ? { ...m, strategyPlan: result.strategy, strategyBusy: false }
      : m)));
    setStrategyLiveVersion((v) => v + 1);
  }, [locale, persistStrategyRuntime, strategyRuntimeFor]);

  /**
   * Execute one goal option for real. The steps are the venue actions the
   * executors sign; the confirmation gate and the runtime's receipt rule still
   * apply, so this can end in a receipt or in a named failure — never in a
   * claim.
   */
  const executeGoalOption = useCallback(async (message, option) => {
    if (!option?.actions?.length) return;
    if (!walletConnected) {
      openWalletSheet(message.content, 'GOAL_PLAN');
      return;
    }
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, goalBusy: true } : m)));
    const fa = locale.startsWith('fa');
    /* Goal plans walk real legs too: the same immutable constitution applies. */
    const goalRules = checkConstitution({ actions: option.actions, balances: aiContext.balances || null, defaultChainId: wallet?.chainId || defaultChainId || null });
    if (!goalRules.ok) {
      setMessages((prev) => [
        ...prev.map((m) => (m.id === message.id ? { ...m, goalBusy: false } : m)),
        { id: makeId(), role: 'ai', content: explainConstitution(goalRules, locale), kind: 'error', ui: { type: 'TEXT' } }
      ]);
      return;
    }
    try {
      const result = await runExecutionPlan({
        actions: option.actions,
        hooks: buildBrowserHooks(wallet),
        wallet: {
          connected: walletConnected,
          canSign: walletCanSign,
          address: wallet?.address || null,
          evmAddresses: aiContext.wallet?.evmAddresses,
          chainId: wallet?.chainId || defaultChainId
        },
        drivers: autonomyDriversRef.current
      });
      const ok = result?.success === true;
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: ok
          ? (fa
            ? `انجام شد. ${result.txHashes?.length || 1} تراکنش با رسید روی زنجیره تأیید شد.${result.txHash ? `\n${result.txHash}` : ''}`
            : `Done. ${result.txHashes?.length || 1} transaction(s) confirmed with a receipt on chain.${result.txHash ? `\n${result.txHash}` : ''}`)
          : (fa
            ? `اجرا نشد: ${result?.error?.code || result?.status || 'FAILED'}${result?.error?.message && result.error.message !== result.error.code ? ` — ${result.error.message}` : ''}. هیچ چیزی به عنوان موفق گزارش نمی‌شود.`
            : `Not executed: ${result?.error?.code || result?.status || 'FAILED'}${result?.error?.message && result.error.message !== result.error.code ? ` — ${result.error.message}` : ''}. Nothing is being reported as a success.`),
        kind: ok ? 'result' : 'error',
        ui: { type: 'RESULT_CARD' },
        card: ok && result.txHash ? { txHash: result.txHash } : null
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: fa ? `خطا در اجرا: ${String(err?.message || err).slice(0, 140)}` : `Execution error: ${String(err?.message || err).slice(0, 140)}`,
        kind: 'error',
        ui: { type: 'TEXT' }
      }]);
    } finally {
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, goalBusy: false } : m)));
    }
  }, [walletConnected, walletCanSign, wallet, aiContext, defaultChainId, locale, openWalletSheet]);

  /* Route chips on AI bubbles («بازار», «فارم», «نمودار کامل»…) navigate the
     same way the OS navigation agent does — closing panels first so the
     target page is never rendered behind a stuck overlay. */

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
      void persistIntentOSSession(os8StateRef.current, { ownerKey: 'intent-unified', remote: false }).catch(() => {});
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
          content: t('intentAIOS.automationCreated'),
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
          content: t('intentAIOS.goalCreated'),
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

      /* Content-bound approval + constitution, right before the wallet is
         asked to sign. The server issued `approval` over the exact legs it
         prepared; if anything between that card and this tap changed a leg,
         the digest no longer matches and nothing reaches the wallet. The
         constitution is re-checked here too, against fresh balances. */
      if (!isRebalanceKind(type)) {
        const binding = verifyPlanBinding(prepared?.approval, plannedActions);
        const rules = checkConstitution({ actions: plannedActions, balances: aiContext.balances || null, defaultChainId: walletSnap.chainId ?? null });
        if (!binding.ok || !rules.ok) {
          setActivitySteps((prev) => prev.map((s) => s.id === 'risk_check' ? { ...s, status: 'failed' } : s));
          setMessages((prev) => [...prev, {
            id: makeId(),
            role: 'ai',
            content: !rules.ok
              ? explainConstitution(rules, locale)
              : (locale.startsWith('fa')
                ? (binding.code === 'APPROVAL_EXPIRED'
                  ? 'تأیید این برنامه منقضی شده است. برای امنیت شما دوباره آن را می‌سازم؛ درخواست را یک بار دیگر بفرستید.'
                  : 'برنامه‌ای که قرار بود امضا شود با برنامه‌ای که تأیید کردید یکی نیست. برای امنیت شما هیچ چیزی به کیف پول فرستاده نشد؛ درخواست را دوباره بفرستید.')
                : (binding.code === 'APPROVAL_EXPIRED'
                  ? 'The approval for this plan has expired. Send the request again and I will rebuild it.'
                  : 'The plan about to be signed is not the plan you approved. Nothing was sent to your wallet; please send the request again.')),
            kind: 'error',
            ui: { type: 'TEXT' }
          }]);
          obsRef.current.log({ intentId, type: 'ERROR', payload: { error: !rules.ok ? 'CONSTITUTION_VIOLATION' : binding.code } });
          return;
        }
      }
      setActivitySteps((prev) => prev.map((s) => s.id === 'risk_check' ? { ...s, status: 'completed' } : s.id === 'executing' ? { ...s, status: 'active' } : s));

      let result;
      if (isRebalanceKind(type)) {
        result = await runRebalance({
          holdings: aiContext.portfolio?.holdings,
          balances: aiContext.balances,
          target: rebalance?.target || prepared?.rebalance?.target,
          hooks,
          wallet: walletSnap,
          drivers: autonomyDriversRef.current
        });
      } else {
        result = await runExecutionPlan({
          actions: plannedActions,
          hooks,
          wallet: walletSnap,
          /* Without this every non-swap step fails as VENUE_DRIVER_MISSING —
             the runtime needs the venue drivers to reach a real signature. */
          drivers: autonomyDriversRef.current
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
          void persistIntentOSSession(monitored, { ownerKey: 'intent-unified', remote: false }).catch(() => {});
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
    /* A navigation return is not a settlement receipt. Neither "cancelled"
       nor "done" changes a money stage without independent reconciliation. */
    if (msg?.choiceKind === 'HANDOFF_OUTCOME') {
      const pickedId = String(choice?.id || choice?.value || '');
      const faLoc = locale.startsWith('fa');
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, responded: true, selectedChoiceLabel: choice?.label || '' } : m)));
      const handoff = msg?.handoff || {};
      const say = (content, extra = {}) => setMessages((prev) => [...prev, {
        id: makeId(), role: 'ai', content, kind: 'assistant', ui: { type: 'TEXT' }, ...extra
      }]);

      if (pickedId === 'handoff-browse') {
        say(faLoc ? 'باشه، مشکلی نیست. هر وقت آماده بودی بگو ادامه بده.' : 'No problem. Say continue whenever you are ready.');
        return;
      }
      const planMsg = handoff.strategyId
        ? (messagesRef.current || []).find((m) => m.strategyPlan?.strategyId === handoff.strategyId)
        : null;
      const plan = planMsg?.strategyPlan || null;
      if (pickedId === 'handoff-cancelled') {
        // "I cancelled" cannot prove that a broadcast transaction did not
        // settle while the app was backgrounded. Keep a money stage RUNNING,
        // not FAILED; never unlock it or offer a silent re-send.
        say(plan && handoff.stageId
          ? (faLoc
            ? `لغو را ثبت کردم، اما وضعیت زنجیرهٔ «${handoff.stageId}» هنوز نامعلوم است. پیش از هر امضای دوباره تاریخچه را ببین؛ مرحله‌های بعد بسته می‌مانند.`
            : `Noted, but the on-chain status of “${handoff.stageId}” is still unknown. Inspect history before signing again; later stages stay locked.`)
          : (faLoc ? 'باشه، هیچ نتیجه‌ای ثبت نشد.' : 'Understood; no outcome was recorded.'));
        return;
      }
      if (plan && handoff.stageId) {
        // A claim of "done" triggers provider reconciliation; the user's
        // words alone never satisfy even one signed action.
        void runStrategyStage(planMsg, plan);
        return;
      }
      say(faLoc
        ? `متوجه شدم — به «${handoff.label || ''}» رفتی. نتیجه را بدون رسید تأییدشده قطعی ثبت نمی‌کنم.`
        : `Noted: you visited "${handoff.label || ''}". I cannot mark an outcome final without a verified receipt.`);
      return;
    }
    /*
     * Agent creation answers (slot chips, the «بسازم؟» confirm, suggested
     * agents). Handled by the agent loop below via ref — see agentOpsRef.
     */
    if (msg?.choiceKind === 'AGENT_SLOT' || msg?.choiceKind === 'AGENT_CONFIRM' || msg?.choiceKind === 'SUGGEST_AGENT') {
      try { agentOpsRef.current?.handleChoice?.(msg, choice); } catch {}
      return;
    }
    if (msg?.choiceKind === 'STRATEGY_NEXT') {
      const faLoc = locale.startsWith('fa');
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, responded: true, selectedChoiceLabel: choice?.label || '' } : m)));
      const planMsg = (messagesRef.current || []).find((m) => m.strategyPlan?.strategyId === String(choice?.value || ''));
      if (planMsg?.strategyPlan) {
        runStrategyStage(planMsg, planMsg.strategyPlan);
      } else {
        setMessages((prev) => [...prev, {
          id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
          content: faLoc ? 'برنامه را در این رشته پیدا نکردم — سشن عوض شده؟' : 'I could not find the plan in this thread — did the season change?'
        }]);
      }
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
  }, [locale, strategyRuntimeFor, persistStrategyRuntime, runStrategyStage]);

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
    if (isSessionFull) {
      handleStartNewChat();
      return;
    }
    if (input.trim()) void sendMessage(input);
  }, [input, sendMessage, isSessionFull, handleStartNewChat]);

  /*
   * ─── UPGRADE 13 — VOICE INPUT ON THE SURFACE PEOPLE ACTUALLY USE ────────
   * Dictation lived on the old panel; `/intent` had no microphone at all, so
   * «حرف زدن را بفهمد» was unmet on the live surface regardless of how good the
   * parser got. Three rules shape the implementation:
   *
   *   1. the transcript lands in the composer UN sent — a mis-heard «۵۰۰» that
   *      auto-submits becomes a real order, which is the one failure a mic
   *      button must never have
   *   2. the recognition locale comes from the browser's own advertised list
   *      when it has one, because an unsupported tag is silence, not noise
   *   3. where the browser has no speech engine, the button is absent — not
   *      present, not disabled, not promising something it cannot do
   */
  const speechRef = useRef(null);
  const [dictating, setDictating] = useState(false);
  const [dictationNote, setDictationNote] = useState(null);
  const speech = useMemo(() => {
    try {
      /* The Web Speech API exposes no supported-locale list in Chromium, so
         `availableLocales` stays null and the preference order in
         `speechRecognitionLangFor` decides. A browser that DOES expose one is
         honoured the moment it exists, which is why the parameter is threaded. */
      const win = typeof window !== 'undefined' ? window : null;
      const availableLocales = win?.speechSynthesis?.getVoices?.().map?.((v) => v.lang).filter(Boolean) || null;
      const support = speechSupport(win, { locale, availableLocales });
      const pick = speechRecognitionLangFor(locale, { availableLocales });
      return { supported: support.supported, reason: support.reason || null, lang: pick.lang, exact: pick.exact };
    } catch {
      return { supported: false, reason: 'PROBE_FAILED', lang: 'en-US', exact: false };
    }
  }, [locale]);

  const stopDictation = useCallback(() => {
    try { speechRef.current?.stop?.(); } catch { /* already stopped */ }
    speechRef.current = null;
    setDictating(false);
  }, []);

  const toggleDictation = useCallback(() => {
    if (!speech.supported) return;
    if (dictating) { stopDictation(); return; }
    const Ctor = speechSupport(typeof window !== 'undefined' ? window : null).ctor;
    if (!Ctor) return;
    let rec = null;
    try {
      rec = new Ctor();
      rec.lang = speech.lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (event) => {
        const result = event?.results?.[event?.resultIndex ?? 0] || event?.results?.[0];
        const alt = result?.[0];
        const cleaned = normalizeTranscript(alt?.transcript || '', {
          lang: locale,
          confidence: Number.isFinite(Number(alt?.confidence)) ? Number(alt.confidence) : null,
          isFinal: Boolean(result?.isFinal)
        });
        if (cleaned.empty) return;
        setInput((prev) => dictatedDraft(prev, cleaned).value);
        /* An interim partial is a draft in progress, not a doubtful transcript:
           the «read this before you send» note is only earned on a final result. */
        setDictationNote(result?.isFinal && cleaned.needsConfirmation
          ? (String(locale).startsWith('fa')
            ? 'دقت تشخیص پایین بود — قبل از ارسال یک بار متن را بخوان.'
            : 'Low recognition confidence — read the text before sending.')
          : null);
        if (result?.isFinal) setDictating(false);
      };
      rec.onerror = (event) => {
        const code = String(event?.error || 'error');
        setDictationNote(code === 'not-allowed' || code === 'service-not-allowed'
          ? (String(locale).startsWith('fa') ? 'دسترسی میکروفن داده نشد.' : 'Microphone permission was not granted.')
          : (String(locale).startsWith('fa') ? 'تشخیص صدا جواب نداد؛ دوباره تلاش کن یا تایپ کن.' : 'Speech recognition failed — try again, or type it.'));
        setDictating(false);
        speechRef.current = null;
      };
      rec.onend = () => { setDictating(false); speechRef.current = null; };
      speechRef.current = rec;
      setDictationNote(null);
      setDictating(true);
      rec.start();
    } catch {
      setDictating(false);
      speechRef.current = null;
      setDictationNote(String(locale).startsWith('fa') ? 'میکروفن در این مرورگر کار نمی‌کند.' : 'The microphone could not be started in this browser.');
    }
  }, [dictating, locale, speech.lang, speech.supported, stopDictation]);

  /* A microphone left open across a route change keeps listening into a page
     nobody is looking at. Release it on unmount, always. */
  useEffect(() => () => { try { speechRef.current?.abort?.(); } catch { /* gone */ } }, []);

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

  /*
   * pushTurn + appendOp live here — above every automation/agent callback —
   * because those callbacks list them in their dependency arrays, and a
   * dependency array reads its values during render (a later declaration
   * would be a temporal-dead-zone crash on mount).
   */
  const pushTurn = useCallback((m) => {
    setMessages((prev) => [...prev, m]);
    return m;
  }, []);

  const appendOp = useCallback((op) => {
    try {
      const row = appendOperation({ conversationId, seasonId: seasonIdRef.current, ...op });
      setHistData(readHistory());
      return row;
    } catch {
      return null;
    }
  }, [conversationId]);

  const toggleAutomation = useCallback(async (row) => {
    if (!row) return;
    const fa = locale.startsWith('fa');
    const label = row.kind === 'rebalance'
      ? (fa ? 'تعادل پرتفوی' : 'rebalance')
      : (fa ? `خرید دوره‌ای ${row.asset || ''}`.trim() : `DCA ${row.asset || ''}`.trim());
    let out = null;
    if (row.status === 'ACTIVE' || row.active) {
      out = await aiPauseAutomation(row.id);
    } else {
      /* Resume in place — the old code "resumed" by creating a brand-new
         automation, duplicating the agent on every pause/resume cycle. */
      out = await aiResumeAutomation(row.id);
    }
    await refreshAutomations();
    pushTurn({
      id: makeId(),
      role: 'ai',
      kind: out?.ok === false ? 'error' : 'assistant',
      ui: { type: 'TEXT' },
      content: out?.ok === false
        ? (fa ? `«${label}» تغییر نکرد: ${String(out?.error || 'UNAVAILABLE')}` : `"${label}" did not change: ${String(out?.error || 'UNAVAILABLE')}`)
        : (row.status === 'ACTIVE' || row.active)
          ? (fa ? `«${label}» متوقف شد. برنامه‌اش پاک نشده — هر وقت خواستی «ادامه» بزن.` : `"${label}" paused. Its schedule is kept — resume any time.`)
          : (fa ? `«${label}» ادامه یافت و دوباره فعال است.` : `"${label}" resumed and active again.`)
    });
    appendOp({
      kind: (row.status === 'ACTIVE' || row.active) ? 'AUTOMATION_PAUSE' : 'AUTOMATION_RESUME',
      status: out?.ok === false ? 'FAILED' : 'ACTIVE',
      title: label,
      detail: String(row.id || ''),
      ref: row.id || null,
      refKind: 'automation'
    });
    setAiTab('chat');
  }, [locale, pushTurn, appendOp, refreshAutomations]);

  const runAutomationNow = useCallback(async (row) => {
    if (!row) return;
    const fa = locale.startsWith('fa');
    const run = await aiRunAutomation(row.id);
    if (run?.ok && run.action) {
      setPendingExecution({
        action: run.action,
        actions: [run.action],
        message: `${row.kind || row.type} ${row.asset || ''}`.trim(),
        intentType: run.action.type,
        card: {
          title: t('intentAIOS.readyTitle'),
          kind: run.action.type,
          confirmLabel: t('intentAIOS.confirm'),
          editLabel: t('intentAIOS.edit')
        }
      });
      // The confirmation card lives in the chat — take the user to it.
      setAiTab('chat');
    } else {
      pushTurn({
        id: makeId(),
        role: 'ai',
        kind: 'error',
        ui: { type: 'TEXT' },
        content: (fa ? 'اجرا شروع نشد: ' : 'The run did not start: ') + String(run?.error || 'UNAVAILABLE')
      });
      setAiTab('chat');
    }
  }, [t, locale, pushTurn]);

  const deleteAutomationRow = useCallback(async (row) => {
    if (!row) return;
    const fa = locale.startsWith('fa');
    const label = row.kind === 'rebalance'
      ? (fa ? 'تعادل پرتفوی' : 'rebalance')
      : (fa ? `خرید دوره‌ای ${row.asset || ''}`.trim() : `DCA ${row.asset || ''}`.trim());
    const out = await aiDeleteAutomation(row.id);
    await refreshAutomations();
    pushTurn({
      id: makeId(),
      role: 'ai',
      kind: out?.ok === false ? 'error' : 'assistant',
      ui: { type: 'TEXT' },
      content: out?.ok === false
        ? (fa ? `«${label}» حذف نشد: ${String(out?.error || 'UNAVAILABLE')}` : `"${label}" was not deleted: ${String(out?.error || 'UNAVAILABLE')}`)
        : (fa ? `«${label}» حذف شد.` : `"${label}" deleted.`)
    });
    appendOp({
      kind: 'AUTOMATION_DELETE',
      status: out?.ok === false ? 'FAILED' : 'CANCELLED',
      title: label,
      detail: String(row.id || ''),
      ref: row.id || null,
      refKind: 'automation'
    });
    setAiTab('chat');
  }, [locale, pushTurn, appendOp, refreshAutomations]);

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


  const persistedCountRef = useRef(0);
  useEffect(() => {
    try {
      const fresh = messages.slice(persistedCountRef.current);
      if (fresh.length) {
        const seasonId = seasonIdRef.current;
        const at = Date.now();
        let firstAt = null;
        let lastAt = null;
        let lastMessage = '';
        let title = '';
        let addCount = 0;
        for (const m of fresh) {
          // The greeting is not a conversation turn; it must not pollute the
          // season archive or the message count.
          if (m.kind === 'hello') continue;
          const when = Number(m.at) || at;
          const recorded = appendConversation({
            conversationId,
            seasonId,
            sourceId: m.id,
            role: m.role,
            content: m.content,
            kind: m.kind,
            intentType: m.intentType,
            operationId: m.operationId || null
          }, { now: when });
          // A restored (resumed) season re-persists its rows, but the archive
          // already has them — only NEWLY recorded rows move the counters.
          if (!recorded) continue;
          firstAt = firstAt == null ? when : Math.min(firstAt, when);
          lastAt = lastAt == null ? when : Math.max(lastAt, when);
          lastMessage = String(m.content || '');
          if (m.role === 'user' && !title) title = String(m.content || '');
          addCount += 1;
        }
        if (addCount > 0) {
          appendSeason({
            seasonId,
            conversationId,
            title,
            lastMessage,
            firstAt,
            lastAt,
            addCount
          });
        }
        persistedCountRef.current = messages.length;
      }
      /*
       * The FULL thread snapshot — cards, choices, plans included — so a
       * reload, a navigation away, or an expired convState never loses the
       * conversation. Device-local only; failures are silent by design.
       */
      try { saveThreadSnapshot(seasonIdRef.current, messages); } catch {}
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
      const [ms, orders, tools] = await Promise.allSettled([
        apiMonitorEngineStatus(),
        Promise.resolve(loadOrders()),
        fetchAiTools()
      ]);
      setMonitorEngineStatus(ms.status === 'fulfilled' ? ms.value : null);
      setServerReachable(ms.status === 'fulfilled' && ms.value?.ok === true);
      if (orders.status === 'fulfilled') setOrdersFromStore(orders.value);
      if (tools.status === 'fulfilled' && tools.value?.ok) {
        const list = Array.isArray(tools.value.tools) ? tools.value.tools : [];
        setAiToolsInfo({ count: list.length, online: true });
      } else {
        setAiToolsInfo((prev) => ({ count: prev?.count ?? 0, online: false }));
      }
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
      setAiFleetSummary(res.summary || null);
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

  /*
   * The live probe. It costs one tiny call per configured provider, so it is a
   * button, never an automatic effect — and it is the only place in the app that
   * can tell the operator WHY a model with a saved key is not answering.
   */
  const runAiSelfTest = useCallback(async () => {
    setAiSelfTestBusy(true);
    setAiSelfTestError(null);
    const res = await fetchGatewaySelfTest().catch(() => null);
    setAiSelfTestBusy(false);
    if (res?.ok && Array.isArray(res.providers)) {
      setAiSelfTest(res);
      /* The self-test just proved who can answer — refresh the fleet so the
         cards and the summary show the verdict rather than the older guess. */
      void loadAiProviders();
      return;
    }
    setAiSelfTestError(
      res?.error === 'TIMEOUT' ? 'TIMEOUT'
        : res?.status === 429 ? 'THROTTLED'
          : res?.status ? `HTTP_${res.status}`
            : (res?.error || 'NETWORK_UNAVAILABLE')
    );
  }, [loadAiProviders]);

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

  /*
   * ONE way to open anything the assistant offers.
   *
   * The reported dead button («مرکز عملیات» → «باز کن» did nothing) was a route
   * with nowhere to land: the human layer emits `/intent?tab=ops`, `navigate`
   * changed the query string, and this page never read it — the pathname was
   * already `/intent`, so nothing on screen moved. The legacy IntentOS page did
   * read `?tab`, but it is no longer routed.
   *
   * Every route now goes through resolveChatRoute, which returns either a real
   * navigation or an in-page target (panel / tab / ecosystem sheet). A route
   * that resolves to nothing is reported in the chat instead of failing
   * silently, and test/intent-ai/chat-route-contract-probe.mjs keeps the map
   * and the router in App.jsx from drifting apart.
   */
  const openBubbleRoute = useCallback((route) => {
    if (!route) return;
    const target = resolveChatRoute(route, { currentPathname: location.pathname || '/intent' });
    if (target.kind === 'panel') {
      setDrawerOpen(false);
      openPanel(target.panel);
      return;
    }
    if (target.kind === 'tab') {
      setPanel(null);
      setDrawerOpen(false);
      setAiTab(target.tab);
      return;
    }
    if (target.kind === 'ecosystem') {
      setDrawerOpen(false);
      openEcosystem(target.ecoKind);
      return;
    }
    if (target.kind === 'unknown') {
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: locale.startsWith('fa')
          ? 'این بخش را پیدا نکردم. به جای حدس زدن، صریحاً می‌گویم: این مقصد در اپ وجود ندارد.'
          : 'I could not find that screen. Rather than guess, I will say it plainly: that destination does not exist in the app.',
        kind: 'error',
        ui: { type: 'TEXT' }
      }]);
      return;
    }
    setPanel(null);
    setDrawerOpen(false);
    /* Leaving the chat for a venue: remember where the user went, so the
       return turn can ask for the outcome instead of pretending nothing
       happened. The thread itself is already snapshotted by the persist
       effect — it will be exactly as it was left.
       A RICHER hand-off (the strategy stage, written seconds ago by the
       stage runner) must not be flattened by the generic «باز کن» chip that
       carries the same route: keep whichever is fresher and more specific. */
    try {
      const existing = readPendingHandoff();
      const freshStageHandoff = existing
        && existing.route === target.to
        && existing.seasonId === seasonIdRef.current
        && existing.kind === 'strategy-stage'
        && (Date.now() - Number(existing.at || 0)) < 5 * 60 * 1000;
      if (!freshStageHandoff) {
        // A later leg opened from the plan card is still a strategy handoff.
        // Check its identity against the stored RUNNING stage: URL parameters
        // alone cannot start a stage or assert an outcome.
        const url = new URL(target.to, 'https://app.invalid');
        const strategyId = url.searchParams.get('strategyId');
        const stageId = url.searchParams.get('stageId');
        const rawIndex = url.searchParams.get('actionIndex');
        const index = rawIndex == null ? -1 : Number(rawIndex);
        const stored = strategyId ? loadStrategyPlan(strategyId) : null;
        const stage = stored?.strategy?.stages?.find((s) => s.id === stageId);
        const action = stage?.actions?.[index];
        const pending = stored?.runtime?.stageProgress?.[stageId]?.state === 'RUNNING'
          && action?.requiresSignature && target.to === strategyActionRoute(action, { strategyId, stageId, actionIndex: index });
        writePendingHandoff(pending
          ? { route: target.to, label: routeFaLabel(target.to), kind: 'strategy-stage',
            strategyId, stageId, actionIndex: index, seasonId: seasonIdRef.current }
          : { route: target.to, label: routeFaLabel(target.to), kind: 'route', seasonId: seasonIdRef.current });
      }
    } catch {}
    try { navigate(target.to); } catch { /* router ready */ }
  }, [navigate, location.pathname, openPanel, openEcosystem, locale]);

  /*
   * The RETURN turn. When the user comes back to /intent after an execution
   * hand-off (swap, farm, a strategy stage…), the thread is intact — but the
   * outcome of that hand-off is unknown. The honest move is to ask: «انجام
   * شد یا لغو شد؟» — with a continue path — instead of guessing or staying
   * silent. Fires at most once per hand-off (the key is cleared on show).
   */
  const maybeShowHandoffOutcome = useCallback((seasonId) => {
    let pending = null;
    try { pending = readPendingHandoff(); } catch { pending = null; }
    if (!pending || !pending.route) return false;
    // Only the season that issued the hand-off asks for its outcome; a
    // hand-off from another season waits until THAT season is continued.
    if (pending.seasonId && pending.seasonId !== seasonId) return false;
    try { clearPendingHandoff(); } catch {}
    const faLoc = locale.startsWith('fa');
    const label = pending.label || routeFaLabel(pending.route);
    setMessages((prev) => [...prev, {
      id: makeId(),
      role: 'ai',
      content: faLoc
        ? `برگشتی! «${label}» را باز کرده بودی — خروجی چی شد؟`
        : `Welcome back! You had opened "${label}" — how did it go?`,
      kind: 'assistant',
      ui: { type: 'TEXT' },
      handoff: {
        route: pending.route,
        label,
        kind: pending.kind || 'route',
        strategyId: pending.strategyId || null,
        stageId: pending.stageId || null
      },
      choices: [
        { id: 'handoff-done', label: pending.kind === 'strategy-stage'
          ? (faLoc ? 'تراکنش را در صفحه مقصد انجام دادم' : 'I used the venue')
          : (faLoc ? '✅ انجام شد' : '✅ Done') },
        { id: 'handoff-cancelled', label: faLoc ? '❌ لغو شد' : '❌ Cancelled' },
        { id: 'handoff-browse', label: faLoc ? '👀 فقط نگاه کردم' : '👀 Just looking' }
      ],
      choiceKind: 'HANDOFF_OUTCOME'
    }]);
    return true;
  }, [locale]);

  // Fire the return turn on mount — /intent unmounts on every navigation, so
  // every arrival back is a fresh mount and the one place to ask.
  useEffect(() => {
    try { maybeShowHandoffOutcome(seasonIdRef.current); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * `?tab=` also has to work when the user arrives from somewhere else in the
   * app (the Financial Goals hand-off, the AI panel's chips, a shared link).
   * Same resolver, so there is exactly one definition of what a tab means.
   */
  useEffect(() => {
    const search = String(location.search || '');
    if (!search) return;
    let tab = null;
    try { tab = new URLSearchParams(search).get('tab'); } catch { tab = null; }
    if (!tab) return;
    const target = resolveChatRoute(`/intent?tab=${encodeURIComponent(tab)}`, { currentPathname: '/intent' });
    if (target.kind === 'panel') { setDrawerOpen(false); openPanel(target.panel); return; }
    if (target.kind === 'ecosystem') { setDrawerOpen(false); openEcosystem(target.ecoKind); return; }
    if (target.kind === 'tab') { setPanel(null); setDrawerOpen(false); setAiTab(target.tab); }
  }, [location.search, openPanel, openEcosystem]);


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

  /*
   * ─── AGENT FACTORY: the creation loop ────────────────────────────────────
   * «برام یک ایجنت بساز که …» ends here. The factory (agentFactory.js) parses
   * the sentence purely; this loop asks for the missing slots (chips or free
   * text), confirms the exact agent, and creates it through the SAME
   * monitor/automation registries the forms use — never a parallel fake.
   * Suggested agents and the intelligence-fleet «بساز» buttons feed the same
   * loop, so there is exactly one way an agent comes to exist.
   */
  const askAgentSlot = useCallback((draft, slot) => {
    const q = agentSlotQuestion(slot, draft, locale);
    pendingAgentDraftRef.current = { draft, slot };
    pushTurn({
      id: makeId(),
      role: 'ai',
      content: q.text,
      kind: 'assistant',
      ui: { type: 'TEXT' },
      agentDraft: draft,
      agentSlot: slot,
      choices: Array.isArray(q.choices) ? q.choices : [],
      choiceKind: q.choices?.length ? 'AGENT_SLOT' : null
    });
  }, [locale, pushTurn]);

  const askAgentConfirm = useCallback((draft) => {
    const fa = locale.startsWith('fa');
    pendingAgentDraftRef.current = { draft, slot: 'confirm' };
    pushTurn({
      id: makeId(),
      role: 'ai',
      content: `${agentSummary(draft, locale)}\n\n${fa ? 'بسازمش؟' : 'Build it?'}`,
      kind: 'assistant',
      ui: { type: 'TEXT' },
      agentDraft: draft,
      choices: [
        { id: 'agent-confirm-yes', label: fa ? '✓ بساز' : '✓ Build it' },
        { id: 'agent-confirm-edit', label: fa ? '✎ تغییرش بده' : '✎ Change it' },
        { id: 'agent-confirm-no', label: fa ? '✕ انصراف' : '✕ Cancel' }
      ],
      choiceKind: 'AGENT_CONFIRM'
    });
  }, [locale, pushTurn]);

  const advanceAgentDraft = useCallback((draft) => {
    if (!draft) return;
    const missing = missingSlots(draft);
    if (draft.kind && !missing.length) askAgentConfirm(draft);
    else askAgentSlot(draft, missing[0] || 'kind');
  }, [askAgentSlot, askAgentConfirm]);

  const createAgentFromDraft = useCallback(async (draft, { via = 'chat' } = {}) => {
    void via;
    const fa = locale.startsWith('fa');
    pendingAgentDraftRef.current = null;
    const built = buildAgentPayload(draft, { locale });
    if (built?.error) {
      pushTurn({
        id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
        content: fa ? 'این ایجنت ناقص است و ساخته نشد — از اول بگو چه ایجنتی می‌خواهی.' : 'This agent draft is incomplete and was not created — tell me again what you want.'
      });
      return;
    }
    if (built.backend === 'monitor') {
      await handleMonitorCreate({ ...built.draft, conversationId, source: 'agent-factory' });
      return;
    }
    setOpsBusy(true);
    const made = await aiCreateAutomation(built.input);
    if (!made?.ok) {
      pushTurn({
        id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
        content: (fa ? 'ایجنت ساخته نشد: ' : 'The agent was not created: ') + String(made?.error || 'UNAVAILABLE')
      });
      setOpsBusy(false);
      return;
    }
    await refreshAutomations();
    const a = made.automation || {};
    const freqFa = { DAILY: 'روزانه', WEEKLY: 'هفتگی', MONTHLY: 'ماهانه' }[String(a.frequency || '').toUpperCase()] || a.frequency || '';
    const label = a.kind === 'rebalance'
      ? (fa ? `تعادل ${freqFa} پرتفوی` : `${a.frequency} rebalance`)
      : (fa ? `خرید ${freqFa} ${a.amountUsd} دلار ${a.asset}` : `${a.frequency} buy $${a.amountUsd} ${a.asset}`);
    pushTurn({
      id: makeId(),
      role: 'ai',
      kind: 'assistant',
      ui: { type: 'TEXT' },
      content: fa
        ? `ایجنت «${label}» ساخته شد و فعال است. در تب ایجنت‌ها می‌بینی‌اش؛ هر اجرا با تأیید تو انجام می‌شود.`
        : `Agent "${label}" created and active. You can see it on the Agents tab; every run needs your confirmation.`
    });
    appendOp({
      kind: 'AUTOMATION_CREATE',
      status: 'ACTIVE',
      title: label,
      detail: `${a.kind || ''} ${a.asset || ''} ${a.amountUsd != null ? `$${a.amountUsd}` : ''} ${a.frequency || ''}`.trim(),
      ref: a.id || null,
      refKind: 'automation'
    });
    setOpsBusy(false);
  }, [conversationId, locale, pushTurn, appendOp, handleMonitorCreate, refreshAutomations]);

  const createSuggestedAgent = useCallback(async (templateId) => {
    const fa = locale.startsWith('fa');
    const draft = suggestedDraft(templateId);
    if (!draft?.ok) {
      setAiTab('chat');
      pushTurn({
        id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
        content: fa ? 'این قالب ایجنت را نشناختم.' : 'I did not recognise that agent template.'
      });
      return;
    }
    // The tap IS the confirmation — create immediately and report in chat.
    setAiTab('chat');
    await createAgentFromDraft(draft, { via: 'suggested' });
  }, [locale, pushTurn, createAgentFromDraft]);

  const handleAgentChoice = useCallback((msg, choice) => {
    const fa = locale.startsWith('fa');
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, responded: true, selectedChoiceLabel: choice?.label || '' } : m)));
    if (msg?.choiceKind === 'SUGGEST_AGENT') {
      if (String(choice?.id) === 'agent-custom' || String(choice?.value) === 'custom') {
        pendingAgentDraftRef.current = null;
        setInput(fa ? 'برام یک ایجنت بساز که ' : 'Build me an agent that ');
        return;
      }
      void createSuggestedAgent(String(choice?.value || ''));
      return;
    }
    if (msg?.choiceKind === 'AGENT_SLOT') {
      const slot = msg.agentSlot || pendingAgentDraftRef.current?.slot;
      const base = msg.agentDraft || pendingAgentDraftRef.current?.draft;
      const next = applyAgentChoice(base, slot, choice?.value);
      if (!next) {
        pendingAgentDraftRef.current = null;
        pushTurn({
          id: makeId(), role: 'ai', kind: 'error', ui: { type: 'TEXT' },
          content: fa ? 'این انتخاب را نفهمیدم — از اول بگو چه ایجنتی می‌خواهی.' : 'I did not understand that choice — tell me again what agent you want.'
        });
        return;
      }
      advanceAgentDraft(next);
      return;
    }
    // AGENT_CONFIRM
    const id = String(choice?.id || '');
    const draft = msg?.agentDraft || pendingAgentDraftRef.current?.draft;
    if (id === 'agent-confirm-yes') {
      if (!draft || missingSlots(draft).length) {
        if (draft) advanceAgentDraft(draft);
        return;
      }
      void createAgentFromDraft(draft, { via: 'chat' });
    } else if (id === 'agent-confirm-edit') {
      if (!draft) return;
      askAgentSlot(draft, primarySlot(draft.kind));
    } else {
      pendingAgentDraftRef.current = null;
      pushTurn({
        id: makeId(), role: 'ai', kind: 'assistant', ui: { type: 'TEXT' },
        content: fa ? 'باشه، ایجنت ساخته نشد. هر وقت خواستی بگو.' : 'OK, no agent was created. Just say the word.'
      });
    }
  }, [locale, pushTurn, advanceAgentDraft, askAgentSlot, createAgentFromDraft, createSuggestedAgent]);

  agentOpsRef.current = {
    handleChoice: handleAgentChoice,
    createSuggested: createSuggestedAgent,
    advance: advanceAgentDraft,
    create: createAgentFromDraft
  };

  /*
   * The intelligence-fleet «بساز» link. Each fleet card sends its own
   * verbatim AGENT_CREATE sentence through the real pipeline, so a fleet
   * agent becomes a working user agent via parse → confirm → create.
   */
  const spawnFleetAgent = useCallback((agentId) => {
    const prompt = fleetPrompt(agentId, locale);
    if (!prompt) return;
    setPanel(null);
    setAiTab('chat');
    try { void sendRef.current?.(prompt); } catch {}
  }, [locale]);

  const handleMonitorAction = useCallback(async (m, action) => {
    if (!m?.id) return;
    const fa = locale.startsWith('fa');
    setOpsBusy(true);
    let out = null;
    if (action === 'pause') out = await apiPauseMonitor(m.id);
    else if (action === 'resume') out = await apiResumeMonitor(m.id);
    else if (action === 'cancel') out = await apiCancelMonitor(m.id);
    else if (action === 'evaluate') out = await apiEvaluateMonitor(m.id);
    if (out?.ok) await refreshMonitors();
    const mon = out?.monitor || m;
    const label = mon.label || m.label || mon.asset?.symbol || (fa ? 'دیده‌بان' : 'monitor');

    let content = '';
    if (action === 'pause') content = fa ? `«${label}» متوقف شد. شرطش پاک نشده — هر وقت خواستی «ادامه» بزن.` : `"${label}" paused. Its condition is kept — resume any time.`;
    else if (action === 'resume') content = fa ? `«${label}» ادامه یافت و دوباره فعال است.` : `"${label}" resumed and active again.`;
    else if (action === 'cancel') content = fa ? `«${label}» لغو شد.` : `"${label}" cancelled.`;
    else if (action === 'evaluate') content = monitorEvaluateReport(mon, out, { locale });
    if (out?.ok === false || out?.error) {
      const err = String(out?.error || 'UNAVAILABLE');
      content += (content ? '\n' : '') + (fa ? `خطا: ${err}` : `Error: ${err}`);
    }

    /*
     * A yield («فرصت») check names the actual money: the best live venue, its
     * APY and its risk — «سود چیه، ریسک چیه». Best-effort: if the feed is
     * unreachable the evaluation numbers above still stand on their own.
     */
    if (action === 'evaluate' && out?.ok && String(mon.metric || '').toUpperCase() === 'OPPORTUNITY') {
      try {
        const data = await getYields();
        const pools = Array.isArray(data?.pools) ? data.pools : [];
        const ranked = pools
          .map((p) => ({ apy: Number(p.apy ?? p.apyPct), name: p.project || p.pool || p.symbol || '—', risk: p.risk || null }))
          .filter((r) => Number.isFinite(r.apy))
          .sort((a, b) => b.apy - a.apy)
          .slice(0, 3);
        if (ranked.length) {
          const riskFa = (r) => r === 'low' ? 'کم' : r === 'high' ? 'زیاد' : r === 'medium' ? 'متوسط' : '—';
          const lines = ranked.map((r, i) => fa
            ? `${i + 1}. ${r.name}: سود ${r.apy.toFixed(2)}٪ سالانه · ریسک ${riskFa(r.risk)}`
            : `${i + 1}. ${r.name}: ${r.apy.toFixed(2)}% APY · risk ${r.risk || '—'}`).join('\n');
          content += `\n\n${fa ? 'بهترین سودهای زنده الان:' : 'Best live yields right now:'}\n${lines}`;
        }
      } catch { /* the evaluation stands without the venue list */ }
    }

    pushTurn({
      id: makeId(),
      role: 'ai',
      kind: action === 'cancel' || out?.ok === false ? 'error' : 'assistant',
      ui: { type: 'MONITOR_CARD' },
      content,
      monitor: out?.monitor || { ...m, status: action === 'pause' ? 'PAUSED' : action === 'resume' ? 'ACTIVE' : action === 'cancel' ? 'CANCELLED' : m.status }
    });
    appendOp({
      kind: 'MONITOR_' + String(action).toUpperCase(),
      status: out?.ok === false ? 'FAILED' : (action === 'cancel' ? 'CANCELLED' : 'ACTIVE'),
      title: label,
      detail: action === 'evaluate' && out?.evaluation
        ? `value=${out.evaluation.display ?? out.evaluation.value ?? '—'} threshold=${mon.threshold} hit=${out.triggered === true}`
        : action,
      ref: m.id,
      refKind: 'monitor'
    });
    setOpsBusy(false);
    // Every agent action reports where the user reads: the chat.
    setAiTab('chat');
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

    /*
     * ── AGENT FACTORY ──
     * A pending agent draft owns the next turn: a slot answer fills it, a
     * cancellation kills it, a NEW agent sentence replaces it, and anything
     * else releases it so the normal pipeline treats the text as the new
     * topic it is (the old question's chips stay tappable on their message).
     */
    const pendingAgent = pendingAgentDraftRef.current;
    if (pendingAgent?.draft) {
      const fa = locale.startsWith('fa');
      if (/^(لغو|کنسل|بیخیال|انصراف|cancel|never\s*mind)/i.test(text)
        || (pendingAgent.slot === 'confirm' && /^(نه|نخیر|no)\s*[!.؟?]*$/i.test(text))) {
        pendingAgentDraftRef.current = null;
        pushTurn({
          id: makeId(), role: 'ai', kind: 'assistant', ui: { type: 'TEXT' },
          content: fa ? 'باشه، ایجنت ساخته نشد. هر وقت خواستی بگو.' : 'OK, no agent was created. Just say the word.'
        });
        return { handled: true };
      }
      if (isAgentCreateRequest(text)) {
        advanceAgentDraft(parseAgentRequest(text, { locale }));
        return { handled: true };
      }
      const filled = fillAgentSlot(pendingAgent.draft, pendingAgent.slot, text);
      if (filled) {
        advanceAgentDraft(filled);
        return { handled: true };
      }
      pendingAgentDraftRef.current = null;
      return { handled: false };
    }
    if (isAgentCreateRequest(text)) {
      advanceAgentDraft(parseAgentRequest(text, { locale }));
      return { handled: true };
    }

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
  }, [pendingDraft, activeContext, monitors, locale, pushTurn, handleMonitorCreate, handleOrderCreate, handleMonitorAction, runOpportunity, advanceAgentDraft]);

  contextHandlerRef.current = handleContextTurn;

  const newSeason = useCallback(() => {
    // The current thread is already archived (every turn is persisted as it
    // happens, and the full snapshot sits next to the archive); a new season
    // is simply a clean conversation under a new id.
    const next = makeSeasonId();
    writeSeasonId(next);
    seasonIdRef.current = next;
    // The old thread's pending hand-off belongs to the old season: a fresh
    // season must not open with «انجام شد یا لغو شد؟» for work the user left.
    try { clearPendingHandoff(); } catch {}
    persistedCountRef.current = 0;
    setActiveContext(null);
    setPendingExecution(null);
    setPendingDraft(null);
    const hello = {
      id: makeId(),
      role: 'ai',
      content: t('intentAIOS.hello'),
      kind: 'hello',
      ui: { type: 'TEXT' }
    };
    setMessages([hello]);
    setConvState((prev) => {
      const clean = createConversationState({ sessionId: prev?.sessionId, currentRoute: currentPage });
      return appendConvMessage(clean, hello);
    });
  }, [t, currentPage]);

  const handleContinue = useCallback((item) => {
    /*
     * Restores an archived season into the live thread and adopts its id so
     * the next turns continue the same episode instead of forking a new one.
     * Layer 1 is the FULL thread snapshot (cards, choices, strategy plans);
     * layer 2 is the text-only archive rows for seasons that predate
     * snapshots — with an honest note that the cards are gone.
     */
    const restoreSeasonThread = (seasonId) => {
      let restored = null;
      let full = false;
      try {
        const snap = loadThreadSnapshot(seasonId);
        if (Array.isArray(snap) && snap.length) {
          restored = sanitizeRestoredThread(snap);
          full = true;
        }
      } catch { restored = null; }
      if (!restored) {
        const rows = conversationsForSeason(seasonId, { history: readHistory() });
        if (rows.length) {
          restored = rows.map((c) => ({
            id: c.sourceId || c.id,
            role: c.role,
            content: c.content,
            kind: c.role === 'user' ? 'user' : (c.kind && c.kind !== 'hello' ? c.kind : 'assistant'),
            at: Number(c.at) || Date.now()
          }));
        }
      }
      if (!restored || !restored.length) return false;
      writeSeasonId(seasonId);
      seasonIdRef.current = seasonId;
      // The restored rows are, by definition, already in the archive — mark
      // them as persisted so the persist effect never re-records (and thus
      // never duplicates) them. Only the NEW turns that follow are appended.
      const faLoc = locale.startsWith('fa');
      const thread = full ? restored : [...restored, {
        id: makeId(),
        role: 'ai',
        content: faLoc
          ? 'این سشن قدیمی است — فقط متنش مانده و کارت‌ها (استراتژی، انتخاب‌ها) همراهش نیست. از اینجا به بعد همه‌چیز کامل ذخیره می‌شود.'
          : 'This is an older season — only its text survived, without the cards (strategy, choices). From here on everything is stored in full.',
        kind: 'assistant',
        ui: { type: 'TEXT' }
      }];
      persistedCountRef.current = restored.length;
      setMessages(thread);
      setConvState((prev) => ({ ...(prev || {}), messages: thread }));
      return true;
    };

    if (item?.kind === 'season' && item?.seasonId) {
      if (restoreSeasonThread(item.seasonId)) {
        // The continued season may own a hand-off the user never answered.
        try { maybeShowHandoffOutcome(item.seasonId); } catch {}
      }
      setActiveContext(null);
      setPanel(null);
      return;
    }
    /*
     * Continue on an OPERATION now restores the operation's own season when
     * it has one — the operation happened inside a conversation, and «ادامه»
     * means going back to exactly that conversation. Only operations without
     * a season (legacy rows) fall back to the old context-only resume.
     */
    if (item?.seasonId && restoreSeasonThread(item.seasonId)) {
      try { maybeShowHandoffOutcome(item.seasonId); } catch {}
    }
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
  }, [monitors, locale, pushTurn, maybeShowHandoffOutcome]);

  /* ── Trench-style surface: helpers for the tab views ───────────────────
     All of it reads state the page already owns — automations and monitors
     are the agent cards, seasons/orders/operations are the activity feed. */
  const fa = locale.startsWith('fa');
  const tagFmtTime = (ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '';
    const d = new Date(n < 1e12 ? n * 1000 : n);
    const diff = Date.now() - d.getTime();
    if (diff >= 0 && diff < 60000) return fa ? 'همین حالا' : 'now';
    if (diff >= 0 && diff < 3600000) return fa ? `${Math.floor(diff / 60000)} دقیقه پیش` : `${Math.floor(diff / 60000)}m ago`;
    if (diff >= 0 && diff < 86400000) return fa ? `${Math.floor(diff / 3600000)} ساعت پیش` : `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString(fa ? 'fa-IR' : undefined, { month: 'short', day: 'numeric' });
  };
  /*
   * «+ ایجنت جدید» opens the real creation flow in the chat: one tap per
   * suggested agent (the tap creates it), or a free sentence for a custom
   * one. It never prefills dead text anymore.
   */
  const spawnAgent = () => {
    setAiTab('chat');
    pendingAgentDraftRef.current = null;
    pushTurn({
      id: makeId(),
      role: 'ai',
      content: fa
        ? 'چه ایجنتی بسازم؟ یکی را بزن تا همان لحظه ساخته شود — یا بنویس دقیقاً چه کاری مدام انجام شود.'
        : 'Which agent should I build? Tap one to create it right away — or type exactly what should keep happening.',
      kind: 'assistant',
      ui: { type: 'TEXT' },
      choices: [
        ...SUGGESTED_AGENTS.map((s) => ({
          id: s.id,
          value: s.id,
          label: fa ? `✦ ${s.titleFa}` : `✦ ${s.titleEn}`
        })),
        { id: 'agent-custom', value: 'custom', label: fa ? '✍️ خودم می‌گم' : '✍️ I will describe it' }
      ],
      choiceKind: 'SUGGEST_AGENT'
    });
  };
  const agentCards = [
    ...(Array.isArray(automations) ? automations : []).map((a) => ({
      id: `auto-${a.id}`,
      kind: 'automation',
      raw: a,
      name: `${a.asset || '—'} ${String(a.kind || a.type || '').toUpperCase()}`,
      status: a.status || 'ACTIVE',
      meta: [a.frequency || a.cadence || null, a.amountUsd != null ? `$${a.amountUsd}` : null]
    })),
    ...(Array.isArray(monitors) ? monitors : []).map((m) => ({
      id: `mon-${m.id}`,
      kind: 'monitor',
      raw: m,
      name: m.label || m.asset?.symbol || (fa ? 'دیده‌بان' : 'Monitor'),
      status: m.status || 'ACTIVE',
      meta: [m.metric || null, m.asset?.symbol || null]
    }))
  ];
  const agentActiveCount = agentCards.filter((c) => (c.kind === 'monitor' ? isMonitorLive(c.raw) : c.status === 'ACTIVE')).length;

  return (
    <div className="iaos-page iaos-page-v6 tag-page" data-ai-tab={aiTab}>
      <div className="iaos-shell">
        <header className="iaos-header">
          <div className="iaos-title">
            <span className="iaos-mark iaos-mark-logo" aria-hidden="true">
              <svg width="32" height="32" viewBox="0 0 40 40" fill="none" role="img" aria-label="FBT Agent">
                <defs>
                  <linearGradient id="iaosBrandGrad" x1="3" y1="3" x2="37" y2="37" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#34d399" />
                    <stop offset="0.52" stopColor="#22d3ee" />
                    <stop offset="1" stopColor="#a78bfa" />
                  </linearGradient>
                  <linearGradient id="iaosBrandFill" x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#101014" />
                    <stop offset="1" stopColor="#08080c" />
                  </linearGradient>
                </defs>
                {/* Rounded squircle plate with smooth corners and minimal AI Sparkle mark */}
                <rect className="iaos-logo-plate" x="2.5" y="2.5" width="35" height="35" rx="12" fill="url(#iaosBrandFill)" stroke="url(#iaosBrandGrad)" strokeWidth="1.4" />
                <path
                  d="M20 8.5C20 13.8 15.8 18 10.5 18C15.8 18 20 22.2 20 27.5C20 22.2 24.2 18 29.5 18C24.2 18 20 13.8 20 8.5Z"
                  stroke="url(#iaosBrandGrad)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="20" cy="18" r="2.2" fill="url(#iaosBrandGrad)" />
                <circle cx="28.5" cy="9.5" r="1.3" fill="#34d399" />
              </svg>
            </span>
            <span className="iaos-title-copy">
              <h1>FBT AGENT</h1>
              <span className="iaos-title-sub">{locale.startsWith('fa') ? 'سیستم عامل ایجنت' : 'AGENT OS'}</span>
            </span>
            {/* Thinking Orb in header when active */}
            {thinkingState !== 'idle' ? (
              <ThinkingOrb state={thinkingState} size={18} locale={locale} showLabel={false} />
            ) : null}
          </div>
          <div className="iaos-header-status">
            <button
              type="button"
              className="iaos-new-season-btn"
              onClick={newSeason}
              aria-label={locale.startsWith('fa') ? 'شروع سشن جدید' : 'Start a new season'}
              title={locale.startsWith('fa') ? 'شروع سشن جدید' : 'New season'}
              data-testid="intent-ai-new-season"
            >
              +
            </button>
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

        {aiTab === 'chat' && (
        <>
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
                onOpenRoute={openBubbleRoute}
                onOsChip={sendSuggested}
                onGoalExecute={executeGoalOption}
                onStrategyExecute={runStrategyStage}
                onStrategyMonitor={monitorStrategy}
                onStrategyRevise={reviseStrategy}
                strategyLive={strategyLive}
                autonomyEngine={autonomyEngine}
                autonomyStrategies={autonomyStrategies}
                onAutonomyArm={armAutomation}
                onAutonomyDisarm={disarmAutomation}
                onAutonomyMode={setAutonomyMode}
                onAutonomyStart={startAutonomy}
                onAutonomyStop={stopAutonomy}
                onAutonomyTick={tickAutonomy}
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
                  {card?.title || t('intentAIOS.readyTitle')}
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
                        {t('intentAIOS.working')}
                      </span>
                    ) : (card?.confirmLabel || t('intentAIOS.confirm'))}
                  </button>
                  <button type="button" className="iaos-btn iss-ghost" onClick={editExecution}>
                    {card?.editLabel || t('intentAIOS.edit')}
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
            <div className="iaos-suggestions-title">✦ {t('intentAIOS.suggestions')}</div>
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
            {t('intentAIOS.solanaConnect')}
          </button>
        ) : null}

        {isSessionFull ? (
          <div className="iaos-session-full-banner">
            <div className="iaos-session-full-header">
              <span className="iaos-session-full-badge">⚠️ {locale.startsWith('fa') ? 'سقف ۱۰ فرمان تکمیل شد' : '10-task limit reached'}</span>
              <p className="iaos-session-full-text">
                {locale.startsWith('fa')
                  ? 'این صفحه ۱۰ فرمان هوشمند را با موفقیت انجام داد. جهت جلوگیری از شلوغی و حفظ حداکثر سرعت، لطفاً یک گفتگوی جدید آغاز کنید.'
                  : 'This session reached 10 tasks. To prevent crowding and maintain high performance, please start a new session.'}
              </p>
            </div>
            <button
              type="button"
              className="iaos-session-full-btn"
              onClick={handleStartNewChat}
            >
              ✦ {locale.startsWith('fa') ? 'شروع گفتگوی جدید و خلوت' : 'Start Fresh Session'}
            </button>
          </div>
        ) : null}

        {/* Phase 213 — the open question stays in front of the user until it is
            answered or explicitly dropped. When a multi-slot goal form is active
            the bar renders the DEDICATED answer box (سرمایه/سود/بازه/ریسک) so
            the user's answer is never mis-parsed as a new request. */}
        <PendingQuestionBar
          question={multiSlot.slot ? null : openQuestion}
          ack={questionAck}
          multiSlot={multiSlot}
          multiSlotParseError={multiSlotParseError}
          locale={locale}
          onAnswer={(answer) => { void sendMessage(answer); }}
          onSkip={() => {
            try { closeQuestion({ questionId: openQuestion?.id || null, reason: 'skipped' }); } catch { /* nothing to close */ }
            setOpenQuestion(getOpenQuestion({ conversationId }));
            setQuestionAck(locale.startsWith('fa') ? 'باشه، سؤال بسته شد.' : 'OK, the question is closed.');
          }}
          onDismiss={() => {
            try { closeQuestion({ questionId: openQuestion?.id || null, reason: 'closed_by_user' }); } catch { /* nothing to close */ }
            setOpenQuestion(null);
          }}
          onMultiSlotSubmit={multiSlotSubmit}
          onMultiSlotCancel={multiSlotCancel}
        />

        {/* §26 Mobile optimization — keyboard-aware, safe-area.
            Trench-style composer: a black pill with a round “+ actions” button
            (opens the Actions sheet) and a round send button. Nothing else. */}
        <form className="iaos-composer iaos-composer-v6" onSubmit={handleSubmit}>
          <button
            type="button"
            className="iaos-action-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label={t('intentAIOS.actions', { defaultValue: 'Actions' })}
            title={t('intentAIOS.actions', { defaultValue: 'Actions' })}
          >
            +
          </button>
          {speech.supported ? (
            <button
              type="button"
              className="iaos-mic"
              data-listening={dictating ? 'true' : 'false'}
              onClick={toggleDictation}
              aria-pressed={dictating}
              aria-label={t('intentAIOS.voiceInput', { defaultValue: dictating ? 'Stop dictation' : 'Speak your request' })}
              title={`${t('intentAIOS.voiceInput', { defaultValue: 'Speak your request' })} · ${speech.lang}${speech.exact ? '' : ' (approx.)'}`}
              data-lang={speech.lang}
              data-testid="intent-ai-mic"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <path d="M12 19v3" />
              </svg>
              <span className="sr-only">{dictating
                ? (locale.startsWith('fa') ? 'گوش می‌دهم' : 'Listening')
                : (locale.startsWith('fa') ? 'حرف بزن' : 'Speak')}</span>
            </button>
          ) : null}
          <input
            className="iaos-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={multiSlot.slot
              ? (locale.startsWith('fa') ? 'لطفاً در باکس سبز بالا پاسخ بده…' : 'Please answer in the green box above…')
              : (dictating
                ? t('intentAIOS.listening', { defaultValue: locale.startsWith('fa') ? 'دارم گوش می‌دم…' : 'Listening…' })
                : t('intentAIOS.placeholder', { defaultValue: 'Ask Intent AI…' }))}
            aria-label={t('intentAIOS.placeholder', { defaultValue: 'Ask Intent AI…' })}
            enterKeyHint="send"
            disabled={Boolean(multiSlot.slot)}
          />
          <button
            type="submit"
            className="iaos-send"
            aria-label={t('intentAIOS.send', { defaultValue: 'Send' })}
            disabled={!input.trim() || thinkingState !== 'idle' || Boolean(multiSlot.slot)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5" />
              <path d="m5 12 7-7 7 7" />
            </svg>
          </button>
        </form>
        {dictationNote ? (
          <p className="iaos-dictation-note" role="status" data-testid="intent-ai-dictation-note">
            {dictationNote}
          </p>
        ) : null}
        </>
        )}

        {/* ── AGENTS: every running automation + monitor as one card ─────────
            Organized into "در حال انجام" (in progress/active) and "تاریخچه" (history) */}
        {aiTab === 'agents' ? (
          <section className="tag-view" data-testid="tag-view-agents">
            <div className="tag-view-head">
              <div>
                <h2>{fa ? 'ایجنت‌ها' : 'Agents'}</h2>
                <span className="tag-view-sub">
                  {agentActiveCount} {fa ? 'فعال از' : 'active of'} {agentCards.length} {fa ? 'ایجنت' : 'agents'}
                </span>
              </div>
              <button type="button" className="tag-spawn" onClick={spawnAgent}>
                + {fa ? 'ایجنت جدید' : 'New agent'}
              </button>
            </div>

            {/* بخش ۱: در حال انجام */}
            <div className="tag-section">{fa ? 'در حال انجام (فعال)' : 'In Progress (Active)'}</div>
            {agentCards.filter((c) => c.status === 'ACTIVE').length ? (
              <div data-testid="intent-ai-active-automations">
                {agentCards.filter((c) => c.status === 'ACTIVE').map((c) => (
                  <div key={c.id} className="tag-card">
                    <div className="tag-card-head">
                      <span className="tag-dot" data-status={c.status} aria-hidden="true" />
                      <span className="tag-card-name">{c.name}</span>
                      <span className="tag-card-kind">{c.kind === 'monitor' ? (fa ? 'مانیتور' : 'MONITOR') : (fa ? 'خودکار' : 'AUTO')}</span>
                    </div>
                    <div className="tag-card-meta">
                      {c.meta.filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}
                      <span>{fa ? 'در حال اجرا' : 'running'}</span>
                    </div>
                    <div className="tag-card-actions">
                      {c.kind === 'automation' ? (
                        <>
                          <button type="button" className="tag-icon-btn" onClick={() => toggleAutomation(c.raw)}>
                            {fa ? 'توقف' : 'Pause'}
                          </button>
                          <button type="button" className="tag-icon-btn" onClick={() => runAutomationNow(c.raw)}>{fa ? 'اجرا' : 'Run'}</button>
                          <button type="button" className="tag-icon-btn" data-variant="danger" onClick={() => deleteAutomationRow(c.raw)}>{fa ? 'حذف' : 'Delete'}</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="tag-icon-btn" onClick={() => handleMonitorAction(c.raw, 'pause')}>
                            {fa ? 'توقف' : 'Pause'}
                          </button>
                          <button type="button" className="tag-icon-btn" onClick={() => handleMonitorAction(c.raw, 'evaluate')}>{fa ? 'بررسی' : 'Check'}</button>
                          <button type="button" className="tag-icon-btn" data-variant="danger" onClick={() => handleMonitorAction(c.raw, 'cancel')}>{fa ? 'لغو' : 'Cancel'}</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="tag-empty" style={{ padding: '16px', minHeight: 'auto' }}>
                <span className="tag-empty-title" style={{ fontSize: 13 }}>{fa ? 'ایجنتی در حال حاضر فعال نیست' : 'No agents currently running'}</span>
              </div>
            )}

            {/* بخش ۲: تاریخچه اجراها */}
            <div className="tag-section">{fa ? 'تاریخچه اجراها و ایجنت‌های متوقف' : 'Execution History & Paused Agents'}</div>
            {agentCards.filter((c) => c.status !== 'ACTIVE').length ? (
              <div>
                {agentCards.filter((c) => c.status !== 'ACTIVE').map((c) => (
                  <div key={c.id} className="tag-card">
                    <div className="tag-card-head">
                      <span className="tag-dot" data-status={c.status} aria-hidden="true" />
                      <span className="tag-card-name">{c.name}</span>
                      <span className="tag-card-kind">{c.kind === 'monitor' ? (fa ? 'مانیتور' : 'MONITOR') : (fa ? 'خودکار' : 'AUTO')}</span>
                    </div>
                    <div className="tag-card-meta">
                      {c.meta.filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}
                      <span>{c.status === 'PAUSED' ? (fa ? 'متوقف' : 'paused') : c.status}</span>
                    </div>
                    <div className="tag-card-actions">
                      {c.kind === 'automation' ? (
                        <>
                          <button type="button" className="tag-icon-btn" onClick={() => toggleAutomation(c.raw)}>
                            {fa ? 'ادامه' : 'Resume'}
                          </button>
                          <button type="button" className="tag-icon-btn" onClick={() => runAutomationNow(c.raw)}>{fa ? 'اجرا' : 'Run'}</button>
                          <button type="button" className="tag-icon-btn" data-variant="danger" onClick={() => deleteAutomationRow(c.raw)}>{fa ? 'حذف' : 'Delete'}</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="tag-icon-btn" onClick={() => handleMonitorAction(c.raw, 'resume')}>
                            {fa ? 'ادامه' : 'Resume'}
                          </button>
                          <button type="button" className="tag-icon-btn" onClick={() => handleMonitorAction(c.raw, 'evaluate')}>{fa ? 'بررسی' : 'Check'}</button>
                          <button type="button" className="tag-icon-btn" data-variant="danger" onClick={() => handleMonitorAction(c.raw, 'cancel')}>{fa ? 'لغو' : 'Cancel'}</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="tag-empty" style={{ padding: '16px', minHeight: 'auto' }}>
                <span className="tag-empty-title" style={{ fontSize: 13 }}>{fa ? 'هنوز سابقه یا ایجنت متوقفی وجود ندارد' : 'No past or paused agents'}</span>
              </div>
            )}

            <div className="tag-section">{fa ? 'ایجنت‌های پیشنهادی' : 'Suggested agents'}</div>
            <div data-testid="intent-ai-suggested-agents">
              {SUGGESTED_AGENTS.map((s) => (
                <div key={s.id} className="tag-card tag-suggest">
                  <div className="tag-card-head">
                    <span className="tag-card-name">{fa ? s.titleFa : s.titleEn}</span>
                  </div>
                  <div className="tag-card-meta">
                    <span>{fa ? s.descFa : s.descEn}</span>
                  </div>
                  <div className="tag-card-actions">
                    <button
                      type="button"
                      className="tag-icon-btn"
                      onClick={() => agentOpsRef.current?.createSuggested?.(s.id)}
                      data-testid={`suggest-agent-${s.id}`}
                    >
                      {fa ? 'بساز' : 'Build'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ── ACTIVITY: seasons, orders and recent operations ─────────────── */}
        {aiTab === 'activity' ? (
          <section className="tag-view" data-testid="tag-view-activity">
            <div className="tag-view-head">
              <div>
                <h2>{fa ? 'فعالیت' : 'Activity'}</h2>
                <span className="tag-view-sub">
                  {userTaskCount > 0 ? (fa ? 'گفتگوی جاری فعال' : 'Active session') : `${seasons.length} ${fa ? 'سشن' : 'seasons'}`} · {storedOrders.length} {fa ? 'سفارش' : 'orders'}
                </span>
              </div>
              <button type="button" className="tag-spawn" onClick={() => openPanel('history')}>
                {fa ? 'تاریخچه کامل' : 'Full history'}
              </button>
            </div>

            {/* Current Active Conversation */}
            {userTaskCount > 0 && (
              <>
                <div className="tag-section">{fa ? 'گفتگوی فعال جاری' : 'Current Active Session'}</div>
                <button
                  type="button"
                  className="tag-row"
                  style={{ border: '1px solid rgba(0, 229, 255, 0.28)', background: 'rgba(0, 229, 255, 0.06)' }}
                  onClick={() => setAiTab('chat')}
                >
                  <span className="tag-row-glyph" style={{ color: '#00e5ff' }} aria-hidden="true">●</span>
                  <span className="tag-row-copy">
                    <span className="tag-row-title">
                      {messages.find((m) => m.sender === 'user' || m.role === 'user')?.content?.slice(0, 50) || (fa ? 'گفتگوی جاری هوش مصنوعی' : 'Current Chat')}
                    </span>
                    <span className="tag-row-sub">
                      {userTaskCount} {fa ? 'فرمان ثبت‌شده · در حال اجرا' : 'tasks recorded · Active'}
                    </span>
                  </span>
                  <span className="tag-row-end" style={{ color: '#00e5ff', fontWeight: 700 }}>
                    {fa ? 'مشاهده چت ←' : 'View →'}
                  </span>
                </button>
              </>
            )}

            {seasons.length ? (
              <>
                <div className="tag-section">{fa ? 'سشن‌ها' : 'Seasons'}</div>
                {seasons.slice(0, 12).map((s) => (
                  <button
                    key={s.seasonId || s.conversationId}
                    type="button"
                    className="tag-row"
                    onClick={() => { handleContinue({ kind: 'season', seasonId: s.seasonId || s.conversationId, title: s.title }); setAiTab('chat'); }}
                  >
                    <span className="tag-row-glyph" aria-hidden="true">✦</span>
                    <span className="tag-row-copy">
                      <span className="tag-row-title">{s.title || (fa ? 'سشن بدون عنوان' : 'Untitled season')}</span>
                      <span className="tag-row-sub">{s.messageCount || 0} {fa ? 'پیام' : 'messages'}{s.lastMessage ? ` · ${String(s.lastMessage).slice(0, 60)}` : ''}</span>
                    </span>
                    <span className="tag-row-end">{tagFmtTime(s.lastAt || s.updatedAt)}</span>
                  </button>
                ))}
              </>
            ) : null}

            {storedOrders.length ? (
              <>
                <div className="tag-section">{fa ? 'سفارش‌ها' : 'Orders'}</div>
                {storedOrders.slice(0, 8).map((o, i) => (
                  <div key={o.id || i} className="tag-row" style={{ cursor: 'default' }}>
                    <span className="tag-row-glyph" aria-hidden="true">⇄</span>
                    <span className="tag-row-copy">
                      <span className="tag-row-title">{o.fromToken || '—'} → {o.toToken || '—'}</span>
                      <span className="tag-row-sub">{String(o.type || 'order').toUpperCase()} · {o.status === 'active' ? (fa ? 'فعال' : 'active') : o.status === 'paused' ? (fa ? 'متوقف' : 'paused') : (o.status || '')}{o.runsDone ? ` · ${o.runsDone} ${fa ? 'اجرا' : 'runs'}` : ''}</span>
                    </span>
                    <span className="tag-row-end">{tagFmtTime(o.createdAt)}</span>
                  </div>
                ))}
              </>
            ) : null}

            {Array.isArray(histData.operations) && histData.operations.length ? (
              <>
                <div className="tag-section">{fa ? 'عملیات‌ها' : 'Operations'}</div>
                {histData.operations.slice(0, 8).map((op, i) => (
                  <div key={op.id || i} className="tag-row" style={{ cursor: 'default' }}>
                    <span className="tag-row-glyph" aria-hidden="true">⌁</span>
                    <span className="tag-row-copy">
                      <span className="tag-row-title">{op.type || op.kind || op.title || (fa ? 'عملیات' : 'Operation')}</span>
                      <span className="tag-row-sub">{String(op.title || op.summary || op.content || '').slice(0, 70)}</span>
                    </span>
                    <span className="tag-row-end">{tagFmtTime(op.at || op.createdAt)}</span>
                  </div>
                ))}
              </>
            ) : null}

            {!userTaskCount && !seasons.length && !storedOrders.length && !(Array.isArray(histData.operations) && histData.operations.length) ? (
              <div className="tag-empty">
                <span className="tag-empty-glyph" aria-hidden="true">⌁</span>
                <span className="tag-empty-title">{fa ? 'فعالیتی ثبت نشده' : 'Nothing yet'}</span>
                <span className="tag-empty-sub">{fa ? 'هرچه با هوش مصنوعی انجام شود، اینجا ثبت می‌شود.' : 'Everything you do with the AI lands here.'}</span>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ── MORE: modern rows with clean SVG icons ── */}
        {aiTab === 'more' ? (
          <section className="tag-view" data-testid="tag-view-more">
            <div className="tag-view-head">
              <div>
                <h2>{fa ? 'بیشتر' : 'More'}</h2>
                <span className="tag-view-sub">{fa ? 'عملیات، تاریخچه و تنظیمات هوش' : 'Operations, history & intelligence'}</span>
              </div>
            </div>

            <button type="button" className="tag-row" data-testid="intent-ai-operations" onClick={() => openPanel('operations')}>
              <span className="tag-row-glyph" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              </span>
              <span className="tag-row-copy">
                <span className="tag-row-title">{opsText('ops.aria', locale)}</span>
                <span className="tag-row-sub">{fa ? 'مونیتور، سفارش و خودکارسازی' : 'Monitors, orders & automations'}</span>
              </span>
              <span className="tag-row-chevron" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
            </button>
            <button type="button" className="tag-row" data-testid="intent-ai-history" onClick={() => openPanel('history')}>
              <span className="tag-row-glyph" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </span>
              <span className="tag-row-copy">
                <span className="tag-row-title">{opsText('hist.title', locale)}</span>
                <span className="tag-row-sub">{fa ? 'سشن‌ها و گفتگوهای قبلی' : 'Past seasons & conversations'}</span>
              </span>
              <span className="tag-row-chevron" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
            </button>
            <button type="button" className="tag-row" data-testid="intent-ai-intelligence" onClick={() => openPanel('intelligence')}>
              <span className="tag-row-glyph" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              </span>
              <span className="tag-row-copy">
                <span className="tag-row-title">{opsText('menu.multiAi', locale)}</span>
                <span className="tag-row-sub">{fa ? 'مدل‌ها، اجماع و اعتماد پاسخ‌ها' : 'Models, consensus & confidence'}</span>
              </span>
              <span className="tag-row-chevron" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
            </button>
            <button type="button" className="tag-row" data-testid="intent-ai-ecosystem" onClick={() => openEcosystem('agent')}>
              <span className="tag-row-glyph" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              </span>
              <span className="tag-row-copy">
                <span className="tag-row-title">{opsText('eco.menu', locale)}</span>
                <span className="tag-row-sub">{fa ? 'ایجنت‌ها و استراتژی‌های ثبت‌شده' : 'Registered agents & strategies'}</span>
              </span>
              <span className="tag-row-chevron" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
            </button>
            <button type="button" className="tag-row" onClick={() => openPanel('status')}>
              <span className="tag-row-glyph" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              </span>
              <span className="tag-row-copy">
                <span className="tag-row-title">{fa ? 'وضعیت سیستم' : 'System status'}</span>
                <span className="tag-row-sub">{fa ? 'موتور، ابزارها و اتصال سرور' : 'Engine, tools & server link'}</span>
              </span>
              <span className="tag-row-chevron" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
            </button>

            <div className="tag-section">{fa ? 'اپلیکیشن' : 'App'}</div>
            {[
              {
                to: '/',
                title: fa ? 'بازار' : 'Market',
                sub: fa ? 'قیمت‌ها و جریان بازار' : 'Prices & market flow',
                svg: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
              },
              {
                to: '/portfolio',
                title: fa ? 'پرتفوی' : 'Portfolio',
                sub: fa ? 'دارایی‌ها و عملکرد' : 'Holdings & performance',
                svg: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
              },
              {
                to: '/wallet',
                title: fa ? 'کیف پول' : 'Wallet',
                sub: fa ? 'موجودی و تراکنش‌ها' : 'Balances & transactions',
                svg: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/></svg>
              },
              {
                to: '/swap',
                title: fa ? 'سواپ' : 'Swap',
                sub: fa ? 'تبادل توکن' : 'Token exchange',
                svg: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>
              }
            ].map((r) => (
              <button key={r.to} type="button" className="tag-row" onClick={() => { try { navigate(r.to); } catch { /* router ready */ } }}>
                <span className="tag-row-glyph" aria-hidden="true">{r.svg}</span>
                <span className="tag-row-copy">
                  <span className="tag-row-title">{r.title}</span>
                  <span className="tag-row-sub">{r.sub}</span>
                </span>
                <span className="tag-row-chevron" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
              </button>
            ))}
          </section>
        ) : null}
      </div>

      {/* ── Bottom tabs: chat · agents · activity · more ──────────────────── */}
      <nav className="tag-tabbar" aria-label={fa ? 'تب‌های دستیار' : 'Assistant tabs'}>
        <button type="button" className="tag-tab" data-active={aiTab === 'chat'} onClick={() => setAiTab('chat')}>
          <AnimatedChat active={aiTab === 'chat'} still={still} width={21} height={21} strokeWidth={aiTab === 'chat' ? 1.9 : 1.7} />
          <span className="tag-tab-label">{fa ? 'چت' : 'Chat'}</span>
        </button>
        <button type="button" className="tag-tab" data-active={aiTab === 'agents'} onClick={() => setAiTab('agents')} data-testid="tag-tab-agents">
          <AnimatedAgent active={aiTab === 'agents'} still={still} width={21} height={21} strokeWidth={aiTab === 'agents' ? 1.9 : 1.7} />
          {agentActiveCount > 0 ? <span className="tag-tab-badge" aria-hidden="true" /> : null}
          <span className="tag-tab-label">{fa ? 'ایجنت‌ها' : 'Agents'}</span>
        </button>
        <button type="button" className="tag-tab" data-active={aiTab === 'activity'} onClick={() => setAiTab('activity')}>
          <AnimatedActivity active={aiTab === 'activity'} still={still} width={21} height={21} strokeWidth={aiTab === 'activity' ? 2 : 1.7} />
          <span className="tag-tab-label">{fa ? 'فعالیت' : 'Activity'}</span>
        </button>
        <button type="button" className="tag-tab" data-active={aiTab === 'more'} onClick={() => setAiTab('more')}>
          <AnimatedPlus active={aiTab === 'more'} still={still} width={21} height={21} strokeWidth={2} />
          <span className="tag-tab-label">{fa ? 'بیشتر' : 'More'}</span>
        </button>
      </nav>

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
            <p className="iaos-drawer-note">{t('intentAIOS.drawerNote')}</p>
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
        summary={{
          walletConnected: walletConnected ? true : false,
          serverReachable,
          monitorsActive: countLiveMonitors(monitors),
          monitorsTotal: Array.isArray(monitors) ? monitors.length : 0,
          ordersCount: storedOrders.length,
          automationsCount: automations.length
        }}
      />
      <HistoryPanel
        open={panel === 'history'}
        onClose={() => setPanel(null)}
        history={histData}
        seasons={seasons}
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
          monitors: monitorEngineStatus || { active: countLiveMonitors(monitors), total: monitors.length },
          ordersCount: storedOrders.length,
          automationsCount: automations.length,
          engine: monitorEngineStatus || {},
          aiTools: aiToolsInfo,
          providersActive: providersStatus === 'ready'
            ? aiProviders.filter((p) => p.status === 'ACTIVE').length : null,
          providersTotal: providersStatus === 'ready' ? aiProviders.length : null
        }}
        locale={locale}
      />
      <IntelligencePanel
        open={panel === 'intelligence'}
        onClose={() => setPanel(null)}
        providers={aiProviders}
        providersStatus={providersStatus}
        providersError={providersError}
        fleetSummary={aiFleetSummary}
        selfTest={aiSelfTest}
        selfTestBusy={aiSelfTestBusy}
        selfTestError={aiSelfTestError}
        onRunSelfTest={() => { void runAiSelfTest(); }}
        onRetryProviders={() => { void loadAiProviders(); }}
        learningStats={learningStats}
        locale={locale}
        onSpawnAgent={spawnFleetAgent}
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
