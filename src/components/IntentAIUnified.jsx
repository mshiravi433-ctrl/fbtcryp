/**
 * FBT INTENT AI — the unified AI OS chat surface.
 * ---------------------------------------------------------------------------
 * This is the single intelligent interface for all of FBT. It is deliberately
 * NOT a dashboard of agents, buttons and policies: it is a conversation with a
 * live wallet / portfolio / market context, dynamic suggestions (never fixed
 * quick-reply chips), a [ + Actions ] drawer (the actions are helpers, not the
 * product) and a real execution card that either hands the transaction to the
 * actual venue/wallet flow or creates a real automation / goal.
 *
 * No policy editor, no L1/L2/L3 selector, no artificial $100/$500/$1000 caps.
 * Wallet signature, validation and the wallet/security flow are the only
 * boundaries that still exist.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  aiRunAutomation
} from '../lib/aiIntentClient';
import '../styles/intent-ai-os.css';

const CONVERSATION_KEY = 'fbt.ai.os.conversation.v1';
const MAX_SUGGESTIONS = 4;
const DEFAULT_CHAIN = 42161;

const EXECUTABLE_ACTION_TYPES = new Set([
  'SWAP', 'BRIDGE', 'SEND', 'BUY', 'SELL', 'FUTURES', 'FARM', 'LEND',
  'STOCK', 'DCA', 'AUTOMATION_CREATE', 'GOAL', 'REBALANCE',
  'DEPOSIT', 'YIELD_SWEEP', 'STABLE_SHIELD', 'REVOKE_APPROVAL', 'STOP_LOSS'
]);

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

/*
 * ─── NOTHING INTERNAL REACHES THE BUBBLE ────────────────────────────────────
 * The chat used to print the planner's own vocabulary at the user:
 *
 *     Intent: PORTFOLIO. Prepared 1 real action(s).
 *
 * The server now sends a sentence plus a structured `summary`, so the normal
 * path is clean. This scrub is the second line of defence for text that comes
 * from somewhere else — a model completion, an older server, an error string.
 * It removes the machine tokens rather than the whole message: a user who
 * loses the answer learns nothing, a user who loses "actionId: 0x…" loses
 * nothing.
 */
const DEBUG_TOKEN_PATTERNS = [
  /\bIntent:\s*[A-Z_]{3,}\.?\s*/g,
  /\bPrepared\s+\d+\s+(?:real\s+)?action\(s\)\.?/gi,
  /\bNo executable action prepared[^.]*\.?/gi,
  /\b(?:actionId|routeId|planId|quoteId|conversationId|traceId)\s*[:=]\s*[^\s,;)]+/gi,
  /\btool_call\b[^\s]*/gi,
  /\bblocked\s*[:=]\s*(?:true|false)/gi,
  /\b(?:TRADE|EARN|PORTFOLIO|PROTECT|RESEARCH|AUTOMATION|GENERAL)\b(?=\s*[.·|]|$)/g
];

function scrubMachineTokens(text) {
  let out = String(text ?? '');
  for (const re of DEBUG_TOKEN_PATTERNS) out = out.replace(re, ' ');
  return tidy(out);
}

const tidy = (s) => String(s ?? '')
  .replace(/\s{2,}/g, ' ')
  .replace(/\s+([.,!?؛،])/g, '$1')
  .trim();

/**
 * The assistant's answer, in the user's language.
 *
 * The server sends both a finished English sentence and the structured
 * `summary` it was built from. The summary is preferred because it is the
 * only way this screen can answer in the other eleven languages; `text` is the
 * fallback for an older server, and it goes through the scrub first.
 */
function humanReply(reply, t) {
  const s = reply?.summary;
  if (!s) {
    return scrubMachineTokens(reply?.text) || t('intentAIOS.noReply');
  }
  if (s.kind === 'blocked') {
    return tidy(t('intentAIOS.reply.blocked', {
      why: t(`intentAIOS.reply.blockedBy.${s.blockedBy}`, {
        defaultValue: t('intentAIOS.reply.blockedBy.DEFAULT')
      })
    }));
  }
  if (s.kind === 'analysis' || !s.action) return t('intentAIOS.reply.analysis');

  const a = s.action;
  const subject = a.asset
    ? (a.amountUsd
      ? t('intentAIOS.reply.amountOf', { amount: a.amountUsd, asset: a.asset })
      : t('intentAIOS.reply.assetOnly', { asset: a.asset }))
    : '';
  return tidy(t('intentAIOS.reply.action', {
    verb: t(`intentAIOS.reply.verb.${a.type}`, { defaultValue: t('intentAIOS.reply.verb.DEFAULT') }),
    subject,
    chain: a.chainName ? t('intentAIOS.reply.onChain', { chain: a.chainName }) : '',
    venue: a.venue ? t('intentAIOS.reply.viaVenue', { venue: a.venue }) : ''
  }));
}

