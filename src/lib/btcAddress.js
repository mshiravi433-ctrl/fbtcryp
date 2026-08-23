/**
 * BITCOIN ADDRESS VALIDATION — real checksums, not a regex.
 * ---------------------------------------------------------------------------
 * The P2P market asks the user to paste the address their purchased BTC will
 * be released to. A regex would happily accept an address with one swapped
 * character — which passes every visual check and burns the coins forever.
 * One wrong letter IS the failure mode this screen exists to prevent.
 *
 * So every candidate passes its actual cryptographic checksum:
 *
 *   - bech32   (bc1q…)   BIP-173 polymod, witness v0, 20 or 32 byte program
 *   - bech32m  (bc1p…)   BIP-350 polymod constant, witness v1+ (taproot)
 *   - Base58Check (1…/3…) 25-byte payload + double-SHA-256 checksum,
 *                         versions 0x00 (P2PKH) and 0x05 (P2SH)
 *
 * Mainnet ONLY, deliberately. Accepting a testnet address (tb1…, m…, n…, 2…)
 * on a real-money screen is not a convenience, it is a cross-network burn
 * dressed as flexibility. A testnet address fails here the same way a
 * corrupted one does.
 *
 * Pure module: no DOM, no import.meta, no dependencies — the test probe and
 * the browser bundle run the same bytes.
 *
 * sha256 implemented inline (FIPS 180-4) because Base58Check verification is
 * synchronous and window.crypto.subtle is not.
 */

/* ------------------------------------------------------------------------- */
/* SHA-256 (compact, standard)                                                */
/* ------------------------------------------------------------------------- */

const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

function sha256(bytes) {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);

  const bitLen = bytes.length * 8;
  /* one shot: message + 0x80 + padding + 64-bit length, multiple of 64 */
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  /* write length big-endian into the last 8 bytes (bitLen < 2^53 here) */
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(total - 4, bitLen >>> 0);

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

/* ------------------------------------------------------------------------- */
/* bech32 / bech32m (BIP-173, BIP-350)                                        */
/* ------------------------------------------------------------------------- */

/*
 * Exported because the transaction builder (lib/btcTx.js) needs double-SHA256
 * for BIP-143 sighashes and txids and must stay synchronous/pure; this is
 * the same FIPS 180-4 implementation the Base58Check path already pins.
 */
export { sha256, sha256 as sha256Bytes };

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_LOOKUP = new Map([...BECH32_CHARSET].map((c, i) => [c, i]));

