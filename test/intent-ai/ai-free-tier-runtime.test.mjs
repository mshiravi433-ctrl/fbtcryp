/*
 * THE FREE-TIER RUNTIME PROBE.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The deployment's Fluid Active CPU allowance is 4 hours per rolling 30
 * days — about eight minutes of CPU per day. The cold-start measurement
 * said 588 ms of CPU was spent before the first request, and the two
 * libraries that dominated it were `ethers` (181 ms) and `@solana/web3.js`
 * (131 ms) — compiled on EVERY cold start, including the ones that only
 * serve a health check.
 *
 * The fix was three things: a dependency-free Keccak-256, a dependency-free
 * EVM address implementation, and a lazy boundary in front of the ethers
 * subpaths that cannot be re-implemented cheaply.
 *
 * All three are verified against `ethers` ITSELF — the library they replace.
 * A hand-written hash and a hand-written checksum are exactly the things
 * that must be proven rather than trusted, so the proof is here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { keccak256, keccak256Hex } from '../../server/keccak.js';
import { getAddress, isAddress } from '../../server/evmAddress.js';
import {
  lazyModule,
  lazyFn,
  loadModule,
  loadExport,
  lazyModuleReport,
  __resetLazyModuleRegistryForTests
} from '../../server/lazyModules.js';

/* `ethers` is the reference implementation for all three. */
import * as ethers from 'ethers';

/* -------------------------------------------------------------------------- */
/*  A. KECCAK-256                                                             */
/* -------------------------------------------------------------------------- */

test('keccak-256 of the empty string is the published constant', () => {
  /* The canonical Keccak-256 test vector. SHA3-256 differs from it — the
     domain separation byte is what makes it Keccak and not SHA3. */
  assert.equal(
    keccak256Hex(''),
    '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
  );
});

test('keccak-256 agrees with ethers on the standard vectors', () => {
  const vectors = [
    '',
    'abc',
    'hello world',
    'The quick brown fox jumps over the lazy dog',
    'a'.repeat(135),
    'a'.repeat(136),
    'a'.repeat(137),
    'a'.repeat(272),
    'x'.repeat(1000)
  ];
  for (const v of vectors) {
    const mine = keccak256Hex(v);
    const theirs = ethers.keccak256(ethers.toUtf8Bytes(v));
    assert.equal(mine, theirs, `mismatch for a ${v.length}-byte input`);
  }
});

test('keccak-256 agrees with ethers on random bytes', () => {
  for (let i = 0; i < 200; i += 1) {
    const len = Math.floor(Math.random() * 400);
    const buf = new Uint8Array(len);
    for (let j = 0; j < len; j += 1) buf[j] = Math.floor(Math.random() * 256);
    const mine = `0x${Buffer.from(keccak256(buf)).toString('hex')}`;
    assert.equal(mine, ethers.keccak256(buf));
  }
});

/* -------------------------------------------------------------------------- */
/*  B. THE EVM ADDRESS HELPERS                                                 */
/* -------------------------------------------------------------------------- */

const ADDRESS_CORPUS = [
  '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0X5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED',
  '5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
  '0x8ba1f109551bd432803012645ac136ddd64dba72',
  '0x8Ba1f109551bD432803012645Ac136ddd64DBa72',
  '0xD9E9B4A6dB1C4a4C0b9B5C5b7c8D9e0F1a2B3c4',
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000001',
  'XE65GB6LDNXYOFTX0NSV3FUWKOWIXAMJK36',
  'not-an-address',
  '0x123',
  '0xZZaeb6053f3e94c9b9a09f33669435e7ef1beaed',
  '',
  '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beae',
  '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaedd'
];

test('getAddress agrees with ethers on every corpus entry', () => {
  for (const v of ADDRESS_CORPUS) {
    const mine = (() => { try { return getAddress(v); } catch { return 'THREW'; } })();
    const theirs = (() => { try { return ethers.getAddress(v); } catch { return 'THREW'; } })();
    assert.equal(mine, theirs, `mismatch for ${JSON.stringify(v)}`);
  }
});

test('isAddress agrees with ethers on every corpus entry', () => {
  for (const v of ADDRESS_CORPUS) {
    assert.equal(isAddress(v), ethers.isAddress(v), `mismatch for ${JSON.stringify(v)}`);
  }
});

test('getAddress agrees with ethers on thousands of random addresses', () => {
  const chars = '0123456789abcdefABCDEF';
  for (let i = 0; i < 1500; i += 1) {
    const len = Math.random() < 0.5 ? 42 : 6 + Math.floor(Math.random() * 50);
    let s = '0x';
    for (let j = 0; j < len - 2; j += 1) s += chars[Math.floor(Math.random() * chars.length)];
    const mine = (() => { try { return getAddress(s); } catch { return 'THREW'; } })();
    const theirs = (() => { try { return ethers.getAddress(s); } catch { return 'THREW'; } })();
    assert.equal(mine, theirs, `mismatch for ${s}`);
  }
});

