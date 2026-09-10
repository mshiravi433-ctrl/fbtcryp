/**
 * COMPOUND V3 (COMET) · BASE (8453) · USDC ONLY — the app's SECOND in-app DeFi
 * execution adapter. Supply, withdraw, read the position. Nothing else.
 * ---------------------------------------------------------------------------
 * ─── SCOPE, DELIBERATELY TINY (same rule as the Aave adapter) ───────────────
 * One protocol (Compound III / Comet), one chain (Base 8453), one asset (the
 * market's BASE token, USDC), two write actions (`supply`, `withdraw`). There
 * is no collateral supply, no borrow, no absorb, no buyCollateral, no
 * `allow()` manager grant and no second market here. Each of those is its own
 * risk surface and would need its own review; adding them to this file is how
 * a money-moving adapter quietly becomes a general-purpose one.
 *
 * ─── ADDRESS PROVENANCE ─────────────────────────────────────────────────────
 * The three Comet addresses below are pinned in THIS FILE AND NOWHERE ELSE (a
 * wiring pin in test/wiring.mjs greps src/ to prove it). They are copied from
 * Compound's own deployment manifest, which is the canonical,
 * governance-maintained record of deployed Comet markets:
 *
 *   https://github.com/compound-finance/comet  →  deployments/base/usdc/roots.json
 *   (rendered at https://docs.compound.finance/#protocol-contracts)
 *
 *   COMET (cUSDCv3 proxy) = 0xb125E6687d4313864e53df431d5425969c15Eb2F
 *   CONFIGURATOR          = 0x45939657d1CA34A8FA39A924B71D28Fe8431e581
 *   REWARDS               = 0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1
 *
 * USDC is NOT typed here — not even in this comment. It is read from the
 * existing token table in `src/lib/chains.js` (chain 8453, decimals 6) so there
 * is exactly one USDC address in the repo. `verifyDeployment` re-asserts the
 * link at runtime by comparing `Comet.baseToken()` — and the Configurator's
 * stored configuration — to that address.
 *
 * Pinned constants are never trusted on their own. Before any write is allowed
 * `verifyDeployment()` proves, against the live chain, that the pinned Comet
 * really is a USDC market with 6 decimals, and cross-checks it against the
 * Configurator's own record. A mismatch throws — the adapter would rather be
 * unusable than move value against a contract it did not verify.
 *
 * ─── HOW COMET DIFFERS FROM AAVE, AND WHY THAT CHANGES THE CODE ─────────────
 * These are not cosmetic differences; each one is a place where copying the
 * Aave adapter verbatim would have produced a confident wrong answer:
 *
 *   1. THERE IS NO aTOKEN. Comet itself is the balance-bearing contract:
 *      `Comet.balanceOf(owner)` is the present-value base supply (principal ×
 *      the accrued supply index) and it already includes earned interest.
 *      There is no separate receipt token to read.
 *   2. THERE IS NO SUPPLY CAP ON THE BASE ASSET. Comet's `supplyCap` lives in
 *      `AssetInfo`, i.e. on COLLATERAL assets only (`SupplyCapExceeded()` is
 *      raised in `supplyCollateral`, never in `supplyBase` — verified in
 *      Comet.sol). So this adapter reports `supplyCapUsdc: null` with
 *      `hasSupplyCap: false` instead of inventing a limit that does not exist.
 *   3. THERE IS NO "FROZEN"/"ACTIVE" RESERVE BITMAP. Comet has a five-bit
 *      pause flag word read through `isSupplyPaused()` / `isWithdrawPaused()`.
 *   4. RATES ARE PER-SECOND, NOT RAY-PER-YEAR. `getSupplyRate(utilization)`
 *      returns a per-second rate scaled by 1e18. Compound's own documentation
 *      computes `APR = rate / 1e18 * secondsPerYear * 100`; the compounded APY
 *      is derived separately here and BOTH are reported, labelled, so the card
 *      cannot silently show one while calling it the other.
 *   5. WITHDRAWING MORE THAN YOU SUPPLIED IS A BORROW, NOT AN ERROR.
 *      `withdrawBase` lets the balance go negative and only then checks
 *      collateralisation (Comet.sol: `if (srcBalance < 0) { ... }`). A wallet
 *      that happens to hold collateral in this same Comet would therefore have
 *      an over-withdraw silently OPEN A DEBT. This adapter refuses that: an
 *      explicit amount above the live position is blocked
 *      (`COMPOUND_WITHDRAW_EXCEEDS_POSITION`), and 'max' is sent as
 *      MaxUint256, which Comet resolves to exactly `balanceOf(src)`.
 *   6. SUPPLYING WHILE IN DEBT REPAYS THE DEBT. `supplyBase` nets against a
 *      negative principal. Someone with an open borrow who presses "supply to
 *      earn" would be repaying, not earning, so that case is blocked
 *      (`COMPOUND_EXISTING_BORROW`) rather than silently reinterpreted.
 *   7. REWARDS HAVE A FLOOR. `baseMinForRewards` on this market is 1 000 USDC:
 *      a position below it accrues NO COMP at all. The caps this app ships are
 *      lower than that floor, so the UI states it instead of implying a reward
 *      that cannot be earned. No claim path is built — see the doc.
 *
 * ─── SAFETY PROPERTIES THIS FILE MUST KEEP ──────────────────────────────────
 *   · Approvals are for EXACTLY the amount being supplied. Never an unbounded
 *     allowance: a standing infinite approval on Comet would let a compromised
 *     market move the rest of the wallet's USDC later.
 *   · Only `supply(asset, amount)` and `withdraw(asset, amount)` are ever
 *     encoded — the `*To` / `*From` variants, which can credit or debit a
 *     THIRD PARTY, are not in the ABI this file declares. The caller is always
 *     the beneficiary because Comet's own two-argument entry points make
 *     msg.sender the beneficiary; there is no recipient parameter to get wrong.
 *   · Every unsigned step goes through lib/preSignSimulation.js before the
 *     user is asked to sign. This module builds and checks; it never signs.
 *   · Reads fail closed. An unverifiable market, a missing provider or a
 *     failed read is a thrown typed error, never a plausible default.
 */

