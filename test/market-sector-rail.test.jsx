// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MarketSectorRail from '../src/components/market/MarketSectorRail.jsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
const sectors = ['gold', 'meme', 'rwa', 'ai', 'gaming', 'solana'];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount({ selected = null, direction = 'ltr', overflow = true } = {}) {
  const onSelect = vi.fn();
  render(<MarketSectorRail sectors={sectors} selected={selected} onSelect={onSelect} />);
  const rail = screen.getByTestId('market-sector-rail');
  rail.style.direction = direction;
  Object.defineProperty(rail, 'clientWidth', { value: 320 });
  Object.defineProperty(rail, 'scrollWidth', { value: overflow ? 820 : 320 });
  let scroll = 0;
  Object.defineProperty(rail, 'scrollLeft', {
    configurable: true,
    get: () => scroll,
    set: (value) => { scroll = direction === 'rtl' ? Math.max(-500, Math.min(0, value)) : Math.max(0, Math.min(500, value)); }
  });
  return { rail, onSelect, buttons: [...rail.querySelectorAll('button')] };
}

const wheel = (rail, init = {}) => {
  const event = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true, ...init });
  rail.dispatchEvent(event);
  return event;
};
const pointer = (element, type, init) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: init.clientX });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 1 },
    pointerType: { value: init.pointerType ?? 'mouse' }
  });
  fireEvent(element, event);
};

describe('bare category rail interactions', () => {
  it('keeps an accessible all-sectors reset, without a separate heading icon', () => {
    const { rail, buttons, onSelect } = mount({ selected: 'meme' });
    expect(rail.getAttribute('role')).toBe('group');
    expect(rail.hasAttribute('data-horizontal-scroll')).toBe(true);
    expect(rail.closest('[data-tab-swipe-ignore]')).toBeTruthy();
    expect(rail.getAttribute('aria-label')).toBe('market.sectorsAria');
    expect(buttons).toHaveLength(7);
    expect(buttons[2].getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(buttons[2]);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    fireEvent.click(buttons[6]);
    expect(onSelect).toHaveBeenLastCalledWith('solana');
    fireEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(document.querySelector('.mx-sectors-head')).toBeNull();
  });

  for (const direction of ['ltr', 'rtl']) {
    it(`scrolls with the wheel in ${direction}, releasing the page at both ends`, () => {
      const { rail } = mount({ direction });
      expect(wheel(rail).defaultPrevented).toBe(true);
      expect(rail.scrollLeft).toBe(direction === 'rtl' ? -80 : 80);
      expect(wheel(rail, { deltaY: -80 }).defaultPrevented).toBe(true);
      expect(rail.scrollLeft).toBe(0);
      expect(wheel(rail, { deltaY: -80 }).defaultPrevented).toBe(false);
      rail.scrollLeft = direction === 'rtl' ? -500 : 500;
      expect(wheel(rail).defaultPrevented).toBe(false);
    });

    it(`supports arrows, Home and End in ${direction} without changing the category`, () => {
      const { rail, buttons, onSelect } = mount({ direction });
      const scrollIntoView = vi.fn();
      for (const button of buttons) button.scrollIntoView = scrollIntoView;
      buttons[0].focus();
      fireEvent.keyDown(rail, { key: direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight' });
      expect(document.activeElement).toBe(buttons[1]);
      fireEvent.keyDown(rail, { key: 'End' });
      expect(document.activeElement).toBe(buttons[6]);
      fireEvent.keyDown(rail, { key: 'Home' });
      expect(document.activeElement).toBe(buttons[0]);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      expect(onSelect).not.toHaveBeenCalled();
      fireEvent.keyDown(rail, { key: 'Tab' });
      expect(document.activeElement).toBe(buttons[0]);
    });
  }

  it('does not hijack zoom gestures, horizontal trackpads, or a non-overflowing rail', () => {
    const { rail } = mount({ overflow: false });
    expect(wheel(rail).defaultPrevented).toBe(false);
    expect(wheel(rail, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(rail, { deltaX: 100 }).defaultPrevented).toBe(false);
    expect(rail.scrollLeft).toBe(0);
  });

  it('drags with a mouse without accidentally selecting a category on release', () => {
    const { rail, onSelect, buttons } = mount();
    rail.setPointerCapture = vi.fn();
    rail.hasPointerCapture = () => true;
    rail.releasePointerCapture = vi.fn();
    pointer(buttons[1], 'pointerdown', { clientX: 220 });
    pointer(rail, 'pointermove', { clientX: 216 });
    expect(rail.dataset.dragging).toBeUndefined();
    pointer(rail, 'pointermove', { clientX: 100 });
    expect(rail.dataset.dragging).toBe('true');
    expect(rail.scrollLeft).toBe(120);
    pointer(rail, 'pointerup', { clientX: 100 });
    expect(rail.dataset.dragging).toBeUndefined();
    expect(rail.releasePointerCapture).toHaveBeenCalledWith(1);
    fireEvent.click(buttons[1]);
    expect(onSelect).not.toHaveBeenCalled();
    pointer(buttons[1], 'pointerdown', { clientX: 100 });
    pointer(buttons[1], 'pointerup', { clientX: 100 });
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith('gold');
  });

  it('leaves touch panning to the browser and never captures vertical swipes', () => {
    const { rail } = mount();
    rail.setPointerCapture = vi.fn();
    pointer(rail, 'pointerdown', { clientX: 220, pointerType: 'touch' });
    pointer(rail, 'pointermove', { clientX: 20, pointerType: 'touch' });
    expect(rail.scrollLeft).toBe(0);
    expect(rail.setPointerCapture).not.toHaveBeenCalled();
  });
});
