/**
 * NOTIFICATION ARTWORK RENDERER — the big-picture card in the shade
 * ---------------------------------------------------------------------------
 * «دیزاین باید مثل همین نوتیفیکیشن‌ها باشد … با لوگو و رنگ و فاصلهٔ درست.»
 *
 * A phone notification has exactly one place a dApp can put real design: the
 * BIG PICTURE (`image` on web push, `android.notification.image` on FCM), the
 * wide artwork under the two lines of copy. Everything else — corner radius,
 * row order, font — belongs to Android and iOS and cannot be restyled by any
 * payload. The reference designs the owner sent are exactly that: a dark rounded
 * card with a coloured aurora, a small brand row, one huge number and a rail.
 *
 * So this module draws precisely that, server-side, per notification:
 *
 *   · the tone's aurora (mint/cyan for profit, crimson/violet for loss, …)
 *   · the brand mark, drawn from the same geometry as the launcher icon
 *   · the big number ('+12.4%', '65,240', 'POSTPONED')
 *   · the pair / label line
 *   · a progress rail — the one way a push can show "this order is 3 of 4"
 *   · a ring gauge on the right when progress is known
 *
 * ─── WHY IT IS HAND-DRAWN, NOT A TEMPLATE IMAGE ─────────────────────────────
 * The number is the whole point of the card and it changes per notification, so
 * a static PNG would either lie or need a text layer the platforms do not have.
 * A dependency-free rasteriser (the repo already ships one for its icons — see
 * scripts/gen-notification-icons.mjs) keeps this in the same spirit: no native
 * image library, no 40 MB dependency, no asset pipeline, deterministic bytes.
 *
 * ─── WHY IT IS A ROUTE, NOT A BUILD STEP ────────────────────────────────────
 * The value is only known when the alert fires. The device fetches the artwork
 * when it renders the notification, so the render happens on demand and the edge
 * caches it forever (the URL's query string IS its content). A render costs
 * ~40 ms and a few hundred KB of buffer, and a given alert renders once per
 * colour/percentage combination rather than once per device.
 *
 * NOTHING USER-SUPPLIED REACHES THE DRAWING CODE UNVALIDATED: every string goes
 * through `parseBannerParams` in src/lib/notificationDesign.js, which uppercases
 * it, drops every glyph outside a fixed alphabet and truncates it. There is no
 * font parser, no SVG, no HTML and no external fetch in this file.
 */

import { deflateSync } from 'node:zlib';
import {
  parseBannerParams,
  toneSpec,
  TONES
} from '../src/lib/notificationDesign.js';

export const BANNER_WIDTH = 1024;
export const BANNER_HEIGHT = 512;

/* -------------------------------------------------------------------------- */
/* a stroke font                                                               */
/* -------------------------------------------------------------------------- */
/*
 * Glyphs live in a unit box (x right, y DOWN) as polylines, drawn with round
 * caps. This is a technical/geometric face on purpose: it matches the app's
 * neon identity, it renders identically at every size, and — the reason it is
 * hand-written — it needs no font file, no shaping engine and no licence.
 *
 * Persian is not attempted here (see the note in src/lib/notificationDesign.js);
 * the OS shapes Persian in the title/body natively, and the artwork carries the
 * numbers and the Latin pair.
 */
