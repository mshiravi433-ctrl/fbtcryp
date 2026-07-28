/**
 * Commit–reveal RNG used by the games.
 *
 * How it works
 *  1. Before you bet, the client generates a `serverSeed` and shows you only
 *     its SHA-256 hash (the commitment).
 *  2. You supply / edit a `clientSeed`.
 *  3. The outcome is HMAC-ish derived from `serverSeed:clientSeed:nonce`.
 *  4. After the round the `serverSeed` is revealed so you can re-hash it and
 *     verify the commitment matched — proving the result wasn't picked after
 *     you placed the bet.
 *
 * HONEST LIMITATION: in this build the seed is generated *in your own browser*,
 * so it proves the UI didn't cheat you within a round, but it is not the same
 * as a licensed operator's audited RNG. For anything involving real money you
 * need the server to hold the seed, a published seed-hash chain, an RNG audit
 * (e.g. iTech Labs / GLI) and a gambling licence in each jurisdiction you serve.
 */

const enc = new TextEncoder();

export function randomSeed(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deterministic float in [0,1) from the seed triple. */
export async function rollFloat(serverSeed, clientSeed, nonce) {
  const hex = await sha256Hex(`${serverSeed}:${clientSeed}:${nonce}`);
  // use the first 52 bits for a full-precision double
  const slice = hex.slice(0, 13);
  return parseInt(slice, 16) / 2 ** 52;
}

/**
 * Crash multiplier with a configurable house edge.
 * Classic formula: `(1 - edge) / (1 - r)`, clipped to `maxX`.
 */
export async function rollCrashPoint(serverSeed, clientSeed, nonce, edge = 0.03, maxX = 100) {
  const r = await rollFloat(serverSeed, clientSeed, nonce);
  if (r < edge) return 1.0; // instant bust
  const x = (1 - edge) / (1 - r);
  return Math.min(maxX, Math.max(1, Math.floor(x * 100) / 100));
}

export async function rollDice(serverSeed, clientSeed, nonce) {
  const r = await rollFloat(serverSeed, clientSeed, nonce);
  return Math.floor(r * 10000) / 100; // 0.00 – 99.99
}

export async function rollIndex(serverSeed, clientSeed, nonce, size) {
  const r = await rollFloat(serverSeed, clientSeed, nonce);
  return Math.floor(r * size) % size;
}

/** Fresh commitment for a new game session. */
export async function newCommitment() {
  const serverSeed = randomSeed();
  const hash = await sha256Hex(serverSeed);
  return { serverSeed, hash, clientSeed: randomSeed(8), nonce: 0 };
}

export const HOUSE_EDGE = 0.03;
