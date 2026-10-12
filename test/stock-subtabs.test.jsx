// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key })
}));

import StockSubtabs from '../src/components/StockSubtabs.jsx';

afterEach(() => cleanup());

describe('Stocks subtab rails', () => {
  it('exposes tokenized stocks, Robinhood and gold as SVG tabs', () => {
    const onChange = vi.fn();
    const { getByRole } = render(<StockSubtabs kind="equity" active="tokenized" onChange={onChange} />);
    const list = getByRole('tablist', { name: 'stocks.tab.equity' });
    const tabs = [...list.querySelectorAll('[role="tab"]')];

    expect(tabs.map((tab) => tab.getAttribute('data-subtab'))).toEqual(['tokenized', 'robinhood', 'gold']);
    expect(tabs.every((tab) => tab.querySelector('svg'))).toBe(true);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');

    fireEvent.click(tabs[1]);
    expect(onChange).toHaveBeenCalledWith('robinhood');
  });

  it('splits curated real-world assets from the RWA sector tokens', () => {
    const { getByRole } = render(<StockSubtabs kind="rwa" active="assets" onChange={() => {}} />);
    const list = getByRole('tablist', { name: 'stocks.tab.rwa' });
    const tabs = [...list.querySelectorAll('[role="tab"]')];

    expect(tabs.map((tab) => tab.getAttribute('data-subtab'))).toEqual(['assets', 'tokens']);
    expect(tabs.every((tab) => tab.querySelector('svg'))).toBe(true);
  });
});
