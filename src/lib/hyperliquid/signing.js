/**
 * HYPERLIQUID — L1 ACTION SIGNING (pure, runs in the browser, no network)
 * ---------------------------------------------------------------------------
 * Byte-for-byte the same steps as the official SDK (hyperliquid-python-sdk,
 * utils/signing.py), so the same action always produces the same signature:
 *   1. msgpack(action)  — map keys in insertion order, minimal integer widths
 *   2. + nonce as 8 bytes big-endian
 *   3. + 0x00 (no vault address)           → keccak256 = connectionId
 *   4. EIP-712 typed data { Agent: { source: 'a' (mainnet), connectionId } }
 *
 * The key is passed in by the caller and is never stored, logged or exported.
 * tests/fixtures/hyperliquid/signing-vectors.json holds SDK output for a
 * public test key; the unit test checks these bytes match exactly.
 */

import { Wallet, keccak256, Signature } from 'ethers';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Minimal msgpack encoder for the value shapes an order action uses. */
export function msgpackEncode(value) {
  const parts = [];
  const push = (...bytes) => parts.push(...bytes);
  const u = (n, bytes) => { for (let i = bytes - 1; i >= 0; i -= 1) push(Math.floor(n / 2 ** (8 * i)) & 0xff); };

  const enc = (v) => {
    if (v === null || v === undefined) { push(0xc0); return; }
    if (typeof v === 'boolean') { push(v ? 0xc3 : 0xc2); return; }
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) throw new Error('msgpack: only integers are used in actions');
      if (v >= 0) {
        if (v <= 0x7f) push(v);
        else if (v <= 0xff) { push(0xcc); u(v, 1); }
        else if (v <= 0xffff) { push(0xcd); u(v, 2); }
        else if (v <= 0xffffffff) { push(0xce); u(v, 4); }
        else { push(0xcf); u(v, 8); }
      } else if (v >= -32) push(v & 0xff);
      else if (v >= -128) { push(0xd0); u(v & 0xff, 1); }
      else if (v >= -32768) { push(0xd1); u(v & 0xffff, 2); }
      else { push(0xd2); u(v >>> 0, 4); }
      return;
    }
    if (typeof v === 'string') {
      const bytes = new TextEncoder().encode(v);
      if (bytes.length <= 31) push(0xa0 | bytes.length);
      else if (bytes.length <= 0xff) { push(0xd9); u(bytes.length, 1); }
      else if (bytes.length <= 0xffff) { push(0xda); u(bytes.length, 2); }
      else { push(0xdb); u(bytes.length, 4); }
      for (const b of bytes) push(b);
      return;
    }
    if (Array.isArray(v)) {
      if (v.length <= 15) push(0x90 | v.length);
      else if (v.length <= 0xffff) { push(0xdc); u(v.length, 2); }
      else { push(0xdd); u(v.length, 4); }
      v.forEach(enc);
      return;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined);
      if (keys.length <= 15) push(0x80 | keys.length);
      else if (keys.length <= 0xffff) { push(0xde); u(keys.length, 2); }
      else { push(0xdf); u(keys.length, 4); }
      for (const k of keys) { enc(k); enc(v[k]); }
      return;
    }
    throw new Error(`msgpack: unsupported type ${typeof v}`);
  };
  enc(value);
  return Uint8Array.from(parts);
}

/** connectionId for an action: keccak256(msgpack(action) ‖ nonce ‖ 0x00). */
export function actionHash(action, nonce) {
  const packed = msgpackEncode(action);
  const nonceBytes = new Uint8Array(8);
  let n = BigInt(nonce);
  for (let i = 7; i >= 0; i -= 1) { nonceBytes[i] = Number(n & 0xffn); n >>= 8n; }
  const data = new Uint8Array(packed.length + 9);
  data.set(packed, 0);
  data.set(nonceBytes, packed.length);
  data[packed.length + 8] = 0x00; // no vault
  return keccak256(data);
}

/**
 * Signs an L1 action with the agent key. Returns { r, s, v } exactly as the
 * /exchange endpoint expects it.
 */
export async function signL1Action(privateKey, action, nonce, { isMainnet = true } = {}) {
  const wallet = new Wallet(privateKey);
  const connectionId = actionHash(action, nonce);
  const sig = await wallet.signTypedData(
    { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: ZERO_ADDRESS },
    { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
    { source: isMainnet ? 'a' : 'b', connectionId }
  );
  const parsed = Signature.from(sig);
  return { r: parsed.r, s: parsed.s, v: parsed.v };
}

/** Address of an agent key, for display only (masked in the UI). */
export function agentAddress(privateKey) {
  return new Wallet(privateKey).address;
}

