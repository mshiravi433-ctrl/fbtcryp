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
 * A dependency-free rasteriser keeps the result deterministic without a native
 * image library: a compact, embedded subset of the app font and an abstract
 * ambient texture provide the detail, while validated event data stays dynamic.
 *
 * ─── WHY IT IS A ROUTE, NOT A BUILD STEP ────────────────────────────────────
 * The value is only known when the alert fires. The device fetches the artwork
 * when it renders the notification, so the render happens on demand and the edge
 * caches it forever (the URL's query string IS its content). A render costs
 * a fraction of a second and a few MB of buffer, and a given alert renders once per
 * colour/percentage combination rather than once per device.
 *
 * NOTHING USER-SUPPLIED REACHES THE DRAWING CODE UNVALIDATED: every string goes
 * through `parseBannerParams` in src/lib/notificationDesign.js, which uppercases
 * it, drops every glyph outside a fixed alphabet and truncates it. There is no
 * runtime font parser, SVG, HTML or external fetch in this file.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CAP_HEIGHT, GLYPHS, FONT_DATA, TEXTURE_DATA } from './notificationArtworkAssets.js';
import {
  parseBannerParams,
  toneSpec,
  TONES
} from '../src/lib/notificationDesign.js';

export const BANNER_WIDTH = 1024;
export const BANNER_HEIGHT = 512;

/* -------------------------------------------------------------------------- */
/* embedded font and ambient texture                                           */
/* -------------------------------------------------------------------------- */
/*
 * The old hand-drawn stroke font was hard to read, especially decimal points
 * and the percent sign. This is a pre-rasterised subset of the app's own
 * Vazirmatn font. Its alphabet exactly matches sanitizeBannerText; nothing
 * user-controlled is parsed as SVG/HTML or loaded from the network. The small
 * embedded assets also work in serverless bundles without a system font or a
 * runtime filesystem dependency. The generator and the mask are checked in.
 */
const FONT = inflateSync(Buffer.from(FONT_DATA, 'base64'));
const TEXTURE = inflateSync(Buffer.from(TEXTURE_DATA, 'base64'));
const TRACKING = 0.035;

