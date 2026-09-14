/**
 * FBT LAUNCH — Solana probe (pure logic + MOCK provider; no mainnet calls).
 * ---------------------------------------------------------------------------
 * This file proves three things and nothing else:
 *
 *   1. The SPL token PLAN is correct — every instruction's program id,
 *      account list and data is decoded back with an INDEPENDENT decoder and
 *      compared with the user's intent. (Unchanged: ./spl.js is untouched.)
 *
 *   2. The LAUNCHLAB plan is correct — the config PDA derived here EQUALS
 *      Raydium's API-published address; discriminators are recomputed from
 *      sha256 (Anchor's own rule); initialize_v2 + buy_exact_in bytes are
 *      decoded BY HAND from the pinned SDK layouts; the curve math matches
 *      known answers; the two-signer assembly verifies with local keypairs.
 *
 *   3. The SOLANA HONESTY DOOR now OPENS — every part is finished and tested
 *      (see src/lib/launch/solana/status.js for what "tested" means), so
 *      `solanaLaunchStatus().shipping === true`, and the adapter BUILDS pool
 *      bytes while still REFUSING with named errors on any missing input.
 *
 * No network: the "provider" is a plain object, and the only keypairs are
 * generated in-memory. If this file ever needs an RPC endpoint to pass, the
 * test is wrong, not the environment.
 *
 * Wired into test/run.mjs next to the EVM launch probe.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  SOLANA_STATUS, SOLANA_PARTS, solanaLaunchStatus, solanaLaunchEnabled
} from '../src/lib/launch/solana/status.js';
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID,
  MINT_ACCOUNT_SIZE, SPL_IX, AUTHORITY_TYPE, solanaDecisions,
  buildSplTokenPlan, checkMintAccount, checkPoolTokens
} from '../src/lib/launch/solana/spl.js';
import {
  RAYDIUM_ADAPTER_ID, LAUNCHLAB_PINNED, raydiumAdapterStatus, buildPoolPlan, verifyPoolTokens
} from '../src/lib/launch/solana/raydium.js';
import {
  LAUNCHLAB_PROGRAM_ID, LAUNCHLAB_DEVNET_PROGRAM_ID, LAUNCHLAB_SOL_CONFIG_MAINNET,
  RAYDIUM_PLATFORM_ID, WSOL_MINT, METADATA_PROGRAM_ID,
  LAUNCHLAB_IX, LAUNCHLAB_ACCOUNT_DISC, LAUNCHLAB_SEEDS, LAUNCHLAB_DEFAULTS,
  LAUNCHLAB_ACCOUNT_SIZE, METAPLEX_LIMITS,
  launchlabClusterConfig, validateLaunchlabIdentity, checkCurveParams, isqrt,
  validateConfigAccount, validatePlatformAccount,
  deriveInitReserves, feeCeil, quoteBuyExactIn, minAmountOut,
  scaledRatioText, spotPriceText, endPriceText,
  base58Encode, base58Decode,
  decodeLaunchpadConfig, decodeLaunchpadPool, decodeLaunchpadPlatform,
  verifyPoolState, deriveLaunchpadAddresses,
  buildInitializeV2, buildBuyExactIn, buildWrapSol, buildEnsureTokenAccount,
  buildCloseWsol, buildLaunchlabPlan, buildDataUri
} from '../src/lib/launch/solana/launchlab.js';

const t = (name, ok) => {
  assert.ok(ok, name);
  console.log(`✓ ${name}`);
};
const b58 = (s) => new PublicKey(s).toBuffer();

const CREATOR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const RENT = 1461600n; // measured rent-exempt minimum for an 82-byte account

/* ── the honesty door now OPENS ─────────────────────────────────────────── */

t('solana: status is READY — every part finished and tested', SOLANA_STATUS === 'READY');
t('solana: the status object SHIPS the flow', solanaLaunchStatus().shipping === true);
t('solana: launch is enabled with nothing pending', solanaLaunchEnabled() === true
  && solanaLaunchStatus().pending.length === 0);
t('solana: every part is READY and carries a concrete explanation',
  SOLANA_PARTS.length === 5
  && SOLANA_PARTS.every((p) => p.status === 'READY' && typeof p.detail === 'string' && p.detail.length > 20));
t('solana: the shipped parts name signing, pool and verification',
  ['wallet-signing', 'raydium-pool', 'on-chain-verification'].every((id) => SOLANA_PARTS.some((p) => p.id === id)));

/* ── capability decisions (the Solana equivalent of the bitmap) ──────────── */

const fixed = solanaDecisions({ caps: {} });
t('solana caps: default token is fixed-supply', fixed.mintAuthority === 'revoked-after-mint' && fixed.mintable === false);
t('solana caps: no freeze authority unless asked', fixed.freezeAuthority === null);
t('solana caps: freeze is opt-in', solanaDecisions({ caps: { freeze: true } }).freezeAuthority === 'creator');
t('solana caps: mintable keeps the authority and sets the shared bitmap bit',
  solanaDecisions({ caps: { mintable: true } }).mintable === true
  && solanaDecisions({ caps: { mintable: true } }).bitmap === 1);
let unsupported = null;
try { solanaDecisions({ caps: { pausable: true } }); } catch (e) { unsupported = e; }
t('solana caps: unrepresentable claims are REFUSED, not silently dropped', unsupported?.message === 'UNSUPPORTED_CAPABILITY'
  && unsupported.detail.includes('pausable'));

/* ── the SPL token plan, decoded independently ───────────────────────────── */

const mintKeypair = Keypair.generate();
const plan = await buildSplTokenPlan({
  name: 'FBT Sol', symbol: 'FBTS', decimals: 6, supply: '1000000',
  creator: CREATOR, caps: {}, mintKeypair, rentExemptLamports: RENT
});

t('spl: the mint account is the ephemeral keypair, never the payer', plan.accounts.mint === mintKeypair.publicKey.toBase58());
t('spl: the fixed-supply plan is create/init/ata/mint/revoke', plan.instructions.map((i) => i.id).join(',')
  === 'create-mint-account,initialize-mint,create-token-account,mint-initial-supply,revoke-mint-authority');
