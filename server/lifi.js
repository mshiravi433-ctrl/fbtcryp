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
export function normalizeIntegratorId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 23);
}

/**
 * ─── WHY THE INTEGRATOR ID IS A LADDER AND NOT ONE STRING ───────────────────
 * LI.FI pays the integrator fee only for a VERIFIED integrator, and the
 * verified string is whatever the portal registered — it is not necessarily
 * the one typed into the form. This project has already been through that
 * exact trap: docs/LIFI-SETUP-FA.md records `fbt-swap` → «Integrator not
 * found» and `fbtswap` → registered, because the portal strips the hyphen on
 * save. A wrong id does not error loudly: the quote comes back looking fine
 * and simply carries no fee, which our own gate then (correctly) refuses — so
 * from the user's seat a mis-registered id is «مشکلی پیش آمده» on every pair
 * of every LI.FI-only chain (zkSync Era, Scroll, Mantle).
 *
 * So the ids are a candidate ladder, in priority order:
 *
 *   1. whatever the operator configured (LIFI_INTEGRATOR, comma-separated);
 *   2. the id this process has already SEEN produce a verified fee split
 *      (remembered for 10 minutes, so the ladder costs nothing on the hot
 *      path);
 *   3. the two ids this project has ever registered — `fbtswap` (the id the
 *      portal actually stored, and the one a live
 *      `GET /v1/integrators/<id>` found) and `fbt-swap` (the earlier default,
 *      kept as a fallback because the portal's normalisation is not ours to
 *      control).
 *
 * A quote is only accepted when the SIGNED split proves our amount and our
 * wallet, so trying the next candidate can never buy fee-free volume: it can
 * only turn a fee-less answer into a fee-paying one.
 */
const INTEGRATOR_FALLBACKS = ['fbtswap', 'fbt-swap'];
let integratorMemory = { id: null, until: 0 };
const INTEGRATOR_MEMORY_TTL_MS = 10 * 60 * 1000;

/** Every candidate id, normalised, configured-first and de-duplicated. */
export function integratorCandidates() {
  /* Commas only: an id may legitimately contain `_`/`-` but never a space, and
     splitting on whitespace would turn a typo'd "FBT Swap" into two ids. */
  const configured = String(process.env.LIFI_INTEGRATOR || '')
    .split(',')
    .map(normalizeIntegratorId)
    .filter(Boolean);
  const remembered = integratorMemory.until > Date.now() && integratorMemory.id ? [integratorMemory.id] : [];
  return [...new Set([...configured, ...remembered, ...INTEGRATOR_FALLBACKS.map(normalizeIntegratorId)].filter(Boolean))];
}

/** The id to try FIRST. Kept as the module's public "our integrator" answer. */
export const integratorId = () => integratorCandidates()[0];

/** Remember which id LI.FI actually paid, for the next 10 minutes. */
export function rememberIntegrator(id) {
  const norm = normalizeIntegratorId(id);
  if (!norm) return;
  integratorMemory = { id: norm, until: Date.now() + INTEGRATOR_MEMORY_TTL_MS };
}

/** Test seam: forget the remembered integrator. */
export function _resetLifiIntegratorState() {
  integratorMemory = { id: null, until: 0 };
}

/** True when `name` is one of our integrator ids. */
export function isOurIntegratorName(name) {
  return integratorCandidates().includes(normalizeIntegratorId(name));
}

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
const SYMBOL_RE = /^[A-Za-z0-9._₮$-]{1,24}$/;

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

/**
 * Read a fee amount LI.FI echoed into integer base units (floor).
 *
 * Same reader as src/lib/lifi.js#parseFeeUnits — LI.FI usually echoes integer
 * strings, but the same value can arrive as "86419.2", a JSON number, or the
 * decimal.js-shaped { c: [...] } form. `BigInt(String(v))` throws on those,
 * and a throw inside this gate would surface as a 500 for a pair that routes
 * fine. Unreadable is "not proven", never an exception.
 */
