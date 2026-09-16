/**
 * LI.FI — the low-level client, and the only place our key and fee live.
 * ---------------------------------------------------------------------------
 * Extracted from server/bridge.js so that ONE process talks to LI.FI. Before
 * this split there were two callers with two shapes: /api/bridge/quote (real)
 * and /api/intents/v1/bridge-quote (a hard-coded object pretending to be a
 * rate). server/crossChain.js is now the only consumer of this module, and
 * server/bridge.js delegates to it — see the audit note there.
 *
 * ─── WHY THE KEY AND FEE STAY HERE ──────────────────────────────────────────
 * `LIFI_API_KEY` in a VITE_ variable is compiled into the browser bundle and
 * the APK where anyone can read it. `integrator` and `fee` decide where our
 * revenue goes: accepting them from a caller would let anyone redirect our
 * commission by editing a query string. Both are attached below, server-side,
 * and the parameter allow-list is the security boundary.
 */

const LIFI_BASE = process.env.LIFI_BASE_URL || 'https://li.quest/v1';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 20000);

/**
 * Our integrator string, as registered in the LI.FI portal.
 *
 * LI.FI constrains it: max 23 characters, lower case, alphanumeric plus `_`
 * and `-`. Normalised rather than trusted, because the portal rejects a
 * capital letter without saying so and a wrong id fails SILENTLY (error 1011
 * → our fee-free retry → bridging works, revenue is zero forever).
 */
export const integratorId = () =>
  String(process.env.LIFI_INTEGRATOR || 'fbt-swap')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 23);

export const apiKey = () => process.env.LIFI_API_KEY || '';
export const lifiConfigured = () => true; /* LI.FI serves quotes without a key; the key only raises the rate limit. */

/**
 * Our cut, as a decimal fraction (0.003 = 0.3%, NOT 30).
 *
 * Clamped hard: `LIFI_FEE=30` meant as "30 bps" would otherwise be read as
 * 3000% and take somebody's entire transfer.
 */
export function bridgeFee() {
  const raw = Number(process.env.LIFI_FEE ?? 0.003);
  if (!Number.isFinite(raw) || raw < 0 || raw > 0.01) return 0.003;
  return raw;
}

export const bridgeFeeReady = () => Boolean(process.env.LIFI_FEE_READY === 'true');

function headers(useKey = true) {
  const h = { accept: 'application/json' };
  const k = apiKey();
  if (useKey && k) h['x-lifi-api-key'] = k;
  return h;
}

/**
 * One request to LI.FI, with a timeout and one key-less retry.
 *
 * A rejected key must never take bridging down: LI.FI answers without one, so
 * an "invalid api key" reply is retried clean rather than surfaced to a user
 * as a failure they cannot fix.
 */
export async function lifiFetch(path, { method = 'GET', body = null, useKey = true, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const init = {
      method,
      headers: body ? { ...headers(useKey), 'content-type': 'application/json' } : headers(useKey),
      signal: ctrl.signal,
      ...(body ? { body: JSON.stringify(body) } : {})
    };
    const res = await fetch(`${LIFI_BASE}${path}`, init);
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text.slice(0, 300) };
    }
    if (!res.ok && useKey && parsed?.message && /invalid api key/i.test(String(parsed.message))) {
      clearTimeout(timer);
      return lifiFetch(path, { method, body, useKey: false, timeoutMs });
    }
    return { ok: res.ok, status: res.status, body: parsed, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 504 : 502,
      body: { error: err?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_FAILED', message: String(err?.message || err).slice(0, 200) },
      latencyMs: Date.now() - started
    };
  }
}

/* ── chain + tool registries, cached ─────────────────────────────────────── */

const CACHE_TTL_MS = Number(process.env.LIFI_REGISTRY_TTL_MS || 10 * 60 * 1000);
const cache = new Map();

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.until) return hit.value;
  const value = await loader();
  /* A failed load is cached BRIEFLY so a provider outage does not turn into a
     request storm, but not for the full TTL — recovery must be quick. */
  cache.set(key, { value, until: Date.now() + (value?.ok ? CACHE_TTL_MS : 15_000) });
  return value;
}

/** Every chain LI.FI itself says it serves. Never a hard-coded list. */
export const lifiChains = () => cached('chains', async () => {
  const res = await lifiFetch('/chains');
  if (!res.ok || !Array.isArray(res.body?.chains)) {
    return { ok: false, chains: [], error: res.body?.error || res.body?.message || `HTTP_${res.status}` };
  }
  return {
    ok: true,
    chains: res.body.chains.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      chainType: c.chainType || 'EVM',
      coin: c.coin ?? null,
      logoURI: c.logoURI ?? null,
      nativeToken: c.nativeToken?.address ?? null,
      explorer: c.metamask?.blockExplorerUrls?.[0] ?? null,
      rpc: Array.isArray(c.metamask?.rpcUrls) ? c.metamask.rpcUrls[0] : null
    }))
  };
});

