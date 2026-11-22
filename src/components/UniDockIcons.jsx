/**
 * THE FOUR GLYPHS — Farm · Loan · Insurance · Auto Orders.
 * ---------------------------------------------------------------------------
 * «ایکون هاش مدرن و خاص باشد» — not four generic outline strokes.
 *
 * Each glyph is DUOTONE: one soft filled mass (the thing the section is
 * about) plus one crisp stroke detail on top (what you do with it). That is
 * the current icon language of the wallets this bar is modelled on, and it
 * also solves a practical problem: at 21px inside a glass pill, four
 * same-weight outlines read as four identical grey blobs, while a fill plus
 * a stroke keeps its silhouette at any size and any theme.
 *
 *    Farm      a leaf over soil, with the stem cut through it
 *    Loan      two stacked coins and an arrow leaving them
 *    Insurance a shield whose core is filled, tick drawn inside
 *    Orders    a ring with a filled hub and a repeat arrow
 *
 * Colour is always `currentColor`, so the bar's active/inactive ink drives
 * all four — no per-icon palette to keep in sync with the theme.
 */
const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

/** FARM — a leaf standing in soil. The soil line is the section's floor. */
export function UniFarmIcon({ ...p }) {
  return (
    <svg {...BASE} {...p}>
      <path
        d="M12 12.6c0-4.1 2.7-6.6 6.6-6.6 0 4.1-2.7 6.6-6.6 6.6z"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="none"
      />
      <path d="M12 12.6c0-4.1 2.7-6.6 6.6-6.6 0 4.1-2.7 6.6-6.6 6.6z" />
      <path d="M11.6 13C11.6 8.9 8.9 6.4 5 6.4c0 4.1 2.7 6.6 6.6 6.6z" opacity="0.55" />
      <path d="M12 12.2v6.1" />
      <path d="M5.6 20.4c1.7-1.4 3.9-2.1 6.4-2.1s4.7.7 6.4 2.1" />
    </svg>
  );
}

/** LOAN — a coin stack with an arrow leaving: borrowing, not saving. */
export function UniLoanIcon({ ...p }) {
  return (
    <svg {...BASE} {...p}>
      <ellipse cx="8.4" cy="7.4" rx="4.6" ry="2.3" fill="currentColor" fillOpacity="0.22" stroke="none" />
      <ellipse cx="8.4" cy="7.4" rx="4.6" ry="2.3" />
      <path d="M3.8 7.4v4.1c0 1.3 2.1 2.3 4.6 2.3 1.1 0 2.1-.2 2.9-.5" />
      <path d="M3.8 11.5v4.1c0 1.3 2.1 2.3 4.6 2.3 1.1 0 2.1-.2 2.9-.5" opacity="0.6" />
      <path d="M14.8 19.6 20 14.4" />
      <path d="M20 18.3v-3.9h-3.9" />
    </svg>
  );
}

/** INSURANCE — a shield with a filled core and the tick inside it. */
export function UniShieldIcon({ ...p }) {
  return (
    <svg {...BASE} {...p}>
      <path
        d="M12 4.4 6 6.8v5c0 3.6 2.4 6.7 6 8.2 3.6-1.5 6-4.6 6-8.2v-5L12 4.4z"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="none"
      />
      <path d="M12 4.4 6 6.8v5c0 3.6 2.4 6.7 6 8.2 3.6-1.5 6-4.6 6-8.2v-5L12 4.4z" />
      <path d="m9.4 11.8 1.9 1.9 3.5-3.7" strokeWidth="1.9" />
    </svg>
  );
}

/** AUTO ORDERS — a repeating ring with a filled hub: an order that runs itself. */
export function UniOrdersIcon({ ...p }) {
  return (
    <svg {...BASE} {...p}>
      <circle cx="12" cy="12.4" r="2.5" fill="currentColor" fillOpacity="0.28" stroke="none" />
      <path d="M19.7 12.4a7.7 7.7 0 1 1-2.3-5.5" />
      <path d="M19.9 3.8v4.2h-4.2" />
      <circle cx="12" cy="12.4" r="2.5" />
      <path d="M12 11.2v1.4l1 .7" opacity="0.75" strokeWidth="1.3" />
    </svg>
  );
}
