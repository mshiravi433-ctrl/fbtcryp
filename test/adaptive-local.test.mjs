import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGovernorPolicy } from '../src/lib/neuromorphic/hardwareGovernor.js';

const capable = { cpuCores: 8, webgpuAvailable: true, tabVisible: true, swarmOptIn: true };
test('325 governor respects user mode, device guards and background', () => {
  assert.equal(evaluateGovernorPolicy({ ...capable, computeMode: 'balanced' }).swarmCloneBudget, 2);
  const eco = evaluateGovernorPolicy({ ...capable, computeMode: 'eco' });
  assert.equal(eco.swarmCloneBudget, 0);
  assert.equal(eco.allowPlasticity, false);
  assert.equal(evaluateGovernorPolicy({ ...capable, paused: true }).allowInference, false);
  assert.equal(evaluateGovernorPolicy({ ...capable, tabVisible: false }).allowInference, false);
  assert.equal(evaluateGovernorPolicy({ ...capable, batteryCharging: false, batteryLevel: 0.1 }).swarmCloneBudget, 0);
  assert.equal(evaluateGovernorPolicy({ ...capable, emaTickMs: 19 }).swarmCloneBudget, 0);
});

test('worker module serializes messages, enforces guards and does not promote research candidates in Node', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { hardwareConcurrency: 8, deviceMemory: 8 } });
  const waiters = new Map();
  globalThis.self = { postMessage(message) {
    const resolve = waiters.get(message.id);
    if (resolve) { waiters.delete(message.id); resolve(message); }
  } };
  await import('../src/lib/neuromorphic/neuromorphic.worker.js');
  const env = { tabVisible: true, battery: { supported: false, charging: null, level: null } };
  const send = (type, id, fields = {}) => {
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`worker timeout: ${id}`)), 10000);
      waiters.set(id, (message) => { clearTimeout(timeout); resolve(message); });
    });
    self.onmessage({ data: { id, type, environment: env, computeMode: 'balanced', ...fields } });
    return result;
  };
  const init = await send('init', 'init', { paused: false, swarmOptIn: true });
  assert.equal(init.ok, true);
  assert.equal(init.backend, 'cpu-float32');
  const candles = Array.from({ length: 48 }, (_, i) => {
    const c = 100 + i + Math.sin(i / 2);
    return { time: i, open: c - 0.4, high: c + 1, low: c - 1, close: c };
  });
  const hidden = await send('tick', 'hidden', { candles, environment: { ...env, tabVisible: false } });
  assert.equal(hidden.skipped, true);
  const eco = await send('evolve', 'eco', { candles, computeMode: 'eco' });
  assert.equal(eco.ok, false);
  assert.equal(eco.reason, 'USER_ECO');
  const research = await send('evolve', 'research', { candles });
  assert.equal(research.ok, true);
  assert.equal(research.evolution.candidateApplied, false);
  assert.equal(research.evolution.validation, 'selection-sample-only');
  assert.equal('deltaPacket' in research.evolution, false);
  const pause = send('configure', 'pause', { paused: true, swarmOptIn: true });
  const afterPause = send('evolve', 'paused', { candles });
  assert.equal((await pause).governor.mode, 'PAUSED');
  assert.equal((await afterPause).reason, 'USER_PAUSED');
  delete globalThis.self;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
});
