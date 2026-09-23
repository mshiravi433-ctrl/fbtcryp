/**
 * SOLANA TRANSACTION VERSION CONVERSION — legacy ⇄ v0.
 * ============================================================================
 * WHY THIS EXISTS (report: «گاهی اصلا امضا نمی‌کند»)
 * ---------------------------------------------------------------------------
 * A Solana transaction exists in two wire formats: the original LEGACY format
 * and the VERSIONED (v0) format. Every wallet accepts one or both, and which
 * one is a property of the WALLET, not of the transaction:
 *
 *   · Mobile Wallet Adapter wallets advertise `supportedTransactionVersions`.
 *     On Android that list is `[0]` — v0 only, and a wallet that advertises
 *     `[0]` will not sign legacy bytes at all.
 *   · The vendored Kamino SDK (v5) builds LEGACY transactions.
 *
 * So on an Android phone the loan panel asked an MWA wallet to sign a legacy
 * transaction, the wallet layer saw `[0]` ≠ `'legacy'` and — correctly, if
 * unhelpfully — refused before the wallet app was ever opened. From the screen
 * that is indistinguishable from «sometimes it just does not sign»: no
 * approval screen, no transaction, nothing the user caused.
 *
 * Refusing was never necessary. The instructions, the account list, the fee
 * payer and the blockhash all survive a recompile; only the message envelope
 * changes. And a conversion that would NOT be faithful is refused by name
 * (`UNSUPPORTED_TRANSACTION`) — a v0 message that uses an address lookup table
 * has no legacy form, and pretending otherwise would hand the wallet bytes
 * that mean something else.
 *
 * Nothing here signs anything, and nothing here can change what a transaction
 * DOES: instructions are copied, never rewritten.
 */

/** The two wire formats, as wallets name them. */
export const TX_VERSION = Object.freeze({ LEGACY: 'legacy', V0: 0 });

