/**
 * LENDING — the real Aave V3 client behind the /loan screen.
 * ---------------------------------------------------------------------------
 * Reported as: «صفحه وام باید در همان صفحه انجام شود … نمی‌خواد به Intent OS
 * بره برای سپرده … کلا فعال باشد ۱۰۰ درصد».
 *
 * The loan screen used to end every action with `navigate('/intent?hint=…')`:
 * the user reviewed a supply, confirmed it, and was dropped on a different
 * page holding a draft. Nothing was ever deposited from that screen.
 *
 * This module is the missing half. It talks to the Aave V3 Pool the same way
 * the /swap screen talks to the aggregator routers:
 *
 *   read  — reserve state (live supply/borrow APY, the aToken and debt-token
 *           addresses, whether the asset is a real reserve at all) and the
 *           user's account (collateral, debt, borrowing power, health factor)
 *   write — ERC-20 approve → Pool.supply / Pool.borrow / Pool.repay /
 *           Pool.withdraw, each signed by the user's own wallet
 *
 * BOUNDARIES THIS FILE KEEPS
 *   · FBT never custodies, never signs and never sponsors. Every write here
 *     is a transaction the connected wallet signs and broadcasts itself.
 *   · Nothing is invented. If an asset is not a reserve on the connected
 *     chain, `readReserve` says so and the UI disables it — no placeholder
 *     APY, no "coming soon" that behaves like a live market.
 *   · Rates are computed from the pool's own per-second rates, not from a
 *     hardcoded table and not from a marketing sheet.
 *
 * The Pool addresses below are the canonical Aave V3 Pool proxies. They are
 * additionally proved at runtime: a chain whose pool does not answer
 * `getReserveData` for the asset is reported unavailable instead of being
 * used, so a wrong or dead address can never silently receive funds.
 */

import { TOKENS, EVM_CHAINS } from './chains';

/** Canonical Aave V3 Pool proxy per chain id. */
export const AAVE_V3_POOLS = Object.freeze({
  1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',      // Ethereum
  10: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',     // Optimism
  56: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',     // BNB Chain
  137: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',    // Polygon
  8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',   // Base
  42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',  // Arbitrum
  43114: '0x794a61358D6845594F94dc1DB02A252b5b4814aD'   // Avalanche
});

/** Aave V3 uses a USD base currency with 8 decimals for account data. */
export const BASE_CURRENCY_DECIMALS = 8;
/** Aave's ray fixed-point (1e27) for the per-second interest rates. */
export const RAY = 10n ** 27n;
/** Aave's own seconds-per-year constant (365 days). */
export const SECONDS_PER_YEAR = 31536000;
/** Variable rate mode; the stable mode is deprecated across Aave V3 markets. */
export const VARIABLE_RATE_MODE = 2;
/** No referral programme is claimed, so the code is the neutral 0. */
export const AAVE_REFERRAL_CODE = 0;

/**
 * Native coins cannot enter the Pool directly (they need the WETH gateway),
 * so they are never offered as lending assets. Listing them would mean an
 * action that always fails at the wallet — the exact dead end this file
 * exists to remove.
 */
const NATIVE_SYMBOLS = new Set(['ETH', 'BNB', 'POL', 'MATIC', 'AVAX', 'S']);

/**
 * Symbols that are Aave V3 reserves per chain. The list is a FILTER, never a
 * promise: `readReserve` still proves the reserve on-chain before the UI
 * enables it. Anything not listed here is not offered at all.
 */
const RESERVE_SYMBOLS = Object.freeze({
  1: ['USDT', 'USDC', 'DAI', 'WBTC', 'LINK'],
  10: ['USDT', 'USDC'],
  56: ['USDT', 'USDC', 'BTCB', 'ETH'],
  137: ['USDT', 'USDC', 'DAI', 'WETH'],
  8453: ['USDC', 'cbBTC'],
  42161: ['USDT', 'USDC', 'WBTC', 'ARB'],
  43114: ['USDT', 'USDC', 'WETH']
});