import { EVM_CHAINS, ERC20_ABI, getToken } from '../chains';
import { NATIVE_GAS_FLOOR } from '../swap';
import { decodeRevertReason } from '../preSignSimulation';
import {
  assertProviderChain, assertSuccessfulReceipt, parseReceiptLogs, ExecutionGuardError, sameAddress
} from './executionGuards';
import { verifyRoutedDeposit } from './splitRouter.js';
const loadEthers = () => import('ethers');

const isAddr = (v) => typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Comet's own constants, copied from contracts/CometCore.sol. */
const FACTOR_SCALE = 10n ** 18n;
const SECONDS_PER_YEAR = 31_536_000;
/** Comet quotes every price with 8 decimals (`PRICE_FEED_DECIMALS = 8`). */
const PRICE_SCALE = 10n ** 8n;

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * USDC on Base, read from the chain/token registry — the single source of
 * truth for token addresses in this app. If USDC is ever delisted there this
 * module throws at import time instead of transacting against a stale address.
 */
const USDC_ON_BASE = getToken(8453, 'USDC');
if (!USDC_ON_BASE || !isAddr(USDC_ON_BASE.address)) {
  throw new Error('COMPOUND_ADAPTER_MISSING_USDC_ON_BASE');
}

export const COMPOUND_V3_BASE = Object.freeze({
  chainId: 8453,
  /** cUSDCv3 (Comet proxy) on Base. Source: comet deployments/base/usdc/roots.json */
  comet: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
  /** Configurator proxy, holds the governance-set market configuration. Same source. */
  configurator: '0x45939657d1CA34A8FA39A924B71D28Fe8431e581',
  /** CometRewards — read only here; no claim path is built. Same source. */
  rewards: '0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1',
  /** Imported from lib/chains.js (TOKENS[8453]), NOT retyped here. */
  usdc: USDC_ON_BASE.address,
  usdcDecimals: USDC_ON_BASE.decimals,
  usdcSymbol: USDC_ON_BASE.symbol,
  /** What Comet calls itself; asserted at runtime, never assumed. */
  marketSymbol: 'cUSDCv3',
  explorer: EVM_CHAINS[8453].explorer
});

/* -------------------------------------------------------------------------- */
/* ABIs — only what this adapter actually calls                                */
/* -------------------------------------------------------------------------- */
/*
 * Deliberately NOT declared, so they cannot be encoded by accident:
 *   supplyTo / supplyFrom / withdrawTo / withdrawFrom  — third-party transfers
 *   transfer / transferAsset / allow / allowBySig      — delegation
 *   absorb / buyCollateral / withdrawReserves          — liquidation & governance
 */
const COMET_ABI = [
  // The two write actions. msg.sender is both payer and beneficiary.
  'function supply(address asset, uint256 amount)',
  'function withdraw(address asset, uint256 amount)',
  // Position and market reads.
  'function balanceOf(address owner) view returns (uint256)',
  'function borrowBalanceOf(address account) view returns (uint256)',
  'function collateralBalanceOf(address account, address asset) view returns (uint128)',
  'function baseToken() view returns (address)',
  'function baseTokenPriceFeed() view returns (address)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function totalBorrow() view returns (uint256)',
  'function getUtilization() view returns (uint256)',
  'function getSupplyRate(uint256 utilization) view returns (uint64)',
  'function getBorrowRate(uint256 utilization) view returns (uint64)',
  'function getPrice(address priceFeed) view returns (uint256)',
  'function isSupplyPaused() view returns (bool)',
  'function isWithdrawPaused() view returns (bool)',
  'function baseMinForRewards() view returns (uint256)',
  'function baseTrackingSupplySpeed() view returns (uint256)'
];

/**
 * Only the one getter this adapter uses. `getConfiguration` returns the whole
 * governance-set Configuration struct; we read `baseToken` out of it as an
 * INDEPENDENT confirmation that the pinned Comet is the USDC market.
 */
const CONFIGURATOR_ABI = [
  'function getConfiguration(address cometProxy) view returns (tuple(address governor, address pauseGuardian, address baseToken, address baseTokenPriceFeed, address extensionDelegate, uint64 supplyKink, uint64 supplyPerYearInterestRateSlopeLow, uint64 supplyPerYearInterestRateSlopeHigh, uint64 supplyPerYearInterestRateBase, uint64 borrowKink, uint64 borrowPerYearInterestRateSlopeLow, uint64 borrowPerYearInterestRateSlopeHigh, uint64 borrowPerYearInterestRateBase, uint64 storeFrontPriceFactor, uint64 trackingIndexScale, uint64 baseTrackingSupplySpeed, uint64 baseTrackingBorrowSpeed, uint104 baseMinForRewards, uint104 baseBorrowMin, uint104 targetReserves, tuple(address asset, address priceFeed, uint8 decimals, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap)[] assetConfigs))'
];

/**
 * `getRewardOwed` is NOT a view function in Comet's rewards contract — it
 * calls `accrueAccount` first — so it is read with an explicit eth_call
 * instead of a contract read, and the result is decoded by hand. Nothing here
 * ever sends it as a transaction.
 */
const REWARDS_ABI = [
  'function getRewardOwed(address comet, address account) returns (tuple(address token, uint256 owed))',
  'function rewardConfig(address comet) view returns (address token, uint64 rescaleFactor, bool shouldUpscale)'
];

const COMET_EVENT_ABI = [
  'event Supply(address indexed from, address indexed dst, address indexed asset, uint256 amount)',
  'event Withdraw(address indexed src, address indexed to, address indexed asset, uint256 amount)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

/**
 * Typed error. `code` is a stable machine code; the UI maps it to an i18n key,
 * so a raw stack never reaches a user.
 */
export class CompoundAdapterError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.name = 'CompoundAdapterError';
    this.code = code;
    this.detail = detail;
  }
}

