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

import { isIOS as _isIOS, isWebView as _isWebView, isStandalone as _isStandalone } from './platform.js';
import { apiBase } from './apiBase.js';

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
  /* Order/intent stages — MUST sound unlike success / promo / generic alert. */
  if (kind === 'pending') {
    partial(ctx, 523.25, t, 0.28, 0.12);
    partial(ctx, 659.25, t + 0.22, 0.32, 0.1);
    return;
  }
  if (kind === 'ready') {
    partial(ctx, 784, t, 0.16, 0.16);
    partial(ctx, 1046.5, t + 0.14, 0.22, 0.16);
    partial(ctx, 1318.5, t + 0.3, 0.45, 0.14);
    return;
  }
  if (kind === 'closed') {
    partial(ctx, 440, t, 0.35, 0.14);
    partial(ctx, 330, t + 0.2, 0.5, 0.12);
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

/*
 * SEVENTH INSTANCE OF THE NATIVE-GATED-BY-WEB-API BUG.
 *
 * A Capacitor WebView has no `window.Notification`, so this returned false on
 * the packaged Android app and Settings rendered "not available on this
 * device" with no way to even ask for permission — on the one platform where
 * notifications matter most, because the app can be fully closed.
 *
 * pushMode() was already fixed to branch on native first, but Settings calls
 * THIS function directly to decide whether to draw the permission row, so the
 * feature was switched off one level above the fix. Fixing a helper is not
 * enough when a caller re-implements the same gate.
 *
 * Native uses FCM through @capacitor/push-notifications, which does not need
 * the web Notification API at all.
 */
export const notificationsSupported = () => {
  if (typeof window === 'undefined') return false;
  if (isNativeApp()) return true;
  // On iOS WebViews Notification may exist but be non-functional.
  if (isIOS() && !iosPushPossible()) return true; // still allow local in-app toasts, just no push
  return 'Notification' in window;
};

/**
 * True when the WEB Notification API actually exists.
 *
 * ─── WHY THIS IS SEPARATE FROM notificationsSupported() ─────────────────────
 * The two questions look identical and are not:
 *
 *   notificationsSupported()  "can this device show notifications at all?"
 *                             → true on native, via FCM
 *   webNotificationApi()      "does `window.Notification` exist right now?"
 *                             → FALSE on native
 *
 * Conflating them is what crashed the app. `notificationsSupported()` was
 * (correctly) taught to return true on native, but three call sites then read
 * the bare global `Notification.permission` behind that check. In a Capacitor
 * WebView there is no such global, so it threw
 *
 *     ReferenceError: Notification is not defined
 *
 * Settings calls notificationPermission() inside a useState initialiser, i.e.
 * DURING RENDER, so the throw propagated to the top-level BootBoundary and the
 * user got «خطای غیرمنتظره» the instant they opened Settings.
 *
 * And it never recovered: the app uses HashRouter, so the URL stayed at
 * `#/settings`, and the error screen's only button is location.reload() —
 * which reloads straight back into the route that just threw. A permanent
 * lockout out of Settings, on the APK only. A browser has `Notification`, so
 * no amount of testing on the web build could ever show it.
 *
 * `typeof` rather than `'Notification' in window`, because a bare reference to
 * a missing global is exactly the throw being defended against.
 */
const webNotificationApi = () => typeof Notification !== 'undefined';
/*
 * Last known native permission, so the Settings row reflects reality after the
 * user answers the OS prompt. Starts at 'default' = not yet asked.
 */
let nativePermissionCache = 'default';

export function notificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  /*
   * Native: there is no web permission to read. Report the FCM registration
   * state we already track instead of guessing — 'default' means "we have not
   * asked yet", which is what makes Settings draw the "allow" row. The real
   * Android 13+ permission is requested through the Capacitor plugin in
   * requestNotificationPermission().
   */
  if (!webNotificationApi()) return nativePermissionCache;
  return Notification.permission;
}


