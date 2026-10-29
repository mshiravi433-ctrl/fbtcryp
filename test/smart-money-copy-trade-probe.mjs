#!/usr/bin/env node
/**
 * SMART MONEY — «کپی تراکنش» + TOKEN TAB + CONTROLS — 2026-10-29
 * ---------------------------------------------------------------------------
 * The four things this pass added are all easy to break silently, because
 * every one of them still *renders* when it is wrong:
 *
 *   1. «کپی تراکنش» — a prefill deep link. A link that carries a SYMBOL would
 *      still open the swap screen, just not with the observed token; a link
 *      that carries a truncated address would open it empty. Swap.jsx
 *      deliberately splits its prefill into symbol (curated only), address
 *      (imported with a warning) and Solana mint paths, so the contract is
 *      asserted here, not assumed.
 *   2. The button has to exist on the surfaces that show REAL fills — the
 *      verified ledger, the wallet's observed swaps and the token rows — or
 *      the feature only exists in one corner of the app.
 *   3. The token tab used to be one empty section when the early-token feed
 *      was quiet. It must lead with the activity rows the overview already
 *      holds.
 *   4. The days rail and the network picker have to be the SAME height, or the
 *      rail looks half-filled again («باکس تا نصفه هست»).
 *
 * Runs with plain Node: no DOM, no network.
 * Run: node test/smart-money-copy-trade-probe.mjs
 */
import { readFileSync } from 'node:fs';
import { swapDeepLink, swapLinkForRow, counterStable } from '../src/lib/smartMoneySwap.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const load = (l) => JSON.parse(read(`../src/i18n/locales/${l}.json`));

let failures = 0;
const fail = (m) => { failures += 1; console.error(`✗ ${m}`); };
const ok = (m) => console.log(`✓ ${m}`);
const t = (name, cond) => (cond ? ok(name) : fail(name));
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EVM = '0x514910771af9ca656af840dff83e8264ecf986ca';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const page = strip(read('../src/pages/SmartMoney.jsx'));
const intel = strip(read('../src/components/SmartMoneyIntelligence.jsx'));
const wallet = strip(read('../src/pages/SmartMoneyWallet.jsx'));
const button = strip(read('../src/components/smart-money/CopyTradeButton.jsx'));
const css = strip(read('../src/styles/smart-money.css'));
const intelCss = strip(read('../src/styles/smart-money-intelligence.css'));
const server = strip(read('../server/smartMoney/intelligence.js'));
const fa = load('fa');
const en = load('en');

/* ── 1 · the deep link contract ─────────────────────────────────────────── */
const buy = swapDeepLink({ chain: 8453, token: EVM, side: 'BUY' });
const sell = swapDeepLink({ chain: 1, token: EVM, side: 'SELL' });
const sellBase = swapDeepLink({ chain: 8453, token: EVM, side: 'SELL' });
const solBuy = swapDeepLink({ chain: 'solana', token: MINT, side: 'BUY' });
const solSell = swapDeepLink({ chain: 'solana', token: MINT, side: 'SELL' });

t('a BUY travels by ADDRESS, never by symbol',
  buy?.startsWith('/swap?') && buy.includes(`toAddress=${EVM}`) && !/[?&]to=/.test(buy));
t('a SELL names the observed contract as the FROM leg and sets the side',
  sell?.includes(`fromAddress=${EVM}`) && sell.includes('side=sell'));
t('a SELL receives a curated stablecoin that exists on THAT chain',
  sell?.includes('to=USDT') && sellBase?.includes('to=USDC') && counterStable(8453) === 'USDC');
t('the chain id travels with an EVM handoff',
  buy?.includes('chain=8453') && sell?.includes('chain=1'));
t('a Solana BUY is a mint handoff on the Solana screen',
  solBuy === `/solana?toMint=${MINT}`);
t('a Solana SELL flips the pair with side=sell',
  solSell === `/solana?toMint=${MINT}&side=sell`);
