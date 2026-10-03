/**
 * SOLANA TRANSFERS — the native SOL send, and (since the SPL release) tokens.
 * ---------------------------------------------------------------------------
 * ─── WHAT WAS WRONG WITH THE FIRST VERSION OF THIS FILE ────────────────────
 *
 * It sent SOL and nothing else, and the wallet screen said so:
 *
 *   «این ارسال فقط SOL بومی است و توکن‌های SPL را جابه‌جا نمی‌کند.»
 *
 * The comment that used to sit at the top of this module defended that: "this
 * module will not assemble a token transfer it cannot prove". The instinct was
 * right — never sign something you cannot verify — but the conclusion was
 * wrong, and the users said so:
 *
 *   «برای ارسال چرا می‌زنه؟ آیا خراب است؟ ارسال سولانا»
 *
 * What they read on the button was «ارسال» (Send) inside a wallet holding
 * USDC and a tokenized stock, and what they got was a sentence explaining that
 * the feature they had just tapped does not work. A holding with a balance and
 * no way to move it is not a conservative design, it is a dead end: the only
 * exit left is the swap screen, which charges a swap for what is a transfer.
 *
 * ─── WHAT IT TAKES TO PROVE AN SPL TRANSFER ────────────────────────────────
 * The three things the old comment was worried about are all answerable, and
 * each one is answered explicitly rather than assumed:
 *
 *   1. WHICH ACCOUNT HOLDS THE TOKENS. An SPL balance lives in an associated
 *      token account derived from (owner, program, mint). We DERIVE it — never
 *      accept one from a caller — so the source of a transfer can never be an
 *      account the user does not own.
 *   2. WHETHER THAT ACCOUNT EXISTS. Read from the chain before signing. A
 *      missing source account is a named refusal (`SPL_NO_ACCOUNT`), not a
 *      transaction that fails on the network after the user approved it.
 *   3. WHETHER THE RECIPIENT CAN RECEIVE IT. A destination without an
 *      associated account would fail with the classic
 *      `could not find account`. So the transaction includes an IDEMPOTENT
 *      create when the destination account is absent — idempotent because two
 *      transfers racing to the same new account must not fail, and because the
 *      instruction is a no-op if it already exists.
 *
 * `TransferChecked` (not `Transfer`) is used for the amount: it carries the
 * mint and the decimals in the instruction, so the token program itself
 * rejects a transfer whose scale does not match the mint. Getting decimals
 * wrong is the one mistake that silently moves a thousandth of the intended
 * amount, and this makes it impossible instead of unlikely.
 *
 * Both token programs are supported: a Token-2022 mint routes to
 * TokenzQd… and a classic mint to Tokenkeg…, because the mint's own program
 * is the only one that can move it.
 */
import { isSolanaAddress, toBaseUnits } from '../solana.js';
import { getSolanaRpcUrl } from '../solanaRpc.js';
import { signAndSendSolana } from '../solanaWallet.js';
import { bytesToBase64 } from './deeplinkUri.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  tokenProgramFor
} from './tokenPrograms.js';

/* SPL instruction discriminants, as published by the token program. */
const IX = Object.freeze({
  TransferChecked: 12,
  /** The Associated Token Account program's `CreateIdempotent`. */
  CreateIdempotent: 1
});

export function solToLamports(amount) {
  const raw = toBaseUnits(amount, 9);
  if (!raw || raw === '0') return null;
  try {
    const lamports = BigInt(raw);
    return lamports > 0n ? lamports : null;
  } catch {
    return null;
  }
}

/**
 * A token amount at a given scale → base units, or null.
 *
 * `toBaseUnits` refuses anything it cannot parse, and a caller that passes
 * `null` decimals gets `null` back rather than a guess: an unread scale is the
 * one input that makes a transfer dangerous, and the UI blocks on it.
 */
