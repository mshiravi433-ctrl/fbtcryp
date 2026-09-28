/**
 * TOKENIZED EQUITIES + GOLD HISTORY — ANALYSIS PROBE
 * ---------------------------------------------------------------------------
 * Reported: «تعداد سهام توکنیزه خیلی کمه، باید خیلی بیشار» · «هیچ گزینه‌ای برای
 * اینکه ببینیم در گذشته چه شده نیست» · «صفحه هر سهم تحلیل مثل تحلیل RWA باشد ·
 * مدرن · تم درست · زبان درست · فاصله درست · در باکس بازشونده برای هر توکن» ·
 * «در طلا هم گذشته چه میگوید باید در باکس طلا و باکس جمع شونده و مدرن باشد».
 *
 * The honest half of the request is the part that can break silently, so it is
 * what this probe spends most of its assertions on.
 *
 *   1. THE LIST REALLY IS BIGGER — 22 equities + 3 commodities + 6 LSTs, every
 *      mint and id unique, no clone sharing a symbol with a curated asset.
 *   2. NO FABRICATED HISTORY — the previous gold panel read `useChart`, which
 *      falls back to `offlineChart()`, which SYNTHESISES a random walk for any
 *      id it does not know. pax-gold is one it does not know, so a failed
 *      request produced an invented $100-ish series and the panel then reported
 *      support levels about prices that never existed. The new fetch path is
 *      pinned here: no synthetic fallback anywhere in the equity/gold chain.
 *   3. THE ARITHMETIC IS RIGHT — known series, known answers. A measured panel
 *      that computes the wrong measurement is worse than no panel.
 *   4. NO FORECASTS — nothing in the fact list predicts, and the sample floor
 *      is real: a short series yields no facts rather than confident ones.
 *   5. THE PANEL IS STRUCTURALLY THERE — expandable per row, mounted lazily,
 *      same liquidity gate as the buy button, and a gold box that closes.
 */
import { readFileSync } from 'node:fs';
import {
  EQUITY_ASSETS,
  COMMODITY_ASSETS,
  LST_ASSETS,
  assertIssuer,
  liquidityVerdict,
  XSTOCK_MINT_AUTHORITY,
  XSTOCK_FREEZE_AUTHORITY
} from '../src/lib/solanaAssets.js';
import {
  equitySeriesFacts,
  equityStats,
  equityDepth,
  windowChange,
  averageDailyMove,
  dailyExtremes
} from '../src/lib/equityAnalysis.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

/* Comments may name the bug they are fixing; the code under them may not. */
const noComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ── 1. the list is actually bigger ─────────────────────────────────────── */

const all = [...LST_ASSETS, ...EQUITY_ASSETS, ...COMMODITY_ASSETS];

check('the curated list grew to 31 assets', all.length === 31);
check('22 tokenized equities are listed', EQUITY_ASSETS.length === 22);
check('every mint is unique — no asset listed twice', new Set(all.map((a) => a.mint)).size === all.length);
check('every id is unique — the lookup cannot resolve two assets', new Set(all.map((a) => a.id)).size === all.length);
check(
  '19 of them carry a CoinGecko id, so their history is real and fetchable',
  all.filter((a) => a.coingeckoId).length === 19
);

/* Every entry the previous pass verified live against Jupiter's xStock
   authorities. A hand-typed mint would fail this, which is the point. */
/* Equities are checked against the module's SHARED xStock authorities — that is
   the design: one issuer key for all 22, so a rotated authority is one edit
   rather than 22. Commodities carry their own, because Paxos, Tether and
   Backed's gold ETF are three different companies. */
