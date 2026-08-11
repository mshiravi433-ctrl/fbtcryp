/**
 * WALLET ARTWORK — inline SVG, no runtime cost.
 * ---------------------------------------------------------------------------
 * Requested: a distinctive wallet screen «مثل والت جذاب باشد», built with SVG,
 * modern-looking, and without hurting speed or introducing bugs.
 *
 * ─── WHY INLINE SVG AND NOT AN IMAGE FILE ───────────────────────────────────
 * A PNG or a Lottie file would be a second network request on the screen
 * people open most, and neither can follow the theme. These paths inherit
 * `currentColor` and the CSS custom properties, so light mode, dark mode and
 * the accent palette all work with no extra assets and no JavaScript.
 *
 * Total cost: a few hundred bytes of markup, parsed once, painted once.
 *
 * ─── WHY NOTHING HERE ANIMATES BY DEFAULT ───────────────────────────────────
 * A wallet screen shows a number people are trying to read. Continuous motion
 * behind a balance makes it harder to read and keeps the compositor awake for
 * as long as the screen is open — on a phone that is measurable battery for
 * decoration nobody asked for.
 *
 * The only motion is the 7px connection dot in the header, which conveys
 * state rather than decorating.
 */

/**
 * The mesh behind the balance.
 *
 * A perspective grid receding to a vanishing point — the shape a "network"
 * has when drawn honestly, and a deliberate reference to the fact that this
 * wallet spans eight chains rather than one.
 *
 * Drawn as a handful of straight lines rather than a repeating CSS gradient
 * because a gradient cannot converge: parallel lines read as a floor tile,
 * converging ones read as depth.
 */
export function WalletMesh() {
  /*
   * Generated rather than hand-written: twelve hand-typed <line> elements is
   * twelve chances for a wrong coordinate, and the loop makes the spacing
   * provably even.
   */
  const verticals = Array.from({ length: 9 }, (_, i) => {
    const x = (i / 8) * 320;
    // All verticals meet at the vanishing point, which is what creates the
    // sense of a plane rather than a fence.
    return <line key={`v${i}`} x1={x} y1="0" x2={160} y2="150" />;
  });

  const horizontals = Array.from({ length: 5 }, (_, i) => {
    /*
     * Exponential spacing, not linear. Evenly-spaced horizontals on a
     * perspective grid look wrong for the same reason evenly-spaced sleepers
     * do on a photographed railway — distance compresses them.
     */
    const t = (i + 1) / 6;
    const y = 150 * (1 - (1 - t) ** 2);
    return <line key={`h${i}`} x1="0" y1={y} x2="320" y2={y} />;
  });

  return (
    <svg
      className="wal-mesh"
      viewBox="0 0 320 150"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/*
          The fade is part of the drawing, not a CSS mask on the parent: a
          mask on the panel would also clip the balance text sitting above it.
        */}
        <linearGradient id="wal-mesh-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="url(#wal-mesh-fade)" strokeWidth="0.6" fill="none">
        {verticals}
        {horizontals}
      </g>
    </svg>
  );
}

/**
 * Icons for the two things a wallet is for.
 *
 * Kept here rather than in components/Icons.jsx because they are drawn at a
 * specific weight to match this panel — the shared set is stroked at 2 for
 * 21px nav use, and the same paths look coarse at 20px inside a filled tile.
 */
export function IconReceive(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {/* Tray with arrow — more detail: double line tray for depth */}
      <path d="M12 4v10" />
      <path d="M8 10.5 12 14.5 16 10.5" />
      <path d="M4.5 17v1.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V17" />
      <path d="M6 17h12" opacity="0.35" />
      {/* Sparkle for attractiveness */}
      <path d="M19 5l0.7 0.7L19 6.5l-0.7-0.7L19 5z" fill="currentColor" stroke="none" opacity="0.9" />
    </svg>
  );
}

export function IconSend(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 20V10" />
      <path d="M8 13.5 12 9.5 16 13.5" />
      <path d="M4.5 7V5.5A1.5 1.5 0 0 1 6 4h12a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6 7h12" opacity="0.35" />
      <path d="M19 18l0.7 0.7L19 19.5l-0.7-0.7L19 18z" fill="currentColor" stroke="none" opacity="0.9" />
    </svg>
  );
}

/**
 * The empty-state mark: a wallet whose flap is open and empty.
 *
 * Two overlapping rounded rectangles with a card lifting out. It says "there
 * is nothing in here yet" without a text label, which matters because this is
 * the first thing a new user sees and it is shown before they have read
 * anything.
 */
export function WalletEmptyMark() {
  return (
    <svg viewBox="0 0 64 64" width="52" height="52" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="wal-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--rgb-1)" />
          <stop offset="100%" stopColor="var(--rgb-2)" />
        </linearGradient>
      </defs>

      {/* the card, lifting out and tilted */}
      <rect
        x="18" y="8" width="30" height="19" rx="4"
        fill="none" stroke="url(#wal-mark-g)" strokeWidth="2" opacity="0.55"
        transform="rotate(-12 33 17)"
      />

      {/* the wallet body */}
      <rect x="8" y="22" width="48" height="34" rx="9" fill="none" stroke="url(#wal-mark-g)" strokeWidth="2.2" />

      {/* the clasp — a filled dot reads as hardware where an outline reads as
          another empty box */}
      <path d="M44 33h10v10H44a5 5 0 0 1 0-10Z" fill="none" stroke="url(#wal-mark-g)" strokeWidth="2.2" />
      <circle cx="47.5" cy="38" r="1.9" fill="url(#wal-mark-g)" />
    </svg>
  );
}
