/**
 * SETTINGS SECTION ICONS
 * ---------------------------------------------------------------------------
 * One icon per tile in the settings hub, drawn here rather than pulled from
 * the general icon set for two reasons:
 *
 * 1. SCALE. The hub tile renders these at 22–24px inside a 46px squircle. The
 *    general `Icons.jsx` set is drawn for 17–19px inline use (stroke 1.75,
 *    tight gaps), and at 24px inside a coloured tile it looks thin and
 *    under-drawn. These carry slightly heavier geometry (stroke 1.6, larger
 *    shapes) so the icon fills its tile instead of floating in it.
 *
 * 2. DUOTONE. Every icon here is drawn twice: once as a solid shape at low
 *    opacity under the stroke. That is what makes it read as "modern" rather
 *    than "wireframe", and it is the reason they are not `<img>` or emoji —
 *    a fill of `currentColor` at 16% keeps the exact same tint the tile's
 *    theme token provides, so light theme and dark theme are both correct
 *    without a second asset. An SVG drawn for one theme and inverted with a
 *    filter always looks wrong; this one is token-driven, like the rest of
 *    the app.
 *
 * Everything inherits `currentColor`, so the per-section colour is set by CSS
 * on the tile (`[data-tone]`) and nothing here knows about themes at all.
 */

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
};

/** The duotone underlay: same geometry, filled, no stroke. */
const tone = (o = 0.18) => ({ fill: 'currentColor', fillOpacity: o, stroke: 'none' });

/* ── profile: a person inside a card frame (the identity the app greets you by) */
export const SetIconProfile = (p) => (
  <svg {...base} {...p}>
    <rect x="3.1" y="3.1" width="17.8" height="17.8" rx="5.8" {...tone(0.08)} />
    <circle cx="12" cy="10.1" r="2.95" {...tone(0.3)} />
    <rect x="3.1" y="3.1" width="17.8" height="17.8" rx="5.8" />
    <circle cx="12" cy="10.1" r="2.95" />
    <path d="M7.2 17.6c.62-2.32 2.44-3.66 4.8-3.66s4.18 1.34 4.8 3.66" />
  </svg>
);

/* ── notifications: bell with a clapper and a status dot ───────────────── */
export const SetIconBell = (p) => (
  <svg {...base} {...p}>
    <path
      d="M6.5 10.2a5.5 5.5 0 0 1 11 0c0 3.7 1.4 5 1.4 5H5.1s1.4-1.3 1.4-5Z"
      {...tone(0.24)}
    />
    <path d="M6.5 10.2a5.5 5.5 0 0 1 11 0c0 3.7 1.4 5 1.4 5H5.1s1.4-1.3 1.4-5Z" />
    <path d="M12 3.4v1.3" />
    <path d="M10.1 18a2 2 0 0 0 3.8 0" />
  </svg>
);

/* ── appearance: a half-filled disc — the universal "light/dark" glyph ─── */
export const SetIconAppearance = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.2" {...tone(0.1)} />
    <path d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z" {...tone(0.55)} />
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z" />
  </svg>
);

/* ── trading: two candles with wicks ──────────────────────────────────── */
export const SetIconTrading = (p) => (
  <svg {...base} {...p}>
    <rect x="4.4" y="6.6" width="5" height="8.2" rx="1.7" {...tone(0.24)} />
    <rect x="14.6" y="9.2" width="5" height="7.4" rx="1.7" {...tone(0.24)} />
    <path d="M6.9 3.6v3M6.9 14.8v3.2M17.1 5.4v3.8M17.1 16.6v3.8" />
    <rect x="4.4" y="6.6" width="5" height="8.2" rx="1.7" />
    <rect x="14.6" y="9.2" width="5" height="7.4" rx="1.7" />
  </svg>
);

