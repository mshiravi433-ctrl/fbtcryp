/**
 * SHOP HUB — pure-logic unit tests (node environment, no DOM).
 * ---------------------------------------------------------------------------
 * `shopHub.js` is the half of Phase 2/3 that decides what is TRUE while the
 * JSX decides what to paint. Every rule below is the copy the UI renders —
 * a wrong answer here is a wrong sentence on a thousand screens, so the
 * boundaries get hit precisely, including the “must stay silent” ones:
 * a cold trending table must return the OLD rail by identity, a storage that
 * throws must not take the click down with it, and the .eth ladder must
 * refuse 1–2 character labels instead of pricing reserved names.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ENS_APP_URL,
  GIFT_THEMES,
  SHOP_RECENT_KEY,
  SNS_APP_URL,
  buildGiftSharePath,
  ensYearlyUsd,
  getRecentViews,
  giftThemeFor,
  normalizeIdLabel,
  orderRowsByTrending,
  parseGiftArrival,
  pushRecentView,
  recallGiftTheme,
  rememberGiftTheme,
  resolveRecentViews,
  solLabelOk,
  trendingHasHeat
} from '../src/lib/shopHub.js';

const memStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
};

describe('gift themes and the in-app gift link', () => {
  it('paints exactly the four published themes, gold first-class as the default', () => {
    expect(GIFT_THEMES.map((g) => g.id)).toEqual(['birthday', 'gaming', 'congrats', 'gold']);
    expect(giftThemeFor('GAMING ')).toBe('gaming');
    expect(giftThemeFor('../../etc/passwd')).toBe('gold');
    expect(giftThemeFor(undefined)).toBe('gold');
  });

  it('remembers only ids it will render, and survives storage that throws', () => {
    const s = memStorage();
    expect(rememberGiftTheme('congrats', s)).toBe('congrats');
    expect(s.map.get('fbt.shop.gift.theme.v1')).toBe('congrats');
    expect(rememberGiftTheme('🥳', s)).toBe('gold');
    expect(recallGiftTheme(s)).toBe('gold');
    expect(recallGiftTheme(memStorage())).toBe('gold'); /* empty storage → default */

    const hostile = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('Quota'); } };
    expect(recallGiftTheme(hostile)).toBe('gold');
    expect(() => rememberGiftTheme('gold', hostile)).not.toThrow();
  });

  it('builds only links the app itself can open — junk inputs yield the empty string', () => {
    expect(buildGiftSharePath('us', 'Steam', 'birthday')).toBe('/shop?c=US&b=steam&gift=1&gt=birthday');
    expect(buildGiftSharePath('US', 'Google Play', 'gold')).toBe('/shop?c=US&b=google_play&gift=1&gt=gold');
    expect(buildGiftSharePath('USA', 'Steam', 'gold')).toBe('');
    expect(buildGiftSharePath('US', '   ', 'gold')).toBe('');
    expect(buildGiftSharePath('', '', '')).toBe('');
  });

  it('reads an arrival ONLY when gift=1 — a plain share gets no banner', () => {
    const make = (o) => (k) => o[k] ?? null;
    expect(parseGiftArrival(make({ gift: '1', gt: 'birthday' }))).toEqual({ theme: 'birthday' });
    expect(parseGiftArrival(make({ gift: '1' }))).toEqual({ theme: 'gold' });
    expect(parseGiftArrival(make({ gift: '0', gt: 'birthday' }))).toBeNull();
    expect(parseGiftArrival(make({}))).toBeNull();
    expect(parseGiftArrival(null)).toBeNull();
    /* a getter that THROWS (no URLSearchParams, exotic router) still must not surface */
    expect(parseGiftArrival(() => { throw new Error('boom'); })).toBeNull();
  });
});

