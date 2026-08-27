/**
 * PHASE 89 — CHAOS TESTING FOR THE INTENT PLANE
 * RPC down, feed dead, wallet gone: every fault must end in honest-unavailable
 * — not a crash, not a fabricated receipt, not a silent authorization.
 */
import { readFileSync } from 'node:fs';
import {
  injectFault, runChaosDrill, honestUnavailable, assertDrillHonest,
  FAULTS, CHAOS_SCHEMA, REQUIRED_BEHAVIOUR
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const goodHandlers = Object.fromEntries(FAULTS.map((f) => [f, async () => honestUnavailable({ fault: f })]));

try {
  /* ---------- the honest shape ---------- */
  const shape = honestUnavailable({ fault: 'rpc-down' });
  check('the honest-unavailable shape is not ok', shape.ok === false && shape.unavailable === true);
  check('it never claims a completion', shape.status === 'UNAVAILABLE');
  check('it authorizes nothing', shape.executionAuthorized === false);
  check('it still points at the confirmation gate', shape.requiresConfirmationGate === true);
  check('it carries a translatable message', shape.i18nKey.startsWith('intentAI.'));
  check('it carries a classified error', typeof shape.error?.code === 'string');
  check('the required behaviour is explicit', REQUIRED_BEHAVIOUR.noFabrication === true && REQUIRED_BEHAVIOUR.executionAuthorized === false);

  /* ---------- one fault at a time ---------- */
  const passed = await injectFault({ fault: 'rpc-down', handler: goodHandlers['rpc-down'], now: NOW });
  check('an honest handler passes its drill', passed.passed === true && passed.schema === CHAOS_SCHEMA);
  check('a passing drill reports no findings', passed.findings.length === 0);
  check('a passing drill did not crash', passed.crashed === false);
  const crashed = await injectFault({ fault: 'rpc-down', handler: async () => { throw new Error('undefined is not a function'); }, now: NOW });
  check('a handler that throws FAILS the drill', crashed.passed === false && crashed.crashed === true);
  check('the crash is captured, not rethrown', typeof crashed.thrown === 'string');
  check('the crash is a finding', crashed.findings.includes('CRASHED'));
  const fabricated = await injectFault({ fault: 'receipt-missing', handler: async () => ({ ok: true, status: 'COMPLETED', i18nKey: 'intentAI.x' }), now: NOW });
  check('a fabricated completion FAILS the drill', fabricated.passed === false);
  check('the fabrication is named', fabricated.findings.includes('FABRICATED_COMPLETION'));
  const fakeReceipt = await injectFault({
    fault: 'receipt-missing',
    handler: async () => ({ ok: false, unavailable: true, i18nKey: 'intentAI.chaos.unavailable', receipt: { status: 'confirmed' } }),
    now: NOW
  });
  check('a confirmed receipt with no tx hash is a fabrication', fakeReceipt.findings.includes('FABRICATED_RECEIPT'));
  const authorized = await injectFault({
    fault: 'wallet-disconnected',
    handler: async () => ({ ok: false, unavailable: true, i18nKey: 'intentAI.chaos.unavailable', executionAuthorized: true }),
    now: NOW
  });
  check('authorizing during a fault FAILS the drill', authorized.findings.includes('AUTHORIZED_DURING_FAULT'));
  const invented = await injectFault({
    fault: 'price-feed-dead',
    handler: async () => ({ ok: false, unavailable: true, i18nKey: 'intentAI.chaos.unavailable', price: 2500 }),
    now: NOW
  });
  check('a price with no source during a dead feed is a fabrication', invented.findings.includes('INVENTED_PRICE'));
  const pretending = await injectFault({ fault: 'quote-timeout', handler: async () => ({ ok: true, quote: 1 }), now: NOW });
  check('pretending to work FAILS the drill', pretending.findings.includes('PRETENDED_TO_WORK'));
  const mute = await injectFault({ fault: 'quote-timeout', handler: async () => ({ ok: false, unavailable: true }), now: NOW });
  check('failing silently, with no message, FAILS the drill', mute.findings.includes('NO_HONEST_MESSAGE'));
  const rawProse = await injectFault({ fault: 'quote-timeout', handler: async () => ({ ok: false, unavailable: true, i18nKey: 'Something went wrong' }), now: NOW });
  check('a hardcoded english message is not an honest message', rawProse.findings.includes('NO_HONEST_MESSAGE'));
  check('an unknown fault is refused', (await injectFault({ fault: 'meteor', handler: goodHandlers['rpc-down'], now: NOW })).ok === false);
  check('a missing handler is a failed drill, not a pass',
    (await injectFault({ fault: 'rpc-down', now: NOW })).passed === false);

  /* ---------- every fault in the catalogue ---------- */
  const drill = await runChaosDrill({ handlers: goodHandlers, now: NOW });
  check('a full honest drill passes', drill.ok === true && drill.passed === true);
  check('every declared fault was exercised', drill.results.length === FAULTS.length && drill.untested.length === 0);
  check('coverage is one hundred percent', drill.coverage === 100);
  check('the pass is a translatable notice', drill.i18nKey === 'intentAI.chaos.drillPassed');
  check('the ten intent-plane faults are all declared', FAULTS.length === 10);
  check('RPC, feed and wallet faults are all in the catalogue',
    ['rpc-down', 'price-feed-dead', 'wallet-disconnected'].every((f) => FAULTS.includes(f)));
  const partial = await runChaosDrill({ handlers: goodHandlers, faults: ['rpc-down', 'price-feed-dead'], now: NOW });
  check('a partial drill is NOT a pass', partial.passed === false);
  check('the untested faults are listed', partial.untested.length === FAULTS.length - 2);
  check('partial coverage is reported honestly', partial.coverage === 20);
  const oneBad = await runChaosDrill({
    handlers: { ...goodHandlers, 'storage-corrupt': async () => { throw new Error('boom'); } }, now: NOW
  });
  check('one crashing fault fails the whole drill', oneBad.ok === false && oneBad.passed === false);
  check('the failing fault is named', oneBad.failures.some((f) => f.fault === 'storage-corrupt'));
  check('the other faults still ran', oneBad.results.length === FAULTS.length);
  check('a drill with no faults is refused', (await runChaosDrill({ handlers: goodHandlers, faults: [], now: NOW })).ok === false);

  /* ---------- the reporting guard ---------- */
  check('the guard accepts an honest drill', assertDrillHonest(drill).ok === true);
  check('the guard catches a pass with failures',
    assertDrillHonest({ ...oneBad, passed: true }).reasons.includes('PASSED_WITH_FAILURES'));
  check('the guard catches a pass with untested faults',
    assertDrillHonest({ ...partial, passed: true, failures: [] }).reasons.includes('PASSED_WITH_UNTESTED_FAULTS'));
  check('the guard catches a crash reported as ok',
    assertDrillHonest({ ...oneBad, ok: true, passed: false }).reasons.includes('CRASH_REPORTED_AS_OK'));
  check('the guard rejects a non-drill', assertDrillHonest({ results: [] }).ok === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the chaos copy is translated in en, fa and ar',
    locales.every((loc) => ['passed', 'failed', 'drillPassed', 'drillFailed', 'unavailable']
      .every((k) => typeof loc?.intentAI?.chaos?.[k] === 'string')));
  check('the english unavailable copy promises nothing was sent',
    /nothing was sent/i.test(locales[0].intentAI.chaos.unavailable));

  console.log(JSON.stringify({ probe: 'phase89-intent-chaos', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
