/* ==========================================================================
   tools/build_audio.mjs — the mix
   --------------------------------------------------------------------------
   Three elements become one master track:
     · the narration (one generated clip per scene, placed at its scripted second)
     · the score (tools/score.mjs)
     · the sound design (tools/sfx.mjs)

   Music and effects are side-chain ducked under the voice — the same move a
   documentary mixer makes — so the narration is always intelligible without
   the score disappearing. Output is a stereo WAV plus a timing file the film
   itself reads, so on-screen words can be paced to what the narrator actually
   says rather than to a guess.

   Usage:
     node tools/build_audio.mjs --voice /path/to/narration --music ... --sfx ...
   ========================================================================== */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

const FF = ffmpegPath.path;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };

const WORK = arg('work', '/home/user/film-work/audio');
const VOICE_DIR = arg('voice', path.join(WORK, 'narration'));
const MUSIC = arg('music', path.join(WORK, 'music.wav'));
const SFX = arg('sfx', path.join(WORK, 'sfx.wav'));
const OUT = arg('out', path.join(WORK, 'master.wav'));
const TIMING = arg('timing', path.join(ROOT, 'src/narration-timing.js'));
const FPS_TOLERANCE = 0.4;

const script = JSON.parse(await fsp.readFile(path.join(HERE, 'narration.json'), 'utf8'));
const run = (file, args, { allowFail = false } = {}) => new Promise((res, rej) => {
  const p = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('exit', (c) => (c === 0 || allowFail ? res({ out, err, code: c }) : rej(new Error(`${file} failed (${c})\n${err.slice(-2000)}`))));
});

const probe = async (file) => {
  const { out } = await run(FF, ['-hide_banner', '-i', file], { allowFail: true });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(out + '');
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

/* ── 1 · place every narration clip on the timeline ───────────────────── */
const missing = [];
const placed = [];
for (const clip of script.clips) {
  const candidates = [
    path.join(VOICE_DIR, `${clip.id}.mp3`),
    path.join(VOICE_DIR, `${clip.id}.wav`),
    path.join(VOICE_DIR, `${clip.id}.m4a`)
  ];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) { missing.push(clip.id); continue; }
  const d = await probe(file);
  placed.push({ ...clip, file, duration: d });
}
if (missing.length) {
  console.error('[audio] MISSING narration clips:', missing.join(', '));
  console.error('[audio] expected files in', VOICE_DIR);
  process.exit(2);
}

console.log('[audio] narration timeline:');
for (const p of placed) {
  const end = p.start + p.duration;
  const over = end > script.clips.find((c) => c.id === p.id).start + 60 ? ' ⚠ long' : '';
  console.log(`   ${p.id.padEnd(6)} ${p.start.toFixed(1)}s → ${end.toFixed(1)}s  (${p.duration.toFixed(1)}s)${over}`);
}

/* ── 2 · build the ffmpeg graph ───────────────────────────────────────── */
// Every clip is delayed to its second and summed. Inputs are indexed so the
// ducking can reference the narration bus by label, not by position.
const inputs = [];
const filters = [];
const voiceLabels = [];
placed.forEach((p, i) => {
  inputs.push('-i', p.file);
  const ms = Math.round(p.start * 1000);
  // tiny per-clip trim so the voice sits in a consistent, quiet room
  filters.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
    `highpass=f=70,lowpass=f=12000,acompressor=threshold=-20dB:ratio=2.6:attack=8:release=220:makeup=3,` +
    `volume=1.0,adelay=${ms}|${ms},apad=whole_dur=600[v${i}]`);
  voiceLabels.push(`[v${i}]`);
});
const voiceMix = `${voiceLabels.join('')}amix=inputs=${voiceLabels.length}:normalize=0:dropout_transition=0,` +
  `volume=2.6,alimiter=limit=0.94:level=false,asplit=2[voice][voicekey]`;

const SFX_IDX = placed.length;
const MUSIC_IDX = placed.length + 1;
inputs.push('-i', SFX, '-i', MUSIC);

const graph = [
  ...filters,
  voiceMix,
  // sfx: bright, close, riding just under the voice
  `[${SFX_IDX}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0.85[sfx]`,
  // music: the bed. Silent-ish where the voice is dense (side chain), present where it is not.
  `[${MUSIC_IDX}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=1.10[mus]`,
  `[mus][voicekey]sidechaincompress=threshold=0.055:ratio=5.5:attack=60:release=900:makeup=1[musd]`,
  `[sfx][voicekey]sidechaincompress=threshold=0.06:ratio=3.2:attack=25:release=420:makeup=1[sfxd]`,
  // the mix order is deliberate: score under effects, effects under the voice
  `[musd][sfxd][voice]amix=inputs=3:normalize=0:weights=1 1 1.35,` +
  `loudnorm=I=-16:TP=-1.5:LRA=11:linear=true,alimiter=limit=0.97:level=false,` +
  `afade=t=in:st=0:d=1.5,afade=t=out:st=595.5:d=4.5[master]`
].join(';');

console.log('[audio] mixing', placed.length, 'voice clips + score + sound design …');
const t0 = Date.now();
await run(FF, [
  '-hide_banner', '-loglevel', 'error', '-y',
  ...inputs,
  '-filter_complex', graph,
  '-map', '[master]',
  '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2',
  OUT
]);
console.log(`[audio] master written → ${OUT} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

/* ── 3 · the timing file the film reads ───────────────────────────────── */
const timing = {
  _: 'GENERATED by tools/build_audio.mjs — do not edit. Measured narration timings, so on-screen words land with the voice.',
  master: path.basename(OUT),
  clips: placed.map((p) => ({ id: p.id, start: +p.start.toFixed(3), duration: +p.duration.toFixed(3), end: +(p.start + p.duration).toFixed(3) }))
};
await fsp.writeFile(TIMING,
  '/* GENERATED by tools/build_audio.mjs — measured narration timings. */\n' +
  'export const NARRATION = ' + JSON.stringify(timing.clips, null, 2) + ';\n' +
  'export const narrationById = (id) => NARRATION.find((c) => c.id === id) || null;\n');
console.log('[audio] timing file →', TIMING);

void FPS_TOLERANCE;
