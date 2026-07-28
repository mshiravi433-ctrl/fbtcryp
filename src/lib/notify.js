/**
 * FEEDBACK & NOTIFICATIONS
 * ---------------------------------------------------------------------------
 * Three separate things people tend to lump together:
 *
 *   1. IN-APP FEEDBACK — a ring tone and a vibration the instant a trade
 *      settles. Synthesised with the Web Audio API rather than shipped as an
 *      mp3: no asset to download, no codec to fight, works offline, and it
 *      respects the phone's silent switch the same way any other web audio
 *      does. Vibration uses `navigator.vibrate` and, inside Telegram, the
 *      native haptic engine (which feels better than the raw motor).
 *
 *   2. LOCAL NOTIFICATIONS — a Notification the browser/WebView shows even
 *      when the app is backgrounded, driven by the daily scheduler below.
 *
 *   3. PUSH (server-sent) — genuinely remote push needs a push service and a
 *      backend holding VAPID keys. `registerPush()` wires that up when the
 *      keys are configured; when they aren't, we fall back to the local
 *      scheduler rather than pretending. Notifications must never be a lie:
 *      an app that claims "push enabled" and then sends nothing is worse than
 *      one that says it's running locally.
 *
 * Everything is opt-in and every function is a no-op when the browser lacks
 * the API, so the same code runs in the Telegram Mini App, a desktop browser
 * and the Android APK.
 */

const SETTINGS_KEY = 'fbt-notify-v1';

const defaults = {
  sound: true,
  vibrate: true,
  tradeAlerts: true,
  dailyPromo: true,
  priceAlerts: true,
  news: true,
  lastPromoAt: 0,
  pushSubscribed: false
};

