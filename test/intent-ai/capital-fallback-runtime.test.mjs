/*
 * THE CAPACITY THAT WAS NEVER MEASURED
 * ---------------------------------------------------------------------------
 *
 * Net worth is `assets − debt`. Debt is only a NUMBER when the LENDING or
 * the BORROWING section was read.
 *
 * For an owner whose sections do not include them — which is most owners,
 * most of the time, because the brain only reads `lending` for the intents
 * that are about loans — `netWorthUsd` is `null`.
 *
 * That null is HONEST. The owner may have a loan.
 *
 * But it was read as "no capital", and seven engines across five files took
 * that reading:
 *
 *   · the FIT engine scored an opportunity against a null net worth, so it
 *     could not say whether the opportunity was a sensible size;
 *   · the SCENARIO engine refused to model a goal, because it had no
 *     starting capital — `NO_STARTING_CAPITAL`;
 *   · the DECISION engine could not price a benefit;
 *   · the MACRO GRAPH had no owner capital, so the regime had nothing to
 *     be a regime FOR;
 *   · the AGENT COUNCIL had nothing to weigh.
 *
 * So the fallbacks now live in ONE place — `capitalUsdFor` — so the next
 * engine cannot invent its own:
 *
 *   1. net worth, when it is a number;
 *   2. the gross assets, when they are a number;
 *   3. the available capital, when it is a number.
 *
 * And what it never does is INVENT a debt of zero. `netWorthUsd` stays
 * null, because it is null. These tests pin both halves: the capital is
 * there for the engines that need a size, and the honesty is intact for
 * the ones that need to know whether the owner is in debt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCanonicalFinancialState,
  capitalUsdFor
} from '../../server/fios/financialState.js';

/* An owner with a portfolio, a wallet and a market read — and NO lending
   read, which is the ordinary case. */
const SECTIONS_NO_DEBT = {
  wallet: { addresses: { evm: ['0x1111111111111111111111111111111111111111'] }, connected: true },
  portfolio: { holdings: [{ symbol: 'ETH', amount: 1.5, valueUsd: 4500, chainId: 1, priceUsd: 3000 }], totalValueUsd: 4500 },
  markets: { prices: { ETH: { priceUsd: 3000 } } }
};

const SECTIONS_ZERO_DEBT = {
  ...SECTIONS_NO_DEBT,
  lending: { positions: [] }
};

test('net worth stays null when the debt was never read', () => {
  const fs = buildCanonicalFinancialState({ owner: 'o', sections: SECTIONS_NO_DEBT, now: Date.now() });
  assert.equal(fs.net.netWorthUsd.value, null, 'the debt is unknown, so the net worth is unknown');
  assert.equal(fs.net.netWorthUsd.reason, 'DEBT_OR_ASSETS_UNREAD');
});

test('net worth is the gross when the debt was read as zero', () => {
  const fs = buildCanonicalFinancialState({ owner: 'o', sections: SECTIONS_ZERO_DEBT, now: Date.now() });
  assert.equal(fs.net.netWorthUsd.value, 4500, 'a read lending section with no positions IS a debt of zero');
});

test('the capital an engine may use is there even when the debt was never read', () => {
  const fs = buildCanonicalFinancialState({ owner: 'o', sections: SECTIONS_NO_DEBT, now: Date.now() });
  assert.equal(capitalUsdFor(fs), 4500, 'the assets are known, and a capital-sized decision is still a sizing');
});

test('no portfolio means no capital — nothing is invented', () => {
  const fs = buildCanonicalFinancialState({
    owner: 'o',
    sections: { wallet: { connected: true }, markets: { prices: {} } },
    now: Date.now()
  });
  assert.equal(capitalUsdFor(fs), null, 'nothing was read, so there is no capital');
});

test('the capital is never a guess when the portfolio was read but nothing was valued', () => {
  const fs = buildCanonicalFinancialState({
    owner: 'o',
    sections: { wallet: { connected: true }, portfolio: { holdings: [] }, markets: { prices: {} } },
    now: Date.now()
  });
  assert.equal(capitalUsdFor(fs), null);
});

test('the helper survives a missing state entirely', () => {
  assert.equal(capitalUsdFor(null), null);
  assert.equal(capitalUsdFor(undefined), null);
  assert.equal(capitalUsdFor({}), null);
  assert.equal(capitalUsdFor({ computed: null }), null);
});

test('the helper does not read a provenance object as a number', () => {
  /* `financial.net.netWorthUsd` is a PROVENANCE object — { value, status,
     reason }. A naive `Number(obj)` would be NaN, and `num()` on an object
     must be null, not a number. */
  const fs = buildCanonicalFinancialState({ owner: 'o', sections: SECTIONS_NO_DEBT, now: Date.now() });
  assert.equal(typeof fs.net.netWorthUsd, 'object');
  assert.equal(capitalUsdFor(fs), 4500, 'the object was skipped, and the gross was used');
});
