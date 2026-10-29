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
import {
  channelForTone,
  formatValue,
  resolveTone,
  toneSpec,
  vibrateForTone,
  webPresentation
} from './notificationDesign.js';

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

/**
 * Which chime a TONE means.
 *
 * `playSound` was written against the three order stages; the design system
 * speaks in six tones. Mapping them explicitly (rather than letting `profit`
 * fall through to the default success chime by accident) is what keeps the
 * sound and the artwork saying the same thing: a loss must never chime like a
 * win, and a passive info card must not sound like a target being hit.
 */
const TONE_SOUND = {
  profit: 'success',
  loss: 'error',
  pending: 'pending',
  ready: 'ready',
  alert: 'alert',
  info: 'closed'
};

/** Play the chime a tone deserves, if sounds are on. */
export function playToneSound(tone) {
  const kind = TONE_SOUND[tone] || 'success';
  playSound(kind);
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
export function notifyTrade({ ok = true, title, body, haptic, pnlPct = null, value = null } = {}) {
  const s = getNotifySettings();
  if (!s.tradeAlerts) return;

  /*
   * The tone, not just a boolean: a settled trade is `profit` news (mint) and a
   * failed one is `loss` news (crimson), so the chime, the buzz and the card all
   * agree. A caller that knows the P&L passes it and the card says the number.
   */
  const tone = ok ? 'profit' : 'loss';
  playToneSound(tone);
  vibrate(vibrateForTone(tone), haptic);

  showLocalNotification(title ?? (ok ? 'Trade complete' : 'Trade failed'), {
    body,
    tag: 'fbt-trade',
    tone,
    /* The bar above already showed it; the shade is for when it did not. */
    onlyWhenHidden: true,
    value: value || (Number.isFinite(Number(pnlPct)) ? formatValue({ pnlPct }) : ''),
    kicker: ok ? 'FILLED' : 'FAILED',
    link: null
  });
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

/**
 * The APK's shade, built from the same design system as the web push payload.
 *
 * ─── WHAT CHANGED AND WHY IT MATTERS ────────────────────────────────────────
 * This used to schedule a LocalNotification with a title, a body, a small icon
 * and our channel. Everything that makes a notification look DESIGNED — the wide
 * artwork, the tone's colour, the persistent card, the progress — was missing,
 * so an alert raised while the app was open looked like a different (worse)
 * product than the same alert arriving through FCM.
 *
 * `androidPresentation()` in src/lib/notificationDesign.js now builds the
 * presentation for BOTH transports, and Capacitor's LocalNotifications exposes
 * the two fields that carry it across to the OS:
 *
 *   largeIcon  the big picture on the right of the collapsed row — on Android
 *              this is the artwork slot, and it accepts a URL the plugin loads
 *   attachments the ExpandedImage a user sees when they pull the shade down
 *
 * Both point at the same server-rendered card the web push payload uses, which
 * is what makes the shade consistent across the APK, the PWA and the site.
 */

/**
 * The origin the NOTIFICATION ARTWORK must be fetched from.
 *
 * This is not `location.origin`, and the difference is a 404 on every APK: the
 * Capacitor WebView serves the bundle from `https://localhost`, so a relative
 * artwork path — or one built from the page origin — asks the PHONE for an image
 * the phone does not have. `apiBase()` already answers "where is our backend"
 * correctly (absolute, https, never loopback) for every shell, so the artwork
 * origin is derived from it.
 */
function artworkOrigin() {
  try {
    const base = String(apiBase() || '/api');
    if (/^https?:\/\//i.test(base)) return new URL(base).origin;
  } catch { /* fall through */ }
  return typeof location !== 'undefined' ? location.origin : '';
}

async function presentNativeShade(title, options = {}) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') {
      perm = await LocalNotifications.requestPermissions();
    }
    if (perm.display !== 'granted') return false;

    /*
     * The tone decides the colour, the channel, the vibration and the artwork.
     * A caller may pass one (`options.tone`), otherwise it is resolved from the
     * stage/side/P&L exactly as the server resolves it — so an in-app alert and
     * a server-sent one for the same event are the same card.
     */
    const tone = resolveTone({
      tone: options.tone,
      stage: options.stage || options.kind,
      side: options.side,
      pnlPct: options.pnlPct,
      scheduled: options.scheduled
    });
    const spec = toneSpec(tone);
    const language = (typeof document !== 'undefined' && document.documentElement.lang) || 'fa';
    const present = webPresentation(
      {
        title,
        body: options.body,
        url: options.data?.url,
        tone,
        stage: options.stage,
        value: options.value,
        label: options.label,
        kicker: options.kicker,
        progress: options.progress,
        tag: options.tag,
        vibrate: options.vibrate,
        requireInteraction: options.requireInteraction
      },
      language,
      { origin: artworkOrigin() }
    );

    await LocalNotifications.schedule({
      notifications: [{
        id: Date.now() % 2147483647,
        title: String(title || 'FBT Swap'),
        body: options?.body ? String(options.body) : '',
        /*
         * A LAUNCHER-ICON PLACEHOLDER WAS HERE AND IT SILENCED THE APP — see the
         * history below. Android refuses to post a notification with no valid
         * small icon, and the framework reports that by throwing, which the
         * catch at the bottom of this function swallows. Silence, not an error.
         */
        smallIcon: 'ic_stat_notification',
        iconColor: spec.accent,
        /*
         * ─── NO `largeIcon` HERE, AND IT IS NOT AN OVERSIGHT ────────────────
         * @capacitor/local-notifications declares `largeIcon` as a DRAWABLE
         * RESOURCE ID (its own type docs: "the filename without an extension in
         * res/drawable"). Handing it the URL of the rendered card sets a
         * resource id of 0, i.e. no icon at all — the same class of silent
         * failure as the missing `smallIcon` above.
         *
         * `attachments` would carry the picture, but it is iOS-ONLY in the
         * plugin and this project has no `ios/` target yet.
         *
         * So the honest split is:
         *   · IN the app      → the in-app bar (src/components/NotificationBar)
         *                       draws the full design; this OS card is the
         *                       notification the user can act on from outside it;
         *   · OUT of the app  → the alert comes from the SERVER over FCM, whose
         *                       payload DOES carry `image` (see server/fcm.js)
         *                       and renders as the big card on the lock screen.
         * Pretending a local notification can show remote artwork is how this
         * feature gets reported broken for the third time.
         */
        group: present.tag,
        /* The tone decides the channel — the same mapping the server uses, so
           an in-app alert and a pushed one land on the same channel with the
           same importance and the same tone. */
        channelId: channelForTone(tone),
        sound: 'fbt_notification',
        extra: { ...(options?.data || {}), tone, progress: present.progress, color: spec.accent },
        /*
         * `autoCancel` so tapping it clears the card (the deep link opens the
         * right screen); NOT `ongoing`, so the user can always swipe it away —
         * a notification a user cannot dismiss is a notification they revoke
         * the permission for.
         */
        autoCancel: true,
        ongoing: false
      }]
    });
    return true;
  } catch {
    return false;
  }
}


