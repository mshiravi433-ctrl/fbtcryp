#!/usr/bin/env node
/* ==========================================================================
   tools/sfx.mjs — sound design
   --------------------------------------------------------------------------
   Every important interface action in the film has a sound, and every sound
   is synthesised here: clicks, whooshes, data movement, notification, the
   blockchain confirmation, and two deep impacts. Nothing is sampled, so the
   track is clean, licence-free and reproducible.

   Usage: node tools/sfx.mjs --out /path/sfx.wav [--gain 1.0]
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const SR = 48000, DUR = 600, N = SR * DUR;
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', '/tmp/sfx.wav');
const GAIN = Number(arg('gain', 1));

const L = new Float32Array(N);
const R = new Float32Array(N);

function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; }; }
function put(i, l, r = l) { if (i < 0 || i >= N) return; L[i] += l; R[i] += r; }

/* ── voices ───────────────────────────────────────────────────────────── */
/** UI tick: a very short, high, damped click. The quietest sound in the film. */
function tick(t0, gain = 0.10, f = 2600, dur = 0.055) {
  const s = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const e = Math.exp(-t * 95) * (1 - Math.exp(-t * 3000));
    const v = Math.sin(t * 2 * Math.PI * f) * 0.7 + Math.sin(t * 2 * Math.PI * f * 2.7) * 0.3;
    put(s + i, v * gain * e * 0.85, v * gain * e);
  }
}

/** Confirmation chime: two stacked bells. Used for state changes the user can trust. */
function chime(t0, gain = 0.09, base = 987.77, dur = 2.6) {
  const s = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const e = Math.exp(-t * 1.9) * (1 - Math.exp(-t * 500));
    const a = Math.sin(t * 2 * Math.PI * base);
    const b = Math.sin(t * 2 * Math.PI * base * 1.5) * 0.42;
    const c = Math.sin(t * 2 * Math.PI * base * 2.02) * 0.20;
    put(s + i, (a + b + c) * gain * e * 0.9, (a + b + c) * gain * e);
  }
}

/** Soft whoosh: band-swept noise. Transitions, modal opens, camera moves. */
function whoosh(t0, gain = 0.16, dur = 0.85, { f0 = 320, f1 = 5200, up = true, seed = 5 } = {}) {
  const r = rnd(seed);
  const s = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  let lp = 0, hp = 0;
  for (let i = 0; i < len; i++) {
    const k = i / len;
    const f = up ? f0 + (f1 - f0) * Math.pow(k, 1.6) : f1 + (f0 - f1) * Math.pow(k, 1.6);
    const n = r();
    lp += (n - lp) * Math.min(0.6, (f / SR) * 5);
    hp += (lp - hp) * 0.002;
    const band = lp - hp;
    const e = Math.sin(Math.PI * Math.pow(k, 0.85)) * (1 - k * 0.35);
    put(s + i, band * gain * e, band * gain * e * 0.92);
  }
}

/** Digital pulse: one event in the data field. */
function pulse(t0, gain = 0.05, f = 1400, dur = 0.18) {
  const s = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const e = Math.exp(-t * 22) * (1 - Math.exp(-t * 2000));
    const v = Math.sin(t * 2 * Math.PI * f) * 0.6 + Math.sin(t * 2 * Math.PI * f * 0.5) * 0.4;
    put(s + i, v * gain * e, v * gain * e * 1.08);
  }
}

/** Notification: two rising tones, warm enough to read as information. */
function notify(t0, gain = 0.12) {
  chime(t0, gain, 830.61, 1.5);
  chime(t0 + 0.16, gain * 1.05, 1108.73, 2.2);
}

/** Blockchain confirmation: a filtered noise burst that resolves into a low tone. */
function confirmation(t0, gain = 0.22) {
  const r = rnd(404);
  const s = Math.floor(t0 * SR), len = Math.floor(2.4 * SR);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const n = r();
    lp += (n - lp) * 0.12;
    const air = lp * Math.exp(-t * 9) * 0.55;
    const body = Math.sin(t * 2 * Math.PI * 92) * Math.exp(-t * 2.4);
    const tail = Math.sin(t * 2 * Math.PI * 523.25) * Math.exp(-t * 1.6) * 0.18;
    put(s + i, (air + body + tail) * gain, (air + body * 1.02 + tail) * gain);
  }
}

