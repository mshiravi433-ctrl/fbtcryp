/**
 * TELEGRAM AUTH PROBE — verifyInitData against poisoned bot tokens and
 * mangled transports.
 *
 * The failure this guards against is real and maddening to diagnose: an env
 * store (Vercel, dotenv, copy-paste) keeps a trailing newline, surrounding
 * spaces, WRAPPING QUOTES or an invisible zero-width character next to the
 * bot token. The botId prefix still LOOKS right in any diagnostic, but the
 * HMAC key differs by one byte, so every genuine Telegram initData comes back
 * BAD_SIGNATURE. verifyInitData must therefore normalize the token it is
 * given — and ONLY the token: the initData payload is the exact byte sequence
 * Telegram signed and must never be normalized.
 *
 * The second half exercises the transport extraction rules (body over header
 * over query, credential stripped from the body) and the operator-facing
 * token diagnostics, so BAD_SIGNATURE can be attributed without ever
 * printing the secret.
 *
 * The token used here is a throwaway test value, not a real bot secret.
 */
import { createHmac } from 'node:crypto';
import { verifyInitData, normalizeBotToken, extractInitData, telegramAuth } from '../server/telegramAuth.js';
import { tokenDiagnostics, tokenFingerprint } from '../server/telegramIdentity.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

/* A syntactically bot-token-shaped test value. NOT a real secret. */
const CLEAN_TOKEN = '1234567890:TEST-not-a-real-bot-token-AAAAAAAA';

