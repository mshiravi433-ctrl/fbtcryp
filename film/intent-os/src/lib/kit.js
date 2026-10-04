/* ==========================================================================
   kit.js — shared cinematic set pieces
   --------------------------------------------------------------------------
   These are the "sets" the film keeps returning to: the financial data field,
   the orbital market ring, the blockchain volume, the node graph, the engine
   vortex. They are written once so a match cut between them is genuinely the
   same geometry seen from a new angle — that is what makes a cut feel like a
   camera move instead of a slide change.
   ========================================================================== */
import {
  TAU, lerp, clamp, inv, smooth, easeOut, rng, sprite, drawSprite, addBlend,
  project, camera, orb, line, path, text, panel, roundRect, sparkline, candleRows, series
} from './fx.js';

/* ── 01 · the financial data field ────────────────────────────────────── */
/**
 * Thousands of financial events as a volume of light: each particle is one
 * event travelling toward the lens. Streams of the same colour are one market.
 */
export function dataField(ctx, cam, t, { count = 2600, spread = 1500, depth = 4200, color = 'rgba(120,178,255,1)' } = {}) {
  const r = rng(11);
  const spr = sprite(color, 0.5);
  const spr2 = sprite('rgba(160,120,255,1)', 0.5);
  addBlend(ctx, true);
  for (let i = 0; i < count; i++) {
    const lane = i % 7;
    const lx = (r() - 0.5) * spread;
    const ly = (r() - 0.5) * spread * 0.62;
    const speed = 120 + (i % 5) * 55;
    const z0 = ((r() * depth) + t * speed) % depth;
    const wob = Math.sin(t * (0.4 + lane * 0.05) + i * 0.7) * 26;
    const p = project(cam, { x: lx + wob, y: ly + Math.cos(t * 0.3 + i) * 14, z: z0 });
    if (!p) continue;
    const near = 1 - z0 / depth;
    const rad = clamp(2.6 * p.s * 260 * (0.35 + near), 0.8, 40);
    const a = (0.10 + 0.5 * near) * (1 - clamp(z0 / depth * 1.05));
    drawSprite(ctx, lane === 3 ? spr2 : spr, p.x, p.y, rad, a);
  }
  addBlend(ctx, false);
}

/** Curved price ribbons streaming through the field. */
export function ribbons(ctx, cam, t, { count = 14, span = 2200, alpha = 0.5 } = {}) {
  for (let i = 0; i < count; i++) {
    const pts = [];
    const off = (i - count / 2) * 110;
    for (let k = 0; k < 22; k++) {
      const z = k * (span / 22);
      const base = series(i * 13, 22, { base: 0, drift: 0, vol: 26 })[k];
      const y = off + base + Math.sin(t * 0.6 + k * 0.5 + i) * 30;
      const p = project(cam, { x: Math.sin(z * 0.0009 + i) * 300, y, z });
      if (p) pts.push(p);
    }
    if (pts.length > 2) {
      path(ctx, pts, {
        color: i % 4 === 0 ? 'rgba(150,120,255,0.55)' : 'rgba(90,150,255,0.5)',
        width: 1.4, alpha: alpha * (0.35 + 0.65 * (i % 3) / 3)
      });
    }
  }
}

/* ── 02 · orbital market ring ─────────────────────────────────────────── */
export const MARKET_LABELS = [
  ['SPX', 'Equities'], ['BTC', 'Crypto'], ['ETH', 'Crypto'], ['EUR/USD', 'Forex'],
  ['XAU', 'Commodities'], ['WTI', 'Energy'], ['T-BILL 3M', 'RWA'], ['UST 10Y', 'Rates'],
  ['SOL', 'Crypto'], ['JPY', 'Forex'], ['NIKKEI', 'Equities'], ['COPPER', 'Metals']
];

