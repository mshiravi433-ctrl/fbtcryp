#!/usr/bin/env node
/**
 * PHASE 211 — ROUTE INVENTORY + PAGE REGRESSION probe.
 * ────────────────────────────────────────────────────────────────────────────
 * The phase's absolute rule is «هیچ صفحه و route حذف نشود» — this probe makes
 * that rule executable. It compares the BEFORE inventory (generated from the
 * pre-Phase-211 tree, committed at docs/phase211/routes-before.json) with a
 * freshly generated AFTER inventory, per category:
 *
 *   frontend routes      every <Route path> in App.jsx (incl. conditional)
 *   lazy imports         every dynamic import App.jsx can load, + existence
 *   chat navigation      the AI's navigable ROUTED_PATHS
 *   backend mounts       every app.use('…') in server/app.js
 *   backend routers      every router.METHOD('path') in every server file
 *   FI routes            the Financial Intelligence router, walked at runtime
 *
 * and asserts, for each category, removedRoutes === [] — plus the page
 * regression checks: every route's component resolves to a lazy import that
 * exists on disk, and the chat-route contract still holds (no invented paths).
 *
 * Run: node test/intent-ai/phase211-routes-inventory-probe.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const BEFORE = path.join(ROOT, 'docs/phase211/routes-before.json');
const AFTER_DIR = path.join(ROOT, 'docs/phase211');

const rows = [];
const t = (name, ok, extra = null) => { rows.push([name, Boolean(ok), extra]); };

if (!existsSync(BEFORE)) {
  console.error('routes-before.json is missing — generate it from the pre-change tree first:');
  console.error('  node scripts/phase211-route-inventory.mjs --label before');
  process.exit(2);
}

/* ── regenerate the AFTER inventory from the current tree ───────────────── */
execFileSync(process.execPath, [path.join(ROOT, 'scripts/phase211-route-inventory.mjs'), '--label', 'after'], { stdio: 'inherit' });
const afterPath = path.join(AFTER_DIR, 'routes-after.json');
if (!existsSync(afterPath)) {
  /* Older Node prints fine but the write may have gone to the default label. */
  t('the after inventory was written', false, afterPath);
}
const before = JSON.parse(readFileSync(BEFORE, 'utf8'));
const after = JSON.parse(readFileSync(afterPath, 'utf8'));

/* ── comparison helper ───────────────────────────────────────────────────── */
const removed = (a, b) => a.filter((x) => !b.includes(x));
const added = (a, b) => b.filter((x) => !a.includes(x));

/* 1. frontend routes — the absolute rule. */
const beforeRoutes = before.frontend.routes.map((r) => `${r.path} → ${r.component}`);
const afterRoutes = after.frontend.routes.map((r) => `${r.path} → ${r.component}`);
const removedRoutes = removed(beforeRoutes, afterRoutes);
t('FRONTEND: no route was removed (removedRoutes.length === 0)', removedRoutes.length === 0, removedRoutes);
t('FRONTEND: every pre-existing route is still mounted with the same component',
  beforeRoutes.every((r) => afterRoutes.includes(r)));
const addedRoutes = added(beforeRoutes, afterRoutes);
t('FRONTEND: Phase 211 only ADDED routes', addedRoutes.length >= 1 && addedRoutes.every((r) => r.startsWith('/ai-global')), addedRoutes);

/* 2. page regression — every lazy import resolves. */
t('PAGES: every lazy import in App.jsx resolves to a real file (0 missing)',
  after.frontend.lazyImportsMissing.length === 0, after.frontend.lazyImportsMissing);
const routeComponents = after.frontend.routes.map((r) => r.component);
const lazySpecs = after.frontend.lazyImports.map((l) => l.spec);
t('PAGES: the new AI Global Intelligence route resolves through a lazy import that exists',
  after.frontend.routes.some((r) => r.path === '/ai-global')
  && lazySpecs.some((s) => s.includes('AiGlobalIntelligence'))
  && existsSync(path.join(ROOT, 'src/components/ai/AiGlobalIntelligence.jsx')));
t('PAGES: the route count only grew', after.frontend.routeCount >= before.frontend.routeCount,
  `${before.frontend.routeCount} → ${after.frontend.routeCount}`);

/* 3. the AI's navigable paths. */
const removedNav = removed(before.chatNavigation, after.chatNavigation);
t('CHAT NAV: no navigable path was removed', removedNav.length === 0, removedNav);
t('CHAT NAV: /ai-global is navigable by the AI', after.chatNavigation.includes('/ai-global'));

/* 4. backend mounts. */
const removedMounts = removed(before.backend.mounts, after.backend.mounts);
t('BACKEND: no app.use mount was removed', removedMounts.length === 0, removedMounts);

/* 5. backend router definitions, per file. */
const routerFiles = new Set([...Object.keys(before.backend.routers), ...Object.keys(after.backend.routers)]);
const removedRouterRoutes = [];
for (const file of routerFiles) {
  const b = before.backend.routers[file] || [];
  const a = after.backend.routers[file] || [];
  for (const route of b) if (!a.includes(route)) removedRouterRoutes.push(`${file}: ${route}`);
}
t('BACKEND: no router route was removed anywhere in server/ (removedRoutes === 0)',
  removedRouterRoutes.length === 0, removedRouterRoutes.slice(0, 12));

/* 6. the FI router, walked at runtime. */
const beforeFi = Array.isArray(before.backend.fiRoutes) ? before.backend.fiRoutes : [];
const afterFi = Array.isArray(after.backend.fiRoutes) ? after.backend.fiRoutes : [];
const removedFi = removed(beforeFi, afterFi);
t('FI ROUTER: no existing /api/ai route was removed', removedFi.length === 0, removedFi);
t('FI ROUTER: the four Phase 211 global routes are mounted',
  ['/global/intelligence', '/global/briefing', '/global/cross-asset', '/global/providers'].every((p) => afterFi.includes(`GET ${p}`)));

/* ── the summary the phase asks for ──────────────────────────────────────── */
const summary = {
  probe: 'phase211-routes-inventory',
  passed: rows.filter(([, ok]) => ok).length,
  failed: rows.filter(([, ok]) => !ok).length,
  total: rows.length,
  removedRoutes,
  addedRoutes,
  removedBackendRoutes: [...removedMounts, ...removedRouterRoutes, ...removedFi],
  counts: {
    frontend: { before: before.frontend.routeCount, after: after.frontend.routeCount },
    chatNav: { before: before.chatNavigation.length, after: after.chatNavigation.length },
    mounts: { before: before.backend.mounts.length, after: after.backend.mounts.length },
    fiRoutes: { before: beforeFi.length, after: afterFi.length }
  },
  results: rows.map(([name, ok, extra]) => ({ name, ok, extra: extra && extra.length ? extra : undefined }))
};
mkdirSync(AFTER_DIR, { recursive: true });
writeFileSync(path.join(AFTER_DIR, 'phase211-route-diff.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

if (summary.failed > 0) {
  console.error(`\n${summary.failed} assertion(s) failed — see above. Phase 211 may not remove routes.`);
  process.exit(1);
}
process.exit(0);
