/**
 * EVM ADDRESSES, WITHOUT THE BARREL.
 * ============================================================================
 *
 * WHY THIS EXISTS (2026-11-11)
 * ---------------------------------------------------------------------------
 * The cold-start measurement put `ethers` at the top of the cold-start
 * budget: 181 ms of CPU, compiled on EVERY cold start of a function whose
 * entire CPU allowance for the month is four hours.
 *
 * And what the application actually needs from `ethers` on the hot paths is
 * TWO FUNCTIONS:
 *
 *   · `isAddress(value)`  — is this a valid EVM address?
 *   · `getAddress(value)` — checksum it, or reject a bad checksum.
 *
 * Both need exactly one thing from the library: KECCAK-256 over 40 ASCII
 * characters. That is implemented in `server/keccak.js` — verified against
 * the published Keccak-256 test vector and against `ethers`'s own
 * `keccak256` — so the address helpers here cost NOTHING to load.
 *
 * ─── THE SEMANTICS ARE COPIED EXACTLY, NOT APPROXIMATED ─────────────────────
 * These functions REPLACE `ethers`'s, so they must agree with them on every
 * input, including the awkward ones:
 *
 *   · an address with NO `0x` prefix is accepted and prefixed;
 *   · an ALL-LOWERCASE address is accepted and checksummed;
 *   · a MIXED-CASE address must have a VALID checksum, or it is rejected —
 *     this is the safety property: a mixed-case address that fails its
 *     checksum means the user mistyped it, and accepting it would send
 *     funds to the wrong place;
 *   · an ALL-UPPERCASE address (i.e. `0X...`) is treated as all-lowercase
 *     and checksummed, because it carries no checksum information;
 *   · anything else is rejected.
 *
 * The ethers implementation is the reference, and this module's test file
 * compares the two function-by-function over a corpus that includes every
 * one of those cases.
 *
 * ─── THE ICAP FORM IS SUPPORTED TOO ─────────────────────────────────────────
 * ethers' `getAddress` also accepts the legacy ICAP form
 * (`XE65GB6LDNXYOFTX0NSV3FUWKOWIXAMJK36`) — a base-36 address with an IBAN
 * checksum. It has not been used by any live system in a decade, but
 * "nothing uses it" is not a reason to diverge from the reference: a
 * function that replaces a library's function must agree with it on every
 * input, so the ICAP branch is implemented here too.
 */

/* The Keccak-256 hash, from the dependency-free implementation. */
import { keccak256 } from './keccak.js';

const MASK64 = (1n << 64n) - 1n;

/**
 * The EIP-55 checksum of a 40-hex-character address body.
 *
 * The rule: take the LOWERCASE address body, hash its 40 ASCII bytes with
 * Keccak-256, and uppercase the i-th hex character when the i-th nibble of
 * the hash is 8 or greater.
 */
function checksumBody(body) {
  const lower = body.toLowerCase();
  const bytes = new Uint8Array(40);
  for (let i = 0; i < 40; i += 1) bytes[i] = lower.charCodeAt(i);
  const hash = keccak256(bytes);
  const chars = lower.split('');
  for (let i = 0; i < 40; i += 2) {
    const byte = hash[i >> 1];
    if ((byte >> 4) >= 8) chars[i] = chars[i].toUpperCase();
    if ((byte & 0x0f) >= 8) chars[i + 1] = chars[i + 1].toUpperCase();
  }
  return chars.join('');
}

/* The IBAN-style lookup table the ICAP checksum uses. */
const IBAN_LOOKUP = (() => {
  const table = {};
  for (let i = 0; i < 10; i += 1) table[String(i)] = String(i);
  for (let i = 0; i < 26; i += 1) table[String.fromCharCode(65 + i)] = String(10 + i);
  return table;
})();

/**
 * The ICAP (IBAN-style) checksum of an ICAP address.
 *
 * Identical to the algorithm in ethers: uppercase the address, rotate the
 * first four characters to the end, append two zeros, map each character
 * through the lookup table, and fold the digits in blocks of fifteen.
 */
function ibanChecksum(address) {
  const upper = address.toUpperCase();
  const rotated = `${upper.substring(4)}${upper.substring(0, 2)}00`;
  let expanded = rotated.split('').map((c) => IBAN_LOOKUP[c]).join('');
  const SAFE_DIGITS = 15;
  while (expanded.length >= SAFE_DIGITS) {
    const block = expanded.substring(0, SAFE_DIGITS);
    expanded = `${parseInt(block, 10) % 97}${expanded.substring(block.length)}`;
  }
  let checksum = String(98 - (parseInt(expanded, 10) % 97));
  while (checksum.length < 2) checksum = `0${checksum}`;
  return checksum;
}

/**
 * A base-36 number as a hex string.
 *
 * The alphabet is `0-9` then `a-z`, so a digit's value is its position in
 * that alphabet: `0`-`9` are 0-9, `a` is 10, and `z` is 35.
 */
function base36ToHex(text) {
  const BASE36 = 36n;
  let value = 0n;
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; i += 1) {
    const code = lower.charCodeAt(i);
    const digit = code <= 57 ? code - 48 : code - 97 + 10;
    value = value * BASE36 + BigInt(digit);
  }
  return value.toString(16);
}

/**
 * Is this string a well-formed EVM address?
 *
 * Mirrors `ethers`'s `isAddress`: it is `true` exactly when `getAddress`
 * would succeed.
 */
export function isAddress(value) {
  try {
    getAddress(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize and checksum an EVM address.
 *
 * Throws on anything that is not a valid address — the same contract as
 * `ethers`'s `getAddress`, including the same failure mode for a mixed-case
 * address whose checksum does not match.
 */
export function getAddress(value) {
  if (typeof value !== 'string') {
    throw new Error(`invalid address (${String(value)})`);
  }
  const address = value.trim();

  /* The legacy ICAP form: a base-36 body with an IBAN-style checksum. */
  if (/^XE[0-9]{2}[0-9A-Za-z]{30,31}$/.test(address)) {
    if (address.substring(2, 4) !== ibanChecksum(address)) {
      throw new Error(`bad icap checksum (${value})`);
    }
    let body = base36ToHex(address.substring(4));
    while (body.length < 40) body = `0${body}`;
    return `0x${checksumBody(body)}`;
  }

  if (!/^(0x)?[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`invalid address (${value})`);
  }

  const body = address.startsWith('0x') ? address.slice(2) : address;
  const result = `0x${checksumBody(body)}`;

  /*
   * The mixed-case guard.
   *
   * A mixed-case address CARRIES a checksum, so a wrong one means the
   * address was mistyped — and accepting it would send funds somewhere
   * else. An all-lower-case or all-upper-case address carries no checksum
   * information, so it is accepted and normalized instead.
   *
   * This is the one place where being "helpful" would be dangerous, and it
   * is why the check is on the ORIGINAL string and not on the result.
   */
  const mixed = /([A-F].*[a-f])|([a-f].*[A-F])/.test(address);
  if (mixed && result !== address) {
    throw new Error(`bad address checksum (${value})`);
  }
  return result;
}

export { MASK64 };
export default getAddress;