export function tokenAmountToRaw(amount, decimals) {
  /* `decimals == null` is checked BEFORE Number(): `Number(null)` is 0, so a
     missing scale would silently be read as "zero decimals" — i.e. a token
     amount multiplied by one instead of by a million. That is exactly the
     failure this function exists to prevent, and it cost a test run to catch
     it here rather than a user's balance on a phone. */
  if (decimals == null) return null;
  const scale = Number(decimals);
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) return null;
  const raw = toBaseUnits(amount, scale);
  if (!raw || raw === '0') return null;
  try {
    return BigInt(raw) > 0n ? raw : null;
  } catch {
    return null;
  }
}

/** u64 little-endian, as the token program expects it. */
function u64le(value) {
  let v = BigInt(value);
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** The associated token account of (owner, program, mint) — derived, never
    taken from a caller. Exported so a probe can assert the derivation against
    web3.js's own PDA helper. */
export async function deriveAta(owner, mint, programId) {
  const { PublicKey } = await import('@solana/web3.js');
  const ownerKey = new PublicKey(owner);
  const mintKey = new PublicKey(mint);
  const program = new PublicKey(tokenProgramFor(programId));
  const ataProgram = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);
  return PublicKey.findProgramAddressSync(
    [ownerKey.toBuffer(), program.toBuffer(), mintKey.toBuffer()],
    ataProgram
  )[0];
}

async function connectionFor() {
  const { Connection } = await import('@solana/web3.js');
  return new Connection(await getSolanaRpcUrl(), 'confirmed');
}

