/**
 * LAB ICON SET — hand-authored line-art SVG.
 *
 * ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Every icon on the Lab screens used to be an emoji: 🔮 📈 💰 🎯 🧠 🛡️ 📖 🧪 🏦
 * 🧩 ⚖️ 🏆 🎖️. Emoji cannot be recoloured, they render differently on every OS
 * (the same "flask" is a bubbling tube on Android, a conical beaker on iOS, a
 * flat glyph on Windows), they do not align on a text baseline, and — the part
 * that actually reads as "dated" — they cannot animate.
 *
 * These inherit `currentColor` and a shared stroke width, exactly like
 * `components/Icons.jsx` does for the bottom nav. That means one accent token
 * recolours an icon, a gradient can paint it, and its strokes can draw
 * themselves along their own length.
 *
 * ─── CONVENTIONS ─────────────────────────────────────────────────────────────
 *   · 24×24 viewBox, 1.7 stroke, round caps/joins, no fills (except the small
 *     solid dots, which are marked `fill="currentColor"` explicitly).
 *   · Every glyph is optically centred and keeps ~2u of padding inside the box
 *     so a row of mixed icons does not look like a row of mixed sizes.
 *   · `LAB_ICONS` is the registry: components reference icons by NAME (a
 *     string in a data table) rather than importing twelve symbols each.
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  width: 20,
  height: 20,
  'aria-hidden': true,
  focusable: 'false'
};

/* ─── screens: the nine simulators ────────────────────────────────────────── */

/** Prediction — a bubbling flask, the "what will happen next" screen. */
export const IconFlask = (p) => (
  <svg {...base} {...p}>
    <path d="M9.4 3.2h5.2" />
    <path d="M10.6 3.2v5.7L6.3 16.2A2.4 2.4 0 0 0 8.4 19.9h7.2a2.4 2.4 0 0 0 2.1-3.7L13.4 8.9V3.2" />
    <path d="M8.1 14.3h7.8" />
    <circle cx="10.9" cy="16.9" r=".85" />
    <circle cx="13.7" cy="16.2" r=".55" />
  </svg>
);

/** Paper trading — an ascending trend line. */
export const IconTrendUp = (p) => (
  <svg {...base} {...p}>
    <path d="M3.4 20.2h17.2" />
    <path d="M4.2 15.8l4.6-5 3.3 3.2 6-6.6" />
    <path d="M18.1 7.4h-4.3M18.1 7.4v4.3" />
  </svg>
);

/** Investment simulator — a wallet with a card slot. */
export const IconWallet = (p) => (
  <svg {...base} {...p}>
    <path d="M20.4 8.6V7.2a2.2 2.2 0 0 0-2.2-2.2H6.6A2.6 2.6 0 0 0 4 7.6v9a2.6 2.6 0 0 0 2.6 2.6h11.6a2.2 2.2 0 0 0 2.2-2.2v-1.4" />
    <path d="M21 12.1h-3.6a2.4 2.4 0 0 0 0 4.8H21a.9.9 0 0 0 .9-.9v-3a.9.9 0 0 0-.9-.9Z" />
    <path d="M7.4 8.2h5.2" />
  </svg>
);

/** Challenges — a target. */
export const IconTarget = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.3" />
    <circle cx="12" cy="12" r="4.4" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

/** Lessons — a brain, left and right hemispheres. */
export const IconBrain = (p) => (
  <svg {...base} {...p}>
    <path d="M12 5.6a2.6 2.6 0 0 0-4.9-1.1A2.7 2.7 0 0 0 4.4 7.2a2.8 2.8 0 0 0-.7 4.7A2.9 2.9 0 0 0 5.2 16a2.7 2.7 0 0 0 3.1 3.4A2.6 2.6 0 0 0 12 17.9Z" />
    <path d="M12 5.6a2.6 2.6 0 0 1 4.9-1.1 2.7 2.7 0 0 1 2.7 2.7 2.8 2.8 0 0 1 .7 4.7A2.9 2.9 0 0 1 18.8 16a2.7 2.7 0 0 1-3.1 3.4A2.6 2.6 0 0 1 12 17.9" />
    <path d="M12 5.6v12.3" />
  </svg>
);

