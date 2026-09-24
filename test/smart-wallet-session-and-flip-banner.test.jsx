// @vitest-environment jsdom
/**
 * «در کیف پول هوشمند قسمت Intent OS از آیکون جذاب‌تر استفاده کن و مطمئن شو
 * نشست فعال کار می‌کند» + the redesigned RWA / Global-Horizon flip banner.
 *
 * Pinned:
 *  - starting a session shows the live countdown and raises the enforced cap
 *    (checkPolicy agrees with what the screen says),
 *  - the countdown actually ticks and the card flips back to idle on expiry
 *    (it used to freeze and keep saying «active» forever),
 *  - ending a session clears it,
 *  - the Intent OS box no longer renders emoji icons,
 *  - the flip banner switches faces from its tabs and routes each face.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => (o && typeof o === 'object' && o.defaultValue) || k,
    i18n: { language: 'fa', resolvedLanguage: 'fa' }
  })
}));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));

import SmartWallet from '../src/pages/SmartWallet.jsx';
import RwaHorizonFlipBanner from '../src/components/RwaHorizonFlipBanner.jsx';
import { checkPolicy, loadPolicy, recordSpend } from '../src/lib/smartWallet';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const renderWallet = () => render(<MemoryRouter><SmartWallet embedded /></MemoryRouter>);

describe('Smart wallet — active session', () => {
  it('starts, ticks down, raises the enforced cap and expires on its own', () => {
    recordSpend(800);
    expect(checkPolicy({ usd: 400 }).ok).toBe(false);

    renderWallet();
    fireEvent.click(screen.getByText('smart.startSession'));

    const card = screen.getByTestId('smart-wallet-session');
    expect(card.textContent).toContain('نشست فعال');
    expect(card.textContent).toContain('30:00');
    expect(card.textContent).toContain('$1500');
    expect(checkPolicy({ usd: 400 }).ok).toBe(true);

    act(() => { vi.advanceTimersByTime(65_000); });
    expect(card.textContent).toContain('28:55');

    act(() => { vi.advanceTimersByTime(30 * 60_000); });
    expect(card.textContent).toContain('smart.startSession');
    expect(card.textContent).not.toContain('نشست فعال');
    expect(loadPolicy().session).toBe(null);
    expect(checkPolicy({ usd: 400 }).ok).toBe(false);
  });

  it('ends a session on demand', () => {
    renderWallet();
    fireEvent.click(screen.getByText('smart.startSession'));
    fireEvent.click(screen.getByText('smart.endSession'));
    expect(loadPolicy().session).toBe(null);
    expect(screen.getByTestId('smart-wallet-session').textContent).toContain('smart.startSession');
  });

  it('Intent OS rules use SVG icons, not emoji', () => {
    renderWallet();
    const box = screen.getByTestId('smart-wallet-intent-rules');
    expect(box.textContent).not.toMatch(/[⚡⛓📊🛡🔒🧾]/u);
    expect(box.querySelectorAll('.swi-tile svg').length).toBeGreaterThanOrEqual(6);
  });
});

describe('RWA / Horizon flip banner', () => {
  it('flips from the tabs and routes each face', () => {
    const onGoRwa = vi.fn();
    const onGoHorizon = vi.fn();
    const { container } = render(
      <RwaHorizonFlipBanner isRTL lang="fa" onGoRwa={onGoRwa} onGoHorizon={onGoHorizon} />
    );
    const root = container.querySelector('.rhb');
    expect(root.dataset.side).toBe('rwa');
    fireEvent.click(screen.getByRole('tab', { name: /افق جهانی/ }));
    expect(root.dataset.side).toBe('hz');
    expect(root.className).toContain('is-flipped');

    fireEvent.click(container.querySelector('.rhb-face--hz'));
    expect(onGoHorizon).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.rhb-face--rwa'));
    expect(onGoRwa).toHaveBeenCalledTimes(1);
  });

  it('auto-flips on a timer', () => {
    const { container } = render(<RwaHorizonFlipBanner isRTL lang="fa" />);
    const root = container.querySelector('.rhb');
    act(() => { vi.advanceTimersByTime(6600); });
    expect(root.dataset.side).toBe('hz');
    act(() => { vi.advanceTimersByTime(6600); });
    expect(root.dataset.side).toBe('rwa');
  });
});