export async function buildNativeSolTransfer({ from, to, lamports }) {
  if (!isSolanaAddress(from)) {
    const err = new Error('NO_WALLET');
    err.code = 'NO_WALLET';
    throw err;
  }
  if (!isSolanaAddress(to)) {
    const err = new Error('BAD_AMOUNT');
    err.code = 'BAD_AMOUNT';
    throw err;
  }
  let amount;
  try {
    amount = BigInt(lamports);
  } catch {
    amount = 0n;
  }
  if (amount <= 0n) {
    const err = new Error('BAD_AMOUNT');
    err.code = 'BAD_AMOUNT';
    throw err;
  }

  const { Connection, PublicKey, SystemProgram, Transaction } = await import('@solana/web3.js');
  const connection = new Connection(await getSolanaRpcUrl(), 'confirmed');
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({
    feePayer: new PublicKey(from),
    recentBlockhash: blockhash
  });
  tx.add(SystemProgram.transfer({
    fromPubkey: new PublicKey(from),
    toPubkey: new PublicKey(to),
    lamports: amount
  }));
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return bytesToBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/** Sign and broadcast a legacy native transfer. `false` is the versioned flag. */
export async function sendNativeSol({ from, to, lamports }) {
  const base64 = await buildNativeSolTransfer({ from, to, lamports });
  return signAndSendSolana(base64, false);
}

/**
 * Build an SPL transfer: Token-2022 or classic, with the destination account
 * created idempotently when it does not exist yet.
 *
 * @param {object} p
 * @param {string} p.from        the owner's address (also the fee payer)
 * @param {string} p.to          the recipient's address
 * @param {string} p.mint        the mint being moved
 * @param {number} p.decimals    the mint's decimals, read from the chain
 * @param {string} p.raw         the amount in base units (see tokenAmountToRaw)
 * @param {string} [p.programId] the token program that owns the mint
 * @returns {Promise<string>} base64 of the unsigned legacy transaction
 */
export async function buildSplTransfer({ from, to, mint, decimals, raw, programId }) {
  if (!isSolanaAddress(from)) {
    const err = new Error('NO_WALLET');
    err.code = 'NO_WALLET';
    throw err;
  }
  if (!isSolanaAddress(to)) {
    const err = new Error('BAD_ADDRESS');
    err.code = 'BAD_ADDRESS';
    throw err;
  }
  if (!isSolanaAddress(mint)) {
    const err = new Error('BAD_MINT');
    err.code = 'BAD_MINT';
    throw err;
  }
  const scale = decimals == null ? NaN : Number(decimals);
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    const err = new Error('BAD_DECIMALS');
    err.code = 'BAD_DECIMALS';
    throw err;
  }
  let amount;
  try {
    amount = BigInt(raw);
  } catch {
    amount = 0n;
  }
  if (amount <= 0n) {
    const err = new Error('BAD_AMOUNT');
    err.code = 'BAD_AMOUNT';
    throw err;
  }

  const { PublicKey, SystemProgram, Transaction, TransactionInstruction } = await import('@solana/web3.js');
  const connection = await connectionFor();

  const owner = new PublicKey(from);
  const recipient = new PublicKey(to);
  const mintKey = new PublicKey(mint);
  const program = new PublicKey(tokenProgramFor(programId));
  const ataProgram = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);
  const systemProgram = new PublicKey(SYSTEM_PROGRAM_ID);

  const source = await deriveAta(from, mint, tokenProgramFor(programId));
  const destination = await deriveAta(to, mint, tokenProgramFor(programId));

  /* The source account is read BEFORE the transaction is built. Signing a
     transfer out of an account that does not exist would surface as a
     simulation failure on the phone, after the approval prompt. */
  const [sourceInfo, destinationInfo, latest] = await Promise.all([
    connection.getAccountInfo(source, 'confirmed'),
    connection.getAccountInfo(destination, 'confirmed'),
    connection.getLatestBlockhash('confirmed')
  ]);
  if (!sourceInfo) {
    const err = new Error('SPL_NO_ACCOUNT');
    err.code = 'SPL_NO_ACCOUNT';
    throw err;
  }

  const tx = new Transaction({ feePayer: owner, recentBlockhash: latest.blockhash });

  /*
   * The recipient's account, when they do not have one.
   *
   * Rent for a token account is ~0.00204 SOL and is paid by the SENDER here,
   * which is what every wallet does and what the sheet says out loud. The
   * instruction is `CreateIdempotent` (index 1) rather than `Create` (index 0)
   * on purpose: if the account is created between this read and the network
   * accepting the transaction, `Create` fails the whole transfer and the user
   * pays a fee to be told nothing happened.
   */
  if (!destinationInfo) {
    tx.add(new TransactionInstruction({
      programId: ataProgram,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: recipient, isSigner: false, isWritable: false },
        { pubkey: mintKey, isSigner: false, isWritable: false },
        { pubkey: systemProgram, isSigner: false, isWritable: false },
        { pubkey: program, isSigner: false, isWritable: false }
      ],
      data: new Uint8Array([IX.CreateIdempotent])
    }));
  }

  tx.add(new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mintKey, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }
    ],
    /* [discriminant, amount(u64 LE), decimals(u8)] — TransferChecked. */
    data: new Uint8Array([IX.TransferChecked, ...u64le(amount), scale])
  }));

  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return bytesToBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/** Sign and broadcast an SPL transfer (`false`: a legacy transaction). */
export async function sendSplToken(input) {
  const base64 = await buildSplTransfer(input);
  return signAndSendSolana(base64, false);
}

/**
 * ONE ENTRY POINT FOR THE SEND SHEET.
 *
 * The sheet knows which holding the user tapped; it should not also have to
 * know that native SOL and an SPL token are assembled by different builders
 * and signed the same way. `kind` is explicit rather than inferred from
 * `mint === SOL_MINT`, because the native mint is a sentinel this app owns and
 * an inference bug there moves lamports instead of tokens.
 */
export async function sendSolanaAsset({ kind, from, to, mint, decimals, amount, programId }) {
  if (kind === 'native') {
    const lamports = solToLamports(amount);
    if (!lamports) {
      const err = new Error('BAD_AMOUNT');
      err.code = 'BAD_AMOUNT';
      throw err;
    }
    return sendNativeSol({ from, to, lamports });
  }
  const raw = tokenAmountToRaw(amount, decimals);
  if (!raw) {
    const err = new Error('BAD_AMOUNT');
    err.code = 'BAD_AMOUNT';
    throw err;
  }
  return sendSplToken({ from, to, mint, decimals, raw, programId });
}

export { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };
