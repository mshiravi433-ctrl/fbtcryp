/**
 * FBT INTENT AI OS — the unified AI gateway (V1).
 * ---------------------------------------------------------------------------
 * This module is the "one intelligent interface for all of FBT". It replaces
 * a policy-first chat with a context-first, tool-first, execution-first
 * assistant:
 *
 *   POST /api/v1/ai/context       current AI context (wallet, chains, balance,
 *                                 portfolio, orders, positions, intents,
 *                                 automations, activity, memory summary)
 *   POST /api/v1/ai/suggestions   dynamic suggestions (max 4) from intent
 *   POST /api/v1/ai/chat          one chat turn: intent -> context -> tools ->
 *                                 plan -> firewall -> structured reply
 *   POST /api/v1/ai/execute       validate an AIAction and return a real
 *                                 execution path (hand-off to the actual venue
 *                                 or wallet flow; this server never signs)
 *   GET  /api/v1/ai/automations   real durable automation registry
 *   POST /api/v1/ai/automations   create a real automation record + schedule
 *   DELETE /api/v1/ai/automations/:id
 *   GET  /api/v1/ai/memory        safe conversation memory
 *   POST /api/v1/ai/memory        append safe memory (secrets never leave)
 *   POST /api/v1/ai/goal          create a financial goal from natural language
 *   POST /api/v1/ai/goal/:id/plan build the plan for an existing goal
 *
 * Honesty rules
 *   - No AI-created hard currency ceilings. The user owns their wallet.
 *   - Mandatory checks are still run: wallet, chain, balance, slippage, gas,
 *     validation, simulation and user approval for wallet/security flows.
 *   - Nothing here signs, holds a key, seeds a phrase, or fabricates a tx.
 *   - Every number returned is real data or reported unavailable — never a
 *     guess and never a hard-coded balance/price/hash.
 */
import { Router } from 'express';
import { createHash } from 'node:crypto';
import {
  AI_INTENTS,
  AI_SURFACES,
  classifyIntent,
  orchestrate,
  validateExecution,
  executionStageLedger,
  sanitizeAiControl,
  createAutomation,
  normalizeAutomation,
  upsertAutomation,
  removeAutomation,
  AI_CONTROL_DEFAULTS,
  AI_CONTROL_CHAINS
} from '../src/lib/intent-ai/commandCenter.js';
import { listAiTools, AI_TOOL_SCHEMA } from '../src/lib/intent-ai/aiToolRegistry.js';
import { formatHumanResponse, formatExecutionResult, stripInternalLeaks } from '../src/lib/intent-ai/humanResponse.js';
import { classifyUserIntent } from '../src/lib/intent-ai/intentKinds.js';
import { planRebalance } from '../src/lib/intent-ai/rebalanceEngine.js';
import { createPendingIntent, transitionPendingIntent } from '../src/lib/intent-ai/pendingIntent.js';
import { buildActionPlan, isExecutionReady } from '../src/lib/intent-ai/contextResolver.js';
import { narrateMissingInformation, narrateReadyPlan } from '../src/lib/intent-ai/planNarrator.js';
import { humanizeError } from '../src/lib/intent-ai/errorHumanizer.js';
import { createExecutionPlan, toExecutionResult } from '../src/lib/intent-ai/executionStateMachine.js';
import { checkScheduleAuthorization } from './intentScheduler.js';
import {
  createMonitor,
  listMonitors,
  getMonitor,
  setMonitorStatus,
  deleteMonitor,
  evaluateMonitor,
  evaluateAllMonitors,
  monitorEngineStatus
} from './intentMonitoring.js';
import { storeGet, storeSet, storeDurable, EPHEMERAL_TTL_MS } from './store.js';
/* Central Intelligence OS: share one world view between the V1 chat and the
   central brain (wallet/portfolio truth + page awareness, §5/§7). */
import { ingestClientData as centralIngestClientData, setPage as centralSetPage } from './central/stateStore.js';
import { normalizePageContext } from './central/contextEngine.js';
import { aiConfigured, classifyIntentWithModel } from './ai.js';
import { fetchSimplePrices } from './providers.js';
import { fetchYields } from './yields.js';
import { fetchSolanaAssets } from './solanaAssets.js';
import { ownerFromRequest, listGoals, createGoal, parseGoalFromText } from './financialGoals.js';
import { withCache } from './cache.js';
import {
  INTENT_OS_PROMPT_VERSION,
  INTENT_OS_CONTRACT,
  INTENT_OS_RULES,
  EXECUTION_CHAIN,
  buildSystemPrompt
} from '../src/lib/intent-ai/os/systemPrompt.js';
import { understandIntent, updateIntentSession } from '../src/lib/intent-ai/os/index.js';
import { resolveGoalTurn } from '../src/lib/strategyBrain/goalTurn.js';
import { resolveChatRoute } from '../src/lib/intent-ai/autonomy/chatRoutes.js';
import {
  getAvailableProviders,
  getActiveProviderIds,
  routedChat,
  gatewaySelfTest
} from './aiGateway.js';
import { runMultiAiDebate, runAdversarialDebate } from './aiConsensus.js';
/* AI strengthening (patterns from Gordon / TradingAgents / Zetryn / LlamaIndex,
   original code): immutable constitution, content-bound approvals, the
   Bull/Bear/Judge debate, decision log + reflection, BM25 retrieval and
   point-in-time views. None of these can sign, send or approve anything. */
import { checkConstitution, explainConstitution, CONSTITUTION } from '../src/lib/intent-ai/constitution.js';
import { issueApproval, verifyApproval, APPROVAL_TTL_MS, approvalDurable } from './aiApproval.js';
import { retrieve as retrieveBm25, retrievalStats } from '../src/lib/intent-ai/retrieval.js';
import { pointInTimeView } from '../src/lib/intent-ai/pointInTime.js';
import { evaluateConfidenceMetrics } from './aiConfidence.js';
import {
  recordIntentOutcome,
  getLearningInsights,
  recordDecision,
  resolveDecisions,
  buildReflection,
  decisionStats
} from './aiLearning.js';
/* AI Upgrade 5 — Collaborative Multi-AI Intelligence + Web Research +
   Customer Question Intelligence. The deterministic question analyzer decides
   how much intelligence a turn needs; the collaboration engine coordinates
   models/tools/web inside that budget; question-intel learns what users
   actually ask. Execution authority is untouched (§67). */
import { planCollaboration } from '../src/lib/intent-ai/os/collaborationRouter.js';
import { resolveAsset } from './intentMonitoring.js';
import { fetchCoinDetail } from './providers.js';
import { runCollaborativeAnalysis, formatEmotionalAcknowledgement } from './aiCollaboration.js';
import { researchWeb, analyzeWithSources, analyzeNewsImpact } from './aiWebResearch.js';
import {
  recordQuestion,
  recordAnswerFeedback,
  getQuestionAnalytics,
  getKnowledgeGaps,
  getFaqCandidates,
  getQualityDashboard
} from './aiQuestionIntel.js';
import { searchKnowledge, listKnowledge, knowledgeStats } from '../src/lib/intent-ai/os/knowledgeCenter.js';
/* Upgrade 13 — conversational depth. The social layer answers a pleasantry in
   the language it was written in, turns «چخبر» into an economic brief, and the
   escalation ladder spends the REST of the fleet when the deterministic reply
   has nothing. Execution authority is untouched (§67). */
import { composeSocialTurn } from './aiSocial.js';
import { respondIn } from '../src/lib/intent-ai/os/conversation/languageSense.js';
import { answerGap, escalateToProviders, ESCALATION_SCHEMA } from './aiEscalation.js';
import { fetchNews } from './news.js';

const router = Router();

const DEVICE_HEADER = 'x-fbt-device';
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SALT = process.env.FINANCIAL_GOALS_SALT || process.env.CRON_SECRET || 'fbt-ai-intent-os';
const RAW_SECRET_RE = /(?:private[\s-]?key|seed[\s-]?phrase|mnemonic|master[\s-]?password|api[\s-]?secret|raw[\s-]?secret|passphrase)/i;
const ACTION_TYPES = new Set(['SWAP', 'BRIDGE', 'SEND', 'BUY', 'SELL', 'FUTURES', 'FARM', 'LEND', 'STOCK', 'DCA', 'GOAL', 'REBALANCE', 'DEPOSIT', 'YIELD_SWEEP', 'AUTOMATION_CREATE', 'STABLE_SHIELD', 'REVOKE_APPROVAL', 'STOP_LOSS', 'ANALYZE']);
/* Plan actions use the older command-center names; the AI OS normalises them
   to the public AIAction schema before validation and routing. */
const ACTION_ALIASES = Object.freeze({
  DEPOSIT: 'FARM',
  YIELD_SWEEP: 'FARM',
  STABLE_SHIELD: 'LEND',
  REVOKE_APPROVAL: 'SEND',
  STOP_LOSS: 'SWAP',
  AUTOMATION_CREATE: 'DCA'
});
const AUTOMATION_STATUSES = ['ACTIVE', 'PAUSED', 'FAILED', 'COMPLETED', 'CANCELLED'];
const CADENCE_MS = { DAILY: 24 * 3600_000, WEEKLY: 7 * 24 * 3600_000, MONTHLY: 30 * 24 * 3600_000 };
const MAX_MESSAGE = 1200;
const MAX_SUGGESTIONS = 4;
const MAX_MEMORY = 128;

const nowMs = () => Date.now();
const safe = (v, max = 80) => String(v ?? '').replace(/[\u0000-\u001f\u200b-\u200f]/g, ' ').trim().slice(0, max);
const token = (v) => String(v ?? '').trim().toUpperCase().slice(0, 16);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const hashOwner = (v) => createHash('sha256').update(`${v}|${SALT}`).digest('hex').slice(0, 32);

/** One page (and one wallet) -> one storage scope. */
function ownerFor(req) {
  if (req?.tgUser?.id) return `tg:${req.tgUser.id}`;
  const device = String(req?.get?.(DEVICE_HEADER) || '').trim();
  if (DEVICE_RE.test(device)) return `dev:${hashOwner(device)}`;
  return `ip:${String(req?.ip || 'anon').slice(0, 64)}`;
}

/* ---------------------------- secret stripping ----------------------------- */

function isSensitive(text) {
  return RAW_SECRET_RE.test(String(text || ''));
}

function safeMemoryText(v, max = 240) {
  const text = safe(v, max);
  return isSensitive(text) ? null : text;
}

/* ------------------------------- market data ------------------------------ */

async function marketContext() {
  try {
    /* swr: a warm cache answers instantly and refreshes in the background —
       a chat turn never waits on CoinGecko when a recent read exists. */
    const { value } = await withCache('ai-os:market', 60_000, () => fetchSimplePrices(['bitcoin', 'ethereum', 'solana'], 'usd'), { swr: true });
    const g = value || {};
    const price = (row) => (Number.isFinite(Number(row?.usd)) ? Number(row.usd) : null);
    return {
      dataStatus: 'live',
      change24hPct: Number.isFinite(Number(g.bitcoin?.usd_24h_change)) ? Number(g.bitcoin.usd_24h_change) : null,
      priceMap: { BTC: price(g.bitcoin), ETH: price(g.ethereum), SOL: price(g.solana) }
    };
  } catch {
    return { dataStatus: 'unavailable', change24hPct: null, priceMap: null };
  }
}

async function yieldContext() {
  try {
    const { value } = await withCache('ai-os:yields', 5 * 60_000, fetchYields, { swr: true });
    const pools = Array.isArray(value?.pools) ? value.pools : (Array.isArray(value) ? value : []);
    return pools.slice(0, 40).map((p) => ({
      protocol: p?.protocol || p?.project || null,
      symbol: p?.symbol || p?.token || null,
      apy: Number.isFinite(Number(p?.apy)) ? Number(p.apy) : null,
      riskBand: p?.riskBand || p?.risk || null,
      tvlUsd: Number.isFinite(Number(p?.tvlUsd)) ? Number(p.tvlUsd) : null
    })).filter((r) => r.apy != null);
  } catch {
    return null;
  }
}

async function solanaAssetsContext() {
  try {
    const { value } = await withCache('ai-os:solana-assets', 5 * 60_000, fetchSolanaAssets, { swr: true });
    const rows = Array.isArray(value?.lst) ? value.lst : [];
    return rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      mint: r.mint,
      usdPrice: Number(r.usdPrice) || null,
      liquidity: Number(r.liquidity) || null,
      change24h: Number(r.change24h) || null
    }));
  } catch {
    return null;
  }
}

/* ------------------------- live token card (chat) -------------------------- */

/*
 * ONE ASSET PER TURN, CHART INCLUDED.
 * A token question used to be answered in prose only, so the user had to leave
 * the chat to see the chart or the 24h high/low. When the turn names an asset
 * we now read the SAME market detail the coin page renders (cached 60s,
 * stale-while-revalidate, hard-capped so a slow upstream can never stall the
 * turn) and ship a structured card: price, 1h/24h/7d changes, sparkline,
 * 24h high/low, market cap, volume, rank and the backtested signal.
 * Missing data stays null — the card renders «—», never a guess.
 */
const TOKEN_CARD_TTL = 60_000;

