/**
 * CINEMATIC STORY SCORE — a zero-asset Web Audio synthesizer.
 * ---------------------------------------------------------------------------
 * Provides the soundtrack that plays by itself the moment a Market Story
 * opens. «در استوری‌ها موسیقی خودکار پلی بشه بدون دکمه توقف یا پخش و موسیقی
 * یک فیلم باشد» — autoplay, no transport UI, and it has to sound like a FILM
 * score rather than a beep loop.
 *
 * ─── WHY SYNTHESIZED AND NOT AN .mp3 ───────────────────────────────────────
 *   · Zero APK/bundle weight. A 60-second orchestral loop is ~1 MB; this is
 *     ~6 KB of code and no network request at all.
 *   · Zero CDN failure. Restricted networks (the reason `lib/apiBase.js`
 *     exists) would leave the story silent, and a silent story reads as a
 *     broken story.
 *   · It can breathe. A file loops at a fixed point and the seam is audible
 *     inside one minute; these voices swell and decay on their own LFOs, so a
 *     60-second story never repeats itself audibly.
 *
 * ─── WHAT "LIKE A FILM" MEANS, IN SIGNAL TERMS ─────────────────────────────
 * Four layers, which is the minimum that reads as a score instead of a tone:
 *   1. SUB DRONE  — a sine an octave below the root, felt more than heard.
 *   2. SWELL PAD  — detuned voices through a lowpass whose cutoff is itself
 *                   modulated slowly, so the harmony opens and closes like a
 *                   string section breathing.
 *   3. HEARTBEAT  — a soft pitched-down thump on a slow interval. This is the
 *                   layer that makes it feel like a trailer rather than spa
 *                   music; it is deliberately quiet (it sits under the pad).
 *   4. AIR + BELL — filtered noise for room/whoosh, plus sparse pentatonic
 *                   bells with long decays for the "shimmer" on top.
 *
 * ─── MOTION / BATTERY BUDGET ───────────────────────────────────────────────
 * Every layer is built ONCE per `start()` and torn down on `stop()`. The only
 * recurring work is two `setInterval` timers (bell, heartbeat) at 1.8-3.4s
 * periods — not per-frame. `stop()` fades the master out over 320 ms before
 * disconnecting, so closing a story never clicks.
 *
 * ─── AUTOPLAY POLICY ───────────────────────────────────────────────────────
 * `start()` is only ever called from the story-open click handler, which IS a
 * user gesture, so the context is allowed to run. If a browser still refuses,
 * `start()` returns `false` and the story is simply silent — no control is
 * rendered that would lie about the state. Safe no-op in SSR / jsdom.
 */

/*
 * One entry per mood. Frequencies are equal-tempered A-based so the sub drone
 * (`root / 2`) stays a clean octave below the pad.
 *
 * `cinema` is the one every story uses now — the request was explicitly that
 * the music be a FILM's music, and letting each story pick a different mood
 * made the rail feel like eight different apps.
 */
const MOODS = {
  cinema: {
    // A minor add9, voiced wide: A2 · E3 · C4 · E4 · B4
    pad: [110.0, 164.81, 261.63, 329.63, 493.88],
    root: 55.0,
    padWave: 'triangle',
    padGain: 0.085,
    cutoff: 780,
    cutoffDepth: 420,
    swellHz: 0.055,
    bells: [440.0, 523.25, 587.33, 659.25, 880.0],
    bellEvery: 3400,
    bellGain: 0.03,
    heartbeatEvery: 1800,
    heartbeatGain: 0.085,
    airGain: 0.012,
    master: 0.19
  },
  focus: {
    pad: [98.0, 146.83, 220.0, 293.66],
    root: 49.0,
    padWave: 'sine',
    padGain: 0.075,
    cutoff: 620,
    cutoffDepth: 220,
    swellHz: 0.04,
    bells: [392.0, 440.0, 523.25, 587.33],
    bellEvery: 4200,
    bellGain: 0.022,
    heartbeatEvery: 0,
    heartbeatGain: 0,
    airGain: 0.008,
    master: 0.16
  },
  alpha: {
    pad: [130.81, 164.81, 196.0, 246.94],
    root: 65.41,
    padWave: 'triangle',
    padGain: 0.07,
    cutoff: 900,
    cutoffDepth: 320,
    swellHz: 0.07,
    bells: [523.25, 587.33, 659.25, 783.99],
    bellEvery: 2800,
    bellGain: 0.026,
    heartbeatEvery: 0,
    heartbeatGain: 0,
    airGain: 0.006,
    master: 0.15
  }
};

