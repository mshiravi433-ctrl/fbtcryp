/**
 * ISO 3166-1 alpha-2 → flag, with an honest fallback.
 * ---------------------------------------------------------------------------
 * A regional-indicator pair (U+1F1E6 + letter offset) is what every platform
 * renders as a flag. No package, no sprite sheet, no network request: two code
 * points computed from the two letters the server already sends us in
 * `country_codes` (server/hodlhodl.js).
 *
 * ─── WHY THERE IS A FALLBACK AT ALL ─────────────────────────────────────────
 * Regional indicators are valid text everywhere, but only some platforms map a
 * PAIR of them to a flag glyph:
 *
 *   • Windows has never shipped flag emoji. Chrome and Firefox on Windows
 *     render "DE" as two boxed letters — which happens to be readable, but
 *     Edge/WebView2 in some configurations renders tofu instead.
 *   • Older Android WebViews lack newer country pairs entirely.
 *
 * So `flagEmoji` returns the emoji and `flagFallback` returns the two letters,
 * and the caller renders the letters when `flagSupported()` says the platform
 * cannot draw flags. Two letters in a chip is a fine outcome; an empty box is
 * not, and neither is a layout that assumed a 1-character-wide glyph.
 *
 * ─── WHY SUPPORT DETECTION IS MEASURED, NOT SNIFFED ─────────────────────────
 * User-agent sniffing for "is this Windows" is exactly the check that rots.
 * Instead we draw one known flag to a canvas and measure it against the same
 * two letters rendered as plain regional indicators: if the platform composed
 * them into a single flag glyph the widths differ, if it drew two letter boxes
 * they are identical. The result is cached for the session — this touches the
 * DOM once, ever.
 */

const A = 0x1f1e6; /* REGIONAL INDICATOR SYMBOL LETTER A */
const CODE_RE = /^[A-Za-z]{2}$/;

/** Normalise anything the API might hand us to a clean upper-case pair. */
export function normalizeCountryCode(code) {
  const c = String(code ?? '').trim();
  return CODE_RE.test(c) ? c.toUpperCase() : null;
}

/** The flag emoji for a country code, or '' when the code is not a code. */
export function flagEmoji(code) {
  const c = normalizeCountryCode(code);
  if (!c) return '';
  return String.fromCodePoint(A + (c.charCodeAt(0) - 65), A + (c.charCodeAt(1) - 65));
}

/** The two-letter fallback shown where flags do not render. */
export function flagFallback(code) {
  return normalizeCountryCode(code) ?? '';
}

let supportCache = null;

/**
 * Can this platform draw a flag emoji?
 *
 * Returns true on the server / in any environment without a canvas: rendering
 * the emoji is the better default, and the fallback exists for the specific
 * platforms that measurably cannot.
 *
 * @param {boolean} [force] — recompute instead of using the session cache.
 *   Only the test suite passes this.
 */
export function flagSupported(force = false) {
  if (!force && supportCache !== null) return supportCache;
  if (typeof document === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return true;
    ctx.font = '16px sans-serif';
    /* 🇨🇦 as one glyph vs. the same two indicators separated by a zero-width
       non-joiner, which forces them NOT to combine. Equal widths mean the
       platform never combined them in the first place. */
    const joined = ctx.measureText('\u{1F1E8}\u{1F1E6}').width;
    const split = ctx.measureText('\u{1F1E8}\u200c\u{1F1E6}').width;
    supportCache = joined > 0 && joined < split;
    return supportCache;
  } catch {
    return true;
  }
}