const G = {
  A: { w: 0.68, s: [[[0, 1], [0.34, 0], [0.68, 1]], [[0.14, 0.62], [0.54, 0.62]]] },
  B: { w: 0.64, s: [[[0, 0], [0, 1]], [[0, 0], [0.44, 0], [0.62, 0.14], [0.62, 0.36], [0.44, 0.5], [0, 0.5]], [[0, 0.5], [0.46, 0.5], [0.64, 0.64], [0.64, 0.86], [0.46, 1], [0, 1]]] },
  C: { w: 0.64, s: [[[0.64, 0.16], [0.48, 0], [0.18, 0], [0, 0.2], [0, 0.8], [0.18, 1], [0.48, 1], [0.64, 0.84]]] },
  D: { w: 0.66, s: [[[0, 0], [0, 1]], [[0, 0], [0.42, 0], [0.66, 0.26], [0.66, 0.74], [0.42, 1], [0, 1]]] },
  E: { w: 0.58, s: [[[0.58, 0], [0, 0], [0, 1], [0.58, 1]], [[0, 0.5], [0.44, 0.5]]] },
  F: { w: 0.56, s: [[[0.56, 0], [0, 0], [0, 1]], [[0, 0.5], [0.42, 0.5]]] },
  G: { w: 0.66, s: [[[0.64, 0.18], [0.46, 0], [0.18, 0], [0, 0.22], [0, 0.78], [0.18, 1], [0.5, 1], [0.66, 0.82], [0.66, 0.56], [0.34, 0.56]]] },
  H: { w: 0.66, s: [[[0, 0], [0, 1]], [[0.66, 0], [0.66, 1]], [[0, 0.5], [0.66, 0.5]]] },
  I: { w: 0.14, s: [[[0.07, 0], [0.07, 1]]] },
  J: { w: 0.56, s: [[[0.56, 0], [0.56, 0.76], [0.4, 1], [0.16, 1], [0, 0.82]]] },
  K: { w: 0.62, s: [[[0, 0], [0, 1]], [[0.62, 0], [0.06, 0.56]], [[0.24, 0.4], [0.66, 1]]] },
  L: { w: 0.56, s: [[[0, 0], [0, 1], [0.56, 1]]] },
  M: { w: 0.78, s: [[[0, 1], [0, 0], [0.39, 0.62], [0.78, 0], [0.78, 1]]] },
  N: { w: 0.68, s: [[[0, 1], [0, 0], [0.68, 1], [0.68, 0]]] },
  O: { w: 0.68, s: [[[0.2, 0], [0.48, 0], [0.68, 0.24], [0.68, 0.76], [0.48, 1], [0.2, 1], [0, 0.76], [0, 0.24], [0.2, 0]]] },
  P: { w: 0.62, s: [[[0, 1], [0, 0], [0.44, 0], [0.62, 0.16], [0.62, 0.42], [0.44, 0.58], [0, 0.58]]] },
  Q: { w: 0.68, s: [[[0.2, 0], [0.48, 0], [0.68, 0.24], [0.68, 0.76], [0.48, 1], [0.2, 1], [0, 0.76], [0, 0.24], [0.2, 0]], [[0.44, 0.7], [0.68, 1.02]]] },
  R: { w: 0.64, s: [[[0, 1], [0, 0], [0.44, 0], [0.64, 0.16], [0.64, 0.42], [0.44, 0.58], [0, 0.58]], [[0.34, 0.58], [0.66, 1]]] },
  S: { w: 0.62, s: [[[0.62, 0.16], [0.44, 0], [0.18, 0], [0, 0.18], [0, 0.34], [0.16, 0.48], [0.46, 0.52], [0.62, 0.66], [0.62, 0.84], [0.44, 1], [0.16, 1], [0, 0.84]]] },
  T: { w: 0.62, s: [[[0, 0], [0.62, 0]], [[0.31, 0], [0.31, 1]]] },
  U: { w: 0.66, s: [[[0, 0], [0, 0.78], [0.18, 1], [0.48, 1], [0.66, 0.78], [0.66, 0]]] },
  V: { w: 0.68, s: [[[0, 0], [0.34, 1], [0.68, 0]]] },
  W: { w: 0.9, s: [[[0, 0], [0.2, 1], [0.45, 0.36], [0.7, 1], [0.9, 0]]] },
  X: { w: 0.64, s: [[[0, 0], [0.64, 1]], [[0.64, 0], [0, 1]]] },
  Y: { w: 0.66, s: [[[0, 0], [0.33, 0.5], [0.66, 0]], [[0.33, 0.5], [0.33, 1]]] },
  Z: { w: 0.62, s: [[[0, 0], [0.62, 0], [0, 1], [0.62, 1]]] },

  0: { w: 0.6, s: [[[0.18, 0], [0.42, 0], [0.6, 0.24], [0.6, 0.76], [0.42, 1], [0.18, 1], [0, 0.76], [0, 0.24], [0.18, 0]]] },
  1: { w: 0.36, s: [[[0.06, 0.2], [0.3, 0], [0.3, 1]], [[0.06, 1], [0.36, 1]]] },
  2: { w: 0.6, s: [[[0, 0.2], [0.18, 0], [0.44, 0], [0.6, 0.2], [0.6, 0.4], [0, 1], [0.6, 1]]] },
  3: { w: 0.6, s: [[[0, 0.1], [0.18, 0], [0.44, 0], [0.6, 0.2], [0.6, 0.36], [0.34, 0.5], [0.6, 0.62], [0.6, 0.82], [0.42, 1], [0.16, 1], [0, 0.88]]] },
  4: { w: 0.62, s: [[[0.46, 1], [0.46, 0], [0, 0.68], [0.62, 0.68]]] },
  5: { w: 0.6, s: [[[0.58, 0], [0.1, 0], [0.04, 0.44], [0.38, 0.42], [0.6, 0.62], [0.6, 0.82], [0.42, 1], [0.16, 1], [0, 0.86]]] },
  6: { w: 0.6, s: [[[0.56, 0.12], [0.36, 0], [0.16, 0], [0, 0.3], [0, 0.78], [0.18, 1], [0.42, 1], [0.6, 0.8], [0.6, 0.62], [0.42, 0.46], [0.14, 0.46], [0, 0.6]]] },
  7: { w: 0.6, s: [[[0, 0], [0.6, 0], [0.22, 1]]] },
  8: { w: 0.6, s: [[[0.18, 0.5], [0, 0.36], [0, 0.16], [0.18, 0], [0.42, 0], [0.6, 0.16], [0.6, 0.36], [0.42, 0.5], [0.18, 0.5], [0, 0.64], [0, 0.86], [0.18, 1], [0.42, 1], [0.6, 0.86], [0.6, 0.64], [0.42, 0.5]]] },
  9: { w: 0.6, s: [[[0.6, 0.4], [0.44, 0.54], [0.18, 0.54], [0, 0.38], [0, 0.2], [0.18, 0], [0.42, 0], [0.6, 0.22], [0.6, 0.7], [0.44, 1], [0.18, 1], [0, 0.88]]] },

  /*
   * '%' IS SPECIAL-CASED IN text(): its two loops are drawn as STROKED CIRCLES.
   * As four-point polylines the stroke of a 150px glyph (17px) is wider than the
   * loop itself, so the rings filled into solid blocks and «+12.4%» read as
   * «+12.4¤». The slash stays a normal stroke; the circles live in `special`.
   */
  '%': { w: 0.72, s: [[[0.66, 0.02], [0.06, 0.98]]], special: 'percent' },
  '+': { w: 0.56, s: [[[0.28, 0.14], [0.28, 0.86]], [[0, 0.5], [0.56, 0.5]]] },
  '-': { w: 0.5, s: [[[0.02, 0.5], [0.48, 0.5]]] },
  ':': { w: 0.16, s: [] },
  '/': { w: 0.52, s: [[[0.52, 0], [0, 1]]] },
  '°': { w: 0.3, s: [[[0.15, 0.02], [0.28, 0.1], [0.28, 0.24], [0.15, 0.32], [0.02, 0.24], [0.02, 0.1], [0.15, 0.02]]] },
  '>': { w: 0.6, s: [[[0.04, 0.16], [0.34, 0.5], [0.04, 0.84]]] },
  '$': { w: 0.6, s: [[[0.6, 0.16], [0.42, 0], [0.16, 0], [0, 0.18], [0, 0.34], [0.14, 0.48], [0.44, 0.52], [0.6, 0.66], [0.6, 0.84], [0.42, 1], [0.16, 1], [0, 0.84]], [[0.3, -0.12], [0.3, 1.12]]] },
  ' ': { w: 0.26, s: [] }
};

