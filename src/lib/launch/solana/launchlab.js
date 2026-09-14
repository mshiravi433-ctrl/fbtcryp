/**
 * SOLANA LAUNCH — Raydium LaunchLab (bonding-curve launch + graduation).
 * ============================================================================
 *
 * WHAT THIS IS
 * A Solana launch here is ONE LaunchLab `initialize_v2` instruction (which
 * creates the mint, the metadata, the pool and both vaults atomically) plus an
 * OPTIONAL first buy on the bonding curve in a second transaction. At
 * graduation the curve migrates into a Raydium CPMM pool automatically. There
 * is no separate SPL-token step: the program mints the FULL supply into the
 * curve vault and revokes the mint authority in the same instruction.
 *
 * WHY LAUNCHLAB AND NOT THE AMM
 * The old adapter targeted Raydium AMM v4 pool creation, which needs an
 * OpenBook market per pair and program-version-specific config accounts —
 * none of it verifiable here, so the adapter refused. LaunchLab is the
 * launchpad-native path: one documented instruction, deterministic PDAs, and
 * a config account whose values are READ LIVE and checked before anything is
 * signed. The AMM constant is kept in ./raydium.js for reference only.
 *
 * ── PINNED SOURCES (exact versions; re-verify before changing any byte) ──
 *   · Program IDs + devnet IDs + authority seeds:
 *     docs.raydium.io/reference/program-addresses (verified 2026-09-09)
 *   · initialize_v2 / buy_exact_in discriminators + account lists:
 *     raydium-io/raydium-sdk-V2 master src/raydium/launchpad/instrument.ts
 *     (initializeV2 discriminator [67,153,175,39,218,16,38,32])
 *   · cross-check: raydium-io/raydium-idl master
 *     raydium_launchpad/raydium_launchpad.json —
 *     address LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj, buy_exact_in
 *     discriminator [250,234,13,123,213,156,19,236]
 *   · PDA seeds: sdk-V2 src/raydium/launchpad/pda.ts +
 *     src/raydium/clmm/libraries/pda.ts (POOL_SEED "pool", vault "pool_vault")
 *   · account layouts: sdk-V2 src/raydium/launchpad/layout.ts
 *   · curve math + param checks: sdk-V2 src/raydium/launchpad/curve/
 *     constantProductCurve.ts + curve.ts (Curve.checkParam / getInitParam /
 *     buyExactIn) — ported to BigInt below, function by function
 *   · SOL curve config + Raydium platform values:
 *     launch-mint-v1.raydium.io/main/configs + /main/platforms (live API;
 *     the app RE-READS both accounts on-chain and refuses on mismatch)
 *   · economics (full supply pre-minted to vault, mint authority revoked at
 *     initialize, CPMM-only graduation for new launches, symbol ≤ 10):
 *     docs.raydium.io/products/launchlab/* (accounts, global-config,
 *     bonding-curve, code-demos — verified 2026-09-09, SDK 0.2.64-alpha)
 *
 * ── WHAT IS PROVEN WHERE ─────────────────────────────────────────────────
 *   · Addressing: the config PDA derived here from (program id + documented
 *     seeds) EQUALS the config address Raydium's own API publishes —
 *     asserted in test/launch-solana-probe.mjs. A wrong program id or seed
 *     fails the build, not the user.
 *   · Discriminators: recomputed from sha256("global:<name>") in the probe
 *     (Anchor's own rule), never trusted from memory.
 *   · Instruction bytes: built here, decoded BY HAND in the probe from the
 *     SDK layouts (never encoder-against-encoder).
 *   · Curve math: BigInt port of the SDK functions; the probe asserts the
 *     known-answer reserves plus shape invariants (positive, monotonic,
 *     bounded by remaining supply).
 *   · Everything else (config values, rent, simulation, confirmation, pool
 *     state) is read LIVE from the user's cluster at runtime — see
 *     ./verify.js and ./signing.js. Nothing on this page assumes mainnet
 *     values on devnet or vice versa.
 *
 * Like ./spl.js this module dynamic-imports @solana/web3.js: the pure parts
 * (validation, math, decoders) are sync and dependency-free, while PDA
 * derivation and instruction building need the library and are async.
 */

/* ── §1 · pinned constants ─────────────────────────────────────────────── */

/** LaunchLab program, mainnet-beta — the docs' canonical table + the IDL. */
export const LAUNCHLAB_PROGRAM_ID = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
/** LaunchLab program, devnet — same table. */
export const LAUNCHLAB_DEVNET_PROGRAM_ID = 'DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6';
/**
 * The SOL-quoted constant-product GlobalConfig on mainnet, as published by
 * Raydium's configs API. This is an EXPECTATION, not an input: the app
 * derives the config PDA from (program id, WSOL, curve 0, index 0) and
 * REFUSES unless the derivation lands here AND the account decodes cleanly.
 */
export const LAUNCHLAB_SOL_CONFIG_MAINNET = '6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX';
/** Raydium's own platform config — the SDK default when no platformId is passed. */
export const RAYDIUM_PLATFORM_ID = '4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4';
/** Quote mint of the SOL config (wrapped SOL, legacy SPL Token program). */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
/** Metaplex Token Metadata program — create_metadata_accounts_v3 CPI target. */
export const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

/** Anchor instruction discriminators (sha256("global:<name>")[:8]). */
export const LAUNCHLAB_IX = Object.freeze({
  initializeV2: Object.freeze([67, 153, 175, 39, 218, 16, 38, 32]),
  buyExactIn: Object.freeze([250, 234, 13, 123, 213, 156, 19, 236])
});
/** Anchor account discriminators (sha256("account:<Name>")[:8]). */
export const LAUNCHLAB_ACCOUNT_DISC = Object.freeze({
  poolState: Object.freeze([247, 237, 227, 245, 215, 195, 222, 70]),
  globalConfig: Object.freeze([149, 8, 156, 202, 160, 252, 176, 217]),
  platformConfig: Object.freeze([160, 78, 128, 0, 248, 83, 230, 160])
});

/** PDA seeds, exactly as in the SDK pda.ts files. */
export const LAUNCHLAB_SEEDS = Object.freeze({
  config: 'global_config',
  pool: 'pool',
  vault: 'pool_vault',
  auth: 'vault_auth_seed',
  eventAuth: '__event_authority',
  metadata: 'metadata',
  creatorFeeVaultAuth: 'creator_fee_vault_auth_seed',
  platformFeeVaultAuth: 'platform_fee_vault_auth_seed'
});

