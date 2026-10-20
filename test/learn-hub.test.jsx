// @vitest-environment jsdom
/**
 * LEARN HUB — CONTRACT TESTS
 * ---------------------------------------------------------------------------
 * The locale probe (test/learn-hub-locales-probe.mjs) guards the DATA; this
 * file guards the SCREEN, with the real i18n instance and the real fa.json.
 *
 * The bugs it exists to keep dead:
 *
 *   · a tab or sub-tab label rendering as a raw i18n key on a Persian screen
 *     («با وجود زبان فارسی بعضی جملاتش انگلیسیه») — a stubbed t() that echoes
 *     its argument cannot catch that, so no stub is used here;
 *   · a panel hint living INSIDE `role="tablist"`, so assistive tech counts a
 *     stray <p> as a tab and announces "3 of 4" on a two-tab rail;
 *   · a count typed into the markup instead of counted from the array it
 *     describes — the hero promising fourteen guides while the tab holds six;
 *   · the docs level badges staying decorative, so a first-time reader is
 *     shown Intent OS next to «شروع کار».
 *
 * Rendered in Persian on purpose: Persian is where a missing key is loudest.
 */
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '../src/i18n/index.js';
import Learn from '../src/pages/Learn.jsx';
import { TELEGRAM_BOT_USERNAME } from '../src/lib/telegramBot.js';

const renderPage = (path = '/learn') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Learn />
    </MemoryRouter>
  );

const visibleText = () => document.body.textContent || '';
const mainTabList = () => screen.getByRole('tablist', { name: 'منابع یادگیری' });

/*
 * AnimatePresence mode="wait" holds the outgoing panel until its exit
 * animation finishes, so the incoming panel is NOT in the DOM on the line
 * after a click — and for one frame both rails can exist. Every navigation
 * therefore waits for the swap instead of asserting synchronously.
 */
const subTabList = () => {
  const lists = screen.getAllByRole('tablist', { name: 'بخش‌ها' });
  return lists[lists.length - 1];
};

const clickMainTab = async (name) => {
  fireEvent.click(within(mainTabList()).getByRole('tab', { name: new RegExp(name) }));
  await waitFor(() =>
    expect(within(mainTabList()).getByRole('tab', { name: new RegExp(name) })).toHaveProperty('ariaSelected', 'true')
  );
};

const clickSubTab = async (name) => {
  fireEvent.click(within(subTabList()).getByRole('tab', { name: new RegExp(name) }));
  await waitFor(() =>
    expect(within(subTabList()).getByRole('tab', { name: new RegExp(name) })).toHaveProperty('ariaSelected', 'true')
  );
};

const expectSubTabCount = (n) =>
  waitFor(() => expect(within(subTabList()).getAllByRole('tab')).toHaveLength(n));