test('a mixed-case address with a bad checksum is REFUSED — this is the safety property', () => {
  /* ethers refuses it, and so must this: accepting it would send funds to
     the wrong place. */
  const bad = '0x8Ba1f109551bD432803012645Ac136ddd64DBa72';
  assert.throws(() => getAddress(bad));
  assert.throws(() => ethers.getAddress(bad));
  assert.equal(isAddress(bad), false);
});

test('an all-lowercase address is accepted and checksummed', () => {
  /* The expected value is ethers' own — the checksum of
     `0x8ba1f109551bd432803012645ac136ddd64dba72`, and the test asserts
     against the library rather than against a hand-written copy. */
  assert.equal(
    getAddress('0x8ba1f109551bd432803012645ac136ddd64dba72'),
    ethers.getAddress('0x8ba1f109551bd432803012645ac136ddd64dba72')
  );
  assert.equal(
    getAddress('0x8ba1f109551bd432803012645ac136ddd64dba72'),
    '0x8ba1f109551bD432803012645Ac136ddd64DBA72'
  );
});

/* -------------------------------------------------------------------------- */
/*  C. THE LAZY MODULE REGISTRY                                                */
/* -------------------------------------------------------------------------- */

test('a registered module is loaded once, no matter how many callers ask', async () => {
  __resetLazyModuleRegistryForTests();
  let loads = 0;
  lazyModule('probe-once', async () => {
    loads += 1;
    return { value: 'loaded' };
  });
  const [a, b] = await Promise.all([loadModule('probe-once'), loadModule('probe-once')]);
  assert.equal(loads, 1, 'a burst must share one import');
  assert.equal(a.value, 'loaded');
  assert.equal(b.value, 'loaded');
});

test('a lazy proxy forwards its arguments and its return value', async () => {
  __resetLazyModuleRegistryForTests();
  lazyModule('probe-args', async () => ({
    double: (n) => n * 2,
    greet: (who) => `hi ${who}`
  }));
  const double = lazyFn('probe-args', 'double');
  const greet = lazyFn('probe-args', 'greet');
  assert.equal(await double(21), 42);
  assert.equal(await greet('there'), 'hi there');
});

test('an unregistered module fails loudly and names itself', async () => {
  __resetLazyModuleRegistryForTests();
  await assert.rejects(() => loadModule('probe-missing'), /NOT_REGISTERED/);
});

test('a missing export fails loudly and names the export', async () => {
  __resetLazyModuleRegistryForTests();
  lazyModule('probe-export', async () => ({ present: 1 }));
  await assert.rejects(() => loadExport('probe-export', 'absent'), /MISSING_EXPORT:absent/);
});

test('a failed load is retryable — a cold-start failure must not poison the instance', async () => {
  __resetLazyModuleRegistryForTests();
  let attempts = 0;
  lazyModule('probe-flaky', async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('TRANSIENT');
    return { ok: true };
  });
  await assert.rejects(() => loadModule('probe-flaky'), /TRANSIENT/);
  const mod = await loadModule('probe-flaky');
  assert.equal(mod.ok, true, 'the second attempt must succeed');
  assert.equal(attempts, 2);
});

test('a duplicate label is refused — a label is how a failure is traced', () => {
  __resetLazyModuleRegistryForTests();
  lazyModule('probe-dup', async () => ({}));
  assert.throws(() => lazyModule('probe-dup', async () => ({})), /DUPLICATE_LABEL/);
});

test('the report says which modules were actually loaded', async () => {
  __resetLazyModuleRegistryForTests();
  lazyModule('probe-report', async () => ({ v: 1 }));
  await loadModule('probe-report');
  const report = lazyModuleReport();
  assert.equal(report.registered, 1);
  assert.equal(report.loaded, 1);
  assert.ok(report.labels.includes('probe-report'));
});

/* -------------------------------------------------------------------------- */
/*  D. THE DEFERRED ETHERS ARE STILL THE RIGHT FUNCTIONS                      */
/* -------------------------------------------------------------------------- */

test('the deferred ethers areas still produce ethers-identical results', async () => {
  /* The lazy boundary changed HOW they are loaded, not WHAT they do. */
  const lite = await import('../../server/ethersLite.js');
  assert.equal(lite.ZeroAddress, ethers.ZeroAddress);
  assert.equal(lite.ZeroHash, ethers.ZeroHash);
  assert.equal(lite.MaxUint256, ethers.MaxUint256);
  assert.equal(lite.MinInt256, ethers.MinInt256);

  const iface = await lite.Interface(['function foo(uint256 x)']);
  const theirs = new ethers.Interface(['function foo(uint256 x)']);
  assert.equal(iface.encodeFunctionData('foo', [5]), theirs.encodeFunctionData('foo', [5]));

  assert.equal(await lite.parseUnits('1.5', 6), ethers.parseUnits('1.5', 6));
  assert.equal(await lite.formatUnits(1500000n, 6), ethers.formatUnits(1500000n, 6));
});
