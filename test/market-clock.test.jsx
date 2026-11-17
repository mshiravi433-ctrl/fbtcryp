// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, cleanup, render } from '@testing-library/react';
import { useSharedClock, __clockState } from '../src/hooks/useSharedClock';

/*
 * THE SHARED CLOCK.
 *
 * Three age labels on the market screen (MarketFreshness 10 s, BtClock 15 s,
 * DecisionOrb 15 s) each used to own a `setInterval`. Owning the STATE is
 * right — it keeps the page above from re-rendering. Owning a TIMER each is
 * not: three unaligned wakeups, three chances to leak one, and two labels on
 * the same screen that can disagree about the current second.
 *
 * These tests assert the properties that make the change worth making:
 *   1. N subscribers on one period share ONE interval;
 *   2. the last unsubscribe tears it down (no leak on route change);
 *   3. `enabled: false` holds no interval at all;
 *   4. a hidden tab stops ticking and a visible one corrects immediately;
 *   5. every subscriber sees the SAME millisecond.
 */

const Probe = ({ period = 15000, enabled = true, label = 'a', onTick }) => {
  const now = useSharedClock(period, enabled);
  onTick?.(label, now);
  return <span data-testid={label}>{now}</span>;
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const live = () => __clockState().filter((s) => s.running || s.subscribers > 0);

describe('useSharedClock', () => {
  it('gives every subscriber on one period a single interval', () => {
    render(<><Probe label="a" /><Probe label="b" /><Probe label="c" /></>);
    const running = __clockState().filter((s) => s.periodMs === 15000 && s.running);
    expect(running).toHaveLength(1);
    expect(running[0].subscribers).toBe(3);
    /* Every tick reaches all three: clearing the shared interval is the only
       way to stop them. */
    act(() => { vi.advanceTimersByTime(15000); });
    expect(__clockState().filter((s) => s.periodMs === 15000 && s.running)).toHaveLength(1);
  });

  it('keeps one interval PER PERIOD, not one global ticker', () => {
    render(<><Probe label="fast" period={10000} /><Probe label="slow" period={15000} /></>);
    const state = __clockState();
    expect(state.find((s) => s.periodMs === 10000)?.running).toBe(true);
    expect(state.find((s) => s.periodMs === 15000)?.running).toBe(true);
    /* Two periods, two intervals — a subscriber at 10 s is not served by a
       15 s clock, and pretending otherwise would drop its update. */
    expect(state.filter((s) => s.running)).toHaveLength(2);
  });

  it('tears the interval down when the last subscriber leaves', () => {
    const { unmount } = render(<><Probe label="a" /><Probe label="b" /></>);
    expect(__clockState().filter((s) => s.running)).toHaveLength(1);
    unmount();
    /* Nothing left running: leaving /market must not leave a timer behind. */
    expect(live()).toHaveLength(0);
  });

  it('holds no interval at all when disabled', () => {
    render(<Probe label="a" enabled={false} />);
    expect(live()).toHaveLength(0);
  });

  it('stops ticking in a hidden tab and corrects the moment it returns', () => {
    const seen = [];
    render(<Probe label="a" onTick={(l, now) => seen.push(now)} />);

    /* Hide the tab: the interval is cleared outright, not merely skipped. */
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    /* Fake timers freeze Date.now(), and a state write with an identical
       timestamp is a no-op in React — move the wall clock too, otherwise this
       test would "prove" the correction missing for the wrong reason. */
    vi.setSystemTime(Date.now() + 120000);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(__clockState().filter((s) => s.running)).toHaveLength(0);

    /* Come back later: the clock is re-read at once rather than waiting a full
       period, so a backgrounded tab cannot re-appear claiming the old age. */
    const before = seen.length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(seen.length).toBeGreaterThan(before);
    expect(__clockState().filter((s) => s.running)).toHaveLength(1);
  });

  it('hands every subscriber the SAME millisecond', () => {
    const times = {};
    render(
      <>
        <Probe label="a" onTick={(l, now) => { times[l] = now; }} />
        <Probe label="b" onTick={(l, now) => { times[l] = now; }} />
      </>
    );
    act(() => { vi.advanceTimersByTime(15000); });
    expect(times.a).toBe(times.b);
  });
});

describe('the three components on the market screen', () => {
  /* The whole point is that these three now share; a future edit that puts a
     private interval back would pass every other test in this file. */
  const CASES = [
    ['src/components/market/MarketFreshness.jsx', 'MarketFreshness'],
    ['src/components/market/MarketOverview.jsx', 'BtClock (in MarketOverview)'],
    ['src/components/DecisionOrb.jsx', 'DecisionOrb'],
  ];

  for (const [file, name] of CASES) {
    it(`${name} takes its clock from the shared hook`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('useSharedClock');
      /* No private interval left anywhere in the file. */
      expect(src).not.toMatch(/setInterval\s*\(/);
    });
  }

  it('the shared hook is the ONLY setInterval among them', () => {
    const hook = readFileSync('src/hooks/useSharedClock.js', 'utf8');
    /* Two call sites by design: the one that starts a period, and the one that
       restarts it when a hidden tab becomes visible again. */
    expect((hook.match(/setInterval\(/g) ?? []).length).toBe(2);
  });
});
