/* ==========================================================================
   render.mjs — the camera crew
   --------------------------------------------------------------------------
   Loads the film in a real Chromium, seeks frame by frame at 24fps and pipes
   each frame straight into ffmpeg. Segments are encoded separately so a long
   render is restartable and a crash never costs more than one segment.

   Usage:
     node tools/render.mjs --stills 12,35,60 --scale 0.5     # review frames
     node tools/render.mjs --from 0 --to 45 --segment 45 --scale 1
     node tools/render.mjs --all --segment 30 --scale 1 --crf 12

   The Chromium used here is @sparticuz/chromium, which ships its own binary
   and needs libnspr4/libnss3/libnssutil3 — extracted from the same package
   (see ensureLibs) because the sandbox has no apt.
   ========================================================================== */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { gradeFilter, gradeInputs } from './grade.mjs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILM_DIR = path.resolve(HERE, '..');
const WORK = process.env.FILM_WORK || '/home/user/film-work';
const FFMPEG = ffmpegPath.path;

/* ── args ─────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes('--' + name);

const SCALE = Number(arg('scale', 1));       // device pixel factor (2 = 4K)
const FPS = Number(arg('fps', 24));
const SEGMENT = Number(arg('segment', 30));  // seconds per encoded segment
const CRF = Number(arg('crf', 12));
const PRESET = arg('preset', 'veryfast');
/*
 * Optional finishing filters, applied by ffmpeg rather than the browser.
 * A temporal grain and an optical vignette cost the encoder a few percent and
 * would cost the renderer 1.5-2x if a compositor had to blend them at 4K.
 * Default keeps the encode clean; the film is graded in pass two with
 * `--vf "noise=alls=4:allf=t,vignette=angle=PI/5"`.
 */
const VF = arg('vf', '');
/* --grade bakes the finishing pass (bloom · vignette · grain) into the same
   encode, so the master is one generation instead of two. See tools/grade.mjs
   for why those layers live in ffmpeg rather than in the browser. */
const GRADE = arg('grade', '0') === '1';
const OUT = arg('out', path.join(WORK, 'segments'));
const PORT = Number(arg('port', 8123));
const LITE = arg('lite', '0') === '1';
const STILLS = arg('stills', null);
const FROM = Number(arg('from', 0));
const TO = Number(arg('to', 600));
const DURATION = 600;

/* ── the browser's missing system libraries ───────────────────────────── */
async function ensureLibs() {
  const dest = '/tmp/fbt-chromium-libs';
  if (fs.existsSync(path.join(dest, 'libnss3.so'))) return dest;
  const candidates = [
    '/home/user/film-tools/node_modules/@sparticuz/chromium/bin/al2023.tar.br',
    path.resolve(FILM_DIR, '../../../film-tools/node_modules/@sparticuz/chromium/bin/al2023.tar.br'),
    path.resolve(HERE, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br')
  ];
  const src = candidates.find((c) => fs.existsSync(c));
  if (!src) throw new Error('al2023.tar.br not found — reinstall @sparticuz/chromium');
  await fsp.mkdir('/tmp/fbt-llib', { recursive: true });
  const buf = zlib.brotliDecompressSync(await fsp.readFile(src));
  await fsp.writeFile('/tmp/fbt-llib/al2023.tar', buf);
  await fsp.mkdir(dest, { recursive: true });
  await new Promise((res, rej) => {
    const p = spawn('tar', ['xf', '/tmp/fbt-llib/al2023.tar', '-C', '/tmp/fbt-llib']);
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error('tar failed'))));
  });
  await fsp.cp(path.join('/tmp/fbt-llib', 'lib'), dest, { recursive: true, force: true });
  return dest;
}

