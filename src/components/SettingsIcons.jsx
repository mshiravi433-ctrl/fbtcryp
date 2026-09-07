/**
 * SETTINGS SECTION ICONS — v2
 * ---------------------------------------------------------------------------
 * One icon per tile in the settings hub, drawn here rather than pulled from
 * the general icon set for two reasons:
 *
 * 1. SCALE. The hub tile renders these at 24–26px inside a 50px gradient
 *    squircle. The general `Icons.jsx` set is drawn for 17–19px inline use
 *    (stroke 1.75, tight gaps), and at 24px inside a coloured tile it looks
 *    thin and under-drawn. These carry slightly heavier geometry (stroke 1.7,
 *    larger shapes) so the icon fills its tile instead of floating in it.
 *
 * 2. DUOTONE. Every icon here is drawn twice: once as a solid shape at low
 *    opacity under the stroke. That is what makes it read as "modern" rather
 *    than "wireframe", and it is the reason they are not `<img>` or emoji —
 *    a fill of `currentColor` at ~14–55% keeps the exact same tint the tile's
 *    theme token provides, so light theme and dark theme are both correct
 *    without a second asset. An SVG drawn for one theme and inverted with a
 *    filter always looks wrong; this one is token-driven, like the rest of
 *    the app.
 *
 * v2 changes (the follow-up design pass): heavier duotone underlays, a tiny
 * accent mark on each glyph (a status dot, a sparkle, a price candle) so the
 * set reads as designed rather than traced, and a new "sections" glyph for
 * the hub's own header. The row list also gained gradient icon wells in CSS
 * (settings-hub.css) — the glyphs only had to keep up.
 *
 * Everything inherits `currentColor`, so the per-section colour is set by CSS
 * on the tile ([data-tone]) and nothing here knows about themes at all.
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

/* ── profile: an identity card with a person and a live status dot ─────── */
export const SetIconProfile = (p) => (
  <svg {...base} {...p}>
    <rect x="3.1" y="3.1" width="17.8" height="17.8" rx="5.8" {...tone(0.09)} />
    <circle cx="12" cy="9.8" r="2.9" {...tone(0.42)} />
    <circle cx="12" cy="9.8" r="2.9" />
    <path d="M7.2 17.5c.62-2.3 2.45-3.55 4.8-3.55s4.18 1.25 4.8 3.55" />
    <rect x="3.1" y="3.1" width="17.8" height="17.8" rx="5.8" />
    <circle cx="17.75" cy="6.45" r="1.8" fill="currentColor" fillOpacity="0.85" stroke="none" />
  </svg>
);

/* ── notifications: bell with a clapper and a ping accent ──────────────── */
export const SetIconBell = (p) => (
  <svg {...base} {...p}>
    <path
      d="M6.6 10.2a5.4 5.4 0 0 1 10.8 0c0 3.5 1.5 4.8 1.55 5.5H5.05c.05-.7 1.55-2 1.55-5.5Z"
      {...tone(0.24)}
    />
    <path d="M6.6 10.2a5.4 5.4 0 0 1 10.8 0c0 3.5 1.5 4.8 1.55 5.5H5.05c.05-.7 1.55-2 1.55-5.5Z" />
    <path d="M12 2.9v2" />
    <path d="M10 18.2a2 2 0 0 0 4 0" />
    <circle cx="17.7" cy="4.5" r="1.7" fill="currentColor" fillOpacity="0.6" stroke="none" />
  </svg>
);

/* ── appearance: day/night disc with sparkle accents ───────────────────── */
export const SetIconAppearance = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.2" {...tone(0.1)} />
    <path d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z" {...tone(0.5)} />
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z" />
    <circle cx="16.7" cy="7.5" r="1.35" fill="currentColor" fillOpacity="0.85" stroke="none" />
    <circle cx="19.1" cy="10.9" r="0.95" fill="currentColor" fillOpacity="0.7" stroke="none" />
  </svg>
);

/* ── trading: two candles — the taller one is the live accent ──────────── */
export const SetIconTrading = (p) => (
  <svg {...base} {...p}>
    <rect x="4.3" y="8.6" width="4.8" height="7.4" rx="1.6" {...tone(0.3)} />
    <rect x="14.9" y="5" width="4.8" height="11" rx="1.6" {...tone(0.5)} />
    <path d="M6.7 5.3v3.3M6.7 16v2.6" />
    <path d="M17.3 2.7v2.3M17.3 16v2.6" />
    <rect x="4.3" y="8.6" width="4.8" height="7.4" rx="1.6" />
    <rect x="14.9" y="5" width="4.8" height="11" rx="1.6" />
  </svg>
);

