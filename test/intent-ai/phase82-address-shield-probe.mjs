/**
 * PHASE 82 — ADDRESS POISONING SHIELD
 * A similar address is not the recipient. An address that matches the head and
 * tail a human actually reads, or that only ever arrived as dust, is a hard
 * stop — and a stranger needs its own confirmation, separate from the
 * transaction confirmation.
 */
import { readFileSync } from 'node:fs';
import {
  looksAlike, addressFingerprint, screenRecipient, assertRecipientCleared,
  SHIELD_FLAGS, DUST_THRESHOLD_USD, ADDRESS_SHIELD_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const REAL = '0xa1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
// Same first 6 and last 4 characters — exactly what a human eyeballs.
const POISON = '0xa1b2c39999999999999999999999999999995678';
const OTHER = '0x1111222233334444555566667777888899990000';
const SELF = '0xffffeeeeddddccccbbbbaaaa9999888877776666';

const HISTORY = [
  { address: REAL, direction: 'out', valueUsd: 250, at: NOW - 10 * DAY },
  { address: OTHER, direction: 'out', valueUsd: 40, at: NOW - 3 * DAY }
];
const run = (recipient, over = {}) => screenRecipient({ recipient, history: HISTORY, self: SELF, now: NOW, ...over });

try {
  /* ---------- the lookalike primitive ---------- */
  check('an address matching head and tail is a lookalike', looksAlike(REAL, POISON) === true);
  check('an address is not a lookalike of itself', looksAlike(REAL, REAL) === false);
  check('an unrelated address is not a lookalike', looksAlike(REAL, OTHER) === false);
  check('an invalid address is never a lookalike', looksAlike(REAL, 'not-an-address') === false);
  check('the fingerprint shows the part a human reads', addressFingerprint(REAL).startsWith('0xa1b2c3'));
  check('the fingerprint ends with the tail a human reads', addressFingerprint(REAL).endsWith('5678'));
  check('an invalid address has no fingerprint', addressFingerprint('0x00') === null);

  /* ---------- a lookalike is a hard stop ---------- */
  const poisoned = run(POISON);
  check('a lookalike recipient is rejected', poisoned.verdict === 'reject' && poisoned.sendAllowed === false);
  check('the rejection is flagged as a lookalike', poisoned.flags.some((f) => f.code === 'LOOKALIKE'));
  check('the flag is a translatable key', poisoned.primaryFlagKey === SHIELD_FLAGS.LOOKALIKE);
  check('BOTH addresses are shown in full, since the abbreviation is the attack',
    poisoned.primaryFlagParams.recipient === POISON.toLowerCase() && poisoned.primaryFlagParams.similar === REAL.toLowerCase());
  check('the matching history entry is reported', poisoned.matches[0].address === REAL.toLowerCase());
  check('the rejection carries a classified error', typeof poisoned.error?.code === 'string');
  check('a lookalike cannot be waved through by confirming the address',
    run(POISON, { confirmedNewAddress: true }).sendAllowed === false);

  /* ---------- dust bait ---------- */
  const dustHistory = [{ address: POISON, direction: 'in', valueUsd: 0, at: NOW - DAY }];
  const dusted = screenRecipient({ recipient: POISON, history: dustHistory, self: SELF, now: NOW });
  check('an address that only ever arrived as dust is rejected', dusted.verdict === 'reject');
  check('the dust origin is named', dusted.flags.some((f) => f.code === 'DUST_ORIGIN'));
  const nearDust = screenRecipient({
    recipient: POISON, history: [{ address: POISON, direction: 'in', valueUsd: DUST_THRESHOLD_USD, at: NOW - DAY }], self: SELF, now: NOW
  });
  check('a near-zero incoming transfer counts as dust', nearDust.flags.some((f) => f.code === 'DUST_ORIGIN'));
  const realCounterparty = screenRecipient({
    recipient: POISON, history: [{ address: POISON, direction: 'in', valueUsd: 5000, at: NOW - DAY }], self: SELF, now: NOW
  });
  check('a real incoming payment is not dust', realCounterparty.flags.every((f) => f.code !== 'DUST_ORIGIN'));

  /* ---------- a stranger needs its own confirmation ---------- */
  const stranger = run(OTHER.replace(/0000$/, '1234'));
  check('a never-used address is not blocked outright', stranger.verdict === 'confirm-address');
  check('but it cannot be sent to yet', stranger.sendAllowed === false);
  check('it asks for a SEPARATE address confirmation', stranger.requiresSeparateAddressConfirmation === true);
  check('the prompt is a translatable key', stranger.primaryFlagKey === SHIELD_FLAGS.FIRST_TIME);
  check('the prompt shows the fingerprint the user should compare', typeof stranger.primaryFlagParams.fingerprint === 'string');
  const confirmed = run(OTHER.replace(/0000$/, '1234'), { confirmedNewAddress: true });
  check('once the address is confirmed on its own, the send may proceed', confirmed.verdict === 'pass' && confirmed.sendAllowed === true);
  check('the confirmation is recorded', confirmed.addressConfirmed === true);

  /* ---------- a known counterparty is not a stranger ---------- */
  const known = run(REAL);
  check('an address already paid before passes', known.verdict === 'pass' && known.sendAllowed === true);
  check('it is reported as a known recipient', known.knownRecipient === true);
  check('a known recipient needs no extra confirmation', known.requiresSeparateAddressConfirmation === false);
  check('an address only ever RECEIVED from is still a stranger to send to',
    screenRecipient({ recipient: OTHER, history: [{ address: OTHER, direction: 'in', valueUsd: 900, at: NOW - DAY }], now: NOW }).knownRecipient === false);

  /* ---------- empty history fails SAFE ---------- */
  const noHistory = screenRecipient({ recipient: REAL, history: [], now: NOW });
  check('with no history every recipient is a stranger', noHistory.verdict === 'confirm-address');
  check('an unreadable history never produces a silent pass',
    screenRecipient({ recipient: REAL, history: null, now: NOW }).sendAllowed === false);

  /* ---------- basics ---------- */
  check('an invalid recipient is rejected', run('nonsense').verdict === 'reject');
  check('sending to your own address is flagged', run(SELF).flags.some((f) => f.code === 'SELF_SEND'));
  check('the screen declares its schema', known.schema === ADDRESS_SHIELD_SCHEMA);

  /* ---------- the fail-closed guard ---------- */
  check('the guard accepts a cleared recipient', assertRecipientCleared(known).ok === true);
  check('the guard rejects a lookalike', assertRecipientCleared(poisoned).ok === false);
  check('the guard rejects an unconfirmed new address', assertRecipientCleared(stranger).ok === false);
  check('the unconfirmed case asks for authorization, not a generic failure',
    assertRecipientCleared(stranger).error.code === 'USER_AUTHORIZATION_REQUIRED');
  check('a caller that skipped the screen is refused', assertRecipientCleared(null).ok === false);
  check('a hand-made object cannot pass as a screen', assertRecipientCleared({ sendAllowed: true }).ok === false);

  /* ---------- the send sheet actually uses it ---------- */
  const sheet = readFileSync('src/components/SendSheet.jsx', 'utf8');
  check('the send sheet screens the recipient', /screenRecipient\(/.test(sheet));
  check('the send sheet re-asserts the shield at send time, not only in the UI',
    /assertRecipientCleared\(shield\)/.test(sheet));
  check('the review button is locked until the recipient is cleared', /recipientCleared/.test(sheet));
  check('the sheet renders a separate address confirmation', /data-testid="address-shield-confirm"/.test(sheet));
  check('the sheet renders hard stops as blocking notices', /data-testid="address-shield-block"/.test(sheet));
  check('the separate confirmation resets when the address changes', /setAddressOk\(false\)/.test(sheet));
  const shieldBlock = (sheet.match(/data-testid="address-shield"[\s\S]*?data-testid="address-shield-confirm"[\s\S]*?<\/div>/) || [''])[0];
  check('the new shield markup holds no hardcoded Persian or Arabic string',
    shieldBlock.length > 0 && !/[\u0600-\u06FF]/.test(shieldBlock));
  check('the shield markup renders only i18n keys', /t\(f\.i18nKey, f\.params\)/.test(shieldBlock));

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('every shield flag is translated in en, fa and ar',
    locales.every((loc) => ['lookalike', 'dustOrigin', 'firstTime', 'selfSend', 'invalid']
      .every((k) => typeof loc?.intentAI?.addressShield?.flag?.[k] === 'string')));
  check('the blocked-recipient send error is translated in en, fa and ar',
    locales.every((loc) => typeof loc?.send?.err?.RECIPIENT_BLOCKED === 'string'));

  console.log(JSON.stringify({ probe: 'phase82-address-shield', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
