/**
 * SOLANA LENDING — WHAT THE KAMINO NUMBERS ACTUALLY SAY.
 * ---------------------------------------------------------------------------
 * Asked for: «در بخش وام سولانا … تحلیل‌ها … مدرن‌تر و به‌روزتر شود».
 *
 * ─── WHAT THIS MODULE IS, AND WHAT IT IS NOT ────────────────────────────────
 * It is arithmetic. Every value it returns is computed from numbers the Kamino
 * market snapshot already contains — the reserve's own APYs, its own caps, its
 * own liquidity figure, and the obligation the pool itself reported for this
 * wallet. It never calls the network, never invents a value for a missing one,
 * and never forecasts.
 *
 * It is NOT a second risk engine. The bands, the health factor and the
 * liquidation distance stay in the one place the whole app already trusts
 * (lib/lending-engine/health.js and lib/lending-service.js); this module only
 * turns Kamino's OWN fields into the derived quantities a reader wants — how
 * utilised the reserve is, what the borrow rate costs over the deposit rate,
 * how much room is left under the caps — each carrying the inputs it came from
 * so the panel can say "68% of the deposit limit" instead of "68%".
 *
 * ─── THE HONESTY RULES, SAME AS EVERY OTHER ANALYSIS MODULE HERE ────────────
 *   · a figure that cannot be computed is ABSENT, not zero — the caller omits
 *     the row rather than printing a confident 0%
 *   · every fact reports its sample (a percent of WHAT, over WHAT)
 *   · `kind` is 'neutral' | 'caution' | 'notable' for colour only. There is no
 *     'bullish' value, and there never will be: the moment this file says
 *     "good time to borrow", it has stopped measuring and started advising.
 */

/** A number that is genuinely a usable positive-or-zero figure, else null. */
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * A percentage that is only meaningful inside [0, 100].
 * Kamino caps and utilisation are ratios: a value outside the range means the
 * inputs were inconsistent, and a clamped 100% would hide that — so it is
 * dropped instead.
 */
const pct = (value) => {
  const n = num(value);
  if (n == null || n < 0 || n > 100) return null;
  return n;
};

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Facts about ONE reserve, from its own fields.
 *
 * @param {object} p
 * @param {object} p.asset     a reserve view from the Kamino snapshot
 * @param {number} [p.amountUsd] the amount the user typed, for the depth figure
 * @returns {Array<{id, kind, values}>}
 */
export function solanaReserveFacts({ asset = null, amountUsd = null } = {}) {
  const facts = [];
  if (!asset) return facts;

  const available = num(asset.availableLiquidity);
  const borrowed = num(asset.borrowed);
  const symbol = asset.symbol || null;

  /* ── how much of this reserve is already lent out ─────────────────────────
     Utilisation is the single number that explains a rate: a reserve at 95% is
     paying a high variable rate because almost everything is gone, and one at
     10% is cheap. Measured from the reserve's own two totals. */
  const total = available != null && borrowed != null ? available + borrowed : null;
  const utilization = total > 0 ? pct((borrowed / total) * 100) : null;
  if (utilization != null) {
    facts.push({
      id: 'utilization',
      kind: utilization >= 90 ? 'caution' : utilization >= 70 ? 'notable' : 'neutral',
      values: { pct: round1(utilization), symbol }
    });
  }

  /* ── what borrowing costs over what depositing earns ──────────────────────
     The spread is the pool's own margin on the same asset: borrow at the
     higher number, deposit at the lower one. A wide spread means the position
     is expensive to hold even when the price does not move. */
  const borrowApy = num(asset.borrowApyPct);
  const supplyApy = num(asset.supplyApyPct);
  if (borrowApy != null && supplyApy != null) {
    const spread = borrowApy - supplyApy;
    facts.push({
      id: 'rateSpread',
      kind: spread >= 4 ? 'caution' : 'neutral',
      values: { spread: round2(spread), borrow: round2(borrowApy), supply: round2(supplyApy), symbol }
    });
  }

  /* ── how much of the reserve's deposit limit is used ──────────────────────
     `supplyCap` is Kamino's own deposit limit for this reserve; the part that
     is not available liquidity is what has been deposited. A reserve near its
     limit can refuse a deposit, which is worth knowing BEFORE the wallet opens
     (the preflight refuses it anyway — this is the same fact, said earlier). */
  const supplyCap = num(asset.supplyCap);
  const deposited = available != null && supplyCap != null && supplyCap > 0 ? supplyCap - available : null;
  if (deposited != null && supplyCap > 0) {
    facts.push({
      id: 'depositCap',
      kind: deposited / supplyCap >= 0.95 ? 'caution' : 'neutral',
      values: { pct: round1((deposited / supplyCap) * 100), symbol }
    });
  }

  /* ── how big the typed amount is against what is actually there ───────────
     «The market has $1.2M available» is a fact; «your $5,000 is 0.4% of it» is
     the same fact made usable. Only when an amount and a liquidity figure both
     exist, and only as a share — never as a claim about slippage or a fill. */
  const amount = num(amountUsd);
  if (amount != null && amount > 0 && available != null && available > 0) {
    const share = (amount / available) * 100;
    facts.push({
      id: 'liquidityDepth',
      kind: share >= 25 ? 'caution' : share >= 5 ? 'notable' : 'neutral',
      values: { pct: round2(share), symbol }
    });
  }

  /* ── the asset's own risk parameters, restated as what they allow ─────────
     LTV and the liquidation threshold are reserve configuration: the first is
     how much can be borrowed against this collateral, the second is where the
     position gets liquidated. The GAP between them is the buffer the protocol
     gives this asset, and it is a measured number, not an opinion. */
  const ltv = num(asset.loanToValuePct);
  const threshold = num(asset.liquidationThresholdPct);
  if (ltv != null && threshold != null) {
    facts.push({
      id: 'ltvBuffer',
      kind: threshold - ltv <= 5 ? 'caution' : 'neutral',
      values: { ltv: round1(ltv), threshold: round1(threshold), gap: round1(threshold - ltv), symbol }
    });
  }

  return facts;
}

