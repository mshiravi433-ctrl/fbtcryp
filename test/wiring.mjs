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
  /*
   * ─── DELIBERATELY UNLINKED, NOT DEAD ────────────────────────────────────
   * These pages are now reached through a tabbed hub (/lab, /explore-hub,
   * /learn, /rewards) rather than their own menu entry. The standalone routes
   * are KEPT so that anything already pointing at them still resolves — a
   * bookmark, a link in a support message, a deep link in an old build.
   *
   * They are not orphans in the sense this check is for: that check exists to
   * catch a page nobody can ever open, which is dead code that still ships
   * and still needs its translations maintained. A route with no menu entry
   * but a live URL is a different thing.
   *
   * If a hub is ever deleted, remove its members from this list too — then
   * they become genuinely unreachable and the check will say so.
   */
  const reachableViaHub = new Set([
    '/predict', '/invest',      // -> /lab
    '/explore', '/discover',    // -> /explore-hub
    '/help', '/docs',           // -> /learn
    '/earn', '/leaderboard'     // -> /rewards
  ]);

  const orphans = routes.filter(
    (r) =>
      !r.includes(':') && r !== '/' && r !== '*' && !targets.has(r) && !reachableViaHub.has(r)
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
     * Not every variable belongs in CI. The Gemini keys are dev-only
     * overrides for a path the server owns in production.
     */
    const intentionallyUnset = new Set([
      /*
       * Must stay UNSET for store builds. Prediction, perpetuals
       * and invest are what got the app rejected by APKPure for "illegal
       * sensitive words"; setting this in CI would put them back in the store
       * build. Fails safe: a release that forgets an env var ships WITHOUT
       * them.
       */
      'VITE_ENABLE_SPECULATION',
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
    /*
     * The tab strip must actually offer it, or the section is unreachable.
     *
     * The literal changed when the wallet went from three tabs to two:
     * `overview | liquidity | practice` mixed two questions (whose money —
     * real or play; and what kind of holding — tokens or pools). It is now
     * `real | practice`, which asks only the question that matters on a
     * non-custodial app, with pools and NFTs inside the real wallet.
     */
    t(
      'the practice tab is reachable from the tab strip',
      /\['real', 'practice'\]/.test(wallet)
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

  /* ---- 26. every segmented control must render a selection indicator ----- */
  /*
   * REPORTED BY THE OWNER: «بعضی از دکمه‌هاش وقتی فعالند رنگش تغییر نمی‌کند
   * مثلا قیمت افت می‌کند یا بالا می‌رود» — on the automatic-orders screen the
   * direction buttons showed no change when selected.
   *
   * `.segmented button.active` sets `color: #000` and nothing else. The
   * coloured pill behind it is a SEPARATE component, <SegIndicator>, which
   * each screen has to render itself. Two screens forgot: Buy (fixed last
   * session) and Orders (fixed now). The result is black text on a near-black
   * panel — LESS visible than the unselected state, so the control reads as
   * dead.
   *
   * This is the "wired to nothing" bug class again, in CSS form: the class is
   * applied, the state changes, and the thing that would make it visible is
   * simply absent. Finding it one screen at a time is why it keeps recurring,
   * so this check sweeps every file that renders a `.segmented` control.
   *
   * The CSS now also carries a flat fallback background and a ✓ pseudo-element
   * so a future omission degrades to "less pretty" instead of "invisible" —
   * but the indicator is still the intended design, and its absence is still
   * a bug worth failing the build for.
   */
  {
    const offenders = [];
    for (const f of files) {
      const src = read(f);
      if (!/className="segmented/.test(src)) continue;
      if (!/<SegIndicator/.test(src)) offenders.push(f);
    }
    t(
      `every .segmented control renders an indicator${offenders.length ? ` — missing in ${offenders.join(', ')}` : ''}`,
      offenders.length === 0
    );

    /*
     * And the CSS safety net must stay. If someone "tidies away" the fallback
     * background because it looks redundant next to the pill, the next screen
     * that forgets SegIndicator is invisible again with nothing to catch it.
     */
    const css = read('src/index.css');
    const activeRule = css.slice(css.indexOf('.segmented button.active {'));
    t(
      'the active segment has a background fallback, not just a text colour',
      /\.segmented button\.active \{[^}]*background:/.test(activeRule.slice(0, 300))
    );
    t(
      'the active segment is marked with a tick, so colour is not the only cue',
      /\.segmented button\.active::before \{[^}]*content: '✓'/.test(css)
    );
  }

  /* ---- 27. sharing must not be Telegram-only ----------------------------- */
  /*
   * REAL BUG: the ONLY share implementation in the app built a
   * `https://t.me/share/url?...` link and opened it. Consequences:
   *
   *   • Iranian networks mostly do not resolve t.me at all, so the tab hung.
   *   • A user without Telegram installed landed on an install-Telegram page.
   *   • Users on WhatsApp / iMessage / X / SMS had no route whatsoever.
   *
   * Sharing is the only zero-cost growth channel this project has, and every
   * failed tap is a user who tried to bring us another user and could not.
   *
   * `lib/share.js` now tries the Capacitor sheet, then the Web Share API
   * (which is what makes Safari on iPhone work), then Telegram only when the
   * page is genuinely running inside Telegram, then an in-app list.
   */
  {
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const share = strip(read('src/lib/share.js'));

    t('the share module uses the Web Share API', /navigator\.share\(/.test(share));
    t('the share module uses the native Capacitor sheet', /@capacitor\/share/.test(share));
    t('the share module offers non-Telegram destinations', /wa\.me|mailto:|sms:/.test(share));
    t(
      'Telegram is used only when actually inside Telegram',
      /inTelegram\(\)/.test(share) && /Telegram\?\.WebApp\?\.initData/.test(share)
    );
    /*
     * A dismissed OS sheet is a user decision, not a failure. Without this the
     * fallback list pops open the instant someone closes the native sheet,
     * which is the behaviour people describe as "it keeps nagging".
     */
    t('a dismissed share sheet is distinguished from a failure', /DISMISSED/.test(share));

    // And the invite button must go through it rather than the old Telegram
    // helper, or none of the above reaches a user.
    const earn = strip(read('src/pages/Earn.jsx'));
    t('the invite button uses the universal share', /useShare\(\)/.test(earn));
    t('the invite button no longer uses the Telegram-only helper', !/share\?\.\(/.test(earn));
    // Copy always works even when every network link is blocked.
    t('the invite can also be copied', /copyText\(inviteUrl\)/.test(earn));
  }

  /* ---- 28. iOS must be a supported platform, not an afterthought --------- */
  /*
   * There is no iOS build of this app and there cannot be one without an Apple
   * Developer account, which is not purchasable from Iran. So for an iPhone
   * user the home-screen PWA is the ONLY way to keep FBT Swap — which makes
   * these tags load-bearing, not polish.
   *
   * Safari ignores the web app manifest almost entirely: without
   * `apple-mobile-web-app-capable` the "installed" app opens in a normal
   * Safari tab with the address bar, and without `apple-mobile-web-app-title`
   * the icon is captioned with the 60-character SEO <title>.
   *
   * Safari also NEVER fires `beforeinstallprompt` — Apple has not implemented
   * it — so the install banner rendered nothing at all on iOS. The component
   * now shows the Share → Add to Home Screen instruction instead.
   */
  {
    const html = read('index.html');
    t('iOS standalone mode is declared', /apple-mobile-web-app-capable/.test(html));
    t('the iOS home-screen caption is set', /apple-mobile-web-app-title/.test(html));
    t('the viewport covers the notch', /viewport-fit=cover/.test(html));

    const plat = read('src/lib/platform.js');
    /*
     * iPadOS 13+ reports a Macintosh user-agent. Every naive /iPad/ test
     * therefore classifies an iPad as a desktop — and would have shown iPad
     * users desktop-only advice. maxTouchPoints is the reliable tell.
     */
    t('iPadOS is detected despite its desktop user-agent', /maxTouchPoints/.test(plat));
    t('only real Safari is told to use Add to Home Screen', /CriOS|FxiOS/.test(plat));

    const prompt = read('src/components/InstallPrompt.jsx');
    t('the install prompt has an iOS path', /isIOSSafari\(\)/.test(prompt));
    t('the iOS path shows an instruction, not a dead button', /install\.iosBody/.test(prompt));
  }

  /* ---- 29. the layout must cover tablets, not just phone and desktop ----- */
  /*
   * REAL GAP: the shell was 520px wide with breakpoints at 900px and 1400px.
   * An iPad in portrait is 768–834px — below 900 — so every tablet got the
   * phone layout: a 520px strip of content with the fixed bottom nav stretched
   * across the full 820px beneath it. The nav and the content it belonged to
   * were visibly different widths, which is the most recognisable form of
   * "this site is not responsive".
   */
  {
    const css = read('src/index.css');
    t('there is a tablet breakpoint', /min-width:\s*600px\)\s*and\s*\(max-width:\s*899px/.test(css));
    t('there is a small-phone breakpoint', /max-width:\s*360px/.test(css));
    t('landscape phones are handled', /orientation:\s*landscape/.test(css));

    /*
     * Hover effects must be gated on the CAPABILITY, not the screen size: a
     * tapped card on a phone otherwise stays stuck in its hover state until
     * the user taps elsewhere, and looks selected when it is not.
     */
    t('hover effects are disabled on touch devices', /@media \(hover: none\)/.test(css));

    /*
     * Images from third-party hosts (token logos, NFT art) have no size we
     * control. One oversized one used to be able to push the page sideways.
     */
    t('images cannot overflow their container', /img,\s*\n\s*svg,[\s\S]{0,80}max-width: 100%/.test(css));

    /*
     * `overflow-x: hidden` on <html> would make it a scroll container, and a
     * scroll container between a sticky element and the viewport silently
     * disables the stickiness — the header would scroll away. `clip` cuts the
     * overflow without creating that container.
     */
    t(
      'horizontal overflow is clipped without breaking the sticky header',
      /overflow-x: clip/.test(css) && !/html, body \{ overflow-x: hidden/.test(css)
    );
  }

  /* ---- 30. every order error code must have a message -------------------- */
  /*
   * REAL BUG found while auditing the automatic-orders screen: entering a
   * trailing distance outside the allowed band returns 'BAD_TRAIL', and
   * `notify('orderErr.BAD_TRAIL')` had no matching key. Toasts.jsx falls back
   * to `defaultValue: item.key`, so the user was shown the literal string
   *
   *     orderErr.BAD_TRAIL
   *
   * …as the explanation for why their order was refused. It looked like a
   * crash, and there was no way to work out what was actually wrong.
   *
   * The message DID exist under `orders.err.BAD_TRAIL` — written, translated,
   * and read by nothing. That is the same "wired to nothing" class this audit
   * keeps catching, so the dead copy was deleted rather than left to drift out
   * of sync with the live one.
   *
   * Rather than pin this one code, derive the list from the source: any future
   * validation code fails the build until it has a message.
   */
  {
    const src = read('src/lib/orders.js');
    // Codes are the string literals returned by validateOrder/addOrder.
    const codes = new Set(
      [...src.matchAll(/return '([A-Z][A-Z_]+)'/g)].map((m) => m[1])
    );
    // TOO_MANY comes from addOrder's `{ error: 'TOO_MANY' }` shape.
    for (const m of src.matchAll(/error:\s*'([A-Z][A-Z_]+)'/g)) codes.add(m[1]);

    const missing = [...codes].filter((c) => !(`orderErr.${c}` in en.toast));
    t(
      `every order error code has a message${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`,
      missing.length === 0
    );
    t('there are order error codes to check', codes.size >= 10);
  }

  /* ---- 31. a button row must not mix flex:1 with a bare .btn ------------- */
  /*
   * REPORTED: «دکمه اشتراک‌گذاری و کپی متناسب نیست و دکمه اشتراک‌گذاری خیلی
   * کوچک و جمع شده است» — the Share button was a sliver next to Copy.
   *
   * `.btn` sets `width: 100%`. For a flex item, `flex-basis: auto` RESOLVES TO
   * that width — so a button with no flex declaration has a basis of the whole
   * row and `flex-grow: 0`, while its neighbour with `flex: 1` has a basis of
   * 0. The bases already exceed the container, so free space is negative and
   * `flex-grow` has nothing to distribute: the item that asked to expand stays
   * at 0 and collapses to min-content.
   *
   * The button that says "take the space" is the one that gets squeezed. That
   * is a trap rather than a typo, and the twelve locales make it worse — a
   * label that fits in English may not in Persian or German.
   *
   * `.btn-row` sets `flex: 1 1 0` on every child, so the split is even no
   * matter what the labels say. This check fails any row that mixes the two
   * styles, which is the only combination that misbehaves. (Rows where NEITHER
   * button declares flex are fine: equal bases shrink equally.)
   */
  {
    /*
     * FINDING THE BLOCK PROPERLY.
     *
     * The first version of this check matched `{0,900}` characters up to the
     * next `</div>`. The invite row is 1126 characters long — comments and
     * handlers make these blocks big — so it fell outside the window and the
     * check reported PASS while the bug was live. Verified by sabotage: the
     * broken markup was restored and this still went green.
     *
     * That is the brittle-literal trap this suite has been caught by before:
     * a check that silently stops matching keeps "passing" forever. So the
     * extent of the row is now found by BALANCING the div tags instead of
     * guessing a length. No cap, nothing to outgrow.
     */
    const rowBlocks = (src) => {
      const out = [];
      for (const m of src.matchAll(/<div className="row"[^>]*>/g)) {
        let depth = 1;
        let i = m.index + m[0].length;
        const tag = /<div\b|<\/div>/g;
        tag.lastIndex = i;
        let hit;
        while (depth > 0 && (hit = tag.exec(src))) {
          depth += hit[0] === '</div>' ? -1 : 1;
        }
        // Unbalanced (JSX inside a ternary, etc.) — skip rather than guess.
        if (depth !== 0) continue;
        out.push({ body: src.slice(i, tag.lastIndex - 6), index: m.index });
      }
      return out;
    };

    const offenders = [];
    for (const f of files) {
      if (!/\.jsx$/.test(f)) continue;
      const src = read(f);
      for (const block of rowBlocks(src)) {
        const btns = [...block.body.matchAll(/(className="btn[^"]*")([^>]*?)>/g)];
        if (btns.length < 2) continue;

        /*
         * ONLY FULL-WIDTH BUTTONS ARE AFFECTED.
         *
         * The whole mechanism is `.btn { width: 100% }` becoming the
         * flex-basis. `.btn-sm` overrides that with `width: auto`, so its
         * basis is its own content — bases stay small, free space stays
         * positive, and `flex-grow` works exactly as written.
         *
         * The first version of this check flagged the Orders action row, which
         * mixes `flex: 1` with bare `.btn-sm` buttons and is CORRECT: the
         * primary "swap now" is meant to take the space while pause/cancel
         * stay at their natural size. Failing that would have pushed me to
         * "fix" working markup, so the check now tests the actual cause rather
         * than the surface pattern.
         */
        const fullWidth = btns.filter((m) => !/\bbtn-sm\b/.test(m[1]));
        if (fullWidth.length < 2) continue;

        const flexed = fullWidth.map((m) => /flex:\s*1/.test(m[2]));
        // Mixed is the broken case.
        if (flexed.some(Boolean) && !flexed.every(Boolean)) {
          offenders.push(`${f}:${src.slice(0, block.index).split('\n').length}`);
        }
      }
    }
    t(
      `no button row mixes flex:1 with a full-width .btn${offenders.length ? ` — ${offenders.join(', ')}` : ''}`,
      offenders.length === 0
    );

    // And the class that makes equal-width the default must exist and neutralise
    // the width:100% that causes all of this.
    const css = read('src/index.css');
    const row = css.slice(css.indexOf('.btn-row > .btn {'), css.indexOf('.btn-row > .btn {') + 400);
    t('there is a .btn-row helper', css.includes('.btn-row {'));
    t('.btn-row zeroes the flex-basis so width:100% stops mattering', /flex:\s*1 1 0/.test(row));
    t('.btn-row overrides the inherited full width', /width:\s*auto/.test(row));
    t('the invite row uses it', /className="btn-row"/.test(read('src/pages/Earn.jsx')));
  }

  /* ---- 32. the QR scanner must not restart on every parent render -------- */
  /*
   * REPORTED: «گاهی تصویر طوسی نشون میده» — the camera preview intermittently
   * showed a flat grey rectangle.
   *
   * The camera effect listed `onClose` and `onResult` in its dependency array,
   * and BOTH call sites pass inline arrow functions — a new identity on every
   * render. Its cleanup calls `stop()`, which sets `video.srcObject = null`
   * and stops the track, so the camera was torn down and reopened on every
   * parent re-render. A <video> with no source paints its background: grey.
   *
   * WHY IT WAS INTERMITTENT: WalletContext refreshes the balance on a 30s
   * interval, and each refresh re-renders every consumer including SendSheet.
   * Scan quickly and you never saw it; hesitate and the camera died under you.
   * On some Android devices the reopen fails outright because the previous
   * track has not released yet — the "it never comes back" version.
   *
   * Scanning is the safety feature that stops people hand-typing a 42-char
   * address they cannot verify, so a scanner people stop trusting costs real
   * money.
   */
  {
    const src = read('src/components/QrScanner.jsx');
    const strip = (x) =>
      x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = strip(src);

    // The dependency array must be `open` alone.
    const dep = /\}, \[([^\]]*)\]\);/g;
    const arrays = [...code.matchAll(dep)].map((m) => m[1].trim());
    t(
      'the camera effect depends on `open` only',
      arrays.includes('open') && !arrays.some((a) => /onClose|onResult/.test(a))
    );
    // …because the callbacks are read through refs instead.
    t('the callbacks are held in refs', /onResultRef\.current/.test(code) && /onCloseRef\.current/.test(code));

    /*
     * Second half: even a legitimate cold start takes a second or two, and an
     * unexplained grey box during it is indistinguishable from a failure.
     */
    t('there is a visible starting state', /setPhase\('starting'\)/.test(code));
    t('the preview waits for real pixels, not just play()', /readyState/.test(code));
    t('the placeholder covers the empty video', /qr-warming/.test(code));
    t('the starting state has a message', hasKey(en, 'scan.starting'));
    /*
     * The reticle must be hidden until the camera is live: brackets floating
     * over a blank box imply a running camera when there is none.
     */
    t("the reticle waits for the camera", /phase === 'live' && <div className="qr-reticle"/.test(code));
  }

  /* ---- 33. the quoted Solana fee must match the charged one -------------- */
  /*
   * REAL DISCREPANCY: the Solana screen unconditionally announced a 0.70%
   * platform fee, but the fee is only REQUESTED when a Jupiter referral
   * account is configured — and it deliberately is not (setting one up costs
   * SOL, and with no users there is nothing to collect). So every visitor was
   * told they would pay 0.70% while paying nothing.
   *
   * Overstating a fee is the safer direction to be wrong in, but "the fee I
   * was quoted is not the fee I paid" is precisely the discrepancy that makes
   * someone distrust a swap they cannot reverse.
   *
   * The rule: the SAME flag that decides whether to request the fee must
   * decide whether to announce it, so the two cannot drift apart again.
   */
  {
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const page = strip(read('src/pages/SolanaSwap.jsx'));
    const lib = strip(read('src/lib/solana.js'));

    t(
      'the fee notice is gated on the same readiness flag as the fee itself',
      /solanaFeeReady\(\)/.test(page) && /if \(solanaFeeReady\(\)\)/.test(lib)
    );
    t('there is honest copy for the no-fee case', hasKey(en, 'solana.feeNoneNotice'));
    t('the no-fee copy is actually used', /solana\.feeNoneNotice/.test(page));
    /*
     * And the server must behave the same way. It reads its own env var rather
     * than trusting the client, so a mismatch there would charge a fee the UI
     * never mentioned — the dangerous direction.
     */
    const server = strip(read('server/solana.js'));
    t(
      'the server also skips the fee without a referral account',
      /BASE58\.test\(ref\)/.test(server)
    );
  }

  /* ---- 34. the site must be more than one indexable page ---------------- */
  /*
   * MEASURED PROBLEM, not a hunch: `site:lawpoetics.ir` on Google returns ONE
   * result, while the app has 33 routes. That is arithmetic, not bad luck —
   * every route is behind a hash (`/#/swap`), and nothing after the `#` is
   * ever sent to the server, so a crawler receives the identical document for
   * every screen.
   *
   * Meanwhile /api/orders/watch/status still reports `watches: 0`. Search is
   * the only arrival channel that costs nothing and keeps working while
   * nobody is watching it, so having exactly one indexable page is the single
   * most expensive fact about this project.
   *
   * scripts/gen-landing.mjs emits real static pages at build time. These
   * checks guard the two ways that silently stops working.
   */
  {
    /*
     * Comments stripped FIRST. The user-agent check below failed on its own
     * documentation — the file explains at length why it does not sniff user
     * agents, and the word "user-agent" appears in that explanation. Same
     * trap this suite has hit repeatedly: a check that matches the prose
     * describing the thing it is checking for.
     */
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const gen = strip(read('scripts/gen-landing.mjs'));
    const pkg = JSON.parse(read('package.json'));

    /*
     * If the generator is not wired into `build`, it runs on nobody's machine
     * and the pages simply never deploy — while the script still sits in the
     * repo looking like it works.
     */
    t(
      'the landing pages are generated by the build',
      /gen-landing\.mjs/.test(pkg.scripts?.build ?? '')
    );

    /*
     * Generated pages FOR CRAWLERS are cloaking and are penalised hard. The
     * defence is that there is no user-agent branching anywhere: a person and
     * a crawler are served the same file.
     */
    t('the generator does not branch on user agent', !/user-?agent/i.test(gen));

    /*
     * An instant redirect turns a landing page into a doorway page, which
     * Google penalises — and a bounced visitor learns nothing about the app
     * either. The link into the app must be a normal anchor.
     */
    t('no meta-refresh redirect', !/http-equiv=["']?refresh/i.test(gen));
    t('the app link is a real anchor', /class="cta" href=/.test(gen));

    /*
     * Every page must carry a canonical, or three pages describing one
     * product compete with each other and with the root.
     */
    t('pages declare a canonical url', /rel="canonical"/.test(gen));

    /* A finance landing page without a risk statement is the kind of thing a
       store reviewer and a regulator both look for. */
    t('pages carry the risk statement', /Nothing here is financial advice/.test(gen));

    /*
     * The sitemap must be regenerated with them. Submitting one that omits
     * the new pages leaves the whole exercise depending on Google finding
     * them unaided.
     */
    t('the sitemap is regenerated', /sitemap\.xml/.test(gen));
  }

  /* ---- 35. advertised chains must actually exist ------------------------ */
  /*
   * REAL BUG, and it was the text Google had indexed: the <title> said
   * "9 Chains" and the description listed Tron. We support seven EVM chains
   * plus Solana — eight — and there is no Tron swap route at all; chains.js
   * mentions Tron only to warn that sending an EVM address to it burns the
   * funds.
   *
   * So the one thing search engines knew about us was partly false, and
   * someone arriving to swap on Tron would have found nothing. An advertised
   * capability that does not exist is also exactly what a store reviewer
   * checks.
   *
   * Derived from the source rather than pinned to the number 8, so adding a
   * real chain does not fail the build.
   */
  {
    const chains = read('src/lib/chains.js');
    const evm = new Set([...chains.matchAll(/^\s{4}id: (\d+),/gm)].map((m) => m[1]));
    // Solana is not in EVM_CHAINS; it has its own module and its own route.
    const total = evm.size + (existsSync('src/lib/solana.js') ? 1 : 0);

    const html = read('index.html');
    const title = (html.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? '';

    const claimed = Number((title.match(/(\d+)\s+Chains/i) ?? [])[1]);
    t(
      `the title claims the number of chains we have (says ${claimed}, have ${total})`,
      !Number.isFinite(claimed) || claimed === total
    );

    /*
     * And nothing may advertise a chain we cannot swap on. Tron is the one
     * that was wrong; the check is generic so the next one is caught too.
     */
    const meta = (html.match(/name="description"\s+content="([^"]*)"/) ?? [])[1] ?? '';
    t('the description does not advertise Tron', !/\bTron\b/i.test(meta));
    t('the manifest does not claim nine networks',
      !/nine networks/i.test(read('public/manifest.webmanifest')));
  }

  /* ---- 36. one source of truth for the wallet panel's geometry ---------- */
  /*
   * REPORTED: "صفحه والت کامل بهم خورده، دکمه ها اندازشون درست نیست."
   *
   * The panel carried BOTH `.card` and `.wal-hero`. `.card` sets
   * `padding: 15px`; `.wal-hero` set 18px. The divider under the balance used
   * `margin: -18px` to reach the panel edges — so whichever rule won the
   * cascade, the hairline overhung or fell short by 3px on each side.
   *
   * Separately the Buy button was `.btn.btn-sm` with an inline
   * `width: '100%'`, while `.btn-sm` itself declares `width: auto`. An inline
   * style fighting the stylesheet is why it looked the wrong size.
   *
   * Three sources of truth for one panel. There is now one: `--wal-pad`.
   */
  {
    const css = read('src/index.css');
    const wallet = read('src/pages/Wallet.jsx');

    t(
      'the wallet panel is not also a .card',
      !/className="card wal-hero"/.test(wallet)
    );

    const heroRule = css.slice(css.indexOf('.wal-hero {'), css.indexOf('\n}', css.indexOf('.wal-hero {')));
    t('the panel declares its own padding variable', /--wal-pad:/.test(heroRule));

    /*
     * The divider must derive its bleed from that variable rather than
     * restating the number — restating it is exactly how the 3px mismatch
     * happened.
     */
    const valueRule = css.slice(css.indexOf('.wal-hero-value {'), css.indexOf('\n}', css.indexOf('.wal-hero-value {')));
    t(
      'the divider derives its bleed from the padding variable',
      /var\(--wal-pad\)/.test(valueRule) && !/-18px/.test(valueRule)
    );

    /* No inline width hacks fighting the stylesheet. */
    t(
      'the buy button is a real class, not an inline width override',
      /className="wal-buy"/.test(wallet) && !/btn-sm"\s*\n\s*style=\{\{ width: '100%' \}\}/.test(wallet)
    );
  }

  /* ---- 37. the full build must still exist and be reachable ------------- */
  /*
   * The speculation screens were removed from the STORE build because APKPure
   * rejected the app over their vocabulary. The owner still wants a complete
   * build for other channels, so the opt-in has to remain wired — a flag
   * nobody can turn on is a deletion with extra steps.
   */
  {
    const pkg = JSON.parse(read('package.json'));
    t('there is a full-feature build script', Boolean(pkg.scripts?.['build:full']));
    t(
      'the full build turns the speculation flag on',
      /VITE_ENABLE_SPECULATION=true/.test(pkg.scripts?.['build:full'] ?? '')
    );
    /*
     * ...and must NOT resurrect the arcade. The games were deleted from the
     * repository because a gambling-styled screen next to a real swap screen
     * hurts the product on the website too, not only in a store review. A
     * stray VITE_ENABLE_GAMES here would be a silent attempt to bring back
     * code that no longer exists — and the day someone re-adds the pages,
     * this is what stops the flag reappearing with them.
     */
    t(
      'no build script re-enables an arcade',
      !/VITE_ENABLE_GAMES/.test(JSON.stringify(pkg.scripts ?? {})) &&
        !/VITE_ENABLE_GAMES/.test(read('ci/build-full.sh')) &&
        !/VITE_ENABLE_GAMES/.test(read('ci/build-both.sh'))
    );
    t('there is an APK script for it', existsSync('ci/build-full.sh'));
    /*
     * And it must warn, loudly, in the file itself. Uploading the full build
     * to a store is the one mistake that costs a second rejection, and a
     * second rejection from the same reviewer is harder to appeal.
     */
    t(
      'the full build warns against uploading it to a store',
      /DO NOT upload/i.test(read('ci/build-full.sh'))
    );
  }

  /* ---- 38. tutorials must be reachable from Iran ------------------------ */
  /*
   * Every tutorial link was a YouTube search. YouTube does not load on most
   * Iranian networks, which is where most of this app's users are — so the
   * "watch a tutorial" button opened a page that never appeared, and that
   * reads as a broken app rather than a blocked site.
   */
  {
    const docs = read('src/pages/Docs.jsx');
    /*
     * ─── THE PERSIAN VIDEO BUTTON WAS REMOVED, DELIBERATELY ─────────────────
     * This block used to assert an Aparat source existed. That assertion was
     * correct when written and is now wrong, so it is inverted rather than
     * deleted — the reasoning has to survive.
     *
     * The button never pointed at a video. It ran an Aparat SEARCH for a
     * phrase, so whether anything relevant came back depended on Aparat's
     * index that day. Reported by the owner as «فیلم های فارسی حذف بشه
     * نمیارع» — the Persian videos do not come up. A button that works
     * sometimes is worse than no button: the user blames the app and stops
     * trusting the links that do work.
     *
     * English stays because a YouTube search for a technical phrase does
     * reliably return results — and it is now labelled as a search.
     */
    t('the Aparat search is gone', !/aparat\.com/.test(docs));
    t('the English source is still offered', /youtube\.com/.test(docs));
    t('...and is labelled as a search, not a video', hasKey(en, 'docs.watchEn'));
    t('the Persian label is gone with it', !hasKey(en, 'docs.watchFa'));
  }

  /* ---- 39. the galaxy must not be a video file -------------------------- */
  /*
   * The request was for a film behind the Start screen. Drawn instead, and
   * the reasoning is worth pinning: a video would roughly triple a 7.5 MB
   * APK for a screen shown once, and on a slow or filtered connection it
   * would still be buffering while a first-time user decides whether the app
   * works. iOS also refuses to autoplay unless muted+playsinline, and Low
   * Power Mode blocks it outright — so the fallback has to look good anyway.
   */
  {
    /*
     * Comments stripped first: the file DOCUMENTS that it avoids
     * Math.random(), so the literal string appears in its own explanation.
     * Same trap this suite keeps hitting — a check that matches the prose
     * describing the thing it is checking for.
     */
    const galaxy = read('src/components/GalaxyBackdrop.jsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    t('the backdrop ships no video element', !/<video/i.test(galaxy));
    t('the backdrop is drawn as SVG', /<svg/.test(galaxy));

    /*
     * Star positions must be deterministic. Math.random() would reshuffle the
     * sky on every re-render, which reads as the whole screen twitching.
     */
    t('star positions are seeded, not random', !/Math\.random\(\)/.test(galaxy));

    /* Reduced motion must be honoured — this is a full-screen moving scene. */
    t('reduced motion is respected', /useReducedMotion/.test(galaxy));
    t(
      'reduced motion is also handled in CSS',
      /prefers-reduced-motion[\s\S]{0,400}galaxy-star/.test(read('src/index.css'))
    );
  }

  /* ---- 40. every styled class must actually have styles ----------------- */
  /*
   * REAL BUG, reported twice: "دکمه های بروزرسانی و قطع و وصل اندازه ها
   * نامتقارن و کوچک، رنگ طوسی زشت."
   *
   * The cause was not a design choice. Rewriting a block of index.css dropped
   * `.wal-utils` and `.wal-util` while Wallet.jsx kept using them, so three
   * buttons rendered COMPLETELY UNSTYLED — browser-default size, default
   * grey, no spacing. Confirmed against git history: the rules existed two
   * commits earlier.
   *
   * Nothing caught it. The build passed, every render test passed, the class
   * names were spelled correctly — the styles simply were not there. That is
   * the same "wired to nothing" family this audit exists for, in CSS form.
   *
   * So: every `wal-*`, `hist-*`, `galaxy-*`, `doc-*` and `nav-*` class used
   * in JSX must exist in the stylesheet. Scoped to our own prefixes rather
   * than every class, because generic utilities are composed dynamically and
   * would produce false positives.
   */
  {
    /*
     * Comments stripped, or this check passes on its own documentation — the
     * note above literally names `.wal-utils`, which was enough to satisfy it.
     * Caught by sabotage: deleting the real rules left this green.
     */
    const css = read('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');
    /*
     * `verd-` and `farm-` were added when the verdict panel and the live-yield
     * Farm screen landed. Both introduced whole new class families, which is
     * exactly the moment this check earns its keep: the recurring bug in this
     * codebase is a class that is referenced and styles nothing.
     */
    const owned = /^(wal|hist|galaxy|doc|nav|ord|disc|share|btn-row|verd|farm|eq|stk|brg|swap-portion)-?/;

    const used = new Set();
    for (const f of files) {
      if (!/\.jsx$/.test(f)) continue;
      const src = read(f);
      // Only static className strings; template literals are matched for
      // their literal segments, which is where these names appear.
      for (const m of src.matchAll(/className=["'`]([^"'`{}]+)["'`]/g)) {
        for (const cls of m[1].split(/\s+/)) {
          if (owned.test(cls)) used.add(cls);
        }
      }
    }

    /*
     * The selector must END at a class boundary. A plain `includes('.wal-util')`
     * is satisfied by `.wal-utils` — so deleting `.wal-utils` while keeping
     * `.wal-util` (or vice versa) would pass. Caught by sabotage: removing the
     * real rule left this check green.
     */
    /*
     * Must be a real DECLARATION, not any mention.
     *
     * Two ways the naive version passed while the styles were gone:
     *   • `.wal-util:hover` kept matching after the base rule was deleted, so
     *     a class with only a hover state looked styled.
     *   • the class name appeared inside a comment.
     *
     * So: the selector must be followed by a `{` — optionally after other
     * selectors in a list — and pseudo-class-only rules do not count.
     */
    const declared = (cls) => {
      const esc = cls.replace(/-/g, '\\-');
      // `.cls` then optional whitespace/commas/other selectors, then `{`
      return new RegExp(`\\.${esc}(?![\\w-])[^{:]*\\{`).test(css);
    };
    const missing = [...used].filter((cls) => !declared(cls));
    t(
      `every project class used in JSX has styles${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`,
      missing.length === 0
    );
    // A vacuous pass would be worse than a failure.
    t(`there were classes to check (${used.size})`, used.size > 20);
  }

  /* ---- 41. the verdict engine and the live-yield feed are really wired -- */
  /*
   * ─── THE BUG CLASS THIS GUARDS ────────────────────────────────────────────
   * Roughly eighteen bugs in this repo have been the same shape: something
   * that exists, is referenced, and connects to nothing. A signal engine
   * nobody renders and a server route nobody calls are the two most expensive
   * versions of that, because both look complete in a diff.
   */
  {
    /* ---- the verdict engine reaches a screen ---- */
    t('the verdict engine exists', existsSync('src/lib/verdict.js'));
    t('the macro layer exists', existsSync('src/lib/macro.js'));
    t('there is a panel to render it', existsSync('src/components/VerdictPanel.jsx'));

    const panel = read('src/components/VerdictPanel.jsx');
    t('the panel actually calls the engine', /from '\.\.\/lib\/verdict'/.test(panel));

    const signals = read('src/pages/Signals.jsx');
    const detail = read('src/pages/CoinDetail.jsx');
    t('the Signals screen mounts the panel', /<VerdictPanel/.test(signals));
    t('the coin screen mounts it too', /<VerdictPanel/.test(detail));

    /*
     * The macro layer is the whole reason this engine is better than the old
     * one, and it is useless without a BTC series to compare against. A screen
     * that mounts the panel but passes no `btcSeries` gets a verdict with the
     * macro layer silently weighted to zero — working code, dead feature, and
     * invisible in review.
     */
    for (const [name, src] of [['Signals', signals], ['CoinDetail', detail]]) {
      t(`${name} passes a bitcoin series to the macro layer`, /btcSeries=\{/.test(src));
      t(`${name} fetches one`, /useChart\('bitcoin'/.test(src));
      t(`${name} passes global stats too`, /global=\{/.test(src));
    }

    /*
     * The ceilings must be IMPORTED, never re-typed. A copied constant in the
     * UI drifts from the engine silently and then the bar is drawn against a
     * number that is no longer the real limit.
     */
    t('the panel imports the confidence ceilings rather than copying them',
      /CONFIDENCE_CEILING/.test(panel) && /from '\.\.\/lib\/verdict'/.test(panel));
    t('...and does not hard-code 75 anywhere', !/\b75\b/.test(panel.replace(/\/\*[\s\S]*?\*\//g, '')));

    /* ---- the yield feed is served, fetched and rendered ---- */
    t('the yield filter exists', existsSync('server/yields.js'));
    const appSrc = read('server/app.js');
    t('the API exposes it', /\/api\/yields/.test(appSrc));
    t('...backed by the real fetcher', /fetchYields/.test(appSrc));

    const farm = read('src/pages/Farm.jsx');
    /*
     * `/getYields/` alone was not enough: replacing the CALL with
     * `Promise.resolve(null)` left the import line intact and the check
     * green — a dead screen that still looked wired. Verified by sabotage.
     * So the invocation itself must be present.
     */
    t('Farm reads live yields', /getYields\s*\(/.test(farm));
    t('...and imports it from the yields module', /from '\.\.\/lib\/yields'/.test(farm));
    /*
     * The old screen was four hard-coded pools with hand-written APR ranges.
     * If that constant ever comes back the screen has silently regressed to
     * showing figures that were true months ago.
     */
    t('Farm no longer hard-codes a pool list', !/const FARMS\s*=/.test(farm));
    t('...and no longer hard-codes an APR range', !/aprRange/.test(farm));

    /*
     * The two disclosures that make this screen honest. The first is the
     * number every yield aggregator hides; the second is the only revenue
     * path on the page and it must be stated.
     */
    t('Farm shows the real-vs-emissions split', /realShare/.test(farm));
    t('Farm states that we take no cut of yield',
      /take no cut of your yield/i.test(read('src/i18n/locales/en.json')));
  }

  /* ---- 42. tokenized equities and liquid staking are really wired ------- */
  /*
   * ─── WHY THIS SECTION IS MOSTLY ABOUT SAFETY, NOT PLUMBING ────────────────
   * The plumbing here is ordinary. What is not ordinary is that this screen
   * offers assets whose impersonations are one search away: querying Jupiter
   * for "AAPLx" returns seven tokens, six of them clones. Every check below
   * guards a property that, if it silently regressed, would send a user's
   * money to a stranger.
   */
  {
    t('the curated asset list exists', existsSync('src/lib/solanaAssets.js'));
    t('the server verifier exists', existsSync('server/solanaAssets.js'));

    const appSrc = read('server/app.js');
    t('the API exposes the verified asset list', /\/api\/solana\/assets/.test(appSrc));
    t('...backed by the real fetcher', /fetchSolanaAssets/.test(appSrc));

    const stocks = read('src/pages/Stocks.jsx');
    const farm = read('src/pages/Farm.jsx');
    const swap = read('src/pages/SolanaSwap.jsx');
    const assets = read('src/lib/solanaAssets.js');

    /* ---- the equities screen ---- */
    t('Stocks fetches the verified list', /getSolanaAssets\s*\(/.test(stocks));
    t('Stocks renders equity rows', /<EquityRow/.test(stocks));
    /*
     * The old copy said "why you can't buy Apple stock here". That is now
     * false, and a screen that contradicts itself is worse than one that says
     * nothing — the same class of error as the old "9 Chains" claim.
     */
    t('the obsolete "you cannot buy stock here" copy is gone',
      !/honestTitle/.test(stocks) && !/stocks\.honestBody/.test(read('src/i18n/locales/en.json')));

    /*
     * The freeze warning must render ABOVE the buy list. Placement is the
     * whole point: a risk notice below the thing it warns about is the
     * pattern that produced the APKPure rejection.
     */
    {
      const warnAt = stocks.indexOf('stocks.freezeTitle');
      const listAt = stocks.indexOf('<EquityRow');
      t('the freeze warning exists', warnAt > -1);
      t('...and it renders before the buy list', warnAt > -1 && listAt > -1 && warnAt < listAt);
    }

    /* ---- the safety gates are actually applied, not merely defined ---- */
    t('the depth gate is applied to each row', /liquidityVerdict\s*\(/.test(read('src/components/EquityRow.jsx')));
    t('the buy button is disabled when the order is too big',
      /disabled=\{!verdict\.ok\}/.test(read('src/components/EquityRow.jsx')));
    t('Stocks applies the listing floor', /MIN_EQUITY_LIQUIDITY/.test(stocks));

    /*
     * The issuer authority is the one check a clone cannot pass. If this
     * constant ever stops being compared, the whole defence is decoration.
     */
    t('the issuer authority is defined', /XSTOCK_MINT_AUTHORITY\s*=/.test(assets));
    t('...and the server compares against it',
      /live\.mintAuthority !== XSTOCK_MINT_AUTHORITY/.test(read('server/solanaAssets.js')));

    /* ---- liquid staking ---- */
    t('Farm fetches the staking tokens', /getSolanaAssets\s*\(/.test(farm));
    t('Farm joins the live yield rather than hard-coding one', /yieldForLst\s*\(/.test(farm));
    t('Farm offers a stake action', /farm\.stakeNow/.test(farm));

    /* ---- the handoff ---- */
    /*
     * Both screens hand off by MINT, never by symbol. A symbol is exactly what
     * the clones copy, so resolving one on arrival would reintroduce the
     * impersonation risk the whole asset list exists to remove.
     */
    for (const [name, src] of [['Stocks', stocks], ['Farm', farm]]) {
      t(`${name} hands off using the mint address`, /\/solana\?to=\$\{encodeURIComponent\(asset\.mint\)\}/.test(src));
    }
    t('SolanaSwap reads the handoff param', /searchParams\.get\('to'\)/.test(swap));
    /*
     * ...and restricts it to the curated list. Without this, sharing a
     * ?to=<scam mint> link is a one-tap phishing vector.
     */
    t('...and only accepts curated mints', /findAsset\(to\)/.test(swap));
  }

  /* ---- 43. amount selectors are visible from what they change ----------- */
  /*
   * ─── THE BUG ──────────────────────────────────────────────────────────────
   * Farm's amount selector sat INSIDE the pools section, several hundred
   * pixels below the staking rows that already read `amount` to compute their
   * projection. So the staking numbers were driven by a control the user could
   * not see until they had scrolled past them. Reported as "میزان سود روی ۱۰۰
   * ۱۰۰۰ و ۱۰۰۰۰ را نمیزنه" — which is what a control that changes nothing
   * visible looks like from the outside.
   *
   * A control must appear above everything that depends on it. Position is not
   * a detail here: it is the difference between a feature and a dead button.
   */
  {
    const farm = read('src/pages/Farm.jsx');
    const selectorAt = farm.indexOf('farm-amounts');
    const stakingAt = farm.indexOf("farm.stakingTitle");
    const poolsAt = farm.indexOf("farm.pools'");

    t('Farm has an amount selector', selectorAt > -1);
    t('...it appears before the staking rows it drives',
      selectorAt > -1 && stakingAt > -1 && selectorAt < stakingAt);
    t('...and before the pool rows it also drives',
      selectorAt > -1 && poolsAt > -1 && selectorAt < poolsAt);
    /* Exactly one, or two copies drift out of sync. */
    t('there is only one amount selector on Farm',
      farm.split('farm-amounts').length - 1 === 1);

    const stocks = read('src/pages/Stocks.jsx');
    const stkSel = stocks.indexOf('farm-amounts');
    const stkRows = stocks.indexOf('<EquityRow');
    t('Stocks selector appears before its rows too',
      stkSel > -1 && stkRows > -1 && stkSel < stkRows);

    /*
     * And the selected amount must actually PRODUCE a number on screen.
     * Feeding it only into the disabled-state of a button is what made it look
     * broken: the gate worked, but nothing visible changed.
     */
    t('the equity row states what the amount buys', /stocks\.wouldGet/.test(read('src/components/EquityRow.jsx')));
    t('the staking row states what the amount earns', /farm\.wouldEarn/.test(farm));

    /*
     * No bare <img> for token artwork on these screens. A raw tag has no
     * onError, so a dead CDN leaves an empty circle that reads as broken —
     * the exact bug documented at the top of lib/tokenIcon.jsx.
     */
    for (const [name, src] of [['Farm', farm], ['EquityRow', read('src/components/EquityRow.jsx')]]) {
      t(`${name} uses TokenIcon rather than a bare img`,
        /<TokenIcon/.test(src) && !/<img\s+src=\{asset\.icon\}/.test(src));
    }
  }

  /* ---- 44. swap percentage shortcuts + market sectors ------------------- */
  {
    const swap = read('src/pages/Swap.jsx');

    /*
     * ─── THE PERCENTAGE SHORTCUTS ─────────────────────────────────────────
     * Requested as the Trust Wallet pattern. The dangerous part is the maths:
     * this fills an amount the user then signs, and an amount one wei above
     * the balance reverts on transfer AFTER charging gas.
     */
    t('swap offers percentage shortcuts', /setPortion\s*\(/.test(swap));
    t('...for 25/50/75/100', /\[25, 50, 75, 100\]/.test(swap));
    /*
     * BigInt, not floats. `raw * 25n / 100n` is exact and truncates; the float
     * round-trip is what produces an unspendable amount. This is the same
     * class of bug the MAX comment in that file already documents.
     */
    t('the portion maths stays in BigInt', /raw \* BigInt\(/.test(swap) && /\/ 100n/.test(swap));
    /*
     * 100% must still reserve gas on a native coin or it reverts, so it has
     * to go down the existing MAX path rather than being 100/100 of raw.
     */
    t('100% still routes through the gas-reserve path',
      /percent < 100/.test(swap) && /NATIVE_GAS_FLOOR/.test(swap));
    t('MAX is kept as an alias rather than duplicated',
      /const setMax = \(\) => setPortion\(100\)/.test(swap));

    /* ---- market sectors ---- */
    const api = read('src/lib/api.js');
    const market = read('src/pages/Market.jsx');
    const appSrc = read('server/app.js');

    t('the category map exists', /MARKET_CATEGORIES/.test(api));
    t('Market renders sector tabs', /market\.sector\./.test(market));
    t('...and fetches them', /getCategory\s*\(/.test(market));
    t('the API proxies categories', /\/api\/category\//.test(appSrc));

    /*
     * An open proxy to an upstream API is how our IP gets rate-limited by a
     * stranger. The slug must be validated, not passed through.
     */
    t('the category slug is validated server-side',
      /\^\[a-z0-9-\]\+\$/.test(appSrc) && /BAD_CATEGORY/.test(appSrc));

    /*
     * A sector must NOT fall back to the offline snapshot. That snapshot is
     * the top coins by market cap, so a network failure would render Bitcoin
     * under a "Gold" tab — worse than an honest empty state.
     */
    {
      const idx = api.indexOf('export function getCategory');
      const body = api.slice(idx, idx + 2000);
      t('a failed sector fetch returns empty, not the offline list',
        /fallback: \(\) => \[\]/.test(body) && !/offlineMarkets/.test(body));
    }
  }

  /* ---- 45. the cross-chain bridge is wired and its key stays server-side - */
  {
    t('the bridge module exists', existsSync('server/bridge.js'));
    const appSrc = read('server/app.js');
    const bridge = read('server/bridge.js');

    t('the API exposes a bridge quote', /\/api\/bridge\/quote/.test(appSrc));
    /*
     * A status route matters more here than usual. LI.FI bridging WORKS
     * without the portal being set up — it just earns nothing, which looks
     * identical to a working integration from outside. This is the only way
     * to tell the two apart.
     */
    t('...and a status route that reports whether fees are live',
      /\/api\/bridge\/status/.test(appSrc));

    /*
     * ─── THE KEY MUST NEVER BE VITE_ ────────────────────────────────────────
     * Anything VITE_-prefixed is compiled into the browser bundle and the
     * APK. A leaked LI.FI key is billed to us and can be exhausted by a
     * stranger. This is the same rule that governs the Jupiter and Gemini
     * keys, asserted rather than remembered.
     */
    t('the LI.FI key is read server-side only',
      /process\.env\.LIFI_API_KEY/.test(bridge) && !/VITE_LIFI/.test(bridge));
    t('...and no client file reaches for it',
      !read('src/lib/api.js').includes('LIFI_API_KEY'));

    /*
     * `integrator` and `fee` decide where our revenue goes. If they were in
     * the forwarded allow-list, anyone could redirect our commission to their
     * own wallet by editing a query string — the same boundary as
     * server/solana.js.
     */
    {
      const idx = bridge.indexOf('const ALLOWED = [');
      const list = bridge.slice(idx, bridge.indexOf('];', idx));
      t('the caller cannot supply the integrator', !/integrator/.test(list));
      t('the caller cannot supply the fee', !/'fee'/.test(list));
      t('...but the server does set them', /params\.set\('integrator'/.test(bridge));
    }

    /*
     * Same-chain must be refused. It belongs on the swap screen, which quotes
     * two aggregators and charges our full 0.7% — routing it through a bridge
     * would be a worse price AND a smaller fee.
     */
    t('same-chain requests are refused', /SAME_CHAIN/.test(bridge));
    t('unsupported chains are refused', /UNSUPPORTED_CHAIN/.test(bridge));

    /*
     * The graceful degradation. LI.FI rejects the WHOLE request with code
     * 1011 when the integrator is not yet configured; showing that to a user
     * would blame them for our setup, so the fee-bearing quote is retried
     * clean.
     */
    t('an unconfigured fee falls back to a working quote', /1011/.test(bridge));

    /* Documented for whoever deploys it, without the key itself. */
    const env = read('.env.example');
    t('the bridge vars are documented', /LIFI_INTEGRATOR/.test(env) && /LIFI_FEE/.test(env));
    t('...and the example never carries a real key', /LIFI_API_KEY=\s*$/m.test(env));
  }

  /* ---- 46. the bridge is REACHABLE, not just implemented ---------------- */
  /*
   * ─── WHY THIS SECTION EXISTS ──────────────────────────────────────────────
   * The bridge API shipped one release before any screen could reach it. Fee
   * collection was confirmed live — /api/bridge/status returned
   * registered:true and our cut appeared in the quote's recipients array —
   * and the revenue was still exactly zero, because there was no route, no
   * nav entry and no page.
   *
   * That is the "wired to nothing" bug in its purest form, and section 41
   * did not catch it because it only checked the SERVER side. A working,
   * tested, revenue-generating integration nobody can open earns the same as
   * one that was never built.
   */
  {
    t('the bridge screen exists', existsSync('src/pages/Bridge.jsx'));
    t('the bridge client lib exists', existsSync('src/lib/bridge.js'));

    const app = read('src/App.jsx');
    t('there is a route to it', /path="\/bridge"/.test(app));
    t('...and the page is actually imported', /import\('\.\/pages\/Bridge'\)/.test(app));

    /*
     * A route with no link is only reachable by typing a URL, which no phone
     * user does. The nav entry is what makes the difference between built and
     * usable.
     */
    t('a user can navigate to it', /'\/bridge'/.test(read('src/components/MoreSheet.jsx')));

    const page = read('src/pages/Bridge.jsx');
    t('the screen requests quotes', /getBridgeQuote\s*\(/.test(page));
    t('...and can send the transaction', /sendTransaction\s*\(/.test(page));

    /*
     * The wallet MUST be moved to the source chain before signing. Skipping
     * it broadcasts to whatever network happened to be selected — the single
     * most expensive mistake available on this screen and one the user cannot
     * undo.
     */
    t('it switches to the source chain before signing',
      /wallet\.chainId !== fromChain/.test(page) && /switchChain/.test(page));

    /*
     * Our fee has to be visible in the quote. A fee the user only discovers
     * afterwards is the kind that makes them stop trusting every other number
     * on the screen.
     */
    t('our own cut is itemised for the user', /bridge\.ourFee/.test(page));
    t('...and the total cost is shown', /bridge\.totalCost/.test(page));

    /*
     * ─── THE FAQ MUST NOT CONTRADICT THE APP ────────────────────────────────
     * It said "this app does not bridge between chains" in both languages,
     * which was true when written and became false the moment this screen
     * shipped. A help page that denies a feature the app has is the same
     * class of error as the old "9 Chains" claim.
     */
    const faq = read('src/lib/faqLocal.js');
    t('the FAQ no longer denies bridging',
      !/does not bridge/.test(faq) && !/پل نمی‌زند/.test(faq));
    t('...and points at the bridge screen instead', /Bridge screen/.test(faq));
  }

  /* ---- 47. gasless swaps: key server-side, fee not caller-settable ------ */
  {
    t('the gasless module exists', existsSync('server/gasless.js'));
    const gl = read('server/gasless.js');
    const appSrc = read('server/app.js');

    t('the API exposes a gasless quote', /\/api\/gasless\/quote/.test(appSrc));
    t('...and a submit relay', /\/api\/gasless\/submit/.test(appSrc));
    /*
     * Status matters because this feature is OFF without a key. The UI has to
     * be able to tell "not available here" from "broken", and only one of
     * those is worth showing anyone.
     */
    t('...and a status route', /\/api\/gasless\/status/.test(appSrc));

    /* Same rule as every other key in this repo, asserted not remembered. */
    t('the 0x key is server-side only',
      /process\.env\.ZEROX_API_KEY/.test(gl) && !/VITE_ZEROX/.test(gl));

    /*
     * The fee parameters decide where our revenue goes. In the forwarded
     * allow-list, anyone could redirect the commission by editing a query
     * string — identical boundary to bridge.js and solana.js.
     */
    {
      const idx = gl.indexOf('const ALLOWED = [');
      const list = gl.slice(idx, gl.indexOf('];', idx));
      t('the caller cannot supply the fee recipient', !/swapFeeRecipient/.test(list));
      t('the caller cannot supply the fee amount', !/swapFeeBps/.test(list));
      t('...but the server does set them',
        /params\.set\('swapFeeRecipient'/.test(gl) && /params\.set\('swapFeeBps'/.test(gl));
    }

    /*
     * Fails closed with a NAMED error rather than passing a raw 401 through.
     * A 401 in the client would look like a bug; GASLESS_NOT_CONFIGURED is
     * actionable.
     */
    t('a missing key produces a clear, named error', /GASLESS_NOT_CONFIGURED/.test(gl));

    /*
     * Native coin is meaningless here by definition — if the user had native
     * coin they would not need gasless. Rejecting it in our code produces a
     * useful message instead of a confusing upstream one.
     */
    t('non-ERC20 tokens are rejected', /BAD_TOKEN/.test(gl));

    const env = read('.env.example');
    t('the gasless vars are documented', /ZEROX_FEE_BPS/.test(env));
    t('...and the example never carries a real key', /ZEROX_API_KEY=\s*$/m.test(env));
  }

  /* ---- 48. perp funding: the panel must actually be reachable ---------- */
  /*
   * ─── THE BUG THIS EXISTS TO PREVENT, WHICH WE HAVE SHIPPED TWICE ────────
   * The bridge shipped a working, fee-collecting server integration with no
   * screen. Gasless shipped four working routes with no screen. Both "worked"
   * and both earned exactly zero, because no human being could reach them.
   *
   * Check #46 was written after the bridge and still only asserted the server
   * side existed. So this one asserts the whole chain, end to end: module →
   * route → client lib → component → rendered on a page → that page has a
   * route → that route has a nav entry.
   */
  {
    t('the perp data module exists', existsSync('server/perp.js'));
    t('the client lib exists', existsSync('src/lib/perp.js'));
    t('the panel component exists', existsSync('src/components/FundingPanel.jsx'));

    const srv = read('server/perp.js');
    const appSrc = read('server/app.js');
    const lib = read('src/lib/perp.js');
    const panel = read('src/components/FundingPanel.jsx');
    const page = read('src/pages/Perp.jsx');
    const appJsx = read('src/App.jsx');

    /* server: imported AND routed. Either alone is dead code. */
    t('the server imports the module', /from '\.\/perp\.js'/.test(appSrc));
    t('...and exposes it as a route', /\/api\/perp\/markets/.test(appSrc));
    /*
     * The route must CALL the fetcher, not merely mention it. A previous bug
     * in this repo passed a similar check because the import line matched the
     * function name while the call had been replaced — leaving a dead screen
     * that looked wired. Requiring `name(` is what distinguishes them.
     */
    t('...and the route calls the fetcher', /fetchPerpMarkets\b/.test(appSrc.split('/api/perp/markets')[1] ?? ''));

    /* client: the lib must hit the route we actually published. */
    t('the client fetches the published path', /perp\/markets/.test(lib));

    /* component: must call the client lib, not re-implement a fetch. */
    t('the panel calls the client lib', /getPerpMarkets\s*\(/.test(panel));

    /*
     * THE STEP THAT WAS MISSING BOTH PREVIOUS TIMES: a component that nothing
     * renders is identical to no component.
     */
    t('the page imports the panel', /import FundingPanel from/.test(page));
    t('...and actually renders it', /<FundingPanel\s*\/>/.test(page));

    /* And the page itself has to be reachable. */
    t('the perp page has a route', /path="\/perp"/.test(appJsx));
    t('...and a navigation entry', /'\/perp'/.test(read('src/components/MoreSheet.jsx')));

    /*
     * ─── THE HONESTY CLAIM ON THE SCREEN MUST STAY TRUE ────────────────────
     * The panel tells the user we earn nothing from any venue listed, and
     * that this is why the ranking can be trusted. If a referral link or
     * affiliate id were ever added to server/perp.js without that copy
     * changing, the screen would be claiming impartiality it no longer has.
     */
    t('no affiliate or referral parameter has crept into the venue data',
      !/ref=|referral|affiliate|builder/i.test(srv));

    /*
     * ─── NO GUESSED INTERVALS ──────────────────────────────────────────────
     * The single correctness property of this feature. Annualising a funding
     * rate without knowing its settlement interval yields a confidently wrong
     * cost, so an unlisted venue must be DROPPED rather than defaulted.
     */
    t('an unknown interval drops the venue rather than assuming one',
      /if \(!hours\) return null/.test(srv));
    t('...and there is no fallback interval anywhere',
      !/FUNDING_INTERVAL_HOURS\[[^\]]+\]\s*(\?\?|\|\|)/.test(srv));

    /*
     * No offline snapshot, deliberately — a stale funding rate can tell
     * somebody a position pays them while it is costing them.
     */
    t('the client keeps no stale fallback',
      !/offlineData|mockData|FALLBACK_/.test(lib));

    /* Every key the panel renders must exist in en.json, or it prints raw. */
    {
      const en = JSON.parse(read('src/i18n/locales/en.json'));
      const keys = [...panel.matchAll(/t\('([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
      const missing = keys.filter((k) => !hasKey(en, k));
      t(`every funding-panel key resolves (${keys.length} checked)`, missing.length === 0);
      /* The dynamic ones are built by template and cannot be matched above. */
      for (const k of ['perp.custody.onchain', 'perp.custody.centralized',
                       'perp.crowd.longs', 'perp.crowd.balanced',
                       'perp.side.long', 'perp.side.short']) {
        t(`the templated key ${k} exists`, hasKey(en, k));
      }
      /* Persian is the owner's language and the primary audience. */
      const fa = JSON.parse(read('src/i18n/locales/fa.json'));
      t('the panel is fully translated into Persian',
        keys.every((k) => hasKey(fa, k)) && hasKey(fa, 'perp.custody.onchain'));
    }
  }

  /* ---- 49. the Solana fee is zero, and every surface agrees ------------ */
  /*
   * ─── WHY THIS IS A TEST AND NOT A COMMENT ───────────────────────────────
   * The Solana fee is deliberately OFF: collecting it needs a Jupiter referral
   * account created on-chain, which costs SOL the owner has not spent yet.
   * That is a supported state — swaps work, we earn nothing.
   *
   * The danger is not the zero. It is a surface that says 0.70% while the
   * code charges nothing. Overstating a fee is the safer direction to be
   * wrong in and it is still "the fee I was quoted is not the fee I paid",
   * which is what makes someone distrust an irreversible swap.
   *
   * The app already switches its own notice on `solanaFeeReady()`. The
   * LANDING PAGE did not — it advertised a flat 0.70% to search engines on a
   * page that lists Solana as supported.
   */
  {
    const landing = read('scripts/gen-landing.mjs');
    const solLib = read('src/lib/solana.js');
    const solSrv = read('server/solana.js');

    /* Strip comments first: these checks must not match their own rationale. */
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    t('the landing page no longer quotes a flat platform fee',
      !/\['Platform fee', '0\.70% of the input/.test(code(landing)));
    t('...and says plainly that Solana is not charged',
      /No platform fee on Solana/.test(landing));

    /*
     * The request-side guard. Jupiter does NOT error on a referralFee sent
     * without a usable account — it silently ignores it — so an unguarded
     * call would look configured in the logs while earning zero. Both the
     * client and the server must gate on the account existing.
     */
    t('the client only requests a fee when the referral account exists',
      /if \(solanaFeeReady\(\)\)/.test(code(solLib)));
    t('the server only attaches a fee when its account is set',
      /if \(BASE58\.test\(ref\)\)/.test(code(solSrv)));

    /*
     * The disclosure must be driven by the SAME flag that decides whether to
     * charge, so the two can never disagree again.
     */
    const solPage = code(read('src/pages/SolanaSwap.jsx'));
    t('the screen picks its fee notice from that same flag',
      /solanaFeeReady\(\)\s*\?/.test(solPage));
    t('...and has a no-fee notice to fall back on',
      /solana\.feeNoneNotice/.test(solPage));

    /* Both notices must exist in English and Persian or the screen prints a key. */
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));
    t('the no-fee notice is translated',
      hasKey(en, 'solana.feeNoneNotice') && hasKey(fa, 'solana.feeNoneNotice'));

    /*
     * The referral account must NOT be hard-coded. It does not exist yet, and
     * a plausible-looking constant here would make solanaFeeReady() return
     * true, switch the UI to "we charge 0.70%", and send Jupiter an account
     * that cannot receive — charging users for a fee that lands nowhere.
     */
    t('no referral account is hard-coded while it does not exist',
      /VITE_JUP_REFERRAL_ACCOUNT\) \|\| ''/.test(solLib));
    t('...and the server default is empty too',
      /JUP_REFERRAL_ACCOUNT \|\| ''/.test(solSrv));
  }

  /* ---- 50. no surface may quote a flat fee we do not charge ------------ */
  /*
   * ─── THE SAME BUG, FOUND A SECOND TIME, ON A WORSE SCREEN ───────────────
   * Last pass I fixed the landing page for advertising a flat "0.70%" while
   * Solana is charged nothing. I treated that as the one instance. It was not.
   *
   * `buy.noFee` said "Our 0.70% applies only to swaps inside the app" — and
   * that sentence is INSIDE the app, on a screen APK users reach, in a
   * paragraph whose entire purpose is to be precise about what we charge.
   * Being imprecise about a fee in the disclosure about fees is worse than
   * being imprecise anywhere else.
   *
   * So this is now a rule with a test behind it rather than a thing I
   * remember to check: any user-facing string that names the 0.70% rate must
   * also say which chains it applies to, for as long as the two differ.
   *
   * When the Jupiter referral account exists and Solana is charged too, this
   * check should be DELETED, not worked around — at that point one number is
   * the truth again.
   */
  {
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));

    /* Walk every string in a locale, remembering its dotted path. */
    const strings = (obj, prefix = '') => {
      const out = [];
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'string') out.push([path, v]);
        else if (v && typeof v === 'object') out.push(...strings(v, path));
      }
      return out;
    };

    /*
     * Matches the rate in either digit system. Persian copy uses Eastern
     * digits and an Arabic decimal separator (۰٫۷), so an ASCII-only check
     * would silently pass every Persian string — which is the language the
     * primary audience actually reads. I hit exactly that while editing.
     */
    const quotesRate = (v) => /0\.70?\s*%/.test(v) || /۰\s*٫\s*۷\s*٪/.test(v);
    /* Qualified means it names the chain scope, in that language. */
    const qualified = (v) =>
      /EVM/i.test(v) || /Solana/i.test(v) || /سولانا/.test(v);

    for (const [lang, loc] of [['en', en], ['fa', fa]]) {
      const bad = strings(loc)
        .filter(([, v]) => quotesRate(v))
        .filter(([, v]) => !qualified(v))
        .map(([k]) => k);
      t(`${lang}: every 0.70% claim names the chains it applies to` +
        (bad.length ? ` — unqualified: ${bad.join(', ')}` : ''),
        bad.length === 0);
    }

    /* The specific string that was wrong, pinned in both languages. */
    t('the Buy screen fee note is chain-qualified in English',
      /EVM/.test(en.buy.noFee) && /Solana/.test(en.buy.noFee));
    t('...and in Persian', /EVM/.test(fa.buy.noFee) && /سولانا/.test(fa.buy.noFee));
  }

  /* ---- 51. the perp screen is website-only, and that is deliberate ------ */
  /*
   * ─── WHY THE FUNDING PANEL IS NOT IN THE APK ────────────────────────────
   * `/perp` is gated behind SPECULATION_ENABLED, which is OFF by default and
   * only set by `build:full` (what Vercel runs). `npm run build` — which
   * `android:sync` and therefore the APK use — strips the route, the chunk
   * and the whole `perp` locale namespace.
   *
   * That is CORRECT and must stay. APKPure rejected the app verbatim for
   * "Not involve illegal sensitive words", and a screen titled "Perpetuals"
   * advertising leverage is exactly the vocabulary that filter catches.
   * Shipping the funding panel inside the APK would trade a feature nobody
   * has asked for against the app being distributable at all.
   *
   * This test exists so that the gating is a decision on record rather than
   * something a later change quietly reverses. It also prevents the opposite
   * error: adding the panel to a screen that IS in the APK, which would drag
   * the same vocabulary in through the back door.
   */
  {
    const appJsx = read('src/App.jsx');
    const pkg = JSON.parse(read('package.json'));

    t('the perp route stays behind the speculation flag',
      /SPECULATION_ENABLED && <Route path="\/perp"/.test(appJsx));
    t('...and the plain build (used by the APK) does not enable it',
      !/VITE_ENABLE_SPECULATION/.test(pkg.scripts.build));
    t('...while the website build does',
      /VITE_ENABLE_SPECULATION=true/.test(pkg.scripts['build:full']));
    t('...and the APK is built from the plain build',
      /npm run build\b/.test(pkg.scripts['android:sync']));

    /*
     * The panel must live ONLY on the gated screen. If it were rendered from
     * any always-shipped page, the leverage vocabulary would reach the APK
     * regardless of the flag.
     */
    const renderers = walk('src')
      .filter((f) => /<FundingPanel/.test(read(f)))
      .map((f) => f.replace(/\\/g, '/'));
    t(`only the gated perp page renders the funding panel (${renderers.length})`,
      renderers.length === 1 && renderers[0].endsWith('src/pages/Perp.jsx'));
  }

  /* ---- 52. automatic orders: watched in the BACKGROUND, end to end ----- */
  /*
   * ─── THE BUG THIS LOCKS DOWN ────────────────────────────────────────────
   * `syncWatches` filtered `type === 'limit'`, so a TRAILING STOP was never
   * mirrored to the server. It only ever advanced its high-water mark while
   * the app was open in the foreground — exactly backwards, because a
   * trailing stop is the one order that cannot be watched by hand.
   *
   * The subtle half: the React key in Orders.jsx that decides WHEN to re-sync
   * carried the same `=== 'limit'` filter. Fixing only `syncWatches` would
   * leave the feature just as broken while looking repaired — a new trailing
   * stop would not change the key, so the sync would never run for it.
   *
   * Two filters, one intent. They now share WATCHED_TYPES, and this asserts
   * neither grows a private copy again.
   */
  {
    const lib = read('src/lib/orders.js');
    const page = read('src/pages/Orders.jsx');
    const srv = read('server/watch.js');

    /* Strip comments so these checks cannot match their own rationale. */
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const libCode = code(lib);
    const pageCode = code(page);
    const srvCode = code(srv);

    t('the watched-type set is defined once and exported',
      /export const WATCHED_TYPES = new Set\(/.test(libCode));
    t('the sync uses the shared set', /WATCHED_TYPES\.has\(o\.type\)/.test(libCode));
    t('the re-sync key uses the same shared set', /WATCHED_TYPES\.has\(o\.type\)/.test(pageCode));
    t('...and the page imports it rather than redefining it',
      /WATCHED_TYPES/.test(page.split('from \'../lib/orders\'')[0]) &&
      !/const WATCHED_TYPES\s*=/.test(pageCode));

    /*
     * The specific regression: neither filter may narrow back to limit-only.
     * A literal `type === 'limit'` in a filter is the exact shape of the bug.
     */
    t('the sync no longer filters to limit orders only',
      !/status === 'active' && o\.type === 'limit'/.test(libCode));
    t('the re-sync key no longer filters to limit orders only',
      !/status === 'active' && o\.type === 'limit'/.test(pageCode));

    /* The server has to actually understand what the client now sends. */
    t('the server accepts the same four types',
      /const WATCH_TYPES = new Set\(\[('limit'|"limit")[^)]*\)/.test(srvCode) &&
      /'trailing'/.test(srvCode) && /'bracket'/.test(srvCode) && /'ladder'/.test(srvCode));
    t('...and evaluates them rather than assuming a target',
      /export function evaluateWatch/.test(srvCode));
    /*
     * The trailing peak must be PERSISTED by the watcher. A high-water mark
     * that only advances while the app is open is not a high-water mark, and
     * this is the line that makes background trailing real.
     */
    t('the watcher persists the trailing peak between cycles',
      /res\.peak != null/.test(srvCode) && /peakRate: res\.peak/.test(srvCode));
    /*
     * Old clients keep working: a stored watch with no `type` is a limit
     * order, because that is the only kind the old client could send.
     */
    t('watches written by an older client still work',
      /it\?\.type \?\? 'limit'/.test(srvCode));
    /* DCA must stay off the server — it is a behavioural profile we do not need. */
    t('DCA is still never uploaded', !/'dca'/.test(srvCode.split('WATCH_TYPES')[1]?.slice(0, 200) ?? ''));
  }

  /* ---- 53. the new order types are reachable and fully translated ------ */
  {
    const page = read('src/pages/Orders.jsx');
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));

    /* A form nobody can open is the "wired to nothing" bug again. */
    t('the bracket sheet can be opened', /setSheet\('bracket'\)/.test(page));
    t('the ladder sheet can be opened', /setSheet\('ladder'\)/.test(page));
    t('...and the bracket form actually renders', /kind === 'bracket'/.test(page));
    t('...and the ladder form actually renders', /kind === 'ladder'/.test(page));

    /* The sheet title is built as orders.new.<kind> — a miss prints a raw key. */
    for (const k of ['bracket', 'ladder']) {
      t(`the ${k} sheet has a title in both languages`,
        hasKey(en, `orders.new.${k}`) && hasKey(fa, `orders.new.${k}`));
    }

    /*
     * Every validator code must have a message, or a rejected order fails
     * silently and the user just sees the button do nothing.
     *
     * NOTE THE LOOKUP SHAPE. These live as FLAT keys inside `toast` —
     * literally `toast["orderErr.BAD_STOP"]` — not as a nested `orderErr`
     * object. My first version of this check walked the dotted path and
     * failed on keys that were present and correct. The existing codes follow
     * the same convention, so the test has to match the storage the app
     * actually uses rather than the shape I assumed.
     */
    for (const codeName of ['BAD_STOP', 'BRACKET_INVERTED', 'BAD_STEPS', 'LADDER_FLAT']) {
      t(`the ${codeName} error is explained in both languages`,
        typeof en.toast?.[`orderErr.${codeName}`] === 'string' &&
        typeof fa.toast?.[`orderErr.${codeName}`] === 'string');
    }

    /* Both new types must render in the LIST, not only in the form. */
    t('a bracket renders in the order list', /o\.type === 'bracket'/.test(page));
    t('a ladder renders in the order list', /o\.type === 'ladder'/.test(page));

    /*
     * The advisor is wired to the SAME series the history panel renders, so
     * the suggestion and the evidence on screen cannot describe different
     * data.
     */
    t('the advisor is called from the order form', /adviseOrder\s*\(/.test(page));
    t('...and nothing is applied without the user pressing a button',
      /orders\.useSuggestion/.test(page));

    const keys = [...page.matchAll(/t\('(orders\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
    const missingEn = [...new Set(keys)].filter((k) => !hasKey(en, k));
    t(`every orders.* key on the screen resolves (${new Set(keys).size} checked)` +
      (missingEn.length ? ` — missing: ${missingEn.join(', ')}` : ''),
      missingEn.length === 0);
    const missingFa = [...new Set(keys)].filter((k) => !hasKey(fa, k));
    t('...and all of them are translated into Persian' +
      (missingFa.length ? ` — missing: ${missingFa.join(', ')}` : ''),
      missingFa.length === 0);
  }

  /* ---- 54. coin-id lookup is wired, and never guesses ------------------ */
  {
    const srv = read('server/coinIndex.js');
    const appSrc = read('server/app.js');
    const client = read('src/lib/coinId.js');

    t('the coin index module exists', existsSync('server/coinIndex.js'));
    t('the server imports it', /from '\.\/coinIndex\.js'/.test(appSrc));
    t('...and exposes a route', /\/api\/coin-id\/:chainId/.test(appSrc));
    t('...and the route calls the resolver', /resolveIds\s*\(/.test(appSrc));
    t('the client calls the published path', /coin-id\//.test(client));

    /*
     * ─── RESOLUTION IS BY ADDRESS, NEVER BY SYMBOL ──────────────────────────
     * Dozens of tokens share the ticker "BTC" and scam tokens copy real
     * symbols deliberately. An order watching the wrong coin's price fires at
     * a number unrelated to the asset being sold — worse than no order, since
     * the user believes they are covered.
     */
    t('the client never falls back to symbol matching',
      !/symbol\s*===|bySymbol|matchSymbol/i.test(client));
    t('an unresolved token is reported as null, not guessed',
      /id \? \{ \.\.\.token, coingeckoId: id \} : token/.test(client));
    /*
     * A network failure must not be cached. Caching a null on a transient
     * error would mark a good token permanently unorderable for the session.
     */
    t('a lookup failure is not cached as a miss',
      /must NOT be cached|not be cached/i.test(read('src/lib/coinId.js')));

    /* The batch is capped on BOTH sides — a client cap alone is not a limit. */
    t('the server caps the batch size', /\.slice\(0, 25\)/.test(srv));
    t('...and the client respects the same cap', /slice\(0, 25\)/.test(client));
  }

  /* ---- 55. autopilot is reachable, fills the form, never submits ------- */
  {
    t('the autopilot engine exists', existsSync('src/lib/autopilot.js'));
    t('the panel exists', existsSync('src/components/AutopilotPanel.jsx'));

    const lib = read('src/lib/autopilot.js');
    const panel = read('src/components/AutopilotPanel.jsx');
    const page = read('src/pages/Orders.jsx');
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    /* The full chain, because a panel nothing renders is the bug this repo
       has already shipped twice (bridge, gasless). */
    t('the page imports the panel', /import AutopilotPanel from/.test(page));
    t('...and actually renders it', /<AutopilotPanel/.test(page));
    t('the panel calls the engine', /buildAutopilot\s*\(/.test(code(panel)));

    /*
     * ─── IT MUST FILL, NEVER SUBMIT ─────────────────────────────────────────
     * The last action before an order exists has to be the user's. If the
     * panel could call onSubmit/addOrder directly, the app would be placing
     * trades on somebody's behalf.
     */
    t('the panel cannot create an order itself',
      !/addOrder|createOrder|onSubmit/.test(code(panel)));
    t('...it only hands a draft back', /onApply\?\.\(/.test(code(panel)));
    t('the page applies the draft into the form fields',
      /const applyDraft = useCallback/.test(code(page)));
    /*
     * Applying a ladder draft while the limit form is open would fill fields
     * nobody can see and look like the button did nothing.
     */
    t('...and switches the sheet to the right order type',
      /onSwitchKind\?\.\(draft\.type\)/.test(code(page)));

    /*
     * Autopilot is meaningless on DCA — that is a schedule, not a price
     * decision, and there would be nothing to measure.
     */
    t('autopilot is hidden on the DCA form', /kind !== 'dca' &&/.test(page));

    /* No English may originate in the engine; it returns keys. */
    t('the engine returns translation keys, not sentences',
      /autopilot\.summary\.\$\{/.test(code(lib)));

    /* Every key the panel renders must resolve, in both languages. */
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));
    const keys = [...panel.matchAll(/t\('([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
    const missEn = [...new Set(keys)].filter((k) => !hasKey(en, k));
    t(`every autopilot key resolves (${new Set(keys).size} checked)` +
      (missEn.length ? ` — missing: ${missEn.join(', ')}` : ''), missEn.length === 0);
    /* The templated ones are built at runtime and cannot be matched above. */
    for (const g of ['protect', 'takeProfit', 'buyDip']) {
      t(`the ${g} goal is fully translated`,
        hasKey(en, `autopilot.goal.${g}.title`) && hasKey(fa, `autopilot.goal.${g}.title`) &&
        hasKey(en, `autopilot.summary.${g}`) && hasKey(fa, `autopilot.summary.${g}`));
    }
    for (const r of ['NO_HISTORY', 'NO_LEVEL', 'NO_VOLATILITY', 'BAD_AMOUNT']) {
      t(`the ${r} refusal is explained in both languages`,
        hasKey(en, `autopilot.refused.${r}`) && hasKey(fa, `autopilot.refused.${r}`));
    }
  }

  /* ---- 56. outbound referral links, and the honesty notice ------------- */
  {
    const lib = read('src/lib/venueReferral.js');
    const perp = read('src/pages/Perp.jsx');
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    t('the venue referral module exists', existsSync('src/lib/venueReferral.js'));
    t('the perp screen routes links through it', /withReferral\(venueId, url\)/.test(code(perp)));
    t('...and passes the venue id, not just the url', /openVenue\(v\.id, v\.url\)/.test(perp));

    /*
     * ─── THE NOTICE MUST TRACK REALITY ──────────────────────────────────────
     * `perp.thirdPartyNotice` says we "earn nothing from them". The moment a
     * GMX code is registered that becomes false, and an honesty notice that
     * has quietly become a lie is the exact failure already caught twice here
     * (the FAQ denying bridging; the landing page quoting a Solana fee).
     * The same flag that attaches the code picks the sentence.
     */
    t('the notice switches when we start earning',
      /anyVenueEarns\(/.test(code(perp)) && /thirdPartyNoticeEarning/.test(perp));
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));
    t('both notices exist in both languages',
      hasKey(en, 'perp.thirdPartyNotice') && hasKey(en, 'perp.thirdPartyNoticeEarning') &&
      hasKey(fa, 'perp.thirdPartyNotice') && hasKey(fa, 'perp.thirdPartyNoticeEarning'));
    /* The earning version must disclose BOTH sides: our cut and their discount. */
    t('the earning notice discloses our share',
      /share of the trading fee/i.test(en.perp.thirdPartyNoticeEarning));
    t('...and the discount the user gets', /5% fee discount/i.test(en.perp.thirdPartyNoticeEarning));

    /*
     * The code is case-sensitive on-chain. Normalising it would point at a
     * code nobody owns and earn zero silently.
     */
    t('the code is validated, never lower-cased',
      /\[A-Za-z0-9_\]/.test(lib) && !/GMX_CODE[^\n]*toLowerCase/.test(lib));
    /*
     * A referral code is public by design — it lives in a shared link. VITE_
     * is correct here, and this asserts no SECRET crept in beside it.
     */
    /*
     * Strip comments FIRST. The initial version matched the word "SECRETS" in
     * this module's own explanation of why a public referral code is not one —
     * a check failing on its own rationale, which is trap #1 in this file's
     * header and one I have now hit again.
     */
    const libCode = code(lib);
    t('only the public code is read from the client env',
      /VITE_GMX_REF_CODE/.test(libCode) && !/API_KEY|SECRET|PRIVATE/i.test(libCode));

    t('the setup guide exists for the owner', existsSync('docs/GMX-REFERRAL-FA.md'));
    const doc = read('docs/GMX-REFERRAL-FA.md');
    /* The guide must carry the real contract and the case-sensitivity warning,
       since a wrong code earns zero with no error anywhere. */
    t('...and names the real ReferralStorage contract',
      /0xe6fab3F0c7199b0d34d7FbE83394fc0e0D06e99d/.test(doc));
    t('...and warns that the code is case-sensitive', /حساس/.test(doc));
  }

  /* ---- 57. coin page buys for REAL, and the wallet is two tabs --------- */
  {
    const coin = read('src/pages/CoinDetail.jsx');
    const wallet = read('src/pages/Wallet.jsx');
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const coinCode = code(coin);

    /*
     * ─── THE PRIMARY BUTTONS MUST NOT OPEN THE SIMULATOR ────────────────────
     * The regression is specific: a Buy button whose handler navigates to
     * `/trade`. The practice screen is still reachable, but only from a
     * clearly-labelled secondary button.
     */
    t('buy routes to the real swap', /swapUrlFor\(coinGeckoId, 'buy'\)/.test(coinCode));
    t('sell routes to the real swap', /swapUrlFor\(coinGeckoId, 'sell'\)/.test(coinCode));
    t('...and the practice screen is a clearly-labelled fallback',
      /coin\.practiceInstead/.test(coin));
    /*
     * Exactly ONE /trade navigation may remain — the labelled practice button.
     * Two would mean a primary button still points at the simulator.
     */
    t('only one route to the simulator remains',
      (coinCode.match(/navigate\(`\/trade\?/g) ?? []).length === 1);
    /* An unswappable coin must be told, not silently sent somewhere. */
    t('an unswappable coin shows an explanation', /coin\.notSwappable/.test(coin));

    /* ---- candles ---- */
    t('the candle component exists', existsSync('src/components/CandleChart.jsx'));
    t('the coin page can switch to candles', /chartMode === 'candle'/.test(coinCode));
    t('...and renders the component', /<CandleChart/.test(coin));
    t('the OHLC route exists', /\/api\/ohlc\/:id/.test(read('server/app.js')));
    t('...and calls the fetcher', /fetchOhlc\s*\(/.test(read('server/app.js')));
    /*
     * NO offline fallback for candles. The bundled snapshot holds closes only,
     * so a fabricated candle would have to invent its high and low — the two
     * numbers the user switched to candles to see.
     */
    t('candles never fall back to invented data',
      /fallback: \(\) => \[\]/.test(read('src/lib/api.js')));

    /* ---- wallet: two tabs, real and practice ---- */
    t('the wallet has exactly two tabs', /\['real', 'practice'\]/.test(wallet));
    t('...named real and practice in both languages',
      hasKey(JSON.parse(read('src/i18n/locales/en.json')), 'wallet.tab.real') &&
      hasKey(JSON.parse(read('src/i18n/locales/fa.json')), 'wallet.tab.real'));
    /* Pools and NFTs are real holdings and belong inside the real wallet. */
    t('pools are reachable from the real wallet', /navigate\('\/farm'\)/.test(wallet));
    t('NFTs are reachable from the real wallet', /navigate\('\/nft'\)/.test(wallet));
    /* The old three-tab state must be gone, or a stale tab renders nothing. */
    t('no stale overview tab remains', !/tab === 'overview'/.test(wallet));

    /* ---- the Persian video search is gone ---- */
    const docs = read('src/pages/Docs.jsx');
    /*
     * These never pointed at a video. They ran an Aparat SEARCH, so whether
     * anything relevant came back depended on Aparat's index that day — the
     * button promised a lesson and often delivered nothing. Reported as
     * «فیلم های فارسی حذف بشه نمیارع».
     */
    /*
     * Comments stripped first. My initial version matched the word "Aparat"
     * inside the very comment in Docs.jsx explaining why the Aparat button
     * was removed — a check failing on its own rationale. That is trap #1 in
     * this file's header and the third time I have hit it, so: any check that
     * asserts the ABSENCE of a word must run against code, never prose.
     */
    t('the Aparat search helper is gone', !/aparat/i.test(code(docs)));
    t('...and its label is gone from both locales',
      !hasKey(JSON.parse(read('src/i18n/locales/en.json')), 'docs.watchFa') &&
      !hasKey(JSON.parse(read('src/i18n/locales/fa.json')), 'docs.watchFa'));
    /* The written guide is ours and must still be there — it is the thing
       that actually teaches, and it always loads. */
    t('the written guide remains', /docs\.\$\{id\}\.title|docs\.\$\{/.test(docs) || /SECTIONS\.map/.test(docs));

    /* ---- the honest CEX/DEX answer is written down ---- */
    t('the CEX/DEX analysis exists', existsSync('docs/CEX-DEX-FA.md'));
    const cex = read('docs/CEX-DEX-FA.md');
    /*
     * The doc must carry the two facts that decide the answer: the real
     * capital requirement, and that the big CEX affiliate programmes are
     * closed to Iran — signing up would mean lying about residence and
     * getting the balance frozen.
     */
    t('...and states the real MiCA capital requirement', /۱۲۵٬۰۰۰|125,000|125000/.test(cex));
    t('...and warns the big exchanges block Iran', /OFAC|مسدود/.test(cex));
  }


  /* ---- 58. we are the exchange: no rival swap on our own screens ------- */
  /*
   * ─── THE PRINCIPLE, AS THE OWNER PUT IT ─────────────────────────────────
   * «ما خودمون صرافی هستیم نیاز به سواپ کسی نداریم» — we are an exchange, we
   * do not need anyone else's swap.
   *
   * He is right, and I had got this wrong. I built a screen that quoted
   * ChangeNOW's swap and linked out to it, and the Buy screen linked to
   * Binance P2P. Both hand over the scarcest thing we have: a user who has
   * already arrived and already trusts us. Worse, both bar Iran, so most of
   * our users were being sent somewhere they would be refused.
   *
   * This check exists because the mistake is easy to repeat — an outbound
   * swap link always looks like "extra choice for the user" and is actually
   * us paying a competitor for our own traffic.
   *
   * The GMX perp link is deliberately NOT covered: we do not run a perp
   * engine, so it competes with nothing of ours, and it pays us.
   */
  {
    /*
     * P2P is deliberately NOT in this list. Those three desks convert rial to
     * crypto, which is the one thing this app genuinely does not do — they
     * compete with nothing of ours, so removing them would leave a real need
     * with no answer. They are allowed to stay ONLY with the block warning
     * asserted below.
     */
    const swapSurfaces = ['src/pages/Buy.jsx', 'src/pages/Swap.jsx'];
    /* Comments stripped: these files EXPLAIN why the links were removed, and
       a check that matched its own rationale would fail forever. Trap #1. */
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    /* Rival swap/exchange front doors that must never be linked from a screen
       where we sell the same thing. */
    const rivals = [
      'changenow.io', 'changelly.com', 'simpleswap.io', 'p2p.binance.com',
      'pancakeswap.finance/swap', '1inch.io', 'uniswap.org/swap'
    ];

    for (const f of swapSurfaces) {
      if (!existsSync(f)) continue;
      const src = code(read(f));
      const found = rivals.filter((r) => src.includes(r));
      t(`${f} links to no rival exchange${found.length ? ` — found: ${found.join(', ')}` : ''}`,
        found.length === 0);
    }

    /* The ChangeNOW integration was removed outright, not flagged off. A flag
       is the same problem waiting for someone to set an env var. */
    t('the ChangeNOW module is gone', !existsSync('server/crosschain.js'));
    t('...and its client lib', !existsSync('src/lib/crosschain.js'));
    t('...and its screen', !existsSync('src/pages/Coins.jsx'));
    t('...and its route', !/path="\/coins"/.test(read('src/App.jsx')));
    t('...and its nav entry', !/nav\.coins/.test(read('src/components/MoreSheet.jsx')));
    t('...and its server routes', !/crosschain/.test(read('server/app.js')));

    /*
     * ─── BUY MUST NOT GROW CARD ON-RAMPS EITHER ─────────────────────────────
     * Checked again this pass because the owner asked for card payments and
     * the answer is genuinely no, at three independent layers:
     *   1. ChangeNOW bars Iran (their §11.1, and their published country list)
     *   2. their fiat partners bar it separately — Guardarian's own restricted
     *      list names Iran; ChangeNOW does not process fiat itself
     *   3. Visa/Mastercard/Amex are severed from Iran's banking system at the
     *      network level and have been since 2012
     * An Iranian bank card cannot authorise a foreign crypto purchase. No
     * integration fixes that, so listing one would recreate the dead buttons
     * this screen was rebuilt to remove.
     */
    /*
     * ─── THE P2P EXCEPTION IS CONDITIONAL ───────────────────────────────────
     * Binance, OKX and Bybit all publish Iran as fully blocked under OFAC.
     * Sending somebody to sign up where they will be refused — or worse, be
     * frozen after depositing — is not help. The desks may stay, but only
     * while the warning does, so both are asserted together.
     */
    const p2p = read('src/pages/P2P.jsx');
    t('the P2P desks carry a jurisdiction warning', /p2p\.deskWarning/.test(p2p));
    t('...and each blocked desk is flagged individually', /blocksIran/.test(p2p));
    {
      const en = JSON.parse(read('src/i18n/locales/en.json'));
      const fa = JSON.parse(read('src/i18n/locales/fa.json'));
      t('...in both languages',
        hasKey(en, 'p2p.deskWarning') && hasKey(fa, 'p2p.deskWarning') &&
        hasKey(en, 'p2p.blocksIran') && hasKey(fa, 'p2p.blocksIran'));
      t('...and the warning names the sanctions reason', /OFAC/.test(en.p2p.deskWarning));
    }

    const buy = code(read('src/pages/Buy.jsx'));
    const onramps = ['moonpay', 'transak', 'simplex', 'banxa', 'guardarian', 'ramp.network'];
    const listed = onramps.filter((o) => buy.toLowerCase().includes(o));
    t(`the buy screen lists no card on-ramp that blocks the region${listed.length ? ` — found: ${listed.join(', ')}` : ''}`,
      listed.length === 0);
  }

  return rows;
}