/* ── security: a shield with a keyhole and a key dot ───────────────────── */
export const SetIconSecurity = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.05 5.25 5.55v5.25c0 4.35 2.9 7.25 6.75 9.4 3.85-2.15 6.75-5.05 6.75-9.4V5.55Z" {...tone(0.2)} />
    <path d="M12 3.05 5.25 5.55v5.25c0 4.35 2.9 7.25 6.75 9.4 3.85-2.15 6.75-5.05 6.75-9.4V5.55Z" />
    <circle cx="12" cy="10.5" r="1.95" {...tone(0.45)} />
    <circle cx="12" cy="10.5" r="1.95" />
    <path d="M12 12.45v2.1" />
  </svg>
);

/* ── privacy: an eye behind a bar ──────────────────────────────────────── */
export const SetIconPrivacy = (p) => (
  <svg {...base} {...p}>
    <path
      d="M3 12s3.3-5.7 9-5.7S21 12 21 12s-3.3 5.7-9 5.7S3 12 3 12Z"
      {...tone(0.14)}
    />
    <path d="M3 12s3.3-5.7 9-5.7S21 12 21 12s-3.3 5.7-9 5.7S3 12 3 12Z" />
    <circle cx="12" cy="12" r="2.7" {...tone(0.5)} />
    <circle cx="12" cy="12" r="2.7" />
    <path d="M5.5 18.5 18.5 5.5" strokeWidth="2.1" />
  </svg>
);

/* ── networks: three nodes joined into a chain, one with a plus ────────── */
export const SetIconNetwork = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="5.4" r="2.6" {...tone(0.3)} />
    <circle cx="5.4" cy="18.6" r="2.6" {...tone(0.3)} />
    <circle cx="18.6" cy="18.6" r="2.6" {...tone(0.3)} />
    <path d="M10.8 7.7 6.6 16.3M13.2 7.7l4.2 8.6M8 18.6h8" />
    <circle cx="12" cy="5.4" r="2.6" />
    <circle cx="5.4" cy="18.6" r="2.6" />
    <circle cx="18.6" cy="18.6" r="2.6" />
    <path d="M12 4.35v2.1M10.95 5.4h2.1" strokeWidth="1.5" />
  </svg>
);

/* ── data & storage: a stack of three records, top slice lit ───────────── */
export const SetIconData = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="6.1" rx="6.9" ry="2.7" {...tone(0.34)} />
    <ellipse cx="12" cy="6.1" rx="6.9" ry="2.7" />
    <path d="M5.1 6.1v11.6c0 1.55 3.1 2.8 6.9 2.8s6.9-1.25 6.9-2.8V6.1" />
    <path d="M5.1 12c0 1.55 3.1 2.8 6.9 2.8s6.9-1.25 6.9-2.8" />
  </svg>
);

/* ── cloud sync: a cloud with two arrows inside ────────────────────────── */
export const SetIconCloudSync = (p) => (
  <svg {...base} {...p}>
    <path
      d="M7.6 18.6h9.1a3.9 3.9 0 0 0 .5-7.8 5.3 5.3 0 0 0-10.1-1 3.8 3.8 0 0 0 .5 8.8Z"
      {...tone(0.14)}
    />
    <path d="M7.6 18.6h9.1a3.9 3.9 0 0 0 .5-7.8 5.3 5.3 0 0 0-10.1-1 3.8 3.8 0 0 0 .5 8.8Z" />
    <path d="M9.7 13.6h4.9M13.2 11.9l1.6 1.7-1.6 1.7" />
    <path d="M14.6 16.6H9.7M11.1 18.3 9.5 16.6l1.6-1.7" opacity=".55" />
  </svg>
);

/* ── region availability: a globe with meridians and a "here" dot ──────── */
export const SetIconRegion = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.3" {...tone(0.12)} />
    <path d="M12 3.7c2.3 2.3 3.5 5.1 3.5 8.3S14.3 18 12 20.3c-2.3-2.3-3.5-5.1-3.5-8.3S9.7 6 12 3.7Z" {...tone(0.3)} />
    <circle cx="12" cy="12" r="8.3" />
    <path d="M3.8 12h16.4" />
    <path d="M12 3.7c2.3 2.3 3.5 5.1 3.5 8.3S14.3 18 12 20.3c-2.3-2.3-3.5-5.1-3.5-8.3S9.7 6 12 3.7Z" />
    <circle cx="16.4" cy="8.5" r="1.5" fill="currentColor" fillOpacity="0.85" stroke="none" />
  </svg>
);

