/**
 * IS THE PHASE ACTUALLY WIRED TO THE AI? (2026-11-12)
 * ===========================================================================
 *
 * The runtime probe answers a WEAK question: "do this phase's files exist
 * and is its provider env var set?" That is a statement about the
 * repository, not about the running application.
 *
 * A phase can pass that probe and still be unreachable: no route calls it,
 * no module imports it, and nobody can ask it anything. The registry's
 * "implemented" flag has the same weakness — it is a fact about FILES.
 *
 * This harness measures the STRONGER question:
 *
 *   · which phase modules are actually IMPORTED by a live server module?
 *   · which phase modules are reachable from a mounted ROUTE?
 *   · which of those routes reach a REASONING module (the AI), as opposed
 *     to only computing?
 *
 * The unit is the IMPORT GRAPH, because that is what the serverless
 * platform actually pays for: a module nobody imports costs nothing, and a
 * module the server imports on every cold start costs the import CPU on
 * every invocation.
 *
 * Usage:
 *   node scripts/measure-phase-wiring.mjs
 *   node scripts/measure-phase-wiring.mjs --json
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AS_JSON = process.argv.includes('--json');
const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Modules that make something REASONING rather than merely computed. */
const REASONING_MARKERS = [
  'server/aiGateway.js',
  'server/aiCollaboration.js',
  'server/aiInternalReasoner.js',
  'server/aiOrchestrator.js',
  'server/ci/brain.js',
  'src/lib/central/intent.js',
  'src/lib/intent-ai/os/knowledgeCenter.js',
  'src/lib/neuromorphic'
];

/** The routes that serve the AI. A phase that only these reach is dark. */
const AI_ROUTE_MARKERS = [
  '/api/ai/', '/api/brain/', '/api/ask', '/api/brief', '/api/outlook',
  '/api/cron/', '/api/scenario/', '/api/forecast', '/api/lab/'
];

const { SPEC_PHASES } = await import('../server/intentSpecPhases.js');

