/**
 * FBT INTENT AI — CHAT ROUTE CONTRACT probe.
 * ---------------------------------------------------------------------------
 * The user report this locks down:
 *   «می‌زنم مرکز عملیات و گزینه باز کردن را می‌زنم، کار نمی‌کنه.»
 *
 * Three separate dead targets were found by reading, not by testing:
 *   • `/intent?tab=ops` — the page at /intent never read `?tab` at all, so the
 *     "باز کن" chip navigated to the same pathname and nothing moved;
 *   • `/calm`, `/lend`, `/futures` — emitted by the AI layers, absent from the
 *     router, so they fell through to the catch-all and rendered Market;
 *   • `/market` — a path that does not exist, saved only by that catch-all.
 *
 * This probe makes the whole class impossible to reintroduce. It reads the REAL
 * router table out of src/App.jsx (not a copy), reads every route literal the
 * AI layers emit, and asserts each one either lands on a mounted route or
 * resolves to an in-page target the chat can perform. A future edit that
 * invents a route fails here instead of shipping a button that looks dead.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ROUTED_PATHS,
  INTENT_TAB_TARGETS,
  isRoutedPath,
  resolveChatRoute,
  splitRoute
} from '../../src/lib/intent-ai/autonomy/chatRoutes.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const results = [];
const check = (name, ok, extra = null) => { results.push({ name, ok: Boolean(ok), extra }); };

/* ── 1. the real router table, parsed out of App.jsx ───────────────────── */

const appSource = read('src/App.jsx');
/* The catch-all (`path="*"`) is not a target — it is the reason a bad route
   looks like it works, so it is deliberately excluded from the contract. */
const routerPaths = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== '*');
check('App.jsx router table was readable and non-trivial', routerPaths.length >= 40, `found ${routerPaths.length}`);

const missingFromContract = routerPaths.filter((p) => !ROUTED_PATHS.includes(p));
const extraInContract = ROUTED_PATHS.filter((p) => !routerPaths.includes(p));
check('every mounted route is present in the chat route contract',
  missingFromContract.length === 0, missingFromContract.join(', '));
check('the chat route contract invents no route of its own',
  extraInContract.length === 0, extraInContract.join(', '));

/* ── 2. every route literal the AI layers emit must land somewhere ─────── */

const SOURCES = [
  'src/lib/intent-ai/os/humanResponse.js',
  'src/lib/intent-ai/os/moduleRouter.js',
  'src/lib/intent-ai/os/intentUnderstanding.js',
  'src/lib/intent-ai/os/upgrade7/financialContext.js',
  'src/lib/intent-ai/autonomy/chatRoutes.js'
];

const emitted = new Map(); // pathname -> [{ file, raw }]
for (const rel of SOURCES) {
  const src = read(rel);
  /* `route: '/x'` and `'/x?tab=y'` and template literals with a fixed head. */
  const literals = [
    ...src.matchAll(/route:\s*'([^']+)'/g),
    ...src.matchAll(/route:\s*`([^`$]+)`/g),
    ...src.matchAll(/['"](\/(?:swap|farm|loan|stocks|perp|solana|portfolio|wallet|earn|signals|orders|buy|vault|bridge|news|nft|shop|explore|intent|market|calm|lend|futures|dydx|ostium|p2p|rewards|invest|smart-money|smart-wallet|ai-control|flash-liquidity|derivatives|ecosystem|developers|business|leaderboard|learn|lab|discover|compare|trade|settings|about|contact|help|docs|audit|security|order)[^'"]*)['"]/g)
  ];
  for (const m of literals) {
    const raw = m[1];
    if (raw.startsWith('/api') || raw.startsWith('/v1')) continue; // API paths, not screens
    const { pathname } = splitRoute(raw);
    if (!emitted.has(pathname)) emitted.set(pathname, []);
    emitted.get(pathname).push({ file: rel, raw });
  }
}
check('the probe found route literals to audit', emitted.size >= 20, `${emitted.size} paths`);

const unrouted = [...emitted.entries()].filter(([pathname]) => !isRoutedPath(pathname));
check('every route the AI emits is a mounted route (no catch-all landings)',
  unrouted.length === 0,
  unrouted.map(([p, hits]) => `${p} ← ${hits[0].file}`).join(' | '));

/* ── 3. every ?tab= value must be a target the chat can perform ────────── */

const tabValues = new Set();
for (const rel of SOURCES) {
  const src = read(rel);
  for (const m of src.matchAll(/\/intent\?tab=([a-zA-Z_-]+)/g)) tabValues.add(m[1]);
}
check('the AI emits at least the four ops tabs', ['ops', 'agents', 'strategies', 'status'].every((t) => tabValues.has(t)),
  [...tabValues].join(','));
const unknownTabs = [...tabValues].filter((t) => !INTENT_TAB_TARGETS[t.toLowerCase()]);
check('every ?tab= value the AI emits has an in-page target', unknownTabs.length === 0, unknownTabs.join(','));

/* ── 4. the resolver itself ────────────────────────────────────────────── */

const ops = resolveChatRoute('/intent?tab=ops');
check('/intent?tab=ops resolves to the operations panel, not a no-op navigation',
  ops.kind === 'panel' && ops.panel === 'operations', JSON.stringify(ops));
check('/intent?tab=agents resolves to the agents tab',
  resolveChatRoute('/intent?tab=agents').kind === 'tab' && resolveChatRoute('/intent?tab=agents').tab === 'agents');
check('/intent?tab=strategies resolves to the ecosystem strategy panel',
  resolveChatRoute('/intent?tab=strategies').kind === 'ecosystem'
  && resolveChatRoute('/intent?tab=strategies').ecoKind === 'strategy');
check('/intent?tab=status resolves to the status panel',
  resolveChatRoute('/intent?tab=status').kind === 'panel' && resolveChatRoute('/intent?tab=status').panel === 'status');
check('an invented tab is refused instead of silently doing nothing',
  resolveChatRoute('/intent?tab=nonexistent').kind === 'unknown');
check('a bare link to the page we are on brings the chat forward',
  resolveChatRoute('/intent').kind === 'tab' && resolveChatRoute('/intent').tab === 'chat');
check('a different page still navigates, keeping its query',
  (() => { const r = resolveChatRoute('/loan?tab=supply&asset=USDC'); return r.kind === 'navigate' && r.to === '/loan?tab=supply&asset=USDC'; })());
check('hash-style routes are understood too',
  resolveChatRoute('#/intent?tab=ops').kind === 'panel');

/* ── 5. isRoutedPath handles parameterised routes ──────────────────────── */

check('/coin/:id matches a real coin path', isRoutedPath('/coin/bitcoin'));
check('/coin/bitcoin/extra does not', !isRoutedPath('/coin/bitcoin/extra'));
check('the catch-all is never reported as a real target', !isRoutedPath('/calm') && !isRoutedPath('/lend') && !isRoutedPath('/futures'));

const passed = results.filter((r) => r.ok).length;
console.log(`\nchat-route-contract probe: ${passed}/${results.length} passed`);
if (passed !== results.length) {
  console.error(results.filter((r) => !r.ok).map((r) => `  ✗ ${r.name}${r.extra ? ` [${r.extra}]` : ''}`).join('\n'));
  process.exit(1);
}
console.log('OK: intent-ai/chat-route-contract-probe');

export default results;
