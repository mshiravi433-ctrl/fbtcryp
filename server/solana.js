/**
 * SOLANA SWAP PROXY — Jupiter Swap API V2
 * ---------------------------------------------------------------------------
 * The client cannot call Jupiter directly with our credentials. V2 requires an
 * `x-api-key`, and a key in a `VITE_` variable is compiled into the browser
 * bundle and the APK, where anyone can read it. A leaked swap key is billed to
 * us and can be exhausted by a stranger, taking Solana swaps down for everyone.
 *
 * So this proxy exists for exactly one reason: to attach the key server-side.
 * It deliberately does NOT reshape Jupiter's responses — the client parses the
 * documented V2 fields, and a translation layer here would be one more place
 * for the two to drift apart.
 *
 * WHAT IS FORWARDED, AND WHY IT IS AN ALLOW-LIST
 * Only the parameters we understand are passed through. Blindly forwarding the
 * query string would let a caller set `payer`, which changes who funds the
 * transaction and silently disables the JupiterZ router (worse pricing), or
 * override `referralAccount` to redirect OUR fee to their own wallet. The
 * allow-list is the security boundary, not a tidiness preference.
 */

const JUP = 'https://api.jup.ag/swap/v2';
const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);

const apiKey = () => process.env.JUPITER_API_KEY || '';

/** True when a key is configured. Reported by /api/solana/status. */
export const jupiterConfigured = () => Boolean(apiKey());

/**
 * The referral account our fee is paid into.
 *
 * Server-side so it can be rotated without rebuilding the app. If unset, the
 * client's own build-time value is used; if BOTH are unset the swap still
 * works and earns nothing, which is the failure mode the UI must surface.
 */
export const referralAccount = () => process.env.JUP_REFERRAL_ACCOUNT || '';

function headers() {
  const h = { 'Content-Type': 'application/json' };
  const k = apiKey();
  if (k) h['x-api-key'] = k;
  return h;
}

async function jupFetch(path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${JUP}${path}`, { ...init, headers: headers(), signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/*
 * Parameters we forward. Anything else is dropped.
 *
 * `referralAccount` and `referralFee` are NOT in this list on purpose: they
 * decide where our revenue goes, so they are set by the server from its own
 * configuration and can never be supplied by a caller.
 */
const ALLOWED = ['inputMint', 'outputMint', 'amount', 'taker', 'slippageBps', 'excludeRouters'];

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Jupiter's documented referral range. A value outside it makes /order reject
 * the whole request, so it is clamped rather than passed through — a swap that
 * fails only on one chain is a miserable bug to trace back to a config typo.
 */
function feeBps() {
  const raw = Number(process.env.FEE_BPS ?? process.env.VITE_FEE_BPS ?? 70);
  const n = Number.isFinite(raw) ? Math.round(raw) : 70;
  return Math.min(255, Math.max(50, n));
}

/** GET /api/solana/order */
export async function solanaOrder(query) {
  const params = new URLSearchParams();

  for (const key of ALLOWED) {
    const v = query?.[key];
    if (v == null || v === '') continue;
    params.set(key, String(v).slice(0, 120));
  }

  const inputMint = params.get('inputMint');
  const outputMint = params.get('outputMint');
  const amount = params.get('amount');

  if (!BASE58.test(inputMint || '') || !BASE58.test(outputMint || '')) {
    return { ok: false, status: 400, body: { error: 'BAD_MINT' } };
  }
  if (inputMint === outputMint) {
    return { ok: false, status: 400, body: { error: 'SAME_TOKEN' } };
  }
  // Integer base units only. A decimal point here is rejected by Jupiter with
  // an opaque error, so it is caught where the message can be useful.
  if (!/^\d+$/.test(amount || '') || amount === '0') {
    return { ok: false, status: 400, body: { error: 'BAD_AMOUNT' } };
  }
  const taker = params.get('taker');
  if (taker && !BASE58.test(taker)) {
    return { ok: false, status: 400, body: { error: 'BAD_TAKER' } };
  }

  /*
   * Attach the fee from OUR configuration, never from the request.
   *
   * Skipped entirely when no referral account is set: Jupiter ignores a
   * referralFee without a valid account, so sending one anyway would make the
   * logs look configured while the fee is silently zero.
   */
  const ref = referralAccount();
  if (BASE58.test(ref)) {
    params.set('referralAccount', ref);
    params.set('referralFee', String(feeBps()));
  }

  return jupFetch(`/order?${params}`);
}

/** POST /api/solana/execute */
export async function solanaExecute(body) {
  const signedTransaction = body?.signedTransaction;
  const requestId = body?.requestId;

  if (typeof signedTransaction !== 'string' || !signedTransaction) {
    return { ok: false, status: 400, body: { error: 'MISSING_TRANSACTION' } };
  }
  if (typeof requestId !== 'string' || !requestId) {
    return { ok: false, status: 400, body: { error: 'MISSING_REQUEST_ID' } };
  }
  /*
   * A signed Solana transaction is base64 and comfortably under 2 KB. The cap
   * stops an oversized body being relayed upstream on our key — the express
   * json limit is 64kb, which is generous for this shape.
   */
  if (signedTransaction.length > 8000) {
    return { ok: false, status: 413, body: { error: 'TRANSACTION_TOO_LARGE' } };
  }

  return jupFetch('/execute', {
    method: 'POST',
    body: JSON.stringify({ signedTransaction, requestId })
  });
}
