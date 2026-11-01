// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { setLanguage } from '../src/i18n';
import QuickAccess from '../src/components/QuickAccess';

function LocationControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return <><button onClick={() => navigate('/wallet')}>Go wallet</button><span data-testid="location">{location.pathname}</span></>;
}
function mount(path) {
  render(<MemoryRouter initialEntries={[path]}><QuickAccess /><LocationControls /></MemoryRouter>);
}
function openRail() { fireEvent.click(screen.getByRole('button', { name: 'باز کردن دسترسی سریع' })); }
function labels() { return [...document.querySelectorAll('.quick-access__item')].map((item) => item.textContent); }

beforeAll(async () => { await setLanguage('fa'); });
afterEach(cleanup);

describe('quick access', () => {
  it('shows market destinations and replaces the current page with the hub', () => {
    mount('/');
    openRail();
    expect(labels()).toEqual(['فیوچرز', 'سهام', 'آزمایشگاه', 'فروشگاه', 'خرید و فروش']);
    expect(document.querySelectorAll('.quick-access__item svg')).toHaveLength(5);
    fireEvent.click(screen.getByRole('link', { name: 'فیوچرز' }));
    expect(screen.getByTestId('location').textContent).toBe('/perp');
    expect(screen.getByRole('button', { name: 'باز کردن دسترسی سریع' }).getAttribute('aria-expanded')).toBe('false');
    openRail();
    expect(labels()).toEqual(['بازار', 'سهام', 'آزمایشگاه', 'فروشگاه', 'خرید و فروش']);
  });

  it.each([
    ['/swap', ['/bridge', '/launch', '/p2p']],
    ['/wallet', ['/farm', '/loan', '/insurance', '/orders', '/rewards']],
    ['/signals', ['/smart-money', '/news', '/global', '/learn', '/explore-hub', '/security']],
    ['/settings', ['/contact', '/about', '/ecosystem', '/developers', '/business']],
    ['/insurance/coverage', ['/wallet', '/farm', '/loan', '/orders', '/rewards']]
  ])('offers the right destinations for %s', (path, destinations) => {
    mount(path);
    openRail();
    const nav = screen.getByRole('navigation', { name: 'دسترسی سریع' });
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(destinations);
  });

  it('folds on an outside pointer, escape, toggle, and route change without swallowing the action', () => {
    mount('/');
    const trigger = screen.getByRole('button', { name: 'باز کردن دسترسی سریع' });
    openRail();
    fireEvent.pointerDown(screen.getByText('Go wallet'));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    openRail();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    openRail();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    openRail();
    fireEvent.click(screen.getByText('Go wallet'));
    expect(screen.getByTestId('location').textContent).toBe('/wallet');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('is mirrored with language and absent on unrelated screens', async () => {
    mount('/swap');
    expect(document.querySelector('.quick-access').getAttribute('dir')).toBe('rtl');
    await setLanguage('en');
    expect(document.querySelector('.quick-access').getAttribute('dir')).toBe('ltr');
    cleanup();
    mount('/coin/bitcoin');
    expect(document.querySelector('.quick-access')).toBeNull();
    await setLanguage('fa');
  });
});