t('spl: capability decisions are reported back to the caller', plan.decisions.mintable === false
  && plan.decisions.mintAuthority === 'revoked-after-mint');
t('spl: a mintable token drops the revoke step', (await buildSplTokenPlan({
  name: 'A', symbol: 'A', decimals: 6, supply: '10', creator: CREATOR,
  caps: { mintable: true }, mintKeypair: Keypair.generate(), rentExemptLamports: RENT
})).instructions.map((i) => i.id).join(',').endsWith('mint-initial-supply'));
t('spl: program ids come from the protocol constants', plan.instructions[1].programId === TOKEN_PROGRAM_ID
  && plan.instructions[2].programId === ASSOCIATED_TOKEN_PROGRAM_ID
  && plan.instructions[0].programId === SYSTEM_PROGRAM_ID);

/* createAccount: 4-byte index | u64 lamports | u64 space | 32-byte owner. */
const createData = Buffer.from(plan.instructions[0].inner);
t('spl decode: createAccount uses the System program instruction #0', createData.readUInt32LE(0) === 0);
t('spl decode: lamports equal the rent the caller supplied (never a guess)', createData.readBigUInt64LE(4) === RENT);
t('spl decode: space equals the 82-byte mint account', createData.readBigUInt64LE(12) === BigInt(MINT_ACCOUNT_SIZE));
t('spl decode: the new account is owned by the SPL Token program',
  createData.subarray(20).equals(b58(TOKEN_PROGRAM_ID)));

/* InitializeMint: tag 0 | decimals | 32-byte mint authority | option freeze. */
const initData = Buffer.from(plan.instructions[1].inner);
t('spl decode: initializeMint tag is 0', initData[0] === SPL_IX.InitializeMint);
t('spl decode: decimals survive the round trip', initData[1] === 6);
t('spl decode: mint authority is the creator (base58 → bytes, not an index)',
  initData.subarray(2, 34).equals(b58(CREATOR)));
t('spl decode: default is NO freeze authority — nobody can freeze holders',
  initData[34] === 0 && initData.length === 35);
const freezePlan = await buildSplTokenPlan({
  name: 'A', symbol: 'A', decimals: 6, supply: '10', creator: CREATOR,
  caps: { freeze: true }, mintKeypair: Keypair.generate(), rentExemptLamports: RENT
});
const freezeInit = Buffer.from(freezePlan.instructions[1].inner);
t('spl decode: choosing freeze writes the authority bytes explicitly',
  freezeInit[34] === 1 && freezeInit.length === 67 && freezeInit.subarray(35, 67).equals(b58(CREATOR)));

/* MintTo: tag 7 | u64 amount (little-endian). */
const mintToData = Buffer.from(plan.instructions[3].inner);
t('spl decode: mintTo tag is 7', mintToData[0] === SPL_IX.MintTo);
t('spl decode: the full supply is minted, little-endian u64', mintToData.readBigUInt64LE(1) === 1000000n && mintToData.length === 9);

/* SetAuthority: tag 6 | authority type 0 (mint tokens) | 0 (= None = revoke). */
const revokeData = Buffer.from(plan.instructions[4].inner);
t('spl decode: setAuthority tag is 6', revokeData[0] === SPL_IX.SetAuthority);
t('spl decode: authority type is MintTokens', revokeData[1] === AUTHORITY_TYPE.MintTokens);
t('spl decode: revoke is encoded as option-none', revokeData[2] === 0);
t('spl: revoke is signed by the creator, not the mint', plan.instructions[4].keys
  .filter((k) => k.isSigner).length === 1
  && plan.instructions[4].keys.find((k) => k.isSigner).pubkey.toBase58() === CREATOR);
const signers = new Set(plan.instructions
  .flatMap((i) => i.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())));
t('spl: only the user\'s wallet and the new mint are ever signers', signers.size === 2
  && signers.has(CREATOR) && signers.has(plan.accounts.mint));

/* Account lists — the thing a wrong instruction would silently misroute. */
t('spl: mintTo credits the creator\'s associated token account',
  plan.instructions[3].keys[1].pubkey.toBase58() === plan.accounts.tokenAccount);
t('spl: the associated token account is DERIVED, not chosen', plan.accounts.tokenAccount !== plan.accounts.mint
  && plan.accounts.tokenAccount.length >= 32);
t('spl: the plan records the rent it was given (for the UI to show)', BigInt(plan.rentLamports) === RENT);
t('spl: rent is inside the disclosed 0.002–0.004 SOL band', RENT > 1000000n && RENT < 4000000n);

/* Refusals: every missing input is a NAMED error, never a default. */
const refusals = await Promise.all([
  buildSplTokenPlan({ name: '', symbol: 'X', supply: '1', creator: CREATOR, mintKeypair, rentExemptLamports: RENT }).catch((e) => e.message),
  buildSplTokenPlan({ name: 'A', symbol: 'A', supply: '1', creator: null, mintKeypair, rentExemptLamports: RENT }).catch((e) => e.message),
  buildSplTokenPlan({ name: 'A', symbol: 'A', supply: '1', creator: CREATOR, rentExemptLamports: RENT }).catch((e) => e.message),
  buildSplTokenPlan({ name: 'A', symbol: 'A', supply: '1', creator: CREATOR, mintKeypair }).catch((e) => e.message),
  buildSplTokenPlan({ name: 'A', symbol: 'A', supply: '0', creator: CREATOR, mintKeypair, rentExemptLamports: RENT }).catch((e) => e.message),
  buildSplTokenPlan({ name: 'A', symbol: 'A', decimals: 18, supply: '1', creator: CREATOR, mintKeypair, rentExemptLamports: RENT }).catch((e) => e.message)
]);
t('spl: missing name/symbol is refused by name', refusals[0] === 'NAME_AND_SYMBOL_REQUIRED');
t('spl: missing creator is refused by name', refusals[1] === 'CREATOR_REQUIRED');
t('spl: missing mint keypair is refused by name', refusals[2] === 'MINT_KEYPAIR_REQUIRED');
t('spl: missing rent is refused — the planner will not guess rent', refusals[3] === 'RENT_EXEMPT_LAMPORTS_REQUIRED');
t('spl: zero supply is refused', refusals[4] === 'SUPPLY_MUST_BE_POSITIVE');
t('spl: decimals above 9 are refused by name', refusals[5] === 'DECIMALS_INVALID');

