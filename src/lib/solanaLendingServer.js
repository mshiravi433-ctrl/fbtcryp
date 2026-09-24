/**
 * THE SERVER DOOR FOR SOLANA LENDING — our own backend reads Kamino for you.
 * ==========================================================================
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The Solana half of the loan page used to have exactly one way to see the
 * market: the vendored Kamino SDK, running in the browser, talking to a public
 * Solana node over the user's own network path. Three reports in two days
 * (2026-09-22 → 2026-09-23) were that path failing — HTTP 403 from the
 * Foundation node and from publicnode, a 429 from onfinality, two 200s whose
 * bodies the SDK could not use, and finally our own read-only relay answering
 * «no Solana node answered this relay». A 403 is a decision about the CALLER
 * (IP, provider, region), so nothing a browser does — ordering, retries,
 * cooldowns, a different public host — changes the answer.
 *
 * What does change it is WHO ASKS. The app's server is a datacentre caller that
 * those nodes do serve; it already proves the point twice over on this same
 * screen's neighbours (server/solana.js prices Solana swaps, and
 * server/solanaChainReads.js reads balances for a wallet whose own device
 * cannot). A phone that can load this page can reach our origin, because it
 * loaded the page from it.
 *
 * WHAT IT IS, PRECISELY
 * ---------------------
 * A thin, honest JSON client for three routes in server/solanaLending.js:
 *
 *   GET  /api/lending/solana/market?wallet=…   → the same snapshot shape
 *                                                `readSolanaLendingMarket`
 *                                                returns, serialized by the
 *                                                SAME function on the server.
 *   POST /api/lending/solana/transaction       → UNSIGNED transactions, base64,
 *                                                in the shape the wallet layer
 *                                                already signs.
 *   GET  /api/lending/solana/transaction/:sig  → did it land?
 *
 * WHAT IT IS NOT
 * --------------
 *   · Not a custodian and not a broadcaster. The server never sees a private
 *     key, never signs, and never sends: §30 is the reason the POST returns
 *     bytes for the wallet rather than a signature.
 *   · Not a cache pretending to be live. The server reads the chain on every
 *     call it does not have a fresh answer for, and its snapshot carries
 *     `dataStatus: 'live'` only when it did.
 *   · Not the first choice. The browser door stays primary (it costs us nothing
 *     and it is faster when it works); this one is raced against it — see
 *     `readSolanaLendingMarket` in ./solanaLending.js.
 */

import { apiBase } from './apiBase.js';
import { SERVER_DOOR_TIMEOUT_MS, SOLANA_LENDING_CHAIN_ID } from './solanaLending.js';

/** Route paths under the app's own API base. */
export const SOLANA_LENDING_SERVER_PATHS = Object.freeze({
  market: '/lending/solana/market',
  transaction: '/lending/solana/transaction',
  status: '/lending/solana/status'
});

/** The schema the server answers with — a mismatch is a deployment older than
    this client, which is a named condition, not a mystery. */
export const SOLANA_LENDING_SERVER_SCHEMA = 'fbt.solana-kamino.v1';

/** Is there an origin to ask at all? Inside the packaged APK apiBase() answers
    the canonical https origin; in a test with no window it may answer nothing. */
export function solanaLendingServerAvailable() {
  try {
    return Boolean(apiBase());
  } catch {
    return false;
  }
}

/**
 * One JSON call to our own backend, with a deadline, that NEVER throws.
 *
 * Every failure is returned as `{ ok:false, code, status, detail }` so the
 * caller can distinguish «the deployment has no such route» (404 — an older
 * server, which is a real and common shape during a rollout) from «the server
 * tried and the nodes refused it too» (a 200 with `ok:false` and a code) from
 * «we cannot even reach ourselves» (status 0).
 */
