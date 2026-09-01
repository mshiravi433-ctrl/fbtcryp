/**
 * FBT CENTRAL INTELLIGENCE OS — Event Bus (§15, §17).
 * ---------------------------------------------------------------------------
 * Every important occurrence in FBT flows through this bus: wallet connects,
 * balance changes, completed swaps, loans, signals, news, goal progress.
 *
 * The brain SUBSCRIBES to events (e.g. to refresh state after a transaction,
 * §16) and external modules PUBLISH them. In-process today; the interface is
 * transport-agnostic so a WebSocket/SSE/queue transport can be dropped in
 * without changing a single publisher (§17).
 *
 * Honesty rule: the bus keeps a bounded ring buffer (500 events) for
 * observability. It never persists payloads containing secrets — publish()
 * strips the usual suspects before storing.
 */
import { randomUUID } from 'node:crypto';
import { EVENT_TYPES } from './constants.js';

const MAX_EVENTS = 500;
const KNOWN = new Set(EVENT_TYPES);
const SECRET_KEY_RE = /(private[_-]?key|seed|mnemonic|secret|password|token)/i;

function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload ?? null;
  if (Array.isArray(payload)) return payload.slice(0, 24).map(sanitizePayload);
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (SECRET_KEY_RE.test(k)) continue; // never store secrets, §35
    if (v && typeof v === 'object') out[k] = sanitizePayload(v);
    else out[k] = v;
  }
  return out;
}

const ring = [];
const subscribers = new Map(); // type -> Set<handler>
const prefixSubscribers = new Map(); // 'prefix.*' -> Set<handler>

function notify(type, event) {
  const exact = subscribers.get(type);
  if (exact) for (const h of exact) { try { h(event); } catch { /* observer must not break the bus */ } }
  for (const [pattern, set] of prefixSubscribers) {
    const prefix = pattern.endsWith('.*') ? pattern.slice(0, -1) : pattern;
    if (type.startsWith(prefix)) {
      for (const h of set) { try { h(event); } catch { /* same */ } }
    }
  }
}

/**
 * Publish an event. Unknown types are allowed (modules may define their own)
 * but flagged, so the vocabulary in constants.js stays the canonical list.
 */
export function publish(type, payload = {}, meta = {}) {
  const event = {
    eventId: randomUUID(),
    type: String(type || 'UNKNOWN'),
    known: KNOWN.has(String(type || '')),
    at: Date.now(),
    source: String(meta.source || 'central'),
    payload: sanitizePayload(payload)
  };
  ring.push(event);
  if (ring.length > MAX_EVENTS) ring.splice(0, ring.length - MAX_EVENTS);
  // Async-free delivery: handlers must be fast; heavy work belongs in jobs.
  notify(event.type, event);
  return event;
}

/** Subscribe to one exact type, or a prefix pattern like 'SWAP.*'. */
export function subscribe(type, handler) {
  const map = type.endsWith('.*') || type.endsWith('.') ? prefixSubscribers : subscribers;
  if (!map.has(type)) map.set(type, new Set());
  map.get(type).add(handler);
  return () => map.get(type)?.delete(handler);
}

/** Recent events, newest first, optionally filtered by type prefix. */
export function recentEvents({ type = null, limit = 50 } = {}) {
  const rows = type ? ring.filter((e) => e.type === type || e.type.startsWith(`${type}.`)) : ring.slice();
  return rows.slice(-Math.max(1, Math.min(limit, MAX_EVENTS))).reverse();
}

/** Test/maintenance hook: wipe in-memory history (subscriptions survive). */
export function resetEvents() {
  ring.length = 0;
}

export function eventStats() {
  const byType = {};
  for (const e of ring) byType[e.type] = (byType[e.type] || 0) + 1;
  return { buffered: ring.length, capacity: MAX_EVENTS, byType };
}