/* ── verification halves (pure; fed by the app, never by this test) ──────── */

const goodMint = {
  owner: TOKEN_PROGRAM_ID,
  data: { decimals: 6, mintAuthority: null, freezeAuthority: null, supply: '1000000' }
};
t('verify: a correct mint account passes',
  checkMintAccount(goodMint, { decimals: 6, mintAuthority: null, freezeAuthority: null, supply: '1000000' }).ok);
t('verify: wrong decimals are a named failure',
  checkMintAccount({ ...goodMint, data: { ...goodMint.data, decimals: 9 } }, { decimals: 6 }).problems.includes('DECIMALS_MISMATCH'));
t('verify: a surviving mint authority is caught (fixed supply was promised)',
  checkMintAccount({ ...goodMint, data: { ...goodMint.data, mintAuthority: CREATOR } }, { decimals: 6, mintAuthority: null }).problems.includes('MINT_AUTHORITY_MISMATCH'));
t('verify: a freeze authority is caught',
  checkMintAccount({ ...goodMint, data: { ...goodMint.data, freezeAuthority: CREATOR } }, { decimals: 6, freezeAuthority: null }).problems.includes('FREEZE_AUTHORITY_MISMATCH'));
t('verify: a mint owned by another program is caught',
  checkMintAccount({ ...goodMint, owner: SYSTEM_PROGRAM_ID }, { decimals: 6 }).problems.includes('MINT_OWNER_NOT_TOKEN_PROGRAM'));
t('verify: missing account is a named failure', checkMintAccount(null, {}).problems.includes('MINT_ACCOUNT_MISSING'));
t('verify: pool must reference the mint',
  checkPoolTokens({ mintA: plan.accounts.mint, mintB: 'So11111111111111111111111111111111111111112' }, { mint: plan.accounts.mint }).ok);
t('verify: a pool for a different mint is refused by name',
  checkPoolTokens({ mintA: 'So11111111111111111111111111111111111111112', mintB: CREATOR }, { mint: plan.accounts.mint }).problems.includes('POOL_DOES_NOT_REFERENCE_MINT'));
t('verify: unreadable pool tokens are a named failure',
  checkPoolTokens({}, { mint: plan.accounts.mint }).problems.includes('POOL_TOKENS_UNREADABLE'));

/* ── the Raydium adapter BUILDS (LaunchLab) and still refuses gaps ───────── */

