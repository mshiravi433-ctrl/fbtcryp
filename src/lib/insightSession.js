import { useSyncExternalStore } from 'react';

/**
 * In-memory bridge between the News intelligence tab and the global header.
 *
 * Verified tokenized-equity rows are intentionally NOT persisted: the source
 * module fails closed when issuer verification cannot run, and writing those
 * rows to localStorage would bring revoked or stale listings back after a
 * restart. The header may reuse fresh rows during this session and otherwise
 * simply rotates crypto/news items.
 */
let equities = [];
const listeners = new Set();

export function publishInsightEquities(rows) {
  equities = Array.isArray(rows) ? rows : [];
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return equities;
}

export function useInsightEquities() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
