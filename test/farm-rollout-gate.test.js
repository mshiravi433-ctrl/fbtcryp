import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertFarmRollout,
  inspectFarmRollout
} from '../scripts/farm-rollout-policy.mjs';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const AAVE_BASE_CANARY = Object.freeze({
  FARM_ROLLOUT_PROTOCOLS: 'aave-base',
  FARM_STRICT_FORK_EVIDENCE: 'true',
  VITE_ENABLE_AAVE_BASE_SUPPLY: 'true',
  VITE_AAVE_BASE_SUPPLY_ALLOWLIST: ADDRESS,
  VITE_ENABLE_COMPOUND_BASE_SUPPLY: 'false',
  VITE_ENABLE_AAVE_ARBITRUM_SUPPLY: 'false',
  VITE_ENABLE_LIDO_STAKE: 'false',
  VITE_ENABLE_MORPHO_BASE_SUPPLY: 'false'
});

describe('staged Farm production rollout gate', () => {
  it('allows a public build with every money-in path off and no evidence marker', () => {
    expect(inspectFarmRollout({})).toMatchObject({
      ok: true,
      mode: 'capital-off',
      enabled: [],
      selected: []
    });
  });

  it('allows Aave Base alone without demanding unrelated protocols', () => {
    const result = assertFarmRollout(AAVE_BASE_CANARY);
    expect(result).toMatchObject({
      ok: true,
      mode: 'limited-canary',
      enabled: ['aave-base'],
      selected: ['aave-base']
    });
    expect(result.protocols['aave-base']).toMatchObject({
      allowlist: [ADDRESS],
      perTxCap: 1000,
      totalCap: 10000
    });
  });

  it('rejects a lone VITE flag so direct production builds cannot bypass the gate', () => {
    expect(() => assertFarmRollout({
      VITE_ENABLE_AAVE_BASE_SUPPLY: 'true'
    })).toThrow(/FARM_ROLLOUT_PROTOCOLS.*aave-base/);
  });

  it('rejects a selected stage whose protocol flag is not exactly true', () => {
    expect(() => assertFarmRollout({
      FARM_ROLLOUT_PROTOCOLS: 'aave-base',
      FARM_STRICT_FORK_EVIDENCE: 'true',
      VITE_AAVE_BASE_SUPPLY_ALLOWLIST: ADDRESS
    })).toThrow(/VITE_ENABLE_AAVE_BASE_SUPPLY is not true/);
  });

  it('requires strict-fork evidence only when a money-in protocol is enabled', () => {
    expect(() => assertFarmRollout({
      ...AAVE_BASE_CANARY,
      FARM_STRICT_FORK_EVIDENCE: ''
    })).toThrow(/FARM_STRICT_FORK_EVIDENCE=true/);
  });

  it.each([
    ['', 'at least one public canary wallet'],
    ['not-an-address', 'invalid or zero'],
    ['0x0000000000000000000000000000000000000000', 'invalid or zero'],
    [`${ADDRESS},`, 'empty entry'],
    [`${ADDRESS},${ADDRESS}`, 'same address more than once']
  ])('rejects unsafe Aave Base allowlist %j', (allowlist, message) => {
    expect(() => assertFarmRollout({
      ...AAVE_BASE_CANARY,
      VITE_AAVE_BASE_SUPPLY_ALLOWLIST: allowlist
    })).toThrow(message);
  });

  it('does not allow canary cap overrides above the reviewed 1000/10000 limits', () => {
    expect(() => assertFarmRollout({
      ...AAVE_BASE_CANARY,
      VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX: '1001',
      VITE_AAVE_BASE_SUPPLY_MAX_USDC_TOTAL: '10001'
    })).toThrow(/may not exceed the reviewed canary cap/);
  });

  it('rejects a per-tx cap that exceeds the total cap', () => {
    expect(() => assertFarmRollout({
      ...AAVE_BASE_CANARY,
      VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX: '2000',
      VITE_AAVE_BASE_SUPPLY_MAX_USDC_TOTAL: '10000'
    })).toThrow(/may not exceed/);
  });

  it('requires every independently enabled protocol to be selected and allowlisted', () => {
    const result = inspectFarmRollout({
      ...AAVE_BASE_CANARY,
      VITE_ENABLE_COMPOUND_BASE_SUPPLY: 'true'
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/compound-base/);
    expect(result.errors.join('\n')).toMatch(/VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST/);
  });

  it('rejects unknown, duplicate and malformed rollout ids', () => {
    const result = inspectFarmRollout({
      FARM_ROLLOUT_PROTOCOLS: 'aave-base,,aave-base,unknown'
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/empty entry/);
    expect(result.errors.join('\n')).toMatch(/duplicate/);
    expect(result.errors.join('\n')).toMatch(/unknown id/);
  });

  it.each([
    ['aave-base-fork-probe.mjs', 'BASE_RPC_URL'],
    ['compound-base-fork-probe.mjs', 'BASE_RPC_URL'],
    ['morpho-base-fork-probe.mjs', 'BASE_RPC_URL'],
    ['aave-arbitrum-fork-probe.mjs', 'ARBITRUM_RPC_URL'],
    ['lido-mainnet-fork-probe.mjs', 'ETHEREUM_RPC_URL']
  ])('does not count a missing RPC as strict fork evidence: %s', (script, rpcName) => {
    const env = { ...process.env };
    delete env.BASE_RPC_URL;
    delete env.ARBITRUM_RPC_URL;
    delete env.ETHEREUM_RPC_URL;
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL(`./${script}`, import.meta.url)),
      '--strict'
    ], { env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(`${rpcName} provided (--strict)`);
  });
});
