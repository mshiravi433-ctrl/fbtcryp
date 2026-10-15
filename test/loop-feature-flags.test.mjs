import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOP_STATEFUL_SIMULATION_VERIFIED,
  loopExecutionGate,
  parseLoopExecutionAllowlist,
  readLoopFeatureFlags
} from '../src/lib/loopFeatureFlags.js';

const wallet = '0x00000000000000000000000000000000000000aa';

test('calculator defaults on while loop execution defaults off', () => {
  const flags = readLoopFeatureFlags({});
  assert.equal(flags.calculatorEnabled, true);
  assert.equal(flags.executionEnabled, false);
  assert.deepEqual(flags.allowlist, []);
});

test('execution allowlist requires an exact chain and wallet', () => {
  const flags = readLoopFeatureFlags({
    VITE_COLLATERAL_LOOP_EXECUTION_ENABLED: 'true',
    VITE_COLLATERAL_LOOP_ALLOWLIST: `42161:${wallet}`
  });
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet, supportedChain: true }).reason, 'STATEFUL_SIMULATION_UNVERIFIED');
  assert.equal(loopExecutionGate({ flags, chainId: 8453, wallet, supportedChain: true }).reason, 'NOT_ALLOWLISTED');
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet: null, supportedChain: true }).reason, 'WALLET_REQUIRED');
  assert.equal(LOOP_STATEFUL_SIMULATION_VERIFIED, false);
});

test('malformed and chain-only allowlist entries fail closed', () => {
  assert.deepEqual(parseLoopExecutionAllowlist(`42161,8453:${wallet},NaN:0x1234`), [{ chainId: 8453, wallet }]);
  const flags = { executionEnabled: true, allowlist: parseLoopExecutionAllowlist(`42161,8453:${wallet}`) };
  assert.equal(loopExecutionGate({ flags, chainId: 42161, wallet, supportedChain: true }).reason, 'NOT_ALLOWLISTED');
});

test('execution needs the explicit stateful simulation proof in addition to the flags', () => {
  const flags = { executionEnabled: true, allowlist: [{ chainId: 42161, wallet }] };
  assert.deepEqual(loopExecutionGate({ flags, chainId: 42161, wallet, supportedChain: true, statefulSimulationVerified: true }), { allowed: true, reason: null });
});