/** The SOL config's published defaults (API defaultParams) — starting values
    for the UI; the on-chain config is still the authority at runtime. */
export const LAUNCHLAB_DEFAULTS = Object.freeze({
  decimals: 6,
  supply: '1000000000000000', // base units (1B tokens at 6 decimals)
  totalSellA: '793100000000000',
  totalFundRaisingB: '85000000000', // 85 SOL in lamports
  migrateType: 'cpmm',
  cpmmCreatorFeeOn: 0 // SDK default: OnlyTokenB
});

/** Rate denominator for every LaunchLab fee/rate field (1/1_000_000). */
export const FEE_DENOMINATOR = 1000000n;
/** Metaplex on-chain field caps (initialize_v2 rejects longer values). */
export const METAPLEX_LIMITS = Object.freeze({ name: 32, symbol: 10, uri: 200 });

/**
 * Account sizes, counted from the SDK layouts (see the decoder offsets in §6):
 * pool 8+8+5+80+40+224+2+8+54 = 429; config 371; platform 944 (fixed).
 * Rent is computed FROM these sizes at runtime — never guessed.
 */
export const LAUNCHLAB_ACCOUNT_SIZE = Object.freeze({
  poolState: 429,
  globalConfig: 371,
  platformConfig: 944,
  vault: 165,
  mint: 82,
  /** Upper bound for the metadata account (Metaplex v1 max); the rent quote
      built on it is disclosed as "at most", never as exact. */
  metadataMax: 679
});

/* ── §2 · cluster selection ────────────────────────────────────────────── */

/**
 * Resolve cluster → program/config/platform. Devnet has its own program id;
 * the devnet CONFIG is derived the same way but may not exist on-chain —
 * the caller reads it live and reports CONFIG_NOT_FOUND honestly instead of
 * assuming mainnet addresses work there.
 */
export function launchlabClusterConfig(cluster) {
  const devnet = cluster === 'devnet';
  return {
    cluster: devnet ? 'devnet' : 'mainnet-beta',
    programId: devnet ? LAUNCHLAB_DEVNET_PROGRAM_ID : LAUNCHLAB_PROGRAM_ID,
    expectedConfigId: devnet ? null : LAUNCHLAB_SOL_CONFIG_MAINNET,
    platformId: RAYDIUM_PLATFORM_ID,
    quoteMint: WSOL_MINT,
    explorer: devnet ? 'https://explorer.solana.com?cluster=devnet' : 'https://explorer.solana.com'
  };
}

/* ── §3 · validation (sync, pure — no network, no wallet) ──────────────── */

/** Token identity rules: Metaplex caps + the SDK's client-side rejections. */
export function validateLaunchlabIdentity({ name, symbol, uri } = {}) {
  const problems = [];
  const n = String(name ?? '').trim();
  const s = String(symbol ?? '').trim();
  const u = String(uri ?? '').trim();
  if (!n) problems.push('NAME_REQUIRED');
  else if (n.length > METAPLEX_LIMITS.name) problems.push('NAME_TOO_LONG');
  if (!s) problems.push('SYMBOL_REQUIRED');
  else if (s.length > METAPLEX_LIMITS.symbol) problems.push('SYMBOL_TOO_LONG');
  if (!u) problems.push('URI_REQUIRED');
  else if (u.length > METAPLEX_LIMITS.uri) problems.push('URI_TOO_LONG');
  return { ok: problems.length === 0, problems, value: problems.length ? null : { name: n, symbol: s.toUpperCase(), uri: u } };
}

/**
 * Curve-parameter check — a line-by-line port of the SDK's Curve.checkParam,
 * with NAMED errors instead of thrown strings:
 *   · decimals must be 6 (the SDK rejects anything else client-side)
 *   · supply ≥ minSupplyA whole tokens (the SDK multiplies by 10^decimals)
 *   · totalSellA ≥ supply × minSellRateA / 1e6
 *   · totalFundRaisingB ≥ minFundRaisingB
 *   · supply − sell − locked ≥ supply × minMigrateRateA / 1e6
 *   · locked ≤ supply × maxLockRate / 1e6
 *   · sqrt(migrateA × raise) > minLockLp (100 for CPMM)
 * On-chain `initialize` re-checks all of this (InvalidInput on violation) and
 * the signing path simulates first — this gate exists to fail BEFORE any
 * wallet prompt, with a reason the UI can translate.
 */
export function checkCurveParams({
  supply, totalSellA, totalFundRaisingB, totalLockedAmount = 0n,
  decimals = 6, config, migrateType = 'cpmm'
} = {}) {
  const problems = [];
  try {
    if (Number(decimals) !== 6) problems.push('DECIMALS_MUST_BE_6');
    const S = BigInt(supply ?? 0);
    const sell = BigInt(totalSellA ?? 0);
    const raise = BigInt(totalFundRaisingB ?? 0);
    const locked = BigInt(totalLockedAmount ?? 0);
    if (!config) problems.push('CONFIG_REQUIRED');
    if (S <= 0n) problems.push('SUPPLY_MUST_BE_POSITIVE');
    if (sell <= 0n) problems.push('SELL_MUST_BE_POSITIVE');
    if (raise <= 0n) problems.push('RAISE_MUST_BE_POSITIVE');
    if (locked < 0n) problems.push('LOCKED_NEGATIVE');
    if (sell >= S) problems.push('SELL_EXCEEDS_SUPPLY');
    if (problems.length) return { ok: false, problems };
    const minSupply = BigInt(config.minSupplyA) * 10n ** BigInt(Number(decimals));
    if (S < minSupply) problems.push('SUPPLY_BELOW_CONFIG_MIN');
    const maxLocked = (S * BigInt(config.maxLockRate)) / FEE_DENOMINATOR;
    if (locked > maxLocked) problems.push('LOCKED_ABOVE_CONFIG_MAX');
    const minSell = (S * BigInt(config.minSellRateA)) / FEE_DENOMINATOR;
    if (sell < minSell) problems.push('SELL_BELOW_CONFIG_MIN');
    if (raise < BigInt(config.minFundRaisingB)) problems.push('RAISE_BELOW_CONFIG_MIN');
    const migrateA = S - sell - locked;
    const minMigrate = (S * BigInt(config.minMigrateRateA)) / FEE_DENOMINATOR;
    if (migrateA < minMigrate) problems.push('MIGRATE_BELOW_CONFIG_MIN');
    if (migrateA <= 0n) problems.push('NOTHING_LEFT_TO_MIGRATE');
    if (migrateType !== 'cpmm' && migrateType !== 'amm') problems.push('MIGRATE_TYPE_INVALID');
    // The liquidity sqrt is only meaningful on positive inputs; a
    // non-positive migrate amount is already reported above, and letting
    // isqrt throw here would mask the SPECIFIC codes as PARAMS_UNPARSEABLE.
    if (migrateA > 0n && raise > 0n) {
      const liquidity = isqrt(migrateA * raise);
      const minLockLp = migrateType === 'cpmm' ? 100n : 10n ** BigInt(Number(decimals));
      if (liquidity <= minLockLp) problems.push('MIGRATE_LIQUIDITY_TOO_SMALL');
    }
    return { ok: problems.length === 0, problems };
  } catch {
    return { ok: false, problems: ['PARAMS_UNPARSEABLE'] };
  }
}

