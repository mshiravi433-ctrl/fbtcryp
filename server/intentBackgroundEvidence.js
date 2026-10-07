/**
 * Scheduling policy for the optional Intent evidence worker.
 *
 * Vercel API handlers are serverless: app.js is imported for each warm
 * function instance, not once for the deployment. A process-level timer there
 * fans expensive probes out across cold starts and can keep warm instances
 * doing background work. Vercel must run these checks through the existing
 * authenticated daily cron instead. A long-lived, non-Vercel server may opt in
 * explicitly with INTENT_BACKGROUND_EVIDENCE=1.
 */
export const INTENT_BACKGROUND_EVIDENCE_INTERVAL_MS = 4 * 60 * 60_000;
const START_DELAY_MS = 200;

function isVercel(env) {
  return Boolean(String(env?.VERCEL || '').trim() || String(env?.VERCEL_ENV || '').trim());
}

export function intentBackgroundEvidenceEnabled(env = process.env) {
  return String(env?.NODE_ENV || '').trim() !== 'test'
    && !isVercel(env)
    && String(env?.INTENT_BACKGROUND_EVIDENCE || '').trim() === '1';
}

/**
 * Schedule the expensive probes only for an explicitly opted-in, long-lived
 * non-Vercel process. Timer functions are injectable so this policy can be
 * regression-tested without importing the large Express application.
 */
export function startIntentBackgroundEvidence({
  env = process.env,
  collect,
  scheduleTimeout = setTimeout,
  scheduleInterval = setInterval,
  cancelTimeout = clearTimeout,
  cancelInterval = clearInterval
} = {}) {
  if (!intentBackgroundEvidenceEnabled(env)) {
    return { enabled: false, stop() {} };
  }
  if (typeof collect !== 'function') {
    throw new TypeError('collect must be a function when background evidence is enabled');
  }

  let stopped = false;
  let running = false;
  let intervalTimer = null;

  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await collect();
    } catch {
      // Diagnostic refreshes are best-effort and must never affect API traffic.
    } finally {
      running = false;
    }
  };

  const startTimer = scheduleTimeout(() => {
    if (stopped) return;
    void run();
    intervalTimer = scheduleInterval(() => { void run(); }, INTENT_BACKGROUND_EVIDENCE_INTERVAL_MS);
    intervalTimer?.unref?.();
  }, START_DELAY_MS);
  startTimer?.unref?.();

  return {
    enabled: true,
    stop() {
      if (stopped) return;
      stopped = true;
      cancelTimeout(startTimer);
      if (intervalTimer !== null) cancelInterval(intervalTimer);
    }
  };
}
