/**
 * INSURANCE MODULE ICONS
 * ---------------------------------------------------------------------------
 * Drawn on the same 24×24 grid and with the same conventions as
 * `components/SettingsIcons.jsx` (stroke 1.7, round caps/joins, a filled
 * `currentColor` underlay at low opacity under the stroke) so the insurance
 * screens read as the same family as the redesigned Settings hub.
 *
 * Everything inherits `currentColor`; the per-section tone is set by CSS on
 * the wrapper (`.ins-tone-*` in insurance.css). No emoji, no icon font, no
 * theme knowledge here — dark and light are both correct because the fill is
 * the same colour as the stroke.
 */

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
};

/** The duotone underlay: same geometry, filled, no stroke. */
const tone = (o = 0.18) => ({ fill: 'currentColor', fillOpacity: o, stroke: 'none' });

const SHIELD = 'M12 3.05 5.25 5.55v5.25c0 4.35 2.9 7.25 6.75 9.4 3.85-2.15 6.75-5.05 6.75-9.4V5.55Z';

/* ── shield: the module mark (brand, coverage rows, transparency box) ────── */
export const InsIconShield = (p) => (
  <svg {...base} {...p}>
    <path d={SHIELD} {...tone(0.2)} />
    <path d={SHIELD} />
    <path d="m9.1 12.1 2 2 3.9-4.3" strokeWidth="1.9" />
  </svg>
);

/* ── dashboard: a 2×2 layout, the first cell lit ───────────────────────── */
export const InsIconDashboard = (p) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="3.5" width="7.4" height="7.4" rx="2.2" {...tone(0.55)} />
    <rect x="3.5" y="3.5" width="7.4" height="7.4" rx="2.2" />
    <rect x="13.1" y="3.5" width="7.4" height="7.4" rx="2.2" />
    <rect x="3.5" y="13.1" width="7.4" height="7.4" rx="2.2" />
    <rect x="13.1" y="13.1" width="7.4" height="7.4" rx="2.2" {...tone(0.14)} />
    <rect x="13.1" y="13.1" width="7.4" height="7.4" rx="2.2" />
  </svg>
);

/* ── marketplace: a storefront with an awning ──────────────────────────── */
export const InsIconMarket = (p) => (
  <svg {...base} {...p}>
    <path d="M4.2 9.6 5.6 4.8h12.8l1.4 4.8" {...tone(0.14)} />
    <path d="M4 9.6c0 1.5 1.2 2.6 2.7 2.6s2.6-1.1 2.6-2.6c0 1.5 1.2 2.6 2.7 2.6s2.7-1.1 2.7-2.6c0 1.5 1.1 2.6 2.6 2.6S20 11.1 20 9.6" />
    <path d="M4.2 9.6 5.6 4.8h12.8l1.4 4.8" />
    <path d="M5.6 12.6v6.6h12.8v-6.6" />
    <rect x="9.6" y="14.4" width="4.8" height="4.8" rx="1.2" {...tone(0.4)} />
    <rect x="9.6" y="14.4" width="4.8" height="4.8" rx="1.2" />
  </svg>
);

/* ── coverage: a shield with a folded certificate corner ───────────────── */
export const InsIconCoverage = (p) => (
  <svg {...base} {...p}>
    <path d={SHIELD} {...tone(0.14)} />
    <path d={SHIELD} />
    <path d="M9 9.8h6M9 12.6h6M9 15.4h3.6" />
    <circle cx="17.6" cy="6.4" r="1.7" fill="currentColor" fillOpacity="0.85" stroke="none" />
  </svg>
);

/* ── claims: a document with a ticked line ─────────────────────────────── */
export const InsIconClaims = (p) => (
  <svg {...base} {...p}>
    <path d="M6.4 3.6h8l4.2 4.2v12.6H6.4Z" {...tone(0.14)} />
    <path d="M6.4 3.6h8l4.2 4.2v12.6H6.4Z" />
    <path d="M14.4 3.6v4.2h4.2" />
    <path d="M9.2 12.4h5.6M9.2 15.6h3.4" />
    <circle cx="16.4" cy="16.6" r="2.6" {...tone(0.5)} />
    <circle cx="16.4" cy="16.6" r="2.6" />
    <path d="m15.3 16.7.8.8 1.5-1.7" strokeWidth="1.5" />
  </svg>
);

