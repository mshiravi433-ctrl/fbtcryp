/* ==========================================================================
   fx.js — the canvas cinematography toolkit
   --------------------------------------------------------------------------
   Everything the film draws is DERIVED FROM TIME, never from frame counting,
   so a frame rendered twice is pixel-identical and scenes can be re-rendered
   in isolation. No `Date.now()`, no `Math.random()` at draw time (seeded RNG
   only), no state carried between frames.

   Performance rules learned the hard way at 4K on two cores:
     · pre-rendered glow sprites instead of per-frame radial gradients
     · `lighter` compositing instead of shadowBlur (which rasterises per draw)
     · gradients cached by string key
     · bokeh-by-sprite for depth of field: far things are drawn as bigger,
       dimmer, softer sprites — cheaper and calmer than a real blur pass
   ========================================================================== */

/* ── math ─────────────────────────────────────────────────────────────── */
export const TAU = Math.PI * 2;
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const inv = (v, a, b) => clamp((v - a) / (b - a || 1));
export const smooth = (t) => { const x = clamp(t); return x * x * (3 - 2 * x); };
export const smoother = (t) => { const x = clamp(t); return x * x * x * (x * (x * 6 - 15) + 10); };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInOut = (t) => (clamp(t) < 0.5 ? 4 * clamp(t) ** 3 : 1 - Math.pow(-2 * clamp(t) + 2, 3) / 2);
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1, x = clamp(t) - 1; return 1 + c3 * x ** 3 + c1 * x ** 2; };
export const pulse = (t, speed = 1) => 0.5 + 0.5 * Math.sin(t * TAU * speed);

/** Seeded PRNG — same seed, same film, every render. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Keyframe track: kf(seconds, [[t, value], [t, value], ...]) */
export function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t >= t0 && t <= t1) return lerp(v0, v1, smooth((t - t0) / (t1 - t0 || 1)));
  }
  return last[1];
}

/** Windowed reveal: 0 before, 0→1 across the window, 1 after (with optional ease). */
export function ramp(t, t0, t1) { return smooth(inv(t, t0, t1)); }
export function band(t, t0, t1, fade = 0.6) {
  return Math.min(ramp(t, t0, t0 + fade), 1 - ramp(t, t1 - fade, t1));
}

/* ── cached gradients & glow sprites ──────────────────────────────────── */
const gradCache = new Map();
function radial(ctx, x, y, r, stops) {
  const key = `${x | 0},${y | 0},${r | 0},${stops.map((s) => s[0] + s[1]).join('|')}`;
  let g = gradCache.get(key);
  if (!g) {
    g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, c] of stops) g.addColorStop(o, c);
    gradCache.set(key, g);
  }
  return g;
}
function linear(ctx, x0, y0, x1, y1, stops) {
  const key = `l${x0 | 0},${y0 | 0},${x1 | 0},${y1 | 0},${stops.map((s) => s[0] + s[1]).join('|')}`;
  let g = gradCache.get(key);
  if (!g) {
    g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [o, c] of stops) g.addColorStop(o, c);
    gradCache.set(key, g);
  }
  return g;
}

const SPRITE_CACHE = new Map();
/** Soft round glow sprite (white) — tinted at draw time with `globalAlpha` + colour. */
export function sprite(color, softness = 0.5) {
  const key = `${color}|${softness}`;
  let s = SPRITE_CACHE.get(key);
  if (s) return s;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(softness * 0.5, color.replace(/[\d.]+\)$/, '0.35)'));
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  SPRITE_CACHE.set(key, c);
  return c;
}

export function drawSprite(ctx, spr, x, y, r, alpha) {
  if (alpha <= 0.004) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = prev;
}

export function addBlend(ctx, on = true) { ctx.globalCompositeOperation = on ? 'lighter' : 'source-over'; }

/* ── camera & projection (right-handed, +z into the screen) ───────────── */
export function camera({ px = 0, py = 0, pz = 0, yaw = 0, pitch = 0, roll = 0, fov = 46, w = 1920, h = 1080 } = {}) {
  return { px, py, pz, yaw, pitch, roll, fov, w, h, focal: (h / 2) / Math.tan((fov * Math.PI) / 360) };
}

