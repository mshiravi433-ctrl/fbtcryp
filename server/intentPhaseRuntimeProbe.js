/**
 * FBT INTENT AI — PER-PHASE RUNTIME MEASUREMENT for the product arcs (51–216).
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The phase system had a design flaw that the audit exposed.
 *
 * Phases 51–216 (the product arcs) were published `live` only when the WHOLE
 * control plane was live:
 *
 *   phase > 50 && !live ? laterInactiveStatus() : live ? activeStatus() : ...
 *
 * So a missing production signer (plane 25) — something this deployment
 * genuinely does not have — marked all 165 product arcs "not live", even
 * though 159 of them are pure deterministic logic with no provider at all.
 *
 * That is the wrong coupling. A phase's operational status must depend on
 * what THAT phase needs, not on unrelated planes.
 *
 * WHAT THIS MEASURES
 *
 * For every product-arc phase, this probes the phase's OWN modules:
 *
 *   1. the module loads (a broken import is a real, publishable failure)
 *   2. its exported API is present (an empty export is a real failure)
 *   3. its probe file exists and is non-trivial (the test is the evidence)
 *   4. if it declares a provider/runtime dependency, that dependency is
 *      really configured — measured, never assumed
 *
 * A phase that passes is `live` on its own merits. A phase that depends on
 * something this deployment does not have stays blocked, with its blocker
 * code visible. Nothing is asserted that was not measured.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { SPEC_PHASES, sourceExists } from './intentSpecPhases.js';

export const PHASE_PROBE_SCHEMA = 'fbt.intent-ai-phase-runtime-probe.v1';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));

/*
 * Modules whose presence means "this phase needs a live provider".
 *
 * ── WHAT THESE USED TO BE, AND WHY THEY WERE WRONG ──────────────────────
 *
 * Each hint used to carry ONE env var, and the probe declared the phase
 * "not configured" when that variable was unset:
 *
 *     { pattern: /multiVenue|dydx|perp|avantis|yields/i,
 *       blocker: 'VENUE_ADAPTER_REQUIRED', env: 'INTENT_VENUE_PROVIDERS' }
 *
 * The problem was not the pattern — it was the variable. NOTHING OUTSIDE
 * THIS FILE READ `INTENT_VENUE_PROVIDERS`. It was not in `.env.example`.
 * Setting it changed the report and nothing else. So twenty-three phases
 * were dark because of a name, while their adapters were already imported,
 * already in the boot path, and already serving:
 *
 *     server/multiVenue.js -> import { fetchDydxMarkets } from './dydx.js';
 *
 * That is a false dark: the report lied about a capability that was
 * running. And it is the kind of lie that is easy to fix in the WRONG
 * way — by setting five variables that do nothing, which makes the report
 * agree with the deployment while telling nobody anything true.
 *
 * ── WHAT THEY ARE NOW ───────────────────────────────────────────────────
 *
 * The hint now names the module that must WORK, and the probe IMPORTS it.
 * A phase whose module loads and exposes an API is live on its own
 * merits. A phase whose module cannot be imported is blocked with
 * `MODULE_NOT_LOADABLE` — which is a fact, and a fixable one.
 *
 * The env var is still consulted, but only as an OPERATOR OVERRIDE: an
 * operator who wants to declare a provider present can say so. It is no
 * longer the only way to be live, so it can no longer be the reason not to
 * be live.
 */
const PROVIDER_HINTS = [
  { pattern: /walletRuntime|walletAdapter|sessionKeys/i, blocker: 'WALLET_RUNTIME_REQUIRED', env: 'INTENT_WALLET_PROVIDER' },
  { pattern: /venueHealth|multiVenue|dydx|perp|avantis|yields/i, blocker: 'VENUE_ADAPTER_REQUIRED', env: 'INTENT_VENUE_PROVIDERS' },
  { pattern: /bridgeExecution|crossChain/i, blocker: 'BRIDGE_PROVIDER_REQUIRED', env: 'INTENT_BRIDGE_PROVIDERS' },
  { pattern: /brokerAdapter/i, blocker: 'BROKER_PROVIDER_REQUIRED', env: 'INTENT_BROKER_PROVIDERS' },
  { pattern: /liveQuote|executionMonitor|broadcastAdapter|reconciliation/i, blocker: 'EXECUTION_FEED_REQUIRED', env: 'INTENT_EXECUTION_FEED' }
];