/* ── risk: a gauge with the needle in the amber third ──────────────────── */
export const InsIconRisk = (p) => (
  <svg {...base} {...p}>
    <path d="M4 15.6a8 8 0 0 1 16 0" {...tone(0.14)} />
    <path d="M4 15.6a8 8 0 0 1 16 0" />
    <path d="M4 15.6h2.2M17.8 15.6H20M7.3 9.8l1.6 1.5M16.7 9.8l-1.6 1.5M12 7.6v2.2" />
    <path d="M12 16.4 15.6 11" strokeWidth="1.9" />
    <circle cx="12" cy="16.4" r="1.7" fill="currentColor" fillOpacity="0.9" stroke="none" />
    <path d="M6.2 19.6h11.6" />
  </svg>
);

/* ── providers: three linked nodes — the underwriters ──────────────────── */
export const InsIconProviders = (p) => (
  <svg {...base} {...p}>
    <path d="M6.2 15.2 12 6.4l5.8 8.8Z" {...tone(0.12)} />
    <path d="M6.2 15.2 12 6.4l5.8 8.8Z" />
    <circle cx="12" cy="6.4" r="2.5" {...tone(0.4)} />
    <circle cx="6.2" cy="15.6" r="2.5" {...tone(0.4)} />
    <circle cx="17.8" cy="15.6" r="2.5" {...tone(0.4)} />
    <circle cx="12" cy="6.4" r="2.5" />
    <circle cx="6.2" cy="15.6" r="2.5" />
    <circle cx="17.8" cy="15.6" r="2.5" />
  </svg>
);

/* ── wallet: card with a coin window ───────────────────────────────────── */
export const InsIconWallet = (p) => (
  <svg {...base} {...p}>
    <rect x="3.2" y="6.2" width="17.6" height="13" rx="3.2" {...tone(0.14)} />
    <rect x="3.2" y="6.2" width="17.6" height="13" rx="3.2" />
    <path d="M3.2 9.8h17.6" />
    <path d="M6.6 6.2V5.4A1.6 1.6 0 0 1 8.2 3.8h8" />
    <rect x="14.2" y="12.4" width="6.6" height="4.2" rx="1.6" {...tone(0.5)} />
    <rect x="14.2" y="12.4" width="6.6" height="4.2" rx="1.6" />
    <circle cx="17.1" cy="14.5" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

/* ── chain: two links ──────────────────────────────────────────────────── */
export const InsIconChain = (p) => (
  <svg {...base} {...p}>
    <path d="M10 14.2 14.2 10" strokeWidth="1.9" />
    <path d="M8.4 11.4 5.9 13.9a3.5 3.5 0 0 0 4.9 4.9l2.5-2.5" {...tone(0.16)} />
    <path d="M8.4 11.4 5.9 13.9a3.5 3.5 0 0 0 4.9 4.9l2.5-2.5" />
    <path d="M15.6 12.6l2.5-2.5a3.5 3.5 0 0 0-4.9-4.9l-2.5 2.5" {...tone(0.16)} />
    <path d="M15.6 12.6l2.5-2.5a3.5 3.5 0 0 0-4.9-4.9l-2.5 2.5" />
  </svg>
);

/* ── fee: a receipt with an itemised total ─────────────────────────────── */
export const InsIconFee = (p) => (
  <svg {...base} {...p}>
    <path d="M6.2 3.6h11.6v16.8l-2.3-1.5-2.3 1.5-1.2-.8-1.2.8-2.3-1.5-2.3 1.5Z" {...tone(0.14)} />
    <path d="M6.2 3.6h11.6v16.8l-2.3-1.5-2.3 1.5-1.2-.8-1.2.8-2.3-1.5-2.3 1.5Z" />
    <path d="M9 8.2h6M9 11.4h6M9 14.6h3.2" />
    <circle cx="14.8" cy="14.6" r="1.1" fill="currentColor" fillOpacity="0.85" stroke="none" />
  </svg>
);

/* ── claim (single): document with a magnifier ─────────────────────────── */
export const InsIconClaim = (p) => (
  <svg {...base} {...p}>
    <path d="M6 3.6h8.2l4 4v12.8H6Z" {...tone(0.12)} />
    <path d="M6 3.6h8.2l4 4v12.8H6Z" />
    <path d="M14.2 3.6v4h4" />
    <circle cx="11.2" cy="13" r="2.7" {...tone(0.45)} />
    <circle cx="11.2" cy="13" r="2.7" />
    <path d="m13.2 15 2.2 2.2" strokeWidth="1.9" />
  </svg>
);

/* ── protocol / product: a hexagon cell with a cube core ───────────────── */
export const InsIconProtocol = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.4 19.2 7.6v8.8L12 20.6l-7.2-4.2V7.6Z" {...tone(0.12)} />
    <path d="M12 3.4 19.2 7.6v8.8L12 20.6l-7.2-4.2V7.6Z" />
    <path d="M12 8.2 15.6 10.3v4L12 16.4l-3.6-2.1v-4Z" {...tone(0.5)} />
    <path d="M12 8.2 15.6 10.3v4L12 16.4l-3.6-2.1v-4Z" />
    <path d="M12 12.3v4.1M8.4 10.3l3.6 2 3.6-2" />
  </svg>
);