/* -------------------------------------------------------------------------- */
/* Units and rate maths                                                        */
/* -------------------------------------------------------------------------- */

const toUsdcWei = (amountUsdc) => {
  const s = String(amountUsdc ?? '').trim();
  if (!/^\d*\.?\d+$/.test(s)) throw new CompoundAdapterError('COMPOUND_BAD_AMOUNT', { amountUsdc });
  return toUnits(s, COMPOUND_V3_BASE.usdcDecimals);
};

/** parseUnits without a hard ethers dependency at import time. */
function toUnits(value, decimals) {
  const [whole = '0', fracRaw = ''] = String(value).split('.');
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
  const w = whole.replace(/^0+(?=\d)/, '') || '0';
  return BigInt(w + frac);
}

/** Format a 6-dp integer as a plain decimal string (no exponent, no rounding). */
export function fromUsdcWei(wei, decimals = COMPOUND_V3_BASE.usdcDecimals) {
  const v = typeof wei === 'bigint' ? wei : BigInt(String(wei));
  const neg = v < 0n;
  const abs = (neg ? -v : v).toString().padStart(decimals + 1, '0');
  const out = `${abs.slice(0, abs.length - decimals)}.${abs.slice(abs.length - decimals)}`;
  return (neg ? '-' : '') + out;
}

/**
 * Per-second rate (1e18-scaled) → simple APR percent.
 *
 * This is EXACTLY Compound's own documented formula
 * (`Supply APR = getSupplyRate(getUtilization()) / 1e18 * secondsPerYear * 100`),
 * kept as its own function so the number the app prints can be compared with
 * Compound's interface line for line. It is NOT compounded.
 */
export function perSecondRateToAprPct(ratePerSecond) {
  const r = typeof ratePerSecond === 'bigint' ? ratePerSecond : BigInt(String(ratePerSecond ?? 0));
  if (r < 0n) return 0;
  /*
   * Converted to a float BEFORE the divide, not after. Doing the division in
   * bigint first (`r * seconds / 1e18`) truncates: a realistic Base rate of
   * ~1.5e9 per second is only 0.047 in 1e18 terms, so integer division would
   * floor the whole APR to zero. Number() on a value below 1e18 keeps ~15
   * significant digits, which is far more than a percentage needs.
   */
  return (Number(r) / Number(FACTOR_SCALE)) * SECONDS_PER_YEAR * 100;
}

/**
 * Per-second rate (1e18-scaled) → COMPOUNDED APY percent.
 *
 * Comet accrues per second on the base index, so the realised return over a
 * year is `(1 + r)^secondsPerYear − 1`, not `r × secondsPerYear`. At today's
 * rates the two differ by a few tenths of a percent — small, but it is the
 * difference between a number that matches reality and one that does not, and
 * the Aave card next to this one shows a genuinely compounded figure.
 * `log1p`/`expm1` keep the precision at r ≈ 1e-9, where `(1+r)**n` in plain
 * floating point loses most of it.
 */
export function perSecondRateToApyPct(ratePerSecond) {
  const r = typeof ratePerSecond === 'bigint' ? ratePerSecond : BigInt(String(ratePerSecond ?? 0));
  if (r <= 0n) return 0;
  const perSecond = Number(r) / 1e18;
  return Math.expm1(SECONDS_PER_YEAR * Math.log1p(perSecond)) * 100;
}

/* -------------------------------------------------------------------------- */
/* Contract handles                                                            */
/* -------------------------------------------------------------------------- */

async function contracts(provider) {
  const { Contract } = await loadEthers();
  return {
    Contract,
    provider,
    comet: new Contract(COMPOUND_V3_BASE.comet, COMET_ABI, provider),
    configurator: new Contract(COMPOUND_V3_BASE.configurator, CONFIGURATOR_ABI, provider),
    usdc: new Contract(COMPOUND_V3_BASE.usdc, ERC20_ABI, provider)
  };
}

/* -------------------------------------------------------------------------- */
/* 1. Deployment verification                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Per-session verification cache, keyed by the PROVIDER OBJECT (WeakMap), so a
 * new RPC — which in this app always means a new provider instance from
 * WalletContext.getReadProvider — invalidates it automatically. Nothing is
 * cached on failure: a failed verification must be retried, not remembered.
 */
const verifiedByProvider = new WeakMap();

/**
 * Prove we are talking to the Comet market we pinned, and nothing else.
 *
 * Comet has no PoolAddressesProvider, so the equivalent of Aave's
 * registry check is built from two INDEPENDENT sources:
 *
 *   1. The market describes itself: `baseToken()` must be the USDC address
 *      from lib/chains.js and `decimals()` must be 6. This is the check that
 *      catches "the pin points at the WETH market" and it cannot be skipped.
 *   2. The Configurator — a separate contract, written only by governance —
 *      must hold the same baseToken for this proxy. If the Configurator read
 *      fails (an upgraded ABI, a busy RPC), verification still SUCCEEDS on
 *      check 1 alone but records `verifiedVia: 'comet.self-report'`, so a
 *      reviewer can see the cross-check did not run. A DISAGREEMENT between
 *      the two, on the other hand, always throws.
 *
 * Resolves with an evidence object; throws CompoundAdapterError on mismatch.
 */
