/**
 * SHOP ICONS.
 * ---------------------------------------------------------------------------
 * Asked for: «هر تب تصویر svg داشته باشد».
 *
 * ─── WHY THESE ARE DRAWN HERE AND NOT PULLED FROM A SET ─────────────────────
 * The app already has an icon set in components/Icons.jsx, but it has no card,
 * no plane, no bed and no SIM. Adding an icon font or a library for four
 * glyphs would ship kilobytes for something that is four paths.
 *
 * All of them are 24×24, stroke-based, `currentColor`, and use the same 1.7
 * stroke width as the existing set so they sit correctly beside it. No fills,
 * so they invert cleanly between the light and dark themes without a second
 * copy.
 */

const base = (p) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  width: 20,
  height: 20,
  'aria-hidden': 'true',
  ...p
});

/** Gift card: a card with a magnetic stripe and a small ribbon. */
export const IconCard = (p) => (
  <svg {...base(p)}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.6" />
    <path d="M2.5 9.6h19" />
    <path d="M6.5 14.6h3.4" />
  </svg>
);

/** Top-up: a phone with an upward arrow. */
export const IconTopUp = (p) => (
  <svg {...base(p)}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.4" />
    <path d="M12 15.5v-6" />
    <path d="M9.6 11.9 12 9.5l2.4 2.4" />
  </svg>
);

/** Flights: a paper-plane silhouette that reads at 20px. */
export const IconPlane = (p) => (
  <svg {...base(p)}>
    <path d="M21 4.5 3.8 11.2c-.6.24-.57 1.1.05 1.29l5.2 1.6 1.6 5.2c.19.62 1.05.65 1.29.05L21 4.5Z" />
    <path d="m9.05 14.09 4.3-4.3" />
  </svg>
);

/** Stays: a bed. */
export const IconBed = (p) => (
  <svg {...base(p)}>
    <path d="M3 18v-9" />
    <path d="M3 13.5h18V18" />
    <path d="M21 18v1.6M3 18v1.6" />
    <path d="M6.6 10.4h4a2 2 0 0 1 2 2v1.1H6.6z" />
    <path d="M15 13.5V11a1.5 1.5 0 0 1 1.5-1.5H19A2 2 0 0 1 21 11.5v2" />
  </svg>
);

/** eSIM: a SIM outline with a chip. */
export const IconSim = (p) => (
  <svg {...base(p)}>
    <path d="M5.5 3.5h8.2L18.5 8v12.5h-13z" />
    <rect x="9" y="12" width="6" height="5" rx="1.2" />
  </svg>
);

/** Money / e-money: a banknote. */
export const IconMoney = (p) => (
  <svg {...base(p)}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.4" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M6 12h.01M18 12h.01" />
  </svg>
);
