/**
 * What the screen knows, expressed in the one shape the brain accepts (§7:
 * page + tab + wallet + selected asset). This file deliberately contains NO
 * business logic and NO data fetching: it is a translation layer between React
 * state the app already has and the Central Context Engine's `page` contract, so
 * that a screen never has to invent a "context" object of its own — five
 * hand-rolled context shapes is exactly how the previous assistant lost track of
 * which wallet the user was looking at.
 *
 * Every field is read defensively. A missing field is passed as `null`, never
 * guessed: `resolvePage` treats an absent `selectedAsset` as "no asset is
 * selected", and the brain then asks for it. Filling it in here from, say, the
 * first token in a list would let a Persian sentence about ETH get answered about
 * USDT, and no error would ever be raised.
 */

const ROUTE_TAB_PARAM = ['tab', 'tabId', 'view'];

function firstString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 64);
  }
  return null;
}

function asAddress(wallet) {
  if (!wallet || typeof wallet !== 'object') return null;
  const candidate = firstString(
    wallet.address,
    wallet.walletAddress,
    wallet.evmAddress,
    wallet.accounts?.[0]?.address,
    wallet.accounts?.[0],
    wallet.account,
    wallet.selectedAddress
  );
  return candidate && (candidate.startsWith('0x') || candidate.length >= 24) ? candidate : null;
}

function asChainId(wallet) {
  if (!wallet || typeof wallet !== 'object') return null;
  const raw = wallet.chainId ?? wallet.networkVersion ?? wallet.network ?? wallet.selectedChainId ?? null;
  const n = Number(typeof raw === 'string' && /^0x[0-9a-f]+$/i.test(raw) ? parseInt(raw, 16) : raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function queryTab(search) {
  try {
    const q = new URLSearchParams(String(search || ''));
    for (const key of ROUTE_TAB_PARAM) {
      const v = q.get(key);
      if (v) return v;
    }
  } catch {
    /* a malformed query string is not worth failing a render over */
  }
  return null;
}

/**
 * @param {object}   opts
 * @param {string}   opts.pathname   window.location.pathname (or the router's)
 * @param {string}   [opts.search]   window.location.search
 * @param {object}   [opts.wallet]   the connected-wallet snapshot, any shape
 * @param {string}   [opts.tab]      the tab the UI currently has active
 * @param {string}   [opts.asset]    the asset the UI is focused on
 * @param {object}   [opts.pending]  an in-flight action {actionId, intentId, status}
 * @param {Array}    [opts.tabs]     the page's own tab ids, so a tab the app
 *                                   names but PAGE_MAP does not know still travels
 * @param {number}   [opts.at]       stamp for staleness; defaults to now
 */
export function buildPageContext({ pathname, search = '', wallet = null, tab = null, asset = null, pending = null, tabs = [], at = 0 } = {}) {
  const route = String(pathname || (typeof window !== 'undefined' ? window.location?.pathname : '') || '/').split('?')[0];
  const connected = Boolean(wallet && (wallet.isConnected ?? wallet.connected ?? (wallet.address || wallet.accounts?.length)));
  return {
    route: route.slice(0, 120),
    tab: firstString(tab, queryTab(search)),
    /* The module is NOT inferred here. `resolvePage` on the server owns the
       route→module table, and duplicating it in the browser is how two answers to
       "which module is this page" get to exist. */
    module: null,
    tabs: Array.isArray(tabs) ? tabs.filter((t) => typeof t === 'string').slice(0, 12) : [],
    selectedAsset: firstString(asset, wallet?.selectedAsset, wallet?.asset),
    selectedNetwork: asChainId(wallet),
    walletConnected: connected,
    address: asAddress(wallet),
    pendingAction: pending?.actionId
      ? { actionId: String(pending.actionId).slice(0, 64), status: firstString(pending.status) || 'UNKNOWN', intentId: firstString(pending.intentId) }
      : null,
    at: Number(at) || Date.now()
  };
}

/**
 * A tiny store so non-React code (event handlers, the swap screen's submit path)
 * can push "the user is now looking at X" without threading props through the
 * tree. The brain re-reads the wallet itself; this is only what the UI can know.
 */
let latest = buildPageContext({ pathname: typeof window !== 'undefined' ? window.location?.pathname : '/', at: 0 });

export function setPageContext(next) {
  latest = { ...latest, ...(next || {}), at: Date.now() };
  return latest;
}

export const getPageContext = () => latest;
