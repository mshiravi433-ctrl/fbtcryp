/*
 * THE PUBLISHED TRANSFER — a module with NO dependencies.
 * ---------------------------------------------------------------------------
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS EMPTY OF EVERYTHING ELSE.
 *
 * The route-intelligence engine ranks CANDIDATE ROUTES, and candidates
 * need a transfer to plan: a source chain, a destination chain, both
 * tokens and an amount. The cross-chain panel knows all four. The AI
 * panel does not, because they are different panels on different pages.
 *
 * So the panel PUBLISHES the transfer it is looking at, and the brain
 * client carries it with the turn.
 *
 * The first implementation put those three functions inside
 * `src/lib/intentCrossChainClient.js` — the module that owns the
 * cross-chain browser client. And that cost **26 KB of the first-paint
 * bundle**, because that module imports `@noble/ed25519`,
 * `@noble/hashes` and `server/ethersLite.js`, and the brain client is on
 * the entry path:
 *
 *     src/lib/central/client.js  →  src/lib/intentCrossChainClient.js
 *                                 →  @noble/ed25519  (+ hashes, + ethersLite)
 *
 * The transfer is three numbers and three strings. It does not need a
 * signing library, a hash library or an ethers implementation, and it
 * must not drag them into the first paint to say so.
 *
 * So the store lives HERE, with no imports at all. The cross-chain panel
 * imports it to publish; the brain client imports it to read. Neither
 * import reaches a crypto library, and the 26 KB stays where it
 * belongs — in the chunk that actually signs things.
 *
 * WHAT DID NOT CHANGE.
 *
 * The behaviour is byte-for-byte the behaviour that was there: one
 * transfer, stored under one key, published by value, cleared when the
 * user moves on, and a partial transfer is never published.
 *
 * The one thing that moved is the IMPORT EDGE, and that is the whole
 * point of this file.
 */

/** The one key. The store holds ONE transfer — the current one. */
const ROUTE_REQUEST_STORAGE_KEY = 'fbt.routeRequest.v1';

function readRouteRequestStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(ROUTE_REQUEST_STORAGE_KEY) || 'null');
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

function writeRouteRequestStore(value) {
  try {
    if (value == null) localStorage.removeItem(ROUTE_REQUEST_STORAGE_KEY);
    else localStorage.setItem(ROUTE_REQUEST_STORAGE_KEY, JSON.stringify(value));
  } catch { /* storage blocked — the turn simply has no transfer to rank */ }
}

/**
 * Publish the transfer the cross-chain panel is looking at.
 *
 * Only complete transfers are published: a missing chain, token or amount
 * is not a transfer, and publishing a partial one would make the engine
 * quote for something the user never asked for.
 */
export function publishRouteRequest(request = null) {
  const fromChain = Number(request?.fromChain);
  const toChain = Number(request?.toChain);
  const fromToken = String(request?.fromToken ?? request?.token ?? '').trim();
  const toToken = String(request?.toToken ?? '').trim();
  const fromAmount = String(request?.fromAmount ?? request?.amount ?? '').trim();

  if (!Number.isFinite(fromChain) || !Number.isFinite(toChain) || !fromToken || !toToken || !fromAmount) {
    writeRouteRequestStore(null);
    return null;
  }
  const published = {
    fromChain: Math.floor(fromChain),
    toChain: Math.floor(toChain),
    fromToken,
    toToken,
    fromAmount,
    at: Date.now()
  };
  writeRouteRequestStore(published);
  return published;
}

/** The published transfer, or null when there is none. */
export function readPublishedRouteRequest() {
  const row = readRouteRequestStore();
  if (!row) return null;
  if (!row.fromChain || !row.toChain || !row.fromToken || !row.toToken || !row.fromAmount) return null;
  return row;
}

/** Forget the published transfer — the user moved on. */
export function clearPublishedRouteRequest() {
  writeRouteRequestStore(null);
}
