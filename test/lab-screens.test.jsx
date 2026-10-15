// @vitest-environment jsdom
/**
 * Lab — every screen renders.
 *
 * The Lab is one route with 14 surfaces behind it: three group tabs (Practice,
 * Learn, Advanced) holding ten simulators, plus the Compare / Level /
 * Leaderboard tools that `lab2.tools.js` registers. They are reached by URL
 * (`?tab=…&child=…`, `?tool=…`) rather than by clicking through, which means a
 * crash in one of them is invisible to anyone testing the page by hand — you
 * only find it if you happen to open that exact screen.
 *
 * So this suite drives the router instead of the mouse: mount each URL, and
 * assert the screen produced its own header, its body, and no poison text.
 *
 * "No NaN" is an assertion, not a style choice. Every Lab screen is fed by
 * `lib/lab/marketData.js` and `lib/lab/engine.js`; a single undefined price
 * shows up as `$NaN` in the hero and then as `NaN` in the P&L, allocation and
 * shock readouts. It is the most common way these screens break and the
 * cheapest to catch in bulk.
 *
 * i18n is stubbed to echo keys back, so assertions are made on structure and on
 * key names rather than on translated copy — the locales are tested elsewhere
 * (test/i18n-probe.jsx) and asserting English strings here would only make this
 * file churn every time a translation is reworded.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* Mutable so one suite can render the Lab in Persian and another in English —
   the video-academy doorway is gated on the resolved language, and a gate that
   is never tested from both sides is a gate nobody has verified. */
const LANG = vi.hoisted(() => ({ current: 'fa' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opt) => {
      // `t('k', { returnObjects: true })` feeds the .map() of a few lists.
      if (opt?.returnObjects) return ['one', 'two', 'three', 'four'];
      if (typeof opt === 'object' && opt) return key;
      return typeof opt === 'string' ? opt : key;
    },
    i18n: {
      language: LANG.current,
      resolvedLanguage: LANG.current,
      changeLanguage: (l) => { LANG.current = l; }
    }
  })
}));

vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({ haptic: () => {} })
}));

import Lab from '../src/pages/Lab';
import { CARDS as PRACTICE_CARDS } from '../src/components/Lab/PracticeGroup';
import { CARDS as LEARN_CARDS } from '../src/components/Lab/LearnGroup';
import { CARDS as ADVANCED_CARDS } from '../src/components/Lab/AdvancedGroup';

/** tab → child id, straight from the card registries so the two cannot drift. */
const CHILDREN = [
  ...PRACTICE_CARDS.map((c) => ({ tab: 'practice', ...c })),
  ...LEARN_CARDS.map((c) => ({ tab: 'learn', ...c })),
  ...ADVANCED_CARDS.map((c) => ({ tab: 'advanced', ...c }))
];

const TOOLS = [
  { id: 'compare', name: 'Compare Portfolios' },
  { id: 'level', name: 'Level System' },
  { id: 'leaderboard', name: 'Leaderboard' }
];

async function mount(url) {
  const view = render(
    <MemoryRouter initialEntries={[url]}>
      <Lab />
    </MemoryRouter>
  );
  // Let the entrance transitions and the first price effect settle.
  await new Promise((r) => setTimeout(r, 60));
  return view;
}

beforeEach(() => {
  localStorage.clear();
  LANG.current = 'fa';
});

describe('Lab shell', () => {
  it('lists every simulator and tool on the landing grid', async () => {
    const { container, unmount } = await mount('/lab');

    // `getByText` throws when the hero title is missing; no jest-dom in this
    // repo, so assertions stay on plain DOM/Chai.
    expect(screen.getByText('lab2.title').textContent).toBe('lab2.title');
    // Three group tabs, each with its own layoutId pill target.
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
    // One .lab2-group on the landing grid: the active tab's card grid
    // (Practice on /lab). The three extra tools live in the More-tools fold,
    // which is closed by default — open it the way a thumb would before
    // asserting on its cards, so the fold's existence is verified, not
    // merely assumed.
    expect(container.querySelectorAll('.lab2-group')).toHaveLength(1);

    const landed = [...container.querySelectorAll('.lab2-card')].map((el) => el.getAttribute('aria-label'));
    expect(landed).toContain('lab2.cards.predict.title');

    const fold = container.querySelector('.lab2-more-trigger');
    expect(fold, 'the More-tools fold must exist').toBeTruthy();
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(container.querySelector('.lab2-more-trigger').getAttribute('aria-expanded')).toBe('true');

    const cardIds = [...container.querySelectorAll('.lab2-card')].map((el) => el.getAttribute('aria-label'));
    expect(cardIds).toContain('lab2.cards.compare.title');
    expect(cardIds).toContain('lab2.cards.leaderboard.title');

    expect(container.innerHTML).not.toContain('NaN');
    unmount();
  });

  it('shows the group for the selected tab', async () => {
    const { container, unmount } = await mount('/lab?tab=advanced');
    const titles = [...container.querySelectorAll('.lab2-card-title')].map((el) => el.textContent);
    expect(titles).toContain('lab2.cards.strategy.title');
    expect(titles).toContain('lab2.cards.defi.title');
    expect(titles).not.toContain('lab2.cards.predict.title');
    unmount();
  });
});

