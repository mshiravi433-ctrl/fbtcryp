/**
 * FUTURES → CENTRAL RISK — the server-side half of one risk answer.
 * ---------------------------------------------------------------------------
 * `futuresRisk(state, { leverage, marginUsd })` has always measured a PROPOSED
 * order against the portfolio: `exposurePct = (existing notional + new
 * margin × leverage) / portfolio value`. It reads `state.positions`, an array
 * of `{ symbol, amount, entry }`.
 *
 * What it never had was a way to be told what the user's FUTURES ACCOUNT
 * already holds when that account lives on a venue (dYdX, Ostium, Velocity)
 * rather than in this app's own state. This module is that adapter, and it is
 * deliberately thin: it converts what the venue returned into the exact shape
 * `futuresRisk` and `analyzeExposure` already read, and it does NOT compute a
 * second risk number.
 *
 * ─── WHY IT IS NOT IN THE CLIENT ONLY ───────────────────────────────────────
 * The Intent OS asks the server for a verdict before an order is prepared. If
 * the futures account were only known to the browser, the server would judge an
 * over-levered user as flat — the most dangerous possible default on a screen
 * that opens positions. So the account read is accepted HERE, normalised, and
 * added to the state the risk engine is given.
 *
 * ─── THE ONE RULE ───────────────────────────────────────────────────────────
 * An unreadable account produces `dataStatus: 'unavailable'` and NO positions.
 * It never produces an empty array, because "empty" is a claim that the user is
 * flat and that claim would render as an all-clear.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Product limits, mirrored from src/lib/central/risk.js RISK_LIMITS. */
export const FUTURES_LIMITS = Object.freeze({
  leverageRatioBlock: 3,
  leverageRatioWarn: 1.5,
  concentrationSharePct: 45,
  liquidationDistanceWarnPct: 15
});

/**
 * Normalise a venue account read into the futures state block the risk engine
 * and the exposure analyser consume.
 *
 * @param {object} account
 *   `{ positions: [{ symbol, side, notionalUsd, entryPrice, leverage }],
 *      equityUsd, maintenanceMarginUsd, availableBalanceUsd, fundingAprPct,
 *      provider }`
 * @returns {object} `{ dataStatus, provider, positions, equityUsd, ... }` —
 *   `positions` is only present when the read succeeded.
 */
export function normaliseFuturesAccount(account = {}) {
  const provider = String(account.provider || 'unknown').toLowerCase();
  const rows = Array.isArray(account.positions) ? account.positions : null;
  const equityUsd = num(account.equityUsd);
  if (!rows && equityUsd == null) {
    return { dataStatus: 'unavailable', reason: 'NO_ACCOUNT_READ', provider, positions: [] };
  }
  const positions = (rows || [])
    .map((p) => {
      const notionalUsd = num(p.notionalUsd ?? p.valueUsd ?? p.sizeUsd);
      if (!(notionalUsd > 0)) return null;
      return {
        symbol: String(p.symbol || p.market || '').toUpperCase() || null,
        side: String(p.side || '').toLowerCase() === 'short' ? 'short' : 'long',
        /* `amount` and `entry` are the names `futuresRisk` sums; notionalUsd is
           the name the analyser reads. Both are filled from one number so the
           two consumers cannot disagree about the size of the position. */
        amount: num(p.size) ?? (num(p.entryPrice) ? notionalUsd / num(p.entryPrice) : null),
        entry: num(p.entryPrice),
        notionalUsd,
        marginUsd: num(p.marginUsd ?? p.collateralUsd),
        leverage: num(p.leverage),
        liquidationDistancePct: num(p.liquidationDistancePct)
      };
    })
    .filter(Boolean);

  const maintenance = num(account.maintenanceMarginUsd);
  const marginRatioPct = equityUsd > 0 && maintenance != null
    ? (maintenance / equityUsd) * 100
    : null;
  const grossUsd = positions.reduce((n, p) => n + p.notionalUsd, 0);
  const leverageRatio = equityUsd > 0 ? grossUsd / equityUsd : null;

  return {
    dataStatus: 'live',
    provider,
    positions,
    equityUsd,
    maintenanceMarginUsd: maintenance,
    availableBalanceUsd: num(account.availableBalanceUsd),
    fundingAprPct: num(account.fundingAprPct),
    marginRatioPct,
    leverageRatio,
    grossUsd: Number(grossUsd.toFixed(2)),
    netUsd: Number(positions
      .reduce((n, p) => n + (p.side === 'short' ? -p.notionalUsd : p.notionalUsd), 0)
      .toFixed(2)),
    at: Date.now()
  };
}

