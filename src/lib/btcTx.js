/**
 * BITCOIN TRANSACTIONS — pure P2WPKH build + BIP-143 sign, no new dependency.
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS MODULE IS ALLOWED TO DO ─────────────────────────────────────
 * Build and sign transactions that spend OUR OWN m/84' UTXOs. It receives a
 * private key from the caller (the in-memory signer of an UNLOCKED local
 * vault, see btcWallet.js), uses it, and forgets it. It never stores, logs
 * or serialises a key, and it never talks to the network — broadcasting is
 * server/btcChain.js's job, reached through the same /api proxy as everything
 * else.
 *
 * ─── THE SIGNATURE IS PINNED BY THE SPEC, NOT BY TRUST ─────────────────────
 * The BIP-143 native-P2WPKH example is reproduced bit-for-bit in
 * test/btc-wallet-probe.mjs: the sighash digest and the DER signature we
 * produce for the BIP's own unsigned transaction and private key equal the
 * values printed in the BIP text. Everything else — serialization, txid,
 * vsize — is exercised against the same fixture's signed hex.
 *
 * ─── SELECTION POLICY: ALL UTXOs OR NONE ───────────────────────────────────
 * A coin-selection optimiser is a place to be clever, and clever is how
 * wallets send change to a wrong address. Every build spends ALL confirmed
 * UTXOs of the derived address, adds the payee output(s), an optional
 * OP_RETURN memo, and sweeps the remainder to the change address (the same
 * internal address — m/84'/0'/0'/0/0 for now). A change below the 546-sat
 * dust floor is folded into the fee rather than creating a spam output.
 *
 * Synchronous and pure: hashing comes from btcAddress.js's own SHA-256 and
 * only the ECDSA step awaits ethers (which the app already ships for the EVM
 * wallet — no new dependency, and it stays in its own lazy chunk).
 */

import { sha256 } from './btcAddress.js';

export const SIGHASH_ALL = 0x01;
export const DUST_SATS = 546;
/** BIP-350-era standardness: an OP_RETURN carrier is capped at 80 bytes. */
export const OP_RETURN_MAX_BYTES = 80;

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/* ------------------------------ byte helpers ------------------------------ */

const HEX = /^[0-9a-fA-F]+$/;

