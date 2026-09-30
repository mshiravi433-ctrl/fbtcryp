/**
 * THE WHOLE-PAGE VENUE RESOLVER.
 * ---------------------------------------------------------------------------
 *   «تعداد توکن های صفحه بازار خیلی کمه، بیشترشم قابل سواپ نیست»
 *
 * The claim is not "the list is short" — it is "most of it cannot be swapped".
 * That is a statement about a table of contract addresses, so these cases are
 * about the four ways the address can be wrong:
 *
 *   1. it is not an address at all (a chain we do not trade, a Cardano asset);
 *   2. it is a Solana mint in an EVM field, or an EVM address in a Solana one;
 *   3. two chains claim the same coin and the second is a garbage value;
 *   4. the upstream is down, and the honest answer has to survive it.
 *
 * A swap button that leads to a contract we cannot quote is worse than no
 * button, so every one of these is a case where the answer must be `false`,
 * not a hopeful guess.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { buildVenueIndex, resolveVenues, resolveVenue, getVenueIndex, __setVenueFetchForTests, _resetVenueIndex } =
  await import('../server/coinVenue.js');

const ETH = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const SOL_MINT = '2zMMhcSRxJb2xNvpdPCmRRQNb8HaT9czZzfnYa1cpnKm';

const rows = [
  { id: 'bitcoin', platforms: { ethereum: ETH, 'binance-smart-chain': '0x7130d2a12b9bcbfae4b2634d864a1ee1ce3ead9c' } },
  { id: 'pudgy-penguins', platforms: { ethereum: '', solana: SOL_MINT } },
  { id: 'cardano', platforms: { cardano: '0x1', 'binance-smart-chain': '' } },
  { id: 'bitcoin-cash-sv', platforms: { 'bitcoin-cash': 'qq1234', binance: '0xbad' } },
  /* the same coin claimed twice, the first address is the valid one */
  { id: 'sneaky', platforms: { ethereum: ETH, binance: 'not-an-address' } },
  /* an EVM address in the Solana slot must not become a ?toMint= link */
  { id: 'impostor', platforms: { solana: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' } },
  { id: 'no-platforms' },
  { id: 12345, platforms: { ethereum: ETH } },   /* a non-string id */
  { id: 'ok-string-id', platforms: { ethereum: ETH } },
  null
];

let CALLS = 0;
beforeEach(() => {
  CALLS = 0;
  _resetVenueIndex();
  __setVenueFetchForTests(async () => {
    CALLS++;
    return { ok: true, status: 200, json: async () => rows };
  });
});
afterEach(() => {
  __setVenueFetchForTests(null);
  _resetVenueIndex();
});

describe('the venue index', () => {
  it('stores a coin only when a supported, well-formed address exists', () => {
    const idx = buildVenueIndex(rows);
    assert.equal(idx.get('bitcoin').chains[1].toLowerCase(), ETH);
    assert.equal(idx.get('bitcoin').chains[56], '0x7130d2a12b9bcbfae4b2634d864a1ee1ce3ead9c');
    assert.equal(idx.get('pudgy-penguins').solana, SOL_MINT);
    /* genuinely unreachable, so absent — the UI reads that as "no button" */
    assert.equal(idx.has('cardano'), false);
    assert.equal(idx.has('bitcoin-cash-sv'), false);
    assert.equal(idx.has('impostor'), false);
    assert.equal(idx.has('no-platforms'), false);
    assert.equal(idx.has(12345), false, 'a non-string id is not a coin');
    /* and a string that merely looks non-string is still a coin */
    assert.equal(idx.has('ok-string-id'), true);
  });

  it('lower-cases every EVM address it keeps', () => {
    const idx = buildVenueIndex([{ id: 'x', platforms: { ethereum: '0x2260FAC5E5542A773Aa44fBCfeDf7C193bc2C599' } }]);
    assert.equal(idx.get('x').chains[1], ETH);
  });
});

describe('the whole-page answer', () => {
  it('answers every id asked for, tradeable or not', async () => {
    const out = await resolveVenues(['bitcoin', 'pudgy-penguins', 'cardano', 'BITCOIN']);
    /* the case-variant duplicate is one id asked for twice, not two answers */
    assert.equal(out.count, 3);
    assert.equal(out.venues.bitcoin.tradeable, true);
    assert.equal(out.venues['pudgy-penguins'].solana, SOL_MINT);
    /* an explicit false, not a missing key: the UI must be able to say so */
    assert.deepEqual(out.venues.cardano, { chains: {}, solana: null, tradeable: false });
    assert.equal(Object.keys(out.venues).length, 3);
  });

  it('downloads the index ONCE for the page', async () => {
    await resolveVenues(['bitcoin', 'pudgy-penguins', 'cardano', 'shiba-inu', 'pepe']);
    await resolveVenues(['dogecoin', 'solana']);
    assert.equal(CALLS, 1, 'the market list re-downloaded 17,000 rows per page');
  });

  it('refuses a junk id instead of answering about it', async () => {
    const out = await resolveVenues(['../../etc/passwd', 'ok-one', 'has space', '', null]);
    assert.equal(out.count, 1);
    assert.ok(out.venues['ok-one']);
    /* nothing but junk is an explicit refusal, not an empty success */
    assert.equal((await resolveVenues(['!!!', '../../etc/passwd'])).error, 'BAD_ID');
    assert.equal((await resolveVenue('../secrets')).error, 'BAD_ID');
  });

  it('caps the page at 500 ids — more is a client bug, not a user', async () => {
    const many = Array.from({ length: 900 }, (_, i) => `coin-${i}`);
    const out = await resolveVenues(many);
    assert.equal(out.count, 500);
  });

  it('survives an upstream outage by refusing, never by guessing', async () => {
    __setVenueFetchForTests(async () => { throw new Error('offline'); });
    _resetVenueIndex();
    await assert.rejects(() => resolveVenues(['bitcoin']), /offline/);
  });

  it('serves the PREVIOUS index when a refresh fails — a 6h-old address is not stale', async () => {
    await resolveVenues(['bitcoin']); /* warm the cache */
    __setVenueFetchForTests(async () => { throw new Error('offline'); });
    /* step past the six-hour window so this is a real REFRESH attempt */
    const idx = await getVenueIndex(Date.now() + 7 * 60 * 60 * 1000);
    assert.equal(idx.byCoin.get('bitcoin').chains[1], ETH, 'a failed refresh must not un-tradeable the list');
  });

  it('a single coin still gets the same answer as a page of them', async () => {
    const one = await resolveVenue('bitcoin');
    const many = await resolveVenues(['bitcoin']);
    assert.equal(one.tradeable, many.venues.bitcoin.tradeable);
    assert.deepEqual(one.chains, many.venues.bitcoin.chains);
  });
});