describe.each(CHILDREN)('Lab · $tab/$id', ({ tab, id }) => {
  it('renders its own screen', async () => {
    const { container, unmount } = await mount(`/lab?tab=${tab}&child=${id}`);

    const head = container.querySelector('.lab2-screen-head');
    expect(head, 'screen header missing').toBeTruthy();
    expect(head.querySelector('.lab2-screen-title').textContent).toBe(`lab2.screens.${id}.title`);
    // A back affordance is mandatory — it is the only way out of a child screen.
    expect(head.querySelector('.lab2-back')).toBeTruthy();
    // The screen must have produced body content, not just chrome.
    expect(container.querySelector('.lab2-screen').children.length).toBeGreaterThan(1);
    expect(container.innerHTML).not.toContain('NaN');

    unmount();
  });
});

describe.each(TOOLS)('Lab tool · $id', ({ id }) => {
  it('renders standalone, with the tab strip kept only as a way out', async () => {
    const { container, unmount } = await mount(`/lab?tool=${id}`);

    expect(container.querySelector('.lab2-screen-head .lab2-back')).toBeTruthy();

    // A tool is not a tab panel, so the strip stays visible for navigation but
    // claims no selection — an `aria-selected="true"` tab pointing at a panel
    // that is not on screen would be a lie to a screen reader.
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(3);
    expect(tabs.every((el) => el.getAttribute('aria-selected') === 'false')).toBe(true);

    // The "More tools" grid is hidden: you are already inside one of them.
    expect(container.querySelector('.lab2-group')).toBeFalsy();
    expect(container.innerHTML).not.toContain('NaN');

    unmount();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE PERSIAN VIDEO ACADEMY DOORWAY
   «دکمه فیلم‌های آموزشی را از منو بیشتر ببر و بزار داخل صفحه آزمایشگاه، بخش
    امکانات بیشتر، و اینکه فقط با زبان فارسی که انتخاب می‌شه این گزینه بیاد …
    پخش موسیقی نداشته باشد»
   Four assertions, one per clause: it is OUT of the More drawer, it is IN the
   Lab's more-tools fold, it is Persian-only, and the Lab makes no sound.
   ══════════════════════════════════════════════════════════════════════════ */
describe('Lab · Persian video academy', () => {
  it('lives inside the more-tools fold, as its own full-width card', async () => {
    const { container, unmount } = await mount('/lab');

    // Closed by default: the fold has to be opened the way a thumb would.
    expect(container.querySelector('[data-testid="lab-academy-card"]')).toBeNull();
    fireEvent.click(container.querySelector('.lab2-more-trigger'));

    const card = container.querySelector('[data-testid="lab-academy-card"]');
    expect(card, 'the academy card must be in the more-tools fold').toBeTruthy();
    expect(container.querySelector('.lab2-more-panel').contains(card)).toBe(true);
    expect(card.textContent).toContain('lab2.cards.aparat.title');
    expect(card.textContent).toContain('lab2.cards.aparat.sub');
    // Its own art, not a reused 44px icon tile.
    expect(card.querySelector('.lab2-academy-media')).toBeTruthy();
    expect(card.classList.contains('lab2-card')).toBe(false);
    unmount();
  });

  it('appears in Persian and in no other language', async () => {
    LANG.current = 'en';
    const { container, unmount } = await mount('/lab');
    fireEvent.click(container.querySelector('.lab2-more-trigger'));

    expect(container.querySelector('[data-testid="lab-academy-card"]')).toBeNull();
    // The three simulators beside it are untouched by the gate.
    expect(container.querySelectorAll('.lab2-more-panel .lab2-card')).toHaveLength(3);
    unmount();
  });

  it('is gone from the More drawer, route and all translations intact', () => {
    const sheet = readFileSync('src/components/MoreSheet.jsx', 'utf8');
    expect(sheet).not.toMatch(/to:\s*'\/aparat'/);
    expect(sheet).not.toMatch(/nav\.aparat/);
    // An icon imported by nothing is how a removed tile comes back in a merge.
    expect(sheet).not.toMatch(/IconVideo/);

    // A menu entry is discovery; a route is a contract. The page still resolves.
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).toMatch(/path="\/aparat"/);
  });

  it('makes no sound: no media element, no ambient controller', async () => {
    const { container, unmount } = await mount('/lab');
    fireEvent.click(container.querySelector('.lab2-more-trigger'));
    expect(container.querySelectorAll('audio, video')).toHaveLength(0);

    for (const f of [
      'src/pages/Lab.jsx',
      'src/components/Lab/Shared.jsx',
      'src/components/Lab/PracticeGroup.jsx',
      'src/components/Lab/LearnGroup.jsx',
      'src/components/Lab/AdvancedGroup.jsx'
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} must not import the story score`).not.toMatch(/storyAudio|createStoryAmbientController/);
      expect(src, `${f} must not mount a media element`).not.toMatch(/new Audio\(|<audio|<video/);
    }
    unmount();
  });
});