/* Dots are filled, not stroked, so they stay round at every size. */
const DOTS = { '.': 0.94, ',': 0.98 };

const TRACKING = 0.1;

/** Advance width of one string at `size` px, in px. */
function textWidth(text, size) {
  let w = 0;
  for (const ch of text) {
    const g = G[ch];
    w += (g ? g.w : 0.6) * size + TRACKING * size;
  }
  return Math.max(0, w - TRACKING * size);
}

/* -------------------------------------------------------------------------- */
/* raster helpers                                                              */
/* -------------------------------------------------------------------------- */

function makeCanvas() {
  /* RGB, one byte per channel, no alpha: a notification image is opaque. */
  return { w: BANNER_WIDTH, h: BANNER_HEIGHT, px: new Uint8Array(BANNER_WIDTH * BANNER_HEIGHT * 3) };
}

function blend(c, x, y, rgb, a) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const alpha = a <= 0 ? 0 : a >= 1 ? 1 : a;
  const i = (y * c.w + x) * 3;
  c.px[i] += (rgb[0] - c.px[i]) * alpha;
  c.px[i + 1] += (rgb[1] - c.px[i + 1]) * alpha;
  c.px[i + 2] += (rgb[2] - c.px[i + 2]) * alpha;
}

const hexToRgb = (hex) => {
  const h = String(hex || '').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
};
const WHITE = [255, 255, 255];

