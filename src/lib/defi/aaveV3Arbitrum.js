/**
 * AAVE V3 · ARBITRUM (42161) · USDC ONLY — the app's third in-app DeFi execution
 * adapter. Supply, withdraw, read the position. Nothing else.
 * ---------------------------------------------------------------------------
 * ─── SCOPE, DELIBERATELY TINY ───────────────────────────────────────────────
 * One protocol (Aave v3 Pool), one chain (Arbitrum 42161), one asset (USDC), two
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
 *   https://github.com/bgd-labs/aave-address-book  →  src/AaveV3Arbitrum.sol
 *   (rendered at https://aave.com/docs/resources/addresses)
 *
 *   POOL_ADDRESSES_PROVIDER = 0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb
 *   POOL                    = 0x794a61358D6845594F94dc1DB02A252b5b4814aD
 *   USDC_A_TOKEN (native-USDC reserve) = 0x724dc807b04555b71ed48a6896b6F41593b8C637
 *
 * ─── THE USDCn TRAP — READ BEFORE TOUCHING THE PINS ─────────────────────────
 * Arbitrum has TWO USDCs and Aave lists BOTH as separate reserves with
 * separate aTokens: bridged USDC.e (0xFF97…) under `USDC` in the address book,
 * and Circle-native USDC (0xaf88…) under `USDCn`. This adapter pins the
 * NATIVE one, because that is what this app's token table calls 'USDC' on
 * Arbitrum (TOKENS[42161]) — the token the user buys on the swap screen before
 * coming here. Pinning the USDC.e aToken (0x625E…) here would verify against a
 * reserve whose underlying the user was never given: every supply would refuse
 * with AAVE_ATOKEN_MISMATCH at best. The aToken ADDRESS is the pin that
 * matters; its exact on-chain symbol string is read live by the fork probe
 * (asserted as an `aArb` prefix, never retyped here).
 *
 * (The ProtocolDataProvider address the Base adapter's header quotes is not
 * repeated here: neither adapter calls it — reserve data comes from the Pool
 * and the aToken's self-report — so a second copy would be a second address
 * to go stale for no reader.)
 *
 * USDC is NOT typed here — not even in this comment. It is read from the
 * existing token table in `src/lib/chains.js` (chain 42161, decimals 6) so there
 * is exactly one USDC address in the repo. The address book's USDCn UNDERLYING
 * (native USDC — NOT the bridged USDC.e entry) is that same address, and
 * `verifyDeployment` re-asserts the link at runtime by checking the reserve's
 * aToken against the pin.
 *
 * Pinned constants are never trusted on their own. Before any write is allowed,
 * `verifyDeployment()` calls `PoolAddressesProvider.getPool()` and compares it
 * to the pinned Pool, then reads the USDC reserve's aToken and compares it to
 * the pinned aArbUSDC. A mismatch throws — the adapter would rather be
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
  assertProviderChain, assertSuccessfulReceipt, parseReceiptLogs, ExecutionGuardError, sameAddress
} from './executionGuards';
import { verifyRoutedDeposit } from './splitRouter.js';
const loadEthers = () => import('ethers');

const isAddr = (v) => typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** 1e27 — Aave's RAY. Rates and the health factor are expressed in it. */
const RAY = 10n ** 27n;

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * USDC on Arbitrum, read from the chain/token registry — the single source of
 * truth for token addresses in this app. If USDC is ever delisted there this
 * module throws at import time instead of transacting against a stale address.
 */
const USDC_ON_ARBITRUM = getToken(42161, 'USDC');
if (!USDC_ON_ARBITRUM || !isAddr(USDC_ON_ARBITRUM.address)) {
  throw new Error('AAVE_ADAPTER_MISSING_USDC_ON_ARBITRUM');
}

export const AAVE_V3_ARBITRUM = Object.freeze({
  chainId: 42161,
  /** Aave v3 Pool proxy on Arbitrum. Source: Aave Address Book src/AaveV3Arbitrum.sol */
  pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  /** PoolAddressesProvider on Arbitrum. Source: Aave Address Book src/AaveV3Arbitrum.sol */
  addressesProvider: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
  /** aArbUSDC — the receipt token for supplied USDC. Source: Aave Address Book */
  aUsdc: '0x724dc807b04555b71ed48a6896b6F41593b8C637',
  /** Imported from lib/chains.js (TOKENS[42161]), NOT retyped here. */
  usdc: USDC_ON_ARBITRUM.address,
  usdcDecimals: USDC_ON_ARBITRUM.decimals,
  usdcSymbol: USDC_ON_ARBITRUM.symbol,
  /** Aave's docs: "Referral supply is currently inactive, you can pass 0." */
  referralCode: 0,
  explorer: EVM_CHAINS[42161].explorer
});

