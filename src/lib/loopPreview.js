// Kept local so this pure preview helper stays usable in Node-only tests and
// does not pull the wallet-oriented lending service into the calculator path.
export const LOOP_PREVIEW_STALE_AFTER_MS = 90_000;

/**
 * Normalize a market account into a truthful read-only preview state. An
 * unavailable read deliberately drops every numeric field, even if a React
 * caller still has an older account object in memory.
 */
export function buildPositionPreview({
  account = null,
  dataStatus = 'unavailable',
  readAt = null,
  ageMs = null,
  source = null,
  now = Date.now(),
  staleAfterMs = LOOP_PREVIEW_STALE_AFTER_MS
} = {}) {
  if (dataStatus === 'unavailable' || dataStatus === 'UNAVAILABLE' || !account?.ok) {
    return { status: 'unavailable', readAt: null, ageMs: null, account: null, source: null };
  }

  const timestamp = readAt == null || readAt === '' ? NaN : Number(readAt);
  const age = Number.isFinite(Number(ageMs)) && ageMs != null
    ? Math.max(0, Number(ageMs))
    : (Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null);
  const isCached = dataStatus === 'cached' || dataStatus === 'CACHED';
  const stale = isCached && age != null && age > Number(staleAfterMs);

  return {
    status: stale ? 'stale' : isCached ? 'cached' : dataStatus === 'partial' || dataStatus === 'PARTIAL' ? 'partial' : 'live',
    readAt: Number.isFinite(timestamp) ? timestamp : null,
    ageMs: age,
    account: {
      totalCollateralUsd: numberOrNull(account.totalCollateralUsd),
      totalDebtUsd: numberOrNull(account.totalDebtUsd),
      healthFactor: numberOrNull(account.healthFactor),
      availableBorrowsUsd: numberOrNull(account.availableBorrowsUsd),
      liquidationThresholdPct: numberOrNull(account.liquidationThresholdPct),
      ltvPct: numberOrNull(account.ltvPct)
    },
    source: source ?? account.source ?? null
  };
}

/** Position comparison for Stage B; both conditions are labels, never blocks. */
export function compareLoopPosition({ account, intendedCollateralUsd, ltvPct } = {}) {
  if (!account?.ok) return { differs: false, alreadyOverLtv: false, differenceUsd: null };
  const actualCollateral = numberOrNull(account.totalCollateralUsd);
  const actualDebt = numberOrNull(account.totalDebtUsd);
  if (actualCollateral == null || actualDebt == null) {
    return { differs: false, alreadyOverLtv: false, differenceUsd: null };
  }
  const intended = Number(intendedCollateralUsd);
  const differenceUsd = Number.isFinite(intended) ? actualCollateral - intended : null;
  const differs = actualDebt > 0.000001
    || (differenceUsd != null && Math.abs(differenceUsd) > Math.max(1, Math.abs(intended) * 0.01));
  const ltv = Number(ltvPct ?? account.ltvPct);
  const alreadyOverLtv = Number.isFinite(ltv) && ltv > 0 && actualDebt > actualCollateral * ltv / 100;
  return { differs, alreadyOverLtv, differenceUsd };
}

function numberOrNull(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  return Number(value);
}