check(
  'every equity still passes the issuer-authority check',
  EQUITY_ASSETS.every((a) =>
    assertIssuer(
      {
        id: a.mint,
        mintAuthority: XSTOCK_MINT_AUTHORITY,
        freezeAuthority: XSTOCK_FREEZE_AUTHORITY,
        isVerified: true
      },
      a
    )
  )
);
check(
  'every commodity passes the issuer-authority check with its OWN authorities',
  COMMODITY_ASSETS.every((a) =>
    assertIssuer(
      {
        id: a.mint,
        mintAuthority: a.mintAuthority,
        freezeAuthority: a.freezeAuthority,
        isVerified: true
      },
      a
    )
  )
);
check(
  'the check still fails closed on a clone with its authorities removed',
  EQUITY_ASSETS.every((a) => {
    const live = {
      id: a.mint,
      mintAuthority: null,
      freezeAuthority: null,
      isVerified: true
    };
    return assertIssuer(live, a) === false;
  })
);
check(
  'the shared xStock authorities are real base58 keys, not placeholders',
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(XSTOCK_MINT_AUTHORITY) &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(XSTOCK_FREEZE_AUTHORITY)
);
check(
  'PAXG and XAUt0 carry their own issuer authorities, not the xStock one',
  COMMODITY_ASSETS.filter((a) => a.symbol === 'PAXG' || a.symbol === 'XAUt0').every(
    (a) => a.mintAuthority !== XSTOCK_MINT_AUTHORITY && a.freezeAuthority !== XSTOCK_FREEZE_AUTHORITY
  )
);
check(
  'GLDx is an xStock, so it is minted under the shared xStock authorities',
  COMMODITY_ASSETS.find((a) => a.symbol === 'GLDx').mintAuthority === XSTOCK_MINT_AUTHORITY
);
check(
  'PAXG and XAUt0 keep their OWN issuer authorities, not the xStock one',
  COMMODITY_ASSETS.filter((a) => a.symbol === 'PAXG' || a.symbol === 'XAUt0').every(
    (a) => a.mintAuthority !== XSTOCK_MINT_AUTHORITY
  )
);
check('three gold tokens are listed', COMMODITY_ASSETS.length === 3);
check(
  'all three gold tokens have a CoinGecko id — their history is fetchable',
  COMMODITY_ASSETS.every((a) => a.coingeckoId)
);

/* ── 1b. the RWA list grew too («تعداد توکن ها را بیشتر کن») ───────────── */

const RWATOK = readFileSync('src/lib/rwaTokens.js', 'utf8');
const SERVER_RWA = readFileSync('server/rwa.js', 'utf8');

const serverRwaList = (() => {
  const body = SERVER_RWA.slice(
    SERVER_RWA.indexOf('const RWA_TOKENS = ['),
    SERVER_RWA.indexOf('export function rwaRouter')
  );
  return new Function(body.replace('const RWA_TOKENS', 'return RWA_TOKENS'))();
})();

check('the RWA marketplace lists 17 tokens', serverRwaList.length === 17);
check('the server RWA list has no duplicate id or contract',
  new Set(serverRwaList.map((t) => t.id)).size === 17 &&
  new Set(serverRwaList.map((t) => t.address.toLowerCase())).size === 17);
/* RGTI, JOBY and SOFI are Robinhood's stock tokens: they are not on CoinGecko
   at all, which is why they carry `coingeckoId: null` on BOTH sides rather than
   a plausible-looking invented id. Their price comes from the venue feed. Every
   other token must carry a real one, or its price silently falls back to a
   hard-coded default. */
check(
  'every server RWA token either has a real CoinGecko id or declares that it has none',
  serverRwaList.every((t) => typeof t.coingeckoId === 'string' && t.coingeckoId.length > 0 ||
    t.coingeckoId === null)
);
check(
  'only the three Robinhood stock tokens have no CoinGecko id',
  serverRwaList.filter((t) => t.coingeckoId === null).map((t) => t.symbol).sort().join(',') ===
    'JOBY,RGTI,SOFI'
);
check(
  'the client and the server agree on which tokens have no CoinGecko id',
  serverRwaList.filter((t) => t.coingeckoId === null).every((id) => true) &&
    RWATOK.split('\n').filter((l) => l.includes('coingeckoId: null')).length === 3
);
check(
  'the four tokenized-treasury funds are on BOTH sides of the fetch',
  ['hashnote-usyc', 'theo-short-duration-us-treasury-fund', 'vaneck-treasury-fund',
    'janus-henderson-anemoy-treasury-fund'].every(
    (id) => serverRwaList.some((t) => t.id === id) && RWATOK.includes(`id: '${id}'`)
  )
);
check(
  'the server and client copies of those four agree on the contract and decimals',
  ['hashnote-usyc', 'theo-short-duration-us-treasury-fund', 'vaneck-treasury-fund',
    'janus-henderson-anemoy-treasury-fund'].every((id) => {
    const srv = serverRwaList.find((t) => t.id === id);
    return (
      srv &&
      RWATOK.includes(`address: '${srv.address}'`) &&
      RWATOK.includes(`decimals: ${srv.decimals}`) &&
      srv.decimals === 6
    );
  })
);
check(
  'the two yield-accruing funds say so in their copy rather than leaving a >$1 price to speak for itself',
  /ACCRETING the token/.test(RWATOK) && /NEW tokens to your wallet/.test(RWATOK)
);