export async function verifyDeployment(provider, { force = false } = {}) {
  if (!provider) throw new CompoundAdapterError('COMPOUND_NO_PROVIDER');
  try {
    await assertProviderChain(provider, COMPOUND_V3_BASE.chainId);
  } catch (err) {
    if (err?.code === 'EXECUTION_WRONG_CHAIN') {
      throw new CompoundAdapterError('COMPOUND_WRONG_CHAIN', err.detail);
    }
    if (err instanceof ExecutionGuardError) {
      throw new CompoundAdapterError('COMPOUND_NETWORK_UNREADABLE', err.detail);
    }
    throw err;
  }
  if (!force && verifiedByProvider.has(provider)) return verifiedByProvider.get(provider);

  const c = await contracts(provider);

  // 1. The market must say it is a USDC market with 6 decimals.
  let baseToken;
  let decimals;
  try {
    [baseToken, decimals] = await Promise.all([c.comet.baseToken(), c.comet.decimals()]);
  } catch (err) {
    throw new CompoundAdapterError('COMPOUND_DEPLOYMENT_UNVERIFIABLE', { reason: decodeRevertReason(err) });
  }
  if (String(baseToken).toLowerCase() !== COMPOUND_V3_BASE.usdc.toLowerCase()) {
    throw new CompoundAdapterError('COMPOUND_BASE_TOKEN_MISMATCH', {
      expected: COMPOUND_V3_BASE.usdc, found: baseToken
    });
  }
  if (Number(decimals) !== COMPOUND_V3_BASE.usdcDecimals) {
    throw new CompoundAdapterError('COMPOUND_DECIMALS_MISMATCH', {
      expected: COMPOUND_V3_BASE.usdcDecimals, found: Number(decimals)
    });
  }

  // 2. Cross-check against the Configurator's governance record.
  let verifiedVia = 'comet.baseToken+configurator';
  try {
    const cfg = await c.configurator.getConfiguration(COMPOUND_V3_BASE.comet);
    const cfgBase = String(cfg?.baseToken ?? cfg?.[2] ?? '');
    if (!isAddr(cfgBase) || cfgBase.toLowerCase() === ZERO_ADDRESS) {
      verifiedVia = 'comet.self-report';
    } else if (cfgBase.toLowerCase() !== COMPOUND_V3_BASE.usdc.toLowerCase()) {
      throw new CompoundAdapterError('COMPOUND_CONFIGURATOR_MISMATCH', {
        expected: COMPOUND_V3_BASE.usdc, found: cfgBase
      });
    }
  } catch (err) {
    if (err instanceof CompoundAdapterError) throw err;
    verifiedVia = 'comet.self-report';
  }

  // The market symbol is informative, never load-bearing: it is read through
  // the extension delegate and a busy RPC must not block a withdrawal.
  let marketSymbol = null;
  try {
    marketSymbol = String(await c.comet.symbol());
  } catch {
    marketSymbol = null;
  }

  // Cheap extra guard: the chain must actually be Base.
  let chainId = null;
  try {
    const net = await provider.getNetwork();
    chainId = Number(net?.chainId ?? net?.id ?? 0) || null;
  } catch {
    chainId = null;
  }
  if (chainId != null && chainId !== COMPOUND_V3_BASE.chainId) {
    throw new CompoundAdapterError('COMPOUND_WRONG_CHAIN', {
      expected: COMPOUND_V3_BASE.chainId, found: chainId
    });
  }

  const evidence = Object.freeze({
    schema: 'fbt.compound-base.verification.v1',
    ok: true,
    comet: COMPOUND_V3_BASE.comet,
    configurator: COMPOUND_V3_BASE.configurator,
    usdc: COMPOUND_V3_BASE.usdc,
    decimals: Number(decimals),
    marketSymbol,
    verifiedVia,
    chainId,
    verifiedAt: Date.now()
  });

  // Cache only a SUCCESSFUL verification.
  verifiedByProvider.set(provider, evidence);
  return evidence;
}

/* -------------------------------------------------------------------------- */
/* 2. Market status                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Live market state, used to refuse a supply the protocol would reject and to
 * show an honest rate.
 *
 * `supplyCapUsdc` is ALWAYS null and `hasSupplyCap` is ALWAYS false: Comet
 * enforces supply caps on collateral assets only (`supplyCollateral` raises
 * `SupplyCapExceeded()`; `supplyBase` has no cap check at all). Reporting a
 * cap here — even `0n` — would be inventing a protocol limit that does not
 * exist, so the field is present, null, and explained.
 */
