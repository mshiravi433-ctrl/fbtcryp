import test from 'node:test';
import assert from 'node:assert/strict';

import {
  drawdownFromAth,
  riseFromAtl,
  dayPosition,
  turnoverRatio,
  marketShare,
  supplyStructure,
  marketAmplification,
  marketAgreement,
  versusBitcoin,
  tokenIdentity,
} from '../src/lib/tokenIdentity.js';

// The contract under test is a decision, not a pixel: when a number cannot be
// computed the module returns null and says what was missing. It must never
// return 0, because 0 is a claim ("down 100% from its high") and a missing
// field is not a claim at all.
//
// Units are part of the contract and are pinned here:
//   percentages (drawdown, rise, share, versusBtc) are 0..100
//   ratios (dayPosition, turnover, unlocked, amplification) are 0..1 / plain

const LANGS = ['fa', 'en', 'ar', 'ur', 'es', 'fr', 'tr', 'ru', 'zh', 'hi', 'pt', 'id'];
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('drawdownFromAth: a missing high is null, not zero', () => {
  assert.equal(drawdownFromAth({ price: 50 }), null);
  assert.equal(drawdownFromAth({}), null);
  assert.equal(drawdownFromAth(null), null);
  assert.equal(drawdownFromAth(undefined), null);
});

test('drawdownFromAth: sitting at the high is not a measurement', () => {
  // "0% below its high" is a real sentence but an unusable card.
  assert.equal(drawdownFromAth({ price: 100, ath: 100 }), null);
  assert.equal(drawdownFromAth({ price: 101, ath: 100 }), null);
});

test('drawdownFromAth: a real drawdown is a positive percentage', () => {
  assert.equal(drawdownFromAth({ price: 50, ath: 100 }), 50);
  assert.equal(drawdownFromAth({ price: 25, ath: 100 }), 75);
  assert.ok(near(drawdownFromAth({ price: 3, ath: 8 }), 62.5));
});

test('drawdownFromAth: prefers the upstream signed figure over recomputing', () => {
  // The upstream percentage is computed against its own unrounded price, so it
  // wins even when a rounded price/ath pair would give a slightly differ
  // answer — and it works when `ath` is missing entirely.
  assert.equal(drawdownFromAth({ price: 50, ath: 100, athChange: -73.2 }), 73.2);
  assert.equal(drawdownFromAth({ athChange: -40 }), 40);
  // A positive athChange (price above the old high) is not a drawdown.
  assert.equal(drawdownFromAth({ athChange: 12 }), null);
  assert.equal(drawdownFromAth({ price: 10, athChange: 0 }), null);
});

test('drawdownFromAth: a zero or bogus high cannot divide', () => {
  assert.equal(drawdownFromAth({ price: 10, ath: 0 }), null);
  assert.equal(drawdownFromAth({ price: 10, ath: null }), null);
  assert.equal(drawdownFromAth({ price: 10, ath: -5 }), null);
});

test('riseFromAtl: the floor behaves like the ceiling', () => {
  assert.equal(riseFromAtl({ price: 10 }), null);
  assert.equal(riseFromAtl({ price: 10, atl: 10 }), null);
  assert.equal(riseFromAtl({ price: 10, atl: 20 }), null);
  assert.equal(riseFromAtl({ price: 10, atl: 0 }), null);
  assert.equal(riseFromAtl({ price: 200, atl: 100 }), 100);
  assert.ok(near(riseFromAtl({ price: 15, atl: 10 }), 50));
});

test('riseFromAtl: prefers the upstream signed figure', () => {
  assert.equal(riseFromAtl({ atlChange: 412.5 }), 412.5);
  assert.equal(riseFromAtl({ price: 200, atl: 100, atlChange: 900 }), 900);
  // A negative atlChange (price under the recorded low) is not a rise.
  assert.equal(riseFromAtl({ atlChange: -5 }), null);
});

test('dayPosition: needs both ends of the range', () => {
  assert.equal(dayPosition({ price: 5 }), null);
  assert.equal(dayPosition({ price: 5, low24h: 4 }), null);
  assert.equal(dayPosition({ price: 5, high24h: 6 }), null);
  assert.equal(dayPosition({}), null);
});

test('dayPosition: a flat or inverted day has no position', () => {
  assert.equal(dayPosition({ price: 5, low24h: 5, high24h: 5 }), null);
  assert.equal(dayPosition({ price: 5, low24h: 6, high24h: 4 }), null);
});

test('dayPosition: a 0..1 fraction of where price sits in the day', () => {
  assert.equal(dayPosition({ price: 5, low24h: 4, high24h: 6 }), 0.5);
  assert.equal(dayPosition({ price: 6, low24h: 4, high24h: 6 }), 1);
  assert.equal(dayPosition({ price: 4, low24h: 4, high24h: 6 }), 0);
  // Out-of-range prices clamp rather than draw a marker off its rail.
  assert.equal(dayPosition({ price: 9, low24h: 4, high24h: 6 }), 1);
  assert.equal(dayPosition({ price: 1, low24h: 4, high24h: 6 }), 0);
});