/** Antialiased round-capped segment. */
function segment(c, x1, y1, x2, y2, half, rgb, alpha) {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - half - 1));
  const maxX = Math.min(c.w - 1, Math.ceil(Math.max(x1, x2) + half + 1));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - half - 1));
  const maxY = Math.min(c.h - 1, Math.ceil(Math.max(y1, y2) + half + 1));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = x1 + dx * t;
      const cy = y1 + dy * t;
      const d = Math.hypot(px - cx, py - cy);
      const cov = half + 0.5 - d;
      if (cov > 0) blend(c, x, y, rgb, Math.min(1, cov) * alpha);
    }
  }
}

function disc(c, cx, cy, r, rgb, alpha) {
  const minX = Math.max(0, Math.floor(cx - r - 1));
  const maxX = Math.min(c.w - 1, Math.ceil(cx + r + 1));
  const minY = Math.max(0, Math.floor(cy - r - 1));
  const maxY = Math.min(c.h - 1, Math.ceil(cy + r + 1));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = r + 0.5 - d;
      if (cov > 0) blend(c, x, y, rgb, Math.min(1, cov) * alpha);
    }
  }
}

/** Filled rounded rectangle. */
function roundedRect(c, x, y, w, h, r, rgb, alpha) {
  const rad = Math.min(r, w / 2, h / 2);
  const minX = Math.max(0, Math.floor(x - 1));
  const maxX = Math.min(c.w - 1, Math.ceil(x + w + 1));
  const minY = Math.max(0, Math.floor(y - 1));
  const maxY = Math.min(c.h - 1, Math.ceil(y + h + 1));
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      /* distance to the rounded-rect boundary, negative inside */
      const qx = Math.abs(cx - (x + w / 2)) - (w / 2 - rad);
      const qy = Math.abs(cy - (y + h / 2)) - (h / 2 - rad);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const d = outside + Math.min(Math.max(qx, qy), 0) - rad;
      const cov = 0.5 - d;
      if (cov > 0) blend(c, px, py, rgb, Math.min(1, cov) * alpha);
    }
  }
}

/** Stroke a circle (track) or an arc from `a0` to `a1` radians. */
function arc(c, cx, cy, radius, half, rgb, alpha, a0 = 0, a1 = Math.PI * 2) {
  const minX = Math.max(0, Math.floor(cx - radius - half - 1));
  const maxX = Math.min(c.w - 1, Math.ceil(cx + radius + half + 1));
  const minY = Math.max(0, Math.floor(cy - radius - half - 1));
  const maxY = Math.min(c.h - 1, Math.ceil(cy + radius + half + 1));
  const span = a1 - a0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.abs(Math.hypot(dx, dy) - radius);
      const cov = half + 0.5 - d;
      if (cov <= 0) continue;
      if (span < Math.PI * 2 - 0.001) {
        let ang = Math.atan2(dy, dx);
        /* normalise into [a0, a0 + 2π) */
        while (ang < a0) ang += Math.PI * 2;
        if (ang > a0 + span) continue;
      }
      blend(c, x, y, rgb, Math.min(1, cov) * alpha);
    }
  }
}

function polyline(c, points, half, rgb, alpha) {
  for (let i = 1; i < points.length; i += 1) {
    segment(c, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], half, rgb, alpha);
  }
  for (const [x, y] of points) disc(c, x, y, half, rgb, alpha);
}

/**
 * Draw one line of text. Returns the advance width so callers can centre.
 * `y` is the TOP of the glyph box.
 */