/** Risk trainer — a shield with a check. */
export const IconShield = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.2 5.1 6v5.5c0 4.2 2.9 7.6 6.9 9.3 4-1.7 6.9-5.1 6.9-9.3V6L12 3.2Z" />
    <path d="m9.3 12.1 1.9 2 3.5-3.9" />
  </svg>
);

/** Glossary — an open book. */
export const IconBook = (p) => (
  <svg {...base} {...p}>
    <path d="M12 6.9C10.6 5.5 8.7 4.8 6.2 4.8a2 2 0 0 0-2 2v9.9a2 2 0 0 1 2-1.9c2.5 0 4.4.7 5.8 2.1 1.4-1.4 3.3-2.1 5.8-2.1a2 2 0 0 1 2 1.9V6.8a2 2 0 0 0-2-2c-2.5 0-4.4.7-5.8 2.1Z" />
    <path d="M12 6.9v10" />
  </svg>
);

/** Strategy lab — an atom: three orbits around a nucleus. */
export const IconAtom = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="12" rx="9" ry="3.9" />
    <ellipse cx="12" cy="12" rx="9" ry="3.9" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9" ry="3.9" transform="rotate(120 12 12)" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
  </svg>
);

/** DeFi lab — a bank: pediment, columns, base. */
export const IconBank = (p) => (
  <svg {...base} {...p}>
    <path d="m3.4 9.4 8.6-5 8.6 5" />
    <path d="M5.8 9.6v7.6M9.9 9.6v7.6M14.1 9.6v7.6M18.2 9.6v7.6" />
    <path d="M4 17.2h16" />
    <path d="M3 20.2h18" />
  </svg>
);

/** What-if — a puzzle piece: one variable snapped into a system. */
export const IconPuzzle = (p) => (
  <svg {...base} {...p}>
    <path d="M10.1 4.6a1.8 1.8 0 0 1 3.6 0c0 .5.3.9.8.9h2.1c.8 0 1.5.7 1.5 1.5v2c0 .5.4.9.9.9a1.8 1.8 0 0 1 0 3.6c-.5 0-.9.4-.9.9v2c0 .8-.7 1.5-1.5 1.5h-2c-.5 0-.9.3-.9.8a1.8 1.8 0 0 1-3.6 0c0-.5-.4-.8-.9-.8h-2a1.5 1.5 0 0 1-1.5-1.5v-2c0-.5-.4-.9-.9-.9a1.8 1.8 0 0 1 0-3.6c.5 0 .9-.4.9-.9v-2c0-.8.7-1.5 1.5-1.5h2c.6 0 1-.4 1-.9Z" />
  </svg>
);

/** Compare portfolios — a balance scale. */
export const IconScale = (p) => (
  <svg {...base} {...p}>
    <path d="M12 4.4v15.4M7.6 19.8h8.8M4.4 8.2h15.2" />
    <path d="m4.4 8.2-2.5 5.4a2.7 2.7 0 0 0 5 0L4.4 8.2Z" />
    <path d="m19.6 8.2-2.5 5.4a2.7 2.7 0 0 0 5 0l-2.5-5.4Z" />
  </svg>
);

/** Level / progress — a trophy. */
export const IconTrophy = (p) => (
  <svg {...base} {...p}>
    <path d="M8 4.2h8v4.6a4 4 0 0 1-8 0V4.2Z" />
    <path d="M8 5.9H5.7a2.3 2.3 0 0 0 2.3 3.5M16 5.9h2.3a2.3 2.3 0 0 1-2.3 3.5" />
    <path d="M12 12.8v3.1" />
    <path d="m8.6 19.8 1-3.9h4.8l1 3.9H8.6Z" />
  </svg>
);

/** Leaderboard — a medal on a ribbon. */
export const IconMedal = (p) => (
  <svg {...base} {...p}>
    <path d="M8 3.2 10.5 9M16 3.2 13.5 9" />
    <circle cx="12" cy="14.9" r="5.4" />
    <path d="m12 12.3.95 1.9 2.1.3-1.5 1.46.35 2.08L12 17.1l-1.9 1 .35-2.08L8.95 14.5l2.1-.3.95-1.9Z" />
  </svg>
);

/* ─── groups & tabs ───────────────────────────────────────────────────────── */

/** Practice group — a bolt: the "do" tier. */
export const IconBolt = (p) => (
  <svg {...base} {...p}>
    <path d="M13.6 2.8 5.8 13.5h5.1l-.9 7.7 7.9-10.7h-5.2l.9-7.7Z" />
  </svg>
);