/** Kept for callers that still speak the old vocabulary. */
export const STORY_MOODS = Object.keys(MOODS);

export function createStoryAmbientController() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  /** Every node created by the current `start()`, so `stop()` can release them. */
  let nodes = [];
  let timers = [];
  let running = false;
  let currentMood = 'cinema';

  function getAudioContext() {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) {
      try {
        ctx = new Ctor();
      } catch {
        return null;
      }
    }
    return ctx;
  }

  /** Two seconds of white noise, built once per context and looped for "air". */
  function getNoise(ac) {
    if (noiseBuffer) return noiseBuffer;
    try {
      const len = Math.floor(ac.sampleRate * 2);
      noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
      const ch = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) ch[i] = Math.random() * 2 - 1;
    } catch {
      noiseBuffer = null;
    }
    return noiseBuffer;
  }

  function keep(node) {
    nodes.push(node);
    return node;
  }

  function teardown() {
    for (const id of timers) clearInterval(id);
    timers = [];
    for (const n of nodes) {
      try {
        n.stop?.();
      } catch {
        /* already stopped */
      }
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    nodes = [];
  }

  /* ── layer 3: one soft cinematic thump ───────────────────────────────── */
  function heartbeat(ac, dest, cfg) {
    try {
      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      // A pitched-down thump: 92 Hz sliding to 44 Hz in 90 ms is what a
      // trailer hit does. The slide, not the level, is what reads as "hit".
      osc.frequency.setValueAtTime(cfg.root * 1.7, now);
      osc.frequency.exponentialRampToValueAtTime(cfg.root * 0.82, now + 0.09);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(cfg.heartbeatGain, now + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.56);
    } catch {
      /* ignore */
    }
  }

  /* ── layer 4b: one bell/shimmer note, two detuned voices ─────────────── */
  function bell(ac, dest, freq, gainLevel) {
    try {
      const now = ac.currentTime;
      for (let v = 0; v < 2; v += 1) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = v === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq * (v === 0 ? 1 : 2.004), now);
        const peak = v === 0 ? gainLevel : gainLevel * 0.32;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.28);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(now);
        osc.stop(now + 3.3);
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Start the score. Returns true only when sound is genuinely running.
   *
   * @param {string} mood one of MOODS; unknown values fall back to `cinema`.
   */
  function start(mood = currentMood) {
    currentMood = MOODS[mood] ? mood : 'cinema';
    const ac = getAudioContext();
    if (!ac) {
      running = false;
      return false;
    }
    const cfg = MOODS[currentMood];
    try {
      if (ac.state === 'suspended' && typeof ac.resume === 'function') {
        ac.resume().catch(() => {});
      }
      teardown();

      const now = ac.currentTime;
      master = ac.createGain();
      // Film scores fade up, they do not switch on. 1.1 s is long enough to
      // feel intentional and short enough to be audible inside a 60 s story.
      master.gain.setValueAtTime(0.0001, now);
      master.gain.linearRampToValueAtTime(cfg.master, now + 1.1);
      master.connect(ac.destination);
      keep(master);

      /* ── layer 2: swelling pad through a moving lowpass ─────────────── */
      const padFilter = ac.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.setValueAtTime(cfg.cutoff, now);
      padFilter.Q.setValueAtTime(0.9, now);
      padFilter.connect(master);
      keep(padFilter);

      // The cutoff LFO is what makes the harmony "breathe".
      const swell = ac.createOscillator();
      const swellDepth = ac.createGain();
      swell.type = 'sine';
      swell.frequency.setValueAtTime(cfg.swellHz, now);
      swellDepth.gain.setValueAtTime(cfg.cutoffDepth, now);
      swell.connect(swellDepth);
      swellDepth.connect(padFilter.frequency);
      swell.start(now);
      keep(swell);
      keep(swellDepth);

      cfg.pad.forEach((freq, i) => {
        // Two slightly detuned voices per note is the cheap way to get a
        // chorus/string width; three would start to sound like an organ.
        for (let v = 0; v < 2; v += 1) {
          const osc = ac.createOscillator();
          const g = ac.createGain();
          osc.type = cfg.padWave;
          osc.frequency.setValueAtTime(freq, now);
          osc.detune.setValueAtTime(v === 0 ? -5 : 6, now);
          // Upper notes sit lower in the mix: a flat mix across five notes
          // reads as an organ chord, not a score.
          const weight = cfg.padGain / (1 + i * 0.42) / 2;
          g.gain.setValueAtTime(weight, now);
          osc.connect(g);
          g.connect(padFilter);
          osc.start(now);
          keep(osc);
          keep(g);
        }
      });

      /* ── layer 1: sub drone, felt more than heard ───────────────────── */
      const droneFilter = ac.createBiquadFilter();
      droneFilter.type = 'lowpass';
      droneFilter.frequency.setValueAtTime(220, now);
      droneFilter.connect(master);
      keep(droneFilter);

      [1, 1.5].forEach((mult, i) => {
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = i === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(cfg.root * mult, now);
        g.gain.setValueAtTime(i === 0 ? 0.16 : 0.05, now);
        osc.connect(g);
        g.connect(droneFilter);
        osc.start(now);
        keep(osc);
        keep(g);
      });

      /* ── layer 4a: air — looped filtered noise for room/whoosh ──────── */
      const noise = getNoise(ac);
      if (noise) {
        const src = ac.createBufferSource();
        const band = ac.createBiquadFilter();
        const g = ac.createGain();
        src.buffer = noise;
        src.loop = true;
        band.type = 'bandpass';
        band.frequency.setValueAtTime(1100, now);
        band.Q.setValueAtTime(0.7, now);
        g.gain.setValueAtTime(cfg.airGain, now);
        src.connect(band);
        band.connect(g);
        g.connect(master);
        src.start(now);
        keep(src);
        keep(band);
        keep(g);

        // Slow sweep of the band, so the "air" moves instead of hissing flat.
        const airLfo = ac.createOscillator();
        const airDepth = ac.createGain();
        airLfo.type = 'sine';
        airLfo.frequency.setValueAtTime(0.037, now);
        airDepth.gain.setValueAtTime(520, now);
        airLfo.connect(airDepth);
        airDepth.connect(band.frequency);
        airLfo.start(now);
        keep(airLfo);
        keep(airDepth);
      }

      /* ── layers 3 & 4b on slow timers (never per-frame) ─────────────── */
      let step = 0;
      bell(ac, master, cfg.bells[0], cfg.bellGain);
      timers.push(
        setInterval(() => {
          if (!running || !ctx || !master) return;
          const c = MOODS[currentMood] || MOODS.cinema;
          step += 1;
          bell(ctx, master, c.bells[step % c.bells.length], c.bellGain);
        }, cfg.bellEvery)
      );

      if (cfg.heartbeatEvery > 0) {
        timers.push(
          setInterval(() => {
            if (!running || !ctx || !master) return;
            heartbeat(ctx, master, MOODS[currentMood] || MOODS.cinema);
          }, cfg.heartbeatEvery)
        );
      }

      running = true;
      return true;
    } catch {
      running = false;
      return false;
    }
  }

  /** Fade out over 320 ms, then release every node. Never clicks. */
  function stop() {
    const wasRunning = running;
    running = false;
    for (const id of timers) clearInterval(id);
    timers = [];
    const ac = ctx;
    const gainNode = master;
    master = null;
    if (ac && gainNode && wasRunning) {
      try {
        const now = ac.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(Math.max(0.0002, gainNode.gain.value), now);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      } catch {
        /* ignore */
      }
      // Disconnect after the fade has landed; tearing down immediately would
      // cut the tail and produce the click the fade exists to avoid.
      setTimeout(() => teardown(), 380);
    } else {
      teardown();
    }
  }

  function setMood(mood) {
    currentMood = MOODS[mood] ? mood : 'cinema';
    if (running) start(currentMood);
  }

  function destroy() {
    stop();
    if (ctx && typeof ctx.close === 'function') {
      try {
        ctx.close().catch(() => {});
      } catch {
        /* ignore */
      }
    }
    ctx = null;
    noiseBuffer = null;
  }

  return {
    start,
    stop,
    setMood,
    destroy,
    isPlaying: () => running,
    getMood: () => currentMood
  };
}
