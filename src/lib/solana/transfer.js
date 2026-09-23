/**
 * Native SOL send. SPL transfers are intentionally absent: this module will
 * not assemble a token transfer it cannot prove, and the wallet screen must
 * not offer a button that pretends otherwise.
 */
import { isSolanaAddress, toBaseUnits } from '../solana.js';
import { getSolanaRpcUrl } from '../solanaRpc.js';
import { signAndSendSolana } from '../solanaWallet.js';
import { bytesToBase64 } from './deeplinkUri.js';

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
