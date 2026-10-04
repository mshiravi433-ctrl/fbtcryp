#!/usr/bin/env node
/* ==========================================================================
   tools/score.mjs — the score and the sound design
   --------------------------------------------------------------------------
   The film's music is written here, note by note, and rendered to a single
   48 kHz stereo WAV. No library, no loop pack, no borrowed material: a small
   additive/FM synthesiser with a handful of instrument voices, driven by the
   music direction in the brief.

   Structure (matching the brief's music direction):
     00:00  minimal ambient — a room tone and a single struck note
     00:30  low cinematic pulse enters
     01:00  main theme begins (pad + sub + slow arpeggio)
     02:00  theme development
     03:30  becomes technical/intelligent — tuned pulses, no pad swell
     05:50  drops to near silence for the authorization beat
     06:45  cinematic rise under the blockchain
     08:20  main theme returns, full
     09:40  finale, then decay to nothing

   Usage: node tools/score.mjs --out /path/music.wav
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SR = 48000;
const DUR = 600;                      // seconds
const N = SR * DUR;
const OUT = (() => { const i = process.argv.indexOf('--out'); return i >= 0 ? process.argv[i + 1] : path.join(HERE, '../out/music.wav'); })();

const L = new Float32Array(N);
const R = new Float32Array(N);

/* ── music theory ─────────────────────────────────────────────────────── */
const A4 = 440;
const note = (name) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const oct = Number(m[3]);
  const semi = base + acc + (oct - 4) * 12 - 9;   // semitones from A4
  return A4 * Math.pow(2, semi / 12);
};

/* D minor — the key the whole film sits in.
   The progression is deliberately simple and slow: it has to carry ten
   minutes without ever asking for attention. */
const PROG = [
  { t: 60, root: 'D2', chord: ['D3', 'F3', 'A3'] },
  { t: 84, root: 'Bb1', chord: ['Bb2', 'D3', 'F3'] },
  { t: 108, root: 'F2', chord: ['F3', 'A3', 'C4'] },
  { t: 132, root: 'C2', chord: ['C3', 'E3', 'G3'] },
  { t: 156, root: 'D2', chord: ['D3', 'F3', 'A3'] },
  { t: 180, root: 'Bb1', chord: ['Bb2', 'D3', 'F3'] },
  { t: 204, root: 'G2', chord: ['G3', 'Bb3', 'D4'] },
  { t: 228, root: 'A2', chord: ['A3', 'C4', 'E4'] },
  { t: 252, root: 'D2', chord: ['D3', 'A3', 'D4'] },
  { t: 300, root: 'Bb1', chord: ['Bb2', 'F3', 'D4'] },
  { t: 350, root: 'F2', chord: ['F3', 'C4', 'A4'] },   // authorization: nearly bare
  { t: 405, root: 'D2', chord: ['D3', 'A3', 'F4'] },   // execution rise
  { t: 455, root: 'Bb1', chord: ['Bb2', 'F3', 'D4'] },
  { t: 500, root: 'D2', chord: ['D3', 'A3', 'D4'] },   // the loop
  { t: 550, root: 'F2', chord: ['F3', 'A3', 'C4'] },
  { t: 580, root: 'D2', chord: ['D3', 'F3', 'A3', 'D4'] }  // finale
];
function harmonyAt(t) {
  let h = PROG[0];
  for (const p of PROG) if (t >= p.t) h = p;
  return h;
}

/* ── instrument voices ────────────────────────────────────────────────── */
const env = (i, len, a, d, s, r) => {
  const at = a * SR, dt = d * SR, rt = r * SR, st = Math.max(1, len - at - dt - rt);
  if (i < at) return Math.pow(i / at, 0.6);
  if (i < at + dt) return 1 - (1 - s) * ((i - at) / dt);
  if (i < at + dt + st) return s;
  const k = (i - at - dt - st) / rt;
  return k >= 1 ? 0 : s * Math.pow(1 - k, 2.2);
};