async function buildTokenCard(symbolRaw) {
  const sym = String(symbolRaw || '').trim().toUpperCase();
  if (!sym) return null;
  const asset = resolveAsset({ symbol: sym }) || { coinId: sym.toLowerCase(), symbol: sym };
  try {
    const withDeadline = (p, ms) => Promise.race([
      p,
      new Promise((resolve) => { const t = setTimeout(() => resolve(null), ms); t.unref?.(); })
    ]);
    const { value: coin } = await withCache(
      `ai-os:tokencard:${asset.coinId}`,
      TOKEN_CARD_TTL,
      async () => {
        const row = await fetchCoinDetail(asset.coinId, 'usd');
        if (!row || !(Number(row.price) > 0)) throw new Error('NO_COIN_DATA');
        return row;
      },
      { swr: true }
    );
    if (!coin) return null;
    return {
      kind: 'TOKEN',
      symbol: String(coin.symbol || asset.symbol || sym).toUpperCase(),
      coinId: coin.id || asset.coinId,
      name: coin.name || null,
      priceUsd: Number.isFinite(Number(coin.price)) ? Number(coin.price) : null,
      change1hPct: Number.isFinite(Number(coin.change1h)) ? Number(coin.change1h) : null,
      change24hPct: Number.isFinite(Number(coin.change24h)) ? Number(coin.change24h) : null,
      change7dPct: Number.isFinite(Number(coin.change7d)) ? Number(coin.change7d) : null,
      high24h: Number.isFinite(Number(coin.high24h)) && Number(coin.high24h) > 0 ? Number(coin.high24h) : null,
      low24h: Number.isFinite(Number(coin.low24h)) && Number(coin.low24h) > 0 ? Number(coin.low24h) : null,
      marketCapUsd: Number.isFinite(Number(coin.mcap)) && Number(coin.mcap) > 0 ? Number(coin.mcap) : null,
      volume24hUsd: Number.isFinite(Number(coin.volume)) && Number(coin.volume) > 0 ? Number(coin.volume) : null,
      rank: Number.isFinite(Number(coin.rank)) && Number(coin.rank) > 0 ? Number(coin.rank) : null,
      ath: Number.isFinite(Number(coin.ath)) && Number(coin.ath) > 0 ? Number(coin.ath) : null,
      sparkline: Array.isArray(coin.sparkline) ? coin.sparkline.slice(-168) : [],
      signal: null,
      rsi: null,
      confidence: null,
      at: Date.now(),
      source: 'api'
    };
  } catch {
    return null;
  }
}

/* ------------------------------ user context ------------------------------ */

async function readGoals(owner) {
  try {
    return await listGoals(owner);
  } catch {
    return { ok: true, dataStatus: 'unavailable', goals: [] };
  }
}

function sanitizeClientArray(value, mapper, max = 80) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map(mapper).filter(Boolean);
}

function sanitizeBalances(value) {
  return sanitizeClientArray(value, (b) => {
    const amount = Number(b?.amount);
    const symbol = token(b?.symbol);
    if (!symbol || !Number.isFinite(amount) || amount < 0) return null;
    return {
      symbol,
      chain: safe(b?.chain || b?.chainId || null, 32),
      chainId: Number.isFinite(Number(b?.chainId)) ? Number(b.chainId) : null,
      amount,
      valueUsd: Number.isFinite(Number(b?.valueUsd)) ? Math.max(0, Number(b.valueUsd)) : null,
      dataStatus: b?.dataStatus || 'client'
    };
  });
}

function sanitizePortfolio(value) {
  if (!value || typeof value !== 'object') return { dataStatus: 'unavailable', totalValueUsd: null, holdings: [], failedChains: [] };
  const holdings = sanitizeClientArray(value.holdings || value.rows, (h) => {
    const symbol = token(h?.symbol);
    if (!symbol) return null;
    return {
      symbol,
      chainId: Number.isFinite(Number(h?.chainId)) ? Number(h.chainId) : null,
      valueUsd: Number.isFinite(Number(h?.valueUsd ?? h?.value)) ? Number(h.valueUsd ?? h.value) : null,
      amount: Number.isFinite(Number(h?.amount)) ? Number(h.amount) : null
    };
  });
  const totalValueUsd = Number.isFinite(Number(value?.totalValueUsd ?? value?.totalValue)) ? Number(value.totalValueUsd ?? value.totalValue) : null;
  return {
    dataStatus: value.dataStatus || (totalValueUsd != null ? 'client' : 'unavailable'),
    totalValueUsd,
    holdings,
    /* Chain-read diagnostics: lets the reply distinguish «portfolio is
       empty» (a definitive on-chain answer) from «the chain read failed»
       (a transport answer — assets are NOT missing). */
    failedChains: sanitizeClientArray(value.failedChains, (c) => safe(c, 16), 24),
    rowsCount: holdings.length,
    hydrating: value.hydrating === true,
    partial: value.partial === true
  };
}

function sanitizeWallet(value) {
  if (!value || typeof value !== 'object') return { connected: false, canSign: false, evmAddresses: [], solanaAddresses: [] };
  const evmInput = value.evmAddresses || value.addresses || value.address || [];
  const solInput = value.solanaAddresses || value.solanaAddress || [];
  const evm = sanitizeClientArray(Array.isArray(evmInput) ? evmInput : [evmInput], (a) => (typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null), 16);
  const sol = sanitizeClientArray(Array.isArray(solInput) ? solInput : [solInput], (a) => (typeof a === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null), 16);
  const connected = value.connected === true || evm.length > 0 || sol.length > 0;
  const canSign = value.canSign === false ? false : (value.canSign === true || connected);
  return { connected, canSign, evmAddresses: evm, solanaAddresses: sol, dataStatus: connected ? 'client' : 'unavailable' };
}

async function buildAIContext(req, body = {}) {
  const userId = ownerFor(req);
  const b = body && typeof body === 'object' ? body : {};
  /*
   * The unified client ships its live wallet/portfolio snapshot under
   * `body.context`, while the older direct context route posts those same
   * fields at the top level. Support BOTH: when /chat and /execute ignored the
   * nested payload, the server always saw `connected: false`, so Action buttons
   * on the AI screen answered WALLET_REQUIRED even with the wallet already
   * open and connected.
   */
  const client = b.context && typeof b.context === 'object' ? b.context : b;
  /*
   * CONTEXT ASSEMBLY HAS A DEADLINE. Each read has its own upstream timeout
   * (12s), so a cold cache could legally make the FIRST turn of a session
   * wait out four slow providers before a single word of intent parsing —
   * the «هوش مصنوعی خیلی دیر جواب میده» experience. The assembly races an
   * 8s ceiling: whatever arrived in time is used, the rest degrades to
   * `unavailable` exactly like a failed read. The swr caches make every
   * subsequent turn instant either way.
   */
  const ctxDeadline = (p, ms = 8000) => Promise.race([
    p,
    new Promise((resolve) => { const t = setTimeout(() => resolve(null), ms); t.unref?.(); })
  ]);
  /*
   * `news` joins the same racy deadline. It exists for ONE turn shape: the
   * economic brief that answers «چخبر / what's up». A live RSS fan-out inside a
   * chat turn is exactly the kind of thing that used to make the assistant
   * feel slow, so it is cached with the same stale-while-revalidate discipline
   * as prices and a cold caller simply gets no news rows — which the brief
   * reports as a named gap rather than writing headlines itself.
   */
  const newsContext = async () => {
    try {
      const { value } = await withCache('ai-os:news', 5 * 60_000, fetchNews, { swr: true });
      const items = Array.isArray(value?.items) ? value.items : [];
      return { dataStatus: 'live', at: value?.at || null, items: items.slice(0, 6) };
    } catch {
      return { dataStatus: 'unavailable', at: null, items: [] };
    }
  };
  const [market, yields, solanaAssets, goals, news] = await Promise.all([
    ctxDeadline(marketContext()).then((v) => v || { dataStatus: 'unavailable', change24hPct: null, priceMap: null }),
    ctxDeadline(yieldContext()).then((v) => v || null),
    ctxDeadline(solanaAssetsContext()).then((v) => v || null),
    ctxDeadline(readGoals(userId)).then((v) => v || { ok: true, dataStatus: 'unavailable', goals: [] }),
    ctxDeadline(newsContext(), 4000).then((v) => v || { dataStatus: 'unavailable', at: null, items: [] })
  ]);

  const wallet = sanitizeWallet(client.wallet || b.wallet);
  const balances = sanitizeBalances(client.balances || b.balances);
  const portfolio = sanitizePortfolio(client.portfolio || b.portfolio);
  const orders = sanitizeClientArray(client.openOrders || client.orders || b.openOrders || b.orders || [], (o) => ({
    id: safe(o?.id, 40), side: safe(o?.side, 8), symbol: token(o?.symbol), amount: Number(o?.amount), status: safe(o?.status, 16)
  }));
  const positions = sanitizeClientArray(client.positions || b.positions, (p) => ({
    symbol: token(p?.symbol), side: safe(p?.side, 8), amount: Number(p?.amount), entry: Number(p?.entry), chainId: Number(p?.chainId)
  }));
  const intents = sanitizeClientArray(client.activeIntents || client.intents || b.activeIntents || b.intents || [], (i) => ({
    id: safe(i?.id, 40), kind: safe(i?.kind || i?.type, 16), asset: token(i?.asset), amount: Number(i?.amount), status: safe(i?.status, 16)
  }));
  const automations = sanitizeClientArray(client.activeAutomations || client.automations || b.activeAutomations || b.automations || [], (a) => ({
    id: safe(a?.id, 40), type: token(a?.type), asset: token(a?.asset), amount: Number(a?.amount), frequency: safe(a?.frequency, 12), status: safe(a?.status, 12)
  }));
  const recentActivity = sanitizeClientArray(client.recentActivity || client.activity || b.recentActivity || b.activity || [], (a) => ({
    type: safe(a?.type || a?.kind, 16), symbol: token(a?.symbol), amount: Number(a?.amount), status: safe(a?.status, 16), at: Number(a?.at) || null
  }));
  const memoryKey = `ai:memory:v1:${userId}`;
  const memory = await storeGet(memoryKey, null);
  const memoryRows = memory && typeof memory === 'object' ? memory : {};
  const summary = safe(memoryRows.conversationSummary, 600) || '';

  const chainList = [...new Set([
    ...wallet.evmAddresses.map(() => null).filter(Boolean),
    ...(wallet.evmAddresses.length ? [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144] : []),
    ...(wallet.solanaAddresses.length ? [501] : [])
  ])];
  const chains = chainList.length ? chainList : AI_CONTROL_CHAINS.map((c) => c.chainId);

  /*
   * CENTRAL INTELLIGENCE SYNC — the V1 chat and the central brain share one
   * world view: the same wallet/portfolio truth and the same page context
   * (§5/§7). Ingestion is structural, not optional; a page-blind AI is the
   * exact failure mode this architecture removes.
   */
  const activePage = normalizePageContext({
    route: client.currentRoute || client.currentPage || b.currentRoute || b.currentPage || null,
    module: client.currentModule || b.currentModule || null,
    tab: client.currentTab || b.currentTab || null,
    selectedAsset: client.selectedAsset || b.selectedAsset || null,
    selectedNetwork: client.selectedNetwork || b.selectedNetwork || null,
    walletConnected: wallet.connected
  });
  try {
    centralIngestClientData(userId, {
      wallet: { connected: wallet.connected, canSign: wallet.canSign, evmAddresses: wallet.evmAddresses, solanaAddresses: wallet.solanaAddresses },
      portfolio: { totalValueUsd: portfolio.totalValueUsd, holdings: portfolio.holdings, partial: portfolio.partial },
      balances,
      positions,
      openOrders: orders,
      recentActivity
    });
    if (activePage) centralSetPage(userId, activePage);
  } catch { /* central sync must never break the V1 context read */ }

  return {
    schema: 'fbt.ai-context.v1',
    userId,
    activePage,
    wallet,
    chains,
    balances,
    portfolio,
    openOrders: orders,
    positions,
    activeIntents: intents,
    activeAutomations: automations,
    recentActivity,
    conversationSummary: summary,
    financialGoals: goals?.goals || [],
    market,
    yields,
    solanaAssets,
    news,
    now: nowMs(),
    dataStatus: {
      wallet: wallet.connected ? 'live' : 'unavailable',
      portfolio: portfolio.dataStatus,
      market: market.dataStatus,
      yield: Array.isArray(yields) ? 'live' : 'unavailable',
      news: news?.dataStatus || 'unavailable',
      durable: storeDurable() ? 'live' : 'memory'
    }
  };
}

/* ------------------------------ memory helpers ---------------------------- */

async function readMemory(owner) {
  const key = `ai:memory:v1:${owner}`;
  const saved = await storeGet(key, null);
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {
    conversationId: null,
    summary: '',
    goals: [],
    preferences: [],
    activeTasks: [],
    recentIntents: []
  };
}

async function appendMemory(owner, payload = {}) {
  const mem = await readMemory(owner);
  const next = { ...mem };
  const summary = safeMemoryText(payload.summary, 600);
  if (summary) next.summary = summary;
  for (const field of ['goals', 'preferences', 'activeTasks', 'recentIntents']) {
    const rows = Array.isArray(payload[field]) ? payload[field].map((v) => safeMemoryText(v, 120)).filter(Boolean).slice(-16) : [];
    if (rows.length) next[field] = [...new Set([...(Array.isArray(mem[field]) ? mem[field] : []), ...rows])].slice(-16);
  }
  if (payload.conversationId) next.conversationId = safe(payload.conversationId, 64);
  /* Enforce a size bound so an unbounded chat cannot grow a per-user KV row. */
  for (const field of ['goals', 'preferences', 'activeTasks', 'recentIntents']) {
    if (Array.isArray(next[field])) next[field] = next[field].slice(-MAX_MEMORY);
  }
  /* An assistant memory is a convenience, not a record: it is per-account and
     grows with every conversation, so it carries the short TTL rather than
     occupying metered storage forever. */
  await storeSet(`ai:memory:v1:${owner}`, next, EPHEMERAL_TTL_MS);
  return next;
}

/* ---------------------------- dynamic suggestions -------------------------- */

const SUGGESTION_TEXT = Object.freeze({
  bestPrice: 'بهترین قیمت',
  dca: 'خرید با DCA',
  analyze: 'تحلیل',
  goal: 'تنظیم هدف',
  routeCompare: 'بهترین Route',
  slippageCompare: 'مقایسه Slippage',
  bridge: 'Bridge',
  gasCheck: 'بررسی Gas',
  yieldCheck: 'بررسی Yield',
  farmCompare: 'مقایسه Farmها',
  lendCheck: 'بررسی Lending',
  plan: 'ساخت Financial Plan',
  riskCheck: 'بررسی ریسک',
  rebalance: 'Rebalance',
  allocate: 'تخصیص مجدد',
  approvalCheck: 'بررسی مجوزها',
  hedge: 'هج کردن',
  exit: 'خروج امن',
  news: 'خبرها',
  regime: 'وضعیت بازار',
  trend: 'روند قیمت'
});

