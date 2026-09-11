/**
 * COMPOUND V3 (COMET) · BASE (8453) · USDC — the LENDING SURFACE (Phase 216).
 * Borrow, repay, health factor — the sibling of `compoundV3Base.js`.
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE FILE: `compoundV3Base.js` is the Farm money path, and a wiring
 * pin in test/wiring.mjs parses this family of ABIs to prove that the Farm
 * surface can only ever encode `supply` / `withdraw` writes. The lending
 * engine needs `borrow` / `repay`, and those two writes belong HERE, never in
 * the file the Farm panel's audit reads. Everything else (deployment
 * verification, contract handles, unit math, the position read) is imported
 * from the base module — a second Comet implementation would be a second bug
 * surface, so there is none.
 *
 * ─── WHAT THIS MODULE MAY ENCODE ────────────────────────────────────────────
 * Exactly two writes, both two-argument, both msg.sender-only:
 *   · `borrow(asset, amount)` — Comet sets the borrower to msg.sender; funds
 *     are PUSHED to the user, so no token approval is needed.
 *   · `repay(asset, amount)` — Comet's `repayInternal` does `transferIn`
 *     (a SAFE `transferFrom` FROM the caller), so a repay NEEDS a USDC
 *     approval to the Comet for exactly the repaid amount — the plan carries
 *     that approve step when the standing allowance is not sufficient, with
 *     the same exact-amount discipline the supply path uses. An over-repay is
 *     refused client-side before any step is built.
 * The `*To`/`*From` variants, collateral writes, absorb, liquidation and
 * governance entry points are not declared here and cannot be encoded.
 *
 * ─── REFUSAL CODES THIS MODULE EMITS ────────────────────────────────────────
 *   COMPOUND_NO_COLLATERAL          — a base borrow needs collateral in this
 *                                     market; none is held.
 *   COMPOUND_COLLATERAL_SET_UNREADABLE — the Configurator's collateral set
 *                                     read returned nothing usable.
 *   COMPOUND_COLLATERAL_UNREADABLE  — the collateral read failed.
 *   COMPOUND_NO_DEBT_TO_REPAY       — the account has zero debt; nothing to
 *                                     repay (refused, not a no-op success).
 *   COMPOUND_REPAY_EXCEEDS_DEBT     — repaying more than the live debt.
 *   COMPOUND_POSITION_UNREADABLE / COMPOUND_GAS_FLOOR_UNKNOWN /
 *   COMPOUND_NATIVE_BALANCE_UNKNOWN / COMPOUND_NATIVE_GAS_FLOOR /
 *   COMPOUND_INVALID_AMOUNT         — shared with the base module's checks.
 * Every code is a machine code; the UI mapping lives with the consumer.
 */

import { NATIVE_GAS_FLOOR } from '../swap';
import {
  COMPOUND_V3_BASE,
  CompoundAdapterError,
  verifyDeployment,
  fromUsdcWei,
  toUsdcWei,
  contracts
} from './compoundV3Base.js';

const loadEthers = () => import('ethers');

/**
 * The only signatures this module may encode. `collateralBalanceOf` /
 * `balanceOf` / `borrowBalanceOf` are the reads the plans need and are
 * served from the base module's contract handle; they are listed here so a
 * reviewer sees the full read surface of the lending path in one place.
 */
const COMET_LENDING_ABI = [
  'function borrow(address asset, uint256 amount)',
  'function repay(address asset, uint256 amount)',
  'function getHealthFactor() view returns (uint256)',
  'function collateralBalanceOf(address account, address asset) view returns (uint128)',
  'function balanceOf(address owner) view returns (uint256)',
  'function borrowBalanceOf(address account) view returns (uint256)'
];

/**
 * The market's COLLATERAL assets, read from the Configurator's own record —
 * `getConfiguration(assetConfigs)`. Nothing is hardcoded here: a market whose
 * governance reconfigured its collateral set is read as it is, and a failed
 * read refuses the plan (a borrow quote against an unverified collateral set
 * would be a confident wrong number).
 */
async function collateralAssets(c) {
  const cfg = await c.configurator.getConfiguration(COMPOUND_V3_BASE.comet);
  const configs = cfg?.assetConfigs ?? cfg?.[12] ?? [];
  return (Array.isArray(configs) ? configs : [])
    .map((row) => String(row?.asset ?? row?.[0] ?? ''))
    .filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a) && a.toLowerCase() !== '0x0000000000000000000000000000000000000000');
}