/** Warm string pad: three detuned band-limited-ish saws per voice, slow attack. */
function pad(t0, dur, freqs, gain, { a = 2.2, r = 3.0, detune = 0.004 } = {}) {
  const start = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  const voices = [];
  for (const f of freqs) for (const dt of [-1, 0, 1]) voices.push({ f: f * (1 + dt * detune), p: (dt + 1) * 0.7 });
  const total = voices.reduce((s, v) => s + v.p, 0);
  let lp = 0;
  const cutoff = Math.min(0.28, 60 / Math.max(30, freqs[0])); // lower notes are darker
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    if (idx < 0) continue;
    let s = 0;
    for (const v of voices) {
      const ph = (idx / SR) * v.f;
      const saw = 2 * (ph - Math.floor(ph + 0.5));
      s += saw * v.p;
    }
    s /= total;
    lp += (s - lp) * cutoff;                 // gentle low-pass, no resonance
    const e = env(i, len, a, 1.2, 0.82, r);
    const g = gain * e;
    const vib = 1 + 0.0016 * Math.sin((idx / SR) * 2 * Math.PI * 0.27);
    L[idx] += lp * g * (0.94 + 0.06 * vib);
    R[idx] += lp * g * (1.06 - 0.06 * vib);
  }
}

/** Sub bass: one sine, slightly saturated, mono-ish. */
function sub(t0, dur, f, gain) {
  const start = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    if (idx < 0) continue;
    const ph = (i / SR) * f;
    const s = Math.sin(ph * 2 * Math.PI) + 0.16 * Math.sin(ph * 4 * Math.PI);
    const e = env(i, len, 0.9, 0.9, 0.72, 1.6);
    L[idx] += s * gain * e * 0.9;
    R[idx] += s * gain * e * 0.9;
  }
}

/** Cinematic mallet/bell — the "intelligent" voice. FM, fast attack, long tail. */
function bell(t0, f, gain, dur = 3.4, { mod = 2.0, index = 250 } = {}) {
  const start = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const idx = start + i; if (idx >= N) break;
    const t = i / SR;
    const m = Math.sin(t * 2 * Math.PI * f * mod) * (index / f) * Math.exp(-t * 2.6);
    const s = Math.sin((t * 2 * Math.PI * f) + m);
    const e = Math.exp(-t * 1.25) * (1 - Math.exp(-t * 220));
    const g = gain * e;
    L[idx] += s * g * 0.92;
    R[idx] += s * g * 1.05;
  }
}

/** Plucked arpeggio voice: short, dry, tuned — used in the technical sections. */
function pluck(t0, f, gain, dur = 1.1) {
  const start = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const idx = start + i; if (idx >= N) break;
    const t = i / SR;
    const s = Math.sin(t * 2 * Math.PI * f) * 0.7 + Math.sin(t * 2 * Math.PI * f * 2.01) * 0.22 + Math.sin(t * 2 * Math.PI * f * 3.02) * 0.07;
    const e = Math.exp(-t * 5.2) * (1 - Math.exp(-t * 400));
    const g = gain * e;
    L[idx] += s * g * 0.95;
    R[idx] += s * g * 1.0;
  }
}

/** Low pulse — the heartbeat that drives the middle act. */
function thump(t0, f, gain, dur = 1.05) {
  const start = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const idx = start + i; if (idx >= N) break;
    const t = i / SR;
    const fr = f * (1 - 0.22 * Math.min(1, t * 6));
    const s = Math.sin(t * 2 * Math.PI * fr);
    const e = Math.exp(-t * 4.4) * (1 - Math.exp(-t * 900));
    L[idx] += s * gain * e * 0.98;
    R[idx] += s * gain * e * 0.98;
  }
}

