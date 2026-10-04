/* ==========================================================================
   tools/assemble.mjs — the final pass
   --------------------------------------------------------------------------
   Concatenates the encoded segments, muxes the master audio, and writes the
   deliverable. Optionally delegates the 4K→1080p downscale used for the
   GitHub-hosted copy (the repository should not carry an 11 GB master).

   Usage:
     node tools/assemble.mjs --segments DIR --audio master.wav --out film-4k.mp4
     node tools/assemble.mjs --input film-4k.mp4 --out film-1080p.mp4 --height 1080
   ========================================================================== */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

const FF = ffmpegPath.path;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };

const run = (args) => new Promise((res, rej) => {
  const p = spawn(FF, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
});

const SEGMENTS = arg('segments', null);
const AUDIO = arg('audio', null);
const OUT = arg('out', path.join(HERE, '../out/film.mp4'));
const INPUT = arg('input', null);
const HEIGHT = arg('height', null);
const FPS = Number(arg('fps', 24));

await fsp.mkdir(path.dirname(OUT), { recursive: true });

if (INPUT) {
  /* a straight transcode — used for the 1080p web copy */
  const vf = HEIGHT ? `scale=-2:${HEIGHT}:flags=lanczos` : 'null';
  console.log('[assemble] transcoding', INPUT, '→', OUT);
  await run(['-hide_banner', '-y', '-i', INPUT,
    '-vf', vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-g', '48', '-movflags', '+faststart',
    '-c:a', 'copy', OUT]);
  console.log('[assemble] done →', OUT);
  process.exit(0);
}

/* ── segments → one film ──────────────────────────────────────────────── */
const files = (await fsp.readdir(SEGMENTS))
  .filter((f) => /^seg_\d+_.*\.mp4$/.test(f))
  .sort();
if (!files.length) throw new Error('no segments in ' + SEGMENTS);
console.log('[assemble] ' + files.length + ' segments');

const listFile = path.join(SEGMENTS, 'concat.txt');
await fsp.writeFile(listFile, files.map((f) => `file '${path.resolve(SEGMENTS, f)}'`).join('\n') + '\n');

const silent = path.join(SEGMENTS, '_video.mp4');
await run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silent]);

if (AUDIO && fs.existsSync(AUDIO)) {
  console.log('[assemble] muxing audio');
  await run(['-hide_banner', '-loglevel', 'error', '-y',
    '-i', silent, '-i', AUDIO,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
    '-shortest', '-movflags', '+faststart',
    OUT]);
} else {
  await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', silent, '-c', 'copy', '-movflags', '+faststart', OUT]);
}
console.log('[assemble] master →', OUT);
void FPS;
