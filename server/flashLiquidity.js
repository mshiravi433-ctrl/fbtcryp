/**
 * FBT Flash Liquidity — server-side dry-run planning API (Phase 152).
 *
 * This module is deliberately read-only:
 *  - it accepts NO funds, NO keys, NO signed payloads, and NO calldata to
 *    broadcast;
 *  - /scan and /plan are deterministic planners over venue reserve snapshots
 *    supplied by the caller (indicative data, short TTL enforced);
 *  - every response repeats the honest limits: execution requires an
 *    independently audited router contract, a passing simulation, and an
 *    explicit wallet signature. The server never signs or sends anything.
 *
 * The planning math lives in src/lib/intent-ai/flashLiquidity.js — the same
 * deterministic module the browser uses, so a plan built server-side is
 * byte-for-byte reproducible client-side.
 */

import {
  FLASH_LIQUIDITY_VERSION,
  FLASH_LIQUIDITY_LIMITS,
  FLASH_PROVIDER_REGISTRY,
  MAX_HOPS,
  MAX_QUOTE_AGE_MS,
  parseFlashIntent,
  scanOpportunities,
  planFlashArbitrage,
  createFlashPolicy,
  flashLiquidityCapabilityReport,
  chainName
} from '../src/lib/intent-ai/flashLiquidity.js';
import { flashLiquidityRouterConfigured } from './flashLiquidityConfig.js';
import { createFlashSimulator, simulationRpcFromEnv } from './flashLiquiditySimulation.js';

const SUPPORTED_CHAINS = Object.keys(FLASH_PROVIDER_REGISTRY['balancer-v2'].chains).map(Number);

const MAX_SNAPSHOTS = 24;
const MAX_AMOUNT = /^[0-9]{1,40}$/;
const MAX_TEXT = 2000;

function bad(res, code, detail) {
  return res.status(400).json({ ok: false, error: code, detail: detail || null });
}

function validSnapshot(s) {
  return Boolean(
    s && typeof s === 'object' && !Array.isArray(s)
    && typeof s.venueId === 'string' && s.venueId.length >= 1 && s.venueId.length <= 48
    && typeof s.reserveA === 'string' && MAX_AMOUNT.test(s.reserveA) && BigInt(s.reserveA) > 0n
    && typeof s.reserveB === 'string' && MAX_AMOUNT.test(s.reserveB) && BigInt(s.reserveB) > 0n
    && Number.isInteger(s.feeBps) && s.feeBps >= 0 && s.feeBps < 1000
    && Number.isFinite(s.observedAtMs)
  );
}

function validateMarket(body, { requireEconomics = false } = {}) {
  const market = body.market || {};
  const chainId = Number(market.chainId);
  if (!SUPPORTED_CHAINS.includes(chainId)) {
    return { error: { code: 'UNSUPPORTED_CHAIN', detail: `chainId must be one of ${SUPPORTED_CHAINS.join(', ')}` } };
  }
  const asset = typeof market.asset === 'string' && market.asset.length <= 16 ? market.asset : null;
  /* USD economics are only needed to build a costed plan; a raw scan is
     reserve-math only and stays usable without price oracles. */
  const assetPriceUsd = Number(market.assetPriceUsd);
  const assetDecimals = Number(market.assetDecimals);
  if (requireEconomics && (!(assetPriceUsd > 0) || assetPriceUsd > 1e9)) {
    return { error: { code: 'BAD_ASSET_PRICE' } };
  }
  if (requireEconomics && (!Number.isInteger(assetDecimals) || assetDecimals < 0 || assetDecimals > 18)) {
    return { error: { code: 'BAD_ASSET_DECIMALS' } };
  }
  const snapshots = market.snapshots;
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return { error: { code: 'NEED_AT_LEAST_TWO_VENUES', detail: 'supply 2–24 reserve snapshots for the same pair' } };
  }
  if (snapshots.length > MAX_SNAPSHOTS) {
    return { error: { code: 'TOO_MANY_SNAPSHOTS', detail: `max ${MAX_SNAPSHOTS}` } };
  }
  if (!snapshots.every(validSnapshot)) {
    return { error: { code: 'INVALID_SNAPSHOT', detail: 'each snapshot needs venueId, reserveA/reserveB (decimal strings), feeBps, observedAtMs' } };
  }
  const nativePriceUsd = Number(market.nativePriceUsd);
  if (requireEconomics && (!(nativePriceUsd > 0) || nativePriceUsd > 1e7)) {
    return { error: { code: 'BAD_NATIVE_PRICE' } };
  }
  return {
    market: {
      chainId,
      asset,
      assetPriceUsd,
      assetDecimals,
      nativePriceUsd,
      snapshots
    }
  };
}

