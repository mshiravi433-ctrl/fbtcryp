/**
 * LOCAL NOTIFICATIONS — daily reminder + trade alerts
 * ---------------------------------------------------------------------------
 * LOCAL, not push. That distinction matters, so here is the honest reasoning:
 *
 * A real push notification (FCM) needs a server that holds a device-token
 * registry, a Firebase service account, and something that decides what to
 * send. We do not have a deployed backend yet, and shipping half a push stack
 * would mean a permission prompt that buys the user nothing.
 *
 * A LOCAL notification is scheduled by the app on the device itself. It needs
 * no server, no token registry and no key — and for a "remind me daily" message
 * it is indistinguishable to the user. The one thing it cannot do is deliver
 * breaking news the app didn't already know about.
 *
 * So: daily reminders and trade confirmations work today, entirely on-device.
 * When the backend is deployed, FCM can be layered on for genuinely new
 * information (see docs) without changing any of this.
 *
 * Android 13+ requires POST_NOTIFICATIONS to be granted at runtime. We ask only
 * when the user turns the feature on, never at launch — a permission prompt
 * before any value has been shown is the fastest way to a permanent denial.
 */

const CHANNEL_ID = 'fbt-daily';
const DAILY_ID = 1001;

/** Lazy import so the browser build never pulls the native plugin. */
async function plugin() {
  try {
    const [{ Capacitor }, mod] = await Promise.all([
      import('@capacitor/core'),
      import('@capacitor/local-notifications')
    ]);
    if (!Capacitor.isNativePlatform?.()) return null;
    return mod.LocalNotifications;
  } catch {
    return null; // web build, or plugin not installed
  }
}

export async function notificationsAvailable() {
  return Boolean(await plugin());
}

/**
 * Ask for permission. Returns true only on an explicit grant.
 * Call this from a user action (a toggle), never on mount.
 */
export async function requestPermission() {
  const LN = await plugin();
  if (!LN) return false;
  try {
    const current = await LN.checkPermissions();
    if (current.display === 'granted') return true;
    const asked = await LN.requestPermissions();
    return asked.display === 'granted';
  } catch {
    return false;
  }
}

/** Android 8+ refuses to show notifications that have no channel. */
async function ensureChannel(LN) {
  try {
    await LN.createChannel({
      id: CHANNEL_ID,
      name: 'FBT Swap',
      description: 'Market reminders and trade confirmations',
      importance: 4, // HIGH — heads-up, but not a full-screen intrusion
      visibility: 1,
      vibration: true
    });
  } catch {
    /* iOS has no channels; failure here is expected and harmless */
  }
}

/**
 * Rotating daily message.
 *
 * A notification that says the same thing every day gets muted within a week.
 * Rotating by day-of-year keeps it varied with no server involvement, and the
 * copy is deliberately about market activity rather than "come and trade!" —
 * nagging people into transactions is how an app gets reported.
 */
function dailyMessage(t, dayIndex) {
  const keys = ['market', 'signals', 'news', 'farm', 'security', 'rank', 'swap'];
  const key = keys[dayIndex % keys.length];
  return {
    title: t(`notif.daily.${key}.title`),
    body: t(`notif.daily.${key}.body`)
  };
}

/**
 * Schedule the once-a-day reminder.
 *
 * @param {(k:string)=>string} t   i18n translator, so the notification is in
 *                                 the user's language rather than English
 * @param {number} hour            local hour, 0-23
 */
export async function scheduleDaily(t, hour = 11) {
  const LN = await plugin();
  if (!LN) return false;

  try {
    await ensureChannel(LN);
    // Cancel first: scheduling the same id twice leaves two notifications on
    // some Android builds, and getting two a day is how you get uninstalled.
    await LN.cancel({ notifications: [{ id: DAILY_ID }] }).catch(() => {});

    const dayIndex = Math.floor(Date.now() / 86400000);
    const { title, body } = dailyMessage(t, dayIndex);

    await LN.schedule({
      notifications: [
        {
          id: DAILY_ID,
          channelId: CHANNEL_ID,
          title,
          body,
          schedule: { on: { hour, minute: 0 }, repeats: true, allowWhileIdle: false },
          smallIcon: 'ic_stat_icon',
          extra: { route: '/news' }
        }
      ]
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelDaily() {
  const LN = await plugin();
  if (!LN) return;
  try {
    await LN.cancel({ notifications: [{ id: DAILY_ID }] });
  } catch {
    /* nothing scheduled */
  }
}

/**
 * Immediate notification for a completed trade — useful when the app is
 * backgrounded while the transaction mines, which is the common case.
 */
export async function notifyTrade({ title, body }) {
  const LN = await plugin();
  if (!LN) return;
  try {
    await ensureChannel(LN);
    await LN.schedule({
      notifications: [
        {
          // Distinct id per notification so a second trade doesn't silently
          // replace the first one in the tray.
          id: Math.floor(Date.now() % 100000) + 2000,
          channelId: CHANNEL_ID,
          title,
          body,
          smallIcon: 'ic_stat_icon',
          extra: { route: '/wallet' }
        }
      ]
    });
  } catch {
    /* permission revoked between the toggle and now */
  }
}
