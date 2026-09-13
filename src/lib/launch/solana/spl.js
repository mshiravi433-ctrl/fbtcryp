/**
 * SOLANA LAUNCH — the SPL token side (plan only; nothing signs here).
 * ============================================================================
 *
 * On Solana a token is NOT a deployed contract: it is an 82-byte MINT ACCOUNT
 * owned by the SPL Token program. Creating one is four ordinary instructions
 * in one transaction:
 *
 *   1. SystemProgram.createAccount   — allocate the mint account (payer = user)
 *   2. InitializeMint                — decimals + mint authority + freeze
 *                                      authority, decided ONCE, like the
 *                                      capability bitmap on the EVM side
 *   3. createAssociatedTokenAccount  — the creator's own token account
 *   4. MintTo                        — the entire initial supply, to the creator
 *   (optional) SetAuthority          — revoke the mint authority immediately,
 *                                      for "fixed supply" launches
 *
 * The cost is rent for those accounts (~0.002–0.004 SOL) and it is paid by the
 * USER's wallet. There is no factory and no bytecode in this path.
 *
 * ── WHY THIS FILE IS PLAN-ONLY ─────────────────────────────────────────────
 * Building instructions is deterministic and testable; signing them is not
 * testable here yet (see ./status.js). So this module prepares bytes and
 * accounts, `test/launch-solana-probe.mjs` decodes them with an INDEPENDENT
 * decoder and asserts they say what the user asked for, and no wallet is ever
 * asked to sign — the UI shows COMING_SOON until the signing path exists.
 *
 * @solana/web3.js is imported DYNAMICALLY: this module is reachable from the
 * launch page, and a 19 MB library must not land in the entry chunk for a
 * feature that is not shipped (same rule as src/lib/solanaWallet.js).
 */

/* ── protocol constants ─────────────────────────────────────────────────────
 * These three addresses are fixed by the Solana protocol / token program and
 * are asserted in the probe. They are NOT configurable: a "wrong" token
 * program would mint somebody else's asset. */
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const SYSVAR_RENT_ID = 'SysvarRent111111111111111111111111111111111';

/** Mint account size and the SPL instruction discriminants (u8, little-endian
    layout as published by the token program). */
export const MINT_ACCOUNT_SIZE = 82;
export const SPL_IX = Object.freeze({
  InitializeMint: 0,
  InitializeAccount: 1,
  Transfer: 3,
  MintTo: 7,
  SetAuthority: 6
});
export const AUTHORITY_TYPE = Object.freeze({ MintTokens: 0, FreezeAccount: 1 });

/**
 * The capability model, in Solana's own vocabulary.
 *
 * The EVM token's bitmap answers five questions that Solana answers with
 * authorities instead. The mapping is deliberate and disclosed, because
 * "mintable" on Solana means "the mint authority still exists" — and a fixed
 * supply means revoking it in the SAME transaction that mints it:
 *
 *   mintable:  false → mint authority is revoked right after the initial mint
 *              true  → the creator keeps the mint authority (inflation risk,
 *                      exactly the +20 the EVM risk engine charges)
 *   pausable / maxWallet / maxTx / burnable → NOT REPRESENTABLE in a plain SPL
 *              mint. A token that claims them on Solana would be lying, so the
 *              planner REFUSES (UNSUPPORTED_CAPABILITY) instead of silently
 *              dropping the user's choice.
 *   freeze:    the user's explicit choice; `false` (the default and the
 *              disclosure-friendly option) means the mint is created with NO
 *              freeze authority at all — nobody can ever freeze a holder.
 */
export const CAP_BIT = Object.freeze({ mintable: 1, burnable: 2, pausable: 4, maxWallet: 8, maxTx: 16 });

export function solanaDecisions({ caps = {} } = {}) {
  const unsupported = ['burnable', 'pausable', 'maxWallet', 'maxTx'].filter((k) => caps[k]);
  if (unsupported.length) {
    const err = new Error('UNSUPPORTED_CAPABILITY');
    err.detail = unsupported;
    throw err;
  }
  const bitmap = Object.entries(caps).reduce((acc, [k, v]) => acc | (v ? (CAP_BIT[k] || 0) : 0), 0);
  return {
    mintable: Boolean(caps.mintable),
    freezeAuthority: caps.freeze ? 'creator' : null,
    mintAuthority: caps.mintable ? 'creator' : 'revoked-after-mint',
    /** Same semantics as the EVM bitmap, so the shared risk engine can score
        a Solana launch with the same rules (see src/lib/launch/risk.js). */
    bitmap
  };
}