const SUGGESTION_PROMPTS = Object.freeze({
  bestPrice: 'بهترین قیمت برای خرید این دارایی کجاست؟',
  dca: 'چطور این را با DCA بخرم؟',
  analyze: 'این دارایی را تحلیل کن.',
  goal: 'چطور برای این دارایی هدف تعیین کنم؟',
  routeCompare: 'بهترین Route برای این عملیات چیست؟',
  slippageCompare: 'مقایسه Slippage در مسیرهای مختلف.',
  bridge: 'چطور این دارایی را Bridge کنم؟',
  gasCheck: 'Gas این عملیات را بررسی کن.',
  yieldCheck: 'بهترین Yield کجاست؟',
  farmCompare: 'بزرگترین Farmها را مقایسه کن.',
  lendCheck: 'گزینه‌های Lending را بررسی کن.',
  plan: 'یک Financial Plan برای من بساز.',
  riskCheck: 'ریسک پرتفوی من چقدر است؟',
  rebalance: 'پرتفوی من را Rebalance کن.',
  allocate: 'بهترین تخصیص برای این سرمایه چیست؟',
  approvalCheck: 'مجوزهای فعلی کیف پولم را بررسی کن.',
  hedge: 'چطور ریسک را هج کنم؟',
  exit: 'چطور امن از این موقعیت خارج شوم؟',
  news: 'آخرین اخبار این دارایی چیست؟',
  regime: 'وضعیت بازار فعلی چگونه است؟',
  trend: 'روند قیمت این دارایی را بررسی کن.'
});

function suggestion(id) {
  return {
    id,
    label: SUGGESTION_TEXT[id] || SUGGESTION_TEXT.analyze,
    prompt: SUGGESTION_PROMPTS[id] || SUGGESTION_PROMPTS.analyze,
    intent: null
  };
}

function suggestionsFor({ message = '', intent = 'GENERAL', context = {} } = {}) {
  const text = String(message || '').toLowerCase();
  const out = [];
  const push = (id) => { if (out.length < MAX_SUGGESTIONS) out.push(suggestion(id)); };
  const wantsSwap = /swap|convert|convertir|مبدل|تبدیل|بخور|بخر|sell|فروش|ارسال|send|bridge|بریج/i.test(text);
  const wantsBridge = /bridge|بریج|cross-chain/i.test(text);
  const wantsBuy = /buy|بخور|بخر|خرید|purchase/i.test(text);
  const wantsYield = /yield|farm|lend|lending|وام|فارم|سود|بازده|استخر/i.test(text);
  const wantsGoal = /goal|هدف|double|دو برابر|برنامه|سرمایه/i.test(text);

  if (wantsBridge) {
    push('routeCompare');
    push('slippageCompare');
    push('bridge');
    push('gasCheck');
  } else if (wantsBuy) {
    push('bestPrice');
    push('dca');
    push('analyze');
    push('goal');
  } else if (wantsSwap) {
    push('bestPrice');
    push('slippageCompare');
    push('routeCompare');
    push('gasCheck');
  } else if (wantsYield) {
    push('yieldCheck');
    push('farmCompare');
    push('lendCheck');
    push('plan');
  } else if (intent === 'PORTFOLIO' || wantsGoal) {
    push('riskCheck');
    push('rebalance');
    push('allocate');
    push('plan');
  } else if (intent === 'PROTECT') {
    push('riskCheck');
    push('approvalCheck');
    push('hedge');
    push('exit');
  } else if (intent === 'AUTOMATION') {
    push('dca');
    push('plan');
    push('rebalance');
    push('goal');
  } else if (intent === 'RESEARCH') {
    push('analyze');
    push('news');
    push('regime');
    push('trend');
  } else {
    push('riskCheck');
    push('yieldCheck');
    push('allocate');
    push('plan');
  }
  return out.slice(0, MAX_SUGGESTIONS);
}

/* ------------------------------ execution path ---------------------------- */

function routeForAction(type, chainId) {
  switch (String(type || '').toUpperCase()) {
    case 'SWAP':
    case 'BUY':
    case 'SELL':
      return chainId === 501 || chainId === 'solana' ? '/solana' : '/swap';
    case 'BRIDGE':
      return '/bridge';
    case 'SEND':
      return chainId === 501 || chainId === 'solana' ? '/solana' : '/wallet';
    case 'FUTURES':
      return '/perp';
    case 'FARM':
      return '/farm';
    case 'LEND':
      return '/loan';
    case 'STOCK':
      return '/stocks';
    case 'DCA':
      return '/intent-ai?tab=automations';
    case 'GOAL':
      return '/intent-ai?tab=goals';
    case 'REBALANCE':
      return '/portfolio';
    case 'ANALYZE':
      return '/intent';
    default:
      return '/intent';
  }
}

function validateAction(shaped, context = {}) {
  const rawType = String(shaped?.type || shaped?.kind || '').toUpperCase();
  const type = ACTION_ALIASES[rawType] || rawType;
  if (!ACTION_TYPES.has(type)) return { ok: false, reason: 'UNSUPPORTED_ACTION' };
  const chainId = shaped?.chain ? String(shaped.chain).toLowerCase() === 'solana' ? 501 : Number(shaped.chain) : (shaped?.chainId || null);
  const supportedChains = AI_CONTROL_CHAINS.map((c) => c.chainId);
  if (chainId != null && Number.isFinite(Number(chainId)) && !supportedChains.includes(Number(chainId))) {
    return { ok: false, reason: 'CHAIN_UNSUPPORTED', detail: `chain ${chainId}` };
  }
  const amount = num(shaped?.amount);
  if (amount != null && amount <= 0) return { ok: false, reason: 'AMOUNT_INVALID' };
  const wallet = context.wallet || { connected: false };
  const needsWallet = !['GOAL', 'DCA'].includes(type);
  if (needsWallet && !wallet.connected) return { ok: false, reason: 'WALLET_REQUIRED' };
  if (needsWallet && !wallet.canSign) return { ok: false, reason: 'WALLET_SIGNATURE_REQUIRED' };
  const balances = Array.isArray(context.balances) ? context.balances : [];
  const asset = token(shaped?.asset);
  if (asset && ['SWAP', 'BUY', 'SELL', 'SEND', 'BRIDGE', 'FARM', 'LEND'].includes(type)) {
    const row = balances.find((b) => b.symbol === asset);
    if (row?.amount != null && Number(row.amount) === 0 && amount != null) {
      return { ok: false, reason: 'BALANCE_INSUFFICIENT', detail: `zero ${asset} in wallet` };
    }
  }
  return {
    ok: true,
    type,
    chainId,
    asset,
    amount,
    parameters: shaped?.parameters && typeof shaped.parameters === 'object' ? shaped.parameters : {},
    requiresConfirmation: true,
    handoffRoute: routeForAction(type, chainId)
  };
}

async function readPending(owner) {
  const row = await storeGet(`ai:pending:v1:${owner}`, null);
  return row && row.schema === 'fbt.ai-pending-intent.v1' ? row : null;
}

async function writePending(owner, intent) {
  await storeSet(`ai:pending:v1:${owner}`, intent || null, EPHEMERAL_TTL_MS);
  return intent;
}

function logInternal(label, payload) {
  try {
    const safePayload = {
      intent: payload?.intent || payload?.plan?.intent || null,
      actionType: payload?.action?.type || payload?.actions?.[0]?.type || null,
      reason: payload?.reason || payload?.verdict?.reason || null,
      chain: payload?.chainId || payload?.action?.chainId || null,
      txHash: payload?.txHash || null,
      status: payload?.status || null
    };
    console.info(`[intent-os] ${label}`, safePayload);
  } catch { /* logging must never break the reply */ }
}

async function readAutomations(owner) {
  const rows = await storeGet(`ai:automations:v1:${owner}`, []);
  return Array.isArray(rows) ? rows.map(normalizeAutomation).filter(Boolean) : [];
}

async function writeAutomations(owner, rows) {
  await storeSet(`ai:automations:v1:${owner}`, rows, EPHEMERAL_TTL_MS);
  return rows;
}

function nextFire(automation, now = nowMs()) {
  const cadence = String(automation?.frequency || automation?.cadence || 'WEEKLY').toUpperCase();
  return now + (CADENCE_MS[cadence] || CADENCE_MS.WEEKLY);
}

export function createDurableAutomation(input = {}, now = nowMs()) {
  const type = String(input.type || input.kind || 'DCA').toUpperCase();
  const frequency = String(input.frequency || input.cadence || 'WEEKLY').toUpperCase();
  const kind = type === 'REBALANCE' ? 'rebalance' : 'dca';
  const cadence = String(frequency).toLowerCase();
  const shaped = {
    kind,
    cadence,
    asset: token(input.asset) || 'BTC',
    amountUsd: num(input.amount ?? input.amountUsd),
    chainId: Number.isFinite(Number(input.chainId)) ? Number(input.chainId) : null,
    note: safe(input.note, 120)
  };
  const base = createAutomation(shaped, { now });
  if (!base.ok) return base;
  const autom = {
    ...base.automation,
    type,
    frequency,
    status: 'ACTIVE',
    nextExecution: nextFire({ frequency }, now),
    lastExecution: null,
    result: null,
    transactionHash: null,
    error: null,
    createdAt: now,
    updatedAt: now
  };
  return { ok: true, automation: autom };
}

/* --------------------------------- routes --------------------------------- */

/* The execution-first system prompt is part of the public backend contract
   (spec §49): the frontend renders what the backend states, so the governing
   spec must be queryable rather than hard-coded into a UI guess. */
router.get('/system-prompt', (_req, res) => res.json({
  ok: true,
  schema: 'fbt.intent-os.system-prompt.v1',
  version: INTENT_OS_PROMPT_VERSION,
  executionChain: EXECUTION_CHAIN,
  rules: INTENT_OS_RULES,
  contract: INTENT_OS_CONTRACT,
  systemPrompt: buildSystemPrompt({ locale: 'fa' }),
  systemPromptEn: buildSystemPrompt({ locale: 'en' }),
  at: nowMs()
}));

router.get('/tools', (_req, res) => res.json({ ok: true, schema: AI_TOOL_SCHEMA, tools: listAiTools(), at: nowMs() }));

/* FBT AI Gateway Endpoints (Spec Phase 3) */
router.get('/gateway/providers', (_req, res) => res.json({
  ok: true,
  schema: 'fbt.ai-providers.v1',
  providers: getAvailableProviders(),
  activeProviderIds: getActiveProviderIds(),
  at: nowMs()
}));

router.get('/gateway/selftest', async (_req, res) => {
  const report = await gatewaySelfTest();
  return res.json(report);
});

