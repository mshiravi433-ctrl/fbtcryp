/**
 * SOLANA LAUNCH — the wallet signing path.
 * ============================================================================
 *
 * WHAT THIS PROVES BEFORE ANY SIGNATURE
 * Every transaction is SIMULATED against the user's own cluster first
 * (Solana's simulateTransaction — the exact equivalent of the EVM path's
 * estimateGas gate). A simulation failure names the reason and no wallet
 * prompt ever opens. The two transactions run SEQUENTIALLY: the buy is only
 * built after the create confirms, so a failed create can never strand a
 * signed buy.
 *
 * SIGNATURE ASSEMBLY (the part status.js used to list as missing)
 * The create transaction has TWO signers: the ephemeral mint keypair (which
 * becomes the mint account) and the user's wallet. The mint keypair is
 * generated on-device, partial-signs in memory, and is wiped afterwards; the
 * wallet adds the fee-payer signature through the SAME provider calls the
 * swap path already uses (injected signTransaction, or Wallet Standard on
 * Mobile Wallet Adapter). The assembly — partialSign(mint) → wallet signs →
 * all signatures verify — is tested in test/launch-solana-probe.mjs with
 * generated keypairs standing in for the wallet.
 *
 * BROADCAST + CONFIRMATION
 * Broadcast goes through the app's own Connection (the Settings-aware RPC,
 * mainnet or devnet — never assumed), and a signature is only reported after
 * getSignatureStatuses settles it (reusing confirmSolanaSignature from the
 * wallet stack). "Sent" without confirmation is reported as exactly that.
 *
 * LEGACY transactions (not V0): the payload is small (<1KB), every wallet —
 * including MWA — signs legacy, and there is no lookup-table dependency to
 * go stale. The create leg carries a 600k compute-unit ceiling (the value in
 * the SDK demo's own commented config); the limit is a ceiling, not a spend,
 * and simulation proves the real usage fits.
 *
 * This module is browser-only (it touches wallet providers). The probe never
 * imports it; it tests the assembly pattern with local keypairs instead.
 */

import {
  getSolanaProvider, getMwaWallet, mwaAccountInfo, confirmSolanaSignature
} from '../../solanaWallet.js';
import { LAUNCHLAB_ACCOUNT_SIZE } from './launchlab.js';

const CREATE_COMPUTE_UNITS = 600_000;