test('turnoverRatio: volume over cap, null without a cap', () => {
  assert.equal(turnoverRatio({ volume: 1e6, mcap: 1e7 }), 0.1);
  assert.equal(turnoverRatio({ volume: 1e6 }), null);
  assert.equal(turnoverRatio({ volume: 1e6, mcap: 0 }), null);
  assert.equal(turnoverRatio({}), null);
});

test('turnoverRatio: a quiet market is a small ratio, not an empty one', () => {
  // 1% of the cap trades a day. Cheap feeds send 0 here; that is a real
  // measurement and must survive as 0, not become null.
  assert.equal(turnoverRatio({ volume: 0.01, mcap: 1 }), 0.01);
});

test('marketShare: our cap as a percentage of the whole market', () => {
  assert.equal(marketShare({ mcap: 50 }, { mcap: 1000 }), 5);
  assert.equal(marketShare({ mcap: 50 }, { mcap: null }), null);
  assert.equal(marketShare({ mcap: 50 }, null), null);
  assert.equal(marketShare({}, { mcap: 1000 }), null);
});

test('marketShare: a share above the total market is a feed inconsistency, not a share', () => {
  assert.equal(marketShare({ mcap: 2000 }, { mcap: 1000 }), null);
});

test('marketShare: a 100% share is allowed, a 0% share is not invented', () => {
  assert.equal(marketShare({ mcap: 1000 }, { mcap: 1000 }), 100);
  assert.equal(marketShare({ mcap: 0 }, { mcap: 1000 }), null);
});

test('supplyStructure: capped token reports the share already unlocked', () => {
  const s = supplyStructure({ supply: 19e6, maxSupply: 21e6 });
  assert.equal(s.capped, true);
  assert.ok(near(s.unlocked, 19 / 21));
});

test('supplyStructure: an explicit null maximum means uncapped', () => {
  // CoinGecko sends `max_supply: null` for ETH/SOL/DOGE. That is the feed
  // saying there is no ceiling — a fact, not silence.
  const s = supplyStructure({ supply: 120e6, maxSupply: null });
  assert.equal(s.capped, false);
  assert.equal(s.unlocked, null);
});

test('supplyStructure: a missing maxSupply KEY means unknown, not uncapped', () => {
  // Our own backend and the CoinLore backup omit the key entirely. Reporting
  // `capped: false` here would claim "no ceiling" from a payload that never
  // mentioned a ceiling.
  const s = supplyStructure({ supply: 120e6 });
  assert.equal(s.capped, null);
  assert.equal(s.unlocked, null);
});

test('supplyStructure: no supply at all is unknown too', () => {
  const s = supplyStructure({});
  assert.equal(s.circulating, null);
  assert.equal(s.max, null);
  assert.equal(s.capped, null);
  assert.equal(s.unlocked, null);
});

test('supplyStructure: supply above the stated ceiling is not shown as over-unlocked', () => {
  const s = supplyStructure({ supply: 30e6, maxSupply: 21e6 });
  assert.equal(s.capped, true);
  assert.equal(s.unlocked, null);
});

test('supplyStructure: rounding a hair over 100% still reads as fully unlocked', () => {
  const s = supplyStructure({ supply: 21e6 * 1.0000001, maxSupply: 21e6 });
  assert.equal(s.capped, true);
  assert.equal(s.unlocked, 1);
});

test('marketAmplification: refuses to divide by a near-zero market move', () => {
  // If the market did not move, "this token moved 30x more than the market"
  // describes the denominator, not the token.
  assert.equal(marketAmplification({ change24h: 5 }, { avgChange: 0 }), null);
  assert.equal(marketAmplification({ change24h: 5 }, { avgChange: 0.1 }), null);
  assert.equal(marketAmplification({ change24h: 5 }, { avgChange: -0.2 }), null);
  assert.equal(marketAmplification({ change24h: 5 }, null), null);
  assert.equal(marketAmplification({}, { avgChange: 2 }), null);
});

test('marketAmplification: the ratio of this window, not a regression beta', () => {
  assert.equal(marketAmplification({ change24h: 4 }, { avgChange: 2 }), 2);
  assert.ok(near(marketAmplification({ change24h: -6 }, { avgChange: 2 }), -3));
  assert.ok(near(marketAmplification({ change24h: 1 }, { avgChange: 4 }), 0.25));
});

test('marketAgreement: with / against / flat / unknown', () => {
  assert.equal(marketAgreement({ change24h: 3.1 }, { avgChange: 1.2 }), 'with');
  assert.equal(marketAgreement({ change24h: -2.5 }, { avgChange: 1.2 }), 'against');
  assert.equal(marketAgreement({ change24h: -2.5 }, { avgChange: -1.2 }), 'with');
  assert.equal(marketAgreement({ change24h: 0.05 }, { avgChange: 1.2 }), 'flat');
  assert.equal(marketAgreement({ change24h: 3.1 }, { avgChange: 0.05 }), 'flat');
  assert.equal(marketAgreement({}, { avgChange: 1.2 }), null);
  assert.equal(marketAgreement({ change24h: 3.1 }, null), null);
});

