/**
 * FBT INTENT OS — Universal AI Operating Agent — Unified Chat Surface V2
 * ---------------------------------------------------------------------------
 * Spec §1-§40 implemented:
 * - Universal Tool Registry with hierarchical dynamic loading
 * - Intent Understanding (not just keywords)
 * - Context Engine (current page, wallet, portfolio, conversation, memory)
 * - Current Page Awareness ("این را اجرا کن" refers to current page)
 * - Navigation Agent (no confirmation for nav)
 * - Media Control (OPEN_CALM → PLAY)
 * - Memory System (Working, Session, Long-Term, Retrieval-based)
 * - Action Memory
 * - Agent Loop PERCEIVE → UNDERSTAND → PLAN → ACT → OBSERVE → VERIFY → COMPLETE
 * - Multi-Agent Orchestrator (Intent, Portfolio, Market, Trading, Wallet, Yield, Research, Navigation, Media, Risk, Execution, Verification) — user sees only Intent AI
 * - Dynamic Suggestions (contextual, not static for all)
 * - Proactive (goal-based opportunities)
 * - Financial Agent (Goal → Portfolio → Risk → Market → Yield → Strategy → Execution)
 * - Universal Wallet Context (EVM, Solana, Balances, Tokens, NFT, Positions)
 * - Cross-App Action Bus & Event Bus
 * - App API Contract
 * - No hallucination — schema validation
 * - Human Response (no internal leaks)
 * - Confirmation: financial needs ONE confirmation, nav/media/read-only direct
 * - Task Continuity
 * - Memory Retrieval topK 8
 * - Verification Agent
 * - Self-Healing
 * - Observability
 * - AI Dashboard Internal (debug, hidden from user)
 * - Performance: Lazy Context, Parallel Reads, Caching
 * - Security: No private key, seed, raw secret — only address, balance, public position, wallet signs
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
  aiConfirm
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
import { isExecutionReady } from '../lib/intent-ai/contextResolver.js';
import { runExecutionPlan, runRebalance } from '../lib/intent-ai/executionRuntime.js';
import { buildBrowserHooks } from '../lib/intent-ai/browserExecution.js';
import '../styles/intent-ai-os.css';

// NEW OS — Universal
import { getIntentOS } from '../lib/intent-ai/os/index.js';
import { getCurrentPageContext, clearContextCache } from '../lib/intent-ai/os/contextEngine.js';
import { createRealServices } from '../lib/intent-ai/os/serviceAdapters.js';
import { setCentralWalletState, snapshotFromAppWallet } from '../lib/intent-ai/os/centralWalletState.js';
import { patchSharedState } from '../lib/intent-ai/os/sharedState.js';
import { getSuggestionsForIntent, getSuggestionsForMessage } from '../lib/intent-ai/os/suggestionEngine.js';
/* What an Operations card asks the assistant, per card and per language. The
   old inline map was Persian-only and fell back to the card TITLE, which is a
   label and classifies as GENERAL — that is why several cards did nothing. */
import { opsCardPrompt } from '../lib/intent-ai/os/opsCardPrompts.js';
/* Background audio has one owner: RadioDock's <audio>, mounted above the
   router. The assistant drives it through this store instead of building a
   second player that would die on the next navigation. */
import { useRadioStore } from '../store/useRadioStore.js';
import { getLastActiveTask, resumeTask as resumeTaskFn, getActiveTasks } from '../lib/intent-ai/os/taskContinuity.js';
import { getAllMemory } from '../lib/intent-ai/os/memoryEngine.js';
import { getLogs as getObsLogs, getStats as getObsStats } from '../lib/intent-ai/os/observability.js';
import { getDebugLogs, enableDebug } from '../lib/intent-ai/os/debugDashboard.js';
import { setupGlobalBus, emitEvent, onEvent } from '../lib/intent-ai/os/eventBus.js';
/* Operations Center — real monitors / conditional orders / opportunity engine /
   persistent history, all wired to the server and the real venue pages. */
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
  readHistory,
  clearHistory
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
/*
 * Agents + strategies, restored to a reachable surface. The catalog lived only
 * in the unrouted pages/IntentOS.jsx, which is why the feature "disappeared"
 * for users while every test stayed green — see IntentEcosystemPanel.jsx.
 */
