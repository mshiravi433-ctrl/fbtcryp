/** Intent OS must route fiat requests only to the native Buy / Sell review flow. */
import { readFileSync } from 'node:fs';
import {
  RAMP_SCHEMA, RAMP_SUPPORTED, detectFiatIntent, fiatBoundaryResponse,
  filterMisleadingRoutes, assertNoRampPromise
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

try {
  const buy = detectFiatIntent({ text: 'buy ETH with my Visa card' });
  const sell = detectFiatIntent({ text: 'cash out to my bank' });
  check('card purchase is recognized as a fiat request', buy.isFiat && buy.direction === 'onramp');
  check('cash-out is recognized as an off-ramp request', sell.isFiat && sell.direction === 'offramp');
  check('a crypto swap is not reclassified as fiat', !detectFiatIntent({ text: 'swap USDT to ETH' }).isFiat);

  const boundary = fiatBoundaryResponse({ detection: buy, now: 1_800_000_000_000 });
  check('fiat intent routes to the native Buy / Sell screen', boundary.applies && boundary.route === '/buy');
  check('intent detection does not authorize money movement', boundary.blocked && boundary.executionAuthorized === false);
  check('the current unavailable provider is not claimed as live', RAMP_SUPPORTED === false && boundary.supported === false);
  check('no third-party provider URL is offered', Array.isArray(boundary.thirdParty) && boundary.thirdParty.length === 0);
  check('the native boundary passes the anti-promise guard', assertNoRampPromise(boundary).ok);
  check('changing route or authorization is caught',
    assertNoRampPromise({ ...boundary, route: 'https://example.com', executionAuthorized: true }).reasons.includes('UNSAFE_FIAT_ROUTE'));

  const filtered = filterMisleadingRoutes({ routes: [
    { id: 'crypto', fromSymbol: 'USDT', toSymbol: 'ETH' },
    { id: 'fiat', fromSymbol: 'USD', toSymbol: 'ETH' }
  ] });
  check('fiat pairs cannot slip through crypto swap routing', filtered.routes.length === 1 && filtered.removed[0]?.reason === 'FIAT_ROUTE_NOT_SUPPORTED');
  check('boundary schema is versioned', boundary.schema === RAMP_SCHEMA && filtered.schema === RAMP_SCHEMA);

  const panel = readFileSync('src/components/IntentAIPanel.jsx', 'utf8');
  const buyPanel = readFileSync('src/components/BuySellPanel.jsx', 'utf8');
  check('Intent OS renders an in-app Buy / Sell route', panel.includes('data-testid="fiat-ramp-open-buy-sell"') && panel.includes('href="#/buy"'));
  check('the Buy / Sell panel is the only money-action UI', !/Binance|Bybit|KuCoin|MEXC/i.test(buyPanel));

  for (const lang of ['en', 'fa', 'ar']) {
    const locale = JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, 'utf8'));
    check(`${lang} has the native Buy / Sell boundary copy`,
      ['title', 'buyUnavailable', 'sellUnavailable', 'openBuySell', 'routesRemoved'].every((key) => typeof locale.intentAI?.ramp?.[key] === 'string'));
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

console.log(JSON.stringify({ probe: 'phase88-buy-sell-boundary', passed: results.filter((row) => row.ok).length, results }, null, 2));
if (results.some((row) => !row.ok)) process.exitCode = 1;
export default results;