/* ── calendar: duration ────────────────────────────────────────────────── */
export const InsIconCalendar = (p) => (
  <svg {...base} {...p}>
    <rect x="3.6" y="5" width="16.8" height="15.4" rx="3" {...tone(0.12)} />
    <rect x="3.6" y="5" width="16.8" height="15.4" rx="3" />
    <path d="M3.6 9.6h16.8M8 3.2v3.4M16 3.2v3.4" />
    <rect x="7" y="12.4" width="4" height="3.4" rx="1" fill="currentColor" fillOpacity="0.7" stroke="none" />
    <path d="M13.4 12.4h3.6M13.4 15.4h3.6" />
  </svg>
);

/* ── amount: a coin stack with a dollar mark ───────────────────────────── */
export const InsIconAmount = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="6.4" rx="7" ry="2.8" {...tone(0.35)} />
    <path d="M5 6.4v10.8c0 1.55 3.15 2.8 7 2.8s7-1.25 7-2.8V6.4" {...tone(0.1)} />
    <ellipse cx="12" cy="6.4" rx="7" ry="2.8" />
    <path d="M5 6.4v10.8c0 1.55 3.15 2.8 7 2.8s7-1.25 7-2.8V6.4" />
    <path d="M5 11.8c0 1.55 3.15 2.8 7 2.8s7-1.25 7-2.8" />
  </svg>
);

/* ── search / retry / chevrons / misc controls ─────────────────────────── */
export const InsIconSearch = (p) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="6.2" {...tone(0.12)} />
    <circle cx="11" cy="11" r="6.2" />
    <path d="m19.6 19.6-3.6-3.6" strokeWidth="1.9" />
  </svg>
);

export const InsIconRetry = (p) => (
  <svg {...base} {...p}>
    <path d="M20 12a8 8 0 1 1-2.35-5.65" />
    <path d="M20 4v5h-5" />
  </svg>
);

export const InsIconChevronDown = (p) => (
  <svg {...base} {...p}>
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" strokeWidth="2" />
  </svg>
);

/** Points toward the inline end; mirrored in RTL by CSS. */
export const InsIconChevronEnd = ({ className = '', ...p }) => (
  <svg {...base} className={`ins-chev-end ${className}`.trim()} {...p}>
    <path d="m9.5 6.5 5.5 5.5-5.5 5.5" strokeWidth="2" />
  </svg>
);

export const InsIconExternal = (p) => (
  <svg {...base} {...p}>
    <path d="M13.5 5.5H6.8A2.3 2.3 0 0 0 4.5 7.8v9.4a2.3 2.3 0 0 0 2.3 2.3h9.4a2.3 2.3 0 0 0 2.3-2.3v-6.7" />
    <path d="M14.2 4.5h5.3v5.3M19.2 4.8l-8 8" />
  </svg>
);

export const InsIconBell = (p) => (
  <svg {...base} {...p}>
    <path d="M6.6 10.2a5.4 5.4 0 0 1 10.8 0c0 3.5 1.5 4.8 1.55 5.5H5.05c.05-.7 1.55-2 1.55-5.5Z" {...tone(0.2)} />
    <path d="M6.6 10.2a5.4 5.4 0 0 1 10.8 0c0 3.5 1.5 4.8 1.55 5.5H5.05c.05-.7 1.55-2 1.55-5.5Z" />
    <path d="M12 2.9v2M10 18.2a2 2 0 0 0 4 0" />
  </svg>
);

export const InsIconInfo = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.4" {...tone(0.12)} />
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 11v5.2" strokeWidth="1.9" />
    <circle cx="12" cy="7.9" r="1.05" fill="currentColor" stroke="none" />
  </svg>
);

