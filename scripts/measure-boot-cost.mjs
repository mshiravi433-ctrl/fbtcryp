/**
 * THE COLD-START COST OF THE BRAIN
 * ---------------------------------------------------------------------------
 * The brain's boot is on the critical path of every serverless instance,
 * and §5 of docs/PHASE-CPU-AND-DARK-PHASES.md exists to protect it. This
 * script measures it, so a change that costs a hundred milliseconds of
 * boot is visible instead of inferred.
 *
 * It reports wall time, CPU time, heap and RSS for the IMPORT alone —
 * because the import is what every cold instance pays, whether or not
 * the turn asks for anything.
 *
 * Fully offline: nothing is fetched, and no provider is contacted.
 */

import { performance } from 'node:perf_hooks';

const started = performance.now();
const cpuBefore = process.cpuUsage();

const brain = await import('../server/ci/brain.js');
const stateStore = await import('../server/ci/stateStore.js');
const modules = await import('../server/ci/modules.js');
const schema = await import('../src/lib/central/schema.js');

const wallMs = performance.now() - started;
const cpu = process.cpuUsage(cpuBefore);
const cpuMs = (cpu.user + cpu.system) / 1000;
const mem = process.memoryUsage();

const store = stateStore.createCentralStateStore();
const created = modules.createModules({
  owner: 'boot-probe',
  readState: () => null,
  state: () => ({ sections: {} }),
  writeState: () => null,
  readContext: () => ({}),
  writeContext: () => null,
  capabilities: {},
  health: {},
  events: { publish: () => {}, subscribe: () => {}, recent: () => [] }
});

console.log(JSON.stringify({
  wallMs: Math.round(wallMs),
  cpuMs: Math.round(cpuMs),
  heapMb: Math.round(mem.heapUsed / 1048576),
  rssMb: Math.round(mem.rss / 1048576),
  modules: Array.isArray(created) ? created.length : null,
  moduleIds: schema.MODULE_IDS.length,
  eventTypes: schema.EVENT_TYPES.length,
  stateSections: Object.keys(schema.STATE_SECTIONS).length,
  brainExports: Object.keys(brain).length
}, null, 2));