function validateConfig(body) {
  const config = body.config && typeof body.config === 'object' ? body.config : {};
  const out = {};
  if (config.gasUnits != null) {
    const gasUnits = Number(config.gasUnits);
    if (!(gasUnits > 0) || gasUnits > 5_000_000) return { error: { code: 'BAD_GAS_UNITS' } };
    out.gasUnits = gasUnits;
  }
  if (config.gasPriceGwei != null) {
    const gwei = Number(config.gasPriceGwei);
    if (!(gwei > 0) || gwei > 10_000) return { error: { code: 'BAD_GAS_PRICE' } };
    out.gasPriceGwei = gwei;
  }
  if (config.platformFeeBps != null) {
    const bps = Number(config.platformFeeBps);
    if (!Number.isInteger(bps) || bps < 0 || bps > 1000) return { error: { code: 'BAD_PLATFORM_FEE' } };
    out.platformFeeBps = bps;
  }
  if (config.mevBufferBps != null) {
    const bps = Number(config.mevBufferBps);
    if (!Number.isInteger(bps) || bps < 0 || bps > 500) return { error: { code: 'BAD_MEV_BUFFER' } };
    out.mevBufferBps = bps;
  }
  if (config.slippageBps != null) {
    const bps = Number(config.slippageBps);
    if (!Number.isInteger(bps) || bps < 1 || bps > 1000) return { error: { code: 'BAD_SLIPPAGE' } };
    out.slippageBps = bps;
  }
  if (config.deadlineSeconds != null) {
    const d = Number(config.deadlineSeconds);
    if (!Number.isInteger(d) || d < 10 || d > 600) return { error: { code: 'BAD_DEADLINE' } };
    out.deadlineSeconds = d;
  }
  if (config.providerId != null) {
    if (typeof config.providerId !== 'string' || !FLASH_PROVIDER_REGISTRY[config.providerId]) {
      return { error: { code: 'UNKNOWN_PROVIDER' } };
    }
    out.providerId = config.providerId;
  }
  return { config: out };
}

function policyFrom(body) {
  const overrides = body.policy && typeof body.policy === 'object' ? body.policy : {};
  return createFlashPolicy(overrides);
}

function attemptsFrom(body) {
  const n = Number(body?.context?.attemptsToday || 0);
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? Math.floor(n) : 0;
}

/** Accept `market: {...}` or flat top-level fields (chainId, asset, snapshots…). */
function normalizeMarket(body) {
  if (body.market && typeof body.market === 'object') return body;
  return {
    ...body,
    market: {
      chainId: body.chainId,
      asset: body.asset,
      assetPriceUsd: body.assetPriceUsd,
      assetDecimals: body.assetDecimals,
      nativePriceUsd: body.nativePriceUsd,
      snapshots: body.snapshots
    }
  };
}

/* ── Capability report ─────────────────────────────────────────────────────── */

export function flashLiquidityCapabilities() {
  const router = flashLiquidityRouterConfigured();
  const simulationRpc = simulationRpcFromEnv();
  const report = flashLiquidityCapabilityReport({
    routerConfigured: router.configured,
    routerAudited: router.audited,
    simulationAvailable: Boolean(simulationRpc)
  });
  return {
    ok: true,
    version: FLASH_LIQUIDITY_VERSION,
    status: report.status,
    missing: report.missing,
    executionEnabled: report.executionEnabled,
    chains: SUPPORTED_CHAINS.map((chainId) => ({ chainId, chain: chainName(chainId) })),
    providers: report.providers,
    limits: FLASH_LIQUIDITY_LIMITS,
    plannerEnabled: true,
    scanEnabled: true,
    executionPrerequisites: report.executionPrerequisites,
    endpoints: {
      scan: 'POST /api/flash-liquidity/v1/scan (active planner, no broadcast)',
      plan: 'POST /api/flash-liquidity/v1/plan (active planner, no broadcast)'
    },
    simulation: {
      endpoint: 'POST /api/flash-liquidity/v1/simulate (eth_call dry-run)',
      configured: Boolean(simulationRpc),
      note: 'FLASH_LIQUIDITY_SIMULATION_RPC — https required, http only on loopback for local chains/forks.'
    },
    quoteMaxAgeMs: MAX_QUOTE_AGE_MS,
    maxHops: MAX_HOPS,
    note: 'Scan and planning are active. This API does not sign, send, or hold. Wallet execution is enabled only when an audited router contract and simulation RPC are configured.'
  };
}