export const InsIconCheck = (p) => (
  <svg {...base} {...p}>
    <path d="m5 12.5 4.3 4.3L19 7.3" strokeWidth="2.2" />
  </svg>
);

export const InsIconAlert = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.6 2.9 19.4h18.2Z" {...tone(0.14)} />
    <path d="M12 3.6 2.9 19.4h18.2Z" />
    <path d="M12 9.6v4.6" strokeWidth="1.9" />
    <circle cx="12" cy="16.9" r="1.05" fill="currentColor" stroke="none" />
  </svg>
);

export const InsIconEmpty = (p) => (
  <svg {...base} {...p}>
    <path d="M3.8 8.4 12 4l8.2 4.4v7.2L12 20l-8.2-4.4Z" {...tone(0.1)} />
    <path d="M3.8 8.4 12 4l8.2 4.4v7.2L12 20l-8.2-4.4Z" />
    <path d="M3.8 8.4 12 12.8l8.2-4.4M12 12.8V20" />
    <path d="M8.6 15.6h6.8" strokeDasharray="1.6 2.2" />
  </svg>
);

export const InsIconHourglass = (p) => (
  <svg {...base} {...p}>
    <path d="M7 3.8h10v3.4L13.4 12 17 16.8v3.4H7v-3.4L10.6 12 7 7.2Z" {...tone(0.12)} />
    <path d="M7 3.8h10v3.4L13.4 12 17 16.8v3.4H7v-3.4L10.6 12 7 7.2Z" />
    <path d="M9.4 18.4h5.2l-2.6-3.2Z" fill="currentColor" fillOpacity="0.7" stroke="none" />
  </svg>
);

export const InsIconPause = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.4" {...tone(0.1)} />
    <circle cx="12" cy="12" r="8.4" />
    <path d="M9.8 8.8v6.4M14.2 8.8v6.4" strokeWidth="2.1" />
  </svg>
);

export const InsIconFlask = (p) => (
  <svg {...base} {...p}>
    <path d="M9.6 3.8h4.8M10.4 3.8v5.4L5.6 17.6a1.8 1.8 0 0 0 1.55 2.7h9.7a1.8 1.8 0 0 0 1.55-2.7L13.6 9.2V3.8" />
    <path d="M7.4 15.2h9.2l1.4 2.4a1 1 0 0 1-.9 1.5H6.9a1 1 0 0 1-.9-1.5Z" fill="currentColor" fillOpacity="0.45" stroke="none" />
  </svg>
);

export const InsIconLive = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.4" {...tone(0.1)} />
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="3.2" fill="currentColor" fillOpacity="0.9" stroke="none" />
    <path d="M5.6 12h2.2M16.2 12h2.2" />
  </svg>
);

export const InsIconLock = (p) => (
  <svg {...base} {...p}>
    <rect x="5" y="10.4" width="14" height="10" rx="3" {...tone(0.14)} />
    <rect x="5" y="10.4" width="14" height="10" rx="3" />
    <path d="M8 10.4V7.9a4 4 0 0 1 8 0v2.5" />
    <circle cx="12" cy="15.3" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

/* ── protection-type glyphs (one per `insurance.types.*`) ──────────────── */
export const InsTypeContract = (p) => (
  <svg {...base} {...p}>
    <path d="M6 3.6h8.2l4 4v12.8H6Z" {...tone(0.12)} />
    <path d="M6 3.6h8.2l4 4v12.8H6Z" />
    <path d="M14.2 3.6v4h4" />
    <path d="m10.2 11.6-1.9 2 1.9 2M13.8 11.6l1.9 2-1.9 2" strokeWidth="1.6" />
  </svg>
);

export const InsTypeBridge = (p) => (
  <svg {...base} {...p}>
    <path d="M3.6 17V9.8c2.7 0 4.6-2.6 8.4-2.6s5.7 2.6 8.4 2.6V17" {...tone(0.12)} />
    <path d="M3.6 17V9.8c2.7 0 4.6-2.6 8.4-2.6s5.7 2.6 8.4 2.6V17" />
    <path d="M3 17h18M7.6 17V9.1M12 17V7.3M16.4 17V9.1" />
  </svg>
);

export const InsTypeStable = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.4" {...tone(0.12)} />
    <circle cx="12" cy="12" r="8.4" />
    <path d="M14.6 9.4c-.4-.9-1.4-1.4-2.6-1.4-1.6 0-2.8.8-2.8 2 0 2.6 5.6 1.3 5.6 4 0 1.3-1.3 2.1-3 2.1-1.3 0-2.4-.5-2.9-1.4" />
    <path d="M12 6.4v1.6M12 16.1v1.6" />
  </svg>
);