router.post('/gateway/chat', async (req, res) => {
  try {
    const result = await routedChat(req.body || {});
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/gateway/consensus', async (req, res) => {
  try {
    const { message, context, locale, preferredProviders } = req.body || {};
    const consensus = await runMultiAiDebate({ message, context, locale, preferredProviders });
    return res.json({ ok: true, ...consensus });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/gateway/confidence', (req, res) => {
  try {
    const metrics = evaluateConfidenceMetrics(req.body || {});
    return res.json({ ok: true, ...metrics });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/learning/record', async (req, res) => {
  try {
    const record = await recordIntentOutcome(req.body || {});
    return res.json({ ok: true, record });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/learning/stats', async (_req, res) => {
  try {
    const insights = await getLearningInsights();
    return res.json({ ok: true, ...insights });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─── AI STRENGTHENING ENDPOINTS ─────────────────────────────────────────
   Advisory / verification only. None of these sign, send or approve. */

/** The immutable ceilings, so any client can show the user the rules. */
router.get('/constitution', (_req, res) => res.json({
  ok: true,
  schema: 'fbt.constitution.v1',
  constitution: CONSTITUTION,
  approval: { ttlMs: APPROVAL_TTL_MS, durable: approvalDurable() },
  at: nowMs()
}));

/** Dry-run a plan against the constitution (no side effects). */
router.post('/constitution/check', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const actions = Array.isArray(body.actions) ? body.actions.slice(0, 32) : (body.action ? [body.action] : []);
  if (!actions.length) return res.status(400).json({ ok: false, error: 'NO_ACTIONS' });
  const result = checkConstitution({
    actions,
    balances: Array.isArray(body.balances) ? body.balances.slice(0, 200) : null,
    defaultChainId: Number(body.chainId) || null
  });
  return res.json({ ...result, message: explainConstitution(result, safe(body.locale, 5) || 'fa') });
});

/** Server-side second opinion on a content-bound approval. */
router.post('/approval/verify', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const actions = Array.isArray(body.actions) ? body.actions.slice(0, 32) : [];
  if (!actions.length) return res.status(400).json({ ok: false, code: 'NO_ACTIONS' });
  const verdict = verifyApproval({ owner: ownerFor(req), approval: body.approval, actions });
  return res.status(verdict.ok ? 200 : 409).json({ ...verdict, authorizesExecution: false });
});

/** Symbol → live USD price, via the same cached CoinGecko path as the app. */
async function livePriceOf(symbol) {
  const asset = resolveAsset({ symbol });
  if (!asset?.coinId) return null;
  try {
    const detail = await fetchCoinDetail(asset.coinId);
    const p = Number(detail?.price ?? detail?.current_price ?? detail?.market_data?.current_price?.usd);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * Bull vs Bear, then a Judge. Reflection (this owner's past resolved calls on
 * the asset) is shown to both sides; the verdict is logged so it can be
 * scored later against a real price. `asOf` turns it into a point-in-time
 * replay: every input stamped after that moment is removed first.
 */
router.post('/debate', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const message = String(body.message || '').slice(0, 800);
  if (!message.trim()) return res.status(400).json({ ok: false, error: 'EMPTY_MESSAGE' });
  const locale = safe(body.locale, 5) || 'fa';
  const owner = ownerFor(req);
  const asset = safe(body.asset, 16) ? String(body.asset).toUpperCase() : null;
  try {
    const pit = pointInTimeView(body.context && typeof body.context === 'object' ? body.context : {}, body.asOf || null);
    const context = { ...pit.context, pointInTime: pit.historical ? { historical: true, asOf: pit.asOf } : null };
    /* Score yesterday's calls before making today's (live mode only). */
    if (!pit.historical && asset) await resolveDecisions({ owner, priceOf: livePriceOf }).catch(() => {});
    const reflection = asset ? await buildReflection({ owner, asset, now: pit.historical ? Date.parse(pit.asOf) : Date.now() }) : null;
    const debate = await runAdversarialDebate({
      message,
      context,
      locale,
      rounds: body.rounds,
      reflection,
      preferredProviders: Array.isArray(body.preferredProviders) ? body.preferredProviders.slice(0, 4) : []
    });
    let decision = null;
    if (!pit.historical && asset && !debate.degraded) {
      const price = await livePriceOf(asset);
      const logged = await recordDecision({
        owner,
        asset,
        verdict: debate.verdict,
        confidence: debate.confidence,
        thesis: debate.decisiveArgument || debate.summary,
        priceAtDecision: price,
        horizonMs: Number(body.horizonHours) > 0 ? Number(body.horizonHours) * 3600_000 : undefined,
        source: 'debate'
      });
      decision = logged.ok ? { id: logged.decision.id, priceAtDecision: logged.decision.priceAtDecision, scorable: logged.decision.priceAtDecision != null } : null;
    }
    return res.json({
      ...debate,
      pointInTime: { historical: pit.historical, asOf: pit.asOf, stats: pit.stats },
      reflection: reflection ? { sample: reflection.sample, lossCount: reflection.lossCount, winCount: reflection.winCount, hitRate: reflection.hitRate } : null,
      decision
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 160) });
  }
});

/** This owner's decision log: hit rate + recent calls (resolves due ones first). */
router.get('/decisions', async (req, res) => {
  const owner = ownerFor(req);
  await resolveDecisions({ owner, priceOf: livePriceOf }).catch(() => {});
  return res.json({ ok: true, ...(await decisionStats({ owner })) });
});

/** BM25 retrieval over verified knowledge + Help answers. */
router.post('/retrieve', (req, res) => {
  const query = String(req.body?.query || '').slice(0, 400);
  if (!query.trim()) return res.status(400).json({ ok: false, error: 'EMPTY_QUERY' });
  const locale = safe(req.body?.locale, 5) || 'fa';
  const limit = Math.min(5, Math.max(1, Number(req.body?.limit) || 3));
  return res.json({ ok: true, results: retrieveBm25(query, { locale, limit }), stats: retrievalStats() });
});

/** Strip everything an `asOf` analysis could not have known. */
router.post('/point-in-time', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (!body.asOf) return res.status(400).json({ ok: false, error: 'AS_OF_REQUIRED' });
  const view = pointInTimeView(body.context && typeof body.context === 'object' ? body.context : {}, body.asOf);
  if (!view.historical) return res.status(400).json({ ok: false, error: 'AS_OF_INVALID' });
  return res.json({ ok: true, ...view });
});

/* ─── AI UPGRADE 5 ENDPOINTS ─────────────────────────────────────────────
   Collaborative analysis, web research, news impact, feedback and the
   question-intelligence analytics. Analytics endpoints are admin-gated with
   the shared CRON_SECRET — they are never exposed to normal users (§62). */

function adminSecretOk(req) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false; // fail closed: no secret configured → no analytics
  const provided =
    String(req.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
    String(req.get('x-cron-secret') || '') ||
    String(req.query?.key || '');
  return Boolean(provided) && provided === secret;
}

/* Explicit collaborative analysis (same engine the chat turn uses). */
router.post('/collaborate', async (req, res) => {
  try {
    const message = String(req.body?.message || '').slice(0, MAX_MESSAGE);
    if (!message.trim()) return res.status(400).json({ ok: false, error: 'EMPTY_MESSAGE' });
    if (isSensitive(message)) return res.status(400).json({ ok: false, error: 'SENSITIVE_CONTENT_REJECTED' });
    const locale = safe(req.body?.locale, 5) || 'fa';
    const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
    const result = await runCollaborativeAnalysis({
      message,
      context,
      locale,
      intentType: req.body?.intentType || null,
      transparency: req.body?.transparency === true,
      deadlineMs: Number(req.body?.deadlineMs) || undefined
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 160) });
  }
});

/* Web research with tiered sources (§12, §21-22). */
router.post('/research', async (req, res) => {
  try {
    const query = String(req.body?.query || req.body?.message || '').slice(0, 400);
    if (!query.trim()) return res.status(400).json({ ok: false, error: 'EMPTY_QUERY' });
    if (isSensitive(query)) return res.status(400).json({ ok: false, error: 'SENSITIVE_CONTENT_REJECTED' });
    const locale = safe(req.body?.locale, 5) || 'fa';
    const research = await researchWeb({ query, locale, limit: Number(req.body?.limit) || 5 });
    if (req.body?.analyze === false) return res.json({ ok: true, ...research });
    const analysis = await analyzeWithSources({
      question: query,
      sources: research.sources || [],
      context: req.body?.context || {},
      locale
    });
    return res.json({ ok: true, research, analysis });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 160) });
  }
});

/* News → Crypto impact engine (§18-20). */
router.post('/news-impact', async (req, res) => {
  try {
    const news = String(req.body?.news || req.body?.message || '').slice(0, 1200);
    if (!news.trim()) return res.status(400).json({ ok: false, error: 'EMPTY_NEWS' });
    if (isSensitive(news)) return res.status(400).json({ ok: false, error: 'SENSITIVE_CONTENT_REJECTED' });
    const locale = safe(req.body?.locale, 5) || 'fa';
    const assets = Array.isArray(req.body?.assets) ? req.body.assets.slice(0, 8).map((a) => token(a)) : [];
    const webEvidence = req.body?.verify !== false
      ? await researchWeb({ query: news.slice(0, 300), locale, limit: 5 }).catch(() => null)
      : null;
    const market = await marketContext();
    const impact = await analyzeNewsImpact({ news, assets, marketContext: market, locale, webEvidence });
    return res.json({ ok: true, ...impact, webEvidence: webEvidence ? { corroborated: webEvidence.corroborated, sourceCount: webEvidence.sourceCount, sources: (webEvidence.sources || []).map((s) => ({ title: s.title, url: s.url, tier: s.tier })) } : null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 160) });
  }
});

/* Answer feedback 👍/👎 with optional reason (§64). */
router.post('/feedback', async (req, res) => {
  try {
    const rating = Number(req.body?.rating) > 0 ? 1 : -1;
    const intentId = safe(req.body?.intentId, 64) || null;
    const reason = safe(req.body?.reason, 200) || '';
    const comment = safe(req.body?.comment, 500) || '';
    if (isSensitive(comment) || isSensitive(reason)) return res.status(400).json({ ok: false, error: 'SENSITIVE_CONTENT_REJECTED' });
    const locale = safe(req.body?.locale, 5) || 'fa';
    const record = await recordAnswerFeedback({ intentId, rating, reason, comment, locale });
    return res.json({ ok: true, record });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 160) });
  }
});

/* Question analytics — ADMIN ONLY (§62). */
router.get('/questions/analytics', async (req, res) => {
  if (!adminSecretOk(req)) return res.status(403).json({ ok: false, error: 'ADMIN_KEY_REQUIRED' });
  const analytics = await getQuestionAnalytics({ limit: Number(req.query?.limit) || 20 });
  return res.json(analytics);
});

/* Knowledge gaps — ADMIN ONLY (§31). */
router.get('/questions/gaps', async (req, res) => {
  if (!adminSecretOk(req)) return res.status(403).json({ ok: false, error: 'ADMIN_KEY_REQUIRED' });
  const gaps = await getKnowledgeGaps();
  return res.json(gaps);
});

/* FAQ candidates — ADMIN ONLY; drafts, never auto-published (§32). */
router.get('/questions/faq-candidates', async (req, res) => {
  if (!adminSecretOk(req)) return res.status(403).json({ ok: false, error: 'ADMIN_KEY_REQUIRED' });
  const faqs = await getFaqCandidates();
  return res.json(faqs);
});

/* AI quality dashboard — ADMIN ONLY (§63). */
router.get('/quality', async (req, res) => {
  if (!adminSecretOk(req)) return res.status(403).json({ ok: false, error: 'ADMIN_KEY_REQUIRED' });
  const dashboard = await getQualityDashboard();
  return res.json(dashboard);
});

/* Knowledge center — the internal knowledge layer the AI retrieves from (§55-57). */
router.get('/knowledge', (_req, res) => {
  return res.json({ ok: true, stats: knowledgeStats(), items: listKnowledge() });
});

router.post('/knowledge/search', (req, res) => {
  const query = String(req.body?.query || '').slice(0, 400);
  if (!query.trim()) return res.status(400).json({ ok: false, error: 'EMPTY_QUERY' });
  const locale = safe(req.body?.locale, 5) || 'fa';
  const limit = Math.min(5, Math.max(1, Number(req.body?.limit) || 3));
  const results = searchKnowledge(query, { locale, limit });
  return res.json({ ok: true, results });
});

router.post('/context', async (req, res) => {
  const context = await buildAIContext(req, req.body || {});
  return res.json({ ok: true, schema: 'fbt.ai-context.v1', context, at: nowMs() });
});

router.post('/suggestions', async (req, res) => {
  const message = String(req.body?.message || '').slice(0, MAX_MESSAGE);
  const locale = safe(req.body?.locale, 5) || null;
  const raw = Array.isArray(req.body?.context) ? req.body.context : (req.body?.context || null);
  const context = raw && typeof raw === 'object' ? raw : await buildAIContext(req, req.body || {});
  const classification = classifyIntent(message, { locale, prior: req.body?.prior || null });
  const intent = classification.intent;
  return res.json({
    ok: true,
    schema: 'fbt.ai-suggestions.v1',
    intent,
    confidence: classification.confidence,
    suggestions: suggestionsFor({ message, intent, context }),
    at: nowMs()
  });
});

/* ─── RICH OBJECTIVE REPLIES (server-side) ─────────────────────────────────
 * The V1 deterministic renderer below only speaks GENERAL / GOAL /
 * INVESTMENT_PLAN, so a profit objective («1000 دلار در ۳۰ روز به سود ۳۰
 * درصد با ریسک متوسط») classified correctly by the OS layer (STRATEGY_PLAN)
 * was re-classified GENERAL by the V1 lexicon and answered with the generic
 * two-line fallback — the reported «پیشنهاد مزخرف». These turns are answered
 * HERE with the same rich card contracts the browser OS emits, so the server
 * fallback renders the full engine (analysis, comparison, allocation, staged
 * handoffs with prefilled links) instead of a suggestion sentence.
 *
 * Nothing here executes: the card compiles from live reads on the client and
 * every money-moving step still needs the user's wallet signature (§67).
 */
const STRATEGY_MISSING_LABEL = Object.freeze({
  capitalUsd: { fa: 'سرمایه', en: 'capital' },
  targetPct: { fa: 'هدف سود', en: 'target return' },
  horizonDays: { fa: 'بازه زمانی', en: 'horizon' }
});

