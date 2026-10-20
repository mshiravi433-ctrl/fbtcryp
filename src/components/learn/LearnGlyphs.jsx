/**
 * LearnGlyphs — duotone glyphs for the Learn hub's channel tiles.
 * ---------------------------------------------------------------------------
 * The three contact channels (ربات تلگرام · ایمیل · تماس با ما) sit on
 * gradient tiles, and a 1.75px hairline icon on a saturated gradient reads
 * as a scratch rather than a symbol at 46px. These are drawn as FILLED
 * shapes with a soft inner fill (22%) under a 1.8px stroke — the duotone
 * language — so the silhouette carries at a glance and the stroke keeps the
 * edge crisp. Everything is `currentColor`, so the tile decides the colour
 * (near-black on the dark theme, white on the light one) and nothing here
 * needs a theme rule of its own.
 *
 * Same 24-unit box as src/components/Icons.jsx, so they can be swapped for a
 * line icon anywhere without a layout change.
 */
const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

/** The paper plane — Telegram's own silhouette, filled, with the fold line. */
export const GlyphTelegram = (p) => (
  <svg {...base} {...p}>
    <path
      d="M21.4 3.4 3 10.6c-1.1.4-1.1 1.9.05 2.3l4.5 1.4 1.7 5.4c.3.9 1.4 1.1 2 .4l2.5-2.7 4.4 3.2c.8.6 1.9.1 2.1-.8l3-14.8c.2-1-.8-1.9-1.85-1.6Z"
      fill="currentColor"
      fillOpacity=".22"
    />
    <path d="m7.55 14.3 9.9-6.9-7.6 8" />
  </svg>
);

/** An envelope with its flap open just enough to say "unread". */
export const GlyphMail = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="3.4" fill="currentColor" fillOpacity=".22" />
    <path d="m3.4 7.4 7.3 5a2.3 2.3 0 0 0 2.6 0l7.3-5" />
  </svg>
);

/** A headset: the glyph for "a person answers", not a generic user avatar. */
export const GlyphHeadset = (p) => (
  <svg {...base} {...p}>
    <path d="M4 13V11.6a8 8 0 0 1 16 0V13" />
    <rect x="2.8" y="12" width="4.8" height="7.4" rx="2.2" fill="currentColor" fillOpacity=".22" />
    <rect x="16.4" y="12" width="4.8" height="7.4" rx="2.2" fill="currentColor" fillOpacity=".22" />
    <path d="M18.8 19.4v.5a2.1 2.1 0 0 1-2.1 2.1h-3.2" />
    <circle cx="12.4" cy="22" r="1" fill="currentColor" stroke="none" />
  </svg>
);

/** A shield with a tick — the official-channel badge. */
export const GlyphVerified = (p) => (
  <svg {...base} {...p}>
    <path d="M12 2.8 19.2 5.6v5.6c0 4.5-3 8.4-7.2 9.9-4.2-1.5-7.2-5.4-7.2-9.9V5.6L12 2.8Z" fill="currentColor" fillOpacity=".22" />
    <path d="m8.8 12.1 2.2 2.2 4.3-4.6" />
  </svg>
);

/** An open book — the guide, the thing you read before you tap. */
export const GlyphBook = (p) => (
  <svg {...base} {...p}>
    <path d="M12 6.6c-1.6-1.4-3.9-2-7-2v13.2c3.1 0 5.4.6 7 2 1.6-1.4 3.9-2 7-2V4.6c-3.1 0-5.4.6-7 2Z" fill="currentColor" fillOpacity=".22" />
    <path d="M12 6.6v13.2" />
  </svg>
);