/** Integer square root (Newton) — the SDK uses Decimal.sqrt; BigInt is exact. */
export function isqrt(n) {
  const v = BigInt(n);
  if (v < 0n) throw new Error('ISQRT_NEGATIVE');
  if (v < 2n) return v;
  let x = v;
  let y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + v / x) >> 1n; }
  return x;
}

/**
 * The live config account must be the SOL constant-product config: curve
 * type 0, index 0, WSOL quote mint. Anything else is a different market and
 * the plan refuses to bind to it.
 */
export function validateConfigAccount(decoded, { quoteMint = WSOL_MINT } = {}) {
  const problems = [];
  if (!decoded) return { ok: false, problems: ['CONFIG_UNREADABLE'] };
  if (decoded.curveType !== 0) problems.push('CONFIG_NOT_CONSTANT_PRODUCT');
  if (decoded.index !== 0) problems.push('CONFIG_NOT_SOL_INDEX');
  if (String(decoded.mintB) !== String(quoteMint)) problems.push('CONFIG_QUOTE_NOT_WSOL');
  return { ok: problems.length === 0, problems };
}

/**
 * The live platform account must not restrict launches: the Raydium platform
 * publishes restrictCurveParam = 0, and the flow passes no allow-config /
 * curve-rule accounts — so a restricting platform would revert on-chain.
 * Failing here (before simulation) names the reason instead.
 */
export function validatePlatformAccount(decoded) {
  const problems = [];
  if (!decoded) return { ok: false, problems: ['PLATFORM_UNREADABLE'] };
  if (decoded.restrictCurveParam !== 0) problems.push('PLATFORM_RESTRICTS_CURVE');
  if (decoded.restrictGlobalConfig !== 0) problems.push('PLATFORM_RESTRICTS_CONFIG');
  return { ok: problems.length === 0, problems };
}

/* ── §4 · curve math (BigInt port of constantProductCurve.ts) ──────────── */

/**
 * Virtual reserves at initialize — SDK LaunchConstantProductCurve.getInitParam:
 *   smsl = supply − sell − locked;  tfm = raise − migrateFee
 *   den  = tfm × sell / smsl − raise
 *   x0   = (tfm × sell² / smsl) / den        (virtualA)
 *   y0   = raise² / den                       (virtualB)
 * All division is floored, exactly like the SDK's BN.div.
 */
export function deriveInitReserves({ supply, totalSell, totalLockedAmount = 0n, totalFundRaising, migrateFee = 0n }) {
  const S = BigInt(supply);
  const sell = BigInt(totalSell);
  const locked = BigInt(totalLockedAmount);
  const raise = BigInt(totalFundRaising);
  const mf = BigInt(migrateFee);
  if (S <= sell) throw new Error('SUPPLY_LTE_SELL');
  const smsl = S - sell - locked;
  if (smsl <= 0n) throw new Error('SUPPLY_MINUS_SELL_LOCKED_LTE_ZERO');
  const tfm = raise - mf;
  if (tfm <= 0n) throw new Error('RAISE_MINUS_MIGRATE_FEE_LTE_ZERO');
  const numerator = ((tfm * sell * sell) / smsl);
  const denominator = ((tfm * sell) / smsl) - raise;
  if (denominator <= 0n) throw new Error('INIT_RESERVES_DENOMINATOR_LTE_ZERO');
  const x0 = numerator / denominator;
  const y0 = (raise * raise) / denominator;
  if (x0 < 0n || y0 < 0n) throw new Error('INIT_RESERVES_NEGATIVE');
  return { virtualA: x0, virtualB: y0 };
}

/** ceil(a × rate / 1e6) — SDK Curve.calculateFee. */
export function feeCeil(amount, rate) {
  const a = BigInt(amount);
  const r = BigInt(rate);
  if (a <= 0n || r <= 0n) return 0n;
  return (a * r + FEE_DENOMINATOR - 1n) / FEE_DENOMINATOR;
}

/**
 * First-buy quote — SDK Curve.buyExactIn minus transfer fees (both mints are
 * legacy SPL here, so transfer fees are zero by construction):
 *   fee = ceil(amountB × totalFeeRate / 1e6);  net = amountB − fee
 *   out = net × (Va − realA) / (Vb + realB + net)
 * `totalFeeRate` is trade + platform + creator + share, all live-read. The
 * caller derives minAmountOut by applying slippage; a min that is too HIGH
 * fails closed on-chain (revert, no fill), never fills short.
 */
export function quoteBuyExactIn({
  virtualA, virtualB, realA = 0n, realB = 0n, amountB, totalFeeRate = 0n, totalSellA = null
}) {
  const Va = BigInt(virtualA);
  const Vb = BigInt(virtualB);
  const rA = BigInt(realA);
  const rB = BigInt(realB);
  const inB = BigInt(amountB);
  if (inB <= 0n) throw new Error('BUY_AMOUNT_MUST_BE_POSITIVE');
  const outReserve = Va - rA;
  const inReserve = Vb + rB;
  if (outReserve <= 0n || inReserve <= 0n) throw new Error('CURVE_RESERVES_EXHAUSTED');
  const fee = feeCeil(inB, totalFeeRate);
  const net = inB - fee;
  if (net <= 0n) throw new Error('BUY_CONSUMED_BY_FEES');
  let out = (net * outReserve) / (inReserve + net);
  let capped = false;
  if (totalSellA != null) {
    const remaining = BigInt(totalSellA) - rA;
    if (out > remaining) { out = remaining < 0n ? 0n : remaining; capped = true; }
  }
  if (out <= 0n) throw new Error('BUY_QUOTES_ZERO');
  return { amountOut: out, fee, netIn: net, capped };
}

