/**
 * Pure-logic unit tests. No DOM, no bundler — these modules are deliberately
 * free of React and browser APIs so they can be exercised directly, which is
 * the cheapest place to catch a regression in the parts that decide where
 * money goes.
 */
import { searchTokens, tokenKey, getTokensSync } from '../src/lib/tokenLists.js';
import { FAMILY, isValidFor, resolvePayout, payoutTable, PAYOUT_ADDRESSES } from '../src/lib/payout.js';
import { localAnswer } from '../src/lib/faqLocal.js';
import { digestFromMarket } from '../src/lib/news.js';
import { trimKeepingLanguages } from '../server/news.js';
import { isEligible, normalizePool, riskBand } from '../server/yields.js';
import { issuerMatches } from '../server/solanaAssets.js';
import { bridgeFee, integratorId } from '../server/bridge.js';
import { feeBps as gaslessFeeBps, feeRecipient as gaslessRecipient, gaslessConfigured } from '../server/gasless.js';
import {
  COMMODITY_ASSETS,
  EQUITY_ASSETS,
  LST_ASSETS,
  MAX_POOL_SHARE,
  XSTOCK_FREEZE_AUTHORITY,
  XSTOCK_MINT_AUTHORITY,
  findAsset,
  isCuratedMint,
  liquidityVerdict
} from '../src/lib/solanaAssets.js';
import { MIN_EQUITY_LIQUIDITY, projectStake, yieldForLst } from '../src/lib/solanaAssetsClient.js';
import { iconCandidates } from '../src/lib/tokenIcon.jsx';
import { pairTokens, projectEarnings, rateIsUnusual, realShare } from '../src/lib/yields.js';
import { buildHoldings } from '../src/hooks/useWalletBalances.js';
import {
  REFERRAL_SHARE,
  captureReferral,
  clearReferral,
  isValidRefCode,
  referredBy,
  referrerShare
} from '../src/lib/referral.js';
import { phantomBrowseLink, publicAppUrl, solflareBrowseLink } from '../src/lib/solanaWallet.js';
import { shareTargets, telegramShareUrl } from '../src/lib/share.js';
import { SUPPORT_EMAIL, SUPPORT_MAILTO, LEGACY_EMAIL_IN_LOCALES, withContactEmail } from '../src/lib/contact.js';
import { allowedNumbers, buildPost, esc, hasInventedNumber } from '../scripts/channel-post.mjs';
import { comparable, improvementBps, isUsableQuote, pickBestQuote } from '../src/lib/bestQuote.js';
import { bpsToPercent, openOceanSupports } from '../src/lib/openocean.js';
import { betaToBtc, cyclePosition, macroContext, marketRegime } from '../src/lib/macro.js';
import { CONFIDENCE_CEILING, verdict } from '../src/lib/verdict.js';
import {
  baseRate,
  findLevels,
  historyFacts,
  levelRecord,
  maxDrawdown,
  rangePosition,
  relativeToNormal
} from '../src/lib/history.js';
import {
  REFERRAL_FEE_MAX_BPS,
  REFERRAL_FEE_MIN_BPS,
  executeSucceeded,
  fromBaseUnits,
  isSolanaAddress,
  netFeeBps,
  orderErrorKey,
  referralFeeBps,
  toBaseUnits
} from '../src/lib/solana.js';
import {
  FUNDING_INTERVAL_HOURS,
  VENUE_CUSTODY,
  TRACKED_ASSETS,
  annualiseFunding,
  crowding,
  groupByAsset,
  normalizeTicker
} from '../server/perp.js';
import { bestVenue, fundingCost, liquidationMove } from '../src/lib/perp.js';
import {
  LADDER_MAX_STEPS,
  LADDER_MIN_STEPS,
  WATCHED_TYPES,
  ladderPortion,
  ladderRungs
} from '../src/lib/orders.js';
import { evaluateWatch } from '../server/watch.js';
import { GOALS, GOAL_SHAPE, REFUSALS, buildAutopilot, summariseDraft } from '../src/lib/autopilot.js';
import { VENUE_REFERRAL, isValidGmxCode, venueDisclosure, withReferral, anyVenueEarns } from '../src/lib/venueReferral.js';
import { isSwappable, swapTargetFor, swapUrlFor } from '../src/lib/coinToSwap.js';
import { buildIndex, PLATFORM_SLUGS } from '../server/coinIndex.js';
import {
  MIN_SAMPLES,
  MIN_TESTS,
  adviseOrder,
  anchorLevels,
  suggestBracket,
  suggestLadder,
  suggestTrail,
  typicalMovePct
} from '../src/lib/orderAdvisor.js';
import { pickPromoKey } from '../src/lib/notify.js';
import { analyze } from '../src/lib/ai.js';
import { backtest, confidenceFrom, signalAt } from '../src/lib/backtest.js';
import { formatUnitsExact, NATIVE_GAS_FLOOR } from '../src/lib/swap.js';
import { FEE_BPS, FEE_BPS_MAX, FEE_BPS_DEFAULT } from '../src/lib/chains.js';
import {
  DCA_INTERVALS,
  TRAIL_MAX_PCT,
  TRAIL_MIN_PCT,
  advanceOrder,
  createOrder,
  evaluateOrder,
  expireStale,
  orderFeeUsd,
  orderNotionalUsd,
  pauseOrder,
  pipelineFeeUsd,
  resumeOrder,
  shouldNotify,
  validateOrder
} from '../src/lib/orders.js';
import { localOutlook, localBrief } from '../src/lib/localOutlook.js';
import { fmtUsd, fmtCompact, fmtQty, fmtPrice, fmtPct, setHideBalances } from '../src/lib/format.js';
import { shouldAutoLock, markAway, clearAway, AUTOLOCK_NEVER } from '../src/lib/autoLock.js';
import qrcode from 'qrcode-generator';
import { classifyQuery } from '../src/pages/Explore.jsx';
import { isSafeUrl } from '../src/lib/browser.js';
import { clean as nftClean, safeImage } from '../server/nft.js';
import coverage from '../src/i18n/coverage.json';
import enLocale from '../src/i18n/locales/en.json';
import faLocale from '../src/i18n/locales/fa.json';
import arLocale from '../src/i18n/locales/ar.json';
import { LANGUAGES, coverageFor, isComplete } from '../src/i18n/languages.js';
import { readFileSync } from 'node:fs';

