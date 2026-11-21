// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import VenueBanner from '../src/components/futures/VenueBanner';

const state = vi.hoisted(() => ({ still: false }));
vi.mock('../src/components/AnimatedIcon', () => ({ useStill: () => state.still }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); state.still = false; });

it.each(['dydx', 'onchain'])('starts with the %s introduction and rotates the artwork until paused', (venue) => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  try {
    const { container } = render(<VenueBanner venue={venue} title="Introduction" subtitle="Venue overview" />);
    const art = () => container.querySelector('img').getAttribute('src');
    const original = art();
    expect(screen.getByRole('heading').textContent).toBe('Introduction');
    act(() => vi.advanceTimersByTime(6500));
    expect(screen.getByRole('heading').textContent).toBe(`futures.venueSlides.${venue}.1.title`);
    expect(art()).not.toBe(original);
    fireEvent.click(screen.getByRole('button'));
    act(() => vi.advanceTimersByTime(13000));
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading').textContent).toBe(`futures.venueSlides.${venue}.1.title`);
  } finally { vi.restoreAllMocks(); }
});

it('keeps the introduction static with reduced motion', () => {
  state.still = true;
  const { container } = render(<VenueBanner venue="dydx" title="Introduction" />);
  expect(container.querySelector('[data-still="true"]')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
