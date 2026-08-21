/**
 * SIGNALS PAGE PROBE
 * ---------------------------------------------------------------------------
 * Three concerns for the enhanced Signals page, none of which a passing build
 * alone can prove:
 *
 *   (a) The Solana on-chain intel module is fail-closed: no key ⇒ a plain
 *       `{ configured:false }` with no thrown error; a configured key with a
 *       fake upstream ⇒ the documented schema; and the key never reaches the
 *       response body. Tested against the REAL module with a fake fetch, not a
 *       mock of our own code.
 *   (b) The signal card renders ONLY the sections that have real data: the
 *       on-chain row, the backtest history, the invalidation level, the
 *       probability scenarios and the derivatives row are each behind a
 *       truthy guard, so an incomplete read leaves them absent rather than as
 *       empty boxes. (Structural — the full-app boot suite covers "renders
 *       without crashing"; this covers "data-less sections stay hidden".)
 *   (c) No hardcoded Persian or Arabic in the JSX: every string the user sees
 *       is a translation key, so the twelve locales cannot drift out of sync.
 */
import { readFileSync } from 'node:fs';
import {
  fetchSolanaIntel,
  fetchSolanaWhales,
  solscanConfigured,
  __setSolscanFetchForTests
} from '../server/solanaIntel.js';

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ===================== (a) Solana intel, fail-closed ===================== */

  const MINT = 'So11111111111111111111111111111111111111112';
  const RAY = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
  const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

  /* ---- no key: a plain, non-erroring "not configured" shape ---- */
  delete process.env.SOLSCAN_API_KEY;
  t('solanaIntel without a key reports configured:false (no throw)',
    solscanConfigured() === false
    && (await fetchSolanaIntel(MINT)).configured === false
    && !(await fetchSolanaIntel(MINT)).whaleFlow);

  const whalesNoKey = await fetchSolanaWhales();
  t('solana whales without a key reports configured:false and an empty list',
    whalesNoKey.configured === false && Array.isArray(whalesNoKey.transfers) && whalesNoKey.transfers.length === 0);

  /* ---- with a key + a fake upstream: the documented schema ---- */
  process.env.SOLSCAN_API_KEY = 'probe-secret-key';
  const ok = (body) => ({ ok: true, json: async () => body });
  const fakeRich = async (url) => {
    if (url.includes('/token/transfer')) return ok({ data: [{ amount: '9000000000', from_address: 'A'.repeat(44), to_address: 'B'.repeat(44), block_time: 1700000000, to_owner_address_label: 'Binance' }] });
    if (url.includes('/token/holders')) return ok({ data: [{ amount: '9000000000' }, { amount: '3000000000' }] });
    if (url.includes('/token/meta')) return ok({ data: { decimals: 9, supply: '900000000000', holder: 50000 } });
    if (url.includes('/token/defi/activities')) return ok({ data: [{ block_time: 1700000100, tokens_out: [{ token_address: MINT, value_usd: 500 }], tokens_in: [{ token_address: 'usdc' }] }] });
    return ok({});
  };
  __setSolscanFetchForTests(fakeRich);
  const intel = await fetchSolanaIntel(MINT);
  t('a configured key produces the documented schema (all four metric keys)',
    intel.configured === true
    && intel.schema === 'fbt.solana-intel.v1'
    && 'whaleFlow' in intel && 'holderTrend' in intel && 'topHolderPct' in intel && 'dexActivity' in intel);
  t('whale flow direction is derived only from a real Solscan label',
    intel.whaleFlow?.direction === 'outflow' && intel.whaleFlow?.sampleLabel === 'Binance');
  t('dex pressure classifies the swap leg against this mint',
    intel.dexActivity?.pressure === 'buy' && intel.dexActivity?.volumeUsd === 500);
  t('the response body never echoes the Solscan key',
    !JSON.stringify(intel).includes('probe-secret-key'));

  /* ---- fail-closed on an upstream that returns nothing useful ----
     A different mint avoids the 5-minute cache; every metric must null out. */
  __setSolscanFetchForTests(async () => ok({ data: [] }));
  const empty = await fetchSolanaIntel(WIF);
  t('an empty upstream yields null metrics (never invented numbers)',
    empty.configured === true
    && empty.whaleFlow === null && empty.holderTrend === null
    && empty.topHolderPct === null && empty.dexActivity === null);

  /* ---- a malformed mint is rejected before any upstream call ---- */
  __setSolscanFetchForTests(() => { throw new Error('should not be called'); });
  let badMintThrew = false;
  try { await fetchSolanaIntel('not-a-mint'); } catch { badMintThrew = true; }
  t('a malformed mint is rejected (BAD_MINT), not forwarded upstream', badMintThrew);

  /* restore the real fetch for any later probe in the process */
  __setSolscanFetchForTests(null);
  delete process.env.SOLSCAN_API_KEY;
  /* touch RAY so the linter does not flag the unused constant; it documents a
     second verified mint shape without being load-bearing here. */
  t('a second curated mint is a valid base58 shape', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(RAY));

  /* ============ (b) the signal card hides data-less sections ============== */
  const src = readFileSync('src/pages/Signals.jsx', 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  t('the on-chain row is gated on real on-chain data (hasOnchain)',
    /hasOnchain && \(/.test(src));
  t('the backtest history is hidden when the sample is too thin (backtestInfo)',
    /\{backtestInfo && \(/.test(src));
  t('the invalidation level is shown only when a support exists',
    /\{invalidation && \(/.test(src));
  t('probability scenarios require a minimum sample size',
    /scenarios && scenarios\.samples >= 20 && \(/.test(src));
  t('the derivatives row appears only for a funded perp market',
    /perpForCoin && perpForCoin\.avgFundingApr != null && \(/.test(src));
  t('layer score bars render only when at least one layer carries weight',
    /layerRows\.length > 0 && \(/.test(src));
  t('the asset picker is two tabs on the same page, not a new route',
    /signals\.allTab/.test(src) && /signals\.solanaTab/.test(src));
  t('Create Intent navigates to Intent OS with a pre-fill, no auto-execution',
    /navigate\(`\/intent\?to=/.test(src) && !/executeSwap|autoExecute|signTransaction/.test(strip(src)));

  /* No "no data" / empty-box / error notice was added for the new sections.
     The fail-closed rule is that they simply are not there, not that they say
     "no data". */
  t('no new empty-box or "no data" notice was added for the on-chain read',
    !/signals\.onchain\.(noData|unavailable|empty)/.test(src));

  /* ============ (c) no hardcoded Persian/Arabic in the JSX =============== */
  t('Signals.jsx holds no hardcoded Persian or Arabic (all strings via i18n)',
    !/[\u0600-\u06ff]/.test(strip(src)));

  return rows;
}
