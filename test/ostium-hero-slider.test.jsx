// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '../src/i18n';
import OstiumHeroSlider from '../src/components/ostium/OstiumHeroSlider';
import Ostium from '../src/pages/Ostium';

// Mock Ostium dependencies
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => ({ address: '0x123', isConnected: true }),
  shortAddress: (a) => a
}));
vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({ haptic: vi.fn() })
}));
vi.mock('../src/store/useSettingsStore', () => ({
  useSettingsStore: () => ({ slippage: 1, theme: 'dark' })
}));

beforeAll(async () => {
  await setLanguage('fa');
});

afterEach(cleanup);

describe('Ostium Hero Slider and Risk Notice', () => {
  it('renders OstiumHeroSlider with rotating segments and interactive controls', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <OstiumHeroSlider feedLive={true} onSelectCategory={onSelect} />
      </MemoryRouter>
    );

    // Shows live status pill
    expect(screen.getByText('زنده')).toBeTruthy();

    // Shows the active slide title
    expect(screen.getByText(/طلا و نفت جهانی روی آربیتروم/i)).toBeTruthy();

    // Clicking category jump button invokes callback
    const ctaBtn = screen.getByRole('button', { name: /مشاهده کالاها/i });
    expect(ctaBtn).toBeTruthy();
    fireEvent.click(ctaBtn);
    expect(onSelect).toHaveBeenCalledWith('commodities');

    // Next slide button changes slide
    const nextBtn = screen.getByRole('button', { name: /Next slide/i });
    fireEvent.click(nextBtn);
    await waitFor(() => {
      expect(screen.getByText(/بزرگ‌ترین بازار مالی جهان در کیف پول شما/i)).toBeTruthy();
    });
  });

  it('renders collapsible risk notice defaulting to closed on Ostium desk', () => {
    render(
      <MemoryRouter>
        <Ostium embedded />
      </MemoryRouter>
    );

    const riskBtn = screen.getByRole('button', { name: /هشدار ریسک: مشتقهٔ دائمی اهرمی/i });
    expect(riskBtn).toBeTruthy();
    expect(riskBtn.getAttribute('aria-expanded')).toBe('false');

    // Risk text should not be visible when collapsed
    expect(screen.queryByText(/این‌ها مشتقهٔ دائمی اهرمی هستند، نه خود طلا/i)).toBeNull();

    // Expanding displays the risk warning
    fireEvent.click(riskBtn);
    expect(riskBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/این‌ها مشتقهٔ دائمی اهرمی هستند، نه خود طلا/i)).toBeTruthy();
  });
});
