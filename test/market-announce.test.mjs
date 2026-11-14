import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countPhrase,
  viewPhrase,
  orderPhrase,
  marketAnnouncement,
  joinMarketAnnouncement
} from '../src/lib/marketAnnounce.js';

// The sentence a screen reader speaks about the market table. Every assertion
// here is "the sentence and the list must not disagree": the failures that
// matter are silent on screen and loud in a screen reader.

const LANGS = ['fa', 'en', 'ar', 'ur', 'es', 'fr', 'tr', 'ru', 'zh', 'hi', 'pt', 'id'];

test('countPhrase: showing fewer rows than the view holds says both numbers', () => {
  assert.deepEqual(countPhrase(60, 250), { key: 'market.liveCountOf', values: { shown: 60, total: 250 } });
});

test('countPhrase: showing everything drops the redundant "of total"', () => {
  assert.deepEqual(countPhrase(60, 60), { key: 'market.liveCount', values: { count: 60 } });
  // More shown than held (a folded row cap off by one) must not read as "62 of 60".
  assert.deepEqual(countPhrase(62, 60), { key: 'market.liveCount', values: { count: 62 } });
});

test('countPhrase: an empty result is its own sentence, not "0 of 0"', () => {
  assert.deepEqual(countPhrase(0, 0), { key: 'market.liveNone', values: {} });
  assert.deepEqual(countPhrase(0, 250), { key: 'market.liveNone', values: {} });
});

test('countPhrase: a broken number is not announced as a number', () => {
  assert.equal(countPhrase(NaN, 250).key, 'market.liveNone');
  assert.deepEqual(countPhrase(-5, 250), { key: 'market.liveNone', values: {} });
  // A missing total falls back to the shown count rather than to zero.
  assert.deepEqual(countPhrase(60, null), { key: 'market.liveCount', values: { count: 60 } });
  // Fractional input is truncated, never rounded up into a row that is not there.
  assert.deepEqual(countPhrase(59.7, 250), { key: 'market.liveCountOf', values: { shown: 59, total: 250 } });
});

test('viewPhrase: a sector replaces the universe, so it wins over the ordering', () => {
  // Sorted by volume inside a sector is still the sector, not «by volume».
  assert.equal(viewPhrase({ sector: 'defi', sortKey: 'volume', sortDir: 'desc' }).key, 'market.liveViewSector');
  assert.deepEqual(viewPhrase({ sector: 'defi' }).values, { sector: 'defi' });
});

test('viewPhrase: favourites are a user subset and outrank the ordering too', () => {
  assert.equal(viewPhrase({ onlyFavorites: true, sortKey: 'change', sortDir: 'desc' }).key, 'market.liveViewFavorites');
  // …but a sector wins over favourites, matching the page's own precedence:
  // `universe` is replaced by the sector before the favourites filter runs.
  assert.equal(viewPhrase({ sector: 'defi', onlyFavorites: true }).key, 'market.liveViewSector');
});

test('viewPhrase: only the four named orderings get a name', () => {
  assert.equal(viewPhrase({ sortKey: 'change', sortDir: 'desc' }).key, 'market.liveViewGainers');
  assert.equal(viewPhrase({ sortKey: 'change', sortDir: 'asc' }).key, 'market.liveViewLosers');
  assert.equal(viewPhrase({ sortKey: 'volume', sortDir: 'desc' }).key, 'market.liveViewVolume');
  // Volume ascending is not «by volume» — that chip does not exist, and saying
  // it does would describe a view the reader cannot reach from the chips.
  assert.equal(viewPhrase({ sortKey: 'volume', sortDir: 'asc' }).key, 'market.liveViewAll');
  // The unnamed keys are all "all coins, in a different order".
  for (const key of ['mcap', 'price', 'change1h', 'change7d', 'rank']) {
    assert.equal(viewPhrase({ sortKey: key }).key, 'market.liveViewAll', key);
  }
});

