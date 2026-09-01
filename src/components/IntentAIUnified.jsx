/**
 * FBT INTENT AI — the unified AI OS chat surface.
 * ---------------------------------------------------------------------------
 * Conversation only. The engine's plan/verdict/intent labels stay in the log.
 * Confirm walks the wallet-side execution runtime (quote → sign → receipt).
 * No receipt → no success. Connecting a wallet resumes the pending intent
 * instead of sending the user to /wallet to retype.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  formatExecutionResult,
  stripInternalLeaks
} from '../lib/intent-ai/humanResponse.js';
import { humanizeError } from '../lib/intent-ai/errorHumanizer.js';
import { isExecutionReady } from '../lib/intent-ai/contextResolver.js';
import { runExecutionPlan, runRebalance } from '../lib/intent-ai/executionRuntime.js';
import { buildBrowserHooks } from '../lib/intent-ai/browserExecution.js';
import '../styles/intent-ai-os.css';

const CONVERSATION_KEY = 'fbt.ai.os.conversation.v1';
const MAX_SUGGESTIONS = 4;
const DEFAULT_CHAIN = 42161;

const ACTION_ITEMS = Object.freeze([
  { id: 'swap', label: 'Swap', prompt: 'می‌خواهم یک Swap انجام دهم.' },
  { id: 'bridge', label: 'Bridge', prompt: 'می‌خواهم این دارایی را Bridge کنم.' },
  { id: 'send', label: 'Send', prompt: 'می‌خواهم دارایی ارسال کنم.' },
  { id: 'buy', label: 'Buy', prompt: 'می‌خواهم BTC بخرم.' },
  { id: 'sell', label: 'Sell', prompt: 'می‌خواهم این دارایی را بفروشم.' },
  { id: 'futures', label: 'Futures', prompt: 'Futures این دارایی را تحلیل کن.' },
  { id: 'farm', label: 'Farm', prompt: 'بهترین Farm را پیدا کن.' },
  { id: 'lending', label: 'Lending', prompt: 'وام گرفتن را بررسی کن.' },
  { id: 'goal', label: 'Financial Goal', prompt: 'می‌خواهم سرمایه‌ام طی ۳ سال دو برابر شود.' },
  { id: 'dca', label: 'DCA', prompt: 'هر هفته ۱۰۰ دلار BTC بخر.' },
  { id: 'portfolio', label: 'Portfolio', prompt: 'پرتفوی من را تحلیل کن.' }
]);

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

export default function IntentAIUnified({ defaultChainId = DEFAULT_CHAIN }) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language || 'fa';
  const wallet = useWallet();
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
  const threadRef = useRef(null);
  const busyRef = useRef(false);
  const resumeLock = useRef(false);
  const sendRef = useRef(null);

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
      conversationSummary: memorySummary || ''
    };
  }, [wallet, multi, canReadPortfolio, solanaAddressLive, automations, memorySummary, solanaRows, walletConnected, walletCanSign]);

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
    }
    setThinking([...THINKING]);
    setSuggestions([]);
    try {
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
        intentType: reply.intent?.type || null,
        suggestions: Array.isArray(reply.suggestions) ? reply.suggestions : []
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
  }, [aiContext, conversationId, t, locale, rememberPending]);

  sendRef.current = sendMessage;

  const sendSuggested = useCallback((s) => {
    if (!s?.prompt) return;
    setInput(s.prompt);
    void sendMessage(s.prompt);
  }, [sendMessage]);

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

      /* Confirm continues THIS intent by id (spec §26). The confirmation word
         is never sent back through the parser, so it can no longer come back
         as "your request is incomplete". */
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
          /* The plan needs one more real answer — keep the intent alive and
             ask with options rather than dropping the request. */
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

      /* Server returned a plan, not a result. The wallet signs here.
         HANDOFF_READY / a route is never treated as success. */
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
      const formatted = formatExecutionResult({
        result,
        rebalance: result?.rebalance || rebalance || prepared?.rebalance,
        locale
      });
      try { await aiExecutionResult({ execution: formatted.execution || result, rebalance, locale }); } catch { /* reporting is best-effort */ }
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
        /* Spec §20: confirmed on-chain → refresh wallet, balances, portfolio
           and the AI context so the next answer already knows the new state. */
        try { await multi?.refresh?.(); } catch { /* the next poll will catch up */ }
        setSolanaTick((v) => v + 1);
        try {
          const list = await aiAutomations();
          if (list?.ok) setAutomations(list.automations || []);
        } catch { /* best effort */ }
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

  /* A tapped option (wallet / asset / amount) resolves the SAME intent — it is
     appended as a hint, never a brand new request the user has to restate. */
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
      } catch {
        /* silent: the assistant keeps working without memory/automation */
      }
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
    } catch { /* no-op */ }
  }, [messages, thinking, progress, pendingExecution]);

  /* After the wallet connects, resume the original request. Never force a retype. */
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

  const handleSubmit = useCallback((e) => {
    e?.preventDefault?.();
    if (input.trim()) void sendMessage(input);
  }, [input, sendMessage]);

  const connectWalletIfNeeded = useCallback(async () => {
    try {
      await connectSolana();
      setSolanaTick((v) => v + 1);
    } catch { /* the wallet UI will tell the user */ }
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

  return (
    <div className="iaos-page">
      <div className="iaos-shell">
        <header className="iaos-header">
          <div className="iaos-title">
            <span className="iaos-mark" aria-hidden="true">✦</span>
            <h1>{t('intentAIOS.header', { defaultValue: 'Intent AI' })}</h1>
          </div>
          <span className="iaos-live" data-on={walletConnected ? 'true' : 'false'} title={walletConnected ? 'Wallet connected' : 'Wallet not connected'}>
            <i aria-hidden="true" /> {t('intentAIOS.live', { defaultValue: 'Live' })}
          </span>
        </header>

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
                <div className="iaos-msg-text">{m.content}</div>
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
      </div>

      {drawerOpen ? (
        <div className="iaos-overlay" role="dialog" aria-modal="true" aria-label={t('intentAIOS.actions', { defaultValue: 'Actions' })}>
          <div className="iaos-drawer">
            <div className="iaos-drawer-head">
              <h2>{t('intentAIOS.actions', { defaultValue: 'Actions' })}</h2>
              <button type="button" className="iaos-close" onClick={() => setDrawerOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="iaos-drawer-grid">
              {ACTION_ITEMS.map((item) => (
                <button key={item.id} type="button" className="iaos-drawer-item" onClick={() => runAction(item)}>
                  <span>{item.label}</span>
                  <small>{item.prompt}</small>
                </button>
              ))}
            </div>
            <p className="iaos-drawer-note">{t('intentAIOS.drawerNote', { defaultValue: 'این دکمه‌ها فقط میانبر هستند؛ AI مستقل از آن‌ها کار می‌کند.' })}</p>
          </div>
        </div>
      ) : null}

      <WalletConnectSheet open={walletSheetOpen} onClose={() => setWalletSheetOpen(false)} />
    </div>
  );
}