/* ── the server module graph ──────────────────────────────────────────── */
function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'coverage', '.next'].includes(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

const serverFiles = [
  ...walk(join(ROOT, 'server')),
  ...walk(join(ROOT, 'src'))
];

/** Which files IMPORT a given module path (any of its basenames). */
function importedBy(target) {
  const base = target.split('/').pop().replace(/\.(m?js)$/, '');
  const hits = new Set();
  for (const file of serverFiles) {
    if (file.endsWith(target)) continue;
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    /*
     * A REAL import, and only a real import.
     *
     * The first version of this harness matched the file's BASENAME anywhere
     * in the file's text, and it reported six "connected" phases. Every one
     * of them was a false positive: the basename appeared inside a comment
     * or a string, never in an import statement. The measurement said
     * "connected" about six phases that no route had ever touched.
     *
     * So the pattern now demands the ESM form — `from '<path>'` or a dynamic
     * `import('<path>')` — and the path must END with the basename, so a
     * directory import does not match a file that happens to share a word.
     */
    const re = new RegExp(
      `(?:from\\s*['"][^'"]*[/\\\\]?${base}\\.(?:m?js)['"]|import\\(\\s*['"][^'"]*[/\\\\]?${base}\\.(?:m?js)['"]\\s*\\))`
    );
    if (re.test(text)) hits.add(relative(ROOT, file));
  }
  return [...hits];
}

/** Which ROUTES mention this module or its exported names? */
function reachableFromRoutes(target) {
  const base = target.split('/').pop().replace(/\.(m?js)$/, '');
  const hits = new Set();
  for (const file of serverFiles) {
    const rel = relative(ROOT, file);
    if (!rel.startsWith('server/')) continue;
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    if (!/app\.(get|post|put|patch|delete|all|use)\(/.test(text)) continue;
    if (text.includes(base)) hits.add(rel);
  }
  return [...hits];
}

/* ── the AI surface ───────────────────────────────────────────────────── */
const appFile = readFileSync(join(ROOT, 'server/app.js'), 'utf8');
const routeLines = appFile.split('\n');
const routes = [];
for (let i = 0; i < routeLines.length; i += 1) {
  const m = routeLines[i].match(/app\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/);
  if (m) routes.push({ method: m[1].toUpperCase(), path: m[2], line: i + 1 });
}
const aiRoutes = routes.filter((r) => AI_ROUTE_MARKERS.some((marker) => r.path.includes(marker)));

/* Which AI route handler bodies reach a reasoning module? A route whose
   handler never names the gateway is not connected to the AI. */
function routeTouchesReasoning(route) {
  const window = routeLines.slice(route.line - 1, route.line + 40).join('\n');
  return REASONING_MARKERS.filter((marker) => window.includes(marker.split('/').pop().replace(/\.js$/, '')));
}

/* ── the report ───────────────────────────────────────────────────────── */
const rows = SPEC_PHASES.map((phase) => {
  const importers = new Set();
  const routeFiles = new Set();
  for (const src of phase.source) {
    for (const hit of importedBy(src)) importers.add(hit);
    for (const hit of reachableFromRoutes(src)) routeFiles.add(hit);
  }
  /* A phase is CONNECTED when some live server module imports it, and a
     route file is among the importers (or the importer is a route module
     that the app mounts). */
  const connected = importers.size > 0;
  const inRoute = [...importers].some((f) => f.startsWith('server/app.js') || f.startsWith('server/ci/api.js'));
  /*
   * THE ENTRY-POINT TRAP
   * -------------------
   * `src/lib/intent-ai/index.js` re-exports every phase module. So a phase
   * imported ONLY by the entry point is imported by a barrel file that
   * nothing on the request path may ever use — the phase is "reachable"
   * in the way a book on a shelf is reachable.
   *
   * So the importers are SPLIT:
   *
   *   · BARREL importers  — the entry point and similar re-export files.
   *     They prove the module LOADS, nothing more.
   *   · LIVE importers    — a server module that a mounted route uses.
   *     These prove the phase is actually ON the request path.
   *
   * Only the second group counts as connected.
   */
  const BARREL_FILES = new Set([
    'src/lib/intent-ai/index.js',
    'src/lib/central/index.js'
  ]);
  const liveImporters = [...importers].filter((f) => !BARREL_FILES.has(f));
  const barrelOnly = liveImporters.length === 0 && importers.length > 0;

  /* Is the phase on a path that reaches the AI? The importer must be a
     server module that is itself imported by a route file. */
  const routeImporters = liveImporters.filter((f) => f.startsWith('server/'));
  const reasoningImports = routeImporters.filter((f) =>
    REASONING_MARKERS.some((m) => f.endsWith(m) || f.includes(m.split('/').pop().replace('.js', ''))));

  return {
    phase: phase.phase,
    id: phase.id,
    connected,
    barrelOnly,
    inRoute,
    importers: [...importers].slice(0, 6),
    importerCount: importers.size,
    liveImporters: liveImporters.slice(0, 6),
    liveImporterCount: liveImporters.length,
    routeImporters: routeImporters.slice(0, 4),
    routeFiles: [...routeFiles].slice(0, 4),
    reasoningImports: reasoningImports.slice(0, 4),
    connectedToAI: reasoningImports.length > 0
  };
});

const summary = {
  schema: 'fbt.phase-wiring.v1',
  measuredAt: new Date().toISOString(),
  server: {
    modulesScanned: serverFiles.length,
    routesFound: routes.length,
    aiRoutes: aiRoutes.length
  },
  aiRoutes: aiRoutes.map((r) => ({
    path: r.path,
    method: r.method,
    reasoning: routeTouchesReasoning(r)
  })),
  counts: {
    phases: rows.length,
    /* imported by ANY live module (including the barrel) */
    imported: rows.filter((r) => r.connected).length,
    /* imported ONLY by a barrel — loads, but is on no request path */
    barrelOnly: rows.filter((r) => r.barrelOnly).length,
    /* imported by a live NON-barrel module — the phase is on a real path */
    live: rows.filter((r) => r.liveImporterCount > 0).length,
    /* imported by a SERVER module — the phase is on the backend path */
    onBackend: rows.filter((r) => r.routeImporters.length > 0).length,
    /* AND that server module reaches a reasoning module — the AI */
    connectedToAI: rows.filter((r) => r.connectedToAI).length,
    /* imported by nothing at all */
    dark: rows.filter((r) => !r.connected).length
  },
  rows
};

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('\nPHASE WIRING — measured against the real import graph\n');
  console.log(`  server modules scanned     ${summary.server.modulesScanned}`);
  console.log(`  routes found               ${summary.server.routesFound}`);
  console.log(`  AI-serving routes          ${summary.server.aiRoutes}`);
  console.log('');
  console.log('PHASES');
  console.log(`  total                          ${summary.counts.phases}`);
  console.log(`  imported by SOMETHING           ${summary.counts.imported}`);
  console.log(`  imported ONLY by a barrel       ${summary.counts.barrelOnly}   ← loads, on no request path`);
  console.log(`  imported by a live module       ${summary.counts.live}`);
  console.log(`  on the BACKEND path             ${summary.counts.onBackend}`);
  console.log(`  reaching a REASONING module     ${summary.counts.connectedToAI}   ← connected to the AI`);
  console.log(`  imported by nothing at all      ${summary.counts.dark}`);
  console.log('');
  console.log('THE AI ROUTES — and whether each one reaches a reasoning module');
  for (const r of summary.aiRoutes) {
    console.log(`  ${(r.method + ' ' + r.path).padEnd(42)} ${r.reasoning.length ? r.reasoning.join(', ') : '— (no reasoning module)'}`);
  }
  console.log('');
  console.log('PHASES CONNECTED TO THE AI');
  for (const r of rows.filter((x) => x.connectedToAI)) {
    console.log(`  ${String(r.phase).padStart(4)}  ${r.id.padEnd(42)} ${r.reasoningImports.join(', ')}`);
  }
}
