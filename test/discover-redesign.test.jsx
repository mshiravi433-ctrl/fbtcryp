// @vitest-environment jsdom
/**
 * DISCOVER — SCREEN CONTRACT (Persian)
 * ---------------------------------------------------------------------------
 * The locale/search probe guards the DATA; this guards what the user actually
 * sees. It uses the real i18n instance and the real fa.json — a stubbed t()
 * that echoes its key cannot catch an English sentence on a Persian screen.
 *
 * Bugs locked out:
 *  · English hero / labels / CTA when the language is fa;
 *  · «FBT Browser» anywhere in the tab (the user asked for «مرورگر» only);
 *  · a search box that neither filters nor suggests;
 *  · a card popup that lost its primary action and its security notes.
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '../src/i18n/index.js';
import Discover from '../src/pages/Discover.jsx';

vi.mock('../src/lib/intelApi.js', () => ({
  exploreApi: {
    trending: vi.fn(async () => ({ data: { trending: [], rising: [], highLiquidity: [] }, meta: { updatedAt: Date.now(), source: 'test' } })),
    protocols: vi.fn(async () => ({ data: { protocols: [] } })),
    protocol: vi.fn(async () => ({ data: null, meta: null }))
  },
  intelErrorCode: () => 'unavailable'
}));

const renderPage = () => render(<MemoryRouter initialEntries={['/explore?tab=discover']}><Discover embedded /></MemoryRouter>);
const bodyText = () => document.body.textContent || '';
const searchInput = () => screen.getByRole('combobox', { name: 'جستجوی پروتکل، دسته یا شبکه' });

describe('Discover — Persian screen', () => {
  beforeAll(async () => { expect(await setLanguage('fa')).toBe(true); });
  afterEach(() => cleanup());

  it('renders the whole surface in Persian, with no branded browser name', async () => {
    renderPage();
    expect(screen.getByText('دنیای وب۳ را کاوش کن')).toBeTruthy();
    expect(screen.getByText('با خیالی آسوده')).toBeTruthy();
    expect(screen.getByPlaceholderText('نام پروتکل، دسته یا شبکه را بنویس…')).toBeTruthy();
    expect(bodyText()).not.toMatch(/Open in FBT Browser|AI Discovery|Trending dApps|Featured protocols|Recommended for you/);
    expect(bodyText()).not.toMatch(/FBT Browser|مرورگر FBT/);
    await waitFor(() => expect(document.querySelectorAll('.dcx-card').length).toBeGreaterThan(0));
    expect(bodyText()).toContain('جزئیات'); // card action is localized too
  });

  it('suggests protocols for a Persian query and opens the modern sheet', async () => {
    renderPage();
    const input = searchInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'یونیسواپ' } });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
    const option = await screen.findByRole('option', { name: /Uniswap/ });
    expect(option).toBeTruthy();
    fireEvent.click(option);
    await waitFor(() => expect(screen.getByTestId('disc-sheet')).toBeTruthy());
    const sheet = screen.getByTestId('disc-sheet');
    expect(within(sheet).getByRole('button', { name: /باز کردن در مرورگر/ })).toBeTruthy();
    expect(within(sheet).getByText('دامنهٔ رسمی')).toBeTruthy();
    expect(within(sheet).getByText('نکات امنیتی')).toBeTruthy();
    expect(sheet.textContent).not.toMatch(/FBT Browser|Open in browser/);
    expect(sheet.textContent).toContain('app.uniswap.org');
  });

  it('offers a smart filter for a natural-language Persian query', async () => {
    renderPage();
    const input = searchInput();
    fireEvent.change(input, { target: { value: 'وامدهی روی آربیتروم' } });
    await waitFor(() => expect(bodyText()).toContain('اعمال فیلترها'));
    const smart = screen.getByRole('option', { name: /اعمال فیلترها/ });
    fireEvent.click(smart);
    await waitFor(() => expect(searchInput().value).toBe(''));
    const lendingChip = [...document.querySelectorAll('.dcx-chip')].find((b) => b.textContent === 'وام‌دهی');
    expect(lendingChip?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelectorAll('.dcx-card').length).toBeGreaterThan(0);
    for (const card of document.querySelectorAll('.dcx-card')) {
      expect(card.textContent).toContain('وام‌دهی');
    }
  });

  it('paginates the grid instead of dumping every card on first paint', async () => {
    renderPage();
    await waitFor(() => expect(document.querySelectorAll('.dcx-card').length).toBe(12));
    const more = screen.getByRole('button', { name: /نمایش بیشتر/ });
    fireEvent.click(more);
    await waitFor(() => expect(document.querySelectorAll('.dcx-card').length).toBe(24));
  });

  it('renders aligned custom network/sort SVG popovers, offline protocol brand SVGs, and a clean sheet without X button', async () => {
    renderPage();
    await waitFor(() => expect(document.querySelectorAll('.dcx-card').length).toBe(12));

    // All 12 visible protocol cards render full-bleed inline brand SVGs immediately
    expect(document.querySelectorAll('.dcx-card .dcx-logo-svg svg').length).toBe(12);
    // All 10 category tabs carry dedicated SVG icons
    expect(document.querySelectorAll('.dcx-chip .dcx-chip-ico svg').length).toBe(10);

    // Network & Sort triggers live inside the 2-column aligned filter bar (no native <select>)
    expect(document.querySelectorAll('.dcx select').length).toBe(0);
    const netTrigger = screen.getByRole('button', { name: 'شبکه' });
    const sortTrigger = screen.getByRole('button', { name: 'مرتب‌سازی' });
    expect(netTrigger.textContent).toContain('همهٔ شبکه‌ها');
    expect(sortTrigger.textContent).toContain('داغ‌ترین');

    // Open network popover -> has SVG chain icons & selects Arbitrum
    fireEvent.click(netTrigger);
    const netPopover = screen.getByRole('listbox', { name: 'شبکه' });
    expect(netPopover.querySelectorAll('svg').length).toBeGreaterThanOrEqual(10);
    const arbOpt = [...netPopover.querySelectorAll('[role="option"]')].find((el) => el.textContent?.includes('آربیتروم'));
    expect(arbOpt).toBeTruthy();
    fireEvent.click(arbOpt);
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'شبکه' })).toBeNull());
    expect(netTrigger.textContent).toContain('آربیتروم');

    // Open sort popover -> has SVG sort icons & selects highest TVL
    fireEvent.click(sortTrigger);
    const sortPopover = screen.getByRole('listbox', { name: 'مرتب‌سازی' });
    expect(sortPopover.querySelectorAll('svg').length).toBeGreaterThanOrEqual(6);
    const tvlOpt = [...sortPopover.querySelectorAll('[role="option"]')].find((el) => el.textContent?.includes('بیشترین سرمایه'));
    expect(tvlOpt).toBeTruthy();
    fireEvent.click(tvlOpt);
    expect(sortTrigger.textContent).toContain('بیشترین سرمایه');

    // Open a protocol card -> detail sheet has NO X button, compact star button, and brand SVG
    const firstCard = document.querySelector('.dcx-card');
    fireEvent.click(firstCard);
    await waitFor(() => expect(document.querySelector('.dcx-sheet')).toBeTruthy());
    const sheet = document.querySelector('.dcx-sheet');
    expect(sheet.querySelector('.dcx-sheet-close')).toBeNull();
    expect(sheet.querySelector('.sheet-close')).toBeNull();
    expect(sheet.querySelector('button.dcx-fav.dcx-sheet-fav')).toBeTruthy();
    expect(sheet.querySelector('.dcx-logo-svg svg')).toBeTruthy();
  });
});
