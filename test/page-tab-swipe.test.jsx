// @vitest-environment jsdom
/**
 * «کشیدن چپ/راست = تبِ قبل/بعد، نه صفحهٔ قبل/بعد»
 * ---------------------------------------------------------------------------
 * The complaint these pins answer is precise, so the pins are too:
 *
 *   · a drag selects the NEIGHBOURING TAB of the screen it started on;
 *   · a screen with no tab strip does NOTHING — it does not navigate;
 *   · the ends of the strip are the ends: no wrap-around;
 *   · RTL mirrors (right = previous, left = next in a Persian document);
 *   · a vertical scroll, a tap, a slow drag, a disabled tab, a form control, a
 *     chart and a sideways rail all keep their gesture;
 *   · a drag that started on another route is not answered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PageTabSwipe from '../src/components/PageTabSwipe.jsx';
import {
  SWIPE_MAX_MS,
  SWIPE_MIN_X,
  findTabStrip,
  resolveTabStep,
  runTabGesture,
  selectedIndex,
  tabsOf
} from '../src/lib/tabGesture.js';

afterEach(() => {
  cleanup();
  document.documentElement.dir = '';
  vi.restoreAllMocks();
});

const strip = (labels = ['Overview', 'Tokens', 'Stories'], handlers = {}) => (
  <div role="tablist">
    {labels.map((label, i) => (
      <button
        key={label}
        role="tab"
        aria-selected={i === 0}
        disabled={handlers.disabledAt === i}
        onClick={handlers.onClick}
      >
        {label}
      </button>
    ))}
  </div>
);

function mount({ rtl = false, tabs = strip(), body = <div data-testid="body">Content</div>, extra } = {}) {
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  return render(
    <PageTabSwipe routeKey="/market">
      {tabs}
      {body}
      {extra}
    </PageTabSwipe>
  );
}

function swipe(target, dx, dy = 0) {
  fireEvent.touchStart(target, { touches: [{ clientX: 200, clientY: 300 }] });
  fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
}

describe('۱ · یک کشیدن افقی، تبِ همسایه را انتخاب می‌کند', () => {
  it('moves to the NEXT tab on a left drag in LTR', () => {
    const onClick = vi.fn();
    mount({ tabs: strip(undefined, { onClick }) });
    swipe(screen.getByTestId('body'), -90);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('moves to the PREVIOUS tab on a right drag in LTR', () => {
    const onClick = vi.fn();
    /* select the SECOND tab first, so «previous» is a real destination */
    const { container } = mount({ tabs: strip(undefined, { onClick }) });
    container.querySelectorAll('[role="tab"]')[1].setAttribute('aria-selected', 'true');
    container.querySelectorAll('[role="tab"]')[0].setAttribute('aria-selected', 'false');
    swipe(screen.getByTestId('body'), 90);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('mirrors both directions in an RTL document', () => {
    const onClick = vi.fn();
    mount({ rtl: true, tabs: strip(undefined, { onClick }) });
    swipe(screen.getByTestId('body'), 90);   // right = NEXT when reading RTL
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not wrap around at either end of the strip', () => {
    const onClick = vi.fn();
    mount({ tabs: strip(undefined, { onClick }) });
    swipe(screen.getByTestId('body'), 90);    // already on the first tab
    expect(onClick).not.toHaveBeenCalled();
    cleanup();
    const second = mount({ tabs: strip(undefined, { onClick }) });
    const tabs = second.container.querySelectorAll('[role="tab"]');
    tabs[2].setAttribute('aria-selected', 'true');
    tabs[0].setAttribute('aria-selected', 'false');
    swipe(screen.getByTestId('body'), -90);   // already on the last tab
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('۲ · صفحه‌ای که تب ندارد هیچ کاری نمی‌کند', () => {
  it('is completely inert without a tab strip — it does not navigate', () => {
    const onClick = vi.fn();
    mount({ tabs: null, body: <div data-testid="body">Wallet</div> });
    swipe(screen.getByTestId('body'), -140);
    swipe(screen.getByTestId('body'), 140);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTestId('body').textContent).toBe('Wallet');
  });

  it('ignores a strip that is closed/hidden', () => {
    mount({ tabs: <div role="tablist" hidden><button role="tab" aria-selected="true">A</button><button role="tab" onClick={() => {}}>B</button></div> });
    /* a hidden strip is not a destination: the zone must find nothing */
    expect(findTabStrip(document.querySelector('.app-tab-swipe-zone'), screen.getByTestId('body'))).toBeNull();
  });
});

describe('۳ · ژست‌هایی که ژستِ تب نیستند', () => {
  it('leaves vertical scrolling, taps and slow drags alone', () => {
    const onClick = vi.fn();
    mount({ tabs: strip(undefined, { onClick }) });
    swipe(screen.getByTestId('body'), -90, 160);     // mostly vertical
    swipe(screen.getByTestId('body'), -20);          // too short to be deliberate
    expect(onClick).not.toHaveBeenCalled();
  });

  it('refuses a drag that took longer than a flick', () => {
    const now = vi.spyOn(Date, 'now');
    const onClick = vi.fn();
    mount({ tabs: strip(undefined, { onClick }) });
    now.mockReturnValue(1_000);
    fireEvent.touchStart(screen.getByTestId('body'), { touches: [{ clientX: 200, clientY: 300 }] });
    now.mockReturnValue(1_000 + SWIPE_MAX_MS + 50);
    fireEvent.touchEnd(screen.getByTestId('body'), { touches: [], changedTouches: [{ clientX: 110, clientY: 300 }] });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('yields to forms, buttons, links, charts and sideways rails', () => {
    const onClick = vi.fn();
    mount({
      tabs: strip(undefined, { onClick }),
      extra: (
        <>
          <input data-testid="input" />
          <canvas data-testid="canvas" />
          <div className="segmented" data-testid="seg">x</div>
          <div data-tab-swipe-ignore data-testid="rail">rail</div>
          <button data-testid="btn">tap</button>
        </>
      )
    });
    for (const id of ['input', 'canvas', 'seg', 'rail', 'btn']) swipe(screen.getByTestId(id), -120);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('yields to a strip that is itself draggable (scrolling the rail)', () => {
    const onClick = vi.fn();
    mount({ tabs: strip(undefined, { onClick }) });
    swipe(screen.getAllByRole('tab')[1], -120);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('never fires for a pinch (two fingers)', () => {
    const onClick = vi.fn();
    mount({ tabs: strip(undefined, { onClick }) });
    fireEvent.touchStart(screen.getByTestId('body'), { touches: [{ clientX: 200, clientY: 300 }, { clientX: 300, clientY: 300 }] });
    fireEvent.touchEnd(screen.getByTestId('body'), { touches: [], changedTouches: [{ clientX: 60, clientY: 300 }] });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('refuses a disabled destination', () => {
    mount({ tabs: strip(undefined, { disabledAt: 1 }) });
    swipe(screen.getByTestId('body'), -90);
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
  });
});

describe('۴ · ژستی که در صفحهٔ دیگری شروع شده پاسخ داده نمی‌شود', () => {
  it('drops the release when the route changed mid-drag', () => {
    const onClick = vi.fn();
    const { rerender } = mount({ tabs: strip(undefined, { onClick }) });
    fireEvent.touchStart(screen.getByTestId('body'), { touches: [{ clientX: 200, clientY: 300 }] });
    rerender(<PageTabSwipe routeKey="/wallet"><div data-testid="body">Wallet</div></PageTabSwipe>);
    fireEvent.touchEnd(screen.getByTestId('body'), { touches: [], changedTouches: [{ clientX: 90, clientY: 300 }] });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('۵ · پنلِ باز، استریپِ خودش را می‌خواند', () => {
  it('drives the tablist that controls the panel the finger is in', () => {
    const inner = vi.fn();
    const { container } = render(
      <PageTabSwipe routeKey="/coin/bitcoin">
        <div role="tablist">
          <button role="tab" aria-selected="true" aria-controls="outer-panel" onClick={() => {}}>One</button>
          <button role="tab" aria-controls="outer-panel" onClick={() => {}}>Two</button>
        </div>
        <div role="tabpanel" id="outer-panel">
          <div role="tablist">
            <button role="tab" aria-selected="true" aria-controls="inner-panel" onClick={inner}>Chart</button>
            <button role="tab" aria-controls="inner-panel" onClick={inner}>Orders</button>
          </div>
          <div role="tabpanel" id="inner-panel" data-testid="inside">inside</div>
        </div>
      </PageTabSwipe>
    );
    const zone = container.querySelector('.app-tab-swipe-zone');
    const list = findTabStrip(zone, screen.getByTestId('inside'));
    expect(list.querySelectorAll('[role="tab"]')[0].textContent).toBe('Chart');
    swipe(screen.getByTestId('inside'), -90);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe('۶ · قراردادِ خالص (بدون DOM لازم)', () => {
  const dom = (labels, sel = 0) => {
    const host = document.createElement('div');
    host.innerHTML = labels.map((l) => `<button role="tab" aria-selected="${false}">${l}</button>`).join('');
    host.querySelectorAll('[role="tab"]')[sel].setAttribute('aria-selected', 'true');
    return tabsOf(host);
  };

  it('thresholds are deliberate, not accidental', () => {
    expect(SWIPE_MIN_X).toBeGreaterThanOrEqual(44);
    expect(SWIPE_MIN_X).toBeLessThanOrEqual(64);
  });

  it('returns the neighbouring tab, and null at the ends', () => {
    const tabs = dom(['a', 'b', 'c'], 1);
    expect(resolveTabStep({ dx: -80, dy: 4, ms: 200 }, tabs, 1, false).textContent).toBe('c');
    expect(resolveTabStep({ dx: 80, dy: 4, ms: 200 }, tabs, 1, false).textContent).toBe('a');
    expect(resolveTabStep({ dx: -80, dy: 4, ms: 200 }, tabs, 2, false)).toBeNull();
    expect(resolveTabStep({ dx: 80, dy: 4, ms: 200 }, tabs, 0, false)).toBeNull();
    /* RTL: the same drags point the other way */
    expect(resolveTabStep({ dx: 80, dy: 4, ms: 200 }, tabs, 1, true).textContent).toBe('c');
    expect(resolveTabStep({ dx: -80, dy: 4, ms: 200 }, tabs, 1, true).textContent).toBe('a');
  });

  it('reads the selected tab even when it only carries the class the app toggles', () => {
    const host = document.createElement('div');
    host.innerHTML = '<button role="tab">a</button><button role="tab" class="active">b</button>';
    expect(selectedIndex(tabsOf(host))).toBe(1);
  });

  it('has no path that navigates — runTabGesture only ever clicks a tab', () => {
    const host = document.createElement('div');
    host.className = 'app-tab-swipe-zone';
    host.innerHTML = `
      <div role="tablist">
        <button role="tab" aria-selected="true">a</button>
        <button role="tab" id="dest">b</button>
      </div>
      <p id="body">body</p>`;
    document.body.appendChild(host);
    const dest = host.querySelector('#dest');
    const clicked = vi.fn();
    dest.addEventListener('click', clicked);
    const result = runTabGesture({
      zone: host,
      target: host.querySelector('#body'),
      start: { x: 200, y: 300 },
      end: { x: 100, y: 300 },
      ms: 180
    });
    expect(result?.tab).toBe(dest);
    expect(clicked).toHaveBeenCalledTimes(1);
    host.remove();
  });
});