test('versusBitcoin: a difference in percentage points, not a ratio', () => {
  assert.equal(versusBitcoin({ change24h: 5 }, { change24h: 2 }), 3);
  assert.equal(versusBitcoin({ change24h: 1 }, { change24h: 4 }), -3);
  // Flat BTC is exactly the case a ratio could not express.
  assert.equal(versusBitcoin({ change24h: 2 }, { change24h: 0 }), 2);
  assert.equal(versusBitcoin({ change24h: 2 }, { change24h: 2 }), 0);
  assert.equal(versusBitcoin({ change24h: 2 }, null), null);
  assert.equal(versusBitcoin({ change24h: 2 }, { change24h: null }), null);
});

test('tokenIdentity: an empty coin claims nothing and lists what is missing', () => {
  const id = tokenIdentity({});
  assert.equal(id.drawdown, null);
  assert.equal(id.rise, null);
  assert.equal(id.dayPosition, null);
  assert.equal(id.turnover, null);
  assert.equal(id.share, null);
  assert.equal(id.agreement, null);
  assert.equal(id.amplification, null);
  assert.equal(id.versusBtc, null);
  assert.deepEqual(id.missing.slice().sort(), ['ath', 'atl', 'mcap', 'supply']);
});

test('tokenIdentity: null input is the same as empty input', () => {
  const a = tokenIdentity(null);
  const b = tokenIdentity({});
  assert.deepEqual(a.missing.slice().sort(), b.missing.slice().sort());
  assert.equal(a.supply.capped, null);
});

test('tokenIdentity: a complete coin fills every field', () => {
  const coin = {
    price: 50,
    ath: 100,
    atl: 25,
    high24h: 55,
    low24h: 45,
    change24h: 4,
    volume: 2e6,
    mcap: 1e7,
    supply: 19e6,
    maxSupply: 21e6,
  };
  const id = tokenIdentity(coin, {
    global: { mcap: 1e9, avgChange: 2 },
    bitcoin: { change24h: 1 },
  });
  assert.equal(id.drawdown, 50);
  assert.equal(id.rise, 100);
  assert.equal(id.dayPosition, 0.5);
  assert.equal(id.turnover, 0.2);
  assert.equal(id.share, 1);
  assert.equal(id.agreement, 'with');
  assert.equal(id.amplification, 2);
  assert.equal(id.versusBtc, 3);
  assert.equal(id.supply.capped, true);
  assert.deepEqual(id.missing, []);
});

test('tokenIdentity: a coin with no global context still returns the token-local numbers', () => {
  const id = tokenIdentity({ price: 50, ath: 100, change24h: 4 });
  assert.equal(id.drawdown, 50);
  assert.equal(id.agreement, null);
  assert.equal(id.amplification, null);
  assert.equal(id.versusBtc, null);
});

test('tokenIdentity: missing lists the omitted fields and only those', () => {
  const id = tokenIdentity({ price: 1, ath: 2, mcap: 10 });
  assert.deepEqual(id.missing.slice().sort(), ['atl', 'supply']);
});

test('tokenIdentity: does not mutate its input', () => {
  const coin = { price: 50, ath: 100, supply: 1, maxSupply: 2 };
  const copy = JSON.stringify(coin);
  tokenIdentity(coin, { global: { avgChange: 1 } });
  assert.equal(JSON.stringify(coin), copy);
});

test('every identity key the panel asks for exists in all 12 locales', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.resolve('src/i18n/locales');
  const src = await fs.readFile(path.resolve('src/components/TokenIdentity.jsx'), 'utf8');

  const used = new Set(
    [...src.matchAll(/t\('(coin\.identity\.[a-zA-Z0-9_]+)'/g)].map((m) => m[1]),
  );
  // The agreement label is built from a value, so it never appears as a
  // literal in the JSX; add the three branches it can resolve to.
  for (const s of ['with', 'against', 'flat']) used.add(`coin.identity.agreement_${s}`);

  assert.ok(used.size >= 30, `expected a populated key set, saw ${used.size}`);

  for (const lang of LANGS) {
    const raw = await fs.readFile(path.join(dir, `${lang}.json`), 'utf8');
    const data = JSON.parse(raw);
    const table = data?.coin?.identity;
    assert.ok(table, `${lang}.json is missing coin.identity`);
    for (const key of used) {
      const leaf = key.replace('coin.identity.', '');
      const value = table[leaf];
      assert.equal(typeof value, 'string', `${lang}.json: ${key} must be a string`);
      assert.ok(value.trim().length > 0, `${lang}.json: ${key} must not be blank`);
    }
    assert.ok(
      data?.coin?.detailTabs?.identity,
      `${lang}.json is missing coin.detailTabs.identity`,
    );
  }
});
