/**
 * The loader hook behind `measure-cold-import-graph.mjs`.
 *
 * ESM gives no way to observe an import tree from inside the process, so
 * the tree has to be observed from OUTSIDE: a loader hook that sees every
 * `resolve`/`load`, times it, and records it.
 *
 * The record is written to a JSONL file rather than kept in memory, because
 * the hook runs on its own thread. A JSONL file is the cheapest honest
 * channel between the hook thread and the measuring process.
 */
import { appendFileSync } from 'node:fs';
import { relative } from 'node:path';

const ROOT = process.env.FBT_IMPORT_GRAPH_ROOT || process.cwd();
const OUT = process.env.FBT_IMPORT_GRAPH_OUT || `${ROOT}/.import-graph.jsonl`;

export async function resolve(specifier, context, nextResolve) {
  const started = Date.now();
  const resolved = await nextResolve(specifier, context);
  const elapsed = Date.now() - started;
  try {
    const file = relative(ROOT, String(resolved.url).replace(/^file:\/\//, ''));
    if (!file.startsWith('..') && !file.includes('node_modules')) {
      appendFileSync(OUT, `${JSON.stringify({ file, ms: elapsed, kind: 'resolve' })}\n`);
    }
  } catch {
    /* the file list is a measurement, not a requirement */
  }
  return resolved;
}

export async function load(url, context, nextLoad) {
  const started = Date.now();
  const result = await nextLoad(url, context);
  const elapsed = Date.now() - started;
  try {
    const file = relative(ROOT, String(url).replace(/^file:\/\//, ''));
    if (!file.startsWith('..') && !file.includes('node_modules')) {
      appendFileSync(OUT, `${JSON.stringify({ file, ms: elapsed, kind: 'load' })}\n`);
    }
  } catch {
    /* ignore */
  }
  return result;
}
