/**
 * PORTFOLIO AGENT — a saved allocation target, not an actor.
 *
 * `GET /api/portfolio/agent` answered a hardcoded "unavailable" because there
 * was nowhere to keep a configuration. There is now, and it is deliberately
 * the least powerful thing that could still be useful: a per-user allocation
 * target with rebalance bounds, stored under the authenticated Telegram id.
 *
 * WHAT IT CANNOT DO, BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 * `validatePortfolioAgent` (server/phase2Schemas.js) refuses `withdrawFunds`
 * and `executeWithoutUser` and forces `rebalance.mode = 'approval_required'`,
 * and only its OUTPUT is stored. There is no scheduler, no job, no signer and
 * no route that reads this config and does something with it — the only
 * consumer is the user's own screen, which can turn a drift into a DRAFT
 * intent that the user still has to approve and sign. If a future change adds
 * an executor, it has to add it here in the open, not inherit it.
 */

import { blobConfigured } from './blobCache.js';
import { storeGet, storeSet } from './store.js';
import { SCHEMAS, validatePortfolioAgent } from './phase2Schemas.js';

const key = (owner) => `portfolio-agents:v1:${String(owner)}`;
const ASSET = /^[A-Za-z0-9._-]{1,16}$/;
const MAX_ALLOCATIONS = 24;

export const PORTFOLIO_LIMITATIONS = Object.freeze([
  'Approval-only: every rebalance becomes a draft intent the user signs.',
  'No automatic execution, no scheduler, no server-side signer.',
  'No custody: the app never holds or moves funds.'
]);

const fail = (code) => ({ ok: false, code });
const durableStore = Object.freeze({ durable: blobConfigured, get: storeGet, set: storeSet });

/** Allocations are symbols and weights; addresses and free text are refused. */
function allocations(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const out = [];
  for (const row of value.slice(0, MAX_ALLOCATIONS)) {
    const asset = typeof row?.asset === 'string' ? row.asset.trim().toUpperCase() : '';
    const targetPct = Number(row?.targetPct);
    if (!ASSET.test(asset) || !Number.isFinite(targetPct) || targetPct <= 0 || targetPct > 100) return null;
    const chainId = Number(row?.chainId);
    out.push({ asset, targetPct: Math.round(targetPct * 100) / 100, chainId: Number.isInteger(chainId) && chainId > 0 ? chainId : null });
  }
  const total = out.reduce((sum, row) => sum + row.targetPct, 0);
  /* A target that does not add up to 100% is a typo, and silently normalising
     it would rebalance towards something the user never asked for. */
  if (Math.abs(total - 100) > 0.5) return null;
  return out;
}

export async function readPortfolioAgent(owner, store = durableStore) {
  if (!store.durable()) return { ok: true, dataStatus: 'unavailable', data: null };
  const saved = await store.get(key(owner), null);
  if (!saved) return { ok: true, dataStatus: 'live', data: null };
  /* Re-validate on read: a stored config that no longer satisfies the
     fail-closed schema is dropped, never repaired into something usable. */
  const validated = validatePortfolioAgent(saved);
  if (!validated.ok) return { ok: true, dataStatus: 'live', data: null };
  return { ok: true, dataStatus: 'live', data: validated.value };
}

export async function savePortfolioAgent(owner, input = {}, store = durableStore) {
  if (!store.durable()) return fail('REGISTRY_STORE_UNAVAILABLE');
  const rows = allocations(input.allocations);
  if (!rows) return fail('INVALID_ALLOCATIONS');
  const rebalance = input.rebalance || {};
  const candidate = {
    schema: SCHEMAS.portfolioAgent,
    allocations: rows,
    /* Both are re-asserted here and refused again by the validator below. */
    permissions: { withdrawFunds: false, executeWithoutUser: false, requiresUserApproval: true },
    rebalance: {
      maxTradeUsd: Number(rebalance.maxTradeUsd),
      maxSlippageBps: Number(rebalance.maxSlippageBps),
      driftThresholdBps: Number.isFinite(Number(rebalance.driftThresholdBps)) ? Math.max(Number(rebalance.driftThresholdBps), 10) : 500,
      mode: 'approval_required'
    },
    limitations: [...PORTFOLIO_LIMITATIONS],
    updatedAt: Date.now()
  };
  const validated = validatePortfolioAgent(candidate);
  if (!validated.ok) return validated;
  await store.set(key(owner), validated.value);
  return { ok: true, data: validated.value };
}

export async function clearPortfolioAgent(owner, store = durableStore) {
  if (!store.durable()) return fail('REGISTRY_STORE_UNAVAILABLE');
  await store.set(key(owner), null);
  return { ok: true, data: null };
}
