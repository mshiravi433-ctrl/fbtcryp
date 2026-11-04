/**
 * Small, dependency-free helpers for asserting on locale JSON from a test.
 *
 * WHY THIS EXISTS
 * ---------------
 * Several suites need the same two things: read `xx.json` into a tree, and ask
 * "does this dotted key resolve to a non-empty leaf?" The naive version —
 * `k.split('.').reduce((o, p) => o?.[p], json)` — is subtly wrong in the exact
 * case these tests are meant to catch:
 *
 *   · a key whose leaf is `""` (present, but the UI would render nothing)
 *   · a key that resolves to an OBJECT because a parent was made a string
 *     (the `lab2.advanced` case: it used to be a plain string, so
 *     `lab2.advanced.door.title` can never exist under it — the reduce returns
 *     `undefined` and the test must see "missing", not a TypeError)
 *   · a key containing a locale's own dots, which are legal inside a JSON key
 *
 * It also accepts a raw JSON string so the caller can keep its `readFileSync`
 * one-liner and stay independent of `fs` mocking.
 */

/** Parse locale JSON (string or object) into a plain nested object. */
export function buildLocaleTree(input) {
  if (input && typeof input === 'object') return input;
  try {
    return JSON.parse(String(input));
  } catch {
    return {};
  }
}

/**
 * Resolve a dotted key. Returns `undefined` when any segment is absent or when
 * an intermediate segment is not an object — never throws.
 */
export function keyFromPath(tree, dotted) {
  if (!tree || typeof dotted !== 'string' || !dotted) return undefined;
  const parts = dotted.split('.');
  let cur = tree;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Is this key present AND renderable? i18next returns the key itself for a
 * genuinely missing string, so an empty leaf is the failure mode a plain
 * "key in object" check misses entirely.
 */
export function hasText(tree, dotted) {
  const v = keyFromPath(tree, dotted);
  return typeof v === 'string' && v.trim() !== '';
}

/** Every leaf path, for parity diffs between two locales. */
export function leafPaths(tree, prefix = '', out = []) {
  if (!tree || typeof tree !== 'object') return out;
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) leafPaths(v, path, out);
    else out.push(path);
  }
  return out;
}

/** Keys present in `a` but not in `b` (as dotted leaf paths). */
export function missingFrom(a, b) {
  const have = new Set(leafPaths(b));
  return leafPaths(a).filter((k) => !have.has(k));
}