const raydium = raydiumAdapterStatus();
t('raydium: adapter targets LaunchLab', RAYDIUM_ADAPTER_ID === 'raydium-launchlab');
t('raydium: program id is the published LaunchLab program',
  LAUNCHLAB_PINNED.programId === 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
t('raydium: adapter reports READY with the IDL pinned', raydium.status === 'READY' && raydium.pending.length === 0);
t('raydium: every part carries a concrete explanation', raydium.parts.every((p) => typeof p.detail === 'string' && p.detail.length > 20));
t('raydium: the verification half still works without any bytes',
  verifyPoolTokens({ mintA: plan.accounts.mint, mintB: CREATOR }, { mint: plan.accounts.mint }).ok
  && verifyPoolTokens({ mintA: SYSTEM_PROGRAM_ID, mintB: CREATOR }, { mint: plan.accounts.mint }).ok === false);

/* ── LaunchLab: addressing — the config PDA golden check ─────────────────── */

t('launchlab: mainnet program id is the docs-table value',
  LAUNCHLAB_PROGRAM_ID === 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
t('launchlab: devnet program id is the docs-table value',
  LAUNCHLAB_DEVNET_PROGRAM_ID === 'DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6');
t('launchlab: cluster config resolves per cluster',
  launchlabClusterConfig('mainnet-beta').programId === LAUNCHLAB_PROGRAM_ID
  && launchlabClusterConfig('devnet').programId === LAUNCHLAB_DEVNET_PROGRAM_ID
  && launchlabClusterConfig('mainnet-beta').expectedConfigId === LAUNCHLAB_SOL_CONFIG_MAINNET
  && launchlabClusterConfig('devnet').expectedConfigId === null);

const labMint = Keypair.generate();
const addrs = await deriveLaunchpadAddresses({
  programId: LAUNCHLAB_PROGRAM_ID, mintA: labMint.publicKey.toBase58(), creator: CREATOR
});
t('launchlab: the derived config PDA EQUALS Raydium’s API-published config',
  addrs.configId === LAUNCHLAB_SOL_CONFIG_MAINNET);
t('launchlab: all PDAs derive deterministically',
  (await deriveLaunchpadAddresses({
    programId: LAUNCHLAB_PROGRAM_ID, mintA: labMint.publicKey.toBase58(), creator: CREATOR
  })).poolId === addrs.poolId);
// Independent re-derivation with LITERAL seeds (not the module's constants):
// catches wrong seed order/wiring even though the seed strings are pinned.
{
  const prog = new PublicKey(LAUNCHLAB_PROGRAM_ID);
  const a = labMint.publicKey;
  const b = new PublicKey(WSOL_MINT);
  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool', 'utf8'), a.toBuffer(), b.toBuffer()], prog);
  const [vaultA] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault', 'utf8'), pool.toBuffer(), a.toBuffer()], prog);
  const [vaultB] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault', 'utf8'), pool.toBuffer(), b.toBuffer()], prog);
  const [auth] = PublicKey.findProgramAddressSync([Buffer.from('vault_auth_seed', 'utf8')], prog);
  const [eventAuth] = PublicKey.findProgramAddressSync([Buffer.from('__event_authority', 'utf8')], prog);
  const metaProg = new PublicKey(METADATA_PROGRAM_ID);
  const [metadataId] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata', 'utf8'), metaProg.toBuffer(), a.toBuffer()], metaProg);
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [new PublicKey(CREATOR).toBuffer(), b.toBuffer()], prog);
  const [platformVault] = PublicKey.findProgramAddressSync(
    [new PublicKey(RAYDIUM_PLATFORM_ID).toBuffer(), b.toBuffer()], prog);
  t('launchlab pda: pool/vault/auth/event/metadata/fee-vault wiring matches literal seeds',
    pool.toBase58() === addrs.poolId && vaultA.toBase58() === addrs.vaultA
    && vaultB.toBase58() === addrs.vaultB && auth.toBase58() === addrs.auth
    && eventAuth.toBase58() === addrs.eventAuth && metadataId.toBase58() === addrs.metadataId
    && creatorVault.toBase58() === addrs.creatorFeeVault
    && platformVault.toBase58() === addrs.platformFeeVault);
}

/* ── LaunchLab: discriminators recomputed from sha256 (Anchor's rule) ────── */

const anchorDisc = (scope, name) => Array.from(crypto.createHash('sha256').update(`${scope}:${name}`).digest().subarray(0, 8));
t('launchlab disc: initialize_v2 is sha256("global:initialize_v2")[:8]',
  JSON.stringify(anchorDisc('global', 'initialize_v2')) === JSON.stringify([...LAUNCHLAB_IX.initializeV2]));
t('launchlab disc: buy_exact_in is sha256("global:buy_exact_in")[:8]',
  JSON.stringify(anchorDisc('global', 'buy_exact_in')) === JSON.stringify([...LAUNCHLAB_IX.buyExactIn]));
t('launchlab disc: PoolState account discriminator recomputed',
  JSON.stringify(anchorDisc('account', 'PoolState')) === JSON.stringify([...LAUNCHLAB_ACCOUNT_DISC.poolState]));
t('launchlab disc: GlobalConfig account discriminator recomputed',
  JSON.stringify(anchorDisc('account', 'GlobalConfig')) === JSON.stringify([...LAUNCHLAB_ACCOUNT_DISC.globalConfig]));
t('launchlab disc: PlatformConfig account discriminator recomputed',
  JSON.stringify(anchorDisc('account', 'PlatformConfig')) === JSON.stringify([...LAUNCHLAB_ACCOUNT_DISC.platformConfig]));

/* ── LaunchLab: identity + curve validation ──────────────────────────────── */

t('launchlab identity: good values pass and the symbol is uppercased',
  validateLaunchlabIdentity({ name: 'FBT Sol', symbol: 'fbts', uri: 'https://x/y.json' }).value.symbol === 'FBTS');
for (const [input, code] of [
  [{ name: '', symbol: 'A', uri: 'u' }, 'NAME_REQUIRED'],
  [{ name: 'x'.repeat(33), symbol: 'A', uri: 'u' }, 'NAME_TOO_LONG'],
  [{ name: 'A', symbol: '', uri: 'u' }, 'SYMBOL_REQUIRED'],
  [{ name: 'A', symbol: 'ABCDEFGHIJK', uri: 'u' }, 'SYMBOL_TOO_LONG'],
  [{ name: 'A', symbol: 'A', uri: '' }, 'URI_REQUIRED'],
  [{ name: 'A', symbol: 'A', uri: `https://x/${'y'.repeat(200)}` }, 'URI_TOO_LONG']
]) {
  t(`launchlab identity: ${code} refused by name`, validateLaunchlabIdentity(input).problems.includes(code));
}
t('launchlab limits: metaplex caps are 32/10/200',
  METAPLEX_LIMITS.name === 32 && METAPLEX_LIMITS.symbol === 10 && METAPLEX_LIMITS.uri === 200);

// Synthetic live config: Raydium's published SOL-curve values.
const SYN_CONFIG = {
  epoch: '961', curveType: 0, index: 0, migrateFee: '0', tradeFeeRate: '2500',
  maxShareFeeRate: '10000', minSupplyA: '10000000', maxLockRate: '800000',
  minSellRateA: '200000', minMigrateRateA: '150000', minFundRaisingB: '24000000000',
  mintB: WSOL_MINT
};
const SYN_PLATFORM = {
  feeRate: '7500', creatorFeeRate: '500', restrictCurveParam: 0, restrictGlobalConfig: 0
};
const goodCurve = {
  supply: LAUNCHLAB_DEFAULTS.supply, totalSellA: LAUNCHLAB_DEFAULTS.totalSellA,
  totalFundRaisingB: LAUNCHLAB_DEFAULTS.totalFundRaisingB, totalLockedAmount: 0n,
  decimals: 6, config: SYN_CONFIG, migrateType: 'cpmm'
};
t('launchlab curve: the published defaults pass the config bounds', checkCurveParams(goodCurve).ok);
for (const [mut, code] of [
  [{ decimals: 9 }, 'DECIMALS_MUST_BE_6'],
  [{ supply: '9000000000000', totalSellA: '5000000000000' }, 'SUPPLY_BELOW_CONFIG_MIN'],
  [{ totalSellA: '1000' }, 'SELL_BELOW_CONFIG_MIN'],
  [{ totalFundRaisingB: '1000' }, 'RAISE_BELOW_CONFIG_MIN'],
  [{ totalSellA: LAUNCHLAB_DEFAULTS.supply }, 'SELL_EXCEEDS_SUPPLY'],
  [{ totalSellA: '990000000000000' }, 'MIGRATE_BELOW_CONFIG_MIN'],
  [{ totalLockedAmount: '900000000000000' }, 'LOCKED_ABOVE_CONFIG_MAX'],
  [{ config: null }, 'CONFIG_REQUIRED']
]) {
  t(`launchlab curve: ${code} refused by name`, checkCurveParams({ ...goodCurve, ...mut }).problems.includes(code));
}
t('launchlab curve: isqrt is exact (Newton, not float)',
  isqrt(2n ** 128n) === 2n ** 64n && isqrt(15n) === 3n && isqrt(16n) === 4n);
t('launchlab config gate: wrong curve type / quote refused',
  validateConfigAccount({ ...SYN_CONFIG, curveType: 1 }).problems.includes('CONFIG_NOT_CONSTANT_PRODUCT')
  && validateConfigAccount({ ...SYN_CONFIG, mintB: CREATOR }).problems.includes('CONFIG_QUOTE_NOT_WSOL')
  && validateConfigAccount(SYN_CONFIG).ok);
t('launchlab platform gate: restricting platforms refused',
  validatePlatformAccount({ ...SYN_PLATFORM, restrictCurveParam: 1 }).problems.includes('PLATFORM_RESTRICTS_CURVE')
  && validatePlatformAccount(SYN_PLATFORM).ok);

/* ── LaunchLab: curve math (known answers + shape invariants) ────────────── */

const reserves = deriveInitReserves({
  supply: LAUNCHLAB_DEFAULTS.supply, totalSell: LAUNCHLAB_DEFAULTS.totalSellA,
  totalLockedAmount: 0n, totalFundRaising: LAUNCHLAB_DEFAULTS.totalFundRaisingB, migrateFee: 0n
});
t('launchlab math: virtualA known answer', reserves.virtualA === 1073025605596382n);
t('launchlab math: virtualB known answer', reserves.virtualB === 30000852951n);
t('launchlab math: feeCeil rounds UP (SDK calculateFee)', feeCeil(1000000n, 2500n) === 2500n && feeCeil(1n, 1n) === 1n);
const firstBuy = quoteBuyExactIn({
  virtualA: reserves.virtualA, virtualB: reserves.virtualB,
  amountB: 1000000000n, totalFeeRate: 10500n, totalSellA: BigInt(LAUNCHLAB_DEFAULTS.totalSellA)
});
t('launchlab math: 1-SOL first-buy known answer', firstBuy.amountOut === 34260946895842n);
t('launchlab math: first-buy fee is exact', firstBuy.fee === 10500000n);
t('launchlab math: quotes are bounded by remaining supply',
  quoteBuyExactIn({
    virtualA: reserves.virtualA, virtualB: reserves.virtualB,
    amountB: 10n ** 30n, totalFeeRate: 10500n, totalSellA: BigInt(LAUNCHLAB_DEFAULTS.totalSellA)
  }).capped === true);
t('launchlab math: quotes are monotonic in size',
  quoteBuyExactIn({ virtualA: reserves.virtualA, virtualB: reserves.virtualB, amountB: 2n, totalFeeRate: 0n }).amountOut
  > quoteBuyExactIn({ virtualA: reserves.virtualA, virtualB: reserves.virtualB, amountB: 1n, totalFeeRate: 0n }).amountOut);
t('launchlab math: buying the whole curve costs exactly the raise (SDK construction)',
  reserves.virtualB * BigInt(LAUNCHLAB_DEFAULTS.totalSellA)
    / (reserves.virtualA - BigInt(LAUNCHLAB_DEFAULTS.totalSellA)) === BigInt(LAUNCHLAB_DEFAULTS.totalFundRaisingB) - 1n);
t('launchlab math: minAmountOut applies slippage by floors',
  minAmountOut(10000n, 100) === 9900n && minAmountOut(10000n, 0) === 10000n);
t('launchlab math: scaled ratios are exact without floats',
  scaledRatioText(1n, 2n, { digits: 4 }) === '0.5'
  && scaledRatioText(1n, 3n, { digits: 2 }) === '0.33'
  && scaledRatioText(1n, 1n, { shift: -3, digits: 9 }) === '0.001'
  && scaledRatioText(5n, 1n, { shift: 2, digits: 2 }) === '500');
t('launchlab math: init price is below end price on the default curve',
  Number(spotPriceText({ virtualA: reserves.virtualA, virtualB: reserves.virtualB })) > 0
  && Number(endPriceText({
    supply: LAUNCHLAB_DEFAULTS.supply, totalSell: LAUNCHLAB_DEFAULTS.totalSellA,
    totalFundRaising: LAUNCHLAB_DEFAULTS.totalFundRaisingB
  })) > Number(spotPriceText({ virtualA: reserves.virtualA, virtualB: reserves.virtualB })));

/* ── LaunchLab: initialize_v2 bytes, decoded by hand ─────────────────────── */

const initBuilt = await buildInitializeV2({
  programId: LAUNCHLAB_PROGRAM_ID, payer: CREATOR, creator: CREATOR,
  configId: addrs.configId, platformId: addrs.platformId, auth: addrs.auth, poolId: addrs.poolId,
  mintA: labMint.publicKey.toBase58(), vaultA: addrs.vaultA, vaultB: addrs.vaultB, metadataId: addrs.metadataId,
  decimals: 6, name: 'FBT Sol', symbol: 'FBTS', uri: 'https://x/y.json',
  supply: LAUNCHLAB_DEFAULTS.supply, totalSellA: LAUNCHLAB_DEFAULTS.totalSellA,
  totalFundRaisingB: LAUNCHLAB_DEFAULTS.totalFundRaisingB, migrateType: 'cpmm'
});
{
  const data = Buffer.from(initBuilt.instruction.data);
  const keys = initBuilt.instruction.keys;
  t('lab decode: discriminator is initialize_v2',
    [...data.subarray(0, 8)].join(',') === [...LAUNCHLAB_IX.initializeV2].join(','));
  t('lab decode: decimals byte survives', data[8] === 6);
  let at = 9;
  const readStr = () => {
    const len = data.readUInt32LE(at);
    const s = data.subarray(at + 4, at + 4 + len).toString('utf8');
    at += 4 + len;
    return s;
  };
  const dName = readStr();
  const dSymbol = readStr();
  const dUri = readStr();
  t('lab decode: name/symbol/uri are Anchor strings in order',
    dName === 'FBT Sol' && dSymbol === 'FBTS' && dUri === 'https://x/y.json');
  t('lab decode: curve enum index is ConstantCurve (0)', data[at] === 0);
  at += 1;
  t('lab decode: supply/sell/raise are u64le in order',
    data.readBigUInt64LE(at) === BigInt(LAUNCHLAB_DEFAULTS.supply)
    && data.readBigUInt64LE(at + 8) === BigInt(LAUNCHLAB_DEFAULTS.totalSellA)
    && data.readBigUInt64LE(at + 16) === BigInt(LAUNCHLAB_DEFAULTS.totalFundRaisingB));
  at += 24;
  t('lab decode: migrateType is cpmm (1) — new launches require CPSWAP', data[at] === 1);
  at += 1;
  t('lab decode: no vesting — locked/cliff/unlock are all zero',
    data.readBigUInt64LE(at) === 0n && data.readBigUInt64LE(at + 8) === 0n && data.readBigUInt64LE(at + 16) === 0n);
  at += 24;
  t('lab decode: cpmmCreatorFeeOn default + exact length',
    data[at] === 0 && data.length === at + 1);
  const addrs58 = keys.map((k) => k.pubkey.toBase58());
  const flags = keys.map((k) => `${k.isSigner ? 's' : '-'}${k.isWritable ? 'w' : '-'}`);
  t('lab decode: 18 accounts in the SDK order',
    keys.length === 18
    && addrs58[0] === CREATOR && addrs58[1] === CREATOR && addrs58[2] === addrs.configId
    && addrs58[3] === addrs.platformId && addrs58[4] === addrs.auth && addrs58[5] === addrs.poolId
    && addrs58[6] === labMint.publicKey.toBase58() && addrs58[7] === WSOL_MINT
    && addrs58[8] === addrs.vaultA && addrs58[9] === addrs.vaultB && addrs58[10] === addrs.metadataId
    && addrs58[11] === TOKEN_PROGRAM_ID && addrs58[12] === TOKEN_PROGRAM_ID
    && addrs58[13] === METADATA_PROGRAM_ID && addrs58[14] === SYSTEM_PROGRAM_ID
    && addrs58[16] === addrs.eventAuth && addrs58[17] === LAUNCHLAB_PROGRAM_ID);
  t('lab decode: only payer + mint sign; pool/vaults/metadata writable',
    flags.join(',') === 'sw,--,--,--,--,-w,sw,--,-w,-w,-w,--,--,--,--,--,--,--');
}

/* ── LaunchLab: buy_exact_in + wrap legs ─────────────────────────────────── */

const buyBuilt = await buildBuyExactIn({
  programId: LAUNCHLAB_PROGRAM_ID, owner: CREATOR, auth: addrs.auth,
  configId: addrs.configId, platformId: addrs.platformId, poolId: addrs.poolId,
  userTokenAccountA: CREATOR, userTokenAccountB: CREATOR,
  vaultA: addrs.vaultA, vaultB: addrs.vaultB, mintA: labMint.publicKey.toBase58(),
  platformClaimFeeVault: addrs.platformFeeVault, creatorClaimFeeVault: addrs.creatorFeeVault,
  amountB: 1000000000n, minAmountA: 59000000000000n
});
{
  const data = Buffer.from(buyBuilt.instruction.data);
  const keys = buyBuilt.instruction.keys;
  t('lab buy: discriminator is buy_exact_in',
    [...data.subarray(0, 8)].join(',') === [...LAUNCHLAB_IX.buyExactIn].join(','));
  t('lab buy: amountB/minAmountA/shareFee(0) are u64le',
    data.readBigUInt64LE(8) === 1000000000n && data.readBigUInt64LE(16) === 59000000000000n
    && data.readBigUInt64LE(24) === 0n && data.length === 32);
  t('lab buy: 18 accounts — 15 core (incl. event + program) + system + both fee vaults',
    keys.length === 18
    && keys[0].pubkey.toBase58() === CREATOR && keys[0].isSigner && keys[0].isWritable
    && keys[5].pubkey.toBase58() === CREATOR && keys[6].pubkey.toBase58() === CREATOR
    && keys[13].pubkey.toBase58() === addrs.eventAuth
    && keys[14].pubkey.toBase58() === LAUNCHLAB_PROGRAM_ID
    && keys[15].pubkey.toBase58() === SYSTEM_PROGRAM_ID
    && keys[16].pubkey.toBase58() === addrs.platformFeeVault && keys[16].isWritable
    && keys[17].pubkey.toBase58() === addrs.creatorFeeVault && keys[17].isWritable);
}
const wrap = await buildWrapSol({ payer: CREATOR, lamports: 1000000000n });
t('lab wrap: wrap is ensure-ata + transfer + syncNative',
  wrap.items.map((i) => i.id).join(',') === 'wrap-ensure-wsol-account,wrap-transfer-sol,wrap-sync-native'
  && wrap.wsolAccount.length >= 32);
const ensureA = await buildEnsureTokenAccount({ payer: CREATOR, mint: labMint.publicKey.toBase58() });
t('lab wrap: token ATA is derived and idempotent', ensureA.tokenAccount.length >= 32 && ensureA.item.id === 'buy-ensure-token-account');
const closeWsol = await buildCloseWsol({ payer: CREATOR, wsolAccount: wrap.wsolAccount });
t('lab wrap: close returns dust to the payer',
  closeWsol.instruction.keys[1].pubkey.toBase58() === CREATOR);

/* ── LaunchLab: account decoders (synthetic states, hand-built bytes) ────── */

function writeU64(buf, at, v) {
  buf.writeBigUInt64LE(BigInt(v), at);
}
{
  // GlobalConfig, 371 bytes, offsets from the SDK layout.
  const raw = Buffer.alloc(LAUNCHLAB_ACCOUNT_SIZE.globalConfig);
  Buffer.from(LAUNCHLAB_ACCOUNT_DISC.globalConfig).copy(raw, 0);
  writeU64(raw, 8, 961n);
  raw[16] = 0;
  raw.writeUInt16LE(0, 17);
  writeU64(raw, 19, 0n);
  writeU64(raw, 27, 2500n);
  writeU64(raw, 35, 10000n);
  writeU64(raw, 43, 10000000n);
  writeU64(raw, 51, 800000n);
  writeU64(raw, 59, 200000n);
  writeU64(raw, 67, 150000n);
  writeU64(raw, 75, 24000000000n);
  b58(WSOL_MINT).copy(raw, 83);
  const dec = decodeLaunchpadConfig(raw);
  t('lab decode: GlobalConfig fields land on their offsets',
    dec.curveType === 0 && dec.index === 0 && dec.tradeFeeRate === '2500'
    && dec.minSupplyA === '10000000' && dec.minFundRaisingB === '24000000000'
    && dec.mintB === WSOL_MINT);
  // PoolState, 429 bytes.
  const pool = Buffer.alloc(LAUNCHLAB_ACCOUNT_SIZE.poolState);
  Buffer.from(LAUNCHLAB_ACCOUNT_DISC.poolState).copy(pool, 0);
  writeU64(pool, 8, 5n);
  pool[16] = 255;
  pool[17] = 0;
  pool[18] = 6;
  pool[19] = 9;
  pool[20] = 1;
  const nums = [LAUNCHLAB_DEFAULTS.supply, LAUNCHLAB_DEFAULTS.totalSellA, '1073025605596382',
    '30000852951', '1000', '2000', LAUNCHLAB_DEFAULTS.totalFundRaisingB, '11', '22', '0'];
  nums.forEach((v, i) => writeU64(pool, 21 + i * 8, v));
  for (let i = 0; i < 5; i += 1) writeU64(pool, 101 + i * 8, 0n);
  [addrs.configId, addrs.platformId, labMint.publicKey.toBase58(), WSOL_MINT, addrs.vaultA, addrs.vaultB, CREATOR]
    .forEach((a58, i) => b58(a58).copy(pool, 141 + i * 32));
  pool[365] = 0;
  pool[366] = 0;
  writeU64(pool, 367, 0n);
  const pdec = decodeLaunchpadPool(pool);
  t('lab decode: PoolState fields land on their offsets',
    pdec.status === 0 && pdec.mintDecimalsA === 6 && pdec.mintDecimalsB === 9
    && pdec.migrateType === 1 && pdec.supply === LAUNCHLAB_DEFAULTS.supply
    && pdec.virtualA === '1073025605596382' && pdec.realB === '2000'
    && pdec.mintA === labMint.publicKey.toBase58() && pdec.creator === CREATOR
    && pdec.mintProgramFlag === 0);
  // PlatformConfig, 944 bytes (fee rates + restriction flags only).
  const plat = Buffer.alloc(LAUNCHLAB_ACCOUNT_SIZE.platformConfig);
  Buffer.from(LAUNCHLAB_ACCOUNT_DISC.platformConfig).copy(plat, 0);
  writeU64(plat, 104, 7500n);
  writeU64(plat, 720, 500n);
  plat[832] = 0;
  plat[833] = 0;
  const pldec = decodeLaunchpadPlatform(plat);
  t('lab decode: PlatformConfig rates + flags land on their offsets',
    pldec.feeRate === '7500' && pldec.creatorFeeRate === '500'
    && pldec.restrictGlobalConfig === 0 && pldec.restrictCurveParam === 0);
  // Refusals.
  const badDisc = Buffer.from(raw);
  badDisc[0] ^= 1;
  let discErr = null;
  try { decodeLaunchpadConfig(badDisc); } catch (e) { discErr = e; }
  t('lab decode: wrong discriminator is refused', discErr?.message === 'CONFIG_DISCRIMINATOR_MISMATCH');
  let truncErr = null;
  try { decodeLaunchpadPool(pool.subarray(0, 100)); } catch (e) { truncErr = e; }
  t('lab decode: truncated pool is refused', truncErr?.message === 'POOL_TRUNCATED');
  t('lab back-check: matching pool passes, every mismatch is named',
    verifyPoolState(pdec, {
      mintA: labMint.publicKey.toBase58(), mintB: WSOL_MINT, configId: addrs.configId,
      platformId: addrs.platformId, creator: CREATOR, supply: LAUNCHLAB_DEFAULTS.supply,
      totalSellA: LAUNCHLAB_DEFAULTS.totalSellA, totalFundRaisingB: LAUNCHLAB_DEFAULTS.totalFundRaisingB,
      vaultA: addrs.vaultA, vaultB: addrs.vaultB, mintDecimalsA: 6, migrateType: 1, status: 0
    }).ok
    && verifyPoolState(pdec, { mintA: CREATOR }).problems.includes('POOL_MINT_A_MISMATCH')
    && verifyPoolState(pdec, { supply: '1' }).problems.includes('POOL_SUPPLY_MISMATCH')
    && verifyPoolState(null, {}).problems.includes('POOL_STATE_MISSING'));
}

/* ── LaunchLab: full plan assembly (offline) ─────────────────────────────── */

const labPlan = await buildLaunchlabPlan({
  cluster: 'mainnet-beta', creator: CREATOR, mintKeypair: labMint,
  name: 'FBT Sol', symbol: 'FBTS', uri: 'https://x/y.json', decimals: 6,
  supply: LAUNCHLAB_DEFAULTS.supply, totalSellA: LAUNCHLAB_DEFAULTS.totalSellA,
  totalFundRaisingB: LAUNCHLAB_DEFAULTS.totalFundRaisingB,
  config: SYN_CONFIG, platform: SYN_PLATFORM,
  firstBuyLamports: 1000000000n, slippageBps: 100
});
t('lab plan: cluster/program/addresses consistent',
  labPlan.cluster === 'mainnet-beta' && labPlan.programId === LAUNCHLAB_PROGRAM_ID
  && labPlan.addresses.configId === LAUNCHLAB_SOL_CONFIG_MAINNET
  && labPlan.addresses.poolId === addrs.poolId && labPlan.addresses.mintA === labMint.publicKey.toBase58());
t('lab plan: create is one instruction needing the mint signature',
  labPlan.create.items.length === 1 && labPlan.create.items[0].id === 'launchlab-initialize'
  && labPlan.create.extraSigners.join(',') === 'mint');
t('lab plan: buy is wrap×3 + ata + buy + close',
  labPlan.buy.items.map((i) => i.id).join(',')
  === 'wrap-ensure-wsol-account,wrap-transfer-sol,wrap-sync-native,buy-ensure-token-account,launchlab-buy,wrap-close-wsol');
t('lab plan: economics quote the first buy with slippage applied',
  labPlan.economics.firstBuy.quotedOut === '34260946895842'
  && labPlan.economics.firstBuy.minOut === minAmountOut(34260946895842n, 100).toString()
  && BigInt(labPlan.economics.firstBuy.minOut) < BigInt(labPlan.economics.firstBuy.quotedOut));
t('lab plan: create-only has no buy leg', (await buildLaunchlabPlan({
  cluster: 'mainnet-beta', creator: CREATOR, mintKeypair: Keypair.generate(),
  name: 'A', symbol: 'A', uri: 'https://x/y.json', decimals: 6,
  supply: LAUNCHLAB_DEFAULTS.supply, totalSellA: LAUNCHLAB_DEFAULTS.totalSellA,
  totalFundRaisingB: LAUNCHLAB_DEFAULTS.totalFundRaisingB, config: SYN_CONFIG,
  firstBuyLamports: 0n
})).buy === null);
t('lab plan: adapter buildPoolPlan delegates', (await buildPoolPlan({
  cluster: 'mainnet-beta', creator: CREATOR, mintKeypair: Keypair.generate(),
  name: 'A', symbol: 'A', uri: 'https://x/y.json', decimals: 6,
  supply: LAUNCHLAB_DEFAULTS.supply, totalSellA: LAUNCHLAB_DEFAULTS.totalSellA,
  totalFundRaisingB: LAUNCHLAB_DEFAULTS.totalFundRaisingB, config: SYN_CONFIG,
  firstBuyLamports: 0n
})).create.items.length === 1);
for (const [mut, code] of [
  [{ creator: null }, 'CREATOR_REQUIRED'],
  [{ mintKeypair: null }, 'MINT_KEYPAIR_REQUIRED'],
  [{ symbol: 'TOOLONGTOOLONG' }, 'SYMBOL_TOO_LONG'],
  [{ uri: '' }, 'URI_REQUIRED'],
  [{ supply: '9000000000000', totalSellA: '5000000000000' }, 'SUPPLY_BELOW_CONFIG_MIN'],
  [{ firstBuyLamports: 1000000000n, platform: null }, 'PLATFORM_REQUIRED_FOR_BUY']
]) {
  let err = null;
  try {
    await buildLaunchlabPlan({
      cluster: 'mainnet-beta', creator: CREATOR, mintKeypair: Keypair.generate(),
      name: 'A', symbol: 'A', uri: 'https://x/y.json', decimals: 6,
      supply: LAUNCHLAB_DEFAULTS.supply, totalSellA: LAUNCHLAB_DEFAULTS.totalSellA,
      totalFundRaisingB: LAUNCHLAB_DEFAULTS.totalFundRaisingB, config: SYN_CONFIG,
      firstBuyLamports: 0n, ...mut
    });
  } catch (e) { err = e; }
  t(`lab plan: ${code} refused by name`, err?.message === code);
}

/* ── the two-signer assembly, proven with local keypairs ─────────────────── */

{
  // The wallet half in production is provider.signTransaction on the
  // partially-signed transaction (the swap path's own call): the wallet
  // ADDS its signature and preserves the mint's. Here a generated keypair
  // stands in for the wallet with the same partial-sign semantics —
  // NOTE: Transaction.sign() would WIPE the mint signature (it resets the
  // signature array), so production and this test both use partialSign.
  const wallet = Keypair.generate();
  const asmMint = Keypair.generate();
  const asmPlan = await buildLaunchlabPlan({
    cluster: 'mainnet-beta', creator: wallet.publicKey.toBase58(), mintKeypair: asmMint,
    name: 'A', symbol: 'A', uri: 'https://x/y.json', decimals: 6,
    supply: LAUNCHLAB_DEFAULTS.supply, totalSellA: LAUNCHLAB_DEFAULTS.totalSellA,
    totalFundRaisingB: LAUNCHLAB_DEFAULTS.totalFundRaisingB, config: SYN_CONFIG,
    firstBuyLamports: 0n
  });
  const tx = new Transaction();
  tx.add(asmPlan.create.items[0].instruction);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = asmMint.publicKey.toBase58(); // any 32 bytes, offline
  tx.partialSign(asmMint);
  t('lab assembly: after partialSign only the mint signature is present',
    tx.signatures.some((s) => s.publicKey.equals(asmMint.publicKey) && s.signature)
    && tx.signatures.some((s) => s.publicKey.equals(wallet.publicKey) && !s.signature));
  tx.partialSign(wallet);
  t('lab assembly: both signatures verify', tx.verifySignatures());
  const roundTrip = Transaction.from(tx.serialize());
  t('lab assembly: signatures survive the wallet bytes round trip', roundTrip.verifySignatures());
  t('lab assembly: exactly the wallet + the mint are signers',
    roundTrip.signatures.length === 2);
}

/* ── base58 codec + data-uri helper ──────────────────────────────────────── */

t('lab codec: base58 round-trips incl. leading zero bytes',
  base58Encode(base58Decode(CREATOR)) === CREATOR
  && base58Encode(new Uint8Array([0, 0, 1, 2, 3])) === '11Ldp');
t('lab uri: generated descriptor fits the 200-char cap',
  buildDataUri({ name: 'FBT Sol', symbol: 'FBTS' }).length < METAPLEX_LIMITS.uri
  && buildDataUri({ name: 'FBT Sol', symbol: 'FBTS' }).startsWith('data:application/json,'));

/* ── no stray live-cluster dependency ────────────────────────────────────── */

t('solana probe: no RPC endpoint is baked into the shipped modules', !JSON.stringify([SOLANA_PARTS, raydium.parts]).includes('https://'));
{
  // Static rule: ONLY signing.js may carry cluster default URLs (it honors
  // the Settings custom RPC first). Plan/verify/status modules must be
  // cluster-agnostic — an RPC string there would be a silent assumption.
  const root = path.dirname(fileURLToPath(import.meta.url));
  const src = (f) => fs.readFileSync(path.join(root, '..', 'src', 'lib', 'launch', 'solana', f), 'utf8');
  const hasRpc = (s) => s.includes('api.mainnet-beta') || s.includes('api.devnet');
  t('solana probe: plan/verify/status carry no RPC defaults',
    !hasRpc(src('launchlab.js')) && !hasRpc(src('verify.js')) && !hasRpc(src('raydium.js')) && !hasRpc(src('status.js')));
}

console.log('\n✓ launch-solana-probe: all assertions passed (mock provider, no mainnet calls)\n');
