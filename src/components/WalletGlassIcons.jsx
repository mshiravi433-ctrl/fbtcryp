import { useId, useMemo } from 'react';

/**
 * WALLET GLASS ICONS — the modern SVG set for the real-wallet screen.
 * ---------------------------------------------------------------------------
 * One drawing language for everything the wallet page shows:
 *
 *   • 24×24 viewBox, `currentColor` stroke at 1.8, round caps and joins —
 *     so a glyph recolours for free in dark, light and pastel accents
 *     (the tiles drive `color` from the `--ink-*` tokens, which are the
 *     AA-checked readable variants of the neon palette).
 *   • Nothing smaller than the stroke width. The broken-glyph post-mortem
 *     in WalletArt.jsx stands: sub-pixel filled geometry anti-aliases
 *     unpredictably at 19–20px and reads as a smudge or a stray dot.
 *     The only fills here are the change-chip triangles, drawn large.
 *   • Directional glyphs are symmetric (swap) or vertical (send/receive
 *     use up/down semantics), so the set is RTL-safe without mirroring —
 *     except chevrons, which the stylesheet flips under `:dir(rtl)`.
 *
 * These are inline SVG components, not image files: no request, no CDN,
 * no theme fork, parsed once. They exist beside Icons.jsx (the shared nav
 * set) rather than replacing it — this page needed verbs the nav set never
 * had (bridge, buy-card, earn-sprout, eye, key, archive…), and the shared
 * set's other consumers keep their exact geometry.
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
};

/* Send — a paper plane. The one glyph every messaging/wallet app converged
   on for "value leaves here", readable at 14px. */
export const IconWalSend = (p) => (
  <svg {...base} width="20" height="20" {...p}>
    <path d="M21.2 2.8 11.2 12.8" />
    <path d="M21.2 2.8 14.6 21.2l-3.4-8.4-8.4-3.4z" />
  </svg>
);

/* Receive — an arrow landing in a tray (the inverse verb, same weight). */
export const IconWalReceive = (p) => (
  <svg {...base} width="20" height="20" {...p}>
    <path d="M12 3.5v10.6" />
    <path d="m7.7 10.1 4.3 4.3 4.3-4.3" />
    <path d="M4 14.9v3.6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.6" />
  </svg>
);

/* Swap — two counter-flowing horizontal arrows. Perfectly symmetric, so it
   means the same thing in RTL and LTR. */
export const IconWalSwap = (p) => (
  <svg {...base} width="20" height="20" {...p}>
    <path d="M4 7.3h13.2" />
    <path d="m14.2 4.1 3.2 3.2-3.2 3.2" />
    <path d="M20 16.7H6.8" />
    <path d="m9.8 13.5-3.2 3.2 3.2 3.2" />
  </svg>
);

/* Bridge — deck, arch and hangers: an actual bridge, not a second swap
   glyph (the old action row reused IconSwap here, so two different verbs
   wore one icon). */
export const IconWalBridge = (p) => (
  <svg {...base} width="20" height="20" {...p}>
    <path d="M2.5 17.2h19" />
    <path d="M5.5 17.2a6.5 6.5 0 0 1 13 0" />
    <path d="M8.5 11.6v5.6M12 10.7v6.5M15.5 11.6v5.6" />
    <path d="M5.5 17.2v3.3M18.5 17.2v3.3" />
  </svg>
);