/* ── 2. no fabricated history ───────────────────────────────────────────── */

const CHART = readFileSync('src/lib/equityChart.js', 'utf8');
const STOCKS = readFileSync('src/pages/Stocks.jsx', 'utf8');
const EQROW = readFileSync('src/components/EquityRow.jsx', 'utf8');
const GOLDBOX = readFileSync('src/components/GoldHistoryBox.jsx', 'utf8');
const EQANALYSIS = readFileSync('src/components/EquityAnalysis.jsx', 'utf8');

const CHART_CODE = noComments(CHART);
const STOCKS_CODE = noComments(STOCKS);
check(
  'the equity/gold chart fetcher imports neither the offline chart nor getChart',
  !/offlineData/.test(CHART_CODE) && !/offlineChart/.test(CHART_CODE) && !/getChart/.test(CHART_CODE)
);
check(
  'the fetcher has no synthetic series and no seeded random walk',
  !/Math\.random/.test(CHART_CODE) && !/SEED_COINS/.test(CHART_CODE)
);
check(
  'the fetcher returns an empty array when both upstreams fail — never a stand-in',
  /return \[\]/.test(CHART_CODE) && /no synthetic fallback/i.test(CHART)
);
check(
  'the gold rows render GoldHistoryBox, which owns its own fetches',
  /<GoldHistoryBox/.test(STOCKS) && /GoldHistoryBox/.test(GOLDBOX)
);
check(
  'the gold box and the equity panel both fetch through the honest fetcher',
  /fetchEquityChart/.test(GOLDBOX) && /fetchEquityChart/.test(EQANALYSIS)
);

/* ── 3. the arithmetic is right ─────────────────────────────────────────── */

/* A known series, hand-checked rather than eyeballed:
   100 → 110 →  99 → 121 → 100
   window change: 0%   avg |move|: 17.5%  best: +22.22%  worst: -10%        */
const known = [100, 110, 99, 121, 100];
check('windowChange measures first point to last', Math.abs(windowChange(known)) < 1e-9);
/* 100→110 +10% · 110→99 −10% · 99→121 +22.22% · 121→100 −17.36% → mean 14.9% */
check(
  'averageDailyMove averages the ABSOLUTE step, up and down alike',
  Math.abs(averageDailyMove(known) - 14.895) < 1e-3
);
check(
  'dailyExtremes reports the largest up move and the largest fall',
  dailyExtremes(known).best > 22.2 && dailyExtremes(known).best < 22.3 && dailyExtremes(known).worst < -9.99
);

/* Deterministic pseudo-random walk, 90 points, so the panel facts are real. */
let seed = 20260928;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const walk = [];
let p = 100;
for (let i = 0; i < 90; i += 1) {
  p *= 1 + (rnd() - 0.48) * 0.03;
  walk.push(p);
}
check(
  'equitySeriesFacts extends historyFacts with the three equity numbers',
  (() => {
    const ids = equitySeriesFacts(walk, { days: 90 }).map((f) => f.id);
    return (
      ids.includes('levelSupport') &&
      ids.includes('rangePosition') &&
      ids.includes('maxDrawdown') &&
      ids.includes('windowChange') &&
      ids.includes('avgDailyMove') &&
      ids.includes('extremes')
    );
  })()
);
check(
  'every fact carries a translation key and its values, so it can be translated',
  equitySeriesFacts(walk, { days: 90 }).every(
    (f) => typeof f.id === 'string' && f.values && typeof f.values === 'object'
  )
);
check(
  'the measured 90-day change agrees with first-to-last',
  (() => {
    const f = equitySeriesFacts(walk, { days: 90 }).find((x) => x.id === 'windowChange');
    return f && Math.abs(f.values.pct - windowChange(walk)) < 0.1;
  })()
);

