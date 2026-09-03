/**
 * OPERATIONS CENTER ICON SET.
 * ---------------------------------------------------------------------------
 * Line-art icons used only by the Operations Center grid, kept OUT of
 * `Icons.jsx` on purpose.
 *
 * `Icons.jsx` is imported by the nav and therefore lands in the first-paint
 * chunk, which `test/wiring.mjs` holds under a size ratchet. These 25 icons
 * are reachable only from `/intent`, a lazily-loaded route, so putting them
 * here keeps them out of the bytes every user downloads before seeing the
 * market page.
 *
 * ─── WHY THEY EXIST AT ALL ──────────────────────────────────────────────────
 *   «آیکون‌ها زشت هستند»
 *
 * The Operations Center rendered an emoji for each of its 15 categories and 80
 * cards. Emoji were wrong there for the same reasons the nav dropped them:
 *   · a font glyph, so a different picture on every OS
 *   · cannot take `currentColor`, so a disabled card kept a bright icon above
 *     grey text, which reads as a rendering fault
 *   · its own baseline and advance width, so a grid of them never aligns
 *   · several used here (⚔️ 🕵️ 🥧 🧾 🛰️) have no glyph in the default Android
 *     emoji font and render as an empty box
 *
 * These share `base` with the main set, so stroke, size and colour inherit
 * exactly the same way.
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

export const IconBridge = (p) => (
  <svg {...base} {...p}>
    <path d="M2 9h20" />
    <path d="M2 9v9M22 9v9" />
    <path d="M2 14c4.5 0 6-4 10-4s5.5 4 10 4" />
    <path d="M8 12.2V18M16 12.2V18" />
  </svg>
);

export const IconLeaf = (p) => (
  <svg {...base} {...p}>
    <path d="M4 20c0-8 5.5-13 16-13 0 9.5-5 14-11 14a5 5 0 0 1-5-1Z" />
    <path d="M9 15c2.5-2.8 5.2-4.6 8.5-5.8" />
  </svg>
);

export const IconDroplet = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3s6 6.2 6 10.2a6 6 0 0 1-12 0C6 9.2 12 3 12 3Z" />
    <path d="M9.5 13.6a2.6 2.6 0 0 0 2.6 2.6" />
  </svg>
);

export const IconBolt = (p) => (
  <svg {...base} {...p}>
    <path d="M13.5 2 4 13.5h6L10.5 22 20 10.5h-6L13.5 2Z" />
  </svg>
);

export const IconTarget = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);

export const IconScale = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3v18M7 21h10" />
    <path d="M4 7h16M7.5 6.4 4 13h7L7.5 6.4ZM16.5 6.4 13 13h7l-3.5-6.6Z" />
  </svg>
);

export const IconPie = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3a9 9 0 1 0 9 9h-9V3Z" />
    <path d="M15 3.6A9 9 0 0 1 20.4 9H15V3.6Z" />
  </svg>
);

export const IconEye = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconBars = (p) => (
  <svg {...base} {...p}>
    <path d="M4 20V11M10 20V4M16 20v-6M22 20H2" />
  </svg>
);

export const IconWhale = (p) => (
  <svg {...base} {...p}>
    <path d="M3 13c0 3.3 3.1 5.5 7 5.5 5 0 9-2.9 11-7.5-2.8.6-4.6 1.6-6.4 3" />
    <path d="M3 13c0-2.6 1.7-4.5 4-4.5S11 10.4 11 13" />
    <path d="M16 6.5c.9-1 2-1.5 3.4-1.5" />
    <circle cx="6.2" cy="11.6" r=".7" fill="currentColor" stroke="none" />
  </svg>
);

export const IconRobot = (p) => (
  <svg {...base} {...p}>
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4.5V8M9 13h.01M15 13h.01M9.5 16h5" />
    <path d="M2 12v3M22 12v3" />
    <circle cx="12" cy="3.6" r="1.1" />
  </svg>
);

export const IconCalendar = (p) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
    <path d="M8 14h3" />
  </svg>
);

export const IconArrowUp = (p) => (
  <svg {...base} {...p}>
    <path d="M12 20V4M12 4l-5.5 5.5M12 4l5.5 5.5" />
  </svg>
);

export const IconMinus = (p) => (
  <svg {...base} {...p}>
    <path d="M5 12h14" />
  </svg>
);

export const IconRepeat = (p) => (
  <svg {...base} {...p}>
    <path d="M4 10a6 6 0 0 1 6-6h7" />
    <path d="M14 1.5 17.5 4 14 6.5" />
    <path d="M20 14a6 6 0 0 1-6 6H7" />
    <path d="M10 22.5 6.5 20 10 17.5" />
  </svg>
);

export const IconStar = (p) => (
  <svg {...base} {...p}>
    <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.05 5.9L12 16.9 6.75 19.7l1.05-5.9L3.5 9.7l5.9-.8L12 3.5Z" />
  </svg>
);

export const IconUsers = (p) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="8" r="3.4" />
    <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" />
    <path d="M16.2 5.1a3.4 3.4 0 0 1 0 6.6" />
    <path d="M17.6 14.4A6.2 6.2 0 0 1 21.2 20" />
  </svg>
);

export const IconRadar = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 12 18 6.6" />
    <circle cx="15.6" cy="9" r=".9" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSwords = (p) => (
  <svg {...base} {...p}>
    <path d="M4 4h3.2l9 9-3.2 3.2-9-9V4Z" />
    <path d="M20 4h-3.2l-3.4 3.4M11 14l-3.4 3.4" />
    <path d="M4.5 19.5 7 17M19.5 19.5 17 17" />
  </svg>
);

export const IconLayers = (p) => (
  <svg {...base} {...p}>
    <path d="m12 3 9 4.6-9 4.6L3 7.6 12 3Z" />
    <path d="m3 12.2 9 4.6 9-4.6" />
    <path d="m3 16.8 9 4.6 9-4.6" />
  </svg>
);

export const IconReceipt = (p) => (
  <svg {...base} {...p}>
    <path d="M5.5 2.8h13v18.4l-2.2-1.5-2.2 1.5-2.2-1.5-2.2 1.5-2.2-1.5V2.8Z" />
    <path d="M9 8h6M9 12h6M9 16h3.5" />
  </svg>
);

export const IconChip = (p) => (
  <svg {...base} {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
    <path d="M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21" />
  </svg>
);

export const IconCrystal = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="10" r="6.5" />
    <path d="M6 18.5h12M8 21h8" />
    <path d="M9.4 8.2a3.6 3.6 0 0 1 2.8-2" />
  </svg>
);

export const IconCalculator = (p) => (
  <svg {...base} {...p}>
    <rect x="5" y="2.6" width="14" height="18.8" rx="2.4" />
    <path d="M8.5 6.6h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5v3.5M8.5 18h3.5" />
  </svg>
);

export const IconMedal = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="14.5" r="5.5" />
    <path d="M9 9.4 6.5 2.5h11L15 9.4" />
    <path d="M12 12.4v4.2" />
  </svg>
);
