/**
 * Line-art SVG icon set.
 *
 * Replaces the emoji nav — emoji render differently on every OS, can't be
 * recoloured, and look dated. These inherit `currentColor` and stroke width,
 * so the active-tab gradient and theme switching work automatically.
 */

const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

export const IconMarket = (p) => (
  <svg {...base} {...p}>
    <path d="M3 17.5 9 11l4 4 7.5-8" />
    <path d="M21 3h-4M21 3v4" />
    <path d="M3 21h18" />
  </svg>
);

export const IconSwap = (p) => (
  <svg {...base} {...p}>
    <path d="M7 4v14M7 18l-3.2-3.2M7 18l3.2-3.2" />
    <path d="M17 20V6M17 6l-3.2 3.2M17 6l3.2 3.2" />
  </svg>
);

export const IconPools = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
    <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
  </svg>
);

export const IconWallet = (p) => (
  <svg {...base} {...p}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
    <rect x="3" y="7.5" width="18" height="12" rx="2.5" />
    <circle cx="16.5" cy="13.5" r="1.4" />
  </svg>
);

export const IconSettings = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const IconActivity = (p) => (
  <svg {...base} {...p}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

export const IconShield = (p) => (
  <svg {...base} {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const IconFingerprint = (p) => (
  <svg {...base} {...p}>
    <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
    <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
    <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
    <path d="M2 12a10 10 0 0 1 18-6" />
    <path d="M2 16h.01" />
    <path d="M21.8 16c.2-2 .131-5.354 0-6" />
    <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
    <path d="M8.65 22c.21-.66.45-1.32.57-2" />
    <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
  </svg>
);

export const IconMoon = (p) => (
  <svg {...base} {...p}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export const IconSun = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

export const IconUser = (p) => (
  <svg {...base} {...p}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const IconInfo = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

export const IconMail = (p) => (
  <svg {...base} {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

export const IconInstagram = (p) => (
  <svg {...base} {...p}>
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17.5 6.5h.01" />
  </svg>
);

export const IconMapPin = (p) => (
  <svg {...base} {...p}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

export const IconChevronRight = (p) => (
  <svg {...base} {...p}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const IconChevronLeft = (p) => (
  <svg {...base} {...p}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export const IconArrowDown = (p) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);

export const IconCheck = (p) => (
  <svg {...base} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconX = (p) => (
  <svg {...base} {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const IconCopy = (p) => (
  <svg {...base} {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const IconSparkle = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
    <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
  </svg>
);

export const IconClock = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 1.9" />
  </svg>
);

export const IconQr = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM19 14h2M14 19h3M19 19h2" />
  </svg>
);

export const IconExternal = (p) => (
  <svg {...base} {...p}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6M10 14 21 3" />
  </svg>
);

export const IconRefresh = (p) => (
  <svg {...base} {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

export const IconLock = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const IconLink = (p) => (
  <svg {...base} {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export const IconPlus = (p) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconTrend = (p) => (
  <svg {...base} {...p}>
    <path d="m2 12 4-4 4 4 6-6 6 6" />
    <path d="M22 12v6H2v-6" opacity=".35" />
  </svg>
);

export const IconGlobe = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

export const IconBuilding = (p) => (
  <svg {...base} {...p}>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
  </svg>
);

export const IconKey = (p) => (
  <svg {...base} {...p}>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m21 2-9.6 9.6M15.5 7.5l3 3" />
  </svg>
);

export const IconTelegram = (p) => (
  <svg {...base} {...p}>
    <path d="M21.8 4.2 2.9 11.5c-1 .4-1 1.8.05 2.1l4.6 1.4 1.8 5.5c.3.9 1.4 1.1 2 .4l2.5-2.7 4.5 3.3c.8.6 1.9.1 2.1-.8l3-14.5c.2-1-.8-1.8-1.65-1.5z" />
    <path d="m7.55 15 10.6-7.4-8.2 8.6" />
  </svg>
);

export const IconDoc = (p) => (
  <svg {...base} {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M8 13h8M8 17h5" />
  </svg>
);

/*
 * The X (formerly Twitter) logo.
 *
 * NOT IconX — that is a close/dismiss cross used on sheets. Reusing it here
 * would have put a "close" glyph on a social link, which reads as a broken
 * button rather than a brand.
 *
 * Filled rather than stroked: the mark is a solid glyph, and stroking it at
 * 18px produces a muddy asterisk.
 */
export const IconXLogo = (p) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...p}>
    <path d="M17.53 3h3.1l-6.77 7.74L21.83 21h-6.24l-4.89-6.39L5.1 21H2l7.24-8.28L2.17 3h6.4l4.42 5.84L17.53 3zm-1.09 16.14h1.72L7.64 4.77H5.8l10.64 14.37z" />
  </svg>
);

export const IconLinkedin = (p) => (
  <svg {...base} {...p}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

export const IconBriefcase = (p) => (
  <svg {...base} {...p}>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16M2 13h20" />
  </svg>
);

export const IconTrophy = (p) => (
  <svg {...base} {...p}>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M6 3h12v6a6 6 0 0 1-12 0V3zM9 21h6M12 15v6" />
  </svg>
);

export const IconNews = (p) => (
  <svg {...base} {...p}>
    <path d="M4 5h11a1 1 0 0 1 1 1v13H5a1 1 0 0 1-1-1V5z" />
    <path d="M16 9h3a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2h-2" />
    <path d="M7 8h5M7 11.5h5M7 15h3" />
  </svg>
);

export const IconBell = (p) => (
  <svg {...base} {...p}>
    <path d="M18 8a6 6 0 1 0-12 0c0 4.5-1.5 6-1.5 6h15S18 12.5 18 8z" />
    <path d="M10.3 20a2 2 0 0 0 3.4 0" />
  </svg>
);

export const IconSearch = (p) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </svg>
);

export const IconLanguages = (p) => (
  <svg {...base} {...p}>
    <path d="M3 5h11M9 3v2c0 5-2.5 8-6 9" />
    <path d="M6.5 10c1.6 3.1 4 5 7 6" />
    <path d="m12.5 21 4.5-10 4.5 10M14.5 17h6" />
  </svg>
);

export const IconVolume = (p) => (
  <svg {...base} {...p}>
    <path d="M11 5 6.5 9H3v6h3.5L11 19V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
  </svg>
);

export const IconVibrate = (p) => (
  <svg {...base} {...p}>
    <rect x="8" y="3" width="8" height="18" rx="1.6" />
    <path d="M4 9v6M2 11v2M20 9v6M22 11v2" />
  </svg>
);

export const IconPhone = (p) => (
  <svg {...base} {...p}>
    <path d="M6.6 3.5h3l1.5 3.7-1.9 1.1a11.5 11.5 0 0 0 5.5 5.5l1.1-1.9 3.7 1.5v3a1.6 1.6 0 0 1-1.8 1.6C10.9 17.3 6.7 13.1 5 5.3A1.6 1.6 0 0 1 6.6 3.5z" />
  </svg>
);

/* ─── PAYMENT-METHOD GLYPHS ───────────────────────────────────────────────────
 *
 * The P2P filters listed payment methods as bare text in a <select>. These give
 * each method a shape, which is what makes a long list scannable rather than
 * read-word-by-word.
 *
 * They are drawn HERE, in the shared set, on the same `base` (1.75 stroke,
 * 24-unit box, currentColor) as everything else — a second icon vocabulary is
 * how a design system stops being one. Nothing here is smaller than the stroke
 * width, for the sub-pixel reason documented in WalletArt.jsx.
 *
 * They are keyed off the `type` field Hodl Hodl already returns
 * (server/hodlhodl.js normalises it) — no extra request, no new server shape.
 */

export const IconBank = (p) => (
  <svg {...base} {...p}>
    <path d="M3 9.5 12 4l9 5.5" />
    <path d="M5 9.5v8M9.7 9.5v8M14.3 9.5v8M19 9.5v8" />
    <path d="M3 20.5h18" />
  </svg>
);

export const IconCash = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 10v4M18 10v4" />
  </svg>
);

export const IconCard = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.4" />
    <path d="M2.5 9.8h19" />
    <path d="M6 14.6h3.5" />
  </svg>
);

export const IconWalletOnline = (p) => (
  <svg {...base} {...p}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v2.5" />
    <path d="M3 7.5v9A2.5 2.5 0 0 0 5.5 19h13a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-13" />
    <circle cx="16.8" cy="13.5" r="1.1" />
  </svg>
);

export const IconGift = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="9" width="18" height="11.5" rx="1.8" />
    <path d="M2 9h20M12 9v11.5" />
    <path d="M12 9C10.5 5.5 9.2 4 7.7 4a2.2 2.2 0 0 0 0 4.4M12 9c1.5-3.5 2.8-5 4.3-5a2.2 2.2 0 0 1 0 4.4" />
  </svg>
);

export const IconMobileMoney = (p) => (
  <svg {...base} {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.4" />
    <path d="M10.5 5.4h3" />
    <path d="M12 10v5.5M10.2 11.2h2.6a1.3 1.3 0 0 1 0 2.6h-1.6a1.3 1.3 0 0 0 0 2.6h2.6" />
  </svg>
);

export const IconCoins = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="6.6" rx="7" ry="2.9" />
    <path d="M5 6.6v4.4c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V6.6" />
    <path d="M5 11v4.4c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V11" />
  </svg>
);
