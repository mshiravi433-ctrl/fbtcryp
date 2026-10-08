/**
 * VISIBILITY POLL — the helper behind every "stop polling a hidden tab" fix.
 * ---------------------------------------------------------------------------
 * The bug this guards is not a crash, so no render test would ever catch it:
 * a screen that polls `/api/...` every 10–60 seconds kept doing it after the
 * user switched away, and on the serverless host each tick is a function
 * invocation (a cold start, a real provider read, a line on the CPU bill).
 * Measured on the deployed app, the pollers covered by this helper accounted
 * for ~1.1 million wasted requests a day for a few hundred real users.
 *
 * These tests pin the three properties the fix depends on:
 *   1. a HIDDEN tab does not tick;
 *   2. returning to the tab ticks IMMEDIATELY (so the screen is never stale);
 *   3. cleanup clears both the timer and the listener (no leaks, no ticking
 *      after unmount).
 *
 * The `hidden` value matters: jsdom reports `visibilityState === 'prerender'`
 * with `document.hidden === true`. A `document.hidden` check would silently
 * freeze every poll inside the test suites, so the helper asks for `'hidden'`
 * explicitly — and test 1 below fails loudly if that ever changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPollHidden, pollWhileVisible } from '../src/lib/visibilityPoll.js';

/** A minimal document stand-in: state + listeners, nothing else. */
function fakeDoc(initial = 'visible') {
  const listeners = new Set();
  const doc = {
    visibilityState: initial,
    addEventListener: (name, fn) => { if (name === 'visibilitychange') listeners.add(fn); },
    removeEventListener: (name, fn) => { if (name === 'visibilitychange') listeners.delete(fn); },
    /* test-only helpers */
    set(state) { doc.visibilityState = state; for (const fn of [...listeners]) fn(); },
    listenerCount: () => listeners.size
  };
  return doc;
}

/*
 * The helper reads `document` when the poller is CREATED (so a tick can never
 * be judged against a different document than the listener that woke it), so
 * the stand-in has to be installed around the CREATE call — the ticks that
 * follow use the captured reference and keep working after it is removed.
 */
const withDocument = (doc, fn) => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  try { return fn(); } finally {
    if (prev) Object.defineProperty(globalThis, 'document', prev);
    else delete globalThis.document;
  }
};

afterEach(() => {
  vi.useRealTimers();
});

describe('pollWhileVisible', () => {
  it('ticks on the interval while the tab is visible', () => {
    vi.useFakeTimers();
    const doc = fakeDoc('visible');
    const calls = vi.fn();
    const stop = withDocument(doc, () => pollWhileVisible(calls, 1000));

    vi.advanceTimersByTime(3500);
    expect(calls).toHaveBeenCalledTimes(3);
    stop();
  });

  it('does NOT tick while the tab is hidden', () => {
    vi.useFakeTimers();
    const doc = fakeDoc('hidden');
    const calls = vi.fn();
    const stop = withDocument(doc, () => pollWhileVisible(calls, 1000));

    vi.advanceTimersByTime(60_000);
    expect(calls).not.toHaveBeenCalled();
    stop();
  });

  it('ticks IMMEDIATELY when the tab becomes visible again', () => {
    vi.useFakeTimers();
    const doc = fakeDoc('hidden');
    const calls = vi.fn();
    const stop = withDocument(doc, () => pollWhileVisible(calls, 60_000));

    /* 5 minutes hidden — nothing. */
    vi.advanceTimersByTime(300_000);
    expect(calls).not.toHaveBeenCalled();

    /* Coming back is not a wait: the first tick is synchronous with the
       event, which is why no screen shows stale numbers after a tab switch. */
    doc.set('visible');
    expect(calls).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(calls).toHaveBeenCalledTimes(2);
    stop();
  });

  it('resumes ticking only after returning, not for a hidden-then-hidden change', () => {
    vi.useFakeTimers();
    const doc = fakeDoc('hidden');
    const calls = vi.fn();
    const stop = withDocument(doc, () => pollWhileVisible(calls, 1000));

    doc.set('hidden');
    vi.advanceTimersByTime(5000);
    expect(calls).not.toHaveBeenCalled();

    doc.set('visible');
    expect(calls).toHaveBeenCalledTimes(1);
    stop();
  });

  it('cleanup stops both the timer and the listener', () => {
    vi.useFakeTimers();
    const doc = fakeDoc('visible');
    const calls = vi.fn();
    const stop = withDocument(doc, () => pollWhileVisible(calls, 1000));

    vi.advanceTimersByTime(2000);
    expect(calls).toHaveBeenCalledTimes(2);
    expect(doc.listenerCount()).toBe(1);

    stop();
    expect(doc.listenerCount()).toBe(0);

    vi.advanceTimersByTime(10_000);
    doc.set('visible');
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('a throwing poll never takes the screen down and never stops the clock', () => {
    vi.useFakeTimers();
    const doc = fakeDoc('visible');
    const calls = vi.fn(() => { throw new Error('UPSTREAM_DOWN'); });
    const stop = withDocument(doc, () => pollWhileVisible(calls, 1000));

    expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
    expect(calls).toHaveBeenCalledTimes(3);
    stop();
  });

  it('isPollHidden is true only for the state a real browser calls hidden', () => {
    expect(withDocument(fakeDoc('hidden'), isPollHidden)).toBe(true);
    expect(withDocument(fakeDoc('visible'), isPollHidden)).toBe(false);
    /* jsdom's default — must NOT count as hidden, or tests stop seeing polls. */
    expect(withDocument(fakeDoc('prerender'), isPollHidden)).toBe(false);
  });
});
