/**
 * THE MARKET SCREEN'S OWN GLYPH VOCABULARY.
 * ---------------------------------------------------------------------------
 * «ایکون svg» — every mark on this screen is drawn, not typed.
 *
 * Two rules the whole set obeys, because they are the rules the shared set in
 * components/Icons.jsx already obeys:
 *
 *   1. `currentColor` + a 1.7 stroke on a 24×24 box. A glyph inherits the
 *      colour of the text beside it, so an accent token recolours the icon and
 *      the label together and the light theme needs no second artwork.
 *   2. `aria-hidden` by the caller. A glyph is decoration next to a word; the
 *      word is the accessible name.
 *
 * The marks that already exist in components/Icons.jsx (search, refresh, star,
 * chart, sparkle, swap, globe, coins) are NOT duplicated here — this file only
 * holds the ones that belong to the market deck itself.
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false
};

/* ── THE DECK MARK ──────────────────────────────────────────────────────────
   A squircle with a rising line inside: "the whole market, in one frame".
   It is the mark of the unified box, so it must not read as either of the two
   readings inside it (a coin, or a candlestick). */
export const GlyphDeck = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="5.5" />
    <path d="M7 15.2 10.4 11l2.8 2.8L17 9.4" />
    <path d="M17 12.4V9.4h-3" />
  </svg>
);

/* ── DIRECTION ──────────────────────────────────────────────────────────────
   One arrow, drawn twice. Replaces the typed diagonal arrows that could not be
   recoloured by an accent token and rendered as a text glyph on every OS. */
export const GlyphTrendUp = (p) => (
  <svg {...base} {...p}>
    <path d="M6 18 18 6" />
    <path d="M9.5 6H18v8.5" />
  </svg>
);

export const GlyphTrendDown = (p) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12" />
    <path d="M18 9.5V18H9.5" />
  </svg>
);

/* The sort direction button: two stacked bars and a head, flipped by CSS-free
   markup rather than by a rotated transform (a rotated arrow in RTL reads the
   same, but two distinct paths are unambiguous at 14px). */
export const GlyphSortDesc = (p) => (
  <svg {...base} {...p}>
    <path d="M12 4v14" />
    <path d="m6.5 13 5.5 5.5L17.5 13" />
  </svg>
);

export const GlyphSortAsc = (p) => (
  <svg {...base} {...p}>
    <path d="M12 20V6" />
    <path d="M6.5 11 12 5.5 17.5 11" />
  </svg>
);

export const GlyphChevron = (p) => (
  <svg {...base} {...p}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </svg>
);

export const GlyphCaretDown = (p) => (
  <svg {...base} {...p}>
    <path d="m5.5 9 6.5 6.5L18.5 9" />
  </svg>
);

/* ── THE THREE DOMINANCE MARKS ──────────────────────────────────────────────
   Bitcoin and Ethereum carry their own marks (that is what a reader looks for
   in a dominance row); volume carries bars. */
export const GlyphBitcoin = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M9.8 7.9h3.5a2.05 2.05 0 0 1 0 4.1H9.8z" />
    <path d="M9.8 12h3.9a2.05 2.05 0 0 1 0 4.1H9.8z" />
    <path d="M11.2 6.2v1.7M13.2 6.2v1.7M11.2 16.1v1.7M13.2 16.1v1.7" />
  </svg>
);

export const GlyphEthereum = (p) => (
  <svg {...base} {...p}>
    <path d="M12 2.9 6.6 11.6 12 14.9l5.4-3.3z" />
    <path d="M12 17.2 6.6 13.9 12 21.1l5.4-7.2z" />
  </svg>
);

export const GlyphVolume = (p) => (
  <svg {...base} {...p}>
    <path d="M5.5 20v-6.5M12 20V4.5M18.5 20v-9.5" />
  </svg>
);

export const GlyphWave = (p) => (
  <svg {...base} {...p}>
    <path d="M3 12.6h3.4l2.2-5.8 3.6 10.4 2.4-6.2 1.6 3h4.8" />
  </svg>
);

export const GlyphGrid = (p) => (
  <svg {...base} {...p}>
    <rect x="3.6" y="3.6" width="7" height="7" rx="2.2" />
    <rect x="13.4" y="3.6" width="7" height="7" rx="2.2" />
    <rect x="3.6" y="13.4" width="7" height="7" rx="2.2" />
    <rect x="13.4" y="13.4" width="7" height="7" rx="2.2" />
  </svg>
);