/* ── about & support: a chat bubble with an info mark ──────────────────── */
export const SetIconSupport = (p) => (
  <svg {...base} {...p}>
    <path
      d="M20.4 11.9c0 3.8-3.7 6.9-8.3 6.9-.9 0-1.8-.1-2.6-.4L4.4 20.2l1.5-3.5A6.5 6.5 0 0 1 3.6 11.9c0-3.8 3.8-6.9 8.5-6.9s8.3 3.1 8.3 6.9Z"
      {...tone(0.16)}
    />
    <path d="M20.4 11.9c0 3.8-3.7 6.9-8.3 6.9-.9 0-1.8-.1-2.6-.4L4.4 20.2l1.5-3.5A6.5 6.5 0 0 1 3.6 11.9c0-3.8 3.8-6.9 8.5-6.9s8.3 3.1 8.3 6.9Z" />
    <circle cx="12" cy="9" r="1.05" fill="currentColor" fillOpacity="0.9" stroke="none" />
    <path d="M12 12v3.2" strokeWidth="1.9" />
  </svg>
);

/* ── small companions used by the hub's controls ───────────────────────── */

/** "follow the system" — a display on a stand. */
export const SetIconAutoTheme = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="4.6" width="18" height="12" rx="2.6" {...tone(0.14)} />
    <rect x="3" y="4.6" width="18" height="12" rx="2.6" />
    <path d="M9.2 20h5.6M12 16.6V20" />
  </svg>
);

/** The hub's own header glyph — "sections" as a 2×2 layout, one live cell. */
export const SetIconSections = (p) => (
  <svg {...base} {...p}>
    <rect x="3.6" y="3.6" width="7.4" height="7.4" rx="2.4" {...tone(0.14)} />
    <rect x="13" y="3.6" width="7.4" height="7.4" rx="2.4" {...tone(0.14)} />
    <rect x="3.6" y="13" width="7.4" height="7.4" rx="2.4" {...tone(0.14)} />
    <rect x="3.6" y="3.6" width="7.4" height="7.4" rx="2.4" />
    <rect x="13" y="3.6" width="7.4" height="7.4" rx="2.4" />
    <rect x="3.6" y="13" width="7.4" height="7.4" rx="2.4" />
    <rect x="13" y="13" width="7.4" height="7.4" rx="2.4" fill="currentColor" fillOpacity="0.85" stroke="none" />
    <path d="m15.6 17.35 1 1 2-2.2" stroke="#ffffff" strokeWidth="1.9" opacity=".92" />
  </svg>
);

/** a chevron used as the tile affordance — CSS flips it in RTL. */
export const SetIconTileNext = (p) => (
  <svg {...base} strokeWidth="2" {...p}>
    <path d="m9.5 5.5 6.4 6.5-6.4 6.5" />
  </svg>
);

/** back affordance for a popup's sub-view. */
export const SetIconBack = (p) => (
  <svg {...base} strokeWidth="2" {...p}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </svg>
);

/** tick shown on the selected option card. */
export const SetIconTick = (p) => (
  <svg {...base} strokeWidth="2.4" {...p}>
    <path d="m5.5 12.6 4.2 4.2 8.8-9.6" />
  </svg>
);

/* ── chip glyphs: tiny single-tone marks for live-value chips ─────────────
   Emoji had been doing this job («⚡ 0.5%», «🔒 2FA») — emoji render
   differently on every OS and cannot be recoloured, so they were the one
   dated thing left in the hub. These are drawn for 11–13px and inherit the
   chip's currentColor like every other mark on the screen. */
const mini = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
};

/** lightning — the swap speed/slippage mark. */
export const SetChipBolt = (p) => (
  <svg {...mini} {...p}>
    <path d="M13.2 2.8 6 13.4h4.6l-1 7.8 7.2-10.6H12.2Z" />
  </svg>
);

/** the live-value chips get a bell, lock, fingerprint and clock from the
 *  general set already imported by the page; these two extras fill the gap. */
export const SetChipClockHands = (p) => (
  <svg {...mini} {...p}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 7.4V12l3.1 2" />
  </svg>
);

/**
 * The tile registry: id → icon. Kept as a map so `Settings.jsx` builds its
 * section list from data and never has to remember which glyph goes with
 * which section — the same table drives the hub grid and the popup header,
 * which is why they can't disagree.
 */
export const SETTINGS_ICONS = {
  profile: SetIconProfile,
  notify: SetIconBell,
  appearance: SetIconAppearance,
  trading: SetIconTrading,
  security: SetIconSecurity,
  privacy: SetIconPrivacy,
  networks: SetIconNetwork,
  data: SetIconData,
  sync: SetIconCloudSync,
  region: SetIconRegion,
  about: SetIconSupport
};