/** Slippage guard: floor(quoted × (1 − bps/10000)). */
export function minAmountOut(quoted, slippageBps) {
  const q = BigInt(quoted);
  const bps = BigInt(slippageBps);
  if (bps < 0n || bps > 10000n) throw new Error('SLIPPAGE_BPS_RANGE');
  return (q * (10000n - bps)) / 10000n;
}

/**
 * Exact decimal rendering for price ratios WITHOUT floating point:
 * formats num/den × 10^shift with `digits` decimals (truncated, trimmed).
 * Token prices routinely need 9+ decimals, where Number would lie.
 */
export function scaledRatioText(num, den, { shift = 0, digits = 9 } = {}) {
  let n = BigInt(num);
  const d = BigInt(den);
  if (d <= 0n) throw new Error('RATIO_DENOMINATOR_LTE_ZERO');
  const neg = n < 0n;
  if (neg) n = -n;
  const pow = 10n ** BigInt(digits);
  let scaled = (n * pow) / d;
  if (shift !== 0) {
    if (shift > 0) scaled *= 10n ** BigInt(shift);
    else scaled /= 10n ** BigInt(-shift);
  }
  const s = scaled.toString().padStart(digits + 1, '0');
  const head = s.slice(0, -digits) || '0';
  const tail = s.slice(-digits).replace(/0+$/, '');
  return (neg ? '-' : '') + head + (tail ? `.${tail}` : '');
}

/** Spot price quote-per-base at the given curve state (SDK getPoolPrice). */
export function spotPriceText({ virtualA, virtualB, realA = 0n, realB = 0n, decimalA = 6, decimalB = 9, digits = 9 }) {
  const num = BigInt(virtualB) + BigInt(realB);
  const den = BigInt(virtualA) - BigInt(realA);
  return scaledRatioText(num, den, { shift: decimalA - decimalB, digits });
}

/** End (migration) price — SDK getPoolEndPrice: (raise − fee) / migrateA. */
export function endPriceText({ supply, totalSell, totalLockedAmount = 0n, totalFundRaising, migrateFee = 0n, decimalA = 6, decimalB = 9, digits = 9 }) {
  const num = BigInt(totalFundRaising) - BigInt(migrateFee);
  const den = BigInt(supply) - BigInt(totalSell) - BigInt(totalLockedAmount);
  return scaledRatioText(num, den, { shift: decimalA - decimalB, digits });
}

/* ── §5 · base58 (decoders must not import web3) ───────────────────────── */

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const digits = [0];
  for (const byte of data) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let out = '';
  for (let i = 0; i < data.length - 1 && data[i] === 0; i += 1) out += '1';
  for (let i = digits.length - 1; i >= 0; i -= 1) out += B58_ALPHABET[digits[i]];
  return out;
}

