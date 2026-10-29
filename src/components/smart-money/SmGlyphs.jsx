/**
 * SMART MONEY — the page's own line-art icon set.
 * ---------------------------------------------------------------------------
 * Every glyph on the Smart Money deck used to be an emoji: ✦ in the title,
 * 🐋 for whales, ⚡ for early detection, 🆕 for fresh wallets, 💰 for flow,
 * ⚠️ for liquidity, 🏦/🏛️ for exchanges. Emoji are drawn by the OPERATING
 * SYSTEM, not by us, so the same screen showed a glossy Apple whale on iOS, a
 * flat blue Noto whale on Android, an outlined fish inside the APK's WebView —
 * and none of them could take the page's mint/cyan accent or the light theme.
 * A green emoji on a mint chip is also the fastest way to make a dashboard
 * look like a chat message.
 *
 * These are 24×24 line glyphs in the same language as `components/Icons.jsx`
 * (currentColor, 1.7 stroke, round caps), sized by the caller. They are
 * deliberately drawn on ONE grid so the tab dock, the metric tiles and the
 * section headers read as a single family rather than seven borrowed icons.
 *
 * No external icon dependency: the bundle already carries one set, and a
 * second library for seven glyphs would be ~40 KB for no visual gain.
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
};

/* The page mark: a radar pulse. Used in the hero kicker. */
export const SmSignalGlyph = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.7" opacity=".32" />
    <path d="M12 12 18.1 6.6" />
    <circle cx="12" cy="12" r="1.55" fill="currentColor" stroke="none" />
    <path d="M6.6 15.6a7.6 7.6 0 0 1 0-7.2" opacity=".7" />
    <circle cx="16.8" cy="16.4" r="1.15" fill="currentColor" stroke="none" opacity=".75" />
  </svg>
);

/* Overview — four panes, one lit. */
export const SmOverviewGlyph = (p) => (
  <svg {...base} {...p}>
    <rect x="3.2" y="3.2" width="7.3" height="7.3" rx="2.2" />
    <rect x="13.5" y="3.2" width="7.3" height="7.3" rx="2.2" opacity=".42" />
    <rect x="3.2" y="13.5" width="7.3" height="7.3" rx="2.2" opacity=".42" />
    <rect x="13.5" y="13.5" width="7.3" height="7.3" rx="2.2" />
  </svg>
);

/* Verified intelligence — a sealed badge. */
export const SmVerifiedGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M12 2.7 20 6v5.6c0 4.7-3.3 8-8 9.7-4.7-1.7-8-5-8-9.7V6z" />
    <path d="m8.5 11.7 2.5 2.5 4.6-4.8" />
  </svg>
);

/* Whale — body, tail, eye, spout. */
export const SmWhaleGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M4.4 16.4c-.8-4.4 2.2-8 6.6-8.5 2.6-.3 4.6.7 6.1 2.4.9 1.1 1.5 2.4 1.8 3.9.2 1 .9 1.7 1.9 2.1-1.2 1.5-3.1 2.3-5.6 2.3-4.5 0-8.6-1-10.8-2.2Z" />
    <path d="M18.5 12.8c1.2-.9 2.4-1 3.4-.3-.5 1.2-1.4 2.1-2.7 2.6" opacity=".65" />
    <circle cx="8.3" cy="13.3" r=".95" fill="currentColor" stroke="none" />
    <path d="M9.3 8.1C9 6.5 9.8 5.2 11.4 4.5M11.4 4.5l1.7.4M11.4 4.5 11 2.8" opacity=".8" />
  </svg>
);

/* Wallets — a card sleeve. */
export const SmWalletGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M20.2 9.6V7.5a2.4 2.4 0 0 0-2.4-2.4H6.2a2.4 2.4 0 0 0-2.4 2.4v9a2.4 2.4 0 0 0 2.4 2.4h11.6a2.4 2.4 0 0 0 2.4-2.4v-2" />
    <path d="M21.3 12.7h-3.5a2.2 2.2 0 0 0 0 4.4h3.5z" />
    <path d="M6.4 9.1h5.2" opacity=".6" />
  </svg>
);

/* Tokens — a stack of coins. */
export const SmCoinGlyph = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="6.3" rx="7.2" ry="3.1" />
    <path d="M4.8 6.3v5.2c0 1.7 3.2 3.1 7.2 3.1s7.2-1.4 7.2-3.1V6.3" />
    <path d="M4.8 11.5v5.2c0 1.7 3.2 3.1 7.2 3.1s7.2-1.4 7.2-3.1v-5.2" opacity=".65" />
  </svg>
);

/* Flow — money moving both ways. */
export const SmFlowGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M3.4 8.2h13.4M13.6 5.2l3 3-3 3" />
    <path d="M20.6 15.8H7.2M10.4 12.8l-3 3 3 3" opacity=".65" />
  </svg>
);

/* Alerts — a bell that can be tinted. */
export const SmBellGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M18.2 15.6H5.8c1-1.2 1.6-2.7 1.6-4.3V10a4.6 4.6 0 0 1 9.2 0v1.3c0 1.6.6 3.1 1.6 4.3Z" />
    <path d="M9.9 18.4a2.3 2.3 0 0 0 4.2 0" />
    <path d="M12 3.2V4" opacity=".65" />
  </svg>
);

