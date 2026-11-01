// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PageTabSwipe from '../src/components/PageTabSwipe.jsx';
afterEach(() => { cleanup(); document.documentElement.dir = ''; });
function setup({ rtl = false, disabled = false, tabs = true } = {}) {
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  const next = vi.fn();
  const view = render(<PageTabSwipe routeKey="/market">{tabs && <div role="tablist"><button role="tab" aria-selected="true">Overview</button><button role="tab" disabled={disabled} aria-selected="false" onClick={next}>Tokens</button></div>}<div data-testid="body">Content</div><input data-testid="input" /><div data-tab-swipe-ignore data-testid="chart">Chart</div></PageTabSwipe>);
  return { ...view, next };
}
function swipe(target, dx, dy = 0) {
  fireEvent.touchStart(target, { touches: [{ clientX: 150, clientY: 100 }] });
  fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: 150 + dx, clientY: 100 + dy }] });
}
describe('page-local swipe only', () => {
  it('moves to the next local tab in LTR', () => { const { next } = setup(); swipe(screen.getByTestId('body'), -90); expect(next).toHaveBeenCalledOnce(); });
  it('mirrors in RTL', () => { const { next } = setup({ rtl: true }); swipe(screen.getByTestId('body'), 90); expect(next).toHaveBeenCalledOnce(); });
  it('does not wrap past the first tab', () => { const { next } = setup(); swipe(screen.getByTestId('body'), 90); expect(next).not.toHaveBeenCalled(); });
  it('has no action without local tabs', () => { setup({ tabs: false }); swipe(screen.getByTestId('body'), -90); expect(screen.getByTestId('body').textContent).toBe('Content'); });
  it('leaves vertical scrolling and tiny gestures alone', () => { const { next } = setup(); swipe(screen.getByTestId('body'), -90, 100); swipe(screen.getByTestId('body'), -20); expect(next).not.toHaveBeenCalled(); });
  it('ignores inputs, charts and disabled destinations', () => { const { next } = setup({ disabled: true }); swipe(screen.getByTestId('input'), -90); swipe(screen.getByTestId('chart'), -90); swipe(screen.getByTestId('body'), -90); expect(next).not.toHaveBeenCalled(); });
  it('rejects a gesture that spans a page navigation', () => {
    const { next, rerender } = setup();
    fireEvent.touchStart(screen.getByTestId('body'), { touches: [{ clientX: 150, clientY: 100 }] });
    rerender(<PageTabSwipe routeKey="/wallet"><div data-testid="body">Wallet</div></PageTabSwipe>);
    fireEvent.touchEnd(screen.getByTestId('body'), { touches: [], changedTouches: [{ clientX: 50, clientY: 100 }] });
    expect(next).not.toHaveBeenCalled();
  });
});