export function base58Decode(str) {
  const bytes = [0];
  for (const ch of String(str)) {
    const value = B58_ALPHABET.indexOf(ch);
    if (value < 0) throw new Error('BAD_BASE58');
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i += 1) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

/* ── §6 · account decoders (offsets counted from the SDK layouts) ───────── */

function u64le(bytes, at) {
  let v = 0n;
  for (let i = 0; i < 8; i += 1) v |= BigInt(bytes[at + i]) << BigInt(8 * i);
  return v;
}
function u16le(bytes, at) {
  return bytes[at] | (bytes[at + 1] << 8);
}
function pubkeyAt(bytes, at) {
  return base58Encode(bytes.subarray(at, at + 32));
}
function checkDisc(bytes, expected, code) {
  if (bytes.length < 8 || !expected.every((b, i) => bytes[i] === b)) throw new Error(code);
}

/**
 * GlobalConfig — SDK layout.ts LaunchpadConfig:
 * disc(8) epoch(8) curveType(1) index(2) migrateFee(8) tradeFeeRate(8)
 * maxShareFeeRate(8) minSupplyA(8) maxLockRate(8) minSellRateA(8)
 * minMigrateRateA(8) minFundRaisingB(8) mintB(32) protocolFeeOwner(32)
 * migrateFeeOwner(32) migrateToAmmWallet(32) migrateToCpmmWallet(32) pad(128).
 */
export function decodeLaunchpadConfig(raw) {
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  checkDisc(bytes, LAUNCHLAB_ACCOUNT_DISC.globalConfig, 'CONFIG_DISCRIMINATOR_MISMATCH');
  if (bytes.length < LAUNCHLAB_ACCOUNT_SIZE.globalConfig) throw new Error('CONFIG_TRUNCATED');
  return {
    epoch: u64le(bytes, 8).toString(),
    curveType: bytes[16],
    index: u16le(bytes, 17),
    migrateFee: u64le(bytes, 19).toString(),
    tradeFeeRate: u64le(bytes, 27).toString(),
    maxShareFeeRate: u64le(bytes, 35).toString(),
    minSupplyA: u64le(bytes, 43).toString(),
    maxLockRate: u64le(bytes, 51).toString(),
    minSellRateA: u64le(bytes, 59).toString(),
    minMigrateRateA: u64le(bytes, 67).toString(),
    minFundRaisingB: u64le(bytes, 75).toString(),
    mintB: pubkeyAt(bytes, 83),
    protocolFeeOwner: pubkeyAt(bytes, 115),
    migrateFeeOwner: pubkeyAt(bytes, 147),
    migrateToAmmWallet: pubkeyAt(bytes, 179),
    migrateToCpmmWallet: pubkeyAt(bytes, 211)
  };
}

/**
 * PoolState — SDK layout.ts LaunchpadPool:
 * disc(8) epoch(8) bump status mintDecA mintDecB migrateType (5×u8)
 * supply totalSellA virtualA virtualB realA realB totalFundRaisingB
 * protocolFee platformFee migrateFee (10×u64) vestingSchedule (5×u64)
 * configId platformId mintA mintB vaultA vaultB creator (7×32)
 * mintProgramFlag cpmmCreatorFeeOn (2×u8) platformVestingShare(8) pad(54).
 */
export function decodeLaunchpadPool(raw) {
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  checkDisc(bytes, LAUNCHLAB_ACCOUNT_DISC.poolState, 'POOL_DISCRIMINATOR_MISMATCH');
  if (bytes.length < LAUNCHLAB_ACCOUNT_SIZE.poolState) throw new Error('POOL_TRUNCATED');
  let at = 8;
  const out = { epoch: u64le(bytes, at).toString() };
  at += 8;
  out.bump = bytes[at];
  out.status = bytes[at + 1];
  out.mintDecimalsA = bytes[at + 2];
  out.mintDecimalsB = bytes[at + 3];
  out.migrateType = bytes[at + 4];
  at += 5;
  const u64s = ['supply', 'totalSellA', 'virtualA', 'virtualB', 'realA', 'realB',
    'totalFundRaisingB', 'protocolFee', 'platformFee', 'migrateFee'];
  for (const k of u64s) { out[k] = u64le(bytes, at).toString(); at += 8; }
  out.vestingSchedule = {
    totalLockedAmount: u64le(bytes, at).toString(),
    cliffPeriod: u64le(bytes, at + 8).toString(),
    unlockPeriod: u64le(bytes, at + 16).toString(),
    startTime: u64le(bytes, at + 24).toString(),
    totalAllocatedShare: u64le(bytes, at + 32).toString()
  };
  at += 40;
  for (const k of ['configId', 'platformId', 'mintA', 'mintB', 'vaultA', 'vaultB', 'creator']) {
    out[k] = pubkeyAt(bytes, at);
    at += 32;
  }
  out.mintProgramFlag = bytes[at];
  out.cpmmCreatorFeeOn = bytes[at + 1];
  at += 2;
  out.platformVestingShare = u64le(bytes, at).toString();
  return out;
}

/**
 * PlatformConfig — SDK layout.ts PlatformConfig (fixed 944 bytes). Only the
 * fields the flow needs are decoded: both fee rates, the vesting scale, and
 * the two restriction flags. Offsets: disc(8) epoch(8) claimWallet(32)
 * lockNftWallet(32) platformScale(8) creatorScale(8) burnScale(8) feeRate(8)
 * name(64) web(256) img(256) cpConfigId(32) creatorFeeRate(8)
 * transferFeeExtensionAuth(32) platformVestingWallet(32)
 * platformVestingScale(8) platformCpCreator(32) restrictGlobalConfig(1)
 * restrictCurveParam(1) curveRuleManager(32) pad(78).
 */
export function decodeLaunchpadPlatform(raw) {
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  checkDisc(bytes, LAUNCHLAB_ACCOUNT_DISC.platformConfig, 'PLATFORM_DISCRIMINATOR_MISMATCH');
  if (bytes.length < LAUNCHLAB_ACCOUNT_SIZE.platformConfig) throw new Error('PLATFORM_TRUNCATED');
  return {
    platformClaimFeeWallet: pubkeyAt(bytes, 16),
    platformLockNftWallet: pubkeyAt(bytes, 48),
    platformScale: u64le(bytes, 80).toString(),
    creatorScale: u64le(bytes, 88).toString(),
    burnScale: u64le(bytes, 96).toString(),
    feeRate: u64le(bytes, 104).toString(),
    cpConfigId: pubkeyAt(bytes, 688),
    creatorFeeRate: u64le(bytes, 720).toString(),
    platformVestingWallet: pubkeyAt(bytes, 760),
    platformVestingScale: u64le(bytes, 792).toString(),
    platformCpCreator: pubkeyAt(bytes, 800),
    restrictGlobalConfig: bytes[832],
    restrictCurveParam: bytes[833]
  };
}

/**
 * The pool back-check: a pool is YOURS only if its decoded state names your
 * mint, your config, your platform, your creator wallet and your economics.
 * Runs on the LIVE account after confirmation (see ./verify.js) — the probe
 * feeds it synthetic states.
 */
export function verifyPoolState(decoded, expected = {}) {
  const problems = [];
  if (!decoded) return { ok: false, problems: ['POOL_STATE_MISSING'] };
  const eq = (field, want, code) => {
    if (want != null && String(decoded[field]) !== String(want)) problems.push(code);
  };
  eq('mintA', expected.mintA, 'POOL_MINT_A_MISMATCH');
  eq('mintB', expected.mintB, 'POOL_MINT_B_MISMATCH');
  eq('configId', expected.configId, 'POOL_CONFIG_MISMATCH');
  eq('platformId', expected.platformId, 'POOL_PLATFORM_MISMATCH');
  eq('creator', expected.creator, 'POOL_CREATOR_MISMATCH');
  eq('supply', expected.supply, 'POOL_SUPPLY_MISMATCH');
  eq('totalSellA', expected.totalSellA, 'POOL_SELL_MISMATCH');
  eq('totalFundRaisingB', expected.totalFundRaisingB, 'POOL_RAISE_MISMATCH');
  eq('vaultA', expected.vaultA, 'POOL_VAULT_A_MISMATCH');
  eq('vaultB', expected.vaultB, 'POOL_VAULT_B_MISMATCH');
  if (expected.mintDecimalsA != null && decoded.mintDecimalsA !== Number(expected.mintDecimalsA)) {
    problems.push('POOL_DECIMALS_A_MISMATCH');
  }
  if (expected.migrateType != null && decoded.migrateType !== Number(expected.migrateType)) {
    problems.push('POOL_MIGRATE_TYPE_MISMATCH');
  }
  if (expected.status != null && decoded.status !== Number(expected.status)) {
    problems.push('POOL_STATUS_MISMATCH');
  }
  return { ok: problems.length === 0, problems };
}

/* ── §7 · PDA derivation (async — needs web3) ──────────────────────────── */

let web3Promise = null;
function web3() {
  if (!web3Promise) web3Promise = import('@solana/web3.js');
  return web3Promise;
}

/**
 * Every address the flow touches, derived — never chosen. Mirrors the SDK's
 * getPda* helpers seed for seed (launchpad/pda.ts + clmm POOL_SEED):
 *   config  ["global_config", mintB, u8(curveType), u16(index)]
 *   pool    ["pool", mintA, mintB]
 *   vault   ["pool_vault", pool, mint]
 *   auth    ["vault_auth_seed"]
 *   event   ["__event_authority"]
 *   metadata["metadata", METADATA_PROGRAM, mintA] (under the metadata program)
 *   creator fee vault  [creator, mintB]      (under the launchpad program)
 *   platform fee vault [platformId, mintB]   (under the launchpad program)
 */
export async function deriveLaunchpadAddresses({
  programId, mintA, mintB = WSOL_MINT, creator, platformId = RAYDIUM_PLATFORM_ID,
  curveType = 0, index = 0
}) {
  if (!programId || !mintA || !creator) throw new Error('PDA_INPUTS_REQUIRED');
  const { PublicKey } = await web3();
  const prog = new PublicKey(programId);
  const a = new PublicKey(mintA);
  const b = new PublicKey(mintB);
  const creatorKey = new PublicKey(creator);
  const platformKey = new PublicKey(platformId);
  const find = (seeds, program = prog) => PublicKey.findProgramAddressSync(seeds, program)[0].toBase58();
  const u16Bytes = new Uint8Array(2);
  new DataView(u16Bytes.buffer).setUint16(0, Number(index), true);
  const configId = find([
    Buffer.from(LAUNCHLAB_SEEDS.config, 'utf8'), b.toBuffer(), Uint8Array.from([Number(curveType)]), u16Bytes
  ]);
  const poolId = find([Buffer.from(LAUNCHLAB_SEEDS.pool, 'utf8'), a.toBuffer(), b.toBuffer()]);
  const poolBuf = new PublicKey(poolId).toBuffer();
  const metaProg = new PublicKey(METADATA_PROGRAM_ID);
  return {
    programId: prog.toBase58(),
    configId,
    poolId,
    vaultA: find([Buffer.from(LAUNCHLAB_SEEDS.vault, 'utf8'), poolBuf, a.toBuffer()]),
    vaultB: find([Buffer.from(LAUNCHLAB_SEEDS.vault, 'utf8'), poolBuf, b.toBuffer()]),
    auth: find([Buffer.from(LAUNCHLAB_SEEDS.auth, 'utf8')]),
    eventAuth: find([Buffer.from(LAUNCHLAB_SEEDS.eventAuth, 'utf8')]),
    metadataId: find(
      [Buffer.from(LAUNCHLAB_SEEDS.metadata, 'utf8'), metaProg.toBuffer(), a.toBuffer()],
      metaProg
    ),
    creatorFeeVault: find([creatorKey.toBuffer(), b.toBuffer()]),
    platformFeeVault: find([platformKey.toBuffer(), b.toBuffer()]),
    platformId: platformKey.toBase58()
  };
}

/* ── §8 · instruction builders (async — need web3) ─────────────────────── */

function encodeAnchorString(str) {
  const bytes = Buffer.from(String(str), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}
function encodeU64(v) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(v), 0);
  return out;
}

