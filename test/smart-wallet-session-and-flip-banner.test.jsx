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
 *  - the flip banner has NO tabs, switches faces from its icon-only button,
 *    auto-flips every 40s, and only shows Persian when the language is fa.
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
  /*
   * v4 — «تب را حذف کن و داخل بنر بالا سمت چپ ایکون تعویض بزار بدون عنوان».
   * The tab strip above the card is deleted, so these tests now drive the
   * banner the way a user does: through the icon-only switch inside it.
   */
  it('has no tabs left, and the switch is an icon inside the banner', () => {
    const { container } = render(<RwaHorizonFlipBanner isRTL lang="fa" />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(container.querySelector('.rhb-tabs')).toBe(null);

    const swap = container.querySelector('.rhb-swap');
    expect(swap).toBeTruthy();
    /* «بدون عنوان» — the button renders a glyph and a countdown ring, never a
       word, and the accessibility name lives in aria-label where it belongs. */
    expect(swap.textContent.trim()).toBe('');
    expect(swap.querySelector('svg')).toBeTruthy();
    expect(swap.querySelector('.rhb-swap-ring circle')).toBeTruthy();
    expect(swap.getAttribute('aria-label')).toBeTruthy();
  });

  it('flips from the switch and routes each face', () => {
    const onGoRwa = vi.fn();
    const onGoHorizon = vi.fn();
    const { container } = render(
      <RwaHorizonFlipBanner isRTL lang="fa" onGoRwa={onGoRwa} onGoHorizon={onGoHorizon} />
    );
    const root = container.querySelector('.rhb');
    expect(root.dataset.side).toBe('rwa');

    fireEvent.click(container.querySelector('.rhb-swap'));
    expect(root.dataset.side).toBe('hz');
    expect(root.className).toContain('is-flipped');

    fireEvent.click(container.querySelector('.rhb-swap'));
    expect(root.dataset.side).toBe('rwa');

    fireEvent.click(container.querySelector('.rhb-face--hz'));
    expect(onGoHorizon).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.rhb-face--rwa'));
    expect(onGoRwa).toHaveBeenCalledTimes(1);
  });

  it('auto-flips every 40s and comes back on its own', () => {
    const { container } = render(<RwaHorizonFlipBanner isRTL lang="fa" />);
    const root = container.querySelector('.rhb');
    /* «هر ۴۰ ثانیه خودش برگردد» — one second short of the new rhythm the card
       must still be on its first face, then it flips by itself. */
    act(() => { vi.advanceTimersByTime(39_000); });
    expect(root.dataset.side).toBe('rwa');
    act(() => { vi.advanceTimersByTime(1_100); });
    expect(root.dataset.side).toBe('hz');
    /* …and back again, with nobody touching it. */
    act(() => { vi.advanceTimersByTime(40_100); });
    expect(root.dataset.side).toBe('rwa');
    act(() => { vi.advanceTimersByTime(40_100); });
    expect(root.dataset.side).toBe('hz');
  });

  it('a tap does not pause the auto-flip (the old sticky-hover bug)', () => {
    const { container } = render(<RwaHorizonFlipBanner isRTL lang="fa" />);
    const root = container.querySelector('.rhb');
    /* A touch tap fires a synthetic mouseenter with no matching mouseleave.
       The banner must keep flipping anyway, or the promise breaks on phones. */
    fireEvent.mouseEnter(root);
    act(() => { vi.advanceTimersByTime(40_100); });
    expect(root.dataset.side).toBe('hz');
  });

  /*
   * ─── THE LANGUAGE BUG, PINNED ─────────────────────────────────────────────
   * Reported: with a language that is neither Persian nor English the card was
   * PERSIAN — «باید انگلیسی باشد». The branch used to be `!isRTL && !fa`, so
   * Arabic and Urdu (RTL, not Persian) fell into the Persian copy. Only `fa`
   * gets Persian now.
   */
  it('shows Persian only for Persian, and English for Arabic, Urdu and the rest', () => {
    const fa = render(<RwaHorizonFlipBanner isRTL lang="fa" />);
    expect(fa.container.querySelector('.rhb-eyebrow').textContent).toContain('دارایی');
    fa.unmount();

    for (const [lang, rtl] of [['ar', true], ['ur', true], ['tr', false], ['ru', false], ['en', false]]) {
      const r = render(<RwaHorizonFlipBanner isRTL={rtl} lang={lang} />);
      const eyebrow = r.container.querySelector('.rhb-eyebrow').textContent;
      expect(eyebrow, `${lang} must read English`).toContain('Real World Assets');
      /* and no Persian anywhere on the first face */
      expect(r.container.querySelector('.rhb-face--rwa').textContent).not.toMatch(/[\u0600-\u06FF]/);
      r.unmount();
    }
  });
});
