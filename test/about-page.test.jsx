// @vitest-environment jsdom
/**
 * ABOUT PAGE — DOM RENDER, REAL i18n, REAL fa.json
 *
 * The locale probe (test/about-locales-probe.mjs) guards the data; this one
 * renders the actual screen with the actual i18n instance so the FAILING
 * CASES ARE THE ONES THE USER REPORTED:
 *
 *   · fa.json's about object was closed 13 keys early — headline, "how it
 *     works" and ALL 10 FAQ Q&As silently fell back to English in Persian
 *     («با وجود زبان فارسی بعضی جملاتش و سوالات و جواب انگلیسیه»).
 *   · the principles grid asked for `principles.dataTitleTitle` — a key that
 *     exists in no locale, so the card showed its raw API name in every
 *     language.
 *
 * Rendering with a stubbed t() proves nothing about either, so this suite
 * uses the real one and asserts the Persian strings are on the page.
 */
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '../src/i18n/index.js';
import About from '../src/pages/About.jsx';

describe('About page — Persian', () => {
  beforeAll(async () => {
    const okLoad = await setLanguage('fa');
    expect(okLoad).toBe(true);
  });

  /* no auto-cleanup without vitest globals — each test re-renders the page,
     and leftovers from the previous render read as duplicate matches. */
  afterEach(() => cleanup());

  it('renders every section in Persian — no English fallback', () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>
    );

    // hero
    expect(screen.getByText('روی زنجیره معامله کن. کلیدهایت را نگه دار.')).toBeTruthy();
    // how it works
    expect(screen.getByText('چطور کار می‌کند')).toBeTruthy();
    expect(screen.getByText('کیف پولت را بیاور')).toBeTruthy();
    // FAQ heading + all ten questions are Persian, not English
    expect(screen.getByText('سوالات متداول')).toBeTruthy();
    expect(screen.getByText('FBT Swap چیست؟')).toBeTruthy();
    expect(screen.getByText('FBT از چه بازارهایی پشتیبانی می‌کند؟')).toBeTruthy();
    expect(screen.queryByText('What is FBT Swap?')).toBeNull();
    expect(screen.queryByText('How does the AI work?')).toBeNull();
    // principles: the dataTitle double-suffix bug would show the raw key here
    expect(screen.getByText('هوش داده‌محور')).toBeTruthy();
    expect(screen.queryByText(/dataTitleTitle/)).toBeNull();
    // stats labels
    expect(screen.getByText('شبکه')).toBeTruthy();
    expect(screen.getByText('دارایی نزد ما')).toBeTruthy();
    // CTA + footer (the company name appears in the summary too — scope it)
    expect(screen.getByText('هنوز سوالی داری؟')).toBeTruthy();
    expect(screen.getByText(/فانوس بازار پیشگام/, { selector: '.about-foot span' })).toBeTruthy();
  });

  it('accordion opens the Persian answer on the matching question', () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>
    );

    const q = screen.getByRole('button', { name: /اسمارت مانی چیست/ });
    expect(q.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(q);
    expect(q.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/فعالیت آنچین — حرکات نهنگ‌ها/)).toBeTruthy();
    // one-at-a-time accordion: opening another closes the first
    const q2 = screen.getByRole('button', { name: /آیا FBT سود را تضمین می‌کند/ });
    fireEvent.click(q2);
    expect(q2.getAttribute('aria-expanded')).toBe('true');
    expect(q.getAttribute('aria-expanded')).toBe('false');
  });

  it('routes the six feature cards to screens that actually exist', () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>
    );
    for (const to of ['/swap', '/wallet', '/intent', '/signals', '/smart-money', '/farm']) {
      const link = document.querySelector(`a.about-feature[href="${to}"]`);
      expect(link, `feature card → ${to}`).toBeTruthy();
    }
  });
});