/**
 * initialize_v2 — THE launch instruction. Account order is the SDK's
 * instrument.ts initializeV2, position for position (18 accounts):
 * payer(s,w) creator config platform auth pool(w) mintA(s,w) mintB vaultA(w)
 * vaultB(w) metadata(w) tokenProgramA tokenProgramB metadataProgram system
 * rent eventAuth program. Data: discriminator | decimals u8 | name symbol uri
 * (Anchor strings) | ConstantCurve {index 0, supply u64, totalSellA u64,
 * totalFundRaisingB u64, migrateType u8} | totalLocked u64 | cliff u64 |
 * unlock u64 | cpmmCreatorFeeOn u8.
 */
export async function buildInitializeV2({
  programId, payer, creator, configId, platformId, auth, poolId,
  mintA, mintB = WSOL_MINT, vaultA, vaultB, metadataId,
  decimals = 6, name, symbol, uri,
  supply, totalSellA, totalFundRaisingB, migrateType = 'cpmm',
  totalLockedAmount = 0n, cliffPeriod = 0n, unlockPeriod = 0n,
  cpmmCreatorFeeOn = 0
}) {
  const id = validateLaunchlabIdentity({ name, symbol, uri });
  if (!id.ok) {
    const err = new Error(id.problems[0]);
    err.detail = id.problems;
    throw err;
  }
  const { PublicKey, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } = await web3();
  const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
  const keys = [
    [payer, true, true], [creator, false, false], [configId, false, false],
    [platformId, false, false], [auth, false, false], [poolId, false, true],
    [mintA, true, true], [mintB, false, false], [vaultA, false, true],
    [vaultB, false, true], [metadataId, false, true],
    [TOKEN_PROGRAM_ID.toBase58(), false, false], [TOKEN_PROGRAM_ID.toBase58(), false, false],
    [METADATA_PROGRAM_ID, false, false]
  ].map(([pubkey, isSigner, isWritable]) => ({
    pubkey: pubkey instanceof PublicKey ? pubkey : new PublicKey(pubkey),
    isSigner, isWritable
  }));
  const eventProg = new PublicKey(programId);
  const [eventAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from(LAUNCHLAB_SEEDS.eventAuth, 'utf8')], eventProg);
  keys.push(
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: eventAuth, isSigner: false, isWritable: false },
    { pubkey: eventProg, isSigner: false, isWritable: false }
  );
  const data = Buffer.concat([
    Buffer.from(LAUNCHLAB_IX.initializeV2),
    Buffer.from([Number(decimals)]),
    encodeAnchorString(name), encodeAnchorString(symbol), encodeAnchorString(uri),
    Buffer.from([0]), // ConstantCurve index — the only curve this flow offers
    encodeU64(supply), encodeU64(totalSellA), encodeU64(totalFundRaisingB),
    Buffer.from([migrateType === 'amm' ? 0 : 1]),
    encodeU64(totalLockedAmount), encodeU64(cliffPeriod), encodeU64(unlockPeriod),
    Buffer.from([Number(cpmmCreatorFeeOn)])
  ]);
  return {
    id: 'launchlab-initialize',
    description: `Create ${symbol} on the LaunchLab bonding curve (mint + metadata + pool + vaults, one instruction)`,
    instruction: new TransactionInstruction({ programId: eventProg, keys, data })
  };
}

/**
 * buy_exact_in — the optional first buy. Account order is the SDK's
 * buyExactInInstruction: the 15-account core (owner(s,w) auth config platform
 * pool(w) userA(w) userB(w) vaultA(w) vaultB(w) mintA mintB programA programB
 * eventAuth program) + SystemProgram + platformClaimFeeVault(w) +
 * creatorClaimFeeVault(w). No share receiver: shareFeeRate is always 0 here,
 * so no referral account is passed. Data: discriminator | amountB u64 |
 * minAmountA u64 | shareFeeRate u64.
 */
