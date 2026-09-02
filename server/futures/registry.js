/**
 * FBT FUTURES — Provider Registry + health monitor (spec §3, §4, §20).
 * ---------------------------------------------------------------------------
 * The backend source of truth for "which venue can do what RIGHT NOW".
 *
 *   status  ∈ AVAILABLE · DEGRADED · READ_ONLY · UNAVAILABLE · MAINTENANCE · BLOCKED
 *
 * Status is DERIVED, never declared: each provider's adapter is probed, the
 * probe result is cached for a short window, and an error ledger downgrades a
 * venue after repeated failures. Operator switches (env) can only make a venue
 * LESS available (maintenance / block / disable) — nothing in config can flip
 * a venue to AVAILABLE without a live feed and a built order path.
 *
 * Environment:
 *   FUTURES_PROVIDERS_ENABLED   comma list; default "drift,ostium,dydx" (others READ_ONLY/UNAVAILABLE)
 *   FUTURES_PROVIDERS_MAINTENANCE / FUTURES_PROVIDERS_BLOCKED   comma lists
 *   FUTURES_FBT_FEE_RECIPIENT   EVM address the Ostium builder fee is paid to
 *   FUTURES_FBT_FEE_BPS         override for the STANDARD policy (0–10)
 */
import {
  PROVIDER_CATALOGUE, PROVIDER_IDS, PROVIDER_STATUS, EXECUTION_MODEL, FORBIDDEN_PROVIDER_IDS,
  resolveProviderStatus, isExecutableStatus
} from '../../src/lib/futures-engine/providers.js';
import { withTimeout } from '../central/errorEngine.js';
import { publish } from '../central/eventBus.js';
import * as ostium from './adapters/ostium.js';
import * as drift from './adapters/drift.js';
import { fetchDydxMarkets } from '../dydx.js';
import { withCache } from '../cache.js';

const HEALTH_CACHE_MS = 20_000;
const ERROR_WINDOW_MS = 10 * 60_000;

const list = (name, fallback = '') => String(process.env[name] ?? fallback).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
export function fbtFeeRecipient() {
  const configured = process.env.FUTURES_FBT_FEE_RECIPIENT || process.env.VITE_PAYOUT_EVM || '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';
  return EVM_ADDR.test(configured) ? configured : null;
}