export function marketRing(ctx, cam, t, { radius = 900, radiusY = 260, alpha = 1, nodes = MARKET_LABELS } = {}) {
  const n = nodes.length;
  const rot = t * 0.06;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rot;
    const w = { x: Math.cos(a) * radius, y: Math.sin(a) * radiusY * 0.5 + Math.sin(a * 2 + t * 0.2) * 40, z: Math.sin(a) * radius };
    pts.push({ w, p: project(cam, w), i });
  }
  addBlend(ctx, true);
  // link ring
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (!a.p || !b.p) continue;
    ctx.globalAlpha = 0.16 * alpha;
    ctx.strokeStyle = 'rgba(90,150,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.p.x, a.p.y); ctx.lineTo(b.p.x, b.p.y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  addBlend(ctx, false);

  for (const { p, i, w } of pts) {
    if (!p) continue;
    const [name, kind] = nodes[i];
    const depth = clamp(1 - (p.z / (radius * 2.2)), 0.25, 1);
    const s = clamp(p.s * 300, 0.3, 2.2);
    addBlend(ctx, true);
    drawSprite(ctx, sprite('rgba(140,190,255,1)', 0.45), p.x, p.y, 90 * s, 0.30 * alpha * depth);
    addBlend(ctx, false);
    ctx.save();
    ctx.globalAlpha = alpha * (0.45 + 0.55 * depth);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.2 * s, 0, TAU); ctx.fill();
    ctx.restore();
    if (depth > 0.45) {
      text(ctx, name, p.x + 12 * s, p.y - 2 * s, {
        size: 15 * s, weight: 600, alpha: alpha * depth * 0.92, color: '#e8eeff'
      });
      text(ctx, kind.toUpperCase(), p.x + 12 * s, p.y + 13 * s, {
        size: 9.5 * s, weight: 500, family: "'JetBrains Mono'", ls: '0.16em',
        alpha: alpha * depth * 0.5, color: '#7c8fb5'
      });
      // a market pulse on the node itself
      const sp = series(i + 3, 26, { base: 0, vol: 5, drift: 0.2 });
      sparkline(ctx, p.x - 62 * s, p.y + 22 * s, 50 * s, 16 * s, sp, {
        color: i % 3 === 0 ? 'rgba(120,150,255,0.9)' : 'rgba(90,200,255,0.9)',
        fill: null, width: 1.2, dot: false, alpha: alpha * depth * 0.6
      });
    }
  }
}

/* ── 03 · node graph (network of capabilities) ────────────────────────── */
export function nodeGraph(ctx, cam, t, nodes, links, { alpha = 1, color = 'rgba(100,160,255,', label = true } = {}) {
  const proj = nodes.map((n) => project(cam, n));
  addBlend(ctx, true);
  for (const [a, b] of links) {
    const pa = proj[a], pb = proj[b];
    if (!pa || !pb) continue;
    const pulseT = (t * 0.35 + (a + b) * 0.07) % 1;
    ctx.globalAlpha = 0.20 * alpha;
    ctx.strokeStyle = color + '0.9)';
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    // a packet travelling the link — the network is alive, not decorative
    const px = lerp(pa.x, pb.x, pulseT), py = lerp(pa.y, pb.y, pulseT);
    drawSprite(ctx, sprite('rgba(180,215,255,1)', 0.5), px, py, 26 * clamp(pa.s * 300, 0.3, 2), 0.55 * alpha);
  }
  ctx.globalAlpha = 1;
  addBlend(ctx, false);
  nodes.forEach((n, i) => {
    const p = proj[i];
    if (!p) return;
    const s = clamp(p.s * 300, 0.3, 2.4);
    addBlend(ctx, true);
    drawSprite(ctx, sprite(n.hot ? 'rgba(160,140,255,1)' : 'rgba(120,180,255,1)', 0.45), p.x, p.y, (n.r || 16) * 3.4 * s, 0.5 * alpha);
    addBlend(ctx, false);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#f2f7ff';
    ctx.beginPath(); ctx.arc(p.x, p.y, (n.r || 12) * 0.30 * s, 0, TAU); ctx.fill();
    ctx.restore();
    if (label && n.label && s > 0.55) {
      text(ctx, n.label, p.x, p.y + (n.r || 16) * s * 0.9 + 20 * s, {
        size: 13 * s, weight: 600, align: 'center', alpha: alpha * 0.86, color: '#dce7ff'
      });
    }
  });
}

/* ── 04 · blockchain volume ───────────────────────────────────────────── */
/**
 * Blocks laid out as a deep lattice. The highlighted block is where the
 * user's transaction lands; verification walks outward from it.
 */
export function chainLattice(ctx, cam, t, { cols = 9, rows = 6, gap = 210, z0 = 600, zN = 3600, alpha = 1, hot = null } = {}) {
  addBlend(ctx, true);
  for (let z = 0; z < zN - z0; z += gap) {
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        const w = {
          x: (cx - (cols - 1) / 2) * gap,
          y: (cy - (rows - 1) / 2) * gap * 0.62,
          z: z0 + z
        };
        const p = project(cam, w);
        if (!p) continue;
        const isHot = hot && Math.abs(z - hot.z) < gap * 0.6 && Math.abs(w.x - hot.x) < 1 && Math.abs(w.y - hot.y) < 1;
        const s = clamp(p.s * 300, 0.2, 2.4);
        const size = (isHot ? 46 : 30) * s;
        ctx.globalAlpha = alpha * (isHot ? 0.55 : 0.10 + 0.10 * ((cx + cy + z / gap) % 3) / 2);
        ctx.strokeStyle = isHot ? 'rgba(150,200,255,0.95)' : 'rgba(90,140,220,0.85)';
        ctx.lineWidth = isHot ? 1.8 : 1;
        roundRect(ctx, p.x - size / 2, p.y - size / 2 * 0.62, size, size * 0.62, 3 * s);
        ctx.stroke();
        if (isHot) {
          ctx.fillStyle = 'rgba(120,170,255,0.20)';
          ctx.fill();
        }
      }
    }
  }
  ctx.globalAlpha = 1;
  addBlend(ctx, false);
}