export const GlyphGlobe = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M3.6 12h16.8" />
    <path d="M12 3.4c2.3 2.4 3.5 5.3 3.5 8.6s-1.2 6.2-3.5 8.6c-2.3-2.4-3.5-5.3-3.5-8.6s1.2-6.2 3.5-8.6z" />
  </svg>
);

/* ── «داغ‌ترین کوین‌ها» ───────────────────────────────────────────────────────
   A flame with an inner lick. Drawn rather than typed so its hue can follow
   the card's accent instead of arriving as a platform emoji. */
export const GlyphFlame = (p) => (
  <svg {...base} {...p}>
    <path d="M12.4 2.8c.5 3-1.1 4.3-2.6 5.7-1.6 1.5-3.2 3-3.2 6a5.9 5.9 0 0 0 11.8 0c0-2.6-1.3-4.2-2.6-5.6" />
    <path d="M12 20.4a3 3 0 0 0 3-3c0-2-2.1-2.7-2.4-5-.9.9-3.6 2.4-3.6 5a3 3 0 0 0 3 3z" />
  </svg>
);

/* ── «دسته‌ها» ──────────────────────────────────────────────────────────────
   A rail seen edge-on: three tiles and the track they slide along. It marks
   the sector strip's own box, so the strip reads as a surface rather than as
   a row of tabs that fell out of the list card. */
export const GlyphSectorRail = (p) => (
  <svg {...base} {...p}>
    <rect x="3.4" y="6.6" width="5.4" height="5.4" rx="1.7" />
    <rect x="10.6" y="6.6" width="4.4" height="5.4" rx="1.6" />
    <path d="M17.2 6.9h3.4M17.2 11.7h3.4" />
    <path d="M3.6 17.4h16.8" />
  </svg>
);

/* ── نبض بازار ──────────────────────────────────────────────────────────────
   A pulse inside a rounded frame: an instrument, not a progress bar. */
export const GlyphPulse = (p) => (
  <svg {...base} {...p}>
    <path d="M2.8 12.4h4l2.1-5.6 3.9 11 2.3-7 1.4 3.2h4.7" />
  </svg>
);

/* ── پول هوشمند ─────────────────────────────────────────────────────────────
   Three linked nodes with one lit: money moving between hands that know
   something. It is the mark of the blade, and it is the only artwork the
   banner keeps — the old isometric data field is gone («نینیمال‌تر»). */
export const GlyphSmartFlow = (p) => (
  <svg {...base} {...p}>
    <path d="M6.4 7.6 12 4.6l5.6 3v6.8L12 17.4l-5.6-3z" />
    <path d="M6.4 7.6 12 10.6l5.6-3M12 10.6v6.8" />
    <circle cx="12" cy="10.6" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

/* ── «مرور» / «توکن» — THE TWO TABS ─────────────────────────────────────────
   Requested: «در صفحه بازار دو تب کن». A tab is a POINT OF VIEW, so the two
   marks are one instrument seen two ways rather than a chart and a coin:

     · overview — a horizon seen from above: a wide frame with a gauge readout
       inside, which is what this tab is (the total, the three boxes, Bitcoin);
     · tokens   — two stacked stones with a spark on the top one, which is what
       THIS tab is (a ranked list of individual assets), not a second chart.

   Same 24×24 box and the same 1.7 stroke as everything above, so the strip
   sits on the same optical line as the boxes it switches between. */
export const GlyphOverview = (p) => (
  <svg {...base} {...p}>
    <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="3.6" />
    <path d="M6.4 15.6h3.1l1.6-3.9 2 5.2 1.7-3.6h2.8" />
    <path d="M6.6 8.2h3.2M6.6 11h1.8" />
  </svg>
);

export const GlyphToken = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="7.2" rx="6.4" ry="2.8" />
    <path d="M5.6 7.2v4.4c0 1.55 2.86 2.8 6.4 2.8s6.4-1.25 6.4-2.8V7.2" />
    <path d="M5.6 11.6v4.4c0 1.55 2.86 2.8 6.4 2.8" />
    <path d="m16.6 15.2.7 1.9 1.9.7-1.9.7-.7 1.9" />
  </svg>
);

/** The `name` to `mark` mapping lib/marketTabs.js refers to by string. */
export const MARKET_PANE_GLYPHS = {
  overview: GlyphOverview,
  tokens: GlyphToken
};

/**
 * A tab glyph by name, with a visible fallback.
 *
 * `undefined` in a JSX position renders as an EMPTY SPOT — silently, with no
 * warning — which is how an icon disappears without anybody noticing. A name
 * that is not in the map therefore draws the neutral frame instead.
 */
export function MarketPaneGlyph({ name, ...rest }) {
  const Glyph = MARKET_PANE_GLYPHS[name] || GlyphDeck;
  return <Glyph {...rest} />;
}

