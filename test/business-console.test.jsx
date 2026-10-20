// @vitest-environment jsdom
/**
 * BUSINESS CONSOLE — CONTRACT TESTS
 * -------------------------------------------------------------------------
 * The locale probe (test/business-locales-probe.mjs) guards the DATA; this
 * file guards the SCREEN, with the real i18n instance and the real fa.json.
 *
 * The bugs it exists to keep dead:
 *
 *   · tab and sub-tab labels rendering as raw i18n keys in Persian
 *     («با وجود زبان فارسی بعضی جملاتش انگلیسیه») — a stubbed t() that
 *     echoes its argument cannot catch that, so no stub is used here;
 *   · a panel hint living INSIDE `role="tablist"`, so assistive tech counts
 *     a stray <span> as a tab and announces "3 of 4" on a two-tab rail;
 *   · the request form accepting an empty body, so a partner could send a
 *     mail with no company, no name and no message in it;
 *   · the tracking ring and its "2 of 3 steps" copy being two independent
 *     hardcoded numbers that drift apart the moment a step changes.
 *
 * Rendered in Persian on purpose: Persian is where a missing key is loudest.
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '../src/i18n/index.js';
import Business from '../src/pages/Business.jsx';

const PERSIAN = /[؀-ۿ]/;

const renderPage = () =>
  render(
    <MemoryRouter>
      <Business />
    </MemoryRouter>
  );

/** The rendered request cards. Counting text matches instead would double up
    on ancestors, which is how a list of three reads as a list of four. */
const requestCards = () => Array.from(document.querySelectorAll('article.biz-request'));

/** Every text node currently on screen, joined — for "no raw keys" assertions. */
const visibleText = () => document.body.textContent || '';

const tabList = () => screen.getByRole('tablist', { name: /حوزه همکاری/ });
const subTabList = () => screen.getByRole('tablist', { name: /زیرتب/ });

/*
 * AnimatePresence mode="wait" holds the outgoing panel until its exit
 * animation finishes, so the incoming panel is NOT in the DOM on the line
 * after the click. Every navigation therefore awaits the swap; asserting
 * synchronously is how a test ends up checking the panel it just left.
 */
const clickTab = async (name) => {
  fireEvent.click(within(tabList()).getByRole('tab', { name: new RegExp(name) }));
  await waitFor(() => expect(within(tabList()).getByRole('tab', { name: new RegExp(name) })).toHaveProperty('ariaSelected', 'true'));
};
const clickSubTab = async (name) => {
  fireEvent.click(within(subTabList()).getByRole('tab', { name: new RegExp(name) }));
  await waitFor(() => expect(within(subTabList()).getByRole('tab', { name: new RegExp(name) })).toHaveProperty('ariaSelected', 'true'));
};
/** Wait for a panel swap to settle, then run the assertions against it. */
const inPanel = (fn) => waitFor(fn, { timeout: 3000 });

