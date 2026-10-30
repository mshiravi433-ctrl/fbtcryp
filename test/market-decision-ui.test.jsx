// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import DecisionOrb from '../src/components/DecisionOrb';
afterEach(cleanup);
it('opens an inline rail rather than dialog, reports state and closes with Escape', () => {
  const onOpenChange = vi.fn();
  render(<DecisionOrb coins={[{change24h: 2, high24h: 110, low24h: 100}]} updatedAt={Date.now()} onOpenChange={onOpenChange} />);
  const toggle = screen.getByRole('button');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('10.0%')).toBeTruthy();
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  fireEvent.keyDown(document, {key:'Escape'});
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});
it('withholds all percentages on stale or failed data', () => {
  render(<DecisionOrb coins={[{change24h: 2}]} updatedAt={Date.now()-180000} />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getAllByText('—')).toHaveLength(3);
  expect(screen.getByRole('status').textContent).toMatch(/stale|تازه نیست|pulse\.stale/i);
});
it('dismisses on an outside pointer press and after twenty seconds', () => {
  vi.useFakeTimers();
  render(<DecisionOrb coins={[]} updatedAt={Date.now()} />);
  const toggle = screen.getByRole('button');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  fireEvent.pointerDown(document.body);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  act(() => vi.advanceTimersByTime(20_000));
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  vi.useRealTimers();
});