import { EcosystemPanel } from './IntentEcosystemPanel.jsx';
import { opsText } from '../lib/intent-ai/os/opsPanelStrings.js';

const CONVERSATION_KEY = 'fbt.ai.os.conversation.v2';
const MAX_SUGGESTIONS = 4;
const DEFAULT_CHAIN = 42161;

const THINKING = ['Thinking…', 'Reading portfolio…', 'Checking market…', 'Building plan…'];

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


/**
 * ONE MESSAGE IN THE THREAD.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS IS ITS OWN MEMOIZED COMPONENT ─────────────────────────────────
 *   «اسکرول صفحه به بالا و پایین لگ می‌زند و فریز می‌شود»
 *
 * All of this markup used to be inlined in the parent's `messages.map(...)`.
 * That meant the entire conversation was rebuilt on EVERY parent render — and
 * the parent re-renders on every keystroke in the composer (`input` state),
 * every tick of the thinking indicator, every progress line, every wallet
 * poll. Typing one character re-rendered every bubble in the thread, including
 * the MonitorCard / OrderCard / OpportunityList subtrees hanging off them.
 *
 * A message is immutable once it lands. `memo` on a stable `m.id` means an
 * existing bubble renders exactly once, so the cost of a keystroke stops
 * scaling with conversation length. That is the freeze the user hit: it got
 * worse the longer they talked, which is the signature of per-render work
 * proportional to history.
 *
 * The callbacks are passed in already wrapped in `useCallback` by the parent,
 * so the memo comparison actually holds. Adding an unmemoized inline arrow to
 * this call site would silently defeat the whole thing.
 */
const ConversationRow = memo(function ConversationRow({
  m,
  t,
  locale,
  onConnectWallet,
  onChoose,
  onMonitorAction,
  onMonitorOpportunity
}) {
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
      </div>
    </div>
  );
});