function richObjectiveReply({ message, u4, context, locale, surface, messages = [] }) {
  const fa = String(locale || 'fa').toLowerCase().startsWith('fa');
  const type = String(u4?.type || '').toUpperCase();
  const entities = (u4 && typeof u4.entities === 'object' && u4.entities) || {};

  /* ── 1. whole-ecosystem objective → STRATEGY_PLAN_CARD ─────────────── */
  const turn = resolveGoalTurn({
    text: message, messages,
    entities, portfolio: context?.portfolio || null,
    balances: context?.balances || null, wallet: context?.wallet || null
  });
  const spec = turn.spec;
  if (type === 'STRATEGY_PLAN' || turn.objective) {
    if (!spec.ok) {
      const missing = (spec.missing || []).map((m) => STRATEGY_MISSING_LABEL[m]?.[fa ? 'fa' : 'en'] || m);
      const qFa = `برای ساختن استراتژی کامل این‌ها کم است: ${missing.join('، ')}. مثلاً بنویس «۱۰۰۰ دلار، ۳۰٪ سود در ۳۰ روز، ریسک متوسط» تا تحلیل کامل، مقایسه گزینه‌ها و مراحل اجرا را با لینک آماده بدهم.`;
      const qEn = `To build the full strategy I still need: ${missing.join(', ')}. For example: \"$1,000, 30% in 30 days, medium risk\" — then I give you the full analysis, the compared options and the execution stages with links.`;
      return {
        ok: true,
        text: fa ? qFa : qEn,
        ui: { type: 'TEXT' },
        intent: {
          type: 'STRATEGY_PLAN',
          entities,
          confidence: u4.confidence ?? null,
          missingInformation: spec.missing || [],
          minimalQuestion: { fa: qFa, en: qEn }
        },
        strategyRequest: null,
        strategyDraft: { text: turn.text },
        goalDetected: true
      };
    }
    const riskFa = { conservative: 'محافظه‌کار', balanced: 'متعادل', aggressive: 'تهاجمی' }[spec.riskProfile] || spec.riskProfile;
    const text = fa
      ? `هدف را گرفتم: ${Number(spec.capitalUsd).toLocaleString('en-US')} دلار، ${spec.targetPct}٪ سود در ${spec.horizonDays} روز، ریسک ${riskFa}. اکنون ماژول‌های در دسترس را با دادهٔ واقعی می‌خوانم و گزینه‌های قابل‌اجرا را مقایسه می‌کنم. پوشش، شکاف داده، ریسک و مراحل در همین کارت مشخص می‌شود؛ هیچ سودی تضمین نیست و بدون امضای تو پولی جابه‌جا نمی‌شود.`
      : `Goal taken: $${Number(spec.capitalUsd).toLocaleString('en-US')}, ${spec.targetPct}% in ${spec.horizonDays} days, ${spec.riskProfile} risk. I am reading available modules and comparing executable options. This card will show actual coverage, missing data, risk and stages; no return is guaranteed and nothing moves without your signature.`;
    return {
      ok: true,
      text,
      ui: { type: 'STRATEGY_PLAN_CARD' },
      intent: { ...u4, type: 'STRATEGY_PLAN', entities, confidence: u4.confidence ?? null },
      strategyRequest: { text: turn.text, entities, knownCapital: true },
      suggestions: [],
      goalDetected: true
    };
  }

  /* ── 2. named multiple («سودم دو برابر شود») → GOAL_PLAN_CARD ───────── */
  if (type === 'GOAL_PLAN') {
    const multiple = Number(entities.goalMultiple) > 1 ? Number(entities.goalMultiple) : 2;
    const horizonDays = Number(entities.horizonDays) > 0 ? Number(entities.horizonDays) : 365;
    const text = fa
      ? `هدف را گرفتم: ${multiple} برابر در ${horizonDays} روز. حالا نرخ‌های واقعیِ همین لحظه را می‌خوانم و می‌گویم شدنی است یا نه — با عدد، نه با وعده.`
      : `Goal noted: ${multiple}× in ${horizonDays} days. Reading the live rates now and telling you whether it is reachable — with numbers, not a promise.`;
    return {
      ok: true,
      text,
      ui: { type: 'GOAL_PLAN_CARD' },
      intent: { type: 'GOAL_PLAN', ...u4, entities },
      goalRequest: { multiple, horizonDays },
      goalDetected: true
    };
  }

  /* ── 3. the chat IS the Intent OS — answer in place, never \"open\" ─── */
  if (type === 'INTENT_OS') {
    const onIntent = String(surface || '').startsWith('/intent');
    if (onIntent) {
      return {
        ok: true,
        text: fa
          ? 'تو الان داخل Intent OS هستی — همین چت، مغز اصلی اپ. پرتفوی، بازار، سواپ، فارم، وام، اسمارت‌مانی و استراتژی را از داده زنده همین‌جا می‌خوانم و اجرا می‌کنم؛ امضا همیشه با کیف پول توست.'
          : 'You are already inside the Intent OS — this chat is the app\'s main brain. I read and run portfolio, markets, swap, farm, lending, smart money and strategies from live data right here; signing is always your wallet\'s.',
        ui: { type: 'TEXT' },
        intent: { type: 'INTENT_OS', ...u4, entities },
        inPlace: true,
        openTab: 'chat',
        actions: [
          { id: 'open-ops', route: '/intent?tab=ops', label: fa ? 'مرکز عملیات' : 'Ops Center' },
          { id: 'open-agents', route: '/intent?tab=agents', label: fa ? 'ایجنت‌ها' : 'Agents' }
        ],
        goalDetected: false
      };
    }
    return {
      ok: true,
      text: fa
        ? 'چت Intent OS را باز کن — همان مغز اصلی اپ: پرتفوی، بازار، سواپ، فارم، وام و استراتژی را از داده زنده همان‌جا بخوان و اجرا کن.'
        : 'Open the Intent OS chat — the app\'s main brain: read and run portfolio, markets, swap, farm, lending and strategies from live data there.',
      ui: { type: 'TEXT' },
      intent: { type: 'INTENT_OS', ...u4, entities },
      actions: [{ id: 'open-intent-os', route: '/intent', label: 'Intent OS ↗' }],
      goalDetected: false
    };
  }
  if (['OPS_CENTER', 'AGENTS', 'STRATEGY', 'SYSTEM_STATUS'].includes(type) && String(surface || '').startsWith('/intent')) {
    const tab = { OPS_CENTER: 'ops', AGENTS: 'agents', STRATEGY: 'strategies', SYSTEM_STATUS: 'status' }[type];
    const target = resolveChatRoute(`/intent?tab=${tab}`, { currentPathname: '/intent' });
    const show = target.kind === 'panel'
      ? { openPanel: target.panel }
      : target.kind === 'ecosystem'
        ? { openEcosystem: target.ecoKind }
        : { openTab: target.tab || 'chat' };
    const name = fa
      ? ({ OPS_CENTER: 'مرکز عملیات', AGENTS: 'ایجنت‌ها', STRATEGY: 'استراتژی‌ها', SYSTEM_STATUS: 'وضعیت سیستم' })[type]
      : type;
    return {
      ok: true,
      text: fa
        ? `${name} همین‌جاست — در همین صفحه‌ی Intent OS نشانش می‌دهم؛ لازم نیست جایی بروی.`
        : `${name} lives here — showing it on this same Intent OS page; nowhere to go.`,
      ui: { type: 'TEXT' },
      intent: { type, ...u4, entities },
      inPlace: true,
      ...show,
      actions: [{ id: `open-${tab}`, route: `/intent?tab=${tab}`, label: fa ? 'نمایش' : 'Show' }],
      goalDetected: false
    };
  }
  return null;
}