/* ── security: shield with a keyhole ──────────────────────────────────── */
export const SetIconSecurity = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3 5.2 5.6v5.3c0 4.3 2.9 7.1 6.8 9.3 3.9-2.2 6.8-5 6.8-9.3V5.6Z" {...tone(0.2)} />
    <path d="M12 3 5.2 5.6v5.3c0 4.3 2.9 7.1 6.8 9.3 3.9-2.2 6.8-5 6.8-9.3V5.6Z" />
    <circle cx="12" cy="10.9" r="1.95" />
    <path d="M12 12.85v2.3" />
  </svg>
);

/* ── privacy: an eye with a bar across it ─────────────────────────────── */
export const SetIconPrivacy = (p) => (
  <svg {...base} {...p}>
    <path
      d="M3 12s3.3-5.7 9-5.7S21 12 21 12s-3.3 5.7-9 5.7S3 12 3 12Z"
      {...tone(0.16)}
    />
    <path d="M3 12s3.3-5.7 9-5.7S21 12 21 12s-3.3 5.7-9 5.7S3 12 3 12Z" />
    <circle cx="12" cy="12" r="2.7" />
    <path d="M5.4 18.9 18.6 5.1" strokeWidth="1.9" />
  </svg>
);

/* ── networks: three nodes joined into a chain ────────────────────────── */
export const SetIconNetwork = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="5.3" r="2.5" {...tone(0.28)} />
    <circle cx="5.3" cy="18.1" r="2.5" {...tone(0.28)} />
    <circle cx="18.7" cy="18.1" r="2.5" {...tone(0.28)} />
    <path d="M10.7 7.5 6.6 15.9M13.3 7.5l4.1 8.4M7.8 18.1h8.4" />
    <circle cx="12" cy="5.3" r="2.5" />
    <circle cx="5.3" cy="18.1" r="2.5" />
    <circle cx="18.7" cy="18.1" r="2.5" />
  </svg>
);

/* ── data & storage: a stack of two discs ─────────────────────────────── */
export const SetIconData = (p) => (
  <svg {...base} {...p}>
    <path d="M5 6.4c0-1.6 3.1-2.9 7-2.9s7 1.3 7 2.9-3.1 2.9-7 2.9-7-1.3-7-2.9Z" {...tone(0.28)} />
    <ellipse cx="12" cy="6.4" rx="7" ry="2.9" />
    <path d="M5 6.4v5.2c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V6.4" />
    <path d="M5 11.6v5.2c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9v-5.2" />
  </svg>
);

/* ── cloud sync: a cloud with two arrows inside ───────────────────────── */
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

/* ── region availability: a globe with meridians ──────────────────────── */
export const SetIconRegion = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.3" {...tone(0.12)} />
    <path d="M12 3.7c2.3 2.3 3.5 5.1 3.5 8.3S14.3 18 12 20.3c-2.3-2.3-3.5-5.1-3.5-8.3S9.7 6 12 3.7Z" {...tone(0.3)} />
    <circle cx="12" cy="12" r="8.3" />
    <path d="M3.8 12h16.4" />
    <path d="M12 3.7c2.3 2.3 3.5 5.1 3.5 8.3S14.3 18 12 20.3c-2.3-2.3-3.5-5.1-3.5-8.3S9.7 6 12 3.7Z" />
  </svg>
);

/* ── about & support: a chat bubble with an information dot ───────────── */
export const SetIconSupport = (p) => (
  <svg {...base} {...p}>
    <path
      d="M20.4 11.9c0 3.8-3.7 6.9-8.3 6.9-.9 0-1.8-.1-2.6-.4L4.4 20.2l1.5-3.5A6.5 6.5 0 0 1 3.6 11.9c0-3.8 3.8-6.9 8.5-6.9s8.3 3.1 8.3 6.9Z"
      {...tone(0.16)}
    />
    <path d="M20.4 11.9c0 3.8-3.7 6.9-8.3 6.9-.9 0-1.8-.1-2.6-.4L4.4 20.2l1.5-3.5A6.5 6.5 0 0 1 3.6 11.9c0-3.8 3.8-6.9 8.5-6.9s8.3 3.1 8.3 6.9Z" />
    <path d="M12 9.1v.01M12 11.8v3.1" strokeWidth="1.9" />
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
