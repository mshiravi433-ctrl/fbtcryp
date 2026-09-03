/**
 * FBT FUTURES FEE ENGINE (spec §7).
 * ---------------------------------------------------------------------------
 *   Protocol fee + Network fee + FBT fee = Total
 *
 * One pure module used by the server (source of truth) AND by the UI (for the
 * preview it renders from the server's numbers). There is no second formula
 * anywhere: the UI never computes a fee the backend did not compute first.
 *
 * ─── THE RULES, AS CODE ─────────────────────────────────────────────────────
 *   · BPS of NOTIONAL. A perp fee is charged on collateral × leverage, and the
 *     engine says so next to every number (`fbtFeePctOfCollateral`).
 *   · Policies are configurable (STANDARD / VIP / PARTNER / ZERO) but every one
 *     is clamped to FBT_FEE_MAX_BPS AND to the venue's own cap, whichever is
 *     smaller. A misconfigured policy cannot charge more than the ceiling.
 *   · No hidden spread, markup or padding. Protocol and network components are
 *     passed in from the provider read and reported separately; when one is
 *     unknown the TOTAL is null rather than a partial sum dressed as a total.
 *   · Every breakdown carries its policy id, its bps and the receiving address
 *     so the revenue ledger can be reconciled against the chain.
 */

/** Hard ceiling on what any policy may charge, in bps of notional. */
export const FBT_FEE_MAX_BPS = 10;
/** Default when nothing is configured — 10 bps, the app-wide builder rate
 *  (raised from 5 on the owner's instruction; matches BUILDER_BPS_DEFAULT
 *  and the dYdX builder fee so every executable path charges the same). */
export const FBT_FEE_DEFAULT_BPS = 10;

export const FEE_POLICIES = Object.freeze({
  STANDARD: Object.freeze({ id: 'STANDARD', bps: FBT_FEE_DEFAULT_BPS, label: 'Standard' }),
  VIP: Object.freeze({ id: 'VIP', bps: 3, label: 'VIP' }),
  PARTNER: Object.freeze({ id: 'PARTNER', bps: 2, label: 'Partner' }),
  ZERO: Object.freeze({ id: 'ZERO', bps: 0, label: 'No FBT fee' })
});
export const FEE_POLICY_IDS = Object.freeze(Object.keys(FEE_POLICIES));

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Notional = collateral × leverage; null when either input is unusable. */
export function notionalUsd({ collateralUsd, leverage }) {
  const c = num(collateralUsd);
  const x = num(leverage);
  if (c == null || c <= 0 || x == null || x <= 0) return null;
  return c * x;
}

/**
 * Resolve the effective FBT bps for a policy against a venue cap.
 * Both ceilings apply; an unknown policy falls back to STANDARD, never to the
 * maximum.
 */
export function resolveFbtBps({ policyId = 'STANDARD', overrideBps = null, venueCapBps = null } = {}) {
  const policy = FEE_POLICIES[String(policyId || 'STANDARD').toUpperCase()] || FEE_POLICIES.STANDARD;
  let bps = policy.bps;
  const override = num(overrideBps);
  if (override != null && override >= 0) bps = override;
  const caps = [FBT_FEE_MAX_BPS];
  const venueCap = num(venueCapBps);
  if (venueCap != null && venueCap >= 0) caps.push(venueCap);
  const cap = Math.min(...caps);
  return { policyId: policy.id, bps: Math.max(0, Math.min(bps, cap)), capBps: cap, clamped: bps > cap };
}

/**
 * The full breakdown. Everything the confirmation sheet shows and the ledger
 * stores comes from this one object.
 *
 * @param {object} p
 * @param {number|string} p.collateralUsd
 * @param {number|string} p.leverage
 * @param {number|null}   p.protocolFeeBps   venue opening fee in bps of notional (null = unknown)
 * @param {number|null}   p.protocolFlatUsd  venue flat fee (e.g. oracle fee), 0 when none
 * @param {number|null}   p.networkFeeUsd    estimated gas in USD (null = unknown)
 * @param {string}        p.policyId
 * @param {number|null}   p.venueCapBps
 * @param {string|null}   p.recipient        FBT fee receiving address (for the ledger)
 */
export function computeFeeBreakdown({
  collateralUsd,
  leverage,
  protocolFeeBps = null,
  protocolFlatUsd = 0,
  networkFeeUsd = null,
  policyId = 'STANDARD',
  overrideBps = null,
  venueCapBps = null,
  recipient = null,
  chargedOn = 'open'
} = {}) {
  const notional = notionalUsd({ collateralUsd, leverage });
  if (notional == null) return null;

  const fbt = resolveFbtBps({ policyId, overrideBps, venueCapBps });
  const fbtFeeUsd = (notional * fbt.bps) / 10_000;

  const pBps = num(protocolFeeBps);
  const pFlat = Math.max(0, num(protocolFlatUsd) ?? 0);
  const protocolFeeUsd = pBps == null ? null : (notional * pBps) / 10_000 + pFlat;

  const nUsd = num(networkFeeUsd);
  const netFee = nUsd == null ? null : Math.max(0, nUsd);

  const known = protocolFeeUsd != null && netFee != null;
  const totalFeeUsd = known ? protocolFeeUsd + netFee + fbtFeeUsd : null;
  const collateral = num(collateralUsd);

  return {
    schema: 'fbt.futures-fee-breakdown.v1',
    notionalUsd: notional,
    collateralUsd: collateral,
    leverage: num(leverage),
    protocol: { bps: pBps, flatUsd: pFlat, feeUsd: protocolFeeUsd, known: pBps != null },
    network: { feeUsd: netFee, known: netFee != null },
    fbt: {
      policyId: fbt.policyId,
      bps: fbt.bps,
      capBps: fbt.capBps,
      clamped: fbt.clamped,
      feeUsd: fbtFeeUsd,
      pctOfCollateral: collateral > 0 ? (fbtFeeUsd / collateral) * 100 : null,
      recipient: recipient || null,
      chargedOn
    },
    totalFeeUsd,
    /* True when every component is known; the UI must not print a total otherwise. */
    complete: known,
    hiddenSpread: false,
    hiddenMarkup: false
  };
}

/**
 * Validate a breakdown before it is committed to the ledger or shown as final.
 * Refuses anything that exceeds the ceiling or is missing an audit field.
 */
export function validateFeeBreakdown(b) {
  const problems = [];
  if (!b || b.schema !== 'fbt.futures-fee-breakdown.v1') problems.push('BAD_SCHEMA');
  else {
    if (!(b.notionalUsd > 0)) problems.push('BAD_NOTIONAL');
    if (!(b.fbt.bps >= 0 && b.fbt.bps <= FBT_FEE_MAX_BPS)) problems.push('FBT_BPS_OUT_OF_RANGE');
    if (Math.abs(b.fbt.feeUsd - (b.notionalUsd * b.fbt.bps) / 10_000) > 1e-6) problems.push('FBT_FEE_MISMATCH');
    if (b.complete && Math.abs(b.totalFeeUsd - (b.protocol.feeUsd + b.network.feeUsd + b.fbt.feeUsd)) > 1e-6) problems.push('TOTAL_MISMATCH');
    if (b.hiddenSpread || b.hiddenMarkup) problems.push('HIDDEN_FEE');
  }
  return { ok: problems.length === 0, problems };
}