async function serverJson(path, { method = 'GET', body = null, timeoutMs = SERVER_DOOR_TIMEOUT_MS, signal = null } = {}) {
  let base = '';
  try { base = apiBase(); } catch { base = ''; }
  if (!base) return { ok: false, code: 'SERVER_DOOR_UNAVAILABLE', status: 0, detail: 'no API origin' };
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  const onOuterAbort = () => ctrl?.abort();
  if (signal) {
    if (signal.aborted) { if (timer) clearTimeout(timer); return { ok: false, code: 'CANCELLED', status: 0 }; }
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      /* The server's OWN machine code wins over a code inferred from the status,
         exactly as the JSON-RPC relay forwards an upstream's refusal rather than
         dressing it as its own 502: `KAMINO_MARKET_UNAVAILABLE` tells the panel
         which sentence to show, and «a 5xx happened» does not. A 404 is the one
         exception — it means this deployment has no such route, which is a fact
         about the build, not about Kamino, and its body is usually HTML. */
      const bodyCode = typeof json?.code === 'string' && json.code ? json.code : null;
      const statusCode = res.status === 404 ? 'SERVER_ENDPOINT_MISSING'
        : res.status === 429 ? 'SERVER_THROTTLED'
          : res.status >= 500 ? 'SERVER_UPSTREAM_FAILED'
            : 'SERVER_UNAVAILABLE';
      return {
        ok: false,
        code: res.status === 404 ? statusCode : (bodyCode || statusCode),
        status: res.status,
        detail: String(json?.detail || json?.error?.message || json?.error || res.statusText || '').slice(0, 200),
        json
      };
    }
    if (!json || typeof json !== 'object') {
      return { ok: false, code: 'SERVER_BAD_RESPONSE', status: res.status, detail: 'not JSON' };
    }
    return { ok: true, status: res.status, json };
  } catch (cause) {
    const msg = String(cause?.message || cause || '');
    return {
      ok: false,
      code: /abort/i.test(msg) ? 'SERVER_TIMEOUT' : 'SERVER_UNREACHABLE',
      status: 0,
      detail: msg.slice(0, 200)
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * The Kamino market snapshot, read by our server.
 *
 * @returns {{ok:true, snapshot:object}|{ok:false, code:string, detail?:string|null, status?:number}}
 */
export async function readSolanaLendingMarketViaServer({ wallet = null, signal = null, fresh = false } = {}) {
  const params = new URLSearchParams();
  if (wallet) params.set('wallet', String(wallet));
  /* After a transaction the server's 20-second snapshot cache would hand back
     the position from BEFORE it — «I deposited and nothing changed». */
  if (fresh) params.set('refresh', '1');
  const query = params.toString();
  const answer = await serverJson(`${SOLANA_LENDING_SERVER_PATHS.market}${query ? `?${query}` : ''}`, { signal });
  const body = answer.json;
  /* The per-upstream verdicts travel with EVERY refusal — a transport-shaped one
     (502/404) as well as a 200 that says «unavailable» — because they are the
     part the panel can render as «our server asked these nodes and each said
     this», which is the difference between a debuggable incident and a shrug. */
  const hosts = Array.isArray(body?.hosts) ? body.hosts : null;
  if (!answer.ok) return { ok: false, code: answer.code, detail: answer.detail || null, status: answer.status, hosts };
  /* `ok:true` from the server means it READ THE CHAIN. Anything else it can
     answer — every upstream refused, the SDK would not load there either — is a
     named failure with its own code, never an empty market dressed as a healthy
     one (§28, and the reason the panel refuses to send on unknown data). */
  if (body?.ok !== true || !Array.isArray(body?.snapshot?.assets)) {
    return {
      ok: false,
      code: String(body?.code || 'SERVER_MARKET_UNAVAILABLE'),
      detail: String(body?.detail || '').slice(0, 200) || null,
      status: answer.status,
      /* The per-upstream verdicts, so the panel can show the same honest list
         it shows for the browser door — this time about our own server's path. */
      hosts
    };
  }
  return { ok: true, snapshot: { ...body.snapshot, via: 'server' }, meta: body.meta || null };
}

/**
 * Build UNSIGNED Kamino transactions on our server.
 *
 * The response is the same shape the browser builder returns, because the server
 * builds with the same two functions (`buildKaminoActionTransactions`,
 * `collectKaminoTransactions`) — so the wallet layer, the deep-link path and the
 * confirmation wait need no idea which door produced the bytes.
 */
export async function buildSolanaLendingTransactionsViaServer({ action, asset, amount, wallet, signal = null } = {}) {
  if (!wallet) return { ok: false, code: 'SOLANA_WALLET_REQUIRED' };
  if (!asset?.address) return { ok: false, code: 'SOLANA_ASSET_REQUIRED' };
  const answer = await serverJson(SOLANA_LENDING_SERVER_PATHS.transaction, {
    method: 'POST',
    body: {
      action: String(action || ''),
      mint: String(asset.address),
      decimals: Number(asset.decimals ?? 0),
      amount: String(amount ?? ''),
      wallet: String(wallet),
      chainId: SOLANA_LENDING_CHAIN_ID
    },
    signal
  });
  if (!answer.ok) return { ok: false, code: answer.code, detail: answer.detail || null };
  const body = answer.json;
  if (body?.ok !== true || !Array.isArray(body?.transactions) || !body.transactions.length) {
    return { ok: false, code: String(body?.code || 'KAMINO_TX_BUILD_FAILED'), detail: String(body?.detail || '').slice(0, 200) || null };
  }
  return {
    ok: true,
    action: body.action,
    amount: String(body.amount ?? amount),
    amountWei: String(body.amountWei ?? ''),
    transactions: body.transactions.map((tx) => ({
      id: String(tx.id || action),
      transaction: String(tx.transaction || ''),
      /* Per-transaction, from the builder — never assumed. The wallet layer
         deserializes v0 bytes as v0 and legacy bytes as legacy. */
      versioned: tx.versioned === true
    })),
    protocol: 'kamino-klend',
    chainId: SOLANA_LENDING_CHAIN_ID,
    via: 'server',
    slot: Number.isFinite(Number(body.slot)) ? Number(body.slot) : null
  };
}

/**
 * Did a broadcast transaction land? — asked of our server.
 *
 * The wallet broadcast through ITS OWN node, so the answer exists even when the
 * browser cannot reach a single public node; reporting «not found» because nine
 * hosts refused us would tell a user their money did not move when it did.
 */
export async function getSolanaLendingTransactionStatusViaServer(signature, { signal = null } = {}) {
  const sig = String(signature || '').trim();
  if (!sig) return { ok: false, code: 'SIGNATURE_REQUIRED' };
  const answer = await serverJson(`${SOLANA_LENDING_SERVER_PATHS.transaction}/${encodeURIComponent(sig)}`, { signal });
  if (!answer.ok) return { ok: false, code: answer.code, detail: answer.detail || null };
  const body = answer.json;
  if (body?.ok === true) {
    return { ok: true, confirmed: body.confirmed !== false, slot: Number.isFinite(Number(body.slot)) ? Number(body.slot) : null, via: 'server' };
  }
  return { ok: false, code: String(body?.code || 'TRANSACTION_NOT_FOUND'), detail: String(body?.detail || '').slice(0, 200) || null, via: 'server' };
}

/** Diagnostics: is the door deployed, and what did it last see? Never throws. */
export async function solanaLendingServerStatus({ signal = null } = {}) {
  const answer = await serverJson(SOLANA_LENDING_SERVER_PATHS.status, { timeoutMs: 8000, signal });
  if (!answer.ok) return { ok: false, code: answer.code, status: answer.status };
  return { ok: true, ...answer.json };
}