/**
 * Ordered unsigned steps for a base-asset borrow.
 *
 * THE BORROW-SPECIFIC CHECKS (Comet differs from a "supply then borrow" pool):
 *   1. A Comet account CAN borrow base only while it holds COLLATERAL in this
 *      market — `collateralBalanceOf` must be > 0 for at least one of the
 *      market's configured collateral assets (read from the Configurator,
 *      never hardcoded). No collateral → `COMPOUND_NO_COLLATERAL`, refused.
 *   2. An open supply gets NETTED against the new debt the moment it exists
 *      (Comet's shared balance), so the position read is part of the checks —
 *      a "borrow" that quietly eats the user's supply is not a borrow.
 *   3. Same native gas floor as the supply path.
 *
 * `borrow(asset, amount)` — the two-argument entry point where Comet sets the
 * borrower to msg.sender. There is no third-party variant to encode, and no
 * approval: the funds are pushed to the user.
 */
export async function buildBorrowPlan({ provider, owner, amountUsdc, history = null, nativeBalance = null }) {
  if (typeof owner !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(owner)) throw new CompoundAdapterError('COMPOUND_BAD_OWNER', { owner });
  const deployment = await verifyDeployment(provider);
  const c = await contracts(provider);
  const { Interface } = await loadEthers();

  const checks = {
    schema: 'fbt.compound-base.borrow-checks.v1',
    deploymentVerified: Boolean(deployment?.ok),
    amountUsdc: null,
    amountWei: null,
    hasCollateral: null,
    collateralAssets: [],
    existingSupplyUsdcWei: null,
    existingBorrowUsdcWei: null,
    nativeGasFloorOk: null,
    blocked: []
  };
  const block = (code) => { if (!checks.blocked.includes(code)) checks.blocked.push(code); };

  let amountWei;
  try {
    amountWei = toUsdcWei(amountUsdc);
  } catch {
    amountWei = 0n;
  }
  checks.amountWei = amountWei;
  if (amountWei <= 0n) {
    block('COMPOUND_INVALID_AMOUNT');
    return { steps: [], checks };
  }
  checks.amountUsdc = Number(amountWei) / 10 ** COMPOUND_V3_BASE.usdcDecimals;

  /* ── collateral gate: a base borrow without collateral cannot exist ───── */
  try {
    const assets = await collateralAssets(c);
    checks.collateralAssets = assets;
    let collateral = 0n;
    for (const asset of assets) {
      collateral += BigInt(String(await c.comet.collateralBalanceOf(owner, asset) ?? 0n));
    }
    checks.hasCollateral = assets.length > 0 && collateral > 0n;
    if (!checks.hasCollateral) block(assets.length ? 'COMPOUND_NO_COLLATERAL' : 'COMPOUND_COLLATERAL_SET_UNREADABLE');
  } catch {
    checks.hasCollateral = null;
    block('COMPOUND_COLLATERAL_UNREADABLE');
  }

  /* ── position context (a borrow nets against any open supply) ─────────── */
  try {
    checks.existingSupplyUsdcWei = BigInt(String(await c.comet.balanceOf(owner) ?? 0n));
  } catch {
    checks.existingSupplyUsdcWei = null;
  }
  try {
    checks.existingBorrowUsdcWei = BigInt(String(await c.comet.borrowBalanceOf(owner) ?? 0n));
  } catch {
    checks.existingBorrowUsdcWei = null;
    block('COMPOUND_POSITION_UNREADABLE');
  }

  /* ── native gas floor (reused from the swap engine) ───────────────────── */
  const floor = NATIVE_GAS_FLOOR[COMPOUND_V3_BASE.chainId];
  if (floor == null) {
    checks.nativeGasFloorOk = null;
    block('COMPOUND_GAS_FLOOR_UNKNOWN');
  } else if (nativeBalance == null) {
    checks.nativeGasFloorOk = null;
    block('COMPOUND_NATIVE_BALANCE_UNKNOWN');
  } else {
    const { parseUnits } = await loadEthers();
    const floorWei = parseUnits(String(floor), 18);
    const native = typeof nativeBalance === 'bigint' ? nativeBalance : BigInt(String(nativeBalance));
    checks.nativeGasFloorOk = native >= floorWei;
    if (!checks.nativeGasFloorOk) block('COMPOUND_NATIVE_GAS_FLOOR');
  }

  if (checks.blocked.length > 0) return { steps: [], checks };

  const comet = new Interface(COMET_LENDING_ABI);
  return {
    steps: [{
      kind: 'borrow',
      to: COMPOUND_V3_BASE.comet,
      data: comet.encodeFunctionData('borrow', [COMPOUND_V3_BASE.usdc, amountWei]),
      value: 0n,
      description: { key: 'farm.compound.step.borrow', amount: fromUsdcWei(amountWei) }
    }],
    checks
  };
}