router.post('/chat', async (req, res) => {
  const message = String(req.body?.message || '').slice(0, MAX_MESSAGE);
  if (!message.trim()) return res.status(400).json({ ok: false, error: 'EMPTY_MESSAGE' });
  const context = await buildAIContext(req, req.body || {});
  const locale = safe(req.body?.locale, 5) || null;
  const conversationId = safe(req.body?.conversationId, 64) || null;
  const prior = req.body?.prior && AI_INTENTS.includes(String(req.body.prior.intent || '').toUpperCase())
    ? { intent: String(req.body.prior.intent).toUpperCase(), surface: req.body.prior.surface || null }
    : null;

  // Upgrade 4 Intent Understanding & Context Resolution
  const u4 = understandIntent(message, {
    locale,
    prior,
    conversationId,
    currentPage: req.body?.surface || req.body?.currentPage || '/',
    wallet: context.wallet,
    portfolio: context.portfolio
  });

  if (conversationId) {
    updateIntentSession(conversationId, {
      currentIntent: u4.primaryIntent || u4.type,
      entities: u4.entities,
      missingFields: u4.missingInformation,
      assumptions: u4.assumptions,
      confidence: u4.confidence,
      isCorrection: u4.isCorrection
    });
  }

  /* Rich objective / in-place turns are answered here (see above): the V1
     renderer below cannot express them and would fall back to a generic line. */
  const surface = req.body?.surface || req.body?.currentPage || '/';
  const rich = richObjectiveReply({ message, u4, context, locale: locale || 'fa', surface,
    messages: Array.isArray(req.body?.messages) ? req.body.messages.slice(-8)
      .filter((row) => row && (row.role === 'ai' || row.role === 'assistant' || row.role === 'user'))
      .map((row) => ({ role: row.role,
        content: String(row.content || '').slice(0, 1200),
        ...(typeof row.strategyRequest?.text === 'string'
          ? { strategyRequest: { text: row.strategyRequest.text.slice(0, 1200) } } : {}),
        ...(typeof row.strategyDraft?.text === 'string'
          ? { strategyDraft: { text: row.strategyDraft.text.slice(0, 1200) } } : {})
      })) : [] });
  if (rich?.ok) {
    const intentId = `int_${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const reply = {
      text: stripInternalLeaks(rich.text),
      message: stripInternalLeaks(rich.text),
      contract: { version: INTENT_OS_PROMPT_VERSION, executionChain: EXECUTION_CHAIN },
      intent: rich.intent || { type: u4.type, entities: u4.entities || {} },
      confidence: u4.confidence ?? 0.8,
      ui: rich.ui || { type: 'TEXT' },
      card: null,
      actions: Array.isArray(rich.actions) ? rich.actions : [],
      suggestions: Array.isArray(rich.suggestions) ? rich.suggestions : suggestionsFor({ message, intent: rich.intent?.type || u4.type, context }),
      pendingIntent: null,
      intentId,
      actionPlan: null,
      actionPlanId: null,
      choices: [],
      choiceKind: null,
      goalDetected: rich.goalDetected === true,
      strategyRequest: rich.strategyRequest || null,
      strategyDraft: rich.strategyDraft || null,
      goalRequest: rich.goalRequest || null,
      inPlace: rich.inPlace === true,
      openTab: rich.openTab || null,
      openPanel: rich.openPanel || null,
      openEcosystem: rich.openEcosystem || null,
      executed: false,
      broadcasts: false,
      requiresUserSignature: false
    };
    recordIntentOutcome({
      intentId,
      intentType: rich.intent?.type || 'GENERAL',
      providerUsed: 'internal',
      modelsConsulted: ['internal'],
      confidenceScore: Math.round((Number(u4.confidence) || 0.5) * 100),
      executionSuccess: null,
      durationMs: 0,
      locale: locale || 'fa'
    }).catch(() => {});
    const nextMemory = await appendMemory(ownerFor(req), {
      conversationId: req.body?.conversationId || null,
      summary: safeMemoryText(`${(context.conversationSummary || '').slice(-600)}\n${safe(message, 240)}`.slice(-900), 600) || safe(message, 240),
      recentIntents: [rich.intent?.type || 'GENERAL', safe(message, 240)],
      preferences: [],
      activeTasks: [],
      goals: rich.goalDetected ? ['financial-goal'] : []
    });
    return res.json({
      ok: true,
      schema: 'fbt.ai-chat.v1',
      reply,
      context: { ...context, conversationSummary: nextMemory.summary || context.conversationSummary },
      at: nowMs()
    });
  }

  const local = classifyIntent(message, { locale, prior });
  let llm = null;
  if (aiConfigured() && local.confidence < 0.6 && !req.body?.surface) {
    llm = await classifyIntentWithModel({ message, intents: AI_INTENTS, locale });
  }
  const intent = llm?.ok === true ? llm.intent : (u4.type !== 'GENERAL' ? u4.type : local.intent);
  const classification = llm?.ok === true && llm.intent !== local.intent
    ? { ...local, intent, source: 'model-override', confidence: Math.max(local.confidence, Number(llm.confidence) || 0) }
    : { ...local, intent: intent || local.intent };

  const ctx = {
    ...context,
    locale,
    prior,
    aiControl: sanitizeAiControl(req.body?.aiControl || AI_CONTROL_DEFAULTS),
    market: context.market,
    yields: context.yields,
    priceMap: context.market?.priceMap || undefined,
    solanaAssets: context.solanaAssets,
    now: nowMs()
  };

  const out = orchestrate({ message, surface: req.body?.surface || null, context: ctx });
  const intentId = `int_${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const goalDetected = /goal|هدف|دو برابر|double|triple|دوبل/i.test(message) && (context.portfolio?.totalValueUsd != null || /goal|هدف|دو برابر|double/i.test(message));
  const resumed = req.body?.resume === true;
  const suggestions = suggestionsFor({ message, intent: out.plan.intent, context });
  /*
   * The deterministic renderer (`humanResponse.js`) speaks two languages and
   * treats anything that is not English as Persian — so a Portuguese, Turkish
   * or Russian turn that reached it came back in Farsi. The conversation layer
   * added in Upgrade 13 speaks twelve; this legacy path gets at least the right
   * one of its two: Persian when the human actually wrote Persian, or said
   * nothing that carries a language while the interface is Persian. Never
   * Persian by default for somebody who cannot read it.
   */
  const replyLang = respondIn(message, { declared: locale || 'fa' }).lang;
  const deterministicLocale = replyLang === 'fa' ? 'fa' : 'en';
  const human = formatHumanResponse({
    message,
    classification,
    orchestrateOut: out,
    context,
    locale: deterministicLocale,
    resumed,
    suggestions,
    intentId,
    resolvedHints: req.body?.hints && typeof req.body.hints === 'object' ? req.body.hints : null
  });
  logInternal('chat', {
    intent: human.intent,
    plan: out.plan,
    verdict: out.verdict,
    actions: human.actions
  });

  /* One pending intent per turn, carrying the resolved plan. Confirm then
     continues THIS intent by id — it never re-parses the word "OK". */
  let pendingIntent = human.pendingIntent || null;
  if (!pendingIntent && (human.actionPlan || human.ui?.type === 'ACTION_CARD' || human.ui?.type === 'CHOICE')) {
    const made = createPendingIntent({
      originalMessage: message,
      intentType: human.intent?.type || 'GENERAL',
      status: human.ui?.type === 'ACTION_CARD' ? 'READY' : 'NEEDS_USER_INPUT',
      conversationId: safe(req.body?.conversationId, 64) || null,
      actionPlan: human.actionPlan || null,
      locale
    });
    if (made.ok) pendingIntent = { ...made.intent, id: intentId };
  } else if (pendingIntent && human.actionPlan) {
    pendingIntent = { ...pendingIntent, id: intentId, actionPlan: human.actionPlan, actionPlanId: human.actionPlan.intentId || null };
  }
  if (pendingIntent) await writePending(ownerFor(req), pendingIntent);

  const confidenceMetrics = evaluateConfidenceMetrics({
    intent: u4.type !== 'GENERAL' ? u4 : human.intent,
    context,
    dataStatus: context.portfolio?.dataStatus || 'live'
  });

  /* ─── AI UPGRADE 5 — COLLABORATIVE INTELLIGENCE LAYER ───────────────────
     The deterministic question analyzer (planCollaboration) decides how much
     intelligence THIS turn needs — «سلام» costs zero extra model calls. For
     knowledge/market/news/research turns the collaboration engine coordinates
     the configured providers, tools, web research and verification within a
     hard deadline. If it degrades or times out, the existing deterministic
     reply stands: the upgrade can only improve an answer, never break one.
     Execution authority is untouched — this layer never signs, sends or
     approves anything (§67). */
  /*
   * ─── WHICH TURNS THE EXTERNAL FLEET IS ALLOWED TO HELP ON ────────────────
   * This list used to stop at market/news/risk. Every portfolio, yield,
   * lending and rebalance turn — the ones a user actually asks the assistant
   * about — fell through to the deterministic reply alone, so on a deployment
   * that HAS keys the fleet still sat idle for most of the conversation. That
   * is the other half of «مدل‌ها فعال نیستن»: registered, keyed, and never
   * called.
   *
   * The safety properties are unchanged and are what make widening safe:
   *   · the numbers still come from the wallet/portfolio tool data injected
   *     into the turn — a model never supplies a balance or a price
   *   · `collaborationUsable` below still demands grounding, so a degraded
   *     no-evidence answer can never overwrite the deterministic reply
   *   · `u5.level >= 2` still gates on complexity, so «سلام» costs no calls
   *   · execution authority is untouched (§67)
   */
  const COLLABORATION_INTENTS = [
    'GENERAL', 'MARKET_ANALYSIS', 'MARKET_CONTEXT', 'NEWS_SEARCH', 'ANALYZE_TOKEN',
    'RISK_ANALYSIS', 'LEARN', 'SIGNALS', 'SMART_MONEY', 'STRATEGY', 'OPEN_CALM',
    'PORTFOLIO_ANALYSIS', 'INVESTMENT_PLAN', 'YIELD_DISCOVERY', 'STAKING', 'LEND',
    'FARM', 'REBALANCE', 'STOCKS', 'WHALE'
  ];
  const u5 = planCollaboration({
    message,
    intentType: intent || 'GENERAL',
    entities: u4.entities || {},
    context: { currentPage: req.body?.surface || req.body?.currentPage || '/' },
    priorIntent: prior?.intent || null,
    locale: locale || 'fa'
  });
  /*
   * ─── UPGRADE 13 — THE SOCIAL TURN IS ANSWERED BEFORE ANYTHING ELSE ──────
   * Two sentences that used to leave this route through the same door as a
   * research request:
   *
   *   «حالت چطوره»   → was classified RESEARCH(0.98) and answered with a market
   *                    pointer; now a pleasantry, answered as one, in the
   *                    language it was written in, for zero provider calls.
   *   «چخبر»          → was a greeting; now recognised as a request to be told
   *                    what is going on and answered with a real economic brief
   *                    built from the market, yield and portfolio reads this
   *                    turn already has — and it names what it could not read.
   *
   * `handled` is false for every turn carrying an action card, a pending intent
   * or a wallet request, so this block cannot intercept anything that moves
   * money (§67).
   */
  const socialTurn = composeSocialTurn({
    u5,
    human,
    context,
    locale: locale || 'fa',
    now: nowMs(),
    transparency: req.body?.transparency === true
  });
  const isCollaborativeIntent = COLLABORATION_INTENTS.includes(String(human.intent?.type || intent || 'GENERAL'));
  const collaborationWanted = isCollaborativeIntent
    && !human.pendingIntent
    && !['ACTION_CARD', 'CONNECT_WALLET', 'CHOICE'].includes(human.ui?.type)
    && u5.level >= 2
    && !socialTurn.handled;

  let collaboration = null;
  if (collaborationWanted) {
    try {
      collaboration = await runCollaborativeAnalysis({
        message,
        context: {
          market: context.market,
          portfolio: context.portfolio,
          locale: locale || 'fa'
        },
        intentType: human.intent?.type || intent,
        entities: u4.entities || {},
        analysis: u5,
        locale: locale || 'fa',
        transparency: req.body?.transparency === true
      });
    } catch (err) {
      logInternal('collab-error', { error: String(err?.message || err).slice(0, 160) });
      collaboration = null;
    }
  }

  /* ─── LIVE TOKEN CARD — one asset per turn, chart + 24h high/low ──────
     Fires only when the turn is actually about an asset, uses the same
     cached market read the coin page renders, and can only ADD a card —
     it never rewrites the deterministic text or the execution state. */
  const chatToken = u4?.entities?.token || null;
  const chatIntentType = String(human.intent?.type || intent || '').toUpperCase();
  let tokenCard = null;
  if (
    chatToken
    && !human.card
    && !human.pendingIntent
    && !['ACTION_CARD', 'CONNECT_WALLET', 'CHOICE'].includes(human.ui?.type)
    && ['ANALYZE_TOKEN', 'MARKET_ANALYSIS', 'MARKET_CONTEXT', 'GENERAL', 'RISK_ANALYSIS', 'WHALE'].includes(chatIntentType)
  ) {
    tokenCard = await buildTokenCard(chatToken);
  }

  /* Only replace the reply when the collaboration produced a real, grounded
     answer — a degraded no-evidence answer never overwrites the existing
     deterministic reply. */
  const collaborationUsable = Boolean(
    collaboration?.ok
    && String(collaboration.answer || '').trim().length > 20
    && (!collaboration.degraded || collaboration.evidence.knowledgeUsed || collaboration.evidence.toolDataUsed || collaboration.evidence.webUsed)
  );
  let finalText = socialTurn.handled ? socialTurn.text : human.message;
  if (socialTurn.handled) {
    /* The social reply IS the answer: a card or a model pass cannot overwrite
       a pleasantry, and it must not be "improved" into a pitch. */
  } else if (collaborationUsable) {
    finalText = collaboration.answer;
  } else if (tokenCard) {
    /* No model pass (or a degraded one) — the card still carries REAL data,
       so the deterministic text answers with numbers instead of a pointer
       to the market page. Same numbers, same source, chart attached. */
    const faAns = String(locale || 'fa').toLowerCase().startsWith('fa');
    const fmtUsd = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return null;
      if (n >= 1e12) return `$${(Math.round((n / 1e12) * 100) / 100).toLocaleString('en-US')}T`;
      if (n >= 1e9) return `$${(Math.round((n / 1e9) * 100) / 100).toLocaleString('en-US')}B`;
      if (n >= 1e6) return `$${(Math.round((n / 1e6) * 100) / 100).toLocaleString('en-US')}M`;
      if (n >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`;
      return `$${(Math.round(n * 100) / 100).toLocaleString('en-US')}`;
    };
    const sgnPct = (v) => (Number.isFinite(Number(v)) ? `${Number(v) >= 0 ? '+' : ''}${Math.round(Number(v) * 100) / 100}%` : 'N/A');
    const lines = [];
    lines.push(faAns ? `📊 ${tokenCard.name || ''} (${tokenCard.symbol})` : `📊 ${tokenCard.name || ''} (${tokenCard.symbol})`);
    lines.push(faAns
      ? `قیمت لحظه‌ای: ${fmtUsd(tokenCard.priceUsd) || 'N/A'} (${sgnPct(tokenCard.change24hPct)} در ۲۴ ساعت)`
      : `Live price: ${fmtUsd(tokenCard.priceUsd) || 'N/A'} (${sgnPct(tokenCard.change24hPct)} in 24h)`);
    if (tokenCard.high24h != null || tokenCard.low24h != null) {
      lines.push(faAns
        ? `بالاترین ۲۴ ساعت: ${fmtUsd(tokenCard.high24h) || 'N/A'} · کمترین: ${fmtUsd(tokenCard.low24h) || 'N/A'}`
        : `24h high: ${fmtUsd(tokenCard.high24h) || 'N/A'} · low: ${fmtUsd(tokenCard.low24h) || 'N/A'}`);
    }
    const bits = [];
    if (tokenCard.change1hPct != null) bits.push(`${faAns ? '۱ساعت' : '1h'} ${sgnPct(tokenCard.change1hPct)}`);
    if (tokenCard.change7dPct != null) bits.push(`${faAns ? '۷روز' : '7d'} ${sgnPct(tokenCard.change7dPct)}`);
    if (tokenCard.marketCapUsd != null) bits.push(`${faAns ? 'حجم بازار' : 'Mkt cap'} ${fmtUsd(tokenCard.marketCapUsd)}`);
    if (tokenCard.volume24hUsd != null) bits.push(`${faAns ? 'معاملات' : 'Vol'} ${fmtUsd(tokenCard.volume24hUsd)}`);
    if (tokenCard.rank != null) bits.push(`#${tokenCard.rank}`);
    if (bits.length) lines.push(bits.join(' · '));
    lines.push(faAns
      ? 'نمودار ۷ روزه و بازه بالاترین/کمترین قیمت در کارت زیر است.'
      : 'The 7-day chart and the 24h high/low range are in the card below.');
    finalText = lines.join('\n');
  } else {
    /* Even without a model pass, an emotional turn gets acknowledged (§25). */
    const ack = formatEmotionalAcknowledgement({ emotion: u5.emotion, fomo: u5.fomo, locale: locale || 'fa' });
    if (ack && (u5.conversationKind === 'EMOTIONAL' || u5.emotion.state === 'panic' || u5.emotion.state === 'fearful' || u5.fomo.detected)) {
      finalText = `${ack}\n\n${finalText}`;
    }
  }

  /*
   * ─── UPGRADE 13 — "ASK THE OTHER ONES" IS NOW LITERAL ──────────────────
   * If the reply this route is about to send is a non-answer — a shrug, a
   * "data unavailable", a sub-0.45-confidence guess — the remaining providers
   * are consulted inside one deadline, and the first real answer wins.
   *
   * What this cannot do, in order of how much it matters:
   *   · it never runs for a wallet/portfolio/balance question: those numbers
   *     are TOOL_TRUTH, and a model inventing a balance is the worst possible
   *     output of this app
   *   · it never runs on an execution turn, a card, or a pending intent
   *   · it never grants authority: `answeredBy` is provenance for the honesty
   *     ledger, not a signature path
   *   · if every provider refuses, the deterministic reply STANDS — an
   *     escalation can only improve an answer, never replace one with silence
   */
  let escalation = null;
  const gap = answerGap({
    message,
    text: finalText,
    intentType: human.intent?.type || intent || 'GENERAL',
    confidence: out.plan.confidence,
    dataStatus: context.portfolio?.dataStatus || null,
    hasCard: Boolean(tokenCard) || ['ACTION_CARD', 'CONNECT_WALLET', 'CHOICE'].includes(human.ui?.type),
    hasPendingIntent: Boolean(pendingIntent),
    socialHandled: Boolean(socialTurn.handled)
  });
  if (gap.escalate) {
    escalation = await escalateToProviders({
      message,
      locale: socialTurn.social?.lang || u5.social?.lang || locale || 'fa',
      context,
      exclude: [...new Set([...(collaboration?.providersUsed || []), ...(llm?.provider ? [llm.provider] : [])])],
      taskType: u5.taskTypes?.includes('market') ? 'market' : 'general'
    }).catch(() => null);
    if (escalation?.ok && String(escalation.answer || '').trim().length > 20) {
      finalText = escalation.answer;
    }
  }

  const reply = {
    text: stripInternalLeaks(finalText),
    message: stripInternalLeaks(finalText),
    /* Upgrade 13 — how the turn was understood. The UI may show the language
       badge and the brief; nothing here changes what the buttons do. */
    social: socialTurn.social || u5.social || null,
    brief: socialTurn.brief || null,
    /* The governing behavior contract (execution-first spec v2.0) travels with
       the reply so the frontend renders state instead of guessing it (§49). */
    contract: {
      version: INTENT_OS_PROMPT_VERSION,
      executionChain: EXECUTION_CHAIN
    },
    intent: {
      ...human.intent,
      ...u4,
      /* The OS classifier (u4) outranks the V1 lexicon when it is specific:
         V1 called «1000 دلار … سود ۳۰ درصد» GENERAL and its label overwrote
         the correct STRATEGY_PLAN here — the client then rendered the generic
         fallback instead of the engine card. */
      type: (u4?.type && u4.type !== 'GENERAL') ? u4.type : (human.intent?.type || u4?.type || 'GENERAL')
    },
    confidence: out.plan.confidence,
    confidenceMetrics,
    multiAi: {
      activeProviders: getActiveProviderIds(),
      confidenceScore: confidenceMetrics.confidenceScore,
      riskScore: confidenceMetrics.riskScore,
      dataFreshness: confidenceMetrics.dataFreshness
    },
    /* AI Upgrade 5 intelligence metadata — the UI renders only what is useful
       to the user (sources, uncertainty, feedback); the rest stays internal. */
    intelligence: {
      schema: 'fbt.intelligence-meta.v1',
      level: u5.level,
      conversationKind: u5.conversationKind,
      complexity: u5.complexity,
      freshness: u5.freshness,
      emotion: u5.emotion.state,
      fomo: u5.fomo.detected,
      providersUsed: collaboration?.providersUsed || [],
      modelsConsulted: collaboration?.modelsConsulted || [],
      sources: collaboration?.sources || [],
      uncertainty: collaboration?.uncertainty || null,
      disagreement: collaboration?.disagreement || false,
      consensus: collaboration?.consensus || null,
      quality: collaboration?.quality?.answerQualityScore ?? null,
      degraded: collaboration?.degraded ?? false,
      webUsed: collaboration?.evidence?.webUsed || false,
      latencyMs: collaboration?.latencyMs || 0,
      /* Upgrade 13: the escalation trail. `gapReasons` says WHY the fleet was
         consulted and `providersTried` says who was asked and what each of them
         did — including the refusals, because "the model declined" is a fact
         the operator is entitled to see and the user is not. */
      escalation: escalation ? {
        schema: ESCALATION_SCHEMA,
        used: escalation.providerCalls || 0,
        answeredBy: escalation.answeredBy || null,
        reason: escalation.reason || null,
        providersTried: (escalation.tried || []).map((t) => ({ provider: t.provider, status: t.status })),
        gapReasons: gap.reasons || [],
        executionAuthorized: false
      } : (gap.reasons?.length ? { used: 0, gapReasons: gap.reasons, executionAuthorized: false } : null)
    },
    ui: human.ui,
    card: human.card || tokenCard,
    actions: human.actions,
    suggestions: human.suggestions,
    rebalance: human.rebalance || null,
    pendingIntent: pendingIntent || null,
    intentId,
    actionPlan: human.actionPlan || null,
    actionPlanId: human.actionPlan?.intentId || null,
    choices: human.choices || [],
    choiceKind: human.choiceKind || null,
    goalDetected,
    executed: false,
    broadcasts: false,
    requiresUserSignature: human.ui?.type === 'ACTION_CARD'
  };

  recordIntentOutcome({
    intentId,
    intentType: human.intent?.type || 'GENERAL',
    providerUsed: llm?.model ? 'gateway-llm' : 'internal',
    modelsConsulted: llm?.model ? [llm.model] : ['internal'],
    confidenceScore: confidenceMetrics.confidenceScore,
    executionSuccess: null,
    durationMs: nowMs() - ctx.now,
    locale: locale || 'fa'
  }).catch(() => {});

  /* AI Upgrade 5 — Customer Question Intelligence (§28): anonymized,
     fire-and-forget. The secret guard inside recordQuestion rejects anything
     sensitive; only cluster counters and a short redacted sample persist. */
  recordQuestion({
    message,
    intentType: human.intent?.type || 'GENERAL',
    conversationKind: u5.conversationKind,
    freshness: u5.freshness,
    level: u5.level,
    resolved: !(u4.missingInformation?.length > 0) && !u4.isCorrection,
    clarificationAsked: Boolean(u4.missingInformation?.length > 0),
    confidenceScore: confidenceMetrics.confidenceScore,
    correctionDetected: Boolean(u4.isCorrection),
    webUsed: Boolean(collaboration?.evidence?.webUsed),
    multiAiUsed: (collaboration?.modelsConsulted?.length || 0) > 1,
    toolUsed: Boolean(collaboration?.evidence?.toolDataUsed || out.plan?.actions?.length),
    locale: locale || 'fa'
  }).catch(() => {});

  const safeSummary = safe(message, 240);
  const recent = (context.conversationSummary || '').slice(-600);
  const concatenated = `${recent}\n${safeSummary}`.slice(-900);
  const nextMemory = await appendMemory(ownerFor(req), {
    conversationId: req.body?.conversationId || null,
    summary: safeMemoryText(concatenated, 600) || safeSummary,
    recentIntents: [out.plan.intent, safeSummary],
    preferences: [],
    activeTasks: (out.plan.actions || []).map((a) => `${a.type}:${a.asset || ''}`),
    goals: goalDetected ? ['financial-goal'] : []
  });

  return res.json({
    ok: true,
    schema: 'fbt.ai-chat.v1',
    reply,
    context: {
      ...context,
      conversationSummary: nextMemory.summary || context.conversationSummary
    },
    at: nowMs()
  });
});

router.post('/execute', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const context = await buildAIContext(req, body);
  const locale = safe(body.locale, 5) || 'fa';
  const rawActions = Array.isArray(body.actions) && body.actions.length
    ? body.actions
    : (body.action ? [body.action] : (body.plan?.actions || []));
  const message = String(body.message || '');
  const userIntent = classifyUserIntent(message, null);
  const kind = String(body.intentType || userIntent.type || rawActions[0]?.type || 'SWAP').toUpperCase();

  if (!context.wallet?.connected) {
    const pending = createPendingIntent({
      originalMessage: message || kind,
      intentType: kind,
      status: 'WAITING_FOR_WALLET',
      locale
    });
    if (pending.ok) await writePending(ownerFor(req), pending.intent);
    const human = humanizeError('WALLET_REQUIRED', { locale });
    logInternal('execute', { status: 'WALLET_REQUIRED', intent: kind });
    return res.status(412).json({
      ok: false,
      schema: 'fbt.ai-execute.v1',
      status: 'WALLET_REQUIRED',
      success: false,
      message: human.message,
      ui: { type: 'CONNECT_WALLET' },
      pendingIntent: pending.ok ? pending.intent : null,
      execution: { success: false, status: 'WALLET_REQUIRED' }
    });
  }

  let actions = rawActions;
  let resolvedPlan = null;
  let rebalance = body.rebalance || null;
  if (kind === 'REBALANCE' || kind === 'REBALANCE_PORTFOLIO') {
    rebalance = planRebalance({
      holdings: context.portfolio?.holdings || [],
      balances: context.balances || [],
      target: body.target || null
    });
    if (!rebalance.ok) {
      const human = humanizeError(rebalance.code || 'EMPTY_PORTFOLIO', { locale });
      return res.status(409).json({
        ok: false,
        schema: 'fbt.ai-execute.v1',
        status: 'FAILED',
        success: false,
        message: human.message,
        ui: { type: 'TEXT' },
        execution: { success: false, status: 'FAILED', error: { code: rebalance.code || 'EMPTY_PORTFOLIO' } }
      });
    }
    actions = rebalance.trades;
  }

  /* ------------------------------------------------------------------
     No legs on the request is NOT "your request is incomplete". The wallet,
     the balances and the conversation usually already answer it. Resolve
     first (spec §1/§8); only a genuinely unanswerable question is asked, and
     it is asked with options, never as a dead end.
     ------------------------------------------------------------------ */
  if (!actions.length) {
    const carried = body.actionPlan && typeof body.actionPlan === 'object' ? body.actionPlan : null;
    const stored = await readPending(ownerFor(req));
    /* A stored plan may only be reused for the SAME intent. Matching by
       nothing at all made a fresh "نصف USDC" request silently execute the
       previous "100 USDC" plan. */
    const sameIntent = Boolean(stored)
      && stored.actionPlan?.ready === true
      && (
        (body.intentId && stored.id && String(body.intentId) === String(stored.id))
        || (!message && stored.originalMessage)
        || (message && stored.originalMessage === message)
      );
    const reuse = carried?.ready === true ? carried : (sameIntent ? stored.actionPlan : null);
    if (reuse && Array.isArray(reuse.actions) && reuse.actions.length) {
      actions = reuse.actions;
      resolvedPlan = reuse;
    } else {
      const resolved = buildActionPlan({
        intentId: body.intentId || stored?.id || null,
        type: kind,
        message: message || stored?.originalMessage || '',
        context,
        hints: body.hints && typeof body.hints === 'object' ? body.hints : {}
      });
      if (isExecutionReady(resolved)) {
        actions = resolved.actions;
        resolvedPlan = resolved;
      } else {
        const ask = narrateMissingInformation(resolved, { locale });
        logInternal('execute', { status: resolved.status, intent: kind });
        return res.status(200).json({
          ok: true,
          schema: 'fbt.ai-execute.v1',
          status: resolved.status,
          success: false,
          message: ask.message,
          ui: ask.ui,
          choices: ask.choices,
          choiceKind: ask.choiceKind || null,
          actionPlan: resolved,
          requiresConfirmation: false,
          execution: { success: false, status: resolved.status }
        });
      }
    }
  }

  /* Constitution (immutable ceilings) runs BEFORE every other gate: no
     aiControl payload, chat wording or model output can lift it. */
  const constitution = checkConstitution({ actions, balances: context.balances || null, enforceChain: false });
  if (!constitution.ok) {
    logInternal('execute', { status: 'CONSTITUTION_BLOCKED', article: constitution.violations[0]?.article, intent: kind });
    return res.status(409).json({
      ok: false,
      schema: 'fbt.ai-execute.v1',
      status: 'FAILED',
      success: false,
      message: explainConstitution(constitution, locale),
      ui: { type: 'TEXT' },
      constitution,
      execution: { success: false, status: 'FAILED', error: { code: 'CONSTITUTION_VIOLATION', article: constitution.violations[0]?.article || null } }
    });
  }

  const validator = validateAction(actions[0], context);
  if (!validator.ok && validator.reason !== 'WALLET_REQUIRED') {
    const human = humanizeError(validator.reason, { locale });
    logInternal('execute', { status: validator.reason, intent: kind });
    return res.status(400).json({
      ok: false,
      schema: 'fbt.ai-execute.v1',
      status: 'FAILED',
      success: false,
      message: human.message,
      ui: { type: human.ui === 'CONNECT_WALLET' ? 'CONNECT_WALLET' : 'TEXT' },
      execution: { success: false, status: 'FAILED', error: { code: validator.reason, message: validator.detail } }
    });
  }

  const synthesizedPlan = {
    id: `os_${nowMs().toString(36)}`,
    intent: kind,
    surface: 'ask',
    actions: actions.map((a) => ({
      type: a.type || validator.type,
      asset: a.asset || a.to || validator.asset,
      from: a.from || null,
      to: a.to || null,
      amount: a.amount != null ? String(a.amount) : (validator.amount != null ? String(validator.amount) : null),
      amountUsd: a.amountUsd ?? validator.amount,
      chainId: a.chainId ?? validator.chainId,
      parameters: a.parameters || validator.parameters
    })),
    capitalUsd: validator.amount
  };
  const verdict = validateExecution(synthesizedPlan, {
    aiControl: sanitizeAiControl(body.aiControl || AI_CONTROL_DEFAULTS),
    dailyVolumeUsd: Number(body.dailyVolumeUsd) || 0,
    wallet: context.wallet,
    automations: context.activeAutomations
  });
  const stages = executionStageLedger(synthesizedPlan, verdict, {
    wallet: context.wallet,
    simulation: null,
    quote: null
  });

  if (!verdict.ok && verdict.reason && verdict.reason !== 'WALLET_REQUIRED' && verdict.reason !== 'APPROVAL_REQUIRED') {
    const human = humanizeError(verdict.reason, { locale });
    logInternal('execute', { status: 'BLOCKED', reason: verdict.reason, intent: kind });
    return res.status(409).json({
      ok: false,
      schema: 'fbt.ai-execute.v1',
      status: 'FAILED',
      success: false,
      message: human.message,
      ui: { type: 'TEXT' },
      execution: { success: false, status: 'FAILED', error: { code: verdict.reason, message: verdict.reasonDetail } }
    });
  }

  /* The server NEVER signs and NEVER reports CONFIRMED. It returns an
     execution plan the wallet-side runtime must walk. No receipt → no success. */
  const execPlan = createExecutionPlan({
    intentId: synthesizedPlan.id,
    actions: synthesizedPlan.actions
  });
  const unsigned = toExecutionResult(execPlan);
  logInternal('execute', { status: 'PLAN_READY', intent: kind, action: synthesizedPlan.actions[0] });

  const existing = await readPending(ownerFor(req));
  if (existing && existing.status !== 'COMPLETED') {
    const moved = transitionPendingIntent(existing, existing.status === 'WAITING_FOR_WALLET' ? 'READY' : 'EXECUTING');
    if (moved.ok) await writePending(ownerFor(req), moved.intent);
  }

  return res.json({
    ok: true,
    schema: 'fbt.ai-execute.v1',
    status: 'PLAN_READY',
    success: false,
    message: locale && String(locale).toLowerCase().startsWith('en')
      ? 'The plan is ready. Sign each transaction in your wallet — I will only call it done after the chain confirms.'
      : 'برنامه آماده است. هر معامله را در کیف پول امضا کنید — فقط بعد از تأیید زنجیره آن را انجام‌شده اعلام می‌کنم.',
    ui: { type: 'ACTION_CARD' },
    action: validator,
    actions: synthesizedPlan.actions,
    actionPlan: resolvedPlan,
    rebalance,
    plan: execPlan,
    execution: { ...unsigned, success: false, status: 'PENDING' },
    requiresConfirmation: true,
    requiresUserSignature: true,
    /* Content-bound approval over the exact legs above. The client verifies
       it right before the wallet is asked to sign; a changed leg dies there. */
    /* Bound to the SAME legs the client will walk: it executes
       actionPlan.actions when present, otherwise `actions`. */
    approval: issueApproval({
      owner: ownerFor(req),
      actions: resolvedPlan?.actions?.length ? resolvedPlan.actions : synthesizedPlan.actions,
      intentId: synthesizedPlan.id
    }),
    constitution: { ok: true, version: constitution.version, checked: constitution.checked },
    stages: stages.stages,
    at: nowMs()
  });
});

/**
 * Continue an intent the user already approved.
 *
 * The "OK" bug (spec §26): tapping Confirm used to send the literal text "OK"
 * back through the parser, which of course found no asset and answered
 * "جزئیات این درخواست برای اجرا کامل نیست". Confirm now addresses the stored
 * intent by id and re-validates its plan against fresh context — it never
 * re-parses the confirmation word.
 */
router.post('/confirm', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const owner = ownerFor(req);
  const locale = safe(body.locale, 5) || 'fa';
  const stored = await readPending(owner);
  const intentId = safe(body.intentId, 64) || null;
  if (!stored || (intentId && stored.id && String(stored.id) !== intentId)) {
    return res.status(404).json({
      ok: false,
      schema: 'fbt.ai-confirm.v1',
      status: 'INTENT_NOT_FOUND',
      success: false,
      message: locale.startsWith('en')
        ? 'That request has expired. Tell me the goal again and I will rebuild it.'
        : 'این درخواست منقضی شده است. دوباره بگویید تا برنامه را بسازم.'
    });
  }
  if (stored.status === 'COMPLETED') {
    return res.status(409).json({ ok: false, schema: 'fbt.ai-confirm.v1', status: 'ALREADY_COMPLETED', success: false });
  }

  const context = await buildAIContext(req, body);
  const kind = String(stored.intentType || body.intentType || 'SWAP').toUpperCase();
  /* Re-resolve against fresh context: balances move between the card and the
     tap. The stored plan supplies the choices the user already made. */
  const hints = {
    ...(stored.actionPlan?.ready ? {
      sourceAsset: stored.actionPlan.source?.token || null,
      targetAsset: stored.actionPlan.destination?.token || null,
      amount: stored.actionPlan.source?.amount ?? null
    } : {}),
    ...(body.hints && typeof body.hints === 'object' ? body.hints : {})
  };
  const plan = buildActionPlan({
    intentId: stored.id || intentId,
    type: kind,
    message: stored.originalMessage || '',
    context,
    hints
  });

  if (!isExecutionReady(plan)) {
    const ask = narrateMissingInformation(plan, { locale });
    const moved = transitionPendingIntent(stored, plan.status === 'NEEDS_WALLET' ? 'WAITING_FOR_WALLET' : 'NEEDS_USER_INPUT');
    await writePending(owner, moved.ok ? { ...moved.intent, actionPlan: plan } : { ...stored, actionPlan: plan });
    return res.json({
      ok: true,
      schema: 'fbt.ai-confirm.v1',
      status: plan.status,
      success: false,
      message: ask.message,
      ui: ask.ui,
      choices: ask.choices,
      choiceKind: ask.choiceKind || null,
      intentId: stored.id || intentId,
      actionPlan: plan
    });
  }

  const constitution = checkConstitution({ actions: plan.actions, balances: context.balances || null, enforceChain: false });
  if (!constitution.ok) {
    logInternal('confirm', { status: 'CONSTITUTION_BLOCKED', article: constitution.violations[0]?.article, intent: kind });
    return res.status(409).json({
      ok: false,
      schema: 'fbt.ai-confirm.v1',
      status: 'CONSTITUTION_BLOCKED',
      success: false,
      message: explainConstitution(constitution, locale),
      ui: { type: 'TEXT' },
      constitution,
      intentId: stored.id || intentId
    });
  }

  const moved = transitionPendingIntent(stored, stored.status === 'READY' ? 'EXECUTING' : 'READY');
  await writePending(owner, moved.ok ? { ...moved.intent, actionPlan: plan } : { ...stored, actionPlan: plan });
  const narrated = narrateReadyPlan(plan, { locale });
  const execPlan = createExecutionPlan({ intentId: plan.intentId || stored.id, actions: plan.actions });
  logInternal('confirm', { status: 'PLAN_READY', intent: kind, action: plan.actions[0] });
  return res.json({
    ok: true,
    schema: 'fbt.ai-confirm.v1',
    status: 'PLAN_READY',
    success: false,
    message: narrated.message,
    ui: { type: 'ACTION_CARD' },
    card: narrated.card,
    intentId: stored.id || intentId,
    actionPlan: plan,
    actions: plan.actions,
    plan: execPlan,
    execution: { ...toExecutionResult(execPlan), success: false, status: 'PENDING' },
    requiresUserSignature: true,
    approval: issueApproval({ owner, actions: plan.actions, intentId: stored.id || intentId }),
    constitution: { ok: true, version: constitution.version, checked: constitution.checked }
  });
});

router.post('/resume', async (req, res) => {
  const owner = ownerFor(req);
  const pending = await readPending(owner);
  if (!pending) return res.json({ ok: true, schema: 'fbt.ai-pending.v1', pending: null });
  const context = await buildAIContext(req, req.body || {});
  if (context.wallet?.connected && pending.status === 'WAITING_FOR_WALLET') {
    const moved = transitionPendingIntent(pending, 'READY');
    if (moved.ok) await writePending(owner, moved.intent);
    return res.json({
      ok: true,
      schema: 'fbt.ai-pending.v1',
      pending: moved.ok ? moved.intent : pending,
      originalMessage: pending.originalMessage,
      resume: true
    });
  }
  return res.json({ ok: true, schema: 'fbt.ai-pending.v1', pending, originalMessage: pending.originalMessage, resume: false });
});

router.post('/execution-result', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const locale = safe(body.locale, 5) || 'fa';
  const result = body.execution || body.result || body;
  if (result?.success === true && result?.status === 'CONFIRMED') {
    const hasReceipt = Boolean(result.txHash || (Array.isArray(result.txHashes) && result.txHashes.length) || result.receipt);
    if (!hasReceipt) {
      const human = humanizeError('CONFIRMATION_FAILED', { locale });
      logInternal('execution-result', { status: 'NO_RECEIPT' });
      return res.status(409).json({
        ok: false,
        success: false,
        status: 'FAILED',
        message: human.message,
        execution: { success: false, status: 'FAILED', error: { code: 'NO_RECEIPT' } }
      });
    }
  }
  const formatted = formatExecutionResult({ result, rebalance: body.rebalance || null, locale });
  const owner = ownerFor(req);
  const pending = await readPending(owner);
  if (pending) {
    const next = result?.success === true ? 'COMPLETED' : (result?.status === 'USER_REJECTED' ? 'FAILED' : 'FAILED');
    const moved = transitionPendingIntent(pending, next === 'COMPLETED' ? 'COMPLETED' : 'FAILED');
    if (moved.ok) await writePending(owner, moved.intent);
  }
  logInternal('execution-result', { status: formatted.execution?.status, txHash: result?.txHash });
  return res.json({
    ok: formatted.execution?.success === true,
    schema: 'fbt.ai-execution-result.v1',
    message: formatted.message,
    ui: formatted.ui,
    card: formatted.card,
    execution: formatted.execution,
    retry: formatted.retry === true
  });
});

