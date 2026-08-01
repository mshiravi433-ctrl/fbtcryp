/**
 * WIRING AUDIT — does every interface actually connect to something?
 *
 * These are the failures that no render test catches, because each one
 * "works": the component mounts, React is happy, the build is green. They only
 * show up in the user's hands.
 *
 * Three real bugs from this project motivated each check:
 *
 *   1. A t() key that exists in no locale renders as the literal string
 *      `common.close` on a button. Found exactly that on the confirmation
 *      shown after a successful transfer — the last thing a nervous user
 *      reads after sending money.
 *
 *   2. A `navigate('/x')` to a path with no <Route> silently lands on the
 *      catch-all, so the button appears to do nothing. The P2P "send direct"
 *      button did this for a while.
 *
 *   3. A page file with no route and no link is dead code that still ships in
 *      the bundle and still gets maintained. Home/Portfolio/Analysis sat there
 *      for months, and their missing translation keys polluted every audit.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(p, 'utf8');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Resolve a dotted key against the locale object. */
function hasKey(obj, path) {
  let cur = obj;
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object' || !(part in cur)) return false;
    cur = cur[part];
  }
  return true;
}

export default function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  const files = walk('src');
  const app = read('src/App.jsx');
  const en = JSON.parse(read('src/i18n/locales/en.json'));

  const routes = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);

  /* ------------------------- 1. translation keys ------------------------- */
  /*
   * Only statically-written keys can be checked. Templates like
   * t(`nft.err.${code}`) are deliberately skipped — they are checked by the
   * screen tests instead, and pretending to verify them here would be worse
   * than admitting the limit.
   */
  const missingKeys = [];
  for (const f of files) {
    for (const m of read(f).matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
      if (!hasKey(en, m[1])) missingKeys.push(`${m[1]} (${f})`);
    }
  }
  t(
    `every static t() key exists in en.json${missingKeys.length ? ` — missing: ${missingKeys.slice(0, 4).join(', ')}` : ''}`,
    missingKeys.length === 0
  );

  /* ---------------------------- 2. navigation ---------------------------- */
  const targets = new Set();
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/to:\s*'(\/[a-z0-9/-]*)'/g)) targets.add(m[1]);
    for (const m of s.matchAll(/navigate\('(\/[a-z0-9/-]*)'/g)) targets.add(m[1]);
  }

  const resolves = (link) =>
    routes.some((r) =>
      r.includes(':')
        ? new RegExp(`^${r.replace(/:[a-zA-Z]+/g, '[^/]+')}$`).test(link)
        : r === link
    );

  const broken = [...targets].filter((l) => !resolves(l));
  t(
    `every nav target has a route${broken.length ? ` — broken: ${broken.join(', ')}` : ''}`,
    broken.length === 0
  );
  t('a meaningful number of nav targets were checked', targets.size > 20);

  /* ------------------------- 3. unreachable pages ------------------------ */
  const orphans = routes.filter(
    (r) => !r.includes(':') && r !== '/' && r !== '*' && !targets.has(r)
  );
  t(
    `no route is unreachable${orphans.length ? ` — orphaned: ${orphans.join(', ')}` : ''}`,
    orphans.length === 0
  );

  /* --------------------------- 4. dead page files ------------------------ */
  const pageFiles = readdirSync('src/pages')
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => f.replace('.jsx', ''));
  // Guide/Onboarding/Welcome are rendered directly by App, not via a route.
  const routedDirectly = ['Guide', 'Onboarding', 'Welcome'];
  const unimported = pageFiles.filter(
    (p) => !routedDirectly.includes(p) && !app.includes(`pages/${p}'`)
  );
  t(
    `no page file is orphaned${unimported.length ? ` — dead: ${unimported.join(', ')}` : ''}`,
    unimported.length === 0
  );

  /* ----------------------- 5. locale key parity -------------------------- */
  /*
   * fa is the primary market's language. A key present in en but absent in fa
   * silently falls back to English mid-sentence, which reads as a rendering
   * fault rather than a translation gap.
   */
  const fa = JSON.parse(read('src/i18n/locales/fa.json'));
  const flat = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]
    );
  const enKeys = flat(en);
  const faKeys = new Set(flat(fa));
  const faMissing = enKeys.filter((k) => !faKeys.has(k));
  t(`Persian covers at least 95% of keys (${enKeys.length - faMissing.length}/${enKeys.length})`,
    faMissing.length / enKeys.length < 0.05);

  /* --------------------- 6. no false "we take no fee" -------------------- */
  /*
   * REAL BUG: the swap screen said "This app takes no fee" directly above a
   * line reading "Platform fee 0.5%". Two contradictory claims on one screen,
   * about money, in the user's primary language.
   *
   * A user who catches the app being wrong about its own fee has no reason to
   * believe the irreversibility warnings either — and those are the ones that
   * protect them. This is also exactly the kind of contradiction an app-store
   * reviewer flags as misleading.
   *
   * The fee is the business model, so the copy is checked against it: if
   * FEE_BPS > 0, no string may claim otherwise. Scans every locale, because
   * the nine partial languages inherited the English text verbatim and a
   * stale copy is just as false.
   */
  {
    const feeSrc = read('src/lib/chains.js');
    const defMatch = /const FEE_BPS_DEFAULT = (\d+)/.exec(feeSrc);
    const chargesFee = defMatch ? Number(defMatch[1]) > 0 : true;

    /*
     * Must match a claim about OUR fee, not a description of someone else's.
     * "Zero-fee trading on many pairs" under p2p.desk.bybit is a fact about
     * Bybit and is fine; a broad /no fee/ pattern flagged it and would have
     * trained us to ignore this check.
     */
    const claim =
      /(this app|the app|we|fbt[a-z ]*)\s*(takes?|charges?|has)\s*no\s*fee|این اپ[^.]{0,40}هیچ کارمزدی نمی|ما[^.]{0,30}کارمزدی نمی‌گیریم/i;
    const offenders = [];

    for (const f of readdirSync('src/i18n/locales').filter((n) => n.endsWith('.json'))) {
      const data = JSON.parse(read(join('src/i18n/locales', f)));
      const scan = (obj, path = '') => {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') {
            if (claim.test(v)) offenders.push(`${f}:${path}${k}`);
          } else if (v && typeof v === 'object') scan(v, `${path}${k}.`);
        }
      };
      scan(data);
    }

    t(
      `no locale claims the app is fee-free while it charges${offenders.length ? ` — ${offenders.slice(0, 3).join(', ')}` : ''}`,
      !chargesFee || offenders.length === 0
    );
  }

  /* ------------- 7. order direction labels must not lie ------------------ */
  /*
   * REAL BUG: the direction toggle read "Buy when it drops / Sell when it
   * rises". Both were wrong. The rate is always "1 FROM = ? TO", so which side
   * is being sold is decided by which token sits in the FROM slot - not by the
   * direction. With from=BNB to=USDT you are selling BNB either way; the
   * direction only chooses the trigger condition.
   *
   * A label that names a trade the app is not making is the worst kind of
   * wrong on a money screen, so the words buy/sell are banned from these keys.
   */
  {
    const offenders = [];
    for (const f of readdirSync('src/i18n/locales').filter((n) => n.endsWith('.json'))) {
      const d = JSON.parse(read(join('src/i18n/locales', f)));
      const dir = d?.orders?.dir;
      if (!dir) continue;
      for (const [k, v] of Object.entries(dir)) {
        if (/\bbuy\b|\bsell\b|بخر|بفروش|اشتر|بِع/i.test(String(v))) offenders.push(`${f}:orders.dir.${k}`);
      }
    }
    t(
      `direction labels describe the condition, not a buy/sell${offenders.length ? ` — ${offenders.slice(0, 3).join(', ')}` : ''}`,
      offenders.length === 0
    );

    // The trigger label must name the FROM token, or "1 unit" is ambiguous.
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const when = en?.orders?.when ?? {};
    t(
      'the trigger label names both tokens',
      Object.values(when).every((v) => v.includes('{{from}}') && v.includes('{{to}}'))
    );
  }

  /* --------------------------- 8. release version ------------------------ */
  /*
   * Play rejects any upload whose versionCode is not strictly higher than the
   * last one, and the rejection happens AFTER the upload — so a stale number
   * costs a full build-and-upload cycle to discover.
   *
   * versionName is what users see; keeping it in step with package.json means
   * a bug report naming "1.2.0" maps to an exact commit.
   */
  {
    const pkg = JSON.parse(read('package.json'));
    const gradle = read('android/app/build.gradle');

    const code = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]);
    const name = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];

    t('android declares a versionCode', Number.isInteger(code) && code > 0);
    t(`versionName matches package.json (${name} / ${pkg.version})`, name === pkg.version);
    t('versionName is semver', /^\d+\.\d+\.\d+$/.test(String(name)));
    // v1.1.1 is already published, so anything at or below its code is a
    // guaranteed rejection.
    t(`versionCode is past the last release (${code} > 2)`, code > 2);
  }

  /* ------------------- 9. build-time env reaches the APK ------------------ */
  /*
   * REAL GAP: the code read 16 VITE_ variables; the workflow passed 3. Vite
   * inlines these at BUILD time, so a variable set in Vercel changes the
   * website while the APK keeps the compiled-in default.
   *
   * That is worse than a plain outage: setting VITE_FEE_BPS=70 would charge
   * 0.7% on the web and 0.5% in the app, and both look correct in isolation.
   * Nobody would notice until the revenue numbers disagreed.
   *
   * Checks the reference workflow in ci/, since the live one under
   * .github/workflows/ cannot be written by this toolchain.
   */
  {
    const wf = read('ci/WORKFLOW-FIXED.yml');

    // Variables the client genuinely reads.
    const used = new Set();
    for (const f of files) {
      for (const m of read(f).matchAll(/import\.meta\.env\??\.(VITE_\w+)/g)) used.add(m[1]);
    }

    /*
     * Not every variable belongs in CI. VITE_ENABLE_GAMES must stay unset so
     * the arcade is compiled out of store builds, and the Gemini keys are
     * dev-only overrides for a path the server owns in production.
     */
    const intentionallyUnset = new Set([
      'VITE_ENABLE_GAMES',
      'VITE_GEMINI_API_KEY',
      'VITE_GEMINI_MODEL',
      'VITE_FEE_ROUTER_ADDRESS'
    ]);

    const missing = [...used].filter((v) => !intentionallyUnset.has(v) && !wf.includes(`${v}:`));
    t(
      `every build-time env var reaches the APK${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`,
      missing.length === 0
    );

    // The fee is the business model; it must be settable without a code change.
    t('the fee can be configured per build', wf.includes('VITE_FEE_BPS:'));
    // Signing must still be wired, or the build silently produces a debug APK.
    t('all four signing secrets are still passed', (wf.match(/ANDROID_\w+:/g) || []).length >= 4);
  }

  /* ------------- 10. native app must not be gated by web APIs ------------- */
  /*
   * REAL BUG: fingerprint unlock and notifications both appeared unavailable
   * in the packaged Android app, for the same underlying reason — the code
   * gated on browser APIs a Capacitor WebView does not have:
   *
   *   biometrics : `window.PublicKeyCredential` is absent, and WebAuthn's
   *                rp.id would be "localhost" anyway, which Android refuses.
   *   push       : `window.Notification` is absent, so pushMode() returned
   *                'unsupported'; and pushConfigured() wants a VAPID key,
   *                which FCM does not use, so it fell back to 'local'.
   *
   * Either check alone silently disabled the feature. Both files must
   * therefore branch on the native platform BEFORE any web capability test.
   */
  {
    const sec = read('src/lib/security.js');
    const notif = read('src/lib/notify.js');

    t('security.js detects the native platform', /isNativePlatform/.test(sec));
    t('notify.js detects the native platform', /isNativePlatform/.test(notif));

    // The native branch must come before the secure-context / API checks,
    // otherwise it is unreachable on the very platform it exists for.
    const nativeIdx = sec.indexOf('if (isNative()) return true;');
    const secureIdx = sec.indexOf('if (!window.isSecureContext) return false;');
    t('biometrics checks native before secure-context', nativeIdx > 0 && nativeIdx < secureIdx);

    const pmNative = notif.indexOf('cachedPushMode = \'server\';');
    const pmUnsup = notif.indexOf("cachedPushMode = 'unsupported';");
    t('pushMode checks native before the web API test', pmNative > 0 && pmNative < pmUnsup);

    // A native build needs the plugins, or both paths throw at import.
    const pkg = JSON.parse(read('package.json'));
    const deps = { ...pkg.dependencies };
    t('native biometric plugin is a dependency', 'capacitor-native-biometric' in deps);
    t('native push plugin is a dependency', '@capacitor/push-notifications' in deps);
  }

  /* ------------- 11. every API the client calls must be routed ------------ */
  /*
   * THE MOST EXPENSIVE BUG CLASS IN THIS PROJECT — found six times now:
   * a handler is written, imported at the top of server/app.js, and then no
   * `app.get`/`app.post` line is ever added. The import makes it look wired.
   * Everything builds. The route answers {"error":"NOT_FOUND"}.
   *
   * Previously: push subscribe/unsubscribe, leaderboard, orders/watch.
   * Verified live on www.lawpoetics.ir this round:
   *   GET /api/search      → NOT_FOUND  (fetchSearch imported, never routed)
   *   GET /api/news        → NOT_FOUND  (fetchNews imported, never routed)
   *   GET /api/push/status → NOT_FOUND  (never written at all)
   *
   * What makes it so hard to notice is that the client hides it. api.js falls
   * back to public CoinGecko, news.js falls back to public RSS, and notify.js
   * treats a failed status call as "server push not available". So the app
   * degrades quietly instead of erroring — the user just gets a slower,
   * rate-limited, notification-less version and nobody sees a red log line.
   *
   * So: extract every `${API_BASE}/...` template in src/ and require a
   * matching route in server/app.js.
   */
  {
    const serverSrc = read('server/app.js');

    // Routes the server declares, as regexes so /nft/:chainId/:owner matches.
    const declared = [...serverSrc.matchAll(/app\.(get|post)\(\s*'\/api\/([^']*)'/g)].map(
      ([, method, p]) => ({
        method,
        re: new RegExp(`^${p.replace(/:[a-zA-Z]+/g, '[^/]+').replace(/\//g, '\\/')}$`)
      })
    );

    // Paths the client asks for. Strip the query string and any ${...} the
    // template interpolates — those are path params, matched by :param above.
    const called = new Set();
    for (const f of files) {
      for (const m of read(f).matchAll(/\$\{API_BASE\}\/([^`'"?]*)/g)) {
        const clean = m[1].replace(/\$\{[^}]*\}/g, 'X').replace(/\/+$/, '');
        if (clean) called.add(clean);
      }
    }

    const unrouted = [...called].filter((p) => !declared.some((d) => d.re.test(p)));
    t(
      `every /api path the client calls is routed${unrouted.length ? ` — unrouted: ${unrouted.join(', ')}` : ''}`,
      unrouted.length === 0
    );
    t(`a meaningful number of API paths were checked (${called.size})`, called.size >= 15);

    /*
     * And the mirror image: a handler imported but never mounted. This is the
     * shape the bug actually takes in the diff, so catching it here names the
     * cause rather than the symptom.
     */
    const handlerImports = [
      'fetchSearch',
      'fetchNews',
      'fetchGlobal',
      'fetchTrending',
      'fetchMarkets',
      'fetchChart',
      'fetchCoinDetail',
      'fetchSimplePrices',
      'fetchDexPools',
      'fetchNfts',
      'readLeaderboard',
      'submitScore',
      'addSubscription',
      'removeSubscription',
      'addFcmToken',
      'removeFcmToken',
      'putWatches',
      'clearWatches',
      'readWatches',
      'runWatchCycle'
    ];
    // Imported at the top AND referenced somewhere below the route section.
    const routeBody = serverSrc.slice(serverSrc.indexOf("app.get('/api/health'"));
    const dangling = handlerImports.filter(
      (h) => new RegExp(`\\b${h}\\b`).test(serverSrc) && !new RegExp(`\\b${h}\\b`).test(routeBody)
    );
    t(
      `no handler is imported without being used in a route${dangling.length ? ` — dangling: ${dangling.join(', ')}` : ''}`,
      dangling.length === 0
    );
  }

  /* ------------- 12. vercel.json must stay deployable on Hobby ----------- */
  /*
   * THE BUG THAT SILENTLY STOPPED EVERY DEPLOY FOR ~22 HOURS.
   *
   * A second cron was added for /api/cron/watch on a 15-minute schedule. The
   * Vercel Hobby plan allows at most 2 cron jobs AND at most one invocation
   * per day each, so 96/day is refused.
   *
   * What made it so expensive to find: the project still BUILDS. It just
   * never runs, and no failed deployment is recorded - the deploy list simply
   * stops growing. That is indistinguishable from a broken Git connection, so
   * the search went to the branch, the webhook and the daily quota in turn,
   * when the only thing that had changed was one line in one JSON file.
   *
   * A cron expression is a line of JSON that no test covered and no build
   * step validates. It is covered now.
   */
  {
    const vercel = JSON.parse(read('vercel.json'));
    const crons = vercel.crons ?? [];

    t(`at most 2 cron jobs on Hobby (found ${crons.length})`, crons.length <= 2);

    /*
     * Reject any schedule that fires more than once a day. The only shape
     * Hobby accepts is a fixed hour and minute. A step, list or range in
     * either field means it repeats, and repeating is what gets refused.
     */
    const tooOften = crons.filter((c) => {
      const [min, hour] = String(c.schedule ?? '').trim().split(/\s+/);
      const fixed = (f) => /^\d+$/.test(f ?? '');
      return !(fixed(min) && fixed(hour));
    });
    t(
      `every cron runs at most once a day${tooOften.length ? ` — offending: ${tooOften.map((c) => `${c.path} "${c.schedule}"`).join(', ')}` : ''}`,
      tooOften.length === 0
    );

    // A cron pointing at a non-existent route 404s once a day forever.
    const serverSrc = read('server/app.js');
    const deadCron = crons.filter((c) => !serverSrc.includes(`'${c.path}'`));
    t(
      `every cron path is a real route${deadCron.length ? ` — missing: ${deadCron.map((c) => c.path).join(', ')}` : ''}`,
      deadCron.length === 0
    );

    /*
     * Removing the 15-minute cron would silently delete order watching unless
     * the work moved somewhere that still runs. Assert it is still invoked so
     * the fix cannot degrade into a quiet feature removal.
     */
    t('the watch cycle still runs from the daily cron', /runWatchCycle\(\)/.test(serverSrc));
  }

  /* ---- 13. a setting that changes nothing is a lie to the user ---------- */
  /*
   * REAL BUG, and the sixth instance of this class.
   *
   * Settings had a "Biometric unlock" toggle. Flipping it really did read the
   * fingerprint and really did persist `biometricEnabled: true`. That was the
   * whole feature: the flag was read in exactly two places, both inside
   * Settings.jsx — once to prompt on flip, once to draw the switch. No lock
   * screen existed anywhere in the codebase.
   *
   * The user reported it precisely: "it reads the finger but the screen never
   * closes" (that prompt was for enabling, not unlocking) and "it never asks
   * me to log in" (nothing was built to ask). A switch wired to nothing.
   *
   * This is worse than a missing feature. The user believed the app was
   * locked, and behaved accordingly, while it was not — a security setting
   * that silently does nothing is an active hazard.
   *
   * So: every persisted security flag must be consumed OUTSIDE the screen
   * that sets it.
   */
  {
    const store = read('src/store/useSettingsStore.js');
    const settingsPage = read('src/pages/Settings.jsx');

    // Flags that must actually gate behaviour somewhere.
    const enforced = ['biometricEnabled'];

    const inert = [];
    for (const flag of enforced) {
      if (!store.includes(flag)) continue; // not a real setting, skip
      const readers = files.filter(
        (f) =>
          !f.includes('useSettingsStore') &&
          !f.includes('pages/Settings') &&
          new RegExp(`\\b${flag}\\b`).test(read(f))
      );
      if (readers.length === 0) inert.push(flag);
    }

    t(
      `every security setting is enforced outside Settings${inert.length ? ` — inert: ${inert.join(', ')}` : ''}`,
      inert.length === 0
    );

    // The lock must gate the app itself, not merely exist as a component.
    const app = read('src/App.jsx');
    t('App renders a lock gate', /AppLock/.test(app));

    /*
     * Order matters as much as presence: a lock rendered after onboarding or
     * the router would leave real content mounted underneath it.
     */
    const lockIdx = app.indexOf('screen = <AppLock');
    const welcomeIdx = app.indexOf('screen = <Welcome');
    t(
      'the lock is checked before any content screen',
      lockIdx > 0 && welcomeIdx > 0 && lockIdx < welcomeIdx
    );

    /*
     * A biometric-only lock permanently locks out anyone whose sensor breaks
     * or whose enrolled finger is removed, and reinstalling destroys the
     * encrypted vault. There must be a second door.
     */
    const lock = read('src/components/AppLock.jsx');
    t('the lock has a non-biometric fallback', /unlockVault/.test(lock));

    // Cancelling the OS prompt must not read as a successful unlock.
    t(
      'a failed biometric call does not unlock',
      /catch/.test(lock) && !/catch\s*\([^)]*\)\s*\{\s*onUnlock/.test(lock)
    );

    void settingsPage;
  }

  /* ---- 14. native capabilities must not be gated by web-only APIs ------- */
  /*
   * Instances SEVEN and EIGHT of the same class, both reported from a real
   * device on the same day:
   *
   *   notifications — Settings called notificationsSupported() directly, and
   *     that only tested `'Notification' in window`. A Capacitor WebView has
   *     no Notification API, so the row rendered "not available on this
   *     device" and never offered to ask. pushMode() had already been fixed to
   *     branch on native first, but the CALLER re-implemented the same gate
   *     one level above the fix — fixing a helper is not enough when a caller
   *     repeats its logic.
   *
   *   camera — scannerSupported() required `'BarcodeDetector' in window`,
   *     which Android's WebView does not ship, so the scanner reported
   *     UNSUPPORTED before ever calling getUserMedia. No permission dialog
   *     could appear. CAMERA was also absent from the manifest, so even
   *     reaching getUserMedia would have been refused: two independent causes
   *     of the same black screen.
   */
  {
    const notif = read('src/lib/notify.js');
    const scanner = read('src/components/QrScanner.jsx');
    const manifest = read('android/app/src/main/AndroidManifest.xml');

    // The capability probe itself must know about native, not just pushMode.
    const supFn = /notificationsSupported = \(\) => \{[\s\S]*?\n\};/.exec(notif)?.[0] ?? '';
    t('notificationsSupported() treats native as supported', /isNativeApp\(\)/.test(supFn));

    // A QR scanner that hard-requires BarcodeDetector cannot run in a WebView.
    const scanFn = /export function scannerSupported\(\)[\s\S]*?\n\}/.exec(scanner)?.[0] ?? '';
    t(
      'scannerSupported() does not hard-require BarcodeDetector',
      !/BarcodeDetector/.test(scanFn)
    );
    t('a decoder fallback exists for platforms without BarcodeDetector', /jsqr/i.test(scanner));

    // Declaring the permission is what makes the runtime prompt possible.
    t('CAMERA permission is declared', /uses-permission[^>]*permission\.CAMERA/.test(manifest));
    t(
      'POST_NOTIFICATIONS permission is declared',
      /uses-permission[^>]*POST_NOTIFICATIONS/.test(manifest)
    );

    /*
     * WalletConnect: without metadata.redirect the wallet has no route back,
     * so approval succeeds and the user is stranded in the wallet app.
     */
    const wallet = read('src/context/WalletContext.jsx');
    t('WalletConnect declares a redirect back to the app', /redirect:\s*\{/.test(wallet));
    const scheme = /<string name="custom_url_scheme">([^<]+)</.exec(
      read('android/app/src/main/res/values/strings.xml')
    )?.[1];
    t(
      `the WC redirect matches the manifest scheme (${scheme})`,
      Boolean(scheme) && wallet.includes(`${scheme}://`)
    );

    /*
     * The lock must never be able to strand its owner. A WalletConnect-only
     * user has no vault, so gating the fallback on hasVault() alone left them
     * with no way in at all if the sensor failed.
     */
    const lock = read('src/components/AppLock.jsx');
    t('the lock offers a fallback beyond the local vault', /verifyTotp/.test(lock));
    t('the lock explains itself when no fallback exists', /noFallback/.test(lock));
  }

  /* ---- 15. Auto Orders: revenue surface must stay honest and wired ------ */
  {
    const ordersLib = read('src/lib/orders.js');
    const ordersPage = read('src/pages/Orders.jsx');
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));

    // Every order type the engine accepts must be creatable and labelled, or
    // it is dead code the user can never reach.
    const types = ['limit', 'dca', 'trailing'];
    const unlabelled = types.filter((k) => !en.orders?.type?.[k] || !fa.orders?.type?.[k]);
    t(
      `every order type has a label in en+fa${unlabelled.length ? ` — missing: ${unlabelled.join(', ')}` : ''}`,
      unlabelled.length === 0
    );
    const uncreatable = types.filter((k) => !ordersPage.includes(`setSheet('${k}')`));
    t(
      `every order type can be created${uncreatable.length ? ` — no button: ${uncreatable.join(', ')}` : ''}`,
      uncreatable.length === 0
    );

    /*
     * The trailing peak is returned by a pure function, so SOMETHING must
     * persist it. Without this the peak resets every render and the stop can
     * never fire — the order would sit "active" forever while looking healthy.
     */
    t('the trailing peak is persisted by the page', /peakRate:\s*res\.peak/.test(ordersPage));

    // A stop that follows the price down protects nothing.
    t('the peak only ever rises', /Math\.max\(prevPeak, observed\)/.test(ordersLib));

    // Pause must be reachable, or deleting stays the only way to stop an alert.
    t('orders can be paused from the UI', /togglePause/.test(ordersPage));

    /*
     * Fee disclosure. The swap screen once claimed to be free while charging;
     * this screen schedules MULTIPLE charges, so it must not repeat that.
     */
    t('the order list discloses the platform fee', /orders\.feeNote/.test(ordersPage));
    t('the fee note names a real rate', /FEE_BPS/.test(ordersPage));

    /*
     * Trailing stops only run with the app open. Saying so is the difference
     * between a limitation and a false promise about someone's money.
     */
    t('the trailing scope limitation is stated', /trailScope/.test(ordersPage));

    // Unknown price must never render as a confident zero.
    t('notional returns null when unpriced', /return null;/.test(ordersLib));

    /*
     * WalletConnect metadata is FETCHED by the wallet. A dead URL is grounds
     * to reject the connection, so the fallback must not point at a
     * deployment that no longer exists.
     */
    const wallet = read('src/context/WalletContext.jsx');
    const fallback = /isLocal \? '(https:\/\/[^']+)'/.exec(wallet)?.[1];
    t(
      `the WC metadata fallback is not the dead vercel host (${fallback})`,
      Boolean(fallback) && !fallback.includes('fbtcryp.vercel.app')
    );
  }

  /* ---- 16. Ecosystem, external links, and PWA/wallet identity ----------- */
  {
    const eco = read('src/pages/Ecosystem.jsx');

    /*
     * REAL BUG: every card ran a `repeat: Infinity` pulse on a blurred 80px
     * halo. Blur is the most expensive filter to composite, and nine of them
     * animating forever kept the GPU busy the whole time the screen was open —
     * which is what "the page looks buggy" actually was.
     */
    /*
     * Strip comments before scanning. The first version of this check matched
     * the very comment explaining the fix, so it failed on correct code — a
     * test that flags prose teaches people to ignore it.
     */
    const stripComments = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const ecoCode = stripComments(eco);

    t('Ecosystem has no permanent animations', !/repeat:\s*Infinity/.test(ecoCode));

    /*
     * External links must go through lib/browser (Custom Tabs), which shows
     * the real domain. window.open inside the packaged app hides it, so the
     * user cannot tell a real site from a lookalike — in a wallet, that is a
     * phishing delivery mechanism, not a styling choice.
     */
    t('Ecosystem opens links through the safe helper', /openUrl/.test(ecoCode));
    t('Ecosystem does not call window.open directly', !/window\.open/.test(ecoCode));

    // A failed favicon must degrade to a monogram, never a broken-image glyph.
    t('Ecosystem tolerates a logo that fails to load', /onError/.test(eco));

    // Every listed item needs a name, or the tile renders its raw id.
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));
    const ids = [...eco.matchAll(/\{\s*id:\s*'([a-z0-9]+)',\s*url:/g)].map((m) => m[1]);
    const unnamed = ids.filter((id) => !en.eco?.item?.[id]?.name || !fa.eco?.item?.[id]?.name);
    t(
      `every ecosystem entry is named in en+fa (${ids.length} entries)${unnamed.length ? ` — missing: ${unnamed.join(', ')}` : ''}`,
      ids.length > 0 && unnamed.length === 0
    );

    // Only https, and no dead host may be shipped as a destination.
    const urls = [...eco.matchAll(/url:\s*'([^']+)'/g)].map((m) => m[1]);
    t('every ecosystem link is https', urls.every((u) => u.startsWith('https://')));

    /*
     * The web manifest was missing entirely: the site could not be installed,
     * and wallets reading a dapp manifest for the connection dialog got a 404
     * where the name and icon should be.
     */
    const html = read('index.html');
    t('the page links a web manifest', /rel="manifest"/.test(html));
    const manifest = JSON.parse(read('public/manifest.webmanifest'));
    t('the manifest names the app', manifest.name === 'FBT Swap');
    const iconPaths = (manifest.icons || []).map((i) => i.src.replace(/^\//, ''));
    const missingIcons = iconPaths.filter((p) => !existsSync(join('public', p)));
    t(
      `every manifest icon exists${missingIcons.length ? ` — missing: ${missingIcons.join(', ')}` : ''}`,
      iconPaths.length > 0 && missingIcons.length === 0
    );

    /*
     * WalletConnect FETCHES metadata.icons to draw the connection dialog, so a
     * 404 there is grounds to reject the request. The icon must be a real file.
     */
    const wallet = read('src/context/WalletContext.jsx');
    const wcIcon = /icons:\s*\[`\$\{publicUrl\}\/([^`]+)`\]/.exec(wallet)?.[1];
    t(
      `the WC metadata icon is a real file (${wcIcon})`,
      Boolean(wcIcon) && existsSync(join('public', wcIcon))
    );
  }

  /* ---- 17. diagnostics must be followable and complete ------------------ */
  /*
   * Both bugs came from one real /api/ai/diagnose response:
   *
   *   {"ok":true,"note":"Add ?Authorization: Bearer <CRON_SECRET> ...",
   *    "geminiKeyPresent":false,"openrouterKeyPresent":false,"enabled":true}
   *
   * 1. The note said `?Authorization:` — a leading `?` means a query string,
   *    but the code only read HTTP headers. The instruction was impossible to
   *    follow from a phone browser, which is the only place this URL is ever
   *    opened, so the live provider test was unreachable.
   *
   * 2. Groq was missing from the report. A correctly configured Groq setup
   *    therefore showed two `false`s beside `enabled:true`, which reads as
   *    "working, but nothing is configured" and sends you hunting a
   *    non-existent problem.
   *
   * A diagnostic that cannot be acted on is worse than none: it burns the time
   * of someone already debugging.
   */
  {
    const server = read('server/app.js');
    const block = /app\.get\('\/api\/ai\/diagnose'[\s\S]*?\n\}\);/.exec(server)?.[0] ?? '';

    /*
     * Scope this to the UNAUTHORIZED branch specifically. Scanning the whole
     * handler passed even with Groq deleted from the report, because
     * aiSelfTest() further down also mentions it — so the check looked green
     * while the exact bug was present. The public branch is the one a user
     * actually sees.
     */
    const publicBranchRaw =
      /if \(secret && provided !== secret\) \{[\s\S]*?\n  \}/.exec(block)?.[0] ?? '';
    /*
     * Strip comments first. The explanatory comment inside this very branch
     * names all three providers, so the check passed on prose even with the
     * Groq line deleted — the third time a check in this file has matched its
     * own documentation instead of the code it guards.
     */
    const publicBranch = publicBranchRaw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const reported = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'].filter((k) =>
      publicBranch.includes(k)
    );
    t(
      `the public diagnostic reports every AI provider (${reported.length}/3)`,
      reported.length === 3
    );

    /*
     * The stated way in must actually work. If the note advertises a query
     * parameter, the handler has to read one.
     */
    const advertisesQuery = /\?key=/.test(block);
    const readsQuery = /req\.query\.key/.test(block);
    t('the diagnostic instruction matches what the code reads', advertisesQuery === readsQuery);
    t('the diagnostic is reachable from a plain browser URL', readsQuery);
  }

  /* ---- 18. the lock must never be able to strand its owner -------------- */
  /*
   * REPORTED: "I went into settings, the app crashed, and it never worked
   * again."
   *
   * Enabling biometrics persists biometricEnabled:true, and AppLock mounts
   * before everything else on every launch. A user with no in-app vault and no
   * 2FA then had NO way past it once the sensor stopped recognising them - and
   * because the flag survives a restart, force-quitting did not help. The only
   * exit was reinstalling, which for anyone who DID have a vault destroys the
   * encrypted seed.
   *
   * A settings toggle must never be able to produce that.
   */
  {
    const lock = read('src/components/AppLock.jsx');
    t('the lock can be switched off from the lock screen', /disableBiometric\(\)/.test(lock));
    t('the escape hatch also lets the user in', /disableBiometric\(\)[\s\S]{0,120}onUnlock\(\)/.test(lock));
  }

  /* ---- 19. native must not pay for browser-only eye candy --------------- */
  /*
   * REPORTED: the app is very slow, and the More menu jitters.
   *
   * Three orbs at 60/55/48vw with blur(70px) drift forever behind EVERY
   * screen - RgbBackground sits above the router and never unmounts. That is
   * ~1M blurred pixels recomposited every frame for the whole session. On top
   * of it, .sheet-backdrop blurs the entire viewport, so opening any sheet
   * stacked a full-screen backdrop capture on those moving orbs. That is the
   * jitter: the menu's own animation was already stripped to opacity+y.
   *
   * A browser tab absorbs this. A Capacitor WebView composites through the
   * host app and shares a GPU with the native layer, which is why the APK felt
   * heavier than the site while running identical code.
   */
  {
    const css = read('src/index.css');
    const bg = read('src/components/RgbBackground.jsx');
    const store = read('src/store/useSettingsStore.js');

    t('the background field detects native', /isNativePlatform/.test(bg));
    t('native freezes the drifting orbs', /\.rgb-still \.rgb-orb[\s\S]{0,120}animation: none/.test(css));
    t('reduced motion also freezes them', /prefers-reduced-motion[\s\S]{0,200}\.rgb-orb[\s\S]{0,80}animation: none/.test(css));
    t('native drops the full-screen backdrop blur', /data-native='true'\] \.sheet-backdrop[\s\S]{0,90}backdrop-filter: none/.test(css));

    /*
     * The CSS above is keyed off a root attribute, so something must SET it.
     * A rule guarded by an attribute nobody writes is the dead-code failure
     * this project keeps repeating.
     */
    t('the native flag is actually applied to the document', /data-native/.test(store));
    t('the flag is set during boot', /applyNativeFlag\(\);/.test(store));
  }

  /* ---- 20. splash: right initial, working links ------------------------- */
  {
    const splash = read('src/pages/Splash.jsx');
    const code = splash.replace(/\/\*[\s\S]*?\*\//g, '');

    // The mark is an F for FBT. It used to draw a B.
    t('the splash mark is not the old B glyph', !/M9 9h5\.2a2\.4/.test(code));
    t('the splash draws an F stem and arms', /M9\.6 7\.2v9\.6/.test(code));

    // Social buttons must go somewhere real.
    t('the splash offers social links', /SOCIALS/.test(code));
    t('social links open through the safe helper', /openUrl/.test(code));
    /*
     * openUrl only accepts https, by design. mailto: would be silently
     * rejected and the button would look live while doing nothing.
     */
    t('mailto is handled rather than silently dropped', /mailto:/.test(code));
  }

  /* ---- 21. no fake money in the chrome; real wallet first --------------- */
  /*
   * The header showed `useAppStore.balance` - NX credits, the play money used
   * by the arcade and paper-trading screens - next to the brand on EVERY page.
   * So the first number a user saw on a non-custodial exchange was a fake
   * balance that looked like theirs. On a product whose whole promise is "you
   * hold your own keys", that is the most misleading pixel in the app.
   */
  {
    const header = read('src/components/Header.jsx');
    const code = header.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    t('the header shows no virtual balance', !/balance-chip/.test(code));
    t('the header does not read the play-money store', !/useAppStore/.test(code));

    /*
     * Order is a claim about what matters. The on-chain wallet used to sit
     * below the virtual balance, the allocation pie and the paper history.
     */
    const wallet = read('src/pages/Wallet.jsx');
    const onchainIdx = wallet.indexOf('on-chain wallet (non-custodial)');
    const allocIdx = wallet.indexOf('---------- allocation ----------');
    t(
      'the real wallet is rendered before the virtual allocation',
      onchainIdx > 0 && allocIdx > 0 && onchainIdx < allocIdx
    );
  }

  /* ---- 22. the ad banner must not animate forever on native ------------- */
  /*
   * AdBanner ran EIGHT `repeat: Infinity` animations plus a ninth CSS sweep,
   * and it renders on nine pages including Market, Swap and Wallet. Every one
   * of those screens carried nine permanent timers on top of the three blurred
   * background orbs - the most likely source of the intermittent freezing.
   *
   * `useStill()` already existed for precisely this and the banner never
   * called it: not a missing feature, an unused one.
   */
  {
    /*
     * Strip comments first. Three checks in this block initially matched the
     * comments EXPLAINING the fix rather than the code implementing it - the
     * fourth time that has happened in this file. A check that reads prose is
     * not a check.
     */
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const ad = strip(read('src/components/AdBanner.jsx'));
    const css = read('src/index.css');
    t('the ad banner respects reduced motion', /useStill/.test(ad));
    t('the ad banner freezes on native', /isNativePlatform/.test(ad));
    const infinite = (ad.match(/repeat: Infinity/g) || []).length;
    const gated = (ad.match(/still \? \{ duration: 0 \}/g) || []).length;
    t(`every looping banner animation is gated (${gated}/${infinite})`, infinite > 0 && gated >= infinite);
    t('the CSS sweep is frozen too', /\.ad-shine \{ animation: none/.test(css));
  }

  /* ---- 23. contact details and version must be real --------------------- */
  {
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const contact = strip(read('src/pages/Contact.jsx'));
    const settingsRaw = read('src/pages/Settings.jsx');
    const settings = strip(settingsRaw);

    // Telegram removed at the owner's request; email is the contact route.
    t('Telegram is no longer a contact route', !/t\.me\/Shiravi4333/.test(contact + settings));
    t('X is linked', /x\.com\/CompanyFbt/.test(contact));
    t('LinkedIn is linked', /linkedin\.com\/in\/mohammad-shiravi/.test(contact));

    /*
     * Tracking parameters stripped: the shared LinkedIn URL carried
     * utm_source/utm_content/utm_medium, which would tell LinkedIn every visit
     * came from an Android share sheet.
     */
    t('social links carry no utm tracking', !/utm_source|utm_medium/.test(contact));

    // A hardcoded version string nobody updates points bug reports at the
    // wrong build. It read v1.0.0 while the app shipped 1.5.x.
    t('the version is not hardcoded', !/v1\.0\.0/.test(settings));
    t('the version comes from the build', /__APP_VERSION__/.test(settings));
    /*
     * And it must be guarded: test harnesses bundle without our `define`, so a
     * bare __APP_VERSION__ threw at boot and crashed the entire app.
     */
    t('the version reference is guarded for other bundlers', /typeof __APP_VERSION__ !== 'undefined'/.test(settingsRaw));
  }

  return rows;
}