export default function IntentAIUnified({ defaultChainId = DEFAULT_CHAIN }) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language || 'fa';
  const wallet = useWallet();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPage = location.pathname || '/intent';

  const canReadPortfolio = Boolean(wallet?.isConnected && wallet?.address && !wallet?.locked);
  const multi = useMultiChainPortfolio(canReadPortfolio ? wallet : null);

  const [messages, setMessages] = useState(() => [{
    id: makeId(),
    role: 'ai',
    content: t('intentAIOS.hello', { defaultValue: 'سلام! من Intent AI هستم. درباره کیف پول، بازار یا هر هدف مالی‌ات صحبت کن.' }),
    kind: 'hello',
    ui: { type: 'TEXT' }
  }]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
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
  /* Operations Center state */
  const [panel, setPanel] = useState(null); // null | 'operations' | 'history' | 'status' | 'intelligence' | 'ecosystem'
  /* Which half of the ecosystem panel the menu opened (agents vs strategies). */
  const [ecoKind, setEcoKind] = useState('agent');
  const [opsBusy, setOpsBusy] = useState(false);
  const [monitors, setMonitors] = useState([]);
  const [monitorEngineStatus, setMonitorEngineStatus] = useState(null);
  const [serverReachable, setServerReachable] = useState(null);
  const [activeContext, setActiveContext] = useState(null); // {type:'monitor'|'order'|'conversation', id, label}
  const [aiProviders, setAiProviders] = useState([]);
  const [learningStats, setLearningStats] = useState(null);
  const [monitorDraftOpen, setMonitorDraftOpen] = useState(false);
  const [orderDraftOpen, setOrderDraftOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState(null); // {kind, parsed, preview, message}
  const [histData, setHistData] = useState({ conversations: [], operations: [] });
  const [monitorInitial, setMonitorInitial] = useState(null);
  const [orderInitial, setOrderInitial] = useState(null);
  const contextHandlerRef = useRef(null);

  const threadRef = useRef(null);
  const busyRef = useRef(false);
  const resumeLock = useRef(false);
  const sendRef = useRef(null);
  const osRef = useRef(null);
  /*
   * ─── STICK-TO-BOTTOM ────────────────────────────────────────────────────
   * The thread auto-scrolls only while the user is already at (or near) the
   * bottom. Before this, ANY new message — including a background monitor
   * poll or a slow server reply — yanked a user who was reading history down
   * to the newest bubble. That is most of what "scrolling feels broken"
   * meant: the page kept fighting the user's thumb. A read of history now
   * stays put; a new turn only follows when the user was following already.
   */
  const stickToBottomRef = useRef(true);

  // Setup global bus once
  useEffect(() => {
    setupGlobalBus();
    // Listen for navigation events
    const unsub = onEvent('navigation.opened', (ev) => {
      const route = ev.payload?.route;
      if (route && route !== currentPage) {
        try { navigate(route); } catch {}
      }
    });
    return () => { try { unsub(); } catch {} };
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
      dataStatus: multi?.loading ? 'pending' : (holdings.length ? 'live' : 'unavailable'),
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
      getBalances: async () => ({
        ok: true,
        balances,
        dataStatus: multi?.loading ? 'pending' : (balances.length ? 'live' : (walletSnap.connected ? 'pending' : 'unavailable'))
      })
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
          dataStatus: list?.length ? 'live' : 'unavailable'
        };
      }
    };
    return real;
  }, [wallet, multi]);

  const intentOS = useMemo(() => {
    const os = getIntentOS({
      services: liveModuleServices,
      navigation: {
        navigate: async ({ route, params } = {}) => {
          const r = typeof route === 'string' ? route : route?.route;
          if (!r) return { ok: false };
          try {
            navigate(r);
            emitEvent('navigation.opened', { route: r, params }, 'intent-os');
            return { ok: true, route: r };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }
      },
      /* Actions are read off the store rather than subscribed to: this
         component must not re-render when the playhead moves. */
      radio: {
        play: (track, queue) => useRadioStore.getState().play(track, queue),
        setPlaying: (v) => useRadioStore.getState().setPlaying(v),
        stop: () => useRadioStore.getState().stop()
      },
      locale
    });
    os.setServices(liveModuleServices);
    osRef.current = os;
    return os;
  }, [liveModuleServices, navigate, locale]);

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

  /*
   * CENTRAL INTELLIGENCE SYNC — keep the central brain warm with the same
   * wallet/portfolio/page truth the chat uses (§5/§7/§17). Fire-and-forget:
   * the brain re-reads on demand if this hop fails.
   */
  useEffect(() => {
    try { centralIngest(aiContext); } catch { /* never block the UI on sync */ }
    try {
      setCentralWalletState(snapshotFromAppWallet(wallet, {
        solanaAddress: solanaAddressLive,
        tokenBalances: aiContext.balances,
        hydrating: aiContext.wallet?.hydrating,
        canSign: walletCanSign,
        source: 'intent-os-ui'
      }));
      patchSharedState('portfolio', aiContext.portfolio, {
        source: 'intent-os-ui',
        freshness: aiContext.portfolio?.freshness || 'FRESH'
      });
    } catch { /* shared state is best-effort */ }
  }, [aiContext, wallet, solanaAddressLive, walletCanSign]);

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

  // NEW: Local OS-first processing, then server fallback
  const sendMessage = useCallback(async (rawText, opts = {}) => {
    const message = String(rawText || '').trim();
    if (!message || busyRef.current) return null;
    busyRef.current = true;

    if (!opts.skipUserBubble) {
      setInput('');
      setMessages((prev) => [...prev, { id: makeId(), role: 'user', content: message, kind: 'user' }]);
    }

    const localizedThinking = locale.startsWith('fa')
      ? ['در حال درک درخواست شما…', 'بررسی کیف پول و بازار…', 'طراحی مسیر امن…']
      : ['Understanding your request…', 'Checking wallet & market…', 'Building safe plan…'];
    setThinking(localizedThinking);
    setSuggestions([]);

    try {
      // 0. Context continuation + natural-language monitor/order/opportunity
      //    intents are resolved HERE (before the generic chat), so «متوقفش کن»
      //    reaches the SAME monitor and «انجامش بده» really creates the order.
      if (contextHandlerRef.current) {
        const ctxOut = await contextHandlerRef.current(message);
        if (ctxOut?.handled) {
          setThinking([]);
          busyRef.current = false;
          return true;
        }
      }
      // 1. Try local Intent OS first (for nav, media, portfolio analysis, wallet balance, etc.)
      // This is the Universal AI Operating Layer — no server needed for many intents
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

      const osResult = await intentOS.process({
        message,
        conversationId,
        currentPage,
        walletState,
        portfolioState: aiContext.portfolio,
        conversation: messages.map(m => ({ role: m.role, content: m.content })).slice(-10),
        locale,
        services: liveModuleServices
      });

      /*
       * ─── DOES THE LOCAL OS OWN THIS TURN? ───────────────────────────────
       * This used to be a hand-maintained list of 18 intent types, and every
       * type added to the parser had to be remembered here too. It never was
       * — so a correctly-classified intent that nobody had added to the list
       * fell through to the server, which does not know about the app's
       * screens, and came back with a generic reply. That is the second half
       * of the "it can't answer me" report.
       *
       * The rule is now derived, not enumerated:
       *   · anything the OS already ANSWERED or NAVIGATED is handled here
       *   · anything read-only is handled here — it needed no signature
       *   · anything the OS flagged as needing confirmation goes to the
       *     server path, which owns the confirm/sign flow
       *
       * Adding a parser intent can no longer silently bypass the local OS.
       */
      const osIntentType = osResult.intent?.type || null;
      const needsFinancialConfirmation = Boolean(
        osResult.requiresConfirmation
        || osResult.human?.requiresConfirmation
        || osResult.execution?.requiresConfirmation
        || osResult.execution?.planReady
      );
      const isLocalHandled = osResult.ok && !needsFinancialConfirmation && (
        osResult.intent?.readOnly === true ||
        osResult.execution?.handoff === true ||
        Boolean(osResult.navigated) ||
        // The OS produced a real sentence for this turn — a route was opened,
        // data was read, or a module was named. Sending it to the server too
        // would replace a specific answer with a generic one.
        Boolean(osResult.execution?.route) ||
        Boolean(osResult.execution?.unavailable) ||
        osIntentType === 'OPEN_CALM' ||
        osIntentType === 'PLAY_MUSIC' ||
        (osResult.plan?.readOnly === true)
      );

      if (isLocalHandled) {
        const nextMessage = {
          id: makeId(),
          role: 'ai',
          content: visibleText(osResult.human || osResult, osResult.message),
          kind: 'assistant',
          ui: osResult.human?.ui || osResult.ui || { type: 'TEXT' },
          card: osResult.human?.card || osResult.card || null,
          intentType: osResult.intent?.type || null,
          detectedIntent: osResult.intent?.primaryIntent || osResult.intent?.type || null,
          missingInfo: osResult.intent?.minimalQuestion ? (locale.startsWith('fa') ? osResult.intent.minimalQuestion.fa : osResult.intent.minimalQuestion.en) : null,
          suggestions: (osResult.intent?.nextPredictedActions?.length
            ? osResult.intent.nextPredictedActions.map((a) => ({ id: a.intent, label: locale.startsWith('fa') ? a.labelFa : a.labelEn, prompt: a.prompt }))
            : (osResult.suggestions || getSuggestionsForIntent(osResult.intent?.type, aiContext, osResult.intent?.entities, locale))),
          debug: osResult.debug || null
        };

        setMessages((prev) => [...prev, nextMessage]);
        setSuggestions((nextMessage.suggestions || []).slice(0, MAX_SUGGESTIONS));
        setPendingExecution(null);

        // Handle navigation if needed
        if (nextMessage.ui?.type !== 'CONNECT_WALLET' && osResult.navigated) {
          // Already navigated via OS
        }

        // Proactive check: if user has active goal and market changed, suggest opportunity
        if (aiContext.activeIntents?.length || aiContext.portfolio?.totalValueUsd) {
          // Proactive opportunity detection (Spec §18) — not auto-execute, just suggest
          // This would be expanded with real market data
        }

        return true;
      }

      // 2. For financial intents or complex plans — go to server (existing flow)
      // This preserves the financial execution path with confirmation gate
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
        setMessages((prev) => [...prev, {
          id: makeId(),
          role: 'ai',
          content: visibleText(res, human.message),
          kind: connect ? 'connect' : 'error',
          ui: { type: connect ? 'CONNECT_WALLET' : 'TEXT' }
        }]);
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
        debug: osResult.debug || null
      };

      setMessages((prev) => [...prev, nextMessage]);
      setSuggestions((nextMessage.suggestions || []).slice(0, MAX_SUGGESTIONS));

      if (res.context?.conversationSummary) setMemorySummary(res.context.conversationSummary);
      if (reply.pendingIntent) rememberPending(reply.pendingIntent);
      if (uiType === 'CONNECT_WALLET') rememberPending(reply.pendingIntent || message, reply.intent?.type);

      if (uiType === 'ACTION_CARD') {
        setPendingExecution({
          action: reply.actions?.[0] || { type: reply.intent?.type || osResult.intent?.type || 'SWAP' },
          actions: reply.actions || osResult.plan?.actions || [],
          message,
          card: reply.card || osResult.human?.card,
          rebalance: reply.rebalance,
          actionPlan: reply.actionPlan || osResult.plan || null,
          intentId: reply.intentId || null,
          intentType: reply.intent?.type || osResult.intent?.type || reply.actions?.[0]?.type,
          osPlan: osResult.plan || null
        });
      } else {
        setPendingExecution(null);
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
    } finally {
      setThinking([]);
      busyRef.current = false;
    }
    return true;
  }, [aiContext, conversationId, t, locale, rememberPending, intentOS, currentPage, messages, wallet, walletConnected, walletCanSign, liveModuleServices, solanaAddressLive]);

  sendRef.current = sendMessage;

  const sendSuggested = useCallback((s) => {
    if (!s?.prompt) return;
    setInput(s.prompt);
    void sendMessage(s.prompt);
  }, [sendMessage]);

  // Dynamic drawer items — based on current context, not static (Spec §17)
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

  /*
   * The connect button inside a chat bubble. It has to be a stable reference,
   * not an inline arrow at the call site — ConversationRow is memoized, and a
   * fresh closure every render would make every bubble re-render anyway,
   * defeating the whole point of memoizing it.
   *
   * `pendingExecutionRef` is read instead of `pendingExecution` so this
   * callback does not have to change identity when the pending intent does.
   */
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
    const { action, message, actions, rebalance, intentType } = pendingExecution;
    const type = String(intentType || action?.type || '').toUpperCase();
    if (!walletConnected) {
      openWalletSheet(message, type);
      return;
    }
    setExecuting(true);
    setProgress({ index: 1, total: Math.max(1, (actions || []).length), status: 'VALIDATING' });
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
        clearPendingIntent();
        try { await multi?.refresh?.(); } catch {}
        setSolanaTick((v) => v + 1);
        try {
          const list = await aiAutomations();
          if (list?.ok) setAutomations(list.automations || []);
        } catch {}
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
    } finally {
      setPendingExecution(null);
      setExecuting(false);
      setProgress(null);
    }
  }, [pendingExecution, executing, aiContext, wallet, walletConnected, walletCanSign, defaultChainId, locale, t, openWalletSheet, conversationId, multi]);

  const chooseOption = useCallback((msg, choice) => {
    if (!choice) return;
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

  /* Track whether the user is parked at the bottom; only then auto-follow. */
  const handleThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 96;
  }, []);

  useEffect(() => {
    const el = threadRef.current;
    if (!el || !stickToBottomRef.current) return;
    try {
      /* behavior:'auto' overrides the CSS smooth scroll: an instant jump is
         correct for "a new message arrived" and avoids a laggy tween when a
         burst of turns lands together. */
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    } catch { el.scrollTop = el.scrollHeight; }
  }, [messages, thinking, progress, pendingExecution]);

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

  // Task continuity: if user left and came back, offer resume
  useEffect(() => {
    try {
      const last = getLastActiveTask();
      if (last && last.status === 'PENDING' && Date.now() - last.createdAt < 30 * 60 * 1000) {
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

  // Debug dashboard toggle (hidden, only via triple click or ?debug)
  const handleDebugToggle = useCallback(() => {
    const logs = getDebugLogs({ limit: 20 });
    const stats = getObsStats();
    const mem = getAllMemory();
    setDebugInfo({ logs, stats, mem, currentPage, aiContext: { hasWallet: aiContext.wallet.connected, totalValue: aiContext.portfolio.totalValueUsd } });
    setShowDebug(v => !v);
    enableDebug();
  }, [currentPage, aiContext]);

  /* ---------------- Operations Center: real data + real actions ----------- */

  const pushTurn = useCallback((m) => {
    setMessages((prev) => [...prev, m]);
    return m;
  }, []);

  /* Persist every new turn once — one effect, no duplicates, covers all
     message producers (chat, operations, confirmation, errors). */
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
    } catch { /* history is a convenience, never a gate */ }
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
    } catch { /* status is best-effort */ }
  }, []);

  useEffect(() => {
    void refreshMonitors();
    void refreshStatus();
    const t = setInterval(() => {
      void refreshMonitors();
      void refreshStatus();
      // Re-evaluating against the live server keeps TRIGGERED monitors fresh.
      for (const m of monitors) {
        if (m.status === 'ACTIVE' && m.intervalMinutes <= 15) void apiEvaluateMonitor(m.id).catch(() => {});
      }
    }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMonitors, refreshStatus]);

  /* Open the ecosystem panel at a specific half (agents / strategies). */
  const openEcosystem = useCallback((kind = 'agent') => {
    setEcoKind(kind);
    setPanel('ecosystem');
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
      fetchAiProviders().then((res) => {
        if (res?.ok && Array.isArray(res.providers)) setAiProviders(res.providers);
      }).catch(() => {});
      fetchLearningStats().then((res) => {
        if (res?.ok) setLearningStats(res);
      }).catch(() => {});
    }
  }, [refreshMonitors, refreshStatus]);

  const appendOp = useCallback((op) => {
    try {
      const row = appendOperation({ conversationId, ...op });
      setHistData(readHistory());
      return row;
    } catch {
      return null;
    }
  }, [conversationId]);

  /* Card → real action map for read/quote cards (the AI chat pipeline is the
     real tooling: it resolves intent → quote → preview → confirm → execute). */

  /* Opportunity Engine run — real data only, honest metadata.
     Declared BEFORE handleOpsAction so the render cannot TDZ-crash
     (Cannot access 'runOpportunity' before initialization). */
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
    if (card.action === 'navigate') {
      navigate(card.route);
      appendOp({ kind: 'NAVIGATE', status: 'COMPLETED', title: card.title, detail: card.desc, ref: card.route, refKind: 'route' });
      return;
    }
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
    /*
     * No prompt means this card is not a chat action. Sending `card.title`
     * instead — which is what happened before — pushes a bare label like
     * "Position" into the parser, gets GENERAL back, and answers a button
     * press with "I could not map that to a module". Opening the card's own
     * venue is the honest fallback: the card always has a real route.
     */
    const prompt = opsCardPrompt(card, locale);
    if (!prompt) {
      if (card.route) {
        navigate(card.route);
        appendOp({ kind: 'NAVIGATE', status: 'COMPLETED', title: card.title, detail: card.desc, ref: card.route, refKind: 'route' });
      }
      return;
    }
    await sendMessage(prompt);
  }, [walletConnected, serverReachable, openWalletSheet, navigate, appendOp, sendMessage, runOpportunity, locale]);

  /* Monitor create — real server registry. */
  const handleMonitorCreate = useCallback(async (draft) => {
    setOpsBusy(true);
    let alert = {};
    try {
      const { pushIdentity } = await import('../lib/notify.js');
      const id = await pushIdentity();
      if (id?.endpoint) alert = { endpoint: id.endpoint, lang: locale };
    } catch { /* no push identity → monitor still records events in-app */ }
    const made = await apiCreateMonitor({ ...draft, alert, conversationId, source: 'intent-os' });
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

  /* Conditional order — real order in fbt-orders-v1 + /orders + server watch. */
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

  /* Monitor actions from cards / history — real API calls. */
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

  /* Monitor one opportunity row — real server monitor (price or yield APY). */
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

  /* Natural-language monitoring / conditional-order / context continuation.
     Runs before the generic chat so operations are CREATED, not described. */
  const handleContextTurn = useCallback(async (message) => {
    const text = String(message || '').trim();
    const lower = text.toLowerCase();

    /* (a) Confirmation of a prepared draft — real creation, no re-navigation. */
    if (pendingDraft && /انجامش بده|تأیید|تایید|بله|باشه|do it|confirm|execute|yes/i.test(text)) {
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

    /* (b) Active monitor/order control — the SAME operation (§11). */
    if (activeContext?.type === 'monitor') {
      const m = monitors.find((x) => x.id === activeContext.id) || monitors.find((x) => x.label === activeContext.label);
      if (m) {
        if (/متوقف|توقف|بایست|stop|pause/i.test(lower)) { await handleMonitorAction(m, 'pause'); return { handled: true }; }
        if (/فعال کن|ادامه بده|resume|start/i.test(lower)) { await handleMonitorAction(m, 'resume'); return { handled: true }; }
        if (/لغو|cancel|حذف|delete/i.test(lower)) { await handleMonitorAction(m, 'cancel'); return { handled: true }; }
        if (/بررسی کن|چک کن|check|status/i.test(lower)) { await handleMonitorAction(m, 'evaluate'); return { handled: true }; }
      }
    }

    /* (c) «بازار را بپای» / «اگر ETH کمتر از 3000 شد خبر بده» — monitor intent. */
    const monitorIntent = /پایش|بپای|نظارت|watch|monitor|خبر بده|اطلاع بده|alert/i.test(text)
      && !/توقف|متوقف|لغو/i.test(text);

    /* (c-1) «اگر شرایط سود 20 درصدی ایجاد شد بررسی کن» — real OPPORTUNITY job:
       the server scans real yield venues and triggers at the target APY %. */
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
        /* Asset/condition missing → ask with the real form instead of guessing. */
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

    /* (d) «اگر BTC به 100000 رسید بخر» — real conditional order. */
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

    /* (e) «فرصت برای هدف» — real opportunity engine run. */
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

  /* Continue a history/monitor item in chat — context resolution (§11/§12). */
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
    <div className="iaos-page">
      <div className="iaos-shell">
        {/* ─── MINIMAL HEADER ───────────────────────────────────────────────
            The old header carried five panel buttons (intelligence, history,
            operations, agents·strategies, status) plus the title. On a phone
            that wrapped into a second line and read as clutter. Those panels
            moved to the bottom menu bar; the header keeps only what the user
            asked for: "AI", a status pill and the live indicator. The debug
            dashboard stays reachable by tapping the title, as before. */}
        <header className="iaos-header">
          <div className="iaos-title" onClick={handleDebugToggle} style={{ cursor: 'pointer' }}>
            <span className="iaos-mark" aria-hidden="true">✦</span>
            <span className="iaos-title-copy">
              <h1>AI</h1>
              <span className="iaos-title-sub">Intent OS</span>
            </span>
          </div>
          <div className="iaos-header-status">
            {serverReachable != null ? (
              <span className="iaos-status-pill" data-on={serverReachable ? 'true' : 'false'}>
                <i aria-hidden="true" />
                {serverReachable
                  ? (locale.startsWith('fa') ? 'آنلاین' : 'Online')
                  : (locale.startsWith('fa') ? 'آفلاین' : 'Offline')}
              </span>
            ) : null}
            <span className="iaos-live" data-on="true" title={t('intentAIOS.live', { defaultValue: 'Live' })}>
              <i aria-hidden="true" /> {t('intentAIOS.live', { defaultValue: 'Live' })}
            </span>
          </div>
        </header>

        {activeContext ? (
          <div className="iaos-context-chip" data-testid="intent-ai-context">
            <span>{locale.startsWith('fa') ? 'در حال ادامه:' : 'Continuing:'}</span>
            <strong>{activeContext.label}</strong>
            <button type="button" aria-label="Clear context" onClick={() => setActiveContext(null)}>✕</button>
          </div>
        ) : null}

        {showDebug && debugInfo ? (
          <div className="iaos-debug" style={{ background: '#111', color: '#0f0', padding: '12px', borderRadius: '8px', marginBottom: '12px', fontSize: '11px', fontFamily: 'monospace', maxHeight: '300px', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <strong>AI Dashboard Internal (Debug)</strong>
              <button onClick={() => setShowDebug(false)} style={{ background: '#333', color: '#fff', border: 'none', padding: '2px 8px', borderRadius: '4px' }}>✕</button>
            </div>
            <div>Current Page: {debugInfo.currentPage}</div>
            <div>Wallet: {debugInfo.aiContext.hasWallet ? 'Connected' : 'Not connected'} | Portfolio: ${debugInfo.aiContext.totalValue || 0}</div>
            <div>Stats: {JSON.stringify(debugInfo.stats)}</div>
            <div style={{ marginTop: '8px' }}>Recent Logs:</div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '10px' }}>{JSON.stringify(debugInfo.logs.slice(0, 3), null, 2)}</pre>
            <div style={{ marginTop: '8px' }}>Memory: Working {debugInfo.mem.working?.length || 0} | Session {debugInfo.mem.session?.length || 0} | Long {debugInfo.mem.longTerm?.length || 0}</div>
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

        <div className="iaos-conversation" ref={threadRef} onScroll={handleThreadScroll} aria-live="polite">
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
            />
          ))}
          {thinking.length ? (
            <div className="iaos-msg iaos-ai">
              <div className="iaos-bubble iaos-thinking">
                {thinking.map((s) => <span key={s} className="iaos-think-row">{s}</span>)}
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
              <div className="iaos-exec-actions">
                <button type="button" className="iaos-btn iss-solid" onClick={confirmExecution} disabled={executing} data-testid="intent-ai-confirm">
                  {executing
                    ? t('intentAIOS.working', { defaultValue: 'در حال اجرا…' })
                    : (card?.confirmLabel || t('intentAIOS.confirm', { defaultValue: 'تأیید و اجرا' }))}
                </button>
                <button type="button" className="iaos-btn iss-ghost" onClick={editExecution}>
                  {card?.editLabel || t('intentAIOS.edit', { defaultValue: 'ویرایش' })}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {suggestions.length ? (
          <div className="iaos-suggestions">
            <div className="iaos-suggestions-title">✦ {t('intentAIOS.suggestions', { defaultValue: 'پیشنهادهای مرتبط' })}</div>
            <div className="iaos-suggestions-row">
              {suggestions.map((s) => (
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

        <form className="iaos-composer" onSubmit={handleSubmit}>
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
          <button type="submit" className="iaos-send" aria-label={t('intentAIOS.send', { defaultValue: 'Send' })} disabled={!input.trim() || thinking.length > 0}>➤</button>
        </form>

        {/* ─── BOTTOM MENU ─────────────────────────────────────────────────
            The operations surfaces the header used to hold, moved down here
            as plain text entries: عملیات / تاریخچه / هوش چندمدلی / ایجنت‌ها /
            استراتژی‌ها. Text, not icon buttons, so the top of the screen
            stays clean and the menu sits with the composer where the thumb
            already is. */}
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
          <button type="button" className="iaos-menubar-btn" data-testid="intent-ai-agents" onClick={() => openEcosystem('agent')}>
            {opsText('eco.agents', locale)}
          </button>
          <button type="button" className="iaos-menubar-btn" data-testid="intent-ai-strategies" onClick={() => openEcosystem('strategy')}>
            {opsText('eco.strategies', locale)}
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
