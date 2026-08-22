/*
 * PUBLIC TELEGRAM BOT IDENTITY
 * --------------------------------------------------------------------------
 * This module owns every browser-facing reference to the FBT Telegram bot.
 * Keeping the username in one place means a bot migration cannot leave old
 * referral links behind in an APK, a cached web bundle, or a share sheet.
 *
 * Both values below are PUBLIC identifiers:
 *   - a username is visible in the t.me URL;
 *   - a bot ID is visible to Telegram clients and in signed Mini App metadata.
 * They are deliberately safe to override with VITE_ variables.
 *
 * A BOT TOKEN IS NOT HERE. It proves control of the bot and must remain in
 * TELEGRAM_BOT_TOKEN on the server / Vercel only. A bot ID cannot verify a
 * Telegram Mini App session.
 */

const DEFAULT_BOT_USERNAME = 'fbtco_bot';
const DEFAULT_BOT_ID = '7837421575';

const USERNAME_RE = /^[A-Za-z0-9_]{5,32}$/;
const BOT_ID_RE = /^\d{5,20}$/;
const START_PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;

const clientEnv = () =>
  typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

function publicUsername(value) {
  const normalized = String(value ?? '').trim().replace(/^@/, '');
  return USERNAME_RE.test(normalized) ? normalized : DEFAULT_BOT_USERNAME;
}

function publicBotId(value) {
  const normalized = String(value ?? '').trim();
  return BOT_ID_RE.test(normalized) ? normalized : DEFAULT_BOT_ID;
}

/** The bot username without @, for text or a t.me path. */
export const TELEGRAM_BOT_USERNAME = publicUsername(clientEnv().VITE_TELEGRAM_BOT_USERNAME);

/** Public Telegram bot identifier — informational only, never an auth secret. */
export const TELEGRAM_BOT_ID = publicBotId(clientEnv().VITE_TELEGRAM_BOT_ID);

/** Canonical public chat / Mini App entry link. */
export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

/**
 * Link directly into the bot's Main Mini App, optionally carrying a referral.
 * Telegram delivers a valid `startapp` value as `initDataUnsafe.start_param`.
 * The app consumes it once through `captureReferral`, so the attribution does
 * not disappear between opening Telegram and the first swap.
 *
 * Telegram permits URL-safe start parameters; invalid input intentionally falls
 * back to the bare bot URL rather than emitting a malformed deep link.
 */
export function telegramBotStartAppUrl(startParam = '') {
  const value = String(startParam ?? '').trim();
  if (!START_PARAM_RE.test(value)) return TELEGRAM_BOT_URL;
  return `${TELEGRAM_BOT_URL}?startapp=${encodeURIComponent(value)}`;
}