/** Advance width of one line, in pixels. `size` is the capital height. */
function textWidth(value, size, tracking = TRACKING) {
  const chars = [...String(value || '')];
  if (!chars.length) return 0;
  const scale = size / CAP_HEIGHT;
  return chars.reduce((sum, ch) => sum + (GLYPHS[ch]?.[5] ?? GLYPHS[' '][5]) * scale, 0)
    + Math.max(0, chars.length - 1) * size * tracking;
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

/** Draw one line of antialiased glyphs. `y` is the top of a capital. */
function text(c, str, { x, y, size, rgb, alpha = 1, align = 'left', tracking = TRACKING }) {
  const value = String(str || '');
  const width = textWidth(value, size, tracking);
  let cursor = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
  const scale = size / CAP_HEIGHT;

  for (const ch of value) {
    const glyph = GLYPHS[ch] || GLYPHS[' '];
    const [offset, w, h, left, top, advance] = glyph;
    if (w && h) {
      const gx = cursor + left * scale;
      const gy = y + (CAP_HEIGHT + top) * scale;
      const minX = Math.max(0, Math.floor(gx));
      const maxX = Math.min(c.w, Math.ceil(gx + w * scale));
      const minY = Math.max(0, Math.floor(gy));
      const maxY = Math.min(c.h, Math.ceil(gy + h * scale));
      /* Small lettering is sampled four times per pixel so thin strokes and
         decimal points remain legible when the large atlas is scaled down. */
      const samples = scale < 0.4 ? [0.25, 0.75] : [0.5];
      for (let py = minY; py < maxY; py += 1) {
        for (let px = minX; px < maxX; px += 1) {
          let coverage = 0;
          for (const sy of samples) {
            for (const sx of samples) {
              const ix = Math.floor((px + sx - gx) / scale);
              const iy = Math.floor((py + sy - gy) / scale);
              if (ix >= 0 && iy >= 0 && ix < w && iy < h) coverage += FONT[offset + iy * w + ix];
            }
          }
          if (coverage) blend(c, px, py, rgb, alpha * coverage / (255 * samples.length ** 2));
        }
      }
    }
    cursor += advance * scale + size * tracking;
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

/** Tone-tinted ambient light, with a restrained texture and readable centre. */
function paintBackground(c, tone) {
  const spec = toneSpec(tone);
  const from = hexToRgb(spec.from);
  const to = hexToRgb(spec.to);
  const base = [5, 8, 18];

  for (let y = 0; y < c.h; y += 1) {
    const ny = y / c.h;
    for (let x = 0; x < c.w; x += 1) {
      const nx = x / c.w;
      const da = Math.hypot((nx - 0.86), (ny - 0.02) * 1.9);
      const ga = da > 0.95 ? 0 : (1 - da / 0.95) ** 2.2;
      const db = Math.hypot((nx - 0.06) * 1.1, (ny - 1) * 1.7);
      const gb = db > 0.95 ? 0 : (1 - db / 0.95) ** 2.4;
      /* A monochrome light-field, tinted from the same palette as the card.
         It is decorative, not a chart or a claim about the market. */
      const texture = TEXTURE[(y >> 1) * 512 + (x >> 1)] / 255;
      const vignette = 1 - Math.min(0.42, Math.hypot((nx - 0.5) * 1.4, (ny - 0.5) * 1.4) * 0.24);
      const i = (y * c.w + x) * 3;
      for (let k = 0; k < 3; k += 1) {
        const light = from[k] * gb * 0.60 + to[k] * ga * 0.52
          + (from[k] * (1 - nx) + to[k] * nx) * texture * 0.38;
        c.px[i + k] = Math.min(255, (base[k] + light) * vignette);
      }
    }
  }
}

/** Fit a line to its allocated region rather than clipping a price or label. */
function fitText(value, desiredSize, availableWidth, tracking = TRACKING) {
  const natural = textWidth(value, desiredSize, tracking);
  return natural > availableWidth ? desiredSize * availableWidth / natural : desiredSize;
}

/** Render one 2:1, tone-aware notification artwork. */
export function renderBannerPng(params = {}) {
  const p = parseBannerParams(params);
  const spec = toneSpec(p.tone);
  const accent = hexToRgb(spec.accent);
  const c = makeCanvas();
  paintBackground(c, p.tone);

  const PAD = 56;
  const right = c.w - PAD;
  const kicker = p.kicker || spec.label.en;

  /*
   * Brand badge and wordmark: the exact mark used by the Android small icon,
   * presented as the same GLASS ORB the regenerated notification icons use
   * (see scripts/gen-notification-icons.mjs). A flat dark square next to a
   * glassy status-bar icon made the artwork look like it came from an older
   * build of the app; the badge now gets the tone's bloom, a bright specular
   * top edge and a hairline ring, so artwork and icon are one object.
   */
  disc(c, PAD + 34, 73, 46, accent, 0.10);
  roundedRect(c, PAD, 39, 68, 68, 22, accent, 0.34);
  roundedRect(c, PAD + 1, 40, 66, 66, 21, [6, 13, 24], 0.92);
  roundedRect(c, PAD + 5, 44, 58, 26, 13, WHITE, 0.055);
  brandMark(c, PAD + 34, 73, 48, accent, 1);
  text(c, 'FBT SWAP', { x: PAD + 86, y: 49, size: 25, rgb: WHITE, alpha: 0.98, tracking: 0.06 });
  text(c, 'NOTIFICATIONS', { x: PAD + 87, y: 83, size: 12, rgb: WHITE, alpha: 0.60, tracking: 0.08 });

  /* A compact, tone-coloured status chip. */
  const kickSize = fitText(kicker, 18, 265);
  const kickWidth = textWidth(kicker, kickSize);
  const chipWidth = kickWidth + 57;
  roundedRect(c, right - chipWidth, 48, chipWidth, 50, 25, accent, 0.20);
  roundedRect(c, right - chipWidth + 1, 49, chipWidth - 2, 48, 24, [7, 13, 24], 0.76);
  disc(c, right - chipWidth + 22, 73, 4, accent, 1);
  text(c, kicker, { x: right - chipWidth + 37, y: 64, size: kickSize, rgb: WHITE, alpha: 0.94 });

  /* The amount is the hero. The orbit has a reserved area so a long amount
     cannot run into it; no value is truncated to make the design look tidy. */
  const hasValue = Boolean(p.value);
  const gauge = p.progress != null;
  const maxValueWidth = 685;
  if (hasValue) {
    const size = fitText(p.value, 128, maxValueWidth);
    text(c, p.value, { x: PAD, y: 160, size, rgb: WHITE, alpha: 1, tracking: 0.015 });
    if (p.label) {
      const labelSize = fitText(p.label, 27, maxValueWidth);
      text(c, p.label, { x: PAD + 2, y: 334, size: labelSize, rgb: accent, alpha: 0.98, tracking: 0.04 });
    }
  } else {
    /* The text still carries meaning if the source has no numeric value. */
    const label = p.label || kicker;
    const size = fitText(label, 50, maxValueWidth);
    text(c, label, { x: PAD, y: 260, size, rgb: WHITE, alpha: 0.98 });
  }

  /* A real progress ring only when the event actually provided a percentage.
     Otherwise it is a decorative brand orbit, never a made-up price chart. */
  const cx = right - 93;
  const cy = 254;
  disc(c, cx, cy, 104, accent, 0.04);
  arc(c, cx, cy, 103, 1, accent, 0.16);
  arc(c, cx, cy, 88, 1, WHITE, 0.09);
  if (gauge) {
    arc(c, cx, cy, 70, 5, WHITE, 0.14);
    if (p.progress > 0) {
      const start = -Math.PI / 2;
      arc(c, cx, cy, 70, 5, accent, 0.98, start, start + Math.PI * 2 * p.progress / 100);
    }
    text(c, `${p.progress}%`, { x: cx, y: cy - 18, size: 36, rgb: WHITE, align: 'center' });
  } else {
    brandMark(c, cx, cy, 99, accent, 0.84);
  }
  disc(c, cx + 84, cy - 58, 3.5, accent, 0.8);

  /* A progress bar must never suggest progress for an event without it. */
  text(c, gauge ? 'PROGRESS' : 'FBT NOTIFICATIONS', {
    x: PAD, y: 403, size: 13, rgb: WHITE, alpha: 0.55, tracking: 0.07
  });
  const railY = 441;
  const railW = c.w - PAD * 2;
  if (gauge) {
    roundedRect(c, PAD, railY, railW, 9, 4.5, WHITE, 0.16);
    if (p.progress > 0) {
      const filled = railW * p.progress / 100;
      roundedRect(c, PAD, railY, filled, 9, 4.5, accent, 0.95);
      disc(c, PAD + filled, railY + 4.5, 5, WHITE, 0.72);
    }
  } else {
    roundedRect(c, PAD, railY, railW, 3, 1.5, accent, 0.42);
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
 * One render uses CPU, and a burst of alerts (a ladder firing four
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
    etag: `"fbt-${createHash('sha256').update(png).digest('hex').slice(0, 20)}-${png.length}"`,
    cacheKey: p.key
  };
}

export { TONES };