/** Riser: filtered noise + a rising sine, for the execution act. */
function riser(t0, dur, gain, { f0 = 60, f1 = 900, seed = 7 } = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  const start = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i; if (idx >= N) break;
    const k = i / len;
    const n = rnd();
    const f = f0 + (f1 - f0) * Math.pow(k, 2.1);
    lp += (n - lp) * Math.min(0.5, f / SR * 6);
    const tone = Math.sin((i / SR) * 2 * Math.PI * (f * 0.5));
    const e = Math.pow(k, 1.5);
    const g = gain * e;
    L[idx] += (lp * 0.5 + tone * 0.5) * g;
    R[idx] += (lp * 0.55 + tone * 0.45) * g;
  }
}

/** Impact: the loudest thing in the film, used exactly twice. */
function impact(t0, gain, { f = 46, seed = 99 } = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  const start = Math.floor(t0 * SR), len = Math.floor(3.6 * SR);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i; if (idx >= N) break;
    const t = i / SR;
    const fr = f * (1 - 0.30 * Math.min(1, t * 3.2));
    const body = Math.sin(t * 2 * Math.PI * fr) * Math.exp(-t * 1.5);
    const n = rnd();
    lp += (n - lp) * 0.06;
    const air = lp * Math.exp(-t * 6.5) * 0.5;
    L[idx] += (body + air) * gain;
    R[idx] += (body * 0.97 + air * 1.03) * gain;
  }
}

/* ── the arrangement ──────────────────────────────────────────────────── */
console.log('[score] rendering', DUR, 'seconds …');

// Room tone: the film is never truly silent. A slow, dark bed with a 0.1 Hz
// swell so the black between scenes still feels like a room.
(function roomTone() {
  let s = 4242 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  let lp1 = 0, lp2 = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const n = rnd();
    lp1 += (n - lp1) * 0.0015;
    lp2 += (lp1 - lp2) * 0.0015;
    const swell = 0.6 + 0.4 * Math.sin(t * 0.10) * Math.sin(t * 0.037 + 1.1);
    const g = 0.055 * swell;
    L[i] += lp2 * 4.2 * g;
    R[i] += lp2 * 4.2 * g * 0.96;
  }
})();

// 00:00 — a single struck note, the "point of light"
bell(2.55, note('A4'), 0.05, 6.0, { mod: 1.5, index: 120 });
bell(3.10, note('D5'), 0.035, 6.0, { mod: 1.5, index: 90 });

// 00:30 — the low cinematic pulse arrives with the environment
for (let t = 30.0; t < 60; t += 2.0) thump(t, 41, 0.10 * Math.min(1, (t - 30) / 8));

// 00:45 — the vision: the pad appears, still restrained
pad(46.0, 20, [note('D2') * 2, note('A2'), note('F3')], 0.055, { a: 4.0, r: 6.0 });
sub(46.0, 20, note('D1'), 0.05);

// 01:00 — main theme. Eight bars, then it develops.
const THEME_A = [
  [60.0, 'D2', ['D3', 'F3', 'A3'], 'D4'],
  [68.0, 'D2', ['D3', 'F3', 'A3'], 'F4'],
  [76.0, 'Bb1', ['Bb2', 'D3', 'F3'], 'A4'],
  [84.0, 'F2', ['F3', 'A3', 'C4'], 'F4'],
  [92.0, 'C2', ['C3', 'E3', 'G3'], 'E4'],
  [100.0, 'D2', ['D3', 'F3', 'A3'], 'D4'],
  [108.0, 'Bb1', ['Bb2', 'D3', 'F3'], 'D5'],
  [116.0, 'A2', ['A3', 'C4', 'E4'], 'C5']
];
for (const [t, root, chord, mel] of THEME_A) {
  pad(t, 9.5, chord.map(note), 0.085, { a: 2.6, r: 3.4 });
  sub(t, 9.5, note(root), 0.075);
  bell(t + 0.5, note(mel), 0.055, 4.2, { mod: 2.0, index: 180 });
  bell(t + 4.0, note(mel), 0.030, 3.6, { mod: 2.0, index: 180 });
}
// pulses under the theme, every 2s, quiet
for (let t = 60; t < 124; t += 2.0) thump(t, 38, 0.085);