function text(c, str, { x, y, size, thickness, rgb, alpha = 1, align = 'left' }) {
  const value = String(str || '');
  const width = textWidth(value, size);
  let cursor = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
  const half = Math.max(1, thickness / 2);
  for (const ch of value) {
    /*
     * A DOT HAS NO GLYPH ENTRY AND MUST STILL BE DRAWN.
     *
     * The missing-glyph branch below advances the cursor and skips, which is
     * right for a character the font cannot draw — but '.' and ',' are drawn as
     * FILLED discs, not as strokes, so they have no `G` entry at all. They were
     * falling into that branch and vanishing: «+12.4%» rendered as «+12 4%»,
     * i.e. a price of twelve-point-four percent read as "12 4%". Handled before
     * the lookup, and given a real advance so the spacing closes up.
     */
    if (DOTS[ch] != null) {
      const dw = 0.16 * size;
      disc(c, cursor + dw / 2, y + DOTS[ch] * size, Math.max(1.8, thickness * 0.66), rgb, alpha);
      cursor += dw + TRACKING * size;
      continue;
    }
    const glyph = G[ch];
    if (!glyph) {
      cursor += 0.6 * size + TRACKING * size;
      continue;
    }
    const gw = glyph.w * size;
    for (const strokes of glyph.s) {
      polyline(c, strokes.map(([gx, gy]) => [cursor + gx * gw, y + gy * size]), half, rgb, alpha);
    }
    if (glyph.special === 'percent') {
      const ringHalf = Math.max(1.2, Math.min(half * 0.62, size * 0.026));
      arc(c, cursor + gw * 0.17, y + size * 0.22, size * 0.15, ringHalf, rgb, alpha);
      arc(c, cursor + gw * 0.55, y + size * 0.78, size * 0.15, ringHalf, rgb, alpha);
    }
    cursor += gw + TRACKING * size;
  }
  return width;
}

/* -------------------------------------------------------------------------- */
/* the artwork                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The brand mark: the circular two-arrow swap glyph, matched to
 * android/app/src/main/res/drawable/ic_stat_notification.xml and to the PNGs in
 * public/notification/. Drawn as a ring plus two filled arrowheads.
 */
function brandMark(c, cx, cy, size, rgb, alpha) {
  /*
   * THE REAL MARK, NOT AN APPROXIMATION.
   *
   * Geometry is ported verbatim from scripts/gen-notification-icons.mjs (the
   * script that generates the PNGs in public/notification/ and mirrors the
   * Android vector drawable): a ring of radius 7.5 with two 2.2-wide arcs and
   * two solid arrowheads, in a 24-unit box. Drawing "a circle with an arrow"
   * freehand produced a hot-dog — the shade's icon and this artwork have to be
   * the same logo or the notification looks like it came from another app.
   *
   * Rasterised by 4×4 supersampling per pixel because the band is only ~2px
   * wide at this scale and a hard threshold makes it crawl.
   */
  const k = size / 24;
  const SS = 4;
  const R = 7.5;
  const HW = 1.1;
  const ARC_R = [-75, 75];
  const ARC_L = [105, 255];
  const TRI_R = [[10.08, 20.28], [14.61, 21.75], [13.27, 16.73]];
  const TRI_L = [[13.92, 3.72], [9.39, 2.25], [10.73, 7.27]];

  const norm360 = (a) => ((a % 360) + 360) % 360;
  const inArc = (a, [from, to]) => {
    const x = norm360(a);
    const f = norm360(from);
    const t = norm360(to);
    return f <= t ? x >= f && x <= t : x >= f || x <= t;
  };
  const inTri = (px, py, tri) => {
    const sgn = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    const d1 = sgn(tri[0], tri[1], [px, py]);
    const d2 = sgn(tri[1], tri[2], [px, py]);
    const d3 = sgn(tri[2], tri[0], [px, py]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  const inside = (x, y) => {
    if (inTri(x, y, TRI_R) || inTri(x, y, TRI_L)) return true;
    const dx = x - 12;
    const dy = y - 12;
    if (Math.abs(Math.hypot(dx, dy) - R) > HW) return false;
    const a = norm360((Math.atan2(dy, dx) * 180) / Math.PI);
    return inArc(a, ARC_R) || inArc(a, ARC_L);
  };

  const half = size / 2;
  const minX = Math.max(0, Math.floor(cx - half - 1));
  const maxX = Math.min(c.w - 1, Math.ceil(cx + half + 1));
  const minY = Math.max(0, Math.floor(cy - half - 1));
  const maxY = Math.min(c.h - 1, Math.ceil(cy + half + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = (x + (sx + 0.5) / SS - cx) / k + 12;
          const py = (y + (sy + 0.5) / SS - cy) / k + 12;
          if (inside(px, py)) hits += 1;
        }
      }
      if (hits) blend(c, x, y, rgb, (hits / (SS * SS)) * alpha);
    }
  }
}

