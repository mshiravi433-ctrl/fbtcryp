/**
 * AAVE V3 · BASE (8453) · USDC ONLY — the app's first in-app DeFi execution
 * adapter. Supply, withdraw, read the position. Nothing else.
 * ---------------------------------------------------------------------------
 * ─── SCOPE, DELIBERATELY TINY ───────────────────────────────────────────────
 * One protocol (Aave v3 Pool), one chain (Base 8453), one asset (USDC), two
 * write actions (`supply`, `withdraw`). There is no borrow, no repay, no
 * collateral toggle, no eMode, no flash-loan call and no second asset here.
 * Every one of those is a separate risk surface and each would need its own
 * review; adding them to this file is how a money-moving adapter quietly
 * becomes a general-purpose one.
 *
 * ─── ADDRESS PROVENANCE ─────────────────────────────────────────────────────
 * The three Aave addresses below are pinned in THIS FILE AND NOWHERE ELSE (a
 * wiring pin in test/wiring.mjs greps src/ to prove it). They are copied from
 * the official Aave Address Book, which is the canonical, governance-maintained
 * source for deployed Aave contracts:
 *
 *   https://github.com/bgd-labs/aave-address-book  →  src/AaveV3Base.sol
 *   (rendered at https://aave.com/docs/resources/addresses)
 *
 *   POOL_ADDRESSES_PROVIDER = 0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D
 *   POOL                    = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
 *   USDC_A_TOKEN (aBasUSDC) = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB
 *   AAVE_PROTOCOL_DATA_PROVIDER = 0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A
 *
 * USDC is NOT typed here — not even in this comment. It is read from the
 * existing token table in `src/lib/chains.js` (chain 8453, decimals 6) so there
 * is exactly one USDC address in the repo. The address book's USDC_UNDERLYING
 * for Base is that same address, and `verifyDeployment` re-asserts the link at
 * runtime by checking the reserve's aToken against the pin.
 *
 * Pinned constants are never trusted on their own. Before any write is allowed,
 * `verifyDeployment()` calls `PoolAddressesProvider.getPool()` and compares it
 * to the pinned Pool, then reads the USDC reserve's aToken and compares it to
 * the pinned aBasUSDC. A mismatch throws — the adapter would rather be
 * unusable than move value against a contract it did not verify.
 *
 * ─── WHY NOT THE AAVE SDK ───────────────────────────────────────────────────
 * Plain ABI calls suffice for `supply`/`withdraw`/`getReserveData`, so no new
 * dependency is added. The SDK would drag in a second provider abstraction and
 * a second opinion about how to build a transaction, next to the one this repo
 * already has (lib/preSignSimulation.js + the wallet context's signer).
 *
 * ─── SAFETY PROPERTIES THIS FILE MUST KEEP ──────────────────────────────────
 *   · Approvals are for EXACTLY the amount being supplied. Never an unbounded
 *     allowance: a standing infinite approval on the Pool would let a
 *     compromised Pool move the rest of the wallet's USDC later.
 *   · `onBehalfOf` and the withdraw `to` are always the connected owner. There
 *     is no parameter anywhere that lets them differ.
 *   · Every unsigned step goes through lib/preSignSimulation.js before the
 *     user is asked to sign. This module builds and checks; it never signs.
 *   · Reads fail closed. An undecodable reserve, a missing provider or a
 *     failed verification is a thrown typed error, never a plausible default.
 */

import { EVM_CHAINS, ERC20_ABI, getToken } from '../chains';
import { AAVE_V3_POOLS } from '../lending';
import { NATIVE_GAS_FLOOR } from '../swap';
import { decodeRevertReason } from '../preSignSimulation';
import {
  AAVE_BASE_SUPPLY_MAX_USDC_PER_TX,
  AAVE_BASE_SUPPLY_MAX_USDC_TOTAL
} from '../features';

const loadEthers = () => import('ethers');

const isAddr = (v) => typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** 1e27 — Aave's RAY. Rates and the health factor are expressed in it. */
const RAY = 10n ** 27n;

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
  throw new Error('AAVE_ADAPTER_MISSING_USDC_ON_BASE');
}

export const AAVE_V3_BASE = Object.freeze({
  chainId: 8453,
  /** Aave v3 Pool proxy on Base. Source: Aave Address Book src/AaveV3Base.sol */
  pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  /** PoolAddressesProvider on Base. Source: Aave Address Book src/AaveV3Base.sol */
  addressesProvider: '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D',
  /** aBasUSDC — the receipt token for supplied USDC. Source: Aave Address Book */
  aUsdc: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB',
  /** Imported from lib/chains.js (TOKENS[8453]), NOT retyped here. */
  usdc: USDC_ON_BASE.address,
  usdcDecimals: USDC_ON_BASE.decimals,
  usdcSymbol: USDC_ON_BASE.symbol,
  /** Aave's docs: "Referral supply is currently inactive, you can pass 0." */
  referralCode: 0,
  explorer: EVM_CHAINS[8453].explorer
});