/**
 * Show a notification INSIDE the app: the drawn card and the bell's history.
 *
 * ─── WHY THIS IS ITS OWN EXPORT ────────────────────────────────────────────
 * There is a case the OS cannot help with: an FCM push arriving while the app is
 * in the FOREGROUND. Android does not draw a system notification for it (the SDK
 * hands it to the app instead), so before this the only thing that happened was
 * a hand-off with no visible result — a price hit while the user watched the app
 * produced nothing at all on screen.
 *
 * The right answer there is NOT to post a second system card on top of the app:
 * it is to draw OUR card, which is the design we actually control, and ring. So
 * the foreground listener calls this, and the background path keeps the shade.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.body]
 * @param {string} [args.tone]     one of the six design tones
 * @param {string|null} [args.link] an in-app route
 * @param {object} [args.options]  the raw alert fields (value/label/progress/…)
 * @param {boolean} [args.silent]  skip the chime (a preview rings separately)
 */
export function showInAppNotification({ title, body = null, tone = null, link = null, options = {}, silent = false } = {}) {
  const resolved = resolveTone({
    tone,
    stage: options?.stage,
    side: options?.side,
    pnlPct: options?.pnlPct,
    scheduled: options?.scheduled
  });
  mirrorToApp({ title, body, tone: resolved, link, options });
  if (!silent && getNotifySettings().sound) playToneSound(resolved);
  if (!silent) vibrate(vibrateForTone(resolved));
  return resolved;
}

