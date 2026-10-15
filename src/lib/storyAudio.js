/**
 * AMBIENT STORY & VIDEO SYNTHESIZER
 * ---------------------------------------------------------------------------
 * Provides zero-dependency, offline-safe harmonic ambient music for the
 * 1-minute Market Stories popup and interactive Video Academy walkthroughs.
 *
 * Uses Web Audio API (when available in the browser/WebView) with soft
 * sine/triangle pads and gentle pentatonic notes so there is zero APK bundle
 * bloat and zero external CDN failure on restricted networks.
 * Safe no-op in SSR / jsdom test environments.
 */

const MOOD_CHORDS = {
  alpha: [261.63, 329.63, 392.00, 493.88, 587.33],   // Cmaj9
  focus: [220.00, 261.63, 329.63, 392.00, 440.00],   // Am7
  cinema: [196.00, 246.94, 293.66, 369.99, 440.00]   // Gmaj9
};

export function createStoryAmbientController() {
  let ctx = null;
  let masterGain = null;
  let noteTimer = null;
  let activeOscs = [];
  let running = false;
  let currentMood = 'alpha';

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

  function stopVoices() {
    if (noteTimer) {
      clearInterval(noteTimer);
      noteTimer = null;
    }
    for (const o of activeOscs) {
      try {
        o.stop();
        o.disconnect();
      } catch {
        /* already stopped */
      }
    }
    activeOscs = [];
  }

  function triggerChime(ac, dest, freq) {
    try {
      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.045, now + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 2.5);
    } catch {
      /* ignore audio node errors */
    }
  }

  function start(mood = currentMood) {
    currentMood = MOOD_CHORDS[mood] ? mood : 'alpha';
    const ac = getAudioContext();
    if (!ac) {
      running = true;
      return true;
    }
    try {
      if (ac.state === 'suspended' && typeof ac.resume === 'function') {
        ac.resume().catch(() => {});
      }
      stopVoices();
      const now = ac.currentTime;
      masterGain = ac.createGain();
      masterGain.gain.setValueAtTime(0.001, now);
      masterGain.gain.linearRampToValueAtTime(0.14, now + 0.6);
      masterGain.connect(ac.destination);

      const chord = MOOD_CHORDS[currentMood];
      // Warm low pad
      for (let i = 0; i < 2; i += 1) {
        const osc = ac.createOscillator();
        const padGain = ac.createGain();
        osc.type = i === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(chord[i] * 0.5, now);
        padGain.gain.setValueAtTime(i === 0 ? 0.12 : 0.06, now);
        osc.connect(padGain);
        padGain.connect(masterGain);
        osc.start(now);
        activeOscs.push(osc);
      }

      let step = 0;
      triggerChime(ac, masterGain, chord[2]);
      noteTimer = setInterval(() => {
        if (!running || !ctx || !masterGain) return;
        const notes = MOOD_CHORDS[currentMood] || MOOD_CHORDS.alpha;
        const freq = notes[step % notes.length];
        step += 1;
        triggerChime(ctx, masterGain, freq);
      }, 2200);

      running = true;
      return true;
    } catch {
      running = false;
      return false;
    }
  }

  function stop() {
    running = false;
    stopVoices();
    if (masterGain) {
      try {
        masterGain.disconnect();
      } catch {
        /* ignore */
      }
      masterGain = null;
    }
  }

  function setMood(mood) {
    currentMood = MOOD_CHORDS[mood] ? mood : 'alpha';
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
