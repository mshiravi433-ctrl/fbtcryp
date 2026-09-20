/**
 * WHY PHANTOM SAYS «THIS DAPP COULD BE MALICIOUS» — decided before we ask.
 * ---------------------------------------------------------------------------
 * The report: «سایت ما را فانتوم مخرب شناخته، ریسک تراکنش می‌ذاره … چرا ارور
 * می‌ذاره بخصوص وقتی بخواد امضا کنی».
 *
 * That sentence is not one warning and it is not (only) a reputation problem.
 * Phantom publishes three separate ones, and only two of them are ours to
 * influence (docs.phantom.com → «Domain and transaction warnings»):
 *
 *   1. «This domain is new or has not been reviewed yet.» — automatic for a
 *      newly seen domain, and it goes away on its own after review. NOTHING in
 *      this repository can switch it off, and no code should pretend to.
 *   2. «This app's identity could not be verified.» — Mobile Wallet Adapter
 *      only, and it is a missing `/.well-known/assetlinks.json` on our domain
 *      (see scripts/assetlinks.mjs).
 *   3. «This dApp could be malicious. Do not proceed unless you are certain it
 *      is safe.» — the TRANSACTION SIMULATION warning, and this is the one that
 *      fires «بخصوص وقتی بخواد امضا کنی». It means Phantom could not predict
 *      what the transaction will do. It is a property of the transaction, so
 *      it can be decided HERE, before the wallet is opened, instead of being
 *      discovered by the user in front of a scary dialog.
 *
 * Phantom's own published remedies for #3, which is what this module encodes:
 *
 *   • limit the transaction to ONE signer;
 *   • if it needs several, sign with Phantom using `signTransaction` (sign
 *     only) FIRST and collect the other signatures afterwards;
 *   • if it approaches Solana's size limit, split it or use lookup tables;
 *   • simulate it (`sigVerify: false`) before asking for a signature — a
 *     transaction that would fail onchain also trips the warning.
 *
 * ─── SCOPE ──────────────────────────────────────────────────────────────────
 * Pure and dependency-free: it reads the compiled message header out of the
 * bytes, which is a fixed layout in both transaction formats, so it needs
 * neither `@solana/web3.js` (19 MB, dynamically imported elsewhere for exactly
 * that reason) nor a browser. Everything here is assertable in plain Node.
 */
import { base64ToBytes } from './deeplinkUri.js';

/** Solana's on-the-wire transaction size limit, in bytes. */
export const SOLANA_TX_SIZE_LIMIT = 1232;

/**
 * Where a compiled message starts carrying its header.
 *
 * A LEGACY transaction begins with the three header bytes. A VERSIONED one
 * begins with a prefix byte whose high bit is set (the low bits are the
 * version — currently only 0), and the header follows it. Reading byte 0 as
 * `numRequiredSignatures` on a versioned transaction is the classic mistake:
 * it yields 128+, i.e. a "multi-signer" verdict on every Jupiter swap.
 */
function headerOffset(bytes) {
  return bytes.length > 0 && (bytes[0] & 0x80) !== 0 ? 1 : 0;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (typeof input === 'string') {
    try {
      return base64ToBytes(input);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Inspect a compiled transaction and say what the wallet will make of it.
 *
 * @param {Uint8Array|string} input raw bytes, or the base64 the API returned
 * @returns {{
 *   ok: boolean,
 *   versioned: boolean,
 *   signerCount: number|null,
 *   sizeBytes: number,
 *   oversize: boolean,
 *   multiSigner: boolean,
 *   op: 'signAndSendTransaction'|'signTransaction'|null,
 *   warnings: string[]
 * }}
 *
 * `ok: false` means the bytes could not be read at all — which is NOT a
 * verdict. A guard that refuses a signature because it could not parse the
 * transaction is worse than the warning it was written to explain, so an
 * unreadable input comes back with no warnings and the caller's own op.
 */
export function inspectSolanaTransaction(input) {
  const bytes = toBytes(input);
  const sizeBytes = bytes ? bytes.length : 0;
  if (!bytes || bytes.length < headerOffset(bytes) + 3) {
    return {
      ok: false,
      versioned: false,
      signerCount: null,
      sizeBytes,
      oversize: false,
      multiSigner: false,
      op: null,
      warnings: []
    };
  }

  const offset = headerOffset(bytes);
  const versioned = offset === 1;
  const signerCount = bytes[offset];
  const multiSigner = signerCount > 1;
  /* At the limit Solana rejects the transaction outright, and just under it a
     wallet's simulation is the thing that gives up — both read to the user as
     «the wallet said it is dangerous», so both are named here. */
  const oversize = sizeBytes > SOLANA_TX_SIZE_LIMIT;

  const warnings = [];
  if (multiSigner) warnings.push('MULTI_SIGNER');
  if (oversize) warnings.push('TX_OVERSIZE');

  return {
    ok: true,
    versioned,
    signerCount,
    sizeBytes,
    oversize,
    multiSigner,
    /*
     * Phantom's documented order for a transaction it cannot simulate: sign
     * ONLY, then collect the remaining signatures. Asking it to sign AND
     * broadcast a transaction that still needs another signer is a request it
     * can neither simulate nor honour.
     */
    op: multiSigner ? 'signTransaction' : 'signAndSendTransaction',
    warnings
  };
}

/**
 * The warnings one transaction will produce, as stable keys.
 *
 * Kept separate from `inspectSolanaTransaction` so a caller that only needs
 * the human-facing part does not have to know the header layout exists.
 */
export function solanaSignWarnings(input) {
  return inspectSolanaTransaction(input).warnings;
}