/**
 * The pre-trade verdict for one proposed order, using the SAME arithmetic as
 * `futuresRisk` but including what the venue account already holds.
 *
 * Returns the numbers a UI can show and an `action` it can act on:
 *   allow · warn · block
 *
 * `block` needs a reason that a reviewer would accept: the leverage this order
 * would take the ACCOUNT to, against the product's 3× limit — not against the
 * venue's 20× allowance, which is the venue's business, not the product's.
 */
export function futuresPreTrade({
  account = null, portfolioUsd = null, marginUsd = 0, leverage = 1, notionalUsd = null
} = {}) {
  const acct = account && account.dataStatus !== 'unavailable' ? account : normaliseFuturesAccount(account || {});
  const existing = num(acct.grossUsd) ?? 0;
  /* A notional of ZERO is not a proposed order — it is the absence of one, and
     treating it as an order made `futuresPreTrade({})` answer "allow" for a
     user with nothing at all, which is the exact failure this function exists
     to prevent. Only a positive notional counts. */
  const proposed = num(notionalUsd);
  const derived = num(marginUsd) != null && num(leverage) != null ? num(marginUsd) * num(leverage) : null;
  const newNotional = proposed > 0 ? proposed : (derived > 0 ? derived : null);
  if (newNotional == null && existing <= 0) {
    return { dataStatus: 'unavailable', reason: 'NO_ORDER_AND_NO_ACCOUNT', action: 'block' };
  }
  const equity = num(acct.equityUsd) ?? num(portfolioUsd);
  const exposureUsd = existing + Math.abs(newNotional || 0);
  const leverageRatio = equity > 0 ? exposureUsd / equity : null;
  const exposurePct = num(portfolioUsd) > 0 ? (exposureUsd / num(portfolioUsd)) * 100 : null;

  const reasons = [];
  if (leverageRatio != null && leverageRatio > FUTURES_LIMITS.leverageRatioBlock) {
    reasons.push({ code: 'leverage-above-block-limit', action: 'block', value: Number(leverageRatio.toFixed(2)), limit: FUTURES_LIMITS.leverageRatioBlock });
  } else if (leverageRatio != null && leverageRatio > FUTURES_LIMITS.leverageRatioWarn) {
    reasons.push({ code: 'leverage-above-warn-limit', action: 'warn', value: Number(leverageRatio.toFixed(2)), limit: FUTURES_LIMITS.leverageRatioWarn });
  }
  const ratio = num(acct.marginRatioPct);
  if (ratio != null && ratio >= 70) reasons.push({ code: 'margin-ratio-high', action: ratio >= 90 ? 'block' : 'warn', value: Number(ratio.toFixed(1)) });
  const thin = acct.positions?.find((p) => p.liquidationDistancePct != null && p.liquidationDistancePct < FUTURES_LIMITS.liquidationDistanceWarnPct);
  if (thin) reasons.push({ code: 'liquidation-close', action: 'warn', value: thin.liquidationDistancePct, symbol: thin.symbol });

  const action = reasons.some((r) => r.action === 'block') ? 'block' : reasons.length ? 'warn' : 'allow';
  return {
    dataStatus: 'live',
    action,
    reasons,
    existingExposureUsd: Number(existing.toFixed(2)),
    newNotionalUsd: newNotional == null ? null : Number(Number(newNotional).toFixed(2)),
    exposureUsd: Number(exposureUsd.toFixed(2)),
    equityUsd: equity,
    leverageRatio: leverageRatio == null ? null : Number(leverageRatio.toFixed(3)),
    exposurePctOfPortfolio: exposurePct == null ? null : Number(exposurePct.toFixed(1)),
    limits: FUTURES_LIMITS,
    schema: 'fbt.futures-pretrade.v1'
  };
}

/**
 * Add the (normalised) futures account to a unified-state object so that
 * `assessRisk()` and `futuresRisk()` see it, WITHOUT mutating the caller's
 * state and without inventing a section that was not read.
 *
 * The section is written in the shape `src/lib/central/state.js` uses —
 * `{ data, source, updatedAt }` — because `assessRisk` resolves sections
 * through `getSection`. A caller that already has a `futures` section keeps its
 * provenance; this only fills `data.positions` when the account read produced
 * rows.
 */
export function withFuturesAccount(state = {}, account = null) {
  if (!account) return state;
  const acct = account.dataStatus ? account : normaliseFuturesAccount(account);
  if (acct.dataStatus === 'unavailable') return state;
  const existing = state.futures?.data || {};
  return {
    ...state,
    futures: {
      ...(state.futures || {}),
      data: {
        ...existing,
        positions: acct.positions,
        equityUsd: acct.equityUsd,
        maintenanceMarginUsd: acct.maintenanceMarginUsd,
        leverageRatio: acct.leverageRatio,
        marginRatioPct: acct.marginRatioPct,
        provider: acct.provider
      },
      source: state.futures?.source || `venue:${acct.provider}`,
      updatedAt: acct.at || Date.now()
    }
  };
}
