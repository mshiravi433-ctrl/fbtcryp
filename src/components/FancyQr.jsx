/*
 * FANCY QR — the one QR surface every receive screen shares.
 * ---------------------------------------------------------------------------
 * Requested as «کیو‌آر کد دریافت قشنگ‌تر باشد ظاهرش و ظاهر کیو‌آر کد سولانا —
 * یک چیز فوق‌العاده و خاص»: the receive QR on the main wallet AND the Solana
 * wallet should look extraordinary, and they should look like siblings.
 *
 * Before this file the code was generated three separate times (ReceiveSheet's
 * EVM QR, its Bitcoin QR, and SolanaWalletHome's QR), each a bare black square
 * on a white card. One component now owns the matrix encoding and the stage
 * around it, so the "special" look cannot drift between the three.
 *
 * ─── WHAT IS ALLOWED TO BE CREATIVE, AND WHAT IS NOT ────────────────────────
 * The DECODABLE SURFACE is deliberately boring:
 *   — the matrix is painted as one <path> of unit squares (`M{x} {y}h1v1h-1z`),
 *     exactly the format test/inapp-wallet-receive.test.jsx parses and pushes
 *     through jsQR. A QR that decodes to the wrong characters is not a
 *     cosmetic bug — it is a deposit to an address nobody controls.
 *   — the modules stay DARK on a WHITE plate in both themes (scanners sample
 *     dark-on-light; a themed invert fails real cameras).
 *   — nothing decorative ever covers the matrix. The medallion overlaps only
 *     the white QUIET-ZONE padding at the top edge, never a module.
 *   — the ink is a very dark gradient (#0b1224 → #231247 range, contrast
 *     against white far above the 7:1 scanners need) with a thin rounded
 *     stroke that softens the module corners into a modern dotted look. The
 *     stroke GROWS each module by half its width and rounds the joins, so the
 *     centres scanners sample are unchanged; test/fancy-qr.test.jsx decodes
 *     the painted surface WITH that inflation and asserts it still round-trips.
 *
 * Everything else — the aurora halo, the rotating energy ring, the viewfinder
 * brackets, the scan beam and the chain medallion — lives outside the plate
 * (or at 0.1-alpha over it) and is `aria-hidden`. Under `prefers-reduced-motion`
 * every animation is off; the frame is still beautiful, just still.
 *
 * ─── WHY A LIBRARY AND NOT A HAND-ROLLED ENCODER ────────────────────────────
 * QR encoding is Reed-Solomon error correction plus a masking pass. A subtly
 * wrong implementation still produces a scannable square — it just decodes to
 * different characters. This uses the tested `qrcode-generator` encoder the
 * app already shipped, and the output is verified against our own scanner's
 * parser in the test suite.
 */
import { useId, useMemo } from 'react';
import qrcode from 'qrcode-generator';
import '../styles/fancy-qr.css';

/**
 * Encode `text` into a paintable matrix. Pure and exported so the tests (and
 * any future surface) encode through the SAME function this component paints.
 *
 * `errorLevel` stays 'M' (~15% recovery): high enough for a scratched screen
 * and the rounded-stroke styling, low enough to keep the modules large and
 * easy to focus on.
 */
export function qrMatrix(text, errorLevel = 'M') {
  if (!text) return null;
  try {
    const q = qrcode(0, errorLevel);
    q.addData(String(text));
    q.make();
    const count = q.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) {
        if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { d, count };
  } catch {
    // Never let a rendering problem hide the address itself — the text the
    // caller renders below the stage is the authoritative copy anyway.
    return null;
  }
}

/**
 * @param {string} value      the address / payload to encode.
 * @param {string} label      accessible name of the QR image.
 * @param {string} className  extra classes on the WHITE plate (the test hooks
 *                            like `recv-qr` live here — the plate is what the
 *                            scanner must read).
 * @param {string[]} accent   [a, b, c] frame gradient stops (chain/brand mood).
 * @param {import('react').ReactNode} badge medallion content (brand coin,
 *                            BTC glyph, Solana mark…) — sits on the top edge,
 *                            in the quiet zone only.
 * @param {boolean} compact   small variant for secondary QRs (the BTC leg).
 */
export default function FancyQr({
  value,
  label,
  className = '',
  accent = ['#00e5ff', '#7c4dff', '#00ff9d'],
  badge = null,
  compact = false
}) {
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const matrix = useMemo(() => qrMatrix(value), [value]);
  if (!matrix) return null;

  return (
    <div
      className={`fqr-stage ${compact ? 'fqr-compact' : ''}`}
      style={{ '--fqr-a': accent[0], '--fqr-b': accent[1], '--fqr-c': accent[2] }}
    >
      {/* Aurora halo — blurred accent clouds behind the plate. */}
      <div className="fqr-halo" aria-hidden="true" />

      <div className="fqr-frame">
        {/* The energy ring: a conic accent gradient sliding around the plate's
            edge (the opaque plate covers its middle, so only the rim shows). */}
        <div className="fqr-ring" aria-hidden="true" />

        {/* Scanner-HUD brackets, one per corner. */}
        <div className="fqr-brackets" aria-hidden="true">
          <i /><i /><i /><i />
        </div>

        {/* THE DECODABLE PLATE — dark modules, white field, quiet zone. */}
        <div className={`fqr-plate ${className}`}>
          {/*
            viewBox is padded past the module grid by ~⅓ module so the rounded
            stroke on the edge modules is not clipped. The matrix `d` itself is
            untouched — that string is what the tests decode.
          */}
          <svg
            viewBox={`-0.35 -0.35 ${matrix.count + 0.7} ${matrix.count + 0.7}`}
            role="img"
            aria-label={label}
          >
            <defs>
              {/* Near-black ink with just enough chroma to read as designed.
                  Both fill AND stroke use it: the stroke (rounded joins)
                  puffs each square into a soft-edged module. */}
              <linearGradient id={`fqrInk${gid}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#0b1224" />
                <stop offset="55%" stopColor="#131a3a" />
                <stop offset="100%" stopColor="#231247" />
              </linearGradient>
            </defs>
            <path
              d={matrix.d}
              fill={`url(#fqrInk${gid})`}
              stroke={`url(#fqrInk${gid})`}
              strokeWidth="0.2"
              strokeLinejoin="round"
              shapeRendering="geometricPrecision"
            />
          </svg>

          {/* Scan light sweeping the plate — decorative, low-alpha, and off
              entirely for reduced motion. */}
          <div className="fqr-beam" aria-hidden="true" />
        </div>
      </div>

      {/* Chain/brand medallion on the top edge — inside the quiet-zone band
          only, so not one module is ever covered. */}
      {badge ? <div className="fqr-badge" aria-hidden="true">{badge}</div> : null}
    </div>
  );
}
