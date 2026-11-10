/**
 * THE COLD-START BASELINE — must be the FIRST import of the function.
 * ============================================================================
 *
 * `process.cpuUsage()` needs a reference point taken as early as possible to
 * measure what a fresh instance costs before it can answer anything. In ESM,
 * modules are evaluated in the order their `import` declarations appear, so a
 * one-line module imported first observes the earliest moment a module is
 * allowed to run. `api/index.js` therefore imports this BEFORE the app.
 *
 * Why the number matters: a serverless instance pays module evaluation once,
 * before the first request, and Fluid Active CPU bills it. When traffic is
 * low — a free-tier site is exactly that — cold starts can be the single
 * largest line item, and no per-route table can show it because no route ran
 * yet. `/api/usage/cpu` reports it as `coldStartCpuMs`.
 *
 * Deliberately silent and dependency-free: it must not be able to slow down,
 * or fail, the thing it is measuring.
 */
if (!globalThis.__fbtColdStartCpu && typeof process?.cpuUsage === 'function') {
  globalThis.__fbtColdStartCpu = process.cpuUsage();
}

export default globalThis.__fbtColdStartCpu || null;
