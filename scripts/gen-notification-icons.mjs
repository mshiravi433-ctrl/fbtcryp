#!/usr/bin/env node
/**
 * NOTIFICATION ICON GENERATOR
 * ---------------------------------------------------------------------------
 * «نوار نوتیفیکیشن موبایل باید مدرن باشد: لوگوی SVG، رنگ‌ها و تم درست»
 *
 * The notification shade is the one surface where our old assets were
 * honestly bad: Android fell back to the LAUNCHER icon (a 512px neon artwork
 * squashed into a 24dp slot, which the OS then silhouettes into a white
 * blob), and the web push handler pointed `icon` AND `badge` at the same
 * full-colour square — so Chrome's monochrome badge slot got a coloured
 * picture the platform re-silhouettes anyway.
 *
 * This script regenerates, from ONE geometric description of the brand mark
 * (the circular two-arrow swap glyph of the logo):
 *
 *   public/notification/badge-96.png     monochrome white-on-transparent,
 *   public/notification/badge-192.png    for the OS badge slot (Android
 *                                        silhouettes it, web shows it as-is)
 *   public/notification/icon-color-192.png  the colour icon for notification
 *   public/notification/icon-color-512.png  rows (neon gradient on FBT black)
 *
 * and the Android status-bar glyph lives next to it as a real vector:
 *   android/app/src/main/res/drawable/ic_stat_notification.xml
 * (hand-maintained; the same geometry, so shade and status bar agree).
 *
 * ─── WHY A HAND-ROLLED PNG ENCODER ──────────────────────────────────────────
 * No image library is a dependency of this repo (no sharp/canvas/resvg —
 * they need native builds), and the mark is two arcs plus two triangles:
 * rasterising it analytically with supersampling is both smaller and more
 * honest than shipping a 40 MB native dependency to draw four shapes. The
 * encoder below is the PNG spec itself: IHDR + one filtered-IDAT stream
 * through node:zlib + IEND, with the CRC table from the spec.
 *
 * Usage: node scripts/gen-notification-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'notification');

/* ─── the mark, in a 24-unit design space (mirrors ic_stat_notification.xml) ─ */
const C = { x: 12, y: 12 };       // ring centre
const R = 7.5;                    // ring radius
const HW = 1.1;                   // ring half-thickness (stroke 2.2)
const ARC_R = [-75, 75];          // right arc, degrees, screen-clockwise
const ARC_L = [105, 255];         // left arc
const TRI_R = [[10.08, 20.28], [14.61, 21.75], [13.27, 16.73]]; // right head, points down
const TRI_L = [[13.92, 3.72], [9.39, 2.25], [10.73, 7.27]];     // left head, points up

const deg = (rad) => (rad * 180) / Math.PI;
const norm360 = (a) => ((a % 360) + 360) % 360;

function inArc(a, [from, to]) {
  const x = norm360(a);
  const f = norm360(from);
  const t = norm360(to);
  return f <= t ? x >= f && x <= t : x >= f || x <= t;
}

function inTri(p, tri) {
  const [a, b, c] = tri;
  const P = [p.x, p.y]; // triangles are plain [x, y] pairs; points are {x, y}
  const s = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const d1 = s(a, b, P);
  const d2 = s(b, c, P);
  const d3 = s(c, a, P);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** The neon ramp of the logo, by angle: top cyan → right/bottom magenta → left violet → cyan. */
const STOPS = [
  [0.0, [0, 229, 255]],
  [0.5, [255, 45, 149]],
  [0.75, [124, 77, 255]],
  [1.0, [0, 229, 255]]
];
function ramp(t) {
  for (let i = 1; i < STOPS.length; i += 1) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k)
      ];
    }
  }
  return STOPS[0][1];
}

/** Shape test at a design-space point: null, or {rgb} when inside the mark. */
function markAt(p) {
  if (inTri(p, TRI_R) || inTri(p, TRI_L)) {
    return { rgb: ramp(norm360(deg(Math.atan2(p.y - C.y, p.x - C.x)) + 90) / 360) };
  }
  const dx = p.x - C.x;
  const dy = p.y - C.y;
  const d = Math.hypot(dx, dy);
  if (Math.abs(d - R) <= HW) {
    const a = norm360(deg(Math.atan2(dy, dx)));
    if (inArc(a, ARC_R) || inArc(a, ARC_L)) {
      return { rgb: ramp(norm360(a + 90) / 360) };
    }
  }
  return null;
}

/* ─── PNG encoder (spec-literal: IHDR, IDAT via zlib, IEND, CRC-32) ────────── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: truecolour + alpha
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const BG = [0, 3, 15]; // FBT black, the same #00030F the splash and theme use
const SS = 5;          // 5×5 supersamples per pixel — clean edges without a rasteriser lib

/**
 * @param {number} size      edge in px
 * @param {boolean} mono    true = white-on-transparent badge; false = colour icon on FBT black
 */
function render(size, mono) {
  const k = size / 24;
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let cover = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let glow = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const p = { x: (x + (sx + 0.5) / SS) / k, y: (y + (sy + 0.5) / SS) / k };
          const hit = markAt(p);
          if (hit) {
            cover += 1;
            cr += hit.rgb[0];
            cg += hit.rgb[1];
            cb += hit.rgb[2];
          } else if (!mono) {
            /* Cheap neon bloom: gaussian falloff from the ring band, taken
               over the WHOLE circle — a real neon tube lights the gaps
               between its arcs too, and gating the glow by arc angle drew
               dark pie wedges above and below the mark. */
            const d = Math.abs(Math.hypot(p.x - C.x, p.y - C.y) - R);
            if (d > HW) {
              const dd = (d - HW) / 2.4;
              glow += Math.exp(-dd * dd) * 0.34;
            }
          }
        }
      }
      const alpha = cover / (SS * SS);
      const i = (y * size + x) * 4;
      if (mono) {
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
        px[i + 3] = Math.round(alpha * 255);
      } else {
        const mr = alpha ? cr / cover : 0;
        const mg = alpha ? cg / cover : 0;
        const mb = alpha ? cb / cover : 0;
        const g = Math.min(1, glow / (SS * SS));
        // The bloom takes its colour from the ramp at THIS pixel's angle, so
        // the halo around a cyan arc is cyan — not the (possibly absent)
        // mark colour of the same pixel.
        const pc = ramp(norm360(deg(Math.atan2((y + 0.5) / k - C.y, (x + 0.5) / k - C.x)) + 90) / 360);
        // background + glow, then the mark composited over it
        const br = BG[0] + pc[0] * g * 0.9;
        const bgc = BG[1] + pc[1] * g * 0.9;
        const bb = BG[2] + pc[2] * g * 0.9;
        px[i] = Math.round(br + (mr - br) * alpha);
        px[i + 1] = Math.round(bgc + (mg - bgc) * alpha);
        px[i + 2] = Math.round(bb + (mb - bb) * alpha);
        px[i + 3] = 255;
      }
    }
  }
  return encodePng(size, px);
}

mkdirSync(OUT, { recursive: true });
const jobs = [
  ['badge-96.png', 96, true],
  ['badge-192.png', 192, true],
  ['icon-color-192.png', 192, false],
  ['icon-color-512.png', 512, false]
];
for (const [name, size, mono] of jobs) {
  const buf = render(size, mono);
  writeFileSync(join(OUT, name), buf);
  // eslint-disable-next-line no-console
  console.log(`notification/${name}  ${size}×${size}  ${buf.length} bytes`);
}
// eslint-disable-next-line no-console
console.log('OK — notification icons regenerated from the brand geometry.');