/** The background: near-black, the tone's two glows, a faint grid, a vignette. */
function paintBackground(c, tone) {
  const spec = toneSpec(tone);
  const from = hexToRgb(spec.from);
  const to = hexToRgb(spec.to);
  const base = [4, 5, 11];

  for (let y = 0; y < c.h; y += 1) {
    const ny = y / c.h;
    for (let x = 0; x < c.w; x += 1) {
      const nx = x / c.w;
      /* Glow A — top right, the tone's second colour. */
      const ax = (nx - 0.86) * 1.0;
      const ay = (ny - 0.02) * 1.9;
      const da = Math.sqrt(ax * ax + ay * ay);
      const ga = da > 0.95 ? 0 : (1 - da / 0.95) ** 2.2;
      /* Glow B — bottom left, the tone's primary colour. */
      const bx = (nx - 0.06) * 1.1;
      const by = (ny - 1.0) * 1.7;
      const db = Math.sqrt(bx * bx + by * by);
      const gb = db > 0.95 ? 0 : (1 - db / 0.95) ** 2.4;
      /* A diagonal sheen so the card reads as glass, not a flat fill. */
      const sheen = Math.max(0, 1 - Math.abs(nx * 0.8 + ny * 1.1 - 0.72) * 2.4) * 0.1;
      /* Vignette — keeps the OS's rounded crop from clipping bright corners. */
      const vx = (nx - 0.5) * 1.6;
      const vy = (ny - 0.5) * 1.6;
      const vig = 1 - Math.min(0.5, Math.sqrt(vx * vx + vy * vy) * 0.28);

      let r = base[0] + to[0] * ga * 0.52 + from[0] * gb * 0.5 + from[0] * sheen;
      let g = base[1] + to[1] * ga * 0.52 + from[1] * gb * 0.5 + from[1] * sheen;
      let b = base[2] + to[2] * ga * 0.52 + from[2] * gb * 0.5 + from[2] * sheen;

      /* A fine 64px grid at barely-there opacity — the "terminal" texture the
         reference cards have, without anything that could look like noise. */
      if (x % 64 === 0 || y % 64 === 0) {
        r += 9;
        g += 11;
        b += 14;
      }

      const i = (y * c.w + x) * 3;
      c.px[i] = Math.max(0, Math.min(255, r * vig));
      c.px[i + 1] = Math.max(0, Math.min(255, g * vig));
      c.px[i + 2] = Math.max(0, Math.min(255, b * vig));
    }
  }
}

/**
 * Render one card.
 *
 * Layout, in a 1024×512 frame (2:1, which is what Chrome and Android crop to):
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  (mark) FBT SWAP                 READY       │  brand row + kicker
 *   │                                              │
 *   │  +12.4%                            ◕ 68%     │  big number + gauge
 *   │  BTC → USDT · TARGET HIT                     │  label
 *   │  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░    │  progress rail
 *   └──────────────────────────────────────────────┘
 */