/** Bridges + exchanges LI.FI can route through, for the health report. */
export const lifiTools = () => cached('tools', async () => {
  const res = await lifiFetch('/tools');
  if (!res.ok) return { ok: false, bridges: [], exchanges: [], error: res.body?.message || `HTTP_${res.status}` };
  return {
    ok: true,
    bridges: (res.body?.bridges || []).map((b) => b.key),
    exchanges: (res.body?.exchanges || []).map((e) => e.key)
  };
});

/** Tokens LI.FI lists for one chain — the registry the token picker reads. */
export const lifiTokens = (chainId) => cached(`tokens:${chainId}`, async () => {
  const res = await lifiFetch(`/tokens?chains=${encodeURIComponent(chainId)}`);
  const list = res.body?.tokens?.[String(chainId)];
  if (!res.ok || !Array.isArray(list)) {
    return { ok: false, tokens: [], error: res.body?.message || `HTTP_${res.status}` };
  }
  return { ok: true, tokens: list };
});

/** Is fee collection actually live? Asked of the API, not of our env var. */
export async function integratorStatus() {
  const id = integratorId();
  const probe = await lifiFetch(`/integrators/${encodeURIComponent(id)}`);
  return {
    integrator: id,
    keySet: Boolean(apiKey()),
    feePercent: bridgeFee(),
    registered: probe.ok,
    detail: probe.ok ? null : probe.body?.message ?? null,
    latencyMs: probe.latencyMs ?? null
  };
}

/** Test seam: the registry caches are per-process and must be clearable. */
export function _resetLifiCache() {
  cache.clear();
}

/* ────────────────────────────────────────────────────────────────────────────
 * SWAP QUOTES (same-chain) — the source that keeps the OpenOcean-only chains
 * quotable when OpenOcean's edge is unreachable, and a second opinion on
 * Monad / Robinhood. Mounted at GET /api/swap/lifi/quote (server/app.js).
 *
 * SECURITY SHAPE — the same boundary as the bridge path above:
 *   • integrator + fee are attached HERE, from env, never from the caller;
 *   • the parameter allow-list is the outer boundary (chain ids + tokens +
 *     amounts only — no URLs, no headers);
 *   • the FEE ECHO is verified before the quote is returned, so a response
 *     that does not provably pay our swap wallet never leaves this module.
 * ----------------------------------------------------------------------------
 */

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const AMOUNT_RE = /^[0-9]+(\.[0-9]+)?$/;
const SYMBOL_RE = /^[A-Za-z]{2,12}$/;
const LIFI_NATIVE = '0x0000000000000000000000000000000000000000';
const NATIVE_TICKERS = new Set(['ETH', 'MNT', 'MON', 'BNB', 'AVAX', 'POL', 'S', 'BERA']);

/** Chain ids this swap proxy is willing to forward. Same set the EVM swap
 *  screen supports (mirrors EVM_CHAIN_ORDER in src/lib/chains.js). */
const SWAP_CHAIN_IDS = new Set([56, 1, 137, 42161, 10, 8453, 43114, 59144, 146, 5000, 80094, 130, 143, 534352, 324, 4663]);

/**
 * The swap fee — our cut, as a decimal fraction (0.007 = 70 bps).
 *
 * Deliberately separate from `bridgeFee()`: the bridge has its own rate knob
 * (LIFI_FEE) that must not leak into swaps, where the platform fee is FEE_BPS
 * (70 bps) and is verified against the echo, not merely requested.
 */
export function swapFee() {
  const raw = Number(process.env.LIFI_SWAP_FEE ?? 0.007);
  if (!Number.isFinite(raw) || raw < 0 || raw > 0.01) return 0.007;
  return raw;
}

/**
 * Where our swap cut must land — the EVM payout address (see src/lib/payout.js).
 * A RECEIVING address only; there is no key here and there must never be.
 */
export const swapFeeRecipient = () =>
  String(process.env.LIFI_SWAP_FEE_RECIPIENT || '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6').trim();

const isAddr = (a) => typeof a === 'string' && ADDR_RE.test(a);

/** Checksum a token address with ethers when available; falls back to the
 *  LOWERCASE form, never the raw string: LI.FI resolves an all-lowercase
 *  address fine, but a DISPLAY-cased string with an invalid EIP-55 checksum
 *  returns 1003 «Could not find token» (live-probed 2026-09-15 against
 *  chain 534352) — an ethereum address our own screen then reports as
 *  «مسیری بین این دو توکن وجود ندارد» on a chain that routes fine.
 *  A failed checksum must never take quoting down, and it must never hand
 *  upstream a spelling upstream cannot read. */
