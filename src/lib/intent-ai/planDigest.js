/**
 * FBT INTENT OS — CONTENT-BOUND PLAN DIGEST
 * ---------------------------------------------------------------------------
 * Pattern borrowed from Gordon's "content-bound approval" (general-liquidity/
 * gordon, MIT): an approval is not a boolean, it is a signature over the exact
 * legs the user reviewed. Change one leg — amount, token, chain, leverage,
 * slippage, recipient — and the approval no longer matches, so the plan that
 * reaches the wallet can never differ from the plan the user approved.
 *
 * This module is SHARED by the browser (verify right before the wallet is
 * asked to sign) and the server (issue + verify), so it must stay:
 *   · pure and synchronous (no crypto.subtle, no node:crypto)
 *   · dependency-free
 *   · deterministic: the same legs always produce the same digest, in any
 *     key order, regardless of cosmetic fields (labels, ids, UI hints)
 *
 * The digest is SHA-256 over a canonical JSON of the MATERIAL fields only.
 * Material = anything that changes what money moves where. Cosmetic fields
 * are dropped on purpose: a re-rendered card must not invalidate consent,
 * but a changed amount must.
 */

export const PLAN_DIGEST_SCHEMA = 'fbt.plan-digest.v1';

/** Fields that decide what the transaction does. Order is irrelevant. */
export const MATERIAL_FIELDS = Object.freeze([
  'type', 'from', 'to', 'asset', 'amount', 'amountUsd', 'chainId',
  'toChainId', 'side', 'leverage', 'slippage', 'slippageBps', 'slippagePct',
  'recipient', 'contractAddress', 'venue', 'protocol', 'market'
]);

/** Parameters that are material when they sit inside `parameters`. */
export const MATERIAL_PARAMETERS = Object.freeze([
  'leverage', 'slippage', 'slippageBps', 'slippagePct', 'recipient',
  'targetAllocation', 'limitPrice', 'triggerPrice', 'side', 'toChainId',
  'protocol', 'market', 'interval', 'frequency'
]);

/* ------------------------------ normalisation ----------------------------- */

function normScalar(key, value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (key === 'chainId' || key === 'toChainId') {
    const n = Number(value);
    return Number.isFinite(n) ? n : String(value).toLowerCase();
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(value.trim()))) {
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    /* 1e-9 resolution: "100" and 100.0000000001 are the same approval;
       100 and 100.01 are not. Stored as a string so JSON can't reformat it. */
    return String(Math.round(n * 1e9) / 1e9);
  }
  const s = String(value).trim();
  /* Symbols and addresses compare case-insensitively (0xAbC == 0xabc,
     usdc == USDC). Solana base58 is case-sensitive, so keep those as-is. */
  if (/^0x[0-9a-fA-F]+$/.test(s)) return s.toLowerCase();
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return s;
  return s.toUpperCase();
}

function normValue(key, value) {
  if (Array.isArray(value)) {
    const arr = value.map((v) => normValue(key, v)).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      const v = normValue(k, value[k]);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return normScalar(key, value);
}

/** Reduce one action to its material, canonical shape. */
export function materialAction(action = {}) {
  if (!action || typeof action !== 'object') return {};
  const out = {};
  for (const field of MATERIAL_FIELDS) {
    const v = normValue(field, action[field]);
    if (v !== undefined) out[field] = v;
  }
  const params = action.parameters && typeof action.parameters === 'object' ? action.parameters : null;
  if (params) {
    const p = {};
    for (const field of MATERIAL_PARAMETERS) {
      const v = normValue(field, params[field]);
      if (v !== undefined) p[field] = v;
    }
    if (Object.keys(p).length) out.parameters = p;
  }
  return out;
}

/** Stable JSON: keys sorted at every depth. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/* --------------------------------- SHA-256 -------------------------------- */
/* Compact, synchronous, dependency-free SHA-256 (FIPS 180-4). Verified in
   test/intent-ai/ai-strengthening-probe.mjs against node:crypto. */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function utf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function sha256Hex(input) {
  const msg = typeof input === 'string' ? utf8Bytes(input) : Uint8Array.from(input || []);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array((((msg.length + 9) >> 6) + 1) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i += 1) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

/* --------------------------------- digest --------------------------------- */

/**
 * The digest of a plan = sha256(canonical material legs). Leg ORDER is
 * material (a rebalance that sells before it buys is a different plan).
 */
export function planDigest(actions = []) {
  const legs = (Array.isArray(actions) ? actions : [actions]).filter(Boolean).map(materialAction);
  return sha256Hex(canonicalJson({ schema: PLAN_DIGEST_SCHEMA, legs }));
}

/**
 * Client-side check right before signing. `approval` is what the server
 * issued on /confirm or /execute. No approval → `{ ok: true, bound: false }`
 * (older servers / non-AI surfaces keep working); a mismatched or expired
 * approval → `{ ok: false }` and the caller MUST stop.
 */
export function verifyPlanBinding(approval, actions, { now = Date.now() } = {}) {
  if (!approval || typeof approval !== 'object' || !approval.digest) {
    return { ok: true, bound: false, code: 'NO_APPROVAL' };
  }
  if (approval.expiresAt && Number(approval.expiresAt) < now) {
    return { ok: false, bound: true, code: 'APPROVAL_EXPIRED' };
  }
  const digest = planDigest(actions);
  if (digest !== approval.digest) {
    return { ok: false, bound: true, code: 'APPROVAL_MISMATCH', expected: approval.digest, actual: digest };
  }
  return { ok: true, bound: true, code: 'APPROVAL_MATCH', digest };
}
