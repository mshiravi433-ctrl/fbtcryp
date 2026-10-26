// @vitest-environment jsdom
/**
 * THE MARKET RAIL — a tape, not a row of boxes.
 * ---------------------------------------------------------------------------
 * Reported: «باکس بالایی … داخل باکس قرار دادی کشیده شود بدون چراغ چشمک زن سبز
 * و انگار ریلی هست».
 *
 * Two of those are structural, so they are pinned here:
 *   1. no LIVE dot and no badge capsule — the indicator must not blink at the
 *      reader, and a rail is not an alarm panel;
 *   2. prices still carry their currency symbol (fmtPrice alone does not) while
 *      remaining public data — they must never be masked by hide-balances the
 *      way fmtUsd masks balances.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Ticker from '../src/components/Ticker';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => o?.defaultValue ?? k, i18n: { language: 'fa' } })
}));

const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 61000, change24h: 1.2 },
  { id: 'eth', symbol: 'ETH', name: 'Ethereum', price: 2400, change24h: -0.8 }
];

const renderRail = () => render(<MemoryRouter><Ticker coins={COINS} /></MemoryRouter>);

describe('the market rail', () => {
  it('renders the coins twice (seamless loop) as flat items', () => {
    const { container } = renderRail();
    expect(container.querySelectorAll('.ticker-item').length).toBe(4);
    expect(container.querySelectorAll('.ticker-track').length).toBe(2);
  });

  it('has no blinking green dot and no badge capsule', () => {
    const { container } = renderRail();
    expect(container.querySelector('.ticker-live-dot')).toBeNull();
    expect(container.querySelector('.ticker-live-badge')).toBeNull();
    expect(container.querySelector('.ticker-mark-bar')).not.toBeNull();
  });

  it('prints prices with a currency symbol and both directions', () => {
    const { container } = renderRail();
    expect(container.textContent).toContain('$61,000');
    expect(container.querySelectorAll('.ticker-change.is-up').length).toBe(2);
    expect(container.querySelectorAll('.ticker-change.is-down').length).toBe(2);
  });

  it('keeps promos to a single line (dot, title, move)', () => {
    const { container } = renderRail();
    const promo = container.querySelector('.ticker-promo');
    expect(promo).not.toBeNull();
    expect(promo.querySelector('.ticker-promo-dot')).not.toBeNull();
    expect(promo.querySelector('.ticker-promo-chart')).toBeNull();
  });
});
