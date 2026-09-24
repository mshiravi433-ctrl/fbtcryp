/**
 * THE BRAND, stated once.
 *
 * «باید مدرن باشد و سایت را درست معرفی کند» — the requirement behind the brand
 * rail (2026-09-23) is that every screenshot of this app names the app and its
 * address correctly. "Correctly" is the part that has bitten this codebase
 * before: a stale `VITE_PUBLIC_URL` left over from an earlier project made
 * Phantom show `lawpoetics.ir` as the app's identity while every fallback in
 * source said `fbtswap.ir` (see the comment in `lib/nativeShell.js`).
 *
 * So nothing here spells a domain. The one shown on screen — and the one drawn
 * into a shared image — comes from `publicAppUrl()`, which already rejects any
 * configured origin that is not the canonical host. A brand line that could
 * state the wrong address is worse than no brand line at all.
 *
 * This module is deliberately React-free: the canvas that composites a shared
 * screenshot needs the same mark and the same words as the DOM component that
 * draws them, and a `.jsx` import would drag the JSX runtime into a plain
 * library chunk.
 */
import { publicAppUrl } from './nativeShell';

/** The name, exactly as the header has always written it. */
export const BRAND_NAME = 'FBT Swap';

/** The three brand stops, in the order the coin and the hairline draw them. */
export const BRAND_GRADIENT = Object.freeze(['#00e5ff', '#7c4dff', '#ff2d95']);

/**
 * The address the brand states: the canonical host, without a scheme.
 *
 * Derived, never literal — `https://` in a 30px rail is 8 characters of noise,
 * and a hard-coded host is a second source of truth about who we are.
 */
export function brandDomain() {
  try {
    return new URL(publicAppUrl('/')).host.replace(/^www\./i, '');
  } catch {
    return 'fbtswap.ir';
  }
}

/** The link a shared screenshot points at: this screen, on the canonical host. */
export function brandShareUrl(path = '/') {
  return publicAppUrl(path);
}

/**
 * The coin as standalone SVG markup, for a surface that is not the DOM.
 *
 * `components/BrandMark.jsx` draws the same paths as React; a <canvas> cannot
 * render a component, but it can `drawImage` an SVG data URL — and a data URL
 * is same-origin, so it does not taint the canvas the way a fetched image would.
 */
export function brandMarkSvg({ size = 64 } = {}) {
  const [a, b, c] = BRAND_GRADIENT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0%" stop-color="${a}"/><stop offset="50%" stop-color="${b}"/><stop offset="100%" stop-color="${c}"/>`
    + `</linearGradient></defs>`
    + `<circle cx="12" cy="12" r="9.2" stroke="url(#g)" stroke-width="2.1"/>`
    + `<path d="M8.4 10.6a3.8 3.8 0 0 1 6.5-1.4" stroke="url(#g)" stroke-width="2"/>`
    + `<path d="M15.6 13.4a3.8 3.8 0 0 1-6.5 1.4" stroke="url(#g)" stroke-width="2"/>`
    + `<path d="M14.6 6.6v2.9h-2.9" stroke="url(#g)" stroke-width="2"/>`
    + `<path d="M9.4 17.4v-2.9h2.9" stroke="url(#g)" stroke-width="2"/>`
    + `</svg>`;
}

/** A data URL of the coin, ready for `ctx.drawImage`. */
export function brandMarkDataUrl({ size = 64 } = {}) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(brandMarkSvg({ size }))}`;
}

/** A filename that says what it is and when it was taken. */
export function screenshotFilename({ screen = 'screen', now = Date.now() } = {}) {
  const safe = String(screen).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'screen';
  return `fbtswap-${safe.toLowerCase()}-${new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
}
