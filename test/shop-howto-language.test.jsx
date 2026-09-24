// @vitest-environment jsdom
/**
 * «داخل فروشگاه وقتی روی کارتی میزنی و چطور کار میکند حتی وقتی زبان مثلا
 *  فارسی باشد باز هم انگلیسی هست درست کن»
 * ---------------------------------------------------------------------------
 * The shop sheet's two prose blocks — the redemption note and the how-to — come
 * from Cryptorefills, and their coverage is partial: verified live against the
 * real API, `lang=es` and `lang=ar` return Spanish and Arabic prose while
 * `lang=fa` returns `rich_description: null`.
 *
 * Three behaviours are pinned here, and the third is the one that keeps this
 * change from making things worse:
 *
 *   1. Persian shopper, English prose from the provider → the sheet shows OUR
 *      own Persian steps, and the provider's wording is still there underneath,
 *      labelled with the language it is in. Nothing is machine-translated and
 *      nothing is thrown away.
 *   2. Persian shopper, provider prose that IS in the shopper's language →
 *      their text, as it always was. No duplicate step list.
 *   3. THE WARNING IS NEVER LOST. Their region-lock note is the sentence that
 *      stops somebody buying a card they cannot redeem, so every branch below
 *      asserts it is on screen — in English if that is all they gave us.
 *
 * The dependency on the provider's answer is injected at the module boundary
 * (`src/lib/shop`), so the sheet is exercised against `contentLocale` values
 * that really occur rather than against a happy path.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';

let language = 'fa';
const t = (key, values = {}) => {
  const dict = language === 'fa' ? fa : en;
  const text = key.split('.').reduce((o, k) => o?.[k], dict) ?? values.defaultValue ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language, resolvedLanguage: language } })
}));

vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({ haptic: () => {}, tg: null, user: null })
}));
vi.mock('../src/store/useAppStore', () => ({
  useAppStore: (sel) => sel({ ensureRefCode: () => 'FBTREF' })
}));
vi.mock('../src/hooks/useShare', () => ({
  useShare: () => [async () => ({ ok: true }), () => null]
}));
vi.mock('../src/lib/browser', () => ({ openUrl: vi.fn() }));

/* ── the provider, under our control ─────────────────────────────────────── */
const PROVIDER = {
  en: {
    note: 'Steam gift cards are region-locked and cannot be redeemed outside the issuing country.',
    howTo: 'Go to the Steam Redeem page and log into your account.'
  },
  fa: {
    note: 'کارت‌های استیم محدود به منطقه هستند.',
    howTo: 'به صفحهٔ استیم برو و کد را وارد کن.'
  }
};

let productsPayload = null;
vi.mock('../src/lib/shop', async (original) => ({
  ...(await original()),
  fetchShopCountries: async () => ({ rows: [{ code: 'US', name: 'United States' }], live: true }),
  fetchShopCatalogue: async () => ({
    rows: [{
      id: 'brand-1',
      family: 'Steam',
      name: 'Steam',
      logo: null,
      bg: '#1b2838',
      category: 'games',
      tags: [],
      kind: 'giftcard',
      outOfStock: false,
      country: 'US'
    }],
    categories: [{ id: 'games', count: 1 }],
    live: true
  }),
  fetchShopProducts: async () => productsPayload,
  getShopCountry: () => 'US',
  setShopCountry: () => {}
}));

vi.mock('framer-motion', () => {
  const components = new Map();
  return {
    motion: new Proxy({}, {
      get: (_, tag) => {
        if (!components.has(tag)) {
          components.set(tag, ({ children, ...props }) => {
            const Tag = String(tag);
            const clean = Object.fromEntries(Object.entries(props).filter(([key]) => ![
              'initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover',
              'layout', 'layoutId', 'variants', 'custom'
            ].includes(key)));
            return <Tag {...clean}>{children}</Tag>;
          });
        }
        return components.get(tag);
      }
    }),
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => true
  };
});

import Shop from '../src/pages/Shop.jsx';

/**
 * Open the shop, tap the brand, and expand the "how to redeem" box.
 *
 * The box is an InfoBox and those are COLLAPSED by default — the whole design
 * of them is that the title is the part people read — so its body is not in
 * the DOM until it is opened. A test that forgot this would assert against an
 * empty string and pass for the wrong reason.
 */