const base64ToBytes = (value) => {
  if (typeof atob === 'function') {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
};

const bytesToBase64 = (bytes) => {
  /* Chunked: `String.fromCharCode(...bytes)` overflows the call stack on a
     transaction of a few kB, and this runs on phones. */
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
};

const unsupported = () => {
  const error = new Error('UNSUPPORTED_TRANSACTION');
  error.code = 'UNSUPPORTED_TRANSACTION';
  return error;
};

/**
 * Which format is this base64 payload? `'legacy'` | 0 | null (unreadable).
 *
 * A serialized transaction starts with the SIGNATURE COUNT, then that many
 * 64-byte signatures, and only then the message — whose first byte carries the
 * version prefix (0x80 | version) for a versioned message and the legacy
 * header for a legacy one. Reading byte 0 as the version (a tempting
 * shortcut, and a wrong one: a v0 transaction with one signature starts with
 * 0x01) is exactly how a converter decides to convert something twice.
 */
export function detectTransactionVersion(base64Tx) {
  try {
    const bytes = base64ToBytes(String(base64Tx));
    if (bytes.length < 2) return null;
    const signatures = bytes[0];
    if (signatures === 0 || signatures & 0x80) return null;
    const offset = 1 + signatures * 64;
    if (offset >= bytes.length) return null;
    const prefix = bytes[offset];
    if (prefix & 0x80) return prefix & 0x7f;
    return TX_VERSION.LEGACY;
  } catch {
    return null;
  }
}

/**
 * Does this wallet's version list accept `version` (0 or 'legacy')?
 * An empty/absent list means the wallet published no constraint: anything goes.
 */
export function walletAcceptsVersion(supportedTransactionVersions, version) {
  const list = Array.isArray(supportedTransactionVersions) ? supportedTransactionVersions : [];
  if (!list.length) return true;
  if (version === TX_VERSION.LEGACY) {
    return list.some((v) => String(v).toLowerCase() === 'legacy');
  }
  return list.some((v) => Number(v) === 0);
}

/**
 * The format order to try with THIS wallet, given what the builder produced:
 * the wallet's own preference first, then the other one (converted on demand).
 * A wallet that publishes nothing gets what the builder built, and nothing
 * else — no conversion is performed without a reason.
 */
export function preferredTransactionVersions(supportedTransactionVersions, builtAs) {
  const list = Array.isArray(supportedTransactionVersions) ? supportedTransactionVersions : [];
  const other = builtAs === TX_VERSION.LEGACY ? TX_VERSION.V0 : TX_VERSION.LEGACY;
  if (!list.length) return [builtAs];
  if (walletAcceptsVersion(list, builtAs)) return [builtAs, other];
  if (walletAcceptsVersion(list, other)) return [other];
  return [builtAs];
}

/**
 * The bytes to hand a Wallet Standard wallet, converted to a format it accepts.
 *
 * This is the whole fix for «sometimes it just does not sign», in one function:
 * the wallet's own version list decides the format, never the caller's flag,
 * and the wallet's answer is never second-guessed — an empty list means the
 * wallet published no constraint and the built bytes stand.
 *
 * @param {string} base64Tx   what the Kamino builder produced
 * @param {Array|undefined} supportedTransactionVersions  from the wallet feature
 * @param {'legacy'|0} builtAs
 * @returns {Promise<{payload: Uint8Array, version: 'legacy'|0, converted: boolean}>}
 */
export async function payloadForWallet(base64Tx, supportedTransactionVersions, builtAs) {
  const order = preferredTransactionVersions(supportedTransactionVersions, builtAs);
  const target = order[0];
  if (target === builtAs) return { payload: base64ToBytes(String(base64Tx)), version: builtAs, converted: false };
  const converted = await convertTransactionVersion(base64Tx, target);
  return { payload: base64ToBytes(converted), version: target, converted: true };
}

/**
 * Re-encode a transaction into `target` ('legacy' or 0).
 *
 * @param {string} base64Tx
 * @param {'legacy'|0} target
 * @returns {Promise<string>} base64 of the converted transaction
 * @throws {Error & {code:'UNSUPPORTED_TRANSACTION'}} when the conversion cannot
 *   be faithful (a v0 message with an address lookup table has no legacy form;
 *   unreadable bytes are never guessed at).
 */
export async function convertTransactionVersion(base64Tx, target) {
  const { Transaction, VersionedTransaction, TransactionMessage } = await import('@solana/web3.js');
  const payload = String(base64Tx);
  const current = detectTransactionVersion(payload);
  if (current === target) return payload;
  if (current == null) throw unsupported();
  const bytes = base64ToBytes(payload);

  if (current === TX_VERSION.LEGACY && target === TX_VERSION.V0) {
    let legacy;
    try {
      legacy = Transaction.from(bytes);
    } catch {
      throw unsupported();
    }
    if (!legacy.feePayer || !legacy.recentBlockhash) throw unsupported();
    /* The signatures on the legacy message are signatures over BYTES THAT NO
       LONGER EXIST once the envelope changes, so they are deliberately not
       carried over: the converted transaction is unsigned, which is precisely
       the state a wallet needs in order to sign it. */
    const message = new TransactionMessage({
      payerKey: legacy.feePayer,
      recentBlockhash: legacy.recentBlockhash,
      instructions: legacy.instructions.map((ix) => ({
        programId: ix.programId,
        keys: ix.keys.map((key) => ({ pubkey: key.pubkey, isSigner: key.isSigner, isWritable: key.isWritable })),
        data: ix.data
      }))
    }).compileToV0Message();
    return bytesToBase64(new VersionedTransaction(message).serialize());
  }

  if (current === TX_VERSION.V0 && target === TX_VERSION.LEGACY) {
    let versioned;
    try {
      versioned = VersionedTransaction.deserialize(bytes);
    } catch {
      throw unsupported();
    }
    /* `decompile` throws when the message references an address lookup table it
       cannot resolve — the one v0 feature legacy cannot express. */
    let message;
    try {
      message = TransactionMessage.decompile(versioned.message).compileToLegacyMessage();
    } catch {
      throw unsupported();
    }
    const legacy = Transaction.populate(message);
    return bytesToBase64(legacy.serialize({ requireAllSignatures: false, verifySignatures: false }));
  }

  throw unsupported();
}
