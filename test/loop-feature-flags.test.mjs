import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOP_PER_STEP_SIMULATION,
  loopExecutionGate,
  parseLoopExecutionAllowlist,
  readLoopFeatureFlags
} from '../src/lib/loopFeatureFlags.js';

const wallet = '0x00000000000000000000000000000000000000aa';
const other = '0x00000000000000000000000000000000000000bb';

test('calculator and step execution default on; an explicit false is the kill switch', () => {
  const flags = readLoopFeatureFlags({});
  assert.equal(flags.calculatorEnabled, true);
  assert.equal(flags.executionEnabled, true);
  assert.deepEqual(flags.allowlist, []);
  assert.equal(flags.allowlistConfigured, false);
  for (const off of ['false', '0', 'off', 'no', ' FALSE ']) {
    const killed = readLoopFeatureFlags({ VITE_COLLATERAL_LOOP_EXECUTION_ENABLED: off });
    assert.equal(killed.executionEnabled, false, off);
    assert.equal(loopExecutionGate({ flags: killed, chainId: 42161, wallet, supportedChain: true }).reason, 'FLAG_DISABLED');
  }
});

test('with no allowlist any connected wallet on a supported chain may execute', () => {
  const flags = readLoopFeatureFlags({});
  assert.deepEqual(loopExecutionGate({ flags, chainId: 42161, wallet, supportedChain: true }), { allowed: true, reason: null });
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet: null, supportedChain: true }).reason, 'WALLET_REQUIRED');
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet, supportedChain: false }).reason, 'CHAIN_UNSUPPORTED');
  assert.equal(LOOP_PER_STEP_SIMULATION, true);
});

test('a configured allowlist restricts execution to exact chain and wallet pairs', () => {
  const flags = readLoopFeatureFlags({ VITE_COLLATERAL_LOOP_ALLOWLIST: `42161:${wallet}` });
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet, supportedChain: true }).allowed, true);
  assert.equal(loopExecutionGate({ flags, chainId: 8453, wallet, supportedChain: true }).reason, 'NOT_ALLOWLISTED');
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet: other, supportedChain: true }).reason, 'NOT_ALLOWLISTED');
});

test('malformed and chain-only allowlist entries fail closed — a set-but-unparseable list admits nobody', () => {
  assert.deepEqual(parseLoopExecutionAllowlist(`42161,8453:${wallet},NaN:0x1234`), [{ chainId: 8453, wallet }]);
  const flags = { executionEnabled: true, allowlist: parseLoopExecutionAllowlist(`42161,8453:${wallet}`) };
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet, supportedChain: true }).reason, 'NOT_ALLOWLISTED');
  const garbage = readLoopFeatureFlags({ VITE_COLLATERAL_LOOP_ALLOWLIST: 'not-a-rule' });
  assert.equal(garbage.allowlistConfigured, true);
  assert.equal(loopExecutionGate({ flags: garbage, chainId: 42161, wallet, supportedChain: true }).reason, 'NOT_ALLOWLISTED');
});

test('a read-only backend, a wallet on another network and a missing step simulator all block', () => {
  const flags = readLoopFeatureFlags({});
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet, supportedChain: true, readOnly: true }).reason, 'READ_ONLY');
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet, supportedChain: true, walletChainId: 8453 }).reason, 'WRONG_NETWORK');
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet, supportedChain: true, walletChainId: 42161 }).allowed, true);
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet, supportedChain: true, perStepSimulation: false }).reason, 'STEP_SIMULATION_UNAVAILABLE');
});
