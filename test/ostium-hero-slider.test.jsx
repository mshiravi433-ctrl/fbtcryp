// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  it('renders minimal and compact OstiumHeroSlider without manual link or arrow buttons', () => {
    render(
      <MemoryRouter>
        <OstiumHeroSlider feedLive={true} />
      </MemoryRouter>
    );

    // Shows live status pill
    expect(screen.getByText('زنده')).toBeTruthy();

    // Shows the active slide title and badge
    expect(screen.getByText('طلا و نفت جهانی روی آربیتروم')).toBeTruthy();
    expect(screen.getByText('طلا و نفت جهانی')).toBeTruthy();

    // Verifies no manual link or arrow buttons exist (compact, auto-play only)
    expect(screen.queryByRole('button', { name: /مشاهده کالاها/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Next slide/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Previous slide/i })).toBeNull();
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
