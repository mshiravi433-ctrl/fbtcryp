/**
 * FBT CENTRAL INTELLIGENCE OS — Unified System State (§4, §16, §17).
 * ---------------------------------------------------------------------------
 * ONE state object for the whole product:
 *
 *   user/session/wallet/portfolio/markets/positions/orders/lending/borrowing/
 *   farming/liquidity/futures/dydx/transactions/goals/profitPlan/signals/
 *   news/events/alerts/capabilities/health/risk/activePage/activeModule/
 *   recentActions/pendingActions/errors/lastUpdated
 *
 * Source of truth is NEVER the LLM (§3): every slot is filled by a module
 * adapter reading a real service, or by the client for wallet-local data
 * (balances only exist in the user's wallet). Slots that cannot be filled
 * honestly carry `dataStatus: 'unavailable'` — never a guess.
 *
 * §16: after any execution the state is refreshed and every affected module
 * is re-read through `afterAction()` so no screen shows stale data.
 */
import { getModule, registeredModuleIds } from './registry.js';
import { publish } from './eventBus.js';
import { withTimeout } from './errorEngine.js';

const STATE_TTL_MS = 15_000; // freshness window for cached assembly
const REFRESH_TIMEOUT_MS = 6_000;

const sessions = new Map(); // owner -> { state, assembledAt, clientData, page }

function blankState() {
  return {
    user: {}, session: {}, wallet: {}, portfolio: {}, markets: {}, positions: {},
    orders: {}, lending: {}, borrowing: {}, farming: {}, liquidity: {},
    futures: {}, dydx: {}, transactions: {}, goals: {}, profitPlan: {},
    signals: {}, news: {}, events: {}, alerts: {}, capabilities: {}, health: {},
    risk: {}, activePage: null, activeModule: null,
    recentActions: [], pendingActions: [], errors: [],
    lastUpdated: null
  };
}

export function getSession(owner) {
  if (!sessions.has(owner)) {
    sessions.set(owner, { owner, state: blankState(), assembledAt: 0, clientData: {}, page: null });
  }
  return sessions.get(owner);
}

/**
 * Client-supplied truth. The browser owns wallet balances/positions; it
 * reports them and the brain SANITIZES them (shape-checked, never trusted
 * blindly for execution — execution re-verifies against chain/venue).
 */
export function ingestClientData(owner, data = {}) {
  const s = getSession(owner);
  const d = data && typeof data === 'object' ? data : {};
  if (d.wallet && typeof d.wallet === 'object') s.clientData.wallet = d.wallet;
  if (d.portfolio && typeof d.portfolio === 'object') s.clientData.portfolio = d.portfolio;
  if (Array.isArray(d.balances)) s.clientData.balances = d.balances.slice(0, 120);
  if (Array.isArray(d.positions)) s.clientData.positions = d.positions.slice(0, 60);
  if (Array.isArray(d.openOrders)) s.clientData.openOrders = d.openOrders.slice(0, 60);
  if (Array.isArray(d.lendingPositions)) s.clientData.lendingPositions = d.lendingPositions.slice(0, 20);
  if (Array.isArray(d.recentActivity)) s.clientData.recentActivity = d.recentActivity.slice(0, 40);
  if (d.page) s.page = d.page;
  s.state.lastUpdated = null; // force re-assembly on next read
  publish('BALANCE_CHANGED', { owner, source: 'client' }, { source: 'state-store' });
  return s;
}

export function setPage(owner, page) {
  const s = getSession(owner);
  s.page = page;
  s.state.activePage = page;
  s.state.activeModule = page?.module || null;
  return s;
}

async function safeRead(moduleId, input, ctx) {
  const adapter = getModule(moduleId);
  if (!adapter) return { dataStatus: 'unavailable', reason: 'MODULE_NOT_REGISTERED' };
  try {
    const out = await withTimeout(adapter.read(input || {}, ctx), REFRESH_TIMEOUT_MS, `read:${moduleId}`);
    if (out && out.ok === false) return { dataStatus: 'unavailable', reason: out.error || 'READ_FAILED' };
    return out ?? { dataStatus: 'unavailable' };
  } catch (err) {
    return { dataStatus: 'unavailable', reason: String(err?.message || 'READ_TIMEOUT').slice(0, 120) };
  }
}