export function parseFeeUnits(v) {
  if (v == null) return null;
  if (typeof v === 'bigint') return v < 0n ? null : v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null;
    return BigInt(Math.floor(v));
  }
  if (typeof v === 'object') {
    const c = v.c;
    if (Array.isArray(c) && c.length === 1) return parseFeeUnits(c[0]);
    return null;
  }
  const s = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return BigInt(s.split('.')[0]);
}

/**
 * Every EVM wallet that is legitimately OURS.
 *
 * ─── WHY MEMBERSHIP AND NOT ONE STRING ──────────────────────────────────────
 * This gate used to demand `defaultWallet === swapFeeRecipient()` exactly. The
 * client-side gate (src/lib/lifi.js) was fixed on 2026-09-15 to accept any of
 * the operator's own receiving addresses, because the website and the APK are
 * built by two pipelines whose `VITE_*` names drifted apart — but the SERVER
 * gate runs FIRST, so its stricter rule still killed every quote before the
 * client's tolerance ever applied. The fee wallet LI.FI signs comes from the
 * portal registration; the env var is our local name for it. When the two
 * name different wallets of ours, the fee is genuinely ours and refusing it
 * takes down the only routing source on Mantle/Scroll/zkSync Era.
 *
 * The security property is unchanged: the echoed wallet must be one of OUR
 * addresses (env-configured or the published default). A quote that pays a
 * stranger is still refused here, before it ever reaches the client's alarm.
 */
