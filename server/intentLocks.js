/**
 * Process-local serialization for intent admission and auction closure.
 *
 * This removes races in local/self-hosted memory mode. It cannot coordinate
 * separate serverless instances; the durable auction seal is the cross-instance
 * signal, and capabilities disclose that Blob does not provide transactional
 * completeness at the close boundary.
 */

const tails = new Map();

export async function withIntentLock(intentHash, operation) {
  const key = String(intentHash || '').toLowerCase();
  const previous = tails.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  tails.set(key, current);

  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (tails.get(key) === current) tails.delete(key);
  }
}
