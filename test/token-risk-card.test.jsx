// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const riskApi = vi.hoisted(() => ({
  fetchTokenRisk: vi.fn(async () => ({
    level: 'low', score: 18, liquidityRisk: 'low', holderConcentration: 10,
    contractRisk: 'low', rugPull: 0, flags: []
  }))
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: vi.fn() }) }));
vi.mock('../src/lib/tokenRisk', () => ({
  goplusChainId: () => 1,
  fetchTokenRisk: riskApi.fetchTokenRisk
}));

import TokenRiskCard from '../src/components/TokenRiskCard.jsx';

afterEach(() => cleanup());

const props = { chainId: 1, address: '0x1111111111111111111111111111111111111111', symbol: 'ETH' };

describe('token risk card disclosure modes', () => {
  it('keeps the breakdown visible under a static header on token-detail tabs', async () => {
    const { container } = render(<TokenRiskCard {...props} collapsible={false} />);
    await waitFor(() => expect(riskApi.fetchTokenRisk).toHaveBeenCalled());

    const header = container.querySelector('.infobox-head');
    expect(header.tagName).toBe('DIV');
    expect(header.hasAttribute('aria-expanded')).toBe(false);
    expect(container.querySelector('.infobox.is-open')).toBeTruthy();
    expect(container.querySelector('.infobox-body')).toBeTruthy();
    expect(screen.getByText('risk.liquidity')).toBeTruthy();
    expect(container.querySelector('[role="meter"]').getAttribute('aria-valuenow')).toBe('18');
  });

  it('preserves the ordinary collapsed disclosure outside token-detail subtabs', async () => {
    const { container } = render(<TokenRiskCard {...props} />);
    const header = container.querySelector('.infobox-head');
    expect(header.tagName).toBe('BUTTON');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.infobox-body')).toBeNull();

    fireEvent.click(header);
    await waitFor(() => expect(container.querySelector('.infobox-body')).toBeTruthy());
  });
});
