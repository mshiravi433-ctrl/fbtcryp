/**
 * LAZY MODULE LOADING — the cold-start budget, spent on purpose.
 * ============================================================================
 *
 * WHY THIS EXISTS (2026-11-11)
 * ---------------------------------------------------------------------------
 * The deployment runs on Vercel Hobby, whose Fluid Active CPU allowance is
 * 4 hours per rolling 30 days — about EIGHT MINUTES OF CPU PER DAY. Every
 * millisecond of module compilation is taken out of that budget before a
 * single question has been answered.
 *
 * The measurement said the cold start was spending 588 ms of CPU before the
 * first request, and that the cost was NOT spread evenly:
 *
 *   · `ethers`                  168 ms  — the EVM signing/address library
 *   · `@solana/web3.js`          131 ms  — the Solana SDK
 *   · `express`                  81 ms  — needed always, cannot be deferred
 *   · everything else            ~200 ms — spread over 140 small modules
 *
 * So the two libraries that dominated the cold start were being compiled on
 * EVERY cold start — including the ones that serve `/api/health` and the
 * mission-control poll — to serve a handful of trading routes that a
 * dashboard poll never touches.
 *
 * ─── THE RULE THIS MODULE ENFORCES ─────────────────────────────────────────
 * A module is loaded WHEN IT IS FIRST NEEDED, not when the process starts.
 * That is the only definition of laziness that matters on a serverless
 * platform: the bill is per-invocation, so work that is not needed by THIS
 * invocation is not paid for by THIS invocation.
 *
 * ─── WHY A HELPER AND NOT A `await import()` IN EVERY ROUTE ─────────────────
 * Three reasons, all of them defects that would otherwise have to be fixed
 * at every call site:
 *
 *   1. SINGLE-FLIGHT. Ten requests arriving during the first import must
 *      share ONE import. Without it, a cold start with a burst of traffic
 *      compiles the same module ten times — the exact opposite of the point.
 *
 *   2. FAILURE IS PERMANENT-UNTIL-RETRY, AND VISIBLE. A module that fails
 *      to import must not poison the instance for its whole life: the next
 *      request tries again. And the error must name the module, because a
 *      bare "Cannot find module" at request time is very hard to trace back
 *      to a lazy mount.
 *
 *   3. THE ENTRY POINT OF A MODULE IS NOT ALWAYS ITS DEFAULT EXPORT. Some
 *      modules export named functions, some export a router, some export a
 *      factory. `mod?.default ?? mod?.router ?? mod` handles the first two;
 *      a named-export lookup handles the third. A helper that assumed
 *      `default` would have broken exactly the modules worth deferring.
 *
 * ─── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
 * Nothing about what a route does. The imported module is the same module,
 * with the same exports, called the same way. The only difference is WHEN
 * it is compiled — and that difference is invisible to every test that
 * exercises the route.
 */

/**
 * The registry of lazily-loaded modules.
 *
 * Key: a label that names the module (it appears in error messages and in
 * the report). Value: the loader.
 */
const registry = new Map();

/** The promises of in-flight loads, so a burst shares one import. */
const inflight = new Map();

/**
 * How many modules have been loaded, and how many failed.
 *
 * Kept because the cold-start report is the only place an operator can see
 * whether the deferral actually happened — and "the module was loaded at
 * 3:04 AM by a traffic spike" is a real thing that happens.
 */
const stats = { loads: 0, failures: 0, peakConcurrent: 0, current: 0 };

/**
 * Register a module for lazy loading.
 *
 * `label` must be unique — a duplicate label is a bug, not a convenience,
 * because the label is how a failure is traced. The helper throws on a
 * duplicate rather than silently overwriting.
 */
export function lazyModule(label, loader) {
  if (!label || typeof loader !== 'function') {
    throw new Error(`lazy-module:${label || '(no label)'}:INVALID_REGISTRATION`);
  }
  if (registry.has(label)) {
    throw new Error(`lazy-module:${label}:DUPLICATE_LABEL`);
  }
  registry.set(label, loader);
  return label;
}

/**
 * Load a registered module, or return the one already loaded.
 *
 * This is the whole point of the module: the caller awaits it and gets the
 * real module, whether it was loaded a millisecond ago or a week ago.
 */
export function loadModule(label) {
  if (!registry.has(label)) {
    return Promise.reject(new Error(`lazy-module:${label}:NOT_REGISTERED`));
  }
  if (inflight.has(label)) return inflight.get(label);

  stats.current += 1;
  stats.peakConcurrent = Math.max(stats.peakConcurrent, stats.current);

  const p = Promise.resolve()
    .then(() => registry.get(label)())
    .then((mod) => {
      stats.loads += 1;
      return mod;
    })
    .catch((err) => {
      stats.failures += 1;
      /* A failed import must be retryable: the next request tries again.
         A transient failure during a cold start must not poison the instance
         for its whole life. */
      err.message = `lazy-module:${label}:${err.message}`;
      throw err;
    })
    .finally(() => {
      stats.current -= 1;
      inflight.delete(label);
    });

  inflight.set(label, p);
  return p;
}

/**
 * Load a module and pick one of its exports.
 *
 * This is the shape almost every deferred call site needs: a named
 * function from a module that is not worth compiling on every cold start.
 *
 * The export is resolved AFTER the module is loaded, so a module that
 * re-exports under a different name fails loudly with the name that was
 * asked for — not with `undefined is not a function` fifty lines later.
 */
export async function loadExport(label, exportName) {
  const mod = await loadModule(label);
  if (exportName === undefined || exportName === null) {
    return mod?.default ?? mod;
  }
  const value = mod?.[exportName];
  if (value === undefined) {
    throw new Error(`lazy-module:${label}:MISSING_EXPORT:${exportName}`);
  }
  return value;
}

/**
 * A PROXY FUNCTION for one export of a lazily-loaded module.
 *
 * This is the ergonomic form, and it is what most call sites want:
 *
 *   const getBuySellCapabilities = lazyFn('buy-sell', 'getBuySellCapabilities');
 *   app.get('/api/buysell/capabilities', async (req, res) => {
 *     const caps = await getBuySellCapabilities();
 *     ...
 *   });
 *
 * The proxy is created eagerly (a closure — free), but the module behind it
 * is only compiled when the proxy is CALLED. A route that is never hit costs
 * nothing; a route that is hit costs exactly one import, shared with every
 * other route that needs the same module.
 *
 * The arguments are forwarded verbatim, so the call site reads exactly as
 * it did before the deferral. `this` is forwarded too, because a method
 * extracted from an object needs its receiver.
 */
export function lazyFn(label, exportName) {
  return function lazyCall(...args) {
    return loadExport(label, exportName).then((fn) => fn.apply(this, args));
  };
}

/**
 * The registry report, for the cold-start report.
 *
 * `loaded` names the modules that have actually been compiled — the proof
 * that the deferral happened rather than merely being intended.
 */
export function lazyModuleReport() {
  return {
    registered: registry.size,
    loaded: stats.loads,
    failures: stats.failures,
    inFlight: inflight.size,
    peakConcurrent: stats.peakConcurrent,
    labels: [...registry.keys()]
  };
}

/**
 * Forget a registration (tests). Does NOT unload an already-imported module —
 * Node has no way to unload a module, and pretending otherwise would be a
 * lie. The report counters are reset so a test can assert on a clean slate.
 */
export function __resetLazyModuleRegistryForTests() {
  registry.clear();
  inflight.clear();
  stats.loads = 0;
  stats.failures = 0;
  stats.peakConcurrent = 0;
  stats.current = 0;
}
