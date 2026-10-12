// @vitest-environment jsdom
/*
 * THE TOKENIZED-STOCK CARD — three price states, and none of them a lie.
 *
 * Asked for as «تب سهام توکنیزه ۲۰۰ توکن جدید، بدون قیمت خورده … باکس‌هایش را با
 * قیمت و مدرن‌تر کن». The board listed ~200 real contracts and most of them had
 * no price at all, because the only quote it had was the company's SHARE price
 * matched by TICKER against a ~40-name feed.
 *
 * The card is where the three answers to that live, so this suite pins each one
 * by what is actually painted:
 *
 *   1. a MARKET price (read by contract, lib/stockPrices.js) — printed plain,
 *      because it is the token's own price;
 *   2. a SHARE REFERENCE (the fallback) — printed with the «مرجع» tag, plus
 *      «بازار بسته» when the share market is shut. A stale share quote with no
 *      label is how a screen lies without a false sentence on it;
 *   3. NOTHING — «—» after the read finished, and a skeleton while it is still
 *      in flight. A dash during loading would claim the token has no market.
 *
 * Plus the two things the redesign must not have lost: the contract address is
 * on the tile (the address is the identity, the ticker is not), and both the
 * tile and its Buy button reach the swap screen.
 *
 * Run with:  npx vitest run test/stock-token-card.test.jsx
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import fa from '../src/i18n/locales/fa.json';

/* Real Persian strings, no i18next runtime: a raw key must fail these. */
const t = (key, values = {}) => {
  const found = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), fa);
  let text = typeof found === 'string' ? found : undefined;
  if (text == null && typeof values === 'string') text = values;
  if (text == null) text = key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) =>
    (values && typeof values === 'object' ? (values[k] ?? '') : ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'fa', resolvedLanguage: 'fa' } })
}));
vi.mock('../src/lib/tokenIcon', () => ({ default: ({ token }) => <i data-icon={token?.symbol} /> }));

import StockTokenCard from '../src/components/StockTokenCard.jsx';

const TOKEN = {
  id: 'rh-nvda-d0601c',
  symbol: 'NVDA',
  name: 'NVIDIA',
  address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
  chainId: 4663,
  chainName: 'Robinhood Chain',
  equity: true
};

const card = (props) => render(<StockTokenCard token={TOKEN} onBuy={() => {}} {...props} />);
const box = () => document.querySelector('.stk-card');

afterEach(() => cleanup());

describe('the tokenized-stock card', () => {
  it('prints the token\'s own market price, with its 24h move and no tag', () => {
    card({ market: { price: 187.43, change24h: 1.8 } });
    expect(box().textContent).toContain('$187.43');
    expect(box().textContent).toContain('+1.8%');
    /* A market price is not a reference: the tag must be absent. */
    expect(box().textContent).not.toContain(fa.stocks.rhRefTag);
    /* Direction is on the card as a class, which is what colours the stripe. */
    expect(box().className).toContain('is-up');
    /* And the contract is on the tile — the address is the identity. */
    expect(box().textContent).toContain('0xd060…9EEC');
  });

  it('marks a share reference as a reference, and says when its market is shut', () => {
    card({ reference: { price: 187.43, change24h: -0.4, marketOpen: false } });
    expect(box().textContent).toContain('$187.43');
    expect(box().textContent).toContain(fa.stocks.rhRefTag);
    expect(box().textContent).toContain(fa.stocks.ref.closed);
    expect(box().className).toContain('is-down');
  });

  it('omits the closed-market tag while the share market is open', () => {
    card({ reference: { price: 12, change24h: 0, marketOpen: true } });
    expect(box().textContent).toContain(fa.stocks.rhRefTag);
    expect(box().textContent).not.toContain(fa.stocks.ref.closed);
  });

  it('shows a skeleton while prices are in flight and a dash only when they are not', () => {
    const { unmount } = card({ loading: true });
    expect(document.querySelector('.stk-skel')).toBeTruthy();
    expect(box().textContent).not.toContain('—');
    unmount();

    card({ loading: false });
    expect(document.querySelector('.stk-skel')).toBeNull();
    expect(box().textContent).toContain('—');
    expect(box().className).toContain('is-flat');
  });

  it('a zero price is not a price', () => {
    /* The page never builds this state (lib/stockPrices.js refuses 0/NaN), so
       the card is checked against a caller that does: it must fall back to the
       reference rather than print $0.00 as a collapsed company. */
    card({ market: null, reference: { price: 0 } });
    expect(box().textContent).not.toContain('$0');
  });

  it('opens the swap from the tile and from its Buy button, once each', () => {
    const onBuy = vi.fn();
    card({ market: { price: 187.43, change24h: 1.8 }, onBuy });
    fireEvent.click(box().querySelector('.stk-buy'));
    expect(onBuy).toHaveBeenCalledTimes(1);
    expect(onBuy).toHaveBeenCalledWith(TOKEN);
    fireEvent.click(box());
    expect(onBuy).toHaveBeenCalledTimes(2);
  });

  it('the board no longer advertises a third-party token list', () => {
    /*
     * «جملهٔ فهرست رسمی توکن‌های یونی‌سواپ را پاک کن، این بک‌جور تبلیغ می‌شود».
     * Pinned as source text on purpose: the complaint was about a pill that
     * named somebody else's list on our own screen, and a locale key that is
     * still there is one re-render away from coming back.
     */
    const files = ['fa', 'en', 'ar'];
    for (const lang of files) {
      const locale = require(`../src/i18n/locales/${lang}.json`);
      expect(JSON.stringify(locale.stocks.rhTitle)).not.toMatch(/uniswap|یونی‌سواپ|يونيسواب/i);
      expect(locale.stocks.rhSource).toBeUndefined();
      expect(locale.stocks.rhRefPrice).toBeUndefined();
      for (const [key, value] of Object.entries(locale.stocks)) {
        if (typeof value !== 'string') continue;
        expect(`${key}:${value}`).not.toMatch(/uniswap|یونی‌سواپ|يونيسواب/i);
      }
    }
  });
});