export function fbtFeeOverrideBps() {
  const raw = process.env.FUTURES_FBT_FEE_BPS;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const healthCache = new Map(); // providerId -> { result, at }
const errorLedger = new Map(); // providerId -> [{ at, code }]
const lastStatus = new Map();  // providerId -> status (for change events)

export function noteProviderError(providerId, code = 'UNKNOWN') {
  const now = Date.now();
  const rows = (errorLedger.get(providerId) || []).filter((r) => now - r.at < ERROR_WINDOW_MS);
  rows.push({ at: now, code: String(code).slice(0, 40) });
  errorLedger.set(providerId, rows);
  healthCache.delete(providerId);
}
export function noteProviderSuccess(providerId) { errorLedger.delete(providerId); }
const recentErrors = (providerId) => (errorLedger.get(providerId) || []).filter((r) => Date.now() - r.at < ERROR_WINDOW_MS).length;

/** Is the execution path for this provider actually configured on this deployment? */
export function providerConfigured(providerId) {
  const p = PROVIDER_CATALOGUE[providerId];
  if (!p) return false;
  if (p.execution === EXECUTION_MODEL.NOT_BUILT) return false;
  if (providerId === 'ostium') return Boolean(fbtFeeRecipient());
  if (providerId === 'dydx') return true; // executes in its own tab via the client session
  /* Drift reads public market data server-side; the ORDER path builds and
     signs in the browser with @drift-labs/sdk + the user's own Solana wallet
     (EXECUTION_MODEL.CLIENT_BUILDS_TX), so no server key/config is needed. */
  if (providerId === 'drift') return true;
  return false;
}

/* ── per-provider probes (data liveness only; never invent) ──────────────── */

async function probeOstium() {
  try {
    const mk = await withTimeout(ostium.readMarkets(), 9000, 'ostium-markets');
    const h = ostium.healthFromMarkets(mk);
    return { ...h, marketCount: mk.markets.length, readAt: mk.readAt, detail: null };
  } catch (err) {
    return { dataLive: false, dataStale: false, marketCount: 0, readAt: null, detail: String(err?.message || 'OSTIUM_UNREACHABLE').slice(0, 80) };
  }
}

async function probeDrift() {
  try {
    const mk = await withTimeout(drift.readMarkets(), 9000, 'drift-markets');
    const h = drift.healthFromMarkets(mk);
    return { ...h, marketCount: mk.markets.length, readAt: mk.readAt, detail: null };
  } catch (err) {
    return { dataLive: false, dataStale: false, marketCount: 0, readAt: null, detail: String(err?.message || 'DRIFT_UNREACHABLE').slice(0, 80) };
  }
}

async function probeDydx() {
  try {
    const { value, stale } = await withTimeout(withCache('futures:dydx:markets', 30_000, fetchDydxMarkets), 9000, 'dydx-markets');
    const rows = Array.isArray(value?.markets) ? value.markets : Object.values(value?.markets || {});
    return { dataLive: rows.length > 0, dataStale: stale === true, marketCount: rows.length, readAt: Date.now(), detail: null };
  } catch (err) {
    return { dataLive: false, dataStale: false, marketCount: 0, readAt: null, detail: String(err?.message || 'DYDX_UNREACHABLE').slice(0, 80) };
  }
}

const PROBES = { ostium: probeOstium, drift: probeDrift, dydx: probeDydx };

export async function probeProvider(providerId, { force = false } = {}) {
  const p = PROVIDER_CATALOGUE[providerId];
  if (!p) return null;
  const cached = healthCache.get(providerId);
  if (!force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) return cached.result;

  const enabled = list('FUTURES_PROVIDERS_ENABLED', 'drift,ostium,dydx').includes(providerId);
  const maintenance = list('FUTURES_PROVIDERS_MAINTENANCE').includes(providerId);
  const blocked = list('FUTURES_PROVIDERS_BLOCKED').includes(providerId) || FORBIDDEN_PROVIDER_IDS.includes(providerId);
  const probe = PROBES[providerId] ? await PROBES[providerId]() : { dataLive: false, dataStale: false, marketCount: 0, readAt: null, detail: 'NO_PROBE' };
  const configured = providerConfigured(providerId);
  const errors = recentErrors(providerId);
  const { status, reason } = resolveProviderStatus({
    execution: p.execution, configured, enabled, maintenance, blocked,
    dataLive: probe.dataLive, dataStale: probe.dataStale, recentErrors: errors
  });

  const result = {
    providerId,
    name: p.name,
    status,
    reason: reason || probe.detail || null,
    executable: isExecutableStatus(status) && p.capabilities.canExecute && configured,
    execution: p.execution,
    configured,
    family: p.family,
    chainId: p.chainId,
    chainName: p.chainName,
    custody: p.custody,
    collateral: p.collateral,
    markets: p.markets,
    marketCount: probe.marketCount,
    capabilities: p.capabilities,
    fbtFeeModel: p.fbtFeeModel,
    fbtFeeChargedOn: p.fbtFeeChargedOn,
    venueFeeCapBps: p.venueFeeCapBps,
    tab: p.tab,
    recentErrors: errors,
    dataAgeMs: probe.readAt ? Date.now() - probe.readAt : null,
    checkedAt: Date.now()
  };
  healthCache.set(providerId, { result, at: Date.now() });

  const prev = lastStatus.get(providerId);
  if (prev !== status) {
    lastStatus.set(providerId, status);
    publish('FUTURES_PROVIDER_HEALTH_CHANGED', { providerId, from: prev || null, to: status, reason: result.reason }, { source: 'futures-registry' });
  }
  return result;
}

export async function listProviders({ force = false } = {}) {
  const rows = await Promise.all(PROVIDER_IDS.map((id) => probeProvider(id, { force })));
  return rows.filter(Boolean);
}

export function providerCatalogueEntry(providerId) { return PROVIDER_CATALOGUE[providerId] || null; }

/** Test hook. */
export function resetFuturesRegistry() { healthCache.clear(); errorLedger.clear(); lastStatus.clear(); }

export { PROVIDER_STATUS };
