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
 *    3D), auto-advances every 10s, only shows Persian when the language is
 *    fa, and — since «دکمه چپ و راست را در بنر مخفی کن» — renders no button
 *    except the two slides: the indicator dots used to be <button>s, which
 *    the app's global 44px tap-target rule inflated into two grey discs in
 *    the middle of the banner.
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
   * مینیمال و مدرن تر» — the 3D flip card is gone. Then «دکمه چپ و راست را
   * در بنر مخفی کن» — the indicator is no longer a pair of buttons. These
   * tests drive the banner the way a user does: keys, swipes, and the
   * slides themselves.
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
    /* two indicator segments, one active */
    const segs = root.querySelectorAll('.rhs-seg');
    expect(segs).toHaveLength(2);
    expect(root.querySelectorAll('.rhs-seg.is-on')).toHaveLength(1);
  });

  it('renders no button except the two slides (the inflated «left and right buttons» fix)', () => {
    const { container } = render(<RwaHorizonSwapBanners isRTL lang="fa" />);
    const root = container.querySelector('.rhs');
    /*
     * `button { min-height: 44px; min-width: 44px }` in index.css applies to
     * EVERY button. The old 5px dots were buttons, so they rendered as two
     * 44px discs on top of the subtitle. Anything that is not a real tap
     * target must therefore not be a <button>.
     */
    const buttons = [...root.querySelectorAll('button, [role="button"]')];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => b.classList.contains('rhs-slide'))).toBe(true);
    /* the indicator is inert markup */
    const timeline = root.querySelector('.rhs-timeline');
    expect(timeline).toBeTruthy();
    expect(timeline.querySelectorAll('button')).toHaveLength(0);
    expect(timeline.getAttribute('aria-hidden')).toBe('true');
    /* and the circular arrow at the end of each slide is gone */
    expect(root.querySelector('.rhs-go')).toBeNull();
    expect(root.querySelector('.rhs-dot')).toBeNull();
  });

  it('carries the decoration and the drawn glyphs (no emoji)', () => {
    const { container } = render(<RwaHorizonSwapBanners isRTL lang="fa" />);
    const root = container.querySelector('.rhs');
    for (const cls of ['.rhs-glow--rwa', '.rhs-glow--hz', '.rhs-grid', '.rhs-sweep', '.rhs-frame']) {
      expect(root.querySelector(cls), cls).toBeTruthy();
    }
    /* one orb with two rings and a glyph per slide, one sparkline per slide */
    expect(root.querySelectorAll('.rhs-orb')).toHaveLength(2);
    expect(root.querySelectorAll('.rhs-ring-dash')).toHaveLength(2);
    expect(root.querySelectorAll('.rhs-ring-arc')).toHaveLength(2);
    expect(root.querySelectorAll('.rhs-orb-core svg')).toHaveLength(2);
    expect(root.querySelectorAll('.rhs-art .rhs-spark-line')).toHaveLength(2);
    /* the sparkline is stroke-only: an unfilled open path paints a black wedge */
    for (const line of root.querySelectorAll('.rhs-spark-line')) expect(line.getAttribute('fill')).toBe('none');
    /* the two gradients must not share an id */
    const ids = [...root.querySelectorAll('.rhs-art linearGradient')].map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
    expect(root.textContent).not.toMatch(/[⚡⛓📊🛡🔒🧾🏛💰🌍🌐🥇]/u);
    /* the subtitle separators are drawn, not typed */
    expect(root.querySelectorAll('.rhs-slide--rwa .rhs-sep')).toHaveLength(2);
    expect(root.querySelectorAll('.rhs-slide--hz .rhs-sep')).toHaveLength(3);
  });

  it('swaps from the arrow keys (mirrored for RTL) and routes each slide', () => {
    const onGoRwa = vi.fn();
    const onGoHorizon = vi.fn();
    const { container } = render(
      <RwaHorizonSwapBanners isRTL lang="fa" onGoRwa={onGoRwa} onGoHorizon={onGoHorizon} />
    );
    const root = container.querySelector('.rhs');
    const track = root.querySelector('.rhs-track');
    expect(root.dataset.slide).toBe('rwa');
    expect(track.style.transform).toBe('translateX(0%)');

    /* RTL: the next slide sits physically LEFT, so ArrowLeft advances… */
    fireEvent.keyDown(root, { key: 'ArrowLeft' });
    expect(root.dataset.slide).toBe('hz');
    /* …and the track moves RIGHT to reveal it */
    expect(track.style.transform).toBe('translateX(50%)');
    expect(root.querySelectorAll('.rhs-seg')[1].classList.contains('is-on')).toBe(true);

    fireEvent.keyDown(root, { key: 'ArrowRight' });
    expect(root.dataset.slide).toBe('rwa');
    expect(track.style.transform).toBe('translateX(0%)');

    fireEvent.click(root.querySelector('.rhs-slide--hz'));
    expect(onGoHorizon).toHaveBeenCalledTimes(1);
    fireEvent.click(root.querySelector('.rhs-slide--rwa'));
    expect(onGoRwa).toHaveBeenCalledTimes(1);
  });

  it('in LTR the arrow keys read the other way', () => {
    const { container } = render(<RwaHorizonSwapBanners isRTL={false} lang="en" />);
    const root = container.querySelector('.rhs');
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    expect(root.dataset.slide).toBe('hz');
    expect(root.querySelector('.rhs-track').style.transform).toBe('translateX(-50%)');
    fireEvent.keyDown(root, { key: 'ArrowLeft' });
    expect(root.dataset.slide).toBe('rwa');
  });

  it('advances every 10s on its own, and comes back', () => {
    const { container } = render(<RwaHorizonSwapBanners isRTL lang="fa" />);
    const root = container.querySelector('.rhs');
    /* the fill runs on the same clock as the timer */
    expect(root.querySelector('.rhs-seg.is-on .rhs-seg-fill').style.animationDuration).toBe('10000ms');
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
    expect(fa.container.querySelector('.rhs').getAttribute('dir')).toBe('rtl');
    fa.unmount();

    for (const [lang, rtl] of [['ar', true], ['ur', true], ['tr', false], ['ru', false], ['en', false]]) {
      const r = render(<RwaHorizonSwapBanners isRTL={rtl} lang={lang} />);
      const title = r.container.querySelector('.rhs-slide--rwa .rhs-title').textContent;
      expect(title, `${lang} must read English`).toContain('Real-World Assets');
      /* and no Persian anywhere on the first slide */
      expect(r.container.querySelector('.rhs-slide--rwa').textContent).not.toMatch(/[\u0600-\u06FF]/);
      /* while the layout still follows the page direction */
      expect(r.container.querySelector('.rhs').getAttribute('dir')).toBe(rtl ? 'rtl' : 'ltr');
      r.unmount();
    }
  });
});
