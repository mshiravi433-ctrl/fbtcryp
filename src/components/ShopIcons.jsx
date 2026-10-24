/**
 * SHOP ICONS.
 * ---------------------------------------------------------------------------
 * All icons are 24×24, stroke-based, `currentColor`, and use the same 1.7
 * stroke width as the app's icon set so they invert cleanly between dark and
 * light themes without extra copies.
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

/** Share: three nodes joined by two spokes. */
export const IconShare = (p) => (
  <svg {...base(p)}>
    <circle cx="18" cy="5.2" r="2.7" />
    <circle cx="6" cy="12" r="2.7" />
    <circle cx="18" cy="18.8" r="2.7" />
    <path d="m8.4 10.8 7.2-4.2M8.4 13.2l7.2 4.2" />
  </svg>
);

/** FBT Pay: merchant QR & crypto payment link terminal glyph. */
export const IconPay = (p) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1.6" />
    <rect x="14" y="3" width="7" height="7" rx="1.6" />
    <rect x="3" y="14" width="7" height="7" rx="1.6" />
    <path d="M14 14h3v3h-3z" />
    <path d="M18 18h3v3h-3z" />
    <path d="M18 14h3" />
    <path d="M14 19.5h2" />
  </svg>
);

/** Favorite / Pin star (`filled` uses `currentColor` so theme inversion holds). */
export const IconStar = ({ filled, ...p } = {}) => (
  <svg {...base(p)} fill={filled ? 'currentColor' : 'none'}>
    <polygon points="12 2.8 14.9 8.7 21.4 9.6 16.7 14.2 17.8 20.7 12 17.6 6.2 20.7 7.3 14.2 2.6 9.6 9.1 8.7 12 2.8" />
  </svg>
);

/** AI & Assistants use-case glyph. */
export const IconSpark = (p) => (
  <svg {...base(p)}>
    <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2L12 3Z" />
    <path d="M19 3v3" />
    <path d="M17.5 4.5h3" />
  </svg>
);

/** Trading & Cloud tools use-case glyph. */
export const IconChart = (p) => (
  <svg {...base(p)}>
    <rect x="2.5" y="4" width="19" height="16" rx="2.6" />
    <path d="m6.5 14.5 3.4-3.4 2.6 2.4 4.8-5" />
    <path d="M14.3 8.5h3v3" />
  </svg>
);

/** Gaming & Console use-case glyph. */
export const IconGamepad = (p) => (
  <svg {...base(p)}>
    <rect x="2.5" y="6.5" width="19" height="11" rx="4.5" />
    <path d="M7.5 12h3" />
    <path d="M9 10.5v3" />
    <circle cx="15.2" cy="11" r="0.7" />
    <circle cx="17.2" cy="13" r="0.7" />
  </svg>
);

/** App Store & Google Play use-case glyph. */
export const IconStore = (p) => (
  <svg {...base(p)}>
    <path d="M5 7.5h14l-1.1 12a2 2 0 0 1-2 1.8H8.1a2 2 0 0 1-2-1.8L5 7.5Z" />
    <path d="M8.5 7.5V6a3.5 3.5 0 0 1 7 0v1.5" />
    <polygon points="10.6 11.4 14.6 13.7 10.6 16 10.6 11.4" />
  </svg>
);

/** Streaming & Music use-case glyph. */
export const IconPlay = (p) => (
  <svg {...base(p)}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.8" />
    <polygon points="10 9 15.8 12 10 15 10 9" />
  </svg>
);

/** Internal Swap CTA glyph. */
export const IconSwap = (p) => (
  <svg {...base(p)}>
    <path d="M4 8.5h15l-3.2-3.2" />
    <path d="M20 15.5H5l3.2 3.2" />
  </svg>
);

/** Global Region & Travel eSIM glyph. */
export const IconGlobe = (p) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18" />
    <path d="M12 3a14 14 0 0 0 0 18" />
  </svg>
);

/** Bolt: instant delivery — the hero trust row's first mark. */
export const IconBolt = (p) => (
  <svg {...base(p)}>
    <path d="M13.4 2.6 4.9 13.3a.5.5 0 0 0 .39.82h5.06l-.75 7.28a.5.5 0 0 0 .88.4l8.5-10.7a.5.5 0 0 0-.39-.82h-5.06l.75-7.28a.5.5 0 0 0-.88-.4Z" />
  </svg>
);

/** Mail: delivery by email in the hero trust row. */
export const IconMail = (p) => (
  <svg {...base(p)}>
    <rect x="2.8" y="4.8" width="18.4" height="14.4" rx="3" />
    <path d="m3.6 7.2 7.5 5.3a1.6 1.6 0 0 0 1.8 0l7.5-5.3" />
  </svg>
);

/** Shield with a tick: non-custodial security, the trust-hub mark. */
export const IconShieldCheck = (p) => (
  <svg {...base(p)}>
    <path d="M12 2.9 4.8 5.6v6.1c0 4.3 2.9 7.6 7.2 9.4 4.3-1.8 7.2-5.1 7.2-9.4V5.6L12 2.9Z" />
    <path d="m8.8 11.8 2.3 2.3 4.1-4.6" />
  </svg>
);

/** Chevron: the open/close affordance on the collapsible trust hub. */
export const IconChevronDown = (p) => (
  <svg {...base(p)}>
    <path d="m5.6 9 6.4 6.4L18.4 9" />
  </svg>
);

/** Arrow leaving a box: the outbound CTA mark on cross-sell cards. */
export const IconArrowUpRight = (p) => (
  <svg {...base(p)}>
    <path d="M7.2 16.8 16.8 7.2" />
    <path d="M9.4 7.2h7.4v7.4" />
  </svg>
);

/** Flame: the regional "hottest right now" rail badge. */
export const IconFlame = (p) => (
  <svg {...base(p)}>
    <path d="M12 3.2c3.1 3.1 5.6 5.4 5.6 9a5.6 5.6 0 0 1-11.2 0c0-1.6.7-2.9 1.7-4.2.6 1 1.4 1.6 2.3 1.8-.3-2.2.2-4.4 1.6-6.6Z" />
  </svg>
);

/** History / recently viewed: a clock with a counter-clockwise arrow. */
export const IconRecent = (p) => (
  <svg {...base(p)}>
    <path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" />
    <path d="M3.4 3.6v3.6h3.6" />
    <path d="M12 7.6V12l3 1.8" />
  </svg>
);
