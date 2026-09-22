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
  43114: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',  // Avalanche
  59144: '0xc47b8C00b0f69a36fa203Ffeac0334874574a8Ac', // Linea
  146: '0x5362dBb1e601abF3a4c14c22ffEdA64042E5eAA3'    // Sonic
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
/** Solana's non-EVM lending market is handled by src/lib/solanaLending.js. */
export const SOLANA_LENDING_CHAIN_ID = 900001;

/**
 * Native coins cannot enter the Pool directly (they need the WETH gateway),
 * so they are never offered as lending assets. Listing them would mean an
 * action that always fails at the wallet — the exact dead end this file
 * exists to remove.
 *
 * ─── WHY THIS IS A FLAG CHECK AND NOT A SYMBOL CHECK ──────────────────────
 * It used to be `NATIVE_SYMBOLS.has(token.symbol)`, which silently deleted
 * Binance-Peg ETH on BNB Chain (0x2170Ed0880ac9A755fd29B2688956BD959F933F8) —
 * a REAL Aave V3 BNB reserve, explicitly listed in RESERVE_SYMBOLS[56] — for
 * no reason other than "ETH happens to be the gas coin on *another* chain".
 * The BNB market advertised four reserves and rendered three, and nothing
 * anywhere said so.
 *
 * §6 states the general rule: never infer an on-chain fact from a token's
 * symbol. The registry already carries the authoritative `native` flag, so
 * that is what is read now. The symbol set survives only as the fallback for
 * a registry entry that has no flag at all — and a gas coin has no contract
 * address, which is the property that actually matters here.
 */
const NATIVE_SYMBOLS = new Set(['ETH', 'BNB', 'POL', 'MATIC', 'AVAX', 'S']);

/** Is this registry entry the chain's gas coin (which the Pool cannot take)? */
export function isNativeToken(token) {
  if (token?.native === true) return true;
  if (token?.native === false) return false;
  /* No flag: a native coin is the one entry with no contract address. */
  return !token?.address && NATIVE_SYMBOLS.has(token?.symbol);
}

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
  43114: ['USDT', 'USDC', 'WETH'],
  59144: ['USDC', 'USDT', 'WETH'],
  146: ['USDC', 'wS', 'stS']
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
  'function setUserUseReserveAsCollateral(address asset, bool useAsCollateral)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getUserConfiguration(address user) view returns ((uint256 data))',
  'function getPriceOracle() view returns (address)',
  'function getReserveData(address asset) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))'
];

/**
 * The protocol's OWN price feed (§21/§32). Aave values collateral, debt,
 * borrowing power and health factor with this oracle — never with an exchange
 * ticker — so this is the only price source allowed to feed a risk number on
 * the Lending page. A market whose oracle cannot be read reports the price as
 * unavailable; it is never substituted with a CoinGecko quote.
 */
export const AAVE_ORACLE_ABI = [
  'function getAssetPrice(address asset) view returns (uint256)',
  'function getAssetsPrices(address[] calldata assets) view returns (uint256[] calldata)',
  'function BASE_CURRENCY_UNIT() view returns (uint256)',
  'function BASE_CURRENCY_ADDRESS() view returns (address)'
];

export const ERC20_MIN_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)'
];

/** Aave's sentinel for "the whole balance" / "the whole debt" (§16/§17). */
export const UINT256_MAX = (2n ** 256n - 1n).toString();

/** Is the user asking for MAX rather than a typed amount? */
export const isMaxAmount = (amount) => String(amount ?? '').trim().toLowerCase() === 'max';

const loadEthers = () => import('ethers');

const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const ZERO = '0x0000000000000000000000000000000000000000';

/* ═══════════════════════════════════════════════════════════════════════════
   PURE HELPERS — deterministic, unit-testable, no network
   ═══════════════════════════════════════════════════════════════════════════ */

/** The lending venue for a chain, or null when the chain has no Aave market. */
export function lendingVenue(chainId) {
  const cid = Number(chainId);
  if (cid === SOLANA_LENDING_CHAIN_ID) {
    return { protocol: 'kamino-klend', chainId: cid, pool: null, chainName: 'Solana', nonEvm: true };
  }
  const pool = AAVE_V3_POOLS[cid];
  if (!isAddress(pool)) return null;
  return {
    protocol: 'aave-v3',
    chainId: cid,
    pool,
    chainName: EVM_CHAINS[cid]?.name || `#${chainId}`
  };
}

/** Is lending wired for this chain at all? */
export const lendingSupported = (chainId) => lendingVenue(chainId) !== null;

/** Every chain the loan screen can execute on, in the app's own order. */
export const lendingChains = () => [...Object.keys(AAVE_V3_POOLS).map(Number), SOLANA_LENDING_CHAIN_ID];

/**
 * The assets the loan screen may offer on a chain: listed as an Aave reserve
 * AND present in the app's own token registry (so the address, decimals and
 * icon come from one audited place) AND not a native coin.
 */