/*
 * The read-only rate table in lib/lending.js has carried the Base Pool proxy
 * since before this adapter existed (it renders lending rates on the Loan
 * screen). Two copies of one contract address is exactly how a future edit
 * ends up sending funds to the wrong one, so the adapter does not trust that
 * the two agree — it asserts it, at load, and refuses to load if they do not.
 */
if (String(AAVE_V3_POOLS?.[AAVE_V3_BASE.chainId] ?? '').toLowerCase() !== AAVE_V3_BASE.pool.toLowerCase()) {
  throw new Error('AAVE_ADAPTER_POOL_TABLE_DISAGREEMENT');
}

/* -------------------------------------------------------------------------- */
/* ABIs                                                                        */
/* -------------------------------------------------------------------------- */

const POOL_ADDRESSES_PROVIDER_ABI = [
  'function getPool() view returns (address)',
  'function getPriceOracle() view returns (address)'
];

const POOL_ABI = [
  // The two write actions. These signatures are stable across Aave v3.
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
  // Reserve bitmap: LTV / liq threshold / decimals / active / frozen / paused /
  // supply cap. The layout below is pinned to ReserveConfiguration.sol.
  'function getConfiguration(address asset) view returns (uint256)',
  // Single-value getters used for the position and health factor.
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];

const ATOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  // Independent, layout-free confirmation of the aToken↔underlying↔pool link.
  'function UNDERLYING_ASSET_ADDRESS() view returns (address)',
  'function POOL() view returns (address)'
];

const ORACLE_ABI = ['function getAssetPrice(address asset) view returns (uint256)'];

/* -------------------------------------------------------------------------- */
/* getReserveData decoding                                                     */
/* -------------------------------------------------------------------------- */
/*
 * `Pool.getReserveData(asset)` returns the whole `DataTypes.ReserveData`
 * struct, and Aave CHANGED that struct between releases: v3.3.0 removed
 * `currentStableBorrowRate` and `stableDebtTokenAddress`, so `aTokenAddress`
 * sits at a different word offset than it did in v3.0–v3.2. Declaring one
 * shape in the ABI and hoping is how an integration silently starts reading a
 * debt token address as an aToken address.
 *
 * So the candidates are declared explicitly, oldest-and-newest, and each
 * decode is validated against facts that cannot be satisfied by the wrong
 * shape: word 0 is the configuration bitmap, and its decimals field (bits
 * 48-55, per ReserveConfiguration.sol) MUST equal USDC's 6 decimals; the
 * liquidity index MUST be >= 1e27. A candidate that fails validation is
 * rejected even if it "decoded".
 *
 * Word offsets (all members are static, so ABI encoding pads each to 32 bytes):
 *
 *   v3.3+   0 configuration · 1 liquidityIndex · 2 currentLiquidityRate
 *           3 variableBorrowIndex · 4 currentVariableBorrowRate
 *           5 lastUpdateTimestamp · 6 id · 7 aTokenAddress
 *           8 variableDebtTokenAddress · … · 12 virtualUnderlyingBalance
 *
 *   v3.0-3.2 same, plus 5 currentStableBorrowRate and 9 stableDebtTokenAddress,
 *           which pushes aTokenAddress to word 8.
 *
 * Sources: aave-v3-core contracts/protocol/libraries/types/DataTypes.sol and
 * .../libraries/configuration/ReserveConfiguration.sol.
 */
export const RESERVE_DATA_SHAPES = Object.freeze([
  {
    id: 'v3.3+',
    aTokenWord: 7,
    timestampWord: 5,
    idWord: 6,
    words: 13,
    types:
      'tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address variableDebtTokenAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt, uint128 virtualUnderlyingBalance)'
  },
  {
    id: 'v3.0-v3.2',
    aTokenWord: 8,
    timestampWord: 6,
    idWord: 7,
    words: 15,
    types:
      'tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)'
  }
]);

/* ── ReserveConfiguration bitmap, bit positions pinned to the library ───────
 * aave-v3-core contracts/protocol/libraries/configuration/ReserveConfiguration.sol
 *   IS_ACTIVE_START_BIT_POSITION   = 56
 *   IS_FROZEN_START_BIT_POSITION   = 57
 *   IS_PAUSED_START_BIT_POSITION   = 60
 *   SUPPLY_CAP_START_BIT_POSITION  = 116   (36 bits, MAX_VALID_SUPPLY_CAP = 2^36-1)
 *   LIQUIDATION_THRESHOLD_START_BIT_POSITION = 16 (16 bits)
 *   LTV is bits 0-15 (no shift)
 */
export const RESERVE_CONFIG_BITS = Object.freeze({
  ltvShift: 0n,
  liquidationThresholdShift: 16n,
  decimalsShift: 48n,
  activeShift: 56n,
  frozenShift: 57n,
  pausedShift: 60n,
  supplyCapShift: 116n,
  supplyCapBits: 36n
});

const bit = (data, shift) => (data >> shift) & 1n;