describe('Learn hub — Persian', () => {
  beforeAll(async () => {
    expect(await setLanguage('fa')).toBe(true);
  });

  afterEach(() => cleanup());

  it('renders the hero, the three top-level tabs and their hints', () => {
    renderPage();
    /*
     * ONE header, and it is the hero. The page used to paint a title row
     * («آموزش») on top of the hero («یادگیری FBT Swap») — two headings, and
     * the <h1> was the smaller of the two. The hero title is the page's h1
     * now; the back button rides in the kicker's row rather than owning one.
     */
    const heading = document.querySelector('h1.lh-hero-title');
    expect(heading).toBeTruthy();
    expect(heading.textContent).toContain('یادگیری FBT Swap');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('.lh-hero-bar .lh-back')).toBeTruthy();
    expect(document.querySelectorAll('.lh-top')).toHaveLength(0);
    for (const name of ['راهنما', 'مستندات', 'ویدیوها']) {
      expect(within(mainTabList()).getByText(name)).toBeTruthy();
    }
    /* The hints, which used to be the keys themselves. */
    expect(within(mainTabList()).getByText('پاسخ و پشتیبانی')).toBeTruthy();
    expect(within(mainTabList()).getByText('هر صفحه، قدم‌به‌قدم')).toBeTruthy();
    expect(within(mainTabList()).getByText('درس‌های تصویری')).toBeTruthy();
  });

  /*
   * Walked across EVERY tab and sub-tab, because a key that is missing in only
   * one of them is invisible to a test that stays on the first one — which is
   * exactly how `help.terms` / `help.privacy` shipped as raw keys on the
   * support panel.
   */
  it('never paints a raw i18n key on any tab or sub-tab', async () => {
    renderPage();
    const noRawKeys = (where) => {
      const text = visibleText();
      for (const pattern of [
        /learn\.[a-zA-Z]/,
        /\bdocs\.[a-zA-Z]/,
        /\bhelp\.[a-zA-Z]/,
        /* `aparat.com` is the channel address printed on the screen, not a
           missing key — a checker that cannot tell them apart is a checker
           that gets muted the first time it cries wolf. */
        /\baparat\.(?!com)[a-zA-Z]/,
        /\bterms\.[a-zA-Z]/,
        /\bprivacy\.[a-zA-Z]/,
        /\bnav\.[a-zA-Z]/,
        /\bcommon\.[a-zA-Z]/,
        /\bdisclaimer\.[a-zA-Z]/
      ]) {
        expect(text, `${where}: matched ${pattern}`).not.toMatch(pattern);
      }
    };

    noRawKeys('help/faq');

    await clickSubTab('پشتیبانی و منابع');
    await waitFor(() => expect(screen.getByText('راه‌های ارتباط با ما')).toBeTruthy());
    noRawKeys('help/support');

    await clickMainTab('مستندات');
    await expectSubTabCount(3);
    noRawKeys('docs/beginner');
    await clickSubTab('متوسط');
    noRawKeys('docs/intermediate');
    await clickSubTab('حرفه\u200cای');
    await waitFor(() => expect(screen.getByText('اینتنت OS')).toBeTruthy());
    noRawKeys('docs/pro');

    await clickMainTab('ویدیوها');
    await waitFor(() => expect(screen.getByTestId('aparat-videos-page')).toBeTruthy());
    noRawKeys('videos/lessons');
    await clickSubTab('مسیر یادگیری');
    await waitFor(() => expect(document.querySelectorAll('.lh-path').length).toBe(3));
    noRawKeys('videos/paths');
  });

  it('marks exactly one main tab and one sub-tab as selected', () => {
    renderPage();
    const selected = screen.getAllByRole('tab').filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(2); // one per tablist
    expect(selected[0].id).toContain('help');
    expect(selected[1].id).toContain('faq');
  });

  it('keeps the sub-tab hint OUTSIDE the tablist', () => {
    renderPage();
    const list = subTabList();
    expect(list.querySelectorAll('p').length).toBe(0);
    expect(list.children.length).toBe(2); // exactly the two sub-tabs
    // ...and the hint is still on screen, as a sibling
    expect(screen.getByText(/اگر جواب اینجا نبود/)).toBeTruthy();
  });

  it('counts the hero chips from the arrays the tabs render from', () => {
    renderPage();
    /* 14 guides · 36 answers · 6 lessons, counted — never typed. */
    const values = Array.from(document.querySelectorAll('.lh-stat-val')).map((el) => el.textContent);
    expect(values).toContain('۱۴');
    expect(values).toContain('۶');
  });

  it('filters the FAQ while typing and offers the support tab when nothing matches', () => {
    renderPage();
    const questions = () => Array.from(document.querySelectorAll('.lh-faq-text')).map((el) => el.textContent);
    const before = questions().length;
    expect(before).toBeGreaterThan(20);

    const search = screen.getByLabelText('جستجو در پرسش‌ها');
    fireEvent.change(search, { target: { value: 'عبارت بازیابی' } });
    const after = questions();
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThan(before);
    /* A question that mentions neither the topic nor its answer is gone. */
    expect(after).not.toContain('آیا NFT سرمایه‌گذاری است؟');

    fireEvent.change(search, { target: { value: 'zzzzz-not-a-question' } });
    expect(screen.getByText('چیزی پیدا نشد')).toBeTruthy();
    // ...and the empty state points at the human channel, not at a dead end
    expect(screen.getByText(/یک نفر واقعی جواب می‌دهد/)).toBeTruthy();
  });

  it('splits the support tab into contact channels, documents and the scam warning', async () => {
    renderPage();
    await clickSubTab('پشتیبانی و منابع');
    await waitFor(() => expect(screen.getByText('راه‌های ارتباط با ما')).toBeTruthy());
    expect(screen.getByText('fbtswap@gmail.com')).toBeTruthy();
    expect(screen.getByText('هشدار کلاه‌برداری')).toBeTruthy();

    /* The five documents, read off the rows themselves — «مستندات» is also a
       top-level tab label, so a bare getByText would match the rail instead. */
    const rows = Array.from(document.querySelectorAll('.lh-link-title')).map((el) => el.textContent);
    expect(rows).toEqual(['مستندات', 'امنیت و ممیزی', 'شرایط استفاده', 'حریم خصوصی', 'کد منبع']);

    /* Three channels, three glyphs — the bug this redesign was asked to fix
       was these tiles rendering with no visible icon. Each tile must carry a
       drawn SVG, the two official ones a «کانال رسمی» badge, and the email
       tile must be a real mailto link (not a button that opens nothing). */
    const tiles = document.querySelectorAll('.lh-contact');
    expect(tiles.length).toBe(3);
    tiles.forEach((tile) => expect(tile.querySelector('.lh-contact-icon svg path, .lh-contact-icon svg rect')).toBeTruthy());
    expect(screen.getAllByText('کانال رسمی').length).toBe(2);
    expect(screen.getByTestId('help-contact-email').getAttribute('href')).toMatch(/^mailto:/);
    expect(screen.getByText(`@${TELEGRAM_BOT_USERNAME}`)).toBeTruthy();
    expect(screen.getByText('تماس با ما')).toBeTruthy();
  });

  it('navigates the docs tab by level, and the pro level holds only the two advanced screens', async () => {
    renderPage();
    await clickMainTab('مستندات');
    await expectSubTabCount(3);

    expect(within(subTabList()).getByText('تازه\u200cکار')).toBeTruthy();
    // beginner shows the wallet guide, and not the professional tools
    expect(screen.getByText('شروع کار')).toBeTruthy();
    expect(screen.queryByText('مدار dYdX — شارژ فقط در سایت مبدا')).toBeNull();

    await clickSubTab('حرفه\u200cای');
    await waitFor(() => expect(screen.getByText('اینتنت OS')).toBeTruthy());
    expect(screen.getByText('مدار dYdX — شارژ فقط در سایت مبدا')).toBeTruthy();
    expect(screen.queryByText('شروع کار')).toBeNull();
    expect(document.querySelectorAll('.lh-doc').length).toBe(2);
  });

  it('opens a guide into its numbered steps and its pitfall line', async () => {
    renderPage();
    await clickMainTab('مستندات');
    await expectSubTabCount(3);

    expect(document.querySelectorAll('.lh-doc-step').length).toBe(0); // collapsed
    fireEvent.click(screen.getByText('شروع کار'));
    await waitFor(() => expect(document.querySelectorAll('.lh-doc-step').length).toBe(4));
    /* The pitfall is the point of these guides: it is the line that stops a
       loss, so it must be inside the open panel, not behind a second tap. */
    expect(screen.getByText(/حواست باشد/)).toBeTruthy();
  });

  it('keeps the channel address on the videos tab whatever sub-tab is open', async () => {
    renderPage();
    await clickMainTab('ویدیوها');
    await waitFor(() => expect(screen.getByTestId('aparat-videos-page')).toBeTruthy());

    expect(screen.getByText('https://www.aparat.com/Fbtcompany')).toBeTruthy();
    expect(screen.getByTestId('aparat-open-channel-btn')).toBeTruthy();
    expect(screen.getByTestId('aparat-interactive-stage')).toBeTruthy();
    for (const id of ['wallet', 'swap', 'stocks', 'ai', 'defi', 'orders']) {
      expect(screen.getByTestId(`aparat-course-${id}`)).toBeTruthy();
    }

    /* The learning path sub-tab regroups the same six lessons by level, and
       the address stays put — it is the identity block, not a sub-tab. */
    await clickSubTab('مسیر یادگیری');
    await waitFor(() => expect(document.querySelectorAll('.lh-path').length).toBe(3));
    expect(visibleText()).toContain('https://www.aparat.com/Fbtcompany');
    expect(screen.getByText('https://www.aparat.com/Fbtcompany')).toBeTruthy();
  });

  it('reads the tab straight out of the URL', () => {
    renderPage('/learn?tab=docs');
    expect(within(mainTabList()).getByRole('tab', { name: /مستندات/ })).toHaveProperty('ariaSelected', 'true');
  });

  it('moves between tabs with the arrow keys, following the reading direction', async () => {
    renderPage();
    const list = mainTabList();
    within(list).getByRole('tab', { name: /راهنما/ }).focus();
    /* RTL: ArrowLeft walks FORWARD. The document direction is the only thing
       that knows which way the rail is laid out. */
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    await waitFor(() =>
      expect(within(list).getByRole('tab', { name: /مستندات/ })).toHaveProperty('ariaSelected', 'true')
    );
  });
});
