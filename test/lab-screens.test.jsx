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
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opt) => {
      // `t('k', { returnObjects: true })` feeds the .map() of a few lists.
      if (opt?.returnObjects) return ['one', 'two', 'three', 'four'];
      if (typeof opt === 'object' && opt) return key;
      return typeof opt === 'string' ? opt : key;
    },
    i18n: { language: 'fa', changeLanguage: () => {} }
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
});

describe('Lab shell', () => {
  it('lists every simulator and tool on the landing grid', async () => {
    const { container, unmount } = await mount('/lab');

    // `getByText` throws when the hero title is missing; no jest-dom in this
    // repo, so assertions stay on plain DOM/Chai.
    expect(screen.getByText('lab2.title').textContent).toBe('lab2.title');
    // Three group tabs, each with its own layoutId pill target.
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(container.querySelectorAll('.lab2-group')).toHaveLength(2); // Practice + More tools

    const cardIds = [...container.querySelectorAll('.lab2-card')].map((el) => el.getAttribute('aria-label'));
    expect(cardIds).toContain('lab2.cards.predict.title');
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