export async function requestNotificationPermission() {
  /*
   * On the packaged Android app there is no `Notification` API, so
   * notificationsSupported() is false and this returned 'unsupported' — which
   * made the Settings toggle give up before ever reaching the native path.
   * The OS permission dialog was never even shown.
   *
   * Capacitor exposes the real Android 13+ runtime permission, so ask through
   * the plugin instead.
   */
  if (isNativeApp()) {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      let status = await PushNotifications.checkPermissions();
      if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
        status = await PushNotifications.requestPermissions();
      }
      // Remember it: notificationPermission() has no web API to read on
      // native, so without this the Settings row would keep offering "allow"
      // even after the user had already granted it.
      nativePermissionCache = status.receive === 'granted' ? 'granted' : 'denied';
      return nativePermissionCache;
    } catch {
      nativePermissionCache = 'denied';
      return 'denied';
    }
  }

  if (!notificationsSupported() || !webNotificationApi()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function showLocalNotification(title, options = {}) {
  /*
   * Mirror every notification into the in-app inbox FIRST, before any
   * permission gate: the settings-avatar bell must light up even when the OS
   * permission is denied or unsupported — the user asked the badge to be the
   * place where «نوع نوتیفیکیشن، علت و لینک» is always reachable. Lazy import
   * so this lib stays usable in non-React contexts (service worker helpers).
   */
  try {
    import('../store/useAppStore').then(({ useAppStore }) => {
      useAppStore.getState().pushInbox({
        title: String(title || ''),
        body: options?.body ? String(options.body) : null,
        kind: 'info',
        link: typeof options?.data?.url === 'string' && options.data.url.startsWith('/') ? options.data.url : null
      });
    }).catch(() => {});
  } catch { /* inbox mirror is best-effort */ }

  if (!notificationsSupported()) return null;
  /*
   * Guarded before the global is touched. This line used to read
   * `Notification.permission` straight after the support check, which throws
   * on native for the same reason notificationPermission() did.
   *
   * On native we fall through to the service-worker path below when one
   * exists; a Capacitor WebView has none, so this correctly returns null and
   * the caller falls back to FCM, which is the right transport there anyway.
   */
  if (!webNotificationApi()) return null;
  if (Notification.permission !== 'granted') return null;
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
 * ⚠️ READ THIS BEFORE RELYING ON IT
 * This is a LOCAL fallback and it can only fire while the app is running,
 * because that is when this function is called. In other words the only
 * person it can reach is someone already looking at the app — which is
 * precisely the person a re-engagement notification is useless for.
 *
 * Real re-engagement needs server-sent push (`server/push.js` +
 * `POST /api/push/daily` on a scheduler). When that is configured,
 * `pushConfigured()` is true and this local path stands down entirely so the
 * user never gets the same message twice.
 *
 * Kept because it is still genuinely useful for a build with no backend: it
 * surfaces the day's message the next time the app is opened, which is better
 * than nothing and is exactly what the Settings screen says it does.
 *
 * Rate-limited in code, not just by intent: a nagging app gets its
 * notification permission revoked, and after that you cannot reach the user
 * for the things that matter either.
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
  // The server owns the schedule when push is live — sending here too would
  // double up.
  if (pushConfigured() && s.pushSubscribed) return false;
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

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * True when this BUILD carries a VAPID public key.
 *
 * Note the distinction from `pushMode()` below: a key in the bundle only means
 * the client can attempt to subscribe. Whether the server can actually send is
 * a separate question, answered by `/api/push/status`, and the UI must not
 * promise push on the strength of a build flag alone.
 */
export const pushConfigured = () => Boolean(VAPID_PUBLIC_KEY);

let cachedPushMode = null;

/**
 * What push actually is on this install, right now.
 *
 *   'server' — a VAPID key is present AND the API confirms it can send.
 *              Notifications arrive with the app closed.
 *   'local'  — no server sender. Messages are shown the next time the app is
 *              opened. This is a real feature, but it is NOT push, and the UI
 *              says so rather than implying otherwise.
 *   'unsupported' — the browser/WebView has no Notification API at all.
 */
export async function pushMode(force = false) {
  if (cachedPushMode && !force) return cachedPushMode;

  /*
   * Native Android is decided before the web checks run, and for two reasons:
   *
   *   1. `notificationsSupported()` tests for the web Notification API, which
   *      a Capacitor WebView does not have — so this returned 'unsupported'
   *      and the whole feature was switched off before FCM was considered.
   *
   *   2. `pushConfigured()` tests for a VAPID public key. FCM does not use
   *      VAPID at all, so a correctly configured native build with no VAPID
   *      key was downgraded to 'local' (device-only) notifications.
   *
   * Either check alone was enough to silently disable server push on the APK.
   */
  if (isNativeApp()) {
    cachedPushMode = 'server';
    return cachedPushMode;
  }

  if (!notificationsSupported()) {
    cachedPushMode = 'unsupported';
    return cachedPushMode;
  }
  if (!pushConfigured()) {
    cachedPushMode = 'local';
    return cachedPushMode;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${apiBase()}/push/status`, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = res.ok ? await res.json() : null;
    cachedPushMode = data?.configured ? 'server' : 'local';
  } catch {
    // Cannot confirm the server can send, so do not claim it can.
    cachedPushMode = 'local';
  }
  return cachedPushMode;
}

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
  /*
   * iOS outside of a pinned PWA or inside a WebView will let you call
   * PushManager.subscribe but returns an empty/error endpoint, so we refuse
   * early and report the real reason. Settings uses this to show a hint.
   */
  if (isIOS() && !iosPushPossible()) {
    return { ok: false, reason: 'IOS_NEEDS_PIN' };
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

    await fetch(`${apiBase()}/push/subscribe`, {
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
      await fetch(`${apiBase()}/push/unsubscribe`, {
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

/* -------------------------------------------------------------------------- */
/* Native Android push (FCM)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ─── WHY THIS EXISTS SEPARATELY FROM registerPush() ─────────────────────────
 * `registerPush()` uses the Web Push API. Inside the packaged Android app the
 * page runs in a Capacitor WebView, and a WebView has NO Push API at all — no
 * `PushManager`, no `pushManager.subscribe()`. So on the APK that function
 * returns UNSUPPORTED and exits, and every push-driven feature silently does
 * nothing.
 *
 * That is not a small gap: the whole point of server-side order watching is
 * that the alert arrives with the app CLOSED, and "app closed" on a phone
 * means the native layer, not a WebView.
 *
 * FCM is the channel that reaches those users. The server has supported it
 * since server/fcm.js was added; this is the client half that was missing, so
 * no APK user had ever registered a token.
 */

/** True when running inside the packaged native app rather than a browser. */
export function isNativeApp() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
}

/**
 * iOS: detect whether true server push is possible here.
 *
 * Before iOS 16.4 there was NO web push at all. From 16.4 onward it works ONLY
 * for sites pinned to the home screen (standalone mode). In a third-party
 * WebView (Telegram/Instagram in-app browser, Chrome/Firefox on iOS) the
 * Notification API exists but does nothing when you ask for permission — the
 * promise never resolves and no notification shows. We treat all three cases
 * as unsupported so Settings can tell the user what to do instead of silently
 * spinning.
 */
function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return _isIOS();
}
function isWebView() { return _isWebView(); }
function isPinned() { return _isStandalone(); }

function iosPushPossible() {
  if (!isIOS()) return true;
  if (isNativeApp()) return false; // iOS native (APNs) not wired up — no ios/ folder yet
  if (isWebView()) return false;
  // Must be pinned to home screen AND on iOS ≥ 16.4.
  if (!isPinned()) return false;
  const v = String(navigator.userAgent || '').match(/Version\/(\d+)/);
  const major = v ? parseInt(v[1], 10) : 0;
  return major >= 16;
}

/**
 * Register this device for native push and hand the token to the server.
 *
 * Returns the same {ok, reason} shape as registerPush() so callers can treat
 * the two transports identically.
 */
let nativePushPlugin = null;
let nativePushListenersReady = false;
let nativeRegistrationListener = null;
let nativeActionListener = null;
let nativeErrorListener = null;
let nativeTokenWaiters = [];

const NATIVE_ROUTES = new Set(['/orders', '/intent', '/swap']);

function safeNativeRoute(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value, 'https://fbtswap.app');
    if (parsed.origin !== 'https://fbtswap.app') return null;
    const path = parsed.hash.startsWith('#/') ? parsed.hash.slice(1).split('?')[0] : parsed.pathname;
    return NATIVE_ROUTES.has(path) ? value : null;
  } catch {
    return null;
  }
}

async function sendNativeToken(token) {
  if (!token) return false;
  try {
    const res = await fetch(`${apiBase()}/push/fcm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, lang: document.documentElement.lang || 'fa' })
    });
    if (!res.ok) return false;
    setNotifySettings({ pushSubscribed: true, fcmToken: token });
    try {
      const { loadOrders, syncWatches } = await import('./orders.js');
      await syncWatches(loadOrders());
    } catch { /* token registration must not fail because watch sync is best-effort */ }
    return true;
  } catch {
    return false;
  }
}