/** Decode the reserve configuration bitmap into the fields this adapter uses. */
export function decodeReserveConfiguration(data) {
  const raw = typeof data === 'bigint' ? data : BigInt(String(data));
  const { ltvShift, liquidationThresholdShift, decimalsShift, activeShift, frozenShift, pausedShift, supplyCapShift, supplyCapBits } = RESERVE_CONFIG_BITS;
  return {
    raw,
    active: bit(raw, activeShift) === 1n,
    frozen: bit(raw, frozenShift) === 1n,
    paused: bit(raw, pausedShift) === 1n,
    decimals: Number((raw >> decimalsShift) & 0xffn),
    ltvBps: Number((raw >> ltvShift) & 0xffffn),
    liquidationThresholdBps: Number((raw >> liquidationThresholdShift) & 0xffffn),
    /** Whole tokens; 0 means "no supply cap" in Aave. */
    supplyCapWhole: (raw >> supplyCapShift) & ((1n << supplyCapBits) - 1n)
  };
}

/**
 * Typed error. `code` is a stable machine code; the UI maps it to an i18n key
 * with `explainRevert`-style lookup, so a raw stack never reaches a user.
 */
export class AaveAdapterError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.name = 'AaveAdapterError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Decode the raw return data of `Pool.getReserveData(address)`.
 *
 * Exported so the unit suite can feed it real-shaped return data for both
 * struct versions without a chain. Throws AaveAdapterError when no candidate
 * shape validates — it never returns a half-plausible struct.
 */
export async function decodeReserveData(returnData, { expectedDecimals } = {}) {
  const { AbiCoder, isAddress } = await loadEthers();
  const coder = new AbiCoder();
  const hex = typeof returnData === 'string' ? returnData : '0x';
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const wordCount = body.length / 64;
  // Static tuple encoding: a flat run of 32-byte words, no offset header.
  const words = [];
  for (let i = 0; i + 64 <= body.length; i += 64) words.push(BigInt(`0x${body.slice(i, i + 64)}`));

  for (const shape of RESERVE_DATA_SHAPES) {
    if (wordCount < shape.words) continue;
    let row;
    try {
      const decoded = coder.decode([shape.types], hex);
      row = decoded[0];
    } catch {
      continue;
    }
    const cfg = decodeReserveConfiguration(row.configuration);
    const aToken = row.aTokenAddress;
    const raw = words;
    /*
     * Validation has to be strong enough to reject the OTHER layout, not just
     * obviously broken data — the two shapes overlap, and a shorter shape will
     * happily "decode" longer return data with every field shifted. Reading a
     * uint16 reserve id as an address, or a 0-valued stable borrow rate as a
     * timestamp, is exactly how that shows up. So each candidate must also be
     * self-consistent:
     *   · the timestamp word is a real block timestamp (> 2017, fits uint40)
     *   · the reserve id is below Aave's MAX_RESERVES_COUNT (128)
     *   · the aToken is a genuine 160-bit-looking address, not a small integer
     */
    const ts = raw[shape.timestampWord];
    const reserveId = raw[shape.idWord];
    const valid =
      isAddress(aToken) &&
      aToken.toLowerCase() !== ZERO_ADDRESS &&
      BigInt(aToken) >= 2n ** 40n &&
      row.liquidityIndex >= RAY &&
      ts > 1_500_000_000n && ts < 2n ** 40n &&
      reserveId < 128n &&
      (expectedDecimals == null || cfg.decimals === Number(expectedDecimals));
    if (!valid) continue;
    return {
      shape: shape.id,
      configuration: cfg,
      liquidityIndex: row.liquidityIndex,
      currentLiquidityRate: row.currentLiquidityRate,
      lastUpdateTimestamp: Number(ts),
      aTokenAddress: aToken
    };
  }
  throw new AaveAdapterError('AAVE_RESERVE_DATA_UNDECODABLE', { wordCount });
}

/* -------------------------------------------------------------------------- */
/* Contract handles                                                            */
/* -------------------------------------------------------------------------- */

async function contracts(provider) {
  const { Contract } = await loadEthers();
  return {
    Contract,
    provider,
    addressesProvider: new Contract(AAVE_V3_BASE.addressesProvider, POOL_ADDRESSES_PROVIDER_ABI, provider),
    pool: new Contract(AAVE_V3_BASE.pool, POOL_ABI, provider),
    aUsdc: new Contract(AAVE_V3_BASE.aUsdc, [...ATOKEN_ABI, ...ERC20_ABI], provider),
    usdc: new Contract(AAVE_V3_BASE.usdc, ERC20_ABI, provider)
  };
}