/** Loan-to-value shown before any wallet is connected, per asset class. */
const STATIC_LTV = { USDT: 75, USDC: 77, DAI: 77, WBTC: 73, cbBTC: 73, BTCB: 70, ETH: 80, WETH: 80, LINK: 53, ARB: 58 };

/** Risk tone for the asset card, from the asset class — not from a rate. */
const RISK_CLASS = { USDT: 'low', USDC: 'low', DAI: 'low', WBTC: 'medium', cbBTC: 'medium', BTCB: 'medium', ETH: 'medium', WETH: 'medium', LINK: 'high', ARB: 'high' };

const COLOR = {
  USDT: '#26a17b', USDC: '#2775ca', DAI: '#f5ac37', WBTC: '#f09242',
  cbBTC: '#f09242', BTCB: '#f09242', ETH: '#627eea', WETH: '#627eea',
  LINK: '#2a5ada', ARB: '#12aaff'
};

/** Minimal ABI surface — every function this app is allowed to call. */
export const AAVE_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getReserveData(address asset) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))'
];

export const ERC20_MIN_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)'
];

const loadEthers = () => import('ethers');

const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const ZERO = '0x0000000000000000000000000000000000000000';

/* ═══════════════════════════════════════════════════════════════════════════
   PURE HELPERS — deterministic, unit-testable, no network
   ═══════════════════════════════════════════════════════════════════════════ */

/** The lending venue for a chain, or null when the chain has no Aave market. */
export function lendingVenue(chainId) {
  const pool = AAVE_V3_POOLS[Number(chainId)];
  if (!isAddress(pool)) return null;
  return {
    protocol: 'aave-v3',
    chainId: Number(chainId),
    pool,
    chainName: EVM_CHAINS[Number(chainId)]?.name || `#${chainId}`
  };
}

/** Is lending wired for this chain at all? */
export const lendingSupported = (chainId) => lendingVenue(chainId) !== null;

/** Every chain the loan screen can execute on, in the app's own order. */
export const lendingChains = () => Object.keys(AAVE_V3_POOLS).map(Number);

/**
 * The assets the loan screen may offer on a chain: listed as an Aave reserve
 * AND present in the app's own token registry (so the address, decimals and
 * icon come from one audited place) AND not a native coin.
 */
export function lendingAssetsFor(chainId) {
  const cid = Number(chainId);
  if (!lendingSupported(cid)) return [];
  const wanted = RESERVE_SYMBOLS[cid] || [];
  const registry = TOKENS[cid] || [];
  return wanted
    .map((symbol) => registry.find((token) => token.symbol === symbol))
    .filter((token) => token && isAddress(token.address) && !NATIVE_SYMBOLS.has(token.symbol))
    .map((token) => ({
      id: `${token.symbol.toLowerCase()}-${cid}`,
      symbol: token.symbol,
      name: token.name || token.symbol,
      address: token.address,
      decimals: Number(token.decimals ?? 18),
      chain: cid,
      ltv: STATIC_LTV[token.symbol] ?? 70,
      risk: RISK_CLASS[token.symbol] || 'medium',
      color: COLOR[token.symbol] || '#7c8cff',
      grad: `linear-gradient(135deg, ${COLOR[token.symbol] || '#7c8cff'}, ${(COLOR[token.symbol] || '#7c8cff')}88)`
    }));
}

/**
 * Aave stores rates as a per-year APR in ray, compounded per second. The
 * number a user is shown must be the APY they actually earn/pay.
 */
