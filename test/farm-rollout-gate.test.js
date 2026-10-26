import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertFarmRollout,
  formatFarmRollout,
  inspectFarmRollout
} from '../scripts/farm-rollout-policy.mjs';
import { runStaticCanaryPreflight } from '../scripts/verify-aave-base-canary-ready.mjs';

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
      allowlist: [ADDRESS]
    });
    // Amount caps are gone by owner decision; the gate must not resurrect them.
    expect(result.protocols['aave-base'].perTxCap).toBeUndefined();
    expect(result.protocols['aave-base'].totalCap).toBeUndefined();
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

  it('ignores amount-cap env vars entirely — caps were removed by owner decision', () => {
    // A stale VITE_*_MAX_* value (left in a dashboard by mistake) must neither
    // fail the build nor re-introduce a cap: it is simply not a gate input.
    const result = assertFarmRollout({
      ...AAVE_BASE_CANARY,
      VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX: '1001',
      VITE_AAVE_BASE_SUPPLY_MAX_USDC_TOTAL: '10001'
    });
    expect(formatFarmRollout(result)).toMatch(/uncapped/);
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

  it('never opens public capital on a public flag alone: canary must be confirmed', () => {
    const result = inspectFarmRollout({
      ...AAVE_BASE_CANARY,
      VITE_AAVE_BASE_SUPPLY_PUBLIC: 'true'
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/FARM_CANARY_CONFIRMED=true/);
  });

  it('opens supply to any wallet only with strict evidence AND a confirmed canary', () => {
    const result = assertFarmRollout({
      ...AAVE_BASE_CANARY,
      VITE_AAVE_BASE_SUPPLY_PUBLIC: 'true',
      FARM_CANARY_CONFIRMED: 'true'
    });
    expect(result).toMatchObject({
      ok: true,
      mode: 'public-open',
      enabled: ['aave-base'],
      public: ['aave-base'],
      canaryConfirmed: true
    });
    expect(result.protocols['aave-base'].public).toBe(true);
    // The gate message names the wider scope so an operator can see it opened.
    expect(formatFarmRollout(result)).toMatch(/public-open rollout/);
  });

  it('opens public capital with a confirmed canary even when stale cap env vars linger', () => {
    const result = assertFarmRollout({
      ...AAVE_BASE_CANARY,
      VITE_AAVE_BASE_SUPPLY_PUBLIC: 'true',
      FARM_CANARY_CONFIRMED: 'true',
      VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX: '2000'
    });
    expect(result.mode).toBe('public-open');
    expect(formatFarmRollout(result)).toMatch(/uncapped/);
  });

  it('rejects a public flag on a protocol whose money-in flag is not true', () => {
    const result = inspectFarmRollout({
      FARM_ROLLOUT_PROTOCOLS: 'aave-base',
      FARM_STRICT_FORK_EVIDENCE: 'true',
      VITE_AAVE_BASE_SUPPLY_PUBLIC: 'true'
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/PUBLIC=true requires VITE_ENABLE_AAVE_BASE_SUPPLY=true/);
  });

  it('keeps the limited-canary mode when no public flag is present', () => {
    expect(assertFarmRollout(AAVE_BASE_CANARY)).toMatchObject({
      ok: true,
      mode: 'limited-canary',
      public: []
    });
  });

  it('does not count missing RPC URLs as strict SplitRouter fork evidence', () => {
    const env = { ...process.env };
    delete env.BASE_RPC_URL;
    delete env.ARBITRUM_RPC_URL;
    delete env.ETH_RPC_URL;
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./split-router/split-router-fork-rehearsal.mjs', import.meta.url)),
      '--strict'
    ], { env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('explicit RPC URLs provided (--strict)');
  });
});

describe('Aave v3 Base canary preflight verifier', () => {
  it('passes static preflight in clean capital-off env and reports canary wallet pending', () => {
    const res = runStaticCanaryPreflight({});
    expect(res.ok).toBe(true);
    expect(res.hasRealCanaryWallet).toBe(false);
    expect(res.canaryWallet).toBeNull();
    expect(res.pins).toEqual({
      chainId: 8453,
      pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
      addressesProvider: '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D',
      aUsdc: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB',
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    });
  });

  it('accepts a valid public canary wallet address without touching live flags', () => {
    const res = runStaticCanaryPreflight({
      CANARY_WALLET: '0xaf5ce154cefd22da5bd1d0a54479e81963a224d6'
    });
    expect(res.ok).toBe(true);
    expect(res.hasRealCanaryWallet).toBe(true);
    expect(res.canaryWallet).toBe('0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6');
  });

  it('fails closed if any private key or 64-hex secret is placed in env', () => {
    const byName = runStaticCanaryPreflight({
      PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    });
    expect(byName.ok).toBe(false);
    expect(byName.checks.find((c) => c.name.startsWith('secret hygiene'))?.ok).toBe(false);

    const byShape = runStaticCanaryPreflight({
      VITE_AAVE_BASE_SUPPLY_ALLOWLIST: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    });
    expect(byShape.ok).toBe(false);
  });

  it('fails closed if VITE_FBT_SPLIT_ROUTER_BASE is set while splitRouterArtifact.audited is false', () => {
    const res = runStaticCanaryPreflight({
      VITE_FBT_SPLIT_ROUTER_BASE: '0x1111111111111111111111111111111111111111'
    });
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.name.startsWith('SplitRouter Base'))?.ok).toBe(false);
  });
});
