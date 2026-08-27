/**
 * PHASE 88 — HONEST FIAT RAMP BOUNDARY
 * A swap is not a ramp. A fiat request gets a plain, friendly refusal plus the
 * thing we DO support; misleading routes are removed; a third party is always
 * labelled as somebody else.
 */
import { readFileSync } from 'node:fs';
import {
  detectFiatIntent, fiatBoundaryResponse, filterMisleadingRoutes, assertNoRampPromise,
  RAMP_SUPPORTED, RAMP_SCHEMA, FIAT_CURRENCIES
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const PROVIDER = { name: 'SomeRamp', url: 'https://someramp.example', regions: ['TR'] };

try {
  /* ---------- the product is honest about what it is ---------- */
  check('the product does not claim ramp support', RAMP_SUPPORTED === false);

  /* ---------- detection ---------- */
  check('buying with a bank card is a fiat intent', detectFiatIntent({ text: 'buy ETH with my visa card' }).isFiat === true);
  check('a bank transfer is a fiat intent', detectFiatIntent({ text: 'deposit cash by wire' }).isFiat === true);
  check('cashing out is an off-ramp', detectFiatIntent({ text: 'cash out to my bank' }).direction === 'offramp');
  check('topping up is an on-ramp', detectFiatIntent({ text: 'top up with EUR' }).direction === 'onramp');
  check('a fiat currency symbol in the intent is detected',
    detectFiatIntent({ intent: { fromSymbol: 'TRY', toSymbol: 'ETH' } }).isFiat === true);
  check('the signals are reported', detectFiatIntent({ text: 'buy ETH with visa' }).signals.includes('visa'));
  check('an ordinary crypto swap is NOT a fiat intent', detectFiatIntent({ text: 'swap 500 USDT to ETH' }).isFiat === false);
  check('a crypto-only intent has no direction', detectFiatIntent({ text: 'swap USDT to ETH' }).direction === null);
  check('the fiat list covers the main UI regions',
    ['USD', 'EUR', 'TRY', 'IRR', 'INR', 'IDR'].every((c) => FIAT_CURRENCIES.includes(c)));

  /* ---------- the answer ---------- */
  const onramp = fiatBoundaryResponse({ detection: detectFiatIntent({ text: 'buy ETH with my card' }), now: NOW });
  check('a fiat request is blocked', onramp.blocked === true && onramp.applies === true);
  check('the refusal never claims support', onramp.supported === false);
  check('the refusal is a translatable, friendly key', onramp.i18nKey === 'intentAI.ramp.noOnramp');
  check('an alternative is offered rather than a dead end', onramp.alternativeI18nKey === 'intentAI.ramp.alternative');
  check('the refusal authorizes nothing', onramp.executionAuthorized === false);
  const offramp = fiatBoundaryResponse({ detection: detectFiatIntent({ text: 'withdraw to my bank account' }), now: NOW });
  check('an off-ramp gets its own honest message', offramp.i18nKey === 'intentAI.ramp.noOfframp');
  check('a crypto swap is untouched by the boundary',
    fiatBoundaryResponse({ detection: detectFiatIntent({ text: 'swap USDT to ETH' }), now: NOW }).applies === false);

  /* ---------- third parties are labelled ---------- */
  const withProvider = fiatBoundaryResponse({ detection: detectFiatIntent({ text: 'buy with card' }), providers: [PROVIDER], region: 'TR', now: NOW });
  check('a configured provider may be shown', withProvider.thirdParty.length === 1);
  check('the provider is labelled as not ours', withProvider.thirdParty[0].firstParty === false);
  check('the provider carries a disclaimer key', withProvider.thirdParty[0].disclaimerI18nKey === 'intentAI.ramp.thirdPartyDisclaimer');
  check('showing a provider does not unblock us', withProvider.blocked === true);
  check('an http provider is never shown',
    fiatBoundaryResponse({ detection: detectFiatIntent({ text: 'buy with card' }), providers: [{ name: 'x', url: 'http://x.example' }], now: NOW }).thirdParty.length === 0);
  check('a provider outside the region is not shown',
    fiatBoundaryResponse({ detection: detectFiatIntent({ text: 'buy with card' }), providers: [PROVIDER], region: 'US', now: NOW }).thirdParty.length === 0);
  check('with nothing configured no provider is invented', onramp.thirdParty.length === 0);

  /* ---------- misleading routes are removed ---------- */
  const filtered = filterMisleadingRoutes({
    routes: [
      { id: 'r1', fromSymbol: 'USDT', toSymbol: 'ETH' },
      { id: 'r2', fromSymbol: 'USD', toSymbol: 'ETH' },
      { id: 'r3', kind: 'fiat' },
      { id: 'r4', fromSymbol: 'USDT', toSymbol: 'ETH', rampRequired: true }
    ]
  });
  check('crypto routes survive', filtered.routes.length === 1 && filtered.routes[0].id === 'r1');
  check('a fiat-denominated route is removed', filtered.removed.some((r) => r.id === 'r2'));
  check('a route marked fiat is removed', filtered.removed.some((r) => r.id === 'r3'));
  check('a route that needs a ramp is removed', filtered.removed.some((r) => r.id === 'r4'));
  check('the removals carry a reason', filtered.removed.every((r) => r.reason === 'FIAT_ROUTE_NOT_SUPPORTED'));
  check('the removal is announced', filtered.i18nKey === 'intentAI.ramp.routesRemoved');
  check('with nothing to remove nothing is announced', filterMisleadingRoutes({ routes: [{ id: 'r1', fromSymbol: 'ETH', toSymbol: 'USDT' }] }).i18nKey === null);
  check('the filter is schema-tagged', filtered.schema === RAMP_SCHEMA);

  /* ---------- the guard ---------- */
  check('the honest response passes the guard', assertNoRampPromise(onramp).ok === true);
  check('claiming ramp support is caught', assertNoRampPromise({ supported: true }).reasons.includes('CLAIMS_RAMP_SUPPORT'));
  check('an unblocked fiat intent is caught',
    assertNoRampPromise({ applies: true, blocked: false }).reasons.includes('FIAT_INTENT_NOT_BLOCKED'));
  check('a third party presented as ours is caught',
    assertNoRampPromise({ thirdParty: [{ ...withProvider.thirdParty[0], firstParty: true }] }).reasons.includes('THIRD_PARTY_PRESENTED_AS_OURS'));
  check('a provider without a disclaimer is caught',
    assertNoRampPromise({ thirdParty: [{ url: 'https://x.example', firstParty: false }] }).reasons.includes('PROVIDER_WITHOUT_DISCLAIMER'));
  check('an insecure provider link is caught',
    assertNoRampPromise({ thirdParty: [{ url: 'http://x.example', firstParty: false, disclaimerI18nKey: 'k' }] }).reasons.includes('INSECURE_PROVIDER_LINK'));
  check('a surviving misleading route is caught',
    assertNoRampPromise({ routes: [{ rampRequired: true }] }).reasons.includes('MISLEADING_ROUTE'));
  check('promising a bank settlement time is caught',
    assertNoRampPromise({ estimatedBankSettlementMs: 86_400_000 }).reasons.includes('PROMISES_BANK_SETTLEMENT'));
  check('the filtered route list passes the guard', assertNoRampPromise(filtered).ok === true);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the ramp copy is translated in en, fa and ar',
    locales.every((loc) => ['noOnramp', 'noOfframp', 'alternative', 'thirdPartyDisclaimer', 'routesRemoved']
      .every((k) => typeof loc?.intentAI?.ramp?.[k] === 'string')));
  check('the english refusal says what we DO support', /swap/i.test(locales[0].intentAI.ramp.noOnramp));
  check('no ramp copy promises a bank transfer',
    Object.values(locales[0].intentAI.ramp).every((v) => !/we (will|can) (send|deposit) (money|funds) to your bank/i.test(v)));

  /* ------------------------------------------------------------------ */
  /* UI WIRING — the boundary is spoken, not just computed.               */
  /* ------------------------------------------------------------------ */
  const panel = readFileSync('src/components/IntentAIPanel.jsx', 'utf8');

  check('the panel imports the fiat boundary functions',
    /detectFiatIntent/.test(panel) && /fiatBoundaryResponse/.test(panel));
  check('the panel checks every message the user sends',
    /detectFiatIntent\(\{ text: value/.test(panel));
  check('the panel renders the boundary notice',
    panel.includes('data-testid="fiat-ramp-notice"'));
  check('the notice states the refusal in the user\u2019s language',
    /data-testid="fiat-ramp-message"[\s\S]{0,200}t\(rampNotice\.i18nKey\)/.test(panel));
  check('the notice offers what we CAN do instead of dead-ending',
    /data-testid="fiat-ramp-alternative"[\s\S]{0,200}t\(rampNotice\.alternativeI18nKey\)/.test(panel));
  check('the notice is cleared once a real crypto draft is produced',
    /if \(drafted\) \{[\s\S]{0,80}setRampNotice\(null\)/.test(panel));
  check('the panel never renders a first-party ramp link',
    !/onramp|on-ramp|buy with card/i.test(panel.replace(/detectFiatIntent|fiatBoundaryResponse|rampNotice/g, '')));
  check('the ramp title exists in en, fa and ar',
    locales.every((loc) => typeof loc?.intentAI?.ramp?.title === 'string'));

  /*
   * The boundary the UI actually shows must itself pass the phase-88 guard —
   * the same assertion the module-level checks use, applied to the exact
   * object the panel renders from.
   */
  const shown = fiatBoundaryResponse({ detection: detectFiatIntent({ text: 'buy ETH with my visa card' }) });
  check('the response the panel renders is detected as a fiat intent', shown.applies === true);
  check('the response the panel renders is blocked', shown.blocked === true);
  check('the response the panel renders authorises no execution', shown.executionAuthorized === false);
  check('the response the panel renders promises no ramp', assertNoRampPromise(shown).ok === true);
  check('a plain crypto swap produces no notice at all',
    fiatBoundaryResponse({ detection: detectFiatIntent({ text: 'swap 100 USDC to ETH on Arbitrum' }) }).applies !== true);

  console.log(JSON.stringify({ probe: 'phase88-fiat-ramp-boundary', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
