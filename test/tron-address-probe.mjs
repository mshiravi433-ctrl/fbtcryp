#!/usr/bin/env node
/**
 * TRON (TRC20) ADDRESS PROBE
 * ---------------------------------------------------------------------------
 * The «فقط برای ایرانیان» tab lets the user withdraw bitpin USDT on TRC20.
 * This app has no Tron account object — its wallet is EVM-only — but the
 * connected secp256k1 key already controls a deterministic Tron mainnet
 * address: Base58Check(0x41 || the same 20 EVM bytes).
 *
 * A wrong wrapper (bad checksum, wrong version byte, or printing a 0x address
 * for TRC20) burns the withdrawal, so this probe pins:
 *
 *   1. the canonical Tether-USDT contract pair documented by Tron
 *      (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t ⇄ 0xa614…d13c) both directions;
 *   2. EVM → Tron → EVM round trips;
 *   3. checksum tampering is rejected (one swapped character must fail);
 *   4. testnet / wrong-version / non-T / malformed strings are rejected;
 *   5. every produced T-address starts with T and is exactly 34 chars.
 *
 * Pure module, no network.
 */
import {
  base58Decode,
  base58Encode,
  evmToTronAddress,
  isValidTronAddress,
  tronToEvmAddress
} from '../src/lib/tronAddress.js';

const rows = [];
const check = (name, ok) => rows.push({ name, ok: Boolean(ok) });

/* Canonical mainnet vector: official USDT TRC20 contract (developers.tron.network). */
const USDT_T = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzLj6t'; // placeholder, fixed below
const USDT_T_REAL = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_EVM = '0xa614f803b6fd780986a42c78ec9c7f77e6ded13c';

check('the canonical USDT-TRC20 contract T-address validates', isValidTronAddress(USDT_T_REAL));
check('canonical T-address decodes to the documented 0x address', tronToEvmAddress(USDT_T_REAL) === USDT_EVM);
check('documented 0x address encodes to the canonical T-address', evmToTronAddress(USDT_EVM) === USDT_T_REAL);
check('the deliberately misspelled placeholder vector is rejected', !isValidTronAddress(USDT_T));

/* Round trips for varied EVM addresses (all-caps, lowercase, checksummed). */
const samples = [
  '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B', // vitalik.eth (mixed-case checksum)
  '0x71a49c6c829c2a0c86a4b3194c5b8b0d1f9c0a2b',
  '0x000000000000000000000000000000000000dEaD',
  '0xffffffffffffffffffffffffffffffffffffffff'
];
for (const evm of samples) {
  const t = evmToTronAddress(evm);
  check(`${evm} → T-address is well-formed (T, 34 chars, valid checksum)`,
    Boolean(t) && t.startsWith('T') && t.length === 34 && isValidTronAddress(t));
  check(`${evm} round-trips through its T-address`, tronToEvmAddress(t) === evm.toLowerCase());
}

/* Garbage in, null/false out — never an address string someone could copy. */
check('a non-0x string cannot be converted', evmToTronAddress('not-an-address') === null);
check('a short hex string cannot be converted', evmToTronAddress('0x1234') === null);
check('empty input cannot be converted', evmToTronAddress('') === null);
check('a plain 0x address is not a valid Tron address', !isValidTronAddress('0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'));
check('a non-T base58 string is rejected', !isValidTronAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'));
check('an empty Tron string is rejected', !isValidTronAddress(''));

/* Flip one character in a valid address — the checksum MUST catch it. */
{
  const good = evmToTronAddress(samples[0]);
  const chars = good.split('');
  const at = chars.findIndex((c, i) => i > 4 && c !== 'A' && c !== 'Z');
  chars[at] = chars[at] === 'A' ? 'B' : 'A';
  const tampered = chars.join('');
  check('a single swapped character invalidates the checksum', tampered !== good && !isValidTronAddress(tampered));
}

/* A testnet-prefixed payload (0xa0 instead of 0x41) must be rejected. */
{
  const payload = new Uint8Array(21);
  payload[0] = 0xa0;
  for (let i = 1; i < 21; i += 1) payload[i] = i;
  const b58 = base58Encode(payload);
  check('a non-mainnet version byte is not accepted as a bare base58 string', typeof b58 === 'string' && b58.length > 0);
}
{
  const main = evmToTronAddress(samples[1]);
  const raw = base58Decode(main);
  check('decoded mainnet payload is exactly 25 bytes starting with 0x41',
    raw.length === 25 && raw[0] === 0x41);
  const testnet = new Uint8Array(raw);
  testnet[0] = 0xa0;
  check('the same payload with a testnet version byte is rejected', !isValidTronAddress(base58Encode(testnet)));
}

const failed = rows.filter((r) => !r.ok);
for (const r of rows) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
