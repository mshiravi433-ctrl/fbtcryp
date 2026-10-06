#!/usr/bin/env node
/**
 * GLOBE LAND MASK GENERATOR (one-off, dev only — never runs at build time)
 * ---------------------------------------------------------------------------
 * The «FBT جهانی» globe draws a real 3-D dot matrix of the continents. That
 * matrix is baked into the bundle as a compact base64 bit grid so the globe
 * costs ZERO network requests and no GeoJSON/tiles at runtime.
 *
 * Source: Natural Earth 110m land polygons (public domain), via the npm
 * packages `world-atlas` + `topojson-client` (dev-only — neither is imported
 * by the app):
 *
 *   npm i -D world-atlas topojson-client
 *   node scripts/gen-globe-landmask.mjs
 *
 * Output: src/components/ai/worldState/landMask.js (2° grid ⇒ 180×90 bits,
 * ~2.7 KB of base64 — small enough to live in the panel's own chunk).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const OUT = new URL('../src/components/ai/worldState/landMask.js', import.meta.url);
const STEP = 2; // degrees per cell
const COLS = Math.round(360 / STEP);
const ROWS = Math.round(180 / STEP);

const require = createRequire(import.meta.url);
let feature;
try {
  ({ feature } = require('topojson-client'));
} catch {
  console.error('missing dev deps — run: npm i -D world-atlas topojson-client');
  process.exit(2);
}
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/land-110m.json'), 'utf8'));
const land = feature(topo, topo.objects.land);

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]; const yi = ring[i][1];
    const xj = ring[j][0]; const yj = ring[j][1];
    const hit = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
const polys = [];
for (const f of land.features) {
  const g = f.geometry;
  if (!g) continue;
  if (g.type === 'Polygon') polys.push(g.coordinates);
  else for (const c of g.coordinates) polys.push(c);
}
function isLand(lon, lat) {
  for (const poly of polys) {
    if (!inRing(lon, lat, poly[0])) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h += 1) if (inRing(lon, lat, poly[h])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

const bits = new Uint8Array(ROWS * COLS);
let art = '';
for (let r = 0; r < ROWS; r += 1) {
  const lat = 90 - STEP / 2 - r * STEP;
  let line = '';
  for (let c = 0; c < COLS; c += 1) {
    const lon = -180 + STEP / 2 + c * STEP;
    const v = isLand(lon, lat) ? 1 : 0;
    bits[r * COLS + c] = v;
    line += v ? '#' : '.';
  }
  art += ` * ${line}\n`;
}
const bytes = new Uint8Array(Math.ceil(bits.length / 8));
for (let i = 0; i < bits.length; i += 1) if (bits[i]) bytes[i >> 3] |= 128 >> (i & 7);
const b64 = Buffer.from(bytes).toString('base64');

const file = `/**
 * FBT WORLD CONSOLE — globe land mask (GENERATED, do not edit by hand).
 * ---------------------------------------------------------------------------
 * A ${STEP}° binary grid of Earth's land masses (${COLS}×${ROWS} cells), built from
 * Natural Earth 110m land polygons (public domain) by
 * scripts/gen-globe-landmask.mjs and packed as base64 so the 3-D dot globe
 * needs no GeoJSON, no tiles and no network read at runtime.
 *${art} */
export const LAND_MASK = Object.freeze({
  step: ${STEP},
  cols: ${COLS},
  rows: ${ROWS},
  /* row 0 = lat +89, col 0 = lon −179 (row-major, MSB first) */
  b64: '${b64}'
});

let cache = null;
function bitsOf() {
  if (cache) return cache;
  const bytes = typeof atob === 'function'
    ? Uint8Array.from(atob(LAND_MASK.b64), (ch) => ch.charCodeAt(0))
    : Uint8Array.from(Buffer.from(LAND_MASK.b64, 'base64'));
  cache = bytes;
  return cache;
}

/** Real land test for a lat/lon pair, straight off the baked grid. */
export function isLandAt(lat, lon) {
  const col = Math.floor(((Number(lon) + 180) % 360 + 360) % 360 / LAND_MASK.step);
  const row = Math.floor((90 - Number(lat)) / LAND_MASK.step);
  if (row < 0 || row >= LAND_MASK.rows || col < 0 || col >= LAND_MASK.cols) return false;
  const bit = row * LAND_MASK.cols + col;
  return (bitsOf()[bit >> 3] & (128 >> (bit & 7))) !== 0;
}

/** Every land cell as a lat/lon pair — the globe's dot matrix source. */
export function landCells() {
  const out = [];
  for (let row = 0; row < LAND_MASK.rows; row += 1) {
    const lat = 90 - LAND_MASK.step / 2 - row * LAND_MASK.step;
    for (let col = 0; col < LAND_MASK.cols; col += 1) {
      const bit = row * LAND_MASK.cols + col;
      if (bitsOf()[bit >> 3] & (128 >> (bit & 7))) {
        out.push([lat, -180 + LAND_MASK.step / 2 + col * LAND_MASK.step]);
      }
    }
  }
  return out;
}

export default LAND_MASK;
`;
writeFileSync(OUT, file);
console.log(`wrote ${OUT.pathname} — ${COLS}×${ROWS} cells, base64 ${b64.length} chars`);
