/**
 * KECCAK-256, IN TWENTY LINES.
 * ============================================================================
 *
 * WHY THIS EXISTS (2026-11-11)
 * ---------------------------------------------------------------------------
 * The deployment's Fluid Active CPU allowance is 4 hours per rolling 30
 * days — about eight minutes of CPU per day — and the cold-start
 * measurement put `ethers` at the top of it: 181 ms of CPU, compiled on
 * EVERY cold start, to do one thing, most of the time.
 *
 * The application uses `ethers` for twenty-odd symbols, but the two that
 * appear on the hottest paths — `getAddress` and `isAddress` — need only
 * KECCAK-256 over 40 ASCII characters. And Node's `crypto` has SHA3-256
 * but NOT Keccak-256: they are different functions with different padding
 * rules, and substituting one for the other would produce a wrong checksum
 * — which for an EVM address means a wrong recipient.
 *
 * So Keccak-256 is implemented here, from the Keccak specification, with no
 * dependency at all. The implementation is the standard one: the sponge
 * construction, ρ and π steps as lane rotations and permutations, and χ as
 * the non-linear step.
 *
 * ─── WHY THIS IS SAFE TO SHIP ───────────────────────────────────────────────
 * Because it is VERIFIABLE. The Keccak-256 of the empty string is a
 * published constant, and the implementation is checked against it, and
 * against `ethers`'s own `keccak256`, in the test file that ships with
 * this. A hand-written hash is exactly the kind of thing that must be
 * proven rather than trusted — so the proof is in the test suite, not in a
 * comment.
 *
 * ─── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * It is not a general-purpose crypto library. It hashes byte strings. That
 * is all the address checksum needs, and the smaller the surface, the
 * smaller the chance of a mistake.
 *
 * ─── THE ROUND CONSTANTS AND THE ROUND COUNT ────────────────────────────────
 * Keccak-f[1600] runs 24 rounds for Keccak-256 (capacity 512 bits), and the
 * round constants are the first 24 of the 24 available — the standard
 * ι step sequence.
 */

/*
 * The 24 round constants of Keccak-f[1600] — the ι step.
 *
 * THESE ARE NOT POWERS OF TWO. That is a natural but wrong guess (the
 * first one is 1, which makes the guess look plausible), and it produces a
 * permutation that is wrong in a way no exception reveals: it hashes
 * perfectly, just to the wrong values. The constants are the low 64 bits
 * of the first 24 entries of the standard ι sequence, and they are
 * reproduced here exactly — checked against the published table and
 * against `ethers`'s own `keccak256` in the test suite.
 */
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];

/*
 * The ρ step rotation offsets.
 *
 * The state is indexed as `x + 5y`, so the table is COLUMN-major: the
 * first five entries are the offsets for y = 0 (x = 0..4), the next five
 * for y = 1, and so on. Getting this transposed is the classic Keccak
 * mistake, and it produces a hash that is wrong in a way that is
 * invisible — no exception, just a different digest.
 */
const R = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14
];

/*
 * The π step lane permutation.
 *
 * π moves the lane at (x, y) to (y, (2x + 3y) mod 5). In the `x + 5y`
 * indexing that becomes a lookup table, written out here rather than
 * computed at run time — the table IS the specification, and a table can
 * be read and checked against the reference.
 */
const PI = [
  0, 10, 20, 5, 15,
  16, 1, 11, 21, 6,
  7, 17, 2, 12, 22,
  23, 8, 18, 3, 13,
  14, 24, 9, 19, 4
];

const MASK64 = (1n << 64n) - 1n;

/** Rotate a 64-bit lane left by `n` bits. */
function rotl(value, n) {
  const s = BigInt(n);
  if (s === 0n) return value;
  return ((value << s) | (value >> (64n - s))) & MASK64;
}

/**
 * The Keccak-f[1600] permutation, applied in place to a 25-lane state.
 */
function keccakF1600(A) {
  for (let round = 0; round < 24; round += 1) {
    /* ── θ ── */
    const C = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    }
    const D = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) A[x + 5 * y] ^= D[x];
    }

    /* ── ρ and π ── */
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        B[PI[x + 5 * y]] = rotl(A[x + 5 * y], R[x + 5 * y]);
      }
    }

    /* ── χ ── */
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        A[x + 5 * y] = B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK64) & B[((x + 2) % 5) + 5 * y]);
      }
    }

    /* ── ι ── */
    A[0] ^= RC[round];
  }
}

/**
 * Keccak-256, the padding variant Ethereum uses.
 *
 * The difference from SHA3-256 is the DOMAIN SEPARATION BYTE: Keccak uses
 * 0x01, SHA3 uses 0x06. Using the wrong one produces a completely
 * different hash, which is why this cannot be Node's `sha3-256`.
 *
 * @param {Uint8Array} bytes the message
 * @returns {Uint8Array} 32 bytes
 */
export function keccak256(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  /* The rate for Keccak-256: 1600 − 512 bits = 1088 bits = 136 bytes. */
  const RATE = 136;

  const A = new Array(25).fill(0n);

  /* Absorb every full block. */
  const padded = new Uint8Array(Math.ceil((input.length + 1) / RATE) * RATE);
  padded.set(input);
  padded[input.length] = 0x01;                 /* the Keccak domain byte */
  padded[padded.length - 1] |= 0x80;           /* the final pad bit */

  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i += 1) {
      /* The state is little-endian within each 64-bit lane. */
      A[i] ^= view.getBigUint64(off + i * 8, true);
    }
    keccakF1600(A);
  }

  /* Squeeze: 32 bytes = 4 lanes, which fits inside one block. */
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 4; i += 1) {
    outView.setBigUint64(i * 8, A[i] & MASK64, true);
  }
  return out;
}

/**
 * Keccak-256 of a string, as a 0x-prefixed hex string.
 *
 * The string is encoded as UTF-8 — the same encoding `ethers`'s
 * `toUtf8Bytes` uses — so the result is byte-identical to ethers's.
 */
export function keccak256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  return `0x${Buffer.from(keccak256(bytes)).toString('hex')}`;
}

export default keccak256;
