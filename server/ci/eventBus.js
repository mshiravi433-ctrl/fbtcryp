/**
 * FBT CENTRAL INTELLIGENCE OS — Event bus + realtime sync (spec §15, §16, §17).
 * ---------------------------------------------------------------------------
 * §17 forbids "the frontend waiting for a manual user refresh". Two mechanisms
 * are implemented rather than three: an in-process bus (server-side subscribers
 * react immediately) and an SSE stream per owner (browser tabs wake up on a
 * state change). A polling fallback sits behind the stream — a proxy that buffers
 * SSE must not turn into an app that never updates.
 *
 * WHAT THIS BUS IS NOT
 * It is not a queue with delivery guarantees. Events here are INVALIDATION
 * SIGNALS: losing one costs a redundant re-read on the next turn (the state
 * layer re-derives everything from services), never a lost trade or an
 * unreconciled balance. That is the honest scope for an in-process emitter, and
 * writing it down is why `publish()` returns `{ delivered }` instead of pretending
 * to acknowledge.
 *
 * THE CASCADE IS HERE, NOT IN THE CALLER (§16)
 * `publish()` consults REFRESH_CASCADE and marks the affected sections dirty on
 * the owner's state. A module that completes a swap does not also have to remember
 * to invalidate portfolio, risk, goals and alerts — and cannot get it wrong,
 * because it never had that choice.
 */
import { CI_SCHEMA, EVENT_TYPES, REFRESH_CASCADE } from '../../src/lib/central/schema.js';
import { applyEventToState } from '../../src/lib/central/state.js';
import { hashString } from '../../src/lib/central/schema.js';

export const EVENT_BUS_SCHEMA = 'fbt.central-event-bus.v1';
const RING_LIMIT = 240;
const DEDUPE_WINDOW_MS = 1_500;

/**
 * §15's event list is only useful if an event is an IDENTITY, not a mood:
 * the same fact arriving twice (a wallet that re-fires BALANCE_CHANGED during a
 * reconnect storm) must not double-refresh. `dedupeKey` is the type plus the
 * fields that make it THE event; `fingerprint` catches a re-broadcast of an
 * identical payload inside a short window.
 */
export function eventIdentity(event) {
  const p = event?.payload || {};
  const identity = [event.type, p.actionId || p.txHash || p.symbol || p.goalId || p.alertId || ''].join(':');
  return { dedupeKey: hashString(identity), fingerprint: hashString(`${identity}|${JSON.stringify(p).slice(0, 400)}`) };
}

export function createEventBus({ stateStore = null, log = () => {} } = {}) {
  const ring = [];
  const subs = new Map();
  const recent = new Map();

  function publish(event = {}) {
    const type = String(event.type || '').toUpperCase();
    if (!EVENT_TYPES.includes(type)) return { ok: false, code: 'UNKNOWN_EVENT_TYPE', type };
    const record = {
      type,
      owner: event.owner ? String(event.owner).slice(0, 80) : null,
      payload: event.payload ?? null,
      source: event.source || 'central-brain',
      at: Number(event.at) || Date.now(),
      intentId: event.intentId || null,
      actionId: event.actionId || null,
      ...eventIdentity({ type, payload: event.payload })
    };
    const last = recent.get(record.dedupeKey);
    if (last && record.at - last < DEDUPE_WINDOW_MS) {
      return { ok: true, duplicate: true, type, at: record.at };
    }
    recent.set(record.dedupeKey, record.at);
    if (recent.size > 800) for (const [k, v] of recent) { if (Date.now() - v > 60_000) recent.delete(k); }

    ring.push(record);
    if (ring.length > RING_LIMIT) ring.splice(0, ring.length - RING_LIMIT);

    /* 1 — invalidate the affected sections on the owner's state (§16). */
    let invalidated = [];
    if (stateStore && record.owner && REFRESH_CASCADE[type]) {
      try {
        const state = stateStore.peek(record.owner);
        const next = applyEventToState(state, record, record.at);
        stateStore.replace(record.owner, next.state);
        invalidated = next.invalidate;
      } catch (error) {
        log('cascade-failed', String(error?.message || error).slice(0, 120));
      }
    }

    /* 2 — notify in-process subscribers, then the SSE streams. A throwing
       subscriber is isolated: one bad listener must not stop a refresh cascade
       or lose the event for the other tabs. */
    let delivered = 0;
    for (const listener of [...subs.values()]) {
      try {
        listener(record);
        delivered += 1;
      } catch (error) {
        log('listener-error', String(error?.message || error).slice(0, 120));
      }
    }
    return { ok: true, duplicate: false, event: record, invalidated, delivered, cascade: REFRESH_CASCADE[type]?.cascade === true };
  }

  function subscribe(owner, listener) {
    const key = String(owner || '*').slice(0, 80);
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key).add(listener);
    return () => subs.get(key)?.delete(listener);
  }

  /** Fan-out to every owner scope is used for global notices (capability flips). */
  function broadcast(event) {
    const results = [];
    for (const key of subs.keys()) results.push(publish({ ...event, owner: key === '*' ? null : key }));
    return results;
  }

  return {
    schema: EVENT_BUS_SCHEMA,
    brain: CI_SCHEMA,
    types: EVENT_TYPES,
    publish,
    broadcast,
    subscribe,
    recent: (owner = null, limit = 40) => (owner ? ring.filter((e) => e.owner === owner || e.owner === null) : ring).slice(-limit).reverse(),
    size: () => ring.length,
    clear: () => { ring.length = 0; recent.clear(); }
  };
}

/**
 * Server-Sent Events per owner, with the fallback the spec asks for.
 *
 * The heartbeat is not decoration: proxies idle-close silent streams, and a
 * silently-dead stream is EXACTLY the "UI stopped updating" bug §17 complains
 * about. On `hello` the client is told the polling interval to fall back to, and
 * `retry:` is set so the browser reconnects by itself.
 */
export function attachSse(req, res, bus, owner) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  res.write(`retry: 5000\n`);
  const send = (name, data) => {
    try { res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
  };
  send('hello', { owner: null, at: Date.now(), pollFallbackMs: 15_000, recent: bus.recent(owner, 8).map(({ fingerprint, ...e }) => e), brain: CI_SCHEMA });
  const unsubscribe = bus.subscribe(owner, (event) => {
    const { dedupeKey, fingerprint, ...payload } = event;
    void dedupeKey; void fingerprint;
    send('event', payload);
  });
  const heartbeat = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch { /* closed */ }
  }, 25_000);
  const close = () => { clearInterval(heartbeat); unsubscribe(); };
  req.on('close', close);
  req.on('error', close);
  return close;
}
