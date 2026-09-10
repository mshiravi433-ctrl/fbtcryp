/**
 * RPC READ RETRY — the fix for «شبکه X در دسترس نیست» that was not an outage.
 * ---------------------------------------------------------------------------
 * The Farm execution adapters read through public RPC endpoints. A public
 * endpoint answers 429 or drops a socket for a moment — one failed read, and
 * the panel surfaced LIDO_NETWORK_UNREADABLE / AAVE_NETWORK_UNREADABLE to a
 * user whose network was perfectly fine. The FallbackProvider already fails
 * over between endpoints, but it gives up on the batch as a whole fast enough
 * that a transient blip on every candidate still surfaces as an error.
 *
 * `withRpcRetry` adds a short, bounded retry with linear backoff for READS
 * ONLY. It must never wrap anything that signs or sends a transaction — a
 * retry around a send is how you double-spend. Every call site below wraps a
 * pure read (eth_call / getNetwork style).
 *
 * Defaults: 3 attempts, 350ms between them — about one second of patience in
 * total, which is cheaper than a user concluding the protocol is broken.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run an async read, retrying on ANY failure up to `attempts` times.
 *
 * @param {() => Promise<*>} fn the read to run
 * @param {object} [opts]
 * @param {number} [opts.attempts=3]   total attempts (not extra retries)
 * @param {number} [opts.delayMs=350]  delay between attempts, linear
 * @param {string} [opts.label]        logged (warn) on final failure, for support
 * @returns the first successful result; rethrows the last error after the final attempt
 */
export async function withRpcRetry(fn, { attempts = 3, delayMs = 350, label = 'rpc-read' } = {}) {
  const total = Math.max(1, Math.floor(Number(attempts) || 1));
  let lastErr = null;
  for (let i = 0; i < total; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < total - 1) await sleep(delayMs * (i + 1));
    }
  }
  // eslint-disable-next-line no-console
  console.warn(`[rpc-retry] ${label} failed after ${total} attempts: ${lastErr?.shortMessage ?? lastErr?.message ?? lastErr}`);
  throw lastErr;
}