/** Flowing transaction particles through a blockchain volume. */
export function txFlow(ctx, cam, t, { count = 900, alpha = 1, highlightIdx = 0 } = {}) {
  const r = rng(29);
  const spr = sprite('rgba(150,200,255,1)', 0.5);
  const hot = sprite('rgba(255,255,255,1)', 0.4);
  addBlend(ctx, true);
  for (let i = 0; i < count; i++) {
    const lane = i % 5;
    const x = (lane - 2) * 150 + Math.sin(i * 1.7 + t * 0.4) * 40;
    const y = Math.cos(i * 0.9 + t * 0.3) * 220 + (lane - 2) * 30;
    const z = 300 + (((r() * 3600) + t * (240 + lane * 40)) % 3600);
    const p = project(cam, { x, y, z });
    if (!p) continue;
    const isHot = i === highlightIdx;
    const s = clamp(p.s * 260, 0.3, 2.2);
    drawSprite(ctx, isHot ? hot : spr, p.x, p.y, (isHot ? 46 : 9) * s, (isHot ? 0.95 : 0.30) * alpha);
  }
  addBlend(ctx, false);
}

/** A single glowing transaction travelling from PREPARING to CONFIRMED. */
export function travellingTx(ctx, cam, t, { from = { x: 0, y: 0, z: 200 }, to = { x: 0, y: 0, z: 2600 }, k = 0, trail = 26 } = {}) {
  const spr = sprite('rgba(200,230,255,1)', 0.4);
  addBlend(ctx, true);
  for (let i = trail; i >= 0; i--) {
    const kk = clamp(k - i * 0.012);
    const w = { x: lerp(from.x, to.x, kk), y: lerp(from.y, to.y, kk), z: lerp(from.z, to.z, kk) };
    const p = project(cam, w);
    if (!p) continue;
    const s = clamp(p.s * 300, 0.3, 2.4);
    const dir = Math.sin(kk * 6 + i * 0.4) * 40 * (1 - kk);
    drawSprite(ctx, spr, p.x + dir, p.y, 70 * s * (1 - i / trail * 0.7), (1 - i / trail) * 0.5);
  }
  addBlend(ctx, false);
}