/** Base58 → bytes without pulling a separate dependency. */
function base58Decode(str) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = [0];
  for (const ch of str) {
    const value = ALPHABET.indexOf(ch);
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

/** u64 little-endian, the layout the token program reads for amounts. */
function u64le(value) {
  const out = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i += 1) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}

function concatBytes(...chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * Build the whole Solana token plan.
 *
 * Everything network-shaped is INJECTED:
 *   · `rentExemptLamports` must be supplied by the caller (in the app it comes
 *     from `connection.getMinimumBalanceForRentExemption(MINT_ACCOUNT_SIZE)`
 *     on the cluster the user is actually on). The planner REFUSES to guess it
 *     — a wrong rent number produces an account that cannot exist.
 *   · `mintKeypair` is the ephemeral keypair that becomes the mint account.
 *     It is created and used on the user's device and never leaves it; the
 *     real flow must partial-sign with it in memory only.
 *
 * @returns {{instructions:object[], accounts:{mint:string, tokenAccount:string},
 *            rentLamports:string, decimals:number, decisions:object}}
 */
export async function buildSplTokenPlan({
  name, symbol, decimals = 9, supply, creator, caps = {},
  mintKeypair, rentExemptLamports, associatedTokenAddress = null
}) {
  if (!name || !symbol) throw new Error('NAME_AND_SYMBOL_REQUIRED');
  if (!creator) throw new Error('CREATOR_REQUIRED');
  if (!mintKeypair?.publicKey) throw new Error('MINT_KEYPAIR_REQUIRED');
  if (rentExemptLamports == null) throw new Error('RENT_EXEMPT_LAMPORTS_REQUIRED');
  const supplyRaw = BigInt(supply ?? 0);
  if (supplyRaw <= 0n) throw new Error('SUPPLY_MUST_BE_POSITIVE');
  if (!Number.isInteger(Number(decimals)) || Number(decimals) < 0 || Number(decimals) > 9) throw new Error('DECIMALS_INVALID');

  const {
    PublicKey, SystemProgram, TransactionInstruction, SYSVAR_RENT_PUBKEY
  } = await import('@solana/web3.js');

  const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
  const ataProgram = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);
  const payer = new PublicKey(creator);
  const mint = mintKeypair.publicKey;
  const decisions = solanaDecisions({ caps });
  const instructions = [];
  const keys = (arr) => arr.map((k) => ({ pubkey: k.pubkey, isSigner: k.isSigner === true, isWritable: k.isWritable === true }));

  // 1 — allocate the mint account (82 bytes, rent paid by the user's wallet)
  instructions.push({
    id: 'create-mint-account',
    programId: SYSTEM_PROGRAM_ID,
    inner: SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: mint,
      lamports: Number(rentExemptLamports),
      space: MINT_ACCOUNT_SIZE,
      programId: tokenProgram
    }).data,
    keys: keys([
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: true, isWritable: true }
    ]),
    description: `Allocate the ${symbol} mint account (${MINT_ACCOUNT_SIZE} bytes, rent from your wallet)`
  });

  // 2 — InitializeMint: decimals + authorities. This is the "capability
  //     bitmap" moment: whatever is set here is what the mint can ever do.
  const authorityBytes = base58Decode(creator);
  const freeze = decisions.freezeAuthority ? authorityBytes : null;
  const initData = concatBytes(
    Uint8Array.from([SPL_IX.InitializeMint]),
    Uint8Array.from([Number(decimals)]),
    authorityBytes,
    Uint8Array.from([freeze ? 1 : 0]),
    freeze || new Uint8Array(0)
  );
  instructions.push({
    id: 'initialize-mint',
    programId: TOKEN_PROGRAM_ID,
    inner: new TransactionInstruction({
      programId: tokenProgram,
      keys: [
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
      ],
      data: Buffer.from(initData)
    }).data,
    keys: keys([
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
    ]),
    description: `Initialize ${symbol}: ${decimals} decimals, ${freeze ? 'freeze authority stays with you' : 'no freeze authority — nobody can freeze holders'}`
  });

  // 3 — the creator's associated token account (derived, never "chosen")
  const ata = associatedTokenAddress
    ? new PublicKey(associatedTokenAddress)
    : PublicKey.findProgramAddressSync(
      [payer.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
      ataProgram
    )[0];
  instructions.push({
    id: 'create-token-account',
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    inner: Buffer.from([]),
    keys: keys([
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false }
    ]),
    description: 'Create your own token account for the new mint'
  });

  // 4 — the entire initial supply, to the creator (this is what the user
  //     signed for: no vesting contract, no third party, no treasury)
  instructions.push({
    id: 'mint-initial-supply',
    programId: TOKEN_PROGRAM_ID,
    inner: Buffer.from(concatBytes(Uint8Array.from([SPL_IX.MintTo]), u64le(supplyRaw))),
    keys: keys([
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false }
    ]),
    description: `Mint the full supply to your wallet (${supplyRaw.toString()} base units)`
  });

  // 5 — fixed supply means the mint authority is revoked in the SAME
  //     transaction: after it confirms, nobody — including the creator — can
  //     ever mint again.
  if (decisions.mintAuthority === 'revoked-after-mint') {
    instructions.push({
      id: 'revoke-mint-authority',
      programId: TOKEN_PROGRAM_ID,
      inner: Buffer.from(concatBytes(
        Uint8Array.from([SPL_IX.SetAuthority]),
        Uint8Array.from([AUTHORITY_TYPE.MintTokens]),
        Uint8Array.from([0])
      )),
      keys: keys([
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: false }
      ]),
      description: 'Revoke the mint authority — the supply becomes fixed, permanently'
    });
  }

  return {
    instructions,
    accounts: { mint: mint.toBase58(), tokenAccount: ata.toBase58() },
    rentLamports: String(rentExemptLamports),
    decimals: Number(decimals),
    mintAccountSize: MINT_ACCOUNT_SIZE,
    decisions
  };
}