/* Buy — a payment card with a plus: fiat in, crypto out (the /buy ramp). */
export const IconWalBuy = (p) => (
  <svg {...base} width="20" height="20" {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.6" />
    <path d="M3 10h18" />
    <path d="M16.8 13.6v3.2M15.2 15.2h3.2" />
  </svg>
);

/* Earn — a sprout over a ground line: growth, yield, the Farm/Earn door.
   Each leaf is two curves meeting at a tip that points AWAY from the stem;
   the first draft closed the leaves along the stem itself and read as a
   wine glass at tile size (caught in the screenshot pass, redone). */
export const IconWalEarn = (p) => (
  <svg {...base} width="20" height="20" {...p}>
    <path d="M5.5 21h13" />
    <path d="M12 21v-9.5" />
    <path d="M12 11.5c.8-3.8 3.2-6 7.5-6.5-.4 4.3-2.7 6.7-7.5 6.5z" />
    <path d="M12 14.8c-.8-3.4-2.9-5.4-6.8-5.8.4 3.9 2.5 6 6.8 5.8z" />
  </svg>
);

/* Optimize / Intelligence — the curved four-point spark (the modern "AI"
   glyph) with a small companion star. Curves instead of the angular star
   so it reads soft at tile size. */
export const IconWalSpark = (p) => (
  <svg {...base} width="20" height="20" {...p}>
    <path d="M11 3.6c.55 3.8 1.55 4.85 5.4 5.4-3.85.55-4.85 1.6-5.4 5.4-.55-3.8-1.55-4.85-5.4-5.4 3.85-.55 4.85-1.6 5.4-5.4z" />
    <path d="M18.4 14.6c.28 1.9.78 2.42 2.7 2.7-1.92.28-2.42.8-2.7 2.7-.28-1.9-.78-2.42-2.7-2.7 1.92-.28 2.42-.8 2.7-2.7z" />
  </svg>
);

/* Eye / eye-off — the privacy toggle on the balance box. */
export const IconWalEye = (p) => (
  <svg {...base} width="18" height="18" {...p}>
    <path d="M2.6 12S6.1 5.9 12 5.9 21.4 12 21.4 12 17.9 18.1 12 18.1 2.6 12 2.6 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconWalEyeOff = (p) => (
  <svg {...base} width="18" height="18" {...p}>
    <path d="M4.5 4.5l15 15" />
    <path d="M10.6 6.2A9.4 9.4 0 0 1 12 5.9c5.9 0 9.4 6.1 9.4 6.1a17.6 17.6 0 0 1-3 3.7" />
    <path d="M6.6 8.3A16.9 16.9 0 0 0 2.6 12S6.1 18.1 12 18.1c1.2 0 2.3-.24 3.3-.65" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);

/* Copy feedback pair — copy, then a check that confirms "in the clipboard". */
export const IconWalCopy = (p) => (
  <svg {...base} width="14" height="14" {...p}>
    <rect x="9" y="9" width="11.5" height="11.5" rx="2.6" />
    <path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5" />
  </svg>
);

export const IconWalCheck = (p) => (
  <svg {...base} width="14" height="14" strokeWidth="2.2" {...p}>
    <path d="M4.5 12.6l4.8 4.8L19.5 7" />
  </svg>
);

export const IconWalRefresh = (p) => (
  <svg {...base} width="16" height="16" {...p}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6.1" />
    <path d="M20.7 3.4v5.4h-5.4" />
  </svg>
);

export const IconWalPower = (p) => (
  <svg {...base} width="16" height="16" {...p}>
    <path d="M12 3v7.5" />
    <path d="M6.4 6.3a8 8 0 1 0 11.2 0" />
  </svg>
);

export const IconWalLock = (p) => (
  <svg {...base} width="16" height="16" {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.6" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <circle cx="12" cy="15.2" r="1.35" fill="currentColor" stroke="none" />
  </svg>
);

/* Explorer — "open outside", clearer than a globe for a block explorer. */
export const IconWalExternal = (p) => (
  <svg {...base} width="16" height="16" {...p}>
    <path d="M13.5 4H20v6.5" />
    <path d="M19.4 4.6 11 13" />
    <path d="M18 13.8v4.7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </svg>
);

export const IconWalSearch = (p) => (
  <svg {...base} width="16" height="16" {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20.3 20.3-4.6-4.6" />
  </svg>
);

/* Assets — stacked layers (holdings across chains). */
export const IconWalLayers = (p) => (
  <svg {...base} width="17" height="17" {...p}>
    <path d="M12 3.4 21 8l-9 4.6L3 8z" />
    <path d="m3.9 12.5 8.1 4.1 8.1-4.1" />
    <path d="m3.9 16.4 8.1 4.1 8.1-4.1" />
  </svg>
);

/* Networks — three connected nodes. */
export const IconWalNodes = (p) => (
  <svg {...base} width="17" height="17" {...p}>
    <circle cx="6" cy="6" r="2.6" />
    <circle cx="18" cy="8" r="2.6" />
    <circle cx="9.5" cy="18" r="2.6" />
    <path d="m8.3 7 7.1.7M7.2 8.4l1.6 6.9M16.4 10.2l-4.6 5.6" />
  </svg>
);

/* DeFi — a liquidity droplet with a wave inside. */
export const IconWalPool = (p) => (
  <svg {...base} width="17" height="17" {...p}>
    <path d="M12 3.4s6.4 6.6 6.4 10.9a6.4 6.4 0 0 1-12.8 0C5.6 10 12 3.4 12 3.4z" />
    <path d="M8.6 14.4c1.1-.9 2.2-.9 3.4 0s2.2.9 3.4 0" />
  </svg>
);

/* NFT — a faceted gem. */
export const IconWalGem = (p) => (
  <svg {...base} width="17" height="17" {...p}>
    <path d="M7.2 4h9.6L20.4 9 12 20l-8.4-11z" />
    <path d="M3.6 9h16.8" />
    <path d="M8.9 9 12 20l3.1-11" />
    <path d="M7.2 4 8.9 9M16.8 4l-1.7 5" />
  </svg>
);

/* Trend — P&L and trading doors. Arrowhead makes direction unambiguous. */
export const IconWalTrend = (p) => (
  <svg {...base} width="17" height="17" {...p}>
    <path d="M4 17.2l5-5.4 3.4 2.9L18.8 8" />
    <path d="M14.3 8h4.5v4.5" />
    <path d="M4 20.5h16" opacity="0.45" />
  </svg>
);

/* Seed phrase — a key (it IS the master key; a "text lines" glyph lied). */
export const IconWalKey = (p) => (
  <svg {...base} width="16" height="16" {...p}>
    <circle cx="8" cy="15.5" r="4.5" />
    <path d="m11.3 12.2 8.6-8.6" />
    <path d="m16.4 7.1 3.1 3.1" />
  </svg>
);

/* Backup file — an archive box. */
export const IconWalArchive = (p) => (
  <svg {...base} width="16" height="16" {...p}>
    <rect x="3.5" y="4" width="17" height="4.2" rx="1.2" />
    <path d="M5.2 8.2v10.3a1.5 1.5 0 0 0 1.5 1.5h10.6a1.5 1.5 0 0 0 1.5-1.5V8.2" />
    <path d="M10 12.6h4" />
  </svg>
);

/* Change-chip direction — filled triangles, drawn large so they stay crisp
   at the 10px they render at. */
export const IconWalTriUp = (p) => (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true" focusable="false" {...p}>
    <path d="M12 5.5 19 17H5z" />
  </svg>
);

export const IconWalTriDown = (p) => (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true" focusable="false" {...p}>
    <path d="M12 18.5 5 7h14z" />
  </svg>
);

/**
 * WalIdenticon — a deterministic avatar grown from the address itself.
 * ---------------------------------------------------------------------------
 * Modern wallets (Phantom's gradient orb, MetaMask's jazzicon) give an
 * account a face so "am I looking at the right wallet?" is answered by
 * shape and colour before a single hex character is read. This is the
 * same idea, dependency-free: the address bytes pick two hues and the
 * positions of three soft discs over a diagonal gradient.
 *
 * Pure function of the address — same input, same face, on every render,
 * in both themes. No state, no randomness, nothing to flicker. Saturation
 * and lightness are pinned to the band that stays legible on the dark
 * hero and on the light one alike.
 */
export function WalIdenticon({ address = '', size = 34, className = '' }) {
  const gid = useId().replace(/[:]/g, '');
  const art = useMemo(() => {
    const hex = String(address).replace(/^0x/i, '');
    const byte = (i) => {
      const n = parseInt(hex.slice(i * 2, i * 2 + 2) || '0', 16);
      return Number.isFinite(n) ? n : 0;
    };
    const h1 = Math.round((byte(0) / 255) * 360);
    const h2 = (h1 + 55 + (byte(1) % 90)) % 360;
    const discs = [0, 1, 2].map((k) => ({
      cx: 12 + ((byte(2 + k * 2) % 13) - 6),
      cy: 12 + ((byte(3 + k * 2) % 13) - 6),
      r: 3.6 + (byte(8 + k) % 4),
      o: 0.34 - k * 0.08
    }));
    return { h1, h2, discs };
  }, [address]);

  return (
    <svg
      className={`walx-identicon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{ width: size, height: size, flexShrink: 0, display: 'block' }}
    >
      <defs>
        <linearGradient id={`walid-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`hsl(${art.h1} 82% 56%)`} />
          <stop offset="100%" stopColor={`hsl(${art.h2} 82% 46%)`} />
        </linearGradient>
        <clipPath id={`walidc-${gid}`}>
          <rect x="1" y="1" width="22" height="22" rx="7.5" />
        </clipPath>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="7.5" fill={`url(#walid-${gid})`} />
      <g clipPath={`url(#walidc-${gid})`}>
        {art.discs.map((d, i) => (
          <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill="#ffffff" opacity={d.o} />
        ))}
        <rect x="1" y="1" width="22" height="11" fill="#ffffff" opacity="0.10" />
      </g>
      <rect x="1" y="1" width="22" height="22" rx="7.5" fill="none" stroke="#ffffff" strokeOpacity="0.25" />
    </svg>
  );
}