/* ------------------------------- automations ------------------------------ */

router.get('/automations', async (req, res) => {
  const owner = ownerFor(req);
  const rows = await readAutomations(owner);
  return res.json({
    ok: true,
    schema: 'fbt.ai-automations.v1',
    automations: rows,
    durable: storeDurable(),
    executionModel: 'real-schedule-recorded; each run goes through wallet signature, never a fake complete',
    scheduler: { ...checkScheduleAuthorization({ userAuthorization: true, guardianApproved: true, policyRechecked: true }), signs: false, submits: false }
  });
});

router.post('/automations', async (req, res) => {
  const owner = ownerFor(req);
  const made = createDurableAutomation(req.body || {}, nowMs());
  if (!made.ok) return res.status(400).json({ ok: false, error: made.code || 'AUTOMATION_INVALID' });
  const rows = await readAutomations(owner);
  const next = upsertAutomation(rows, made.automation, { now: nowMs() });
  await writeAutomations(owner, next.rows);
  return res.json({ ok: true, automation: made.automation, automations: next.rows, durable: storeDurable() });
});

router.delete('/automations/:id', async (req, res) => {
  const owner = ownerFor(req);
  const rows = await readAutomations(owner);
  const next = removeAutomation(rows, req.params.id);
  await writeAutomations(owner, next);
  return res.json({ ok: true, removed: req.params.id, automations: next });
});