export const InsTypeLending = (p) => (
  <svg {...base} {...p}>
    <path d="m3.8 9 8.2-4.6L20.2 9Z" {...tone(0.2)} />
    <path d="m3.8 9 8.2-4.6L20.2 9Z" />
    <path d="M6.2 9v7M10.1 9v7M13.9 9v7M17.8 9v7" />
    <path d="M4.4 19.2h15.2" strokeWidth="1.9" />
    <path d="M4.4 16.4h15.2" />
  </svg>
);

export const InsTypeLP = (p) => (
  <svg {...base} {...p}>
    <path d="M9 4.4c2.6 3.2 4.4 5.6 4.4 8.1A4.4 4.4 0 0 1 4.6 12.5c0-2.5 1.8-4.9 4.4-8.1Z" {...tone(0.3)} />
    <path d="M9 4.4c2.6 3.2 4.4 5.6 4.4 8.1A4.4 4.4 0 0 1 4.6 12.5c0-2.5 1.8-4.9 4.4-8.1Z" />
    <path d="M16.6 11.2c1.7 2.1 2.8 3.6 2.8 5.2a2.8 2.8 0 0 1-5.6 0c0-1.6 1.1-3.1 2.8-5.2Z" {...tone(0.5)} />
    <path d="M16.6 11.2c1.7 2.1 2.8 3.6 2.8 5.2a2.8 2.8 0 0 1-5.6 0c0-1.6 1.1-3.1 2.8-5.2Z" />
  </svg>
);

export const InsTypeOracle = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.4" {...tone(0.08)} />
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 3.6A8.4 8.4 0 0 1 20.4 12" strokeWidth="2.1" />
    <circle cx="12" cy="12" r="4.4" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <path d="m12 12 4.4-2.6" />
  </svg>
);

export const InsTypeDefi = (p) => (
  <svg {...base} {...p}>
    <path d="M8.6 4.6 12 6.6v3.9l-3.4 2-3.4-2V6.6Z" {...tone(0.4)} />
    <path d="M15.4 4.6l3.4 2v3.9l-3.4 2-3.4-2V6.6Z" {...tone(0.15)} />
    <path d="M12 11.6l3.4 2v3.9l-3.4 2-3.4-2v-3.9Z" {...tone(0.15)} />
    <path d="M8.6 4.6 12 6.6v3.9l-3.4 2-3.4-2V6.6Z" />
    <path d="M15.4 4.6l3.4 2v3.9l-3.4 2-3.4-2V6.6Z" />
    <path d="M12 11.6l3.4 2v3.9l-3.4 2-3.4-2v-3.9Z" />
  </svg>
);

/** protection-type id → glyph (falls back to the shield). */
export const INS_TYPE_ICONS = {
  'smart-contract': InsTypeContract,
  bridge: InsTypeBridge,
  stablecoin: InsTypeStable,
  lending: InsTypeLending,
  lp: InsTypeLP,
  wallet: InsIconWallet,
  oracle: InsTypeOracle,
  'defi-protocol': InsTypeDefi
};

/** protection-type id → tone (per-type colour, both themes via CSS). */
export const INS_TYPE_TONES = {
  'smart-contract': 'cyan',
  bridge: 'violet',
  stablecoin: 'mint',
  lending: 'amber',
  lp: 'cyan',
  wallet: 'magenta',
  oracle: 'violet',
  'defi-protocol': 'mint'
};

/** tab route key → glyph + tone. */
export const INS_TAB_ICONS = {
  dashboard: { Icon: InsIconDashboard, tone: 'cyan' },
  marketplace: { Icon: InsIconMarket, tone: 'violet' },
  coverage: { Icon: InsIconCoverage, tone: 'mint' },
  claims: { Icon: InsIconClaims, tone: 'magenta' },
  risk: { Icon: InsIconRisk, tone: 'amber' },
  providers: { Icon: InsIconProviders, tone: 'violet' }
};

export function typeIconFor(typeId) {
  return INS_TYPE_ICONS[typeId] || InsIconShield;
}