/** The store writes, kept in one place so every caller mirrors identically. */
function mirrorToApp({ title, body = null, tone = 'info', link = null, options = {} }) {
  try {
    import('../store/useAppStore').then(({ useAppStore }) => {
      const state = useAppStore.getState();
      state.pushInbox({
        title: String(title || ''),
        body: body ? String(body) : null,
        kind: 'info',
        tone,
        link
      });
      state.showNotifBar({
        title: String(title || ''),
        body: body ? String(body) : null,
        tone,
        value: options?.value || '',
        label: options?.label || '',
        kicker: options?.kicker || '',
        progress: options?.progress ?? null,
        stage: options?.stage || '',
        link,
        /* Money news and a security prompt stay until they are dealt with. */
        persist: options?.persist ?? ['profit', 'loss', 'alert'].includes(tone)
      });
    }).catch(() => {});
  } catch { /* the mirrors are best-effort; the OS card is the source of truth */ }
}

export function showLocalNotification(title, options = {}) {
  /*
   * Mirror every notification into the in-app inbox FIRST, before any
   * permission gate: the settings-avatar bell must light up even when the OS
   * permission is denied or unsupported — the user asked the badge to be the
   * place where «نوع نوتیفیکیشن، علت و لینک» is always reachable. Lazy import
   * so this lib stays usable in non-React contexts (service worker helpers).
   */
  const tone = resolveTone({
    tone: options?.tone,
    stage: options?.stage || options?.kind,
    side: options?.side,
    pnlPct: options?.pnlPct,
    scheduled: options?.scheduled
  });
  const link = typeof options?.data?.url === 'string'
    ? (safeNativeRoute(options.data.url) || (options.data.url.startsWith('/') ? options.data.url : null))
    : null;

  /*
   * TWO mirrors, and the difference between them matters:
   *
   *   inbox   the HISTORY the settings bell opens. Persisted, unread-counted,
   *           opened deliberately.
   *   notifBar the DRAWN notification, shown the moment the event happens and
   *           then gone — the in-app twin of the card in the OS shade.
   *
   * Both are fed here, from the one function every alert already goes through,
   * so nothing can reach the history without also having been shown, and no new
   * alert type has to remember to call the bar.
   */
  mirrorToApp({ title, body: options?.body, tone, link, options });

  /* The design system decides what this card looks like on every transport. */
  const language = (typeof document !== 'undefined' && document.documentElement.lang) || 'fa';
  const present = webPresentation(
    {
      title,
      body: options?.body,
      url: options?.data?.url,
      tone,
      stage: options?.stage,
      value: options?.value,
      label: options?.label,
      kicker: options?.kicker,
      progress: options?.progress,
      tag: options?.tag,
      vibrate: options?.vibrate,
      actions: options?.actions,
      requireInteraction: options?.requireInteraction
    },
    language,
    { origin: artworkOrigin() }
  );

  /*
   * `onlyWhenHidden` — the difference between "tell the phone" and "tell the
   * app".
   *
   * A trade that settles while the user is LOOKING at the app gets the in-app
   * bar (pushed to the store above) and the chime. Posting an OS notification on
   * top of that is a duplicate the user has to dismiss twice, so the callers that
   * already drew the card pass this flag and the shade is used only when the app
   * is not in front of them — which is the case a notification exists for.
   */
  const onlyWhenHidden = options?.onlyWhenHidden === true;
  const inForeground = typeof document !== 'undefined' && document.visibilityState === 'visible';
  if (onlyWhenHidden && inForeground) return true;

  if (isNativeApp()) {
    presentNativeShade(title, { ...options, tone });
    return true;
  }
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

  /*
   * THE CARD IS BUILT HERE, NOT BY THE CALLER.
   *
   * Every field the shade reads — icon, badge, image, colour, tag, vibration,
   * lang/dir, actions — comes from `present`. Callers only say what HAPPENED;
   * this is what makes an in-app alert, a server push and a Settings preview
   * look identical, and it is why a new alert type cannot ship off-brand.
   */
  const notificationOptions = {
    body: present.body,
    icon: present.icon,
    badge: present.badge,
    image: present.image,
    color: present.color,
    tag: present.tag,
    lang: present.lang,
    dir: present.dir,
    vibrate: present.vibrate,
    renotify: present.renotify,
    requireInteraction: present.requireInteraction,
    actions: present.actions,
    data: present.data,
    silent: present.silent,
    timestamp: present.timestamp
  };

  try {
    // Going through the service worker when there is one means the
    // notification survives the page being frozen or closed.
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready.then((reg) =>
        reg.showNotification(title, notificationOptions)
      );
      return true;
    }
    return new Notification(title, notificationOptions);
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
let nativeLocalActionListener = null;
let nativeTokenWaiters = [];

const NATIVE_ROUTES = new Set([
  '/orders', '/intent', '/swap',
  /* Where the alert ABOUT a market move should land: the coin chart, the
     market list, the farm watchlist, the home screen. Without these the tap
     on a price-alert card opened the app and went NOWHERE — the report
     «نوتیفیکیشن میاد ولی باز نمیشه» on the APK. */
  '/', '/market', '/farm', '/signals', '/settings', '/news', '/orders/history'
]);

/*
 * Dynamic routes a notification may name. Kept as an allowlist of PATTERNS,
 * not a prefix check: a prefix like `/coin/` alone would happily accept
 * `/coin/../../evil`-style surprises, and this function is the one gate
 * between a server payload and `window.location`. Each pattern mirrors a real
 * <Route> in src/App.jsx (wiring-matched in test/price-watch-push-probe.mjs).
 */
const NATIVE_ROUTE_PATTERNS = [
  /^\/coin\/[a-zA-Z0-9._-]{1,64}$/,
  /^\/smart-money\/(wallet|token)\/[a-zA-Z0-9._:-]{1,64}\/[a-zA-Z0-9._:-]{1,120}$/
];

function safeNativeRoute(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value, 'https://fbtswap.app');
    if (parsed.origin !== 'https://fbtswap.app') return null;
    // HashRouter routes carry their own pathname and query inside `hash`.
    // Keep the query intact: `/orders?execute=…` is an action, not decoration.
    const hashRoute = parsed.hash.startsWith('#/') ? parsed.hash.slice(1) : null;
    const path = hashRoute ? hashRoute.split('?')[0] : parsed.pathname;
    if (!NATIVE_ROUTES.has(path) && !NATIVE_ROUTE_PATTERNS.some((rx) => rx.test(path))) return null;
    return hashRoute
      ? `/#${hashRoute}`
      : `/#${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export { safeNativeRoute };

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
    /* One place re-syncs EVERYTHING the server watches on this device's behalf
       after a (re-)registration — orders, smart-money tracking, and the token
       price/P&L watches. FCM tokens ROTATE, and each mirror is keyed by the
       push identity: a rotation that re-synced only orders left the other two
       alerters pointing at a dead token, silently. */
    try {
      const { loadOrders, syncWatches } = await import('./orders.js');
      await syncWatches(loadOrders());
    } catch { /* token registration must not fail because watch sync is best-effort */ }
    try {
      const { syncTracked } = await import('./smartMoneyWatch.js');
      await syncTracked();
    } catch { /* best-effort, same rule */ }
    try {
      const { syncPriceWatch } = await import('./priceAlerts.js');
      await syncPriceWatch();
    } catch { /* best-effort, same rule */ }
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
    /*
     * ─── A PUSH THAT ARRIVES WHILE THE APP IS OPEN ─────────────────────────
     * Android does NOT draw a system notification for a foreground message: the
     * SDK hands it to the app and expects the app to display it. This used to
     * re-raise it through LocalNotifications, which is a second OS card over a
     * UI the user is already looking at — and on Android it cannot carry the
     * artwork anyway (see the note in presentNativeShade).
     *
     * The bar is the better answer: it is our design, it deep-links, it rings,
     * and the shade still covers every case where the app is NOT in front of the
     * user — which is every case a notification actually exists for.
     */
    await nativePushPlugin.addListener('pushNotificationReceived', (notification) => {
      const data = notification?.data || {};
      const tone = data.tone || resolveTone({ stage: data.stage });
      showInAppNotification({
        title: notification?.title || 'FBT Swap',
        body: notification?.body || '',
        tone,
        link: safeNativeRoute(data.url) || null,
        options: {
          stage: data.stage,
          value: data.value,
          progress: data.progress === '' || data.progress == null ? null : Number(data.progress),
          kicker: data.stage ? String(data.stage).toUpperCase() : ''
        }
      });
    });
    /*
     * ─── TAPPING A LOCAL (foreground) CARD ────────────────────────────────
     * The push plugin's `pushNotificationActionPerformed` covers FCM cards;
     * the cards `presentNativeShade` posts through @capacitor/local-notifications
     * have their OWN tap event, and nothing listened to it — so tapping an
     * alert that arrived while the app was open just reopened the app at
     * wherever it was. Same safe routing, same navigation.
     */
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      nativeLocalActionListener = await LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
        const route = safeNativeRoute(notification?.extra?.url);
        if (route) window.location.hash = route.slice(1);
      });
    } catch { /* plugin absent (web build) — the web path taps through the SW */ }
    nativePushListenersReady = true;
    return () => {
      nativeRegistrationListener?.remove?.();
      nativeErrorListener?.remove?.();
      nativeActionListener?.remove?.();
      nativeLocalActionListener?.remove?.();
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

    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== 'granted') return { ok: false, reason: 'DENIED' };

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
    if (/FirebaseApp|google-services/i.test(msg)) {
      return { ok: false, reason: 'FIREBASE_NOT_CONFIGURED' };
    }
    return { ok: false, reason: msg === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED', detail: msg.slice(0, 120) };
  }
}

/**
 * Auto-register FCM once the user is genuinely inside the packaged app.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Registration used to happen only when the user opened Settings (or the News
 * permission row) and tapped "allow". On the web that is acceptable — a
 * browser's permission is memorable enough to find again. On a phone it is how
 * the feature quietly dies: someone installs the APK expecting price alerts,
 * never visits Settings, and the app never hands FCM a token — so `devices`
 * stays 0 on the server and nothing can ever reach the tray, no matter how
 * correctly the server and the OS are configured. That is exactly the state
 * this closes.
 *
 * It runs once per app session and never while a first-run screen (welcome /
 * onboarding / guide / lock) is up, so the OS permission prompt does not
 * interrupt first setup.
 *
 * Safety:
 *   - Already granted  → register() with no dialog.
 *   - Not asked yet    → one real Android runtime prompt, then register.
 *   - Denied           → returns immediately; Android will not re-show the
 *                        prompt after a denial, so we never nag.
 *   - Not native       → no-op.
 */
let nativeAutoRegistrationTried = false;
export async function autoRegisterNativePush() {
  if (!isNativeApp() || nativeAutoRegistrationTried) return { ok: false, reason: 'SKIP' };
  nativeAutoRegistrationTried = true;
  return registerNativePush();
}

/**
 * Silent web-push refresh for devices that ALREADY opted in.
 *
 * «نوتیفیکیشن باید حتی وقتی اپ یا سایت بسته است برسد» — a web push survives a
 * closed SITE (the service worker is woken by the push service itself), but
 * not a lost subscription: clearing site data, an expired push subscription
 * or a service-worker eviction all drop the endpoint while the server still
 * believes it holds one, and every later send then 404s into the void. The
 * user opted in once; making them find the toggle again to fix an invisible
 * break is a silent failure of the feature they asked for.
 *
 * Deliberately narrow: it only ever runs for a device whose stored settings
 * say "opted in", and only when the OS permission is still 'granted' — so it
 * can re-subscribe, never prompt. Native devices have their own boot-time
 * path (autoRegisterNativePush) and are skipped here.
 */
export async function refreshWebPushIfOptedIn() {
  if (isNativeApp()) return { ok: false, reason: 'NATIVE' };
  // The canonical guard (identical semantics: webNotificationApi() IS the
  // typeof check) so the static existence-check audit sees every bare read
  // behind the same idiom.
  if (!webNotificationApi() || Notification.permission !== 'granted') {
    return { ok: false, reason: 'NOT_GRANTED' };
  }
  const s = getNotifySettings();
  if (!s.pushSubscribed && !s.news) return { ok: false, reason: 'NOT_OPTED_IN' };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.pushManager) return { ok: false, reason: 'UNSUPPORTED' };
    const existing = await reg.pushManager.getSubscription();
    if (existing) return { ok: true, reason: 'ALREADY_SUBSCRIBED' };
    return registerPush();
  } catch {
    return { ok: false, reason: 'ERROR' };
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
    /* Same trio as sendNativeToken: every server-side watcher this device
       owns must learn the (possibly new) push identity, not just orders. */
    try {
      const { loadOrders, syncWatches } = await import('./orders.js');
      await syncWatches(loadOrders());
    } catch {
      /* watches are best-effort; the token is already on the server */
    }
    try {
      const { syncTracked } = await import('./smartMoneyWatch.js');
      await syncTracked();
    } catch { /* best-effort */ }
    try {
      const { syncPriceWatch } = await import('./priceAlerts.js');
      await syncPriceWatch();
    } catch { /* best-effort */ }
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

/* -------------------------------------------------------------------------- */
/* the bridge between the service worker's shade and this page                 */
/* -------------------------------------------------------------------------- */

/**
 * Listen for the two things a notification in the SHADE can tell a live page.
 *
 * IMPORTANT, AND IT IS THE MISSING HALF OF «با صدا بیاید» ON THE WEB:
 * the Notification API has no `sound` option that any engine still honours, so
 * a push that arrives while the site is open used to make NO sound at all —
 * the card slid in silently. `public/sw.js` therefore posts `fbt-push-tone` to
 * every open client when a push lands, and this is the listener that turns it
 * into the same synthesised chime the app plays in-app. It is best-effort by
 * necessity (a browser may have suspended the audio context), and it is
 * additionally gated on the user's own sound setting.
 *
 * `fbt-push-dismissed` is the other direction of the same thought: a swiped-away
 * card is one the user has SEEN, so it is marked read in the inbox and the bell
 * stops nagging about it.
 */
let pushBridgeInstalled = false;
export function installPushBridge() {
  if (pushBridgeInstalled || typeof navigator === 'undefined' || !navigator.serviceWorker) return false;
  pushBridgeInstalled = true;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'fbt-push-tone') {
      if (getNotifySettings().sound) playToneSound(msg.tone);
      return;
    }
    if (msg.type === 'fbt-push-dismissed') {
      try {
        import('../store/useAppStore').then(({ useAppStore }) => {
          const state = useAppStore.getState();
          const hit = (state.inbox || []).find((n) => !n.read && n.title && msg.data?.url && n.link === msg.data.url);
          if (hit) state.markInboxRead();
        }).catch(() => {});
      } catch { /* inbox is best-effort */ }
    }
  });
  return true;
}

/* -------------------------------------------------------------------------- */
/* the Settings preview                                                        */
/* -------------------------------------------------------------------------- */

/**
 * «نوتیفیکیشن‌هایی که در صفحهٔ تنظیمات می‌آید باید روی گوشی هم بیاید با صدا.»
 *
 * The Settings screen shows what each tone looks like. Tapping one used to play
 * a chime and nothing else, so the copy said "this is what a target hit looks
 * like" while the phone showed the user nothing. This posts the payload to the
 * service worker, which renders it through the EXACT buildNotification() the
 * push handler uses — same artwork, same colour, same tag, same actions — and
 * plays the chime on this page so the preview is audible too.
 *
 * @param {'profit'|'loss'|'pending'|'ready'|'alert'|'info'} tone
 */
const PREVIEW_COPY = {
  fa: {
    profit: { title: 'به هدف رسید — سود', body: 'پوزیشن BTC→USDT با سود بسته شد.' },
    loss: { title: 'حد ضرر فعال شد', body: 'پوزیشن ETH→USDT با ضرر بسته شد.' },
    pending: { title: 'سفارش خودکار در انتظار', body: 'BTC→USDT ثبت شد. با رسیدن به هدف خبر می‌دهیم.' },
    ready: { title: 'آمادهٔ سواپ', body: 'اتوماسیون شما به نتیجه رسید. برای امضا اپ را باز کن.' },
    alert: { title: 'هشدار امنیتی', body: 'یک درخواست امضا در انتظار تأیید شماست.' },
    info: { title: 'خلاصهٔ روزانهٔ FBT', body: 'بازار امروز را ببین؛ همه‌چیز در یک نگاه.' }
  },
  en: {
    profit: { title: 'Target reached — in profit', body: 'Your BTC→USDT position closed in profit.' },
    loss: { title: 'Stop-loss triggered', body: 'Your ETH→USDT position closed at a loss.' },
    pending: { title: 'Automation pending', body: 'BTC→USDT is set. We will alert you when it targets.' },
    ready: { title: 'Ready to swap', body: 'Your automation reached its result. Tap to sign.' },
    alert: { title: 'Security alert', body: 'A signing request is waiting for your approval.' },
    info: { title: 'FBT daily digest', body: 'See today’s market at a glance.' }
  }
};

export async function previewNotification(tone = 'ready', { lang } = {}) {
  const key = String(tone || 'ready').toLowerCase();
  const language = String(lang || (typeof document !== 'undefined' && document.documentElement.lang) || 'fa').split('-')[0];
  const pack = PREVIEW_COPY[language] || PREVIEW_COPY.en;
  const copy = pack[key] || pack.ready;

  /* Audible here and now: a preview is a user gesture, so the audio context is
     allowed to start and the chime is the point of the exercise. */
  playToneSound(key);
  vibrate(vibrateForTone(key));

  const payload = {
    ...copy,
    tone: key,
    stage: key === 'pending' ? 'pending' : key === 'profit' || key === 'loss' ? 'closed' : 'ready',
    /* A realistic card: a number, the pair, a progress, and the deep link the
       real alert would carry. A preview with placeholder dashes teaches the
       user nothing about what they will actually see. */
    value: key === 'profit' ? '+12.4%' : key === 'loss' ? '-3.75%' : '65,240',
    label: key === 'loss' ? 'ETH > USDT' : 'BTC > USDT',
    kicker: key === 'info' ? 'FBT SWAP' : key.toUpperCase(),
    progress: key === 'pending' ? 25 : key === 'info' ? null : 68,
    url: '/#/orders',
    lang: language
  };

  /* Native APK: the plugin posts the card itself, with the artwork. */
  if (isNativeApp()) {
    await presentNativeShade(copy.title, {
      body: copy.body,
      tone: key,
      value: payload.value,
      label: payload.label,
      kicker: payload.kicker,
      progress: payload.progress,
      data: { url: payload.url }
    });
    return { ok: true, via: 'native' };
  }

  /* Web/PWA: ask the service worker so the REAL handler renders it. */
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.active) {
      reg.active.postMessage({ type: 'fbt-preview-notification', payload });
      return { ok: true, via: 'service-worker' };
    }
  } catch { /* fall through */ }

  /* No worker (very old browser, or a dev server on plain http): a local
     notification still shows the same design through the same builder. */
  const shown = showLocalNotification(copy.title, {
    body: copy.body,
    tone: key,
    value: payload.value,
    label: payload.label,
    kicker: payload.kicker,
    progress: payload.progress,
    data: { url: payload.url },
    stage: payload.stage
  });
  return { ok: Boolean(shown), via: shown ? 'local' : 'none' };
}