describe('Business console — Persian', () => {
  beforeAll(async () => {
    expect(await setLanguage('fa')).toBe(true);
  });

  afterEach(() => cleanup());

  it('renders the hero and the two top-level tabs in Persian', () => {
    renderPage();
    // hero copy — not a raw key, not an English fallback
    expect(screen.getByText('بیزینس', { selector: 'h1' })).toBeTruthy();
    expect(screen.getByText(/فانوس بازار پیشگام یک شرکت بازرگانی/)).toBeTruthy();
    // tab labels
    expect(within(tabList()).getByText('همکاری')).toBeTruthy();
    expect(within(tabList()).getByText('پیگیری')).toBeTruthy();
    // ...and their hints, which used to be the keys themselves
    expect(within(tabList()).getByText('خدمات و برندها')).toBeTruthy();
    expect(within(tabList()).getByText('درخواست‌ها و وضعیت')).toBeTruthy();
  });

  it('never paints a raw i18n key anywhere on the page', () => {
    renderPage();
    expect(visibleText()).not.toMatch(/biz\.[a-zA-Z]/);
    expect(visibleText()).not.toMatch(/\bcommon\.[a-zA-Z]/);
    expect(visibleText()).not.toMatch(/\babout\.[a-zA-Z]/);
  });

  it('keeps the panel hint OUTSIDE the tablist', () => {
    renderPage();
    /* A tablist may only contain tabs. The hint used to be a child of it, so
       screen readers announced a tab count that did not exist. */
    const list = subTabList();
    expect(list.querySelectorAll('p').length).toBe(0);
    expect(list.children.length).toBe(2); // exactly the two sub-tabs
    // ...and the hint is still on screen, as a sibling
    expect(screen.getByText(/پیشنهادتان را انتخاب کنید/)).toBeTruthy();
  });

  it('marks exactly one tab and one sub-tab as selected', () => {
    renderPage();
    const selectedTabs = screen.getAllByRole('tab').filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selectedTabs.length).toBe(2); // one per tablist
    expect(selectedTabs[0].id).toContain('partnership');
    expect(selectedTabs[1].id).toContain('services');
  });

  it('shows all four services with Persian titles and point chips', () => {
    renderPage();
    for (const title of ['لیست کردن توکن', 'همکاری نقدینگی', 'صرافی وایت‌لیبل', 'یکپارچه‌سازی API']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    // the shared point vocabulary renders (8 keys, 2 per card)
    expect(screen.getByText('نمایش در فهرست بازار')).toBeTruthy();
    expect(screen.getByText('کلید API اختصاصی')).toBeTruthy();
  });

  it('switches to the brands panel and lists every partner', async () => {
    renderPage();
    await clickSubTab('برندها');
    await inPanel(() => expect(screen.getByText('برندها و شرکت‌های شریک')).toBeTruthy());
    for (const name of ['FBT Swap', 'Solana', 'Ethereum', 'Polygon', 'BNB Chain', 'Arbitrum']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    // partner roles are translated, not English fallbacks
    expect(screen.getByText('رابط سواپ و پروتکل اصلی')).toBeTruthy();
  });

  it('follows a service CTA into the open request form', async () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'انتخاب این موضوع' })[1]); // liquidity
    /* The CTA does four things at once: pick the topic, switch tab, switch
       sub-tab and open the form. If any one of them is dropped the user lands
       on the right screen with nothing to fill in — the reported bug. */
    await inPanel(() => {
      expect(within(subTabList()).getByRole('tab', { name: /درخواست‌ها/ }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('form')).toBeTruthy();
      // the chosen topic shows up twice: on the card heading and on the pill
      expect(within(screen.getByRole('form')).getAllByText('همکاری نقدینگی').length).toBeGreaterThan(0);
    });
  });

  it('filters requests by status and narrows the list', async () => {
    renderPage();
    await clickTab('پیگیری');
    await inPanel(() => expect(requestCards().length).toBe(3));
    const filters = screen.getByRole('group', { name: /فیلتر بر اساس وضعیت/ });
    fireEvent.click(within(filters).getByRole('button', { name: /پاسخ‌داده‌شده/ }));
    await waitFor(() => {
      expect(requestCards().length).toBe(1);
      expect(screen.getByText(/آرتا کوین/)).toBeTruthy();
      expect(screen.queryByText(/نور دیجیتال/)).toBeNull();
    });
  });

  it('refuses an empty request and says so in Persian, per field', async () => {
    renderPage();
    await clickTab('پیگیری');
    await inPanel(() => fireEvent.click(screen.getByRole('button', { name: 'درخواست جدید' })));
    const form = await waitFor(() => screen.getByRole('form'));
    fireEvent.submit(form);

    expect(screen.getByText('نام شرکت را وارد کن.')).toBeTruthy();
    expect(screen.getByText('نامی که باید پاسخ بدهیم را وارد کن.')).toBeTruthy();
    expect(screen.getByText('ایمیل معتبر وارد کن.')).toBeTruthy();
    // the invalid fields are marked for assistive tech, not just coloured red
    const invalid = Array.from(form.querySelectorAll('[aria-invalid="true"]'));
    expect(invalid.length).toBeGreaterThanOrEqual(3);
  });

  it('clears a field error as soon as the field is corrected', async () => {
    renderPage();
    await clickTab('پیگیری');
    await inPanel(() => fireEvent.click(screen.getByRole('button', { name: 'درخواست جدید' })));
    const form = await waitFor(() => screen.getByRole('form'));
    fireEvent.submit(form);
    /* getByLabelText, not getAllByLabelText: the label both WRAPS the input
       and carries htmlFor, so the one control is found by both associations. */
    const company = within(form).getAllByLabelText(/نام شرکت/)[0];
    expect(company.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(company, { target: { value: 'آرتا کوین' } });
    expect(company.getAttribute('aria-invalid')).toBe('false');
  });

  it('derives the tracking ring and its copy from the same step list', async () => {
    renderPage();
    await clickTab('پیگیری');
    await clickSubTab('پیگیری وضعیت');
    await inPanel(() => {
      // 2 of 3 done → 67% in Persian digits, and the sentence says the same
      expect(screen.getByText(/۶۷/)).toBeTruthy();
      expect(screen.getByText('۲ از ۳ قدم تکمیل شده')).toBeTruthy();
      // the next-step chip names the step that is actually next
      expect(screen.getByText(/مرحلهٔ بعد/).textContent).toContain('اجرا');
      // timeline states: the two finished steps say "done", the last says pending
      expect(within(screen.getByRole('list')).getAllByText('تکمیل شده').length).toBe(2);
      expect(within(screen.getByRole('list')).getAllByText('در انتظار بررسی').length).toBe(1);
    });
  });

  it('moves the tab selection with the arrow keys', () => {
    renderPage();
    const tabs = within(tabList()).getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabList(), { key: 'ArrowRight' });
    const selected = screen.getAllByRole('tab').filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected[0].id).toContain('followup');
  });

  it('renders the emblem as decoration, never as a name', () => {
    renderPage();
    const marks = document.querySelectorAll('.bizmark');
    expect(marks.length).toBe(1);
    expect(marks[0].getAttribute('aria-hidden')).toBe('true');
    expect(PERSIAN.test(screen.getByText('بیزینس', { selector: 'h1' }).textContent)).toBe(true);
  });

  it('closes the form when the panel is left and never leaves it stale', async () => {
    renderPage();
    await clickTab('پیگیری');
    await inPanel(() => fireEvent.click(screen.getByRole('button', { name: 'درخواست جدید' })));
    await waitFor(() => expect(screen.getByRole('form')).toBeTruthy());
    /* The exit animation is real, so "gone" is a wait, not an instant. */
    await clickSubTab('پیگیری وضعیت');
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    await clickSubTab('درخواست‌ها');
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('counts characters in the message field and caps the input', async () => {
    renderPage();
    await clickTab('پیگیری');
    await inPanel(() => fireEvent.click(screen.getByRole('button', { name: 'درخواست جدید' })));
    const form = await waitFor(() => screen.getByRole('form'));
    const message = within(form).getAllByLabelText(/پیام/)[0];
    expect(within(form).getByText('۰/۶۰۰')).toBeTruthy();
    fireEvent.change(message, { target: { value: 'ا'.repeat(12) } });
    expect(within(form).getByText('۱۲/۶۰۰')).toBeTruthy();
    fireEvent.change(message, { target: { value: 'ا'.repeat(900) } });
    expect(message.value.length).toBe(600);
  });

  it('never opens a new window without the noopener contract', () => {
    renderPage();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(screen.getAllByRole('button', { name: /fbtswap/i })[0]);
    expect(openSpy).toHaveBeenCalled();
    expect(String(openSpy.mock.calls[0][2] || '')).toContain('noopener');
    openSpy.mockRestore();
  });
});
