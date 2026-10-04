/* ==========================================================================
   tools/grade.mjs — the finishing pass
   --------------------------------------------------------------------------
   The film is graded in two halves.

   In the browser, `#bloom`, `#vignette` and `#grain` are DOM layers laid over
   the canvases. They are what makes a render feel like a photograph of a
   screen rather than a screenshot of one — but in a software rasteriser each
   blended full-screen layer costs a full-frame composite, which was measured
   at 1.7-2.5x the render time. So the offline pass runs the browser *without*
   them (`?lite=1`) and this file paints the same three layers in ffmpeg,
   straight into the encoder. One generation, no intermediate file, and the
   cost lands on the encoder instead of the compositor.

   The two overlay plates are generated from the film's own CSS, so the grade
   matches the design instead of approximating it:

     #bloom    radial-gradient(60% 45% at 50% 52%, rgba(64,132,255,.06),
                              transparent 70%)           mix-blend-mode: screen
     #vignette radial-gradient(120% 90% at 50% 50%, transparent 54%,
                              rgba(0,0,0,.34) 90%, rgba(0,0,0,.55) 100%) +
               linear-gradient(180deg, rgba(0,0,0,.35), transparent 22%,
                              transparent 78%, rgba(0,0,0,.45))
     #grain    a 5% overlay-blended noise tile

   Grain is the one deliberate departure: the CSS tile is a *static* pattern,
   which reads as a dirty lens once it is fixed for ten minutes. This pass uses
   a temporal grain of the same strength, which is what film actually does.

   Usage
     node tools/grade.mjs --layers                        # regenerate the plates
     node tools/grade.mjs --in a.mp4 --out b.mp4 --crf 16 # grade an existing file
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLATES = path.join(HERE, '..', 'assets', 'grade');
export const BLOOM_PNG = path.join(PLATES, 'bloom.png');
export const VIGNETTE_PNG = path.join(PLATES, 'vignette.png');

const FFMPEG = process.env.FILM_FFMPEG ||
  '/home/user/film-tools/node_modules/@ffmpeg-installer/linux-x64/ffmpeg';

/* ── a minimal PNG writer ──────────────────────────────────────────────────
   Two soft gradients do not justify a dependency. Encodes truecolour+alpha,
   one IDAT, filter type 0.                                                   */
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePNG(file, w, h, paint) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    raw[row] = 0;                                   // filter: none
    for (let x = 0; x < w; x++) {
      paint(x, y, px);
      const o = row + 1 + x * 4;
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2]; raw[o + 3] = px[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]));
}

/* ── the two plates ───────────────────────────────────────────────────────
   Bloom is written on black because ffmpeg screens it onto the frame; the
   vignette carries real alpha because it is composited normally.            */
export const BLOOM_COLOR = [64, 132, 255];

export function buildPlates(w = 3840, h = 2160) {
  const cx = w * 0.50, cy = h * 0.52;
  const rx = w * 0.60, ry = h * 0.45;
  writePNG(BLOOM_PNG, w, h, (x, y, out) => {
    const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
    // CSS ramps from the colour stop to `transparent 70%` of the ellipse.
    const t = Math.max(0, Math.min(1, 1 - r / 0.70));
    out[0] = Math.round(BLOOM_COLOR[0] * t);
    out[1] = Math.round(BLOOM_COLOR[1] * t);
    out[2] = Math.round(BLOOM_COLOR[2] * t);
    out[3] = 255;
  });

  const ax = w * 1.20, ay = h * 0.90, acx = w * 0.5, acy = h * 0.5;
  writePNG(VIGNETTE_PNG, w, h, (x, y, out) => {
    const r = Math.hypot((x - acx) / ax, (y - acy) / ay);
    let a = 0;                                       // first colour stop
    if (r > 0.54) {
      a = r <= 0.90
        ? ((r - 0.54) / 0.36) * 0.34
        : Math.min(1, 0.34 + ((r - 0.90) / 0.10) * (0.55 - 0.34));
    }
    const u = y / h;                                 // linear top/bottom falloff
    const b = u < 0.22 ? 0.35 * (1 - u / 0.22)
      : u > 0.78 ? 0.45 * ((u - 0.78) / 0.22)
        : 0;
    const al = Math.min(1, a + b * (1 - a));
    out[0] = 0; out[1] = 0; out[2] = 0;
    out[3] = Math.round(al * 255);
  });
  return { bloom: BLOOM_PNG, vignette: VIGNETTE_PNG };
}