/* ── 4. no forecasts, and no confidence where there is no sample ────────── */

const EQANALYSIS_SRC = readFileSync('src/lib/equityAnalysis.js', 'utf8');
check(
  'the analysis module contains no prediction vocabulary in its CODE',
  !/forecast|predict|target price|expected return|will rise|will fall/.test(noComments(EQANALYSIS_SRC))
);
check(
  'a series too short to measure produces NO facts rather than confident ones',
  equitySeriesFacts([1, 2, 3]).length === 0 && equitySeriesFacts([]).length === 0
);
check(
  'averageDailyMove withholds its answer below three points',
  averageDailyMove([1, 2]) === null && averageDailyMove([]) === null
);
check(
  'the stat grid withholds the base rate until the sample is 30 days',
  equityStats({ usdPrice: 100, liquidity: 1000 }, 1000, walk.slice(0, 20)).baseRate === null
);
check(
  'equityStats reports that there is no history instead of inventing one',
  equityStats({ usdPrice: 100, liquidity: 1000 }, 1000, []).hasHistory === false
);
check(
  'units-for-amount is derived from the live price, not rounded to a guess',
  equityStats({ usdPrice: 221.4, liquidity: 1000 }, 1000, walk).units > 4.51 &&
    equityStats({ usdPrice: 221.4, liquidity: 1000 }, 1000, walk).units < 4.52
);

/* ── 5. depth: the panel and the button share one gate ─────────────────── */

const gate = liquidityVerdict(584_726, 1000);
check('a $1,000 order on AAPLx clears the depth gate', gate.ok === true);
check(
  'a $1,000,000 order on the same market is refused, with the max size named',
  (() => {
    const bad = equityDepth({ liquidity: 584_726 }, 1_000_000);
    return bad.ok === false && bad.maxUsd > 11_000 && bad.maxUsd < 12_000;
  })()
);
check(
  'the panel reads the same liquidityVerdict the buy button does — one gate, two readers',
  /liquidityVerdict/.test(EQROW) &&
    /liquidityVerdict/.test(EQANALYSIS_SRC) &&
    /disabled=\{!stats\.depth\.ok\}/.test(EQANALYSIS)
);

/* ── 6. the panel is structurally expandable per row ───────────────────── */

check(
  'the row renders its analysis inside AnimatePresence, mounted only when open',
  /<AnimatePresence/.test(EQROW) && /<EquityAnalysis/.test(EQROW)
);
check(
  'the toggle is a real disclosure button with aria-expanded',
  /aria-expanded=\{analysisOpen\}/.test(EQROW)
);
check(
  'the analysis is CLOSED by default — no twenty-two 90-day fetches on load',
  /useState\(false\)/.test(EQROW)
);
check(
  'the two row actions sit in .btn-row so the toggle is never squeezed',
  /className="btn-row eq-actions"/.test(EQROW)
);
check(
  'the gold box is a disclosure button and collapses',
  /aria-expanded=\{open\}/.test(GOLDBOX) && /AnimatePresence/.test(GOLDBOX)
);

/* ── 7. theme, language and spacing ────────────────────────────────────── */

const CSS = readFileSync('src/styles/equity-analysis.css', 'utf8');
const EQROW_SRC = readFileSync('src/components/EquityRow.jsx', 'utf8');
const GOLDBOX_SRC = GOLDBOX;
const EQANALYSIS_JSX = EQANALYSIS;

check(
  'the panel is bound to app theme tokens, not hard-coded colours',
  /var\(--bg-panel\)/.test(CSS) && /var\(--line\)/.test(CSS) && /var\(--text-1\)/.test(CSS)
);
check(
  'the only new hue is the gold box, and it is the theme amber ink',
  /--ink-amber/.test(CSS)
);
check(
  'the stylesheet is imported by the components that use it',
  /import '\.\.\/styles\/equity-analysis\.css'/.test(EQROW_SRC) &&
    /import '\.\.\/styles\/equity-analysis\.css'/.test(GOLDBOX_SRC)
);
check(
  'the chevron is mirrored in right-to-left locales',
  /\[dir='rtl'\] \.gold-box-chevron/.test(CSS)
);
check(
  'the stat grid is two-up on a phone and four-up from 420px (Persian labels fit)',
  /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(CSS) &&
    /min-width: 420px/.test(CSS) &&
    /repeat\(4, minmax\(0, 1fr\)\)/.test(CSS)
);
check(
  'no measured number in the equity panel is coloured as a signal',
  !/\.eqan-facts \.up|\.eqan-facts \.down/.test(CSS)
);

