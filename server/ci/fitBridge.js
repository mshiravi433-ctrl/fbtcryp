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
let macroProvider = null;
let scenarioProvider = null;

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
 * Register the macro-graph reader (path 12).
 *
 * The macro graph is the REGIME: the global snapshot, the world model and
 * the portfolio read together, with the transmission edges between them.
 * It is a different read from the global snapshot — the snapshot is the
 * domains, the graph is what they do to each other — so it gets its own
 * slot rather than being folded into the fit provider.
 *
 * @param {(owner: string, opts?: object) => Promise<any>} fn
 * @returns {() => void} a disposer.
 */
export function setMacroGraphProvider(fn) {
  const previous = macroProvider;
  macroProvider = typeof fn === 'function' ? fn : null;
  return () => { macroProvider = previous; };
}

/** True once the macro-graph reader is wired. */
export function hasMacroGraphProvider() {
  return typeof macroProvider === 'function';
}

/**
 * Read the macro graph for one owner.
 *
 * @returns {Promise<{ ok: true, graph: any } | { ok: false, code: string, detail: string }>}
 */
export async function readMacroGraph(owner, opts = {}) {
  if (typeof macroProvider !== 'function') {
    return {
      ok: false,
      code: 'PROVIDER_NOT_WIRED',
      detail: 'the macro graph is not mounted in this process'
    };
  }
  try {
    const out = await macroProvider(owner, opts);
    if (!out || typeof out !== 'object') {
      return { ok: false, code: 'NO_MACRO_GRAPH', detail: 'the macro graph answered with nothing' };
    }
    /* The graph reports its own failure with `ok:false`; that is an honest
       answer and it travels with its code. */
    if (out.ok === false) {
      return { ok: false, code: out.code || 'NO_MACRO_GRAPH', detail: out.detail || null };
    }
    return { ok: true, graph: out };
  } catch (err) {
    return {
      ok: false,
      code: 'MACRO_GRAPH_FAILED',
      detail: String(err?.message || err || '').slice(0, 160)
    };
  }
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

/**
 * Register the goal-scenario reader (path 13).
 *
 * The scenario engine builds THREE profiles (conservative, balanced,
 * aggressive) for a target, each with its allocation, expected value,
 * drawdown, probability of loss and probability of halving — and, when
 * the capital is unreadable, it refuses: "a scenario needs real capital;
 * nothing was modelled and nothing was guessed".
 *
 * The brain's own `goals.simulate` computes a feasibility figure. The
 * scenario engine is the other half: what the path LOOKS like, and how
 * likely each version of it is to arrive.
 *
 * @param {(owner: string, opts?: object) => Promise<any>} fn
 * @returns {() => void} a disposer.
 */
export function setScenarioProvider(fn) {
  const previous = scenarioProvider;
  scenarioProvider = typeof fn === 'function' ? fn : null;
  return () => { scenarioProvider = previous; };
}

/** True once the scenario reader is wired. */
export function hasScenarioProvider() {
  return typeof scenarioProvider === 'function';
}

/**
 * Read the goal scenarios for one owner.
 *
 * @returns {Promise<{ ok: true, scenarios: any } | { ok: false, code: string, detail: string }>}
 */
export async function readScenarios(owner, opts = {}) {
  if (typeof scenarioProvider !== 'function') {
    return {
      ok: false,
      code: 'PROVIDER_NOT_WIRED',
      detail: 'the goal-scenario engine is not mounted in this process'
    };
  }
  try {
    const out = await scenarioProvider(owner, opts);
    if (!out || typeof out !== 'object') {
      return { ok: false, code: 'NO_SCENARIOS', detail: 'the scenario engine answered with nothing' };
    }
    /* The engine's own refusal is an answer — it names why it did not
       model anything, and that reason must reach the user. */
    if (out.ok === false) {
      return { ok: false, code: out.code || 'NO_SCENARIOS', detail: out.detail || null };
    }
    return { ok: true, scenarios: out };
  } catch (err) {
    return {
      ok: false,
      code: 'SCENARIOS_FAILED',
      detail: String(err?.message || err || '').slice(0, 160)
    };
  }
}