export async function getMarketStatus(provider) {
  const deployment = await verifyDeployment(provider);
  const c = await contracts(provider);

  let utilization;
  let supplyRate;
  let supplyPaused;
  let withdrawPaused;
  try {
    [utilization, supplyPaused, withdrawPaused] = await Promise.all([
      c.comet.getUtilization(),
      c.comet.isSupplyPaused(),
      c.comet.isWithdrawPaused()
    ]);
    supplyRate = await c.comet.getSupplyRate(utilization);
  } catch (err) {
    throw new CompoundAdapterError('COMPOUND_MARKET_UNREADABLE', { reason: decodeRevertReason(err) });
  }

  /* Best-effort extras: an honest null beats a fabricated 0. */
  const soft = async (fn) => { try { return await fn(); } catch { return null; } };
  const [totalSupply, totalBorrow, minForRewards, supplySpeed] = await Promise.all([
    soft(() => c.comet.totalSupply()),
    soft(() => c.comet.totalBorrow()),
    soft(() => c.comet.baseMinForRewards()),
    soft(() => c.comet.baseTrackingSupplySpeed())
  ]);

  const rate = typeof supplyRate === 'bigint' ? supplyRate : BigInt(String(supplyRate));
  return {
    supplyPaused: Boolean(supplyPaused),
    withdrawPaused: Boolean(withdrawPaused),
    utilizationPct: Number((BigInt(String(utilization)) * 1000000n) / FACTOR_SCALE) / 10000,
    supplyRatePerSecond: rate,
    /** Compound's own documented figure — simple, not compounded. */
    supplyAprPct: perSecondRateToAprPct(rate),
    /** The compounded equivalent, which is what "APY" means on the Aave card. */
    supplyApyPct: perSecondRateToApyPct(rate),
    /** Comet has NO supply cap on the base asset. Stated, not guessed. */
    hasSupplyCap: false,
    supplyCapUsdc: null,
    totalSupplyUsdc: totalSupply == null ? null : BigInt(String(totalSupply)),
    totalBorrowUsdc: totalBorrow == null ? null : BigInt(String(totalBorrow)),
    /** Positions below this earn NO COMP at all (1 000 USDC on this market). */
    rewardsMinUsdc: minForRewards == null ? null : BigInt(String(minForRewards)),
    rewardsActive: supplySpeed == null ? null : BigInt(String(supplySpeed)) > 0n,
    decimals: deployment.decimals,
    verifiedVia: deployment.verifiedVia,
    readAt: Date.now()
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Position                                                                 */
/* -------------------------------------------------------------------------- */

/** USD price of the base asset with 8 decimals, per Comet's own feed. */
async function baseAssetPriceUsd8(c) {
  try {
    const feed = await c.comet.baseTokenPriceFeed();
    if (!isAddr(feed) || feed.toLowerCase() === ZERO_ADDRESS) return null;
    const price = await c.comet.getPrice(feed);
    return typeof price === 'bigint' ? price : BigInt(String(price));
  } catch {
    return null;
  }
}

/**
 * COMP owed to this account for this market, read WITHOUT sending anything.
 *
 * `CometRewards.getRewardOwed` is state-changing in Solidity (it accrues
 * first), so it is executed as an eth_call and decoded by hand. Any failure
 * returns null — a reward figure is never guessed, and a rewards contract that
 * has been reconfigured must not be able to block a withdrawal.
 */
export async function getRewardsOwed(provider, owner) {
  if (!isAddr(owner)) return null;
  try {
    const { Interface } = await loadEthers();
    const iface = new Interface(REWARDS_ABI);
    const data = iface.encodeFunctionData('getRewardOwed', [COMPOUND_V3_BASE.comet, owner]);
    const out = await provider.call({ to: COMPOUND_V3_BASE.rewards, data });
    const [row] = iface.decodeFunctionResult('getRewardOwed', out);
    const token = String(row?.token ?? row?.[0] ?? '');
    const owed = BigInt(String(row?.owed ?? row?.[1] ?? 0));
    if (!isAddr(token) || token.toLowerCase() === ZERO_ADDRESS) return null;
    return { token, owed };
  } catch {
    return null;
  }
}

/**
 * The connected wallet's Compound III USDC position.
 *
 * `suppliedUsdc` is `Comet.balanceOf(owner)`, which is the PRESENT VALUE of
 * the base supply: principal projected forward by the accrued supply index. It
 * already includes interest earned, exactly like an aToken balance.
 *
 * `accruedSinceUsdc` is explicitly best-effort: it is derived from the LOCAL
 * supply/withdraw records (see compoundV3History.js), not from the chain,
 * because the index at the moment of each past supply is not stored. When the
 * local records cannot account for the position it returns null and the UI
 * renders "—". It is never estimated from the APY.
 */
export async function getPosition(provider, owner, { history = null } = {}) {
  if (!isAddr(owner)) throw new CompoundAdapterError('COMPOUND_BAD_OWNER', { owner });
  await verifyDeployment(provider);
  const c = await contracts(provider);

  const [balance, borrowBalance, priceUsd8, rewards] = await Promise.all([
    c.comet.balanceOf(owner),
    c.comet.borrowBalanceOf(owner).catch(() => null),
    baseAssetPriceUsd8(c),
    getRewardsOwed(provider, owner)
  ]);

  const suppliedUsdc = typeof balance === 'bigint' ? balance : BigInt(String(balance ?? 0));
  const borrowedUsdc = borrowBalance == null ? null : BigInt(String(borrowBalance));

  return {
    suppliedUsdc,
    suppliedUsd: priceUsd8 == null
      ? null
      : Number(suppliedUsdc * priceUsd8) / 10 ** COMPOUND_V3_BASE.usdcDecimals / Number(PRICE_SCALE),
    /*
     * Comet is one contract for supply AND borrow, so a debt opened elsewhere
     * shows up here. It is surfaced rather than hidden: it changes what a
     * "supply" would do (it would repay) and what a withdraw could do.
     */
    borrowedUsdc,
    hasBorrow: borrowedUsdc != null && borrowedUsdc > 0n,
    rewardsOwed: rewards?.owed ?? null,
    rewardsToken: rewards?.token ?? null,
    accruedSinceUsdc: accruedSince(history, owner, suppliedUsdc),
    readAt: Date.now()
  };
}

/**
 * supplied − net principal from local records. Returns null (not 0) whenever
 * the records cannot fully account for the position.
 */
function accruedSince(history, owner, suppliedUsdc) {
  const rows = Array.isArray(history) ? history : [];
  if (rows.length === 0) return null;
  const mine = rows.filter(
    (r) => r?.status === 'confirmed' && String(r?.owner ?? '').toLowerCase() === String(owner).toLowerCase()
  );
  if (mine.length === 0) return null;
  let principal = 0n;
  for (const r of mine) {
    const amt = BigInt(String(r.amountUsdcWei ?? 0));
    if (r.action === 'supply') principal += amt;
    else if (r.action === 'withdraw') principal -= amt;
  }
  if (principal <= 0n) return null;
  // If the chain shows less than our records claim, the records are wrong —
  // report nothing rather than a negative "accrual".
  if (suppliedUsdc < principal) return null;
  return suppliedUsdc - principal;
}

/* -------------------------------------------------------------------------- */
/* 4. Supply plan                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Ordered unsigned steps for a supply, plus the checks that produced them.
 *
 * Steps are `{ kind, to, data, value: 0n, description }` and are meant to be
 * handed to lib/preSignSimulation.js one at a time. This function NEVER signs
 * and NEVER returns a step whose checks failed — a failed check yields
 * `{ steps: [], checks }` so the caller cannot accidentally sign a plan that
 * was refused.
 */
export async function buildSupplyPlan({ provider, owner, amountUsdc, history = null, nativeBalance = null }) {
  if (!isAddr(owner)) throw new CompoundAdapterError('COMPOUND_BAD_OWNER', { owner });
  const deployment = await verifyDeployment(provider);
  const c = await contracts(provider);
  const { Interface } = await loadEthers();

  const checks = {
    schema: 'fbt.compound-base.supply-checks.v1',
    deploymentVerified: Boolean(deployment?.ok),
    supplyNotPaused: null,
    noExistingBorrow: null,
    balanceSufficient: null,
    nativeGasFloorOk: null,
    blocked: [],
    amountUsdc: null,
    amountWei: null,
    balanceUsdc: null,
    allowanceWei: null,
    needsApproval: null,
    /* Stated explicitly so a reviewer sees this is a protocol fact, not a gap. */
    hasSupplyCap: false,
    supplyCapUsdc: null
  };
  const block = (code) => { if (!checks.blocked.includes(code)) checks.blocked.push(code); };

  /* ── amount ─────────────────────────────────────────────────────────────── */
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

  /*
   * ── an open borrow turns "supply" into "repay" ──────────────────────────
   * Comet nets a base supply against a negative principal (Comet.sol,
   * supplyBase → repayAndSupplyAmount). Someone with a debt here pressing a
   * button labelled "supply to earn" would be repaying instead. Refuse, and
   * say so, rather than quietly redefine the action.
   */
  try {
    const debt = BigInt(String(await c.comet.borrowBalanceOf(owner) ?? 0n));
    checks.noExistingBorrow = debt === 0n;
    if (debt > 0n) block('COMPOUND_EXISTING_BORROW');
  } catch {
    checks.noExistingBorrow = null;
    block('COMPOUND_POSITION_UNREADABLE');
  }

  /* ── market state: supply paused? (there is no cap and no freeze) ───────── */
  try {
    const status = await getMarketStatus(provider);
    checks.supplyNotPaused = !status.supplyPaused;
    if (status.supplyPaused) block('COMPOUND_SUPPLY_PAUSED');
  } catch {
    checks.supplyNotPaused = null;
    block('COMPOUND_MARKET_UNREADABLE');
  }

  /* ── wallet balance ─────────────────────────────────────────────────────── */
  try {
    const bal = BigInt(String(await c.usdc.balanceOf(owner) ?? 0n));
    checks.balanceSufficient = bal >= amountWei;
    checks.balanceUsdc = bal;
    if (!checks.balanceSufficient) block('COMPOUND_INSUFFICIENT_BALANCE');
  } catch {
    checks.balanceSufficient = null;
    block('COMPOUND_BALANCE_UNREADABLE');
  }

  /* ── native gas floor (reused from the swap engine) ─────────────────────── */
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

  /* ── allowance: approve EXACTLY amountWei, or skip if already sufficient ── */
  const allowance = await c.usdc.allowance(owner, COMPOUND_V3_BASE.comet);
  checks.allowanceWei = typeof allowance === 'bigint' ? allowance : BigInt(String(allowance));
  checks.needsApproval = checks.allowanceWei < amountWei;

  const steps = [];
  const erc20 = new Interface(ERC20_ABI);
  const comet = new Interface(COMET_ABI);

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
    kind: 'supply',
    /*
     * `supply(asset, amount)` — the two-argument entry point, where Comet
     * itself sets both `from` and `dst` to msg.sender. There is no recipient
     * parameter here to get wrong, and the `supplyTo`/`supplyFrom` variants
     * that DO take one are not in this file's ABI.
     */
    data: comet.encodeFunctionData('supply', [COMPOUND_V3_BASE.usdc, amountWei]),
    to: COMPOUND_V3_BASE.comet,
    value: 0n,
    description: { key: 'farm.compound.step.supply', amount: fromUsdcWei(amountWei) }
  });

  return { steps, checks };
}