/** Learn group — a graduation cap. */
export const IconGradCap = (p) => (
  <svg {...base} {...p}>
    <path d="m12 4.4 9.2 4.3-9.2 4.3-9.2-4.3L12 4.4Z" />
    <path d="M6.9 10.6v4.7c0 1.6 2.3 2.9 5.1 2.9s5.1-1.3 5.1-2.9v-4.7" />
    <path d="M21.2 8.7v5.4" />
  </svg>
);

/** Advanced group — a rocket. */
export const IconRocket = (p) => (
  <svg {...base} {...p}>
    <path d="M12 15.2c-2 0-3.1-1.1-3.1-3.1 0-3.6 1.5-6.7 3.1-8.2 1.6 1.5 3.1 4.6 3.1 8.2 0 2-1.1 3.1-3.1 3.1Z" />
    <path d="M8.9 13.6c-1.6.3-3 1.4-3.5 3.2.9-.4 1.9-.6 2.9-.6" />
    <path d="M15.1 13.6c1.6.3 3 1.4 3.5 3.2-.9-.4-1.9-.6-2.9-.6" />
    <path d="M12 15.2v3.9M10 19.1h4" />
    <path d="M10.6 21.4c.4-.8 2.4-.8 2.8 0" />
  </svg>
);

/** More tools — a toolbox. */
export const IconToolbox = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="8" width="18" height="11.4" rx="2.6" />
    <path d="M9 8V6.5a2.1 2.1 0 0 1 2.1-2.1h1.8A2.1 2.1 0 0 1 15 6.5V8" />
    <path d="M3 12.8h18" />
    <path d="M10.3 12.8v1.9h3.4v-1.9" />
  </svg>
);

/* ─── directions & states ─────────────────────────────────────────────────── */

export const IconArrowUp = (p) => (
  <svg {...base} {...p}>
    <path d="M12 19.6V4.9" />
    <path d="m5.9 11 6.1-6.1L18.1 11" />
  </svg>
);

export const IconArrowDown = (p) => (
  <svg {...base} {...p}>
    <path d="M12 4.4v14.7" />
    <path d="m5.9 13 6.1 6.1L18.1 13" />
  </svg>
);

export const IconFlat = (p) => (
  <svg {...base} {...p}>
    <path d="M4.4 12h15.2" />
    <path d="M16.4 8.6 19.8 12l-3.4 3.4" />
  </svg>
);

export const IconChevronLeft = (p) => (
  <svg {...base} {...p}>
    <path d="m14.6 5.4-6.4 6.6 6.4 6.6" />
  </svg>
);

export const IconArrowRight = (p) => (
  <svg {...base} {...p}>
    <path d="M4.4 12h15" />
    <path d="m13.4 6 6 6-6 6" />
  </svg>
);

export const IconCheck = (p) => (
  <svg {...base} {...p}>
    <path d="m4.8 12.6 4.6 4.6L19.4 7.2" />
  </svg>
);

export const IconCheckCircle = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="m8.3 12.3 2.6 2.6 4.9-5.4" />
  </svg>
);

export const IconXCircle = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
  </svg>
);

export const IconClose = (p) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconInfo = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11v5.2" />
    <circle cx="12" cy="7.9" r="1.05" fill="currentColor" stroke="none" />
  </svg>
);

export const IconAlert = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.9 2.9 19.4h18.2L12 3.9Z" />
    <path d="M12 9.6v4.3" />
    <circle cx="12" cy="16.7" r="1.05" fill="currentColor" stroke="none" />
  </svg>
);

export const IconBulb = (p) => (
  <svg {...base} {...p}>
    <path d="M9.2 17.2a6 6 0 1 1 5.6 0v1.6a1.6 1.6 0 0 1-1.6 1.6h-2.4a1.6 1.6 0 0 1-1.6-1.6v-1.6Z" />
    <path d="M9.8 20.4h4.4" />
    <path d="M12 8.4v4.2" />
  </svg>
);

export const IconStar = (p) => (
  <svg {...base} {...p}>
    <path d="m12 3.6 2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85L12 3.6Z" />
  </svg>
);

