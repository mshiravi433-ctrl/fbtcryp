// @vitest-environment jsdom
/**
 * MARKET PULSE — the dismissal contract of 2026-10-30
 * ---------------------------------------------------------------------------
 * «دایره که رویش می‌زنی بعد از ۲۰ ثانیه ناپدید شود، یا دست را می‌زنی در
 *  قسمت‌های دیگر صفحه ناپدید شود، و با توجه به زبان تغییر کند.»
 *
 * Three requirements, three pins. They are separate from
 * market-decision-ui.test.jsx (which owns the rail's DATA honesty) because
 * these are about the instrument's own behaviour:
 *
 *   1. the 20-second budget closes the rail AND removes the whole circle —
 *      the old code left the toggle on the page for the rest of the session;
 *   2. a pointer press anywhere outside does the same thing;
 *   3. the instrument sits on the reading column's START edge, so Farsi and
 *      Arabic see it on the right and English on the left.
 *
 * A tap on the circle itself is deliberately NOT a dismissal: it folds the
 * rail, because a control that vanishes when you press it is a bug.
 */
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { setLanguage } from '../src/i18n/index.js';
import DecisionOrb from '../src/components/DecisionOrb.jsx';

beforeAll(async () => {
  await setLanguage('fa');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const coins = [{ change24h: 2, high24h: 110, low24h: 100 }];

describe('market pulse — dismissal', () => {
  it('removes the whole circle after the twenty-second budget', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DecisionOrb coins={coins} updatedAt={Date.now()} />);

    fireEvent.click(screen.getByRole('button'));
    expect(document.querySelector('.dor')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(20_100); });
    /* The fade-out is a transition, so the element is still mounted but
       leaving — and it is already click-through. */
    expect(document.querySelector('.dor').classList.contains('is-leaving')).toBe(true);

    act(() => { vi.advanceTimersByTime(500); });
    expect(document.querySelector('.dor')).toBeNull();
  });

  it('removes the whole circle on a press anywhere outside it', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DecisionOrb coins={coins} updatedAt={Date.now()} />);
    fireEvent.click(screen.getByRole('button'));

    fireEvent.pointerDown(document.body);
    expect(document.querySelector('.dor').classList.contains('is-leaving')).toBe(true);

    act(() => { vi.advanceTimersByTime(500); });
    expect(document.querySelector('.dor')).toBeNull();
  });

  it('treats a press INSIDE the rail as use, not dismissal', () => {
    render(<DecisionOrb coins={coins} updatedAt={Date.now()} />);
    fireEvent.click(screen.getByRole('button'));
    const rail = document.getElementById('market-decision-rail');
    fireEvent.pointerDown(rail);
    expect(document.querySelector('.dor').classList.contains('is-leaving')).toBe(false);
  });

  it('folds the rail — but keeps the circle — when the circle itself is tapped', () => {
    render(<DecisionOrb coins={coins} updatedAt={Date.now()} />);
    const toggle = screen.getByRole('button');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.dor')).toBeTruthy();
    expect(document.querySelector('.dor').classList.contains('is-leaving')).toBe(false);
  });
});

describe('market pulse — language', () => {
  it('hangs off the start edge: right in Farsi, left in English', async () => {
    await setLanguage('fa');
    render(<DecisionOrb coins={coins} updatedAt={Date.now()} />);
    let orb = document.querySelector('.dor');
    expect(orb.dataset.side).toBe('end');
    expect(orb.getAttribute('dir')).toBe('rtl');
    cleanup();

    await setLanguage('en');
    render(<DecisionOrb coins={coins} updatedAt={Date.now()} />);
    orb = document.querySelector('.dor');
    expect(orb.dataset.side).toBe('start');
    expect(orb.getAttribute('dir')).toBe('ltr');

    /* Leave the suite in the language the rest of the app's tests expect. */
    await setLanguage('fa');
  });
});