/**
 * Steps for a repay. THE TWO CHECKS THAT MATTER:
 *   1. An account with no live debt has nothing to repay —
 *      `COMPOUND_NO_DEBT_TO_REPAY`, refused (a "success" with no effect
 *      would be a fake).
 *   2. Repaying MORE than the live debt is refused client-side
 *      (`COMPOUND_REPAY_EXCEEDS_DEBT`) — Comet reverts an over-repay too,
 *      but a plan that hands the user a guaranteed revert is a plan that
 *      should have caught it first.
 *
 * THE APPROVAL: Comet's `repay` pulls the USDC from the caller (`transferIn`
 * → safe `transferFrom`), so the plan carries `approve(comet, amount)` when
 * the standing allowance is not sufficient — for EXACTLY the repaid amount,
 * the same discipline as the supply path. A borrow needs no approval because
 * the funds are pushed.
 */
export async function buildRepayPlan({ provider, owner, amountUsdc }) {
  if (typeof owner !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(owner)) throw new CompoundAdapterError('COMPOUND_BAD_OWNER', { owner });
  await verifyDeployment(provider);
  const c = await contracts(provider);
  const { Interface } = await loadEthers();

  const checks = {
    schema: 'fbt.compound-base.repay-checks.v1',
    deploymentVerified: true,
    amountWei: null,
    amountUsdc: null,
    debtUsdcWei: null,
    withinDebt: null,
    allowanceWei: null,
    needsApproval: null,
    blocked: []
  };
  const block = (code) => { if (!checks.blocked.includes(code)) checks.blocked.push(code); };

  let debt = null;
  try {
    debt = BigInt(String(await c.comet.borrowBalanceOf(owner) ?? 0n));
    checks.debtUsdcWei = debt;
  } catch {
    debt = null;
    block('COMPOUND_POSITION_UNREADABLE');
  }
  if (debt !== null && debt === 0n) block('COMPOUND_NO_DEBT_TO_REPAY');

  let amountWei;
  try {
    amountWei = toUsdcWei(amountUsdc);
  } catch {
    amountWei = 0n;
  }
  checks.amountUsdc = Number(amountWei) / 10 ** COMPOUND_V3_BASE.usdcDecimals;
  if (amountWei <= 0n) block('COMPOUND_INVALID_AMOUNT');
  if (debt !== null) {
    checks.withinDebt = amountWei <= debt;
    if (!checks.withinDebt) block('COMPOUND_REPAY_EXCEEDS_DEBT');
  }
  checks.amountWei = amountWei;

  if (checks.blocked.length > 0) return { steps: [], checks };

  /* ── allowance: approve EXACTLY amountWei, or skip if already sufficient ── */
  let allowance;
  try {
    const raw = await c.usdc.allowance(owner, COMPOUND_V3_BASE.comet);
    allowance = typeof raw === 'bigint' ? raw : BigInt(String(raw));
  } catch {
    /* An unreadable allowance is a refusal, not a skip: without it a repay
       would be handed to the user as one step and revert with
       TransferInFailed() after they signed. */
    block('COMPOUND_BALANCE_UNREADABLE');
    return { steps: [], checks };
  }
  checks.allowanceWei = allowance;
  checks.needsApproval = allowance < amountWei;

  const steps = [];
  const erc20 = new Interface(['function approve(address spender, uint256 amount)']);
  const comet = new Interface(COMET_LENDING_ABI);

  if (checks.needsApproval) {
    steps.push({
      kind: 'approve',
      to: COMPOUND_V3_BASE.usdc,
      data: erc20.encodeFunctionData('approve', [COMPOUND_V3_BASE.comet, amountWei]),
      value: 0n,
      description: { key: 'farm.compound.step.approve', amount: fromUsdcWei(amountWei) }
    });
  }

  steps.push({
    kind: 'repay',
    to: COMPOUND_V3_BASE.comet,
    data: comet.encodeFunctionData('repay', [COMPOUND_V3_BASE.usdc, amountWei]),
    value: 0n,
    description: { key: 'farm.compound.step.repay', amount: fromUsdcWei(amountWei) }
  });

  return { steps, checks };
}

/**
 * The account's health factor, read as an eth_call with `from: owner` —
 * Comet's `getHealthFactor()` is computed for msg.sender, and a plain read
 * would silently return the RPC default account's number. A failed read is
 * null, never 1.0 (a fabricated "safe" is worse than no number).
 */
export async function getHealthFactor(provider, owner) {
  if (typeof owner !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(owner)) return null;
  try {
    const { Interface } = await loadEthers();
    const iface = new Interface(COMET_LENDING_ABI);
    const out = await provider.call({ to: COMPOUND_V3_BASE.comet, data: iface.encodeFunctionData('getHealthFactor'), from: owner });
    const [hf] = iface.decodeFunctionResult('getHealthFactor', out);
    return BigInt(String(hf ?? 0));
  } catch {
    return null;
  }
}