export function getNotifySettings() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export function setNotifySettings(patch) {
  const next = { ...getNotifySettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* private mode — settings just won't persist */
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* sound                                                                       */
/* -------------------------------------------------------------------------- */

let audioCtx = null;

/**
 * Browsers only allow audio after a user gesture. Call this from any tap
 * (we call it on the swap confirm button) so the context is already "running"
 * by the time the transaction settles a minute later.
 */
export function primeAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/** One bell-like partial. Real bells are several detuned sines decaying fast. */
function partial(ctx, freq, start, dur, gain) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/**
 * Play a short chime.
 * `kind`: 'success' (rising major third), 'error' (falling minor second),
 * 'alert' (two quick taps).
 */
export function playSound(kind = 'success') {
  if (!getNotifySettings().sound) return;
  const ctx = primeAudio();
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;

  if (kind === 'error') {
    partial(ctx, 392, t, 0.5, 0.16);
    partial(ctx, 370, t + 0.13, 0.6, 0.14);
    return;
  }
  if (kind === 'alert') {
    partial(ctx, 880, t, 0.18, 0.12);
    partial(ctx, 880, t + 0.16, 0.22, 0.1);
    return;
  }
  // success: C6 -> E6 -> G6, each with a bright partial an octave up
  [
    [1046.5, 0],
    [1318.5, 0.1],
    [1568.0, 0.2]
  ].forEach(([f, d]) => {
    partial(ctx, f, t + d, 0.75, 0.16);
    partial(ctx, f * 2, t + d, 0.35, 0.05);
  });
}

/* -------------------------------------------------------------------------- */
/* vibration                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * @param {number[]|number} pattern ms on/off pattern
 * @param {(style:string)=>void} [haptic] Telegram haptic callback, preferred
 *        on iOS where navigator.vibrate does not exist at all.
 */
export function vibrate(pattern = [30, 40, 60], haptic) {
  if (!getNotifySettings().vibrate) return;
  try {
    haptic?.(Array.isArray(pattern) && pattern.length > 2 ? 'success' : 'medium');
  } catch {
    /* not inside Telegram */
  }
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported or blocked by a permissions policy */
  }
}

/**
 * The combined "a trade just happened" signal: chime + buzz + a notification
 * if the app is in the background.
 */
export function notifyTrade({ ok = true, title, body, haptic } = {}) {
  const s = getNotifySettings();
  if (!s.tradeAlerts) return;

  playSound(ok ? 'success' : 'error');
  vibrate(ok ? [40, 60, 40, 60, 120] : [120, 80, 120], haptic);

  if (document.visibilityState !== 'visible') {
    showLocalNotification(title ?? (ok ? 'Trade complete' : 'Trade failed'), {
      body,
      tag: 'fbt-trade'
    });
  }
}

/* -------------------------------------------------------------------------- */
/* notifications                                                               */
/* -------------------------------------------------------------------------- */

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export function notificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function showLocalNotification(title, options = {}) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return null;
  try {
    // Going through the service worker when there is one means the
    // notification survives the page being frozen or closed.
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready.then((reg) =>
        reg.showNotification(title, { icon: '/icon-192.png', badge: '/icon-192.png', ...options })
      );
      return true;
    }
    return new Notification(title, { icon: '/icon-192.png', ...options });
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* daily promo / re-engagement                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One promotional notification per 24h per install.
 *
 * Deliberately rate-limited in code, not just by intent: a nagging app gets
 * its notification permission revoked, and then you can't reach the user for
 * anything that matters (a filled order, a security notice). One a day is the
 * most that stays welcome.
 *
 * The message rotates so it doesn't read like a stuck robot.
 */
const PROMO_KEYS = ['promo1', 'promo2', 'promo3', 'promo4', 'promo5', 'promo6', 'promo7'];

export function pickPromoKey(date = new Date()) {
  const dayIndex = Math.floor(date.getTime() / 86400000);
  return PROMO_KEYS[dayIndex % PROMO_KEYS.length];
}

/**
 * Called on every app open. Fires at most once per 24h.
 * @param {(key:string)=>{title:string, body:string}} resolve translator
 */
export function maybeSendDailyPromo(resolve) {
  const s = getNotifySettings();
  if (!s.dailyPromo) return false;
  if (notificationPermission() !== 'granted') return false;
  if (Date.now() - (s.lastPromoAt || 0) < 24 * 60 * 60 * 1000) return false;

  const { title, body } = resolve(pickPromoKey());
  showLocalNotification(title, { body, tag: 'fbt-daily' });
  setNotifySettings({ lastPromoAt: Date.now() });
  return true;
}

/* -------------------------------------------------------------------------- */
/* web push                                                                    */
/* -------------------------------------------------------------------------- */

const VAPID_PUBLIC_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_VAPID_PUBLIC_KEY) || '';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export const pushConfigured = () => Boolean(VAPID_PUBLIC_KEY);

/**
 * Subscribe this device to server-sent push.
 * Returns `{ ok, reason }` — `reason: 'NOT_CONFIGURED'` means the build has no
 * VAPID key, in which case the caller should fall back to the local scheduler
 * and say so in the UI.
 */
export async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'UNSUPPORTED' };
  }
  if (!pushConfigured()) return { ok: false, reason: 'NOT_CONFIGURED' };

  const perm = await requestNotificationPermission();
  if (perm !== 'granted') return { ok: false, reason: 'DENIED' };

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      }));

    await fetch(`${API_BASE}/push/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub, lang: document.documentElement.lang || 'fa' })
    });
    setNotifySettings({ pushSubscribed: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'FAILED', detail: String(e?.message || e).slice(0, 120) };
  }
}

export async function unregisterPush() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch(`${API_BASE}/push/unsubscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint })
      }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {
    /* nothing to unsubscribe */
  }
  setNotifySettings({ pushSubscribed: false });
}

/** Register the service worker that backs offline caching and push. */
export async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  // The APK serves from https://localhost and a SW there is fine; a plain
  // http:// dev server is not, and the browser would throw.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}
