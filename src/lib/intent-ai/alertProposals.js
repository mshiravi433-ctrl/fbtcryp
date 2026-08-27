/**
 * FBT INTENT AI — PHASE 59: PRICE ALERT → INTENT PROPOSAL
 * ---------------------------------------------------------------------------
 * An alert is not an authorization to execute. A triggered price alert may
 * produce exactly one thing: a PROPOSAL the user has to look at and approve.
 *
 *   · a proposal carries `executionAuthorized: false` and
 *     `requiresConfirmationScreen: true` — always, with no exception path
 *   · accepting a proposal produces the utterance that goes through the
 *     EXISTING chat → draft → interactive confirmation screen route; there is
 *     no function here that submits, signs or shortcuts that screen
 *   · a dead feed produces an honest "informed" notice, not a silent alert and
 *     definitely not a proposal built on a remembered price
 */

import { classifyFailure } from './failureModes.js';

export const ALERT_PROPOSAL_SCHEMA = 'fbt.alert-intent-proposal.v1';
export const PROPOSAL_STATUSES = Object.freeze(['proposed', 'accepted', 'declined', 'expired']);
/** A proposal built on a price this old is not offered at all. */
export const PROPOSAL_MAX_PRICE_AGE_MS = 15 * 60 * 1000;
export const PROPOSAL_TTL_MS = 30 * 60 * 1000;

// Number(null) === 0 and Number('') === 0, so an absent value must be
// rejected BEFORE the finite check or "missing" silently reads as zero.
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * Turn a triggered alert into a PROPOSAL (never into an execution).
 * @param {object} alert  { assetId, symbol, direction, price, changePct, observedAt, source }
 */
export function proposalFromAlert({ alert = {}, suggestion = {}, now = Date.now() } = {}) {
  const symbol = typeof alert.symbol === 'string' && alert.symbol ? alert.symbol.toUpperCase().slice(0, 12) : null;
  const price = num(alert.price);
  const observedAt = num(alert.observedAt);
  const source = typeof alert.source === 'string' && alert.source ? alert.source.slice(0, 40) : null;
  if (!symbol || price === null || price <= 0 || observedAt === null || !source) {
    return { ok: false, status: 'unavailable', error: classifyFailure('MISSING_DATA', { detail: 'ALERT_EVIDENCE_INCOMPLETE' }) };
  }
  if (now - observedAt > PROPOSAL_MAX_PRICE_AGE_MS) {
    return { ok: false, status: 'unavailable', error: classifyFailure('MISSING_DATA', { detail: 'ALERT_PRICE_STALE' }) };
  }
  const direction = alert.direction === 'down' ? 'down' : alert.direction === 'up' ? 'up' : null;
  const amountUsd = num(suggestion.amountUsd);
  return {
    ok: true,
    proposal: Object.freeze({
      schema: ALERT_PROPOSAL_SCHEMA,
      proposalId: `proposal_${symbol}_${observedAt}`,
      status: 'proposed',
      // The three flags that make this a proposal and nothing else.
      executionAuthorized: false,
      requiresConfirmationScreen: true,
      autoExecute: false,
      trigger: {
        symbol,
        direction,
        price,
        changePct: num(alert.changePct),
        observedAt,
        source,
        priceAgeMs: now - observedAt
      },
      suggestion: {
        kind: typeof suggestion.kind === 'string' ? suggestion.kind.slice(0, 24) : 'swap',
        fromSymbol: typeof suggestion.fromSymbol === 'string' ? suggestion.fromSymbol.toUpperCase().slice(0, 12) : null,
        toSymbol: typeof suggestion.toSymbol === 'string' ? suggestion.toSymbol.toUpperCase().slice(0, 12) : symbol,
        amountUsd,
        chainId: num(suggestion.chainId)
      },
      // Shown to the user as a translated sentence, never as a raw dump.
      i18nKey: direction === 'down' ? 'intentAI.proposal.priceDown' : 'intentAI.proposal.priceUp',
      i18nParams: { symbol, price, changePct: num(alert.changePct), source },
      expiresAt: now + PROPOSAL_TTL_MS,
      createdAt: now
    })
  };
}

/** A feed that cannot be read produces an honest notice, not a proposal. */
export function informedUnavailable({ symbol = null, reason = 'FEED_UNAVAILABLE', now = Date.now() } = {}) {
  return {
    ok: false,
    schema: ALERT_PROPOSAL_SCHEMA,
    status: 'unavailable',
    executionAuthorized: false,
    proposal: null,
    i18nKey: 'intentAI.proposal.feedUnavailable',
    i18nParams: { symbol: symbol ? String(symbol).toUpperCase().slice(0, 12) : null },
    error: classifyFailure('MISSING_DATA', { detail: String(reason).slice(0, 40) }),
    at: now
  };
}

/**
 * The user explicitly accepted the proposal. This returns the UTTERANCE that
 * must be pushed through the normal chat pipeline — it does not, and cannot,
 * execute anything by itself.
 */
export function acceptProposal(proposal, { confirmed = false, now = Date.now() } = {}) {
  if (!proposal || proposal.schema !== ALERT_PROPOSAL_SCHEMA) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_PROPOSAL' }) };
  }
  if (now > Number(proposal.expiresAt)) {
    return { ok: false, status: 'expired', error: classifyFailure('DEADLINE_PASSED', { detail: 'PROPOSAL_EXPIRED' }) };
  }
  if (confirmed !== true) {
    return { ok: false, status: 'proposed', error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'PROPOSAL_NOT_ACCEPTED' }) };
  }
  const s = proposal.suggestion || {};
  const parts = [s.kind || 'swap'];
  if (s.amountUsd) parts.push(String(s.amountUsd));
  if (s.fromSymbol) parts.push(s.fromSymbol);
  if (s.toSymbol) parts.push(`to ${s.toSymbol}`);
  if (s.chainId) parts.push(`on chain ${s.chainId}`);
  return {
    ok: true,
    status: 'accepted',
    // Straight into the existing guided pipeline — same parser, same gate.
    utterance: parts.join(' '),
    routeVia: 'chatTurn',
    requiresConfirmationScreen: true,
    executionAuthorized: false,
    proposal: { ...proposal, status: 'accepted', acceptedAt: now }
  };
}

/** Declining is a first-class outcome: nothing happens, nothing is retried. */
export function declineProposal(proposal, { now = Date.now() } = {}) {
  if (!proposal || proposal.schema !== ALERT_PROPOSAL_SCHEMA) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_PROPOSAL' }) };
  }
  return { ok: true, status: 'declined', executionAuthorized: false, proposal: { ...proposal, status: 'declined', declinedAt: now } };
}

/**
 * Fail-closed guard for any caller that thinks it can go straight from an
 * alert to a submission. Used by the probe as the anti-shortcut assertion.
 */
export function assertNoAlertShortcut(candidate) {
  const reasons = [];
  if (!candidate || typeof candidate !== 'object') reasons.push('NO_PROPOSAL');
  if (candidate?.executionAuthorized === true) reasons.push('PROPOSAL_CLAIMS_EXECUTION');
  if (candidate?.autoExecute === true) reasons.push('PROPOSAL_CLAIMS_AUTO_EXECUTE');
  if (candidate?.requiresConfirmationScreen !== true) reasons.push('PROPOSAL_SKIPS_CONFIRMATION_SCREEN');
  return reasons.length
    ? { ok: false, reasons, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: reasons.join(',') }) }
    : { ok: true, reasons: [] };
}
