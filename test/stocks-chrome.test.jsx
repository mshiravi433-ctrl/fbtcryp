// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '../src/i18n';
import { AppChrome } from '../src/App';

beforeAll(async () => {
  await setLanguage('fa');
});

afterEach(cleanup);

describe('Stocks page chrome behavior', () => {
  it('applies stocks chrome on /stocks: sticky shell, More button in header, removes BottomNav, centers QuickAccess', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/stocks']}>
        <AppChrome />
      </MemoryRouter>
    );

    // 1. Shell gets .app-shell--stocks
    const shell = container.querySelector('.app-shell');
    expect(shell).toBeTruthy();
    expect(shell.classList.contains('app-shell--stocks')).toBe(true);

    // 2. Header has More button instead of social button
    const header = container.querySelector('.top-bar');
    expect(header).toBeTruthy();
    const moreBtn = within(header).getByRole('button', { name: 'بیشتر' });
    expect(moreBtn).toBeTruthy();
    expect(within(header).queryByRole('button', { name: 'شبکهٔ اجتماعی' })).toBeNull();

    // 3. BottomNav (footer menu) is removed
    expect(container.querySelector('.bottom-nav')).toBeNull();

    // 4. QuickAccess is rendered with centered layout (it portals to document.body, lazy loaded)
    await waitFor(() => {
      const quickAccess = document.querySelector('.quick-access');
      expect(quickAccess).toBeTruthy();
      expect(quickAccess.classList.contains('quick-access--centered')).toBe(true);
    });

    // 5. Clicking More button opens MoreSheet
    fireEvent.click(moreBtn);
    expect(await screen.findByRole('heading', { name: 'بیشتر' })).toBeTruthy();
    const closeBtn = screen.getByTestId('more-menu-close');
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
  });

  it('keeps normal layout and footer on other routes like /', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppChrome />
      </MemoryRouter>
    );

    const shell = container.querySelector('.app-shell');
    expect(shell).toBeTruthy();
    expect(shell.classList.contains('app-shell--stocks')).toBe(false);

    // Header has social button, not More button
    const header = container.querySelector('.top-bar');
    expect(header).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'شبکهٔ اجتماعی' })).toBeTruthy();
    expect(within(header).queryByRole('button', { name: 'بیشتر' })).toBeNull();

    // BottomNav is present
    expect(container.querySelector('.bottom-nav')).toBeTruthy();

    // QuickAccess is present but not centered
    await waitFor(() => {
      const quickAccess = document.querySelector('.quick-access');
      expect(quickAccess).toBeTruthy();
      expect(quickAccess.classList.contains('quick-access--centered')).toBe(false);
    });
  });
});