/* ── THE FIVE VIEWS ─────────────────────────────────────────────────────────
   One glyph per filter chip, each drawn from the same 24×24 box so the five
   chips sit on one optical line. */
export const FILTER_GLYPHS = {
  all: GlyphGrid,
  gainers: GlyphTrendUp,
  losers: GlyphTrendDown,
  favorites: (p) => (
    <svg {...base} {...p}>
      <path d="M12 4.2l2.5 5 5.5.8-4 3.9.95 5.5L12 16.8l-4.95 2.6.95-5.5-4-3.9 5.5-.8z" />
    </svg>
  ),
  volume: GlyphVolume
};

/* ── THE PULSE RAIL ──────────────────────────────────────────────────────────
   The edge instrument on the same screen typed its three marks (a diamond and
   two diagonals) and its footnote glyph. Drawn here, from the same 24x24 box
   and the same 1.7 stroke, so the rail and the list speak one visual language. */
/** Volatility risk — a faceted stone: one outline, three internal planes. */
export const GlyphRisk = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.4 20.2 9.4 12 20.6 3.8 9.4 12 3.4Z" />
    <path d="M3.8 9.4h16.4M12 3.4 8.7 9.4 12 20.6M12 3.4l3.3 6-3.3 11.2" />
  </svg>
);

/** Method / footnote — the circle-and-stem a typed information mark fakes badly. */
export const GlyphInfo = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M12 11.1v5.4" />
    <circle cx="12" cy="8" r=".6" fill="currentColor" stroke="none" />
  </svg>
);

/* ── THE SIX SECTORS ────────────────────────────────────────────────────────
   From طلا to سولانا. Distinct silhouettes: an ingot, a mask, a building, a neural
   chip, a controller, and Solana's own three-blade mark (drawn here rather
   than imported, so it strokes at the same weight as its five neighbours). */
