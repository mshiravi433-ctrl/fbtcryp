/*
 * THE FIRST-PAINT IMPORT GRAPH
 * ---------------------------------------------------------------------------
 *
 * The byte budget in `scripts/check-first-paint.mjs` is a RATCHET: it is
 * checked after the build, it fails the build, and by the time it fails
 * the person reading the log has to work out which import edge caused
 * it. That is a slow way to learn something that was obvious at the
 * moment it was written.
 *
 * This test is the fast way. It walks the import graph from the ENTRY
 * POINT and reports what the first paint has to carry — and it fails if
 * a HEAVY dependency reaches it.
 *
 * WHY IT EXISTS.
 *
 * The route-intelligence work put the published-transfer store inside
 * `src/lib/intentCrossChainClient.js`, because that is where the
 * cross-chain browser client lives and the store belongs to it. The brain
 * client (`src/lib/central/client.js`) reads the store on every turn, and
 * the brain client IS on the entry path. So one import edge
 *
 *     central/client.js  →  intentCrossChainClient.js
 *                         →  @noble/ed25519, @noble/hashes, server/ethersLite.js
 *
 * put a signing library, a hash library and an ethers implementation into
 * the FIRST-PAINT bundle. **26 KB**, for three numbers and three strings.
 *
 * The build did not fail — it grew 1814.25 KB → 1839.71 KB and the
 * ratchet failed it at 1825. The ratchet did its job. But the ratchet
 * reports BYTES, and this test reports the EDGE.
 *
 * THE RULE.
 *
 * A module on the first-paint path may not import a heavy dependency
 * directly OR TRANSITIVELY. "Transitively" is the whole point: the edge
 * that hurt was two hops away from the thing that hurt, and one hop is
 * exactly where an import looks innocent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* The entry points of the production bundle. */
const ENTRIES = ['src/main.jsx', 'src/App.jsx'].filter((f) => fs.existsSync(path.join(ROOT, f)));

/*
 * The heavy things. These are the ones that cost hundreds of KB when they
 * reach the first paint, and each of them is perfectly reasonable in a
 * chunk that is loaded ON PURPOSE.
 */
const HEAVY_PACKAGES = new Set([
  '@noble/ed25519',
  '@noble/hashes',
  '@noble/curves',
  'ethers',
  'web3',
  'viem',
  '@solana/web3.js',
  'bitcoinjs-lib',
  '@tensorflow/tfjs',
  'onnxruntime-web'
]);

const HEAVY_LOCAL = [
  /* The browser-side ethers implementation. It is a real dependency of
     the cross-chain client — and it must stay OUT of the first paint. */
  'server/ethersLite.js'
];

/** Resolve an import specifier to a file under the repo, or null. */
function resolveSpec(spec, fromFile) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  const base = spec.startsWith('/')
    ? path.join(ROOT, spec)
    : path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    path.join(base, 'index.js'),
    path.join(base, 'index.jsx')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** The import specifiers of one file. */
function importsOf(file) {
  let src = '';
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  const re = /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  /* `export … from '…'` is an import edge too. */
  const re2 = /(?:^|\n)\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = re2.exec(src)) !== null) out.push(m[1]);
  return out;
}

/**
 * The first-paint graph: every file reachable from the entry points,
 * with the path that reaches it.
 */
function firstPaintGraph() {
  const seen = new Map(); /* file → the path that reaches it */
  const queue = ENTRIES.map((e) => path.join(ROOT, e));
  seen.set(queue[0], []);

  while (queue.length) {
    const file = queue.shift();
    const via = seen.get(file) || [];
    for (const spec of importsOf(file)) {
      const target = resolveSpec(spec, file);
      if (!target) continue;
      if (!seen.has(target)) {
        seen.set(target, [...via, file]);
        queue.push(target);
      }
    }
  }
  return seen;
}

test('the first-paint graph is walkable — the entry points exist', () => {
  assert.ok(ENTRIES.length > 0, 'no entry point found — the graph would be empty and the test would pass for the wrong reason');
});

test('no heavy package reaches the first paint', () => {
  const graph = firstPaintGraph();
  const offenders = [];
  for (const [file] of graph) {
    for (const spec of importsOf(file)) {
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (HEAVY_PACKAGES.has(pkg)) {
        offenders.push(`${pkg}  ←  ${path.relative(ROOT, file)}`);
      }
    }
  }
  assert.equal(
    offenders.length,
    0,
    `these heavy packages are on the first-paint path:\n${offenders.map((o) => `  · ${o}`).join('\n')}\n\n` +
    'The entry path may not carry a signing library, a hash library or an ethers implementation. ' +
    'Put the feature behind a dynamic import, or move the small piece that needs it into a module with no heavy imports.'
  );
});

test('no heavy local module reaches the first paint', () => {
  const graph = firstPaintGraph();
  const offenders = [];
  for (const [file, via] of graph) {
    for (const spec of importsOf(file)) {
      const target = resolveSpec(spec, file);
      if (!target) continue;
      const rel = path.relative(ROOT, target).replace(/\\/g, '/');
      if (HEAVY_LOCAL.includes(rel)) {
        const chain = [...via, file].map((f) => path.relative(ROOT, f));
        offenders.push(`${rel}  ←  ${chain.join(' → ')}`);
      }
    }
  }
  assert.equal(
    offenders.length,
    0,
    `these heavy modules are on the first-paint path:\n${offenders.map((o) => `  · ${o}`).join('\n')}\n\n` +
    'The chain is printed because the edge that hurts is usually two hops away from the thing that hurts.'
  );
});

test('the published-transfer store has no imports at all', () => {
  /* The store is three numbers and three strings. It reads one key from
     localStorage and it must not drag a signing library into the entry
     chunk to do it — that was the 26 KB. */
  const file = path.join(ROOT, 'src', 'lib', 'routeRequestStore.js');
  assert.ok(fs.existsSync(file), 'src/lib/routeRequestStore.js is the dependency-free store');
  const specs = importsOf(file);
  assert.equal(specs.length, 0, `the store must import nothing, but it imports ${specs.join(', ')}`);
});

test('the brain client reads the store, not the cross-chain client', () => {
  /* This is the exact edge that cost the first paint 26 KB. It is named
     here so that changing it back is a deliberate act. */
  const file = path.join(ROOT, 'src', 'lib', 'central', 'client.js');
  const specs = importsOf(file);
  assert.ok(
    !specs.some((s) => s.includes('intentCrossChainClient')),
    `the brain client must not import the cross-chain client: ${specs.filter((s) => s.includes('intentCrossChainClient')).join(', ')}`
  );
  assert.ok(
    specs.some((s) => s.includes('routeRequestStore')),
    'the brain client must read the published transfer from the dependency-free store'
  );
});