export function platesExist() {
  return fs.existsSync(BLOOM_PNG) && fs.existsSync(VIGNETTE_PNG);
}
export function ensurePlates() {
  if (!platesExist()) buildPlates();
  return { bloom: BLOOM_PNG, vignette: VIGNETTE_PNG };
}

/* ── the graph ────────────────────────────────────────────────────────────
   Input 0 is the film, input 1 the bloom plate, input 2 the vignette plate.
   Screen blending happens in RGB: in YUV the chroma planes carry a 128 offset
   and a screen blend would tint every mid-grey.                             */
export function gradeFilter(w, h, opts = {}) {
  const bloom = opts.bloom ?? 0.06;
  const grain = opts.grain ?? 4;
  const scale = opts.scale === false ? '' : `scale=${w}:${h}:flags=lanczos,`;
  return [
    `[0:v]${scale}setsar=1,format=rgb24[base]`,
    `[1:v]scale=${w}:${h}:flags=bilinear[bl]`,
    `[base][bl]blend=all_mode=screen:all_opacity=${bloom}[lit]`,
    `[2:v]scale=${w}:${h}:flags=bilinear[vg]`,
    `[lit][vg]overlay=0:0:format=rgb[shaded]`,
    `[shaded]noise=alls=${grain}:allf=t,format=yuv420p[graded]`
  ].join(';');
}

export function gradeInputs() {
  const p = ensurePlates();
  return ['-loop', '1', '-i', p.bloom, '-loop', '1', '-i', p.vignette];
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
  if (process.argv.includes('--layers') || arg('in', null) === null) {
    buildPlates();
    for (const f of [BLOOM_PNG, VIGNETTE_PNG]) {
      console.log(`[grade] ${path.relative(process.cwd(), f)} · ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
    }
  } else {
    const input = arg('in');
    const output = arg('out', input.replace(/\.mp4$/, '-graded.mp4'));
    const height = Number(arg('height', 2160));
    const width = Number(arg('width', Math.round(height * 16 / 9)));
    const crf = String(arg('crf', 16));
    const preset = arg('preset', 'veryfast');
    const dur = arg('duration', null);   // output bound — required, see below
    ensurePlates();
    /*
     * `-t` bounds the OUTPUT, not the input. It is not cosmetic: with the two
     * still plates feeding split/overlay, this ffmpeg's framesync never signals
     * the end of the graph when the film's last frame arrives — the encoder
     * spins at full CPU forever and, because the index is written last, leaves
     * an unplayable file with no moov atom. Measured: a full pass burned 50
     * minutes and produced exactly nothing. The bound makes the graph end the
     * moment the film does.
     */
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input, ...gradeInputs(),
      '-filter_complex', gradeFilter(width, height, { bloom: Number(arg('bloom', 0.06)), grain: Number(arg('grain', 4)) }),
      ...(dur ? ['-t', String(dur)] : []),
      '-map', '[graded]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p',
      '-c:a', 'copy', '-movflags', '+faststart',
      output
    ];
    console.log(`[grade] ${path.basename(input)} → ${path.basename(output)} · ${width}x${height} crf ${crf}`);
    const t0 = Date.now();
    await new Promise((res, rej) => {
      const p = spawn(FFMPEG, args, { stdio: ['ignore', 'inherit', 'inherit'] });
      p.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
    });
    const mb = (fs.statSync(output).size / 1048576).toFixed(0);
    console.log(`[grade] done in ${((Date.now() - t0) / 1000).toFixed(0)}s · ${mb} MB`);
  }
}
