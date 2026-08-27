/**
 * FBT INTENT AI — PHASE 82: ADDRESS POISONING SHIELD
 * ---------------------------------------------------------------------------
 * A similar address is not the recipient. Address poisoning works because a
 * human checks the first four and last four characters of a 42-character
 * string, so an attacker mines a vanity address that matches exactly those,
 * dusts the victim's history with it, and waits for a copy-paste from the
 * transaction list.
 *
 * This module is the defence:
 *
 *   · LOOKALIKE — the pasted address shares the head and tail a human eyeballs
 *     with an address in history, but is a different address. That is not a
 *     warning pill; it is a hard stop with both addresses shown in full.
 *   · DUST ORIGIN — the address only ever appeared via an incoming zero-value
 *     or near-zero transfer. It was never a counterparty; it was bait.
 *   · FIRST TIME — an address never sent to before requires its own explicit
 *     confirmation, separate from the transaction confirmation. Sending to a
 *     known address and sending to a stranger are different decisions.
 *
 * Pure and synchronous: history is injected, so the same logic runs in the
 * send sheet and in the suite.
 */

import { classifyFailure } from './failureModes.js';

export const ADDRESS_SHIELD_SCHEMA = 'fbt.address-shield.v1';

/** How many leading / trailing characters a human actually compares. */
export const HEAD_CHARS = 6;
export const TAIL_CHARS = 4;
/** A transfer at or below this is treated as dust, i.e. as bait. */
export const DUST_THRESHOLD_USD = 1;

export const SHIELD_FLAGS = Object.freeze({
  LOOKALIKE: 'intentAI.addressShield.flag.lookalike',
  DUST_ORIGIN: 'intentAI.addressShield.flag.dustOrigin',
  FIRST_TIME: 'intentAI.addressShield.flag.firstTime',
  SELF_SEND: 'intentAI.addressShield.flag.selfSend',
  INVALID: 'intentAI.addressShield.flag.invalid'
});

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
// Number(null) === 0 and Number('') === 0, so an absent value must be
// rejected BEFORE the finite check or "missing" silently reads as zero.
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));
const norm = (a) => (typeof a === 'string' && ADDRESS.test(a.trim()) ? a.trim().toLowerCase() : null);

/** The part of an address a human actually reads. */
export function addressFingerprint(address) {
  const a = norm(address);
  if (!a) return null;
  return `${a.slice(0, 2 + HEAD_CHARS)}…${a.slice(-TAIL_CHARS)}`;
}

/**
 * Two addresses that a human would read as the same one but are not.
 * @returns {boolean}
 */
export function looksAlike(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y || x === y) return false;
  const head = 2 + HEAD_CHARS;
  return x.slice(0, head) === y.slice(0, head) && x.slice(-TAIL_CHARS) === y.slice(-TAIL_CHARS);
}

/**
 * Screen a recipient against the wallet's own history.
 * @param {string} recipient           the address about to receive funds
 * @param {Array}  history             [{ address, direction:'in'|'out', valueUsd, at }]
 * @param {object} opts                { self, amountUsd, confirmedNewAddress, now }
 */
