/**
 * THE BRIDGE BETWEEN THE CENTRAL BRAIN AND THE BEHAVIOUR MODEL
 * -----------------------------------------------------------------------
 *
 * WHY THIS FILE EXISTS
 *
 * `server/fios/behavior.js` categorises what a user ACTUALLY DOES: fourteen
 * signals — REJECTS_LEVERAGE, PREFERS_LOW_FEE_ROUTES, REJECTS_HIGH_RISK_
 * PROTOCOLS, CANCELS_AT_CONFIRMATION, CONFIRMS_QUICKLY — each computed from a
 * minimum of three verified events, and each carrying the memory key it should
 * write (`REJECTS_HIGH_RISK_PROTOCOLS` → `riskTolerance: CONSERVATIVE`).
 * `server/fios/personalProfile.js` assembles those signals into the profile the
 * fit engine scores against.
 *
 * All of it was complete, and all of it was dark, for two reasons:
 *
 *   1. NOTHING REPORTED. `behavior.ingest` was called only from
 *      `learning.learn`, which only an HTTP POST to `/learning` and the
 *      evaluation engine reached. A user confirming or cancelling an execution
 *      through the brain — the single most informative thing a user does — fed
 *      no model at all.
 *   2. NOTHING APPLIED THE RESULT. `memoryKey` and `memoryValue` appear nowhere
 *      outside `behavior.js`: the signals were computed and then dropped on the
 *      floor, so `preferences.resolve` could never return a behaviour-derived
 *      value even though MEMORY_PROVENANCE reserves `USER_BEHAVIOR` (rank 2,
 *      confidence 0.7, 180-day TTL) for exactly that.
 *
 * The visible symptom was a fit headline that said
 * «۵ گزینه با پروفایل ریسک خوانده‌نشده سنجیده شد» — an engine scoring five
 * opportunities against a profile it could not read, because the profile is
 * built from behaviour nobody ever recorded.
 *
 * The same ORDERING problem as every other bridge here:
 *
 *   · `fios` is built AFTER the brain, because `fios` calls
 *     `brain.directToolCall(...)`;
 *   · the brain is built BEFORE `fios`, because `fios` needs it.
 *
 * So: one slot, and the same three rules.
 *
 *   1. **The provider is optional.** Until `fios` exists the brain reports
 *      `BEHAVIOR_PROVIDER_NOT_WIRED` — a named reason, never a guess.
 *   2. **The provider is per-owner.** Behaviour is one person's history; a
 *      shared model would categorise everyone as the average of everyone.
 *   3. **A failure is named, not thrown.** Reporting behaviour is a
 *      side-effect of a turn, never a precondition of it: if the model cannot
 *      be written, the user's confirmation must still be confirmed.
 *
 * WHAT THE BRIDGE DELIBERATELY DOES NOT DO
 *
 * It does not decide anything. §8 is «learning is not authority», and the
 * memory store enforces it: a `USER_BEHAVIOR` record can never downgrade a
 * `USER_SAID` or `USER_PREFERRED` one, and every write goes through
 * `memory.remember`, which refuses with WOULD_DOWNGRADE_MEMORY when it would.
 * So a user who said «I am conservative» stays conservative no matter what
 * their clicks suggest — the behaviour model fills gaps, it does not overrule.
 */

let reporter = null;
let reader = null;

/**
 * Register the behaviour reporter.
 *
 * @param {(owner: string, event: object) => Promise<any>} fn
 *   The closure from `createFinancialIntelligence` that ingests one event and
 *   applies whatever signals it produced.
 * @returns {() => void} a disposer, so a test can restore the previous state.
 */
export function setBehaviorReporter(fn) {
  const previous = reporter;
  reporter = typeof fn === 'function' ? fn : null;
  return () => { reporter = previous; };
}

/**
 * Register the behaviour reader.
 *
 * @param {(owner: string) => Promise<any>} fn
 * @returns {() => void} a disposer.
 */
