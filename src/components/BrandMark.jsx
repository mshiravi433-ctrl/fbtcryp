/**
 * THE BRAND COIN, drawn once.
 *
 * This used to live inside Header.jsx as a private component, and the second
 * place that needed the mark — the brand rail at the bottom of every screen
 * (2026-09-23: «وقتی اسکرین‌شات گرفته می‌شود لوگو و نام سایت پایین صفحه باشد»)
 * — would have had to copy it. Two copies of a logo is how a logo ends up
 * subtly different in two places, so the drawing lives here and both surfaces
 * render it.
 *
 * The coin is drawn STATIC inside the slowly-spinning gradient tile: it used to
 * flip edge-on (a 0→360° Y-axis spin) and vanished for the mirrored half of
 * every cycle, which read as broken («لوگو غیب می‌شه»). The tile keeps the
 * motion (that is `.brand-mark`'s CSS, owned by the header); the coin never
 * leaves view. `transformBox: fill-box` pins the origin to the drawing itself so
 * no browser can rotate it around a view-box corner and swing it sideways.
 *
 * `gradientId` is a prop because an SVG gradient is referenced BY ID: two marks
 * on the same screen sharing one id would both resolve to the first one in the
 * document. Same colours, so it would not look wrong — until the day somebody
 * changes one of them.
 */

import { BRAND_GRADIENT } from '../lib/brand';

export default function BrandMark({ size = 17, gradientId = 'brandGrad', className = 'brand-mark', strokeWidth = 2 }) {
  return (
    <div className={className}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ position: 'relative', zIndex: 2, transformBox: 'fill-box', transformOrigin: '50% 50%' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={BRAND_GRADIENT[0]} />
            <stop offset="50%" stopColor={BRAND_GRADIENT[1]} />
            <stop offset="100%" stopColor={BRAND_GRADIENT[2]} />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="9.2" stroke={`url(#${gradientId})`} strokeWidth="2.1" />
        <path d="M8.4 10.6a3.8 3.8 0 0 1 6.5-1.4" stroke={`url(#${gradientId})`} />
        <path d="M15.6 13.4a3.8 3.8 0 0 1-6.5 1.4" stroke={`url(#${gradientId})`} />
        <path d="M14.6 6.6v2.9h-2.9" stroke={`url(#${gradientId})`} />
        <path d="M9.4 17.4v-2.9h2.9" stroke={`url(#${gradientId})`} />
      </svg>
    </div>
  );
}

/* The standalone SVG form of this mark (for a <canvas>, which cannot render a
   component) lives beside the colours and the name in `lib/brand.js`, so the
   DOM drawing and the image drawing cannot drift apart. */
