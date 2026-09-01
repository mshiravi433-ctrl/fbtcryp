/**
 * FBT WALLET ENGINE — APPROVAL MANAGER
 * ---------------------------------------------------------------------------
 * Every ERC-20 allowance a wallet has granted is a standing permission to move
 * its tokens. The manager inventories them, classifies each (exact / bounded /
 * UNLIMITED), detects the dangerous ones, and produces a revoke plan.
 *
 * The classification math lives in `src/lib/intent-ai/approvalHygiene.js`
 * (phase 83) — this module is the wallet-facing surface: it turns a flat list
 * of allowance rows into a per-chain summary the Wallet screen can render,
 * surfaces unlimited approvals FIRST, and never recommends revoking an
 * allowance it has not actually seen.
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · Exposure in dollars is null when the token price is missing — an unlimited
 *   approval on an unpriced token is still reported as UNLIMITED, just without
 *   a dollar figure, because hiding the approval is worse than hiding the sum.
 * · A revoke plan is a PLAN (token + spender + target zero). Broadcasting it
 *   is the wallet's job, through the orchestrator, not this module's.
 */

import {
  classifyAllowance,
  MAX_UINT256,
  EFFECTIVELY_UNLIMITED,
  APPROVAL_RISKS,
  STALE_APPROVAL_MS
} from '../intent-ai/approvalHygiene.js';

export const APPROVAL_MANAGER_SCHEMA = 'fbt.approval-manager.v1';

/** True when an allowance amount is (or is effectively) unlimited. */
export function isUnlimitedAllowance(allowance) {
  if (allowance == null) return false;
  let big;
  try {
    if (typeof allowance === 'bigint') big = allowance;
    else if (typeof allowance === 'string' && /^0x[0-9a-f]+$/i.test(allowance.trim())) big = BigInt(allowance.trim());
    else if (typeof allowance === 'string' && /^\d+$/.test(allowance.trim())) big = BigInt(allowance.trim());
    else if (typeof allowance === 'number' && Number.isFinite(allowance)) big = BigInt(Math.trunc(allowance));
    else return false;
  } catch { return false; }
  return big >= EFFECTIVELY_UNLIMITED;
}

/**
 * Scan a list of allowance rows into a renderable, risk-ordered summary.
 * Each row is the shape `classifyAllowance` accepts (token, spender,
 * allowance, decimals, priceUsd, updatedAt).
 */
export function scanApprovals(rows = [], { now = Date.now() } = {}) {
  const entries = (Array.isArray(rows) ? rows : []).map((r) => {
    const classified = classifyAllowance(r, { now });
    return {
      schema: APPROVAL_MANAGER_SCHEMA,
      token: r.token ?? null,
      spender: r.spender ?? null,
      chainId: r.chainId ?? null,
      allowance: r.allowance ?? null,
      unlimited: isUnlimitedAllowance(r.allowance),
      risk: classified?.risk || 'none',
      stale: classified?.stale === true,
      exposureUsd: classified?.exposureUsd ?? null,
      revoke: buildRevokePlan(r)
    };
  });

  const unlimited = entries.filter((e) => e.unlimited);
  const risky = entries.filter((e) => e.risk === 'high' || e.risk === 'medium');
  const stale = entries.filter((e) => e.stale);

  /* Unlimited + risky first, then stale, then the rest — the dangerous stuff
     must never be buried below fifty harmless allowances. */
  const order = (e) => (e.unlimited ? 0 : e.risk === 'high' ? 1 : e.risk === 'medium' ? 2 : e.stale ? 3 : 4);
  entries.sort((a, b) => order(a) - order(b));

  const byChain = new Map();
  for (const e of entries) {
    const k = e.chainId ?? 'unknown';
    if (!byChain.has(k)) byChain.set(k, { chainId: e.chainId, count: 0, unlimited: 0, risky: 0 });
    const c = byChain.get(k);
    c.count += 1;
    if (e.unlimited) c.unlimited += 1;
    if (e.risk === 'high' || e.risk === 'medium') c.risky += 1;
  }

  return {
    schema: 'fbt.approval-summary.v1',
    total: entries.length,
    unlimitedCount: unlimited.length,
    riskyCount: risky.length,
    staleCount: stale.length,
    entries,
    byChain: [...byChain.values()]
  };
}

/** Build a revoke plan for one allowance row. Pure — nothing is broadcast. */
export function buildRevokePlan(entry = {}) {
  return {
    token: entry.token ?? entry.address ?? null,
    spender: entry.spender ?? null,
    targetAllowance: '0',
    action: 'revoke'
  };
}

/* Re-export the classifier constants so callers render one consistent story. */
export { MAX_UINT256, EFFECTIVELY_UNLIMITED, APPROVAL_RISKS, STALE_APPROVAL_MS };