/** Install long-lived FCM listeners once per app lifetime. */
export async function initNativePushListeners() {
  if (!isNativeApp() || nativePushListenersReady) return null;
  try {
    nativePushPlugin = nativePushPlugin || (await import('@capacitor/push-notifications')).PushNotifications;
    nativeRegistrationListener = await nativePushPlugin.addListener('registration', ({ value }) => {
      nativeTokenWaiters.splice(0).forEach(({ resolve }) => resolve(value));
      sendNativeToken(value);
    });
    nativeErrorListener = await nativePushPlugin.addListener('registrationError', (error) => {
      nativeTokenWaiters.splice(0).forEach(({ reject }) => reject(new Error(String(error?.error || 'REGISTRATION_FAILED'))));
    });
    nativeActionListener = await nativePushPlugin.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const route = safeNativeRoute(notification?.data?.url);
      if (route) window.location.hash = route.slice(1);
    });
    nativePushListenersReady = true;
    return () => {
      nativeRegistrationListener?.remove?.();
      nativeErrorListener?.remove?.();
      nativeActionListener?.remove?.();
      nativeTokenWaiters = [];
      nativePushListenersReady = false;
    };
  } catch {
    return null;
  }
}

export async function registerNativePush() {
  if (!isNativeApp()) return { ok: false, reason: 'NOT_NATIVE' };

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    nativePushPlugin = PushNotifications;
    await initNativePushListeners();

    // Android 13+ made notifications a runtime permission. Without this the OS
    // silently drops every notification and the app looks broken rather than
    // denied.
    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== 'granted') return { ok: false, reason: 'DENIED' };

    // The token arrives asynchronously via an event, so wrap it in a promise
    // with a timeout — a registration that never resolves would hang the
    // settings toggle forever with no explanation.
    const token = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        nativeTokenWaiters = nativeTokenWaiters.filter((waiter) => waiter.resolve !== resolve);
        reject(new Error('TIMEOUT'));
      }, 15000);
      nativeTokenWaiters.push({
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject
      });
      const registration = PushNotifications.register();
      registration?.catch?.((e) => {
        clearTimeout(timer);
        nativeTokenWaiters = nativeTokenWaiters.filter((waiter) => waiter.resolve !== resolve);
        reject(new Error(String(e?.message || 'REGISTRATION_FAILED')));
      });
    });

    if (!token) return { ok: false, reason: 'NO_TOKEN' };

    if (!(await sendNativeToken(token))) return { ok: false, reason: 'SERVER_REJECTED' };
    return { ok: true, token };
  } catch (e) {
    const msg = String(e?.message || e);
    // A missing Firebase config is the most common setup failure and produces
    // a very unhelpful native error, so name it.
    if (/FirebaseApp|google-services/i.test(msg)) {
      return { ok: false, reason: 'FIREBASE_NOT_CONFIGURED' };
    }
    return { ok: false, reason: msg === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED', detail: msg.slice(0, 120) };
  }
}

/**
 * Register for push on whichever transport this device actually supports.
 *
 * Callers should use this rather than picking a transport themselves — that
 * choice is exactly the thing that was got wrong, and getting it wrong is
 * invisible until someone reports that notifications never arrive.
 */
export async function registerPushAnywhere() {
  const result = isNativeApp() ? await registerNativePush() : await registerPush();
  if (result?.ok) {
    try {
      const { loadOrders, syncWatches } = await import('./orders.js');
      await syncWatches(loadOrders());
    } catch {
      /* watches are best-effort; the token is already on the server */
    }
  }
  return result;
}

/** True only when this device actually handed the server an endpoint. */
export function pushReallySubscribed() {
  const s = getNotifySettings();
  if (isNativeApp()) return Boolean(s.fcmToken);
  return Boolean(s.pushSubscribed);
}

/** The identifier the server watches against, whichever transport is in use. */
export async function pushIdentity() {
  if (isNativeApp()) {
    const token = getNotifySettings().fcmToken;
    return token ? { kind: 'fcm', endpoint: `fcm:${token}` } : null;
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    return sub?.endpoint ? { kind: 'web', endpoint: sub.endpoint } : null;
  } catch {
    return null;
  }
}