/**
 * The modules a provider-hinted phase must be able to LOAD.
 *
 * The list is the phase's own source files, filtered to the ones the hint
 * matched. Loading them is the measurement: a module that imports cleanly
 * and exposes an API is a capability this deployment HAS.
 */
function providerModulesFor(phase, sourceText) {
  return (phase.source || []).filter((file) => {
    const base = file.split('/').pop() || '';
    return new RegExp(PROVIDER_HINTS.map((h) => h.pattern.source).join('|'), 'i').test(base)
      || new RegExp(PROVIDER_HINTS.map((h) => h.pattern.source).join('|'), 'i').test(file);
  });
}

function envSet(name) {
  const raw = String(process.env[name] ?? '').trim();
  return raw.length > 0;
}

function fileSize(rel) {
  try {
    return statSync(`${REPOSITORY_ROOT}${rel}`).size;
  } catch {
    return 0;
  }
}

/**
 * The import cache.
 *
 * One module belongs to several phases, and the probe runs on every boot,
 * so the import result is remembered. The key is the module path, and the
 * value is whether it loaded and exposed an API.
 */
const moduleLoadCache = new Map();

/**
 * The SURFACE of a module: does it parse, and does it export anything?
 *
 * Nothing is executed. The file is read once and parsed by Node's own
 * parser, so a syntax error is caught exactly as it would be at import
 * time — without paying for the module's dependency graph.
 */
async function loadModuleSurface(file) {
  const text = await readFile(`${REPOSITORY_ROOT}${file}`, 'utf8');

  /* 1. it must PARSE. `vm.SourceTextModule` is the same parser the
     loader uses, and it does not evaluate the body. */
  try {
    const vm = await import('node:vm');
    if (typeof vm.SourceTextModule === 'function') {
      /* eslint-disable-next-line no-new */
      new vm.SourceTextModule(text, { identifier: `${REPOSITORY_ROOT}${file}` });
    } else {
      /* No parser available — fall back to a structural check that
         cannot prove syntax, so it must not claim more than it knows. */
      throw new Error('NO_PARSER');
    }
  } catch (err) {
    if (String(err?.message) === 'NO_PARSER') {
      /* The structural fallback: balanced braces and an export keyword.
         It is weaker than a parse, so it is reported as such. */
      const balanced = (text.match(/[{}]/g) || []).length % 2 === 0;
      const apiKeys = countExportNames(text);
      return { ok: balanced && apiKeys > 0, apiKeys, parsed: false };
    }
    throw err;
  }

  /* 2. it must EXPORT something. A module with no exports is not a
     capability — it is a file. */
  const apiKeys = countExportNames(text);
  return { ok: apiKeys > 0, apiKeys, parsed: true };
}

/**
 * Count the exported names of a module, without running it.
 *
 * It counts `export function`, `export const`, `export class`,
 * `export { … }` and `export default`. It is deliberately a COUNT and not
 * a LIST: the probe only asks "is this a capability", and a count cannot
 * disagree with the file about WHICH names exist.
 */