router.post('/automations/:id/pause', async (req, res) => {
  const owner = ownerFor(req);
  const rows = await readAutomations(owner);
  const next = rows.map((r) => (String(r?.id) === String(req.params.id) ? { ...r, status: 'PAUSED', updatedAt: nowMs(), pausedAt: nowMs(), active: false } : r));
  await writeAutomations(owner, next);
  return res.json({ ok: true, automations: next });
});

/* Resume one automation in place. Without this the client "resumed" by
   creating a brand-new automation — pausing then resuming duplicated the
   agent on every cycle. */
router.post('/automations/:id/resume', async (req, res) => {
  const owner = ownerFor(req);
  const now = nowMs();
  const rows = await readAutomations(owner);
  const row = rows.find((r) => String(r?.id) === String(req.params.id));
  if (!row) return res.status(404).json({ ok: false, error: 'AUTOMATION_NOT_FOUND' });
  const next = rows.map((r) => (String(r?.id) === String(req.params.id)
    ? {
        ...r,
        status: 'ACTIVE',
        active: true,
        pausedAt: null,
        nextExecution: nextFire(r, now),
        nextRunAt: nextFire(r, now),
        updatedAt: now
      }
    : r));
  await writeAutomations(owner, next);
  return res.json({ ok: true, automations: next });
});

router.post('/automations/:id/result', async (req, res) => {
  const owner = ownerFor(req);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const status = String(body.status || 'FAILED').toUpperCase();
  if (!AUTOMATION_STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'BAD_AUTOMATION_STATUS' });
  const rows = await readAutomations(owner);
  const next = rows.map((r) => {
    if (String(r?.id) !== String(req.params.id)) return r;
    const txHash = safe(body.transactionHash, 128);
    return {
      ...r,
      status,
      lastExecution: nowMs(),
      result: safeMemoryText(body.result, 240),
      transactionHash: txHash || null,
      error: safeMemoryText(body.error, 240),
      updatedAt: nowMs(),
      active: status !== 'CANCELLED' && status !== 'COMPLETED' && status !== 'FAILED' ? r.active : false
    };
  });
  await writeAutomations(owner, next);
  return res.json({ ok: true, automations: next });
});

router.post('/automations/:id/run', async (req, res) => {
  const owner = ownerFor(req);
  const rows = await readAutomations(owner);
  const row = rows.find((r) => String(r?.id) === String(req.params.id));
  if (!row) return res.status(404).json({ ok: false, error: 'AUTOMATION_NOT_FOUND' });
  const kind = String(row.kind || '').toLowerCase() === 'rebalance' ? 'REBALANCE' : 'DCA';
  const action = {
    type: kind,
    asset: row.asset || 'BTC',
    amount: row.amountUsd != null ? String(row.amountUsd) : null,
    chainId: row.chainId || null
  };
  return res.json({
    ok: true,
    schema: 'fbt.ai-automation-run.v1',
    status: 'WALLET_SIGNATURE_REQUIRED',
    automation: row,
    action,
    handoff: { route: routeForAction(kind, action.chainId), type: kind },
    /* A real run is never fabricated: the user signs at the venue, then the
       client records the actual transaction hash/result below. */
    executionsRequireWalletSignature: true
  });
});

/* ------------------------------ user monitors ------------------------------ */
/*
 * "بازار را بپای" — a real, durable, price-fed monitor registry. The engine
 * (server/intentMonitoring.js) never fabricates a trigger: a missing price is
 * recorded as an error and the monitor stays ACTIVE.
 */

router.get('/monitors', async (req, res) => {
  const owner = ownerFor(req);
  if (!owner) return res.status(412).json({ ok: false, error: 'DEVICE_SCOPE_REQUIRED' });
  const monitors = await listMonitors(owner);
  return res.json({ ok: true, schema: 'fbt.intent-monitors.v1', monitors, durable: storeDurable() });
});

router.post('/monitors', async (req, res) => {
  const owner = ownerFor(req);
  if (!owner) return res.status(412).json({ ok: false, error: 'DEVICE_SCOPE_REQUIRED' });
  const made = await createMonitor(owner, req.body || {});
  if (made.error) return res.status(400).json({ ok: false, error: made.error });
  return res.json({ ok: true, schema: 'fbt.intent-monitor.v2', monitor: made.monitor, durable: storeDurable() });
});

router.post('/monitors/:id/pause', async (req, res) => {
  const owner = ownerFor(req);
  const out = await setMonitorStatus(owner, req.params.id, 'PAUSED');
  if (out.error) return res.status(out.error === 'NOT_FOUND' ? 404 : 400).json({ ok: false, error: out.error });
  return res.json({ ok: true, monitor: out.monitor });
});

router.post('/monitors/:id/resume', async (req, res) => {
  const owner = ownerFor(req);
  const out = await setMonitorStatus(owner, req.params.id, 'ACTIVE');
  if (out.error) return res.status(out.error === 'NOT_FOUND' ? 404 : 400).json({ ok: false, error: out.error });
  return res.json({ ok: true, monitor: out.monitor });
});

router.post('/monitors/:id/cancel', async (req, res) => {
  const owner = ownerFor(req);
  const out = await setMonitorStatus(owner, req.params.id, 'CANCELLED');
  if (out.error) return res.status(out.error === 'NOT_FOUND' ? 404 : 400).json({ ok: false, error: out.error });
  return res.json({ ok: true, monitor: out.monitor });
});

router.delete('/monitors/:id', async (req, res) => {
  const owner = ownerFor(req);
  const out = await deleteMonitor(owner, req.params.id);
  return res.status(out.error === 'NOT_FOUND' ? 404 : 200).json({ ok: out.error !== 'NOT_FOUND', ...out });
});

router.post('/monitors/:id/evaluate', async (req, res) => {
  const owner = ownerFor(req);
  const row = await getMonitor(owner, req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  const out = await evaluateMonitor(row);
  return res.json({
    ok: true,
    schema: 'fbt.intent-monitor-evaluate.v1',
    triggered: out.triggered === true,
    sent: out.sent === true,
    evaluation: out.evaluation,
    monitor: out.monitor,
    error: out.error || null
  });
});

router.get('/monitors/status', async (_req, res) => {
  return res.json({ ok: true, schema: 'fbt.intent-monitor-status.v1', ...(await monitorEngineStatus()) });
});

/* --------------------------------- memory --------------------------------- */

router.get('/memory', async (req, res) => {
  const mem = await readMemory(ownerFor(req));
  return res.json({ ok: true, schema: 'fbt.ai-memory.v1', memory: mem, durable: storeDurable(), secrets: false });
});

router.post('/memory', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const mem = await appendMemory(ownerFor(req), body);
  return res.json({ ok: true, memory: mem, durable: storeDurable(), secrets: false });
});

/* --------------------------------- goals ---------------------------------- */

router.post('/goal', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const owner = ownerFromRequest(req);
  if (!owner.ok) return res.status(400).json({ ok: false, error: owner.code || 'GOAL_SCOPE_REQUIRED' });
  const parsed = parseGoalFromText(safe(body.message || body.text, 600));
  const startingCapital = Number(parsed?.startingCapital) || Number(body.startingCapital);
  const targetAmount = Number(parsed?.targetAmount) || Number(body.targetAmount);
  const targetDate = Number(parsed?.targetDate) || Number(body.targetDate) || (nowMs() + 3 * 365 * 24 * 3600_000);
  const input = {
    name: safe(parsed?.name || body.name || `Goal ${safe(body.message, 40)}`, 64),
    startingCapital,
    targetAmount,
    targetDate,
    riskProfile: safe(parsed?.riskProfile || body.riskProfile, 16) || null
  };
  const made = await createGoal(owner.owner, input, { now: nowMs() });
  if (!made.ok) return res.status(400).json({ ok: false, error: made.code || 'GOAL_INVALID', detail: parsed || null });
  await appendMemory(owner.owner, { goals: [made.goal?.name || 'financial-goal'], activeTasks: ['goal'] });
  return res.json({ ok: true, schema: 'fbt.ai-goal.v1', goal: made.goal, parse: parsed });
});

router.post('/goal/:id/plan', async (req, res) => {
  const owner = ownerFromRequest(req);
  if (!owner.ok) return res.status(400).json({ ok: false, error: owner.code || 'GOAL_SCOPE_REQUIRED' });
  const goals = await listGoals(owner.owner);
  const goal = (goals.goals || []).find((g) => String(g?.id) === String(req.params.id));
  if (!goal) return res.status(404).json({ ok: false, error: 'GOAL_NOT_FOUND' });
  /* The durable goal plan endpoint in server/financialGoals.js is kept intact.
     This route is a thin AI wrapper that reports it as real rather than
     pretending the AI is the planner. */
  return res.json({
    ok: true,
    schema: 'fbt.ai-goal-plan.v1',
    goal,
    next: { route: `/financial-goals?goal=${goal.id}`, action: 'POST /api/v1/financial-goals/:id/plan' }
  });
});

export default router;
