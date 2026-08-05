/**
 * CROSS-CHAIN BRIDGE — client side.
 * ---------------------------------------------------------------------------
 * Thin, like lib/yields.js. All the fee attachment and parameter allow-listing
 * happens in `server/bridge.js`, because those decide where our revenue goes
 * and must never be settable from a browser.
 *
 * ─── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
 * The bridge API landed a release before any screen could reach it. Fees were
 * confirmed live — `registered: true`, our cut visible in the quote's
 * recipients array — and the earnings were still exactly zero, because there
 * was no route, no button and no way for a user to arrive at it.
 *
 * That is the "wired to nothing" bug in its purest form: a working, tested,
 * revenue-generating integration that no human being can use.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * Chains the bridge screen offers.
 *
 * A subset of the swap screen's list on purpose: these are the ones with real
 * bridge liquidity in both directions. Offering a route that exists on paper
 * but has no relayer is how a user gets a spinner and no explanation.
 */
export const BRIDGE_CHAINS = [
  { id: 56, name: 'BNB Chain', symbol: 'BNB' },
  { id: 1, name: 'Ethereum', symbol: 'ETH' },
  { id: 42161, name: 'Arbitrum', symbol: 'ETH' },
  { id: 8453, name: 'Base', symbol: 'ETH' },
  { id: 137, name: 'Polygon', symbol: 'POL' },
  { id: 10, name: 'Optimism', symbol: 'ETH' },
  { id: 43114, name: 'Avalanche', symbol: 'AVAX' }
];

/**
 * Stablecoins, per chain, for the first version of this screen.
 *
 * ─── WHY ONLY STABLECOINS ───────────────────────────────────────────────────
 * Bridging a volatile token means the price can move while the transfer is in
 * flight, and the user has no way to judge whether the amount that arrived was
 * fair. With USDC and USDT the expected output is obvious to anyone — roughly
 * what you put in, minus visible fees — which makes a bad quote impossible to
 * hide. It is also the overwhelming majority of real bridge volume.
 *
 * Every address below is the CANONICAL issuer's contract on that chain, not a
 * bridged wrapper, except where noted. A wrong address here sends funds
 * nowhere recoverable, so these are the same constants already used and
 * exercised by the swap screen in lib/chains.js.
 */
export const BRIDGE_TOKENS = {
  56: [
    { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 }
  ],
  1: [
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 }
  ],
  42161: [
    { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 }
  ],
  8453: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }
  ],
  137: [
    { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 }
  ],
  10: [
    { symbol: 'USDT', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    { symbol: 'USDC', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 }
  ],
  43114: [
    { symbol: 'USDT', address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
    { symbol: 'USDC', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 }
  ]
};

export const tokensFor = (chainId) => BRIDGE_TOKENS[Number(chainId)] ?? [];

/**
 * Ask our server for a route.
 *
 * The server attaches `integrator` and `fee`; passing them from here would be
 * pointless (they are stripped) and misleading to read.
 */
export async function getBridgeQuote(params, { timeout = 25000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const qs = new URLSearchParams(params);
    const res = await fetch(`${API_BASE}/bridge/quote?${qs}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.error || body?.message || `HTTP ${res.status}`);
      err.code = body?.error;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the numbers a user actually needs out of LI.FI's response.
 *
 * ─── WHY EVERY FEE IS SUMMED AND SHOWN ──────────────────────────────────────
 * A bridge quote carries several separate costs: LI.FI's own 0.25%, ours, the
 * relayer's fee, the relayer's gas, and the chain gas. Showing only "you
 * receive X" would technically be honest and would still hide the thing people
 * complain about afterwards — that the total cost was more than they expected.
 *
 * So the parts are itemised and the total is stated. Our own cut is labelled
 * with our name rather than folded into "fees", because a fee the user cannot
 * see is a fee they will feel tricked by later.
 */
export function summariseQuote(quote) {
  if (!quote?.estimate) return null;

  const est = quote.estimate;
  const costs = Array.isArray(est.feeCosts) ? est.feeCosts : [];
  const gas = Array.isArray(est.gasCosts) ? est.gasCosts : [];

  const feeUsd = costs.reduce((a, c) => a + (Number(c.amountUSD) || 0), 0);
  const gasUsd = gas.reduce((a, c) => a + (Number(c.amountUSD) || 0), 0);

  /*
   * Our share, dug out of the fee split. LI.FI nests it under
   * `feeSplit.recipients`, and the entry is named with our integrator id.
   * Reported so the disclosure on screen is the real number rather than a
   * repetition of what we configured.
   */
  let ourFeeUsd = null;
  for (const c of costs) {
    const recipients = c?.feeSplit?.recipients;
    if (!Array.isArray(recipients)) continue;
    const total = Number(c.amount);
    const mine = recipients.find((r) => r?.name && r.name !== 'lifi');
    if (mine && Number.isFinite(total) && total > 0) {
      const share = Number(mine.fee) / total;
      if (Number.isFinite(share)) ourFeeUsd = (Number(c.amountUSD) || 0) * share;
    }
  }

  return {
    tool: quote.tool ?? null,
    toolName: quote.toolDetails?.name ?? quote.tool ?? null,
    fromAmountUsd: Number(est.fromAmountUSD) || 0,
    toAmountUsd: Number(est.toAmountUSD) || 0,
    toAmount: est.toAmount ?? null,
    toAmountMin: est.toAmountMin ?? null,
    feeUsd,
    gasUsd,
    ourFeeUsd,
    totalCostUsd: feeUsd + gasUsd,
    /* LI.FI reports this in seconds. */
    durationSec: Number(est.executionDuration) || null
  };
}

/** Convert a decimal amount to integer base units, exactly. */
export function toBaseUnits(amount, decimals) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 30) return null;

  /*
   * String maths, not `n * 10 ** d`. A float multiplication loses precision
   * well inside the range users type — 0.1 at 18 decimals does not come out
   * clean — and LI.FI rejects a non-integer amount. Identical reasoning to
   * lib/solana.js, which documents the same trap.
   */
  const [whole, frac = ''] = String(n).includes('e') ? [n.toFixed(d), ''] : String(n).split('.');
  const padded = (frac + '0'.repeat(d)).slice(0, d);
  const joined = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  return joined === '' ? '0' : joined;
}

/** Integer base units back to a readable decimal string. */
export function fromBaseUnits(raw, decimals) {
  if (raw == null) return null;
  const s = String(raw);
  const d = Number(decimals) || 0;
  if (d === 0) return s;
  const padded = s.padStart(d + 1, '0');
  const whole = padded.slice(0, -d);
  const frac = padded.slice(-d).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
