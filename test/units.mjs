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
import { pickPromoKey } from '../src/lib/notify.js';
import { analyze } from '../src/lib/ai.js';
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
      isSolanaAddress('9Z4wtiosH7JMXhKg8JpUPDCtB5ZyM8vzby14HwDidgVz'));
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

  return rows;
}