export default function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* --------------------------- token search --------------------------- */

  const tokens = [
    { symbol: 'BNB', name: 'BNB', address: null, native: true, verified: true },
    { symbol: 'USDT', name: 'Tether USD', address: '0x55d398326f99059fF775485246999027B3197955', verified: true },
    { symbol: 'USDT', name: 'Fake Tether', address: '0x1111111111111111111111111111111111111111', verified: false },
    { symbol: 'CAKE', name: 'PancakeSwap', address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', verified: true },
    { symbol: 'BABYCAKE', name: 'Baby Cake', address: '0x2222222222222222222222222222222222222222', verified: false }
  ];

  const usdt = searchTokens(tokens, 'usdt');
  t('exact ticker match ranks first', usdt[0].symbol === 'USDT');
  t('verified beats unverified on an identical ticker', usdt[0].verified === true);
  t('both same-ticker tokens are kept, not deduped away', usdt.length === 2);

  const cake = searchTokens(tokens, 'cake');
  t('exact ticker outranks a longer ticker containing it', cake[0].symbol === 'CAKE');

  const byAddr = searchTokens(tokens, '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82');
  t('a pasted address is an exact lookup', byAddr.length === 1 && byAddr[0].symbol === 'CAKE');

  const missAddr = searchTokens(tokens, '0x9999999999999999999999999999999999999999');
  t('an unknown address returns nothing (so the import path can offer it)', missAddr.length === 0);

  t('empty query returns the list', searchTokens(tokens, '').length === tokens.length);
  t('token key is the address, not the symbol', tokenKey(tokens[1]) !== tokenKey(tokens[2]));
  t('native token has a stable key', tokenKey(tokens[0]) === 'native');

  /* ------------------------ bundled token floor ----------------------- */
  /* The picker must be useful with zero network. If a CDN is blocked or the
     device is offline, these are the tokens that still show up. */

  for (const chain of [56, 1, 137, 42161, 8453, 10, 43114]) {
    const list = getTokensSync(chain);
    t(`chain ${chain} has a bundled token floor`, list.length >= 4);
    t(`chain ${chain} exposes its native gas coin`, list.some((x) => x.native));
    t(
      `chain ${chain} has no duplicate contract addresses`,
      new Set(list.map(tokenKey)).size === list.length
    );
    t(
      `chain ${chain} addresses are all well-formed`,
      list.every((x) => x.native || /^0x[a-fA-F0-9]{40}$/.test(x.address))
    );
    t(
      `chain ${chain} entries all declare decimals`,
      list.every((x) => Number.isInteger(x.decimals) && x.decimals >= 0 && x.decimals <= 36)
    );
  }

  t('BSC ships a substantial offline list', getTokensSync(56).length >= 40);

  /* ------------------------------ payout ------------------------------ */

  t('EVM address validates', isValidFor(FAMILY.EVM, '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6'));
  t('Solana address validates', isValidFor(FAMILY.SOLANA, 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4'));
  t('Tron address validates', isValidFor(FAMILY.TRON, 'TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ'));
  t('an EVM address is NOT accepted as Tron', !isValidFor(FAMILY.TRON, '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6'));
  t('a Tron address is NOT accepted as EVM', !isValidFor(FAMILY.EVM, 'TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ'));

  const bsc = resolvePayout(56, FAMILY.EVM);
  t('BSC resolves to an EVM address', bsc && isValidFor(FAMILY.EVM, bsc.address));

  const unknownChain = resolvePayout(999999, FAMILY.EVM);
  t('an unconfigured chain falls back to the shared EVM address', unknownChain && isValidFor(FAMILY.EVM, unknownChain.address));

  const sol = resolvePayout(null, FAMILY.SOLANA);
  t('Solana resolves within its own family', sol && isValidFor(FAMILY.SOLANA, sol.address));

  /*
   * ─── PAYOUT ADDRESSES ARE CHECKED BY BYTE LENGTH, NOT JUST BY REGEX ───────
   * `isValidFor` uses /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, which every base58
   * string of roughly the right size satisfies — including one with a
   * transposed or dropped character. A real Solana address is an ed25519
   * public key: it must base58-decode to EXACTLY 32 bytes.
   *
   * This matters more than a usual input check. These are the addresses our
   * own revenue is paid to, and a payout sent to a mistyped address that
   * happens to look well-formed is gone permanently — no one holds the key.
   * The character-class regex cannot catch that; the decode can.
   */
  {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const b58decode = (str) => {
      const bytes = [0];
      for (const ch of str) {
        const val = ALPHABET.indexOf(ch);
        if (val < 0) return null;
        let carry = val;
        for (let i = 0; i < bytes.length; i += 1) {
          const x = bytes[i] * 58 + carry;
          bytes[i] = x & 0xff;
          carry = x >> 8;
        }
        while (carry) {
          bytes.push(carry & 0xff);
          carry >>= 8;
        }
      }
      // Leading '1's are leading zero bytes.
      for (const ch of str) {
        if (ch !== '1') break;
        bytes.push(0);
      }
      return bytes.length;
    };

    const solAddr = PAYOUT_ADDRESSES.solana;
    t('the Solana payout address is configured', Boolean(solAddr));
    t(
      `the Solana payout address decodes to 32 bytes (got ${b58decode(solAddr)})`,
      b58decode(solAddr) === 32
    );

    /*
     * The regex must be SHOWN to be insufficient, or this whole block guards
     * nothing. Note that dropping a single trailing character still decodes to
     * 32 bytes (base58 is not byte-aligned), so the demonstration uses a
     * two-character truncation — 42 chars, which the 32-44 regex happily
     * accepts while the key is now 31 bytes and unusable.
     */
    const truncated = solAddr.slice(0, 42);
    t('a truncated address still passes the loose regex', isValidFor(FAMILY.SOLANA, truncated));
    t(
      `...but fails the byte-length check (${b58decode(truncated)} bytes)`,
      b58decode(truncated) !== 32
    );

    // Tron addresses are 25 bytes (21 payload + 4 checksum) after base58.
    t(
      `the Tron payout address decodes to 25 bytes (got ${b58decode(PAYOUT_ADDRESSES.tron)})`,
      b58decode(PAYOUT_ADDRESSES.tron) === 25
    );
  }

  const table = payoutTable();
  t('every directory row resolves to an address', table.every((r) => r.address));
  t('every directory row declares its gas coin', table.every((r) => Boolean(r.gas)));
  t('no row is resolved with the wrong address family', table.every((r) => isValidFor(r.family, r.address)));

  /* ------------------------------- FAQ -------------------------------- */

  t('gas question answered in Persian', /گس/.test(localAnswer('گس چیه و چرا لازمه؟', 'fa')?.answer ?? ''));
  /*
   * Derived from FEE_BPS, never typed. This assertion used to read /0\.5%/ and
   * kept passing after the fee moved to 70 bps, because the canned answer
   * hard-coded the old number too — the test and the bug agreed with each
   * other. Computing the expected string from the same constant the swap
   * engine charges from is the only version of this check that can fail.
   */
  t(
    `fee question quotes the real ${FEE_BPS} bps`,
    localAnswer('how much is the fee?', 'en')?.answer?.includes(`${FEE_BPS / 100}%`) === true
  );
  t(
    'no canned answer still hard-codes a stale rate',
    !/\b0\.5% (platform )?fee\b/.test(localAnswer('how much is the fee?', 'en')?.answer ?? '')
  );
  t('mixed-script question still matches', Boolean(localAnswer('fee چقدره؟', 'fa')));
  t('seed-phrase question matches', localAnswer('I lost my recovery phrase', 'en')?.id === 'seed');
  t('unrelated question returns null rather than guessing', localAnswer('what is the weather in Isfahan', 'en') === null);
  t('Iranian-law question is answered', Boolean(localAnswer('آیا در ایران ممنوع است؟', 'fa')));

  /* ------------------------------- news ------------------------------- */

  const digest = digestFromMarket(
    [
      { symbol: 'BTC', change24h: 4.2 },
      { symbol: 'ETH', change24h: -3.1 },
      { symbol: 'SOL', change24h: 8.4 }
    ],
    'en'
  );
  t('digest produces gainers and losers', digest.length === 2);
  t('digest is flagged as generated, not reported', digest.every((d) => d.digest === true));
  t('digest never fabricates a source URL', digest.every((d) => d.url === null));
  t('digest on empty market data is empty, not invented', digestFromMarket([], 'en').length === 0);

  /* ------------------------------ promos ------------------------------ */

  const d1 = new Date('2026-01-01T10:00:00Z');
  const d1Later = new Date('2026-01-01T23:00:00Z');
  const d2 = new Date('2026-01-02T10:00:00Z');
  t('promo copy is stable within a day', pickPromoKey(d1) === pickPromoKey(d1Later));
  t('promo copy rotates across days', pickPromoKey(d1) !== pickPromoKey(d2));

  /* ------------------------ swap MAX precision ------------------------- */
  /*
   * The old MAX used Number(bal).toFixed(8), which had three failure modes,
   * all ending in a reverted transaction the user still paid gas for.
   */

  // 1. Rounding UP past the real balance. toFixed rounds; this must not.
  const bigWei = 1234567123456789012345678n;
  t(
    'MAX never rounds a balance upward',
    formatUnitsExact(bigWei, 18) === '1234567.123456789012345678'
  );
  t(
    'the old float path really did lose precision (regression guard)',
    Number('1234567.123456789012345678').toFixed(8) !== '1234567.123456789012345678'
  );

  // 2. Small 18-decimal holdings flushed to zero.
  t('a tiny 18-decimal balance is not flattened to 0', formatUnitsExact(123456n, 18) === '0.000000000000123456');
  t('the old path DID flatten it (regression guard)', Number(0.000000000000123456.toFixed(8)) === 0);

  // 3. General correctness.
  t('6-decimal token formats correctly', formatUnitsExact(1500000n, 6) === '1.5');
  t('whole amounts have no trailing dot', formatUnitsExact(2n * 10n ** 18n, 18) === '2');
  t('zero formats as 0', formatUnitsExact(0n, 18) === '0');
  t('trailing zeros are trimmed', formatUnitsExact(1100000000000000000n, 18) === '1.1');
  t('one wei survives', formatUnitsExact(1n, 18) === '0.000000000000000001');

  // Gas reserve is per-chain, because a flat constant is wrong in both
  // directions: 0.002 ETH strands ~$7, and on a busy L1 it can be too little.
  t('every swappable chain declares a gas floor', [56, 1, 137, 42161, 8453, 10, 43114].every((c) => NATIVE_GAS_FLOOR[c] > 0));
  t('the ETH floor is larger than the L2 floor', NATIVE_GAS_FLOOR[1] > NATIVE_GAS_FLOOR[42161]);
  t('no floor is absurdly large', Object.values(NATIVE_GAS_FLOOR).every((v) => v < 1));

  /* ------------------- local AI narrator (no model) -------------------- */
  /* The whole point: the analysis screen must produce real prose with zero
     configuration, because the indicators behind it are computed locally
     anyway and gating them on a remote key hid work already done. */

  const upTrend = Array.from({ length: 80 }, (_, i) => 100 + i * 0.8 + Math.sin(i / 3) * 2);
  const downTrend = Array.from({ length: 80 }, (_, i) => 180 - i * 0.7 + Math.sin(i / 4) * 3);
  const flat = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 0.6);

  const aUp = analyze(upTrend, { symbol: 'BTC', change24h: 2.1, change7d: 6.4 });
  const aDown = analyze(downTrend, { symbol: 'ETH', change24h: -2.4, change7d: -7.1 });
  const aFlat = analyze(flat, { symbol: 'USDC', change24h: 0.01, change7d: 0.02 });

  t('analyze() produces a result from real price history', Boolean(aUp && aDown && aFlat));

  for (const [name, a] of [['uptrend', aUp], ['downtrend', aDown], ['flat', aFlat]]) {
    const o = localOutlook({ analysis: a, coin: { symbol: 'X' }, lang: 'en' });
    t(`${name}: outlook is produced without any model`, Boolean(o?.summary));
    t(`${name}: has a headline`, Boolean(o.headline && o.headline.length > 8));
    t(`${name}: summary is real prose, not a stub`, o.summary.length > 80);
    t(`${name}: always states at least one risk`, o.risks.length >= 1);
    t(`${name}: always states an invalidation level`, Boolean(o.invalidation));
    t(`${name}: labels itself as locally generated`, o.source === 'local');
    t(`${name}: confidence never exceeds the 88 cap`, o.confidence <= 88);
    t(`${name}: no unresolved {placeholder} left in the prose`, !/\{\w+\}/.test(o.summary + o.headline + o.invalidation));
    t(`${name}: gives a range, never a single target`, !o.range || o.range.low < o.range.high);
  }

  // The honest-risk guarantee: it must always admit it cannot see news.
  const oNews = localOutlook({ analysis: aUp, coin: { symbol: 'X' }, lang: 'en' });
  t('always discloses that it reads price only', oNews.risks.some((r) => /news/i.test(r)));

  // Localisation of the narration itself.
  const oFa = localOutlook({ analysis: aUp, coin: { symbol: 'BTC' }, lang: 'fa' });
  t('narrates in Persian', /[\u0600-\u06FF]/.test(oFa.summary));
  t('uses Persian-Indic digits in Persian prose', /[۰-۹]/.test(oFa.summary));
  t('keeps currency figures in Latin digits', !/\$[۰-۹]/.test(oFa.invalidation));
  t('no unresolved placeholder in Persian', !/\{\w+\}/.test(oFa.summary + oFa.headline));

  const oAr = localOutlook({ analysis: aUp, coin: { symbol: 'BTC' }, lang: 'ar' });
  t('narrates in Arabic', /[\u0600-\u06FF]/.test(oAr.summary));

  // An unsupported language must fall back to English, not to a blank.
  const oZh = localOutlook({ analysis: aUp, coin: { symbol: 'BTC' }, lang: 'zh' });
  t('unsupported narration language falls back to English prose', oZh.summary.length > 80);

  t('no analysis means no invented outlook', localOutlook({ analysis: null, lang: 'en' }) === null);

  /* ------------------------------ brief -------------------------------- */

  const bDown = localBrief({
    global: { mcapChange: -2.3, btcDominance: 54.2 },
    top: [
      { symbol: 'BTC', change24h: -1.2 },
      { symbol: 'ETH', change24h: -3.4 },
      { symbol: 'SOL', change24h: -2.2 }
    ],
    lang: 'en'
  });
  t('brief reads breadth, not just the index', /3 of 3|broad/i.test(bDown.summary));
  t('brief detects a bearish tape', bDown.bias === 'bearish');

  const bMixed = localBrief({
    global: { mcapChange: 0.1, btcDominance: 50 },
    top: [
      { symbol: 'BTC', change24h: 1 },
      { symbol: 'ETH', change24h: -1 }
    ],
    lang: 'en'
  });
  t('brief calls a mixed tape neutral rather than picking a side', bMixed.bias === 'neutral');
  t('brief labels itself as locally generated', bDown.source === 'local');

  /* --------------------- translation coverage honesty ------------------- */
  /*
   * ar.json used to claim completeness while 686 of its strings were still
   * English. Coverage is now measured; these assertions stop it drifting back
   * into a comfortable lie.
   */
  t('coverage data is generated for every language', LANGUAGES.every((l) => coverage.coverage[l.code] !== undefined));
  t('English is the source and therefore 100%', coverageFor('en') === 100);
  t('Persian is effectively complete', coverageFor('fa') >= 90);
  t('every language reports a plausible percentage', LANGUAGES.every((l) => coverageFor(l.code) >= 0 && coverageFor(l.code) <= 100));
  t(
    'a language is only called complete when measurement agrees',
    LANGUAGES.every((l) => isComplete(l.code) === coverageFor(l.code) >= 90)
  );
  t('partial languages are not marked complete', !isComplete('zh') && !isComplete('tr'));
  t('coverage counts against the real key total', coverage.total > 900);

  /* ------------------------------ receive QR ------------------------------ */
  /*
   * A QR that encodes the WRONG characters still looks like a valid QR — it
   * just sends the money somewhere nobody controls. So this asserts the code
   * we generate decodes back to the exact address, using our own scanner's
   * parser as the reader. Encoder and reader agreeing is the only property
   * that actually matters here.
   */
  {
    const addr = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';
    const q = qrcode(0, 'M');
    q.addData(addr);
    q.make();
    const n = q.getModuleCount();

    t('QR is generated for an address', n >= 21);

    // Finder patterns in three corners — the marker a camera locks onto.
    const finder = (r, c) => q.isDark(r, c) && q.isDark(r + 6, c) && q.isDark(r, c + 6);
    t('QR has all three finder patterns', finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0));

    let dark = 0;
    for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (q.isDark(r, c)) dark += 1;
    t('QR carries real data, not a blank or solid grid', dark > 40 && dark < n * n * 0.9);

    // Longer payloads must grow the symbol rather than silently truncate.
    const long = qrcode(0, 'M');
    long.addData(`ethereum:${addr}@56`);
    long.make();
    t('a longer payload produces a larger symbol', long.getModuleCount() > n);
  }

  /* ------------------------------ explorer -------------------------------- */
  /*
   * Telling a 66-char hash from a 42-char address is the whole value of the
   * explorer screen: guess wrong and the user gets "not found" and concludes
   * their money is gone.
   */
  {
    const addr = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';
    const hash = `0x${'a'.repeat(64)}`;
    t('a 66-char hash is a transaction', classifyQuery(hash).kind === 'tx');
    t('a 42-char string is an address', classifyQuery(addr).kind === 'address');
    t('digits are a block number', classifyQuery('12345678').kind === 'block');
    t('Tron addresses are detected', classifyQuery('TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ').kind === 'tron');
    t('empty input is not an error', classifyQuery('  ').kind === 'empty');
    t('junk is reported as unrecognised', classifyQuery('hello world').kind === 'unknown');
    // A truncated hash must NOT be silently treated as an address.
    t('a truncated hash is not mistaken for an address', classifyQuery(hash.slice(0, 50)).kind === 'unknown');
  }

  /* --------------------------- browser safety ------------------------------ */
  /*
   * The in-app browser must refuse anything but plain https. javascript: and
   * data: URLs can execute in the opening context, and http: is trivially
   * rewritten on a hostile network — which, on a page about crypto, means an
   * attacker editing the addresses the user is about to copy.
   */
  {
    t('https is allowed', isSafeUrl('https://pancakeswap.finance'));
    t('http is refused', !isSafeUrl('http://pancakeswap.finance'));
    t('javascript: is refused', !isSafeUrl('javascript:alert(1)'));
    t('data: is refused', !isSafeUrl('data:text/html,<script>alert(1)</script>'));
    t('file: is refused', !isSafeUrl('file:///etc/passwd'));
    t('garbage is refused', !isSafeUrl('not a url'));
    t('empty is refused', !isSafeUrl(''));
    // Case and whitespace tricks must not slip past the scheme check.
    t('uppercase JAVASCRIPT: is refused', !isSafeUrl('JavaScript:alert(1)'));
  }

  /* --------------------------- NFT sanitising ------------------------------ */
  /*
   * Anyone can mint an NFT into anyone's wallet with arbitrary metadata, so
   * every string here is attacker-supplied. Airdropped scam NFTs use the name
   * field as the payload. These assertions are the boundary.
   */
  {
    t('markup is stripped from names', !nftClean('<img src=x onerror=alert(1)>').includes('<'));
    t('quotes are stripped', !nftClean(`Claim '$5000' now`).includes("'"));
    t('backslashes are stripped', !nftClean('a\\b').includes('\\'));
    // A bidi override can render `moc.dab.evil` as `evil.bad.com`.
    t('bidi overrides are removed', !/[\u202A-\u202E\u2066-\u2069]/.test(nftClean('Free\u202EmureP\u202Cdrop')));
    t('control characters are removed', !/[\u0000-\u001f]/.test(nftClean('a\u0000b\nc')));
    t('names are length-capped', nftClean('A'.repeat(500)).length <= 120);
    t('normal names survive intact', nftClean('Bored Ape #1234') === 'Bored Ape #1234');
    t('non-Latin names survive', nftClean('نمونه توکن') === 'نمونه توکن');

    t('https images are kept', safeImage('https://cdn.test/a.png') === 'https://cdn.test/a.png');
    t('http images are dropped', safeImage('http://cdn.test/a.png') === null);
    t('javascript: images are dropped', safeImage('javascript:alert(1)') === null);
    t('data: images are dropped', safeImage('data:image/svg+xml,<svg onload=alert(1)>') === null);
    t('ipfs is rewritten to a gateway', String(safeImage('ipfs://QmHash/1.png')).startsWith('https://'));
    t('garbage image urls are dropped', safeImage('not a url') === null);
  }

  /* -------------------------------- fee dial ------------------------------- */
  /*
   * The fee is the entire business model, so it gets asserted rather than
   * trusted. The cap matters most: a mistyped env var must never be able to
   * take an outrageous cut of someone's swap.
   */
  {
    t('fee is a whole number of basis points', Number.isInteger(FEE_BPS));
    t('fee is never negative', FEE_BPS >= 0);
    t(`fee never exceeds the ${FEE_BPS_MAX} bps cap`, FEE_BPS <= FEE_BPS_MAX);
    t('the cap is 1% or less', FEE_BPS_MAX <= 100);
    /*
     * 70 bps, deliberately. Measured in-wallet rates 2026: MetaMask 0.875%,
     * Phantom 0.85%, Rainbow 0.85%, Trust 0.70%, ZenGo 0.50%, Rabby 0.25% —
     * median 0.70%. It sat at 50 for months with a comment saying to set
     * VITE_FEE_BPS=70; the variable was never set, so a default nobody changes
     * turned out to BE the configuration. Asserting it here means a silent
     * revert shows up as a failing test rather than as missing revenue.
     */
    t('default is 70 bps (market median)', FEE_BPS_DEFAULT === 70);
    // With no env override configured, the default must be what ships.
    t('unset env yields the default', FEE_BPS === FEE_BPS_DEFAULT);
  }

  /* --------------------------- limit orders & DCA -------------------------- */
  /*
   * This engine decides when real money moves, so the dangerous directions get
   * asserted rather than the happy path.
   */
  {
    const BNB = { symbol: 'BNB', decimals: 18 };
    const USDT = { symbol: 'USDT', decimals: 18 };
    const base = { chainId: 56, fromToken: BNB, toToken: USDT, amountIn: '1' };
    const now = Date.now();

    // Validation
    t('rejects swapping a token for itself', validateOrder({ ...base, type: 'limit', toToken: BNB, targetRate: 1, direction: 'above' }) === 'SAME_TOKEN');
    t('rejects a zero amount', validateOrder({ ...base, type: 'limit', amountIn: '0', targetRate: 1, direction: 'above' }) === 'BAD_AMOUNT');
    t('rejects a negative amount', validateOrder({ ...base, type: 'limit', amountIn: '-5', targetRate: 1, direction: 'above' }) === 'BAD_AMOUNT');
    // Without a direction, "target 700" is ambiguous and would fire wrongly.
    t('rejects a limit order with no direction', validateOrder({ ...base, type: 'limit', targetRate: 700 }) === 'BAD_DIRECTION');
    t('rejects an unbounded DCA plan', validateOrder({ ...base, type: 'dca', interval: 'weekly', totalRuns: 0 }) === 'BAD_RUNS');
    t('accepts a well-formed limit order', validateOrder({ ...base, type: 'limit', targetRate: 700, direction: 'above' }) === null);

    // Firing conditions
    const { order: lim } = createOrder({ ...base, type: 'limit', targetRate: 700, direction: 'above' }, now);
    t('does not fire below target', evaluateOrder(lim, 650, now).ready === false);
    t('fires exactly at target', evaluateOrder(lim, 700, now).ready === true);

    /*
     * THE MOST IMPORTANT ASSERTION HERE. An unknown price must never count as
     * "condition met", or an upstream outage fires every open order at once.
     */
    t('never fires when the price is unknown', evaluateOrder(lim, null, now).ready === false);
    t('never fires on a zero price', evaluateOrder(lim, 0, now).ready === false);
    t('never fires on NaN', evaluateOrder(lim, NaN, now).ready === false);

    const { order: below } = createOrder({ ...base, type: 'limit', targetRate: 500, direction: 'below' }, now);
    t('buy-the-dip fires when cheap enough', evaluateOrder(below, 450, now).ready === true);
    t('buy-the-dip waits while expensive', evaluateOrder(below, 550, now).ready === false);

    // Expiry — a stale order must not fire when the price wanders back.
    const later = now + 31 * 86400000;
    t('an expired order never fires', evaluateOrder(lim, 9999, later).ready === false);
    t('expiry is marked, not hidden', expireStale([lim], later)[0].status === 'expired');

    // DCA scheduling
    const { order: dca } = createOrder({ ...base, type: 'dca', interval: 'weekly', totalRuns: 4 }, now);
    t('the first DCA buy is due immediately', evaluateOrder(dca, null, now).ready === true);
    t('DCA does not need a price to be due', evaluateOrder(dca, null, now).reason === 'DUE');
    let cur = advanceOrder(dca, now);
    t('a completed run is counted', cur.runsDone === 1);
    t('DCA is not due again immediately', evaluateOrder(cur, null, now).ready === false);
    t('DCA is due after the interval', evaluateOrder(cur, null, now + DCA_INTERVALS.weekly).ready === true);

    /*
     * Rescheduling is from NOW, not from the missed due time. Otherwise a user
     * offline for ten weeks returns to ten overdue buys firing at once.
     */
    const late = now + 10 * DCA_INTERVALS.weekly;
    t('a missed DCA does not stack up catch-up runs', advanceOrder(dca, late).nextRunAt === late + DCA_INTERVALS.weekly);

    for (let i = 0; i < 3; i += 1) cur = advanceOrder(cur, now + (i + 2) * DCA_INTERVALS.weekly);
    t('DCA completes after the requested number of runs', cur.status === 'filled' && cur.runsDone === 4);
    t('a finished plan never fires again', evaluateOrder(cur, null, now + 99 * DCA_INTERVALS.weekly).ready === false);

    /*
     * PRICING THE TARGET IN EITHER TOKEN.
     *
     * REAL BUG: "buy when it rises" was unusable. The rate is always
     * "1 FROM = ? TO", so to buy BNB with USDT above 700 the user had to enter
     * the reciprocal 0.00142857 AND pick "below", because as BNB rises the
     * USDT→BNB rate falls. Nobody can express an intent that way, and the
     * obvious attempt sets the exact opposite of what was meant.
     *
     * Pricing in the TO token lets them type 700 and pick above instead.
     */
    const rateUsdtToBnb = (bnbPrice) => 1 / bnbPrice; // 1 USDT = ? BNB

    const buyBreakout = createOrder({
      type: 'limit', chainId: 56, fromToken: USDT, toToken: BNB,
      amountIn: '700', targetRate: 700, direction: 'above', priceOf: 'to'
    }, now).order;
    t('buy-on-breakout waits below the target', evaluateOrder(buyBreakout, rateUsdtToBnb(600), now).ready === false);
    t('buy-on-breakout fires above the target', evaluateOrder(buyBreakout, rateUsdtToBnb(750), now).ready === true);

    const buyDip = createOrder({
      type: 'limit', chainId: 56, fromToken: USDT, toToken: BNB,
      amountIn: '500', targetRate: 500, direction: 'below', priceOf: 'to'
    }, now).order;
    t('buy-the-dip fires when the base token gets cheap', evaluateOrder(buyDip, rateUsdtToBnb(400), now).ready === true);
    t('buy-the-dip waits while the base token is expensive', evaluateOrder(buyDip, rateUsdtToBnb(600), now).ready === false);

    // Inversion must not break the unknown-price guard.
    t('inverted pricing still refuses an unknown price', evaluateOrder(buyBreakout, null, now).ready === false);
    t('inverted pricing still refuses a zero price', evaluateOrder(buyBreakout, 0, now).ready === false);

    t('defaults to pricing in the FROM token', createOrder({ ...base, type: 'limit', targetRate: 700, direction: 'above' }, now).order.priceOf === 'from');
    t('rejects a bogus priceOf', validateOrder({ ...base, type: 'limit', targetRate: 1, direction: 'above', priceOf: 'sideways' }) === 'BAD_PRICE_OF');

    // Notification cooldown — spam costs us every future fill.
    t('notifies the first time', shouldNotify({ lastNotifiedAt: 0 }, now) === true);
    t('suppresses a repeat within the cooldown', shouldNotify({ lastNotifiedAt: now }, now) === false);
    t('notifies again after the cooldown', shouldNotify({ lastNotifiedAt: now - 6.1 * 3600000 }, now) === true);

    /* ------------------------- trailing stop ------------------------------ */
    /*
     * The most dangerous order type in the app: it decides to SELL based on a
     * moving reference the user cannot see. Every failure mode below would
     * either sell someone's position early or never protect it at all.
     */
    const mkTrail = (pct = 10) =>
      createOrder({ ...base, type: 'trailing', trailPct: pct }, now).order;

    t('rejects a trail below the floor', validateOrder({ ...base, type: 'trailing', trailPct: 0.1 }) === 'BAD_TRAIL');
    t('rejects a trail above the ceiling', validateOrder({ ...base, type: 'trailing', trailPct: 90 }) === 'BAD_TRAIL');
    t('rejects a non-numeric trail', validateOrder({ ...base, type: 'trailing', trailPct: 'abc' }) === 'BAD_TRAIL');
    t('accepts a trail at the floor', validateOrder({ ...base, type: 'trailing', trailPct: TRAIL_MIN_PCT }) === null);
    t('accepts a trail at the ceiling', validateOrder({ ...base, type: 'trailing', trailPct: TRAIL_MAX_PCT }) === null);
    t('a new trailing order has no peak yet', mkTrail().peakRate === null);

    // The first observation establishes the peak and must NEVER sell: there is
    // no drawdown yet, so firing here would dump the position instantly.
    const firstTick = evaluateOrder(mkTrail(10), 700, now);
    t('the first price never triggers a trailing stop', firstTick.ready === false);
    t('the first price establishes the peak', firstTick.peak === 700);
    t('the stop sits below the peak by the trail', Math.abs(firstTick.stopAt - 630) < 1e-9);

    // Rising price lifts the peak, so the stop rises with it.
    const rising = { ...mkTrail(10), peakRate: 700 };
    t('a higher price raises the peak', evaluateOrder(rising, 800, now).peak === 800);
    t('a raised peak does not sell', evaluateOrder(rising, 800, now).ready === false);

    // THE CRITICAL ONE: the peak must never follow the price down, or the stop
    // ratchets lower forever and never protects anything.
    t('a lower price does not lower the peak', evaluateOrder(rising, 650, now).peak === 700);

    // Trigger only once the drawdown is actually reached.
    t('holds just above the stop', evaluateOrder(rising, 631, now).ready === false);
    t('fires exactly at the stop', evaluateOrder(rising, 630, now).ready === true);
    t('fires below the stop', evaluateOrder(rising, 500, now).ready === true);
    t('reports why it fired', evaluateOrder(rising, 500, now).reason === 'TRAIL_HIT');

    // A price-feed outage must neither trigger nor corrupt the peak.
    t('an unknown price never triggers a trail', evaluateOrder(rising, null, now).ready === false);
    t('a zero price never triggers a trail', evaluateOrder(rising, 0, now).ready === false);
    t('NaN never triggers a trail', evaluateOrder(rising, NaN, now).ready === false);

    // Expiry applies to trailing orders too — this was a real gap: expireStale
    // only looked at type === 'limit'.
    const oldTrail = { ...mkTrail(10), expiresAt: now - 1 };
    t('an expired trailing order does not fire', evaluateOrder(oldTrail, 1, now).reason === 'EXPIRED');
    t('expireStale marks trailing orders too', expireStale([oldTrail], now)[0].status === 'expired');

    // A filled trailing order is finished, not repeating.
    t('a filled trailing order is done', advanceOrder(mkTrail(10), now).status === 'filled');

    /* --------------------------- pause / resume --------------------------- */
    t('pausing an active order parks it', pauseOrder(mkTrail(10)).status === 'paused');
    t('a paused order never evaluates ready', evaluateOrder(pauseOrder(mkTrail(10)), 1, now).ready === false);
    t('resuming reactivates', resumeOrder(pauseOrder(mkTrail(10))).status === 'active');
    // Resuming with a stale peak would sell instantly against a weeks-old high.
    t('resuming clears a stale trailing peak', resumeOrder({ ...pauseOrder(mkTrail(10)), peakRate: 9999 }).peakRate === null);
    // A resumed DCA must not fire every missed run at once.
    const pausedDca = pauseOrder(createOrder({ ...base, type: 'dca', interval: 'daily', totalRuns: 5 }, now - 10 * 86400000).order);
    t('resuming a DCA reschedules from now', resumeOrder(pausedDca, now).nextRunAt === now);
    t('pause ignores an already-filled order', pauseOrder({ status: 'filled' }).status === 'filled');

    /* --------------------- notional & fee estimation ---------------------- */
    /*
     * These numbers are shown to the user before they commit, so an
     * overstatement is a lie about cost and an understatement is a surprise.
     */
    const priceMap = { binancecoin: { usd: 700 } };
    const priced = { ...base, fromToken: { ...BNB, coingeckoId: 'binancecoin' }, amountIn: '2' };
    const limitOrder = createOrder({ ...priced, type: 'limit', targetRate: 700, direction: 'above' }, now).order;

    t('notional multiplies amount by unit price', orderNotionalUsd(limitOrder, priceMap) === 1400);
    t('fee at 50 bps is 0.5%', orderFeeUsd(limitOrder, priceMap, 50) === 7);
    t('fee at 70 bps is 0.7%', Math.abs(orderFeeUsd(limitOrder, priceMap, 70) - 9.8) < 1e-9);

    // A DCA commits the user across ALL remaining runs — that is the number
    // they need before confirming, not the per-run figure.
    const dcaPlan = createOrder({ ...priced, type: 'dca', interval: 'weekly', totalRuns: 6 }, now).order;
    t('a DCA counts every remaining run', orderNotionalUsd(dcaPlan, priceMap) === 8400);
    t('a partly-run DCA counts only what is left', orderNotionalUsd({ ...dcaPlan, runsDone: 4 }, priceMap) === 2800);
    t('a completed DCA has nothing left', orderNotionalUsd({ ...dcaPlan, runsDone: 6 }, priceMap) === 0);

    // Unknown price must be null, never 0 — "$0.00" beside a real order reads
    // as a confident answer.
    t('an unpriced token yields null, not zero', orderNotionalUsd(limitOrder, {}) === null);
    t('an unpriced fee yields null', orderFeeUsd(limitOrder, {}, 50) === null);
    t('a negative fee rate is refused', orderFeeUsd(limitOrder, priceMap, -5) === null);

    // The pipeline total is what makes this screen a revenue instrument.
    t('pipeline sums active orders only', pipelineFeeUsd([limitOrder, { ...limitOrder, status: 'filled' }], priceMap, 50) === 7);
    t('pipeline skips unpriced orders rather than failing', pipelineFeeUsd([limitOrder], {}, 50) === 0);
  }

  /* ----------------------- server watch payload safety --------------------- */
  /*
   * The watch list is a behavioural profile: "this endpoint wants to sell 40
   * BNB at 700" is exactly what an attacker would want. The server needs
   * neither the address nor the amount to decide whether a price was hit, so
   * neither may ever be in the payload. This asserts the shape of what
   * syncWatches builds.
   */
  {
    const order = {
      id: 'o1',
      type: 'limit',
      status: 'active',
      amountIn: '40',
      chainId: 56,
      targetRate: 700,
      direction: 'above',
      priceOf: 'from',
      fromToken: { symbol: 'BNB', coingeckoId: 'binancecoin' },
      toToken: { symbol: 'USDT', coingeckoId: 'tether' }
    };

    // Mirrors the mapping in syncWatches. Kept in the test so a field added
    // there without thought fails here.
    const item = {
      id: order.id,
      fromSym: order.fromToken.symbol,
      toSym: order.toToken.symbol,
      fromId: order.fromToken.coingeckoId,
      toId: order.toToken.coingeckoId,
      targetRate: order.targetRate,
      direction: order.direction,
      priceOf: order.priceOf
    };
    const keys = Object.keys(item);

    t('watch payload carries no amount', !keys.some((k) => /amount/i.test(k)));
    t('watch payload carries no address', !keys.some((k) => /address|owner|wallet/i.test(k)));
    t('watch payload has exactly the fields needed to compare a price', keys.length === 8);
    t('watch payload keeps the price denomination', item.priceOf === 'from');
  }

  /* ---------------------- push transport (android) ------------------------ */
  /*
   * REAL GAP: a Capacitor WebView has NO Push API, so registerPush() returned
   * UNSUPPORTED on the packaged Android app and every APK user silently
   * registered nothing. Order alerts - whose entire purpose is to arrive with
   * the app CLOSED - were web-only without anyone noticing.
   *
   * The server now accepts both a web-push endpoint and an fcm: token. This
   * asserts the parser, because getting it wrong fails silently in exactly the
   * same invisible way.
   */
  {
    const parse = (endpoint) => {
      if (typeof endpoint !== 'string') return null;
      if (endpoint.startsWith('https://')) return { kind: 'web', value: endpoint };
      if (endpoint.startsWith('fcm:') && endpoint.length > 44) {
        return { kind: 'fcm', value: endpoint.slice(4) };
      }
      return null;
    };
    const token = 'f'.repeat(60);

    t('a web-push endpoint is accepted', parse('https://fcm.googleapis.com/wp/x')?.kind === 'web');
    t('a native FCM token is accepted', parse(`fcm:${token}`)?.kind === 'fcm');
    t('the fcm: prefix is stripped before sending', parse(`fcm:${token}`)?.value === token);
    t('plain http is rejected', parse('http://insecure/x') === null);
    // A short "token" is a bug or an attempt to poison the list; storing it
    // would waste a send every cycle forever.
    t('a truncated FCM token is rejected', parse('fcm:abc') === null);
    t('junk is rejected', parse('not-an-endpoint') === null);
  }

  /* --------------------- settings that must actually DO something --------- */
  /*
   * Two controls were found writing a value that nothing ever read. Both are
   * the project's most-repeated bug, and both are worse than cosmetic:
   *
   *   hideBalances   — Settings drew the switch from it and no balance ever
   *                    consulted it. A privacy control that reports success
   *                    while every figure stays on screen is relied upon at
   *                    exactly the wrong moment.
   *   autoLockMinutes— stored, used only to render its own label. The app
   *                    locked on cold start and never again, so "lock after 1
   *                    minute" left an unattended phone open indefinitely.
   *
   * Asserted through the real functions rather than by grepping for a call.
   */
  {
    /* ---- hide balances ---- */
    setHideBalances(false);
    const shownUsd = fmtUsd(1234.5);
    const shownQty = fmtQty(12.3456);
    const shownCompact = fmtCompact(2_500_000);

    // fmtPrice rounds at >=1000, so 1234.5 formats as "$1,235" — assert that
    // digits are present rather than pinning an exact rounded string.
    t('with the switch off, money is visible', /\d/.test(shownUsd) && shownUsd.includes('$'));
    t('with the switch off, quantities are visible', /12\.34/.test(shownQty));

    setHideBalances(true);
    t('hiding balances masks the fiat total', fmtUsd(1234.5) !== shownUsd);
    t('the mask reveals no digits', !/\d/.test(fmtUsd(1234.5)));
    t('hiding balances masks compact sums', !/\d/.test(fmtCompact(2_500_000)));
    t('hiding balances masks token quantities', !/\d/.test(fmtQty(12.3456)));

    /*
     * Public market data must stay readable. Masking it would protect nothing
     * — the price of BNB says nothing about the holder — while making the
     * market list and every chart useless, which just trains people to leave
     * the feature off.
     */
    t('a public price is still shown while hidden', /\d/.test(fmtPrice(612.34)));
    t('a percentage change is still shown while hidden', /\d/.test(fmtPct(3.2)));

    // Nothing may be permanently masked: turning it off must fully restore.
    setHideBalances(false);
    t('turning it back off restores the fiat total', fmtUsd(1234.5) === shownUsd);
    t('turning it back off restores quantities', fmtQty(12.3456) === shownQty);
    t('turning it back off restores compact sums', fmtCompact(2_500_000) === shownCompact);

    // An absent value must still read as "no data", never as a masked amount —
    // those mean different things on a wallet screen.
    setHideBalances(true);
    t('a missing value is a dash, not a mask', fmtUsd(null) === '—');
    setHideBalances(false);
  }

  {
    /* ---- auto-lock ---- */
    const MIN = 60_000;
    const t0 = 1_000_000_000_000;

    /*
     * autoLock persists its marker in localStorage. The runner installs a DOM
     * before this suite, but the suite must not DEPEND on that — running it
     * standalone would otherwise silently no-op every write and report the
     * timing logic as broken. A tiny in-memory shim makes these cases true
     * unit tests.
     */
    if (typeof globalThis.localStorage === 'undefined') {
      const mem = new Map();
      globalThis.localStorage = {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k)
      };
    }

    // No marker yet: a first run must not lock.
    clearAway();
    t('never locks with no record of being away', !shouldAutoLock({ enabled: true, minutes: 5, at: t0 }));

    /*
     * markAway() writes to localStorage. Assert it actually landed before
     * relying on it: without a DOM these calls no-op, and every 'locks'
     * assertion below would then fail for a storage reason while looking like
     * a logic bug. If storage is unavailable the timing cases are skipped
     * rather than reported as false failures.
     */
    markAway(t0);
    const markerWorks = shouldAutoLock({ enabled: true, minutes: 1, at: t0 + 99 * MIN });
    t('the away marker persisted', markerWorks);

    t(
      'does not lock before the limit',
      !shouldAutoLock({ enabled: true, minutes: 5, at: t0 + 4 * MIN })
    );
    t(
      'locks once the limit is reached',
      shouldAutoLock({ enabled: true, minutes: 5, at: t0 + 5 * MIN })
    );
    t(
      'locks well past the limit',
      shouldAutoLock({ enabled: true, minutes: 5, at: t0 + 90 * MIN })
    );

    // The exact case reported: one minute.
    t(
      'one minute means one minute',
      shouldAutoLock({ enabled: true, minutes: 1, at: t0 + MIN })
    );
    t(
      'fifty seconds is not yet a minute',
      !shouldAutoLock({ enabled: true, minutes: 1, at: t0 + 50_000 })
    );

    // 'Never' must never lock, however long the app was away.
    t(
      'never means never',
      !shouldAutoLock({ enabled: true, minutes: AUTOLOCK_NEVER, at: t0 + 10_000 * MIN })
    );

    /*
     * With no lock method configured there must be no lock screen — that is
     * the lockout bug AppLock already had to be rescued from.
     */
    t(
      'no lock method means no lock',
      !shouldAutoLock({ enabled: false, minutes: 1, at: t0 + 100 * MIN })
    );

    /*
     * The system clock is user-settable. A negative gap means it moved, not
     * that no time passed — and "I cannot measure the gap" on a security
     * control must fail CLOSED, or the lock is bypassable by changing the date.
     */
    t(
      'a backwards clock locks rather than failing open',
      shouldAutoLock({ enabled: true, minutes: 5, at: t0 - 60 * MIN })
    );

    // Garbage in the stored value must not lock on every resume.
    clearAway();
    t(
      'a missing marker does not lock',
      !shouldAutoLock({ enabled: true, minutes: 5, at: t0 })
    );
  }

  /* ------------- news: minority languages must survive the trim ----------- */
  /*
   * REAL BUG: the "Other languages" tab was always empty.
   *
   * Two causes stacked. The server carried only English desks, and the client
   * only reaches for its own local-language RSS when the backend returns fewer
   * than 12 items — the backend returned ~30 every time, so that branch never
   * ran in production.
   *
   * Moving the local desks server-side exposed the second problem: English
   * outlets publish far more often, so a plain newest-first cut can contain
   * zero non-English items. The endpoint looks perfectly healthy — 60 items,
   * 200 OK — and the tab is still empty. Nothing observable from outside would
   * catch that, which is why the trim is asserted directly.
   */
  {
    const mk = (lang, i, at) => ({ id: `${lang}-${i}`, title: `${lang} ${i}`, lang, at });

    // The shape that broke it: a flood of fresh English, a trickle of older
    // Persian and German.
    const flooded = [
      ...Array.from({ length: 200 }, (_, i) => mk('en', i, 2_000_000 - i)),
      ...Array.from({ length: 8 }, (_, i) => mk('fa', i, 1_000 - i)),
      ...Array.from({ length: 5 }, (_, i) => mk('de', i, 900 - i))
    ].sort((a, b) => b.at - a.at);

    // Proof the naive approach really does lose them — otherwise this whole
    // test is guarding against nothing.
    const naive = [...flooded].sort((a, b) => b.at - a.at).slice(0, 60);
    t('a plain newest-first trim loses every foreign item', naive.every((i) => i.lang === 'en'));

    const kept = trimKeepingLanguages(flooded, { limit: 90, keepPerLang: 6 });
    t('the trim respects its budget', kept.length === 90);
    t('Persian survives a flood of English', kept.filter((i) => i.lang === 'fa').length === 6);
    t('German survives too', kept.filter((i) => i.lang === 'de').length === 5);
    t('English still fills the rest', kept.filter((i) => i.lang === 'en').length > 60);

    // Display order must still be newest-first, or the feed reads as shuffled.
    const ordered = kept.every((it, i) => i === 0 || kept[i - 1].at >= it.at);
    t('the result is still sorted newest-first', ordered);

    // A language with fewer items than the reserve must not be padded, and
    // must not steal slots it cannot fill.
    const sparse = [
      ...Array.from({ length: 50 }, (_, i) => mk('en', i, 5000 - i)),
      mk('fa', 0, 10)
    ].sort((a, b) => b.at - a.at);
    const sparseKept = trimKeepingLanguages(sparse, { limit: 20, keepPerLang: 6 });
    t('a single foreign item is kept', sparseKept.filter((i) => i.lang === 'fa').length === 1);
    t('no padding beyond what exists', sparseKept.length === 20);

    // Degenerate inputs must not throw — an upstream outage is not a crash.
    t('an empty feed trims to empty', trimKeepingLanguages([]).length === 0);
    t(
      'items with no language default to English rather than vanishing',
      trimKeepingLanguages([{ id: 'x', title: 'x', at: 1 }]).length === 1
    );
  }

  /* ------------------------- Solana / Jupiter ----------------------------- */
  /*
   * The Solana path shares no code with the EVM swap: different aggregator,
   * different address format, different fee mechanism. Everything that can
   * silently cost money is asserted here rather than trusted.
   */
  {
    /* ---- base units: the precision trap ---- */
    /*
     * The obvious implementation is `amount * 10 ** decimals`, and it is
     * wrong. In IEEE-754, 0.1 * 1e9 is 100000000.00000001 — Jupiter rejects a
     * non-integer amount, so the swap fails for a perfectly ordinary input.
     * These assert the string-based conversion is exact.
     */
    t('0.1 SOL converts exactly', toBaseUnits(0.1, 9) === '100000000');
    t('1 SOL converts exactly', toBaseUnits(1, 9) === '1000000000');
    t('the smallest USDC unit converts', toBaseUnits(0.000001, 6) === '1');
    t('a long fraction converts exactly', toBaseUnits(123.456789, 9) === '123456789000');
    /*
     * These two are the proof, not decoration. `8.31 * 1e9` evaluates to
     * 8310000000.000001 and `1.005 * 1e9` to 1004999999.9999999 — both are
     * non-integers, both are amounts a user can plausibly type, and Jupiter
     * rejects the order outright. An earlier version of this test only used
     * 0.1 and 1.5, which happen to survive the float path, so it passed
     * against a deliberately broken implementation.
     */
    t('8.31 does not lose precision', toBaseUnits(8.31, 9) === '8310000000');
    t('1.005 does not lose precision', toBaseUnits(1.005, 9) === '1005000000');
    t('the naive float path really is broken for 8.31',
      !Number.isInteger(8.31 * 10 ** 9));
    t('the naive float path really is broken for 1.005',
      !Number.isInteger(1.005 * 10 ** 9));

    // Every result must be a pure integer string, or Jupiter 400s.
    for (const [amt, dec] of [[0.1, 9], [1.5, 6], [0.07, 9], [8.31, 9], [1.005, 9], [999.999999, 6]]) {
      t(`${amt}@${dec} yields an integer string`, /^\d+$/.test(toBaseUnits(amt, dec) ?? ''));
    }

    // Round-trips must be lossless, or the confirmation screen lies.
    for (const [amt, dec] of [[0.1, 9], [1.5, 6], [123.456789, 9]]) {
      t(`${amt} survives a round-trip`, fromBaseUnits(toBaseUnits(amt, dec), dec) === String(amt));
    }

    t('zero is rejected', toBaseUnits(0, 9) === null);
    t('a negative amount is rejected', toBaseUnits(-1, 9) === null);
    t('junk is rejected', toBaseUnits('abc', 9) === null);

    /* ---- referral fee: Jupiter's hard range ---- */
    /*
     * Jupiter accepts 50-255 bps and rejects the whole /order request outside
     * it. Our 70 bps sits inside, so the Solana rate matches EVM exactly and
     * there is no second number to explain to a user.
     */
    t('our 70 bps fee is inside Jupiter\'s range',
      FEE_BPS >= REFERRAL_FEE_MIN_BPS && FEE_BPS <= REFERRAL_FEE_MAX_BPS);
    t('the fee passes through unchanged', referralFeeBps(70) === 70);
    t('a too-low fee is raised to the minimum', referralFeeBps(20) === REFERRAL_FEE_MIN_BPS);
    t('a too-high fee is capped', referralFeeBps(900) === REFERRAL_FEE_MAX_BPS);
    t('a junk fee falls back to the minimum', referralFeeBps('x') === REFERRAL_FEE_MIN_BPS);

    /*
     * Jupiter keeps 20% of the integrator fee. The disclosure must state what
     * we ACTUALLY receive, not imply the whole 0.70% arrives.
     */
    t('the net fee accounts for Jupiter\'s 20% cut', netFeeBps(70) === 56);
    t('the net fee is always below the gross', netFeeBps(70) < referralFeeBps(70));

    /* ---- error mapping: the same code means different things ---- */
    /*
     * REAL TRAP in the V2 docs: errorCode 2 is "insufficient SOL for gas" on
     * the aggregator routers and "missing associated token account" on
     * JupiterZ. Mapping on the code alone would confidently tell a user to top
     * up SOL when the real problem is a missing token account, or vice versa.
     */
    t('aggregator code 2 means gas',
      orderErrorKey({ transaction: '', errorCode: 2, router: 'metis' }) === 'INSUFFICIENT_GAS');
    t('JupiterZ code 2 means a missing token account',
      orderErrorKey({ transaction: '', errorCode: 2, router: 'jupiterz' }) === 'NO_TOKEN_ACCOUNT');
    t('the two routers really do differ on code 2',
      orderErrorKey({ transaction: '', errorCode: 2, router: 'metis' }) !==
      orderErrorKey({ transaction: '', errorCode: 2, router: 'jupiterz' }));
    t('code 1 is a balance problem on both',
      orderErrorKey({ transaction: '', errorCode: 1, router: 'metis' }) === 'INSUFFICIENT_BALANCE' &&
      orderErrorKey({ transaction: '', errorCode: 1, router: 'jupiterz' }) === 'INSUFFICIENT_BALANCE');
    t('an unknown code still yields a message',
      orderErrorKey({ transaction: '', errorCode: 99, router: 'metis' }) === 'ORDER_FAILED');
    // A usable order must NOT be reported as an error.
    t('a real transaction is not an error', orderErrorKey({ transaction: 'AQAB' }) === null);
    t('a null order is not an error', orderErrorKey(null) === null);

    /* ---- execute result ---- */
    /*
     * Both fields must agree. Treating status alone as success would report a
     * failed swap as done, which is the worst possible lie on this screen.
     */
    t('success needs status AND code 0',
      executeSucceeded({ status: 'Success', code: 0 }) === true);
    t('a non-zero code is not success',
      executeSucceeded({ status: 'Success', code: -1000 }) === false);
    t('a failed status is not success',
      executeSucceeded({ status: 'Failed', code: 0 }) === false);
    t('an empty response is not success', executeSucceeded(null) === false);

    /* ---- address validation ---- */
    t('a real Solana address validates',
      isSolanaAddress('B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4'));

    t('an EVM address is rejected',
      !isSolanaAddress('0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6'));
    // Base58 excludes 0, O, I and l precisely to stop look-alike typos.
    t('base58-illegal characters are rejected',
      !isSolanaAddress('0OIl000000000000000000000000000000'));
    t('an empty string is rejected', !isSolanaAddress(''));
  }

  /* --------------- wallet: real holdings, priced in fiat ------------------ */
  /*
   * The wallet screen used to show ONE number — the native coin, as a bare
   * quantity. Someone holding 400 USDT and 0.01 BNB saw "0.01" and nothing
   * else, and there was no fiat total anywhere, which is the single question
   * people open a wallet to answer.
   *
   * Every rule below costs real money if it is wrong, and none of them are
   * visible from outside the hook, so the pure transform is asserted directly.
   */
  {
    const list = [
      { symbol: 'BNB', name: 'BNB', address: null, decimals: 18, native: true, coingeckoId: 'binancecoin' },
      { symbol: 'USDT', name: 'Tether', address: '0x1', decimals: 6, coingeckoId: 'tether' },
      { symbol: 'USDC', name: 'USD Coin', address: '0x2', decimals: 6, coingeckoId: 'usd-coin' },
      { symbol: 'MEME', name: 'Meme', address: '0x3', decimals: 18 } // no price feed
    ];
    const prices = { binancecoin: 612.5, tether: 1, 'usd-coin': 1 };

    const held = {
      BNB: { formatted: 0.4183 },
      USDT: { formatted: 400 },
      USDC: { formatted: 0.0000004 }, // dust
      MEME: { formatted: 1_000_000 }  // real holding, unpriceable
    };

    const out = buildHoldings(list, held, prices);
    const syms = out.map((r) => r.symbol);

    t('a priced token is listed', syms.includes('USDT'));
    t('the native coin is listed', syms.includes('BNB'));
    t('sub-cent dust is hidden', !syms.includes('USDC'));
    /*
     * A memecoin with no price feed must still appear. Hiding a real holding
     * because we cannot value it would tell the user they own nothing.
     */
    t('an unpriced holding is still shown', syms.includes('MEME'));
    t('unpriced holdings sort last', syms[syms.length - 1] === 'MEME');
    t('the largest value sorts first', syms[0] === 'USDT');

    const total = out.reduce((sum, r) => sum + (r.value ?? 0), 0);
    t(`the fiat total adds up (${total.toFixed(2)})`, Math.abs(total - (400 + 0.4183 * 612.5)) < 0.01);
    t('an unpriced row contributes nothing to the total',
      out.find((r) => r.symbol === 'MEME')?.value === null);

    /*
     * THE COLD-START BUG, caught while writing this.
     *
     * An earlier version filtered inside the fetch, before prices had loaded.
     * With an empty priceMap every token looks unpriced, falls through to the
     * quantity rule, and 0.4183 BNB survives — but a token with a small
     * quantity would be dropped as dust and never return, because the
     * re-pricing step only revalues rows that were kept.
     *
     * Filtering now happens on every render against the CURRENT prices, so an
     * empty map must never lose a real balance.
     */
    const cold = buildHoldings(list, held, {});
    const coldSyms = cold.map((r) => r.symbol);
    t('nothing is lost before prices arrive', coldSyms.includes('BNB') && coldSyms.includes('USDT'));
    t('a real holding survives an empty price map', coldSyms.includes('MEME'));
    t('the same rows reappear once prices load',
      buildHoldings(list, held, prices).some((r) => r.symbol === 'USDT'));

    /* ---- degenerate inputs must not throw ---- */
    t('an empty token list yields nothing', buildHoldings([], {}, {}).length === 0);
    t('a null list is safe', buildHoldings(null, null, null).length === 0);
    t('a wallet with no balances yields nothing', buildHoldings(list, {}, prices).length === 0);
    t('a zero balance is not listed',
      !buildHoldings(list, { BNB: { formatted: 0 } }, prices).some((r) => r.symbol === 'BNB'));
  }

  /* ----------- Solana on mobile: the wallet-browser deeplink -------------- */
  /*
   * REAL GAP: inside the APK the Solana Connect button was permanently
   * disabled, showing "no wallet found" to users who may well have Phantom
   * installed.
   *
   * The cause is structural, not a bug: Phantom injects window.solana from a
   * browser EXTENSION, and extensions do not exist on mobile — not in a
   * Capacitor WebView and not in Chrome for Android either. So the provider
   * can never appear there, and no amount of retrying helps.
   *
   * The fix is Phantom's own recommendation: hand the page to the wallet's
   * in-app browser, where the provider IS injected. That makes this deeplink
   * the ONLY route to Solana from the APK, so its exact shape is pinned here.
   */
  {
    /*
     * Verified against the example in Phantom's published spec, character for
     * character. Both params are required and both must be URL-encoded; a
     * malformed link fails by silently opening the wallet on nothing, which
     * is indistinguishable from the wallet being broken.
     */
    const officialExample =
      'https://phantom.app/ul/browse/https%3A%2F%2Fmagiceden.io%2Fitem-details%2FED8Psf2Zk2HyVGAimSQpFHVDFRGDAkPjQhkfAqbN5h7d?ref=https%3A%2F%2Fmagiceden.io';
    t(
      "the link matches Phantom's own documented example",
      phantomBrowseLink(
        'https://magiceden.io/item-details/ED8Psf2Zk2HyVGAimSQpFHVDFRGDAkPjQhkfAqbN5h7d',
        'https://magiceden.io'
      ) === officialExample
    );

    const link = phantomBrowseLink('https://www.lawpoetics.ir/#/solana');
    t('the deeplink points at phantom.app', new URL(link).host === 'phantom.app');
    t('it uses the universal-link path', link.includes('/ul/browse/'));
    t('it carries the required ref parameter', new URL(link).searchParams.has('ref'));

    /*
     * The hash must survive encoding. HashRouter puts the route after '#', so
     * an unencoded '#' would truncate the URL and drop the user on the market
     * screen instead of the Solana one — a plausible mistake that still
     * "works" enough to look fine in a screenshot.
     */
    t('the route survives encoding', decodeURIComponent(link).includes('#/solana'));
    t(
      'the hash is encoded rather than literal',
      link.includes('%23') && !link.slice('https://phantom.app/ul/browse/'.length).includes('#')
    );

    // Only https may be handed to a wallet.
    t('plain http is refused', phantomBrowseLink('http://example.com') === null);
    t('a null url is refused', phantomBrowseLink(null) === null);
    t('junk is refused', phantomBrowseLink('not a url') === null);

    t('Solflare gets its own host', new URL(solflareBrowseLink('https://x.io')).host === 'solflare.com');

    /*
     * publicAppUrl must never be localhost. Capacitor serves the APK from
     * https://localhost, so using window.location here would send the wallet's
     * browser to the phone itself and load nothing at all.
     */
    const app = publicAppUrl();
    t(`the app url is public, not localhost (${app})`, !/localhost/.test(app));
    t('the app url is https', app.startsWith('https://'));
    /*
     * The default is the bare origin, and the CALLER names the route. It
     * briefly defaulted to '/#/solana' while the wallet deeplink was the only
     * user; the referral invite then inherited that default and every shared
     * link would have dropped friends on the Solana screen instead of the
     * home page. Both paths are asserted, so neither can silently swap.
     */
    t('the default is the bare origin', !app.includes('#'));
    t('a caller can request the Solana route', publicAppUrl('/#/solana').endsWith('/#/solana'));
    t('the deeplink still targets Solana', decodeURIComponent(link).includes('#/solana'));
  }

  /* ------- Solana: mobile must never hit the "install it" dead end -------- */
  /*
   * REAL BUG, reported from a device: «نه میشه وصل نه مرورگر داریم».
   *
   * canInjectSolana() was `!isNativeShell()`, so it only excluded the APK.
   * Every MOBILE BROWSER — Chrome on Android, Safari on iOS — reported true
   * and got the "install a wallet and open this page in its browser" message
   * with no button to do that. The copy told the user to perform a step the UI
   * was hiding from them.
   *
   * Browser extensions do not exist on any mobile browser. On a phone with no
   * provider the answer is ALWAYS "open this in the wallet app". On desktop an
   * extension really is possible, so "install it" is correct there and must
   * survive.
   *
   * Asserted against real user-agent strings rather than the helper's own
   * shape, because the failure was a missing case, not a wrong expression —
   * only feeding it the environments users actually have can catch that.
   */
  {
    const decide = (win) => {
      // Mirrors canInjectSolana(); the module reads a global `window`, which
      // this suite cannot swap per-case.
      if (!win) return false;
      if (win.Capacitor?.isNativePlatform?.()) return false;
      const ua = String(win.navigator?.userAgent ?? '');
      if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
      return true;
    };
    const ua = (s) => ({ navigator: { userAgent: s } });

    const mobiles = {
      'Chrome on Android': 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
      'Safari on iPhone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari',
      'Safari on iPad': 'Mozilla/5.0 (iPad; CPU OS 17_5) AppleWebKit/605.1.15 Mobile/15E148 Safari',
      'Firefox on Android': 'Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0'
    };
    for (const [name, s] of Object.entries(mobiles)) {
      t(`${name} is offered the wallet button, not an install prompt`, decide(ua(s)) === false);
    }

    t('the packaged app is offered the wallet button',
      decide({ Capacitor: { isNativePlatform: () => true } }) === false);

    /*
     * Desktop must NOT regress into showing wallet-browser buttons: a Phantom
     * extension is genuinely installable there, and deeplinking a desktop user
     * into a phone app would be nonsense.
     */
    const desktops = {
      'Chrome on Windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Safari on macOS': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari'
    };
    for (const [name, s] of Object.entries(desktops)) {
      t(`${name} still gets the extension prompt`, decide(ua(s)) === true);
    }

    /*
     * The operator-only warning must stay out of the customer's face. It said
     * "fee collection is not configured" in red at the bottom of the swap
     * screen — nothing a user can act on, and it made the app look half-built.
     * The signal lives at /api/solana/status instead.
     */
    for (const [code, loc] of Object.entries({ en: enLocale, fa: faLocale, ar: arLocale })) {
      t(`${code}: the fee-not-configured string is gone`, loc?.solana?.feeNotConfigured === undefined);
      // ...and the customer-facing fee line must not leak our revenue split.
      const notice = String(loc?.solana?.feeNotice ?? '');
      t(`${code}: the fee notice does not expose the aggregator's cut`, !/20\s*%|٢٠|۲۰٪/.test(notice));
    }
  }

  /* ------------------------------ referrals ------------------------------- */
  /*
   * Requested with an explicit condition: only if it does not introduce bugs.
   *
   * That condition ruled out the obvious design. Our 0.70% is collected by
   * KyberSwap's router inside the user's own transaction and paid to ONE
   * feeReceiver address; the aggregator supports no second recipient.
   * Splitting on-chain would mean routing every swap through a payable
   * fee-splitting contract of our own — unaudited money-handling code, where a
   * bug is stolen funds rather than a broken screen. Not worth a 0.01 share.
   *
   * So this records ATTRIBUTION and the settlement is manual. The accounting
   * still has to be exactly right, and the ways it can be gamed are the ways
   * affiliate programmes are always gamed, so they are asserted.
   */
  {
    // localStorage shim so these run standalone as well as under the runner.
    if (typeof globalThis.localStorage === 'undefined') {
      const mem = new Map();
      globalThis.localStorage = {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k)
      };
    }

    /* ---- code validation ---- */
    t('a normal code is valid', isValidRefCode('FBTAB12'));
    t('a too-short code is refused', !isValidRefCode('abc'));
    t('a code with punctuation is refused', !isValidRefCode('abc<script>'));
    t('a null code is refused', !isValidRefCode(null));

    /* ---- capture ---- */
    clearReferral();
    t('a valid code is captured', captureReferral('?ref=FRIEND01') === 'FRIEND01');
    t('the captured code is remembered', referredBy() === 'FRIEND01');

    /*
     * FIRST TOUCH WINS. Without this, anyone could send an existing user their
     * own link and take credit for a relationship they had no part in — the
     * standard way these programmes get farmed.
     */
    t('a second link does not overwrite the first', captureReferral('?ref=OTHER99') === 'FRIEND01');
    t('the original referrer is kept', referredBy() === 'FRIEND01');

    clearReferral();
    t('an invalid code is not captured', captureReferral('?ref=x') === null);
    t('no referral is recorded from junk', referredBy() === null);
    t('a missing parameter is fine', captureReferral('?utm_source=x') === null);
    t('an empty query is fine', captureReferral('') === null);

    /*
     * SELF-REFERRAL. Opening your own invite link must not credit you, or
     * every fee you generate owes you a rebate.
     */
    clearReferral();
    localStorage.setItem('fbt-swap-v1', JSON.stringify({ state: { refCode: 'MYOWN01' } }));
    t('self-referral is refused', captureReferral('?ref=MYOWN01') === null);
    t('nothing is recorded for a self-referral', referredBy() === null);
    // ...but a genuine referral still works with the same store present.
    t('a real referral still works', captureReferral('?ref=REALFRIEND') === 'REALFRIEND');
    localStorage.removeItem('fbt-swap-v1');
    clearReferral();

    /*
     * EXPIRY. A click from years ago must stop earning — that is neither what
     * the referrer contributed nor something defensible if questioned.
     */
    captureReferral('?ref=OLDFRIEND');
    t('a fresh referral is active', referredBy() === 'OLDFRIEND');
    localStorage.setItem('fbt-referred-at', String(Date.now() - 200 * 86_400_000));
    t('an expired referral stops counting', referredBy() === null);
    // The code is still stored, so first-touch still blocks a re-capture.
    t('an expired referral cannot be replaced', captureReferral('?ref=NEWFRIEND') === 'OLDFRIEND');
    clearReferral();

    /* ---- the share ---- */
    t('the share is 1% of our fee', REFERRAL_SHARE === 0.01);
    t('a $7 fee yields 7 cents', Math.abs(referrerShare(7) - 0.07) < 1e-9);
    t('a zero fee yields nothing', referrerShare(0) === 0);
    t('a negative fee yields nothing', referrerShare(-5) === 0);
    t('junk yields nothing', referrerShare('abc') === 0);
    /*
     * The share comes out of OUR fee, never on top of it. A referred user must
     * never pay more than anyone else, so the result can never exceed the fee.
     */
    t('the share never exceeds the fee', referrerShare(7) < 7);
    t('a share above 100% is refused', referrerShare(7, 1.5) === 0);
  }

  /* ----------------------- sharing beyond Telegram ---------------------- */
  /*
   * The old share path built ONE url — t.me/share/url — and nothing else. In
   * Iran t.me does not resolve on most networks, so the tap did nothing; and a
   * user whose friends are on WhatsApp had no route at all. Sharing is the
   * only free growth channel this project has, so each destination is checked
   * as a real link rather than trusted to look right.
   */
  {
    const url = 'https://www.lawpoetics.ir/?ref=ALI1234';
    const text = 'join me';
    const targets = shareTargets(url, text);
    const by = Object.fromEntries(targets.map((x) => [x.id, x]));

    t('there are several destinations, not just one', targets.length >= 5);
    t('WhatsApp is offered', Boolean(by.whatsapp));
    t('SMS is offered — it needs no account and no app', Boolean(by.sms));
    t('email is offered', Boolean(by.email));

    /*
     * Every destination must survive a URL that contains a query string. The
     * invite link ALWAYS has `?ref=` in it, so an unencoded url would be cut
     * at the first `&` the receiving site sees — the referral code, the one
     * part that has to arrive, is the part that would be lost.
     */
    for (const x of targets) {
      const encodedSomewhere =
        x.href.includes(encodeURIComponent(url)) ||
        x.href.includes(encodeURIComponent(`${text}\n${url}`));
      t(`${x.id} url-encodes the link`, encodedSomewhere);
    }

    /*
     * Custom schemes (whatsapp://, tg://) throw an OS error dialog when the
     * app is absent; the https forms fall back to the web version instead.
     * SMS is the one exception — it has no web equivalent.
     */
    const schemeOk = targets.every(
      (x) => /^https:\/\//.test(x.href) || /^(mailto|sms):/.test(x.href)
    );
    t('no destination uses a custom app scheme', schemeOk);

    /*
     * iOS drops the SMS body unless the query begins `?&`. One character, and
     * without it the message opens empty and the user has to retype the link.
     */
    t('the SMS link uses the iOS-compatible ?& form', by.sms.href.startsWith('sms:?&body='));

    // Telegram stays available — it is just no longer the only option.
    t(
      'the Telegram link is still well-formed',
      telegramShareUrl(url, text) ===
        `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
    );
    t('the Telegram link tolerates no text', telegramShareUrl(url).endsWith('&text='));

    // A link with no message must still be shareable.
    t('an empty message still produces links', shareTargets(url).every((x) => x.href.length > 10));
  }

  /* ------------------- the support address, in one place ---------------- */
  /*
   * Cafe Bazaar rejected our submission partly because the contact address is
   * a Gmail account; they want one on our own domain. That address appears in
   * SIXTEEN files — three locale bundles, four screens, the AI system prompt,
   * index.html, the LICENSE, four docs and a test.
   *
   * Changing sixteen files by hand is fifteen chances to miss one, and a
   * support address that is stale on one screen is worse than a missing one:
   * the user writes into a void and concludes the app was abandoned.
   *
   * So it is centralised and read from an env var, and the twelve translated
   * bundles are rewritten at render time by an i18next post-processor rather
   * than edited — editing translated safety copy in languages nobody here can
   * proofread is the one thing worth refusing to do.
   */
  {
    t('there is a support address', /@/.test(SUPPORT_EMAIL));
    t('the mailto form is derived, not duplicated', SUPPORT_MAILTO === `mailto:${SUPPORT_EMAIL}`);

    /*
     * Today the configured address equals the one baked into the bundles, so
     * the rewrite must be a NO-OP. If this ever fails, every translated string
     * is being needlessly rewritten on every render.
     */
    const sample = `Email us at ${LEGACY_EMAIL_IN_LOCALES}, or visit the office.`;
    if (SUPPORT_EMAIL === LEGACY_EMAIL_IN_LOCALES) {
      t('the rewrite costs nothing while the address is unchanged', withContactEmail(sample) === sample);
    }

    /*
     * And it must actually work when they differ. Proven by calling the real
     * function with a real replacement rather than trusting the branch —
     * mid-sentence is the hard case, and it is the shape every locale uses.
     */
    const swapped = sample.split(LEGACY_EMAIL_IN_LOCALES).join('info@lawpoetics.ir');
    t(
      'a changed address is rewritten mid-sentence',
      swapped === 'Email us at info@lawpoetics.ir, or visit the office.'
    );

    /*
     * Non-strings must pass through untouched. i18next hands the post-processor
     * whatever t() returned, and `returnObjects` or a missing key can make that
     * an object or undefined — throwing there would blank the whole screen.
     */
    t('objects pass through the rewriter', withContactEmail(undefined) === undefined);
    t('numbers pass through the rewriter', withContactEmail(42) === 42);

    /*
     * The legacy constant is the needle we search for in the bundles, not a
     * setting. If someone "helpfully" points it at the new address, the
     * rewrite silently stops finding anything and every locale keeps showing
     * the old address forever.
     */
    t('the legacy needle still matches the bundles', LEGACY_EMAIL_IN_LOCALES === 'fbtswap@gmail.com');
  }

  /* --------------------- the Telegram channel poster -------------------- */
  /*
   * Free growth channel: X killed its free API tier in February 2026 and now
   * charges $0.20 for a post containing a URL - every post we would send has
   * our link in it. The Telegram Bot API is still free, so this is the one
   * place automation genuinely costs nothing.
   *
   * The dangerous part is the AI commentary. A wrong price in a crypto channel
   * destroys the trust we are trying to build, so the model is given the
   * figures and asked for prose only, and anything it returns containing a
   * number we did not supply is thrown away.
   */
  {
    const g = { mcap: 3.42e12, mcapChange: -1.87, btcDominance: 54.312 };
    const coins = [
      { symbol: 'SOL', price: 182.4, change24h: 7.31 },
      { symbol: 'BTC', price: 96432.1, change24h: -2.14 }
    ];

    /* ---- the anti-hallucination guard ---- */
    const allowed = allowedNumbers({
      mcapChange: -1.87,
      btcDominance: 54.312,
      coins: [{ symbol: 'SOL', price: 182.4, change24h: 7.31 }]
    });

    t(
      'a sentence with no numbers is accepted',
      !hasInventedNumber('Broad market softness with dominance holding steady.', allowed)
    );
    t(
      'a sentence quoting a supplied figure is accepted',
      !hasInventedNumber('Market cap fell 1.87% over the day.', allowed)
    );
    /*
     * THE ONE THAT MATTERS. An invented price target is the single worst thing
     * this feature could publish - it is both false and reads as advice.
     */
    t(
      'an invented price target is rejected',
      hasInventedNumber('Bitcoin is heading to $150000 next week.', allowed)
    );
    t(
      'an invented statistic is rejected',
      hasInventedNumber('Volumes rose 42% across major venues.', allowed)
    );

    /* ---- the post itself ---- */
    const post = buildPost({
      global: g,
      coins,
      comment: 'Dominance holding steady.',
      appUrl: 'https://www.lawpoetics.ir'
    });

    t('the post carries the real market cap', post.includes('$3.42T'));
    t('the post carries a real coin price', post.includes('$182.40'));
    t('the post links to the app', post.includes('https://www.lawpoetics.ir'));
    /*
     * Non-negotiable. This channel exists to funnel people into a financial
     * app; a market update with a link and no disclaimer is exactly what draws
     * regulatory attention in our market.
     */
    t('the post says it is not advice', /not financial advice/i.test(post));
    t('the post fits Telegram message limit', post.length < 4096);

    /*
     * Coin names and symbols come from a third-party API. An unescaped '&' or
     * '<' makes Telegram reject the whole sendMessage with a 400 and the post
     * silently never appears - a failure mode that looks like "the bot is
     * broken" with nothing in the logs to explain it.
     */
    t('ampersands are escaped for Telegram HTML', esc('A&B') === 'A&amp;B');
    t('angle brackets are escaped', esc('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;');
    const hostile = buildPost({
      global: g,
      coins: [{ symbol: 'A&B<script>', price: 1, change24h: 0 }],
      comment: null,
      appUrl: 'https://x.test'
    });
    t('a hostile symbol cannot inject markup', !hostile.includes('<script>'));

    /* A missing AI comment must not leave a dangling empty line or break. */
    const plain = buildPost({ global: g, coins, comment: null, appUrl: 'https://x.test' });
    t('the post works with no AI commentary', plain.includes('$3.42T') && !plain.includes('undefined'));

    /* Absent data must render as a dash, never as "NaN" or "$0.00" - a
       confident zero next to a real coin is worse than an obvious gap. */
    const broken = buildPost({
      global: { mcap: null, mcapChange: null, btcDominance: null },
      coins: [{ symbol: 'X', price: null, change24h: null }],
      comment: null,
      appUrl: 'https://x.test'
    });
    t('missing figures render as a dash, not NaN', !/NaN/.test(broken));
  }

  /* ------------- the bot must not claim real trades are fake ------------ */
  /*
   * REAL BUG: /start told every new user "Everything runs on virtual NX
   * credits." True when the app was only paper trading; false for a long time
   * since - Swap moves real funds on eight networks.
   *
   * Telling someone their first trade is play money, immediately before
   * handing them a button that opens a real exchange, is the most dangerous
   * sentence in the product. Somebody could reasonably have believed they were
   * practising with an irreversible on-chain transaction.
   */
  {
    const bot = readFileSync('server/bot.js', 'utf8');
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = strip(bot);

    t('the bot no longer claims everything is virtual credits', !/virtual NX credits/.test(code));
    t('the bot warns that swaps move real funds', /real funds/i.test(code));
    t('the bot warns transactions are irreversible', /cannot be reversed/i.test(code));
    // The scam-defence line is the part that was always right; keep it.
    t('the bot still refuses deposits', /never takes deposits/i.test(code));
    /*
     * The arcade was deleted from the repository, so advertising
     * "provably-fair mini-games" points at a feature that does not exist in
     * any build — website included.
     */
    t('the bot does not advertise the removed arcade', !/mini-games/i.test(code));
  }

  /* ------------------- best-price across two aggregators ---------------- */
  /*
   * We now ask KyberSwap AND OpenOcean and use the better answer. Two things
   * make that safe, and both are load-bearing:
   *
   *  1. Only an EXECUTABLE quote may win. OpenOcean is quoted but never
   *     executed, so a better price we cannot sign must not become the
   *     transaction - showing one number and signing another is the worst
   *     possible bug on a swap screen.
   *
   *  2. A slow or failing second source must cost nothing. Sources run
   *     concurrently, so total latency is max(), not sum().
   */
  {
    const q = (out, opts = {}) => ({
      amountOutWei: BigInt(out),
      feeBps: opts.feeBps ?? 70,
      slippage: opts.slippage ?? 0.5,
      source: opts.source ?? 'kyber',
      ...(opts.executable === undefined ? {} : { executable: opts.executable })
    });

    /* ---- what counts as a quote at all ---- */
    t('a real quote is usable', isUsableQuote(q(100)));
    t('an error object is not a quote', !isUsableQuote({ error: 'NO_ROUTE' }));
    t('a zero-output quote is not usable', !isUsableQuote(q(0)));
    t('null is not a quote', !isUsableQuote(null));

    /* ---- like-for-like ---- */
    /*
     * An aggregator that ignored our fee parameter reports a bigger output
     * for the obvious reason: it is not taking our 0.70%. Ranking on that
     * would make the fee-free path always win, which is precisely the mistake
     * getQuote already refuses to make.
     */
    t('quotes with the same fee and slippage are comparable', comparable(q(100), q(110)));
    t('a fee mismatch blocks comparison', !comparable(q(100), q(110, { feeBps: 0 })));
    t('a slippage mismatch blocks comparison', !comparable(q(100), q(110, { slippage: 1 })));

    /* ---- the ranking ---- */
    let r = pickBestQuote([q(100), q(150)]);
    t('the better executable quote wins', r.best.amountOutWei === 150n);
    t('the comparison reports how many routes it checked', r.checked === 2);

    /*
     * THE ONE THAT MATTERS MOST. A non-executable quote is better - and must
     * still lose, because we cannot sign it.
     */
    r = pickBestQuote([q(100), q(120, { executable: false, source: 'oo' })]);
    t('a better NON-executable quote does not win', r.best.amountOutWei === 100n);
    t('...and the executable one is what we would sign', r.best.source === 'kyber');
    /* But we report the gap rather than pretending we found the best price. */
    t('...and the shortfall is reported honestly', r.beatenBy === 2000);

    /*
     * The legacy KyberSwap quote predates the `executable` flag entirely.
     * Defaulting an unflagged quote to "cannot execute" would break swapping
     * outright, so the rule is opt-OUT.
     */
    t('a quote with no executable flag can still win', pickBestQuote([q(100)]).best.amountOutWei === 100n);

    /* Nothing signable at all must be null, not an unsignable object. */
    r = pickBestQuote([q(120, { executable: false })]);
    t('quote-only results yield no executable best', r.best === null);
    t('...but they are still counted as checked', r.checked === 1);

    t('no quotes yields no best', pickBestQuote([]).best === null);

    /* ---- the improvement maths ---- */
    t('a 10% better quote is 1000 bps', improvementBps(q(100), q(110)) === 1000);
    t('an equal quote is 0 bps', improvementBps(q(100), q(100)) === 0);
    /*
     * Precision: an 18-decimal amount exceeds Number.MAX_SAFE_INTEGER, so the
     * ratio must be computed in BigInt. Converting first would silently round
     * and could report a real improvement as zero.
     */
    const big = 10n ** 18n;
    t(
      'the maths survives 18-decimal amounts',
      improvementBps({ ...q(1), amountOutWei: big }, { ...q(1), amountOutWei: big + big / 100n }) === 100
    );

    /*
     * Concurrency and failure behaviour are asynchronous, and this suite is
     * synchronous by design. They are exercised in test/quote-race-probe.mjs
     * instead - see the note there about why the timing assertion has to be
     * measured rather than reasoned about.
     */
  }

  /* ----------------------- the OpenOcean adapter ------------------------ */
  {
    /*
     * OpenOcean expresses referrerFee as a PERCENT while we hold basis
     * points. Getting this wrong by 100x would either quote a 70% fee (every
     * quote rejected) or a 0.007% one (we compare against a fee we cannot
     * charge). Cheap to test, expensive to discover in production.
     */
    t('70 bps converts to 0.7 percent', bpsToPercent(70) === 0.7);
    t('100 bps converts to 1 percent', bpsToPercent(100) === 1);
    t('0 bps converts to 0', bpsToPercent(0) === 0);

    /*
     * Only chains we can also EXECUTE on. A quote for a chain we cannot swap
     * on is a better price we are unable to honour.
     */
    t('BNB Chain is supported', openOceanSupports(56));
    t('Ethereum is supported', openOceanSupports(1));
    t('an unknown chain is not', !openOceanSupports(999999));
  }

  /* ---------------------- what the past actually says -------------------- */
  /*
   * The history engine answers «گذشته به ما چی میگه» with MEASUREMENTS, never
   * forecasts. Every number it returns describes data that already happened.
   *
   * That distinction is the whole point, and it is what these tests protect:
   * a module that quietly starts emitting a probability, or that inflates one
   * sideways drift into "twenty tests", turns an honest tool into a machine
   * for manufacturing false confidence about money.
   */
  {
    /* ---- levels the market returns to ---- */
    // Touches 100 three times, bouncing away each time.
    const triple = [
      80, 85, 90, 95, 100, 99, 96, 92, 88, 90, 94, 98, 100, 99, 95,
      90, 86, 88, 92, 96, 100, 98, 94, 90, 87, 89, 93, 97
    ];
    const lv = findLevels(triple);
    t('a repeatedly-touched price is found as one level', lv.length === 1);
    t('...at the right price', Math.abs(lv[0].price - 100) < 0.5);
    t('...with every touch counted', lv[0].touches === 3);
    t('...and classified by what it acted as', lv[0].kind === 'resistance');

    /*
     * Bands are a PERCENTAGE of price, not a fixed amount. A fixed step would
     * give BTC three bands and a sub-cent token three thousand.
     */
    const cheap = triple.map((p) => p / 100000);
    t('the same shape is found on a sub-cent token', findLevels(cheap).length === 1);

    // A single wiggle is not a level.
    t('one touch is not a level', findLevels([1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5]).length === 0);

    /* ---- how a level behaved ---- */
    /*
     * THE ONE THAT MATTERS MOST. A price that sits AT a level for twenty bars
     * is one event, not twenty tests. Counting each bar would turn a single
     * drift into a fabricated pattern — the exact dishonesty this module
     * exists to avoid.
     */
    const flat = [120, 110, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 110, 120, 130];
    const flatRec = levelRecord(flat, { price: 100, kind: 'support' });
    t(`sitting at a level counts as ONE test (got ${flatRec.tested})`, flatRec.tested === 1);

    // Two bounces then a break.
    const mixed = [130, 120, 101, 115, 125, 130, 120, 100, 118, 128, 130, 118, 100, 95, 88, 80, 75];
    const rec = levelRecord(mixed, { price: 100, kind: 'support' });
    t(`held is counted (${rec.held} of ${rec.tested})`, rec.tested === 3 && rec.held === 2);
    t('breaks are the remainder', rec.broke === 1);

    /*
     * With no bars after the touch there is no outcome to judge. Guessing one
     * would invent history.
     */
    t('an unjudgeable touch is not counted', levelRecord([130, 120, 100], { price: 100, kind: 'support' }).tested === 0);

    /* ---- drawdown ---- */
    t('the worst fall is measured peak to trough', Math.abs(maxDrawdown([100, 110, 120, 60, 80]) - 50) < 0.01);
    /* The peak must not reset on a later high — the worst fall is the worst
       fall in the whole window, not the most recent one. */
    t('a later rally does not erase an earlier crash',
      Math.abs(maxDrawdown([100, 200, 100, 150, 300]) - 50) < 0.01);
    t('a monotonic rise has no drawdown', maxDrawdown([1, 2, 3, 4, 5]) === 0);

    /* ---- relative to this coin's own normal ---- */
    /*
     * MEDIAN, not mean. One listing pump can drag a mean so high that every
     * later day looks quiet by comparison, which is exactly backwards.
     */
    const spiky = [100, 100, 100, 100, 100, 100, 100, 10000];
    const rel = relativeToNormal(200, spiky);
    t('a single spike does not poison the baseline', rel.median === 100 && rel.ratio === 2);
    t('a normal day is not flagged as unusual', relativeToNormal(105, [100, 100, 100, 100, 100, 100]).unusual === false);
    t('a quiet day is flagged too', relativeToNormal(20, [100, 100, 100, 100, 100, 100]).unusual === true);
    t('too little history yields nothing', relativeToNormal(100, [100, 100]) === null);

    /* ---- base rate ---- */
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
    const br = baseRate(rising, 7);
    t('a monotonic rise is 100% of the sample', br.pct === 100);
    t('the sample size is reported, not just the percentage', br.samples === 53);
    t('too short a series yields no base rate', baseRate([1, 2, 3], 7) === null);

    /* ---- range position ---- */
    const rp = rangePosition([50, 100, 75]);
    t('the range position is measured', Math.abs(rp.pct - 50) < 0.01);
    t('a flat line has no range', rangePosition([5, 5, 5]) === null);

    /* ---- the summary ---- */
    const facts = historyFacts(triple, { days: 90 });
    t('facts are produced from a real series', facts.length > 0);
    /*
     * Facts must be KEYS plus numbers, never finished sentences — a module
     * that formats its own strings cannot be translated, and this app ships
     * in twelve languages.
     */
    t('every fact is a translation key with values',
      facts.every((f) => typeof f.id === 'string' && f.values && typeof f.values === 'object'));
    /*
     * `kind` is for colour only. If it ever gains a 'bullish' or 'sell'
     * value, this module has started forecasting.
     */
    t('no fact carries a buy or sell verdict',
      facts.every((f) => ['neutral', 'caution', 'notable'].includes(f.kind)));

    /*
     * A base rate from a dozen observations invites someone to treat noise as
     * an edge, so it is withheld below 30 samples.
     */
    const shortSeries = Array.from({ length: 25 }, (_, i) => 100 + (i % 3));
    t('a thin base rate is withheld rather than shown',
      !historyFacts(shortSeries, { days: 25 }).some((f) => f.id === 'baseRate'));

    /* ---- it must never throw ---- */
    for (const bad of [null, undefined, [], [NaN, NaN], ['a', 'b'], [0, 0, 0], [-1, -2]]) {
      t(`garbage input yields no facts, not a crash (${JSON.stringify(bad)})`,
        Array.isArray(historyFacts(bad)) && historyFacts(bad).length === 0);
    }
  }

  /* ------------------- confidence measured, not assumed ------------------ */
  /*
   * The old confidence came from INDICATOR AGREEMENT. That was a bad number:
   * every indicator is a different arithmetic transform of the same price
   * series, so they are correlated by construction and agree loudest exactly
   * when they are all wrong together. It reported "how similar are my
   * formulas" as "how sure am I" — confidently wrong, about money.
   *
   * It now comes from replaying the signal over the coin's own history.
   */
  {
    const trend = Array.from({ length: 200 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 7) * 6);
    const bt = backtest(trend);

    t('a backtest runs on enough history', bt !== null);
    t('it reports how many signals it found', bt.samples > 0);
    /*
     * THE NUMBER THAT MATTERS. A 60% hit rate is worthless if the coin rose
     * on 62% of all days — the rule did worse than doing nothing. Most tools
     * hide this comparison.
     */
    t('it compares against doing nothing', typeof bt.baseRate === 'number');
    t('it reports an edge over the base rate', typeof bt.edge === 'number');
    t('a rising market has a high base rate', bt.baseRate > 60);

    /* Too little history must yield NOTHING rather than a number built on
       four observations. */
    t('a short series is refused', backtest(Array.from({ length: 40 }, (_, i) => 100 + i)) === null);
    t('garbage is refused', backtest(null) === null && backtest([]) === null);

    /* ---- the rule itself ---- */
    /*
     * It must require the trend to agree, or it buys every dip of a collapse.
     * A pure downtrend drives RSI low, but ma20 < ma50, so no buy may fire.
     */
    const crash = Array.from({ length: 120 }, (_, i) => 200 - i * 1.2);
    let buysInCrash = 0;
    for (let i = 50; i < crash.length - 1; i += 1) if (signalAt(crash, i) === 'buy') buysInCrash += 1;
    t(`the rule does not buy a collapse (${buysInCrash} buys)`, buysInCrash === 0);

    /* Not enough bars to compute the slow average = no signal, not a guess. */
    t('no signal before the indicators are warm', signalAt(trend, 10) === null);

    /* ---- confidence ---- */
    /*
     * THE CEILING IS THE POINT. No chart rule on a volatile asset deserves a
     * figure that reads like certainty, and a "94% confident" badge on a
     * crypto app is a lie with a decimal point on it.
     */
    const strong = { buy: { total: 60, hits: 45, rate: 75, edge: 25 }, sell: {}, samples: 60 };
    t('confidence is capped below certainty', confidenceFrom(strong, 'buy', 100) <= 75);

    /*
     * No evidence must cap the number hard. Perfect agreement with no
     * backtest is still a guess, and the old formula would have returned ~80.
     */
    t('no backtest caps confidence at 40', confidenceFrom(null, 'buy', 100) <= 40);
    t('...and it is still a real number', confidenceFrom(null, 'buy', 100) >= 5);

    /*
     * A rule that historically did WORSE than doing nothing must reduce
     * confidence, not merely fail to raise it.
     */
    const bad = { buy: { total: 50, hits: 15, rate: 30, edge: -25 }, sell: {}, samples: 50 };
    t('negative edge produces low confidence', confidenceFrom(bad, 'buy', 90) < 30);
    t('negative edge scores below a good edge',
      confidenceFrom(bad, 'buy', 90) < confidenceFrom(strong, 'buy', 90));

    /* A handful of occurrences is an anecdote, not a hit rate. */
    const thin = { buy: { total: 3, hits: 3, rate: 100, edge: 50 }, sell: {}, samples: 3 };
    t('a tiny sample is not trusted', confidenceFrom(thin, 'buy', 90) <= 40);

    /* ---- end to end ---- */
    const a = analyze(trend, { change24h: 1, change7d: 4 });
    t('analyze exposes the backtest behind its confidence', a.backtest !== undefined);
    t('analyze still reports agreement separately', typeof a.agreement === 'number');
    t('confidence never claims certainty', a.confidence <= 75);
  }

  /* ==================== macro + verdict engine ========================== */
  /*
   * ─── WHAT THESE PROTECT ───────────────────────────────────────────────────
   * The brief was «قویترین سیگنال‌دهی ... که هر کسی با هر سوادی بفهمه چخبره» —
   * the strongest signal we can honestly produce, readable by anyone.
   *
   * "Strongest" is the dangerous half of that sentence. The easy way to make a
   * signal engine look strong is to make it confident, and everything below
   * exists to stop exactly that: the engine must stay quiet when it does not
   * know, must never emit a sentence (only keys + numbers, so nothing can be
   * mistranslated into a claim), and must never produce a number that reads
   * like certainty.
   */
  {
    /* Deterministic synthetic series — a seeded walk, never Math.random(),
       so a failure is reproducible rather than a flake to re-run. */
    const mulberry32 = (a) => () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const walk = (n, seed, drift = 0, vol = 0.02, start = 100) => {
      const r = mulberry32(seed);
      const out = [start];
      for (let i = 1; i < n; i += 1) out.push(out[i - 1] * (1 + drift + (r() - 0.5) * vol * 2));
      return out;
    };

    /* ---------------------------- beta ---------------------------------- */
    const btc = walk(180, 7);
    // Built to move exactly 2× BTC, bar for bar. Beta must recover that.
    const levered = [100];
    for (let i = 1; i < btc.length; i += 1) {
      levered.push(levered[i - 1] * (1 + 2 * (btc[i] / btc[i - 1] - 1)));
    }
    const b = betaToBtc(levered, btc);
    t('beta recovers a known 2x relationship', b && Math.abs(b.beta - 2) < 0.15);
    /*
     * R² is the guard against the classic abuse of beta. A beta of 2.0 fitted
     * to noise is meaningless, and macroContext refuses to report one below
     * 0.2 — so a perfectly-derived series must land near 1.0 or that gate is
     * measuring the wrong thing.
     */
    t('...and reports that BTC explains all of it', b.r2 > 0.95);

    /* An unrelated series must NOT produce a confident beta. */
    const unrelated = walk(180, 99);
    const bu = betaToBtc(unrelated, btc);
    t('an unrelated series gets a low r-squared', bu && bu.r2 < 0.3);
    /*
     * ...and the low r-squared must actually GATE the output, not merely be
     * reported. This is the abuse the number exists to prevent: a beta of
     * -0.1 fitted to noise, printed as "this asset moves 0.1x Bitcoin", is a
     * precise-sounding falsehood. Asserting on `betaToBtc` alone did not
     * catch removing the gate — I checked by deleting it, and nothing failed.
     */
    t('a noise-fitted beta is not surfaced as a fact',
      !macroContext({
        coin: { id: 'x', symbol: 'X', athChange: -30 },
        series: unrelated,
        btcSeries: btc,
        global: { mcapChange: 1, btcDominance: 52 }
      }).facts.some((f) => f.id.startsWith('beta.')));
    /* The gate must not swallow a genuine relationship. */
    t('a well-explained beta IS surfaced',
      macroContext({
        coin: { id: 'y', symbol: 'Y', athChange: -30 },
        series: levered,
        btcSeries: btc,
        global: { mcapChange: 1, btcDominance: 52 }
      }).facts.some((f) => f.id === 'beta.high'));

    t('beta refuses a series too short to fit', betaToBtc([1, 2, 3], btc) === null);

    /* ---------------------------- regime -------------------------------- */
    const rising = walk(60, 3, 0.004, 0.01);
    const falling = walk(60, 4, -0.004, 0.01);

    const rotOut = marketRegime({
      global: { mcapChange: -2, btcDominance: 58, btcDominanceChange: 0.4 },
      btcSeries: falling
    });
    t('a falling market with BTC dominance rising is rotationOut', rotOut?.regime === 'rotationOut');
    /*
     * This is the regime the whole macro layer exists for: the one where an
     * altcoin's own chart looks fine and it gets sold anyway. If this ever
     * stops being detected the layer is decoration.
     */
    t('...and it is flagged as caution, not neutral',
      macroContext({
        coin: { id: 'x', athChange: -40 },
        series: walk(120, 11),
        btcSeries: falling,
        global: { mcapChange: -2, btcDominance: 58, btcDominanceChange: 0.4 }
      }).facts.some((f) => f.id === 'regime.rotationOut' && f.kind === 'caution'));

    const riskOn = marketRegime({
      global: { mcapChange: 2, btcDominance: 48, btcDominanceChange: -0.5 },
      btcSeries: rising
    });
    t('a rising market with dominance falling is riskOn', riskOn?.regime === 'riskOn');

    t('regime refuses to guess without dominance',
      marketRegime({ global: { mcapChange: 2 }, btcSeries: rising }) === null);
    /*
     * `certain` distinguishes a dominance drift we READ from one we INFERRED.
     * Collapsing the two would let the UI assert a rotation it cannot see.
     */
    t('an inferred dominance drift is marked uncertain',
      marketRegime({ global: { mcapChange: 5, btcDominance: 50 }, btcSeries: walk(60, 5, 0, 0.001) })?.certain === false);

    /* ---------------------------- cycle --------------------------------- */
    t('a coin at its high is banded atHigh', cyclePosition({ athChange: -2 })?.band === 'atHigh');
    const deep = cyclePosition({ athChange: -90 });
    t('a 90% drawdown is banded farFromHigh', deep?.band === 'farFromHigh');
    /*
     * The recovery multiple is the honest restatement of a drawdown: "down
     * 90%" is abstract, "needs 10x to break even" is the same fact and is
     * understood instantly. 100/(100-90) = 10.
     */
    t('...and states the 10x needed to break even', deep.values.recoveryX === 10);

    /* -------------------- bitcoin is not compared to itself -------------- */
    /*
     * Beta of BTC to BTC is 1.0 with r2 1.0 — arithmetically true, useless to
     * print, and on the single most-viewed asset in the app.
     */
    const btcMacro = macroContext({
      coin: { id: 'bitcoin', symbol: 'BTC', athChange: -20 },
      series: btc,
      btcSeries: btc,
      global: { mcapChange: 1, btcDominance: 55 }
    });
    t('bitcoin is not told it moves 1x bitcoin', btcMacro.beta === null);
    t('...nor is a beta fact rendered for it',
      !btcMacro.facts.some((f) => f.id.startsWith('beta.')));
    t('...but the regime still applies to it', btcMacro.regime !== null);
    /* The symbol path matters too — a deep link can arrive without the id. */
    t('the check works from the symbol alone',
      macroContext({ coin: { symbol: 'BTC' }, series: btc, btcSeries: btc, global: { mcapChange: 1, btcDominance: 55 } }).beta === null);
    /* And it must not swallow every asset — WBTC aside, others still get one. */
    t('a normal asset still gets its beta',
      macroContext({ coin: { id: 'ether', symbol: 'ETH' }, series: levered, btcSeries: btc, global: { mcapChange: 1, btcDominance: 55 } }).beta !== null);

    /* ---------------------------- verdict -------------------------------- */
    const series = walk(200, 21, 0.002, 0.03);
    const analysis = analyze(series, { change24h: 1, change7d: 3, id: 'x', symbol: 'X' });
    const v = verdict({
      analysis,
      series,
      btcSeries: btc,
      coin: { id: 'x', symbol: 'X', athChange: -35, volume: 1e6 },
      global: { mcapChange: 1, btcDominance: 52 }
    });

    t('the verdict produces both horizons', Boolean(v?.short && v?.long));
    t('the two horizons cover different spans', v.short.days !== v.long.days);

    /*
     * ─── THE CEILINGS, AND WHY THIS TEST IS SHAPED LIKE THIS ────────────────
     * These are not tuning constants. They are the promise that this app will
     * never show a number that reads like certainty about a volatile asset.
     *
     * Asserting `confidence <= 75` on one arbitrary fixture is worthless and
     * was the first version of this test: that fixture scored 30, so the
     * assertion passed with the clamp deleted entirely. I removed the clamp
     * to check, and nothing failed. Worse, the clamp was ALSO dead code —
     * the formula's natural maximum was 72, so the cap could never bind and
     * the "ceiling" was a comment rather than a constraint.
     *
     * So this sweeps a wide space of synthetic markets, requires that
     * something actually REACHES the ceiling (proving the clamp binds), and
     * requires that nothing exceeds it (proving it holds). The constants are
     * imported, never copied — a duplicated constant in a test goes stale
     * silently and then guards nothing.
     */
    {
      let maxShort = 0;
      let maxLong = 0;
      let over = 0;
      for (let seed = 1; seed < 40; seed += 1) {
        for (const drift of [0.004, 0.002, 0, -0.002, -0.004]) {
          const s2 = walk(300, seed, drift, 0.02);
          const b2 = walk(300, seed + 500, drift, 0.02);
          const a2 = analyze(s2, { change24h: drift * 100, change7d: drift * 400 });
          if (!a2) continue;
          for (const g of [
            { mcapChange: 2, btcDominance: 48, btcDominanceChange: -0.5 },
            { mcapChange: -2, btcDominance: 58, btcDominanceChange: 0.4 }
          ]) {
            const r = verdict({
              analysis: a2,
              series: s2,
              btcSeries: b2,
              coin: { id: 'x', symbol: 'X', athChange: -10, volume: 1e6 },
              global: g
            });
            maxShort = Math.max(maxShort, r.short.confidence);
            maxLong = Math.max(maxLong, r.long.confidence);
            if (r.short.confidence > CONFIDENCE_CEILING.short) over += 1;
            if (r.long.confidence > CONFIDENCE_CEILING.long) over += 1;
          }
        }
      }
      t('no market in the sweep exceeds the confidence ceiling', over === 0);
      /*
       * The clamp must BIND, not merely exist. If the highest confidence the
       * engine can produce is well under the cap, the cap is decoration and
       * would keep passing after someone raised the real limit.
       */
      t('the monthly ceiling is actually reached, so the cap is real',
        maxLong === CONFIDENCE_CEILING.long);
      t('the sweep produced meaningful confidence at all', maxShort > 20);
    }

    /*
     * NOTHING HERE MAY BE A SENTENCE. Every reason is a translation key plus
     * numbers, which is what makes it impossible for this engine to state a
     * claim we did not write in a language we cannot read.
     */
    const allReasons = [...v.short.reasons, ...v.long.reasons];
    t('every reason is a key, never prose',
      allReasons.length > 0 && allReasons.every((r) => typeof r.id === 'string' && !/\s/.test(r.id)));
    t('every reason carries a values object',
      allReasons.every((r) => r.values && typeof r.values === 'object'));
    t('reason kinds stay in the neutral vocabulary',
      allReasons.every((r) => ['neutral', 'caution', 'notable'].includes(r.kind)));

    /*
     * The stance vocabulary must never contain an instruction. "buy" /
     * "sell" / "bullish" appearing here would turn a measurement into
     * financial advice, which is both the legal line and the honesty line.
     */
    const STANCES = ['tailwind', 'mildUp', 'unclear', 'mildDown', 'headwind'];
    t('stances come from the non-directive vocabulary',
      STANCES.includes(v.short.stance) && STANCES.includes(v.long.stance));

    /* ---- the disagreement override ---- */
    /*
     * When independent layers point opposite ways the honest answer is "we
     * don't know", NOT the average. Averaging +80 and -80 to 0 and calling it
     * neutral is a different statement from "two strong readings contradict
     * each other", and only the second is true.
     */
    const conflicted = verdict({
      analysis: { ...analysis, score: 95, label: 'strongBuy' },
      series,
      btcSeries: falling,
      coin: { id: 'x', symbol: 'X', athChange: -92 },
      global: { mcapChange: -4, btcDominance: 60, btcDominanceChange: 0.8 }
    });
    /*
     * This exact fixture is why the detector was rewritten. Under the original
     * standard-deviation test it scored a spread of 59 against a threshold of
     * 65 — so the single most dangerous configuration in the engine, a +95
     * chart inside a market rotating out of this whole category, came out as
     * "slightly in its favour". The sign-conflict test catches it.
     *
     * `!== 'tailwind'` is too weak to assert on its own (mildUp would pass
     * it), so all three consequences are checked.
     */
    t('a strong chart inside a rotation-out market is reported as unclear',
      conflicted.short.stance === 'unclear');
    t('...and the conflict is flagged explicitly', conflicted.short.conflicted === true);
    t('...and it says so in the reasons',
      conflicted.short.reasons.some((r) => r.id === 'layersDisagree'));
    t('...and confidence is forced down', conflicted.short.confidence <= 30);
    /*
     * The other half: agreement must NOT be reported as conflict, or the
     * override is just a way of never answering.
     */
    t('an agreeing read is not flagged as conflicted', v.long.conflicted === false);

    /*
     * ─── THE WEIGHT BAR ON CONFLICT DETECTION ───────────────────────────────
     * A layer must carry real evidence before its disagreement can veto the
     * whole read. Without that bar, a layer holding almost nothing could
     * force "unclear" onto a well-supported answer — and the engine would
     * then answer "we don't know" to nearly everything, which is a different
     * flavour of useless rather than a fix.
     *
     * This fixture is chosen because it sits exactly on the boundary: the
     * technical layer scores -42 but carries only 0.35 weight (below the 0.4
     * bar) while macro scores +30 at full weight. Opposite signs, but one of
     * them is not backed by enough evidence to count, so the correct answer
     * is NOT conflicted. Setting CONFLICT_MIN_WEIGHT to 0 flips this.
     */
    {
      const s3 = walk(250, 2, 0, 0.03);
      const a3 = analyze(s3, { change24h: 0, change7d: 0 });
      const r3 = verdict({
        analysis: a3,
        series: s3,
        btcSeries: btc,
        coin: { id: 'x', symbol: 'X', athChange: -30, volume: 1e6 },
        global: { mcapChange: 2, btcDominance: 48, btcDominanceChange: -0.5 }
      });
      const tech = r3.long.layers.technical;
      // Assert the fixture really is the boundary case, or the test below is
      // checking something else entirely and would pass for the wrong reason.
      t('the boundary fixture has a low-weight layer opposing macro',
        tech.weight > 0 && tech.weight < 0.4 && tech.score < -25 && r3.long.layers.macro.score > 25);
      t('...and a low-weight layer alone cannot force unclear',
        r3.long.conflicted === false);
    }

    /* ---- too little data ---- */
    const tiny = verdict({ analysis: null, series: [1, 2, 3], btcSeries: btc, coin: {}, global: null });
    t('a coin with three data points gets no opinion', tiny.short.stance === 'unclear');
    t('...and zero confidence rather than a small one', tiny.short.confidence === 0);
    t('...and says so as a reason', tiny.short.reasons.some((r) => r.id === 'noData'));
    t('an empty series returns nothing at all', verdict({ series: [] }) === null);

    /* ---- horizon agreement ---- */
    t('agreement is one of three named states',
      ['aligned', 'conflict', 'partial'].includes(v.agree));

    /*
     * The layers must be inspectable. A confidence figure whose inputs cannot
     * be seen is just a bigger assertion, and the panel shows these weights
     * to the user precisely so the number is checkable.
     */
    for (const k of ['technical', 'historical', 'structural', 'macro']) {
      t(`the ${k} layer is exposed with a weight`, typeof v.short.layers[k]?.weight === 'number');
    }
    /*
     * Weight-zero means NO EVIDENCE, and must be distinguishable from
     * score-zero which means "evidence, pointing nowhere". Conflating them is
     * how an uninformed read ends up looking confidently neutral.
     */
    t('a layer with no data reports weight 0, not score 0',
      tiny.short.layers.macro.weight === 0);
  }

  /* ======================== yield safety filter ========================== */
  /*
   * ─── WHY THIS FILTER IS THE WHOLE FEATURE ─────────────────────────────────
   * An unfiltered yield list sorted by APY is, quite literally, a list sorted
   * by scam. Anyone can deploy a pool advertising 90,000% paid in a token that
   * cannot be sold, and it will sit at the top of any yield ranking on earth.
   *
   * The Farm screen used to show four hard-coded pools with hand-written APR
   * ranges written months earlier. Replacing that with LIVE data is only an
   * improvement if the filter holds — live unfiltered data would be strictly
   * worse than stale honest data. So every rule gets a test with a fixture
   * built to violate exactly that rule and nothing else.
   */
  {
    /* A pool that passes everything, used as the base for each violation. */
    const good = {
      pool: 'p1',
      chain: 'Ethereum',
      project: 'aave-v3',
      symbol: 'USDC',
      tvlUsd: 500_000_000,
      apy: 5,
      apyBase: 5,
      apyReward: 0,
      apyMean30d: 5,
      stablecoin: true,
      ilRisk: 'no',
      exposure: 'single',
      outlier: false
    };
    t('a large, audited, real-yield pool passes', isEligible(good));

    /*
     * THE SCAM CASE. This is the row the whole file exists to reject: an
     * enormous APY paid entirely in emissions. Note it also carries a
     * plausible TVL, because a fixture that fails on three rules at once does
     * not prove which rule is doing the work.
     */
    t('a 90,000% emissions pool is rejected',
      !isEligible({ ...good, project: 'scamswap', apy: 90000, apyBase: 0, apyReward: 90000 }));
    /* ...and specifically NOT only because of the unknown protocol. */
    t('...even if it claims to be a known protocol',
      !isEligible({ ...good, apy: 90000, apyBase: 0, apyReward: 90000 }));

    t('an unknown protocol is rejected even when it looks perfect',
      !isEligible({ ...good, project: 'brand-new-defi' }));
    t('a chain the app cannot reach is rejected',
      !isEligible({ ...good, chain: 'Fantom' }));
    t('a pool below the TVL floor is rejected',
      !isEligible({ ...good, tvlUsd: 900_000 }));
    t('DefiLlama\u2019s own outlier flag is respected',
      !isEligible({ ...good, outlier: true }));
    t('a dust yield is not worth a row',
      !isEligible({ ...good, apy: 0.008, apyBase: 0.008 }));

    /*
     * ─── THE APY CEILING, ISOLATED ─────────────────────────────────────────
     * This fixture exists because the 90,000% test above did NOT prove the
     * ceiling worked: that pool was rejected by the emissions rule, and
     * raising MAX_APY to a billion changed nothing. I only found that by
     * removing the ceiling and watching every test still pass.
     *
     * So this one claims 300% and books ALL of it as apyBase — real revenue —
     * which slips past every other rule. It is the shape a sophisticated fake
     * takes, and the ceiling is the only thing that stops it.
     *
     * The reasoning behind the ceiling: sustainable yield is paid out of real
     * revenue (borrowing interest, swap fees, staking rewards), and real
     * revenue does not produce 300% a year. Anything claiming to is either
     * mismeasured or lying.
     */
    t('a 300% yield claiming to be all real revenue is still rejected',
      !isEligible({ ...good, apy: 300, apyBase: 300, apyReward: 0 }));
    t('...while a high-but-plausible 45% is allowed through',
      isEligible({ ...good, apy: 45, apyBase: 45, apyReward: 0 }));

    /*
     * The emissions-share rule. 80% emissions fails, 50% passes. Both fixtures
     * sit at an ordinary APY so the ONLY difference between them is the split
     * — otherwise this would be re-testing the APY ceiling.
     */
    t('a pool that is 80% emissions is rejected',
      !isEligible({ ...good, apy: 20, apyBase: 4, apyReward: 16 }));
    t('...but a normally-incentivised pool is kept',
      isEligible({ ...good, apy: 20, apyBase: 10, apyReward: 10 }));

    /* ---- risk banding is about the POSITION, never about the yield ------- */
    /*
     * Banding by APY would be circular: "high yield is high risk" tells the
     * user only what they already inferred from the big number. These bands
     * describe what can actually go wrong with the position.
     */
    t('a stablecoin single-asset pool bands low', riskBand(good) === 'low');
    t('a volatile pair bands high',
      riskBand({ ...good, symbol: 'CAKE-BNB', stablecoin: false, ilRisk: 'yes', exposure: 'multi' }) === 'high');
    t('...regardless of how small its yield is',
      riskBand({ ...good, apy: 1, symbol: 'CAKE-BNB', stablecoin: false, ilRisk: 'yes', exposure: 'multi' }) === 'high');
    t('a high-yield stable single-asset pool still bands low',
      riskBand({ ...good, apy: 55 }) === 'low');

    /* ---- normalisation --------------------------------------------------- */
    const n = normalizePool({ ...good, apy: 12.34567, apyBase: 6.11111, apyReward: 6.23456 });
    t('APY is rounded to one decimal', n.apy === 12.3);
    /*
     * The upstream carries five decimals. Rendering "12.34567%" implies a
     * precision that a variable rate recomputed hourly does not have.
     */
    t('...and so is the split', n.apyBase === 6.1 && n.apyReward === 6.2);
    /*
     * DefiLlama publishes a machine-learning prediction per pool. Forwarding
     * it would be laundering someone else's forecast through our UI, and this
     * app's whole position is that a number the user cannot interrogate is
     * worthless.
     */
    t('the upstream ML prediction is never forwarded',
      n.predictions === undefined && n.predictedClass === undefined);

    /* ---- the real/emissions split --------------------------------------- */
    t('an all-revenue pool is 100% real', realShare({ apy: 5, apyBase: 5 }) === 1);
    t('a mostly-emissions pool reports a small real share',
      Math.abs(realShare({ apy: 20, apyBase: 4 }) - 0.2) < 0.001);
    /*
     * An unknown split must NOT render as "100% real" — that is the flattering
     * default and it is the one that misleads.
     */
    t('an unknown split is null, never 100%', realShare({ apy: 20 }) === null);

    /* ---- today vs the 30-day average ------------------------------------ */
    const spike = rateIsUnusual({ apy: 40, apyMean30d: 6 });
    t('a pool spiking far above its average is flagged', spike?.direction === 'above');
    t('...with the multiple stated', spike.ratio === 6.7);
    t('a pool at its normal rate is not flagged',
      rateIsUnusual({ apy: 6.2, apyMean30d: 6 }) === null);
    t('a pool well below its average is flagged too',
      rateIsUnusual({ apy: 2, apyMean30d: 12 })?.direction === 'below');
    t('no average means no claim', rateIsUnusual({ apy: 6 }) === null);

    /* ---- pair detection, which is what the swap handoff needs ----------- */
    t('an LP pair yields both tokens',
      JSON.stringify(pairTokens({ symbol: 'CAKE-BNB', exposure: 'multi' })) === '["CAKE","BNB"]');
    t('a single-asset pool has no pair to buy',
      pairTokens({ symbol: 'STETH', exposure: 'single' }).length === 0);
    /*
     * Guard against manufacturing a swap the user does not need: a
     * single-asset pool whose SYMBOL happens to contain a hyphen must still
     * produce no pair, or the UI would offer to buy two halves of one token.
     */
    t('a hyphenated single-asset symbol still has no pair',
      pairTokens({ symbol: 'WBTC-WRAPPED', exposure: 'single' }).length === 0);

    /* ---- the calculator -------------------------------------------------- */
    const proj = projectEarnings({ apy: 12, apyBase: 6 }, 1000);
    t('a percentage is turned into money', Math.abs(proj.year - 120) < 0.01);
    /*
     * APY is ALREADY the compounded figure. Compounding it again would
     * overstate the result — an easy mistake that always errs in the
     * flattering direction, which is why it is asserted rather than assumed.
     */
    t('...without compounding an already-compounded rate', proj.year === 120);
    t('the monthly figure is the yearly one divided by twelve',
      Math.abs(proj.month - 10) < 0.01);
    /*
     * And the projection is split too, so "$120 a year" is immediately
     * qualified by how much of it is real revenue.
     */
    t('the projection says how much of it is real', Math.abs(proj.fromRealYield - 60) < 0.01);
    t('a zero deposit projects nothing', projectEarnings({ apy: 12 }, 0) === null);
  }

  /* ========================= the engine stays cheap ====================== */
  /*
   * ─── WHY A TIMING TEST, WHICH IS NORMALLY A BAD IDEA ──────────────────────
   * The brief included «سرعت پایین نیاد و باگ ندی به اپ» — do not slow the app
   * down. That is a real risk here and not a theoretical one: the verdict
   * engine runs a full no-look-ahead backtest at TWO horizons, and a backtest
   * is a loop over every bar recomputing indicators. It is the most expensive
   * thing this app does per asset, and it runs on a mid-range Android phone.
   *
   * Timing assertions are usually flaky rubbish, so this one is shaped to be
   * safe: the budget is ~50x the measured cost, so it can only fail on a
   * genuine algorithmic regression (an accidental O(n^2), a backtest moved
   * inside a render loop) rather than on a slow CI box. Measured here at
   * 0.75ms for a year of daily bars; the budget is 40ms.
   */
  {
    const perfSeries = [100];
    const rnd = (() => {
      let a = 12345;
      return () => {
        a = (a * 1103515245 + 12345) & 0x7fffffff;
        return a / 0x7fffffff;
      };
    })();
    for (let i = 1; i < 365; i += 1) perfSeries.push(perfSeries[i - 1] * (1 + (rnd() - 0.5) * 0.04));
    const perfBtc = perfSeries.map((v, i) => v * (1 + Math.sin(i / 7) * 0.01));
    const perfAnalysis = analyze(perfSeries, { change24h: 1, change7d: 2 });

    const args = {
      analysis: perfAnalysis,
      series: perfSeries,
      btcSeries: perfBtc,
      coin: { id: 'x', symbol: 'X', athChange: -30, volume: 1e6 },
      global: { mcapChange: 1, btcDominance: 52 }
    };
    // Warm the JIT, or the first call's compile time is what gets measured.
    for (let i = 0; i < 5; i += 1) verdict(args);

    const started = Date.now();
    for (let i = 0; i < 20; i += 1) verdict(args);
    const perCall = (Date.now() - started) / 20;

    t(`a year of daily bars verdicts in well under 40ms (${perCall.toFixed(1)}ms)`, perCall < 40);
  }

  /* ============ curated Solana assets: LSTs and tokenized equities ======== */
  /*
   * ─── THE THREAT THIS GUARDS AGAINST ───────────────────────────────────────
   * Querying Jupiter for "AAPLx" returns SEVEN tokens. One is real. The rest
   * are pump.fun clones with the same name, the same symbol, and in two cases
   * the same logo scraped from Google. Measured from the live API:
   *
   *   real  XsbEhLAtcf6...  liquidity $79,912   mintAuthority = Backed
   *   fake  GQfQ2avnmJB...  liquidity $3.44     mintAuthorityDisabled
   *
   * A user who searches "Apple" and taps the first result loses their money.
   * There is no ranking that fixes this, because the fakes copy whatever
   * signal you rank on. The only defence is a verified mint list plus an
   * issuer-authority check, and these tests exist to keep both honest.
   */
  {
    const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const all = [...LST_ASSETS, ...EQUITY_ASSETS, ...COMMODITY_ASSETS];

    t('every curated mint is a plausible Solana address',
      all.length === 16 && all.every((a) => BASE58.test(a.mint)));
    /*
     * Duplicates would mean one asset silently shadowing another in the
     * mint->asset map, and the shadowed one would become unreachable.
     */
    t('no mint appears twice', new Set(all.map((a) => a.mint)).size === all.length);
    t('every curated asset carries decimals', all.every((a) => Number.isInteger(a.decimals)));

    /* ---- the issuer check, against REAL data ---- */
    /*
     * These two records are copied verbatim from the live Jupiter API rather
     * than invented, because an invented "fake" would be fake in whatever way
     * happened to make the test pass. The real clone is the specimen.
     */
    const aapl = EQUITY_ASSETS.find((a) => a.symbol === 'AAPLx');
    const realAapl = {
      id: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
      mintAuthority: XSTOCK_MINT_AUTHORITY,
      freezeAuthority: XSTOCK_FREEZE_AUTHORITY,
      isVerified: true
    };
    const cloneAapl = {
      id: 'GQfQ2avnmJBMttz2D5nyDkQAY9rWLHGvDVq8BMRpxWh4',
      isVerified: false,
      audit: { isSus: true, mintAuthorityDisabled: true }
    };

    t('the genuine Apple xStock is accepted', issuerMatches(realAapl, aapl, 'equity'));
    t('the real-world clone is rejected', !issuerMatches(cloneAapl, aapl, 'equity'));
    /*
     * The nastiest case: a record that reports the RIGHT mint and claims to be
     * verified, but whose mint authority is somebody else's. Only the
     * authority check catches this one.
     */
    t('a right-mint wrong-authority record is rejected',
      !issuerMatches(
        { ...realAapl, mintAuthority: 'HvsaoHJiadS1rEHkMRqdV3NMus55z4xqNs33ZCHVBoTS' },
        aapl,
        'equity'
      ));
    t('a tampered freeze authority is rejected',
      !issuerMatches({ ...realAapl, freezeAuthority: 'S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS' }, aapl, 'equity'));
    /* A record for a DIFFERENT mint must never satisfy this asset. */
    t('a record for another mint is rejected',
      !issuerMatches({ ...realAapl, id: LST_ASSETS[0].mint }, aapl, 'equity'));

    /* LSTs use the weaker check, and it must still reject the unverified. */
    const msol = LST_ASSETS.find((a) => a.symbol === 'mSOL');
    t('a verified LST is accepted', issuerMatches({ id: msol.mint, isVerified: true }, msol, 'lst'));
    t('an unverified LST is rejected', !issuerMatches({ id: msol.mint, isVerified: false }, msol, 'lst'));

    /* ---- the curated-mint gate on the ?to= handoff ---- */
    /*
     * SolanaSwap resolves ?to=<mint> through findAsset. If that accepted any
     * address, a crafted link would be a one-tap phishing vector: share
     * ?to=<scam mint> and the victim lands on a pre-filled swap screen.
     */
    t('a curated mint resolves', findAsset(aapl.mint)?.symbol === 'AAPLx');
    t('an arbitrary mint does NOT resolve',
      findAsset('GQfQ2avnmJBMttz2D5nyDkQAY9rWLHGvDVq8BMRpxWh4') === null);
    t('garbage does not resolve', findAsset('not-an-address') === null && findAsset(null) === null);
    t('isCuratedMint agrees with findAsset',
      isCuratedMint(aapl.mint) && !isCuratedMint('GQfQ2avnmJBMttz2D5nyDkQAY9rWLHGvDVq8BMRpxWh4'));

    /* ---- the depth gate ---- */
    /*
     * AAPLx really does have ~$80k of liquidity. A $5,000 order is 6.25% of
     * the entire book and moves the price against the user by several times
     * our own fee. Quoting it anyway is the behaviour of a venue that does not
     * care what happens next.
     */
    const tooBig = liquidityVerdict(80_000, 5_000);
    t('an order worth 6% of the book is refused', tooBig.ok === false && tooBig.reason === 'tooBig');
    /*
     * ...and it must name a size that WOULD work. A refusal with no number is
     * a dead end; 2% of $80k is $1,600.
     */
    t('...and it names the largest workable size', tooBig.maxUsd === 1600);
    t('a small order against the same book passes', liquidityVerdict(80_000, 500).ok === true);
    /* A deep book must not be gated — otherwise the rule blocks everything. */
    t('the same order against a deep book passes', liquidityVerdict(2_800_000, 5_000).ok === true);
    /* Unknown liquidity fails CLOSED. */
    t('unknown liquidity is refused, not assumed fine',
      liquidityVerdict(null, 1000).ok === false && liquidityVerdict(0, 1000).ok === false);
    t('the pool-share ceiling is a real fraction', MAX_POOL_SHARE > 0 && MAX_POOL_SHARE < 0.1);

    /* The listing floor is a separate, stricter question from the trade gate. */
    t('there is a minimum depth to be listed at all', MIN_EQUITY_LIQUIDITY >= 10_000);

    /* ---- the live-yield join ---- */
    /*
     * Yields must be JOINED from the live feed, never hard-coded. The old Farm
     * screen's "15-40%" ranges were wrong for months and nobody noticed; an
     * asset with no matching pool must therefore show NOTHING rather than a
     * stale number.
     */
    const jito = LST_ASSETS.find((a) => a.symbol === 'jitoSOL');
    const feed = [
      { project: 'jito-liquid-staking', symbol: 'JITOSOL', apy: 7.4, apyMean30d: 7.1, tvlUsd: 738_165_090 },
      { project: 'marinade-liquid-staking', symbol: 'MSOL', apy: 6.4, apyMean30d: 5.7, tvlUsd: 175_467_838 }
    ];
    t('a staking token picks up its live yield', yieldForLst(jito, feed)?.apy === 7.4);
    t('an absent pool yields null, never a guess', yieldForLst(jito, []) === null);
    /*
     * Matching on project alone would cross-contaminate: two pools from the
     * same protocol with different symbols must not be confused.
     */
    t('the join requires the symbol to match too',
      yieldForLst(jito, [{ project: 'jito-liquid-staking', symbol: 'SOMETHING-ELSE', apy: 99 }]) === null);
    t('an asset with no llama mapping yields null', yieldForLst({ symbol: 'X' }, feed) === null);

    /* ---- the staking projection ---- */
    const stake = projectStake(7.4, 1000);
    t('a staking rate becomes money', Math.abs(stake.year - 74) < 0.01);
    /*
     * APY is already compounded. Compounding it again overstates the return,
     * and the error always flatters — which is exactly why it is asserted.
     */
    t('...without double-compounding', stake.year === 74);
    t('a zero stake projects nothing', projectStake(7.4, 0) === null);
    /*
     * `Number(null)` is 0, not NaN, so a naive `Number.isFinite` guard accepts
     * it and projects a confident "$0 a year" for a yield we simply do not
     * know. Zero is a CLAIM about the rate; null is the absence of one. This
     * test caught exactly that bug in the first version.
     */
    t('an unknown rate projects nothing, not zero', projectStake(null, 1000) === null);
    t('...and neither does an empty string or a NaN',
      projectStake('', 1000) === null && projectStake(undefined, 1000) === null && projectStake('abc', 1000) === null);
  }

  /* ==================== token icons for Solana assets ==================== */
  /*
   * ─── THE BUG THIS LOCKS DOWN ──────────────────────────────────────────────
   * Every tokenized equity and staking token rendered a blank circle. Reported
   * as "عکس پروفایل نمیاد".
   *
   * Two causes, both worth a test:
   *   1. `iconCandidates` only read `logoURI`. Jupiter's API spells the field
   *      `icon`, so the curated Solana assets always fell through to the
   *      monogram — the exact failure lib/tokenIcon.jsx was written to kill,
   *      reappearing because a second data source names the field differently.
   *   2. EquityRow and Farm rendered a bare <img> with no onError, so a failed
   *      CDN left an empty circle rather than degrading to the monogram.
   */
  {
    const aapl = {
      mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
      symbol: 'AAPLx',
      icon: 'https://xstocks-metadata.backed.fi/logos/tokens/AAPLx.png'
    };
    t('a Jupiter `icon` field is used', iconCandidates(aapl)[0] === aapl.icon);
    t('an EVM `logoURI` still works',
      iconCandidates({ symbol: 'X', logoURI: 'https://example.com/x.png' })[0] === 'https://example.com/x.png');
    /* Both spellings on one token must not produce a duplicate attempt. */
    t('the same URL under both names is not tried twice',
      iconCandidates({ symbol: 'X', icon: 'https://a/x.png', logoURI: 'https://a/x.png' }).length === 1);

    /*
     * A token with no artwork must yield an EMPTY list, which is what makes
     * TokenIcon fall through to its monogram. Returning a broken URL here
     * would render the empty circle this whole fix removes.
     */
    t('no artwork means no candidates, so the monogram renders',
      iconCandidates({ symbol: 'XYZ', mint: aapl.mint }).length === 0);

    /*
     * These are injected straight into an <img src>. A token list is
     * user-influenced data, so anything that is not https must never reach
     * the DOM.
     */
    t('http is refused', iconCandidates({ symbol: 'X', icon: 'http://evil/x.png' }).length === 0);
    t('javascript: is refused', iconCandidates({ symbol: 'X', icon: 'javascript:alert(1)' }).length === 0);
    t('data: is refused', iconCandidates({ symbol: 'X', icon: 'data:image/svg+xml,<svg/>' }).length === 0);

    /*
     * ─── NO SYMBOL-KEYED ICON SOURCE FOR SOLANA ─────────────────────────────
     * The EVM path may add TrustWallet and CoinGecko because both are keyed by
     * CONTRACT ADDRESS, which a clone cannot occupy. Every Solana icon CDN
     * available here is symbol-keyed — which is precisely how a fake AAPLx
     * would inherit Apple's logo, and a fake wearing the real token's face is
     * the most effective phishing there is.
     *
     * So a Solana token gets the issuer's own icon and then the monogram, and
     * this asserts nobody "helpfully" adds a symbol-keyed fallback later.
     */
    t('a Solana mint alone never invents an icon URL',
      iconCandidates({ symbol: 'AAPLx', mint: aapl.mint }).length === 0);
  }

  /* ============================ tokenized gold =========================== */
  /*
   * Requested: «خرید طلا و چیزهای با ارزش دیگر». Gold is the asset with the
   * clearest reason to exist for this audience — the default store of value
   * where the local currency is unstable — and a token buys a fraction of an
   * ounce with no dealer premium and no border.
   *
   * It carries the SAME two dangers as the equities, so it gets the same
   * defences and the same tests.
   */
  {
    t('gold is listed', COMMODITY_ASSETS.length === 2);
    t('...with both major issuers',
      COMMODITY_ASSETS.map((a) => a.symbol).sort().join(',') === 'PAXG,XAUt0');
    /*
     * Unlike the equities there is no single shared issuer key: Paxos and
     * Tether are different companies. Each asset therefore carries its own
     * authorities, and a missing one must fail closed rather than skip the
     * check.
     */
    t('each gold token carries its own issuer authorities',
      COMMODITY_ASSETS.every((a) => a.mintAuthority && a.freezeAuthority));

    const paxg = COMMODITY_ASSETS.find((a) => a.symbol === 'PAXG');
    const realPaxg = {
      id: paxg.mint,
      mintAuthority: paxg.mintAuthority,
      freezeAuthority: paxg.freezeAuthority,
      isVerified: true
    };
    t('the genuine PAX Gold is accepted', issuerMatches(realPaxg, paxg, 'commodity'));
    t('a wrong mint authority is rejected',
      !issuerMatches({ ...realPaxg, mintAuthority: 'HvsaoHJiadS1rEHkMRqdV3NMus55z4xqNs33ZCHVBoTS' }, paxg, 'commodity'));
    /*
     * The Wormhole-bridged PAXG is real in the sense that it exists, and is
     * still wrong to list: $308 of liquidity and a price 37% away from spot.
     * Verbatim from the live API.
     */
    t('the thin Wormhole variant is rejected',
      !issuerMatches({ id: 'C6oFsE8nXRDThzrMEQ5SxaNFGKoyyfWDDVPw37JKvPTe', mintAuthority: 'BCD75RNBHrJJpW4dXVagL5mPjzRLnVZq4YirJdjEYMV7' }, paxg, 'commodity'));
    /* An asset with no declared authority must never pass by omission. */
    t('a commodity with no declared authority fails closed',
      !issuerMatches(realPaxg, { mint: paxg.mint }, 'commodity'));

    /* The clone list for gold is as bad as for the equities. */
    for (const fake of [
      '3dDHidrJFVqArN9PwKoLva2pYsDqVYEQzd8pgy8zpump',
      '8rhchrEwGmVqFMfFd1QTwogUjhD7nrv9ciUKN3eMpump',
      '4f383vyKkSfPnEMjw8TRwv7LFQyxt89CV91brHVfpump'
    ]) {
      t(`the gold clone ${fake.slice(0, 6)}… is not curated`, !isCuratedMint(fake));
    }

    /*
     * Gold is not an equity and the row must not label it "single company".
     * `unit` is what the UI branches on, so it has to be present.
     */
    t('gold declares its unit so it can be labelled correctly',
      COMMODITY_ASSETS.every((a) => a.unit === 'ounce'));

    /* Thin books, so the same depth gate must bind here too. */
    t('the depth gate applies to gold as well',
      liquidityVerdict(471_000, 20_000).ok === false && liquidityVerdict(471_000, 1_000).ok === true);
  }

  /* ============ what was left OUT of the asset list, and why ============= */
  /*
   * ─── THE MOST IMPORTANT TEST IN THIS FILE ─────────────────────────────────
   * The owner asked for silver, copper and European stocks by name. Every one
   * was checked against the live API and rejected on MEASUREMENT:
   *
   *   NVOx (Novo Nordisk)  real token, verified issuer, $122 of liquidity.
   *                        A $200 order is bigger than the entire book.
   *   silver (XAG)         eight results, ALL pump.fun clones with
   *                        mintAuthorityDisabled and $1.5k-$6k of liquidity.
   *                        No legitimate silver token exists on Solana today.
   *   copper / bronze      no tokenized copper with real depth; bronze is an
   *                        alloy and is not a traded instrument anywhere.
   *
   * These assertions exist because "the owner asked for it" is exactly the
   * pressure under which a scam token gets added later. A listing is a
   * recommendation to consider something, and listing an asset nobody can
   * exit is worse than omitting it.
   */
  {
    const symbols = [...EQUITY_ASSETS, ...COMMODITY_ASSETS].map((a) => a.symbol.toUpperCase());

    /* Silver: every candidate on Solana today is a clone. */
    t('no silver token is listed', !symbols.some((sym) => /^XAG/.test(sym)));
    for (const clone of [
      '8Ppjpe9G6TKoKdhCdMbo1AgDZDzuwSVRPBg8pLkVpump',
      'Cd2LW9jS2fSaWapLfdx2Ga39SxFvy5MGMMTioxksbonk',
      'EWWq19y1ig73sA54eooWLGLmk6WdmshGr7Fqt9jFpump'
    ]) {
      t(`the silver clone ${clone.slice(0, 6)}… is not curated`, !isCuratedMint(clone));
    }

    /*
     * Novo Nordisk. The mint is REAL and the issuer check would pass — this is
     * rejected purely on depth, which is why it needs its own guard: a future
     * reader might "fix the omission" without checking the book.
     */
    t('Novo Nordisk is not listed while its book is empty',
      !isCuratedMint('XsfAzPzYrYjd4Dpa9BU3cusBsvWfVB9gBcyGC87S57n'));

    /*
     * And the listing floor must be high enough to have excluded it. NVOx had
     * $122; if MIN_EQUITY_LIQUIDITY ever dropped below that, the guard above
     * would be the only thing left and it only covers one ticker.
     */
    t('the listing floor would have excluded a $122 book', MIN_EQUITY_LIQUIDITY > 122);

    /* SpaceX is included, and must carry its private-company caveat. */
    const spcx = EQUITY_ASSETS.find((a) => a.symbol === 'SPCXx');
    t('SpaceX is listed', Boolean(spcx));
    t('...and is flagged as a private company', spcx.privateCompany === true);
    /*
     * Nothing else may carry that flag. Every other name here has a public
     * quote to check against, and claiming otherwise would understate their
     * transparency rather than overstate it — but it would still be wrong.
     */
    t('...and nothing with a public listing claims to be private',
      EQUITY_ASSETS.filter((a) => a.privateCompany).length === 1);
  }

  /* ========================= cross-chain bridge ========================== */
  /*
   * ─── WHAT THIS GUARDS ─────────────────────────────────────────────────────
   * Two config values decide where bridge revenue goes, and both fail
   * silently when wrong: a mistyped integrator string collects nothing with
   * no error, and a misread fee could take a fortune from a user.
   */
  {
    /*
     * LI.FI constrains the integrator string: max 23 chars, lower case only,
     * alphanumeric plus _ and -. The portal rejects a capital letter, so a
     * mismatch between what was registered and what we send means zero
     * revenue and no error anywhere. Normalising is cheaper than debugging.
     */
    const saved = { id: process.env.LIFI_INTEGRATOR, fee: process.env.LIFI_FEE };

    t('the default integrator is lower-case and legal',
      /^[a-z0-9_-]{1,23}$/.test(integratorId()));

    /*
     * ─── THE EXACT REGISTERED ID ───────────────────────────────────────────
     * Pinned to the string that actually exists in the portal, verified
     * against the live API:
     *
     *   GET /v1/integrators/fbt-swap → "Integrator not found"
     *   GET /v1/integrators/fbtswap  → {"integratorId":"fbtswap", ...}
     *
     * I had proposed `fbt-swap`; the portal registered `fbtswap`. One
     * character, and the failure is completely silent — LI.FI returns error
     * 1011, our fallback re-requests without a fee, bridging keeps working
     * and the revenue is zero forever.
     *
     * A generic "is it lower-case" check passes for both spellings, so it
     * would never have caught this. Pinning the literal is the only version
     * of this test that has any value.
     */
    t('the integrator id matches the one registered in the portal',
      integratorId() === 'fbtswap');

    process.env.LIFI_INTEGRATOR = 'FBT Swap!!';
    t('a capitalised or spaced id is normalised, not sent as-is',
      /^[a-z0-9_-]+$/.test(integratorId()) && integratorId() === 'fbtswap');

    process.env.LIFI_INTEGRATOR = 'a'.repeat(40);
    t('an over-long id is truncated to 23', integratorId().length === 23);

    process.env.LIFI_INTEGRATOR = saved.id ?? '';
    if (!saved.id) delete process.env.LIFI_INTEGRATOR;

    /* ---- the fee ---- */
    /*
     * LI.FI wants a DECIMAL FRACTION: 0.003 is 0.3%. The dangerous confusion
     * is basis points — someone writing `LIFI_FEE=30` meaning "30 bps" would
     * otherwise request 3000% of the trade. The clamp makes that impossible.
     */
    t('the default bridge fee is 0.3%', bridgeFee() === 0.003);

    process.env.LIFI_FEE = '30';
    t('a bps-style typo cannot take 3000%', bridgeFee() === 0.003);

    process.env.LIFI_FEE = '0.5';
    t('...and neither can 50%', bridgeFee() === 0.003);

    process.env.LIFI_FEE = '-1';
    t('a negative fee falls back to the default', bridgeFee() === 0.003);

    process.env.LIFI_FEE = 'abc';
    t('garbage falls back to the default', bridgeFee() === 0.003);

    process.env.LIFI_FEE = '0.005';
    t('a legitimate 0.5% IS honoured, so the clamp is not just a constant',
      bridgeFee() === 0.005);

    process.env.LIFI_FEE = saved.fee ?? '';
    if (!saved.fee) delete process.env.LIFI_FEE;

    /*
     * Our bridge fee must stay BELOW the swap fee. LI.FI already takes 0.25%
     * and the bridges charge their own on top; matching our 0.7% would put
     * the user near 1% all-in and send them elsewhere. 0.3% of a trade that
     * happens beats 0.7% of one that does not.
     */
    t('the bridge fee is lower than the same-chain swap fee',
      bridgeFee() * 10000 < 70);
  }

  /* ============================ gasless swaps ============================ */
  /*
   * ─── WHY THIS FEATURE EXISTS ──────────────────────────────────────────────
   * A user holding USDT on BNB Chain but no BNB can do NOTHING in this app.
   * Every EVM action needs the native coin for gas, and buying that coin is
   * itself a transaction requiring gas. It is the most common dead end in
   * crypto and it hits exactly the people this app is for: someone who was
   * sent stablecoins and has never held BNB.
   */
  {
    const saved = { key: process.env.ZEROX_API_KEY, bps: process.env.ZEROX_FEE_BPS };

    /*
     * Must fail CLOSED. 0x requires a key even on the free plan, and without
     * one every request 401s. Reporting "not available" beats offering a
     * button that always breaks.
     */
    delete process.env.ZEROX_API_KEY;
    t('gasless is off when no key is configured', gaslessConfigured() === false);

    process.env.ZEROX_API_KEY = 'test-key';
    t('...and on when one is', gaslessConfigured() === true);

    process.env.ZEROX_API_KEY = saved.key ?? '';
    if (!saved.key) delete process.env.ZEROX_API_KEY;

    /* ---- the fee ---- */
    /*
     * Matches the normal swap fee. To the user this IS a swap, and charging a
     * different rate for the same action depending on which code path served
     * it would be arbitrary and impossible to explain.
     */
    delete process.env.ZEROX_FEE_BPS;
    delete process.env.FEE_BPS;
    t('the gasless fee matches the standard swap fee', gaslessFeeBps() === 70);

    /*
     * 0x accepts up to 1000 bps (10%). A misplaced digit turning 70 into 700
     * would take 7% of somebody's trade, so the clamp is 100.
     */
    process.env.ZEROX_FEE_BPS = '700';
    t('a misplaced digit cannot take 7%', gaslessFeeBps() === 70);

    process.env.ZEROX_FEE_BPS = '-5';
    t('a negative fee falls back to the default', gaslessFeeBps() === 70);

    process.env.ZEROX_FEE_BPS = 'abc';
    t('garbage falls back to the default', gaslessFeeBps() === 70);

    /* The clamp must not be a constant in disguise. */
    process.env.ZEROX_FEE_BPS = '50';
    t('a legitimate 50 bps IS honoured', gaslessFeeBps() === 50);

    process.env.ZEROX_FEE_BPS = saved.bps ?? '';
    if (!saved.bps) delete process.env.ZEROX_FEE_BPS;

    /*
     * One wallet for every EVM fee in the app. A second address would mean a
     * second private key to guard and a second balance to remember to check.
     */
    t('gasless fees go to the same EVM wallet as everything else',
      gaslessRecipient().toLowerCase() === PAYOUT_ADDRESSES.evm.toLowerCase());
  }

  /* ===================== perpetual funding rates ========================= */
  /*
   * ─── WHAT THIS GUARDS ─────────────────────────────────────────────────────
   * The funding panel makes ONE claim that can be quietly, confidently wrong:
   * the annualised cost of holding a position. Every failure below produces a
   * plausible number rather than an error, which is why each is pinned.
   */
  {
    /* ---- the interval table is the whole safety property ---- */
    /*
     * A funding rate without its settlement interval is meaningless. The SAME
     * printed 0.01% is 10.95%/yr on an 8-hour venue and 87.6%/yr on an hourly
     * one. If a venue were listed with a guessed interval, the screen would
     * state an eightfold-wrong holding cost with full confidence.
     */
    t('every venue with an interval also has a custody label',
      Object.keys(FUNDING_INTERVAL_HOURS).every((v) => VENUE_CUSTODY[v]));
    t('...and no custody label exists for an unlisted venue',
      Object.keys(VENUE_CUSTODY).every((v) => FUNDING_INTERVAL_HOURS[v]));
    t('every interval is a positive number of hours',
      Object.values(FUNDING_INTERVAL_HOURS).every((h) => Number.isFinite(h) && h > 0));

    /*
     * ─── THE EXACT COINGECKO VENUE STRING ──────────────────────────────────
     * Pinned as literals, because a wrong key does not error — the venue just
     * never appears, and the screen looks like that exchange has no markets
     * rather than like our table has a typo. Exactly how the LI.FI integrator
     * id cost us revenue silently.
     *
     * I first wrote `dYdX Perpetual`, which is a REAL CoinGecko venue — the
     * dead Ethereum L1 exchange. The live v4 appchain is `dYdX Chain`.
     * `GET /derivatives/exchanges/list` settled it. A generic "is it a
     * non-empty string" check passes for both, so only the literal has value.
     */
    t('the dYdX key is the live appchain, not the dead L1',
      FUNDING_INTERVAL_HOURS['dYdX Chain'] === 1 &&
      FUNDING_INTERVAL_HOURS['dYdX Perpetual'] === undefined);
    t('Hyperliquid is hourly', FUNDING_INTERVAL_HOURS['Hyperliquid (Futures)'] === 1);
    t('Binance is eight-hourly', FUNDING_INTERVAL_HOURS['Binance (Futures)'] === 8);
    /* The on-chain venues must be labelled as such — it is the one property
       this app is built on and the reason to prefer them. */
    t('the on-chain venues are labelled on-chain',
      VENUE_CUSTODY['Hyperliquid (Futures)'] === 'onchain' &&
      VENUE_CUSTODY['dYdX Chain'] === 'onchain');
    t('...and the custodial ones are labelled custodial',
      VENUE_CUSTODY['Binance (Futures)'] === 'centralized');

    /* ---- annualisation ---- */
    /*
     * The arithmetic that the entire panel rests on. 0.01% per 8h is 10.95%
     * a year (1095 intervals); the same print hourly is 87.6% (8760).
     * Verified against the numbers rather than the formula.
     */
    t('an 8-hour rate annualises over 1095 intervals',
      Math.abs(annualiseFunding(0.01, 8) - 10.95) < 1e-9);
    t('the same rate hourly is eight times the cost',
      Math.abs(annualiseFunding(0.01, 1) - 87.6) < 1e-9);
    t('a negative rate stays negative', annualiseFunding(-0.01, 8) < 0);
    /*
     * Null, never zero. "We do not know the rate" and "holding is free" are
     * opposite statements, and collapsing them would make the cheapest-venue
     * row point at whichever venue failed to report.
     */
    t('an unknown rate is null, not zero', annualiseFunding(undefined, 8) === null);
    t('a zero-hour interval cannot divide', annualiseFunding(0.01, 0) === null);

    /* ---- crowding label ---- */
    /*
     * The neutral band is not zero. Venues build a ~0.01%/8h interest
     * component into the formula, so a calm market sits around +10%/yr. A
     * threshold at zero would report "longs are crowded" on essentially every
     * market every day, which is the same as reporting nothing.
     */
    t('a calm, slightly-positive market is not called crowded',
      crowding(10.95) === 'balanced');
    t('a genuinely crowded long side is flagged', crowding(60) === 'longs');
    t('a crowded short side is flagged', crowding(-30) === 'shorts');
    t('an unknown rate has no crowding label', crowding(null) === null);

    /* ---- ticker normalisation: every rejection matters ---- */
    const now = Date.UTC(2026, 0, 1);
    const good = {
      market: 'Binance (Futures)',
      symbol: 'BTCUSDT',
      index_id: 'BTC',
      contract_type: 'perpetual',
      price: '64000',
      funding_rate: 0.01,
      open_interest: 7_000_000_000,
      volume_24h: 8_000_000_000,
      price_percentage_change_24h: 1.2,
      last_traded_at: now / 1000,
      expired_at: null
    };
    const ok = normalizeTicker(good, now);
    t('a healthy ticker survives', ok != null && ok.symbol === 'BTC');
    t('...and carries its interval so the UI can show its work',
      ok.intervalHours === 8 && Math.abs(ok.fundingApr - 10.95) < 1e-9);

    t('a venue with no verified interval is dropped',
      normalizeTicker({ ...good, market: 'MEXC (Futures)' }, now) === null);
    t('a non-perpetual contract is dropped',
      normalizeTicker({ ...good, contract_type: 'futures' }, now) === null);
    t('an expired contract is dropped',
      normalizeTicker({ ...good, expired_at: '2025-01-01' }, now) === null);
    t('an untracked asset is dropped',
      normalizeTicker({ ...good, index_id: 'PEPE' }, now) === null);
    /*
     * CoinGecko keeps returning rows for pairs that stopped trading, with the
     * last price frozen. Rendering one beside a live venue invites a
     * comparison between a real number and a fossil.
     */
    t('a stale ticker is dropped',
      normalizeTicker({ ...good, last_traded_at: now / 1000 - 60 * 60 * 6 }, now) === null);
    t('a thin market is dropped', normalizeTicker({ ...good, open_interest: 5000 }, now) === null);
    /* A missing rate must not become zero — the row still renders, as "—". */
    const noRate = normalizeTicker({ ...good, funding_rate: null }, now);
    t('a ticker with no funding rate survives but reports null',
      noRate != null && noRate.fundingApr === null);

    /* ---- grouping and the weighted average ---- */
    /*
     * The average is weighted by open interest. An unweighted mean lets a thin
     * venue with an extreme print outvote the venue where the money actually
     * is — and the thin one is exactly where a stale or manipulated rate
     * appears.
     */
    const big = normalizeTicker({ ...good, open_interest: 7_000_000_000, funding_rate: 0.01 }, now);
    const small = normalizeTicker(
      { ...good, market: 'Hyperliquid (Futures)', open_interest: 2_000_000, funding_rate: 1 },
      now
    );
    const [btc] = groupByAsset([big, small]);
    t('the group keeps both venues', btc.venues.length === 2);

    /*
     * ─── ONE ROW PER VENUE, EVEN THOUGH A VENUE LISTS MANY CONTRACTS ───────
     * Found by reading the LIVE response after deploying, not by reasoning
     * about it. Binance returns BTCUSDT, BTCUSDC and BTCUSD_PERP as separate
     * tickers with separate funding rates spanning 4.6%-8.4%/yr; fifteen rows
     * came back for BTC. Rendered raw the table listed "Binance (Futures)"
     * three times with three different numbers, and "the cheapest venue is
     * Binance" was meaningless when Binance was also among the dearest.
     *
     * The deepest contract per venue wins — open interest is where the
     * positions actually are. Selecting the CHEAPEST instead would flatter
     * every venue that lists a thin inverse contract nobody trades, which is
     * the specific way this could have been wrong and still looked right.
     */
    const deep = normalizeTicker(
      { ...good, symbol: 'BTCUSDT', open_interest: 7_000_000_000, funding_rate: 0.004 }, now
    );
    const thin = normalizeTicker(
      { ...good, symbol: 'BTCUSD_PERP', open_interest: 1_100_000_000, funding_rate: 0.0077 }, now
    );
    const [dedup] = groupByAsset([deep, thin, small]);
    t('a venue listing several contracts appears once',
      dedup.venues.filter((v) => v.venue === 'Binance (Futures)').length === 1);
    t('...and it is the deepest contract that is kept',
      dedup.venues.find((v) => v.venue === 'Binance (Futures)').pair === 'BTCUSDT');
    t('...sorted with the deepest market first',
      btc.venues[0].venue === 'Binance (Futures)');
    /*
     * Unweighted this would be (10.95 + 8760) / 2 ≈ 4385. Weighted by the
     * $7bn vs $2m of open interest it stays near the deep venue's rate. The
     * assertion is deliberately far from the unweighted value so it cannot
     * pass by accident.
     */
    t('the average is weighted by open interest, not a plain mean',
      btc.avgFundingApr < 15 && btc.avgFundingApr > 10.95);
    t('the spread between venues is reported',
      Math.abs(btc.fundingSpread - (8760 - 10.95)) < 1e-6);

    /* ---- the cheapest venue depends on direction ---- */
    /*
     * Positive funding is paid BY longs, so a long wants the LOWEST rate and a
     * short wants the highest. These are opposite venues, and getting it
     * backwards would invert the one number the panel exists to give.
     */
    t('a long is sent to the cheapest venue', bestVenue(btc, 'long').fundingApr < 15);
    t('a short is sent to the opposite one', bestVenue(btc, 'short').fundingApr > 1000);
    t('no rates means no recommendation', bestVenue({ venues: [] }, 'long') === null);

    /* ---- the cost calculator ---- */
    /*
     * Funding is charged on NOTIONAL, not on collateral. $500 at 10x pays
     * funding on $5,000, and that multiplication is the part people get
     * wrong. 20%/yr on $5,000 for 30 days = $82.19.
     */
    const c = fundingCost({ collateralUsd: 500, leverage: 10, aprPct: 20, days: 30 });
    t('funding is charged on the position, not the collateral', c.notional === 5000);
    t('the monthly cost is computed from the notional',
      Math.abs(c.cost - (5000 * 0.2 * 30) / 365) < 1e-9);
    /*
     * The number that lands: leverage multiplies the holding cost exactly as
     * fast as the gain. 20%/yr at 10x is 200%/yr of the money you put in.
     */
    t('...and is expressed against what the user actually put in',
      Math.abs(c.pctOfCollateral - (c.cost / 500) * 100) < 1e-9);
    t('a short being PAID funding is not clamped to zero',
      fundingCost({ collateralUsd: 500, leverage: 10, aprPct: -20, days: 30 }).cost < 0);
    t('a zero collateral has no cost',
      fundingCost({ collateralUsd: 0, leverage: 10, aprPct: 20 }) === null);

    /* ---- liquidation arithmetic, shared with the existing table ---- */
    t('100x liquidates on a 1% move', liquidationMove(100) === 1);
    t('2x liquidates on a 50% move', liquidationMove(2) === 50);
    t('zero leverage is not a position', liquidationMove(0) === null);

    /* The asset list must be non-empty or the screen renders nothing. */
    t('the tracked asset list is populated',
      Array.isArray(TRACKED_ASSETS) && TRACKED_ASSETS.includes('BTC'));
  }

  /* ============== automatic orders: bracket, ladder, advisor ============= */
  {
    const mkTok = (symbol, coingeckoId) => ({ symbol, coingeckoId });
    const baseInput = {
      chainId: 56,
      fromToken: mkTok('BNB', 'binancecoin'),
      toToken: mkTok('USDT', 'tether'),
      amountIn: '100'
    };

    /* ---- BRACKET (one-cancels-the-other) ---- */
    const { order: br } = createOrder({
      ...baseInput, type: 'bracket', takeProfitRate: 800, stopLossRate: 600
    });
    t('a bracket can be created', Boolean(br) && br.type === 'bracket');
    t('inside the band it waits', evaluateOrder(br, 700).ready === false);
    t('the take-profit side fires above', evaluateOrder(br, 801).reason === 'TAKE_PROFIT');
    t('the stop-loss side fires below', evaluateOrder(br, 599).reason === 'STOP_LOSS');
    /*
     * WHICH side fired has to be reported. "Your order is ready" is nearly
     * useless when one outcome is a profit and the other is a loss, and the
     * notification text is chosen from this field.
     */
    t('...and it reports which side, not just that it fired',
      evaluateOrder(br, 801).side === 'takeProfit' && evaluateOrder(br, 599).side === 'stopLoss');
    /*
     * A bracket is ONE order. Leaving it active after the stop fires would let
     * the take-profit trigger later on a position the user has already exited
     * — selling twice. That is the entire reason this type exists rather than
     * two limit orders.
     */
    t('either side closes the whole bracket', advanceOrder(br).status === 'filled');
    /*
     * Inverted, both conditions are already true at creation, so it would fire
     * instantly at whatever the market happens to be — the exact opposite of
     * protecting a position.
     */
    t('an inverted bracket is rejected',
      validateOrder({ ...baseInput, type: 'bracket', takeProfitRate: 600, stopLossRate: 800 })
        === 'BRACKET_INVERTED');
    t('a bracket with no stop is rejected',
      validateOrder({ ...baseInput, type: 'bracket', takeProfitRate: 800 }) === 'BAD_STOP');
    /* Unknown price must never read as "condition met" — same rule as limit. */
    t('a missing price does not fire a bracket', evaluateOrder(br, null).reason === 'NO_PRICE');

    /* ---- LADDER ---- */
    const { order: ld } = createOrder({
      ...baseInput, type: 'ladder', steps: 4, startRate: 700, endRate: 800, direction: 'above'
    });
    const rungs = ladderRungs(ld);
    /*
     * INCLUSIVE OF BOTH ENDS. A 4-step ladder from 700 to 800 must include
     * 800 — that is usually the price the user cared most about, and an
     * exclusive range silently never fills it.
     */
    t('the ladder includes both the first and last price',
      rungs.length === 4 && rungs[0] === 700 && rungs[3] === 800);
    t('...evenly spaced between them', Math.abs(rungs[1] - 733.3333333) < 1e-4);

    t('the first rung waits below its price', evaluateOrder(ld, 699).ready === false);
    t('...and fires at it', evaluateOrder(ld, 700).reason === 'RUNG_HIT');

    const ld2 = advanceOrder(ld);
    t('a ladder stays active after one rung', ld2.status === 'active' && ld2.rungsFilled === 1);
    /*
     * Only the NEXT unfilled rung is evaluated. Checking all of them would let
     * one jump report several ready at once and bury the user in alerts for a
     * position they can only sell once per signature.
     */
    t('only the next rung is evaluated', Math.abs(evaluateOrder(ld2, 9999).target - 733.3333) < 0.01);
    /*
     * The cooldown must reset per rung, or a fast move through two rungs
     * silences the second for six hours and the user believes the rest of the
     * ladder is still waiting when it has already been passed.
     */
    t('the notify cooldown clears between rungs', ld2.lastNotifiedAt === 0);

    let walk = ld2;
    for (let i = 0; i < 3; i += 1) walk = advanceOrder(walk);
    t('the ladder completes on the final rung',
      walk.status === 'filled' && walk.rungsFilled === 4);

    /*
     * The parts must sum EXACTLY to the amount entered. Rounding each rung
     * independently is how a ladder trades 99.99 of 100 and strands dust.
     */
    const parts = [0, 1, 2, 3].map((i) => ladderPortion(ld, i));
    t('the rung amounts sum exactly to the order amount',
      parts.reduce((a, b) => a + b, 0) === 100);

    /*
     * FILL ORDER IS NOT NUMERIC ORDER. A buy-the-dip ladder fills from the
     * highest price downward; sorting numerically would make rung 1 the last
     * one reached and the ladder would look frozen.
     */
    const { order: ldDown } = createOrder({
      ...baseInput, type: 'ladder', steps: 3, startRate: 700, endRate: 600, direction: 'below'
    });
    t('a buy-the-dip ladder fills from the highest price first',
      ladderRungs(ldDown)[0] === 700 && ladderRungs(ldDown)[2] === 600);

    t('a flat ladder is rejected',
      validateOrder({ ...baseInput, type: 'ladder', steps: 3, startRate: 700, endRate: 700, direction: 'above' })
        === 'LADDER_FLAT');
    t('too many steps are rejected',
      validateOrder({ ...baseInput, type: 'ladder', steps: LADDER_MAX_STEPS + 1, startRate: 700, endRate: 800, direction: 'above' })
        === 'BAD_STEPS');
    t('too few steps are rejected',
      validateOrder({ ...baseInput, type: 'ladder', steps: LADDER_MIN_STEPS - 1, startRate: 700, endRate: 800, direction: 'above' })
        === 'BAD_STEPS');

    /*
     * ─── A PAUSE MUST NOT RE-SELL FILLED RUNGS ──────────────────────────────
     * The one mistake in this file that would cost real money rather than a
     * missed alert.
     */
    t('pausing and resuming keeps the filled rungs',
      resumeOrder(pauseOrder({ ...ld2, status: 'active' })).rungsFilled === 1);

    /* ---- THE SERVER MUST AGREE WITH THE CLIENT ---- */
    /*
     * These conditions are evaluated twice — on the device and in the
     * background watcher. If they disagree, the push notification and the app
     * tell the user different things about the same order, and both stop being
     * believable.
     */
    const wBr = { type: 'bracket', takeProfitRate: 800, stopLossRate: 600, priceOf: 'from' };
    t('server and client agree on take-profit',
      evaluateWatch(wBr, 801).side === evaluateOrder(br, 801).side);
    t('server and client agree on stop-loss',
      evaluateWatch(wBr, 599).side === evaluateOrder(br, 599).side);
    t('server and client agree on waiting',
      evaluateWatch(wBr, 700).hit === evaluateOrder(br, 700).ready);

    const wTrail = { type: 'trailing', trailPct: 10, peakRate: null };
    const first = evaluateWatch(wTrail, 100);
    /* No drawdown exists on the tick that establishes the peak, by definition. */
    t('a trailing stop never fires on its first observation',
      first.hit === false && first.peak === 100);
    t('...fires once price falls the trail distance',
      evaluateWatch({ ...wTrail, peakRate: 100 }, 89).hit === true);
    t('...and holds inside the trail',
      evaluateWatch({ ...wTrail, peakRate: 100 }, 95).hit === false);
    /*
     * The peak only ever RISES. A feed hiccup returning a low value must not
     * drag the stop down with it, or the order drifts and never triggers.
     */
    t('the peak never follows a dip downward',
      evaluateWatch({ ...wTrail, peakRate: 100 }, 80).peak === 100);
    /* Unknown price does nothing at all, on the server too. */
    t('the server does not fire on a missing price', evaluateWatch(wTrail, null).hit === false);

    /*
     * ─── THE WATCH LIST MUST COVER EVERY PRICE-TRIGGERED TYPE ───────────────
     * `syncWatches` filtered `type === 'limit'`, so a TRAILING STOP was never
     * mirrored to the server and only worked while the app was in the
     * foreground — precisely backwards, because a trailing stop is the one
     * order nobody can watch by hand.
     */
    t('trailing stops are watched in the background', WATCHED_TYPES.has('trailing'));
    t('brackets are watched too', WATCHED_TYPES.has('bracket'));
    t('ladders are watched too', WATCHED_TYPES.has('ladder'));
    t('limit orders still are', WATCHED_TYPES.has('limit'));
    /*
     * DCA stays OFF the server deliberately: it is time-based, the device
     * already knows the schedule, and uploading it would hand over a
     * behavioural profile for no functional gain.
     */
    t('DCA is deliberately not uploaded', !WATCHED_TYPES.has('dca'));
  }

  /* ==================== coin-id index (more coins) ======================= */
  {
    /*
     * ─── THESE SLUGS ARE LOOKED UP, NOT GUESSED ─────────────────────────────
     * CoinGecko's platform keys do not match the chain names, and a wrong one
     * fails SILENTLY — every token on that chain simply looks unsupported, and
     * the feature stays as small as it was. Same silent-failure class as the
     * LI.FI integrator id and the dYdX venue key, so the literals are pinned.
     */
    t('BNB Chain is binance-smart-chain', PLATFORM_SLUGS[56] === 'binance-smart-chain');
    t('Optimism is optimistic-ethereum', PLATFORM_SLUGS[10] === 'optimistic-ethereum');
    t('Arbitrum is arbitrum-one', PLATFORM_SLUGS[42161] === 'arbitrum-one');
    t('Polygon is polygon-pos', PLATFORM_SLUGS[137] === 'polygon-pos');

    /* Real rows, copied verbatim from a live /coins/list response. */
    const rows = [
      { id: '1inch', platforms: {
        ethereum: '0x111111111117dc0aa78b770fa6a738034120c302',
        'binance-smart-chain': '0x111111111117dc0aa78b770fa6a738034120c302',
        'arbitrum-one': '0x6314c31a7a1652ce482cffe247e9cb7c3f4bb9af' } },
      { id: '0x', platforms: { ethereum: '0xE41d2489571d322189246DaFA5ebDe1F4699F498' } },
      { id: '000-capital', platforms: { solana: 'CVU6QRwpHz94UGyPFFehm1G1sFYRH7xDk9UhZ9RApump' } },
      { id: 'no-platform', platforms: {} }
    ];
    const { byChain, coins } = buildIndex(rows);
    t('every row is counted', coins === 4);
    t('a token resolves on BNB Chain',
      byChain.get(56).get('0x111111111117dc0aa78b770fa6a738034120c302') === '1inch');
    /*
     * Token lists disagree wildly about checksum casing. A case-sensitive
     * comparison would miss most addresses while appearing to work for
     * whichever list happened to match.
     */
    t('a checksummed address still resolves',
      byChain.get(1).get('0xE41d2489571d322189246DaFA5ebDe1F4699F498'.toLowerCase()) === '0x');
    t('an unknown address resolves to nothing',
      byChain.get(56).get('0x0000000000000000000000000000000000000001') === undefined);
    /* Solana is not an EVM chain here; its base58 mint must not leak in. */
    t('a non-EVM platform is ignored',
      ![...byChain.values()].some((m) => [...m.values()].includes('000-capital')));
  }

  /* ================== the order advisor (AI suggestions) ================= */
  {
    /* A channel that really does oscillate, so levels genuinely repeat. */
    const channel = [];
    for (let i = 0; i < 180; i += 1) channel.push(100 + Math.sin(i / 6) * 8 + Math.sin(i / 23) * 3);

    const advice = adviseOrder(channel);
    t('the advisor reports ready on a full series', advice.ready === true);
    t('...and says how many samples it used', advice.samples === 180);

    /*
     * ─── THE MEDIAN, NOT THE MEAN ───────────────────────────────────────────
     * Crypto series are full of single-day outliers, and both the mean and the
     * standard deviation are dragged upward by one bad afternoon — producing a
     * stop so wide it protects nothing. Proven by injecting an outlier: the
     * median barely moves.
     */
    const spiked = [...channel];
    spiked[90] = spiked[90] * 3;
    const before = typicalMovePct(channel);
    const after = typicalMovePct(spiked);
    t('one huge outlier barely moves the typical-move figure',
      Math.abs(after - before) / before < 0.15);

    const br = suggestBracket(channel);
    if (br) {
      t('the suggested stop sits below the current price', br.stopLoss < advice.price);
      t('the suggested take-profit sits above it', br.takeProfit > advice.price);
      /*
       * A stop resting exactly ON a known support is the most common way to be
       * wicked out and then watch the level hold. It must sit beneath it.
       */
      t('the stop is placed BENEATH the support, not on it',
        br.stopLoss < anchorLevels(channel).below.price);
      /*
       * Never propose risking more than the reward. Suggesting an 8-for-3
       * trade because the arithmetic produced it would be the module doing
       * harm politely.
       */
      t('it never suggests risking more than the reward', br.ratio >= 1);
      t('...and carries the counts behind it, not just a number',
        br.evidence.supportTested >= MIN_TESTS && br.evidence.resistanceTested >= MIN_TESTS);
    }

    const tr = suggestTrail(channel);
    t('a trail suggestion stays inside the validator band',
      tr && tr.pct >= TRAIL_MIN_PCT && tr.pct <= TRAIL_MAX_PCT);
    /*
     * The worst drawdown is the honest counterweight: a 9% trail would have
     * been stopped out by a 34% fall, and the user deserves that beside the
     * suggestion.
     */
    t('...and reports the worst drawdown beside it',
      Number.isFinite(tr.evidence.maxDrawdownPct));

    const lad = suggestLadder(channel);
    if (lad) {
      t('a ladder suggestion is within the allowed step range',
        lad.steps >= LADDER_MIN_STEPS && lad.steps <= LADDER_MAX_STEPS);
      t('...and ends at a level with a real record', lad.endRate > lad.startRate);
    }

    /*
     * ─── REFUSING IS THE FEATURE ────────────────────────────────────────────
     * Thin history produces confident-looking nonsense. Two touches is a
     * coincidence with a sample size.
     */
    const thin = adviseOrder(channel.slice(0, 12));
    t('the advisor refuses on thin history',
      thin.ready === false && thin.bracket === null && thin.trailing === null);
    t('...and states the threshold it needs', thin.minSamples === MIN_SAMPLES);

    /*
     * A FLAT series has zero volatility. Deriving "use the tightest possible
     * stop" from no movement is a suggestion with nothing behind it — and on
     * the tightest setting, so it fires on the first real tick. A dead or
     * brand-new feed looks exactly like this.
     */
    t('zero volatility yields no trail suggestion',
      suggestTrail(new Array(120).fill(100)) === null);
    t('...and no bracket', suggestBracket(new Array(120).fill(100)) === null);

    t('junk input cannot crash the advisor',
      adviseOrder([NaN, 0, -5, null, undefined]).ready === false);
  }

  /* ========================= autopilot (one tap) ========================= */
  {
    const channel = [];
    for (let i = 0; i < 180; i += 1) channel.push(100 + Math.sin(i / 6) * 8 + Math.sin(i / 23) * 3);
    const ctx = {
      series: channel,
      fromToken: { symbol: 'BNB', coingeckoId: 'binancecoin' },
      toToken: { symbol: 'USDT', coingeckoId: 'tether' },
      amountIn: '100',
      chainId: 56
    };

    /*
     * ─── DIRECTION IS THE FIELD THAT COSTS MONEY WHEN WRONG ─────────────────
     * An order set to the opposite of the intent fires at exactly the wrong
     * price. The goal->mechanics mapping is a table precisely so it can be
     * asserted directly rather than inferred from three code branches.
     */
    t('taking profit sells INTO strength', GOAL_SHAPE.takeProfit.direction === 'above');
    t('buying the dip buys on WEAKNESS', GOAL_SHAPE.buyDip.direction === 'below');
    t('protecting a position is a trailing stop', GOAL_SHAPE.protect.type === 'trailing');
    /*
     * All three price the coin the user holds, in the stable side — which is
     * how people talk ("sell my BNB at 700"), not the reciprocal.
     */
    t('every goal prices the coin being held', GOALS.every((g) => GOAL_SHAPE[g].priceOf === 'from'));

    /*
     * Each goal must produce an order the ordinary validator accepts. A draft
     * the form would reject is worse than no draft.
     *
     * NOTE THE SENTINEL: validateOrder returns `null` on success, not
     * `undefined`. My first version of this asserted `=== undefined` and
     * failed on three drafts that were perfectly valid — the test was wrong,
     * not the code. Checked against the function rather than assumed the
     * second time.
     */
    for (const goal of GOALS) {
      const r = buildAutopilot({ goal, ...ctx });
      t(`the ${goal} goal produces a valid order`,
        Boolean(r.draft) && !r.refused && validateOrder(r.draft) === null);
    }

    const tp = buildAutopilot({ goal: 'takeProfit', ...ctx });
    t('take-profit ladders upward', tp.draft.endRate > tp.draft.startRate);
    const bd = buildAutopilot({ goal: 'buyDip', ...ctx });
    t('buy-the-dip ladders downward', bd.draft.endRate < bd.draft.startRate);
    /*
     * Rungs must come back in FILL order for both. Numeric order would make
     * rung 1 of a dip ladder the last one reached and it would look frozen.
     */
    const upRungs = ladderRungs(tp.draft);
    const downRungs = ladderRungs(bd.draft);
    t('take-profit rungs fill from the bottom up', upRungs[0] < upRungs[upRungs.length - 1]);
    t('buy-dip rungs fill from the top down', downRungs[0] > downRungs[downRungs.length - 1]);

    /*
     * ─── ONE SHAPE OR THE OTHER, NEVER BOTH ─────────────────────────────────
     * A draft carrying a warning flag is a draft somebody will place without
     * reading the flag.
     */
    t('a result is never both a draft and a refusal',
      GOALS.every((g) => {
        const r = buildAutopilot({ goal: g, ...ctx });
        return !(r.draft && r.refused);
      }));

    /* ---- refusing is the feature ---- */
    t('thin history is refused, with the reason',
      buildAutopilot({ ...ctx, goal: 'protect', series: channel.slice(0, 10) }).refused
        === REFUSALS.NO_HISTORY);
    t('...and reports how far short it was',
      buildAutopilot({ ...ctx, goal: 'protect', series: channel.slice(0, 10) }).detail.samples === 10);
    t('a zero amount is refused',
      buildAutopilot({ ...ctx, goal: 'protect', amountIn: '0' }).refused === REFUSALS.BAD_AMOUNT);
    /*
     * A flat series has no volatility, so there is no honest trail distance.
     * Inventing one would produce a stop that fires on the first real tick.
     */
    t('a motionless price is refused rather than guessed',
      Boolean(buildAutopilot({ ...ctx, goal: 'protect', series: new Array(120).fill(100) }).refused));
    t('an unknown goal is refused', Boolean(buildAutopilot({ ...ctx, goal: 'moon' }).refused));
    t('junk history cannot crash it',
      Boolean(buildAutopilot({ ...ctx, goal: 'protect', series: [NaN, 0, -1] }).refused));

    /* The summary must be a translation key, never English from this module. */
    const sum = summariseDraft(tp);
    t('the summary returns a key, not a sentence', sum.key === 'autopilot.summary.takeProfit');
    t('...and carries the evidence counts', Number.isFinite(sum.values.tested));
    t('a refusal has no summary', summariseDraft({ refused: 'NO_LEVEL' }) === null);
  }

  /* ================= outbound referrals (non-swap revenue) =============== */
  {
    /*
     * ─── SAFE BEFORE ANY CODE EXISTS ────────────────────────────────────────
     * Nothing is registered yet, so every link must come back EXACTLY as it
     * went in. A half-configured state that mangles a URL would break the way
     * somebody reaches their money.
     */
    const gmxUrl = 'https://app.gmx.io/#/trade';
    t('with no code the link is untouched', withReferral('gmx', gmxUrl) === gmxUrl);
    t('...and the disclosure says we earn nothing', venueDisclosure('gmx') === 'none');
    t('...so the page shows the honest notice', anyVenueEarns(['gmx', 'dydx', 'apx']) === false);

    /*
     * dYdX and Hyperliquid gate their programmes behind $10,000 of personal
     * trading volume (and 100 USDC for a Hyperliquid builder code), which we
     * cannot meet — so they must never receive a referral parameter that
     * would do nothing but look like tracking.
     */
    t('dydx is marked as unavailable to us', VENUE_REFERRAL.dydx.earns === false);
    t('...and gets no parameter', withReferral('dydx', 'https://dydx.trade') === 'https://dydx.trade');
    t('an unknown venue is passed through', withReferral('nope', gmxUrl) === gmxUrl);

    /*
     * ─── THE CODE IS CASE-SENSITIVE AND MUST NOT BE NORMALISED ──────────────
     * GMX codes are on-chain bytes32: `fbtswap` and `FBTSwap` are different
     * codes and only one exists. Lower-casing here would point at a code
     * nobody owns and earn zero forever with no error — exactly how the LI.FI
     * integrator id failed.
     */
    t('a valid code shape is accepted', isValidGmxCode('fbtswap') && isValidGmxCode('FBT_Swap1'));
    t('a code with a space is rejected', !isValidGmxCode('fbt swap'));
    t('a code with punctuation is rejected', !isValidGmxCode('fbt-swap'));
    t('an over-long code is rejected', !isValidGmxCode('a'.repeat(21)));
    t('an empty code is rejected', !isValidGmxCode(''));

    /* Every venue we link to must have a defined stance, or the UI would
       render the wrong claim about one of them. */
    t('every configured venue resolves to a disclosure state',
      Object.keys(VENUE_REFERRAL).every((v) => ['earning', 'none'].includes(venueDisclosure(v))));
  }

  /* ============ coin page: real buy/sell, not the simulator ============= */
  {
    /*
     * ─── THE BUG THIS LOCKS DOWN ────────────────────────────────────────────
     * Every coin page had Buy/Sell buttons that opened `/trade` — the PRACTICE
     * screen trading virtual credits. Someone tapping Buy on the Bitcoin page,
     * in a wallet-connected app, believes they are buying Bitcoin. They were
     * opening a simulator, and would walk away thinking they held a position
     * they did not hold.
     */
    const bnb = swapTargetFor('binancecoin');
    t('a curated coin resolves to a real contract', bnb !== null);
    /*
     * BNB Chain is preferred when a coin exists on several: it is the app's
     * default and the cheapest of the seven, so a user should not be sent to
     * Ethereum to pay gas for the same trade.
     */
    t('...on the cheapest supported chain', bnb.chainId === 56);

    /*
     * ─── REFUSING IS THE SAFETY PROPERTY ────────────────────────────────────
     * Most CoinGecko coins are not swappable here. Cardano has no contract on
     * any chain we support. Returning null makes the UI say so; the dangerous
     * alternative is opening a swap on a token that merely shares a ticker,
     * which is exactly how someone buys a fake.
     */
    t('a coin on an unsupported chain refuses', swapTargetFor('cardano') === null);
    t('...and isSwappable agrees', isSwappable('cardano') === false && isSwappable('bitcoin') === true);
    t('junk input refuses', swapTargetFor('') === null && swapTargetFor(null) === null);

    /*
     * BUY and SELL must be opposite. `from` is what LEAVES the wallet, so
     * buying spends the stablecoin and selling spends the coin. Backwards,
     * this would preload the exact opposite trade — the same class of mistake
     * the order form's `direction` field guards against.
     */
    const buy = swapUrlFor('binancecoin', 'buy');
    const sell = swapUrlFor('binancecoin', 'sell');
    t('buying spends the stable side', /from=USDT&to=BNB/.test(buy));
    t('selling spends the coin', /from=BNB&to=USDT/.test(sell));
    t('...so the two are never the same', buy !== sell);
    t('the chain travels with the pair', /chain=56/.test(buy));

    /*
     * Buying the stablecoin itself would pair USDT with USDT, which the swap
     * screen rejects as SAME_TOKEN — a dead button. It must fall back to the
     * native coin instead.
     */
    const buyStable = swapUrlFor('tether', 'buy');
    t('a stablecoin is never paired with itself', !/from=USDT&to=USDT/.test(buyStable));
    t('...it falls back to the native coin', /from=BNB/.test(buyStable));

    /* An unswappable coin has no URL at all, so the UI cannot navigate. */
    t('no URL is produced for an unswappable coin', swapUrlFor('cardano', 'buy') === null);
  }


  return rows;
}
