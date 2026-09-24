// @vitest-environment jsdom
/**
 * «در کیف پول هوشمند قسمت Intent OS از آیکون جذاب‌تر استفاده کن و مطمئن شو
 * نشست فعال کار می‌کند» + the RWA / Global-Horizon banner.
 *
 * Pinned:
 *  - starting a session shows the live countdown and raises the enforced cap
 *    (checkPolicy agrees with what the screen says),
 *  - the countdown actually ticks and the card flips back to idle on expiry
 *    (it used to freeze and keep saying «active» forever),
 *  - ending a session clears it,
 *  - the Intent OS box no longer renders emoji icons,
 *  - the RWA/Horizon banner is a HORIZONTAL SWAP of two minimal slides (no
 *    3D), auto-advances every 10s, and only shows Persian when the language
 *    is fa.
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
import RwaHorizonSwapBanners from '../src/components/RwaHorizonSwapBanners.jsx';
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

describe('RWA / Horizon swap banners', () => {
  /*
   * «اصلا فلیپ کارت نباشه یجور دوتا بنر به صورت سواپ افقی باشد … خیلی
   * مینیمال و مدرن تر» — the 3D flip card is gone. These tests drive the new
   * banner the way a user does: dots, swipes, and the slides themselves.
   */
  it('is two horizontal slides, no 3D geometry left anywhere', () => {
    const { container } = render(<RwaHorizonSwapBanners isRTL lang="fa" />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    const root = container.querySelector('.rhs');
    expect(root).toBeTruthy();
    const slides = root.querySelectorAll('.rhs-slide');
    expect(slides).toHaveLength(2);
    /* the swap travels along one axis only */
    expect(root.querySelector('.rhs-track')).toBeTruthy();
    /* the iPhone bug had 3D geometry to happen in; there must be none now */
    const html = container.innerHTML;
    expect(html).not.toMatch(/preserve-3d|backface-visibility|perspective/);
    /* two dot indicators, one active */
    const dots = root.querySelectorAll('.rhs-dot');
    expect(dots).toHaveLength(2);
    expect(root.querySelectorAll('.rhs-dot.is-on')).toHaveLength(1);
  });

  it('swaps from the dots and routes each slide', () => {
    const onGoRwa = vi.fn();
    const onGoHorizon = vi.fn();
    const { container } = render(
      <RwaHorizonSwapBanners isRTL lang="fa" onGoRwa={onGoRwa} onGoHorizon={onGoHorizon} />
    );
    const root = container.querySelector('.rhs');
    const track = root.querySelector('.rhs-track');
    expect(root.dataset.slide).toBe('rwa');
    expect(track.style.transform).toBe('translateX(0%)');

    fireEvent.click(root.querySelectorAll('.rhs-dot')[1]);
    expect(root.dataset.slide).toBe('hz');
    /* RTL: the next slide sits physically LEFT, so the track moves RIGHT */
    expect(track.style.transform).toBe('translateX(50%)');

    fireEvent.click(root.querySelectorAll('.rhs-dot')[0]);
    expect(root.dataset.slide).toBe('rwa');
    expect(track.style.transform).toBe('translateX(0%)');

    fireEvent.click(root.querySelector('.rhs-slide--hz'));
    expect(onGoHorizon).toHaveBeenCalledTimes(1);
    fireEvent.click(root.querySelector('.rhs-slide--rwa'));
    expect(onGoRwa).toHaveBeenCalledTimes(1);
  });

  it('advances every 10s on its own, and comes back', () => {
    const { container } = render(<RwaHorizonSwapBanners isRTL lang="fa" />);
    const root = container.querySelector('.rhs');
    act(() => { vi.advanceTimersByTime(9_900); });
    expect(root.dataset.slide).toBe('rwa');
    act(() => { vi.advanceTimersByTime(200); });
    expect(root.dataset.slide).toBe('hz');
    /* …and back again, with nobody touching it. */
    act(() => { vi.advanceTimersByTime(10_100); });
    expect(root.dataset.slide).toBe('rwa');
  });

  it('a tap does not pause the auto-advance (the old sticky-hover bug)', () => {
    const { container } = render(<RwaHorizonSwapBanners isRTL lang="fa" />);
    const root = container.querySelector('.rhs');
    /* A touch tap fires a synthetic mouseenter with no matching mouseleave.
       The banner must keep advancing anyway, or the promise breaks on
       phones. */
    fireEvent.mouseEnter(root);
    act(() => { vi.advanceTimersByTime(10_100); });
    expect(root.dataset.slide).toBe('hz');
  });

  it('swipes the RTL way: a finger moving RIGHT advances', () => {
    const { container } = render(<RwaHorizonSwapBanners isRTL lang="fa" />);
    const root = container.querySelector('.rhs');
    fireEvent.touchStart(root, { touches: [{ clientX: 100, clientY: 20 }] });
    fireEvent.touchEnd(root, { changedTouches: [{ clientX: 160, clientY: 20 }] });
    expect(root.dataset.slide).toBe('hz');
    fireEvent.touchStart(root, { touches: [{ clientX: 160, clientY: 20 }] });
    fireEvent.touchEnd(root, { changedTouches: [{ clientX: 100, clientY: 20 }] });
    expect(root.dataset.slide).toBe('rwa');
  });

  /*
   * ─── THE LANGUAGE RULE, PINNED ────────────────────────────────────────────
   * Only `fa` gets Persian — Arabic, Urdu and the rest read English, the
   * fallback this app uses everywhere else. (The flip card shipped the same
   * rule after the «باید انگلیسی باشد» report; the swap keeps it.)
   */
  it('shows Persian only for Persian, and English for Arabic, Urdu and the rest', () => {
    const fa = render(<RwaHorizonSwapBanners isRTL lang="fa" />);
    expect(fa.container.querySelector('.rhs-slide--rwa .rhs-title').textContent).toContain('دارایی');
    fa.unmount();

    for (const [lang, rtl] of [['ar', true], ['ur', true], ['tr', false], ['ru', false], ['en', false]]) {
      const r = render(<RwaHorizonSwapBanners isRTL={rtl} lang={lang} />);
      const title = r.container.querySelector('.rhs-slide--rwa .rhs-title').textContent;
      expect(title, `${lang} must read English`).toContain('Real-World Assets');
      /* and no Persian anywhere on the first slide */
      expect(r.container.querySelector('.rhs-slide--rwa').textContent).not.toMatch(/[\u0600-\u06FF]/);
      r.unmount();
    }
  });
});
