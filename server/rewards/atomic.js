/**
 * FBT REWARDS — atomic storage primitives.
 * ===========================================================================
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The rewards ledger is a promise: a point credited today is meant to be
 * redeemable the day FBT launches. Two properties therefore matter more than
 * throughput:
 *
 *   1. NO LOST CREDITS.  On serverless, several instances serve the same
 *      account at once. The old `getLedger → mutate → saveLedger` cycle is a
 *      read-modify-write with no compare-and-set: two concurrent events and
 *      the last writer silently erases the other's points.
 *   2. NO DOUBLE CREDITS.  Idempotency used to be "read the seen array, check
 *      it, write it back" — the same race pointed the other way.
 *
 * Upstash Redis — already the project's durable backend — gives both for free,
 * because a Redis command is atomic by definition. This module exposes exactly
 * three primitives: claim an idempotency key, take a lease, release it.
 *
 * DEGRADATION, HONESTLY STATED
 * ---------------------------------------------------------------------------
 * When Redis is not configured (local dev, or a deployment that only has Vercel
 * Blob) every primitive falls back to an in-process lock. An in-process lock
 * cannot protect across instances — that is exactly the guarantee the code had
 * before this module existed, never a worse one, and `atomicBackend()` reports
 * which mode is live so the API can say so out loud.
 *
 * STORAGE LAW (unchanged)
 * ---------------------------------------------------------------------------
 * Everything here is bounded. The seen-set is a CAPPED SORTED SET rather than a
 * growing list: the member is the event fingerprint and the score is the time
 * it was credited, so trimming to the newest N is one ZREMRANGEBYRANK. Both the
 * set and every lease carry a TTL, so nothing can outlive its usefulness.
 */
import { randomBytes } from 'node:crypto';
import { upstashConfigured, upstashCommand } from '../blobCache.js';

/* -------------------------------------------------------------------------- */
/* backend identity                                                            */
/* -------------------------------------------------------------------------- */

/** Which backend is actually serving these primitives right now. */
export const atomicBackend = () => (upstashConfigured() ? 'upstash-redis' : 'process-lock');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const DEFAULT_SEEN_CAP = 300;
export const DEFAULT_SEEN_TTL_SECONDS = 365 * 24 * 3600;

/* -------------------------------------------------------------------------- */
/* 1 · idempotency — claim an event fingerprint                                */
/* -------------------------------------------------------------------------- */

/**
 * `ZADD … NX` adds a member only when it is absent and reports whether it was
 * new, so "have I seen this?" and "remember it" are one atomic step. `NX` also
 * keeps the ORIGINAL timestamp on a replay, so trimming keeps the truly newest
 * entries rather than letting a replay push an old event to the front.
 */
const CLAIM_LUA = `
local cap = tonumber(ARGV[3])
local added = redis.call('ZADD', KEYS[1], 'NX', ARGV[2], ARGV[1])
if added == 1 then
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -(cap + 1))
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
end
return added
`;

/**
 * Claim one idempotency fingerprint.
 *
 * @returns {1|0|null} 1 = newly claimed (credit it),
 *                     0 = already seen (never credit it again),
 *                     null = the store could not answer.
 *
 * Callers MUST treat `null` as "do not credit". Crediting blind is the one
 * failure mode that permanently inflates a ledger people will redeem.
 */
export async function claimSeen({
  key,
  member,
  at = Date.now(),
  cap = DEFAULT_SEEN_CAP,
  ttlSeconds = DEFAULT_SEEN_TTL_SECONDS
}) {
  if (!upstashConfigured()) return null;
  const answer = await upstashCommand([
    'EVAL', CLAIM_LUA, '1', key, member, String(at), String(cap), String(ttlSeconds)
  ]);
  if (!answer.ok) return null;
  const n = Number(answer.result);
  return Number.isInteger(n) && (n === 0 || n === 1) ? n : null;
}

/**
 * Bulk-claim — used only by the one-time migration from the v1 array format.
 * Returns the number of NEW members added, or null when the store did not
 * answer. It deliberately does not delete anything: the caller decides.
 */
export async function claimSeenMany({
  key,
  entries,
  cap = DEFAULT_SEEN_CAP,
  ttlSeconds = DEFAULT_SEEN_TTL_SECONDS
}) {
  if (!upstashConfigured() || !Array.isArray(entries) || entries.length === 0) return 0;
  const args = ['ZADD', key, 'NX'];
  for (const e of entries) args.push(String(e.at ?? Date.now()), e.member);
  const answer = await upstashCommand(args);
  if (!answer.ok) return null;
  await upstashCommand(['ZREMRANGEBYRANK', key, '0', String(-(cap + 1))]);
  await upstashCommand(['EXPIRE', key, String(ttlSeconds)]);
  return Number(answer.result);
}

/* -------------------------------------------------------------------------- */
/* 2 · leases — serialise one account's read-modify-write                      */
/* -------------------------------------------------------------------------- */

/**
 * Take a short lease on an account's ledger.
 *
 * The lease is what makes the read-modify-write safe: the holder is the only
 * writer, and it reads FRESH (never the warm in-process cache) while it holds
 * the lease. It expires on its own, so a crashed instance cannot lock an
 * account out forever.
 *
 * @returns {string|null} an opaque token to hand back to `releaseLease`, or
 *                        null when the lease could not be taken.
 */
export async function acquireLease({ key, ttlMs = 20_000, attempts = 5 }) {
  if (upstashConfigured()) {
    const token = randomBytes(16).toString('hex');
    const seconds = Math.max(2, Math.ceil(ttlMs / 1000));
    for (let i = 0; i < attempts; i += 1) {
      const answer = await upstashCommand(['SET', key, token, 'NX', 'EX', String(seconds)]);
      if (answer.ok && answer.result === 'OK') return token;
      if (i < attempts - 1) await sleep(40 * (i + 1) + Math.random() * 40);
    }
    return null;
  }
  return acquireProcessLock(key, ttlMs);
}

/**
 * Release a lease ONLY if we still hold it. An unconditional DEL could erase a
 * lease that already expired and was taken by somebody else — which would put
 * two writers back inside the same critical section.
 */
export async function releaseLease({ key, token }) {
  if (!token) return false;
  if (upstashConfigured()) {
    const script = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
    const answer = await upstashCommand(['EVAL', script, '1', key, token]);
    return answer.ok && Number(answer.result) === 1;
  }
  return releaseProcessLock(key, token);
}

/* -------------------------------------------------------------------------- */
/* in-process fallback                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A keyed mutex for the single process. It is NOT cross-instance — it exists so
 * the non-Redis path keeps the serialisation it always had, and so local runs
 * behave the same way as production.
 */
const held = new Map();

async function acquireProcessLock(key, ttlMs, attempts = 40, delayMs = 25) {
  for (let i = 0; i < attempts; i += 1) {
    if (!held.has(key)) {
      const token = randomBytes(8).toString('hex');
      const timer = setTimeout(() => {
        if (held.get(key)?.token === token) held.delete(key);
      }, ttlMs);
      timer.unref?.();
      held.set(key, { token, timer });
      return token;
    }
    await sleep(delayMs);
  }
  return null;
}

function releaseProcessLock(key, token) {
  const record = held.get(key);
  if (!record || record.token !== token) return false;
  clearTimeout(record.timer);
  held.delete(key);
  return true;
}