/* ── 05 · the engine vortex ───────────────────────────────────────────── */
export function vortex(ctx, cx, cy, t, { count = 900, radius = 620, alpha = 1, palette = ['rgba(90,160,255,', 'rgba(140,120,255,', 'rgba(120,210,255,'] } = {}) {
  const r = rng(53);
  addBlend(ctx, true);
  for (let i = 0; i < count; i++) {
    const seedA = r(), seedR = r(), seedS = r();
    const speed = 0.22 + seedS * 0.5;
    const ang = seedA * TAU + t * speed;
    const rad = 60 + Math.pow(seedR, 0.7) * radius * (1 - clamp(t * 0.02, 0, 0.35));
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad * 0.58;
    const depth = 0.35 + 0.65 * (Math.sin(ang * 2 + t) * 0.5 + 0.5);
    ctx.globalAlpha = alpha * 0.24 * depth;
    ctx.fillStyle = palette[i % palette.length] + '0.9)';
    const sz = 1.0 + seedR * 2.6;
    ctx.beginPath(); ctx.arc(x, y, sz, 0, TAU); ctx.fill();
    if (i % 40 === 0) {
      ctx.globalAlpha = alpha * 0.22 * depth;
      ctx.strokeStyle = palette[(i + 1) % palette.length] + '0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, ang - 0.5, ang + 0.5);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  addBlend(ctx, false);
  // core
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.5);
  g.addColorStop(0, `rgba(150,190,255,${0.30 * alpha})`);
  g.addColorStop(0.35, `rgba(80,130,255,${0.10 * alpha})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, radius * 0.5, 0, TAU); ctx.fill();
}

/* ── 06 · the world grid (movement reference for camera dollies) ──────── */
export function worldGrid(ctx, cam, t, { size = 5200, step = 340, alpha = 0.13, y = -420 } = {}) {
  ctx.save();
  const n = Math.floor(size / step);
  for (let i = -n / 2; i <= n / 2; i++) {
    for (const horiz of [true, false]) {
      const a = { x: horiz ? i * step : -size / 2, y: y, z: horiz ? -size / 2 : i * step };
      const b = { x: horiz ? i * step : size / 2, y: y, z: horiz ? size / 2 : i * step };
      const pa = project(cam, a), pb = project(cam, b);
      if (!pa || !pb) continue;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = 'rgba(90,140,220,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
  }
  ctx.restore();
}

/* ── 07 · text billboard in world space ───────────────────────────────── */
export function billboard(ctx, cam, w, str, { size = 26, color = '#e8eeff', weight = 600, family = "'Inter'", ls = '0px', alpha = 1, dy = 0 } = {}) {
  const p = project(cam, w);
  if (!p) return null;
  const s = clamp(p.s * 320, 0.25, 3);
  text(ctx, str, p.x, p.y + dy, { size: size * s, weight, family, color, alpha, align: 'center', ls });
  return p;
}

/** A thin frame that tracks a world point — used for "locked on" callouts. */
export function reticle(ctx, cam, w, r = 60, { color = 'rgba(150,200,255,0.9)', alpha = 1, label = '', sub = '' } = {}) {
  const p = project(cam, w);
  if (!p) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  const rr = r * clamp(p.s * 320, 0.4, 2.4);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.beginPath();
    ctx.moveTo(p.x + sx * rr, p.y + sy * rr - sy * rr * 0.4);
    ctx.lineTo(p.x + sx * rr, p.y + sy * rr);
    ctx.lineTo(p.x + sx * rr - sx * rr * 0.4, p.y + sy * rr);
    ctx.stroke();
  }
  if (label) {
    text(ctx, label, p.x, p.y - rr - 22, { size: 15, weight: 600, align: 'center', color: '#e8eeff', alpha });
    if (sub) text(ctx, sub, p.x, p.y + rr + 30, { size: 11, weight: 500, family: "'JetBrains Mono'", ls: '0.18em', align: 'center', color: '#7c8fb5', alpha: alpha * 0.8 });
  }
  ctx.restore();
}

/* ── 08 · market wall (SCENE 10 time-lapse) ───────────────────────────── */
export function marketWall(ctx, x, y, w, h, t, { rows = 4, cols = 3, alpha = 1 } = {}) {
  const cw = w / cols, chh = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const seed = r * cols + c + 1;
      const px = x + c * cw, py = y + r * chh;
      panel(ctx, px + 8, py + 8, cw - 16, chh - 16, { radius: 12, alpha: alpha * 0.9 });
      const kind = seed % 3;
      if (kind === 0) {
        const rowsC = candleRows(seed, 26 + (seed % 8), { base: 100, vol: 2.4, drift: (seed % 5 === 0 ? -0.6 : 0.5) });
        candlesWrapped(ctx, px + 26, py + 44, cw - 52, chh - 78, rowsC, alpha * 0.95);
      } else {
        const sp = series(seed, 40, { base: 100, vol: 2.2, drift: seed % 4 === 0 ? -0.5 : 0.6 });
        sparkline(ctx, px + 26, py + chh - 60, cw - 52, 34,
          sp.map((v, i) => v + Math.sin(t * (0.6 + (seed % 3) * 0.2) + i * 0.3) * 1.6),
          { color: seed % 4 === 0 ? '#ff5f78' : '#4d9bff', fill: 'rgba(47,125,255,0.12)', width: 1.8, alpha });
      }
      text(ctx, ['BTC/USDT', 'ETH/USDT', 'SPX', 'EURUSD', 'XAU', 'US10Y', 'SOL/USDT', 'WTI', 'T-BILL 3M', 'NIKKEI', 'COPPER', 'RWA-X'][seed % 12],
        px + 26, py + 30, { size: 13, weight: 600, alpha: alpha * 0.9, color: '#dce7ff', family: "'JetBrains Mono'", ls: '0.08em' });
    }
  }
}

function candlesWrapped(ctx, x, y, w, h, rows, alpha) {
  const { candles } = { candles: null };
  // reuse fx.candles via a local import-free implementation to avoid a cycle
  const n = rows.length, cw = w / n;
  const min = Math.min(...rows.map((d) => d.l)), max = Math.max(...rows.map((d) => d.h));
  const span = max - min || 1;
  const py = (v) => y + h - ((v - min) / span) * h;
  ctx.save();
  ctx.globalAlpha = alpha;
  rows.forEach((r, i) => {
    const cx = x + i * cw + cw / 2;
    const bull = r.c >= r.o;
    ctx.strokeStyle = bull ? '#46d9a8' : '#ff5f78';
    ctx.fillStyle = bull ? '#46d9a8' : '#ff5f78';
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = Math.max(1, cw * 0.12);
    ctx.beginPath(); ctx.moveTo(cx, py(r.h)); ctx.lineTo(cx, py(r.l)); ctx.stroke();
    ctx.globalAlpha = alpha;
    const yo = py(r.o), yc = py(r.c);
    ctx.fillRect(cx - cw * 0.28, Math.min(yo, yc), cw * 0.56, Math.max(1.5, Math.abs(yc - yo)));
  });
  ctx.restore();
}
