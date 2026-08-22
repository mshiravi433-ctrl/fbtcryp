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

const DEFAULT_BOT_ID = '7837421575';
const BOT_ID_RE = /^\d{5,20}$/;

function configuredBotId(value) {
  const id = String(value ?? '').trim();
  return BOT_ID_RE.test(id) ? id : DEFAULT_BOT_ID;
}

/** Expected public identity for the deployed FBT Mini App bot. */
export const EXPECTED_TELEGRAM_BOT_ID = configuredBotId(process.env.TELEGRAM_BOT_ID);

/** Extract the public numeric prefix from a Bot API token without exposing it. */
export function botIdFromToken(token) {
  const match = String(token ?? '').trim().match(/^(\d{5,20}):.+$/);
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
