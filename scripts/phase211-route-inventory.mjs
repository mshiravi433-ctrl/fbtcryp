#!/usr/bin/env node
/**
 * PHASE 211 — route inventory (the phase's §17 safety instrument).
 * ---------------------------------------------------------------------------
 * This script is run TWICE:
 *
 *   1. BEFORE any Phase 211 change  → docs/phase211/routes-before.json
 *   2. AFTER  any Phase 211 change  → docs/phase211/routes-after.json
 *
 * and the phase probe then asserts, per category, that `removedRoutes` is
 * empty. Phase 211 may ADD routes (it does), but it may never remove one.
 *
 * What is inventoried — every surface a page or API route can live on:
 *
 *   frontend.routes        every <Route path="…"> in src/App.jsx, with the
 *                          component it mounts (including conditional
 *                          SPECULATION_ENABLED routes — a route that is
 *                          disabled in a build still EXISTS in the router)
 *   frontend.lazyImports   every dynamic import src/App.jsx lazy-loads, plus
 *                          whether the target file exists (page regression
 *                          check #1: the lazy import must resolve)
 *   frontend.chatNav       ROUTED_PATHS in src/lib/intent-ai/autonomy/chatRoutes.js
 *                          — the paths the AI is allowed to navigate to
 *   backend.mounts         every app.use('…') mount in server/app.js
 *   backend.routers        every router.METHOD('path') definition found in
 *                          every server file (static parse; catches renames
 *                          and deletions anywhere in the API surface)
 *   backend.fiRoutes       the Financial Intelligence router's routes, walked
 *                          from a real Express router instance (runtime truth,
 *                          not a regex)
 *
 * Usage: node scripts/phase211-route-inventory.mjs [--out path] [--label before|after]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'inventory';
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const OUT = outArg || path.join(ROOT, 'docs', 'phase211', `routes-${label}.json`);

/* ── helpers ─────────────────────────────────────────────────────────── */

const read = (p) => {
  try { return readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; }
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.out') continue;
      walk(full, out);
    } else if (name.endsWith('.js') || name.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

/* ── 1. frontend routes: <Route path="…" element={<X />} /> ─────────── */

function frontendRoutes() {
  const src = read('src/App.jsx');
  const routes = [];
  const routeRe = /<Route\s+path="([^"]+)"\s+element=\{<([A-Za-z0-9_]+)[^>]*\/?>\}/g;
  let m;
  while ((m = routeRe.exec(src)) !== null) {
    routes.push({ path: m[1], component: m[2] });
  }
  /* Nested routes (<Route path="marketplace" …> inside a shell) have no
     leading slash; keep them as-is — they are still routes that must survive. */
  const nestedRe = /<Route\s+path="([^"]+)"\s+element=\{<([A-Za-z0-9_]+)[^>]*\/?>\}/g;
  while ((m = nestedRe.exec(src)) !== null) {
    if (!routes.some((r) => r.path === m[1] && r.component === m[2])) {
      routes.push({ path: m[1], component: m[2] });
    }
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));

  /* lazy imports: lazyRetry(() => import('…')) and plain lazy(() => import('…')) */
  const lazy = [];
  const lazyRe = /(?:lazyRetry|lazy)\(\s*\(\)\s*=>\s*import\((['"])([^'"]+)\1\)/g;
  while ((m = lazyRe.exec(src)) !== null) {
    const spec = m[2];
    const resolved = path.join(ROOT, 'src', spec.replace(/^\.\//, '').replace(/^\.\.\//, ''));
    const candidates = [resolved, `${resolved}.jsx`, `${resolved}.js`, path.join(resolved, 'index.jsx'), path.join(resolved, 'index.js')];
    lazy.push({ spec, exists: candidates.some((c) => existsSync(c)) });
  }
  lazy.sort((a, b) => a.spec.localeCompare(b.spec));
  return { routes, lazyImports: lazy };
}

/* ── 2. the AI's navigable paths (chatRoutes ROUTED_PATHS) ──────────── */

function chatNavigation() {
  const src = read('src/lib/intent-ai/autonomy/chatRoutes.js');
  const paths = [];
  const re = /'(\/[^']*)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1].startsWith('/')) paths.push(m[1]);
  }
  return [...new Set(paths)].sort();
}

/* ── 3. backend mounts + router definitions (static parse) ──────────── */

function backendSurfaceStatic() {
  const mounts = [];
  const appSrc = read('server/app.js');
  let m;
  const mountRe = /app\.use\(\s*(['"`])([^'"`]+)\1/g;
  while ((m = mountRe.exec(appSrc)) !== null) mounts.push(m[2]);
  mounts.sort();

  const routers = {};
  const files = walk(path.join(ROOT, 'server'));
  const methodRe = /\b(?:router|app|api)\.(get|post|put|patch|delete|all|use)\(\s*(['"`])([^'"`]+)\2/g;
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const src = (() => { try { return readFileSync(file, 'utf8'); } catch { return ''; } })();
    if (!src) continue;
    const rows = [];
    let mm;
    while ((mm = methodRe.exec(src)) !== null) {
      rows.push(`${mm[1].toUpperCase()} ${mm[3]}`);
    }
    if (rows.length) routers[rel] = [...new Set(rows)].sort();
  }
  return { mounts, routers };
}

/* ── 4. the FI router, walked at runtime from a real Express instance ── */

async function fiRoutes() {
  try {
    const { createFiRouter } = await import('../server/fios/router.js');
    const stubFi = new Proxy({}, { get: () => () => ({ ok: true }) });
    const router = createFiRouter({ fi: stubFi, ownerFor: () => 'dev:inventory', log: () => {} });
    const rows = [];
    for (const layer of router.stack || []) {
      const r = layer?.route;
      if (r?.path) {
        const methods = r.methods ? Object.keys(r.methods).map((x) => x.toUpperCase()) : (r.stack || []).map(() => 'USE');
        for (const method of methods) rows.push(`${method} ${r.path}`);
      }
    }
    return [...new Set(rows)].sort();
  } catch (err) {
    return { error: String(err?.message || err).slice(0, 200) };
  }
}

/* ── assemble ─────────────────────────────────────────────────────────── */

async function backendSurfaceWithFi() {
  const surface = backendSurfaceStatic();
  surface.fiRoutes = await fiRoutes();
  return surface;
}

const frontend = frontendRoutes();
const backendSurface = await backendSurfaceWithFi();
const inventory = {
  schema: 'fbt.phase211.route-inventory.v1',
  label,
  generatedAt: new Date().toISOString(),
  frontend: {
    routeCount: frontend.routes.length,
    routes: frontend.routes,
    lazyImportCount: frontend.lazyImports.length,
    lazyImportsMissing: frontend.lazyImports.filter((l) => !l.exists).map((l) => l.spec),
    lazyImports: frontend.lazyImports
  },
  chatNavigation: chatNavigation(),
  backend: backendSurface
};

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(inventory, null, 2)}\n`);
const missing = inventory.frontend.lazyImportsMissing;
console.log(`▸ ${label}: ${inventory.frontend.routeCount} frontend routes, ${inventory.frontend.lazyImportCount} lazy imports (${missing.length} missing), ${inventory.chatNavigation.length} chat-nav paths, ${inventory.backend.mounts.length} mounts, ${Object.keys(inventory.backend.routers).length} router files`);
console.log(`  → ${path.relative(ROOT, OUT)}`);
if (missing.length) console.log(`  ⚠ missing lazy imports: ${missing.join(', ')}`);