async function checksummed(addr) {
  try {
    const { getAddress } = await import('ethers');
    return getAddress(addr);
  } catch {
    return String(addr).toLowerCase();
  }
}

/**
 * LI.FI same-chain swap quote with OUR fee attached and the echo verified.
 *
 * @returns {Promise<{ok:boolean, status:number, body:object}>}
 */
export async function lifiSwapQuote(params = {}) {
  const fromChain = Number(params.fromChain);
  const toChain = Number(params.toChain);
  const fromAmount = String(params.fromAmount ?? '');
  const fromAddress = String(params.fromAddress ?? '');
  const fromToken = String(params.fromToken ?? '');
  const toToken = String(params.toToken ?? '');

  if (!SWAP_CHAIN_IDS.has(fromChain) || toChain !== fromChain) {
    return { ok: false, status: 400, body: { error: 'CHAIN_UNSUPPORTED' } };
  }
  if (!AMOUNT_RE.test(fromAmount) || Number(fromAmount) <= 0) {
    return { ok: false, status: 400, body: { error: 'BAD_AMOUNT' } };
  }
  if (!isAddr(fromAddress)) {
    return { ok: false, status: 400, body: { error: 'BAD_FROM_ADDRESS' } };
  }
  /* fromToken / toToken: a contract address or a coin symbol (native coins
     travel as symbols like ETH/MNT/MON, which is how LI.FI spells them). */
  const tokenOk = (t) => isAddr(t) || SYMBOL_RE.test(t);
  if (!tokenOk(fromToken) || !tokenOk(toToken)) {
    return { ok: false, status: 400, body: { error: 'BAD_TOKEN' } };
  }

  const asLifiToken = async (t) => {
    if (isAddr(t)) return checksummed(t);
    if (NATIVE_TICKERS.has(String(t).toUpperCase())) return LIFI_NATIVE;
    return t;
  };

  const q = new URLSearchParams({
    fromChain: String(fromChain),
    toChain: String(toChain),
    fromToken: await asLifiToken(fromToken),
    toToken: await asLifiToken(toToken),
    fromAmount,
    fromAddress,
    /* The user's own address is always the destination for a swap. */
    toAddress: String(params.toAddress ?? fromAddress),
    slippage: String(Math.min(0.5, Math.max(0.0005, Number(params.slippage) || 0.005))),
    integrator: integratorId(),
    fee: String(swapFee())
  });

  const res = await lifiFetch(`/quote?${q.toString()}`);
  if (!res.ok) return { ok: false, status: res.status, body: res.body ?? { error: 'UPSTREAM_FAILED' } };

  /* ── THE FEE ECHO GATE — before this response leaves the server ──────────
   * What ends up signed is the calldata LI.FI built for THIS quote, and its
   * fee fields must prove OUR cut lands in OUR wallet. Anything less is
   * rejected here so the client never even sees a quote we cannot honour.
   * (The client re-verifies the same evidence before signing — one gate is
   * a wall, two is a wall with an alarm.) */
  const fee = swapFee();
  const id = integratorId();
  const body = res.body;
  const feeCosts = Array.isArray(body?.estimate?.feeCosts) ? body.estimate.feeCosts : [];
  const split = feeCosts.find((fc) => fc && fc.feeSplit && Array.isArray(fc.feeSplit.recipients))?.feeSplit ?? null;
  const ours = split?.recipients?.find((r) => String(r?.name) === id) ?? null;
  const fromWei = BigInt(body?.action?.fromAmount ?? 0);
  const expectBps = Math.round(fee * 10000);
  const shareOk =
    ours != null && fromWei > 0n && BigInt(String(ours.fee ?? 0)) * 10000n === fromWei * BigInt(expectBps);

  const steps = Array.isArray(body?.includedSteps) ? body.includedSteps : [];
  const wallets = steps.flatMap((s) => s?.action?.integratorFees?.recipients ?? []);
  const walletEntry = wallets.find((r) => String(r?.name) === id) ?? null;
  const walletOk =
    walletEntry != null && isAddr(walletEntry?.config?.defaultWallet) &&
    walletEntry.config.defaultWallet.toLowerCase() === swapFeeRecipient().toLowerCase();

  if (!(String(body?.integrator) === id && Math.abs(Number(body?.fee ?? 0) - fee) < 1e-9)) {
    return { ok: false, status: 502, body: { error: 'FEE_NOT_APPLIED' } };
  }
  if (!shareOk) {
    return { ok: false, status: 502, body: { error: 'FEE_NOT_APPLIED' } };
  }
  if (!walletOk) {
    return { ok: false, status: 502, body: { error: 'FEE_RECIPIENT_MISMATCH' } };
  }
  if (!body?.transactionRequest?.data || !body?.transactionRequest?.to) {
    return { ok: false, status: 502, body: { error: 'NO_TRANSACTION_REQUEST' } };
  }

  return { ok: true, status: 200, body };
}
