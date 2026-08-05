/**
 * CROSS-CHAIN BRIDGE — LI.FI proxy.
 * ---------------------------------------------------------------------------
 * ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 * Our swap is SAME-CHAIN only. A user holding USDT on BNB who wants USDC on
 * Arbitrum can do nothing in this app and leaves for one that can. Bridging is
 * one of the most-wanted operations in crypto and we simply did not have it.
 *
 * ─── WHY THIS IS A SERVER ROUTE ─────────────────────────────────────────────
 * Two reasons, and the first is the one that matters:
 *
 * 1. THE API KEY. LI.FI issues an optional key that raises the rate limit. A
 *    key in a `VITE_` variable is compiled into the browser bundle and the
 *    APK, where anyone can read it — the same mistake documented at the top of
 *    server/solana.js. So the key is attached here and never leaves the
 *    server.
 *
 * 2. THE FEE PARAMETERS. `integrator` and `fee` decide where our revenue goes.
 *    Accepting them from the caller would let anyone redirect our commission
 *    to their own wallet by editing a query string.
 *
 * ─── WHY THE FEE IS 0.3% AND NOT OUR USUAL 0.7% ─────────────────────────────
 * LI.FI already takes 0.25% and the underlying bridges charge their own fee on
 * top. Adding 0.7% would put the user near 1% all-in, which is uncompetitive
 * enough that they would bridge somewhere else — and 0.3% of a real trade
 * beats 0.7% of one that never happens.
 *
 * ─── THE SILENT-ZERO TRAP, AGAIN ────────────────────────────────────────────
 * Unlike Jupiter, LI.FI does NOT quietly ignore an unconfigured fee: it
 * returns error 1011 "Integrator ... is not configured for collecting fees".
 * That is genuinely better — a loud failure beats a silent one — but it means
 * a request WITH a fee fails completely until the portal is set up. So the
 * code falls back to a fee-free quote rather than showing the user an error
 * for a configuration problem that is ours, not theirs.
 */

const LIFI_BASE = 'https://li.quest/v1';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 20000);

/**
 * Our integrator string, from the LI.FI portal.
 *
 * LI.FI constrains this: max 23 characters, lower case only, alphanumeric
 * plus `_` and `-`. A capital letter is rejected silently at the portal, so
 * the value is normalised here rather than trusted — a mismatch between what
 * was registered and what we send means zero revenue with no error.
 */
export const integratorId = () =>
  String(process.env.LIFI_INTEGRATOR || 'fbt-swap')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 23);

const apiKey = () => process.env.LIFI_API_KEY || '';

/**
 * Our cut, as a decimal fraction. LI.FI wants 0.003 for 0.3%, NOT 30.
 *
 * Clamped hard. A misconfigured environment variable must never be able to
 * take 30% of somebody's bridge: `LIFI_FEE=30` meaning "30 bps" would
 * otherwise be read as 3000%.
 */
export function bridgeFee() {
  const raw = Number(process.env.LIFI_FEE ?? 0.003);
  if (!Number.isFinite(raw) || raw < 0 || raw > 0.01) return 0.003;
  return raw;
}

/** True once the portal side is configured. Reported by /api/bridge/status. */
export const bridgeFeeReady = () => Boolean(process.env.LIFI_FEE_READY === 'true');

function headers() {
  const h = { accept: 'application/json' };
  const k = apiKey();
  if (k) h['x-lifi-api-key'] = k;
  return h;
}

async function lifiFetch(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${LIFI_BASE}${path}`, { headers: headers(), signal: ctrl.signal });
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
 * Parameters we forward. Everything else is dropped.
 *
 * `integrator` and `fee` are deliberately NOT in this list: they decide where
 * our revenue goes and are set below from our own configuration. An allow-list
 * is the security boundary here, not a tidiness preference — the same shape as
 * server/solana.js.
 */
const ALLOWED = [
  'fromChain',
  'toChain',
  'fromToken',
  'toToken',
  'fromAddress',
  'toAddress',
  'fromAmount',
  'slippage'
];

/** Chains we actually support, so a quote cannot be requested for a dead end. */
const SUPPORTED_CHAINS = new Set([1, 10, 56, 137, 8453, 42161, 43114]);

/**
 * GET /api/bridge/quote
 *
 * Returns LI.FI's quote unchanged. Deliberately not reshaped: the client reads
 * the documented fields, and a translation layer here would be one more place
 * for the two to drift apart.
 */
export async function bridgeQuote(query) {
  const params = new URLSearchParams();

  for (const key of ALLOWED) {
    const v = query?.[key];
    if (v == null || v === '') continue;
    params.set(key, String(v).slice(0, 120));
  }

  const fromChain = Number(params.get('fromChain'));
  const toChain = Number(params.get('toChain'));
  if (!SUPPORTED_CHAINS.has(fromChain) || !SUPPORTED_CHAINS.has(toChain)) {
    return { ok: false, status: 400, body: { error: 'UNSUPPORTED_CHAIN' } };
  }
  if (fromChain === toChain) {
    /*
     * Same-chain belongs on the ordinary swap screen, which quotes two
     * aggregators and charges our full 0.7%. Routing it through a bridge would
     * be a worse price AND a smaller fee.
     */
    return { ok: false, status: 400, body: { error: 'SAME_CHAIN' } };
  }

  const amount = params.get('fromAmount');
  if (!/^\d+$/.test(amount || '') || amount === '0') {
    return { ok: false, status: 400, body: { error: 'BAD_AMOUNT' } };
  }
  const from = params.get('fromAddress');
  if (!from || !/^0x[a-fA-F0-9]{40}$/.test(from)) {
    return { ok: false, status: 400, body: { error: 'BAD_ADDRESS' } };
  }

  params.set('integrator', integratorId());

  /*
   * Ask for the fee, then fall back without it.
   *
   * LI.FI rejects the WHOLE request with error 1011 when the integrator is not
   * yet configured in the portal. Showing that to a user would be blaming them
   * for our setup, so a failed fee-bearing quote is retried clean. The retry
   * earns nothing, which is exactly the state we are in today — but the
   * feature works, and `/api/bridge/status` reports the truth.
   */
  const fee = bridgeFee();
  if (fee > 0) {
    const withFee = new URLSearchParams(params);
    withFee.set('fee', String(fee));
    const attempt = await lifiFetch(`/quote?${withFee}`);
    if (attempt.ok) return attempt;
    /* 1011 is specifically "integrator not configured for fees". */
    if (attempt.body?.code !== 1011) return attempt;
  }

  return lifiFetch(`/quote?${params}`);
}

/**
 * Is fee collection live?
 *
 * Asks LI.FI directly rather than trusting an env var, because the env var
 * records what we INTENDED and the API records what is true. An integrator
 * that was never created returns "Integrator not found" — verified against the
 * live API while writing this, with our own id.
 */
export async function bridgeStatus() {
  const id = integratorId();
  const probe = await lifiFetch(`/integrators/${encodeURIComponent(id)}`);
  return {
    integrator: id,
    keySet: Boolean(apiKey()),
    feePercent: bridgeFee(),
    /*
     * `registered` is the honest signal the UI needs: bridging works without
     * it, we simply earn nothing — which looks identical to a working
     * integration from the outside.
     */
    registered: probe.ok,
    detail: probe.ok ? null : probe.body?.message ?? null
  };
}