/** A real Mini App signature, computed the way Telegram computes it. */
function signInitData(token, fields = {}) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 4242, first_name: 'Probe' }),
    ...fields
  });
  /* Telegram's data_check_string: all fields except hash, sorted BY FIELD
     NAME, joined as key=value lines. */
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
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

  /* Quotes around the value — the paste-from-JSON wound. trim() keeps them,
     the HMAC key changes, every session becomes BAD_SIGNATURE. */
  t('double-quoted token still verifies',
    verifyInitData(initData, `"${CLEAN_TOKEN}"`).ok === true);
  t('single-quoted token still verifies',
    verifyInitData(initData, `'${CLEAN_TOKEN}'`).ok === true);
  t('curly-quoted token still verifies',
    verifyInitData(initData, `\u201C${CLEAN_TOKEN}\u201D`).ok === true);
  t('double-wrapped quotes plus spaces still verify',
    verifyInitData(initData, ` "'${CLEAN_TOKEN}'" \n`).ok === true);

  /* Invisible characters: BOM at the very start (dotenv reads the file
     literally) and a zero-width space glued to the end by a rich editor. */
  t('a BOM before the token still verifies',
    verifyInitData(initData, `\uFEFF${CLEAN_TOKEN}`).ok === true);
  t('a zero-width space after the token still verifies',
    verifyInitData(initData, CLEAN_TOKEN + '\u200B').ok === true);
  t('BOM + quotes + newline combined still verify',
    verifyInitData(initData, `\uFEFF\u200B"${CLEAN_TOKEN}"\r\n\u200B`).ok === true);

  /* Only the EDGES are normalized: an invisible character INSIDE the token
     body is a different stored value, not formatting, and must fail closed
     (the owner re-pastes the secret rather than the server guessing). */
  t('an invisible character inside the token body is BAD_SIGNATURE',
    verifyInitData(initData, CLEAN_TOKEN.slice(0, 20) + '\u200B' + CLEAN_TOKEN.slice(20)).reason === 'BAD_SIGNATURE');

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

  /* A DIFFERENT bot's token must never verify — normalization is cleaning,
     not a fallback to alternate credentials. */
  t('a wrong bot token is BAD_SIGNATURE',
    verifyInitData(initData, '1234567890:TEST-not-a-real-bot-token-BBBBBBBB').reason === 'BAD_SIGNATURE');
  t('a wrong bot token wrapped in quotes is still BAD_SIGNATURE',
    verifyInitData(initData, `"1234567890:TEST-not-a-real-bot-token-BBBBBBBB"`).reason === 'BAD_SIGNATURE');

  /* Fail closed: a token that trims away to nothing is missing, not valid. */
  t('a whitespace-only token fails closed as MISSING_INPUT',
    verifyInitData(initData, ' \n ').reason === 'MISSING_INPUT');
  t('an empty token fails closed as MISSING_INPUT',
    verifyInitData(initData, '').reason === 'MISSING_INPUT');
  t('a quote-only token fails closed as MISSING_INPUT',
    verifyInitData(initData, '""').reason === 'MISSING_INPUT');
  t('a non-string token fails closed as MISSING_INPUT',
    verifyInitData(initData, 12345).reason === 'MISSING_INPUT');

  /* The check string sorts BY FIELD NAME, exactly like Telegram. With a
     prefix-colliding key pair (user / user2), sorting the joined key=value
     LINES would produce a different order (the byte '=' sorts after digits)
     and break the HMAC — this locks in the official behaviour. */
  t('prefix-colliding fields verify with the by-name sort',
    verifyInitData(signInitData(CLEAN_TOKEN, { user2: 'extra-field' }), CLEAN_TOKEN).ok === true);
  t('prefix-colliding fields verify even against a quoted stored token',
    verifyInitData(signInitData(CLEAN_TOKEN, { user2: 'extra-field' }), `'${CLEAN_TOKEN}'`).ok === true);

  /* ── Transport extraction: body wins, header stays, credential consumed ── */
  {
    const bodyReq = {
      get: () => undefined,
      body: { initData },
      query: {}
    };
    t('extractInitData prefers the byte-exact JSON body',
      extractInitData(bodyReq).initData === initData && extractInitData(bodyReq).source === 'body');

    const bothReq = {
      get: (name) => (name === 'x-telegram-init-data' ? initData + '&poisoned=1' : undefined),
      body: { initData },
      query: {}
    };
    t('the body copy wins when both transports are present',
      extractInitData(bothReq).initData === initData);
    t('both raw copies are exposed for the transit comparison',
      extractInitData(bothReq).headerInitData === initData + '&poisoned=1' && extractInitData(bothReq).bodyInitData === initData);

    const headerReq = {
      get: (name) => (name === 'x-telegram-init-data' ? initData : undefined),
      body: undefined,
      query: {}
    };
    t('a header-only request still reads the header',
      extractInitData(headerReq).initData === initData && extractInitData(headerReq).source === 'header');

    const queryReq = {
      get: () => undefined,
      body: undefined,
      query: { initData }
    };
    t('a query-only request is the last resort',
      extractInitData(queryReq).initData === initData && extractInitData(queryReq).source === 'query');

    t('a non-string body initData is ignored, not coerced',
      extractInitData({ get: () => undefined, body: { initData: { user: 'nope' } }, query: {} }).initData === '');

    /* The middleware consumes the credential: after it runs, handlers (and
       anything they persist) no longer see the signed blob in req.body. */
    let middlewareDone = false;
    const mw = telegramAuth(CLEAN_TOKEN);
    const consumed = { get: () => undefined, body: { initData, name: 'keep' }, query: {} };
    await new Promise((resolve) => mw(consumed, {}, resolve));
    middlewareDone = consumed.tgUser?.id === 4242;
    t('the middleware authenticates a body-carried session',
      middlewareDone);
    t('the middleware strips the credential from the body it hands on',
      consumed.body.initData === undefined && consumed.body.name === 'keep');
    t('the middleware keeps the raw copies for diagnostics',
      consumed.telegramInitData?.bodyInitData === initData);
  }

  /* ── Token diagnostics: observable drift without disclosing the secret ── */
  {
    const clean = tokenDiagnostics(CLEAN_TOKEN);
    t('diagnostics fingerprint is 4 leading + 4 trailing characters only',
      clean.tokenFingerprint === '1234…AAAA');
    t('a clean stored token reports no quotes and no invisible characters',
      clean.tokenHadQuotes === false && clean.tokenHadInvisibleChars === false && clean.tokenWasNormalized === false);

    const quoted = tokenDiagnostics(`\uFEFF"${CLEAN_TOKEN}"\n`);
    t('a quoted/BOM-pasted token is flagged',
      quoted.tokenHadQuotes === true && quoted.tokenHadInvisibleChars === true && quoted.tokenWasNormalized === true);
    t('diagnostics never grow the full token back',
      JSON.stringify(quoted).includes(CLEAN_TOKEN) === false);
    t('the fingerprint alone is shorter than any usable secret',
      String(quoted.tokenFingerprint).length === 9);
    t('tokenDiagnostics still sees the expected bot identity',
      quoted.configuredBotId === '1234567890' && quoted.identityMatches === false);

    t('a short or missing token has no fingerprint',
      tokenFingerprint('12:xx') === null && tokenDiagnostics('').tokenFingerprint === null);
  }

  return rows;
}