async function openSheet() {
  const view = render(
    <MemoryRouter initialEntries={['/shop?c=US']}>
      <Shop />
    </MemoryRouter>
  );
  const tile = await screen.findByText('Steam');
  fireEvent.click(tile.closest('button'));

  const head = await screen.findByText(t('shop.howTo'));
  const box = head.closest('.infobox');
  fireEvent.click(head.closest('.infobox-head'));
  await waitFor(() => expect(box.querySelector('.infobox-body')).toBeTruthy());
  return { view, box };
}

const pageText = () => document.body.textContent;

beforeEach(() => {
  language = 'fa';
  localStorage.clear();
  localStorage.setItem('fbt.shop.country', 'US');
  productsPayload = {
    rows: [{ id: 'p1', label: '$50', coinAmount: 53.86, coin: 'USDC', spreadPct: 7.7 }],
    bestSpreadPct: 7.7,
    brand: 'Steam',
    note: PROVIDER.en.note,
    howTo: PROVIDER.en.howTo,
    contentLocale: 'en',
    live: true
  };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('shop sheet — the language of the how-it-works text', () => {
  it('gives a Persian shopper Persian steps and keeps the provider’s own words', async () => {
    const { box } = await openSheet();
    const howToBoxText = () => box.textContent;

    /* Our walk-through, in Persian, above the fold of the box. */
    expect(document.querySelector('.shop-steps')).toBeTruthy();
    expect(howToBoxText()).toContain(fa.shop.redeemSteps.s1.replace('{{brand}}', '').slice(0, 24));
    expect(howToBoxText()).toContain('Steam');           // {{brand}} interpolated
    expect(howToBoxText()).toContain('United States');   // {{country}} interpolated

    /* Their English is still there, and it says which language it is in. */
    expect(howToBoxText()).toContain(PROVIDER.en.howTo);
    expect(howToBoxText()).toContain('English');

    /* And the region-lock warning survives the fallback, labelled the same way. */
    expect(pageText()).toContain(PROVIDER.en.note);
    expect(pageText()).toContain(fa.shop.providerNote);
    /* The English prose is set LTR so bidi cannot reorder its punctuation. */
    const note = [...document.querySelectorAll('p.notice')].find((p) => p.textContent === PROVIDER.en.note);
    expect(note.getAttribute('dir')).toBe('ltr');
  });

  it('shows the provider’s text as-is when it really is in the shopper’s language', async () => {
    productsPayload = {
      ...productsPayload,
      note: PROVIDER.fa.note,
      howTo: PROVIDER.fa.howTo,
      contentLocale: 'fa'
    };
    const { box } = await openSheet();
    const howToBoxText = () => box.textContent;

    expect(howToBoxText()).toContain(PROVIDER.fa.howTo);
    /* No second copy of the same instructions, and no label for a language
       mismatch that does not exist. */
    expect(document.querySelector('.shop-steps')).toBe(null);
    expect(pageText()).not.toContain(fa.shop.providerNote);
    expect(pageText()).toContain(PROVIDER.fa.note);
  });

  it('does not print the English step list twice for an English shopper', async () => {
    language = 'en';
    const { box } = await openSheet();
    const howToBoxText = () => box.textContent;

    expect(howToBoxText()).toContain(PROVIDER.en.howTo);
    expect(document.querySelector('.shop-steps')).toBe(null);
    expect(pageText()).not.toContain(en.shop.providerNote);
  });

  it('still walks a Persian shopper through the flow when the provider has no steps at all', async () => {
    productsPayload = { ...productsPayload, howTo: null };
    await openSheet();

    /* The box is driven by OUR steps, not by their prose: the flow is the same
       whoever wrote it down, and the warning below is untouched. */
    expect(document.querySelector('.shop-steps')).toBeTruthy();
    expect(pageText()).toContain(PROVIDER.en.note);
  });

  it('ignores a provider note that arrives with no way to know its language', async () => {
    productsPayload = { ...productsPayload, contentLocale: null };
    const { box } = await openSheet();
    const howToBoxText = () => box.textContent;

    /* Unknown must not be treated as a match: that is exactly how English got
       printed under a Persian heading. Steps in the shopper's language, their
       text kept and labelled. */
    expect(document.querySelector('.shop-steps')).toBeTruthy();
    expect(howToBoxText()).toContain(PROVIDER.en.howTo);
    expect(pageText()).toContain(PROVIDER.en.note);
  });
});
