/**
 * WHERE TO REACH US
 * ---------------------------------------------------------------------------
 * The support address lives here, once, because it is about to change.
 *
 * ─── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────
 * Cafe Bazaar rejected our submission partly because the contact address is a
 * Gmail account. They want an address on our own domain — that is their cheap
 * proof we actually control `fbtswap.ir`.
 *
 * When the swap happens, `fbtswap@gmail.com` appears in SIXTEEN files: three
 * locale bundles, four screens, the AI system prompt, index.html's structured
 * data, the LICENSE, four docs and a test. Changing that by hand means
 * fourteen chances to miss one — and a support address that is stale in one
 * screen is worse than a missing one, because a user emails into a void and
 * concludes we abandoned the app.
 *
 * So the value is centralised and read from an env var. Switching to the new
 * address becomes one variable in Vercel and one line in the CI workflow,
 * with no code change and no chance of a leftover.
 *
 * ─── WHY VITE_ IS SAFE HERE, WHEN IT USUALLY IS NOT ─────────────────────────
 * A `VITE_`-prefixed variable is compiled into the browser bundle and is
 * readable by anyone. That rules it out for secrets. A support address is the
 * opposite of a secret: it is printed on the contact screen, in the store
 * listing and in the app manifest. Public is the point.
 *
 * ─── WHY THE LOCALES STILL CONTAIN THE LITERAL ──────────────────────────────
 * Some strings embed the address mid-sentence ("Email us at X, or visit the
 * office…") across twelve languages. Interpolating all of those would mean
 * touching translated safety copy in languages I cannot verify, which is the
 * one thing I will not do. `withContactEmail()` below rewrites the address in
 * translated text at render time instead — no translator required, and a
 * locale that has not been updated cannot go stale.
 */

/** The address a user should write to. Overridable at build time. */
export const SUPPORT_EMAIL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPPORT_EMAIL) ||
  'fbtswap@gmail.com';

/** `mailto:` form, for links and buttons. */
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

/**
 * The address that is baked into the twelve translation bundles.
 *
 * Kept as a separate constant from SUPPORT_EMAIL on purpose: this one is a
 * historical fact about the locale files, not a setting. If someone changes
 * SUPPORT_EMAIL, this must NOT follow — it is the needle we search for.
 */
export const LEGACY_EMAIL_IN_LOCALES = 'fbtswap@gmail.com';

/**
 * Swap the baked-in address for the configured one inside a translated string.
 *
 * A no-op when they are the same, which is the current state — so this costs
 * nothing until the day the address actually changes.
 *
 * @param {string} text a translated string that may mention the old address
 * @returns {string}
 */
export function withContactEmail(text) {
  if (typeof text !== 'string') return text;
  if (SUPPORT_EMAIL === LEGACY_EMAIL_IN_LOCALES) return text;
  // split/join rather than a regex: an address contains '.' and '+', both of
  // which are regex metacharacters, and building a pattern from a
  // configurable value is how injection bugs start.
  return text.split(LEGACY_EMAIL_IN_LOCALES).join(SUPPORT_EMAIL);
}