test('orderPhrase: names the column by KEY so the translator owns the word', () => {
  assert.deepEqual(orderPhrase({ sortKey: 'price', sortDir: 'desc' }), {
    key: 'market.liveOrderDesc',
    values: { column: 'market.sort.price' }
  });
  assert.equal(orderPhrase({ sortKey: 'volume', sortDir: 'asc' }).key, 'market.liveOrderAsc');
  // Defaults are the screen's default, not "undefined".
  assert.deepEqual(orderPhrase(), { key: 'market.liveOrderAsc', values: { column: 'market.sort.rank' } });
});

test('marketAnnouncement: three parts, always in the same reading order', () => {
  const parts = marketAnnouncement({ shown: 60, total: 250, sortKey: 'price', sortDir: 'desc' });
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => p.key), ['market.liveCountOf', 'market.liveViewAll', 'market.liveOrderDesc']);
});

test('marketAnnouncement: never returns undefined keys for partial state', () => {
  for (const input of [{}, null, undefined, { shown: 0 }, { sector: 'x' }]) {
    for (const part of marketAnnouncement(input ?? {})) {
      assert.equal(typeof part.key, 'string');
      assert.ok(part.key.startsWith('market.'), part.key);
    }
  }
});

test('joinMarketAnnouncement: glues translated parts, skipping empties', () => {
  const translate = (key, values) => `${key}${values && Object.keys(values).length ? ':' + JSON.stringify(values) : ''}`;
  const joined = joinMarketAnnouncement(marketAnnouncement({ shown: 10, total: 20 }), translate);
  assert.equal(joined.split(' · ').length, 3);
  assert.ok(joined.startsWith('market.liveCountOf:{"shown":10,"total":20}'));
});

test('joinMarketAnnouncement: a translator that returns an empty string contributes nothing', () => {
  // i18next returns the key when a translation is missing, and an empty string
  // when it has been deliberately blanked — neither should leave a stray " · ".
  const joined = joinMarketAnnouncement(
    [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
    (key) => (key === 'b' ? '   ' : key)
  );
  assert.equal(joined, 'a · c');
});

test('joinMarketAnnouncement: tolerates junk instead of throwing', () => {
  assert.equal(joinMarketAnnouncement(null, (k) => k), '');
  assert.equal(joinMarketAnnouncement([], (k) => k), '');
  assert.equal(joinMarketAnnouncement([{ key: 'a' }], null), '');
});

test('every key these functions can return exists in all 12 locales', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const keys = new Set();
  for (const shown of [0, 60]) {
    for (const total of [0, 60, 250]) {
      for (const sector of [null, 'defi']) {
        for (const onlyFavorites of [false, true]) {
          for (const sortKey of ['rank', 'mcap', 'change', 'change1h', 'change7d', 'volume', 'price']) {
            for (const sortDir of ['asc', 'desc']) {
              const parts = marketAnnouncement({ shown, total, sector, onlyFavorites, sortKey, sortDir });
              for (const part of parts) {
                keys.add(part.key);
                // The order phrase embeds a column key; it must exist too.
                for (const value of Object.values(part.values ?? {})) {
                  if (typeof value === 'string' && value.startsWith('market.sort.')) keys.add(value);
                }
              }
            }
          }
        }
      }
    }
  }

  assert.ok(keys.size >= 12, `expected a populated key set, saw ${keys.size}`);

  for (const lang of LANGS) {
    const data = JSON.parse(await fs.readFile(path.resolve(`src/i18n/locales/${lang}.json`), 'utf8'));
    for (const key of keys) {
      const leaf = key.split('.').reduce((row, part) => (row ? row[part] : undefined), data);
      assert.equal(typeof leaf, 'string', `${lang}.json is missing ${key}`);
      assert.ok(leaf.trim().length > 0, `${lang}.json has a blank ${key}`);
    }
  }
});