function ourEvmWallets() {
  const out = new Set();
  const add = (a) => {
    const v = String(a ?? '').trim();
    if (isAddr(v)) out.add(v.toLowerCase());
  };
  add(swapFeeRecipient());
  add(process.env.VITE_FEE_RECIPIENT);
  add(process.env.VITE_PAYOUT_EVM);
  add(process.env.VITE_PAYOUT_ETHEREUM);
  add(process.env.VITE_PAYOUT_BSC);
  add(process.env.VITE_PAYOUT_SCROLL);
  add(process.env.VITE_PAYOUT_ZKSYNC);
  /* The published default, mirrored from src/lib/payout.js — kept literal so
     this module has no build-time dependency on the client bundle. */
  add('0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6');
  return out;
}

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
 * The signed-split evidence, read from the shapes LI.FI actually returns.
 *
 * Returns `{ ok, code, shareWei, lifiFeeWei, integrator }`, never throws.
 *
 * ─── THE 2026-10-22 ROOT CAUSE, WRITTEN DOWN ────────────────────────────────
 * This gate used to demand `body.integrator === id` AND
 * `body.fee === feeBps/10000`. `fee` is a REQUEST parameter: it is not part of
 * LI.FI's quote response at all (`@lifi/types`, `StepBase`/`LiFiStep`), so
 * `Number(body.fee ?? 0)` was 0 on every real quote and the gate answered
 * FEE_NOT_APPLIED forever. Because the fee gate's verdict outranks every other
 * failure in `classifyQuoteFailure`, that surfaced as a generic «مشکلی پیش
 * آمده» — and on the chains where LI.FI is the only fee-carrying executor
 * (zkSync Era 324, Scroll 534352, Mantle 5000) it meant NO pair could price,
 * while Monad/Robinhood broke only when KyberSwap's slug was down. Exactly the
 * report.
 *
 * The wallet half had the same defect: it read
 * `includedSteps[].action.integratorFees.recipients[].config.defaultWallet`,
 * a structure the response types do not contain. The modern proof is
 * `feeSplit.recipients[].walletAddress` (FeeRecipient in @lifi/types), which
 * is the source-chain address the router pays. Both shapes are accepted here;
 * neither is required to be the only one.
 *
 * What has NOT changed: the share must be the amount we asked for (±1 base
 * unit of LI.FI's documented rounding), it must be at least one base unit, and
 * the wallet it is paid to must be one of OURS. A half share is still refused.
 */
export function verifyLifiSwapFee(body, { integratorIds = integratorCandidates(), feeBps = 0 } = {}) {
  const ids = new Set(integratorIds.map(normalizeIntegratorId).filter(Boolean));
  const fromWei = fromWeiOf(body);
  const expected = (fromWei * BigInt(Math.max(0, Math.round(Number(feeBps) || 0)))) / 10000n; // floor
  const fail = (code) => ({ ok: false, code, shareWei: 0n, lifiFeeWei: 0n, integrator: null });

  if (!(feeBps > 0)) return fail('FEE_NOT_APPLIED');
  if (fromWei <= 0n) return fail('FEE_NOT_APPLIED');

  /* Identity echo: optional in the response, never ignored when present — a
     quote attributed to another integrator is another integrator's fee. */
  if (body?.integrator != null && String(body.integrator) !== '') {
    if (!ids.has(normalizeIntegratorId(body.integrator))) return fail('FEE_NOT_APPLIED');
  }
  /* Legacy/optional rate label. Present ⇒ must match; absent ⇒ the split is
     the evidence (the actual bug was treating "absent" as "mismatch"). */
  if (body?.fee != null) {
    const echoedRate = Number(body.fee);
    if (Number.isFinite(echoedRate) && Math.abs(echoedRate - feeBps / 10000) > 1e-9) {
      return fail('FEE_NOT_APPLIED');
    }
  }

  const feeCosts = Array.isArray(body?.estimate?.feeCosts) ? body.estimate.feeCosts : [];
  let split = null;
  let ours = null;
  for (const fc of feeCosts) {
    const recipients = Array.isArray(fc?.feeSplit?.recipients) ? fc.feeSplit.recipients : [];
    const hit = recipients.find((r) => ids.has(normalizeIntegratorId(r?.name)));
    if (hit) {
      split = fc.feeSplit;
      ours = hit;
      break;
    }
  }
  if (!ours) return fail('FEE_NOT_APPLIED');

  const shareWei = parseFeeUnits(ours.fee);
  if (shareWei == null || shareWei < 1n) return fail('FEE_NOT_APPLIED');
  const withinRounding =
    shareWei === expected || shareWei + 1n === expected || shareWei === expected + 1n;
  if (!withinRounding) return fail('FEE_NOT_APPLIED');

  const wallets = feeWallets(body, ids, ours);
  if (!wallets.length || !wallets.some((w) => ourEvmWallets().has(w.toLowerCase()))) {
    return fail('FEE_RECIPIENT_MISMATCH');
  }

  return {
    ok: true,
    code: null,
    shareWei,
    lifiFeeWei: parseFeeUnits(split?.lifiFee) ?? 0n,
    integrator: normalizeIntegratorId(ours.name) || null
  };
}

/** `action.fromAmount` as an integer, or 0n when unreadable. */
function fromWeiOf(body) {
  try {
    return BigInt(body?.action?.fromAmount ?? 0);
  } catch {
    return 0n;
  }
}

/**
 * Every wallet this quote pays us at, from every shape LI.FI uses.
 * See verifyLifiSwapFee for why there is more than one.
 */
function feeWallets(body, ids, ours = null) {
  const out = new Set();
  const add = (a) => {
    const v = String(a ?? '').trim();
    if (isAddr(v)) out.add(v);
  };
  /*
   * The signed split names the payout address, so when it is present it is the
   * ONLY address this quote may pay. The legacy shapes are consulted only for
   * bodies that carry no recipient-level address at all (older responses and
   * the synthetic body rebuilt at signing time).
   */
  if (ours && isAddr(ours.walletAddress)) {
    add(ours.walletAddress);
    return [...out];
  }
  const feeCosts = Array.isArray(body?.estimate?.feeCosts) ? body.estimate.feeCosts : [];
  for (const fc of feeCosts) {
    for (const r of fc?.feeSplit?.recipients ?? []) {
      if (ids.has(normalizeIntegratorId(r?.name))) add(r?.walletAddress);
    }
  }
  const steps = Array.isArray(body?.includedSteps) ? body.includedSteps : [];
  for (const s of steps) {
    for (const r of s?.action?.integratorFees?.recipients ?? []) {
      /* Scoped to OUR name: a stranger's row in this array must never be able
         to make a quote pass just because one of the entries is ours. */
      if (!ids.has(normalizeIntegratorId(r?.name))) continue;
      add(r?.config?.defaultWallet);
      add(r?.walletAddress);
    }
  }
  return [...out];
}

/**
 * LI.FI same-chain swap quote with OUR fee attached and the evidence verified.
 *
 * Walks the integrator ladder (see `integratorCandidates`): the first id that
 * yields a quote whose signed split proves our amount AND our wallet wins, and
 * is remembered for ten minutes. A candidate that produces a fee-less quote is
 * rejected — trying the next id never buys fee-free volume, it only turns a
 * fee-less answer into a fee-paying one. A hard upstream failure (timeout,
 * 5xx) stops the ladder immediately: another id cannot fix a down host.
 *
 * @returns {Promise<{ok:boolean, status:number, body:object}>}
 */
export async function lifiSwapQuote(params = {}) {
  const fromChain = Number(params.fromChain);
  const toChain = Number(params.toChain);
  const fromAmount = String(params.fromAmount ?? '');
  const fromAddress = String(params.fromAddress ?? '').trim() || '0x0000000000000000000000000000000000000000';
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

  const [fromRef, toRef] = [
    isAddr(fromToken) ? await checksummed(fromToken) : fromToken,
    isAddr(toToken) ? await checksummed(toToken) : toToken
  ];

  const fee = swapFee();
  const candidates = integratorCandidates();
  let lastRefusal = null;

  for (const id of candidates) {
    const q = new URLSearchParams({
      fromChain: String(fromChain),
      toChain: String(toChain),
      fromToken: fromRef,
      toToken: toRef,
      fromAmount,
      fromAddress,
      /* The user's own address is always the destination for a swap. */
      toAddress: String(params.toAddress ?? fromAddress),
      slippage: String(Math.min(0.5, Math.max(0.0005, Number(params.slippage) || 0.005))),
      integrator: id,
      fee: String(fee)
    });

    const res = await lifiFetch(`/quote?${q.toString()}`);
    if (!res.ok) {
      /*
       * An integrator-specific refusal (LI.FI answers 400/422 with a message
       * naming the integrator, or 1011 "Integrator not found") is worth one
       * retry under the next id — that is the whole point of the ladder.
       * Anything else is transport or liquidity: another id cannot help, and
       * walking it would multiply the user's wait.
       */
      const message = String(res.body?.message || res.body?.error || '');
      const integratorRefusal =
        (res.status === 400 || res.status === 422) &&
        /integrator|fee/i.test(message) &&
        !/amount|token|route|slippage/i.test(message);
      lastRefusal = { ok: false, status: res.status, body: res.body ?? { error: 'UPSTREAM_FAILED' } };
      if (integratorRefusal) continue;
      return lastRefusal;
    }

    /* ── THE EVIDENCE GATE — before this response leaves the server ─────────
     * What ends up signed is the calldata LI.FI built for THIS quote, and its
     * fee fields must prove OUR cut lands in OUR wallet. Anything less is
     * rejected here so the client never even sees a quote we cannot honour.
     * (The client re-verifies the same evidence before signing — one gate is a
     * wall, two is a wall with an alarm.)
     */
    const gate = verifyLifiSwapFee(res.body, { integratorIds: candidates, feeBps: Math.round(fee * 10000) });
    if (gate.ok) {
      /* A quote without buildable bytes is not executable, whatever it proves
         about the fee — the client would have to refuse it anyway. */
      if (!res.body?.transactionRequest?.data || !res.body?.transactionRequest?.to) {
        return { ok: false, status: 502, body: { error: 'NO_TRANSACTION_REQUEST' } };
      }
      rememberIntegrator(gate.integrator || id);
      return { ok: true, status: 200, body: res.body };
    }
    lastRefusal = { ok: false, status: 502, body: { error: gate.code } };
    /* A wallet mismatch is about the address LI.FI pays, not about the id we
       asked under — the other candidates would fail identically. */
    if (gate.code === 'FEE_RECIPIENT_MISMATCH') break;
  }

  return lastRefusal ?? { ok: false, status: 502, body: { error: 'FEE_NOT_APPLIED' } };
}