/* ── a tiny static server: modules and fonts need an http origin ──────── */
function serve(root, port) {
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.json': 'application/json',
    '.png': 'image/png', '.svg': 'image/svg+xml'
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(root, url === '/' ? '/src/index.html' : url.replace(/^\/film\//, '/'));
      const real = path.resolve(file);
      if (!real.startsWith(path.resolve(root))) { res.writeHead(403).end(); return; }
      const data = await fsp.readFile(real);
      res.writeHead(200, { 'content-type': types[path.extname(real)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve(server)));
}

/* ── frame stream → ffmpeg ────────────────────────────────────────────── */
function ffmpegSegment(file, fps = FPS, crf = CRF, preset = PRESET, size = null) {
  const w = size ? size.w : 1920 * SCALE;
  const h = size ? size.h : 1080 * SCALE;
  const film = ['-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
  const args = [
    '-hide_banner', '-loglevel', 'error',
    ...film,
    ...(GRADE ? gradeInputs() : []),
    ...(GRADE
      ? ['-filter_complex', gradeFilter(w, h), '-map', '[graded]']
      : (VF ? ['-vf', VF] : [])),
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-g', '48',
    '-movflags', '+faststart', '-y', file
  ];
  const p = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  return p;
}

function writeAsync(stream, buf) {
  return new Promise((res, rej) => {
    if (stream.write(buf)) res();
    else stream.once('drain', res);
    stream.once('error', rej);
  });
}

/* ── main ─────────────────────────────────────────────────────────────── */
const libDir = await ensureLibs();
process.env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
const exePath = await chromium.executablePath();

/*
 * RENDERER ARGUMENTS — measured, not copied from the package's defaults.
 *
 * @sparticuz/chromium ships flags aimed at functional cold starts on Lambda,
 * not at throughput: it runs `--single-process --in-process-gpu` and routes
 * compositing through ANGLE/SwiftShader. On this sandbox that costs 1.7-2.5 s
 * per 4K frame. Disabling GPU compositing entirely and going back to one
 * process per renderer puts the same frame at 0.25-0.4 s — a 4x gain — with
 * no visible difference in the output (SSIM 0.97-0.99 against the SwiftShader
 * render, entirely antialiasing noise; text rasterises identically).
 */
const RENDER_ARGS = [
  ...chromium.args.filter((a) => a !== '--single-process' && a !== '--in-process-gpu'),
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--mute-audio',
  '--hide-scrollbars',
  '--font-render-hinting=none',
  '--force-color-profile=srgb'
];

const server = await serve(FILM_DIR, PORT);
const browser = await puppeteer.launch({
  args: RENDER_ARGS,
  executablePath: exePath,
  headless: 'shell',
  protocolTimeout: 600000,
  /*
   * TRUE RESOLUTION, not a hint.
   *
   * `deviceScaleFactor` does not scale CDP captures — it only changes how the
   * compositor is asked to rasterise, and `Page.captureScreenshot` still
   * returns CSS-pixel-sized frames. So the stage is rendered at
   * 1920x1080 CSS px and the *viewport* is the target resolution; `fit()` in
   * film.js scales #stage to fill it (2x at 4K), which rasterises the type and
   * the canvases at device pixels. Measured: 3840x2160 viewport ≈ 0.9 s/frame
   * against 0.58 s/frame for a 1080p one — the honest cost of 4K here.
   */
  defaultViewport: { width: 1920 * SCALE, height: 1080 * SCALE, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/src/index.html${LITE ? '?lite=1' : ''}`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__filmReady === true', { timeout: 60000 });
console.log('[render] film ready · scale', SCALE, '· ffmpeg', FFMPEG);

/*
 * FRAME CAPTURE — through CDP, not through page.screenshot().
 *
 * Measured at 3840x2160 on the two-core sandbox this film was rendered in:
 *   page.screenshot({type:'png'}) ............ 3480 ms/frame
 *   CDP Page.captureScreenshot ................ 620 ms/frame   ← used here
 * Puppeteer's API adds a full readback of the compositor surface on top of
 * the capture itself. At 14 400 frames that difference is hours.
 */
const cdp = await (async () => { const c = await page.createCDPSession(); await c.send('Page.enable'); return c; })();

async function shoot(t, format = 'png', quality) {
  await page.evaluate((tt) => window.__film.seek(tt), t);
  const res = await cdp.send('Page.captureScreenshot', {
    format, quality, optimizeForSpeed: true, fromSurface: true, captureBeyondViewport: false
  });
  return Buffer.from(res.data, 'base64');
}

/** Warm-up: render the frame twice before timing/capturing, so the first
 *  raster of a changed layer never lands in the encoded stream. */
async function shootSettled(t) {
  await page.evaluate((tt) => window.__film.seek(tt), t);
  const buffered = await shoot(t);
  await shoot(t);
  return buffered;
}

/* still frames for review */
if (STILLS) {
  const times = STILLS === 'all'
    ? [3, 12, 26, 33, 41, 48, 60, 70, 86, 95, 104, 112, 126, 134, 143, 152, 160, 178, 190, 205, 216, 232, 244, 258, 272, 288, 300, 314, 330, 344, 360, 376, 392, 410, 424, 440, 452, 468, 484, 496, 508, 520, 534, 548, 560, 572, 583, 590, 596]
    : STILLS.split(',').map(Number);
  const dir = path.join(WORK, 'stills');
  await fsp.mkdir(dir, { recursive: true });
  const t0 = Date.now();
  for (const t of times) {
    const buf = await shoot(t, 'jpeg', 90);
    await fsp.writeFile(path.join(dir, `t${String(Math.round(t * 10)).padStart(6, '0')}.jpg`), buf);
    console.log(`[still] ${t}s → ${(buf.length / 1024).toFixed(0)} KB · ${((Date.now() - t0) / 1000).toFixed(1)}s elapsed`);
  }
  console.log('[render] stills done' + (errors.length ? ` · ${errors.length} page errors` : ''));
  if (errors.length) console.log(errors.slice(0, 12).join('\n'));
  await browser.close(); server.close();
  process.exit(0);
}

/* the render itself */
await fsp.mkdir(OUT, { recursive: true });
const range = has('all') ? [0, DURATION] : [FROM, TO];
const segs = [];
for (let start = range[0]; start < range[1]; start += SEGMENT) {
  const end = Math.min(start + SEGMENT, range[1]);
  const id = String(segs.length).padStart(3, '0');
  const file = path.join(OUT, `seg_${id}_${String(start).padStart(4, '0')}-${String(end).padStart(4, '0')}.mp4`);
  if (fs.existsSync(file)) { console.log('[render] exists, skip', path.basename(file)); segs.push(file); continue; }

  const ff = ffmpegSegment(file);
  const frames = Math.round((end - start) * FPS);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    const t = start + f / FPS;
    const buf = await shootSettled(t);
    await writeAsync(ff.stdin, buf);
    if (f % 48 === 0) {
      const el = (Date.now() - t0) / 1000;
      const rate = (f + 1) / Math.max(el, 0.001);
      process.stdout.write(`\r[render] seg ${id} ${start}-${end}s · ${f + 1}/${frames} frames · ${rate.toFixed(2)} fps · eta ${((frames - f) / Math.max(rate, 0.001) / 60).toFixed(1)}min   `);
    }
  }
  ff.stdin.end();
  await new Promise((res) => ff.on('exit', res));
  process.stdout.write('\n');
  console.log(`[render] segment done → ${path.basename(file)} · ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
  segs.push(file);
  await fsp.writeFile(path.join(OUT, 'segments.json'), JSON.stringify(segs, null, 2));
}

console.log('[render] complete · segments:', segs.length);
if (errors.length) console.log('[render] page errors:\n' + errors.slice(0, 20).join('\n'));
await browser.close();
server.close();
