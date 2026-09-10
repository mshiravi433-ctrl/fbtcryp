/**
 * FBT INTENT AI — CHAT ROUTE CONTRACT (autonomy core, layer 4a)
 * ---------------------------------------------------------------------------
 * The user report that produced this file:
 *   «می‌زنم مرکز عملیات و گزینه باز کردن را می‌زنم، کار نمی‌کنه.»
 *
 * The cause was a route with nowhere to land. The human layer answers an
 * OPS_CENTER intent with `actions: [{ route: '/intent?tab=ops' }]`, the chat
 * calls `navigate('/intent?tab=ops')` — and the page mounted at `/intent`
 * (components/IntentAIUnified.jsx) never reads `?tab` at all. The legacy
 * pages/IntentOS.jsx DOES read it, but it is no longer routed. Same pathname,
 * new query string, nothing on screen: a button that looks dead because it is.
 *
 * This module is the single contract between "what the AI emits" and "what the
 * chat can actually open". `resolveChatRoute` turns any route string into
 * either a real navigation or an in-page action, and `INTENT_TAB_TARGETS` is
 * the enumerated list the probe in
 * test/intent-ai/chat-route-contract-probe.mjs checks against the real router
 * table in App.jsx — so a future human-layer edit that invents a route fails a
 * test instead of shipping a dead button.
 */

export const CHAT_ROUTE_SCHEMA = 'fbt.ai-chat-route.v1';

/**
 * Every `?tab=` value the human layer is allowed to emit for /intent, and the
 * in-page target it opens. Values that are panels open a sheet; values that
 * are bottom tabs switch the tab. Anything not in this map is not a target.
 */
export const INTENT_TAB_TARGETS = Object.freeze({
  ops: { kind: 'panel', panel: 'operations' },
  operations: { kind: 'panel', panel: 'operations' },
  status: { kind: 'panel', panel: 'status' },
  history: { kind: 'panel', panel: 'history' },
  intelligence: { kind: 'panel', panel: 'intelligence' },
  intelligence2: { kind: 'panel', panel: 'intelligence' },
  agents: { kind: 'tab', tab: 'agents' },
  strategies: { kind: 'ecosystem', kind2: 'strategy' },
  ecosystem: { kind: 'ecosystem', kind2: 'agent' },
  activity: { kind: 'tab', tab: 'activity' },
  automations: { kind: 'tab', tab: 'activity' },
  compose: { kind: 'tab', tab: 'chat' },
  chat: { kind: 'tab', tab: 'chat' }
});

/** Split a route string without pulling in a URL parser. */
export function splitRoute(route) {
  const raw = String(route || '');
  const hash = raw.startsWith('#') ? raw.slice(1) : raw;
  const qi = hash.indexOf('?');
  const pathname = (qi >= 0 ? hash.slice(0, qi) : hash) || '/';
  const search = qi >= 0 ? hash.slice(qi) : '';
  const params = {};
  if (search.length > 1) {
    for (const pair of search.slice(1).split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
      const value = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1)) : '';
      params[key] = value;
    }
  }
  return { pathname, search, params };
}

/**
 * Resolve one route into an action the chat can perform.
 *
 * @returns {{ kind: 'navigate', to: string } | { kind: 'panel', panel: string }
 *          | { kind: 'tab', tab: string } | { kind: 'ecosystem', ecoKind: string }
 *          | { kind: 'unknown' }}
 */
export function resolveChatRoute(route, { currentPathname = '/intent' } = {}) {
  const { pathname, params } = splitRoute(route);
  const samePage = pathname === currentPathname;

  if (samePage && params.tab) {
    const target = INTENT_TAB_TARGETS[String(params.tab).toLowerCase()];
    if (!target) return { kind: 'unknown', reason: 'UNKNOWN_TAB', tab: params.tab };
    if (target.kind === 'panel') return { kind: 'panel', panel: target.panel };
    if (target.kind === 'ecosystem') return { kind: 'ecosystem', ecoKind: target.kind2 };
    return { kind: 'tab', tab: target.tab };
  }
  /* A bare link to the page we are already on is not a navigation — it is
     "come back to the chat", which is what the user meant by tapping it. */
  if (samePage && !params.tab) return { kind: 'tab', tab: 'chat' };
  return { kind: 'navigate', to: pathname + buildSearch(params) };
}

function buildSearch(params) {
  const entries = Object.entries(params || {}).filter(([, v]) => v !== '');
  if (!entries.length) return '';
  return `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
}

/** Every pathname the router in App.jsx actually mounts. Kept here so the
    contract probe can compare it against the parsed router table and fail
    when the two drift. */
export const ROUTED_PATHS = Object.freeze([
  '/', '/coin/:id', '/compare', '/trade', '/swap', '/bridge', '/invest', '/predict',
  '/earn', '/wallet', '/settings', '/about', '/contact', '/legal/:doc', '/perp',
  '/farm', '/signals', '/stocks', '/ostium', '/dydx', '/derivatives', '/shop',
  '/help', '/docs', '/audit', '/security', '/developers', '/ecosystem', '/business',
  '/p2p', '/leaderboard', '/news', '/explore', '/discover', '/nft', '/orders',
  '/lab', '/explore-hub', '/learn', '/rewards', '/solana', '/buy',
  '/order/result/:orderId', '/smart-wallet', '/smart-money',
  '/smart-money/wallet/:chain/:address', '/smart-money/token/:chain/:address',
  '/portfolio', '/intent', '/intent-ai', '/ai-control', '/flash-liquidity',
  '/vault', '/loan',
  // Phase 211 — AI Global Intelligence surface (additive).
  '/ai-global',
  // FBT Insurance OS (protection marketplace) — nested under the shell route.
  '/insurance', '/insurance/marketplace', '/insurance/quote/:quoteId',
  '/insurance/coverage', '/insurance/coverage/:id', '/insurance/claims',
  '/insurance/risk', '/insurance/providers', '/insurance/settings',
  /* Headerless customer landing — mounted in App.jsx's HEADERLESS ROUTES. */
  '/pay/:code'
]);

/** Does a pathname exist in the router? Params (`:id`) match by segment count. */
export function isRoutedPath(pathname) {
  const clean = String(pathname || '').split('?')[0];
  const segs = clean.split('/').filter(Boolean);
  return ROUTED_PATHS.some((route) => {
    const rs = route.split('/').filter(Boolean);
    if (rs.length !== segs.length) return false;
    return rs.every((r, i) => r.startsWith(':') || r === segs[i]);
  });
}