// 02:00 — development: the theme moves up a third and the pulses double
const THEME_B = [
  [126.0, 'D2', ['D3', 'F3', 'A3'], 'A4'],
  [134.0, 'G2', ['G3', 'Bb3', 'D4'], 'Bb4'],
  [142.0, 'A2', ['A3', 'C4', 'E4'], 'C5'],
  [150.0, 'D2', ['D3', 'F3', 'A3'], 'D5'],
  [158.0, 'Bb1', ['Bb2', 'D3', 'F3'], 'F5'],
  [166.0, 'F2', ['F3', 'A3', 'C4'], 'A4'],
  [174.0, 'C2', ['C3', 'E3', 'G3'], 'G4']
];
for (const [t, root, chord, mel] of THEME_B) {
  pad(t, 8.5, chord.map(note), 0.10, { a: 2.2, r: 3.0 });
  sub(t, 9.0, note(root), 0.085);
  bell(t + 0.4, note(mel), 0.06, 4.0);
  pluck(t + 3.5, note(mel) * 2, 0.028);
}
for (let t = 126; t < 186; t += 1.0) thump(t, t % 2 < 0.5 ? 38 : 41, 0.06);

// 03:30 — technical: the engine. Dry plucks, no pad swell, tight pulses.
for (let bar = 0; bar < 12; bar++) {
  const t = 190 + bar * 3.33;
  const h = harmonyAt(t);
  for (let k = 0; k < 4; k++) {
    const f = note(h.chord[k % h.chord.length]) * (k % 2 ? 4 : 2);
    pluck(t + k * 0.42, f, 0.030 - k * 0.002, 0.75);
  }
  sub(t, 3.2, note(h.root), 0.06);
  if (bar % 2 === 0) thump(t, 36, 0.075);
}
pad(190, 40, [note('D3'), note('A3')], 0.028, { a: 5.0, r: 6.0 });

// 04:50 — the capability network: lighter, curious, still the same key
for (let bar = 0; bar < 18; bar++) {
  const t = 292 + bar * 3.33;
  const h = harmonyAt(t);
  pluck(t, note(h.chord[0]) * 2, 0.026, 1.4);
  pluck(t + 1.1, note(h.chord[1]) * 2, 0.020, 1.4);
  pluck(t + 2.2, note(h.chord[2]) * 2, 0.024, 1.4);
  if (bar % 3 === 0) bell(t + 0.6, note(h.chord[1]) * 4, 0.022, 3.0);
}
for (let t = 292; t < 352; t += 2.0) thump(t, 38, 0.05);

// 05:50 — AUTHORIZATION: the music all but stops. One held note, one pulse.
pad(352, 20, [note('F3'), note('C4')], 0.030, { a: 5.0, r: 8.0 });
sub(352, 20, note('F1'), 0.045);
thump(366.0, 34, 0.07, 1.4);
thump(390.5, 34, 0.09, 1.6);

// 06:45 — EXECUTION: risers and a rising bass line, then the impact
riser(400.0, 15.0, 0.055, { f0: 70, f1: 700 });
riser(411.0, 9.0, 0.05, { f0: 110, f1: 1400, seed: 21 });
impact(420.5, 0.24, { f: 44 });
for (const [t, f] of [[405, 'D2'], [411, 'F2'], [417, 'A2'], [423, 'D3']]) {
  sub(t, 6, note(f), 0.085);
  pad(t, 6, [note(f), note(f) * 2], 0.055, { a: 1.2, r: 2.4 });
}
for (let t = 420; t < 452; t += 1.0) thump(t, 40, 0.07);

