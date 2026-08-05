/**
 * GASLESS SWAPS — 0x Gasless API proxy.
 * ---------------------------------------------------------------------------
 * ─── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────
 * A user who holds USDT on BNB Chain but no BNB cannot do ANYTHING in this
 * app. Not a swap, not a bridge, nothing — every EVM action needs the chain's
 * native coin for gas, and buying that coin is itself a transaction requiring
 * gas. It is the most common dead end in crypto and it hits precisely the
 * people we are trying to reach: someone who was sent stablecoins and has
 * never held BNB in their life.
 *
 * 0x's Gasless API breaks the loop. The user signs an EIP-712 message instead
 * of a transaction, 0x submits it and pays the gas, and the cost is deducted
 * from the token being traded. No native coin required at any point.
 *
 * ─── WHY THIS IS A SEPARATE MODULE FROM THE NORMAL SWAP ─────────────────────
 * The flows genuinely differ. A normal swap builds a transaction the wallet
 * broadcasts; this builds a message the wallet SIGNS and we relay. Different
 * approval mechanism (Permit2), different failure modes, different response
 * shape. Folding it into aggregator.js would thread a second code path through
 * a file that already moves real money — the same reasoning that keeps
 * SolanaSwap on its own screen.
 *
 * ─── WHY IT IS OFF UNLESS A KEY EXISTS ──────────────────────────────────────
 * 0x requires an API key even on the free plan. Without one every request
 * 401s. Rather than surface that as a broken feature, `gaslessConfigured()`
 * reports false and the UI never offers the option — a missing capability is
 * better than a visible one that always fails.
 */

const ZEROX_BASE = 'https://api.0x.org';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 20000);

const apiKey = () => process.env.ZEROX_API_KEY || '';

/** True when a key is configured. Reported by /api/gasless/status. */
export const gaslessConfigured = () => Boolean(apiKey());

/**
 * Where our commission goes. Same EVM address as every other fee in the app —
 * one wallet, one private key, one place to check.
 */
export const feeRecipient = () =>
  process.env.ZEROX_FEE_RECIPIENT ||
  process.env.VITE_PAYOUT_EVM ||
  '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';

/**
 * Our cut in basis points.
 *
 * Matches the standard 0.70% swap fee, because to the user this IS a swap —
 * charging a different rate for the same action depending on which code path
 * served it would be arbitrary and impossible to explain.
 *
 * Clamped to 0-100 bps. 0x accepts up to 1000 (10%), and a misplaced digit
 * turning 70 into 700 would take 7% of somebody's trade.
 */
export function feeBps() {
  const raw = Number(process.env.ZEROX_FEE_BPS ?? process.env.FEE_BPS ?? 70);
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) return 70;
  return Math.round(raw);
}

function headers() {
  return {
    accept: 'application/json',
    '0x-api-key': apiKey(),
    '0x-version': 'v2'
  };
}

async function zeroxFetch(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ZEROX_BASE}${path}`, { headers: headers(), signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/*
 * Forwarded parameters. Everything else is dropped.
 *
 * `swapFeeRecipient`, `swapFeeBps` and `swapFeeToken` are deliberately absent:
 * they decide where our revenue goes and are set below from our own config.
 * Accepting them from a caller would let anyone redirect the commission by
 * editing a query string — identical boundary to server/bridge.js and
 * server/solana.js.
 */
const ALLOWED = ['chainId', 'sellToken', 'buyToken', 'sellAmount', 'taker', 'slippageBps'];

/** Chains where 0x Gasless is available AND we already support the chain. */
const SUPPORTED = new Set([1, 10, 56, 137, 8453, 42161, 43114]);

/**
 * GET /api/gasless/price — an indicative quote, no commitment.
 *
 * Used to decide whether to OFFER the gasless path at all. A firm quote costs
 * more upstream and locks a price, so it is only requested once the user has
 * actually chosen this route.
 */
export async function gaslessPrice(query) {
  return gaslessCall('/gasless/price', query);
}

/** GET /api/gasless/quote — the firm quote, including the message to sign. */
export async function gaslessQuote(query) {
  return gaslessCall('/gasless/quote', query);
}

async function gaslessCall(path, query) {
  if (!apiKey()) {
    /*
     * Explicit, not a 401 passed through. The UI needs to distinguish "not
     * available here" from "something broke", and only one of those is worth
     * showing a user.
     */
    return { ok: false, status: 503, body: { error: 'GASLESS_NOT_CONFIGURED' } };
  }

  const params = new URLSearchParams();
  for (const key of ALLOWED) {
    const v = query?.[key];
    if (v == null || v === '') continue;
    params.set(key, String(v).slice(0, 120));
  }

  const chainId = Number(params.get('chainId'));
  if (!SUPPORTED.has(chainId)) {
    return { ok: false, status: 400, body: { error: 'UNSUPPORTED_CHAIN' } };
  }

  const amount = params.get('sellAmount');
  if (!/^\d+$/.test(amount || '') || amount === '0') {
    return { ok: false, status: 400, body: { error: 'BAD_AMOUNT' } };
  }

  const taker = params.get('taker');
  if (!taker || !/^0x[a-fA-F0-9]{40}$/.test(taker)) {
    return { ok: false, status: 400, body: { error: 'BAD_TAKER' } };
  }

  const sell = params.get('sellToken');
  const buy = params.get('buyToken');
  if (!/^0x[a-fA-F0-9]{40}$/.test(sell || '') || !/^0x[a-fA-F0-9]{40}$/.test(buy || '')) {
    /*
     * Gasless has no native-coin path by definition — if the user had native
     * coin they would not need this. So both sides must be real ERC-20
     * contracts, and the pseudo-address for "native" is rejected here rather
     * than producing a confusing upstream error.
     */
    return { ok: false, status: 400, body: { error: 'BAD_TOKEN' } };
  }
  if (sell.toLowerCase() === buy.toLowerCase()) {
    return { ok: false, status: 400, body: { error: 'SAME_TOKEN' } };
  }

  /*
   * Attach our fee, taken in the SELL token.
   *
   * Deliberately the sell side: the user already holds it, so the amount is
   * knowable before the trade executes and appears in the quote as a straight
   * deduction. Taking it from the buy token would make our cut depend on the
   * fill price, which is harder to display honestly.
   */
  params.set('swapFeeRecipient', feeRecipient());
  params.set('swapFeeBps', String(feeBps()));
  params.set('swapFeeToken', sell);

  return zeroxFetch(`${path}?${params}`);
}

/**
 * POST /api/gasless/submit — relay the user's signed message.
 *
 * The body is passed through unchanged because 0x defines its shape and a
 * translation layer here would be one more place for the two to drift.
 */
export async function gaslessSubmit(body) {
  if (!apiKey()) {
    return { ok: false, status: 503, body: { error: 'GASLESS_NOT_CONFIGURED' } };
  }
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, body: { error: 'BAD_BODY' } };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ZEROX_BASE}/gasless/submit`, {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/** Honest status, for the UI and for anyone debugging a silent zero. */
export function gaslessStatus() {
  return {
    configured: gaslessConfigured(),
    feeBps: feeBps(),
    feeRecipient: feeRecipient(),
    chains: [...SUPPORTED]
  };
}
