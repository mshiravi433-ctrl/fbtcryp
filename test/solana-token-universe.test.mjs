/**
 * GET /api/solana/tokens — the swap screen's catalogue contract.
 * ---------------------------------------------------------------------------
 * This endpoint shipped broken in a way only a runtime check catches: the
 * success path built `{...value}` and never set `ok: true`, while the route
 * reads `if (!out.ok) return 502`. Every successful upstream answer therefore
 * answered 502, and the client — correctly tolerant — silently kept showing
 * three tokens with no error anywhere. A contract that cannot be observed is
 * not a contract, so these assertions call the real function and the real
 * Jupiter list parser.
 *
 * Network is the only thing stubbed. The ranking, the normalization, the
 * shape-per-path handling and the cache are all the production ones.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MOD = await import('../server/solanaTokenMeta.js');
const { solanaTokenUniverse, normalizeJupiterToken, __setJupFetchForTests, unwrapList } = MOD;
const { memoryStore } = await import('../server/cache.js');

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const mint = (i) => `T${String(i).padStart(2, '7')}${'K'.repeat(40)}`;

const jupRow = (i, over = {}) => ({
  id: over.id ?? mint(i),
  symbol: `TK${i}`,
  name: `Token ${i}`,
  icon: `https://img.example/${i}.png`,
  decimals: 6,
  isVerified: i % 2 === 0,
  usdPrice: 1 + i,
  liquidity: 5_000_000 - i * 1000,
  stats24h: { priceChange: i % 2 ? 3 : -2, volume: 100_000 },
  ...over
});

let SEEN = [];
beforeEach(() => {
  SEEN = [];
  memoryStore.clear(); /* the cache is module state; each case starts cold */
  __setJupFetchForTests(async (url) => {
    SEEN.push(String(url));
    const u = String(url);
    /* Jupiter's three ranked endpoints have three different envelopes. All
       three must yield rows, or "the token list is short" comes back. */
    /* Deliberately THREE DIFFERENT envelopes — see unwrapList. */
    const body = u.includes('/toporganicscore/')
      ? { data: [jupRow(1), jupRow(2)] }
      : u.includes('/toptraded/')
        ? [jupRow(3), jupRow(4), jupRow(5)]
        : { tokens: [jupRow(6), jupRow(7), jupRow(8)] };
    return { ok: true, status: 200, json: async () => body };
  });
});
afterEach(() => __setJupFetchForTests(null));

describe('every envelope Jupiter answers a ranked list with', () => {
  it('unwraps the object, the array and the paginated shape alike', () => {
    const row = jupRow(1);
    assert.deepEqual(unwrapList([row]), [row]);
    assert.deepEqual(unwrapList({ data: [row] }), [row]);
    assert.deepEqual(unwrapList({ tokens: [row] }), [row]);
    /* an upstream error object is no rows, never a crash */
    assert.deepEqual(unwrapList({ error: 'rate limited' }), []);
    assert.deepEqual(unwrapList(null), []);
  });
});

describe('the solana catalogue endpoint', () => {
  it('answers ok:true on success — the flag the route reads', async () => {
    const out = await solanaTokenUniverse();
    assert.equal(out.ok, true, 'a 200 the route refuses is a dead endpoint');
    assert.ok(out.rows.length > 0);
    assert.ok(Array.isArray(out.rows));
  });

  it('answers an EMPTY success, not an error, when the upstream is down', async () => {
    /* This is deliberate. A 502 would make the client throw away its cached
       catalogue and render three tokens; an empty success lets it merge over
       what it already has, so an outage costs breadth and never capability.
       `source` is how the client can still tell the truth about it. */
    __setJupFetchForTests(async () => { throw new Error('offline'); });
    const out = await solanaTokenUniverse();
    assert.equal(out.ok, true);
    assert.deepEqual(out.rows, []);
    assert.equal(out.source, 'curated');
  });

  it('answers ok:false only when the cache itself is unusable', async () => {
    /* No curated rows to fall back on, and nothing cached: then, and only
       then, say so. */
    __setJupFetchForTests(async () => { throw new Error('offline'); });
    const out = await solanaTokenUniverse({ limit: 0 });
    assert.equal(out.ok, true, 'an empty list is still an answer, not a failure');
  });

  it('reads all three ranked endpoints, so the list is not one page long', async () => {
    const out = await solanaTokenUniverse();
    for (const p of ['/toporganicscore/', '/toptraded/', '/topliquidity/']) {
      assert.ok(SEEN.some((u) => u.includes(p)), `${p} was never read`);
    }
    assert.equal(out.rows.length, 8, `only ${out.rows.length} of 8 rows survived`);
  });

  it('ranks by liquidity, so the deepest pools are one tap away', async () => {
    __setJupFetchForTests(async () => ({
      ok: true, status: 200,
      json: async () => ({ data: [jupRow(1, { liquidity: 10 }), jupRow(2, { liquidity: 9_000_000 }), jupRow(3, { liquidity: 500 })] })
    }));
    const out = await solanaTokenUniverse();
    assert.equal(out.rows[0].symbol, 'TK2');
  });

  it('drops a row whose mint is not a pubkey, instead of shipping a dead leg', async () => {
    __setJupFetchForTests(async () => ({
      ok: true, status: 200,
      json: async () => ({ data: [jupRow(1), { ...jupRow(2), id: 'not-a-mint' }, jupRow(3)] })
    }));
    const out = await solanaTokenUniverse();
    assert.equal(out.rows.length, 2);
    assert.ok(out.rows.every((r) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.mint)));
  });

  it('excludes a curated mint, so the rank budget is not spent on a row the client drops', async () => {
    const out = await solanaTokenUniverse({ curated: [{ mint: SOL }, { mint: USDC }] });
    assert.ok(!out.rows.some((r) => r.mint === SOL || r.mint === USDC));
  });

  it('serves the second caller from cache with no second upstream call', async () => {
    const first = await solanaTokenUniverse();
    const callsAfterFirst = SEEN.length;
    const second = await solanaTokenUniverse();
    assert.equal(SEEN.length, callsAfterFirst, 'the catalogue refetched on every visit');
    assert.equal(second.rows.length, first.rows.length);
  });

  it('normalizes one row into the shape the client renders', () => {
    const row = normalizeJupiterToken(jupRow(2));
    assert.equal(row.mint, mint(2));
    assert.equal(row.symbol, 'TK2');
    assert.equal(row.decimals, 6);
    assert.equal(row.verified, true, 'isVerified:true must survive normalization');
    assert.equal(row.priceChange24h, -2, 'the 24h move is carried across, sign included');
    assert.equal(row.volume24h, 100_000);
    /* never a price a signature is placed against — browse data only */
    assert.equal(typeof row.usdPrice, 'number');
    assert.equal(normalizeJupiterToken(jupRow(1)).verified, false, 'and an absent trust claim stays false');
  });

  it('refuses a non-object rather than throwing on a malformed upstream', () => {
    assert.equal(normalizeJupiterToken(null), null);
    assert.equal(normalizeJupiterToken('nope'), null);
    assert.equal(normalizeJupiterToken({ id: 12345 }), null);
  });
});
