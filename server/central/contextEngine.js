/**
 * FBT CENTRAL INTELLIGENCE OS — Central Context Engine (§5, §6, §7).
 * ---------------------------------------------------------------------------
 * Every request is merged with the REAL context:
 *
 *   USER MESSAGE + CURRENT PAGE + CURRENT TAB + WALLET STATE + PORTFOLIO
 *   STATE + MARKET STATE + OPEN POSITIONS + PENDING TRANSACTIONS + PREVIOUS
 *   INTENT + PREVIOUS ACTION + LAST ERROR + AVAILABLE CAPABILITIES + SYSTEM
 *   HEALTH
 *
 * Conversation memory (§6) is per session/owner:
 *   lastIntent / lastEntities / lastTool / lastResult / lastAction /
 *   lastError / pendingConfirmation / conversationContext
 *
 * Anaphora resolution ("بفروشم؟" / "انجامش بده" / "sell it?") resolves the
 * missing entity from the PREVIOUS turn instead of asking the user again —
 * and only asks when the context is genuinely empty (§5).
 */
import { storeGet, storeSet } from '../store.js';

const MEMORY_TTL_MS = 6 * 3600_000;
const MAX_CONTEXT_TURNS = 24;

const EMPTY_MEMORY = Object.freeze({
  lastIntent: null,
  lastEntities: null,
  lastTool: null,
  lastResult: null,
  lastAction: null,
  lastError: null,
  pendingConfirmation: null,
  conversationContext: { turns: [] }
});

const memoryCache = new Map(); // owner -> {row, at}

const key = (owner) => `central:memory:v1:${owner || 'anon'}`;

export async function getMemory(owner) {
  const hit = memoryCache.get(owner);
  if (hit && Date.now() - hit.at < 30_000) return hit.row;
  const row = await storeGet(key(owner), null);
  const fresh = row && typeof row === 'object' && Date.now() - Number(row.at || 0) < MEMORY_TTL_MS
    ? { ...structuredClone(EMPTY_MEMORY), ...row }
    : { ...structuredClone(EMPTY_MEMORY), at: Date.now(), owner };
  memoryCache.set(owner, { row: fresh, at: Date.now() });
  return fresh;
}

export async function updateMemory(owner, patch = {}) {
  const current = await getMemory(owner);
  const next = { ...current, ...patch, at: Date.now(), owner };
  if (patch.conversationTurn) {
    const turns = [...(current.conversationContext?.turns || []), patch.conversationTurn].slice(-MAX_CONTEXT_TURNS);
    next.conversationContext = { turns };
    delete next.conversationTurn;
  }
  memoryCache.set(owner, { row: next, at: Date.now() });
  try { await storeSet(key(owner), next); } catch { /* durability is best-effort here; live session keeps working */ }
  return next;
}

/**
 * Route → module map (§7): which brain module "owns" the page the user is
 * looking at. New pages must register here — page awareness is a registry
 * fact, not a guess (§40).
 */
const ROUTE_MODULES = Object.freeze({
  '/wallet': 'wallet', '/portfolio': 'portfolio', '/swap': 'swap',
  '/bridge': 'bridge', '/loan': 'lending', '/farm': 'farming',
  '/earn': 'farming', '/perp': 'futures', '/dydx': 'dydx',
  '/stocks': 'stocks', '/invest': 'stocks', '/market': 'markets',
  '/trade': 'markets', '/signals': 'signals', '/news': 'news',
  '/predict': 'prediction', '/lab': 'lab', '/vault': 'liquidity',
  '/orders': 'transactions', '/smart-money': 'signals', '/explore': 'markets',
  '/intent': 'events', '/goals': 'goals'
});

export function routeToModule(route) {
  const r = String(route || '').split('?')[0];
  return ROUTE_MODULES[r] || null;
}

/** Page awareness (§7): the frontend reports where the user is right now. */
export function normalizePageContext(page = {}) {
  if (!page || typeof page !== 'object') return null;
  const route = String(page.route || '').slice(0, 120) || null;
  if (!route && !page.module && !page.tab) return null;
  return {
    route,
    module: String(page.module || '').toLowerCase().slice(0, 32) || routeToModule(route),
    tab: String(page.tab || '').toLowerCase().slice(0, 32) || null,
    selectedAsset: String(page.selectedAsset || '').toUpperCase().slice(0, 16) || null,
    selectedNetwork: String(page.selectedNetwork || '').toLowerCase().slice(0, 32) || null,
    walletConnected: page.walletConnected === true,
    at: Date.now()
  };
}

/* ---------------------------- anaphora resolution --------------------------- */

const DO_IT_RE = /^(انجامش بده|انجام بده|انجامش کن|تایید|باشه|آره|بله|بزن|continue|do it|go ahead|yes|confirm|proceed)\s*[!.؟?]*$/i;
const SELL_IT_RE = /(بفروشم|بفروشیمش|بفروشش|خارجش کنم|خارج بشم|sell it|should i sell|sell\?)/i;
const BUY_IT_RE = /(بخرمش|بخرم|اضافه کنم|buy it|should i buy)/i;
const IT_RE = /\b(it|that|همین|آن|این کار|اینو)\b/i;

/**
 * Merge the CURRENT message's entities with the previous turn's. A message
 * like "بفروشم؟" carries no asset of its own, so the asset comes from
 * lastEntities. Returns { resolved, source } so the response can say WHERE
 * the context came from (never invent it).
 */
export function resolveContext({ message, entities = {}, memory, page = null }) {
  const resolved = { ...entities };
  const inheritedFrom = [];
  const prev = memory?.lastEntities || {};
  const prevIntent = memory?.lastIntent || {};

  if (!resolved.asset && (SELL_IT_RE.test(message) || BUY_IT_RE.test(message) || IT_RE.test(message))) {
    if (prev.asset) { resolved.asset = prev.asset; inheritedFrom.push('asset:lastEntities'); }
  }
  if (!resolved.asset && page?.selectedAsset) {
    resolved.asset = page.selectedAsset;
    inheritedFrom.push('asset:page');
  }
  if (!resolved.network && prev.network) { resolved.network = prev.network; inheritedFrom.push('network:lastEntities'); }
  if (!resolved.network && page?.selectedNetwork) { resolved.network = page.selectedNetwork; inheritedFrom.push('network:page'); }
  if (!resolved.amount && prevIntent?.pendingAmount != null && DO_IT_RE.test(message)) {
    resolved.amount = prevIntent.pendingAmount;
    inheritedFrom.push('amount:lastIntent');
  }

  let intentHint = null;
  if (DO_IT_RE.test(message) && memory?.pendingConfirmation) intentHint = { kind: 'CONFIRM_PENDING', ref: memory.pendingConfirmation.intentId };
  else if (SELL_IT_RE.test(message)) intentHint = { kind: 'SELL_RESOLVED', asset: resolved.asset || null };
  else if (BUY_IT_RE.test(message)) intentHint = { kind: 'BUY_RESOLVED', asset: resolved.asset || null };

  return {
    resolved,
    inheritedFrom,
    intentHint,
    needsClarification: Boolean((SELL_IT_RE.test(message) || BUY_IT_RE.test(message)) && !resolved.asset)
  };
}

/** Test hook. */
export function resetMemoryCache() { memoryCache.clear(); }