describe('recently viewed — this device only, live rows only', () => {
  it('unshifts, de-dupes by id, and caps at ten', () => {
    const s = memStorage();
    let list = [];
    for (let i = 1; i <= 14; i += 1) {
      list = pushRecentView({ id: `b-${i}`, family: `F${i}`, name: `Name ${i}` }, s);
    }
    expect(list.length).toBe(10);
    expect(list[0].id).toBe('b-14');
    expect(getRecentViews(s).map((r) => r.id)).toEqual(list.map((r) => r.id));

    list = pushRecentView({ id: 'b-12', family: 'F12', name: 'Name 12' }, s);
    expect(list[0].id).toBe('b-12');
    expect(list.filter((r) => r.id === 'b-12').length).toBe(1);
  });

  it('stores snapshots, never prices, and nothing identifying', () => {
    const s = memStorage();
    pushRecentView({ id: 'b-steam', family: 'Steam', name: 'Steam', price: '$25', wallet: '0xabc' }, s);
    const raw = JSON.parse(s.map.get(SHOP_RECENT_KEY))[0];
    expect(Object.keys(raw).sort()).toEqual(['at', 'family', 'id', 'name']);
  });

  it('drops a corrupt entry instead of dropping the rail; survives throwing storage', () => {
    const s = memStorage();
    s.map.set(SHOP_RECENT_KEY, '{not json');
    expect(getRecentViews(s)).toEqual([]);
    s.map.set(SHOP_RECENT_KEY, JSON.stringify([{ id: 'ok', family: 'F' }, null, { name: 'no id' }, { id: 'x' }]));
    expect(getRecentViews(s).map((r) => r.id)).toEqual(['ok']);

    const hostile = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error(); } };
    expect(getRecentViews(hostile)).toEqual([]);
    expect(() => pushRecentView({ id: 'a', family: 'A' }, hostile)).not.toThrow();
  });

  it('resolves against the LIVE catalogue — out-of-stock and other-country rows vanish, storage is kept', () => {
    const s = memStorage();
    pushRecentView({ id: 'a', family: 'A', name: 'A' }, s);
    pushRecentView({ id: 'b', family: 'B', name: 'B' }, s);
    pushRecentView({ id: 'c', family: 'C', name: 'C' }, s);
    const rows = [
      { id: 'a', name: 'A', outOfStock: false },
      { id: 'b', name: 'B', outOfStock: true }
    ];
    const out = resolveRecentViews(getRecentViews(s), rows);
    expect(out.map((r) => r.id)).toEqual(['a']);
    /* storage untouched — switching country may bring B back legitimately */
    expect(getRecentViews(s).length).toBe(3);
    expect(resolveRecentViews([], rows)).toEqual([]);
    expect(resolveRecentViews(getRecentViews(s), null)).toEqual([]);
  });
});

describe('regional heat — a re-rank, never a rewrite', () => {
  const rows = [
    { id: '1', name: 'One' },
    { id: '2', name: 'Two' },
    { id: '3', name: 'Three' },
    { id: '4', name: 'Four', outOfStock: true }
  ];

  it('a cold table returns THE SAME ARRAY — identity, not a copy in old order', () => {
    expect(orderRowsByTrending(rows, [])).toBe(rows);
    expect(orderRowsByTrending(rows, null)).toBe(rows);
    expect(orderRowsByTrending([], [{ id: '1', score: 5 }])).toEqual([]);
  });

  it('an all-zero answer does not alphabetise the formerly static rail', () => {
    const editorial = [
      { id: 'z-editorial', name: 'Zulu' },
      { id: 'a-editorial', name: 'Alpha' },
      { id: 'm-editorial', name: 'Middle' }
    ];
    expect(orderRowsByTrending(editorial, [
      { id: 'a-editorial', score: 0, views: 0 },
      { id: 'z-editorial', score: 0, views: 0 },
      { id: 'm-editorial', score: 0, views: 0 }
    ])).toBe(editorial);
  });

  it('ranked ids float up by score; unranked keep their relative order behind them', () => {
    const out = orderRowsByTrending(rows, [
      { id: '3', score: 4.1 },
      { id: '1', score: 9.9 }
    ]);
    expect(out.map((r) => r.id)).toEqual(['1', '3', '2', '4']);
    expect(out[0]).toBe(rows[0]); /* the row OBJECT is reused, never cloned-and-drifted */
  });

  it('an out-of-stock row is never promoted by a hot score', () => {
    const out = orderRowsByTrending(rows, [{ id: '4', score: 99 }]);
    expect(out[0].id).not.toBe('4');
    expect(out.map((r) => r.id)).toEqual(['1', '2', '3', '4']);
  });

  it('honours the rail cap (12) and the limit option', () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, name: `R${i}` }));
    expect(orderRowsByTrending(big, [{ id: 'r19', score: 5 }], { limit: 12 }).length).toBe(12);
  });

  it('hasHeat is earned by VIEWS, not by a scored-but-seen-zero row', () => {
    expect(trendingHasHeat([])).toBe(false);
    expect(trendingHasHeat(null)).toBe(false);
    expect(trendingHasHeat([{ id: 'x', views: 0, score: 2.1 }])).toBe(false);
    expect(trendingHasHeat([{ id: 'x', views: 0 }, { id: 'y', views: 1 }])).toBe(true);
  });
});