t('an unusable address returns null (no dead button, no empty swap)',
  swapDeepLink({ chain: 1, token: '0x1234' }) === null
  && swapDeepLink({ chain: 'solana', token: 'not-a-mint' }) === null
  && swapDeepLink({ chain: 1, token: '' }) === null
  && swapDeepLink({}) === null);
t('a row helper derives the side from the signal when it has none',
  swapLinkForRow({ chain: 1, token: EVM, signal: 'DISTRIBUTION' })?.includes('side=sell')
  && swapLinkForRow({ chain: 1, token: EVM, signal: 'ACCUMULATION' })?.includes('toAddress=')
  && swapLinkForRow({ chain: 1, token: EVM, side: 'SELL' })?.includes('side=sell'));
t('the helper explains the URL, the button does the navigation',
  /swapDeepLink/.test(button) && /navigate\(href\)/.test(button) && /clipboard/.test(button));

/* ── 2 · the button is on every surface that shows a real fill ──────────── */
t('the verified ledger row carries «کپی تراکنش»',
  /CopyTradeButton chain=\{r\.chain\} token=\{r\.token\} side=\{r\.side\}/.test(intel));
t('the selected consensus card carries it too',
  /<CopyTradeButton[\s\S]{0,200}chosen\.token/.test(intel));
t('the wallet page\'s observed swaps carry it',
  /<CopyTradeButton[\s\S]{0,240}token=\{s\.token\}/.test(wallet));
t('token activity rows carry it (overview + tokens tab share one row)',
  /function TokenActivityRows[\s\S]{0,2600}<CopyTradeButton/.test(page));
t('the copy button renders nothing without a usable contract',
  /if \(!href\) return null;/.test(button));

/* ── 3 · the token tab leads with what the page already knows ───────────── */
t('the token tab receives the overview activity instead of re-fetching it',
  /<TokensTab[^>]*activity=\{data\?\.tokenActivity\}/.test(page));
const tokensTab = page.slice(page.indexOf('function TokensTab'));
t('it renders an activity section before the early-token grid',
  tokensTab.indexOf('data-testid="sm-tokens-activity"') > 0
  && tokensTab.indexOf('data-testid="sm-tokens-activity"') < tokensTab.indexOf('title={t(\'sm.earlyDetection\')}')
  && /<TokenActivityRows rows=\{activityRows\}/.test(tokensTab));
t('search filters all three feeds and a manual refresh exists',
  /const activityRows = \(activity \|\| \[\]\)\.filter\(hits\)/.test(page)
  && /fetchEarlyTokens\(30\)/.test(page) && /setTick\(\(n\) => n \+ 1\)/.test(page));
t('an empty tab says "nothing observed", not "no data"',
  fa.sm.tokenTabEmpty && /t\('sm.tokenTabEmpty'\)/.test(page) && fa.sm.tokenTabNote);