/** Deep impact: the two loudest moments — authorization and the finale. */
function impact(t0, gain = 0.30, f = 42) {
  const r = rnd(707);
  const s = Math.floor(t0 * SR), len = Math.floor(4.0 * SR);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const fr = f * (1 - 0.28 * Math.min(1, t * 3));
    const body = Math.sin(t * 2 * Math.PI * fr) * Math.exp(-t * 1.25);
    const n = r(); lp += (n - lp) * 0.05;
    const air = lp * Math.exp(-t * 5.5) * 0.45;
    put(s + i, (body + air) * gain, (body * 0.98 + air * 1.04) * gain);
  }
}

/** Shimmer: the light sweep, the logo, the reveal. */
function shimmer(t0, gain = 0.09, dur = 3.2, base = 1567.98) {
  const s = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const e = Math.exp(-t * 0.9) * (1 - Math.exp(-t * 30));
    const a = Math.sin(t * 2 * Math.PI * base) * 0.6;
    const b = Math.sin(t * 2 * Math.PI * base * 1.5 + 0.4) * 0.4;
    const c = Math.sin(t * 2 * Math.PI * base * 2.25) * 0.25;
    put(s + i, (a + b + c) * gain * e * 0.9, (a + b + c) * gain * e * 1.06);
  }
}

/** A short cluster of keystrokes. */
function typing(t0, count = 14, gain = 0.05, cps = 11) {
  const r = rnd(88);
  for (let i = 0; i < count; i++) tick(t0 + i / cps, gain * (0.7 + r() * 0.5), 2200 + r() * 1600, 0.035);
}

/* ── the cue sheet ────────────────────────────────────────────────────── */
const CUES = [];
const cue = (t, fn, ...a) => CUES.push({ t, fn, a });

/* SCENE 01 */
cue(2.55, shimmer, 0.05, 6.0, 2093.00);
cue(3.20, pulse, 0.030, 900);
for (let t = 5.5; t < 44; t += 1.35) cue(t, pulse, 0.016 + 0.014 * ((t * 7) % 1), 700 + ((t * 137) % 900));
cue(25.2, whoosh, 0.10, 1.1, { f0: 400, f1: 3600, seed: 11 });
cue(32.0, whoosh, 0.09, 2.2, { f0: 120, f1: 2600, seed: 13 });
cue(40.4, whoosh, 0.09, 1.0, { f0: 900, f1: 300, up: false, seed: 17 });
cue(44.55, whoosh, 0.20, 0.6, { f0: 200, f1: 7000, seed: 19 });
cue(44.90, impact, 0.16, 54);

/* SCENE 02 */
cue(45.9, whoosh, 0.12, 2.4, { f0: 150, f1: 2400, seed: 23 });
for (let i = 0; i < 9; i++) cue(46.6 + i * 0.55, tick, 0.045, 3000 + i * 260, 0.05);
cue(60.4, chime, 0.10, 880);
cue(60.9, shimmer, 0.07, 3.0, 1318.51);
cue(72.0, whoosh, 0.10, 1.2, { f0: 300, f1: 4200, seed: 29 });
cue(75.4, chime, 0.08, 1174.66);
cue(78.6, whoosh, 0.11, 0.9, { f0: 2000, f1: 600, up: false, seed: 31 });

/* SCENE 03 */
cue(82.0, whoosh, 0.10, 0.9, { f0: 240, f1: 3200, seed: 37 });
cue(88.2, tick, 0.06, 2400, 0.05);
cue(90.35, tick, 0.12, 3100, 0.07);          // the click on INTENT OS
cue(90.5, chime, 0.075, 1046.50, 1.8);
cue(91.4, whoosh, 0.13, 0.8, { f0: 400, f1: 5200, seed: 41 });
for (let i = 0; i < 7; i++) cue(102.6 + i * 0.42, tick, 0.035, 2700 + i * 90, 0.04);
cue(98.4, typing, 26, 0.045, 17);            // the user writes the goal
cue(105.7, tick, 0.10, 3300, 0.06);          // Interpret intent