/* ── POST /scan ────────────────────────────────────────────────────────────── */

export function flashScan(req, res) {
  const body = normalizeMarket(req.body && typeof req.body === 'object' ? req.body : {});
  const checked = validateMarket(body, { requireEconomics: false });
  if (checked.error) return bad(res, checked.error.code, checked.error.detail);
  const premium = body.loanPremiumBps != null ? Number(body.loanPremiumBps) : null;
  if (premium != null && (!Number.isInteger(premium) || premium < 0 || premium > 500)) {
    return bad(res, 'BAD_LOAN_PREMIUM');
  }
  const result = scanOpportunities({
    chainId: checked.market.chainId,
    asset: checked.market.asset,
    snapshots: checked.market.snapshots,
    loanPremiumBps: premium,
    now: Date.now()
  });
  return res.json({ ok: true, mode: 'dry-run', broadcasts: false, ...result });
}

/* ── POST /simulate — the REAL step-7 gate (eth_call, never a broadcast) ───── */

export function flashSimulate(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rpcUrl = simulationRpcFromEnv();
  const simulator = createFlashSimulator({ rpcUrl, chainId: Number(body.chainId) || 0 });
  return simulator.simulate({
    to: body.to,
    data: body.data,
    from: body.from == null ? null : body.from
  }).then((result) => res.json(result)).catch(() => res.status(500).json({ ok: false, code: 'SIMULATION_FAILED' }));
}

/* ── POST /plan ────────────────────────────────────────────────────────────── */

export function flashPlan(req, res) {
  const body = normalizeMarket(req.body && typeof req.body === 'object' ? req.body : {});


  /* intent: structured, or natural language text parsed deterministically */
  let intent = body.intent;
  if (!intent && typeof body.intentText === 'string') {
    if (body.intentText.length > MAX_TEXT) return bad(res, 'INTENT_TOO_LONG');
    const parsed = parseFlashIntent(body.intentText);
    if (!parsed.ok) return bad(res, parsed.code);
    intent = parsed;
  }
  if (!intent || intent.kind !== 'flash-arbitrage') {
    return bad(res, 'BAD_INTENT', 'supply intent { kind: "flash-arbitrage", minNetProfitBps } or intentText');
  }
  const minNetProfitBps = Number(intent.minNetProfitBps);
  if (!Number.isFinite(minNetProfitBps) || minNetProfitBps < 1 || minNetProfitBps > 5000) {
    return bad(res, 'BAD_MIN_PROFIT_BPS');
  }

  const checked = validateMarket(body, { requireEconomics: true });
  if (checked.error) return bad(res, checked.error.code, checked.error.detail);
  const cfg = validateConfig(body);
  if (cfg.error) return bad(res, cfg.error.code, cfg.error.detail);

  /* join market gas inputs into config for the planner */
  const config = {
    ...cfg.config,
    nativePriceUsd: checked.market.nativePriceUsd
  };
  if (!(Number(config.gasPriceGwei) > 0)) return bad(res, 'BAD_GAS_PRICE', 'config.gasPriceGwei is required');
  if (!(checked.market.assetPriceUsd > 0)) return bad(res, 'BAD_ASSET_PRICE');

  const plan = planFlashArbitrage({
    intent: { ...intent, minNetProfitBps: Math.round(minNetProfitBps) },
    market: {
      chainId: checked.market.chainId,
      asset: checked.market.asset,
      assetPriceUsd: checked.market.assetPriceUsd,
      assetDecimals: checked.market.assetDecimals,
      snapshots: checked.market.snapshots
    },
    config,
    policy: policyFrom(body),
    context: { now: Date.now(), attemptsToday: attemptsFrom(body) }
  });

  return res.json({ ok: true, mode: 'dry-run', broadcasts: false, plan });
}