export function lendingAssetsFor(chainId) {
  const cid = Number(chainId);
  /* Solana reserves are decoded by the Kamino client, not the ERC-20 path. */
  if (cid === SOLANA_LENDING_CHAIN_ID) return [];
  if (!lendingSupported(cid)) return [];
  const wanted = RESERVE_SYMBOLS[cid] || [];
  const registry = TOKENS[cid] || [];
  return wanted
    .map((symbol) => registry.find((token) => token.symbol === symbol))
    .filter((token) => token && isAddress(token.address) && !isNativeToken(token))
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

/* ─────────────────────────────────────────────────────────────────────────
   THE RESERVE CONFIGURATION BITMAP (§6/§13/§20)
   ─────────────────────────────────────────────────────────────────────────
   `getReserveData` already returns this bitmap, so reading it costs nothing
   extra — and it is where the protocol keeps the numbers the Lending page was
   previously unable to show at all:

     · LTV and the liquidation threshold, per reserve (§13)
     · whether the reserve is paused or frozen (§29 — offering a paused
       market as live ends in a wallet revert the user pays gas to discover)
     · whether borrowing is enabled on it at all
     · the supply cap and the borrow cap (§20 — "handle protocol caps")
     · the reserve's own decimals, which is the authoritative answer to §18

   The bit layout below is Aave V3's `ReserveConfiguration` and matches the
   one already verified in src/lib/defi/aaveV3Arbitrum.js (RESERVE_CONFIG_BITS).

   A zero bitmap is NOT "zero LTV". It is "we could not read the risk
   parameters" — which the callers must report as unknown, never as 0%, and
   never as a licence to treat the reserve as unlimited.
   ───────────────────────────────────────────────────────────────────────── */
export const RESERVE_CONFIG_BITS = Object.freeze({
  ltvShift: 0n,
  liquidationThresholdShift: 16n,
  liquidationBonusShift: 32n,
  decimalsShift: 48n,
  activeShift: 56n,
  frozenShift: 57n,
  borrowingEnabledShift: 58n,
  stableRateBorrowingShift: 59n,
  pausedShift: 60n,
  borrowingInIsolationShift: 61n,
  siloedBorrowingShift: 62n,
  flashloaningShift: 63n,
  borrowCapShift: 80n,
  supplyCapShift: 116n,
  capBits: 36n
});

const bitAt = (raw, shift) => ((raw >> shift) & 1n) === 1n;
const fieldAt = (raw, shift, bits) => (raw >> shift) & ((1n << bits) - 1n);
/** Aave's cap field: 0 means unlimited, so it is null here, never 0. */
const capOrNull = (value) => (value > 0n ? value : null);

/** Decode the bitmap. Bps stay integers; percentages are derived by callers. */
export function decodeReserveConfiguration(configuration) {
  let raw;
  try { raw = BigInt(configuration ?? 0); } catch { return null; }
  const b = RESERVE_CONFIG_BITS;
  const ltvBps = Number(fieldAt(raw, b.ltvShift, 16n));
  const liquidationThresholdBps = Number(fieldAt(raw, b.liquidationThresholdShift, 16n));
  const liquidationBonusBps = Number(fieldAt(raw, b.liquidationBonusShift, 16n));
  const decimals = Number(fieldAt(raw, b.decimalsShift, 8n));
  const paused = bitAt(raw, b.pausedShift);
  const frozen = bitAt(raw, b.frozenShift);
  const active = bitAt(raw, b.activeShift);
  return {
    raw: raw.toString(),
    /* A zero bitmap means the read produced nothing usable — every derived
       value is then reported as null so no caller can mistake it for a real
       "0% LTV" or "no cap". */
    readable: raw !== 0n,
    ltvBps: ltvBps > 0 ? ltvBps : null,
    liquidationThresholdBps: liquidationThresholdBps > 0 ? liquidationThresholdBps : null,
    liquidationBonusBps: liquidationBonusBps > 0 ? liquidationBonusBps : null,
    /* decimals is only trustworthy when the bitmap itself was readable. */
    decimals: raw !== 0n && decimals > 0 && decimals <= 36 ? decimals : null,
    active: raw === 0n ? null : active,
    frozen: raw === 0n ? null : frozen,
    paused: raw === 0n ? null : paused,
    borrowingEnabled: raw === 0n ? null : bitAt(raw, b.borrowingEnabledShift),
    stableRateBorrowingEnabled: raw === 0n ? null : bitAt(raw, b.stableRateBorrowingShift),
    borrowingInIsolation: raw === 0n ? null : bitAt(raw, b.borrowingInIsolationShift),
    siloedBorrowing: raw === 0n ? null : bitAt(raw, b.siloedBorrowingShift),
    flashloaningEnabled: raw === 0n ? null : bitAt(raw, b.flashloaningShift),
    /* Whole-token caps; 0 means "no cap" in Aave, which is reported as null
       (unlimited) rather than as a cap of zero tokens. The zero check is on the
       CAP FIELD, not on the whole bitmap: an uncapped reserve is readable and
       open, and returning 0n here would read downstream as "nobody may supply
       this". Both readers (the derived *CapWei below and the UI's cap row)
       already treat null and 0 as unlimited, so this only removes the
       contradiction with the contract stated above. */
    supplyCapWhole: capOrNull(fieldAt(raw, b.supplyCapShift, b.capBits)),
    borrowCapWhole: capOrNull(fieldAt(raw, b.borrowCapShift, b.capBits)),
    /* An unreadable bitmap has no status. Reporting 'active' here would be the
       one place a failed read turns into a confident "this market is open",
       which is what §3/§37 forbid. Note this does NOT gate anything on its own:
       callers block only on an explicitly-true paused/frozen, so 'unknown'
       leaves the action allowed-but-unverified rather than refused. */
    status: raw === 0n ? 'unknown' : paused ? 'paused' : frozen ? 'frozen' : 'active'
  };
}

/**
 * Aave's `getUserConfiguration` bitmap: two bits per reserve, indexed by the
 * reserve's own `id` from `getReserveData` — bit 0 borrowing, bit 1 collateral.
 * This is how §15's "collateral balance / is this collateral on?" is read:
 * from the protocol, not from a guess based on a non-zero aToken balance.
 */
export function decodeUserConfiguration(data, reserveId) {
  let raw;
  try { raw = BigInt(data ?? 0); } catch { return null; }
  const id = Number(reserveId);
  if (!Number.isInteger(id) || id < 0) return null;
  const shift = BigInt(id) * 2n;
  return {
    borrowing: ((raw >> shift) & 1n) === 1n,
    usingAsCollateral: ((raw >> (shift + 1n)) & 1n) === 1n
  };
}

/**
 * Convert an integer token amount into the protocol's base-currency (USD)
 * units using the PROTOCOL's own oracle price — exact integer arithmetic, no
 * floating point until the final display conversion (§18).
 *
 *   amountWei  — integer token units
 *   priceBase  — oracle price, base-currency units per WHOLE token
 *   decimals   — the token's decimals
 *
 * Returns base-currency units (BigInt) or null when the price is unknown.
 * A null here must disable the calculation, never default to zero.
 */
export function unitsToBase(amountWei, priceBase, decimals) {
  const amount = safeBig(amountWei);
  const price = safeBig(priceBase);
  const dec = Number(decimals);
  if (amount == null || price == null || price <= 0n) return null;
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return null;
  return (amount * price) / (10n ** BigInt(dec));
}

/** base-currency units → a display USD number (the one float step, at the end). */
export function baseToUsdNumber(valueBase) {
  const raw = safeBig(valueBase);
  return raw == null ? null : Number(raw) / 10 ** BASE_CURRENCY_DECIMALS;
}

/**
 * §12 — MAXIMUM BORROW, in integer token units, from the protocol's own
 * numbers. Deliberately NOT `collateral × LTV`: `availableBorrowsBase` is the
 * pool's own answer and already accounts for per-reserve collateral factors,
 * existing debt, e-mode, isolation and the liquidation threshold. This
 * function only converts that answer into the borrow asset's units and then
 * applies the two constraints the pool does NOT fold into it:
 *
 *   · available liquidity — you cannot borrow tokens the pool does not hold
 *   · borrow-cap headroom  — cap minus what is already borrowed
 *
 * The binding constraint is named in `limitedBy`, so the UI can say *why* a
 * maximum is what it is instead of showing a bare number.
 *
 * `headroomBps` (default 10 = 0.1%) is not a risk buffer invented here: debt
 * accrues interest between this read and block inclusion, so borrowing the
 * last basis point of capacity reverts. It is disclosed to the caller in the
 * result rather than applied silently.
 */
export function maxBorrowWei({
  availableBorrowsBase,
  priceBase,
  decimals,
  availableLiquidityWei = null,
  borrowCapWei = null,
  totalDebtWei = null,
  headroomBps = 10
} = {}) {
  const capacityBase = safeBig(availableBorrowsBase);
  const price = safeBig(priceBase);
  const dec = Number(decimals);
  if (capacityBase == null || price == null || price <= 0n) {
    return { ok: false, reason: price == null || price <= 0n ? 'ORACLE_PRICE_UNAVAILABLE' : 'BORROW_CAPACITY_UNAVAILABLE' };
  }
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return { ok: false, reason: 'DECIMALS_UNKNOWN' };

  const constraints = [{
    id: 'borrow-capacity',
    wei: (capacityBase * (10n ** BigInt(dec))) / price,
    source: 'pool.getUserAccountData → availableBorrowsBase'
  }];

  const liquidity = safeBig(availableLiquidityWei);
  if (liquidity != null) {
    constraints.push({ id: 'available-liquidity', wei: liquidity, source: 'aToken.totalSupply − debt.totalSupply' });
  }

  const cap = safeBig(borrowCapWei);
  const debt = safeBig(totalDebtWei);
  if (cap != null && cap > 0n && debt != null) {
    constraints.push({ id: 'borrow-cap', wei: cap > debt ? cap - debt : 0n, source: 'reserve configuration borrowCap − totalDebt' });
  }

  let binding = constraints[0];
  for (const c of constraints) if (c.wei < binding.wei) binding = c;

  const hb = Number(headroomBps);
  const headroom = Number.isFinite(hb) && hb >= 0 && hb < 10000 ? BigInt(hb) : 10n;
  const raw = binding.wei < 0n ? 0n : binding.wei;
  const safe = (raw * (10000n - headroom)) / 10000n;

  return {
    ok: true,
    maxWei: raw.toString(),
    safeMaxWei: safe.toString(),
    limitedBy: binding.id,
    limitedBySource: binding.source,
    constraints: constraints.map((c) => ({ id: c.id, wei: c.wei.toString(), source: c.source })),
    headroomBps: Number(headroom)
  };
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
 *
 * `maxWei` is the on-chain debt (repay) or supplied balance (withdraw) and is
 * REQUIRED to plan a MAX action: the protocol sentinel is sent as the amount,
 * but the approval still has to cover the real number the pool will pull.
 * Planning a MAX repay without it would either under-approve (revert) or
 * approve unlimited (§29 — exactly what this file refuses to do).
 */
export function buildLendingPlan({ action, asset, amount, collateral = null, collateralAsset = null, allowanceWei = null, collateralAllowanceWei = null, decimals = null, maxWei = null, useAsCollateral = null }) {
  const steps = [];
  const dec = Number(decimals ?? asset?.decimals ?? 18);
  const need = toUnits(action === 'borrow' ? collateral : amount, dec);
  const have = allowanceWei == null ? null : safeBig(allowanceWei);

  if (action === 'supply') {
    if (need == null || need <= 0n) return { ok: false, error: 'AMOUNT_REQUIRED', steps: [] };
    /* §29: approve EXACTLY what is being deposited. Never an unlimited
       allowance, never a padded one. */
    if (have == null || have < need) steps.push({ id: 'approve', symbol: asset?.symbol, amountWei: need.toString() });
    steps.push({ id: 'supply', symbol: asset?.symbol, amountWei: need.toString() });
    return { ok: true, action, steps };
  }

  if (action === 'borrow') {
    const borrowUnits = toUnits(amount, dec);
    if (borrowUnits == null || borrowUnits <= 0n) return { ok: false, error: 'AMOUNT_REQUIRED', steps: [] };
    /* Collateral is optional: a user who already has collateral in the pool
       borrows in a single step. When they do add collateral, the deposit is
       its own reviewed step and it is signed before the borrow.
       ────────────────────────────────────────────────────────────────────
       §11 requires "select collateral ↓ select borrow asset" as TWO choices,
       and this is where that becomes real: `collateralAsset` is a distinct
       asset with its own address, its own decimals and its own allowance. The
       borrow amount is converted with the BORROW asset's decimals and the
       collateral amount with the COLLATERAL asset's decimals — previously both
       used the borrow asset's, so posting WETH against a USDC borrow would
       have been scaled by 6 instead of 18 and signed for the wrong token. */
    if (need != null && need > 0n) {
      const coll = isAddress(collateralAsset?.address) ? collateralAsset : asset;
      const collDec = Number(collateralAsset?.decimals ?? dec);
      const collUnits = collateralAsset ? toUnits(collateral, collDec) : need;
      if (collUnits == null || collUnits <= 0n) return { ok: false, error: 'AMOUNT_REQUIRED', steps: [] };
      const collHave = (collateralAsset ? collateralAllowanceWei : allowanceWei) ?? null;
      const collHaveBig = collHave == null ? null : safeBig(collHave);
      if (collHaveBig == null || collHaveBig < collUnits) {
        steps.push({ id: 'approve', symbol: coll?.symbol, asset: coll, amountWei: collUnits.toString() });
      }
      steps.push({ id: 'supply', symbol: coll?.symbol, asset: coll, amountWei: collUnits.toString(), asCollateral: true });
    }
    steps.push({ id: 'borrow', symbol: asset?.symbol, amountWei: borrowUnits.toString() });
    return { ok: true, action, steps };
  }

  if (action === 'collateral') {
    /* §15 — toggling the collateral flag moves no tokens, so there is no amount
       and no approval. The safety check lives in
       `assertCollateralChangeSafe`, which the caller must run first. */
    steps.push({ id: 'collateral', symbol: asset?.symbol, useAsCollateral: Boolean(useAsCollateral) });
    return { ok: true, action, steps };
  }

  if (action === 'withdraw' || action === 'repay') {
    const wantsMax = isMaxAmount(amount);
    /* For MAX the protocol sentinel goes to the pool, but the numbers shown to
       the user and the approval still need the real balance/debt. */
    const realUnits = wantsMax ? safeBig(maxWei) : toUnits(amount, dec);
    const sendUnits = wantsMax ? safeBig(UINT256_MAX) : realUnits;
    if (realUnits == null || realUnits <= 0n) {
      return { ok: false, error: wantsMax ? 'MAX_UNAVAILABLE' : 'AMOUNT_REQUIRED', steps: [] };
    }
    if (sendUnits == null) return { ok: false, error: 'AMOUNT_REQUIRED', steps: [] };
    if (action === 'repay' && (have == null || have < realUnits)) {
      steps.push({ id: 'approve', symbol: asset?.symbol, amountWei: realUnits.toString() });
    }
    steps.push({ id: action, symbol: asset?.symbol, amountWei: sendUnits.toString(), max: wantsMax });
    return { ok: true, action, steps, max: wantsMax };
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
    const variableDebtTokenAddress = String(data.variableDebtTokenAddress || data[10] || ZERO);
    const stableDebtTokenAddress = String(data.stableDebtTokenAddress || data[9] || ZERO);

    /* ── §6/§13/§20 — risk parameters and liquidity ─────────────────────────
       The configuration bitmap came back in the SAME call, so LTV, the
       liquidation threshold, the caps and paused/frozen cost nothing extra.
       The totals need two more reads (aToken.totalSupply and the debt token's)
       plus the token's own `decimals()` for §18 verification. Each is
       independently tolerant: a public RPC that rate-limits `totalSupply`
       degrades that ONE field to null and leaves the proven rates on screen.
       A partial read is labelled partial; it never becomes a zero. */
    const [totalSupplyWei, variableDebtWei, stableDebtWei, verifiedDecimals] = await Promise.all([
      tolerantUint(() => new Contract(aToken, ERC20_MIN_ABI, provider).totalSupply()),
      isAddress(variableDebtTokenAddress) && variableDebtTokenAddress !== ZERO
        ? tolerantUint(() => new Contract(variableDebtTokenAddress, ERC20_MIN_ABI, provider).totalSupply())
        : Promise.resolve(0n),
      isAddress(stableDebtTokenAddress) && stableDebtTokenAddress !== ZERO
        ? tolerantUint(() => new Contract(stableDebtTokenAddress, ERC20_MIN_ABI, provider).totalSupply())
        : Promise.resolve(0n),
      tolerantUint(() => new Contract(asset.address, ERC20_MIN_ABI, provider).decimals())
    ]);

    const config = decodeReserveConfiguration(data.configuration ?? data[0]);
    const registryDecimals = Number(asset.decimals ?? 18);
    /* §18: the protocol's bitmap decimals are authoritative, then the token
       contract's own `decimals()`, then — only if neither could be read — the
       registry. A disagreement is reported, never silently resolved. */
    const decimals = config?.decimals ?? (verifiedDecimals != null ? Number(verifiedDecimals) : registryDecimals);
    const decimalsSource = config?.decimals != null ? 'reserve-configuration'
        : verifiedDecimals != null ? 'token-contract' : 'registry';
    const totalDebtWei = (variableDebtWei ?? 0n) + (stableDebtWei ?? 0n);
    const capScale = 10n ** BigInt(Number.isInteger(decimals) && decimals >= 0 ? decimals : registryDecimals);

    return {
      ok: true,
      listed: true,
      reserveId: Number(data.id ?? data[7] ?? 0),
      aTokenAddress: aToken,
      variableDebtTokenAddress,
      stableDebtTokenAddress,
      supplyApyPct: rayRateToApyPct(data.currentLiquidityRate ?? data[2]),
      borrowApyPct: rayRateToApyPct(data.currentVariableBorrowRate ?? data[4]),
      liquidityIndex: (data.liquidityIndex ?? data[1] ?? 0n).toString(),
      variableBorrowIndex: (data.variableBorrowIndex ?? data[3] ?? 0n).toString(),
      lastUpdateTimestamp: Number(data.lastUpdateTimestamp ?? data[6] ?? 0) || null,

      /* §20 — protocol liquidity, from the protocol's own tokens */
      totalSupplyWei: totalSupplyWei != null ? totalSupplyWei.toString() : null,
      totalDebtWei: totalSupplyWei != null ? totalDebtWei.toString() : null,
      availableLiquidityWei: totalSupplyWei != null
        ? (totalSupplyWei > totalDebtWei ? totalSupplyWei - totalDebtWei : 0n).toString()
        : null,
      utilizationPct: (totalSupplyWei != null && totalSupplyWei > 0n)
        ? Number((totalDebtWei * 10000n) / totalSupplyWei) / 100
        : null,
      liquidityRead: totalSupplyWei != null,

      /* §13 — risk parameters, per reserve, from the protocol */
      ltvPct: config?.ltvBps != null ? config.ltvBps / 100 : null,
      liquidationThresholdPct: config?.liquidationThresholdBps != null ? config.liquidationThresholdBps / 100 : null,
      liquidationBonusPct: config?.liquidationBonusBps != null ? config.liquidationBonusBps / 100 : null,
      borrowingEnabled: config?.borrowingEnabled ?? null,
      stableRateBorrowingEnabled: config?.stableRateBorrowingEnabled ?? null,
      siloedBorrowing: config?.siloedBorrowing ?? null,
      flashloaningEnabled: config?.flashloaningEnabled ?? null,

      /* §20 — caps (null = the protocol set no cap, which is not "cap of 0") */
      supplyCapWhole: config?.supplyCapWhole != null ? config.supplyCapWhole.toString() : null,
      borrowCapWhole: config?.borrowCapWhole != null ? config.borrowCapWhole.toString() : null,
      supplyCapWei: config?.supplyCapWhole ? (config.supplyCapWhole * capScale).toString() : null,
      borrowCapWei: config?.borrowCapWhole ? (config.borrowCapWhole * capScale).toString() : null,

      /* §29 — a paused or frozen reserve must not be offered as executable */
      status: config?.status ?? 'unknown',
      configReadable: Boolean(config?.readable),

      /* §18 — decimals, and where they came from */
      decimals,
      decimalsSource,
      decimalsMatch: verifiedDecimals == null ? null : Number(verifiedDecimals) === registryDecimals,
      dataStatus: totalSupplyWei != null && config?.readable ? 'live' : 'partial'
    };
  } catch (error) {
    return { ok: false, listed: null, reason: 'RESERVE_READ_FAILED', detail: String(error?.message || error).slice(0, 160) };
  }
}

/**
 * One integer read that must never take the caller down with it. Returns the
 * BigInt, or null when the endpoint refused / could not decode. A null is
 * "unknown" and the field it feeds is reported as unavailable (§3) — it is
 * never coerced to zero, because zero liquidity and unknown liquidity lead to
 * opposite decisions.
 */
async function tolerantUint(read) {
  try {
    const value = await read();
    const big = BigInt(value ?? 0);
    return big >= 0n ? big : null;
  } catch { return null; }
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
   §21 — ORACLE PRICE VALIDATION
   ───────────────────────────────────────────────────────────────────────────
   The prices behind collateral value, borrowing power, health factor and
   liquidation risk are read from the POOL'S OWN oracle, resolved at runtime
   through `Pool.getPriceOracle()`. That matters for two reasons:

     1. §32 — a CEX/aggregator ticker is not the protocol's risk input. Aave
        liquidates against ITS oracle, so showing a CoinGecko-derived number
        next to a health factor would let the user compute safety against a
        price the protocol will never use.
     2. The address is never hardcoded here. It is asked for, per chain, from
        the pool this file already proved answers `getReserveData`.

   What counts as INVALID, and what happens then:
     · zero price for an asset           → that asset is flagged, not guessed
     · the pool has no oracle            → the whole read is 'unavailable'
     · the reserve has not accrued
       interest for > STALE_AFTER_SECONDS → 'stale'
     · a caller-supplied reference price
       disagrees by > DEVIATION_ALERT_PCT → 'anomaly' (reported, never used to
       override the protocol price)

   In every one of those cases the caller must STOP the risk calculation and
   say so. Returning a number here that the protocol would not honour is how a
   user borrows against collateral the pool values differently.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A reserve that has not updated in this long is treated as stale. */
export const ORACLE_STALE_AFTER_SECONDS = 3600;
/** Reference-price disagreement beyond this is flagged as an anomaly. */
export const ORACLE_DEVIATION_ALERT_PCT = 10;

export const ORACLE_STATUS = Object.freeze({
  OK: 'ok',
  STALE: 'stale',
  ANOMALY: 'anomaly',
  UNAVAILABLE: 'unavailable'
});

/**
 * Read the protocol oracle for a list of assets, in ONE batched call.
 *
 * `referencePrices` is optional and is used ONLY to flag a deviation — it is
 * never substituted for the protocol price, and never feeds a risk number.
 * `nowSeconds` is injectable so the staleness rule is unit-testable.
 *
 * `reserves` is optional: the snapshot `readReserves` already produced for the
 * SAME pass. Each reserve carries the `lastUpdateTimestamp` the staleness rule
 * needs, so passing it saves one full pool read per asset — on a rate-limited
 * public RPC those re-reads were often the difference between the oracle
 * answering and the whole read 429ing. A reserve missing from the map falls
 * back to a single fresh read, exactly as before.
 *
 * @returns {Promise<{
 *   ok: boolean, status: string, oracleAddress: string|null,
 *   baseCurrencyUnit: string|null, baseCurrencyDecimals: number|null,
 *   prices: Object<string, {priceBase:string, priceUsd:number|null, valid:boolean, reason:string|null, deviationPct:number|null}>,
 *   staleAssets: string[], invalidAssets: string[], checkedAt: number, reason?: string
 * }>}
 */
export async function readOraclePrices({ provider, chainId, assets, referencePrices = null, nowSeconds = null, staleAfterSeconds = ORACLE_STALE_AFTER_SECONDS, reserves = null }) {
  const list = Array.isArray(assets) ? assets.filter((a) => isAddress(a?.address)) : [];
  const empty = {
    ok: false, status: ORACLE_STATUS.UNAVAILABLE, oracleAddress: null,
    baseCurrencyUnit: null, baseCurrencyDecimals: null,
    prices: {}, staleAssets: [], invalidAssets: [], checkedAt: Date.now()
  };
  const venue = lendingVenue(chainId);
  if (!venue || !provider) return { ...empty, reason: 'NO_PROVIDER' };
  if (!list.length) return { ...empty, reason: 'NO_ASSETS' };

  try {
    const { Contract } = await loadEthers();
    const pool = new Contract(venue.pool, AAVE_POOL_ABI, provider);
    const oracleAddress = String(await pool.getPriceOracle());
    if (!isAddress(oracleAddress) || oracleAddress === ZERO) {
      return { ...empty, reason: 'NO_ORACLE_ON_POOL' };
    }
    const oracle = new Contract(oracleAddress, AAVE_ORACLE_ABI, provider);

    /* The base-currency unit defines the price's decimals. It is read, never
       assumed to be 1e8 — a EUR-denominated Aave market would silently scale
       every risk number by the wrong power of ten otherwise. */
    let unit;
    try { unit = BigInt(await oracle.BASE_CURRENCY_UNIT()); } catch { unit = null; }
    if (unit == null || unit <= 0n) return { ...empty, oracleAddress, reason: 'BASE_CURRENCY_UNIT_UNREADABLE' };

    let raw;
    try {
      raw = await oracle.getAssetsPrices(list.map((a) => a.address));
    } catch {
      /* Fall back to per-asset reads: a node that rejects the batch call still
         answers the single one, and a partial answer beats no answer. */
      raw = await Promise.all(list.map(async (a) => {
        try { return BigInt(await oracle.getAssetPrice(a.address)); } catch { return null; }
      }));
    }

    const unitDecimals = Math.round(Math.log10(Number(unit)));
    const baseDecimals = Number.isInteger(unitDecimals) && unitDecimals >= 0 && unitDecimals <= 36 ? unitDecimals : BASE_CURRENCY_DECIMALS;
    const now = Number.isFinite(Number(nowSeconds)) ? Number(nowSeconds) : Math.floor(Date.now() / 1000);

    const prices = {};
    const staleAssets = [];
    const invalidAssets = [];
    let anyStale = false;
    let anyAnomaly = false;
    let anyValid = false;

    await Promise.all(list.map(async (asset, index) => {
      const value = raw?.[index];
      const priceBase = safeBig(value);
      const reference = referencePrices ? Number(referencePrices[asset.symbol] ?? referencePrices[asset.id] ?? NaN) : NaN;

      /* Staleness is the reserve's own last-accrual timestamp: it is the
         protocol's signal that this reserve's state has stopped moving.
         The snapshot from the same pass already carries it; only when it is
         absent (a direct caller, or a reserve outside the snapshot) is a
         fresh per-asset read made. */
      let lastUpdate = reserves?.[asset.id]?.lastUpdateTimestamp ?? null;
      if (lastUpdate == null) {
        try {
          const reserve = await readReserve({ provider, chainId, asset });
          lastUpdate = reserve?.lastUpdateTimestamp ?? null;
        } catch { lastUpdate = null; }
      }
      const stale = lastUpdate != null && Number(lastUpdate) > 0 && (now - Number(lastUpdate)) > Number(staleAfterSeconds);

      const valid = priceBase != null && priceBase > 0n && !stale;
      if (priceBase == null || priceBase <= 0n) invalidAssets.push(asset.symbol);
      if (stale) { staleAssets.push(asset.symbol); anyStale = true; }

      const priceUsd = valid ? Number(priceBase) / 10 ** baseDecimals : null;
      const deviationPct = (valid && Number.isFinite(reference) && reference > 0 && priceUsd != null)
        ? Math.abs(priceUsd - reference) / reference * 100
        : null;
      if (deviationPct != null && deviationPct > ORACLE_DEVIATION_ALERT_PCT) anyAnomaly = true;
      if (valid) anyValid = true;

      prices[asset.id] = {
        symbol: asset.symbol,
        address: asset.address,
        priceBase: valid ? priceBase.toString() : null,
        priceUsd,
        valid,
        stale: Boolean(stale),
        lastUpdateTimestamp: lastUpdate,
        deviationPct: deviationPct != null ? Math.round(deviationPct * 100) / 100 : null,
        /* Why an invalid price is invalid — never a silent zero. */
        reason: valid ? null
          : priceBase == null ? 'PRICE_UNREADABLE'
            : priceBase <= 0n ? 'ZERO_PRICE'
              : 'STALE_PRICE'
      };
    }));

    const status = !anyValid ? ORACLE_STATUS.UNAVAILABLE
      : anyAnomaly ? ORACLE_STATUS.ANOMALY
        : anyStale ? ORACLE_STATUS.STALE
          : ORACLE_STATUS.OK;

    return {
      ok: anyValid,
      status,
      oracleAddress,
      baseCurrencyUnit: unit.toString(),
      baseCurrencyDecimals: baseDecimals,
      prices,
      staleAssets,
      invalidAssets,
      checkedAt: Date.now(),
      /* The protocol's own feed is the source; a reference comparison is
         labelled as what it is so no reader mistakes it for the input. */
      source: 'protocol-oracle',
      referenceUsedForDeviationCheckOnly: Boolean(referencePrices)
    };
  } catch (error) {
    return { ...empty, reason: 'ORACLE_READ_FAILED', detail: String(error?.message || error).slice(0, 160) };
  }
}

/**
 * §15 — is each supplied asset actually being used as collateral, and is the
 * user borrowing on it? Read from the pool's own per-user configuration
 * bitmap, keyed by the reserve id `readReserve` already returned.
 *
 * A non-zero aToken balance does NOT mean "is collateral": a user can hold a
 * supplied balance with the collateral flag off. Guessing that from the
 * balance is how a UI tells someone they may disable something they cannot.
 */
export async function readUserConfiguration({ provider, chainId, user, reserves }) {
  const venue = lendingVenue(chainId);
  if (!venue || !provider || !isAddress(user)) return { ok: false, reason: 'NOT_CONNECTED', entries: {} };
  try {
    const { Contract } = await loadEthers();
    const pool = new Contract(venue.pool, AAVE_POOL_ABI, provider);
    const raw = await pool.getUserConfiguration(user);
    const data = raw?.data ?? raw?.[0] ?? raw;
    const bitmap = BigInt(data ?? 0);
    const entries = {};
    for (const [id, reserve] of Object.entries(reserves || {})) {
      const decoded = decodeUserConfiguration(bitmap, reserve?.reserveId);
      if (decoded) entries[id] = decoded;
    }
    return { ok: true, bitmap: bitmap.toString(), entries };
  } catch (error) {
    return { ok: false, reason: 'USER_CONFIGURATION_READ_FAILED', entries: {}, detail: String(error?.message || error).slice(0, 160) };
  }
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

/* ─────────────────────────────────────────────────────────────────────────
   §28 — AAVE'S OWN REVERT CODES
   ─────────────────────────────────────────────────────────────────────────
   Aave reverts with a bare numeric code (v3.0–v3.3) or a 4-byte custom-error
   selector (v3.4+). Both are decoded here into the engine's stable
   LENDING_ERRORS codes so the UI can say "this market is paused by the
   protocol" instead of "transaction failed".

   The numeric table and the selector table are the SAME ones already verified
   in src/lib/defi/aaveV3Arbitrum.js (AAVE_V3_ERROR_KEYS /
   AAVE_V3_CUSTOM_ERRORS) — reused deliberately, so a lending revert and a Farm
   revert can never be explained two different ways. Only the codes whose
   meaning is documented there are claimed; an unrecognised revert stays
   UNKNOWN rather than being given a plausible-sounding cause.
   ───────────────────────────────────────────────────────────────────────── */
export const AAVE_REVERT_NUMERIC = Object.freeze({
  25: 'AMOUNT_REQUIRED',        // INVALID_BURN_AMOUNT
  26: 'AMOUNT_REQUIRED',        // INVALID_AMOUNT
  27: 'NOT_A_RESERVE',          // RESERVE_INACTIVE
  28: 'MARKET_PAUSED',          // RESERVE_FROZEN
  29: 'MARKET_PAUSED',          // RESERVE_PAUSED
  32: 'INSUFFICIENT_BALANCE',   // NOT_ENOUGH_AVAILABLE_USER_BALANCE
  35: 'HEALTH_FACTOR_TOO_LOW',  // HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD
  45: 'HEALTH_FACTOR_TOO_LOW',  // HEALTH_FACTOR_NOT_BELOW_THRESHOLD
  51: 'SUPPLY_CAP_EXCEEDED',
  59: 'ORACLE_ANOMALY',         // PRICE_ORACLE_SENTINEL_CHECK_FAILED
  77: 'NOT_A_RESERVE',          // ZERO_ADDRESS_NOT_VALID
  82: 'NOT_A_RESERVE'           // ASSET_NOT_LISTED
});

export const AAVE_REVERT_SELECTORS = Object.freeze({
  '0x2c5211c6': 'AMOUNT_REQUIRED',        // InvalidAmount()
  '0x2075cc10': 'AMOUNT_REQUIRED',        // InvalidBurnAmount()
  '0x90cd6f24': 'NOT_A_RESERVE',          // ReserveInactive()
  '0x6d305815': 'MARKET_PAUSED',          // ReserveFrozen()
  '0xd37f5f1c': 'MARKET_PAUSED',          // ReservePaused()
  '0x47bc4b2c': 'INSUFFICIENT_BALANCE',   // NotEnoughAvailableUserBalance()
  '0x6679996d': 'HEALTH_FACTOR_TOO_LOW',  // HealthFactorLowerThanLiquidationThreshold()
  '0x930bb771': 'HEALTH_FACTOR_TOO_LOW',  // HealthFactorNotBelowThreshold()
  '0xf58f733a': 'SUPPLY_CAP_EXCEEDED',    // SupplyCapExceeded()
  '0x91037009': 'ORACLE_ANOMALY',         // PriceOracleSentinelCheckFailed()
  '0x3bf95ba7': 'NOT_A_RESERVE',          // ZeroAddressNotValid()
  '0xb77e1e0f': 'NOT_A_RESERVE'           // AssetNotListed()
});

/**
 * Explain an Aave revert as an engine error code.
 * @returns {{ code: string|null, known: boolean, reason: string|null }}
 */
export function explainAaveRevert(error) {
  const raw = String(error?.reason || error?.shortMessage || error?.message || error || '');
  const rawData = String(error?.data || error?.info?.error?.data || '');

  for (const candidate of [rawData, raw]) {
    const selector = String(candidate).match(/0x([0-9a-fA-F]{8})/);
    if (selector) {
      const code = AAVE_REVERT_SELECTORS[`0x${selector[1].toLowerCase()}`];
      if (code) return { code, known: true, reason: null };
    }
  }
  /* Legacy: the code arrives bare ("26") or inside ethers' prose. */
  const numeric = raw.match(/(?:^|[^0-9])(\d{1,3})(?![0-9])/);
  const code = numeric ? AAVE_REVERT_NUMERIC[Number(numeric[1])] : null;
  return { code: code ?? null, known: Boolean(code), reason: code ? null : raw.slice(0, 160) };
}

const wrap = async (label, run) => {
  try {
    const tx = await run();
    const receipt = await tx.wait();
    /* §10/§11/§16/§17: a receipt with status 0 is a REVERT, not a success.
       It is reported with the protocol's own reason, and the caller must not
       show "Supplied successfully" for it. */
    if (Number(receipt?.status ?? 1) !== 1) {
      return { ok: false, step: label, hash: tx.hash, status: 'reverted', code: 'TRANSACTION_REVERTED', message: `${label} reverted on-chain` };
    }
    return { ok: true, step: label, hash: tx.hash, status: 'confirmed' };
  } catch (error) {
    if (isUserRejection(error)) return failure('USER_REJECTED', error);
    /* The protocol's own explanation first; the generic step code only when
       Aave did not say what happened. */
    const explained = explainAaveRevert(error);
    if (explained.known) return { ok: false, code: explained.code, message: String(error?.message || error || explained.code).slice(0, 200) };
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
 * §15 — enable or disable a supplied asset as collateral.
 *
 * This is the ONLY write on the page that can make an otherwise-healthy
 * position liquidatable in a single transaction, so the caller MUST run
 * `assertCollateralChangeSafe` first and refuse when the user has debt that
 * depends on this collateral. The protocol enforces it too (it reverts with
 * HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD), but a user should never
 * have to pay gas to learn that.
 */
export async function setCollateralUsage({ signer, chainId, asset, useAsCollateral }) {
  const venue = lendingVenue(chainId);
  if (!venue) return failure('UNSUPPORTED_CHAIN', 'no pool');
  if (!signer) return failure('WALLET_NOT_CONNECTED', 'no signer');
  if (!isAddress(asset?.address)) return failure('NOT_A_RESERVE', 'no asset');
  const { Contract } = await loadEthers();
  const pool = new Contract(venue.pool, AAVE_POOL_ABI, signer);
  return wrap('collateral', () => pool.setUserUseReserveAsCollateral(asset.address, Boolean(useAsCollateral)));
}

/**
 * §15 — may this collateral be turned OFF?
 *
 * Pure and conservative: it answers from the account the pool already
 * reported plus the USD value of the collateral being removed. Turning
 * collateral off shrinks `totalCollateralUsd`, and the health factor is
 * `collateral × liquidationThreshold / debt` — so if the position has any
 * debt at all, removing collateral moves the health factor DOWN.
 *
 * The rule is not "does the pool allow it" but "would the user still be above
 * the liquidation threshold afterwards":
 *   · no debt at all                       → always safe
 *   · resulting health factor < 1          → REFUSE (would be liquidatable)
 *   · resulting health factor < minSafe    → REFUSE with the number shown
 *   · any input unknown                    → REFUSE. An unverifiable answer is
 *     not a permission (§21's rule applied to a write).
 */
export function assertCollateralChangeSafe({
  account,
  removeCollateralUsd = 0,
  minSafeHealthFactor = 1.05
} = {}) {
  if (!account?.ok) {
    return { ok: false, code: 'RISK_DATA_UNAVAILABLE', reason: 'the account could not be read from the pool' };
  }
  const debt = Number(account.totalDebtUsd ?? 0);
  const collateral = Number(account.totalCollateralUsd ?? 0);
  const threshold = Number(account.liquidationThresholdPct ?? NaN);

  /* No debt means no liquidation risk, whatever the collateral is doing. */
  if (!Number.isFinite(debt) || debt <= 0) {
    return { ok: true, healthFactorAfter: null, reason: 'no open debt — collateral is not backing anything' };
  }
  if (!Number.isFinite(collateral) || !Number.isFinite(threshold) || threshold <= 0) {
    return { ok: false, code: 'RISK_DATA_UNAVAILABLE', reason: 'collateral value or liquidation threshold is unknown' };
  }
  const removed = Number(removeCollateralUsd) || 0;
  if (!Number.isFinite(removed) || removed < 0) {
    return { ok: false, code: 'RISK_DATA_UNAVAILABLE', reason: 'the collateral value could not be priced' };
  }
  const remaining = Math.max(0, collateral - removed);
  const healthFactorAfter = remaining <= 0 ? 0 : (remaining * (threshold / 100)) / debt;
  if (healthFactorAfter < 1) {
    return {
      ok: false, code: 'HEALTH_FACTOR_TOO_LOW', healthFactorAfter,
      reason: 'disabling this collateral would leave the position liquidatable'
    };
  }
  if (healthFactorAfter < Number(minSafeHealthFactor)) {
    return {
      ok: false, code: 'HEALTH_FACTOR_TOO_LOW', healthFactorAfter,
      reason: `disabling this collateral would drop the health factor below ${minSafeHealthFactor}`
    };
  }
  return { ok: true, healthFactorAfter, reason: null };
}

/**
 * Run a built plan step by step against the wallet. Stops at the first
 * failure and reports exactly which step stopped it — a half-finished plan is
 * reported as half-finished, never as a success.
 *
 * Each step may carry its own `asset` (the borrow plan's collateral leg is a
 * DIFFERENT token from the borrow leg — §11). A step without one uses the
 * plan's asset, which keeps every existing caller working unchanged.
 */
export async function runLendingPlan({ steps, signer, chainId, asset, account, onStep }) {
  const done = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    onStep?.({ ...step, state: 'running' });
    const stepAsset = isAddress(step?.asset?.address) ? step.asset : asset;
    let result;
    if (step.id === 'approve') result = await approveForPool({ signer, chainId, asset: stepAsset, amountWei: step.amountWei });
    else if (step.id === 'supply') result = await supplyToPool({ signer, chainId, asset: stepAsset, amountWei: step.amountWei, onBehalfOf: account });
    else if (step.id === 'borrow') result = await borrowFromPool({ signer, chainId, asset: stepAsset, amountWei: step.amountWei, onBehalfOf: account });
    else if (step.id === 'repay') result = await repayToPool({ signer, chainId, asset: stepAsset, amountWei: step.amountWei, onBehalfOf: account });
    else if (step.id === 'withdraw') result = await withdrawFromPool({ signer, chainId, asset: stepAsset, amountWei: step.amountWei, to: account });
    else if (step.id === 'collateral') result = await setCollateralUsage({ signer, chainId, asset: stepAsset, useAsCollateral: Boolean(step.useAsCollateral) });
    else result = failure('UNKNOWN_STEP', step.id);

    if (!result.ok || result.status === 'reverted') {
      onStep?.({ ...step, state: 'failed', code: result.code || 'REVERTED', hash: result.hash || null });
      return { ok: false, completed: done, failedStep: step.id, code: result.code || 'REVERTED', message: result.message || null, hash: result.hash || null };
    }
    onStep?.({ ...step, state: 'done', hash: result.hash });
    done.push({ id: step.id, hash: result.hash, asset: stepAsset?.symbol ?? null });
  }
  return { ok: true, completed: done };
}
