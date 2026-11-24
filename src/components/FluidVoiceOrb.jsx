import { useEffect, useRef } from 'react';

const DOT_COUNT = 260;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Precompute unit-sphere Fibonacci lattice points once at module load.
 * Gives even halftone-like spacing with zero polar clumping and zero
 * per-frame allocations.
 */
const BASE_X = new Float32Array(DOT_COUNT);
const BASE_Y = new Float32Array(DOT_COUNT);
const BASE_Z = new Float32Array(DOT_COUNT);

for (let i = 0; i < DOT_COUNT; i += 1) {
  const y = 1 - (i / (DOT_COUNT - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * i;
  BASE_X[i] = Math.cos(theta) * r;
  BASE_Y[i] = y;
  BASE_Z[i] = Math.sin(theta) * r;
}

/**
 * Lightweight 3D fluid dotted orb rendered on a 2D canvas.
 * Designed for a 50–56px button: ~0.2ms/frame, pauses when tab is hidden,
 * and renders a single static frame under prefers-reduced-motion.
 *
 * variant:
 *  - 'purple': deep dark purple / magenta / pink-gold AI voice orb
 *  - 'rgb': smoothly cycling full-spectrum RGB fluid orb
 */
export default function FluidVoiceOrb({ size = 56, active = false, variant = 'purple' }) {
  const canvasRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const variantRef = useRef(variant);
  variantRef.current = variant;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;

    const cx = px * 0.5;
    const cy = px * 0.5;
    const baseRadius = px * 0.38;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    let time = 0;
    let lastTs = 0;

    // Scratch arrays for two-pass (back then front) rendering without allocations
    const projX = new Float32Array(DOT_COUNT);
    const projY = new Float32Array(DOT_COUNT);
    const projZ = new Float32Array(DOT_COUNT);
    const projR = new Float32Array(DOT_COUNT);
    const projCrest = new Float32Array(DOT_COUNT);
    const projLat = new Float32Array(DOT_COUNT);

    const drawFrame = (t) => {
      ctx.clearRect(0, 0, px, px);

      // Deep dark purple velvet interior
      const bgGrad = ctx.createRadialGradient(
        cx - px * 0.1,
        cy - px * 0.14,
        px * 0.04,
        cx,
        cy,
        px * 0.5
      );
      bgGrad.addColorStop(0, '#2a0944');
      bgGrad.addColorStop(0.55, '#140424');
      bgGrad.addColorStop(1, '#0a0214');
      ctx.fillStyle = bgGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, px * 0.5, 0, Math.PI * 2);
      ctx.fill();

      const rotY = t * 0.42;
      const rotX = Math.sin(t * 0.28) * 0.32 + 0.18;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      const waveAmp = activeRef.current ? 0.19 : 0.15;

      for (let i = 0; i < DOT_COUNT; i += 1) {
        const bx = BASE_X[i];
        const by = BASE_Y[i];
        const bz = BASE_Z[i];

        // Organic 3D fluid harmonic waves
        const w1 = Math.sin(bx * 2.6 + t * 1.45) * Math.cos(by * 2.3 - t * 1.05);
        const w2 = Math.sin(by * 3.1 + bz * 2.4 + t * 1.85);
        const w3 = Math.cos(bz * 2.8 - bx * 2.5 + t * 1.2);
        const disp = (w1 * 0.52 + w2 * 0.3 + w3 * 0.18);
        const radius = 1 + disp * waveAmp;

        const x0 = bx * radius;
        const y0 = by * radius;
        const z0 = bz * radius;

        // Rotate around Y then X
        const x1 = x0 * cosY - z0 * sinY;
        const z1 = x0 * sinY + z0 * cosY;
        const y2 = y0 * cosX - z1 * sinX;
        const z2 = y0 * sinX + z1 * cosX;

        // Subtle perspective projection
        const persp = 2.6 / (2.6 - z2 * 0.55);
        projX[i] = cx + x1 * baseRadius * persp;
        projY[i] = cy - y2 * baseRadius * persp;
        projZ[i] = z2;
        projCrest[i] = Math.min(1, Math.max(0, (disp + 0.85) * 0.58));
        projLat[i] = y2; // +1 top, -1 bottom
        projR[i] = Math.max(0.45, (0.55 + (z2 + 1) * 0.38 + projCrest[i] * 0.25) * dpr);
      }

      // Pass 0: back hemisphere (z < 0), Pass 1: front hemisphere (z >= 0)
      const isRgb = variantRef.current === 'rgb';
      const hueBase = t * 0.55;

      for (let pass = 0; pass < 2; pass += 1) {
        const isFront = pass === 1;
        for (let i = 0; i < DOT_COUNT; i += 1) {
          const z = projZ[i];
          if (isFront ? z < 0 : z >= 0) continue;

          const depth = Math.min(1, Math.max(0, (z + 1.15) / 2.3));
          const crest = projCrest[i];
          const lat = projLat[i]; // +1 top, -1 bottom

          let r;
          let g;
          let b;

          if (isRgb) {
            // Smoothly cycling full-spectrum RGB across the fluid surface
            const phase = hueBase + lat * 1.15 + crest * 0.85;
            const boost = 0.55 + crest * 0.45;
            r = (128 + Math.sin(phase) * 124) * boost + crest * 36;
            g = (128 + Math.sin(phase + 2.094) * 124) * boost + crest * 36;
            b = (128 + Math.sin(phase + 4.188) * 124) * boost + crest * 36;
          } else if (lat < -0.15) {
            // Lower violet-blue to deep purple
            const k = Math.min(1, Math.max(0, (lat + 1) / 0.85));
            r = 82 + k * 76 + crest * 42;
            g = 68 - k * 24 + crest * 22;
            b = 220 - k * 14 + crest * 20;
          } else {
            // Mid purple -> electric magenta -> warm peach/gold crest
            const topMix = Math.min(1, Math.max(0, (lat + 0.15) / 1.15));
            const hi = Math.pow(Math.max(0, crest * 0.65 + topMix * 0.45), 2.1);
            r = 158 + topMix * 78 + hi * 35;
            g = 34 + topMix * 32 + hi * 150;
            b = 204 - topMix * 42 + hi * 10;
          }

          const alpha = isFront
            ? Math.min(1, 0.35 + depth * 0.65)
            : Math.max(0.12, depth * 0.42);

          ctx.fillStyle = `rgba(${Math.min(255, Math.max(0, r | 0))},${Math.min(255, Math.max(0, g | 0))},${Math.min(255, Math.max(0, b | 0))},${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(projX[i], projY[i], projR[i], 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    if (reducedMotion) {
      drawFrame(0.8);
      return undefined;
    }

    const tick = (ts) => {
      if (!document.hidden) {
        const dt = lastTs ? Math.min(0.05, (ts - lastTs) * 0.001) : 0.016;
        lastTs = ts;
        time += dt * (activeRef.current ? 1.45 : 1.0);
        drawFrame(time);
      } else {
        lastTs = 0;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      className="fluid-voice-orb"
      width={size}
      height={size}
      aria-hidden="true"
    />
  );
}