/** Raw eth_call for getReserveData, so the struct shape stays ours to validate. */
async function readReserveData(provider) {
  const { Interface } = await loadEthers();
  const iface = new Interface(['function getReserveData(address asset) view returns (uint256[15])']);
  const data = iface.encodeFunctionData('getReserveData', [AAVE_V3_BASE.usdc]);
  const out = await provider.call({ to: AAVE_V3_BASE.pool, data });
  return decodeReserveData(out, { expectedDecimals: AAVE_V3_BASE.usdcDecimals });
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
 * Prove we are talking to the Aave deployment we pinned, and nothing else.
 *
 * Two independent checks, both required:
 *   1. `PoolAddressesProvider.getPool()` === pinned Pool. This is the check
 *      Aave's own docs recommend ("Whenever the Pool contract is needed, we
 *      recommended you fetch the correct address from this
 *      PoolAddressesProvider").
 *   2. the USDC reserve's aToken === pinned aBasUSDC, read from
 *      `Pool.getReserveData(USDC)`.
 *
 * Check 2 depends on the ReserveData struct layout, which Aave has changed
 * between releases (see decodeReserveData). If no declared layout validates,
 * we fall back to the aToken asking about itself — `aBasUSDC.POOL()` and
 * `aBasUSDC.UNDERLYING_ASSET_ADDRESS()` — which are single-value getters with
 * no struct involved. The evidence object reports WHICH path passed, so a
 * reviewer can see that the primary check did not run.
 *
 * Resolves with an evidence object; throws AaveAdapterError on any mismatch.
 */
export async function verifyDeployment(provider, { force = false } = {}) {
  if (!provider) throw new AaveAdapterError('AAVE_NO_PROVIDER');
  if (!force && verifiedByProvider.has(provider)) return verifiedByProvider.get(provider);

  const promise = (async () => {
    const c = await contracts(provider);

    // 1. The registry must point at the Pool we pinned.
    let livePool;
    try {
      livePool = await c.addressesProvider.getPool();
    } catch (err) {
      throw new AaveAdapterError('AAVE_ADDRESSES_PROVIDER_UNREADABLE', { reason: decodeRevertReason(err) });
    }
    if (String(livePool).toLowerCase() !== AAVE_V3_BASE.pool.toLowerCase()) {
      throw new AaveAdapterError('AAVE_POOL_MISMATCH', { expected: AAVE_V3_BASE.pool, found: livePool });
    }

    // 2a. Primary: the Pool's own USDC reserve data names the aToken.
    let verifiedVia = 'pool.getReserveData';
    let reserve;
    try {
      reserve = await readReserveData(provider);
      if (String(reserve.aTokenAddress).toLowerCase() !== AAVE_V3_BASE.aUsdc.toLowerCase()) {
        throw new AaveAdapterError('AAVE_ATOKEN_MISMATCH', {
          expected: AAVE_V3_BASE.aUsdc,
          found: reserve.aTokenAddress
        });
      }
    } catch (err) {
      if (err instanceof AaveAdapterError && err.code === 'AAVE_ATOKEN_MISMATCH') throw err;
      // 2b. Fallback: the aToken describes itself. Layout-free.
      let selfPool;
      let selfUnderlying;
      try {
        [selfPool, selfUnderlying] = await Promise.all([
          c.aUsdc.POOL(),
          c.aUsdc.UNDERLYING_ASSET_ADDRESS()
        ]);
      } catch (inner) {
        throw new AaveAdapterError('AAVE_DEPLOYMENT_UNVERIFIABLE', {
          reason: decodeRevertReason(inner) ?? decodeRevertReason(err)
        });
      }
      if (
        String(selfPool).toLowerCase() !== AAVE_V3_BASE.pool.toLowerCase() ||
        String(selfUnderlying).toLowerCase() !== AAVE_V3_BASE.usdc.toLowerCase()
      ) {
        throw new AaveAdapterError('AAVE_ATOKEN_MISMATCH', {
          expected: AAVE_V3_BASE.aUsdc,
          found: `${String(selfPool)}/${String(selfUnderlying)}`
        });
      }
      verifiedVia = 'atoken.self-report';
      reserve = null;
    }

    // Cheap extra guard: the chain must actually be Base.
    let chainId = null;
    try {
      const net = await provider.getNetwork();
      chainId = Number(net?.chainId ?? net?.id ?? 0) || null;
    } catch {
      chainId = null;
    }
    if (chainId != null && chainId !== AAVE_V3_BASE.chainId) {
      throw new AaveAdapterError('AAVE_WRONG_CHAIN', { expected: AAVE_V3_BASE.chainId, found: chainId });
    }

    return Object.freeze({
      schema: 'fbt.aave-base.verification.v1',
      ok: true,
      pool: AAVE_V3_BASE.pool,
      addressesProvider: AAVE_V3_BASE.addressesProvider,
      aUsdc: AAVE_V3_BASE.aUsdc,
      usdc: AAVE_V3_BASE.usdc,
      verifiedVia,
      reserveDataShape: reserve?.shape ?? null,
      chainId,
      verifiedAt: Date.now()
    });
  })();

  // Cache only a SUCCESSFUL verification.
  const settled = await promise;
  verifiedByProvider.set(provider, settled);
  return settled;
}

/* -------------------------------------------------------------------------- */
/* 2. Reserve status                                                           */
/* -------------------------------------------------------------------------- */

/** Ray rate → percent, rounded to 4 dp. Aave's `currentLiquidityRate` IS the
 *  supply APY expressed in ray (DataTypes.sol: "the current supply rate.
 *  Expressed in ray"), which is the figure Aave's own UI labels "Deposit APY". */
export function rayToApyPct(rateRay) {
  const r = typeof rateRay === 'bigint' ? rateRay : BigInt(String(rateRay ?? 0));
  return Number((r * 1000000n) / RAY) / 10000;
}

const toUsdcWei = (amountUsdc) => {
  const s = String(amountUsdc ?? '').trim();
  if (!/^\d*\.?\d+$/.test(s)) throw new AaveAdapterError('AAVE_BAD_AMOUNT', { amountUsdc });
  return toUnits(s, AAVE_V3_BASE.usdcDecimals);
};

/** parseUnits without a hard ethers dependency at import time. */
function toUnits(value, decimals) {
  const [whole = '0', fracRaw = ''] = String(value).split('.');
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
  const w = whole.replace(/^0+(?=\d)/, '') || '0';
  return BigInt(w + frac);
}

/** Format a 6-dp integer as a plain decimal string (no exponent, no rounding). */
export function fromUsdcWei(wei, decimals = AAVE_V3_BASE.usdcDecimals) {
  const v = typeof wei === 'bigint' ? wei : BigInt(String(wei));
  const neg = v < 0n;
  const abs = (neg ? -v : v).toString().padStart(decimals + 1, '0');
  const out = `${abs.slice(0, abs.length - decimals)}.${abs.slice(abs.length - decimals)}`;
  return (neg ? '-' : '') + out;
}

/**
 * Live reserve state, used to refuse a supply the protocol would reject.
 * `supplyCapUsdc`/`currentSuppliedUsdc` are 6-dp integers; a cap of 0n means
 * Aave has set NO supply cap for the reserve (per ReserveConfiguration.sol).
 */
export async function getReserveStatus(provider) {
  const deployment = await verifyDeployment(provider);
  const c = await contracts(provider);

  /* Throws AAVE_RESERVE_DATA_UNDECODABLE if no declared struct layout
     validates — fail closed rather than guess at a rate or a cap. */
  const reserve = await readReserveData(provider);
  const cfg = reserve.configuration;

  let totalSupply = null;
  try {
    totalSupply = await c.aUsdc.totalSupply();
  } catch {
    totalSupply = null; // honest null beats a fabricated 0
  }

  return {
    active: cfg.active,
    frozen: cfg.frozen,
    paused: cfg.paused,
    /** 6-dp bigint, or null when Aave has set no supply cap. */
    supplyCapUsdc: cfg.supplyCapWhole === 0n
      ? null
      : cfg.supplyCapWhole * 10n ** BigInt(AAVE_V3_BASE.usdcDecimals),
    currentSuppliedUsdc: totalSupply,
    supplyApyPct: rayToApyPct(reserve.currentLiquidityRate),
    ltvBps: cfg.ltvBps,
    liquidationThresholdBps: cfg.liquidationThresholdBps,
    decimals: cfg.decimals,
    lastUpdateTimestamp: reserve.lastUpdateTimestamp,
    reserveDataShape: reserve.shape,
    verifiedVia: deployment.verifiedVia,
    readAt: Date.now()
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Position                                                                 */
/* -------------------------------------------------------------------------- */

/** USD price of the asset with 8 decimals, per Aave's oracle. null if unknown. */
async function assetPriceUsd8(c) {
  try {
    const oracle = await c.addressesProvider.getPriceOracle();
    if (!isAddr(oracle) || oracle.toLowerCase() === ZERO_ADDRESS) return null;
    const { Contract } = await loadEthers();
    const price = await new Contract(oracle, ORACLE_ABI, c.provider).getAssetPrice(AAVE_V3_BASE.usdc);
    return typeof price === 'bigint' ? price : BigInt(String(price));
  } catch {
    return null;
  }
}

/**
 * The connected wallet's Aave USDC position.
 *
 * `accruedSinceUsdc` is explicitly best-effort: it is derived from the LOCAL
 * supply/withdraw records (see aaveV3History.js), not from the chain, because
 * the liquidity index at the moment of each past supply is not stored. When
 * the local records cannot account for the position — a position opened on
 * another device, or records cleared — it returns null and the UI renders "—".
 * It is never estimated from the APY.
 */
export async function getPosition(provider, owner, { history = null } = {}) {
  if (!isAddr(owner)) throw new AaveAdapterError('AAVE_BAD_OWNER', { owner });
  await verifyDeployment(provider);
  const c = await contracts(provider);

  const [aTokenBalance, accountData, priceUsd8] = await Promise.all([
    c.aUsdc.balanceOf(owner),
    c.pool.getUserAccountData(owner).catch(() => null),
    assetPriceUsd8(c)
  ]);

  const suppliedUsdc = typeof aTokenBalance === 'bigint' ? aTokenBalance : BigInt(String(aTokenBalance ?? 0));
  const totalDebtBase = accountData ? BigInt(String(accountData.totalDebtBase)) : 0n;
  const rawHealthFactor = accountData ? BigInt(String(accountData.healthFactor)) : null;

  /* Aave reports healthFactor as type(uint256).max when the user has no debt.
     Per spec, and honestly: no debt means no health factor to show. */
  const hasDebt = accountData != null && totalDebtBase > 0n;
  const healthFactor = hasDebt && rawHealthFactor != null && rawHealthFactor < 2n ** 128n
    ? Number(rawHealthFactor * 100n / RAY) / 100
    : null;

  return {
    suppliedUsdc,
    suppliedUsd: priceUsd8 == null ? null : Number(suppliedUsdc * priceUsd8) / 1e6 / 1e8,
    aTokenBalance: suppliedUsdc,
    healthFactor,
    hasDebt,
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
  if (!isAddr(owner)) throw new AaveAdapterError('AAVE_BAD_OWNER', { owner });
  const deployment = await verifyDeployment(provider);
  const c = await contracts(provider);
  const { Interface } = await loadEthers();

  const perTxCapUsdc = AAVE_BASE_SUPPLY_MAX_USDC_PER_TX;
  const totalCapUsdc = AAVE_BASE_SUPPLY_MAX_USDC_TOTAL;

  const checks = {
    schema: 'fbt.aave-base.supply-checks.v1',
    deploymentVerified: Boolean(deployment?.ok),
    reserveActive: null,
    reserveNotPaused: null,
    reserveNotFrozen: null,
    supplyCapHeadroomOk: null,
    perTxCapOk: null,
    totalCapOk: null,
    balanceSufficient: null,
    nativeGasFloorOk: null,
    blocked: [],
    amountUsdc: null,
    amountWei: null,
    balanceUsdc: null,
    allowanceWei: null,
    needsApproval: null,
    remainingTotalCapUsdc: null,
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
    block('AAVE_INVALID_AMOUNT');
    return { steps: [], checks };
  }
  checks.amountUsdc = Number(amountWei) / 10 ** AAVE_V3_BASE.usdcDecimals;

  /* ── per-tx cap (enforced HERE, not only in the UI) ─────────────────────── */
  const perTxCapWei = BigInt(Math.floor(Number(perTxCapUsdc) * 10 ** AAVE_V3_BASE.usdcDecimals));
  checks.perTxCapOk = amountWei <= perTxCapWei;
  if (!checks.perTxCapOk) block('AAVE_PER_TX_CAP');

  /* ── total cap: existing position + this supply ─────────────────────────── */
  let suppliedNow = 0n;
  try {
    suppliedNow = BigInt(String(await c.aUsdc.balanceOf(owner) ?? 0n));
  } catch {
    suppliedNow = null;
  }
  if (suppliedNow == null) {
    // A missing balance read is not a pass. Refuse rather than guess.
    checks.totalCapOk = null;
    block('AAVE_POSITION_UNREADABLE');
  } else {
    const totalCapWei = BigInt(Math.floor(Number(totalCapUsdc) * 10 ** AAVE_V3_BASE.usdcDecimals));
    checks.remainingTotalCapUsdc =
      Number(totalCapWei > suppliedNow ? totalCapWei - suppliedNow : 0n) / 10 ** AAVE_V3_BASE.usdcDecimals;
    checks.totalCapOk = suppliedNow + amountWei <= totalCapWei;
    if (!checks.totalCapOk) block('AAVE_TOTAL_CAP');
  }

  /* ── reserve state: active / paused / frozen / supply cap headroom ──────── */
  try {
    const status = await getReserveStatus(provider);
    checks.reserveActive = status.active;
    checks.reserveNotPaused = !status.paused;
    checks.reserveNotFrozen = !status.frozen;
    checks.supplyCapUsdc = status.supplyCapUsdc;
    if (!status.active) block('AAVE_RESERVE_INACTIVE');
    if (status.paused) block('AAVE_RESERVE_PAUSED');
    if (status.frozen) block('AAVE_RESERVE_FROZEN');
    if (status.supplyCapUsdc != null) {
      const supplied = status.currentSuppliedUsdc;
      if (supplied == null) {
        checks.supplyCapHeadroomOk = null;
        block('AAVE_SUPPLY_CAP_UNKNOWN');
      } else {
        checks.supplyCapHeadroomOk = supplied + amountWei <= status.supplyCapUsdc;
        if (!checks.supplyCapHeadroomOk) block('AAVE_SUPPLY_CAP_EXCEEDED');
      }
    } else {
      // No cap configured by Aave for this reserve: headroom is not a limit.
      checks.supplyCapHeadroomOk = true;
    }
  } catch {
    checks.reserveActive = null;
    checks.reserveNotPaused = null;
    checks.reserveNotFrozen = null;
    checks.supplyCapHeadroomOk = null;
    block('AAVE_RESERVE_UNREADABLE');
  }

  /* ── wallet balance ─────────────────────────────────────────────────────── */
  try {
    const bal = BigInt(String(await c.usdc.balanceOf(owner) ?? 0n));
    checks.balanceSufficient = bal >= amountWei;
    checks.balanceUsdc = bal;
    if (!checks.balanceSufficient) block('AAVE_INSUFFICIENT_BALANCE');
  } catch {
    checks.balanceSufficient = null;
    block('AAVE_BALANCE_UNREADABLE');
  }

  /* ── native gas floor (reused from the swap engine) ─────────────────────── */
  const floor = NATIVE_GAS_FLOOR[AAVE_V3_BASE.chainId];
  if (floor == null) {
    checks.nativeGasFloorOk = null;
    block('AAVE_GAS_FLOOR_UNKNOWN');
  } else if (nativeBalance == null) {
    checks.nativeGasFloorOk = null;
    block('AAVE_NATIVE_BALANCE_UNKNOWN');
  } else {
    const { parseUnits } = await loadEthers();
    const floorWei = parseUnits(String(floor), 18);
    const native = typeof nativeBalance === 'bigint' ? nativeBalance : BigInt(String(nativeBalance));
    checks.nativeGasFloorOk = native >= floorWei;
    if (!checks.nativeGasFloorOk) block('AAVE_NATIVE_GAS_FLOOR');
  }

  if (checks.blocked.length > 0) return { steps: [], checks };

  /* ── allowance: approve EXACTLY amountWei, or skip if already sufficient ── */
  const allowance = await c.usdc.allowance(owner, AAVE_V3_BASE.pool);
  checks.allowanceWei = typeof allowance === 'bigint' ? allowance : BigInt(String(allowance));
  checks.needsApproval = checks.allowanceWei < amountWei;

  const steps = [];
  const erc20 = new Interface(ERC20_ABI);
  const pool = new Interface(POOL_ABI);

  if (checks.needsApproval) {
    steps.push({
      kind: 'approve',
      to: AAVE_V3_BASE.usdc,
      data: erc20.encodeFunctionData('approve', [AAVE_V3_BASE.pool, amountWei]),
      value: 0n,
      description: { key: 'farm.aave.step.approve', amount: fromUsdcWei(amountWei) }
    });
  }

  steps.push({
    kind: 'supply',
    to: AAVE_V3_BASE.pool,
    // onBehalfOf is the connected owner — there is no other possible value.
    data: pool.encodeFunctionData('supply', [
      AAVE_V3_BASE.usdc,
      amountWei,
      owner,
      AAVE_V3_BASE.referralCode
    ]),
    value: 0n,
    description: { key: 'farm.aave.step.supply', amount: fromUsdcWei(amountWei) }
  });

  return { steps, checks };
}

/* -------------------------------------------------------------------------- */
/* 5. Withdraw plan                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A single-step withdraw. `amountUsdc` may be `'max'`, which Aave expresses as
 * MaxUint256 — the Pool then withdraws the caller's whole aToken balance.
 *
 * Deliberately NOT gated by the supply caps or the allowlist: a user who
 * supplied while the flag was on must always be able to get out. Gating exits
 * is how a safety feature becomes a trap.
 */
export async function buildWithdrawPlan({ provider, owner, amountUsdc }) {
  if (!isAddr(owner)) throw new AaveAdapterError('AAVE_BAD_OWNER', { owner });
  await verifyDeployment(provider);
  const { Interface, MaxUint256 } = await loadEthers();

  const isMax = String(amountUsdc).toLowerCase() === 'max';
  let amountWei;
  if (isMax) {
    amountWei = MaxUint256;
  } else {
    amountWei = toUsdcWei(amountUsdc);
    if (amountWei <= 0n) throw new AaveAdapterError('AAVE_INVALID_AMOUNT', { amountUsdc });
  }

  const pool = new Interface(POOL_ABI);
  const step = {
    kind: 'withdraw',
    to: AAVE_V3_BASE.pool,
    data: pool.encodeFunctionData('withdraw', [AAVE_V3_BASE.usdc, amountWei, owner]),
    value: 0n,
    description: { key: isMax ? 'farm.aave.step.withdrawMax' : 'farm.aave.step.withdraw', amount: isMax ? null : fromUsdcWei(amountWei) }
  };

  return {
    steps: [step],
    checks: {
      schema: 'fbt.aave-base.withdraw-checks.v1',
      deploymentVerified: true,
      isMax,
      amountWei,
      amountUsdc: isMax ? null : Number(amountWei) / 10 ** AAVE_V3_BASE.usdcDecimals,
      // No caps on the way out — recorded explicitly so a reviewer can see
      // this was a decision and not an omission.
      perTxCapOk: true,
      totalCapOk: true,
      blocked: []
    }
  };
}

/**
 * Revoke: `approve(pool, 0)`. Used by the partial-state sheet when an approve
 * confirmed but the supply did not, so the standing allowance is never left
 * sitting on the Pool.
 */
export async function buildRevokePlan({ provider, owner }) {
  if (!isAddr(owner)) throw new AaveAdapterError('AAVE_BAD_OWNER', { owner });
  await verifyDeployment(provider);
  const { Interface } = await loadEthers();
  const erc20 = new Interface(ERC20_ABI);
  return {
    steps: [{
      kind: 'approve',
      to: AAVE_V3_BASE.usdc,
      data: erc20.encodeFunctionData('approve', [AAVE_V3_BASE.pool, 0n]),
      value: 0n,
      description: { key: 'farm.aave.step.revoke' }
    }],
    checks: { schema: 'fbt.aave-base.revoke-checks.v1', blocked: [] }
  };
}

/* -------------------------------------------------------------------------- */
/* 6. Revert explanation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Aave v3 revert codes → i18n keys.
 *
 * Aave reverts with `require(cond, Errors.X)` where Errors.X is a SHORT NUMERIC
 * STRING, so the revert reason a wallet shows is literally "26". The numbers
 * and their meanings are copied from the deployed protocol's own error table:
 *
 *   aave-v3-core contracts/protocol/libraries/helpers/Errors.sol
 *
 * Only the codes reachable from supply/withdraw/allowance paths are mapped;
 * everything else falls through to `decodeRevertReason`, so an unmapped code
 * still surfaces its raw reason instead of a wrong sentence.
 */
export const AAVE_V3_ERROR_KEYS = Object.freeze({
  26: 'farm.aave.err.invalidAmount',        // INVALID_AMOUNT — 'Amount must be greater than 0'
  27: 'farm.aave.err.reserveInactive',      // RESERVE_INACTIVE — 'Action requires an active reserve'
  28: 'farm.aave.err.reserveFrozen',        // RESERVE_FROZEN — 'reserve is frozen'
  29: 'farm.aave.err.reservePaused',        // RESERVE_PAUSED — 'reserve is paused'
  51: 'farm.aave.err.supplyCapExceeded',    // SUPPLY_CAP_EXCEEDED
  25: 'farm.aave.err.invalidBurnAmount',    // INVALID_BURN_AMOUNT — 'Invalid amount to burn'
  32: 'farm.aave.err.notEnoughBalance',     // NOT_ENOUGH_AVAILABLE_USER_BALANCE — cannot withdraw more than available
  35: 'farm.aave.err.healthFactor',         // HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD
  45: 'farm.aave.err.healthFactorNotBelow', // HEALTH_FACTOR_NOT_BELOW_THRESHOLD
  59: 'farm.aave.err.oracleSentinel',       // PRICE_ORACLE_SENTINEL_CHECK_FAILED
  77: 'farm.aave.err.zeroAddress',          // ZERO_ADDRESS_NOT_VALID
  82: 'farm.aave.err.assetNotListed'        // ASSET_NOT_LISTED
});

/**
 * Map a failed call to something a user can read.
 *
 * @returns {{ code: string|null, key: string|null, known: boolean, reason: string|null }}
 *   `key` is an i18n key when Aave's own code was recognised; otherwise `reason`
 *   carries the decoded revert string. Never returns a fabricated explanation.
 */
export function explainRevert(err) {
  const reason = decodeRevertReason(err);
  const raw =
    (typeof err?.reason === 'string' && err.reason) ||
    (typeof err?.shortMessage === 'string' && err.shortMessage) ||
    (typeof err?.message === 'string' && err.message) ||
    '';
  /* The code arrives either bare ("26") or embedded in ethers' prose
     ("execution reverted: 26" / 'reverted with reason string "26"'). */
  const m = String(raw).match(/(?:^|[^0-9])(\d{1,3})(?![0-9])/);
  const code = m ? m[1] : null;
  const key = code && AAVE_V3_ERROR_KEYS[code] ? AAVE_V3_ERROR_KEYS[code] : null;
  return {
    code: key ? code : null,
    key,
    known: Boolean(key),
    reason: key ? null : reason
  };
}

/* -------------------------------------------------------------------------- */
/* 7. Pool matching for the Farm screen                                        */
/* -------------------------------------------------------------------------- */

/**
 * Is this DefiLlama pool row exactly the one this adapter can transact?
 * The match is deliberately strict: project, chain AND a single USDC leg.
 * Anything else — a different Aave market, a wrapped/static variant, another
 * chain — must keep the existing "buy the token on the protocol site" guidance.
 */
export function isAaveBaseUsdcPool(pool) {
  if (!pool) return false;
  const project = String(pool.project ?? '').toLowerCase();
  const chain = String(pool.chain ?? '').toLowerCase();
  const symbol = String(pool.symbol ?? '').toUpperCase().trim();
  const single = pool.exposure === 'single' || (symbol === 'USDC' && !pool.ilRisk);
  return project === 'aave-v3' && chain === 'base' && symbol === 'USDC' && Boolean(single);
}