/* -------------------------------------------------------------------------- */
/* 5. Withdraw plan                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A single-step withdraw. `amountUsdc` may be `'max'`, which Comet expresses
 * as MaxUint256 — `withdrawInternal` then resolves it to exactly
 * `balanceOf(src)`, so "max" can never become a borrow.
 *
 * THE ONE CHECK THAT MATTERS HERE: an explicit amount ABOVE the live position
 * is refused. In Comet an over-withdraw does not revert for a collateralised
 * account — it opens a DEBT (Comet.sol `withdrawBase`: the balance is allowed
 * to go negative and only then is collateralisation checked). A user asking to
 * take their money out must never be handed a loan instead.
 *
 * Deliberately NOT gated by the supply caps or the allowlist: a user who
 * supplied while the flag was on must always be able to get out. Gating exits
 * is how a safety feature becomes a trap.
 */
export async function buildWithdrawPlan({ provider, owner, amountUsdc }) {
  if (!isAddr(owner)) throw new CompoundAdapterError('COMPOUND_BAD_OWNER', { owner });
  await verifyDeployment(provider);
  const c = await contracts(provider);
  const { Interface, MaxUint256 } = await loadEthers();

  const checks = {
    schema: 'fbt.compound-base.withdraw-checks.v1',
    deploymentVerified: true,
    isMax: false,
    amountWei: null,
    amountUsdc: null,
    positionUsdcWei: null,
    withinPosition: null,
    withdrawNotPaused: null,
    blocked: []
  };
  const block = (code) => { if (!checks.blocked.includes(code)) checks.blocked.push(code); };

  const isMax = String(amountUsdc).toLowerCase() === 'max';
  checks.isMax = isMax;

  let position = null;
  try {
    position = BigInt(String(await c.comet.balanceOf(owner) ?? 0n));
    checks.positionUsdcWei = position;
  } catch {
    position = null;
    block('COMPOUND_POSITION_UNREADABLE');
  }

  try {
    const paused = await c.comet.isWithdrawPaused();
    checks.withdrawNotPaused = !paused;
    if (paused) block('COMPOUND_WITHDRAW_PAUSED');
  } catch {
    checks.withdrawNotPaused = null;
    block('COMPOUND_MARKET_UNREADABLE');
  }

  let amountWei;
  if (isMax) {
    amountWei = MaxUint256;
    checks.withinPosition = true;
    if (position != null && position === 0n) block('COMPOUND_NOTHING_TO_WITHDRAW');
  } else {
    try {
      amountWei = toUsdcWei(amountUsdc);
    } catch {
      amountWei = 0n;
    }
    checks.amountUsdc = Number(amountWei) / 10 ** COMPOUND_V3_BASE.usdcDecimals;
    if (amountWei <= 0n) block('COMPOUND_INVALID_AMOUNT');
    if (position != null) {
      checks.withinPosition = amountWei <= position;
      /* Over-withdrawing is a BORROW in Comet, not an error. Refuse it. */
      if (amountWei > position) block('COMPOUND_WITHDRAW_EXCEEDS_POSITION');
    }
  }
  checks.amountWei = amountWei;

  if (checks.blocked.length > 0) return { steps: [], checks };

  const comet = new Interface(COMET_ABI);
  const step = {
    kind: 'withdraw',
    to: COMPOUND_V3_BASE.comet,
    /*
     * `withdraw(asset, amount)` — the two-argument entry point, where Comet
     * sets both `src` and `to` to msg.sender. The `withdrawTo`/`withdrawFrom`
     * variants, which can pay a third party, are not in this file's ABI.
     */
    data: comet.encodeFunctionData('withdraw', [COMPOUND_V3_BASE.usdc, amountWei]),
    value: 0n,
    description: {
      key: isMax ? 'farm.compound.step.withdrawMax' : 'farm.compound.step.withdraw',
      amount: isMax ? null : fromUsdcWei(amountWei)
    }
  };

  return { steps: [step], checks };
}