/** Settings-aware RPC, mirroring the wallet stack (custom → cluster default). */
export async function solanaLaunchRpcUrl() {
  try {
    const { useSettingsStore } = await import('../../../store/useSettingsStore');
    const st = useSettingsStore.getState();
    const custom = String(st.solanaRpc || '').trim();
    if (/^https:\/\//i.test(custom)) return custom;
    return st.solanaCluster === 'devnet'
      ? 'https://api.devnet.solana.com'
      : 'https://api.mainnet-beta.solana.com';
  } catch {
    return 'https://api.mainnet-beta.solana.com';
  }
}

export async function solanaLaunchCluster() {
  try {
    const { useSettingsStore } = await import('../../../store/useSettingsStore');
    return useSettingsStore.getState().solanaCluster === 'devnet' ? 'devnet' : 'mainnet-beta';
  } catch {
    return 'mainnet-beta';
  }
}

export async function getSolanaLaunchConnection(commitment = 'confirmed') {
  const { Connection } = await import('@solana/web3.js');
  return new Connection(await solanaLaunchRpcUrl(), commitment);
}

/**
 * Build a legacy transaction from plan items, with a fresh blockhash and the
 * ephemeral signers already partial-signed. The WALLET signature is the only
 * one missing — which is exactly what the wallet is asked to add.
 */
export async function assembleLaunchTransaction({
  connection, payer, items, extraSigners = [], computeUnits = 0
}) {
  const { Transaction, PublicKey, ComputeBudgetProgram } = await import('@solana/web3.js');
  const tx = new Transaction();
  if (computeUnits > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  }
  for (const item of items) tx.add(item.instruction);
  tx.feePayer = new PublicKey(payer);
  const { blockhash, lastValidBlockHeight } = await connection
    .getLatestBlockhash('confirmed')
    .catch(() => { throw new Error('BLOCKHASH_UNAVAILABLE'); });
  tx.recentBlockhash = blockhash;
  if (extraSigners.length) tx.partialSign(...extraSigners);
  return { tx, lastValidBlockHeight };
}

/**
 * The pre-signature gate. Returns {ok:true} or {ok:false, reason, logs}.
 * A failing simulation must NEVER open a wallet prompt — the caller enforces
 * that by refusing to proceed unless ok is true.
 */
export async function simulateLaunchTransaction({ connection, tx }) {
  let res;
  try {
    res = await connection.simulateTransaction(tx);
  } catch (e) {
    return { ok: false, reason: 'SIMULATION_RPC_FAILED', detail: String(e?.message || '').slice(0, 160) };
  }
  const err = res?.value?.err;
  if (err) {
    return {
      ok: false,
      reason: 'SIMULATION_FAILED',
      detail: JSON.stringify(err).slice(0, 200),
      logs: Array.isArray(res?.value?.logs) ? res.value.logs.slice(-8) : [],
      unitsConsumed: res?.value?.unitsConsumed ?? null
    };
  }
  return { ok: true, unitsConsumed: res?.value?.unitsConsumed ?? null };
}

function asRejected(err) {
  return err?.code === 4001 || /reject|denied|cancel/i.test(String(err?.message || ''));
}

/**
 * Sign (wallet) + broadcast (our connection) + confirm (status polling).
 * Throws NAMED errors only: REJECTED (user said no), SIGN_FAILED,
 * SEND_FAILED, BLOCKHASH_EXPIRED (retryable — rebuild, don't reuse),
 * CONFIRMATION_FAILED (sent, landing unproven — the signature is attached).
 */
export async function signSendConfirm({ connection, tx, cluster = 'mainnet-beta', timeoutMs = 60_000 }) {
  const provider = getSolanaProvider();
  const mwa = !provider ? getMwaWallet() : null;
  const chain = cluster === 'devnet' ? 'solana:devnet' : 'solana:mainnet';

  let signedBytes;
  if (mwa) {
    const account = mwaAccountInfo() ?? mwa.accounts?.[0];
    const signOnly = mwa.features?.['solana:signTransaction'];
    const signAndSend = mwa.features?.['solana:signAndSendTransaction'];
    if (!account || (!signOnly?.signTransaction && !signAndSend?.signAndSendTransaction)) {
      throw new Error('CANNOT_SIGN');
    }
    try {
      // Prefer sign-only: broadcast stays on our connection so confirmation
      // polling and the RPC choice are uniform across wallet types.
      if (signOnly?.signTransaction) {
        const out = await signOnly.signTransaction({
          account,
          transaction: tx.serialize({ requireAllSignatures: false }),
          chain
        });
        signedBytes = out instanceof Uint8Array ? out : null;
      } else {
        const results = await signAndSend.signAndSendTransaction({
          account,
          transaction: tx.serialize({ requireAllSignatures: false }),
          chain,
          options: { commitment: 'confirmed', skipPreflight: false, maxRetries: 3 }
        });
        const sigBytes = results?.[0]?.signature;
        if (!(sigBytes instanceof Uint8Array) || !sigBytes.length) throw new Error('NO_SIGNATURE');
        return finishFromSignature({ connection, signature: base58FromBytes(sigBytes), timeoutMs });
      }
    } catch (err) {
      if (asRejected(err)) throw new Error('REJECTED');
      if (['CANNOT_SIGN', 'NO_SIGNATURE'].includes(err?.message)) throw err;
      throw new Error('SIGN_FAILED');
    }
    if (!(signedBytes instanceof Uint8Array) || !signedBytes.length) throw new Error('SIGN_FAILED');
  } else {
    if (!provider) throw new Error('NO_WALLET');
    if (typeof provider.signTransaction !== 'function' && typeof provider.signAndSendTransaction !== 'function') {
      throw new Error('CANNOT_SIGN');
    }
    try {
      if (typeof provider.signTransaction === 'function') {
        // The partially-signed legacy tx: Phantom/Solflare/Backpack add the
        // fee-payer signature and preserve the mint keypair's — the standard
        // multi-signer flow, the same call the swap path uses.
        const signed = await provider.signTransaction(tx);
        signedBytes = signed.serialize();
      } else {
        const res = await provider.signAndSendTransaction(tx);
        const sig = typeof res === 'string' ? res : res?.signature;
        if (!sig) throw new Error('NO_SIGNATURE');
        return finishFromSignature({ connection, signature: sig, timeoutMs });
      }
    } catch (err) {
      if (asRejected(err)) throw new Error('REJECTED');
      if (['CANNOT_SIGN', 'NO_SIGNATURE'].includes(err?.message)) throw err;
      throw new Error('SIGN_FAILED');
    }
  }

  let signature;
  try {
    signature = await connection.sendRawTransaction(signedBytes, { skipPreflight: false, maxRetries: 3 });
  } catch (err) {
    const msg = String(err?.message || '');
    if (/blockhash|expired|BlockhashNotFound/i.test(msg)) throw new Error('BLOCKHASH_EXPIRED');
    if (/insufficient|0x1\b|simulation failed/i.test(msg)) throw new Error('INSUFFICIENT_BALANCE');
    const e = new Error('SEND_FAILED');
    e.detail = msg.slice(0, 160);
    throw e;
  }
  return finishFromSignature({ connection, signature, timeoutMs });
}

async function finishFromSignature({ connection, signature, timeoutMs }) {
  const settled = await confirmSolanaSignature(signature, { timeoutMs });
  if (!settled?.ok) {
    const e = new Error(settled?.code === 'TRANSACTION_ERROR' ? 'TX_REVERTED' : 'CONFIRMATION_FAILED');
    e.signature = signature;
    e.detail = settled?.code || 'TIMEOUT';
    throw e;
  }
  return { signature, slot: settled.slot ?? null };
}

function base58FromBytes(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let out = '';
  for (let i = 0; i < bytes.length - 1 && bytes[i] === 0; i += 1) out += '1';
  for (let i = digits.length - 1; i >= 0; i -= 1) out += alphabet[digits[i]];
  return out;
}

/**
 * Run ONE plan leg end to end: assemble → simulate → sign → send → confirm.
 * `onStage(stage)` reports: 'simulating' | 'signing' | 'confirming'.
 */
export async function runLaunchLeg({
  connection, cluster, payer, items, extraSigners = [], computeUnits = 0, onStage = null
}) {
  const { tx } = await assembleLaunchTransaction({ connection, payer, items, extraSigners, computeUnits });
  onStage?.('simulating');
  const sim = await simulateLaunchTransaction({ connection, tx });
  if (!sim.ok) {
    const e = new Error(sim.reason);
    e.detail = sim.detail || null;
    e.logs = sim.logs || [];
    throw e;
  }
  onStage?.('signing');
  const done = await signSendConfirm({ connection, tx, cluster });
  return { ...done, unitsConsumed: sim.unitsConsumed };
}

export const LAUNCH_CREATE_COMPUTE_UNITS = CREATE_COMPUTE_UNITS;

/**
 * Cost quote for the review screen — every number READ, none guessed:
 * rent-exempt minimums per account size, plus message fees for the exact
 * transactions that will be sent. The metadata size is an UPPER bound, so
 * `rentLamports` is disclosed as "at most". Throws RPC_UNAVAILABLE when the
 * cluster cannot be reached — the UI then shows "unknown" rather than a lie.
 */
export async function estimateLaunchCost({ connection, payer, plan }) {
  try {
    const sizes = [
      LAUNCHLAB_ACCOUNT_SIZE.poolState,
      LAUNCHLAB_ACCOUNT_SIZE.vault,
      LAUNCHLAB_ACCOUNT_SIZE.vault,
      LAUNCHLAB_ACCOUNT_SIZE.mint,
      LAUNCHLAB_ACCOUNT_SIZE.metadataMax
    ];
    const rents = await Promise.all(
      sizes.map((s) => connection.getMinimumBalanceForRentExemption(s)));
    const rentLamports = rents.reduce((a, b) => a + BigInt(b), 0n);
    const { tx: createTx } = await assembleLaunchTransaction({
      connection, payer, items: plan.create.items, extraSigners: [], computeUnits: CREATE_COMPUTE_UNITS
    });
    const createFee = BigInt(await connection.getFeeForMessage(createTx.compileMessage(), 'confirmed').then((r) => r?.value ?? 5000));
    let buyFee = 0n;
    let buyAtaRent = 0n;
    if (plan.buy) {
      const { tx: buyTx } = await assembleLaunchTransaction({
        connection, payer, items: plan.buy.items, extraSigners: [], computeUnits: 0
      });
      buyFee = BigInt(await connection.getFeeForMessage(buyTx.compileMessage(), 'confirmed').then((r) => r?.value ?? 5000));
      buyAtaRent = BigInt(await connection.getMinimumBalanceForRentExemption(LAUNCHLAB_ACCOUNT_SIZE.vault));
    }
    return {
      ok: true,
      rentLamports: rentLamports.toString(),
      createFeeLamports: createFee.toString(),
      buyFeeLamports: buyFee.toString(),
      buyAtaRentLamports: buyAtaRent.toString(),
      firstBuyLamports: plan.economics?.firstBuy?.lamports ?? '0'
    };
  } catch (e) {
    if (e?.message === 'BLOCKHASH_UNAVAILABLE') throw e;
    const err = new Error('RPC_UNAVAILABLE');
    err.detail = String(e?.message || '').slice(0, 120);
    throw err;
  }
}

/** Wipe an ephemeral keypair's secret bytes once its job is done. */
export function wipeKeypair(keypair) {
  try {
    if (keypair?.secretKey) keypair.secretKey.fill(0);
  } catch { /* best effort — the reference is dropped either way */ }
}