/*
 * The read-only rate table in lib/lending.js has carried the Arbitrum Pool proxy
 * since before this adapter existed (it renders lending rates on the Loan
 * screen). Two copies of one contract address is exactly how a future edit
 * ends up sending funds to the wrong one, so the adapter does not trust that
 * the two agree — it asserts it, at load, and refuses to load if they do not.
 */
if (String(AAVE_V3_POOLS?.[AAVE_V3_ARBITRUM.chainId] ?? '').toLowerCase() !== AAVE_V3_ARBITRUM.pool.toLowerCase()) {
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
const AAVE_EVENT_ABI = [
  // IPool declares `user` in data and `referralCode` in topics. Indexed
  // modifiers do not alter topic0, so the inverse layout can appear to parse
  // while silently shifting onBehalfOf/amount into the wrong ABI fields.
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
  'event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

/* -------------------------------------------------------------------------- */
/* getReserveData decoding                                                     */
/* -------------------------------------------------------------------------- */
/*
 * `Pool.getReserveData(asset)` returns the whole `DataTypes.ReserveData`
 * struct, and Aave CHANGED that struct between releases — but the change is
 * NOT visible on the wire the way an early draft of this comment claimed.
 * What actually happened, verified 2026-09-06 against the released protocol
 * source (aave-v3-core master/v1.19.x; aave-v3-origin tags v3.1.0 … v3.7.0):
 *
 *   · aave-v3-core (v3.0.x) has ONE struct, 15 ABI fields, and
 *     getReserveData() returns it directly: 15 words, aToken at word 8.
 *
 *   · aave-v3-origin (v3.1.0 … v3.7.0) grew the INTERNAL ReserveData struct
 *     to 17 fields (liquidationGracePeriodUntil inserted between id and
 *     aTokenAddress; virtualUnderlyingBalance added; stable-rate slots kept,
 *     then reused — deficit on v3.3.0, a v3.4.0 tail reorder). But the Pool's
 *     public getReserveData() returns a dedicated `DataTypes.ReserveDataLegacy`
 *     — 15 fields, aToken at word 8 — in EVERY origin tag (verified in
 *     IPool.sol at v3.1.0, v3.2.0, v3.3.0, v3.4.0 and in DataTypes.sol at
 *     v3.5.0, v3.6.0, main: "This exists specifically to maintain the
 *     getReserveData() interface"). So every released pool answers
 *     getReserveData with the SAME 15-word ABI.
 *
 *   · Therefore the ABI shape is NOT a version fingerprint: a 15-word answer
 *     can be a v3.0.x-core pool OR an origin v3.4+ pool. The version is told
 *     apart by the REVERT style instead — numeric Error(string) codes through
 *     v3.3.0, equivalent no-argument custom errors from v3.4.0 — which is
 *     what probe rule 7 checks against real reverts.
 *
 * The 17-word candidate below is kept DEFENSIVELY: no released getReserveData
 * returns the internal struct, but if any deployed variant ever does, the
 * aToken sits at word 9 there. A 13-word "v3.3+" layout with aToken at word 7
 * (the version of this table before the previous fix) matches NO released
 * pool: it is rejected by the same validation below, and
 * test/farm-defi.test.js pins that rejection so a phantom layout cannot
 * quietly re-enter the table.
 *
 * The candidates are declared explicitly, and each decode is validated
 * against facts that cannot be satisfied by the wrong shape: word 0 is the
 * configuration bitmap, and its decimals field (bits 48-55, per
 * ReserveConfiguration.sol) MUST equal USDC's 6 decimals; the liquidity index
 * MUST be >= 1e27. A candidate that fails validation is rejected even if it
 * "decoded" (ethers tolerates trailing words, so a 15-word tuple will happily
 * "decode" a 17-word payload and read word 8 — the grace period — as the
 * aToken; the shifted reads then fail the address checks below).
 */
export const RESERVE_DATA_SHAPES = Object.freeze([
  {
    id: '15w legacy getReserveData ABI (v3.0.x core / origin v3.1+ ReserveDataLegacy)',
    aTokenWord: 8,
    timestampWord: 6,
    idWord: 7,
    words: 15,
    types:
      'tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)'
  },
  {
    id: '17w internal ReserveData (defensive; no released getReserveData returns it)',
    aTokenWord: 9,
    timestampWord: 6,
    idWord: 7,
    words: 17,
    types:
      'tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 stableBorrowRateOrDeficit, uint40 lastUpdateTimestamp, uint16 id, uint40 liquidationGracePeriodUntil, address aTokenAddress, address deprecatedStableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbackedOrVirtualUnderlyingBalance, uint128 isolationModeTotalDebt, uint128 virtualUnderlyingBalanceOrDeprecated)'
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
    addressesProvider: new Contract(AAVE_V3_ARBITRUM.addressesProvider, POOL_ADDRESSES_PROVIDER_ABI, provider),
    pool: new Contract(AAVE_V3_ARBITRUM.pool, POOL_ABI, provider),
    aUsdc: new Contract(AAVE_V3_ARBITRUM.aUsdc, [...ATOKEN_ABI, ...ERC20_ABI], provider),
    usdc: new Contract(AAVE_V3_ARBITRUM.usdc, ERC20_ABI, provider)
  };
}

/** Raw eth_call for getReserveData, so the struct shape stays ours to validate. */
async function readReserveData(provider) {
  const { Interface } = await loadEthers();
  const iface = new Interface(['function getReserveData(address asset) view returns (uint256[15])']);
  const data = iface.encodeFunctionData('getReserveData', [AAVE_V3_ARBITRUM.usdc]);
  const out = await provider.call({ to: AAVE_V3_ARBITRUM.pool, data });
  return decodeReserveData(out, { expectedDecimals: AAVE_V3_ARBITRUM.usdcDecimals });
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
 *   2. the USDC reserve's aToken === pinned aArbUSDC, read from
 *      `Pool.getReserveData(USDC)`.
 *
 * Check 2 depends on the ReserveData struct layout, which Aave has changed
 * between releases (see decodeReserveData). If no declared layout validates,
 * we fall back to the aToken asking about itself — `aArbUSDC.POOL()` and
 * `aArbUSDC.UNDERLYING_ASSET_ADDRESS()` — which are single-value getters with
 * no struct involved. The evidence object reports WHICH path passed, so a
 * reviewer can see that the primary check did not run.
 *
 * Resolves with an evidence object; throws AaveAdapterError on any mismatch.
 */
export async function verifyDeployment(provider, { force = false } = {}) {
  if (!provider) throw new AaveAdapterError('AAVE_NO_PROVIDER');
  try {
    await assertProviderChain(provider, AAVE_V3_ARBITRUM.chainId);
  } catch (err) {
    if (err?.code === 'EXECUTION_WRONG_CHAIN') {
      throw new AaveAdapterError('AAVE_WRONG_CHAIN', err.detail);
    }
    if (err instanceof ExecutionGuardError) {
      throw new AaveAdapterError('AAVE_NETWORK_UNREADABLE', err.detail);
    }
    throw err;
  }
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
    if (String(livePool).toLowerCase() !== AAVE_V3_ARBITRUM.pool.toLowerCase()) {
      throw new AaveAdapterError('AAVE_POOL_MISMATCH', { expected: AAVE_V3_ARBITRUM.pool, found: livePool });
    }

    // 2a. Primary: the Pool's own USDC reserve data names the aToken.
    let verifiedVia = 'pool.getReserveData';
    let reserve;
    try {
      reserve = await readReserveData(provider);
      if (String(reserve.aTokenAddress).toLowerCase() !== AAVE_V3_ARBITRUM.aUsdc.toLowerCase()) {
        throw new AaveAdapterError('AAVE_ATOKEN_MISMATCH', {
          expected: AAVE_V3_ARBITRUM.aUsdc,
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
        String(selfPool).toLowerCase() !== AAVE_V3_ARBITRUM.pool.toLowerCase() ||
        String(selfUnderlying).toLowerCase() !== AAVE_V3_ARBITRUM.usdc.toLowerCase()
      ) {
        throw new AaveAdapterError('AAVE_ATOKEN_MISMATCH', {
          expected: AAVE_V3_ARBITRUM.aUsdc,
          found: `${String(selfPool)}/${String(selfUnderlying)}`
        });
      }
      verifiedVia = 'atoken.self-report';
      reserve = null;
    }

    // Cheap extra guard: the chain must actually be Arbitrum.
    let chainId = null;
    try {
      const net = await provider.getNetwork();
      chainId = Number(net?.chainId ?? net?.id ?? 0) || null;
    } catch {
      chainId = null;
    }
    if (chainId != null && chainId !== AAVE_V3_ARBITRUM.chainId) {
      throw new AaveAdapterError('AAVE_WRONG_CHAIN', { expected: AAVE_V3_ARBITRUM.chainId, found: chainId });
    }

    return Object.freeze({
      schema: 'fbt.aave-arbitrum.verification.v1',
      ok: true,
      pool: AAVE_V3_ARBITRUM.pool,
      addressesProvider: AAVE_V3_ARBITRUM.addressesProvider,
      aUsdc: AAVE_V3_ARBITRUM.aUsdc,
      usdc: AAVE_V3_ARBITRUM.usdc,
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
  return toUnits(s, AAVE_V3_ARBITRUM.usdcDecimals);
};

/** parseUnits without a hard ethers dependency at import time. */
function toUnits(value, decimals) {
  const [whole = '0', fracRaw = ''] = String(value).split('.');
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
  const w = whole.replace(/^0+(?=\d)/, '') || '0';
  return BigInt(w + frac);
}

/** Format a 6-dp integer as a plain decimal string (no exponent, no rounding). */
export function fromUsdcWei(wei, decimals = AAVE_V3_ARBITRUM.usdcDecimals) {
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
      : cfg.supplyCapWhole * 10n ** BigInt(AAVE_V3_ARBITRUM.usdcDecimals),
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
    const price = await new Contract(oracle, ORACLE_ABI, c.provider).getAssetPrice(AAVE_V3_ARBITRUM.usdc);
    return typeof price === 'bigint' ? price : BigInt(String(price));
  } catch {
    return null;
  }
}

/**
 * The connected wallet's Aave USDC position.
 *
 * `accruedSinceUsdc` is explicitly best-effort: it is derived from the LOCAL
 * supply/withdraw records (see aaveV3ArbHistory.js), not from the chain, because
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

  const checks = {
    schema: 'fbt.aave-arbitrum.supply-checks.v1',
    deploymentVerified: Boolean(deployment?.ok),
    reserveActive: null,
    reserveNotPaused: null,
    reserveNotFrozen: null,
    supplyCapHeadroomOk: null,
    balanceSufficient: null,
    nativeGasFloorOk: null,
    blocked: [],
    amountUsdc: null,
    amountWei: null,
    balanceUsdc: null,
    allowanceWei: null,
    needsApproval: null,
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
  checks.amountUsdc = Number(amountWei) / 10 ** AAVE_V3_ARBITRUM.usdcDecimals;

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
  const floor = NATIVE_GAS_FLOOR[AAVE_V3_ARBITRUM.chainId];
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
  const allowance = await c.usdc.allowance(owner, AAVE_V3_ARBITRUM.pool);
  checks.allowanceWei = typeof allowance === 'bigint' ? allowance : BigInt(String(allowance));
  checks.needsApproval = checks.allowanceWei < amountWei;

  const steps = [];
  const erc20 = new Interface(ERC20_ABI);
  const pool = new Interface(POOL_ABI);

  if (checks.needsApproval) {
    steps.push({
      kind: 'approve',
      to: AAVE_V3_ARBITRUM.usdc,
      data: erc20.encodeFunctionData('approve', [AAVE_V3_ARBITRUM.pool, amountWei]),
      value: 0n,
      description: { key: 'farm.aaveArb.step.approve', amount: fromUsdcWei(amountWei) }
    });
  }

  steps.push({
    kind: 'supply',
    to: AAVE_V3_ARBITRUM.pool,
    // onBehalfOf is the connected owner — there is no other possible value.
    data: pool.encodeFunctionData('supply', [
      AAVE_V3_ARBITRUM.usdc,
      amountWei,
      owner,
      AAVE_V3_ARBITRUM.referralCode
    ]),
    value: 0n,
    description: { key: 'farm.aaveArb.step.supply', amount: fromUsdcWei(amountWei) }
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
    to: AAVE_V3_ARBITRUM.pool,
    data: pool.encodeFunctionData('withdraw', [AAVE_V3_ARBITRUM.usdc, amountWei, owner]),
    value: 0n,
    description: { key: isMax ? 'farm.aaveArb.step.withdrawMax' : 'farm.aaveArb.step.withdraw', amount: isMax ? null : fromUsdcWei(amountWei) }
  };

  return {
    steps: [step],
    checks: {
      schema: 'fbt.aave-arbitrum.withdraw-checks.v1',
      deploymentVerified: true,
      isMax,
      amountWei,
      amountUsdc: isMax ? null : Number(amountWei) / 10 ** AAVE_V3_ARBITRUM.usdcDecimals,
      blocked: []
    }
  };
}

/**
 * Revoke: `approve(pool, 0)`. Used by the partial-state sheet when an approve
 * confirmed but the supply did not, so the standing allowance is never left
 * sitting on the Pool.
 */
export async function buildRevokePlan({ provider, owner, spender = null } = {}) {
  if (!isAddr(owner)) throw new AaveAdapterError('AAVE_BAD_OWNER', { owner });
  await verifyDeployment(provider);
  const { Interface } = await loadEthers();
  const erc20 = new Interface(ERC20_ABI);
  return {
    steps: [{
      kind: 'approve',
      to: AAVE_V3_ARBITRUM.usdc,
      data: erc20.encodeFunctionData('approve', [spender ?? AAVE_V3_ARBITRUM.pool, 0n]),
      value: 0n,
      description: { key: 'farm.aaveArb.step.revoke' }
    }],
    checks: { schema: 'fbt.aave-arbitrum.revoke-checks.v1', blocked: [] }
  };
}

/** Verify the mined receipt and the expected on-chain position transition. */
export async function verifyAaveReceipt({
  provider, receipt, owner, action, amountWei, beforePositionWei = null, splitRouter = null,
  expectedSpender = null
} = {}) {
  assertSuccessfulReceipt(receipt);
  if (!isAddr(owner)) throw new AaveAdapterError('AAVE_BAD_OWNER', { owner });
  const { Interface } = await loadEthers();
  const iface = new Interface(AAVE_EVENT_ABI);
  const amount = amountWei == null ? null : BigInt(String(amountWei));
  const events = action === 'approve' || action === 'revoke'
    ? parseReceiptLogs(receipt, iface, AAVE_V3_ARBITRUM.usdc, 'Approval')
    : parseReceiptLogs(receipt, iface, AAVE_V3_ARBITRUM.pool, action === 'supply' ? 'Supply' : 'Withdraw');
  if (events.length === 0) {
    throw new AaveAdapterError('AAVE_EXPECTED_EVENT_MISSING', { action, hash: receipt.hash ?? null });
  }
  const args = events[0].parsed.args;
  if (action === 'approve' || action === 'revoke') {
    if (!sameAddress(String(args.owner), owner)
      || !sameAddress(
        String(args.spender),
        expectedSpender ?? (splitRouter ? splitRouter.address : AAVE_V3_ARBITRUM.pool)
      )) {
      throw new AaveAdapterError('AAVE_APPROVAL_EVENT_MISMATCH', { action });
    }
    if (action === 'approve' && amount != null && BigInt(String(args.value)) !== amount) {
      throw new AaveAdapterError('AAVE_APPROVAL_AMOUNT_MISMATCH', { expected: amount, found: args.value });
    }
    if (action === 'revoke' && BigInt(String(args.value)) !== 0n) {
      throw new AaveAdapterError('AAVE_REVOKE_AMOUNT_MISMATCH');
    }
    return Object.freeze({ ok: true, action, event: 'Approval', position: null });
  }
  if (splitRouter && action === 'supply') {
    /*
     * Routed through the split router. TWO proofs, not one:
     *   · the router's Routed event pins the split — user, the one pool this
     *     deployment routes to, gross amount, quoted fee, net amount;
     *   · the pool's own Supply event must still credit the OWNER with the
     *     NET amount — the router is never the beneficiary.
     * A receipt that satisfies neither shape is not accepted.
     */
    const { routed } = await verifyRoutedDeposit({
      receipt,
      routerAddress: splitRouter.address,
      owner,
      target: AAVE_V3_ARBITRUM.pool,
      asset: AAVE_V3_ARBITRUM.usdc,
      amountIn: amount,
      feeTaken: splitRouter.feeAmount,
      netAmount: splitRouter.netAmount
    });
    const supplies = parseReceiptLogs(receipt, iface, AAVE_V3_ARBITRUM.pool, 'Supply');
    const credited = supplies.some(({ parsed }) =>
      sameAddress(String(parsed.args.onBehalfOf), owner)
      && BigInt(String(parsed.args.amount)) === routed.netAmount);
    if (!credited) {
      throw new AaveAdapterError('AAVE_PROTOCOL_EVENT_MISMATCH', {
        action, eventAmount: routed.netAmount, expected: routed.netAmount,
        reason: 'ROUTED_SUPPLY_NOT_CREDITED_TO_OWNER'
      });
    }
    const after = await getPosition(provider, owner);
    const before = beforePositionWei == null ? null : BigInt(String(beforePositionWei));
    if (before != null && !(after.aTokenBalance > before)) {
      throw new AaveAdapterError('AAVE_POSITION_UNCHANGED', { action, before, after: after.aTokenBalance });
    }
    return Object.freeze({ ok: true, action, event: 'Supply', position: after, routed });
  }

  const eventAmount = BigInt(String(args.amount));
  const eventOwner = action === 'supply' ? args.onBehalfOf : args.to;
  if (!sameAddress(String(eventOwner), owner) ||
      (amount !== ((1n << 256n) - 1n) && amount != null && eventAmount !== amount)) {
    throw new AaveAdapterError('AAVE_PROTOCOL_EVENT_MISMATCH', { action, eventAmount, expected: amount });
  }
  const after = await getPosition(provider, owner);
  const before = beforePositionWei == null ? null : BigInt(String(beforePositionWei));
  if (before != null) {
    // aToken balance units are scaled by Aave's liquidity index and can round
    // below the Supply event amount. The event proves the exact input while
    // the independently read post-state proves the position moved correctly.
    const changed = action === 'supply' ? after.aTokenBalance > before : after.aTokenBalance < before;
    if (!changed) throw new AaveAdapterError('AAVE_POSITION_UNCHANGED', { action, before, after: after.aTokenBalance });
  }
  return Object.freeze({ ok: true, action, event: action === 'supply' ? 'Supply' : 'Withdraw', position: after });
}

/* -------------------------------------------------------------------------- */
/* 6. Revert explanation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Aave v3 revert codes → i18n keys.
 *
 * Aave changed HOW it reverts once, and the two eras overlap on live
 * instances while governance upgrades them one by one:
 *
 *   · v3.0.x–v3.3 (aave-v3-core, and aave-v3-origin up to v3.3.0):
 *     `require(cond, Errors.X)` where Errors.X is a SHORT NUMERIC STRING, so
 *     the revert reason a wallet shows is literally "26". The numbers below
 *     and their meanings are copied from the deployed protocol's own error
 *     table (aave-v3-core / aave-v3-origin @v3.3.0
 *     contracts/.../helpers/Errors.sol).
 *
 *   · v3.4+ (aave-v3-origin v3.4.0, v3.5.0, v3.6.0, v3.7.0 — the code Aave
 *     governance has been upgrading instances to since July 2025): every
 *     string constant became a no-argument CUSTOM ERROR with the same name
 *     and meaning (`error InvalidAmount();` etc.), so a reverting call no
 *     longer carries "26" anywhere. The revert payload is the 4-byte error
 *     selector, and AAVE_V3_CUSTOM_ERRORS below maps those selectors to the
 *     same i18n keys. The mapping is verified in test/farm-defi.test.js
 *     against keccak256 of the error signature, so a mistyped selector fails
 *     the suite rather than shipping a silent miss.
 *
 * Only the errors reachable from supply/withdraw/allowance paths are mapped;
 * everything else falls through to `decodeRevertReason`, so an unmapped error
 * still surfaces its raw reason instead of a wrong sentence.
 */
export const AAVE_V3_ERROR_KEYS = Object.freeze({
  26: 'farm.aaveArb.err.invalidAmount',        // INVALID_AMOUNT — 'Amount must be greater than 0'
  27: 'farm.aaveArb.err.reserveInactive',      // RESERVE_INACTIVE — 'Action requires an active reserve'
  28: 'farm.aaveArb.err.reserveFrozen',        // RESERVE_FROZEN — 'reserve is frozen'
  29: 'farm.aaveArb.err.reservePaused',        // RESERVE_PAUSED — 'reserve is paused'
  51: 'farm.aaveArb.err.supplyCapExceeded',    // SUPPLY_CAP_EXCEEDED
  25: 'farm.aaveArb.err.invalidBurnAmount',    // INVALID_BURN_AMOUNT — 'Invalid amount to burn'
  32: 'farm.aaveArb.err.notEnoughBalance',     // NOT_ENOUGH_AVAILABLE_USER_BALANCE — cannot withdraw more than available
  35: 'farm.aaveArb.err.healthFactor',         // HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD
  45: 'farm.aaveArb.err.healthFactorNotBelow', // HEALTH_FACTOR_NOT_BELOW_THRESHOLD
  59: 'farm.aaveArb.err.oracleSentinel',       // PRICE_ORACLE_SENTINEL_CHECK_FAILED
  77: 'farm.aaveArb.err.zeroAddress',          // ZERO_ADDRESS_NOT_VALID
  82: 'farm.aaveArb.err.assetNotListed'        // ASSET_NOT_LISTED
});

/**
 * v3.4+ custom errors → i18n keys, by 4-byte revert selector (lowercase,
 * 0x-prefixed). Selectors are keccak256(name + "()") — all of Aave's custom
 * errors are no-argument — precomputed so explainRevert stays synchronous;
 * the suite re-derives each selector from the signature and compares.
 */
export const AAVE_V3_CUSTOM_ERRORS = Object.freeze({
  '0x2c5211c6': 'farm.aaveArb.err.invalidAmount',        // InvalidAmount()
  '0x2075cc10': 'farm.aaveArb.err.invalidBurnAmount',    // InvalidBurnAmount()
  '0x90cd6f24': 'farm.aaveArb.err.reserveInactive',      // ReserveInactive()
  '0x6d305815': 'farm.aaveArb.err.reserveFrozen',        // ReserveFrozen()
  '0xd37f5f1c': 'farm.aaveArb.err.reservePaused',        // ReservePaused()
  '0x47bc4b2c': 'farm.aaveArb.err.notEnoughBalance',     // NotEnoughAvailableUserBalance()
  '0x6679996d': 'farm.aaveArb.err.healthFactor',         // HealthFactorLowerThanLiquidationThreshold()
  '0x930bb771': 'farm.aaveArb.err.healthFactorNotBelow', // HealthFactorNotBelowThreshold()
  '0xf58f733a': 'farm.aaveArb.err.supplyCapExceeded',    // SupplyCapExceeded()
  '0x91037009': 'farm.aaveArb.err.oracleSentinel',       // PriceOracleSentinelCheckFailed()
  '0x3bf95ba7': 'farm.aaveArb.err.zeroAddress',          // ZeroAddressNotValid()
  '0xb77e1e0f': 'farm.aaveArb.err.assetNotListed'        // AssetNotListed()
});

/**
 * Map a failed call to something a user can read.
 *
 * Understands both revert eras: the v3.4+ custom-error selector (usually on
 * `err.data`) and the legacy numeric string ("26", in `reason`/prose). The
 * legacy path first looks for a hex selector in any field — ethers' prose can
 * embed the raw revert data — and then falls back to the numeric code.
 *
 * @returns {{ code: string|null, key: string|null, known: boolean, reason: string|null }}
 *   `key` is an i18n key when Aave's own error was recognised; `code` is the
 *   legacy numeric code when the revert was a legacy string code, else null.
 *   `reason` carries the decoded revert string only for unrecognised errors.
 *   Never returns a fabricated explanation.
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

  /* v3.4+ custom errors: a known 4-byte selector in the revert payload. */
  for (const candidate of [rawData, raw]) {
    const sel = String(candidate).match(/0x([0-9a-fA-F]{8})/);
    if (sel) {
      const key = AAVE_V3_CUSTOM_ERRORS[`0x${sel[1].toLowerCase()}`];
      if (key) {
        return { code: null, key, known: true, reason: null };
      }
    }
  }

  /* Legacy v3.0–v3.3: the code arrives either bare ("26") or embedded in
     ethers' prose ("execution reverted: 26" / 'reverted with reason string
     "26"'). */
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
export function isAaveArbUsdcPool(pool) {
  if (!pool) return false;
  const project = String(pool.project ?? '').toLowerCase();
  const chain = String(pool.chain ?? '').toLowerCase();
  const symbol = String(pool.symbol ?? '').toUpperCase().trim();
  const single = pool.exposure === 'single' || (symbol === 'USDC' && !pool.ilRisk);
  return project === 'aave-v3' && chain === 'arbitrum' && symbol === 'USDC' && Boolean(single);
}
