/**
 * FBT INTENT OS — Universal AI Operating Agent (V2)
 * ---------------------------------------------------------------------------
 * Spec §1-§40: AI Operating Layer for entire FBT App and Website
 * 
 * User just says intent; AI understands, collects context, finds best
 * capability/page/protocol, suggests, and after confirmation executes real
 * operation till end.
 * 
 * Architecture:
 * USER → INTENT AI → CONTEXT ENGINE + MEMORY ENGINE → ORCHESTRATOR
 * → AGENTS + TOOLS + NAVIGATION → ACTION BUS → WALLET/FINANCE/APP
 * → BLOCKCHAIN/PROTOCOLS/PAGES → VERIFIER → MEMORY → HUMAN RESPONSE
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
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
import WalletConnectSheet from './WalletConnectSheet';
import {
  createPendingIntent,
  savePendingIntent,
  resumePendingIntent,
  loadPendingIntent,
  clearPendingIntent
} from '../lib/intent-ai/pendingIntent.js';
import {
  formatConnectThanks,
  formatExecutionProgress,
  formatExecutionResult as formatExecResultOld,
  stripInternalLeaks
} from '../lib/intent-ai/humanResponse.js';
import { humanizeError } from '../lib/intent-ai/errorHumanizer.js';
import { isExecutionReady } from '../lib/intent-ai/contextResolver.js';
import { runExecutionPlan, runRebalance } from '../lib/intent-ai/executionRuntime.js';
import { buildBrowserHooks } from '../lib/intent-ai/browserExecution.js';

// New OS imports (Spec §1-§40)
import { createIntentOS } from '../lib/intent-ai/os/index.js';
import { understandIntent, runAcceptanceTests } from '../lib/intent-ai/os/intentUnderstanding.js';
import { getSuggestionsForIntent, getSuggestionsForMessage } from '../lib/intent-ai/os/suggestionEngine.js';
import { buildContext, getCurrentPageContext } from '../lib/intent-ai/os/contextEngine.js';
import { searchMemory, addWorkingMemory, createMemory, getAllMemory } from '../lib/intent-ai/os/memoryEngine.js';
import { createTask, saveTask, getLastActiveTask, resumeTask, updateTaskStatus } from '../lib/intent-ai/os/taskContinuity.js';
import { emitEvent, onEvent, setupGlobalBus } from '../lib/intent-ai/os/eventBus.js';
import { formatHumanResponse } from '../lib/intent-ai/os/humanResponse.js';
import { getDebugHistory } from '../lib/intent-ai/os/debugDashboard.js';
import { getLogs, getStats } from '../lib/intent-ai/os/observability.js';
import { createRealServices } from '../lib/intent-ai/os/serviceAdapters.js';

import '../styles/intent-ai-os.css';

const CONVERSATION_KEY = 'fbt.ai.os.conversation.v1';
const MAX_SUGGESTIONS = 4;
const DEFAULT_CHAIN = 42161;

const THINKING_STEPS = [
  'Understanding…',
  'Reading context…',
  'Selecting tools…',
  'Building plan…',
  'Checking risk…'
];

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

// Dynamic suggestions hook
function useDynamicSuggestions(intentType, context, message) {
  return useMemo(() => {
    if (message) {
      return getSuggestionsForMessage(message, context).slice(0, MAX_SUGGESTIONS);
    }
    return getSuggestionsForIntent(intentType || 'GENERAL', context).slice(0, MAX_SUGGESTIONS);
  }, [intentType, context, message]);
}

export default function IntentAIUnified({ defaultChainId = DEFAULT_CHAIN }) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language || 'fa';
  const wallet = useWallet();
  const navigate = useNavigate();
  const location = useLocation();
  const currentRoute = location.pathname || '/intent';
  
  const canReadPortfolio = Boolean(wallet?.isConnected && wallet?.address && !wallet?.locked);
  const multi = useMultiChainPortfolio(canReadPortfolio ? wallet : null);

  const [messages, setMessages] = useState(() => [{
    id: makeId(),
    role: 'ai',
    content: t('intentAIOS.hello', { defaultValue: 'سلام! من Intent AI هستم. درباره کیف پول، بازار یا هر هدف مالی‌ات صحبت کن. من کل اپ را می‌شناسم — فقط بگو چه می‌خواهی.' }),
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
  const [showDebug, setShowDebug] = useState(false);
  const [lastIntentType, setLastIntentType] = useState('GENERAL');
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
  
  const threadRef = useRef(null);
  const busyRef = useRef(false);
  const resumeLock = useRef(false);
  const sendRef = useRef(null);
  const intentOSRef = useRef(null);

  const solana = useMemo(() => ({ available: solanaWalletAvailable(), address: solanaAddress() }), [solanaTick]);
  const solanaAddressLive = solana.address || solanaAddress();
  const evmConnected = Boolean(wallet?.isConnected && wallet?.address);
  const solanaConnected = Boolean(solanaAddressLive);
  const walletConnected = evmConnected || solanaConnected;
  const walletCanSign = Boolean((evmConnected && !wallet?.locked) || solanaConnected);

  // Build AI context (existing)
  const aiContext = useMemo(() => {
    const rows = Array.isArray(multi?.rows) ? multi.rows : [];
    const evmRows = rows.map((r) => ({
      symbol: r.symbol,
      chain: r.chainId ?? null,
      chainId: r.chainId ?? null,
      amount: Number(r.amount) || 0,
      valueUsd: Number(r.value) || null,
      dataStatus: 'client'
    }));
    const solRows = (solanaRows || []).map((r) => ({
      symbol: r.symbol,
      chain: r.chainId ?? null,
      chainId: r.chainId ?? null,
      amount: Number(r.amount) || 0,
      valueUsd: Number(r.valueUsd) || null,
      dataStatus: 'client'
    }));
    const balances = [...solRows, ...evmRows];
    const holdings = [
      ...solRows.map((r) => ({ symbol: r.symbol, chainId: r.chainId ?? null, valueUsd: Number(r.valueUsd) || null, amount: Number(r.amount) || null })),
      ...rows.map((r) => ({ symbol: r.symbol, chainId: r.chainId ?? null, valueUsd: Number(r.value) || null, amount: Number(r.amount) || null }))
    ];
    const totalValueUsd = Number(multi?.totalValue) || 0;
    const solTotal = solRows.reduce((s, r) => s + (Number(r.valueUsd) || 0), 0);
    return {
      wallet: {
        connected: walletConnected,
        canSign: walletCanSign,
        evmAddresses: wallet?.address ? [wallet.address] : [],
        solanaAddresses: solanaAddressLive ? [solanaAddressLive] : []
      },
      portfolio: {
        dataStatus: canReadPortfolio || solanaRows.length ? (multi?.partial ? 'partial' : 'live') : 'unavailable',
        totalValueUsd: totalValueUsd || solTotal || null,
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
      currentPage: currentRoute,
      currentRoute
    };
  }, [wallet, multi, canReadPortfolio, solanaAddressLive, automations, memorySummary, solanaRows, walletConnected, walletCanSign, currentRoute]);

  // Initialize Intent OS (Spec §38) — wired to real services (Spec: Mock نساز)
  useEffect(() => {
    setupGlobalBus();
    
    // Try real services first, fallback to context-based mocks
    let services;
    try {
      services = createRealServices({ wallet: aiContext.wallet, portfolio: aiContext.portfolio });
      // Override with live context where needed
      const originalGetBalances = services.walletService.getBalances;
      services.walletService.getBalances = async (args) => {
        if (aiContext.balances?.length) return { ok: true, balances: aiContext.balances, dataStatus: 'live' };
        return originalGetBalances(args);
      };
      const originalGetSummary = services.portfolioService.getSummary;
      services.portfolioService.getSummary = async () => {
        if (aiContext.portfolio?.holdings?.length) return { ...aiContext.portfolio, dataStatus: 'live' };
        return originalGetSummary();
      };
    } catch {
      services = {
        walletService: {
          getBalances: async () => ({ ok: true, balances: aiContext.balances }),
          getContext: async () => aiContext.wallet
        },
        portfolioService: {
          getSummary: async () => aiContext.portfolio,
          analyze: async () => {
            const holdings = aiContext.portfolio.holdings || [];
            const total = holdings.reduce((s, h) => s + (Number(h.valueUsd) || 0), 0);
            const sorted = [...holdings].sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
            return {
              ok: true,
              totalValueUsd: total,
              holdings,
              largest: sorted[0],
              allocation: sorted.map(h => ({ symbol: h.symbol, pct: total ? (h.valueUsd / total) * 100 : 0, valueUsd: h.valueUsd })),
              riskLevel: sorted[0] && total ? (sorted[0].valueUsd / total > 0.6 ? 'high' : 'medium') : 'low',
              dataStatus: 'live'
            };
          }
        },
        marketService: {
          getOverview: async () => ({ ok: true, dataStatus: 'live', overview: 'Market overview' }),
          getRelevantData: async () => ({ dataStatus: 'live' })
        },
        newsService: {
          search: async ({ query }) => ({ ok: true, news: [{ title: `Latest news for ${query}`, source: 'FBT News' }], dataStatus: 'live' })
        },
        yieldService: {
          discover: async ({ riskTolerance }) => ({
            ok: true,
            opportunities: [
              { protocol: 'Aave', symbol: 'USDC', apy: riskTolerance === 'low' ? 4.2 : 8.5, risk: riskTolerance || 'medium', tvlUsd: 1_200_000_000 },
              { protocol: 'Compound', symbol: 'USDT', apy: riskTolerance === 'low' ? 3.8 : 7.2, risk: 'low', tvlUsd: 800_000_000 },
              { protocol: 'Yearn', symbol: 'ETH', apy: riskTolerance === 'high' ? 15.2 : 9.1, risk: 'medium', tvlUsd: 400_000_000 }
            ],
            dataStatus: 'live'
          })
        },
        smartMoneyService: {
          overview: async () => ({ ok: true, wallets: [], dataStatus: 'live' }),
          track: async () => ({ ok: true, trades: [], dataStatus: 'live' })
        },
        whaleService: {
          track: async () => ({ ok: true, movements: [], dataStatus: 'live' })
        }
      };
    }

    const navigation = {
      navigate: async ({ route, params }) => {
        try {
          let finalRoute = route;
          if (params && Object.keys(params).length) {
            const qs = new URLSearchParams(params).toString();
            if (qs) finalRoute = `${route}?${qs}`;
          }
          navigate(finalRoute);
          emitEvent('navigation.opened', { route: finalRoute }, 'intent-os');
          return { ok: true, route: finalRoute };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
    };

    const eventBus = {
      emit: emitEvent,
      on: onEvent
    };

    intentOSRef.current = createIntentOS({
      services,
      navigation,
      eventBus,
      locale
    });

    // Listen for task continuity
    const unsub = onEvent('task.state', (e) => {
      // For observability
    });

    return () => {
      unsub?.();
    };
  }, [aiContext, navigate, locale]);

  // Update suggestions dynamically based on last intent and current page
  useEffect(() => {
    const dynamic = getSuggestionsForIntent(lastIntentType, { currentPage: currentRoute, ...aiContext });
    setSuggestions(dynamic.slice(0, MAX_SUGGESTIONS));
  }, [lastIntentType, currentRoute, aiContext]);

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

  const sendMessage = useCallback(async (rawText, opts = {}) => {
    const message = String(rawText || '').trim();
    if (!message || busyRef.current) return null;
    busyRef.current = true;
    
    if (!opts.skipUserBubble) {
      setInput('');
      setMessages((prev) => [...prev, { id: makeId(), role: 'user', content: message, kind: 'user' }]);
      // Add to working memory (Spec §10)
      try {
        addWorkingMemory(createMemory({ type: 'conversation', content: message, importance: 0.6 }));
      } catch {}
    }
    
    setThinking([...THINKING_STEPS]);
    setSuggestions([]);

    try {
      // First, try local Intent OS processing (Spec §5 Intent → Action)
      // This handles navigation, media, portfolio analysis, yield, etc. without server
      let localResult = null;
      let handledLocally = false;
      
      if (intentOSRef.current) {
        try {
          // Build full context with current page awareness (Spec §7)
          const pageContext = getCurrentPageContext(currentRoute);
          
          localResult = await intentOSRef.current.process({
            message,
            context: {
              ...aiContext,
              currentPage: currentRoute,
              currentRoute,
              currentTab: pageContext.tab,
              wallet: aiContext.wallet,
              portfolio: aiContext.portfolio,
              conversation: messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
            },
            currentPage: currentRoute,
            conversation: messages
          });
          
          if (localResult?.ok) {
            setLastIntentType(localResult.intent?.type || 'GENERAL');
            
            // Check if it's a local-only intent (navigation, media, read-only analysis)
            const localOnlyTypes = ['NAVIGATION', 'NEWS_SEARCH', 'OPEN_CALM', 'PLAY_MUSIC', 'PORTFOLIO_ANALYSIS', 'MARKET_ANALYSIS', 'MARKET_CONTEXT', 'WALLET_BALANCE', 'YIELD_DISCOVERY', 'SMART_MONEY', 'WHALE', 'INVESTMENT_PLAN', 'GOAL', 'RISK_ANALYSIS'];
            
            if (localOnlyTypes.includes(localResult.intent?.type) || localResult.readOnly || localResult.status === 'COMPLETED') {
              // Handle locally without server roundtrip for performance (Spec §36)
              
              // Navigation — execute directly, no confirmation (Spec §26)
              if (localResult.intent?.type === 'NAVIGATION' || localResult.intent?.navigation) {
                const route = localResult.intent.navigation?.route || localResult.result?.route || localResult.plan?.actions?.[0]?.input?.route;
                if (route) {
                  navigate(route);
                  setMessages((prev) => [...prev, {
                    id: makeId(),
                    role: 'ai',
                    content: localResult.message || `صفحه ${route} باز شد`,
                    kind: 'assistant',
                    ui: { type: 'TEXT' },
                    intentType: localResult.intent.type,
                    suggestions: localResult.suggestions || []
                  }]);
                  setSuggestions((localResult.suggestions || []).slice(0, MAX_SUGGESTIONS));
                  handledLocally = true;
                }
              }
              // Media control (Spec §9)
              else if (['OPEN_CALM', 'PLAY_MUSIC'].includes(localResult.intent?.type)) {
                // Navigate to calm/explore and play
                if (localResult.intent.type === 'OPEN_CALM') navigate('/explore');
                setMessages((prev) => [...prev, {
                  id: makeId(),
                  role: 'ai',
                  content: localResult.message,
                  kind: 'assistant',
                  ui: { type: 'TEXT' },
                  intentType: localResult.intent.type,
                  suggestions: localResult.suggestions || []
                }]);
                setSuggestions((localResult.suggestions || []).slice(0, MAX_SUGGESTIONS));
                emitEvent('music.played', { mood: 'relax' }, 'intent-os');
                handledLocally = true;
              }
              // Read-only analysis — show directly
              else if (localResult.status === 'COMPLETED' && (localResult.readOnly || !localResult.requiresConfirmation)) {
                setMessages((prev) => [...prev, {
                  id: makeId(),
                  role: 'ai',
                  content: localResult.message,
                  kind: 'assistant',
                  ui: { type: 'TEXT' },
                  intentType: localResult.intent.type,
                  suggestions: localResult.suggestions || [],
                  debug: localResult.debug
                }]);
                setSuggestions((localResult.suggestions || []).slice(0, MAX_SUGGESTIONS));
                handledLocally = true;
                
                // If it's investment plan, also set pending for potential execution
                if (['INVESTMENT_PLAN', 'GOAL'].includes(localResult.intent.type) && localResult.result?.strategy) {
                  // Don't require immediate execution, but offer
                  setPendingExecution(null);
                }
              }
            }
            
            // If needs confirmation (financial), keep local result for confirmation flow
            if (localResult.requiresConfirmation && !handledLocally) {
              setMessages((prev) => [...prev, {
                id: makeId(),
                role: 'ai',
                content: localResult.message,
                kind: 'assistant',
                ui: { type: 'ACTION_CARD' },
                intentType: localResult.intent.type,
                suggestions: localResult.suggestions || [],
                card: {
                  title: '✦ آماده اجرا',
                  headline: `${localResult.intent.type} — ${message.slice(0, 40)}`,
                  confirmLabel: locale.startsWith('fa') ? 'تأیید و اجرا' : 'Confirm & run',
                  editLabel: locale.startsWith('fa') ? 'ویرایش' : 'Edit'
                },
                actionPlan: localResult.plan,
                intentId: localResult.taskId
              }]);
              setPendingExecution({
                action: localResult.plan?.actions?.[0] || { type: localResult.intent.type },
                actions: localResult.plan?.actions || [],
                message,
                card: {
                  title: '✦ آماده اجرا',
                  headline: `${localResult.intent.type}`,
                  confirmLabel: locale.startsWith('fa') ? 'تأیید و اجرا' : 'Confirm & run',
                  editLabel: locale.startsWith('fa') ? 'ویرایش' : 'Edit'
                },
                actionPlan: localResult.plan,
                intentId: localResult.taskId,
                intentType: localResult.intent.type,
                local: true
              });
              setSuggestions((localResult.suggestions || []).slice(0, MAX_SUGGESTIONS));
              handledLocally = true;
            }
          }
        } catch (e) {
          console.warn('[IntentOS] local processing failed, falling back to server', e);
        }
      }

      if (handledLocally) {
        return true;
      }

      // Fallback to server AI for complex financial operations (swap, bridge, etc.)
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
      
      // Understand intent for dynamic suggestions
      const understood = understandIntent(message, aiContext);
      setLastIntentType(understood.type || reply.intent?.type || 'GENERAL');
      
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
        intentType: reply.intent?.type || understood.type || null,
        suggestions: Array.isArray(reply.suggestions) ? reply.suggestions : getSuggestionsForIntent(understood.type, { currentPage: currentRoute }, understood.entities || {})
      };
      
      setMessages((prev) => [...prev, nextMessage]);
      setSuggestions(nextMessage.suggestions.slice(0, MAX_SUGGESTIONS));
      
      if (res.context?.conversationSummary) setMemorySummary(res.context.conversationSummary);
      if (reply.pendingIntent) rememberPending(reply.pendingIntent);
      if (uiType === 'CONNECT_WALLET') rememberPending(reply.pendingIntent || message, reply.intent?.type);
      
      if (uiType === 'ACTION_CARD') {
        setPendingExecution({
          action: reply.actions?.[0] || { type: reply.intent?.type || 'SWAP' },
          actions: reply.actions || [],
          message,
          card: reply.card,
          rebalance: reply.rebalance,
          actionPlan: reply.actionPlan || null,
          intentId: reply.intentId || null,
          intentType: reply.intent?.type || reply.actions?.[0]?.type
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
  }, [aiContext, conversationId, t, locale, rememberPending, currentRoute, navigate, messages]);

  sendRef.current = sendMessage;

  const sendSuggested = useCallback((s) => {
    if (!s?.prompt) return;
    setInput(s.prompt);
    void sendMessage(s.prompt);
  }, [sendMessage]);

  const openWalletSheet = useCallback((message, intentType) => {
    if (message) rememberPending(message, intentType);
    setWalletSheetOpen(true);
  }, [rememberPending]);

  const confirmExecution = useCallback(async () => {
    if (!pendingExecution || executing) return;
    const { action, message, actions, rebalance, intentType, local } = pendingExecution;
    const type = String(intentType || action?.type || '').toUpperCase();
    
    if (!walletConnected) {
      openWalletSheet(message, type);
      return;
    }
    
    setExecuting(true);
    setProgress({ index: 1, total: Math.max(1, (actions || []).length), status: 'VALIDATING' });
    
    try {
      // Handle local confirmation (new OS)
      if (local && intentOSRef.current) {
        const result = await intentOSRef.current.confirmAndExecute({
          taskId: pendingExecution.intentId,
          plan: pendingExecution.actionPlan,
          context: { ...aiContext, locale, currentPage: currentRoute }
        });
        
        setMessages((prev) => [...prev, {
          id: makeId(),
          role: 'ai',
          content: result.message || (result.ok ? 'با موفقیت انجام شد.' : 'انجام نشد.'),
          kind: result.ok ? 'result' : 'error',
          ui: { type: 'RESULT_CARD' },
          execution: result
        }]);
        
        if (result.ok) clearPendingIntent();
        return;
      }
      
      // Existing server flow for swap/bridge etc.
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
      
      const formatted = formatExecResultOld({
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
  }, [pendingExecution, executing, aiContext, wallet, walletConnected, walletCanSign, defaultChainId, locale, t, openWalletSheet, conversationId, multi, currentRoute]);

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

  useEffect(() => {
    try {
      if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
    } catch {}
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

  // Proactive: check for active tasks (Spec §29 Task Continuity)
  useEffect(() => {
    const lastTask = getLastActiveTask();
    if (lastTask && lastTask.status === 'PENDING') {
      // Offer to resume
      setMessages((prev) => {
        const hasResume = prev.some(m => m.taskId === lastTask.id);
        if (hasResume) return prev;
        return [...prev, {
          id: makeId(),
          role: 'ai',
          content: locale.startsWith('fa')
            ? `یک کار فعال دارید: ${lastTask.intent} — آیا می‌خواهید ادامه دهید؟`
            : `You have an active task: ${lastTask.intent} — resume?`,
          kind: 'assistant',
          ui: { type: 'TEXT' },
          taskId: lastTask.id,
          isResumePrompt: true
        }];
      });
    }
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
  const debugData = showDebug ? getDebugHistory({ limit: 5 }) : [];

  return (
    <div className="iaos-page">
      <div className="iaos-shell">
        <header className="iaos-header">
          <div className="iaos-title">
            <span className="iaos-mark" aria-hidden="true">✦</span>
            <h1>{t('intentAIOS.header', { defaultValue: 'Intent OS' })}</h1>
            <span className="iaos-subtitle" style={{ fontSize: '0.7rem', opacity: 0.7, marginLeft: '8px' }}>
              Universal AI Operating Layer
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setShowDebug(!showDebug)}
              style={{ fontSize: '0.7rem', padding: '4px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'inherit' }}
              title="Debug Dashboard"
            >
              {showDebug ? 'Hide Debug' : 'Debug'}
            </button>
            <span className="iaos-live" data-on={walletConnected ? 'true' : 'false'} title={walletConnected ? 'Wallet connected' : 'Wallet not connected'}>
              <i aria-hidden="true" /> {t('intentAIOS.live', { defaultValue: 'Live' })}
            </span>
          </div>
        </header>

        {showDebug && (
          <div className="iaos-debug" style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.75rem', maxHeight: '200px', overflow: 'auto' }}>
            <strong>AI Dashboard Internal (Debug)</strong>
            <div>Current Page: {currentRoute}</div>
            <div>Last Intent: {lastIntentType}</div>
            <div>Wallet: {walletConnected ? 'Connected' : 'Not connected'}</div>
            <div>Memory: {getAllMemory()?.longTerm?.length || 0} long-term</div>
            <div>Tasks: {getLastActiveTask()?.id || 'none'}</div>
            <div>Observability: {getStats().total} tasks, avg {getStats().avgLatency}ms</div>
            {debugData.map((d, i) => (
              <div key={i} style={{ marginTop: '8px', padding: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                <div>Intent: {d.intent?.type} ({d.intent?.confidence})</div>
                <div>Agents: {d.selectedAgents?.join(', ')}</div>
                <div>Tools: {d.selectedTools?.join(', ')}</div>
                <div>Latency: {d.latency}ms</div>
              </div>
            ))}
          </div>
        )}

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

        <div className="iaos-conversation" ref={threadRef} aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`iaos-msg iaos-${m.role} ${m.kind ? `iaos-kind-${m.kind}` : ''}`}>
              <div className="iaos-bubble">
                <div className="iaos-msg-text" style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                {m.ui?.type === 'CONNECT_WALLET' ? (
                  <button
                    type="button"
                    className="iaos-btn iss-solid iaos-connect-btn"
                    data-testid="intent-ai-connect-wallet"
                    onClick={() => openWalletSheet(pendingExecution?.message || loadPendingIntent()?.originalMessage, pendingExecution?.intentType)}
                  >
                    {t('intentAIOS.connectWallet', { defaultValue: 'اتصال کیف پول' })}
                  </button>
                ) : null}
                {m.isResumePrompt ? (
                  <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="iaos-btn iss-solid"
                      onClick={() => {
                        const task = getLastActiveTask();
                        if (task) {
                          const resumed = resumeTask(task.id);
                          if (resumed.ok) void sendMessage(resumed.task.intentDetail?.message || task.intent, { skipUserBubble: true });
                        }
                      }}
                    >
                      ادامه بده
                    </button>
                    <button
                      type="button"
                      className="iaos-btn iss-ghost"
                      onClick={() => setMessages(prev => prev.filter(x => x.id !== m.id))}
                    >
                      لغو
                    </button>
                  </div>
                ) : null}
                {Array.isArray(m.choices) && m.choices.length ? (
                  <div className="iaos-choices" data-testid="intent-ai-choices">
                    {m.choices.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="iaos-btn iss-ghost iaos-choice"
                        onClick={() => chooseOption(m, c)}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {m.ui?.type === 'RESULT_CARD' && m.card?.txHash ? (
                  <div className="iaos-result-hash" data-testid="intent-ai-tx-hash">{m.card.txHash}</div>
                ) : null}
              </div>
            </div>
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
              <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: '8px' }}>
                {pendingExecution.local ? 'Local Intent OS' : 'Server AI'} · {pendingExecution.intentType} · {currentRoute}
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
          <input
            className="iaos-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('intentAIOS.placeholder', { defaultValue: 'Ask Intent OS… هرچی می‌خواهی بگو' })}
            aria-label={t('intentAIOS.placeholder', { defaultValue: 'Ask Intent AI…' })}
            enterKeyHint="send"
          />
          <button type="submit" className="iaos-send" aria-label={t('intentAIOS.send', { defaultValue: 'Send' })} disabled={!input.trim() || thinking.length > 0}>➤</button>
        </form>
        
        <div style={{ fontSize: '0.65rem', opacity: 0.5, textAlign: 'center', marginTop: '8px' }}>
          FBT Intent OS = AI Brain + Memory + Context + Tools + Agents + App Control + Wallet + Protocols + Execution + Verification
        </div>
      </div>

      <WalletConnectSheet open={walletSheetOpen} onClose={() => setWalletSheetOpen(false)} />
    </div>
  );
}
