#!/usr/bin/env node
/**
 * BUILD THE APP'S OWN NOTIFICATION TONE
 * ---------------------------------------------------------------------------
 * «نوتیفیکیشن اپلیکیشن وقتی میاد روی صفحه اندروید … یک آهنگ نوتیفیکیشن بزنه
 * که خاص باشد» — a sound nobody else's phone makes, so the alert is recognised
 * before the screen is even looked at.
 *
 * WHY IT IS SYNTHESISED RATHER THAN SHIPPED AS AUDIO WE BOUGHT
 *   • licence: a stock notification sample is somebody's copyrighted work and
 *     this is a commercial APK; a tone we generate is ours;
 *   • size: the whole file is ~1.3 s of mono PCM — about 118 KB, against the
 *     several megabytes of a licensed loop;
 *   • reproducibility: this script is the source. Change a number here, run
 *     it, and the binary in res/raw is rebuilt byte-for-byte identically,
 *     which is the only way a binary asset can honestly live in git.
 *
 * WHY WAV AND NOT OGG/MP3
 *   Android plays a PCM WAV from res/raw with no decoder to negotiate and no
 *   container the OEM's RingtoneManager might refuse; and this repo has no
 *   encoder in its toolchain, so "generate an ogg" would mean shipping a
 *   binary nobody here can regenerate. 118 KB once is a fair price for an
 *   asset that is guaranteed to play.
 *
 * HOW THE TONE IS BUILT
 *   Three ascending partials of an A-major triad (A5 → E6 → A6), each one a
 *   small stack of harmonics with a fast attack and an exponential decay —
 *   the shape of a struck bell rather than a beep. A quiet fourth shimmer an
 *   octave above the last note is what makes it read as "ours" instead of
 *   "a default chime", and a 40 ms fade-out keeps the last sample from
 *   clicking on a cheap speaker.
 *
 * Run: node scripts/gen-notification-sound.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 44100;
const OUT = new URL('../android/app/src/main/res/raw/fbt_notification.wav', import.meta.url);

/** One struck partial: a sine at `freq` with a fast attack and exponential decay. */
function strike(freq, startSec, durSec, gain, { harmonics = [] } = {}) {
  const start = Math.floor(startSec * RATE);
  const len = Math.ceil(durSec * RATE);
  const partials = [{ ratio: 1, gain: 1 }, ...harmonics];
  for (let i = 0; i < len; i += 1) {
    const t = i / RATE;
    const env = Math.exp(-t * (5.2 / durSec));
    const attack = Math.min(1, t / 0.006);
    let sample = 0;
    for (const p of partials) {
      sample += Math.sin(2 * Math.PI * freq * p.ratio * t) * p.gain;
    }
    const index = start + i;
    if (index >= 0 && index < SIGNAL.length) {
      SIGNAL[index] += sample * env * attack * gain;
    }
  }
}

/* 1.35 s of silence to strike into, plus a little tail. */
const TOTAL = Math.ceil(1.35 * RATE);
const SIGNAL = new Float64Array(TOTAL);

/* A5 → E6 → A6, struck 100 ms apart, the last one ringing longest. */
const HARMONICS = [
  { ratio: 2, gain: 0.34 },
  { ratio: 3, gain: 0.12 }
];
strike(880.0, 0.0, 0.42, 0.62, { harmonics: HARMONICS });
strike(1318.51, 0.1, 0.55, 0.58, { harmonics: HARMONICS });
strike(1760.0, 0.2, 0.95, 0.52, { harmonics: [{ ratio: 2, gain: 0.22 }] });
/* The signature: a soft shimmer an octave above the last note. */
strike(3520.0, 0.24, 0.8, 0.09);

/* Normalise to -3 dBFS, so it is loud on a phone without clipping. */
let peak = 0;
for (const s of SIGNAL) peak = Math.max(peak, Math.abs(s));
const norm = peak > 0 ? 0.707 / peak : 1;

/* 40 ms fade-out: a waveform that stops dead clicks on small speakers. */
const fade = Math.floor(0.04 * RATE);
const pcm = Buffer.alloc(TOTAL * 2);
for (let i = 0; i < TOTAL; i += 1) {
  const tail = i > TOTAL - fade ? (TOTAL - i) / fade : 1;
  let v = SIGNAL[i] * norm * tail;
  v = Math.max(-1, Math.min(1, v));
  pcm.writeInt16LE(Math.round(v * 32767), i * 2);
}

/** Minimal 16-bit PCM WAV header (44 bytes) + the samples. */
function wav(samples, rate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);       // PCM chunk size
  header.writeUInt16LE(1, 20);        // format = PCM
  header.writeUInt16LE(1, 22);        // channels = mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);        // block align
  header.writeUInt16LE(16, 34);       // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

mkdirSync(new URL('./', OUT).pathname, { recursive: true });
const file = wav(pcm, RATE);
writeFileSync(OUT, file);
console.log(
  `fbt_notification.wav — ${(TOTAL / RATE).toFixed(2)}s mono ${RATE}Hz, ` +
  `${(file.length / 1024).toFixed(1)} KB, peak ${(peak * norm).toFixed(3)}`
);