/* Whale activity — three soft waves. */
export const SmWavesGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M2.8 9.2c1.7-1.7 3.4-1.7 5.1 0s3.4 1.7 5.1 0 3.4-1.7 5.1 0 2 .8 2.6.7" />
    <path d="M2.8 13.4c1.7-1.7 3.4-1.7 5.1 0s3.4 1.7 5.1 0 3.4-1.7 5.1 0 2 .8 2.6.7" opacity=".72" />
    <path d="M2.8 17.6c1.7-1.7 3.4-1.7 5.1 0s3.4 1.7 5.1 0 3.4-1.7 5.1 0" opacity=".45" />
  </svg>
);

/* Accumulation — value arriving into the treasury. */
export const SmAccumulateGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.3v10.2M8 9.6l4 4 4-4" />
    <path d="M4.6 16.1v1.6a2.3 2.3 0 0 0 2.3 2.3h10.2a2.3 2.3 0 0 0 2.3-2.3v-1.6" />
  </svg>
);

/* Distribution — value leaving the treasury. */
export const SmDistributeGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M12 20.3V10.1M8 14l4-4 4 4" />
    <path d="M4.6 7.6V6a2.3 2.3 0 0 1 2.3-2.3h10.2A2.3 2.3 0 0 1 19.4 6v1.6" />
  </svg>
);

/* Exchange — a bank colonnade. */
export const SmBankGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M3.2 9.3 12 4.2l8.8 5.1" />
    <path d="M5.5 10.7v6.5M10 10.7v6.5M14 10.7v6.5M18.5 10.7v6.5" />
    <path d="M3.4 19.4h17.2" />
  </svg>
);

/* Liquidity — a droplet with a highlight. */
export const SmDropletGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.1c3.5 4.1 5.7 7 5.7 9.8a5.7 5.7 0 0 1-11.4 0c0-2.8 2.2-5.7 5.7-9.8Z" />
    <path d="M9.5 13.5a2.6 2.6 0 0 0 2.5 2.7" opacity=".7" />
  </svg>
);

/* Fresh wallets — a new counterparty. */
export const SmFreshGlyph = (p) => (
  <svg {...base} {...p}>
    <circle cx="9.4" cy="8" r="3.4" />
    <path d="M3.4 20c.5-3.4 3-5.6 6-5.6 1.2 0 2.4.4 3.3 1.1" />
    <path d="M17.6 14.2v5.2M15 16.8h5.2" />
  </svg>
);

/* Spark — the "intelligence" accent on the teaser and empty states. */
export const SmSparkGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.2c.4 3.5 1.8 5.6 5 6.9-3.2 1.3-4.6 3.4-5 6.9-.4-3.5-1.8-5.6-5-6.9 3.2-1.3 4.6-3.4 5-6.9Z" />
    <path d="M17.9 15.2c.2 1.6.8 2.6 2.2 3.2-1.4.6-2 1.6-2.2 3.2-.3-1.6-.9-2.6-2.3-3.2 1.4-.6 2-1.6 2.3-3.2Z" opacity=".7" />
  </svg>
);

/* Pulse — a single heartbeat line, for the "live" chip. */
export const SmPulseGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M2.8 12h4l1.7-4.4 3 8.8 2-4.4h7.7" />
  </svg>
);

/* Risk — a soft triangle. */
export const SmRiskGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.7 21 19.3a1.2 1.2 0 0 1-1 1.8H4a1.2 1.2 0 0 1-1-1.8Z" />
    <path d="M12 9.4v4.4" />
    <circle cx="12" cy="17" r=".95" fill="currentColor" stroke="none" />
  </svg>
);

/* Swap — the two-way arrow pair, for «کپی تراکنش» (copy → open the swap with
   this token already selected). Drawn on the same grid as the rest so a CTA
   inside a receipt row does not borrow a filled icon from another family. */
export const SmSwapGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="M4 8.4h13.2" />
    <path d="m14 4.9 3.5 3.5-3.5 3.5" />
    <path d="M20 15.6H6.8" />
    <path d="M10 12.1 6.5 15.6 10 19.1" />
  </svg>
);

/* Copy — two stacked sheets, for the same action's "copied" state. */
export const SmCopyGlyph = (p) => (
  <svg {...base} {...p}>
    <rect x="8.6" y="3.3" width="11.1" height="11.1" rx="2.6" />
    <path d="M15.4 17.3v1a2.4 2.4 0 0 1-2.4 2.4H6.7a2.4 2.4 0 0 1-2.4-2.4v-6.3a2.4 2.4 0 0 1 2.4-2.4h1" opacity=".7" />
  </svg>
);

/* Layers — the "snapshot" tile: what the sample covers right now. */
export const SmLayersGlyph = (p) => (
  <svg {...base} {...p}>
    <path d="m12 3.4 8.4 4.2-8.4 4.2-8.4-4.2z" />
    <path d="m3.6 12.2 8.4 4.2 8.4-4.2" opacity=".72" />
    <path d="m3.6 16.4 8.4 4.2 8.4-4.2" opacity=".42" />
  </svg>
);
