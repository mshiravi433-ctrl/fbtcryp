/**
 * LENDING ENGINE — circuit breaker (§27/§28 of the production spec).
 * ---------------------------------------------------------------------------
 * When the oracle is misbehaving, the protocol stops answering, RPCs fail,
 * data goes stale or a reorg is suspected, the system must degrade in
 * three steps instead of crashing or (worse) executing blindly:
 *
 *   NORMAL → DEGRADED → READ_ONLY
 *
 * In READ_ONLY the user still sees markets and positions (§28 banner), but
 * `canTransact()` is false: no new quote/transaction is built or broadcast.
 * The breaker tracks per-component failures (rpc / oracle / protocol /
 * data / reorg) inside a sliding window, so a single blip degrades while a
 * sustained outage trips the breaker open.
 *
 * Pure module — the server holds one instance; the client can hold a mirror
 * fed by the /api/lending/status response.
 */

export const CIRCUIT_STATE = Object.freeze({
  NORMAL: 'NORMAL',
  DEGRADED: 'DEGRADED',
  READ_ONLY: 'READ_ONLY'
});

export const COMPONENTS = Object.freeze(['rpc', 'oracle', 'protocol', 'data', 'reorg']);

export function createCircuitBreaker({
  windowMs = 5 * 60 * 1000,   // how long a failure counts
  openThreshold = 3,          // failures of one component that open the breaker
  degradedThreshold = 1       // any failure degrades
} = {}) {
  const failures = new Map(); // component → [{ at }]
  const notes = new Map();    // component → last reason

  const sweep = () => {
    const cutoff = Date.now() - windowMs;
    for (const [component, list] of failures) {
      const kept = list.filter((f) => f.at > cutoff);
      if (kept.length) failures.set(component, kept);
      else failures.delete(component);
    }
  };

  const count = (component) => (failures.get(component) || []).length;

  const breaker = {
    /** Record a healthy or failed probe for a component. */
    report(component, ok, reason = null) {
      if (!COMPONENTS.includes(component)) return breaker;
      if (ok) {
        failures.delete(component);
        notes.delete(component);
        return breaker;
      }
      const list = failures.get(component) || [];
      list.push({ at: Date.now() });
      while (list.length > Math.max(openThreshold, degradedThreshold) + 8) list.shift();
      failures.set(component, list);
      if (reason) notes.set(component, String(reason).slice(0, 120));
      return breaker;
    },

    failureCount(component) { sweep(); return count(component); },

    state() {
      sweep();
      const anyFailure = [...failures.keys()].length > 0;
      const opened = [...failures.entries()].some(([, list]) => list.length >= openThreshold);
      if (opened) return CIRCUIT_STATE.READ_ONLY;
      if (anyFailure) return CIRCUIT_STATE.DEGRADED;
      return CIRCUIT_STATE.NORMAL;
    },

    /** The §27 gate: READ_ONLY refuses new transactions, reads still work. */
    canTransact() { return breaker.state() !== CIRCUIT_STATE.READ_ONLY; },

    snapshot() {
      sweep();
      return {
        state: breaker.state(),
        canTransact: breaker.canTransact(),
        failures: Object.fromEntries([...failures.entries()].map(([c, list]) => [c, list.length])),
        reasons: Object.fromEntries(notes.entries()),
        readOnly: breaker.state() === CIRCUIT_STATE.READ_ONLY
      };
    },

    reset() { failures.clear(); notes.clear(); return breaker; }
  };

  return breaker;
}