export const IconCrown = (p) => (
  <svg {...base} {...p}>
    <path d="M3.6 7.6 7 12l5-6.6L17 12l3.4-4.4v9.2a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6V7.6Z" />
    <path d="M3.6 7.6 5.2 6M20.4 7.6 18.8 6" />
  </svg>
);

export const IconLock = (p) => (
  <svg {...base} {...p}>
    <rect x="4.6" y="10.4" width="14.8" height="9.8" rx="2.6" />
    <path d="M8.2 10.4V7.9a3.8 3.8 0 0 1 7.6 0v2.5" />
    <circle cx="12" cy="15.2" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPlay = (p) => (
  <svg {...base} {...p}>
    <path d="M8.2 5.6 18 12l-9.8 6.4V5.6Z" />
  </svg>
);

export const IconPlus = (p) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconRefresh = (p) => (
  <svg {...base} {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20.2 4.6v4.2H16" />
  </svg>
);

export const IconClock = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="13" r="7.8" />
    <path d="M12 9.2V13l2.6 1.7" />
    <path d="M9.3 2.9h5.4" />
  </svg>
);

export const IconSearch = (p) => (
  <svg {...base} {...p}>
    <circle cx="10.8" cy="10.8" r="6.6" />
    <path d="m15.7 15.7 4.4 4.4" />
  </svg>
);

export const IconSparkles = (p) => (
  <svg {...base} {...p}>
    <path d="m11.4 3.4 1.8 4.4 4.4 1.8-4.4 1.8-1.8 4.4-1.8-4.4-4.4-1.8 4.4-1.8 1.8-4.4Z" />
    <path d="m18.6 15 .9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9.9-2.2Z" />
    <path d="m5.2 14.2.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7.7-1.7Z" />
  </svg>
);

export const IconRobot = (p) => (
  <svg {...base} {...p}>
    <rect x="4.2" y="7.8" width="15.6" height="11.4" rx="3.4" />
    <path d="M12 4.4v3.4" />
    <circle cx="12" cy="3.5" r="1.2" />
    <circle cx="9.3" cy="12.7" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="14.7" cy="12.7" r="1.15" fill="currentColor" stroke="none" />
    <path d="M9.9 16.2h4.2" />
    <path d="M2.4 11.6v3.4M21.6 11.6v3.4" />
  </svg>
);

/* ─── DeFi primitives ─────────────────────────────────────────────────────── */

export const IconBanknote = (p) => (
  <svg {...base} {...p}>
    <rect x="2.8" y="6.2" width="18.4" height="11.6" rx="2.4" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6.4 9.8v4.4M17.6 9.8v4.4" />
  </svg>
);

export const IconCreditCard = (p) => (
  <svg {...base} {...p}>
    <rect x="2.8" y="5.4" width="18.4" height="13.2" rx="2.6" />
    <path d="M2.8 9.9h18.4" />
    <path d="M6.4 14.6h3.6" />
  </svg>
);

export const IconDroplet = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.4c3.2 3.6 6 6.7 6 9.9a6 6 0 0 1-12 0c0-3.2 2.8-6.3 6-9.9Z" />
    <path d="M9.4 14.2a2.7 2.7 0 0 0 2.6 2.9" />
  </svg>
);

export const IconSprout = (p) => (
  <svg {...base} {...p}>
    <path d="M12 20.4v-7.2" />
    <path d="M12 13.2c0-3 2.2-5.4 5.4-5.6.2 3.2-2.2 5.6-5.4 5.6Z" />
    <path d="M12 14.6c-2.9 0-5.1-2.2-5.3-5.1 3-.2 5.3 2.1 5.3 5.1Z" />
    <path d="M8.6 20.4h6.8" />
  </svg>
);

export const IconGauge = (p) => (
  <svg {...base} {...p}>
    <path d="M4 17.4a8.6 8.6 0 1 1 16 0" />
    <path d="m14.9 9.9-3.2 4.3a1.6 1.6 0 1 0 2.4 2l.8-6.3Z" />
    <path d="M4 17.4h3M17 17.4h3" />
  </svg>
);

export const IconPie = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 3.4v8.6h8.6" />
  </svg>
);

export const IconActivity = (p) => (
  <svg {...base} {...p}>
    <path d="M2.8 12.4h4L9.4 6l4.4 12 2.6-5.6h4.8" />
  </svg>
);

