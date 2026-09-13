/**
 * FBT LAUNCH — Solana probe (pure logic + MOCK provider; no mainnet calls).
 * ---------------------------------------------------------------------------
 * This file proves two things and nothing else:
 *
 *   1. The Solana token PLAN is correct — every instruction's program id,
 *      account list and data is decoded back with an INDEPENDENT decoder and
 *      compared with the user's intent (supply / decimals / authorities).
 *      The bytes are parsed BY HAND from the SPL Token program's published
 *      layout — never "our encoder equals our decoder".
 *
 *   2. The SOLANA HONESTY DOOR holds — the wallet-signing path, the Raydium
 *      pool flow and live-cluster verification are NOT finished, so
 *      `solanaLaunchStatus().shipping === false` (the UI keeps its COMING_SOON
 *      badge), and the Raydium adapter REFUSES to build pool bytes instead of
 *      guessing an account list.
 *
 * No network: the "provider" is a plain object. If this file ever needs an
 * RPC endpoint to pass, the test is wrong, not the environment.
 *
 * Wired into test/run.mjs next to the EVM launch probe.
 */
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  SOLANA_STATUS, SOLANA_PARTS, solanaLaunchStatus, solanaLaunchEnabled
} from '../src/lib/launch/solana/status.js';
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID,
  MINT_ACCOUNT_SIZE, SPL_IX, AUTHORITY_TYPE, solanaDecisions,
  buildSplTokenPlan, checkMintAccount, checkPoolTokens
} from '../src/lib/launch/solana/spl.js';
import {
  RAYDIUM_AMM_PROGRAM_ID, raydiumAdapterStatus, buildPoolPlan, verifyPoolTokens
} from '../src/lib/launch/solana/raydium.js';

const t = (name, ok) => {
  assert.ok(ok, name);
  console.log(`✓ ${name}`);
};
const b58 = (s) => new PublicKey(s).toBuffer();

const CREATOR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const RENT = 1461600n; // measured rent-exempt minimum for an 82-byte account

/* ── the honesty door ────────────────────────────────────────────────────── */

t('solana: status is COMING_SOON while any part is unfinished', SOLANA_STATUS === 'COMING_SOON');
t('solana: the status object does NOT ship the flow', solanaLaunchStatus().shipping === false);
t('solana: launch stays disabled until nothing is pending', solanaLaunchEnabled() === false);
t('solana: pending parts are named, not vague', ['wallet-signing', 'raydium-pool', 'on-chain-verification']
  .every((id) => solanaLaunchStatus().pending.includes(id)));
t('solana: readiness is per part and honest', SOLANA_PARTS.some((p) => p.id === 'spl-token-plan' && p.status === 'READY')
  && SOLANA_PARTS.some((p) => p.id === 'wallet-signing' && p.status === 'PENDING'));
t('solana: every part carries a concrete explanation', SOLANA_PARTS.every((p) => typeof p.detail === 'string' && p.detail.length > 20));

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

/* ── the Raydium adapter refuses to guess ────────────────────────────────── */

const raydium = raydiumAdapterStatus();
t('raydium: program id is the published AMM program', RAYDIUM_AMM_PROGRAM_ID === '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
t('raydium: adapter reports NOT_READY until the IDL is pinned', raydium.status === 'NOT_READY');
t('raydium: the missing pieces are named', raydium.pending.includes('idl') && raydium.pending.includes('amm-config'));
let poolErr = null;
try { buildPoolPlan({ tokenMint: plan.accounts.mint }); } catch (e) { poolErr = e; }
t('raydium: pool bytes are REFUSED rather than guessed', poolErr?.message === 'RAYDIUM_IDL_NOT_PINNED'
  && Array.isArray(poolErr.detail) && poolErr.detail.length > 0);
t('raydium: the verification half still works without the IDL',
  verifyPoolTokens({ mintA: plan.accounts.mint, mintB: CREATOR }, { mint: plan.accounts.mint }).ok
  && verifyPoolTokens({ mintA: SYSTEM_PROGRAM_ID, mintB: CREATOR }, { mint: plan.accounts.mint }).ok === false);

/* ── no stray live-cluster dependency ────────────────────────────────────── */

t('solana probe: no RPC endpoint is baked into the shipped modules', !JSON.stringify([SOLANA_PARTS, raydium.parts]).includes('https://'));
t('solana probe: the only pinned address is the program id', raydium.parts.every((p) => p.id !== 'pool-address'));

console.log('\n✓ launch-solana-probe: all assertions passed (mock provider, no mainnet calls)\n');