export function rayRateToApyPct(rateRay) {
  let ray;
  try { ray = BigInt(rateRay ?? 0); } catch { return null; }
  if (ray < 0n) return null;
  const apr = Number(ray) / Number(RAY);
  if (!Number.isFinite(apr)) return null;
  const apy = (1 + apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1;
  if (!Number.isFinite(apy)) return null;
  return Math.round(apy * 1000000) / 10000;
}

/** Aave base-currency integer (8 decimals) → a plain USD number. */
export function baseToUsd(value) {
  try {
    const raw = BigInt(value ?? 0);
    return Number(raw) / 10 ** BASE_CURRENCY_DECIMALS;
  } catch { return null; }
}

/**
 * The health factor is 1e18-scaled and is uint256-max when there is no debt.
 * A user with no debt has no health factor — that is reported as null, never
 * as "infinite safety".
 */
export function readHealthFactor(raw) {
  let value;
  try { value = BigInt(raw ?? 0); } catch { return null; }
  if (value === 0n) return null;
  if (value > 10n ** 30n) return null; // uint256 max => no debt
  return Number(value) / 1e18;
}

/** Health-factor band used for colour and copy. Never a recommendation. */
export function healthBand(healthFactor) {
  if (healthFactor == null) return 'none';
  if (healthFactor < 1.05) return 'critical';
  if (healthFactor < 1.35) return 'risky';
  if (healthFactor < 2) return 'watch';
  return 'safe';
}

/**
 * The exact steps a supply or borrow takes, in order, so the confirm sheet can
 * show the user everything BEFORE the first wallet prompt: an approval only
 * appears when the current allowance is genuinely short.
 */
export function buildLendingPlan({ action, asset, amount, collateral = null, allowanceWei = null, decimals = null }) {
  const steps = [];
  const dec = Number(decimals ?? asset?.decimals ?? 18);
  const need = toUnits(action === 'borrow' ? collateral : amount, dec);
  const have = allowanceWei == null ? null : safeBig(allowanceWei);

  if (action === 'supply') {
    if (need == null || need <= 0n) return { ok: false, error: 'AMOUNT_REQUIRED', steps: [] };
    if (have == null || have < need) steps.push({ id: 'approve', symbol: asset?.symbol, amountWei: need.toString() });
    steps.push({ id: 'supply', symbol: asset?.symbol, amountWei: need.toString() });
    return { ok: true, action, steps };
  }

  if (action === 'borrow') {
    const borrowUnits = toUnits(amount, dec);
    if (borrowUnits == null || borrowUnits <= 0n) return { ok: false, error: 'AMOUNT_REQUIRED', steps: [] };
    /* Collateral is optional: a user who already has collateral in the pool
       borrows in a single step. When they do add collateral, the deposit is
       its own reviewed step and it is signed before the borrow. */
    if (need != null && need > 0n) {
      if (have == null || have < need) steps.push({ id: 'approve', symbol: asset?.symbol, amountWei: need.toString() });
      steps.push({ id: 'supply', symbol: asset?.symbol, amountWei: need.toString(), asCollateral: true });
    }
    steps.push({ id: 'borrow', symbol: asset?.symbol, amountWei: borrowUnits.toString() });
    return { ok: true, action, steps };
  }

  if (action === 'withdraw' || action === 'repay') {
    const units = toUnits(amount, dec);
    if (units == null || units <= 0n) return { ok: false, error: 'AMOUNT_REQUIRED', steps: [] };
    if (action === 'repay' && (have == null || have < units)) {
      steps.push({ id: 'approve', symbol: asset?.symbol, amountWei: units.toString() });
    }
    steps.push({ id: action, symbol: asset?.symbol, amountWei: units.toString() });
    return { ok: true, action, steps };
  }

  return { ok: false, error: 'UNKNOWN_ACTION', steps: [] };
}

/** Decimal string → integer units, without floating point drift. */
export function toUnits(amount, decimals) {
  if (amount == null || amount === '') return null;
  const text = String(amount).trim().replace(',', '.');
  if (!/^\d*(\.\d*)?$/.test(text) || text === '' || text === '.') return null;
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return null;
  const [whole, fraction = ''] = text.split('.');
  const padded = (fraction + '0'.repeat(dec)).slice(0, dec);
  try { return BigInt((whole || '0') + padded); } catch { return null; }
}

/** Integer units → a display string, trimmed, never rounded up. */
export function fromUnits(value, decimals, maxFractionDigits = 6) {
  const raw = safeBig(value);
  if (raw == null) return null;
  const dec = Number(decimals) || 0;
  const base = 10n ** BigInt(dec);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(dec, '0').slice(0, maxFractionDigits).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

const safeBig = (value) => {
  try { return BigInt(value); } catch { return null; }
};

/**
 * What a borrow would do to the account, computed from the SAME numbers the
 * pool reports. Returns null when there is nothing to project from, because a
 * guessed health factor is worse than none.
 */
export function projectHealthFactor({ totalCollateralUsd, totalDebtUsd, liquidationThresholdPct, addDebtUsd = 0, addCollateralUsd = 0 }) {
  const collateral = Number(totalCollateralUsd) + Number(addCollateralUsd || 0);
  const debt = Number(totalDebtUsd) + Number(addDebtUsd || 0);
  const threshold = Number(liquidationThresholdPct);
  if (!Number.isFinite(collateral) || !Number.isFinite(debt) || !Number.isFinite(threshold)) return null;
  if (debt <= 0) return null;
  if (collateral <= 0) return 0;
  return (collateral * (threshold / 100)) / debt;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHAIN READS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Reserve state for one asset. `listed:false` is an honest answer — it means
 * the pool does not carry this asset on this chain, and the UI must not offer
 * it rather than showing a dash next to an enabled button.
 */
export async function readReserve({ provider, chainId, asset }) {
  const venue = lendingVenue(chainId);
  /*
   * Three different answers, and conflating them is a lie the user pays for:
   *   · no market on this chain / no such token → `listed: false`, a FACT
   *   · the pool answered with a zero aToken    → `listed: false`, a FACT
   *   · we could not reach the RPC at all       → `listed: null`, UNKNOWN
   * An unknown must never disable the asset — that would tell someone their
   * USDT is not lendable on Arbitrum because their phone lost signal.
   */
  if (!venue) return { ok: true, listed: false, reason: 'UNSUPPORTED_CHAIN' };
  if (!asset?.address) return { ok: true, listed: false, reason: 'NOT_A_RESERVE' };
  if (!provider) return { ok: false, listed: null, reason: 'NO_PROVIDER' };
  try {
    const { Contract } = await loadEthers();
    const pool = new Contract(venue.pool, AAVE_POOL_ABI, provider);
    const data = await pool.getReserveData(asset.address);
    const aToken = String(data.aTokenAddress || data[8] || ZERO);
    if (!isAddress(aToken) || aToken === ZERO) return { ok: true, listed: false, reason: 'NOT_A_RESERVE' };
    return {
      ok: true,
      listed: true,
      aTokenAddress: aToken,
      variableDebtTokenAddress: String(data.variableDebtTokenAddress || data[10] || ZERO),
      supplyApyPct: rayRateToApyPct(data.currentLiquidityRate ?? data[2]),
      borrowApyPct: rayRateToApyPct(data.currentVariableBorrowRate ?? data[4])
    };
  } catch (error) {
    return { ok: false, listed: null, reason: 'RESERVE_READ_FAILED', detail: String(error?.message || error).slice(0, 160) };
  }
}

/** Live rates for a whole asset list, in parallel, each failing on its own. */
export async function readReserves({ provider, chainId, assets }) {
  const list = Array.isArray(assets) ? assets : [];
  const entries = await Promise.all(list.map(async (asset) => [asset.id, await readReserve({ provider, chainId, asset })]));
  return Object.fromEntries(entries);
}

/** The connected account's position, straight from the pool. */
export async function readUserAccount({ provider, chainId, user }) {
  const venue = lendingVenue(chainId);
  if (!venue || !provider || !isAddress(user)) return { ok: false, reason: 'NOT_CONNECTED' };
  try {
    const { Contract } = await loadEthers();
    const pool = new Contract(venue.pool, AAVE_POOL_ABI, provider);
    const data = await pool.getUserAccountData(user);
    const thresholdPct = Number(data.currentLiquidationThreshold ?? data[3]) / 100;
    return {
      ok: true,
      totalCollateralUsd: baseToUsd(data.totalCollateralBase ?? data[0]),
      totalDebtUsd: baseToUsd(data.totalDebtBase ?? data[1]),
      availableBorrowsUsd: baseToUsd(data.availableBorrowsBase ?? data[2]),
      liquidationThresholdPct: Number.isFinite(thresholdPct) ? thresholdPct : null,
      ltvPct: Number(data.ltv ?? data[4]) / 100,
      healthFactor: readHealthFactor(data.healthFactor ?? data[5])
    };
  } catch (error) {
    return { ok: false, reason: 'ACCOUNT_READ_FAILED', detail: String(error?.message || error).slice(0, 160) };
  }
}

/** Wallet balance, supplied balance (aToken) and debt for one asset. */
export async function readAssetPosition({ provider, chainId, asset, user, reserve = null }) {
  if (!provider || !asset?.address || !isAddress(user)) return { ok: false, reason: 'NOT_CONNECTED' };
  try {
    const { Contract } = await loadEthers();
    const res = reserve?.listed ? reserve : await readReserve({ provider, chainId, asset });
    const token = new Contract(asset.address, ERC20_MIN_ABI, provider);
    const walletWei = await token.balanceOf(user);
    let suppliedWei = 0n;
    let debtWei = 0n;
    if (res?.listed) {
      if (isAddress(res.aTokenAddress) && res.aTokenAddress !== ZERO) {
        suppliedWei = await new Contract(res.aTokenAddress, ERC20_MIN_ABI, provider).balanceOf(user);
      }
      if (isAddress(res.variableDebtTokenAddress) && res.variableDebtTokenAddress !== ZERO) {
        debtWei = await new Contract(res.variableDebtTokenAddress, ERC20_MIN_ABI, provider).balanceOf(user);
      }
    }
    return {
      ok: true,
      walletWei: walletWei.toString(),
      suppliedWei: suppliedWei.toString(),
      debtWei: debtWei.toString(),
      wallet: fromUnits(walletWei, asset.decimals),
      supplied: fromUnits(suppliedWei, asset.decimals),
      debt: fromUnits(debtWei, asset.decimals)
    };
  } catch (error) {
    return { ok: false, reason: 'POSITION_READ_FAILED', detail: String(error?.message || error).slice(0, 160) };
  }
}

/** Current ERC-20 allowance towards the pool. */
export async function readAllowance({ provider, chainId, asset, owner }) {
  const venue = lendingVenue(chainId);
  if (!venue || !provider || !asset?.address || !isAddress(owner)) return null;
  try {
    const { Contract } = await loadEthers();
    const token = new Contract(asset.address, ERC20_MIN_ABI, provider);
    return (await token.allowance(owner, venue.pool)).toString();
  } catch { return null; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHAIN WRITES — each one is a wallet signature, nothing is sponsored
   ═══════════════════════════════════════════════════════════════════════════ */

const failure = (code, error) => ({ ok: false, code, message: String(error?.message || error || code).slice(0, 200) });

const isUserRejection = (error) => {
  const code = Number(error?.code);
  const message = String(error?.message || error || '');
  return code === 4001 || error?.code === 'ACTION_REJECTED' || /user\s*(rejected|denied|cancell?ed)/i.test(message);
};

const wrap = async (label, run) => {
  try {
    const tx = await run();
    const receipt = await tx.wait();
    return { ok: true, step: label, hash: tx.hash, status: Number(receipt?.status ?? 1) === 1 ? 'confirmed' : 'reverted' };
  } catch (error) {
    if (isUserRejection(error)) return failure('USER_REJECTED', error);
    return failure(`${label.toUpperCase()}_FAILED`, error);
  }
};

/** Approve exactly the amount being deposited — never an unlimited allowance. */
export async function approveForPool({ signer, chainId, asset, amountWei }) {
  const venue = lendingVenue(chainId);
  if (!venue) return failure('UNSUPPORTED_CHAIN', 'no pool');
  if (!signer) return failure('WALLET_NOT_CONNECTED', 'no signer');
  const { Contract } = await loadEthers();
  const token = new Contract(asset.address, ERC20_MIN_ABI, signer);
  return wrap('approve', () => token.approve(venue.pool, amountWei));
}

export async function supplyToPool({ signer, chainId, asset, amountWei, onBehalfOf }) {
  const venue = lendingVenue(chainId);
  if (!venue) return failure('UNSUPPORTED_CHAIN', 'no pool');
  if (!signer) return failure('WALLET_NOT_CONNECTED', 'no signer');
  const { Contract } = await loadEthers();
  const pool = new Contract(venue.pool, AAVE_POOL_ABI, signer);
  return wrap('supply', () => pool.supply(asset.address, amountWei, onBehalfOf, AAVE_REFERRAL_CODE));
}

export async function borrowFromPool({ signer, chainId, asset, amountWei, onBehalfOf }) {
  const venue = lendingVenue(chainId);
  if (!venue) return failure('UNSUPPORTED_CHAIN', 'no pool');
  if (!signer) return failure('WALLET_NOT_CONNECTED', 'no signer');
  const { Contract } = await loadEthers();
  const pool = new Contract(venue.pool, AAVE_POOL_ABI, signer);
  return wrap('borrow', () => pool.borrow(asset.address, amountWei, VARIABLE_RATE_MODE, AAVE_REFERRAL_CODE, onBehalfOf));
}

export async function repayToPool({ signer, chainId, asset, amountWei, onBehalfOf }) {
  const venue = lendingVenue(chainId);
  if (!venue) return failure('UNSUPPORTED_CHAIN', 'no pool');
  if (!signer) return failure('WALLET_NOT_CONNECTED', 'no signer');
  const { Contract } = await loadEthers();
  const pool = new Contract(venue.pool, AAVE_POOL_ABI, signer);
  return wrap('repay', () => pool.repay(asset.address, amountWei, VARIABLE_RATE_MODE, onBehalfOf));
}

export async function withdrawFromPool({ signer, chainId, asset, amountWei, to }) {
  const venue = lendingVenue(chainId);
  if (!venue) return failure('UNSUPPORTED_CHAIN', 'no pool');
  if (!signer) return failure('WALLET_NOT_CONNECTED', 'no signer');
  const { Contract } = await loadEthers();
  const pool = new Contract(venue.pool, AAVE_POOL_ABI, signer);
  return wrap('withdraw', () => pool.withdraw(asset.address, amountWei, to));
}

/**
 * Run a built plan step by step against the wallet. Stops at the first
 * failure and reports exactly which step stopped it — a half-finished plan is
 * reported as half-finished, never as a success.
 */
export async function runLendingPlan({ steps, signer, chainId, asset, account, onStep }) {
  const done = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    onStep?.({ ...step, state: 'running' });
    let result;
    if (step.id === 'approve') result = await approveForPool({ signer, chainId, asset, amountWei: step.amountWei });
    else if (step.id === 'supply') result = await supplyToPool({ signer, chainId, asset, amountWei: step.amountWei, onBehalfOf: account });
    else if (step.id === 'borrow') result = await borrowFromPool({ signer, chainId, asset, amountWei: step.amountWei, onBehalfOf: account });
    else if (step.id === 'repay') result = await repayToPool({ signer, chainId, asset, amountWei: step.amountWei, onBehalfOf: account });
    else if (step.id === 'withdraw') result = await withdrawFromPool({ signer, chainId, asset, amountWei: step.amountWei, to: account });
    else result = failure('UNKNOWN_STEP', step.id);

    if (!result.ok || result.status === 'reverted') {
      onStep?.({ ...step, state: 'failed', code: result.code || 'REVERTED', hash: result.hash || null });
      return { ok: false, completed: done, failedStep: step.id, code: result.code || 'REVERTED', message: result.message || null };
    }
    onStep?.({ ...step, state: 'done', hash: result.hash });
    done.push({ id: step.id, hash: result.hash });
  }
  return { ok: true, completed: done };
}
