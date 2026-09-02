/**
 * FBT INTENT AI — Mode A (Human ↔ AI) product panel.
 * ---------------------------------------------------------------------------
 * Product-level Intent AI panel. It is deterministic, i18n-driven (no
 * hardcoded fa/ar in the JSX), and exposes:
 *
 *   · a guided step-by-step chat flow (one question at a time, with
 *     quick-reply chips: task, amount confirmations, network, tool perms)
 *   · the friendly financial/time limits (10M total, 400k per tx, 500% goal,
 *     30-day goals) enforced in the parser, the flow and this UI
 *   · deep market analysis: an "analyze ..." turn enriches its reply with
 *     real, sourced market data (price / 24h change / 7d trend / volume /
 *     regime) via buildChatMarketAnalysis; when the feed is unreachable the
 *     card says so instead of showing numbers it does not have
 *   · a local transaction history (localStorage only, fbt.intent.txHistory):
 *     every decided receipt is recorded locally and browsable on the Intent
 *     OS history tab
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
  policyPreview,
  openConfirmationGate, decideGate, assertGateAllowsSubmit, termsFromDraft,
  evaluateRisk, venueHealth, reconcile, executeConfirmed,
  describeWalletRuntime, signIntentWithWallet,
  sessionPolicyCaps, checkSessionPolicy, explainExecutionFailure,
  goalProgress,
  PRIMARY_MODES, MODE_LABELS, MODE_DEFINITIONS,
  INTENT_LIMITS, MAX_GOAL_DURATION_HRS,
  FLOW_CHAIN_SUGGESTIONS, FLOW_TASK_SUGGESTIONS, FLOW_TOOL_SUGGESTIONS,
  /* Deep market analysis + local history. */
  buildChatMarketAnalysis, recordIntentTx,
  /* Phase 90 — the fee is on the preview and on the receipt, or nothing runs. */
  computeFee, attachFeeToReceipt,
  /* Phase 94 — offline is a waiting room, never an outbox. */
  enqueueIntent, offlineStatus,
  /* Fiat requests are routed only to the native Buy / Sell review surface. */
  detectFiatIntent, fiatBoundaryResponse,
  /* Draft to transaction: broadcasting stays off unless the build enables it. */
  broadcastEnabled, assertBroadcastAllowed,
  /* Command Center inputs the deck reads: this device's own receipt history
     (the daily budget) and the wallet's standing approvals (a risk signal). */
  loadIntentTxHistory, approvalInventory
} from '../lib/intent-ai';
import { getMarkets, getOhlc } from '../lib/api';
import { getYields } from '../lib/yields.js';
import { EVM_CHAINS } from '../lib/chains';
import { useIntentAiPoints } from '../hooks/useIntentAiPoints';
import { selectExternalAgent, externalAgentRead } from '../lib/intent-ai/externalAgentVoice.js';
import {
  parseTeachCommand, parseMemoryCommand, rememberTaught,
  listTaught, clearTaught, taughtChainHint
} from '../lib/intent-ai/taughtMemory.js';
import { parseNavigationCommand } from '../lib/intent-ai/chatNavigation.js';
import { getIntentActivation, getIntentCapabilities, getExternalAgents, getIntentPhaseStatus, getIntentPublicStatus } from '../lib/intentNetwork';
import GoalCountdown from './GoalCountdown';
import TokenApprovals from './TokenApprovals';
import ScrollRail from './ScrollRail';
import AutonomyLevelIcon from './AutonomyLevelIcon';
/* Command Center: the orchestrator, the deck it feeds, and the browser half of
   its API. The deck components are presentational by construction — they cannot
   invent a number, because every figure is computed here or in the shared lib. */
import {
  orchestrate as aiOrchestrate,
  buildPlan as aiBuildPlanLocal,
  classifyIntent as aiClassify,
  dashboardSnapshot,
  validateExecution as aiValidateExecution,
  executionStageLedger as aiStageLedger,
  thinkingStages as aiThinkingStages,
  loadAiControl,
  saveAiControl,
  writeStopFlag,
  readStopFlag,
  loadAutomations,
  saveAutomations,
  upsertAutomation,
  removeAutomation as removeAutomationRow,
  setAutomationActive,
  automationSpendToday,
  automationTotals,
  sanitizeAiControl,
  createAutomation as createAutomationRow,
  intentForSurface,
  AI_SURFACES,
  AI_MODES
} from '../lib/intent-ai/commandCenter.js';
import { aiBuildPlan, aiChat, aiCreateAutomation, aiDeleteAutomation, aiApprovePlan, aiEmergencyStop, aiReleaseEmergencyStop } from '../lib/aiCommandClient.js';
import {
  AiQuickActions,
  AiPortfolioCard,
  AiToolGrid,
  AiThinkRail,
  AiPlanCard,
  AiAgentLanes
} from './ai/AiCommandDeck.jsx';
import AiControlPanel from './ai/AiControlPanel.jsx';
import AiAutomations from './ai/AiAutomations.jsx';
import '../styles/intent-os.css';
import '../styles/ai-command-center.css';

const LEVELS = [
  { value: 1, key: 'level1' },
  { value: 2, key: 'level2' },
  { value: 3, key: 'level3' }
];

/*
 * Session controls, in rail order.
 *
 * STOP and EMERGENCY_EXIT are the two destructive actions, so they sit at the
 * two ends of the rail rather than next to each other: a thumb reaching for
 * the harmless REVOKE must never land on the stop.
 */
const CONTROL_ORDER = ['STOP', 'PAUSE', 'REVOKE', 'DISCONNECT', 'EMERGENCY_EXIT'];

/**
 * One glyph per control. Drawn, not emoji: these are the five buttons a person
 * reaches for when something is going wrong, and an emoji's size and baseline
 * move with the platform font — which is how a "stop" ends up looking like a
 * different control on a different phone.
 */
function ControlIcon({ action }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false'
  };
  if (action === 'STOP') {
    return (
      <svg {...common}>
        <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.4" fill="currentColor" />
      </svg>
    );
  }
  if (action === 'PAUSE') {
    return (
      <svg {...common}>
        <rect x="7" y="5.9" width="3.3" height="12.2" rx="1.4" fill="currentColor" />
        <rect x="13.7" y="5.9" width="3.3" height="12.2" rx="1.4" fill="currentColor" />
      </svg>
    );
  }
  if (action === 'REVOKE') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="7.4" stroke="currentColor" strokeWidth="1.9" />
        <path d="M6.9 17.1 17.1 6.9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }
  if (action === 'DISCONNECT') {
    return (
      <svg {...common}>
        <path d="M9.4 8.6v6.8M14.6 8.6v6.8M9.4 12H5.9M14.6 12h3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 4.1 21.3 19.9H2.7L12 4.1Z" fill="currentColor" />
      <path d="M12 9.9v4.4" stroke="#230a14" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="12" cy="17.1" r="1.12" fill="#230a14" />
    </svg>
  );
}

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

/*
 * Guided examples, one panel per venue. The glyph is drawn from the same
 * typographic family the rest of the panel uses (no emoji: their size and
 * baseline move with the platform font) and it is decorative only — the text
 * of every example is the thing that carries meaning, and it is i18n.
 */
const EXAMPLE_GROUPS = [
  { id: 'swap', glyph: '⇄' },
  { id: 'bridge', glyph: '⇌' },
  { id: 'send', glyph: '↗' },
  { id: 'goal', glyph: '◎' },
  { id: 'analyze', glyph: '⌁' },
  { id: 'futures', glyph: '⇡' },
  { id: 'lending', glyph: '◈' },
  { id: 'staking', glyph: '⬡' }
];

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