export function renderBannerPng(params = {}) {
  const p = parseBannerParams(params);
  const spec = toneSpec(p.tone);
  const accent = hexToRgb(spec.accent);
  const c = makeCanvas();
  paintBackground(c, p.tone);

  const PAD = 56;
  const right = c.w - PAD;

  /* ── brand row ─────────────────────────────────────────────────────────── */
  roundedRect(c, PAD, 42, 212, 60, 30, WHITE, 0.07);
  brandMark(c, PAD + 36, 72, 40, accent, 1);
  text(c, 'FBT SWAP', { x: PAD + 66, y: 60, size: 20, thickness: 4.4, rgb: WHITE, alpha: 0.92 });

  const kicker = p.kicker || spec.label.en;
  text(c, kicker, { x: right, y: 62, size: 20, thickness: 4.2, rgb: accent, alpha: 0.95, align: 'right' });

  /* ── the big number (or the label, when a card has no number) ───────────── */
  const hasValue = Boolean(p.value);
  const gauge = p.progress != null;
  const valueRight = gauge ? right - 210 : right;
  const maxValueWidth = valueRight - PAD;

  let valueSize = hasValue ? 150 : 84;
  if (hasValue) {
    /* Shrink to fit rather than clip: a clipped price is a wrong price. */
    const natural = textWidth(p.value, valueSize);
    if (natural > maxValueWidth) valueSize = Math.max(54, Math.floor((valueSize * maxValueWidth) / natural));
  }

  const valueY = hasValue ? 150 : 176;
  if (hasValue) {
    text(c, p.value, {
      x: PAD,
      y: valueY,
      size: valueSize,
      thickness: Math.max(6, valueSize * 0.115),
      rgb: WHITE,
      alpha: 1
    });
  }

  const label = p.label || (hasValue ? '' : kicker);
  if (label) {
    text(c, label, {
      x: PAD,
      y: hasValue ? valueY + valueSize + 26 : valueY + 96,
      size: hasValue ? 30 : 42,
      thickness: hasValue ? 6 : 8,
      rgb: accent,
      alpha: 0.96
    });
  }

  /* ── gauge ─────────────────────────────────────────────────────────────── */
  if (gauge) {
    const cx = right - 96;
    const cy = valueY + valueSize * 0.5;
    const radius = 74;
    arc(c, cx, cy, radius, 7, WHITE, 0.12);
    if (p.progress > 0) {
      const start = -Math.PI / 2;
      arc(c, cx, cy, radius, 7, accent, 0.98, start, start + (Math.PI * 2 * p.progress) / 100);
    }
    const inside = `${p.progress}%`;
    text(c, inside, {
      x: cx,
      y: cy - 22,
      size: 40,
      thickness: 7,
      rgb: WHITE,
      alpha: 0.95,
      align: 'center'
    });
  } else {
    /* No progress: a large, very faint mark balances the frame. */
    brandMark(c, right - 90, valueY + valueSize * 0.5, 92, WHITE, 0.06);
  }

  /* ── progress rail ─────────────────────────────────────────────────────── */
  if (gauge) {
    const railY = c.h - 74;
    const railW = c.w - PAD * 2;
    roundedRect(c, PAD, railY, railW, 12, 6, WHITE, 0.13);
    const filled = Math.max(12, (railW * p.progress) / 100);
    roundedRect(c, PAD, railY, filled, 12, 6, accent, 0.95);
    /* A travelling glint at the head of the fill, so a live card looks live. */
    disc(c, PAD + filled, railY + 6, 8, WHITE, 0.5);
  } else {
    /* A hairline in the tone instead of a rail: the same frame, quieter. */
    roundedRect(c, PAD, c.h - 72, c.w - PAD * 2, 3, 1.5, accent, 0.5);
  }

  return encodePng(c);
}

/* -------------------------------------------------------------------------- */
/* PNG encoder (the spec itself: IHDR + IDAT + IEND, no dependencies)           */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export function encodePng(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = c.w * 3;
  const raw = Buffer.alloc((stride + 1) * c.h);
  for (let y = 0; y < c.h; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(c.px.buffer, c.px.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* -------------------------------------------------------------------------- */
/* an in-process cache                                                         */
/* -------------------------------------------------------------------------- */

/*
 * One render is ~40 ms of pure CPU, and a burst of alerts (a ladder firing four
 * rungs, or a cron delivering to many devices) asks for the same handful of
 * URLs. This small LRU keeps the second request free without unbounded memory:
 * 48 cards is at most a few MB, and the edge cache in front does the real work.
 */
const CACHE_MAX = 48;
const cache = new Map();

export function renderBannerCached(params = {}) {
  const p = parseBannerParams(params);
  const hit = cache.get(p.key);
  if (hit) {
    /* refresh recency */
    cache.delete(p.key);
    cache.set(p.key, hit);
    return hit;
  }
  const png = renderBannerPng(p);
  cache.set(p.key, png);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return png;
}

/** Everything a route needs to serve a card honestly. */
export function bannerResponse(params = {}) {
  const p = parseBannerParams(params);
  const png = renderBannerCached(p);
  return {
    png,
    tone: p.tone,
    etag: `"fbt-${p.key.replace(/[^A-Za-z0-9|]/g, '-')}-${png.length}"`,
    cacheKey: p.key
  };
}

export { TONES };
