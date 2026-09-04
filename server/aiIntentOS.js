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
import { storeGet, storeSet, storeDurable } from './store.js';
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
import {
  getAvailableProviders,
  getActiveProviderIds,
  routedChat,
  gatewaySelfTest
} from './aiGateway.js';
import { runMultiAiDebate } from './aiConsensus.js';
import { evaluateConfidenceMetrics } from './aiConfidence.js';
import { recordIntentOutcome, getLearningInsights } from './aiLearning.js';
/* AI Upgrade 5 — Collaborative Multi-AI Intelligence + Web Research +
   Customer Question Intelligence. The deterministic question analyzer decides
   how much intelligence a turn needs; the collaboration engine coordinates
   models/tools/web inside that budget; question-intel learns what users
   actually ask. Execution authority is untouched (§67). */
import { planCollaboration } from '../src/lib/intent-ai/os/collaborationRouter.js';
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
    const { value } = await withCache('ai-os:market', 60_000, () => fetchSimplePrices(['bitcoin', 'ethereum', 'solana'], 'usd'));
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
    const { value } = await withCache('ai-os:yields', 5 * 60_000, fetchYields);
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
    const { value } = await withCache('ai-os:solana-assets', 5 * 60_000, fetchSolanaAssets);
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
  if (!value || typeof value !== 'object') return { dataStatus: 'unavailable', totalValueUsd: null, holdings: [] };
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
  const [market, yields, solanaAssets, goals] = await Promise.all([
    marketContext(),
    yieldContext(),
    solanaAssetsContext(),
    readGoals(userId)
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
    now: nowMs(),
    dataStatus: {
      wallet: wallet.connected ? 'live' : 'unavailable',
      portfolio: portfolio.dataStatus,
      market: market.dataStatus,
      yield: Array.isArray(yields) ? 'live' : 'unavailable',
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
  await storeSet(`ai:memory:v1:${owner}`, next);
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
  await storeSet(`ai:pending:v1:${owner}`, intent || null);
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
  await storeSet(`ai:automations:v1:${owner}`, rows);
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
  const human = formatHumanResponse({
    message,
    classification,
    orchestrateOut: out,
    context,
    locale: locale || 'fa',
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
  const COLLABORATION_INTENTS = ['GENERAL', 'MARKET_ANALYSIS', 'MARKET_CONTEXT', 'NEWS_SEARCH', 'ANALYZE_TOKEN', 'RISK_ANALYSIS', 'LEARN', 'SIGNALS', 'SMART_MONEY', 'STRATEGY', 'OPEN_CALM'];
  const u5 = planCollaboration({
    message,
    intentType: intent || 'GENERAL',
    entities: u4.entities || {},
    context: { currentPage: req.body?.surface || req.body?.currentPage || '/' },
    priorIntent: prior?.intent || null,
    locale: locale || 'fa'
  });
  const isCollaborativeIntent = COLLABORATION_INTENTS.includes(String(human.intent?.type || intent || 'GENERAL'));
  const collaborationWanted = isCollaborativeIntent
    && !human.pendingIntent
    && !['ACTION_CARD', 'CONNECT_WALLET', 'CHOICE'].includes(human.ui?.type)
    && u5.level >= 2;

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

  /* Only replace the reply when the collaboration produced a real, grounded
     answer — a degraded no-evidence answer never overwrites the existing
     deterministic reply. */
  const collaborationUsable = Boolean(
    collaboration?.ok
    && String(collaboration.answer || '').trim().length > 20
    && (!collaboration.degraded || collaboration.evidence.knowledgeUsed || collaboration.evidence.toolDataUsed || collaboration.evidence.webUsed)
  );
  let finalText = human.message;
  if (collaborationUsable) {
    finalText = collaboration.answer;
  } else {
    /* Even without a model pass, an emotional turn gets acknowledged (§25). */
    const ack = formatEmotionalAcknowledgement({ emotion: u5.emotion, fomo: u5.fomo, locale: locale || 'fa' });
    if (ack && (u5.conversationKind === 'EMOTIONAL' || u5.emotion.state === 'panic' || u5.emotion.state === 'fearful' || u5.fomo.detected)) {
      finalText = `${ack}\n\n${finalText}`;
    }
  }

  const reply = {
    text: stripInternalLeaks(finalText),
    message: stripInternalLeaks(finalText),
    /* The governing behavior contract (execution-first spec v2.0) travels with
       the reply so the frontend renders state instead of guessing it (§49). */
    contract: {
      version: INTENT_OS_PROMPT_VERSION,
      executionChain: EXECUTION_CHAIN
    },
    intent: {
      ...human.intent,
      ...u4,
      type: human.intent?.type || u4.type
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
      latencyMs: collaboration?.latencyMs || 0
    },
    ui: human.ui,
    card: human.card,
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
    modelsConsulted: getActiveProviderIds(),
    confidenceScore: confidenceMetrics.confidenceScore,
    executionSuccess: true,
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
    requiresUserSignature: true
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