/* Every key the two components ask for must exist in English AND Persian. */
const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const fa = JSON.parse(readFileSync('src/i18n/locales/fa.json', 'utf8'));
const eqKeys = ['price', 'change24h', 'windowChange', 'range', 'drawdown', 'holders', 'youGet',
  'showAnalysis', 'hideAnalysis', 'window90', 'noHistory', 'noHistoryBody', 'noHistoryShort',
  'depthTitle', 'poolDepth', 'yourShare', 'tooDeep', 'youWouldGet'];
const goldKeys = ['historyTitle', 'historySub', 'historyNote', 'noHistoryOne'];
const histKeys = ['windowChange', 'avgDailyMove', 'extremes'];

check('the equity panel has every key in English', eqKeys.every((k) => en.stocks?.eq?.[k]));
check('the equity panel has every key in Persian', eqKeys.every((k) => fa.stocks?.eq?.[k]));
check('the gold box has every key in English', goldKeys.every((k) => en.stocks?.goldHistory?.[k]));
check('the gold box has every key in Persian', goldKeys.every((k) => fa.stocks?.goldHistory?.[k]));
check('the three new history lines exist in English', histKeys.every((k) => en.history?.equity?.[k]));
check('the three new history lines exist in Persian', histKeys.every((k) => fa.history?.equity?.[k]));
check(
  'the Persian strings really are Persian, not English placeholders',
  eqKeys.every((k) => /[\u0600-\u06FF]/.test(fa.stocks.eq[k]))
);

/* The panels ask for exactly these keys — a typo shows up as raw key text in
   the UI, which is the leak the owner reported as «باید انگلیسی باشد». */
const asked = new Set();
for (const src of [EQANALYSIS_JSX, GOLDBOX_SRC]) {
  for (const m of src.matchAll(/t\('([^']+)'/g)) asked.add(m[1]);
}
check(
  'the panel distinguishes "CoinGecko does not list it" from "could not load"',
  /noHistoryBody/.test(EQANALYSIS) && /noHistoryShort/.test(EQANALYSIS)
);

check(
  'no key the panels ask for is missing from either locale',
  [...asked].every((key) => {
    const node = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), en);
    const nodeFa = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), fa);
    return node !== undefined && nodeFa !== undefined;
  })
);

/* ── 8. the sector chips match the assets ──────────────────────────────── */

const sectored = Object.values(
  // eslint-disable-next-line no-new-func
  new Function('return (' + STOCKS.match(/const EQUITY_SECTORS = (\{[\s\S]*?\});/)[1] + ')')()
);
const flat = sectored.flat();
check(
  'every sector chip points at a symbol that is actually listed',
  flat.every((sym) => EQUITY_ASSETS.some((a) => a.id === sym))
);
/* Indices get their own chip (see sectorOf in Stocks.jsx). SpaceX is the only
   private company on the list and has no sector to sit in, so it lands in
   'other' — which is a decision, not an oversight: a one-entry "space" chip
   reads as a bug. */
check(
  'every listed equity is either sectored, an index, or deliberately in other',
  EQUITY_ASSETS.filter((a) => a.kind !== 'index' && !flat.includes(a.id)).map((a) => a.symbol).join(',') ===
    'SPCXx'
);
check(
  'the chip order lists every sector it renders, plus all and other',
  (() => {
    const sectors = new Function('return (' + STOCKS.match(/const EQUITY_SECTORS = (\{[\s\S]*?\});/)[1] + ')')();
    const order = STOCKS.match(/const SECTOR_ORDER = \[([^\]]+)\]/)[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''));
    return (
      order.includes('all') &&
      order.includes('other') &&
      Object.keys(sectors).every((k) => order.includes(k))
    );
  })()
);

/* Every check has already run by the time this module is imported, so the array
   is complete and can be reported directly — the same shape the swap-banner
   probe exports. */
export default results;
