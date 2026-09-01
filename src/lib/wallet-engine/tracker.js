/**
 * FBT WALLET ENGINE — REAL-TIME TRANSACTION TRACKER
 * ---------------------------------------------------------------------------
 * A transaction does not go from "sent" to "done" in one step. The tracker
 * turns the state ladder into a live event stream:
 *
 *   Prepared → Signed → Broadcast → Pending → Confirmed
 *                    ↘ Failed / Cancelled / Expired
 *
 * Subscribers (the UI, the notification engine, an analytics sink) register
 * once and receive every transition. The tracker is transport-agnostic on
 * purpose: `emit` is a synchronous function, so wiring it to a WebSocket /
 * SSE / EventSource broadcast on the server is a one-line adapter, while the
 * in-browser use stays a plain in-memory stream.
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · An event is only emitted for a state that the wallet state machine has
 *   actually reached — the tracker is fed by the orchestrator, never by guess.
 * · `timeline(txId)` returns the ordered events or null; "no timeline" is
 *   distinguished from "empty timeline" by returning null for unknown ids.
 */

export const TRACKER_SCHEMA = 'fbt.tracker.v1';

/** The canonical event vocabulary (mirrors the state machine's ladder). */
export const TRACKER_EVENTS = Object.freeze([
  'PREPARED', 'SIGNED', 'BROADCAST', 'PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'EXPIRED'
]);

export function createTracker() {
  const subscribers = new Set();
  const timelines = new Map();

  const record = (txId, event) => {
    if (!timelines.has(txId)) timelines.set(txId, []);
    timelines.get(txId).push(event);
    return event;
  };

  return {
    schema: TRACKER_SCHEMA,

    /** Subscribe to every event. Returns an unsubscribe function. */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    /**
     * Emit a transition. `state` is the wallet-state-machine state the
     * orchestrator just reached; it is mapped to the public event vocabulary.
     */
    emit(txId, state, payload = {}) {
      const s = String(state || '').toUpperCase();
      const eventName = s === 'ACTION_PREPARED' ? 'PREPARED'
        : s === 'AWAITING_SIGNATURE' ? 'SIGNED'
          : s === 'SIGNED' ? 'SIGNED'
            : s === 'BROADCASTED' ? 'BROADCAST'
              : s === 'PENDING' ? 'PENDING'
                : s === 'CONFIRMED' ? 'CONFIRMED'
                  : s === 'FAILED' ? 'FAILED'
                    : s === 'CANCELLED' ? 'CANCELLED'
                      : s === 'EXPIRED' ? 'EXPIRED'
                        : null;
      if (!eventName) return null;
      const event = {
        schema: 'fbt.tracker-event.v1',
        txId: String(txId),
        event: eventName,
        state: s,
        ts: Date.now(),
        payload: payload && typeof payload === 'object' ? payload : {}
      };
      record(txId, event);
      for (const fn of [...subscribers]) {
        try { fn(event); } catch { /* a subscriber must not break the stream */ }
      }
      return event;
    },

    /** Ordered events for one tx, or null when the tx was never tracked. */
    timeline(txId) {
      return timelines.has(txId) ? timelines.get(txId).slice() : null;
    },

    /** The latest event for a tx, or null. */
    latest(txId) {
      const tl = timelines.get(txId);
      return tl && tl.length ? tl[tl.length - 1] : null;
    },

    /** All tracked tx ids. */
    txIds() {
      return [...timelines.keys()];
    }
  };
}