/* SCENE 04 */
cue(121.8, whoosh, 0.09, 1.6, { f0: 180, f1: 2800, seed: 43 });
for (let i = 0; i < 4; i++) cue(122.4 + i * 0.55, tick, 0.075, 1800 + i * 420, 0.12);
cue(129.9, chime, 0.10, 987.77);
cue(133.0, notify, 0.085);
cue(142.4, tick, 0.11, 3200, 0.06);
cue(142.55, chime, 0.07, 1174.66, 1.6);
cue(151.0, chime, 0.09, 1318.51);
cue(163.0, pulse, 0.03, 1100);

/* SCENE 05 */
cue(174.6, whoosh, 0.11, 1.0, { f0: 260, f1: 3600, seed: 47 });
for (let i = 0; i < 5; i++) cue(170.6 + i * 0.5, tick, 0.05, 2000 + i * 180, 0.05);
cue(176.0, tick, 0.09, 2900, 0.05);
cue(181.4, tick, 0.12, 3100, 0.07);          // approve the read-only request
cue(181.7, chime, 0.10, 880);
for (let i = 0; i < 5; i++) cue(184.6 + i * 0.28, tick, 0.05, 2400 + i * 200, 0.05);
cue(198.5, whoosh, 0.13, 2.6, { f0: 140, f1: 3000, seed: 53 });
for (let t = 202; t < 224; t += 1.6) cue(t, pulse, 0.02, 800 + ((t * 71) % 1200));
cue(212.4, tick, 0.06, 2600, 0.05);
cue(212.9, tick, 0.06, 2800, 0.05);

/* SCENE 06 */
for (let i = 0; i < 5; i++) cue(226.0 + i * 0.42, pulse, 0.05, 600 + i * 220, 0.3);
for (let i = 0; i < 5; i++) cue(234.2 + i * 0.16, whoosh, 0.055, 0.5, { f0: 1800, f1: 300, up: false, seed: 60 + i });
cue(247.6, chime, 0.10, 1046.50);
for (let i = 0; i < 6; i++) cue(244.6 + i * 0.9, tick, 0.055, 1900 + i * 150, 0.05);
for (let i = 0; i < 10; i++) cue(252 + i * 0.9, pulse, 0.018, 700 + i * 90);
cue(273.0, whoosh, 0.09, 2.0, { f0: 120, f1: 1800, seed: 67 });

/* SCENE 07 */
for (let i = 0; i < 10; i++) cue(290.6 + i * 0.16, tick, 0.05, 2200 + i * 160, 0.05);
cue(290.8, whoosh, 0.10, 1.6, { f0: 200, f1: 3400, seed: 71 });
cue(296.8, pulse, 0.045, 620, 0.5);
cue(302.2, tick, 0.06, 2800, 0.05);
for (let i = 0; i < 6; i++) cue(302.5 + i * 2.31, tick, 0.06, 2100 + i * 220, 0.08);
cue(320.4, typing, 30, 0.045, 19);
cue(331.2, chime, 0.09, 1174.66);

/* SCENE 08 */
cue(350.4, tick, 0.08, 2600, 0.06);
cue(351.0, whoosh, 0.08, 1.0, { f0: 340, f1: 1900, seed: 73 });
cue(354.4, tick, 0.07, 2000, 0.05);
cue(370.5, tick, 0.10, 3100, 0.06);
cue(384.1, tick, 0.13, 3200, 0.07);          // CONFIRM
cue(384.3, whoosh, 0.11, 1.1, { f0: 260, f1: 4200, seed: 79 });
cue(386.0, tick, 0.10, 2900, 0.06);
cue(390.4, impact, 0.30, 40);                // the user approves — the film's loudest beat
cue(390.6, confirmation, 0.16);
cue(392.4, chime, 0.10, 1318.51);