/**
 * Assemble the unified state. Modules are read IN PARALLEL with a global
 * ceiling so one slow provider never blocks the brain. Client-provided slots
 * (wallet, portfolio, positions, lending positions) are merged verbatim after
 * sanitization — they came from the user's own wallet screen.
 */
export async function assembleState(owner, { force = false } = {}) {
  const s = getSession(owner);
  if (!force && s.state.lastUpdated && Date.now() - s.assembledAt < STATE_TTL_MS) return s.state;

  const ctx = { owner, clientData: s.clientData, page: s.page };
  const serverModules = ['markets', 'news', 'signals', 'farming', 'futures', 'dydx', 'stocks', 'goals', 'transactions', 'alerts'];
  const results = Object.fromEntries(await Promise.all(serverModules.map(async (m) => [m, await safeRead(m, {}, ctx)])));

  const state = blankState();
  state.session = { owner, at: Date.now() };
  state.wallet = s.clientData.wallet
    ? { ...s.clientData.wallet, dataStatus: 'client' }
    : { connected: false, dataStatus: 'unavailable' };
  state.portfolio = s.clientData.portfolio
    ? { ...s.clientData.portfolio, dataStatus: s.clientData.portfolio.dataStatus || 'client' }
    : { dataStatus: 'unavailable', holdings: [] };
  state.positions = { rows: s.clientData.positions || [], dataStatus: s.clientData.positions?.length ? 'client' : 'unavailable' };
  state.orders = { rows: s.clientData.openOrders || [], dataStatus: s.clientData.openOrders?.length ? 'client' : 'unavailable' };
  state.lending = {
    positions: s.clientData.lendingPositions || [],
    dataStatus: s.clientData.lendingPositions?.length ? 'client' : 'unavailable'
  };
  state.markets = results.markets;
  state.news = results.news;
  state.signals = results.signals;
  state.farming = results.farming;
  state.liquidity = results.farming; // LP pools ship with the farming read
  state.futures = results.futures;
  state.dydx = results.dydx;
  state.stocks = results.stocks;
  state.goals = results.goals;
  state.transactions = results.transactions;
  state.alerts = results.alerts || { rows: [], dataStatus: 'unavailable' };
  state.activePage = s.page;
  state.activeModule = s.page?.module || null;
  state.recentActions = (s.clientData.recentActivity || []).slice(0, 12);
  state.errors = [];
  state.lastUpdated = Date.now();

  s.state = state;
  s.assembledAt = Date.now();
  publish('STATE_REFRESHED', { owner, at: state.lastUpdated }, { source: 'state-store' });
  return state;
}

/**
 * §16 — the post-transaction refresh chain. Marks affected modules for
 * re-read, rebuilds state, and publishes the domain event so every surface
 * (frontend included) moves forward together.
 */
export async function afterAction(owner, { module, operation, result, eventType = null, eventPayload = {} } = {}) {
  const map = {
    swap: 'SWAP_COMPLETED', bridge: 'BRIDGE_COMPLETED', lending: 'LOAN_CREATED',
    borrowing: 'LOAN_CREATED', futures: 'POSITION_CHANGED', dydx: 'POSITION_CHANGED',
    wallet: 'BALANCE_CHANGED', goals: 'GOAL_PROGRESS_CHANGED', transactions: 'TRANSACTION_CONFIRMED'
  };
  publish(eventType || map[module] || 'TRANSACTION_CONFIRMED', { module, operation, ...eventPayload }, { source: 'state-store' });
  const state = await assembleState(owner, { force: true });
  return state;
}

export function recordPendingAction(owner, action) {
  const s = getSession(owner);
  s.state.pendingActions = [...(s.state.pendingActions || []).filter((a) => a.actionId !== action.actionId), action].slice(-20);
}

export function recordRecentAction(owner, action) {
  const s = getSession(owner);
  s.state.recentActions = [action, ...(s.state.recentActions || [])].slice(0, 20);
  s.state.pendingActions = (s.state.pendingActions || []).filter((a) => a.actionId !== action.actionId);
}

export function recordError(owner, errorRow) {
  const s = getSession(owner);
  s.state.errors = [errorRow, ...(s.state.errors || [])].slice(0, 20);
}

/** Test hook. */
export function resetStateStore() { sessions.clear(); }

export const _internal = { sessions };
