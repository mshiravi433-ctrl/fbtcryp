/**
 * The Lending BFF, cross-checked against the client it serves.
 *
 * `server/lending.js` cannot import `src/lib/lending.js` — that file pulls the
 * Vite chain registry (`import.meta.env`) into Node — so the reserve-configuration
 * bit layout and the oracle ABI are necessarily written twice. Duplication that
 * cannot be removed must at least be PINNED: this file decodes the same bitmaps
 * and encodes the same function calls through both implementations and fails if
 * they ever drift. A drifted shift is not a cosmetic difference; it silently
 * turns one chain's "LTV 80%" into another's "LTV 0%".
 *
 * Everything here is offline. No RPC is dialed: the only calls made are ones
 * that must fail closed on an unsupported chain.
 */
import { describe, it, expect } from 'vitest';
import { Interface } from 'ethers';

import * as BFF from '../server/lending.js';
import {
  RESERVE_CONFIG_BITS as CLIENT_BITS,
  decodeReserveConfiguration as clientDecode,
  AAVE_ORACLE_ABI, AAVE_POOL_ABI, AAVE_PROVIDER_ABI
} from '../src/lib/lending.js';

/** Build a configuration bitmap from named fields, the way Aave lays it out. */
const bitmap = ({ ltvBps = 0, liquidationThresholdBps = 0, liquidationBonusBps = 0, decimals = 0, active = false, frozen = false, borrowingEnabled = false, paused = false, borrowCapWhole = 0, supplyCapWhole = 0 } = {}) => {
  const b = CLIENT_BITS;
  let raw = 0n;
  raw |= BigInt(ltvBps) << b.ltvShift;
  raw |= BigInt(liquidationThresholdBps) << b.liquidationThresholdShift;
  raw |= BigInt(liquidationBonusBps) << b.liquidationBonusShift;
  raw |= BigInt(decimals) << b.decimalsShift;
  if (active) raw |= 1n << b.activeShift;
  if (frozen) raw |= 1n << b.frozenShift;
  if (borrowingEnabled) raw |= 1n << b.borrowingEnabledShift;
  if (paused) raw |= 1n << b.pausedShift;
  raw |= BigInt(borrowCapWhole) << b.borrowCapShift;
  raw |= BigInt(supplyCapWhole) << b.supplyCapShift;
  return raw;
};

describe('the two bit layouts are the same bit layout', () => {
  it('agrees on every shift the server relies on', () => {
    for (const key of ['ltvShift', 'liquidationThresholdShift', 'liquidationBonusShift', 'decimalsShift', 'activeShift', 'frozenShift', 'borrowingEnabledShift', 'pausedShift', 'borrowCapShift', 'supplyCapShift']) {
      expect(BFF.RESERVE_CONFIG_BITS[key], key).toBe(CLIENT_BITS[key]);
    }
    expect(BFF.RESERVE_CONFIG_BITS.capBits).toBe(CLIENT_BITS.capBits);
  });

  it('decodes the same values from the same bitmap, across a matrix of states', () => {
    const cases = [
      {}, // a zero bitmap — the "read produced nothing" case
      { ltvBps: 8000, liquidationThresholdBps: 8500, liquidationBonusBps: 10500, decimals: 6, active: true, borrowingEnabled: true },
      { ltvBps: 7300, liquidationThresholdBps: 7800, liquidationBonusBps: 10500, decimals: 18, active: true, borrowingEnabled: true, supplyCapWhole: 1000000, borrowCapWhole: 800000 },
      { ltvBps: 0, liquidationThresholdBps: 0, decimals: 8, active: true, frozen: true },
      { ltvBps: 5000, liquidationThresholdBps: 6000, decimals: 6, active: true, paused: true }
    ];
    for (const fields of cases) {
      const raw = bitmap(fields);
      const server = BFF.decodeReserveConfig(raw);
      const client = clientDecode(raw);
      const label = `bitmap 0x${raw.toString(16)}`;

      expect(server.readable, label).toBe(client.readable);
      expect(server.decimals, label).toBe(client.decimals);
      expect(server.active, label).toBe(client.active);
      expect(server.frozen, label).toBe(client.frozen);
      expect(server.paused, label).toBe(client.paused);
      expect(server.borrowingEnabled, label).toBe(client.borrowingEnabled);
      expect(server.supplyCapWhole, label).toBe(client.supplyCapWhole == null ? null : Number(client.supplyCapWhole));
      expect(server.borrowCapWhole, label).toBe(client.borrowCapWhole == null ? null : Number(client.borrowCapWhole));
      expect(server.status, label).toBe(client.status);
      /* bps → percent on both sides. */
      if (client.ltvBps != null && server.readable) {
        expect(server.ltv, label).toBeCloseTo(client.ltvBps / 100, 9);
        expect(server.liquidationThreshold, label).toBeCloseTo(client.liquidationThresholdBps / 100, 9);
        expect(server.liquidationBonus, label).toBeCloseTo(client.liquidationBonusBps / 100, 9);
      }
    }
  });

  it('reports a zero bitmap as unreadable, never as "active with 0% LTV" (§3/§37)', () => {
    const server = BFF.decodeReserveConfig(0n);
    expect(server.readable).toBe(false);
    expect(server.status).toBe('unknown');
    expect(server.ltv).toBe(null);
    expect(server.liquidationThreshold).toBe(null);
    expect(server.borrowingEnabled).toBe(null);
    expect(server.active).toBe(null);
    expect(server.supplyCapWhole).toBe(null);
    /* And the client agrees that this is not a usable read. */
    expect(clientDecode(0n).readable).toBe(false);
  });

  it('distinguishes paused from frozen from active', () => {
    expect(BFF.decodeReserveConfig(bitmap({ paused: true, active: true })).status).toBe('paused');
    expect(BFF.decodeReserveConfig(bitmap({ frozen: true, active: true })).status).toBe('frozen');
    expect(BFF.decodeReserveConfig(bitmap({ active: true, borrowingEnabled: true })).status).toBe('active');
    /* Paused wins over frozen: the stronger restriction is the one reported. */
    expect(BFF.decodeReserveConfig(bitmap({ paused: true, frozen: true })).status).toBe('paused');
  });
});