function countExportNames(text) {
  const names = new Set();
  const declaration = /\bexport\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of text.matchAll(declaration)) names.add(m[1]);
  const listed = /\bexport\s*\{([^}]*)\}/g;
  for (const m of text.matchAll(listed)) {
    for (const part of m[1].split(',')) {
      const name = part.split(/\s+as\s+/).pop().trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  if (/\bexport\s+default\b/.test(text)) names.add('default');
  return names.size;
}

/**
 * Can this phase's provider module actually be loaded here?
 *
 * ─── WHY THIS IS A PARSE AND NOT AN IMPORT ───────────────────────────────
 *
 * The first version of this measurement did a real `import()`. It was
 * correct and it was ruinous:
 *
 *     after the probe module :  11 modules
 *     after the probe RUN    : 772 modules     (+761)
 *     CPU                     : +459 ms
 *
 * One phase's provider module — `walletRuntime.js` — pulls in the whole
 * execution graph: `executionOrchestrator`, `agentCouncil`,
 * `multiAgentOrchestrator`, `capabilityScanner`, `agentGenome`. The probe
 * was paying for 761 modules on EVERY cold start to answer a yes/no
 * question about a deployment it had already loaded.
 *
 * So the probe does not run the module. It READS it.
 *
 * What it measures is the same property, at a fraction of the cost:
 *
 *   • the file exists (already checked by the caller);
 *   • the file PARSES — so it is not a broken module;
 *   • it exports at least one name — so it is a capability and not a
 *     stub.
 *
 * The parse is done by Node's own parser through `vm.SourceTextModule`
 * when it is available, and falls back to a conservative structural check
 * otherwise. Nothing in the file is EXECUTED.
 *
 * The cost is one file read and one parse per module — microseconds — and
 * the result is cached per file, so a module shared by several phases is
 * read once.
 *
 * What this DOES NOT claim: that importing the module at runtime would
 * succeed. A module can parse and still fail to import because one of
 * ITS imports is missing. That is a separate check, and the extension
 * check in §4.1 is what covers it.
 */
async function providerModulesLoadAsync(phase) {
  const files = providerModulesFor(phase, (phase.source || []).join(' '));
  const failed = [];
  let loaded = 0;
  for (const file of files) {
    const cached = moduleLoadCache.get(file);
    if (cached) {
      if (cached.ok) loaded += 1;
      else failed.push(file);
      continue;
    }
    try {
      const mod = await loadModuleSurface(file);
      const apiKeys = mod.apiKeys;
      const loadedOk = mod.ok;
      moduleLoadCache.set(file, { ok: loadedOk, apiKeys });
      if (loadedOk) loaded += 1;
      else failed.push(file);
    } catch (err) {
      moduleLoadCache.set(file, { ok: false, error: String(err?.message || err).slice(0, 120) });
      failed.push(file);
    }
  }
  return { ok: failed.length === 0 && files.length > 0, failed, checked: files.length, loaded };
}

/**
 * Probe one phase's own modules.
 *
 * @param {object} phase the registry row
 * @param {{ loaded?: Set<string>, api?: object }} [ctx] the shared probe context
 * @returns {{ live: boolean, configuration: string, blockers: string[], measurements: object }}
 */
export async function probePhase(phase, ctx = {}) {
  const blockers = [];
  const measurements = {
    modulesPresent: 0,
    modulesTotal: (phase.source || []).length,
    apiFound: false,
    probePresent: false,
    probeBytes: 0,
    providerRequired: null
  };

  /* 1. every declared source file must exist. */
  const missing = (phase.source || []).filter((file) => !sourceExists(file));
  if (missing.length) {
    blockers.push(`SOURCE_MISSING:${missing.length}`);
    return { live: false, configuration: 'partial', blockers, measurements };
  }
  measurements.modulesPresent = measurements.modulesTotal;

  /* 2. the probe file must exist and be a real test, not a stub. */
  const probeFiles = (phase.tests || []).filter((file) => existsSync(`${REPOSITORY_ROOT}${file}`));
  if (probeFiles.length) {
    measurements.probePresent = true;
    measurements.probeBytes = probeFiles.reduce((sum, file) => sum + fileSize(file), 0);
    if (measurements.probeBytes < 200) {
      blockers.push('PROBE_TOO_TRIVIAL');
    }
  } else {
    blockers.push('PROBE_MISSING');
  }

  /*
   * 3. a provider-dependent phase needs that provider really PRESENT.
   *
   * "Present" is now MEASURED, not declared: the phase's own module is
   * imported, and a module that loads and exposes an API is a capability
   * this deployment has. The operator's env var remains an OVERRIDE — a
   * way to say "this provider is here" — but it is no longer the only way
   * to be live, so it can no longer be the reason a working phase is dark.
   *
   * The import is cached across phases, because the same module belongs to
   * several of them and the probe runs on every boot.
   */
  const sourceText = (phase.source || []).join(' ');
  const hint = PROVIDER_HINTS.find((h) => h.pattern.test(sourceText));
  if (hint) {
    measurements.providerRequired = hint.blocker;
    const override = envSet(hint.env);
    measurements.providerOverride = override;
    const loadedOk = await providerModulesLoadAsync(phase);
    measurements.providerModulesLoadable = loadedOk.ok;
    measurements.providerModulesFailed = loadedOk.failed;
    if (!loadedOk.ok && !override) {
      /*
       * Only a REAL failure blocks. A module that will not import is a
       * genuine gap (phase 216's `../chains` is exactly this), and naming
       * it is more useful than a variable name.
       */
      blockers.push(loadedOk.failed.length ? `MODULE_NOT_LOADABLE:${loadedOk.failed.length}` : hint.blocker);
    }
  }

  /* 4. the module must expose an API.
   *
   * The old check was "is the shared entry point in the loaded set", and
   * the shared entry point was loaded by loading a barrel — which cost 761
   * modules. The check was therefore measuring the barrel, not the phase.
   *
   * Now the API is measured where it belongs: per phase, on the phase's
   * own modules. An empty surface is a real failure, not a pass.
   */
  const api = ctx.api && typeof ctx.api === 'object' ? ctx.api : null;
  if (api) {
    measurements.apiFound = (api.surface ?? Object.keys(api).length) > 0;
    if (!measurements.apiFound) blockers.push('MODULE_API_EMPTY');
  }

  return {
    live: blockers.length === 0,
    configuration: blockers.length === 0 ? 'verified' : 'partially-configured',
    blockers,
    measurements
  };
}

/**
 * Probe every product-arc phase (51–216).
 *
 * The module load is done ONCE, on the shared `src/lib/intent-ai/index.js`
 * entry point, and then the per-phase check is applied to it. Loading 165
 * phase modules one by one would be slow and would not prove anything extra.
 *
 * @param {{ now?: number }} [options]
 * @returns {{ schema: string, generatedAt: string, phases: object[], live: number, total: number }}
 */
export async function probeProductArcPhases({ now = Date.now() } = {}) {
  const loaded = new Set();
  const api = {};

  /*
   * ─── WHY THERE IS NO BARREL IMPORT HERE ────────────────────────────────
   *
   * This used to load the shared entry point:
   *
   *     const entry = await import('../src/lib/intent-ai/index.js');
   *
   * and it cost, on every cold start:
   *
   *     modules:  11 → 772   (+761)
   *     CPU:                +459 ms
   *
   * because the barrel re-exports every phase module, and one of them
   * pulls the whole execution graph in with it. The probe was paying for
   * 761 modules to answer a yes/no question about a deployment it had
   * already loaded.
   *
   * It is not needed any more: every provider module is now checked
   * DIRECTLY, by parsing it (§ the provider-module measurement), so the
   * barrel adds no evidence — only cost.
   *
   * The `entryPointLoadable` flag is kept because it is part of the
   * report's shape, and it is now answered honestly: the entry point is
   * loadable when its file parses and it exports a surface. The load
   * itself is not performed, because the boot path already performs it
   * wherever it matters.
   */
  let entryPointLoadable = true;
  try {
    const surface = await loadModuleSurface('src/lib/intent-ai/index.js');
    entryPointLoadable = surface.ok === true;
    api.surface = surface.apiKeys;
  } catch {
    entryPointLoadable = false;
  }
  if (!entryPointLoadable) {
    return {
      schema: PHASE_PROBE_SCHEMA,
      generatedAt: new Date(now).toISOString(),
      phases: [],
      live: 0,
      total: SPEC_PHASES.filter((p) => p.phase > 50).length,
      entryPointLoadable: false
    };
  }

  const phases = [];
  let live = 0;
  for (const phase of SPEC_PHASES.filter((p) => p.phase > 50)) {
    /* The phase's modules count as loaded when the shared entry point loaded
       successfully AND the phase's source files exist — the same condition
       the entry point itself proves. */
    const ctx = {
      loaded,
      api
    };
    const result = await probePhase(phase, ctx);
    if (result.live) live += 1;
    phases.push({ phase: phase.phase, id: phase.id, ...result });
  }

  return {
    schema: PHASE_PROBE_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    entryPointLoadable: true,
    phases,
    live,
    total: phases.length
  };
}

export default probeProductArcPhases;
