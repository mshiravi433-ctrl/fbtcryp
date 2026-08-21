/**
 * TELEGRAM AUTH PROBE — verifyInitData against whitespace-poisoned bot tokens.
 *
 * The failure this guards against is real and maddening to diagnose: an env
 * store (Vercel, dotenv, copy-paste) keeps a trailing newline or surrounding
 * spaces next to the bot token. The botId prefix still LOOKS right in any
 * diagnostic, but the HMAC key differs by one byte, so every genuine Telegram
 * initData comes back BAD_SIGNATURE. verifyInitData must therefore trim the
 * token it is given — and ONLY the token: the initData payload is the exact
 * byte sequence Telegram signed and must never be normalized.
 *
 * The token used here is a throwaway test value, not a real bot secret.
 */
import { createHmac } from 'node:crypto';
import { verifyInitData } from '../server/telegramAuth.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

/* A syntactically bot-token-shaped test value. NOT a real secret. */
const CLEAN_TOKEN = '1234567890:TEST-not-a-real-bot-token-AAAAAAAA';

/** A real Mini App signature, computed the way Telegram computes it. */
function signInitData(token, userId = 4242) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Probe' })
  });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

export default async function run() {
  const initData = signInitData(CLEAN_TOKEN);

  /* Baseline: a clean token verifies. */
  {
    const r = verifyInitData(initData, CLEAN_TOKEN);
    t('a clean bot token verifies genuine initData', r.ok === true && String(r.user?.id) === '4242');
  }

  /* The regression: whitespace smuggled into the stored secret must not
     change the verdict. Telegram signed with the clean token; the server
     env holds a poisoned copy of the SAME token. */
  t('a trailing newline on the stored token still verifies',
    verifyInitData(initData, CLEAN_TOKEN + '\n').ok === true);
  t('a trailing CRLF on the stored token still verifies',
    verifyInitData(initData, CLEAN_TOKEN + '\r\n').ok === true);
  t('leading and trailing spaces on the stored token still verify',
    verifyInitData(initData, `  ${CLEAN_TOKEN}  `).ok === true);

  /* Only the token is normalized — the signed payload must stay byte-exact,
     so tampering with initData still fails even under a poisoned token. */
  {
    const forged = new URLSearchParams(initData);
    forged.set('hash', '0'.repeat(64));
    t('a forged hash is BAD_SIGNATURE', verifyInitData(forged.toString(), CLEAN_TOKEN).reason === 'BAD_SIGNATURE');
    t('a forged hash is BAD_SIGNATURE even with a newline-poisoned token',
      verifyInitData(forged.toString(), CLEAN_TOKEN + '\n').reason === 'BAD_SIGNATURE');

    const tampered = new URLSearchParams(initData);
    tampered.set('user', JSON.stringify({ id: 999999, first_name: 'Attacker' }));
    t('a tampered user field is BAD_SIGNATURE', verifyInitData(tampered.toString(), CLEAN_TOKEN).reason === 'BAD_SIGNATURE');
  }

  /* A DIFFERENT bot's token must never verify — trimming is normalization,
     not a fallback to alternate credentials. */
  t('a wrong bot token is BAD_SIGNATURE',
    verifyInitData(initData, '1234567890:TEST-not-a-real-bot-token-BBBBBBBB').reason === 'BAD_SIGNATURE');

  /* Fail closed: a token that trims away to nothing is missing, not valid. */
  t('a whitespace-only token fails closed as MISSING_INPUT',
    verifyInitData(initData, ' \n ').reason === 'MISSING_INPUT');
  t('an empty token fails closed as MISSING_INPUT',
    verifyInitData(initData, '').reason === 'MISSING_INPUT');
  t('a non-string token fails closed as MISSING_INPUT',
    verifyInitData(initData, 12345).reason === 'MISSING_INPUT');

  return rows;
}