/**
 * Verify a mint account's decoded state against what the plan said, given an
 * injected account read (in the app: `getAccountInfo`; in tests: a fixed
 * object; in this session: never a live cluster). Named problems, like the
 * EVM verification module.
 */
export function checkMintAccount(info, {
  decimals, mintAuthority, freezeAuthority, supply
} = {}) {
  const problems = [];
  if (!info) return { ok: false, problems: ['MINT_ACCOUNT_MISSING'] };
  if (info.owner && info.owner !== TOKEN_PROGRAM_ID) problems.push('MINT_OWNER_NOT_TOKEN_PROGRAM');
  if (Number(info.data?.decimals) !== Number(decimals)) problems.push('DECIMALS_MISMATCH');
  if ((info.data?.mintAuthority ?? null) !== (mintAuthority ?? null)) problems.push('MINT_AUTHORITY_MISMATCH');
  if ((info.data?.freezeAuthority ?? null) !== (freezeAuthority ?? null)) problems.push('FREEZE_AUTHORITY_MISMATCH');
  if (supply != null && String(info.data?.supply) !== String(supply)) problems.push('SUPPLY_MISMATCH');
  return { ok: problems.length === 0, problems };
}

/**
 * The pool back-check, stated as a pure function because the Raydium adapter
 * is not shipped: whatever pool exists must name the user's mint as one of
 * its two tokens, or it is not their pool.
 */
export function checkPoolTokens(pool, { mint }) {
  if (!pool) return { ok: false, problems: ['POOL_MISSING'] };
  const mints = [pool.mintA, pool.mintB].filter(Boolean).map(String);
  if (!mints.length) return { ok: false, problems: ['POOL_TOKENS_UNREADABLE'] };
  if (!mints.some((m) => m === String(mint))) return { ok: false, problems: ['POOL_DOES_NOT_REFERENCE_MINT'] };
  return { ok: true, problems: [] };
}