export async function buildBuyExactIn({
  programId, owner, auth, configId, platformId, poolId,
  userTokenAccountA, userTokenAccountB, vaultA, vaultB,
  mintA, mintB = WSOL_MINT, platformClaimFeeVault, creatorClaimFeeVault,
  amountB, minAmountA
}) {
  if (BigInt(amountB ?? 0) <= 0n) throw new Error('BUY_AMOUNT_MUST_BE_POSITIVE');
  if (BigInt(minAmountA ?? -1n) < 0n) throw new Error('MIN_AMOUNT_NEGATIVE');
  const { PublicKey, TransactionInstruction, SystemProgram } = await web3();
  const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
  const keys = [
    [owner, true, true], [auth, false, false], [configId, false, false],
    [platformId, false, false], [poolId, false, true],
    [userTokenAccountA, false, true], [userTokenAccountB, false, true],
    [vaultA, false, true], [vaultB, false, true],
    [mintA, false, false], [mintB, false, false],
    [TOKEN_PROGRAM_ID.toBase58(), false, false], [TOKEN_PROGRAM_ID.toBase58(), false, false]
  ].map(([pubkey, isSigner, isWritable]) => ({
    pubkey: pubkey instanceof PublicKey ? pubkey : new PublicKey(pubkey),
    isSigner, isWritable
  }));
  const prog = new PublicKey(programId);
  const [eventAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from(LAUNCHLAB_SEEDS.eventAuth, 'utf8')], prog);
  keys.push(
    { pubkey: eventAuth, isSigner: false, isWritable: false },
    { pubkey: prog, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(platformClaimFeeVault), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(creatorClaimFeeVault), isSigner: false, isWritable: true }
  );
  const data = Buffer.concat([
    Buffer.from(LAUNCHLAB_IX.buyExactIn),
    encodeU64(amountB), encodeU64(minAmountA), encodeU64(0n) // shareFeeRate: no referrer
  ]);
  return {
    id: 'launchlab-buy',
    description: 'First buy on the new curve (WSOL in, protected by a slippage minimum)',
    instruction: new TransactionInstruction({ programId: prog, keys, data })
  };
}

/**
 * WSOL wrap / unwrap legs for the buy transaction. The buy instruction moves
 * WSOL, but the user holds native SOL — so the transaction wraps first
 * (transfer + syncNative on the user's WSOL ATA, created idempotently) and
 * closes the WSOL account afterwards, returning any dust as native SOL.
 */
export async function buildWrapSol({ payer, lamports }) {
  if (BigInt(lamports ?? 0) <= 0n) throw new Error('WRAP_AMOUNT_MUST_BE_POSITIVE');
  const { PublicKey, SystemProgram, TransactionInstruction } = await web3();
  const {
    TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT,
    getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
    createSyncNativeInstruction
  } = await import('@solana/spl-token');
  const owner = new PublicKey(payer);
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  return {
    wsolAccount: wsolAta.toBase58(),
    items: [
      {
        id: 'wrap-ensure-wsol-account',
        description: 'Ensure your WSOL account exists (no-op if it already does)',
        instruction: createAssociatedTokenAccountIdempotentInstruction(
          owner, wsolAta, owner, NATIVE_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
      },
      {
        id: 'wrap-transfer-sol',
        description: 'Move SOL into the WSOL account for the buy',
        instruction: SystemProgram.transfer({
          fromPubkey: owner, toPubkey: wsolAta, lamports: BigInt(lamports)
        })
      },
      {
        id: 'wrap-sync-native',
        description: 'Wrap the SOL so the curve can spend it',
        instruction: createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID)
      }
    ],
    closeInstruction: { id: 'wrap-close-wsol', description: 'Return leftover WSOL dust as native SOL' }
  };
}