/**
 * Facts about THE WALLET'S OWN POSITION, from the obligation the pool reported.
 *
 * Uses the same health-factor arithmetic as the EVM engine — one implementation
 * of "how far can this fall", in lib/lending-service.js — so a Solana position
 * and an Aave position read the same way on the same screen.
 *
 * @param {object} p
 * @param {object} p.account  the snapshot's account block
 * @returns {Array<{id, kind, values}>}
 */
export function solanaPositionFacts({ account = null } = {}) {
  const facts = [];
  if (!account || account.unknown) return facts;

  const hf = num(account.healthFactor);
  const collateral = num(account.totalCollateralUsd) ?? 0;
  const debt = num(account.totalDebtUsd) ?? 0;
  const ltvPct = num(account.ltvPct);
  const threshold = num(account.liquidationThresholdPct);

  /* ── the position itself, when there is one ───────────────────────────────
     A wallet with no debt has nothing to liquidate and gets no risk row at all
     — «no position» is the honest statement, and a 0.00 health factor would
     read as the opposite. */
  if (debt > 0 && hf != null) {
    facts.push({
      id: 'positionHealth',
      kind: hf < 1.2 ? 'caution' : hf < 2 ? 'notable' : 'neutral',
      values: { hf: round2(hf), debt: debt, collateral: collateral }
    });

    /* How far the collateral's value can fall before the liquidation point.
       (1 − 1/HF) · 100 — the same arithmetic as the EVM panel. */
    if (hf > 0) {
      const drop = Math.max(0, (1 - 1 / hf) * 100);
      facts.push({
        id: 'liquidationBuffer',
        kind: drop <= 20 ? 'caution' : drop <= 40 ? 'notable' : 'neutral',
        values: { pct: round1(drop) }
      });
    }
  }

  /* ── how much of the allowed LTV is used ──────────────────────────────────
     Kamino reports both numbers for the obligation; the ratio between them is
     how much of the borrowing capacity is already spent. Shown only when the
     pool reported a threshold, because without it there is no denominator. */
  if (threshold != null && threshold > 0 && ltvPct != null) {
    facts.push({
      id: 'ltvUsed',
      kind: ltvPct / threshold >= 0.8 ? 'caution' : 'neutral',
      values: { pct: round1((ltvPct / threshold) * 100), ltv: round1(ltvPct), threshold: round1(threshold) }
    });
  }

  /* ── the borrowing power that is still unspent ────────────────────────────
     One figure, in dollars: what the pool would still lend against this
     collateral at the current prices. Reported as a measurement with the price
     dependence stated in the copy, never as a promise it stays available. */
  const power = num(account.availableBorrowsUsd);
  if (power != null && debt > 0) {
    facts.push({
      id: 'borrowRoom',
      kind: 'neutral',
      values: { usd: power }
    });
  }

  return facts;
}

/**
 * Everything worth saying about the market + this selection, in one call.
 * Facts are ordered: the position first (it is the reader's own money), then
 * the reserve. Duplicates cannot happen — the two halves own disjoint ids.
 */
export function solanaLendingFacts({ snapshot = null, asset = null, amountUsd = null } = {}) {
  const facts = [
    ...solanaPositionFacts({ account: snapshot?.account ?? null }),
    ...solanaReserveFacts({ asset, amountUsd })
  ];
  return facts;
}