export function hexToBytes(hex) {
  const s = String(hex ?? '').trim().toLowerCase();
  if (!HEX.test(s) || s.length % 2 !== 0) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const dsha256 = (bytes) => sha256(sha256(bytes));

function u8(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Bitcoin varint (CompactSize): 1/3/5/9 byte forms. */
function varint(n) {
  if (n < 0) throw new Error('BAD_VARINT');
  if (n < 0xfd) return Uint8Array.from([n]);
  if (n <= 0xffff) return Uint8Array.from([0xfd, n & 0xff, (n >> 8) & 0xff]);
  if (n <= 0xffffffff) {
    return Uint8Array.from([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  }
  const lo = BigInt(n) & 0xffffffffn;
  const hi = (BigInt(n) >> 32n) & 0xffffffffn;
  return Uint8Array.from([
    0xff,
    Number(lo & 0xffn), Number((lo >> 8n) & 0xffn), Number((lo >> 16n) & 0xffn), Number((lo >> 24n) & 0xffn),
    Number(hi & 0xffn), Number((hi >> 8n) & 0xffn), Number((hi >> 16n) & 0xffn), Number((hi >> 24n) & 0xffn)
  ]);
}

/* --------------------------- serialization ------------------------------- */

/**
 * Serialize a tx structure.
 *
 * tx = { version, locktime, inputs: [{ txid, vout, scriptSig, sequence,
 *        witness: [bytes…] | null }], outputs: [{ value, script }] }
 *
 * `txid` is the EXPLORER-order hex (as Esplora/mempool.space print it); the
 * wire format is little-endian, so the bytes are reversed here once, in this
 * one place.
 */
export function serializeTx(tx, { witness = true } = {}) {
  const parts = [];
  parts.push(new Uint8Array([tx.version & 0xff, (tx.version >> 8) & 0xff, (tx.version >> 16) & 0xff, (tx.version >> 24) & 0xff]));
  const useWitness = witness && tx.inputs.some((i) => Array.isArray(i.witness));
  if (useWitness) parts.push(Uint8Array.of(0x00, 0x01)); /* marker + flag */

  parts.push(varint(tx.inputs.length));
  for (const inp of tx.inputs) {
    const txidBytes = hexToBytes(inp.txid);
    if (!txidBytes || txidBytes.length !== 32) throw new Error('BAD_TXID');
    const reversed = txidBytes.slice().reverse();
    const vout = new Uint8Array(4);
    new DataView(vout.buffer).setUint32(0, inp.vout >>> 0, true);
    parts.push(reversed, vout, varint(inp.scriptSig?.length ?? 0), inp.scriptSig ?? new Uint8Array(0));
    const seq = new Uint8Array(4);
    new DataView(seq.buffer).setUint32(0, inp.sequence >>> 0, true);
    parts.push(seq);
  }

  parts.push(varint(tx.outputs.length));
  for (const out of tx.outputs) {
    const value = new Uint8Array(8);
    let v = BigInt(Math.trunc(out.value));
    if (v < 0n || v > 0xffffffffffffffffn) throw new Error('BAD_VALUE');
    for (let i = 0; i < 8; i++) {
      value[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    parts.push(value, varint(out.script.length), out.script);
  }

  if (useWitness) {
    for (const inp of tx.inputs) {
      const stack = Array.isArray(inp.witness) ? inp.witness : [];
      parts.push(varint(stack.length));
      for (const item of stack) parts.push(varint(item.length), item);
    }
  }

  parts.push(new Uint8Array([
    tx.locktime & 0xff, (tx.locktime >> 8) & 0xff, (tx.locktime >> 16) & 0xff, (tx.locktime >> 24) & 0xff
  ]));

  return u8(...parts);
}

/**
 * Parse a serialized transaction (witness or legacy) into the same structure
 * serializeTx emits. Used by the BIP-143 fixture and for inspecting errors.
 */
export function parseBitcoinTx(hex) {
  const bytes = hexToBytes(hex);
  if (!bytes) return null;
  let at = 0;
  const rd = (n) => {
    if (at + n > bytes.length) throw new Error('TRUNCATED_TX');
    const slice = bytes.slice(at, at + n);
    at += n;
    return slice;
  };
  const rdUint32 = () => {
    const b = rd(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  };
  const rdVarint = () => {
    const first = rd(1)[0];
    if (first < 0xfd) return first;
    const n = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
    const b = rd(n);
    let v = 0n;
    for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
    return Number(v);
  };

  try {
    const version = rdUint32();
    let witness = false;
    if (bytes[at] === 0x00 && bytes[at + 1] === 0x01) {
      witness = true;
      at += 2;
    }
    const nin = rdVarint();
    const inputs = [];
    for (let i = 0; i < nin; i++) {
      const prev = rd(36);
      const txid = bytesToHex(prev.slice(0, 32).reverse());
      const vout = prev[32] | (prev[33] << 8) | (prev[34] << 16) | (prev[35] << 24);
      const scriptLen = rdVarint();
      const scriptSig = rd(scriptLen);
      const sequence = rdUint32();
      inputs.push({ txid, vout: vout >>> 0, scriptSig, sequence, witness: null });
    }
    const nout = rdVarint();
    const outputs = [];
    for (let i = 0; i < nout; i++) {
      const vb = rd(8);
      let value = 0n;
      for (let j = 7; j >= 0; j--) value = (value << 8n) | BigInt(vb[j]);
      const scriptLen = rdVarint();
      outputs.push({ value: Number(value), script: rd(scriptLen) });
    }
    if (witness) {
      for (const inp of inputs) {
        const items = rdVarint();
        const stack = [];
        for (let j = 0; j < items; j++) {
          const len = rdVarint();
          stack.push(rd(len));
        }
        inp.witness = stack;
      }
    }
    const locktime = rdUint32();
    if (at !== bytes.length) return null;
    return { version, locktime, inputs, outputs };
  } catch {
    return null;
  }
}

/** txid (explorer order) = dSHA256 of the non-witness serialization, reversed. */
export function txidOf(tx) {
  return bytesToHex(dsha256(serializeTx(tx, { witness: false })).reverse());
}

/* ------------------------------ BIP-143 ---------------------------------- */

/** The 25-byte P2WPKH scriptCode: 76 a9 14 <20-byte pubkey hash> 88 ac.
 *  (The varint length 0x19 is part of the preimage, added by the caller —
 *  BIP-143 writes it as scriptLen || scriptCode.) */
export function p2wpkhScriptCode(pubkeyHash20) {
  if (!pubkeyHash20 || pubkeyHash20.length !== 20) throw new Error('BAD_PUBKEY_HASH');
  return u8(Uint8Array.of(0x76, 0xa9, 0x14), pubkeyHash20, Uint8Array.of(0x88, 0xac));
}

/**
 * The BIP-143 digest for input `index` of a P2WPKH spend, SIGHASH_ALL.
 *
 * Every hash in the preimage is double-SHA256 over the exact byte ranges the
 * BIP lists (all outpoints; all sequences; all outputs as amount+script). The
 * BIP's own native-P2WPKH example pins the output of this function — see
 * test/btc-wallet-probe.mjs, which asserts the printed sigHash.
 */
export function p2wpkhSighash(tx, index, scriptCode, amountSats, hashType = SIGHASH_ALL) {
  if (hashType !== SIGHASH_ALL) {
    /* SIGHASH_NONE/SINGLE/ANYONECANPAY change what the preimage commits to;
       nothing on this screen needs them, so they are refused rather than
       half-implemented. */
    throw new Error('ONLY_SIGHASH_ALL');
  }
  const input = tx.inputs[index];
  if (!input) throw new Error('BAD_INPUT_INDEX');

  const prevouts = u8(...tx.inputs.map((i) => {
    const b = hexToBytes(i.txid);
    const vout = new Uint8Array(4);
    new DataView(vout.buffer).setUint32(0, i.vout >>> 0, true);
    return u8(b.slice().reverse(), vout);
  }));
  const hashPrevouts = dsha256(prevouts);

  const sequences = u8(...tx.inputs.map((i) => {
    const seq = new Uint8Array(4);
    new DataView(seq.buffer).setUint32(0, i.sequence >>> 0, true);
    return seq;
  }));
  const hashSequence = dsha256(sequences);

  const outputsSer = u8(...tx.outputs.map((o) => {
    const value = new Uint8Array(8);
    let v = BigInt(Math.trunc(o.value));
    for (let i = 0; i < 8; i++) {
      value[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return u8(value, varint(o.script.length), o.script);
  }));
  const hashOutputs = dsha256(outputsSer);

  const outpoint = (() => {
    const b = hexToBytes(input.txid);
    const vout = new Uint8Array(4);
    new DataView(vout.buffer).setUint32(0, input.vout >>> 0, true);
    return u8(b.slice().reverse(), vout);
  })();

  const version = new Uint8Array(4);
  new DataView(version.buffer).setUint32(0, tx.version >>> 0, true);
  const locktime = new Uint8Array(4);
  new DataView(locktime.buffer).setUint32(0, tx.locktime >>> 0, true);
  const amount = new Uint8Array(8);
  let amt = BigInt(amountSats);
  if (amt < 0n) throw new Error('BAD_AMOUNT');
  for (let i = 0; i < 8; i++) {
    amount[i] = Number(amt & 0xffn);
    amt >>= 8n;
  }

  const preimage = u8(
    version,
    hashPrevouts,
    hashSequence,
    outpoint,
    varint(scriptCode.length),
    scriptCode,
    amount,
    (() => {
      const seq = new Uint8Array(4);
      new DataView(seq.buffer).setUint32(0, input.sequence >>> 0, true);
      return seq;
    })(),
    hashOutputs,
    locktime,
    (() => {
      const h = new Uint8Array(4);
      new DataView(h.buffer).setUint32(0, hashType >>> 0, true);
      return h;
    })()
  );

  return dsha256(preimage);
}

/* ------------------------------- signatures ------------------------------- */

/**
 * DER-encode an (r, s) pair and append the sighash byte — the exact wire
 * format a P2WPKH witness stack expects.
 */
export function derSignature(r, s, hashType = SIGHASH_ALL) {
  const encodeInt = (v) => {
    let hex = BigInt(v).toString(16).padStart(2, '0');
    if (hex.length % 2 !== 0) hex = `0${hex}`;
    /* a leading zero when the high bit is set, so the integer reads positive */
    if (parseInt(hex.slice(0, 2), 16) & 0x80) hex = `00${hex}`;
    return hexToBytes(hex);
  };
  const rb = encodeInt(r);
  const sb = encodeInt(s);
  const body = u8(Uint8Array.of(0x02, rb.length), rb, Uint8Array.of(0x02, sb.length), sb);
  return u8(Uint8Array.of(0x30, body.length), body, Uint8Array.of(hashType));
}

/**
 * Sign one input with ethers' SigningKey over the BIP-143 digest, coercing to
 * LOW-S (BIP-62): the network refuses high-s signatures as non-standard, and
 * ethers normalises for Ethereum's EIP-2 rather than for Bitcoin, so the
 * coercion is ours to guarantee.
 */
export async function signP2wpkhInput(tx, index, amountSats, privateKey, pubkeyHash, hashType = SIGHASH_ALL) {
  const { SigningKey } = await import('ethers');
  const scriptCode = p2wpkhScriptCode(pubkeyHash);
  const digest = p2wpkhSighash(tx, index, scriptCode, amountSats, hashType);

  const signingKey = new SigningKey(privateKey);
  const sig = signingKey.sign(digest);
  let s = BigInt(sig.s);
  if (s > SECP256K1_N / 2n) s = SECP256K1_N - s;
  return derSignature(BigInt(sig.r), s, hashType);
}

/* ------------------------------ tx building ------------------------------- */

/** OP_RETURN <push(data)> with the 80-byte standardness cap enforced. */
export function opReturnScript(memoBytes) {
  if (!memoBytes || memoBytes.length === 0) throw new Error('EMPTY_MEMO');
  if (memoBytes.length > OP_RETURN_MAX_BYTES) throw new Error('MEMO_TOO_LONG');
  if (memoBytes.length <= 75) return u8(Uint8Array.of(0x6a, memoBytes.length), memoBytes);
  /* 76..80 bytes need OP_PUSHDATA1 */
  return u8(Uint8Array.of(0x6a, 0x4c, memoBytes.length), memoBytes);
}

/** Worst-case (72-byte) DER dummy signature, so vsize is never understated:
 *  both integers have their high bit set and serialize with a pad byte. */
const DUMMY_SIG = (() => {
  const r = BigInt(`0x${'ff'.repeat(32)}`) & (SECP256K1_N - 1n);
  const s = BigInt(`0x${'ee'.repeat(32)}`) & (SECP256K1_N - 1n);
  return derSignature(r, s, SIGHASH_ALL);
})();

/**
 * Exact weight-based vsize (BIP-141): serialize with dummy 73-byte witnesses
 * and compute ceil((baseSize*3 + totalSize) / 4). No per-shape guesswork.
 */
export function estimateVsize(unsignedTx) {
  const withDummy = {
    ...unsignedTx,
    inputs: unsignedTx.inputs.map((i) => ({ ...i, witness: [DUMMY_SIG, new Uint8Array(33).fill(0x02)] }))
  };
  const baseSize = serializeTx(unsignedTx, { witness: false }).length;
  const totalSize = serializeTx(withDummy, { witness: true }).length;
  return Math.ceil((baseSize * 3 + totalSize) / 4);
}

/**
 * Build and sign a P2WPKH transaction spending ALL the given UTXOs.
 *
 * @param {object} p
 *   utxos:        [{ txid, vout, value }] — all owned by `pubkeyHash`
 *   payees:       [{ address, valueSats }] — address must pass btcAddressInfo
 *   memo:         optional ascii/utf8 string carried in OP_RETURN (≤80 bytes)
 *   changeAddress: internal address for the sweep-back (dust goes to the fee)
 *   feeRateSatVb: number (sat/vB) from the fee-estimates endpoint
 *   privateKey:   the in-memory key for THIS address (never stored, never returned)
 *   pubkeyHash:   20-byte HASH160 of the compressed public key
 *
 * @returns { txHex, txid, vsize, feeSats, changeSats, inputs, outputs }
 *   The private key is never part of the result.
 */
export async function buildP2wpkhTx({
  utxos,
  payees,
  memo = null,
  changeAddress,
  feeRateSatVb,
  privateKey,
  pubkeyHash
}) {
  if (!Array.isArray(utxos) || utxos.length === 0) throw new Error('NO_UTXOS');
  if (!Array.isArray(payees) || payees.length === 0) throw new Error('NO_PAYEE');
  const rate = Number(feeRateSatVb);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('BAD_FEE_RATE');
  if (pubkeyHash != null && pubkeyHash.length !== 20) throw new Error('BAD_PUBKEY_HASH');

  const { btcAddressScript, isValidBtcAddress } = await import('./btcAddress.js');

  const inputTotal = utxos.reduce((n, u) => n + Math.trunc(Number(u.value) || 0), 0);
  if (inputTotal <= 0) throw new Error('NO_UTXOS');

  const fixedOutputs = [];
  for (const p of payees) {
    const value = Math.trunc(Number(p.valueSats));
    if (!Number.isFinite(value) || value < DUST_SATS) throw new Error('DUST_PAYEE');
    const script = btcAddressScript(p.address);
    if (!script || !isValidBtcAddress(p.address)) throw new Error('BAD_PAYEE_ADDRESS');
    fixedOutputs.push({ value, script, address: p.address });
  }
  if (memo != null) {
    const memoBytes = typeof memo === 'string' ? new TextEncoder().encode(memo) : memo;
    fixedOutputs.push({ value: 0, script: opReturnScript(memoBytes) });
  }

  const changeScript = (() => {
    const script = btcAddressScript(changeAddress);
    if (!script) throw new Error('BAD_CHANGE_ADDRESS');
    return script;
  })();

  const base = {
    version: 2,
    locktime: 0,
    inputs: utxos.map((u) => ({
      txid: String(u.txid),
      vout: Number(u.vout) >>> 0,
      scriptSig: new Uint8Array(0),
      sequence: 0xfffffffe, /* not final, RBF-able — the honest default */
      witness: null
    })),
    outputs: null
  };

  /* Fee first, then change: fee = vsize × rate rounded UP (underpaying means
     the tx never confirms — the one direction that strands a user). */
  const probeOutputs = [
    ...fixedOutputs.map((o) => ({ value: o.value, script: o.script })),
    { value: DUST_SATS, script: changeScript } /* worst-case change present */
  ];
  const vsize = estimateVsize({ ...base, outputs: probeOutputs });
  const feeSats = Math.max(1, Math.ceil(vsize * rate));

  const payTotal = fixedOutputs.reduce((n, o) => n + o.value, 0);
  let change = inputTotal - payTotal - feeSats;
  if (change < 0) throw new Error('INSUFFICIENT_FUNDS');

  const outputs = fixedOutputs.map((o) => ({ value: o.value, script: o.script }));
  if (change >= DUST_SATS) {
    outputs.push({ value: change, script: changeScript });
  } else {
    /* Below dust: keep it out of the output set entirely. The difference
       stays in the fee, which is what the network would do anyway. */
    change = 0;
  }

  const tx = { ...base, outputs };

  /* Sign every input with the SAME key (all UTXOs are the one address). */
  const { SigningKey, getBytes, ripemd160 } = await import('ethers');
  const compressed = SigningKey.computePublicKey(privateKey, true);
  /* HASH160 of the compressed key is what the UTXO's witness program pays
     to. Cross-check any caller-supplied hash and fail closed — a mismatch
     would build a perfectly valid transaction that spends to a witness
     nobody can satisfy later. */
  const derivedHash160 = getBytes(ripemd160(sha256(getBytes(compressed))));
  const effectiveHash = pubkeyHash ?? derivedHash160;
  if (pubkeyHash && bytesToHex(derivedHash160) !== bytesToHex(pubkeyHash)) {
    throw new Error('KEY_MISMATCH');
  }

  const witnesses = [];
  for (let i = 0; i < tx.inputs.length; i++) {
    const sig = await signP2wpkhInput(tx, i, utxos[i].value, privateKey, effectiveHash, SIGHASH_ALL);
    witnesses.push([sig, getBytes(compressed)]);
  }
  const signed = { ...tx, inputs: tx.inputs.map((inp, i) => ({ ...inp, witness: witnesses[i] })) };

  return {
    txHex: bytesToHex(serializeTx(signed, { witness: true })),
    txid: txidOf(signed),
    vsize,
    feeSats,
    changeSats: change,
    inputs: signed.inputs.length,
    outputs: signed.outputs.length
  };
}