export function setBehaviorReader(fn) {
  const previous = reader;
  reader = typeof fn === 'function' ? fn : null;
  return () => { reader = previous; };
}

/** True once `fios` has wired itself in. */
export function hasBehaviorReporter() {
  return typeof reporter === 'function';
}

/** True once the reader is wired. */
export function hasBehaviorReader() {
  return typeof reader === 'function';
}

/** The event kinds the model understands, restated so the brain does not have
 *  to import `fios` to know them. `server/fios/behavior.js` is the authority;
 *  this list is a copy for validation only, and a kind outside it is refused
 *  here rather than being silently stored and never scored. */
export const BEHAVIOR_EVENT_KINDS = Object.freeze([
  'PROPOSAL_ACCEPTED', 'PROPOSAL_REJECTED', 'EXECUTION_CONFIRMED',
  'EXECUTION_CANCELLED', 'ROUTE_CHOSEN', 'STRATEGY_CHOSEN', 'CONFIRMATION_LATENCY'
]);

/**
 * Report one behaviour event.
 *
 * Never throws, and never blocks the turn: the reply the user is waiting for
 * does not depend on whether their history was recorded.
 *
 * @returns {Promise<{ok: boolean, code?: string, signals?: object, applied?: Array}>}
 */
export async function reportBehavior(owner, event = {}) {
  /*
   * VALIDATE BEFORE ASKING WHETHER ANYBODY IS LISTENING.
   *
   * The owner and the event kind are properties of the CALL, and checking them
   * needs no provider. Checked after the provider, a caller with a malformed
   * event in an unmounted process was told BEHAVIOR_PROVIDER_NOT_WIRED — true,
   * but not the thing they had to fix, and it hid a programming error behind an
   * environment one. Most specific and most actionable first.
   */
  if (!owner) return { ok: false, code: 'NO_OWNER', detail: 'behaviour belongs to one person' };
  if (!BEHAVIOR_EVENT_KINDS.includes(event?.kind)) {
    return { ok: false, code: 'UNKNOWN_BEHAVIOR_EVENT', detail: `${event?.kind || 'nothing'} is not an event the model scores`, allowed: BEHAVIOR_EVENT_KINDS };
  }
  if (typeof reporter !== 'function') {
    return { ok: false, code: 'BEHAVIOR_PROVIDER_NOT_WIRED', detail: 'the behaviour model is not mounted in this process' };
  }
  try {
    const out = await reporter(owner, event);
    if (!out || typeof out !== 'object') {
      return { ok: false, code: 'NO_BEHAVIOR_RESULT', detail: 'the model answered with nothing' };
    }
    if (out.ok === false) return { ok: false, code: out.code || 'BEHAVIOR_REJECTED', detail: out.detail || null, allowed: out.allowed || null };
    return { ok: true, signals: out.signals || {}, basis: out.basis || null, events: out.events ?? null, applied: Array.isArray(out.applied) ? out.applied : [] };
  } catch (err) {
    return { ok: false, code: 'BEHAVIOR_REPORT_FAILED', detail: String(err?.message || err || '').slice(0, 160) };
  }
}

/**
 * Read the signals recorded so far.
 *
 * @returns {Promise<{ok: boolean, signals?: object, events?: number, minSamples?: number, code?: string}>}
 */
export async function readBehaviorSignals(owner) {
  if (typeof reader !== 'function') {
    return { ok: false, code: 'BEHAVIOR_READER_NOT_WIRED', signals: {} };
  }
  try {
    const out = await reader(owner);
    if (!out || out.ok === false) return { ok: false, code: out?.code || 'NO_BEHAVIOR_SIGNALS', signals: {} };
    return { ok: true, signals: out.signals || {}, events: out.events ?? 0, minSamples: out.minSamples ?? 3 };
  } catch (err) {
    return { ok: false, code: 'BEHAVIOR_READ_FAILED', detail: String(err?.message || err || '').slice(0, 160), signals: {} };
  }
}