/** Idempotent ATA creation for the creator's new-token account (buy leg). */
export async function buildEnsureTokenAccount({ payer, mint }) {
  const { PublicKey } = await web3();
  const {
    TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction
  } = await import('@solana/spl-token');
  const owner = new PublicKey(payer);
  const mintKey = new PublicKey(mint);
  const ata = getAssociatedTokenAddressSync(mintKey, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  return {
    tokenAccount: ata.toBase58(),
    item: {
      id: 'buy-ensure-token-account',
      description: 'Ensure your account for the new token exists',
      instruction: createAssociatedTokenAccountIdempotentInstruction(
        owner, ata, owner, mintKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    }
  };
}

/** Close the WSOL account after the buy — dust comes back as native SOL. */
export async function buildCloseWsol({ payer, wsolAccount }) {
  const { PublicKey } = await web3();
  const { TOKEN_PROGRAM_ID, createCloseAccountInstruction } = await import('@solana/spl-token');
  return {
    id: 'wrap-close-wsol',
    description: 'Return leftover WSOL dust as native SOL',
    instruction: createCloseAccountInstruction(
      new PublicKey(wsolAccount), new PublicKey(payer), new PublicKey(payer), [], TOKEN_PROGRAM_ID)
  };
}

/* ── §9 · plan assembly ────────────────────────────────────────────────── */

/**
 * Assemble the full launch plan: addresses → identity check → curve check →
 * init instruction (+ buy legs when a first buy is requested).
 *
 * `mintKeypair` is generated on the user's device and MUST partial-sign the
 * create transaction (see ./signing.js) — it never leaves memory. `config`
 * and `platform` are the LIVE-decoded accounts (see ./verify.js), never the
 * pinned API values: the pinned values are only the UI's starting point.
 */
export async function buildLaunchlabPlan({
  cluster = 'mainnet-beta', creator, mintKeypair,
  name, symbol, uri, decimals = 6,
  supply, totalSellA, totalFundRaisingB,
  config, platform = null,
  firstBuyLamports = 0n, slippageBps = 100
}) {
  if (!creator) throw new Error('CREATOR_REQUIRED');
  if (!mintKeypair?.publicKey) throw new Error('MINT_KEYPAIR_REQUIRED');
  const cc = launchlabClusterConfig(cluster);
  const mintA = mintKeypair.publicKey.toBase58();
  const addresses = await deriveLaunchpadAddresses({
    programId: cc.programId, mintA, mintB: cc.quoteMint, creator, platformId: cc.platformId
  });
  if (cc.expectedConfigId && addresses.configId !== cc.expectedConfigId) {
    const err = new Error('CONFIG_DERIVATION_MISMATCH');
    err.detail = { derived: addresses.configId, expected: cc.expectedConfigId };
    throw err;
  }
  const idCheck = validateLaunchlabIdentity({ name, symbol, uri });
  if (!idCheck.ok) {
    const err = new Error(idCheck.problems[0]);
    err.detail = idCheck.problems;
    throw err;
  }
  const curveCheck = checkCurveParams({
    supply, totalSellA, totalFundRaisingB, totalLockedAmount: 0n,
    decimals, config, migrateType: LAUNCHLAB_DEFAULTS.migrateType
  });
  if (!curveCheck.ok) {
    const err = new Error(curveCheck.problems[0]);
    err.detail = curveCheck.problems;
    throw err;
  }
  const cfgCheck = validateConfigAccount(config, { quoteMint: cc.quoteMint });
  if (!cfgCheck.ok) {
    const err = new Error(cfgCheck.problems[0]);
    err.detail = cfgCheck.problems;
    throw err;
  }
  const reserves = deriveInitReserves({
    supply, totalSell: totalSellA, totalLockedAmount: 0n,
    totalFundRaising: totalFundRaisingB, migrateFee: config.migrateFee ?? 0n
  });

  const createItems = [await buildInitializeV2({
    programId: cc.programId, payer: creator, creator, configId: addresses.configId,
    platformId: addresses.platformId, auth: addresses.auth, poolId: addresses.poolId,
    mintA, mintB: cc.quoteMint, vaultA: addresses.vaultA, vaultB: addresses.vaultB,
    metadataId: addresses.metadataId, decimals, name: idCheck.value.name,
    symbol: idCheck.value.symbol, uri: idCheck.value.uri,
    supply, totalSellA, totalFundRaisingB, migrateType: LAUNCHLAB_DEFAULTS.migrateType,
    cpmmCreatorFeeOn: LAUNCHLAB_DEFAULTS.cpmmCreatorFeeOn
  })];

  const economics = {
    initPrice: spotPriceText({
      virtualA: reserves.virtualA, virtualB: reserves.virtualB,
      decimalA: Number(decimals), decimalB: 9
    }),
    endPrice: endPriceText({
      supply, totalSell: totalSellA, totalFundRaising: totalFundRaisingB,
      migrateFee: config.migrateFee ?? 0n, decimalA: Number(decimals), decimalB: 9
    }),
    virtualA: reserves.virtualA.toString(),
    virtualB: reserves.virtualB.toString()
  };

  // ── optional first buy (second transaction, after the create confirms) ──
  let buy = null;
  const buyLamports = BigInt(firstBuyLamports ?? 0);
  if (buyLamports > 0n) {
    if (!platform) throw new Error('PLATFORM_REQUIRED_FOR_BUY');
    const platCheck = validatePlatformAccount(platform);
    if (!platCheck.ok) {
      const err = new Error(platCheck.problems[0]);
      err.detail = platCheck.problems;
      throw err;
    }
    const totalFeeRate = BigInt(config.tradeFeeRate)
      + BigInt(platform.feeRate) + BigInt(platform.creatorFeeRate);
    if (totalFeeRate > FEE_DENOMINATOR) throw new Error('TOTAL_FEE_RATE_GT_DENOMINATOR');
    const quote = quoteBuyExactIn({
      virtualA: reserves.virtualA, virtualB: reserves.virtualB,
      amountB: buyLamports, totalFeeRate, totalSellA
    });
    if (quote.capped) throw new Error('FIRST_BUY_EXCEEDS_CURVE');
    const minOut = minAmountOut(quote.amountOut, slippageBps);
    const wrap = await buildWrapSol({ payer: creator, lamports: buyLamports });
    const tokenAccount = await buildEnsureTokenAccount({ payer: creator, mint: mintA });
    const buyIx = await buildBuyExactIn({
      programId: cc.programId, owner: creator, auth: addresses.auth,
      configId: addresses.configId, platformId: addresses.platformId, poolId: addresses.poolId,
      userTokenAccountA: tokenAccount.tokenAccount, userTokenAccountB: wrap.wsolAccount,
      vaultA: addresses.vaultA, vaultB: addresses.vaultB, mintA, mintB: cc.quoteMint,
      platformClaimFeeVault: addresses.platformFeeVault,
      creatorClaimFeeVault: addresses.creatorFeeVault,
      amountB: buyLamports, minAmountA: minOut
    });
    const close = await buildCloseWsol({ payer: creator, wsolAccount: wrap.wsolAccount });
    economics.firstBuy = {
      lamports: buyLamports.toString(),
      quotedOut: quote.amountOut.toString(),
      fee: quote.fee.toString(),
      minOut: minOut.toString(),
      totalFeeRate: totalFeeRate.toString()
    };
    buy = {
      items: [...wrap.items, tokenAccount.item, buyIx, close],
      userTokenAccountA: tokenAccount.tokenAccount,
      userTokenAccountB: wrap.wsolAccount
    };
  }

  return {
    cluster: cc.cluster,
    programId: cc.programId,
    addresses: { ...addresses, mintA, creator },
    identity: idCheck.value,
    params: {
      decimals: Number(decimals),
      supply: BigInt(supply).toString(),
      totalSellA: BigInt(totalSellA).toString(),
      totalFundRaisingB: BigInt(totalFundRaisingB).toString(),
      migrateType: LAUNCHLAB_DEFAULTS.migrateType
    },
    economics,
    create: { items: createItems, extraSigners: ['mint'] },
    buy,
    explorer: cc.explorer
  };
}

/**
 * Build a self-contained metadata descriptor when the user has no hosted URL.
 * Wallets read name/symbol from the on-chain Metadata account itself; the URI
 * JSON only carries image/description. A data: URI keeps the launch working
 * with ZERO external dependency — a dead https URL would be strictly worse.
 * Always validated against the 200-char Metaplex cap by the caller.
 */
export function buildDataUri({ name, symbol, description = '' }) {
  const doc = { name: String(name ?? ''), symbol: String(symbol ?? '') };
  const desc = String(description ?? '').trim();
  if (desc) doc.description = desc;
  // Compact JSON, then minimal escaping: a data: URI must not contain raw
  // spaces/quotes — encodeURIComponent is exact but verbose, so the caller
  // checks the 200-char cap and the UI truncates the description first.
  return `data:application/json,${encodeURIComponent(JSON.stringify(doc))}`;
}
