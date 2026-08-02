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
    // Reads lib/feeBps.js, which is where the rate lives. It used to read
    // chains.js; when the constant moved, the regex silently stopped matching
    // and `chargesFee` fell back to its default — the check kept "passing"
    // without ever seeing the real number. So the match itself is asserted.
    const feeSrc = read('src/lib/feeBps.js');
    const defMatch = /const FEE_BPS_DEFAULT = (\d+)/.exec(feeSrc);
    t('the fee constant is where this check looks for it', defMatch !== null);
    const feeBps = defMatch ? Number(defMatch[1]) : 70;
    const chargesFee = feeBps > 0;

    /*
     * Must match a claim about OUR fee, not a description of someone else's.
     * "Zero-fee trading on many pairs" under p2p.desk.bybit is a fact about
     * Bybit and is fine; a broad /no fee/ pattern flagged it and would have
     * trained us to ignore this check.
     */
    const claim =
      /(this app|the app|we|fbt[a-z ]*)\s*(takes?|charges?|has)\s*no\s*fee|این اپ[^.]{0,40}هیچ کارمزدی نمی|ما[^.]{0,30}کارمزدی نمی‌گیریم/i;

    /*
     * A SCOPED denial is not the lie this check exists to catch.
     *
     * The bug was "this app takes no fee" printed directly above "Platform fee
     * 0.5%" — an unqualified claim contradicted on the same screen. But the
     * Buy screen genuinely takes nothing: we are not party to those
     * transactions at all, there is no deposit address, and saying so is the
     * honest answer to a question users otherwise assume has a hidden answer.
     *
     * A string qualifies as scoped only if it BOTH limits itself to this page
     * AND still points at where the real fee applies. That second half is what
     * keeps this from becoming a loophole: a bare "we take no fee here" would
     * still fail.
     */
    const scoped = (v) =>
      /on this page|here|این صفحه|اینجا/i.test(v) &&
      /swap|سواپ|0\.7|۰٫۷/i.test(v);

    const offenders = [];

    for (const f of readdirSync('src/i18n/locales').filter((n) => n.endsWith('.json'))) {
      const data = JSON.parse(read(join('src/i18n/locales', f)));
      const scan = (obj, path = '') => {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') {
            if (claim.test(v) && !scoped(v)) offenders.push(`${f}:${path}${k}`);
          } else if (v && typeof v === 'object') scan(v, `${path}${k}.`);
        }
      };
      scan(data);
    }

    t(
      `no locale claims the app is fee-free while it charges${offenders.length ? ` — ${offenders.slice(0, 3).join(', ')}` : ''}`,
      !chargesFee || offenders.length === 0
    );

    /*
     * REAL BUG, same class, found later: ten locale files spelled the fee out
     * as "0.5%" in prose — including the terms-of-service checkbox the user
     * has to tick — while the engine had moved to 0.70%. The check above only
     * caught "we take NO fee", so a wrong-but-nonzero number sailed through
     * for months.
     *
     * The rate must now be interpolated ({{fee}}), never typed. Any literal
     * percentage in a sentence about the platform fee is a defect, whatever
     * the number is: even a correct literal goes stale the next time the dial
     * moves. Slippage and trailing-stop copy legitimately mention percentages,
     * so this only looks at the keys that describe OUR fee.
     */
    const FEE_COPY_KEYS = [
      'swap.gasNote',
      'onboarding.terms.body',
      'onboarding.terms.agree',
      'terms.fees.body',
      'docs.swap.step3',
      'docs.why.step5',
      'notify.promo7.body'
    ];
    // Latin, Persian and Arabic-Indic digits, with either decimal separator.
    const LITERAL_PCT = /[\d۰-۹٠-٩]+\s?[.,٫]\s?[\d۰-۹٠-٩]+\s?[%٪]|[%٪]\s?[\d۰-۹٠-٩]+[.,٫][\d۰-۹٠-٩]+/;
    const hardCoded = [];
    for (const f of readdirSync('src/i18n/locales').filter((n) => n.endsWith('.json'))) {
      const d = JSON.parse(read(join('src/i18n/locales', f)));
      for (const key of FEE_COPY_KEYS) {
        const v = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), d);
        if (typeof v === 'string' && LITERAL_PCT.test(v)) hardCoded.push(`${f}:${key}`);
      }
    }
    t(
      `fee copy interpolates the rate instead of hard-coding it${hardCoded.length ? ` — ${hardCoded.slice(0, 3).join(', ')}` : ''}`,
      hardCoded.length === 0
    );

    /*
     * The placeholder is worthless if nothing fills it. i18next only
     * substitutes {{fee}} because it is registered as a default interpolation
     * variable at init — a user would otherwise read the literal text
     * "{{fee}}%" inside the terms they are agreeing to.
     */
    const i18nSrc = read('src/i18n/index.js');
    t('{{fee}} has a default interpolation value', /defaultVariables:\s*\{[^}]*fee/.test(i18nSrc));
    t('the fee variable follows the active language', /languageChanged'?,\s*syncFeeVariable/.test(i18nSrc));

    /*
     * The offline FAQ and the server's push copy bypass i18next entirely, so
     * they each need their own substitution. Both hard-coded 0.5% too.
     */
    t('the offline FAQ fills the fee placeholder', /fillFee\(/.test(read('src/lib/faqLocal.js')));
    t('server push copy derives the fee', /FEE_PCT/.test(read('server/promos.js')));
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
    /*
     * Matched on the assignment, not on `screen = <AppLock` as a single
     * literal: adding a prop pushed the JSX onto its own line and this check
     * silently stopped finding it. A brittle string match that reports success
     * because it matched nothing is worse than no check.
     */
    const lockIdx = app.search(/screen = \(?\s*<AppLock/);
    const welcomeIdx = app.search(/screen = \(?\s*<Welcome/);
    t('the lock gate assignment was found', lockIdx > 0);
    t('the welcome screen assignment was found', welcomeIdx > 0);
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

    /*
     * INSTANCE NINE, and the worst of the family — it did not merely disable a
     * feature, it CRASHED the app.
     *
     * Making notificationsSupported() return true on native was right, but it
     * turned three call sites that read the bare global `Notification.*` into
     * live grenades: a Capacitor WebView has no such global, so they threw
     * `ReferenceError: Notification is not defined`. Settings calls
     * notificationPermission() in a useState initialiser — during render — so
     * the whole tree unmounted into the BootBoundary the moment the user
     * opened Settings, on the APK only.
     *
     * Every read of the global must sit behind an existence check. Note this
     * is a static check and therefore weak by nature: it can only see the
     * shape of the code. test/native-notify-probe.mjs is the real guard — it
     * deletes the global and CALLS these functions.
     */
    const bareReads = [];
    for (const m of notif.matchAll(/^(?!\s*[/*]).*\bNotification\.(permission|requestPermission)\b.*$/gm)) {
      bareReads.push(m[0].trim().slice(0, 60));
    }
    // Each surviving read must be preceded by the guard within its function.
    const guarded = notif.split(/\n(?=export (?:async )?function|export const)/).every((fn) => {
      if (!/\bNotification\.(permission|requestPermission)\b/.test(fn)) return true;
      return /webNotificationApi\(\)/.test(fn);
    });
    t(
      `every bare Notification.* read is guarded by an existence check${bareReads.length && !guarded ? ` — ${bareReads[0]}` : ''}`,
      guarded
    );
    t(
      'the guard uses typeof, not a window lookup that still names the global',
      /typeof Notification !== 'undefined'/.test(notif)
    );

    /*
     * The other half of the report was "دیگه درست نمیشه" — it never gets
     * better. With HashRouter, a crash leaves the URL on the route that threw,
     * so location.reload() re-enters it and the error screen recurs forever.
     * Recovery has to clear the hash first.
     */
    const boundary = read('src/main.jsx');
    t(
      'the crash screen escapes the route that crashed before reloading',
      /location\.hash\s*=/.test(boundary) && /location\.reload\(\)/.test(boundary)
    );

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
    const allocIdx = wallet.search(/-+ allocation/);
    t('both wallet sections were found', onchainIdx > 0 && allocIdx > 0);
    t(
      'the real wallet is rendered before the virtual allocation',
      onchainIdx > 0 && allocIdx > 0 && onchainIdx < allocIdx
    );

    /*
     * Stronger than ordering, and what the owner actually asked for: the play
     * money is no longer on the same tab as the real wallet at all. Users were
     * confusing the two, which on a non-custodial exchange is expensive.
     *
     * Asserted structurally — the virtual sections must be gated on the
     * practice tab, and the real wallet must not be.
     */
    t('there is a dedicated practice tab', /'practice'/.test(wallet));
    t(
      'the virtual allocation is gated behind the practice tab',
      /tab === 'practice' && <>/.test(wallet)
    );
    t(
      'the real wallet is hidden on the practice tab',
      /tab !== 'practice' && \(/.test(wallet)
    );
    // The tab strip must actually offer it, or the section is unreachable.
    t(
      'the practice tab is reachable from the tab strip',
      /\['overview', 'liquidity', 'practice'\]/.test(wallet)
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

  /* ---- 24. the currency selector must actually change prices ------------ */
  /*
   * REAL BUG, same class as the biometric toggle: Settings offered
   * USD/EUR/IRT/AED, wrote `currency` to the store, and NOTHING read it. Every
   * price went through fmtUsd, which hardcoded a `$`. A user who picked EUR
   * read dollar signs over dollar numbers - told their portfolio was worth
   * something it was not.
   *
   * IRT is gone because no feed we use quotes Iranian rial, so it could only
   * ever have been a rial label over a USD figure.
   */
  {
    /*
     * Strip comments. Checks in this file have now matched their own
     * explanatory prose FIVE times; the comments here legitimately mention
     * 'IRT' while explaining why it was removed.
     */
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const cur = strip(read('src/lib/currency.js'));
    const fmt = read('src/lib/format.js');
    const store = read('src/store/useSettingsStore.js');
    const hook = read('src/hooks/useMarket.js');
    const settings = strip(read('src/pages/Settings.jsx'));

    t('IRT is no longer offered', !/'IRT'/.test(settings) && !/'IRT'/.test(cur));
    /*
     * Assert the actual template, not just that the word appears somewhere -
     * renaming the variable left the check green while the `$` was back.
     */
    t(
      'fmtUsd uses the active symbol, not a hardcoded $',
      /return `\$\{activeSymbol\}\$\{fmtPrice/.test(fmt)
    );
    t('there is a setter for the display symbol', /export function setDisplaySymbol/.test(fmt));
    t('the store applies the chosen currency', /applyCurrency/.test(store));
    t('the currency is re-applied when it changes', /subscribe\(\(st\) => applyCurrency/.test(store));

    /*
     * Symbol alone is a lie - EUR beside a dollar number. The feed must be
     * asked for the currency so the FIGURE converts too.
     */
    t('market data is fetched in the display currency', /vsOf\(/.test(hook));

    // A legacy stored value must not render `undefined` beside every price.
    t('unknown/legacy codes fall back rather than breaking', /\?\? DEFAULT/.test(cur));
  }

  /* ---- 25. contact + legal --------------------------------------------- */
  {
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));

    // The old address and the Telegram handle must be gone everywhere.
    const allLocales = readdirSync('src/i18n/locales')
      .filter((f) => f.endsWith('.json'))
      .map((f) => read(join('src/i18n/locales', f)))
      .join('\n');
    t('the old email is gone from every locale', !/Mshiravi433/.test(allLocales));
    t('the Telegram handle is gone from every locale', !/Shiravi4333/.test(allLocales));
    t('the new email is present', /fbtswap@gmail\.com/.test(allLocales));

    /*
     * The security warning told users to report issues on Telegram. That is
     * now wrong AND unreachable - it must name email.
     */
    t('the security bounty points at email', /fbtswap@gmail\.com/.test(en.audit?.bounty ?? ''));
    t('the scam warning names email as the only channel', /email/i.test(en.contact?.scamWarning ?? ''));

    // The disclaimer must exist in both languages and be reachable.
    for (const [lang, d] of [['en', en], ['fa', fa]]) {
      t(`${lang} has a legal disclaimer`, Boolean(d.disclaimer?.title && d.disclaimer?.ip));
    }
    const legal = read('src/pages/Legal.jsx');
    t('the disclaimer route is handled', /disclaimer/.test(legal));
    t('the disclaimer is linked from Settings', /legal\/disclaimer/.test(strip(read('src/pages/Settings.jsx'))));
    t('the disclaimer is linked from Docs', /legal\/disclaimer/.test(strip(read('src/pages/Docs.jsx'))));

    // A public repo with no LICENSE reads as "free to take".
    t('a LICENSE file exists', existsSync('LICENSE'));
    const lic = existsSync('LICENSE') ? read('LICENSE') : '';
    t('the licence reserves rights', /ALL RIGHTS RESERVED/i.test(lic));
    t('the licence forbids removing the fee', /fee recipient/i.test(lic));
  }

  /* ---- 26. token icons must always render something --------------------- */
  /*
   * REAL BUG: the picker rendered `tk.logoURI` or the first three letters of
   * the symbol. Not ONE of the ~46 built-in tokens in lib/chains.js has a
   * logoURI - that field only exists on user-imported tokens. And when an
   * imported token's image 404'd, onError set display:none, leaving an empty
   * circle, which reads as broken rather than as a placeholder.
   */
  {
    const icon = read('src/lib/tokenIcon.jsx');
    const swap = read('src/pages/Swap.jsx');
    const chains = read('src/lib/chains.js');

    t('a token icon resolver exists', /export default function TokenIcon/.test(icon));
    t('the swap picker uses it', /<TokenIcon/.test(swap));
    t('the old display:none error handler is gone', !/currentTarget\.style\.display = 'none'/.test(swap));
    t('there is a monogram fallback that always renders', /tok-icon-text/.test(icon));

    /*
     * Icons resolve by CONTRACT ADDRESS, never by symbol. Symbols are not
     * unique and are trivially spoofed - a scam token can call itself USDT,
     * but it cannot occupy Tether's address. Symbol-keyed lookup would hand a
     * fake token the real one's logo, which is the most effective way to make
     * a phishing token look legitimate.
     */
    t('icons are keyed by address, not symbol', /assets\/\$\{token\.address\}/.test(icon));
    t('only https icon sources are accepted', /startsWith\('https:\/\/'\)/.test(icon));

    // Confirms the premise: if built-in tokens ever gain logos, this check
    // stops being meaningful and should be revisited rather than left green.
    t('built-in tokens still carry no logoURI (resolver is required)', !/logoURI/.test(chains));
  }

  /* ---- 27. SEO: the site must be indexable and shareable ---------------- */
  /*
   * The page had a bare <title>FBT Swap</title>, a Persian-only description,
   * and no Open Graph tags at all. Three costs: nothing for a search engine
   * to rank on, every shared link rendering as a bare URL with no image, and
   * listing sites (DappRadar, DefiLlama) having nothing to scrape.
   */
  {
    const html = read('index.html');

    t('the title carries keywords, not just the brand', /<title>[^<]*(DEX|Swap)[^<]*(DEX|Swap|Chains)/i.test(html));
    t('there is a canonical URL', /rel="canonical"/.test(html));
    t('crawlers are told to index', /name="robots"/.test(html));

    // Shared links must preview. This is the largest avoidable loss of
    // click-through for a link people pass around in chat.
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:url']) {
      t(`${tag} is present`, html.includes(tag));
    }
    t('a Twitter/X card is declared', /twitter:card/.test(html));

    // Structured data is what turns us from an untyped page into a
    // recognised application in a directory or a rich result.
    t('structured data is present', /application\/ld\+json/.test(html));
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    let ldOk = false;
    try {
      const parsed = JSON.parse(ld);
      ldOk = parsed['@type'] === 'SoftwareApplication' && Boolean(parsed.name);
    } catch {
      ldOk = false;
    }
    t('the structured data is valid JSON-LD', ldOk);

    // A missing robots.txt means crawlers hit /api/ and burn our upstream quota.
    t('robots.txt exists', existsSync('public/robots.txt'));
    const robots = existsSync('public/robots.txt') ? read('public/robots.txt') : '';
    t('robots keeps crawlers out of the API', /Disallow: \/api\//.test(robots));
    t('robots points at the sitemap', /Sitemap:/.test(robots));

    t('sitemap.xml exists', existsSync('public/sitemap.xml'));
    const sm = existsSync('public/sitemap.xml') ? read('public/sitemap.xml') : '';
    // The namespace is sitemaps.org (plural). I got this wrong first time and
    // a wrong namespace makes the file silently invalid to every crawler.
    t('the sitemap namespace is correct', /www\.sitemaps\.org\/schemas\/sitemap/.test(sm));

    // Every absolute URL in the SEO block must point at the live domain.
    const badHost = /https:\/\/(fbtcryp\.vercel\.app|localhost)/.test(html);
    t('SEO URLs point at the live domain', !badHost);

    /*
     * Google re-checks the verification tag periodically and SILENTLY DROPS
     * the property if it vanishes - taking the sitemap submission and all
     * indexing history with it. A tag this easy to delete during an unrelated
     * <head> edit needs a test holding it in place.
     *
     * Also assert it is not the placeholder: Google records a wrong token as a
     * failed verification, which is harder to diagnose than a missing tag
     * because the console cannot tell you which one it is.
     */
    const gsv = /<meta name="google-site-verification" content="([^"]*)"/.exec(html)?.[1];
    t('the Search Console verification tag is present', Boolean(gsv));
    t('the verification token is real, not a placeholder', Boolean(gsv) && !/PASTE|TODO|XXX/i.test(gsv) && gsv.length > 20);
  }

  /* ---- 28. the PWA must be installable on desktop, not just phones ------ */
  /*
   * The manifest had orientation:"portrait", which locks a DESKTOP window to a
   * phone shape - the app installs on Windows/macOS/ChromeOS and then refuses
   * to resize sensibly. Since Apple bars Iranian developers from the App Store
   * entirely and blocks the App Store inside Iran, the installable web app is
   * the ONLY route to iPhone and desktop users, so it has to be right.
   */
  {
    const m = JSON.parse(read('public/manifest.webmanifest'));
    const css = read('src/index.css');

    t('the manifest does not lock orientation', m.orientation !== 'portrait');
    t('the manifest declares an id', Boolean(m.id));
    t('the manifest is installable (standalone)', m.display === 'standalone');
    t('desktop window controls are supported', Array.isArray(m.display_override) && m.display_override.includes('window-controls-overlay'));
    t('the manifest offers shortcuts', Array.isArray(m.shortcuts) && m.shortcuts.length >= 2);

    /*
     * Every shortcut URL must be a route the app can actually open. A
     * shortcut to a dead path is a menu item that lands on the catch-all -
     * the same dead-control failure this project keeps repeating.
     */
    const appSrc = read('src/App.jsx');
    const badShortcut = (m.shortcuts || []).filter((sc) => {
      const path = String(sc.url || '').replace(/^\/#/, '') || '/';
      return path !== '/' && !appSrc.includes(`path="${path}"`);
    });
    t(
      `every shortcut points at a real route${badShortcut.length ? ` — broken: ${badShortcut.map((x) => x.url).join(', ')}` : ''}`,
      badShortcut.length === 0
    );

    /*
     * The shell caps at 520px, which is a narrow strip on a monitor. Widen it
     * on desktop - but the fixed bottom nav must be widened too, or it spans
     * the whole viewport while the content is centred.
     */
    t('there is a desktop breakpoint', /@media \(min-width: 900px\)/.test(css));
    const desktopBlock = /@media \(min-width: 900px\) \{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    t('desktop widens the app shell', /\.app-shell[\s\S]{0,80}max-width/.test(desktopBlock));
    t('the fixed bottom nav is widened with it', /\.bottom-nav/.test(desktopBlock));
  }

  /* ---- 15. the lockfile must stay installable --------------------------- */
  /*
   * REAL BUG, and entirely self-inflicted: bumping the app version with
   *
   *     sed -i 's/"version": "1.7.0"/"version": "1.7.1"/' package-lock.json
   *
   * also rewrote two DEPENDENCY versions that happened to be 1.7.0 —
   * @scure/bip32 and a nested @noble/hashes. Their declared version no longer
   * matched the tarball in `resolved`, so `npm ci` aborted with
   *
   *     lock file's @noble/hashes@1.7.1 does not satisfy @noble/hashes@1.7.0
   *
   * and the APK build died 36 seconds in, before Gradle. Both are the crypto
   * libraries used for wallet key derivation, so a version that silently
   * disagrees with its own tarball is worse than a broken build.
   *
   * Nothing caught it: `npm test` uses the already-installed node_modules and
   * never validates the lockfile, so the whole suite stayed green while the
   * project was uninstallable from scratch.
   *
   * The invariant: inside `packages`, only the root entry ("") may carry the
   * application's own version. Every other entry describes a dependency, and
   * its version must agree with the filename in `resolved`.
   */
  {
    const lock = JSON.parse(read('package-lock.json'));
    const pkg = JSON.parse(read('package.json'));

    t(
      `the lockfile records the app version (${lock.version} vs package.json ${pkg.version})`,
      lock.version === pkg.version && lock.packages?.['']?.version === pkg.version
    );

    /*
     * `resolved` ends in <name>-<version>.tgz. When the two disagree, npm ci
     * refuses to install — which is exactly the failure above, detected here
     * without needing a network or an install.
     */
    const mismatched = [];
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
      if (!key || !entry?.version || !entry?.resolved) continue;
      const tarball = String(entry.resolved).split('/').pop() ?? '';
      if (!tarball.endsWith('.tgz')) continue;
      /*
       * Derive the expected filename from the package NAME rather than trying
       * to parse the version out of the filename.
       *
       * The first version of this check searched for a trailing -<digits...>
       * and mis-parsed every package whose own name contains a number:
       * `utf-8-validate-5.0.10.tgz` yielded "8-validate-5.0.10" and was
       * reported as corrupt. A guard that cries wolf on healthy input is worse
       * than no guard, because the next real corruption gets waved through.
       *
       * The package name is the last path segment of the key, so the
       * filename must be exactly `<name>-<version>.tgz`.
       */
      const pkgName = key.split('node_modules/').pop() ?? '';
      const short = pkgName.includes('/') ? pkgName.split('/').pop() : pkgName;
      const expected = `${short}-${entry.version}.tgz`;
      if (tarball !== expected) {
        mismatched.push(`${key}: expected ${expected}, resolved ${tarball}`);
      }
    }
    t(
      `every locked dependency matches its own tarball${mismatched.length ? ` — ${mismatched.slice(0, 2).join('; ')}` : ''}`,
      mismatched.length === 0
    );
  }

  /* ---- 16. the developer page must not advertise dead endpoints ---------- */
  /*
   * REAL BUG: the Developers page listed `POST /api/ai/faq`, which had been
   * removed from the server along with the Help chat box. A published endpoint
   * that 404s sends integrators to file a bug against us for our own stale
   * documentation — avoidable inbound, which is precisely what the owner asked
   * this page not to generate.
   *
   * Every path advertised there must have a matching route. Express params are
   * normalised, so a documented `/api/dex/bsc` is satisfied by a registered
   * `/api/dex/:network`.
   */
  {
    const dev = read('src/pages/Developers.jsx');
    const server = read('server/app.js');

    // Collect the registered routes once: app.get('/x'), app.post('/y').
    const toMatcher = (routePath) => {
      // Escape regex metacharacters FIRST, then turn :params into a wildcard.
      // Doing it the other way round escaped the wildcard we had just written.
      const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`^${escaped.replace(/:[A-Za-z_]+/g, '[^/]+')}$`);
    };
    const registered = [...server.matchAll(/app\.(get|post)\('([^']+)'/g)].map(([, m, p]) => ({
      method: m.toUpperCase(),
      re: toMatcher(p)
    }));

    const advertised = [...dev.matchAll(/\{ m: '(GET|POST)', p: '([^']+)'/g)];
    t('the developer page lists at least one endpoint', advertised.length > 0);

    const dead = [];
    for (const [, method, raw] of advertised) {
      const path = raw.split('?')[0];
      if (!registered.some((r) => r.method === method && r.re.test(path))) {
        dead.push(`${method} ${path}`);
      }
    }
    t(
      `every advertised endpoint exists on the server${dead.length ? ` — ${dead.join(', ')}` : ''}`,
      dead.length === 0
    );

    /*
     * The AI routes spend shared upstream quota, unlike the cached market
     * routes. They must not sit on the same generous budget, or the example
     * printed on this very page can be looped into an outage for everyone.
     */
    t('AI endpoints have their own rate limit', /app\.use\('\/api\/ai'/.test(server));
    t('the AI budget is tighter than the general one', /AI_RATE_LIMIT/.test(server));
    t(
      'reading AI status is never throttled',
      /req\.method === 'GET'\) return next\(\)/.test(server)
    );
  }

  /* ---- 17. Solana: receive-only, and the UI must say so ----------------- */
  /*
   * The Settings screen offers a "Solana cluster" selector and a Solana RPC
   * field, and its subtitle read "For Solana features". There are no Solana
   * features: the swap engine is EVM-only (getQuote takes a numeric chainId
   * and indexes EVM_CHAINS), there is no @solana/web3.js or Jupiter client in
   * package.json, and nothing outside Settings.jsx reads solanaCluster or
   * solanaRpc at all.
   *
   * Solana IS real for one thing — it is a payout family with a configured
   * receiving address, so a user can send SOL to the operator. That is worth
   * keeping. Advertising it as a swap network is not: a user who selects a
   * cluster and then looks for Solana in the swap screen has been told
   * something untrue about where their money can go.
   *
   * This check fails if a Solana swap is ever claimed without the code to back
   * it, or if a real Solana engine is added and the copy is not updated.
   */
  {
    const pkg = JSON.parse(read('package.json'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const hasSolanaEngine = Object.keys(deps).some((d) => /@solana\/|@jup-ag\//.test(d));

    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const sub = String(en?.settings?.solanaSub ?? '');

    if (!hasSolanaEngine) {
      // No engine: the copy must not promise swaps, and must say what it IS for.
      t(
        `the Solana setting does not promise features that do not exist — "${sub}"`,
        !/for solana features/i.test(sub)
      );
      t(
        'the Solana setting states swaps are EVM-only',
        /evm-only|evm only/i.test(sub)
      );
      // And the swap engine really must still be EVM-only, or the copy is now
      // the thing that is wrong.
      const swap = read('src/lib/swap.js');
      t('the swap engine is still EVM-only', !/@solana\//.test(swap));
    } else {
      // An engine exists: the copy must no longer say EVM-only.
      t('Solana copy was updated when the engine landed', !/evm-only|evm only/i.test(sub));
    }

    /*
     * Whatever the swap story, the payout address must be present and belong
     * to the Solana family — this is where real revenue lands.
     */
    const payout = read('src/lib/payout.js');
    t('a Solana payout address is configured', /solana: env\('VITE_PAYOUT_SOLANA'\) \|\| '[1-9A-HJ-NP-Za-km-z]{32,44}'/.test(payout));
  }

  /* ---- 18. the two wallet connections must stay independent -------------- */
  /*
   * Asked directly: "how do I disconnect the main wallet before connecting
   * Solana — you can't have two connected at once."
   *
   * You can, and that is load-bearing. MetaMask/Trust inject
   * `window.ethereum`; Phantom/Solflare inject `window.phantom.solana`.
   * Different objects, different namespaces, no shared state.
   *
   * If either side ever reached into the other's namespace, connecting one
   * could silently clobber the other — and the user would discover it by
   * signing a transaction with the wrong wallet. So the separation is
   * asserted rather than trusted:
   *
   *   - the Solana wallet module must never touch window.ethereum
   *   - the EVM context must never touch window.solana / window.phantom
   *   - the Solana screen may READ the EVM address (it shows both states side
   *     by side) but must not mutate it
   */
  {
    const solWallet = read('src/lib/solanaWallet.js');
    const evmCtx = read('src/context/WalletContext.jsx');
    const solPage = read('src/pages/SolanaSwap.jsx');

    const strip = (src) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    t(
      'the Solana wallet never touches window.ethereum',
      !/window\.ethereum/.test(strip(solWallet))
    );
    t(
      'the EVM context never touches the Solana namespace',
      !/window\.(solana|phantom)/.test(strip(evmCtx))
    );

    /*
     * The screen shows both connection states so the answer is visible rather
     * than merely written down. It must read the EVM side, and only read it.
     */
    const page = strip(solPage);
    t('the Solana screen surfaces the EVM connection state', /useWallet\(\)/.test(page));
    t(
      'the Solana screen does not mutate the EVM wallet',
      !/evm\.(connect|disconnect|switchChain|lock)\s*\(/.test(page)
    );

    // And the copy must actually say they coexist, or the panel is decoration.
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const body = String(en?.solana?.twoWalletsBody ?? '');
    t('the copy states both can be connected at once', /same time|both/i.test(body));
    t('the copy exists in Persian too',
      String(JSON.parse(read('src/i18n/locales/fa.json'))?.solana?.twoWalletsBody ?? '').length > 40);
  }

  /* ---- 19. the mobile check must exist in the source, not just the test -- */
  /*
   * The unit test for this mirrors canInjectSolana()'s logic, because the
   * module reads a global `window` the suite cannot swap per-case. A mirror
   * can drift: the test would keep passing against its own copy while the real
   * function regressed to the version that sent every mobile browser into a
   * dead end.
   *
   * So the source is checked for the two things that matter.
   */
  {
    const src = read('src/lib/solanaWallet.js');
    const fn = /export const canInjectSolana = \(\) => \{[\s\S]*?\n\};/.exec(src)?.[0] ?? '';
    t('canInjectSolana was found in the source', fn.length > 0);
    t('it still excludes the packaged app', /isNativeShell\(\)/.test(fn));
    t(
      'it also excludes mobile browsers, where extensions cannot exist',
      /iPhone|Android/.test(fn) && /userAgent/.test(fn)
    );

    /*
     * And the operator-only warning must not creep back into the screen. It
     * rendered in red for every customer while a comment claimed it was "only
     * shown to us".
     */
    const page = read('src/pages/SolanaSwap.jsx');
    const code = page
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    t('the fee-not-configured warning is not rendered', !/feeNotConfigured/.test(code));
    t('the screen does not show our revenue split', !/netFeeBps/.test(code));
  }

  /* ---- 20. no setting may be wired to nothing ---------------------------- */
  /*
   * THE MOST-REPEATED BUG IN THIS PROJECT, now checked instead of rediscovered.
   *
   * Found dead so far: the currency selector, the biometric toggle, auto-lock,
   * hide-balances, default slippage, custom RPC, expert mode, testnet mode and
   * "confirm every transaction". Each stored a value, redrew its own label
   * from it, and was read by nothing else — so the control looked alive and
   * changed nothing.
   *
   * Two of those were dangerous rather than merely useless: testnet mode told
   * users their funds were not real while every swap stayed on mainnet, and
   * default slippage let someone believe they had capped their loss at 0.1%
   * while 0.5% was sent.
   *
   * The invariant: a persisted preference must be consumed somewhere OUTSIDE
   * the screen that sets it. Reading it back only to render your own switch
   * proves nothing.
   */
  {
    const store = read('src/store/useSettingsStore.js');
    const settingsPage = read('src/pages/Settings.jsx');

    const strip = (src) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    /*
     * Consumers = every source file except the store itself and the Settings
     * screen. Comments are stripped first: this suite has repeatedly "passed"
     * by matching its own explanatory prose.
     */
    const consumers = walk('src')
      .filter((f) => !f.endsWith('useSettingsStore.js') && !f.endsWith('Settings.jsx'))
      .map((f) => strip(read(f)))
      .join('\n');

    /*
     * Preferences that must do something. Deliberately not every key in the
     * store — onboarding flags and sync bookkeeping are consumed by the store
     * itself, which is legitimate.
     */
    const mustBeUsed = [
      'theme',
      'accent',
      'reduceMotion',
      'compactMode',
      'currency',
      'hideBalances',
      'biometricEnabled',
      'autoLockMinutes',
      'defaultSlippage',
      'expertMode',
      'customEvmRpc'
    ];

    /*
     * A preference counts as live if EITHER some other file reads it, OR the
     * store pushes it into the DOM itself through an apply*() call.
     *
     * theme, accent and compactMode are the second kind: nothing imports them,
     * because `applyTheme()` writes a data attribute and CSS does the rest.
     * Flagging those would be a false positive, and a check that cries wolf on
     * working code gets ignored the next time it is right.
     */
    const storeCode = strip(store);
    const css = read('src/index.css');

    /*
     * Matching on an apply*() NAME was too brittle — compactMode is applied by
     * applyCompact(), not applyCompactMode(), so the rule reported a live
     * setting as dead. Follow the data attribute instead: the store writes
     * `data-<x>` and CSS must actually select on it. That proves the setting
     * reaches the screen rather than proving a function exists.
     */
    const appliedInStore = (key) => {
      const attrs = [...storeCode.matchAll(/setAttribute\('(data-[a-z-]+)'/g)].map((m) => m[1]);
      const lower = key.toLowerCase();
      return attrs.some(
        (attr) => lower.startsWith(attr.replace('data-', '')) && css.includes(`[${attr}=`)
      );
    };

    const dead = mustBeUsed.filter((key) => {
      if (!new RegExp(`\\b${key}\\b`).test(store)) return false; // not a setting at all
      if (appliedInStore(key)) return false;
      return !new RegExp(`\\b${key}\\b`).test(consumers);
    });

    t(
      `every stored preference is read somewhere outside Settings${dead.length ? ` — dead: ${dead.join(', ')}` : ''}`,
      dead.length === 0
    );

    /*
     * testnetMode specifically must not come back as a switch. Its copy told
     * users their money was not real. If it is ever rebuilt it needs actual
     * testnet RPCs and routers, not a boolean.
     */
    t(
      'the testnet switch is not rendered',
      !/settings\.testnet['"]/.test(strip(settingsPage))
    );

    // And expert mode must reach the swap flow, not just exist.
    t(
      'expert mode is consulted before the review step',
      /expertMode/.test(strip(read('src/pages/Swap.jsx')))
    );
  }

  /* ---- 21. no stale Telegram claims in wallet safety copy ---------------- */
  /*
   * REAL BUG, reported: the in-app wallet's risk warning said the key is kept
   * "inside the Telegram WebView". This app is a website and an Android APK.
   * It is not a Telegram Mini App, and the Telegram support channel was
   * removed earlier for the same reason.
   *
   * That matters more than a stale brand name. A user reading a security
   * warning about a product they are not using has been given a reason to
   * distrust the whole warning — and this particular one is the difference
   * between keeping $50 and keeping $50,000 in a browser-stored key.
   *
   * The same wrong claim was in `noProvider` ("Telegram's browser has no
   * injected wallet") and `backupWarning` ("not us, not Telegram"). All three
   * were rewritten for en/fa/ar and DELETED from the nine partial languages,
   * so those fall back to corrected English rather than keeping a wrong
   * statement in their own language. Safety copy is never machine-translated
   * here.
   */
  {
    const offenders = [];
    for (const f of readdirSync('src/i18n/locales').filter((n) => n.endsWith('.json'))) {
      const d = JSON.parse(read(join('src/i18n/locales', f)));
      for (const key of ['localRisk', 'noProvider', 'backupWarning']) {
        const v = d?.wallet?.[key];
        if (typeof v !== 'string') continue; // absent = falls back to English
        if (/telegram|تلگرام|تليجرام|Телеграм|电报/i.test(v)) offenders.push(`${f}:wallet.${key}`);
      }
    }
    t(
      `wallet safety copy makes no Telegram claim${offenders.length ? ` — ${offenders.slice(0, 3).join(', ')}` : ''}`,
      offenders.length === 0
    );

    // English must still carry all three, since everything falls back to it.
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    for (const key of ['localRisk', 'noProvider', 'backupWarning']) {
      t(`English still defines wallet.${key}`, typeof en?.wallet?.[key] === 'string');
    }

    /*
     * The holdings list must show what the user OWNS, not just a total: the
     * token's identity alongside the amount.
     */
    const w = read('src/pages/Wallet.jsx');
    t('holdings render a token icon', /<TokenIcon/.test(w));
    t('holdings show the token name, not only the ticker', /\{r\.name\}/.test(w));
    t('holdings show the quantity', /fmtQty\(r\.amount\)/.test(w));
  }

  /* ---- 22. the NFT call must not use paid-plan parameters ---------------- */
  /*
   * REAL BUG, and it cost several rounds of chasing the wrong thing.
   *
   * Every NFT request failed with what looked like a rejected API key. The key
   * was replaced twice and nothing changed, because the key was never the
   * problem. Alchemy was answering:
   *
   *   "The following query parameters: [excludeFilters] can only be used with
   *    a payg or higher plan."
   *
   * On the free tier that is a 400/403 — the SAME status a revoked key
   * returns, which is why it was misdiagnosed. The parameter is gone.
   *
   * Two invariants now hold it in place:
   *   1. no known paid-plan parameter appears in the real request
   *   2. the diagnostic's `production` probe matches the real request, or it
   *      reports on a call nobody makes — which is what made the first
   *      diagnostic answer "200 OK" while the feature was down.
   */
  {
    const nft = read('server/nft.js');
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = strip(nft);

    // fetchNfts builds its query with URLSearchParams; find that block.
    const fetchFn = /export async function fetchNfts[\s\S]*?\n\}/.exec(code)?.[0] ?? '';
    t('fetchNfts was found', fetchFn.length > 0);

    /*
     * excludeFilters is the one that bit us. spamConfidenceLevel and
     * orderBy are the other documented paid-tier parameters on this endpoint,
     * listed so the next person does not have to rediscover the category.
     */
    for (const param of ['excludeFilters', 'spamConfidenceLevel', 'orderBy']) {
      t(
        `the real NFT request does not send ${param} (paid plan only)`,
        !new RegExp(param).test(fetchFn)
      );
    }

    // Brackets must never be concatenated raw into a query string.
    t(
      'the NFT query is built with URLSearchParams, not string concatenation',
      /new URLSearchParams\(/.test(fetchFn)
    );

    /*
     * The diagnostic must probe the SAME shape the app sends. A probe that
     * omits the failing parameter produces a confident all-clear for a broken
     * feature.
     */
    const diag = /export async function nftDiagnose[\s\S]*?\n\}/.exec(code)?.[0] ?? '';
    const prod = /production:\s*\(\(\)[\s\S]*?\}\)\(\)/.exec(diag)?.[0] ?? '';
    t('the diagnostic defines a production probe', prod.length > 0);
    t(
      'the production probe does not add parameters the app omits',
      !/excludeFilters/.test(prod)
    );
  }

  /* ---- 23. the PWA must be installable, and must offer it ---------------- */
  /*
   * REPORTED: "the PWA / desktop app does not appear."
   *
   * Everything a browser requires was already correct and verified live — the
   * manifest is served with name, 192 and 512 icons, a maskable icon,
   * display:standalone and a start_url, and the service worker registers over
   * https on a real domain.
   *
   * The missing piece is not a manifest field, which is why it was easy to
   * miss: Chrome fires `beforeinstallprompt` and expects the PAGE to keep the
   * event and call prompt() from a user gesture. Nothing listened, so the
   * event fired into nothing and the only remaining route was the browser's
   * own menu — a small address-bar icon most people never notice.
   *
   * Both halves are asserted: the manifest stays valid, and the app keeps
   * handling the event.
   */
  {
    const m = JSON.parse(read('public/manifest.webmanifest'));

    t('the manifest has a name', typeof m.name === 'string' && m.name.length > 0);
    t('the manifest has a start_url', typeof m.start_url === 'string');
    t('display is standalone-capable', /standalone|fullscreen|minimal-ui/.test(m.display));

    const sizes = (m.icons ?? []).map((i) => i.sizes);
    // Chrome requires BOTH a 192 and a 512 icon; one alone silently disqualifies.
    t('there is a 192px icon', sizes.includes('192x192'));
    t('there is a 512px icon', sizes.includes('512x512'));
    // Without a maskable icon Android renders the app in a white circle.
    t(
      'there is a maskable icon',
      (m.icons ?? []).some((i) => String(i.purpose ?? '').includes('maskable'))
    );

    // A service worker with a fetch handler is required for installability.
    const sw = read('public/sw.js');
    t('the service worker handles fetch', /addEventListener\('fetch'/.test(sw));
    t('the service worker is registered', /serviceWorker\.register/.test(read('src/lib/notify.js')));

    /*
     * The half that was missing. Without this the install offer is invisible
     * to almost everyone.
     */
    const prompt = read('src/components/InstallPrompt.jsx');
    t('the app listens for beforeinstallprompt', /beforeinstallprompt/.test(prompt));
    t('it prevents the default mini-infobar', /preventDefault\(\)/.test(prompt));
    t('it calls prompt() from a handler', /\.prompt\(\)/.test(prompt));
    t('it hides itself once installed', /appinstalled/.test(prompt));
    // Already-installed users must not be nagged to install again.
    t('it detects standalone mode', /display-mode: standalone/.test(prompt));

    // And it has to actually be mounted, or none of the above runs.
    t('the install prompt is mounted', /<InstallPrompt\s*\/>/.test(read('src/App.jsx')));
  }

  /* ---- 24. the swap result must tell the user what happened -------------- */
  /*
   * ASKED DIRECTLY: check that the screen after a successful swap is right,
   * and after a failed one too.
   *
   * It was not. Success was a green tick and the word "success"; failure was a
   * red cross and an error code. After waiting a minute for a confirmation
   * neither answered the question the user actually has.
   *
   * Success now shows a receipt: amount paid, amount received, network. The
   * phone also chimes at that moment (notifyTrade), so this is what someone
   * sees when they pick the phone back up — it has to stand on its own.
   *
   * Failure is the more dangerous one, because the only question is "did it
   * take my money?" and the two failure modes differ:
   *
   *   error  — never reached the chain. Nothing moved, no gas spent.
   *   failed — mined and reverted. Tokens are safe, but the gas is GONE.
   *
   * Telling a reverted transaction "nothing happened" would be false, so the
   * two must not share one message.
   *
   * The smoke test mounts Swap but never reaches these branches, so the
   * structure is asserted here.
   */
  {
    const swap = read('src/pages/Swap.jsx');
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const code = strip(swap);

    // The result state has to CARRY the numbers, or the receipt cannot exist.
    t('the success state records what was paid', /paid:\s*amount/.test(code));
    t('the success state records what was received', /got:\s*fresh\.amountOut/.test(code));
    t(
      'the receipt uses the executed re-quote, not the stale one',
      /got:\s*fresh\.amountOut/.test(code) && !/got:\s*quote\.amountOut/.test(code)
    );

    // And render them.
    t('the success screen shows the amount paid', /txState\.paidSymbol/.test(code));
    t('the success screen shows the amount received', /txState\.gotSymbol/.test(code));
    t('the success screen names the network', /txState\.chainName/.test(code));

    /*
     * Both failure messages must exist and be DIFFERENT keys. A single shared
     * message is the bug: it would either tell a reverted swap no gas was
     * spent, or tell a rejected one it lost gas it never spent.
     */
    t('a reverted swap has its own message', /swap\.failedOnChain/.test(code));
    t('a never-sent swap has its own message', /swap\.failedNothingSent/.test(code));
    t(
      'the two failure messages are chosen by stage',
      /txState\.stage === 'failed'[\s\S]{0,120}failedOnChain/.test(code)
    );

    const en = JSON.parse(read('src/i18n/locales/en.json'));
    // The reverted case must admit the gas is gone; the other must not.
    t('the reverted message mentions the gas cost', /gas/i.test(en?.swap?.failedOnChain ?? ''));
    t(
      'the never-sent message says no fee was charged',
      /no network fee|no fee/i.test(en?.swap?.failedNothingSent ?? '')
    );
    // Neither may claim funds were lost — in both cases the tokens are safe.
    for (const k of ['failedOnChain', 'failedNothingSent']) {
      t(
        `${k} reassures that the tokens are safe`,
        /still in your wallet|never taken|no tokens left/i.test(en?.swap?.[k] ?? '')
      );
    }

    /*
     * The success chime fires from notifyTrade. If that were removed the
     * receipt would only be seen by someone still watching the screen.
     */
    t('a successful swap notifies the user', /notifyTrade\(/.test(code));

    /* ---- the Buy screen's active tab must be visible ---- */
    /*
     * `.segmented button.active` only sets the text colour to BLACK. The
     * coloured pill behind it comes from SegIndicator. Buy copied the markup
     * without it, so the selected tab was black text on a dark panel —
     * invisible in dark theme.
     */
    const buy = read('src/pages/Buy.jsx');
    t('the Buy tabs render an active indicator', /<SegIndicator/.test(buy));

    // And Buy must be reachable from the wallet, where the question is asked.
    t(
      'the wallet links to Buy & sell',
      /navigate\('\/buy'\)/.test(strip(read('src/pages/Wallet.jsx')))
    );
  }

  /* ---- 25. the invite link must point somewhere real --------------------- */
  /*
   * REAL BUG found while building the referral system: the invite URL was
   *
   *   https://t.me/your_bot_username?start=CODE
   *
   * A literal placeholder. Every invite anyone ever shared pointed at a
   * Telegram bot that has never existed, so the referral feature could not
   * have worked once — and the friend received a dead link with our name on
   * it, which costs more than the referral was worth.
   *
   * It now points at the site with ?ref=, built from the configured origin
   * rather than window.location: inside the APK that is https://localhost and
   * the invite would send people to their own phone.
   */
  {
    const earn = read('src/pages/Earn.jsx');
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const code = strip(earn);

    t('the invite link has no placeholder host', !/your_bot_username/.test(code));
    t('the invite link is built from the public origin', /publicAppUrl\(/.test(code));
    t('the invite link carries a ref parameter', /\?ref=/.test(code));
    t('the invite code is url-encoded', /encodeURIComponent\(refCode\)/.test(code));

    // The capture side must run, or codes are shared and never recorded.
    t('referrals are captured at boot', /captureReferral\(\)/.test(strip(read('src/App.jsx'))));

    /*
     * The referral must NOT try to split the fee on-chain. The aggregator
     * pays one feeReceiver; a second recipient would require routing every
     * swap through our own payable contract, where a bug is stolen funds.
     * Attribution is tracked and settled manually instead.
     */
    // Comments stripped: the module DOCUMENTS why it does not split on-chain,
    // and matching that prose would fail for explaining itself.
    const ref = strip(read('src/lib/referral.js'));
    t('the referral module does not touch the fee receiver', !/feeRecipientFor|feeReceiver/.test(ref));
    t('the referral share is documented as a share of OUR fee', /REFERRAL_SHARE/.test(ref));
  }

  return rows;
}
