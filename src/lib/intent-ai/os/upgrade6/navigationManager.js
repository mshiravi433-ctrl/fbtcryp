/**
 * FBT AI / Intent OS — UPGRADE 6
 * NavigationIntentManager — Prevent Navigation Loops
 * Spec §3, §23
 */

const STORAGE_KEY = 'fbt.nav.manager.v6';

function makeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `nav_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function now() { return Date.now(); }

export function createNavigationRecord({ source, target, reason, intentId, sessionId } = {}) {
  return {
    navigationId: makeId(),
    source: source || '/',
    target: target || '/',
    reason: reason || 'unknown',
    intentId: intentId || null,
    sessionId: sessionId || null,
    timestamp: now(),
    completed: false,
    returned: false
  };
}

class NavigationIntentManager {
  constructor() {
    this.history = this.load();
    this.pending = null;
  }

  load() {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(-100) : [];
    } catch {
      return [];
    }
  }

  save() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history.slice(-100)));
    } catch {}
  }

  /**
   * Start navigation — returns record, checks for loops
   *
   * ─── THE LOOP CHECK NO LONGER REFUSES ────────────────────────────────────
   * It used to return `{ allowed: false, reason: 'navigation_loop' }` once the
   * same target appeared twice in the last five records. `this.history` is
   * persisted to localStorage, so that verdict outlived the session: a user
   * who had opened /signals twice could never open it from the assistant
   * again, and nothing on screen explained why.
   *
   * The count is still measured and returned as `loopCount` — repeated
   * navigation is worth knowing about — but it never blocks. Only a genuine
   * no-op (already on the target) is declined.
   */
  startNavigation({ source, target, reason, intentId, sessionId } = {}) {
    // Rule: Returning to Chat ≠ Repeat Previous Navigation
    if (target === '/intent' && source !== '/intent') {
      const record = createNavigationRecord({ source, target, reason: 'return_to_chat', intentId, sessionId });
      record.completed = true;
      record.returned = true;
      this.history.push(record);
      this.save();
      return { allowed: true, record, reason: 'return_to_chat' };
    }

    // Same route guard
    if (source === target) {
      return { allowed: false, reason: 'same_route' };
    }

    // Loop measurement — telemetry only, see the note above.
    const recent = this.history.slice(-5);
    const loopCount = recent.filter((r) => r.target === target).length;

    const record = createNavigationRecord({ source, target, reason, intentId, sessionId });
    this.pending = record;
    this.history.push(record);
    this.save();
    return {
      allowed: true,
      record,
      reason: loopCount >= 2 ? 'repeat_navigation' : 'new_navigation',
      loopCount
    };
  }

  completeNavigation(navigationId) {
    const rec = this.history.find((r) => r.navigationId === navigationId);
    if (rec) {
      rec.completed = true;
      rec.completedAt = now();
      this.save();
    }
    if (this.pending?.navigationId === navigationId) {
      this.pending = null;
    }
    return rec;
  }

  markReturned(navigationId) {
    const rec = this.history.find((r) => r.navigationId === navigationId);
    if (rec) {
      rec.returned = true;
      rec.returnedAt = now();
      this.save();
    }
    return rec;
  }

  /**
   * Should we allow navigation when user returns to chat?
   * Spec: After returning, don't re-open previous page unless:
   * 1. New request
   * 2. Operation incomplete
   * 3. Really needed for continuation
   */
  shouldRepeatAfterReturn({ previousTarget, currentIntent, previousIntent, isNewRequest = false, isIncomplete = false, isNeededForContinuation = false } = {}) {
    if (isNewRequest) return { allowed: true, reason: 'new_request' };
    if (isIncomplete) return { allowed: true, reason: 'incomplete_operation' };
    if (isNeededForContinuation) return { allowed: true, reason: 'needed_for_continuation' };
    // Default: do NOT repeat
    return { allowed: false, reason: 'return_no_repeat', previousTarget };
  }

  getHistory() {
    return [...this.history];
  }

  getLastNavigation() {
    return this.history.length ? this.history[this.history.length - 1] : null;
  }

  clear() {
    this.history = [];
    this.pending = null;
    this.save();
  }

  /**
   * Check if navigation would be a loop
   */
  isLoop(target, windowSize = 3) {
    const recent = this.history.slice(-windowSize);
    return recent.filter((r) => r.target === target).length >= 2;
  }
}

// Singleton
let instance = null;
export function getNavigationManager() {
  if (!instance) instance = new NavigationIntentManager();
  return instance;
}

export function resetNavigationManager() {
  if (instance) instance.clear();
  instance = null;
}