// 07:35 — monitoring: patient, sparse, unresolved
for (let bar = 0; bar < 10; bar++) {
  const t = 455 + bar * 4.0;
  const h = harmonyAt(t);
  pluck(t + 0.2, note(h.chord[1]) * 2, 0.022, 1.6);
  pluck(t + 2.2, note(h.chord[2]) * 2, 0.018, 1.6);
  sub(t, 4.0, note(h.root), 0.05);
}
for (let t = 455; t < 498; t += 4.0) thump(t, 36, 0.05);
riser(486.0, 14.0, 0.04, { f0: 90, f1: 800, seed: 33 });

// 08:20 — THE LOOP: main theme returns, full
for (const [t, root, chord, mel] of [
  [500.0, 'D2', ['D3', 'F3', 'A3'], 'D5'],
  [508.0, 'D2', ['D3', 'A3', 'D4'], 'A5'],
  [516.0, 'Bb1', ['Bb2', 'F3', 'D4'], 'F5'],
  [524.0, 'F2', ['F3', 'C4', 'A4'], 'C5'],
  [532.0, 'C2', ['C3', 'G3', 'E4'], 'G5'],
  [540.0, 'D2', ['D3', 'F3', 'A3'], 'D5']
]) {
  pad(t, 8.5, chord.map(note), 0.115, { a: 2.0, r: 3.0 });
  sub(t, 8.5, note(root), 0.09);
  bell(t + 0.4, note(mel), 0.062, 4.4);
}
for (let t = 500; t < 548; t += 1.0) thump(t, t % 4 < 0.5 ? 38 : 42, 0.06);

// 09:10 — the future: wide, quiet, open
pad(550, 22, [note('F3'), note('A3'), note('C4')], 0.075, { a: 4.0, r: 6.0 });
sub(550, 22, note('F1'), 0.06);
for (let t = 552; t < 572; t += 4.0) thump(t, 36, 0.045);

// 09:40 — FINALE
pad(578, 21, [note('D3'), note('F3'), note('A3'), note('D4')], 0.135, { a: 2.4, r: 9.0 });
sub(578, 21, note('D1'), 0.11);
bell(578.4, note('D5'), 0.075, 6.0);
bell(581.0, note('A5'), 0.055, 6.0);
impact(584.6, 0.20, { f: 40, seed: 55 });
riser(583.0, 5.0, 0.05, { f0: 120, f1: 900, seed: 77 });

/* ── master bus: gentle bus compression, soft clip, fade out ─────────── */
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fadeIn = Math.min(1, t / 1.2);
  const fadeOut = t > 596 ? Math.max(0, 1 - (t - 596) / 4) : 1;
  const g = fadeIn * fadeOut;
  let l = L[i] * g, r = R[i] * g;
  // soft clip — musical, never harsh
  l = Math.tanh(l * 1.25) * 0.86;
  r = Math.tanh(r * 1.25) * 0.86;
  L[i] = l; R[i] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
console.log('[score] pre-normalisation peak', peak.toFixed(3));

/* ── write ────────────────────────────────────────────────────────────── */
const buffer = Buffer.alloc(N * 4 + 44);
const writeStr = (off, s) => buffer.write(s, off, 'ascii');
writeStr(0, 'RIFF'); buffer.writeUInt32LE(36 + N * 4, 4); writeStr(8, 'WAVE');
writeStr(12, 'fmt '); buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
buffer.writeUInt32LE(SR, 24); buffer.writeUInt32LE(SR * 4, 28);
buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34);
writeStr(36, 'data'); buffer.writeUInt32LE(N * 4, 40);
let o = 44;
for (let i = 0; i < N; i++) {
  buffer.writeInt16LE(Math.max(-32767, Math.round(L[i] * 32767)), o); o += 2;
  buffer.writeInt16LE(Math.max(-32767, Math.round(R[i] * 32767)), o); o += 2;
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buffer);
console.log('[score] wrote', OUT, (buffer.length / 1048576).toFixed(1), 'MB');
void spawn; void ffmpegPath;