/**
 * Revoke: `approve(comet, 0)`. Used by the partial-state sheet when an approve
 * confirmed but the supply did not, so the standing allowance is never left
 * sitting on the market.
 */
export async function buildRevokePlan({ provider, owner, spender = null } = {}) {
  if (!isAddr(owner)) throw new CompoundAdapterError('COMPOUND_BAD_OWNER', { owner });
  await verifyDeployment(provider);
  const { Interface } = await loadEthers();
  const erc20 = new Interface(ERC20_ABI);
  return {
    steps: [{
      kind: 'approve',
      to: COMPOUND_V3_BASE.usdc,
      data: erc20.encodeFunctionData('approve', [spender ?? COMPOUND_V3_BASE.comet, 0n]),
      value: 0n,
      description: { key: 'farm.compound.step.revoke' }
    }],
    checks: { schema: 'fbt.compound-base.revoke-checks.v1', blocked: [] }
  };
}

/** Verify the mined Comet receipt and the expected balance transition. */
export async function verifyCompoundReceipt({
  provider, receipt, owner, action, amountWei, beforePositionWei = null, splitRouter = null,
  expectedSpender = null
} = {}) {
  assertSuccessfulReceipt(receipt);
  if (!isAddr(owner)) throw new CompoundAdapterError('COMPOUND_BAD_OWNER', { owner });
  const { Interface } = await loadEthers();
  const iface = new Interface(COMET_EVENT_ABI);
  const amount = amountWei == null ? null : BigInt(String(amountWei));
  const events = action === 'approve' || action === 'revoke'
    ? parseReceiptLogs(receipt, iface, COMPOUND_V3_BASE.usdc, 'Approval')
    : parseReceiptLogs(receipt, iface, COMPOUND_V3_BASE.comet, action === 'supply' ? 'Supply' : 'Withdraw');
  if (events.length === 0) {
    throw new CompoundAdapterError('COMPOUND_EXPECTED_EVENT_MISSING', { action, hash: receipt.hash ?? null });
  }
  const args = events[0].parsed.args;
  if (action === 'approve' || action === 'revoke') {
    if (!sameAddress(String(args.owner), owner)
      || !sameAddress(
        String(args.spender),
        expectedSpender ?? (splitRouter ? splitRouter.address : COMPOUND_V3_BASE.comet)
      )) {
      throw new CompoundAdapterError('COMPOUND_APPROVAL_EVENT_MISMATCH', { action });
    }
    if (action === 'approve' && amount != null && BigInt(String(args.value)) !== amount) {
      throw new CompoundAdapterError('COMPOUND_APPROVAL_AMOUNT_MISMATCH', { expected: amount, found: args.value });
    }
    if (action === 'revoke' && BigInt(String(args.value)) !== 0n) {
      throw new CompoundAdapterError('COMPOUND_REVOKE_AMOUNT_MISMATCH');
    }
    return Object.freeze({ ok: true, action, event: 'Approval', position: null });
  }
  if (splitRouter && action === 'supply') {
    /*
     * Routed through the split router. Comet credits the ROUTER with the
     * supply (its Supply event carries from = dst = router, so it can never
     * identify the owner) and the router hands the minted base balance over
     * in the same transaction. Two proofs:
     *   · the router's Routed event pins the split — user, comet, gross,
     *     quoted fee, net (the minted balance can marginally EXCEED net by
     *     Comet's own accounting, hence netAtLeast);
     *   · Comet's own Transfer event must move that balance router → OWNER.
     */
    const { routed } = await verifyRoutedDeposit({
      receipt,
      routerAddress: splitRouter.address,
      owner,
      target: COMPOUND_V3_BASE.comet,
      asset: COMPOUND_V3_BASE.usdc,
      amountIn: amount,
      feeTaken: splitRouter.feeAmount,
      netAmount: splitRouter.netAmount,
      netAtLeast: true
    });
    const transfers = parseReceiptLogs(receipt, iface, COMPOUND_V3_BASE.comet, 'Transfer');
    const credited = transfers.some(({ parsed }) =>
      sameAddress(String(parsed.args.from), splitRouter.address)
      && sameAddress(String(parsed.args.to), owner)
      && BigInt(String(parsed.args.value)) === routed.netAmount);
    if (!credited) {
      throw new CompoundAdapterError('COMPOUND_PROTOCOL_EVENT_MISMATCH', {
        action, eventAmount: routed.netAmount, expected: routed.netAmount,
        reason: 'ROUTED_BASE_NOT_TRANSFERRED_TO_OWNER'
      });
    }
    const after = await getPosition(provider, owner);
    const before = beforePositionWei == null ? null : BigInt(String(beforePositionWei));
    if (before != null && !(after.suppliedUsdc >= before + routed.netAmount)) {
      throw new CompoundAdapterError('COMPOUND_POSITION_UNCHANGED', {
        action, before, after: after.suppliedUsdc, eventAmount: routed.netAmount
      });
    }
    return Object.freeze({ ok: true, action, event: 'Supply', position: after, routed });
  }

  const eventAmount = BigInt(String(args.amount));
  const first = action === 'supply' ? args.from : args.src;
  const second = action === 'supply' ? args.dst : args.to;
  if (!sameAddress(String(first), owner) || !sameAddress(String(second), owner) ||
      (amount !== ((1n << 256n) - 1n) && amount != null && eventAmount !== amount)) {
    throw new CompoundAdapterError('COMPOUND_PROTOCOL_EVENT_MISMATCH', { action, eventAmount, expected: amount });
  }
  const after = await getPosition(provider, owner);
  const before = beforePositionWei == null ? null : BigInt(String(beforePositionWei));
  if (before != null) {
    const changed = action === 'supply' ? after.suppliedUsdc >= before + eventAmount : after.suppliedUsdc < before;
    if (!changed) throw new CompoundAdapterError('COMPOUND_POSITION_UNCHANGED', { action, before, after: after.suppliedUsdc });
  }
  return Object.freeze({ ok: true, action, event: action === 'supply' ? 'Supply' : 'Withdraw', position: after });
}

