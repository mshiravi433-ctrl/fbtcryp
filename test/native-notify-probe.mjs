/**
 * NATIVE NOTIFICATION PROBE
 * ---------------------------------------------------------------------------
 * REAL BUG, reported from a device: "وارد تنظیمات میشی اپ میزنه خطای غیر
 * منتظره و دیگه درست نمیشه" — open Settings on the APK, get the crash screen,
 * and it never recovers.
 *
 * Cause: `notificationsSupported()` returns TRUE on native (correctly — the
 * app reaches users through FCM there). Three call sites then read the bare
 * global `Notification.permission` behind that check. A Capacitor WebView has
 * no `window.Notification`, so the bare reference threw
 *
 *     ReferenceError: Notification is not defined
 *
 * Settings calls `notificationPermission()` inside a useState initialiser —
 * during render — so React tore the tree down and the top-level BootBoundary
 * painted «خطای غیرمنتظره».
 *
 * Why it was permanent: HashRouter keeps the URL at `#/settings`, and the
 * error screen's only button is `location.reload()`. Reloading returned to the
 * same route and threw again. The user was locked out of Settings for good.
 *
 * ─── WHY THE EXISTING TESTS ALL PASSED ──────────────────────────────────────
 * Two blind spots, and this file closes both:
 *
 *   1. Every DOM suite runs in jsdom, which HAS `window.Notification`. The
 *      crash only exists where that global is absent. No browser-shaped
 *      environment can ever reproduce it.
 *   2. wiring.mjs checks this area by REGEX — it asserted that
 *      `notificationsSupported()` mentions `isNativeApp()`. That was true both
 *      before and after the bug, because the broken part was in a different
 *      function. Grepping for the fix cannot see a caller that ignores it.
 *
 * So this probe does the one thing neither did: it deletes `Notification`,
 * injects a fake Capacitor, and CALLS the real functions. It fails loudly
 * against the pre-fix source.
 */

import { JSDOM } from 'jsdom';

/**
 * Build a DOM that matches a packaged Android WebView.
 *
 * The two properties that matter are exactly the ones that never occur
 * together in a browser: Capacitor present, Notification absent.
 */
function installNativeDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://localhost/'
  });
  const w = dom.window;

  delete w.Notification;
  w.Capacitor = { isNativePlatform: () => true };

  global.window = w;
  global.document = w.document;
  global.localStorage = w.localStorage;
  Object.defineProperty(global, 'navigator', { value: w.navigator, configurable: true });
  // Deliberately NOT defining global.Notification: a bare reference must throw
  // here exactly as it does on the device.
  delete global.Notification;
  return w;
}

function installBrowserDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://localhost/'
  });
  const w = dom.window;

  function FakeNotification() {}
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = async () => 'granted';
  w.Notification = FakeNotification;
  delete w.Capacitor;

  global.window = w;
  global.document = w.document;
  global.localStorage = w.localStorage;
  global.Notification = FakeNotification;
  Object.defineProperty(global, 'navigator', { value: w.navigator, configurable: true });
  return w;
}

/** Call `fn`, reporting a throw as a failure rather than aborting the suite. */
function survives(rows, label, fn) {
  try {
    const value = fn();
    rows.push([`${label} → ${JSON.stringify(value)}`, true]);
    return value;
  } catch (e) {
    rows.push([`${label} — THREW ${e.constructor.name}: ${e.message}`, false]);
    return undefined;
  }
}

export default async function run() {
  const rows = [];

  /* ------------------------- native: must not throw ---------------------- */

  installNativeDom();
  // Cache-busted so the module re-evaluates against this environment.
  const nat = await import(`../src/lib/notify.js?native=${Date.now()}`);

  rows.push(['the probe really is simulating native', nat.isNativeApp() === true]);
  rows.push([
    'the probe really has no Notification global',
    typeof globalThis.Notification === 'undefined'
  ]);

  // Native reaches users through FCM, so this stays true — that is correct and
  // is precisely why the unguarded reads below were reachable.
  rows.push(['notifications are still supported on native (FCM)', nat.notificationsSupported() === true]);

  // THE CRASH. This is the call Settings makes during render.
  const perm = survives(rows, 'notificationPermission() on native', () =>
    nat.notificationPermission()
  );
  rows.push([
    'native permission is a real state, not "unsupported"',
    ['default', 'granted', 'denied'].includes(perm)
  ]);

  survives(rows, 'showLocalNotification() on native', () => nat.showLocalNotification('t', {}));

  await (async () => {
    try {
      const r = await nat.requestNotificationPermission();
      rows.push([`requestNotificationPermission() on native → ${JSON.stringify(r)}`, true]);
    } catch (e) {
      rows.push([`requestNotificationPermission() on native — THREW: ${e.message}`, false]);
    }
  })();

  /* --------------------- browser: must be unchanged ---------------------- */
  /*
   * The fix must not "work" by disabling notifications for everyone. The web
   * path is the one that currently has real subscribers, so it is asserted
   * just as hard.
   */
  installBrowserDom();
  const web = await import(`../src/lib/notify.js?web=${Date.now()}`);

  rows.push(['browser is not detected as native', web.isNativeApp() === false]);
  rows.push(['notifications are supported in a browser', web.notificationsSupported() === true]);
  rows.push([
    'the browser still reads the real Notification.permission',
    web.notificationPermission() === 'granted'
  ]);

  return rows;
}
