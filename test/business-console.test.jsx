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
 *     a stray span as a tab and announces "3 of 4" on a two-tab rail;
 *   · the request form accepting an empty body, so a partner could send a
 *     mail with no company, no name and no message in it;
 *   · THE FAKE BACKEND: a «پیگیری» tab with a status ring, a two-of-three
 *     timeline and three demo requests with timestamps, none of it wired to
 *     anything («اطلاعات غیر واقعی هست — ببرش … چیزی در سرور ثبت نمی‌شود»).
 *     The second tab is now «درخواست»: the explanation and the form, with no
 *     invented statuses anywhere on the page.
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
    // tab labels — the second tab is the request itself, not a fake tracker
    expect(within(tabList()).getByText('همکاری')).toBeTruthy();
    expect(within(tabList()).getByText('درخواست')).toBeTruthy();
    // ...and their hints, which used to be the keys themselves
    expect(within(tabList()).getByText('خدمات و برندها')).toBeTruthy();
    expect(within(tabList()).getByText('فرم درخواست همکاری')).toBeTruthy();
    // the word «پیگیری» and its panel are gone from the rail
    expect(within(tabList()).queryByText('پیگیری')).toBeNull();
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

  it('follows a service CTA straight into the request form, topic preselected', async () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'انتخاب این موضوع' })[1]); // liquidity
    /* The CTA does three things at once now: pick the topic, switch to the
       «درخواست» tab and bring the form into view. The tab IS the form — there
       is no extra "new request" button to find and press. */
    await inPanel(() => {
      expect(within(tabList()).getByRole('tab', { name: /درخواست/ }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('form')).toBeTruthy();
      // the chosen topic shows up twice: on the card heading and on the pill
      expect(within(screen.getByRole('form')).getAllByText('همکاری نقدینگی').length).toBeGreaterThan(0);
    });
  });

  it('the request tab is the form itself — always visible, no toggle, no sub-rail', async () => {
    renderPage();
    await clickTab('درخواست');
    await inPanel(() => {
      expect(screen.getByRole('form')).toBeTruthy();
      // the request tab has no sub-tabs; the sub-rail is not rendered empty
      expect(screen.queryByRole('tablist', { name: /زیرتب/ })).toBeNull();
    });
    // and there is no «درخواست جدید» button gating the form any more
    expect(screen.queryByRole('button', { name: 'درخواست جدید' })).toBeNull();
  });

  it('carries no fake backend: no demo requests, no filters, no status ring', async () => {
    renderPage();
    await clickTab('درخواست');
    await inPanel(() => expect(screen.getByRole('form')).toBeTruthy());
    /* «اطلاعات غیر واقعی هست — ببرش»: the demo companies, the status
       filter chips, the progress ring and the done/pending timeline were all
       set dressing around a mailto. None of them may come back. */
    expect(screen.queryByText(/آرتا کوین/)).toBeNull();
    expect(screen.queryByText(/نور دیجیتال/)).toBeNull();
    expect(screen.queryByText(/بیت‌پلاس/)).toBeNull();
    expect(screen.queryByRole('group', { name: /فیلتر بر اساس وضعیت/ })).toBeNull();
    expect(document.querySelectorAll('.biz-request, .biz-ring, .biz-timeline, .biz-progress').length).toBe(0);
    expect(screen.queryByText(/پیگیری وضعیت/)).toBeNull();
  });

  it('explains what a request actually is before the form', async () => {
    renderPage();
    await clickTab('درخواست');
    await inPanel(() => {
      /* «درخواست معنی نشده» — the clarity card must be there, in Persian,
         with the three real steps — and it must say the truth: no in-app
         inbox, nothing stored until the user's own mail app sends it. */
      expect(screen.getByText('ارسال درخواست چطور کار می‌کند — واضح و صادقانه')).toBeTruthy();
      expect(screen.getByText(/هیچ صندوق داخلی/)).toBeTruthy();
      expect(screen.getByText(/برنامهٔ ایمیل‌تان با موضوع و متن آماده باز می‌شود/)).toBeTruthy();
      // three promises, each rendered as its own chip
      expect(screen.getByText('بدون ذخیره سروری — فقط ایمیل')).toBeTruthy();
      expect(screen.getByText('ما هرگز آدرس واریز نمی‌دهیم')).toBeTruthy();
      expect(screen.getByText('پاسخ در یک روز کاری')).toBeTruthy();
    });
  });

  it('refuses an empty request and says so in Persian, per field', async () => {
    renderPage();
    await clickTab('درخواست');
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
    await clickTab('درخواست');
    const form = await waitFor(() => screen.getByRole('form'));
    fireEvent.submit(form);
    /* getByLabelText, not getAllByLabelText: the label both WRAPS the input
       and carries htmlFor, so the one control is found by both associations. */
    const company = within(form).getAllByLabelText(/نام شرکت/)[0];
    expect(company.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(company, { target: { value: 'آرتا کوین' } });
    expect(company.getAttribute('aria-invalid')).toBe('false');
  });

  it('counts characters in the message field and caps the input', async () => {
    renderPage();
    await clickTab('درخواست');
    const form = await waitFor(() => screen.getByRole('form'));
    const message = within(form).getAllByLabelText(/پیام/)[0];
    expect(within(form).getByText('۰/۶۰۰')).toBeTruthy();
    fireEvent.change(message, { target: { value: 'ا'.repeat(12) } });
    expect(within(form).getByText('۱۲/۶۰۰')).toBeTruthy();
    fireEvent.change(message, { target: { value: 'ا'.repeat(900) } });
    expect(message.value.length).toBe(600);
  });

  it('moves the tab selection with the arrow keys', () => {
    renderPage();
    const tabs = within(tabList()).getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabList(), { key: 'ArrowRight' });
    const selected = screen.getAllByRole('tab').filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected[0].id).toContain('request');
  });

  it('spells out conditions and method on the services panel', () => {
    renderPage();
    expect(screen.getByText('شرایط و روش بررسی')).toBeTruthy();
    expect(screen.getByText('این میز برای چه کسانی است')).toBeTruthy();
    expect(screen.getByText('روش کار ما')).toBeTruthy();
    expect(screen.getByText('زمان‌بندی و هزینه')).toBeTruthy();
    /* The fee in the eligibility copy is interpolated from FEE_BPS, not typed
       into the translation — a hardcoded 0.7% would be a lie the day the fee
       changes. */
    expect(screen.getByText(/کارمزد ۰٫۷٪ سازنده/)).toBeTruthy();
  });

  it('states what is guaranteed and what is not', () => {
    renderPage();
    expect(screen.getByText(/لیست شدن، حجم، قیمت یا سود را تضمین نمی‌کنیم/)).toBeTruthy();
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
