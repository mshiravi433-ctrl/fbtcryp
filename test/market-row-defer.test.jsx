// @vitest-environment jsdom
/**
 * THE ROW DRAWS ITS NUMBERS FIRST, AND ITS SHAPE WHEN IT ARRIVES
 * ---------------------------------------------------------------------------
 * «صفحه بازار خیلی کند هست … گاهی چشمک میزنه، و گاهی ایکون بعضی باکس ها دیر
 * بالا میاد» — the scroll cost of this screen was sixty SVG sparklines painted
 * in one commit, fifty of them for rows nobody can see yet.
 *
 * The fix withholds ONLY that decoration (see components/CoinRow.jsx and
 * hooks/useRowWindow.js). This test is the part a structural pin cannot prove:
 *
 *   1. a deferred row still renders its price, its move, its name and its tap
 *      target on the FIRST paint — nothing a reader acts on may wait for an
 *      observer;
 *   2. no sparkline is drawn until the row is near the viewport;
 *   3. when the observer reports it, the shape appears — and the numbers are
 *      the same numbers, pixel for pixel;
 *   4. a row that is never deferred (a search hit, a hero) draws immediately;
 *   5. a browser with no IntersectionObserver draws everything, so the deferral
 *      can never leave a row blank.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import CoinRow from '../src/components/CoinRow.jsx';

const COIN = {
  id: 'ethereum',
  symbol: 'ETH',
  name: 'Ethereum',
  image: '',
  price: 3420.55,
  change24h: 4.12,
  sparkline: [3300, 3350, 3400, 3420]
};

const sparkOf = (container) => container.querySelector('.coin-row-spark svg');

describe('a market row defers its decoration, never its numbers', () => {
  let observed;

  beforeEach(() => {
    observed = [];
    class FakeIO {
      constructor(callback) {
        this.callback = callback;
        FakeIO.instances.push(this);
      }
      observe(node) {
        observed.push(node);
      }
      disconnect() {
        this.disconnected = true;
      }
    }
    FakeIO.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIO);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /* The observer answers outside React's event system, exactly as a real one
     does; `act` is what lets the resulting render be committed here. */
  const intersectAll = () => {
    act(() => {
      for (const io of IntersectionObserver.instances) {
        io.callback([{ isIntersecting: true }]);
      }
    });
  };

  it('paints every reading and the tap target before the shape', () => {
    const { container } = render(<CoinRow coin={COIN} rank={2} deferSpark onClick={() => {}} />);

    /* The row exists, is focusable and carries its accessible name. */
    const button = container.querySelector('button.coin-row-open');
    expect(button, 'the row is a real button on the first paint').toBeTruthy();
    expect(button.getAttribute('aria-label')).toBe('Ethereum (ETH)');

    /* Every number a reader acts on is on screen immediately. */
    expect(container.textContent).toContain('ETH');
    expect(container.textContent).toContain('Ethereum');
    expect(container.textContent).toContain('4.12');
    expect(container.querySelector('.coin-price').textContent.length).toBeGreaterThan(0);
    expect(container.querySelector('.coin-change-pill').className).toContain('is-up');

    /* The decoration is not, and the column keeps its width so nothing moves. */
    const spark = container.querySelector('.coin-row-spark');
    expect(spark).toBeTruthy();
    expect(spark.getAttribute('data-spark')).toBe('off');
    expect(sparkOf(container)).toBeNull();
    expect(observed.length, 'the row asked to be told when it is seen').toBe(1);
  });

  it('draws the shape when the row arrives, with the same numbers beside it', () => {
    const { container } = render(<CoinRow coin={COIN} rank={2} deferSpark onClick={() => {}} />);
    const before = container.querySelector('.coin-price').textContent;

    intersectAll();

    expect(sparkOf(container), 'the sparkline appears once the row is near').toBeTruthy();
    expect(container.querySelector('.coin-row-spark').getAttribute('data-spark')).toBe('on');
    expect(container.querySelector('.coin-price').textContent).toBe(before);
  });

  it('never defers a row the caller did not ask to defer', () => {
    const { container } = render(<CoinRow coin={COIN} onClick={() => {}} />);
    expect(container.querySelector('.coin-row-spark').getAttribute('data-spark')).toBe('on');
    expect(sparkOf(container)).toBeTruthy();
    expect(observed.length, 'an eager row never even opens an observer').toBe(0);
  });

  it('draws everything when the browser has no IntersectionObserver', () => {
    vi.unstubAllGlobals();
    delete globalThis.IntersectionObserver;
    const { container } = render(<CoinRow coin={COIN} deferSpark onClick={() => {}} />);
    expect(sparkOf(container), 'a missing observer must never leave the row blank').toBeTruthy();
  });
});