/** world → screen. Returns null when behind the lens. */
export function project(cam, p) {
  const dx = p.x - cam.px, dy = p.y - cam.py, dz = p.z - cam.pz;
  const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
  let x = dx * cy - dz * sy;
  let z = dx * sy + dz * cy;
  const cp = Math.cos(-cam.pitch), sp = Math.sin(-cam.pitch);
  let y = dy * cp - z * sp;
  z = dy * sp + z * cp;
  if (cam.roll) {
    const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
    const x2 = x * cr - y * sr; y = x * sr + y * cr; x = x2;
  }
  if (z < 0.35) return null;
  const s = cam.focal / z;
  return { x: cam.w / 2 + x * s, y: cam.h / 2 + y * s, s, z, dof: z };
}

/* ── drawing primitives ───────────────────────────────────────────────── */
export function orb(ctx, x, y, r, color = 'rgba(120,180,255,1)', alpha = 1) {
  drawSprite(ctx, sprite(color, 0.42), x, y, r, alpha);
}

export function line(ctx, x0, y0, x1, y1, color, width = 1, alpha = 1) {
  if (alpha <= 0.004) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.globalAlpha = 1;
}

export function path(ctx, pts, { color = '#5aa9ff', width = 1, alpha = 1, close = false, dash = null, glow = 0 } = {}) {
  if (pts.length < 2 || alpha <= 0.004) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  if (glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (close) ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function text(ctx, str, x, y, {
  size = 16, weight = 500, family = "'Inter'", color = '#e8eeff', alpha = 1,
  align = 'left', baseline = 'alphabetic', ls = '0px', blur = 0, maxWidth = null
} = {}) {
  if (alpha <= 0.004) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${family}`;
  try { ctx.letterSpacing = ls; } catch { /* older engines: ignore */ }
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (blur > 0) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
  if (maxWidth) ctx.fillText(str, x, y, maxWidth); else ctx.fillText(str, x, y);
  ctx.restore();
}

/** A rectangle with an optional 1px hairline border — used for panels on canvas. */
export function panel(ctx, x, y, w, h, { fill = 'rgba(9,15,27,0.9)', stroke = 'rgba(255,255,255,0.10)', radius = 14, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, x, y, w, h, radius);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ── data-viz bits used inside UI panels (canvas-rendered, crisp) ─────── */
export function sparkline(ctx, x, y, w, h, data, { color = '#4d9bff', fill = 'rgba(47,125,255,0.16)', width = 2, alpha = 1, dot = true, glow = 0 } = {}) {
  const n = data.length;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => ({ x: x + (i / (n - 1)) * w, y: y + h - ((v - min) / span) * h }));
  if (fill) {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, y + h);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts[n - 1].x, y + h); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  }
  path(ctx, pts, { color, width, alpha, glow, });
  if (dot) {
    const last = pts[n - 1];
    addBlend(ctx, true);
    orb(ctx, last.x, last.y, 26, 'rgba(120,190,255,0.55)', alpha);
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(last.x, last.y, width * 1.35, 0, TAU); ctx.fill(); ctx.restore();
    addBlend(ctx, false);
  }
  return pts;
}

export function candles(ctx, x, y, w, h, rows, { up = '#46d9a8', down = '#ff5f78', alpha = 1 } = {}) {
  const n = rows.length, cw = w / n;
  ctx.save(); ctx.globalAlpha = alpha;
  rows.forEach((r, i) => {
    const min = Math.min(...rows.map((d) => d.l)), max = Math.max(...rows.map((d) => d.h));
    const span = max - min || 1;
    const py = (v) => y + h - ((v - min) / span) * h;
    const cx = x + i * cw + cw / 2;
    const bull = r.c >= r.o;
    ctx.strokeStyle = bull ? up : down;
    ctx.fillStyle = bull ? up : down;
    ctx.globalAlpha = alpha * 0.85;
    ctx.lineWidth = Math.max(1, cw * 0.12);
    ctx.beginPath(); ctx.moveTo(cx, py(r.h)); ctx.lineTo(cx, py(r.l)); ctx.stroke();
    ctx.globalAlpha = alpha;
    const yo = py(r.o), yc = py(r.c);
    ctx.fillRect(cx - cw * 0.28, Math.min(yo, yc), cw * 0.56, Math.max(1.5, Math.abs(yc - yo)));
  });
  ctx.restore();
}

/** Deterministic market series that never repeats visually but is stable per seed. */
export function series(seed, n, { drift = 0, vol = 1, base = 100 } = {}) {
  const r = rng(seed);
  const out = []; let v = base;
  for (let i = 0; i < n; i++) {
    v += (r() - 0.5) * vol + drift;
    out.push(v);
  }
  return out;
}

/** Candle rows derived from a smooth ramp so the chart reads as one market. */
export function candleRows(seed, n, { base = 100, vol = 1.6, drift = 0.35 } = {}) {
  const s = series(seed, n, { drift, vol, base });
  return s.map((c, i) => {
    const o = i === 0 ? c : s[i - 1];
    const hi = Math.max(o, c) + vol * 0.4 * ((i % 5) / 4 + 0.3);
    const lo = Math.min(o, c) - vol * 0.4 * (((i + 2) % 7) / 6 + 0.3);
    return { o, c, h: hi, l: lo };
  });
}

/* ── atmosphere ───────────────────────────────────────────────────────── */
/**
 * Volumetric dust. Returns nothing; draws soft particles with depth-of-field
 * falloff around the camera's focus distance.
 */
export function dustField(ctx, cam, t, { count = 220, seed = 7, spread = 900, focus = 1200, near = 0.5, far = 2.6, color = 'rgba(150,200,255,1)', size = 10 } = {}) {
  const r = rng(seed);
  const spr = sprite(color, 0.5);
  addBlend(ctx, true);
  for (let i = 0; i < count; i++) {
    const bx = (r() - 0.5) * spread * 2;
    const by = (r() - 0.5) * spread * 1.1;
    const bz = r() * 2600;
    const z = ((bz + t * 26 * (0.4 + r() * 0.8)) % 2600);
    const p = project(cam, { x: bx + Math.sin(t * 0.05 + i) * 30, y: by + Math.cos(t * 0.04 + i * 1.7) * 24, z: cam.pz + z + 60 });
    if (!p) continue;
    const dof = clamp(Math.abs(z - focus) / 1400, 0, 1);
    const rad = (size * (1 + dof * 2.4)) * clamp(p.s * 220, 0.22, 3.2);
    const a = (0.05 + 0.16 * (1 - dof)) * (1 - clamp((z - 2200) / 700, 0, 1));
    drawSprite(ctx, spr, p.x, p.y, rad, a * 0.9);
  }
  addBlend(ctx, false);
}

/* ── the room ─────────────────────────────────────────────────────────── */
/**
 * Every scene sits in the same graded room: a vertical fall from deep navy to
 * near-black, one wide key light above the subject, and a corner vignette.
 *
 * This lives on the CANVAS, not on a DOM background layer, for a structural
 * reason: the canvas sits behind the scene DOM, so an opaque DOM background
 * would erase every particle, graph and lattice drawn under it. One room,
 * painted in one place, means the interface can float over the light.
 */
export function room(ctx, {
  w = 1920, h = 1080, t = 0,
  key = 'rgba(30,66,132,0.55)',        // wide key light above the subject
  keyX = 0.5, keyY = -0.02, keyR = 1.05,
  top = 'rgba(7,12,24,1)', bottom = 'rgba(2,4,9,1)',
  accent = 'rgba(70,52,140,0.30)', accentX = 0.12, accentY = 1.02, accentR = 0.62,
  breathe = 0.04
} = {}) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(0.55, bottom);
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const k = ctx.createRadialGradient(w * keyX, h * keyY, 0, w * keyX, h * keyY, h * keyR);
  const kk = 1 + breathe * Math.sin(t * 0.35);
  k.addColorStop(0, key.replace(/[\d.]+\)$/, (0.9 * kk).toFixed(3) + ')'));
  k.addColorStop(0.45, key.replace(/[\d.]+\)$/, (0.32 * kk).toFixed(3) + ')'));
  k.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = k;
  ctx.fillRect(0, 0, w, h);

  if (accent) {
    const a = ctx.createRadialGradient(w * accentX, h * accentY, 0, w * accentX, h * accentY, h * accentR);
    a.addColorStop(0, accent);
    a.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, h);
  }

  // corner fall-off — the cheap, always-on lens vignette
  const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.34, w / 2, h / 2, h * 1.02);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}