function bech32Polymod(values) {
  /* BIP-173 reference polynomial. The first constant is 0x3b6a57b2 — a
     version of this array with …57f2 floats around the internet and silently
     accepts nothing valid; the spec's own vectors (bc1qw508d6…8f3t4) only
     verify with 57b2. Pinned by the probe vectors in test/p2p-market-probe. */
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

/** regroup 5-bit words to bytes (no padding) */
function convertBits(data, fromBits, toBits) {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const out = [];
  for (const v of data) {
    if (v < 0 || v >> fromBits !== 0) return null;
    acc = (acc << fromBits) | v;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  /* BIP-173: leftover bits must be zero and fewer than fromBits */
  if (bits >= fromBits) return null;
  if (((acc << (toBits - bits)) & maxv) !== 0) return null;
  return out;
}

/**
 * The other direction: bytes -> 5-bit words, ZERO-padded. That padding is
 * what BIP-173 specifies for encoding (a witness program is not a multiple
 * of 5 bits in general; the decoder rejects any padding that is not zero).
 */
function convertBitsPad(data, fromBits, toBits) {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const out = [];
  for (const v of data) {
    if (v < 0 || v >> fromBits !== 0) return null;
    acc = (acc << fromBits) | v;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (bits > 0) out.push((acc << (toBits - bits)) & maxv);
  return out;
}

/** BIP-173 constant for plain bech32, BIP-350 constant for bech32m. */
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function encodeData(hrp, words, checksumConst) {
  if (!hrp || !Array.isArray(words) || words.length === 0) return null;
  const lower = hrp.toLowerCase();
  const values = [...hrpExpand(lower), ...words];
  const polymod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ checksumConst;
  const checksum = [];
  for (let i = 0; i < 6; i++) checksum.push((polymod >> (5 * (5 - i))) & 31);
  const body = [...words, ...checksum].map((v) => BECH32_CHARSET[v]).join('');
  return `${lower}1${body}`;
}

/**
 * Encode a bech32 string (BIP-173) from hrp + 5-bit words.
 * Returns lowercase; callers that need uppercase must upper() the WHOLE
 * string (mixed case is invalid by construction here).
 */
export function encodeBech32(hrp, words) {
  return encodeData(hrp, words, BECH32_CONST);
}

/** Encode a bech32m string (BIP-350) from hrp + 5-bit words. */
export function encodeBech32m(hrp, words) {
  return encodeData(hrp, words, BECH32M_CONST);
}

/**
 * Build a SegWit address string from a witness program.
 *
 * The exact inverse of decodeSegwit: version 0 uses plain bech32, v1+ uses
 * bech32m (BIP-350). Passing a 20-byte program with version 0 is how the
 * P2WPKH addresses of src/lib/btcWallet.js are produced; the BIP-173/350
 * vectors in test/p2p-market-probe.mjs pin every other shape this accepts.
 *
 * @returns {string|null} null when the program/version is impossible.
 */
export function encodeSegwitAddress(hrp, version, program) {
  if (!Array.isArray(program) && !(program instanceof Uint8Array)) return null;
  const ver = Number(version);
  if (!Number.isInteger(ver) || ver < 0 || ver > 16) return null;
  if (program.length < 2 || program.length > 40) return null;
  if (ver === 0 && program.length !== 20 && program.length !== 32) return null;
  const words = convertBitsPad(program, 8, 5);
  if (!words) return null;
  const data = [ver, ...words];
  return ver === 0 ? encodeBech32(hrp, data) : encodeBech32m(hrp, data);
}

/**
 * Decode a SegWit address into its witness program (exposed for the encoder's
 * own round-trip test and for tx building, which needs the raw program).
 * Same rules as the validator below — this is the decode half of the pair.
 */
export function btcAddressProgram(raw) {
  const decoded = decodeSegwit(String(raw ?? '').trim());
  return decoded ? { ...decoded, program: Uint8Array.from(decoded.program) } : null;
}

/**
 * Decode a SegWit address. Returns { version, program } or null.
 * Enforces: bech32 for v0, bech32m for v1+ (BIP-350 — the malleability
 * fix), program 2-40 bytes, exactly 20/32 for v0.
 */
function decodeSegwit(addr) {
  if (addr.length < 14 || addr.length > 74) return null;
  if (/[A-Z]/.test(addr) && /[a-z]/.test(addr)) return null; /* mixed case is always invalid */
  const a = addr.toLowerCase();

  const sep = a.lastIndexOf('1');
  if (sep < 1 || sep + 7 > a.length) return null;
  const hrp = a.slice(0, sep);
  if (hrp !== 'bc') return null; /* mainnet only — see the header */

  const data = [];
  for (const c of a.slice(sep + 1)) {
    const v = BECH32_LOOKUP.get(c);
    if (v === undefined) return null;
    data.push(v);
  }
  if (data.length < 6) return null;

  const chk = bech32Polymod([...hrpExpand(hrp), ...data]);
  const isBech32 = chk === 1;
  const isBech32m = chk === 0x2bc830a3;
  if (!isBech32 && !isBech32m) return null;

  const payload = data.slice(0, data.length - 6);
  if (payload.length < 1) return null;
  const version = payload[0];
  if (version > 16) return null;
  const program = convertBits(payload.slice(1), 5, 8);
  if (!program || program.length < 2 || program.length > 40) return null;
  if (version === 0) {
    if (program.length !== 20 && program.length !== 32) return null;
    if (!isBech32) return null; /* v0 must NOT use bech32m */
  } else if (!isBech32m) {
    return null; /* v1+ must use bech32m */
  }
  return { version, program };
}

/* ------------------------------------------------------------------------- */
/* Base58Check (P2PKH 1…, P2SH 3…)                                            */
/* ------------------------------------------------------------------------- */

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_LOOKUP = new Map([...B58_ALPHABET].map((c, i) => [c, i]));

function base58Decode(s) {
  const bytes = [0];
  for (const ch of s) {
    const val = B58_LOOKUP.get(ch);
    if (val === undefined) return null;
    let carry = val;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  /* one leading zero byte per leading '1' */
  for (const ch of s) {
    if (ch === '1') bytes.push(0);
    else break;
  }
  return new Uint8Array(bytes.reverse());
}

/** Returns 'p2pkh' | 'p2sh' when decoding + checksum + version all pass. */
function decodeBase58Check(addr) {
  const decoded = decodeBase58WithPayload(addr);
  return decoded ? decoded.type : null;
}

/** Same verification, keeping the 21-byte payload for script building. */
function decodeBase58WithPayload(addr) {
  if (addr.length < 26 || addr.length > 35) return null;
  const raw = base58Decode(addr);
  if (!raw || raw.length !== 25) return null;
  const payload = raw.slice(0, 21);
  const checksum = raw.slice(21);
  const digest = sha256(sha256(payload));
  for (let i = 0; i < 4; i++) {
    if (digest[i] !== checksum[i]) return null;
  }
  if (payload[0] === 0x00) return { type: 'p2pkh', payload };
  if (payload[0] === 0x05) return { type: 'p2sh', payload };
  return null; /* other versions (testnet etc) are not mainnet money */
}

/* ------------------------------------------------------------------------- */
/* public API                                                                */
/* ------------------------------------------------------------------------- */

/**
 * Classify a candidate Bitcoin address.
 *
 * @returns {{ valid: boolean, type: string|null, reason: string }}
 *   type: 'p2pkh' | 'p2sh' | 'segwit_v0' | 'segwit_vN' | null
 *   reason: 'empty' | 'too_long' | 'bad_checksum_or_format' (informational;
 *   the UI deliberately shows ONE message for every bad address — telling a
 *   scammer which character class failed is free help).
 */
export function btcAddressInfo(raw) {
  const addr = String(raw ?? '').trim();
  if (!addr) return { valid: false, type: null, reason: 'empty' };
  if (addr.length > 90) return { valid: false, type: null, reason: 'too_long' };

  const sw = decodeSegwit(addr);
  if (sw) return { valid: true, type: sw.version === 0 ? 'segwit_v0' : `segwit_v${sw.version}`, reason: 'ok' };

  const b58 = decodeBase58Check(addr);
  if (b58) return { valid: true, type: b58, reason: 'ok' };

  return { valid: false, type: null, reason: 'bad_checksum_or_format' };
}

export function isValidBtcAddress(raw) {
  return btcAddressInfo(raw).valid;
}

/**
 * The scriptPubKey an output PAYING this address must carry.
 *
 * The transaction builder (lib/btcTx.js) needs the exact bytes — a payment
 * script is derived from the same decode the validator already did, so the
 * address→script mapping cannot drift from the validation. Returns null for
 * anything the validator refuses (which is the point: a payment here is only
 * ever built for an address that passed the real checksum).
 *
 *   segwit v0/vN → OP_<n> <len> <program>          (0x0014… / 0x5121…)
 *   p2pkh        → OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
 *   p2sh         → OP_HASH160 <20> OP_EQUAL
 */
export function btcAddressScript(raw) {
  const addr = String(raw ?? '').trim();

  const sw = decodeSegwit(addr);
  if (sw) {
    const versionOp = sw.version === 0 ? 0x00 : 0x50 + sw.version;
    return Uint8Array.from([versionOp, sw.program.length, ...sw.program]);
  }

  const b58 = decodeBase58WithPayload(addr);
  if (b58?.type === 'p2pkh') {
    const h = b58.payload.slice(1); /* 20-byte HASH160 */
    return Uint8Array.from([0x76, 0xa9, 0x14, ...h, 0x88, 0xac]);
  }
  if (b58?.type === 'p2sh') {
    const h = b58.payload.slice(1);
    return Uint8Array.from([0xa9, 0x14, ...h, 0x87]);
  }
  return null;
}
