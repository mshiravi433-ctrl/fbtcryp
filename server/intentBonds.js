/**
 * Declared solver bonds for the FBT open solver network (Phase 3a).
 * ---------------------------------------------------------------------------
 * Phase 2 gave the protocol signed quotes, immutable logs, signed closes and
 * censorship evidence. It deliberately stopped before economics: a solver
 * whose winning quote was never executed faced nothing. Phase 3a adds the
 * bond layer — with an honesty boundary that must never be blurred:
 *
 *   - Bonds are DECLARED. `INTENT_SOLVER_BONDS` is a public-statement registry
 *     (solverId, amount, asset, expiry). It contains no keys and no secrets;
 *     anyone can read the same data from the public bond board.
 *
 *   - FBT holds nothing. The protocol never receives, escrows or moves bond
 *     funds. `custody: false` is structural, not a promise.
 *
 *   - Enforcement is OUT OF PROTOCOL. The coordinator signs deterministic
 *     adjudications (server/intentAdjudication.js) that state exactly which
 *     penalty the declared bond owes. Collecting it — an on-chain escrow,
 *     a legal agreement, a reputation registry — is the settlement layer's
 *     job, and capabilities say so instead of pretending a signature moved
 *     money.
 *
 * The penalty table is the one piece of economics the protocol owns, and it
 * is fully deterministic: same close + claim + disputes → same basis points
 * on every machine. Self-reporting a failure halves the penalty, which keeps
 * the honest-admission incentive without needing an oracle.
 */

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const SYMBOL_RE = /^[A-Za-z0-9.$₮_-]{1,16}$/;

export const BOND_SCHEMA = 'fbt.solver-bond.v1';
/* The minimum declared bond that counts as "bonded". Below it the row is
   listed on the public board but marked not-bonded — a network definition,
   not a secret threshold. */
export const MIN_BOND_USD = 1000;

const positiveIntegerString = (value, maxLength = 78) =>
  typeof value === 'string'
  && new RegExp(`^[0-9]{1,${maxLength}}$`).test(value)
  && BigInt(value) > 0n;

const safeTerms = (value) => {
  const cleaned = String(value ?? '').replace(/[<>"'`\\]/g, '').trim();
  return cleaned ? cleaned.slice(0, 200) : null;
};

/**
 * Parse the declared-bond registry from an environment value.
 *
 * Format (public statements only — no secrets belong here):
 *   [{"solverId":"mm-a","bondUsd":"100000","asset":"USDC","expiresAt":0,"terms":"..."}]
 *
 * Invalid rows are dropped rather than taking down every public route, and
 * the status reports how many survived so a typo is visible.
 */
export function parseBondRegistry(raw = process.env.INTENT_SOLVER_BONDS || '') {
  if (!raw) return new Map();
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return new Map();
    const registry = new Map();
    for (const row of rows.slice(0, 100)) {
      const solverId = String(row?.solverId || '');
      if (!ID_RE.test(solverId) || registry.has(solverId)) continue;
      if (!positiveIntegerString(row?.bondUsd)) continue;
      const asset = String(row?.asset || 'USDC');
      if (!SYMBOL_RE.test(asset)) continue;
      const expiresAt = row?.expiresAt == null ? null : Number(row.expiresAt);
      if (expiresAt != null && (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)) continue;
      registry.set(solverId, {
        solverId,
        bondUsd: String(row.bondUsd),
        asset,
        expiresAt,
        terms: safeTerms(row.terms)
      });
    }
    return registry;
  } catch {
    return new Map();
  }
}

/**
 * Live status of one declared bond. `bonded` is the protocol's single
 * definition of membership in the bonded network: declared above the
 * minimum, registered as an active solver, and not expired.
 */
export function bondStatusFor(bond, { solverRegistry = new Map(), now = Date.now() } = {}) {
  if (!bond) return { bonded: false, registered: false, expired: false, meetsMinimum: false };
  const registered = solverRegistry.has(bond.solverId);
  const expired = Number.isSafeInteger(bond.expiresAt) && Number(bond.expiresAt) * 1000 <= now;
  const meetsMinimum = BigInt(bond.bondUsd) >= BigInt(MIN_BOND_USD);
  return {
    bonded: Boolean(registered && !expired && meetsMinimum),
    registered,
    expired,
    meetsMinimum
  };
}

/** Public bond board: every declared row with its honest live status. */
export function publicBondBoard(
  registry = parseBondRegistry(),
  { solverRegistry = new Map(), now = Date.now() } = {}
) {
  return [...registry.values()]
    .sort((a, b) => a.solverId.localeCompare(b.solverId))
    .map((bond) => ({ ...bond, ...bondStatusFor(bond, { solverRegistry, now }) }));
}

/**
 * The deterministic penalty table (basis points of the declared bond).
 * Self-reported failures halve the penalty; failures that had to be derived
 * from a misleading claim, or that the solver never claimed at all, cost the
 * full bond. `contested` is the honest parking grade while a dispute
 * contradicts the claim: it is never zero and never full until resolved.
 */
export const PENALTY_BPS = Object.freeze({
  fulfilled: 0,
  'short-filled': 2500, // self-reported; caught short-fill doubles to 5000
  failed: 5000, // self-reported; mislabelled/late failure is 10000
  unexecuted: 10000,
  contested: 5000
});

export function penaltyBpsFor(verdict, selfReported) {
  if (verdict === 'pending') return null;
  if (verdict === 'fulfilled') return 0;
  if (verdict === 'unexecuted') return 10000;
  if (verdict === 'contested') return 5000;
  if (verdict === 'short-filled') return selfReported ? 2500 : 5000;
  if (verdict === 'failed') return selfReported ? 5000 : 10000;
  return null;
}

/** Integer penalty in bond units: floor(bond × bps / 10000). Null when no
    penalty applies (fulfilled / pending / unbonded — callers pass null). */
export function penaltyUsdFor(bondUsd, bps) {
  if (bps == null || !positiveIntegerString(bondUsd)) return null;
  return ((BigInt(bondUsd) * BigInt(bps)) / 10000n).toString();
}

/** Capabilities block. Everything here is a boolean of real configuration. */
export function bondsProtocolStatus({ solverRegistry = new Map() } = {}) {
  const registry = parseBondRegistry();
  const board = publicBondBoard(registry, { solverRegistry });
  return {
    configured: registry.size > 0,
    schema: BOND_SCHEMA,
    minBondUsd: MIN_BOND_USD,
    registeredBonds: registry.size,
    bondedSolvers: board.filter((row) => row.bonded).length,
    penaltyTableBps: PENALTY_BPS,
    selfReportedFailureHalvesPenalty: true,
    enforcement: 'out-of-protocol-declared',
    custody: false,
    onChainEscrow: false
  };
}