export function screenRecipient({
  recipient = null,
  history = [],
  self = null,
  amountUsd = null,
  confirmedNewAddress = false,
  now = Date.now()
} = {}) {
  const to = norm(recipient);
  if (!to) {
    return {
      ok: false,
      schema: ADDRESS_SHIELD_SCHEMA,
      verdict: 'reject',
      sendAllowed: false,
      flags: [{ code: 'INVALID', i18nKey: SHIELD_FLAGS.INVALID, params: {} }],
      matches: [],
      error: classifyFailure('MISSING_DATA', { detail: 'INVALID_RECIPIENT' })
    };
  }

  const rows = (Array.isArray(history) ? history : [])
    .map((row) => ({
      address: norm(row?.address),
      direction: row?.direction === 'out' ? 'out' : 'in',
      valueUsd: num(row?.valueUsd),
      at: num(row?.at)
    }))
    .filter((row) => row.address);

  const flags = [];
  const matches = [];

  /* ---- sending to yourself is a mistake worth naming ---- */
  if (norm(self) && norm(self) === to) {
    flags.push({ code: 'SELF_SEND', i18nKey: SHIELD_FLAGS.SELF_SEND, params: {}, severity: 'reject' });
  }

  /* ---- the lookalike check ---- */
  for (const row of rows) {
    if (looksAlike(row.address, to)) {
      matches.push({
        address: row.address,
        fingerprint: addressFingerprint(row.address),
        direction: row.direction,
        lastSeenAt: row.at,
        valueUsd: row.valueUsd
      });
    }
  }
  if (matches.length) {
    flags.push({
      code: 'LOOKALIKE',
      i18nKey: SHIELD_FLAGS.LOOKALIKE,
      // Both addresses in full — the abbreviation is the attack.
      params: { recipient: to, similar: matches[0].address, count: matches.length },
      severity: 'reject'
    });
  }

  /* ---- was this address ever anything but dust? ---- */
  const seen = rows.filter((row) => row.address === to);
  const sentToBefore = seen.some((row) => row.direction === 'out');
  const onlyDust = seen.length > 0
    && seen.every((row) => row.direction === 'in' && row.valueUsd !== null && row.valueUsd <= DUST_THRESHOLD_USD);
  if (onlyDust) {
    flags.push({
      code: 'DUST_ORIGIN',
      i18nKey: SHIELD_FLAGS.DUST_ORIGIN,
      params: { recipient: to, transfers: seen.length },
      severity: 'reject'
    });
  }

  /* ---- a stranger needs its own confirmation ---- */
  if (!sentToBefore) {
    flags.push({
      code: 'FIRST_TIME',
      i18nKey: SHIELD_FLAGS.FIRST_TIME,
      params: { recipient: to, fingerprint: addressFingerprint(to) },
      severity: 'confirm'
    });
  }

  const hardStops = flags.filter((f) => f.severity === 'reject');
  const needsConfirm = flags.filter((f) => f.severity === 'confirm');
  const verdict = hardStops.length
    ? 'reject'
    : (needsConfirm.length && confirmedNewAddress !== true ? 'confirm-address' : 'pass');

  return {
    ok: hardStops.length === 0,
    schema: ADDRESS_SHIELD_SCHEMA,
    verdict,
    // A separate gate from the transaction confirmation, on purpose.
    sendAllowed: verdict === 'pass',
    requiresSeparateAddressConfirmation: needsConfirm.length > 0,
    addressConfirmed: confirmedNewAddress === true,
    recipient: to,
    fingerprint: addressFingerprint(to),
    knownRecipient: sentToBefore,
    flags,
    matches,
    amountUsd: num(amountUsd),
    primaryFlagKey: (hardStops[0] || needsConfirm[0] || null)?.i18nKey || null,
    primaryFlagParams: (hardStops[0] || needsConfirm[0] || null)?.params || {},
    error: hardStops.length ? classifyFailure('RISK_BLOCKED', { detail: hardStops[0].code }) : null,
    screenedAt: now
  };
}

/**
 * Fail-closed guard for the send path: a screen that was skipped, failed, or
 * whose new-address confirmation is still outstanding cannot be broadcast.
 */
export function assertRecipientCleared(screen) {
  if (!screen || screen.schema !== ADDRESS_SHIELD_SCHEMA) {
    return { ok: false, error: classifyFailure('RISK_BLOCKED', { detail: 'RECIPIENT_NOT_SCREENED' }) };
  }
  if (screen.verdict === 'confirm-address') {
    return { ok: false, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'NEW_ADDRESS_UNCONFIRMED' }) };
  }
  if (screen.sendAllowed !== true) {
    return { ok: false, error: classifyFailure('RISK_BLOCKED', { detail: screen.flags?.[0]?.code || 'RECIPIENT_BLOCKED' }) };
  }
  return { ok: true };
}