export const SECTOR_GLYPHS = {
  gold: (p) => (
    <svg {...base} {...p}>
      <path d="M6.2 9.4h11.6l2.4 6.4a1.6 1.6 0 0 1-1.5 2.2H5.3a1.6 1.6 0 0 1-1.5-2.2z" />
      <path d="M8.4 9.4 9.8 6h4.4l1.4 3.4" />
      <path d="M9.6 14h4.8" />
    </svg>
  ),
  meme: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M8.6 10.2h.01M15.4 10.2h.01" strokeWidth="2.2" />
      <path d="M8.4 14.4a4.4 4.4 0 0 0 7.2 0" />
    </svg>
  ),
  rwa: (p) => (
    <svg {...base} {...p}>
      <path d="M4.4 20.2h15.2" />
      <path d="M6.4 20.2V9.6l5.6-4 5.6 4v10.6" />
      <path d="M10 20.2v-5.4h4v5.4" />
      <path d="M9.8 11.2h1.4M12.8 11.2h1.4" />
    </svg>
  ),
  ai: (p) => (
    <svg {...base} {...p}>
      <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="3" />
      <path d="M10.2 10.6h3.6v2.8h-3.6z" />
      <path d="M9.6 3.4v3.2M14.4 3.4v3.2M9.6 17.4v3.2M14.4 17.4v3.2M3.4 9.6h3.2M3.4 14.4h3.2M17.4 9.6h3.2M17.4 14.4h3.2" />
    </svg>
  ),
  gaming: (p) => (
    <svg {...base} {...p}>
      <path d="M7.6 8.4h8.8a4.4 4.4 0 0 1 4.3 3.5l.7 3.6a2.5 2.5 0 0 1-4.5 2l-1.5-2H8.6l-1.5 2a2.5 2.5 0 0 1-4.5-2l.7-3.6a4.4 4.4 0 0 1 4.3-3.5z" />
      <path d="M7 11.6v2.4M5.8 12.8h2.4M15.8 12h.01M17.8 13.6h.01" strokeWidth="1.9" />
    </svg>
  ),
  solana: (p) => (
    <svg {...base} {...p}>
      <path d="M6.3 4.4h14.2l-2.7 2.9H3.6z" />
      <path d="M3.6 10.6h14.2l2.7 2.9H6.3z" />
      <path d="M6.3 16.8h14.2l-2.7 2.9H3.6z" />
    </svg>
  ),
  monitoring: (p) => (
    <svg {...base} {...p}>
      <path d="M2.8 12s3.2-5.3 9.2-5.3 9.2 5.3 9.2 5.3-3.2 5.3-9.2 5.3S2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.3" /><path d="M18.2 4.2v2.2M18.2 8h.01" />
    </svg>
  ),
  seed: (p) => (
    <svg {...base} {...p}>
      <path d="M12 20v-9M12 14c-4.6 0-6.9-2.2-7.1-6.1 4.1-.2 6.5 1.8 7.1 6.1ZM12 11c.2-4.1 2.6-6.4 7.1-6.7.2 4.2-2 6.5-7.1 6.7Z" />
      <path d="M7.7 20h8.6" />
    </svg>
  ),
  defi: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="3" /><circle cx="5" cy="6" r="1.8" /><circle cx="19" cy="6" r="1.8" /><circle cx="5" cy="18" r="1.8" /><circle cx="19" cy="18" r="1.8" />
      <path d="m6.5 7.2 3.2 3M17.5 7.2l-3.2 3M6.5 16.8l3.2-3M17.5 16.8l-3.2-3" />
    </svg>
  ),
  storage: (p) => (
    <svg {...base} {...p}>
      <ellipse cx="12" cy="6.2" rx="7" ry="2.8" /><path d="M5 6.2v11.6c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V6.2M5 10.2c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9M5 14c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9" />
    </svg>
  ),
  nft: (p) => (
    <svg {...base} {...p}>
      <rect x="3.8" y="3.8" width="16.4" height="16.4" rx="2.8" /><circle cx="15.8" cy="8.2" r="1.5" />
      <path d="m5.8 17 4.2-5 2.7 2.8 1.9-2 3.6 4.2" />
    </svg>
  ),
  fanToken: (p) => (
    <svg {...base} {...p}>
      <path d="M7.2 4.5h9.6v4.8a4.8 4.8 0 0 1-9.6 0V4.5ZM7.2 6H4.7v2.1a3.2 3.2 0 0 0 3 3.2M16.8 6h2.5v2.1a3.2 3.2 0 0 1-3 3.2M12 14.1v4.1M8.8 20h6.4M9.4 18.2h5.2" />
    </svg>
  ),
  megadrop: (p) => (
    <svg {...base} {...p}>
      <path d="M4.3 10.3a7.7 7.7 0 0 1 15.4 0H4.3ZM4.3 10.3l5.2 5.5M19.7 10.3l-5.2 5.5M9.5 10.3l1.4 5.5M14.5 10.3l-1.4 5.5" />
      <path d="M9.3 15.8h5.4v4H9.3z" />
    </svg>
  ),
  launchpool: (p) => (
    <svg {...base} {...p}>
      <path d="M12 3.2s-4 4.2-4 7.5a4 4 0 0 0 8 0c0-3.3-4-7.5-4-7.5ZM3.5 17.1c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 3.5.8M4.5 20c1.3-.9 2.6-.9 4 0s2.6.9 4 0 2.6-.9 4 0 2.6.9 3 0" />
    </svg>
  ),
  infrastructure: (p) => (
    <svg {...base} {...p}>
      <rect x="8.8" y="3.5" width="6.4" height="5.2" rx="1" /><rect x="3.5" y="15.2" width="6.4" height="5.2" rx="1" /><rect x="14.1" y="15.2" width="6.4" height="5.2" rx="1" />
      <path d="M12 8.7v3.1M6.7 15.2v-3.4h10.6v3.4" />
    </svg>
  ),
  bsc: (p) => (
    <svg {...base} {...p}>
      <path d="m12 3.2 3 3-3 3-3-3 3-3ZM5.8 9.4l2.6 2.6-2.6 2.6L3.2 12l2.6-2.6ZM18.2 9.4l2.6 2.6-2.6 2.6-2.6-2.6 2.6-2.6ZM12 14.8l3 3-3 3-3-3 3-3ZM12 10l2 2-2 2-2-2 2-2Z" />
    </svg>
  ),
  payment: (p) => (
    <svg {...base} {...p}>
      <rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2.7" /><path d="M3.4 9.5h17.2M6.7 14.8h4.3M14.8 14.8h1.8" />
    </svg>
  ),
  launchpad: (p) => (
    <svg {...base} {...p}>
      <path d="M9 15c-1.4-3.8 1.1-8.3 6.2-10.3 1.1-.4 2.4-.5 4.1-.5.1 1.7 0 3-.5 4.1-2 5.1-6.5 7.6-10.3 6.2L9 15ZM10 14l-3.7 3.7M8.1 11.4l-3.3.5-1.2 3.2 4.5-.1M12.6 15.9l-.5 3.3-3.2 1.2.1-4.5" />
      <circle cx="15.1" cy="8.8" r="1.6" />
    </svg>
  )
};
