/**
 * THE BRIDGE BETWEEN THE CENTRAL BRAIN AND THE FINANCIAL INTELLIGENCE OS
 * -----------------------------------------------------------------------
 *
 * WHY THIS FILE EXISTS
 *
 * `server/fios/` (50 files, 980 KB) holds the global intelligence engines —
 * smart money, whales, on-chain activity, the macro graph, the cross-asset
 * view, the proactive briefing. The central brain holds the modules the chat
 * actually answers from.
 *
 * They could not talk, and the reason was an ORDERING problem, not a
 * design problem:
 *
 *   · `fios` is built AFTER the brain, because `fios` calls
 *     `brain.directToolCall(...)` for the four traditional-asset feeds;
 *   · the brain is built BEFORE `fios`, because `fios` needs it.
 *
 * So the brain cannot hold a reference to `fios` at construction time, and
 * `fios` cannot be constructed to serve the brain without the brain. A
 * direct reference in either direction is a cycle.
 *
 * WHAT THIS BRIDGE DOES
 *
 * It breaks the cycle with the smallest possible surface: one function
 * slot, set by whichever side is constructed last, read by whichever
 * side needs it.
 *
 *   · `fios` calls `setGlobalIntelProvider(fi.globalIntelFor)` once, when
 *     it is built;
 *   · the brain's `global-intel` module calls `globalIntelFor(owner)`.
 *
 * Two rules keep this honest:
 *
 *   1. **The provider is optional.** Until `fios` exists the module
 *      reports `PROVIDER_NOT_WIRED` — a named, honest reason — and never
 *      a fabricated number.
 *   2. **The provider is per-owner.** `globalIntelFor` takes an owner, and
 *      the brain always passes its own. There is no shared snapshot
 *      between two users, because there is no shared snapshot at all: the
 *      engine builds one per owner.
 *
 * WHY NOT IMPORT THE ENGINE DIRECTLY
 *
 * `server/fios/globalIntel.js` is 35 KB and it lazily imports four
 * provider modules (smart money, whales, chain intel). Importing it from
 * `server/ci/modules.js` would put those on the boot path of every
 * serverless cold start — the exact cost §5 of
 * `docs/PHASE-CPU-AND-DARK-PHASES.md` was written to avoid. The bridge
 * keeps `fios` where it is: loaded on first use.
 */

let provider = null;

/**
 * Register the global-intelligence reader.
 *
 * @param {(owner: string, opts?: { refresh?: boolean }) => Promise<any>} fn
 *   The `globalIntelFor` closure from `createFinancialIntelligence`.
 * @returns {() => void} a disposer, so a test can restore the previous state.
 */
export function setGlobalIntelProvider(fn) {
  const previous = provider;
  provider = typeof fn === 'function' ? fn : null;
  return () => { provider = previous; };
}

/** True once `fios` has wired itself in. */
export function hasGlobalIntelProvider() {
  return typeof provider === 'function';
}

/**
 * Read the global snapshot for one owner.
 *
 * Returns a named failure instead of throwing, because the brain treats a
 * missing domain as a readable "this is not available right now" — and an
 * exception in a module read would take the whole turn down with it.
 *
 * @returns {Promise<{ ok: true, snapshot: any } | { ok: false, code: string, detail: string }>}
 */
export async function readGlobalIntel(owner, opts = {}) {
  if (typeof provider !== 'function') {
    return {
      ok: false,
      code: 'PROVIDER_NOT_WIRED',
      detail: 'the global intelligence engine is not mounted in this process'
    };
  }
  try {
    const snapshot = await provider(owner, opts);
    if (!snapshot || typeof snapshot !== 'object') {
      return { ok: false, code: 'NO_GLOBAL_SNAPSHOT', detail: 'the global engine answered with nothing' };
    }
    return { ok: true, snapshot };
  } catch (err) {
    return {
      ok: false,
      code: 'GLOBAL_INTEL_FAILED',
      detail: String(err?.message || err || '').slice(0, 160)
    };
  }
}
