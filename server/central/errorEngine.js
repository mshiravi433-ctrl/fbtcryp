/**
 * FBT CENTRAL INTELLIGENCE OS — Error Intelligence (§22, §23, §39).
 * ---------------------------------------------------------------------------
 *   RAW ERROR → CLASSIFIER → KNOWN ERROR → RECOVERY → RETRY → FALLBACK → VERIFY
 *
 * Security-class errors take the other road: ERROR → SAFE STOP. They are
 * NEVER retried and NEVER routed around a fallback (§23, §39).
 *
 * The user never sees raw technical errors: classifyError() returns a
 * machine category plus a human code the response engine translates.
 */
import { SECURITY_STOP_CODES } from './constants.js';
import { publish } from './eventBus.js';

export const ERROR_CATEGORY = Object.freeze({
  TRANSIENT: 'TRANSIENT',       // network blip, timeout — retriable
  RATE_LIMIT: 'RATE_LIMIT',     // upstream 429 — retriable with backoff
  DATA: 'DATA',                 // empty/stale/bad-shape upstream data
  PROVIDER: 'PROVIDER',         // provider down — failover to alternate
  POLICY: 'POLICY',             // policy engine refused — NOT retriable
  SECURITY: 'SECURITY',         // SAFE STOP — never retried, never bypassed
  UNSUPPORTED: 'UNSUPPORTED',   // module genuinely cannot do it
  UNKNOWN: 'UNKNOWN'
});

const TRANSIENT_RE = /timeout|timed out|econnreset|econnrefused|etimedout|enotfound|socket|network|fetch failed|eai_again|503|502|504/i;
const RATE_RE = /rate.?limit|429|too many requests|quota/i;
const SECURITY_RE = /security|sanction|oracle.?manipulat|invalid recipient|contract mismatch|reentrancy|signature.*(invalid|mismatch)/i;

/** Classify any thrown error (Error, string, or {error} object) into a category. */
export function classifyError(err) {
  const raw = err && typeof err === 'object'
    ? `${err.error || ''} ${err.code || ''} ${err.message || ''} ${err.detail || ''}`
    : String(err ?? '');
  const status = Number(err?.status || err?.statusCode || 0);
  const explicit = String(err?.category || '').toUpperCase();
  if (Object.values(ERROR_CATEGORY).includes(explicit)) {
    return { category: explicit, retriable: explicit === 'TRANSIENT' || explicit === 'RATE_LIMIT' || explicit === 'PROVIDER', raw: raw.slice(0, 200), securityStop: explicit === 'SECURITY' };
  }
  if (SECURITY_STOP_CODES.some((c) => raw.toUpperCase().includes(c))) {
    return { category: ERROR_CATEGORY.SECURITY, retriable: false, raw: raw.slice(0, 200), securityStop: true };
  }
  if (SECURITY_RE.test(raw)) return { category: ERROR_CATEGORY.SECURITY, retriable: false, raw: raw.slice(0, 200), securityStop: true };
  if (status === 429 || RATE_RE.test(raw)) return { category: ERROR_CATEGORY.RATE_LIMIT, retriable: true, raw: raw.slice(0, 200), securityStop: false };
  if (status === 404 || /not.?found|unsupported/i.test(raw)) return { category: ERROR_CATEGORY.UNSUPPORTED, retriable: false, raw: raw.slice(0, 200), securityStop: false };
  if (status === 400 || /validation|bad_?(amount|address|input|chain)/i.test(raw)) return { category: ERROR_CATEGORY.POLICY, retriable: false, raw: raw.slice(0, 200), securityStop: false };
  if (TRANSIENT_RE.test(raw) || (status >= 500 && status <= 599)) return { category: ERROR_CATEGORY.TRANSIENT, retriable: true, raw: raw.slice(0, 200), securityStop: false };
  if (/stale|expired|bad.?shape|empty/i.test(raw)) return { category: ERROR_CATEGORY.DATA, retriable: true, raw: raw.slice(0, 200), securityStop: false };
  return { category: ERROR_CATEGORY.UNKNOWN, retriable: false, raw: raw.slice(0, 200), securityStop: false };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` with retries, then walk the `fallbacks` list in order (§22/§39:
 * RPC1 failed → RPC2 → continue). Security classifications abort immediately
 * and bubble up — a security stop is a terminal decision, not a retry target.
 *
 * Returns { ok, value, attempts, usedFallback } or throws the final error
 * (the caller decides whether that is a user-facing SAFE STOP or a degraded
 * capability report).
 */
export async function withRetryFallback(fn, {
  retries = 2,
  backoffMs = 120,
  fallbacks = [],
  label = 'operation',
  onRecover = null
} = {}) {
  const attempts = [];
  const runOnce = async (candidate, tag) => {
    try {
      const value = await candidate();
      attempts.push({ tag, ok: true });
      return { ok: true, value, attempts, usedFallback: tag !== 'primary' };
    } catch (err) {
      const c = classifyError(err);
      attempts.push({ tag, ok: false, category: c.category });
      if (c.securityStop) {
        publish('SECURITY_STOP', { label, category: c.category, raw: c.raw }, { source: 'error-engine' });
        const stop = new Error(`SAFE_STOP:${c.category}`);
        stop.securityStop = true;
        stop.category = c.category;
        stop.attempts = attempts;
        throw stop;
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { category: c.category, retriable: c.retriable, attemptsSoFar: attempts });
    }
  };

  const ladder = [{ tag: 'primary', fn }, ...fallbacks.map((f, i) => ({ tag: `fallback:${i + 1}`, fn: f }))];
  let lastErr = null;
  for (const rung of ladder) {
    for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
      try {
        const out = await runOnce(rung.fn, rung.tag);
        if (rung.tag !== 'primary' && typeof onRecover === 'function') {
          try { onRecover({ label, used: rung.tag, attempts }); } catch { /* observer */ }
        }
        if (rung.tag !== 'primary') publish('RECOVERY_TRIGGERED', { label, used: rung.tag }, { source: 'error-engine' });
        return out;
      } catch (err) {
        if (err.securityStop) throw err;
        lastErr = err;
        const retriable = err.retriable !== false && attempt < retries;
        if (retriable) await sleep(backoffMs * attempt);
        else break; // not retriable → move to next fallback rung
      }
    }
  }
  const final = lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'FAILED'));
  final.attempts = attempts;
  throw final;
}

/** Wrap any promise with a hard timeout (provider hangs must not hang the brain). */
export function withTimeout(promise, ms = 8000, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT:${label} after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