describe('web3 identity — the check that never lies', () => {
  it('normalises the label, then answers with a REASON per rule', () => {
    expect(normalizeIdLabel('  My-Name.ETH ')).toEqual({ ok: true, reason: '', label: 'my-name' });
    expect(normalizeIdLabel('abc.sol').label).toBe('abc');
    expect(normalizeIdLabel('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(normalizeIdLabel('ab-cd--ef')).toMatchObject({ ok: false, reason: 'hyphen' });
    expect(normalizeIdLabel('-lead')).toMatchObject({ ok: false, reason: 'hyphen' });
    expect(normalizeIdLabel('tail-')).toMatchObject({ ok: false, reason: 'hyphen' });
    expect(normalizeIdLabel('under_score')).toMatchObject({ ok: false, reason: 'chars' });
    /* spaces are REMOVED, not rejected — the input strips them too, so a pasted
       «my name» normalises to the registrable label instead of an error */
    expect(normalizeIdLabel('sp ace')).toMatchObject({ ok: true, label: 'space' });
    expect(normalizeIdLabel('اسم من')).toMatchObject({ ok: false, reason: 'non_ascii' });
    expect(normalizeIdLabel('naïve')).toMatchObject({ ok: false, reason: 'non_ascii' });
    expect(normalizeIdLabel('emoji😀')).toMatchObject({ ok: false, reason: 'non_ascii' });
    expect(normalizeIdLabel(12345)).toMatchObject({ ok: true, label: '12345' });
    expect(normalizeIdLabel(null).reason).toBe('empty');
  });

  it('prices .eth by the published ladder and refuses reserved lengths', () => {
    expect(ensYearlyUsd('ab')).toEqual({ ok: false, reason: 'too_short', usd: null });
    expect(ensYearlyUsd('a')).toMatchObject({ ok: false, reason: 'too_short' });
    expect(ensYearlyUsd('abc')).toMatchObject({ ok: true, usd: 640 });
    expect(ensYearlyUsd('abcd')).toMatchObject({ ok: true, usd: 160 });
    expect(ensYearlyUsd('abcde')).toMatchObject({ ok: true, usd: 5 });
    expect(ensYearlyUsd('a'.repeat(40))).toMatchObject({ ok: true, usd: 5 });
    expect(ensYearlyUsd('')).toMatchObject({ ok: false, reason: 'too_short' });
  });

  it('sizes .sol labels 1–32 and NOTHING else — no invented price ladder', () => {
    expect(solLabelOk('')).toBe(false);
    expect(solLabelOk('a')).toBe(true);
    expect(solLabelOk('x'.repeat(32))).toBe(true);
    expect(solLabelOk('x'.repeat(33))).toBe(false);
  });

  it('points at the two registries and nowhere else', () => {
    expect(ENS_APP_URL).toBe('https://app.ens.domains/');
    expect(SNS_APP_URL).toBe('https://sns.id/');
  });
});
