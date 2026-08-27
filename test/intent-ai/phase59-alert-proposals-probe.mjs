/**
 * PHASE 59 — PRICE ALERT → INTENT PROPOSAL
 * A triggered alert may only PROPOSE. It can never execute, never skip the
 * confirmation screen, and never be built on a stale or unsourced price.
 */
import { readFileSync } from 'node:fs';
import {
  proposalFromAlert, informedUnavailable, acceptProposal, declineProposal,
  assertNoAlertShortcut, ALERT_PROPOSAL_SCHEMA, PROPOSAL_MAX_PRICE_AGE_MS, PROPOSAL_TTL_MS
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const ALERT = {
  assetId: 'ethereum', symbol: 'eth', direction: 'down', price: 2400,
  changePct: -6.2, observedAt: NOW - 60_000, source: 'coingecko'
};
const SUGGESTION = { kind: 'swap', fromSymbol: 'usdc', toSymbol: 'eth', amountUsd: 100, chainId: 42161 };
const make = (over = {}) => proposalFromAlert({ alert: { ...ALERT, ...(over.alert || {}) }, suggestion: SUGGESTION, now: NOW });

try {
  /* ---------- the proposal needs real, fresh, sourced evidence ---------- */
  check('an alert with no source cannot become a proposal', make({ alert: { source: null } }).ok === false);
  check('an alert with no timestamp cannot become a proposal', make({ alert: { observedAt: null } }).ok === false);
  check('an alert with no price cannot become a proposal', make({ alert: { price: null } }).ok === false);
  const staleAlert = make({ alert: { observedAt: NOW - PROPOSAL_MAX_PRICE_AGE_MS - 1 } });
  check('an alert built on a stale price is not offered', staleAlert.ok === false);
  check('the refusal carries a classified error', typeof staleAlert.error?.code === 'string');

  const built = make();
  check('a fresh, sourced alert produces a proposal', built.ok === true && built.proposal?.schema === ALERT_PROPOSAL_SCHEMA);
  const p = built.proposal;

  /* ---------- a proposal is not an authorization ---------- */
  check('the proposal never authorizes execution', p.executionAuthorized === false);
  check('the proposal requires the interactive confirmation screen', p.requiresConfirmationScreen === true);
  check('the proposal does not auto-execute', p.autoExecute !== true);
  check('the proposal status starts at "proposed"', p.status === 'proposed');
  check('the anti-shortcut guard accepts a well-formed proposal', assertNoAlertShortcut(p).ok === true);
  check('the guard rejects anything claiming execution',
    assertNoAlertShortcut({ ...p, executionAuthorized: true }).ok === false);
  check('the guard rejects anything claiming auto-execute',
    assertNoAlertShortcut({ ...p, autoExecute: true }).ok === false);
  check('the guard rejects anything that skips the confirmation screen',
    assertNoAlertShortcut({ ...p, requiresConfirmationScreen: false }).ok === false);
  check('the guard rejects a missing proposal', assertNoAlertShortcut(null).ok === false);

  /* ---------- the evidence travels with the proposal ---------- */
  check('the proposal carries the price it was built on', p.trigger.price === 2400);
  check('the proposal carries the source', p.trigger.source === 'coingecko');
  check('the proposal carries the observation age', p.trigger.priceAgeMs === 60_000);
  check('the symbol is normalised', p.trigger.symbol === 'ETH');
  check('the direction is preserved', p.trigger.direction === 'down');
  check('the proposal expires', p.expiresAt === NOW + PROPOSAL_TTL_MS);

  /* ---------- the user-facing text is i18n only ---------- */
  check('the proposal text is an i18n key', p.i18nKey === 'intentAI.proposal.priceDown');
  const upBuilt = make({ alert: { direction: 'up', changePct: 6.2 } });
  check('an upward alert uses the upward key', upBuilt.proposal.i18nKey === 'intentAI.proposal.priceUp');

  /* ---------- accepting routes through the normal pipeline ---------- */
  const notYet = acceptProposal(p, { confirmed: false, now: NOW });
  check('an unconfirmed acceptance does nothing', notYet.ok === false);
  const expired = acceptProposal(p, { confirmed: true, now: p.expiresAt + 1 });
  check('an expired proposal cannot be accepted', expired.ok === false && expired.status === 'expired');
  const accepted = acceptProposal(p, { confirmed: true, now: NOW + 1000 });
  check('an explicitly confirmed proposal is accepted', accepted.ok === true && accepted.status === 'accepted');
  check('acceptance returns an utterance, not a transaction', typeof accepted.utterance === 'string' && accepted.utterance.length > 0);
  check('the utterance is routed through the normal chat pipeline', accepted.routeVia === 'chatTurn');
  check('acceptance still does not authorize execution', accepted.executionAuthorized === false);
  check('acceptance still requires the confirmation screen', accepted.requiresConfirmationScreen === true);
  check('the accepted result exposes no submit or sign function',
    Object.values(accepted).every((v) => typeof v !== 'function'));

  /* ---------- declining is a first-class outcome ---------- */
  const declined = declineProposal(p, { now: NOW });
  check('a declined proposal is recorded as declined', declined.ok === true && declined.proposal.status === 'declined');
  check('declining authorizes nothing', declined.executionAuthorized === false);
  check('declining a missing proposal is refused', declineProposal(null).ok === false);

  /* ---------- a dead feed informs, it does not propose ---------- */
  const dead = informedUnavailable({ symbol: 'eth', reason: 'FEED_TIMEOUT', now: NOW });
  check('a dead feed produces a notice, not a proposal', dead.ok === false && dead.proposal === null);
  check('the notice is an i18n key', dead.i18nKey === 'intentAI.proposal.feedUnavailable');
  check('the notice authorizes nothing', dead.executionAuthorized === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the proposal strings exist in en, fa and ar',
    locales.every((loc) => ['priceUp', 'priceDown', 'feedUnavailable', 'accepted', 'declined']
      .every((k) => typeof loc?.intentAI?.proposal?.[k] === 'string')));
  check('no proposal string promises a profit',
    locales.every((loc) => !/(guarantee|profit|will earn)/i.test(JSON.stringify(loc.intentAI.proposal))));

  console.log(JSON.stringify({ probe: 'phase59-alert-proposals', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
