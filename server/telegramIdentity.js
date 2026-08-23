/*
 * SERVER-SIDE TELEGRAM BOT IDENTITY
 * --------------------------------------------------------------------------
 * The numeric bot ID is public and is used only to make configuration drift
 * observable. Authentication still depends exclusively on the private bot
 * token in TELEGRAM_BOT_TOKEN; an ID is not a credential.
 *
 * Keeping this server helper separate from src/lib/telegramBot.js prevents a
 * server secret from ever being pulled into the Vite bundle.
 */

import { normalizeBotToken } from './telegramAuth.js';

const DEFAULT_BOT_ID = '7837421575';
const BOT_ID_RE = /^\d{5,20}$/;
/* What a BotFather token looks like: numeric id, colon, base64url secret. */
const BOT_TOKEN_SHAPE_RE = /^\d{5,20}:[A-Za-z0-9_-]{30,}$/;

function configuredBotId(value) {
  const id = String(value ?? '').trim();
  return BOT_ID_RE.test(id) ? id : DEFAULT_BOT_ID;
}

/** Expected public identity for the deployed FBT Mini App bot. */
export const EXPECTED_TELEGRAM_BOT_ID = configuredBotId(process.env.TELEGRAM_BOT_ID);

/** Extract the public numeric prefix from a Bot API token without exposing it. */
export function botIdFromToken(token) {
  const match = normalizeBotToken(token).match(/^(\d{5,20}):.+$/);
  return match ? match[1] : null;
}

/**
 * Safe diagnostic shape for health and Mini App troubleshooting endpoints.
 * Do not add the token itself (or any token fragment) to this object.
 */
export function telegramBotIdentity(token) {
  const configuredId = botIdFromToken(token);
  return {
    expectedBotId: EXPECTED_TELEGRAM_BOT_ID,
    configuredBotId: configuredId,
    tokenConfigured: Boolean(String(token ?? '').trim()),
    identityMatches: Boolean(configuredId && configuredId === EXPECTED_TELEGRAM_BOT_ID)
  };
}

/*
 * ─── TOKEN DIAGNOSTICS (operator-facing, secret-safe) ──────────────────────
 *
 * BAD_SIGNATURE with a "correct-looking" token has exactly two code-side
 * causes: the bytes on the server are not the bytes Telegram signed with
 * (quotes/BOM pasted into the env, or a different bot's token under the same
 * project), or the initData was mangled in transit. Both are invisible in
 * every dashboard, because dashboards render the value AFTER normalizing it.
 *
 * These helpers make the drift observable without disclosing the secret:
 * a fingerprint of 4 leading + 4 trailing characters of the NORMALIZED token
 * (the leading 4 are the start of the public bot id; 4 trailing characters of
 * a 35+-character secret do not reduce its entropy any more than GitHub's
 * "last 4" display does). The owner compares fingerprints across deploys and
 * projects: same fingerprint everywhere → the token did not change; different
 * fingerprint → the instance that serves the domain holds another token.
 */
export function tokenFingerprint(token) {
  const normalized = normalizeBotToken(token);
  if (normalized.length < 12) return null;
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

/* Any character that can wrap a pasted token value. */
const QUOTE_CHARS = "\"'`“”‘’«»";
/* BOM / zero-width / soft-hyphen characters, anywhere in the stored value. */
const INVISIBLE_CHARS_RE = /[\uFEFF\u200B-\u200F\u2060\u00AD]/;

/** How the stored token differs from the token the HMAC will actually use. */
export function tokenDiagnostics(token) {
  const raw = typeof token === 'string' ? token : '';
  const normalized = normalizeBotToken(raw);
  const whitespaceTrimmed = raw.trim();
  const first = whitespaceTrimmed[0] || '';
  const last = whitespaceTrimmed[whitespaceTrimmed.length - 1] || '';
  return {
    tokenConfigured: Boolean(normalized),
    tokenLength: normalized.length,
    tokenFingerprint: tokenFingerprint(normalized),
    /* Wrapping quotes survived trim() — the classic paste-from-JSON wound. */
    tokenHadQuotes: whitespaceTrimmed.length >= 2 && QUOTE_CHARS.includes(first) && QUOTE_CHARS.includes(last),
    /* Invisible format characters, edge or interior. Edge ones are stripped
       by normalization; interior ones are NOT and require re-pasting the
       value — either way the raw env value was poisoned. Tested on the RAW
       value because trim() silently eats the BOM, hiding the very byte the
       operator needs to know about. */
    tokenHadInvisibleChars: INVISIBLE_CHARS_RE.test(raw),
    /* True when the env value needed any cleaning at all. */
    tokenWasNormalized: normalized !== raw,
    tokenShapeValid: BOT_TOKEN_SHAPE_RE.test(normalized),
    configuredBotId: botIdFromToken(normalized),
    expectedBotId: EXPECTED_TELEGRAM_BOT_ID,
    identityMatches: Boolean(botIdFromToken(normalized) && botIdFromToken(normalized) === EXPECTED_TELEGRAM_BOT_ID)
  };
}