/* -------------------------------------------------------------------------- */
/* 6. Revert explanation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Comet revert selectors → i18n keys.
 *
 * Compound III never used numeric string codes: every failure has been a
 * no-argument CUSTOM ERROR since the first deployment (contracts/
 * CometMainInterface.sol and CometExtInterface.sol declare them all), so the
 * revert payload is only ever a 4-byte selector. That is the opposite of
 * Aave, which changed eras mid-life and therefore needs two tables — one more
 * reason this adapter is its own file instead of a parameter on that one.
 *
 * Only the errors reachable from the supply / withdraw / allowance paths are
 * mapped; anything else falls through to `decodeRevertReason`, so an unmapped
 * error still surfaces its raw reason instead of a wrong sentence. The
 * selectors are keccak256(name + "()") and the unit suite re-derives every one
 * of them from the signature, so a mistyped byte fails the suite rather than
 * shipping a silent miss.
 */
export const COMET_ERROR_KEYS = Object.freeze({
  '0x9e87fac8': 'farm.compound.err.paused',              // Paused()
  '0x82b42900': 'farm.compound.err.unauthorized',        // Unauthorized()
  '0x14c5f7b6': 'farm.compound.err.notCollateralized',   // NotCollateralized()
  '0xe273b446': 'farm.compound.err.borrowTooSmall',      // BorrowTooSmall()
  '0x36405305': 'farm.compound.err.badAsset',            // BadAsset()
  '0x749b5939': 'farm.compound.err.badAmount',           // BadAmount()
  '0x971241a1': 'farm.compound.err.absurd',              // Absurd()
  '0xf58f733a': 'farm.compound.err.supplyCapExceeded',   // SupplyCapExceeded()
  '0x945e9268': 'farm.compound.err.insufficientReserves',// InsufficientReserves()
  '0xe7a3dfa0': 'farm.compound.err.transferInFailed',    // TransferInFailed()
  '0xcefaffeb': 'farm.compound.err.transferOutFailed',   // TransferOutFailed()
  '0x4e6d90d4': 'farm.compound.err.reentrancy',          // ReentrantCallBlocked()
  '0xe397a99b': 'farm.compound.err.noSelfTransfer',      // NoSelfTransfer()
  '0x3d32ffdb': 'farm.compound.err.timestampTooLarge'    // TimestampTooLarge()
});

/**
 * Map a failed call to something a user can read.
 *
 * @returns {{ code: string|null, key: string|null, known: boolean, reason: string|null }}
 *   `key` is an i18n key when Comet's own error was recognised, `code` is the
 *   4-byte selector that matched, and `reason` carries the decoded revert
 *   string only for unrecognised errors. Never a fabricated explanation.
 */
export function explainRevert(err) {
  const reason = decodeRevertReason(err);
  const raw =
    (typeof err?.reason === 'string' && err.reason) ||
    (typeof err?.shortMessage === 'string' && err.shortMessage) ||
    (typeof err?.message === 'string' && err.message) ||
    '';
  const rawData =
    (typeof err?.data === 'string' && err.data) ||
    (typeof err?.info?.error?.data === 'string' && err.info.error.data) ||
    '';

  for (const candidate of [rawData, raw]) {
    const sel = String(candidate).match(/0x([0-9a-fA-F]{8})/);
    if (sel) {
      const selector = `0x${sel[1].toLowerCase()}`;
      const key = COMET_ERROR_KEYS[selector];
      if (key) return { code: selector, key, known: true, reason: null };
    }
  }

  return { code: null, key: null, known: false, reason };
}

/* -------------------------------------------------------------------------- */
/* 7. Pool matching for the Farm screen                                        */
/* -------------------------------------------------------------------------- */

/**
 * Is this DefiLlama pool row exactly the one this adapter can transact?
 * The match is deliberately strict: project, chain AND a single USDC leg.
 * Anything else — another Comet market (WETH, USDbC, AERO), another chain, a
 * v2 cToken — must keep the existing "buy the token on the protocol site"
 * guidance.
 */
export function isCompoundBaseUsdcPool(pool) {
  if (!pool) return false;
  const project = String(pool.project ?? '').toLowerCase();
  const chain = String(pool.chain ?? '').toLowerCase();
  const symbol = String(pool.symbol ?? '').toUpperCase().trim();
  const single = pool.exposure === 'single' || (symbol === 'USDC' && !pool.ilRisk);
  return project === 'compound-v3' && chain === 'base' && symbol === 'USDC' && Boolean(single);
}