export const IconFlame = (p) => (
  <svg {...base} {...p}>
    <path d="M12 21c3.6 0 6.2-2.5 6.2-5.9 0-4.4-3.9-6.3-4.6-11.1-2.1 1.4-3.2 3.4-3.2 5.4 0 1.3.5 2.2.5 3 0 1-.8 1.7-1.7 1.7-1 0-1.7-.8-1.7-2.2C6.2 13.6 5.8 15 5.8 16c0 2.9 2.4 5 6.2 5Z" />
  </svg>
);

export const IconLayers = (p) => (
  <svg {...base} {...p}>
    <path d="m12 3.4 8.6 4.4L12 12.2 3.4 7.8 12 3.4Z" />
    <path d="m3.4 12.2 8.6 4.4 8.6-4.4" />
    <path d="m3.4 16.4 8.6 4.4 8.6-4.4" />
  </svg>
);

export const IconCoins = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="9" cy="7" rx="5.6" ry="2.8" />
    <path d="M3.4 7v4c0 1.5 2.5 2.8 5.6 2.8s5.6-1.3 5.6-2.8V7" />
    <path d="M9.6 17.6c0 1.5 2.5 2.6 5.4 2.6s5.6-1.1 5.6-2.6" />
    <ellipse cx="15" cy="14.4" rx="5.6" ry="2.6" />
  </svg>
);

export const IconHourglass = (p) => (
  <svg {...base} {...p}>
    <path d="M7 3.4h10M7 20.6h10" />
    <path d="M7.6 3.4c0 3.4 4.4 4.9 4.4 8.6 0 3.7-4.4 5.2-4.4 8.6" />
    <path d="M16.4 3.4c0 3.4-4.4 4.9-4.4 8.6 0 3.7 4.4 5.2 4.4 8.6" />
  </svg>
);

/* ─── registry ────────────────────────────────────────────────────────────── */

export const LAB_ICONS = {
  flask: IconFlask,
  predict: IconFlask,
  trend: IconTrendUp,
  paper: IconTrendUp,
  wallet: IconWallet,
  invest: IconWallet,
  target: IconTarget,
  challenges: IconTarget,
  brain: IconBrain,
  lessons: IconBrain,
  shield: IconShield,
  risk: IconShield,
  book: IconBook,
  glossary: IconBook,
  atom: IconAtom,
  strategy: IconAtom,
  bank: IconBank,
  defi: IconBank,
  puzzle: IconPuzzle,
  whatif: IconPuzzle,
  scale: IconScale,
  compare: IconScale,
  trophy: IconTrophy,
  level: IconTrophy,
  medal: IconMedal,
  leaderboard: IconMedal,
  bolt: IconBolt,
  practice: IconBolt,
  cap: IconGradCap,
  learn: IconGradCap,
  rocket: IconRocket,
  advanced: IconRocket,
  toolbox: IconToolbox,
  more: IconToolbox,
  up: IconArrowUp,
  down: IconArrowDown,
  flat: IconFlat,
  back: IconChevronLeft,
  next: IconArrowRight,
  check: IconCheck,
  checkCircle: IconCheckCircle,
  xCircle: IconXCircle,
  close: IconClose,
  info: IconInfo,
  alert: IconAlert,
  bulb: IconBulb,
  star: IconStar,
  crown: IconCrown,
  lock: IconLock,
  play: IconPlay,
  plus: IconPlus,
  refresh: IconRefresh,
  clock: IconClock,
  search: IconSearch,
  sparkles: IconSparkles,
  robot: IconRobot,
  coach: IconRobot,
  banknote: IconBanknote,
  card: IconCreditCard,
  droplet: IconDroplet,
  sprout: IconSprout,
  gauge: IconGauge,
  pie: IconPie,
  activity: IconActivity,
  flame: IconFlame,
  layers: IconLayers,
  coins: IconCoins,
  hourglass: IconHourglass
};

/**
 * Look an icon up by name.
 *
 * Data tables (the card grids, the DeFi primitive list, the badge list) hold a
 * string, not a component — that keeps the tables readable and lets the same
 * name be reused for a class hook. An unknown name falls back to `sparkles`
 * rather than rendering nothing: a missing glyph in a 44px tile reads as a bug,
 * a generic one reads as an icon.
 */
export function LabIcon({ name, ...rest }) {
  const Glyph = LAB_ICONS[name] ?? IconSparkles;
  return <Glyph {...rest} />;
}

export default LabIcon;
