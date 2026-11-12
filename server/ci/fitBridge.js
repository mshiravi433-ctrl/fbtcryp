/**
 * THE BRIDGE BETWEEN THE CENTRAL BRAIN AND THE FIT ENGINE
 * -----------------------------------------------------------------------
 *
 * WHY THIS FILE EXISTS
 *
 * `server/fios/opportunityFit.js` scores an opportunity against the
 * OWNER's profile: their risk tolerance, their capital, their liquidity
 * need, their goal, the entry cost. It returns FITTED / CONDITIONAL /
 * NOT_FITTED with a reason for every dimension — and it existed, complete,
 * while «کدام گزینه مناسب من است؟» was UNSUPPORTED.
 *
 * The same ORDERING problem as `globalIntelBridge.js`:
 *
 *   · `fios` is built AFTER the brain, because `fios` calls
 *     `brain.directToolCall(...)`;
 *   · the brain is built BEFORE `fios`, because `fios` needs it.
 *
 * Neither can hold the other at construction time. So the same one-slot
 * bridge is used, with the same three rules:
 *
 *   1. **The provider is optional.** Until `fios` exists the module
 *      reports `PROVIDER_NOT_WIRED` — a named reason, never a number.
 *   2. **The provider is per-owner.** The brain always passes its own
 *      owner; the profile, the capital and the goal belong to one person.
 *   3. **A failure is named, not thrown.** The brain treats a missing
 *      domain as "not available right now"; an exception must not take
 *      the turn down.
 *
 * WHY NOT IMPORT THE ENGINE DIRECTLY
 *
 * `server/fios/opportunityFit.js` pulls in the whole composition root's
 * dependency graph when imported from the brain's module file, and that
 * file is on the boot path of every serverless cold start. The bridge
 * keeps `fios` lazily loaded, which is what §5 of
 * `docs/PHASE-CPU-AND-DARK-PHASES.md` was written to protect.
 */

let provider = null;

/**
 * Register the fit reader.
 *
 * @param {(owner: string, opts?: object) => Promise<any>} fn
 *   The `multiClassFor` closure from `createFinancialIntelligence`.
 * @returns {() => void} a disposer, so a test can restore the previous state.
 */
export function setFitProvider(fn) {
  const previous = provider;
  provider = typeof fn === 'function' ? fn : null;
  return () => { provider = previous; };
}

/** True once `fios` has wired itself in. */
export function hasFitProvider() {
  return typeof provider === 'function';
}

/**
 * Read the fit for one owner: the opportunities that suit them, and why.
 *
 * @returns {Promise<{ ok: true, fit: any } | { ok: false, code: string, detail: string }>}
 */
export async function readFit(owner, opts = {}) {
  if (typeof provider !== 'function') {
    return {
      ok: false,
      code: 'PROVIDER_NOT_WIRED',
      detail: 'the fit engine is not mounted in this process'
    };
  }
  try {
    const fit = await provider(owner, opts);
    if (!fit || typeof fit !== 'object') {
      return { ok: false, code: 'NO_FIT', detail: 'the fit engine answered with nothing' };
    }
    /* The engine answers with `ok:false` when it has nothing to say (no
       readable feed, no profile, no capital). That is an honest answer and
       it is passed through with its own code — the brain must be able to
       say WHY there is no ranking. */
    return { ok: true, fit };
  } catch (err) {
    return {
      ok: false,
      code: 'FIT_FAILED',
      detail: String(err?.message || err || '').slice(0, 160)
    };
  }
}
