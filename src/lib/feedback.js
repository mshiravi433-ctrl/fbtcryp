/**
 * TRADE FEEDBACK — sound + vibration
 * ---------------------------------------------------------------------------
 * When a swap confirms on-chain the phone should ring and buzz. On a phone the
 * user is often not looking at the screen while a transaction is mining, and a
 * silent success is indistinguishable from a stall.
 *
 * The tone is SYNTHESISED with the Web Audio API rather than shipped as an MP3:
 *
 *   • no asset to download, so it works offline and adds 0 bytes to the APK
 *   • no licensing question over a sound file
 *   • it can be tuned per event (success chord vs. error interval) for free
 *
 * Both channels respect user settings and can be turned off independently —
 * a trading app that cannot be silenced gets uninstalled.
 *
 * Autoplay policy: browsers block audio until the user has interacted with the
 * page. Every path that plays a sound here is downstream of a tap (pressing
 * Swap), so the AudioContext is already unlocked by the time we need it.
 */

let ctx = null;

function audioContext() {
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
  // Suspended is normal after a period of inactivity; resuming is a no-op when
  // already running.
  if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
  return ctx;
}

/**
 * One note. `type` shapes the timbre — sine is soft and phone-speaker friendly;
 * a square wave through a tiny speaker sounds like a fault.
 */
function tone(freq, startAt, duration, gainPeak = 0.18, type = 'sine') {
  const ac = audioContext();
  if (!ac) return;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);

  // A short attack and exponential decay: an abrupt start/stop produces an
  // audible click, which reads as a glitch rather than a chime.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainPeak, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** Vibration, guarded — iOS Safari has no navigator.vibrate at all. */
function buzz(pattern) {
  try {
    navigator?.vibrate?.(pattern);
  } catch {
    /* not supported; the sound still carries the message */
  }
}

const PATTERNS = {
  // Rising major triad — unmistakably "done".
  success: {
    notes: [
      [523.25, 0.0, 0.14],  // C5
      [659.25, 0.1, 0.14],  // E5
      [783.99, 0.2, 0.34]   // G5
    ],
    vibrate: [45, 55, 45, 55, 130]
  },
  // Falling minor second — dissonant on purpose, reads as "wrong".
  error: {
    notes: [
      [392.0, 0.0, 0.18],
      [329.63, 0.14, 0.3]
    ],
    vibrate: [110, 70, 110]
  },
  // Single soft tick for "submitted, now waiting".
  pending: {
    notes: [[587.33, 0.0, 0.1]],
    vibrate: [25]
  },
  // Two-note ping for alerts/notifications.
  alert: {
    notes: [
      [880.0, 0.0, 0.1],
      [1174.66, 0.09, 0.2]
    ],
    vibrate: [35, 45, 35]
  }
};

/**
 * Play trade feedback.
 *
 * @param {'success'|'error'|'pending'|'alert'} kind
 * @param {{sound?: boolean, vibrate?: boolean, volume?: number}} opts
 */
export function playFeedback(kind = 'success', opts = {}) {
  const { sound = true, vibrate = true, volume = 1 } = opts;
  const preset = PATTERNS[kind] ?? PATTERNS.success;

  if (vibrate) buzz(preset.vibrate);

  if (!sound) return;
  const ac = audioContext();
  if (!ac) return;

  const now = ac.currentTime + 0.01;
  const vol = Math.max(0, Math.min(1, volume));
  for (const [freq, offset, dur] of preset.notes) {
    tone(freq, now + offset, dur, 0.18 * vol);
  }
}

/**
 * Unlock audio from a user gesture.
 *
 * Mobile browsers create the AudioContext in a suspended state until a real
 * interaction happens. Calling this on the first tap means the success chime
 * is not silently swallowed later, when the tap that matters is the one that
 * started the transaction.
 */
export function primeAudio() {
  const ac = audioContext();
  if (!ac) return;
  try {
    const buf = ac.createBuffer(1, 1, 22050);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.start(0);
  } catch {
    /* best effort */
  }
}

export const audioSupported = () =>
  typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);

export const vibrationSupported = () =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