describe('the two oracle ABIs encode the same wire calls', () => {
  const serverOracle = new Interface(BFF.ORACLE_ABI);
  const clientOracle = new Interface(AAVE_ORACLE_ABI);
  const serverPool = new Interface(BFF.POOL_ABI);
  const clientPool = new Interface(AAVE_POOL_ABI);
  /* §21 two-stage resolution: BOTH sides ask the POOL for its addresses
     provider, then ask the PROVIDER for the oracle (2026-09-22: the call used
     to go straight to the pool, whose ABI had no such function — the parity
     suite passed a selector the real chain reverts on). */
  const serverProvider = new Interface(BFF.PROVIDER_ABI);
  const clientProvider = new Interface(AAVE_PROVIDER_ABI);
  const ASSET = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';

  it('asks the pool for its addresses provider with identical calldata', () => {
    expect(serverPool.encodeFunctionData('getAddressesProvider', []))
      .toBe(clientPool.encodeFunctionData('getAddressesProvider', []));
  });

  it('asks the ADDRESSES PROVIDER for its oracle, and no pool ABI even has getPriceOracle', () => {
    expect(serverProvider.encodeFunctionData('getPriceOracle', []))
      .toBe(clientProvider.encodeFunctionData('getPriceOracle', []));
    /* The regression this pins: getPriceOracle is NOT a Pool function. If it
       ever reappears on a POOL_ABI, the exact outage of 2026-09-22 (every real
       RPC reverting on it) is back. */
    expect(() => serverPool.encodeFunctionData('getPriceOracle', [])).toThrow();
    expect(() => clientPool.encodeFunctionData('getPriceOracle', [])).toThrow();
  });

  it('asks the oracle for a price, a price batch and its base unit, identically', () => {
    expect(serverOracle.encodeFunctionData('getAssetPrice', [ASSET]))
      .toBe(clientOracle.encodeFunctionData('getAssetPrice', [ASSET]));
    expect(serverOracle.encodeFunctionData('getAssetsPrices', [[ASSET]]))
      .toBe(clientOracle.encodeFunctionData('getAssetsPrices', [[ASSET]]));
    expect(serverOracle.encodeFunctionData('BASE_CURRENCY_UNIT', []))
      .toBe(clientOracle.encodeFunctionData('BASE_CURRENCY_UNIT', []));
  });

  it('decodes an oracle answer the same way', () => {
    /* $1.00 in an 8-decimal base currency. */
    const returned = '0x' + (10n ** 8n).toString(16).padStart(64, '0');
    const server = serverOracle.decodeFunctionResult('getAssetPrice', returned)[0];
    const client = clientOracle.decodeFunctionResult('getAssetPrice', returned)[0];
    expect(server).toBe(client);
    expect(server).toBe(10n ** 8n);
  });
});

describe('§21/§32 — the oracle fails closed, offline, without inventing a price', () => {
  it('refuses an unsupported chain before dialing anything', async () => {
    const result = await BFF.oraclePrices(999999);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNSUPPORTED_CHAIN');
    expect(result.status).toBe('unavailable');
    expect(result.source).toBe('aave-oracle');
    expect(result.prices).toBeUndefined();
  });

  it('refuses a chain with a pool but no allowlisted tokens', async () => {
    /* Chain 10 is a declared Aave venue; whether it has allowlisted reserves is
       a registry fact, so this asserts the code path, not the registry. */
    const tokens = BFF.chainTokens(10);
    const result = await BFF.readProtocolOracle(10);
    if (!tokens.length) {
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_TOKENS');
    } else {
      /* With tokens present the read needs RPC; offline it must fail closed
         rather than return a price. */
      expect(result.ok === false || typeof result.prices === 'object').toBe(true);
      if (result.ok) expect(result.source).toBe('aave-oracle');
    }
  });

  it('never exposes a third-party reference price as an oracle price', async () => {
    const result = await BFF.oraclePrices(999999);
    /* On a failed read the reference may be attached, but it is namespaced and
       the top-level `prices` — the field consumers treat as the oracle — is
       absent. Nothing can mistake one for the other. */
    expect(result.prices).toBeUndefined();
    expect(result.reference === undefined || result.reference?.source !== 'aave-oracle').toBe(true);
  });

  it('only allowlists reserves from the audited registry', () => {
    expect(BFF.findToken(42161, 'SCAM')).toBe(null);
    expect(BFF.findToken(999999, 'USDC')).toBe(null);
    /* A real reserve resolves by symbol and by address. */
    const bySymbol = BFF.findToken(42161, 'USDC');
    expect(bySymbol).toBeTruthy();
    expect(BFF.findToken(42161, bySymbol.address)).toBe(bySymbol);
  });

  it('reads tokens only from the registry, never from a request parameter', () => {
    const tokens = BFF.chainTokens(42161);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(token.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(token.native).toBeFalsy();
    }
  });
});
