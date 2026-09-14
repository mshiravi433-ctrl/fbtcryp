/**
 * TRON (TRC20) ADDRESS — deterministic mapping to/from this app's EVM wallet.
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 * «در تب فقط برای ایرانیان موقع برداشت تتر از بیت‌پین، شبکهٔ TRC20 (ترون) هم
 *  هست — آدرس کیف پول برای آن شبکه کامل و درست باشد.»
 *
 * This app's wallet is EVM-only (secp256k1 keypair behind a 0x… address); it
 * has no Tron account object. Tron uses the SAME secp256k1 curve, and its
 * mainnet address is the same 20-byte address payload Ethereum uses, wrapped
 * differently:
 *
 *   TRON mainnet address = Base58Check( 0x41 || <the exact 20 EVM bytes> )
 *
 * so the connected wallet's key — and ONLY the connected wallet's key —
 * already controls a Tron address derivable with no signature and no key
 * material:
 *
 *   T… = base58check(version 0x41 + the bytes of the 0x… address)
 *
 * That is the standard mapping every Tron wallet implements (TronLink's
 * «import from private key», TronWeb's Address.fromHex, exchanges' deposit
 * screens). Sending a Tron T-address where an EVM address belongs (or an
 * 0x-address on TRC20) burns the funds, which is exactly the failure this
 * screen guards against — so every conversion below carries the real
 * Base58Check (double-SHA-256, 4-byte checksum), never a regex.
 *
 * Pure module: no DOM, no import.meta, no dependencies — same guarantees and
 * the same SHA-256 as lib/btcAddress.js.
 */

import { sha256 } from './btcAddress.js';

const TRON_VERSION = 0x41; /* mainnet address version, fixed */
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_LOOKUP = new Map([...B58_ALPHABET].map((c, i) => [c, BigInt(i)]));
const BASE = 58n;

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

/** Base58 (Bitcoin/Tron alphabet, big-integer math — no Buffer/atob). */
export function base58Encode(bytes) {
  const input = Uint8Array.from(bytes);
  let num = 0n;
  for (const byte of input) num = num * 256n + BigInt(byte);
  let out = '';
  while (num > 0n) {
    const rem = Number(num % BASE);
    num /= BASE;
    out = B58_ALPHABET[rem] + out;
  }
  /* Each leading zero byte becomes a leading '1' in Base58. Tron payloads
     start with 0x41, so this never triggers here — kept for completeness. */
  for (const byte of input) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}

/** Base58 → raw bytes, or null on any character outside the alphabet. */
export function base58Decode(text) {
  const str = String(text ?? '').trim();
  if (!str) return null;
  let num = 0n;
  for (const ch of str) {
    const val = B58_LOOKUP.get(ch);
    if (val === undefined) return null;
    num = num * BASE + val;
  }
  const bytes = [];
  while (num > 0n) {
    bytes.push(Number(num & 0xffn));
    num >>= 8n;
  }
  bytes.reverse();
  for (const ch of str) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function checksum(payload) {
  return sha256(sha256(payload)).slice(0, 4);
}

/**
 * Validate a Tron MAINNET address: 21-byte payload starting with version
 * 0x41 plus a correct 4-byte double-SHA-256 checksum. Testnet/other versions
 * are refused the same way the BTC helper refuses testnet — real money
 * screens never accept them.
 */
export function isValidTronAddress(raw) {
  const str = String(raw ?? '').trim();
  if (!str.startsWith('T') || str.length < 30 || str.length > 36) return false;
  const decoded = base58Decode(str);
  if (!decoded || decoded.length !== 25) return false;
  if (decoded[0] !== TRON_VERSION) return false;
  const payload = decoded.slice(0, 21);
  const given = decoded.slice(21);
  const want = checksum(payload);
  for (let i = 0; i < 4; i += 1) if (given[i] !== want[i]) return false;
  return true;
}

/**
 * The connected EVM wallet's Tron mainnet address (T…), or null when the
 * input is not a 20-byte 0x address. Returns EIP-55-independently: the
 * mapping only needs the raw bytes, so mixed-case and lowercase both work.
 */
export function evmToTronAddress(evmAddress) {
  const hex = String(evmAddress ?? '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{40}$/.test(hex)) return null;
  const payload = new Uint8Array(21);
  payload[0] = TRON_VERSION;
  for (let i = 0; i < 20; i += 1) payload[i + 1] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return base58Encode(concat(payload, checksum(payload)));
}

/**
 * Inverse: Tron T-address → the EVM 0x hex address of the SAME key, or null
 * when the input fails the Tron checksum. Lowercased 0x output, ready for the
 * app's existing EVM displays/validators.
 */
export function tronToEvmAddress(tronAddress) {
  const str = String(tronAddress ?? '').trim();
  if (!isValidTronAddress(str)) return null;
  const decoded = base58Decode(str);
  const hex = [...decoded.slice(1, 21)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `0x${hex}`;
}