export default function IntentAIPanel({
  defaultChainId = 42161,
  onDraftReady,
  walletRuntime = null,
  /*
   * What the deck's portfolio card is allowed to say.
   *
   * `aiPortfolio` arrives from the route wrapper as `{ holdings, totalValueUsd,
   * change24hPct, dataStatus }`, built from the wallet reads the app already
   * makes. The panel deliberately does NOT import a wallet hook: it is mounted
   * headless by the suite, and a deck that read balances by itself could paint
   * a number on a screen where nothing was actually read. `null` here is the
   * honest "no wallet read yet" card, and it is what a headless mount gets.
   */
  aiPortfolio = null,
  tokenApprovals = null,
  /* Real broadcast bridge, injected by IntentAIRoute (Phase 201). The panel
     itself stays free of wallet-library imports; when this is null the panel
     keeps its honest "authorized — not on network" behaviour. */
  executeIntentBroadcast = null,
  trackIntentTx = null,
  explorerUrl = null,
  broadcastSupportedKind = null
}) {
  const { t, i18n } = useTranslation();
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
  /* Per-execution broadcast consent. Deliberately NOT persisted and reset
     after every run: a standing "yes" to sending funds is not consent. */
  const [broadcastOptIn, setBroadcastOptIn] = useState(false);
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
  /* Phase 203 — the app's own points, earned by using the assistant. */
  const { points, lastGain, award } = useIntentAiPoints();
  /*
   * Phase 204 — which external agent participates. Deterministic: an explicit
   * pick wins; otherwise the single analysis-eligible candidate joins on its
   * own; two or more candidates without a choice stay unselected until the
   * user chooses one in the mode card.
   */
  const [externalAgentChoice, setExternalAgentChoice] = useState(null);
  const selectedExternalAgent = useMemo(() => {
    if (mode !== 'fbt-external-ai') return null;
    return selectExternalAgent({
      candidates: session?.externalAgentDiscovery?.candidates || [],
      selectedId: externalAgentChoice
    });
  }, [mode, session?.externalAgentDiscovery, externalAgentChoice]);
  /*
   * L3 policy editor defaults. Chains and protocols default to EVERY allowed
   * value and assets defaults to blank (= all assets): a fresh session that
   * only quotes USDC→ETH on Arbitrum must not be refused because the default
   * policy forgot a network. The money caps stay tight ($1k / $200 / $100) —
   * broad scope, bounded size; the user raises them deliberately.
   */
  const [policyInput, setPolicyInput] = useState({
    /* The documented defaults: $1k capital / $200 per transaction / $100 max
       loss (see the L3 policy editor comment above). The previous values
       ($500/$50/$50) refused a plain $100 swap with TRANSACTION_LIMIT_EXCEEDED
       before the user had touched a single setting. */
    maxCapitalUsd: 1000, maxTransactionUsd: 200, maxLossUsd: 100, maxLeverage: 2,
    /*
     * A fresh L3 policy MUST carry at least one chain and one protocol:
     * sanitizePolicy refuses an L3 policy with empty lists (createPolicy then
     * returns policy: null and every turn answers POLICY_BAD_POLICY — the
     * exact dead end this restores). These defaults were commented out,
     * which made the first L3 session in a fresh profile unusable.
     */
    allowedChains: '42161,1,137,10',
    allowedProtocols: 'swap,bridge,lending',
    allowedAssets: '', durationMin: 30
  });
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  /*
   * ─── COMMAND CENTER STATE ────────────────────────────────────────────────
   * Four pieces, and each exists for a reason a reviewer can check:
   *
   *   aiControl   the budget the firewall reads (persisted; a cap that resets on
   *               refresh is not a cap)
   *   automations the recurring plans on this device (persisted)
   *   deck        the last orchestration: plan + verdict + stages + what the
   *               feeds said. Derived state is NOT stored alongside it, so an
   *               edit of a cap cannot leave a stale "ready" banner on screen.
   *   ccTab       which deck surface is open. A tab, not a page: the assistant,
   *               its thread and its confirmation screen are always mounted, so
   *               there is no route where the safety surfaces disappear.
   */
  const [aiControl, setAiControl] = useState(() => {
    const stored = loadAiControl();
    const stop = readStopFlag();
    /* A stop that is on disk must be ON in memory before the first paint: the
       half-second where it was not was a window where a plan could be approved
       by someone who had just stopped everything. */
    return stop ? { ...stored, stopActive: true, stoppedAt: stop.at } : stored;
  });
  const [automations, setAutomations] = useState(() => loadAutomations());
  const [deck, setDeck] = useState(null);
  const [deckBusy, setDeckBusy] = useState(null);
  const [ccTab, setCcTab] = useState('command');
  const [automationCode, setAutomationCode] = useState(null);
  const [serverMode, setServerMode] = useState('local');
  /* Voice input. Rendered as a real control only when the browser has the
     API; everywhere else the button says "not here" rather than doing nothing. */
  const [listening, setListening] = useState(false);
  const speechRef = useRef(null);
  const deckRunRef = useRef(0);

  /*
   * The AI daily budget is measured against something real: the receipts this
   * device already recorded locally (`fbt.intent.txHistory`). Not a server
   * guess, not a balance delta. If history is unreadable the spend is 0 and the
   * card says where that 0 came from — the cap still applies, it just starts
   * from the only number this app can attest.
   */
  const dailyVolume = useMemo(() => {
    let rows = [];
    try { rows = loadIntentTxHistory(); } catch { rows = []; }
    const dayStart = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const spent = rows
      .filter((r) => r && r.at >= dayStart && Number(r.amountUsd) > 0
        && ['completed', 'submitted', 'authorized', 'pending', 'partial'].includes(r.status))
      .reduce((sum, r) => sum + Number(r.amountUsd), 0);
    return { spentTodayUsd: Math.round(spent * 100) / 100, entries: rows.length, rows };
  }, [deck?.at, receipt?.status, session?.messages?.length]);

  const approvalRead = useMemo(
    () => (Array.isArray(tokenApprovals) ? approvalInventory(tokenApprovals) : null),
    [tokenApprovals]
  );

  /* One snapshot for every card on the deck. Recomputed when a feed, a cap, an
     automation or the plan changes — never cached across a change, so a raised
     limit cannot leave a stale budget bar under it. */
  const snapshot = useMemo(() => dashboardSnapshot({
    aiControl,
    automations,
    txHistory: dailyVolume.rows || null,
    holdings: aiPortfolio?.holdings || null,
    /* Only a LIVE market read may set a number the user sees. An offline
       snapshot stays out of the card (it still reaches the planner through
       `orchestrate`'s context, which reports it as an assumption). */
    market: deck?.market
      ? (deck.market.dataStatus === 'live'
        ? deck.market
        : { ...deck.market, change24hPct: null, regime: null, dataStatus: 'offline' })
      : (aiPortfolio?.change24hPct != null ? { change24hPct: aiPortfolio.change24hPct, dataStatus: 'local' } : null),
    yields: deck?.yields || null,
    approvals: approvalRead ? { unsafeCount: (approvalRead.needsAttention || []).length } : null
  }), [aiControl, automations, dailyVolume, aiPortfolio, deck, approvalRead]);

  /*
   * The plan card's verdict is recomputed from the CURRENT control on every
   * render, not replayed from the moment the plan was built. Two reasons, both
   * of them safety: raise a cap and a stale "ready for your approval" tag would
   * be a lie, and press Emergency stop and the Approve button has to go dead on
   * the same paint. `approveDeckPlan` runs this same check again at the tap, so
   * what the screen says and what the button does cannot drift apart.
   */
  const deckWallet = useMemo(() => describeWalletRuntime(walletRuntime || {}), [walletRuntime]);
  const deckView = useMemo(() => {
    const plan = deck?.plan || null;
    if (!plan) return null;
    const verdict = aiValidateExecution(plan, {
      aiControl,
      automations,
      dailyVolumeUsd: dailyVolume.spentTodayUsd,
      wallet: { connected: deckWallet.connected === true, canSign: deckWallet.canSign === true },
      sessionLevel: level
    });
    const ledger = aiStageLedger(plan, verdict, { wallet: { connected: deckWallet.connected === true } });
    return { verdict, stages: ledger.stages };
  }, [deck?.plan, aiControl, automations, dailyVolume, level, deckWallet]);

  /* The AI-control box sets the session's autonomy level, so there is exactly
     one number that decides what may be prepared. The L1/L2/L3 chips and this
     box are two handles on the same value, never two values. */
  useEffect(() => {
    const next = AI_MODES.find((m) => m.id === aiControl.mode)?.level || 1;
    setLevel((prev) => (prev === next ? prev : next));
  }, [aiControl.mode]);

  /* Persist the moment it changes. A budget the user set and never saved is a
     budget the next plan will not see. */
  useEffect(() => {
    saveAiControl(aiControl);
  }, [aiControl]);

  /*
   * First paint of the deck: the read the user lands on. It runs through the
   * same orchestrate() a tap runs, with no message — so the card is never a
   * different kind of thing from the plan, just an earlier one. A dead feed
   * leaves `dataStatus: 'unavailable'`, which is what the card then prints.
   */
  const deckInitRef = useRef(false);
  useEffect(() => {
    if (deckInitRef.current) return;
    deckInitRef.current = true;
    runDeck({ text: '', surface: null, reason: 'open' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─────────────── deck: the five routes, one engine ─────────────────── */

  /**
   * Run the orchestrator for a message or a tapped surface.
   *
   * Sequence, and why it is in this order:
   *   1. the LOCAL layer decides the route and the numbers, synchronously — so a
   *      user with no network still gets a plan, and the plan's figures are the
   *      ones the deterministic parser read out of their own sentence;
   *   2. the stage rail advances on REAL work (a price read, a yield read), so
   *      "Checking market…" is a fetch and not a timer;
   *   3. the API is asked, and only its *feed* data (prices, ranked venues) and
   *      an optional intent label are merged in. A response that is not ok is
   *      recorded as `serverMode: 'unavailable'` and changes nothing else.
   */
  async function runDeck({ text = '', surface = null, reason = 'ask' } = {}) {
    const run = deckRunRef.current + 1;
    deckRunRef.current = run;
    const stale = () => deckRunRef.current !== run;
    const classification = surface
      ? { intent: intentForSurface(surface), surface, confidence: 1, source: 'surface-tap', utterance: {} }
      : aiClassify(text, { locale: i18n?.language });
    const stages = aiThinkingStages(classification.intent || 'GENERAL');
    setDeckBusy({ stages: stages.map((st) => ({ ...st })), index: 0, reason });

    let market = null;
    let yields = null;
    /* Stage 2–3: the market read. Same source the analysis card uses, so the
       deck and the thread can never disagree about a price. */
    setDeckBusy((prev) => ({ ...prev, index: 1 }));
    try {
      const list = await getMarkets({ page: 1, perPage: 250, vs: 'usd' });
      if (Array.isArray(list) && list.length) {
        const byId = (id) => list.find((c) => c?.id === id) || null;
        const btc = byId('bitcoin');
        /* `getMarkets` answers from a deterministic offline snapshot when neither
           the API nor the public feed can be reached — the same call the market
           screen makes. The deck must not relabel that as a live read: the
           provenance rides on every row, and it decides whether the rail says
           "done" or "unavailable", and whether any 24h number is printed at all.
           A stale price is worth reading; it is not worth planning on. */
        const live = list[0]?.dataProvenance !== 'offline';
        market = {
          dataStatus: live ? 'live' : 'offline',
          change24hPct: Number.isFinite(Number(btc?.price_change_percentage_24h)) ? Number(btc.price_change_percentage_24h) : null,
          priceMap: {
            BTC: Number(btc?.current_price) || null,
            ETH: Number(byId('ethereum')?.current_price) || null,
            SOL: Number(byId('solana')?.current_price) || null
          },
          fetchedAt: Date.now()
        };
      }
    } catch { market = null; }
    if (stale()) return null;
    setDeckBusy((prev) => ({ ...prev, index: 2 }));

    /* The yield read only runs for routes that spend the answer. */
    const needsYields = ['EARN', 'GENERAL', 'PORTFOLIO'].includes(classification.intent);
    if (needsYields) {
      try {
        /* The Farm page's own reader, so the deck and /farm never disagree about
           what a venue pays. It throws when the feed is unreachable, which is
           exactly the branch that leaves `yields` null and lets the rail say so
           instead of showing a yield the assistant did not read. */
        const raw = await getYields({ timeout: 8000 });
        const pools = Array.isArray(raw?.pools) ? raw.pools : (Array.isArray(raw) ? raw : []);
        yields = pools
          .slice(0, 40)
          .map((pool) => ({
            protocol: pool?.protocol || pool?.project || null,
            symbol: pool?.symbol || pool?.token || null,
            apy: Number.isFinite(Number(pool?.apy)) ? Number(pool.apy) : null,
            riskBand: pool?.riskBand || pool?.risk || null
          }))
          .filter((row) => row.apy != null);
        if (!yields.length) yields = null;
      } catch { yields = null; }
    }
    if (stale()) return null;
    setDeckBusy((prev) => ({ ...prev, index: stages.length - 1 }));

    const walletRuntimeInfo = describeWalletRuntime(walletRuntime || {});
    const local = aiOrchestrate({
      message: text,
      surface,
      context: {
        locale: i18n?.language,
        aiControl,
        automations,
        holdings: aiPortfolio?.holdings || null,
        market: market || (aiPortfolio?.change24hPct != null ? { change24hPct: aiPortfolio.change24hPct, dataStatus: 'local' } : null),
        priceMap: market?.priceMap || undefined,
        yields: yields && yields.length ? yields : undefined,
        approvals: approvalRead ? { unsafeCount: (approvalRead.needsAttention || []).length } : undefined,
        dailyVolumeUsd: dailyVolume.spentTodayUsd,
        wallet: { connected: walletRuntimeInfo.connected === true, canSign: walletRuntimeInfo.canSign === true },
        sessionLevel: level,
        now: Date.now()
      }
    });

    /* Ask the API only when there is something a browser cannot compute: a
       model label for an ambiguous sentence. Everything else stays local. */
    let merged = local;
    let serverStatus = 'not-asked';
    const ambiguous = !surface && local.classification?.confidence < 0.6 && String(text || '').trim().length > 12;
    if (ambiguous) {
      const res = await aiChat(text, { aiControl, prior: null });
      if (res?.ok && res.plan) {
        serverStatus = 'model-label-only';
        /* Merged fields are enumerated, not spread: the plan's numbers stay
           LOCAL by construction, so no response can move an amount. */
        merged = {
          ...local,
          plan: { ...local.plan, intent: res.plan.intent || local.plan.intent, source: res.plan.source || local.plan.source },
          serverPlanId: res.plan.id || null
        };
      } else {
        serverStatus = 'unavailable';
      }
    }
    if (stale()) return null;
    setServerMode(serverStatus);
    setDeck({
      at: Date.now(),
      reason,
      text: text || null,
      surface: merged.plan.surface || surface || null,
      plan: merged.plan,
      verdict: merged.verdict,
      stages: merged.stages.stages,
      thinking: merged.thinking.map((st) => ({ ...st, status: deckStageStatus(st, { market, yields }) })),
      market,
      yields,
      approvedAt: null,
      handoffNote: null,
      serverStatus
    });
    setDeckBusy(null);
    return merged;
  }

  /**
   * What one stage of the thinking rail may claim, given what came back.
   *
   * This is the difference between a progress animation and a report: every row
   * is answered from a real input, and a stage whose input did not arrive says
   * `unavailable` instead of `done`. No spinner is allowed to become a
   * conclusion. `strategy` stays `done` on purpose — the plan WAS built, from
   * the inputs it had, and the plan card is where the missing ones are listed.
   */
  function deckStageStatus(stage, { market = null, yields = null } = {}) {
    const id = stage?.id;
    if (id === 'understanding') return 'done';
    if (id === 'portfolio') return aiPortfolio?.holdings?.length ? 'done' : 'unavailable';
    if (id === 'market' || id === 'quote') return market?.dataStatus === 'live' ? 'done' : 'unavailable';
    if (id === 'yield') return yields && yields.length ? 'done' : 'unavailable';
    if (id === 'approvals') return Array.isArray(tokenApprovals) ? 'done' : 'unavailable';
    return 'done';
  }

  /** A quick action: pins the route, says it out loud in the thread, plans it. */
  function pickSurface(surfaceId) {
    const surface = AI_SURFACES.find((s) => s.id === surfaceId);
    if (!surface) return;
    setCcTab('command');
    const phrase = t(surface.promptKey, { defaultValue: surface.fallbackPrompt });
    runDeck({ text: phrase, surface: surfaceId, reason: 'quick-action' });
    sendText(phrase);
    award?.(null, 'deck');
  }

  /** A tool does the same, with the tool's own sentence. */
  function pickTool(tool) {
    if (!tool) return;
    setCcTab('command');
    const phrase = t(`intentAI.cc.tool.${tool.id}.phrase`, { defaultValue: AI_SURFACES.find((s) => s.id === tool.surface)?.fallbackPrompt || '' });
    runDeck({ text: phrase, surface: tool.surface, reason: `tool:${tool.id}` });
    sendText(phrase);
  }

  /**
   * Approve. The tap does NOT execute: it re-runs the firewall on the plan as
   * it stands now (the caps may have moved since the card painted) and, if the
   * verdict still allows it, turns the plan's first leg into an utterance the
   * existing confirmation path already understands. One execution path, one
   * gate, one signature — that is the whole design.
   */
  async function approveDeckPlan() {
    if (!deck?.plan) return;
    const walletInfo = describeWalletRuntime(walletRuntime || {});
    const verdict = aiValidateExecution(deck.plan, {
      aiControl,
      automations,
      dailyVolumeUsd: dailyVolume.spentTodayUsd,
      wallet: { connected: walletInfo.connected === true, canSign: walletInfo.canSign === true },
      sessionLevel: level
    });
    const stages = aiStageLedger(deck.plan, verdict, { wallet: { connected: walletInfo.connected === true } });
    if (!verdict.ok) {
      setDeck((prev) => ({ ...prev, verdict, stages: stages.stages, approveNote: verdict.reason }));
      return;
    }
    setDeck((prev) => ({ ...prev, verdict, stages: stages.stages, approvedAt: Date.now(), approveNote: 'approved' }));

    /* Tell the API, when it is there, so a plan held server-side records the
       same tap the user made here. Failure is silent on purpose: the local
       verdict already bound the plan, and a 500 on a bookkeeping call must not
       look like a failed approval. */
    if (deck.serverPlanId) {
      try { await aiApprovePlan(deck.serverPlanId, { aiControl, dailyVolumeUsd: dailyVolume.spentTodayUsd }); } catch { /* local verdict stands */ }
    }

    const utterance = deckHandoffUtterance(deck.plan);
    if (utterance) {
      setDeck((prev) => ({ ...prev, handoffNote: { kind: 'compose', utterance } }));
      setInput(utterance);
      sendText(utterance);
      return;
    }
    /* No sentence the parser can run: the leg belongs on a venue screen, so the
       hand-off is the route itself. Same hash write the chat navigation uses —
       the panel stays router-free because it also mounts headless. */
    const route = deck.plan.actions?.[0]?.handoffRoute || '/intent';
    setDeck((prev) => ({ ...prev, handoffNote: { kind: 'route', route } }));
    if (typeof window !== 'undefined') {
      try { window.location.hash = `#${route}`; } catch { /* stay put */ }
    }
  }

  /**
   * The one executable sentence a plan can produce.
   *
   * Built from the plan's own legs, using phrasings the parser is proven to
   * read (they mirror intentAI.examples.*). Anything the plan did not state —
   * an amount, the pair — is NOT filled in with a guess: with a leg that cannot
   * be spoken honestly, the deck hands off to the venue instead and says so.
   */
  function deckHandoffUtterance(plan) {
    const leg = (plan?.actions || [])[0];
    if (!leg) return null;
    const amount = Number(leg.amount);
    const chainShort = chainIdToName(leg.chainId);
    if (leg.type === 'SWAP') {
      const from = leg.fromSymbol || 'USDC';
      const to = leg.asset;
      if (!Number.isFinite(amount) || amount <= 0 || !to || to === from) return null;
      return `swap ${amount} ${from} to ${to}${chainShort ? ` on ${chainShort}` : ''}`;
    }
    if (leg.type === 'DEPOSIT') {
      if (!Number.isFinite(amount) || amount <= 0 || !leg.asset) return null;
      return `farm ${amount} ${leg.asset}${chainShort ? ` on ${chainShort}` : ''}`;
    }
    if (leg.type === 'STABLE_SHIELD') {
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return `lend ${amount} USDC${chainShort ? ` on ${chainShort}` : ''}`;
    }
    if (leg.type === 'FUTURES_OPEN') {
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return `open a ${leg.leverage || 2}x long on ${leg.asset || 'BTC'} perpetual with ${amount} USDT`;
    }
    return null;
  }

  function chainIdToName(chainId) {
    const id = Number(chainId);
    if (!Number.isFinite(id)) return null;
    return EVM_CHAINS[id]?.short || EVM_CHAINS[id]?.name || null;
  }

  /* ───────────────────── automations (local + API) ────────────────────── */

  function persistAutomations(next) {
    setAutomations(saveAutomations(next));
  }

  function acceptAutomation(automation) {
    if (!automation) return;
    const made = createAutomationRow(automation, { now: Date.now() });
    if (!made.ok) {
      setAutomationCode(made.code || 'AUTOMATION_INVALID');
      return;
    }
    setAutomationCode(null);
    persistAutomations(upsertAutomation(automations, made.automation).rows);
    setDeck((prev) => (prev ? { ...prev, automationAccepted: true } : prev));
    /* Best-effort mirror to the API; the local list is authoritative for this
       device, and a failure is not a reason to lose what the user just saved. */
    aiCreateAutomation(automation).catch(() => null);
  }

  function toggleAutomation(id, active) {
    persistAutomations(setAutomationActive(automations, id, active));
  }

  function deleteAutomation(id) {
    persistAutomations(removeAutomationRow(automations, id));
    aiDeleteAutomation(id).catch(() => null);
  }

  /* ─────────────────────────── AI control ─────────────────────────────── */

  function changeAiControl(next) {
    const clean = sanitizeAiControl(next);
    setAiControl(clean);
  }

  /**
   * The stop. Three things happen and all three are necessary: the session is
   * stopped (the existing fence on the assistant), the persisted kill flag is
   * written (so a refresh cannot undo it), and every automation is paused (so a
   * schedule cannot outlive the decision to stop). The API is told last, because
   * an unreachable API must not soften any of the first three.
   */
  function handleAiStop() {
    handleEmergencyStop();
    setAiControl((prev) => ({ ...prev, stopActive: true, stoppedAt: Date.now() }));
    writeStopFlag(true, { reason: 'ai-control' });
    persistAutomations(automations.map((r) => ({ ...r, active: false, stoppedAt: Date.now() })));
    aiEmergencyStop('ai-control').catch(() => null);
  }

  /**
   * One entry point for the autonomy level, whichever handle moved it.
   *
   * Setting `level` alone used to be possible (the setup accordion did exactly
   * that) while the AI-control box still read `manual` — so the box displayed a
   * mode the session was not in, and the firewall's number on screen was not
   * the number in force. Both values now move together, and the mode is
   * persisted with the level: reopening the page shows the state it is really
   * in, which is the difference between a control and a decoration.
   */
  function pickLevel(value) {
    const lvl = [1, 2, 3].includes(Number(value)) ? Number(value) : 1;
    const modeId = AI_MODES.find((m) => m.level === lvl)?.id || 'manual';
    setLevel(lvl);
    const next = sanitizeAiControl({ ...aiControl, mode: modeId });
    if (next.mode !== aiControl.mode) setAiControl(next);
  }

  function handleAiRelease() {
    setAiControl((prev) => ({ ...prev, stopActive: false, stoppedAt: null }));
    writeStopFlag(false);
    /* Deliberately does NOT re-arm anything: `active` stays false until the
       user switches a row back on, which is what makes pausing mean something. */
    aiReleaseEmergencyStop().catch(() => null);
  }

  function handleFinalConfirmWithBudget() {
    /*
     * The final confirm is the last door, so the budget is checked AT the door
     * and not only on the card: a user who approved a plan and then raised the
     * amount must meet the same limit. Two refusals are possible here — a stop
     * that was set while the screen was open, and a plan that would cross the
     * day's cap — and both say which one it was, with the way out.
     */
    if (aiControl.stopActive) {
      setReceipt({ status: 'blocked', confirmed: false, reasonKey: 'intentAI.cc.stop.refusedConfirm' });
      return;
    }
    const amount = Number(screen?.amountUsd);
    if (Number.isFinite(amount) && amount > 0) {
      const projected = dailyVolume.spentTodayUsd + amount;
      if (projected > aiControl.maxDailyUsd) {
        setReceipt({
          status: 'blocked',
          confirmed: false,
          reasonKey: 'intentAI.cc.budget.refusedConfirm',
          reasonParams: {
            spent: dailyVolume.spentTodayUsd,
            amount,
            cap: aiControl.maxDailyUsd
          }
        });
        recordHistory({ status: 'blocked', confirmed: false, reasonKey: 'AI_BUDGET_DAILY' });
        return;
      }
    }
    handleFinalConfirm();
  }

  /**
   * Voice input, where the browser has it. Transcription lands in the composer
   * UNsent, like every example chip: a mis-heard amount that auto-submits is
   * the worst possible failure of a microphone button.
   */
  const speechSupported = typeof window !== 'undefined'
    && (window.SpeechRecognition || window.webkitSpeechRecognition);
  function toggleDictation() {
    if (!speechSupported) return;
    if (listening) {
      try { speechRef.current?.stop(); } catch { /* already stopped */ }
      setListening(false);
      return;
    }
    try {
      const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new Ctor();
      rec.lang = i18n?.language === 'fa' ? 'fa-IR' : (i18n?.language || 'en-US');
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (event) => {
        const said = event?.results?.[0]?.[0]?.transcript || '';
        if (said.trim()) setInput((prev) => (prev ? `${prev} ${said}`.trim() : said.trim()));
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      speechRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  }


  /**
   * The plan's automation leg, turned into a storable row.
   *
   * Only the fields the plan actually carries are copied; `chainId` falls back
   * to the FIRST network the AI-control box allows rather than to a hard-coded
   * chain, so an automation saved from a plan can never name a network the user
   * has not opened.
   */
  function automationFromPlan(plan) {
    const leg = (plan?.actions || []).find((a) => a?.type === 'AUTOMATION_CREATE') || null;
    if (!leg) return null;
    return {
      kind: 'dca',
      asset: leg.asset || 'BTC',
      amountUsd: Number(leg.amount) > 0 ? Number(leg.amount) : null,
      cadence: ['daily', 'weekly', 'biweekly', 'monthly'].includes(leg.cadence) ? leg.cadence : 'weekly',
      chainId: (leg.chainId && aiControl.allowedChains.includes(Number(leg.chainId)))
        ? Number(leg.chainId)
        : (aiControl.allowedChains[0] ?? defaultChainId)
    };
  }

  /*
   * The panel is always "live". The earlier activation strip gated the whole
   * chat on `getIntentPublicStatus()` — a status endpoint that reports the
   * NETWORK's launch posture, not the chat's. The result was a panel telling
   * users "activation pending" while every analysis/preparation path worked.
   * Honesty about what can actually run lives where it belongs: in the
   * per-stage surfaces (venue health, the confirmation screen, the honest
   * receipt) — not in a banner that blocks the assistant itself.
   */
  const intentIsLive = true;

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

  const sessionIdentityRef = useRef({ mode, level });
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
    /*
     * The disappearing-conversation bug: this effect also depends on
     * externalAgentCatalog, which resolves asynchronously — SECONDS after the
     * user may already be several turns into the chat. Rebuilding the session
     * at that moment erased the whole thread (and any in-flight guided flow)
     * and looked exactly like "nothing works / the steps just vanished".
     *
     * A session rebuild is only honest when the AUTHORIZATION IDENTITY
     * changes (mode or level). A catalog refresh is not an identity change,
     * so in that case we patch the discovery payload into the live session
     * and keep every message, draft, gate and confirmation screen.
     */
    const identityChanged = sessionIdentityRef.current.mode !== mode || sessionIdentityRef.current.level !== level;
    sessionIdentityRef.current = { mode, level };
    if (identityChanged) {
      setSession(s);
      setGate(null); setRisk(null); setReceipt(null); setGateAction(null); setScreen(null);
      return;
    }
    setSession((prev) => (prev && prev.status !== 'BLOCKED' && s.status !== 'BLOCKED'
      ? { ...prev, externalAgentDiscovery: s.externalAgentDiscovery ?? prev.externalAgentDiscovery ?? null }
      : s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, mode, externalAgentCatalog]);

  /* Keep the newest message in view — a chat that hides the answer is broken. */
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages?.length]);

  /*
   * Phase 208 — the pending hash navigation after a page command. Kept as a
   * ref so an unmount (route change, test teardown) clears it instead of a
   * stale timer forcing a navigation nobody asked for any more.
   */
  const navTimerRef = useRef(null);

  /* A pending navigation timer never outlives the panel. */
  useEffect(() => () => {
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
  }, []);

  /*
   * First-open market brief: the panel greets the user WITH a market read
   * instead of an empty thread. Fires exactly once per mount. The phrase is
   * localized — the parser understands the market-analysis keywords in the
   * user's own language — and the pending reply is enriched with real
   * market data a beat later by sendText.
   */
  const autoBriefRef = useRef(false);
  useEffect(() => {
    if (autoBriefRef.current) return;
    autoBriefRef.current = true;
    sendText(t('intentAI.quick.phrase.marketBrief'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!value) return;
    /*
     * Phase 208 — a page request is answered AND performed. Checked before
     * the STOPPED gate on purpose: the session controls fence the
     * assistant's trading authority, never the user's way out of this
     * screen. Navigation grants nothing financial — the reply carries
     * canExecute: false and the Confirmation Gate is untouched.
     */
    const nav = parseNavigationCommand(value);
    if (nav.ok) {
      setSession((prev) => ({
        ...prev,
        messages: [...(prev?.messages || []), {
          role: 'assistant',
          type: 'navigation',
          payload: {
            target: nav.target,
            route: nav.route,
            labelKey: nav.labelKey,
            canExecute: false,
            financialExecutionAuthorized: false
          },
          ts: Date.now(),
          id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        }]
      }));
      /*
       * The page opens for real. A short beat lets the reply paint first.
       * The hash write is the ONLY navigation this panel performs, so a
       * headless mount (no Router) simply keeps the reply — no crash, no
       * import of react-router. On hash routers (see App.jsx) the write
       * triggers the route change to /intent.
       */
      if (typeof window !== 'undefined') {
        if (navTimerRef.current) clearTimeout(navTimerRef.current);
        navTimerRef.current = setTimeout(() => {
          navTimerRef.current = null;
          try { window.location.hash = `#${nav.route}`; } catch { /* stay on the chat */ }
        }, 300);
      }
      return;
    }
    if (session?.status === 'STOPPED') return;
    /*
     * Phase 205 — the teach/recall boundary, BEFORE the parser sees the text.
     * Teaching is explicit (a "remember:" / teach marker); the reply confirms
     * what was learned, and a recall lists it back. What the user teaches
     * also becomes the session's default chain when it names one.
     */
    const taught = parseTeachCommand(value);
    if (taught.ok) {
      const stored = rememberTaught(taught);
      setSession((prev) => ({
        ...prev,
        messages: [...(prev?.messages || []), {
          role: 'assistant',
          type: 'memory-learned',
          payload: {
            ok: stored.ok === true,
            text: taught.text,
            tag: taught.tag,
            total: stored.total ?? listTaught().length,
            secretRefused: false,
            canExecute: false
          },
          ts: Date.now(),
          id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        }]
      }));
      return;
    }
    if (taught.code === 'SECRET_REFUSED') {
      setSession((prev) => ({
        ...prev,
        messages: [...(prev?.messages || []), {
          role: 'assistant',
          type: 'memory-learned',
          payload: { ok: false, secretRefused: true, canExecute: false },
          ts: Date.now(),
          id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        }]
      }));
      return;
    }
    const memoryCommand = parseMemoryCommand(value);
    if (memoryCommand.ok) {
      const entries = listTaught();
      if (memoryCommand.command === 'forget') clearTaught();
      setSession((prev) => ({
        ...prev,
        messages: [...(prev?.messages || []), {
          role: 'assistant',
          type: 'memory-recall',
          payload: {
            command: memoryCommand.command,
            entries: memoryCommand.command === 'forget' ? [] : entries.map((e) => ({ text: e.text, tag: e.tag, at: e.createdAt })),
            cleared: memoryCommand.command === 'forget',
            localOnly: true,
            canExecute: false
          },
          ts: Date.now(),
          id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        }]
      }));
      return;
    }
    /* A taught chain becomes this session's default when the request has none. */
    const taughtDefault = listTaught().find((e) => taughtChainHint(e) != null);
    const effectiveDefaultChain = taughtChainHint(taughtDefault) || defaultChainId;
    const { session: after } = chatTurn({ ...session }, value, {
      defaultChainId: effectiveDefaultChain,
      locale: i18n.language,
      externalAgents: Array.isArray(externalAgentCatalog?.candidates) ? externalAgentCatalog.candidates : [],
      externalAgentsSource: externalAgentCatalog?.dataStatus === 'live' ? 'server-catalog' : 'unavailable',
      /* Phase 204 — the selected external agent participates in the turn. */
      externalAgentId: selectedExternalAgent?.passport?.id || null
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
      /* Phase 203 — a plan that reached the confirmation screen earns the
         app's points, once per plan (keyed by its terms hash). */
      award(last.payload?.termsHash || last.payload?.drafts?.[0]?.id || null, 'intentAiPlan');
      openInteractiveScreen(last.payload, after);
    } else if (last && last.type === 'next-step-ready') {
      openInteractiveScreen(last.payload, after);
    }

    /*
     * Deep market analysis: the reply went up synchronously with a pending
     * market block; the async enrichment now replaces it with real, sourced
     * numbers (or an honest unavailable). The user sees the answer instantly
     * and the market card fills in a beat later.
     */
    if (last?.type === 'analysis' && last?.payload?.marketAnalysis?.dataStatus === 'pending') {
      void enrichAnalysisReply(last);
    }
  }

  /**
   * Fill a pending market block with REAL, sourced market data. The message
   * is patched in place — and only if it is still part of the CURRENT
   * session: a mode/level switch rebuilds the session while the market
   * request is in flight, and a stale enrichment must never resurrect
   * messages that are no longer on screen.
   */
  async function enrichAnalysisReply(message) {
    let built = null;
    try {
      built = await buildChatMarketAnalysis({
        symbols: message.payload?.marketAnalysis?.requestedAssets || [],
        marketsSource: () => getMarkets({ page: 1, perPage: 250, vs: 'usd' }),
        /*
         * OHLC for the regime, NOT getChart. getChart falls back to the
         * offline snapshot, whose synthetic series is stamped with fresh
         * timestamps — passing that to the regime detector would fabricate
         * "fresh evidence". A dead OHLC feed returns [], which the detector
         * honestly reports as unavailable.
         */
        priceSource: ({ assetId, days }) => getOhlc(assetId, days)
      });
    } catch {
      built = null;
    }
    if (!built) return;
    setSession((prev) => {
      if (!prev?.messages?.some((m) => m.id === message.id)) return prev;
      return {
        ...prev,
        messages: prev.messages.map((m) => (
          m.id === message.id && m.payload?.marketAnalysis?.dataStatus === 'pending'
            ? { ...m, payload: { ...m.payload, marketAnalysis: built } }
            : m
        ))
      };
    });
  }

  /**
   * Append a decided receipt to the LOCAL history (localStorage only, never
   * a server). Best-effort: a full or unavailable storage must never break
   * the execution flow, so every failure is swallowed by recordIntentTx's
   * own guards and this wrapper.
   */
  function recordHistory(entry) {
    try {
      recordIntentTx({
        action: screen?.protocol || 'swap',
        fromSymbol: screen?.fromSymbol || null,
        toSymbol: screen?.toSymbol || null,
        amountUsd: Number(screen?.amountUsd) > 0 ? Number(screen.amountUsd) : null,
        chainId: screen?.chainId || null,
        ...entry
      });
    } catch { /* history is a convenience, never a gate */ }
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
      recordHistory({ status: 'rejected' });
      const res = executeConfirmed(session, { action: 'REJECT', draftId: screen?.draftId });
      setSession(res.session);
      return;
    }
    if (action === 'CANCEL') {
      setReceipt({ status: 'cancelled', confirmed: false });
      recordHistory({ status: 'cancelled' });
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
      recordHistory({
        status: 'queued',
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
        recordHistory({ status: explained.status || 'failed', reasonKey: explained.i18nKey });
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
    /* Consent is spent. The next execution must ask again. */
    setBroadcastOptIn(false);
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
      /*
       * Real broadcast — Phase 201, the fix for the reported dead end.
       *
       * Before this block existed in its current form, the panel "broadcast"
       * the MEV-shield envelope (chainId + deadline + slippage, no `to`, no
       * `data`) and — worse — only when a build flag that was never set
       * allowed it. Every confirmation therefore ended as
       * the "signed but never sent to the network" dead end, which is exactly what was reported.
       *
       * Now the REAL path runs, the same one /swap uses: live quote with the
       * fee verified on-chain, an exact-amount ERC-20 approval when needed,
       * and the swap transaction itself — signed in the wallet, twice
       * (EIP-712 authorization above, then the actual transaction here).
       *
       * Gates, all of which must hold:
       *   1. the build allows it ('false' in env is the kill-switch)
       *   2. the user opted in for THIS execution (checkbox, resets after)
       *   3. the wallet is genuinely connected and can sign
       *   4. the draft kind has a real executable venue (swap today)
       *
       * A failure is never a success: the receipt keeps the honest
       * `authorized` status and states exactly why nothing was sent.
       */
      let realTxHash = result.txHash || null;
      let broadcastChainId = Number(activeGate?.lockedTerms?.chainId) || null;
      let broadcastFailure = null;
      const broadcastReady = broadcastEnabled(import.meta.env || {});
      /*
       * The DRAFT's own kind decides what the bridge may send — never
       * draftKind(activeGate), which collapses every non-futures leg into
       * 'swap' and would have let a lend/borrow draft reach the swap router.
       */
      const activeDraft = (base.drafts || []).find((d) => d.id === screen?.draftId)
        || (base.drafts || []).at(-1)
        || null;
      const broadcastKind = activeDraft?.kind || draftKind(activeGate);
      const kindExecutable = typeof broadcastSupportedKind === 'function'
        ? broadcastSupportedKind(broadcastKind) === true
        : broadcastKind === 'swap';
      if (!realTxHash && broadcastReady && broadcastOptIn && wallet.canSign) {
        const gateOk = assertBroadcastAllowed({ env: import.meta.env || {}, userOptIn: true });
        if (!gateOk.ok) {
          broadcastFailure = { code: 'BROADCAST_DISABLED_IN_BUILD', message: gateOk.error?.detail || 'BROADCAST_DISABLED' };
        } else if (typeof executeIntentBroadcast !== 'function') {
          broadcastFailure = { code: 'NO_BROADCAST_BRIDGE', message: 'No broadcast bridge is wired into this surface.' };
        } else if (!kindExecutable) {
          broadcastFailure = { code: 'VENUE_NOT_EXECUTABLE', message: broadcastKind };
        } else {
          const sent = await executeIntentBroadcast({
            kind: broadcastKind,
            chainId: activeGate?.lockedTerms?.chainId,
            fromSymbol: activeGate?.lockedTerms?.fromSymbol,
            toSymbol: activeGate?.lockedTerms?.toSymbol,
            amountIn: activeGate?.lockedTerms?.amountIn,
            amountUsd: screen?.amountUsd ?? null,
            slippagePct: activeGate?.lockedTerms?.slippagePct
          });
          /* Only a real 32-byte hash counts; anything else stays authorized. */
          if (sent?.ok && sent.txHash) {
            realTxHash = sent.txHash;
            if (Number.isFinite(Number(sent.chainId))) broadcastChainId = Number(sent.chainId);
            /* Phase 203 — reaching a network for real is the valuable event. */
            award(sent.txHash, 'intentAiExecuted');
          } else if (sent && sent.ok !== true) {
            broadcastFailure = { code: sent.code || 'EXECUTION_FAILED', message: sent.message || '' };
          }
        }
      }
      const finalStatus = rec.receipt?.status === 'COMPLETED' && realTxHash
        ? 'completed'
        : realTxHash ? 'submitted' : 'authorized';
      /* Why nothing was sent — named, never silent. The opt-in is the most
         common honest stop; a broadcast failure is named by its own code. */
      const stopReasonKey = realTxHash
        ? null
        : broadcastFailure
          ? `intentAI.broadcastFail.${broadcastFailure.code === 'VENUE_NOT_EXECUTABLE' ? 'venue' : 'error'}`
          : broadcastOptIn
            ? 'intentAI.receipt.awaitingBroadcast'
            : 'intentAI.receipt.broadcastDisabled';
      setReceipt({
        status: finalStatus,
        confirmed: rec.receipt?.confirmed === true && Boolean(realTxHash),
        venue: health.venue || null,
        receipt: settled.ok ? settled.receipt : rec.receipt,
        fee: feeQuote?.ok ? feeQuote : null,
        txHash: realTxHash,
        txChainId: broadcastChainId,
        signerKind: result.signerKind || null,
        /* Explain the stop rather than leaving a silent dead end. */
        reasonKey: stopReasonKey,
        reasonParams: broadcastFailure ? { code: broadcastFailure.code, message: broadcastFailure.message, kind: broadcastFailure.message } : {},
        broadcastCode: broadcastFailure?.code || null,
        ok: true
      });
      /* The local history remembers the DECISION (with its real hash when
         one exists), so a phone can answer "what did I just approve?" */
      recordHistory({
        status: finalStatus,
        confirmed: rec.receipt?.confirmed === true && Boolean(realTxHash),
        txHash: realTxHash,
        signerKind: result.signerKind || null,
        feeAmount: feeQuote?.ok ? feeQuote.feeAmount : null,
        feeSymbol: feeQuote?.ok ? feeQuote.symbol : null,
        reasonKey: stopReasonKey
      });
      /* A real hash is tracked to its terminal state — submitted →
         confirmed/failed — with the chain as the only source of truth. */
      if (realTxHash && typeof trackIntentTx === 'function') {
        void (async () => {
          const poll = async (attempt) => {
            const observed = await trackIntentTx({ txHash: realTxHash, chainId: broadcastChainId });
            if (!observed) return;
            if (observed.status === 'pending' && attempt < 20) {
              setTimeout(() => void poll(attempt + 1), 6000);
              return;
            }
            setReceipt((prev) => (prev?.txHash === realTxHash
              ? {
                ...prev,
                status: observed.status === 'confirmed' ? 'completed' : observed.status === 'failed' ? 'failed' : prev.status,
                confirmed: observed.status === 'confirmed'
              }
              : prev));
          };
          void poll(0);
        })();
      }
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
    recordHistory({
      status: result.reauthoriseRequired ? 'reauthorize' : (explained.status || 'failed'),
      reasonKey: explained.i18nKey
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
      {/*
        ✦ FBT AI — the header of a Command Center, not of a feature list.
        Two things a person needs before they read anything else: is this
        assistant live right now, and what is it asking me. The live pill is
        derived from the SAME connection + activation read as the status strip at
        the bottom, so the header can never claim "Live" while the strip says
        offline.
      */}
      <header className="ia-cc-head">
        <div className="ia-cc-title">
          <span className="ia-cc-glyph" aria-hidden="true">✦</span>
          <div>
            <h2 className="ia-cc-name">{t('intentAI.cc.title', { defaultValue: 'FBT AI' })}</h2>
            <p className="ia-cc-ask">{t('intentAI.cc.ask', { defaultValue: 'What do you want to do?' })}</p>
          </div>
        </div>
        <div className="ia-cc-head-side">
          <span className={`ia-cc-live${connection.online && intentIsLive && !aiControl.stopActive ? ' is-on' : ''}`} data-testid="ai-live-pill" data-online={connection.online ? 'true' : 'false'} data-stopped={aiControl.stopActive ? 'true' : 'false'}>
            <span className="ia-cc-live-dot" aria-hidden="true" />
            {aiControl.stopActive
              ? t('intentAI.cc.live.stopped', { defaultValue: 'Stopped' })
              : connection.online
                ? t('intentAI.cc.live.on', { defaultValue: 'Live' })
                : t('intentAI.cc.live.off', { defaultValue: 'Offline' })}
          </span>
          {/* Phase 203 — the assistant's own points, same total as /rewards. */}
          <a className="ia-points-chip" href="#/rewards" data-testid="intent-ai-points" title={t('intentAI.points.title', { defaultValue: 'Your Intent AI points' })}>
            <span aria-hidden="true">✦</span>
            <b>{Number(points || 0).toLocaleString()}</b>
            <small>{t('intentAI.points.unit', { defaultValue: 'pts' })}</small>
          </a>
        </div>
      </header>
      {/*
        The parser/version/analysis-only strapline that used to sit here was
        removed on the owner's request: it repeated in build-log language what
        the mission strip below already says in plain words.
      */}
      {/*
        Phase 206 — the mission, stated where neither the user nor the AI can
        lose it. Reported as: the AI forgot why it exists for this app:
        the assistant never said what it exists FOR, so long sessions drifted
        into small talk. This line is the contract: turn a plain-language
        goal into a checked, user-confirmed action — never move money alone.
      */}
      <div className="ia-mission" data-testid="intent-ai-mission" role="note">
        <span aria-hidden="true">✦</span>
        <small>{t('intentAI.mission')}</small>
      </div>
      {/* The transient "+N" right after an award, so the source of the points
          is visible where they were earned. */}
      {lastGain && (
        <div className="ia-points-gain" data-testid="intent-ai-points-gain" key={lastGain.at}>
          {t('intentAI.points.gained', { n: lastGain.amount })}
        </div>
      )}
      {/*
        ─── ASK FBT ─────────────────────────────────────────────────────────
        The composer, moved to the top because this is the door everything else
        hangs from. It is ONE form, not a copy: the thread, the guided flow, the
        quick replies and the confirmation screen all read the same `input`
        state, so there is no second box that could drift out of sync with the
        conversation.

        The microphone transcribes INTO the composer and stops there, exactly
        like an example chip does. Nothing a user dictates is sent without their
        own tap — a mis-heard amount that auto-submits is the one failure mode a
        voice button on a wallet must not have.
      */}
      <form onSubmit={handleSend} className="ia-composer ia-cc-composer" data-testid="ai-ask-box">
        <span className="ia-cc-composer-glyph" aria-hidden="true">✦</span>
        <input
          ref={inputRef}
          placeholder={t('intentAI.cc.askPlaceholder', { defaultValue: 'Ask FBT anything — “5000 USDC, medium risk, 3 months”' })}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={session?.status === 'STOPPED'}
          aria-label={t('intentAI.cc.askPlaceholder', { defaultValue: 'Ask FBT anything' })}
        />
        <button
          type="button"
          className={`ia-cc-mic${listening ? ' is-listening' : ''}`}
          onClick={toggleDictation}
          disabled={!speechSupported}
          aria-pressed={listening}
          title={speechSupported
            ? t('intentAI.cc.mic.title', { defaultValue: 'Dictate your request' })
            : t('intentAI.cc.mic.unsupported', { defaultValue: 'This browser has no speech input — type instead' })}
          data-testid="ai-mic"
          data-supported={speechSupported ? 'true' : 'false'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v4" />
          </svg>
          <span className="ia-cc-mic-label">{listening ? t('intentAI.cc.mic.listening', { defaultValue: 'listening…' }) : t('intentAI.cc.mic.idle', { defaultValue: 'voice' })}</span>
        </button>
        <button type="submit" className="ia-send" disabled={!input.trim() || session?.status === 'STOPPED'}>
          {t('intentAI.cc.askSend', { defaultValue: 'Ask AI' })}
        </button>
        {level >= 2 && (
          <button type="button" className="ia-ctl ia-danger" onClick={handleEmergencyStop} title={t('intentAI.stop.title')}>
            {t('intentAI.stop.button')}
          </button>
        )}
      </form>

      {/* The five doors. Agents stay behind them (see AiAgentLanes). */}
      <AiQuickActions
        t={t}
        onPick={pickSurface}
        activeSurface={deck?.surface || null}
        busy={Boolean(deckBusy)}
      />
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

          {/*
            Wallet connection state — WITHOUT a connected wallet the final
            confirm can never be signed, so the only receipt it can produce is
            "wallet signature required". Say that BEFORE the click, with the
            way to fix it, instead of letting the user discover a dead end.
            Plain anchor: this panel also mounts headless in the test suite,
            where a Router-dependent wallet sheet would crash.
          */}
          {!wallet.connected && (
            <div className="ia-wallet-missing" data-testid="wallet-missing">
              <span className="ia-wallet-missing-dot" aria-hidden="true" />
              <div className="ia-wallet-missing-body">
                <strong>{t('intentAI.wallet.missingTitle', { defaultValue: 'No wallet is connected' })}</strong>
                <small>{t('intentAI.wallet.missingBody', { defaultValue: 'Signing and final authorization need your wallet. Analysis and preparation keep working without it.' })}</small>
              </div>
              <a className="ia-wallet-connect-link" href="#/wallet">
                {t('intentAI.wallet.connectNow', { defaultValue: 'Connect wallet' })}
              </a>
            </div>
          )}

          {/*
            Broadcast consent. Only rendered when the build actually permits
            sending, so a deployment that cannot broadcast never shows a
            control implying it can. Consent is per-execution and resets after
            every run.
          */}
          {broadcastEnabled(import.meta.env || {}) && (
            <div className="ia-broadcast-box" data-testid="broadcast-opt-in-box">
              <label className="ia-broadcast-optin" data-testid="broadcast-opt-in">
                <input
                  type="checkbox"
                  checked={broadcastOptIn}
                  onChange={(e) => setBroadcastOptIn(e.target.checked)}
                />
                <span>{t('intentAI.broadcast.optIn')}</span>
              </label>
              <small className="ia-hint" data-testid="broadcast-opt-in-hint">
                {t('intentAI.broadcast.hint', {
                  defaultValue: 'After «confirm», your wallet asks once more and the transaction goes to the network for real.'
                })}
              </small>
            </div>
          )}

          <div className="ia-controls" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="ia-ctl ia-go"
              disabled={confirmBlocked}
              /* The AI budget is checked AT the door (see
                 handleFinalConfirmWithBudget): a plan approved under one amount
                 and then edited on this screen to another must meet the cap
                 again, and a stop raised while this screen was open must
                 actually stop it. */
              onClick={handleFinalConfirmWithBudget}
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
          {/* Phase 90/201 — the fee line is honest about whether anything was
              actually collected: with a real on-chain transaction the router
              took it; without one it only ever existed on the preview. The
              old wording said "fee collected" on a run that sent nothing. */}
          {receipt.fee?.ok && (
            <p className="faint" style={{ fontSize: 11.5, margin: '4px 0 0' }} data-testid="receipt-fee-line">
              {t(receipt.txHash ? 'intentAI.fee.onReceipt' : 'intentAI.fee.quotedOnly', {
                amount: receipt.fee.feeAmount,
                symbol: receipt.fee.symbol || '',
                percent: receipt.fee.percent
              })}
            </p>
          )}
          {receipt.txHash && (
            <p className="faint" style={{ fontSize: 11.5, margin: '4px 0 0' }} data-testid="receipt-tx-hash">
              {t('intentAI.receipt.txHash', { hash: receipt.txHash })}
              {typeof explorerUrl === 'function' && receipt.txChainId && (
                <>
                  {' · '}
                  <a
                    className="ia-explorer-link"
                    href={explorerUrl({ txHash: receipt.txHash, chainId: receipt.txChainId })}
                    target="_blank"
                    rel="noreferrer noopener"
                    data-testid="receipt-explorer-link"
                  >
                    {t('intentAI.receipt.viewOnExplorer', { defaultValue: 'view on explorer' })}
                  </a>
                </>
              )}
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

      {rampNotice?.applies && (
        <div className="ia-ramp-notice" role="note" data-testid="fiat-ramp-notice">
          <p className="muted" style={{ fontSize: 12, margin: '0 0 4px' }}>{t('intentAI.ramp.title')}</p>
          <p style={{ fontSize: 12.5, margin: 0 }} data-testid="fiat-ramp-message">
            {t(rampNotice.i18nKey)}
          </p>
          <small className="ia-hint" data-testid="fiat-ramp-alternative">
            {t(rampNotice.alternativeI18nKey)}
          </small>
          <a className="btn btn-ghost btn-sm" href="#/buy" data-testid="fiat-ramp-open-buy-sell">
            {t('intentAI.ramp.openBuySell')}
          </a>
        </div>
      )}

      {/*
        ─── THE DECK ────────────────────────────────────────────────────────
        Three tabs on ONE screen — nothing here is a route, and nothing here is
        hidden from the panel's mount: the assistant, its thread and its
        confirmation surface stay visible above, so switching tabs can never hide
        a safety state (that is why the session-setup accordion, the stopped
        notice and the receipt live outside this switch).
      */}
      <nav className="ia-cc-tabs" role="tablist" aria-label={t('intentAI.cc.tabs.title', { defaultValue: 'AI command center' })} data-testid="ai-cc-tabs">
        {[
          { id: 'command', key: 'intentAI.cc.tabs.command', fallback: 'Command' },
          { id: 'automate', key: 'intentAI.cc.tabs.automate', fallback: 'Automations', badge: automationTotals(automations).active },
          { id: 'control', key: 'intentAI.cc.tabs.control', fallback: 'AI control', badge: null }
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={ccTab === tab.id}
            className={`ia-cc-tab${ccTab === tab.id ? ' is-on' : ''}`}
            onClick={() => setCcTab(tab.id)}
            data-testid={`ai-tab-${tab.id}`}
          >
            {t(tab.key, { defaultValue: tab.fallback })}
            {tab.badge ? <span className="ia-cc-tab-badge" data-testid={`ai-tab-badge-${tab.id}`}>{tab.badge}</span> : null}
          </button>
        ))}
      </nav>

      {ccTab === 'command' && (
        <div className="ia-cc-deck" data-testid="ai-deck-command">
          <AiThinkRail t={t} stages={deck?.thinking || []} busy={deckBusy ? { index: deckBusy.index } : null} />
          <AiPortfolioCard
            t={t}
            snapshot={snapshot}
            onReview={() => { if (typeof window !== 'undefined') window.location.hash = '#/portfolio'; }}
            onPlan={() => runDeck({ text: t('intentAI.cc.quick.plan.phrase', { defaultValue: 'build me a plan for my money over the next 90 days' }), surface: 'plan', reason: 'portfolio-card' })}
          />
          <AiToolGrid t={t} onPick={pickTool} busy={Boolean(deckBusy)} />
          {/*
            The plan card is the answer to a question, so it only exists once a
            question has been asked. The first paint of the page runs the SAME
            orchestrator with no message (that is what fills the portfolio read
            and the market stage honestly) — but printing "YOUR AI PLAN" with a
            blocked verdict on an empty page would present a refusal to someone
            who has not requested anything yet.
          */}
          {deck?.plan && deck.reason !== 'open' && (
          <AiPlanCard
            t={t}
            plan={deck?.plan || null}
            verdict={deckView?.verdict || null}
            stages={deckView?.stages || []}
            busy={Boolean(deckBusy)}
            automationProposal={deck?.plan?.intent === 'AUTOMATION' && deck?.plan?.actions?.[0]?.type === 'AUTOMATION_CREATE'
              ? { ok: !deck.automationAccepted, automation: automationFromPlan(deck.plan) }
              : null}
            onAcceptAutomation={acceptAutomation}
            onApprove={approveDeckPlan}
            savedLabel={deck?.handoffNote?.kind === 'route'
              ? t('intentAI.cc.plan.openedVenue', { route: deck.handoffNote.route, defaultValue: `Opened ${deck.handoffNote.route} — the plan runs there, and your wallet confirms it.` })
              : deck?.approvedAt
                ? t('intentAI.cc.plan.approvedNote', { defaultValue: 'Approved. The confirmation screen above is the next step; the signature is yours.' })
                : null}
          />
          )}
          <AiAgentLanes t={t} plan={(deck?.plan && deck.reason !== 'open') ? deck.plan : null} />
          {snapshot?.execution?.emergencyStop && (
            <p className="ia-cc-stopped" role="status" data-testid="ai-deck-stopped">
              {t('intentAI.cc.deck.stoppedNote', { defaultValue: 'Stopped from AI control: plans are still built so you can read them, nothing can be approved.' })}
            </p>
          )}
        </div>
      )}

      {ccTab === 'automate' && (
        <div className="ia-cc-deck" data-testid="ai-deck-automate">
          <AiAutomations
            t={t}
            rows={automations}
            totals={automationTotals(automations)}
            spendTodayUsd={automationSpendToday(automations).usd}
            onCreate={(draft) => {
              const made = createAutomationRow({ ...draft, chainId: draft?.chainId ?? aiControl.allowedChains[0] ?? defaultChainId }, { now: Date.now() });
              if (!made.ok) { setAutomationCode(made.code || 'AUTOMATION_INVALID'); return; }
              setAutomationCode(null);
              persistAutomations(upsertAutomation(automations, made.automation).rows);
              aiCreateAutomation(draft).catch(() => null);
            }}
            busy={Boolean(deckBusy)}
            lastCode={automationCode}
            onToggle={toggleAutomation}
            onDelete={deleteAutomation}
          />
        </div>
      )}

      {ccTab === 'control' && (
        <div className="ia-cc-deck" data-testid="ai-deck-control">
          <AiControlPanel
            t={t}
            aiControl={aiControl}
            onChange={changeAiControl}
            onStop={handleAiStop}
            onRelease={handleAiRelease}
            usage={{ spentTodayUsd: dailyVolume.spentTodayUsd }}
            level={level}
            automationsActive={automationTotals(automations).active}
            serverState={serverMode}
          />
        </div>
      )}


      {/*
        Session setup — mode, level and the authorization boundary — folds
        into ONE accordion. On a phone these three blocks pushed the actual
        chat below the fold; the user opens them when configuring and keeps
        them closed while talking. Safety surfaces (session controls,
        emergency stop, the receipt) always stay visible.
      */}
      <details className="ia-setup">
        <summary className="ia-setup-summary">
          <span className="ia-setup-summary-text">{t('intentAI.setup.title', { defaultValue: 'Session setup — mode, level, authorization' })}</span>
          <span className="ia-setup-caret" aria-hidden="true">⌄</span>
        </summary>

        <div className="ia-setup-body">

      <section className="ia-setup-card is-mode">
        <header className="ia-setup-card-head">
          <p className="ia-setup-card-title">{t('intentAI.mode.title', { defaultValue: 'Primary mode' })}</p>
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
        </header>
        {/* Real mode selector: each chip carries the mode's actual participants
            from MODE_DEFINITIONS, and switching rebuilds the session boundary. */}
        {/*
          One line, scrollable. The three modes used to be a 3-column grid that
          collapsed to a single column under 460px — three stacked cards, and
          the third one pushed the boundary note and everything below it past
          the fold. As a rail they stay side by side on every screen width and
          the row can never widen the page.
        */}
        <ScrollRail
          className="ia-modes"
          ariaLabel={t('intentAI.mode.title', { defaultValue: 'Primary mode' })}
        >
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
        </ScrollRail>

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
              <div className="ia-ext-list" data-testid="external-agent-list">
                {session.externalAgentDiscovery.candidates.length === 0 ? (
                  <small className="ia-note">{t('intentAI.external.empty')}</small>
                ) : session.externalAgentDiscovery.candidates.slice(0, 4).map((candidate) => {
                  const isSelected = selectedExternalAgent?.passport?.id === candidate.passport.id;
                  const canJoin = candidate.eligibleForAnalysis === true;
                  return (
                    <div key={candidate.passport.id} className={`ia-ext-row${isSelected ? ' selected' : ''}`}>
                      <b>{candidate.passport.name}</b>
                      <span className={`ia-ext-badge ${candidate.matches ? 'ok' : 'no'}`}>
                        {candidate.matches ? t('intentAI.external.compatible') : t('intentAI.external.incompatible')}
                      </span>
                      <span className="ia-ext-badge dim">
                        {candidate.score == null ? t('intentAI.external.scoreWithheld') : `${candidate.score}/100`}
                      </span>
                      <span className="ia-ext-badge dim">{candidate.trustStatus}</span>
                      {canJoin && (
                        <button
                          type="button"
                          className={`ia-ctl ia-ext-join${isSelected ? ' on' : ''}`}
                          onClick={() => setExternalAgentChoice(isSelected ? null : candidate.passport.id)}
                          aria-pressed={isSelected}
                          data-testid={`external-agent-join-${candidate.passport.id}`}
                        >
                          {isSelected ? t('intentAI.external.joined', { defaultValue: 'participating' }) : t('intentAI.external.join', { defaultValue: 'join' })}
                        </button>
                      )}
                    </div>
                  );
                })}
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

        <p className="ia-setup-note">
          {t('intentAI.mode.boundary', { defaultValue: 'Analysis and preparation never authorize financial execution. Every execution requires a separate authorization screen.' })}
        </p>
      </section>

      {/*
        Autonomy level. Three bare "L1" chips said nothing about what
        the levels mean, and they were plain `.chip` — a different visual
        language from the glass controls two blocks below. Each level now
        carries the same glyph the Intent OS rail uses, so the two screens read
        as one product.
      */}
      <section className="ia-setup-card is-level">
        <header className="ia-setup-card-head">
          <p className="ia-setup-card-title">{t('intentAI.policy.level', { defaultValue: 'Level' })}</p>
          <span className="ia-setup-card-value">{t(`intentAI.levels.${(LEVELS.find((L) => L.value === level) || LEVELS[0]).key}`)}</span>
        </header>
        <div className="ia-level-row">
          <div className="ia-levels" role="group" aria-label={t('intentAI.policy.level', { defaultValue: 'Level' })}>
            {LEVELS.map((L) => {
              const isCurrent = level === L.value;
              return (
                <button
                  key={L.key}
                  type="button"
                  className={`ia-level${isCurrent ? ' is-current' : level > L.value ? ' is-below' : ''}`}
                  onClick={() => pickLevel(L.value)}
                  aria-pressed={isCurrent}
                  data-testid={`intent-ai-level-${L.value}`}
                >
                  <span className="ia-level-icon" aria-hidden="true"><AutonomyLevelIcon level={L.value} size={14} /></span>
                  <b>{`L${L.value}`}</b>
                  <small>{t(`intentAI.levels.${L.key}`)}</small>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="ia-setup-card is-auth">
        <header className="ia-setup-card-head">
          <p className="ia-setup-card-title">{t('intentAI.authorization.title', { defaultValue: 'Authorization boundary' })}</p>
          <span className="ia-setup-card-value">{session?.modeLabel || MODE_LABELS[mode]}</span>
        </header>
        {/*
          The boundary was three loose spans with inline colours and a bare
          "✓"/"!" as its only iconography, wrapping onto as many lines as the
          translation happened to need. It is now three rows of the same shape
          — a state glyph, a label, a verdict — so the one that is off can be
          found without reading all three.
        */}
        <div className="ia-auth-list">
          <div className="ia-auth-item is-ok">
            <span className="ia-auth-mark" aria-hidden="true">✓</span>
            <span className="ia-auth-name">{t('intentAI.authorization.analysis', { defaultValue: 'Analysis allowed' })}</span>
            <span className="ia-auth-value">{t('intentAI.authorization.available', { defaultValue: 'available' })}</span>
          </div>
          <div className={`ia-auth-item${level >= 2 ? ' is-ok' : ' is-off'}`}>
            <span className="ia-auth-mark" aria-hidden="true">{level >= 2 ? '✓' : '·'}</span>
            <span className="ia-auth-name">{t('intentAI.authorization.preparation', { defaultValue: 'Preparation' })}</span>
            <span className="ia-auth-value">{level >= 2 ? t('intentAI.authorization.available', { defaultValue: 'available' }) : t('intentAI.authorization.off', { defaultValue: 'off' })}</span>
          </div>
          <div className={`ia-auth-item${session?.authorization?.financialExecution ? ' is-ok' : ' is-warn'}`}>
            <span className="ia-auth-mark" aria-hidden="true">!</span>
            <span className="ia-auth-name">{t('intentAI.authorization.execution', { defaultValue: 'Financial execution' })}</span>
            <span className="ia-auth-value">{session?.authorization?.financialExecution ? t('intentAI.authorization.authorized', { defaultValue: 'authorized for this action' }) : t('intentAI.authorization.screenRequired', { defaultValue: 'authorization screen required' })}</span>
          </div>
        </div>

        {/*
          Session controls, in ONE line. `flex-wrap: wrap` here meant the row
          became a two- or three-line staircase on a narrow phone, and on the
          widest screens the fifth button sat where nobody looking for a stop
          would expect it. As a rail the order is stable at every width and the
          row scrolls instead of growing.
        */}
        <div className="ia-setup-subhead">
          <span>{t('intentAI.controls.title', { defaultValue: 'Session controls' })}</span>
        </div>
        <ScrollRail
          className="ia-controls"
          ariaLabel={t('intentAI.controls.title', { defaultValue: 'Session controls' })}
        >
          {CONTROL_ORDER.map((action) => (
            <button
              key={action}
              type="button"
              className={`ia-ctl ${CONTROL_VARIANTS[action] || ''}`}
              onClick={() => handleControl(action)}
              title={t(`intentAI.controls.${action.toLowerCase()}`, { defaultValue: action.replace('_', ' ') })}
            >
              <ControlIcon action={action} />
              {t(`intentAI.controls.${action.toLowerCase()}`, { defaultValue: action.replace('_', ' ') })}
            </button>
          ))}
        </ScrollRail>
      </section>
        </div>
      </details>

      {session?.status === 'STOPPED' && (
        <p className="notice ia-notice" data-testid="intent-ai-stopped-notice">
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

      {/*
        Practical prompt examples. Presented as a real card — a header that
        says what the box is FOR, one panel per venue with its own glyph, and
        each example as a full-width row that reads like a sentence you could
        say out loud. Tapping still only FILLS the composer: the user edits and
        sends, so an example can never become an unreviewed instruction.
      */}
      <details className="ia-examples">
        <summary className="ia-examples-summary">
          <span className="ia-examples-glyph" aria-hidden="true">✦</span>
          <span className="ia-examples-heading">
            <b>{t('intentAI.examples.title')}</b>
            <small>{t('intentAI.examples.subtitle', { defaultValue: 'Ready-made sentences the assistant understands — tap one, edit it, send it.' })}</small>
          </span>
          <span className="ia-examples-caret" aria-hidden="true">⌄</span>
        </summary>
        <div className="ia-examples-grid">
          {EXAMPLE_GROUPS.map((group) => (
            <div key={group.id} className="ia-example-group">
              <p className="ia-example-group-head">
                <span className="ia-example-group-glyph" aria-hidden="true">{group.glyph}</span>
                <span className="ia-example-group-title">{t(`intentAI.examples.${group.id}.title`)}</span>
              </p>
              <div className="ia-example-list">
                {[1, 2, 3].map((n) => {
                  const text = t(`intentAI.examples.${group.id}.e${n}`);
                  if (!text || text.startsWith('intentAI.')) return null;
                  return (
                    <button key={n} type="button" className="ia-example-chip" onClick={() => useExample(text)}>
                      <span className="ia-example-text">{text}</span>
                      <span className="ia-example-go" aria-hidden="true">↵</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="ia-examples-foot">
          {t('intentAI.examples.hint', { defaultValue: 'A tap only fills the composer — nothing is sent and nothing moves until you send it and confirm.' })}
        </p>
      </details>

      {/*
        Owner decision — the pipeline stage rail (intent · verification ·
        cross-chain) and the quick-action chip row (swap / market brief /
        futures / lend / goal / Intent OS) that used to sit above the chat are
        removed. Both were shortcuts into things the user can simply ask for in
        the composer, and they pushed the actual conversation below the fold.
        The guided examples accordion above and the section links below remain
        the reachable paths; the localized market-brief phrase still fires once
        on open (see autoBriefRef).
      */}

      {/*
        Phase 206 — the rest of the app, ONE row away. Reported as
        "connect to every option" / "no connection between options": the assistant
        lived on an island; the wallet, stocks, futures, loans, farm and
        points screens were all one handoff away but nothing linked to them.
        Every chip is a plain anchor to a real route (see App.jsx) — and the
        parser knows the same words, so "farm" in chat and this chip land on
        the same screen. The row is live again after an unterminated JSX
        comment once swallowed it together with the chat thread.
      */}
      <div className="ia-section-links">
        {[
          { href: '#/wallet', key: 'wallet' },
          { href: '#/stocks', key: 'stocks' },
          { href: '#/perp', key: 'futures' },
          { href: '#/loan', key: 'loan' },
          { href: '#/farm', key: 'farm' },
          { href: '#/rewards', key: 'points' }
        ].map((section) => (
          <a key={section.key} className="ia-chip ia-section-chip" href={section.href}>
            {t(`intentAI.sections.${section.key}`)}
          </a>
        ))}
      </div>

      {/* Interactive confirmation screen: edit values, set tool permissions,
          then confirm — or answer in chat. */}
      {/* Honest receipt */}
      {/* Phase 88 — the honest fiat boundary. Shown when the user asked us to
          move real money, which we do not do, with what we CAN do next to it. */}
      {/*
        Phase 94/207 — connection + activation, ONE compact strip instead of
        two stacked banners (reported: the page-clutter bug). The offline testid
        stays: the panel probe reads it. Offline says nothing was sent; a
        waiting queue says how many intents are parked, never that any of
        them ran. Activation stays read-only — wallet confirmation remains
        the final user-controlled step.
      */}
      <div
        className={`ia-connection${connection.online ? ' is-online' : ''}`}
        role="status"
        data-testid="offline-status"
        data-online={connection.online ? 'true' : 'false'}
      >
        <span className="ia-connection-dot" aria-hidden="true" />
        <small>{t(connection.i18nKey, { count: connection.queued })}</small>
        <span className="ia-connection-sep" aria-hidden="true">·</span>
        <span className="ia-activation-state-dot" aria-hidden="true" />
        <small>{intentIsLive
          ? t('intentAI.readiness.active', { defaultValue: 'System Active & Verified' })
          : t('intentAI.readiness.pending', { defaultValue: 'Operational activation pending verification' })}</small>
        {intentIsLive && (
          <small className="ia-hint">
            {t('intentAI.readiness.executionReady', { defaultValue: 'Execution Ready — wallet confirmation remains required.' })}
          </small>
        )}
        {connection.queued > 0 && (
          <small className="ia-hint" data-testid="offline-queue-note">{t('intentAI.offline.reviewNote')}</small>
        )}
      </div>

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
    /*
     * Phase 202 — the AI↔AI conversation, rendered as an actual transcript.
     * Each line is one agent speaking, with the real data behind it (the
     * proposal, the independent challenge, the council vote, the gate). The
     * lines carry no authority: `socialMessagesAreNonExecutable`.
     */
    const DIALOGUE_SPEAKERS = {
      'fbt.strategy': 'intentAI.participants.fbt-strategy',
      'fbt.execution': 'intentAI.participants.fbt-execution',
      'fbt.guardian': 'intentAI.participants.fbt-guardian',
      'fbt.council': 'intentAI.participants.fbt-council'
    };
    const lines = Array.isArray(payload.agentDialogue?.messages) ? payload.agentDialogue.messages : [];
    return (
      <div className="ia-agents" data-testid="agents-analyzing">
        <div className="ia-agents-head">
          <span className="ia-agent-dot" aria-hidden="true" />
          <span className="ia-agent-dot second" aria-hidden="true" />
          <b>{t('intentAI.agents.analyzing')}</b>
        </div>
        {lines.length > 0 ? (
          <div className="ia-dialogue" data-testid="agent-dialogue">
            {lines.map((line, index) => (
              <div
                key={`${line.from}-${index}`}
                className={`ia-dialogue-line${line.from === 'fbt.execution' ? ' alt' : ''}`}
                data-testid="agent-dialogue-line"
              >
                <b>{t(DIALOGUE_SPEAKERS[line.from] || 'intentAI.chat.ai', { defaultValue: line.from })}</b>
                <span>{t(`intentAI.dialogue.${line.type}`, { ...(line.params || {}) })}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.6 }}>{t('intentAI.agents.analyzingNote')}</div>
        )}
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

  if (type === 'memory-learned') {
    /* Phase 205 — the teach reply: what was learned, or an honest refusal. */
    if (payload.secretRefused) {
      return <div style={{ color: 'var(--bad, #ff6b6b)' }}>{t('intentAI.memory.secretRefused')}</div>;
    }
    if (!payload.ok) {
      return <div>{t('intentAI.memory.learnFailed')}</div>;
    }
    return (
      <div className="ia-taught" data-testid="memory-learned">
        <div className="ia-taught-head">
          <span aria-hidden="true">✦</span>
          <b>{t('intentAI.memory.learnedTitle')}</b>
          <small>{t(`intentAI.memory.tag.${payload.tag || 'preferences'}`)}</small>
        </div>
        <span className="ia-taught-text">{payload.text}</span>
        <small className="ia-hint">{t('intentAI.memory.learnedNote', { total: payload.total ?? 1 })}</small>
      </div>
    );
  }

  if (type === 'memory-recall') {
    /* Phase 205 — recall / forget, answered from the real local store. */
    if (payload.cleared) {
      return <div data-testid="memory-recall">{t('intentAI.memory.cleared')}</div>;
    }
    const rows = Array.isArray(payload.entries) ? payload.entries : [];
    return (
      <div className="ia-taught" data-testid="memory-recall">
        <div className="ia-taught-head">
          <span aria-hidden="true">✦</span>
          <b>{t('intentAI.memory.recallTitle', { n: rows.length })}</b>
          <small>{t('intentAI.memory.localOnly')}</small>
        </div>
        {rows.length === 0
          ? <span>{t('intentAI.memory.empty')}</span>
          : rows.slice(0, 8).map((entry, index) => (
            <div key={`${entry.at}-${index}`} className="ia-taught-text">• {entry.text} <small className="ia-hint">({t(`intentAI.memory.tag.${entry.tag || 'preferences'}`)})</small></div>
          ))}
        {rows.length > 8 && <small className="ia-hint">{t('intentAI.memory.more', { n: rows.length - 8 })}</small>}
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
    const { intent, suggestions = [], confidence, targetReality, marketAnalysis, externalView } = payload;
    /* Phase 204 — the external agent's deterministic second opinion, over the
       same sourced market block (or an honest "no data" line). */
    const externalRead = externalView ? externalAgentRead({ view: externalView, marketAnalysis }) : null;
    return (
      <div>
        <div><b>{t('intentAI.msg.intent')}:</b> {intent?.action} · {t('intentAI.msg.confidence', { n: confidence })}</div>
        <div className="faint" style={{ marginTop: 3 }}>{t('intentAI.msg.analysisOnly', { defaultValue: 'Analysis only — no financial execution permission.' })}</div>
        {marketAnalysis && (
          <MarketAnalysisCard data={marketAnalysis} t={t} />
        )}
        {externalRead && (
          <div className="ia-ext-read" data-testid="external-agent-read">
            <div className="ia-ext-read-head">
              <span className="ia-agent-dot" aria-hidden="true" />
              <b>{externalRead.agentName}</b>
              <small>{t('intentAI.external.viewTitle', { defaultValue: 'external agent — independent read' })}</small>
            </div>
            <span>{t(externalRead.i18nKey, externalRead.params)}</span>
          </div>
        )}
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
  if (type === 'navigation') {
    /* Phase 208 — the assistant opened (or is opening) a real screen. The
       link is the reachable fallback for every surface where the auto-open
       hash write cannot run; the label is i18n, never hardcoded. */
    const label = t(payload.labelKey || 'intentAI.navigation.intentOS', { defaultValue: 'Intent OS' });
    return (
      <div className="ia-nav" data-testid="chat-navigation">
        <span>{t('intentAI.navigation.opening', { page: label, defaultValue: `Opening ${label}…` })}</span>
        <a className="ia-chip" href={`#${payload.route || '/intent'}`} data-testid="chat-navigation-link">
          {t('intentAI.navigation.open', { page: label, defaultValue: `Open ${label}` })} →
        </a>
      </div>
    );
  }
  return <span>{type}</span>;
}

/* ------------------------------------------------------------------ */
/* Deep market analysis card                                            */
/* ------------------------------------------------------------------ */

/*
 * USD formatting for the asset grid. Prices need more precision than money
 * amounts: a $0.0004 token says "$0.00" at 2 decimals, which is not a price
 * at all.
 */
function fmtUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const digits = n >= 1000 ? 0 : n >= 1 ? 2 : 6;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits })}`;
}

function fmtCompactUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  try {
    return `$${Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;
  } catch {
    return fmtUsd(n);
  }
}

function fmtSignedPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

const SIGNAL_GLYPH = { up: '▲', down: '▼', flat: '◆', unknown: '·' };

/**
 * One analysis reply = one market card: a regime strip on top, then a grid
 * with a block per requested asset (price, 24h change, 7d trend, volume,
 * signal, risk). Pending renders a loading note; unavailable says WHY it
 * has no numbers. Every label is i18n — nothing is assembled from a
 * hardcoded language.
 */
function MarketAnalysisCard({ data, t }) {
  const status = data?.dataStatus || 'unavailable';

  if (status === 'pending') {
    return (
      <div className="ia-ana-card is-pending" data-testid="market-analysis" data-status="pending">
        <p className="faint" style={{ fontSize: 11.5, margin: 0 }}>{t('intentAI.analysis.loading', { defaultValue: 'Reading the live market data…' })}</p>
      </div>
    );
  }

  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const priced = assets.filter((a) => a.dataStatus === 'live' || a.dataStatus === 'offline');
  const regime = data?.regime || null;
  const offline = status === 'offline';

  return (
    <div className={`ia-ana-card${offline ? ' is-offline' : ''}`} data-testid="market-analysis" data-status={status}>
      {offline && (
        <p className="ia-ana-note" style={{ marginTop: 0 }}>
          {t('intentAI.analysis.offlineNote', { defaultValue: 'Offline snapshot — prices are from the last saved data, not live.' })}
        </p>
      )}
      {status === 'unavailable' && (
        <p className="ia-ana-note" style={{ marginTop: 0 }}>
          {t('intentAI.analysis.unavailable', { defaultValue: 'Live market data is unreachable right now, so no prices are shown.' })}
        </p>
      )}

      {regime && (
        <div className={`ia-ana-regime${regime.available ? ' has-regime' : ''}`} data-testid="market-regime-strip">
          <span className="ia-ana-label">{t('intentAI.analysis.regime', { defaultValue: 'Market regime' })}</span>
          <span className="ia-ana-regime-text">
            {regime.available
              ? t(regime.i18nKey, regime.params || {})
              : t('intentAI.regime.unavailable')}
          </span>
        </div>
      )}

      {priced.length > 0 && (
        <div className="ia-ana-grid">
          {priced.map((asset) => (
            <div key={asset.symbol} className="ia-ana-asset" data-testid={`market-asset-${asset.symbol}`}>
              <div className="ia-ana-asset-head">
                <b>{asset.symbol}</b>
                <span className={`ia-ana-signal is-${asset.signal || 'unknown'}`}>
                  <i aria-hidden="true">{SIGNAL_GLYPH[asset.signal] || SIGNAL_GLYPH.unknown}</i>
                  {t(`intentAI.analysis.signal.${asset.signal || 'unknown'}`)}
                </span>
              </div>
              <div className="ia-ana-price">{fmtUsd(asset.priceUsd)}</div>
              <div className="ia-ana-metrics">
                <div>
                  <span>{t('intentAI.analysis.change24h', { defaultValue: '24h' })}</span>
                  <b className={Number(asset.change24hPct) > 0 ? 'is-up' : Number(asset.change24hPct) < 0 ? 'is-down' : ''}>
                    {fmtSignedPct(asset.change24hPct)}
                  </b>
                </div>
                <div>
                  <span>{t('intentAI.analysis.trend7d', { defaultValue: '7d trend' })}</span>
                  <b>{fmtSignedPct(asset.trend7dPct)}</b>
                </div>
                <div>
                  <span>{t('intentAI.analysis.volume', { defaultValue: 'Volume 24h' })}</span>
                  <b>{fmtCompactUsd(asset.volume24hUsd)}</b>
                </div>
                <div>
                  <span>{t('intentAI.analysis.risk', { defaultValue: 'Risk' })}</span>
                  <b className={`ia-ana-risk is-${asset.risk || 'unknown'}`}>
                    {t(`intentAI.analysis.riskLevel.${asset.risk || 'unknown'}`)}
                  </b>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {assets.some((a) => a.dataStatus === 'unavailable') && (
        <div className="ia-ana-unpriced">
          {assets.filter((a) => a.dataStatus === 'unavailable').map((asset) => (
            <span key={asset.symbol} className="ia-ana-unpriced-chip">
              {asset.symbol}: {t('intentAI.analysis.assetUnavailable', { defaultValue: 'no live price' })}
            </span>
          ))}
        </div>
      )}

      <p className="ia-ana-note">
        {t('intentAI.analysis.notAdvice', { defaultValue: 'A market read, not financial advice. Signals are simple heuristics over the numbers shown — nothing here executes or recommends a trade.' })}
      </p>
    </div>
  );
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