/** '/bridge' → 'Bridge'. A screen name is human; a route id is not. */
function screenName(route) {
  const seg = String(route || '').split('?')[0].split('/').filter(Boolean).pop();
  if (!seg) return null;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

function makeId() {
  try { return crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  catch { return `m-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export default function IntentAIUnified({ defaultChainId = DEFAULT_CHAIN }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const canReadPortfolio = Boolean(wallet?.isConnected && wallet?.address && !wallet?.locked);
  const multi = useMultiChainPortfolio(canReadPortfolio ? wallet : null);

  const [messages, setMessages] = useState(() => [{
    id: makeId(),
    role: 'ai',
    content: t('intentAIOS.hello'),
    kind: 'hello'
  }]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingExecution, setPendingExecution] = useState(null);
  const [executing, setExecuting] = useState(false);
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
    const holdings = [...solRows.map((r) => ({ symbol: r.symbol, chainId: r.chainId ?? null, valueUsd: Number(r.valueUsd) || null })), ...rows.map((r) => ({ symbol: r.symbol, chainId: r.chainId ?? null, valueUsd: Number(r.value) || null }))];
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

  const sendMessage = useCallback(async (rawText) => {
    const message = String(rawText || '').trim();
    if (!message || busyRef.current) return null;
    busyRef.current = true;
    setInput('');
    setMessages((prev) => [...prev, { id: makeId(), role: 'user', content: message, kind: 'user' }]);
    setThinking([...THINKING]);
    setSuggestions([]);
    try {
      const res = await aiChat({ message, conversationId, context: aiContext });
      if (res?.ok !== true) {
        throw new Error(res?.error || 'AI_UNAVAILABLE');
      }
      const reply = res.reply || {};
      const nextMessage = {
        id: makeId(),
        role: 'ai',
        content: humanReply(reply, t),
        kind: reply.plan?.intent ? 'assistant' : 'assistant',
        plan: reply.plan || null,
        verdict: reply.verdict || null,
        action: reply.actions?.[0] || null,
        suggestions: Array.isArray(reply.suggestions) ? reply.suggestions : [],
        goalDetected: reply.goalDetected === true
      };
      setMessages((prev) => [...prev, nextMessage]);
      setSuggestions(nextMessage.suggestions.slice(0, MAX_SUGGESTIONS));
      if (res.context?.conversationSummary) setMemorySummary(res.context.conversationSummary);
      const firstAction = reply.plan?.actions?.[0];
      if (firstAction && reply.verdict?.ok === true && EXECUTABLE_ACTION_TYPES.has(String(firstAction.type || '').toUpperCase())) {
        setPendingExecution({ plan: reply.plan, action: firstAction, message, suggestion: null });
      }
      /* A separate suggestions call is not needed: the chat response already
         carries the dynamic suggestions, shaped from this exact context. */
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: t('intentAIOS.error'),
        kind: 'error',
        error: String(err?.message || '')
      }]);
      setSuggestions([]);
    } finally {
      setThinking([]);
      busyRef.current = false;
    }
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiContext, conversationId, t]);

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

  const confirmExecution = useCallback(async () => {
    if (!pendingExecution || executing) return;
    const { plan, action, message } = pendingExecution;
    const type = String(action?.type || '').toUpperCase();
    setExecuting(true);
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
          automation: made.automation || null
        }]);
        const list = await aiAutomations();
        setAutomations(list?.ok ? list.automations : []);
      } else if (type === 'GOAL') {
        const made = await aiCreateGoal({ message });
        if (made?.ok !== true) throw new Error(made?.error || 'GOAL_FAILED');
        setMessages((prev) => [...prev, {
          id: makeId(),
          role: 'ai',
          content: t('intentAIOS.goalCreated'),
          kind: 'goal',
          goal: made.goal || null
        }]);
      } else {
        const res = await aiExecute({ action, message, wallet: aiContext.wallet, context: aiContext });
        if (res?.ok !== true) throw new Error(res?.error || 'EXECUTION_FAILED');
        const route = res?.handoff?.route || null;
        setMessages((prev) => [...prev, {
          id: makeId(),
          role: 'ai',
          content: route
            ? t('intentAIOS.executionReady')
            : t('intentAIOS.executionBlocked'),
          kind: 'execution-ready',
          handoff: res.handoff || null,
          status: res.status || null
        }]);
        if (route) navigate(route);
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: makeId(),
        role: 'ai',
        content: t('intentAIOS.executionFailed'),
        kind: 'error',
        error: String(err?.message || '')
      }]);
    } finally {
      setPendingExecution(null);
      setExecuting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingExecution, executing, aiContext, navigate, t]);

  const editExecution = useCallback(() => {
    if (!pendingExecution?.action?.type) return;
    const promptMap = {
      SWAP: `می‌خواهم ${pendingExecution.action.amount || ''} ${pendingExecution.action.asset || ''} را تبدیل کنم.`,
      BRIDGE: `می‌خواهم ${pendingExecution.action.asset || ''} را Bridge کنم.`,
      SEND: `می‌خواهم ${pendingExecution.action.asset || ''} ارسال کنم.`,
      DCA: `هر هفته ${pendingExecution.action.amount || '100'} دلار ${pendingExecution.action.asset || 'BTC'} بخر.`,
      AUTOMATION_CREATE: `هر هفته ${pendingExecution.action.amount || '100'} دلار ${pendingExecution.action.asset || 'BTC'} بخر.`,
      GOAL: 'می‌خواهم هدف مالی بسازم.'
    };
    setInput(promptMap[pendingExecution.action.type] || pendingExecution.action.type);
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
  }, [messages, thinking]);

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
      /* Re-activate is not the same as a fake completed run: it only resumes
         the schedule, the next run still requires a wallet signature. */
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
    if (run?.ok && run.handoff?.route) navigate(run.handoff.route);
  }, [navigate]);

  const deleteAutomationRow = useCallback(async (row) => {
    if (!row) return;
    await aiDeleteAutomation(row.id);
    await refreshAutomations();
  }, [refreshAutomations]);

  return (
    <div className="iaos-page">
      <div className="iaos-shell">
        <header className="iaos-header">
          <div className="iaos-title">
            <span className="iaos-mark" aria-hidden="true">✦</span>
            <h1>{t('intentAIOS.header')}</h1>
          </div>
          <span className="iaos-live" data-on={walletConnected ? 'true' : 'false'} title={walletConnected ? 'Wallet connected' : 'Wallet not connected'}>
            <i aria-hidden="true" /> {t('intentAIOS.live')}
          </span>
        </header>

        {automations.length ? (
          <div className="iaos-autos" data-testid="intent-ai-active-automations">
            <div className="iaos-autos-head">
              <span>{t('intentAIOS.autosTitle')}</span>
              <button type="button" className="iaos-autos-manage" onClick={() => setAutosOpen((v) => !v)}>
                {t('intentAIOS.manage')}
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
                {m.plan && m.verdict ? (
                  <div className="iaos-plan">
                    {/*
                      The topic, translated — not `m.plan.intent`, which is the
                      planner's enum ("PORTFOLIO") and meant nothing to anyone
                      reading it. The action count is gone with it: how many
                      legs a plan has is not news to a person, and "Prepared 1
                      action(s)" was the single most machine-sounding line on
                      the screen.
                    */}
                    <div className="iaos-plan-intent">
                      {t(`intentAIOS.topic.${m.plan.intent}`, { defaultValue: t('intentAIOS.topic.GENERAL') })}
                    </div>
                    <div className="iaos-plan-meta">
                      <span>
                        {m.verdict?.ok
                          ? t('intentAIOS.readyToConfirm')
                          : t(`intentAIOS.reply.blockedBy.${m.verdict?.reason || 'DEFAULT'}`, {
                            defaultValue: t('intentAIOS.reply.blockedBy.DEFAULT')
                          })}
                      </span>
                    </div>
                  </div>
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

          {pendingExecution ? (
            <div className="iaos-exec-card" role="group">
              <div className="iaos-exec-title">{t('intentAIOS.readyTitle')}</div>
              <div className="iaos-exec-line">
                <strong>
                  {t(`intentAIOS.reply.verb.${String(pendingExecution.action?.type || '').toUpperCase()}`, {
                    defaultValue: t('intentAIOS.reply.verb.DEFAULT')
                  })}
                </strong>
                <span>{pendingExecution.action?.amount || ''} {pendingExecution.action?.asset || ''}</span>
              </div>
              {/* Where it lands, by name. The raw route was an internal id. */}
              {screenName(pendingExecution.action?.handoffRoute) ? (
                <div className="iaos-exec-route">
                  {t('intentAIOS.opensScreen', { screen: screenName(pendingExecution.action.handoffRoute) })}
                </div>
              ) : null}
              <div className="iaos-exec-actions">
                <button type="button" className="iaos-btn iss-solid" onClick={confirmExecution} disabled={executing}>
                  {executing ? t('intentAIOS.working') : t('intentAIOS.confirm')}
                </button>
                <button type="button" className="iaos-btn iss-ghost" onClick={editExecution}>{t('intentAIOS.edit')}</button>
              </div>
            </div>
          ) : null}
        </div>

        {suggestions.length ? (
          <div className="iaos-suggestions">
            <div className="iaos-suggestions-title">✦ {t('intentAIOS.suggestions')}</div>
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
            {t('intentAIOS.solanaConnect')}
          </button>
        ) : null}

        <form className="iaos-composer" onSubmit={handleSubmit}>
          <button type="button" className="iaos-action-btn" onClick={() => setDrawerOpen(true)} aria-label={t('intentAIOS.actions')}>
            + {t('intentAIOS.actions')}
          </button>
          <input
            className="iaos-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('intentAIOS.placeholder')}
            aria-label={t('intentAIOS.placeholder')}
            enterKeyHint="send"
          />
          <button type="submit" className="iaos-send" aria-label={t('intentAIOS.send')} disabled={!input.trim() || thinking.length > 0}>➤</button>
        </form>
      </div>

      {drawerOpen ? (
        <div className="iaos-overlay" role="dialog" aria-modal="true" aria-label={t('intentAIOS.actions')}>
          <div className="iaos-drawer">
            <div className="iaos-drawer-head">
              <h2>{t('intentAIOS.actions')}</h2>
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
            <p className="iaos-drawer-note">{t('intentAIOS.drawerNote')}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