/* SCENE 09 */
cue(407.0, pulse, 0.06, 520, 0.5);
cue(408.2, whoosh, 0.13, 1.4, { f0: 120, f1: 5200, seed: 83 });
cue(413.4, whoosh, 0.12, 1.0, { f0: 600, f1: 6000, seed: 89 });
cue(419.5, pulse, 0.05, 900, 0.4);
cue(430.4, confirmation, 0.26);
cue(430.9, chime, 0.11, 1567.98);
cue(436.4, typing, 20, 0.035, 30);
for (let i = 0; i < 4; i++) cue(446.4 + i * 0.6, tick, 0.07, 2400 + i * 220, 0.06);
cue(448.2, chime, 0.09, 1046.50);
cue(451.0, whoosh, 0.09, 1.6, { f0: 4000, f1: 300, up: false, seed: 97 });

/* SCENE 10 */
cue(460.4, whoosh, 0.08, 2.4, { f0: 700, f1: 2400, seed: 101 });
for (let t = 460; t < 468; t += 0.8) cue(t, pulse, 0.02, 900 + ((t * 31) % 700));
cue(468.55, notify, 0.15);                   // MARKET CONDITION CHANGED
cue(468.5, whoosh, 0.10, 0.7, { f0: 1400, f1: 300, up: false, seed: 103 });
for (let i = 0; i < 3; i++) cue(482.6 + i * 0.9, tick, 0.06, 2200 + i * 260, 0.06);
cue(485.5, whoosh, 0.09, 2.2, { f0: 200, f1: 2600, seed: 107 });

/* SCENE 11 */
for (let i = 0; i < 9; i++) { cue(502.6 + i * 0.85, tick, 0.075, 1600 + i * 240, 0.10); cue(502.7 + i * 0.85, pulse, 0.03, 700 + i * 120, 0.3); }
cue(512.2, chime, 0.11, 987.77);
for (let i = 0; i < 8; i++) cue(516.6 + i * 0.95, pulse, 0.022, 800 + i * 160, 0.35);
cue(533.2, whoosh, 0.10, 3.0, { f0: 300, f1: 3000, seed: 109 });
cue(533.4, chime, 0.08, 1174.66);

/* SCENE 12 */
cue(550.5, whoosh, 0.12, 3.0, { f0: 160, f1: 3600, seed: 113 });
for (let i = 0; i < 8; i++) cue(554.5 + i * 0.9, tick, 0.05, 2300 + i * 140, 0.07);
for (let i = 0; i < 10; i++) cue(556 + i * 1.1, pulse, 0.018, 700 + i * 80);
cue(571.5, chime, 0.08, 880);

/* SCENE 13 */
cue(580.6, whoosh, 0.09, 1.6, { f0: 900, f1: 3400, seed: 127 });
cue(583.2, chime, 0.12, 1318.51);
cue(583.4, shimmer, 0.10, 4.0, 1567.98);
cue(584.5, tick, 0.07, 2800, 0.06);
cue(587.9, chime, 0.09, 1046.50);
cue(589.7, tick, 0.06, 2400, 0.05);
cue(591.5, whoosh, 0.10, 1.4, { f0: 600, f1: 5200, seed: 131 });
cue(596.0, whoosh, 0.07, 3.6, { f0: 1200, f1: 200, up: false, seed: 137 });

/* ── render ───────────────────────────────────────────────────────────── */
for (const c of CUES) c.fn(c.t, ...c.a);
console.log('[sfx] rendered', CUES.length, 'cues');

let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = t > 596 ? Math.max(0, 1 - (t - 596) / 4) : 1;
  L[i] = Math.tanh(L[i] * GAIN * 1.1) * 0.9 * fade;
  R[i] = Math.tanh(R[i] * GAIN * 1.1) * 0.9 * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
console.log('[sfx] peak', peak.toFixed(3));

const buf = Buffer.alloc(N * 4 + 44);
buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8, 'ascii');
buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36, 'ascii'); buf.writeUInt32LE(N * 4, 40);
let o = 44;
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32767, Math.round(L[i] * 32767)), o); o += 2;
  buf.writeInt16LE(Math.max(-32767, Math.round(R[i] * 32767)), o); o += 2;
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
console.log('[sfx] wrote', OUT, (buf.length / 1048576).toFixed(1), 'MB');
