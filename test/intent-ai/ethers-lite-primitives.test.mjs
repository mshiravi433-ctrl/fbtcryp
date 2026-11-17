/* The synchronous primitives in `server/ethersLite.js`, proved against ethers.
 *
 * Two things changed in this file and both of them are on the hot path:
 *
 *   • `keccak256` now accepts a `BytesLike` — a `Uint8Array` OR a string —
 *     and returns a hex string, exactly as `ethers.keccak256` does. The
 *     previous export took only a string, so `keccak256(toUtf8Bytes(x))`
 *     hashed the TEXT of the byte array instead of the bytes. Every digest
 *     that went through it was wrong, and the Hyperliquid connectionId
 *     stopped matching the SDK's vectors.
 *
 *   • `parseUnitsSync` turns a decimal string into base units without the
 *     lazy `ethers/utils` boundary. The rounding rule is the one detail a
 *     hand-written version usually gets wrong, so it is checked against
 *     ethers directly.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { keccak256 as ethersKeccak, parseUnits, toUtf8Bytes } from 'ethers';
import { keccak256, parseUnitsSync } from '../../server/ethersLite.js';

test('keccak256 of a string matches ethers', () => {
  for (const text of ['', 'hello', 'feeBps()', 'سلام', 'a'.repeat(200)]) {
    assert.equal(keccak256(text), ethersKeccak(toUtf8Bytes(text)), `keccak256(${JSON.stringify(text.slice(0, 20))})`);
  }
});

test('keccak256 of bytes matches ethers — the case that was broken', () => {
  for (const text of ['hello', 'feeBps()', 'owner-activation-audit-roundtrip', 'سلام']) {
    const bytes = toUtf8Bytes(text);
    assert.equal(
      keccak256(bytes),
      ethersKeccak(bytes),
      `keccak256(bytes) for ${JSON.stringify(text.slice(0, 20))}`
    );
  }
});

test('keccak256 of bytes is NOT the keccak of the text of those bytes', () => {
  /* This is the exact defect: the old export did `String(bytes)` and
     hashed that. The two differ, and only the byte form is correct. */
  const bytes = toUtf8Bytes('hello');
  assert.notEqual(keccak256(bytes), keccak256(String(bytes)));
  assert.equal(keccak256(bytes), ethersKeccak(bytes));
});

test('keccak256 rejects what ethers rejects', () => {
  assert.throws(() => ethersKeccak('not bytes'));
});

test('parseUnitsSync matches ethers on the values that matter', () => {
  const cases = [
    ['250', 6], ['1.5', 6], ['0.000001', 6], ['1', 18], ['0', 6],
    ['123456789.123456', 6], ['0.5', 18], ['999999999999', 6], ['-2.5', 6],
    ['1.000001', 6]
  ];
  for (const [value, decimals] of cases) {
    assert.equal(
      parseUnitsSync(value, decimals).toString(),
      parseUnits(value, decimals).toString(),
      `parseUnitsSync(${value}, ${decimals})`
    );
  }
});

test('parseUnitsSync rejects what ethers rejects', () => {
  for (const value of ['abc', '', '1.2.3', '1e5', ' ']) {
    assert.throws(() => parseUnits(value, 6), `ethers should reject ${JSON.stringify(value)}`);
    assert.throws(() => parseUnitsSync(value, 6), `parseUnitsSync should reject ${JSON.stringify(value)}`);
  }
});

test('parseUnitsSync REFUSES a fraction longer than the scale, like ethers', () => {
  /* 0.0000001 at six decimals is one ten-millionth of a unit — it does not
     fit. ethers raises "too many decimals for format" rather than
     truncating, and so does this copy: a silent truncation would turn
     0.0000001 into 0 and quietly under-pay an invoice. */
  assert.throws(() => parseUnits('0.0000001', 6), /too many decimals/);
  assert.throws(() => parseUnitsSync('0.0000001', 6), /TOO_MANY_DECIMALS/);
});