/* ── 4 · layout: one line of tabs, and controls of one height ───────────── */
t('the dock is a single row of seven equal columns',
  /\.smx-dock \{[\s\S]{0,400}grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/.test(css)
  && !/smx-dock-btn:nth-child\(n \+ 5\)/.test(css));
t('the dock still keeps a real tap target',
  Number(/\.smx-dock-btn \{[\s\S]*?min-height:\s*(\d+)px/.exec(css)?.[1] || 0) >= 56);
t('the moving selection pill has a rule and a light twin',
  /\.smx-dock-pill \{/.test(css) && /:root\[data-theme='light'\] \.smx-dock-pill \{/.test(css));
t('the days rail and the network picker are the same 40px tall',
  /\.smi-window \{[\s\S]{0,400}height:\s*40px/.test(intelCss)
  && /\.smi-window button \{[\s\S]{0,200}height:\s*32px/.test(intelCss)
  && /\.smi-controls \.modern-select-trigger \{[\s\S]{0,120}height:\s*40px/.test(intelCss));
t('the controls stack below 430px instead of clipping either one',
  /@media \(max-width: 430px\) \{[\s\S]{0,200}\.smi-controls \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(intelCss));
t('the copy CTA has a size, a gap and a focus ring (not an inline-styled span)',
  /\.sm-copy \{[\s\S]{0,400}min-height:\s*30px/.test(css)
  && /\.sm-copy:focus-visible \{/.test(css)
  && /:root\[data-theme='light'\] \.sm-copy \{/.test(css));

/* ── 5 · motion: enough, and it costs nothing per frame ─────────────────── */
const heroAnim = ['smx-drift', 'smx-float-a', 'smx-float-b', 'smx-sweep', 'smx-scan', 'smx-seam'];
t('the hero animates its atmosphere with compositor-only keyframes',
  heroAnim.every((k) => new RegExp(`@keyframes ${k} \\{[\\s\\S]{0,220}transform`).test(css)));
t('every ambient hero layer stops under prefers-reduced-motion',
  ['smx-hero-mesh', 'smx-hero-scan', 'smx-hero-hairline', 'smx-pod']
    .every((c) => new RegExp(`prefers-reduced-motion[\\s\\S]{0,700}\\.${c}`).test(css)));
t('and stops in the packaged APK as well',
  ['.smx-hero-mesh', '.smx-hero-scan', '.smx-pod']
    .every((c) => new RegExp(`:root\\[data-native='true'\\] ${c.replace('.', '\\.')}`).test(css)));
const heroKeyframes = css.slice(css.indexOf('@keyframes smx-drift'), css.indexOf('@keyframes smx-shimmer'));
t('no hero keyframe animates a layout/paint property (only transform/opacity)',
  heroKeyframes.length > 200
  && !/background-position|(?:^|[^-])width:|(?:^|[^-])height:|filter:|box-shadow:/.test(heroKeyframes));

/* ── 6 · verified intelligence says more, and says it honestly ──────────── */
t('the board shows the measured sample behind each score',
  /smi-wcard-sample/.test(intel) && /sample\?\.observedDays/.test(intel) && /measuredCoverage/.test(intel));
t('the selected card carries a confidence meter and six live-or-dash facts',
  /smi-conf-track/.test(intel) && /className="smi-facts"/.test(intel)
  && /fmtPrice\(chosen\.currentPriceUsd\)/.test(intel)
  && /t\('sm\.engine\.lastTrade'\)/.test(intel));
t('a receipt\'s realised ROI gets its own pill, not a sentence',
  /className=\{`smi-roi/.test(intel) && /\.smi-roi \{/.test(intelCss));
t('the teaser names the strongest tokens instead of only counting them',
  /smi-teaser-chip/.test(intel) && /\.smi-teaser-chip \{/.test(intelCss));
t('the server prices the consensus rows it shows (live-or-null)',
  /out\.consensus \|\| \[\]\)\.slice\(0, 8\)\) add\(row\.chain, row\.token\)/.test(server)
  && /row\.currentPriceUsd = m\.priceUsd/.test(server));
t('no invented price fallback was introduced',
  !/\*\s*1\.35|fakePrice|inventedPrice/.test(server));

/* ── 7 · language ───────────────────────────────────────────────────────── */
t('«کپی تراکنش» and its hint exist in Persian and English',
  fa.sm.copyTrade === 'کپی تراکنش' && en.sm.copyTrade === 'Copy trade'
  && fa.sm.copyTradeHint.length > 10 && en.sm.copyTradeHint.length > 10);
t('every new engine label is translated in both languages',
  ['price', 'lastTrade', 'observedDays', 'sampleSwaps', 'measuredCoverage', 'lastMeasured', 'copyTradeNote']
    .every((k) => typeof fa.sm.engine[k] === 'string' && typeof en.sm.engine[k] === 'string'));

if (failures) {
  console.error(`\nSmart Money copy-trade probe: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nSmart Money copy-trade probe: all checks passed');
