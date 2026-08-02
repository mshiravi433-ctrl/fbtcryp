/**
 * SOLANA WALLET CONNECTION
 * ---------------------------------------------------------------------------
 * Solana wallets inject a provider on `window` exactly like EVM wallets do,
 * but the interface is different enough that none of the WalletContext code
 * applies: there is no chainId, no eth_requestAccounts, and signing takes a
 * transaction object rather than a hex payload.
 *
 * This module is deliberately small and dependency-light at import time.
 * `@solana/web3.js` is 19 MB installed and is only needed to deserialise the
 * transaction Jupiter returns, so it is imported dynamically inside the signing
 * path. A user who never opens the Solana tab never downloads it — the same
 * reasoning that keeps eleven locale files out of the entry chunk.
 */

/**
 * Find an injected Solana provider.
 *
 * Phantom namespaces itself under `window.phantom.solana` and ALSO sets
 * `window.solana`, while Solflare and Backpack set only their own. Checking
 * the namespaced one first matters: some wallets set `window.solana` as a
 * compatibility shim and then refuse to sign, so preferring the explicit
 * namespace picks the provider that actually works.
 */
export function getSolanaProvider() {
  if (typeof window === 'undefined') return null;
  const w = window;
  return (
    w.phantom?.solana ??
    w.solflare ??
    w.backpack ??
    (w.solana?.isPhantom || w.solana?.isSolflare ? w.solana : null) ??
    w.solana ??
    null
  );
}

export const solanaWalletAvailable = () => Boolean(getSolanaProvider());

/** Human name for the connected wallet, for the UI. */
export function solanaWalletName() {
  const p = getSolanaProvider();
  if (!p) return null;
  if (p.isPhantom) return 'Phantom';
  if (p.isSolflare) return 'Solflare';
  if (p.isBackpack) return 'Backpack';
  return 'Solana wallet';
}

/**
 * Connect and return the public key as a base58 string.
 *
 * Throws a stable error KEY rather than the wallet's own message, because
 * those differ per wallet and are not translatable. The caller maps the key to
 * localised copy.
 */
export async function connectSolana() {
  const provider = getSolanaProvider();
  if (!provider) throw new Error('NO_WALLET');

  try {
    const res = await provider.connect();
    const pk = res?.publicKey ?? provider.publicKey;
    const address = pk?.toString?.();
    if (!address) throw new Error('NO_ACCOUNT');
    return address;
  } catch (err) {
    // 4001 is the universal "user rejected" code, mirrored from EIP-1193.
    if (err?.code === 4001 || /reject|denied|cancel/i.test(String(err?.message))) {
      throw new Error('REJECTED');
    }
    throw new Error(err?.message === 'NO_ACCOUNT' ? 'NO_ACCOUNT' : 'CONNECT_FAILED');
  }
}

export async function disconnectSolana() {
  try {
    await getSolanaProvider()?.disconnect?.();
  } catch {
    /* a wallet that cannot disconnect is not an error worth surfacing */
  }
}

/** The currently connected address, or null. */
export function solanaAddress() {
  const p = getSolanaProvider();
  return p?.publicKey?.toString?.() ?? null;
}

/**
 * Sign a base64 transaction from Jupiter and return it base64-encoded again.
 *
 * ─── WHY PARTIAL SIGNING, NOT signAndSendTransaction ────────────────────────
 * The obvious call is `provider.signAndSendTransaction()`, and it is wrong
 * here. Jupiter's `/execute` needs the signed transaction handed back to IT so
 * it can land the trade through its own pipeline — and for JupiterZ (RFQ)
 * orders a market maker must add a second signature after ours. Broadcasting
 * ourselves would bypass Jupiter's landing infrastructure and break RFQ routes
 * outright, which are the ones that price best on major pairs.
 *
 * So: sign only, then return. Jupiter sends it.
 */
export async function signSolanaTransaction(base64Tx) {
  const provider = getSolanaProvider();
  if (!provider) throw new Error('NO_WALLET');
  if (typeof provider.signTransaction !== 'function') throw new Error('CANNOT_SIGN');

  // Dynamic import: keeps 19 MB of Solana SDK out of the entry chunk for the
  // majority of users, who never touch this path.
  const { VersionedTransaction } = await import('@solana/web3.js');

  let tx;
  try {
    tx = VersionedTransaction.deserialize(base64ToBytes(base64Tx));
  } catch {
    throw new Error('BAD_TRANSACTION');
  }

  let signed;
  try {
    signed = await provider.signTransaction(tx);
  } catch (err) {
    if (err?.code === 4001 || /reject|denied|cancel/i.test(String(err?.message))) {
      throw new Error('REJECTED');
    }
    throw new Error('SIGN_FAILED');
  }

  return bytesToBase64(signed.serialize());
}

/*
 * base64 <-> bytes without Buffer.
 *
 * `Buffer` does not exist in a browser or in an Android WebView; relying on a
 * Vite polyfill for something this small would be another dependency in the
 * critical path of a money transaction.
 */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000; // avoid "too many arguments" on large transactions
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
